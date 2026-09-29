"use strict";

/**
 * test/services-evidence-certification.test.js
 *
 * Pins the exact packet trace that caused the 2026-08-26 live failure:
 *   intake_genie_certification_failed:verified_service_evidence_missing,services_missing
 *   killing 8 of 11 LeadMiner campaign prospects.
 *
 * Trace: LeadMiner export → intake compile → retainSourceBoundServices →
 *        createContentCertification → receipt.
 *
 * Root cause: when the intake-genie compiler returned services carrying only
 * hint-based evidence (source: "ghost_prospect_hint", no HTTP URL), the
 * retainSourceBoundServices filter dropped ALL services. The LeadMiner truth
 * packet already held source-bound evidence from the prospect's own scraped
 * pages, but that evidence was not being offered to the binding check.
 *
 * Fix: compileGenieContent now supplements the compiler packet's service_evidence
 * with the truth_packet's service evidence before calling retainSourceBoundServices,
 * so that scraped-but-not-recompiled services survive certification.
 *
 * Fix 2: sourceUrls now reads leadminer_mirror_ready.gbp_url so that GBP-sourced
 * service evidence is included in the request source set.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compileGenieContent,
  pickProspects,
} = require("../lib/line-adapters");
const {
  createContentCertification,
  retainSourceBoundServices,
  sourceUrls,
} = require("../lib/intake-genie-client");

const CERT_KEY = "services-evidence-certification-test-key";
const WEBSITE = "https://cedar-creek-plumbing.example";
const GBP_URL = "https://www.google.com/maps?cid=98765";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function leadMinerTruthPacket({ services = [], website = WEBSITE, gbpUrl = "" } = {}) {
  // Mirrors what leadminer-webhook.js buildTruthPacket emits.
  const serviceEvidence = services.map((name) => ({
    field: "services",
    value: name,
    source: `${website}/services`,
    source_url: `${website}/services`,
    verified: true,
    status: "verified",
    confidence: 1,
  }));
  const gbpServiceEvidence = gbpUrl
    ? services.map((name) => ({
        field: "services",
        value: name,
        source: gbpUrl,
        source_url: gbpUrl,
        verified: true,
        status: "verified",
        confidence: 1,
      }))
    : [];
  const allEvidence = serviceEvidence.length > 0 ? serviceEvidence : gbpServiceEvidence;
  return {
    ok: true,
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
    mirror_ready: {
      business_name: "Cedar Creek Plumbing",
      place_id: "ChIJcedar",
      services: services.map((name) => ({ name })),
    },
    service_evidence: allEvidence,
    evidence: allEvidence,
    services,
    industry: "plumbing",
  };
}

function leadMinerRow({
  prospectId = "cedar-1",
  services = ["Drain Cleaning", "Water Heater Repair"],
  website = WEBSITE,
  gbpUrl = "",
  recordExtra = {},
} = {}) {
  const truthPacket = leadMinerTruthPacket({ services, website, gbpUrl });
  return {
    prospect_id: prospectId,
    business_name: "Cedar Creek Plumbing",
    city: "Medford",
    state: "OR",
    email: "owner@cedar-creek-plumbing.example",
    current_website: website || undefined,
    website: website || undefined,
    status: "held",
    updated_at: "2026-08-26T09:00:00.000Z",
    record: {
      status: "held",
      business_name: "Cedar Creek Plumbing",
      city: "Medford",
      state: "OR",
      industry: "plumbing",
      truth_packet: truthPacket,
      truth_packet_source: "leadminer_mirror_ready",
      build_ready: true,
      current_website: website || undefined,
      ...(gbpUrl ? { leadminer_mirror_ready: { gbp_url: gbpUrl } } : {}),
      ...recordExtra,
    },
  };
}

/**
 * Simulates the intake-genie compiler returning ONLY hint-based evidence —
 * the failure mode that dropped services on 2026-08-26. Hint-based evidence
 * has source: "ghost_prospect_hint" (not an HTTP URL), so retainSourceBoundServices
 * would reject it without the truth-packet supplementation.
 */
