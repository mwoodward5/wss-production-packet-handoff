"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  CAPTURE_PERSISTENCE_RESERVE_MS,
  createLineContinuation,
  exactPracticeRecoveryPlan,
  gateWithCapture,
  PICK_HEARTBEAT_STALE_MS,
  STALE_WORKER_MS,
  PROVIDER_DEDUP_SAFE_MS,
  MAX_BUILD_RETRY_ATTEMPTS,
  MAX_SIGNAL_REPORT_RETRY_ATTEMPTS,
  MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS,
  OWNER_PROOF_FRESH_RETRY_BASE_MS,
  BUILD_RETRY_BASE_MS,
  BROWSER_HEAVY_ROW_CLAIM,
  queueDueOnlyEnabled,
  rowQueueFanoutEnabled,
} = require("../lib/line-continuation");
const { lineDeliveryIdempotencyKey } = require("../lib/line-delivery");
const lineState = require("../lib/line-state");
const quota = require("../lib/line-quota");
const {
  EXPLICIT_PROSPECT_TARGET,
  createExplicitProspectMarker,
} = require("../lib/line-persistence");

const START = Date.parse("2026-08-14T12:00:00.000Z");
const RESUMABLE = new Set(["picked", "qualified", "mirrored", "gate_passed"]);

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
    status,
    previewUrl: overrides.previewUrl || (status === "gate_passed" || status === "queued" || status === "sent"
      ? "https://preview.example.test"
      : ""),
    gate: overrides.gate || (["gate_passed", "queued", "sent"].includes(status)
      ? { pass: true, failed: [] }
      : null),
    failedFacts: [],
    reason: "",
    history: [{ status, at }],
    version: overrides.version || 0,
    leaseToken: overrides.leaseToken || null,
    leaseOwner: overrides.leaseOwner || null,
    leaseExpiresAt: overrides.leaseExpiresAt || null,
    attemptCount: overrides.attemptCount || 0,
    recipientFingerprint: overrides.recipientFingerprint || "a".repeat(64),
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
    this.failStore = null;
    this.failCheckpoint = null;
    this.calls = {
      loads: [],
      stores: [],
      claims: [],
      checkpoints: [],
      approvals: [],
      persistenceOptions: [],
    };
    this.timeline = [];
  }

  recordOptions(method, options) {
    this.calls.persistenceOptions.push({
      method,
      signal: options && options.signal,
      deadlineAt: options && options.deadlineAt,
    });
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

  currentRow(batchId, prospectId = "prospect-1") {
    return this.currentBatch(batchId)?.rows.find((row) => row.prospectId === prospectId) || null;
  }

  async loadBatch(batchId, options) {
    this.recordOptions("loadBatch", options);
    this.calls.loads.push(batchId);
    const batch = this.currentBatch(batchId);
    return batch ? { ok: true, batch } : { ok: false, error: "batch_not_found" };
  }

  async listBatches({ statuses, limit = 20, includeRows = true, order = "updated_at.desc" } = {}) {
    const wanted = new Set(statuses || []);
    const batches = [...this.batches.values()]
      .filter((batch) => !wanted.size || wanted.has(batch.status))
      .sort((left, right) => (order === "updated_at.asc"
        ? String(left.updatedAt).localeCompare(String(right.updatedAt))
        : String(right.updatedAt).localeCompare(String(left.updatedAt))))
      .slice(0, limit)
      .map((batch) => includeRows === false ? { ...clone(batch), rows: [] } : this.currentBatch(batch.batchId));
    return { ok: true, batches };
  }

  async storeBatch({ batchId, expectedVersion, expectedStatus, patch }, options) {
    this.recordOptions("storeBatch", options);
    this.calls.stores.push(clone({ batchId, expectedVersion, expectedStatus, patch }));
    if (typeof this.failStore === "function"
      && this.failStore(clone({ batchId, expectedVersion, expectedStatus, patch }))) {
      return { ok: false, error: "batch_store_unavailable", retryable: true };
    }
    const current = this.batches.get(batchId);
    if (!current
      || current.version !== expectedVersion
      || (expectedStatus && current.status !== expectedStatus)) {
      return { ok: false, conflict: true, error: "batch_version_conflict" };
    }
    const next = {
      ...current,
      ...clone(patch),
      version: current.version + 1,
      updatedAt: this.iso(),
    };
    this.batches.set(batchId, next);
    return { ok: true, updated: true, batch: this.currentBatch(batchId) };
  }

  async storeRows({ batchId, rows }, options) {
    this.recordOptions("storeRows", options);
    if (!this.batches.has(batchId)) return { ok: false, error: "batch_not_found" };
    let created = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const input = rows[index];
      const rowId = input.rowId || `${batchId}:${input.rowIndex == null ? index : input.rowIndex}`;
      if (this.rows.has(rowId)) continue;
      const saved = rowAt(input.status || "picked", {
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
      });
      this.rows.set(rowId, saved);
      created += 1;
    }
    return { ok: true, created, rows: this.currentBatch(batchId).rows };
  }

  async claimRows({ batchId, rowId, expectedVersion, workerId, limit = 1, leaseMs = 240_000, statuses }, options) {
    this.recordOptions("claimRows", options);
    this.calls.claims.push(clone({
      batchId,
      ...(rowId ? { rowId } : {}),
      ...(expectedVersion != null ? { expectedVersion } : {}),
      workerId,
      limit,
      leaseMs,
      statuses,
    }));
    const wanted = new Set(statuses && statuses.length ? statuses : [...RESUMABLE]);
    const eligible = [...this.rows.values()]
      .filter((row) => row.batchId === batchId && wanted.has(row.status))
      .filter((row) => !rowId || row.rowId === rowId)
      .filter((row) => expectedVersion == null || row.version === expectedVersion)
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

  async checkpointRow(input, options) {
    this.recordOptions("checkpointRow", options);
    const { rowId, leaseToken, expectedVersion, expectedStatus, row, releaseLease = true } = input;
    const event = {
      rowId,
      from: expectedStatus,
      to: row && row.status,
      expectedVersion,
      leaseToken,
      releaseLease,
      inputFingerprint: row && row.deliveryInputFingerprint,
    };
    this.calls.checkpoints.push(clone(event));
    const injectedFailure = typeof this.failCheckpoint === "function" && this.failCheckpoint(clone(event));
    const logoCollision = row?.status === "gate_passed"
      && String(row.logoSha256 || "").trim()
      && [...this.rows.values()].some((candidate) => (
        candidate.rowId !== rowId
        && candidate.batchId === row.batchId
        && ["gate_passed", "ready", "queued", "sent"].includes(candidate.status)
        && candidate.logoSha256 === row.logoSha256
      ));
    const shouldFail = Boolean(injectedFailure) || logoCollision;
    this.timeline.push(`checkpoint:${event.to}:${shouldFail ? "fail" : "ok"}`);
    if (shouldFail) return {
      ok: false,
      error: logoCollision ? "23505" : (typeof injectedFailure === "string" ? injectedFailure : "checkpoint_unavailable"),
      retryable: !logoCollision,
    };

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

  async approveBatch({ batchId, expectedVersion, typedBatchId, actor, approvedRows }, options) {
    this.recordOptions("approveBatch", options);
    this.calls.approvals.push(clone({ batchId, expectedVersion, typedBatchId, actor, approvedRows }));
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
  const serviceClock = () => time + Math.max(0, Number(options.serviceClockOffset) || 0);
  const persistence = new MemoryPersistence({ clock });
  const publications = [];
  const phaseCalls = [];
  const processRowPhase = options.processRowPhase || (async (row, context) => {
    phaseCalls.push({ status: row.status, operationKey: context.operationKey, workerId: row.leaseOwner });
    let outcome;
    if (row.status === "picked") outcome = lineState.advanceRow(row, "qualified", { now: new Date(time).toISOString() });
    else if (row.status === "qualified") outcome = lineState.advanceRow(row, "mirrored", { now: new Date(time).toISOString() });
    else if (row.status === "mirrored") {
      outcome = lineState.advanceRow(row, "gate_passed", {
        gate: { pass: true, failed: [] },
        now: new Date(time).toISOString(),
      });
    } else if (row.status === "gate_passed") {
      outcome = lineState.advanceRow(row, "queued", {
        previewUrl: row.previewUrl || "https://preview.example.test",
        now: new Date(time).toISOString(),
      });
    } else {
      return { ok: false, error: `unexpected_phase_${row.status}` };
    }
    return outcome.ok ? { ok: true, row: outcome.row } : { ok: false, error: outcome.error };
  });
  const enqueueLineMessage = options.enqueueLineMessage || (async (message) => {
    publications.push(clone(message));
    return { accepted: true, messageId: `message-${publications.length}` };
  });
  const service = createLineContinuation({
    persistence,
    clock: serviceClock,
    now: () => new Date(time).toISOString(),
    workerId: () => `worker-${persistence.serial + 1}`,
    rowClaim: options.rowClaim || 1,
    pickTimeoutMs: 1_000,
    pick: options.pick || (async () => []),
    processRowPhase,
    enqueueLineMessage,
    rowFanout: options.rowFanout === true,
    createLineSender: options.createLineSender,
    clearSignalReportCache: options.clearSignalReportCache,
    waitForSignalReportRetry: options.waitForSignalReportRetry,
    deliveryDeps: options.deliveryDeps,
    recordEvent: options.recordEvent,
    env: options.env,
    inlinePickQualification: options.inlinePickQualification ?? false,
    phaseDeps: options.phaseDeps,
  });
  return {
    service,
    persistence,
    publications,
    phaseCalls,
    setTime(value) { time = value; },
    advance(ms) { time += ms; },
    clock,
  };
}

function approvedBatch(batchId, lane = "live") {
  return {
    batchId,
    lane,
    status: "approved",
    pickState: "complete",
    version: 3,
    approval: {
      actor: lane === "live" ? "owner_typed_batch_id" : "operator",
      at: new Date(START).toISOString(),
      approvedRows: 1,
      typedBatchId: batchId,
    },
  };
}

function twoPhaseSenderFactory({ fingerprint = "b".repeat(64), prepare, deliver } = {}) {
  return ({ batchId }) => {
    const sender = async () => {
      throw new Error("two_phase_sender_called_as_one_phase");
    };
    sender.prepare = prepare || (async (row, options) => ({
      ok: true,
      inputFingerprint: typeof fingerprint === "function" ? fingerprint() : fingerprint,
      idempotencyKey: lineDeliveryIdempotencyKey({
        batchId,
        prospectId: row.prospectId,
        sequence: options.sequence,
        step: options.step,
      }),
    }));
    sender.deliver = deliver || (async (plan) => ({
      ok: true,
      providerReceipt: "re_two_phase",
      idempotencyKey: plan.idempotencyKey,
      acceptedAt: new Date(START).toISOString(),
    }));
    return sender;
  };
}

test("halted requested-one batch is terminal across duplicate run, row, send, rescue, refill, and approval", async () => {
  let picks = 0;
  let providerCalls = 0;
  const h = harness({
    pick: async () => { picks += 1; return []; },
    createLineSender: () => async () => { providerCalls += 1; return { ok: true }; },
  });
  const batch = h.persistence.seed({
    batchId: "line_halted_absolute",
    status: "halted",
    requested: 1,
    pickState: "pending",
    mineFunnel: [{ stage: quota.QUOTA_CONTRACT_STAGE }],
    haltReason: "operator_stop",
  }, []);
  assert.equal(quota.remainingFinishedQuota(batch), 1);
  assert.equal(quota.shouldRefill(batch), false);

  const messages = [
    { batchId: batch.batchId, phase: "run", sequence: batch.version },
    { batchId: batch.batchId, phase: "row", rowId: `${batch.batchId}:0`, sequence: 0 },
    { batchId: batch.batchId, phase: "send", sequence: batch.version },
    { batchId: batch.batchId, phase: "run", sequence: batch.version },
  ];
  for (const message of messages) await h.service.processLineMessage(message);
  await h.service.rescueLineBatches({ limit: 10 });

  assert.equal(picks, 0);
  assert.equal(providerCalls, 0);
  assert.equal(h.phaseCalls.length, 0);
  assert.equal(h.persistence.calls.claims.length, 0);
  assert.equal(h.persistence.calls.checkpoints.length, 0);
  assert.equal(h.publications.length, 0);
  assert.equal(h.persistence.currentBatch(batch.batchId).status, "halted");
  assert.equal(lineState.approveBatch(batch, { typedBatchId: batch.batchId }).error, "batch_halted");
});

test("halt winning immediately after a row claim prevents phase work and stale-lease replay", async () => {
  let phaseCalls = 0;
  const h = harness({
    rowFanout: true,
    processRowPhase: async (row) => {
      phaseCalls += 1;
      return { ok: true, row: lineState.advanceRow(row, "mirrored", { now: new Date(START).toISOString() }).row };
    },
  });
  h.persistence.seed({ batchId: "line_halt_after_claim", status: "building", pickState: "complete" }, [
    rowAt("qualified", { prospectId: "halt-after-claim" }),
  ]);
  const originalClaimRows = h.persistence.claimRows.bind(h.persistence);
  h.persistence.claimRows = async (input, options) => {
    const claimed = await originalClaimRows(input, options);
    if ((claimed.rows || []).length) {
      const parent = h.persistence.batches.get(input.batchId);
      h.persistence.batches.set(input.batchId, {
        ...parent,
        status: "halted",
        haltReason: "operator_stop",
        version: parent.version + 1,
      });
    }
    return claimed;
  };

  const first = await h.service.processLineMessage({
    batchId: "line_halt_after_claim",
    phase: "row",
    rowId: "line_halt_after_claim:0",
    sequence: 0,
  });
  h.advance(5 * 60_000); // the abandoned claim is now stale, but halt still wins
  const stale = await h.service.processLineMessage({
    batchId: "line_halt_after_claim",
    phase: "row",
    rowId: "line_halt_after_claim:0",
    sequence: 0,
  });
  assert.equal(first.batch.status, "halted");
  assert.equal(first.skipped, "batch_halted");
  assert.equal(stale.skipped, "row_batch_halted");
  assert.equal(phaseCalls, 0);
  assert.equal(h.persistence.calls.checkpoints.length, 0);
  assert.equal(h.publications.length, 0);
  assert.equal(h.persistence.currentBatch("line_halt_after_claim").status, "halted");
});

test("halt during a claimed phase discards stale completion without reopening the parent", async () => {
  let persistenceRef;
  const h = harness({
    processRowPhase: async (row) => {
      const parent = persistenceRef.batches.get(row.batchId);
      persistenceRef.batches.set(row.batchId, {
        ...parent,
        status: "halted",
        haltReason: "operator_stop",
        version: parent.version + 1,
      });
      const advanced = lineState.advanceRow(row, "qualified", { now: new Date(START).toISOString() });
      return { ok: true, row: advanced.row };
    },
  });
  persistenceRef = h.persistence;
  h.persistence.seed({ batchId: "line_halt_during_phase", status: "building", pickState: "complete" }, [
    rowAt("picked", { prospectId: "halt-during-phase" }),
  ]);

  const result = await h.service.processLineMessage({ batchId: "line_halt_during_phase", phase: "run", sequence: 0 });
  assert.equal(result.status, "halted");
  assert.equal(h.persistence.calls.checkpoints.length, 0, "stale phase completion is never committed after halt");
  assert.equal(h.publications.length, 0);
  assert.equal(h.persistence.currentBatch("line_halt_during_phase").status, "halted");
  assert.equal(h.persistence.currentRow("line_halt_during_phase", "halt-during-phase").status, "picked");
});

test("halting one batch does not block an unrelated active batch", async () => {
  const h = harness();
  h.persistence.seed({ batchId: "line_halted_neighbor", status: "halted", requested: 1 }, []);
  h.persistence.seed({ batchId: "line_active_neighbor", status: "building", pickState: "complete" }, [
    rowAt("picked", { prospectId: "unrelated-active" }),
  ]);

  const result = await h.service.processLineMessage({ batchId: "line_active_neighbor", phase: "run", sequence: 0 });
  assert.equal(result.processed, 1);
  assert.equal(h.persistence.currentRow("line_active_neighbor", "unrelated-active").status, "qualified");
  assert.equal(h.persistence.currentBatch("line_halted_neighbor").status, "halted");
});

test("pick is protected by one batch CAS and publishes only an opaque, PII-free handle", async () => {
  let picks = 0;
  const h = harness({
    pick: async () => {
      picks += 1;
      return [{
        prospectId: "prospect-secret",
        businessName: "Private Business",
        email: "private@example.test",
        phone: "+1 555 010 9999",
      }];
    },
  });
  h.persistence.seed({
    batchId: "batch-pick-cas",
    lane: "sandbox",
    status: "building",
    pickState: "pending",
    requested: 1,
  });

  const results = await Promise.all([
    h.service.processLineMessage({ batchId: "batch-pick-cas", phase: "run", sequence: 0 }, {
      metadata: { messageId: "delivery-a" },
    }),
    h.service.processLineMessage({ batchId: "batch-pick-cas", phase: "run", sequence: 0 }, {
      metadata: { messageId: "delivery-b" },
    }),
  ]);

  assert.equal(picks, 1);
  assert.equal(results.filter((result) => result.selected === 1).length, 1);
  assert.equal(results.filter((result) => result.skipped === "claim_lost").length, 1);
  assert.equal(h.persistence.currentBatch("batch-pick-cas").pickState, "complete");
  assert.equal(h.persistence.currentRow("batch-pick-cas", "prospect-secret").status, "picked");
  assert.equal(h.publications.length, 1);
  assert.deepEqual(Object.keys(h.publications[0]), ["batchId", "phase", "sequence"]);
  assert.deepEqual(h.publications[0], {
    batchId: "batch-pick-cas",
    phase: "run",
    sequence: h.persistence.currentBatch("batch-pick-cas").version,
  });
  assert.doesNotMatch(JSON.stringify(h.publications), /private|example|phone|555/i);
});

test("fresh packets qualify in the same tick before one browser-heavy row wave", async () => {
  let picks = 0;
  const h = harness({
    inlinePickQualification: true,
    pick: async () => {
      picks += 1;
      return [{ prospectId: "prospect-inline", businessName: "Private Business", email: "private@example.test" }];
    },
  });
  h.persistence.seed({
    batchId: "batch-inline-qualification",
    lane: "sandbox",
    status: "building",
    pickState: "pending",
    requested: 1,
  });

  const result = await h.service.processLineMessage({ batchId: "batch-inline-qualification", phase: "run", sequence: 0 });

  assert.equal(picks, 1);
  assert.equal(result.selected, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.inlineQualified, 1);
  assert.equal(h.persistence.currentRow("batch-inline-qualification", "prospect-inline").status, "qualified");
  assert.deepEqual(h.phaseCalls.map((call) => call.status), ["picked"]);
  assert.equal(h.publications.length, 1);
  assert.equal(h.publications[0].phase, "run");
  assert.doesNotMatch(JSON.stringify(h.publications), /private|example|phone|555/i);
});

test("inline qualification kill switch preserves the queued picked checkpoint", async () => {
  const h = harness({
    inlinePickQualification: false,
    pick: async () => [{ prospectId: "prospect-kill-switch", email: "hidden@example.test" }],
  });
  h.persistence.seed({
    batchId: "batch-inline-kill-switch",
    lane: "sandbox",
    status: "building",
    pickState: "pending",
    requested: 1,
  });

  const result = await h.service.processLineMessage({ batchId: "batch-inline-kill-switch", phase: "run", sequence: 0 });

  assert.equal(result.selected, 1);
  assert.equal(h.persistence.currentRow("batch-inline-kill-switch", "prospect-kill-switch").status, "picked");
  assert.equal(h.phaseCalls.length, 0);
  assert.equal(h.publications.length, 1);
});

test("a lost pick-complete CAS reuses already checkpointed rows instead of mining twice", async () => {
  let picks = 0;
  const h = harness({
    pick: async () => {
      picks += 1;
      return [{ prospectId: "prospect-picked-once", email: "hidden@example.test" }];
    },
  });
  h.persistence.seed({
    batchId: "batch-pick-recovery",
    lane: "sandbox",
    status: "building",
    pickState: "pending",
    requested: 1,
  });
  let failCompleteOnce = true;
  h.persistence.failStore = ({ patch }) => {
    if (failCompleteOnce && patch.pickState === "complete") {
      failCompleteOnce = false;
      return true;
    }
    return false;
  };

  await assert.rejects(
    h.service.processLineMessage({ batchId: "batch-pick-recovery", phase: "run", sequence: 0 }),
    /line_batch_release_failed/,
  );
  assert.equal(picks, 1);
  assert.equal(h.persistence.currentBatch("batch-pick-recovery").status, "running");
  assert.equal(h.persistence.currentBatch("batch-pick-recovery").rows.length, 1);

  h.advance(STALE_WORKER_MS + 60_000);
  await h.service.rescueLineBatches({ limit: 1 });

  assert.equal(picks, 1, "durable selected rows are the recovery checkpoint");
  assert.equal(h.persistence.currentBatch("batch-pick-recovery").pickState, "complete");
  assert.equal(h.persistence.currentBatch("batch-pick-recovery").rows.length, 1);
});

test("rescue reopens a batch that was marked done while a ready row still owed the render gate", async () => {
  const h = harness({
    processRowPhase: async (row) => {
      const at = new Date(START).toISOString();
      if (row.status === "ready") {
        return {
          ok: true,
          row: {
            ...row,
            status: "mirrored",
            reason: "gate_never_ran",
            history: row.history.concat([{ status: "mirrored", at, reason: "gate_never_ran" }]),
          },
          phase: "render_gate_recovery",
        };
      }
      if (row.status === "mirrored") {
        return {
          ok: true,
          row: {
            ...row,
            status: "gate_passed",
            gate: { pass: true, failed: [], checks: [] },
            reason: "",
            history: row.history.concat([{ status: "gate_passed", at }]),
          },
          phase: "gate",
        };
      }
      throw new Error(`unexpected_phase_${row.status}`);
    },
  });
  const seeded = h.persistence.seed({
    batchId: "batch-stranded-ready",
    lane: "sandbox",
    status: "done",
    pickState: "complete",
    requested: 1,
  }, [
    rowAt("ready", { gate: null, previewUrl: "https://preview.example.test" }),
  ]);
  assert.equal(lineState.batchSettled(seeded), false);
  assert.equal(lineState.deriveBuildStatus(seeded), "building");

  const first = await h.service.rescueLineBatches({ limit: 1 });
  assert.equal(first.ok, true);
  assert.equal(h.persistence.currentBatch("batch-stranded-ready").status, "building");
  assert.equal(h.persistence.currentRow("batch-stranded-ready").status, "mirrored");
  assert.equal(h.persistence.currentRow("batch-stranded-ready").reason, "gate_never_ran");

  const second = await h.service.rescueLineBatches({ limit: 1 });
  assert.equal(second.ok, true);
  assert.equal(h.persistence.currentBatch("batch-stranded-ready").status, "building");
  assert.equal(h.persistence.currentRow("batch-stranded-ready").status, "gate_passed");
  assert.equal(h.persistence.currentRow("batch-stranded-ready").reason, "");
});

test("each worker claim advances and checkpoints exactly one durable row phase", async () => {
  const h = harness();
  h.persistence.seed({
    batchId: "batch-one-phase",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked")]);

  const first = await h.service.processLineMessage({ batchId: "batch-one-phase", phase: "run", sequence: 0 });
  assert.equal(first.processed, 1);
  assert.deepEqual(h.phaseCalls.map((call) => call.status), ["picked"]);
  assert.deepEqual(
    h.persistence.calls.checkpoints.map(({ from, to }) => ({ from, to })),
    [{ from: "picked", to: "qualified" }],
  );
  assert.equal(h.persistence.currentRow("batch-one-phase").status, "qualified");

  await h.service.processLineMessage({ batchId: "batch-one-phase", phase: "run", sequence: 1 });
  assert.deepEqual(h.phaseCalls.map((call) => call.status), ["picked", "qualified"]);
  assert.deepEqual(
    h.persistence.calls.checkpoints.map(({ from, to }) => ({ from, to })),
    [
      { from: "picked", to: "qualified" },
      { from: "qualified", to: "qualified" },
      { from: "qualified", to: "mirrored" },
    ],
  );
  assert.equal(h.persistence.currentRow("batch-one-phase").status, "mirrored");
});

test("a prior failed mirror dispatch creates a fresh immutable attempt and preserves the old one as audit", async () => {
  const h = harness();
  const priorAttemptId = "mirror_attempt:prior-failed";
  const priorFailure = { code: "invalid_request", detail: "brand logo must be https", beforeBuild: true };
  h.persistence.seed({
    batchId: "batch-retry-attempt",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("qualified", {
    prospectId: "prospect-retry",
    mirrorDispatch: {
      attemptId: priorAttemptId,
      status: "failed_before_build",
      failure: priorFailure,
      finishedAt: "2026-08-26T18:27:11.166Z",
    },
  })]);

  await h.service.processLineMessage({ batchId: "batch-retry-attempt", phase: "run", sequence: 0 });

  const dispatch = h.persistence.currentRow("batch-retry-attempt", "prospect-retry").mirrorDispatch;
  assert.ok(dispatch, "a new dispatch attempt was staged");
  assert.notEqual(dispatch.attemptId, priorAttemptId, "a prior terminal failure must not reuse the old attempt id");
  assert.equal(dispatch.priorAttemptId, priorAttemptId, "the old attempt is preserved as audit");
  assert.deepEqual(dispatch.priorFailure, priorFailure, "the old failure cause is preserved as audit");
});

test("an in-flight mirror dispatch attempt is reused for idempotency, not replaced", async () => {
  const h = harness();
  const inFlightAttemptId = "mirror_attempt:in-flight";
  h.persistence.seed({
    batchId: "batch-inflight-attempt",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("qualified", {
    prospectId: "prospect-inflight",
    mirrorDispatch: {
      attemptId: inFlightAttemptId,
      status: "dispatching",
      startedAt: "2026-08-26T18:27:07.965Z",
    },
  })]);

  await h.service.processLineMessage({ batchId: "batch-inflight-attempt", phase: "run", sequence: 0 });

  const dispatch = h.persistence.currentRow("batch-inflight-attempt", "prospect-inflight").mirrorDispatch;
  assert.ok(dispatch, "a dispatch attempt was staged");
  assert.equal(dispatch.attemptId, inFlightAttemptId, "an in-flight attempt is reused to prevent a duplicate provider call");
  assert.equal(dispatch.priorAttemptId, undefined, "no audit prior is recorded when the prior attempt was still in flight");
});

test("row phase telemetry surfaces sanitized persisted Mirror failure evidence over a generic wrapper", async (t) => {
  const messages = [];
  const originalLog = console.log;
  console.log = (value) => messages.push(String(value));
  t.after(() => { console.log = originalLog; });

  const h = harness({
    processRowPhase: async (row) => ({
      ok: true,
      phase: "mirror",
      row: {
        ...row,
        status: "error",
        reason: "mirror_dispatch_failed_before_build",
        mirrorDispatch: {
          status: "failed_before_build",
          failure: {
            code: "mirror_input_binding_mismatch",
            detail: "Business URL https://private.example.test did not match",
            reason: "adapter refused token=do-not-log",
          },
        },
      },
    }),
  });
  h.persistence.seed({
    batchId: "batch-mirror-failure-log",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("qualified", { prospectId: "prospect-failure-log" })]);

  await h.service.processLineMessage({ batchId: "batch-mirror-failure-log", phase: "run", sequence: 0 });

  const phase = messages.map((message) => {
    try { return JSON.parse(message); } catch { return null; }
  }).find((entry) => entry?.event === "line_row_phase");
  assert.ok(phase);
  assert.equal(phase.error, "mirror_input_binding_mismatch");
  assert.equal(phase.mirror_failure_code, "mirror_input_binding_mismatch");
  assert.equal(phase.mirror_failure_detail, "");
  assert.equal(phase.mirror_failure_reason, "");
  assert.doesNotMatch(JSON.stringify(phase), /https:\/\/|business url|token=/i);
  assert.doesNotMatch(JSON.stringify(phase), /mirror_dispatch_failed_before_build/);
});

test("row phase telemetry rejects opaque code-shaped Mirror secrets", async (t) => {
  const messages = [];
  const originalLog = console.log;
  console.log = (value) => messages.push(String(value));
  t.after(() => { console.log = originalLog; });
  const opaque = "eyjhbGciOiJIUzI1NiJ9.secret_signature";
  const h = harness({
    processRowPhase: async (row) => ({
      ok: true,
      row: {
        ...row,
        status: "error",
        reason: "mirror_dispatch_failed_before_build",
        mirrorDispatch: { failure: { code: opaque, detail: "safe_shaped_secret", reason: "secret123" } },
      },
    }),
  });
  h.persistence.seed({
    batchId: "batch-mirror-secret-log",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("qualified", { prospectId: "prospect-secret-log" })]);

  await h.service.processLineMessage({ batchId: "batch-mirror-secret-log", phase: "run", sequence: 0 });
  const phase = messages.map((message) => {
    try { return JSON.parse(message); } catch { return null; }
  }).find((entry) => entry?.event === "line_row_phase");
  assert.equal(phase.error, "mirror_failure_code_redacted");
  assert.equal(phase.mirror_failure_code, "mirror_failure_code_redacted");
  assert.equal(phase.mirror_failure_detail, "");
  assert.equal(phase.mirror_failure_reason, "");
  assert.doesNotMatch(JSON.stringify(phase), /eyj|safe_shaped_secret|secret123/i);
});

test("each delivery claims one browser-heavy mirrored row", async () => {
  const heavy = harness({ rowClaim: 2 });
  heavy.persistence.seed({
    batchId: "batch-serialized-gates",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    rowAt("mirrored", { prospectId: "prospect-gate-1", rowIndex: 0, previewUrl: "https://one.example.test" }),
    rowAt("mirrored", { prospectId: "prospect-gate-2", rowIndex: 1, previewUrl: "https://two.example.test" }),
  ]);

  const gated = await heavy.service.processLineMessage({
    batchId: "batch-serialized-gates",
    phase: "run",
    sequence: 1,
  });

  assert.equal(BROWSER_HEAVY_ROW_CLAIM, 1);
  assert.equal(heavy.persistence.calls.claims[0].limit, 1);
  assert.equal(gated.processed, 1);
  assert.equal(heavy.phaseCalls.length, 1);
  assert.equal(heavy.persistence.calls.checkpoints.length, 1);
  assert.deepEqual(
    heavy.persistence.currentBatch("batch-serialized-gates").rows.map((row) => row.status),
    ["gate_passed", "mirrored"],
  );
});

test("future hero retries are not re-leased while later due browser work advances", async (t) => {
  const previous = process.env.GHOST_AGENCY_QUEUE_DUE_ONLY;
  process.env.GHOST_AGENCY_QUEUE_DUE_ONLY = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.GHOST_AGENCY_QUEUE_DUE_ONLY;
    else process.env.GHOST_AGENCY_QUEUE_DUE_ONLY = previous;
  });
  const h = harness({ rowClaim: 2 });
  const retryAfter = new Date(START + 10 * 60 * 1000).toISOString();
  h.persistence.seed({
    batchId: "batch-retry-page-skip",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    ...Array.from({ length: 105 }, (_, index) => rowAt("qualified", {
      prospectId: `future-${index}`,
      rowIndex: index,
      heroRemaster: { required: true, pending: true, status: "running" },
      buildRetryAfter: retryAfter,
    })),
    rowAt("qualified", { prospectId: "due-1", rowIndex: 105 }),
    rowAt("qualified", { prospectId: "due-2", rowIndex: 106 }),
  ]);

  const result = await h.service.processLineMessage({
    batchId: "batch-retry-page-skip",
    phase: "run",
    sequence: 0,
  });

  assert.deepEqual(h.persistence.calls.claims.map((claim) => ({
    rowId: claim.rowId,
    limit: claim.limit,
  })), [
    { rowId: "batch-retry-page-skip:105", limit: 1 },
  ]);
  assert.deepEqual(h.phaseCalls.map((call) => call.operationKey), [
    "batch-retry-page-skip:due-1:mirror",
  ]);
  assert.equal(h.phaseCalls.length, 1, "one delivery owns one browser-heavy row");
  assert.deepEqual(
    h.persistence.calls.checkpoints.map((checkpoint) => checkpoint.rowId),
    ["batch-retry-page-skip:105", "batch-retry-page-skip:105"],
  );
  const futureRows = h.persistence.currentBatch("batch-retry-page-skip").rows.slice(0, 105);
  assert.ok(futureRows.every((row) => row.attemptCount === 0 && row.version === 0));
  assert.equal(result.queueAccepted, true);
  assert.equal("delaySeconds" in h.publications[0], false, "due work keeps continuation immediate");
});

test("due-only queue claims default on and retain an explicit zero kill switch", () => {
  assert.equal(queueDueOnlyEnabled({}), true);
  assert.equal(queueDueOnlyEnabled({ GHOST_AGENCY_QUEUE_DUE_ONLY: "1" }), true);
  assert.equal(queueDueOnlyEnabled({ GHOST_AGENCY_QUEUE_DUE_ONLY: "0" }), false);
});

test("row queue fan-out defaults on and has an immediate zero kill switch", () => {
  assert.equal(rowQueueFanoutEnabled({}), true);
  assert.equal(rowQueueFanoutEnabled({ GHOST_AGENCY_LINE_QUEUE_CONCURRENCY: "1" }), true);
  assert.equal(rowQueueFanoutEnabled({ GHOST_AGENCY_LINE_QUEUE_CONCURRENCY: "0" }), false);
});

test("GHOST_AGENCY_QUEUE_DUE_ONLY=0 restores legacy prefix leasing", async (t) => {
  const previous = process.env.GHOST_AGENCY_QUEUE_DUE_ONLY;
  process.env.GHOST_AGENCY_QUEUE_DUE_ONLY = "0";
  t.after(() => {
    if (previous === undefined) delete process.env.GHOST_AGENCY_QUEUE_DUE_ONLY;
    else process.env.GHOST_AGENCY_QUEUE_DUE_ONLY = previous;
  });
  const h = harness({ rowClaim: 1 });
  h.persistence.seed({
    batchId: "batch-due-only-disabled",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    rowAt("qualified", {
      prospectId: "future-hero",
      rowIndex: 0,
      heroRemaster: { required: true, pending: true, status: "running" },
      buildRetryAfter: new Date(START + 10 * 60 * 1000).toISOString(),
    }),
    rowAt("qualified", { prospectId: "due-later", rowIndex: 1 }),
  ]);

  await h.service.processLineMessage({
    batchId: "batch-due-only-disabled",
    phase: "run",
    sequence: 0,
  });

  assert.deepEqual(h.persistence.calls.claims.map((claim) => ({ rowId: claim.rowId, limit: claim.limit })), [
    { rowId: undefined, limit: 2 },
  ]);
  assert.deepEqual(h.persistence.calls.checkpoints.map((checkpoint) => checkpoint.rowId), [
    "batch-due-only-disabled:0",
    "batch-due-only-disabled:1",
    "batch-due-only-disabled:1",
  ]);
  assert.equal(h.persistence.currentRow("batch-due-only-disabled", "future-hero").attemptCount, 1);
});

test("due-first browser work does not lease later future retries", async () => {
  const h = harness({ rowClaim: 2 });
  const retryAfter = new Date(START + 10 * 60 * 1000).toISOString();
  h.persistence.seed({
    batchId: "batch-due-first",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    rowAt("qualified", { prospectId: "due-first-1", rowIndex: 0 }),
    rowAt("qualified", { prospectId: "due-first-2", rowIndex: 1 }),
    ...Array.from({ length: 105 }, (_, index) => rowAt("qualified", {
      prospectId: `later-future-${index}`,
      rowIndex: index + 2,
      buildRetryAfter: retryAfter,
    })),
  ]);

  await h.service.processLineMessage({
    batchId: "batch-due-first",
    phase: "run",
    sequence: 0,
  });

  assert.deepEqual(h.persistence.calls.claims.map((claim) => claim.limit), [1]);
  assert.deepEqual(h.phaseCalls.map((call) => call.operationKey), [
    "batch-due-first:due-first-1:mirror",
  ]);
  assert.equal(h.persistence.calls.checkpoints.length, 2);
});

test("picked and qualified rows use phase-aware parallel claims while mirrored rows stay bounded", async () => {
  let picked;
  const publicationSnapshots = [];
  picked = harness({
    rowClaim: 2,
    enqueueLineMessage: async (message) => {
      publicationSnapshots.push({
        message: clone(message),
        batch: picked.persistence.currentBatch("batch-serialized-picks"),
      });
      return { accepted: true, messageId: "message-after-picked-checkpoint" };
    },
  });
  picked.persistence.seed({
    batchId: "batch-serialized-picks",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    rowAt("picked", { prospectId: "prospect-pick-1", rowIndex: 0 }),
    rowAt("picked", { prospectId: "prospect-pick-2", rowIndex: 1 }),
  ]);

  const first = await picked.service.processLineMessage({
    batchId: "batch-serialized-picks",
    phase: "run",
    sequence: 1,
  });

  assert.equal(picked.persistence.calls.claims[0].limit, 2);
  assert.equal(first.processed, 2);
  assert.equal(picked.persistence.calls.checkpoints.length, 2);
  assert.deepEqual(
    picked.persistence.currentBatch("batch-serialized-picks").rows.map((row) => row.status),
    ["qualified", "qualified"],
  );
  assert.equal(publicationSnapshots.length, 1);
  assert.equal(publicationSnapshots[0].batch.status, "building");
  assert.deepEqual(
    publicationSnapshots[0].batch.rows.map((row) => ({ status: row.status, leased: Boolean(row.leaseToken) })),
    [
      { status: "qualified", leased: false },
      { status: "qualified", leased: false },
    ],
  );

  const qualified = harness({ rowClaim: 2 });
  qualified.persistence.seed({
    batchId: "batch-parallel-qualified-phases",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    rowAt("qualified", { prospectId: "prospect-qualified-1", rowIndex: 0 }),
    rowAt("qualified", { prospectId: "prospect-qualified-2", rowIndex: 1 }),
  ]);

  const mirrored = await qualified.service.processLineMessage({
    batchId: "batch-parallel-qualified-phases",
    phase: "run",
    sequence: 1,
  });
  assert.equal(qualified.persistence.calls.claims[0].limit, 1);
  assert.equal(mirrored.processed, 1);
  assert.equal(qualified.persistence.calls.checkpoints.length, 2);
});

test("late gate capture uses only the worker time left after the persistence reserve", async () => {
  let time = START + 50_000;
  let captureArgs = null;
  let runnerArgs = null;
  const signal = new AbortController().signal;
  const deadlineAt = START + 90_000;
  const proofIdentity = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: "22222222-2222-4222-8222-222222222222",
    build_hash: "a".repeat(64),
  };
  const gate = gateWithCapture({
    clock: () => time,
    captureEmailAssets: async (args) => {
      captureArgs = args;
      return { ok: true, shots: {} };
    },
    runRenderGate: async (args) => {
      runnerArgs = args;
      return args.capture({ browser: { open: true }, url: args.url });
    },
  });

  await gate({
    url: "https://preview.example.test",
    signal,
    deadlineAt,
    build: {
      currentWebsite: "https://current.example.test",
      buildHash: proofIdentity.build_hash,
      proofIdentity,
    },
  });

  assert.equal(captureArgs.budgetMs, deadlineAt - time - CAPTURE_PERSISTENCE_RESERVE_MS);
  assert.equal(captureArgs.motion, true);
  assert.equal(captureArgs.signal, signal);
  assert.equal(captureArgs.deadlineAt, deadlineAt);
  assert.deepEqual(captureArgs.proofIdentity, proofIdentity);
  assert.equal(runnerArgs.signal, signal);
  assert.equal(runnerArgs.deadlineAt, deadlineAt);

  time = deadlineAt - CAPTURE_PERSISTENCE_RESERVE_MS + 1;
  await gate({ url: "https://preview.example.test", signal, deadlineAt, build: {} });
  assert.equal(captureArgs.budgetMs, 1, "an exhausted worker may not receive a fresh capture budget");
  assert.equal(Object.hasOwn(captureArgs, "proofIdentity"), false, "legacy capture input stays byte-identical");
});

test("two queue deliveries cannot duplicate a durable row phase", async () => {
  const h = harness();
  h.persistence.seed({
    batchId: "batch-duplicate",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked")]);

  const results = await Promise.all([
    h.service.processLineMessage({ batchId: "batch-duplicate", phase: "run", sequence: 4 }, {
      metadata: { messageId: "message-one" },
    }),
    h.service.processLineMessage({ batchId: "batch-duplicate", phase: "run", sequence: 4 }, {
      metadata: { messageId: "message-two" },
    }),
  ]);

  assert.equal(h.phaseCalls.length, 1);
  assert.equal(h.persistence.calls.checkpoints.length, 1);
  assert.equal(h.persistence.currentRow("batch-duplicate").status, "qualified");
  assert.equal(results.filter((result) => result.processed === 1).length, 1);
  assert.equal(results.filter((result) => result.skipped === "claim_lost").length, 1);
});

test("an at-least-once row delivery waits for a crashed lease then reclaims that same phase", async () => {
  const h = harness({ rowFanout: true });
  h.persistence.seed({
    batchId: "batch-row-crash",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("qualified", {
    version: 1,
    leaseToken: "lease-crashed",
    leaseOwner: "gone-worker",
    leaseExpiresAt: new Date(START + 5_000).toISOString(),
  })]);
  const message = {
    batchId: "batch-row-crash",
    phase: "row",
    rowId: "batch-row-crash:0",
    sequence: 0,
  };

  const waiting = await h.service.processLineMessage(message);
  assert.equal(waiting.skipped, "row_retry_not_due");
  assert.equal(waiting.retryDelaySeconds, 5);
  assert.equal(h.phaseCalls.length, 0);

  h.advance(5_001);
  const recovered = await h.service.processLineMessage(message, {
    metadata: { messageId: "recovery-delivery" },
  });
  assert.equal(recovered.processed, 1);
  assert.equal(h.persistence.calls.claims.at(-1).expectedVersion, 1);
  assert.equal(h.persistence.currentRow("batch-row-crash").status, "mirrored");
  assert.equal(h.phaseCalls.length, 1);
});

test("partial row fan-out immediately publishes a distinct batch recovery wake", async () => {
  const publications = [];
  const h = harness({
    rowFanout: true,
    enqueueLineMessage: async (message) => {
      if (message.phase === "row" && message.rowId === "batch-partial-wave:1") {
        throw new Error("one row publish failed");
      }
      publications.push(clone(message));
      return { accepted: true, messageId: `message-${publications.length}` };
    },
  });
  h.persistence.seed({
    batchId: "batch-partial-wave",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    rowAt("qualified", { rowId: "batch-partial-wave:0", prospectId: "partial-0", rowIndex: 0 }),
    rowAt("qualified", { rowId: "batch-partial-wave:1", prospectId: "partial-1", rowIndex: 1 }),
  ]);

  const result = await h.service.processLineMessage({
    batchId: "batch-partial-wave",
    phase: "run",
    sequence: 0,
  });

  assert.equal(result.rowFanout, 1);
  assert.equal(result.rowFanoutFailed, 1);
  assert.equal(result.continued, 2);
  assert.deepEqual(publications.map(({ phase, sequence, rowId, delaySeconds }) => ({
    phase, sequence, rowId, delaySeconds,
  })), [
    { phase: "row", sequence: 0, rowId: "batch-partial-wave:0", delaySeconds: undefined },
    { phase: "run", sequence: 1, rowId: undefined, delaySeconds: 1 },
  ]);
});

test("concurrent render deliveries durably fail the duplicate logo instead of shipping it twice", async () => {
  const sharedLogo = "d".repeat(64);
  const h = harness({
    rowFanout: true,
    processRowPhase: async (row) => {
      const advanced = lineState.advanceRow(row, "gate_passed", {
        gate: {
          pass: true,
          failed: [],
          checks: [{ fact: "logo_own_and_unique", pass: true, evidence: { sha256: sharedLogo } }],
        },
        now: new Date(h.clock()).toISOString(),
      });
      return advanced.ok
        ? { ok: true, row: { ...advanced.row, logoSha256: sharedLogo } }
        : advanced;
    },
  });
  h.persistence.seed({
    batchId: "batch-logo-race",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    rowAt("mirrored", { rowId: "batch-logo-race:0", prospectId: "logo-0", rowIndex: 0 }),
    rowAt("mirrored", { rowId: "batch-logo-race:1", prospectId: "logo-1", rowIndex: 1 }),
  ]);

  await h.service.processLineMessage({ batchId: "batch-logo-race", phase: "run", sequence: 0 });
  const rowMessages = h.publications.filter((message) => message.phase === "row");
  assert.equal(rowMessages.length, 2);
  await Promise.all(rowMessages.map((message, index) => h.service.processLineMessage(message, {
    metadata: { messageId: `logo-delivery-${index}` },
  })));

  const rows = h.persistence.currentBatch("batch-logo-race").rows;
  assert.equal(rows.filter((row) => row.status === "gate_passed").length, 1);
  assert.equal(rows.filter((row) => row.status === "gate_failed").length, 1);
  const refused = rows.find((row) => row.status === "gate_failed");
  assert.deepEqual(refused.failedFacts, ["logo_own_and_unique"]);
  assert.match(refused.reason, /already assigned to another prospect/);
});

test("a lost checkpoint leaves the same phase resumable and stale-worker rescue reclaims it", async () => {
  const h = harness();
  h.persistence.seed({
    batchId: "batch-crash",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("qualified")]);
  let failOnce = true;
  h.persistence.failCheckpoint = ({ to }) => {
    if (failOnce && to === "mirrored") {
      failOnce = false;
      return true;
    }
    return false;
  };

  await assert.rejects(
    h.service.processLineMessage({ batchId: "batch-crash", phase: "run", sequence: 0 }, {
      metadata: { messageId: "crashed-worker" },
    }),
    /line_row_checkpoint_failed/,
  );
  assert.equal(h.persistence.currentBatch("batch-crash").status, "running");
  assert.equal(h.persistence.currentRow("batch-crash").status, "qualified");
  assert.equal(h.phaseCalls.length, 1);

  const early = await h.service.processLineMessage({ batchId: "batch-crash", phase: "run", sequence: 1 });
  assert.equal(early.skipped, "worker_active");
  assert.equal(h.phaseCalls.length, 1);

  h.advance(STALE_WORKER_MS + 60_000);
  const rescued = await h.service.rescueLineBatches({ limit: 1 });
  assert.equal(rescued.selected, 1);
  assert.equal(h.persistence.currentRow("batch-crash").status, "mirrored");
  assert.deepEqual(h.phaseCalls.map((call) => call.status), ["qualified", "qualified"]);
  assert.equal(h.phaseCalls[0].operationKey, h.phaseCalls[1].operationKey);
  assert.equal(h.persistence.currentBatch("batch-crash").status, "building");
});

test("a fresh housekeeping heartbeat cannot hide a stale deployment-swap render worker", async () => {
  const currentTime = START + STALE_WORKER_MS + 60_000;
  const h = harness({ start: currentTime });
  h.persistence.seed({
    batchId: "batch-deploy-swap-render",
    lane: "sandbox",
    status: "running",
    pickState: "complete",
    // Housekeeping advanced the batch without moving either durable row.
    updatedAt: new Date(currentTime).toISOString(),
  }, [rowAt("mirrored", {
    updatedAt: new Date(START).toISOString(),
    leaseToken: "dead-deployment-lease",
    leaseOwner: "old-deployment",
    leaseExpiresAt: new Date(START + 240_000).toISOString(),
  }), rowAt("picked", {
    prospectId: "picked-but-unfinished",
    rowIndex: 1,
    updatedAt: new Date(START).toISOString(),
  })]);

  const result = await h.service.processLineMessage({
    batchId: "batch-deploy-swap-render",
    phase: "run",
    sequence: 2,
  }, { metadata: { messageId: "new-deployment" } });

  assert.equal(result.processed, 1, "render-gate work remains the bounded first priority");
  assert.deepEqual(h.phaseCalls.map((call) => call.status), ["mirrored"]);
  assert.equal(h.phaseCalls[0].workerId, "new-deployment");
  assert.equal(h.persistence.currentRow("batch-deploy-swap-render").status, "gate_passed");
  assert.equal(h.persistence.currentRow("batch-deploy-swap-render").leaseToken, null);
  assert.equal(h.persistence.currentRow("batch-deploy-swap-render", "picked-but-unfinished").status, "picked");
  assert.equal(h.persistence.currentBatch("batch-deploy-swap-render").status, "building");
});

test("production deadline offset never reclaims before the durable lease safe point", async () => {
  const h = harness({ serviceClockOffset: 57_000 });
  h.persistence.seed({
    batchId: "batch-production-offset",
    lane: "sandbox",
    status: "running",
    pickState: "complete",
  }, [rowAt("mirrored", {
    leaseToken: "production-worker-lease",
    leaseOwner: "production-worker",
    leaseExpiresAt: new Date(START + 292_000).toISOString(),
  })]);

  for (const wallElapsed of [235_000, 270_000, 282_000]) {
    h.setTime(START + wallElapsed);
    const result = await h.service.processLineMessage({
      batchId: "batch-production-offset",
      phase: "run",
      sequence: wallElapsed,
    });
    assert.equal(result.skipped, "worker_active", `wall ${wallElapsed}ms remains owned`);
    assert.equal(h.persistence.currentRow("batch-production-offset").status, "mirrored");
    assert.equal(h.persistence.currentRow("batch-production-offset").leaseOwner, "production-worker");
  }

  h.setTime(START + 293_000);
  const recovered = await h.service.processLineMessage({
    batchId: "batch-production-offset",
    phase: "run",
    sequence: 293_000,
  }, { metadata: { messageId: "replacement-worker" } });

  assert.equal(recovered.processed, 1);
  assert.equal(h.persistence.currentRow("batch-production-offset").status, "gate_passed");
  assert.equal(h.phaseCalls.length, 1, "only the post-lease worker runs the render gate");
});

test("rescue canonically inspects at most four workers across newest and oldest ends", async () => {
  const h = harness();
  for (let index = 0; index < 40; index += 1) {
    h.persistence.seed({
      batchId: `batch-worker-${String(index).padStart(2, "0")}`,
      lane: "sandbox",
      status: "running",
      pickState: "complete",
      updatedAt: new Date(START + index * 1_000).toISOString(),
    }, [rowAt("mirrored", {
      prospectId: `prospect-${index}`,
      leaseToken: `live-lease-${index}`,
      leaseOwner: `worker-${index}`,
      leaseExpiresAt: new Date(START + 600_000).toISOString(),
    })]);
  }

  const result = await h.service.rescueLineBatches({ limit: 1 });
  const canonicalLoads = h.persistence.calls.persistenceOptions
    .filter((call) => call.method === "loadBatch").length;

  assert.equal(canonicalLoads, 4);
  assert.deepEqual(h.persistence.calls.loads, [
    "batch-worker-39",
    "batch-worker-38",
    "batch-worker-00",
    "batch-worker-01",
  ]);
  assert.equal(result.selected, 0);
  assert.equal(result.skipped, 4);
});

test("rescue prioritizes the current building run over older registry backlog", async () => {
  const h = harness();
  h.persistence.seed({
    batchId: "batch-old-backlog",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
    updatedAt: new Date(START - 60_000).toISOString(),
  }, [rowAt("picked", { prospectId: "old-prospect" })]);
  h.persistence.seed({
    batchId: "batch-current-run",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
    updatedAt: new Date(START).toISOString(),
  }, [rowAt("picked", { prospectId: "current-prospect" })]);

  const result = await h.service.rescueLineBatches({ limit: 1 });

  assert.equal(result.selected, 1);
  assert.equal(h.persistence.currentRow("batch-current-run", "current-prospect").status, "qualified");
  assert.equal(h.persistence.currentRow("batch-old-backlog", "old-prospect").status, "picked");
});

test("cron continues canonical work after queue publication is lost", async () => {
  let picks = 0;
  const h = harness({
    pick: async () => {
      picks += 1;
      return [{ prospectId: "prospect-recovered", email: "hidden@example.test" }];
    },
    enqueueLineMessage: async () => {
      throw new Error("queue transport unavailable");
    },
  });
  h.persistence.seed({
    batchId: "batch-lost-publish",
    lane: "sandbox",
    status: "building",
    pickState: "pending",
    requested: 1,
  });

  const picked = await h.service.processLineMessage({ batchId: "batch-lost-publish", phase: "run", sequence: 0 });
  assert.equal(picked.queueAccepted, false);
  assert.equal(picks, 1);
  assert.equal(h.persistence.currentRow("batch-lost-publish", "prospect-recovered").status, "picked");

  const rescue = await h.service.rescueLineBatches({ limit: 1 });
  assert.equal(rescue.selected, 1);
  assert.equal(rescue.processed, 1);
  assert.equal(picks, 1, "cron resumes rows instead of mining a second time");
  assert.equal(h.persistence.currentRow("batch-lost-publish", "prospect-recovered").status, "qualified");
});

test("QC-complete rows auto-approve only in owner-only sandbox", async () => {
  const sandbox = harness();
  sandbox.persistence.seed({
    batchId: "batch-auto-sandbox",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("gate_passed")]);
  const sandboxResult = await sandbox.service.processLineMessage({
    batchId: "batch-auto-sandbox",
    phase: "run",
    sequence: 0,
  });
  assert.equal(sandboxResult.status, "approved");
  assert.equal(sandbox.persistence.calls.approvals.length, 1);
  assert.equal(sandbox.persistence.currentBatch("batch-auto-sandbox").approval.actor, "factory_auto_after_qc");
  assert.equal(sandbox.publications.at(-1).phase, "send");

  const live = harness();
  live.persistence.seed({
    batchId: "batch-auto-live",
    lane: "live",
    status: "building",
    pickState: "complete",
  }, [rowAt("gate_passed")]);
  const liveResult = await live.service.processLineMessage({
    batchId: "batch-auto-live",
    phase: "run",
    sequence: 0,
  });
  assert.equal(liveResult.status, "awaiting_approval");
  assert.equal(live.persistence.calls.approvals.length, 0);
  assert.equal(live.persistence.currentBatch("batch-auto-live").approval, null);
  assert.equal(live.publications.length, 0);
});

test("a release CAS loser reloads the winner and publishes nothing", async () => {
  const h = harness();
  h.persistence.seed({
    batchId: "batch-release-cas-loser",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked")]);
  const storeBatch = h.persistence.storeBatch.bind(h.persistence);
  let injected = false;
  h.persistence.storeBatch = async (input, options) => {
    if (!injected && input.expectedStatus === "running" && input.patch?.status) {
      injected = true;
      const current = h.persistence.batches.get(input.batchId);
      h.persistence.batches.set(input.batchId, {
        ...current,
        status: "halted",
        haltReason: "operator_halt",
        version: current.version + 1,
      });
      return { ok: false, conflict: true, error: "batch_version_conflict" };
    }
    return storeBatch(input, options);
  };

  const result = await h.service.processLineMessage({ batchId: "batch-release-cas-loser", phase: "run", sequence: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, "batch_generation_stale");
  assert.equal(result.queueAccepted, false);
  assert.equal(h.persistence.currentBatch("batch-release-cas-loser").haltReason, "operator_halt");
  assert.equal(h.publications.length, 0);
});

test("exact Practice recovery requires a verified packet and only failed, nondelivered history", () => {
  const prospect = {
    prospect_id: "prospect-recovery",
    business_name: "Recovery Roofing",
    city: "Austin",
    status: "held",
    record: { status: "held" },
  };
  const prior = {
    batch_id: "batch-old",
    prospect_id: "prospect-recovery",
    status: "qualified",
    payload: {
      prospectId: "prospect-recovery",
      businessName: "Recovery Roofing",
      city: "Austin",
      status: "qualified",
    },
  };
  const safe = exactPracticeRecoveryPlan({
    prospects: [prospect],
    batches: [{ batch_id: "batch-old", status: "halted" }],
    historyRows: [prior],
    verifyReceipt: () => ({ ok: true }),
  });
  assert.equal(safe.recoverable.has("prospect-recovery"), true);
  assert.equal(safe.historyKeys.size, 0, "the exact safe identity is removed from freshness history");

  for (const blocked of [{
    batches: [{ batch_id: "batch-old", status: "running" }],
    historyRows: [prior],
    verifyReceipt: () => ({ ok: true }),
  }, {
    batches: [{ batch_id: "batch-old", status: "halted" }],
    historyRows: [{ ...prior, status: "queued", payload: { ...prior.payload, status: "queued", previewUrl: "https://preview.example" } }],
    verifyReceipt: () => ({ ok: true }),
  }, {
    batches: [{ batch_id: "batch-old", status: "halted" }],
    historyRows: [prior],
    verifyReceipt: () => ({ ok: false, reason: "receipt_signature_invalid" }),
  }]) {
    const plan = exactPracticeRecoveryPlan({ prospects: [prospect], ...blocked });
    assert.equal(plan.recoverable.size, 0);
    assert.equal(plan.historyKeys.size > 0, true);
  }
});

test("send messages do nothing until that canonical batch is approved", async () => {
  let senderCalls = 0;
  const h = harness({
    createLineSender: () => async () => {
      senderCalls += 1;
      return { ok: true };
    },
  });
  h.persistence.seed({
    batchId: "batch-unapproved",
    lane: "live",
    status: "awaiting_approval",
    pickState: "complete",
  }, [rowAt("queued")]);

  const result = await h.service.processLineMessage({
    batchId: "batch-unapproved",
    phase: "send",
    sequence: 4,
  });
  assert.equal(result.skipped, "batch_awaiting_approval");
  assert.equal(senderCalls, 0);
  assert.equal(h.persistence.currentRow("batch-unapproved").status, "queued");
});

test("an approved status without durable approval evidence cannot send", async () => {
  let senderCalls = 0;
  const h = harness({
    createLineSender: () => async () => {
      senderCalls += 1;
      return { ok: true };
    },
  });
  h.persistence.seed({
    batchId: "batch-missing-approval",
    lane: "live",
    status: "approved",
    pickState: "complete",
    approval: null,
  }, [rowAt("queued")]);

  await h.service.processLineMessage({
    batchId: "batch-missing-approval",
    phase: "send",
    sequence: 1,
  });

  assert.equal(senderCalls, 0, "status alone is not human approval evidence");
  assert.equal(h.persistence.currentRow("batch-missing-approval").status, "queued");
});

test("legacy live auto-approval actors are demoted before any send", async () => {
  for (const actor of ["factory_auto_after_qc", "campaign_start_live", "live_auto"]) {
    let senderCalls = 0;
    const h = harness({
      createLineSender: () => async () => {
        senderCalls += 1;
        return { ok: true };
      },
    });
    const batchId = `batch-legacy-${actor}`;
    const batch = approvedBatch(batchId);
    batch.approval.actor = actor;
    h.persistence.seed(batch, [rowAt("queued")]);

    const result = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });

    assert.equal(result.skipped, "approval_evidence_missing");
    assert.equal(h.persistence.currentBatch(batchId).status, "awaiting_approval");
    assert.equal(h.persistence.currentBatch(batchId).approval, null);
    assert.equal(senderCalls, 0);
  }
});

test("provider acceptance uses one stable retry key and is followed by a canonical sent checkpoint", async () => {
  const providerKeys = [];
  const fingerprint = "b".repeat(64);
  let h;
  h = harness({
    createLineSender: twoPhaseSenderFactory({
      fingerprint,
      deliver: async (plan) => {
        providerKeys.push(plan.idempotencyKey);
        h.persistence.timeline.push(`provider:${plan.idempotencyKey}`);
        return {
          ok: true,
          providerReceipt: "re_retry_receipt",
          idempotencyKey: plan.idempotencyKey,
          acceptedAt: "2026-08-14T12:00:01.000Z",
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch("batch-send-retry"), [rowAt("queued")]);
  let failReceiptOnce = true;
  h.persistence.failCheckpoint = ({ to }) => {
    if (failReceiptOnce && to === "sent") {
      failReceiptOnce = false;
      return true;
    }
    return false;
  };

  await assert.rejects(
    h.service.processLineMessage({ batchId: "batch-send-retry", phase: "send", sequence: 3 }, {
      metadata: { messageId: "send-worker-one" },
    }),
    /line_send_receipt_checkpoint_failed/,
  );
  assert.equal(h.persistence.currentBatch("batch-send-retry").status, "sending");
  assert.equal(h.persistence.currentRow("batch-send-retry").status, "queued");
  assert.equal(h.persistence.currentRow("batch-send-retry").deliveryInputFingerprint, fingerprint);
  assert.equal(h.persistence.currentRow("batch-send-retry").deliveryAttempts, 1);
  assert.equal(providerKeys.length, 1);

  h.advance(STALE_WORKER_MS + 60_000);
  await h.service.rescueLineBatches({ limit: 1 });

  assert.equal(providerKeys.length, 2);
  assert.equal(providerKeys[0], providerKeys[1]);
  assert.equal(h.persistence.currentRow("batch-send-retry").status, "sent");
  assert.equal(h.persistence.currentRow("batch-send-retry").deliveryAttempts, 2);
  assert.equal(h.persistence.currentRow("batch-send-retry").providerReceipt, "re_retry_receipt");
  assert.equal(h.persistence.currentRow("batch-send-retry").providerAcceptedAt, "2026-08-14T12:00:01.000Z");
  assert.equal(h.persistence.currentRow("batch-send-retry").deliveryIdempotencyKey, providerKeys[0]);
  assert.equal(h.persistence.currentBatch("batch-send-retry").status, "done");
  assert.deepEqual(h.persistence.timeline, [
    "checkpoint:queued:ok",
    `provider:${providerKeys[0]}`,
    "checkpoint:sent:fail",
    "checkpoint:queued:ok",
    `provider:${providerKeys[0]}`,
    "checkpoint:sent:ok",
  ]);
  assert.doesNotMatch(JSON.stringify(h.persistence.currentBatch("batch-send-retry")), /@|html|body/i);
});

test("a changed canonical recipient removes approval and returns the batch for human review", async () => {
  let senderCalls = 0;
  const h = harness({
    createLineSender: () => async () => {
      senderCalls += 1;
      return {
        ok: false,
        reason: "recipient_reapproval_required",
        reapprovalRequired: true,
        idempotencyKey: "stable-provider-key",
      };
    },
  });
  h.persistence.seed(approvedBatch("batch-recipient-changed"), [rowAt("queued")]);

  const result = await h.service.processLineMessage({
    batchId: "batch-recipient-changed",
    phase: "send",
    sequence: 1,
  });

  assert.equal(senderCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.reapprovalRequired, true);
  assert.equal(result.status, "awaiting_approval");
  const batch = h.persistence.currentBatch("batch-recipient-changed");
  assert.equal(batch.approval, null);
  assert.equal(batch.haltReason, "recipient_reapproval_required");
  assert.equal(batch.rows[0].status, "queued");
  assert.equal(batch.rows[0].lastRetryableError, "recipient_reapproval_required");
});

test("a recipient change at the provider boundary outranks providerAttempted false and returns to approval", async () => {
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      deliver: async (plan) => ({
        ok: false,
        reason: "recipient_reapproval_required",
        reapprovalRequired: true,
        providerAttempted: false,
        idempotencyKey: plan.idempotencyKey,
      }),
    }),
  });
  h.persistence.seed(approvedBatch("batch-boundary-recipient-changed"), [
    rowAt("queued", { deliveryAttempts: 2 }),
  ]);

  const result = await h.service.processLineMessage({
    batchId: "batch-boundary-recipient-changed",
    phase: "send",
    sequence: 1,
  });

  const batch = h.persistence.currentBatch("batch-boundary-recipient-changed");
  assert.equal(result.ok, false);
  assert.equal(result.reapprovalRequired, true);
  assert.equal(result.policyHold, undefined);
  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.queueAccepted, false);
  assert.equal(batch.status, "awaiting_approval");
  assert.equal(batch.approval, null);
  assert.equal(batch.haltReason, "recipient_reapproval_required");
  assert.equal(batch.rows[0].status, "queued");
  assert.equal(batch.rows[0].deliveryAttempts, 2);
  assert.equal(batch.rows[0].deliveryInputFingerprint, "");
  assert.equal(batch.rows[0].deliveryIdempotencyKey, "");
  assert.equal(h.publications.length, 0);
});

test("two-phase delivery checkpoints the exact PII-free fingerprint before the provider call", async () => {
  const fingerprint = "c".repeat(64);
  let h;
  h = harness({
    createLineSender: twoPhaseSenderFactory({
      fingerprint,
      deliver: async (plan) => {
        h.persistence.timeline.push(`provider:${plan.inputFingerprint}`);
        return {
          ok: true,
          providerReceipt: "re_ordered",
          idempotencyKey: plan.idempotencyKey,
          acceptedAt: "2026-08-14T12:00:02.000Z",
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch("batch-prepare-order"), [rowAt("queued")]);

  await h.service.processLineMessage({ batchId: "batch-prepare-order", phase: "send", sequence: 1 });

  assert.deepEqual(h.persistence.timeline, [
    "checkpoint:queued:ok",
    `provider:${fingerprint}`,
    "checkpoint:sent:ok",
  ]);
  const prepareCheckpoint = h.persistence.calls.checkpoints[0];
  assert.equal(prepareCheckpoint.from, "queued");
  assert.equal(prepareCheckpoint.to, "queued");
  assert.equal(prepareCheckpoint.releaseLease, false);
  assert.equal(prepareCheckpoint.inputFingerprint, fingerprint);
  assert.doesNotMatch(JSON.stringify(h.persistence.currentBatch("batch-prepare-order")), /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|"html"|"body"/i);
});

test("a crash after prepare keeps the fingerprint and resumes only the identical payload/key", async () => {
  const fingerprint = "d".repeat(64);
  const providerKeys = [];
  let deliveryCalls = 0;
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      fingerprint,
      deliver: async (plan) => {
        deliveryCalls += 1;
        providerKeys.push(plan.idempotencyKey);
        if (deliveryCalls === 1) throw new Error("simulated_worker_crash");
        return {
          ok: true,
          providerReceipt: "re_crash_recovered",
          idempotencyKey: plan.idempotencyKey,
          acceptedAt: "2026-08-14T12:01:00.000Z",
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch("batch-crash-after-prepare"), [rowAt("queued")]);

  await assert.rejects(
    h.service.processLineMessage({ batchId: "batch-crash-after-prepare", phase: "send", sequence: 1 }),
    /simulated_worker_crash/,
  );
  const stranded = h.persistence.currentRow("batch-crash-after-prepare");
  assert.equal(stranded.status, "queued");
  assert.equal(stranded.deliveryInputFingerprint, fingerprint);
  assert.equal(stranded.deliveryAttempts, 1);
  assert.ok(stranded.leaseToken);

  h.advance(STALE_WORKER_MS + 60_000);
  await h.service.rescueLineBatches({ limit: 1 });

  assert.equal(deliveryCalls, 2);
  assert.equal(providerKeys[0], providerKeys[1]);
  assert.equal(h.persistence.currentBatch("batch-crash-after-prepare").status, "done");
  assert.equal(h.persistence.currentRow("batch-crash-after-prepare").providerReceipt, "re_crash_recovered");
});

test("a changed payload after a crash halts for manual reconciliation without a second provider call", async () => {
  let fingerprint = "e".repeat(64);
  let providerCalls = 0;
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      fingerprint: () => fingerprint,
      deliver: async () => {
        providerCalls += 1;
        throw new Error("unknown_provider_outcome");
      },
    }),
  });
  h.persistence.seed(approvedBatch("batch-payload-drift"), [rowAt("queued")]);

  await assert.rejects(
    h.service.processLineMessage({ batchId: "batch-payload-drift", phase: "send", sequence: 1 }),
    /unknown_provider_outcome/,
  );
  const originalFingerprint = h.persistence.currentRow("batch-payload-drift").deliveryInputFingerprint;
  fingerprint = "f".repeat(64);
  h.advance(STALE_WORKER_MS + 60_000);
  await h.service.rescueLineBatches({ limit: 1 });

  const halted = h.persistence.currentBatch("batch-payload-drift");
  assert.equal(providerCalls, 1);
  assert.equal(halted.status, "halted");
  assert.equal(halted.haltReason, "delivery_payload_reconciliation_required");
  assert.equal(halted.rows[0].status, "queued");
  assert.equal(halted.rows[0].deliveryInputFingerprint, originalFingerprint);
  assert.equal(halted.rows[0].deliveryAttempts, 1);
});

test("readiness and configuration holds preserve approval and queued rows without attempts or republish", async (t) => {
  const reasons = [
    "delivery_paused",
    "review_hold",
    "live_lane_disabled",
    "owner_address_unset",
    "readiness_unavailable",
    "resend_webhook_not_configured",
  ];
  for (const reason of reasons) {
    await t.test(reason, async () => {
      let providerCalls = 0;
      const h = harness({
        createLineSender: twoPhaseSenderFactory({
          prepare: async () => ({ ok: false, reason }),
          deliver: async () => {
            providerCalls += 1;
            return { ok: true, providerReceipt: "re_forbidden" };
          },
        }),
      });
      h.persistence.seed(approvedBatch(`batch-hold-${reason}`), [rowAt("queued", { deliveryAttempts: 2 })]);

      const result = await h.service.processLineMessage({
        batchId: `batch-hold-${reason}`,
        phase: "send",
        sequence: 1,
      });

      const held = h.persistence.currentBatch(`batch-hold-${reason}`);
      assert.equal(result.policyHold, true);
      assert.equal(result.queueAccepted, false);
      assert.equal(providerCalls, 0);
      assert.equal(held.status, "halted");
      assert.equal(held.haltReason, reason);
      assert.equal(held.approval.typedBatchId, `batch-hold-${reason}`);
      assert.equal(held.rows[0].status, "queued");
      assert.equal(held.rows[0].deliveryAttempts, 2);
      assert.equal(h.publications.length, 0);

      const second = await h.service.processLineMessage({
        batchId: `batch-hold-${reason}`,
        phase: "send",
        sequence: 2,
      });
      assert.equal(second.skipped, "batch_halted");
      assert.equal(h.persistence.currentRow(`batch-hold-${reason}`).deliveryAttempts, 2);
    });
  }
});

test("Practice retries a prepared Signal with bounded GET-only reads, then halts without another POST or provider call", async () => {
  let prepareCalls = 0;
  let providerCalls = 0;
  let deliveryBoundaryCalls = 0;
  let cacheClears = 0;
  const retryDelays = [];
  const batchId = "batch-signal-one-attempt";
  const h = harness({
    clearSignalReportCache: () => { cacheClears += 1; },
    waitForSignalReportRetry: async (delayMs) => { retryDelays.push(delayMs); return true; },
    createLineSender: twoPhaseSenderFactory({
      prepare: async (row, options) => {
        prepareCalls += 1;
        const idempotencyKey = lineDeliveryIdempotencyKey({
          batchId,
          prospectId: row.prospectId,
          sequence: options.sequence,
          step: options.step,
        });
        return { ok: true, inputFingerprint: "d".repeat(64), idempotencyKey };
      },
      deliver: async (plan) => {
        deliveryBoundaryCalls += 1;
        return {
          ok: false,
          reason: "owner_proof_signal_report_missing",
          idempotencyKey: plan.idempotencyKey,
          retryableBeforeProvider: true,
          providerAttempted: false,
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  const held = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });

  const settled = h.persistence.currentBatch(batchId);
  assert.equal(held.ok, false);
  assert.equal(held.policyHold, true);
  assert.equal(settled.status, "halted");
  assert.equal(settled.haltReason, "owner_proof_signal_report_retry_exhausted");
  assert.equal(settled.rows[0].status, "queued", "Signal absence never rejects the finished lead");
  assert.equal(settled.rows[0].deliveryAttempts, 0);
  assert.equal(settled.rows[0].signalReportRetryAttempts, MAX_SIGNAL_REPORT_RETRY_ATTEMPTS);
  assert.equal(settled.rows[0].deliveryInputFingerprint, "");
  assert.equal(settled.rows[0].deliveryIdempotencyKey, "");
  assert.equal(settled.rows[0].deliveryPreparedAt, "");
  assert.equal(settled.rows[0].deliveryProviderAttemptedAt, "");
  assert.equal(providerCalls, 0);
  assert.equal(deliveryBoundaryCalls, MAX_SIGNAL_REPORT_RETRY_ATTEMPTS);
  assert.equal(prepareCalls, 1);
  assert.equal(cacheClears, MAX_SIGNAL_REPORT_RETRY_ATTEMPTS - 1);
  assert.deepEqual(retryDelays, [250, 1_000]);
  assert.equal(h.phaseCalls.length, 0, "Signal failure does not revisit paid build phases");
  assert.equal(h.publications.length, 0);

  const duplicate = await h.service.processLineMessage({ batchId, phase: "send", sequence: 2 });
  assert.equal(duplicate.skipped, "batch_halted");
  assert.equal(prepareCalls, 1);
  assert.equal(deliveryBoundaryCalls, MAX_SIGNAL_REPORT_RETRY_ATTEMPTS);
});

test("Practice clears a cached transient Signal miss and sends once from the same prepared plan", async () => {
  let prepareCalls = 0;
  let deliveryBoundaryCalls = 0;
  let providerCalls = 0;
  let cacheClears = 0;
  const batchId = "batch-signal-read-after-write";
  const h = harness({
    clearSignalReportCache: () => { cacheClears += 1; },
    waitForSignalReportRetry: async () => true,
    createLineSender: twoPhaseSenderFactory({
      prepare: async (row, options) => {
        prepareCalls += 1;
        return {
          ok: true,
          inputFingerprint: "e".repeat(64),
          idempotencyKey: lineDeliveryIdempotencyKey({
            batchId,
            prospectId: row.prospectId,
            sequence: options.sequence,
            step: options.step,
          }),
        };
      },
      deliver: async (plan) => {
        deliveryBoundaryCalls += 1;
        if (deliveryBoundaryCalls === 1) {
          return {
            ok: false,
            reason: "owner_proof_signal_report_missing",
            idempotencyKey: plan.idempotencyKey,
            retryableBeforeProvider: true,
            providerAttempted: false,
          };
        }
        providerCalls += 1;
        return {
          ok: true,
          providerReceipt: "re_signal_ready",
          idempotencyKey: plan.idempotencyKey,
          acceptedAt: new Date(START).toISOString(),
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  const result = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
  const settled = h.persistence.currentBatch(batchId);

  assert.equal(result.ok, true);
  assert.equal(result.sent, 1);
  assert.equal(settled.status, "done");
  assert.equal(settled.rows[0].status, "sent");
  assert.equal(settled.rows[0].deliveryAttempts, 1);
  assert.equal(settled.rows[0].signalReportRetryAttempts, undefined);
  assert.equal(prepareCalls, 1, "the report-creating prepare boundary is never repeated");
  assert.equal(deliveryBoundaryCalls, 2, "only the GET/email boundary is retried");
  assert.equal(cacheClears, 1, "the cached 404 is invalidated before revalidation");
  assert.equal(providerCalls, 1, "only the verified retry reaches the provider");
  assert.equal(h.publications.length, 0);
});

test("Practice never retries an unprepared Signal failure across the report-creating boundary", async () => {
  let prepareCalls = 0;
  let deliveryBoundaryCalls = 0;
  let cacheClears = 0;
  let retryWaits = 0;
  const batchId = "batch-signal-prepare-unavailable";
  const h = harness({
    clearSignalReportCache: () => { cacheClears += 1; },
    waitForSignalReportRetry: async () => { retryWaits += 1; return true; },
    createLineSender: twoPhaseSenderFactory({
      prepare: async () => {
        prepareCalls += 1;
        return {
          ok: false,
          reason: "owner_proof_signal_report_unavailable",
          retryableBeforeProvider: true,
          providerAttempted: false,
        };
      },
      deliver: async () => {
        deliveryBoundaryCalls += 1;
        throw new Error("unprepared delivery must never run");
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  const result = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
  const settled = h.persistence.currentBatch(batchId);

  assert.equal(result.policyHold, true);
  assert.equal(settled.status, "halted");
  assert.equal(settled.haltReason, "owner_proof_signal_report_retry_exhausted");
  assert.equal(settled.rows[0].signalReportRetryAttempts, 1);
  assert.equal(settled.rows[0].deliveryAttempts, 0);
  assert.equal(prepareCalls, 1, "a non-idempotent report create boundary cannot repeat");
  assert.equal(deliveryBoundaryCalls, 0);
  assert.equal(cacheClears, 0);
  assert.equal(retryWaits, 0);
  assert.equal(h.publications.length, 0);
});

test("Practice bounds a transient Signal identity-missing read instead of hot-looping approval", async () => {
  let deliveryBoundaryCalls = 0;
  const h = harness({
    clearSignalReportCache: () => {},
    waitForSignalReportRetry: async () => true,
    createLineSender: twoPhaseSenderFactory({
      deliver: async () => {
        deliveryBoundaryCalls += 1;
        return {
          ok: false,
          reason: "owner_proof_signal_report_identity_missing",
          retryableBeforeProvider: true,
          providerAttempted: false,
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch("batch-signal-identity-missing", "sandbox"), [rowAt("queued")]);

  const result = await h.service.processLineMessage({
    batchId: "batch-signal-identity-missing",
    phase: "send",
    sequence: 1,
  });
  const settled = h.persistence.currentBatch("batch-signal-identity-missing");

  assert.equal(result.policyHold, true);
  assert.equal(settled.status, "halted");
  assert.equal(settled.haltReason, "owner_proof_signal_report_retry_exhausted");
  assert.equal(settled.rows[0].signalReportRetryAttempts, MAX_SIGNAL_REPORT_RETRY_ATTEMPTS);
  assert.equal(settled.rows[0].deliveryAttempts, 0);
  assert.equal(deliveryBoundaryCalls, MAX_SIGNAL_REPORT_RETRY_ATTEMPTS);
  assert.equal(h.publications.length, 0);
});

test("permanent Practice Signal identity failures halt for reconciliation without retry churn", async (t) => {
  for (const reason of [
    "owner_proof_signal_packet_unverified",
    "owner_proof_signal_report_identity_mismatch",
  ]) {
    await t.test(reason, async () => {
      let deliveryBoundaryCalls = 0;
      let cacheClears = 0;
      let retryWaits = 0;
      const batchId = `batch-${reason}`;
      const h = harness({
        clearSignalReportCache: () => { cacheClears += 1; },
        waitForSignalReportRetry: async () => { retryWaits += 1; return true; },
        createLineSender: twoPhaseSenderFactory({
          deliver: async () => {
            deliveryBoundaryCalls += 1;
            return {
              ok: false,
              reason,
              retryableBeforeProvider: true,
              providerAttempted: false,
            };
          },
        }),
      });
      h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

      const result = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
      const settled = h.persistence.currentBatch(batchId);

      assert.equal(result.manualReconciliationRequired, true);
      assert.equal(settled.status, "halted");
      assert.equal(settled.haltReason, reason);
      assert.equal(settled.rows[0].status, "queued");
      assert.equal(settled.rows[0].deliveryAttempts, 0);
      assert.equal(settled.rows[0].signalReportRetryAttempts, undefined);
      assert.equal(deliveryBoundaryCalls, 1);
      assert.equal(cacheClears, 0);
      assert.equal(retryWaits, 0);
      assert.equal(h.publications.length, 0);
    });
  }
});

test("permanent Practice shared-release identity failure halts for reconciliation on the first pass", async () => {
  let prepareCalls = 0;
  let deliveryBoundaryCalls = 0;
  const batchId = "batch-public-release-identity-invalid";
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      prepare: async () => {
        prepareCalls += 1;
        return {
          ok: false,
          reason: "owner_proof_public_release_unavailable",
          releaseFailureKind: "identity_invalid",
          retryableBeforeProvider: true,
          providerAttempted: false,
        };
      },
      deliver: async () => {
        deliveryBoundaryCalls += 1;
        throw new Error("invalid release identity must not reach delivery");
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  const result = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
  const settled = h.persistence.currentBatch(batchId);

  assert.equal(result.manualReconciliationRequired, true);
  assert.equal(settled.status, "halted");
  assert.equal(settled.haltReason, "owner_proof_public_release_unavailable");
  assert.equal(settled.rows[0].status, "queued");
  assert.equal(settled.rows[0].deliveryAttempts, 0);
  assert.equal(settled.rows[0].ownerProofFreshRetryAttempts, undefined);
  assert.equal(prepareCalls, 1);
  assert.equal(deliveryBoundaryCalls, 0);
  assert.equal(h.publications.length, 0);
});

test("transient Practice public-release verification uses durable multi-pass backoff and halts after three", async () => {
  let prepareCalls = 0;
  let providerCalls = 0;
  const batchId = "batch-public-release-transient-exhausted";
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      prepare: async () => {
        prepareCalls += 1;
        return {
          ok: false,
          reason: "owner_proof_public_release_unavailable",
          releaseFailureKind: "transient",
          retryableBeforeProvider: true,
          providerAttempted: false,
        };
      },
      deliver: async () => {
        providerCalls += 1;
        return { ok: true, providerReceipt: "must-not-send" };
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  const first = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
  let waiting = h.persistence.currentBatch(batchId);
  assert.equal(first.retryable, true);
  assert.equal(first.queueAccepted, true);
  assert.equal(first.retryDelaySeconds, OWNER_PROOF_FRESH_RETRY_BASE_MS / 1_000);
  assert.equal(waiting.status, "approved");
  assert.equal(waiting.rows[0].ownerProofFreshRetryAttempts, 1);
  assert.equal(prepareCalls, 1);

  const early = await h.service.processLineMessage({ batchId, phase: "send", sequence: 2 });
  waiting = h.persistence.currentBatch(batchId);
  assert.equal(early.retryable, true);
  assert.equal(early.retryDelaySeconds, OWNER_PROOF_FRESH_RETRY_BASE_MS / 1_000);
  assert.equal(waiting.rows[0].ownerProofFreshRetryAttempts, 1, "an early duplicate cannot consume a retry");
  assert.equal(prepareCalls, 1, "backoff is enforced before prepare");

  h.advance(OWNER_PROOF_FRESH_RETRY_BASE_MS);
  const second = await h.service.processLineMessage({ batchId, phase: "send", sequence: 3 });
  waiting = h.persistence.currentBatch(batchId);
  assert.equal(second.retryable, true);
  assert.equal(second.retryDelaySeconds, (OWNER_PROOF_FRESH_RETRY_BASE_MS * 2) / 1_000);
  assert.equal(waiting.rows[0].ownerProofFreshRetryAttempts, 2);
  assert.equal(prepareCalls, 2);

  h.advance(OWNER_PROOF_FRESH_RETRY_BASE_MS * 2);
  const third = await h.service.processLineMessage({ batchId, phase: "send", sequence: 4 });
  const halted = h.persistence.currentBatch(batchId);
  assert.equal(third.policyHold, true);
  assert.equal(halted.status, "halted");
  assert.equal(halted.haltReason, "owner_proof_public_release_retry_exhausted");
  assert.equal(halted.rows[0].ownerProofFreshRetryAttempts, MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS);
  assert.equal(halted.rows[0].deliveryAttempts, 0);
  assert.equal(prepareCalls, MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS);
  assert.equal(providerCalls, 0);
  assert.deepEqual(h.publications.map((message) => message.delaySeconds), [5, 5, 10]);
});

test("a final-boundary transient public-release failure returns to durable fresh retry", async () => {
  let prepareCalls = 0;
  let deliveryBoundaryCalls = 0;
  const batchId = "batch-public-release-final-boundary-transient";
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      prepare: async (row, options) => {
        prepareCalls += 1;
        return {
          ok: true,
          inputFingerprint: "f".repeat(64),
          idempotencyKey: lineDeliveryIdempotencyKey({
            batchId,
            prospectId: row.prospectId,
            sequence: options.sequence,
            step: options.step,
          }),
        };
      },
      deliver: async () => {
        deliveryBoundaryCalls += 1;
        return {
          ok: false,
          reason: "owner_proof_public_release_unavailable",
          releaseFailureKind: "transient",
          retryableBeforeProvider: true,
          providerAttempted: false,
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  const result = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
  const waiting = h.persistence.currentBatch(batchId);

  assert.equal(result.retryable, true);
  assert.equal(result.queueAccepted, true);
  assert.equal(result.retryDelaySeconds, OWNER_PROOF_FRESH_RETRY_BASE_MS / 1_000);
  assert.equal(waiting.status, "approved");
  assert.equal(waiting.rows[0].status, "queued");
  assert.equal(waiting.rows[0].deliveryAttempts, 0);
  assert.equal(waiting.rows[0].ownerProofFreshRetryAttempts, 1);
  assert.equal(prepareCalls, 1);
  assert.equal(deliveryBoundaryCalls, 1);
});

test("a transient Practice public-release outage recovers on a fresh pass and sends once", async () => {
  let prepareCalls = 0;
  let providerCalls = 0;
  const batchId = "batch-public-release-transient-recovers";
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      prepare: async (row, options) => {
        prepareCalls += 1;
        if (prepareCalls === 1) {
          return {
            ok: false,
            reason: "owner_proof_public_release_unavailable",
            releaseFailureKind: "transient",
            retryableBeforeProvider: true,
            providerAttempted: false,
          };
        }
        return {
          ok: true,
          inputFingerprint: "a".repeat(64),
          idempotencyKey: lineDeliveryIdempotencyKey({
            batchId,
            prospectId: row.prospectId,
            sequence: options.sequence,
            step: options.step,
          }),
        };
      },
      deliver: async (plan) => {
        providerCalls += 1;
        return {
          ok: true,
          providerReceipt: "re_public_release_ready",
          idempotencyKey: plan.idempotencyKey,
          acceptedAt: new Date(START).toISOString(),
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  const first = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
  assert.equal(first.retryable, true);
  h.advance(OWNER_PROOF_FRESH_RETRY_BASE_MS);
  const recovered = await h.service.processLineMessage({ batchId, phase: "send", sequence: 2 });
  const settled = h.persistence.currentBatch(batchId);

  assert.equal(recovered.ok, true);
  assert.equal(recovered.sent, 1);
  assert.equal(settled.status, "done");
  assert.equal(settled.rows[0].status, "sent");
  assert.equal(settled.rows[0].ownerProofFreshRetryAttempts, 1);
  assert.equal(settled.rows[0].ownerProofFreshRetryAfter, "");
  assert.equal(prepareCalls, 2);
  assert.equal(providerCalls, 1);
});

test("a created Signal UUID clears the cached first read before its GET-only fresh prepare", async () => {
  let prepareCalls = 0;
  let postCalls = 0;
  let getCalls = 0;
  let cacheClears = 0;
  let providerCalls = 0;
  const batchId = "batch-signal-created-visibility";
  const h = harness({
    clearSignalReportCache: () => { cacheClears += 1; },
    createLineSender: twoPhaseSenderFactory({
      prepare: async (row, options) => {
        prepareCalls += 1;
        if (prepareCalls === 1) {
          postCalls += 1;
          return {
            ok: false,
            reason: "owner_proof_signal_report_save_reconciliation_required",
            retryableBeforeProvider: true,
            providerAttempted: false,
          };
        }
        getCalls += 1;
        return {
          ok: true,
          inputFingerprint: "c".repeat(64),
          idempotencyKey: lineDeliveryIdempotencyKey({
            batchId,
            prospectId: row.prospectId,
            sequence: options.sequence,
            step: options.step,
          }),
        };
      },
      deliver: async (plan) => {
        providerCalls += 1;
        return {
          ok: true,
          providerReceipt: "re_signal_visibility_ready",
          idempotencyKey: plan.idempotencyKey,
          acceptedAt: new Date(START).toISOString(),
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  const first = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
  assert.equal(first.retryable, true);
  assert.equal(cacheClears, 0);
  h.advance(OWNER_PROOF_FRESH_RETRY_BASE_MS);
  const recovered = await h.service.processLineMessage({ batchId, phase: "send", sequence: 2 });

  assert.equal(recovered.sent, 1);
  assert.equal(h.persistence.currentBatch(batchId).status, "done");
  assert.equal(postCalls, 1, "the CallPrep create boundary is never repeated");
  assert.equal(getCalls, 1);
  assert.equal(cacheClears, 1, "the persisted UUID bypasses the newly cached negative read");
  assert.equal(providerCalls, 1);
});

test("Practice deadline exhaustion gets a fresh worker once and then sends", async () => {
  let prepareCalls = 0;
  let deliveryCalls = 0;
  let providerCalls = 0;
  const batchId = "batch-owner-proof-deadline-recovers";
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      prepare: async (row, options) => {
        prepareCalls += 1;
        return {
          ok: true,
          inputFingerprint: "8".repeat(64),
          idempotencyKey: lineDeliveryIdempotencyKey({
            batchId,
            prospectId: row.prospectId,
            sequence: options.sequence,
            step: options.step,
          }),
        };
      },
      deliver: async (plan) => {
        deliveryCalls += 1;
        if (deliveryCalls === 1) {
          return {
            ok: false,
            reason: "owner_proof_deadline_exhausted",
            idempotencyKey: plan.idempotencyKey,
            retryableBeforeProvider: true,
            providerAttempted: false,
          };
        }
        providerCalls += 1;
        return {
          ok: true,
          providerReceipt: "re_deadline_recovered",
          idempotencyKey: plan.idempotencyKey,
          acceptedAt: new Date(START).toISOString(),
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  const first = await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
  assert.equal(first.retryable, true);
  assert.equal(h.persistence.currentBatch(batchId).rows[0].deliveryAttempts, 0);
  h.advance(OWNER_PROOF_FRESH_RETRY_BASE_MS);
  const recovered = await h.service.processLineMessage({ batchId, phase: "send", sequence: 2 });
  const settled = h.persistence.currentBatch(batchId);

  assert.equal(recovered.sent, 1);
  assert.equal(settled.status, "done");
  assert.equal(settled.rows[0].deliveryAttempts, 1);
  assert.equal(settled.rows[0].ownerProofFreshRetryAttempts, 1);
  assert.equal(prepareCalls, 2);
  assert.equal(deliveryCalls, 2);
  assert.equal(providerCalls, 1);
});

test("Practice deadline exhaustion halts after three fresh workers with zero provider calls", async () => {
  let prepareCalls = 0;
  let deliveryCalls = 0;
  let providerCalls = 0;
  const batchId = "batch-owner-proof-deadline-exhausted";
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      prepare: async () => {
        prepareCalls += 1;
        return { ok: true, inputFingerprint: "9".repeat(64), idempotencyKey: "deadline-key" };
      },
      deliver: async () => {
        deliveryCalls += 1;
        return {
          ok: false,
          reason: "owner_proof_deadline_exhausted",
          retryableBeforeProvider: true,
          providerAttempted: false,
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "sandbox"), [rowAt("queued")]);

  await h.service.processLineMessage({ batchId, phase: "send", sequence: 1 });
  h.advance(OWNER_PROOF_FRESH_RETRY_BASE_MS);
  await h.service.processLineMessage({ batchId, phase: "send", sequence: 2 });
  h.advance(OWNER_PROOF_FRESH_RETRY_BASE_MS * 2);
  const third = await h.service.processLineMessage({ batchId, phase: "send", sequence: 3 });
  const halted = h.persistence.currentBatch(batchId);

  assert.equal(third.policyHold, true);
  assert.equal(halted.status, "halted");
  assert.equal(halted.haltReason, "owner_proof_deadline_retry_exhausted");
  assert.equal(halted.rows[0].ownerProofFreshRetryAttempts, MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS);
  assert.equal(halted.rows[0].deliveryAttempts, 0);
  assert.equal(prepareCalls, MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS);
  assert.equal(deliveryCalls, MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS);
  assert.equal(providerCalls, 0);
  assert.equal(h.publications.length, MAX_OWNER_PROOF_FRESH_RETRY_ATTEMPTS - 1);
});

test("the Practice Signal retry cap does not alter a live lane retryable-before-provider result", async () => {
  const batchId = "batch-live-pre-provider-retry";
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      deliver: async () => ({
        ok: false,
        reason: "owner_proof_signal_report_missing",
        retryableBeforeProvider: true,
        providerAttempted: false,
      }),
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "live"), [rowAt("queued")]);

  await assert.rejects(
    h.service.processLineMessage({ batchId, phase: "send", sequence: 1 }),
    /line_delivery_retryable/,
  );

  const waiting = h.persistence.currentBatch(batchId);
  assert.equal(waiting.status, "approved");
  assert.equal(waiting.rows[0].status, "queued");
  assert.equal(waiting.rows[0].signalReportRetryAttempts, undefined);
  assert.equal(waiting.rows[0].deliveryAttempts, 0);
});

test("the Practice fresh-worker deadline cap does not alter Live delivery behavior", async () => {
  const batchId = "batch-live-owner-deadline-code";
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      deliver: async () => ({
        ok: false,
        reason: "owner_proof_deadline_exhausted",
        retryableBeforeProvider: true,
        providerAttempted: false,
      }),
    }),
  });
  h.persistence.seed(approvedBatch(batchId, "live"), [rowAt("queued")]);

  await assert.rejects(
    h.service.processLineMessage({ batchId, phase: "send", sequence: 1 }),
    /line_delivery_retryable/,
  );

  const waiting = h.persistence.currentBatch(batchId);
  assert.equal(waiting.status, "approved");
  assert.equal(waiting.rows[0].ownerProofFreshRetryAttempts, undefined);
  assert.equal(waiting.rows[0].ownerProofFreshRetryAfter, undefined);
  assert.equal(waiting.rows[0].deliveryAttempts, 0);
  assert.equal(h.publications.length, 0);
});

test("a STOP/suppression discovered after prepare rolls back the attempt count and never republishes", async () => {
  let providerBoundaryCalls = 0;
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      deliver: async (plan) => {
        providerBoundaryCalls += 1;
        return {
          ok: false,
          reason: "suppressed",
          policyHold: true,
          providerAttempted: false,
          idempotencyKey: plan.idempotencyKey,
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch("batch-late-stop"), [rowAt("queued", { deliveryAttempts: 2 })]);

  const result = await h.service.processLineMessage({ batchId: "batch-late-stop", phase: "send", sequence: 1 });

  const held = h.persistence.currentBatch("batch-late-stop");
  assert.equal(providerBoundaryCalls, 1, "the send boundary performed the final STOP check");
  assert.equal(result.policyHold, true);
  assert.equal(result.queueAccepted, false);
  assert.equal(held.status, "halted");
  assert.equal(held.haltReason, "suppressed");
  assert.equal(held.rows[0].status, "queued");
  assert.equal(held.rows[0].deliveryAttempts, 2);
  assert.equal(held.rows[0].deliveryInputFingerprint, "");
  assert.equal(held.rows[0].deliveryIdempotencyKey, "");
  assert.equal(h.publications.length, 0);
});

test("provider success without a safe receipt cannot become sent", async () => {
  let providerCalls = 0;
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      deliver: async (plan) => {
        providerCalls += 1;
        return { ok: true, idempotencyKey: plan.idempotencyKey, acceptedAt: new Date(START).toISOString() };
      },
    }),
  });
  h.persistence.seed(approvedBatch("batch-receipt-required"), [rowAt("queued")]);

  const result = await h.service.processLineMessage({
    batchId: "batch-receipt-required",
    phase: "send",
    sequence: 1,
  });

  const halted = h.persistence.currentBatch("batch-receipt-required");
  assert.equal(providerCalls, 1);
  assert.equal(result.manualReconciliationRequired, true);
  assert.equal(halted.status, "halted");
  assert.equal(halted.haltReason, "provider_receipt_missing");
  assert.equal(halted.rows[0].status, "queued");
  assert.equal(halted.rows[0].providerReceipt, undefined);
});

test("an unknown accepted outcome older than 24 hours remains halted and is never retried", async () => {
  let providerCalls = 0;
  const h = harness({
    createLineSender: twoPhaseSenderFactory({
      deliver: async (plan) => {
        providerCalls += 1;
        return {
          ok: true,
          providerReceipt: "re_unknown_old",
          idempotencyKey: plan.idempotencyKey,
          acceptedAt: new Date(START).toISOString(),
        };
      },
    }),
  });
  h.persistence.seed(approvedBatch("batch-unknown-old"), [rowAt("queued")]);
  h.persistence.failCheckpoint = ({ to }) => to === "sent";

  await assert.rejects(
    h.service.processLineMessage({ batchId: "batch-unknown-old", phase: "send", sequence: 1 }),
    /line_send_receipt_checkpoint_failed/,
  );
  h.advance(Math.max(PROVIDER_DEDUP_SAFE_MS + 1, 24 * 60 * 60 * 1000 + 1));
  await h.service.rescueLineBatches({ limit: 1 });

  const halted = h.persistence.currentBatch("batch-unknown-old");
  assert.equal(providerCalls, 1);
  assert.equal(halted.status, "halted");
  assert.equal(halted.haltReason, "delivery_reconciliation_required");
  assert.equal(halted.rows[0].status, "queued");

  await h.service.rescueLineBatches({ limit: 1 });
  assert.equal(providerCalls, 1);
});

test("retryable build phases back off without queue loops and halt after a bounded count", async () => {
  let phaseCalls = 0;
  const h = harness({
    processRowPhase: async () => {
      phaseCalls += 1;
      return { ok: false, retryable: true, code: "mirror_temporarily_unavailable" };
    },
  });
  h.persistence.seed({
    batchId: "batch-build-retry-cap",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked")]);

  const first = await h.service.processLineMessage({ batchId: "batch-build-retry-cap", phase: "run", sequence: 1 });
  assert.equal(first.queueAccepted, true);
  assert.equal(phaseCalls, 1);
  assert.equal(h.persistence.currentRow("batch-build-retry-cap").buildRetryAttempts, 1);
  assert.deepEqual(h.publications[0], {
    batchId: "batch-build-retry-cap",
    phase: "run",
    sequence: h.persistence.currentBatch("batch-build-retry-cap").version,
    delaySeconds: BUILD_RETRY_BASE_MS / 1000,
  });

  const immediate = await h.service.processLineMessage({ batchId: "batch-build-retry-cap", phase: "run", sequence: 2 });
  assert.equal(immediate.queueAccepted, true);
  assert.equal(phaseCalls, 1, "backoff prevents an immediate second expensive phase");
  assert.equal(h.publications[1].delaySeconds, BUILD_RETRY_BASE_MS / 1000);
  assert.equal(
    h.publications[1].sequence,
    h.persistence.currentBatch("batch-build-retry-cap").version,
    "the delayed continuation uses the released batch version for idempotency",
  );

  while (phaseCalls < MAX_BUILD_RETRY_ATTEMPTS) {
    h.advance(11 * 60 * 1000);
    await h.service.processLineMessage({ batchId: "batch-build-retry-cap", phase: "run", sequence: phaseCalls + 2 });
  }
  const settled = h.persistence.currentBatch("batch-build-retry-cap");
  assert.equal(phaseCalls, MAX_BUILD_RETRY_ATTEMPTS);
  assert.equal(settled.status, "done");
  assert.equal(settled.rows[0].status, "error");
  // THE SWEEP NAMES THE TRIGGER (2026-09-04): the terminal reason stays the
  // exhaustion classification, but lastRetryableError must carry the error
  // that actually caused it — the batch line_mtmvwmyn sweep erased nine
  // render-gate timeouts by overwriting this field with the bare reason.
  assert.equal(settled.rows[0].reason, "build_retry_exhausted");
  assert.equal(settled.rows[0].lastRetryableError, "mirror_temporarily_unavailable");
  assert.equal(h.publications.length, MAX_BUILD_RETRY_ATTEMPTS);
});

// ---------------------------------------------------------------------------
// TERMINAL-ROW TRUTH (2026-09-03). A row can reach terminal error while the
// site it built is already live: the mirror build activates the shared
// release inside the attempt, and a later step in the same or a later attempt
// can still fail retryably until build_retry_exhausted marks the row
// terminal (production: Altitude Roofing — site live, row error/
// build_retry_exhausted, nothing recorded the row state the activation came
// from). Every terminal error now leaves ONE durable line.row_terminal event
// naming the row and every release identity it can prove, so public
// activations can be reconciled against row states instead of inferred.
// ---------------------------------------------------------------------------

function terminalEvents(events) {
  return events.filter((event) => event && event.type === "line.row_terminal");
}

test("build_retry_exhausted records the durable terminal event with the row's release identity", async () => {
  let phaseCalls = 0;
  const terminalEventsSeen = [];
  const h = harness({
    recordEvent: async (type, payload) => {
      terminalEventsSeen.push({ type, payload });
      return { ok: true, mode: "live_write" };
    },
    processRowPhase: async () => {
      phaseCalls += 1;
      return { ok: false, retryable: true, code: "mirror_temporarily_unavailable" };
    },
  });
  h.persistence.seed({
    batchId: "batch-terminal-release",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked", {
    rowId: "batch-terminal-release:0",
    previewUrl: "https://altitude-roofing.wss-ai.com/",
    buildHash: "b".repeat(64),
    proofIdentity: {
      site_id: "site-altitude",
      release_id: "release-altitude-1",
      build_hash: "b".repeat(64),
    },
    releaseEvidence: {
      build_hash: "b".repeat(64),
      preview_url: "https://altitude-roofing.wss-ai.com/",
      proofIdentity: {
        site_id: "site-altitude",
        release_id: "release-altitude-1",
        build_hash: "b".repeat(64),
      },
    },
  })]);

  let runs = 0;
  while (phaseCalls < MAX_BUILD_RETRY_ATTEMPTS && runs < MAX_BUILD_RETRY_ATTEMPTS * 2) {
    runs += 1;
    h.advance(11 * 60 * 1000);
    await h.service.processLineMessage({ batchId: "batch-terminal-release", phase: "run", sequence: runs });
  }

  const settled = h.persistence.currentBatch("batch-terminal-release");
  assert.equal(settled.rows[0].status, "error");
  assert.equal(settled.rows[0].reason, "build_retry_exhausted");
  assert.equal(settled.rows[0].lastRetryableError, "mirror_temporarily_unavailable");

  const events = terminalEvents(terminalEventsSeen);
  assert.equal(events.length, 1, "exactly one terminal event for the one terminal row");
  const payload = events[0].payload;
  assert.equal(payload.batch_id, "batch-terminal-release");
  assert.equal(payload.row_id, "batch-terminal-release:0");
  assert.equal(payload.prospect_id, "prospect-1");
  assert.equal(payload.status, "error");
  assert.equal(payload.reason, "build_retry_exhausted");
  assert.equal(payload.preview_url, "https://altitude-roofing.wss-ai.com/");
  assert.equal(payload.build_hash, "b".repeat(64));
  assert.equal(payload.site_id, "site-altitude", "the activation identity the row can prove");
  assert.equal(payload.release_id, "release-altitude-1");
  assert.equal(payload.build_retry_attempts, MAX_BUILD_RETRY_ATTEMPTS);
  assert.ok(payload.at, "the terminal moment is stamped");
});

test("a non-retryable phase failure records the terminal event with the named cause", async () => {
  const terminalEventsSeen = [];
  const h = harness({
    recordEvent: async (type, payload) => {
      terminalEventsSeen.push({ type, payload });
      return { ok: true, mode: "live_write" };
    },
    processRowPhase: async () => ({ ok: false, code: "mirror_dispatch_failed_before_build" }),
  });
  h.persistence.seed({
    batchId: "batch-terminal-once",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked", { rowId: "batch-terminal-once:0" })]);

  await h.service.processLineMessage({ batchId: "batch-terminal-once", phase: "run", sequence: 1 });

  const settled = h.persistence.currentBatch("batch-terminal-once");
  assert.equal(settled.rows[0].status, "error");
  const events = terminalEvents(terminalEventsSeen);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.reason, "mirror_dispatch_failed_before_build");
  assert.equal(events[0].payload.status, "error");
  assert.equal(events[0].payload.prospect_id, "prospect-1");
});

test("healthy rows never write terminal events", async () => {
  const terminalEventsSeen = [];
  const h = harness({
    recordEvent: async (type, payload) => {
      terminalEventsSeen.push({ type, payload });
      return { ok: true, mode: "live_write" };
    },
  });
  h.persistence.seed(approvedBatch("batch-terminal-clean"), [rowAt("picked", { rowId: "batch-terminal-clean:0" })]);
  await h.service.processLineMessage({ batchId: "batch-terminal-clean", phase: "run", sequence: 1 });
  assert.equal(terminalEvents(terminalEventsSeen).length, 0, "no terminal event without a terminal error");
});

test("hero pending backoff uses wall time when the production deadline clock is extended", async () => {
  let phaseCalls = 0;
  const retryAfter = new Date(START + 30_000).toISOString();
  const h = harness({
    serviceClockOffset: 57_000,
    processRowPhase: async (row) => {
      phaseCalls += 1;
      return {
        ok: true,
        row: {
          ...row,
          heroRemaster: { required: true, pending: true, ready: false, status: "running" },
          buildRetryAfter: retryAfter,
        },
      };
    },
  });
  h.persistence.seed({
    batchId: "batch-hero-wall-clock-backoff",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("qualified")]);

  const first = await h.service.processLineMessage({
    batchId: "batch-hero-wall-clock-backoff",
    phase: "run",
    sequence: 1,
  });
  assert.equal(phaseCalls, 1);
  assert.equal(h.persistence.currentRow("batch-hero-wall-clock-backoff").attemptCount, 1);
  assert.equal(first.queueAccepted, true);
  assert.equal(h.publications[0].delaySeconds, 30);

  const duplicateWake = await h.service.processLineMessage({
    batchId: "batch-hero-wall-clock-backoff",
    phase: "run",
    sequence: 2,
  });
  assert.equal(phaseCalls, 1, "an immediate duplicate wake cannot reclaim the future hero row");
  assert.equal(h.persistence.currentRow("batch-hero-wall-clock-backoff").attemptCount, 1);
  assert.equal(duplicateWake.queueAccepted, true);
  assert.equal(h.publications[1].delaySeconds, 30);

  h.advance(30_000);
  await h.service.processLineMessage({
    batchId: "batch-hero-wall-clock-backoff",
    phase: "run",
    sequence: 3,
  });
  assert.equal(phaseCalls, 2, "the row becomes claimable exactly when wall-time backoff expires");
  assert.equal(h.persistence.currentRow("batch-hero-wall-clock-backoff").attemptCount, 2);
});

test("a pre-build Mirror system hold checkpoints backoff without terminalizing or immediate redispatch", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  let mirrorCalls = 0;
  const h = harness({
    processRowPhase: (row, context) => processRowPhase(row, context, {
      mirror: async () => {
        mirrorCalls += 1;
        return {
          ok: false,
          retryable: true,
          disposition: "system_hold",
          lead_rejection: false,
          reason: "mirror_fleet_read_unavailable",
          system_hold: {
            schema: "wss.mirror.system_hold.v1",
            type: "system",
            code: "mirror_fleet_read_unavailable",
            retryable: true,
            scope: "mirror_build",
          },
          dispatchFailure: {
            code: "mirror_fleet_read_unavailable",
            beforeBuild: true,
            hasDurableBuildIdentity: false,
            retryable: true,
          },
        };
      },
      now: () => new Date(h.clock()).toISOString(),
    }),
  });
  h.persistence.seed({
    batchId: "batch-prebuild-system-hold",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("qualified")]);

  await h.service.processLineMessage({ batchId: "batch-prebuild-system-hold", phase: "run", sequence: 1 });
  const parked = h.persistence.currentRow("batch-prebuild-system-hold");
  assert.equal(mirrorCalls, 1);
  assert.equal(parked.status, "qualified");
  assert.equal(parked.mirrorDispatch.status, "system_hold_retryable");
  assert.equal(parked.mirrorDispatch.lead_rejection, false);
  assert.ok(Date.parse(parked.buildRetryAfter) > START);

  await h.service.processLineMessage({ batchId: "batch-prebuild-system-hold", phase: "run", sequence: 2 });
  assert.equal(mirrorCalls, 1, "the immediate continuation cannot hot-loop the build/provider boundary");
});

test("a post-deploy Mirror reconciliation hold checkpoints terminal evidence and never builds twice", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  let mirrorCalls = 0;
  const buildHash = "9".repeat(64);
  const releaseEvidence = {
    schema: "mirror-engine-release-v1",
    build_hash: buildHash,
    preview_url: "https://continuation-reconciliation.wss-ai.com/",
    evidence_sha: "8".repeat(64),
  };
  const reconciliation = {
    schema: "wss.mirror.fleet_reconciliation.v1",
    action: "record_fleet_identity",
    release: {
      build_hash: buildHash,
      preview_url: releaseEvidence.preview_url,
      deploy_id: "dpl_continuation_reconciliation",
      deploy_url: "https://continuation-reconciliation.vercel.app/",
      evidence_sha: releaseEvidence.evidence_sha,
    },
    fleet_identity: {
      slug: "continuation-reconciliation",
      h1: "Continuation Reconciliation",
      title: "Continuation Reconciliation",
      prospect_id: "continuation-reconciliation",
      donor: "plumbing-premium-donor",
      build_hash: buildHash,
      attempt: 1,
    },
  };
  const h = harness({
    processRowPhase: (row, context) => processRowPhase(row, context, {
      mirror: async () => {
        mirrorCalls += 1;
        return {
          ok: false,
          retryable: false,
          disposition: "system_hold",
          lead_rejection: false,
          reason: "mirror_fleet_record_unavailable",
          provider_attempted: true,
          manual_reconciliation_required: true,
          reconciliation,
          releaseEvidence,
          system_hold: {
            schema: "wss.mirror.system_hold.v1",
            type: "system",
            code: "mirror_fleet_record_unavailable",
            retryable: true,
            scope: "mirror_reconciliation",
            manual_reconciliation_required: true,
            reconciliation,
          },
        };
      },
      now: () => new Date(h.clock()).toISOString(),
    }),
  });
  h.persistence.seed({
    batchId: "batch-postdeploy-system-hold",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("qualified", { prospectId: "continuation-reconciliation" })]);

  await h.service.processLineMessage({ batchId: "batch-postdeploy-system-hold", phase: "run", sequence: 1 });
  const parked = h.persistence.currentRow("batch-postdeploy-system-hold", "continuation-reconciliation");
  assert.equal(mirrorCalls, 1);
  assert.equal(parked.status, "error");
  assert.equal(parked.mirrorDispatch.status, "manual_reconciliation_required");
  assert.equal(parked.mirrorDispatch.rebuild_allowed, false);
  assert.equal(parked.mirrorDispatch.lead_rejection, false);
  assert.deepEqual(parked.mirrorDispatch.reconciliation, reconciliation);
  assert.deepEqual(parked.mirrorDispatch.release_evidence, releaseEvidence);

  await h.service.processLineMessage({ batchId: "batch-postdeploy-system-hold", phase: "run", sequence: 2 });
  assert.equal(mirrorCalls, 1, "a terminal reconciliation row cannot cross the deploy boundary again");
});

test("GHOST_AGENCY_LINE_GAPLESS=0 restores cron-only retry pickup", async (t) => {
  const prior = process.env.GHOST_AGENCY_LINE_GAPLESS;
  process.env.GHOST_AGENCY_LINE_GAPLESS = "0";
  t.after(() => {
    if (prior === undefined) delete process.env.GHOST_AGENCY_LINE_GAPLESS;
    else process.env.GHOST_AGENCY_LINE_GAPLESS = prior;
  });
  const h = harness({
    processRowPhase: async () => ({ ok: false, code: "transient_build_failure", retryable: true }),
  });
  h.persistence.seed({
    batchId: "batch-gapless-kill-switch",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked")]);

  const result = await h.service.processLineMessage({
    batchId: "batch-gapless-kill-switch",
    phase: "run",
    sequence: 1,
  });

  assert.equal(result.queueAccepted, false);
  assert.equal(h.publications.length, 0);
  assert.ok(h.persistence.currentRow("batch-gapless-kill-switch").buildRetryAfter, "retry remains durable for the cron sweeper");
});

test("queue worker signal and deadline reach every persistence call on its path", async () => {
  const h = harness();
  h.persistence.seed({
    batchId: "batch-persistence-options",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked")]);
  const controller = new AbortController();

  await h.service.processLineMessage(
    { batchId: "batch-persistence-options", phase: "run", sequence: 1 },
    { signal: controller.signal, metadata: { messageId: "worker-options" } },
  );

  const pathCalls = h.persistence.calls.persistenceOptions
    .filter((entry) => ["loadBatch", "storeBatch", "claimRows", "checkpointRow"].includes(entry.method));
  assert.ok(pathCalls.length >= 6);
  assert.ok(pathCalls.every((entry) => entry.signal === controller.signal));
  assert.ok(pathCalls.every((entry) => Number.isFinite(entry.deadlineAt) && entry.deadlineAt > START));
});

test("poison handling acknowledges only a safely persisted terminal batch", async () => {
  const h = harness();
  h.persistence.seed({
    batchId: "batch-poison",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked")]);

  const marked = await h.service.markLineMessagePoison(
    { batchId: "batch-poison", phase: "run", sequence: 7 },
    { failureCode: "upstream_500" },
  );
  assert.deepEqual(marked, { persisted: true });
  const halted = h.persistence.currentBatch("batch-poison");
  assert.equal(halted.status, "halted");
  assert.equal(halted.haltReason, "queue_poison:upstream_500");
  assert.doesNotMatch(JSON.stringify(halted.haltReason), /@|phone|email/i);

  const version = halted.version;
  assert.deepEqual(await h.service.markLineMessagePoison(
    { batchId: "batch-poison", phase: "run", sequence: 8 },
    { failureCode: "another_error" },
  ), { persisted: true });
  assert.equal(h.persistence.currentBatch("batch-poison").version, version);
  assert.deepEqual(await h.service.markLineMessagePoison(
    { batchId: "missing", phase: "run", sequence: 0 },
    { failureCode: "upstream_500" },
  ), { persisted: false });
});

test("a batch version conflict is stale delivery, never poison", async () => {
  const h = harness();
  h.persistence.seed({
    batchId: "batch-version-conflict-poison",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [rowAt("picked")]);

  const result = await h.service.markLineMessagePoison(
    { batchId: "batch-version-conflict-poison", phase: "run", sequence: 1 },
    { failureCode: "batch_version_conflict" },
  );

  assert.deepEqual(result, { persisted: true, skipped: "batch_generation_stale" });
  assert.equal(h.persistence.currentBatch("batch-version-conflict-poison").status, "building");
  assert.equal(h.persistence.currentBatch("batch-version-conflict-poison").haltReason, "");
});

test("a poison row delivery terminates only that row and keeps the batch moving", async () => {
  const h = harness({ rowFanout: true });
  h.persistence.seed({
    batchId: "batch-row-poison",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    rowAt("qualified", { rowId: "batch-row-poison:0", prospectId: "poisoned", rowIndex: 0 }),
    rowAt("qualified", { rowId: "batch-row-poison:1", prospectId: "healthy", rowIndex: 1 }),
  ]);

  const marked = await h.service.markLineMessagePoison({
    batchId: "batch-row-poison",
    phase: "row",
    rowId: "batch-row-poison:0",
    sequence: 0,
  }, { failureCode: "render_crashed" });

  assert.deepEqual(marked, { persisted: true });
  const batch = h.persistence.currentBatch("batch-row-poison");
  assert.equal(batch.status, "building");
  assert.equal(batch.rows.find((row) => row.prospectId === "poisoned").status, "error");
  assert.equal(batch.rows.find((row) => row.prospectId === "healthy").status, "qualified");
  assert.match(batch.rows.find((row) => row.prospectId === "poisoned").reason, /^queue_poison:render_crashed$/);
  assert.equal(h.publications.at(-1).phase, "run");
});

test("row poison checkpoints only its own live lease and never steals a duplicate worker lease", async () => {
  const h = harness({ rowFanout: true });
  h.persistence.seed({
    batchId: "batch-row-poison-owner",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
  }, [
    rowAt("qualified", {
      rowId: "batch-row-poison-owner:0",
      prospectId: "owned",
      rowIndex: 0,
      version: 1,
      leaseToken: "lease-owned",
      leaseOwner: "delivery-owned",
      leaseExpiresAt: new Date(START + 60_000).toISOString(),
    }),
    rowAt("qualified", {
      rowId: "batch-row-poison-owner:1",
      prospectId: "foreign",
      rowIndex: 1,
      version: 1,
      leaseToken: "lease-foreign",
      leaseOwner: "delivery-foreign",
      leaseExpiresAt: new Date(START + 60_000).toISOString(),
    }),
  ]);

  assert.deepEqual(await h.service.markLineMessagePoison({
    batchId: "batch-row-poison-owner",
    phase: "row",
    rowId: "batch-row-poison-owner:0",
    sequence: 0,
  }, {
    failureCode: "browser_failed",
    metadata: { messageId: "delivery-owned" },
  }), { persisted: true });
  assert.equal(h.persistence.currentRow("batch-row-poison-owner", "owned").status, "error");

  assert.deepEqual(await h.service.markLineMessagePoison({
    batchId: "batch-row-poison-owner",
    phase: "row",
    rowId: "batch-row-poison-owner:1",
    sequence: 0,
  }, {
    failureCode: "duplicate_delivery_failed",
    metadata: { messageId: "different-delivery" },
  }), { persisted: false });
  assert.equal(h.persistence.currentRow("batch-row-poison-owner", "foreign").status, "qualified");
});

test("pending 5/1/4 quota refill mines four while the active row keeps running", async () => {
  const picks = [];
  const h = harness({
    pick: async (input) => {
      picks.push(clone(input));
      return Array.from({ length: 4 }, (_, index) => ({
        prospectId: `replacement-${index + 1}`,
        businessName: `Replacement ${index + 1}`,
        email: `replacement-${index + 1}@example.test`,
        hasEmail: true,
        contactReady: true,
      }));
    },
  });
  h.persistence.seed({
    batchId: "batch-refill-5-1-4",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 5,
      rejected: {},
    }],
  }, [
    ...Array.from({ length: 5 }, (_, index) => rowAt("queued", {
      prospectId: `finished-${index + 1}`,
      rowIndex: index,
    })),
    rowAt("picked", {
      prospectId: "active-1",
      rowIndex: 5,
      buildRetryAfter: new Date(START + 10 * 60 * 1000).toISOString(),
    }),
    ...Array.from({ length: 4 }, (_, index) => rowAt("rejected", {
      prospectId: `failed-${index + 1}`,
      rowIndex: index + 6,
      reason: "build_failed",
    })),
  ]);

  const result = await h.service.processLineMessage({
    batchId: "batch-refill-5-1-4",
    phase: "run",
    sequence: 0,
  });

  const batch = h.persistence.currentBatch("batch-refill-5-1-4");
  assert.equal(picks.length, 1);
  assert.equal(picks[0].count, 4);
  assert.equal(result.selected, 4);
  assert.equal(batch.rows.length, 14);
  assert.equal(batch.rows.filter((row) => row.status === "queued").length, 5);
  assert.equal(batch.rows.filter((row) => row.status === "picked").length, 5);
  assert.equal(batch.rows.filter((row) => row.status === "rejected").length, 4);
  assert.equal(new Set(batch.rows.map((row) => row.prospectId)).size, 14, "refill never duplicates a durable prospect");
  assert.equal(result.queueAccepted, true);
  assert.equal("delaySeconds" in h.publications[0], false, "ready refill work publishes immediately");
  assert.equal(h.publications[0].sequence, batch.version);
});

test("picker external stages write a visible durable heartbeat before rows exist", async () => {
  let visibleWatch = null;
  let h;
  h = harness({
    pick: async ({ onStage }) => {
      await onStage("mine_build_ready", { reason: "external_stage" });
      const during = h.persistence.currentBatch("batch-pick-heartbeat");
      visibleWatch = during.mineFunnel.find((entry) => entry.stage === "line_start_watch_v1");
      return [{ prospectId: "prospect-heartbeat", businessName: "Heartbeat Roofing" }];
    },
  });
  h.persistence.seed({
    batchId: "batch-pick-heartbeat",
    lane: "sandbox",
    status: "building",
    pickState: "pending",
    requested: 1,
  });

  await h.service.processLineMessage({ batchId: "batch-pick-heartbeat", phase: "run", sequence: 0 });

  assert.equal(visibleWatch.pick_stage, "mine_build_ready");
  assert.equal(visibleWatch.pick_reason, "external_stage");
  assert.equal(visibleWatch.heartbeat_at, new Date(START).toISOString());
  assert.equal(h.persistence.currentBatch("batch-pick-heartbeat").rows.length, 1);
});

test("dead zero-row picker is rescued from its last heartbeat in about 90 seconds", async () => {
  let picks = 0;
  const h = harness({ pick: async () => { picks += 1; return []; } });
  h.persistence.seed({
    batchId: "batch-dead-picker",
    lane: "sandbox",
    status: "running",
    pickState: "picking",
    requested: 1,
    mineFunnel: [{
      stage: "line_start_watch_v1",
      claimed_at: new Date(START).toISOString(),
      heartbeat_at: new Date(START).toISOString(),
      pick_stage: "mine_build_ready",
      pick_stage_at: new Date(START).toISOString(),
      pick_reason: "external_stage",
    }],
  });

  h.advance(PICK_HEARTBEAT_STALE_MS - 1);
  const early = await h.service.processLineMessage({ batchId: "batch-dead-picker", phase: "run", sequence: 1 });
  assert.equal(early.skipped, "worker_active");
  assert.equal(picks, 0);

  h.advance(2);
  const rescued = await h.service.rescueLineBatches({ limit: 1 });
  assert.equal(rescued.selected, 1);
  assert.equal(picks, 1);
  assert.equal(h.persistence.currentBatch("batch-dead-picker").pickState, "complete");
  assert.equal(h.persistence.currentBatch("batch-dead-picker").rows.length, 0);
});

test("an old zombie picker halts visibly and never repeats an unresolved paid mining operation", async () => {
  let providerCalls = 1; // the vanished worker already crossed the provider boundary
  const batchId = "batch-zombie-picker";
  const target = "Austin, TX roofing";
  const operationKey = `pick_${createHash("sha256")
    .update(`${batchId}\0${0}\0legacy\0${target}`)
    .digest("hex")}`;
  const h = harness({
    pick: async () => {
      providerCalls += 1;
      return [];
    },
  });
  h.persistence.seed({
    batchId,
    lane: "sandbox",
    target,
    status: "running",
    pickState: "picking",
    requested: 1,
    mineFunnel: [{
      stage: "line_start_watch_v1",
      claimed_at: new Date(START).toISOString(),
      heartbeat_at: new Date(START).toISOString(),
      pick_stage: "mine_build_ready",
      pick_stage_at: new Date(START).toISOString(),
      pick_operation_key: operationKey,
      pick_operation_state: "in_flight",
      pick_operation_started_at: new Date(START).toISOString(),
    }],
  });

  h.advance(180_000);
  const rescued = await h.service.rescueLineBatches({ limit: 1 });

  assert.equal(rescued.selected, 1);
  assert.equal(providerCalls, 1, "unknown provider outcome is never bought twice");
  const batch = h.persistence.currentBatch(batchId);
  assert.equal(batch.status, "halted");
  assert.equal(batch.pickState, "complete");
  assert.equal(batch.haltReason, "pick_provider_outcome_unknown");
  const watch = batch.mineFunnel.find((entry) => entry.stage === "line_start_watch_v1");
  assert.equal(watch.pick_operation_key, operationKey);
  assert.equal(watch.pick_operation_state, "outcome_unknown_terminal");
  assert.equal(watch.pick_reason, "manual_new_batch_required");

  h.advance(24 * 60 * 60 * 1000);
  const repeatedRescue = await h.service.rescueLineBatches({ limit: 1 });
  assert.equal(repeatedRescue.selected, 0);
  assert.equal(providerCalls, 1, "terminal unknown operation is never retried later");
});

test("accepted mining survives later heartbeat and crash, then reconciles with zero provider calls", async () => {
  let providerCalls = 0;
  let acceptedStateDuringFirstWorker = "";
  const acceptedRow = {
    prospect_id: "accepted-prospect",
    build_hash: "a".repeat(64),
  };
  let h;
  h = harness({
    pick: async (input) => {
      if (input.acceptedMiningCheckpoint.length) {
        assert.deepEqual(input.acceptedMiningCheckpoint, [acceptedRow]);
        return [{ prospectId: "accepted-prospect", businessName: "Accepted Roofing" }];
      }
      providerCalls += 1;
      await input.onStage("mine_build_ready_accepted", {
        operationState: "accepted",
        acceptedRows: [acceptedRow],
      });
      await input.onStage("mined_authority_compile", { reason: "worker_alive" });
      const during = h.persistence.currentBatch("batch-accepted-crash");
      acceptedStateDuringFirstWorker = during.mineFunnel
        .find((entry) => entry.stage === "line_start_watch_v1")
        .pick_operation_state;
      throw Object.assign(new Error("worker_crashed_after_accept"), { retryable: true });
    },
  });
  h.persistence.seed({
    batchId: "batch-accepted-crash",
    lane: "sandbox",
    target: "Austin, TX roofing",
    status: "building",
    pickState: "pending",
    requested: 1,
  });

  const first = await h.service.processLineMessage({
    batchId: "batch-accepted-crash",
    phase: "run",
    sequence: 0,
  });
  assert.equal(first.error, "pick_failed");
  assert.equal(acceptedStateDuringFirstWorker, "accepted");
  assert.equal(providerCalls, 1);

  providerCalls = 0;
  h.advance(PICK_HEARTBEAT_STALE_MS + 1);
  const rescued = await h.service.rescueLineBatches({ limit: 1 });
  assert.equal(rescued.selected, 1);
  assert.equal(providerCalls, 0, "accepted durable rows reconcile without another provider call");
  assert.equal(h.persistence.currentBatch("batch-accepted-crash").rows.length, 1);
  assert.equal(h.persistence.currentRow("batch-accepted-crash", "accepted-prospect").status, "picked");
});

test("a zone-flood deep batch keeps every accepted row past the old 10-row checkpoint cap on resume", async () => {
  // Regression (2026-09-03): the accepted-checkpoint payload —
  // pick_accepted_rows on the durable start watch — was sliced to the first
  // 10 rows. A deep batch (LINE_DEEP_BATCH_DEPTH, PR #691) accepts far more
  // than 10 durable rows before the response/checkpoint boundary, so a crash
  // there dropped rows 11+ from the resume and they could not reconcile
  // without paying the provider twice. LINE_RESUME_CAP (default 50) keeps
  // the whole flood wave durable.
  let providerCalls = 0;
  let watchRowsDuringFirstWorker = null;
  const acceptedRows = Array.from({ length: 25 }, (_, index) => ({
    prospect_id: `flood-prospect-${String(index + 1).padStart(2, "0")}`,
    build_hash: `${"f".repeat(62)}${String(index + 1).padStart(2, "0")}`,
  }));
  let h;
  h = harness({
    pick: async (input) => {
      if (input.acceptedMiningCheckpoint.length) {
        assert.deepEqual(input.acceptedMiningCheckpoint, acceptedRows,
          "the resume payload carries all 25 accepted rows, not the first 10");
        return acceptedRows.map((row) => ({
          prospectId: row.prospect_id,
          businessName: `Flood Roofing ${row.prospect_id}`,
        }));
      }
      providerCalls += 1;
      await input.onStage("mine_build_ready_accepted", {
        operationState: "accepted",
        acceptedRows,
      });
      await input.onStage("mined_authority_compile", { reason: "worker_alive" });
      const during = h.persistence.currentBatch("batch-flood-accepted-crash");
      watchRowsDuringFirstWorker = during.mineFunnel
        .find((entry) => entry.stage === "line_start_watch_v1")
        .pick_accepted_rows;
      throw Object.assign(new Error("worker_crashed_after_flood_accept"), { retryable: true });
    },
  });
  h.persistence.seed({
    batchId: "batch-flood-accepted-crash",
    lane: "sandbox",
    target: "roofing in Oklahoma City, OK",
    status: "building",
    pickState: "pending",
    requested: 25,
  });

  const first = await h.service.processLineMessage({
    batchId: "batch-flood-accepted-crash",
    phase: "run",
    sequence: 0,
  });
  assert.equal(first.error, "pick_failed");
  assert.equal(watchRowsDuringFirstWorker.length, 25,
    "the durable watch keeps all 25 accepted rows, not the historical first 10");
  assert.equal(providerCalls, 1);

  providerCalls = 0;
  h.advance(PICK_HEARTBEAT_STALE_MS + 1);
  const rescued = await h.service.rescueLineBatches({ limit: 1 });
  assert.equal(rescued.selected, 1);
  assert.equal(providerCalls, 0, "all 25 accepted flood rows reconcile without another provider call");
  assert.equal(h.persistence.currentBatch("batch-flood-accepted-crash").rows.length, 25);
  for (const row of acceptedRows) {
    assert.equal(
      h.persistence.currentRow("batch-flood-accepted-crash", row.prospect_id).status,
      "picked",
      `accepted row ${row.prospect_id} is reseated by the resume`,
    );
  }
});

test("candidate-local Genie quarantine survives restart and stays excluded from quota refill", async () => {
  const pickCalls = [];
  const authorityRejection = {
    stage: "intake_genie_authority_packet",
    entered: 3,
    survived: 2,
    rejected: { intake_genie_candidate_refused: 1 },
  };
  const pick = async (input) => {
    pickCalls.push(clone(input));
    if (pickCalls.length === 1) {
      const selected = [
        { prospectId: "q2", businessName: "Compiled Two", hasEmail: true, contactReady: true },
        { prospectId: "q3", businessName: "Compiled Three", hasEmail: true, contactReady: true },
      ];
      selected.quarantined = [{
        prospectId: "q1",
        businessName: "Refused One",
        reason: "intake_genie_candidate_refused: deterministic_422",
        problems: [{
          code: "business_name_mismatch",
          field: "name",
          expected: "Refused One",
          actual: "Different Plumbing",
          compared: { candidate: "Refused One", compiled: "Different Plumbing" },
        }],
      }];
      selected.funnel = [authorityRejection];
      return selected;
    }
    return [{ prospectId: "q4", businessName: "Replacement Four", hasEmail: true, contactReady: true }];
  };
  const processRowPhase = async (row) => {
    const at = new Date(START).toISOString();
    if (row.status === "picked") return lineState.advanceRow(row, "qualified", { now: at });
    if (row.status === "qualified") return lineState.advanceRow(row, "mirrored", { now: at });
    if (row.status === "mirrored") {
      return lineState.advanceRow(row, "gate_passed", {
        gate: { pass: true, failed: [] },
        now: at,
      });
    }
    if (row.status === "gate_passed") {
      return lineState.advanceRow(row, "queued", {
        previewUrl: "https://compiled-two.example.test",
        now: at,
      });
    }
    return { ok: false, error: `unexpected_phase_${row.status}` };
  };
  const h = harness({ pick, processRowPhase });
  h.persistence.seed({
    batchId: "batch-genie-quarantine-restart",
    lane: "sandbox",
    target: "roofing nationwide",
    requested: 3,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 3,
      survived: 0,
      rejected: {},
    }],
  });

  const rowStoreCalls = [];
  const storeRows = h.persistence.storeRows.bind(h.persistence);
  h.persistence.storeRows = async (input, options) => {
    rowStoreCalls.push(clone(input));
    return storeRows(input, options);
  };

  const first = await h.service.processLineMessage({
    batchId: "batch-genie-quarantine-restart",
    phase: "run",
    sequence: 0,
  });

  assert.equal(first.selected, 2);
  assert.equal(rowStoreCalls.length, 1, "survivors and quarantine share one durable checkpoint");
  assert.deepEqual(
    rowStoreCalls[0].rows.map((row) => [row.prospectId, row.status]),
    [["q2", "picked"], ["q3", "picked"], ["q1", "rejected"]],
  );
  assert.deepEqual(rowStoreCalls[0].rows[2].problems, [{
    code: "business_name_mismatch",
    field: "name",
    expected: "Refused One",
    actual: "Different Plumbing",
    compared: { candidate: "Refused One", compiled: "Different Plumbing" },
  }]);

  let restartNumber = 0;
  const restart = () => createLineContinuation({
    persistence: h.persistence,
    clock: h.clock,
    now: () => new Date(h.clock()).toISOString(),
    workerId: () => `restart-worker-${++restartNumber}`,
    rowClaim: 1,
    pickTimeoutMs: 1_000,
    pick,
    processRowPhase,
    enqueueLineMessage: async () => ({ accepted: true, messageId: `restart-${restartNumber}` }),
    inlinePickQualification: false,
  });

  // Model independent build workers completing both successful siblings. Each
  // move still goes through the canonical state machine; only the resulting
  // durable rows survive into the restarted continuation under test.
  for (const prospectId of ["q2", "q3"]) {
    let durable = h.persistence.currentRow("batch-genie-quarantine-restart", prospectId);
    while (durable.status !== "queued") {
      const advanced = await processRowPhase(durable);
      assert.equal(advanced.ok, true);
      durable = advanced.row;
    }
    h.persistence.rows.set(durable.rowId, durable);
  }

  const reconcileService = restart();
  const reconciled = await reconcileService.processLineMessage({
    batchId: "batch-genie-quarantine-restart",
    phase: "run",
    sequence: 1,
  });
  assert.equal(reconciled.ok, true);
  assert.deepEqual(
    h.persistence.currentRow("batch-genie-quarantine-restart", "q1").problems,
    rowStoreCalls[0].rows[2].problems,
    "structured compiler comparisons survive the durable restart",
  );

  const beforeRefill = h.persistence.currentBatch("batch-genie-quarantine-restart");
  assert.equal(beforeRefill.pickState, "pending");
  assert.deepEqual(
    beforeRefill.rows.map((row) => [row.prospectId, row.status]),
    [["q2", "queued"], ["q3", "queued"], ["q1", "rejected"]],
  );

  const refillService = restart();
  const refill = await refillService.processLineMessage({
    batchId: "batch-genie-quarantine-restart",
    phase: "run",
    sequence: 2,
  });

  assert.equal(refill.selected, 1);
  assert.equal(pickCalls.length, 2);
  assert.equal(pickCalls[1].count, 1);
  assert.deepEqual(new Set(pickCalls[1].excludeProspectIds), new Set(["q1", "q2", "q3"]));
  const finalBatch = h.persistence.currentBatch("batch-genie-quarantine-restart");
  assert.equal(finalBatch.rows.filter((row) => row.prospectId === "q1").length, 1);
  assert.equal(finalBatch.rows.find((row) => row.prospectId === "q1").status, "rejected");
  assert.deepEqual(finalBatch.rows.map((row) => row.prospectId), ["q2", "q3", "q1", "q4"]);
  assert.deepEqual(
    finalBatch.mineFunnel.find((row) => row.stage === "intake_genie_authority_packet")?.rejected,
    authorityRejection.rejected,
  );
});

test("a clean empty quota source schedules exactly one next-source pass after one second", async (t) => {
  const previous = process.env.GHOST_AGENCY_LINE_FAST_REFILL;
  delete process.env.GHOST_AGENCY_LINE_FAST_REFILL;
  t.after(() => {
    if (previous === undefined) delete process.env.GHOST_AGENCY_LINE_FAST_REFILL;
    else process.env.GHOST_AGENCY_LINE_FAST_REFILL = previous;
  });
  let picks = 0;
  const h = harness({
    pick: async () => {
      picks += 1;
      return [];
    },
  });
  h.persistence.seed({
    batchId: "batch-fast-refill",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-fast-refill",
    phase: "run",
    sequence: 0,
  });

  const batch = h.persistence.currentBatch("batch-fast-refill");
  assert.equal(picks, 1, "one worker message spends only one source attempt");
  assert.equal(quota.sourceAttempt(batch.mineFunnel), 1);
  assert.equal(batch.status, "building");
  assert.equal(batch.pickState, "pending");
  assert.equal(result.queueAccepted, true);
  assert.deepEqual(h.publications, [{
    batchId: "batch-fast-refill",
    phase: "run",
    sequence: batch.version,
    delaySeconds: 1,
  }]);
});

test("GHOST_AGENCY_LINE_FAST_REFILL=0 restores cron-only empty-source rotation", async (t) => {
  const previous = process.env.GHOST_AGENCY_LINE_FAST_REFILL;
  process.env.GHOST_AGENCY_LINE_FAST_REFILL = "0";
  t.after(() => {
    if (previous === undefined) delete process.env.GHOST_AGENCY_LINE_FAST_REFILL;
    else process.env.GHOST_AGENCY_LINE_FAST_REFILL = previous;
  });
  const h = harness({ pick: async () => [] });
  h.persistence.seed({
    batchId: "batch-fast-refill-disabled",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-fast-refill-disabled",
    phase: "run",
    sequence: 0,
  });

  assert.equal(result.queueAccepted, false);
  assert.equal(h.publications.length, 0);
  assert.equal(h.persistence.currentBatch("batch-fast-refill-disabled").pickState, "pending");
});

test("a source exception stays on cron recovery and never enters fast refill", async (t) => {
  const previous = process.env.GHOST_AGENCY_LINE_FAST_REFILL;
  delete process.env.GHOST_AGENCY_LINE_FAST_REFILL;
  t.after(() => {
    if (previous === undefined) delete process.env.GHOST_AGENCY_LINE_FAST_REFILL;
    else process.env.GHOST_AGENCY_LINE_FAST_REFILL = previous;
  });
  const h = harness({
    pick: async () => { throw new Error("provider unavailable"); },
  });
  h.persistence.seed({
    batchId: "batch-fast-refill-error",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-fast-refill-error",
    phase: "run",
    sequence: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "pick_failed");
  assert.equal(result.queueAccepted, false);
  assert.equal(h.publications.length, 0);
});

test("a terminal non-exact intake genie compile error halts without retry or publication", async () => {
  let picks = 0;
  const h = harness({
    pick: async () => {
      picks += 1;
      const error = new Error("intake genie compile terminal");
      error.code = "intake_genie_compile_terminal";
      error.retryable = false;
      throw error;
    },
  });
  h.persistence.seed({
    batchId: "batch-intake-genie-terminal",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-intake-genie-terminal",
    phase: "run",
    sequence: 0,
  });

  const batch = h.persistence.currentBatch("batch-intake-genie-terminal");
  assert.equal(picks, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, "intake_genie_compile_terminal");
  assert.equal(result.retryable, false);
  assert.equal(result.queueAccepted, false);
  assert.equal(batch.status, "halted");
  assert.equal(batch.pickState, "complete");
  assert.equal(batch.haltReason, "intake_genie_compile_terminal");
  assert.equal(
    batch.mineFunnel.some((row) => row.stage === "intake_genie_terminal_pick_v1"),
    false,
    "no causeCode leaves durable funnel evidence unchanged",
  );
  const haltPatch = h.persistence.calls.stores.find((call) => call.patch.status === "halted")?.patch;
  assert.equal(Object.hasOwn(haltPatch, "mineFunnel"), false, "no causeCode preserves the original release patch");
  assert.equal(h.publications.length, 0);
});

test("an exact terminal intake genie failure persists its bounded safe compiler cause", async () => {
  const h = harness({
    pick: async () => {
      const error = new Error("intake genie compile terminal");
      error.code = "intake_genie_compile_terminal";
      error.causeCode = `intake_genie_certification_failed:${"independent_identity_anchor_missing,".repeat(20)}`;
      error.problems = [{
        code: "business_name_mismatch",
        compared: { candidate: "Acme", compiled: "Acme Plumbing" },
      }];
      error.retryable = false;
      throw error;
    },
  });
  h.persistence.seed({
    batchId: "batch-exact-intake-terminal-cause",
    lane: "sandbox",
    target: EXPLICIT_PROSPECT_TARGET,
    requested: 1,
    status: "building",
    pickState: "pending",
    mineFunnel: [createExplicitProspectMarker(["exact-prospect-1"])],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-exact-intake-terminal-cause",
    phase: "run",
    sequence: 0,
  });

  const batch = h.persistence.currentBatch("batch-exact-intake-terminal-cause");
  const evidence = batch.mineFunnel.find((row) => row.stage === "intake_genie_terminal_pick_v1");
  assert.equal(result.ok, false);
  assert.equal(result.error, "explicit_prospect_pick_failed");
  assert.equal(batch.status, "halted");
  assert.equal(batch.haltReason, "intake_genie_compile_terminal");
  assert.equal(evidence.error_code, "intake_genie_compile_terminal");
  assert.match(evidence.cause_code, /^intake_genie_certification_failed:/);
  assert.ok(evidence.cause_code.length <= 160);
  assert.match(evidence.cause_code, /^[a-z][a-z0-9_.:-]*$/);
  assert.doesNotMatch(evidence.cause_code, /,/);
  assert.deepEqual(evidence.problems, [{
    code: "business_name_mismatch",
    compared: { candidate: "Acme", compiled: "Acme Plumbing" },
  }]);
  assert.equal(h.publications.length, 0);
});

test("known Intake Genie HTTP and configuration failures keep a useful safe terminal cause", async () => {
  for (const row of [
    { id: "http-auth", input: "intake_genie_http_401", expected: "intake_genie_http_401" },
    { id: "http-route", input: "compiler_http_404", expected: "intake_genie_http_404" },
    { id: "config", input: "compiler_not_configured", expected: "intake_genie_not_configured" },
  ]) {
    const h = harness({
      pick: async () => {
        const error = new Error("intake genie compile terminal");
        error.code = "intake_genie_compile_terminal";
        error.causeCode = row.input;
        error.retryable = false;
        throw error;
      },
    });
    const batchId = `batch-intake-terminal-${row.id}`;
    h.persistence.seed({
      batchId,
      lane: "sandbox",
      target: "roofing nationwide",
      requested: 1,
      status: "building",
      pickState: "pending",
      mineFunnel: [],
    });

    await h.service.processLineMessage({ batchId, phase: "run", sequence: 0 });

    const evidence = h.persistence.currentBatch(batchId).mineFunnel
      .find((entry) => entry.stage === "intake_genie_terminal_pick_v1");
    assert.equal(evidence.cause_code, row.expected, row.id);
  }
});

test("a code-shaped terminal compiler cause passes through verbatim", async () => {
  const h = harness({
    pick: async () => {
      const error = new Error("intake genie compile terminal");
      error.code = "intake_genie_compile_terminal";
      error.causeCode = "intake_genie_receipt_signature_invalid";
      error.retryable = false;
      throw error;
    },
  });
  h.persistence.seed({
    batchId: "batch-terminal-cause-code-passthrough",
    lane: "sandbox",
    target: "roofing nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-terminal-cause-code-passthrough",
    phase: "run",
    sequence: 0,
  });

  const batch = h.persistence.currentBatch("batch-terminal-cause-code-passthrough");
  const evidence = batch.mineFunnel.find((row) => row.stage === "intake_genie_terminal_pick_v1");
  assert.equal(result.error, "intake_genie_compile_terminal");
  assert.equal(batch.haltReason, "intake_genie_compile_terminal");
  assert.equal(evidence.cause_code, "intake_genie_receipt_signature_invalid");
  assert.doesNotMatch(Object.values(evidence).join(" "), /@/);
});

test("a non-exact terminal compiler cause redacts unsafe packet or PII text", async () => {
  const h = harness({
    pick: async () => {
      const error = new Error("intake genie compile terminal");
      error.code = "intake_genie_compile_terminal";
      error.causeCode = "intake_genie_certification_failed:{email:owner@example.test}";
      error.retryable = false;
      throw error;
    },
  });
  h.persistence.seed({
    batchId: "batch-non-exact-intake-terminal-redacted",
    lane: "sandbox",
    target: "roofing nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-non-exact-intake-terminal-redacted",
    phase: "run",
    sequence: 0,
  });

  const batch = h.persistence.currentBatch("batch-non-exact-intake-terminal-redacted");
  const evidence = batch.mineFunnel.find((row) => row.stage === "intake_genie_terminal_pick_v1");
  assert.equal(result.error, "intake_genie_compile_terminal");
  assert.equal(batch.haltReason, "intake_genie_compile_terminal");
  assert.equal(evidence.error_code, "intake_genie_compile_terminal");
  assert.equal(evidence.cause_code, "terminal_cause_redacted");
  assert.doesNotMatch(Object.values(evidence).join(" "), /owner|example\.test|@/i);
  assert.equal(h.publications.length, 0);
});

test("a retryable Intake Genie 429 keeps the batch active and republishes", async () => {
  let picks = 0;
  const h = harness({
    pick: async () => {
      picks += 1;
      const error = new Error("intake genie rate limited");
      error.code = "intake_genie_compile_retryable";
      error.retryable = true;
      throw error;
    },
  });
  h.persistence.seed({
    batchId: "batch-intake-genie-429",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-intake-genie-429",
    phase: "run",
    sequence: 0,
  });

  const batch = h.persistence.currentBatch("batch-intake-genie-429");
  assert.equal(picks, 1);
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.queueAccepted, true);
  assert.equal(batch.status, "building");
  assert.equal(batch.pickState, "pending");
  assert.equal(batch.haltReason, "");
  assert.equal(h.publications.length, 1);
  assert.equal(h.publications[0].batchId, batch.batchId);
  assert.equal(h.publications[0].phase, "run");
  assert.equal(h.publications[0].sequence, batch.version);
  assert.equal(h.publications[0].delaySeconds, 60);
});

test("hero wake outranks quota refill and ignores the waiting row's poll delay", async () => {
  let picks = 0;
  const h = harness({
    pick: async () => { picks += 1; return []; },
    rowFanout: true,
  });
  h.persistence.seed({
    batchId: "batch-hero-wake",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
  }, [1, 2, 3].map((number, index) => rowAt("qualified", {
    rowId: `batch-hero-wake:${index}`,
    prospectId: `hero-prospect-${number}`,
    rowIndex: index,
    heroRemaster: { required: true, pending: true, status: "done" },
    buildRetryAfter: new Date(START + 10 * 60 * 1000).toISOString(),
  })));

  const result = await h.service.processLineMessage({
    batchId: "batch-hero-wake",
    phase: "hero",
    sequence: 0,
    rowId: "batch-hero-wake:2",
  });

  assert.equal(picks, 0, "the verified rebuild releases before replacement mining");
  assert.equal(h.phaseCalls.length, 1);
  assert.equal(h.phaseCalls[0].status, "qualified");
  assert.equal(h.persistence.currentRow("batch-hero-wake", "hero-prospect-1").status, "qualified");
  assert.equal(h.persistence.currentRow("batch-hero-wake", "hero-prospect-2").status, "qualified");
  assert.equal(h.persistence.currentRow("batch-hero-wake", "hero-prospect-3").status, "mirrored");
  assert.equal(result.processed, 1);
  assert.equal(result.queueAccepted, true, "the row fleet resumes after the exact hero row");
  assert.equal(h.publications.filter((message) => message.phase === "row").length, 3);
});


test("finished-site quota replaces failed attempts until the requested ready count is full", async () => {
  const picks = [];
  let round = 0;
  const h = harness({
    pick: async (input) => {
      picks.push(clone(input));
      round += 1;
      if (round === 1) {
        return [
          { prospectId: "quota-good-1", businessName: "Good One", email: "one@example.test", hasEmail: true, contactReady: true },
          { prospectId: "quota-bad-1", businessName: "Bad One", email: "bad@example.test", hasEmail: true, contactReady: true },
        ];
      }
      if (round === 2) {
        return [
          { prospectId: "quota-good-2", businessName: "Good Two", email: "two@example.test", hasEmail: true, contactReady: true },
        ];
      }
      return [];
    },
    processRowPhase: async (row) => {
      let outcome;
      if (row.prospectId === "quota-bad-1" && row.status === "picked") {
        outcome = lineState.advanceRow(row, "rejected", { reason: "quality refused", now: new Date(START).toISOString() });
      } else if (row.status === "picked") {
        outcome = lineState.advanceRow(row, "qualified", { now: new Date(START).toISOString() });
      } else if (row.status === "qualified") {
        outcome = lineState.advanceRow(row, "mirrored", { previewUrl: `https://${row.prospectId}.example.test`, now: new Date(START).toISOString() });
      } else if (row.status === "mirrored") {
        outcome = lineState.advanceRow(row, "gate_passed", {
          gate: { pass: true, failed: [] },
          now: new Date(START).toISOString(),
        });
      } else if (row.status === "gate_passed") {
        outcome = lineState.advanceRow(row, "queued", {
          previewUrl: row.previewUrl,
          now: new Date(START).toISOString(),
        });
      } else {
        return { ok: false, error: `unexpected_${row.status}` };
      }
      return outcome.ok ? { ok: true, row: outcome.row } : outcome;
    },
  });
  h.persistence.seed({
    batchId: "batch-finished-quota",
    lane: "sandbox",
    target: "roofing nationwide",
    requested: 2,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 2,
      survived: 0,
      rejected: {},
    }],
  });

  for (let pass = 0; pass < 24; pass += 1) {
    const batch = h.persistence.currentBatch("batch-finished-quota");
    if (batch.status === "approved") break;
    await h.service.processLineMessage({
      batchId: "batch-finished-quota",
      phase: "run",
      sequence: batch.version,
    });
  }

  const finished = h.persistence.currentBatch("batch-finished-quota");
  assert.equal(finished.status, "approved");
  assert.equal(finished.requested, 2);
  assert.equal(finished.rows.filter((row) => row.status === "queued").length, 2);
  assert.equal(finished.rows.filter((row) => row.status === "rejected").length, 1);
  assert.equal(finished.rows.length, 3, "failed attempts remain visible but do not consume finished slots");
  assert.equal(picks.length, 2);
  assert.equal(picks[0].count, 2);
  assert.equal(picks[1].count, 1);
  assert.deepEqual(new Set(picks[1].excludeProspectIds), new Set(["quota-good-1", "quota-bad-1"]));
});

test("a terminal fresh-source result drains its certified sibling and sends only the owner proof", async () => {
  let pickCalls = 0;
  let providerCalls = 0;
  const h = harness({
    pick: async () => {
      pickCalls += 1;
      const selected = [{
        prospectId: "terminal-certified-good",
        businessName: "Terminal Certified Good",
        email: "owner@example.test",
        hasEmail: true,
        contactReady: true,
        genieContentCertified: true,
      }];
      selected.quarantined = [{
        prospectId: "terminal-local-refusal",
        businessName: "Terminal Local Refusal",
        vertical: "roofing",
        reason: "intake_genie_candidate_refused: services_missing",
      }];
      selected.funnel = [];
      selected.sourceExhausted = {
        exhausted: true,
        reason: "operator_query_cycle_exhausted",
        refillRound: 0,
      };
      return selected;
    },
    createLineSender: twoPhaseSenderFactory({
      deliver: async (plan) => {
        providerCalls += 1;
        return {
          ok: true,
          providerReceipt: "re_terminal_drain",
          idempotencyKey: plan.idempotencyKey,
          acceptedAt: new Date(START).toISOString(),
        };
      },
    }),
  });
  h.persistence.seed({
    batchId: "batch-terminal-certified-drain",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 2,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: quota.QUOTA_CONTRACT_STAGE,
      entered: 2,
      survived: 0,
      rejected: {},
    }],
  });

  for (let pass = 0; pass < 12; pass += 1) {
    const batch = h.persistence.currentBatch("batch-terminal-certified-drain");
    if (batch.status === "approved") break;
    await h.service.processLineMessage({
      batchId: batch.batchId,
      phase: "run",
      sequence: batch.version,
    });
  }

  const approved = h.persistence.currentBatch("batch-terminal-certified-drain");
  assert.equal(pickCalls, 1, "the terminal marker closes refills after the one accepted source result");
  assert.equal(approved.status, "approved");
  assert.equal(quota.remainingFinishedQuota(approved), 1, "the owner-only drain remains an honest partial batch");
  assert.equal(approved.rows.length, 2);
  assert.equal(approved.rows.find((row) => row.prospectId === "terminal-certified-good")?.status, "queued");
  assert.equal(approved.rows.find((row) => row.prospectId === "terminal-certified-good")?.genieContentCertified, true);
  assert.equal(approved.rows.find((row) => row.prospectId === "terminal-local-refusal")?.status, "rejected");
  assert.equal(quota.terminalSourceExhausted(approved), true);
  assert.equal(quota.terminalCertifiedDrainAllowed(approved), true);

  await h.service.processLineMessage({
    batchId: approved.batchId,
    phase: "send",
    sequence: approved.version,
  });
  const done = h.persistence.currentBatch("batch-terminal-certified-drain");
  assert.equal(providerCalls, 1);
  assert.equal(done.status, "done");
  assert.equal(done.rows.find((row) => row.prospectId === "terminal-certified-good")?.status, "sent");
  assert.equal(done.rows.find((row) => row.prospectId === "terminal-local-refusal")?.status, "rejected");

  const duplicate = await h.service.processLineMessage({
    batchId: done.batchId,
    phase: "run",
    sequence: done.version,
  });
  assert.equal(duplicate.skipped, "batch_done");
  assert.equal(pickCalls, 1);
  assert.equal(providerCalls, 1);
});

test("the no-video Practice exception reaches continuation quota decisions while Live stays capped", async () => {
  const environment = { GHOST_AGENCY_HERO_AUTOLINE: "0" };
  for (const lane of ["sandbox", "live"]) {
    let pickCalls = 0;
    const h = harness({
      env: environment,
      pick: async () => {
        pickCalls += 1;
        return [{
          prospectId: `${lane}-no-video-replacement`,
          businessName: `${lane} No Video Replacement`,
          email: "owner@example.test",
          hasEmail: true,
          contactReady: true,
          genieContentCertified: true,
        }];
      },
    });
    h.persistence.seed({
      batchId: `batch-${lane}-no-video-quota`,
      lane,
      target: "roofing nationwide",
      requested: 1,
      status: "building",
      pickState: "pending",
      mineFunnel: [{ stage: quota.QUOTA_CONTRACT_STAGE, entered: 1, survived: 0, rejected: {} }],
    }, [rowAt("error", {
      prospectId: `${lane}-spent-candidate`,
      heroStartCheckpointed: true,
    })]);

    const result = await h.service.processLineMessage({
      batchId: `batch-${lane}-no-video-quota`,
      phase: "run",
      sequence: 0,
    });
    const batch = h.persistence.currentBatch(`batch-${lane}-no-video-quota`);
    if (lane === "sandbox") {
      assert.equal(pickCalls, 1);
      assert.equal(result.selected, 1);
      assert.equal(batch.status, "building");
      assert.equal(batch.rows.some((row) => row.prospectId === "sandbox-no-video-replacement"), true);
      for (let pass = 0; pass < 8; pass += 1) {
        const current = h.persistence.currentBatch(`batch-${lane}-no-video-quota`);
        if (current.status === "approved") break;
        await h.service.processLineMessage({
          batchId: current.batchId,
          phase: "run",
          sequence: current.version,
        });
      }
      const finished = h.persistence.currentBatch(`batch-${lane}-no-video-quota`);
      assert.equal(finished.status, "approved");
      assert.equal(finished.rows.filter((row) => row.status === "queued").length, 1);
      assert.equal(finished.rows.filter((row) => row.status === "error").length, 1);
    } else {
      assert.equal(pickCalls, 0);
      assert.equal(result.status, "halted");
      assert.equal(batch.status, "halted");
      assert.match(batch.haltReason, /^hero_paid_candidate_budget_exhausted:/);
    }
  }
});

test("a capped 2-of-10 batch halts as source exhausted instead of approving or finishing partial output", async () => {
  let senderCalls = 0;
  const h = harness({
    createLineSender: () => async () => {
      senderCalls += 1;
      return { ok: true, providerReceipt: "must_not_send" };
    },
  });
  h.persistence.seed({
    batchId: "batch-partial-source-exhausted",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "complete",
    mineFunnel: [
      { stage: quota.QUOTA_CONTRACT_STAGE },
      ...Array.from({ length: quota.MAX_REFILL_ATTEMPTS + 1 }, (_, attempt) => ({
        stage: `quota_source_${attempt}_bounded_source`,
      })),
    ],
  }, [
    rowAt("queued", { prospectId: "success-1", rowIndex: 0 }),
    rowAt("queued", { prospectId: "success-2", rowIndex: 1 }),
    ...Array.from({ length: 17 }, (_, index) => rowAt(index % 2 ? "rejected" : "gate_failed", {
      prospectId: `failed-${index + 1}`,
      rowIndex: index + 2,
      reason: "quality_refused",
    })),
  ]);

  const result = await h.service.processLineMessage({
    batchId: "batch-partial-source-exhausted",
    phase: "run",
    sequence: 0,
  });
  const halted = h.persistence.currentBatch("batch-partial-source-exhausted");

  assert.equal(result.status, "halted");
  assert.equal(halted.status, "halted");
  assert.equal(halted.pickState, "complete");
  assert.match(halted.haltReason, /^quota_source_exhausted:2_of_10_finished_after_13_source_attempts$/);
  assert.equal(halted.rows.filter((row) => row.status === "queued").length, 2);
  assert.equal(halted.rows.filter((row) => lineState.isFailed(row.status)).length, 17);
  assert.equal(h.persistence.calls.approvals.length, 0);
  assert.equal(h.publications.length, 0);
  assert.equal(senderCalls, 0);
});

test("the final empty bounded source halts in the same tick without waiting for the cron", async () => {
  let pickCalls = 0;
  const h = harness({
    pick: async () => {
      pickCalls += 1;
      return [];
    },
  });
  h.persistence.seed({
    batchId: "batch-final-source-empty",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [
      { stage: quota.QUOTA_CONTRACT_STAGE },
      ...Array.from({ length: quota.MAX_REFILL_ATTEMPTS }, (_, attempt) => ({
        stage: `quota_source_${attempt}_bounded_source`,
      })),
    ],
  }, [rowAt("queued", { prospectId: "only-success", rowIndex: 0 })]);

  const result = await h.service.processLineMessage({
    batchId: "batch-final-source-empty",
    phase: "run",
    sequence: 0,
  });
  const halted = h.persistence.currentBatch("batch-final-source-empty");

  assert.equal(pickCalls, 1, "the last allowed source is tried exactly once");
  assert.equal(result.status, "halted");
  assert.equal(result.queueAccepted, false);
  assert.equal(halted.status, "halted");
  assert.match(halted.haltReason, /^quota_source_exhausted:1_of_10_finished_after_13_source_attempts$/);
  assert.equal(h.publications.length, 0, "an exhausted source does not wait for the two-minute sweeper");
});

test("an already-approved partial quota is held before the email provider", async () => {
  let senderCalls = 0;
  const h = harness({
    createLineSender: () => async () => {
      senderCalls += 1;
      return { ok: true, providerReceipt: "must_not_send" };
    },
  });
  h.persistence.seed({
    ...approvedBatch("batch-partial-approved", "sandbox"),
    requested: 10,
    mineFunnel: [{ stage: quota.QUOTA_CONTRACT_STAGE }],
  }, [
    rowAt("queued", { prospectId: "partial-1", rowIndex: 0 }),
    rowAt("queued", { prospectId: "partial-2", rowIndex: 1 }),
  ]);

  const result = await h.service.processLineMessage({
    batchId: "batch-partial-approved",
    phase: "send",
    sequence: 3,
  });
  const halted = h.persistence.currentBatch("batch-partial-approved");

  assert.equal(result.ok, false);
  assert.equal(result.policyHold, true);
  assert.equal(halted.status, "halted");
  assert.match(halted.haltReason, /^quota_incomplete_before_send:2_of_10_finished_after_0_source_attempts$/);
  assert.equal(senderCalls, 0);
  assert.equal(h.persistence.calls.claims.length, 0);
});

test("SEND-ON-FINISH: a sandbox row is sent and checkpointed sent at email_queue, before the batch settles", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const sends = [];
  const h = harness({
    createLineSender: () => async (row, options) => {
      sends.push({ prospectId: row.prospectId, options });
      return { ok: true, providerReceipt: "receipt-send-on-finish" };
    },
    phaseDeps: { env: { GHOST_AGENCY_HERO_AUTOLINE: "0", GHOST_AGENCY_SEND_ON_FINISH: "1" } },
    processRowPhase: (row, context, deps) => processRowPhase(row, context, {
      ...deps,
      writePreviewUrl: async () => ({ ok: true, rowPatch: {} }),
      queueEmail: async () => ({ ok: true }),
    }),
  });
  h.persistence.seed({
    batchId: "batch-send-on-finish",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
    version: 3,
    requested: 1,
  }, [
    rowAt("gate_passed", {
      prospectId: "finish-fast",
      previewUrl: "https://finish-fast.wss-ai.com/",
      rowIndex: 0,
    }),
  ]);

  const result = await h.service.processLineMessage({
    batchId: "batch-send-on-finish",
    phase: "run",
    sequence: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(sends.length, 1, "the owner proof left the moment the row finished");
  assert.equal(sends[0].prospectId, "finish-fast");
  assert.equal(sends[0].options.sequence, 1);
  assert.equal(sends[0].options.step, 1);
  const row = h.persistence.currentRow("batch-send-on-finish", "finish-fast");
  assert.equal(row.status, "sent", "the durable row is sent before any settle path runs");
  const batch = h.persistence.currentBatch("batch-send-on-finish");
  assert.equal(batch.status, "done", "a fully sent batch settles done: no approval, no second send phase");
  assert.equal(h.publications.filter((message) => message.phase === "send").length, 0,
    "the settle-send is never published because there is nothing left queued");
});

test("SEND-ON-FINISH wiring: the per-row dep is the same settle sender identity, sandbox only", async () => {
  const factoryArgs = [];
  const senderCalls = [];
  let capturedDeps = null;
  const h = harness({
    createLineSender: (args) => {
      factoryArgs.push(clone(args));
      return async (row, options) => {
        senderCalls.push({ prospectId: row.prospectId, options: clone(options) });
        return { ok: true, providerReceipt: "receipt-wiring" };
      };
    },
    processRowPhase: async (row, _context, deps) => {
      capturedDeps = deps;
      if (row.status !== "gate_passed") return { ok: true, row };
      return { ok: true, row, phase: "gate" };
    },
  });
  h.persistence.seed({
    batchId: "batch-on-finish-wiring",
    lane: "sandbox",
    status: "building",
    pickState: "complete",
    version: 3,
    requested: 1,
  }, [
    rowAt("gate_passed", { prospectId: "wiring-1", previewUrl: "https://wiring-1.wss-ai.com/", rowIndex: 0 }),
  ]);
  await h.service.processLineMessage({ batchId: "batch-on-finish-wiring", phase: "run", sequence: 3 });
  assert.equal(typeof capturedDeps?.sendOnFinish, "function", "phaseDeps carry the send-on-finish dep");
  if (!capturedDeps) return;

  const sandboxContext = {
    lane: "sandbox",
    batchId: "batch-on-finish-wiring",
    deadlineAt: START + 60_000,
  };
  const finished = await capturedDeps.sendOnFinish(
    { prospectId: "wiring-1", previewUrl: "https://wiring-1.wss-ai.com/" },
    sandboxContext,
  );
  assert.equal(finished.ok, true);
  assert.deepEqual(factoryArgs[0], {
    lane: "sandbox",
    batchId: "batch-on-finish-wiring",
    deps: {},
  }, "the sender is built exactly like the settle-send builds it");
  assert.equal(senderCalls.length, 1);
  assert.equal(senderCalls[0].options.sequence, 1, "same sequence/step as the settle-send");
  assert.equal(senderCalls[0].options.step, 1);
  assert.equal(
    lineDeliveryIdempotencyKey({ batchId: "batch-on-finish-wiring", prospectId: "wiring-1", sequence: 1, step: 1 }),
    lineDeliveryIdempotencyKey({ batchId: "batch-on-finish-wiring", prospectId: "wiring-1", sequence: 1, step: 1 }),
  );
  assert.equal(senderCalls[0].options.deadlineAt, START + 60_000);

  const live = await capturedDeps.sendOnFinish(
    { prospectId: "wiring-1", previewUrl: "https://wiring-1.wss-ai.com/" },
    { lane: "live", batchId: "batch-on-finish-wiring" },
  );
  assert.equal(live.ok, false);
  assert.equal(live.reason, "send_on_finish_sandbox_only");
  assert.equal(factoryArgs.length, 1, "the live lane never builds a send-on-finish sender");
});

test("SEND DRAIN: the halted-drain approval bypasses the finished-quota hold and sends", async () => {
  let senderCalls = 0;
  const h = harness({
    createLineSender: () => async () => {
      senderCalls += 1;
      return { ok: true, providerReceipt: "receipt-drain" };
    },
  });
  h.persistence.seed({
    ...approvedBatch("batch-halted-drain-quota", "sandbox"),
    requested: 10,
    mineFunnel: [{ stage: quota.QUOTA_CONTRACT_STAGE }],
    approval: {
      ...approvedBatch("batch-halted-drain-quota", "sandbox").approval,
      actor: "sandbox_auto_send_drain",
    },
  }, [
    rowAt("queued", { prospectId: "drain-1", rowIndex: 0 }),
    rowAt("queued", { prospectId: "drain-2", rowIndex: 1 }),
  ]);

  const result = await h.service.processLineMessage({
    batchId: "batch-halted-drain-quota",
    phase: "send",
    sequence: 3,
  });

  assert.equal(senderCalls, 1, "an explicitly drained halted batch sends instead of quota-halting");
  assert.equal(result.ok, true);
  assert.equal(result.sent, 1);
  assert.equal(result.remaining, 1);
  const batch = h.persistence.currentBatch("batch-halted-drain-quota");
  assert.equal(batch.status, "approved", "rows remain, so the drain hands back to the next pass");
});

// ---------------------------------------------------------------------------
// Campaign speed (2026-09-02): slow-source rotation on compile timeouts.
// Batch line_mtkw4rlq_c830312fdd tagged all ten prospects
// intake_genie_compile_retryable + line_phase_timeout on attempt 0: every
// client-side compile timeout released the phase for a 60s delay and the
// batch re-mined the same slow source. The pick now (1) reports a timeout
// census on the thrown retryable error, (2) rotates a timeout-starved pass
// at the 1s fast-refill floor, and (3) records the source in an in-batch
// slow-source memo the next selection skips.
// ---------------------------------------------------------------------------

test("a timeout-starved compiler pass rotates at the fast-refill floor and memos the source slow", async () => {
  const h = harness({
    pick: async () => {
      const error = new Error("intake genie compile timed out");
      error.code = "intake_genie_compile_retryable";
      error.retryable = true;
      error.compileTimeoutCount = 3;
      error.compileRetryableCount = 3;
      error.compileSourceTarget = "plumbing in Tulsa OK";
      throw error;
    },
  });
  h.persistence.seed({
    batchId: "batch-compile-timeout-starved",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-compile-timeout-starved",
    phase: "run",
    sequence: 0,
  });

  const batch = h.persistence.currentBatch("batch-compile-timeout-starved");
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(batch.status, "building");
  assert.equal(batch.pickState, "pending");
  assert.equal(h.publications.length, 1, "the rotation is scheduled, not left to the cron");
  assert.equal(h.publications[0].delaySeconds, 1, "timeout-class rotation pays the 1s fast-refill floor, not 60s");
  const watch = batch.mineFunnel.find((row) => row.stage === "line_start_watch_v1");
  const memo = watch && watch.slow_compile_sources;
  assert.ok(memo && memo["plumbing-in-tulsa-ok"], "the source is memo-slow for this batch");
  assert.equal(memo["plumbing-in-tulsa-ok"].target, "plumbing in Tulsa OK");
  assert.equal(memo["plumbing-in-tulsa-ok"].timeouts, 3);
});

test("a non-timeout compiler throttle keeps the conservative 60s retry floor without a memo", async () => {
  const h = harness({
    pick: async () => {
      const error = new Error("intake genie rate limited");
      error.code = "intake_genie_compile_retryable";
      error.retryable = true;
      error.compileTimeoutCount = 0;
      error.compileRetryableCount = 3;
      error.compileSourceTarget = "plumbing in Tulsa OK";
      throw error;
    },
  });
  h.persistence.seed({
    batchId: "batch-compile-throttle-no-memo",
    lane: "sandbox",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  const result = await h.service.processLineMessage({
    batchId: "batch-compile-throttle-no-memo",
    phase: "run",
    sequence: 0,
  });

  const batch = h.persistence.currentBatch("batch-compile-throttle-no-memo");
  assert.equal(result.ok, false);
  assert.equal(h.publications[0].delaySeconds, 60, "a 429-class throttle keeps the retry floor");
  const watch = batch.mineFunnel.find((row) => row.stage === "line_start_watch_v1");
  assert.equal(watch && watch.slow_compile_sources, undefined, "service health is never slow-source evidence");
});

test("a partial pass with timeout casualties memos its source and the refill skips it", async () => {
  const slowSource = quota.nextQuotaSource({
    batchId: "batch-partial-timeout-memo",
    target: "roofing nationwide",
    status: "building",
    mineFunnel: [],
  }, {});
  const picks = [];
  const h = harness({
    pick: async (input) => {
      picks.push(input.target);
      if (picks.length === 1) {
        const out = [{
          prospectId: "prospect-partial-one",
          businessName: "Partial Roofing One",
          email: "owner@example.test",
          hasEmail: true,
          contactReady: true,
        }];
        out.compileCasualties = {
          timeouts: 2,
          retryable: 2,
          sourceTarget: slowSource.target,
        };
        return out;
      }
      return [];
    },
  });
  h.persistence.seed({
    batchId: "batch-partial-timeout-memo",
    lane: "sandbox",
    target: "roofing nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 10,
      survived: 0,
      rejected: {},
    }],
  });

  await h.service.processLineMessage({ batchId: "batch-partial-timeout-memo", phase: "run", sequence: 0 });
  const afterFirst = h.persistence.currentBatch("batch-partial-timeout-memo");
  const watch = afterFirst.mineFunnel.find((row) => row.stage === "line_start_watch_v1");
  const memo = watch && watch.slow_compile_sources;
  assert.ok(memo, "the partial pass's timeout census reaches the durable memo");
  const memoEntries = Object.values(memo);
  assert.equal(memoEntries.length, 1);
  assert.equal(memoEntries[0].timeouts, 2);
  assert.equal(afterFirst.rows.length, 1, "the certified survivor is checkpointed");
  assert.equal(afterFirst.rows[0].prospectId, "prospect-partial-one");

  // The refill rides the published queue handle / later passes: drive the
  // loop until the second pick pass runs (bounded so a regression can never
  // spin forever).
  for (let drive = 0; drive < 8 && picks.length < 2; drive += 1) {
    await h.service.processLineMessage({ batchId: "batch-partial-timeout-memo", phase: "run", sequence: 0 });
  }
  assert.equal(picks.length, 2, "the refill runs a second pass");
  assert.notEqual(picks[1], picks[0], "the memo-slow source is skipped for a different source");
});

test("source selection advances past a memo-slow source before mining", async () => {
  const probe = quota.nextQuotaSource({
    batchId: "batch-skip-slow-source",
    target: "roofing nationwide",
    status: "building",
    mineFunnel: [],
  }, {});
  assert.ok(String(probe.target || "").trim(), "control: a nationwide target derives at attempt 0");
  const slowKey = String(probe.target).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const pickedTargets = [];
  const h = harness({
    pick: async (input) => {
      pickedTargets.push(input.target);
      return [];
    },
  });
  h.persistence.seed({
    batchId: "batch-skip-slow-source",
    lane: "sandbox",
    target: "roofing nationwide",
    requested: 10,
    status: "building",
    pickState: "pending",
    mineFunnel: [
      {
        stage: "line_start_watch_v1",
        slow_compile_sources: {
          [slowKey]: {
            target: probe.target,
            timeouts: 2,
            at: new Date(START).toISOString(),
          },
        },
      },
      {
        stage: "quota_contract_finished_sites_v1",
        entered: 10,
        survived: 0,
        rejected: {},
      },
    ],
  });

  await h.service.processLineMessage({ batchId: "batch-skip-slow-source", phase: "run", sequence: 0 });

  assert.equal(pickedTargets.length, 1);
  assert.notEqual(pickedTargets[0], probe.target, "the slow source never gets another mining pass");
});

test("pick stage checkpoints record per-stage elapsed ms for the timing report", async () => {
  const h = harness({
    pick: async ({ onStage }) => {
      await onStage("mine_build_ready", { reason: "stage_one" });
      return [{ prospectId: "prospect-stage-timing", businessName: "Stage Roofing" }];
    },
  });
  h.persistence.seed({
    batchId: "batch-pick-stage-timing",
    lane: "sandbox",
    target: "roofing nationwide",
    requested: 2,
    status: "building",
    pickState: "pending",
    mineFunnel: [{
      stage: "quota_contract_finished_sites_v1",
      entered: 2,
      survived: 0,
      rejected: {},
    }],
  });

  await h.service.processLineMessage({ batchId: "batch-pick-stage-timing", phase: "run", sequence: 0 });

  const watch = h.persistence.currentBatch("batch-pick-stage-timing").mineFunnel
    .find((row) => row.stage === "line_start_watch_v1");
  assert.ok(watch, "the durable watch exists");
  assert.equal(typeof watch.pick_stage_elapsed_ms, "number");
  assert.ok(watch.pick_stage_elapsed_ms >= 0, "the stage transition carries its elapsed ms");
});
