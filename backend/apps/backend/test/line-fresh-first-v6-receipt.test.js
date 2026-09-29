"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compileGenieContent,
  parseTarget,
  pickProspects,
  practiceIdentity,
  historicalPracticeIdentities,
  readAllPracticeHistory,
  claimPracticeIdentity,
  practiceFreshnessVerdict,
} = require("../lib/line-adapters");
const { createContentCertification } = require("../lib/intake-genie-client");
const { nextQuotaSource, QUOTA_CONTRACT_STAGE } = require("../lib/line-quota");
const { resolveBuildableDonor } = require("../lib/lead-miner");

const CERT_KEY = "line-fresh-first-v6-receipt-test-key";
const NOW = "2026-08-27T20:00:00.000Z";

function buildReadyRow(id, { status = "new", truthPacket = false } = {}) {
  const businessName = `${truthPacket ? "Shelf" : "Fresh"} Roofing ${id}`;
  const facts = {
    business_name: businessName,
    industry: "roofing",
    city: "Reno",
    state: "NV",
    email: `owner-${id}@example.com`,
    current_website: `https://${id}.example.com`,
  };
  return {
    prospect_id: id,
    business_name: businessName,
    industry: "roofing",
    city: "Reno",
    state: "NV",
    email: facts.email,
    current_website: facts.current_website,
    status,
    updated_at: NOW,
    record: {
      ...(truthPacket ? {
        truth_packet_source: "leadminer_mirror_ready",
        truth_packet: {
          source: "leadminer_mirror_ready",
          mirror_ready: { ...facts, services: ["Roof Repair"] },
        },
      } : {}),
      build_ready: {
        mirror_request: { facts },
        proof: { dry_run_ok: true, build_hash: `hash-${id}` },
        brand_evidence: {},
        qualification: {
          website_axis: { score: 40, measured: ["websitePerformance"], missing: [] },
          composite_signal: { score: 60 },
        },
      },
    },
  };
}

function compilerResultFor(prospect) {
  const id = prospect.prospect_id;
  const requestId = `ghost:${id}:line-genie-certified-v7`;
  const website = prospect.current_website;
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "compiled",
    scope: { supported: true, category: "roofing" },
    request_id: requestId,
    job_id: `job-${id}`,
    facts: {
      name: prospect.business_name,
      city: prospect.city,
      state: prospect.state,
      category: "roofing",
      services: ["Roof Repair"],
    },
    evidence: [{
      field: "services",
      value: "Roof Repair",
      source_url: `${website}/services`,
      verified: true,
      status: "verified",
    }],
  };
  return {
    ok: true,
    request: { request_id: requestId, sources: { website_url: website } },
    packet,
    idempotencyKey: requestId,
  };
}

for (const count of [10, 25, 50]) {
  test(`All Trades ${count}-site source mines before a full matching shelf`, async () => {
    const fresh = Array.from({ length: count }, (_, index) => buildReadyRow(`fresh-${count}-${index}`));
    const shelf = Array.from({ length: count }, (_, index) => buildReadyRow(`shelf-${count}-${index}`, {
      status: "held",
      truthPacket: true,
    }));
    const calls = [];

    const picked = await pickProspects({
      target: "roofing in Reno NV",
      campaignTarget: "all trades nationwide",
      count,
      lane: "sandbox",
    }, {
      env: {},
      resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
      mineLeads: async () => {
        calls.push("mine");
        return {
          ok: true,
          rows: fresh.map((row) => ({
            prospect_id: row.prospect_id,
            persistence: "created",
            build_hash: row.record.build_ready.proof.build_hash,
          })),
          funnel: [],
        };
      },
      select: async (_table, query) => {
        if (query.includes("record->>truth_packet_source")) {
          calls.push("shelf");
          return { ok: true, data: shelf };
        }
        calls.push("reload");
        return { ok: true, data: fresh };
      },
    });

    assert.equal(calls[0], "mine", "stored inventory must not preempt the provider assignment");
    assert.equal(calls.includes("shelf"), false, "a full fresh result must spend no shelf read");
    assert.equal(picked.length, count);
    assert.equal(picked.every((row) => row.prospectId.startsWith(`fresh-${count}-`)), true);
  });
}

