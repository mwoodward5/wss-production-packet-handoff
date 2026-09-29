"use strict";

const { createHash, randomUUID } = require("node:crypto");

/**
 * api/admin/line.js — the operator control surface's ONLY backend.
 *
 *   GET  /api/admin/line                 -> readiness, holds, spend, batches
 *   GET  /api/admin/line?batchId=…       -> one batch with live per-row progress
 *   POST { action:"start", count, target, lane }   -> run the line
 *   POST { action:"approve", batchId, typedBatchId } -> the human gate
 *   POST { action:"send", batchId }      -> refuses without that approval
 *   POST { action:"drain_emails", batchId, max? }   -> direct synchronous
 *        finish-and-send for gate_passed/queued SANDBOX rows (bypasses the
 *        queue entirely — see drainSandboxEmails below)
 *   POST { action:"recapture_proofs", batchId, max? } -> evidence-ONLY repair:
 *        re-runs the render gate's proof-shot capture for built rows whose
 *        pairs predate the capture fixes and writes the completed record back.
 *        Never sends; both lanes; capped at 3 rows per call.
 *
 * SAFETY POSTURE
 *   · admin-gated like every other /api/admin route,
 *   · `lane:"live"` requires BOTH an explicit operator approval and the
 *     server-side live switch; without it every recipient is force-routed to
 *     the owner address by lib/sandbox-send,
 *   · a delivery pause or an active review hold blocks `send` outright,
 *   · the render gate runs inside lib/line-runner and cannot be turned off
 *     from this route: there is no field here that reaches it.
 */

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const lineState = require("../../lib/line-state");
const runner = require("../../lib/line-runner");
const linePersistence = require("../../lib/line-persistence");
const { enqueueLineMessage } = require("../../lib/line-queue");
const { createLineSender } = require("../../lib/line-delivery");
const { START_WATCH_STAGE } = require("../../lib/line-batch-sweeper");
const { LAUNCH_SIZES } = runner;
const { runRenderGate, FACTS } = require("../../lib/render-gate");
const { deliveryPauseStatus } = require("../../lib/delivery-pause");
const { reviewHoldActive } = require("../../lib/email");
const { ownerSandboxAddress, forceOwnerRecipient, assertOwnerOnly } = require("../../lib/sandbox-send");
const { signedVisualPath } = require("../../lib/preview-visuals");
const { renderConcurrency } = require("../../lib/serverless-chromium");
const { uploadConcurrency } = require("../../lib/mirror-engine/deploy");
const {
  CAPTURE_BUDGET_MS,
  automaticProofShotRecord,
  assetsAreCurrent,
  captureLineEmailAssets,
  deliveryProofIdentity,
} = require("../../lib/line-email-assets");
const { isApprovedPreviewUrl } = require("../../lib/preview-host-guard");
const { checkPreviewLive } = require("../../lib/preview-liveness");
// Target recognition mirrors the SOURCE-MODE RESOLVERS, not a new grammar:
// line-quota's nextQuotaSource (leadminer / all-trades / "<trade> nationwide")
// and line-adapters' parseTarget ("<approved trade> in|near <market>"). A start
// whose target none of them can serve must be refused HERE, loudly — before it
// mints a "building" batch the pick machinery can only silently doom.
const { allTradesTarget, requestedDeepBatchDepth, DEEP_BATCH_DEPTH_ENV } = require("../../lib/line-quota");
const { approvedIndustry } = require("../../lib/copilot");

// Wall-clock this route allows itself for one send pass. See the send handler.
const SEND_BUDGET_MS = 210_000;
// Wall-clock this route allows itself for one BUILD pass. vercel.json caps the
// build-running functions at 800s (raised 2026-08-31 from 300s: full mirror
// builds run 240-260s+, and 250s mirror timeout + settlement headroom exceeded
// the old cap mid-settle — every long build froze as a lost-settle zombie).
// Each start pass claims new rows for at most this long, then hands the batch
// back as "building" with the rest still "picked". The console re-POSTs
// {action:"start", batchId} until it settles — the same resumable shape the
// SEND path already uses, with ~150s of head room to persist and answer.
const BUILD_BUDGET_MS = 650_000;
// SANDBOX AUTO-SEND. The owner does not want to hand-approve 500 sandbox sites
// (every one routes to his own inbox). When this is on, a settled sandbox batch
// is auto-approved and auto-sent to the owner without a manual click. It is ON
// by default — set GHOST_AGENCY_SANDBOX_AUTOSEND=false to disable. NEVER
// applies to the live lane; live always requires the typed approval action.
const SANDBOX_AUTOSEND_SWITCH = "GHOST_AGENCY_SANDBOX_AUTOSEND";
function sandboxAutoSendEnabled() {
  return String(process.env[SANDBOX_AUTOSEND_SWITCH] || "").trim() !== "false";
}
const { qualifyForBuild } = require("../../lib/build-qualification");
const { select, upsertRow, conditionalUpdate, recordEvent } = require("../../lib/store");
const { ensureLineReport } = require("../../lib/line-report");
const { clientReferenceCode } = require("../../lib/client-reference");
const { CAMPAIGN_TIMING_STAGE, HALTED_SEND_DRAIN_ACTOR, campaignTimingFrom } = require("../../lib/line-continuation");

const LIVE_SWITCH = "GHOST_AGENCY_LINE_LIVE_SENDS";
const PROSPECTS = "ghost_agency_prospects";
const QUEUE_PUBLISH_TIMEOUT_MS = 8_000;
const DIRECT_START_RECOVERY_TIMEOUT_MS = 1_800;
// HALTED-BATCH SEND DRAIN (owner email-now law, 2026-09-01). A halt is terminal
// for SOURCING only — it must never hold already-finished sites hostage. One
// drain pass sends one queued row through the SAME continuation send machinery
// the settled batch uses (claim, fingerprint, provider idempotency), so this
// budget bounds passes between full 225s worker deadlines the same way
// SEND_BUDGET_MS bounds rows inside sendApprovedBatch: stop BEFORE starting a
// pass the platform ceiling could not finish.
const HALTED_DRAIN_BUDGET_MS = 120_000;
const HALTED_DRAIN_MAX_PASSES = 50;
// DIRECT EMAIL DRAIN (owner email-now law, 2026-09-01). Rows reach
// gate_passed with live previews and passing gates, then never move again:
// the queue delivery that should resume them never fires, so the
// gate_passed -> queued -> sent transition — and with it #560's
// send-on-finish email — simply never runs. drain_emails stops waiting for
// the queue: it drives the SAME processRowPhase resume block the runner uses,
// plus the SAME createLineSender sandbox factory the settle-send and
// send-on-finish paths use, synchronously inside this request. Rows already
// sent are skipped (idempotent); a row that fails is left at its last good
// status and named in the response; one bad row never blocks the rest.
const DRAIN_EMAILS_MAX_DEFAULT = 25;
const DRAIN_EMAILS_MAX_LIMIT = 100;
// The route's vercel.json entry is 800s (same cap the build budget already
// assumes). Stop starting new rows at 650s so the last send still has ~150s
// to persist its checkpoint and answer — the same headroom law as
// BUILD_BUDGET_MS.
const DRAIN_EMAILS_BUDGET_MS = 650_000;
const DRAIN_EMAILS_ROW_LEASE_MS = 600_000;
const DRAIN_EMAILS_ROW_TURNS = 6;
// A row whose claim is lost is retried ONCE after this beat before the drain
// moves on. A transient CAS race resolves on the second pass; a stale holder's
// lease seconds from expiry lapses into reach. A dead holder's lease is
// reclaimed INSIDE claimRows itself (the 10-minute staleness law) — this retry
// is for the race, not the corpse. Tests may shorten it via
// overrides.drainClaimRetryDelayMs.
const DRAIN_CLAIM_RETRY_DELAY_MS = 2_000;
// PROOF RE-CAPTURE (owner repair law, 2026-09-02). Rows built before the
// render-gate capture fixes (#583/#584) went Ready can sit gate_passed with an
// INCOMPLETE proof-shot pair — automaticProofShotRecord writes the record only
// when BOTH sides of the comparison are stored with their pixel digests
// (lib/line-email-assets.js), so those rows have no proof_shots anywhere and
// every send dies at the email's visual gate with "no_before_after_visuals".
// There was no way to repair a BUILT row: re-running the line rebuilds the
// site. recapture_proofs re-runs ONLY the capture (the exact machinery the
// render gate's hook calls — captureLineEmailAssets on its own chromium, the
// same lane the light-verification law uses), then writes the completed record
// back to the row and the prospect. IT NEVER SENDS: the normal queue/drain
// does that, exactly as before. Deliberately unlike drain_emails:
//   · NO lane refusal — the typed-approval law governs SENDS, and this action
//     sends nothing on either lane; it only repairs evidence,
//   · NO readiness gate — a delivery pause or review hold holds MAIL, not
//     screenshots; the rows stay exactly where they are.
const RECAPTURE_PROOFS_MAX_ROWS = 3;
const RECAPTURE_PROOFS_BUDGET_MS = 650_000;
const RECAPTURE_PROOFS_ROW_LEASE_MS = 600_000;
// How many repair-eligible rows one invocation may EXAMINE (prospect reads
// only). The browser cap is RECAPTURE_PROOFS_MAX_ROWS; this just bounds the
// free skip/refusal scan so reads never dominate the request.
const RECAPTURE_PROOFS_SCAN_LIMIT = 25;
// A "before" that lands OFF the prospect's own registrable domain is a fact
// about their domain, not a flake (lib/proof-storage.capturedShotBelongsTo).
// Re-shooting the same site reproduces the same refusal, so after TWO identity
// refusals the row is MARKED with the named reason and never captured again —
// the operator reads the reason instead of the action paying for a third
// identical browser run.
const RECAPTURE_PROOFS_BEFORE_ATTEMPT_LIMIT = 2;
const CLIENT_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const APPROVAL_INPUT_ERRORS = new Set([
  "approval_confirmation_mismatch",
  "expected_version_required",
  "nothing_passed_the_render_gate",
]);
const OWNER_TYPED_APPROVAL_ACTOR = "owner_typed_batch_id";
const LEGACY_LIVE_AUTO_APPROVAL_ACTORS = new Set([
  "factory_auto_after_qc",
  "campaign_start_live",
  "live_auto",
]);
const HALT_REASON = /^[a-z][a-z0-9_]{2,79}$/;

function legacyLiveAutoApproval(batch) {
  return batch?.lane === "live"
    && LEGACY_LIVE_AUTO_APPROVAL_ACTORS.has(String(batch.approval?.actor || "").trim());
}

