"use strict";

// Shared bounded-concurrency pool for Intake Genie compiles. Firing every
// mined row's compile at one serverless function at once stretched each
// request past the caller's abort window and multiplied load timeouts into
// the "intake_genie_compile_retryable" funnel jam of 2026-08-26/27.

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const cap = Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 1);
  const queue = list.map((item, index) => ({ item, index }));
  const results = new Array(list.length);
  const lanes = Array.from({ length: Math.min(cap, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      results[next.index] = await worker(next.item);
    }
  });
  await Promise.all(lanes);
  return results;
}

function poolSize(env = process.env, key = "INTAKE_GENIE_COMPILE_CONCURRENCY", fallback = 25, max = 32) {
  const parsed = parseInt(env[key] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

module.exports = { mapWithConcurrency, poolSize };
