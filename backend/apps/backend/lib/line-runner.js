"use strict";

/**
 * lib/line-runner.js — drives one batch through the operator flow.
 *
 *   pick/mine -> qualify -> mirror -> RENDER-GATE -> write preview_url
 *             -> queue email -> [operator approves] -> send
 *
 * Every step here is a thin adapter over code that already exists (lead-miner,
 * build-qualification, full-run's mirror path, render-gate, email). The value
 * this file adds is the ORDER and the REFUSALS:
 *
 *   · a row that does not qualify never reaches a mirror (spend control),
 *   · a row whose mirror did not render never gets a preview_url written,
 *   · a row whose gate failed never gets queued and never gets an email,
 *   · nothing at all is sent from here — sending lives behind approveBatch().
 *
 * Every dependency is injectable so the whole line can be driven, and proven,
 * without a network. Production passes none of them.
 */

const { randomUUID } = require("node:crypto");
const lineState = require("./line-state");
const heroBudget = require("./line-hero-budget");
const { deliveryPauseStatus } = require("./delivery-pause");
const { runRenderGate, assertGateIntegrity } = require("./render-gate");
const {
  CAPTURE_BUDGET_MS,
  automaticProofShotRecord,
  deliveryProofIdentity,
} = require("./line-email-assets");
const { recordEvent, selectRows } = require("./store");
const { signedReleaseEvidence } = require("./line-persisted-mirror");
const { pickHeroPhoto } = require("./hero-wash");
const { verificationMode } = require("./light-verification");

const MAX_COUNT = 500;
// The durable snapshot of a batch, so an Approve click survives a cold lambda.
const BATCH_EVENT = "line.batch";
const LAUNCH_SIZES = Object.freeze([10, 50, 100, 500]);
const SANDBOX_STATIC_HERO_FALLBACK_REASON = "sandbox_video_retries_exhausted_static_hero_verified";
const SANDBOX_FOREIGN_STATIC_HERO_FALLBACK_REASON = "sandbox_foreign_video_terminal_static_hero_verified";
const SANDBOX_FOREIGN_CHECKPOINT_STATIC_HERO_FALLBACK_REASON = "sandbox_foreign_submit_rejected_static_hero_verified";
const FOREIGN_CHECKPOINT_STATIC_HERO_JOB_BINDING_SCHEMA = "wss.line.static_hero_foreign_checkpoint_job.v1";
const CAPABILITY_NO_CHECKPOINT_REASON = "hero_capability_unrenewed_no_checkpoint";
const CAPABILITY_BUDGET_EXHAUSTED_BY = "provider_spend_uncertain";
const FOREIGN_HANDLE_CONSUMPTION_REASON = "foreign_terminal_job_consumed";
const FOREIGN_CHECKPOINT_OBSERVATION_REASON = "foreign_submit_rejection_observed_read_only";
const SANDBOX_OPERATIONAL_HERO_FAILURE_REASONS = new Set([
  "openrouter_submit_failed",
  "openrouter_download_failed",
  "boomerang_ffmpeg_missing",
  "boomerang_ffmpeg_timeout",
  "hero_lease_expired_max_attempts",
  "hero_lost_settle_max_attempts",
  CAPABILITY_NO_CHECKPOINT_REASON,
]);
const SANDBOX_OPERATIONAL_HERO_MAX_REASONS = new Set([
  "hero_lease_expired_max_attempts",
  "hero_lost_settle_max_attempts",
  CAPABILITY_NO_CHECKPOINT_REASON,
]);
const SANDBOX_OPERATIONAL_HERO_FAILURE_PATTERNS = [
  /EPROTO/i,
  /SSL/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /^seedance_clip_transcode_(?:unavailable|timeout|failed|empty)$/,
  /^seedance_transcode_(?:clip_too_large|output[_-]invalid)$/,
];
const VERIFIED_STATIC_HERO_SOURCES = new Set([
  "client_current_hero",
  "identity_portrait",
  "photo_bank",
  "first_usable_photo",
]);

function operationalHeroFailureReason(reason = "") {
  return SANDBOX_OPERATIONAL_HERO_FAILURE_REASONS.has(reason)
    || SANDBOX_OPERATIONAL_HERO_FAILURE_PATTERNS.some((pattern) => pattern.test(reason));
}

function heroLeaseAttemptCap(env = process.env) {
  return Math.max(1, Number(env.GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS) || 3);
}

function staticHeroPhotoSource(photo = {}) {
  return photo.current_hero === true
    ? "client_current_hero"
    : photo.identity_critical === true
      ? "identity_portrait"
      : "photo_bank";
}

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// The pick's boolean is only a display hint. Read the durable prospect again
// and verify its signed Packet2 receipt before retiring the older, broad
// website-score qualifier for this one row. Every other row keeps that gate.
async function verifiedPacket2Qualification(row, deps = {}) {
  if (row?.genieContentCertified !== true || !String(row.prospectId || "").trim()) return false;
  const read = deps.selectRows || selectRows;
  let loaded;
  try {
    loaded = await read("ghost_agency_prospects", {
      filter: `prospect_id=eq.${encodeURIComponent(String(row.prospectId).trim())}`,
      limit: 1,
    });
  } catch { return false; }
  const records = loaded?.rows || loaded?.data;
  if (!Array.isArray(records) || records.length !== 1) return false;
  const persisted = records[0];
  if (String(persisted?.prospect_id || "") !== String(row.prospectId)) return false;
  const record = objectOf(persisted.record);
  const packet = objectOf(record?.genie_canonical_packet);
  const transport = objectOf(packet?.transport_receipt);
  if (!packet || !transport || transport.version !== "owner-packet2-import-v1"
    || !/^[a-f0-9]{64}$/.test(String(packet.packet2_hash || ""))
    || transport.packet2_hash !== packet.packet2_hash
    || !/^[a-f0-9]{64}$/.test(String(transport.snapshot_sha256 || ""))) return false;
  const env = deps.env || process.env;
  const signingKey = Object.prototype.hasOwnProperty.call(deps, "certificationKey")
    ? deps.certificationKey : env.INTAKE_GENIE_CERTIFICATION_KEY;
  const { verifiedGenieContentReceipt } = require("./line-adapters");
  try {
    const verdict = verifiedGenieContentReceipt(persisted, record, {
      certificationKey: signingKey,
      nowMs: typeof deps.nowMs === "function" ? deps.nowMs() : Date.now(),
    });
    return verdict?.ok === true;
  } catch { return false; }
}

function mirrorProofIdentity(built) {
  if (!built || typeof built !== "object"
      || !Object.prototype.hasOwnProperty.call(built, "proofIdentity")
      || built.proofIdentity === null
      || built.proofIdentity === undefined) {
    return { ok: true, active: false, proofIdentity: null, reason: "" };
  }
  if (!built.proofIdentity || typeof built.proofIdentity !== "object" || Array.isArray(built.proofIdentity)) {
    return { ok: false, active: true, proofIdentity: null, reason: "shared_proof_identity_malformed" };
  }
  const state = deliveryProofIdentity({
    sources: [built.proofIdentity],
    buildHash: String(built.buildHash || "").trim(),
  });
  // An object with no shared markers is the historical build-hash-only legacy
  // shape. Once either marker exists, the complete exact tuple is mandatory.
  if (!state.active) return state;
  if (!String(built.buildHash || "").trim()) {
    return { ok: false, active: true, proofIdentity: null, reason: "shared_proof_build_hash_mismatch" };
  }
  return state;
}

// ---------------------------------------------------------------------------
// HOW MANY MIRRORS BUILD AT ONCE
// ---------------------------------------------------------------------------
// A mirror is almost entirely network wait: the Vercel deploy alone is ~60s of
// polling READY, and the owner's box sat at 18% CPU for a ten-lead run that
// took ten minutes. Rows are independent — each one owns its own index in
// batch.rows and touches no other row's state — so they run in a bounded pool.
//
// WHY 5 IS THE DEFAULT. Measured on a real ten-lead plumbing batch, 2026-08-07
// (serial 709.9s -> pool-of-5 145.1s, 4.89x, byte-identical per-lead verdicts):
//
//   · RATE LIMITS ARE NOT THE BINDING CONSTRAINT. A ten-lead batch driven at
//     concurrency TEN issued 254 requests to api.vercel.com, peaking at 50/s,
//     and took ZERO 429s. Deploy burst has the most headroom of all: the Pro
//     ceiling is 120 deployments / 5 minutes and lib/mirror-engine/deploy.js
//     already self-throttles at 110, while concurrency N with a ~60s deploy
//     only asks for about 5N per 5 minutes — 25 at N=5.
//   · GOOGLE PLACES IS NOT A CONSTRAINT EITHER: exactly one places:searchText
//     per mirror, and every one of them currently returns 403 on our own key
//     (see verified-facts placesDirect) so none are billed or throttled.
//   · THE REAL CEILING IS MEMORY, NOT QUOTA. The render gate launches a whole
//     headless chromium per row (lib/serverless-chromium), and in production
//     that happens INSIDE one Vercel function. N rows in flight is worst-case
//     N concurrent browsers against the function's memory limit, which is the
//     thing that will fail first — and it fails as an OOM, not as a 429.
//
// Deploys stagger, so the browsers do too: at concurrency 5 the measured peak
// was only TWO gates open at once, against five concurrent mirrors. That is
// what makes 5 comfortable. The cap of 12 exists so a typo in the env var
// cannot open twelve browsers and a whole batch of deploys at once, and the
// env var itself is the valve — it retunes without a deploy if a longer batch
// ever shows memory pressure.
//
// A pool that trips a limit is SLOWER than serial, because the retry sits on
// top of the wait it was trying to avoid. Raise this only with a measurement.
//
// RAISED TO 10 (2026-08-13). The 5 above was the conservative first setting; a
// full Mine of 500 needs the batch to build FAST enough that the resumable
// build (deps.budgetMs) makes real progress inside each ~230s function window.
// 10 is still comfortably under the memory ceiling the measurements found (the
// binding constraint is concurrent chromium in the render gate, and deploys
// stagger the gates) and under MAX_BUILD_CONCURRENCY, and the env var still
// overrides it if a longer batch ever shows pressure.
const DEFAULT_BUILD_CONCURRENCY = 10;
// CAP RAISED 12 -> 15 (2026-09-02). The default stays 10; only the env-override
// ceiling moved, so GHOST_AGENCY_BUILD_CONCURRENCY can now be tuned up to 15
// without a code change if a longer batch ever shows headroom. 15 stays a guard
// rail, not a target — the measured memory ceiling is about concurrent
// chromium, and the default of 10 deliberately sits below it.
const MAX_BUILD_CONCURRENCY = 15;
const BUILD_CONCURRENCY_ENV = "GHOST_AGENCY_BUILD_CONCURRENCY";

/** Parse a concurrency setting. Anything unreadable falls back to the default. */
function buildConcurrency(value, fallback = DEFAULT_BUILD_CONCURRENCY) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_BUILD_CONCURRENCY);
}

// PER-ROW BUILD TIMEOUTS. The batch budgetMs stops the pool from claiming NEW rows
// past its wall-clock, but it CANNOT interrupt a row already in flight — so one
// mirror deploy-poll or render-gate that HANGS runs straight to the 300s Vercel
// function ceiling and kills the whole batch (measured on prod /api/admin/line:
// "Vercel Runtime Timeout Error: Task timed out after 300 seconds"). These cap a
// single stuck step so it fails that ONE row and the pool moves on, well before
// the function ceiling. Normal timings: build+deploy ~127s, render gate ~30s.
const MIRROR_TIMEOUT_MS = Number(process.env.GHOST_AGENCY_MIRROR_TIMEOUT_MS) || 180000;
// readRenderedDom may use its full 45s budget before the same browser begins
// CAPTURE_BUDGET_MS of approved email proof work. Keep one extra minute around
// that measured capture budget while remaining 50s inside the durable worker's
// 230s deadline.
const DEFAULT_GATE_TIMEOUT_MS = CAPTURE_BUDGET_MS + 60_000;
const GATE_TIMEOUT_MS = Number(process.env.GHOST_AGENCY_GATE_TIMEOUT_MS) || DEFAULT_GATE_TIMEOUT_MS;
const HERO_REMMASTER_POLL_MS = 30_000;
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timed_out_after_${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), timeout]);
}

/**
 * Run one phase beneath a real AbortSignal as well as a Promise race. The race
 * owns our return time; the signal gives fetch/browser/deploy code a chance to
 * stop its underlying work instead of becoming a zombie after the race loses.
 */
async function withPhaseDeadline(work, ms, label, parentSignal) {
  const controller = new AbortController();
  let timer = null;
  const forward = () => controller.abort(parentSignal?.reason || new Error(`${label}_aborted`));
  if (parentSignal?.aborted) forward();
  else if (parentSignal?.addEventListener) parentSignal.addEventListener("abort", forward, { once: true });
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error(`${label}_timed_out_after_${Math.round(ms / 1000)}s`), {
        code: "line_phase_timeout",
        phase: label,
        retryable: true,
      });
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), expiry]);
  } finally {
    if (timer) clearTimeout(timer);
    if (parentSignal?.removeEventListener) parentSignal.removeEventListener("abort", forward);
  }
}

function terminalRow(row) {
  return Boolean(row)
    && ((row.status === lineState.ROW_READY && !lineState.strandedReadyRow(row))
      || row.status === "queued"
      || row.status === "sent"
      || lineState.isFailed(row.status));
}

function heroRemasterRetryAt(nowValue) {
  const parsed = Date.parse(String(nowValue || ""));
  return new Date((Number.isFinite(parsed) ? parsed : Date.now()) + HERO_REMMASTER_POLL_MS).toISOString();
}

