"use strict";

// Tests for the parallel-claim mode added in hero-forge-worker.cjs.
// No browser, API, or storage calls escape this file — every external edge
// is injected via the options objects accepted by runParallelBatch /
// runWorkerLoop / parseParallelism.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runParallelBatch, runWorkerLoop, parseParallelism } = require("../scripts/ads-station/hero-forge-worker.cjs");

// ---------------------------------------------------------------------------
// parseParallelism — CLI / env parsing
// ---------------------------------------------------------------------------

test("parseParallelism defaults to 1 when no flag or env is provided", () => {
  delete process.env.HERO_WORKER_PARALLELISM;
  assert.equal(parseParallelism(["node", "script.cjs"]), 1);
});

test("parseParallelism reads --parallel=N from argv", () => {
  delete process.env.HERO_WORKER_PARALLELISM;
  assert.equal(parseParallelism(["node", "script.cjs", "--parallel=6"]), 6);
});

test("parseParallelism reads HERO_WORKER_PARALLELISM env var", () => {
  process.env.HERO_WORKER_PARALLELISM = "5";
  try {
    assert.equal(parseParallelism(["node", "script.cjs"]), 5);
  } finally {
    delete process.env.HERO_WORKER_PARALLELISM;
  }
});

test("parseParallelism argv takes precedence over env var", () => {
  process.env.HERO_WORKER_PARALLELISM = "3";
  try {
    assert.equal(parseParallelism(["node", "script.cjs", "--parallel=7"]), 7);
  } finally {
    delete process.env.HERO_WORKER_PARALLELISM;
  }
});

test("parseParallelism clamps out-of-range values to 1", () => {
  delete process.env.HERO_WORKER_PARALLELISM;
  assert.equal(parseParallelism(["node", "script.cjs", "--parallel=0"]), 1);
  assert.equal(parseParallelism(["node", "script.cjs", "--parallel=9"]), 1);
  assert.equal(parseParallelism(["node", "script.cjs", "--parallel=abc"]), 1);
});

test("parseParallelism accepts boundary values 1 and 8", () => {
  delete process.env.HERO_WORKER_PARALLELISM;
  assert.equal(parseParallelism(["node", "script.cjs", "--parallel=1"]), 1);
  assert.equal(parseParallelism(["node", "script.cjs", "--parallel=8"]), 8);
});

// ---------------------------------------------------------------------------
// runParallelBatch — core parallel-claim contract
// ---------------------------------------------------------------------------

test("runParallelBatch: N concurrent claims each get a distinct job", async () => {
  const claimedIds = [];
  let serial = 0;
  const worker = {
    claimJob: async () => { const id = `job_${++serial}`; claimedIds.push(id); return { job_id: id }; },
    processJob: async (j) => ({ status: "complete", reason: "ok" }),
  };
  const { anyJob, halt } = await runParallelBatch(worker, 5, { logImpl: () => {} });
  assert.equal(anyJob, true);
  assert.equal(halt, false);
  assert.equal(claimedIds.length, 5);
  // All IDs must be unique — each claim gets its own lease
  assert.equal(new Set(claimedIds).size, 5);
});

test("runParallelBatch: all jobs process concurrently — wall-clock ~ 1× not N×", async () => {
  const DELAY = 40; // ms each job "takes"
  const N = 5;
  const worker = {
    claimJob: async () => ({ job_id: `j${Math.random()}` }),
    processJob: async () => new Promise((res) => setTimeout(() => res({ status: "complete" }), DELAY)),
  };
  const start = Date.now();
  await runParallelBatch(worker, N, { logImpl: () => {} });
  const elapsed = Date.now() - start;
  // If sequential, elapsed ≥ N*DELAY. Parallel should finish in < 2*DELAY.
  assert.ok(elapsed < DELAY * 2, `elapsed ${elapsed}ms should be less than ${DELAY * 2}ms (sequential would be ${N * DELAY}ms)`);
});

