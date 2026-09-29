"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createHeroLeaseWatchdogHandler, watchdogVerdict } = require("../api/cron/hero-lease-watchdog");
const {
  heroJobCapabilityLeaseOwner,
  sha256Opaque,
} = require("../lib/hero-job-capability");

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const LEASE = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();

test("running job with lease freshly expired waits inside the grace window", () => {
  const v = watchdogVerdict({ status: "running", lease_expires_at: LEASE(5), attempts: 0 }, NOW);
  assert.equal(v.action, "wait");
});

test("running job past grace requeues and bumps attempts", () => {
  const v = watchdogVerdict({ status: "running", lease_expires_at: LEASE(20), attempts: 0 }, NOW);
  assert.equal(v.action, "requeue");
  assert.equal(v.reason, "hero_lease_expired_requeue");
});

test("job exhausting attempts is failed for owner attention instead of looping", () => {
  const v = watchdogVerdict({ status: "running", lease_expires_at: LEASE(20), attempts: 2 }, NOW);
  assert.equal(v.action, "fail");
  assert.equal(v.reason, "hero_lease_expired_max_attempts");
});

test("non-running or lease-less jobs are never touched", () => {
  assert.equal(watchdogVerdict({ status: "queued", lease_expires_at: LEASE(60) }, NOW).action, "skip");
  assert.equal(watchdogVerdict({ status: "failed", lease_expires_at: LEASE(600) }, NOW).action, "skip");
  assert.equal(watchdogVerdict(null, NOW).action, "skip");
});

test("a lost settle (running, no lease) is an immortal zombie and must be swept", () => {
  // 2026-08-28: a worker died between the running-status write and the lease
  // write. `lease_expires_at=lt.` never matched NULL and the verdict skipped
  // no_lease_expiry — rows pended hero "running" for hours while the worker
  // claimed nothing. The job's own updated_at is the liveness signal.
  const fresh = watchdogVerdict({
    status: "running", lease_expires_at: "", attempts: 0, updated_at: LEASE(2),
  }, NOW);
  assert.equal(fresh.action, "wait");
  assert.equal(fresh.reason, "no_lease_expiry_inside_grace");

  const stale = watchdogVerdict({
    status: "running", lease_expires_at: null, attempts: 0, updated_at: LEASE(20),
  }, NOW);
  assert.equal(stale.action, "requeue");
  assert.equal(stale.reason, "hero_lost_settle_requeue");

  const exhausted = watchdogVerdict({
    status: "running", lease_expires_at: null, attempts: 2, updated_at: LEASE(20),
  }, NOW);
  assert.equal(exhausted.action, "fail");
  assert.equal(exhausted.reason, "hero_lost_settle_max_attempts");
});

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    writeHead(code) { this.statusCode = code; return this; },
    setHeader() {},
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

function failedJob(reason, updatedAt, attemptCount = 0) {
  return { job_id: `j_${reason}`, status: "failed", attempts: attemptCount, updated_at: updatedAt, result: { ok: false, reason } };
}

function rejectedFrameImagesJob(overrides = {}) {
  const jobId = "hrj_frame_images_400";
  const prospectId = "prospect-frame-images-400";
  const revision = 2;
  const base = {
    job_id: jobId,
    prospect_id: prospectId,
    producer: "openrouter_seedance",
    status: "failed",
    attempts: 1,
    lease_token: null,
    lease_owner: null,
    lease_expires_at: null,
    updated_at: LEASE(60),
    payload: { generation_revision: revision },
    result: {
      ok: false,
      reason: "openrouter_submit_failed",
      provider_failure: {
        schema_version: "wss.openrouter_failure.v1",
        provider: "openrouter",
        operation: "video_submit",
        http_status: 400,
        parameter: "frame_images",
      },
      provider_checkpoint: {
        schema_version: "wss.hero.seedance_provider_checkpoint.v1",
        job_id: jobId,
        prospect_id: prospectId,
        generation_revision: revision,
        submission_state: "submitting",
        polling_url: "",
      },
    },
  };
  return { ...base, ...overrides };
}

