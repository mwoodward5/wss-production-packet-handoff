"use strict";

// Server-owned continuation for the operator Line.
//
// The browser creates a durable batch once and only polls it. Every queue or
// rescue invocation claims the batch with a database CAS, advances at most one
// durable phase per claimed row, checkpoints, releases ownership, and then
// publishes the next opaque batch handle. No prospect facts enter the queue.

const { createHash, randomUUID } = require("node:crypto");
const lineState = require("./line-state");
const lineTelemetry = require("./line-telemetry");
const runner = require("./line-runner");
const quota = require("./line-quota");
const persistenceDefaults = require("./line-persistence");
const storeDefaults = require("./store");
const { enqueueLineMessage } = require("./line-queue");
const adapters = require("./line-adapters");
const bankDefaults = require("./prospect-bank");
const { createLineSender, fingerprintsMatch } = require("./line-delivery");
const { qualifyForBuild } = require("./build-qualification");
const { runRenderGate } = require("./render-gate");
const { CAPTURE_BUDGET_MS, captureLineEmailAssets } = require("./line-email-assets");

// The pick phase sources prospects through the full build-ready miner, which
// runs a sequential dry-run mirror build per survivor to prove each lead is
// buildable before it is written. With Firecrawl discovery live, that is a
// multi-minute operation, not a 2-minute one — the old 120s ceiling timed out
// every real run at the sourcing stage. Bounded to 280s to stay under the 300s
// function ceiling while leaving teardown margin.
const PICK_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.GHOST_AGENCY_PICK_TIMEOUT_MS) || 280_000, 1_000),
  280_000,
);
const WORKER_DEADLINE_MS = 225_000;
// THE HALTED-BATCH SEND DRAIN (owner email-now law, 2026-09-01). An approval
// stamped with this actor exists only on a sandbox batch whose SOURCING already
// ended in a terminal halt and whose operator explicitly invoked the send-only
// email drain. The finished-quota hold in advanceSend assumes more sites can
// still be mined; on a halted batch that deficit is unrecoverable, and holding
// already-finished sites is exactly the defect this drain exists to fix.
const HALTED_SEND_DRAIN_ACTOR = "sandbox_auto_send_drain";
// A server-owned pass cannot legitimately outlive its 225s deadline. Give it
// one 30s persistence/teardown margin, then let either the returning queue
// delivery or the rescue cron reopen the exact durable phase. The old six
// minute threshold plus a two-minute cron could leave an expired render-gate
// lease visibly frozen for almost eight minutes.
const STALE_WORKER_MS = WORKER_DEADLINE_MS + 30_000;
// Picking has no row lease yet. Keep its durable heartbeat deliberately short
// so a dead miner is visible and reclaimable before the next normal worker
// deadline, without applying that shorter window to render or delivery work.
const PICK_HEARTBEAT_STALE_MS = 90_000;
const PICK_HEARTBEAT_INTERVAL_MS = 25_000;
const DEFAULT_ROW_CLAIM = 10;
const MAX_ROW_CLAIM = 10;
// `maxConcurrency` is a deploy-time Vercel Queue trigger setting; Vercel does
// not interpolate runtime environment variables into vercel.json. Production
// pins that consumer group to ten deliveries. Keep every Chromium-heavy
// delivery at one row so those ten workers cannot multiply into twenty remote
// browsers inside the same tick. Rolling the trigger back is a config deploy;
// GHOST_AGENCY_LINE_QUEUE_CONCURRENCY=0 disables row fan-out immediately while
// leaving batch CAS as the safe legacy path. Row leases remain the durable
// duplicate-work guard in either setting.
const BROWSER_HEAVY_ROW_CLAIM = 1;
const ROW_QUEUE_PHASE = "row";
const MAX_ROW_QUEUE_FANOUT = 50;
const BROWSER_HEAVY_ROW_STATUSES = Object.freeze(["qualified", "mirrored"]);
const MAX_RETRY_AWARE_CLAIM = 100;
const MAX_DELIVERY_ATTEMPTS = 5;
// 2026-08-31 fleet: one row died `build_retry_exhausted` after all five
// attempts burned inside a single ~30-minute provider outage (each attempt's
// mirror build runs minutes, and the backoff caps at 10 minutes, so a real
// outage longer than ~30 minutes of wall clock exhausts the budget even when
// every failure is the transient class). Two extra attempts widen the window
// to roughly an hour without changing the delay curve or any terminal
// semantics — the exhaustion path itself is untouched.
const MAX_BUILD_RETRY_ATTEMPTS = 7;
// A transient Practice Signal read is pre-provider, so it must not consume a
// delivery attempt. Once two-phase prepare() succeeds, the canonical report
// URL and its exact packet identity are durable; retry only deliver() from that
// same frozen plan. That is GET-only and can never repeat CallPrep's
// non-idempotent create POST. Three reads (two short backoffs) cover normal
// read-after-write propagation without turning a missing report into a hot
// queue loop.
const MAX_SIGNAL_REPORT_RETRY_ATTEMPTS = 3;
const SIGNAL_REPORT_RETRY_DELAYS_MS = Object.freeze([250, 1_000]);
const SIGNAL_REPORT_RETRY_MIN_REMAINING_MS = 5_000;
const SIGNAL_REPORT_RETRY_EXHAUSTED = "owner_proof_signal_report_retry_exhausted";
const SIGNAL_REPORT_RETRYABLE_REASONS = new Set([
  "owner_proof_signal_report_missing",
  "owner_proof_signal_report_unavailable",
  "owner_proof_signal_report_identity_missing",
]);
const SIGNAL_REPORT_RECONCILIATION_REASONS = new Set([
  "owner_proof_signal_packet_unverified",
  "owner_proof_signal_report_identity_mismatch",
  "owner_proof_signal_report_unsafe",
  "owner_proof_signal_report_unrenderable",
]);
const MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS = 3;
const OWNER_PROOF_FRESH_RETRY_BASE_MS = 5_000;
const OWNER_PROOF_FRESH_RETRY_MAX_MS = 20_000;
const OWNER_PROOF_PUBLIC_RELEASE_RETRY_EXHAUSTED = "owner_proof_public_release_retry_exhausted";
const OWNER_PROOF_DEADLINE_RETRY_EXHAUSTED = "owner_proof_deadline_retry_exhausted";
const OWNER_PROOF_SIGNAL_VISIBILITY_RETRY_EXHAUSTED = "owner_proof_signal_visibility_retry_exhausted";
const OWNER_PROOF_SIGNAL_VISIBILITY_RETRY = "owner_proof_signal_report_save_reconciliation_required";
const OWNER_PROOF_PUBLIC_RELEASE_UNAVAILABLE = "owner_proof_public_release_unavailable";
const OWNER_PROOF_DEADLINE_EXHAUSTED = "owner_proof_deadline_exhausted";
const OWNER_PROOF_EVIDENCE_PERSIST_UNAVAILABLE = "delivery_evidence_persist_unavailable";
const BUILD_RETRY_BASE_MS = 30_000;
const BUILD_RETRY_MAX_MS = 10 * 60 * 1000;
const FAST_REFILL_DELAY_SECONDS = 1;
// Match the queue consumer's existing retry floor for transient mining and
// compiler failures. Publishing the durable handle avoids waiting for the
// two-minute cron sweeper without tightening provider budgets or hot-looping a
// rate-limited Intake Genie endpoint.
const PICK_RETRY_DELAY_SECONDS = 60;
const CAPTURE_PERSISTENCE_RESERVE_MS = 30_000;
const START_WATCH_STAGE = "line_start_watch_v1";
// Campaign stopwatch (2026-09-02 smoke-test bar: 10 sites mined→built→emailed
// in 15-25 minutes). One timing record rides mine_funnel — the same JSONB the
// start-watch row already rides — so it persists with the batch row on the
// existing checkpoint paths and never adds a write. See the helpers below.
const CAMPAIGN_TIMING_STAGE = "line_campaign_timing_v1";
const TERMINAL_PICK_CAUSE_STAGE = "intake_genie_terminal_pick_v1";
const TERMINAL_PICK_CAUSE_MAX_LENGTH = 160;
const INTAKE_GENIE_CERTIFICATION_CAUSES = new Set([
  "prospect_id_missing",
  "independent_identity_anchor_missing",
  "business_name_mismatch",
  "business_location_mismatch",
  "source_bound_evidence_missing",
  "verified_service_evidence_missing",
  "services_missing",
  "certification_key_missing",
  "durable_packet_location_required",
  "compile_request_id_missing",
  "compiler_response_request_id_missing",
  "compile_request_id_mismatch",
  "compile_job_id_missing",
  "compile_idempotency_key_missing",
  "source_set_missing",
  "source_set_prospect_mismatch",
  "certified_at_invalid",
  "compiler_packet_not_buildable",
]);
// Resend deduplicates provider keys for 24 hours. Stop one hour early if an
// accepted send could not be checkpointed, then require manual reconciliation.
const PROVIDER_DEDUP_SAFE_MS = 23 * 60 * 60 * 1000;
// Process-local marker for a worker that lost a batch generation CAS. The
// canonical row is returned to the caller for observability, but this stale
// worker must not publish, auto-approve, retry delivery, or poison the winner.
const STALE_BATCH_GENERATION = Symbol("stale_batch_generation");

function waitForSignalReportRetry(delayMs, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
      resolve(completed);
    };
    const timer = setTimeout(() => finish(true), Math.max(0, Number(delayMs) || 0));
    const onAbort = () => {
      clearTimeout(timer);
      finish(false);
    };
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
const {
  EXPLICIT_PROSPECT_TARGET,
  createExplicitProspectMarker,
  readExplicitProspectMarker,
} = persistenceDefaults;

function explicitProspectSelection(batch = {}) {
  const declared = String(batch.target || "").trim() === EXPLICIT_PROSPECT_TARGET;
  const parsed = readExplicitProspectMarker(batch.mineFunnel, { requested: Number(batch.requested) });
  if (!declared && !parsed.present) return { exact: false, valid: true, ids: [], fingerprint: "" };
  if (!declared) {
    return { exact: true, valid: false, ids: [], fingerprint: "", reason: "explicit_prospect_marker_target_mismatch" };
  }
  if (!parsed.ok || !parsed.present) {
    return {
      exact: true,
      valid: false,
      ids: [],
      fingerprint: "",
      reason: parsed.error || "explicit_prospect_marker_missing",
    };
  }
  return { exact: true, valid: true, ids: parsed.ids, fingerprint: parsed.fingerprint };
}

function explicitProspectIds(batch = {}) {
  const selection = explicitProspectSelection(batch);
  return selection.exact && selection.valid ? selection.ids : [];
}

function exactRowsMatchSelection(batch = {}, selection = explicitProspectSelection(batch)) {
  if (!selection.exact || !selection.valid) return !selection.exact;
  const rows = [...(Array.isArray(batch.rows) ? batch.rows : [])]
    .sort((left, right) => Number(left.rowIndex) - Number(right.rowIndex));
  if (rows.length > selection.ids.length) return false;
  if (rows.some((row, index) => Number(row.rowIndex) !== index
    || String(row.prospectId || "") !== selection.ids[index])) return false;
  return batch.pickState === "complete" ? rows.length === selection.ids.length : true;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function safeCode(value, fallback = "line_continuation_failed") {
  const code = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_");
  return /^[a-z][a-z0-9_.:-]{0,79}$/.test(code) ? code : fallback;
}

// Mirror failures are persisted as structured evidence. Project only bounded
// internal codes from that evidence: provider payloads may contain URLs,
// request values, or other prospect details that must not enter phase logs.
const SAFE_MIRROR_FAILURE_CODES = new Set([
  "all_refused",
  "build_failed",
  "dispatch_absent",
  "dispatch_threw",
  "invalid_request",
  "mirror_build_not_revealable",
  "mirror_dispatch_blocked",
  "mirror_dispatch_failed_before_build",
  "mirror_engine_evidence_identity_mismatch",
  "mirror_engine_qc_not_passed",
  "mirror_engine_release_evidence_invalid",
  "mirror_input_binding_mismatch",
  "not_revealable",
  "release_evidence_absent",
  "release_evidence_invalid",
  "release_evidence_signature_invalid",
]);

function mirrorFailureSummary(row) {
  const dispatch = row && row.mirrorDispatch && typeof row.mirrorDispatch === "object"
    ? row.mirrorDispatch
    : {};
  const failure = dispatch.failure && typeof dispatch.failure === "object"
    ? dispatch.failure
    : {};
  const rawCode = String(failure.code || "").trim().toLowerCase();
  const code = SAFE_MIRROR_FAILURE_CODES.has(rawCode)
    ? rawCode
    : (rawCode ? "mirror_failure_code_redacted" : "");
  return {
    code,
    // Detail and reason are evidence for the durable row/debug drawer, not
    // telemetry. Even code-shaped strings can be opaque credentials.
    detail: "",
    reason: "",
  };
}

function safeTerminalPickCause(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "not_configured"
    || raw === "compiler_not_configured"
    || (raw.includes("intake_genie_base_url") && raw.includes("required"))) {
    return "intake_genie_not_configured";
  }
  const knownHttp = raw.match(/^(?:intake_genie|compiler)_http_([1-5]\d{2})$/);
  if (knownHttp) return `intake_genie_http_${knownHttp[1]}`;
  if (/^[1-5]\d{2}$/.test(raw)) return `intake_genie_http_${raw}`;
  if ([
    "intake_genie_certification_key_missing",
    "intake_genie_compile_failed",
    "intake_genie_timeout",
  ].includes(raw)) return raw;
  // Code-shaped passthrough (08-31 incident): every campaign halted on
  // intake_genie_compile_terminal while the observability event showed only
  // terminal_cause_redacted — the allowlist above did not cover the firing
  // code, so the actual terminal cause was invisible in every funnel read.
  // Machine codes are snake_case tokens with no spaces, no @, no digits-run
  // phone shapes — same PII-free bar as the allowlist, minus the blindness.
  if (/^(?:intake_genie|compiler)_[a-z][a-z0-9_]*$/.test(raw) && !/\d{7,}/.test(raw)) {
    return raw.slice(0, TERMINAL_PICK_CAUSE_MAX_LENGTH).replace(/[_.:-]+$/g, "");
  }
  const prefix = "intake_genie_certification_failed:";
  if (!raw.startsWith(prefix)) return "terminal_cause_redacted";
  const reasons = raw.slice(prefix.length).split(",").filter(Boolean);
  if (!reasons.length) return "terminal_cause_redacted";
  // Pass through code-shaped reasons even when the allowlist above has not
  // caught up with the compiler's newest cause codes (the 08-31 blind halt:
  // every campaign died on an unknown certification reason and the event
  // showed only terminal_cause_redacted). A reason is code-shaped when it is
  // a bare snake_case token — no spaces, no @, no braces/colons, no 7+ digit
  // runs. Anything else redacts, exactly as before.
  const codeShaped = (reason) => /^[a-z][a-z0-9_]*$/.test(reason) && !/\d{7,}/.test(reason);
  const kept = reasons.filter((reason) => INTAKE_GENIE_CERTIFICATION_CAUSES.has(reason) || codeShaped(reason));
  if (!kept.length) return "terminal_cause_redacted";
  const dropped = reasons.length - kept.length;
  return `${prefix}${kept.join(".")}${dropped ? `(+${dropped} redacted)` : ""}`
    .slice(0, TERMINAL_PICK_CAUSE_MAX_LENGTH)
    .replace(/[_.:-]+$/g, "");
}

function safeOpaque(value, maximum = 256) {
  const candidate = String(value || "").trim();
  const digits = candidate.replace(/\D/g, "");
  const possiblePhone = /^[+\d\s().-]+$/.test(candidate) && digits.length >= 7 && digits.length <= 15;
  return candidate.length > 0
    && candidate.length <= maximum
    && /^[A-Za-z0-9_.:/-]+$/.test(candidate)
    && !candidate.includes("@")
    && !possiblePhone
    ? candidate
    : "";
}

function safeAcceptedAt(value, fallback) {
  const parsed = new Date(value || "");
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  const fallbackParsed = new Date(fallback || "");
  return Number.isFinite(fallbackParsed.getTime()) ? fallbackParsed.toISOString() : "";
}

function mineFunnelRows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : [];
}

function durableCompilerProblems(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((problem) => {
    if (!problem || typeof problem !== "object" || Array.isArray(problem)) return [];
    try {
      return [JSON.parse(JSON.stringify(problem))];
    } catch {
      return [];
    }
  });
}

function compilerProblemDetailForContinuation(value = {}) {
  const problems = durableCompilerProblems(value.problems || value.detail);
  return problems.length ? { problems, detail: problems } : {};
}

function withTerminalPickCause(mineFunnel, errorCode, causeCode, at, problems = []) {
  const safeCause = safeTerminalPickCause(causeCode);
  const durableProblems = durableCompilerProblems(problems);
  if (!safeCause && !durableProblems.length) return mineFunnel;
  const rows = Array.isArray(mineFunnel)
    ? mineFunnelRows(mineFunnel)
    : mineFunnel && typeof mineFunnel === "object"
      ? [mineFunnel]
      : [];
  return rows
    .filter((row) => String(row.stage || "") !== TERMINAL_PICK_CAUSE_STAGE)
    .concat([{
      stage: TERMINAL_PICK_CAUSE_STAGE,
      error_code: safeCode(errorCode, "pick_terminal"),
      ...(safeCause ? { cause_code: safeCause } : {}),
      ...(durableProblems.length ? { problems: durableProblems } : {}),
      at,
    }])
    .slice(-80);
}

function terminalPickCausePatch(mineFunnel, errorCode, causeCode, at, problems = []) {
  if (errorCode !== "intake_genie_compile_terminal") return {};
  const next = withTerminalPickCause(mineFunnel, errorCode, causeCode, at, problems);
  return next === mineFunnel ? {} : { mineFunnel: next };
}

function startWatchFrom(mineFunnel) {
  return mineFunnelRows(mineFunnel).find((row) => String(row.stage || "") === START_WATCH_STAGE) || null;
}

function withStartWatch(mineFunnel, patch = {}) {
  const rows = mineFunnelRows(mineFunnel).filter((row) => String(row.stage || "") !== START_WATCH_STAGE);
  const prior = startWatchFrom(mineFunnel) || {};
  return rows.concat([{ ...prior, stage: START_WATCH_STAGE, ...patch }]).slice(-80);
}

// --- Campaign stopwatch ------------------------------------------------------
//
// The owner's bar is a defensible end-to-end table, not dashboard impressions.
// Every legal row transition already appends an immutable history entry
// (line-state advanceRow), so the exact wall-clock moments are durable; these
// helpers surface them as ONE batch-level timing record (stage
// line_campaign_timing_v1) inside mine_funnel. Fields are stamped once and
// never recomputed, so the record is monotonic: an earlier value can never be
// replaced by a later observation. Funnel stage entries additionally get a
// one-time `elapsedMs` (ms since campaign start) at their first persistence
// through this module, which survives quota re-merges verbatim.

const CAMPAIGN_TIMING_TRANSITIONS = Object.freeze({
  qualified: "firstQualifiedAt",
  mirrored: "firstBuiltAt",
  gate_passed: "firstGateAt",
  sent: "firstSentAt",
});

function campaignTimingFrom(mineFunnel) {
  const row = mineFunnelRows(mineFunnel).find((candidate) => (
    String(candidate.stage || "") === CAMPAIGN_TIMING_STAGE
  ));
  return row && typeof row === "object" ? row : null;
}

function campaignStartAt(batch) {
  if (Number.isFinite(parsedTime(batch?.startedAt))) return batch.startedAt;
  if (Number.isFinite(parsedTime(batch?.createdAt))) return batch.createdAt;
  return "";
}

function firstRowTransitionAt(rows, status) {
  let earliest = Number.POSITIVE_INFINITY;
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const entry of Array.isArray(row && row.history) ? row.history : []) {
      if (!entry || String(entry.status || "") !== status) continue;
      const at = parsedTime(entry.at);
      if (Number.isFinite(at) && at < earliest) earliest = at;
    }
  }
  return Number.isFinite(earliest) ? new Date(earliest).toISOString() : "";
}

function withStageElapsedMs(mineFunnel, startedAt, at) {
  const rows = mineFunnelRows(mineFunnel);
  if (!rows.length) return mineFunnel;
  const startedMs = parsedTime(startedAt);
  const atMs = parsedTime(at);
  if (!Number.isFinite(startedMs) || !Number.isFinite(atMs)) return mineFunnel;
  let changed = false;
  const next = rows.map((row) => {
    if (Number.isFinite(Number(row && row.elapsedMs))) return row;
    changed = true;
    return { ...row, elapsedMs: Math.max(0, atMs - startedMs) };
  });
  return changed ? next : mineFunnel;
}

