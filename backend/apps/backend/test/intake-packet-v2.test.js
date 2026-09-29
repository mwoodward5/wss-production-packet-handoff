"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createIntakePacketV2Handler } = require("../api/admin/intake-packet-v2");

const NOW = new Date("2026-08-22T12:00:00.000Z");
const UPDATED_AT = "2026-08-22T11:59:00.000Z";

function packet() {
  return {
    version: "intake-genie-v2",
    facts: { name: "Unverified Override", phone: "555-999-9999", city: "Wrong City" },
    assets: [{ kind: "photo", url: "https://verified-acme.example/job.jpg" }],
    unknown: { remains: [1, { two: true }] },
  };
}

function prospectRow(record = {}) {
  return {
    id: 71,
    prospect_id: "place_exact_123",
    business_name: "Verified Acme Plumbing",
    phone: "555-111-2222",
    city: "Albuquerque",
    state: "NM",
    status: "held",
    source: "leadminer",
    owner_email: "owner@example.test",
    updated_at: UPDATED_AT,
    record: {
      truth_packet_source: "leadminer_mirror_ready",
      leadminer_truth_packet: { mirror_ready: { name: "Verified Acme Plumbing", phone: "555-111-2222" } },
      trust: { verified: true, review_count: 212 },
      ...record,
    },
  };
}

function responseHarness() {
  const captured = { status: 0, body: null };
  return {
    captured,
    statusCode: 200,
    setHeader() {},
    end(value) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(String(value));
    },
  };
}

function harness({ row = prospectRow(), conditionalResult, requireAdmin } = {}) {
  const reads = [];
  const writes = [];
  const effects = { builds: 0, sends: 0, queues: 0 };
  const handler = createIntakePacketV2Handler({
    requireAdmin: requireAdmin || (() => true),
    select: async (...args) => {
      reads.push(args);
      return { ok: true, data: row ? [row] : [] };
    },
    conditionalUpdate: async (...args) => {
      writes.push(args);
      return conditionalResult || { ok: true, updated: true, rows: [{ prospect_id: "place_exact_123" }] };
    },
    now: () => new Date(NOW),
    // If staging ever starts consuming any operational dependency, these
    // tripwires make the zero-build/zero-send contract fail immediately.
    build: async () => { effects.builds += 1; throw new Error("build_forbidden"); },
    send: async () => { effects.sends += 1; throw new Error("send_forbidden"); },
    enqueue: async () => { effects.queues += 1; throw new Error("queue_forbidden"); },
  });
  return { handler, reads, writes, effects };
}

async function invoke(subject, body = { prospect_id: "place_exact_123", packet: packet() }) {
  const res = responseHarness();
  await subject.handler({ method: "POST", headers: {}, body }, res);
  return res.captured;
}

test("admin auth runs before prospect storage", async () => {
  let selected = false;
  const handler = createIntakePacketV2Handler({
    requireAdmin(_req, res) {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return false;
    },
    select: async () => { selected = true; return { ok: true, data: [] }; },
  });
  const res = responseHarness();
  await handler({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.captured.status, 401);
  assert.equal(selected, false);
});

test("missing exact prospect fails closed without creating, building, queuing, or sending", async () => {
  const subject = harness({ row: null });
  const result = await invoke(subject);
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "prospect_not_found");
  assert.equal(subject.writes.length, 0);
  assert.deepEqual(subject.effects, { builds: 0, sends: 0, queues: 0 });
});

test("a store response for any other prospect id is refused", async () => {
  const subject = harness({ row: { ...prospectRow(), prospect_id: "different_prospect" } });
  const result = await invoke(subject);
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "prospect_not_found");
  assert.equal(subject.writes.length, 0);
});

test("staging changes only record and updated_at while preserving LeadMiner NAP and trust", async () => {
  const row = prospectRow();
  const subject = harness({ row });
  const result = await invoke(subject);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "staged");
  assert.equal(subject.reads[0][1], "?select=*&prospect_id=eq.place_exact_123&limit=1");
  assert.equal(subject.writes.length, 1);

  const [table, idColumn, idValue, guards, patch] = subject.writes[0];
  assert.equal(table, "ghost_agency_prospects");
  assert.equal(idColumn, "prospect_id");
  assert.equal(idValue, "place_exact_123");
  assert.deepEqual(guards, { updated_at: `eq.${UPDATED_AT}` });
  assert.deepEqual(Object.keys(patch).sort(), ["record", "updated_at"]);
  assert.deepEqual(patch.record.leadminer_truth_packet, row.record.leadminer_truth_packet);
  assert.deepEqual(patch.record.trust, row.record.trust);
  assert.equal(patch.record.truth_packet_source, "leadminer_mirror_ready");
  assert.equal(patch.record.pagehub_build_packet.snapshot.facts.phone, "555-999-9999");
  assert.equal(patch.record.pagehub_build_packet.asset_candidates[0].approved, false);
  assert.deepEqual(subject.effects, { builds: 0, sends: 0, queues: 0 });

  // No caller-provided NAP/status field is written to a top-level column.
  for (const protectedColumn of ["business_name", "phone", "city", "state", "status", "source", "owner_email"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(patch, protectedColumn), false, protectedColumn);
  }
});

test("an identical retry returns noop and performs no write or operational effect", async () => {
  const first = harness();
  await invoke(first);
  const storedRecord = first.writes[0][4].record;
  const retry = harness({ row: prospectRow(storedRecord) });
  const result = await invoke(retry, {
    prospect_id: "place_exact_123",
    packet: { unknown: packet().unknown, assets: packet().assets, facts: packet().facts, version: "intake-genie-v2" },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "noop");
  assert.equal(retry.writes.length, 0);
  assert.deepEqual(retry.effects, { builds: 0, sends: 0, queues: 0 });
});

test("a new Packet2 hash refreshes only the sidecar and records the superseded hash", async () => {
  const first = harness();
  await invoke(first);
  const storedRecord = first.writes[0][4].record;
  const changed = harness({ row: prospectRow(storedRecord) });
  const result = await invoke(changed, {
    prospect_id: "place_exact_123",
    packet: { ...packet(), changed: true },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "staged");
  assert.equal(result.body.refreshed, true);
  assert.equal(result.body.superseded_sha256, storedRecord.pagehub_build_packet.snapshot_sha256);
  assert.equal(changed.writes.length, 1);
  assert.deepEqual(changed.writes[0][4].record.leadminer_truth_packet, storedRecord.leadminer_truth_packet);
  assert.deepEqual(changed.effects, { builds: 0, sends: 0, queues: 0 });
});