function heroRemasterRowState(result = {}) {
  const completionMode = String(result.completion_mode || result.completionMode || "");
  const sharedSiteId = String(result.shared_site_id || result.sharedSiteId || "");
  const sharedReleaseId = String(result.shared_release_id || result.sharedReleaseId || "");
  const attemptId = String(result.hero_attempt_id || result.heroAttemptId || result.attemptId || "");
  const producer = String(result.producer || "").trim();
  const videoAttempts = Number(result.video_attempts ?? result.videoAttempts);
  const videoAttemptCap = Number(result.video_attempt_cap ?? result.videoAttemptCap);
  const foreignJobGenerationRevision = Number(
    result.foreign_job_generation_revision ?? result.foreignJobGenerationRevision,
  );
  return {
    required: result.required === true,
    ready: result.ready === true,
    pending: result.pending === true,
    hold: result.hold === true,
    fallback: result.fallback === true,
    applied: result.applied === true,
    status: String(result.status || ""),
    jobId: String(result.job_id || result.jobId || ""),
    rebuildStatus: String(result.rebuild_status || result.rebuildStatus || ""),
    rebuildJobId: String(result.rebuild_job_id || result.rebuildJobId || ""),
    buildHash: String(result.build_hash || result.buildHash || ""),
    reelUrl: String(result.reel_url || result.reelUrl || ""),
    reason: String(result.reason || result.skipped || ""),
    ...(completionMode ? { completionMode } : {}),
    ...(attemptId ? { attemptId } : {}),
    ...(sharedSiteId ? { sharedSiteId } : {}),
    ...(sharedReleaseId ? { sharedReleaseId } : {}),
    ...(producer ? { producer } : {}),
    ...(result.static_hero_verified === true || result.staticHeroVerified === true
      ? { staticHeroVerified: true }
      : {}),
    ...(String(result.static_hero_source || result.staticHeroSource || "").trim()
      ? { staticHeroSource: String(result.static_hero_source || result.staticHeroSource).trim() }
      : {}),
    ...(String(result.static_hero_photo_sha256 || result.staticHeroPhotoSha256 || "").trim()
      ? { staticHeroPhotoSha256: String(result.static_hero_photo_sha256 || result.staticHeroPhotoSha256).trim().toLowerCase() }
      : {}),
    ...(String(result.static_hero_photo_url || result.staticHeroPhotoUrl || "").trim()
      ? { staticHeroPhotoUrl: String(result.static_hero_photo_url || result.staticHeroPhotoUrl).trim() }
      : {}),
    ...(String(result.static_hero_bank_fingerprint || result.staticHeroBankFingerprint || "").trim()
      ? { staticHeroBankFingerprint: String(result.static_hero_bank_fingerprint || result.staticHeroBankFingerprint).trim().toLowerCase() }
      : {}),
    ...(String(result.base_evidence_sha || result.baseEvidenceSha || "").trim()
      ? { baseEvidenceSha: String(result.base_evidence_sha || result.baseEvidenceSha).trim() }
      : {}),
    ...(String(result.line_batch_id || result.lineBatchId || "").trim()
      ? { lineBatchId: String(result.line_batch_id || result.lineBatchId).trim() }
      : {}),
    ...(String(result.line_row_id || result.lineRowId || "").trim()
      ? { lineRowId: String(result.line_row_id || result.lineRowId).trim() }
      : {}),
    ...(String(result.foreign_job_binding_schema || result.foreignJobBindingSchema || "").trim()
      ? { foreignJobBindingSchema: String(result.foreign_job_binding_schema || result.foreignJobBindingSchema).trim() }
      : {}),
    ...(String(result.foreign_job_binding_sha256 || result.foreignJobBindingSha256 || "").trim()
      ? { foreignJobBindingSha256: String(result.foreign_job_binding_sha256 || result.foreignJobBindingSha256).trim().toLowerCase() }
      : {}),
    ...(String(result.foreign_job_prospect_id || result.foreignJobProspectId || "").trim()
      ? { foreignJobProspectId: String(result.foreign_job_prospect_id || result.foreignJobProspectId).trim() }
      : {}),
    ...(Number.isSafeInteger(foreignJobGenerationRevision) && foreignJobGenerationRevision > 0
      ? { foreignJobGenerationRevision }
      : {}),
    ...(String(result.foreign_job_line_batch_id || result.foreignJobLineBatchId || "").trim()
      ? { foreignJobLineBatchId: String(result.foreign_job_line_batch_id || result.foreignJobLineBatchId).trim() }
      : {}),
    ...(String(result.foreign_job_line_row_id || result.foreignJobLineRowId || "").trim()
      ? { foreignJobLineRowId: String(result.foreign_job_line_row_id || result.foreignJobLineRowId).trim() }
      : {}),
    ...(String(result.foreign_job_build_hash || result.foreignJobBuildHash || "").trim()
      ? { foreignJobBuildHash: String(result.foreign_job_build_hash || result.foreignJobBuildHash).trim().toLowerCase() }
      : {}),
    ...(String(result.foreign_job_snapshot_sha256 || result.foreignJobSnapshotSha256 || "").trim()
      ? { foreignJobSnapshotSha256: String(result.foreign_job_snapshot_sha256 || result.foreignJobSnapshotSha256).trim().toLowerCase() }
      : {}),
    ...(String(result.foreign_job_checkpoint_sha256 || result.foreignJobCheckpointSha256 || "").trim()
      ? { foreignJobCheckpointSha256: String(result.foreign_job_checkpoint_sha256 || result.foreignJobCheckpointSha256).trim().toLowerCase() }
      : {}),
    ...(String(result.foreign_job_status || result.foreignJobStatus || "").trim()
      ? { foreignJobStatus: String(result.foreign_job_status || result.foreignJobStatus).trim() }
      : {}),
    ...(String(result.foreign_job_result_reason || result.foreignJobResultReason || "").trim()
      ? { foreignJobResultReason: String(result.foreign_job_result_reason || result.foreignJobResultReason).trim() }
      : {}),
    ...(String(result.foreign_job_updated_at || result.foreignJobUpdatedAt || "").trim()
      ? { foreignJobUpdatedAt: String(result.foreign_job_updated_at || result.foreignJobUpdatedAt).trim() }
      : {}),
    ...(String(result.foreign_job_finished_at || result.foreignJobFinishedAt || "").trim()
      ? { foreignJobFinishedAt: String(result.foreign_job_finished_at || result.foreignJobFinishedAt).trim() }
      : {}),
    ...(String(result.foreign_job_consumption_reason || result.foreignJobConsumptionReason || "").trim()
      ? { foreignJobConsumptionReason: String(result.foreign_job_consumption_reason || result.foreignJobConsumptionReason).trim() }
      : {}),
    ...(String(result.video_failure_reason || result.videoFailureReason || "").trim()
      ? { videoFailureReason: String(result.video_failure_reason || result.videoFailureReason).trim() }
      : {}),
    ...(String(result.video_retry_budget_exhausted_by || result.videoRetryBudgetExhaustedBy || "").trim()
      ? { videoRetryBudgetExhaustedBy: String(
        result.video_retry_budget_exhausted_by || result.videoRetryBudgetExhaustedBy,
      ).trim() }
      : {}),
    ...(String(result.video_terminal_reason || result.videoTerminalReason || "").trim()
      ? { videoTerminalReason: String(result.video_terminal_reason || result.videoTerminalReason).trim() }
      : {}),
    ...(Number.isSafeInteger(videoAttempts) && videoAttempts >= 0 ? { videoAttempts } : {}),
    ...(Number.isSafeInteger(videoAttemptCap) && videoAttemptCap > 0 ? { videoAttemptCap } : {}),
  };
}

function mirrorBuildIdentityAvailable(result = {}) {
  const previewUrl = String(result.previewUrl || result.preview_url || "").trim();
  const buildHash = String(result.buildHash || result.build_hash || "").trim();
  const releaseEvidence = objectOf(
    result.releaseEvidence
    || result.release_evidence
    || result.buildEvidence?.release_evidence
    || result.buildStatus?.release_evidence,
  );
  return /^https:\/\//i.test(previewUrl)
    && /^[a-f0-9]{64}$/i.test(buildHash)
    && !!releaseEvidence;
}

function signedMirrorBuildIdentityAvailable(result = {}) {
  const previewUrl = String(result.previewUrl || result.preview_url || "").trim();
  const buildHash = String(result.buildHash || result.build_hash || "").trim();
  const evidence = objectOf(
    result.releaseEvidence
    || result.release_evidence
    || result.buildEvidence?.release_evidence
    || result.buildStatus?.release_evidence,
  );
  const signed = signedReleaseEvidence(evidence, previewUrl);
  return Boolean(signed && String(signed.build_hash || "").toLowerCase() === buildHash.toLowerCase());
}

function heroPendingIdentity(marker = {}) {
  const jobId = String(marker.jobId || marker.job_id || "").trim();
  const attemptId = String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || "").trim();
  // An operator-action marker (ads_blocked_by_extension) holds by jobId+status
  // alone: it deliberately requeues nowhere, so it never carries an attempt id.
  if (String(marker.status || "").trim() === "operator_action_required") return Boolean(jobId);
  return Boolean(jobId && attemptId);
}

const HERO_AUTOLINE_KILL_SWITCHES = Object.freeze([
  "GHOST_AGENCY_HERO_AUTOLINE",
  // Historical published spelling. A stale production value still disables
  // the modern Seedance autoline and is therefore diagnostically important.
  "GHOST_AGENCY_HERO_REMMASTER",
  "GHOST_AGENCY_HERO_REMASTER",
]);

function explicitHeroAutolineOffKeys(env = process.env) {
  return HERO_AUTOLINE_KILL_SWITCHES.filter((key) =>
    /^(0|false|off|no)$/i.test(String(env?.[key] ?? "").trim()));
}

function heroAutolineEnabled(env = process.env) {
  return require("./line-adapters").heroAutolineEnabled(env);
}

/** Row-local attach trace; diagnostic only, with no gate/verdict authority. */
function heroAttachDiagnostic(row = {}, { batchId = "", env = process.env, startHeroWired = true } = {}) {
  const disabledBy = explicitHeroAutolineOffKeys(env);
  const markerObject = objectOf(row.heroRemaster);
  const marker = markerObject || {};
  const checkpointStarted = durableHeroStartCheckpoint(row, batchId, { requireFinal: false });
  const checkpointFinal = durableHeroStartCheckpoint(row, batchId);
  const heroReason = String(marker.reason || "").trim();
  let brokenLink = "hero_attach_boundary_unresolved";
  if (disabledBy.length) brokenLink = "hero_autoline_disabled_by_env";
  else if (!startHeroWired) brokenLink = "hero_start_adapter_unwired";
  else if (markerObject && heroReason === "awaiting_owner_review") brokenLink = "hero_owner_review_hold";
  else if (markerObject && marker.pending === true) brokenLink = "hero_job_or_join_pending";
  else if (markerObject && marker.hold === true) brokenLink = "hero_join_held";
  else if (markerObject && marker.fallback === true) brokenLink = "hero_fallback_selected";
  else if (markerObject && marker.applied === true) brokenLink = "hero_attach_boundary_satisfied";
  else if (!checkpointStarted) brokenLink = "hero_enqueue_checkpoint_missing";
  else if (!checkpointFinal) brokenLink = "hero_enqueue_checkpoint_unfinalized";
  else if (!markerObject) brokenLink = "hero_join_marker_missing";
  else brokenLink = "hero_rebuild_attach_not_applied";
  return {
    finding: "most likely per code trace",
    brokenLink,
    rowStatus: String(row.status || ""),
    autolineEnabled: heroAutolineEnabled(env),
    disabledBy,
    checkpointStarted: Boolean(checkpointStarted),
    checkpointFinal: Boolean(checkpointFinal),
    ...(String(marker.status || "").trim() ? { heroStatus: String(marker.status).trim() } : {}),
    ...(String(marker.producer || "").trim() ? { heroProducer: String(marker.producer).trim() } : {}),
    ...(heroReason ? { heroReason } : {}),
    heroApplied: marker.applied === true,
  };
}

// SEND-ON-FINISH (owner directive 2026-09-01): a finished sandbox site's owner
// proof email leaves AS the row finishes, not when the batch settles. The
// switch defaults ON; "0" restores queue-until-settle exactly. The live lane is
// untouched — real prospects still wait for the typed batch approval.
const SEND_ON_FINISH_SWITCH = "GHOST_AGENCY_SEND_ON_FINISH";

function sendOnFinishEnabled(env = process.env) {
  return String(env[SEND_ON_FINISH_SWITCH] ?? "1").trim() !== "0";
}

function heroStartBinding(marker = {}) {
  const jobId = String(marker.jobId || marker.job_id || "").trim();
  const attemptId = String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || "").trim();
  return Boolean(
    marker.required === true
    && marker.pending === true
    && marker.ready !== true
    && marker.hold !== true
    && marker.applied !== true
    && jobId
    && /^hero_attempt:\d+$/.test(attemptId),
  );
}

function heroStartDecision(marker = {}) {
  if (heroStartBinding(marker)) return true;
  // A proven pre-job fallback is also a complete start decision. It creates no
  // provider job, so there is no paid identity to bind.
  return marker.required !== true
    && marker.fallback === true
    && marker.ready === true
    && marker.pending !== true
    && marker.hold !== true
    && !String(marker.jobId || marker.job_id || "").trim();
}

function heroStartCheckpoint(row = {}, batchId = "", marker = {}, disposition = "") {
  if (disposition !== "qualified" && !heroStartDecision(marker)) return null;
  const attemptId = String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || "").trim();
  const generationRevision = /^hero_attempt:\d+$/.test(attemptId)
    ? Number(attemptId.slice("hero_attempt:".length))
    : 0;
  return heroBudget.make({
    disposition: disposition || (heroStartBinding(marker) ? "job_bound" : "no_provider_job"),
    batchId: String(batchId || "").trim(),
    rowId: String(row.rowId || row.row_id || "").trim(),
    prospectId: String(row.prospectId || row.prospect_id || "").trim(),
    jobId: String(marker.jobId || marker.job_id || "").trim(),
    generationRevision,
  });
}

function durableHeroStartCheckpoint(row = {}, batchId = "", { requireFinal = true } = {}) {
  if (row.heroStartCheckpointed !== true) return false;
  const checked = heroBudget.validate(row.heroStartCheckpoint, {
    batchId,
    rowId: String(row.rowId || row.row_id || "").trim(),
    prospectId: String(row.prospectId || row.prospect_id || "").trim(),
  });
  if (!checked.ok || (requireFinal && !checked.finalized)) return false;
  if (!checked.bound) return requireFinal ? checked.checkpoint.disposition === "no_provider_job" : true;
  const marker = objectOf(row.heroRemaster) || {};
  const attemptId = String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || "").trim();
  return heroStartBinding(marker)
    && checked.checkpoint.jobId === String(marker.jobId || marker.job_id || "").trim()
    && checked.checkpoint.generationRevision === Number(attemptId.slice("hero_attempt:".length));
}

/**
 * A durable row may resume directly at mirrored/gate_passed after a worker
 * restart. The hero marker is therefore permission to continue, not optional
 * metadata. Default-on Line runs require the exact remastered build at both
 * irreversible boundaries; the legacy fallback exists only behind the
 * explicit kill switch.
 */
function verifiedHeroRemaster(row = {}, { requireProof = false } = {}) {
  const marker = row.heroRemaster;
  const buildHash = String(row.buildHash || "");
  const heroHash = String(marker?.buildHash || marker?.build_hash || "");
  const heroJobId = String(marker?.jobId || marker?.job_id || "");
  const rebuildJobId = String(marker?.rebuildJobId || marker?.rebuild_job_id || "");
  const reelUrl = String(marker?.reelUrl || marker?.reel_url || "");
  const completionMode = String(marker?.completionMode || marker?.completion_mode || "");
  const sharedSiteId = String(marker?.sharedSiteId || marker?.shared_site_id || "");
  const sharedReleaseId = String(marker?.sharedReleaseId || marker?.shared_release_id || "");
  const rebuildStatus = String(marker?.rebuildStatus || marker?.rebuild_status || "");
  const releaseEvidence = row.releaseEvidence && typeof row.releaseEvidence === "object"
    ? row.releaseEvidence
    : (row.buildEvidence?.release_evidence && typeof row.buildEvidence.release_evidence === "object"
      ? row.buildEvidence.release_evidence
      : {});
  const nativeProof = releaseEvidence.proofIdentity && typeof releaseEvidence.proofIdentity === "object"
    ? releaseEvidence.proofIdentity
    : (releaseEvidence.proof_identity && typeof releaseEvidence.proof_identity === "object"
      ? releaseEvidence.proof_identity
      : {});
  const nativeShared = releaseEvidence.sharedReleaseEvidence
      && typeof releaseEvidence.sharedReleaseEvidence === "object"
    ? releaseEvidence.sharedReleaseEvidence
    : (releaseEvidence.shared_release_evidence
        && typeof releaseEvidence.shared_release_evidence === "object"
      ? releaseEvidence.shared_release_evidence
      : {});
  const sharedIdentity = deliveryProofIdentity({
    sources: [row.proofIdentity, nativeProof, nativeShared],
    buildHash,
  });
  const sharedVideoSha256 = String(nativeShared.hero_video_sha256 || "").trim().toLowerCase();
  let reelPath = "";
  try { reelPath = new URL(reelUrl).pathname; } catch { /* invalid URL */ }
  const hasSharedCompletionFields = Boolean(completionMode || sharedSiteId || sharedReleaseId);
  const legacyRebuildComplete = !hasSharedCompletionFields
    && rebuildStatus === "done"
    && Boolean(rebuildJobId);
  const sharedReleaseComplete = completionMode === "shared_release"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sharedSiteId)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sharedReleaseId)
    && /^[0-9a-f]{64}$/i.test(buildHash)
    && sharedIdentity.ok === true
    && sharedIdentity.active === true
    && sharedIdentity.proofIdentity.site_id === sharedSiteId
    && sharedIdentity.proofIdentity.release_id === sharedReleaseId
    && sharedIdentity.proofIdentity.build_hash === buildHash
    && nativeShared.evidence_schema === "shared-site-release-evidence-v1"
    && nativeShared.state === "active"
    && /^[0-9a-f]{64}$/.test(sharedVideoSha256)
    && reelPath.endsWith(`/${sharedVideoSha256}.mp4`)
    && !rebuildStatus
    && !rebuildJobId;
  if (!marker
    || marker.required !== true
    || marker.applied !== true
    || marker.ready !== true
    || marker.pending === true
    || marker.hold === true
    || marker.fallback === true
    || String(marker.status || "") !== "done"
    || !heroJobId
    || (!legacyRebuildComplete && !sharedReleaseComplete)
    || !/^https:\/\//i.test(reelUrl)
    || !buildHash
    || !heroHash
    || heroHash !== buildHash) {
    return false;
  }
  if (!requireProof) return true;
  const proof = row.proof_shots || row.captured?.shots;
  const proofHash = String(proof?.build_hash || "");
  const canonicalProof = automaticProofShotRecord(
    { ok: true, shots: proof, results: [] },
    { currentWebsite: row.currentWebsite ?? null },
  );
  return Boolean(canonicalProof) && proofHash === buildHash;
}

