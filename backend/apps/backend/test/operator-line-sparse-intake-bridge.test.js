"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const {
  mineBuildReady,
  rowFromBuildReady,
  templateFitAdmission,
} = require("../lib/lead-miner");
const { compileGenieContent } = require("../lib/line-adapters");
const { sourceUrls } = require("../lib/intake-genie-client");

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";
const WEBSITE = "https://acme-home-services.com/";
const CERTIFICATION_KEY = "operator-line-sparse-intake-bridge-test-key";
const CERTIFIED_AT = "2026-08-29T18:00:00.000Z";

const QUERY = {
  industry: "plumbing",
  location: "Spokane WA",
  textQuery: "plumbing in Spokane WA",
  queryGroup: 0,
};

const PLACE = {
  id: "places/acme-home-services-spokane",
  displayName: { text: "Acme Home Services" },
  formattedAddress: "100 Main Ave, Spokane, WA 99201, USA",
  location: { latitude: 47.6588, longitude: -117.4260 },
  nationalPhoneNumber: "(509) 555-0100",
  websiteUri: WEBSITE,
  businessStatus: "OPERATIONAL",
  primaryType: "plumber",
  types: ["plumber", "point_of_interest"],
  googleMapsUri: "https://maps.google.com/?cid=5090100",
  addressComponents: [
    { types: ["locality"], longText: "Spokane", shortText: "Spokane" },
    { types: ["administrative_area_level_1"], longText: "Washington", shortText: "WA" },
    { types: ["postal_code"], longText: "99201", shortText: "99201" },
  ],
};

// Deliberately carries identity and contact only. There is no trade word,
// service heading, offer catalogue, category, or product claim for the miner
// to reinterpret as website content.
const SPARSE_HTML = `<!doctype html><html><head>
  <title>Acme Home Services | Spokane WA</title>
  <meta name="description" content="Acme Home Services is based in Spokane, Washington.">
</head><body>
  <main><h1>Acme Home Services</h1><p>Locally owned. Call our team today.</p></main>
  <a href="mailto:hello@acme-home-services.com">Email Acme</a>
</body></html>`;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mirrorPass() {
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      build_hash: "sparse-build-hash",
      donor_content_hash: "sparse-donor-hash",
      file_count: 51,
      evidence_sha: "sparse-evidence-sha",
      renderer: "mirror-engine@v1",
      checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
    },
  };
}

