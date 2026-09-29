"use strict";

// Campaign speed (2026-09-02): same-pass candidate rotation on retryable
// compile timeouts. Batch line_mtkw4rlq_c830312fdd burned minutes per
// rotation because ONE client-side `intake_genie_timeout` discarded every
// certified sibling, released the phase, and paid the 60s retry floor before
// re-mining the same slow source. These tests pin the new contract:
//
//   - a timeout-class compile casualty with certified siblings drops ONLY
//     that candidate for the pass (transient — no durable quarantine), the
//     siblings ride out, and the timeout census rides out on the array so
//     the durable quota controller can mark the source slow;
//   - a pass starved by timeout-class failures throws
//     `intake_genie_compile_retryable` carrying the timeout census
//     (compileTimeoutCount/compileSourceTarget) for immediate rotation;
//   - a non-timeout transient (429) keeps the retry class WITHOUT
//     timeout-census metadata (the 60s floor is service health);
//   - a global terminal compile failure still halts the whole pick;
//   - the compile pool honors INTAKE_GENIE_COMPILE_CONCURRENCY on the
//     packet-shelf lane too (bounded lanes, not an unbounded Promise.all).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { pickProspects } = require("../lib/line-adapters");
const { poolSize } = require("../lib/intake-pool");

const KEY = "test-only-intake-genie-content-certification-key";
const PIPELINE = "line-genie-certified-v7";
const CLIENT_TIMEOUT_RESULT = { ok: false, status: "failed", error: "intake_genie_timeout" };

function shelfRow({ prospect_id: id, business_name: name }) {
  const website = `https://${id}.example`;
  return {
    prospect_id: id,
    business_name: name,
    city: "Reno",
    state: "NV",
    place_id: `ChIJ-${id}`,
    website,
    status: "held",
    email: `owner@${id}.example`,
    updated_at: "2026-08-24T09:00:00.000Z",
    record: {
      status: "held",
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        source: "leadminer_mirror_ready",
        meta: { source: "leadminer_mirror_ready", build_ready: false, missing_build_evidence: ["content"] },
        mirror_ready: {
          business_name: name,
          place_id: `ChIJ-${id}`,
          logo_url: "",
          services: ["Drain Cleaning", "Water Heater Repair"],
        },
        services: ["Drain Cleaning", "Water Heater Repair"],
        industry: "plumbing",
      },
      business_name: name,
      city: "Reno",
      state: "NV",
      place_id: `ChIJ-${id}`,
      website,
      industry: "plumbing",
    },
  };
}

function freshRow({ prospect_id: id, business_name: name }, index) {
  const shelf = shelfRow({ prospect_id: id, business_name: name });
  return {
    ...shelf,
    status: "new",
    record: {
      ...shelf.record,
      status: "new",
      source: "build-ready-mine",
      build_ready: {
        proof: { build_hash: `fresh-build-${id}` },
        mirror_request: { facts: { current_website: shelf.website, socials: [] } },
      },
    },
    __index: index,
  };
}

function compilerResultFor(row) {
  const id = String(row.prospect_id || "");
  const name = String(row.business_name || "");
  const source = `${String(row.website || "")}/services`;
  const requestId = `ghost:${id}:${PIPELINE}`;
  const files = {
    "content/home.md": `# ${name}\n\n${name} offers source-backed plumbing services for customers in Reno.`,
    "content/services/drain-cleaning.md": `# Drain Cleaning\n\nAsk ${name} about drain cleaning for your property in Reno.`,
  };
  return {
    ok: true,
    packet: {
      ok: true,
      version: "intake-genie-v2",
      status: "complete",
      scope: { supported: true, category: "plumbing" },
      job_id: `genie-job-${id}`,
      request_id: requestId,
      facts: {
        name,
        city: "Reno",
        state: "NV",
        category: "plumbing",
        services: ["Drain Cleaning", "Water Heater Repair"],
      },
      evidence: ["Drain Cleaning", "Water Heater Repair"].map((service) => ({
        field: "services",
        value: service,
        source_url: source,
        source_observations: [source],
        provenance: "observed",
        verification_status: "source_observation",
      })),
      packet2: {
        sources: {
          observations: [{
            source,
            extracted: { exactServices: ["Drain Cleaning", "Water Heater Repair"] },
          }],
        },
      },
      content: {
        content_contract: {
          schema: "CertifiedPracticePacket/v1",
          kind: "certified_practice_packet",
          version: 1,
          facts: { category: "plumbing" },
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
        },
      },
    },
    request: { request_id: requestId, sources: { website_url: source } },
    idempotencyKey: requestId,
  };
}