function hintOnlyCompilerResult(row, options = {}) {
  const requestId = `ghost:${row.prospect_id}:line-genie-certified-v7`;
  const services = ["Drain Cleaning", "Water Heater Repair"];
  const request = {
    request_id: requestId,
    sources: { website_url: row.current_website || row.website || "" },
  };
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: `genie-job-${row.prospect_id}`,
    request_id: requestId,
    facts: {
      name: "Cedar Creek Plumbing",
      city: "Medford",
      state: "OR",
      category: "plumbing",
      services,
    },
    // HINT-ONLY evidence — no HTTP source URL → retainSourceBoundServices drops these
    service_evidence: services.map((name) => ({
      field: "services",
      value: name,
      source: "ghost_prospect_hint",
      verified: true,
      status: "verified",
    })),
    evidence: [
      // Non-service evidence with a real URL keeps evidenceBound=true
      {
        field: "name",
        value: "Cedar Creek Plumbing",
        source_url: `${row.current_website || row.website}/`,
      },
    ],
  };
  return { ok: true, packet, request, idempotencyKey: requestId };
}

/**
 * Compiler that returns fully source-bound service evidence — the success path.
 */
function sourceBoundCompilerResult(row) {
  const requestId = `ghost:${row.prospect_id}:line-genie-certified-v7`;
  const source = `${row.current_website || row.website}/services`;
  const services = ["Drain Cleaning", "Water Heater Repair"];
  const request = {
    request_id: requestId,
    sources: { website_url: row.current_website || row.website || "" },
  };
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: `genie-job-${row.prospect_id}`,
    request_id: requestId,
    facts: {
      name: "Cedar Creek Plumbing",
      city: "Medford",
      state: "OR",
      category: "plumbing",
      services,
    },
    service_evidence: services.map((name) => ({
      field: "services",
      value: name,
      source_url: source,
      verified: true,
      status: "verified",
    })),
    evidence: [
      { field: "name", value: "Cedar Creek Plumbing", source_url: source },
    ],
  };
  return { ok: true, packet, request, idempotencyKey: requestId };
}

// ---------------------------------------------------------------------------
// Trace step 1: retainSourceBoundServices with hint-only compiler evidence
// ---------------------------------------------------------------------------

test("TRACE — hint-only compiler evidence drops all services without truth supplement", () => {
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true },
    facts: { services: ["Drain Cleaning", "Water Heater Repair"] },
    service_evidence: [
      { field: "services", value: "Drain Cleaning", source: "ghost_prospect_hint", verified: true },
      { field: "services", value: "Water Heater Repair", source: "ghost_prospect_hint", verified: true },
    ],
  };
  const retained = retainSourceBoundServices(packet, { website_url: WEBSITE });
  assert.equal(
    Object.prototype.hasOwnProperty.call(retained.facts, "services"),
    false,
    "hint-only services must be dropped — no HTTP source URL",
  );
});

test("TRACE — truth_packet service evidence supplements and rescues the binding", () => {
  const compilerPacket = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true },
    facts: { services: ["Drain Cleaning", "Water Heater Repair"] },
    service_evidence: [
      { field: "services", value: "Drain Cleaning", source: "ghost_prospect_hint", verified: true },
      { field: "services", value: "Water Heater Repair", source: "ghost_prospect_hint", verified: true },
    ],
    evidence: [
      { field: "name", value: "Cedar Creek Plumbing", source_url: `${WEBSITE}/` },
    ],
  };
  const truthServiceEvidence = [
    { field: "services", value: "Drain Cleaning", source_url: `${WEBSITE}/services`, verified: true },
    { field: "services", value: "Water Heater Repair", source_url: `${WEBSITE}/services`, verified: true },
  ];
  // Supplement (as compileGenieContent now does)
  const supplemented = {
    ...compilerPacket,
    service_evidence: [
      ...compilerPacket.service_evidence,
      ...truthServiceEvidence,
    ],
  };
  const retained = retainSourceBoundServices(supplemented, { website_url: WEBSITE });
  assert.deepEqual(
    retained.facts.services,
    ["Drain Cleaning", "Water Heater Repair"],
    "truth-supplemented services must survive retainSourceBoundServices",
  );
  // The hint-only rows are dropped; the truth rows are kept
  const retainedEvidence = Array.isArray(retained.service_evidence) ? retained.service_evidence : [];
  const hasHintRow = retainedEvidence.some((row) => row.source === "ghost_prospect_hint");
  assert.equal(hasHintRow, false, "hint rows must not survive into the certified packet");
  const hasTruthRow = retainedEvidence.some((row) => row.source_url === `${WEBSITE}/services`);
  assert.equal(hasTruthRow, true, "truth evidence rows with matching source URLs must be retained");
});

// ---------------------------------------------------------------------------
// Trace step 2: createContentCertification with supplemented packet
// ---------------------------------------------------------------------------

