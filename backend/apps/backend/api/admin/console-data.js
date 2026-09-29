"use strict";

// Admin-gated JSON aggregator that powers the live operator console.
// Read-only. Joins prospects + email_log + events into a single snapshot.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { providerStatus } = require("../../lib/registry");
const { outreachFromStatus } = require("../../lib/env-compat");
const { outreachDnsStatus } = require("../../lib/outreach-dns");
const { select, selectRows } = require("../../lib/store");
const { reviewHoldActive } = require("../../lib/email");
const { deliveryPauseStatus } = require("../../lib/delivery-pause");
const { actionableBlockers: buildActionableBlockers } = require("../../lib/actionable-blockers");
const { AGENTS, agentTelemetry } = require("../../lib/agent-telemetry");
const { siteforgeQcEvidence } = require("../../lib/siteforge-qc-evidence");
const { buildableVerticals } = require("../../lib/buildable-verticals");
const fs = require("node:fs");
const path = require("node:path");
const { reconcileTrackingTruth } = require("../../lib/tracking-truth");
const { isOwnerProofEmailRecord } = require("../../lib/prospect-detail");
const { identityCounters } = require("../../lib/prospect-identity");
const { contactSendGate } = require("../../lib/contact-enrichment");

const SENDABLE = ["previewed", "packeted", "reported"];
const DRIP_HOURS_UTC = [16, 20];
const DRIP_DOW = [2, 3, 4]; // Tue-Thu
const CONSOLE_TABLES = Object.freeze({
  prospects: "ghost_agency_console_prospects_v1",
  emails: "ghost_agency_console_email_log_v1",
  events: "ghost_agency_console_events_v1",
});
const PROSPECT_SELECT = [
  "prospect_id", "status", "business_name", "email", "owner_email", "phone",
  "current_website", "industry", "city", "state", "leadminer_score", "preview_url",
  "source", "updated_at", "canonical_prospect_id", "merged_into_prospect_id",
  "record", "root_extras",
].join(",");
const EMAIL_SELECT = "prospect_id,sequence,step,sent_at,suppressed,mode,payload";
const EVENT_SELECT = "id,type,created_at,payload,root_extras";
const AGENT_SELECT = "type,created_at,payload";
const SNAPSHOT_TTL_MS = 3_000;
const SNAPSHOT_STALE_MS = 30_000;

// Optional read-only view of the separate Render V2 catalog. An adapted donor
// is mapped, but is not launch-ready until its runtime and visual checks pass.
function mappedV2Verticals({ catalogPath = process.env.WSS_V2_CATALOG_PATH } = {}) {
  if (!catalogPath) return { available: false, verticals: [] };
  let catalog;
  try { catalog = JSON.parse(fs.readFileSync(path.resolve(catalogPath), "utf8")); }
  catch { return { available: false, verticals: [] }; }
  if (catalog?.schema !== "wss-donor-catalog-v2" || !Array.isArray(catalog.donors)) {
    return { available: false, verticals: [] };
  }
  const groups = new Map();
  for (const donor of catalog.donors) {
    if (donor?.implementation_status !== "WSS_ADAPTED") continue;
    const vertical = String(donor.vertical || "").trim().toLowerCase();
    if (!vertical || !/^[a-z][a-z\s-]{1,79}$/.test(vertical)) continue;
    const row = groups.get(vertical) || { vertical, label: vertical.replace(/\b\w/g, c => c.toUpperCase()), donors: 0, readyDonors: 0 };
    row.donors += 1;
    if (donor.source_import_verified === true && donor.client_bindings_verified === true &&
        donor.runtime_eligible === true && donor.visual_parity_verified === true &&
        /^[a-f0-9]{40}$/i.test(donor.source_commit || "") &&
        /^[a-f0-9]{64}$/i.test(donor.source_tree_sha256 || "") &&
        /^[a-f0-9]{64}$/i.test(donor.bundle || "")) row.readyDonors += 1;
    groups.set(vertical, row);
  }
  return { available: true, verticals: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)) };
}
let sourceRowsCache = null;
let sourceRowsInFlight = null;