function verifiedSandboxStaticHeroFallback(
  row = {}, marker = {}, lane = "", batchId = "", env = process.env, receiptVerified = false,
) {
  const rowId = String(row.rowId || row.row_id || "").trim();
  const adapters = require("./line-adapters");
  const foreignBinding = adapters.foreignStaticHeroJobBinding(marker);
  if (foreignBinding && (!foreignBinding.valid
    || foreignBinding.sha256 !== adapters.foreignStaticHeroJobBindingSha(marker))) return false;
  const checkpointBinding = foreignBinding?.schema === FOREIGN_CHECKPOINT_STATIC_HERO_JOB_BINDING_SCHEMA;
  const expectedForeignReason = checkpointBinding
    ? SANDBOX_FOREIGN_CHECKPOINT_STATIC_HERO_FALLBACK_REASON
    : SANDBOX_FOREIGN_STATIC_HERO_FALLBACK_REASON;
  const markerReason = String(marker.reason || "");
  if ((foreignBinding && markerReason !== expectedForeignReason)
    || (!foreignBinding && markerReason !== SANDBOX_STATIC_HERO_FALLBACK_REASON)) return false;
  if (lane !== "sandbox"
    || receiptVerified !== true
    || marker.staticHeroVerified !== true
    || String(marker.producer || "") !== "openrouter_seedance"
    || !String(marker.jobId || marker.job_id || "").trim()
    || !/^hero_attempt:\d+$/.test(String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || ""))
    || !batchId
    || !rowId
    || String(marker.lineBatchId || marker.line_batch_id || "") !== batchId
    || String(marker.lineRowId || marker.line_row_id || "") !== rowId
    || String(marker.reelUrl || marker.reel_url || "").trim()
    || String(marker.rebuildStatus || marker.rebuild_status || "").trim()
    || String(marker.rebuildJobId || marker.rebuild_job_id || "").trim()
    || String(marker.completionMode || marker.completion_mode || "").trim()
    || String(marker.sharedSiteId || marker.shared_site_id || "").trim()
    || String(marker.sharedReleaseId || marker.shared_release_id || "").trim()) return false;
  const videoReason = String(marker.videoFailureReason || marker.video_failure_reason || "").trim();
  const terminalReason = String(marker.videoTerminalReason || marker.video_terminal_reason || "").trim();
  const attempts = Number(marker.videoAttempts ?? marker.video_attempts);
  const cap = Number(marker.videoAttemptCap ?? marker.video_attempt_cap);
  const expectedCap = heroLeaseAttemptCap(env);
  const exhaustedBy = String(
    marker.videoRetryBudgetExhaustedBy || marker.video_retry_budget_exhausted_by || "",
  ).trim();
  const directOperationalTerminal = terminalReason === videoReason
    && operationalHeroFailureReason(videoReason);
  const watchdogOperationalTerminal = terminalReason === "hero_stale_failure_max_attempts"
    && operationalHeroFailureReason(videoReason)
    && !SANDBOX_OPERATIONAL_HERO_MAX_REASONS.has(videoReason);
  const uncertainCapabilityTerminal = terminalReason === CAPABILITY_NO_CHECKPOINT_REASON
    && videoReason === CAPABILITY_NO_CHECKPOINT_REASON
    && exhaustedBy === CAPABILITY_BUDGET_EXHAUSTED_BY;
  const immutableForeignTerminal = Boolean(foreignBinding)
    && !exhaustedBy
    && String(marker.foreignJobConsumptionReason || marker.foreign_job_consumption_reason || "")
      === (checkpointBinding ? FOREIGN_CHECKPOINT_OBSERVATION_REASON : FOREIGN_HANDLE_CONSUMPTION_REASON)
    && Number.isSafeInteger(attempts)
    && attempts >= 1
    && foreignBinding.prospectId === String(row.prospectId || row.prospect_id || "").trim()
    && foreignBinding.generationRevision === Number(
      String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || "").replace("hero_attempt:", ""),
    )
    && foreignBinding.buildHash === String(row.buildHash || row.build_hash || "").trim().toLowerCase()
    && (foreignBinding.lineBatchId !== batchId || foreignBinding.lineRowId !== rowId);
  if ((!directOperationalTerminal && !watchdogOperationalTerminal)
    || !Number.isSafeInteger(attempts)
    || !Number.isSafeInteger(cap)
    || cap < 1
    || cap !== expectedCap
    || (attempts < cap && !uncertainCapabilityTerminal && !immutableForeignTerminal)
    || (videoReason !== CAPABILITY_NO_CHECKPOINT_REASON && exhaustedBy && !immutableForeignTerminal)
    || (foreignBinding && !immutableForeignTerminal)) return false;

  const previewUrl = String(row.previewUrl || row.preview_url || "").trim();
  const buildHash = String(row.buildHash || row.build_hash || "").trim();
  const evidence = objectOf(
    row.releaseEvidence
    || row.release_evidence
    || row.buildEvidence?.release_evidence
    || row.buildStatus?.release_evidence,
  );
  const signed = signedReleaseEvidence(evidence, previewUrl);
  const ownedBank = require("./line-adapters").completedLineHeroBank(row, {
    current_website: row.currentWebsite || row.current_website || "",
    record: { current_website: row.currentWebsite || row.current_website || "" },
  });
  const brand = objectOf(signed?.checks?.brand);
  const photos = objectOf(brand?.photos);
  const heroVideo = objectOf(brand?.hero_video);
  const heroWash = objectOf(brand?.hero_wash);
  const photoSource = String(heroWash?.photo_source || "").trim();
  const signedPhotoSha = String(heroWash?.photo_sha || "").trim().toLowerCase();
  const signedPhotoUrl = String(heroWash?.photo_url || "").trim();
  const heroPhoto = photoSource === "first_usable_photo"
    ? ownedBank?.photos?.find((photo) => String(photo?.sha256 || "").toLowerCase() === signedPhotoSha
      && String(photo?.url || "") === signedPhotoUrl)
    : pickHeroPhoto(ownedBank);
  const derivedPhotoSource = photoSource === "first_usable_photo"
    ? "first_usable_photo"
    : staticHeroPhotoSource(heroPhoto || {});
  const photoSha = String(heroPhoto?.sha256 || "").trim().toLowerCase();
  const photoUrl = String(heroPhoto?.url || "").trim();
  const bankFingerprint = String(ownedBank?.fingerprint || "").trim().toLowerCase();
  const pagesVerified = Array.isArray(heroWash?.pages_verified)
    ? heroWash.pages_verified.filter((page) => String(page || "").trim())
    : [];
  const supplied = Number(photos?.supplied);
  const usable = Number(photos?.usable);
  const videoPlaced = Number(heroVideo?.placed);
  const headlineContrast = Number(heroWash?.worst_case_contrast);
  const inkFloorContrast = Number(heroWash?.ink_floor_contrast);
  return Boolean(signed)
    && Boolean(ownedBank)
    && /^[a-f0-9]{64}$/.test(photoSha)
    && /^https:\/\//i.test(photoUrl)
    && /^[a-f0-9]{64}$/.test(bankFingerprint)
    && String(signed.build_hash || "").toLowerCase() === buildHash.toLowerCase()
    && String(marker.baseEvidenceSha || marker.base_evidence_sha || "") === String(signed.evidence_sha || "")
    && String(marker.staticHeroPhotoSha256 || marker.static_hero_photo_sha256 || "").toLowerCase() === photoSha
    && String(marker.staticHeroPhotoUrl || marker.static_hero_photo_url || "") === photoUrl
    && String(marker.staticHeroBankFingerprint || marker.static_hero_bank_fingerprint || "").toLowerCase() === bankFingerprint
    && signedPhotoSha === photoSha
    && signedPhotoUrl === photoUrl
    && ["origin", "housed"].includes(String(brand?.media_mode || ""))
    && Number.isSafeInteger(supplied) && supplied >= 1
    && Number.isSafeInteger(usable) && usable >= 1
    && heroVideo?.supplied === false
    && heroVideo?.usable === false
    && Number.isSafeInteger(videoPlaced) && videoPlaced === 0
    && heroWash?.applied === true
    && !String(heroWash.reason || "").trim()
    && VERIFIED_STATIC_HERO_SOURCES.has(photoSource)
    && photoSource === derivedPhotoSource
    && String(marker.staticHeroSource || marker.static_hero_source || "") === photoSource
    && Boolean(String(heroWash.selector || "").trim())
    && pagesVerified.length >= 1
    && Number.isFinite(headlineContrast) && headlineContrast >= 4.5
    && Number.isFinite(inkFloorContrast) && inkFloorContrast >= 4.5;
}

function verifiedHeroFallback(row = {}, {
  requireProof = false,
  requireStaticFallbackProof = false,
  lane = "",
  batchId = "",
  env = process.env,
  staticFallbackReceiptVerified = false,
} = {}) {
  const marker = row.heroRemaster;
  const buildHash = String(row.buildHash || "");
  const heroHash = String(marker?.buildHash || marker?.build_hash || "");
  const reason = String(marker?.reason || "");
  const legacyFallback = new Set([
    "no_scannable_hero_source",
    "hero_source_deferred_to_station",
    "stale_done_line_handle_ignored",
  ]).has(reason);
  // The adapter deliberately turns these enqueue-time refusals into the donor
  // fallback rung when no provider job was ever created. Preserve that narrow
  // contract here without admitting a failed/attempted Seedance job: once a
  // job, attempt, or producer identity exists, the stricter signed/static or
  // remastered boundary below still applies.
  const definitivePreJobFallback = new Set([
    "no_verified_owned_photo",
    "photo_bank_stale_or_missing",
    "producer_not_enabled",
  ]).has(reason)
    && !String(marker.jobId || marker.job_id || "").trim()
    && !String(marker.attemptId || marker.heroAttemptId || marker.hero_attempt_id || "").trim()
    && !String(marker.producer || "").trim();
  const sandboxStaticFallback = [
    SANDBOX_STATIC_HERO_FALLBACK_REASON,
    SANDBOX_FOREIGN_STATIC_HERO_FALLBACK_REASON,
    SANDBOX_FOREIGN_CHECKPOINT_STATIC_HERO_FALLBACK_REASON,
  ].includes(reason)
    && verifiedSandboxStaticHeroFallback(row, marker, lane, batchId, env, staticFallbackReceiptVerified);
  if (!marker
    || marker.required === true
    || marker.fallback !== true
    || marker.ready !== true
    || marker.pending === true
    || marker.hold === true
    || marker.applied === true
    || String(marker.status || "") !== "skipped"
    || (!legacyFallback && !definitivePreJobFallback && !sandboxStaticFallback)
    || !buildHash
    || heroHash !== buildHash) {
    return false;
  }
  if (!requireProof && !(sandboxStaticFallback && requireStaticFallbackProof)) return true;
  const proof = row.proof_shots || row.captured?.shots;
  const proofHash = String(proof?.build_hash || "");
  const canonicalProof = automaticProofShotRecord(
    { ok: true, shots: proof, results: [] },
    { currentWebsite: row.currentWebsite ?? null },
  );
  return Boolean(canonicalProof) && proofHash === buildHash;
}

function heroBoundarySatisfied(row = {}, options = {}) {
  return verifiedHeroRemaster(row, options) || verifiedHeroFallback(row, options);
}

/**
 * processRowPhase(row, context, deps) — perform exactly ONE durable phase.
 *
 * Queue workers call this once, checkpoint the returned row, acknowledge, and
 * publish the next continuation. Keeping the irreversible mirror and render
 * operations in separate deliveries leaves enough time to persist their
 * evidence before Vercel's 300-second ceiling. The legacy in-request runner
 * loops this function until terminal, so both paths share one truth gate.
 */
