"use strict";

// Lease watchdog for ghost_agency_hero_reel_jobs (operator "skeleton DNA"
// option 1). A dead worker stops renewing its 60-minute lease; without this
// cron the job holds its slot forever and the row parks on hero_remaster
// pending — the exact silent stall of 2026-08-26/27. This sweep requeues
// running jobs whose lease expired beyond a grace window, or fails them for
// owner attention once they exhaust their attempts. CAS-guarded on the exact
// lease token, owner, expiry, and liveness timestamp so a worker that renews
// between select and update is never raced.

const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const { conditionalUpdate, select } = require("../../lib/store");
const {
  HERO_REEL_JOBS_TABLE,
  capabilityGrantForJob,
} = require("../../lib/hero-reel-job-queue");
const {
  heroJobCapabilityLeaseOwner,
  sha256Opaque,
} = require("../../lib/hero-job-capability");

const GRACE_MS = Math.max(60_000, Number(process.env.GHOST_AGENCY_HERO_LEASE_GRACE_MS) || 10 * 60_000);
const MAX_ATTEMPTS = Math.max(1, Number(process.env.GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS) || 3);
const SWEEP_LIMIT = Math.max(1, Math.min(50, Number(process.env.GHOST_AGENCY_HERO_LEASE_SWEEP_LIMIT) || 10));
// A generate-capability worker heartbeats every five minutes by default. Four
// missed heartbeats are enough to prove that the one-shot launcher is gone,
// while staying comfortably beyond the normal request/persist windows. This
// is intentionally shorter than the 60-minute capability lease: an abandoned
// claim with no durable provider checkpoint must not hold a Practice row for
// ~70 minutes, and it must never be requeued because provider spend is then
// unknowable. Operators may lengthen this without a deploy.
const CAPABILITY_STALE_MS = Math.max(
  12 * 60_000,
  Number(process.env.GHOST_AGENCY_HERO_CAPABILITY_STALE_MS) || 20 * 60_000,
);
const CAPABILITY_NO_CHECKPOINT_REASON = "hero_capability_unrenewed_no_checkpoint";
// Failure classes worth one more try under newer code/conditions. Clip
// dimension bounds were RELAXED on main (#450–#454), so jobs that died under
// the old bounds are safe to retry; submit/download failures are transient
// provider conditions. Truth refusals (no_verified_owned_real_scene etc.)
// are DATA verdicts — requeueing them would loop against the same evidence.
const RETRYABLE_FAILURE_REASONS = new Set([
  "clip_dimensions_out_of_range",
  "openrouter_submit_failed",
  "openrouter_download_failed",
  "boomerang_ffmpeg_missing",
  "boomerang_ffmpeg_timeout",
  "seedance_clip_transcode_unavailable",
  "seedance_clip_transcode_timeout",
  "seedance_clip_transcode_failed",
  "seedance_clip_transcode_empty",
  "seedance_transcode_clip_too_large",
  "seedance_transcode_output_invalid",
  "seedance_transcode_output-invalid",
]);
// Transport-level failures arrive with dynamic reason strings (e.g.
// "write_EPROTO_..._SSL_routines_tls_validate_record_header_wrong_version_number")
// — match by pattern, not exact value. These are network conditions, not data.
const RETRYABLE_FAILURE_PATTERNS = [/EPROTO/i, /SSL/i, /ECONNRESET/i, /ETIMEDOUT/i, /ENOTFOUND/i];
// Keep this fail-closed allowlist aligned with the safe provider categories
// emitted by hero-seedance-runner's sanitizedOpenRouterFailure. Raw provider
// strings and unknown fields must never become watchdog recovery authority.
const OPENROUTER_FAILURE_TYPES = new Set([
  "authentication", "permission_denied", "payment_required", "rate_limit_exceeded",
  "provider_overloaded", "provider_unavailable", "invalid_request", "invalid_prompt",
  "not_found", "precondition_failed", "payload_too_large", "unprocessable",
  "content_policy_violation", "refusal", "invalid_image", "image_too_large",
  "image_too_small", "unsupported_image_format", "image_not_found",
  "image_download_failed", "server", "timeout", "unmapped",
]);

function isRetryableFailure(reason) {
  if (RETRYABLE_FAILURE_REASONS.has(reason)) return true;
  return RETRYABLE_FAILURE_PATTERNS.some((pattern) => pattern.test(reason));
}
const STALE_FAILURE_MS = Math.max(5 * 60_000, Number(process.env.GHOST_AGENCY_HERO_STALE_FAILURE_MS) || 30 * 60_000);