test("TRACE — supplemented packet certifies successfully end-to-end", () => {
  const requestId = "ghost:cedar-1:line-genie-certified-v7";
  const source = `${WEBSITE}/services`;
  const prospect = {
    prospect_id: "cedar-1",
    business_name: "Cedar Creek Plumbing",
    city: "Medford",
    state: "OR",
    place_id: "ChIJcedar",
    website: WEBSITE,
  };
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: "genie-job-cedar-1",
    request_id: requestId,
    facts: {
      name: "Cedar Creek Plumbing",
      city: "Medford",
      state: "OR",
      category: "plumbing",
      services: ["Drain Cleaning", "Water Heater Repair"],
    },
    // truth-supplemented evidence (after the fix)
    service_evidence: [
      { field: "services", value: "Drain Cleaning", source_url: source, verified: true },
      { field: "services", value: "Water Heater Repair", source_url: source, verified: true },
    ],
    evidence: [
      { field: "name", value: "Cedar Creek Plumbing", source_url: source },
      { field: "services", value: "Drain Cleaning", source_url: source, verified: true },
      { field: "services", value: "Water Heater Repair", source_url: source, verified: true },
    ],
  };
  const retained = retainSourceBoundServices(packet, { website_url: WEBSITE });
  const cert = createContentCertification(retained, prospect, {
    signingKey: CERT_KEY,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId,
    jobId: packet.job_id,
    idempotencyKey: requestId,
    requestSources: { website_url: WEBSITE },
    certifiedAt: "2026-08-26T09:30:00.000Z",
  });
  assert.equal(cert.ok, true,
    `certification must pass for supplemented packet: ${JSON.stringify(cert.reasons || [])}`);
  assert.equal(cert.receipt?.evidence?.service_count, 2);
});

// ---------------------------------------------------------------------------
// Trace step 3: full compileGenieContent path with hint-only compiler
// ---------------------------------------------------------------------------

test("TRACE — compileGenieContent with hint-only compiler rescues LeadMiner services", async () => {
  const row = leadMinerRow();
  let persistedRecord = null;

  const result = await compileGenieContent(row, {
    certificationKey: CERT_KEY,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async (prospect, opts) => hintOnlyCompilerResult(row, opts),
    conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
      persistedRecord = patch.record;
      return { ok: true, updated: true };
    },
  });

  assert.equal(result.ok, true,
    `compileGenieContent must succeed: ${JSON.stringify(result.reason || "")}`);
  assert.equal(result.certified, true, "result must be certified (not reused)");
  assert.equal(result.reused, false);

  const certPkt = persistedRecord?.genie_canonical_packet;
  assert.ok(Array.isArray(certPkt?.facts?.services) && certPkt.facts.services.length > 0,
    `certified packet must carry services: ${JSON.stringify(certPkt?.facts?.services)}`);
  assert.ok(certPkt.facts.services.includes("Drain Cleaning"), "Drain Cleaning must survive");
  assert.ok(certPkt.facts.services.includes("Water Heater Repair"), "Water Heater Repair must survive");

  // The hint rows must not appear in the certified packet
  const certEvidence = [
    ...(Array.isArray(certPkt.service_evidence) ? certPkt.service_evidence : []),
    ...(Array.isArray(certPkt.evidence) ? certPkt.evidence : []),
  ];
  const hasHint = certEvidence.some((row) => row.source === "ghost_prospect_hint");
  assert.equal(hasHint, false, "hint-only evidence must not reach the certified packet");
});

test("TRACE — without truth supplement, hint-only compiler kills the candidate", async () => {
  // Simulate behaviour BEFORE the fix: no truth_packet_source, so supplementation
  // is skipped and hint-only services get dropped.
  const row = leadMinerRow();
  const rowWithoutTruthSource = {
    ...row,
    record: {
      ...row.record,
      truth_packet_source: "non_leadminer_source",  // disables supplementation
    },
  };

  const result = await compileGenieContent(rowWithoutTruthSource, {
    certificationKey: CERT_KEY,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async (prospect, opts) => hintOnlyCompilerResult(row, opts),
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  });

  assert.equal(result.ok, false, "candidate with no truth supplement must fail certification");
  assert.ok(
    String(result.reason || "").includes("services_missing"),
    `failure reason must include services_missing: ${result.reason}`,
  );
});

// ---------------------------------------------------------------------------
// Fix 1: sourceUrls picks up gbp_url from leadminer_mirror_ready
// ---------------------------------------------------------------------------

