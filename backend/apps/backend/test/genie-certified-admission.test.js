"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const {
  createContentCertification,
  prospectRequest,
  sourceUrls,
  verifyContentCertification,
} = require("../lib/intake-genie-client");
const {
  compileGenieContent,
  pickProspects,
} = require("../lib/line-adapters");

const KEY = "test-only-intake-genie-content-certification-key";
const SOURCE = "https://acme-plumbing.example/services";

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

function leadMinerRow(overrides = {}) {
  const base = prospect({
    status: "held",
    email: "owner@acme-plumbing.example",
    updated_at: "2026-08-24T09:00:00.000Z",
  });
  const truth = {
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: false, missing_build_evidence: ["content"] },
    mirror_ready: {
      business_name: base.business_name,
      place_id: base.place_id,
      logo_url: "",
      services: ["Drain Cleaning", "Water Heater Repair"],
    },
    services: ["Drain Cleaning", "Water Heater Repair"],
    industry: "plumbing",
  };
  return {
    ...base,
    record: {
      status: "held",
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: truth,
      business_name: base.business_name,
      city: base.city,
      state: base.state,
      place_id: base.place_id,
      website: base.website,
      industry: "plumbing",
    },
    ...overrides,
  };
}

function compilerResult(packet = canonicalPacket()) {
  return {
    ok: true,
    packet,
    request: {
      request_id: "ghost:acme-1:line-genie-certified-v7",
      sources: { website_url: SOURCE },
    },
    idempotencyKey: "ghost:acme-1:line-genie-certified-v7",
  };
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseObjectKeys(value[key])]));
}

test("content receipt is exact-packet, exact-business, source, and service-evidence bound", () => {
  const packet = canonicalPacket();
  const made = createContentCertification(packet, prospect(), certOptions());
  assert.equal(made.ok, true, JSON.stringify(made));

  const verify = (receipt = made.receipt, currentPacket = packet, currentProspect = prospect(), options = {}) =>
    verifyContentCertification(receipt, currentPacket, currentProspect, {
      signingKey: KEY,
      requestSources: { website_url: SOURCE },
      idempotencyKey: "ghost:acme-1:line-genie-certified-v7",
      nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
      ...options,
    });

  assert.equal(verify().ok, true);
  assert.equal(verify({
    ...made.receipt,
    identity: reverseObjectKeys(made.receipt.identity),
    evidence: reverseObjectKeys(made.receipt.evidence),
  }).ok, true, "JSONB nested receipt key reordering must preserve the signature");
  assert.equal(verify(made.receipt, reverseObjectKeys(packet)).ok, true, "JSONB key reordering must not change the packet digest");
  assert.equal(verifyContentCertification(null, packet, prospect(), { signingKey: KEY }).reason, "receipt_missing");
  assert.equal(verify({ ...made.receipt, signature: "0".repeat(64) }).reason, "receipt_signature_invalid");
  assert.equal(verify(made.receipt, { ...packet, facts: { ...packet.facts, name: "Other Co" } }).reason, "receipt_packet_mismatch");
  assert.equal(verify(made.receipt, packet, prospect({ prospect_id: "other" })).reason, "receipt_prospect_mismatch");
  assert.equal(verify(made.receipt, packet, prospect({ website: "https://other.example" })).reason, "receipt_source_prospect_mismatch");
  assert.equal(verify(made.receipt, packet, prospect({ place_id: "ChIJ-other" })).reason, "receipt_place_mismatch");
  assert.equal(verify(made.receipt, packet, prospect({ business_name: "Other Co" })).reason, "receipt_name_mismatch");
  assert.equal(verify(made.receipt, packet, prospect({ city: "Sparks" })).reason, "receipt_city_mismatch");
  assert.equal(verify(made.receipt, packet, prospect({ state: "CA" })).reason, "receipt_state_mismatch");
  assert.equal(verify(made.receipt, packet, prospect({ industry: "hvac" })).reason, "receipt_category_mismatch");
  assert.equal(verify(made.receipt, packet, prospect(), { nowMs: Date.parse("2026-10-01T00:00:00Z") }).reason, "receipt_expired");
  assert.equal(verify(made.receipt, packet, prospect(), { nowMs: Date.parse("2026-08-24T09:00:00Z") }).reason, "receipt_time_invalid");
  assert.equal(verify({ ...made.receipt, packet_location: "prospect_record:other" }).reason, "receipt_packet_not_durable");
  assert.equal(verify(made.receipt, packet, prospect(), { idempotencyKey: "ghost:acme-1:wrong-retry" }).reason, "receipt_idempotency_mismatch");
});