function withCampaignTiming(mineFunnel, batch) {
  const startedAt = campaignStartAt(batch);
  const prior = campaignTimingFrom(mineFunnel) || {};
  const timed = { ...prior };
  let changed = false;
  if (startedAt && !prior.startedAt) {
    timed.startedAt = startedAt;
    changed = true;
  }
  for (const [status, field] of Object.entries(CAMPAIGN_TIMING_TRANSITIONS)) {
    if (timed[field]) continue;
    const firstAt = firstRowTransitionAt(batch && batch.rows, status);
    if (firstAt) {
      timed[field] = firstAt;
      changed = true;
    }
  }
  if (!changed) return mineFunnel;
  const rows = mineFunnelRows(mineFunnel)
    .filter((row) => String(row.stage || "") !== CAMPAIGN_TIMING_STAGE);
  return rows.concat([{ ...timed, stage: CAMPAIGN_TIMING_STAGE }]).slice(-80);
}

function parsedTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function latestTime(values = []) {
  const valid = values.map(parsedTime).filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : Number.NaN;
}

function activeRowLease(batch, at) {
  return (batch?.rows || []).some((row) => (
    Boolean(String(row?.leaseToken || "").trim())
    && parsedTime(row?.leaseExpiresAt) > at
  ));
}

function semanticProgressAt(batch) {
  const watch = startWatchFrom(batch?.mineFunnel);
  const rows = batch?.rows || [];
  const rowProgress = rows.flatMap((row) => [
    row?.updatedAt,
    row?.deliveryProviderAttemptedAt,
    row?.providerAcceptedAt,
  ]);
  // Delivery has a short, legitimate gap between the batch CAS to `sending`
  // and the first queued-row lease.  `send_claimed_at` is written in that same
  // CAS, so a queue retry or rescue cron cannot mistake the gap for an orphan
  // and reopen the human-approved batch underneath the active sender.
  const progress = latestTime([
    watch?.claimed_at,
    watch?.send_claimed_at,
    watch?.heartbeat_at,
    watch?.pick_stage_at,
    ...rowProgress,
  ]);
  if (Number.isFinite(progress)) return progress;
  // Empty legacy batches predate the claim marker. They have no row progress
  // to distinguish from housekeeping, so updatedAt remains the conservative
  // fallback until their next claim writes the durable marker below.
  return rows.length ? latestTime([batch?.startedAt, batch?.createdAt]) : parsedTime(batch?.updatedAt);
}

function providerAttemptAt(batch) {
  return latestTime((batch?.rows || []).flatMap((row) => [
    row?.providerAcceptedAt,
    row?.deliveryProviderAttemptedAt,
    row?.deliveryPreparedAt,
  ]));
}

function quotaHaltReason(batch, reason = "quota_source_exhausted") {
  const requested = Math.max(Number(batch && batch.requested) || 0, 0);
  const finished = quota.finishedRows(batch).length;
  const attempts = quota.sourceAttempt(batch && batch.mineFunnel);
  return `${reason}:${finished}_of_${requested}_finished_after_${attempts}_source_attempts`;
}

function heroPaidCandidateBudgetHaltReason(batch) {
  const requested = Math.max(Number(batch && batch.requested) || 0, 0);
  const finished = quota.finishedRows(batch).length;
  return `hero_paid_candidate_budget_exhausted:${finished}_of_${requested}`;
}

function fastRefillEnabled(environment = process.env) {
  return String(environment?.GHOST_AGENCY_LINE_FAST_REFILL ?? "1").trim() !== "0";
}

function queueDueOnlyEnabled(environment = process.env) {
  return String(environment?.GHOST_AGENCY_QUEUE_DUE_ONLY ?? "1").trim() !== "0";
}

function rowQueueFanoutEnabled(environment = process.env) {
  return String(environment?.GHOST_AGENCY_LINE_QUEUE_CONCURRENCY ?? "1").trim() !== "0";
}

// IN-BATCH SLOW-SOURCE MEMO (campaign speed, 2026-09-02). Batch
// line_mtkw4rlq_c830312fdd burned minutes per rotation when every prospect's
// Genie compile died client-side (`intake_genie_timeout`) and the phase then
// re-mined the same slow source after a 60s delay. A source whose candidates
// accumulate SLOW_COMPILE_TIMEOUT_THRESHOLD timeout-class compile casualties
// is slow FOR THIS BATCH ONLY: the durable start-watch records it, the next
// source selection skips it while a different target is derivable, and a
// starved pass rotates at the 1s fast-refill floor instead of the 60s retry
// floor. Non-timeout transients (5xx/429) are service health, not source
// speed, and keep the conservative retry floor.
const SLOW_COMPILE_TIMEOUT_THRESHOLD = 2;
const MAX_SLOW_SOURCE_SKIPS = 3;
const SLOW_COMPILE_MEMO_KEY = "slow_compile_sources";

