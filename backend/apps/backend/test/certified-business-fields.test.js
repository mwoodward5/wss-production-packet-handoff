"use strict";

// test/certified-business-fields.test.js — the optional CERTIFIED business
// fields (2026-09-02 12-feature spec) end to end.
//
// Owner ruling: license_number, insured, associations, financing,
// google_place_id, sms_capable and project_photos are truths about the
// business, collected and signed by the intake compiler like every other
// fact. This file pins the three seams this side owns:
//
//   1. CERTIFICATION — the fields ride inside packet.facts, so the receipt's
//      packet_sha256 signs them. Present fields certify; tampering with one
//      breaks re-verification; existing receipts without them verify exactly
//      as before (nothing about the receipt contract changed).
//   2. ACCEPTANCE — genieToMirrorRequest maps a present field into
//      request.facts. Absent stays absent: a packet without them produces the
//      byte-identical request it always did.
//   3. BOUNDARY — the MirrorFacts schema (additionalProperties: false) now
//      homes the optional shapes, and validateFacts picks them up under the
//      existing string rules. No new rejection logic was added.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const {
  createContentCertification,
  verifyContentCertification,
} = require("../lib/intake-genie-client");
const { genieToMirrorRequest } = require("../lib/mirror-engine/from-genie");
const { validateFacts } = require("../lib/mirror-engine/facts");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

const KEY = "test-only-intake-genie-content-certification-key";
const SOURCE = "https://acme-plumbing.example/services";

const VERIFIED_NAP = {
  phone: "(775) 555-0142",
  website: "https://acme-plumbing.example",
  address: "100 Water Way, Reno, NV 89501",
  source: "leadminer:place-acme-plumbing",
};

const CERTIFIED_FACTS = {
  license_number: "NV-112233",
  insured: true,
  sms_capable: true,
  google_place_id: "ChIJ-certified-acme",
  associations: ["NRCA", "GAF Master Elite"],
  financing: {
    enabled: true,
    partner: "GreenSky",
    apply_url: "https://apply.greensky.example/acme",
    payment_methods: ["Visa", "Check"],
  },
  project_photos: [
    {
      before_url: "https://photos.acme-plumbing.example/before-1.jpg",
      after_url: "https://photos.acme-plumbing.example/after-1.jpg",
      caption: "Reno repipe",
    },
  ],
};

function prospect(overrides = {}) {
  return {
    prospect_id: "acme-1",
    business_name: "Acme Plumbing",
    city: "Reno",
    state: "NV",
    place_id: "ChIJ-acme",
    website: "https://acme-plumbing.example",
    industry: "plumbing",
    ...overrides,
  };
}

function certifiedPracticeContract(category = "plumbing", files = {
  "content/home.md": "# Acme Plumbing\n\nAcme Plumbing offers source-backed plumbing services for customers in Reno.",
  "content/services/drain-cleaning.md": "# Drain Cleaning\n\nAsk Acme Plumbing about drain cleaning for your property in Reno.",
}) {
  return {
    schema: "CertifiedPracticePacket/v1",
    kind: "certified_practice_packet",
    version: 1,
    facts: { category },
    assets: {},
    builder_instructions: { public: false },
    visitor_copy: {
      kind: "visitor_copy",
      files,
      file_hashes: Object.fromEntries(Object.entries(files).map(([name, body]) => [
        name,
        createHash("sha256").update(body).digest("hex"),
      ])),
      safety: { pass: true, violations: [] },
    },
  };
}