test("category-family labels bind to the same signed canonical category", () => {
  const packet = canonicalPacket({
    scope: { supported: true, category: "Roofing contractor" },
    facts: {
      name: "Acme Plumbing",
      city: "Reno",
      state: "NV",
      category: "Roofing contractor",
      services: ["Drain Cleaning", "Water Heater Repair"],
    },
    content: {
      content_contract: certifiedPracticeContract("roofing"),
    },
  });
  const current = prospect({ industry: "Roofing contractor" });
  const made = createContentCertification(packet, current, certOptions());

  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.receipt.identity.category, "roofing");
  assert.equal(verifyContentCertification(made.receipt, packet, current, {
    signingKey: KEY,
    requestSources: { website_url: SOURCE },
    idempotencyKey: "ghost:acme-1:line-genie-certified-v7",
    nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
  }).ok, true);
});

test("Intake Genie uses a website ahead of Maps while retaining first-party social profiles", () => {
  const sources = sourceUrls(prospect({
    source_urls: ["https://youtube.com/@acmeplumbing"],
    record: {
      truth_packet_source: "leadminer_mirror_ready",
      mirror_request: { facts: { profile_url: "https://www.google.com/maps?cid=123" } },
      social_evidence: {
        attached: [
          { network: "facebook", url: "https://facebook.com/acmeplumbing" },
          { network: "instagram", url: "https://instagram.com/acmeplumbing" },
          { network: "linkedin", url: "https://linkedin.com/company/acmeplumbing" },
        ],
      },
    },
  }));
  assert.equal(sources.facebook_url, "https://facebook.com/acmeplumbing");
  assert.equal(sources.website_url, "https://acme-plumbing.example");
  assert.equal(sources.gbp_url, undefined, "Maps is not a compile source when a website exists");
  assert.equal(sources.instagram_url, "https://instagram.com/acmeplumbing");
  assert.equal(sources.social_url, "https://linkedin.com/company/acmeplumbing");
  assert.deepEqual(sources.additional_urls, [
    "https://youtube.com/@acmeplumbing",
  ]);
});

test("Intake Genie uses the verified Maps profile for a website-less prospect", () => {
  const sources = sourceUrls(prospect({
    website: "",
    record: {
      truth_packet_source: "leadminer_mirror_ready",
      mirror_request: { facts: { profile_url: "https://www.google.com/maps?cid=123" } },
    },
  }));
  assert.equal(sources.website_url, undefined);
  assert.equal(sources.gbp_url, "https://www.google.com/maps?cid=123");
});

test("unverified compiler observations are never recycled as trusted crawl sources", () => {
  const sources = sourceUrls(prospect({
    record: {
      truth_packet: {
        intakeGenie: {
          facts: {
            profile_url: "https://www.google.com/maps?cid=unverified-competitor",
            socials: ["https://facebook.com/competitor"],
          },
        },
      },
    },
  }));
  assert.equal(sources.gbp_url, undefined);
  assert.equal(sources.facebook_url, undefined);
  assert.deepEqual(sources.additional_urls || [], []);
});