function boundedDuration(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function snapshotLimits() {
  const ttl = boundedDuration(
    process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_TTL_MS,
    SNAPSHOT_TTL_MS,
    250,
    15_000,
  );
  const stale = boundedDuration(
    process.env.GHOST_AGENCY_CONSOLE_SNAPSHOT_STALE_MS,
    SNAPSHOT_STALE_MS,
    ttl,
    120_000,
  );
  return { ttl, stale };
}

function restoreRootExtras(row) {
  const restored = { ...row };
  const extras = row?.root_extras;
  if (extras && typeof extras === "object" && !Array.isArray(extras)) {
    Object.assign(restored, extras);
  }
  delete restored.root_extras;
  return restored;
}

function restoreRows(result) {
  if (!result || !Array.isArray(result.rows)) return result;
  return { ...result, rows: result.rows.map(restoreRootExtras) };
}

function schemaUnavailable(result) {
  if (!result || result.mode !== "live_select_failed") return false;
  const code = String(result.error?.code || "").toUpperCase();
  return [400, 404].includes(Number(result.status)) || ["42P01", "PGRST205"].includes(code);
}

// Only the CORE sources can fail the snapshot. Prospects, emails and events are
// what the dashboard is; without them a render would be actively misleading, so
// refusing is right.
//
// Agent activity is a secondary panel, and treating it as fatal took the whole
// command center down for an hour on 2026-07-29: its query timed out at the
// 8s store read limit, so a decorative section blacked out every number the
// owner runs the business on. A degraded agents panel is not a wrong dashboard.
// Same reasoning for the delivery-pause probe, which has its own explicit
// unknown state the UI already renders.
function sourceRowsFailed([prospects, emails, events]) {
  return [prospects, emails, events].some((result) => result?.mode === "live_select_failed");
}

function sourceSnapshotUnavailable() {
  const error = new Error("Console source snapshot is temporarily unavailable");
  error.code = "console_source_snapshot_unavailable";
  error.statusCode = 503;
  return error;
}

// The agent-activity query filters on a column with no index, then sorts the
// whole matching set by created_at. That is a full scan + sort, and it grows
// without bound as the events table does. It served 376 requests on 2026-07-29
// and then started timing out inside Postgres the moment a heavy build/send
// window (five site builds, two full-run batches, four 300s forge-job timeouts,
// each writing progress events) pushed the table over the edge. Every read
// after that failed, so the snapshot guard correctly refused to serve a partial
// dashboard and the console returned 503 for an hour.
//
// A time bound lets the created_at index do the work instead. The console only
// renders recent agent activity, so older rows were being read and discarded.
// Bound it here rather than raising limits or timeouts — this query must stay
// cheap forever, not just until the table grows again.
// 14 days was not enough: the flood of rows is itself recent, and because only
// a few events carry `actor`, Postgres walks a long way back hunting 1000
// matches. Two days plus a much smaller limit keeps the scan short. The console
// renders a handful of agent rows; 1000 was never needed.
function recentEventsFloorIso(days = 2) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
const AGENT_EVENT_LIMIT = 200;

async function compactSourceRows() {
  const since = encodeURIComponent(recentEventsFloorIso());
  const compact = await Promise.all([
    selectRows(CONSOLE_TABLES.prospects, { select: PROSPECT_SELECT, order: "updated_at.desc", limit: 500 }),
    selectRows(CONSOLE_TABLES.emails, { select: EMAIL_SELECT, order: "sent_at.desc", limit: 500 }),
    selectRows(CONSOLE_TABLES.events, { select: EVENT_SELECT, order: "created_at.desc", limit: 300 }),
    select(CONSOLE_TABLES.events, `?select=${AGENT_SELECT}&actor=not.is.null&created_at=gte.${since}&order=created_at.desc&limit=${AGENT_EVENT_LIMIT}`),
    deliveryPauseStatus(),
  ]);
  if (compact.slice(0, 4).some(schemaUnavailable)) {
    const legacy = await Promise.all([
      selectRows("ghost_agency_prospects", { order: "updated_at.desc", limit: 500 }),
      selectRows("ghost_agency_email_log", { order: "sent_at.desc", limit: 500 }),
      selectRows("ghost_agency_events", { order: "created_at.desc", limit: 300 }),
      // Same time bound on the legacy path. This one is worse — it extracts a
      // JSON field (payload->>actor) for every row before sorting.
      select("ghost_agency_events", `?select=*&payload->>actor=not.is.null&created_at=gte.${since}&order=created_at.desc&limit=${AGENT_EVENT_LIMIT}`),
    ]);
    return [...legacy, compact[4]];
  }
  return [
    restoreRows(compact[0]),
    compact[1],
    restoreRows(compact[2]),
    compact[3],
    compact[4],
  ];
}

function staleRowsWithCurrentPause(cached, current) {
  const stale = [...cached];
  const currentPause = current[4] || {};
  stale[4] = currentPause.active
    ? currentPause
    : {
        ...currentPause,
        active: true,
        known: false,
        reason: "console_source_snapshot_stale",
      };
  return stale;
}

async function loadSourceRows() {
  const now = Date.now();
  const limits = snapshotLimits();
  if (sourceRowsCache && now - sourceRowsCache.at <= limits.ttl) return sourceRowsCache.value;
  if (sourceRowsInFlight) return sourceRowsInFlight;
  const load = compactSourceRows().then((current) => {
    if (sourceRowsFailed(current)) {
      if (sourceRowsCache && Date.now() - sourceRowsCache.at <= limits.stale) {
        return staleRowsWithCurrentPause(sourceRowsCache.value, current);
      }
      throw sourceSnapshotUnavailable();
    }
    sourceRowsCache = { at: Date.now(), value: current };
    return current;
  });
  sourceRowsInFlight = load;
  try {
    return await load;
  } finally {
    if (sourceRowsInFlight === load) sourceRowsInFlight = null;
  }
}

function rowsOf(result) {
  return Array.isArray(result && result.rows) ? result.rows : [];
}

// Shared predicate (lib/prospect-detail) so every reader answers owner-proof
// truth the same way — lib/email.js has recorded marked owner-proof rows in
// this table since durable owner-proof accounting landed.
const isOwnerProofEmail = (row) => isOwnerProofEmailRecord(row);

function nextDripRunISO(from = new Date()) {
  for (let i = 0; i < 14 * 24; i++) {
    const d = new Date(from.getTime() + i * 3600 * 1000);
    d.setUTCMinutes(0, 0, 0);
    if (d <= from) continue;
    if (DRIP_DOW.includes(d.getUTCDay()) && DRIP_HOURS_UTC.includes(d.getUTCHours())) {
      return d.toISOString();
    }
  }
  return null;
}

function dayKey(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Layman-friendly event names: the console is read by the owner, not an
// engineer, so raw types like "resend.webhook email.delivered" become
// "Email delivered" with a plain-English sentence.
const EMAIL_EVENT_WORDS = {
  "email.sent": "Email sent",
  "email.delivered": "Email delivered",
  "email.delivery_delayed": "Email delayed",
  "email.opened": "Email opened",
  "email.clicked": "Link clicked",
  "email.bounced": "Email bounced",
  "email.complained": "Marked as spam",
  "email.unsubscribed": "Unsubscribed",
};
function eventLabel(ev) {
  const p = ev.payload && typeof ev.payload === "object" ? ev.payload : {};
  if (ev.type === "resend.webhook") return EMAIL_EVENT_WORDS[String(p.type || "").toLowerCase()] || "Email update";
  if (ev.type === "system.run") return "Pipeline run";
  if (/^outreach\.call/.test(ev.type)) return "Phone call";
  if (/report\.viewed|hot/.test(ev.type)) return "Report viewed";
  if (/preview/.test(ev.type)) return "Site preview";
  if (/checkout|stripe/.test(ev.type)) return "Checkout";
  return String(ev.type || "event").replace(/[._]/g, " ");
}
function eventSummary(ev, nameById) {
  const p = ev.payload && typeof ev.payload === "object" ? ev.payload : {};
  const names = nameById || {};
  const who = names[p.prospectId || p.prospect_id || ev.prospect_id] || p.businessName || "";
  if (ev.type === "system.run") {
    const bits = [
      p.category && p.location ? `looked for ${p.category} in ${p.location}` : "",
      p.sent != null ? `${p.sent} email${Number(p.sent) === 1 ? "" : "s"} sent` : "",
      p.queued != null ? `${p.queued} queued` : "",
      p.status && p.status !== "ok" ? `status: ${p.status}` : "",
      p.reason || p.blocked || "",
    ].filter(Boolean);
    return bits.join(" · ") || "background run finished";
  }
  if (ev.type === "resend.webhook") {
    return who ? `for ${who}` : (p.metric || "");
  }
  return who || p.mode || p.loaded || "";
}

function boundedText(value, max = 160) {
  if (value == null) return "";
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text.slice(0, max);
}

function boundedCount(value, max = 1_000_000) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(Math.trunc(parsed), 0), max);
}

function boundedBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function boundedTextList(value, { maxItems = 500, maxLength = 120 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => boundedText(item, maxLength))
    .filter(Boolean);
}

function runBlockReason(payload = {}) {
  const blocked = payload.blocked;
  if (blocked && typeof blocked === "object" && !Array.isArray(blocked)) {
    return boundedText(blocked.reason || blocked.code || blocked.message, 240);
  }
  return boundedText(blocked || payload.reason || payload.error, 240);
}

function runError(payload = {}) {
  const error = payload.error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    return boundedText(error.message || error.reason || error.code, 240);
  }
  return boundedText(error, 240);
}

function projectSystemRun(eventRow = {}, nameById = {}) {
  const payload = eventRow.payload && typeof eventRow.payload === "object" && !Array.isArray(eventRow.payload)
    ? eventRow.payload
    : {};
  const prospectId = boundedText(payload.prospectId || payload.prospect_id, 120);
  return {
    at: boundedText(eventRow.created_at, 64),
    runId: boundedText(payload.runId || payload.run_id, 120),
    stage: boundedText(payload.stage, 40),
    status: boundedText(payload.status || eventRow.status, 40),
    category: boundedText(payload.category, 100),
    location: boundedText(payload.location, 140),
    mode: boundedText(payload.mode, 80),
    prospectId,
    businessName: boundedText(payload.businessName || payload.business_name || nameById[prospectId], 160),
    renderer: boundedText(payload.renderer, 100),
    ready: boundedBoolean(payload.ready),
    qcPassed: boundedBoolean(payload.qcPassed ?? payload.qc_passed),
    dryRun: boundedBoolean(payload.dryRun ?? payload.dry_run),
    sandboxMode: boundedBoolean(payload.sandboxMode ?? payload.sandbox_mode),
    ownerProofResend: boundedBoolean(payload.ownerProofResend ?? payload.owner_proof_resend),
    deferredBuildOnClick: boundedBoolean(payload.deferredBuildOnClick),
    errorCode: boundedText(payload.error_code || payload.errorCode, 100),
    error: runError(payload),
    httpStatus: boundedCount(payload.http_status ?? payload.httpStatus, 599),
    found: boundedCount(payload.found),
    count: boundedCount(payload.count),
    rawLimit: boundedCount(payload.rawLimit),
    withEmail: boundedCount(payload.withEmail),
    deduped: boundedCount(payload.deduped),
    scored: boundedCount(payload.scored),
    eligible: boundedCount(payload.eligible),
    selected: boundedCount(payload.selected),
    contactable: boundedCount(payload.contactable),
    noEmail: boundedCount(payload.noEmail),
    built: boundedCount(payload.built),
    total: boundedCount(payload.total),
    failedBuilds: boundedCount(payload.failedBuilds),
    queued: boundedCount(payload.queued),
    sendableBeforeLimit: boundedCount(payload.sendableBeforeLimit),
    sent: boundedCount(payload.sent),
    sentProspectIds: boundedTextList(payload.sentProspectIds ?? payload.sent_prospect_ids),
    skipped: boundedCount(payload.skipped),
    planned: boundedCount(payload.planned),
    wouldQueue: boundedCount(payload.wouldQueue),
    wouldSend: boundedCount(payload.wouldSend),
    callOrSms: boundedCount(payload.callOrSms),
    durationMs: boundedCount(payload.durationMs, 21_600_000),
    blocked: runBlockReason(payload),
    reason: boundedText(payload.reason || payload.detail, 240),
  };
}

// ===================== AGENTS VIEW ==========================================
// Owner request 2026-08-06: "I like seeing what the agents were doing and the
// calls happening." The old Agent command bridge was removed on f0ac628; it is
// coming back as EVIDENCE, not as theater.
//
// WHY THIS IS A SEPARATE ?view=agents BRANCH AND NOT PART OF THE SNAPSHOT.
// The poll snapshot is on a hot path with a pinned read budget (three
// selectRows + one select, asserted by console-data-performance.test.js). This
// view needs a different, more expensive shape — a per-actor lookup and a live
// VAPI read — and the operator only needs it when the tab is open. So it loads
// lazily on tab open, exactly like the Operations and Line tabs, and touches
// nothing the poll depends on.
//
// WHY PER-ACTOR LOOKUPS RATHER THAN ONE WINDOWED SCAN.
// The snapshot's agent query is bounded to 2 days / 200 rows for cost reasons,
// which is right for the poll but WRONG as a liveness verdict: measured on
// 2026-08-06 the newest 1000 actor rows did not reach back even 7 days, because
// agent_01 alone writes ~880 of them. Under a windowed scan agent_05 (last ran
// Jul 29) is indistinguishable from agent_08 (never ran, not once, ever) — both
// simply absent. Reporting "no signal" for an agent that did run is the same
// class of lie as a spinner over a dead build. One indexed
// `actor=eq.X&order=created_at.desc&limit=1` per agent returns the true
// all-time last run; 14 of them in parallel measured 208ms total.
const AGENT_LAST_RUN_TIMEOUT_MS = 6_000;
const VAPI_TIMEOUT_MS = 8_000;
const RILEY_ASSISTANT_ID = process.env.VAPI_RILEY_ASSISTANT_ID
  || process.env.VAPI_LOCAL_GROWTH_ASSISTANT_ID
  || "5b5e73a3-2bd7-4777-8233-077bf7ffddc6";