function failureReason(job) {
  const result = job.result && typeof job.result === "object" ? job.result : {};
  return String(result.reason || "");
}

function exactRejectedFrameImagesSubmission(job) {
  if (!job || typeof job !== "object"
    || String(job.status || "") !== "failed"
    || String(job.producer || "") !== "openrouter_seedance"
    || String(job.lease_token || "").trim()
    || String(job.lease_owner || "").trim()
    || String(job.lease_expires_at || "").trim()) return false;
  const result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
    ? job.result
    : {};
  const failure = result.provider_failure
    && typeof result.provider_failure === "object"
    && !Array.isArray(result.provider_failure)
    ? result.provider_failure
    : {};
  const checkpoint = result.provider_checkpoint
    && typeof result.provider_checkpoint === "object"
    && !Array.isArray(result.provider_checkpoint)
    ? result.provider_checkpoint
    : {};
  const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? job.payload
    : {};
  const revision = Number(payload.generation_revision);
  const requiredFailureKeys = ["http_status", "operation", "parameter", "provider", "schema_version"];
  const allowedFailureKeys = new Set([...requiredFailureKeys, "error_type"]);
  const failureKeys = Object.keys(failure);
  const exactFailureKeys = requiredFailureKeys.every((key) => Object.prototype.hasOwnProperty.call(failure, key))
    && failureKeys.every((key) => allowedFailureKeys.has(key));
  const safeOptionalErrorType = !Object.prototype.hasOwnProperty.call(failure, "error_type")
    || OPENROUTER_FAILURE_TYPES.has(failure.error_type);
  return result.reason === "openrouter_submit_failed"
    && exactFailureKeys
    && safeOptionalErrorType
    && failure.schema_version === "wss.openrouter_failure.v1"
    && failure.provider === "openrouter"
    && failure.operation === "video_submit"
    && failure.parameter === "frame_images"
    && Number(failure.http_status) === 400
    && checkpoint.schema_version === "wss.hero.seedance_provider_checkpoint.v1"
    && checkpoint.submission_state === "submitting"
    && checkpoint.polling_url === ""
    && !Object.prototype.hasOwnProperty.call(checkpoint, "provider_job_id")
    && String(checkpoint.job_id || "") === String(job.job_id || "")
    && String(checkpoint.prospect_id || "") === String(job.prospect_id || "")
    && Number.isSafeInteger(revision)
    && revision >= 1
    && Number(checkpoint.generation_revision) === revision;
}

function exactUnrenewedCapabilityClaim(job, nowMs, staleMs = CAPABILITY_STALE_MS) {
  if (!job || typeof job !== "object" || String(job.status || "") !== "running") return null;
  const grant = capabilityGrantForJob(job);
  const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? job.payload
    : {};
  const lineHandle = payload.line_handle && typeof payload.line_handle === "object"
    ? payload.line_handle
    : {};
  const leaseToken = String(job.lease_token || "").trim();
  const leaseOwner = String(job.lease_owner || "").trim();
  const leaseExpiresAt = String(job.lease_expires_at || "").trim();
  const updatedAt = String(job.updated_at || "").trim();
  const updatedMs = Date.parse(updatedAt);
  const redeemedMs = Date.parse(String(grant?.redeemed_at || ""));
  const attempts = Number(job.attempts ?? job.attempt_count);
  const resultAbsent = job.result === null || job.result === undefined;
  if (!grant
    || grant.phase !== "generate"
    || grant.job_id !== String(job.job_id || "").trim()
    || grant.prospect_id !== String(job.prospect_id || "").trim()
    || grant.producer !== String(job.producer || "").trim()
    || Number(payload.generation_revision) !== grant.generation_revision
    || String(lineHandle.batchId || "").trim() !== grant.batch_id
    || String(lineHandle.rowId || "").trim() !== grant.row_id
    || !Number.isSafeInteger(attempts)
    || attempts !== grant.attempt + 1
    || !grant.redemption_sha256
    || !grant.redeemed_at
    || !grant.redeemed_lease_sha256
    || !leaseToken
    || leaseOwner !== heroJobCapabilityLeaseOwner(grant)
    || grant.redeemed_lease_sha256 !== sha256Opaque(leaseToken)
    || !Number.isFinite(Date.parse(leaseExpiresAt))
    || !Number.isFinite(updatedMs)
    || !Number.isFinite(redeemedMs)
    || updatedMs < redeemedMs
    || nowMs - updatedMs < staleMs
    || !resultAbsent
    || job.finished_at) return null;
  return {
    grant,
    attempts,
    leaseToken,
    leaseOwner,
    leaseExpiresAt,
    updatedAt,
  };
}

