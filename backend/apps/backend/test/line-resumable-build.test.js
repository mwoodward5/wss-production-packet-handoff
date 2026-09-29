"use strict";

/**
 * test/line-resumable-build.test.js — a big Mine finishes across many calls.
 *
 * startBatch used to build the whole batch synchronously inside one 300s Vercel
 * function; past ~8 sites the lambda died and the rows froze. The SEND path was
 * already made resumable (budgetMs + startedAt, re-called until drained); this
 * pins the same shape for BUILD:
 *
 *   · budgetMs:0 (every existing test's default) builds the whole batch in one
 *     call, EXACTLY as before — the resume machinery is dead code for it;
 *   · budgetMs>0 stops claiming new rows on the clock, leaves the rest "picked",
 *     marks the batch "building" and returns {building:true, remaining};
 *   · a re-call with request.batchId continues the SAME batch — the already
 *     built rows are untouched and only the "picked" ones build;
 *   · seenLogoShas is re-seeded from the rows that already queued, so the
 *     one-logo-per-client guard survives across invocations.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const runner = require("../lib/line-runner");
const lineState = require("../lib/line-state");

const shaFor = (id) => createHash("sha256").update(String(id)).digest("hex");

/**
 * A deterministic harness: a shared clock the budget reads, advanced only by
 * the mirror step so "how much wall-clock a row costs" is exactly controllable.
 * Runs serially (concurrency 1) so the budget cut-off lands on a known row.
 */
function harness(plan, { perMirrorMs = 40, sharedSha = null } = {}) {
  const clk = { now: 0 };
  const calls = { mirror: [], gate: [] };
  const deps = {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    pick: async () => plan.map((p) => ({ ...p })),
    qualify: async () => ({ ok: true }),
    mirror: async (row) => {
      calls.mirror.push(row.prospectId);
      clk.now += perMirrorMs;
      return { ok: true, previewUrl: `https://${row.prospectId}.wss-ai.com/` };
    },
    sourceFacts: async () => ({}),
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    gate: async ({ source }) => {
      calls.gate.push(source.prospect_id);
      return {
        pass: true,
        failed: [],
        checks: [{
          fact: "logo_own_and_unique",
          pass: true,
          evidence: { sha256: sharedSha || shaFor(source.prospect_id) },
        }],
      };
    },
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
    onProgress: () => {},
    snapshot: () => {},
    haltCheck: async () => ({ halt: false, reason: "" }),
    concurrency: 1,
    budgetClock: () => clk.now,
  };
  return { deps, clk, calls };
}

function rows(n) {
  return Array.from({ length: n }, (_, i) => ({
    prospectId: `wss-test-p${i}`,
    businessName: `Business ${i}`,
    vertical: "plumbing",
    email: `o${i}@example.test`,
  }));
}

