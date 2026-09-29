"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createLineContinuation,
  STALE_WORKER_MS,
} = require("../lib/line-continuation");

const START = Date.parse("2026-08-24T12:00:00.000Z");

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class SendRacePersistence {
  constructor() {
    this.time = START + STALE_WORKER_MS + 1_000;
    this.claimEntered = deferred();
    this.releaseFirstClaim = deferred();
    this.claimCalls = 0;
    this.batch = {
      batchId: "batch-send-ownership",
      lane: "live",
      target: "owner-approved-send",
      requested: 1,
      status: "approved",
      pickState: "complete",
      mineFunnel: [],
      approval: {
        actor: "operator",
        at: new Date(START).toISOString(),
        approvedRows: 1,
        typedBatchId: "batch-send-ownership",
      },
      haltReason: "",
      version: 7,
      startedAt: new Date(START).toISOString(),
      createdAt: new Date(START).toISOString(),
      updatedAt: new Date(START).toISOString(),
      settledAt: null,
      sentAt: null,
    };
    this.row = {
      rowId: "batch-send-ownership:0",
      batchId: "batch-send-ownership",
      rowIndex: 0,
      prospectId: "prospect-send-ownership",
      businessName: "Example Plumbing",
      city: "Reno",
      state: "NV",
      vertical: "plumbing",
      status: "queued",
      previewUrl: "https://example-plumbing.wss-ai.com",
      gate: { pass: true, failed: [] },
      failedFacts: [],
      reason: "",
      history: [{ status: "queued", at: new Date(START).toISOString() }],
      version: 3,
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      recipientFingerprint: "a".repeat(64),
      updatedAt: new Date(START).toISOString(),
    };
  }

  now() {
    return new Date(this.time).toISOString();
  }

  currentBatch({ includeRows = true } = {}) {
    return {
      ...clone(this.batch),
      rows: includeRows ? [clone(this.row)] : [],
    };
  }

  async loadBatch(batchId) {
    return batchId === this.batch.batchId
      ? { ok: true, batch: this.currentBatch() }
      : { ok: false, error: "batch_not_found" };
  }

  async listBatches({ statuses = [], includeRows = true } = {}) {
    if (statuses.length && !statuses.includes(this.batch.status)) return { ok: true, batches: [] };
    return { ok: true, batches: [this.currentBatch({ includeRows })] };
  }

  async storeBatch({ batchId, expectedVersion, expectedStatus, patch }) {
    if (batchId !== this.batch.batchId
      || expectedVersion !== this.batch.version
      || (expectedStatus && expectedStatus !== this.batch.status)) {
      return { ok: false, conflict: true, error: "batch_version_conflict" };
    }
    this.batch = {
      ...this.batch,
      ...clone(patch),
      version: this.batch.version + 1,
      updatedAt: this.now(),
    };
    return { ok: true, updated: true, batch: this.currentBatch() };
  }

  async claimRows({ batchId, workerId, leaseMs, statuses }) {
    this.claimCalls += 1;
    const claimNumber = this.claimCalls;
    if (claimNumber === 1) {
      this.claimEntered.resolve();
      await this.releaseFirstClaim.promise;
    }
    if (batchId !== this.batch.batchId
      || !statuses.includes(this.row.status)
      || (this.row.leaseToken && Date.parse(this.row.leaseExpiresAt) > this.time)) {
      return { ok: true, rows: [] };
    }
    this.row = {
      ...this.row,
      version: this.row.version + 1,
      leaseToken: `lease-${claimNumber}`,
      leaseOwner: workerId,
      leaseExpiresAt: new Date(this.time + leaseMs).toISOString(),
      attemptCount: this.row.attemptCount + 1,
      updatedAt: this.now(),
    };
    return { ok: true, rows: [clone(this.row)] };
  }

  async checkpointRow({ rowId, leaseToken, expectedVersion, expectedStatus, row, releaseLease = true }) {
    if (rowId !== this.row.rowId
      || leaseToken !== this.row.leaseToken
      || expectedVersion !== this.row.version
      || expectedStatus !== this.row.status) {
      return { ok: false, conflict: true, error: "row_checkpoint_conflict" };
    }
    this.row = {
      ...clone(row),
      rowId: this.row.rowId,
      batchId: this.row.batchId,
      rowIndex: this.row.rowIndex,
      prospectId: this.row.prospectId,
      version: this.row.version + 1,
      leaseToken: releaseLease ? null : this.row.leaseToken,
      leaseOwner: releaseLease ? null : this.row.leaseOwner,
      leaseExpiresAt: releaseLease ? null : this.row.leaseExpiresAt,
      attemptCount: this.row.attemptCount,
      updatedAt: this.now(),
    };
    return { ok: true, updated: true, row: clone(this.row) };
  }
}

test("a fresh durable send owner cannot be reclaimed before its first row lease", async () => {
  const persistence = new SendRacePersistence();
  let deliveries = 0;
  const service = createLineContinuation({
    persistence,
    clock: () => persistence.time,
    now: () => persistence.now(),
    workerId: () => "send-worker-primary",
    enqueueLineMessage: async () => ({ accepted: true }),
    createLineSender: () => async () => {
      deliveries += 1;
      return {
        ok: true,
        providerReceipt: "provider-receipt-send-owner",
        idempotencyKey: "provider-key-send-owner",
        acceptedAt: persistence.now(),
      };
    },
  });

  const activeSend = service.processLineMessage({
    batchId: persistence.batch.batchId,
    phase: "send",
    sequence: persistence.batch.version,
  }, { metadata: { messageId: "send-worker-primary" } });

  await persistence.claimEntered.promise;
  assert.equal(persistence.batch.status, "sending");
  assert.equal(persistence.row.leaseToken, null, "the regression window is before row lease acquisition");
  const watch = persistence.batch.mineFunnel.find((row) => row.stage === "line_start_watch_v1");
  assert.equal(watch.send_claim_owner, "send-worker-primary");
  assert.equal(watch.send_claimed_at, persistence.now());

  const rescued = await service.rescueLineBatches({ limit: 1 });
  assert.equal(rescued.processed, 0);
  assert.equal(persistence.batch.status, "sending", "rescue must not reopen an actively owned send");
  assert.equal(persistence.claimCalls, 1, "rescue must not create a second delivery claimant");
  assert.equal(deliveries, 0, "the paused primary remains the sole pre-provider claimant");

  persistence.releaseFirstClaim.resolve();
  const finished = await activeSend;
  assert.equal(finished.status, "done");
  assert.equal(persistence.claimCalls, 1);
  assert.equal(deliveries, 1);
  assert.equal(persistence.row.status, "sent");
});