test("Practice freshness refuses generated identities before Intake Genie", async () => {
  for (const [name, row, reason] of [
    ["prospect id", buildReadyRow("wss-test-old-roofer"), "practice_freshness_prospect_id_generated"],
    ["site slug", { ...buildReadyRow("fresh-site-slug"), site_slug: "wss-test-old-site" }, "practice_freshness_site_slug_generated"],
    ["generated host", { ...buildReadyRow("fresh-host"), current_website: "https://old-site.wss-ai.com/" }, "practice_freshness_generated_host"],
    ["canonical domain", { ...buildReadyRow("fresh-domain"), canonical_domain: "wss-test-old-domain.wss-ai.com" }, "practice_freshness_generated_host"],
  ]) {
    let intakeCalls = 0;
    const picked = await pickProspects({
      target: "roofing in Reno NV",
      campaignTarget: "all trades nationwide",
      count: 1,
      lane: "sandbox",
      operationKey: `freshness-test:${name}`,
    }, {
      env: { VERCEL_ENV: "production" },
      certificationKey: CERT_KEY,
      resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
      mineLeads: async () => ({
        ok: true,
        rows: [{ prospect_id: row.prospect_id, persistence: "created", build_hash: row.record.build_ready.proof.build_hash }],
        funnel: [],
      }),
      select: async () => ({ ok: true, data: [row] }),
      readPracticeHistory: async () => ({ ok: true, keys: new Set() }),
      claimPracticeIdentity: async () => ({ ok: true }),
      callIntakeGenie: async () => { intakeCalls += 1; return compilerResultFor(row); },
      conditionalUpdate: async () => ({ ok: true, updated: true }),
    });
    assert.equal(intakeCalls, 0, `${name} must be refused before provider work`);
    assert.equal(picked.length, 0);
    assert.equal(picked.quarantined?.[0]?.reason, reason);
  }
});

test("Practice history excludes the same business identity before its claim", async () => {
  const row = buildReadyRow("fresh-history");
  const historyKeys = historicalPracticeIdentities([{
    prospect_id: "older-id",
    payload: { businessName: row.business_name, city: row.city, currentWebsite: "https://older.example" },
  }]);
  let claims = 0;
  const verdict = await practiceFreshnessVerdict(row, {
    lane: "sandbox",
    operationKey: "history-op:fresh-history",
    historyKeys,
    claim: async () => { claims += 1; return { ok: true }; },
  });
  assert.deepEqual(verdict, { ok: false, reason: "practice_identity_in_prior_history" });
  assert.equal(claims, 0);
});

test("Practice identity claim is race-safe and the same operation resumes", async () => {
  const identity = practiceIdentity(buildReadyRow("claim-race"));
  const events = new Map();
  const write = async (_table, event) => {
    if (events.has(event.id)) return { mode: "live_write_failed", status: 409, error: { code: "23505" } };
    events.set(event.id, event);
    return { mode: "live_write", row: event };
  };
  const read = async (_table, query) => {
    const id = /id=eq\.([^&]+)/.exec(query)?.[1] || "";
    return { ok: true, data: events.has(id) ? [events.get(id)] : [] };
  };
  const [first, second] = await Promise.all([
    claimPracticeIdentity(identity, { operationKey: "batch-a:claim-race", write, read }),
    claimPracticeIdentity(identity, { operationKey: "batch-b:claim-race", write, read }),
  ]);
  assert.equal([first, second].filter((result) => result.ok).length, 1);
  assert.equal([first, second].find((result) => !result.ok)?.reason, "practice_identity_already_claimed");
  const resumed = await claimPracticeIdentity(identity, { operationKey: "batch-a:claim-race", write, read });
  assert.equal(resumed.ok, first.ok, "only the winning immutable operation may resume");
});