test("budgetMs:0 builds the whole batch in one call, exactly as before", async () => {
  runner.resetBatches();
  const { deps } = harness(rows(5));
  const result = await runner.startBatch({ count: 5, lane: "sandbox" }, { ...deps, budgetMs: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.building, undefined, "no budget means no building state");
  assert.equal(result.batch.status, "awaiting_approval");
  assert.equal(lineState.batchCounts(result.batch).queued, 5);
});

test("a spent budget stops claiming new rows and hands the batch back as building", async () => {
  runner.resetBatches();
  // Each mirror costs 40ms of the shared clock; a 100ms budget lets three rows
  // build (checked BEFORE claiming: 0, 40, 80 all < 100; at 120 it stops).
  const { deps } = harness(rows(5), { perMirrorMs: 40 });
  const result = await runner.startBatch(
    { count: 5, lane: "sandbox" },
    { ...deps, budgetMs: 100, startedAt: 0 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.building, true);
  assert.equal(result.remaining, 2);
  const batch = runner.getBatch(result.batchId);
  assert.equal(batch.status, "building");
  assert.equal(batch.settledAt, undefined, "a building batch is not settled");
  const statuses = batch.rows.map((r) => r.status);
  assert.deepEqual(statuses, ["queued", "queued", "queued", "picked", "picked"]);
  // A building batch is NOT approvable — it still holds rows that never ran.
  assert.equal(
    lineState.approveBatch(batch, { typedBatchId: batch.batchId }).error,
    "batch_still_running",
  );
});

test("a re-call with the batchId continues the same batch and only builds the picked rows", async () => {
  runner.resetBatches();
  const { deps, clk, calls } = harness(rows(5), { perMirrorMs: 40 });
  const first = await runner.startBatch(
    { count: 5, lane: "sandbox" },
    { ...deps, budgetMs: 100, startedAt: 0 },
  );
  assert.equal(first.building, true);
  assert.deepEqual(calls.mirror, ["wss-test-p0", "wss-test-p1", "wss-test-p2"]);

  // Continue with a fresh clock and no budget: it must finish the remaining two.
  clk.now = 0;
  const second = await runner.startBatch(
    { batchId: first.batchId, lane: "sandbox" },
    { ...deps, budgetMs: 0 },
  );
  assert.equal(second.ok, true);
  assert.equal(second.building, undefined);
  assert.equal(second.batchId, first.batchId, "the same batch, not a new mine");
  assert.equal(second.batch.status, "awaiting_approval");
  assert.equal(lineState.batchCounts(second.batch).queued, 5);
  // The already-built rows were NOT rebuilt — mirror ran only for the two that
  // were still picked.
  assert.deepEqual(calls.mirror, [
    "wss-test-p0", "wss-test-p1", "wss-test-p2", // pass one
    "wss-test-p3", "wss-test-p4",               // pass two only
  ]);
});

test("a continue of an unknown or already-settled batch does not resume it", async () => {
  runner.resetBatches();
  // No such batch, and no count: honest refusal, not a silent fresh mine.
  const { deps } = harness(rows(3));
  const miss = await runner.startBatch({ batchId: "line_nope" }, { ...deps, budgetMs: 0 });
  assert.equal(miss.ok, false);
  assert.equal(miss.error, "count_required");
});

test("the one-logo-per-client guard survives a resume: a logo claimed in pass one blocks a later row", async () => {
  runner.resetBatches();
  const shared = shaFor("one-and-only-logo");
  // Two DIFFERENT clients that would ship the same logo bytes. A 30ms budget vs
  // a 40ms mirror lets only the first row build in pass one.
  const { deps, clk } = harness(
    [
      { prospectId: "wss-test-first", businessName: "First", email: "a@x.test", vertical: "plumbing" },
      { prospectId: "wss-test-second", businessName: "Second", email: "b@x.test", vertical: "plumbing" },
    ],
    { perMirrorMs: 40, sharedSha: shared },
  );
  const first = await runner.startBatch(
    { count: 2, lane: "sandbox" },
    { ...deps, budgetMs: 30, startedAt: 0 },
  );
  assert.equal(first.building, true);
  assert.equal(first.batch.rows[0].status, "queued");
  assert.equal(first.batch.rows[1].status, "picked");

  // Pass two: the second row builds. Its logo sha is already owned by the first
  // client — re-seeded from the queued row — so it must be refused, not shipped.
  clk.now = 0;
  const second = await runner.startBatch(
    { batchId: first.batchId, lane: "sandbox" },
    { ...deps, budgetMs: 0 },
  );
  assert.equal(second.batch.rows[0].status, "queued");
  assert.equal(second.batch.rows[1].status, "gate_failed");
  assert.match(second.batch.rows[1].reason, /already shipped for wss-test-first/);
  assert.deepEqual(second.batch.rows[1].failedFacts, ["logo_own_and_unique"]);
});

test("a budget that expires with nothing left to build still settles, it does not report building", async () => {
  runner.resetBatches();
  // Budget large enough for all rows; the clock never crosses it, so this is the
  // ordinary settle even though a budget was supplied.
  const { deps } = harness(rows(3), { perMirrorMs: 10 });
  const result = await runner.startBatch(
    { count: 3, lane: "sandbox" },
    { ...deps, budgetMs: 1000, startedAt: 0 },
  );
  assert.equal(result.building, undefined);
  assert.equal(result.batch.status, "awaiting_approval");
  assert.equal(lineState.batchCounts(result.batch).queued, 3);
});
