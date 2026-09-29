"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { sendSequenceStep } = require("../../lib/email");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { select } = require("../../lib/store");
const {
  DRAFT_COUNT,
  HOLD_KEY,
  createHeldDraftQueue,
  phaseOneReleaseEvidence,
} = require("../../lib/supervised-held-drafts");

function first(row = {}, names = []) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  for (const name of names) {
    const found = row[name] ?? record[name];
    if (found !== undefined && found !== null && String(found).trim()) return found;
  }
  return "";
}

function callprepBase() {
  try {
    const url = new URL(String(process.env.CALLPREP_SUPABASE_URL || "").trim());
    return url.protocol === "https:" ? `${url.origin}/rest/v1` : "";
  } catch {
    return "";
  }
}

const CALLPREP_REPORT_SELECT = [
  "id",
  "business_report_id",
  "business_name",
  "input_value",
  "overall_score",
  "overall_grade",
  "data_mode",
  "report_data",
  "created_at",
  "report:business_reports!scan_history_business_report_id_fkey(id,business_name,business_url,overall_score,overall_grade,report_generated_at,expires_at,created_at,data_availability,website_metrics)",
].join(",");
const REPORT_SCAN_MAX_SKEW_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizedWebsite(value) {
  const raw = String(value || "").trim();
  if (!raw || /[\s@]/.test(raw)) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!hostname || !hostname.includes(".")) return null;
    const pathname = `/${String(parsed.pathname || "/").split("/").filter(Boolean).join("/")}`;
    return { hostname, pathname: pathname === "/" ? "/" : pathname };
  } catch {
    return null;
  }
}

function canonicalHostname(value) {
  return normalizedWebsite(value)?.hostname || "";
}

function websiteInputVariants(value) {
  const parsed = normalizedWebsite(value);
  if (!parsed) return [];
  const hosts = [parsed.hostname, `www.${parsed.hostname}`];
  const paths = parsed.pathname === "/" ? ["/"] : [parsed.pathname, "/"];
  const variants = new Set();
  for (const host of hosts) {
    for (const path of paths) {
      const withoutTrailingSlash = path === "/" ? "" : path.replace(/\/+$/, "");
      for (const scheme of ["https", "http"]) {
        variants.add(`${scheme}://${host}${withoutTrailingSlash}`);
        variants.add(`${scheme}://${host}${withoutTrailingSlash}/`);
      }
      variants.add(`${host}${withoutTrailingSlash}`);
      variants.add(`${host}${withoutTrailingSlash}/`);
    }
  }
  return [...variants].filter(Boolean);
}

function storedBusinessReportId(row = {}) {
  return String(first(row, [
    "business_report_id",
    "businessReportId",
    "callprep_business_report_id",
    "callprepBusinessReportId",
  ])).trim();
}

function prospectWebsite(row = {}) {
  return String(first(row, [
    "current_website",
    "currentWebsite",
    "website",
    "website_url",
    "websiteUrl",
  ])).trim();
}