test("Practice history outage degrades honestly: rows flow with a recorded reason", async () => {
  let claims = 0;
  const row = buildReadyRow("history-outage");
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades nationwide",
    count: 1,
    lane: "sandbox",
    operationKey: "history-outage-op",
  }, {
    env: {},
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => ({ ok: true, rows: [{ prospect_id: row.prospect_id, persistence: "created", build_hash: row.record.build_ready.proof.build_hash }], funnel: [] }),
    select: async () => ({ ok: true, data: [row] }),
    readPracticeHistory: async () => ({ ok: false, reason: "practice_history_read_failed" }),
    claimPracticeIdentity: async () => { claims += 1; return { ok: true }; },
  });
  // OUTAGE LAW (2026-09-04, batch line_mtolbe4s): a dead history read must
  // not mass-refuse the batch. Degrade-and-continue with the recorded reason;
  // the durable claim still guards same-window duplicates.
  assert.equal(picked.length, 1);
  assert.ok(claims >= 1);
  assert.equal(picked.practiceHistoryDegraded, "practice_history_unavailable:degraded");
  assert.equal(picked.funnel?.[0]?.stage, "practice_history_degraded");
});

test("an aborted Practice history scan performs no read or identity claim", async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  let claims = 0;
  let intakeCalls = 0;
  const row = buildReadyRow("aborted-history");
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades nationwide",
    count: 1,
    lane: "sandbox",
    signal: controller.signal,
    operationKey: "aborted-history-op",
  }, {
    env: { VERCEL_ENV: "production" },
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => ({ ok: true, rows: [{ prospect_id: row.prospect_id, persistence: "created", build_hash: row.record.build_ready.proof.build_hash }], funnel: [] }),
    select: async () => ({ ok: true, data: [row] }),
    readPracticeHistory: (options) => readAllPracticeHistory(async () => {
      reads += 1;
      return { ok: true, data: [] };
    }, options),
    claimPracticeIdentity: async () => { claims += 1; return { ok: true }; },
    callIntakeGenie: async () => { intakeCalls += 1; return compilerResultFor(row); },
  });
  assert.equal(picked.length, 0);
  assert.equal(reads, 0);
  assert.equal(claims, 0);
  assert.equal(intakeCalls, 0);
});

test("All Trades rotates after a zero-yield provider result without reading old shelf inventory", async () => {
  const calls = [];
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades",
    count: 1,
  }, {
    env: { VERCEL_ENV: "production" },
    certificationKey: CERT_KEY,
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => {
      calls.push("mine");
      return { ok: true, rows: [], funnel: [] };
    },
    select: async () => {
      calls.push("shelf");
      throw new Error("nationwide All Trades must not read old shelf inventory");
    },
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  });

  assert.deepEqual(calls, ["mine"]);
  assert.equal(picked.length, 0);
});

test("All Trades salon rotation invokes the canonical miner once and never reads historical inventory", async () => {
  const source = nextQuotaSource({
    batchId: "salon-routing-regression",
    target: "all trades nationwide",
    requested: 1,
    status: "building",
    rows: [],
    mineFunnel: [{ stage: QUOTA_CONTRACT_STAGE }],
  }, {
    verticals: [{ vertical: "salon", outreachRetired: false }],
    metros: ["Reno NV"],
  });
  assert.equal(source.target, "hair salon in Reno NV");
  assert.equal(source.mode, "fresh_all_trades_balanced");
  assert.deepEqual(parseTarget(source.target), { industry: "hair salon", location: "Reno NV" });
  assert.deepEqual(resolveBuildableDonor("hair salon"), {
    ok: true,
    donor: "salon-lacquer-studio",
    vertical: "salon",
    via: "category_bridge",
  });
  const calls = [];

  const picked = await pickProspects({
    target: source.target,
    campaignTarget: "all trades nationwide",
    count: 1,
    lane: "sandbox",
  }, {
    mineLeads: async (input) => {
      calls.push("mine");
      assert.equal(input.industry, "hair salon");
      assert.equal(input.location, "Reno NV");
      assert.equal(input.query, "hair salon in Reno NV");
      return { ok: true, rows: [], funnel: [] };
    },
    select: async () => {
      calls.push("store");
      throw new Error("fresh Salon source must not read historical inventory");
    },
    selectRows: async () => {
      calls.push("store");
      throw new Error("fresh Salon source must not read historical inventory");
    },
  });

  assert.deepEqual(calls, ["mine"]);
  assert.equal(picked.length, 0);
});