function fixture({ compile, rows } = {}) {
  const fresh = rows.map((row, index) => freshRow(row, index));
  const byId = new Map(fresh.map((row) => [row.prospect_id, row]));
  const calls = { compiler: [], persisted: [] };
  let selects = 0;
  const deps = {
    env: { VERCEL_ENV: "production" },
    certificationKey: KEY,
    select: async (_table, query) => {
      // First shelf probe returns empty (fresh-mine lane); the reload after
      // the mine checkpoint returns every persisted row.
      selects += 1;
      if (String(query).includes("truth_packet_source=eq.leadminer_mirror_ready")) {
        return { ok: true, data: [] };
      }
      return selects <= 1 ? { ok: true, data: [] } : { ok: true, data: fresh };
    },
    mineLeads: async () => ({
      ok: true,
      rows: fresh.map((row) => ({
        prospect_id: row.prospect_id,
        build_hash: `fresh-build-${row.prospect_id}`,
        persistence: "created",
      })),
      funnel: [],
    }),
    callIntakeGenie: async (prospect) => {
      calls.compiler.push(String(prospect.prospect_id || ""));
      return compile(prospect);
    },
    conditionalUpdate: async (_table, _key, id, _guards, patch) => {
      calls.persisted.push(String(id));
      const base = byId.get(String(id)) || {};
      return { ok: true, updated: true, rows: [{ ...base, record: patch.record, updated_at: patch.updated_at }] };
    },
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
    now: () => "2026-08-24T10:00:00.000Z",
    nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
  };
  return { deps, calls };
}

const THREE = [
  { prospect_id: "acme-one", business_name: "Acme Plumbing" },
  { prospect_id: "acme-two", business_name: "Second Plumbing" },
  { prospect_id: "acme-three", business_name: "Third Plumbing" },
];

test("a retryable compile timeout drops only its candidate; certified siblings stay admitted", async () => {
  const { deps, calls } = fixture({
    rows: THREE,
    compile: (prospect) => (prospect.prospect_id === "acme-two"
      ? CLIENT_TIMEOUT_RESULT
      : compilerResultFor(prospect)),
  });

  const picked = await pickProspects({ target: "plumbers in Reno NV", count: 3, lane: "sandbox" }, deps);

  assert.deepEqual(
    picked.map((line) => line.prospectId).sort(),
    ["acme-one", "acme-three"],
    "compiled siblings survive the timed-out candidate in the same pass",
  );
  for (const line of picked) {
    assert.equal(line.genieContentCertified, true, `${line.prospectId} keeps its certification`);
  }
  assert.equal(calls.compiler.length, 3, "every candidate got exactly one compile attempt");
  assert.deepEqual(
    [...new Set(calls.persisted)].sort(),
    ["acme-one", "acme-three"],
    "successful receipts persisted",
  );
  assert.equal(picked.quarantined, undefined, "a transient timeout is never a durable quarantine");
  const stage = (picked.funnel || []).find((row) => row.stage === "intake_genie_authority_packet");
  assert.deepEqual(stage, {
    stage: "intake_genie_authority_packet",
    entered: 3,
    survived: 2,
    rejected: { intake_genie_timeout: 1 },
  });
  assert.deepEqual(picked.compileCasualties, {
    timeouts: 1,
    retryable: 1,
    sourceTarget: "plumbers in Reno NV",
  }, "the timeout census rides out for the durable slow-source memo");
});