function safeShotUrl(previewUrl) {
  if (!previewUrl) return "";
  const signed = signedVisualPath({ kind: "new", previewUrl });
  if (!signed) return "";
  // Same daily cache-bust the gallery appends (api/admin/gallery-data.js): the
  // signed key is derived from the preview URL alone — it never changes when
  // the stored JPEG is re-captured — and /api/media/preview-shot serves
  // week-long immutable cache headers, so a backfilled gate shot stayed hidden
  // behind week-cached spacers in the batch rows while the gallery showed it.
  // Rotating `c` daily bounds that staleness at 24h on both surfaces.
  return `${signed}${signed.includes("?") ? "&" : "?"}c=${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
}

const PHASE_BY_STATUS = Object.freeze({
  picked: "qualification",
  qualified: "mirror_build",
  mirrored: "render_gate",
  gate_passed: "email_queue",
  ready: "ready",
  queued: "delivery",
});
const PIPELINE_PHASES = Object.freeze(["qualification", "mirror_build", "render_gate", "email_queue"]);

function finiteTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function rowTelemetry(row, observedAt = Date.now()) {
  const history = (Array.isArray(row && row.history) ? row.history : [])
    .map((item) => ({
      status: String(item && item.status || ""),
      at: String(item && item.at || ""),
    }))
    .filter((item) => item.status && finiteTimestamp(item.at) !== null);
  const completed = {};
  for (let index = 0; index < history.length - 1; index += 1) {
    const current = history[index];
    const next = history[index + 1];
    const phase = PHASE_BY_STATUS[current.status];
    const started = finiteTimestamp(current.at);
    const finished = finiteTimestamp(next.at);
    if (!phase || started === null || finished === null || finished < started) continue;
    completed[phase] = {
      ms: finished - started,
      startedAt: current.at,
      completedAt: next.at,
      result: next.status,
    };
  }
  const latest = history[history.length - 1] || null;
  const latestAt = latest ? finiteTimestamp(latest.at) : null;
  let currentPhase = PHASE_BY_STATUS[String(row && row.status || "")] || "";
  if (row && (row.status === "queued" || row.status === "ready")) currentPhase = "ready";
  if (row && (row.status === "sent" || lineState.isFailed(row.status))) currentPhase = "terminal";
  return {
    currentPhase,
    currentSince: latest ? latest.at : "",
    currentAgeMs: latestAt === null ? null : Math.max(0, Number(observedAt) - latestAt),
    completed,
  };
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function batchPerformance(batch, observedAt = Date.now()) {
  const rows = Array.isArray(batch && batch.rows) ? batch.rows : [];
  const samples = Object.fromEntries([...PIPELINE_PHASES, "delivery"].map((phase) => [phase, []]));
  const active = Object.fromEntries(PIPELINE_PHASES.map((phase) => [phase, 0]));
  let processed = 0;
  for (const row of rows) {
    const telemetry = rowTelemetry(row, observedAt);
    if (Object.prototype.hasOwnProperty.call(active, telemetry.currentPhase)) {
      active[telemetry.currentPhase] += 1;
    }
    for (const [phase, metric] of Object.entries(telemetry.completed || {})) {
      if (samples[phase] && Number.isFinite(Number(metric.ms))) {
        samples[phase].push(Number(metric.ms));
      }
    }
    if (row.status === "ready" || row.status === "queued" || row.status === "sent" || lineState.isFailed(row.status)) {
      processed += 1;
    }
  }
  const phases = {};
  for (const phase of Object.keys(samples)) {
    const values = samples[phase];
    const totalMs = values.reduce((sum, value) => sum + value, 0);
    phases[phase] = {
      active: active[phase] || 0,
      samples: values.length,
      averageMs: values.length ? Math.round(totalMs / values.length) : null,
      p50Ms: percentile(values, 0.50),
      p95Ms: percentile(values, 0.95),
    };
  }
  const startedAt = finiteTimestamp(batch && batch.startedAt);
  const elapsedMs = startedAt === null ? null : Math.max(0, Number(observedAt) - startedAt);
  const target = Math.max(rows.length, Number(batch && batch.requested) || 0);
  const throughputPerMinute = processed > 0 && elapsedMs > 0
    ? processed / (elapsedMs / 60_000)
    : 0;
  const remaining = Math.max(0, target - processed);
  const candidates = PIPELINE_PHASES
    .map((phase) => ({ phase, averageMs: phases[phase].averageMs, samples: phases[phase].samples }))
    .filter((item) => item.samples > 0 && Number.isFinite(item.averageMs))
    .sort((left, right) => right.averageMs - left.averageMs);
  return {
    target,
    processed,
    remaining,
    elapsedMs,
    throughputPerMinute: Math.round(throughputPerMinute * 100) / 100,
    etaMinutes: throughputPerMinute > 0 && remaining > 0
      ? Math.ceil(remaining / throughputPerMinute)
      : 0,
    bottleneck: candidates[0] || null,
    phases,
  };
}

function boundedCapacity(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback;
}

function drainEmailsMax(value) {
  return boundedCapacity(value, DRAIN_EMAILS_MAX_DEFAULT, DRAIN_EMAILS_MAX_LIMIT);
}

function recaptureProofsMax(value) {
  return boundedCapacity(value, RECAPTURE_PROOFS_MAX_ROWS, RECAPTURE_PROOFS_MAX_ROWS);
}

/**
 * The named per-variant capture verdicts, capped, for the proofRecapture
 * marker. The row's reason used to carry only the family label
 * ("capture_incomplete:no_after_shot") while the guard that actually fired
 * lived in capture.results and was discarded — an undiagnosable loop. This is
 * the smallest durable record that lets the next run (or operator) read WHICH
 * guard failed, on WHICH variant, without reopening the bucket.
 */
function summarizeCaptureResults(capture) {
  const results = capture && Array.isArray(capture.results) ? capture.results : [];
  return results.slice(0, 8).map((entry) => ({
    variant: String((entry && entry.variant) || "").slice(0, 16),
    ok: entry && entry.ok === true,
    reason: String((entry && entry.reason) || "").slice(0, 160),
  }));
}

function capacityState() {
  return {
    mirrorWorkers: boundedCapacity(process.env.GHOST_AGENCY_LINE_ROW_CLAIM, 10, 10),
    verificationBrowsers: renderConcurrency(),
    uploadsPerMirror: uploadConcurrency(),
    workerDeadlineMs: 225_000,
    source: "live_configuration",
  };
}

const PUBLIC_HERO_STATUSES = new Set([
  "queued", "running", "awaiting_review", "operator_action_required",
  "done", "failed", "refused", "status_unknown", "blocked", "not_started",
]);
const PUBLIC_HERO_PRODUCERS = new Set([
  "ads_image_to_video", "wan2_i2v_local", "hero_compose_local",
]);
const PUBLIC_HERO_REASONS = new Set([
  "ads_blocked_by_extension",
  "awaiting_owner_review",
  "hero_completion_persist_pending",
  "hero_owned_photo_required",
  "hero_photo_bank_persist_pending",
  "hero_photo_bank_provenance_mismatch",
  "hero_photo_bank_record_read_failed",
  "hero_rebuild_artifact_unproven",
  "hero_rebuild_failed",
  "hero_rebuild_identity_unproven",
  "hero_rebuild_receipt_missing",
  "hero_rebuild_refused",
  "hero_rebuild_status_unavailable",
  "hero_remaster_enqueue_failed",
  "hero_remaster_enqueue_refused",
  "hero_remaster_enqueue_timeout",
  "hero_remaster_failed",
  "hero_remaster_refused",
  "hero_remaster_skipped_without_policy",
  "hero_remaster_status_unavailable",
  "hero_pending_identity_missing",
  "verified_client_hero_failed",
  "verified_client_hero_pending",
]);

function safeHeroReason(value) {
  const reason = String(value || "").trim().toLowerCase();
  return PUBLIC_HERO_REASONS.has(reason) ? reason : "";
}

function publicHeroStatus(row = {}) {
  const raw = row.heroRemaster;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const status = String(raw.status || "").trim().toLowerCase();
  const reason = safeHeroReason(raw.reason);
  const jobId = String(raw.jobId || raw.job_id || "").trim();
  const attemptId = String(raw.attemptId || raw.attempt_id || raw.hero_attempt_id || "").trim();
  const pendingIdentityRequired = raw.pending === true && ["queued", "running", "awaiting_review", "operator_action_required"].includes(status);
  const missingPendingIdentity = pendingIdentityRequired && (!jobId || !attemptId);
  const effectiveStatus = missingPendingIdentity ? "blocked" : status;
  const effectiveReason = missingPendingIdentity ? "hero_pending_identity_missing" : reason;
  const declaredProducer = String(raw.producer || "").trim().toLowerCase();
  // The compact Line row intentionally strips most worker detail. This exact
  // operator marker can only be emitted by the Ads adapter, so retain the safe
  // producer label without exposing a job, profile, account, path, or URL.
  const producer = PUBLIC_HERO_PRODUCERS.has(declaredProducer)
    ? declaredProducer
    : effectiveStatus === "operator_action_required" && effectiveReason === "ads_blocked_by_extension"
      ? "ads_image_to_video"
      : "";
  const safe = {
    pending: missingPendingIdentity ? false : raw.pending === true,
    ...(PUBLIC_HERO_STATUSES.has(effectiveStatus) ? { status: effectiveStatus } : {}),
    ...(effectiveReason ? { reason: effectiveReason } : {}),
    ...(producer ? { producer } : {}),
  };
  return safe.pending || safe.status || safe.reason || safe.producer ? safe : null;
}

function safeRetryAt(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) return "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function mirrorDispatchSummary(row) {
  const raw = row && row.mirrorDispatch && typeof row.mirrorDispatch === "object" ? row.mirrorDispatch : null;
  if (!raw) return null;
  const failure = raw.failure && typeof raw.failure === "object" ? raw.failure : null;
  const status = String(raw.status || "").trim();
  const cause = failure ? String(failure.code || "").trim() : "";
  const detail = failure ? String(failure.detail || "").slice(0, 300).trim() : "";
  const hasDurableBuildIdentity = Boolean(failure && failure.hasDurableBuildIdentity);
  const buildHash = String(raw.buildHash || "").trim();
  // Non-secret operator diagnostics only. Never expose lease tokens, internal
  // fingerprints, row versions, or raw provider credentials.
  return {
    status: status || "unknown",
    attemptId: String(raw.attemptId || "").slice(0, 64),
    reason: String(raw.reason || "").slice(0, 200).trim(),
    beforeBuild: Boolean(failure && failure.beforeBuild === true),
    hasDurableBuildIdentity,
    hasPreview: Boolean(raw.hasPreview === true),
    hasReleaseEvidence: Boolean(raw.hasReleaseEvidence === true),
    ...(buildHash ? { buildHash } : {}),
    ...(cause ? { cause } : {}),
    ...(detail ? { detail } : {}),
    ...(raw.priorAttemptId ? { priorAttemptId: String(raw.priorAttemptId).slice(0, 64) } : {}),
    ...(raw.startedAt ? { startedAt: String(raw.startedAt) } : {}),
    ...(raw.finishedAt ? { finishedAt: String(raw.finishedAt) } : {}),
  };
}

function safeRow(row, observedAt = Date.now()) {
  const heroRemaster = publicHeroStatus(row);
  const buildRetryAfter = heroRemaster ? safeRetryAt(row.buildRetryAfter) : "";
  const sendJobId = String(
    row.sendJobId
    || row.send_job_id
    || (row.send && row.send.jobId)
    || "",
  ).trim();
  const deployUrl = String(
    row.deployUrl
    || row.reportUrl
    || row.deploymentUrl
    || "",
  ).trim();
  const gatePass = row && row.gate && typeof row.gate.pass === "boolean" ? row.gate.pass : null;
  return {
    prospectId: row.prospectId,
    businessName: row.businessName,
    city: row.city,
    state: row.state,
    vertical: row.vertical,
    hasEmail: row.hasEmail === true || Boolean(row.email),
    contactReady: row.contactReady === true,
    contactHoldReason: row.contactHoldReason || "",
    status: row.status,
    previewUrl: row.previewUrl || "",
    // A SIGNED STATIC SCREENSHOT for the console's thumbnail. The console used
    // to embed each mirror as a live iframe, which repainted white on every
    // poll — the owner watched his batch list strobe. The gate already captures
    // a real screenshot of every revealable build; this is that picture, via
    // the same signed first-party route the proof email uses. Empty when no
    // preview exists, and the console shows its neutral block instead.
    shotUrl: safeShotUrl(row.previewUrl),
    reason: row.reason || "",
    ...(heroRemaster ? { heroRemaster } : {}),
    ...(mirrorDispatchSummary(row) ? { mirrorDispatch: mirrorDispatchSummary(row) } : {}),
    ...(buildRetryAfter ? { buildRetryAfter } : {}),
    failedFacts: row.failedFacts || [],
    // Stages this row actually REACHED. The console's progress strip counts
    // these, because a blocked row's current status ("gate_failed") is in no
    // progress order and counting by status alone under-reports the line.
    reached: (row.history || []).map((h) => h.status),
    // Per-fact PASS/FAIL with the reason — the operator's whole answer to
    // "why did this site not ship?"
    facts: (row.gate && row.gate.checks ? row.gate.checks : []).map((c) => ({
      fact: c.fact,
      pass: c.pass,
      reason: c.reason,
    })),
    gateResult: gatePass === null ? "unknown" : gatePass ? "pass" : "fail",
    ...(sendJobId ? { sendJobId } : {}),
    ...(deployUrl ? { deployUrl } : {}),
    updatedAt: row.updatedAt,
    telemetry: rowTelemetry(row, observedAt),
  };
}

function publicCampaignTiming(mineFunnel) {
  const timing = campaignTimingFrom(mineFunnel);
  if (!timing) return null;
  return {
    stage: CAMPAIGN_TIMING_STAGE,
    startedAt: timing.startedAt || null,
    firstQualifiedAt: timing.firstQualifiedAt || null,
    firstBuiltAt: timing.firstBuiltAt || null,
    firstGateAt: timing.firstGateAt || null,
    firstSentAt: timing.firstSentAt || null,
  };
}

function safeBatch(batch) {
  if (!batch) return null;
  const observedAt = Date.now();
  return {
    batchId: batch.batchId,
    mineFunnel: batch.mineFunnel || null,
    campaignTiming: publicCampaignTiming(batch.mineFunnel),
    lane: batch.lane,
    target: batch.target,
    requested: batch.requested,
    status: batch.status,
    pickState: batch.pickState || "complete",
    version: Number(batch.version) || 0,
    haltReason: batch.haltReason || "",
    startedAt: batch.startedAt,
    settledAt: batch.settledAt || null,
    approval: batch.approval || null,
    counts: lineState.batchCounts(batch),
    performance: batchPerformance(batch, observedAt),
    rows: (batch.rows || []).map((row) => safeRow(row, observedAt)),
  };
}

function newCanonicalBatchId(clientKey = "") {
  if (clientKey) {
    const digest = createHash("sha256").update(clientKey).digest("hex").slice(0, 32);
    return `line_req_${digest}`;
  }
  return `line_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function lineRunWatchId(message = {}) {
  const batchId = String(message.batchId || "").trim();
  const phase = String(message.phase || "run").trim().toLowerCase();
  const sequence = Math.max(Number(message.sequence) || 0, 0);
  return batchId ? `line:v1:${batchId}:${phase}:${sequence}` : "";
}

function mineFunnelRows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : [];
}

function withStartWatch(mineFunnel, patch = {}) {
  const rows = mineFunnelRows(mineFunnel).filter((row) => String(row.stage || "") !== START_WATCH_STAGE);
  const prior = mineFunnelRows(mineFunnel).find((row) => String(row.stage || "") === START_WATCH_STAGE) || {};
  return rows.concat([{ ...prior, stage: START_WATCH_STAGE, ...patch }]).slice(-80);
}

function validatedClientIdempotencyKey(value) {
  if (value === undefined || value === null || value === "") return { ok: true, key: "" };
  if (typeof value !== "string") return { ok: false, error: "invalid_idempotency_key" };
  const key = value.trim();
  const digits = key.replace(/\D/g, "");
  const looksLikePhone = /^[\d.:-]+$/.test(key) && digits.length >= 7 && digits.length <= 15;
  if (!CLIENT_IDEMPOTENCY_KEY.test(key) || looksLikePhone) {
    return { ok: false, error: "invalid_idempotency_key" };
  }
  return { ok: true, key };
}

// PHANTOM-START GATE (2026-09-02). A start whose `target` no source-mode
// resolver can serve used to mint a "building" batch and answer 202
// accepted:true anyway — the batch was dead on arrival (the pick halts or
// silently degrades to the freshest-store fallback) and the operator's
// console sat on a success shape with no campaign behind it. Recognize
// EXACTLY the resolver space and canonicalize what passes:
//   · "" / missing            -> ""            (stored-leads mode, the
//                                              console's documented blank)
//   · "leadminer"             -> "leadminer"   (packet shelf)
//   · "paydirt"               -> "paydirt"     (pre-paired leads from the
//                                owner's PayDirt product via the
//                                lib/prospect-sources/paydirt.js adapter)
//   · "all trades" variants   -> "all trades nationwide" (line-quota's own
//                                allTradesTarget table already treats the two
//                                as the same campaign — this is that alias)
//   · "<anything> nationwide" -> trimmed text  (fresh_nationwide resolver)
//   · "<trade> in|near <market>" with an approvedIndustry trade, matching
//     line-adapters' parseTarget grammar exactly.
// Anything else -> {ok:false}: the start handler refuses loudly with
// target_unrecognized:<target> and mints nothing.
const START_TARGET_GRAMMAR = /^(.+?)\s+(?:in|near)\s+(.+)$/i;
const START_TARGET_NATIONWIDE = /^(.+?)\s+nationwide$/i;
const ALL_TRADES_CANONICAL_TARGET = "all trades nationwide";
const RECOGNIZED_START_TARGETS = [
  "roofing in Austin, TX",
  "hvac nationwide",
  ALL_TRADES_CANONICAL_TARGET,
  "leadminer",
  "paydirt",
  "(blank = use stored leads)",
];

function recognizedStartTarget(value) {
  if (value === undefined || value === null) return { ok: true, target: "" };
  if (typeof value !== "string") return { ok: false, target: String(value).slice(0, 120) };
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return { ok: true, target: "" };
  const lowered = normalized.toLowerCase();
  if (lowered === "leadminer") return { ok: true, target: "leadminer" };
  if (lowered === "paydirt") return { ok: true, target: "paydirt" };
  if (allTradesTarget(normalized)) return { ok: true, target: ALL_TRADES_CANONICAL_TARGET };
  if (START_TARGET_NATIONWIDE.test(normalized)) return { ok: true, target: normalized };
  const match = normalized.match(START_TARGET_GRAMMAR);
  if (match && approvedIndustry(match[1].trim()) && match[2].trim()) {
    return { ok: true, target: normalized };
  }
  return { ok: false, target: normalized.slice(0, 120) };
}

// LINE DEEP BATCH DEPTH on the start path (owner doctrine 2026-09-04,
// "scaling and rapid production flow"). A start may request a deeper
// deep-verification wave with `deepBatchDepth` (integer 1..100); without it,
// the environment dial (LINE_DEEP_BATCH_DEPTH) applies; with neither, the
// historical goal-sized cohort is kept and nothing is stamped. The resolved
// request is stamped onto the minted batch's quota-contract row as
// `deep_batch_depth` so every refill of THIS campaign keeps its wave size,
// and the pick forwards it to the miner. An invalid body value refuses the
// start loudly rather than being guessed at.
function requestedStartDeepBatchDepth(body, environment = process.env) {
  const raw = body ? body.deepBatchDepth : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { ok: true, depth: requestedDeepBatchDepth(environment) };
  }
  const parsed = Number(String(raw).trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { ok: false, value: String(raw).slice(0, 40) };
  }
  return { ok: true, depth: Math.min(parsed, 100) };
}

function publishTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000
    ? Math.floor(parsed)
    : QUEUE_PUBLISH_TIMEOUT_MS;
}

function directRecoveryTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 2_000
    ? Math.floor(parsed)
    : DIRECT_START_RECOVERY_TIMEOUT_MS;
}

function safeQueueFailureReason(error) {
  const name = String((error && error.name) || "").trim();
  if (name === "ConsumerRegistryNotConfiguredError") return "registry";
  if (name === "ConsumerDiscoveryError") return "discovery";
  if (name === "UnauthorizedError" || name === "ForbiddenError") return "auth";
  return "other";
}

async function publishLineMessage(enqueue, message, timeoutMs) {
  let timer;
  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => enqueue(message))
        .then((result) => (result && result.accepted === true
          ? result
          : { accepted: false, error: "line_queue_not_accepted", reason: "not_accepted" }))
        // Keep this rejection handler on the publication promise itself. If
        // the deadline wins first, a later SDK rejection is still consumed and
        // can never become an unhandled rejection after the response closes.
        .catch((error) => ({
          accepted: false,
          error: "line_queue_publish_failed",
          reason: safeQueueFailureReason(error),
        })),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({
            accepted: false,
            error: "line_queue_publish_timeout",
            reason: "timeout",
            timedOut: true,
          }),
          timeoutMs,
        );
      }),
    ]);
    return outcome;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function loadHumanContinuation() {
  return require("../../lib/line-continuation-human");
}

