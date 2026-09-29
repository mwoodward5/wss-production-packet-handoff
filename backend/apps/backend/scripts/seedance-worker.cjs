#!/usr/bin/env node
"use strict";

const {
  claimJob,
  configFromEnv,
  configFromLaunchCapsule,
  processJob,
  requestLaunchCapsule,
} = require("../lib/hero-seedance-runner");

const MAX_LAUNCH_CAPSULE_BYTES = 8 * 1024;
const MAX_CAPABILITY_CONFLICT_RETRIES = 2;
const MAX_CAPABILITY_CONFLICT_BACKOFF_MS = 5_000;
// A scheduled-runner invocation (GitHub Actions cron) must exit before its job
// ceiling so successive ticks keep draining the queue without overlapping
// generations. Actions jobs hard-stop at 6 hours.
const MAX_SINGLE_PASS_MS = 6 * 60 * 60 * 1000;

function singlePassMsFromEnv(env = process.env) {
  const raw = String((env && env.GHOST_AGENCY_SEEDANCE_SINGLE_PASS_MS) || "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_SINGLE_PASS_MS);
}

function failureText(error) {
  return String((error && error.message) || error || "").trim();
}

function failureStatus(error) {
  for (const value of [error?.status, error?.httpStatus, error?.statusCode, error?.response?.status]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  const match = failureText(error).match(/(?:http(?:_status)?|status)\s*[:=_-]?\s*(401|403|409)\b/i);
  return match ? Number(match[1]) : 0;
}

function authorizationFailure(error) {
  const status = failureStatus(error);
  return status === 401 || status === 403 || /(?:^|[_\s-])(?:unauthorized|forbidden)(?:$|[_\s-])/i.test(failureText(error));
}

function conflictFailure(error) {
  return failureStatus(error) === 409 || /(?:^|[_\s-])(?:capability|grant|lease|replay|target)[_\s-].*conflict|(?:^|[_\s-])conflict(?:$|[_\s-])/i.test(failureText(error));
}

async function withBoundedConflictBackoff(operation, config) {
  const sleep = typeof config.sleepImpl === "function"
    ? config.sleepImpl
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const baseMs = Math.max(250, Math.min(1_000, Number(config.idleMs) || 1_000));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!conflictFailure(error) || attempt >= MAX_CAPABILITY_CONFLICT_RETRIES) throw error;
      await sleep(Math.min(baseMs * (2 ** attempt), MAX_CAPABILITY_CONFLICT_BACKOFF_MS));
    }
  }
}

function plainConfigForSlot(config, workerId) {
  return {
    ...config,
    workerId,
    capabilityMode: false,
    capabilityPhase: "",
    jobCapability: "",
    capabilityRedemptionId: "",
  };
}

function practiceTargeted(config = {}) {
  return config.practiceOnly === true
    || Boolean(String(config.practiceBatchId || "").trim())
    || Boolean(String(config.practiceRowId || "").trim());
}

async function plainClaimForSlot(config, workerId, claim) {
  // The plain worker endpoint is intentionally queue-wide. It cannot carry the
  // exact batch/row restriction that makes a Practice worker owner-only, so a
  // scoped worker must retry its broker path instead of claiming unrelated
  // work after a 409.
  if (practiceTargeted(config)) {
    const error = new Error("seedance_practice_plain_claim_forbidden");
    error.code = "seedance_practice_plain_claim_forbidden";
    throw error;
  }
  const plainConfig = plainConfigForSlot(config, workerId);
  const job = await withBoundedConflictBackoff(() => claim(plainConfig), plainConfig);
  return { config: plainConfig, job };
}

