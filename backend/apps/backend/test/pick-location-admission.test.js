"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const {
  PICK_LOCATION_MISSING,
  pickLocationAdmission,
} = require("../lib/pick-location-admission");
const { pickProspects } = require("../lib/line-adapters");

const KEY = "test-only-intake-genie-content-certification-key";

function certifiedContentContract(category) {
  const body = "# Services\n\nDrain cleaning and water heater repair by a local crew.\n";
  return {
    schema: "CertifiedPracticePacket/v1",
    kind: "certified_practice_packet",
    version: 1,
    builder_instructions: { public: false },
    visitor_copy: {
      kind: "visitor_copy",
      safety: { pass: true, violations: [] },
      files: { "services.md": body },
      file_hashes: { "services.md": createHash("sha256").update(body).digest("hex") },
    },
    facts: { category },
  };
}

function locationRow(n, { city = "", state = "", mirrorReady = {} } = {}) {
  const id = `pick-location-${n}`;
  const website = `https://${id}.example`;
  // Word-numbered names: round-3 pick-name plausibility (main) refuses a
  // business name ending in a bare digit as a serial/truncation artifact, so
  // the fixture keeps digit ids but names the businesses plausibly.
  const name = `Location Plumbing ${["One", "Two", "Three", "Four", "Five", "Six"][n - 1] || `Number ${n}`}`;
  return {
    prospect_id: id,
    business_name: name,
    city,
    state,
    place_id: `ChIJ-${id}`,
    website,
    status: "new",
    email: `owner@${id}.example`,
    updated_at: "2026-08-31T09:00:00.000Z",
    record: {
      status: "new",
      source: "build-ready-mine",
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        source: "leadminer_mirror_ready",
        meta: { source: "leadminer_mirror_ready", build_ready: false, missing_build_evidence: ["content"] },
        mirror_ready: {
          business_name: name,
          place_id: `ChIJ-${id}`,
          logo_url: "",
          services: ["Drain Cleaning", "Water Heater Repair"],
          ...mirrorReady,
        },
        services: ["Drain Cleaning", "Water Heater Repair"],
        industry: "plumbing",
      },
      business_name: name,
      city,
      state,
      place_id: `ChIJ-${id}`,
      website,
      industry: "plumbing",
      build_ready: {
        proof: { build_hash: `fresh-build-${n}` },
        mirror_request: { facts: { current_website: website, socials: [] } },
      },
    },
  };
}

function compilerResultFor(prospect) {
  const id = String(prospect.prospect_id || "");
  const src = `${String(prospect.website || "")}/services`;
  const requestId = `ghost:${id}:line-genie-certified-v7`;
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: `genie-job-${id}`,
    request_id: requestId,
    content: { content_contract: certifiedContentContract("plumbing") },
    sources: {
      observations: [{
        source: src,
        extracted: { exactServices: ["Drain Cleaning", "Water Heater Repair"] },
      }],
    },
    facts: {
      name: String(prospect.business_name || ""),
      city: String(prospect.city || ""),
      state: String(prospect.state || ""),
      category: "plumbing",
      services: ["Drain Cleaning", "Water Heater Repair"],
    },
    evidence: ["Drain Cleaning", "Water Heater Repair"].map((value) => ({
      field: "services",
      value,
      source_url: src,
      provenance: "observed",
      verification_status: "source observation",
      source_observations: [src],
    })),
  };
  return {
    ok: true,
    packet,
    request: { request_id: requestId, sources: { website_url: src } },
    idempotencyKey: requestId,
  };
}

function fixture(rows) {
  const byId = new Map(rows.map((row) => [row.prospect_id, row]));
  const calls = { compiler: [] };
  return {
    calls,
    deps: {
      env: { VERCEL_ENV: "production" },
      certificationKey: KEY,
      select: async (_table, query) => {
        if (String(query).includes("truth_packet_source=eq.leadminer_mirror_ready")) {
          return { ok: true, data: [] };
        }
        if (String(query).includes("prospect_id=in.")) {
          return { ok: true, data: rows };
        }
        return { ok: true, data: [] };
      },
      mineLeads: async () => ({
        ok: true,
        rows: rows.map((row, index) => ({
          prospect_id: row.prospect_id,
          build_hash: `fresh-build-${index + 1}`,
          persistence: "created",
        })),
        funnel: [],
      }),
      callIntakeGenie: async (prospect) => {
        calls.compiler.push({
          prospectId: String(prospect.prospect_id || ""),
          city: String(prospect.city || ""),
          state: String(prospect.state || ""),
        });
        return compilerResultFor(prospect);
      },
      conditionalUpdate: async (_table, _key, id, _guards, patch) => {
        const base = byId.get(String(id)) || {};
        return { ok: true, updated: true, rows: [{ ...base, record: patch.record, updated_at: patch.updated_at }] };
      },
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
      now: () => "2026-08-31T10:00:00.000Z",
      nowMs: Date.parse("2026-08-31T10:05:00.000Z"),
    },
  };
}