function slowCompileSlug(target) {
  return String(target || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "source";
}

function slowCompileSourceEntries(batch) {
  const watch = startWatchFrom(batch && batch.mineFunnel);
  const raw = watch && watch[SLOW_COMPILE_MEMO_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function slowCompileSourceIsSlow(batch, sourceTarget) {
  const entry = slowCompileSourceEntries(batch)[slowCompileSlug(sourceTarget)];
  return Number(entry && entry.timeouts || 0) >= SLOW_COMPILE_TIMEOUT_THRESHOLD;
}

// Cumulative in-batch memo patch for one source's timeout-class compile
// casualties. Returns null when there is nothing threshold-relevant to
// remember yet (zero new timeouts and no prior entry).
function slowCompileMemoPatch(batch, sourceTarget, timeoutCount, at) {
  const target = String(sourceTarget || "").trim();
  if (!target) return null;
  const entries = slowCompileSourceEntries(batch);
  const key = slowCompileSlug(target);
  const prior = Number(entries[key] && entries[key].timeouts || 0);
  const added = Math.max(0, Number(timeoutCount) || 0);
  if (!entries[key] && added < 1) return null;
  return {
    [SLOW_COMPILE_MEMO_KEY]: {
      ...entries,
      [key]: {
        target: target.slice(0, 160),
        timeouts: prior + added,
        at,
      },
    },
  };
}

function inlinePickQualificationEnabled(environment = process.env) {
  return String(environment?.GHOST_AGENCY_LINE_INLINE_QUALIFY ?? "1").trim() !== "0";
}

function rowLeaseActive(row, at = Date.now()) {
  return Boolean(String(row?.leaseToken || "").trim())
    && parsedTime(row?.leaseExpiresAt) > at;
}

function rowLeaseDelaySeconds(row, at = Date.now()) {
  const expiresAt = parsedTime(row?.leaseExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > at
    ? Math.max(1, Math.ceil((expiresAt - at) / 1000))
    : 0;
}

function rowRetryDelaySeconds(row, at = Date.now()) {
  const retryAt = parsedTime(row?.buildRetryAfter);
  return Number.isFinite(retryAt) && retryAt > at
    ? Math.max(1, Math.ceil((retryAt - at) / 1000))
    : 0;
}

function workerPersistenceOptions(context = {}) {
  return {
    ...(context.signal ? { signal: context.signal } : {}),
    ...(Number(context.deadlineAt) > 0 ? { deadlineAt: Number(context.deadlineAt) } : {}),
  };
}

function buildRetryDelay(attempt) {
  const exponent = Math.max(0, Math.min(Number(attempt) - 1, 10));
  return Math.min(BUILD_RETRY_BASE_MS * (2 ** exponent), BUILD_RETRY_MAX_MS);
}

function ownerProofFreshRetryDelay(attempt) {
  const exponent = Math.max(0, Math.min(Number(attempt) - 1, 10));
  return Math.min(
    OWNER_PROOF_FRESH_RETRY_BASE_MS * (2 ** exponent),
    OWNER_PROOF_FRESH_RETRY_MAX_MS,
  );
}

function ownerProofFreshRetryDelaySeconds(row, at = Date.now()) {
  const retryAt = parsedTime(row?.ownerProofFreshRetryAfter);
  return Number.isFinite(retryAt) && retryAt > at
    ? Math.max(1, Math.ceil((retryAt - at) / 1000))
    : 0;
}

function ownerProofFreshRetryKind({ lane, retryableBeforeProvider, reason, releaseFailureKind } = {}) {
  if (lane !== "sandbox" || retryableBeforeProvider !== true) return "";
  if (reason === OWNER_PROOF_PUBLIC_RELEASE_UNAVAILABLE) {
    return releaseFailureKind === "transient" ? "public_release" : "";
  }
  if (reason === OWNER_PROOF_DEADLINE_EXHAUSTED) return "deadline";
  if (reason === OWNER_PROOF_SIGNAL_VISIBILITY_RETRY) return "signal_visibility";
  return "";
}

function ownerProofFreshRetryExhaustedReason(kind) {
  if (kind === "public_release") return OWNER_PROOF_PUBLIC_RELEASE_RETRY_EXHAUSTED;
  if (kind === "deadline") return OWNER_PROOF_DEADLINE_RETRY_EXHAUSTED;
  if (kind === "signal_visibility") return OWNER_PROOF_SIGNAL_VISIBILITY_RETRY_EXHAUSTED;
  return "owner_proof_fresh_retry_exhausted";
}

function pickedRows(picked, now, startIndex = 0, { requireContactVerdict = false } = {}) {
  return (Array.isArray(picked) ? picked : []).map((prospect, offset) => {
    const contactReady = requireContactVerdict
      ? prospect.contactReady === true
      : prospect.contactReady === true || Boolean(prospect.email || prospect.hasEmail);
    return {
      ...lineState.newRow({ ...prospect, email: contactReady ? prospect.email : "", now }),
      rowIndex: startIndex + offset,
      qualification: prospect.qualification,
      proof: prospect.proof,
      brand_evidence: prospect.brand_evidence,
      currentWebsite: String(prospect.currentWebsite || prospect.current_website || "").trim(),
      ...(prospect.ownedPhotoBank || prospect.owned_photo_bank
        ? { ownedPhotoBank: prospect.ownedPhotoBank || prospect.owned_photo_bank }
        : {}),
      contractIssue: prospect.contractIssue,
      leadminerQualified: prospect.leadminerQualified === true,
      durableUpdatedAt: prospect.durableUpdatedAt,
      email: contactReady ? String(prospect.email || "").trim() : "",
      hasEmail: contactReady && Boolean(prospect.email || prospect.hasEmail),
      contactReady,
      contactSource: String(prospect.contactSource || ""),
      genieContentCertified: prospect.genieContentCertified === true,
    };
  });
}

const TERMINAL_EXACT_PICK_ERRORS = new Set([
  "explicit_prospect_ids_invalid",
  "explicit_prospect_store_identity_mismatch",
  "explicit_prospect_ids_not_found",
  "explicit_prospect_already_attempted",
  "explicit_prospect_ids_ineligible",
]);

function exactPickErrorRetryable(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  if (TERMINAL_EXACT_PICK_ERRORS.has(code)) return false;
  if (error?.retryable === true || error?.name === "AbortError" || code === "line_phase_timeout") return true;
  const evidence = `${code} ${String(error?.message || "").trim().toLowerCase()}`;
  return /(?:read_failed|persist_failed|compare_and_swap|\bcas\b|timed?_?out|timeout|temporar|unavailable|econnreset|eai_again|enet(?:down|reset|unreach)|ehostunreach|network|socket|fetch_failed)/.test(evidence);
}

// A campaign must not replay the same first market/query shape as every other
// campaign, but a retry of the same durable batch must reproduce its source
// geometry exactly. The batch id is already public operational identity, so a
// domain-separated hash is stable without introducing a secret or persisted
// mutable cursor.
function campaignQueryGeometry(batchId) {
  const durableId = String(batchId || "").trim();
  if (!durableId) return { queryShapeCursor: 0, queryGroupOffset: 0 };
  const digest = createHash("sha256")
    .update(`line_campaign_query_geometry_v1\0${durableId}`)
    .digest();
  return {
    queryShapeCursor: digest.readUInt32BE(0),
    queryGroupOffset: digest.readUInt32BE(4),
  };
}

function gateWithCapture(overrides = {}) {
  const capture = overrides.captureEmailAssets || captureLineEmailAssets;
  const runGate = overrides.runRenderGate || runRenderGate;
  const clock = overrides.clock || (() => Date.now());
  return async function gate(args = {}) {
    const build = args.build || {};
    const proofIdentitySupplied = Object.prototype.hasOwnProperty.call(build, "proofIdentity");
    return runGate({
      ...args,
      capture: async ({ browser, url }) => {
        const deadlineAt = Number(args.deadlineAt);
        const remaining = Number.isFinite(deadlineAt) && deadlineAt > 0
          ? deadlineAt - clock() - CAPTURE_PERSISTENCE_RESERVE_MS
          : CAPTURE_BUDGET_MS;
        const budgetMs = Math.max(1, Math.min(CAPTURE_BUDGET_MS, Math.floor(remaining)));
        return capture({
          browser,
          previewUrl: url,
          currentWebsite: build.currentWebsite || "",
          buildHash: build.buildHash || "",
          ...(proofIdentitySupplied ? { proofIdentity: build.proofIdentity } : {}),
          budgetMs,
          signal: args.signal,
          deadlineAt: args.deadlineAt,
          // Capture the "alive" motion loop for the email's after-slot. It runs
          // strictly last on the already-open gate Chromium, is budget-gated
          // (skipped with anim_reason when < MOTION_MIN_MS remains), and the
          // ok-verdict is decoupled from motion — so it never holds a verified
          // site in `mirrored`, and the send path falls back to the static still
          // exactly as before when it can't be made.
          motion: true,
        });
      },
    });
  };
}

function defaultQualify(row) {
  if (row.leadminerQualified === true) return { ok: true, reason: "" };
  const verdict = qualifyForBuild(row.qualification || {});
  return { ok: verdict.ok === true, reason: (verdict.reasons || []).join("; ") };
}

function seedLogoClaims(rows) {
  const claims = new Map();
  for (const row of rows || []) {
    if (!row || !["gate_passed", "ready", "queued", "sent"].includes(row.status)) continue;
    const sha = String(row.logoSha256 || "").trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(sha)) claims.set(sha, row.prospectId);
  }
  return claims;
}

function hasDurableApproval(batch) {
  const approval = batch && batch.approval;
  if (!approval || typeof approval !== "object") return false;
  if (String(approval.typedBatchId || "").trim() !== String(batch.batchId || "").trim()) return false;
  if (!String(approval.actor || "").trim()) return false;
  if (String(batch.lane || "") === "live"
    && String(approval.actor || "").trim() !== "owner_typed_batch_id") return false;
  if (!Number.isFinite(Date.parse(String(approval.at || "")))) return false;
  return Number.isInteger(Number(approval.approvedRows)) && Number(approval.approvedRows) > 0;
}

function strandedReadyRows(batch) {
  return (batch && Array.isArray(batch.rows) ? batch.rows : []).filter((row) => lineState.strandedReadyRow(row));
}

const ACTIVE_PRACTICE_BATCH_STATUSES = new Set([
  "building", "running", "awaiting_approval", "approved", "sending",
]);
const DELIVERED_PRACTICE_ROW_STATUSES = new Set(["ready", "gate_passed", "queued", "sent"]);
const RECOVERABLE_PROSPECT_STATUSES = new Set(["new", "reported", "held"]);

function practiceRowHasDeliveredArtifact(raw = {}) {
  const payload = raw?.payload && typeof raw.payload === "object" ? raw.payload : {};
  const status = String(raw.status || payload.status || "").trim().toLowerCase();
  if (DELIVERED_PRACTICE_ROW_STATUSES.has(status)) return true;
  return [
    payload.previewUrl, payload.preview_url,
    payload.providerReceipt, payload.provider_receipt,
    payload.providerAcceptedAt, payload.provider_accepted_at,
    payload.sentAt, payload.sent_at,
  ].some((value) => String(value || "").trim());
}

function recoverableExactProspect(row = {}) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  const status = String(row.status || record.status || "").trim().toLowerCase();
  if (!RECOVERABLE_PROSPECT_STATUSES.has(status)) return false;
  return ![
    row.preview_url, row.previewUrl, record.preview_url, record.previewUrl,
    row.sent_at, row.sentAt, record.sent_at, record.sentAt,
    record.provider_receipt, record.providerReceipt,
  ].some((value) => String(value || "").trim());
}

function exactPracticeRecoveryPlan({ prospects = [], batches = [], historyRows = [], verifyReceipt } = {}) {
  const historyKeys = adapters.historicalPracticeIdentities(historyRows);
  const batchStatus = new Map(batches.map((batch) => [
    String(batch?.batch_id || batch?.batchId || ""),
    String(batch?.status || "").trim().toLowerCase(),
  ]));
  const recoverable = new Map();
  for (const prospect of prospects) {
    const identity = adapters.practiceIdentity(prospect);
    if (!identity.prospectId || !identity.keys.length || !recoverableExactProspect(prospect)) continue;
    const receipt = typeof verifyReceipt === "function" ? verifyReceipt(prospect) : { ok: false };
    if (receipt?.ok !== true) continue;
    const matches = historyRows.filter((raw) => {
      const payload = raw?.payload && typeof raw.payload === "object" ? raw.payload : {};
      const prior = adapters.practiceIdentity({
        ...payload,
        prospect_id: raw?.prospect_id || payload.prospect_id || payload.prospectId,
      });
      return prior.keys.some((key) => identity.keys.includes(key));
    });
    if (!matches.length) continue;
    const safe = matches.every((raw) => {
      const status = batchStatus.get(String(raw?.batch_id || raw?.batchId || ""));
      const rowStatus = String(raw?.status || raw?.payload?.status || "").trim().toLowerCase();
      if (!status || ACTIVE_PRACTICE_BATCH_STATUSES.has(status)) return false;
      if (practiceRowHasDeliveredArtifact(raw)) return false;
      return status === "halted" || ["rejected", "error"].includes(rowStatus);
    });
    if (safe) recoverable.set(identity.prospectId.toLowerCase(), new Set(identity.keys));
  }
  const filteredKeys = new Set(historyKeys);
  for (const keys of recoverable.values()) for (const key of keys) filteredKeys.delete(key);
  return { historyKeys: filteredKeys, recoverable };
}

async function loadExactPracticeRecoverySnapshot(read, prospectIds, requestOptions = {}) {
  const interrupted = () => {
    if (requestOptions.signal?.aborted === true) return true;
    const numeric = Number(requestOptions.deadlineAt);
    const deadline = Number.isFinite(numeric) ? numeric : Date.parse(String(requestOptions.deadlineAt || ""));
    return Number.isFinite(deadline) && Date.now() >= deadline;
  };
  if (interrupted()) return null;
  const escapedProspects = prospectIds.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(",");
  const exact = await read(
    "ghost_agency_prospects",
    `?select=*&prospect_id=in.(${escapedProspects})&limit=${prospectIds.length}`,
    requestOptions,
  ).catch(() => null);
  if (!exact?.ok || !Array.isArray(exact.data) || exact.data.length !== prospectIds.length) return null;

  const batches = [];
  // Same lookback window as the practice-history scan (PRACTICE_HISTORY_LOOK-
  // BACK_DAYS dial in line-adapters): recovery evidence is a recent-window
  // business need, and paging every sandbox batch ever created is the same
  // unbounded read that timed Supabase out on live batch line_mtolbe4s.
  const lookbackDays = adapters.practiceHistoryLookbackDays();
  const lookbackCutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const batchWindowQuery = `&created_at=gte.${encodeURIComponent(lookbackCutoff)}`;
  for (let offset = 0; ; offset += 1000) {
    if (interrupted()) return null;
    const page = await read(
      "ghost_agency_line_batches",
      `?select=batch_id,status&lane=eq.sandbox&order=created_at.asc&limit=1000&offset=${offset}${batchWindowQuery}`,
      requestOptions,
    ).catch(() => null);
    if (!page?.ok || !Array.isArray(page.data)) return null;
    batches.push(...page.data);
    if (page.data.length < 1000) break;
  }
  const historyRows = [];
  const batchIds = batches.map((batch) => String(batch?.batch_id || "")).filter(Boolean);
  for (let start = 0; start < batchIds.length; start += 100) {
    const ids = batchIds.slice(start, start + 100).map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
    for (let offset = 0; ; offset += 1000) {
      if (interrupted()) return null;
      const page = await read(
        "ghost_agency_line_batch_rows",
        `?select=batch_id,prospect_id,status,payload&batch_id=in.(${ids})&order=created_at.asc&limit=1000&offset=${offset}`,
        requestOptions,
      ).catch(() => null);
      if (!page?.ok || !Array.isArray(page.data)) return null;
      historyRows.push(...page.data);
      if (page.data.length < 1000) break;
    }
  }
  return { prospects: exact.data, batches, historyRows };
}

function markStaleBatchGeneration(batch) {
  if (!batch || typeof batch !== "object") return batch;
  Object.defineProperty(batch, STALE_BATCH_GENERATION, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return batch;
}

function isStaleBatchGeneration(batch) {
  return Boolean(batch && batch[STALE_BATCH_GENERATION] === true);
}

function createLineContinuation(dependencies = {}) {
  const persistence = dependencies.persistence || persistenceDefaults;
  const enqueue = dependencies.enqueueLineMessage || enqueueLineMessage;
  const nextQuotaSource = dependencies.nextQuotaSource || quota.nextQuotaSource;
  const lineEnvironment = dependencies.env || process.env;
  // PROSPECT BANK (owner doctrine 2026-09-02): campaigns draw banked-first and
  // mine only the deficit. Injectable so tests can pin the draw/deposit seams
  // without a live store.
  const bank = dependencies.bank || bankDefaults;
  const processPhase = dependencies.processRowPhase || runner.processRowPhase;
  const senderFactory = dependencies.createLineSender || createLineSender;
  // TERMINAL-ROW TRUTH (injectable for tests): the durable event a row writes
  // when it reaches a terminal error state. See recordRowTerminalEvent below.
  const recordTerminalEvent = dependencies.recordEvent || storeDefaults.recordEvent;
  const clearSignalReportCache = dependencies.clearSignalReportCache
    || (() => require("./report-grade").clearReportGradeCache());
  const signalReportRetryWait = dependencies.waitForSignalReportRetry
    || waitForSignalReportRetry;
  const clock = dependencies.clock || (() => Date.now());
  const now = dependencies.now || (() => new Date(clock()).toISOString());
  // Production intentionally advances `clock` to widen the worker deadline
  // while leaving `now` on real wall time. Retry/backoff timestamps are durable
  // ISO dates, so comparing them to that deadline clock makes a fresh 30s hero
  // wait look overdue immediately. Keep deadline arithmetic on `clock`, but use
  // the same wall-time source that writes durable timestamps for retry policy.
  const retryClock = () => {
    const parsed = Date.parse(String(now() || ""));
    return Number.isFinite(parsed) ? parsed : clock();
  };
  /**
   * TERMINAL-ROW TRUTH (owner watch, 2026-09-03). A row can reach terminal
   * error while the site it built is ALREADY LIVE: the mirror build activates
   * the shared release inside the attempt, and a later step in that same
   * attempt (or the next of the retry budget) can still fail retryably until
   * build_retry_exhausted marks the row terminal. The activation outlives the
   * row, and nothing recorded the row state it came from — Altitude Roofing
   * sat exactly there (site live, row error/build_retry_exhausted).
   *
   * One durable, PII-free event per terminal error closes the reconciliation
   * gap WITHOUT un-publishing anything: it names the row, the terminal
   * reason, and every release identity the row can prove, so public
   * activations can be joined against row states instead of inferred. The
   * checkpoint below remains the row's authority; this event is fail-soft.
   */
  const recordRowTerminalEvent = async (batchId, row, reason) => {
    const release = row && (row.releaseEvidence || row.release_evidence) || null;
    const releaseProof = release && (release.proofIdentity || release.proof_identity) || null;
    const proof = (row && (row.proofIdentity || row.proof_identity)) || releaseProof || null;
    const payload = {
      batch_id: String(batchId || ""),
      row_id: String((row && row.rowId) || ""),
      prospect_id: String((row && row.prospectId) || ""),
      status: "error",
      reason: safeCode(reason || (row && row.reason) || "", "row_error"),
      build_hash: String((row && (row.buildHash || row.build_hash)) || proof && proof.build_hash || ""),
      preview_url: String((row && (row.previewUrl || row.preview_url)) || ""),
      site_id: String((proof && proof.site_id) || (release && release.site_id) || ""),
      release_id: String((proof && proof.release_id) || (release && release.release_id) || ""),
      build_retry_attempts: Number((row && row.buildRetryAttempts) || 0) || undefined,
      last_retryable_error: String((row && row.lastRetryableError) || ""),
      at: now(),
    };
    try {
      await recordTerminalEvent("line.row_terminal", payload);
    } catch { /* the terminal checkpoint below is the authority; never block on this */ }
  };
  const pick = dependencies.pick || (async (input) => {
    let adapterDeps = {};
    const exactIds = input?.lane === "sandbox" && Array.isArray(input.prospectIds)
      ? input.prospectIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (exactIds.length) {
      const read = dependencies.select || storeDefaults.select;
      const snapshot = await loadExactPracticeRecoverySnapshot(read, exactIds, {
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });
      if (snapshot) {
        const verify = dependencies.verifyGenieContentReceipt || ((row) => {
          const verifyOptions = { nowMs: retryClock() };
          if (Object.prototype.hasOwnProperty.call(dependencies, "certificationKey")) {
            verifyOptions.certificationKey = dependencies.certificationKey;
          }
          return adapters.verifiedGenieContentReceipt(row, row.record, verifyOptions);
        });
        const recovery = exactPracticeRecoveryPlan({ ...snapshot, verifyReceipt: verify });
        if (recovery.recoverable.size) {
          adapterDeps = {
            readPracticeHistory: async () => ({ ok: true, keys: recovery.historyKeys }),
            claimPracticeIdentity: async (identity, claimOptions) => {
              const allowed = recovery.recoverable.get(String(identity?.prospectId || "").toLowerCase());
              if (allowed && identity.keys?.length && identity.keys.every((key) => allowed.has(key))) {
                return { ok: true, recovered: true };
              }
              return adapters.claimPracticeIdentity(identity, claimOptions);
            },
          };
        }
      }
    }
    return adapters.pickProspects(input, {
      ...adapterDeps,
      // PROSPECT BANK — SURPLUS DEPOSIT SEAM: the adapter banks compiled
      // survivors its count truncation drops; the continuation owns the bank
      // wiring (and its env/test injection) so direct adapter probes stay
      // bank-free exactly as they stay claim-free above.
      ...(bank.bankEnabled(lineEnvironment)
        ? {
          bankDepositSurplus: (surplusRows, surplusOptions = {}) => bank.depositProspects({
            rows: surplusRows,
            depositedBy: "pick_surplus",
            sourceBatchId: String(input && input.operationKey || "").slice(0, 160),
            now: now(),
            environment: lineEnvironment,
            requestOptions: {
              signal: surplusOptions.signal,
              deadlineAt: surplusOptions.deadlineAt,
            },
          }),
        }
        : {}),
    });
  });
  const workerId = dependencies.workerId || (() => `line_worker_${randomUUID()}`);
  const rowClaim = boundedInteger(
    dependencies.rowClaim ?? process.env.GHOST_AGENCY_LINE_ROW_CLAIM,
    DEFAULT_ROW_CLAIM,
    1,
    MAX_ROW_CLAIM,
  );
  const rowFanout = dependencies.rowFanout == null
    ? rowQueueFanoutEnabled(dependencies.env || process.env)
    : dependencies.rowFanout !== false;
  const inlinePickQualification = dependencies.inlinePickQualification == null
    ? inlinePickQualificationEnabled(dependencies.env || process.env)
    : dependencies.inlinePickQualification !== false;
  const phaseDeps = {
    qualify: dependencies.qualify || defaultQualify,
    startHero: dependencies.startHero || adapters.startQualifiedHero,
    mirror: dependencies.mirror || adapters.mirrorProspect,
    prepareHero: dependencies.prepareHero || adapters.prepareMirroredHero,
    sourceFacts: dependencies.sourceFacts || adapters.sourceFactsFor,
    gate: dependencies.gate || gateWithCapture(dependencies),
    // LIGHT verification still shoots the email's proof shots in the gate
    // phase (line-runner). The full gate below supplies its own capture hook;
    // this dep is what the light skip calls instead of the whole gate.
    // Production (line-continuation-production) wires the real
    // captureLineEmailAssets; unwired means a light row captures nothing.
    ...(dependencies.captureEmailAssets
      ? { captureEmailAssets: dependencies.captureEmailAssets }
      : {}),
    writePreviewUrl: dependencies.writePreviewUrl || adapters.writePreviewUrl,
    queueEmail: dependencies.queueEmail || adapters.queueEmail,
    // SEND-ON-FINISH (owner directive 2026-09-01). The SAME sender factory the
    // settle-send uses in advanceSend, with the same sequence/step, so a row
    // sent at finish carries the exact provider idempotency key the settle-send
    // would mint — a replayed or lost-checkpoint delivery cannot double-send.
    // Lane (sandbox only) and the GHOST_AGENCY_SEND_ON_FINISH switch are
    // enforced inside processRowPhase; a refusal here leaves the row "queued"
    // for the settle path exactly as before.
    sendOnFinish: dependencies.sendOnFinish || (async (row, options = {}) => {
      if (options.lane !== "sandbox") return { ok: false, reason: "send_on_finish_sandbox_only" };
      const sender = senderFactory({
        lane: "sandbox",
        batchId: String(options.batchId || ""),
        deps: dependencies.deliveryDeps || {},
      });
      return sender(row, { sequence: 1, step: 1, deadlineAt: options.deadlineAt });
    }),
    now,
    ...(dependencies.phaseDeps || {}),
  };

  async function loadParentForWork(batchId, allowedStatuses, requestOptions = {}) {
    const loaded = await persistence.loadBatch(batchId, requestOptions);
    if (!loaded.ok || !loaded.batch) {
      throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(loaded.error) });
    }
    const status = String(loaded.batch.status || "");
    if (status === "halted") return { ok: false, skipped: "batch_halted", batch: loaded.batch };
    if (Array.isArray(allowedStatuses) && !allowedStatuses.includes(status)) {
      return { ok: false, skipped: `batch_${safeCode(status, "unavailable")}`, batch: loaded.batch };
    }
    return { ok: true, batch: loaded.batch };
  }

  async function publishNext(batch, phase = "run", options = {}) {
    const expected = phase === "send" ? "approved" : "building";
    if (!batch || batch.status !== expected) return { accepted: false, skipped: `not_${expected}` };
    const parent = await loadParentForWork(batch.batchId, [expected], options.requestOptions || {});
    if (!parent.ok) return { accepted: false, skipped: parent.skipped };
    if (Number(parent.batch.version) !== Number(batch.version)) {
      return { accepted: false, skipped: "batch_generation_stale" };
    }
    try {
      return await enqueue({
        batchId: batch.batchId,
        phase,
        sequence: Math.max(Number(batch.version) || 0, 0)
          + Math.max(Number(options.sequenceOffset) || 0, 0),
        ...(Number(options.delaySeconds) > 0 ? { delaySeconds: Math.ceil(Number(options.delaySeconds)) } : {}),
      });
    } catch (_) {
      // Canonical state is already safe. The rescue cron calls this same
      // service and will claim the batch even if queue publication is down.
      return { accepted: false, error: "line_queue_publish_failed" };
    }
  }

  async function publishRowContinuation(batch, row, options = {}) {
    if (!batch || !row || !["building", "running"].includes(String(batch.status || ""))) {
      return { accepted: false, skipped: "row_batch_not_building" };
    }
    if (!BROWSER_HEAVY_ROW_STATUSES.includes(String(row.status || ""))) {
      return { accepted: false, skipped: "row_not_browser_heavy" };
    }
    const parent = await loadParentForWork(batch.batchId, ["building", "running"], options.requestOptions || {});
    if (!parent.ok) return { accepted: false, skipped: parent.skipped };
    const durableRow = (parent.batch.rows || []).find((candidate) => String(candidate.rowId || "") === String(row.rowId || ""));
    if (!durableRow
      || Number(durableRow.version) !== Number(row.version)
      || String(durableRow.status || "") !== String(row.status || "")) {
      return { accepted: false, skipped: "row_generation_stale" };
    }
    try {
      return await enqueue({
        batchId: batch.batchId,
        phase: ROW_QUEUE_PHASE,
        rowId: row.rowId,
        // Row version is the exact durable generation. A delayed duplicate can
        // never advance a later phase because the consumer claims this version.
        sequence: Math.max(Number(row.version) || 0, 0),
        ...(Number(options.delaySeconds) > 0 ? { delaySeconds: Math.ceil(Number(options.delaySeconds)) } : {}),
      });
    } catch (_) {
      return { accepted: false, error: "line_row_queue_publish_failed" };
    }
  }

  async function publishHeavyRowWave(batch, options = {}) {
    if (!rowFanout || !batch || !["building", "running"].includes(String(batch.status || ""))) {
      return { accepted: 0, attempted: 0, failed: 0 };
    }
    const at = retryClock();
    const rows = (batch.rows || [])
      .filter((row) => BROWSER_HEAVY_ROW_STATUSES.includes(String(row?.status || "")))
      .filter((row) => !rowLeaseActive(row, at))
      .sort((left, right) => (Number(left.rowIndex) || 0) - (Number(right.rowIndex) || 0))
      .slice(0, boundedInteger(options.limit, MAX_ROW_QUEUE_FANOUT, 1, MAX_ROW_QUEUE_FANOUT));
    if (!rows.length) return { accepted: 0, attempted: 0, failed: 0 };
    const outcomes = await Promise.all(rows.map((row) => publishRowContinuation(batch, row, {
      delaySeconds: rowRetryDelaySeconds(row, at),
    })));
    return {
      accepted: outcomes.filter((outcome) => outcome?.accepted === true).length,
      attempted: rows.length,
      failed: outcomes.filter((outcome) => outcome?.accepted !== true).length,
    };
  }

  async function publishRowWaveRecovery(batch, wave) {
    if (!batch || !wave || wave.failed < 1 || wave.accepted < 1) {
      return { accepted: false, skipped: "row_wave_complete_or_unpublished" };
    }
    // Use a distinct opaque generation so this recovery wake cannot be
    // deduplicated against the delivery that just attempted the fan-out.
    // processLineMessage never treats batch sequence as authority; batch and
    // row CAS remain the only ownership contracts.
    return publishNext(batch, "run", { delaySeconds: 1, sequenceOffset: 1 });
  }

  async function maybeAutoApproveEligibleBatch(batch, requestOptions = {}) {
    if (isStaleBatchGeneration(batch)) return batch;
    if (!batch || batch.status !== "awaiting_approval") return batch;
    // Practice output is owner-only and may continue automatically. Live is a
    // prospect-send lane: QC completion is not owner consent, so it remains at
    // awaiting_approval until the explicit approval contract is satisfied.
    if (String(batch.lane || "") !== "sandbox") return batch;
    if (quota.finishedQuotaEnabled(batch)
      && quota.remainingFinishedQuota(batch) > 0
      && !quota.terminalCertifiedDrainAllowed(batch)) return batch;
    const queued = lineState.batchCounts(batch).queued;
    if (queued < 1) return batch;
    const approved = await persistence.approveBatch({
      batchId: batch.batchId,
      expectedVersion: batch.version,
      typedBatchId: batch.batchId,
      actor: "factory_auto_after_qc",
      approvedRows: queued,
    }, requestOptions);
    if (!approved.ok) return batch;
    const loaded = await persistence.loadBatch(batch.batchId, requestOptions);
    return loaded.ok ? loaded.batch : approved.batch;
  }

  async function claimBatch(batch, requestOptions = {}) {
    if (!batch || batch.status !== "building") return { ok: false, skipped: "not_claimable" };
    const watch = startWatchFrom(batch.mineFunnel);
    const claimed = await persistence.storeBatch({
      batchId: batch.batchId,
      expectedVersion: batch.version,
      expectedStatus: "building",
      patch: {
        status: "running",
        // Every claim records durable worker ownership. This is semantic
        // progress; generic batch heartbeats are not. Older batches without a
        // watch acquire one on their next healthy claim.
        mineFunnel: withStartWatch(batch.mineFunnel, {
          ...(watch || {}),
          claimed_at: now(),
          unclaimed_ticks: 0,
          orphan_ticks: 0,
        }),
        ...(batch.pickState === "pending" ? { pickState: "picking" } : {}),
      },
    }, requestOptions);
    if (!claimed.ok) {
      if (claimed.conflict) return { ok: false, skipped: "claim_lost" };
      throw Object.assign(new Error("line_batch_claim_failed"), { code: safeCode(claimed.error) });
    }
    const loaded = await persistence.loadBatch(batch.batchId, requestOptions);
    if (!loaded.ok) throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(loaded.error) });
    return { ok: true, batch: loaded.batch };
  }

  async function releaseBatch(batch, status, extraPatch = {}, requestOptions = {}) {
    const patch = { status, ...extraPatch };
    // Campaign stopwatch rides the batch CAS this release already performs —
    // timing enrichment only, never an extra write. Each helper returns the
    // SAME reference when there is nothing new, so an untouched release
    // persists the exact patch it always did. A HALT release is excluded on
    // purpose: it is an incident record whose patch shape is pinned by the
    // no-causeCode halt contract (and the campaign is over — the timing
    // record already rode every non-halt release before it).
    if (status !== "halted") {
      const funnelBase = patch.mineFunnel || batch.mineFunnel;
      const timedFunnel = withCampaignTiming(
        withStageElapsedMs(funnelBase, campaignStartAt(batch), now()),
        batch,
      );
      if (timedFunnel !== funnelBase) patch.mineFunnel = timedFunnel;
    }
    const stored = await persistence.storeBatch({
      batchId: batch.batchId,
      expectedVersion: batch.version,
      expectedStatus: batch.status,
      patch,
    }, requestOptions);
    if (!stored.ok) {
      const releaseConflict = stored.conflict === true || safeCode(stored.error) === "batch_version_conflict";
      if (!releaseConflict) {
        throw Object.assign(new Error("line_batch_release_failed"), { code: safeCode(stored.error) });
      }
      const canonical = await persistence.loadBatch(batch.batchId, requestOptions);
      if (!canonical.ok || !canonical.batch) {
        throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(canonical.error) });
      }
      return markStaleBatchGeneration(canonical.batch);
    }
    const loaded = await persistence.loadBatch(batch.batchId, requestOptions);
    if (!loaded.ok) throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(loaded.error) });
    // PROSPECT BANK — HALT DEPOSIT (owner doctrine 2026-09-02): a batch parked
    // in a terminal halt gives its seated-but-unburned candidates back to the
    // bank (its own reservations release; freshly mined rows get a first-time
    // bank entry). Best-effort by design: the halt itself has already landed,
    // and a bank write failure must never turn a settled halt into an error.
    if (status === "halted" && bank.bankEnabled(lineEnvironment)) {
      await bank.depositHaltedBatch({
        batch: loaded.batch,
        now: now(),
        environment: lineEnvironment,
        requestOptions,
      }).catch(() => null);
    }
    return loaded.batch;
  }

  async function runPick(batch, context) {
    const requestOptions = workerPersistenceOptions(context);
    const activeParent = await loadParentForWork(batch.batchId, ["running"], requestOptions);
    if (!activeParent.ok) {
      return { ok: true, batch: activeParent.batch, selected: 0, complete: true, skipped: activeParent.skipped };
    }
    batch = activeParent.batch;
    const exactSelection = explicitProspectSelection(batch);
    if (exactSelection.exact && !exactSelection.valid) {
      const released = await releaseBatch(batch, "halted", {
        pickState: "complete",
        haltReason: safeCode(exactSelection.reason, "explicit_prospect_marker_invalid"),
        settledAt: now(),
      }, requestOptions);
      return { ok: false, retryable: false, batch: released, error: "explicit_prospect_marker_invalid" };
    }
    if (exactSelection.exact && !exactRowsMatchSelection(batch, exactSelection)) {
      const released = await releaseBatch(batch, "halted", {
        pickState: "complete",
        haltReason: "explicit_prospect_rows_mismatch",
        settledAt: now(),
      }, requestOptions);
      return { ok: false, retryable: false, batch: released, error: "explicit_prospect_rows_mismatch" };
    }
    const exactIds = exactSelection.ids;
    const exactMode = exactSelection.exact;
    const existingExactCount = exactMode ? (batch.rows || []).length : 0;
    const remainingExactIds = exactMode ? exactIds.slice(existingExactCount) : [];
    const quotaEnabled = !exactMode && quota.finishedQuotaEnabled(batch);
    const remainingFinished = quotaEnabled ? quota.remainingFinishedQuota(batch) : 0;
    const remainingGoal = exactMode
      ? remainingExactIds.length
      : quotaEnabled
      ? quota.sourceDeficit(batch, lineEnvironment)
      : Math.max(Number(batch.requested) || 0, 0);
    if (quotaEnabled && quota.heroPaidCandidateBudgetBlocksCompletion(batch, lineEnvironment)) {
      const released = await releaseBatch(batch, "halted", {
        pickState: "complete",
        haltReason: heroPaidCandidateBudgetHaltReason(batch),
        settledAt: now(),
      }, requestOptions);
      return { ok: true, batch: released, selected: 0, complete: true, exhausted: true };
    }
    if (quotaEnabled && quota.sourceExhausted(batch)) {
      const draining = quota.terminalCertifiedDrainAllowed(batch);
      const derived = draining
        ? lineState.deriveBuildStatus({ ...batch, pickState: "complete" }, { activeLeases: 0 })
        : "halted";
      const status = draining && derived === "running" ? "building" : derived;
      let released = await releaseBatch(batch, status, {
        pickState: "complete",
        ...(!draining ? { haltReason: quotaHaltReason(batch) } : {}),
        ...(status === "awaiting_approval" || status === "done" || status === "halted"
          ? { settledAt: now() }
          : {}),
      }, requestOptions);
      if (draining) released = await maybeAutoApproveEligibleBatch(released, requestOptions);
      return { ok: true, batch: released, selected: 0, complete: status !== "building", exhausted: !draining };
    }
    if (quotaEnabled && remainingFinished < 1) {
      const counts = lineState.batchCounts(batch);
      const finalStatus = counts.queued > 0 ? "awaiting_approval" : "done";
      const released = await releaseBatch(batch, finalStatus, { pickState: "complete", settledAt: now() }, requestOptions);
      return { ok: true, batch: released, selected: 0, complete: true };
    }
    if (quotaEnabled && remainingGoal < 1) {
      const released = await releaseBatch(batch, "building", { pickState: "complete" }, requestOptions);
      return { ok: true, batch: released, selected: 0, complete: false };
    }


    // PROSPECT BANK — BANK-FIRST DRAW (owner doctrine 2026-09-02): before any
    // source rotation, draw already-banked qualified prospects for this
    // campaign's vertical. Drawn rows seat immediately as picked rows, so the
    // quota controller's sourceDeficit below already counts them and the miner
    // covers ONLY the deficit. A full-coverage draw skips mining entirely — a
    // stocked bank starts the campaign in seconds at near-zero provider cost.
    // Never throws: a degraded draw falls through to the normal mine.
    let pendingBankStage = null;
    let bankDrawnCount = 0;
    if (quotaEnabled && !exactMode && bank.bankEnabled(lineEnvironment) && remainingGoal > 0) {
      const drawSpec = bank.drawSpecForBatch(batch);
      const bankDraw = await bank.drawForCampaign({
        vertical: drawSpec.vertical,
        city: drawSpec.city,
        lane: batch.lane,
        count: remainingGoal,
        batchId: batch.batchId,
        excludeProspectIds: (batch.rows || []).map((row) => String(row.prospectId || "")).filter(Boolean),
        now: now(),
        environment: lineEnvironment,
        requestOptions,
      }).catch(() => null);
      if (bankDraw && Array.isArray(bankDraw.drawn) && bankDraw.drawn.length) {
        const bankRows = pickedRows(bankDraw.drawn, now(), (batch.rows || []).length);
        const bankQuarantined = [];
        const bankSeen = new Set(bankRows.map((row) => String(row.prospectId || "")));
        for (const candidate of (Array.isArray(bankDraw.quarantined) ? bankDraw.quarantined : [])) {
          const id = String(candidate && candidate.prospectId || "").trim();
          if (!id || bankSeen.has(id)) continue;
          bankSeen.add(id);
          const seeded = lineState.newRow({
            prospectId: id,
            businessName: candidate.businessName,
            vertical: candidate.vertical,
            now: now(),
          });
          const terminal = lineState.advanceRow(seeded, "rejected", {
            reason: String(candidate.reason || "bank_candidate_refused").slice(0, 240),
            now: now(),
          });
          bankQuarantined.push(terminal.ok ? terminal.row : { ...seeded, status: "rejected", reason: candidate.reason });
        }
        const bankStoredRows = bankQuarantined.length ? [...bankRows, ...bankQuarantined] : bankRows;
        const bankSaved = await persistence.storeRows({ batchId: batch.batchId, rows: bankStoredRows }, requestOptions);
        if (!bankSaved.ok) {
          // The reservations ride their TTL (a dead worker releases in <=2h);
          // the durable rows are what stop a double-draw, and they may have
          // partially landed — retry the phase, never re-draw the same ids.
          const released = await releaseBatch(batch, "building", {
            pickState: "pending",
            mineFunnel: quota.mergeMineFunnel(batch.mineFunnel, [], {
              attempt: 0,
              sourceTarget: "prospect_bank",
              mode: "bank_draw",
              requested: bankDraw.drawn.length,
              selected: 0,
              contractEntered: Math.max(Number(batch.requested) || 0, 0),
              reason: safeCode(bankSaved.error, "bank_checkpoint_failed"),
            }),
          }, requestOptions);
          return { ok: false, retryable: true, deferRetry: true, batch: released, error: "bank_checkpoint_failed" };
        }
        bankDrawnCount = bankRows.length;
        pendingBankStage = bank.bankDrawFunnelStage(bankDraw, { requested: remainingGoal });
        if (bankDraw.drawn.length >= remainingGoal) {
          const released = await releaseBatch(batch, "building", {
            pickState: "complete",
            mineFunnel: bank.withBankDrawStage(batch.mineFunnel, pendingBankStage),
          }, requestOptions);
          return {
            ok: true,
            batch: released,
            selected: bankDrawnCount,
            complete: false,
            bankDrawn: bankDrawnCount,
          };
        }
        batch = { ...batch, rows: [...(batch.rows || []), ...bankStoredRows] };
      }
    }

    let source = exactMode
      ? { target: EXPLICIT_PROSPECT_TARGET, attempt: 0, mode: "explicit_prospect_ids", chunk: remainingExactIds.length }
      : quotaEnabled
      ? nextQuotaSource(batch, { environment: lineEnvironment })
      : { target: batch.target, attempt: 0, mode: "legacy", chunk: remainingGoal };
    if (quotaEnabled && !exactMode) {
      // SLOW-SOURCE SKIP: advance past sources this batch already marked slow
      // (accumulated timeout-class compile casualties), but only while a
      // DIFFERENT target is actually derivable — a fixed market cannot rotate
      // and the skip count stays bounded so it can never replace the pick.
      let skips = 0;
      while (skips < MAX_SLOW_SOURCE_SKIPS
        && source?.unavailable !== true
        && slowCompileSourceIsSlow(batch, source.target)) {
        const advanced = nextQuotaSource({ ...batch, mineFunnel: [
          ...(Array.isArray(batch.mineFunnel) ? batch.mineFunnel : []),
          { stage: `quota_source_${source.attempt}_${slowCompileSlug(source.target)}` },
        ] }, { environment: lineEnvironment });
        if (advanced?.unavailable === true
          || String(advanced?.target || "") === String(source.target || "")) break;
        source = advanced;
        skips += 1;
      }
    }
    if (quotaEnabled && source?.unavailable === true) {
      const reason = safeCode(source.reason || source.mode, "fresh_source_unavailable");
      const requested = Math.max(1, Math.min(remainingGoal, quota.DEFAULT_SOURCE_CHUNK));
      const mineFunnel = quota.mergeMineFunnel(batch.mineFunnel, [], {
        attempt: source.attempt,
        sourceTarget: "fresh_all_trades",
        mode: source.mode,
        requested,
        selected: 0,
        contractEntered: Math.max(Number(batch.requested) || 0, 0),
        reason,
      });
      const released = await releaseBatch(batch, "halted", {
        pickState: "complete",
        haltReason: reason,
        mineFunnel,
        settledAt: now(),
      }, requestOptions);
      return {
        ok: false,
        retryable: false,
        batch: released,
        selected: 0,
        complete: true,
        exhausted: true,
        error: reason,
        sourceTarget: "",
      };
    }
    const quotaState = (snapshot) => ({
      requested: Math.max(Number(snapshot && snapshot.requested) || 0, 0),
      finished: quota.finishedRows(snapshot).length,
      active: quota.activeRows(snapshot).length,
      remaining_finished: quota.remainingFinishedQuota(snapshot),
      replacement_deficit: quota.replacementDeficit(snapshot),
      source_attempt: source.attempt,
      source_target: source.target,
      source_mode: source.mode,
    });
    const requestedNow = Math.max(1, Math.min(remainingGoal, Number(source.chunk) || remainingGoal));
    const existingIds = (batch.rows || []).map((row) => String(row.prospectId || "")).filter(Boolean);
    const pickOperationKey = `pick_${createHash("sha256")
      .update(`${batch.batchId}\0${source.attempt}\0${source.mode}\0${source.target}`)
      .digest("hex")}`;
    const priorPickWatch = startWatchFrom(batch.mineFunnel) || {};
    const sameOperation = priorPickWatch.pick_operation_key === pickOperationKey;
    const priorOperationAt = parsedTime(priorPickWatch.pick_operation_started_at);
    if (sameOperation && priorPickWatch.pick_operation_state === "in_flight") {
      // There is no provider-side idempotency guarantee. An unknown outcome
      // can therefore never be retried automatically, regardless of age: the
      // original call may have completed after this worker vanished. Halt the
      // batch without rows/quota consumption; a new batch is a new explicit
      // operation if the owner chooses to mine again.
      const settledAt = now();
      const released = await releaseBatch(batch, "halted", {
        pickState: "complete",
        haltReason: "pick_provider_outcome_unknown",
        settledAt,
        mineFunnel: withStartWatch(batch.mineFunnel, {
          pick_stage: "pick_provider_outcome_unknown",
          pick_stage_at: settledAt,
          pick_reason: "manual_new_batch_required",
          pick_operation_state: "outcome_unknown_terminal",
        }),
      }, requestOptions);
      return {
        ok: false,
        retryable: false,
        batch: released,
        error: "pick_provider_outcome_unknown",
      };
    }
    const pickOperationStartedAt = sameOperation
      && priorPickWatch.pick_operation_started_at
      && Number.isFinite(priorOperationAt)
      ? priorPickWatch.pick_operation_started_at
      : now();
    let selected;
    let pickStage = "pick_starting";
    let heartbeatChain = Promise.resolve();
    let heartbeatError = null;
    const checkpointPickStage = (stage, detail = {}) => {
      pickStage = safeCode(stage, "pick_running");
      heartbeatChain = heartbeatChain.then(async () => {
        if (heartbeatError) return;
        const stamp = now();
        const watch = startWatchFrom(batch.mineFunnel) || {};
        const priorOperationState = String(watch.pick_operation_state || "");
        // Per-stage elapsed ms (campaign speed work, 2026-09-02): the funnel
        // already names every pick stage; this makes the NEXT run's speed
        // provable by timing each stage transition on the durable watch.
        const priorStageAt = parsedTime(watch.pick_stage_at);
        const stageElapsedMs = Number.isFinite(priorStageAt) && watch.pick_stage !== pickStage
          ? Math.max(0, Date.parse(stamp) - priorStageAt)
          : null;
        const nextOperationState = detail.operationState
          || (pickStage === "pick_complete" ? "completed" : "in_flight");
        const monotonicOperationState = pickStage !== "pick_complete" && !detail.operationState
          && ["accepted", "completed"].includes(priorOperationState)
          ? priorOperationState
          : nextOperationState;
        const stored = await persistence.storeBatch({
          batchId: batch.batchId,
          expectedVersion: batch.version,
          expectedStatus: "running",
          patch: {
            mineFunnel: withStartWatch(batch.mineFunnel, {
              ...watch,
              heartbeat_at: stamp,
              pick_stage: pickStage,
            pick_stage_at: stamp,
            ...(stageElapsedMs !== null ? { pick_stage_elapsed_ms: stageElapsedMs } : {}),
            pick_reason: safeCode(detail.reason || "", ""),
            pick_operation_key: pickOperationKey,
            pick_operation_state: monotonicOperationState,
            pick_operation_started_at: pickOperationStartedAt,
            // LINE RESUME CAP (zone-flood campaigns, 2026-09-03): the durable
            // watch used to keep only the first 10 accepted rows, which
            // covered a goal-sized cohort but not a deep batch
            // (LINE_DEEP_BATCH_DEPTH, PR #691) — a crash past row 10 dropped
            // the rest from the resume payload and the reconcile could not
            // reseat them without paying the provider twice. The dial
            // (default 50) keeps the whole flood wave in the checkpoint.
            ...(Array.isArray(detail.acceptedRows)
              ? { pick_accepted_rows: detail.acceptedRows.slice(0, quota.lineResumeCap(lineEnvironment)) }
              : {}),
            }),
          },
        }, requestOptions);
        if (!stored.ok) {
          heartbeatError = Object.assign(new Error("pick_heartbeat_checkpoint_failed"), {
            code: safeCode(stored.error, "pick_heartbeat_checkpoint_failed"),
          });
          return;
        }
        const loaded = await persistence.loadBatch(batch.batchId, requestOptions);
        if (!loaded.ok || !loaded.batch) {
          heartbeatError = Object.assign(new Error("pick_heartbeat_reload_failed"), {
            code: safeCode(loaded.error, "pick_heartbeat_reload_failed"),
          });
          return;
        }
        batch = loaded.batch;
      });
      return heartbeatChain;
    };
    await checkpointPickStage("pick_started");
    if (heartbeatError) throw heartbeatError;
    const parentBeforePick = await loadParentForWork(batch.batchId, ["running"], requestOptions);
    if (!parentBeforePick.ok) {
      return { ok: true, batch: parentBeforePick.batch, selected: 0, complete: true, skipped: parentBeforePick.skipped };
    }
    batch = parentBeforePick.batch;
    const heartbeatTimer = setInterval(() => {
      void checkpointPickStage(pickStage, { reason: "worker_alive" });
    }, PICK_HEARTBEAT_INTERVAL_MS);
    if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
    try {
      selected = await runner.withPhaseDeadline(
        (signal) => {
          const pickInput = {
            target: source.target,
            count: requestedNow,
            lane: batch.lane,
            signal,
            deadlineAt: context.deadlineAt,
            excludeProspectIds: existingIds,
            ...(exactMode ? { prospectIds: remainingExactIds } : {}),
            campaignTarget: batch.target,
            sourceMode: source.mode,
            refillRound: source.attempt,
            ...campaignQueryGeometry(batch.batchId),
            // LINE DEEP BATCH DEPTH (owner doctrine 2026-09-04): forward the
            // batch's stamped request (start path) or the environment dial so
            // the pick grades the wider cohort in one wave. Absent on both
            // means the historical goal-sized cohort, unchanged.
            ...(() => {
              const waveDepth = quota.deepBatchDepthForBatch(batch, lineEnvironment);
              return waveDepth ? { deepBatchDepth: waveDepth } : {};
            })(),
            operationKey: pickOperationKey,
            acceptedMiningCheckpoint: sameOperation && Array.isArray(priorPickWatch.pick_accepted_rows)
              ? priorPickWatch.pick_accepted_rows
              : [],
          };
          // Keep the callback out of serialized diagnostics/test snapshots;
          // it is process-local control, never queue or persistence data.
          Object.defineProperty(pickInput, "onStage", {
            value: checkpointPickStage,
            enumerable: false,
          });
          return pick(pickInput);
        },
        boundedInteger(dependencies.pickTimeoutMs, PICK_TIMEOUT_MS, 1_000, PICK_TIMEOUT_MS),
        "pick",
        context.signal,
      );
      await checkpointPickStage("pick_complete");
      await heartbeatChain;
      if (heartbeatError) throw heartbeatError;
    } catch (error) {
      clearInterval(heartbeatTimer);
      await heartbeatChain;
      if (exactMode) {
        const errorCode = safeCode(error?.code || error?.message, "explicit_prospect_pick_failed");
        if (exactPickErrorRetryable(error)) {
          const compilerRetry = errorCode === "intake_genie_compile_retryable";
          const released = await releaseBatch(batch, "building", {
            pickState: "pending",
            mineFunnel: [
              createExplicitProspectMarker(exactIds, {
                survived: existingExactCount,
                rejected: { retry_pending: remainingExactIds.length },
              }),
              { stage: "explicit_pick_retry", lastError: errorCode, at: now() },
            ],
          }, requestOptions);
          return {
            ok: false,
            retryable: true,
            ...(compilerRetry
              ? { retryDelaySeconds: PICK_RETRY_DELAY_SECONDS }
              : { deferRetry: true }),
            batch: released,
            error: "explicit_prospect_pick_retryable",
          };
        }
        const settledAt = now();
        const released = await releaseBatch(batch, "halted", {
          pickState: "complete",
          haltReason: errorCode,
          ...terminalPickCausePatch(batch.mineFunnel, errorCode, error?.causeCode, settledAt, error?.problems),
          settledAt,
        }, requestOptions);
        return { ok: false, retryable: false, batch: released, error: "explicit_prospect_pick_failed" };
      }
      if (error?.retryable === false) {
        const errorCode = safeCode(error?.code || error?.message, "pick_terminal");
        const settledAt = now();
        const released = await releaseBatch(batch, "halted", {
          pickState: "complete",
          haltReason: errorCode,
          ...terminalPickCausePatch(batch.mineFunnel, errorCode, error?.causeCode, settledAt, error?.problems),
          settledAt,
        }, requestOptions);
        return { ok: false, retryable: false, batch: released, error: errorCode };
      }
      let nextFunnel = quotaEnabled
        ? bank.withBankDrawStage(quota.mergeMineFunnel(batch.mineFunnel, [], {
          attempt: source.attempt,
          sourceTarget: source.target,
          mode: source.mode,
          requested: requestedNow,
          selected: 0,
          contractEntered: Math.max(Number(batch.requested) || 0, 0),
          reason: safeCode(error?.code || error?.message, "pick_failed"),
          quotaState: quotaState(batch),
        }), pendingBankStage)
        : { lastError: safeCode(error?.code || error?.message, "pick_failed"), at: now() };
      const acceptedWatch = startWatchFrom(batch.mineFunnel);
      if (acceptedWatch && acceptedWatch.pick_operation_state === "accepted") {
        nextFunnel = withStartWatch(
          Array.isArray(nextFunnel) ? nextFunnel : [nextFunnel],
          acceptedWatch,
        );
      }
      const compilerRetry = safeCode(error?.code || error?.message, "pick_failed")
        === "intake_genie_compile_retryable";
      // SLOW-SOURCE ROTATION: a starved pass whose casualties are
      // timeout-class compiles rotates IMMEDIATELY (fast-refill floor) and
      // records the source in the in-batch slow memo so the next selection
      // skips it. Non-timeout transients (5xx/429 throttle) keep the 60s
      // retry floor — that is service health, not source speed.
      const timeoutCasualties = Math.max(0, Number(error?.compileTimeoutCount) || 0);
      const slowSource = compilerRetry && timeoutCasualties >= SLOW_COMPILE_TIMEOUT_THRESHOLD;
      if (slowSource) {
        const memoPatch = slowCompileMemoPatch(batch, error?.compileSourceTarget || source.target, timeoutCasualties, now());
        if (memoPatch) {
          nextFunnel = withStartWatch(
            Array.isArray(nextFunnel) ? nextFunnel : [nextFunnel],
            memoPatch,
          );
        }
      }
      const released = await releaseBatch(batch, "building", {
        pickState: "pending",
        mineFunnel: nextFunnel,
      }, requestOptions);
      return {
        ok: false,
        retryable: true,
        ...(compilerRetry
          ? { retryDelaySeconds: slowSource ? FAST_REFILL_DELAY_SECONDS : PICK_RETRY_DELAY_SECONDS }
          : { deferRetry: true }),
        batch: released,
        error: "pick_failed",
      };
    }
    clearInterval(heartbeatTimer);

    const sourceExhaustedReason = !exactMode
      && quotaEnabled
      && selected?.sourceExhausted?.exhausted === true
      && safeCode(selected.sourceExhausted.reason, "") === "operator_query_cycle_exhausted"
      ? "operator_query_cycle_exhausted"
      : "";

    if (exactMode) {
      const selectedIds = Array.isArray(selected)
        ? selected.map((prospect) => String(prospect && prospect.prospectId || ""))
        : [];
      if (selectedIds.length !== remainingExactIds.length
        || selectedIds.some((id, index) => id !== remainingExactIds[index])) {
        const released = await releaseBatch(batch, "halted", {
          pickState: "complete",
          haltReason: "explicit_prospect_pick_identity_mismatch",
          settledAt: now(),
        }, requestOptions);
        return { ok: false, retryable: false, batch: released, error: "explicit_prospect_pick_identity_mismatch" };
      }
    }
    const existing = new Set(existingIds);
    const unique = (Array.isArray(selected) ? selected : [])
      .filter((prospect) => {
        const id = String(prospect && prospect.prospectId || "");
        if (!id || existing.has(id)) return false;
        existing.add(id);
        return true;
      })
      .slice(0, requestedNow);
    const rows = pickedRows(unique, now(), (batch.rows || []).length, {
      requireContactVerdict: exactMode,
    });
    // QUARANTINE IS DURABLE STATE, NOT A FILTER. A deterministic candidate-
    // local compiler refusal (a proven 422) arrives as metadata on the picked
    // array. Materialize each as a terminal rejected row in the SAME
    // checkpoint as its surviving siblings: existingIds derives the next
    // excludeProspectIds from ALL batch rows, so the candidate can never be
    // reselected by this batch's refills, across restarts included; rejected
    // rows count as neither active nor finished, so the replacement quota
    // requests exactly the gap; and the console names the casualty.
    const quarantineInput = !exactMode && Array.isArray(selected && selected.quarantined)
      ? selected.quarantined
      : [];
    const quarantined = [];
    for (const candidate of quarantineInput) {
      const id = String(candidate && candidate.prospectId || "").trim();
      if (!id || existing.has(id)) continue;
      existing.add(id);
      const reason = String(candidate.reason || "intake_genie_candidate_refused").slice(0, 240);
      const seeded = lineState.newRow({
        prospectId: id,
        businessName: candidate.businessName,
        vertical: candidate.vertical,
        now: now(),
      });
      const terminal = lineState.advanceRow(seeded, "rejected", { reason, now: now() });
      quarantined.push({
        ...(terminal.ok ? terminal.row : { ...seeded, status: "rejected", reason }),
        ...compilerProblemDetailForContinuation(candidate),
        rowIndex: (batch.rows || []).length + rows.length + quarantined.length,
      });
    }
    // DEGRADE HONESTLY (practice history outage law, 2026-09-04): rows that
    // were admitted while the practice-history read was down carry the
    // recorded reason in their durable payload, so the skipped history check
    // is auditable per row instead of silent.
    const practiceDegradedReason = selected && selected.practiceHistoryDegraded
      ? String(selected.practiceHistoryDegraded || "practice_history_unavailable:degraded").slice(0, 240)
      : "";
    const admittedRows = practiceDegradedReason
      ? rows.map((row) => ({ ...row, practice_history_degraded: practiceDegradedReason }))
      : rows;
    const storedRows = quarantined.length ? [...admittedRows, ...quarantined] : admittedRows;
    const saved = await persistence.storeRows({ batchId: batch.batchId, rows: storedRows }, requestOptions);
    if (!saved.ok) {
      const released = await releaseBatch(batch, "building", {
        pickState: "pending",
        mineFunnel: exactMode
          ? [
              createExplicitProspectMarker(exactIds, {
                survived: existingExactCount,
                rejected: { checkpoint_pending: remainingExactIds.length },
              }),
              { stage: "explicit_pick_checkpoint", lastError: safeCode(saved.error, "pick_checkpoint_failed"), at: now() },
            ]
          : quotaEnabled
          ? bank.withBankDrawStage(quota.mergeMineFunnel(batch.mineFunnel, selected && selected.funnel, {
            attempt: source.attempt,
            sourceTarget: source.target,
            mode: source.mode,
            requested: requestedNow,
            selected: 0,
            contractEntered: Math.max(Number(batch.requested) || 0, 0),
            reason: safeCode(saved.error, "pick_checkpoint_failed"),
            quotaState: quotaState(batch),
          }), pendingBankStage)
          : { lastError: safeCode(saved.error, "pick_checkpoint_failed"), at: now() },
      }, requestOptions);
      return { ok: false, retryable: true, deferRetry: true, batch: released, error: "pick_checkpoint_failed" };
    }

    const mineFunnel = exactMode
      ? [
          // The exact lane's funnel is just the explicit marker; a degraded
          // practice-history read must still ride it loudly (see rows above).
          ...(practiceDegradedReason
            ? [{ stage: "practice_history_degraded", reason: practiceDegradedReason, at: now() }]
            : []),
          createExplicitProspectMarker(exactIds, {
            survived: existingExactCount + rows.length,
            rejected: existingExactCount + rows.length === exactIds.length
              ? {}
              : { missing_or_invalid_prospect: exactIds.length - existingExactCount - rows.length },
          }),
        ]
      : quotaEnabled
      ? bank.withBankDrawStage(quota.mergeMineFunnel(batch.mineFunnel, selected && selected.funnel, {
        attempt: source.attempt,
        sourceTarget: source.target,
        mode: source.mode,
        requested: requestedNow,
        selected: rows.length,
        contractEntered: Math.max(Number(batch.requested) || 0, 0),
        ...(sourceExhaustedReason ? { reason: sourceExhaustedReason } : {}),
        quotaState: quotaState({ ...batch, rows: [...(batch.rows || []), ...rows] }),
      }), pendingBankStage)
      : selected && selected.funnel ? selected.funnel : {};
    // A PARTIAL pass (certified survivors + transient compile casualties)
    // still owes the slow-source memo its timeout count, so the refill's
    // source selection can skip a source that keeps timing out.
    const passCasualties = !exactMode && selected && selected.compileCasualties
      ? selected.compileCasualties
      : null;
    const finalFunnel = quotaEnabled && passCasualties && Number(passCasualties.timeouts) > 0
      ? (() => {
          const memoPatch = slowCompileMemoPatch(batch, passCasualties.sourceTarget || source.target, passCasualties.timeouts, now());
          return memoPatch
            ? withStartWatch(Array.isArray(mineFunnel) ? mineFunnel : [mineFunnel], memoPatch)
            : mineFunnel;
        })()
      : mineFunnel;
    const noSupply = rows.length < 1;
    const afterPick = { ...batch, mineFunnel: finalFunnel, rows: [...(batch.rows || []), ...storedRows] };
    const terminalDrain = Boolean(sourceExhaustedReason)
      && quota.terminalCertifiedDrainAllowed(afterPick);
    const exhausted = Boolean(sourceExhaustedReason) && !terminalDrain
      ? true
      : quotaEnabled && noSupply && quota.sourceExhausted(afterPick) && !terminalDrain;
    const derivedTerminalStatus = terminalDrain
      ? lineState.deriveBuildStatus({ ...afterPick, pickState: "complete" }, { activeLeases: 0 })
      : "";
    const releaseStatus = exhausted
      ? "halted"
      : terminalDrain
      ? (derivedTerminalStatus === "running" ? "building" : derivedTerminalStatus)
      : quotaEnabled
      ? "building"
      : noSupply ? "done" : "building";
    // A clean empty source is a rotation signal, not a reason to wait for the
    // two-minute rescue cron. Schedule exactly one next-source pass; the
    // existing finite quota cap and every provider circuit breaker stay put.
    // Errors still take the cron path above, and the switch restores that same
    // conservative behavior without changing any durable state.
    const fastRefill = quotaEnabled && noSupply && !sourceExhaustedReason && !exhausted && fastRefillEnabled();
    let released = await releaseBatch(batch, releaseStatus, {
      pickState: exhausted || sourceExhaustedReason
        ? "complete"
        : (quotaEnabled && noSupply ? "pending" : "complete"),
      mineFunnel: finalFunnel,
      ...(exhausted ? { haltReason: sourceExhaustedReason || quotaHaltReason(afterPick) } : {}),
      ...(releaseStatus === "awaiting_approval" || releaseStatus === "done" || releaseStatus === "halted"
        ? { settledAt: now() }
        : {}),
    }, requestOptions);
    if (terminalDrain) released = await maybeAutoApproveEligibleBatch(released, requestOptions);
    return {
      ok: true,
      batch: released,
      selected: rows.length,
      complete: released.status !== "building",
      deferRetry: quotaEnabled && noSupply && !sourceExhaustedReason && !exhausted && !fastRefill,
      ...(fastRefill ? { retryDelaySeconds: FAST_REFILL_DELAY_SECONDS } : {}),
      ...(bankDrawnCount ? { bankDrawn: bankDrawnCount } : {}),
      exhausted,
      sourceTarget: source.target,
    };
  }

  async function reconcilePickedRows(batch, context) {
    const requestOptions = workerPersistenceOptions(context);
    const activeParent = await loadParentForWork(batch.batchId, ["running"], requestOptions);
    if (!activeParent.ok) {
      return { ok: true, batch: activeParent.batch, selected: 0, recoveredRows: 0, complete: true, skipped: activeParent.skipped };
    }
    batch = activeParent.batch;
    const recovered = { ...batch, pickState: "complete" };
    const derived = lineState.deriveBuildStatus(recovered, { activeLeases: 0 });
    const paidCandidateBudgetExhausted = quota.heroPaidCandidateBudgetBlocksCompletion(recovered, lineEnvironment);
    const refill = !paidCandidateBudgetExhausted && quota.shouldRefill(recovered, lineEnvironment);
    const exhausted = quota.sourceExhausted(recovered);
    const terminalDrain = quota.terminalCertifiedDrainAllowed(recovered);
    const status = paidCandidateBudgetExhausted || (exhausted && !terminalDrain)
      ? "halted"
      : (refill ? "building" : (derived === "running" ? "building" : derived));
    let released = await releaseBatch(batch, status, {
      pickState: refill ? "pending" : "complete",
      ...(paidCandidateBudgetExhausted
        ? { haltReason: heroPaidCandidateBudgetHaltReason(recovered) }
        : exhausted && !terminalDrain ? { haltReason: quotaHaltReason(recovered) } : {}),
      ...(status === "awaiting_approval" || status === "done" || status === "halted" ? { settledAt: now() } : {}),
    }, requestOptions);
    if (terminalDrain) released = await maybeAutoApproveEligibleBatch(released, requestOptions);
    return {
      ok: true,
      batch: released,
      selected: 0,
      recoveredRows: (batch.rows || []).length,
      complete: status !== "building",
    };
  }

  async function processClaimedRows(batch, claimedRows, context, requestOptions, claimStartedAt) {
    const seenLogoShas = seedLogoClaims(batch.rows);
    const parentBeforeClaimedWork = await loadParentForWork(batch.batchId, ["building", "running"], requestOptions);
    if (!parentBeforeClaimedWork.ok) {
      return { processed: 0, failed: 0, rows: [], skipped: parentBeforeClaimedWork.skipped };
    }
    const outcomes = await Promise.all((claimedRows || []).map(async (row) => {
      let currentRow = row;
      let beforeStatus = currentRow.status;
      const retryAfter = Date.parse(String(currentRow.buildRetryAfter || ""));
      const forcedHeroRow = context.forceHeroWake === true
        && String(currentRow.rowId || "") === String(context.forceHeroRowId || "")
        && currentRow.heroRemaster?.pending === true;
      let outcome;
      let failed = 0;
      let phaseWorked = false;
      if (context.forceHeroWake === true && !forcedHeroRow) {
        outcome = { ok: true, row: currentRow };
      } else if (!forcedHeroRow && Number.isFinite(retryAfter) && retryAfter > claimStartedAt) {
        outcome = { ok: true, row: currentRow };
      } else {
        phaseWorked = true;
        const operationKey = `${batch.batchId}:${currentRow.prospectId}:mirror`;
        if (beforeStatus === "qualified") {
          const existing = currentRow.mirrorDispatch && typeof currentRow.mirrorDispatch === "object"
            ? currentRow.mirrorDispatch
            : {};
          // An in-flight "dispatching" attempt is reused for idempotency: one
          // active attempt per logical request prevents a duplicate provider
          // call if the worker is interrupted and re-enters. A prior terminal
          // failure (failed_before_build / failed) must NOT be reused: a fresh
          // immutable attempt is created and the old one is preserved as audit.
          const priorStatus = String(existing.status || "");
          const priorFailed = priorStatus === "failed_before_build" || priorStatus === "failed";
          const fallbackAttemptId = `mirror_attempt:${currentRow.leaseToken || randomUUID()}`;
          const attemptId = priorFailed
            ? `mirror_attempt:${currentRow.leaseToken || randomUUID()}`
            : String(existing.attemptId || existing.attempt_id || fallbackAttemptId);
          const startedAt = now();
          const stagedAttempt = {
            logicalRequestId: operationKey,
            attemptId,
            status: "dispatching",
            leaseToken: String(currentRow.leaseToken || ""),
            attemptCount: Math.max(Number(currentRow.attemptCount) || 0, 0),
            ...(priorFailed ? {
              priorAttemptId: String(existing.attemptId || existing.attempt_id || ""),
              priorFailure: existing.failure || null,
            } : {}),
            binding: {
              batchId: String(batch.batchId || ""),
              rowId: String(currentRow.rowId || ""),
              prospectId: String(currentRow.prospectId || ""),
              rowVersion: Number(currentRow.version) || 0,
            },
            fingerprints: {
              line: createHash("sha256").update(`${batch.batchId}\0${currentRow.rowId}\0${currentRow.prospectId}`).digest("hex"),
              source: createHash("sha256").update(`${currentRow.prospectId}\0${currentRow.vertical || ""}\0${currentRow.durableUpdatedAt || ""}`).digest("hex"),
            },
            startedAt,
          };
          const staged = await persistence.checkpointRow({
            rowId: currentRow.rowId,
            leaseToken: currentRow.leaseToken,
            expectedVersion: currentRow.version,
            expectedStatus: beforeStatus,
            row: { ...currentRow, mirrorDispatch: stagedAttempt },
            releaseLease: false,
          }, requestOptions);
          if (!staged.ok) {
            throw Object.assign(new Error("line_row_checkpoint_failed"), { code: safeCode(staged.error) });
          }
          currentRow = staged.row || { ...currentRow, version: (Number(currentRow.version) || 0) + 1, mirrorDispatch: stagedAttempt };
          beforeStatus = currentRow.status;
          const parentBeforeMirror = await loadParentForWork(batch.batchId, ["building", "running"], requestOptions);
          if (!parentBeforeMirror.ok) {
            return { processed: 0, failed: 0, row: null, skipped: parentBeforeMirror.skipped };
          }
        }
        outcome = await processPhase(currentRow, {
          lane: batch.lane,
          batchId: batch.batchId,
          operationKey,
          signal: context.signal,
          deadlineAt: context.deadlineAt,
          seenLogoShas,
        }, phaseDeps);
      }

      if (!outcome || outcome.ok !== true) {
        if (outcome && outcome.retryable === true) {
          const buildRetryAttempts = Math.max(Number(row.buildRetryAttempts) || 0, 0) + 1;
          if (buildRetryAttempts >= MAX_BUILD_RETRY_ATTEMPTS) {
            // THE SWEEP NAMES THE TRIGGER (2026-09-04, batch line_mtmvwmyn).
            // The exhausted branch used to OVERWRITE lastRetryableError with
            // the bare "build_retry_exhausted" string, so a row died holding
            // its own death certificate: nine healthy mirrors swept at 12:47Z
            // with the render-gate timeout that actually killed them erased.
            // The terminal reason stays the exhaustion classification; the
            // error that CAUSED it rides beside it in lastRetryableError.
            const trigger = safeCode(outcome.code || outcome.error, "build_retry_exhausted");
            const terminal = lineState.advanceRow(currentRow, "error", {
              reason: "build_retry_exhausted",
              now: now(),
            });
            const terminalRow = terminal.ok
              ? { ...terminal.row, buildRetryAttempts, lastRetryableError: trigger }
              : { ...currentRow, status: "error", reason: "build_retry_exhausted", buildRetryAttempts, lastRetryableError: trigger };
            outcome = { ok: true, row: terminalRow };
            // The activation the exhausted attempts may have left live is
            // reconciled against this durable terminal record.
            await recordRowTerminalEvent(batch.batchId, terminalRow, "build_retry_exhausted");
            failed += 1;
          } else {
            outcome = {
              ok: true,
              row: {
                ...currentRow,
                buildRetryAttempts,
                buildRetryAfter: new Date(retryClock() + buildRetryDelay(buildRetryAttempts)).toISOString(),
                lastRetryableError: safeCode(outcome.code || outcome.error),
              },
            };
          }
        } else {
          const terminalReason = safeCode(outcome?.code || outcome?.error);
          const terminal = lineState.advanceRow(currentRow, "error", {
            reason: terminalReason,
            now: now(),
          });
          const terminalRow = terminal.ok ? terminal.row : { ...currentRow, status: "error", reason: "line_phase_failed" };
          outcome = terminal.ok ? terminal : { ok: true, row: terminalRow };
          await recordRowTerminalEvent(batch.batchId, terminalRow, terminalReason);
          failed += 1;
        }
      } else if (outcome.row && outcome.row.status !== beforeStatus) {
        outcome = {
          ...outcome,
          row: {
            ...outcome.row,
            buildRetryAttempts: 0,
            buildRetryAfter: "",
            lastRetryableError: "",
          },
        };
      }

      // OBSERVABILITY (2026-08-28): the live hero-pending plateau was
      // unobservable in-band — the runtime drain only carried the batch-state
      // census, so a row parked for hours showed nothing about WHY. One
      // structured, PII-free event per row phase (opaque ids + internal
      // reason codes only, matching the line_human_state precedent) makes the
      // next pend diagnosable from `vercel logs` alone.
      try {
        const hero = currentRow.heroRemaster && typeof currentRow.heroRemaster === "object"
          ? currentRow.heroRemaster
          : {};
        const heroOutcome = outcome?.row?.heroRemaster && typeof outcome.row.heroRemaster === "object"
          ? outcome.row.heroRemaster
          : {};
        const mirrorFailure = mirrorFailureSummary(outcome?.row || currentRow);
        const phaseEvent = {
          event: "line_row_phase",
          batch_id: batch.batchId,
          row_id: currentRow.rowId,
          before_status: beforeStatus,
          after_status: String(outcome?.row?.status || ""),
          phase: String(outcome?.phase || ""),
          ok: outcome?.ok === true,
          retryable: outcome?.retryable === true,
          // The durable nested cause wins over a generic phase wrapper. This
          // keeps mirror_dispatch_failed_before_build from erasing the exact
          // adapter/provider failure that was already committed on the row.
          error: mirrorFailure.code || mirrorFailure.reason || mirrorFailure.detail
            || safeCode(outcome?.error || outcome?.code || "", ""),
          mirror_failure_code: mirrorFailure.code,
          mirror_failure_detail: mirrorFailure.detail,
          mirror_failure_reason: mirrorFailure.reason,
          hero_before: {
            required: hero.required === true, pending: hero.pending === true,
            hold: hero.hold === true, ready: hero.ready === true,
            reason: String(hero.reason || hero.status || ""),
          },
          hero_after: {
            required: heroOutcome.required === true, pending: heroOutcome.pending === true,
            hold: heroOutcome.hold === true, ready: heroOutcome.ready === true,
            applied: heroOutcome.applied === true, fallback: heroOutcome.fallback === true,
            reason: String(heroOutcome.reason || heroOutcome.status || ""),
          },
          retry_after: String(outcome?.row?.buildRetryAfter || ""),
        };
        // Observability volume valve (#596): `full` (default) is byte-identical
        // to the unconditional oracle; `reduced` keeps only terminal/error
        // transitions so the hot path stops paying one event per row phase.
        if (lineTelemetry.shouldLogRowPhase(process.env, phaseEvent)) {
          console.log(JSON.stringify(phaseEvent));
        }
      } catch (_) { /* logging must never break the phase */ }

      if (phaseWorked) {
        const parentBeforeCheckpoint = await loadParentForWork(batch.batchId, ["building", "running"], requestOptions);
        if (!parentBeforeCheckpoint.ok) {
          // The owner halt outranks a stale worker completion. Leave the row
          // lease to expire; halted batches are never reclaimed or refilled.
          return { processed: 0, failed: 0, row: null, skipped: parentBeforeCheckpoint.skipped };
        }
      }

      let checkpoint = await persistence.checkpointRow({
        rowId: currentRow.rowId,
        leaseToken: currentRow.leaseToken,
        expectedVersion: currentRow.version,
        expectedStatus: beforeStatus,
        row: outcome.row,
        releaseLease: true,
      }, requestOptions);
      // Mirrored rows run in separate queue deliveries, so an in-memory logo
      // map cannot be the final cross-worker truth lock. The durable partial
      // unique index on (batch_id, logo_sha256) chooses one winner atomically.
      // Convert the losing 23505 into the same explicit truth-law gate failure
      // while this worker still owns the row lease; never ship two clients'
      // sites with the same claimed mark and never poison the whole batch.
      if (!checkpoint.ok
        && String(checkpoint.error || "") === "23505"
        && beforeStatus === "mirrored"
        && outcome?.row?.status === "gate_passed"
        && String(outcome.row.logoSha256 || "").trim()) {
        const gate = outcome.row.gate && typeof outcome.row.gate === "object"
          ? outcome.row.gate
          : { pass: true, failed: [], checks: [] };
        const reason = "this exact logo is already assigned to another prospect in this batch";
        const checks = Array.isArray(gate.checks) ? gate.checks : [];
        const hasLogoCheck = checks.some((check) => check?.fact === "logo_own_and_unique");
        const collisionGate = {
          ...gate,
          pass: false,
          failed: [...new Set([...(Array.isArray(gate.failed) ? gate.failed : []), "logo_own_and_unique"])],
          blockedBy: `logo_own_and_unique: ${reason}`,
          checks: (hasLogoCheck ? checks : checks.concat([{ fact: "logo_own_and_unique" }]))
            .map((check) => check?.fact === "logo_own_and_unique"
              ? { ...check, pass: false, reason }
              : check),
        };
        const collision = lineState.applyGate(currentRow, collisionGate, { now: now() });
        if (collision.ok) {
          collision.row = { ...collision.row, logoSha256: outcome.row.logoSha256 };
          checkpoint = await persistence.checkpointRow({
            rowId: currentRow.rowId,
            leaseToken: currentRow.leaseToken,
            expectedVersion: currentRow.version,
            expectedStatus: beforeStatus,
            row: collision.row,
            releaseLease: true,
          }, requestOptions);
          if (checkpoint.ok) {
            outcome = { ok: true, row: checkpoint.row || collision.row };
            failed += 1;
          }
        }
      }
      if (!checkpoint.ok) {
        throw Object.assign(new Error("line_row_checkpoint_failed"), { code: safeCode(checkpoint.error) });
      }
      return { processed: 1, failed, row: checkpoint.row || outcome.row };
    }));
    return outcomes.reduce((summary, outcome) => ({
      processed: summary.processed + outcome.processed,
      failed: summary.failed + outcome.failed,
      rows: summary.rows.concat(outcome.row ? [outcome.row] : []),
    }), { processed: 0, failed: 0, rows: [] });
  }

  async function advanceRows(batch, context) {
    const passStartedAt = clock();
    const requestOptions = workerPersistenceOptions(context);
    // Phase-aware claims keep cheap work broad while each queue delivery owns
    // at most one Chromium-heavy mirror or render-gate row. Fleet concurrency
    // comes from Vercel Queues, never from multiplying browsers inside one
    // function invocation.
    const normalPhasePlans = [
      { statuses: ["gate_passed"], limit: rowClaim },
      { statuses: ["ready"], limit: rowClaim },
      { statuses: ["mirrored"], limit: Math.min(BROWSER_HEAVY_ROW_CLAIM, rowClaim) },
      // BROWSER-BOUND, exactly like the `mirrored` gate above it. The mirror
      // phase is the heaviest Chromium consumer in the system: one row takes
      // ~5 browser permits (design brief + renderCheck + audit chunks) and ~22
      // navigations. Claiming ten of them against the shared remote pool meant
      // ~220 navigations queued behind a handful of permits — far more than the
      // ~267s the engine has before it self-aborts — so EVERY row hit the
      // deadline and NONE finished. Measured 2026-08-19: 0 sites produced.
      // Ten isolated one-row deliveries finish faster than a few overloaded
      // deliveries that each open multiple browser trees.
      { statuses: ["qualified"], limit: Math.min(BROWSER_HEAVY_ROW_CLAIM, rowClaim) },
      { statuses: ["picked"], limit: rowClaim },
    ];
    // A rebuild-complete wake has one job: release the qualified row that is
    // waiting for that verified hero. Refill mining and unrelated phases run
    // on the continuation published after this pass.
    const phasePlans = context.forcePickedQualification === true
      ? [{ statuses: ["picked"], limit: rowClaim }]
      : context.forceHeroWake === true
      ? [{ statuses: ["qualified"], limit: 1 }]
      : normalPhasePlans;
    let claimed = { ok: true, rows: [] };
    let claimLimit = rowClaim;
    const claimStartedAt = retryClock();
    for (const plan of phasePlans) {
      const matchingRows = (batch.rows || []).filter((row) => plan.statuses.includes(row.status));
      const retryDue = (row) => {
        if (context.forceHeroWake === true) {
          return String(row.rowId || "") === String(context.forceHeroRowId || "")
            && row.heroRemaster?.pending === true;
        }
        const retryAfter = Date.parse(String(row.buildRetryAfter || ""));
        return !Number.isFinite(retryAfter) || retryAfter <= claimStartedAt;
      };
      const orderedRows = [...matchingRows].sort((left, right) =>
        (Number(left.rowIndex) || 0) - (Number(right.rowIndex) || 0));
      const dueRows = orderedRows.filter(retryDue);
      if (!dueRows.length) continue;
      let dueRowsRemaining = Math.min(plan.limit, dueRows.length);
      let dueRowsSeen = 0;
      let futureRowsRemaining = 0;
      for (const row of orderedRows) {
        if (retryDue(row)) {
          dueRowsSeen += 1;
          if (dueRowsSeen >= dueRowsRemaining) break;
        } else {
          futureRowsRemaining += 1;
        }
      }
      const planRows = [];
      // The durable snapshot already tells us exactly which rows are due. An
      // exact claim prevents earlier backoff rows (notably hero waits) from
      // being leased and checkpointed again merely to reach later work. The
      // legacy ordered-page walk remains available as an emergency kill switch.
      if (queueDueOnlyEnabled() && context.forceHeroWake !== true && futureRowsRemaining > 0) {
        for (const dueRow of dueRows.slice(0, dueRowsRemaining)) {
          const attempt = await persistence.claimRows({
            batchId: batch.batchId,
            rowId: dueRow.rowId,
            workerId: context.workerId,
            limit: 1,
            statuses: plan.statuses,
            leaseMs: Math.min(WORKER_DEADLINE_MS + 10_000, 240_000),
          }, requestOptions);
          if (!attempt.ok) throw Object.assign(new Error("line_row_claim_failed"), { code: safeCode(attempt.error) });
          planRows.push(...(attempt.rows || []));
        }
        if (planRows.length) {
          claimed = { ok: true, rows: planRows };
          claimLimit = plan.limit;
          break;
        }
        continue;
      }
      // A campaign may have hundreds of earlier rows in backoff. Lease through
      // them in bounded pages so row_index ordering cannot hide a later due
      // row. Backoff rows are checkpointed unchanged; at most `plan.limit` due
      // rows reach provider/browser work (one for each browser-heavy phase).
      while (dueRowsRemaining > 0) {
        const requestedClaim = Math.min(
          MAX_RETRY_AWARE_CLAIM,
          Math.max(1, futureRowsRemaining + dueRowsRemaining),
        );
        const attempt = await persistence.claimRows({
          batchId: batch.batchId,
          ...(context.forceHeroWake === true ? { rowId: context.forceHeroRowId } : {}),
          workerId: context.workerId,
          limit: context.forceHeroWake === true ? 1 : requestedClaim,
          statuses: plan.statuses,
          leaseMs: Math.min(WORKER_DEADLINE_MS + 10_000, 240_000),
        }, requestOptions);
        if (!attempt.ok) throw Object.assign(new Error("line_row_claim_failed"), { code: safeCode(attempt.error) });
        if (!(attempt.rows || []).length) break;
        planRows.push(...attempt.rows);
        for (const row of attempt.rows) {
          if (retryDue(row)) {
            dueRowsRemaining = Math.max(0, dueRowsRemaining - 1);
          } else {
            futureRowsRemaining = Math.max(0, futureRowsRemaining - 1);
          }
        }
        if ((attempt.rows || []).length < requestedClaim) break;
      }
      if (planRows.length) {
        claimed = { ok: true, rows: planRows };
        claimLimit = plan.limit;
        break;
      }
    }

    const processedRows = await processClaimedRows(
      batch,
      claimed.rows || [],
      context,
      requestOptions,
      claimStartedAt,
    );
    const { processed, failed } = processedRows;

    const loaded = await persistence.loadBatch(batch.batchId, requestOptions);
    if (!loaded.ok) throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(loaded.error) });
    const fresh = loaded.batch;
    if (fresh.status === "halted") {
      return { ok: true, batch: fresh, processed, failed, remaining: 0, skipped: "batch_halted" };
    }
    const status = lineState.deriveBuildStatus(fresh, { activeLeases: 0 });
    const paidCandidateBudgetExhausted = quota.heroPaidCandidateBudgetBlocksCompletion(fresh, lineEnvironment);
    const refill = !paidCandidateBudgetExhausted && quota.shouldRefill(fresh, lineEnvironment);
    const exhausted = quota.sourceExhausted(fresh);
    const terminalDrain = quota.terminalCertifiedDrainAllowed(fresh);
    const nextStatus = paidCandidateBudgetExhausted || (exhausted && !terminalDrain)
      ? "halted"
      : (refill ? "building" : (status === "running" ? "building" : status));
    let released = await releaseBatch(fresh, nextStatus, {
      ...(refill ? { pickState: "pending", settledAt: null } : {}),
      ...(paidCandidateBudgetExhausted
        ? { pickState: "complete", haltReason: heroPaidCandidateBudgetHaltReason(fresh) }
        : exhausted && !terminalDrain ? { pickState: "complete", haltReason: quotaHaltReason(fresh) } : {}),
      ...(nextStatus === "awaiting_approval" || nextStatus === "done" || nextStatus === "halted" ? { settledAt: now() } : {}),
    }, requestOptions);
    released = await maybeAutoApproveEligibleBatch(released, requestOptions);
    const finalCounts = lineState.batchCounts(released);
    const retryState = quota.activeRows(released).reduce((state, row) => {
      const retryAfter = Date.parse(String(row.buildRetryAfter || ""));
      if (Number.isFinite(retryAfter) && retryAfter > retryClock()) {
        state.earliest = Math.min(state.earliest, retryAfter);
      } else {
        state.immediate = true;
      }
      return state;
    }, { earliest: Number.POSITIVE_INFINITY, immediate: false });
    const retryDeferred = !refill
      && retryState.immediate === false
      && Number.isFinite(retryState.earliest);
    const retryDelaySeconds = quota.gaplessLineEnabled(lineEnvironment) && retryDeferred
      ? Math.max(1, Math.ceil((retryState.earliest - retryClock()) / 1000))
      : 0;
    if (process.env.VERCEL || process.env.GHOST_AGENCY_PHASE_LOGS === "true") {
      const workerPassEvent = {
        event: "line_worker_pass",
        batch_id: batch.batchId,
        claim_limit: claimLimit,
        claimed: (claimed.rows || []).length,
        claimed_statuses: [...new Set((claimed.rows || []).map((row) => row.status))],
        processed,
        failed,
        remaining: finalCounts.working,
        queued: finalCounts.queued,
        status: released.status,
        duration_ms: Math.max(0, clock() - passStartedAt),
        retry_deferred: retryDeferred,
        retry_delay_seconds: retryDelaySeconds,
        finished_goal: Math.max(Number(released.requested) || 0, 0),
        finished_ready: finalCounts.ready + finalCounts.queued + finalCounts.sent,
        still_needed: quota.finishedQuotaEnabled(released) ? quota.remainingFinishedQuota(released) : 0,
        source_attempts: quota.sourceAttempt(released.mineFunnel),
      };
      // Observability volume valve (#596): `reduced` drops the happy-path pass
      // summary (failed === 0) — the durable batch state already tells that
      // story; only passes that failed a row stay observable.
      if (lineTelemetry.shouldLogWorkerPass(process.env, workerPassEvent)) {
        console.log(JSON.stringify(workerPassEvent));
      }
    }
    return {
      ok: true,
      batch: released,
      processed,
      failed,
      remaining: finalCounts.working,
      complete: nextStatus !== "building",
      deferRetry: retryDeferred,
      retryDelaySeconds,
    };
  }

  async function advanceQueuedRow(batch, message, context) {
    const requestOptions = workerPersistenceOptions(context);
    if (!rowFanout) return { ok: true, skipped: "row_fanout_disabled", batch };
    if (!["building", "running"].includes(String(batch?.status || ""))) {
      return { ok: true, skipped: `row_batch_${safeCode(batch?.status, "unavailable")}`, batch };
    }
    const row = (batch.rows || []).find((candidate) => String(candidate.rowId || "") === String(message.rowId || ""));
    if (!row) return { ok: true, skipped: "row_not_found", batch };
    if (!BROWSER_HEAVY_ROW_STATUSES.includes(String(row.status || ""))) {
      return { ok: true, skipped: "row_phase_already_checkpointed", batch };
    }
    const expectedVersion = Math.max(Number(message.sequence) || 0, 0);
    const currentVersion = Math.max(Number(row.version) || 0, 0);
    let claimVersion = expectedVersion;
    if (currentVersion !== expectedVersion) {
      // claimRows increments the durable version before browser/provider work.
      // If that worker crashes, the original at-least-once message must wait
      // for its lease, then reclaim the still-uncheckpointed same phase. A row
      // with no lease already checkpointed or released that generation and the
      // old message is genuinely stale.
      if (currentVersion > expectedVersion && String(row.leaseToken || "").trim()) {
        const leaseDelaySeconds = rowLeaseDelaySeconds(row, retryClock());
        if (leaseDelaySeconds > 0) {
          return { ok: true, skipped: "row_retry_not_due", retryDelaySeconds: leaseDelaySeconds, batch };
        }
        claimVersion = currentVersion;
      } else {
        return { ok: true, skipped: "row_generation_stale", batch };
      }
    }
    const retryDelaySeconds = rowRetryDelaySeconds(row, retryClock());
    if (retryDelaySeconds > 0) {
      return { ok: true, skipped: "row_retry_not_due", retryDelaySeconds, batch };
    }
    const claimed = await persistence.claimRows({
      batchId: batch.batchId,
      rowId: row.rowId,
      expectedVersion: claimVersion,
      workerId: context.workerId,
      limit: BROWSER_HEAVY_ROW_CLAIM,
      statuses: [row.status],
      leaseMs: Math.min(WORKER_DEADLINE_MS + 10_000, 240_000),
    }, requestOptions);
    if (!claimed.ok) throw Object.assign(new Error("line_row_claim_failed"), { code: safeCode(claimed.error) });
    if ((claimed.rows || []).length !== 1) {
      return { ok: true, skipped: "row_claim_lost", batch };
    }

    const processed = await processClaimedRows(
      batch,
      claimed.rows,
      context,
      requestOptions,
      retryClock(),
    );
    const loaded = await persistence.loadBatch(batch.batchId, requestOptions);
    if (!loaded.ok) throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(loaded.error) });
    const current = loaded.batch;
    if (current.status === "halted") {
      return {
        ok: true,
        batch: current,
        processed: processed.processed,
        failed: processed.failed,
        continued: 0,
        queueAccepted: false,
        rowId: row.rowId,
        skipped: "batch_halted",
      };
    }
    const currentRow = (current.rows || []).find((candidate) => candidate.rowId === row.rowId);
    const publication = currentRow && BROWSER_HEAVY_ROW_STATUSES.includes(String(currentRow.status || ""))
      ? await publishRowContinuation(current, currentRow, {
        delaySeconds: rowRetryDelaySeconds(currentRow, retryClock()),
        requestOptions,
      })
      : await publishNext(current, "run", { requestOptions });
    return {
      ok: true,
      batch: current,
      processed: processed.processed,
      failed: processed.failed,
      continued: publication.accepted === true ? 1 : 0,
      queueAccepted: publication.accepted === true,
      rowId: row.rowId,
    };
  }

  async function advanceSend(batch, context) {
    const requestOptions = workerPersistenceOptions(context);
    const activeParent = await loadParentForWork(batch.batchId, ["approved"], requestOptions);
    if (!activeParent.ok) {
      return { ok: true, batch: activeParent.batch, sent: 0, remaining: 0, skipped: activeParent.skipped };
    }
    batch = activeParent.batch;
    if (!hasDurableApproval(batch)) {
      throw Object.assign(new Error("line_send_approval_evidence_missing"), { code: "approval_evidence_missing" });
    }
    if (quota.finishedQuotaEnabled(batch)
      && quota.remainingFinishedQuota(batch) > 0
      && !quota.terminalCertifiedDrainAllowed(batch)
      && String(batch.approval && batch.approval.actor || "") !== HALTED_SEND_DRAIN_ACTOR) {
      const halted = await releaseBatch(batch, "halted", {
        haltReason: quotaHaltReason(batch, "quota_incomplete_before_send"),
        settledAt: now(),
      }, requestOptions);
      return {
        ok: false,
        batch: halted,
        sent: 0,
        remaining: lineState.batchCounts(halted).queued,
        policyHold: true,
      };
    }
    const claimedBatch = await persistence.storeBatch({
      batchId: batch.batchId,
      expectedVersion: batch.version,
      expectedStatus: "approved",
      patch: {
        status: "sending",
        haltReason: "",
        // Establish durable send ownership in the same CAS that changes the
        // batch status.  There is necessarily no row lease yet; the row is
        // selected immediately below.  Rescue treats this timestamp as real
        // semantic progress, not as a generic batch heartbeat.
        mineFunnel: withStartWatch(batch.mineFunnel, {
          send_claimed_at: now(),
          send_claim_owner: safeOpaque(context.workerId, 160),
        }),
      },
    }, requestOptions);
    if (!claimedBatch.ok) {
      if (claimedBatch.conflict) return { ok: true, skipped: "send_claim_lost", batch };
      throw Object.assign(new Error("line_send_claim_failed"), { code: safeCode(claimedBatch.error) });
    }
    let loaded = await persistence.loadBatch(batch.batchId, requestOptions);
    if (!loaded.ok) throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(loaded.error) });
    const sending = loaded.batch;
    if (sending.status === "halted") {
      return { ok: true, batch: sending, sent: 0, remaining: 0, skipped: "batch_halted" };
    }
    const claimed = await persistence.claimRows({
      batchId: sending.batchId,
      workerId: context.workerId,
      limit: 1,
      leaseMs: Math.min(WORKER_DEADLINE_MS + 10_000, 240_000),
      statuses: ["queued"],
    }, requestOptions);
    if (!claimed.ok) throw Object.assign(new Error("line_send_row_claim_failed"), { code: safeCode(claimed.error) });
    const row = claimed.rows && claimed.rows[0];
    if (!row) {
      const done = await releaseBatch(sending, "done", { sentAt: now(), settledAt: sending.settledAt || now() }, requestOptions);
      return { ok: true, batch: done, sent: 0, remaining: 0, complete: true };
    }

    const ownerProofRetryDelaySeconds = sending.lane === "sandbox"
      ? ownerProofFreshRetryDelaySeconds(row, retryClock())
      : 0;
    if (ownerProofRetryDelaySeconds > 0) {
      const deferred = await persistence.checkpointRow({
        rowId: row.rowId,
        leaseToken: row.leaseToken,
        expectedVersion: row.version,
        expectedStatus: "queued",
        row,
        releaseLease: true,
      }, requestOptions);
      if (!deferred.ok) {
        throw Object.assign(new Error("line_send_retry_defer_checkpoint_failed"), { code: safeCode(deferred.error) });
      }
      loaded = await persistence.loadBatch(sending.batchId, requestOptions);
      if (!loaded.ok) throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(loaded.error) });
      const released = await releaseBatch(loaded.batch, "approved", {
        haltReason: safeCode(row.ownerProofFreshRetryReason, "owner_proof_retry_wait"),
      }, requestOptions);
      return {
        ok: false,
        batch: released,
        sent: 0,
        remaining: lineState.batchCounts(released).queued,
        retryable: true,
        retryDelaySeconds: ownerProofRetryDelaySeconds,
      };
    }
    if (sending.lane === "sandbox"
      && safeCode(row.ownerProofFreshRetryReason) === OWNER_PROOF_SIGNAL_VISIBILITY_RETRY) {
      // The first GET after CallPrep create may have cached a 404/unknown result
      // before the created UUID was persisted. Revalidating that durable UUID
      // on a fresh prepare must not replay the negative cache and must not POST.
      try { clearSignalReportCache(); } catch { /* prepare remains fail-closed */ }
    }

    const send = senderFactory({ lane: sending.lane, batchId: sending.batchId, deps: dependencies.deliveryDeps || {} });
    const sendOptions = { sequence: 1, step: 1, deadlineAt: context.deadlineAt };
    let deliveryRow = row;
    const deliveryAttemptsBefore = Math.max(Number(row.deliveryAttempts) || 0, 0);
    const deliveryFingerprintBefore = String(row.deliveryInputFingerprint || "").trim().toLowerCase();
    let attemptCheckpointed = false;
    let preProviderHold = false;
    let providerNotAttempted = false;
    let signalReportAttemptsThisPass = 0;
    let signalReportRetryWindowClosed = false;
    let result;

    if (typeof send.prepare === "function" && typeof send.deliver === "function") {
      const parentBeforePrepare = await loadParentForWork(sending.batchId, ["sending"], requestOptions);
      if (!parentBeforePrepare.ok) {
        return { ok: true, batch: parentBeforePrepare.batch, sent: 0, remaining: 0, skipped: parentBeforePrepare.skipped };
      }
      const plan = await send.prepare(row, sendOptions);
      if (!plan || plan.ok !== true) {
        result = plan;
        preProviderHold = !(plan && (
          plan.reapprovalRequired === true
          || plan.retryableBeforeProvider === true
        ));
        providerNotAttempted = true;
      } else {
        const fingerprint = String(plan.inputFingerprint || "").trim().toLowerCase();
        const storedFingerprint = deliveryFingerprintBefore;
        if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
          result = { ok: false, reason: "delivery_fingerprint_failed" };
          preProviderHold = true;
          providerNotAttempted = true;
        } else if (storedFingerprint && !fingerprintsMatch(storedFingerprint, fingerprint)) {
          // Once a provider-bound payload fingerprint is durable, a different
          // payload is an unknown-outcome reconciliation case. It must never be
          // silently sent under the old provider key.
          result = {
            ok: false,
            reason: "delivery_payload_reconciliation_required",
            manualReconciliationRequired: true,
          };
          providerNotAttempted = true;
        } else if (Math.max(Number(row.deliveryAttempts) || 0, 0) >= MAX_DELIVERY_ATTEMPTS) {
          result = {
            ok: false,
            reason: "delivery_attempt_limit_reconciliation_required",
            manualReconciliationRequired: true,
          };
          providerNotAttempted = true;
        } else {
          const attemptedAt = now();
          const preparedRow = {
            ...row,
            deliveryInputFingerprint: fingerprint,
            deliveryIdempotencyKey: safeOpaque(plan.idempotencyKey),
            deliveryPreparedAt: row.deliveryPreparedAt || attemptedAt,
            deliveryProviderAttemptedAt: attemptedAt,
            deliveryAttempts: Math.max(Number(row.deliveryAttempts) || 0, 0) + 1,
          };
          const prepared = await persistence.checkpointRow({
            rowId: row.rowId,
            leaseToken: row.leaseToken,
            expectedVersion: row.version,
            expectedStatus: "queued",
            row: preparedRow,
            releaseLease: false,
          }, requestOptions);
          if (!prepared.ok || !prepared.row) {
            throw Object.assign(new Error("line_send_prepare_checkpoint_failed"), { code: safeCode(prepared.error) });
          }
          deliveryRow = prepared.row;
          attemptCheckpointed = true;
          // This is the first provider call. The exact payload fingerprint and
          // stable key are already durable on the still-leased queued row.
          const parentBeforeDeliver = await loadParentForWork(sending.batchId, ["sending"], requestOptions);
          if (!parentBeforeDeliver.ok) {
            return { ok: true, batch: parentBeforeDeliver.batch, sent: 0, remaining: 0, skipped: parentBeforeDeliver.skipped };
          }
          result = await send.deliver(plan, { expectedInputFingerprint: fingerprint });
          if (sending.lane === "sandbox"
            && result?.retryableBeforeProvider === true
            && result?.providerAttempted === false
            && SIGNAL_REPORT_RETRYABLE_REASONS.has(safeCode(result.reason))) {
            signalReportAttemptsThisPass = 1;
          }
          while (signalReportAttemptsThisPass > 0
            && signalReportAttemptsThisPass < MAX_SIGNAL_REPORT_RETRY_ATTEMPTS
            && result?.retryableBeforeProvider === true
            && result?.providerAttempted === false
            && SIGNAL_REPORT_RETRYABLE_REASONS.has(safeCode(result.reason))) {
            const delayMs = SIGNAL_REPORT_RETRY_DELAYS_MS[signalReportAttemptsThisPass - 1] || 0;
            const remainingMs = Number(context.deadlineAt) - Number(clock());
            if (!Number.isFinite(remainingMs)
              || remainingMs <= delayMs + SIGNAL_REPORT_RETRY_MIN_REMAINING_MS) {
              signalReportRetryWindowClosed = true;
              break;
            }
            const waited = await signalReportRetryWait(delayMs, context.signal);
            if (waited === false) {
              signalReportRetryWindowClosed = true;
              break;
            }
            // fetchReportFacts caches failures for ten minutes. A report just
            // created by prepare() may therefore replay its first 404 forever
            // unless the GET-only retry explicitly invalidates that negative.
            try { clearSignalReportCache(); } catch { /* retry stays fail-closed */ }
            const parentBeforeSignalRetry = await loadParentForWork(
              sending.batchId,
              ["sending"],
              requestOptions,
            );
            if (!parentBeforeSignalRetry.ok) {
              return {
                ok: true,
                batch: parentBeforeSignalRetry.batch,
                sent: 0,
                remaining: 0,
                skipped: parentBeforeSignalRetry.skipped,
              };
            }
            result = await send.deliver(plan, { expectedInputFingerprint: fingerprint });
            signalReportAttemptsThisPass += 1;
          }
        }
      }
    } else {
      // Compatibility for focused tests and legacy injected senders. The real
      // Line sender exposes prepare/deliver and always uses the durable path.
      const parentBeforeSend = await loadParentForWork(sending.batchId, ["sending"], requestOptions);
      if (!parentBeforeSend.ok) {
        return { ok: true, batch: parentBeforeSend.batch, sent: 0, remaining: 0, skipped: parentBeforeSend.skipped };
      }
      result = await send(row, sendOptions);
    }
    if (result && result.ok === true && !safeOpaque(result.providerReceipt, 160)) {
      result = {
        ok: false,
        reason: "provider_receipt_missing",
        manualReconciliationRequired: true,
      };
    }
    if (result && (result.policyHold === true
      || (result.providerAttempted === false && result.retryableBeforeProvider !== true))) {
      preProviderHold = true;
      providerNotAttempted = true;
    }
    if (result && result.retryableBeforeProvider === true) providerNotAttempted = true;
    if (!result || result.ok !== true) {
      const reapproval = result && result.reapprovalRequired === true;
      const manualReconciliation = result && result.manualReconciliationRequired === true;
      const retryableBeforeProvider = result && result.retryableBeforeProvider === true;
      const resultReason = safeCode(result?.reason, "delivery_refused");
      const releaseFailureKind = safeCode(result?.releaseFailureKind, "");
      const freshRetryKind = ownerProofFreshRetryKind({
        lane: sending.lane,
        retryableBeforeProvider,
        reason: resultReason,
        releaseFailureKind,
      });
      const publicReleaseReconciliation = sending.lane === "sandbox"
        && retryableBeforeProvider
        && resultReason === OWNER_PROOF_PUBLIC_RELEASE_UNAVAILABLE
        && freshRetryKind !== "public_release";
      const evidencePersistReconciliation = sending.lane === "sandbox"
        && retryableBeforeProvider
        && resultReason === OWNER_PROOF_EVIDENCE_PERSIST_UNAVAILABLE;
      const freshRetryAttempts = freshRetryKind
        ? Math.max(Number(row.ownerProofFreshRetryAttempts) || 0, 0) + 1
        : Math.max(Number(row.ownerProofFreshRetryAttempts) || 0, 0);
      const freshRetryExhausted = Boolean(freshRetryKind)
        && freshRetryAttempts >= MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS;
      const freshRetryExhaustedReason = freshRetryExhausted
        ? ownerProofFreshRetryExhaustedReason(freshRetryKind)
        : "";
      const signalReportRetryable = sending.lane === "sandbox"
        && retryableBeforeProvider
        && SIGNAL_REPORT_RETRYABLE_REASONS.has(resultReason);
      const signalReportReconciliation = sending.lane === "sandbox"
        && retryableBeforeProvider
        && (SIGNAL_REPORT_RECONCILIATION_REASONS.has(resultReason)
          || resultReason.startsWith("owner_proof_signal_report_identity_mismatch:"));
      const signalReportRetryAttempts = signalReportRetryable
        ? Math.max(Number(row.signalReportRetryAttempts) || 0, 0)
          + Math.max(signalReportAttemptsThisPass, 1)
        : Math.max(Number(row.signalReportRetryAttempts) || 0, 0);
      const signalReportRetryExhausted = signalReportRetryable
        && (
          !attemptCheckpointed
          || signalReportRetryWindowClosed
          || signalReportRetryAttempts >= MAX_SIGNAL_REPORT_RETRY_ATTEMPTS
        );
      const reconciliationRequired = manualReconciliation
        || signalReportReconciliation
        || publicReleaseReconciliation
        || evidencePersistReconciliation;
      // A recipient change found at the final provider boundary is still a
      // pre-provider outcome, but it belongs back in human approval. It must
      // never be reclassified as a terminal policy hold merely because the
      // provider correctly reports providerAttempted:false.
      const policyHold = (preProviderHold && !manualReconciliation && !reapproval)
        || signalReportRetryExhausted
        || freshRetryExhausted;
      const deliveryAttempts = providerNotAttempted || policyHold
        ? deliveryAttemptsBefore
        : attemptCheckpointed
        ? Math.max(Number(deliveryRow.deliveryAttempts) || 0, 0)
        : Math.max(Number(deliveryRow.deliveryAttempts) || 0, 0) + 1;
      const exhausted = deliveryAttempts >= MAX_DELIVERY_ATTEMPTS
        && !(result && result.reapprovalRequired === true)
        && !manualReconciliation
        && !policyHold;
      let retryRow = {
        ...deliveryRow,
        deliveryAttempts,
        lastRetryableError: signalReportRetryExhausted
          ? SIGNAL_REPORT_RETRY_EXHAUSTED
          : freshRetryExhausted
          ? freshRetryExhaustedReason
          : resultReason,
        ...(signalReportRetryable ? { signalReportRetryAttempts } : {}),
        ...(freshRetryKind ? {
          ownerProofFreshRetryAttempts: freshRetryAttempts,
          ownerProofFreshRetryAfter: freshRetryExhausted
            ? ""
            : new Date(retryClock() + ownerProofFreshRetryDelay(freshRetryAttempts)).toISOString(),
          ownerProofFreshRetryReason: resultReason,
          ownerProofFreshRetryKind: freshRetryKind,
        } : (row.ownerProofFreshRetryAfter ? { ownerProofFreshRetryAfter: "" } : {})),
        ...((policyHold || reapproval || retryableBeforeProvider) && attemptCheckpointed && !deliveryFingerprintBefore ? {
          deliveryInputFingerprint: "",
          deliveryIdempotencyKey: "",
          deliveryPreparedAt: "",
          deliveryProviderAttemptedAt: "",
        } : {}),
      };
      if (exhausted) {
        const terminal = lineState.advanceRow(deliveryRow, "error", {
          reason: "delivery_retry_exhausted",
          now: now(),
        });
        if (!terminal.ok) throw Object.assign(new Error("line_send_retry_transition_failed"), { code: "line_send_retry_transition_failed" });
        retryRow = { ...terminal.row, deliveryAttempts, lastRetryableError: "delivery_retry_exhausted" };
      }
      const retried = await persistence.checkpointRow({
        rowId: deliveryRow.rowId,
        leaseToken: deliveryRow.leaseToken,
        expectedVersion: deliveryRow.version,
        expectedStatus: "queued",
        row: retryRow,
        releaseLease: true,
      }, requestOptions);
      if (!retried.ok) throw Object.assign(new Error("line_send_checkpoint_failed"), { code: safeCode(retried.error) });
      loaded = await persistence.loadBatch(sending.batchId, requestOptions);
      if (!loaded.ok) throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(loaded.error) });
      if (loaded.batch.status === "halted") {
        return {
          ok: false,
          batch: loaded.batch,
          sent: 0,
          remaining: lineState.batchCounts(loaded.batch).queued,
          skipped: "batch_halted",
        };
      }
      const remainingAfterFailure = lineState.batchCounts(loaded.batch).queued;
      const quotaIncomplete = quota.finishedQuotaEnabled(loaded.batch)
        && quota.remainingFinishedQuota(loaded.batch) > 0;
      const nextStatus = reconciliationRequired || policyHold
        ? "halted"
        : reapproval
        ? "awaiting_approval"
        : exhausted && remainingAfterFailure < 1
          ? (quotaIncomplete ? "halted" : "done")
          : "approved";
      const released = await releaseBatch(loaded.batch, nextStatus, {
        haltReason: freshRetryExhausted
          ? freshRetryExhaustedReason
          : signalReportRetryExhausted
          ? SIGNAL_REPORT_RETRY_EXHAUSTED
          : signalReportReconciliation
          ? resultReason
          : reconciliationRequired || policyHold
          ? resultReason
          : exhausted && quotaIncomplete
            ? quotaHaltReason(loaded.batch, "quota_delivery_exhausted")
            : exhausted ? "delivery_retry_exhausted" : safeCode(result?.reason, "delivery_refused"),
        ...(reapproval ? { approval: null } : {}),
        ...(["done", "halted"].includes(nextStatus) ? { settledAt: now() } : {}),
      }, requestOptions);
      if (isStaleBatchGeneration(released)) {
        return {
          ok: true,
          batch: released,
          sent: 0,
          remaining: lineState.batchCounts(released).queued,
          skipped: "batch_generation_stale",
        };
      }
      if (exhausted) {
        return { ok: true, batch: released, sent: 0, remaining: remainingAfterFailure, exhausted: true };
      }
      if (!reapproval) {
        if (reconciliationRequired || policyHold) {
          return {
            ok: false,
            batch: released,
            sent: 0,
            remaining: remainingAfterFailure,
            ...(reconciliationRequired ? { manualReconciliationRequired: true } : { policyHold: true }),
          };
        }
        if (freshRetryKind) {
          return {
            ok: false,
            batch: released,
            sent: 0,
            remaining: remainingAfterFailure,
            retryable: true,
            retryDelaySeconds: Math.max(
              1,
              Math.ceil(ownerProofFreshRetryDelay(freshRetryAttempts) / 1_000),
            ),
          };
        }
        throw Object.assign(new Error("line_delivery_retryable"), { code: safeCode(result?.reason) });
      }
      return { ok: false, batch: released, sent: 0, remaining: lineState.batchCounts(released).queued, reapprovalRequired: true };
    }

    const acceptedAt = safeAcceptedAt(result.acceptedAt, now());
    const sent = lineState.advanceRow(deliveryRow, "sent", { now: acceptedAt });
    if (!sent.ok) throw Object.assign(new Error("line_send_transition_failed"), { code: "line_send_transition_failed" });
    const receiptRow = {
      ...sent.row,
      providerAcceptedAt: acceptedAt,
      deliveryIdempotencyKey: safeOpaque(result.idempotencyKey || deliveryRow.deliveryIdempotencyKey),
      ownerProofFreshRetryAfter: "",
      ownerProofFreshRetryReason: "",
      ...(safeOpaque(result.providerReceipt, 160) ? { providerReceipt: safeOpaque(result.providerReceipt, 160) } : {}),
    };
    const checkpoint = await persistence.checkpointRow({
      rowId: deliveryRow.rowId,
      leaseToken: deliveryRow.leaseToken,
      expectedVersion: deliveryRow.version,
      expectedStatus: "queued",
      row: receiptRow,
      releaseLease: true,
    }, requestOptions);
    // A provider accepted this idempotent operation. Until its receipt is
    // durable, stop; retrying uses the exact same provider key.
    if (!checkpoint.ok) throw Object.assign(new Error("line_send_receipt_checkpoint_failed"), { code: safeCode(checkpoint.error) });
    loaded = await persistence.loadBatch(sending.batchId, requestOptions);
    if (!loaded.ok) throw Object.assign(new Error("line_batch_reload_failed"), { code: safeCode(loaded.error) });
    if (loaded.batch.status === "halted") {
      return {
        ok: true,
        batch: loaded.batch,
        sent: 1,
        remaining: lineState.batchCounts(loaded.batch).queued,
        skipped: "batch_halted_after_provider_acceptance",
      };
    }
    const remaining = lineState.batchCounts(loaded.batch).queued;
    const released = await releaseBatch(loaded.batch, remaining > 0 ? "approved" : "done", {
      sentAt: now(),
      haltReason: "",
    }, requestOptions);
    return { ok: true, batch: released, sent: 1, remaining, complete: remaining === 0 };
  }

  async function processLineMessage(message, options = {}) {
    const startedAt = clock();
    const deadlineAt = startedAt + WORKER_DEADLINE_MS;
    const requestOptions = workerPersistenceOptions({ signal: options.signal, deadlineAt });
    let loaded = await persistence.loadBatch(message.batchId, requestOptions);
    if (!loaded.ok) {
      if (loaded.error === "batch_not_found") return { ok: true, skipped: "batch_not_found" };
      throw Object.assign(new Error("line_batch_load_failed"), { code: safeCode(loaded.error) });
    }
    if (["running", "sending"].includes(loaded.batch.status)) {
      // Queue deliveries survive a Vercel deployment swap, but the worker that
      // claimed the batch does not. Do the same age/CAS recovery used by the
      // cron before calling the durable state "active". Expired row leases are
      // reclaimed below, so a mirrored render-gate row restarts in a fresh
      // Chromium without skipping or weakening the gate.
      const reclaimed = await reclaimStaleBatch(loaded.batch, requestOptions);
      if (reclaimed) loaded = { ok: true, batch: reclaimed };
    }
    const loadedExactSelection = explicitProspectSelection(loaded.batch);
    const exactIdentityValid = !loadedExactSelection.exact
      || (loadedExactSelection.valid && exactRowsMatchSelection(loaded.batch, loadedExactSelection));
    if (!exactIdentityValid) {
      if (["done", "halted"].includes(loaded.batch.status)) {
        return { ok: true, skipped: "batch_exact_identity_invalid", batchId: loaded.batch.batchId, status: loaded.batch.status };
      }
      const reason = loadedExactSelection.valid
        ? "explicit_prospect_rows_mismatch"
        : safeCode(loadedExactSelection.reason, "explicit_prospect_marker_invalid");
      const halted = await persistence.storeBatch({
        batchId: loaded.batch.batchId,
        expectedVersion: loaded.batch.version,
        expectedStatus: loaded.batch.status,
        patch: { status: "halted", pickState: "complete", haltReason: reason, settledAt: now() },
      }, requestOptions);
      if (!halted.ok) {
        if (halted.conflict) return { ok: true, skipped: "exact_identity_halt_lost", batchId: loaded.batch.batchId };
        throw Object.assign(new Error("line_exact_identity_halt_failed"), { code: safeCode(halted.error) });
      }
      return { ok: false, error: "explicit_prospect_identity_invalid", batchId: loaded.batch.batchId, status: "halted" };
    }
    if (message.phase === ROW_QUEUE_PHASE) {
      return advanceQueuedRow(loaded.batch, message, {
        deadlineAt,
        signal: options.signal,
        workerId: String(options.metadata?.messageId || workerId()).slice(0, 160),
      });
    }
    const sendPhase = message.phase === "send";
    if (sendPhase && loaded.batch.status === "approved") {
      if (!hasDurableApproval(loaded.batch)) {
        const repaired = await persistence.storeBatch({
          batchId: loaded.batch.batchId,
          expectedVersion: loaded.batch.version,
          expectedStatus: "approved",
          patch: { status: "awaiting_approval", approval: null, haltReason: "approval_evidence_missing" },
        }, requestOptions);
        if (!repaired.ok) {
          if (repaired.conflict) return { ok: true, skipped: "approval_repair_lost", batchId: loaded.batch.batchId };
          throw Object.assign(new Error("line_approval_repair_failed"), { code: safeCode(repaired.error) });
        }
        return { ok: true, skipped: "approval_evidence_missing", batchId: loaded.batch.batchId, status: "awaiting_approval" };
      }
      const context = {
        deadlineAt,
        signal: options.signal,
        workerId: String(options.metadata?.messageId || workerId()).slice(0, 160),
      };
      const result = await advanceSend(loaded.batch, context);
      if (isStaleBatchGeneration(result.batch)) {
        return {
          ok: true,
          batchId: loaded.batch.batchId,
          status: result.batch?.status,
          sent: result.sent || 0,
          remaining: result.remaining || 0,
          continued: 0,
          queueAccepted: false,
          skipped: "batch_generation_stale",
        };
      }
      const publication = result.batch && result.batch.status === "approved"
        ? await publishNext(result.batch, "send", {
          delaySeconds: Math.max(Number(result.retryDelaySeconds) || 0, 0),
          requestOptions,
        })
        : { accepted: false, skipped: "send_settled" };
      return {
        ok: result.ok !== false,
        batchId: loaded.batch.batchId,
        status: result.batch?.status,
        sent: result.sent || 0,
        remaining: result.remaining || 0,
        continued: publication.accepted === true ? 1 : 0,
        queueAccepted: publication.accepted === true,
        ...(result.reapprovalRequired ? { reapprovalRequired: true } : {}),
        ...(result.manualReconciliationRequired ? { manualReconciliationRequired: true } : {}),
        ...(result.policyHold ? { policyHold: true } : {}),
        ...(result.retryable === true ? {
          retryable: true,
          retryDelaySeconds: Math.max(Number(result.retryDelaySeconds) || 0, 0),
        } : {}),
      };
    }
    if (strandedReadyRows(loaded.batch).length > 0
      && ["awaiting_approval", "done"].includes(String(loaded.batch.status || ""))) {
      const reopened = await persistence.storeBatch({
        batchId: loaded.batch.batchId,
        expectedVersion: loaded.batch.version,
        expectedStatus: loaded.batch.status,
        patch: { status: "building", settledAt: null, haltReason: "" },
      }, requestOptions);
      if (!reopened.ok) {
        if (reopened.conflict) return { ok: true, skipped: "stranded_ready_reopen_lost", batchId: loaded.batch.batchId };
        throw Object.assign(new Error("line_stranded_ready_reopen_failed"), { code: safeCode(reopened.error) });
      }
      return processLineMessage({
        ...message,
        phase: "run",
        sequence: Math.max(Number(loaded.batch.version) || 0, 0) + 1,
      }, options);
    }
    if (["awaiting_approval", "approved", "sending", "done", "halted"].includes(loaded.batch.status)) {
      return { ok: true, skipped: `batch_${loaded.batch.status}`, batchId: loaded.batch.batchId };
    }
    if (message.phase === "hero") {
      const targetId = String(message.rowId || "").trim();
      const matches = (loaded.batch.rows || []).filter((row) => (
        String(row.rowId || "") === targetId
        && row.status === "qualified"
        && row.heroRemaster?.pending === true
      ));
      if (matches.length !== 1) {
        return { ok: true, skipped: "hero_row_not_waiting", batchId: loaded.batch.batchId };
      }
    }
    if (loaded.batch.status === "running") return { ok: true, skipped: "worker_active", batchId: loaded.batch.batchId };

    // Once cheap batch-owned qualification has produced browser work, fan it
    // out before taking the batch CAS. Row-version leases provide the exact
    // ownership boundary, so ten queue deliveries can work ten rows in the
    // same campaign without duplicating a phase. Cheap picked/gate work keeps
    // the original batch-owned path below.
    const hasBatchOwnedRows = (loaded.batch.rows || []).some((row) => (
      ["picked", "gate_passed", "ready"].includes(String(row.status || ""))
    ));
    if (message.phase === "run" && rowFanout && !hasBatchOwnedRows && loaded.batch.pickState === "complete") {
      const wave = await publishHeavyRowWave(loaded.batch);
      if (wave.accepted > 0) {
        const recovery = await publishRowWaveRecovery(loaded.batch, wave);
        return {
          ok: true,
          batchId: loaded.batch.batchId,
          status: loaded.batch.status,
          processed: 0,
          continued: wave.accepted + (recovery.accepted === true ? 1 : 0),
          queueAccepted: true,
          rowFanout: wave.accepted,
          ...(wave.failed > 0 ? { rowFanoutFailed: wave.failed } : {}),
        };
      }
    }

    const claim = await claimBatch(loaded.batch, requestOptions);
    if (!claim.ok) return { ok: true, skipped: claim.skipped, batchId: loaded.batch.batchId };
    const context = {
      deadlineAt,
      signal: options.signal,
      workerId: String(options.metadata?.messageId || workerId()).slice(0, 160),
      forceHeroWake: message.phase === "hero",
      forceHeroRowId: message.phase === "hero" ? String(message.rowId || "").trim() : "",
    };
    const wasPending = loaded.batch.pickState === "pending";
    const picking = claim.batch.pickState === "pending" || claim.batch.pickState === "picking";
    const hasResumableRows = (claim.batch.rows || []).some((row) => runner.terminalRow(row) !== true);
    const hasForcedHeroRow = context.forceHeroWake === true
      && (claim.batch.rows || []).some((row) => row.status === "qualified"
        && String(row.rowId || "") === context.forceHeroRowId
        && row.heroRemaster?.pending === true);
    const claimedExactSelection = explicitProspectSelection(claim.batch);
    const exactNeedsPick = claimedExactSelection.exact
      && claimedExactSelection.valid
      && picking
      && (claim.batch.rows || []).length < claimedExactSelection.ids.length;
    let ranPick = false;
    let result;
    // Finished render gates are batch-owned, so browser-row fanout cannot
    // drain them while replacement mining keeps pickState pending. Give due,
    // unleased gates one normal phase pass before refilling the shortfall.
    // Backoff and another worker's lease must never suppress fresh mining.
    const drainAt = retryClock();
    const hasDueGateRows = (claim.batch.rows || []).some((row) => (
      row.status === "gate_passed"
      && !rowLeaseActive(row, drainAt)
      && rowRetryDelaySeconds(row, drainAt) === 0
    ));
    if (hasForcedHeroRow) {
      result = await advanceRows(claim.batch, context);
    } else if (exactNeedsPick) {
      ranPick = true;
      result = await runPick(claim.batch, context);
    } else if (wasPending && hasDueGateRows && quota.shouldRefill(claim.batch, lineEnvironment)) {
      result = await advanceRows(claim.batch, context);
    } else if (wasPending && quota.shouldRefill(claim.batch, lineEnvironment)) {
      ranPick = true;
      result = await runPick(claim.batch, context);
    } else if (picking && (claim.batch.rows || []).length > 0 && hasResumableRows) {
      result = await reconcilePickedRows(claim.batch, context);
    } else if (picking) {
      ranPick = true;
      result = await runPick(claim.batch, context);
    } else {
      result = await advanceRows(claim.batch, context);
    }

    if (isStaleBatchGeneration(result?.batch)) {
      return {
        ok: true,
        batchId: claim.batch.batchId,
        status: result.batch?.status,
        selected: result.selected || 0,
        processed: result.processed || 0,
        failed: result.failed || 0,
        remaining: result.remaining || 0,
        continued: 0,
        queueAccepted: false,
        skipped: "batch_generation_stale",
      };
    }

    // A freshly persisted packet used to wait for a second queue delivery just
    // to move from picked -> qualified. Claim the released batch again and do
    // that cheap, provider-free phase in this same invocation. The existing
    // row-wave block below then publishes browser-heavy work exactly once.
    if (ranPick
      && inlinePickQualification
      && result?.ok !== false
      && Number(result?.selected) > 0
      && result?.batch?.status === "building"
      && result?.batch?.pickState === "complete") {
      const inlineClaim = await claimBatch(result.batch, requestOptions);
      if (inlineClaim.ok) {
        const selected = result.selected;
        const advanced = await advanceRows(inlineClaim.batch, {
          ...context,
          forcePickedQualification: true,
        });
        result = { ...result, ...advanced, selected, inlineQualified: advanced.processed || 0 };
      }
    }
    const rowWave = result.batch && result.batch.status === "building"
      ? await publishHeavyRowWave(result.batch)
      : { accepted: 0, attempted: 0, failed: 0 };
    const rowWaveRecovery = await publishRowWaveRecovery(result.batch, rowWave);
    const publication = rowWave.accepted > 0
      ? { accepted: true, count: rowWave.accepted + (rowWaveRecovery.accepted === true ? 1 : 0) }
      : result.retryDelaySeconds > 0 && result.batch && result.batch.status === "building"
      ? await publishNext(result.batch, "run", { delaySeconds: result.retryDelaySeconds, requestOptions })
      : result.deferRetry
      ? { accepted: false, skipped: "build_retry_backoff" }
      : result.batch && result.batch.status === "building"
      ? await publishNext(result.batch, "run", { requestOptions })
      : result.batch && result.batch.status === "approved"
        ? await publishNext(result.batch, "send", { requestOptions })
        : { accepted: false, skipped: "settled" };
    return {
      ok: result.ok !== false,
      batchId: claim.batch.batchId,
      status: result.batch?.status,
      selected: result.selected || 0,
      processed: result.processed || 0,
      failed: result.failed || 0,
      remaining: result.remaining || 0,
      continued: publication.accepted === true ? Math.max(Number(publication.count) || 1, 1) : 0,
      queueAccepted: publication.accepted === true,
      ...(rowWave.accepted > 0 ? { rowFanout: rowWave.accepted } : {}),
      ...(rowWave.failed > 0 ? { rowFanoutFailed: rowWave.failed } : {}),
      ...(Number(result.inlineQualified) > 0 ? { inlineQualified: Number(result.inlineQualified) } : {}),
      ...(Number(result.bankDrawn) > 0 ? { bankDrawn: Number(result.bankDrawn) } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(typeof result.retryable === "boolean" ? { retryable: result.retryable } : {}),
    };
  }

  async function reclaimStaleBatch(batch, requestOptions = {}) {
    if (!batch || !["running", "sending"].includes(batch.status)) return batch;
    // Registry rows can omit child rows and housekeeping can advance the batch
    // version/updatedAt without doing work. Reload the canonical rows before
    // deciding whether a worker is alive.
    const canonical = await persistence.loadBatch(batch.batchId, requestOptions);
    if (!canonical.ok || !canonical.batch) return null;
    batch = canonical.batch;
    if (!["running", "sending"].includes(batch.status)) return batch;
    // `clock` is deliberately shifted forward in production to extend the
    // request deadline. Durable row leases and progress timestamps are written
    // in real wall time, so using that shifted deadline clock here can expire a
    // healthy 292s lease 57s early. Compare liveness only on the timestamp
    // source that writes those durable values.
    const at = retryClock();
    if (activeRowLease(batch, at)) return null;
    const progressAt = semanticProgressAt(batch);
    const emptyPicker = batch.status === "running"
      && batch.pickState === "picking"
      && !(batch.rows || []).length;
    const staleAfterMs = emptyPicker ? PICK_HEARTBEAT_STALE_MS : STALE_WORKER_MS;
    if (Number.isFinite(progressAt) && at - progressAt < staleAfterMs) return null;
    const was = batch.status;
    const attemptedAt = providerAttemptAt(batch);
    const providerOutcomeAt = Number.isFinite(attemptedAt) ? attemptedAt : progressAt;
    const unknownProviderOutcome = was === "sending"
      && Number.isFinite(providerOutcomeAt)
      && at - providerOutcomeAt >= PROVIDER_DEDUP_SAFE_MS;
    const reclaimed = await persistence.storeBatch({
      batchId: batch.batchId,
      expectedVersion: batch.version,
      expectedStatus: was,
      patch: {
        status: unknownProviderOutcome ? "halted" : (was === "sending" ? "approved" : "building"),
        ...(was === "running" && batch.pickState === "picking" && !(batch.rows || []).length
          ? { pickState: "pending" }
          : {}),
        haltReason: unknownProviderOutcome ? "delivery_reconciliation_required" : "",
        ...(unknownProviderOutcome ? { settledAt: now() } : {}),
      },
    }, requestOptions);
    if (!reclaimed.ok) return null;
    const loaded = await persistence.loadBatch(batch.batchId, requestOptions);
    return loaded.ok ? loaded.batch : null;
  }

  function rescuePriority(batch) {
    // Registry candidates omit rows, so do not infer health from their batch
    // heartbeat. Inspect every running/sending candidate canonically first;
    // reclaimStaleBatch will skip it when its durable row lease is live.
    if (["running", "sending"].includes(batch?.status)) return 0;
    if (batch?.status === "building") return 1;
    if (batch?.status === "approved") return 2;
    return 4;
  }

  async function rescueLineBatches({ limit = 1 } = {}) {
    const requested = boundedInteger(limit, 1, 1, 10);
    const scanLimit = Math.max(20, requested * 10);
    const query = {
      statuses: ["building", "running", "approved", "sending", "awaiting_approval", "done"],
      limit: scanLimit,
      includeRows: false,
    };
    // Read both ends of the registry: newest contains the operator's current
    // run, oldest contains a deployment orphan even when more than one page of
    // later runs exists. Selection remains one browser-heavy pass per cron.
    const [newest, oldest] = await Promise.all([
      persistence.listBatches({ ...query, order: "updated_at.desc" }),
      persistence.listBatches({ ...query, order: "updated_at.asc" }),
    ]);
    if (!newest.ok || !oldest.ok) {
      throw Object.assign(new Error("line_batch_list_failed"), {
        code: safeCode(newest.ok ? oldest.error : newest.error),
      });
    }
    const registry = new Map();
    for (const batch of [...newest.batches, ...oldest.batches]) registry.set(batch.batchId, batch);
    // HALTED-BATCH EMAIL DRAIN (2026-09-01). A sandbox batch that halted on
    // exhausted sourcing while certified finished sites were still mid-line
    // must not strand them (production: line_mti8u213 — 15 gate_passed sites,
    // sent: 0). Flip drainable halted batches back to "building": the pass
    // below then resumes their rows through the queue phase, and the terminal
    // drain law (quota.terminalCertifiedDrainAllowed / compileTerminal variant)
    // decides the exit status. Mining stays dead — shouldRefill is false for
    // batches with active rows, and the source is exhausted by definition.
    try {
      // limit 25 + oldest-first: busy new batches must not push a stranded
      // halted batch out of the drain scan window (production 2026-09-01:
      // line_mti8u213 with 15 finished sites sat outside the top-10 for hours).
      const haltedScan = await persistence.listBatches({ statuses: ["halted"], limit: 25, includeRows: true, order: "updated_at.asc" });
      if (haltedScan.ok) {
        for (const batch of haltedScan.batches || []) {
          if (String(batch?.lane || "") !== "sandbox") continue;
          // ANY halted sandbox batch with certified finished rows is drainable —
          // the halt reason (supersede, clear_stuck, exhaustion) says nothing
          // about whether finished sites deserve their emails (production:
          // line_mtivrddi halted by clear_stuck with Rooter Right gate_passed).
          // gate_passed is itself the proof: the render gate passed on the
          // live site. (The genieContentCertified flag lives on internal
          // line objects, not the durable row — verified 2026-09-01.)
          const finishedCertified = (batch.rows || []).some((row) => (
            ["gate_passed", "queued"].includes(String(row.status || ""))
          ));
          if (!finishedCertified) continue;
          const resumable = (batch.rows || []).filter((row) => ["gate_passed", "queued", "ready"].includes(String(row.status || "")));
          if (!resumable.length) continue;
          await releaseBatch(batch, "building", { pickState: "complete", settledAt: null }, {});
          registry.set(batch.batchId, { ...batch, status: "building" });
        }
      }
    } catch (drainError) {
      // The drain scan must never break the ordinary rescue sweep.
      await storeDefaults.recordEvent("system.run", { actor: "line_rescue_drain", status: "blocked", stage: "halted_drain_scan_failed", detail: safeCode(drainError && drainError.message, "drain_scan_failed") }).catch(() => null);
    }
    const listed = { batches: [...registry.values()] };
    let selected = 0;
    let processed = 0;
    let skipped = 0;
    let remaining = listed.batches.length;
    // One potentially browser-heavy phase per cron invocation. The queue is
    // primary; this is the independent recovery path when publication is down.
    const ordinaryCandidates = [...listed.batches]
      .filter((batch) => !["running", "sending"].includes(batch?.status))
      .sort((left, right) => {
        const priority = rescuePriority(left) - rescuePriority(right);
        if (priority !== 0) return priority;
        // Within the same class, the latest operator run wins.
        return Date.parse(String(right.updatedAt || "")) - Date.parse(String(left.updatedAt || ""));
      });
    const workerCandidateMap = new Map();
    const addWorkerCandidates = (batches, maximum) => {
      let added = 0;
      for (const batch of batches || []) {
        if (!["running", "sending"].includes(batch?.status)) continue;
        if (!workerCandidateMap.has(batch.batchId)) {
          workerCandidateMap.set(batch.batchId, batch);
          added += 1;
        }
        if (added >= maximum) break;
      }
    };
    // A registry page can contain dozens of healthy running rows. Loading all
    // of them defeats the rescue cron's bounded-work contract. Inspect at most
    // four: two from the current/newest end and two from the stale-oldest end.
    // The canonical row lease remains the authority for whether each is live.
    addWorkerCandidates(newest.batches, 2);
    addWorkerCandidates(oldest.batches, 2);
    const candidates = [...workerCandidateMap.values(), ...ordinaryCandidates];
    for (const candidate of candidates) {
      let batch = candidate;
      const wasSending = batch.status === "sending";
      if (["running", "sending"].includes(batch.status)) batch = await reclaimStaleBatch(batch);
      if (!batch) { skipped += 1; continue; }
      selected += 1;
      const phase = wasSending || batch.status === "approved" ? "send" : "run";
      const result = await processLineMessage({ batchId: batch.batchId, phase, sequence: batch.version }, {
        metadata: { messageId: `cron:${batch.batchId}:${batch.version}` },
      });
      if (result.skipped === "batch_done" || result.skipped === "batch_awaiting_approval") {
        skipped += 1;
        continue;
      }
      processed += result.processed || result.selected || 0;
      if (result.status && result.status !== "building") remaining = Math.max(0, remaining - 1);
      break;
    }
    return { ok: true, selected, processed, skipped, remaining, continued: selected };
  }

  async function markLineMessagePoison(message, { failureCode, metadata } = {}) {
    const loaded = await persistence.loadBatch(message.batchId);
    if (!loaded.ok) return { persisted: false };
    const batch = loaded.batch;
    // A version conflict means another worker already won this exact durable
    // generation. It is not poison and can never justify halting that winner.
    if (safeCode(failureCode) === "batch_version_conflict") {
      return { persisted: true, skipped: "batch_generation_stale" };
    }
    if (["awaiting_approval", "approved", "done", "halted"].includes(batch.status)) return { persisted: true };
    if (message.phase === ROW_QUEUE_PHASE) {
      const row = (batch.rows || []).find((candidate) => (
        String(candidate.rowId || "") === String(message.rowId || "")
      ));
      // A different delivery already advanced this exact phase. The poison is
      // obsolete and safe to acknowledge without changing any other row.
      if (!row || !BROWSER_HEAVY_ROW_STATUSES.includes(String(row.status || ""))) {
        return { persisted: true };
      }
      // Never steal a healthy browser lease merely because duplicate queue
      // deliveries reached their retry ceiling at different speeds. The
      // delivery that owns the lease may, however, terminal-checkpoint its own
      // exhausted row immediately instead of waiting for a 292s expiry loop.
      const deliveryOwner = String(metadata?.messageId || "").trim().slice(0, 160);
      const activeLease = rowLeaseActive(row, retryClock());
      if (activeLease && (!deliveryOwner || row.leaseOwner !== deliveryOwner)) return { persisted: false };
      const poisonWorker = `row_poison_${safeCode(failureCode)}`.slice(0, 160);
      let owned = activeLease ? row : null;
      if (!owned) {
        const claimed = await persistence.claimRows({
          batchId: batch.batchId,
          rowId: row.rowId,
          expectedVersion: row.version,
          workerId: poisonWorker,
          limit: 1,
          statuses: [row.status],
          leaseMs: Math.min(WORKER_DEADLINE_MS + 10_000, 240_000),
        });
        if (!claimed.ok || (claimed.rows || []).length !== 1) return { persisted: false };
        [owned] = claimed.rows;
      }
      const terminal = lineState.advanceRow(owned, "error", {
        reason: `queue_poison:${safeCode(failureCode)}`,
        now: now(),
      });
      if (!terminal.ok) return { persisted: false };
      const checkpoint = await persistence.checkpointRow({
        rowId: owned.rowId,
        leaseToken: owned.leaseToken,
        expectedVersion: owned.version,
        expectedStatus: owned.status,
        row: terminal.row,
        releaseLease: true,
      });
      if (!checkpoint.ok) return { persisted: false };
      const fresh = await persistence.loadBatch(batch.batchId);
      if (fresh.ok && fresh.batch?.status === "building") await publishNext(fresh.batch, "run");
      return { persisted: true };
    }
    const stored = await persistence.storeBatch({
      batchId: batch.batchId,
      expectedVersion: batch.version,
      expectedStatus: batch.status,
      patch: {
        status: "halted",
        haltReason: `queue_poison:${safeCode(failureCode)}`,
        settledAt: now(),
      },
    });
    return { persisted: stored.ok === true };
  }

  return { processLineMessage, rescueLineBatches, markLineMessagePoison, publishNext };
}