function certifiedPracticeContract() {
  const files = {
    "content/home.md": "# Acme Home Services\n\nAcme Home Services serves customers in Spokane.",
  };
  return {
    schema: "CertifiedPracticePacket/v1",
    kind: "certified_practice_packet",
    version: 1,
    facts: { category: "plumbing" },
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

function categoryDefaultCompilerResult(prospect) {
  const requestId = `ghost:${prospect.prospect_id}:line-genie-certified-v7`;
  const sources = sourceUrls(prospect);
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
  return {
    ok: true,
    packet: {
      ok: true,
      version: "intake-genie-v2",
      status: "complete",
      scope: { supported: true, category: "plumbing" },
      job_id: `genie-job-${prospect.prospect_id}`,
      request_id: requestId,
      facts: {
        name: "Acme Home Services",
        city: "Spokane",
        state: "WA",
        category: "plumbing",
        services_source: "category_default",
        services: estimated.value,
      },
      evidence: [
        { field: "name", value: "Acme Home Services", source_url: WEBSITE },
        estimated,
      ],
      content: {
        content_contract: certifiedPracticeContract(),
        services: [],
      },
    },
    request: { request_id: requestId, sources },
    idempotencyKey: requestId,
  };
}

async function withFetchGuard(fetchImpl, run) {
  const originalFetch = global.fetch;
  global.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    global.fetch = originalFetch;
  }
}

test("operator sparse plumber reaches a signed Intake receipt without fabricated source claims", async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    requests.push({ href, method });
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      return json({ success: true, data: [{ url: WEBSITE, title: "Acme Home Services | Spokane WA" }] });
    }
    if (href === WEBSITE && method === "GET") {
      return new Response(SPARSE_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`unmocked network call: ${method} ${href}`);
  };

  const mined = await withFetchGuard(fetchImpl, () => mineBuildReady({
    trigger: "operator_line",
    lane: "sandbox",
    queries: [QUERY],
    candidatesPerQuery: 1,
    env: {
      GOOGLE_PLACES_API_KEY: "",
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "true",
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.acme-home-services.com", priority: 10 }],
    mirrorImpl: async () => mirrorPass(),
  }));

  assert.equal(mined.ok, true, JSON.stringify(mined.rejects));
  assert.equal(mined.records.length, 1, JSON.stringify(mined.funnel));
  assert.deepEqual(requests, [
    { href: FIRECRAWL_SEARCH, method: "POST" },
    { href: WEBSITE, method: "GET" },
  ], "the hermetic source path is exactly website search then the business website");

  const sourceRecord = mined.records[0];
  assert.equal(sourceRecord.identity_provisional, true);
  assert.equal(sourceRecord.provenance.city.class, "provisional");
  assert.equal(sourceRecord.provenance.city.source, "operator_requested_market");
  assert.equal(sourceRecord.mirror_request.facts.current_website, WEBSITE);
  assert.equal(sourceRecord.identity_source, "owner_only_practice_provisional");
  assert.equal(sourceRecord.qualification.template_fit.admittedBy, "operator_requested_provisional");
  assert.equal(sourceRecord.qualification.template_fit.advisory, true);
  assert.equal(sourceRecord.trade_corroboration.provenance_class, "provisional");
  assert.equal(sourceRecord.trade_corroboration.basis, "operator_requested_trade");
  assert.equal(sourceRecord.provenance.industry.method, "operator_requested_provisional");
  assert.equal(Object.hasOwn(sourceRecord.mirror_request, "content"), false,
    "the sparse website must not gain invented content");
  assert.equal(Object.hasOwn(sourceRecord.mirror_request.facts, "category"), false);
  assert.equal(Object.hasOwn(sourceRecord.mirror_request.facts, "primary_category"), false);
  assert.equal(Object.hasOwn(sourceRecord.mirror_request.facts, "services"), false);

  const row = rowFromBuildReady(sourceRecord, QUERY);
  assert.equal(Object.hasOwn(row.record, "services"), false);
  assert.equal(Object.hasOwn(row.record, "primary_services"), false);
  assert.equal(Object.hasOwn(row.record, "category"), false);

  let compilerCalls = 0;
  let compilerInput;
  let persistedRecord;
  const compiled = await compileGenieContent(row, {
    env: { VERCEL_ENV: "production" },
    certificationKey: CERTIFICATION_KEY,
    callIntakeGenie: async (prospect, options) => {
      compilerCalls += 1;
      compilerInput = prospect;
      assert.equal(options.buildPreview, false);
      assert.equal(options.dryRun, true);
      assert.deepEqual(sourceUrls(prospect), { website_url: WEBSITE });
      return categoryDefaultCompilerResult(prospect);
    },
    conditionalUpdate: async (table, key, id, _guards, patch) => {
      assert.equal(table, "ghost_agency_prospects");
      assert.equal(key, "prospect_id");
      assert.equal(id, row.prospect_id);
      persistedRecord = patch.record;
      return { ok: true, updated: true };
    },
    now: () => CERTIFIED_AT,
    nowMs: Date.parse(CERTIFIED_AT) + 60_000,
  });

  assert.equal(compilerCalls, 1);
  assert.equal(Object.hasOwn(compilerInput.record, "services"), false,
    "the requested template may route the row but must not become a service hint");
  assert.equal(Object.hasOwn(compilerInput.record, "primary_services"), false);
  assert.equal(Object.hasOwn(compilerInput.record, "category"), false);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  assert.equal(compiled.certified, true);
  assert.equal(compiled.reused, false);

  const packet = persistedRecord.genie_canonical_packet;
  assert.equal(packet.facts.services_source, "category_default");
  assert.equal(Object.hasOwn(packet.facts, "services"), false,
    "estimated defaults are disclosure metadata, not certified service claims");
  assert.deepEqual(persistedRecord.genie_content_certification.evidence, {
    source_bound: false,
    service_count: 3,
    services_source: "category_default",
    estimated: true,
  });
});