test("certification refuses weak compiler contracts and invented services", () => {
  const noEvidence = createContentCertification(
    { ...canonicalPacket(), evidence: [] }, prospect(), certOptions(),
  );
  assert.equal(noEvidence.ok, false);
  assert.ok(noEvidence.reasons.includes("verified_service_evidence_missing"));

  const legacy = canonicalPacket();
  legacy.content = { content_files: certifiedPracticeContract().visitor_copy.files };
  const legacyResult = createContentCertification(legacy, prospect(), certOptions());
  assert.equal(legacyResult.ok, false);
  assert.ok(legacyResult.reasons.includes("certified_practice_contract_invalid"));

  const tampered = canonicalPacket();
  tampered.content.content_contract.visitor_copy.files["content/home.md"] += " tampered";
  const tamperedResult = createContentCertification(tampered, prospect(), certOptions());
  assert.equal(tamperedResult.ok, false);
  assert.ok(tamperedResult.reasons.includes("certified_practice_visitor_hash_mismatch"));

  for (const packet of [
    { ...canonicalPacket(), ok: false },
    { ...canonicalPacket(), version: "intake-genie-v1" },
    { ...canonicalPacket(), status: "out_of_scope" },
    { ...canonicalPacket(), status: undefined },
    { ...canonicalPacket(), scope: { supported: false } },
  ]) {
    const result = createContentCertification(packet, prospect(), certOptions());
    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("compiler_packet_not_buildable"));
  }

  const wrongLocation = createContentCertification(canonicalPacket(), prospect(), certOptions({ packetLocation: "C:/tmp/packet.json" }));
  assert.equal(wrongLocation.ok, false);
  assert.ok(wrongLocation.reasons.includes("durable_packet_location_required"));

  const noDedicatedKey = createContentCertification(canonicalPacket(), prospect(), certOptions({ signingKey: "" }));
  assert.equal(noDedicatedKey.ok, false);
  assert.ok(noDedicatedKey.reasons.includes("certification_key_missing"));

  const wrongRequest = createContentCertification(
    { ...canonicalPacket(), request_id: "ghost:someone-else:cached" },
    prospect(),
    certOptions(),
  );
  assert.equal(wrongRequest.ok, false);
  assert.ok(wrongRequest.reasons.includes("compile_request_id_mismatch"));

  const missingRequest = createContentCertification(
    { ...canonicalPacket(), request_id: undefined },
    prospect(),
    certOptions(),
  );
  assert.equal(missingRequest.ok, false);
  assert.ok(missingRequest.reasons.includes("compiler_response_request_id_missing"));
});

test("Intake Genie receives the nested current website even when it still uses HTTP", () => {
  const currentUrl = "http://www.affordableplumbingjacksonville.com/";
  const current = prospect({
    website: "",
    record: {
      build_ready: {
        mirror_request: { facts: { current_website: currentUrl } },
      },
    },
  });

  const sources = sourceUrls(current);
  assert.equal(sources.website_url, currentUrl);
  assert.equal(prospectRequest(current).sources.website_url, currentUrl);
  assert.equal(prospectRequest(current).intake_mode, "url_first");
});

test("HTTP current URL accepts only a source-bound compatible business-name alias", () => {
  const current = prospect({
    business_name: "Complete Plumbing, Electric & Air",
    website: "http://completehomesolutionsar.com/",
    city: "Sherwood",
    state: "AR",
  });
  const evidenceRoot = "https://completehomesolutionsar.com";
  const alias = "Complete Plumbing and Electric Solutions LLC";
  const packet = canonicalPacket({
    facts: {
      ...canonicalPacket().facts,
      name: alias,
      city: "Sherwood",
      state: "AR",
      services: ["Drain Cleaning"],
    },
    evidence: [
      { field: "name", value: alias, source_url: `${evidenceRoot}/about` },
      { field: "services", value: "Drain Cleaning", source_url: `${evidenceRoot}/plumbing` },
    ],
  });
  const options = certOptions({
    requestSources: { website_url: current.website },
  });

  const made = createContentCertification(packet, current, options);
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(verifyContentCertification(made.receipt, packet, current, {
    signingKey: KEY,
    requestSources: { website_url: current.website },
    idempotencyKey: "ghost:acme-1:line-genie-certified-v7",
    nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
  }).ok, true);

  for (const [label, name, nameSource] of [
    ["foreign name evidence", alias, "https://other-plumber.example/about"],
    ["unrelated same-owner name", "Affordable Plumbing Company LLC", `${evidenceRoot}/about`],
    ["same-prefix multi-trade expansion", "Complete Plumbing Roofing HVAC Electrical", `${evidenceRoot}/about`],
    ["same-prefix different trailing brand", "Complete Plumbing and Electric Gas LLC", `${evidenceRoot}/about`],
  ]) {
    const refusedPacket = {
      ...packet,
      facts: { ...packet.facts, name },
      evidence: [
        { field: "name", value: name, source_url: nameSource },
        { field: "services", value: "Drain Cleaning", source_url: `${evidenceRoot}/plumbing` },
      ],
    };
    const refused = createContentCertification(refusedPacket, current, options);
    assert.equal(refused.ok, false, label);
    assert.ok(refused.reasons.includes("business_name_mismatch"), label);
  }
});

