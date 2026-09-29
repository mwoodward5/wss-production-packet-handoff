"use strict";

// Campaign stopwatch tests (2026-09-02 smoke-test bar). The timing fields are
// stamped on the EXISTING batch checkpoint writes at each phase transition:
//   - batch-level wall-clock firsts live in the mine_funnel timing row
//     (stage line_campaign_timing_v1): startedAt / firstQualifiedAt /
//     firstBuiltAt / firstGateAt / firstSentAt, each set once, never overwritten.
//   - every mine_funnel stage entry gets a one-time monotonic elapsedMs.
// The harness mirrors test/line-continuation.test.js but stays minimal: only
// the persistence surface the continuation touches in these flows.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CAMPAIGN_TIMING_STAGE,
  CAMPAIGN_TIMING_TRANSITIONS,
  campaignTimingFrom,
  createLineContinuation,
} = require("../lib/line-continuation");
const { lineDeliveryIdempotencyKey } = require("../lib/line-delivery");
const lineState = require("../lib/line-state");

const START = Date.parse("2026-09-02T12:00:00.000Z");
const RESUMABLE = new Set(["picked", "qualified", "mirrored", "gate_passed"]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function iso(ms) {
  return new Date(START + ms).toISOString();
}

function rowAt(status, overrides = {}) {
  const at = overrides.updatedAt || iso(0);
  return {
    rowId: overrides.rowId || "",
    batchId: overrides.batchId || "",
    rowIndex: overrides.rowIndex || 0,
    prospectId: overrides.prospectId || "prospect-1",
    businessName: "Example Roofing",
    city: "Austin",
    state: "TX",
    vertical: "roofing",
    status,
    previewUrl: ["gate_passed", "queued", "sent"].includes(status)
      ? "https://preview.example.test"
      : "",
    gate: ["gate_passed", "queued", "sent"].includes(status)
      ? { pass: true, failed: [] }
      : null,
    failedFacts: [],
    reason: "",
    history: [{ status, at }],
    version: overrides.version || 0,
    leaseToken: overrides.leaseToken || null,
    leaseOwner: overrides.leaseOwner || null,
    leaseExpiresAt: overrides.leaseExpiresAt || null,
    attemptCount: overrides.attemptCount || 0,
    updatedAt: at,
    ...overrides,
  };
}

class MemoryPersistence {
  constructor({ clock }) {
    this.clock = clock;
    this.batches = new Map();
    this.rows = new Map();
    this.serial = 0;
    this.stores = [];
  }

  iso() {
    return new Date(this.clock()).toISOString();
  }

  seed(batch, rows = []) {
    const now = this.iso();
    const saved = {
      batchId: batch.batchId,
      lane: batch.lane === "live" ? "live" : "sandbox",
      target: batch.target || "Austin, TX roofing",
      requested: batch.requested == null ? rows.length : batch.requested,
      status: batch.status || "building",
      pickState: batch.pickState || "complete",
      mineFunnel: batch.mineFunnel || {},
      approval: batch.approval || null,
      haltReason: batch.haltReason || "",
      version: batch.version || 0,
      startedAt: batch.startedAt || now,
      createdAt: batch.createdAt || now,
      updatedAt: batch.updatedAt || now,
      settledAt: batch.settledAt || null,
      sentAt: batch.sentAt || null,
    };
    this.batches.set(saved.batchId, saved);
    rows.forEach((input, index) => {
      const row = rowAt(input.status, {
        ...input,
        rowId: input.rowId || `${saved.batchId}:${index}`,
        batchId: saved.batchId,
        rowIndex: input.rowIndex == null ? index : input.rowIndex,
      });
      this.rows.set(row.rowId, row);
    });
    return this.currentBatch(saved.batchId);
  }

  currentBatch(batchId) {
    const batch = this.batches.get(batchId);
    if (!batch) return null;
    const rows = [...this.rows.values()]
      .filter((row) => row.batchId === batchId)
      .sort((left, right) => left.rowIndex - right.rowIndex)
      .map(clone);
    return { ...clone(batch), rows };
  }

  async loadBatch(batchId) {
    const batch = this.currentBatch(batchId);
    return batch ? { ok: true, batch } : { ok: false, error: "batch_not_found" };
  }

  async listBatches({ statuses, limit = 20, includeRows = true } = {}) {
    const wanted = new Set(statuses || []);
    const batches = [...this.batches.values()]
      .filter((batch) => !wanted.size || wanted.has(batch.status))
      .slice(0, limit)
      .map((batch) => (includeRows === false ? { ...clone(batch), rows: [] } : this.currentBatch(batch.batchId)));
    return { ok: true, batches };
  }

  async storeBatch({ batchId, expectedVersion, expectedStatus, patch }) {
    this.stores.push(clone({ batchId, expectedVersion, expectedStatus, patch }));
    const current = this.batches.get(batchId);
    if (!current
      || current.version !== expectedVersion
      || (expectedStatus && current.status !== expectedStatus)) {
      return { ok: false, conflict: true, error: "batch_version_conflict" };
    }
    const next = { ...current, ...clone(patch), version: current.version + 1, updatedAt: this.iso() };
    this.batches.set(batchId, next);
    return { ok: true, updated: true, batch: this.currentBatch(batchId) };
  }

  async storeRows({ batchId, rows }) {
    if (!this.batches.has(batchId)) return { ok: false, error: "batch_not_found" };
    for (let index = 0; index < rows.length; index += 1) {
      const input = rows[index];
      const rowId = input.rowId || `${batchId}:${index}`;
      if (this.rows.has(rowId)) continue;
      this.rows.set(rowId, rowAt(input.status || "picked", {
        ...clone(input),
        rowId,
        batchId,
        rowIndex: input.rowIndex == null ? index : input.rowIndex,
        version: 0,
        leaseToken: null,
        updatedAt: this.iso(),
      }));
    }
    return { ok: true, created: rows.length, rows: this.currentBatch(batchId).rows };
  }

  async claimRows({ batchId, rowId, workerId, limit = 1, leaseMs = 240_000, statuses }) {
    const wanted = new Set(statuses && statuses.length ? statuses : [...RESUMABLE]);
    const eligible = [...this.rows.values()]
      .filter((row) => row.batchId === batchId && wanted.has(row.status))
      .filter((row) => !rowId || row.rowId === rowId)
      .filter((row) => !row.leaseToken || !row.leaseExpiresAt || Date.parse(row.leaseExpiresAt) <= this.clock())
      .sort((left, right) => left.rowIndex - right.rowIndex)
      .slice(0, limit);
    const claimed = eligible.map((current) => {
      const next = {
        ...current,
        version: current.version + 1,
        leaseToken: `lease-${++this.serial}`,
        leaseOwner: workerId,
        leaseExpiresAt: new Date(this.clock() + leaseMs).toISOString(),
        attemptCount: current.attemptCount + 1,
        updatedAt: this.iso(),
      };
      this.rows.set(next.rowId, next);
      return clone(next);
    });
    return { ok: true, rows: claimed };
  }

  async checkpointRow({ rowId, leaseToken, expectedVersion, expectedStatus, row, releaseLease = true }) {
    const current = this.rows.get(rowId);
    if (!current
      || current.version !== expectedVersion
      || current.status !== expectedStatus
      || current.leaseToken !== leaseToken
      || Date.parse(current.leaseExpiresAt || 0) <= this.clock()) {
      return { ok: false, conflict: true, error: "row_checkpoint_conflict" };
    }
    const next = {
      ...clone(row),
      rowId: current.rowId,
      batchId: current.batchId,
      rowIndex: current.rowIndex,
      prospectId: current.prospectId,
      version: current.version + 1,
      leaseToken: releaseLease ? null : current.leaseToken,
      leaseOwner: releaseLease ? null : current.leaseOwner,
      leaseExpiresAt: releaseLease ? null : current.leaseExpiresAt,
      attemptCount: current.attemptCount,
      updatedAt: this.iso(),
    };
    this.rows.set(rowId, next);
    return { ok: true, updated: true, row: clone(next) };
  }

  async approveBatch({ batchId, expectedVersion, typedBatchId, actor, approvedRows }) {
    const current = this.batches.get(batchId);
    if (!current
      || typedBatchId !== batchId
      || current.version !== expectedVersion
      || current.status !== "awaiting_approval") {
      return { ok: false, conflict: true, error: "batch_approval_conflict" };
    }
    const at = this.iso();
    const next = {
      ...current,
      status: "approved",
      approval: { actor, at, approvedRows, typedBatchId },
      version: current.version + 1,
      updatedAt: at,
    };
    this.batches.set(batchId, next);
    return { ok: true, updated: true, batch: this.currentBatch(batchId) };
  }
}

function harness(options = {}) {
  let time = options.start == null ? START : options.start;
  const clock = () => time;
  const persistence = new MemoryPersistence({ clock });
  const publications = [];
  const service = createLineContinuation({
    persistence,
    clock: () => time,
    now: () => new Date(time).toISOString(),
    workerId: () => `worker-${persistence.serial + 1}`,
    rowClaim: 1,
    pickTimeoutMs: 1_000,
    pick: options.pick || (async () => []),
    processRowPhase: options.processRowPhase || (async (row) => {
      let outcome;
      if (row.status === "picked") outcome = lineState.advanceRow(row, "qualified", { now: new Date(time).toISOString() });
      else if (row.status === "qualified") outcome = lineState.advanceRow(row, "mirrored", { now: new Date(time).toISOString() });
      else if (row.status === "mirrored") {
        outcome = lineState.advanceRow(row, "gate_passed", { gate: { pass: true, failed: [] }, now: new Date(time).toISOString() });
      } else if (row.status === "gate_passed") {
        outcome = lineState.advanceRow(row, "queued", { previewUrl: "https://preview.example.test", now: new Date(time).toISOString() });
      } else {
        return { ok: false, error: `unexpected_phase_${row.status}` };
      }
      return outcome.ok ? { ok: true, row: outcome.row } : { ok: false, error: outcome.error };
    }),
    enqueueLineMessage: async (message) => {
      publications.push(clone(message));
      return { accepted: true, messageId: `message-${publications.length}` };
    },
    rowFanout: options.rowFanout === true,
    createLineSender: options.createLineSender,
  });
  return {
    service,
    persistence,
    publications,
    setTime(value) { time = value; },
    advance(ms) { time += ms; },
  };
}

function timingRowOf(batchId, h) {
  return campaignTimingFrom(h.persistence.currentBatch(batchId).mineFunnel);
}

test("phase transitions stamp batch wall-clock firsts with the exact history moments", async () => {
  const h = harness();
  const batchId = "line_timing_phases";
  h.persistence.seed({
    batchId,
    status: "building",
    pickState: "complete",
    requested: 1,
    startedAt: iso(0),
    mineFunnel: [{ stage: "quota_contract_finished_sites_v1", entered: 1, survived: 0, rejected: {} }],
  }, [rowAt("picked", { prospectId: "timing-1" })]);

  // picked -> qualified at t=+60s
  h.advance(60_000);
  await h.service.processLineMessage({ batchId, phase: "run", sequence: 0 });
  let timing = timingRowOf(batchId, h);
  assert.equal(timing.stage, CAMPAIGN_TIMING_STAGE);
  assert.equal(timing.startedAt, iso(0), "startedAt seeds from the durable batch start");
  assert.equal(timing.firstQualifiedAt, iso(60_000), "firstQualifiedAt is the qualified history moment");

  // qualified -> mirrored at t=+300s
  h.advance(240_000);
  await h.service.processLineMessage({ batchId, phase: "run", sequence: 0 });
  timing = timingRowOf(batchId, h);
  assert.equal(timing.firstBuiltAt, iso(300_000), "firstBuiltAt is the mirrored history moment");
  assert.equal(timing.firstQualifiedAt, iso(60_000), "an earlier first never moves");

  // mirrored -> gate_passed at t=+700s
  h.advance(400_000);
  await h.service.processLineMessage({ batchId, phase: "run", sequence: 0 });
  timing = timingRowOf(batchId, h);
  assert.equal(timing.firstGateAt, iso(700_000), "firstGateAt is the gate_passed history moment");
  assert.equal(timing.firstBuiltAt, iso(300_000));

  // gate_passed -> queued (no queued timing field; firsts must be untouched)
  h.advance(30_000);
  await h.service.processLineMessage({ batchId, phase: "run", sequence: 0 });
  timing = timingRowOf(batchId, h);
  assert.equal(timing.firstGateAt, iso(700_000));
  assert.ok(!timing.firstSentAt, "firstSentAt stays unset until a real send");
});

test("firsts are the EARLIEST across rows and are monotonic once set", async () => {
  const h = harness();
  const batchId = "line_timing_two_rows";
  h.persistence.seed({
    batchId,
    status: "building",
    pickState: "complete",
    requested: 2,
    startedAt: iso(0),
  }, [
    rowAt("picked", { prospectId: "late-row", rowIndex: 1 }),
    rowAt("picked", { prospectId: "early-row", rowIndex: 0 }),
  ]);

  // Both rows go picked -> qualified in one pass; advanceRow stamps each row's
  // history with the same now(). Then only the SECOND row continues — the first
  // must stay the earliest qualified moment even as later rows qualify later.
  h.advance(90_000);
  await h.service.processLineMessage({ batchId, phase: "run", sequence: 0 });
  const afterFirstPass = timingRowOf(batchId, h);
  assert.equal(afterFirstPass.firstQualifiedAt, iso(90_000));

  // A later qualifying row must not move the recorded first.
  h.advance(500_000);
  await h.service.processLineMessage({ batchId, phase: "run", sequence: 0 });
  await h.service.processLineMessage({ batchId, phase: "run", sequence: 0 });
  const timing = timingRowOf(batchId, h);
  assert.equal(timing.firstQualifiedAt, iso(90_000), "firsts are write-once");
  assert.equal(timing.firstBuiltAt, iso(590_000));
});

test("mine funnel stage entries get a one-time monotonic elapsedMs", async () => {
  const h = harness();
  const batchId = "line_timing_funnel";
  h.persistence.seed({
    batchId,
    status: "building",
    pickState: "pending",
    requested: 2,
    startedAt: iso(0),
    mineFunnel: [{ stage: "quota_contract_finished_sites_v1", entered: 2, survived: 0, rejected: {} }],
  }, []);

  // The pick succeeds at t=+120s and returns funnel stages from the miner.
  h.advance(120_000);
  let pickInput;
  const service = createLineContinuation({
    persistence: h.persistence,
    clock: () => START + 120_000,
    now: () => iso(120_000),
    workerId: () => "worker-funnel",
    rowClaim: 1,
    pickTimeoutMs: 1_000,
    pick: async (input) => {
      pickInput = input;
      return [{
        prospectId: "funnel-1",
        businessName: "Funnel One",
        email: "owner@example.test",
        funnel: [{ stage: "mined_raw", entered: 5, survived: 2, rejected: {} }],
      }];
    },
    enqueueLineMessage: async () => ({ accepted: true, messageId: "m" }),
    rowFanout: false,
  });
  await service.processLineMessage({ batchId, phase: "run", sequence: 0 });
  assert.ok(pickInput, "pick ran");

  const funnelRows = h.persistence.currentBatch(batchId).mineFunnel;
  const stamped = funnelRows.filter((row) => Number.isFinite(Number(row.elapsedMs)));
  assert.ok(stamped.length >= 2, "contract + mined stage entries carry elapsedMs");
  for (const row of stamped) {
    assert.equal(row.elapsedMs, 120_000, "elapsedMs is measured from campaign start to the existing write");
  }
  const elapsedValues = stamped.map((row) => row.elapsedMs);
  for (let index = 1; index < elapsedValues.length; index += 1) {
    assert.ok(elapsedValues[index] >= elapsedValues[index - 1], "elapsedMs is monotonic in append order");
  }
  const firstStamp = structuredClone(stamped);

  // A later release must not re-stamp: same rows, same elapsedMs.
  h.advance(600_000);
  await service.processLineMessage({ batchId, phase: "run", sequence: 0 });
  const after = h.persistence.currentBatch(batchId).mineFunnel
    .filter((row) => Number.isFinite(Number(row.elapsedMs)) && firstStamp.some((prior) => prior.stage === row.stage));
  for (const row of after) {
    const prior = firstStamp.find((entry) => entry.stage === row.stage);
    assert.equal(row.elapsedMs, prior.elapsedMs, "elapsedMs is stamped once, never recomputed");
  }
});

test("the send path stamps firstSentAt on the existing post-receipt release", async () => {
  const batchId = "line_timing_send";
  const h = harness();
  h.persistence.seed({
    batchId,
    lane: "live",
    status: "awaiting_approval",
    pickState: "complete",
    requested: 1,
    startedAt: iso(0),
  }, [rowAt("queued", { prospectId: "send-1", rowIndex: 0 })]);
  // Operator approval gate.
  await h.persistence.approveBatch({
    batchId,
    expectedVersion: h.persistence.currentBatch(batchId).version,
    typedBatchId: batchId,
    actor: "owner_typed_batch_id",
    approvedRows: 1,
  });

  const acceptedAt = iso(900_000);
  let sendFactoryCalls = 0;
  const h2 = harness({
    createLineSender: ({ lane, batchId: senderBatchId }) => {
      sendFactoryCalls += 1;
      const sender = async () => ({ ok: false, reason: "one_phase_unused" });
      sender.prepare = async (row, options) => ({
        ok: true,
        inputFingerprint: "b".repeat(64),
        idempotencyKey: lineDeliveryIdempotencyKey({
          batchId: senderBatchId,
          prospectId: row.prospectId,
          sequence: options.sequence,
          step: options.step,
        }),
      });
      sender.deliver = async (plan) => ({
        ok: true,
        providerReceipt: "re_timing",
        idempotencyKey: plan.idempotencyKey,
        acceptedAt,
      });
      return sender;
    },
  });
  // Move the approved batch into the send harness persistence.
  h2.persistence.batches.set(batchId, clone(h.persistence.batches.get(batchId)));
  h2.persistence.rows.set(`${batchId}:0`, clone(h.persistence.rows.get(`${batchId}:0`)));
  h2.advance(900_000);

  const result = await h2.service.processLineMessage({ batchId, phase: "send", sequence: 0 });
  assert.equal(result.sent, 1);
  const timing = timingRowOf(batchId, h2);
  assert.equal(timing.firstSentAt, acceptedAt, "firstSentAt is the provider acceptance moment");
  assert.equal(timing.startedAt, iso(0));
  assert.ok(sendFactoryCalls >= 1);
});

test("transitions map to the exact timing field names", () => {
  assert.deepEqual(CAMPAIGN_TIMING_TRANSITIONS, {
    qualified: "firstQualifiedAt",
    mirrored: "firstBuiltAt",
    gate_passed: "firstGateAt",
    sent: "firstSentAt",
  });
});

test("firstRowTransitionAt reads the earliest history entry for a status", async () => {
  const { firstRowTransitionAt } = require("../lib/line-continuation");
  const rows = [
    { history: [{ status: "picked", at: iso(0) }, { status: "qualified", at: iso(5_000) }] },
    { history: [{ status: "picked", at: iso(1_000) }, { status: "qualified", at: iso(3_000) }, { status: "mirrored", at: iso(9_000) }] },
    { history: [] },
  ];
  assert.equal(firstRowTransitionAt(rows, "qualified"), iso(3_000));
  assert.equal(firstRowTransitionAt(rows, "mirrored"), iso(9_000));
  assert.equal(firstRowTransitionAt(rows, "sent"), "");
});
