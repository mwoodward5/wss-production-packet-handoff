"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "packet2-source-clients-"));

const { mirror, signEvidence } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { chooseBrandMark } = require("../lib/mirror-engine/logo-ladder");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

function receipt(hex = "a") {
  const snapshot_sha256 = hex.repeat(64);
  return {
    contract: "pagehub-build-packet",
    packet_id: `pagehub:${snapshot_sha256.slice(0, 24)}`,
    snapshot_sha256,
  };
}

function request(sourcePacket = receipt()) {
  return {
    slug: "wss-test-pagehub-source-packet",
    donor: "mirror-donor",
    facts: {
      business_name: "Packet Receipt Roofing",
      industry: "roofing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
    },
    brand: {
      mark: chooseBrandMark({
        logoCandidates: [],
        businessName: "Packet Receipt Roofing",
        accent: "#C8102E",
      }),
      source_packet: sourcePacket,
    },
  };
}

test("source_packet is a strict three-field receipt and cannot carry packet data or secrets", () => {
  assert.equal(checkMirrorRequest(request()).ok, true);

  for (const sourcePacket of [
    { ...receipt(), snapshot: { phone: "+15555550199" } },
    { ...receipt(), secret: "must-not-cross-the-render-seam" },
    { ...receipt(), contract: "other-packet" },
    { ...receipt(), packet_id: "pagehub:not-a-digest" },
    { ...receipt(), snapshot_sha256: "A".repeat(64) },
  ]) {
    const checked = checkMirrorRequest(request(sourcePacket));
    assert.equal(checked.ok, false, JSON.stringify(sourcePacket));
  }
});

test("signed engine evidence names the exact Packet2 snapshot and contains no packet body", async () => {
  const firstReceipt = receipt("a");
  const first = await mirror(request(firstReceipt), { dryRun: true, registry: createRegistry() });
  const changed = await mirror(request(receipt("b")), { dryRun: true, registry: createRegistry() });

  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(first.body.checks.brand.source_packet, firstReceipt);
  assert.deepEqual(Object.keys(first.body.checks.brand.source_packet).sort(), [
    "contract", "packet_id", "snapshot_sha256",
  ]);
  assert.equal(signEvidence(first.body), first.body.evidence_sha, "the receipt is inside signed release evidence");
  assert.equal(JSON.stringify(first.body).includes("must-not-cross-the-render-seam"), false);
  assert.equal(JSON.stringify(first.body).includes("snapshot\":"), false, "the Packet2 body never enters release evidence");
  assert.notEqual(first.body.build_hash, changed.body.build_hash, "a different Packet2 snapshot is a different build");
});