test("a name bridged by the prospect's own city is the same local brand, not a mismatch", () => {
  // Pinned production regression (eliteaustinac.com): the miner-harvested pick
  // "Elite Austin AC & Plumbing" inserts the prospect's own city between brand
  // tokens, while the site identity is "Elite AC & Plumbing". Contiguous token
  // containment alone refused the pair (business_name_mismatch).
  const evidenceRoot = "https://eliteaustinac.example";
  const pickName = "Elite Austin AC & Plumbing";
  const siteName = "Elite AC & Plumbing";
  const compile = (name) => canonicalPacket({
    facts: {
      ...canonicalPacket().facts,
      name,
      city: "Austin",
      state: "TX",
      services: ["Drain Cleaning"],
    },
    evidence: [
      { field: "name", value: name, source_url: `${evidenceRoot}/about` },
      { field: "services", value: "Drain Cleaning", source_url: `${evidenceRoot}/plumbing` },
    ],
  });
  const options = certOptions({ requestSources: { website_url: `${evidenceRoot}/` } });

  // Pick name carries the city word; site identity omits it.
  const pickProspect = prospect({
    business_name: pickName,
    website: `${evidenceRoot}/`,
    city: "Austin",
    state: "TX",
  });
  const made = createContentCertification(compile(siteName), pickProspect, options);
  assert.equal(made.ok, true, JSON.stringify(made));

  // Reverse direction: the compiled name carries the city word, the prospect
  // row carries the bare site brand.
  const bareProspect = prospect({
    business_name: siteName,
    website: `${evidenceRoot}/`,
    city: "Austin",
    state: "TX",
  });
  const madeReverse = createContentCertification(compile(pickName), bareProspect, options);
  assert.equal(madeReverse.ok, true, JSON.stringify(madeReverse));

  // Only the prospect's OWN location bridges. A different city — or any
  // non-location word — still breaks contiguity and refuses certification.
  for (const name of [
    "Elite Dallas AC & Plumbing",
    "Elite Premium AC & Plumbing",
  ]) {
    const refused = createContentCertification(compile(name), pickProspect, options);
    assert.equal(refused.ok, false, name);
    assert.ok(refused.reasons.includes("business_name_mismatch"), name);
  }
});

test("a source-bound four-token legal brand may omit GBP service and locality descriptors", () => {
  const current = prospect({
    business_name: "Roy Briley General Contracting, Fire & Water Damage Restoration, Mold Mitigation in Anchorage Alaska",
    website: "https://www.roybrileygeneralcontracting.com/",
    city: "Anchorage",
    state: "AK",
  });
  const legalBrand = "Roy Briley General Contracting";
  const source = "https://www.roybrileygeneralcontracting.com";
  const packet = canonicalPacket({
    facts: {
      ...canonicalPacket().facts,
      name: legalBrand,
      city: "Anchorage",
      state: "AK",
      services: ["Home Repair"],
    },
    evidence: [
      { field: "name", value: legalBrand, source_url: `${source}/about` },
      { field: "services", value: "Home Repair", source_url: `${source}/services` },
    ],
  });
  const options = certOptions({ requestSources: { website_url: current.website } });

  const made = createContentCertification(packet, current, options);
  assert.equal(made.ok, true, JSON.stringify(made));

  for (const name of [
    "Roy Briley General Roofing",
    "Roy Briley General Contracting Competitor",
  ]) {
    const refusedPacket = {
      ...packet,
      facts: { ...packet.facts, name },
      evidence: [
        { field: "name", value: name, source_url: `${source}/about` },
        { field: "services", value: "Home Repair", source_url: `${source}/services` },
      ],
    };
    const refused = createContentCertification(refusedPacket, current, options);
    assert.equal(refused.ok, false, name);
    assert.ok(refused.reasons.includes("business_name_mismatch"), name);
  }
});