async function directStartRecovery(loadContinuation, message, timeoutMs = DIRECT_START_RECOVERY_TIMEOUT_MS) {
  let timer;
  try {
    const continuation = typeof loadContinuation === "function"
      ? loadContinuation()
      : loadContinuation;
    if (!continuation || typeof continuation.processLineMessage !== "function") {
      return { ok: false, skipped: "continuation_unavailable" };
    }
    return await Promise.race([
      Promise.resolve()
        .then(() => continuation.processLineMessage(message, {
          metadata: {
            messageId: `direct-start:${message.batchId}:${message.phase}:${message.sequence}`,
          },
        }))
        // The deadline may win while the continuation is still settling. Keep
        // its rejection attached here so it can never escape after the admin
        // response has closed.
        .catch(() => ({ ok: false, skipped: "continuation_failed" })),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, skipped: "continuation_timeout" }),
          directRecoveryTimeout(timeoutMs),
        );
      }),
    ]);
  } catch {
    return { ok: false, skipped: "continuation_failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function recordAcceptedRun(durable, batch, message) {
  if (!durable || typeof durable.storeBatch !== "function" || !batch || !batch.batchId) return;
  const acceptedRunId = lineRunWatchId(message);
  if (!acceptedRunId) return;
  const marker = {
    accepted_run_id: acceptedRunId,
    accepted_sequence: Math.max(Number(message.sequence) || 0, 0),
    accepted_at: new Date().toISOString(),
    unclaimed_ticks: 0,
    orphan_ticks: 0,
  };
  try {
    await durable.storeBatch({
      batchId: batch.batchId,
      expectedVersion: batch.version,
      expectedStatus: batch.status,
      patch: { mineFunnel: withStartWatch(batch.mineFunnel, marker) },
    });
  } catch {
    // Best-effort marker only; queue/rescue ownership remains authoritative.
  }
}

function legacyStartHarness(overrides) {
  // Existing route tests inject the legacy row adapters directly. Keep that
  // test-only seam while production (which passes no overrides) always uses
  // canonical persistence + the server queue.
  return Boolean(overrides && [
    "pick", "qualify", "mirror", "sourceFacts", "gate", "writePreviewUrl", "queueEmail",
  ].some((key) => Object.prototype.hasOwnProperty.call(overrides, key)));
}

function canonicalReadFailed(result) {
  return !result?.ok && !["batch_not_found", "persistence_not_configured"].includes(String(result?.error || ""));
}

function persistenceUnconfigured(result) {
  return !result?.ok && String(result?.error || "") === "persistence_not_configured";
}

async function exactLegacyBatch(batchId) {
  const id = String(batchId || "").trim();
  if (!id) return null;
  return runner.getBatch(id) || await runner.recoverBatch(id);
}

async function readinessState() {
  const [pause, hold] = await Promise.all([
    deliveryPauseStatus().catch(() => ({ active: true, known: false, reason: "delivery_pause_status_unavailable" })),
    Promise.resolve().then(() => reviewHoldActive()).catch(() => true),
  ]);
  const blockers = [];
  if (pause.active) blockers.push({ code: "delivery_paused", message: pause.reason || "Delivery is paused." });
  if (hold) blockers.push({ code: "review_hold", message: "A review hold is active — sends are held." });
  if (!ownerSandboxAddress()) blockers.push({ code: "owner_address_unset", message: "GHOST_AGENCY_OWNER_EMAIL is not set; sandbox cannot route to you." });
  return {
    ready: blockers.length === 0,
    blockers,
    deliveryPause: { active: pause.active, known: pause.known !== false, reason: pause.reason || "" },
    reviewHold: { active: Boolean(hold) },
    liveSendsEnabled: String(process.env[LIVE_SWITCH] || "").trim() === "true",
    ownerAddressConfigured: Boolean(ownerSandboxAddress()),
  };
}

/** Spend counters, from the batches this instance has run. */
function spendCounters() {
  const batches = runner.listBatches();
  const counters = { batches: batches.length, mirrorsAttempted: 0, mirrorsGated: 0, gateFailures: 0, ready: 0, queued: 0, sent: 0 };
  for (const b of batches) {
    for (const row of b.rows || []) {
      const seen = new Set((row.history || []).map((h) => h.status));
      if (seen.has("mirrored")) counters.mirrorsAttempted += 1;
      if (seen.has("gate_passed")) counters.mirrorsGated += 1;
      if (row.status === "gate_failed") counters.gateFailures += 1;
      if (row.status === "ready") counters.ready += 1;
      if (seen.has("queued")) counters.queued += 1;
      if (row.status === "sent") counters.sent += 1;
    }
  }
  return counters;
}

// ---------------------------------------------------------------------------
// Production adapters. Each one is small and each one refuses rather than
// guesses — NO INVENTED CLIENT FACTS: an absent fact stays absent and the gate
// then fails the row, which is the correct outcome.
// ---------------------------------------------------------------------------

/**
 * gateWithCapture — the render gate, plus the email's pictures taken in the
 * browser it already has open.
 *
 * The capture cannot influence the gate: runRenderGate only invokes it once all
 * eight facts have passed, and its result comes back on `verdict.capture`,
 * which no check reads. A capture that fails, throws or runs out of budget
 * leaves the row exactly as it is today — the send path still knows how to
 * shoot for itself, it just no longer has to.
 */
function gateWithCapture(overrides = {}) {
  const capture = overrides.captureEmailAssets
    || require("../../lib/line-email-assets").captureLineEmailAssets;
  const runGate = overrides.runRenderGate || runRenderGate;
  return async function gate(args = {}) {
    const build = args.build || {};
    const proofIdentitySupplied = Object.prototype.hasOwnProperty.call(build, "proofIdentity");
    return runGate({
      ...args,
      capture: async ({ browser, url }) => capture({
        browser,
        previewUrl: url,
        currentWebsite: build.currentWebsite || "",
        buildHash: build.buildHash || "",
        ...(proofIdentitySupplied ? { proofIdentity: build.proofIdentity } : {}),
      }),
    });
  };
}

function buildDeps(overrides = {}) {
  return {
    env: overrides.env || process.env,
    pick: overrides.pick || require("../../lib/line-adapters").pickProspects,
    qualify: overrides.qualify || (async (row) => {
      // LeadMiner packets were graded at the export gate (strict
      // websiteWorseThan filter). Re-grading here is the double-gate that
      // killed Cox Concrete — the line trusts the packet's gate and moves on.
      if (row.leadminerQualified === true) return { ok: true, reason: "" };
      const verdict = qualifyForBuild(row.qualification || {});
      return { ok: verdict.ok === true, reason: (verdict.reasons || []).join("; ") };
    }),
    mirror: overrides.mirror || require("../../lib/line-adapters").mirrorProspect,
    prepareHero: overrides.prepareHero || require("../../lib/line-adapters").prepareMirroredHero,
    // SEEDANCE AUTOLINE AT THE SEND BOUNDARY — the drain_emails resume block
    // and the legacy startBatch loop both run processRowPhase with these deps,
    // so the gate_passed hero enqueue rides both paths through this default.
    ensureHeroAutoline: overrides.ensureHeroAutoline
      || require("../../lib/line-adapters").ensureGatePassedHeroAutoline,
    sourceFacts: overrides.sourceFacts || require("../../lib/line-adapters").sourceFactsFor,
    gate: overrides.gate || gateWithCapture(overrides),
    // LIGHT verification still shoots the email's proof shots in the gate
    // phase (lib/line-runner.js's light skip) — the drain path and the legacy
    // startBatch path both reach that phase through buildDeps. Same capture
    // the full gate's hook calls, motion extras off, on its own chromium.
    captureEmailAssets: overrides.captureEmailAssets
      || require("../../lib/line-email-assets").captureLineEmailAssets,
    writePreviewUrl: overrides.writePreviewUrl || require("../../lib/line-adapters").writePreviewUrl,
    queueEmail: overrides.queueEmail || require("../../lib/line-adapters").queueEmail,
    onProgress: overrides.onProgress || (() => {}),
  };
}

const SPORT_FENCING_HOLD_REASON = "vertical_mismatch_sport_fencing";
const EXPLICIT_PROSPECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const {
  EXPLICIT_PROSPECT_TARGET,
  createExplicitProspectMarker,
} = linePersistence;

function exactProspectIds(value, count) {
  if (value === undefined) return { ids: null };
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    return { error: "invalid_prospect_ids" };
  }
  const ids = value.map((item) => String(item || "").trim());
  if (new Set(ids).size !== ids.length || ids.some((id) => !EXPLICIT_PROSPECT_ID.test(id))) {
    return { error: "invalid_prospect_ids" };
  }
  if (Number(count) !== ids.length) return { error: "prospect_ids_must_match_count" };
  return { ids };
}

async function quarantineSportFencingProspects(prospectIds, overrides = {}) {
  if (!Array.isArray(prospectIds) || prospectIds.length < 1 || prospectIds.length > 10) {
    throw Object.assign(new Error("invalid_prospect_ids"), { code: "invalid_prospect_ids" });
  }
  const ids = [...new Set(prospectIds.map((value) => String(value || "").trim()))];
  if (ids.length !== prospectIds.length || ids.some((id) => !EXPLICIT_PROSPECT_ID.test(id))) {
    throw Object.assign(new Error("invalid_prospect_ids"), { code: "invalid_prospect_ids" });
  }
  const read = overrides.select || select;
  const update = overrides.conditionalUpdate || conditionalUpdate;
  const now = overrides.now || (() => new Date());
  const results = [];
  const terminalStatuses = new Set([
    "sent", "delivered", "contacted", "replied", "converted", "paid",
    "opted_out", "unsubscribed", "do_not_contact", "bounced", "complained",
    "archived", "archived_legacy", "previewed", "built", "ready",
  ]);
  const eligibleStatuses = new Set(["line_queued", "new", "queued"]);

  for (const prospectId of ids) {
    let loaded;
    try {
      loaded = await read(PROSPECTS, `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`);
    } catch {
      loaded = null;
    }
    const row = loaded && loaded.ok === true && Array.isArray(loaded.data) ? loaded.data[0] : null;
    if (!row) {
      results.push({ prospectId, outcome: "cas-failed", detail: "canonical_read_failed_or_missing" });
      continue;
    }
    const record = row.record && typeof row.record === "object" ? row.record : {};
    const statuses = [row.status, record.status].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
    const reasons = [
      row.blocked_reason,
      row.vertical_hold && row.vertical_hold.reason,
      record.blocked_reason,
      record.vertical_hold && record.vertical_hold.reason,
    ].map((value) => String(value || "").trim().toLowerCase());
    if (statuses.includes("held") && reasons.includes(SPORT_FENCING_HOLD_REASON)) {
      results.push({ prospectId, outcome: "already-held" });
      continue;
    }
    if (statuses.some((status) => terminalStatuses.has(status)) || !statuses.some((status) => eligibleStatuses.has(status))) {
      results.push({ prospectId, outcome: "terminal" });
      continue;
    }

    const at = now().toISOString();
    const guards = {
      ...(String(row.updated_at || "").trim() ? { updated_at: `eq.${String(row.updated_at).trim()}` } : {}),
      ...(String(row.status || "").trim() ? { status: `eq.${String(row.status).trim()}` } : {}),
    };
    let written;
    try {
      written = await update(PROSPECTS, "prospect_id", prospectId, guards, {
        status: "held",
        record: {
          ...record,
          status: "held",
          blocked_reason: SPORT_FENCING_HOLD_REASON,
          vertical_hold: {
            ...(record.vertical_hold && typeof record.vertical_hold === "object" ? record.vertical_hold : {}),
            reason: SPORT_FENCING_HOLD_REASON,
            at,
            source: "admin_explicit_quarantine",
          },
        },
        updated_at: at,
      });
    } catch {
      written = null;
    }
    results.push({
      prospectId,
      outcome: written && written.ok === true && written.updated === true ? "updated" : "cas-failed",
    });
  }

  return {
    ok: true,
    action: "quarantine_sport_fencing",
    reason: SPORT_FENCING_HOLD_REASON,
    results,
    counts: Object.fromEntries(["updated", "already-held", "terminal", "cas-failed"]
      .map((outcome) => [outcome, results.filter((item) => item.outcome === outcome).length])),
  };
}

