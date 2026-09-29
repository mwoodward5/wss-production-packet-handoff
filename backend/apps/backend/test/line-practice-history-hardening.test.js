"use strict";

// PRACTICE HISTORY READ HARDENING (batch line_mtolbe4s_b4d88b9589, 2026-09-04).
// 8 of 9 rows died with practice_history_read_failed because the history scan
// paged EVERY sandbox batch and EVERY full row payload, grew unboundedly with
// campaign history, timed Supabase out, and the definitive caller refusal then
// killed the whole batch. These tests pin the hardened law:
//   (a) a transient read failure retries (3 retries, 2s/5s/10s) and the batch
//       proceeds;
//   (b) a persistent read failure degrades honestly — rows flow with the
//       recorded practice_history_unavailable:degraded reason on the pick
//       result and funnel (and the durable rows via the continuation stamp);
//   (c) the PRACTICE_HISTORY_LOOKBACK_DAYS dial bounds the scan (default 90,
//       ceiling 3650, invalid falls back to the default);
//   (d) identity keys still dedupe inside the window from the NARROWED read
//       (no full payload is selected).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  pickProspects,
  practiceIdentity,
  historicalPracticeIdentities,
  readAllPracticeHistory,
  practiceHistoryLookbackDays,
  narrowedPracticeIdentityRow,
  PRACTICE_IDENTITY_ROW_SELECT,
  PRACTICE_HISTORY_DEGRADED_REASON,
  claimPracticeIdentity,
  practiceFreshnessVerdict,
} = require("../lib/line-adapters");

const DAY_MS = 24 * 60 * 60 * 1000;