function capabilityJob({
  minutesSinceLiveness = 25,
  result = null,
  phase = "generate",
  leaseToken = "lease-capability-one-shot",
  mismatchedLeaseHash = false,
} = {}) {
  const redeemedAt = LEASE(25);
  const grant = {
    schema: "wss.hero.job-capability-grant.v1",
    phase,
    job_id: "hrj_capability_stale",
    prospect_id: "prospect-capability-stale",
    producer: "openrouter_seedance",
    generation_revision: 4,
    attempt: 0,
    jti_sha256: "a".repeat(64),
    iat: Math.floor((NOW - 30 * 60_000) / 1000),
    nbf: Math.floor((NOW - 30 * 60_000) / 1000),
    exp: Math.floor((NOW + 40 * 60_000) / 1000),
    batch_id: "line_capability",
    row_id: "line_capability:0",
    ...(phase === "upload" ? { approved_sha256: "d".repeat(64) } : {}),
    redemption_sha256: "b".repeat(64),
    redeemed_at: redeemedAt,
    redeemed_lease_sha256: mismatchedLeaseHash ? "c".repeat(64) : sha256Opaque(leaseToken),
  };
  return {
    job_id: grant.job_id,
    prospect_id: grant.prospect_id,
    producer: grant.producer,
    status: "running",
    attempts: 1,
    payload: {
      generation_revision: grant.generation_revision,
      line_handle: { batchId: grant.batch_id, rowId: grant.row_id },
      hero_job_capability_grant: grant,
    },
    result,
    lease_token: leaseToken,
    lease_owner: heroJobCapabilityLeaseOwner(grant),
    lease_expires_at: new Date(NOW + 35 * 60_000).toISOString(),
    updated_at: LEASE(minutesSinceLiveness),
    finished_at: null,
  };
}

test("an unrenewed generate capability with no checkpoint closes terminal without a second submit", () => {
  const v = watchdogVerdict(capabilityJob(), NOW, { capabilityStaleMs: 20 * 60_000 });
  assert.equal(v.action, "fail");
  assert.equal(v.reason, "hero_capability_unrenewed_no_checkpoint");
  assert.equal(v.preserveAttempts, true);
  assert.equal(v.retryBudgetExhaustedBy, "provider_spend_uncertain");
  assert.equal(v.attemptCap, 3);
});

test("capability recovery waits for fresh liveness and refuses ambiguous or upload states", () => {
  const fresh = watchdogVerdict(capabilityJob({ minutesSinceLiveness: 5 }), NOW, {
    capabilityStaleMs: 20 * 60_000,
  });
  assert.equal(fresh.action, "wait");
  assert.equal(fresh.reason, "inside_grace_window");

  const checkpointed = watchdogVerdict(capabilityJob({
    result: { provider_checkpoint: { submission_state: "submitting" } },
  }), NOW, { capabilityStaleMs: 20 * 60_000 });
  assert.equal(checkpointed.action, "wait", "a paid-boundary checkpoint stays on its existing lease");
  assert.equal(checkpointed.reason, "hero_provider_checkpoint_preserved");

  const expiredCheckpointed = capabilityJob({
    minutesSinceLiveness: 90,
    result: { provider_checkpoint: { submission_state: "submitting" } },
  });
  expiredCheckpointed.lease_expires_at = LEASE(30);
  const preserved = watchdogVerdict(expiredCheckpointed, NOW, {
    graceMs: 10 * 60_000,
    capabilityStaleMs: 20 * 60_000,
  });
  assert.equal(preserved.action, "wait");
  assert.equal(preserved.reason, "hero_provider_checkpoint_preserved",
    "the generic lease sweep may never erase paid-boundary recovery evidence");

  const wrongLease = watchdogVerdict(capabilityJob({ mismatchedLeaseHash: true }), NOW, {
    capabilityStaleMs: 20 * 60_000,
  });
  assert.equal(wrongLease.action, "wait", "a non-exact grant/lease binding never takes the early close");

  const upload = watchdogVerdict(capabilityJob({ phase: "upload" }), NOW, {
    capabilityStaleMs: 20 * 60_000,
  });
  assert.equal(upload.action, "wait", "approved upload capabilities stay fail-closed");
});

