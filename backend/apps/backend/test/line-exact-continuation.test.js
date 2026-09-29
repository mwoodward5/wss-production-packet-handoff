"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createLineContinuation, exactPickErrorRetryable } = require("../lib/line-continuation");
const { createExplicitProspectMarker, readExplicitProspectMarker } = require("../lib/line-persistence");

const NOW = "2026-08-22T12:00:00.000Z";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class ExactPersistence {
  constructor(batch, rows = []) {
    this.batch = { version: 0, rows: [], ...clone(batch) };
    this.rows = rows.map(clone);
    this.failStoreRowsOnce = false;
  }

  snapshot() {
    return { ...clone(this.batch), rows: this.rows.map(clone) };
  }

  async loadBatch(batchId) {
    return batchId === this.batch.batchId
      ? { ok: true, batch: this.snapshot() }
      : { ok: false, error: "batch_not_found" };
  }

  async storeBatch({ batchId, expectedVersion, expectedStatus, patch }) {
    if (batchId !== this.batch.batchId || expectedVersion !== this.batch.version
      || (expectedStatus && expectedStatus !== this.batch.status)) {
      return { ok: false, conflict: true, error: "batch_version_conflict" };
    }
    this.batch = { ...this.batch, ...clone(patch), version: this.batch.version + 1, updatedAt: NOW };
    return { ok: true, updated: true, batch: this.snapshot() };
  }

  async storeRows({ batchId, rows }) {
    assert.equal(batchId, this.batch.batchId);
    const incoming = rows.map(clone);
    const toStore = this.failStoreRowsOnce ? incoming.slice(0, 1) : incoming;
    this.failStoreRowsOnce = false;
    for (const row of toStore) {
      const materialized = { ...row, rowId: row.rowId || `${batchId}:${row.rowIndex}` };
      if (this.rows.some((current) => current.rowId === materialized.rowId)) continue;
      this.rows.push({ ...materialized, version: 0, updatedAt: NOW });
    }
    this.rows.sort((left, right) => left.rowIndex - right.rowIndex);
    if (toStore.length !== incoming.length) return { ok: false, error: "partial_checkpoint" };
    return { ok: true, created: toStore.length, rows: this.rows.map(clone) };
  }
}