test("an unparseable All Trades fresh source fails closed before miner or store access", async () => {
  let mineCalls = 0;
  let storeCalls = 0;

  await assert.rejects(
    pickProspects({
      target: "salon Reno NV",
      campaignTarget: "all trades nationwide",
      count: 1,
      lane: "sandbox",
    }, {
      mineLeads: async () => { mineCalls += 1; return { ok: true, rows: [] }; },
      select: async () => { storeCalls += 1; return { ok: true, data: [] }; },
      selectRows: async () => { storeCalls += 1; return { ok: true, rows: [] }; },
    }),
    { code: "fresh_all_trades_target_unparseable", retryable: false },
  );

  assert.equal(mineCalls, 0);
  assert.equal(storeCalls, 0);
});

test("All Trades excludes a rediscovered stored prospect marked updated", async () => {
  const old = buildReadyRow("old-updated");
  const calls = [];
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades nationwide",
    count: 1,
  }, {
    env: {},
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => ({
      ok: true,
      rows: [{ prospect_id: old.prospect_id, persistence: "updated", build_hash: old.record.build_ready.proof.build_hash }],
      funnel: [],
    }),
    select: async () => {
      calls.push("select");
      throw new Error("an updated nationwide identity must be dropped before reload or shelf fallback");
    },
  });

  assert.equal(picked.length, 0);
  assert.deepEqual(calls, []);
});

test("All Trades reconciles its exact same-operation accepted checkpoint", async () => {
  const fresh = buildReadyRow("accepted-checkpoint");
  const buildHash = "a".repeat(64);
  fresh.record.build_ready.proof.build_hash = buildHash;
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades nationwide",
    count: 1,
    acceptedMiningCheckpoint: [{ prospect_id: fresh.prospect_id, build_hash: buildHash }],
  }, {
    env: { VERCEL_ENV: "production" },
    certificationKey: CERT_KEY,
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => { throw new Error("an accepted checkpoint must not call the provider again"); },
    select: async (_table, query) => {
      assert.equal(query.includes("record->>truth_packet_source"), false);
      return { ok: true, data: [fresh] };
    },
    callIntakeGenie: async (prospect) => compilerResultFor(prospect),
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  });

  assert.deepEqual(picked.map((row) => row.prospectId), [fresh.prospect_id]);
});

test("a partial All Trades provider result stays fresh-only and rotates for the gap", async () => {
  const fresh = buildReadyRow("fresh-partial");
  const calls = [];
  const compiled = [];
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades nationwide",
    count: 2,
  }, {
    env: { VERCEL_ENV: "production" },
    certificationKey: CERT_KEY,
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => {
      calls.push("mine");
      return {
        ok: true,
        rows: [{
          prospect_id: fresh.prospect_id,
          persistence: "created",
          build_hash: fresh.record.build_ready.proof.build_hash,
        }],
        funnel: [],
      };
    },
    select: async (_table, query) => {
      assert.equal(query.includes("record->>truth_packet_source"), false, "partial nationwide supply must not read shelf inventory");
      calls.push("reload");
      return { ok: true, data: [fresh] };
    },
    callIntakeGenie: async (prospect) => {
      compiled.push(prospect.prospect_id);
      return compilerResultFor(prospect);
    },
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  });

  assert.deepEqual(calls, ["mine", "reload"]);
  assert.deepEqual(compiled, ["fresh-partial"]);
  assert.deepEqual(picked.map((row) => row.prospectId), ["fresh-partial"]);
  assert.equal(picked.every((row) => row.genieContentCertified === true), true);
});

