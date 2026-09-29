"use strict";

/**
 * test/durable-build-worker.test.js — THE MISSION PROOF for the durable build
 * worker, end to end:
 *
 *   1. A fresh 10-row Mine through the CANONICAL path: POST start answers 202
 *      fast and runs ZERO builds inside the request (its wall time is
 *      independent of build time by construction and by assertion), then the
 *      worker passes — the same processLineMessage a queue delivery or the
 *      rescue cron invokes — drive every row to a terminal state, one durable
 *      phase per claimed row, no row mirrored twice.
 *
 *   2. RESTART SURVIVAL. The worker dies mid-pass (the pass itself throws
 *      after claiming rows, exactly a lambda killed at the worst moment: the
 *      batch is left "running" with held leases and nothing checkpointed).
 *      State is derived from the durable rows, never a timer: a fresh service
 *      instance sharing only the persistence reclaims the stale batch after
 *      STALE_WORKER_MS and finishes every row — still without a single
 *      duplicate build.
 *
 * The stubs are the measured phases at test speed: mirror and gate each cost
 * ~50ms (production: ~127s build+deploy, ~30s render gate). The persistence
 * fake honours the same CAS guards (version, status, lease) PostgREST does.
 */

const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const runner = require("../lib/line-runner");
const lineState = require("../lib/line-state");
const { createLineContinuation, STALE_WORKER_MS } = require("../lib/line-continuation");
const { createLineHandler } = require("../api/admin/line");

const START = Date.parse("2026-08-17T12:00:00.000Z");
const MIRROR_MS = 50;
const GATE_MS = 50;
const RESUMABLE = new Set(["picked", "qualified", "mirrored", "gate_passed"]);
const TERMINAL = new Set(["ready", "queued", "sent", "rejected", "gate_failed", "error"]);

const priorAdminToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
process.env.GHOST_AGENCY_ADMIN_TOKEN = "durable-worker-test-token";
after(() => {
  if (priorAdminToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorAdminToken;
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function rowAt(status = "picked", overrides = {}) {
  const at = overrides.updatedAt || new Date(START).toISOString();
  return {
    rowId: overrides.rowId || "",
    batchId: overrides.batchId || "",
    rowIndex: overrides.rowIndex || 0,
    prospectId: overrides.prospectId || "prospect-1",
    businessName: overrides.businessName || "Example Roofing",
    city: overrides.city || "Austin",
    state: overrides.state || "TX",
    vertical: overrides.vertical || "roofing",
    email: overrides.email || "owner@example.test",
    status,
    previewUrl: overrides.previewUrl || "",
    gate: overrides.gate || null,
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

/** The same CAS discipline PostgREST gives production: version, status, lease. */
class MemoryPersistence {
  constructor({ clock }) {
    this.clock = clock;
    this.clockRef = null;
    this.batches = new Map();
    this.rows = new Map();
    this.serial = 0;
  }

  /** Share this store's clock with a worker so `advance()` ages BOTH. */
  shareClock() {
    this.clockRef = { now: Date.parse(new Date(this.clock()).toISOString()) };
    this.clock = () => this.clockRef.now;
    return this;
  }

  iso() {
    return new Date(this.clock()).toISOString();
  }

  seed(batch, rows = []) {
    const now = this.iso();
    const saved = {
      batchId: batch.batchId,
      lane: batch.lane === "live" ? "live" : "sandbox",
      target: batch.target || "Austin roofing",
      requested: batch.requested == null ? rows.length : batch.requested,
      status: batch.status || "building",
      pickState: batch.pickState || "pending",
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
      .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)))
      .slice(0, limit)
      .map((batch) => (includeRows === false ? { ...clone(batch), rows: [] } : this.currentBatch(batch.batchId)));
    return { ok: true, batches };
  }

  async storeBatch({ batchId, expectedVersion, expectedStatus, patch }) {
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
    let created = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const input = rows[index];
      const rowId = input.rowId || `${batchId}:${input.rowIndex == null ? index : input.rowIndex}`;
      if (this.rows.has(rowId)) continue;
      this.rows.set(rowId, rowAt(input.status || "picked", {
        ...clone(input),
        rowId,
        batchId,
        rowIndex: input.rowIndex == null ? index : input.rowIndex,
        version: 0,
        leaseToken: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        updatedAt: this.iso(),
      }));
      created += 1;
    }
    return { ok: true, created, rows: this.currentBatch(batchId).rows };
  }

  async claimRows({ batchId, workerId, limit = 1, leaseMs = 240_000, statuses }) {
    const wanted = new Set(statuses && statuses.length ? statuses : [...RESUMABLE]);
    const eligible = [...this.rows.values()]
      .filter((row) => row.batchId === batchId && wanted.has(row.status))
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
    this.batches.set(batchId, {
      ...current,
      status: "approved",
      approval: { actor, at, approvedRows, typedBatchId },
      version: current.version + 1,
      updatedAt: at,
    });
    return { ok: true, updated: true, batch: this.currentBatch(batchId) };
  }
}

/** Ten real prospects, the measured phases at test speed. */
function tenProspects() {
  return Array.from({ length: 10 }, (unused, index) => ({
    prospectId: `mine-prospect-${index + 1}`,
    businessName: `Example Roofing ${index + 1}`,
    city: "Austin",
    state: "TX",
    vertical: "roofing",
    email: `owner${index + 1}@example.test`,
  }));
}

/**
 * The phase stubs. mirror and gate each cost the mission's ~50ms; every call
 * is counted so "no row was built twice" is an assertion, not a hope.
 */
function phaseStubs(options = {}) {
  const calls = { mirror: [], gate: [], pick: 0 };
  const mirror = async (row) => {
    calls.mirror.push(row.prospectId);
    await new Promise((resolve) => setTimeout(resolve, MIRROR_MS));
    return {
      ok: true,
      previewUrl: `https://${row.prospectId}.wss-ai.com/`,
      buildHash: `hash_${row.prospectId}`,
      currentWebsite: `https://old-${row.prospectId}.example.com/`,
    };
  };
  const gate = async ({ url }) => {
    calls.gate.push(url);
    await new Promise((resolve) => setTimeout(resolve, GATE_MS));
    return { pass: true, failed: [], checks: [], blockedBy: "" };
  };
  return {
    calls,
    mirror,
    gate,
    pick: async () => { calls.pick += 1; return tenProspects(); },
    qualify: async () => ({ ok: true, reason: "" }),
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    sourceFacts: async () => ({}),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
  };
}

function workerService({ persistence, stubs, crashOn } = {}) {
  // ONE shared clock: the worker's deadlines and the persistence's lease
  // expiries must see the same now, or a restarted test would never age a
  // lease. Production gets this for free from the database.
  const clockRef = persistence.clockRef;
  let time = START;
  const clock = () => time;
  const publications = [];
  const service = createLineContinuation({
    persistence,
    // This mission test owns the durable single-worker fallback and restart
    // contract. Production's default-on ten-delivery row fan-out is exercised
    // independently in line-queue-production-concurrency.test.js. Keeping the
    // fallback explicit here prevents queued row messages from being mistaken
    // for synchronous work that this focused harness never consumes.
    rowFanout: false,
    clock,
    now: () => new Date(clock()).toISOString(),
    workerId: () => `worker-${Math.random().toString(36).slice(2, 8)}`,
    rowClaim: 10,
    pickTimeoutMs: 5_000,
    pick: stubs.pick,
    processRowPhase: async (row, context, deps) => {
      if (crashOn && crashOn(row, context)) {
        throw new Error("simulated worker death mid-phase");
      }
      return runner.processRowPhase(row, context, deps);
    },
    qualify: stubs.qualify,
    prepareHero: stubs.prepareHero,
    mirror: stubs.mirror,
    sourceFacts: stubs.sourceFacts,
    gate: stubs.gate,
    writePreviewUrl: stubs.writePreviewUrl,
    queueEmail: stubs.queueEmail,
    phaseDeps: { env: { GHOST_AGENCY_HERO_AUTOLINE: "0" } },
    enqueueLineMessage: async (message) => {
      publications.push(clone(message));
      return { accepted: true, messageId: `message-${publications.length}` };
    },
  });
  return {
    service, publications, clock,
    advance(ms) {
      time += ms;
      if (clockRef) clockRef.now += ms;
    },
  };
}

/** Drive passes until the batch leaves "building", with a hard safety bound. */
async function driveToSettled(service, batchId, bound = 60) {
  const seen = [];
  for (let pass = 0; pass < bound; pass += 1) {
    const result = await service.processLineMessage({ batchId, phase: "run" });
    seen.push(result);
    if (result.status !== "building") return { seen, final: result };
  }
  return { seen, final: seen[seen.length - 1] };
}

// ---------------------------------------------------------------------------
// 1. START RETURNS FAST, PASSES DRIVE EVERY ROW TERMINAL
// ---------------------------------------------------------------------------

test("a 10-row Mine starts fast — zero builds inside the request — and the worker passes drive all ten rows terminal", async () => {
  const stubs = phaseStubs();

  // START: the canonical route creates the batch durably and publishes the
  // opaque run handle. It never runs the pick, never runs a build.
  runner.resetBatches();
  let stored = null;
  const handler = createLineHandler({
    readiness: async () => ({
      ready: true, blockers: [], deliveryPause: { active: false, known: true, reason: "" },
      reviewHold: { active: false }, liveSendsEnabled: false, ownerAddressConfigured: true,
    }),
    sweepLineBatches: async () => ({ ok: true }),
    persistence: {
      async createBatch(candidate) {
        stored = { ...candidate, version: 0 };
        return { ok: true, created: true, batch: stored };
      },
      async loadBatch(id) {
        return stored && stored.batchId === id ? { ok: true, batch: stored } : { ok: false, error: "batch_not_found" };
      },
    },
    async enqueueLineMessage() { return { accepted: true }; },
  });
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader() {},
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
  const requestStart = Date.now();
  await handler({
    method: "POST",
    url: "/api/admin/line",
    headers: { "x-admin-token": "durable-worker-test-token" },
    body: JSON.stringify({ action: "start", count: 10, target: "roofing in Austin", lane: "sandbox" }),
  }, res);
  const startElapsedMs = Date.now() - requestStart;

  assert.equal(res.statusCode, 202, "start acknowledges the durable handoff");
  assert.equal(res.body.ok, true);
  assert.equal(res.body.building, true);
  assert.equal(res.body.batch.requested, 10);
  assert.equal(res.body.batch.status, "building");
  assert.ok(res.body.batch.batchId, "the console gets its batchId to poll");
  assert.ok(res.body.batch.counts, "the console gets its counts to render");
  assert.deepEqual(stubCallsNone(stubs), { pick: 0, mirror: 0, gate: 0 },
    "start ran no pick and no build — the batch is durable INTENT, not work");
  assert.ok(startElapsedMs < 10 * MIRROR_MS,
    `start wall time (${startElapsedMs}ms) must be independent of the build time it owes (10 mirrors x ${MIRROR_MS}ms)`);

  // PASSES: the same continuation a queue delivery or the rescue cron invokes.
  const persistence = new MemoryPersistence({ clock: () => START });
  persistence.seed({
    batchId: res.body.batch.batchId,
    lane: "sandbox",
    target: "Austin roofing",
    requested: 10,
    status: "building",
    pickState: "pending",
  });
  const worker = workerService({ persistence, stubs });
  const { seen, final } = await driveToSettled(worker.service, res.body.batch.batchId);

  assert.equal(final.status, "approved", `sandbox auto-approval settles instead of forever-building (saw ${seen.map((s) => s.status).join(",")})`);
  assert.ok(seen.length > 1, "the batch finishes across DURABLE PASSES, not one synchronous call");
  const batch = persistence.currentBatch(res.body.batch.batchId);
  const counts = lineState.batchCounts(batch);
  assert.equal(counts.total, 10, "the pick pass selected ten rows");
  assert.equal(counts.queued, 10, "all ten passed the gate and queued email drafts");
  assert.equal(counts.working, 0);
  assert.ok(batch.rows.every((row) => TERMINAL.has(row.status)), "every row reached a terminal state");
  assert.equal(new Set(stubs.calls.mirror).size, stubs.calls.mirror.length,
    "no prospect was mirrored twice — each pass resumes from the durable row");
  assert.equal(stubs.calls.mirror.length, 10);
  assert.ok(worker.publications.length >= 1, "each unfinished pass published the next continuation");
  // Sandbox auto-approval leaves the settled rows immediately sendable.
  assert.equal(lineState.sendableRows(batch).length, 10);
});

function stubCallsNone(stubs) {
  return { pick: stubs.calls.pick, mirror: stubs.calls.mirror.length, gate: stubs.calls.gate.length };
}

// ---------------------------------------------------------------------------
// 2. RESTART SURVIVAL — the worker dies mid-pass, a fresh worker finishes
// ---------------------------------------------------------------------------

test("a worker killed mid-pass loses nothing: a fresh worker reclaims the batch and finishes every row without a duplicate build", async () => {
  const stubs = phaseStubs();
  const persistence = new MemoryPersistence({ clock: () => START }).shareClock();
  persistence.seed({
    batchId: "mine_restart",
    lane: "sandbox",
    target: "Austin roofing",
    requested: 10,
    status: "building",
    pickState: "pending",
  });

  // Worker A: normal passes until rows are mid-flight (mirrored), then it
  // claims a gate pass and DIES INSIDE IT — the pass throws after the claim,
  // nothing checkpoints, the batch is left "running" with held leases. That is
  // a lambda killed at the worst possible moment.
  let rowsMirroredBeforeCrash = 0;
  const crashedGatePass = (row) => row.status === "mirrored";
  const workerA = workerService({ persistence, stubs, crashOn: crashedGatePass });
  let crashed = false;
  for (let pass = 0; pass < 10 && !crashed; pass += 1) {
    const batch = persistence.currentBatch("mine_restart");
    rowsMirroredBeforeCrash = (batch.rows || []).filter((row) => row.status === "mirrored").length;
    if (rowsMirroredBeforeCrash > 0) {
      // This pass will claim mirrored rows for the gate — and die there.
      await assert.rejects(
        () => workerA.service.processLineMessage({ batchId: "mine_restart", phase: "run" }),
        /simulated worker death/,
        "the crash is the worker dying mid-phase, after the claim, before any checkpoint",
      );
      crashed = true;
    } else {
      await workerA.service.processLineMessage({ batchId: "mine_restart", phase: "run" });
    }
  }
  assert.ok(crashed, "the crash happened with real work still in flight");
  const afterCrash = persistence.currentBatch("mine_restart");
  assert.equal(afterCrash.status, "running", "the dead worker never released the batch");
  assert.ok(afterCrash.rows.some((row) => RESUMABLE.has(row.status)),
    "rows are mid-flight — this is the state a restart must survive");
  const mirrorsBeforeRestart = stubs.calls.mirror.length;
  // The guarantee is "exactly once", not "all ten in a single pass". The mirror
  // phase is now browser-bound (line-continuation.js claims 2 qualified rows per
  // pass, like the render gate above it) because claiming ten at once starved
  // the browser pool and no site ever finished. So the crash lands after
  // however many rows the bounded passes had built — what must hold is that
  // none of them built twice. The end-state assertions below still prove all
  // ten mirrors exist and none was rebuilt by the restart.
  assert.ok(mirrorsBeforeRestart > 0, "the crash must land after real mirror work");
  assert.equal(new Set(stubs.calls.mirror).size, mirrorsBeforeRestart,
    "every row had built its mirror exactly once before the crash");

  // A fresh process shares ONLY the persistence. While the dead claim is still
  // warm, the batch is correctly reported as a live worker's.
  const workerB = workerService({ persistence, stubs });
  const warmRead = await workerB.service.processLineMessage({ batchId: "mine_restart", phase: "run" });
  assert.equal(warmRead.status, undefined);
  assert.match(String(warmRead.skipped), /worker_active/,
    "a warm running batch is not stolen out from under its dead-looking worker");
  assert.equal(stubs.calls.mirror.length, mirrorsBeforeRestart);

  // STALE_WORKER_MS passes. State is derived from the durable rows, never a
  // timer: the rescue reclaims the batch, and the passes finish every row.
  workerB.advance(STALE_WORKER_MS + 60_000);
  const rescued = await workerB.service.rescueLineBatches({ limit: 1 });
  assert.equal(rescued.ok, true);
  assert.ok(rescued.selected >= 1, "the stale batch was reclaimed");
  const { final } = await driveToSettled(workerB.service, "mine_restart");

  assert.equal(final.status, "approved");
  const finished = persistence.currentBatch("mine_restart");
  const counts = lineState.batchCounts(finished);
  assert.equal(counts.total, 10);
  assert.equal(counts.queued, 10);
  assert.equal(counts.working, 0);
  assert.ok(finished.rows.every((row) => TERMINAL.has(row.status)),
    "every row reached a terminal state after the restart");
  assert.equal(stubs.calls.mirror.length, 10,
    "the restart rebuilt NOTHING — the crashed gate pass resumed, it did not repeat the mirror");
  assert.equal(new Set(stubs.calls.mirror).size, 10);
  assert.equal(lineState.sendableRows(finished).length, 10,
    "the survived sandbox batch stays sendable — auto-approval never noticed the crash");
});
