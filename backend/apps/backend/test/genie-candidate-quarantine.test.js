"use strict";

// D3 — candidate-local Intake Genie quarantine in the fresh (non-exact) lane.
//
// The Line is a durable state machine: a proven candidate-local verdict (422,
// supported needs_input, or only row-bound certification gaps) quarantines
// exactly that candidate, keeps every compiled sibling and its persisted
// receipt, records the refusal on the authority-packet funnel stage, and leaves
// the replacement quota asking for exactly the gap. Failure triage scans ALL
// compile results, so a local refusal cannot hide a transient or global failure.

const test = require("node:test");
const assert = require("node:assert/strict");

const { pickProspects } = require("../lib/line-adapters");
const quota = require("../lib/line-quota");

const KEY = "test-only-intake-genie-content-certification-key";
const RUNTIME_BINDING_FAILURE = "intake_genie_certification_failed:business_name_mismatch,source_bound_evidence_missing,verified_service_evidence_missing,services_missing,source_set_missing";
const STRUCTURED_REFUSAL = Object.freeze({
  code: "business_name_mismatch",
  field: "name",
  expected: "Acme Plumbing 1",
  actual: "Wrong Plumbing",
  compared: { candidate: "Acme Plumbing 1", compiled: "Wrong Plumbing" },
});

function freshRow(n) {
  const id = `acme-q${n}`;
  const website = `https://${id}.example`;
  const business = `Acme Plumbing ${n}`;
  return {
    prospect_id: id,
    business_name: business,
    city: "Reno",
    state: "NV",
    place_id: `ChIJ-${id}`,
    website,
    status: "new",
    email: `owner@${id}.example`,
    updated_at: "2026-08-24T09:00:00.000Z",
    record: {
      status: "new",
      source: "build-ready-mine",
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        source: "leadminer_mirror_ready",
        meta: { source: "leadminer_mirror_ready", build_ready: false, missing_build_evidence: ["content"] },
        mirror_ready: {
          business_name: business,
          place_id: `ChIJ-${id}`,
          logo_url: "",
          services: ["Drain Cleaning", "Water Heater Repair"],
        },
        services: ["Drain Cleaning", "Water Heater Repair"],
        industry: "plumbing",
      },
      business_name: business,
      city: "Reno",
      state: "NV",
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
    facts: {
      name: String(prospect.business_name || ""),
      city: "Reno",
      state: "NV",
      category: "plumbing",
      services: ["Drain Cleaning", "Water Heater Repair"],
    },
    evidence: [
      { field: "services", value: "Drain Cleaning", source_url: src },
      { field: "services", value: "Water Heater Repair", source_url: src },
    ],
  };
  return {
    ok: true,
    packet,
    request: { request_id: requestId, sources: { website_url: src } },
    idempotencyKey: requestId,
  };
}

