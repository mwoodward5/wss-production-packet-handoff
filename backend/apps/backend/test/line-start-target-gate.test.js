"use strict";

const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const {
  RECOGNIZED_START_TARGETS,
  createLineHandler,
  recognizedStartTarget,
} = require("../api/admin/line");

const priorAdminToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
process.env.GHOST_AGENCY_ADMIN_TOKEN = "start-target-gate-token";

after(() => {
  if (priorAdminToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorAdminToken;
});

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader() {},
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

function request(body) {
  return {
    method: "POST",
    url: "/api/admin/line",
    headers: { "x-admin-token": "start-target-gate-token" },
    body: JSON.stringify(body),
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

// THE SUCCESS-SHAPE CONTRACT. Every ok:true start answer must carry the batch
// it minted: accepted:true plus a real batchId/status/requested. This is the
// assertion that kills the phantom accept (ok:true with null fields, no batch).
function assertMintedSuccess(res, { requested }) {
  assert.equal(res.body.ok, true);
  assert.equal(res.body.accepted, true, "ok:true start answers must be accepted:true");
  assert.ok(res.body.batch, "ok:true start answers must carry a batch object");
  assert.equal(typeof res.body.batch.batchId, "string");
  assert.ok(res.body.batch.batchId.trim().length > 0, "batchId must be a non-empty string");
  assert.ok(res.body.batch.status, "batch.status must never be null on an accepted start");
  assert.equal(res.body.batch.requested, requested);
}

// ---------------------------------------------------------------------------
// 1. THE PHANTOM, REPRODUCED AS A REGRESSION TEST
// ---------------------------------------------------------------------------

test("the operator's exact phantom request now mints loudly or refuses loudly — never a silent ok", async () => {
  const calls = { creates: 0, enqueues: 0 };
  let stored;
  const handler = createLineHandler({
    readiness: async () => readiness(),
    persistence: {
      async createBatch(candidate) {
        calls.creates += 1;
        stored = { ...candidate, version: 0 };
        return { ok: true, created: true, batch: stored };
      },
      async loadBatch(id) {
        return stored && stored.batchId === id
          ? { ok: true, batch: stored }
          : { ok: false, error: "batch_not_found" };
      },
    },
    async enqueueLineMessage() { calls.enqueues += 1; return { accepted: true }; },
  });

  // The proven variant mints: 202 + accepted + batchId.
  const proven = response();
  await handler(request({ action: "start", count: 10, target: "all trades nationwide", lane: "sandbox" }), proven);
  assert.equal(proven.statusCode, 202);
  assertMintedSuccess(proven, { requested: 10 });

  // The loose variant is aliased onto the SAME canonical campaign target.
  const loose = response();
  await handler(request({ action: "start", count: 10, target: "all trades", lane: "sandbox" }), loose);
  assert.equal(loose.statusCode, 202);
  assertMintedSuccess(loose, { requested: 10 });
  assert.equal(loose.body.batch.target, "all trades nationwide",
    'the "all trades" alias must canonicalize to "all trades nationwide" (line-quota\'s existing table)');
});

// ---------------------------------------------------------------------------
// 2. UNRECOGNIZED TARGETS REFUSE LOUDLY, BEFORE ANY MINT
// ---------------------------------------------------------------------------

test("an unrecognized target is refused with a named reason and nothing is minted", async () => {
  const calls = { creates: 0, enqueues: 0 };
  const handler = createLineHandler({
    readiness: async () => readiness(),
    persistence: {
      async createBatch() { calls.creates += 1; return { ok: true, created: true, batch: { batchId: "must_not_mint" } }; },
    },
    async enqueueLineMessage() { calls.enqueues += 1; return { accepted: true }; },
  });

  for (const target of ["all trades nation-wide", "Tulsa plumbers", "xyzzy frobnicate market", 42]) {
    const res = response();
    await handler(request({ action: "start", count: 10, target, lane: "sandbox" }), res);
    assert.equal(res.statusCode, 400, `target ${JSON.stringify(target)} must be refused with 4xx`);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /^target_unrecognized:/, "the refusal names the rejected target");
    assert.equal(res.body.error, `target_unrecognized:${String(target).slice(0, 120)}`);
    assert.ok(Array.isArray(res.body.recognized) && res.body.recognized.length > 0,
      "the refusal teaches the recognized shapes");
    assert.ok(res.body.message.includes("Nothing ran"), "the refusal says nothing ran");
  }
  assert.equal(calls.creates, 0, "no batch may be minted for an unrecognized target");
  assert.equal(calls.enqueues, 0, "no queue message may be published for an unrecognized target");
});

test("recognizedStartTarget mirrors the source-mode resolver space", () => {
  // Recognized, canonicalized.
  assert.deepEqual(recognizedStartTarget(undefined), { ok: true, target: "" });
  assert.deepEqual(recognizedStartTarget(null), { ok: true, target: "" });
  assert.deepEqual(recognizedStartTarget(""), { ok: true, target: "" });
  assert.deepEqual(recognizedStartTarget("   "), { ok: true, target: "" });
  assert.deepEqual(recognizedStartTarget("leadminer"), { ok: true, target: "leadminer" });
  assert.deepEqual(recognizedStartTarget(" LeadMiner "), { ok: true, target: "leadminer" });
  assert.deepEqual(recognizedStartTarget("all trades"), { ok: true, target: "all trades nationwide" });
  assert.deepEqual(recognizedStartTarget("  ALL   Trades "), { ok: true, target: "all trades nationwide" });
  assert.deepEqual(recognizedStartTarget("all trades nationwide"), { ok: true, target: "all trades nationwide" });
  assert.deepEqual(recognizedStartTarget("hvac nationwide"), { ok: true, target: "hvac nationwide" });
  assert.deepEqual(recognizedStartTarget("plumbers in Tulsa"), { ok: true, target: "plumbers in Tulsa" });
  assert.deepEqual(recognizedStartTarget("fencing near Tulsa OK"), { ok: true, target: "fencing near Tulsa OK" });
  assert.deepEqual(recognizedStartTarget("roofing in Austin, TX"), { ok: true, target: "roofing in Austin, TX" });
  // The advertised examples are themselves recognized.
  for (const example of RECOGNIZED_START_TARGETS.filter((value) => value !== "(blank = use stored leads)")) {
    assert.equal(recognizedStartTarget(example).ok, true, `advertised example must be recognized: ${example}`);
  }
  // Unrecognized — none of the resolvers can serve these.
  for (const bad of ["all trades nation-wide", "Tulsa plumbers", "plumbers", "nationwide", { loose: true }, ["all trades"], 42]) {
    assert.equal(recognizedStartTarget(bad).ok, false, `must refuse: ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// 3. NO NULL-FIELD SUCCESS SHAPE, ON EVERY START OUTCOME
// ---------------------------------------------------------------------------

test("every ok:true start outcome carries a minted batch — queue accepted, direct recovery, cron recovery", async () => {
  const outcomes = [
    {
      name: "queue accepted",
      enqueue: async () => ({ accepted: true }),
      continuation: () => ({ async processLineMessage() { throw new Error("must not run"); } }),
      expectedStatus: 202,
    },
    {
      name: "queue rejected, direct recovery",
      enqueue: async () => ({ accepted: false, error: "queue_disabled" }),
      continuation: () => ({
        async processLineMessage() { return { ok: true, status: "building", processed: 1 }; },
      }),
      expectedStatus: 202,
    },
    {
      name: "queue rejected, cron recovery",
      enqueue: async () => ({ accepted: false, error: "queue_disabled" }),
      continuation: () => ({ async processLineMessage() { return new Promise(() => {}); } }),
      expectedStatus: 202,
      directStartRecoveryTimeoutMs: 5,
    },
  ];

  for (const outcome of outcomes) {
    await test(outcome.name, async () => {
      let stored;
      const handler = createLineHandler({
        readiness: async () => readiness(),
        directStartRecoveryTimeoutMs: outcome.directStartRecoveryTimeoutMs,
        persistence: {
          async createBatch(candidate) { stored = { ...candidate, version: 0 }; return { ok: true, created: true, batch: stored }; },
          async loadBatch(id) { return stored && stored.batchId === id ? { ok: true, batch: stored } : { ok: false, error: "batch_not_found" }; },
        },
        enqueueLineMessage: outcome.enqueue,
        loadContinuation: outcome.continuation,
      });
      const res = response();
      await handler(request({ action: "start", count: 10, target: "roofing in Austin", lane: "sandbox" }), res);
      assert.equal(res.statusCode, outcome.expectedStatus);
      assertMintedSuccess(res, { requested: 10 });
    });
  }
});

test("a resume start is exempt from the target gate — it names a batch, not a market", async () => {
  let creates = 0;
  const existing = {
    batchId: "line_resume_gate",
    lane: "sandbox",
    target: "Tulsa plumbers",
    requested: 4,
    status: "building",
    pickState: "pending",
    version: 3,
    rows: [],
  };
  const handler = createLineHandler({
    readiness: async () => readiness(),
    persistence: {
      async createBatch() { creates += 1; return { ok: true, created: true, batch: { batchId: "must_not_mint" } }; },
      async loadBatch(id) {
        return id === existing.batchId ? { ok: true, batch: existing } : { ok: false, error: "batch_not_found" };
      },
    },
    async enqueueLineMessage() { return { accepted: true }; },
  });
  const res = response();
  await handler(request({
    action: "start",
    batchId: existing.batchId,
    count: 4,
    target: "not even parseable",
    lane: "sandbox",
  }), res);
  assert.equal(res.statusCode, 202);
  assertMintedSuccess(res, { requested: 4 });
  assert.equal(creates, 0, "a resume never mints a new batch");
});

// ---------------------------------------------------------------------------
// 4. THE LEGACY HARNESS LANE GETS THE SAME MINT-OR-REFUSE CONTRACT
// ---------------------------------------------------------------------------

test("the legacy inline start lane refuses unrecognized targets and always returns its batch on ok", async () => {
  const pick = async () => [];
  const overrides = {
    readiness: async () => readiness(),
    pick,
    qualify: async () => ({ ok: true, reason: "" }),
    mirror: async () => ({ ok: false, previewUrl: "", reason: "stubbed" }),
    sourceFacts: async () => ({}),
    gate: async () => ({ pass: false, failed: ["stubbed"], checks: [] }),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
  };

  const refused = response();
  await createLineHandler(overrides)(request({ action: "start", count: 1, target: "Tulsa plumbers", lane: "sandbox" }), refused);
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.body.error, "target_unrecognized:Tulsa plumbers");

  const accepted = response();
  await createLineHandler(overrides)(request({ action: "start", count: 1, target: "", lane: "sandbox" }), accepted);
  assert.equal(accepted.statusCode, accepted.body.ok === true ? 200 : 400);
  if (accepted.body.ok === true) {
    assert.ok(accepted.body.batch, "legacy ok:true must still carry its batch");
    assert.ok(String(accepted.body.batch.batchId || "").trim(), "legacy batch must carry a batchId");
  } else {
    assert.ok(accepted.body.error, "a legacy refusal must name its error");
  }
});
