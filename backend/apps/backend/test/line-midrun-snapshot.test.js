"use strict";

/**
 * test/line-midrun-snapshot.test.js — a killed run must not read back empty.
 *
 * putBatch() wrote the durable snapshot at exactly two moments: batch CREATION
 * (status "running", zero rows, nothing built) and SETTLE. Everything between
 * lived only in that lambda's memory. A run long enough to be killed by the
 * platform therefore left the CREATION snapshot as the only durable record —
 * and the console, reading the durable list, drew a batch with zero rows for a
 * run whose mirrors were live and queued in the store.
 *
 * Measured 2026-08-07: batch line_msijhqud_7f085bf9 built eleven mirrors and
 * queued four; its POST died at the gateway; every later read of that batch —
 * by id and from the durable list — returned total:0, rows:[]. The four
 * queued mirrors were sitting in ghost_agency_prospects the whole time.
 *
 * So the run loop now checkpoints as it goes. Canonical persistence also
 * checkpoints phase transitions (qualified, mirrored, gate-passed, queued),
 * which means the useful contract is monotonic recoverability rather than an
 * exact number of snapshots.
 */
const test = require("node:test");
const assert = require("node:assert");

const runner = require("../lib/line-runner");
const { SNAPSHOT_MIN_MS } = runner;

function rowsFor(n) {
  return Array.from({ length: n }, (_, i) => ({
    prospectId: `wss-test-p${i}`,
    businessName: `Business ${i}`,
    city: "Portland", state: "OR", vertical: "plumbing", email: `o${i}@example.com`,
    leadminerQualified: true,
  }));
}

/** Runs a batch, capturing every durable snapshot the runner asks for. */
async function runCapturing(count, { failAt = -1 } = {}) {
  runner.resetBatches();
  const snapshots = [];
  let clock = 1_000_000;
  const result = await runner.startBatch(
    { count: 10, target: "", lane: "sandbox" },
    {
      env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
      pick: async () => rowsFor(count),
      qualify: async () => ({ ok: true }),
      mirror: async (row) => {
        if (Number(row.prospectId.replace(/\D/g, "")) === failAt) return { ok: false, reason: "boom" };
        return { ok: true, previewUrl: `https://${row.prospectId}.wss-ai.com/` };
      },
      sourceFacts: async () => ({}),
      prepareHero: async () => ({ ok: true, required: false, ready: true }),
      gate: async () => ({ ok: true, pass: true, checks: [] }),
      writePreviewUrl: async () => ({ ok: true }),
      queueEmail: async () => ({ ok: true }),
      // Substitute the durable write so the test observes it without a network.
      snapshot: (b) => {
        clock += 20_000; // each row takes longer than the throttle window
        snapshots.push({ rows: (b.rows || []).length, done: (b.rows || []).filter((r) => r.status === "queued").length });
      },
    },
  );
  return { result, snapshots };
}

test("the run checkpoints DURING the loop, not only at the end", async () => {
  const { result, snapshots } = await runCapturing(4);
  assert.equal(result.ok, true);
  assert.ok(snapshots.length >= 4, `expected a checkpoint per row, got ${snapshots.length}`);
  // Phase checkpoints may repeat a completed count, but recovery must never
  // move backwards and must observe every completed row before settlement.
  const completed = snapshots.map((s) => s.done);
  assert.ok(completed.every((value, index) => index === 0 || value >= completed[index - 1]));
  for (const expected of [1, 2, 3, 4]) assert.ok(completed.includes(expected));
  assert.equal(completed[completed.length - 1], 4);
});

test("a checkpoint carries every row, so a killed run is still recoverable", async () => {
  const { snapshots } = await runCapturing(3);
  assert.ok(snapshots.every((s) => s.rows === 3), "every snapshot holds the full row list");
});

test("a row that fails is checkpointed too — the operator must see the failure, not a gap", async () => {
  const { snapshots } = await runCapturing(3, { failAt: 1 });
  assert.ok(snapshots.length >= 3);
  assert.equal(snapshots[snapshots.length - 1].done, 2); // rows 0 and 2 queued, row 1 failed
});

test("the throttle suppresses a second write inside the window and allows it after", () => {
  runner.resetBatches();
  const batch = { batchId: "line_throttle_probe", rows: [], startedAt: "2026-08-07T00:00:00.000Z" };
  let t = 5_000_000;
  const at = (ms) => { t = ms; return t; };
  // First call for a batch ALWAYS writes: a run that dies on row two must
  // leave more than the empty creation snapshot.
  assert.equal(runner.snapshotThrottled(batch, { clock: () => at(5_000_000) }), true);
  assert.equal(runner.snapshotThrottled(batch, { clock: () => at(5_000_000 + SNAPSHOT_MIN_MS - 1) }), false);
  assert.equal(runner.snapshotThrottled(batch, { clock: () => at(5_000_000 + SNAPSHOT_MIN_MS) }), true);
});

test("a suppressed checkpoint still keeps the in-memory batch current", () => {
  runner.resetBatches();
  const batch = { batchId: "line_mem_probe", rows: [{ prospectId: "a" }], startedAt: "2026-08-07T00:00:00.000Z" };
  runner.snapshotThrottled(batch, { clock: () => 1000 });
  batch.rows.push({ prospectId: "b" });
  // Inside the throttle window: no durable write, but memory must not go stale.
  assert.equal(runner.snapshotThrottled(batch, { clock: () => 1001 }), false);
  assert.equal(runner.getBatch("line_mem_probe").rows.length, 2);
});