// Pure decision core so the policy is unit-testable without a database.
function watchdogVerdict(job, nowMs, {
  graceMs = GRACE_MS,
  maxAttempts = MAX_ATTEMPTS,
  staleFailureMs = STALE_FAILURE_MS,
  capabilityStaleMs = CAPABILITY_STALE_MS,
} = {}) {
  if (!job || typeof job !== "object") return { action: "skip", reason: "job_invalid" };
  const status = String(job.status || "");
  // The table column is `attempts` (see the queue lib's insert shape).
  const attempts = Number(job.attempts ?? job.attempt_count) || 0;
  if (status === "running") {
    // A provider checkpoint is the paid-boundary recovery authority. Never
    // let the generic expired-lease branch clear it with result:null: the
    // queue/runner can reclaim a validated intent/accepted checkpoint without
    // another submit, while malformed evidence must stay fail-closed.
    if (job.result?.provider_checkpoint && typeof job.result.provider_checkpoint === "object") {
      return { action: "wait", reason: "hero_provider_checkpoint_preserved" };
    }
    const abandonedCapability = exactUnrenewedCapabilityClaim(job, nowMs, capabilityStaleMs);
    if (abandonedCapability) {
      // Do not requeue this state. The launcher vanished before any durable
      // provider checkpoint, so another submit could double-charge if the
      // first process crossed the paid boundary before dying. Consume the
      // remaining safety budget without claiming extra provider attempts.
      return {
        action: "fail",
        reason: CAPABILITY_NO_CHECKPOINT_REASON,
        exhaustedReason: CAPABILITY_NO_CHECKPOINT_REASON,
        attemptCap: maxAttempts,
        attempts,
        preserveAttempts: true,
        retryBudgetExhaustedBy: "provider_spend_uncertain",
        capabilityClaim: abandonedCapability,
      };
    }
    const leaseExpires = Date.parse(String(job.lease_expires_at || ""));
    if (!Number.isFinite(leaseExpires)) {
      // A running job with no lease expiry is a lost settle: the worker died
      // between the status write and the lease write (the 08-28 immortal
      // zombie — rows pended hero "running" for hours while the worker
      // claimed nothing and the expired-lease query never saw the row). No
      // lease means no owner can heartbeat it back; grace on the job's own
      // updated_at liveness signal, then requeue (or fail at the cap).
      const updatedAt = Date.parse(String(job.updated_at || ""));
      if (Number.isFinite(updatedAt) && nowMs - updatedAt < graceMs) {
        return { action: "wait", reason: "no_lease_expiry_inside_grace" };
      }
      if (attempts + 1 >= maxAttempts) {
        return {
          action: "fail",
          reason: "hero_lost_settle_max_attempts",
          exhaustedReason: "hero_lost_settle_max_attempts",
          attemptCap: maxAttempts,
          attempts,
        };
      }
      return { action: "requeue", reason: "hero_lost_settle_requeue", attempts };
    }
    if (nowMs - leaseExpires < graceMs) return { action: "wait", reason: "inside_grace_window" };
    if (attempts + 1 >= maxAttempts) {
      return {
        action: "fail",
        reason: "hero_lease_expired_max_attempts",
        exhaustedReason: "hero_lease_expired_max_attempts",
        attemptCap: maxAttempts,
        attempts,
      };
    }
    return { action: "requeue", reason: "hero_lease_expired_requeue", attempts };
  }
  if (status === "failed") {
    // OpenRouter's exact frame_images 400 receipt proves the request was
    // rejected before provider acceptance. Preserve this immutable terminal
    // record for the Line sandbox fallback; requeueing would erase the proof
    // and replay a source the provider deterministically refused.
    if (exactRejectedFrameImagesSubmission(job)) {
      return { action: "skip", reason: "hero_rejected_frame_images_receipt_preserved" };
    }
    // A row still pending its hero while its only job sits in a terminal
    // failure is the eternal-pend jam of 08-27: rows showed "hero: queued"
    // while the underlying job was dead. Requeue retryable failure classes
    // once they have gone stale, capped by the same attempt budget.
    const rawFailureReason = failureReason(job);
    if (!isRetryableFailure(rawFailureReason)) {
      return { action: "skip", reason: "failure_not_retryable" };
    }
    const updatedAt = Date.parse(String(job.updated_at || ""));
    if (Number.isFinite(updatedAt) && nowMs - updatedAt < staleFailureMs) {
      return { action: "wait", reason: "failure_not_stale_yet" };
    }
    if (attempts + 1 >= maxAttempts) {
      return {
        action: "fail",
        reason: "hero_stale_failure_max_attempts",
        exhaustedReason: rawFailureReason,
        attemptCap: maxAttempts,
        attempts,
      };
    }
    return { action: "requeue", reason: "hero_stale_failure_requeue", attempts };
  }
  return { action: "skip", reason: "not_running" };
}