function canonicalPacket(overrides = {}) {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: "genie-job-acme-1",
    request_id: "ghost:acme-1:line-genie-certified-v7",
    facts: {
      name: "Acme Plumbing",
      city: "Reno",
      state: "NV",
      category: "plumbing",
      services: ["Drain Cleaning", "Water Heater Repair"],
    },
    evidence: [
      {
        field: "services", value: "Drain Cleaning", source_url: SOURCE,
        source_observations: [SOURCE], provenance: "observed", verification_status: "source_observation",
      },
      {
        field: "services", value: "Water Heater Repair", source_url: SOURCE,
        source_observations: [SOURCE], provenance: "observed", verification_status: "source_observation",
      },
    ],
    packet2: {
      sources: {
        observations: [{
          source: SOURCE,
          extracted: { exactServices: ["Drain Cleaning", "Water Heater Repair"] },
        }],
      },
    },
    content: {
      content_contract: certifiedPracticeContract(),
    },
    ...overrides,
  };
}

function certOptions(overrides = {}) {
  return {
    signingKey: KEY,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: "ghost:acme-1:line-genie-certified-v7",
    jobId: "genie-job-acme-1",
    idempotencyKey: "ghost:acme-1:line-genie-certified-v7",
    requestSources: { website_url: SOURCE },
    certifiedAt: "2026-08-24T10:00:00.000Z",
    ...overrides,
  };
}

test("a packet carrying certified business fields certifies and re-verifies", () => {
  const packet = canonicalPacket({ facts: { ...canonicalPacket().facts, ...CERTIFIED_FACTS } });
  const certified = createContentCertification(packet, prospect(), certOptions());
  assert.equal(certified.ok, true, JSON.stringify(certified.reasons || certified));

  const verified = verifyContentCertification(
    certified.receipt,
    packet,
    prospect(),
    { signingKey: KEY, requestSources: { website_url: SOURCE }, idempotencyKey: "ghost:acme-1:line-genie-certified-v7", nowMs: Date.parse("2026-08-24T11:00:00.000Z") },
  );
  assert.equal(verified.ok, true, verified.reason || "");
});

test("tampering with a certified fact breaks receipt re-verification", () => {
  const packet = canonicalPacket({ facts: { ...canonicalPacket().facts, ...CERTIFIED_FACTS } });
  const certified = createContentCertification(packet, prospect(), certOptions());
  assert.equal(certified.ok, true);

  const tampered = JSON.parse(JSON.stringify(packet));
  tampered.facts.insured = false;
  const verified = verifyContentCertification(
    certified.receipt,
    tampered,
    prospect(),
    { signingKey: KEY, requestSources: { website_url: SOURCE }, idempotencyKey: "ghost:acme-1:line-genie-certified-v7", nowMs: Date.parse("2026-08-24T11:00:00.000Z") },
  );
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "receipt_packet_mismatch");
});

test("a receipt over a packet without certified fields still verifies unchanged", () => {
  const packet = canonicalPacket();
  const certified = createContentCertification(packet, prospect(), certOptions());
  assert.equal(certified.ok, true, JSON.stringify(certified.reasons || certified));
  const verified = verifyContentCertification(
    certified.receipt,
    packet,
    prospect(),
    { signingKey: KEY, requestSources: { website_url: SOURCE }, idempotencyKey: "ghost:acme-1:line-genie-certified-v7", nowMs: Date.parse("2026-08-24T11:00:00.000Z") },
  );
  assert.equal(verified.ok, true, verified.reason || "");
});

function mirrorRequestPacket(facts = {}) {
  return canonicalPacket({ facts: { ...canonicalPacket().facts, ...facts } });
}

