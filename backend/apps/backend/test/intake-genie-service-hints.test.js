"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  callIntakeGenie,
  createContentCertification,
  prospectRequest,
  retainSourceBoundServices,
  verifyContentCertification,
} = require("../lib/intake-genie-client");
const { compileGenieContent } = require("../lib/line-adapters");

function certifiedPracticeContract(category = "plumbing") {
  const files = {
    "content/home.md": "# Service Hints Plumbing\n\nService Hints Plumbing offers plumbing services in Reno.",
  };
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
      file_hashes: Object.fromEntries(Object.entries(files).map(([file, body]) => [
        file,
        createHash("sha256").update(body).digest("hex"),
      ])),
      safety: { pass: true, violations: [] },
    },
  };
}

function prospectWithServices(services) {
  return {
    prospect_id: "service-hints-1",
    business_name: "Service Hints Plumbing",
    city: "Reno",
    state: "NV",
    industry: "plumbing",
    website: "https://service-hints.example",
    record: {
      build_ready: {
        mirror_request: {
          content: { services },
        },
      },
    },
  };
}

test("immutable mirror services become normalized, deduped, stable Intake Genie hints", () => {
  const prospect = prospectWithServices([
    "  Drain   Cleaning  ",
    { name: "Water Heater Repair" },
    { title: "Leak Detection" },
    "drain cleaning",
    { name: "   " },
    null,
    42,
  ]);
  const before = structuredClone(prospect);

  const first = prospectRequest(prospect, { pipelineVersion: "line-genie-certified-v2" });
  const second = prospectRequest(prospect, { pipelineVersion: "line-genie-certified-v2" });

  assert.deepEqual(first.prospect_hints.services, [
    "Drain Cleaning",
    "Water Heater Repair",
    "Leak Detection",
  ]);
  assert.deepEqual(second.prospect_hints.services, first.prospect_hints.services);
  assert.equal(first.request_id, "ghost:service-hints-1:line-genie-certified-v2");
  assert.deepEqual(prospect, before, "request construction must not mutate the immutable build contract");
});

test("untrusted service-shaped fields cannot inject Intake Genie hints", () => {
  const request = prospectRequest({
    prospect_id: "untrusted-services-1",
    services: ["Top-level injection"],
    prospect_hints: { services: ["Caller injection"] },
    build_ready: { mirror_request: { content: { services: ["Wrong level"] } } },
    record: {
      services: ["Record injection"],
      mirror_request: { content: { services: ["Mutable request injection"] } },
      truth_packet: { services: ["Packet injection"] },
      build_ready: { mirror_request: { content: { services: "not-an-immutable-array" } } },
    },
  });

  assert.equal(Object.prototype.hasOwnProperty.call(request.prospect_hints, "services"), false);
});

test("mixed Intake services retain only exact source-bound entries across every canonical path", () => {
  const website = "https://service-hints.example";
  const packet = {
    facts: {
      services: ["Drain Cleaning", "Broad Plumbing Guess"],
      service_list: ["Water Heater Repair", "Suggested Upgrade"],
    },
    services: [{ name: "Drain Cleaning" }, { name: "Invented Expansion" }],
    primary_services: ["Water Heater Repair", "Generic Plumbing"],
    primaryServices: ["Drain Cleaning", "Recommended Service"],
    content: { services: [{ title: "Water Heater Repair" }, { title: "Generic Service" }] },
    evidence: [
      {
        field: "services",
        value: ["Drain Cleaning", "Water Heater Repair"],
        source_url: `${website}/services`,
      },
      {
        field: "services",
        value: "Broad Plumbing Guess",
        source: "ghost_prospect_hint",
        verified: true,
        status: "verified",
      },
      { field: "service_area", value: "Bozeman", source_url: `${website}/areas` },
    ],
  };
  const before = structuredClone(packet);
  const retained = retainSourceBoundServices(packet, { website_url: website });

  assert.deepEqual(retained.facts.services, ["Drain Cleaning"]);
  assert.deepEqual(retained.facts.service_list, ["Water Heater Repair"]);
  assert.deepEqual(retained.services, [{ name: "Drain Cleaning" }]);
  assert.deepEqual(retained.primary_services, ["Water Heater Repair"]);
  assert.deepEqual(retained.primaryServices, ["Drain Cleaning"]);
  assert.deepEqual(retained.content.services, [{ title: "Water Heater Repair" }]);
  assert.equal(retained.evidence.some((row) => row.value === "Broad Plumbing Guess"), false);
  assert.equal(retained.evidence.some((row) => row.field === "service_area"), true);
  assert.deepEqual(packet, before, "the compiler response remains immutable");
});