test("a candidate-local fresh refusal stays quarantined without old shelf replacement", async () => {
  const refused = buildReadyRow("refused-fresh");
  const compiled = [];
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades nationwide",
    count: 1,
  }, {
    env: { VERCEL_ENV: "production" },
    certificationKey: CERT_KEY,
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => ({
      ok: true,
      rows: [{
        prospect_id: refused.prospect_id,
        persistence: "created",
        build_hash: refused.record.build_ready.proof.build_hash,
      }],
      funnel: [],
    }),
    select: async (_table, query) => {
      assert.equal(query.includes("record->>truth_packet_source"), false, "a refusal must rotate fresh instead of reading old shelf rows");
      return { ok: true, data: [refused] };
    },
    callIntakeGenie: async (prospect) => {
      compiled.push(prospect.prospect_id);
      if (prospect.prospect_id === refused.prospect_id) {
        return { ok: false, status: 422, error: "business_name_mismatch" };
      }
      return compilerResultFor(prospect);
    },
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  });

  assert.deepEqual(compiled, ["refused-fresh"], "the refused id must compile only once");
  assert.equal(picked.length, 0);
  assert.equal(picked.quarantined?.[0]?.prospectId, "refused-fresh");
});

function genieFixture() {
  const prospect = {
    prospect_id: "receipt-row",
    business_name: "Receipt Roofing",
    city: "Reno",
    state: "NV",
    industry: "roofing",
    current_website: "https://receipt-roofing.example",
  };
  const sources = { website_url: prospect.current_website };
  const packet = (requestId) => ({
    ok: true,
    version: "intake-genie-v2",
    status: "compiled",
    scope: { supported: true, category: "roofing" },
    request_id: requestId,
    job_id: `job-${requestId.split(":").at(-1)}`,
    facts: {
      name: prospect.business_name,
      city: prospect.city,
      state: prospect.state,
      category: "roofing",
      services: ["Roof Repair"],
    },
    evidence: [{
      field: "services",
      value: "Roof Repair",
      source_url: `${prospect.current_website}/services`,
      verified: true,
      status: "verified",
    }],
  });
  return { prospect, sources, packet };
}

test("a fully valid v6 marker recompiles once under v7 instead of fast-passing", async () => {
  const { prospect, sources, packet } = genieFixture();
  const oldKey = "ghost:receipt-row:line-genie-certified-v6";
  const legacy = createContentCertification(packet(oldKey), prospect, {
    signingKey: CERT_KEY,
    requestId: oldKey,
    jobId: packet(oldKey).job_id,
    idempotencyKey: oldKey,
    requestSources: sources,
    certifiedAt: NOW,
  });
  assert.equal(legacy.ok, true, JSON.stringify(legacy));
  const row = {
    ...prospect,
    status: "new",
    updated_at: NOW,
    record: {
      genie_canonical_packet: packet(oldKey),
      genie_compile_sources: sources,
      genie_compile_idempotency_key: oldKey,
      genie_content_certification: legacy.receipt,
      genie_content_certification_contract: {
        version: "ghost-line-genie-receipt-v6",
        pipeline_version: "line-genie-certified-v6",
        idempotency_key_sha256: require("node:crypto").createHash("sha256").update(oldKey).digest("hex"),
      },
    },
  };
  let compilerCalls = 0;
  let writes = 0;
  const currentKey = "ghost:receipt-row:line-genie-certified-v7";
  const deps = {
    certificationKey: CERT_KEY,
    now: () => NOW,
    nowMs: Date.parse(NOW) + 1,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async (_prospect, options) => {
      compilerCalls += 1;
      assert.equal(options.pipelineVersion, "line-genie-certified-v7");
      return {
        ok: true,
        request: { request_id: currentKey, sources },
        packet: packet(currentKey),
        idempotencyKey: currentKey,
      };
    },
    conditionalUpdate: async () => {
      writes += 1;
      return { ok: true, updated: true };
    },
  };
  const first = await compileGenieContent(row, deps);
  const second = await compileGenieContent(first.row, deps);

  assert.equal(first.ok, true, first.reason);
  assert.equal(first.reused, false);
  assert.equal(second.ok, true, second.reason);
  assert.equal(second.reused, true);
  assert.equal(compilerCalls, 1);
  assert.equal(writes, 1);
  assert.equal(first.rec.genie_content_certification_contract.version, "ghost-line-genie-receipt-v7");
  assert.equal(first.rec.genie_content_certification_contract.pipeline_version, "line-genie-certified-v7");
  assert.equal(first.rec.genie_compile_idempotency_key, currentKey);
});