async function processRowPhase(row, context = {}, deps = {}) {
  const {
    qualify = () => ({ ok: true }),
    mirror,
    prepareHero = (...args) => require("./line-adapters").prepareMirroredHero(...args),
    heroJoinOnly = (...args) => require("./line-adapters").heroJoinOnlyRecheck(...args),
    // SEEDANCE AUTOLANE AT THE SEND BOUNDARY — see the adapter's header. A
    // default-on no-op for rows that already own their hero identity; the one
    // last enqueue attempt for rows whose boundary was satisfied by a fallback.
    ensureHeroAutoline = (...args) => require("./line-adapters").ensureGatePassedHeroAutoline(...args),
    verifyHeroFallbackReceipt = (...args) => require("./line-adapters").verifySandboxStaticHeroFallbackReceipt(...args),
    sourceFacts = () => ({}),
    gate = runRenderGate,
    // LIGHT verification still owes the email its proof shots. Production
    // wires the real captureLineEmailAssets here (the durable worker's
    // phaseDeps and the console's buildDeps); tests inject a fake. Left
    // unwired, a light row captures nothing — the pre-fix behavior.
    captureEmailAssets = null,
    writePreviewUrl = async () => ({ ok: true }),
    queueEmail = async () => ({ ok: true }),
    sendOnFinish = null,
    now = () => new Date().toISOString(),
  } = deps;
  const startHero = typeof deps.startHero === "function" ? deps.startHero : null;
  const lane = context.lane === "live" ? "live" : "sandbox";
  const batchId = String(context.batchId || "").trim();
  const signal = context.signal;
  const seenLogoShas = context.seenLogoShas || new Map();
  const at = () => now();
  const fail = (state, reason, patch = {}) => lineState.advanceRow(row, state, { ...patch, reason, now: at() });
  const staticFallbackReceipt = async (candidate) => {
    if (![SANDBOX_STATIC_HERO_FALLBACK_REASON, SANDBOX_FOREIGN_STATIC_HERO_FALLBACK_REASON,
      SANDBOX_FOREIGN_CHECKPOINT_STATIC_HERO_FALLBACK_REASON]
      .includes(String(candidate?.heroRemaster?.reason || ""))) {
      return { required: false, verified: true };
    }
    return withPhaseDeadline(
      (phaseSignal) => verifyHeroFallbackReceipt(candidate, {
        lane,
        batchId,
        env: deps.env || process.env,
        getHeroReelJobForProspect: deps.getHeroReelJobForProspect,
        select: deps.select,
        signal: phaseSignal,
        deadlineAt: context.deadlineAt,
      }),
      30_000,
      "static_hero_job_receipt",
      signal,
    ).catch(() => ({
      ok: false,
      required: true,
      verified: false,
      retryable: true,
      reason: "static_hero_job_receipt_read_unavailable",
    }));
  };
  const parkStaticReceiptRead = (candidate, receipt) => ({
    ok: true,
    row: {
      ...candidate,
      buildRetryAfter: heroRemasterRetryAt(at()),
      lastRetryableError: String(receipt?.reason || "static_hero_job_receipt_read_unavailable"),
    },
    complete: true,
    phase: "hero_remaster",
  });

  if (!row || !row.status) return { ok: false, row, error: "row_shape_invalid", retryable: false };
  if (terminalRow(row)) return { ok: true, row, complete: true, phase: "terminal" };

  try {
    if (lineState.strandedReadyRow(row)) {
      const rescuedAt = at();
      return {
        ok: true,
        row: {
          ...row,
          status: "mirrored",
          reason: "gate_never_ran",
          updatedAt: rescuedAt,
          history: (Array.isArray(row.history) ? row.history : []).concat([{
            status: "mirrored",
            at: rescuedAt,
            reason: "gate_never_ran",
          }]),
        },
        complete: false,
        phase: "render_gate_recovery",
      };
    }

    if (row.status === "picked") {
      if (row.contractIssue) {
        const out = fail("rejected", row.contractIssue);
        return { ...out, complete: true, phase: "qualify" };
      }
      const certifiedPacket2 = await withPhaseDeadline(
        () => verifiedPacket2Qualification(row, deps),
        Number(deps.qualifyTimeoutMs) > 0 ? Number(deps.qualifyTimeoutMs) : 30_000,
        "certified_packet2_qualification",
        signal,
      ).catch(() => false);
      const verdict = certifiedPacket2 ? { ok: true } : await withPhaseDeadline(
        (phaseSignal) => qualify(row, { lane, batchId, signal: phaseSignal, deadlineAt: context.deadlineAt }),
        Number(deps.qualifyTimeoutMs) > 0 ? Number(deps.qualifyTimeoutMs) : 30_000,
        "qualify",
        signal,
      );
      if (!verdict || verdict.ok !== true) {
        const out = fail("rejected", (verdict && verdict.reason) || "did not qualify");
        return { ...out, complete: true, phase: "qualify" };
      }
      const out = lineState.advanceRow(row, "qualified", { now: at() });
      const checkpoint = out.ok
        ? heroStartCheckpoint(out.row, batchId, {}, "qualified")
        : null;
      if (out.ok) {
        out.row = {
          ...out.row,
          heroStartCheckpointed: Boolean(checkpoint),
          ...(checkpoint ? { heroStartCheckpoint: checkpoint } : {}),
        };
      }
      // Return/snapshot qualified before the idempotent enqueue. A crash here
      // leaves no paid job, and a retry starts from this same durable state.
      return { ...out, complete: false, phase: "qualify" };
    }

    if (row.status === "qualified") {
      if (!mirror) return { ...fail("error", "no mirror builder wired"), complete: true, phase: "mirror" };
      const autoline = heroAutolineEnabled(deps.env || process.env);
      // Both production dispatchers wire startHero. An unwired injected unit
      // call cannot create a queue job, so it keeps its historical behavior.
      if (autoline && startHero && !durableHeroStartCheckpoint(row, batchId)) {
        if (!durableHeroStartCheckpoint(row, batchId, { requireFinal: false })) {
          // Backfill rows qualified by an older deployment. This is another
          // return/snapshot boundary: never combine repair + enqueue.
          const qualificationCheckpoint = heroStartCheckpoint(row, batchId, {}, "qualified");
          const reason = qualificationCheckpoint ? "" : "hero_qualification_checkpoint_identity_missing";
          return {
            ok: true,
            row: {
              ...row,
              heroStartCheckpointed: Boolean(qualificationCheckpoint),
              ...(qualificationCheckpoint ? { heroStartCheckpoint: qualificationCheckpoint } : {}),
              heroStartReason: reason,
              ...(qualificationCheckpoint ? {} : {
                buildRetryAfter: heroRemasterRetryAt(at()),
                lastRetryableError: reason,
              }),
            },
            complete: !qualificationCheckpoint,
            phase: "hero_qualification_checkpoint",
            ...(qualificationCheckpoint ? {} : { retryable: true }),
          };
        }
        // This is prospect-idempotent: a crash after queue commit but before
        // the row CAS reuses the same queue job on the next attempt.
        const hero = await startHero(row, {
          lane,
          batchId,
          env: deps.env || process.env,
          signal,
          deadlineAt: context.deadlineAt,
        });
        const candidate = { ...row, ...(hero?.rowPatch || {}) };
        const checkpoint = hero?.ok === true
          ? heroStartCheckpoint(candidate, batchId, objectOf(candidate.heroRemaster) || {})
          : null;
        const reason = checkpoint
          ? ""
          : String(hero?.reason || "hero_qualification_enqueue_pending");
        return {
          ok: true,
          row: {
            ...candidate,
            heroStartCheckpointed: checkpoint ? true : row.heroStartCheckpointed === true,
            ...(checkpoint ? { heroStartCheckpoint: checkpoint } : {}),
            heroStartReason: reason,
            ...(checkpoint ? {} : {
              buildRetryAfter: heroRemasterRetryAt(at()),
              lastRetryableError: reason,
            }),
          },
          // Persist the exact binding in its own row CAS before Mirror.
          complete: !checkpoint,
          phase: "hero_start_checkpoint",
          ...(checkpoint ? {} : { retryable: true }),
        };
      }
      const operationKey = String(context.operationKey || `${batchId}:${row.prospectId}:mirror`);
      // JOIN-ONLY RECHECK (2026-08-28): a row parked at heroRemaster.pending
      // only needs the hero question re-asked. Re-entering the full mirror
      // pipeline for every ~30s poll rebuilt the entire site each time — the
      // persisted-mirror resume only covers line_gate_passed/line_queued
      // prospects — so pending rows looped on fresh dispatches while their
      // hero jobs sat refused-or-done on the shelf. When the row already
      // carries its build identity (preview + hash), ask the join directly;
      // any doubt falls through to the unchanged full pipeline below.
      let built = null;
      let prepared = null;
      if (row.heroRemaster?.pending === true
        && mirrorBuildIdentityAvailable(row)
        && signedMirrorBuildIdentityAvailable(row)) {
        const recheck = await withPhaseDeadline(
          (phaseSignal) => heroJoinOnly(row, {
            lane,
            batchId,
            env: deps.env || process.env,
            signal: phaseSignal,
            deadlineAt: context.deadlineAt,
          }),
          90_000,
          "hero_recheck",
          signal,
        ).catch(() => ({
          skipped: true,
          retryable: true,
          reason: "hero_recheck_read_unavailable",
        }));
        const recheckReason = String(recheck?.reason || "").trim();
        if (recheck?.retryable === true
          && recheckReason === "hero_recheck_read_unavailable"
          && signedMirrorBuildIdentityAvailable(row)) {
          const pendingHero = heroRemasterRowState(row.heroRemaster || {});
          if (heroPendingIdentity(pendingHero)) {
            return {
              ok: true,
              row: {
                ...row,
                heroRemaster: {
                  ...pendingHero,
                  required: true,
                  ready: false,
                  pending: true,
                  hold: false,
                  reason: recheckReason,
                },
                buildRetryAfter: heroRemasterRetryAt(at()),
                reason: recheckReason,
                lastRetryableError: recheckReason,
              },
              complete: true,
              phase: "hero_remaster",
            };
          }
        }
        if (recheck?.heroRemasterPending === true) {
          const pendingHero = heroRemasterRowState({
            ...(row.heroRemaster || {}),
            ...(recheck.heroRemaster || {}),
          });
          const validHeroPendingIdentity = heroPendingIdentity(pendingHero);
          // An operator-action hold is not a retryable error; the row keeps
          // its reason clean and waits for the operator (no hot loop).
          const operatorHold = validHeroPendingIdentity
            && String(pendingHero.status || "").trim() === "operator_action_required";
          const pendingReason = !validHeroPendingIdentity
            ? "hero_pending_identity_missing"
            : operatorHold ? "" : String(recheck.heroRemaster?.reason || recheck.heroRemaster?.status || "hero_remaster_pending");
          const pendingState = validHeroPendingIdentity
            ? pendingHero
            : {
              ...pendingHero,
              pending: false,
              ready: false,
              hold: true,
              status: "blocked",
              reason: "hero_pending_identity_missing",
            };
          return {
            ok: true,
            row: {
              ...row,
              ...(recheck.rowPatch?.ownedPhotoBank || recheck.rowPatch?.owned_photo_bank
                ? { ownedPhotoBank: recheck.rowPatch.ownedPhotoBank || recheck.rowPatch.owned_photo_bank }
                : {}),
              heroRemaster: pendingState,
              buildRetryAfter: heroRemasterRetryAt(at()),
              reason: pendingReason,
              lastRetryableError: pendingReason,
            },
            complete: true,
            phase: "hero_remaster",
          };
        }
        if (recheck?.heroRemasterHold === true) {
          const out = fail("rejected", recheck.reason || "verified_client_hero_failed", {
            heroRemaster: heroRemasterRowState(recheck.heroRemaster),
          });
          return { ...out, complete: true, phase: "hero_remaster" };
        }
        if (recheck?.ok === true) {
          built = {
            ok: true,
            previewUrl: String(row.previewUrl || "").trim(),
            buildHash: String(row.buildHash || "").trim(),
            currentWebsite: String(row.currentWebsite || ""),
            contentSource: row.contentSource || row.content_source || "",
            buildEvidence: row.buildEvidence || row.build_evidence || null,
            releaseEvidence: row.releaseEvidence || row.release_evidence || null,
            publishedAggregate: row.publishedAggregate || null,
            photoAccounting: row.photoAccounting || row.photo_accounting || null,
            needsFill: row.needsFill === true || row.needs_fill === true,
            truth_packet: row.truth_packet || null,
            ownedPhotoBank: recheck.rowPatch?.ownedPhotoBank
              || recheck.rowPatch?.owned_photo_bank
              || row.ownedPhotoBank
              || row.owned_photo_bank
              || null,
          };
          prepared = { ok: true, heroRemaster: recheck.heroRemaster, rowPatch: recheck.rowPatch };
        }
      }
      if (!built) {
        built = await withPhaseDeadline(
          (phaseSignal) => mirror(row, {
            lane,
            batchId,
            operationKey,
            env: deps.env || process.env,
            mirrorAttemptId: String(row.mirrorDispatch?.attemptId || row.mirrorDispatch?.attempt_id || "").trim(),
            signal: phaseSignal,
            deadlineAt: context.deadlineAt,
          }),
          Number(deps.mirrorTimeoutMs) > 0 ? Number(deps.mirrorTimeoutMs) : MIRROR_TIMEOUT_MS,
          "mirror_build",
          signal,
        );
        if (built?.heroRemasterHold === true) {
          const out = fail("rejected", built.reason || "verified_client_hero_failed", {
            heroRemaster: heroRemasterRowState(built.heroRemaster),
          });
          return { ...out, complete: true, phase: "hero_remaster" };
        }
        if (built?.heroRemasterPending === true) {
          const retryableReason = String(built.heroRemaster?.reason || built.heroRemaster?.status || "hero_remaster_pending");
          const pendingHero = heroRemasterRowState({
            ...(row.heroRemaster || {}),
            ...(built.heroRemaster || {}),
          });
          const validHeroPendingIdentity = heroPendingIdentity(pendingHero);
          // An operator-action hold is not a retryable error; the row keeps
          // its reason clean and waits for the operator (no hot loop).
          const operatorHold = validHeroPendingIdentity
            && String(pendingHero.status || "").trim() === "operator_action_required";
          const pendingReason = !validHeroPendingIdentity
            ? "hero_pending_identity_missing"
            : operatorHold ? "" : retryableReason;
          const durableBuildIdentity = mirrorBuildIdentityAvailable(built);
          const pendingState = validHeroPendingIdentity
            ? pendingHero
            : {
              ...pendingHero,
              pending: false,
              ready: false,
              hold: true,
              status: "blocked",
              reason: "hero_pending_identity_missing",
            };
          return {
            ok: true,
            row: {
              ...row,
              heroRemaster: pendingState,
              buildRetryAfter: heroRemasterRetryAt(at()),
              reason: pendingReason,
              lastRetryableError: pendingReason,
              ...((durableBuildIdentity && String(built.previewUrl || "").trim()) ? {
                previewUrl: String(built.previewUrl).trim(),
                buildHash: String(built.buildHash || "").trim(),
                contentSource: built.contentSource || built.content_source || row.contentSource || "",
                buildEvidence: built.buildEvidence || built.build_evidence || row.buildEvidence || null,
                releaseEvidence: built.releaseEvidence || built.release_evidence || row.releaseEvidence || null,
                currentWebsite: built.currentWebsite || row.currentWebsite || "",
                ownedPhotoBank: built.ownedPhotoBank
                  || built.owned_photo_bank
                  || row.ownedPhotoBank
                  || row.owned_photo_bank
                  || null,
              } : {}),
            },
            complete: true,
            phase: "hero_remaster",
          };
        }
        const builtSystemHold = built?.disposition === "system_hold"
          && built?.lead_rejection === false;
        if (builtSystemHold) {
          const systemHold = objectOf(built.system_hold) || {};
          const reconciliation = objectOf(built.reconciliation)
            || objectOf(systemHold.reconciliation)
            || null;
          const releaseEvidence = objectOf(built.releaseEvidence)
            || objectOf(built.release_evidence)
            || null;
          const dispatchFailure = objectOf(built.dispatchFailure);
          const reason = String(built.reason || built.code || systemHold.code || "mirror_system_hold").trim();
          const postDeployReconciliation = built.provider_attempted === true
            || built.manual_reconciliation_required === true
            || systemHold.manual_reconciliation_required === true
            || systemHold.scope === "mirror_reconciliation";
          const mirrorDispatch = {
            ...(objectOf(row.mirrorDispatch) || {}),
            status: postDeployReconciliation ? "manual_reconciliation_required" : "system_hold_retryable",
            reason,
            disposition: "system_hold",
            lead_rejection: false,
            provider_attempted: postDeployReconciliation,
            manual_reconciliation_required: postDeployReconciliation,
            rebuild_allowed: !postDeployReconciliation,
            ...(dispatchFailure ? { failure: dispatchFailure } : {}),
            ...(reconciliation ? { reconciliation } : {}),
            ...(releaseEvidence ? { release_evidence: releaseEvidence } : {}),
            finishedAt: at(),
          };
          if (!postDeployReconciliation) {
            // Keep the qualified row resumable, but park it behind a durable
            // retry timestamp. This is a system outage, never a lead refusal.
            const retryAt = heroRemasterRetryAt(at());
            return {
              ok: true,
              row: {
                ...row,
                mirrorDispatch,
                buildRetryAttempts: Math.max(Number(row.buildRetryAttempts) || 0, 0) + 1,
                buildRetryAfter: retryAt,
                lastRetryableError: reason,
              },
              complete: true,
              phase: "mirror_system_hold",
              retryable: true,
              disposition: "system_hold",
              lead_rejection: false,
              system_hold: systemHold,
            };
          }

          // The release already crossed the provider/deploy boundary. A
          // terminal system-error row is the Line's non-rebuild/non-send fence;
          // exact release/fleet evidence stays nested for manual reconciliation.
          const parked = fail("error", reason);
          if (parked.ok) {
            parked.row = {
              ...parked.row,
              mirrorDispatch,
              systemHold: {
                disposition: "system_hold",
                lead_rejection: false,
                provider_attempted: true,
                manual_reconciliation_required: true,
                rebuild_allowed: false,
                system_hold: systemHold,
                ...(reconciliation ? { reconciliation } : {}),
                ...(releaseEvidence ? { release_evidence: releaseEvidence } : {}),
              },
            };
          }
          return {
            ...parked,
            complete: true,
            phase: "mirror_reconciliation",
            retryable: false,
            disposition: "system_hold",
            lead_rejection: false,
            provider_attempted: true,
            manual_reconciliation_required: true,
            reconciliation,
            release_evidence: releaseEvidence,
            system_hold: systemHold,
          };
        }
        if (!built || built.ok !== true || !String(built.previewUrl || "").trim()) {
          const dispatchFailure = objectOf(built?.dispatchFailure);
          const lacksBuildIdentity = !mirrorBuildIdentityAvailable(built || {});
          let reason = (built && built.reason) || "mirror build produced no URL";
          if (lacksBuildIdentity && reason === "mirror_build_not_revealable") {
            reason = "mirror_dispatch_failed_before_build";
          }
          const out = fail(built && built.terminal === "rejected" ? "rejected" : "error", reason);
          if (out.ok) {
            out.row = {
              ...out.row,
              mirrorDispatch: {
                ...(objectOf(row.mirrorDispatch) || {}),
                status: lacksBuildIdentity ? "failed_before_build" : "failed",
                reason,
                ...(dispatchFailure ? { failure: dispatchFailure } : {}),
                finishedAt: at(),
              },
            };
          }
          return { ...out, complete: true, phase: "mirror" };
        }
      }
      if (!prepared) {
        prepared = await prepareHero(row, built, {
          lane,
          batchId,
          env: deps.env || process.env,
          signal,
          deadlineAt: context.deadlineAt,
        });
      }
      const preparedHero = prepared?.heroRemaster;
      if (preparedHero?.hold === true) {
        const out = fail("rejected", preparedHero.reason || "verified_client_hero_failed", {
          ...(prepared?.rowPatch || {}),
          heroRemaster: heroRemasterRowState(preparedHero),
        });
        return { ...out, complete: true, phase: "hero_remaster" };
      }
      if (prepared?.pending === true || (preparedHero?.pending === true && preparedHero?.ready !== true)) {
        return {
          ok: true,
          row: {
            ...row,
            previewUrl: String(built.previewUrl || row.previewUrl || ""),
            buildHash: String(built.buildHash || row.buildHash || ""),
            currentWebsite: String(built.currentWebsite || row.currentWebsite || ""),
            publishedAggregate: built.publishedAggregate || null,
            photoAccounting: built.photoAccounting || built.photo_accounting || null,
            contentSource: built.contentSource || built.content_source || row.contentSource || "",
            buildEvidence: built.buildEvidence || built.build_evidence || null,
            releaseEvidence: built.releaseEvidence || built.release_evidence || null,
            ownedPhotoBank: built.ownedPhotoBank || built.owned_photo_bank || null,
            operationKey,
            ...(prepared?.rowPatch || {}),
            heroRemaster: heroRemasterRowState({
              ...(row.heroRemaster || {}),
              ...(preparedHero || prepared || {}),
            }),
            buildRetryAfter: heroRemasterRetryAt(at()),
          },
          complete: true,
          phase: "hero_remaster",
        };
      }

      const proofIdentityState = mirrorProofIdentity(built);
      if (!proofIdentityState.ok) {
        const out = fail("rejected", proofIdentityState.reason);
        return { ...out, complete: true, phase: "mirror", policyHold: true };
      }
      const advanced = lineState.advanceRow(row, "mirrored", { previewUrl: built.previewUrl, now: at() });
      if (!advanced.ok) return { ...advanced, complete: false, phase: "mirror" };
      advanced.row = {
        ...advanced.row,
        buildHash: String(built.buildHash || ""),
        currentWebsite: String(built.currentWebsite || ""),
        publishedAggregate: built.publishedAggregate || null,
        photoAccounting: built.photoAccounting || built.photo_accounting || null,
        contentSource: built.contentSource || built.content_source || row.contentSource || "",
        needsFill: built.needsFill === true || built.needs_fill === true || row.needsFill === true || row.needs_fill === true,
        buildEvidence: built.buildEvidence || built.build_evidence || null,
        releaseEvidence: built.releaseEvidence || built.release_evidence || null,
        truth_packet: built.truth_packet || advanced.row.truth_packet || null,
        ownedPhotoBank: built.ownedPhotoBank || built.owned_photo_bank || null,
        ...(prepared?.rowPatch || {}),

        ...(proofIdentityState.active ? { proofIdentity: proofIdentityState.proofIdentity } : {}),
        mirrorDispatch: {
          ...(objectOf(row.mirrorDispatch) || {}),
          status: "built",
          finishedAt: at(),
          buildHash: String(built.buildHash || ""),
          hasPreview: true,
          hasReleaseEvidence: Boolean(
            objectOf(built.releaseEvidence || built.release_evidence || built.buildEvidence?.release_evidence),
          ),
        },
        // The build's own light/full stamp, if its builder recorded one; the
        // gate phase re-stamps the row from the env it actually ran under.
        ...(built.verification ? { verification: built.verification } : {}),
        operationKey,
      };
      return { ...advanced, complete: false, phase: "mirror" };
    }

    if (row.status === "mirrored") {
      // Persist a row-local explanation of where hero attach is currently broken.
      // This has no decision authority; all existing boundary logic below is unchanged.
      row = {
        ...row,
        heroAttachDiagnostic: heroAttachDiagnostic(row, {
          batchId,
          env: deps.env || process.env,
          startHeroWired: Boolean(startHero),
        }),
      };
      const staticReceipt = await staticFallbackReceipt(row);
      if (staticReceipt?.retryable === true) return parkStaticReceiptRead(row, staticReceipt);
      if (heroAutolineEnabled(deps.env || process.env) && !heroBoundarySatisfied(row, {
        lane,
        batchId,
        env: deps.env || process.env,
        staticFallbackReceiptVerified: staticReceipt?.verified === true,
      })) {
        const out = fail("rejected", "hero_media_requires_fresh_mirror", {
          heroRemaster: heroRemasterRowState({ ...(row.heroRemaster || {}), required: true }),
        });
        return { ...out, complete: true, phase: "hero_remaster" };
      }

      // Heartbeat: record the start of each inspection attempt so jams are
      // visible in the events stream. Fire-and-forget — a failed store write
      // must never block the gate. Callers may inject deps.recordEvent for
      // testing; production uses the module-level store binding.
      const emitEvent = typeof deps.recordEvent === "function" ? deps.recordEvent : recordEvent;
      emitEvent("line.inspection_started", {
        batchId,
        prospectId: String(row.prospectId || ""),
        previewUrl: String(row.previewUrl || ""),
      }).catch(() => {});

      // A mirrored row may resume in a later invocation, after the builder
      // that originally supplied this tuple is gone. Revalidate the durable
      // copy at that boundary so a partial/tampered shared identity cannot
      // enter capture merely because the mirror phase ran on an earlier tick.
      const proofIdentityState = mirrorProofIdentity(row);
      if (!proofIdentityState.ok) {
        const out = fail("rejected", proofIdentityState.reason);
        return { ...out, complete: true, phase: "gate", policyHold: true };
      }
      // GHOST_AGENCY_LIGHT_VERIFICATION — owner directive 2026-09-01: the
      // post-build browser gate is "too heavy — another chef in the kitchen."
      // LIGHT mode does not open the gate's browser at all: no source-fact
      // gathering for it, no 12-fact rendered-DOM read, no capture hook. The
      // verdict is an explicit recorded SKIP — never a forged pass of the
      // twelve facts — and it rides the row so a light site is auditable
      // later. GHOST_AGENCY_LIGHT_VERIFICATION=0 restores the exact full gate.
      const verification = verificationMode(deps.env || process.env);
      let gateResult;
      if (verification === "light") {
        gateResult = {
          pass: true,
          failed: [],
          checks: [],
          blockedBy: "",
          verification: "light",
          skipped: "render_gate_skipped_light_verification",
        };
      } else {
        const source = (await withPhaseDeadline(
          (phaseSignal) => sourceFacts(row, {
            publishedAggregate: row.publishedAggregate || null,
            photoAccounting: row.photoAccounting || null,
            // This phase captures after the verdict, so rebuilt rows declare the
            // same hook as the batch loop instead of requiring input shots.
            postVerdictCapture: true,
            signal: phaseSignal,
            deadlineAt: context.deadlineAt,
          }),
          Number(deps.sourceTimeoutMs) > 0 ? Number(deps.sourceTimeoutMs) : 20_000,
          "source_facts",
          signal,
        )) || {};
        gateResult = await withPhaseDeadline(
          (phaseSignal) => gate({
            url: row.previewUrl,
            source: { ...source, prospect_id: row.prospectId },
            seenLogoShas,
            signal: phaseSignal,
            deadlineAt: context.deadlineAt,
            build: {
              prospectId: row.prospectId,
              buildHash: row.buildHash || "",
              currentWebsite: row.currentWebsite || "",
              ...(proofIdentityState.active
                ? { proofIdentity: proofIdentityState.proofIdentity }
                : {}),
            },
          }),
          Number(deps.gateTimeoutMs) > 0 ? Number(deps.gateTimeoutMs) : GATE_TIMEOUT_MS,
          "render_gate",
          signal,
        );
      }
      const { capture: gateCapture, ...verdict } = gateResult || {};
      const claim = (verdict.checks || []).find((check) => check.fact === "logo_own_and_unique" && check.pass);
      // LIGHT mode keeps the byte-level one-logo-per-client guard when the
      // durable row already carries a verified sha (full-gated rows, resumed
      // evidence). It never invents one.
      const rowLogoSha = /^[a-f0-9]{64}$/.test(String(row.logoSha256 || ""))
        ? String(row.logoSha256).toLowerCase()
        : "";
      const logoSha = (claim && claim.evidence && claim.evidence.sha256)
        || (verification === "light" ? rowLogoSha : undefined) || undefined;
      const owner = logoSha ? seenLogoShas.get(logoSha) : undefined;
      const collides = Boolean(logoSha) && owner !== undefined && owner !== row.prospectId;
      const effective = collides
        ? {
          ...verdict,
          pass: false,
          failed: [...new Set([...(verdict.failed || []), "logo_own_and_unique"])],
          blockedBy: `logo_own_and_unique: this exact logo already shipped for ${owner}`,
          checks: (verdict.checks || []).map((check) => check.fact === "logo_own_and_unique"
            ? { ...check, pass: false, reason: `this exact logo already shipped for ${owner}`, evidence: { ...(check.evidence || {}), collidesWith: owner } }
            : check),
        }
        : verdict;
      const gated = lineState.applyGate(row, effective, { now: at() });
      if (!gated.ok) return { ...gated, complete: false, phase: "gate", logoSha: logoSha || "" };
      if (gated.row.status === "gate_passed" && row.reason === "gate_never_ran") {
        gated.row = { ...gated.row, reason: "" };
      }
      if (logoSha && gated.row.status === "gate_passed") seenLogoShas.set(logoSha, row.prospectId);
      // LIGHT VERIFICATION STILL SHOOTS THE EMAIL'S PROOF (owner fix
      // 2026-08-31). The light skip exists to dodge the HEAVY browser work —
      // the gate's 12-fact rendered read, byte-diff, deep-link audit, route
      // render audit, multi-viewport sweeps, motion loop. The proof shots are
      // not that: without them the classic V3 email refuses every light row at
      // send ("shared_proof_capture_identity_missing") — exactly where
      // production gate_passed rows jammed in email_queue. A light row that
      // PASSED therefore pays one basic capture pass: the same
      // captureLineEmailAssets the full gate's hook calls, motion loop off, on
      // its own chromium from lib/serverless-chromium (the launcher the render
      // gates and the preview probe share). A refused row (logo collision
      // above) never pays. A failed capture is recorded as { ok:false } and
      // never changes the verdict — the full gate's capture contract.
      //
      // The capture dep is production-WIRED, not defaulted here: the durable
      // worker's phaseDeps and the console's buildDeps supply the real
      // captureLineEmailAssets; tests inject a fake. No dep ⇒ no capture
      // attempt and no browser, exactly the pre-fix light behavior.
      let lightCapture = null;
      if (verification === "light" && gated.row.status === "gate_passed"
        && typeof captureEmailAssets === "function") {
        const lightDeadline = Number(context.deadlineAt);
        const captureBudgetMs = Number.isFinite(lightDeadline) && lightDeadline > 0
          ? Math.max(1_000, Math.min(CAPTURE_BUDGET_MS, Math.floor(lightDeadline - Date.now())))
          : CAPTURE_BUDGET_MS;
        try {
          lightCapture = await captureEmailAssets({
            previewUrl: String(row.previewUrl || ""),
            currentWebsite: String(row.currentWebsite || ""),
            buildHash: String(row.buildHash || ""),
            ...(proofIdentityState.active ? { proofIdentity: proofIdentityState.proofIdentity } : {}),
            budgetMs: captureBudgetMs,
            // THE EXTRAS STAY OFF. The proof the email requires is the
            // before/after stills; the motion loop is the heavy extra.
            motion: false,
            environment: deps.env || process.env,
          });
        } catch (e) {
          lightCapture = { ok: false, reason: `capture_threw: ${String(e.message || e).slice(0, 200)}` };
        }
      }
      const gateProofCapture = lightCapture || gateCapture;
      const proofShots = automaticProofShotRecord(gateProofCapture, {
        currentWebsite: row.currentWebsite ?? null,
      });
      gated.row = {
        ...gated.row,
        ...(proofShots ? {
          captured: gateProofCapture,
          // The durable row now carries the canonical line-proof-shots record
          // directly in the same gate tick. Email stages consume this exact
          // shape; `captured` remains for batches created before this law.
          proof_shots: proofShots,
        } : {}),
        ...(logoSha ? { logoSha256: logoSha } : {}),
        // LIGHT vs FULL — on the durable row, so every site this factory
        // ships can be audited for which verification produced it.
        verification,
      };
      return { ...gated, complete: gated.row.status !== "gate_passed", phase: "gate", logoSha: logoSha || "" };
    }

    if (row.status === "gate_passed") {
      // Persist a row-local explanation of where hero attach is currently broken.
      // This has no decision authority; all existing boundary logic below is unchanged.
      row = {
        ...row,
        heroAttachDiagnostic: heroAttachDiagnostic(row, {
          batchId,
          env: deps.env || process.env,
          startHeroWired: Boolean(startHero),
        }),
      };
      const staticReceipt = await staticFallbackReceipt(row);
      if (staticReceipt?.retryable === true) return parkStaticReceiptRead(row, staticReceipt);
      if (heroAutolineEnabled(deps.env || process.env) && !heroBoundarySatisfied(row, {
        lane,
        batchId,
        env: deps.env || process.env,
        staticFallbackReceiptVerified: staticReceipt?.verified === true,
        requireStaticFallbackProof: true,
      })) {
        const out = fail("rejected", "hero_media_requires_fresh_mirror", {
          heroRemaster: heroRemasterRowState({ ...(row.heroRemaster || {}), required: true }),
        });
        return { ...out, complete: true, phase: "hero_remaster" };
      }
      // SEEDANCE AUTOLANE AT THE SEND BOUNDARY (owner directive 2026-09-03).
      // The boundary above was satisfied — most production campaign rows
      // satisfy it with a FALLBACK rung (the definitive pre-job refusal of a
      // bank-less Seedance enqueue), which historically meant the hero question
      // was closed forever and the desktop worker never saw a job. Ask it once
      // more here: idempotent, fail-soft, and named on failure. It can never
      // block, delay, or fail the write/queue/send below — a refused or timed
      // out attempt records `hero_autoline_degraded:<reason>` on the row and
      // the send proceeds on the already-deployed fallback rung as before.
      if (typeof ensureHeroAutoline === "function") {
        const ensured = await withPhaseDeadline(
          (phaseSignal) => ensureHeroAutoline(row, {
            lane,
            batchId,
            env: deps.env || process.env,
            signal: phaseSignal,
            deadlineAt: context.deadlineAt,
          }),
          Number(deps.heroAutolineTimeoutMs) > 0 ? Number(deps.heroAutolineTimeoutMs) : 10_000,
          "hero_autoline_ensure",
          signal,
        ).catch(() => ({
          ok: true,
          ensured: false,
          rowPatch: {
            heroPostSendAutoline: {
              at: at(),
              reason: "hero_autoline_degraded:ensure_failed",
            },
          },
        }));
        const autolinePatch = ensured && typeof ensured === "object" && ensured.rowPatch
          ? ensured.rowPatch
          : null;
        if (autolinePatch && autolinePatch.heroPostSendAutoline) {
          row = { ...row, heroPostSendAutoline: autolinePatch.heroPostSendAutoline };
        }
      }
      const written = await withPhaseDeadline(
        (phaseSignal) => writePreviewUrl(row, row.previewUrl, {
          lane,
          batchId,
          requireCanonicalPolicyCheck: true,
          signal: phaseSignal,
          deadlineAt: context.deadlineAt,
        }),
        Number(deps.writeTimeoutMs) > 0 ? Number(deps.writeTimeoutMs) : 20_000,
        "preview_write",
        signal,
      );
      if (!written || written.ok !== true) {
        if (written && written.retryable === false
          && (written.terminal === "rejected" || written.terminal === "error")) {
          const out = fail(written.terminal, written.reason || "preview_url_write_refused");
          return {
            ...out,
            complete: true,
            phase: "preview_write",
            code: written.code,
            retryable: false,
            ...(written.policyHold === true ? { policyHold: true } : {}),
          };
        }
        const error = Object.assign(new Error((written && written.reason) || "preview_url_write_failed"), {
          code: "line_preview_write_retryable",
          retryable: true,
        });
        throw error;
      }
      const contactReady = row.contactReady === true
        || (row.contactReady !== false && row.hasEmail !== false && Boolean(String(row.email || "").trim()));
      // Sandbox delivery is always to the owner, so a missing prospect email
      // must not stop the proof email. Live delivery remains held until a
      // verified recipient exists.
      if (!contactReady && lane === "live") {
        const out = lineState.advanceRow(row, lineState.ROW_READY, { previewUrl: row.previewUrl, now: at() });
        if (out.ok) out.row = { ...out.row, ...(written.rowPatch || {}), contactReady: false };
        return { ...out, complete: true, phase: "ready" };
      }
      const queueRow = { ...row, ...(written.rowPatch || {}) };
      const queueStaticReceipt = await staticFallbackReceipt(queueRow);
      if (queueStaticReceipt?.retryable === true) return parkStaticReceiptRead(queueRow, queueStaticReceipt);
      if (heroAutolineEnabled(deps.env || process.env) && !heroBoundarySatisfied(queueRow, {
        lane,
        batchId,
        env: deps.env || process.env,
        staticFallbackReceiptVerified: queueStaticReceipt?.verified === true,
        requireStaticFallbackProof: true,
      })) {
        const out = lineState.advanceRow(queueRow, "rejected", {
          reason: "hero_media_requires_fresh_mirror",
          heroRemaster: heroRemasterRowState({ ...(queueRow.heroRemaster || {}), required: true }),
          now: at(),
        });
        return { ...out, complete: true, phase: "hero_remaster" };
      }
      const queued = await withPhaseDeadline(
        (phaseSignal) => queueEmail(queueRow, {
          lane,
          batchId,
          signal: phaseSignal,
          deadlineAt: context.deadlineAt,
        }),
        Number(deps.queueTimeoutMs) > 0 ? Number(deps.queueTimeoutMs) : 20_000,
        "queue_email",
        signal,
      );
      if (!queued || queued.ok !== true) {
        const error = Object.assign(new Error((queued && queued.reason) || "email_queue_failed"), {
          code: "line_queue_write_retryable",
          retryable: true,
        });
        throw error;
      }
      const out = lineState.advanceRow(row, "queued", { previewUrl: row.previewUrl, now: at() });
      if (out.ok) out.row = { ...out.row, ...(written.rowPatch || {}), ...(queued.rowPatch || {}) };
      // SEND-ON-FINISH. The row just reached email_queue with its proof
      // prepared — the exact precondition the settle-send checks. On the
      // sandbox lane (owner-only practice proofs; owner directive 2026-09-01)
      // fire the SAME send routine the batch-settle path uses, right now, and
      // mark the row "sent" so the settle-send and drip see it already-sent and
      // skip. The injected sender carries the provider idempotency key derived
      // from batch+prospect+step, so even a lost checkpoint after a successful
      // provider call cannot double-send: the settle path's retry reuses the
      // same key and the provider dedupes. Everything else — a send refusal, a
      // throw, the live lane, the switch at "0", no sender wired — keeps the
      // historical behavior: the row stays "queued" and the settle-send owns it.
      if (
        out.ok
        && lane === "sandbox"
        && typeof sendOnFinish === "function"
        && sendOnFinishEnabled(deps.env || process.env)
        && lineState.hasPassingGate(out.row)
      ) {
        try {
          const finished = await sendOnFinish(out.row, {
            lane,
            batchId,
            signal,
            deadlineAt: context.deadlineAt,
          });
          if (finished && finished.ok === true) {
            const delivered = lineState.advanceRow(out.row, "sent", { now: at() });
            if (delivered.ok) return { ...delivered, complete: true, phase: "queue" };
          }
        } catch { /* fail-soft: the settle-send still owns this queued row */ }
      }
      return { ...out, complete: true, phase: "queue" };
    }

    return { ok: false, row, error: `row_state_not_resumable:${row.status}`, retryable: false };
  } catch (error) {
    const retryable = error?.retryable === true
      || error?.code === "line_phase_timeout"
      || error?.name === "AbortError";
    return {
      ok: false,
      row,
      error: String((error && error.message) || error).slice(0, 240),
      code: error && error.code,
      retryable,
    };
  }
}