test("present certified fields flow into request.facts and pass the schema", () => {
  const result = genieToMirrorRequest(mirrorRequestPacket(CERTIFIED_FACTS), {
    slug: "wss-test-acme-plumbing-reno",
    verifiedNap: VERIFIED_NAP,
  });
  assert.equal(result.ok, true, JSON.stringify(result.detail || result.error || {}));

  const facts = result.request.facts;
  assert.equal(facts.license_number, "NV-112233");
  assert.equal(facts.insured, true);
  assert.equal(facts.sms_capable, true);
  assert.equal(facts.google_place_id, "ChIJ-certified-acme");
  assert.deepEqual(facts.associations, ["NRCA", "GAF Master Elite"]);
  assert.deepEqual(facts.financing, {
    enabled: true,
    partner: "GreenSky",
    apply_url: "https://apply.greensky.example/acme",
    payment_methods: ["Visa", "Check"],
  });
  assert.deepEqual(facts.project_photos, [{
    before_url: "https://photos.acme-plumbing.example/before-1.jpg",
    after_url: "https://photos.acme-plumbing.example/after-1.jpg",
    caption: "Reno repipe",
  }]);

  // The schema (additionalProperties: false) homes every new shape.
  const checked = checkMirrorRequest(result.request);
  assert.equal(checked.ok, true, JSON.stringify(checked.body || checked));

  // The engine's semantic boundary picks them up under the existing rules.
  const semantic = validateFacts({ facts: JSON.parse(JSON.stringify(facts)) });
  assert.equal(semantic.ok, true, JSON.stringify(semantic.detail || semantic));
  assert.equal(semantic.facts.license_number, "NV-112233");
  assert.equal(semantic.facts.insured, true);
  assert.deepEqual(semantic.facts.associations, ["NRCA", "GAF Master Elite"]);
});

test("a packet without certified fields produces the identical legacy request", () => {
  const withFields = genieToMirrorRequest(mirrorRequestPacket(CERTIFIED_FACTS), {
    slug: "wss-test-acme-plumbing-reno",
    verifiedNap: VERIFIED_NAP,
  }).request;
  const without = genieToMirrorRequest(mirrorRequestPacket({}), {
    slug: "wss-test-acme-plumbing-reno",
    verifiedNap: VERIFIED_NAP,
  });
  assert.equal(without.ok, true);

  for (const key of ["license_number", "insured", "sms_capable", "google_place_id", "associations", "financing", "project_photos"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(without.request.facts, key), false);
  }

  // Stripping exactly the certified keys from the with-fields request
  // reproduces the without-fields request byte-for-byte.
  const stripped = JSON.parse(JSON.stringify(withFields));
  for (const key of ["license_number", "insured", "sms_capable", "google_place_id", "associations", "financing", "project_photos"]) {
    delete stripped.facts[key];
  }
  assert.deepEqual(stripped, JSON.parse(JSON.stringify(without.request)));
});

test("certified field sanitization drops junk instead of failing the request", () => {
  const result = genieToMirrorRequest(mirrorRequestPacket({
    license_number: "   ",
    insured: "yes",
    financing: { enabled: true, apply_url: "http://insecure.example/apply", partner: "" },
    project_photos: [
      { before_url: "https://photos.acme-plumbing.example/b.jpg", after_url: "https://photos.acme-plumbing.example/a.jpg", caption: "keep" },
      { before_url: "https://photos.acme-plumbing.example/c.jpg" },
      { before_url: "javascript:alert(1)", after_url: "https://photos.acme-plumbing.example/d.jpg" },
      "not-an-object",
    ],
  }), {
    slug: "wss-test-acme-plumbing-reno",
    verifiedNap: VERIFIED_NAP,
  });
  assert.equal(result.ok, true, JSON.stringify(result.detail || result.error || {}));

  const facts = result.request.facts;
  assert.equal(facts.license_number, undefined);
  assert.equal(facts.insured, undefined, "a string 'yes' is not the boolean true");
  assert.deepEqual(facts.financing, { enabled: true }, "an http apply_url is dropped, not rewritten");
  // The gallery contract renders only COMPLETE before/after pairs: the
  // after-less and javascript-URL rows are dropped, the complete pair stays.
  assert.deepEqual(facts.project_photos, [
    {
      before_url: "https://photos.acme-plumbing.example/b.jpg",
      after_url: "https://photos.acme-plumbing.example/a.jpg",
      caption: "keep",
    },
  ]);
  const checked = checkMirrorRequest(result.request);
  assert.equal(checked.ok, true, JSON.stringify(checked.body || checked));
});