function createHeroLeaseWatchdogHandler(dependencies = {}) {
  const requireCronFn = dependencies.requireCron || requireCron;
  const methodGuardFn = dependencies.methodGuard || methodGuard;
  const sendJsonFn = dependencies.sendJson || sendJson;
  const selectFn = dependencies.selectFn || select;
  const updateFn = dependencies.conditionalUpdate || conditionalUpdate;
  const eventFn = dependencies.eventFn || null;
  const tableName = dependencies.tableName || HERO_REEL_JOBS_TABLE;
  const nowFn = dependencies.nowFn || Date.now;
  const parentBatchStatusFn = typeof dependencies.parentBatchStatus === "function"
    ? dependencies.parentBatchStatus
    : null;

  async function parentBatchGate(job) {
    const batchId = String(job?.payload?.line_handle?.batchId || job?.payload?.line_handle?.batch_id || "").trim();
    if (!batchId) return { ok: true, halted: false };
    let value;
    try {
      value = parentBatchStatusFn
        ? await parentBatchStatusFn(batchId, { job })
        : await selectFn("ghost_agency_line_batches", `?select=status&batch_id=eq.${encodeURIComponent(batchId)}&limit=1`);
    } catch {
      return { ok: false, halted: false };
    }
    if (typeof value === "boolean") return { ok: true, halted: value };
    if (typeof value === "string") return { ok: true, halted: value === "halted" };
    if (value && typeof value === "object" && typeof value.halted === "boolean") {
      return { ok: value.ok !== false, halted: value.halted };
    }
    const rows = value?.ok === true && Array.isArray(value.data) ? value.data : [];
    return rows.length === 1 && String(rows[0]?.status || "").trim()
      ? { ok: true, halted: String(rows[0].status) === "halted" }
      : { ok: false, halted: false };
  }

  return async function heroLeaseWatchdogHandler(req, res) {
    if (!methodGuardFn(req, res, ["GET", "POST"])) return;
    if (!requireCronFn(req, res)) return;

    const nowMs = Number.isFinite(dependencies.nowMs) ? dependencies.nowMs : nowFn();
    let jobs = [];
    try {
      // Independent sweep queries. A single unordered `or` query with a
      // LIMIT lets the oldest non-retryable failures fill the window and
      // starve the retryable jobs behind them (the 08-28 head-of-line bug:
      // Bill Houston/HOU sat 21h stale while ten legacy refusals consumed
      // every scan). Query the exact actionable classes instead.
      const cutoff = encodeURIComponent(new Date(nowMs - GRACE_MS).toISOString());
      const stale = encodeURIComponent(new Date(nowMs - STALE_FAILURE_MS).toISOString());
      const capabilityStale = encodeURIComponent(new Date(nowMs - CAPABILITY_STALE_MS).toISOString());
      // Third arm: running jobs with NO lease at all. `lease_expires_at=lt.`
      // never matches NULL, so a worker that died between the status write
      // and the lease write produced an immortal zombie the other two
      // queries could not see (08-28: rows pended "running" for hours).
      const runningExpiredQ = `?select=*&status=eq.running&lease_expires_at=lt.${cutoff}&limit=${SWEEP_LIMIT}`;
      const runningUnleasedQ = `?select=*&status=eq.running&lease_expires_at=is.null&limit=${SWEEP_LIMIT}`;
      // Keep the database-side candidate read on ordinary table columns.
      // Nested JSON-path predicates made this entire cron return 500 on
      // PostgREST installations where that expression is unavailable. The
      // broad read is safe: exactUnrenewedCapabilityClaim below remains the
      // fail-closed authority for the embedded grant, lease, and Line binding.
      const capabilityQ = `?select=*&status=eq.running&producer=eq.openrouter_seedance`
        + `&lease_owner=like.cap_generate_*&updated_at=lt.${capabilityStale}`
        + `&result=is.null&order=updated_at.asc,job_id.asc&limit=${SWEEP_LIMIT}`;
      // These allowlisted reasons contain only PostgREST-safe identifier
      // characters. Keep the `in.(...)` list unquoted: percent-encoding the
      // quotes made them literal values after URL decoding, and every sibling
      // inside `or=(...)` must use PostgREST's column.operator.value grammar.
      const retryableIn = [...RETRYABLE_FAILURE_REASONS].join(",");
      const failedQ =
        `?select=*&status=eq.failed&updated_at=lt.${stale}` +
        `&or=(result->>reason.in.(${retryableIn}),result->>reason.ilike.*EPROTO*,result->>reason.ilike.*SSL*,result->>reason.ilike.*ECONNRESET*,result->>reason.ilike.*ETIMEDOUT*,result->>reason.ilike.*ENOTFOUND*)&limit=${SWEEP_LIMIT}`;
      const sweepResults = await Promise.all([
        selectFn(tableName, runningExpiredQ),
        selectFn(tableName, runningUnleasedQ),
        selectFn(tableName, capabilityQ),
        selectFn(tableName, failedQ),
      ]);
      const failedSelects = sweepResults
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result?.ok !== true || !Array.isArray(result.data));
      if (failedSelects.length) {
        const diagnostics = failedSelects.map(({ result, index }) => ({
          index,
          mode: String(result?.mode || "unknown").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 80) || "unknown",
          status: Number(result?.status) || null,
          code: String(result?.error?.code || "unknown").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 40) || "unknown",
        }));
        console.error(JSON.stringify({
          event: "hero_lease_watchdog_select_failed",
          failed_selects: diagnostics,
        }));
        sendJsonFn(res, 500, {
          ok: false,
          job: "hero-lease-watchdog",
          error: "watchdog_select_failed",
          failed_selects: diagnostics.map(({ index, mode, status }) => ({ index, mode, status })),
        });
        return;
      }
      const [runningRes, unleasedRes, capabilityRes, failedRes] = sweepResults;
      const seen = new Set();
      for (const res of [runningRes, unleasedRes, capabilityRes, failedRes]) {
        for (const row of Array.isArray(res?.data) ? res.data : []) {
          if (row?.job_id && !seen.has(row.job_id)) { seen.add(row.job_id); jobs.push(row); }
        }
      }
    } catch (_) {
      sendJsonFn(res, 500, { ok: false, job: "hero-lease-watchdog", error: "watchdog_select_failed" });
      return;
    }

    const summary = { ok: true, job: "hero-lease-watchdog", scanned: jobs.length, requeued: 0, failed: 0, waited: 0, skipped: 0 };
    for (const raw of jobs) {
      const verdict = watchdogVerdict(raw, nowMs);
      if (verdict.action === "wait" || verdict.action === "skip") {
        summary[verdict.action === "wait" ? "waited" : "skipped"] += 1;
        continue;
      }
      const parent = await parentBatchGate(raw);
      if (!parent.ok || parent.halted) {
        // A halted Line is immutable historical evidence. Unknown parent state
        // also fails closed: neither case may create a retry/provider path.
        summary.skipped += 1;
        continue;
      }
      // Column shape mirrors the queue lib's own writes exactly (its insert
      // and repair paths): `attempts` — not attempt_count — and result:null
      // on requeue, an explicit updated_at, finished_at on terminal.
      const nowIso = new Date(nowMs).toISOString();
      const patch = verdict.action === "requeue"
        ? {
          status: "queued",
          lease_token: null,
          lease_owner: null,
          lease_expires_at: null,
          attempts: (Number(raw.attempts ?? raw.attempt_count) || 0) + 1,
          result: null,
          updated_at: nowIso,
        }
        : {
          status: "failed",
          lease_token: null,
          lease_owner: null,
          lease_expires_at: null,
          attempts: verdict.preserveAttempts === true
            ? (Number(raw.attempts ?? raw.attempt_count) || 0)
            : (Number(raw.attempts ?? raw.attempt_count) || 0) + 1,
          result: {
            ok: false,
            action: "fail",
            reason: verdict.reason,
            exhausted_reason: verdict.exhaustedReason || verdict.reason,
            attempt_cap: Number(verdict.attemptCap) || MAX_ATTEMPTS,
            ...(verdict.retryBudgetExhaustedBy ? {
              retry_budget_exhausted: true,
              retry_budget_exhausted_by: verdict.retryBudgetExhaustedBy,
              provider_checkpoint_present: false,
            } : {}),
            settled_at: nowIso,
          },
          finished_at: nowIso,
          updated_at: nowIso,
        };
      // CAS: only mutate if the job still sits in the state we selected.
      // Running jobs bind the full lease tuple and updated_at; capability
      // claims also bind every non-secret redeemed-grant identity field and
      // the absent result. Empty leases use explicit is.null filters. Failed
      // rows keep the historical status-only guard because their bounded
      // requeue is idempotent and JSON equality is fragile in PostgREST.
      const capabilityClaim = verdict.capabilityClaim;
      const guard = String(raw.status) === "running" && String(raw.lease_token || "").trim()
        ? {
          status: "eq.running",
          lease_token: `eq.${String(raw.lease_token)}`,
          ...(String(raw.lease_owner || "").trim()
            ? { lease_owner: `eq.${String(raw.lease_owner)}` }
            : { lease_owner: "is.null" }),
          ...(String(raw.lease_expires_at || "").trim()
            ? { lease_expires_at: `eq.${String(raw.lease_expires_at)}` }
            : { lease_expires_at: "is.null" }),
          ...(String(raw.updated_at || "").trim() ? { updated_at: `eq.${String(raw.updated_at)}` } : {}),
          ...(capabilityClaim ? {
            producer: `eq.${String(raw.producer)}`,
            attempts: `eq.${capabilityClaim.attempts}`,
            finished_at: "is.null",
            result: "is.null",
            "payload->>generation_revision": `eq.${capabilityClaim.grant.generation_revision}`,
            "payload->line_handle->>batchId": `eq.${capabilityClaim.grant.batch_id}`,
            "payload->line_handle->>rowId": `eq.${capabilityClaim.grant.row_id}`,
            "payload->hero_job_capability_grant->>phase": "eq.generate",
            "payload->hero_job_capability_grant->>jti_sha256": `eq.${capabilityClaim.grant.jti_sha256}`,
            "payload->hero_job_capability_grant->>redemption_sha256": `eq.${capabilityClaim.grant.redemption_sha256}`,
            "payload->hero_job_capability_grant->>redeemed_at": `eq.${capabilityClaim.grant.redeemed_at}`,
            "payload->hero_job_capability_grant->>redeemed_lease_sha256": `eq.${capabilityClaim.grant.redeemed_lease_sha256}`,
          } : {}),
        }
        : String(raw.status) === "running"
          ? {
            status: "eq.running",
            lease_token: "is.null",
            lease_owner: String(raw.lease_owner || "").trim() ? `eq.${String(raw.lease_owner)}` : "is.null",
            lease_expires_at: "is.null",
            ...(String(raw.updated_at || "").trim() ? { updated_at: `eq.${String(raw.updated_at)}` } : {}),
          }
          : { status: `eq.${String(raw.status)}` };
      const updated = await updateFn(tableName, "job_id", raw.job_id, guard, patch);
      if (updated?.ok === false || updated?.updated === false) {
        summary.skipped += 1;
        if (Array.isArray(summary.update_errors) === false) summary.update_errors = [];
        if (summary.update_errors.length < 5) {
          summary.update_errors.push({
            job_id: String(raw.job_id || "").slice(0, 40),
            action: verdict.action,
            mode: updated?.mode || null,
            status: updated?.status ?? null,
            error: String(updated?.error || "").slice(0, 160) || null,
          });
        }
        continue;
      }
      summary[verdict.action === "requeue" ? "requeued" : "failed"] += 1;
      if (eventFn) {
        try {
          await eventFn({ type: "hero.lease_watchdog", actor: "cron", status: "ok", payload: { job_id: raw.job_id, action: verdict.action, reason: verdict.reason } });
        } catch (_) { /* audit best-effort */ }
      }
    }
    sendJsonFn(res, 200, summary);
  };
}

module.exports = createHeroLeaseWatchdogHandler();
module.exports.createHeroLeaseWatchdogHandler = createHeroLeaseWatchdogHandler;
module.exports.watchdogVerdict = watchdogVerdict;
module.exports.exactUnrenewedCapabilityClaim = exactUnrenewedCapabilityClaim;
module.exports.exactRejectedFrameImagesSubmission = exactRejectedFrameImagesSubmission;