test("content certification accepts provider success labels but never needs_input", () => {
  for (const status of ["complete", "ready", "compiled"]) {
    const packet = canonicalPacket({ status });
    const made = createContentCertification(packet, prospect(), certOptions());
    assert.equal(made.ok, true, `${status}: ${JSON.stringify(made)}`);
    assert.equal(verifyContentCertification(made.receipt, packet, prospect(), {
      signingKey: KEY,
      requestSources: { website_url: SOURCE },
      idempotencyKey: "ghost:acme-1:line-genie-certified-v7",
      nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
    }).ok, true, status);
  }

  const needsInput = createContentCertification(
    canonicalPacket({ status: "needs_input" }),
    prospect(),
    certOptions(),
  );
  assert.equal(needsInput.ok, false);
  assert.ok(needsInput.reasons.includes("compiler_packet_not_buildable"));
});

test("shared-platform evidence must match the exact requested business URL", () => {
  for (const row of [
    {
      current: prospect({ website: "", facebook_url: "https://facebook.com/acmeplumbing" }),
      requested: { facebook_url: "https://facebook.com/acmeplumbing" },
      wrong: "https://facebook.com/another-business",
    },
    {
      current: prospect({ website: "", gbp_url: "https://google.com/maps/place/Acme+Plumbing" }),
      requested: { gbp_url: "https://google.com/maps/place/Acme+Plumbing" },
      wrong: "https://google.com/maps/place/Another+Business",
    },
  ]) {
    const packet = canonicalPacket({
      evidence: [
        { field: "services", value: "Drain Cleaning", source_url: row.wrong },
        { field: "services", value: "Water Heater Repair", source_url: row.wrong },
      ],
    });
    const result = createContentCertification(packet, row.current, certOptions({ requestSources: row.requested }));
    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("source_bound_evidence_missing"));
    assert.ok(result.reasons.includes("verified_service_evidence_missing"));
  }
});

test("line admission compiles only the ordered requested set in parallel and admits sandbox without logo or email", async () => {
  const rows = [
    leadMinerRow({ prospect_id: "acme-1", email: "" }),
    leadMinerRow({ prospect_id: "acme-2", business_name: "Second Plumbing", place_id: "ChIJ-second" }),
  ];
  let calls = 0;
  let savedRecord = null;
  const picked = await pickProspects(
    { target: "leadminer", count: 1, lane: "sandbox" },
    {
      env: { VERCEL_ENV: "production", GHOST_AGENCY_QUEUE_GAP_FIRST: "0" },
      certificationKey: KEY,
      select: async () => ({ ok: true, data: rows }),
      resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
      callIntakeGenie: async () => { calls += 1; return compilerResult(); },
      conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
        savedRecord = patch.record;
        return { ok: true, updated: true };
      },
      now: () => "2026-08-24T10:00:00.000Z",
      nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
    },
  );
  assert.equal(calls, 1, "count=1 permits one compiler call, not the whole shelf");
  assert.equal(picked.length, 1);
  assert.equal(picked[0].prospectId, "acme-1");
  assert.equal(picked[0].hasEmail, false);
  assert.equal(picked[0].genieContentCertified, true);
  assert.equal(Boolean(picked[0].needs_fill), false);
  assert.ok(savedRecord.genie_content_certification);
  assert.equal(savedRecord.truth_packet_source, "leadminer_mirror_ready");
  assert.equal(savedRecord.truth_packet.source, "leadminer_mirror_ready");
});