function exactBatch(ids, overrides = {}) {
  return {
    batchId: overrides.batchId || "batch-exact",
    lane: "sandbox",
    target: "owner-selected-packets",
    requested: ids.length,
    status: "building",
    pickState: "pending",
    mineFunnel: [createExplicitProspectMarker(ids)],
    startedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function picked(id) {
  return {
    prospectId: id,
    businessName: `${id} Plumbing`,
    city: "Tulsa",
    state: "OK",
    vertical: "plumbing",
    contactReady: false,
    email: "",
  };
}

function serviceFor(persistence, pick) {
  return createLineContinuation({
    persistence,
    pick,
    clock: () => Date.parse(NOW),
    now: () => NOW,
    workerId: () => "exact-worker",
    pickTimeoutMs: 1_000,
    inlinePickQualification: false,
    async enqueueLineMessage() { return { accepted: false }; },
  });
}

test("missing or corrupt exact marker halts before pick instead of falling back to mining", async (t) => {
  for (const fixture of [
    { name: "missing", funnel: [] },
    {
      name: "corrupt",
      funnel: (() => {
        const marker = createExplicitProspectMarker(["place_one"]);
        marker.selection_sha256 = "0".repeat(64);
        return [marker];
      })(),
    },
  ]) {
    await t.test(fixture.name, async () => {
      const persistence = new ExactPersistence(exactBatch(["place_one"], { mineFunnel: fixture.funnel }));
      let picks = 0;
      const service = serviceFor(persistence, async () => { picks += 1; return [picked("place_one")]; });
      const result = await service.processLineMessage({ batchId: "batch-exact", phase: "run", sequence: 0 });
      assert.equal(picks, 0);
      assert.equal(result.status, "halted");
      assert.equal(persistence.batch.status, "halted");
      assert.match(persistence.batch.haltReason, /^explicit_prospect_marker_/);
    });
  }
});

test("partial exact checkpoint preserves marker and resumes only the missing ordered IDs", async () => {
  const ids = ["place_one", "place_two"];
  const persistence = new ExactPersistence(exactBatch(ids));
  persistence.failStoreRowsOnce = true;
  const calls = [];
  const service = serviceFor(persistence, async ({ prospectIds, count }) => {
    calls.push({ prospectIds: [...prospectIds], count });
    return prospectIds.map(picked);
  });

  const first = await service.processLineMessage({ batchId: "batch-exact", phase: "run", sequence: 0 });
  assert.equal(first.error, "pick_checkpoint_failed");
  assert.equal(persistence.batch.status, "building");
  assert.equal(persistence.batch.pickState, "pending");
  assert.deepEqual(persistence.rows.map((row) => row.prospectId), ["place_one"]);
  assert.deepEqual(readExplicitProspectMarker(persistence.batch.mineFunnel, { requested: 2 }).ids, ids);

  const second = await service.processLineMessage({ batchId: "batch-exact", phase: "run", sequence: persistence.batch.version });
  assert.equal(second.selected, 1);
  assert.deepEqual(calls, [
    { prospectIds: ids, count: 2 },
    { prospectIds: ["place_two"], count: 1 },
  ]);
  assert.deepEqual(persistence.rows.map((row) => row.prospectId), ids);
  assert.equal(persistence.batch.pickState, "complete");
  assert.deepEqual(readExplicitProspectMarker(persistence.batch.mineFunnel, { requested: 2 }).ids, ids);
});

test("recovered exact rows must be the requested ordered prefix", async () => {
  const ids = ["place_one", "place_two"];
  const persistence = new ExactPersistence(exactBatch(ids), [{
    ...picked("place_two"),
    rowId: "batch-exact:0",
    batchId: "batch-exact",
    rowIndex: 0,
    status: "picked",
  }]);
  let picks = 0;
  const service = serviceFor(persistence, async () => { picks += 1; return []; });
  const result = await service.processLineMessage({ batchId: "batch-exact", phase: "run", sequence: 0 });
  assert.equal(picks, 0);
  assert.equal(result.status, "halted");
  assert.equal(persistence.batch.haltReason, "explicit_prospect_rows_mismatch");
});

test("exact pick classifies transient store and timeout failures as retryable", () => {
  for (const error of [
    { code: "explicit_prospect_store_read_failed" },
    { code: "vertical_hold_persist_failed" },
    { code: "line_phase_timeout" },
    { code: "ECONNRESET", message: "socket hang up" },
    { name: "AbortError" },
  ]) assert.equal(exactPickErrorRetryable(error), true, JSON.stringify(error));

  for (const code of [
    "explicit_prospect_ids_invalid",
    "explicit_prospect_store_identity_mismatch",
    "explicit_prospect_ids_not_found",
    "explicit_prospect_already_attempted",
    "explicit_prospect_ids_ineligible",
  ]) assert.equal(exactPickErrorRetryable({ code }), false, code);
});

test("transient exact read failure preserves the marker and retries only the same IDs", async () => {
  const ids = ["place_one", "place_two"];
  const persistence = new ExactPersistence(exactBatch(ids));
  const calls = [];
  const service = serviceFor(persistence, async ({ prospectIds }) => {
    calls.push([...prospectIds]);
    if (calls.length === 1) {
      throw Object.assign(new Error("temporary read failure"), { code: "explicit_prospect_store_read_failed" });
    }
    return prospectIds.map(picked);
  });

  const first = await service.processLineMessage({ batchId: "batch-exact", phase: "run", sequence: 0 });
  assert.equal(first.error, "explicit_prospect_pick_retryable");
  assert.equal(first.retryable, true);
  assert.equal(persistence.batch.status, "building");
  assert.equal(persistence.batch.pickState, "pending");
  assert.equal(persistence.batch.haltReason, undefined);
  assert.deepEqual(readExplicitProspectMarker(persistence.batch.mineFunnel, { requested: 2 }).ids, ids);

  const second = await service.processLineMessage({
    batchId: "batch-exact",
    phase: "run",
    sequence: persistence.batch.version,
  });
  assert.equal(second.selected, 2);
  assert.deepEqual(calls, [ids, ids]);
  assert.deepEqual(persistence.rows.map((row) => row.prospectId), ids);
});

test("deterministic exact ineligibility remains terminal", async () => {
  const persistence = new ExactPersistence(exactBatch(["place_one"]));
  const service = serviceFor(persistence, async () => {
    throw Object.assign(new Error("not eligible"), { code: "explicit_prospect_ids_ineligible" });
  });
  const result = await service.processLineMessage({ batchId: "batch-exact", phase: "run", sequence: 0 });
  assert.equal(result.error, "explicit_prospect_pick_failed");
  assert.equal(result.retryable, false);
  assert.equal(persistence.batch.status, "halted");
  assert.equal(persistence.batch.haltReason, "explicit_prospect_ids_ineligible");
});
