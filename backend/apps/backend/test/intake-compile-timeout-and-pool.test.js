"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { intakeCallTimeoutMs } = require("../lib/intake-genie-client");
const { mapWithConcurrency, poolSize } = require("../lib/intake-pool");

test("intake call timeout defaults to the 180s clamp max beyond the old 60s self-abort", () => {
  assert.equal(intakeCallTimeoutMs({}), 180000);
});

test("intake call timeout honors env overrides within the service budget", () => {
  assert.equal(intakeCallTimeoutMs({ INTAKE_GENIE_TIMEOUT_MS: "120000" }), 120000);
});

test("intake call timeout clamps runaway values below the 300s function budgets", () => {
  assert.equal(intakeCallTimeoutMs({ INTAKE_GENIE_TIMEOUT_MS: "999999" }), 180000);
});

test("intake call timeout keeps the legacy floor for tiny or garbage values", () => {
  assert.equal(intakeCallTimeoutMs({ INTAKE_GENIE_TIMEOUT_MS: "1000" }), 5000);
  assert.equal(intakeCallTimeoutMs({ INTAKE_GENIE_TIMEOUT_MS: "banana" }), 180000);
});

test("compile pool size is bounded to [1,32] with default 25 (fill-fast doctrine)", () => {
  assert.equal(poolSize({}), 25, "default 25-wide so prospect packets fill near-instantly");
  assert.equal(poolSize({ INTAKE_GENIE_COMPILE_CONCURRENCY: "2" }), 2);
  assert.equal(poolSize({ INTAKE_GENIE_COMPILE_CONCURRENCY: "64" }), 32, "hard ceiling 32");
  assert.equal(poolSize({ INTAKE_GENIE_COMPILE_CONCURRENCY: "banana" }), 25);
  assert.equal(poolSize({ INTAKE_GENIE_COMPILE_CONCURRENCY: "-4" }), 1);
});

test("mapWithConcurrency preserves input order while staying bounded", async () => {
  let active = 0;
  let peak = 0;
  const out = await mapWithConcurrency([3, 2, 6, 4, 1], 2, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, n));
    active -= 1;
    return n * 10;
  });
  assert.deepEqual(out, [30, 20, 60, 40, 10]);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded limit`);
});

test("mapWithConcurrency propagates worker failure instead of swallowing it", async () => {
  await assert.rejects(
    () => mapWithConcurrency([1, "boom"], 1, async (value) => {
      if (value === "boom") throw new Error("worker failed");
      return value;
    }),
    /worker failed/,
  );
});
