"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { runLoop, runWave, singlePassMsFromEnv } = require("../scripts/seedance-worker.cjs");

const CONFIG = { continuous: true, idleMs: 1, sleepImpl: () => Promise.resolve() };

test("continuous worker survives transient wave errors, then recovers", async () => {
  let calls = 0;
  const lines = [];
  const idle = { status: "idle", claimed: 0, results: [] };
  const returned = await runLoop(CONFIG, {
    write: (line) => lines.push(JSON.parse(line)),
    runWaveImpl: async () => {
      calls += 1;
      if (calls <= 2) throw new Error("hero_reel_queue_unavailable");
      if (calls === 3) return idle;
      return { status: "stop" };
    },
  });
  assert.equal(returned.status, "stopped");
  assert.equal(calls, 4);
  const errors = lines.filter((l) => l.status === "wave_error");
  assert.equal(errors.length, 2);
  assert.match(errors[0].error, /hero_reel_queue_unavailable/);
  assert.equal(errors[0].consecutive, 1);
  assert.equal(errors[1].consecutive, 2);
});

test("worker gives up after the consecutive-failure cap instead of hanging forever", async () => {
  process.env.GHOST_AGENCY_SEEDANCE_MAX_WAVE_FAILURES = "5";
  let calls = 0;
  const lines = [];
  try {
    const returned = await runLoop({ ...CONFIG }, {
      write: (line) => lines.push(JSON.parse(line)),
      runWaveImpl: async () => {
        calls += 1;
        throw new Error("still_down");
      },
    });
    assert.equal(returned.status, "gave_up");
  } finally {
    delete process.env.GHOST_AGENCY_SEEDANCE_MAX_WAVE_FAILURES;
  }
  assert.equal(calls, 5);
  assert.equal(lines[lines.length - 1].status, "gave_up");
});

const CAPSULE = JSON.stringify({
  schema: "wss.hero.job-capability-launch.v1",
  phase: "generate",
  capability: "wss1.test-capability",
});

function waveConfig(overrides = {}) {
  return {
    capabilityMode: false,
    continuous: true,
    idleMs: 1_000,
    openrouterApiKey: "test-openrouter-key",
    parallelism: 1,
    sleepImpl: () => Promise.resolve(),
    workerId: "seedance-test",
    workerToken: "test-worker-token",
    ...overrides,
  };
}

function conflict(message = "capability_target_conflict") {
  const error = new Error(message);
  error.status = 409;
  return error;
}

test("capability-claim fallback processes with the assigned plain worker config", async () => {
  const sleeps = [];
  const claims = [];
  let processedConfig;
  const config = waveConfig({ sleepImpl: async (ms) => { sleeps.push(ms); } });
  const job = { jobId: "hrj_plain_after_capability" };
  const result = await runWave(config, {
    requestLaunchCapsuleImpl: async () => CAPSULE,
    claimJobImpl: async (claimConfig) => {
      claims.push(claimConfig);
      if (claimConfig.capabilityMode) throw conflict();
      return job;
    },
    processJobImpl: async (processConfig, exactJob) => {
      processedConfig = processConfig;
      assert.equal(exactJob, job);
      return { status: "awaiting_review" };
    },
  });

  assert.equal(result.status, "worked");
  assert.equal(result.claimed, 1);
  assert.deepEqual(sleeps, [1_000, 2_000], "409 retries are bounded to two backoffs");
  assert.equal(claims.length, 4, "three capability attempts, then one plain claim");
  assert.equal(processedConfig.capabilityMode, false);
  assert.equal(processedConfig.workerToken, "test-worker-token");
  assert.equal(processedConfig.workerId, "seedance-test-1");
  assert.equal(processedConfig.jobCapability, "");
});

test("broker fallback processes with the assigned plain worker config after bounded 409 backoff", async () => {
  const sleeps = [];
  let brokerCalls = 0;
  let claimedConfig;
  let processedConfig;
  const config = waveConfig({ sleepImpl: async (ms) => { sleeps.push(ms); } });
  const job = { jobId: "hrj_plain_after_broker" };
  const result = await runWave(config, {
    requestLaunchCapsuleImpl: async () => {
      brokerCalls += 1;
      throw conflict();
    },
    claimJobImpl: async (claimConfig) => {
      claimedConfig = claimConfig;
      return job;
    },
    processJobImpl: async (processConfig) => {
      processedConfig = processConfig;
      return { status: "awaiting_review" };
    },
  });

  assert.equal(result.status, "worked");
  assert.equal(brokerCalls, 3);
  assert.deepEqual(sleeps, [1_000, 2_000]);
  assert.equal(claimedConfig.capabilityMode, false);
  assert.equal(claimedConfig.workerToken, "test-worker-token");
  assert.equal(processedConfig, claimedConfig, "the claimed plain config must also process the job");
});

