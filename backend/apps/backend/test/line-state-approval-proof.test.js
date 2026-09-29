"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const lineState = require("../lib/line-state");

const APPROVED_AT = "2026-08-14T12:00:00.000Z";

function queuedBatch(batchId = "line_legacy_proof") {
  const batch = lineState.newBatch({ batchId, lane: "sandbox", now: APPROVED_AT });
  let row = lineState.newRow({ prospectId: "p1", now: APPROVED_AT });
  row = lineState.advanceRow(row, "qualified", { now: APPROVED_AT }).row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://p1.wss-ai.com/", now: APPROVED_AT }).row;
  row = lineState.applyGate(row, { pass: true, failed: [], checks: [] }, { now: APPROVED_AT }).row;
  row = lineState.advanceRow(row, "queued", { previewUrl: row.previewUrl, now: APPROVED_AT }).row;
  batch.status = "awaiting_approval";
  batch.rows = [row];
  return batch;
}

test("approveBatch durably stamps the exact legacy proof required for sending", () => {
  const batch = queuedBatch();
  const approved = lineState.approveBatch(batch, {
    typedBatchId: batch.batchId,
    actor: "owner",
    now: APPROVED_AT,
  });

  assert.equal(approved.ok, true);
  assert.deepEqual(approved.batch.approval, {
    actor: "owner",
    at: APPROVED_AT,
    approvedRows: 1,
    typedBatchId: batch.batchId,
  });
  assert.equal(lineState.assertSendAuthorized(approved.batch), true);
  assert.equal(lineState.sendableRows(approved.batch).length, 1);
});

test("forged approved legacy snapshots fail closed when any durable proof is missing", () => {
  const base = queuedBatch();
  base.status = "approved";
  const cases = [
    { label: "approval timestamp", approval: { typedBatchId: base.batchId, approvedRows: 1 }, error: /no_operator_approval/ },
    { label: "valid approval timestamp", approval: { at: "not-a-date", typedBatchId: base.batchId, approvedRows: 1 }, error: /invalid_approval_timestamp/ },
    { label: "exact batch echo", approval: { at: APPROVED_AT, typedBatchId: `${base.batchId}_other`, approvedRows: 1 }, error: /approval_batch_mismatch/ },
    { label: "positive approved row count", approval: { at: APPROVED_AT, typedBatchId: base.batchId, approvedRows: 0 }, error: /no_approved_rows/ },
  ];

  for (const item of cases) {
    const forged = { ...base, approval: item.approval };
    assert.deepEqual(lineState.sendableRows(forged), [], `${item.label} must gate sendable rows`);
    assert.throws(() => lineState.assertSendAuthorized(forged), item.error, `${item.label} must gate send mutation`);
  }
});

test("approval proof remains valid while a legacy batch resumes a partial send", () => {
  const batch = queuedBatch("line_legacy_partial");
  const second = { ...batch.rows[0], prospectId: "p2" };
  batch.rows = [batch.rows[0], second];
  const approved = lineState.approveBatch(batch, {
    typedBatchId: batch.batchId,
    actor: "owner",
    now: APPROVED_AT,
  }).batch;

  approved.rows[0] = { ...approved.rows[0], status: "sent" };
  assert.equal(approved.approval.approvedRows, 2);
  assert.equal(lineState.assertSendAuthorized(approved), true);
  assert.deepEqual(lineState.sendableRows(approved).map((row) => row.prospectId), ["p2"]);
});
