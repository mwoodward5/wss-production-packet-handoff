"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canonicalJson,
  pageHubBuildSupplement,
  packetSha256,
  stagePageHubBuildPacket,
} = require("../lib/pagehub-build-packet");

const RECEIVED_AT = new Date("2026-08-22T12:00:00.000Z");

function packet() {
  return {
    version: "intake-genie-v2",
    facts: {
      name: "Packet Name Must Not Replace LeadMiner Name",
      phone: "555-999-9999",
      website: "https://acme.example/",
    },
    assets: [{
      kind: "logo",
      url: "https://acme.example/assets/logo.png",
      observed_on: "https://acme.example/",
      surprise_vendor_field: { untouched: [true, 7, null] },
    }],
    unknown_future_contract: {
      nested: { beta: 2, alpha: 1 },
      ordered: ["keep", "this", "order"],
    },
  };
}

test("canonical SHA is stable across object key order while array order remains meaningful", () => {
  const left = { z: 1, a: { y: 2, x: 3 }, list: [2, 1] };
  const right = { list: [2, 1], a: { x: 3, y: 2 }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(packetSha256(left), packetSha256(right));
  assert.notEqual(packetSha256(left), packetSha256({ ...right, list: [1, 2] }));
});

test("staging preserves every unknown packet field and marks all asset observations unverified", () => {
  const original = packet();
  const leadMinerRecord = {
    truth_packet_source: "leadminer_mirror_ready",
    leadminer_truth_packet: {
      mirror_ready: { name: "Verified Acme", phone: "555-111-2222", reviews: { count: 214, rating: 4.8 } },
    },
    trust: { source: "google_business_profile", verified: true },
  };
  const out = stagePageHubBuildPacket(leadMinerRecord, original, RECEIVED_AT);

  assert.equal(out.status, "staged");
  assert.deepEqual(out.sidecar.snapshot, original, "the full Packet2 JSON survives without a field allowlist");
  assert.deepEqual(out.record.leadminer_truth_packet, leadMinerRecord.leadminer_truth_packet);
  assert.deepEqual(out.record.trust, leadMinerRecord.trust);
  assert.equal(out.record.truth_packet_source, "leadminer_mirror_ready");
  assert.equal(out.sidecar.asset_candidates.length, 1);
  assert.deepEqual(out.sidecar.asset_candidates[0], {
    kind: "logo",
    url: "https://acme.example/assets/logo.png",
    observed_on: "https://acme.example/",
    packet_path: "assets",
    source: "pagehub_packet_observation",
    verification_status: "unverified_observed_candidate",
    ownership_verified: false,
    approved: false,
  });
});

test("the same packet is a no-op and a new hash atomically refreshes the active immutable snapshot", () => {
  const first = stagePageHubBuildPacket({ kept: true }, packet(), RECEIVED_AT);
  const reordered = {
    unknown_future_contract: packet().unknown_future_contract,
    assets: packet().assets,
    facts: packet().facts,
    version: "intake-genie-v2",
  };
  const retry = stagePageHubBuildPacket(first.record, reordered, new Date("2026-08-22T13:00:00.000Z"));
  assert.equal(retry.status, "noop");
  assert.strictEqual(retry.record, first.record);
  assert.equal(retry.sidecar.received_at, "2026-08-22T12:00:00.000Z");

  const changed = stagePageHubBuildPacket(first.record, { ...packet(), new_value: true }, RECEIVED_AT);
  assert.equal(changed.status, "staged");
  assert.equal(changed.refreshed, true);
  assert.notEqual(changed.sidecar.snapshot_sha256, first.sidecar.snapshot_sha256);
  assert.equal(changed.sidecar.supersedes.snapshot_sha256, first.sidecar.snapshot_sha256);
  assert.equal(changed.sidecar.snapshot.new_value, true);
  assert.deepEqual(changed.record.kept, true);
});

test("a stored hash cannot hide a modified or missing immutable snapshot", () => {
  const first = stagePageHubBuildPacket({}, packet(), RECEIVED_AT);
  const tampered = structuredClone(first.record);
  tampered.pagehub_build_packet.snapshot.facts.phone = "555-000-0000";
  const result = stagePageHubBuildPacket(tampered, packet(), RECEIVED_AT);
  assert.equal(result.status, "conflict");
  assert.equal(result.error, "pagehub_build_packet_invalid_existing_sidecar");
});

for (const suffix of ["co.uk", "co.kr", "com.ar"]) {
test(`multi-label public suffix ${suffix} never makes unrelated businesses the same owner`, () => {
  const staged = stagePageHubBuildPacket({}, {
    facts: {
      website: `https://victim.${suffix}/`,
      services: ["Invented Competitor Service"],
    },
    assets: [{
      kind: "photo",
      url: `https://competitor.${suffix}/gallery/work.jpg`,
      observed_on: `https://competitor.${suffix}/gallery/`,
    }],
    evidence: [{
      field: "services",
      value: ["Invented Competitor Service"],
      source: `https://competitor.${suffix}/services/`,
      verification_status: "source_observation",
      confidence: 1,
    }],
  }, RECEIVED_AT);

  const supplement = pageHubBuildSupplement(staged.record, { website: `https://victim.${suffix}/` });
  assert.equal(supplement.ok, true);
  assert.deepEqual(supplement.asset_candidates, []);
  assert.deepEqual(supplement.services, []);
});
}

test("source-less brand fields cannot borrow packet-level website provenance", () => {
  const staged = stagePageHubBuildPacket({}, {
    facts: { website: "https://victim.example/" },
    sources: { urls: ["https://victim.example/"] },
    brand: {
      fonts: {
        display: "Invented Display",
        body: "Invented Body",
        href: "https://fonts.googleapis.com/css2?family=Roboto",
      },
      palette: [{ hex: "#FF3300", role: "accent" }],
    },
  }, RECEIVED_AT);

  const supplement = pageHubBuildSupplement(staged.record, { website: "https://victim.example/" });
  assert.deepEqual(supplement.brand, {});
});