test("Practice capability conflict cannot escape to an unscoped plain claim", async () => {
  const sleeps = [];
  const claims = [];
  let processed = 0;
  const unscopedJob = { jobId: "hrj_live_outside_practice_target" };
  const config = waveConfig({
    practiceOnly: true,
    practiceBatchId: "line_practice_exact",
    practiceRowId: "row_practice_exact",
    sleepImpl: async (ms) => { sleeps.push(ms); },
  });

  await assert.rejects(
    runWave(config, {
      requestLaunchCapsuleImpl: async () => CAPSULE,
      claimJobImpl: async (claimConfig) => {
        claims.push(claimConfig);
        if (claimConfig.capabilityMode) throw conflict();
        return unscopedJob;
      },
      processJobImpl: async () => { processed += 1; },
    }),
    { code: "seedance_practice_plain_claim_forbidden" },
  );

  assert.deepEqual(sleeps, [1_000, 2_000], "the exact capability keeps its bounded retries");
  assert.equal(claims.length, 3, "only the exact capability is retried");
  assert.ok(claims.every((claimConfig) => claimConfig.capabilityMode === true));
  assert.equal(processed, 0, "an unscoped job never reaches provider processing");
});

test("Practice broker conflict cannot escape to an unscoped plain claim", async () => {
  const sleeps = [];
  let brokerCalls = 0;
  let plainClaims = 0;
  let processed = 0;
  const config = waveConfig({
    // A batch/row pair scopes the broker even if an older launcher omitted the
    // redundant practiceOnly flag. The fallback boundary must honor the target.
    practiceOnly: false,
    practiceBatchId: "line_practice_exact",
    practiceRowId: "row_practice_exact",
    sleepImpl: async (ms) => { sleeps.push(ms); },
  });

  await assert.rejects(
    runWave(config, {
      requestLaunchCapsuleImpl: async () => {
        brokerCalls += 1;
        throw conflict();
      },
      claimJobImpl: async () => {
        plainClaims += 1;
        return { jobId: "hrj_live_outside_practice_target" };
      },
      processJobImpl: async () => { processed += 1; },
    }),
    { code: "seedance_practice_plain_claim_forbidden" },
  );

  assert.equal(brokerCalls, 3);
  assert.deepEqual(sleeps, [1_000, 2_000]);
  assert.equal(plainClaims, 0, "the queue-wide plain endpoint is never called");
  assert.equal(processed, 0, "an unscoped job never reaches provider processing");
});

test("capability transport failure never falls through to a second plain claim", async () => {
  let claims = 0;
  let processes = 0;
  const transportError = new Error("transport_lost");
  await assert.rejects(
    runWave(waveConfig(), {
      requestLaunchCapsuleImpl: async () => CAPSULE,
      claimJobImpl: async () => { claims += 1; throw transportError; },
      processJobImpl: async () => { processes += 1; },
    }),
    (error) => error === transportError,
  );
  assert.equal(claims, 1, "unknown capability outcome must not claim a second row");
  assert.equal(processes, 0);
});

test("plain fallback operational failure reaches the worker retry loop instead of reporting idle", async () => {
  let brokerCalls = 0;
  let plainClaims = 0;
  const backendError = new Error("backend_unavailable");
  await assert.rejects(
    runWave(waveConfig(), {
      requestLaunchCapsuleImpl: async () => { brokerCalls += 1; throw conflict(); },
      claimJobImpl: async (claimConfig) => {
        assert.equal(claimConfig.capabilityMode, false);
        plainClaims += 1;
        throw backendError;
      },
    }),
    (error) => error === backendError,
  );
  assert.equal(brokerCalls, 3, "broker 409 retries stay bounded");
  assert.equal(plainClaims, 1, "plain fallback is attempted once, not converted to an empty queue");
});

test("worker refuses plain fallback and stops immediately on 401 or 403", async () => {
  for (const [status, message] of [[401, "unauthorized"], [403, "capability_action_forbidden"]]) {
    let claims = 0;
    const authError = new Error(message);
    authError.status = status;
    await assert.rejects(
      runWave(waveConfig(), {
        requestLaunchCapsuleImpl: async () => { throw authError; },
        claimJobImpl: async () => { claims += 1; return null; },
      }),
      (error) => error === authError,
    );
    assert.equal(claims, 0, `HTTP ${status} must never fall back to a plain claim`);

    const lines = [];
    let waves = 0;
    let sleeps = 0;
    const returned = await runLoop(waveConfig({ sleepImpl: async () => { sleeps += 1; } }), {
      write: (line) => lines.push(JSON.parse(line)),
      runWaveImpl: async () => { waves += 1; throw authError; },
    });
    assert.equal(returned.status, "gave_up");
    assert.equal(returned.reason, "worker_auth_refused");
    assert.equal(waves, 1, `HTTP ${status} stops after one wave`);
    assert.equal(sleeps, 0, `HTTP ${status} does not enter retry backoff`);
    assert.equal(lines.at(-1).reason, "worker_auth_refused");

    let oneShotWaves = 0;
    await assert.rejects(
      runLoop(waveConfig({ continuous: false }), {
        write: () => {},
        runWaveImpl: async () => { oneShotWaves += 1; throw authError; },
      }),
      (error) => error === authError,
    );
    assert.equal(oneShotWaves, 1, `one-shot HTTP ${status} exits non-zero without retrying`);
  }
});