function fixture({ compile, rows = [freshRow(1), freshRow(2), freshRow(3)] } = {}) {
  const byId = new Map(rows.map((row) => [row.prospect_id, row]));
  const calls = { compiler: [], persisted: [] };
  const deps = {
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

test("a deterministic 422 quarantines only its candidate; compiled siblings and their receipts survive", async () => {
  const { deps, calls } = fixture({
    // 422 FIRST, successes after: result order must not decide truth.
    compile: (prospect) => (prospect.prospect_id === "acme-q1"
      ? { ok: false, status: 422, error: "compiler_http_422", problems: [STRUCTURED_REFUSAL] }
      : compilerResultFor(prospect)),
  });

  const picked = await pickProspects({ target: "plumbers in Reno NV", count: 3, lane: "sandbox" }, deps);

  assert.deepEqual(
    picked.map((line) => line.prospectId).sort(),
    ["acme-q2", "acme-q3"],
    "both compiled siblings stay admitted",
  );
  for (const line of picked) {
    assert.equal(line.genieContentCertified, true, `${line.prospectId} keeps its certification`);
    assert.equal(Boolean(line.needs_fill), false, `${line.prospectId} needs no AI fill`);
  }
  assert.equal(calls.compiler.length, 3, "every candidate got exactly one compile");
  assert.deepEqual(
    [...new Set(calls.persisted)].sort(),
    ["acme-q2", "acme-q3"],
    "successful receipts persisted despite the sibling 422",
  );
  const stage = (picked.funnel || []).find((row) => row.stage === "intake_genie_authority_packet");
  assert.deepEqual(stage, {
    stage: "intake_genie_authority_packet",
    entered: 3,
    survived: 2,
    rejected: { compiler_http_422: 1 },
  });
  assert.deepEqual(picked.quarantined, [{
    prospectId: "acme-q1",
    businessName: "Acme Plumbing 1",
    vertical: "plumbing",
    reason: "intake_genie_candidate_refused: compiler_http_422",
    problems: [STRUCTURED_REFUSAL],
    detail: [STRUCTURED_REFUSAL],
  }]);

  // The refill arrives with every attempted id excluded (runPick derives the
  // exclusion from ALL durable batch rows, rejected included). Even when the
  // miner re-emits the same businesses, the quarantined candidate is dropped
  // BEFORE the compiler runs — the 422 is never bought twice.
  const refill = await pickProspects({
    target: "plumbers in Reno NV",
    count: 1,
    lane: "sandbox",
    excludeProspectIds: ["acme-q1", "acme-q2", "acme-q3"],
  }, deps);
  assert.equal(refill.length, 0);
  assert.equal(refill.quarantined, undefined, "an excluded candidate is not re-quarantined");
  assert.equal(calls.compiler.length, 3, "no candidate was recompiled on the refill");
});

test("deployed Packet2 needs_input quarantines only that fresh candidate and preserves compiled siblings", async () => {
  const { deps, calls } = fixture({
    compile: (prospect) => {
      const compiled = compilerResultFor(prospect);
      return prospect.prospect_id === "acme-q1"
        ? {
          ...compiled,
          packet: {
            ...compiled.packet,
            status: "needs_input",
            version: "intake-genie-v2",
            scope: { supported: true, category: "plumbing" },
            missing_facts: ["services"],
          },
        }
        : compiled;
    },
  });

  const picked = await pickProspects({ target: "plumbers in Reno NV", count: 3, lane: "sandbox" }, deps);

  assert.deepEqual(picked.map((line) => line.prospectId).sort(), ["acme-q2", "acme-q3"]);
  assert.deepEqual([...new Set(calls.persisted)].sort(), ["acme-q2", "acme-q3"]);
  assert.deepEqual(
    (picked.funnel || []).find((row) => row.stage === "intake_genie_authority_packet"),
    {
      stage: "intake_genie_authority_packet",
      entered: 3,
      survived: 2,
      rejected: { intake_genie_candidate_needs_input: 1 },
    },
  );
  assert.deepEqual(picked.quarantined, [{
    prospectId: "acme-q1",
    businessName: "Acme Plumbing 1",
    vertical: "plumbing",
    reason: "intake_genie_candidate_refused: intake_genie_candidate_needs_input",
  }]);

  const refill = await pickProspects({
    target: "plumbers in Reno NV",
    count: 1,
    lane: "sandbox",
    excludeProspectIds: ["acme-q1", "acme-q2", "acme-q3"],
  }, deps);
  assert.equal(refill.length, 0);
  assert.equal(calls.compiler.length, 3, "the quarantined Packet2 row is not bought twice");
});

test("HTTP-200 candidate-only certification gaps quarantine one candidate and preserve compiled siblings", async () => {
  const { deps, calls } = fixture({
    compile: (prospect) => {
      const compiled = compilerResultFor(prospect);
      if (prospect.prospect_id !== "acme-q1") return compiled;
      return {
        ...compiled,
        request: { ...compiled.request, sources: {} },
        packet: {
          ...compiled.packet,
          facts: { ...compiled.packet.facts, name: "Different Business" },
          evidence: [],
        },
      };
    },
  });

  const picked = await pickProspects({ target: "plumbers in Reno NV", count: 3, lane: "sandbox" }, deps);

  assert.deepEqual(picked.map((line) => line.prospectId).sort(), ["acme-q2", "acme-q3"]);
  assert.deepEqual([...new Set(calls.persisted)].sort(), ["acme-q2", "acme-q3"]);
  assert.deepEqual(
    (picked.funnel || []).find((row) => row.stage === "intake_genie_authority_packet"),
    {
      stage: "intake_genie_authority_packet",
      entered: 3,
      survived: 2,
      rejected: { [RUNTIME_BINDING_FAILURE]: 1 },
    },
  );
  assert.deepEqual(picked.quarantined, [{
    prospectId: "acme-q1",
    businessName: "Acme Plumbing 1",
    vertical: "plumbing",
    reason: `intake_genie_candidate_refused: ${RUNTIME_BINDING_FAILURE}`,
  }]);

  const refill = await pickProspects({
    target: "plumbers in Reno NV",
    count: 1,
    lane: "sandbox",
    excludeProspectIds: ["acme-q1", "acme-q2", "acme-q3"],
  }, deps);
  assert.equal(refill.length, 0);
  assert.equal(calls.compiler.length, 3, "the quarantined HTTP-200 row is not bought twice");
});

test("an early 422 cannot hide a later transient failure — the whole pick retries", async () => {
  const { deps, calls } = fixture({
    compile: (prospect) => {
      if (prospect.prospect_id === "acme-q1") return { ok: false, status: 422, error: "compiler_http_422" };
      if (prospect.prospect_id === "acme-q2") return { ok: false, status: 503, error: "compiler_http_503" };
      return compilerResultFor(prospect);
    },
  });
  await assert.rejects(
    pickProspects({ target: "plumbers in Reno NV", count: 3, lane: "sandbox" }, deps),
    (error) => {
      assert.equal(error?.code, "intake_genie_compile_retryable");
      assert.equal(error?.retryable, true);
      assert.equal(error?.causeCode, "compiler_http_503");
      return true;
    },
  );
  // The successful sibling's signed receipt was persisted BEFORE the throw, so
  // the retry reuses it with zero additional compiler spend for that row.
  assert.deepEqual([...new Set(calls.persisted)], ["acme-q3"]);
});

test("an early 422 cannot hide a later global configuration failure — the pick halts", async () => {
  const { deps } = fixture({
    compile: (prospect) => {
      if (prospect.prospect_id === "acme-q1") return { ok: false, status: 422, error: "compiler_http_422" };
      if (prospect.prospect_id === "acme-q2") return { ok: false, status: "not_configured", error: "compiler_not_configured" };
      return compilerResultFor(prospect);
    },
  });
  await assert.rejects(
    pickProspects({ target: "plumbers in Reno NV", count: 3, lane: "sandbox" }, deps),
    (error) => {
      assert.equal(error?.code, "intake_genie_compile_terminal");
      assert.equal(error?.retryable, false);
      assert.equal(error?.causeCode, "compiler_not_configured");
      return true;
    },
  );
});

function shelfRow(n) {
  const id = `acme-s${n}`;
  const website = `https://${id}.example`;
  const business = `Shelf Plumbing ${n}`;
  return {
    prospect_id: id,
    business_name: business,
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
          business_name: business,
          place_id: `ChIJ-${id}`,
          logo_url: "",
          services: ["Drain Cleaning", "Water Heater Repair"],
        },
        services: ["Drain Cleaning", "Water Heater Repair"],
        industry: "plumbing",
      },
      business_name: business,
      city: "Reno",
      state: "NV",
      place_id: `ChIJ-${id}`,
      website,
      industry: "plumbing",
    },
  };
}

