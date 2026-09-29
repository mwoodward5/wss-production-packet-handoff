"use strict";

const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const runner = require("../lib/line-runner");
const { readExplicitProspectMarker } = require("../lib/line-persistence");
const {
  DIRECT_START_RECOVERY_TIMEOUT_MS,
  QUEUE_PUBLISH_TIMEOUT_MS,
  createLineHandler,
  safeQueueFailureReason,
} = require("../api/admin/line");

const priorAdminToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
process.env.GHOST_AGENCY_ADMIN_TOKEN = "canonical-line-test-token";

after(() => {
  if (priorAdminToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorAdminToken;
});

function response(onEnd) {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
      if (onEnd) onEnd(this);
    },
  };
}

function request(method, url, body) {
  return {
    method,
    url,
    headers: { "x-admin-token": "canonical-line-test-token" },
    body: body === undefined ? "" : JSON.stringify(body),
  };
}

function readiness(overrides = {}) {
  return {
    ready: true,
    blockers: [],
    deliveryPause: { active: false, known: true, reason: "" },
    reviewHold: { active: false },
    liveSendsEnabled: false,
    ownerAddressConfigured: true,
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    rowId: "line_test:0",
    prospectId: "prospect-1",
    businessName: "Example Plumbing",
    city: "Tulsa",
    state: "OK",
    vertical: "plumber",
    status: "queued",
    previewUrl: "https://example.wss-ai.com/",
    email: "private-owner@example.test",
    phone: "+1 (918) 555-0100",
    history: [
      { status: "picked", at: "2026-08-14T00:00:00.000Z" },
      { status: "queued", at: "2026-08-14T00:04:00.000Z" },
    ],
    updatedAt: "2026-08-14T00:04:00.000Z",
    ...overrides,
  };
}

function batch(overrides = {}) {
  return {
    batchId: "line_test",
    lane: "sandbox",
    target: "Tulsa plumbers",
    requested: 1,
    status: "building",
    pickState: "pending",
    version: 0,
    haltReason: "",
    startedAt: "2026-08-14T00:00:00.000Z",
    settledAt: null,
    approval: null,
    rows: [],
    ...overrides,
  };
}

function canonicalHandler(overrides = {}) {
  return createLineHandler({
    readiness: async () => readiness(),
    sweepLineBatches: async () => ({ ok: true }),
    ...overrides,
  });
}

test("POST start durably creates one canonical batch and accepts exact counts 1, 13, and 50", async (t) => {
  runner.resetBatches();
  for (const count of [1, 13, 50]) {
    await t.test(String(count), async () => {
      const events = [];
      const queued = [];
      let stored;
      const persistence = {
        async createBatch(candidate) {
          events.push("create");
          stored = { ...candidate, version: 0 };
          return { ok: true, created: true, batch: stored };
        },
        async loadBatch(id) {
          events.push("load");
          assert.equal(id, stored.batchId);
          return { ok: true, batch: stored };
        },
      };
      const handler = canonicalHandler({
        persistence,
        async enqueueLineMessage(message) {
          events.push("enqueue");
          queued.push(message);
          return { accepted: true };
        },
      });
      const res = response();
      const finished = await Promise.race([
        handler(request("POST", "/api/admin/line", {
          action: "start",
          count,
          target: "plumbers in Tulsa",
          lane: "sandbox",
        }), res).then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 250)),
      ]);

      assert.equal(finished, true, "start must acknowledge the durable handoff without doing build work");
      assert.equal(res.statusCode, 202);
      assert.equal(res.body.accepted, true);
      assert.equal(res.body.building, true);
      assert.equal(res.body.batch.requested, count);
      assert.equal(events.filter((event) => event === "create").length, 1);
      assert.ok(events.indexOf("create") < events.indexOf("enqueue"), "durable create must finish before publication");
      assert.deepEqual(Object.keys(queued[0]).sort(), ["batchId", "phase", "sequence"]);
      assert.equal(queued[0].phase, "run");
    });
  }
});

test("POST halt durably terminates exactly one batch and repeated HALT is idempotent", async () => {
  let current = batch({
    batchId: "line_halt_contract",
    status: "building",
    pickState: "pending",
    version: 7,
    rows: [row({ rowId: "line_halt_contract:0", status: "qualified" })],
  });
  const originalRows = structuredClone(current.rows);
  let haltWrites = 0;
  let queueCalls = 0;
  const persistence = {
    async loadBatch(id) {
      assert.equal(id, current.batchId);
      return { ok: true, batch: structuredClone(current) };
    },
    async haltBatch(input) {
      if (current.status === "halted") {
        return { ok: true, idempotent: true, batch: structuredClone(current) };
      }
      assert.equal(input.expectedVersion, 7);
      assert.equal(input.expectedStatus, "building");
      assert.equal(input.reason, "certification_specimen_not_fresh");
      haltWrites += 1;
      current = {
        ...current,
        status: "halted",
        pickState: "complete",
        haltReason: input.reason,
        settledAt: "2026-08-28T20:30:00.000Z",
        version: 8,
      };
      return { ok: true, updated: true, idempotent: false, batch: structuredClone(current) };
    },
  };
  const handler = canonicalHandler({
    persistence,
    enqueueLineMessage: async () => { queueCalls += 1; return { accepted: true }; },
  });

  const first = response();
  await handler(request("POST", "/api/admin/line", {
    action: "halt",
    batchId: current.batchId,
    haltReason: "certification_specimen_not_fresh",
  }), first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.action, "halt");
  assert.equal(first.body.idempotent, false);
  assert.equal(first.body.automaticRecovery, false);
  assert.equal(first.body.actionableWork, 0);
  assert.equal(first.body.batch.status, "halted");
  assert.equal(first.body.batch.haltReason, "certification_specimen_not_fresh");

  const retry = response();
  await handler(request("POST", "/api/admin/line", {
    action: "halt",
    batchId: current.batchId,
    haltReason: "certification_specimen_not_fresh",
  }), retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.idempotent, true);
  assert.equal(haltWrites, 1);
  assert.equal(queueCalls, 0);
  assert.deepEqual(current.rows, originalRows);
});