test("fresh Lead Miner Lite rows compile through Intake Genie before line admission", async () => {
  const fresh = leadMinerRow({
    status: "new",
    record: {
      ...leadMinerRow().record,
      status: "new",
      source: "build-ready-mine",
      build_ready: {
        proof: { build_hash: "fresh-build-hash" },
        mirror_request: { facts: { current_website: "https://acme-plumbing.example", socials: [] } },
      },
    },
  });
  let compilerCalls = 0;
  let selects = 0;
  const picked = await pickProspects(
    { target: "plumbers in Reno NV", count: 1, lane: "sandbox" },
    {
      env: { VERCEL_ENV: "production" },
      certificationKey: KEY,
      select: async () => {
        selects += 1;
        return selects === 1 ? { ok: true, data: [] } : { ok: true, data: [fresh] };
      },
      mineLeads: async () => ({
        ok: true,
        rows: [{ prospect_id: fresh.prospect_id, build_hash: "fresh-build-hash", persistence: "created" }],
        funnel: [],
      }),
      callIntakeGenie: async () => { compilerCalls += 1; return compilerResult(); },
      conditionalUpdate: async (_table, _key, _id, _guards, patch) => ({
        ok: true,
        updated: true,
        rows: [{ ...fresh, record: patch.record, updated_at: patch.updated_at }],
      }),
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
      now: () => "2026-08-24T10:00:00.000Z",
      nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
    },
  );
  assert.equal(compilerCalls, 1);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].prospectId, "acme-1");
});

test("a transient fresh Intake Genie failure retries instead of dropping the candidate", async () => {
  const fresh = leadMinerRow({
    status: "new",
    record: {
      ...leadMinerRow().record,
      status: "new",
      source: "build-ready-mine",
      build_ready: {
        proof: { build_hash: "fresh-build-hash" },
        mirror_request: { facts: { current_website: "https://acme-plumbing.example", socials: [] } },
      },
    },
  });
  let selects = 0;
  await assert.rejects(
    pickProspects(
      { target: "plumbers in Reno NV", count: 1, lane: "sandbox" },
      {
        env: { VERCEL_ENV: "production" },
        certificationKey: KEY,
        select: async () => {
          selects += 1;
          return selects === 1 ? { ok: true, data: [] } : { ok: true, data: [fresh] };
        },
        mineLeads: async () => ({
          ok: true,
          rows: [{ prospect_id: fresh.prospect_id, build_hash: "fresh-build-hash", persistence: "created" }],
          funnel: [],
        }),
        callIntakeGenie: async () => ({ ok: false, error: "compiler_timeout" }),
        resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
      },
    ),
    (error) => error?.code === "intake_genie_compile_retryable",
  );
});

test("numeric Intake Genie timeout and throttle statuses retry while 422 quarantines only its candidate", async () => {
  const fresh = leadMinerRow({
    status: "new",
    record: {
      ...leadMinerRow().record,
      status: "new",
      source: "build-ready-mine",
      build_ready: {
        proof: { build_hash: "fresh-build-hash" },
        mirror_request: { facts: { current_website: "https://acme-plumbing.example", socials: [] } },
      },
    },
  });

  async function compileFailure(status) {
    let selects = 0;
    return pickProspects(
      { target: "plumbers in Reno NV", count: 1, lane: "sandbox" },
      {
        env: { VERCEL_ENV: "production" },
        certificationKey: KEY,
        select: async () => {
          selects += 1;
          return selects === 1 ? { ok: true, data: [] } : { ok: true, data: [fresh] };
        },
        mineLeads: async () => ({
          ok: true,
          rows: [{ prospect_id: fresh.prospect_id, build_hash: "fresh-build-hash", persistence: "created" }],
          funnel: [],
        }),
        callIntakeGenie: async () => ({ ok: false, status, error: `compiler_http_${status}` }),
        resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
      },
    );
  }

  for (const status of [408, 425, 429]) {
    await assert.rejects(
      compileFailure(status),
      (error) => {
        assert.equal(error?.code, "intake_genie_compile_retryable", `HTTP ${status}`);
        assert.equal(error?.retryable, true, `HTTP ${status}`);
        assert.equal(error?.causeCode, `compiler_http_${status}`, `HTTP ${status}`);
        return true;
      },
    );
  }

  // 422 is the one PROVEN candidate-local verdict: the pick resolves, the
  // candidate is named for durable quarantine, and nothing halts or retries.
  const survivors = await compileFailure(422);
  assert.equal(survivors.length, 0, "HTTP 422 drops only its candidate");
  const stage = (survivors.funnel || []).find((row) => row.stage === "intake_genie_authority_packet");
  assert.deepEqual(stage, {
    stage: "intake_genie_authority_packet",
    entered: 1,
    survived: 0,
    rejected: { compiler_http_422: 1 },
  });
  assert.deepEqual(survivors.quarantined, [{
    prospectId: "acme-1",
    businessName: "Acme Plumbing",
    vertical: "plumbing",
    reason: "intake_genie_candidate_refused: compiler_http_422",
  }]);
});