const RILEY_CALL_LIMIT = 25;

// Freshness thresholds, in hours. An agent is only called "active" when the
// evidence is recent enough that the word is defensible.
const AGENT_ACTIVE_HOURS = 24;
const AGENT_RECENT_HOURS = 24 * 7;

function clipped(value, max) {
  const full = boundedText(value, max + 1);
  return full.length > max ? `${full.slice(0, max).trimEnd()}…` : full;
}

function hoursSince(iso) {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(at)) return null;
  return (Date.now() - at) / 3_600_000;
}

// The whole point of the panel. Four states, each one a claim we can back with
// the row we just read. "never" is deliberately distinct from "dormant": the
// owner asked whether billing is even running, and "never run, not once" is the
// answer, not "quiet".
function agentLiveness(lastRun) {
  if (!lastRun) return { state: "never", label: "never run" };
  const hours = hoursSince(lastRun);
  if (hours === null) return { state: "never", label: "never run" };
  if (hours <= AGENT_ACTIVE_HOURS) return { state: "active", label: "active today" };
  if (hours <= AGENT_RECENT_HOURS) return { state: "recent", label: "ran this week" };
  return { state: "dormant", label: "dormant" };
}

async function agentLastRuns() {
  const results = await Promise.all(AGENTS.map(async ([id]) => {
    const attempt = async (table, column) => select(
      table,
      `?select=created_at&${column}=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=1`,
    );
    let row = await attempt(CONSOLE_TABLES.events, "actor");
    if (schemaUnavailable(row)) row = await attempt("ghost_agency_events", "payload->>actor");
    const data = Array.isArray(row && row.data) ? row.data : [];
    return [id, { ok: row && row.ok !== false, lastRun: data[0] ? data[0].created_at : null }];
  }));
  return Object.fromEntries(results);
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function vapiGet(path, timeoutMs = VAPI_TIMEOUT_MS) {
  const key = process.env.VAPI_API_KEY && process.env.VAPI_API_KEY.trim();
  if (!key) return { ok: false, reason: "VAPI_API_KEY not configured", data: [] };
  const guard = withTimeout(timeoutMs);
  try {
    const response = await fetch(`https://api.vapi.ai${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: guard.signal,
    });
    if (!response.ok) return { ok: false, reason: `VAPI returned ${response.status}`, data: [] };
    const data = await response.json();
    return { ok: true, reason: "", data: Array.isArray(data) ? data : [] };
  } catch (error) {
    // Never leak the key or a raw provider stack into an admin payload.
    return { ok: false, reason: error && error.name === "AbortError" ? "VAPI timed out" : "VAPI unreachable", data: [] };
  } finally {
    guard.done();
  }
}

function callSeconds(call) {
  if (!call || !call.startedAt || !call.endedAt) return null;
  const seconds = (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// What the caller actually asked for, and what actually happened to it — read
// off Riley's own tool traffic rather than inferred from the transcript. The
// status vocabulary here is the live one observed on real calls:
// confirm_required -> refused / confirm_invalid / queued / applied.
function callEdits(call) {
  const edits = [];
  let resolved = null;
  for (const message of (call && call.messages) || []) {
    for (const toolCall of message.toolCalls || []) {
      const name = toolCall && toolCall.function && toolCall.function.name;
      if (name !== "request_site_change") continue;
      const args = safeJson(toolCall.function.arguments) || {};
      const instruction = boundedText(args.instruction, 180);
      if (!instruction) continue;
      const existing = edits.find((edit) => edit.instruction === instruction);
      if (existing) existing.attempts += 1;
      else edits.push({ instruction, attempts: 1, outcome: "asked", reason: "", jobId: null });
    }
    if (message.role !== "tool_call_result") continue;
    const parsed = safeJson(message.result);
    if (!parsed) continue;
    if (message.name === "lookup_business_record" && parsed.found) {
      resolved = {
        business: boundedText(parsed.business_name, 80),
        where: boundedText([parsed.city, parsed.state].filter(Boolean).join(", "), 60),
        matchedBy: boundedText(parsed.matched_by, 40),
        clientId: boundedText(parsed.reference, 24),
      };
    }
    if (message.name !== "request_site_change") continue;
    const instruction = boundedText(parsed.instruction, 180);
    const target = edits.find((edit) => edit.instruction === instruction) || edits[edits.length - 1];
    if (!target) continue;
    const status = String(parsed.status || "").toLowerCase();
    const result = parsed.result && typeof parsed.result === "object" ? parsed.result : {};
    if (parsed.applied === true || result.applied === true) {
      target.outcome = "applied";
      target.reason = "";
    } else if (status === "refused" || result.refused === true) {
      target.outcome = "refused";
      target.reason = boundedText(result.reason || parsed.reason, 120);
    } else if (parsed.queued === true || status === "queued") {
      target.outcome = "queued";
    } else if (status === "confirm_required" && target.outcome === "asked") {
      target.outcome = "awaiting confirmation";
    } else if (status === "confirm_invalid") {
      target.reason = boundedText(parsed.reason, 120);
    }
    if (parsed.jobId) target.jobId = boundedText(parsed.jobId, 60);
  }
  return { edits, resolved };
}

// The site-edit job record is the last word on whether a change actually
// landed: the tool result is what Riley was told mid-call, but a job can be
// refused or completed after the caller has already hung up.
function applyJobTruth(calls, editEvents) {
  const byJob = new Map();
  for (const event of editEvents) {
    const payload = event && event.payload && typeof event.payload === "object" ? event.payload : {};
    const jobId = payload.jobId || (payload.result && payload.result.jobId);
    if (!jobId || byJob.has(jobId)) continue;
    const type = String(event.type || "");
    if (/site_edit_done/.test(type)) {
      byJob.set(jobId, { outcome: (payload.result && payload.result.applied) === false ? "refused" : "applied", reason: "" });
    } else if (/site_edit_refused/.test(type)) {
      byJob.set(jobId, { outcome: "refused", reason: boundedText(payload.reason, 120) });
    } else if (/site_edit_queued/.test(type)) {
      byJob.set(jobId, { outcome: "queued", reason: "" });
    }
  }
  for (const call of calls) {
    for (const edit of call.edits) {
      const truth = edit.jobId && byJob.get(edit.jobId);
      if (!truth) continue;
      edit.outcome = truth.outcome;
      if (truth.reason) edit.reason = truth.reason;
    }
  }
}

async function agentsView() {
  const since = encodeURIComponent(recentEventsFloorIso(30));
  const [lastRuns, windowEvents, editEventsResult, assistants, callsResult] = await Promise.all([
    agentLastRuns().catch(() => ({})),
    select(
      CONSOLE_TABLES.events,
      `?select=${AGENT_SELECT}&actor=not.is.null&created_at=gte.${since}&order=created_at.desc&limit=${AGENT_EVENT_LIMIT}`,
    ).catch(() => ({ ok: false, data: [] })),
    select(
      CONSOLE_TABLES.events,
      `?select=type,created_at,payload&type=like.ghost_agency_site_edit*&order=created_at.desc&limit=120`,
    ).catch(() => ({ ok: false, data: [] })),
    vapiGet("/assistant"),
    vapiGet(`/call?limit=100`),
  ]);

  const windowRows = Array.isArray(windowEvents && windowEvents.data) ? windowEvents.data : [];
  const telemetry = agentTelemetry(windowRows);
  const telemetryById = Object.fromEntries(telemetry.map((agent) => [agent.id, agent]));

  const pipeline = AGENTS.map(([id, name, role]) => {
    const probe = lastRuns[id] || {};
    const lastRun = probe.lastRun || null;
    const liveness = agentLiveness(lastRun);
    const recent = telemetryById[id] || {};
    return {
      id,
      name,
      role,
      lastRun,
      lastRunKnown: probe.ok !== false,
      state: liveness.state,
      label: liveness.label,
      // Only meaningful when the agent fired inside the 30-day window.
      recentEvents: boundedCount(windowRows.filter((row) => row.payload && row.payload.actor === id).length),
      lastError: recent.lastError || null,
      activeJob: boundedText(recent.activeJob, 60),
    };
  });

  const rileyCalls = (callsResult.data || [])
    .filter((call) => call && call.assistantId === RILEY_ASSISTANT_ID)
    .slice(0, RILEY_CALL_LIMIT)
    .map((call) => {
      const { edits, resolved } = callEdits(call);
      return {
        id: boundedText(call.id, 64),
        at: call.startedAt || call.createdAt || null,
        seconds: callSeconds(call),
        direction: /inbound/i.test(String(call.type)) ? "inbound" : "outbound",
        caller: boundedText(call.customer && call.customer.number, 24),
        endedReason: boundedText(call.endedReason, 60),
        costUsd: Number.isFinite(Number(call.cost)) ? Math.round(Number(call.cost) * 100) / 100 : null,
        // Ellipsis when clipped, so a bounded field never looks like a
        // rendering bug that ate the end of a sentence.
        summary: clipped((call.analysis && call.analysis.summary) || call.summary, 600),
        resolved,
        edits,
        // Deliberately NOT carried: recordingUrl and the raw transcript. The
        // panel has no player and shows no verbatim customer speech, so
        // shipping either would be exporting call audio and a caller's own
        // words into a page that never uses them.
      };
    });
  applyJobTruth(rileyCalls, Array.isArray(editEventsResult && editEventsResult.data) ? editEventsResult.data : []);

  // Only the WSS crew. This VAPI org also holds assistants from unrelated
  // projects; listing them here would pad the roster with work that is not
  // this machine's.
  const crewIds = new Set([RILEY_ASSISTANT_ID]);
  const crewAssistants = (assistants.data || [])
    .filter((assistant) => assistant && (crewIds.has(assistant.id) || /\s—\s/.test(String(assistant.name || ""))))
    .slice(0, 12);
  // "Never taken a call" has to be measured, not inferred from absence in the
  // 100-call page — an assistant whose only calls are old would otherwise be
  // reported as never used. One bounded per-assistant lookup makes the word
  // defensible.
  const crew = await Promise.all(crewAssistants.map(async (assistant) => {
    const onPage = (callsResult.data || []).filter((call) => call.assistantId === assistant.id);
    // Evidence we already hold beats a second round trip: if the assistant
    // appears in the page we just read, its newest call there IS its last call.
    const newestOnPage = onPage.reduce((latest, call) => {
      const at = call.startedAt || call.createdAt;
      return !latest || (at && at > latest) ? at : latest;
    }, null);
    const probe = newestOnPage
      ? { ok: true, data: [] }
      : await vapiGet(`/call?assistantId=${encodeURIComponent(assistant.id)}&limit=1`, 5_000);
    const newest = (probe.data || [])[0];
    const last = probe.ok ? (newestOnPage || (newest && (newest.startedAt || newest.createdAt)) || null) : null;
    const liveness = probe.ok ? agentLiveness(last) : { state: "unknown", label: "not measured" };
    return {
      id: boundedText(assistant.id, 64),
      name: boundedText(assistant.name, 60),
      isRiley: assistant.id === RILEY_ASSISTANT_ID,
      // Count within the page actually read, and labelled as exactly that.
      recentCalls: boundedCount(onPage.length),
      lastCall: last,
      state: liveness.state,
      label: liveness.label,
    };
  }));
  crew.sort((a, b) => Number(b.isRiley) - Number(a.isRiley) || String(b.lastCall || "").localeCompare(String(a.lastCall || "")));

  return {
    ok: true,
    view: "agents",
    generatedAt: new Date().toISOString(),
    pipeline: {
      agents: pipeline,
      windowDays: 30,
      activeHours: AGENT_ACTIVE_HOURS,
      recentHours: AGENT_RECENT_HOURS,
    },
    voice: {
      configured: assistants.ok,
      reason: boundedText(assistants.reason || callsResult.reason, 120),
      crew,
      callWindow: "recent-call counts are within the most recent 100 workspace calls; last-call times are all-time",
    },
    calls: rileyCalls,
    callsAvailable: callsResult.ok,
    callsReason: boundedText(callsResult.reason, 120),
  };
}

function requestedView(req) {
  // The perf harness calls the handler with a bare {method:"GET"} object, and
  // Vercel supplies req.query. Read both defensively; never throw on a missing
  // url, and never treat an unknown value as a view.
  const fromQuery = req && req.query && typeof req.query === "object" ? req.query.view : null;
  if (fromQuery) return String(fromQuery);
  const url = req && typeof req.url === "string" ? req.url : "";
  const match = url.match(/[?&]view=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    if (requestedView(req) === "agents") {
      sendJson(res, 200, await agentsView());
      return;
    }
    const [prospectsR, emailsR, eventsR, agentEventsR, deliveryPause] = await loadSourceRows();

    const allProspects = rowsOf(prospectsR);
    const prospects = allProspects.filter((p) => !p.merged_into_prospect_id && p.status !== "merged");
    const emails = rowsOf(emailsR);
    // Owner proofs are safely auditable in the same table but are not prospect
    // outreach. Keep them visible as labelled rows while excluding them from
    // funnel, tracking, and sent-state truth.
    const prospectEmails = emails.filter((email) => !isOwnerProofEmail(email));
    const events = rowsOf(eventsR);
    const agentEvents = agentEventsR.ok && Array.isArray(agentEventsR.data) ? agentEventsR.data : events;
    const tracking = reconcileTrackingTruth({ emails: prospectEmails, events });
    const prospectIdentity = identityCounters(allProspects.map((p) => ({ ...p, ...(p.record || {}) })));
    const canonicalById = Object.fromEntries(allProspects.map((p) => [p.prospect_id, p.canonical_prospect_id || p.merged_into_prospect_id || p.prospect_id]));
    const duplicateAliases = allProspects
      .filter((p) => p.merged_into_prospect_id)
      .map((p) => ({ prospect_id: p.prospect_id, canonical_prospect_id: p.merged_into_prospect_id, business_name: p.business_name || "" }));
    // email_id -> prospect_id (so webhook opens/clicks attribute to a lead)
    const emailIdToProspect = {};
    for (const e of prospectEmails) {
      const rid = (e.payload && (e.payload.resendId || e.payload.resend_id || e.payload.emailId || e.payload.email_id || e.payload.id)) || "";
      if (rid) emailIdToProspect[String(rid)] = canonicalById[e.prospect_id] || e.prospect_id;
    }
    // ---- Engagement event scan (provider IDs reconciled to email_log) ----
    const _norm = (v) => String(v || "").toLowerCase();
    const openedIds = new Set(), clickedIds = new Set(), reportViewIds = new Set();
    let _complained = 0, _reportViews = 0;
    for (const ev of events) {
      const pl = ev.payload && typeof ev.payload === "object" ? ev.payload : {};
      const t = _norm(ev.type) + " " + _norm(pl.type) + " " + _norm(pl.metric) + " " + _norm(pl.event);
      const rawPid = pl.prospectId || pl.prospect_id || ev.prospect_id || emailIdToProspect[String(pl.email_id || pl.emailId || pl.resend_id || pl.resendId || "")] || "";
      const pid = canonicalById[rawPid] || rawPid;
      if (/complain|spam/.test(t)) _complained++;
      if (/report\.viewed|hot.?view/.test(_norm(ev.type)) || /pixel/.test(_norm(pl.source))) { _reportViews++; if (pid) reportViewIds.add(pid); }
    }
    for (const [prospectId, metrics] of tracking.prospectMetrics) {
      const canonicalProspectId = canonicalById[prospectId] || prospectId;
      if (metrics.has("opened")) openedIds.add(canonicalProspectId);
      if (metrics.has("clicked")) clickedIds.add(canonicalProspectId);
    }


    // Provider health
    const providers = providerStatus();
    const hardStops = [];
    const outreachSender = outreachFromStatus();
    const outreachDns = await outreachDnsStatus();
    if (!outreachSender.ok) hardStops.push(outreachSender.reason);
    if (!outreachDns.ok) hardStops.push("go.wss-ai.com SPF/DKIM/DMARC DNS records missing at authoritative nameservers");
    if (!providers.resend.webhookConfigured) hardStops.push("GHOST_AGENCY_RESEND_WEBHOOK_SECRET missing");
    if (!providers.resend.unsubscribeConfigured) hardStops.push("EMAIL_UNSUB_SECRET missing");
    if (providers.resend.postalAddressConfigured && !providers.resend.unsubscribeConfigured) {
      hardStops.push("Postal set but unsubscribe not configured");
    }
    if (!providers.vapi.cleanLaneConfigured) hardStops.push("VAPI clean lane not configured");
    if (reviewHoldActive()) hardStops.push("Cold outreach review hold is active");
    if (deliveryPause.active) hardStops.push(`Cold outreach delivery pause is active: ${deliveryPause.reason || "threshold crossed"}`);

    // Prospect funnel
    const funnelOrder = ["new", "packeted", "previewed", "reported", "engaged", "won", "closed_lost", "unsubscribed", "do_not_contact"];
    const funnel = {};
    for (const p of prospects) funnel[p.status] = (funnel[p.status] || 0) + 1;
    const funnelRows = funnelOrder
      .filter((s) => funnel[s])
      .map((s) => ({ status: s, count: funnel[s] }))
      .concat(Object.keys(funnel).filter((s) => !funnelOrder.includes(s)).map((s) => ({ status: s, count: funnel[s] })));
    // Excludes prospects contactSendGate() would actually refuse at send time
    // (suppressed / conflicting / low-confidence-source address) so this count
    // matches what a real run-campaign batch would do, not just "has an email".
    const sendableCount = prospects.filter((p) => SENDABLE.includes(p.status) && (p.email || p.owner_email) && !contactSendGate(p).blocked).length;

    const nameById = {};
    for (const p of allProspects) nameById[p.prospect_id] = p.business_name || p.prospect_id;
    for (const alias of duplicateAliases) nameById[alias.prospect_id] = nameById[alias.canonical_prospect_id] || nameById[alias.prospect_id];
    const actionableBlockers = buildActionableBlockers({ events, hardStops, names: nameById });

    // Emails
    const sent = prospectEmails.filter((e) => e.mode === "sent" && !e.suppressed);
    // Delivery truth belongs to the email log, not the prospect workflow
    // status. A previewed prospect can have been sent and still remain eligible
    // for its follow-up sequence.
    const sentProspectIds = new Set(sent
      .map((e) => canonicalById[e.prospect_id] || e.prospect_id)
      .filter(Boolean));
    const dryRun = prospectEmails.filter((e) => e.mode === "dry_run");
    const suppressed = prospectEmails.filter((e) => e.suppressed);
    const ownerProofEmails = emails.filter(isOwnerProofEmail);
    const byDayMap = {};
    for (const e of sent) {
      const k = dayKey(e.sent_at);
      if (k) byDayMap[k] = (byDayMap[k] || 0) + 1;
    }
    const byDay = Object.keys(byDayMap).sort().slice(-14).map((date) => ({ date, count: byDayMap[date] }));
    // The drawer matches by prospect_id. Return the complete already-bounded
    // 500-row safe projection instead of only the top 24, without forwarding
    // message bodies, provider payloads, hashes, or recipient addresses.
    const recentEmails = emails.slice(0, 500).map((e) => ({
      prospect_id: e.prospect_id,
      business_name: nameById[e.prospect_id] || e.prospect_id,
      sequence: e.sequence,
      step: e.step,
      mode: e.mode,
      suppressed: !!e.suppressed,
      subject: (e.payload && e.payload.subject) || "",
      sent_at: e.sent_at,
      ownerProof: isOwnerProofEmail(e),
      deliveryLane: isOwnerProofEmail(e) ? "owner_only_proof" : "prospect",
    }));

    // Recent prospects (pipeline cards)
    const recentProspects = prospects.slice(0, 24).map((p) => {
      const rec = p.record && typeof p.record === "object" ? p.record : {};
      const gbp = rec.truth_packet && rec.truth_packet.gbp ? rec.truth_packet.gbp : (rec.gbp || {});
      const bestName = p.business_name || rec.business_name || gbp.name || "";
      const currentSite = p.current_website || rec.current_website || "";
      const build = rec.siteforge || rec.build || rec.preview_build || rec.previewBuild || rec;
      const shot = (u) => `https://s0.wp.com/mshots/v1/${encodeURIComponent(u)}?w=480&h=300`;
      return {
        prospect_id: p.prospect_id,
        business_name: bestName,
        city: p.city || rec.city || "",
        state: p.state || rec.state || "",
        status: p.status,
        batch_id: rec.batch_id || rec.batchId || "",
        industry: p.industry || rec.industry || rec.category || "",
        category: rec.category || p.industry || rec.industry || "",
        error: rec.error || rec.blocked_reason || "",
        error_code: rec.error_code || rec.blocked_reason || "",
        canonical_prospect_id: p.canonical_prospect_id || p.merged_into_prospect_id || p.prospect_id,
        owner_only: rec.owner_only === true || rec.delivery_lane === "owner-only",
        test_mode: rec.test_mode === true || rec.environment === "test",
        held: p.status === "held" || rec.outreach_review_hold === true,
        ref_code: rec.ref_code || p.ref_code || "",
        email: p.email || p.owner_email || "",
        preview_url: p.preview_url || "",
        current_website: currentSite,
        score: p.leadminer_score,
        thumb: p.preview_url ? shot(p.preview_url) : (currentSite ? shot(currentSite) : ""),
        thumb_kind: p.preview_url ? "preview" : (currentSite ? "current" : "none"),
        sent: sentProspectIds.has(p.prospect_id),
        opened: openedIds.has(p.prospect_id),
        clicked: clickedIds.has(p.prospect_id),
        reportViewed: reportViewIds.has(p.prospect_id),
        qcEvidence: siteforgeQcEvidence(build),
        updated_at: p.updated_at || null,
      };
    });

    // Events feed
    const feed = events.map((ev) => ({
      type: ev.type,
      label: eventLabel(ev),
      created_at: ev.created_at,
      summary: eventSummary(ev, nameById),
    }));

    const calls = events.filter((e) => e.type === "outreach.call_completed").length;

    // Evidence-backed agent state. Never-invoked is deliberately distinct
    // from idle/healthy so the cockpit cannot claim decorative readiness.
    const agents = agentTelemetry(agentEvents);

    const campaignRuns = events.filter((e) => e.type === "campaign.run").slice(0, 12).map((e) => ({
      at: e.created_at,
      dryRun: !!(e.payload && e.payload.dryRun),
      batch: e.payload && e.payload.batch,
      evaluated: e.payload && e.payload.evaluated,
      tested: e.payload && e.payload.tested,
      sent: e.payload && e.payload.sent,
      blockedBy: (e.payload && e.payload.blockedBy) || {},
    }));
    const mineRuns = events.filter((e) => e.type === "mine.run").slice(0, 8).map((e) => ({
      at: e.created_at,
      status: (e.payload && e.payload.status) || "",
      query: e.payload && e.payload.textQuery,
      found: e.payload && e.payload.found,
      upserted: e.payload && e.payload.upserted,
      created: e.payload && e.payload.created,
      updated: e.payload && e.payload.updated,
      duplicateSkipped: e.payload && e.payload.duplicateSkipped,
      rejected: e.payload && e.payload.rejected,
      withEmail: e.payload && e.payload.withEmail,
      blocked: e.payload && e.payload.blocked,
      finalQueries: (e.payload && e.payload.finalQueries) || [],
    }));
    const systemRuns = events
      .filter((e) => e.type === "system.run")
      .slice(0, 32)
      .map((e) => projectSystemRun(e, nameById));

    const bySourceMap = {};
    for (const p of prospects) { const k = p.source || "unknown"; bySourceMap[k] = (bySourceMap[k] || 0) + 1; }
    const bySource = Object.keys(bySourceMap).map((k) => ({ source: k, count: bySourceMap[k] })).sort((a, b) => b.count - a.count);

    const withEmailCount = prospects.filter((p) => p.email || p.owner_email).length;

    // ---- Engagement rollup (uses hoisted scan) ----
    const previewCount = prospects.filter((p) => p.preview_url).length;
    const engagement = {
      sent: tracking.counts.sent,
      accepted: tracking.counts.accepted ?? 0,
      delivered: tracking.counts.delivered,
      opens: tracking.counts.opened, openedProspects: openedIds.size,
      clicks: tracking.counts.clicked, clickedProspects: clickedIds.size,
      reportViews: _reportViews, reportViewProspects: reportViewIds.size,
      bounced: tracking.counts.bounced, complained: tracking.counts.complained ?? _complained,
      unsubscribed: tracking.counts.unsubscribed ?? 0,
      openRate: tracking.counts.delivered ? Math.round((tracking.counts.opened / tracking.counts.delivered) * 100) : null,
      clickRate: tracking.counts.delivered ? Math.round((tracking.counts.clicked / tracking.counts.delivered) * 100) : null,
      zeroOpenMeaning: tracking.zeroOpenMeaning || (tracking.counts.opened > 0 ? "observed" : (providers.resend.webhookConfigured ? "tracked_zero" : "untracked")),
      previews: previewCount,
    };

    // ---- What needs the human (actionable) ----
    const heldCount = prospects.filter((p) => p.status === "held").length;
    const newNoPreview = prospects.filter((p) => p.status === "new" && !p.preview_url).length;
    const sendableNow = sendableCount;
    // Otherwise-sendable prospects a real run-campaign would still refuse to
    // mail because their scraped address is suppressed, conflicting, or from a
    // low-confidence source. Surfaced separately from generic "held" so the
    // operator can tell "needs a build" apart from "needs a human to pick the
    // right contact".
    const contactHoldCount = prospects.filter((p) =>
      SENDABLE.includes(p.status) && (p.email || p.owner_email) && contactSendGate(p).blocked,
    ).length;
    const pendingReplyDrafts = events.filter((e) => /reply\.(draft|drafted|queued)/.test(_norm(e.type))).length;
    const activeAgentCalls = events.filter((e) => /call\.(started|active|in_progress)|conversation\.(started|active)/.test(_norm(e.type)) && !/completed|ended|failed|declined/.test(_norm(e.type))).length;
    const needsAction = {
      leadsToMine: prospects.length < 50 ? Math.max(0, 50 - prospects.length) : 0,
      newNoPreview, held: heldCount, sendableNow, contactHold: contactHoldCount,
      pendingReplyDrafts, activeAgentCalls,
      reviewHold: reviewHoldActive(),
    };

    // thumbnail helper for the lead grid (mshots renders any public preview)
    const thumb = (u) => u ? `https://s0.wp.com/mshots/v1/${encodeURIComponent(u)}?w=480&h=300` : "";


    sendJson(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      // What donors-clean can truthfully build RIGHT NOW. The console builds its
      // vertical picker from this instead of a hand-kept <option> list, which was
      // stale the day landscaping landed and again the day hvac landed.
      verticals: buildableVerticals(),
      mappedV2Catalog: mappedV2Verticals(),
      ready: hardStops.length === 0,
      hardStops,
      providers,
      outreachSender,
      outreachDns,
      totals: {
        prospects: prospects.length,
        sendable: sendableCount,
        emailsSent: sent.length,
        emailsDryRun: dryRun.length,
        emailsSuppressed: suppressed.length,
        ownerProofEmails: ownerProofEmails.length,
        calls,
      },
      engagement,
      tracking: {
        counts: tracking.counts,
        definitions: tracking.definitions,
        sentWithoutProviderId: tracking.sentWithoutProviderId,
        configuration: tracking.configuration,
        zeroOpenMeaning: tracking.zeroOpenMeaning,
        anonymousEvents: tracking.anonymousEvents,
        warnings: tracking.warnings,
      },
      prospectIdentity,
      duplicateAliases,
      needsAction,
      actionableBlockers,
      funnel: funnelRows,
      byDay,
      recentEmails,
      recentProspects,
      feed,
      drip: {
        schedule: "0 16,20 * * 2-4",
        scheduleHuman: "9am & 1pm PT, Tue-Thu",
        batchCap: Math.min(Math.max(Number.parseInt(process.env.GHOST_AGENCY_DRIP_BATCH ?? "20", 10) || 0, 0), 100),
        fromDomain: ((process.env.GHOST_AGENCY_OUTREACH_FROM || "").replace(/^.*@/, "@").replace(/[>\s]/g, "")) || "(unset)",
        reviewHold: reviewHoldActive(),
        deliveryPause,
        nextRun: nextDripRunISO(),
      },
      agents,
      campaignRuns,
      mineRuns,
      systemRuns,
      performance: {
        bySource,
        withEmail: withEmailCount,
        emailReachRate: prospects.length ? Math.round(withEmailCount / prospects.length * 100) : 0,
        placesKeyConfigured: !!(process.env.GOOGLE_PLACES_API_KEY && process.env.GOOGLE_PLACES_API_KEY.trim()),
      },
    });
  } catch (error) {
    handleError(res, error);
  }
}

handler.projectSystemRun = projectSystemRun;
handler.mappedV2Verticals = mappedV2Verticals;
module.exports = handler;