test("FIX-1 — sourceUrls reads gbp_url from record.leadminer_mirror_ready", () => {
  const prospect = {
    prospect_id: "cedar-2",
    business_name: "Cedar Creek Plumbing",
    // No top-level website — GBP only
    record: {
      leadminer_mirror_ready: { gbp_url: GBP_URL },
    },
  };
  const sources = sourceUrls(prospect);
  assert.equal(sources.gbp_url, GBP_URL,
    "gbp_url from leadminer_mirror_ready must appear in request sources");
});

test("FIX-1 — leadminer_mirror_ready gbp_url does not override explicit record gbp_url", () => {
  const explicit = "https://www.google.com/maps?cid=11111";
  const prospect = {
    prospect_id: "cedar-3",
    gbp_url: explicit,
    record: {
      leadminer_mirror_ready: { gbp_url: GBP_URL },
    },
  };
  const sources = sourceUrls(prospect);
  assert.equal(sources.gbp_url, explicit,
    "an explicit gbp_url must not be overridden by leadminer_mirror_ready");
});

// ---------------------------------------------------------------------------
// Fix 1 + Fix 2 combined: GBP-only prospect certification
// ---------------------------------------------------------------------------

test("TRACE — GBP-only prospect: gbp_url from leadminer_mirror_ready reaches compiler sources", async () => {
  // This test verifies that Fix 1 (sourceUrls reading leadminer_mirror_ready.gbp_url)
  // ensures the GBP URL is included in the request sources sent to the compiler.
  // The GBP-only full certification is gated by other checks (identity anchor,
  // source-prospect match) that require the full prospect contract; this test
  // validates only that the GBP URL reaches the compiler request.
  const gbpRow = leadMinerRow({
    prospectId: "cedar-gbp",
    website: "",  // no website
    gbpUrl: GBP_URL,
  });
  delete gbpRow.current_website;
  delete gbpRow.website;
  delete gbpRow.record.current_website;

  let capturedSources = null;

  // We let compilation fail at certification (expected for a GBP-only row without
  // all identity anchors); we only care that the compiler received the gbp_url.
  await compileGenieContent(gbpRow, {
    certificationKey: CERT_KEY,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async (prospect) => {
      // sourceUrls(prospect) is what the real callIntakeGenie uses to build sources
      capturedSources = sourceUrls(prospect);
      return { ok: false, status: 422, error: "test-stop-at-sources-capture" };
    },
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  });

  assert.ok(
    capturedSources && typeof capturedSources === "object",
    "compiler must have been called with sources",
  );
  assert.equal(
    capturedSources.gbp_url,
    GBP_URL,
    "GBP URL from leadminer_mirror_ready must be passed to the compiler as gbp_url",
  );
});

// ---------------------------------------------------------------------------
// Regression: source-bound compiler evidence still takes precedence
// ---------------------------------------------------------------------------

test("REGRESSION — source-bound compiler evidence still certifies without truth supplement", async () => {
  const row = leadMinerRow();
  let persistedRecord = null;

  const result = await compileGenieContent(row, {
    certificationKey: CERT_KEY,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async (prospect, opts) => sourceBoundCompilerResult(row),
    conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
      persistedRecord = patch.record;
      return { ok: true, updated: true };
    },
  });

  assert.equal(result.ok, true,
    `source-bound compiler result must certify: ${JSON.stringify(result.reason || "")}`);
  assert.equal(result.certified, true);
  const certPkt = persistedRecord?.genie_canonical_packet;
  assert.ok(certPkt?.facts?.services?.includes("Drain Cleaning"));
});

// ---------------------------------------------------------------------------
// pickProspects integration: count:10 with at least 1 finish
// ---------------------------------------------------------------------------

test("INTEGRATION — count:10 pickProspects with hint-only compiler passes and carries services", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => leadMinerRow({ prospectId: `cedar-batch-${i}` }));
  let certifiedCount = 0;

  const picked = await pickProspects(
    { target: "leadminer", count: 10 },
    {
      select: async () => ({ ok: true, data: rows }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      certificationKey: CERT_KEY,
      callIntakeGenie: async (prospect) => hintOnlyCompilerResult({ ...prospect, prospect_id: prospect.prospect_id }),
      conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
        if (patch.record?.genie_canonical_packet?.facts?.services?.length > 0) certifiedCount++;
        return { ok: true, updated: true };
      },
    },
  );

  // At least 1 should be picked (not killed by certification)
  assert.ok(picked.length > 0,
    `at least 1 of 10 LeadMiner candidates must survive certification, got ${picked.length}`);
  assert.ok(certifiedCount > 0,
    `at least 1 candidate must be certified with services, got ${certifiedCount}`);
});