test("fresh global deterministic Intake Genie failures are terminal and never become candidate drops", async () => {
  const fresh = leadMinerRow({
    status: "new",
    record: {
      ...leadMinerRow().record,
      status: "new",
      source: "build-ready-mine",
      build_ready: {
        proof: { build_hash: "fresh-build-hash" },
        mirror_request: { facts: { current_website: "https://acme-plumbing.example", socials: [] } },
      },
    },
  });

  for (const row of [
    {
      // Auth failures are global: the compiler refused OUR credentials, not
      // this candidate's packet. Dropping candidates would drain supply while
      // the defect is operational.
      name: "HTTP 401",
      compile: () => ({ ok: false, status: 401, error: "compiler_http_401" }),
      cause: "compiler_http_401",
    },
    {
      // Endpoint drift is global: a 404 says the route is wrong for everyone.
      name: "HTTP 404",
      compile: () => ({ ok: false, status: 404, error: "compiler_http_404" }),
      cause: "compiler_http_404",
    },
    {
      // An unknown deterministic 4xx fails CLOSED as global until a narrower
      // contract is proven. Only 422 is candidate-local.
      name: "HTTP 451",
      compile: () => ({ ok: false, status: 451, error: "compiler_http_451" }),
      cause: "compiler_http_451",
    },
    {
      // A successful HTTP transport carrying an explicit provider refusal is
      // a contract failure, not a transient network result.
      name: "HTTP 200 provider refusal",
      compile: () => ({ ok: false, status: 200, error: "compiler_contract_false" }),
      cause: "compiler_contract_false",
    },
    {
      name: "compiler not configured",
      compile: () => ({ ok: false, status: "not_configured", error: "compiler_not_configured" }),
      cause: "compiler_not_configured",
    },
    {
      // Missing compiler response identity is structural, not row-bound. It
      // must still halt instead of draining candidates.
      name: "bad certified packet contract",
      compile: () => compilerResult({ ...canonicalPacket(), request_id: "" }),
      cause: "intake_genie_certification_failed:",
    },
  ]) {
    let selects = 0;
    await assert.rejects(
      pickProspects(
        { target: "plumbers in Reno NV", count: 1, lane: "sandbox" },
        {
          env: { VERCEL_ENV: "production" },
          certificationKey: KEY,
          select: async () => {
            selects += 1;
            return selects === 1 ? { ok: true, data: [] } : { ok: true, data: [fresh] };
          },
          mineLeads: async () => ({
            ok: true,
            rows: [{ prospect_id: fresh.prospect_id, build_hash: "fresh-build-hash", persistence: "created" }],
            funnel: [],
          }),
          callIntakeGenie: async () => row.compile(),
          resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
        },
      ),
      (error) => {
        assert.equal(error?.code, "intake_genie_compile_terminal", row.name);
        assert.equal(error?.retryable, false, row.name);
        assert.match(String(error?.causeCode || ""), new RegExp(row.cause), row.name);
        return true;
      },
    );
  }
});

test("retry reuses durable receipt and packet with zero second compiler call", async () => {
  let compilerCalls = 0;
  let currentRow = leadMinerRow();
  const deps = {
    certificationKey: KEY,
    callIntakeGenie: async () => { compilerCalls += 1; return compilerResult(); },
    conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
      currentRow = { ...currentRow, record: patch.record, updated_at: patch.updated_at };
      return { ok: true, updated: true };
    },
    now: () => "2026-08-24T10:00:00.000Z",
    nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
  };
  const first = await compileGenieContent(currentRow, deps);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.reused, false);
  const second = await compileGenieContent(currentRow, deps);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.reused, true);
  assert.equal(compilerCalls, 1);
});

