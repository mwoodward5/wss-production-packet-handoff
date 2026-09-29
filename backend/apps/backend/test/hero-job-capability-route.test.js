"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const route = require("../api/admin/hero-job-capability");
const capability = require("../lib/hero-job-capability");

const NOW = new Date("2026-08-25T20:00:00.000Z");
const SECRET = "route-unit-worker-secret";
const JOB_ID = "hrj_tulip_fresh";
const PROSPECT_ID = "place_cff96f9ad9d6bb0c8bdcd5adde581541";

function request({ method = "POST", headers = {}, body = {} } = {}) {
  const raw = JSON.stringify(body);
  return {
    method,
    url: "/api/admin/hero-job-capability",
    headers: { "content-type": "application/json", ...headers },
    on(event, callback) {
      if (event === "data") callback(Buffer.from(raw));
      if (event === "end") callback();
      return this;
    },
    setEncoding() { return this; },
  };
}

function response() {
  const captured = { status: 0, body: null, raw: "", headers: {} };
  return {
    captured,
    statusCode: 200,
    setHeader(name, value) { captured.headers[String(name).toLowerCase()] = value; },
    writeHead(code) { this.statusCode = code; return this; },
    end(raw = "") {
      captured.status = this.statusCode;
      captured.raw = String(raw);
      try { captured.body = JSON.parse(raw); } catch { captured.body = raw; }
    },
  };
}