async function runWave(config, options = {}) {
  const claim = options.claimJobImpl || claimJob;
  const process = options.processJobImpl || processJob;
  if (config.capabilityMode) {
    if (config.continuous || Number(config.parallelism) !== 1) throw new Error("seedance_capability_one_shot_required");
    const exactJob = await claim(config);
    if (!exactJob) return { status: "idle", claimed: 0, results: [] };
    const result = await process(config, exactJob);
    return { status: "worked", claimed: 1, results: [result] };
  }
  const broker = options.requestLaunchCapsuleImpl || requestLaunchCapsule;
  // Broker + redeem serially so each server-selected row owns its lease before
  // the next selection. Provider generation still runs concurrently below;
  // this prevents ten simultaneous broker reads from all selecting one row.
  const slots = [];
  for (let index = 0; index < config.parallelism; index += 1) {
    const workerId = `${config.workerId}-${index + 1}`;
    let oneShot = null;
    let exactJob = null;
    let capsule;
    try {
      capsule = await withBoundedConflictBackoff(
        () => broker({ ...config, workerId }),
        config,
      );
    } catch (brokerError) {
      if (authorizationFailure(brokerError)) throw brokerError;
      if (!conflictFailure(brokerError)) throw brokerError;
      // The broker request itself can abort after bounded conflict retries.
      // Plain-claim this slot so one bad capability candidate cannot starve
      // the wave, while keeping the original worker credential/config.
      const fallback = await plainClaimForSlot(config, workerId, claim);
      oneShot = fallback.config;
      exactJob = fallback.job;
      if (!exactJob) continue;
      slots.push({ oneShot, exactJob });
      continue;
    }
    if (!capsule) break;
    try {
      oneShot = configFromLaunchCapsule(capsule, {}, {
        ...config,
        workerId,
      });
      exactJob = await withBoundedConflictBackoff(() => claim(oneShot), oneShot);
    } catch (capabilityError) {
      if (authorizationFailure(capabilityError)) throw capabilityError;
      if (!conflictFailure(capabilityError)) throw capabilityError;
      // A confirmed capability conflict can still remain after bounded 409
      // retries. Fall back once to the plain lease path for this slot. Never
      // do this for a timeout/5xx/unknown error: the capability claim may have
      // committed before its response was lost, and a second claim would
      // orphan that lease and process a different row.
      const fallback = await plainClaimForSlot(config, workerId, claim);
      oneShot = fallback.config;
      exactJob = fallback.job;
    }
    if (!exactJob) continue;
    slots.push({ oneShot, exactJob });
  }
  const results = await Promise.all(slots.map(({ oneShot, exactJob }) => process(oneShot, exactJob)));
  return results.length
    ? { status: "worked", claimed: results.length, results }
    : { status: "idle", claimed: 0, results: [] };
}