test("service-like evidence fields cannot certify an offered service", () => {
  for (const field of ["service_area", "customer_service", "services_not_offered", "recommended_services"]) {
    const packet = {
      facts: { services: ["Drain Cleaning"] },
      evidence: [{ field, value: "Drain Cleaning", source_url: "https://service-hints.example/services" }],
    };
    const retained = retainSourceBoundServices(packet, { website_url: "https://service-hints.example" });
    assert.equal(Object.prototype.hasOwnProperty.call(retained.facts, "services"), false, field);
  }
});

test("an empty preferred service path is removed so a later bound alias remains canonical", () => {
  const website = "https://service-hints.example";
  const packet = {
    facts: { services: [] },
    primary_services: ["Drain Cleaning"],
    evidence: [{ field: "services", value: "Drain Cleaning", source_url: `${website}/services` }],
  };

  const retained = retainSourceBoundServices(packet, { website_url: website });

  assert.equal(Object.prototype.hasOwnProperty.call(retained.facts, "services"), false);
  assert.deepEqual(retained.primary_services, ["Drain Cleaning"]);
});

test("a service evidence row carrying any foreign HTTPS source is rejected", () => {
  const website = "https://service-hints.example";
  const packet = {
    facts: { services: ["Drain Cleaning"] },
    evidence: [{
      field: "services",
      value: "Drain Cleaning",
      source_url: "https://foreign.example/services",
      source: { url: `${website}/services` },
    }],
  };

  const retained = retainSourceBoundServices(packet, { website_url: website });

  assert.equal(Object.prototype.hasOwnProperty.call(retained.facts, "services"), false);
  assert.deepEqual(retained.evidence, []);
});

test("fully bound service packets are returned unchanged", () => {
  const packet = {
    facts: { services: ["Drain Cleaning"] },
    evidence: [{ field: "services", value: "Drain Cleaning", source_url: "https://service-hints.example/services" }],
  };

  assert.equal(
    retainSourceBoundServices(packet, { website_url: "https://service-hints.example" }),
    packet,
  );
});

test("HTTP first-party service citations stay bound through certification", () => {
  const website = "http://www.affordableplumbingjacksonville.com/";
  const prospect = {
    prospect_id: "affordable-http-services",
    business_name: "Affordable Plumbing",
    city: "Jacksonville",
    state: "FL",
    industry: "plumbing",
    website,
  };
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: "genie-affordable-http-services",
    request_id: "ghost:affordable-http-services:line-genie-certified-v5",
    facts: {
      name: prospect.business_name,
      city: prospect.city,
      state: prospect.state,
      category: prospect.industry,
      services: ["Emergency Plumbing"],
    },
    evidence: [{
      field: "services",
      value: "Emergency Plumbing",
      source_url: website,
      verified: true,
      status: "verified",
    }],
    content: { content_contract: certifiedPracticeContract() },
  };

  const retained = retainSourceBoundServices(packet, { website_url: website });
  const certification = createContentCertification(retained, prospect, {
    signingKey: "affordable-http-certification-key",
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.request_id,
    requestSources: { website_url: website },
  });

  assert.strictEqual(retained, packet);
  assert.deepEqual(retained.facts.services, ["Emergency Plumbing"]);
  assert.equal(certification.ok, true, JSON.stringify(certification));
});

