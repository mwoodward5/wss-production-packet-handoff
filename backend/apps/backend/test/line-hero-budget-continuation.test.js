"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const heroBudget = require("../lib/line-hero-budget");
const { createLineContinuation } = require("../lib/line-continuation");
const { QUOTA_CONTRACT_STAGE } = require("../lib/line-quota");

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function exhaustedPracticeBatch() {
  const batchId = "batch_one_site_paid_candidate_cap";
  const rowId = "row_paid_candidate_0";
  const prospectId = "prospect_paid_candidate_0";
  return {
    batchId,
    lane: "sandbox",
    target: "plumber in Austin TX",
    requested: 1,
    status: "building",
    pickState: "complete",
    version: 0,
    mineFunnel: [{ stage: QUOTA_CONTRACT_STAGE, entered: 1 }],
    rows: [{
      batchId,
      rowId,
      rowIndex: 0,
      prospectId,
      status: "error",
      version: 2,
      heroStartCheckpointed: true,
      heroStartCheckpoint: heroBudget.make({
        disposition: "qualified",
        batchId,
        rowId,
        prospectId,
        generationRevision: 0,
      }),
    }],
    startedAt: "2026-08-30T00:00:00.000Z",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}

function persistenceHarness(initial) {
  let batch = clone(initial);
  const stores = [];
  return {
    stores,
    current: () => clone(batch),
    persistence: {
      async loadBatch(batchId) {
        assert.equal(batchId, batch.batchId);
        return { ok: true, batch: clone(batch) };
      },
      async storeBatch({ batchId, expectedVersion, expectedStatus, patch }) {
        assert.equal(batchId, batch.batchId);
        if (Number(batch.version) !== Number(expectedVersion)
          || (expectedStatus && batch.status !== expectedStatus)) {
          return { ok: false, conflict: true, error: "batch_version_conflict" };
        }
        stores.push(clone({ expectedVersion, expectedStatus, patch }));
        batch = {
          ...batch,
          ...clone(patch),
          version: Number(batch.version) + 1,
          updatedAt: "2026-08-30T00:00:01.000Z",
        };
        return { ok: true, updated: true, batch: clone(batch) };
      },
      async claimRows() {
        return { ok: true, rows: [] };
      },
    },
  };
}

test("an unfinished one-site Practice batch halts in the same pass after its paid candidate slot is consumed", async () => {
  const harness = persistenceHarness(exhaustedPracticeBatch());
  let pickCalls = 0;
  let queueCalls = 0;
  const service = createLineContinuation({
    persistence: harness.persistence,
    rowFanout: false,
    pick: async () => {
      pickCalls += 1;
      throw new Error("source_must_not_run");
    },
    enqueueLineMessage: async () => {
      queueCalls += 1;
      throw new Error("continuation_must_not_publish");
    },
    clock: () => Date.parse("2026-08-30T00:00:02.000Z"),
    now: () => "2026-08-30T00:00:02.000Z",
  });

  const result = await service.processLineMessage({
    batchId: "batch_one_site_paid_candidate_cap",
    phase: "run",
    sequence: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "halted");
  assert.equal(harness.current().status, "halted");
  assert.equal(
    harness.current().haltReason,
    "hero_paid_candidate_budget_exhausted:0_of_1",
  );
  assert.equal(harness.current().pickState, "complete");
  assert.equal(pickCalls, 0);
  assert.equal(queueCalls, 0);
  assert.deepEqual(
    harness.stores.map((entry) => [entry.expectedStatus, entry.patch.status]),
    [["building", "running"], ["running", "halted"]],
  );
});