function createLineHandler(overrides = {}) {
  // Injectable ONLY so a headless proof run can supply a known-clear pause
  // state. Production passes nothing and gets the fail-closed reader above:
  // an unknown delivery-pause state counts as PAUSED, which is why a send in
  // an unconfigured environment is refused rather than attempted.
  const readiness = overrides.readiness || readinessState;
  const durable = overrides.persistence || linePersistence;
  const enqueue = overrides.enqueueLineMessage || enqueueLineMessage;
  const loadContinuation = overrides.loadContinuation || loadHumanContinuation;
  const queueTimeoutMs = publishTimeout(overrides.queuePublishTimeoutMs);
  const directTimeoutMs = directRecoveryTimeout(overrides.directStartRecoveryTimeoutMs);
  const legacyInline = overrides.legacyInline === true || legacyStartHarness(overrides);
  const quarantineSportFencing = overrides.quarantineSportFencingProspects
    || ((prospectIds) => quarantineSportFencingProspects(prospectIds));
  // Durable lease owner for drain_emails row claims. Unique per handler build
  // is enough: it only needs to distinguish THIS drain from other workers.
  const drainWorkerId = `line_drain_${randomUUID()}`;
  // Same for recapture_proofs — distinct id so an operator can tell a repair
  // lease from a drain lease in the durable row's lease_owner.
  const recaptureWorkerId = `line_recapture_${randomUUID()}`;
  // Claim-retry beat for drain_emails (injectable for tests; clamped).
  const drainClaimRetryDelayMs = Number.isFinite(Number(overrides.drainClaimRetryDelayMs))
    ? Math.max(0, Math.min(10_000, Number(overrides.drainClaimRetryDelayMs)))
    : DRAIN_CLAIM_RETRY_DELAY_MS;

  /**
   * drainHaltedSandboxBatch — action:"send" for a HALTED sandbox batch.
   *
   * THE OWNER'S EMAIL-NOW LAW (2026-09-01). A halt is terminal for SOURCING —
   * no new candidates, no compiles, no mining resume — but it must never hold
   * already-finished sites hostage: production stranded a halted batch with 15
   * finished rows and zero emails behind `send_blocked:batch_status_halted`.
   * The drain stamps a send-only approval (actor sandbox_auto_send_drain), then
   * drives the SAME durable send machinery the settled batch uses — one
   * processLineMessage send pass per queued row, each with its row claim,
   * recipient fingerprint, provider idempotency key and receipt checkpoint. It
   * returns null when the drain does not apply (live lane, switch off) so the
   * caller falls through to the historical refusals unchanged.
   */
  async function drainHaltedSandboxBatch(haltedBatch) {
    if (!haltedBatch || haltedBatch.lane !== "sandbox") {
      // A halted LIVE batch has no operator approval and must never gain one
      // from a drain: the typed-approval law is untouched, switch or not.
      return {
        status: 403,
        body: {
          ok: false,
          error: "send_blocked:halted_drain_sandbox_only",
          batch: safeBatch(haltedBatch),
        },
      };
    }
    if (!runner.sendOnFinishEnabled()) return null;
    const queued = lineState.batchCounts(haltedBatch).queued;
    if (queued < 1) {
      return {
        status: 403,
        body: {
          ok: false,
          error: "send_blocked:halted_batch_nothing_queued",
          batch: safeBatch(haltedBatch),
        },
      };
    }
    // SEND-ONLY APPROVAL, one CAS from halted. If any other worker moved the
    // batch first, the drain loses cleanly and the operator can retry.
    const approved = await durable.storeBatch({
      batchId: haltedBatch.batchId,
      expectedVersion: haltedBatch.version,
      expectedStatus: "halted",
      patch: {
        status: "approved",
        approval: {
          actor: HALTED_SEND_DRAIN_ACTOR,
          at: new Date().toISOString(),
          approvedRows: queued,
          typedBatchId: haltedBatch.batchId,
        },
      },
    }).catch((e) => ({ ok: false, error: String((e && e.message) || e).slice(0, 160) }));
    if (!approved.ok) {
      return { status: 409, body: { ok: false, error: approved.error || "halted_drain_approval_conflict" } };
    }
    const continuation = typeof loadContinuation === "function" ? loadContinuation() : loadContinuation;
    const canDrive = continuation && typeof continuation.processLineMessage === "function";
    const drainStartedAt = Date.now();
    let sent = 0;
    let passes = 0;
    let passError = "";
    while (canDrive
      && passes < HALTED_DRAIN_MAX_PASSES
      && Date.now() - drainStartedAt < HALTED_DRAIN_BUDGET_MS) {
      // Re-read before every pass: each pass claims one queued row through the
      // continuation, so only rows still queued are ever sent, and a pass that
      // policy-held re-halted the batch itself (advanceSend) ends the loop.
      const fresh = await durable.loadBatch(haltedBatch.batchId).catch(() => ({ ok: false }));
      if (!fresh.ok) break;
      if (String(fresh.batch.status) === "halted" || lineState.batchCounts(fresh.batch).queued < 1) break;
      passes += 1;
      let pass;
      try {
        pass = await continuation.processLineMessage({
          batchId: haltedBatch.batchId,
          phase: "send",
          sequence: fresh.batch.version,
        }, {
          metadata: { messageId: `halted-drain:${haltedBatch.batchId}:${passes}` },
        });
      } catch (e) {
        passError = String((e && e.message) || e).slice(0, 160);
        break;
      }
      sent += pass && pass.sent === 1 ? 1 : 0;
      if (!pass || pass.ok !== true) {
        if (pass && pass.retryable === true) continue;
        passError = safeQueueFailureReason((pass && (pass.error || pass.reason)) || "halted_drain_pass_refused");
        break;
      }
    }
    // THE HALT STAYS. Whatever the drain achieved, the batch returns to its
    // terminal sourcing state — only the rows record that the emails left.
    let final = await durable.loadBatch(haltedBatch.batchId).catch(() => ({ ok: false }));
    if (final.ok && !["halted"].includes(String(final.batch.status))) {
      const restored = await durable.storeBatch({
        batchId: haltedBatch.batchId,
        expectedVersion: final.batch.version,
        expectedStatus: final.batch.status,
        patch: { status: "halted", haltReason: haltedBatch.haltReason || "halted_after_send_drain" },
      }).catch(() => ({ ok: false }));
      if (restored && restored.ok) {
        final = await durable.loadBatch(haltedBatch.batchId).catch(() => ({ ok: false }));
      }
    }
    const finalBatch = final.ok ? final.batch : haltedBatch;
    return {
      status: 200,
      body: {
        ok: true,
        haltedDrain: true,
        approvedRows: queued,
        sent,
        passes,
        remaining: lineState.batchCounts(finalBatch).queued,
        ...(passError ? { passError } : {}),
        batch: safeBatch(finalBatch),
        spend: spendCounters(),
      },
    };
  }

  /**
   * drainSandboxEmails(batch, { max, canonical }) — action:"drain_emails".
   *
   * THE QUEUE BYPASS. Rows sit at gate_passed (proven-built, proven-gated,
   * live previewUrl) because the resume delivery that should advance them
   * never fires. This drain advances them itself, synchronously, using the
   * exact machinery the runner uses at that resume block:
   *
   *   gate_passed --processRowPhase--> writePreviewUrl -> queueEmail ->
   *     queued --send-on-finish (same createLineSender sandbox factory)--> sent
   *   queued    --createLineSender--> sent (settle rows the finish send missed)
   *
   * Persistence is the same durable machinery too: canonical rows are claimed
   * (claimRows CAS, the DB — not the queue) and checkpointed per transition,
   * so a concurrent worker can never double-send (the sender's provider
   * idempotency key is derived from batch+prospect+step on top of that).
   * Legacy registry batches persist through runner.putBatch snapshots.
   *
   * SANDBOX ONLY — the caller refuses the live lane before this runs, and the
   * sender itself force-routes every recipient to the owner and asserts it.
   * Any per-row failure leaves that row at its last good durable status and
   * is named in perRow; the drain keeps going. Rows already sent are skipped
   * and counted, so repeated calls are idempotent.
   */
  async function drainSandboxEmails(batch, { max, canonical } = {}) {
    const limit = drainEmailsMax(max);
    const startedAt = Date.now();
    const deadlineAt = startedAt + DRAIN_EMAILS_BUDGET_MS;
    const senderFactory = overrides.createLineSender || createLineSender;
    // One sender for the whole pass. createLineSender is stateless per send()
    // (prepare/deliver key their state on the plan object), and reusing it is
    // exactly what the continuation's sendOnFinish wiring does per row.
    const sender = senderFactory({
      lane: "sandbox",
      batchId: batch.batchId,
      deps: overrides.deliveryDeps || {},
    });
    // Phase adapters for the resume block. Legacy-injected harnesses (the
    // operator-line test shape) pass their adapters at the top level, so
    // legacyInline widens the source; canonical callers use the nested
    // drainDeps seam, which wires phase mocks without diverting the route to
    // the legacy registry. Production passes nothing and gets the real
    // adapters — the same set buildDeps gives runner.startBatch.
    const phaseDeps = {
      ...buildDeps({
        ...(legacyInline ? overrides : {}),
        ...(overrides.drainDeps || {}),
      }),
      sendOnFinish: async (row, options = {}) => sender(row, {
        sequence: 1,
        step: 1,
        deadlineAt: Number(options && options.deadlineAt) > 0 ? options.deadlineAt : deadlineAt,
      }),
    };
    // Seed logo claims exactly like the run loop: every row that already
    // claimed its logo keeps it, so a drained row cannot duplicate one.
    const seenLogoShas = new Map();
    for (const claimRow of batch.rows || []) {
      if (!claimRow || !["gate_passed", "ready", "queued", "sent"].includes(String(claimRow.status || ""))) continue;
      const claim = claimRow.gate && Array.isArray(claimRow.gate.checks)
        ? claimRow.gate.checks.find((c) => c.fact === "logo_own_and_unique" && c.pass)
        : null;
      const sha = String((claim && claim.evidence && claim.evidence.sha256) || claimRow.logoSha256 || "").trim().toLowerCase();
      if (/^[a-f0-9]{64}$/.test(sha)) seenLogoShas.set(sha, claimRow.prospectId);
    }

    const perRow = [];
    let sentCount = 0;
    let alreadySent = 0;
    // stale_lease_reclaimed report: rows whose send went through a reclaimed
    // dead holder's lease (see claimRows STALE_LEASE_MS) rather than a plain
    // free-row claim. Named so an operator can tell a contested drain pass
    // from a clean one.
    let staleDrainReclaims = 0;
    const candidates = [];
    for (const row of batch.rows || []) {
      if (!row || typeof row !== "object") continue;
      const status = String(row.status || "");
      if (status === "sent") { alreadySent += 1; continue; }
      if (status === "gate_passed" || status === "queued") candidates.push(row);
    }

    // LEGACY persistence: whole-batch snapshots, exactly how the in-request
    // runner checkpoints. Forward progress only — a refused row keeps its
    // last good status in the registry.
    let working = null;
    const replaceWorkingRow = (from, to) => {
      const index = (working.rows || []).findIndex((candidate) => (
        String(candidate.rowId || "") === String(from.rowId || "") && String(candidate.rowId || "") !== ""
      ) || String(candidate.prospectId || "") === String(from.prospectId || ""));
      if (index >= 0) working.rows[index] = to;
    };

    const runPhases = async (row, persist) => {
      let turns = 0;
      while (String(row.status) === "gate_passed" && turns < DRAIN_EMAILS_ROW_TURNS && Date.now() < deadlineAt) {
        turns += 1;
        const advanced = await runner.processRowPhase(row, {
          lane: "sandbox",
          batchId: batch.batchId,
          seenLogoShas,
          deadlineAt,
        }, phaseDeps);
        if (!advanced || advanced.ok !== true || !advanced.row) {
          return {
            row,
            status: "gate_passed",
            reason: String((advanced && (advanced.error || advanced.code)) || "phase_failed").slice(0, 200),
          };
        }
        const next = advanced.row;
        const nextStatus = String(next.status);
        if (nextStatus !== "queued" && nextStatus !== "sent") {
          // A policy verdict (hero boundary, static-fallback receipt…) is the
          // machinery's honest answer, but the drain must not strand the row
          // in a terminal state the operator did not ask for: record it and
          // leave the durable row at gate_passed.
          return {
            row,
            status: "gate_passed",
            reason: `phase_refused:${nextStatus}:${String(next.reason || advanced.phase || "")}`.slice(0, 200),
          };
        }
        const persisted = await persist(row, next, nextStatus === "sent");
        if (!persisted.ok) {
          return { row, status: String(row.status), reason: `row_checkpoint_conflict:${String(persisted.error || "").slice(0, 120)}` };
        }
        row = persisted.row || next;
      }
      return { row, status: String(row.status), reason: "" };
    };

    for (const candidate of candidates.slice(0, limit)) {
      if (Date.now() >= deadlineAt) {
        perRow.push({
          business: String(candidate.businessName || candidate.prospectId || ""),
          status: String(candidate.status || ""),
          reason: "drain_budget_exhausted",
        });
        continue;
      }
      let outcome;
      if (canonical) {
        outcome = await drainCanonicalRow(candidate);
      } else {
        if (!working) working = { ...batch, rows: (batch.rows || []).slice() };
        outcome = await drainLegacyRow(candidate);
      }
      if (outcome.status === "sent") sentCount += 1;
      perRow.push({
        business: String(candidate.businessName || candidate.prospectId || ""),
        status: outcome.status,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      });
    }

    const finalRead = canonical
      ? await durable.loadBatch(batch.batchId).catch(() => ({ ok: false }))
      : { ok: true, batch: runner.getBatch(batch.batchId) || (working || batch) };
    const finalBatch = finalRead.ok ? finalRead.batch : batch;
    const remaining = (finalBatch.rows || []).filter((row) => ["gate_passed", "queued"].includes(String(row && row.status || ""))).length;
    return {
      ok: true,
      action: "drain_emails",
      batchId: batch.batchId,
      drained: perRow.length,
      sent: sentCount,
      alreadySent,
      staleLeaseReclaimed: staleDrainReclaims,
      perRow,
      remaining,
      batch: safeBatch(finalBatch),
      spend: spendCounters(),
    };

    // Canonical rows: claim (DB CAS, never the queue) → phases → checkpoint
    // per transition. The lease is held until the row reaches sent, then
    // released by the final checkpoint; failure paths release it best-effort.
    async function drainCanonicalRow(candidate) {
      if (!candidate.rowId) {
        return { status: String(candidate.status || ""), reason: "row_identity_missing" };
      }
      const attemptClaim = async (source) => durable.claimRows({
        batchId: batch.batchId,
        rowId: candidate.rowId,
        expectedVersion: Number(source.version) || 0,
        workerId: drainWorkerId,
        limit: 1,
        leaseMs: DRAIN_EMAILS_ROW_LEASE_MS,
        statuses: [String(source.status || "")],
      }).catch((error) => ({ ok: false, error: String((error && error.message) || error).slice(0, 160) }));

      let claim = await attemptClaim(candidate);
      let claimed = claim && claim.ok === true && claim.rows && claim.rows[0];
      if (!claimed && Date.now() < deadlineAt) {
        // CLAIM LOST → ONE RETRY. A lease-blocked row is not dead yet: the
        // holder's lease may be seconds from expiry, or a concurrent claim may
        // have just released it. The durable row is re-read first so a
        // checkpoint between attempts cannot strand the retry on a stale
        // expectedVersion. Dead holders never get this far — claimRows
        // reclaims a stale lease on the FIRST attempt.
        await new Promise((resolve) => setTimeout(resolve, drainClaimRetryDelayMs));
        const fresh = await durable.loadBatch(batch.batchId).catch(() => ({ ok: false }));
        const freshRow = fresh.ok
          ? (fresh.batch.rows || []).find((row) => String(row.rowId || "") === String(candidate.rowId))
          : null;
        claim = await attemptClaim(freshRow || candidate);
        claimed = claim && claim.ok === true && claim.rows && claim.rows[0];
      }
      if (!claimed) {
        return { status: String(candidate.status || ""), reason: `row_claim_failed:${String((claim && claim.error) || "claim_lost").slice(0, 120)}` };
      }
      // Named report: this row's send went through a stale-lease reclaim, not
      // a plain free-row claim. Surfaced on the drain result.
      if (Number(claim.staleLeaseReclaimed) > 0) staleDrainReclaims += 1;
      let row = claimed;
      const release = async (current) => {
        if (typeof durable.releaseRow !== "function") return;
        await durable.releaseRow({
          rowId: claimed.rowId,
          leaseToken: claimed.leaseToken,
          expectedVersion: Number(current && current.version) || Number(claimed.version) || 0,
          ...(current && current.status ? { expectedStatus: String(current.status) } : {}),
        }).catch(() => {});
      };
      const persist = async (from, to, terminal) => {
        const checkpoint = await durable.checkpointRow({
          rowId: claimed.rowId,
          leaseToken: claimed.leaseToken,
          expectedVersion: Number(from.version) || 0,
          expectedStatus: String(from.status || ""),
          row: to,
          releaseLease: terminal === true,
        }).catch((error) => ({ ok: false, error: String((error && error.message) || error).slice(0, 160) }));
        return checkpoint && checkpoint.ok === true
          ? checkpoint
          : { ok: false, error: (checkpoint && checkpoint.error) || "row_checkpoint_failed" };
      };
      try {
        const phased = await runPhases(row, persist);
        if (phased.reason) {
          // OWNER LAW (2026-09-01): the email is never hostage to row
          // bookkeeping. When the ONLY blocker is the durable preview
          // re-write (preview_url_write_conflict) on a row whose site
          // is BUILT (live previewUrl, passing gate), send directly:
          // the Resend idempotency key makes this safe, and the row
          // state catches up on the next pass.
          // The durable row (from claimRows) does not carry the batch row's
          // gateResult field — status gate_passed IS the gate proof (the
          // claim itself required it), and the live previewUrl is the
          // built-site proof. gateResult check removed 2026-09-01 after
          // the first live force-path run never triggered.
          const bookkeepingOnly = String(phased.reason).includes("preview_url_write_conflict")
            && String(row.previewUrl || "").trim();
          if (bookkeepingOnly) {
            const forced = await sender(row, { sequence: 1, step: 1, deadlineAt })
              .catch((error) => ({ ok: false, reason: String((error && error.message) || error).slice(0, 160) }));
            if (forced && forced.ok === true) {
              const delivered = lineState.advanceRow({ ...row, status: "queued" }, "sent");
              if (delivered.ok) await persist(row, delivered.row, true);
              return { status: "sent", reason: "sent_via_force_path" };
            }
            await release(row);
            return { status: "queued", reason: `force_send_refused:${String((forced && forced.reason) || "").slice(0, 120)}` };
          }
          if (String(phased.row.status) !== "sent") await release(phased.row);
          return { status: phased.status, reason: phased.reason };
        }
        row = phased.row;
        if (String(row.status) === "queued") {
          const attempt = await sender(row, { sequence: 1, step: 1, deadlineAt })
            .catch((error) => ({ ok: false, reason: String((error && error.message) || error).slice(0, 160) }));
          if (attempt && attempt.ok === true) {
            const delivered = lineState.advanceRow(row, "sent");
            if (delivered.ok) {
              const persisted = await persist(row, delivered.row, true);
              if (persisted.ok) return { status: "sent" };
              // The email left; only the checkpoint lost. The provider
              // idempotency key protects a retry, so say so honestly.
              return { status: "sent", reason: `sent_checkpoint_conflict:${String(persisted.error || "").slice(0, 120)}` };
            }
            await release(row);
            return { status: "queued", reason: "sent_transition_refused" };
          }
          await release(row);
          return { status: "queued", reason: String((attempt && attempt.reason) || "send_refused").slice(0, 200) };
        }
        if (String(row.status) === "sent") return { status: "sent" };
        return { status: String(row.status), reason: "phase_progress_stalled" };
      } catch (error) {
        await release(row);
        return { status: String(row.status || candidate.status || ""), reason: String((error && error.message) || error).slice(0, 200) };
      }
    }

    async function drainLegacyRow(candidate) {
      try {
        const phased = await runPhases(candidate, async (from, to) => {
          const prior = from;
          replaceWorkingRow(prior, to);
          runner.putBatch({ ...working });
          return { ok: true, row: to };
        });
        if (phased.reason) return { status: phased.status, reason: phased.reason };
        let row = phased.row;
        if (String(row.status) === "queued") {
          const attempt = await sender(row, { sequence: 1, step: 1, deadlineAt })
            .catch((error) => ({ ok: false, reason: String((error && error.message) || error).slice(0, 160) }));
          if (attempt && attempt.ok === true) {
            const delivered = lineState.advanceRow(row, "sent");
            if (delivered.ok) {
              replaceWorkingRow(row, delivered.row);
              runner.putBatch({ ...working });
              return { status: "sent" };
            }
            return { status: "queued", reason: "sent_transition_refused" };
          }
          return { status: "queued", reason: String((attempt && attempt.reason) || "send_refused").slice(0, 200) };
        }
        if (String(row.status) === "sent") return { status: "sent" };
        return { status: String(row.status), reason: "phase_progress_stalled" };
      } catch (error) {
        return { status: String(candidate.status || ""), reason: String((error && error.message) || error).slice(0, 200) };
      }
    }
  }

  /**
   * recaptureRowProofs(batch, { max, canonical }) — action:"recapture_proofs".
   *
   * THE EVIDENCE-ONLY REPAIR. Rows built before the render gate's capture
   * fixes (#583/#584) carry no complete proof_shots record, so every send dies
   * at the email's visual gate ("no_before_after_visuals"). This action
   * re-runs ONLY the capture — the exact machinery the gate's hook calls
   * (captureLineEmailAssets → ensureLineProofShots, motion extras off, on its
   * own chromium from lib/serverless-chromium, the same lane the light
   * verification law uses) — and writes the completed record back to the row
   * (checkpointed under a durable row lease, exactly like drain_emails) and
   * the prospect record (the same upsert defaultSend persists through). The
   * row STAYS at gate_passed/queued; the normal queue/drain then sends against
   * evidence that now passes the visual gate.
   *
   * Guardrails, per row:
   *   · previewUrl must be a LIVE https wss-ai.com URL — the host guard
   *     (lib/preview-host-guard) AND a liveness probe (lib/preview-liveness),
   *     because a 404 host would only burn a browser producing nothing,
   *   · the identity gates: deliveryProofIdentity over the SAME sources
   *     defaultSend consults — a malformed/scrubbed/conflicting shared tuple
   *     refuses the row with that named reason (#590-#594),
   *   · a before-capture that refuses on identity twice (current_website
   *     present) marks the row refused with the named reason instead of
   *     looping — it is a fact about their domain, not a flake,
   *   · rows whose stored evidence is ALREADY current are skipped (idempotent
   *     re-runs cost a prospect read, not a browser),
   *   · quarantined (sport-fencing hold) prospects are refused like defaultSend,
   *   · capped at RECAPTURE_PROOFS_MAX_ROWS rows per call and one shared
   *     wall-clock budget, so chromium's single browser permit is never held
   *     across an unreasonable share of the route's 800s.
   */
  async function recaptureRowProofs(batch, { max, canonical } = {}) {
    const limit = recaptureProofsMax(max);
    const startedAt = Date.now();
    const deadlineAt = startedAt + RECAPTURE_PROOFS_BUDGET_MS;
    const captureAssets = overrides.captureEmailAssets || captureLineEmailAssets;
    const identityOf = overrides.deliveryProofIdentity || deliveryProofIdentity;
    const liveProbe = overrides.checkPreviewLive || checkPreviewLive;
    const readProspects = overrides.select || select;
    const writeProspect = overrides.upsertRow || upsertRow;

    const perRow = [];
    let repaired = 0;
    let alreadyCurrent = 0;
    // LEGACY persistence: whole-batch snapshots, exactly how the in-request
    // runner checkpoints (same shape as the drain's legacy path).
    let working = null;
    const replaceWorkingRow = (from, to) => {
      const index = (working.rows || []).findIndex((candidate) => (
        String(candidate.rowId || "") === String(from.rowId || "") && String(candidate.rowId || "") !== ""
      ) || String(candidate.prospectId || "") === String(from.prospectId || ""));
      if (index >= 0) working.rows[index] = to;
    };

    const candidates = (batch.rows || []).filter((row) => (
      row && ["gate_passed", "queued"].includes(String(row.status || ""))
    ));

    // THE CAP COUNTS BROWSER WORK, NOT SCAN WORK. already-current skips and
    // pre-browser refusals are free: if they consumed repair slots, a partially
    // repaired batch (or one with a permanently refused row up front) would
    // re-report the same leading rows on every call and never reach the rows
    // behind them. The scan itself is bounded so the per-row prospect reads
    // stay a rounding error.
    const browserCosts = new Set(["repaired", "incomplete", "before_refused", "before_refused_retryable"]);
    let workDone = 0;
    for (const candidate of candidates.slice(0, RECAPTURE_PROOFS_SCAN_LIMIT)) {
      if (workDone >= limit) break;
      if (Date.now() >= deadlineAt) {
        perRow.push({
          business: String(candidate.businessName || candidate.prospectId || ""),
          outcome: "incomplete",
          reason: "recapture_budget_exhausted",
        });
        continue;
      }
      const outcome = canonical
        ? await recaptureCanonicalRow(candidate)
        : await recaptureLegacyRow(candidate);
      if (browserCosts.has(outcome.outcome)) workDone += 1;
      if (outcome.outcome === "repaired") repaired += 1;
      if (outcome.outcome === "already_current") alreadyCurrent += 1;
      perRow.push({
        business: String(candidate.businessName || candidate.prospectId || ""),
        outcome: outcome.outcome,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      });
    }

    const finalRead = canonical
      ? await durable.loadBatch(batch.batchId).catch(() => ({ ok: false }))
      : { ok: true, batch: runner.getBatch(batch.batchId) || (working || batch) };
    const finalBatch = finalRead.ok ? finalRead.batch : batch;
    const remaining = (finalBatch.rows || []).filter((row) => (
      ["gate_passed", "queued"].includes(String(row && row.status || ""))
    )).length;
    return {
      ok: true,
      action: "recapture_proofs",
      batchId: batch.batchId,
      recaptured: perRow.length,
      repaired,
      alreadyCurrent,
      perRow,
      remaining,
      sendsAttempted: 0,
      batch: safeBatch(finalBatch),
      spend: spendCounters(),
    };

    // Shared pre-flight: everything the capture needs, refused by name BEFORE
    // any browser exists. Read-only — refusals here never claim a row.
    async function preflight(candidate) {
      const loaded = await readProspects(
        PROSPECTS,
        `?select=*&prospect_id=eq.${encodeURIComponent(candidate.prospectId)}&limit=1`,
      ).catch(() => null);
      const durableProspect = loaded && loaded.ok === true && Array.isArray(loaded.data) && loaded.data[0]
        ? loaded.data[0]
        : {};
      const record = durableProspect.record && typeof durableProspect.record === "object"
        ? durableProspect.record
        : {};
      // The sport-fencing hold is a policy hold on the PROSPECT; evidence
      // repair on a quarantined business is work nobody asked for.
      const holdStatuses = [durableProspect.status, record.status]
        .map((value) => String(value || "").trim().toLowerCase());
      const holdReasons = [
        durableProspect.blocked_reason,
        durableProspect.vertical_hold && durableProspect.vertical_hold.reason,
        record.blocked_reason,
        record.vertical_hold && record.vertical_hold.reason,
      ].map((value) => String(value || "").trim().toLowerCase());
      if (holdStatuses.includes("held") && holdReasons.includes(SPORT_FENCING_HOLD_REASON)) {
        return { refused: "vertical_mismatch_sport_fencing", prospect: durableProspect, record };
      }
      const previewUrl = String(candidate.previewUrl || "").trim();
      if (!previewUrl) return { refused: "no_preview_url", prospect: durableProspect, record };
      // NOT JUST OURS — LIVE. The host guard answers "is it ours"; the probe
      // answers "does it serve right now". Either no is a refusal, because a
      // dead mirror can only produce capture_failed and a burned browser.
      if (!isApprovedPreviewUrl(previewUrl)) {
        return { refused: "preview_host_not_approved", prospect: durableProspect, record };
      }
      const live = await liveProbe({ url: previewUrl }).catch((e) => ({
        ok: false,
        reason: `liveness_probe_threw:${String((e && e.message) || e).slice(0, 80)}`,
      }));
      if (!live || live.ok !== true) {
        return { refused: `preview_not_live:${String((live && live.reason) || "unavailable").slice(0, 120)}`, prospect: durableProspect, record };
      }
      const currentWebsite = String(durableProspect.current_website || record.current_website || "").trim();
      const evidenceBuildHash = String(
        (record.build_dispatch && record.build_dispatch.build_hash) || candidate.buildHash || "",
      ).trim();
      // THE SAME IDENTITY GATES THE SEND PATH APPLIES. A row whose tuple is
      // scrubbed, partial, or conflicting refuses HERE with the send path's
      // own reason instead of "repairing" evidence no sender may ever use.
      const identity = identityOf({
        sources: [
          record.proof_shots,
          candidate.proofIdentity,
          candidate.proof_shots,
          candidate.captured && candidate.captured.shots,
        ],
        buildHash: evidenceBuildHash,
      });
      if (!identity.ok) return { refused: identity.reason, prospect: durableProspect, record };
      const sharedIdentity = identity.active ? identity.proofIdentity : null;
      const effectiveBuildHash = identity.active ? identity.proofIdentity.build_hash : evidenceBuildHash;
      // IDEMPOTENCE. Evidence that already satisfies assetsAreCurrent — on the
      // row or on the record — needs no browser, so a re-run of this action
      // over a repaired batch is a no-op by construction.
      const fromRow = candidate.proof_shots
        || (candidate.captured && candidate.captured.shots)
        || null;
      const rowVerdict = assetsAreCurrent({
        shots: fromRow,
        buildHash: effectiveBuildHash,
        currentWebsite,
        proofIdentity: sharedIdentity,
      });
      const recordVerdict = assetsAreCurrent({
        shots: record.proof_shots || null,
        buildHash: effectiveBuildHash,
        currentWebsite,
        proofIdentity: sharedIdentity,
      });
      if (rowVerdict.ok || recordVerdict.ok) {
        return { alreadyCurrent: true, prospect: durableProspect, record };
      }
      const prior = candidate.proofRecapture && typeof candidate.proofRecapture === "object"
        ? candidate.proofRecapture
        : {};
      if (prior.refused === true) {
        return { refused: String(prior.reason || "before_capture_refused_twice"), prospect: durableProspect, record };
      }
      return {
        prospect: durableProspect,
        record,
        currentWebsite,
        previewUrl,
        effectiveBuildHash,
        sharedIdentity,
        priorAttempts: Number(prior.attempts) || 0,
      };
    }

    // The capture itself. Returns the canonical record only when
    // automaticProofShotRecord accepts the capture — the SAME completeness
    // contract the render gate's hook writes under (both URLs, both pixel
    // digests, no identity refusal), so a repaired row is indistinguishable
    // from one the gate photographed itself.
    async function captureFor({ currentWebsite, previewUrl, effectiveBuildHash, sharedIdentity }) {
      const captureBudgetMs = Math.max(1_000, Math.min(CAPTURE_BUDGET_MS, deadlineAt - Date.now()));
      let capture;
      try {
        capture = await captureAssets({
          previewUrl,
          currentWebsite,
          buildHash: effectiveBuildHash,
          ...(sharedIdentity ? { proofIdentity: sharedIdentity } : {}),
          budgetMs: captureBudgetMs,
          // THE EXTRAS STAY OFF — the motion loop is a luxury of the build
          // path; the visual gate needs only the still pair.
          motion: false,
        });
      } catch (e) {
        capture = {
          ok: false,
          reason: `capture_threw: ${String((e && e.message) || e).slice(0, 160)}`,
          shots: {},
          results: [],
        };
      }
      const shots = capture && capture.shots && typeof capture.shots === "object"
        ? capture.shots
        : {};
      const beforeRefusal = /^capture_identity_/.test(String(shots.before_refused || ""))
        ? String(shots.before_refused)
        : "";
      const record = automaticProofShotRecord(capture, { currentWebsite });
      return { capture, record, beforeRefusal };
    }

    // Identity stamping mirrors captureLineEmailAssets's own write (it already
    // stamps; this only fills a seam an injected capture left blank), so the
    // written record always names the build its pictures are OF — the field
    // assetsAreCurrent requires before the send path may reuse them.
    function stampRecordIdentity(record, { sharedIdentity, effectiveBuildHash }) {
      const stamped = { ...record };
      if (sharedIdentity) {
        for (const field of ["site_id", "release_id", "build_hash"]) {
          if (!String(stamped[field] || "").trim()) stamped[field] = sharedIdentity[field];
        }
      } else if (effectiveBuildHash && !String(stamped.build_hash || "").trim()) {
        stamped.build_hash = effectiveBuildHash;
      }
      return stamped;
    }

    async function recaptureCanonicalRow(candidate) {
      if (!candidate.rowId) return { outcome: "refused", reason: "row_identity_missing" };
      const pre = await preflight(candidate);
      if (pre.refused) return { outcome: "refused", reason: pre.refused };
      if (pre.alreadyCurrent) return { outcome: "already_current", reason: "" };
      const claim = await durable.claimRows({
        batchId: batch.batchId,
        rowId: candidate.rowId,
        expectedVersion: Number(candidate.version) || 0,
        workerId: recaptureWorkerId,
        limit: 1,
        leaseMs: RECAPTURE_PROOFS_ROW_LEASE_MS,
        statuses: [String(candidate.status || "")],
      }).catch((error) => ({ ok: false, error: String((error && error.message) || error).slice(0, 160) }));
      const claimed = claim && claim.ok === true && claim.rows && claim.rows[0];
      if (!claimed) {
        return { outcome: "refused", reason: `row_claim_failed:${String((claim && claim.error) || "claim_lost").slice(0, 120)}` };
      }
      const claimedPrior = claimed.proofRecapture && typeof claimed.proofRecapture === "object"
        ? claimed.proofRecapture
        : pre.priorAttempts ? { attempts: pre.priorAttempts } : {};
      const attempts = (Number(claimedPrior.attempts) || 0) + 1;
      // PRIOR FIRST, NEW COUNT SECOND: the claimed marker's stale attempt
      // count must never overwrite the one this pass just incremented.
      const marker = (extra) => ({
        ...claimedPrior,
        attempts,
        at: new Date().toISOString(),
        ...extra,
      });
      const checkpoint = async (nextRow, releaseLease) => {
        const written = await durable.checkpointRow({
          rowId: claimed.rowId,
          leaseToken: claimed.leaseToken,
          expectedVersion: Number(claimed.version) || 0,
          expectedStatus: String(claimed.status || ""),
          row: nextRow,
          // The row is LEFT at gate_passed/queued — not terminal — but the
          // lease is released in the same CAS so the normal queue/drain (or a
          // later repair pass) can take it immediately.
          releaseLease,
        }).catch((error) => ({ ok: false, error: String((error && error.message) || error).slice(0, 160) }));
        return written && written.ok === true
          ? written
          : { ok: false, error: (written && written.error) || "row_checkpoint_failed" };
      };
      const release = async () => {
        if (typeof durable.releaseRow !== "function") return;
        await durable.releaseRow({
          rowId: claimed.rowId,
          leaseToken: claimed.leaseToken,
          expectedVersion: Number(claimed.version) || 0,
        }).catch(() => {});
      };
      try {
        const { capture, record, beforeRefusal } = await captureFor(pre);
        if (record) {
          const stamped = stampRecordIdentity(record, pre);
          const nextRow = {
            ...claimed,
            proof_shots: stamped,
            proofRecapture: marker({ repaired: true, reason: "" }),
          };
          const persisted = await checkpoint(nextRow, true);
          if (!persisted.ok) {
            await release();
            return { outcome: "incomplete", reason: `row_checkpoint_conflict:${String(persisted.error).slice(0, 120)}` };
          }
          // THE PROSPECT RECORD. The same write defaultSend persists proof
          // through, so both readers — this row's send and any direct compose
          // — find the completed pair. Best-effort: the row-level record alone
          // already satisfies the send path (it writes through on send).
          const wrote = await writeProspect(PROSPECTS, {
            prospect_id: candidate.prospectId,
            record: { ...pre.record, proof_shots: stamped },
            updated_at: new Date().toISOString(),
          }, "prospect_id").catch(() => ({ ok: false }));
          return {
            outcome: "repaired",
            reason: wrote && wrote.ok === true ? "" : "record_write_failed",
          };
        }
        // NO COMPLETE RECORD. Name exactly what is missing, and apply the
        // double-refusal law to the ONE refusal that is a domain fact: a
        // "before" that landed off the prospect's own registrable domain.
        // The per-variant capture results ride on the marker: the row used to
        // record only the bare family label ("capture_incomplete:no_after_shot")
        // while the named guard that actually fired sat in capture.results and
        // was thrown away — every retry re-reported an undiagnosable reason.
        const refusalReason = beforeRefusal
          ? `before:${beforeRefusal}`
          : `capture_incomplete:${String((capture && capture.reason) || "no_record").slice(0, 160)}`;
        const captureResults = summarizeCaptureResults(capture);
        const doubleRefused = Boolean(beforeRefusal)
          && attempts >= RECAPTURE_PROOFS_BEFORE_ATTEMPT_LIMIT;
        const nextRow = {
          ...claimed,
          proofRecapture: marker({
            ...(doubleRefused ? { refused: true } : {}),
            reason: refusalReason,
            ...(captureResults.length ? { capture_results: captureResults } : {}),
          }),
        };
        const persisted = await checkpoint(nextRow, true);
        if (!persisted.ok) await release();
        return {
          outcome: beforeRefusal
            ? (doubleRefused ? "before_refused" : "before_refused_retryable")
            : "incomplete",
          reason: refusalReason,
        };
      } catch (error) {
        await release();
        return { outcome: "incomplete", reason: String((error && error.message) || error).slice(0, 200) };
      }
    }

    async function recaptureLegacyRow(candidate) {
      try {
        const pre = await preflight(candidate);
        if (pre.refused) return { outcome: "refused", reason: pre.refused };
        if (pre.alreadyCurrent) return { outcome: "already_current", reason: "" };
        const { capture, record, beforeRefusal } = await captureFor(pre);
        const attempts = (Number(pre.priorAttempts) || 0) + 1;
        const marker = (extra) => ({
          at: new Date().toISOString(),
          attempts,
          ...extra,
        });
        const persist = (to) => {
          if (!working) working = { ...batch, rows: (batch.rows || []).slice() };
          replaceWorkingRow(candidate, to);
          runner.putBatch({ ...working });
        };
        if (record) {
          const stamped = stampRecordIdentity(record, pre);
          persist({ ...candidate, proof_shots: stamped, proofRecapture: marker({ repaired: true, reason: "" }) });
          const wrote = await writeProspect(PROSPECTS, {
            prospect_id: candidate.prospectId,
            record: { ...pre.record, proof_shots: stamped },
            updated_at: new Date().toISOString(),
          }, "prospect_id").catch(() => ({ ok: false }));
          return { outcome: "repaired", reason: wrote && wrote.ok === true ? "" : "record_write_failed" };
        }
        const refusalReason = beforeRefusal
          ? `before:${beforeRefusal}`
          : `capture_incomplete:${String((capture && capture.reason) || "no_record").slice(0, 160)}`;
        const captureResults = summarizeCaptureResults(capture);
        const doubleRefused = Boolean(beforeRefusal)
          && attempts >= RECAPTURE_PROOFS_BEFORE_ATTEMPT_LIMIT;
        persist({
          ...candidate,
          proofRecapture: marker({
            ...(doubleRefused ? { refused: true } : {}),
            reason: refusalReason,
            ...(captureResults.length ? { capture_results: captureResults } : {}),
          }),
        });
        return {
          outcome: beforeRefusal
            ? (doubleRefused ? "before_refused" : "before_refused_retryable")
            : "incomplete",
          reason: refusalReason,
        };
      } catch (error) {
        return { outcome: "incomplete", reason: String((error && error.message) || error).slice(0, 200) };
      }
    }
  }

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["GET", "POST"])) return;
    if (!requireAdmin(req, res)) return;
    try {
      if (req.method === "GET") {
        const url = new URL(req.url || "/", "http://localhost");
        const batchId = url.searchParams.get("batchId");
        // Status polling must be read-only. Durable queue delivery is the
        // normal execution path; the signed recovery cron owns stale-row
        // sweeping so opening the dashboard cannot wake or mutate a batch.
        const state = await readiness();
        if (batchId) {
          const canonical = await durable.loadBatch(batchId).catch(() => ({ ok: false, error: "read_failed" }));
          if (canonicalReadFailed(canonical)) {
            sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
            return;
          }
          const batch = canonical.ok
            ? canonical.batch
            : runner.getBatch(batchId) || await runner.recoverBatch(batchId);
          if (!batch) { sendJson(res, 404, { ok: false, error: "unknown_batch", batchId }); return; }
          sendJson(res, 200, { ok: true, serverTime: new Date().toISOString(), readiness: state, spend: spendCounters(), facts: FACTS, launchSizes: LAUNCH_SIZES, capacity: capacityState(), batch: safeBatch(batch) });
          return;
        }
        const canonicalList = await durable.listBatches({ limit: 10 }).catch(() => ({ ok: false, error: "read_failed", batches: [] }));
        if (!canonicalList.ok && canonicalReadFailed(canonicalList)) {
          sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          return;
        }
        const legacy = await runner.listBatchesDurable();
        const combined = [];
        const seen = new Set();
        for (const batch of [...(canonicalList.ok ? canonicalList.batches : []), ...legacy]) {
          if (!batch || !batch.batchId || seen.has(batch.batchId)) continue;
          seen.add(batch.batchId);
          combined.push(batch);
          if (combined.length >= 10) break;
        }
        sendJson(res, 200, {
          ok: true,
          readiness: state,
          spend: spendCounters(),
          facts: FACTS,
          launchSizes: LAUNCH_SIZES,
          capacity: capacityState(),
          serverTime: new Date().toISOString(),
          // Durable list: the owner watched his sites "disappear" when a cold
          // lambda started with an empty in-memory registry. The event log has
          // every snapshot; read it.
          batches: combined.map(safeBatch),
        });
        return;
      }

      const body = await readJson(req).catch(() => ({}));
      const action = String(body.action || "").trim();

      if (action === "quarantine_sport_fencing") {
        if (Object.prototype.hasOwnProperty.call(body, "reason") || Object.prototype.hasOwnProperty.call(body, "status")) {
          sendJson(res, 400, { ok: false, error: "quarantine_policy_is_fixed" });
          return;
        }
        let result;
        try {
          result = await quarantineSportFencing(body.prospectIds);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.code || "invalid_prospect_ids") });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (action === "start") {
        const state = await readiness();
        const requestedLane = body.lane === "live" ? "live" : "sandbox";
        let lane = requestedLane;
        const continueId = String(body.batchId || "").trim();
        let continuedRead = null;
        let legacyContinuation = null;
        if (continueId) {
          continuedRead = !legacyInline
            ? await durable.loadBatch(continueId).catch(() => ({ ok: false, error: "read_failed" }))
            : { ok: false };
          if (!legacyInline && canonicalReadFailed(continuedRead)) {
            sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
            return;
          }
          if (!continuedRead.ok) legacyContinuation = await exactLegacyBatch(continueId);
          if (!legacyInline && persistenceUnconfigured(continuedRead) && !legacyContinuation) {
            sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
            return;
          }
          const existing = continuedRead.ok
            ? continuedRead.batch
            : legacyContinuation;
          if (existing && (existing.status === "building" || existing.status === "running")) {
            lane = existing.lane === "live" ? "live" : "sandbox";
          }
        }
        if (lane === "live" && !state.liveSendsEnabled) {
          sendJson(res, 400, {
            ok: false,
            error: "live_lane_disabled",
            message: `Live prospect sends are switched off server-side (${LIVE_SWITCH}). Run the sandbox lane — every email routes to you.`,
          });
          return;
        }

        // PHANTOM-START GATE. A fresh start must name a target the sourcing
        // machinery can actually serve; a resume (continueId set) re-POSTs an
        // existing batch and never takes a target, so it is exempt. Refusal is
        // loud and names the rejected target — never a minted batch that can
        // only halt or silently source nothing.
        const targetVerdict = recognizedStartTarget(body.target);
        const mintTarget = targetVerdict.ok ? targetVerdict.target : String(body.target || "");
        if (!continueId && !targetVerdict.ok) {
          sendJson(res, 400, {
            ok: false,
            error: `target_unrecognized:${targetVerdict.target}`,
            message: `No source mode can serve target "${targetVerdict.target}". Nothing ran — no batch was minted.`,
            recognized: RECOGNIZED_START_TARGETS,
          });
          return;
        }

        if (!legacyInline && !legacyContinuation) {
          if (continueId) {
            const existing = continuedRead || await durable.loadBatch(continueId).catch(() => ({ ok: false, error: "read_failed" }));
            if (canonicalReadFailed(existing)) { sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" }); return; }
            if (!existing.ok) { sendJson(res, 404, { ok: false, error: "unknown_batch" }); return; }
            // Same mint-or-refuse invariant: a resume 202 always names a batch.
            if (!existing.batch || !String(existing.batch.batchId || "").trim()) {
              sendJson(res, 503, {
                ok: false,
                error: "start_mint_incomplete",
                message: "The batch read did not return a batch id. Nothing was published.",
              });
              return;
            }
            if (!["building", "running"].includes(existing.batch.status)) {
              sendJson(res, 409, { ok: false, error: `batch_not_building:${existing.batch.status}`, batch: safeBatch(existing.batch) });
              return;
            }
            const message = {
              batchId: existing.batch.batchId,
              phase: "run",
              sequence: existing.batch.version,
            };
            await recordAcceptedRun(durable, existing.batch, message);
            const publication = await publishLineMessage(enqueue, message, queueTimeoutMs);
            if (publication.accepted !== true) {
              const direct = await directStartRecovery(loadContinuation, message, directTimeoutMs);
              const refreshed = await durable.loadBatch(existing.batch.batchId).catch(() => ({ ok: false }));
              const recovered = refreshed.ok ? refreshed.batch : existing.batch;
              if (direct.ok === true || direct.skipped === "worker_active") {
                sendJson(res, 202, {
                  ok: true,
                  accepted: true,
                  building: ["building", "running"].includes(recovered.status),
                  queueAccepted: false,
                  recovery: "direct",
                  queueReason: publication.reason,
                  readiness: state,
                  spend: spendCounters(),
                  batch: safeBatch(recovered),
                });
                return;
              }
              sendJson(res, 202, {
                ok: true,
                accepted: true,
                building: true,
                queueAccepted: false,
                recovery: "cron",
                retryable: false,
                queueReason: publication.reason,
                readiness: state,
                batch: safeBatch(existing.batch),
              });
              return;
            }
            sendJson(res, 202, {
              ok: true,
              accepted: true,
              building: true,
              queueAccepted: true,
              recovery: "queue",
              readiness: state,
              spend: spendCounters(),
              batch: safeBatch(existing.batch),
            });
            return;
          }
          const count = runner.clampCount(body.count);
          if (!count) {
            sendJson(res, 400, { ok: false, error: "count_required", message: "Choose a positive run size up to 500. Nothing ran." });
            return;
          }
          const exact = exactProspectIds(body.prospectIds, count);
          if (exact.error) {
            sendJson(res, 400, { ok: false, error: exact.error, message: "Explicit prospect IDs must be 1-10 unique IDs and exactly match count. Nothing ran." });
            return;
          }
          const idempotency = validatedClientIdempotencyKey(body.idempotencyKey);
          if (!idempotency.ok) {
            sendJson(res, 400, { ok: false, error: idempotency.error });
            return;
          }
          // LINE DEEP BATCH DEPTH: resolve the campaign's wave request before
          // anything is minted; an invalid request refuses the start loudly.
          const deepDepth = requestedStartDeepBatchDepth(body);
          if (!deepDepth.ok) {
            sendJson(res, 400, {
              ok: false,
              error: "deep_batch_depth_invalid",
              message: `deepBatchDepth must be a positive integer (max 100); got "${deepDepth.value}". Nothing ran.`,
            });
            return;
          }
          const created = await durable.createBatch(lineState.newBatch({
            batchId: newCanonicalBatchId(idempotency.key),
            lane,
            target: exact.ids ? EXPLICIT_PROSPECT_TARGET : mintTarget,
            requested: count,
            status: "building",
            pickState: "pending",
            mineFunnel: exact.ids
              ? [createExplicitProspectMarker(exact.ids)]
              : [{
                  stage: "quota_contract_finished_sites_v1",
                  entered: count,
                  survived: 0,
                  rejected: {},
                  ...(deepDepth.depth ? { deep_batch_depth: deepDepth.depth } : {}),
                }],
            now: new Date().toISOString(),
          }));
          if (!created.ok) {
            if (created.conflict === true || created.error === "batch_identity_conflict") {
              sendJson(res, 409, { ok: false, error: "idempotency_conflict" });
            } else {
              sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
            }
            return;
          }
          const loaded = await durable.loadBatch(created.batch.batchId).catch(() => ({ ok: false }));
          const batch = loaded.ok ? loaded.batch : created.batch;
          // MINT-OR-REFUSE INVARIANT: an accepted start ALWAYS carries a real
          // batch id. If the durable mint ever answers ok without one, refuse
          // loudly instead of publishing a 202 the console can only poll
          // forever (the phantom-start shape: ok:true with null fields).
          if (!batch || !String(batch.batchId || "").trim()) {
            sendJson(res, 503, {
              ok: false,
              error: "start_mint_incomplete",
              message: "The durable mint did not return a batch id. Nothing was published.",
            });
            return;
          }
          const alreadySettled = !["building", "running"].includes(batch.status);
          if (created.idempotent === true && alreadySettled) {
            sendJson(res, 200, {
              ok: true,
              accepted: true,
              idempotent: true,
              building: false,
              queueAccepted: false,
              recovery: "settled",
              readiness: state,
              spend: spendCounters(),
              batch: safeBatch(batch),
            });
            return;
          }
          const message = {
            batchId: batch.batchId,
            phase: "run",
            sequence: batch.version || 0,
          };
          await recordAcceptedRun(durable, batch, message);
          const publication = await publishLineMessage(enqueue, message, queueTimeoutMs);
          if (publication.accepted !== true) {
            const direct = await directStartRecovery(loadContinuation, message, directTimeoutMs);
            const refreshed = await durable.loadBatch(batch.batchId).catch(() => ({ ok: false }));
            const recovered = refreshed.ok ? refreshed.batch : batch;
            if (direct.ok === true || direct.skipped === "worker_active") {
              sendJson(res, 202, {
                ok: true,
                accepted: true,
                idempotent: created.idempotent === true,
                building: ["building", "running"].includes(recovered.status),
                queueAccepted: false,
                recovery: "direct",
                queueReason: publication.reason,
                readiness: state,
                spend: spendCounters(),
                batch: safeBatch(recovered),
              });
              return;
            }
            sendJson(res, 202, {
              ok: true,
              accepted: true,
              idempotent: created.idempotent === true,
              building: true,
              queueAccepted: false,
              recovery: "cron",
              retryable: false,
              queueReason: publication.reason,
              readiness: state,
              batch: safeBatch(batch),
            });
            return;
          }
          sendJson(res, 202, {
            ok: true,
            accepted: true,
            idempotent: created.idempotent === true,
            building: true,
            queueAccepted: true,
            recovery: "queue",
            readiness: state,
            spend: spendCounters(),
            batch: safeBatch(batch),
          });
          return;
        }

        // Legacy injected harnesses and exact legacy-registry batch ids only.
        // A generic persistence outage can never enter this mutation path.
        let result = await runner.startBatch(
          { count: body.count, target: mintTarget, lane, batchId: body.batchId },
          { ...buildDeps(overrides), budgetMs: BUILD_BUDGET_MS, startedAt: Date.now() },
        );

        const settledLane = result.batch && result.batch.lane === "live" ? "live" : "sandbox";
        if (result.ok && !result.building
          && settledLane === "sandbox" && sandboxAutoSendEnabled() && state.ready
          && result.batch && result.batch.status === "awaiting_approval"
          && lineState.batchCounts(result.batch).queued > 0) {
          result = await autoApproveAndSendSandbox(result.batch, overrides);
        }

        // MINT-OR-REFUSE INVARIANT, legacy lane: every ok:true answer carries
        // the batch it minted/continued. A bare ok:true (null batch fields)
        // is the phantom-accept shape and is refused loudly here.
        if (result && result.ok === true
          && !(result.batch && String(result.batch.batchId || result.batchId || "").trim())) {
          sendJson(res, 500, {
            ok: false,
            error: "start_result_missing_batch",
            message: "The runner accepted the start without returning a batch. Nothing can be polled; refusing instead of reporting success.",
          });
          return;
        }

        sendJson(res, result.ok ? 200 : 400, {
          ...result,
          readiness: state,
          spend: spendCounters(),
          batch: result.batch ? safeBatch(result.batch) : null,
        });
        return;
      }

      if (action === "halt") {
        const batchId = String(body.batchId || "").trim();
        const haltReason = String(body.haltReason || "owner_operator_halt").trim();
        if (!batchId) {
          sendJson(res, 400, { ok: false, error: "batch_id_required" });
          return;
        }
        if (!HALT_REASON.test(haltReason)
          || Object.prototype.hasOwnProperty.call(body, "status")
          || Object.prototype.hasOwnProperty.call(body, "haltedBy")) {
          sendJson(res, 400, { ok: false, error: "halt_policy_invalid" });
          return;
        }
        if (typeof durable.haltBatch !== "function") {
          sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          return;
        }
        const current = await durable.loadBatch(batchId).catch(() => ({ ok: false, error: "read_failed" }));
        if (!current.ok) {
          sendJson(res, canonicalReadFailed(current) ? 503 : 404, {
            ok: false,
            error: canonicalReadFailed(current) ? "line_persistence_unavailable" : "unknown_batch",
          });
          return;
        }
        const halted = await durable.haltBatch({
          batchId,
          expectedVersion: current.batch.version,
          expectedStatus: current.batch.status,
          reason: haltReason,
        }).catch(() => ({ ok: false, error: "batch_halt_failed" }));
        if (!halted.ok) {
          const fresh = await durable.loadBatch(batchId).catch(() => ({ ok: false }));
          if (fresh.ok && fresh.batch.status === "halted") {
            sendJson(res, 200, { ok: true, action: "halt", idempotent: true, batch: safeBatch(fresh.batch) });
            return;
          }
          sendJson(res, halted.conflict ? 409 : 503, {
            ok: false,
            error: halted.conflict ? "batch_halt_conflict" : "line_persistence_unavailable",
            batch: fresh.ok ? safeBatch(fresh.batch) : safeBatch(current.batch),
          });
          return;
        }
        const fresh = await durable.loadBatch(batchId).catch(() => ({ ok: false }));
        sendJson(res, 200, {
          ok: true,
          action: "halt",
          idempotent: halted.idempotent === true,
          automaticRecovery: false,
          actionableWork: 0,
          batch: safeBatch(fresh.ok ? fresh.batch : halted.batch),
        });
        return;
      }

      if (action === "approve") {
        const canonical = legacyInline
          ? { ok: false, error: "batch_not_found" }
          : await durable.loadBatch(body.batchId).catch(() => ({ ok: false, error: "read_failed" }));
        if (canonical.ok) {
          const batch = canonical.batch;
          const counts = lineState.batchCounts(batch);
          const approved = await durable.approveBatch({
            batchId: batch.batchId,
            expectedVersion: batch.version,
            typedBatchId: body.typedBatchId,
            actor: batch.lane === "live" ? OWNER_TYPED_APPROVAL_ACTOR : String(body.actor || "operator"),
            approvedRows: counts.queued,
          });
          if (!approved.ok) {
            if (approved.conflict === true) {
              sendJson(res, 409, { ok: false, error: approved.error, batch: safeBatch(batch) });
            } else if (APPROVAL_INPUT_ERRORS.has(String(approved.error || ""))) {
              sendJson(res, 400, { ok: false, error: approved.error, batch: safeBatch(batch) });
            } else {
              sendJson(res, 503, { ok: false, error: "line_persistence_unavailable", batch: safeBatch(batch) });
            }
            return;
          }
          const loaded = await durable.loadBatch(batch.batchId).catch(() => ({ ok: false }));
          sendJson(res, 200, { ok: true, batch: safeBatch(loaded.ok ? loaded.batch : approved.batch) });
          return;
        }
        if (canonicalReadFailed(canonical)) {
          sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          return;
        }
        const batch = await exactLegacyBatch(body.batchId);
        if (!batch) {
          if (persistenceUnconfigured(canonical)) {
            sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          } else {
            sendJson(res, 404, { ok: false, error: "unknown_batch" });
          }
          return;
        }
        const approved = lineState.approveBatch(batch, {
          typedBatchId: body.typedBatchId,
          actor: batch.lane === "live" ? OWNER_TYPED_APPROVAL_ACTOR : String(body.actor || "operator"),
        });
        if (!approved.ok) {
          sendJson(res, 400, { ok: false, error: approved.error, batch: safeBatch(batch) });
          return;
        }
        runner.putBatch(approved.batch);
        sendJson(res, 200, { ok: true, batch: safeBatch(approved.batch) });
        return;
      }

      if (action === "send") {
        const state = await readiness();
        const canonical = legacyInline
          ? { ok: false, error: "batch_not_found" }
          : await durable.loadBatch(body.batchId).catch(() => ({ ok: false, error: "read_failed" }));
        if (canonical.ok) {
          const batch = canonical.batch;
          if (!state.ready) {
            sendJson(res, 409, { ok: false, error: "blocked_by_readiness", blockers: state.blockers, batch: safeBatch(batch) });
            return;
          }
          if (batch.lane === "live" && !state.liveSendsEnabled) {
            sendJson(res, 400, { ok: false, error: "live_lane_disabled" });
            return;
          }
          if (legacyLiveAutoApproval(batch)) {
            sendJson(res, 403, {
              ok: false,
              error: "send_blocked:explicit_owner_approval_required",
              batch: safeBatch(batch),
            });
            return;
          }
          if (batch.status === "sending") {
            sendJson(res, 202, { ok: true, accepted: true, sending: true, remaining: lineState.batchCounts(batch).queued, batch: safeBatch(batch) });
            return;
          }
          if (batch.status === "halted") {
            // SEND-ONLY DRAIN for a halted sandbox batch. The drain keeps the
            // halt terminal for sourcing and only sends the rows that already
            // finished. When the switch is off this returns null and the
            // historical refusal below answers exactly as before.
            const drain = await drainHaltedSandboxBatch(batch);
            if (drain) {
              sendJson(res, drain.status, drain.body);
              return;
            }
          }
          if (batch.status !== "approved" || !batch.approval) {
            sendJson(res, 403, { ok: false, error: `send_blocked:batch_status_${batch.status}`, batch: safeBatch(batch) });
            return;
          }
          const publication = await publishLineMessage(enqueue, {
            batchId: batch.batchId,
            phase: "send",
            sequence: batch.version,
          }, queueTimeoutMs);
          if (publication.accepted !== true) {
            // Approved batches are also owned by rescueLineBatches: its scan
            // includes `approved`, revalidates the durable approval, and runs
            // the same `send` continuation. Queue loss therefore changes the
            // transport owner, not whether the already-approved work was
            // accepted. All live-send, pause, review-hold, and approval checks
            // above remain fail-closed and unchanged.
            sendJson(res, 202, {
              ok: true,
              accepted: true,
              sending: false,
              remaining: lineState.batchCounts(batch).queued,
              queueAccepted: false,
              retryable: false,
              recovery: "cron",
              queueReason: publication.reason,
              batch: safeBatch(batch),
            });
            return;
          }
          sendJson(res, 202, {
            ok: true,
            accepted: true,
            sending: true,
            remaining: lineState.batchCounts(batch).queued,
            batch: safeBatch(batch),
            spend: spendCounters(),
          });
          return;
        }
        if (canonicalReadFailed(canonical)) {
          sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          return;
        }
        const batch = await exactLegacyBatch(body.batchId);
        if (!batch) {
          if (persistenceUnconfigured(canonical)) {
            sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          } else {
            sendJson(res, 404, { ok: false, error: "unknown_batch" });
          }
          return;
        }
        // Approval is necessary, never sufficient. A pause or a hold still wins.
        if (!state.ready) {
          sendJson(res, 409, { ok: false, error: "blocked_by_readiness", blockers: state.blockers, batch: safeBatch(batch) });
          return;
        }
        if (batch.lane === "live" && !state.liveSendsEnabled) {
          sendJson(res, 400, { ok: false, error: "live_lane_disabled" });
          return;
        }
        if (legacyLiveAutoApproval(batch)) {
          sendJson(res, 403, {
            ok: false,
            error: "send_blocked:explicit_owner_approval_required",
            batch: safeBatch(batch),
          });
          return;
        }
        let result;
        try {
          // STOP WELL SHORT OF THE PLATFORM'S KILL. vercel.json gives this
          // route 300s; each send re-captures proof shots through Chromium, so
          // a cold prospect can cost tens of seconds. 210s leaves ~90s of head
          // room to finish the send in flight, persist the batch and answer —
          // a 504 loses the response AND the record of what was already sent.
          // `remaining` in the reply tells the caller to come back for more.
          result = await runner.sendApprovedBatch(body.batchId, {
            send: overrides.send || defaultSend(batch.lane),
            budgetMs: SEND_BUDGET_MS,
            limit: Number(body.limit) > 0 ? Number(body.limit) : 0,
            startedAt: Date.now(),
          });
        } catch (e) {
          sendJson(res, 403, { ok: false, error: String(e.message || e) });
          return;
        }
        sendJson(res, result.ok ? 200 : 400, { ...result, batch: safeBatch(runner.getBatch(body.batchId)), spend: spendCounters() });
        return;
      }

      // CLEAR_STUCK — the owner's unblock. Batches whose queue deliveries and
      // rescue crons both stalled sit in building/running forever and the
      // console cannot start a new campaign while they hold the line. This
      // marks every non-terminal batch older than the given minutes (default
      // 30) as halted with an honest reason, so the owner can launch again.
      // It cannot send, approve, or touch settled batches.
      if (action === "clear_stuck") {
        const olderThanMinutes = Math.max(0, Number(body.olderThanMinutes) || 0);
        const cleared = [];
        // IN-MEMORY: halt the runner's live view
        for (const b of runner.listBatches()) {
          if (b.status !== "building" && b.status !== "running") continue;
          b.status = "halted";
          b.haltReason = "owner_cleared_stuck_batch";
          cleared.push(b.batchId);
        }
        // DURABLE: the serverless batch registry reads from Supabase — that is
        // where the stuck "building" rows actually live. Patch each non-terminal
        // batch row to halted so the next console read sees them settled. Uses
        // conditionalUpdate per batch (the store's only safe write path).
        let durableCleared = 0;
        try {
          const store = require("../../lib/store");
          // selectRows honors ONLY select/order/limit/filter — a bare `status:`
          // option is silently dropped (see the "FILTERS WERE SILENTLY DROPPED"
          // note in lib/store.js). Passing status that way returned an arbitrary
          // 50 rows of ANY status, so the operator's own live batch was usually
          // not among them and Stop reported "0 cleared" while the run kept
          // burning uploads and browsers. Filter properly and take the NEWEST
          // rows so the batch the operator is looking at is always covered.
          const stuck = await store.selectRows(
            "ghost_agency_line_batches",
            {
              select: "batch_id",
              filter: "status=in.(building,running)",
              order: "updated_at.desc",
              limit: 50,
            },
          ).catch(() => null);
          // store.selectRows does NOT return an `ok` field on success — it
          // returns { mode:"live_select", table, rows } (failures return a
          // `mode:"live_select_failed"` shape, and the dry-run branch explicitly
          // deletes `ok`). Gating on `stuck.ok` therefore skipped this loop
          // ALWAYS, which is why Stop reported "0 cleared" while a run kept
          // going. Gate on the shape that actually exists.
          if (stuck && Array.isArray(stuck.rows) && stuck.rows.length) {
            for (const row of stuck.rows) {
              const r = await store.conditionalUpdate(
                "ghost_agency_line_batches", "batch_id", row.batch_id,
                // 'pending' is not in the table's status CHECK constraint; the
                // real non-terminal states are building/running.
                { status: "in.(building,running)" },
                { status: "halted", halt_reason: "owner_cleared_stuck_batch", updated_at: new Date().toISOString() },
              ).catch(() => null);
              // conditionalUpdate returns ok:true with updated:false when the
              // guard matched nothing — only count real halts.
              if (r && r.ok === true && r.updated === true) durableCleared++;
            }
          }
        } catch (_) { /* store unavailable — in-memory still cleared */ }
        sendJson(res, 200, {
          ok: true,
          action: "clear_stuck",
          cleared,
          durableCleared,
          count: cleared.length + durableCleared,
          note: "Stuck batches cleared (in-memory: " + cleared.length + ", durable: " + durableCleared + "). The console can start new campaigns now.",
        });
        return;
      }

      // DRAIN_EMAILS — the direct finish-and-send for rows the queue left
      // behind. gate_passed rows have live previews and passing gates; this
      // advances them through the SAME phase machinery (writePreviewUrl ->
      // queueEmail -> send-on-finish sender) synchronously in-request, plus
      // one direct send for rows that only reached queued. Sandbox lane only;
      // any batch status except done (halted is exactly the target case); one
      // failed row never blocks the rest; already-sent rows are skipped.
      if (action === "drain_emails") {
        const batchId = String(body.batchId || "").trim();
        if (!batchId) {
          sendJson(res, 400, { ok: false, error: "batch_id_required" });
          return;
        }
        const state = await readiness();
        const canonical = legacyInline
          ? { ok: false, error: "batch_not_found" }
          : await durable.loadBatch(batchId).catch(() => ({ ok: false, error: "read_failed" }));
        if (canonicalReadFailed(canonical)) {
          sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          return;
        }
        if (canonical.ok) {
          const batch = canonical.batch;
          if (batch.lane === "live") {
            // The live lane keeps its approval law: a drain may never mint a
            // live send the operator did not type-approve.
            sendJson(res, 403, { ok: false, error: "drain_emails_sandbox_only", batch: safeBatch(batch) });
            return;
          }
          if (!state.ready) {
            sendJson(res, 409, { ok: false, error: "blocked_by_readiness", blockers: state.blockers, batch: safeBatch(batch) });
            return;
          }
          if (batch.status === "done") {
            sendJson(res, 409, { ok: false, error: "drain_blocked:batch_status_done", batch: safeBatch(batch) });
            return;
          }
          sendJson(res, 200, await drainSandboxEmails(batch, { max: body.max, canonical: true }));
          return;
        }
        const batch = await exactLegacyBatch(batchId);
        if (!batch) {
          if (persistenceUnconfigured(canonical)) {
            sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          } else {
            sendJson(res, 404, { ok: false, error: "unknown_batch", batchId });
          }
          return;
        }
        if (batch.lane === "live") {
          sendJson(res, 403, { ok: false, error: "drain_emails_sandbox_only", batch: safeBatch(batch) });
          return;
        }
        if (!state.ready) {
          sendJson(res, 409, { ok: false, error: "blocked_by_readiness", blockers: state.blockers, batch: safeBatch(batch) });
          return;
        }
        if (batch.status === "done") {
          sendJson(res, 409, { ok: false, error: "drain_blocked:batch_status_done", batch: safeBatch(batch) });
          return;
        }
        sendJson(res, 200, await drainSandboxEmails(batch, { max: body.max, canonical: false }));
        return;
      }

      // RECAPTURE_PROOFS — the evidence-only repair for built rows whose
      // proof-shot pairs predate the capture fixes. Re-runs the capture through
      // the render gate's own machinery and writes the completed record back;
      // NEVER sends (no sender exists on this path — the normal queue/drain
      // does that). Because nothing is sent, BOTH lanes are repairable and no
      // readiness/pause/hold gate applies: those laws hold MAIL, not
      // screenshots. Batch-level refusals mirror the drain's: unknown batch is
      // a 404, a settled (done) batch has nothing to repair.
      if (action === "recapture_proofs") {
        const batchId = String(body.batchId || "").trim();
        if (!batchId) {
          sendJson(res, 400, { ok: false, error: "batch_id_required" });
          return;
        }
        const canonical = legacyInline
          ? { ok: false, error: "batch_not_found" }
          : await durable.loadBatch(batchId).catch(() => ({ ok: false, error: "read_failed" }));
        if (canonicalReadFailed(canonical)) {
          sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          return;
        }
        if (canonical.ok) {
          const batch = canonical.batch;
          if (batch.status === "done") {
            sendJson(res, 409, { ok: false, error: "recapture_blocked:batch_status_done", batch: safeBatch(batch) });
            return;
          }
          sendJson(res, 200, await recaptureRowProofs(batch, { max: body.max, canonical: true }));
          return;
        }
        const batch = await exactLegacyBatch(batchId);
        if (!batch) {
          if (persistenceUnconfigured(canonical)) {
            sendJson(res, 503, { ok: false, error: "line_persistence_unavailable" });
          } else {
            sendJson(res, 404, { ok: false, error: "unknown_batch", batchId });
          }
          return;
        }
        if (batch.status === "done") {
          sendJson(res, 409, { ok: false, error: "recapture_blocked:batch_status_done", batch: safeBatch(batch) });
          return;
        }
        sendJson(res, 200, await recaptureRowProofs(batch, { max: body.max, canonical: false }));
        return;
      }

      sendJson(res, 400, { ok: false, error: "unknown_action", allowed: ["start", "halt", "approve", "send", "clear_stuck", "drain_emails", "recapture_proofs", "quarantine_sport_fencing"] });
    } catch (error) {
      handleError(res, error);
    }
  };
}