test("POST halt rejects unsafe policy fields and never falls through to legacy state", async () => {
  let loaded = 0;
  const handler = canonicalHandler({
    persistence: {
      async loadBatch() { loaded += 1; return { ok: false, error: "batch_not_found" }; },
      async haltBatch() { throw new Error("must not run"); },
    },
  });
  const unsafe = response();
  await handler(request("POST", "/api/admin/line", {
    action: "halt",
    batchId: "line_halt_contract",
    haltReason: "certification_specimen_not_fresh",
    status: "building",
  }), unsafe);
  assert.equal(unsafe.statusCode, 400);
  assert.equal(unsafe.body.error, "halt_policy_invalid");
  assert.equal(loaded, 0);

  const missing = response();
  await handler(request("POST", "/api/admin/line", {
    action: "halt",
    batchId: "line_missing",
    haltReason: "certification_specimen_not_fresh",
  }), missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error, "unknown_batch");
  assert.equal(runner.getBatch("line_missing"), null);
});

test("POST start checkpoints an exact owner-selected packet set before queue publication", async () => {
  let stored;
  const handler = canonicalHandler({
    persistence: {
      async createBatch(candidate) {
        stored = { ...candidate, version: 0 };
        return { ok: true, created: true, batch: stored };
      },
      async loadBatch() { return { ok: true, batch: stored }; },
    },
    async enqueueLineMessage() { return { accepted: true }; },
  });
  const res = response();
  await handler(request("POST", "/api/admin/line", {
    action: "start",
    count: 2,
    prospectIds: ["place_exact_1", "place_exact_2"],
    target: "leadminer",
    lane: "sandbox",
  }), res);

  assert.equal(res.statusCode, 202);
  assert.equal(stored.target, "owner-selected-packets");
  assert.equal(stored.mineFunnel[0].stage, "explicit_prospect_ids_v1");
  const marker = readExplicitProspectMarker(stored.mineFunnel, { requested: 2 });
  assert.equal(marker.ok, true);
  assert.deepEqual(marker.ids, ["place_exact_1", "place_exact_2"]);
  assert.equal(Object.hasOwn(stored.mineFunnel[0], "prospect_ids"), false);
  assert.match(stored.mineFunnel[0].selection_sha256, /^[a-f0-9]{64}$/);
});

test("POST start directly claims the canonical batch when queue publication is rejected", async () => {
  let stored;
  const directCalls = [];
  const handler = canonicalHandler({
    persistence: {
      async createBatch(candidate) {
        stored = { ...candidate, version: 0, updatedAt: candidate.startedAt };
        return { ok: true, created: true, batch: stored };
      },
      async loadBatch() { return { ok: true, batch: stored }; },
    },
    async enqueueLineMessage() { return { accepted: false, error: "queue_disabled" }; },
    loadContinuation: () => ({
      async processLineMessage(message) {
        directCalls.push(message);
        stored = {
          ...stored,
          status: "running",
          pickState: "complete",
          version: 1,
          updatedAt: "2026-08-24T09:00:00.000Z",
        };
        return { ok: true, status: "building", processed: 1, queueAccepted: false };
      },
    }),
  });
  const res = response();

  await handler(request("POST", "/api/admin/line", {
    action: "start",
    count: 1,
    lane: "sandbox",
  }), res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.queueAccepted, false);
  assert.equal(res.body.recovery, "direct");
  assert.deepEqual(directCalls, [{
    batchId: stored.batchId,
    phase: "run",
    sequence: 0,
  }]);
  assert.equal(res.body.batch.status, "running");
  assert.equal(res.body.batch.pickState, "complete");
});

test("a hung direct recovery is bounded and leaves the durable start to cron", async () => {
  assert.equal(DIRECT_START_RECOVERY_TIMEOUT_MS, 1_800);
  let stored;
  const handler = canonicalHandler({
    directStartRecoveryTimeoutMs: 10,
    persistence: {
      async createBatch(candidate) {
        stored = { ...candidate, version: 0 };
        return { ok: true, created: true, batch: stored };
      },
      async loadBatch() { return { ok: true, batch: stored }; },
    },
    async enqueueLineMessage() { return { accepted: false, error: "queue_disabled" }; },
    loadContinuation: () => ({
      async processLineMessage() { return new Promise(() => {}); },
    }),
  });
  const res = response();
  const startedAt = Date.now();

  await handler(request("POST", "/api/admin/line", {
    action: "start",
    count: 1,
    lane: "sandbox",
  }), res);

  assert.ok(Date.now() - startedAt < 250, "direct recovery must not own the admin request");
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.queueAccepted, false);
  assert.equal(res.body.recovery, "cron");
  assert.equal(res.body.batch.batchId, stored.batchId);
});