test("compileGenieContent certifies a category-default estimate as non-publishable content", async () => {
  const estimated = {
    field: "services",
    value: ["Drain cleaning", "Leak repair", "Water heater service"],
    source: "category_default",
    source_type: "category_default",
    source_url: "",
    confidence: 0.45,
    provenance: "estimated",
    verification_status: "estimated",
  };
  const packet = canonicalPacket({
    facts: {
      ...canonicalPacket().facts,
      services_source: "category_default",
      services: estimated.value,
    },
    content: { ...canonicalPacket().content, services: [] },
    evidence: [
      { field: "name", value: "Acme Plumbing", source_url: SOURCE },
      estimated,
    ],
  });
  let savedRecord;
  const result = await compileGenieContent(leadMinerRow(), {
    env: { VERCEL_ENV: "production" },
    certificationKey: KEY,
    callIntakeGenie: async () => compilerResult(packet),
    conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
      savedRecord = patch.record;
      return { ok: true, updated: true };
    },
    now: () => "2026-08-24T10:00:00.000Z",
    nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.certified, true);
  assert.equal(savedRecord.genie_canonical_packet.facts.services_source, "category_default");
  assert.equal(Object.prototype.hasOwnProperty.call(savedRecord.genie_canonical_packet.facts, "services"), false);
  assert.strictEqual(savedRecord.genie_canonical_packet.evidence[1], estimated);
  assert.deepEqual(savedRecord.genie_content_certification.evidence, {
    source_bound: false,
    service_count: 3,
    services_source: "category_default",
    estimated: true,
  });
});

test("production missing receipt key fails before compiler spend or persistence", async () => {
  let compilerCalls = 0;
  let persistenceCalls = 0;
  const result = await compileGenieContent(leadMinerRow(), {
    env: { VERCEL_ENV: "production" },
    callIntakeGenie: async () => { compilerCalls += 1; return compilerResult(); },
    conditionalUpdate: async () => { persistenceCalls += 1; return { ok: true, updated: true }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "intake_genie_certification_key_missing");
  assert.equal(compilerCalls, 0);
  assert.equal(persistenceCalls, 0);
});

test("live delivery hold and sport-fencing hold happen before any compiler call", async () => {
  let calls = 0;
  const live = await pickProspects(
    { target: "leadminer", count: 1, lane: "live" },
    {
      select: async () => ({ ok: true, data: [leadMinerRow({ email: "" })] }),
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
      callIntakeGenie: async () => { calls += 1; return compilerResult(); },
    },
  );
  assert.equal(live.length, 0);
  assert.equal(calls, 0);

  const sportPacket = {
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: false, missing_build_evidence: ["content"] },
    mirror_ready: { business_name: "Duke City Fencing Club", place_id: "ChIJ-sport", services: ["Foil Classes", "Sabre Training"] },
    services: ["Foil Classes", "Sabre Training"],
    industry: "fencing",
    site_text: "Olympic fencing club coaches athletes in foil, epee and sabre classes.",
  };
  const sport = leadMinerRow({
    prospect_id: "sport-1",
    business_name: "Duke City Fencing Club",
    record: { ...leadMinerRow().record, business_name: "Duke City Fencing Club", industry: "fencing", truth_packet: sportPacket },
  });
  const held = await pickProspects(
    { target: "leadminer", count: 1, lane: "sandbox" },
    {
      select: async () => ({ ok: true, data: [sport] }),
      resolveBuildableDonor: () => ({ ok: true, donor: "fence-donor" }),
      callIntakeGenie: async () => { calls += 1; return compilerResult(); },
      conditionalUpdate: async () => ({ ok: true, updated: true }),
    },
  );
  assert.equal(held.length, 1, "policy hold stays visible to the operator");
  assert.equal(held[0].contractIssue, "vertical_mismatch_sport_fencing");
  assert.equal(calls, 0);
});

test("bare genie_build_certified boolean never bypasses content evidence", async () => {
  const row = leadMinerRow({
    record: {
      ...leadMinerRow().record,
      genie_build_certified: true,
      truth_packet: {
        ...leadMinerRow().record.truth_packet,
        mirror_ready: { ...leadMinerRow().record.truth_packet.mirror_ready, services: [] },
        services: [],
      },
    },
  });
  const picked = await pickProspects(
    { target: "leadminer", count: 1, lane: "sandbox" },
    {
      env: { GHOST_AGENCY_GENIE_CERTIFIED_ADMISSION: "0" },
      select: async () => ({ ok: true, data: [row] }),
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
    },
  );
  assert.equal(picked.length, 0);
});