const IDLE = { status: "idle", claimed: 0, results: [] };
// Budget checks read the wall clock, so timing tests need sleeps that actually
// wait; the shared CONFIG sleep is a no-op for fast loop semantics elsewhere.
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("single-pass mode exits after one empty wave so an idle cron tick costs seconds", async () => {
  let waves = 0;
  const lines = [];
  const returned = await runLoop(
    { ...CONFIG, singlePassMs: 80, idleMs: 10, sleepImpl: realSleep },
    {
      write: (line) => lines.push(JSON.parse(line)),
      runWaveImpl: async () => { waves += 1; return IDLE; },
    },
  );
  assert.equal(returned.status, "single_pass_complete");
  assert.equal(waves, 1, "an idle single pass does not idle out its budget");
  assert.ok(returned.elapsed_ms < 80, `exits before the budget (${returned.elapsed_ms}ms)`);
  assert.equal(lines.at(-1).status, "single_pass_complete");
});

test("single-pass mode always runs at least one wave, then exits without hanging", async () => {
  let waves = 0;
  const returned = await runLoop(
    { ...CONFIG, singlePassMs: 15, idleMs: 5, sleepImpl: realSleep },
    {
      write: () => {},
      runWaveImpl: async () => { waves += 1; return IDLE; },
    },
  );
  assert.ok(waves >= 1 && waves <= 10, `a small budget still claims first (waves=${waves})`);
  assert.equal(returned.status, "single_pass_complete");
});

test("single-pass mode finishes an in-flight wave that outlasts the budget", async () => {
  let waves = 0;
  const returned = await runLoop(
    { ...CONFIG, singlePassMs: 20, idleMs: 5 },
    {
      write: () => {},
      runWaveImpl: async () => {
        waves += 1;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { status: "worked", claimed: 2, results: [] };
      },
    },
  );
  assert.equal(waves, 1, "a worked wave is never truncated mid-flight");
  assert.equal(returned.status, "single_pass_complete");
  assert.equal(returned.claimed, 2, "the summary carries the pass claim total");
});

test("single-pass mode exits non-zero on auth refusal instead of reporting success", async () => {
  const authError = new Error("unauthorized");
  authError.status = 401;
  const lines = [];
  let waves = 0;
  await assert.rejects(
    runLoop({ ...CONFIG, singlePassMs: 5_000 }, {
      write: (line) => lines.push(JSON.parse(line)),
      runWaveImpl: async () => { waves += 1; throw authError; },
    }),
    (error) => error === authError,
  );
  assert.equal(waves, 1);
  assert.equal(lines.at(-1).status, "gave_up");
  assert.equal(lines.at(-1).reason, "worker_auth_refused");
});

test("single-pass mode exits non-zero at the consecutive-failure cap", async () => {
  process.env.GHOST_AGENCY_SEEDANCE_MAX_WAVE_FAILURES = "2";
  let waves = 0;
  try {
    await assert.rejects(
      runLoop({ ...CONFIG, singlePassMs: 60_000, idleMs: 1 }, {
        write: () => {},
        runWaveImpl: async () => { waves += 1; throw new Error("queue_down"); },
      }),
      /queue_down/,
    );
  } finally {
    delete process.env.GHOST_AGENCY_SEEDANCE_MAX_WAVE_FAILURES;
  }
  assert.equal(waves, 2);
});

test("single-pass env parsing accepts positive ms, caps at six hours, and ignores garbage", () => {
  assert.equal(singlePassMsFromEnv({}), 0);
  assert.equal(singlePassMsFromEnv({ GHOST_AGENCY_SEEDANCE_SINGLE_PASS_MS: "" }), 0);
  assert.equal(singlePassMsFromEnv({ GHOST_AGENCY_SEEDANCE_SINGLE_PASS_MS: "0" }), 0);
  assert.equal(singlePassMsFromEnv({ GHOST_AGENCY_SEEDANCE_SINGLE_PASS_MS: "not-a-number" }), 0);
  assert.equal(singlePassMsFromEnv({ GHOST_AGENCY_SEEDANCE_SINGLE_PASS_MS: "-5" }), 0);
  assert.equal(singlePassMsFromEnv({ GHOST_AGENCY_SEEDANCE_SINGLE_PASS_MS: "240000" }), 240_000);
  assert.equal(
    singlePassMsFromEnv({ GHOST_AGENCY_SEEDANCE_SINGLE_PASS_MS: "999999999" }),
    6 * 60 * 60 * 1000,
  );
});

test("default desktop behavior is unchanged when the single-pass env is absent", async () => {
  let waves = 0;
  const returned = await runLoop({ ...CONFIG, continuous: false }, {
    write: () => {},
    runWaveImpl: async () => { waves += 1; return IDLE; },
  });
  assert.equal(returned.status, "idle");
  assert.equal(waves, 1, "no budget env means the pre-existing single-wave return still holds");
  assert.equal(singlePassMsFromEnv(), 0, "an unset env var never injects a budget");
});