test("own-site HTTP CTA labels cannot certify as services", () => {
  const website = "http://mark.wixsite.com/alice/";
  const prospect = {
    prospect_id: "http-cta-service",
    business_name: "Alice Plumbing",
    city: "Reno",
    state: "NV",
    industry: "plumbing",
    website,
  };
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: "genie-http-cta-service",
    request_id: "ghost:http-cta-service:line-genie-certified-v5",
    facts: {
      name: prospect.business_name,
      city: prospect.city,
      state: prospect.state,
      category: prospect.industry,
      services: ["Contact Us"],
    },
    evidence: [{
      field: "services",
      value: "Contact Us",
      source_url: `${website}services`,
      verified: true,
      status: "verified",
    }],
  };
  const sources = { website_url: website };
  const retained = retainSourceBoundServices(packet, sources);
  const certification = createContentCertification(retained, prospect, {
    signingKey: "http-cta-certification-key",
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.request_id,
    requestSources: sources,
  });

  assert.equal(Object.prototype.hasOwnProperty.call(retained.facts, "services"), false);
  assert.deepEqual(retained.evidence, []);
  assert.equal(certification.ok, false);
  assert.ok(certification.reasons.includes("verified_service_evidence_missing"));
  assert.ok(certification.reasons.includes("services_missing"));
});

test("all-unbound services remain a deterministic certification refusal", () => {
  const prospect = prospectWithServices(undefined);
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: "genie-job-service-hints-1",
    request_id: "ghost:service-hints-1:line-genie-certified-v2",
    facts: {
      name: prospect.business_name,
      city: prospect.city,
      state: prospect.state,
      category: prospect.industry,
      services: ["Unsupported Service"],
    },
    evidence: [{ field: "name", value: prospect.business_name, source_url: prospect.website }],
  };
  const sources = { website_url: prospect.website };
  const retained = retainSourceBoundServices(packet, sources);
  const certification = createContentCertification(retained, prospect, {
    signingKey: "service-hints-certification-key",
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.request_id,
    requestSources: sources,
  });

  assert.equal(Object.prototype.hasOwnProperty.call(retained.facts, "services"), false);
  assert.equal(certification.ok, false);
  assert.ok(certification.reasons.includes("verified_service_evidence_missing"));
  assert.ok(certification.reasons.includes("services_missing"));
});

test("Line admission requests the current v7 compiler contract", async () => {
  let compileOptions;
  const result = await compileGenieContent(prospectWithServices(["Drain Cleaning"]), {
    certificationKey: "test-certification-key",
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async (_prospect, options) => {
      compileOptions = options;
      return { ok: false, status: 422, error: "expected-test-stop" };
    },
  });

  assert.equal(compileOptions.pipelineVersion, "line-genie-certified-v7");
  assert.equal(result.ok, false);
  assert.equal(result.candidateLocal, true);
});

test("Line's v3 retry sends the corrected payload under a fresh idempotency key", async (t) => {
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env.INTAKE_GENIE_BASE_URL;
  const originalToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.INTAKE_GENIE_BASE_URL = "https://intake.example";
  process.env.INTAKE_GENIE_TOKEN = "test-token";
  t.after(() => {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.INTAKE_GENIE_BASE_URL;
    else process.env.INTAKE_GENIE_BASE_URL = originalBaseUrl;
    if (originalToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalToken;
  });

  let sent;
  global.fetch = async (url, options) => {
    sent = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, version: "intake-genie-v2" }),
    };
  };

  const result = await callIntakeGenie(
    prospectWithServices(["Drain Cleaning"]),
    { pipelineVersion: "line-genie-certified-v3", buildPreview: false, dryRun: true },
  );
  const payload = JSON.parse(sent.options.body);

  assert.equal(result.ok, true);
  assert.equal(sent.url, "https://intake.example/api/intake-genie/compile");
  assert.equal(payload.request_id, "ghost:service-hints-1:line-genie-certified-v3");
  assert.equal(sent.options.headers["Idempotency-Key"], payload.request_id);
  assert.deepEqual(payload.prospect_hints.services, ["Drain Cleaning"]);
});

