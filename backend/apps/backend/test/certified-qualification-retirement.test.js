"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createContentCertification } = require("../lib/intake-genie-client");
const { processRowPhase } = require("../lib/line-runner");

const KEY = "qualification-retirement-test-key";
const SOURCE = "https://acme-plumbing.example/services";
const ID = "acme-1";
const IDEMPOTENCY = `ghost:${ID}:line-genie-certified-v7`;
const SHA = "a".repeat(64);
const certifiedAt = "2026-09-28T20:00:00.000Z";

function persistedPacket2() {
  const files = {
    "content/home.md": "# Acme Plumbing\n\nSource-backed plumbing service in Reno.",
    "content/services/drain-cleaning.md": "# Drain Cleaning\n\nDrain cleaning service in Reno.",
  };
  const packet = {
    ok: true, version: "intake-genie-v2", status: "compiled",
    scope: { supported: true, category: "plumbing" },
    job_id: "pagehub:" + SHA.slice(0, 24), request_id: IDEMPOTENCY,
    packet2_hash: SHA,
    transport_receipt: { version: "owner-packet2-import-v1", snapshot_sha256: SHA, packet2_hash: SHA },
    facts: { name: "Acme Plumbing", city: "Reno", state: "NV", category: "plumbing",
      services_source: "source_observation", services: ["Drain Cleaning"] },
    evidence: [{ field: "services", value: "Drain Cleaning", source_url: SOURCE,
      source_observations: [SOURCE], provenance: "observed", verification_status: "source_observation" }],
    packet2: { sources: { observations: [{ source: SOURCE, extracted: { exactServices: "Drain Cleaning" } }] } },
    content: { content_contract: {
      schema: "CertifiedPracticePacket/v1", kind: "certified_practice_packet", version: 1,
      facts: { category: "plumbing" }, assets: {}, builder_instructions: { public: false },
      visitor_copy: { kind: "visitor_copy", files,
        file_hashes: Object.fromEntries(Object.entries(files).map(([name, body]) => [name, createHash("sha256").update(body).digest("hex")])),
        safety: { pass: true, violations: [] } },
    } },
  };
  const prospect = { prospect_id: ID, business_name: "Acme Plumbing", city: "Reno", state: "NV",
    place_id: "ChIJ-acme", website: "https://acme-plumbing.example", industry: "plumbing" };
  const receipt = createContentCertification(packet, prospect, {
    signingKey: KEY, packetLocation: "prospect_record:genie_canonical_packet",
    requestId: IDEMPOTENCY, jobId: packet.job_id, idempotencyKey: IDEMPOTENCY,
    requestSources: { website_url: SOURCE }, certifiedAt,
  });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  return { ...prospect, record: {
    ...prospect, genie_canonical_packet: packet,
    genie_compile_sources: { website_url: SOURCE }, genie_compile_idempotency_key: IDEMPOTENCY,
    genie_content_certification_contract: {
      version: "ghost-line-genie-receipt-v7", pipeline_version: "line-genie-certified-v7",
      idempotency_key_sha256: createHash("sha256").update(IDEMPOTENCY).digest("hex"),
    },
    genie_content_certification: receipt.receipt,
  } };
}

const picked = { prospectId: ID, businessName: "Acme Plumbing", status: "picked",
  genieContentCertified: true, history: [] };
const context = { lane: "sandbox", batchId: "line-test" };
function dependencies(record, overrides = {}) {
  let qualified = 0;
  const deps = {
    env: { INTAKE_GENIE_CERTIFICATION_KEY: KEY },
    now: () => "2026-09-28T20:05:00.000Z",
    nowMs: () => Date.parse("2026-09-28T20:05:00.000Z"),
    selectRows: async () => ({ rows: record ? [record] : [] }),
    qualify: () => { qualified += 1; return { ok: false, reason: "website_score" }; },
    ...overrides,
  };
  return { deps, calls: () => qualified };
}

test("signed, persisted Packet2 retires only the duplicate broad qualifier", async () => {
  const fixture = persistedPacket2();
  const { deps, calls } = dependencies(fixture);
  const result = await processRowPhase(picked, context, deps);
  assert.equal(result.row.status, "qualified");
  assert.equal(result.phase, "qualify");
  assert.equal(calls(), 0);
});

test("boolean alone, missing record, tampered packet and wrong business keep the qualifier", async () => {
  const fixture = persistedPacket2();
  for (const record of [null,
    { ...fixture, record: { ...fixture.record, genie_canonical_packet: { ...fixture.record.genie_canonical_packet, packet2_hash: "b".repeat(64) } } },
    { ...fixture, prospect_id: "other-id" },
  ]) {
    const { deps, calls } = dependencies(record);
    const result = await processRowPhase(picked, context, deps);
    assert.equal(result.row.status, "rejected");
    assert.equal(calls(), 1);
  }
  const { deps, calls } = dependencies(fixture);
  const result = await processRowPhase({ ...picked, genieContentCertified: false }, context, deps);
  assert.equal(result.row.status, "rejected");
  assert.equal(calls(), 1);
});

test("a certified Packet2 cannot override an existing row contract refusal", async () => {
  const { deps, calls } = dependencies(persistedPacket2());
  const result = await processRowPhase({ ...picked, contractIssue: "source_contract_incomplete" }, context, deps);
  assert.equal(result.row.status, "rejected");
  assert.equal(result.row.reason, "source_contract_incomplete");
  assert.equal(calls(), 0);
});

test("a stale receipt, missing key or unavailable read cannot bypass qualification", async () => {
  const fixture = persistedPacket2();
  for (const overrides of [
    { env: {} },
    { nowMs: () => Date.parse("2026-11-28T20:05:00.000Z") },
    { selectRows: async () => { throw new Error("read unavailable"); } },
  ]) {
    const { deps, calls } = dependencies(fixture, overrides);
    const result = await processRowPhase(picked, context, deps);
    assert.equal(result.row.status, "rejected");
    assert.equal(calls(), 1);
  }
});