test("a direct recovery rejection after its deadline is consumed", async () => {
  let stored;
  let rejectRecovery;
  const lateRecovery = new Promise((_, reject) => { rejectRecovery = reject; });
  const handler = canonicalHandler({
    directStartRecoveryTimeoutMs: 10,
    persistence: {
      async createBatch(candidate) {
        stored = { ...candidate, version: 0 };
        return { ok: true, created: true, batch: stored };
      },
      async loadBatch() { return { ok: true, batch: stored }; },
    },
    async enqueueLineMessage() { return { accepted: false, error: "queue_disabled" }; },
    loadContinuation: () => ({
      async processLineMessage() { return lateRecovery; },
    }),
  });
  const res = response();

  await handler(request("POST", "/api/admin/line", {
    action: "start",
    count: 1,
    lane: "sandbox",
  }), res);
  rejectRecovery(new Error("private late continuation failure"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.recovery, "cron");
  assert.doesNotMatch(JSON.stringify(res.body), /private late continuation failure/i);
});

test("POST start rejects a mismatched exact packet count before persistence", async () => {
  let creates = 0;
  const handler = canonicalHandler({
    persistence: {
      async createBatch() { creates += 1; return { ok: true }; },
    },
    async enqueueLineMessage() { throw new Error("must_not_publish"); },
  });
  const res = response();
  await handler(request("POST", "/api/admin/line", {
    action: "start",
    count: 2,
    prospectIds: ["place_exact_1"],
    lane: "sandbox",
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "prospect_ids_must_match_count");
  assert.equal(creates, 0);
});

test("requeue preserves the canonical lane and reports recoverable cron ownership when publication fails", async () => {
  const existing = batch({
    batchId: "line_immutable",
    lane: "sandbox",
    requested: 13,
    version: 8,
  });
  let creates = 0;
  let queueInput;
  const handler = canonicalHandler({
    persistence: {
      async createBatch() { creates += 1; return { ok: false }; },
      async loadBatch(id) {
        assert.equal(id, existing.batchId);
        return { ok: true, batch: existing };
      },
    },
    async enqueueLineMessage(message) {
      queueInput = message;
      throw Object.assign(
        new Error("private-owner@example.test must not escape"),
        { name: "ConsumerRegistryNotConfiguredError" },
      );
    },
  });
  const res = response();

  await handler(request("POST", "/api/admin/line", {
    action: "start",
    batchId: existing.batchId,
    lane: "live",
    count: 50,
  }), res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.batch.lane, "sandbox");
  assert.equal(res.body.queueAccepted, false);
  assert.equal(res.body.recovery, "cron");
  assert.equal(res.body.retryable, false);
  assert.equal(res.body.queueReason, "registry");
  assert.equal("error" in res.body, false);
  assert.doesNotMatch(JSON.stringify(res.body), /private-owner|example\.test/i);
  assert.equal(creates, 0);
  assert.deepEqual(queueInput, { batchId: existing.batchId, phase: "run", sequence: 8 });
});

test("GET is read-only and never invokes the recovery sweeper", async () => {
  const canonical = batch({ batchId: "line_sweep" });
  let sweeps = 0;
  const persistence = {
    async loadBatch() { return { ok: true, batch: canonical }; },
  };
  const handler = canonicalHandler({
    persistence,
    async sweepLineBatches() {
      sweeps += 1;
      return { ok: true };
    },
  });
  const res = response();

  await handler(request("GET", `/api/admin/line?batchId=${canonical.batchId}`), res);

  assert.equal(res.statusCode, 200);
  assert.equal(sweeps, 0);
});

test("GET reads the canonical batch after a cold start and returns no contact PII", async () => {
  runner.resetBatches();
  const canonical = batch({
    batchId: "line_cold",
    status: "awaiting_approval",
    pickState: "complete",
    rows: [row({ rowId: "line_cold:0" })],
  });
  const handler = canonicalHandler({
    persistence: {
      async loadBatch(id) {
        assert.equal(id, canonical.batchId);
        return { ok: true, batch: canonical };
      },
    },
  });
  const res = response();

  await handler(request("GET", `/api/admin/line?batchId=${canonical.batchId}`), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.batch.batchId, canonical.batchId);
  assert.equal(res.body.batch.rows[0].hasEmail, true);
  const publicJson = JSON.stringify(res.body);
  assert.equal(publicJson.includes("private-owner@example.test"), false);
  assert.equal(publicJson.includes("918"), false);
});

test("approval response waits for the canonical compare-and-set to commit", async () => {
  let current = batch({
    batchId: "line_approval",
    lane: "live",
    status: "awaiting_approval",
    pickState: "complete",
    version: 4,
    rows: [row({ rowId: "line_approval:0" })],
  });
  let releaseApproval;
  let casCalls = 0;
  const cas = new Promise((resolve) => { releaseApproval = resolve; });
  let ended = false;
  const handler = canonicalHandler({
    persistence: {
      async loadBatch() { return { ok: true, batch: current }; },
      async approveBatch(input) {
        casCalls += 1;
        assert.deepEqual(input, {
          batchId: current.batchId,
          expectedVersion: 4,
          typedBatchId: current.batchId,
          actor: "owner_typed_batch_id",
          approvedRows: 1,
        });
        const result = await cas;
        current = result.batch;
        return result;
      },
    },
  });
  const res = response(() => { ended = true; });
  const pending = handler(request("POST", "/api/admin/line", {
    action: "approve",
    batchId: current.batchId,
    typedBatchId: current.batchId,
    actor: "live_auto",
  }), res);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended, false, "HTTP 200 must not race ahead of the durable approval CAS");
  const approved = {
    ...current,
    status: "approved",
    version: 5,
    approval: { actor: "owner_typed_batch_id", typedBatchId: current.batchId, approvedRows: 1 },
  };
  releaseApproval({ ok: true, updated: true, batch: approved });
  await pending;

  assert.equal(casCalls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.batch.status, "approved");
});

test("legacy live start stops at awaiting approval and cannot auto-send", async () => {
  const originals = {
    startBatch: runner.startBatch,
    putBatch: runner.putBatch,
    sendApprovedBatch: runner.sendApprovedBatch,
  };
  const settled = batch({
    batchId: "line_live_explicit_approval",
    lane: "live",
    status: "awaiting_approval",
    pickState: "complete",
    version: 6,
    rows: [row({ rowId: "line_live_explicit_approval:0" })],
  });
  let approvals = 0;
  let sends = 0;
  runner.startBatch = async () => ({
    ok: true,
    batchId: settled.batchId,
    building: false,
    remaining: 0,
    batch: settled,
  });
  runner.putBatch = () => { approvals += 1; };
  runner.sendApprovedBatch = async () => { sends += 1; return { ok: true }; };
  try {
    const handler = createLineHandler({
      legacyInline: true,
      readiness: async () => readiness({ liveSendsEnabled: true }),
    });
    const res = response();
    await handler(request("POST", "/api/admin/line", {
      action: "start",
      count: 1,
      lane: "live",
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.batch.status, "awaiting_approval");
    assert.notEqual(res.body.autoSent, true);
    assert.equal(approvals, 0);
    assert.equal(sends, 0);
  } finally {
    Object.assign(runner, originals);
  }
});

test("approval compare-and-set outages return 503 instead of a validation error", async () => {
  const canonical = batch({
    batchId: "line_approval_outage",
    status: "awaiting_approval",
    pickState: "complete",
    version: 2,
    rows: [row({ rowId: "line_approval_outage:0" })],
  });
  const handler = canonicalHandler({
    persistence: {
      async loadBatch() { return { ok: true, batch: canonical }; },
      async approveBatch() { return { ok: false, conflict: false, error: "network_error" }; },
    },
  });
  const res = response();

  await handler(request("POST", "/api/admin/line", {
    action: "approve",
    batchId: canonical.batchId,
    typedBatchId: canonical.batchId,
  }), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "line_persistence_unavailable");
});

test("send refuses an unapproved batch and publishes only the opaque approved batch handle", async () => {
  let current = batch({
    batchId: "line_send",
    status: "awaiting_approval",
    pickState: "complete",
    version: 11,
    rows: [row({ rowId: "line_send:0" })],
  });
  const publications = [];
  const handler = canonicalHandler({
    persistence: {
      async loadBatch() { return { ok: true, batch: current }; },
    },
    async enqueueLineMessage(message) {
      publications.push(message);
      return { accepted: true };
    },
  });

  const refused = response();
  await handler(request("POST", "/api/admin/line", { action: "send", batchId: current.batchId }), refused);
  assert.equal(refused.statusCode, 403);
  assert.equal(publications.length, 0);

  current = {
    ...current,
    status: "approved",
    approval: { actor: "operator", typedBatchId: current.batchId, approvedRows: 1 },
  };
  const accepted = response();
  await handler(request("POST", "/api/admin/line", { action: "send", batchId: current.batchId }), accepted);

  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.body.accepted, true);
  assert.deepEqual(publications, [{ batchId: current.batchId, phase: "send", sequence: 11 }]);
  const queueJson = JSON.stringify(publications);
  assert.equal(queueJson.includes("private-owner@example.test"), false);
  assert.equal(queueJson.includes("918"), false);
  assert.deepEqual(Object.keys(publications[0]).sort(), ["batchId", "phase", "sequence"]);
});

test("historical live auto approvals cannot publish prospect sends", async (t) => {
  for (const actor of ["factory_auto_after_qc", "campaign_start_live", "live_auto"]) {
    await t.test(actor, async () => {
      const current = batch({
        batchId: `line_legacy_auto_${actor}`,
        lane: "live",
        status: "approved",
        pickState: "complete",
        version: 8,
        approval: {
          actor,
          at: "2026-08-18T20:02:00.000Z",
          typedBatchId: `line_legacy_auto_${actor}`,
          approvedRows: 1,
        },
        rows: [row({ rowId: `line_legacy_auto_${actor}:0` })],
      });
      let publications = 0;
      const handler = canonicalHandler({
        readiness: async () => readiness({ liveSendsEnabled: true }),
        persistence: {
          async loadBatch() { return { ok: true, batch: current }; },
        },
        async enqueueLineMessage() { publications += 1; return { accepted: true }; },
      });
      const res = response();

      await handler(request("POST", "/api/admin/line", {
        action: "send",
        batchId: current.batchId,
      }), res);

      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, "send_blocked:explicit_owner_approval_required");
      assert.equal(publications, 0);
    });
  }
});

test("an approved send remains durably accepted by cron when the queue declines it", async () => {
  const canonical = batch({
    batchId: "line_send_declined",
    status: "approved",
    pickState: "complete",
    version: 12,
    approval: { actor: "operator", typedBatchId: "line_send_declined", approvedRows: 1 },
    rows: [row({ rowId: "line_send_declined:0" })],
  });
  const handler = canonicalHandler({
    persistence: {
      async loadBatch() { return { ok: true, batch: canonical }; },
    },
    async enqueueLineMessage() { return { accepted: false, error: "queue_disabled" }; },
  });
  const res = response();

  await handler(request("POST", "/api/admin/line", { action: "send", batchId: canonical.batchId }), res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.sending, false);
  assert.equal(res.body.queueAccepted, false);
  assert.equal(res.body.retryable, false);
  assert.equal(res.body.recovery, "cron");
  assert.equal(res.body.queueReason, "not_accepted");
  assert.equal(res.body.batch.status, "approved");
  assert.equal("error" in res.body, false);
});

test("a hung queue publisher is bounded and leaves the durable start to cron", async () => {
  let stored;
  const handler = canonicalHandler({
    queuePublishTimeoutMs: 10,
    persistence: {
      async createBatch(candidate) {
        stored = { ...candidate, version: 0 };
        return { ok: true, created: true, batch: stored };
      },
      async loadBatch() { return { ok: true, batch: stored }; },
    },
    enqueueLineMessage: async () => new Promise(() => {}),
  });
  const res = response();
  const startedAt = Date.now();

  await handler(request("POST", "/api/admin/line", {
    action: "start",
    count: 1,
    lane: "sandbox",
  }), res);

  assert.ok(Date.now() - startedAt < 250, "the admin request must not inherit an unbounded queue wait");
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.queueAccepted, false);
  assert.equal(res.body.recovery, "cron");
  assert.equal(res.body.retryable, false);
  assert.equal(res.body.queueReason, "timeout");
  assert.equal("error" in res.body, false);
  assert.equal(res.body.batch.batchId, stored.batchId);
});

test("the production queue deadline allows a delayed success without weakening the hard ceiling", async () => {
  assert.equal(QUEUE_PUBLISH_TIMEOUT_MS, 8_000);

  let stored;
  const handler = canonicalHandler({
    queuePublishTimeoutMs: 100,
    persistence: {
      async createBatch(candidate) {
        stored = { ...candidate, version: 0 };
        return { ok: true, created: true, batch: stored };
      },
      async loadBatch() { return { ok: true, batch: stored }; },
    },
    enqueueLineMessage: async () => new Promise((resolve) => {
      setTimeout(() => resolve({ accepted: true, messageId: "msg_delayed" }), 25);
    }),
  });
  const res = response();

  await handler(request("POST", "/api/admin/line", {
    action: "start",
    count: 1,
    lane: "sandbox",
  }), res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.queueAccepted, true);
  assert.equal("queueReason" in res.body, false);
});

test("a queue rejection after the deadline is absorbed and exposes no exception text", async () => {
  let stored;
  let rejectPublication;
  const latePublication = new Promise((_, reject) => { rejectPublication = reject; });
  const handler = canonicalHandler({
    queuePublishTimeoutMs: 10,
    persistence: {
      async createBatch(candidate) {
        stored = { ...candidate, version: 0 };
        return { ok: true, created: true, batch: stored };
      },
      async loadBatch() { return { ok: true, batch: stored }; },
    },
    enqueueLineMessage: async () => latePublication,
  });
  const res = response();

  await handler(request("POST", "/api/admin/line", {
    action: "start",
    count: 1,
    lane: "sandbox",
  }), res);
  rejectPublication(Object.assign(
    new Error("private-owner@example.test must not escape"),
    { name: "ConsumerRegistryNotConfiguredError" },
  ));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.queueAccepted, false);
  assert.equal(res.body.recovery, "cron");
  assert.equal(res.body.retryable, false);
  assert.equal(res.body.queueReason, "timeout");
  assert.equal("error" in res.body, false);
  assert.doesNotMatch(JSON.stringify(res.body), /private-owner|example\.test/i);
});