test("runParallelBatch: one failed processJob never blocks the others", async () => {
  const processed = [];
  let serial = 0;
  const worker = {
    claimJob: async () => ({ job_id: `job_${++serial}` }),
    processJob: async (j) => {
      processed.push(j.job_id);
      if (j.job_id === "job_2") throw Object.assign(new Error("clip_failed"), { code: "clip_failed" });
      return { status: "complete" };
    },
  };
  const logs = [];
  const { anyJob } = await runParallelBatch(worker, 3, { logImpl: (...args) => logs.push(args.join(" ")) });
  assert.equal(anyJob, true);
  // All three were claimed and attempted
  assert.equal(processed.length, 3);
  // The error for job_2 was logged but didn't prevent job_1/job_3 from completing
  assert.ok(logs.some((l) => l.includes("clip_failed")), "error should be logged");
});

test("runParallelBatch: returns anyJob=false when all claims return null", async () => {
  const worker = {
    claimJob: async () => null,
    processJob: async () => { throw new Error("should not be called"); },
  };
  const { anyJob, halt } = await runParallelBatch(worker, 4, { logImpl: () => {} });
  assert.equal(anyJob, false);
  assert.equal(halt, false);
});

test("runParallelBatch: halt propagates when any processJob returns halt=true", async () => {
  let serial = 0;
  const worker = {
    claimJob: async () => ({ job_id: `job_${++serial}` }),
    processJob: async (j) => ({ status: "failed", halt: j.job_id === "job_1" }),
  };
  const { halt } = await runParallelBatch(worker, 3, { logImpl: () => {} });
  assert.equal(halt, true);
});

// ---------------------------------------------------------------------------
// runWorkerLoop — parallel mode integration
// ---------------------------------------------------------------------------

test("runWorkerLoop with parallelism=4 processes all N jobs and exits on --once with empty queue", async () => {
  const jobs = ["a", "b", "c", "d"].map((id) => ({ job_id: id }));
  let qi = 0;
  const processed = [];
  const worker = {
    claimJob: async () => jobs[qi++] || null,
    processJob: async (j) => { processed.push(j.job_id); return { status: "complete" }; },
  };
  await runWorkerLoop(worker, { once: true, parallelism: 4, pollMs: 1, logImpl: () => {} });
  assert.deepEqual(processed.sort(), ["a", "b", "c", "d"]);
});

test("runWorkerLoop with parallelism=1 falls back to sequential mode", async () => {
  const order = [];
  let serial = 0;
  const worker = {
    claimJob: async () => (serial < 3 ? { job_id: `job_${++serial}` } : null),
    processJob: async (j) => { order.push(j.job_id); return { status: "complete", halt: j.job_id === "job_3" }; },
  };
  await runWorkerLoop(worker, { once: false, parallelism: 1, pollMs: 1, logImpl: () => {} });
  assert.deepEqual(order, ["job_1", "job_2", "job_3"]);
});

test("runWorkerLoop parallel: a single failed job does not halt the pool or the loop", async () => {
  // First batch: 3 jobs, one throws. Second batch: empty queue → once exits.
  const batches = [
    [{ job_id: "ok_1" }, { job_id: "fail_1" }, { job_id: "ok_2" }],
    [],
  ];
  let batchIdx = 0;
  let slotIdx = 0;
  const currentBatch = () => batches[batchIdx] || [];
  const worker = {
    claimJob: async () => {
      const b = currentBatch();
      const job = b[slotIdx++] || null;
      if (slotIdx >= 3) { batchIdx += 1; slotIdx = 0; }
      return job;
    },
    processJob: async (j) => {
      if (j.job_id === "fail_1") throw Object.assign(new Error("api_error"), { code: "api_error" });
      return { status: "complete" };
    },
  };
  // Should not throw; completes after second (empty) batch
  await runWorkerLoop(worker, { once: true, parallelism: 3, pollMs: 1, logImpl: () => {} });
});