function tulipJob(overrides = {}) {
  return {
    jobId: JOB_ID,
    prospectId: PROSPECT_ID,
    producer: "openrouter_seedance",
    status: "queued",
    attempts: 0,
    payload: {
      generation_revision: 1,
      line_handle: { batchId: "line_req_tulip_fresh", rowId: "row_tulip_1" },
    },
    result: null,
    leaseToken: "",
    leaseOwner: "",
    leaseExpiresAt: null,
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function handler(overrides = {}) {
  return route.createHeroJobCapabilityHandler({
    env: {},
    now: () => new Date(NOW),
    newJti: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    adminAllowed: (req) => ({
      allowed: req.headers["x-admin-token"] === "admin-session",
      configured: true,
    }),
    requireAdmin: (req) => req.headers["x-admin-token"] === "admin-session",
    heroWorkerAuthState: () => ({ configured: true, valid: true, token: SECRET }),
    getHeroReelJob: async () => ({ ok: true, job: tulipJob() }),
    nextQueuedSeedanceJob: async () => ({ ok: true, job: tulipJob() }),
    recordHeroJobCapabilityGrant: async () => ({ ok: true, reused: false }),
    claimHeroReelJobWithCapability: async () => ({ ok: true, reused: false, job: { job_id: JOB_ID, lease_token: "lease-tulip" } }),
    validateHeroReelJobCapabilityLease: async () => ({ ok: true, job: tulipJob({ status: "running" }), grant: {} }),
    renewHeroReelJobCapabilityLease: async () => ({ ok: true, lease_expires_at: "2026-08-25T21:00:00.000Z" }),
    checkpointHeroReelJob: async () => ({ ok: true, checkpoint: {} }),
    settleHeroReelJobWithCapability: async () => ({ ok: true, job: { job_id: JOB_ID, status: "awaiting_review" } }),
    requeueApprovedHeroUpload: async () => ({ ok: true, job: { job_id: JOB_ID, status: "queued" } }),
    ...overrides,
  });
}

test("Comet admin mint derives the exact Tulip capability without exposing JTI or server credentials", async () => {
  let recorded;
  const h = handler({
    recordHeroJobCapabilityGrant: async (input) => {
      recorded = input;
      return { ok: true, reused: false };
    },
  });
  const r = response();
  await h(request({
    headers: { "x-admin-token": "admin-session" },
    body: { action: "mint", phase: "generate", job_id: JOB_ID, prospect_id: PROSPECT_ID },
  }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.job_id, JOB_ID);
  assert.equal(r.captured.body.prospect_id, PROSPECT_ID);
  assert.equal(recorded.jobId, JOB_ID);
  assert.equal(recorded.claims.batch_id, "line_req_tulip_fresh");
  assert.equal(recorded.claims.row_id, "row_tulip_1");
  assert.equal(recorded.claims.attempt, 0);
  const launch = JSON.parse(r.captured.body.launch_capsule);
  assert.equal(launch.phase, "generate");
  assert.equal(capability.verifyHeroJobCapability(SECRET, launch.capability, { nowMs: NOW.getTime() }).ok, true);
  const publicBody = JSON.stringify({ ...r.captured.body, launch_capsule: "[opaque]" });
  assert.doesNotMatch(publicBody, /jti|worker-secret|lease_token/i);
});

test("mint refuses a wrong prospect and static worker cannot choose a target", async () => {
  let writes = 0;
  const h = handler({ recordHeroJobCapabilityGrant: async () => { writes += 1; return { ok: true }; } });
  const mismatch = response();
  await h(request({
    headers: { "x-admin-token": "admin-session" },
    body: { action: "mint", phase: "generate", job_id: JOB_ID, prospect_id: "place_wrong" },
  }), mismatch);
  assert.equal(mismatch.captured.status, 409);
  assert.equal(mismatch.captured.body.error, "capability_target_conflict");

  const worker = response();
  await h(request({
    headers: { "x-ghost-hero-worker-token": "static-worker" },
    body: { action: "mint", phase: "generate", job_id: JOB_ID, prospect_id: PROSPECT_ID },
  }), worker);
  assert.equal(worker.captured.status, 401);
  assert.equal(worker.captured.body.error, "unauthorized");
  assert.equal(writes, 0);
});

test("static worker receives one server-selected exact-job capsule and cannot name work", async () => {
  let grants = 0;
  const h = handler({
    recordHeroJobCapabilityGrant: async (input) => {
      grants += 1;
      assert.equal(input.jobId, JOB_ID);
      assert.equal(input.claims.batch_id, "line_req_tulip_fresh");
      assert.equal(input.claims.row_id, "row_tulip_1");
      return { ok: true };
    },
  });
  const r = response();
  await h(request({
    headers: { "x-ghost-hero-worker-token": SECRET },
    body: { action: "next" },
  }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(grants, 1);
  assert.equal("job_id" in r.captured.body, false);
  assert.equal("prospect_id" in r.captured.body, false);
  const capsule = JSON.parse(r.captured.body.launch_capsule);
  const verified = capability.verifyHeroJobCapability(SECRET, capsule.capability, { nowMs: NOW.getTime() });
  assert.equal(verified.ok, true);
  assert.equal(verified.claims.job_id, JOB_ID);

  const arbitrary = response();
  await h(request({
    headers: { "x-ghost-hero-worker-token": SECRET },
    body: { action: "next", job_id: "attacker-choice" },
  }), arbitrary);
  assert.equal(arbitrary.captured.status, 403);
});

test("Practice worker can request only one exact sandbox batch row", async () => {
  let selectedScope;
  const h = handler({
    nextQueuedSeedanceJob: async (scope) => {
      selectedScope = scope;
      return { ok: true, job: tulipJob() };
    },
  });
  const r = response();
  await h(request({
    headers: { "x-ghost-hero-worker-token": SECRET },
    body: {
      action: "next",
      practice: true,
      batch_id: "line_req_tulip_fresh",
      row_id: "row_tulip_1",
    },
  }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(selectedScope.practice, true);
  assert.equal(selectedScope.practiceBatchId, "line_req_tulip_fresh");
  assert.equal(selectedScope.practiceRowId, "row_tulip_1");
  assert.equal(typeof selectedScope.mintProbe, "function");

  const partial = response();
  await h(request({
    headers: { "x-ghost-hero-worker-token": SECRET },
    body: { action: "next", practice: true, batch_id: "line_req_tulip_fresh" },
  }), partial);
  assert.equal(partial.captured.status, 403);
});

test("one capability header can only redeem claim and does not echo the capability", async () => {
  const claims = capability.newHeroJobCapabilityClaims({
    phase: "generate",
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    producer: "openrouter_seedance",
    generation_revision: 1,
    attempt: 0,
    batch_id: "line_req_tulip_fresh",
    row_id: "row_tulip_1",
  }, { nowMs: NOW.getTime(), jti: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  const token = capability.signHeroJobCapability(SECRET, claims);
  const redemptionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  let claimInput;
  const h = handler({ claimHeroReelJobWithCapability: async (input) => {
    claimInput = input;
    return { ok: true, reused: false, job: { job_id: JOB_ID, lease_token: "lease-tulip" } };
  } });
  const r = response();
  await h(request({
    headers: { "x-ghost-hero-job-capability": token },
    body: { action: "claim", redemption_id: redemptionId },
  }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.job.job_id, JOB_ID);
  assert.equal(claimInput.redemptionId, redemptionId);
  assert.doesNotMatch(JSON.stringify(r.captured.body), new RegExp(redemptionId, "i"));
  assert.doesNotMatch(JSON.stringify(r.captured.body), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const forbidden = response();
  await h(request({
    headers: { "x-ghost-hero-job-capability": token },
    body: { action: "settle", redemption_id: redemptionId },
  }), forbidden);
  assert.equal(forbidden.captured.status, 403);
  assert.equal(forbidden.captured.body.error, "capability_action_forbidden");
});

test("lease action matrix refuses approve, complete, and arbitrary work", async () => {
  const h = handler();
  for (const body of [
    { action: "settle", job_id: JOB_ID, outcome: "complete", verdict: {} },
    { action: "approve", job_id: JOB_ID },
    { action: "claim", job_id: "another-job" },
  ]) {
    const r = response();
    await h(request({ headers: { "x-ghost-hero-job-lease": "lease-tulip" }, body }), r);
    assert.equal(r.captured.status, 403);
    assert.equal(r.captured.body.error, "capability_action_forbidden");
  }
});

test("lease settlement delegates to the capability-bound queue transition", async () => {
  let settledInput;
  const h = handler({
    settleHeroReelJobWithCapability: async (input) => {
      settledInput = input;
      return { ok: true, reused: false, job: { job_id: JOB_ID, status: "queued" } };
    },
  });
  const r = response();
  await h(request({
    headers: { "x-ghost-hero-job-lease": "lease-tulip" },
    body: {
      action: "settle",
      job_id: JOB_ID,
      outcome: "requeue",
      verdict: { reason: "worker_retry" },
    },
  }), r);
  assert.equal(r.captured.status, 200);
  assert.deepEqual(settledInput, {
    jobId: JOB_ID,
    leaseToken: "lease-tulip",
    action: "requeue",
    verdict: { reason: "worker_retry" },
  });
});

test("admin mint recovers one exact expired redeemed row but refuses its live lease", async () => {
  const oldClaims = capability.newHeroJobCapabilityClaims({
    phase: "generate",
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    producer: "openrouter_seedance",
    generation_revision: 1,
    attempt: 0,
    batch_id: "line_req_tulip_fresh",
    row_id: "row_tulip_1",
  }, { nowMs: NOW.getTime() - 60_000, jti: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  const oldGrant = {
    ...capability.heroJobCapabilityGrant(oldClaims),
    redemption_sha256: "1".repeat(64),
    redeemed_at: new Date(NOW.getTime() - 50_000).toISOString(),
    redeemed_lease_sha256: "2".repeat(64),
  };
  let recorded;
  const expired = handler({
    getHeroReelJob: async () => ({ ok: true, job: tulipJob({
      status: "running",
      attempts: 1,
      leaseToken: "expired-lease",
      leaseOwner: "cap_generate_deadbeef",
      leaseExpiresAt: new Date(NOW.getTime() - 1).toISOString(),
      payload: {
        generation_revision: 1,
        line_handle: { batchId: "line_req_tulip_fresh", rowId: "row_tulip_1" },
        hero_job_capability_grant: oldGrant,
      },
      result: { provider_checkpoint: { schema_version: "wss.hero.seedance_provider_checkpoint.v1" } },
    }) }),
    recordHeroJobCapabilityGrant: async (input) => { recorded = input; return { ok: true, recovered: true }; },
  });
  const recovered = response();
  await expired(request({
    headers: { "x-admin-token": "admin-session" },
    body: { action: "mint", phase: "generate", job_id: JOB_ID, prospect_id: PROSPECT_ID },
  }), recovered);
  assert.equal(recovered.captured.status, 200);
  assert.equal(recorded.allowExpiredRecovery, true);
  assert.equal(recorded.expectedGrantJtiSha256, oldGrant.jti_sha256);
  assert.equal(recorded.claims.attempt, 1);

  let checkpointlessWrites = 0;
  const checkpointless = handler({
    getHeroReelJob: async () => ({ ok: true, job: tulipJob({
      status: "running",
      attempts: 1,
      leaseToken: "expired-lease-no-checkpoint",
      leaseOwner: "cap_generate_deadbeef",
      leaseExpiresAt: new Date(NOW.getTime() - 1).toISOString(),
      payload: {
        generation_revision: 1,
        line_handle: { batchId: "line_req_tulip_fresh", rowId: "row_tulip_1" },
        hero_job_capability_grant: oldGrant,
      },
      result: null,
    }) }),
    recordHeroJobCapabilityGrant: async () => { checkpointlessWrites += 1; return { ok: true }; },
  });
  const checkpointlessResponse = response();
  await checkpointless(request({
    headers: { "x-admin-token": "admin-session" },
    body: { action: "mint", phase: "generate", job_id: JOB_ID, prospect_id: PROSPECT_ID },
  }), checkpointlessResponse);
  assert.equal(checkpointlessResponse.captured.status, 409);
  assert.equal(checkpointlessResponse.captured.body.error, "capability_target_conflict");
  assert.equal(checkpointlessWrites, 0, "no checkpoint means no remint or queue reset");

  let liveWrites = 0;
  const live = handler({
    getHeroReelJob: async () => ({ ok: true, job: tulipJob({
      status: "running",
      attempts: 1,
      leaseToken: "live-lease",
      leaseOwner: "cap_generate_deadbeef",
      leaseExpiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      payload: {
        generation_revision: 1,
        line_handle: { batchId: "line_req_tulip_fresh", rowId: "row_tulip_1" },
        hero_job_capability_grant: oldGrant,
      },
    }) }),
    recordHeroJobCapabilityGrant: async () => { liveWrites += 1; return { ok: true }; },
  });
  const refused = response();
  await live(request({
    headers: { "x-admin-token": "admin-session" },
    body: { action: "mint", phase: "generate", job_id: JOB_ID, prospect_id: PROSPECT_ID },
  }), refused);
  assert.equal(refused.captured.status, 409);
  assert.equal(liveWrites, 0);
});

test("capability expiry is a terminal client conflict, never a queue outage", async () => {
  const claims = capability.newHeroJobCapabilityClaims({
    phase: "generate",
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    producer: "openrouter_seedance",
    generation_revision: 1,
    attempt: 0,
    batch_id: "line_req_tulip_fresh",
    row_id: "row_tulip_1",
  }, { nowMs: NOW.getTime(), jti: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
  const token = capability.signHeroJobCapability(SECRET, claims);
  const h = handler({ claimHeroReelJobWithCapability: async () => ({ ok: false, error: "capability_expired" }) });
  const r = response();
  await h(request({
    headers: { "x-ghost-hero-job-capability": token },
    body: { action: "claim", redemption_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
  }), r);
  assert.equal(r.captured.status, 410);
  assert.equal(r.captured.body.error, "capability_expired");
});

test("Comet mint page keeps credentials out of URLs and storage", async () => {
  const h = handler();
  const r = response();
  await h(request({ method: "GET" }), r);
  assert.equal(r.captured.status, 200);
  assert.match(r.captured.headers["cache-control"], /no-store/);
  assert.match(r.captured.raw, /wsl_admin_token/);
  assert.match(r.captured.raw, /x-admin-token/);
  assert.doesNotMatch(r.captured.raw, /setItem\([^)]*(?:capability|capsule)/i);
  assert.doesNotMatch(r.captured.raw, /location\.(?:href|search).*capability/i);
  assert.doesNotMatch(r.captured.raw, new RegExp(PROSPECT_ID, "i"));
  assert.match(r.captured.raw, /90000/);
});

test("the broker skips durably-halted-parent candidates and goes idle only when all are dead", async () => {
  const { nextQueuedSeedanceJob } = require("../api/admin/hero-job-capability");
  const batchStatus = { line_dead_a: "halted", line_dead_b: "halted", line_live: "building" };
  const rows = [
    { job_id: "hrj_dead_1", producer: "openrouter_seedance", status: "queued", lease_token: null, payload: { line_handle: { batchId: "line_dead_a", rowId: "r1" } } },
    { job_id: "hrj_dead_2", producer: "openrouter_seedance", status: "queued", lease_token: null, payload: { line_handle: { batchId: "line_dead_b", rowId: "r2" } } },
    { job_id: "hrj_dead_3", producer: "openrouter_seedance", status: "queued", lease_token: null, payload: { line_handle: { batchId: "line_missing", rowId: "r3" } } },
    { job_id: "hrj_live", producer: "openrouter_seedance", status: "queued", lease_token: null, payload: { line_handle: { batchId: "line_live", rowId: "r4" } } },
  ];
  const updates = [];
  const select = async (table, query) => {
    if (table === "ghost_agency_hero_reel_jobs") return { ok: true, data: rows.map((row) => structuredClone(row)) };
    if (table === "ghost_agency_line_batches") {
      const id = /batch_id=eq\.([^&]+)/.exec(query)[1];
      if (!batchStatus[id]) return { ok: true, data: [] };
      return { ok: true, data: [{ status: batchStatus[id] }] };
    }
    return { ok: false };
  };
  const conditionalUpdate = async (table, key, id, guards, patch) => {
    updates.push({ table, key, id, guards, patch });
    const row = rows.find((candidate) => candidate[key] === id);
    if (row) {
      row.status = "failed";
      row.result = patch.result;
    }
    return { ok: true, updated: true, rows: [] };
  };

  const picked = await nextQueuedSeedanceJob({ select, conditionalUpdate });
  assert.equal(picked.ok, true);
  assert.equal(picked.job.jobId, "hrj_live", "the live-batch hero behind dead-parent candidates must be picked");
  assert.equal(updates.length, 3, "each dead-parent candidate is retired exactly once");
  for (const update of updates) {
    assert.equal(update.id.startsWith("hrj_dead_") || update.id === "hrj_dead_3", true, update.id);
    assert.equal(update.patch.status, "failed");
    assert.equal(update.patch.result.reason, "parent_line_batch_halted");
    assert.equal(update.guards.status, "eq.queued");
    assert.equal(update.guards.lease_token, "is.null");
  }
  assert.deepEqual(picked.job.payload.line_handle, { batchId: "line_live", rowId: "r4" });

  const allDead = await nextQueuedSeedanceJob({ select: async (table, query) => {
    if (table === "ghost_agency_hero_reel_jobs") return { ok: true, data: rows.slice(0, 3).map((row) => structuredClone(row)) };
    if (table === "ghost_agency_line_batches") {
      const id = /batch_id=eq\.([^&]+)/.exec(query)[1];
      return id === "line_missing" ? { ok: true, data: [] } : { ok: true, data: [{ status: "halted" }] };
    }
    return { ok: false };
  } });
  assert.equal(allDead.ok, true);
  assert.equal(allDead.job, null, "an all-dead candidate window is an idle wave, never a hard error");
});

test("the selector consumes the request-scoped mint probe and skips an unmintable candidate", async () => {
  const { nextQueuedSeedanceJob } = require("../api/admin/hero-job-capability");
  const rows = [
    { job_id: "hrj_unmintable", prospect_id: "place_unmintable", producer: "openrouter_seedance", status: "queued", lease_token: null, payload: { generation_revision: 1, line_handle: { batchId: "line_live", rowId: "row_bad" } } },
    { job_id: "hrj_mintable", prospect_id: "place_mintable", producer: "openrouter_seedance", status: "queued", lease_token: null, payload: { generation_revision: 1, line_handle: { batchId: "line_live", rowId: "row_good" } } },
  ];
  const retired = [];
  const probed = [];
  const mintProbe = async (job) => {
    probed.push(job.jobId);
    return job.jobId === "hrj_unmintable"
      ? { ok: false, reason: "capability_target_conflict" }
      : { ok: true, job, claims: { phase: "generate", job_id: job.jobId }, token: "opaque-capability" };
  };
  const selected = await nextQueuedSeedanceJob({
    select: async (table) => table === "ghost_agency_hero_reel_jobs"
      ? { ok: true, data: rows.map((row) => structuredClone(row)) }
      : { ok: true, data: [{ status: "building", lane: "sandbox" }] },
    conditionalUpdate: async (_table, _key, id, guards, patch) => {
      retired.push({ id, guards, patch });
      return { ok: true, updated: true, rows: [] };
    },
  }, { mintProbe });

  assert.deepEqual(probed, ["hrj_unmintable", "hrj_mintable"]);
  assert.equal(retired.length, 1);
  assert.equal(retired[0].id, "hrj_unmintable");
  assert.equal(retired[0].patch.result.reason, "capability_target_conflict");
  assert.equal(selected.ok, true);
  assert.equal(selected.job.jobId, "hrj_mintable");
  assert.equal(selected.claims.job_id, "hrj_mintable");
  assert.equal(selected.token, "opaque-capability");
});

test("Practice selector never picks or mutates a queued job outside the exact sandbox row", async () => {
  const { nextQueuedSeedanceJob } = require("../api/admin/hero-job-capability");
  const rows = [
    { job_id: "hrj_live_send", producer: "openrouter_seedance", status: "queued", lease_token: null, payload: { line_handle: { batchId: "line_live_send", rowId: "row_live" } } },
    { job_id: "hrj_practice", producer: "openrouter_seedance", status: "queued", lease_token: null, payload: { line_handle: { batchId: "line_practice", rowId: "row_practice" } } },
  ];
  const queries = [];
  let mutations = 0;
  const picked = await nextQueuedSeedanceJob({
    select: async (table, query) => {
      queries.push({ table, query });
      if (table === "ghost_agency_hero_reel_jobs") return { ok: true, data: rows.map((row) => structuredClone(row)) };
      if (table === "ghost_agency_line_batches") return { ok: true, data: [{ status: "building", lane: "sandbox" }] };
      return { ok: false };
    },
    conditionalUpdate: async () => { mutations += 1; return { ok: true }; },
  }, {
    practice: true,
    practiceBatchId: "line_practice",
    practiceRowId: "row_practice",
  });
  assert.equal(picked.ok, true);
  assert.equal(picked.job.jobId, "hrj_practice");
  assert.equal(mutations, 0);
  assert.match(queries[0].query, /payload->line_handle->>batchId=eq\.line_practice/);
  assert.match(queries[0].query, /payload->line_handle->>rowId=eq\.row_practice/);

  const approvedSha = "a".repeat(64);
  const approvedUpload = {
    ...structuredClone(rows[1]),
    attempts: 99,
    updated_at: "2026-08-29T19:59:00.000Z",
    payload: {
      ...structuredClone(rows[1].payload),
      approved_clip: { approved: true, sha256: approvedSha },
      approved_artifact: { clip_sha256: approvedSha },
    },
    result: {
      approved: true,
      clip_sha256: approvedSha,
      provider_checkpoint: {
        submission_state: "accepted",
        submitted_at: "2026-08-01T00:00:00.000Z",
        polling_url: "https://openrouter.ai/api/v1/videos/approved-upload",
      },
    },
  };
  const approvedPicked = await nextQueuedSeedanceJob({
    now: () => new Date("2026-08-29T20:00:00.000Z"),
    select: async (table) => table === "ghost_agency_hero_reel_jobs"
      ? { ok: true, data: [approvedUpload] }
      : { ok: true, data: [{ status: "building", lane: "sandbox" }] },
    conditionalUpdate: async () => { mutations += 1; return { ok: true }; },
  }, {
    practice: true,
    practiceBatchId: "line_practice",
    practiceRowId: "row_practice",
  });
  assert.equal(approvedPicked.job.jobId, "hrj_practice");
  assert.equal(mutations, 0, "approved bytes bypass paid-generation budget retirement");

  const hostileLiveJob = structuredClone(rows[1]);
  hostileLiveJob.attempts = 99;
  hostileLiveJob.result = {
    provider_checkpoint: {
      submission_state: "accepted",
      submitted_at: "2026-08-01T00:00:00.000Z",
      polling_url: "https://openrouter.ai/api/v1/videos/live-job",
    },
  };
  const liveParent = await nextQueuedSeedanceJob({
    select: async (table) => table === "ghost_agency_hero_reel_jobs"
      ? { ok: true, data: [hostileLiveJob] }
      : { ok: true, data: [{ status: "building", lane: "live" }] },
    conditionalUpdate: async () => { mutations += 1; return { ok: true }; },
  }, {
    practice: true,
    practiceBatchId: "line_practice",
    practiceRowId: "row_practice",
  });
  assert.deepEqual(liveParent, { ok: false, error: "practice_target_not_sandbox" });
  assert.equal(mutations, 0, "a non-Practice parent is never spent or rewritten");
});

test("the broker terminally retires an expired accepted checkpoint before minting fresh work", async () => {
  const { nextQueuedSeedanceJob } = require("../api/admin/hero-job-capability");
  const rows = [{
    job_id: "hrj_expired_accepted",
    producer: "openrouter_seedance",
    status: "queued",
    attempts: 2,
    lease_token: null,
    created_at: "2026-08-29T00:00:00.000Z",
    payload: {},
    result: {
      provider_checkpoint: {
        submission_state: "accepted",
        submitted_at: "2026-08-29T00:01:00.000Z",
        polling_url: "https://openrouter.ai/api/v1/videos/expired",
      },
    },
  }, {
    job_id: "hrj_fresh",
    producer: "openrouter_seedance",
    status: "queued",
    attempts: 0,
    lease_token: null,
    created_at: "2026-08-29T07:59:00.000Z",
    payload: {},
    result: null,
  }];
  const updates = [];
  const picked = await nextQueuedSeedanceJob({
    now: () => new Date("2026-08-29T08:00:00.000Z"),
    select: async () => ({ ok: true, data: rows.map((row) => structuredClone(row)) }),
    conditionalUpdate: async (_table, _key, id, guards, patch) => {
      updates.push({ id, guards, patch });
      return { ok: true, updated: true, rows: [] };
    },
  });

  assert.equal(picked.job.jobId, "hrj_fresh");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "hrj_expired_accepted");
  assert.equal(updates[0].patch.status, "failed");
  assert.equal(updates[0].patch.result.reason, "openrouter_accepted_checkpoint_expired");
  assert.equal(updates[0].patch.result.provider_checkpoint.polling_url, "https://openrouter.ai/api/v1/videos/expired");
});