function shelfFixture({ compile, rows = [shelfRow(1), shelfRow(2)] } = {}) {
  const calls = { compiler: [] };
  const deps = {
    env: { VERCEL_ENV: "production", GHOST_AGENCY_QUEUE_GAP_FIRST: "0" },
    certificationKey: KEY,
    select: async () => ({ ok: true, data: rows }),
    callIntakeGenie: async (prospect) => {
      calls.compiler.push(String(prospect.prospect_id || ""));
      return compile(prospect);
    },
    conditionalUpdate: async (_table, _key, id, _guards, patch) => {
      const base = rows.find((row) => row.prospect_id === String(id)) || {};
      return { ok: true, updated: true, rows: [{ ...base, record: patch.record, updated_at: patch.updated_at }] };
    },
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
    now: () => "2026-08-24T10:00:00.000Z",
    nowMs: Date.parse("2026-08-24T10:05:00.000Z"),
  };
  return { deps, calls };
}

test("a shelf 422 quarantines only its candidate and lands on the authority-packet funnel stage", async () => {
  const { deps } = shelfFixture({
    compile: (prospect) => (prospect.prospect_id === "acme-s1"
      ? { ok: false, status: 422, error: "compiler_http_422", packet: { problems: [STRUCTURED_REFUSAL] } }
      : compilerResultFor(prospect)),
  });
  const picked = await pickProspects({ target: "leadminer", count: 2, lane: "sandbox" }, deps);
  assert.deepEqual(picked.map((line) => line.prospectId), ["acme-s2"]);
  assert.equal(picked[0].genieContentCertified, true);
  assert.equal(Boolean(picked[0].needs_fill), false);
  const stage = (picked.funnel || []).find((row) => row.stage === "intake_genie_authority_packet");
  assert.deepEqual(stage, {
    stage: "intake_genie_authority_packet",
    entered: 2,
    survived: 1,
    rejected: { compiler_http_422: 1 },
  });
  assert.deepEqual(picked.quarantined, [{
    prospectId: "acme-s1",
    businessName: "Shelf Plumbing 1",
    vertical: "plumbing",
    reason: "intake_genie_candidate_refused: compiler_http_422",
    problems: [STRUCTURED_REFUSAL],
    detail: [STRUCTURED_REFUSAL],
  }]);
});

