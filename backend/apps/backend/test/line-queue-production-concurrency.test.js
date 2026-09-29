"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  BROWSER_HEAVY_ROW_CLAIM,
  createLineContinuation,
  rowQueueFanoutEnabled,
} = require("../lib/line-continuation");
const { DEFAULT_BUILD_CONCURRENCY } = require("../lib/line-runner");
const { LINE_QUEUE_TOPIC, normalizeLineMessage } = require("../lib/line-queue");
const lineState = require("../lib/line-state");

const NOW = "2026-08-24T12:00:00.000Z";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function qualifiedRow(index) {
  return {
    rowId: `batch-ten:${index}`,
    batchId: "batch-ten",
    rowIndex: index,
    prospectId: `prospect-${index}`,
    businessName: `Business ${index}`,
    city: "Austin",
    state: "TX",
    vertical: "roofing",
    status: "qualified",
    previewUrl: "",
    gate: null,
    failedFacts: [],
    reason: "",
    history: [{ status: "qualified", at: NOW }],
    version: 0,
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    updatedAt: NOW,
  };
}

class FanoutPersistence {
  constructor() {
    this.batch = {
      batchId: "batch-ten",
      lane: "sandbox",
      target: "Austin, TX roofing",
      requested: 10,
      status: "building",
      pickState: "complete",
      mineFunnel: [],
      approval: null,
      haltReason: "",
      version: 0,
      startedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      settledAt: null,
      sentAt: null,
    };
    this.rows = new Map(Array.from({ length: 10 }, (_, index) => {
      const row = qualifiedRow(index);
      return [row.rowId, row];
    }));
    this.claims = [];
    this.checkpoints = [];
    this.serial = 0;
  }

  snapshot() {
    return {
      ...clone(this.batch),
      rows: [...this.rows.values()]
        .sort((left, right) => left.rowIndex - right.rowIndex)
        .map(clone),
    };
  }

  async loadBatch(batchId) {
    return batchId === this.batch.batchId
      ? { ok: true, batch: this.snapshot() }
      : { ok: false, error: "batch_not_found" };
  }

  async claimRows({ batchId, rowId, expectedVersion, workerId, limit, statuses }) {
    this.claims.push({ batchId, rowId, expectedVersion, workerId, limit, statuses: [...statuses] });
    const current = this.rows.get(rowId);
    if (!current
      || current.batchId !== batchId
      || current.version !== expectedVersion
      || !statuses.includes(current.status)
      || current.leaseToken) {
      return { ok: true, rows: [] };
    }
    const leaseToken = `lease-${++this.serial}`;
    const claimed = {
      ...current,
      version: current.version + 1,
      leaseToken,
      leaseOwner: workerId,
      leaseExpiresAt: "2026-08-24T12:04:00.000Z",
      attemptCount: current.attemptCount + 1,
    };
    this.rows.set(rowId, claimed);
    return { ok: true, rows: [clone(claimed)] };
  }

  async checkpointRow({ rowId, leaseToken, expectedVersion, expectedStatus, row, releaseLease = true }) {
    const current = this.rows.get(rowId);
    if (!current
      || current.leaseToken !== leaseToken
      || current.version !== expectedVersion
      || current.status !== expectedStatus) {
      return { ok: false, conflict: true, error: "row_checkpoint_conflict" };
    }
    const saved = {
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
      updatedAt: NOW,
    };
    this.rows.set(rowId, saved);
    this.checkpoints.push({ rowId, from: expectedStatus, to: saved.status });
    return { ok: true, row: clone(saved) };
  }
}

test("the queue fan-out can carry the default build pool", () => {
  // The two dials must move together: the trigger decides how many row lanes
  // Vercel will deliver at once, the build pool decides how many rows one
  // invocation builds at once. If the pool ever grows past the trigger, the
  // extra lanes queue behind deliveries and the pool sits idle.
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const trigger = config.functions["api/queues/line-batch.js"].experimentalTriggers[0];
  assert.ok(trigger.maxConcurrency >= DEFAULT_BUILD_CONCURRENCY,
    `queue trigger ${trigger.maxConcurrency} cannot carry a default pool of ${DEFAULT_BUILD_CONCURRENCY}`);

  // The fan-out machinery itself must be on by default (an exact "0" is the
  // documented kill switch) and prod config must not have thrown it.
  assert.equal(rowQueueFanoutEnabled({}), true);
  assert.notEqual(String(config.env?.GHOST_AGENCY_LINE_QUEUE_CONCURRENCY ?? "").trim(), "0");
  assert.equal(String(config.env?.GHOST_AGENCY_BUILD_CONCURRENCY ?? "").trim(), "",
    "prod pins the pool via the code default — an env pin here would silently override it");
});

