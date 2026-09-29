"use strict";

// Read-only data source for the operator gallery. Contact fields are used only
// for the paid-access join and are deliberately discarded before the response.
//
// The Gallery also reads the durable Line rows. A mirror can be a real deployed
// website before final inspection has written preview_url back to the prospect
// record. Hiding those rows made built sites look orphaned. Line-only artifacts
// are now visible immediately, but they are deliberately NOT sendable until the
// preview write has completed and the row is durably ready/queued/sent.

const { requireAdmin } = require("../../lib/admin-auth");
const { slugify } = require("../../lib/dashboard-link");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { sanitizePreviewUrl } = require("../../lib/preview-host-guard");
const { signedVisualPath } = require("../../lib/preview-visuals");
const { PROOF_SENT_EVENT_TYPE, isOwnerProofEmailRecord, ownerProofRouting } = require("../../lib/prospect-detail");
const { select } = require("../../lib/store");
const { bankCountsByVertical } = require("../../lib/prospect-bank");
const { prospectSiteSlug } = require("../../lib/wss-connect-assets/magic-link");
const { lineReleaseInput } = require("../../lib/owner-proof-delivery");

const PROSPECTS = "ghost_agency_prospects";
const LINE_ROWS = "ghost_agency_line_batch_rows";
const LINE_BATCHES = "ghost_agency_line_batches";
const DASHBOARD_ACCESS = "ghost_agency_dashboard_access";
const EVENTS = "ghost_agency_events";
const EMAIL_LOG = "ghost_agency_email_log";
const MAX_BUILDS = 500;
const MAX_SEND_HISTORY = 500;

const PROSPECT_QUERY = [
  "select=prospect_id,status,business_name,owner_email,industry,city,state,preview_url,report_url,updated_at,desired_domain:record->>desired_domain,campaign:record->>campaign,campaign_name:record->>campaign_name,campaign_id:record->>campaign_id,batch_id:record->>batch_id,rec_business_name:record->>business_name,rec_business_name_camel:record->>businessName,rec_city:record->>city,rec_state:record->>state,rec_industry:record->>industry,rec_vertical:record->>vertical,rec_status:record->>status,rec_prospect_id:record->>prospect_id,rec_preview_url:record->>preview_url,rec_preview_url_camel:record->>previewUrl,rec_report_url:record->>report_url,rec_report_url_camel:record->>reportUrl,rec_owner_email:record->>owner_email,rec_owner_email_camel:record->>ownerEmail",
  // Only rows that can carry a preview. Without this, the newest-500 window
  // fills with no-preview prospects and built sites age out of the Gallery.
  "preview_url=not.is.null",
  // Retired and teardown-pending sites retain their durable tombstone in the
  // database, but never reappear as active inventory cards.
  "status=not.in.(retiring,retired)",
  "order=updated_at.desc",
  `limit=${MAX_BUILDS}`,
].join("&");

const LINE_ROW_QUERY = [
  "select=row_id,batch_id,status,payload,updated_at",
  // Keep the 500-row budget on rows that can carry a preview (built mirrors:
  // mirrored/gate_passed/ready/queued/sent, plus gate_failed-but-deployed).
  // Without this, rejected/picked/qualified rows crowd built sites out of the
  // window and the Gallery shows nothing was built.
  "status=not.in.(picked,qualified,rejected)",
  "order=updated_at.desc",
  `limit=${MAX_BUILDS}`,
].join("&");

// The durable batch each Line row belongs to. `halted` is the state a batch is
// parked in deliberately — by the owner clearing it as stuck, or by a newer
// practice run superseding it (halt_reason names which) — and a gate_passed row
// inside a halted batch is exactly a site that is built while its send lane is
// parked. Reading only three scalars; never the batch payload.
const LINE_BATCH_QUERY = [
  "select=batch_id,status,halt_reason",
  "order=updated_at.desc",
  `limit=${MAX_BUILDS}`,
].join("&");

// THE LIVE CAMPAIGN CLOCK, at source. The gallery's one-timing read: the
// NEWEST batch the line is still working on, projected to the stopwatch the
// batch itself stamps (mine_funnel stage line_campaign_timing_v1, written by
// lib/line-continuation) plus the two counts the clock strip prints. Strictly
// bounded — one row, active statuses only, never the batch payload — and
// strictly annotation: a failed read or a batch without a stopwatch leaves
// the field off the response and the gallery paints exactly as before.
const CAMPAIGN_TIMING_STAGE = "line_campaign_timing_v1";
const ACTIVE_BATCH_STATUSES = Object.freeze([
  "building", "running", "awaiting_approval", "approved", "sending",
]);
const CAMPAIGN_TIMING_QUERY = [
  "select=batch_id,status,requested,mine_funnel",
  `status=in.(${ACTIVE_BATCH_STATUSES.join(",")})`,
  "order=updated_at.desc",
  "limit=1",
].join("&");