function buildReadyRow(id) {
  const businessName = `Fresh Roofing ${id}`;
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
    status: "new",
    updated_at: "2026-09-04T20:00:00.000Z",
    record: {
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
  return {
    ok: true,
    request: { request_id: requestId, sources: { website_url: website } },
    packet: {
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
    },
    idempotencyKey: requestId,
  };
}

// A practice-history store stub speaking the NARROWED row shape the hardened
// read now selects. `history` may inject failures before serving.
function narrowedHistoryRead({ history = [], failFirst = 0, queries = [], attempts = { count: 0 } } = {}) {
  return async (table, query) => {
    attempts.count += 1;
    queries.push({ table, query });
    if (attempts.count <= failFirst) return { ok: false, mode: "live_select_failed", status: 504, data: [] };
    if (table === "ghost_agency_line_batches") return { ok: true, data: [{ batch_id: "hist_batch_1" }] };
    if (table === "ghost_agency_line_batch_rows") return { ok: true, data: history };
    return { ok: true, data: [] };
  };
}

function withLookbackEnv(value, fn) {
  const previous = process.env.PRACTICE_HISTORY_LOOKBACK_DAYS;
  if (value === undefined) delete process.env.PRACTICE_HISTORY_LOOKBACK_DAYS;
  else process.env.PRACTICE_HISTORY_LOOKBACK_DAYS = String(value);
  return Promise.resolve(fn()).finally(() => {
    if (previous === undefined) delete process.env.PRACTICE_HISTORY_LOOKBACK_DAYS;
    else process.env.PRACTICE_HISTORY_LOOKBACK_DAYS = previous;
  });
}

test("practice history lookback dial: default 90, override, ceiling, invalid", () => {
  delete process.env.PRACTICE_HISTORY_LOOKBACK_DAYS;
  assert.equal(practiceHistoryLookbackDays(), 90);
  assert.equal(practiceHistoryLookbackDays({ PRACTICE_HISTORY_LOOKBACK_DAYS: "7" }), 7);
  assert.equal(practiceHistoryLookbackDays({ PRACTICE_HISTORY_LOOKBACK_DAYS: "abc" }), 90);
  assert.equal(practiceHistoryLookbackDays({ PRACTICE_HISTORY_LOOKBACK_DAYS: "0" }), 90);
  assert.equal(practiceHistoryLookbackDays({ PRACTICE_HISTORY_LOOKBACK_DAYS: "-3" }), 90);
  assert.equal(practiceHistoryLookbackDays({ PRACTICE_HISTORY_LOOKBACK_DAYS: "99999" }), 3650,
    "the ceiling keeps a typo from becoming an unbounded scan");
});

test("transient history read failure retries with backoff and the read succeeds", async () => {
  const queries = [];
  const attempts = { count: 0 };
  const history = [{ prospect_id: "old-1", business_name: "Old Roofing old-1", city: "Reno" }];
  const sleeps = [];
  const result = await readAllPracticeHistory(
    narrowedHistoryRead({ history, failFirst: 1, queries, attempts }),
    { sleep: async (ms) => sleeps.push(ms) },
  );
  assert.equal(result.ok, true);
  assert.equal(attempts.count, 3, "the failed batches page is retried once, then the rows page reads");
  assert.deepEqual(sleeps, [2000], "first backoff step is 2s");
  assert.equal(result.keys.size, 2, "narrowed rows still yield both identity keys");
  const rowsQuery = queries.find((entry) => entry.table === "ghost_agency_line_batch_rows");
  assert.ok(rowsQuery.query.includes("payload->>business_name"), "rows read selects identity JSON paths");
  assert.ok(!/[?&]select=batch_id,prospect_id,payload&/.test(rowsQuery.query),
    "the full payload is no longer selected");
});

test("persistent history read failure degrades honestly instead of failing the read", async () => {
  const attempts = { count: 0 };
  const sleeps = [];
  const result = await readAllPracticeHistory(
    narrowedHistoryRead({ failFirst: Number.POSITIVE_INFINITY, attempts }),
    { sleep: async (ms) => sleeps.push(ms) },
  );
  assert.equal(result.ok, true, "the read reports best-effort success so callers degrade, not die");
  assert.equal(result.degraded, true);
  assert.equal(result.reason, PRACTICE_HISTORY_DEGRADED_REASON);
  assert.equal(result.keys.size, 0);
  assert.equal(attempts.count, 4, "initial attempt plus three retries");
  assert.deepEqual(sleeps, [2000, 5000, 10000]);
});

test("the lookback window bounds the batch scan query", async () => {
  await withLookbackEnv(7, async () => {
    const queries = [];
    const before = Date.now();
    await readAllPracticeHistory(
      narrowedHistoryRead({ queries }),
      { sleep: async () => {} },
    );
    const batchesQuery = queries.find((entry) => entry.table === "ghost_agency_line_batches").query;
    const match = /created_at=gte\.([^&]+)/.exec(batchesQuery);
    assert.ok(match, "the batches scan carries a created_at lower bound");
    const cutoff = Date.parse(decodeURIComponent(match[1]));
    const expected = before - 7 * DAY_MS;
    assert.ok(Math.abs(cutoff - expected) < 5 * 60 * 1000, "7-day dial is honored (within 5 minutes)");
  });
  await withLookbackEnv(undefined, async () => {
    const queries = [];
    await readAllPracticeHistory(narrowedHistoryRead({ queries }), { sleep: async () => {} });
    const batchesQuery = queries.find((entry) => entry.table === "ghost_agency_line_batches").query;
    const match = /created_at=gte\.([^&]+)/.exec(batchesQuery);
    const cutoff = Date.parse(decodeURIComponent(match[1]));
    assert.ok(Math.abs(cutoff - (Date.now() - 90 * DAY_MS)) < 5 * 60 * 1000, "default window is 90 days");
  });
});

test("identity keys still dedupe inside the window from the narrowed read", async () => {
  // Same business identity as the new row below, different prospect id — the
  // business fingerprint key is what must still collide through the narrowed
  // read.
  const fullRow = { prospect_id: "old-1", payload: { business_name: "Fresh Roofing new-1", city: "Reno" } };
  const narrowed = narrowedPracticeIdentityRow({
    prospect_id: "old-1", business_name: "Fresh Roofing new-1", city: "Reno",
  });
  assert.deepEqual(
    [...historicalPracticeIdentities([narrowed])].sort(),
    [...historicalPracticeIdentities([fullRow])].sort(),
    "narrowed rows produce the identical key set as the full-payload read",
  );
  const recordOnly = narrowedPracticeIdentityRow({
    prospect_id: "old-2", record_business_name: "Record Roofing old-2", record_city: "Austin",
  });
  const recordKeys = historicalPracticeIdentities([recordOnly]);
  assert.equal(recordKeys.has("prospect:old-2"), true);
  assert.equal(
    recordKeys.has(`business:${practiceIdentity({ record: { business_name: "Record Roofing old-2", city: "Austin" } }).fingerprint}`),
    true,
    "record.* identity fallbacks survive the narrowed select",
  );
  const row = buildReadyRow("new-1");
  const verdict = await practiceFreshnessVerdict(row, {
    lane: "sandbox",
    operationKey: "hardening-op:new-1",
    historyKeys: historicalPracticeIdentities([narrowed]),
    claim: async () => ({ ok: true }),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "practice_identity_in_prior_history");
});

test("a flaky history read retries inside a live pick and the batch proceeds", async () => {
  const row = buildReadyRow("retry-flow");
  const attempts = { count: 0 };
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades nationwide",
    count: 1,
    lane: "sandbox",
    operationKey: "retry-flow-op",
  }, {
    env: {},
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => ({ ok: true, rows: [{ prospect_id: row.prospect_id, persistence: "created", build_hash: row.record.build_ready.proof.build_hash }], funnel: [] }),
    select: async () => ({ ok: true, data: [row] }),
    readPracticeHistory: (options) => readAllPracticeHistory(
      narrowedHistoryRead({ failFirst: 1, attempts, history: [] }),
      { ...options, sleep: async () => {} },
    ),
    claimPracticeIdentity: async () => ({ ok: true }),
  });
  assert.equal(attempts.count, 3, "the transient failure was retried before the rows page");
  assert.equal(picked.length, 1, "the batch proceeds once the retry lands");
  assert.equal(picked.practiceHistoryDegraded, undefined);
});