/**
 * defaultSend — sandbox lane force-routes every recipient to the owner and
 * asserts it, exactly like api/admin/owner-smoke. The live lane is reachable
 * only when the server switch is on AND the operator approved the batch.
 */
function defaultSend(lane, overrides = {}) {
  const { sendSequenceStep: realSendSequenceStep } = require("../../lib/email");
  const { ensureLineProofShots: realEnsureLineProofShots } = require("../../lib/line-proof-shots");
  const {
    proofShotsForSend: realProofShotsForSend,
    deliveryProofIdentity: realDeliveryProofIdentity,
  } = require("../../lib/line-email-assets");
  const sendSequenceStep = overrides.sendSequenceStep || realSendSequenceStep;
  const ensureLineProofShots = overrides.ensureLineProofShots || realEnsureLineProofShots;
  const proofShotsForSend = overrides.proofShotsForSend || realProofShotsForSend;
  const deliveryProofIdentity = overrides.deliveryProofIdentity || realDeliveryProofIdentity;
  const readProspects = overrides.select || select;
  const writeProspect = overrides.upsertRow || upsertRow;
  const buildLineReport = overrides.ensureLineReport || ensureLineReport;
  return async function send(row) {
    // The thin line row can NEVER satisfy the email's evidence gates: it has
    // no current_website (so the "before" shot is unmintable) and no record
    // (so proof_shots/logo/rating never reach the template). Load the durable
    // prospect and send THAT — the row contributes only its gate-passed
    // preview_url. Both sweeps that first cleared the owner-lock died at
    // "no_before_after_visuals" for exactly this reason.
    const loaded = await readProspects(
      PROSPECTS,
      `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
    ).catch(() => null);
    const durable = loaded && loaded.ok === true && Array.isArray(loaded.data) && loaded.data[0]
      ? loaded.data[0]
      : {};
    const record = durable.record && typeof durable.record === "object" ? durable.record : {};

    // A batch is only a snapshot. The durable row may have been quarantined
    // after approval (for example, a sword-fencing club discovered in the
    // fencing contractor lane). Re-check that law before capture, report, or
    // email work so an already-approved batch cannot outrun the hold.
    const holdStatuses = [durable.status, record.status].map((value) => String(value || "").trim().toLowerCase());
    const holdReasons = [
      durable.blocked_reason,
      durable.vertical_hold && durable.vertical_hold.reason,
      record.blocked_reason,
      record.vertical_hold && record.vertical_hold.reason,
    ].map((value) => String(value || "").trim().toLowerCase());
    if (holdStatuses.includes("held") && holdReasons.includes("vertical_mismatch_sport_fencing")) {
      return { ok: false, reason: "vertical_mismatch_sport_fencing", policyHold: true, providerAttempted: false };
    }
    const currentWebsite = String(durable.current_website || record.current_website || "").trim();

    // Before/after proof: capture-and-store is idempotent (content-addressed
    // keys), and a refused "old" identity leaves the shot absent — the email
    // gate then refuses the send, which is the correct published answer.
    let proofShots = record.proof_shots && typeof record.proof_shots === "object" ? record.proof_shots : null;
    //
    // NO CHROMIUM ON THE SEND PATH — WHEN THE PICTURES ARE ALREADY CURRENT.
    //
    // This used to re-capture unconditionally, and it had to: the object key is
    // derived from the URL, which survives a rebuild, so there was no way to
    // ask whether a stored screenshot was a picture of the site that is live
    // now. Re-shooting was the only safe answer, and it cost 28–35s of browser
    // per prospect (90s+ at the tail) inside a 210s send budget — six or seven
    // sends an invocation, which is the ceiling the line runs into.
    //
    // The render gate now takes those shots in the browser it already has open
    // and stamps them with the build_hash they are pictures of, so the question
    // has an answer. A match means read and go. Anything else — no hash, a
    // rebuilt mirror, a row from before this existed, a capture that failed —
    // falls through to exactly the code that ran before.
    const evidenceBuildHash = String(
      (record.build_dispatch && record.build_dispatch.build_hash) || row.buildHash || "",
    ).trim();
    const proofIdentityState = deliveryProofIdentity({
      sources: [
        record.proof_shots,
        row.proofIdentity,
        row.proof_shots,
        row.captured && row.captured.shots,
      ],
      buildHash: evidenceBuildHash,
    });
    if (!proofIdentityState.ok) {
      return { ok: false, reason: proofIdentityState.reason, providerAttempted: false, policyHold: true };
    }
    let resolved;
    try {
      resolved = await proofShotsForSend({
        row,
        record,
        currentWebsite,
        captureShots: ensureLineProofShots,
        ...(proofIdentityState.active ? { proofIdentity: proofIdentityState.proofIdentity } : {}),
      });
    } catch {
      return { ok: false, reason: "proof_resolution_unavailable", providerAttempted: false, policyHold: true };
    }
    if (!resolved || resolved.refuseDelivery === true) {
      return {
        ok: false,
        reason: String((resolved && resolved.reason) || "proof_resolution_refused"),
        providerAttempted: false,
        policyHold: true,
      };
    }
    if (resolved.shots) proofShots = resolved.shots;
    const proofPersistenceRefused = Boolean(resolved.refuseProofPersistence === true);
    if (resolved.persist && !proofPersistenceRefused && proofShots) {
      await writeProspect(PROSPECTS, {
        prospect_id: row.prospectId,
        record: { ...record, proof_shots: proofShots },
        updated_at: new Date().toISOString(),
      }, "prospect_id").catch(() => {});
    }

    // THE SIGNAL REPORT. The mirror shows them what they could have; the report
    // shows them why they need it. full-run.js hardcoded report_url:"" for this
    // lane, so no line prospect has ever received one. Fail-soft: no report is
    // a thinner email, never a blocked send.
    const reportOut = await buildLineReport({
      ...durable,
      record,
      prospect_id: row.prospectId,
      business_name: row.businessName || durable.business_name,
      current_website: currentWebsite,
    }).catch((e) => ({ ok: false, reportUrl: "", mode: "error", reason: String(e && e.message) }));
    const reportUrl = reportOut.ok ? reportOut.reportUrl : String(record.report_url || "");

    // THE CLIENT ID. Derived, never stored (lib/client-reference), so the same
    // business always reads back the same code. It was missing from every line
    // send because the composer only looked for a record field this lane never
    // writes — which meant the email told them to "mention this to Riley" with
    // nothing to mention.
    const clientId = clientReferenceCode({ ...durable, prospect_id: row.prospectId, record });

    const prospect = {
      ...durable,
      record: {
        ...record,
        ...(!proofPersistenceRefused && (proofShots || record.proof_shots)
          ? { proof_shots: proofShots || record.proof_shots }
          : {}),
        ...(reportUrl ? { report_url: reportUrl } : {}),
        ...(clientId ? { client_id: clientId } : {}),
      },
      proof_shots: proofShots || record.proof_shots,
      current_website: currentWebsite,
      prospect_id: row.prospectId,
      business_name: row.businessName || durable.business_name,
      email: row.email,
      preview_url: row.previewUrl,
      ...(reportUrl ? { report_url: reportUrl } : {}),
      ...(clientId ? { client_id: clientId } : {}),
      status: "line_queued",
    };

    // RILEY needs to be able to answer "who is this" when they call the number
    // in the email. Persist the reference, the preview and the report onto the
    // row her lookup reads; without it she meets a stranger holding a code she
    // cannot resolve.
    if (clientId || reportUrl) {
      // NO `reference` COLUMN. ghost_agency_prospects has no such column (the
      // live table answers 42703), so writing one made the whole upsert 400 and
      // a bare .catch() swallowed it — the Client ID and report never persisted
      // and Riley's lookup kept answering "report: no". The Client ID lives in
      // the record jsonb, which is also where Riley reads it from.
      // ARGUMENT ORDER: upsertRow(table, ROW, conflictColumns). Both writes in
      // this file had the row and the conflict column swapped, so every call
      // POSTed the string "prospect_id" as the row body and failed — which is
      // why proof_shots, the Client ID and the report all "persisted" to
      // nothing while the sends looked healthy.
      const persisted = await writeProspect(PROSPECTS, {
        prospect_id: row.prospectId,
        record: prospect.record,
        ...(reportUrl ? { report_url: reportUrl } : {}),
        updated_at: new Date().toISOString(),
      }, "prospect_id").catch((e) => ({ ok: false, reason: String((e && e.message) || e).slice(0, 160) }));
      // Fail-soft, but never SILENT: a swallowed write is how this defect
      // survived two sends looking healthy.
      if (persisted && persisted.ok === false) {
        console.error("[line] client_id/report persistence failed", row.prospectId, persisted.reason || persisted.status || "");
      }
    }
    // The legacy route can spend seconds on evidence/report work after its
    // first read. Re-read at the provider boundary so a quarantine written in
    // that window wins before either sandbox or live delivery.
    const boundaryLoaded = await readProspects(
      PROSPECTS,
      `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
    ).catch(() => null);
    const boundaryDurable = boundaryLoaded && boundaryLoaded.ok === true
      && Array.isArray(boundaryLoaded.data) && boundaryLoaded.data[0]
      ? boundaryLoaded.data[0]
      : null;
    if (!boundaryDurable) {
      return { ok: false, reason: "canonical_recipient_unavailable", providerAttempted: false };
    }
    const boundaryRecord = boundaryDurable.record && typeof boundaryDurable.record === "object"
      ? boundaryDurable.record
      : {};
    const boundaryStatuses = [boundaryDurable.status, boundaryRecord.status]
      .map((value) => String(value || "").trim().toLowerCase());
    const boundaryReasons = [
      boundaryDurable.blocked_reason,
      boundaryDurable.vertical_hold && boundaryDurable.vertical_hold.reason,
      boundaryRecord.blocked_reason,
      boundaryRecord.vertical_hold && boundaryRecord.vertical_hold.reason,
    ].map((value) => String(value || "").trim().toLowerCase());
    if (boundaryStatuses.includes("held") && boundaryReasons.includes("vertical_mismatch_sport_fencing")) {
      return { ok: false, reason: "vertical_mismatch_sport_fencing", policyHold: true, providerAttempted: false };
    }

    if (lane !== "live") {
      const owner = ownerSandboxAddress();
      if (!owner) return { ok: false, reason: "owner_address_unset" };
      const routed = forceOwnerRecipient(prospect, owner);
      if (!assertOwnerOnly(routed, owner)) return { ok: false, reason: "owner_only_assertion_failed" };
      const result = await sendSequenceStep({
        prospect: routed,
        sequence: 1,
        step: 1,
        dryRun: false,
        lineBatchApproved: true,
        // The sandbox lane force-routes to the owner and asserts it above —
        // this IS an internal owner proof, and the contact-confidence hold
        // (which protects PROSPECT addresses) must not block the owner's own
        // mailbox. canBypassContactHold still verifies to === owner.
        internalOwnerProof: true,
        allowContactHoldBypass: true,
      });
      return { ok: result && result.ok !== false, reason: (result && (result.error || result.blocked || result.reason)) || "" };
    }
    // LIVE: the prospect gets the email, and the owner ALWAYS gets the same
    // one (bcc). This is the operating deal behind the console's mode toggle —
    // "regardless of either one, I still receive the email that goes out"
    // (owner directive 2026-08-06). Fail-open on a missing owner address here
    // would silently break that deal, so it blocks instead.
    const owner = ownerSandboxAddress();
    if (!owner) return { ok: false, reason: "owner_address_unset_live_copy_required" };
    const result = await sendSequenceStep({
      prospect,
      sequence: 1,
      step: 1,
      dryRun: false,
      lineBatchApproved: true,
      bcc: owner,
    });
    return { ok: result && result.ok !== false, reason: (result && (result.error || result.blocked || result.reason)) || "" };
  };
}