const ACCESS_QUERY = [
  "select=job_id,owner_email,site_slug",
  "job_id=not.like.prospect-*",
  `limit=${MAX_BUILDS}`,
].join("&");

const PROOF_EVENT_QUERY = [
  `select=prospect_id:payload->>prospect_id,created_at`,
  `type=eq.${encodeURIComponent(PROOF_SENT_EVENT_TYPE)}`,
  "order=created_at.desc",
  `limit=${MAX_SEND_HISTORY}`,
].join("&");

const EMAIL_LOG_QUERY = [
  // payload is selected so the last-send index can tell an owner-proof row
  // from a business send: since durable owner-proof accounting, lib/email.js
  // records proof deliveries in this table too, marked
  // (lib/prospect-detail's isOwnerProofEmailRecord).
  "select=prospect_id,sent_at,payload",
  "suppressed=is.false",
  "order=sent_at.desc",
  `limit=${MAX_SEND_HISTORY}`,
].join("&");

function text(value) {
  return String(value == null ? "" : value).trim();
}

// DATA MINIMIZATION: the prospect read used to pull the whole `record` jsonb —
// a large, contact-bearing blob — when the gallery only ever reads a handful of
// scalars out of it. PROSPECT_QUERY now projects exactly those scalars as
// PostgREST aliases (rec_*), and this rebuilds the small shape the callers
// expect. Legacy callers that still hand a full `record` object keep working.
function recordOf(row) {
  if (row && row.record && typeof row.record === "object" && !Array.isArray(row.record)) return row.record;
  if (!row) return {};
  return {
    business_name: row.rec_business_name,
    businessName: row.rec_business_name_camel,
    city: row.rec_city,
    state: row.rec_state,
    industry: row.rec_industry,
    vertical: row.rec_vertical,
    status: row.rec_status,
    prospect_id: row.rec_prospect_id,
    preview_url: row.rec_preview_url,
    previewUrl: row.rec_preview_url_camel,
    report_url: row.rec_report_url,
    reportUrl: row.rec_report_url_camel,
    owner_email: row.rec_owner_email,
    ownerEmail: row.rec_owner_email_camel,
    campaign: row.campaign,
    campaign_name: row.campaign_name,
    campaign_id: row.campaign_id,
    batch_id: row.batch_id,
  };
}

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function shotCacheWindow(now = new Date()) {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function safeShotUrl(previewUrl, signVisual) {
  if (!previewUrl) return null;
  try {
    const signed = text(signVisual({ kind: "new", previewUrl }));
    if (!signed) return null;
    return `${signed}${signed.includes("?") ? "&" : "?"}c=${shotCacheWindow()}`;
  } catch {
    return null;
  }
}

function lastSendIndex({ proofRows = [], emailLogRows = [] } = {}) {
  const index = new Map();
  const remember = (id, when, kind) => {
    const key = text(id);
    const at = text(when);
    if (!key || !at) return;
    const previous = index.get(key);
    if (previous && Date.parse(previous.when) >= Date.parse(at)) return;
    index.set(key, { when: at, kind });
  };
  for (const row of proofRows || []) remember(row && row.prospect_id, row && row.created_at, "proof");
  for (const row of emailLogRows || []) {
    // An owner-proof email_log row is the operator's own proof delivery, not
    // a business contact — label it "proof" so the card says "Proof emailed
    // to you", never "Emailed the business".
    remember(row && row.prospect_id, row && row.sent_at, isOwnerProofEmailRecord(row) ? "proof" : "business");
  }
  return index;
}

function safeGalleryRow(row = {}, signVisual = signedVisualPath, lastSends = new Map()) {
  const record = recordOf(row);
  const previewUrl = text(record.preview_url || record.previewUrl || row.preview_url);
  const status = text(row.status || record.status || "unknown");
  const prospectId = text(row.prospect_id || record.prospect_id);
  const lastSend = lastSends instanceof Map ? lastSends.get(prospectId) : null;
  const campaign = text(
    row.campaign_name
    || row.campaign
    || row.campaign_id
    || row.batch_id
    || record.campaign_name
    || record.campaign
    || record.campaign_id
    || record.batch_id,
  );

  return {
    prospectId,
    businessName: text(record.business_name || record.businessName || row.business_name),
    city: text(record.city || row.city),
    state: text(record.state || row.state),
    vertical: text(record.vertical || record.industry || row.industry),
    status,
    previewUrl,
    reportUrl: text(record.report_url || record.reportUrl || row.report_url),
    shotUrl: safeShotUrl(previewUrl, signVisual),
    archived: status.toLowerCase() === "archived_legacy",
    // Prospect rows are display records, not release authority. A stale
    // preview_url or status here must never mint an owner-proof send button.
    // Only the matching durable Line row below may make a build sendable.
    sendable: false,
    lastSentAt: lastSend ? lastSend.when : "",
    lastSentKind: lastSend ? lastSend.kind : "",
    updatedAt: text(row.updated_at || record.updated_at),
    campaign,
  };
}

const LINE_SENDABLE = new Set(["ready", "queued", "sent"]);

// batch_id -> { status, haltReason }, first row wins (newest-first query). A
// missing batch is not an error — the row simply has no batch state to show.
function batchStateIndex(rows) {
  const index = new Map();
  for (const row of rows || []) {
    const id = text(row && row.batch_id);
    if (!id || index.has(id)) continue;
    index.set(id, { status: text(row && row.status), haltReason: text(row && row.halt_reason) });
  }
  return index;
}

function verifiedLineRelease(payload = {}, previewUrl = "") {
  return lineReleaseInput(payload, previewUrl);
}

// An ISO stamp off the batch's timing record, or "" — an absent or unparseable
// moment contributes nothing rather than an "Invalid Date" on the owner screen.
function timingStamp(timing, field) {
  const iso = text(timing && timing[field]);
  return Date.parse(iso) >= 0 ? iso : "";
}

// The newest ACTIVE batch's own stopwatch, as the small object the gallery
// clock strip renders. Null whenever there is nothing measured to say: no
// batch, no mine_funnel, or no stamped startedAt (every legacy batch and
// every lane that never stamped one). sentCount is counted from the same
// durable Line rows the cards already read, scoped to this batch alone.
function campaignTimingDecoration(batchRow, lineRows = []) {
  if (!batchRow || typeof batchRow !== "object") return null;
  const funnel = Array.isArray(batchRow.mine_funnel) ? batchRow.mine_funnel : [];
  const timing = funnel.find((row) => (
    row && typeof row === "object" && !Array.isArray(row)
    && String(row.stage || "") === CAMPAIGN_TIMING_STAGE
  )) || null;
  const startedAt = timingStamp(timing, "startedAt");
  if (!startedAt) return null;
  const batchId = text(batchRow.batch_id);
  const sentCount = (Array.isArray(lineRows) ? lineRows : [])
    .filter((row) => text(row && row.batch_id) === batchId && text(row && row.status) === "sent")
    .length;
  return {
    batchId,
    status: text(batchRow.status),
    startedAt,
    firstQualifiedAt: timingStamp(timing, "firstQualifiedAt"),
    firstBuiltAt: timingStamp(timing, "firstBuiltAt"),
    firstGateAt: timingStamp(timing, "firstGateAt"),
    firstSentAt: timingStamp(timing, "firstSentAt"),
    sentCount,
    requested: Math.max(0, Number(batchRow.requested) || 0),
  };
}

function safeLineGalleryRow(row = {}, signVisual = signedVisualPath, lastSends = new Map(), batches = new Map()) {
  const payload = objectOf(row.payload);
  const previewUrl = text(payload.previewUrl || payload.preview_url);
  const prospectId = text(payload.prospectId || payload.prospect_id);
  if (!previewUrl || !prospectId) return null;
  const status = text(row.status || payload.status || "mirrored");
  const release = verifiedLineRelease(payload, previewUrl);
  const lastSend = lastSends instanceof Map ? lastSends.get(prospectId) : null;
  const batch = batches instanceof Map ? batches.get(text(row.batch_id)) : null;
  return {
    prospectId,
    businessName: text(payload.businessName || payload.business_name),
    city: text(payload.city),
    state: text(payload.state),
    vertical: text(payload.vertical || payload.industry),
    status,
    previewUrl,
    reportUrl: text(payload.reportUrl || payload.report_url),
    shotUrl: safeShotUrl(previewUrl, signVisual),
    archived: false,
    // gate_passed is intentionally not enough: writePreviewUrl is the next
    // phase. Owner-proof email only appears once that write has durably finished.
    sendable: Boolean(sanitizePreviewUrl(previewUrl)) && LINE_SENDABLE.has(status) && Boolean(release),
    lastSentAt: lastSend ? lastSend.when : "",
    lastSentKind: lastSend ? lastSend.kind : "",
    updatedAt: text(row.updated_at || payload.updatedAt || payload.updated_at),
    campaign: text(row.batch_id || payload.batchId || payload.batch_id),
    buildHash: release?.buildHash || "",
    // The batch's own durable state, so the card can say WHY a built site is
    // not emailing: "batch halted — superseded by a newer run", not silence.
    batchState: batch ? batch.status : "",
    batchHaltReason: batch ? batch.haltReason : "",
    lineOnly: true,
  };
}

function mergeBuildRows(prospectRows = [], lineRows = []) {
  const out = [];
  const keys = new Map();
  const add = (row, source = "prospect") => {
    if (!row || !row.previewUrl) return;
    const key = `${text(row.prospectId)}|${text(row.previewUrl).toLowerCase()}`;
    if (!key || key === "|") return;
    const index = keys.get(key);
    if (index === undefined) {
      keys.set(key, out.length);
      out.push(row);
      return;
    }
    if (source === "prospect") {
      const line = out[index];
      // The prospect table may fill display-only gaps. The durable Line row
      // remains the authority for artifact identity, state, sendability,
      // batch, and timestamp.
      out[index] = {
        ...row,
        ...line,
        businessName: line.businessName || row.businessName,
        city: line.city || row.city,
        state: line.state || row.state,
        vertical: line.vertical || row.vertical,
        reportUrl: line.reportUrl || row.reportUrl,
        shotUrl: line.shotUrl || row.shotUrl,
        lastSentAt: row.lastSentAt || line.lastSentAt,
        lastSentKind: row.lastSentKind || line.lastSentKind,
        lineOnly: false,
      };
    }
  };
  for (const row of lineRows) add(row, "line");
  for (const row of prospectRows) add(row, "prospect");
  return out.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

function paidAccessSets(rows) {
  const siteSlugs = new Set();
  const ownerEmails = new Set();

  for (const row of rows || []) {
    const jobId = text(row && row.job_id);
    if (!jobId || jobId.toLowerCase().startsWith("prospect-")) continue;

    const siteSlug = text(row.site_slug).toLowerCase();
    const ownerEmail = text(row.owner_email).toLowerCase();
    if (siteSlug) siteSlugs.add(siteSlug);
    if (ownerEmail) ownerEmails.add(ownerEmail);
  }

  return { siteSlugs, ownerEmails };
}

function isPaidClient(row, safeRow, paid) {
  const record = recordOf(row);
  const siteSlugs = [
    row.site_slug,
    prospectSiteSlug({ ...row, preview_url: safeRow.previewUrl }),
    safeRow.businessName ? slugify(safeRow.businessName) : "",
    row.desired_domain ? slugify(row.desired_domain) : "",
  ].map((value) => text(value).toLowerCase()).filter(Boolean);
  const ownerEmails = [row.owner_email, record.owner_email, record.ownerEmail]
    .map((value) => text(value).toLowerCase())
    .filter(Boolean);

  return siteSlugs.some((siteSlug) => paid.siteSlugs.has(siteSlug))
    || ownerEmails.some((ownerEmail) => paid.ownerEmails.has(ownerEmail));
}

function newestFirst(left, right) {
  const leftTime = Date.parse(left && left.updated_at) || 0;
  const rightTime = Date.parse(right && right.updated_at) || 0;
  return rightTime - leftTime;
}

function sourceUnavailable() {
  const error = new Error("Gallery source data is temporarily unavailable.");
  error.statusCode = 503;
  error.code = "gallery_source_unavailable";
  return error;
}

function createGalleryDataHandler(overrides = {}) {
  const selectRows = overrides.select || select;
  const signVisual = overrides.signedVisualPath || signedVisualPath;
  const routing = overrides.ownerProofRouting || ownerProofRouting;
  const env = overrides.env || process.env;
  const bankCensus = overrides.bankCountsByVertical || bankCountsByVertical;

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["GET"])) return;
    if (!requireAdmin(req, res)) return;

    try {
      const [prospectsResult, lineResult, lineBatchResult, accessResult, proofResult, emailLogResult, timingResult, bankResult] = await Promise.all([
        selectRows(PROSPECTS, `?${PROSPECT_QUERY}`),
        Promise.resolve(selectRows(LINE_ROWS, `?${LINE_ROW_QUERY}`)).catch(() => ({ ok: false, data: [] })),
        // Batch state is annotation, never a dependency: a failed read leaves
        // the cards standing with no batch line, exactly as before this read.
        Promise.resolve(selectRows(LINE_BATCHES, `?${LINE_BATCH_QUERY}`)).catch(() => ({ ok: false, data: [] })),
        selectRows(DASHBOARD_ACCESS, `?${ACCESS_QUERY}`),
        Promise.resolve(selectRows(EVENTS, `?${PROOF_EVENT_QUERY}`)).catch(() => ({ ok: false })),
        Promise.resolve(selectRows(EMAIL_LOG, `?${EMAIL_LOG_QUERY}`)).catch(() => ({ ok: false })),
        // The campaign clock is the same kind of annotation: one active batch,
        // one stopwatch. A failed read hides the strip, nothing else.
        Promise.resolve(selectRows(LINE_BATCHES, `?${CAMPAIGN_TIMING_QUERY}`)).catch(() => ({ ok: false, data: [] })),
        // PROSPECT BANK census — small, read-only, annotation only: a failed
        // read leaves the gallery exactly as it was, with bankRead:false.
        Promise.resolve(bankCensus({ deps: { select: selectRows } })).catch(() => ({ ok: false, byVertical: {}, total: 0 })),
      ]);

      if (prospectsResult?.ok !== true || !Array.isArray(prospectsResult.data)
        || accessResult?.ok !== true || !Array.isArray(accessResult.data)) {
        throw sourceUnavailable();
      }

      const proofRead = proofResult?.ok === true && Array.isArray(proofResult.data);
      const emailLogRead = emailLogResult?.ok === true && Array.isArray(emailLogResult.data);
      const lineRead = lineResult?.ok === true && Array.isArray(lineResult.data);
      const lineBatchRead = lineBatchResult?.ok === true && Array.isArray(lineBatchResult.data);
      const timingRead = timingResult?.ok === true && Array.isArray(timingResult.data);
      const lastSends = lastSendIndex({
        proofRows: proofRead ? proofResult.data : [],
        emailLogRows: emailLogRead ? emailLogResult.data : [],
      });
      const batches = batchStateIndex(lineBatchRead ? lineBatchResult.data : []);

      const paid = paidAccessSets(accessResult.data);
      const preparedProspects = prospectsResult.data
        .slice()
        .sort(newestFirst)
        .slice(0, MAX_BUILDS)
        .map((row) => ({ row, safe: safeGalleryRow(row, signVisual, lastSends) }))
        .filter(({ safe }) => Boolean(safe.previewUrl));
      const preparedLine = lineRead
        ? lineResult.data.map((row) => safeLineGalleryRow(row, signVisual, lastSends, batches)).filter(Boolean)
        : [];
      const builds = mergeBuildRows(preparedProspects.map(({ safe }) => safe), preparedLine).slice(0, MAX_BUILDS);

      const campaignTiming = campaignTimingDecoration(
        timingRead ? timingResult.data[0] : null,
        lineRead ? lineResult.data : [],
      );

      sendJson(res, 200, {
        ok: true,
        clients: preparedProspects
          .filter(({ row, safe }) => !safe.archived && isPaidClient(row, safe, paid))
          .map(({ safe }) => safe),
        builds,
        send: routing(env),
        // Present only when the newest active batch carries a stamped
        // stopwatch; the page hides its clock strip entirely otherwise.
        ...(campaignTiming ? { campaignTiming } : {}),
        // PROSPECT BANK: drawable-lead census per vertical (banked rows only —
        // reserved/exhausted are working capital, not inventory).
        bank: {
          byVertical: bankResult?.ok === true ? bankResult.byVertical : {},
          total: bankResult?.ok === true ? bankResult.total : 0,
        },
        sources: { proofHistoryRead: proofRead, sendHistoryRead: emailLogRead, lineHistoryRead: lineRead, batchStateRead: lineBatchRead, campaignTimingRead: timingRead, bankRead: bankResult?.ok === true },
      });
    } catch (error) {
      handleError(res, error);
    }
  };
}

module.exports = createGalleryDataHandler();
module.exports.createGalleryDataHandler = createGalleryDataHandler;
module.exports.lastSendIndex = lastSendIndex;
module.exports.safeGalleryRow = safeGalleryRow;
module.exports.safeLineGalleryRow = safeLineGalleryRow;
module.exports.verifiedLineRelease = verifiedLineRelease;
module.exports.mergeBuildRows = mergeBuildRows;
module.exports.batchStateIndex = batchStateIndex;
module.exports.campaignTimingDecoration = campaignTimingDecoration;
module.exports.shotCacheWindow = shotCacheWindow;