function clampCount(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(n, MAX_COUNT);
}

/** In-process registry. A serverless instance may lose it; events are the log. */
const BATCHES = new Map();

function putBatch(batch) {
  BATCHES.set(batch.batchId, batch);
  // DURABLE MIRROR. This registry is per-lambda, so an operator who starts a
  // run, steps away, and comes back to click Approve can land on a fresh
  // instance and be told "unknown_batch" about a batch that built perfectly.
  // The snapshot is written fire-and-forget: persistence must never slow or
  // fail the run, it only gives recoverBatch() something to find.
  //
  // POINT-IN-TIME COPY, because rows now build CONCURRENTLY. The write above
  // must keep the LIVE object (getBatch has to see a run in progress), but the
  // durable payload is serialised later, inside recordEvent — and by then four
  // sibling rows have moved on. Freezing the row list here makes the stored
  // snapshot the batch as it was when the checkpoint fired, instead of a
  // smear of whenever the write happened to flush. Rows are only ever REPLACED
  // (advanceRow returns a new object), never mutated in place, so a slice of
  // the array is a complete freeze.
  const frozen = { ...batch, rows: (batch.rows || []).slice() };
  Promise.resolve()
    .then(() => recordEvent(BATCH_EVENT, { batchId: batch.batchId, batch: frozen }))
    .catch(() => {});
  return batch;
}