test("queue failure classification is a fixed safe vocabulary", () => {
  assert.equal(safeQueueFailureReason({ name: "ConsumerRegistryNotConfiguredError" }), "registry");
  assert.equal(safeQueueFailureReason({ name: "ConsumerDiscoveryError" }), "discovery");
  assert.equal(safeQueueFailureReason({ name: "UnauthorizedError" }), "auth");
  assert.equal(safeQueueFailureReason({ name: "ForbiddenError" }), "auth");
  assert.equal(safeQueueFailureReason(new Error("private-owner@example.test")), "other");
});

test("validated client idempotency keys produce one durable batch without exposing the key", async () => {
  const saved = new Map();
  let actualCreates = 0;
  let publications = 0;
  const persistence = {
    async createBatch(candidate) {
      const prior = saved.get(candidate.batchId);
      if (prior) {
        const same = prior.lane === candidate.lane
          && prior.requested === candidate.requested
          && prior.target === candidate.target;
        return same
          ? { ok: true, created: false, idempotent: true, batch: prior }
          : { ok: false, conflict: true, error: "batch_identity_conflict" };
      }
      actualCreates += 1;
      const created = { ...candidate, version: 0 };
      saved.set(candidate.batchId, created);
      return { ok: true, created: true, idempotent: false, batch: created };
    },
    async loadBatch(id) { return { ok: true, batch: saved.get(id) }; },
  };
  const handler = canonicalHandler({
    persistence,
    async enqueueLineMessage() { publications += 1; return { accepted: true }; },
  });
  const idempotencyKey = "launch-019ffe72-cf69-7e71";
  const payload = {
    action: "start",
    count: 13,
    lane: "sandbox",
    target: "plumbers in Tulsa",
    idempotencyKey,
  };
  const first = response();
  const retry = response();

  await handler(request("POST", "/api/admin/line", payload), first);
  await handler(request("POST", "/api/admin/line", payload), retry);

  assert.equal(first.statusCode, 202);
  assert.equal(retry.statusCode, 202);
  assert.equal(first.body.batch.batchId, retry.body.batch.batchId);
  assert.match(first.body.batch.batchId, /^line_req_[a-f0-9]{32}$/);
  assert.equal(first.body.idempotent, false);
  assert.equal(retry.body.idempotent, true);
  assert.equal(actualCreates, 1);
  assert.equal(publications, 2, "stable queue identity safely deduplicates a lost-response retry");
  assert.equal(JSON.stringify([first.body, retry.body]).includes(idempotencyKey), false);

  const conflict = response();
  await handler(request("POST", "/api/admin/line", { ...payload, count: 50 }), conflict);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error, "idempotency_conflict");
  assert.equal(actualCreates, 1);
});

