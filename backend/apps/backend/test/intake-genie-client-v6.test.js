"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PIPELINE_VERSION,
  answerCrewProfileFromCanonical,
  callIntakeGenie,
  createContentCertification,
  prospectRequest,
  retainSourceBoundServices,
  sourceBoundServiceEvidenceUrl,
  truthPacketFromCanonical,
  verifyContentCertification,
} = require("../lib/intake-genie-client");

const PROSPECT = {
  prospect_id: "genie-v6-1",
  business_name: "Acme Roofing",
  city: "Reno",
  state: "NV",
  vertical: "roofing",
  website: "https://acme-roofing.example",
};

test("vertical-only prospects send both v7 category spellings to the compiler", () => {
  const request = prospectRequest(PROSPECT, { pipelineVersion: PIPELINE_VERSION });

  assert.equal(request.request_id, "ghost:genie-v6-1:line-genie-certified-v7");
  assert.equal(request.category, "roofing");
  assert.equal(request.vertical, "roofing");
  // Fresh candidates carry no identity hints: the compiler binds identity
  // from the business's own website (hint-vs-site literal comparisons
  // refused legitimate short brands).
  assert.equal(request.prospect_hints, undefined);
  assert.match(request.description, /roofing/);
  assert.match(request.description, /Acme Roofing/);
});
test("the HTTP seam cache-busts stale v5 and v6 calls and preserves structured refusal problems", async (t) => {
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

  const problems = [{
    code: "business_name_mismatch",
    field: "name",
    expected: "Acme Roofing",
    actual: "Acme Plumbing",
    compared: { candidate: "Acme Roofing", compiled: "Acme Plumbing" },
  }];
  const sent = [];
  global.fetch = async (url, options) => {
    sent.push({ url, options });
    return {
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ ok: false, status: "refused", problems }),
    };
  };

  for (const staleVersion of ["line-genie-certified-v5", "line-genie-certified-v6"]) {
    const result = await callIntakeGenie(PROSPECT, {
      pipelineVersion: staleVersion,
      buildPreview: false,
      dryRun: true,
    });
    const request = sent.at(-1);
    const payload = JSON.parse(request.options.body);

    assert.equal(payload.request_id, "ghost:genie-v6-1:line-genie-certified-v7", staleVersion);
    assert.equal(request.options.headers["Idempotency-Key"], payload.request_id, staleVersion);
    assert.equal(payload.category, "roofing");
    assert.equal(payload.vertical, "roofing");
    assert.deepEqual(result.problems, problems);
    assert.deepEqual(result.packet.problems, problems);
    assert.match(result.error, /business_name_mismatch/);
    assert.match(result.error, /Acme Plumbing/);
  }
});

test("category-default estimates certify without becoming unsigned truth or AnswerCrew claims", () => {
  const estimated = {
    field: "services",
    value: ["Roof inspections", "Roof replacement"],
    source: "category_default",
    source_type: "category_default",
    provenance: "estimated",
    verification_status: "estimated",
    confidence: 0.45,
    source_url: "",
  };
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "compiled",
    scope: { supported: true, category: "roofing" },
    request_id: "ghost:genie-v6-1:line-genie-certified-v7",
    job_id: "genie-v6-job",
    facts: {
      name: PROSPECT.business_name,
      city: PROSPECT.city,
      state: PROSPECT.state,
      category: "roofing",
      services_source: "category_default",
      services: ["Roof inspections", "Roof replacement"],
    },
    content: { services: [] },
    evidence: [
      { field: "name", value: PROSPECT.business_name, source_url: `${PROSPECT.website}/about` },
      estimated,
    ],
  };

  const retained = retainSourceBoundServices(packet, { website_url: PROSPECT.website });

  assert.equal(retained.facts.services_source, "category_default");
  assert.equal(Object.prototype.hasOwnProperty.call(retained.facts, "services"), false);
  assert.strictEqual(retained.evidence[1], estimated, "estimated disclosure must remain byte-for-byte intact");
  assert.equal(
    sourceBoundServiceEvidenceUrl(retained, "Roof inspections", { website_url: PROSPECT.website }),
    "",
  );

  const certification = createContentCertification(retained, PROSPECT, {
    signingKey: "genie-v6-certification-key",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.request_id,
    requestSources: { website_url: PROSPECT.website },
  });
  assert.equal(certification.ok, true, JSON.stringify(certification));
  assert.deepEqual(certification.receipt.evidence, {
    source_bound: false,
    service_count: 2,
    services_source: "category_default",
    estimated: true,
  });
  assert.equal(verifyContentCertification(certification.receipt, retained, PROSPECT, {
    signingKey: "genie-v6-certification-key",
    requestSources: { website_url: PROSPECT.website },
    idempotencyKey: packet.request_id,
  }).ok, true);

  for (const candidate of [packet, retained]) {
    assert.deepEqual(answerCrewProfileFromCanonical(candidate).services, []);
    const truth = truthPacketFromCanonical(candidate);
    assert.deepEqual(truth.services, []);
    assert.equal(truth.localSearchPlan.contentPlan.servicePages, 0);
  }
});