test("a pass starved entirely by compile timeouts throws retryable with the timeout census", async () => {
  const { deps } = fixture({ rows: THREE, compile: () => CLIENT_TIMEOUT_RESULT });

  await assert.rejects(
    () => pickProspects({ target: "plumbers in Reno NV", count: 3, lane: "sandbox" }, deps),
    (error) => {
      assert.equal(error.code, "intake_genie_compile_retryable");
      assert.equal(error.retryable, true);
      assert.equal(error.causeCode, "intake_genie_timeout");
      assert.equal(error.compileTimeoutCount, 3, "every casualty is timeout-class");
      assert.equal(error.compileRetryableCount, 3);
      assert.equal(error.compileSourceTarget, "plumbers in Reno NV");
      return true;
    },
  );
});

test("a non-timeout transient keeps the retry class without timeout-census metadata", async () => {
  const { deps } = fixture({
    rows: THREE,
    compile: () => ({ ok: false, status: 429, error: "intake_genie_rate_limited" }),
  });

  await assert.rejects(
    () => pickProspects({ target: "plumbers in Reno NV", count: 3, lane: "sandbox" }, deps),
    (error) => {
      assert.equal(error.code, "intake_genie_compile_retryable");
      assert.equal(error.compileTimeoutCount, 0, "a 429 is service health, never slow-source evidence");
      assert.equal(error.compileRetryableCount, 3);
      return true;
    },
  );
});

test("a global terminal compile failure still halts the whole pick", async () => {
  const { deps } = fixture({
    rows: THREE,
    compile: (prospect) => (prospect.prospect_id === "acme-two"
      ? { ok: false, status: 401, error: "intake_genie_unauthorized" }
      : compilerResultFor(prospect)),
  });

  await assert.rejects(
    () => pickProspects({ target: "plumbers in Reno NV", count: 3, lane: "sandbox" }, deps),
    (error) => {
      assert.equal(error.code, "intake_genie_compile_terminal");
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test("the compile pool honors INTAKE_GENIE_COMPILE_CONCURRENCY on the packet-shelf lane", async () => {
  const shelfRows = THREE.concat([
    { prospect_id: "acme-four", business_name: "Fourth Plumbing" },
    { prospect_id: "acme-five", business_name: "Fifth Plumbing" },
    { prospect_id: "acme-six", business_name: "Sixth Plumbing" },
  ]).map((entry) => shelfRow(entry));
  const byId = new Map(shelfRows.map((row) => [row.prospect_id, row]));
  let inFlight = 0;
  let peak = 0;
  const previous = process.env.INTAKE_GENIE_COMPILE_CONCURRENCY;
  process.env.INTAKE_GENIE_COMPILE_CONCURRENCY = "2";
  try {
    assert.equal(poolSize(process.env), 2);
    const picked = await pickProspects({ target: "leadminer", count: 6, lane: "sandbox" }, {
      env: { VERCEL_ENV: "production" },
      certificationKey: KEY,
      select: async () => ({ ok: true, data: shelfRows }),
      callIntakeGenie: async (prospect) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        const row = byId.get(String(prospect.prospect_id)) || prospect;
        return compilerResultFor(row);
      },
      conditionalUpdate: async (_table, _key, id, _guards, patch) => {
        const base = byId.get(String(id)) || {};
        return { ok: true, updated: true, rows: [{ ...base, record: patch.record, updated_at: patch.updated_at }] };
      },
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
      now: () => "2026-08-24T10:00:00.000Z",
      nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
    });
    assert.equal(picked.length, 6, "every shelf row compiles and admits");
    assert.ok(peak <= 2, `peak compile concurrency ${peak} exceeded the pool limit 2`);
  } finally {
    if (previous === undefined) delete process.env.INTAKE_GENIE_COMPILE_CONCURRENCY;
    else process.env.INTAKE_GENIE_COMPILE_CONCURRENCY = previous;
  }
});