/**
 * autoApproveAndSendSandbox — the sandbox lane's hands-free finish.
 *
 * SANDBOX ONLY. The caller guards on lane === "sandbox", and this hardcodes
 * defaultSend("sandbox"), which force-routes every recipient to the owner and
 * asserts it — so even a mislabeled row cannot reach a prospect from here. It
 * approves the batch on the operator's behalf (actor "sandbox_auto"), then runs
 * the same resumable send the manual path uses. A live batch must NEVER be
 * passed to this function.
 */
async function autoApproveAndSendSandbox(batch, overrides = {}) {
  // IMMUTABLE LANE GUARD — defence in depth. The caller already excludes the
  // live lane, but this path force-approves a batch on the operator's behalf,
  // so it re-reads the batch's OWN stored lane and refuses anything that is not
  // a genuine sandbox batch. A live (real-prospect) batch can NEVER be
  // auto-approved or auto-sent from here, whatever the switch or the caller say.
  if (!batch || batch.lane !== "sandbox") {
    return {
      ok: true,
      batchId: batch && batch.batchId,
      batch,
      autoSent: false,
      autoSendReason: "auto_send_refused_non_sandbox_lane",
    };
  }
  const approved = lineState.approveBatch(batch, {
    typedBatchId: batch.batchId,
    actor: "sandbox_auto",
  });
  if (!approved.ok) {
    // A batch that will not approve (nothing gate-passed, say) is not a failure
    // of the run — it just has nothing to auto-send. Hand back the built batch.
    return { ok: true, batchId: batch.batchId, batch, autoSent: false, autoSendReason: approved.error };
  }
  runner.putBatch(approved.batch);
  const sent = await runner.sendApprovedBatch(batch.batchId, {
    send: overrides.send || defaultSend("sandbox"),
    budgetMs: SEND_BUDGET_MS,
    startedAt: Date.now(),
  });
  return { ...sent, autoSent: true, batchId: batch.batchId, batch: runner.getBatch(batch.batchId) || approved.batch };
}