test("production queue exposes ten deliveries while every heavy delivery owns one exact row", async () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const trigger = config.functions["api/queues/line-batch.js"].experimentalTriggers[0];
  assert.equal(trigger.topic, LINE_QUEUE_TOPIC);
  assert.equal(trigger.maxConcurrency, 10);
  assert.equal(BROWSER_HEAVY_ROW_CLAIM, 1);

  const persistence = new FanoutPersistence();
  const publications = [];
  let active = 0;
  let maxActive = 0;
  const phaseBarriers = new Map(["qualified", "mirrored"].map((status) => {
    let release;
    return [status, {
      entered: 0,
      active: 0,
      maxActive: 0,
      promise: new Promise((resolve) => { release = resolve; }),
      release,
    }];
  }));
  const service = createLineContinuation({
    persistence,
    rowFanout: true,
    now: () => NOW,
    clock: () => Date.parse(NOW),
    workerId: () => "fallback-worker",
    enqueueLineMessage: async (input) => {
      const message = normalizeLineMessage(input);
      publications.push(message);
      return { accepted: true, messageId: `message-${publications.length}` };
    },
    processRowPhase: async (row) => {
      const barrier = phaseBarriers.get(row.status);
      assert.ok(barrier, `unexpected heavy status ${row.status}`);
      active += 1;
      maxActive = Math.max(maxActive, active);
      barrier.active += 1;
      barrier.maxActive = Math.max(barrier.maxActive, barrier.active);
      barrier.entered += 1;
      if (barrier.entered === 10) barrier.release();
      await barrier.promise;
      const advanced = row.status === "qualified"
        ? lineState.advanceRow(row, "mirrored", { now: NOW })
        : lineState.advanceRow(row, "gate_passed", {
          gate: { pass: true, failed: [] },
          now: NOW,
        });
      barrier.active -= 1;
      active -= 1;
      return advanced.ok ? { ok: true, row: advanced.row } : advanced;
    },
  });

  const wave = await service.processLineMessage({ batchId: "batch-ten", phase: "run", sequence: 0 });
  assert.equal(wave.rowFanout, 10);
  assert.equal(wave.processed, 0);
  const rowMessages = publications.slice(0, 10);
  assert.equal(rowMessages.length, 10);
  assert.equal(new Set(rowMessages.map((message) => message.rowId)).size, 10);
  assert.ok(rowMessages.every((message) => message.phase === "row" && message.sequence === 0));
  assert.doesNotMatch(JSON.stringify(rowMessages), /business|email|phone|prospect-/i);

  const outcomes = await Promise.all(
    rowMessages.concat(rowMessages[0]).map((message, index) => service.processLineMessage(message, {
      metadata: { messageId: `delivery-${index}` },
    })),
  );

  assert.equal(maxActive, 10, "all ten independent row leases reached browser work together");
  assert.equal(persistence.claims.length, 11);
  assert.ok(persistence.claims.every((claim) => claim.limit === 1));
  assert.equal(new Set(persistence.checkpoints.map((entry) => entry.rowId)).size, 10);
  assert.equal(persistence.checkpoints.filter((entry) => entry.from === "qualified" && entry.to === "qualified").length, 10, "each qualified row stages one CAS dispatch attempt before the provider call");
  assert.equal(persistence.checkpoints.filter((entry) => entry.from === "qualified" && entry.to === "mirrored").length, 10);
  assert.equal(persistence.checkpoints.length, 20, "staging adds one qualified->qualified write per row; the duplicate delivery is still skipped and repeats no durable phase");
  assert.equal(outcomes.filter((outcome) => outcome.skipped === "row_claim_lost").length, 1);
  assert.ok([...persistence.rows.values()].every((row) => row.status === "mirrored" && row.version === 3));
  assert.equal(publications.slice(10).filter((message) => message.phase === "row").length, 10);

  const renderMessages = publications.slice(10).filter((message) => message.phase === "row");
  assert.ok(renderMessages.every((message) => message.sequence === 3));
  await Promise.all(renderMessages.map((message, index) => service.processLineMessage(message, {
    metadata: { messageId: `render-delivery-${index}` },
  })));

  assert.equal(maxActive, 10);
  assert.equal(phaseBarriers.get("qualified").maxActive, 10);
  assert.equal(phaseBarriers.get("mirrored").maxActive, 10);
  assert.equal(persistence.claims.length, 21);
  assert.ok(persistence.claims.every((claim) => claim.limit === 1));
  assert.equal(persistence.checkpoints.filter((entry) => entry.from === "qualified" && entry.to === "mirrored").length, 10);
  assert.equal(persistence.checkpoints.filter((entry) => entry.from === "mirrored" && entry.to === "gate_passed").length, 10);
  assert.ok([...persistence.rows.values()].every((row) => row.status === "gate_passed" && row.version === 5));
});