test("complete pick location is a strict no-op", () => {
  const row = locationRow(1, {
    city: "Portland",
    state: "OR",
    mirrorReady: { service_area: "Serving Seattle, WA" },
  });
  const admitted = pickLocationAdmission(row);
  assert.equal(admitted.ok, true);
  assert.equal(admitted.filled, false);
  assert.equal(admitted.row, row, "already-complete picks must not be rewritten or reinterpreted");
  assert.equal(admitted.row.city, "Portland");
  assert.equal(admitted.row.state, "OR");
});

test("an unambiguous carried service area can fill location, but broad marketing copy cannot", () => {
  const admitted = pickLocationAdmission(locationRow(1, {
    mirrorReady: { service_area: "Serving Portland, OR and surrounding communities" },
  }));
  assert.equal(admitted.ok, true);
  assert.equal(admitted.row.city, "Portland");
  assert.equal(admitted.row.state, "OR");

  const refused = pickLocationAdmission(locationRow(2, {
    mirrorReady: { service_area: "Serving Portland and surrounding communities" },
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, PICK_LOCATION_MISSING);
});

test("conflicting carried location evidence refuses instead of choosing a winner", () => {
  const refused = pickLocationAdmission(locationRow(1, {
    mirrorReady: {
      formatted_address: "100 Main St, Portland, OR 97205",
      service_area: "Serving Seattle, WA",
    },
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, PICK_LOCATION_MISSING);
});

test("pick admission fills explicit packet evidence, refuses unresolved location before compile, fills a missing state, and leaves full locations unchanged", async () => {
  const rows = [
    locationRow(1, {
      mirrorReady: {
        addressComponents: [
          { types: ["locality", "political"], longText: "Portland", shortText: "Portland" },
          { types: ["administrative_area_level_1", "political"], longText: "Oregon", shortText: "OR" },
        ],
      },
    }),
    // The campaign target itself says Portland OR and the hostname contains
    // "location"; neither is evidence. With no packet locality this row MUST
    // refuse rather than borrow or guess a location.
    locationRow(2, {
      mirrorReady: { service_area: "Serving customers throughout the region" },
    }),
    locationRow(3, {
      city: "Portland",
      mirrorReady: { formatted_address: "200 Oak St, Portland, OR 97205" },
    }),
    locationRow(4, { city: "Portland", state: "OR" }),
  ];
  const { deps, calls } = fixture(rows);

  const picked = await pickProspects({
    target: "plumbers in Portland OR",
    count: 4,
    lane: "sandbox",
  }, deps);

  assert.deepEqual(
    picked.map((line) => [line.prospectId, line.city, line.state]).sort(),
    [
      ["pick-location-1", "Portland", "OR"],
      ["pick-location-3", "Portland", "OR"],
      ["pick-location-4", "Portland", "OR"],
    ],
  );
  assert.deepEqual(
    calls.compiler.sort((a, b) => a.prospectId.localeCompare(b.prospectId)),
    [
      { prospectId: "pick-location-1", city: "Portland", state: "OR" },
      { prospectId: "pick-location-3", city: "Portland", state: "OR" },
      { prospectId: "pick-location-4", city: "Portland", state: "OR" },
    ],
    "the unresolved candidate never burns an Intake Genie compile slot",
  );
  assert.deepEqual(picked.quarantined, [
    {
      prospectId: "pick-location-2",
      businessName: "Location Plumbing Two",
      vertical: "plumbing",
      reason: PICK_LOCATION_MISSING,
    },
  ]);
  assert.equal(PICK_LOCATION_MISSING, "pick_location_missing");
});