// How often a mid-run batch re-writes its durable snapshot. Small enough that
// a killed run loses at most this much progress, large enough that a 500-row
// batch does not write 500 whole-batch copies into the event log.
const SNAPSHOT_MIN_MS = 15000;
const SNAPSHOT_AT = new Map();

/**
 * snapshotThrottled(batch, clock) — durable mid-run checkpoint.
 *
 * putBatch() is cheap in memory but writes an event every time, so the run
 * loop calls this instead. The FIRST call for a batch always writes: a run
 * that dies on row two must still leave more than the empty creation snapshot.
 */
function snapshotThrottled(batch, deps = {}) {
  const clock = deps.clock || Date.now;
  const at = clock();
  const last = SNAPSHOT_AT.get(batch.batchId);
  if (last !== undefined && at - last < SNAPSHOT_MIN_MS) {
    BATCHES.set(batch.batchId, batch);
    return false;
  }
  SNAPSHOT_AT.set(batch.batchId, at);
  putBatch(batch);
  return true;
}

/**
 * recoverBatch(batchId) -> batch | null
 *
 * Only called when the in-process lookup misses. Rehydrates from the durable
 * snapshot and puts it back in the registry, so the operator's Approve click
 * works on any instance instead of 404-ing.
 */
async function recoverBatch(batchId, deps = {}) {
  const read = deps.selectRows || selectRows;
  const id = String(batchId || "").trim();
  if (!id) return null;
  const live = BATCHES.get(id);
  if (live) return live;

  const snapshotOf = (row) => {
    const payload = row && row.payload;
    return payload && payload.batchId === id && payload.batch && payload.batch.batchId === id
      ? payload.batch
      : null;
  };
  const seat = (batch) => { BATCHES.set(id, batch); return batch; };

  // ASK FOR THIS BATCH, NOT FOR THE NEWEST 40 OF EVERYTHING.
  //
  // This used to read the newest 40 line.batch events and look for the id —
  // the same fixed-window mistake listBatchesDurable already had beaten out of
  // it: ONE chatty batch (every send checkpoints the whole batch) fills any
  // fixed window. Measured on production, 2026-08-11, during the owner's first
  // approve-all on /campaigns: the sweeper had settled six batches moments
  // apart, the overnight run had stacked snapshots on top, and approve
  // answered 404 unknown_batch for the two whose settle snapshots sat past
  // position 40 — then every campaign that DID send buried the next one
  // deeper, so a third 404'd mid-run. The store can filter on the payload id
  // (PostgREST json arrow, store.selectRows passes it through); use it and
  // the freshest snapshot for this batch comes back in one bounded read.
  try {
    const res = await read("ghost_agency_events", {
      filter: `type=eq.${encodeURIComponent(BATCH_EVENT)}&payload->>batchId=eq.${encodeURIComponent(id)}`,
      order: "created_at.desc",
      limit: 1,
    });
    for (const row of (res && (res.rows || res.data)) || []) {
      const batch = snapshotOf(row);
      if (batch) return seat(batch);
    }
  } catch { /* store shims that cannot filter on payload fall through */ }

  // BELT AND BRACES: a store that rejects (or silently ignores) the payload
  // filter still recovers — page backwards exactly like listBatchesDurable,
  // stop at the first snapshot of this batch. Bounded: a few extra reads on a
  // miss, never an unbounded crawl.
  const PAGE = 200;
  const MAX_PAGES = 8;
  let before = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let rows = [];
    try {
      const res = await read("ghost_agency_events", {
        filter: `type=eq.${encodeURIComponent(BATCH_EVENT)}`
          + (before ? `&created_at=lt.${encodeURIComponent(before)}` : ""),
        order: "created_at.desc",
        limit: PAGE,
      });
      rows = (res && (res.rows || res.data)) || [];
    } catch { break; /* a recovery miss is a 404, same as before */ }
    if (!rows.length) break;
    for (const row of rows) {
      const batch = snapshotOf(row);
      if (batch) return seat(batch);
    }
    const oldest = rows[rows.length - 1];
    const cursor = oldest && oldest.created_at;
    if (!cursor || cursor === before) break;
    before = cursor;
  }
  return null;
}
function getBatch(batchId) {
  return BATCHES.get(String(batchId || "")) || null;
}
function listBatches() {
  return [...BATCHES.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

/**
 * listBatches, but hydrated from the durable event log first.
 *
 * WHY (owner, 2026-08-07): "the stuff in the dashboard disappeared in the first
 * place, and I don't know where all the sites went." He was right, and they had
 * not gone anywhere — putBatch() writes every batch snapshot to
 * ghost_agency_events, but listBatches() read only the in-memory Map. On
 * Vercel a cold lambda starts with an empty Map, so the console showed only
 * batches created by THAT instance and the durable history was invisible.
 * recoverBatch() could already resurrect one batch BY ID; nothing ever listed
 * them.
 *
 * Newest snapshot per batchId wins (putBatch rewrites on settle and on send,
 * and the query is created_at.desc, so the first snapshot seen per id is the
 * freshest). Live in-memory batches still take precedence over their own
 * stored snapshots — memory is ahead of the log mid-run.
 */
async function listBatchesDurable(deps = {}) {
  const read = deps.selectRows || selectRows;
  const want = Number(deps.distinct) > 0 ? Number(deps.distinct) : 12;
  const out = new Map();
  // ONE NOISY BATCH MUST NOT ERASE THE HISTORY.
  //
  // This read used to take the newest 120 snapshots and stop. Every checkpoint
  // writes a snapshot — and a single active batch writes them by the hundred
  // (progress ticks, plus one per send since the double-send fix) — so ONE run
  // fills the whole window and every older batch disappears from the console.
  // Measured on production: 200 snapshots in the log, ONE distinct batchId,
  // while two finished sites sat queued in a batch the operator could no
  // longer see or approve. He reported it as "I don't know what these other
  // batches are" and "nothing is happening".
  //
  // So page backwards until we have enough DISTINCT batches, not enough rows.
  // Bounded hard: a chatty log costs a few extra reads, never an unbounded
  // crawl, and any read failure keeps whatever was already collected.
  const PAGE = 200;
  const MAX_PAGES = 8;
  let before = "";
  for (let page = 0; page < MAX_PAGES && out.size < want; page += 1) {
    let rows = [];
    try {
      const res = await read("ghost_agency_events", {
        filter: `type=eq.${encodeURIComponent(BATCH_EVENT)}`
          + (before ? `&created_at=lt.${encodeURIComponent(before)}` : ""),
        order: "created_at.desc",
        limit: PAGE,
      });
      rows = (res && (res.rows || res.data)) || [];
    } catch { break; /* store unreachable: keep the memory-only view */ }
    if (!rows.length) break;
    for (const row of rows) {
      const batch = row && row.payload && row.payload.batch;
      if (batch && batch.batchId && !out.has(batch.batchId)) out.set(batch.batchId, batch);
    }
    const oldest = rows[rows.length - 1];
    const cursor = oldest && oldest.created_at;
    if (!cursor || cursor === before) break;
    before = cursor;
  }
  for (const live of BATCHES.values()) out.set(live.batchId, live);
  return [...out.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}
function resetBatches() {
  BATCHES.clear();
  SNAPSHOT_AT.clear();
}

// ---------------------------------------------------------------------------
// THE STOP BUTTON, ON THE INSIDE
// ---------------------------------------------------------------------------
// Setting the delivery pause used to stop the NEXT thing the line did, never
// the thing it was already doing. lib/email.js re-reads the flag at every send,
// so live prospect mail did stop mid-batch — but startBatch never read it at
// all, and sendApprovedBatch only checked once, at the route boundary in
// api/admin/line.js. A fifty-site run that started going wrong therefore ran to
// completion, kept spending, and kept queueing, while the operator watched.
//
// haltGate() is ONE shared reader for both loops. It is checked BETWEEN rows,
// never inside one: a mirror already deploying finishes (a Vercel deploy cannot
// be un-fired, and a row abandoned mid-mutation is exactly the state the
// durable snapshot exists to prevent) and an email already handed to the
// provider finishes. Everything that has not started does not start. That is
// the honest promise, and it is the one the console prints.
//
// ONLY A POSITIVELY KNOWN PAUSE HALTS. deliveryPauseStatus() reports
// {active:true, known:false} when the store cannot be READ, which is the right
// fail-closed answer for a SEND — and every send gate still treats it that way,
// untouched. Building is not sending: it reaches nobody. Halting every build in
// the world on a transient Supabase blip would be a self-inflicted outage, so
// this gate wants an actual operator pause event: active AND known.
const HALT_CHECK_TTL_MS = 2000;

function haltGate(deps = {}) {
  const read = deps.readPause || deliveryPauseStatus;
  const clock = deps.clock || Date.now;
  let cachedAt = -Infinity;
  let cached = null;
  // Cached briefly because the build pool runs five rows at once and each check
  // is a store round trip. A stop that lands within two seconds is a stop.
  return async function halted() {
    const at = clock();
    if (cached && at - cachedAt < HALT_CHECK_TTL_MS) return cached;
    let pause;
    try {
      pause = await read();
    } catch {
      pause = null;
    }
    const stop = Boolean(pause && pause.active === true && pause.known === true);
    cached = stop
      ? { halt: true, reason: String((pause && pause.reason) || "operator_pause") }
      : { halt: false, reason: "" };
    cachedAt = at;
    return cached;
  };
}

/** The wording the console shows, so the operator reads one sentence, not two. */
function haltMessage(reason) {
  return `Halted by the operator stop switch${reason ? `: ${reason}` : ""}. Rows that had not started were never built; nothing from this batch can be approved or sent until you resume.`;
}

/**
 * startBatch — creates the batch and runs every row to a terminal state
 * (`queued` or a failure). Returns the batch; it is NOT sent.
 *
 * Rows run CONCURRENTLY in a bounded pool (see DEFAULT_BUILD_CONCURRENCY). The
 * refusals above are per-row and unchanged: concurrency changes how long a
 * batch takes, never which rows are allowed through.
 *
 * deps:
 *   pick(target, count)   -> [{prospectId, businessName, city, state, vertical, email, ...}]
 *   qualify(row)          -> {ok, reason}
 *   mirror(row)           -> {ok, previewUrl, reason}
 *   sourceFacts(row, {publishedAggregate}) -> the client's OWN verified facts
 *                            for the gate. publishedAggregate is the star
 *                            rating the build just published and which
 *                            observation it came from.
 *   gate({url, source, seenLogoShas}) -> gate verdict
 *   writePreviewUrl(row, url) -> {ok, reason}
 *   queueEmail(row)       -> {ok, reason}
 *   onProgress(batch)     -> called after every row transition
 *   concurrency           -> how many rows build at once; default is
 *                            GHOST_AGENCY_BUILD_CONCURRENCY, then 10. Injectable
 *                            so a test can pin serial order without an env var.
 *   budgetMs              -> wall-clock this invocation allows itself to keep
 *                            claiming NEW rows. 0 (the default) means no budget:
 *                            behaves exactly as before, one call builds the
 *                            whole batch. Above 0, the worker pool stops
 *                            claiming once Date.now()-startedAt >= budgetMs,
 *                            leaves the rest of the rows "picked", marks the
 *                            batch "building" and returns {building:true,
 *                            remaining}. A row already in flight always finishes.
 *   startedAt             -> the ms epoch the budget is measured from
 *                            (defaults to now). api/admin/line passes Date.now().
 *
 * RESUME. request.batchId names an EXISTING batch (status "building" or
 * "running") to continue instead of mining a fresh one: its rows are reused,
 * only the ones still "picked" get built, and seenLogoShas is re-seeded from the
 * rows that already queued so the one-logo-per-client guard survives across
 * invocations. This is how a 500-row Mine finishes across as many ~230s calls
 * as it needs without ever exceeding the platform's 300s function ceiling.
 */
async function startBatch(request = {}, deps = {}) {
  const {
    pick,
    qualify = () => ({ ok: true }),
    startHero = (...args) => require("./line-adapters").startQualifiedHero(...args),
    mirror,
    prepareHero = (...args) => require("./line-adapters").prepareMirroredHero(...args),
    sourceFacts = () => ({}),
    gate = runRenderGate,
    writePreviewUrl = async () => ({ ok: true }),
    queueEmail = async () => ({ ok: true }),
    onProgress = () => {},
    now = () => new Date().toISOString(),
    newId = () => `line_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    // Injectable so a test can drive the throttle without waiting real seconds.
    snapshot = (b) => snapshotThrottled(b, { clock: deps.clock }),
    // The operator's stop switch, read between rows. See haltGate above.
    haltCheck = haltGate({ clock: deps.clock }),
  } = deps;

  // If the gate has been weakened, nothing runs. A broken gate must stop the
  // line, not quietly pass rows through it.
  assertGateIntegrity();

  // THE BUILD BUDGET. Zero (the default every test passes) means "no budget" —
  // the worker pool never stops on the clock and the whole batch builds in one
  // call, exactly as before. Above zero, the pool stops claiming NEW rows once
  // the wall-clock runs out and hands the rest back as "building".
  const budgetMs = Number.isFinite(Number(deps.budgetMs)) && Number(deps.budgetMs) > 0 ? Number(deps.budgetMs) : 0;
  const budgetClock = deps.budgetClock || Date.now;
  const startedAtMs = Number.isFinite(Number(deps.startedAt)) ? Number(deps.startedAt) : budgetClock();

  // RESUME AN EXISTING BATCH, or mine a fresh one. The console re-POSTs
  // {action:"start", batchId} while a batch is still "building"; that names the
  // batch to continue here so its rows are reused instead of a new mine.
  let batch = null;
  // ALREADY TERMINAL ON A PRIOR PASS. Intermediate states are deliberately NOT
  // skipped: a killed worker may have durably reached qualified, mirrored, or
  // gate_passed, and the next worker must continue from that exact phase.
  const preBuilt = new Set();
  const capturePreBuilt = () => (batch.rows || []).forEach((r, i) => {
    if (terminalRow(r)) preBuilt.add(i);
  });
  const continueId = String(request.batchId || "").trim();
  if (continueId) {
    const existing = getBatch(continueId) || await recoverBatch(continueId, deps);
    if (existing && (existing.status === "queued" || existing.status === "building" || existing.status === "running")) {
      batch = existing;
      BATCHES.set(batch.batchId, batch);
    }
  }

  if (!batch) {
    const count = clampCount(request.count);
    if (!count) return { ok: false, error: "count_required", message: "Choose 50, 100 or 500. Nothing ran." };

    batch = putBatch(lineState.newBatch({
      batchId: newId(),
      lane: request.lane,
      target: request.target || "",
      requested: count,
      now: now(),
      pickState: "pending",
    }));

    if (!pick) {
      batch.status = "halted";
      batch.haltReason = "no_prospect_source";
      onProgress(batch);
      return { ok: false, batchId: batch.batchId, error: "no_prospect_source" };
    }

    let picked = [];
    try {
      batch.pickState = "picking";
      batch.status = "running";
      picked = await withPhaseDeadline(
        (phaseSignal) => pick({
          target: request.target,
          count,
          lane: batch.lane,
          signal: phaseSignal,
          deadlineAt: deps.deadlineAt,
        }),
        Number(deps.pickTimeoutMs) > 0 ? Number(deps.pickTimeoutMs) : 120_000,
        "pick",
        deps.signal,
      );
    } catch (e) {
      batch.status = "halted";
      batch.haltReason = `pick_failed: ${String(e.message || e).slice(0, 160)}`;
      onProgress(batch);
      return { ok: false, batchId: batch.batchId, error: "pick_failed", message: batch.haltReason };
    }

    batch.mineFunnel = (picked && picked.funnel) || null;
    batch.rows = (picked || []).slice(0, count).map((p) => ({
      ...lineState.newRow({ ...p, now: now() }),
      qualification: p.qualification,
      proof: p.proof,
      brand_evidence: p.brand_evidence,
      contractIssue: p.contractIssue,
      leadminerQualified: p.leadminerQualified === true,
      durableUpdatedAt: p.durableUpdatedAt,
      hasEmail: Boolean(p.email || p.hasEmail),
      // Carry the pick-side contact verdict ONLY when the pick pipeline
      // actually computed one. `p.contactReady === true` here turned "no
      // verdict" into a false verdict, which forced every verdict-less pick
      // — including rows with a real email — down the ROW_READY (no-email)
      // branch at the build step, and a fully-built batch could then never
      // be approved. Without a verdict, the build step's own derivation
      // (email present + hasEmail !== false) decides.
      ...(p.contactReady === undefined ? {} : { contactReady: p.contactReady === true }),
    }));
    batch.pickState = "complete";
    capturePreBuilt(); // rows are all "picked" here — nothing pre-built
    onProgress(batch);
    await Promise.resolve(snapshot(batch, { phase: "pick_complete" }));
  } else {
    // Continuing: the batch is building again, not frozen. Snapshot which rows
    // were already built BEFORE announcing, then announce so the console's
    // progress strip advances and the sweeper's stale clock resets.
    capturePreBuilt();
    batch.status = "running";
    onProgress(batch);
  }

  // sha256 -> prospectId, so "unique per client" is enforced ACROSS the batch,
  // not just against history. RE-SEEDED on resume from every row whose claim
  // is durable — gate_passed, ready, queued, AND sent, matching the statuses
  // seedLogoClaims uses — so a crash right after the gate checkpoint cannot
  // lose a claim that a later row would then be allowed to duplicate.
  const seenLogoShas = new Map();
  for (const r of batch.rows || []) {
    if (!r || !["gate_passed", "ready", "queued", "sent"].includes(String(r.status || ""))) continue;
    const claim = r.gate && Array.isArray(r.gate.checks)
      ? r.gate.checks.find((c) => c.fact === "logo_own_and_unique" && c.pass)
      : null;
    const sha = String((claim && claim.evidence && claim.evidence.sha256) || r.logoSha256 || "").trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(sha)) seenLogoShas.set(sha, r.prospectId);
  }

  /**
   * runRow(i) — one lead, start to terminal state.
   *
   * This was the body of a `for` loop. Every refusal path left it by `continue`;
   * as a function they leave by `return`, and there were NINE of them:
   * contract issue, did-not-qualify, the qualified transition, no mirror
   * builder, mirror produced nothing, the mirrored transition, gate refusal,
   * preview_url write failure, email queue failure. A missed one would not
   * throw — it would quietly build a row the line had already refused.
   *
   * Row i is the only writer of batch.rows[i]. Nothing here reads a sibling
   * row, so the only shared state is seenLogoShas (claimed atomically below)
   * and the batch object itself (whole-object replacement, never in-place).
   */
  const runRow = async (i) => {
    // ONLY BUILD ROWS AN EARLIER PASS DID NOT. On a fresh batch preBuilt is
    // empty, so this is a no-op. On a RESUME the rows a previous invocation
    // already carried to terminal are skipped untouched — the budget path
    // leaves unbuilt work as "picked", and those are what this pass builds.
    if (preBuilt.has(i)) return;

    // Canonical phase dispatcher. It checkpoints after EACH transition, not
    // merely when the whole row finishes, so qualified/mirrored/gate_passed are
    // real recovery points. The older inline implementation remains below as a
    // historical proof of the refusal ordering, but this block always returns
    // before reaching it.
    {
      if (terminalRow(batch.rows[i])) {
        if (!batch.rows[i].reason) {
          batch.rows[i] = { ...batch.rows[i], reason: `row_already_terminal:${batch.rows[i].status}` };
          onProgress(batch);
          await Promise.resolve(snapshot(batch, { rowIndex: i, row: batch.rows[i], phase: "terminal_conflict" }));
        }
        return;
      }
      let turns = 0;
      while (!terminalRow(batch.rows[i]) && turns < 6) {
        turns += 1;
        const advanced = await processRowPhase(batch.rows[i], {
          lane: batch.lane,
          batchId: batch.batchId,
          seenLogoShas,
        }, {
          qualify,
          startHero,
          mirror,
          prepareHero,
          ensureHeroAutoline: deps.ensureHeroAutoline,
          sourceFacts,
          gate,
          captureEmailAssets: deps.captureEmailAssets,
          writePreviewUrl,
          queueEmail,
          sendOnFinish: deps.sendOnFinish,
          now,
          env: deps.env || process.env,
        });
        if (!advanced.ok) {
          // The legacy synchronous endpoint cannot hand a lease back to a queue.
          // Preserve its historical terminal behavior; the durable queue worker
          // uses processRowPhase directly and leaves retryable states untouched.
          const rawReason = String(advanced.error || "phase failed").slice(0, 200);
          const legacyReason = batch.rows[i].status === "qualified" && !advanced.code
            ? `row_error: ${rawReason}`
            : rawReason;
          const failed = lineState.advanceRow(batch.rows[i], "error", {
            reason: legacyReason,
            now: now(),
          });
          if (failed.ok) batch.rows[i] = failed.row;
          else batch.rows[i] = { ...batch.rows[i], reason: advanced.error || batch.rows[i].reason };
          onProgress(batch);
          await Promise.resolve(snapshot(batch, { rowIndex: i, row: batch.rows[i], phase: advanced.phase || "error" }));
          return;
        }
        batch.rows[i] = advanced.row;
        onProgress(batch);
        if (terminalRow(batch.rows[i]) && !advanced.complete && !batch.rows[i].reason) {
          batch.rows[i] = { ...batch.rows[i], reason: `row_already_terminal:${batch.rows[i].status}` };
          onProgress(batch);
        }
        await Promise.resolve(snapshot(batch, { rowIndex: i, row: batch.rows[i], phase: advanced.phase }));
        if (advanced.complete || terminalRow(batch.rows[i])) return;
      }
      if (!terminalRow(batch.rows[i])) {
        const failed = lineState.advanceRow(batch.rows[i], "error", {
          reason: "row_error: phase progression exceeded its safety bound",
          now: now(),
        });
        if (failed.ok) batch.rows[i] = failed.row;
        onProgress(batch);
        await Promise.resolve(snapshot(batch, { rowIndex: i, row: batch.rows[i], phase: "error" }));
      }
      return;
    }
    const set = (result) => {
      if (result.ok) batch.rows[i] = result.row;
      else batch.rows[i] = { ...batch.rows[i], reason: result.error || batch.rows[i].reason };
      onProgress(batch);
      return result.ok;
    };
    const failRow = (reason) => set(lineState.advanceRow(batch.rows[i], "error", { reason, now: now() }));

    try {
      // ---- QUALIFY (before any spend) -------------------------------------
      if (batch.rows[i].contractIssue) {
        set(lineState.advanceRow(batch.rows[i], "rejected", { reason: batch.rows[i].contractIssue, now: now() }));
        return; // (1/9) contract incomplete
      }
      const q = await qualify(batch.rows[i]);
      if (!q || q.ok !== true) {
        set(lineState.advanceRow(batch.rows[i], "rejected", { reason: (q && q.reason) || "did not qualify", now: now() }));
        return; // (2/9) did not qualify
      }
      if (!set(lineState.advanceRow(batch.rows[i], "qualified", { now: now() }))) return; // (3/9)

      // ---- MIRROR ----------------------------------------------------------
      if (!mirror) { failRow("no mirror builder wired"); return; } // (4/9)
      const built = await withTimeout(mirror(batch.rows[i], { lane: batch.lane }), MIRROR_TIMEOUT_MS, "mirror_build");
      if (!built || built.ok !== true || !String(built.previewUrl || "").trim()) {
        const reason = (built && built.reason) || "mirror build produced no URL";
        if (built && built.terminal === "rejected") {
          set(lineState.advanceRow(batch.rows[i], "rejected", { reason, now: now() }));
        } else {
          failRow(reason);
        }
        return; // (5/9) mirror produced nothing usable
      }
      const proofIdentityState = mirrorProofIdentity(built);
      if (!proofIdentityState.ok) {
        set(lineState.advanceRow(batch.rows[i], "rejected", {
          reason: proofIdentityState.reason,
          now: now(),
        }));
        return;
      }
      // The URL is a CANDIDATE. It is not written anywhere until the gate passes.
      const mirrored = lineState.advanceRow(batch.rows[i], "mirrored", { previewUrl: built.previewUrl, now: now() });
      // WHAT THIS BUILD IS, carried on the row. `buildHash` identifies the
      // deployed bytes and `currentWebsite` is the "before" half of the email's
      // comparison; the gate's capture hook keys the proof shots on the first
      // and shoots the second, and the SEND path reads both back to decide
      // whether it already has current pictures. advanceRow copies the row
      // wholesale on every later transition, so setting them here is enough.
      if (mirrored.ok) {
        mirrored.row.buildHash = String(built.buildHash || "");
        mirrored.row.currentWebsite = String(built.currentWebsite || "");
        mirrored.row.releaseEvidence = built.releaseEvidence || built.release_evidence || null;
        mirrored.row.truth_packet = built.truth_packet || mirrored.row.truth_packet || null;
        mirrored.row.ownedPhotoBank = built.ownedPhotoBank || built.owned_photo_bank || null;

        if (proofIdentityState.active) mirrored.row.proofIdentity = proofIdentityState.proofIdentity;
      }
      if (!set(mirrored)) return; // (6/9)

      // ---- RENDER GATE (not skippable) ------------------------------------
      // The build's own live reading of the star rating travels with the row
      // into the gate's source facts. Without it the gate re-reads the FROZEN
      // contract and refuses a page whose numbers are fresher than its
      // reference — see sourceFactsFor. The build's PHOTO accounting rides the
      // same road so the gate's owned_photos_retained fact can compare placed
      // against banked on the same build it just rendered.
      const source = (await sourceFacts(batch.rows[i], {
        publishedAggregate: built.publishedAggregate || null,
        photoAccounting: built.photoAccounting || null,
        // THE LINE ALWAYS SHOOTS AFTER THE VERDICT. The post-verdict capture
        // hook below runs for every row on this path — fresh OR re-built — so
        // the side_by_side fact's rebuild branch must not demand input shots
        // here: the same hook that covers a fresh build covers this one.
        // Paths with no hook (api/admin/rebuild-mirror) still fail closed.
        postVerdictCapture: true,
      })) || {};
      const gateResult = await withTimeout(gate({
        url: batch.rows[i].previewUrl,
        source: { ...source, prospect_id: batch.rows[i].prospectId },
        seenLogoShas,
        // NOT A GATE INPUT — no fact reads it. It is what a capture hook needs
        // to key what it stores while the gate's browser is still open. See
        // runRenderGate's `build` and `capture` parameters.
        build: {
          prospectId: batch.rows[i].prospectId,
          buildHash: batch.rows[i].buildHash || "",
          currentWebsite: batch.rows[i].currentWebsite || "",
          ...(Object.prototype.hasOwnProperty.call(batch.rows[i], "proofIdentity")
            ? { proofIdentity: batch.rows[i].proofIdentity }
            : {}),
        },
      }), GATE_TIMEOUT_MS, "render_gate");

      // THE VERDICT AND THE PICTURES ARE TWO DIFFERENT THINGS.
      //
      // The gate's verdict is attached to the row as evidence and travels into
      // every durable snapshot; whatever the capture hook produced does too,
      // but on its own field. Splitting them here keeps the eight-fact verdict
      // exactly the object it has always been — no capture payload inside
      // row.gate, and no copy of it written twice into the batch event log.
      const { capture: gateCapture, ...verdict } = gateResult || {};

      // ---- CLAIM THE LOGO — ATOMIC, NO `await` UNTIL THE `set` BELOW -------
      //
      // The gate reads seenLogoShas and refuses a logo another client already
      // shipped. Serially that read and the write below were adjacent. In a
      // pool they are separated by the gate's own network round trip, so two
      // rows can both read "unseen", both pass, and both ship the SAME logo to
      // two different clients. That is not theoretical — it is the exact defect
      // the uniqueness check exists to stop.
      //
      // So the claim is re-checked and taken HERE, in one run of synchronous
      // statements. JavaScript is single-threaded: with no `await` between the
      // get and the set, no sibling row can interleave, and exactly one row can
      // own a sha. A loser is refused with the same fact and the same wording
      // the gate itself would have used, and its verdict is rewritten so the
      // console's per-fact strip shows logo_own_and_unique FAILING rather than
      // an all-green gate on a blocked row.
      const shippedSha = ((verdict && verdict.checks) || []).find((c) => c.fact === "logo_own_and_unique" && c.pass);
      const sha = shippedSha && shippedSha.evidence && shippedSha.evidence.sha256;
      const owner = sha ? seenLogoShas.get(sha) : undefined;
      const collides = Boolean(sha) && owner !== undefined && owner !== batch.rows[i].prospectId;
      const reason = collides
        ? `this exact logo already shipped for ${owner} — one logo cannot belong to two clients`
        : "";
      const effective = collides
        ? {
          ...verdict,
          pass: false,
          failed: [...new Set([...(verdict.failed || []), "logo_own_and_unique"])],
          blockedBy: `logo_own_and_unique: ${reason}`,
          checks: (verdict.checks || []).map((c) => (c.fact === "logo_own_and_unique"
            ? { ...c, pass: false, reason, evidence: { ...(c.evidence || {}), collidesWith: owner } }
            : c)),
        }
        : verdict;

      const gated = lineState.applyGate(batch.rows[i], effective, { now: now() });
      if (!set(gated) || batch.rows[i].status !== "gate_passed") return; // (7/9) gate refused
      if (sha) seenLogoShas.set(sha, batch.rows[i].prospectId);
      // WHATEVER THE GATE CAPTURED WHILE ITS BROWSER WAS OPEN, carried to the
      // send. The runner does not know or care what it is; it is opaque data
      // that travels with the row (and into the durable snapshot, so an Approve
      // on a cold lambda still has it). Absent is normal — no capture hook was
      // wired, or the capture failed — and the send path falls back.
      if (gateCapture && gateCapture.ok === true) {
        const proofShots = automaticProofShotRecord(gateCapture, {
          currentWebsite: batch.rows[i].currentWebsite ?? null,
        });
        if (proofShots) {
          batch.rows[i] = {
            ...batch.rows[i],
            captured: gateCapture,
            proof_shots: proofShots,
          };
        }
        // RECORD THE FOUR COMPARATIVE SHOT URLS ON THE GATE'S OWN EVIDENCE.
        //
        // The side_by_side_captured fact passes a fresh build on the promise
        // that the post-verdict hook shoots the set (old/old-mobile/new/
        // new-mobile — exactly the four the fact names). When that hook
        // succeeds, its URLs are written into that check's evidence here, so
        // the row's gate record carries the before/after proof it promised.
        // EVIDENCE ONLY: the verdict and every pass boolean are frozen above;
        // this can add a URL, never flip a fact.
        const shots = (gateCapture && gateCapture.shots) || {};
        const publicUrlOf = (variant) => {
          const hit = ((gateCapture && gateCapture.results) || [])
            .find((r) => r && r.variant === variant && r.ok === true && r.publicUrl);
          return hit ? String(hit.publicUrl) : "";
        };
        const four = {
          source_desktop: publicUrlOf("old") || String(shots.old_captured_url || ""),
          source_mobile: publicUrlOf("old-mobile") || String(shots.old_mobile_captured_url || ""),
          build_desktop: publicUrlOf("new") || String(shots.new_captured_url || ""),
          build_mobile: publicUrlOf("new-mobile") || String(shots.new_mobile_captured_url || ""),
        };
        const gate = batch.rows[i].gate;
        if (gate && Array.isArray(gate.checks)) {
          batch.rows[i] = {
            ...batch.rows[i],
            gate: {
              ...gate,
              checks: gate.checks.map((c) => (c && c.fact === "side_by_side_captured" && (!c.evidence || !c.evidence.shots)
                ? { ...c, evidence: { ...(c.evidence || {}), shots: four, captured_by: "post_verdict_hook" } }
                : c)),
            },
          };
        }
      }
      // ---- end atomic section ---------------------------------------------

      // ---- WRITE preview_url, then QUEUE the email -------------------------
      const written = await writePreviewUrl(batch.rows[i], batch.rows[i].previewUrl, { lane: batch.lane, batchId: batch.batchId });
      if (!written || written.ok !== true) { failRow((written && written.reason) || "preview_url write failed"); return; } // (8/9)

      const queued = await queueEmail(batch.rows[i], { lane: batch.lane, batchId: batch.batchId });
      if (!queued || queued.ok !== true) { failRow((queued && queued.reason) || "email queue failed"); return; } // (9/9)

      set(lineState.advanceRow(batch.rows[i], "queued", { previewUrl: batch.rows[i].previewUrl, now: now() }));
    } catch (e) {
      failRow(`row_error: ${String(e.message || e).slice(0, 200)}`);
    } finally {
    // SNAPSHOT AS WE GO, not only at the end.
    //
    // The settle-time putBatch below is unreachable for any run the platform
    // kills first, and a real run is exactly that long: the ten-mirror batch
    // line_msijhqud_7f085bf9 (2026-08-07) built eleven mirrors, queued four of
    // them, and outlived its own request — the gateway returned an error page
    // and the ONLY durable snapshot left was the empty one written at
    // creation. The console then showed a batch with zero rows for a run whose
    // sites were live and queued in the store. That is precisely the "where
    // did all the sites go" the durable list was added to answer, arriving
    // through a door that fix did not cover.
    //
    // Throttled: a snapshot carries the whole batch, so a 500-row run must not
    // write 500 copies of itself. One every SNAPSHOT_MIN_MS, and the settle
    // write below always closes the book.
    //
    // IN `finally`, DELIBERATELY. Every refusal path in this row leaves via an
    // early `return`, which jumps straight past the end of the block — so a
    // plain call here checkpointed only the rows that succeeded, and a batch
    // whose rows all failed would have checkpointed nothing at all. The
    // operator most needs the durable record of the run that went wrong.
    //
    // Under the pool the throttle now COLLAPSES the burst of sibling rows that
    // land together into one durable write, which is the behaviour we want:
    // one checkpoint per wave rather than one per row.
      snapshot(batch);
    }
  };

  // ---- THE POOL ------------------------------------------------------------
  //
  // Rows were run one at a time, which meant a ten-lead batch spent ten
  // consecutive Vercel deploys — about ten minutes — with the machine idle.
  // Workers pull from one shared cursor, so the pool is self-levelling: a row
  // that refuses in milliseconds frees its worker for the next lead instead of
  // holding a lane, and a slow deploy delays only itself.
  //
  // Dispatch is in index order and the cursor is read-and-incremented
  // synchronously, so rows still START in order; only their finishing order is
  // free. Nothing downstream depends on completion order — batchCounts()
  // derives from batch.rows on demand and batchSettled() runs after every
  // worker has drained.
  const concurrency = Math.min(
    buildConcurrency(deps.concurrency !== undefined ? deps.concurrency : process.env[BUILD_CONCURRENCY_ENV]),
    Math.max(batch.rows.length, 1),
  );

  // A row cannot reject — runRow catches its own body and only `snapshot` can
  // throw past it. If one does, let the in-flight siblings finish and settle
  // their rows before the error leaves startBatch: half-written rows abandoned
  // mid-mutation are exactly the state the durable snapshot exists to prevent.
  let fatal = null;
  let cursor = 0;
  let haltedReason = "";
  let budgetSpent = false;
  // THE BUILD BUDGET, BETWEEN ROWS. Zero means never (see budgetMs above).
  const overBudget = () => budgetMs > 0 && budgetClock() - startedAtMs >= budgetMs;
  const worker = async () => {
    while (cursor < batch.rows.length) {
      // Stop claiming NEW rows once the wall-clock is spent. A row already in
      // flight in a sibling worker finishes; this worker simply leaves. The
      // rows past the cursor stay "picked" and become the next call's work.
      if (overBudget()) { budgetSpent = true; return; }
      const index = cursor;
      cursor += 1;
      // THE STOP SWITCH, BETWEEN ROWS. Claiming the index first keeps the
      // read-and-increment synchronous, so rows still START in order; a worker
      // that finds the line halted simply drops the row it claimed and leaves,
      // and the row stays exactly where it was — "picked", never built.
      const stop = await haltCheck();
      if (stop && stop.halt === true) {
        if (!haltedReason) haltedReason = stop.reason || "operator_pause";
        return;
      }
      try {
        await runRow(index);
      } catch (e) {
        if (!fatal) fatal = e;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (fatal) throw fatal;

  // BUDGET RAN OUT WITH WORK LEFT. Hand the batch back as "building": the rows
  // still "picked" are untouched and will be built by the next invocation the
  // console fires with this batchId. A halt takes precedence — a deliberate
  // stop is not the same as running out of clock — so it is checked first.
  // budgetMs=0 can never set budgetSpent, so this whole branch is dead for the
  // one-shot path every existing test drives.
  const remainingUnbuilt = (batch.rows || []).filter((r) => lineState.rowResumable(r)).length;
  if (!haltedReason && budgetSpent && remainingUnbuilt > 0) {
    batch.status = "building";
    // NO settledAt: the batch is not finished, and the sweeper's stale clock
    // reads the freshest row stamp, not this.
    putBatch(batch);
    onProgress(batch);
    return { ok: true, building: true, remaining: remainingUnbuilt, batchId: batch.batchId, batch };
  }

  if (haltedReason) {
    // A halted batch is DELIBERATELY not approvable: approveBatch() demands a
    // settled batch and this one has rows that never ran. The operator pressed
    // stop; sites already built stay built and stay unsent.
    batch.status = "halted";
    batch.haltReason = haltMessage(haltedReason);
    batch.settledAt = now();
    putBatch(batch);
    onProgress(batch);
    return {
      ok: true,
      halted: true,
      haltReason: batch.haltReason,
      batchId: batch.batchId,
      batch,
    };
  }

  batch.status = lineState.batchSettled(batch) ? "awaiting_approval" : "running";
  batch.settledAt = now();
  // RE-SNAPSHOT THE FINISHED BATCH.
  //
  // putBatch wrote the durable copy once, at CREATION — status "running", zero
  // rows, nothing built. Every row that built afterwards existed only in this
  // lambda's memory, so an operator returning on a fresh instance recovered an
  // EMPTY batch and could not approve the sites he had just watched build. The
  // longer the run, the more certain the loss: a 50-site batch outlives the
  // request that started it by definition.
  putBatch(batch);
  onProgress(batch);
  return { ok: true, batchId: batch.batchId, batch };
}

/**
 * sendApprovedBatch — the ONLY send path.
 * Refuses unless approveBatch() has already stamped an operator approval, and
 * re-asserts that every row it is about to touch carries a PASSING gate.
 */
// SENDING IS RESUMABLE, BECAUSE ONE INVOCATION CANNOT HOLD IT.
// This used to walk every approved row in a single call. Each send re-captures
// before/after proof shots through Chromium, which on a cold lambda costs tens
// of seconds per prospect, so a four-row batch ran past the 300s function
// ceiling and returned 504 having sent NOTHING — the rows stayed queued and the
// operator got an error instead of email. Now each call sends what it can
// inside `budgetMs` (and at most `limit` rows), leaves the rest queued, and
// reports `remaining` so the caller can simply call again. A batch finishes
// across as many invocations as it needs.
async function sendApprovedBatch(batchId, deps = {}) {
  const {
    send,
    now = () => new Date().toISOString(),
    onProgress = () => {},
    limit = 0,
    budgetMs = 0,
    startedAt = Date.now(),
    // Same stop switch the build loop reads. api/admin/line.js already refuses
    // to START a pass while the line is paused; this is what stops a pass that
    // was ALREADY running when the operator pressed it.
    haltCheck = haltGate({ clock: deps.clock }),
  } = deps;
  const batch = getBatch(batchId);
  if (!batch) return { ok: false, error: "unknown_batch" };

  lineState.assertSendAuthorized(batch);
  const targets = lineState.sendableRows(batch);
  if (!targets.length) return { ok: false, batchId, error: "nothing_approved_to_send" };
  if (!send) return { ok: false, batchId, error: "no_sender_wired" };

  batch.status = "sending";
  onProgress(batch);

  let sent = 0;
  let processed = 0;
  const failures = [];
  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : Infinity;
  const budget = Number.isFinite(Number(budgetMs)) && Number(budgetMs) > 0 ? Number(budgetMs) : Infinity;
  let haltedReason = "";
  for (const row of targets) {
    // Stop BEFORE starting a send we cannot finish. Checking after the fact
    // would leave a half-run send racing the platform's own kill.
    if (processed >= cap) break;
    if (Date.now() - startedAt >= budget) break;
    // THE STOP SWITCH, BETWEEN EMAILS. Same reason as the build loop: an email
    // already at the provider cannot be recalled, but the next one has not left
    // yet. Rows not reached stay "queued" and the batch stays "approved", so a
    // resume picks up exactly where the stop landed.
    const stop = await haltCheck();
    if (stop && stop.halt === true) {
      haltedReason = stop.reason || "operator_pause";
      break;
    }
    processed += 1;
    const index = batch.rows.findIndex((r) => r.prospectId === row.prospectId);
    try {
      const result = await send(row, { lane: batch.lane, batchId: batch.batchId });
      if (result && result.ok === true) {
        const advanced = lineState.advanceRow(batch.rows[index], "sent", { now: now() });
        if (advanced.ok) batch.rows[index] = advanced.row;
        sent += 1;
        // PERSIST THE MOMENT IT IS TRUE, NOT AT THE END OF THE LOOP.
        // A send that already reached a prospect is an irreversible fact, and
        // it was only being written after every row finished. When the first
        // batch ran past the function ceiling, the platform killed the
        // invocation and took the record with it: the rows stayed "queued", the
        // next pass sent them AGAIN, and Cooper Perry got the same email twice.
        // In the sandbox lane that lands twice in the owner's inbox; against a
        // real prospect it is a duplicate cold email, which is the one mistake
        // this whole line is built to avoid. Writing per row costs one store
        // round-trip and makes a killed invocation cost at most the row that
        // was actually in flight.
        try { putBatch(batch); } catch { /* a failed checkpoint must not undo a real send */ }
      } else {
        failures.push({ prospectId: row.prospectId, reason: (result && result.reason) || "send_refused" });
      }
    } catch (e) {
      failures.push({ prospectId: row.prospectId, reason: String(e.message || e).slice(0, 160) });
    }
    onProgress(batch);
  }
  // Only "done" when nothing approved is still waiting. A partial pass stays
  // approved so the next call picks up exactly where this one stopped.
  // Count the ROWS, not sendableRows(): that helper gates on
  // batch.status === "approved" and the batch is "sending" right here, so it
  // reports 0 every time and a partial pass would flip itself to done and
  // strand whatever it had not reached.
  const remaining = (batch.rows || []).filter((r) => r.status === "queued").length;
  batch.status = remaining > 0 ? "approved" : "done";
  batch.sentAt = now();
  // Same reason as the settle snapshot: the record of what was actually SENT
  // must not live only in the instance that sent it.
  putBatch(batch);
  onProgress(batch);
  return {
    ok: true,
    batchId,
    sent,
    attempted: processed,
    queued: targets.length,
    remaining,
    failures,
    ...(haltedReason
      ? {
        halted: true,
        haltReason: `Stopped by the operator stop switch${haltedReason ? `: ${haltedReason}` : ""}. ${sent} email(s) had already gone out; ${remaining} row(s) are still queued and were not sent.`,
      }
      : {}),
  };
}

module.exports = {
  LAUNCH_SIZES,
  MAX_COUNT,
  DEFAULT_BUILD_CONCURRENCY,
  DEFAULT_GATE_TIMEOUT_MS,
  GATE_TIMEOUT_MS,
  MAX_BUILD_CONCURRENCY,
  BUILD_CONCURRENCY_ENV,
  buildConcurrency,
  clampCount,
  haltGate,
  haltMessage,
  HALT_CHECK_TTL_MS,
  processRowPhase,
  terminalRow,
  withPhaseDeadline,
  startBatch,
  sendApprovedBatch,
  sendOnFinishEnabled,
  SEND_ON_FINISH_SWITCH,
  getBatch,
  recoverBatch,
  // putBatch is internal; exposed so recovery can be proven without a network.
  __testables: { putBatch, snapshotThrottled, SNAPSHOT_MIN_MS },
  putBatch,
  snapshotThrottled,
  SNAPSHOT_MIN_MS,
  listBatches,
  listBatchesDurable,
  resetBatches,
};