test("a newly persisted v7 marker, version, and compiler key reuse exactly once compiled", async () => {
  const { prospect, sources, packet } = genieFixture();
  const currentKey = "ghost:receipt-row:line-genie-certified-v7";
  const row = { ...prospect, status: "new", updated_at: NOW, record: {} };
  let compilerCalls = 0;
  let writes = 0;
  const deps = {
    certificationKey: CERT_KEY,
    now: () => NOW,
    nowMs: Date.parse(NOW) + 1,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async () => {
      compilerCalls += 1;
      return {
        ok: true,
        request: { request_id: currentKey, sources },
        packet: packet(currentKey),
        idempotencyKey: currentKey,
      };
    },
    conditionalUpdate: async () => {
      writes += 1;
      return { ok: true, updated: true };
    },
  };

  const first = await compileGenieContent(row, deps);
  const second = await compileGenieContent(first.row, deps);

  assert.equal(first.reused, false);
  assert.equal(second.ok, true, second.reason);
  assert.equal(second.reused, true);
  assert.equal(compilerCalls, 1);
  assert.equal(writes, 1);
});

test("a forged v7 marker cannot bless a v6 compiler key", async () => {
  const { prospect, sources, packet } = genieFixture();
  const oldKey = "ghost:receipt-row:line-genie-certified-v6";
  const legacy = createContentCertification(packet(oldKey), prospect, {
    signingKey: CERT_KEY,
    requestId: oldKey,
    jobId: packet(oldKey).job_id,
    idempotencyKey: oldKey,
    requestSources: sources,
    certifiedAt: NOW,
  });
  const row = {
    ...prospect,
    status: "new",
    updated_at: NOW,
    record: {
      genie_canonical_packet: packet(oldKey),
      genie_compile_sources: sources,
      genie_compile_idempotency_key: oldKey,
      genie_content_certification: legacy.receipt,
      genie_content_certification_contract: {
        version: "ghost-line-genie-receipt-v7",
        pipeline_version: "line-genie-certified-v7",
        idempotency_key_sha256: require("node:crypto").createHash("sha256").update(oldKey).digest("hex"),
      },
    },
  };
  let compilerCalls = 0;
  const currentKey = "ghost:receipt-row:line-genie-certified-v7";
  const result = await compileGenieContent(row, {
    certificationKey: CERT_KEY,
    now: () => NOW,
    nowMs: Date.parse(NOW) + 1,
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async (_prospect, options) => {
      compilerCalls += 1;
      assert.equal(options.pipelineVersion, "line-genie-certified-v7");
      return {
        ok: true,
        request: { request_id: currentKey, sources },
        packet: packet(currentKey),
        idempotencyKey: currentKey,
      };
    },
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  });

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.reused, false);
  assert.equal(compilerCalls, 1);
});