async function runLoop(config, options = {}) {
  const write = options.write || ((line) => process.stdout.write(`${line}\n`));
  const waveImpl = options.runWaveImpl || runWave;
  // A continuous worker must outlive transient conditions. Both 08-27 deaths
  // were top-level throws on a single bad wave (queue unreachable during a
  // deploy swap, an auth rotation window) — the process exited, leases died,
  // and every pending row pended forever. Log, back off, keep looping.
  const MAX_CONSECUTIVE_WAVE_FAILURES = Number(process.env.GHOST_AGENCY_SEEDANCE_MAX_WAVE_FAILURES || 30) || 30;
  // Single-pass mode (GHOST_AGENCY_SEEDANCE_SINGLE_PASS_MS): a time-bounded
  // invocation for scheduled runners. The loop keeps draining waves until the
  // budget expires, then exits cleanly. The budget is only checked BETWEEN
  // waves so an in-flight generation always settles its lease before exit — a
  // mid-wave abort would orphan leases server-side for the full lease hour.
  // Fatal conditions (auth refused, failure cap) throw instead of logging
  // "gave_up" so the hosting CI run fails loudly rather than exiting 0.
  const singlePassMs = Math.max(0, Math.floor(Number(config.singlePassMs) || 0));
  const singlePassFatal = singlePassMs > 0;
  const singlePassStartedAtMs = Date.now();
  const singlePassRemainingMs = () => (singlePassMs ? Math.max(0, singlePassMs - (Date.now() - singlePassStartedAtMs)) : Infinity);
  let singlePassClaimed = 0;
  let consecutiveFailures = 0;
  for (;;) {
    if (singlePassMs && Date.now() - singlePassStartedAtMs >= singlePassMs) {
      const summary = {
        status: "single_pass_complete",
        elapsed_ms: Date.now() - singlePassStartedAtMs,
        claimed: singlePassClaimed,
      };
      write(JSON.stringify({ at: new Date().toISOString(), ...summary }));
      return summary;
    }
    let wave;
    try {
      wave = await waveImpl(config, options);
      consecutiveFailures = 0;
      // Test/ops stop sentinel: runWave never returns this shape.
      if (wave && wave.status === "stop") return { status: "stopped", claimed: 0, results: [] };
    } catch (error) {
      consecutiveFailures += 1;
      const authRefused = authorizationFailure(error);
      write(JSON.stringify({
        at: new Date().toISOString(),
        status: "wave_error",
        consecutive: consecutiveFailures,
        error: failureText(error).slice(0, 200),
      }));
      if (authRefused) {
        const reason = "worker_auth_refused";
        write(JSON.stringify({ at: new Date().toISOString(), status: "gave_up", reason, consecutive: consecutiveFailures }));
        // Continuous workers stop without retrying stale credentials. A
        // one-shot capability invocation or a bounded single-pass invocation
        // must still reject so its process exits non-zero instead of
        // reporting a false success.
        if (!config.continuous || singlePassFatal) throw error;
        return { status: "gave_up", reason, claimed: 0, results: [] };
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_WAVE_FAILURES) {
        const reason = "consecutive_wave_failures";
        write(JSON.stringify({ at: new Date().toISOString(), status: "gave_up", reason, consecutive: consecutiveFailures }));
        if (singlePassFatal) throw error;
        return { status: "gave_up", reason, claimed: 0, results: [] };
      }
      if (!config.continuous) throw error;
      const backoffMs = Math.min(config.idleMs * consecutiveFailures, 60_000);
      await config.sleepImpl(Math.max(config.idleMs, backoffMs));
      continue;
    }
    singlePassClaimed += Number(wave && wave.claimed) || 0;
    write(JSON.stringify({ at: new Date().toISOString(), ...wave }));
    if (!config.continuous && !singlePassMs) return wave;
    if (singlePassMs) {
      // A scheduled single-pass invocation that found nothing to claim has no
      // reason to idle out its whole budget — exit after one empty wave so a
      // */5 cron costs seconds, not minutes, when the queue is dry.
      if (!wave.claimed && singlePassClaimed === 0) {
        const summary = {
          status: "single_pass_complete",
          elapsed_ms: Date.now() - singlePassStartedAtMs,
          claimed: 0,
        };
        write(JSON.stringify({ at: new Date().toISOString(), ...summary }));
        return summary;
      }
      // Never idle-past the budget: trim the idle sleep to what remains so the
      // next loop iteration lands on the expiry check.
      const idleSleepMs = wave.claimed ? 50 : Math.min(config.idleMs, singlePassRemainingMs());
      await config.sleepImpl(idleSleepMs);
      continue;
    }
    await config.sleepImpl(wave.claimed ? 50 : config.idleMs);
  }
}

async function readBoundedLaunchCapsule(stream = process.stdin, maxBytes = MAX_LAUNCH_CAPSULE_BYTES) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const value = Buffer.from(chunk);
    bytes += value.length;
    if (bytes > maxBytes) throw new Error("seedance_launch_capsule_too_large");
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv.slice(2);
  const capabilityMode = argv.includes("--capability-stdin") || argv.includes("--once");
  let config;
  if (capabilityMode) {
    if (
      argv.length !== 2
      || !argv.includes("--capability-stdin")
      || !argv.includes("--once")
      || argv.some((arg) => /wss1\.|capability=/i.test(String(arg)))
    ) throw new Error("seedance_capability_cli_invalid");
    const capsule = await readBoundedLaunchCapsule(options.stdin || process.stdin);
    config = configFromLaunchCapsule(capsule, options.env || process.env, options.configOverrides || {});
    if (config.capabilityPhase === "generate" && !config.openrouterApiKey) {
      throw new Error("OPENROUTER_API_KEY_required");
    }
  } else {
    if (argv.length) throw new Error("seedance_worker_arguments_invalid");
    const env = options.env || process.env;
    const singlePassMs = singlePassMsFromEnv(env);
    const configOverrides = { ...(options.configOverrides || {}) };
    if (singlePassMs) configOverrides.singlePassMs = singlePassMs;
    config = configFromEnv(env, configOverrides);
    if (!config.workerToken) throw new Error("GHOST_AGENCY_HERO_WORKER_TOKEN_required");
    if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY_required");
  }
  return runLoop(config, options);
}

module.exports = {
  MAX_LAUNCH_CAPSULE_BYTES,
  main,
  readBoundedLaunchCapsule,
  runLoop,
  runWave,
  singlePassMsFromEnv,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`seedance-worker: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