test("transport-level SSL/EPROTO failures requeue once stale", () => {
  const v = watchdogVerdict(failedJob("write_EPROTO_DCAF0000_error_0A00010B_SSL_routines_tls_validate_record_header_wrong_version_number", LEASE(60)), NOW);
  assert.equal(v.action, "requeue");
});

test("stale failed job with a retryable reason requeues under the new code", () => {
  const v = watchdogVerdict(failedJob("clip_dimensions_out_of_range", LEASE(60)), NOW);
  assert.equal(v.action, "requeue");
  assert.equal(v.reason, "hero_stale_failure_requeue");
});

test("recently failed job waits so the current worker has its chance", () => {
  const v = watchdogVerdict(failedJob("openrouter_submit_failed", LEASE(5)), NOW);
  assert.equal(v.action, "wait");
  assert.equal(v.reason, "failure_not_stale_yet");
});

test("the exact rejected frame_images submission receipt is preserved without a CAS write", async () => {
  const rejected = rejectedFrameImagesJob();
  const verdict = watchdogVerdict(rejected, NOW);
  assert.equal(verdict.action, "skip");
  assert.equal(verdict.reason, "hero_rejected_frame_images_receipt_preserved");

  let updates = 0;
  const handler = createHeroLeaseWatchdogHandler({
    requireCron: () => true,
    methodGuard: () => true,
    nowFn: () => NOW,
    selectFn: async () => ({ ok: true, data: [structuredClone(rejected)] }),
    conditionalUpdate: async () => { updates += 1; return { ok: true, updated: true }; },
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scanned, 1);
  assert.equal(res.body.skipped, 1);
  assert.equal(res.body.requeued, 0);
  assert.equal(updates, 0, "the immutable rejection receipt must never reach the CAS update");
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.attempts, 1);
  assert.equal(rejected.result.reason, "openrouter_submit_failed");
});

test("ambiguous submit failures retain the bounded stale-failure requeue", () => {
  const ambiguous = rejectedFrameImagesJob();
  ambiguous.result.provider_failure.http_status = 503;
  const verdict = watchdogVerdict(ambiguous, NOW);
  assert.equal(verdict.action, "requeue");
  assert.equal(verdict.reason, "hero_stale_failure_requeue");
});

test("sanctioned provider error_type is preserved but unknown receipt fields are not exact", () => {
  const sanctioned = rejectedFrameImagesJob();
  sanctioned.result.provider_failure.error_type = "invalid_request";
  const preserved = watchdogVerdict(sanctioned, NOW);
  assert.equal(preserved.action, "skip");
  assert.equal(preserved.reason, "hero_rejected_frame_images_receipt_preserved");

  const unknownExtra = rejectedFrameImagesJob();
  unknownExtra.result.provider_failure.provider_trace = "opaque-provider-value";
  const rejected = watchdogVerdict(unknownExtra, NOW);
  assert.equal(rejected.action, "requeue");
  assert.equal(rejected.reason, "hero_stale_failure_requeue");
});

test("truth-refusal failures are never requeued — requeueing loops against the same data", () => {
  assert.equal(watchdogVerdict(failedJob("no_verified_owned_real_scene", LEASE(600)), NOW).action, "skip");
});

