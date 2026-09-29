"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createContentCertification,
  verifyContentCertification,
} = require("../lib/intake-genie-client");

const KEY = "test-only-shared-host-binding-key";
const REQUEST_ID = "ghost:acme-1:shared-host-binding";
const CERTIFIED_AT = "2026-08-24T10:00:00.000Z";

function prospect(website, overrides = {}) {
  return {
    prospect_id: "acme-1",
    business_name: "Acme Plumbing",
    city: "Reno",
    state: "NV",
    place_id: "ChIJ-acme",
    website,
    ...overrides,
  };
}

function packet(sourceUrl, overrides = {}) {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: "genie-job-acme-1",
    request_id: REQUEST_ID,
    facts: {
      name: "Acme Plumbing",
      city: "Reno",
      state: "NV",
      category: "plumbing",
      services: ["Drain Cleaning"],
    },
    evidence: [
      { field: "services", value: "Drain Cleaning", source_url: sourceUrl },
    ],
    ...overrides,
  };
}

function certOptions(sourceUrl, overrides = {}) {
  return {
    signingKey: KEY,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: REQUEST_ID,
    jobId: "genie-job-acme-1",
    idempotencyKey: REQUEST_ID,
    requestSources: { website_url: sourceUrl },
    certifiedAt: CERTIFIED_AT,
    ...overrides,
  };
}

const HOSTED_BUILDERS = [
  ["Wix", "https://alice.wixsite.com/acme", "https://bob.wixsite.com/acme"],
  ["GoDaddy", "https://alice.godaddysites.com", "https://bob.godaddysites.com"],
  ["Weebly", "https://alice.weebly.com", "https://bob.weebly.com"],
  ["WordPress", "https://alice.wordpress.com", "https://bob.wordpress.com"],
  ["Webflow", "https://alice.webflow.io", "https://bob.webflow.io"],
  ["Square", "https://alice.square.site", "https://bob.square.site"],
  ["Squarespace", "https://alice.squarespace.com", "https://bob.squarespace.com"],
  ["Shopify", "https://alice.myshopify.com", "https://bob.myshopify.com"],
  ["Carrd", "https://alice.carrd.co", "https://bob.carrd.co"],
  ["Framer", "https://alice.framer.website", "https://bob.framer.website"],
  ["Vercel", "https://alice.vercel.app", "https://bob.vercel.app"],
];

test("shared-host builders reject another tenant's request source", () => {
  for (const [builder, owner, foreign] of HOSTED_BUILDERS) {
    const made = createContentCertification(packet(foreign), prospect(owner), certOptions(foreign));
    assert.equal(made.ok, false, `${builder}: ${JSON.stringify(made)}`);
    assert.ok(made.reasons.includes("source_set_prospect_mismatch"), builder);
  }
});

test("shared-host builders reject another tenant's evidence", () => {
  for (const [builder, owner, foreign] of HOSTED_BUILDERS) {
    const made = createContentCertification(packet(foreign), prospect(owner), certOptions(owner));
    assert.equal(made.ok, false, `${builder}: ${JSON.stringify(made)}`);
    assert.ok(made.reasons.includes("source_bound_evidence_missing"), builder);
    assert.ok(made.reasons.includes("verified_service_evidence_missing"), builder);
  }
});

test("shared-host builders accept pages belonging to the same tenant", () => {
  for (const [builder, owner, evidence] of [
    ["Wix", "https://alice.wixsite.com/acme", "https://alice.wixsite.com/acme/services"],
    ["GoDaddy", "https://alice.godaddysites.com", "https://alice.godaddysites.com/services"],
    ["Weebly", "https://alice.weebly.com", "https://alice.weebly.com/services"],
    ["WordPress", "https://alice.wordpress.com", "https://alice.wordpress.com/services"],
    ["Webflow", "https://alice.webflow.io", "https://alice.webflow.io/services"],
    ["Square", "https://alice.square.site", "https://alice.square.site/services"],
  ]) {
    const made = createContentCertification(packet(evidence), prospect(owner), certOptions(owner));
    assert.equal(made.ok, true, `${builder}: ${JSON.stringify(made)}`);
  }
});

test("path-scoped builder tenants require the same tenant path", () => {
  for (const [owner, foreign] of [
    ["https://alice.wixsite.com/acme", "https://alice.wixsite.com/other-business"],
    ["https://linktr.ee/acme", "https://linktr.ee/other-business"],
  ]) {
    const made = createContentCertification(packet(foreign), prospect(owner), certOptions(foreign));
    assert.equal(made.ok, false, JSON.stringify(made));
    assert.ok(made.reasons.includes("source_set_prospect_mismatch"));
  }
});

test("ordinary custom domains retain same-registrable-domain binding", () => {
  const owner = "https://www.acme-plumbing.example";
  const source = "https://shop.acme-plumbing.example/services";
  const evidence = "https://news.acme-plumbing.example/drain-cleaning";
  const made = createContentCertification(packet(evidence), prospect(owner), certOptions(source));
  assert.equal(made.ok, true, JSON.stringify(made));
});

test("social sources still require exact URL binding", () => {
  const owner = "https://facebook.com/acme-plumbing";
  const foreign = "https://facebook.com/other-business";
  const current = prospect("", { facebook_url: owner });

  const wrongSource = createContentCertification(packet(foreign), current, certOptions(foreign, {
    requestSources: { facebook_url: foreign },
  }));
  assert.equal(wrongSource.ok, false, JSON.stringify(wrongSource));
  assert.ok(wrongSource.reasons.includes("source_set_prospect_mismatch"));

  const wrongEvidence = createContentCertification(packet(foreign), current, certOptions(owner, {
    requestSources: { facebook_url: owner },
  }));
  assert.equal(wrongEvidence.ok, false, JSON.stringify(wrongEvidence));
  assert.ok(wrongEvidence.reasons.includes("source_bound_evidence_missing"));
});

test("certification verification rejects reuse for another hosted-builder tenant", () => {
  const source = "https://alice.webflow.io";
  const currentPacket = packet(`${source}/services`);
  const made = createContentCertification(currentPacket, prospect(source), certOptions(source));
  assert.equal(made.ok, true, JSON.stringify(made));

  const verified = verifyContentCertification(made.receipt, currentPacket, prospect(source), {
    signingKey: KEY,
    requestSources: { website_url: source },
    idempotencyKey: REQUEST_ID,
    nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
  });
  assert.equal(verified.ok, true, JSON.stringify(verified));

  const reused = verifyContentCertification(made.receipt, currentPacket, prospect("https://bob.webflow.io"), {
    signingKey: KEY,
    requestSources: { website_url: source },
    idempotencyKey: REQUEST_ID,
    nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
  });
  assert.equal(reused.ok, false);
  assert.equal(reused.reason, "receipt_source_prospect_mismatch");
});
