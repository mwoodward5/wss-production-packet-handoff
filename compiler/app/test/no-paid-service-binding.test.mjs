import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { compileLocalFirstPartyNoPaid, verifySourcePacketEnvelope } from "../lib/intake-genie-no-paid-overlay.mjs";

const proofDir = process.env.WSS_NO_PAID_PROOF_DIR;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

for (const [name, minimumFiles] of [["custom-lawn", 7], ["okie-concrete", 2]]) {
  test(`real ${name} source envelope binds verbatim services to matching page`, { skip: !proofDir }, async () => {
    const artifact = JSON.parse(readFileSync(join(proofDir, `${name}-source-envelope-proof.json`), "utf8"));
    const verified = await verifySourcePacketEnvelope({ envelope: artifact.sourcePacketEnvelope,
      rawInput: artifact.request, input: artifact.request });
    const packet = await compileLocalFirstPartyNoPaid(artifact.request, { verifySourcePacketEnvelope });
    assert.equal(packet.ok, true);
    assert.equal(packet.facts.services_source, "source_bound");
    const visitor = packet.content.content_contract.visitor_copy;
    const files = Object.keys(visitor.files).filter((path) => path.startsWith("content/services/"));
    assert.ok(files.length >= minimumFiles);
    for (const path of files) assert.equal(visitor.file_hashes[path], sha(visitor.files[path]));
    const sourcePages = new Map(verified.packet.content.pages.map((page) => [page.url, page]));
    for (const observation of verified.discovery.found.service_observations) {
      const page = sourcePages.get(observation.source_url);
      assert.ok(page);
      assert.ok(page.text.includes(observation.description_excerpt));
      assert.ok(page.text.includes(observation.name_excerpt) || page.title.includes(observation.name_excerpt));
      const sourceService = verified.packet.content.services.find((service) => service.name === observation.name);
      if (sourceService.description.length > 700) {
        assert.match(observation.description, /[.!?]$/u,
          `source-bound copy for ${observation.name} must end at a complete sentence`);
        assert.equal(sourceService.description.startsWith(observation.description), true);
      }
    }
    const depth = packet.facts.discovery.found.depth_channels || {};
    if (name === "custom-lawn") {
      assert.equal(depth.reviews.length, 6);
      assert.equal(depth.faqs.length, 12);
    } else {
      assert.equal(verified.packet.facts.email, "contact@mysite.com");
      assert.equal(verified.discovery.facts.email, "");
      assert.equal(verified.discovery.found.contact.email, "");
      assert.equal(packet.facts.email, "");
      assert.equal(packet.facts.discovery.facts.email, "");
      assert.equal(packet.facts.discovery.found.contact.email, "");
    }
    assert.equal(depth.hours, undefined);
    assert.equal(depth.areas, undefined);
    for (const entries of Object.values(depth)) for (const entry of entries) {
      const html = Buffer.from(artifact.sourcePacketEnvelope.snapshots
        .find((snapshot) => snapshot.url === entry.source_url).bytes, "base64").toString("utf8");
      for (const field of entry.evidence_fragments ? Object.keys(entry.evidence_fragments) : ["value"])
        assert.ok(html.includes(entry.evidence_fragments?.[field] || entry[field]));
    }
  });
}

test("real source envelope refuses provenance URL and snapshot SHA mismatch", { skip: !proofDir }, async () => {
  const artifact = JSON.parse(readFileSync(join(proofDir, "custom-lawn-source-envelope-proof.json"), "utf8"));
  const envelope = structuredClone(artifact.sourcePacketEnvelope);
  const packet = JSON.parse(Buffer.from(envelope.packet.bytes, "base64").toString("utf8"));
  const key = `service:${packet.content.services[0].name}`;
  packet.provenance[key].sourceUrl = packet.pages.find((page) => page.url !== packet.provenance[key].sourceUrl).url;
  const bytes = Buffer.from(JSON.stringify(packet));
  envelope.packet = { encoding: "base64", bytes: bytes.toString("base64"), byteLength: bytes.length, sha256: sha(bytes) };
  await assert.rejects(verifySourcePacketEnvelope({ envelope, rawInput: artifact.request,
    input: artifact.request }), (error) => error.code === "source_packet_provenance_snapshot_mismatch");
});