/**
 * autoApproveAndSendLive — retired compatibility export.
 *
 * No caller may mint a live approval from campaign start. Keep the named
 * export temporarily so an old injected harness fails closed instead of
 * crashing while operators move to POST action:"approve" with typedBatchId.
 */
async function autoApproveAndSendLive(batch) {
  const reason = batch && batch.lane === "live"
    ? "explicit_owner_approval_required"
    : "auto_send_refused_non_live_lane";
  return {
    ok: false,
    error: reason,
    batchId: batch && batch.batchId,
    batch,
    autoSent: false,
    autoSendReason: reason,
  };
}

module.exports = createLineHandler();
module.exports.createLineHandler = createLineHandler;
module.exports.autoApproveAndSendSandbox = autoApproveAndSendSandbox;
module.exports.autoApproveAndSendLive = autoApproveAndSendLive;
module.exports.defaultSend = defaultSend;
module.exports.quarantineSportFencingProspects = quarantineSportFencingProspects;
module.exports.QUEUE_PUBLISH_TIMEOUT_MS = QUEUE_PUBLISH_TIMEOUT_MS;
module.exports.DIRECT_START_RECOVERY_TIMEOUT_MS = DIRECT_START_RECOVERY_TIMEOUT_MS;
module.exports.safeQueueFailureReason = safeQueueFailureReason;
// Exported so the gate-plus-capture wiring can be exercised directly, against a
// real mirror and a real browser, without running a whole batch.
module.exports.gateWithCapture = gateWithCapture;
module.exports.safeBatch = safeBatch;
module.exports.safeRow = safeRow;
module.exports.mirrorDispatchSummary = mirrorDispatchSummary;
module.exports.rowTelemetry = rowTelemetry;
module.exports.batchPerformance = batchPerformance;
module.exports.capacityState = capacityState;
module.exports.readinessState = readinessState;
module.exports.spendCounters = spendCounters;
module.exports.recognizedStartTarget = recognizedStartTarget;
module.exports.RECOGNIZED_START_TARGETS = RECOGNIZED_START_TARGETS;
module.exports.requestedStartDeepBatchDepth = requestedStartDeepBatchDepth;
module.exports.DEEP_BATCH_DEPTH_ENV = DEEP_BATCH_DEPTH_ENV;