test("Ghost accepts token-safe normalized containment without confusing two Acme trades", () => {
  const source = PROSPECT.website;
  const certify = (candidate, compiled, facts = {}) => createContentCertification({
    ok: true,
    version: "intake-genie-v2",
    status: "compiled",
    scope: { supported: true, category: "roofing" },
    request_id: `ghost:genie-v6-1:${candidate}`,
    job_id: `job:${candidate}`,
    facts: {
      name: compiled,
      city: "Dallas",
      state: "T.X.",
      category: "roofing",
      services: ["Roof repair"],
      ...facts,
    },
    evidence: [
      { field: "name", value: compiled, source_url: `${source}/about` },
      { field: "services", value: "Roof repair", source_url: `${source}/services` },
    ],
  }, {
    ...PROSPECT,
    business_name: candidate,
    city: "Dallas",
    state: "TX",
  }, {
    signingKey: "genie-v6-certification-key",
    requestId: `ghost:genie-v6-1:${candidate}`,
    jobId: `job:${candidate}`,
    idempotencyKey: `ghost:genie-v6-1:${candidate}`,
    requestSources: { website_url: source },
  });

  for (const [candidate, compiled] of [
    ["Acme", "Acme Roofing"],
    ["ACME Roofing, L.L.C.", "Acme Roofing"],
    ["José's Roofing, Inc.", "Joses Roofing"],
    ["Acme Roofing — Dallas, Texas", "Acme Roofing"],
    ["Acme Roofing & Exteriors", "Acme Roofing"],
    ["Elite Concrete Contractors of Dallas", "Elite Concrete Contractors"],
    ["Island Breeze AC", "Island Breeze Air Conditioning & Heating"],
    ["A-1 Roofing", "A1 Roofing"],
    ["C.A.R.S. Plumbing Services", "CARS Plumbing"],
  ]) {
    const result = certify(candidate, compiled);
    assert.equal(result.ok, true, `${candidate} -> ${compiled}: ${JSON.stringify(result)}`);
  }

  for (const [candidate, compiled] of [
    ["Acme Roofing", "Acme Plumbing"],
    ["AC Roofing", "AC Plumbing"],
    ["North Star Roofing", "South Star Roofing"],
  ]) {
    const result = certify(candidate, compiled);
    assert.equal(result.ok, false, `${candidate} must not match ${compiled}`);
    assert.ok(result.reasons.includes("business_name_mismatch"));
  }
});

test("present wrong-domain service claims cannot be laundered through category defaults", () => {
  const wrongDomain = "https://other-business.example/services";
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "compiled",
    scope: { supported: true, category: "roofing" },
    request_id: "ghost:genie-v6-1:line-genie-certified-v7",
    job_id: "genie-v6-wrong-domain",
    facts: {
      name: PROSPECT.business_name,
      city: PROSPECT.city,
      state: PROSPECT.state,
      category: "roofing",
      services_source: "category_default",
      services: ["Roof inspections"],
    },
    content: { services: ["Unverified storm repair"] },
    evidence: [
      { field: "name", value: PROSPECT.business_name, source_url: `${PROSPECT.website}/about` },
      {
        field: "services",
        value: "Unverified storm repair",
        source_url: wrongDomain,
        verified: false,
        status: "unverified",
      },
      {
        field: "services",
        value: ["Roof inspections"],
        source: "category_default",
        source_type: "category_default",
        provenance: "estimated",
        verification_status: "estimated",
      },
    ],
  };

  const retained = retainSourceBoundServices(packet, { website_url: PROSPECT.website });
  assert.equal(retained.facts.services_default_disqualified, true);
  assert.equal(Object.prototype.hasOwnProperty.call(retained.content, "services"), false);
  const certification = createContentCertification(retained, PROSPECT, {
    signingKey: "genie-v6-certification-key",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.request_id,
    requestSources: { website_url: PROSPECT.website },
  });
  assert.equal(certification.ok, false, JSON.stringify(certification));
  assert.ok(certification.reasons.includes("verified_service_evidence_missing"));
  assert.ok(certification.reasons.includes("services_missing"));
});