function postgrestQuoted(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function fetchCallPrepRows({ businessReportId = "", website = "", fetchImpl = fetch } = {}) {
  const base = callprepBase();
  const key = String(process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!base || !key) return { configured: false, rows: [] };
  const params = new URLSearchParams({
    select: CALLPREP_REPORT_SELECT,
    order: "created_at.desc",
    limit: "25",
  });
  if (businessReportId) {
    params.set("business_report_id", `eq.${businessReportId}`);
  } else {
    const variants = websiteInputVariants(website);
    if (!variants.length) return { configured: true, rows: [] };
    params.set("input_value", `in.(${variants.map(postgrestQuoted).join(",")})`);
  }
  try {
    const response = await fetchImpl(`${base}/scan_history?${params}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!response.ok) return { configured: true, rows: [] };
    const rows = await response.json().catch(() => []);
    return { configured: true, rows: Array.isArray(rows) ? rows : [] };
  } catch {
    return { configured: true, rows: [] };
  }
}

function reportFromRow(row = {}) {
  if (Array.isArray(row.report)) return row.report[0] || null;
  return row.report && typeof row.report === "object" ? row.report : null;
}

function normalizeGrade(value) {
  const grade = String(value || "").trim().toUpperCase();
  return /^[A-F][+-]?$/.test(grade) ? grade : "";
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function explicitFalse(value) {
  return value === false || String(value).trim().toLowerCase() === "false";
}

function hasMeasuredEvidence(report = {}) {
  const availability = report.data_availability && typeof report.data_availability === "object"
    ? report.data_availability
    : {};
  const metrics = report.website_metrics && typeof report.website_metrics === "object"
    ? report.website_metrics
    : {};
  const availabilityMeasured = [
    availability.website,
    availability.websitePerformance,
  ].some((value) => String(value || "").toLowerCase() === "measured");
  const metricsMeasured = String(metrics.availability || "").toLowerCase() === "measured";
  const metricEvidence = Object.entries(metrics).some(([key, value]) => (
    key !== "availability" && key !== "error" && value !== null && value !== ""
  ));
  return availabilityMeasured && metricsMeasured && metricEvidence;
}

function validateGradeRecord(row = {}, prospect = {}, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const report = reportFromRow(row);
  const expectedName = normalizeIdentity(first(prospect, ["business_name", "businessName", "name"]));
  const expectedHost = canonicalHostname(prospectWebsite(prospect));
  if (!report || !row.business_report_id || String(report.id || "") !== String(row.business_report_id)) return null;
  if (!expectedName || !expectedHost) return null;

  const reportData = row.report_data && typeof row.report_data === "object" ? row.report_data : {};
  const identityNames = [row.business_name, report.business_name];
  if (reportData.businessName) identityNames.push(reportData.businessName);
  if (identityNames.some((value) => normalizeIdentity(value) !== expectedName)) return null;

  const identityUrls = [row.input_value, report.business_url];
  if (reportData.inputValue) identityUrls.push(reportData.inputValue);
  if (reportData.resolvedWebsiteUrl) identityUrls.push(reportData.resolvedWebsiteUrl);
  if (identityUrls.some((value) => canonicalHostname(value) !== expectedHost)) return null;
  if (!explicitFalse(reportData.entityMismatch) || !explicitFalse(reportData.lowConfidenceMatch)) return null;

  const mode = String(row.data_mode || reportData.dataMode || "").trim().toLowerCase();
  const payloadMode = String(reportData.dataMode || mode).trim().toLowerCase();
  if (!["blended", "live", "measured"].includes(mode) || payloadMode !== mode || !hasMeasuredEvidence(report)) return null;

  const grade = normalizeGrade(row.overall_grade);
  if (!grade || normalizeGrade(report.overall_grade) !== grade || normalizeGrade(reportData.overallGrade) !== grade) return null;
  const scanScore = numberOrNull(row.overall_score);
  const reportScore = numberOrNull(report.overall_score);
  const payloadScore = numberOrNull(reportData.overallScore);
  if (scanScore === null || reportScore !== scanScore || payloadScore !== scanScore) return null;

  const scanAt = Date.parse(String(row.created_at || ""));
  const reportAt = Date.parse(String(report.report_generated_at || report.created_at || ""));
  const expiresAt = Date.parse(String(report.expires_at || ""));
  if (![scanAt, reportAt, expiresAt, nowMs].every(Number.isFinite)) return null;
  if (scanAt > nowMs + CLOCK_SKEW_MS || reportAt > nowMs + CLOCK_SKEW_MS || expiresAt <= nowMs) return null;
  if (Math.abs(scanAt - reportAt) > REPORT_SCAN_MAX_SKEW_MS) return null;
  return { grade, createdAt: scanAt, businessReportId: String(row.business_report_id) };
}

async function latestGrade(prospect = {}, options = {}) {
  const base = callprepBase();
  const key = String(process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!base || !key) return { configured: false, grade: "" };
  const businessReportId = storedBusinessReportId(prospect);
  if (businessReportId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessReportId)) {
    return { configured: true, grade: "" };
  }
  const found = await fetchCallPrepRows({
    businessReportId,
    website: prospectWebsite(prospect),
    fetchImpl: options.fetchImpl || fetch,
  });
  const valid = found.rows
    .map((row) => validateGradeRecord(row, prospect, { nowMs: options.nowMs }))
    .filter(Boolean)
    .sort((left, right) => right.createdAt - left.createdAt);
  return { configured: found.configured, grade: valid[0]?.grade || "" };
}

function highConfidenceSource(row = {}) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  const source = String(first(row, ["source"])).toLowerCase();
  const truthSource = String(record.truth_packet_source || "").toLowerCase();
  const enrichmentStatus = String(record.enrichment_status || "").toLowerCase();
  return Boolean(first(row, ["email", "owner_email", "ownerEmail"]))
    && Boolean(first(row, ["current_website", "currentWebsite", "website"]))
    && (source === "places-live-mine" || truthSource === "places_basic" || enrichmentStatus === "email_found");
}

function uniqueCandidates(rows = []) {
  const emails = new Set();
  return rows.filter((row) => {
    const email = String(first(row, ["email", "owner_email", "ownerEmail"])).trim().toLowerCase();
    if (!email || emails.has(email)) return false;
    emails.add(email);
    return true;
  });
}

function mixedVerticalOrder(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(first(row, ["industry", "vertical", "batch_category"]) || "other").toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const ordered = [];
  while ([...groups.values()].some((group) => group.length)) {
    for (const group of groups.values()) if (group.length) ordered.push(group.shift());
  }
  return ordered;
}

async function buildReviewSet(rows = [], options = {}) {
  const candidates = uniqueCandidates(rows).filter((row) => highConfidenceSource(row));
  const evidenceEvaluated = candidates.map((row) => ({ row, release: phaseOneReleaseEvidence(row) }));
  const shaped = evidenceEvaluated.filter((item) => item.release.preview_url);
  const eligibleShape = shaped.filter((item) => item.release.ok);
  const withGrades = await Promise.all(eligibleShape.map(async (row) => {
    const businessName = String(first(row.row, ["business_name", "businessName", "name"])).trim();
    const grade = await latestGrade(row.row, options);
    return {
      ...row.row,
      business_name: businessName,
      email: String(first(row.row, ["email", "owner_email", "ownerEmail"])).trim().toLowerCase(),
      preview_url: row.release.preview_url,
      report_url: row.release.report_url,
      industry: String(first(row.row, ["industry", "vertical", "batch_category"]) || "other").trim(),
      high_confidence: true,
      getfound_grade: grade.grade,
      _gradeConfigured: grade.configured,
    };
  }));
  const qualified = withGrades.filter((row) => row.getfound_grade);
  return {
    shaped: shaped.length,
    releaseReady: eligibleShape.length,
    rejected: evidenceEvaluated
      .filter((item) => !item.release.ok)
      .map((item) => ({
        prospectId: String(first(item.row, ["prospect_id", "prospectId", "id"])).trim() || null,
        failures: item.release.failures,
      })),
    gradeConfigured: withGrades.some((row) => row._gradeConfigured),
    qualified: options.preserveOrder ? qualified : mixedVerticalOrder(qualified),
  };
}

function parseRequestedProspectIds(body = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, "prospectIds")) return null;
  if (!Array.isArray(body.prospectIds)) return { error: "prospect_ids_must_be_an_array" };
  const ids = body.prospectIds.map((item) => typeof item === "string" ? item.trim() : "");
  const unique = new Set(ids);
  if (ids.length !== DRAFT_COUNT || unique.size !== DRAFT_COUNT || ids.some((id) => !id || id.length > 200)) {
    return { error: "requires_exactly_10_unique_prospect_ids" };
  }
  return { ids };
}

function rowsForRequestedIds(rows = [], ids = []) {
  const byId = new Map(rows.map((row) => [String(first(row, ["prospect_id", "prospectId", "id"])).trim(), row]));
  const missing = ids.filter((id) => !byId.has(id));
  return { missing, rows: missing.length ? [] : ids.map((id) => byId.get(id)) };
}

async function composeOutreachDraft({ prospect, dryRun }) {
  if (dryRun !== true) return { ok: false, blocked: "held_drafts_require_dry_run" };
  const result = await sendSequenceStep({
    prospect,
    sequence: 1,
    step: 1,
    dryRun: true,
    persistCampaignLog: false,
    vars: {
      report_url: first(prospect, ["report_url", "reportUrl"]),
      preview_url: first(prospect, ["preview_url", "previewUrl"]),
      checkout_url: first(prospect, ["checkout_url", "checkoutUrl"]),
      sunset_date: first(prospect, ["preview_expires_at", "previewExpiresAt", "sunset_date", "sunsetDate"]),
      getfound_grade: first(prospect, ["getfound_grade", "getFoundGrade"]),
    },
  });
  if (!result || result.ok !== true || result.mode !== "dry_run") {
    return { ok: false, blocked: result?.blocked || "outreach_compose_path_failed" };
  }
  return {
    ok: true,
    mode: result.mode,
    composePath: "email.sendSequenceStep",
    subject: result.subject,
    body: result.bodyPreview || result.previewText,
    htmlPreview: result.htmlPreview,
  };
}

async function loadCurrentHeldDrafts(prospectRows = []) {
  let found;
  try {
    found = await select(
      "ghost_agency_outbound_review_drafts",
      `?select=draft_id,prospect_id,subject,body,approval_status,created_at&hold_key=eq.${encodeURIComponent(HOLD_KEY)}&order=created_at.asc&limit=${DRAFT_COUNT + 1}`,
    );
  } catch {
    found = null;
  }
  if (!found?.ok || !Array.isArray(found.data)) {
    return {
      draftsAvailable: false,
      reason: String(found?.error?.code || found?.skipped || "held_draft_store_unavailable"),
      drafts: [],
    };
  }

  const names = new Map(prospectRows.map((row) => [
    String(first(row, ["prospect_id", "prospectId", "id"])).trim(),
    String(first(row, ["business_name", "businessName", "name"])).trim(),
  ]));
  return {
    draftsAvailable: true,
    reason: "",
    drafts: found.data.map((row) => {
      const prospectId = String(row.prospect_id || "").trim();
      return {
        draftId: String(row.draft_id || "").trim(),
        prospectId,
        businessName: names.get(prospectId) || "Unknown business",
        subject: String(row.subject || ""),
        body: String(row.body || ""),
        approvalStatus: String(row.approval_status || ""),
        createdAt: row.created_at || null,
      };
    }),
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.method === "POST" ? await readJson(req).catch(() => ({})) : {};
    const found = await select("ghost_agency_prospects", "?select=*&order=updated_at.desc&limit=500");
    if (!found.ok || !Array.isArray(found.data)) {
      sendJson(res, 503, { ok: false, error: "prospect_store_unavailable" });
      return;
    }
    const requested = parseRequestedProspectIds(body);
    if (requested?.error) {
      sendJson(res, 400, { ok: false, status: "held", reason: requested.error, sendsPerformed: 0 });
      return;
    }
    let candidateRows = found.data;
    if (requested?.ids) {
      const selected = rowsForRequestedIds(found.data, requested.ids);
      if (selected.missing.length) {
        sendJson(res, 404, {
          ok: false,
          status: "held",
          reason: "requested_prospect_ids_not_found",
          missingProspectIds: selected.missing,
          sendsPerformed: 0,
        });
        return;
      }
      candidateRows = selected.rows;
    }
    const reviewSet = await buildReviewSet(candidateRows, { preserveOrder: Boolean(requested?.ids) });
    const counts = {
      totalProspects: found.data.length,
      highConfidenceWithPreview: reviewSet.shaped,
      releaseReady: reviewSet.releaseReady,
      withRealGetFoundGrade: reviewSet.qualified.length,
      required: DRAFT_COUNT,
    };
    if (body.stage !== true) {
      const heldDrafts = req.method === "GET" ? await loadCurrentHeldDrafts(found.data) : null;
      sendJson(res, 200, {
        ok: true,
        status: "preview_only",
        counts,
        gradeSourceConfigured: reviewSet.gradeConfigured,
        holdKey: "supervised_10_review_pending",
        sendsPerformed: 0,
        ...(heldDrafts || {}),
      });
      return;
    }
    if (reviewSet.qualified.length < DRAFT_COUNT) {
      sendJson(res, 422, {
        ok: false,
        status: "held",
        reason: "insufficient_qualified_prospects",
        counts,
        rejected: reviewSet.rejected,
        message: "No drafts were staged because the exact ten do not all have durable release evidence, a high-confidence public email, and a real GetFound grade.",
        sendsPerformed: 0,
      });
      return;
    }
    const result = await createHeldDraftQueue(
      { prospects: reviewSet.qualified.slice(0, DRAFT_COUNT) },
      { compose: composeOutreachDraft },
    );
    sendJson(res, result.ok ? 200 : 422, { ...result, counts, sendsPerformed: 0 });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.buildReviewSet = buildReviewSet;
module.exports.canonicalHostname = canonicalHostname;
module.exports.composeOutreachDraft = composeOutreachDraft;
module.exports.fetchCallPrepRows = fetchCallPrepRows;
module.exports.highConfidenceSource = highConfidenceSource;
module.exports.latestGrade = latestGrade;
module.exports.loadCurrentHeldDrafts = loadCurrentHeldDrafts;
module.exports.normalizeIdentity = normalizeIdentity;
module.exports.parseRequestedProspectIds = parseRequestedProspectIds;
module.exports.rowsForRequestedIds = rowsForRequestedIds;
module.exports.validateGradeRecord = validateGradeRecord;
module.exports.websiteInputVariants = websiteInputVariants;