test("explicit Practice electrical routing reaches the sparse Intake boundary as provisional", async () => {
  const electricalQuery = {
    ...QUERY,
    industry: "electrical",
    textQuery: "electrical in Spokane WA",
  };
  const electricalPlace = {
    ...PLACE,
    id: "places/acme-electric-spokane",
    primaryType: "electrician",
    types: ["electrician", "point_of_interest"],
  };
  let searchCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      searchCalls += 1;
      return json({ success: true, data: [{ url: WEBSITE, title: "Acme Home Services | Spokane WA" }] });
    }
    if (href === WEBSITE && method === "GET") {
      return new Response(SPARSE_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`unmocked network call: ${method} ${href}`);
  };

  const mined = await withFetchGuard(fetchImpl, () => mineBuildReady({
    trigger: "operator_line",
    lane: "sandbox",
    queries: [electricalQuery],
    candidatesPerQuery: 1,
    env: {
      GOOGLE_PLACES_API_KEY: "",
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.acme-home-services.com", priority: 10 }],
    mirrorImpl: async () => mirrorPass(),
  }));

  assert.equal(mined.ok, true, JSON.stringify(mined.rejects));
  assert.equal(mined.records.length, 1, JSON.stringify(mined.funnel));
  assert.equal(searchCalls, 1);
  assert.equal(mined.records[0].trade_corroboration.provenance_class, "provisional");
  assert.equal(mined.records[0].trade_corroboration.basis, "operator_requested_trade");
  assert.equal(mined.records[0].provenance.industry.method, "operator_requested_provisional");
  assert.equal(mined.records[0].qualification.template_fit.admittedBy, "operator_requested_provisional");
  assert.equal(Object.hasOwn(mined.records[0].mirror_request.facts, "services"), false);
});

test("explicit Practice salon routing reaches the sparse Intake boundary as provisional", async () => {
  const salonQuery = {
    ...QUERY,
    industry: "hair salon",
    textQuery: "hair salon in Spokane WA",
  };
  const salonPlace = {
    ...PLACE,
    id: "places/acme-salon-spokane",
    primaryType: "beauty_salon",
    types: ["beauty_salon", "point_of_interest"],
  };
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      return json({ success: true, data: [{ url: WEBSITE, title: "Acme Home Services | Spokane WA" }] });
    }
    if (href === WEBSITE && method === "GET") {
      return new Response(SPARSE_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`unmocked network call: ${method} ${href}`);
  };

  const mined = await withFetchGuard(fetchImpl, () => mineBuildReady({
    trigger: "operator_line",
    lane: "sandbox",
    queries: [salonQuery],
    candidatesPerQuery: 1,
    env: {
      GOOGLE_PLACES_API_KEY: "",
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.acme-home-services.com", priority: 10 }],
    mirrorImpl: async () => mirrorPass(),
  }));

  assert.equal(mined.ok, true, JSON.stringify(mined.rejects));
  assert.equal(mined.records.length, 1, JSON.stringify(mined.funnel));
  assert.equal(mined.records[0].trade_corroboration.provenance_class, "provisional");
  assert.equal(mined.records[0].trade_corroboration.basis, "operator_requested_trade");
  assert.equal(mined.records[0].provenance.industry.method, "operator_requested_provisional");
  assert.equal(mined.records[0].qualification.template_fit.admittedBy, "operator_requested_provisional");
  assert.equal(Object.hasOwn(mined.records[0].mirror_request.facts, "services"), false);
});

test("official contractor and real-estate primary types map to their template families", () => {
  for (const row of [
    { targetVertical: "general contractor", placePrimaryType: "general_contractor", family: "construction" },
    { targetVertical: "real estate agent", placePrimaryType: "real_estate_agency", family: "real_estate" },
  ]) {
    const result = templateFitAdmission({
      trigger: "operator_line",
      targetVertical: row.targetVertical,
      businessName: "Acme Home Services",
      ldNodes: [],
      serviceNames: [],
      html: SPARSE_HTML,
      placePrimaryType: row.placePrimaryType,
    });
    assert.equal(result.ok, true, `${row.placePrimaryType}: ${JSON.stringify(result)}`);
    assert.equal(result.targetFamily, row.family);
    assert.equal(result.admittedBy, "google_place_type");
  }
});

test("a mismatched Google primaryType cannot admit the same sparse site", () => {
  const result = templateFitAdmission({
    trigger: "operator_line",
    targetVertical: "plumbing",
    businessName: "Acme Home Services",
    ldNodes: [],
    serviceNames: [],
    html: SPARSE_HTML,
    placePrimaryType: "store",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "template_family_fit_below_threshold");
});

test("exact plumber primaryType cannot override a product-dominant site", () => {
  const result = templateFitAdmission({
    trigger: "operator_line",
    targetVertical: "plumbing",
    businessName: "Acme Supply",
    ldNodes: [{ "@type": ["Store", "Product"] }],
    serviceNames: ["Plumbing Fixtures", "Pipe Repair"],
    html: "<button>Add to cart</button><a href='/checkout'>Checkout</a><p>Browse our product catalog</p>",
    placePrimaryType: "plumber",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "product_dominant_site");
});