test("a dead history read degrades the pick, not the batch: rows flow with the recorded reason", async () => {
  const row = buildReadyRow("degrade-flow");
  let claims = 0;
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades nationwide",
    count: 1,
    lane: "sandbox",
    operationKey: "degrade-flow-op",
  }, {
    env: {},
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => ({ ok: true, rows: [{ prospect_id: row.prospect_id, persistence: "created", build_hash: row.record.build_ready.proof.build_hash }], funnel: [] }),
    select: async () => ({ ok: true, data: [row] }),
    readPracticeHistory: async () => ({ ok: false, reason: "practice_history_read_failed" }),
    claimPracticeIdentity: async () => { claims += 1; return { ok: true }; },
  });
  assert.equal(picked.length, 1, "the batch must NOT mass-refuse when history is unavailable");
  assert.equal(claims >= 1, true, "the durable identity claim still runs (same-window dedupe)");
  assert.equal(picked.practiceHistoryDegraded, PRACTICE_HISTORY_DEGRADED_REASON);
  assert.equal(picked.funnel?.[0]?.stage, "practice_history_degraded");
  assert.equal(picked.funnel?.[0]?.reason, PRACTICE_HISTORY_DEGRADED_REASON);
});

test("degraded history still refuses a row the durable claim already owns", async () => {
  const row = buildReadyRow("claim-conflict");
  let intakeCalls = 0;
  const picked = await pickProspects({
    target: "roofing in Reno NV",
    campaignTarget: "all trades nationwide",
    count: 1,
    lane: "sandbox",
    operationKey: "claim-conflict-op",
  }, {
    env: { VERCEL_ENV: "production" },
    resolveBuildableDonor: () => ({ ok: true, donor: "roofing-donor" }),
    mineLeads: async () => ({ ok: true, rows: [{ prospect_id: row.prospect_id, persistence: "created", build_hash: row.record.build_ready.proof.build_hash }], funnel: [] }),
    select: async () => ({ ok: true, data: [row] }),
    readPracticeHistory: async () => ({ ok: false, reason: "practice_history_read_failed" }),
    claimPracticeIdentity: async () => ({ ok: false, reason: "practice_identity_already_claimed" }),
    callIntakeGenie: async () => { intakeCalls += 1; return compilerResultFor(row); },
  });
  assert.equal(picked.length, 0, "degradation skips the history scan, never the claim law");
  assert.equal(picked.quarantined?.[0]?.reason, "practice_identity_already_claimed");
  assert.equal(intakeCalls, 0);
});

test("claimPracticeIdentity remains race-safe through the hardened read path", async () => {
  const identity = practiceIdentity(buildReadyRow("claim-race-hardening"));
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
    claimPracticeIdentity(identity, { operationKey: "batch-a:claim-race-hardening", write, read }),
    claimPracticeIdentity(identity, { operationKey: "batch-b:claim-race-hardening", write, read }),
  ]);
  assert.equal([first, second].filter((result) => result.ok).length, 1);
  assert.equal([first, second].find((result) => !result.ok)?.reason, "practice_identity_already_claimed");
});

test("the narrowed row select projects exactly the identity fields", () => {
  assert.equal(
    PRACTICE_IDENTITY_ROW_SELECT,
    "prospect_id,"
    + "business_name:payload->>business_name,"
    + "businessName:payload->>businessName,"
    + "city:payload->>city,"
    + "record_business_name:payload->record->>business_name,"
    + "record_businessName:payload->record->>businessName,"
    + "record_city:payload->record->>city",
  );
  const mapped = narrowedPracticeIdentityRow({
    prospect_id: "p1",
    business_name: "A",
    city: "Reno",
    record_business_name: "B",
  });
  assert.deepEqual(mapped, {
    prospect_id: "p1",
    payload: { business_name: "A", city: "Reno", record: { business_name: "B" } },
  });
  const empty = narrowedPracticeIdentityRow({ prospect_id: "p2" });
  assert.deepEqual(empty, { prospect_id: "p2", payload: {} });
});
