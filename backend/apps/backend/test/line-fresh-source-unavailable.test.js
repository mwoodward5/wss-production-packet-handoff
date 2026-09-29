"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createLineContinuation } = require("../lib/line-continuation");
const { QUOTA_CONTRACT_STAGE } = require("../lib/line-quota");

test("empty All Trades donor registry halts before any picker or shelf read", async () => {
  let batch = {
    batchId: "batch-fresh-source-unavailable",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{ stage: QUOTA_CONTRACT_STAGE, entered: 10, survived: 0, rejected: {} }],
    rows: [],
    version: 0,
  };
  const persistence = {
    async loadBatch(batchId) {
      return batchId === batch.batchId
        ? { ok: true, batch: structuredClone(batch) }
        : { ok: false, error: "batch_not_found" };
    },
    async storeBatch({ batchId, expectedVersion, expectedStatus, patch }) {
      if (batchId !== batch.batchId
        || expectedVersion !== batch.version
        || expectedStatus !== batch.status) return { ok: false, conflict: true };
      batch = { ...batch, ...structuredClone(patch), version: batch.version + 1 };
      return { ok: true, batch: structuredClone(batch) };
    },
  };
  let pickCalls = 0;
  const service = createLineContinuation({
    persistence,
    pick: async () => { pickCalls += 1; return []; },
    nextQuotaSource: () => ({
      target: "",
      attempt: 0,
      mode: "fresh_source_unavailable",
      chunk: 0,
      unavailable: true,
      reason: "fresh_source_unavailable",
    }),
    enqueueLineMessage: async () => {
      throw new Error("halted source must not enqueue another pass");
    },
    clock: () => Date.parse("2026-08-27T20:00:00.000Z"),
    now: () => "2026-08-27T20:00:00.000Z",
    workerId: () => "worker-fresh-source-unavailable",
    rowFanout: false,
    inlinePickQualification: false,
  });

  const result = await service.processLineMessage({
    batchId: batch.batchId,
    phase: "run",
    sequence: 0,
  });

  assert.equal(pickCalls, 0, "neither fresh mining nor historical shelf selection may run");
  assert.equal(result.ok, false);
  assert.equal(result.error, "fresh_source_unavailable");
  assert.equal(result.status, "halted");
  assert.equal(batch.status, "halted");
  assert.equal(batch.pickState, "complete");
  assert.equal(batch.haltReason, "fresh_source_unavailable");
});