test("stale failed job exhausting attempts fails for owner attention", () => {
  const v = watchdogVerdict(failedJob("clip_dimensions_out_of_range", LEASE(600), 5), NOW);
  assert.equal(v.action, "fail");
  assert.equal(v.reason, "hero_stale_failure_max_attempts");
  assert.equal(v.exhaustedReason, "clip_dimensions_out_of_range");
  assert.equal(v.attemptCap, 3);
});

test("watchdog selection includes ENOTFOUND transport failures", async () => {
  const queries = [];
  const handler = createHeroLeaseWatchdogHandler({
    requireCron: () => true,
    methodGuard: () => true,
    nowFn: () => NOW,
    selectFn: async (_table, query) => { queries.push(query); return { ok: true, data: [] }; },
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(queries.length, 4);
  assert.ok(queries.some((query) => query.includes("ENOTFOUND")));
  const capabilityQuery = queries.find((query) => query.includes("producer=eq.openrouter_seedance"));
  assert.ok(capabilityQuery);
  assert.ok(capabilityQuery.includes("result=is.null"));
  assert.ok(capabilityQuery.includes("status=eq.running"));
  assert.ok(capabilityQuery.includes("lease_owner=like.cap_generate_*"));
  assert.ok(capabilityQuery.includes("order=updated_at.asc,job_id.asc"));
  assert.equal(capabilityQuery.includes("payload->"), false,
    "the candidate read must not depend on PostgREST nested JSON-path filters");
});

test("failed-job sweep emits PostgREST-valid in and ilike grammar", async () => {
  let failedQuery = "";
  const handler = createHeroLeaseWatchdogHandler({
    requireCron: () => true,
    methodGuard: () => true,
    nowFn: () => NOW,
    parentBatchStatus: async () => ({ ok: true, halted: false }),
    selectFn: async (_table, query) => {
      if (query.includes("status=eq.failed")) {
        failedQuery = query;
        // Mirror the production PGRST100 trigger closely: filters nested in
        // `or=(...)` use dots, never the top-level `column=operator.value`
        // form, and the safe in-list must not contain encoded quote literals.
        const invalid = query.includes("reason=ilike") || query.includes("%22");
        return invalid
          ? { ok: false, mode: "live_select_failed", status: 400, error: { code: "PGRST100" }, data: [] }
          : { ok: true, data: [] };
      }
      return { ok: true, data: [] };
    },
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.match(failedQuery, /result->>reason\.in\.\(clip_dimensions_out_of_range,/);
  assert.match(failedQuery, /result->>reason\.ilike\.\*EPROTO\*/);
  assert.match(failedQuery, /result->>reason\.ilike\.\*ENOTFOUND\*/);
  assert.equal(failedQuery.includes("reason=ilike"), false);
  assert.equal(failedQuery.includes("%22"), false);
});

test("ordinary-column capability selection cannot be starved by more than the sweep limit of decoys", async () => {
  const stale = capabilityJob();
  const decoys = Array.from({ length: 12 }, (_, index) => ({
    job_id: `hrj_decoy_${String(index).padStart(2, "0")}`,
    prospect_id: `prospect-decoy-${index}`,
    producer: "openrouter_seedance",
    status: "running",
    attempts: 1,
    payload: {},
    result: null,
    lease_token: `lease-decoy-${index}`,
    lease_owner: `worker_seedance_${index}`,
    lease_expires_at: new Date(NOW + 35 * 60_000).toISOString(),
    updated_at: LEASE(40 + index),
    finished_at: null,
  }));
  let terminalJobId = null;
  const handler = createHeroLeaseWatchdogHandler({
    requireCron: () => true,
    methodGuard: () => true,
    nowFn: () => NOW,
    parentBatchStatus: async () => ({ ok: true, halted: false }),
    selectFn: async (_table, query) => {
      if (!query.includes("lease_owner=like.cap_generate_*")) return { ok: true, data: [] };
      // Model PostgREST's ordinary-column filter before its LIMIT. Without the
      // lease-owner predicate, the 12 older decoys consume the ten-row page.
      const candidates = [...decoys, stale]
        .filter((row) => row.lease_owner.startsWith("cap_generate_"))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.job_id.localeCompare(b.job_id))
        .slice(0, 10);
      return { ok: true, data: candidates };
    },
    conditionalUpdate: async (_table, _idColumn, jobId) => {
      terminalJobId = jobId;
      return { ok: true, updated: true };
    },
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scanned, 1);
  assert.equal(res.body.failed, 1);
  assert.equal(terminalJobId, stale.job_id);
});

test("capability stale close preserves the real attempt count and CAS-fences the exact redeemed lease", async () => {
  const stale = capabilityJob();
  let captured = null;
  const handler = createHeroLeaseWatchdogHandler({
    requireCron: () => true,
    methodGuard: () => true,
    nowFn: () => NOW,
    selectFn: async () => ({ ok: true, data: [stale] }),
    conditionalUpdate: async (_table, _idCol, _id, guards, patch) => {
      captured = { guards: structuredClone(guards), patch: structuredClone(patch) };
      return { ok: true, updated: true, rows: [patch] };
    },
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.body.failed, 1);
  assert.equal(res.body.requeued, 0, "an uncertain paid boundary is never submitted twice");
  assert.equal(captured.patch.attempts, 1, "the watchdog never invents provider attempts");
  assert.equal(captured.patch.result.reason, "hero_capability_unrenewed_no_checkpoint");
  assert.equal(captured.patch.result.exhausted_reason, "hero_capability_unrenewed_no_checkpoint");
  assert.equal(captured.patch.result.retry_budget_exhausted, true);
  assert.equal(captured.patch.result.retry_budget_exhausted_by, "provider_spend_uncertain");
  assert.equal(captured.patch.result.provider_checkpoint_present, false);
  assert.equal(captured.guards.lease_token, `eq.${stale.lease_token}`);
  assert.equal(captured.guards.lease_owner, `eq.${stale.lease_owner}`);
  assert.equal(captured.guards.lease_expires_at, `eq.${stale.lease_expires_at}`);
  assert.equal(captured.guards.updated_at, `eq.${stale.updated_at}`);
  assert.equal(captured.guards.attempts, "eq.1");
  assert.equal(captured.guards.result, "is.null");
  assert.equal(captured.guards["payload->hero_job_capability_grant->>redeemed_lease_sha256"],
    `eq.${stale.payload.hero_job_capability_grant.redeemed_lease_sha256}`);
});

test("terminal watchdog write preserves the exact exhausted reason and cap", async () => {
  const stale = failedJob("openrouter_submit_failed", LEASE(600), 2);
  stale.job_id = "j_preserve_reason";
  let terminalPatch = null;
  const handler = createHeroLeaseWatchdogHandler({
    requireCron: () => true,
    methodGuard: () => true,
    nowFn: () => NOW,
    selectFn: async () => ({ ok: true, data: [stale] }),
    conditionalUpdate: async (_table, _idCol, _id, _guards, patch) => {
      terminalPatch = structuredClone(patch);
      return { ok: true, updated: true, rows: [patch] };
    },
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(terminalPatch.status, "failed");
  assert.equal(terminalPatch.attempts, 3);
  assert.equal(terminalPatch.result.reason, "hero_stale_failure_max_attempts");
  assert.equal(terminalPatch.result.exhausted_reason, "openrouter_submit_failed");
  assert.equal(terminalPatch.result.attempt_cap, 3);
});

test("handler sweeps expired leases with CAS guard and counts outcomes", async () => {
  const jobs = [
    { job_id: "j_requeue", status: "running", lease_token: "tok-a", lease_expires_at: LEASE(30), attempts: 0 },
    { job_id: "j_fail", status: "running", lease_token: "tok-b", lease_expires_at: LEASE(90), attempts: 5 },
    { job_id: "j_wait", status: "running", lease_token: "tok-c", lease_expires_at: LEASE(2), attempts: 0 },
    { job_id: "j_race", status: "running", lease_token: "tok-d", lease_expires_at: LEASE(30), attempts: 0 },
  ];
  const updates = [];
  const handler = createHeroLeaseWatchdogHandler({
    requireCron: () => true,
    methodGuard: () => true,
    nowFn: () => NOW,
    selectFn: async () => ({ ok: true, data: jobs }),
    conditionalUpdate: async (table, idCol, id, guards, patch) => {
      updates.push({ id, guards, patch });
      // Simulate a worker renewing j_race between select and update.
      if (id === "j_race") return { ok: true, updated: false, rows: [] };
      return { ok: true, updated: true, rows: [patch] };
    },
    eventFn: async () => ({}),
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requeued, 1);
  assert.equal(res.body.failed, 1);
  assert.equal(res.body.waited, 1);
  assert.equal(res.body.skipped, 1);
  const requeue = updates.find((u) => u.id === "j_requeue");
  assert.equal(requeue.patch.status, "queued");
  assert.equal(requeue.patch.attempts, 1);
  assert.ok(requeue.guards.lease_token.endsWith("tok-a"));
  const fail = updates.find((u) => u.id === "j_fail");
  assert.equal(fail.patch.status, "failed");
  assert.equal(fail.patch.result.reason, "hero_lease_expired_max_attempts");
});

test("a failed sweep read is visible and returns non-200", async () => {
  let calls = 0;
  const originalConsoleError = console.error;
  const diagnostics = [];
  console.error = (line) => diagnostics.push(JSON.parse(line));
  const handler = createHeroLeaseWatchdogHandler({
    requireCron: () => true,
    methodGuard: () => true,
    nowFn: () => NOW,
    selectFn: async () => {
      calls += 1;
      return calls === 3
        ? { ok: false, mode: "live_select_failed", status: 503, error: { code: "PGRST100" }, data: [] }
        : { ok: true, mode: "live_select", data: [] };
    },
    conditionalUpdate: async () => { throw new Error("must_not_update_after_select_failure"); },
  });
  const res = mockRes();
  try {
    await handler({ method: "GET" }, res);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "watchdog_select_failed");
  assert.deepEqual(res.body.failed_selects, [{ index: 2, mode: "live_select_failed", status: 503 }]);
  assert.deepEqual(diagnostics, [{
    event: "hero_lease_watchdog_select_failed",
    failed_selects: [{ index: 2, mode: "live_select_failed", status: 503, code: "PGRST100" }],
  }]);
});

test("watchdog preserves a halted parent's job and still repairs an unrelated active batch", async () => {
  const jobs = [
    {
      job_id: "j_halted", status: "running", lease_token: "tok-h", lease_owner: "worker-h",
      lease_expires_at: LEASE(30), attempts: 0,
      payload: { line_handle: { batchId: "line_halted", rowId: "row_halted" } },
    },
    {
      job_id: "j_active", status: "running", lease_token: "tok-a", lease_owner: "worker-a",
      lease_expires_at: LEASE(30), attempts: 0,
      payload: { line_handle: { batchId: "line_active", rowId: "row_active" } },
    },
  ];
  const updates = [];
  const handler = createHeroLeaseWatchdogHandler({
    requireCron: () => true,
    methodGuard: () => true,
    nowFn: () => NOW,
    selectFn: async () => ({ ok: true, data: jobs }),
    parentBatchStatus: async (batchId) => ({ ok: true, halted: batchId === "line_halted" }),
    conditionalUpdate: async (_table, _idCol, id, _guards, patch) => {
      updates.push({ id, patch });
      return { ok: true, updated: true, rows: [patch] };
    },
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(updates.map((entry) => entry.id), ["j_active"]);
  assert.equal(updates[0].patch.status, "queued");
  assert.equal(res.body.requeued, 1);
  assert.equal(res.body.skipped, 1);
});
