"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const human = require("../lib/line-continuation-human");

function queuedBatch({ lane = "sandbox" } = {}) {
  return {
    batchId: `line_${lane}_campaign`,
    lane,
    target: "all trades nationwide",
    requested: 1,
    status: "awaiting_approval",
    pickState: "complete",
    version: 5,
    startedAt: "2026-08-18T20:00:00.000Z",
    createdAt: "2026-08-18T20:00:00.000Z",
    updatedAt: "2026-08-18T20:01:00.000Z",
    approval: null,
    rows: [{ rowId: "row_1", status: "queued", gate: { pass: true } }],
  };
}

for (const lane of ["sandbox", "live"]) {
  test(`campaign continuation enforces the ${lane} approval contract`, async () => {
    let current = queuedBatch({ lane });
    const approvals = [];
    const publications = [];
    const persistence = {
      async listBatches() { return { ok: true, batches: [] }; },
      async loadBatch(id) {
        return id === current.batchId ? { ok: true, batch: current } : { ok: false, error: "batch_not_found" };
      },
      async approveBatch(input) {
        approvals.push(input);
        current = {
          ...current,
          status: "approved",
          version: current.version + 1,
          approval: {
            actor: input.actor,
            at: "2026-08-18T20:02:00.000Z",
            approvedRows: input.approvedRows,
            typedBatchId: input.typedBatchId,
          },
        };
        return { ok: true, batch: current };
      },
      async storeBatch() { return { ok: true }; },
    };
    const production = {
      async processLineMessage() {
        return { ok: true, status: "awaiting_approval", processed: 1 };
      },
      async rescueLineBatches() { return { ok: true }; },
      async publishNext(batch, phase) {
        publications.push({ batch, phase });
        return { accepted: true };
      },
    };
    const service = human.createHumanContinuation({ persistence, production, environment: {} });
    const result = await service.processLineMessage({
      batchId: current.batchId,
      phase: "run",
      sequence: 5,
    });

    if (lane === "sandbox") {
      assert.equal(result.status, "approved");
      assert.equal(result.campaignApproved, true);
      assert.equal(result.deliveryQueued, true);
      assert.equal(approvals.length, 1);
      assert.equal(approvals[0].typedBatchId, current.batchId);
      assert.equal(approvals[0].approvedRows, 1);
      assert.equal(approvals[0].actor, "campaign_start_sandbox");
      assert.equal(publications.length, 1);
      assert.equal(publications[0].phase, "send");
      assert.equal(publications[0].batch.status, "approved");
    } else {
      assert.equal(result.status, "awaiting_approval");
      assert.notEqual(result.campaignApproved, true);
      assert.equal(approvals.length, 0, "live continuation must not mint owner approval");
      assert.equal(publications.length, 0, "live continuation must not publish send work");
    }
  });
}

test("live authorization helper always returns the explicit owner gate without mutating", async () => {
  const batch = queuedBatch({ lane: "live" });
  let approvals = 0;
  let publications = 0;
  const service = human.createHumanContinuation({
    persistence: {
      async listBatches() { return { ok: true, batches: [] }; },
      async loadBatch() { return { ok: true, batch }; },
      async approveBatch() { approvals += 1; return { ok: false }; },
      async storeBatch() { return { ok: true }; },
    },
    production: {
      async processLineMessage() { return { ok: true }; },
      async rescueLineBatches() { return { ok: true }; },
      async publishNext() { publications += 1; return { accepted: true }; },
    },
    environment: {},
  });

  const result = await service.authorizeAndPublishSettledBatch(batch.batchId);
  assert.deepEqual(result, {
    approved: false,
    skipped: "explicit_owner_approval_required",
    lane: "live",
    queued: 1,
    awaitingApproval: true,
  });
  assert.equal(approvals, 0);
  assert.equal(publications, 0);
});

test("campaign authorization never materializes before a row has passed QC into queued", async () => {
  const batch = queuedBatch({ lane: "sandbox" });
  batch.status = "building";
  batch.rows = [{ rowId: "row_1", status: "mirrored", gate: null }];
  let approvals = 0;
  const service = human.createHumanContinuation({
    persistence: {
      async listBatches() { return { ok: true, batches: [] }; },
      async loadBatch() { return { ok: true, batch }; },
      async approveBatch() { approvals += 1; return { ok: false }; },
      async storeBatch() { return { ok: true }; },
    },
    production: {
      async processLineMessage() { return { ok: true, status: "building", processed: 1 }; },
      async rescueLineBatches() { return { ok: true }; },
      async publishNext() { throw new Error("must not publish send"); },
    },
    environment: {},
  });
  const result = await service.processLineMessage({ batchId: batch.batchId, phase: "run", sequence: 5 });
  assert.equal(result.status, "building");
  assert.equal(approvals, 0);
});