test("PII-shaped client idempotency keys are rejected before persistence", async () => {
  let writes = 0;
  const handler = canonicalHandler({
    persistence: {
      async createBatch() { writes += 1; return { ok: false }; },
    },
  });
  const email = response();
  const phone = response();

  await handler(request("POST", "/api/admin/line", {
    action: "start", count: 1, lane: "sandbox", idempotencyKey: "owner@example.test",
  }), email);
  await handler(request("POST", "/api/admin/line", {
    action: "start", count: 1, lane: "sandbox", idempotencyKey: "918-555-0100",
  }), phone);

  assert.equal(email.statusCode, 400);
  assert.equal(phone.statusCode, 400);
  assert.equal(email.body.error, "invalid_idempotency_key");
  assert.equal(phone.body.error, "invalid_idempotency_key");
  assert.equal(writes, 0);
});

test("a disabled live flag blocks creation before any durable or queue write", async () => {
  let creates = 0;
  let publishes = 0;
  const handler = canonicalHandler({
    readiness: async () => readiness({ liveSendsEnabled: false }),
    persistence: {
      async createBatch() { creates += 1; return { ok: false }; },
    },
    async enqueueLineMessage() { publishes += 1; return { accepted: true }; },
  });
  const res = response();

  await handler(request("POST", "/api/admin/line", {
    action: "start",
    count: 50,
    lane: "live",
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "live_lane_disabled");
  assert.equal(creates, 0);
  assert.equal(publishes, 0);
});

test("unconfigured canonical persistence fails every mutation closed when no exact legacy batch exists", async () => {
  const originalGet = runner.getBatch;
  const originalRecover = runner.recoverBatch;
  runner.getBatch = () => null;
  runner.recoverBatch = async () => null;
  let publications = 0;
  try {
    const handler = canonicalHandler({
      persistence: {
        async createBatch() { return { ok: false, error: "persistence_not_configured" }; },
        async loadBatch() { return { ok: false, error: "persistence_not_configured" }; },
      },
      async enqueueLineMessage() { publications += 1; return { accepted: true }; },
    });
    const requests = [
      { action: "start", count: 1, lane: "sandbox" },
      { action: "start", count: 1, lane: "sandbox", batchId: "line_missing" },
      { action: "approve", batchId: "line_missing", typedBatchId: "line_missing" },
      { action: "send", batchId: "line_missing" },
    ];
    for (const payload of requests) {
      const res = response();
      await handler(request("POST", "/api/admin/line", payload), res);
      assert.equal(res.statusCode, 503, payload.action);
      assert.equal(res.body.error, "line_persistence_unavailable");
    }
  } finally {
    runner.getBatch = originalGet;
    runner.recoverBatch = originalRecover;
  }
  assert.equal(publications, 0);
});

test("an operational canonical outage never mutates even when a legacy snapshot has the same id", async () => {
  const originals = {
    getBatch: runner.getBatch,
    recoverBatch: runner.recoverBatch,
    startBatch: runner.startBatch,
    putBatch: runner.putBatch,
    sendApprovedBatch: runner.sendApprovedBatch,
  };
  const legacy = batch({
    batchId: "line_stale_legacy",
    status: "approved",
    pickState: "complete",
    approval: { actor: "legacy", typedBatchId: "line_stale_legacy", approvedRows: 1 },
    rows: [row({ rowId: "line_stale_legacy:0" })],
  });
  let mutations = 0;
  runner.getBatch = () => legacy;
  runner.recoverBatch = async () => legacy;
  runner.startBatch = async () => { mutations += 1; return { ok: true, batch: legacy }; };
  runner.putBatch = () => { mutations += 1; };
  runner.sendApprovedBatch = async () => { mutations += 1; return { ok: true }; };
  try {
    const handler = canonicalHandler({
      persistence: {
        async loadBatch() { return { ok: false, error: "read_timeout" }; },
      },
    });
    for (const payload of [
      { action: "start", count: 1, lane: "sandbox", batchId: legacy.batchId },
      { action: "approve", batchId: legacy.batchId, typedBatchId: legacy.batchId },
      { action: "send", batchId: legacy.batchId },
    ]) {
      const res = response();
      await handler(request("POST", "/api/admin/line", payload), res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, "line_persistence_unavailable");
    }
  } finally {
    Object.assign(runner, originals);
  }
  assert.equal(mutations, 0);
});

test("migration fallback mutates only an exact batch returned by the legacy registry", async () => {
  const originals = {
    getBatch: runner.getBatch,
    recoverBatch: runner.recoverBatch,
    startBatch: runner.startBatch,
    putBatch: runner.putBatch,
    sendApprovedBatch: runner.sendApprovedBatch,
  };
  let current = batch({
    batchId: "line_exact_legacy",
    status: "building",
    pickState: "complete",
    version: undefined,
    rows: [row({ rowId: "line_exact_legacy:0", status: "picked" })],
  });
  let started = 0;
  let approved = 0;
  let sent = 0;
  runner.getBatch = (id) => id === current.batchId ? current : null;
  runner.recoverBatch = async (id) => id === current.batchId ? current : null;
  runner.startBatch = async ({ batchId }) => {
    assert.equal(batchId, current.batchId);
    started += 1;
    return { ok: true, batchId, building: true, remaining: 1, batch: current };
  };
  runner.putBatch = (next) => { approved += 1; current = next; };
  runner.sendApprovedBatch = async (batchId) => {
    assert.equal(batchId, current.batchId);
    sent += 1;
    return { ok: true, sent: 1, remaining: 0 };
  };
  try {
    const handler = canonicalHandler({
      persistence: {
        async loadBatch() { return { ok: false, error: "persistence_not_configured" }; },
      },
    });
    const continued = response();
    await handler(request("POST", "/api/admin/line", {
      action: "start", count: 1, lane: "live", batchId: current.batchId,
    }), continued);
    assert.equal(continued.statusCode, 200);
    assert.equal(started, 1);

    current = batch({
      batchId: current.batchId,
      status: "awaiting_approval",
      pickState: "complete",
      version: undefined,
      rows: [row({ rowId: "line_exact_legacy:0" })],
    });
    const approval = response();
    await handler(request("POST", "/api/admin/line", {
      action: "approve", batchId: current.batchId, typedBatchId: current.batchId,
    }), approval);
    assert.equal(approval.statusCode, 200);
    assert.equal(approved, 1);

    const delivery = response();
    await handler(request("POST", "/api/admin/line", { action: "send", batchId: current.batchId }), delivery);
    assert.equal(delivery.statusCode, 200);
    assert.equal(sent, 1);
  } finally {
    Object.assign(runner, originals);
  }
});

test("canonical database outages fail closed instead of falling back to a legacy snapshot", async () => {
  const originalGet = runner.getBatch;
  const originalRecover = runner.recoverBatch;
  const legacy = batch({ batchId: "line_outage", status: "approved", approval: { actor: "legacy" } });
  runner.getBatch = () => legacy;
  runner.recoverBatch = async () => legacy;
  let statusCode;
  let body;
  try {
    const handler = canonicalHandler({
      persistence: {
        async loadBatch() { return { ok: false, error: "read_timeout" }; },
      },
    });
    const res = response();
    await handler(request("GET", `/api/admin/line?batchId=${legacy.batchId}`), res);
    statusCode = res.statusCode;
    body = res.body;
  } finally {
    runner.getBatch = originalGet;
    runner.recoverBatch = originalRecover;
  }

  assert.equal(statusCode, 503);
  assert.equal(body.error, "line_persistence_unavailable");
});

test("canonical list outages fail closed instead of returning legacy-only history", async () => {
  const originalList = runner.listBatchesDurable;
  runner.listBatchesDurable = async () => [batch({ batchId: "line_legacy_list" })];
  let statusCode;
  let body;
  try {
    const handler = canonicalHandler({
      persistence: {
        async listBatches() { return { ok: false, error: "read_timeout" }; },
      },
    });
    const res = response();
    await handler(request("GET", "/api/admin/line"), res);
    statusCode = res.statusCode;
    body = res.body;
  } finally {
    runner.listBatchesDurable = originalList;
  }

  assert.equal(statusCode, 503);
  assert.equal(body.error, "line_persistence_unavailable");
});

// ---------------------------------------------------------------------------
// HALTED-BATCH SEND DRAIN (owner email-now law, 2026-09-01). A halt is terminal
// for SOURCING only; the send action must still drain already-finished sandbox
// rows instead of answering send_blocked:batch_status_halted forever.
// ---------------------------------------------------------------------------

test("action send drains a halted sandbox batch: rows sent, batch stays halted, nothing resumes", async () => {
  process.env.GHOST_AGENCY_SEND_ON_FINISH = "1";
  try {
    const halted = batch({
      batchId: "line_halted_drain",
      status: "halted",
      haltReason: "intake_genie_compile_terminal",
      pickState: "complete",
      version: 7,
      rows: [
        row({ rowId: "line_halted_drain:0", prospectId: "drain-1", status: "queued" }),
        row({ rowId: "line_halted_drain:1", prospectId: "drain-2", status: "queued" }),
      ],
    });
    let current = halted;
    const patches = [];
    const passMessages = [];
    const publications = [];
    const handler = canonicalHandler({
      persistence: {
        async loadBatch() { return { ok: true, batch: current }; },
        async storeBatch(input) {
          patches.push({ ...input, patch: { ...(input.patch || {}) } });
          current = {
            ...current,
            ...(input.patch || {}),
            approval: (input.patch && input.patch.approval) || current.approval,
            version: (Number(input.expectedVersion) || 0) + 1,
          };
          return { ok: true, updated: true, batch: current };
        },
      },
      async enqueueLineMessage(message) {
        publications.push(message);
        return { accepted: true };
      },
      loadContinuation: () => ({
        async processLineMessage(message) {
          passMessages.push({ ...message });
          const queuedRow = (current.rows || []).find((candidate) => candidate.status === "queued");
          if (!queuedRow) return { ok: true, sent: 0, remaining: 0, complete: true };
          current = {
            ...current,
            rows: current.rows.map((candidate) => candidate === queuedRow
              ? { ...candidate, status: "sent" }
              : candidate),
          };
          const remaining = current.rows.filter((candidate) => candidate.status === "queued").length;
          return { ok: true, sent: 1, remaining, complete: remaining === 0 };
        },
      }),
    });

    const res = response();
    await handler(request("POST", "/api/admin/line", { action: "send", batchId: halted.batchId }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.haltedDrain, true);
    assert.equal(res.body.sent, 2, "every queued finished site was drained");
    assert.equal(res.body.remaining, 0);
    assert.equal(res.body.batch.status, "halted", "the batch answers as halted after the drain");
    assert.equal(passMessages.length, 2, "one send pass per queued row, nothing else");
    for (const message of passMessages) {
      assert.equal(message.phase, "send");
      assert.equal(message.batchId, halted.batchId);
    }
    assert.equal(publications.length, 0, "the drain publishes no run phases and resumes no sourcing");
    assert.equal(patches.length, 2);
    assert.equal(patches[0].expectedStatus, "halted");
    assert.equal(patches[0].patch.status, "approved");
    assert.equal(patches[0].patch.approval.actor, "sandbox_auto_send_drain");
    assert.equal(patches[0].patch.approval.approvedRows, 2);
    assert.equal(patches[0].patch.approval.typedBatchId, halted.batchId);
    const restore = patches[1];
    assert.equal(restore.expectedStatus, "approved");
    assert.equal(restore.patch.status, "halted", "the drain returns the batch to its terminal halt");
    assert.equal(restore.patch.haltReason, "intake_genie_compile_terminal");
  } finally {
    delete process.env.GHOST_AGENCY_SEND_ON_FINISH;
  }
});

test("a halted live batch is still refused — the drain is sandbox only", async () => {
  process.env.GHOST_AGENCY_SEND_ON_FINISH = "1";
  try {
    let storeCalls = 0;
    const haltedLive = batch({
      batchId: "line_halted_live",
      lane: "live",
      status: "halted",
      haltReason: "quota_source_exhausted",
      pickState: "complete",
      version: 4,
      rows: [row({ status: "queued" })],
    });
    const handler = canonicalHandler({
      readiness: async () => readiness({ liveSendsEnabled: true }),
      persistence: {
        async loadBatch() { return { ok: true, batch: haltedLive }; },
        async storeBatch() {
          storeCalls += 1;
          return { ok: true, updated: true, batch: haltedLive };
        },
      },
    });

    const res = response();
    await handler(request("POST", "/api/admin/line", { action: "send", batchId: haltedLive.batchId }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "send_blocked:halted_drain_sandbox_only");
    assert.equal(storeCalls, 0, "no approval is ever stamped onto a halted live batch");
  } finally {
    delete process.env.GHOST_AGENCY_SEND_ON_FINISH;
  }
});

test("GHOST_AGENCY_SEND_ON_FINISH=0 restores the historical halted refusal exactly", async () => {
  process.env.GHOST_AGENCY_SEND_ON_FINISH = "0";
  try {
    let storeCalls = 0;
    let passCalls = 0;
    const halted = batch({
      batchId: "line_halted_gate_off",
      status: "halted",
      haltReason: "intake_genie_compile_terminal",
      pickState: "complete",
      version: 3,
      rows: [row({ rowId: "line_halted_gate_off:0", status: "queued" })],
    });
    const handler = canonicalHandler({
      persistence: {
        async loadBatch() { return { ok: true, batch: halted }; },
        async storeBatch() {
          storeCalls += 1;
          return { ok: true, updated: true, batch: halted };
        },
      },
      loadContinuation: () => ({
        async processLineMessage() {
          passCalls += 1;
          return { ok: true, sent: 1, remaining: 0 };
        },
      }),
    });

    const res = response();
    await handler(request("POST", "/api/admin/line", { action: "send", batchId: halted.batchId }), res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "send_blocked:batch_status_halted");
    assert.equal(storeCalls, 0, "no drain approval is stamped while the switch is off");
    assert.equal(passCalls, 0, "no send pass runs while the switch is off");
  } finally {
    delete process.env.GHOST_AGENCY_SEND_ON_FINISH;
  }
});
