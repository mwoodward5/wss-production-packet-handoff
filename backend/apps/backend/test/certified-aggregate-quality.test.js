"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createContentCertification } = require("../lib/intake-genie-client");

const source = "https://acme-plumbing.example/services";
const requestId = "ghost:acme-1:line-genie-certified-v7";
const prospect = { prospect_id: "acme-1", business_name: "Acme Plumbing", city: "Reno",
  state: "NV", place_id: "ChIJ-acme", website: "https://acme-plumbing.example", industry: "plumbing" };
const options = { signingKey: "test-only-certification-key", packetLocation: "prospect_record:genie_canonical_packet",
  requestId, jobId: "pagehub-test", idempotencyKey: requestId,
  requestSources: { website_url: source }, certifiedAt: "2026-08-24T10:00:00.000Z" };

function packet() {
  const files = { "content/home.md": "# Acme Plumbing\n\nSource-backed plumbing in Reno.",
    "content/services/drain-cleaning.md": "# Drain Cleaning\n\nAcme Plumbing offers drain cleaning in Reno." };
  const contract = { schema: "CertifiedPracticePacket/v1", kind: "certified_practice_packet",
    version: 1, facts: { category: "plumbing" }, assets: {}, builder_instructions: { public: false },
    visitor_copy: { kind: "visitor_copy", files,
      file_hashes: Object.fromEntries(Object.entries(files).map(([name, body]) =>
        [name, createHash("sha256").update(body).digest("hex")])),
      safety: { pass: true, violations: [] } } };
  const rows = Object.keys(files).map(sourcePath => ({ sourcePath, status: "pass", reasons: [] }));
  const quality = { status: "pass", totalFiles: rows.length, passCount: rows.length,
    reviewCount: 0, visitor: { totalFiles: rows.length, passCount: rows.length,
      reviewCount: 0, files: rows } };
  return { ok: true, version: "intake-genie-v2", status: "complete",
    scope: { supported: true, category: "plumbing" }, job_id: "pagehub-test", request_id: requestId,
    facts: { name: "Acme Plumbing", city: "Reno", state: "NV", category: "plumbing",
      services: ["Drain Cleaning"] },
    evidence: [{ field: "services", value: "Drain Cleaning", source_url: source,
      source_observations: [source], provenance: "observed", verification_status: "source_observation" }],
    packet2: { compiled: { contentContract: contract, contentQuality: quality },
      sources: { observations: [{ source, extracted: { exactServices: ["Drain Cleaning"] } }] } },
    content: { content_contract: contract, content_quality: quality } };
}

test("PageHub aggregate and every visitor file must pass before content certification", () => {
  const baseline = packet();
  assert.equal(createContentCertification(baseline, prospect, options).ok, true);
  const mutate = (change) => {
    const p = packet(); change(p);
    const result = createContentCertification(p, prospect, options);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(result.reasons.some(reason => reason.startsWith("pagehub_")), JSON.stringify(result.reasons));
  };
  mutate(p => { p.packet2.compiled.contentQuality.status = "review"; p.content.content_quality.status = "review"; });
  mutate(p => { p.packet2.compiled.contentQuality.visitor.passCount = 1; p.content.content_quality.visitor.passCount = 1; });
  mutate(p => { p.packet2.compiled.contentQuality.reviewCount = 1; p.content.content_quality.reviewCount = 1; });
  mutate(p => { p.packet2.compiled.contentQuality.visitor.files[0].status = "review"; });
  mutate(p => { p.packet2.compiled.contentQuality.visitor.files[0].reasons.push("source_missing"); });
  mutate(p => { p.packet2.compiled.contentQuality.visitor.files[1].sourcePath = "content/home.md"; });
  mutate(p => { delete p.packet2.compiled.contentQuality; });
});

test("legacy SiteForge packet without PageHub compiled shape keeps its existing certification path", () => {
  const p = packet();
  p.packet2 = { sources: p.packet2.sources };
  delete p.content.content_quality;
  assert.equal(createContentCertification(p, prospect, options).ok, true);
});