test("runtime-shaped v2 service evidence certifies, persists, and reuses only with immutable hints", async () => {
  const certificationKey = "service-hints-certification-key";
  let compilerCalls = 0;
  let persistedRecord;
  let rawPacket;
  const compileFromHints = async (prospect, options) => {
    compilerCalls += 1;
    const request = prospectRequest(prospect, options);
    const services = request.prospect_hints.services
      ? [...request.prospect_hints.services, "Broad Plumbing Guess"]
      : ["Unsupported Service"];
    rawPacket = {
      ok: true,
      version: "intake-genie-v2",
      status: "complete",
      scope: { supported: true, category: "plumbing" },
      job_id: `genie-job-${prospect.prospect_id}`,
      request_id: request.request_id,
      facts: {
        name: prospect.business_name,
        city: prospect.city,
        state: prospect.state,
        category: prospect.industry,
        services,
      },
      evidence: [
        ...(request.prospect_hints.services
          ? request.prospect_hints.services.map((service) => ({
            field: "services",
            value: service,
            source_url: prospect.website,
            source_observations: [prospect.website],
            provenance: "observed",
            verification_status: "source_observation",
          }))
          : []),
        { field: "services", value: "Broad Plumbing Guess", source: "ghost_prospect_hint", verified: true, status: "verified" },
      ],
      content: { content_contract: certifiedPracticeContract() },
      packet2: {
        sources: {
          observations: [{
            source: prospect.website,
            extracted: { exactServices: request.prospect_hints.services || [] },
          }],
        },
      },
    };
    return {
      ok: true,
      request,
      idempotencyKey: request.request_id,
      packet: rawPacket,
    };
  };
  const row = prospectWithServices(["Drain Cleaning", { name: "Water Heater Repair" }]);
  const compiled = await compileGenieContent(row, {
    certificationKey,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: compileFromHints,
    conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
      persistedRecord = patch.record;
      return { ok: true, updated: true };
    },
  });

  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  assert.equal(compiled.certified, true);
  assert.equal(compiled.reused, false);
  assert.deepEqual(persistedRecord.genie_canonical_packet.facts.services, [
    "Drain Cleaning",
    "Water Heater Repair",
  ]);
  assert.deepEqual(
    persistedRecord.truth_packet.intakeGenie,
    persistedRecord.genie_canonical_packet,
  );
  assert.equal(
    persistedRecord.genie_canonical_packet.evidence.some((row) => row.value === "Broad Plumbing Guess"),
    false,
  );
  assert.equal(verifyContentCertification(
    persistedRecord.genie_content_certification,
    rawPacket,
    compiled.row,
    {
      signingKey: certificationKey,
      requestSources: persistedRecord.genie_compile_sources,
      idempotencyKey: persistedRecord.genie_compile_idempotency_key,
    },
  ).reason, "receipt_packet_mismatch");

  const reused = await compileGenieContent(compiled.row, {
    certificationKey,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async () => { throw new Error("certified packet must be reused"); },
  });
  assert.equal(reused.ok, true);
  assert.equal(reused.reused, true);
  assert.equal(compilerCalls, 1);

  const withoutImmutableHints = prospectWithServices(undefined);
  let rejectedWrites = 0;
  const rejected = await compileGenieContent(withoutImmutableHints, {
    certificationKey,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: compileFromHints,
    conditionalUpdate: async () => {
      rejectedWrites += 1;
      return { ok: true, updated: true };
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.retryable, false);
  assert.equal(rejected.candidateLocal, true);
  assert.equal(rejectedWrites, 0);
  assert.match(rejected.reason, /verified_service_evidence_missing/);
});
