"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLineContinuation } = require("../lib/line-continuation");
const { processRowPhase } = require("../lib/line-runner");
const { createExplicitProspectMarker, EXPLICIT_PROSPECT_TARGET } = require("../lib/line-persistence");
const START = Date.parse("2026-09-05T01:45:00Z");

// Exercise the real continuation scheduler with an isolated durable-store
// double. Phase and miner dependencies are fake: no provider or send runs.
function fixture(rowPatch = {}, exact = false, options = {}) {
  let batch = {
    batchId: "refill-priority", lane: "sandbox", requested: 2,
    target: exact ? EXPLICIT_PROSPECT_TARGET : "roofing nationwide",
    status: "building", pickState: "pending", version: 0,
    mineFunnel: exact ? [createExplicitProspectMarker(["one", "two"])]
      : [{ stage: "quota_contract_finished_sites_v1", entered: 2, survived: 0, rejected: {} }],
    rows: [{ rowId: "row-one", batchId: "refill-priority", prospectId: "one", rowIndex: 0,
      businessName: "Example Roofing", status: "gate_passed", version: 0,
      previewUrl: "https://example.test/", gate: { pass: true, failed: [] },
      history: [{ status: "gate_passed", at: new Date(START).toISOString() }],
      ...rowPatch }],
  };
  if (options.mixed) {
    batch.rows[0].rowIndex = 2;
    batch.rows.unshift(...["picked", "qualified"].map((status, rowIndex) => ({
      rowId: `row-${status}`, batchId: batch.batchId, prospectId: status,
      rowIndex, status, version: 0, businessName: "Other Roofing",
    })));
    batch.requested = 4;
  }
  const calls = [];
  const copy = () => structuredClone(batch);
  const persistence = {
    loadBatch: async () => ({ ok: true, batch: copy() }),
    storeBatch: async ({ expectedVersion, expectedStatus, patch }) => {
      assert.equal(batch.version, expectedVersion);
      if (expectedStatus) assert.equal(batch.status, expectedStatus);
      batch = { ...batch, ...patch, version: batch.version + 1 };
      return { ok: true, updated: true, batch: copy() };
    },
    claimRows: async ({ statuses }) => {
      const rows = batch.rows.filter((row) => statuses.includes(row.status)
        && !(row.leaseToken && Date.parse(row.leaseExpiresAt) > START));
      for (const row of rows) { row.version++; row.leaseToken = "test-lease"; }
      return { ok: true, rows: structuredClone(rows) };
    },
    checkpointRow: async ({ rowId, expectedVersion, expectedStatus, row }) => {
      const current = batch.rows.find((item) => item.rowId === rowId);
      assert.equal(current.version, expectedVersion);
      assert.equal(current.status, expectedStatus);
      Object.assign(current, row, { version: current.version + 1, leaseToken: null });
      return { ok: true, row: structuredClone(current) };
    },
    storeRows: async () => ({ ok: true, created: 0, rows: structuredClone(batch.rows) }),
  };
  const service = createLineContinuation({
    persistence, clock: () => START, now: () => new Date(START).toISOString(),
    rowFanout: false, inlinePickQualification: false,
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    enqueueLineMessage: async () => ({ accepted: true }),
    recordEvent: async () => ({ ok: true }),
    pick: async () => { calls.push("mine"); return []; },
    processRowPhase: async (row, context) => {
      calls.push(row.status);
      if (options.realPhase) return processRowPhase(row, context, {
        env: { GHOST_AGENCY_HERO_AUTOLINE: "0", GHOST_AGENCY_SEND_ON_FINISH: "1" },
        now: () => new Date(START).toISOString(),
        ensureHeroAutoline: async () => ({ ok: true }),
        writePreviewUrl: async () => ({ ok: true }),
        queueEmail: async () => ({ ok: true }),
        sendOnFinish: async () => {
          calls.push("fake-owner-send");
          return { ok: options.sendRefused !== true };
        },
      });
      return { ok: true, row: { ...row, status: "queued" } };
    },
  });
  return { calls, batch: copy, run: () => service.processLineMessage({ batchId: batch.batchId, phase: "run", sequence: 0 }) };
}

test("due completed gate drains before replacement mining", async () => {
  const h = fixture();
  await h.run();
  assert.deepEqual(h.calls, ["gate_passed"]);
  assert.equal(h.batch().rows[0].status, "queued");
  assert.equal(h.batch().pickState, "pending", "remaining quota still requests replacements");
});

test("future gate backoff does not starve replacement mining", async () => {
  const h = fixture({ buildRetryAfter: new Date(START + 60_000).toISOString() });
  await h.run();
  assert.deepEqual(h.calls, ["mine"]);
});

test("another worker's gate lease does not starve replacement mining", async () => {
  const h = fixture({ leaseToken: "other", leaseExpiresAt: new Date(START + 60_000).toISOString() });
  await h.run();
  assert.deepEqual(h.calls, ["mine"]);
});

test("incomplete exact prospect selection retains priority over gate drain", async () => {
  const h = fixture({}, true);
  await h.run();
  assert.deepEqual(h.calls, ["mine"]);
});

test("completed gate outranks earlier picked and browser-heavy rows", async () => {
  const h = fixture({}, false, { mixed: true });
  await h.run();
  assert.deepEqual(h.calls, ["gate_passed"]);
  assert.deepEqual(h.batch().rows.map((row) => row.status), ["picked", "qualified", "queued"]);
});

test("real gate phase reaches sent before quota refill using existing owner sender", async () => {
  const h = fixture({}, false, { realPhase: true });
  await h.run();
  assert.deepEqual(h.calls, ["gate_passed", "fake-owner-send"]);
  assert.equal(h.batch().rows[0].status, "sent");
  assert.equal(h.batch().pickState, "pending");
});

test("refused owner send remains queued and does not spin instead of refilling", async () => {
  const h = fixture({}, false, { realPhase: true, sendRefused: true });
  await h.run();
  assert.equal(h.batch().rows[0].status, "queued");
  await h.run();
  assert.deepEqual(h.calls, ["gate_passed", "fake-owner-send", "mine"]);
  assert.equal(h.batch().rows[0].status, "queued", "refusal is not relabeled as delivered");
});
