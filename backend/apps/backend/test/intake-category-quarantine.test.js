"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const {
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


async function pickPair(mutate, options = {}) {
  const rows = ["good", "bad"].map((id) => {
    const row = leadMinerRow();
    row.prospect_id = id;
    row.place_id = `ChIJ-${id}`;
    row.website = `https://${id}-plumbing.example`;
    row.status = "new";
    row.record = { ...row.record, place_id: row.place_id, website: row.website,
      status: "new", source: "build-ready-mine", build_ready: {
        proof: { build_hash: `hash-${id}` },
        mirror_request: { facts: { current_website: row.website, socials: [] } },
      } };
    return row;
  });
  let selects = 0;
  const writes = [];
  const picked = await pickProspects({ target: "plumbers in Reno NV", count: 2, lane: "sandbox" }, {
    env: { VERCEL_ENV: "production" }, certificationKey: KEY,
    select: async () => ({ ok: true, data: ++selects === 1 ? [] : rows }),
    mineLeads: async () => ({ ok: true, rows: rows.map(row => ({ prospect_id: row.prospect_id,
      build_hash: `hash-${row.prospect_id}`, persistence: "created" })), funnel: [] }),
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
    conditionalUpdate: async (_table, _key, id) => { writes.push(id); return { ok: true, updated: true }; },
    callIntakeGenie: async (row) => {
      const result = compilerResult();
      const url = `${row.website}/services`;
      result.packet.request_id = result.request.request_id = result.idempotencyKey = `ghost:${row.prospect_id}:line-genie-certified-v7`;
      result.request.sources.website_url = url;
      result.packet.evidence.forEach(e => { e.source_url = url; e.source_observations = [url]; });
      result.packet.packet2.sources.observations[0].source = url;
      if (row.prospect_id === "bad") mutate(result);
      return result;
    }, ...options,
  });
  return { picked, writes };
}

for (const category of ["authorized", "packet", "both"]) {
  test(`${category} category mismatch quarantines only its candidate and preserves certified sibling`, async () => {
    const { picked, writes } = await pickPair(result => {
      if (category !== "packet") result.packet.content.content_contract.facts.category = "roofing";
      if (category === "authorized") { result.packet.facts.category = "roofing"; result.packet.scope.category = "roofing"; }
      if (category === "packet") result.packet.facts.category = "roofing";
    });
    assert.deepEqual(picked.map(row => row.prospectId), ["good"]);
    assert.equal(picked.quarantined.length, 1);
    assert.equal(picked.quarantined[0].prospectId, "bad");
    assert.match(picked.quarantined[0].reason, /category_mismatch/);
    assert.ok(!writes.includes("bad"), "rejected packet must never be persisted as certified");
    assert.ok(writes.includes("good"), "certified sibling is durably admitted");
  });
}

for (const [name, mutate] of [
  ["request identity", result => { result.packet.request_id = "wrong-request"; }],
  ["schema", result => { result.packet.version = "unknown-v99"; }],
  ["unsafe visitor copy", result => { result.packet.content.content_contract.visitor_copy.safety.pass = false; }],
  ["job identity", result => { result.packet.job_id = ""; }],
]) {
  test(`category mismatch plus ${name} still halts whole pick`, async () => {
    await assert.rejects(pickPair(result => {
      result.packet.facts.category = "roofing";
      mutate(result);
    }), error => {
      assert.equal(error.code, "intake_genie_compile_terminal");
      assert.equal(error.retryable, false);
      return true;
    });
  });
}

for (const status of [401, 403]) {
  test(`HTTP ${status} stays global even with usable siblings`, async () => {
    await assert.rejects(pickPair(result => {
      result.ok = false; result.status = status; result.error = `compiler_http_${status}`;
    }), error => {
      assert.equal(error.code, "intake_genie_compile_terminal");
      assert.equal(error.causeCode, `compiler_http_${status}`);
      return true;
    });
  });
}