const defaults = createLineContinuation();

module.exports = {
  PICK_TIMEOUT_MS,
  PICK_HEARTBEAT_STALE_MS,
  STALE_WORKER_MS,
  WORKER_DEADLINE_MS,
  HALTED_SEND_DRAIN_ACTOR,
  BROWSER_HEAVY_ROW_CLAIM,
  MAX_DELIVERY_ATTEMPTS,
  MAX_BUILD_RETRY_ATTEMPTS,
  MAX_SIGNAL_REPORT_RETRY_ATTEMPTS,
  MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS,
  OWNER_PROOF_FRESH_RETRY_BASE_MS,
  BUILD_RETRY_BASE_MS,
  BUILD_RETRY_MAX_MS,
  CAPTURE_PERSISTENCE_RESERVE_MS,
  PROVIDER_DEDUP_SAFE_MS,
  createLineContinuation,
  explicitProspectSelection,
  explicitProspectIds,
  exactRowsMatchSelection,
  exactPracticeRecoveryPlan,
  loadExactPracticeRecoverySnapshot,
  exactPickErrorRetryable,
  campaignQueryGeometry,
  CAMPAIGN_TIMING_STAGE,
  CAMPAIGN_TIMING_TRANSITIONS,
  campaignTimingFrom,
  campaignStartAt,
  firstRowTransitionAt,
  queueDueOnlyEnabled,
  rowQueueFanoutEnabled,
  inlinePickQualificationEnabled,
  gateWithCapture,
  pickedRows,
  safeCode,
  mirrorFailureSummary,
  hasDurableApproval,
  ...defaults,
};