test("a shelf HTTP-200 candidate-only certification failure quarantines one row and preserves its sibling", async () => {
  const { deps } = shelfFixture({
    compile: (prospect) => {
      const compiled = compilerResultFor(prospect);
      if (prospect.prospect_id !== "acme-s1") return compiled;
      return {
        ...compiled,
        request: { ...compiled.request, sources: {} },
        packet: {
          ...compiled.packet,
          facts: { ...compiled.packet.facts, name: "Different Business" },
          evidence: [],
        },
      };
    },
  });

  const picked = await pickProspects({ target: "leadminer", count: 2, lane: "sandbox" }, deps);

  assert.deepEqual(picked.map((line) => line.prospectId), ["acme-s2"]);
  assert.equal(picked[0].genieContentCertified, true);
  assert.deepEqual(
    (picked.funnel || []).find((row) => row.stage === "intake_genie_authority_packet"),
    {
      stage: "intake_genie_authority_packet",
      entered: 2,
      survived: 1,
      rejected: { [RUNTIME_BINDING_FAILURE]: 1 },
    },
  );
  assert.deepEqual(picked.quarantined, [{
    prospectId: "acme-s1",
    businessName: "Shelf Plumbing 1",
    vertical: "plumbing",
    reason: `intake_genie_candidate_refused: ${RUNTIME_BINDING_FAILURE}`,
  }]);
});

test("a shelf transient failure retries the pick instead of rotating the source", async () => {
  const { deps } = shelfFixture({
    compile: (prospect) => (prospect.prospect_id === "acme-s1"
      ? { ok: false, status: 422, error: "compiler_http_422" }
      : { ok: false, status: 503, error: "compiler_http_503" }),
  });
  await assert.rejects(
    pickProspects({ target: "leadminer", count: 2, lane: "sandbox" }, deps),
    (error) => {
      assert.equal(error?.code, "intake_genie_compile_retryable");
      assert.equal(error?.causeCode, "compiler_http_503");
      return true;
    },
  );
});

test("a shelf global configuration failure halts instead of draining the shelf", async () => {
  const { deps } = shelfFixture({
    compile: (prospect) => (prospect.prospect_id === "acme-s1"
      ? { ok: false, status: 422, error: "compiler_http_422" }
      : { ok: false, status: "not_configured", error: "compiler_not_configured" }),
  });
  await assert.rejects(
    pickProspects({ target: "leadminer", count: 2, lane: "sandbox" }, deps),
    (error) => {
      assert.equal(error?.code, "intake_genie_compile_terminal");
      assert.equal(error?.causeCode, "compiler_not_configured");
      return true;
    },
  );
});

test("a quarantined row counts as neither active nor finished, so the quota asks for exactly the gap", () => {
  const mineFunnel = quota.mergeMineFunnel(
    [{ stage: quota.QUOTA_CONTRACT_STAGE, entered: 3, survived: 0, rejected: {} }],
    [{ stage: "intake_genie_authority_packet", entered: 3, survived: 2, rejected: { compiler_http_422: 1 } }],
    { attempt: 0, sourceTarget: "plumbers in Reno NV", mode: "fixed_market", requested: 3, selected: 2, contractEntered: 3 },
  );
  const batch = {
    requested: 3,
    status: "building",
    mineFunnel,
    rows: [
      { status: "picked", prospectId: "acme-q2" },
      { status: "picked", prospectId: "acme-q3" },
      { status: "rejected", prospectId: "acme-q1", reason: "intake_genie_candidate_refused: compiler_http_422" },
    ],
  };
  assert.equal(quota.replacementDeficit(batch), 1, "exactly one replacement is owed");
  assert.equal(quota.shouldRefill(batch), true);
});
