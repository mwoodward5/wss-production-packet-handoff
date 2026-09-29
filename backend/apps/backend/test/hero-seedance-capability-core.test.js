"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");

const capability = require("../lib/hero-job-capability");
const jobs = require("../lib/hero-reel-job-queue");
const { stableSerialize } = require("../lib/wan-hero-policy");

const NOW = Date.parse("2026-08-25T20:00:00.000Z");
const SECRET = "unit-only-worker-secret";
const JOB_ID = "hrj_tulip_1";
const PROSPECT_ID = "place_cff96f9ad9d6bb0c8bdcd5adde581541";
const BATCH_ID = "line_req_tulip_fresh";
const ROW_ID = "row_tulip_1";
const APPROVED_SHA = "a".repeat(64);
const REDEMPTION_A = "77777777-7777-4777-8777-777777777777";
const REDEMPTION_B = "88888888-8888-4888-8888-888888888888";

function claims(phase = "generate", overrides = {}) {
  return capability.newHeroJobCapabilityClaims({
    phase,
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    producer: "openrouter_seedance",
    generation_revision: 1,
    attempt: 0,
    batch_id: BATCH_ID,
    row_id: ROW_ID,
    ...(phase === "upload" ? { approved_sha256: APPROVED_SHA } : {}),
    ...overrides,
  }, {
    nowMs: NOW,
    jti: overrides.jti || "11111111-1111-4111-8111-111111111111",
  });
}

function jsonValue(row, key) {
  if (!key.includes("->")) return row[key];
  const parts = key.split("->");
  let value = row[parts.shift()];
  for (const raw of parts) value = value?.[raw.replace(/^>/, "")];
  return value;
}

function guardPass(row, guards) {
  return Object.entries(guards || {}).every(([key, condition]) => {
    const value = jsonValue(row, key);
    const filter = String(condition);
    if (filter === "is.null") return value === null || value === undefined || value === "";
    if (filter.startsWith("eq.")) return String(value ?? "") === filter.slice(3);
    if (filter.startsWith("gt.")) return Date.parse(String(value || "")) > Date.parse(filter.slice(3));
    if (filter.startsWith("lte.")) return Date.parse(String(value || "")) <= Date.parse(filter.slice(4));
    return false;
  });
}

function memoryQueue({ upload = false } = {}) {
  let now = NOW;
  let lease = 0;
  const approved = upload ? {
    approved_clip: { approved: true, sha256: APPROVED_SHA, approved_by: "Mark", approved_at: "2026-08-25T19:59:00.000Z" },
    approved_artifact: { clip_sha256: APPROVED_SHA },
    optimized_asset: { sha256: "b".repeat(64) },
  } : {};
  const rows = [{
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    producer: "openrouter_seedance",
    status: "queued",
    attempts: 0,
    payload: {
      generation_revision: 1,
      duration_seconds: 8,
      line_handle: { batchId: BATCH_ID, rowId: ROW_ID },
      ...approved,
    },
    result: upload ? { action: "approve", approved: true, clip_sha256: APPROVED_SHA } : null,
    lease_token: null,
    lease_owner: null,
    lease_expires_at: null,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    finished_at: null,
  }];
  const queue = jobs.createHeroReelJobQueue({
    env: {},
    now: () => new Date(now),
    newLeaseToken: () => `lease-${++lease}`,
    select: async (_table, query) => {
      const match = /job_id=eq\.([^&]+)/.exec(String(query));
      const selected = match
        ? rows.filter((row) => row.job_id === decodeURIComponent(match[1]))
        : rows;
      return { ok: true, data: structuredClone(selected) };
    },
    conditionalUpdate: async (_table, key, id, guards, patch) => {
      const row = rows.find((item) => item[key] === id);
      if (!row || !guardPass(row, guards)) return { ok: true, updated: false, rows: [] };
      Object.assign(row, structuredClone(patch));
      return { ok: true, updated: true, rows: [structuredClone(row)] };
    },
  });
  return { queue, rows, advance(ms) { now += ms; } };
}

test("capabilities are canonical, phase-separated, time-bounded, and tamper evident", () => {
  const generate = claims();
  const token = capability.signHeroJobCapability(SECRET, generate);
  assert.deepEqual(capability.verifyHeroJobCapability(SECRET, token, { nowMs: NOW }), { ok: true, claims: generate });
  assert.equal(capability.verifyHeroJobCapability("wrong", token, { nowMs: NOW }).ok, false);
  assert.equal(capability.verifyHeroJobCapability(SECRET, `${token.slice(0, -1)}x`, { nowMs: NOW }).ok, false);
  assert.equal(capability.verifyHeroJobCapability(SECRET, token, { nowMs: NOW, expectedPhase: "upload" }).error, "capability_phase_mismatch");
  assert.equal(capability.verifyHeroJobCapability(SECRET, token, {
    nowMs: NOW + (capability.HERO_JOB_CAPABILITY_TTL_SECONDS.generate + 31) * 1000,
  }).error, "capability_expired");

  const upload = claims("upload", { jti: "22222222-2222-4222-8222-222222222222" });
  const uploadToken = capability.signHeroJobCapability(SECRET, upload);
  assert.equal(capability.verifyHeroJobCapability(SECRET, uploadToken, { nowMs: NOW, expectedPhase: "upload" }).ok, true);
  assert.throws(() => capability.canonicalHeroJobCapabilityClaims({ ...upload, approved_sha256: "bad" }), /capability_approved_sha256_invalid/);
  assert.throws(() => capability.canonicalHeroJobCapabilityClaims({ ...generate, extra: true }), /capability_claims_not_canonical/);
  assert.equal(capability.verifyHeroJobCapability(SECRET, "wss1." + "a".repeat(5000) + ".x", { nowMs: NOW }).ok, false);
});

test("one generate capability creates one exact lease and lost-response replay returns that lease", async () => {
  const h = memoryQueue();
  const grantClaims = claims();
  const granted = await h.queue.recordHeroJobCapabilityGrant({ jobId: JOB_ID, claims: grantClaims, expectedGrantJtiSha256: "" });
  assert.equal(granted.ok, true);
  assert.equal(granted.reused, false);
  assert.doesNotMatch(JSON.stringify(granted), /jti|capability|lease_token/i);
  assert.equal(h.rows[0].payload.hero_job_capability_grant.jti, undefined);
  assert.match(h.rows[0].payload.hero_job_capability_grant.jti_sha256, /^[0-9a-f]{64}$/);
  h.rows[0].payload.hero_job_capability_grant = Object.fromEntries(
    Object.entries(h.rows[0].payload.hero_job_capability_grant).reverse(),
  );

  const first = await h.queue.claimHeroReelJobWithCapability({ claims: grantClaims, redemptionId: REDEMPTION_A });
  const replay = await h.queue.claimHeroReelJobWithCapability({ claims: grantClaims, redemptionId: REDEMPTION_A });
  assert.equal(first.ok, true);
  assert.equal(first.reused, false);
  assert.equal(replay.ok, true);
  assert.equal(replay.reused, true);
  assert.equal(first.job.lease_token, replay.job.lease_token);
  assert.equal(h.rows[0].attempts, 1);
  assert.equal(h.rows[0].status, "running");
  assert.match(h.rows[0].payload.hero_job_capability_grant.redemption_sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(first), new RegExp(REDEMPTION_A, "i"));
  assert.ok(Date.parse(first.job.lease_expires_at) <= grantClaims.exp * 1000 - capability.HERO_JOB_CAPABILITY_LEASE_MARGIN_MS);
  assert.doesNotMatch(JSON.stringify(first.job), /hero_job_capability_grant|jti_sha256|capability_token/i);
  h.advance(11 * 60 * 1000);
  const lateReplay = await h.queue.claimHeroReelJobWithCapability({
    claims: grantClaims,
    redemptionId: REDEMPTION_A,
  });
  assert.equal(lateReplay.ok, true, "same redeemer keeps its live lease after the fresh-claim window closes");
  assert.equal(lateReplay.job.lease_token, first.job.lease_token);
});

test("capability settlement binds the first transition and replays only the exact lost response", async () => {
  const h = memoryQueue();
  const grantClaims = claims("generate", { jti: "23232323-2323-4323-8323-232323232323" });
  assert.equal((await h.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID, claims: grantClaims, expectedGrantJtiSha256: "",
  })).ok, true);
  const claimed = await h.queue.claimHeroReelJobWithCapability({
    claims: grantClaims,
    redemptionId: REDEMPTION_A,
  });
  assert.equal(claimed.ok, true);
  const input = {
    jobId: JOB_ID,
    action: "requeue",
    leaseToken: claimed.job.lease_token,
    verdict: { reason: "worker_retry" },
  };
  const settled = await h.queue.settleHeroReelJobWithCapability(input);
  assert.equal(settled.ok, true, JSON.stringify(settled));
  assert.equal(settled.reused, false);
  assert.equal(h.rows[0].status, "queued");

  const replay = await h.queue.settleHeroReelJobWithCapability(input);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.reused, true);
  const changedOutcome = await h.queue.settleHeroReelJobWithCapability({
    ...input,
    action: "fail",
  });
  assert.equal(changedOutcome.ok, false);
  assert.equal(changedOutcome.error, "capability_lease_conflict");

  const foreign = memoryQueue();
  assert.equal((await foreign.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID, claims: grantClaims, expectedGrantJtiSha256: "",
  })).ok, true);
  const foreignClaim = await foreign.queue.claimHeroReelJobWithCapability({
    claims: grantClaims,
    redemptionId: REDEMPTION_A,
  });
  foreign.rows[0].lease_owner = "generic-worker";
  const refused = await foreign.queue.settleHeroReelJobWithCapability({
    jobId: JOB_ID,
    action: "requeue",
    leaseToken: foreignClaim.job.lease_token,
    verdict: { reason: "must_not_settle" },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "capability_lease_conflict");
  assert.equal(foreign.rows[0].status, "running");
});

test("concurrent grants and claims cannot create two Seedance leases", async () => {
  const h = memoryQueue();
  const firstClaims = claims("generate", { jti: "33333333-3333-4333-8333-333333333333" });
  const secondClaims = claims("generate", { jti: "44444444-4444-4444-8444-444444444444" });
  const grants = await Promise.all([
    h.queue.recordHeroJobCapabilityGrant({ jobId: JOB_ID, claims: firstClaims, expectedGrantJtiSha256: "" }),
    h.queue.recordHeroJobCapabilityGrant({ jobId: JOB_ID, claims: secondClaims, expectedGrantJtiSha256: "" }),
  ]);
  assert.equal(grants.filter((result) => result.ok).length, 1);
  const winning = grants[0].ok ? firstClaims : secondClaims;
  const losing = grants[0].ok ? secondClaims : firstClaims;
  assert.equal((await h.queue.claimHeroReelJobWithCapability({ claims: losing, redemptionId: REDEMPTION_A })).ok, false);
  assert.equal((await h.queue.claimHeroReelJobWithCapability({ claims: winning, redemptionId: REDEMPTION_A })).ok, true);
  assert.equal(h.rows[0].attempts, 1);
});

test("one capability cannot give its live lease to a different concurrent redeemer", async () => {
  const h = memoryQueue();
  const grantClaims = claims("generate", { jti: "99999999-9999-4999-8999-999999999999" });
  assert.equal((await h.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID, claims: grantClaims, expectedGrantJtiSha256: "",
  })).ok, true);
  const results = await Promise.all([
    h.queue.claimHeroReelJobWithCapability({ claims: grantClaims, redemptionId: REDEMPTION_A }),
    h.queue.claimHeroReelJobWithCapability({ claims: grantClaims, redemptionId: REDEMPTION_B }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.error === "capability_replay_conflict").length, 1);
  assert.equal(h.rows[0].attempts, 1);
  assert.equal((await h.queue.claimHeroReelJobWithCapability({
    claims: grantClaims,
    redemptionId: results[0].ok ? REDEMPTION_B : REDEMPTION_A,
  })).ok, false);
});

test("admin remint atomically recovers only an expired redeemed lease and preserves its submit checkpoint", async () => {
  const h = memoryQueue();
  h.rows[0].payload.duration_seconds = 4;
  const sourceSha = "9".repeat(64);
  h.rows[0].payload.photo_bank = {
    version: 1,
    harvested_at: "2026-08-25T19:50:00.000Z",
    website: "https://tulip.example/",
    photos: [{
      url: "https://tulip.example/work/hero.jpg",
      sha256: sourceSha,
      source: "own_site",
      found_on: "https://tulip.example/work/",
      asset_type: "real_scene",
    }],
  };
  const oldClaims = claims("generate", { jti: "12121212-1212-4212-8212-121212121212" });
  assert.equal((await h.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID, claims: oldClaims, expectedGrantJtiSha256: "",
  })).ok, true);
  const oldClaim = await h.queue.claimHeroReelJobWithCapability({
    claims: oldClaims,
    redemptionId: REDEMPTION_A,
  });
  assert.equal(oldClaim.ok, true);
  const intentSha = createHash("sha256").update(Buffer.from(stableSerialize({
    schema: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    generation_revision: 1,
    source_sha256: sourceSha,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: 4,
  }))).digest("hex");
  const submitting = {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    generation_revision: 1,
    source_sha256: sourceSha,
    source_mime: "image/jpeg",
    source_bytes: 300000,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: 4,
    intent_sha256: intentSha,
    submission_state: "submitting",
    polling_url: "",
    created_at: "2026-08-25T20:00:00.000Z",
    submit_started_at: "2026-08-25T20:00:01.000Z",
  };
  h.rows[0].result = { provider_checkpoint: structuredClone(submitting), reason: "paid_submit_started" };
  const oldGrantSha = h.rows[0].payload.hero_job_capability_grant.jti_sha256;
  const liveReplacement = capability.newHeroJobCapabilityClaims({
    phase: "generate",
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    producer: "openrouter_seedance",
    generation_revision: 1,
    attempt: 1,
    batch_id: BATCH_ID,
    row_id: ROW_ID,
  }, { nowMs: NOW, jti: "13131313-1313-4313-8313-131313131313" });
  const liveRefusal = await h.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID,
    claims: liveReplacement,
    expectedGrantJtiSha256: oldGrantSha,
    allowExpiredRecovery: true,
  });
  assert.equal(liveRefusal.ok, false);
  assert.equal(h.rows[0].status, "running");

  h.advance(capability.HERO_JOB_CAPABILITY_LEASE_MS.generate + 1);
  const recoveredClaims = capability.newHeroJobCapabilityClaims({
    phase: "generate",
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    producer: "openrouter_seedance",
    generation_revision: 1,
    attempt: 1,
    batch_id: BATCH_ID,
    row_id: ROW_ID,
  }, {
    nowMs: NOW + capability.HERO_JOB_CAPABILITY_LEASE_MS.generate + 1,
    jti: "14141414-1414-4414-8414-141414141414",
  });
  const recovered = await h.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID,
    claims: recoveredClaims,
    expectedGrantJtiSha256: oldGrantSha,
    allowExpiredRecovery: true,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  assert.equal(h.rows[0].status, "queued");
  assert.equal(h.rows[0].attempts, 1);
  assert.equal(h.rows[0].lease_token, null);
  assert.deepEqual(h.rows[0].result.provider_checkpoint, submitting);
  assert.equal(h.rows[0].payload.hero_job_capability_grant.redemption_sha256, null);
  const next = await h.queue.claimHeroReelJobWithCapability({
    claims: recoveredClaims,
    redemptionId: REDEMPTION_B,
  });
  assert.equal(next.ok, true);
  assert.equal(h.rows[0].attempts, 2);
  assert.equal(next.job.duration_seconds, 4);
  assert.deepEqual(h.rows[0].result.provider_checkpoint, submitting);
});

test("expired redeemed generate without a validated checkpoint cannot be reminted or requeued", async () => {
  const h = memoryQueue();
  const oldClaims = claims("generate", { jti: "15151515-1515-4515-8515-151515151515" });
  assert.equal((await h.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID, claims: oldClaims, expectedGrantJtiSha256: "",
  })).ok, true);
  assert.equal((await h.queue.claimHeroReelJobWithCapability({
    claims: oldClaims, redemptionId: REDEMPTION_A,
  })).ok, true);
  const oldGrantSha = h.rows[0].payload.hero_job_capability_grant.jti_sha256;
  h.advance(capability.HERO_JOB_CAPABILITY_LEASE_MS.generate + 1);
  const replacement = capability.newHeroJobCapabilityClaims({
    phase: "generate",
    job_id: JOB_ID,
    prospect_id: PROSPECT_ID,
    producer: "openrouter_seedance",
    generation_revision: 1,
    attempt: 1,
    batch_id: BATCH_ID,
    row_id: ROW_ID,
  }, {
    nowMs: NOW + capability.HERO_JOB_CAPABILITY_LEASE_MS.generate + 1,
    jti: "16161616-1616-4616-8616-161616161616",
  });
  const before = structuredClone(h.rows[0]);
  const refused = await h.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID,
    claims: replacement,
    expectedGrantJtiSha256: oldGrantSha,
    allowExpiredRecovery: true,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "capability_target_conflict");
  assert.deepEqual(h.rows[0], before, "failed recovery performs no queue write");
  assert.equal(h.rows[0].status, "running");
  assert.equal(h.rows[0].result, null);
});

test("an upload completion lost response reuses only the exact redeemed lease before capability expiry", async () => {
  const h = memoryQueue({ upload: true });
  const uploadClaims = claims("upload", { jti: "66666666-6666-4666-8666-666666666666" });
  assert.equal((await h.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID, claims: uploadClaims, expectedGrantJtiSha256: "",
  })).ok, true);
  const claimed = await h.queue.claimHeroReelJobWithCapability({ claims: uploadClaims, redemptionId: REDEMPTION_A });
  assert.equal(claimed.ok, true);

  h.rows[0].status = "done";
  h.rows[0].result = {
    action: "complete",
    completed_by: "verified_upload",
    settled_by_lease: claimed.job.lease_token,
    clip_sha256: APPROVED_SHA,
  };
  h.rows[0].lease_token = null;
  h.rows[0].lease_owner = null;
  h.rows[0].lease_expires_at = null;

  const replay = await h.queue.validateHeroReelJobCapabilityLease({
    jobId: JOB_ID,
    leaseToken: claimed.job.lease_token,
    phase: "upload",
    approvedSha256: APPROVED_SHA,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.completed, true);
  const recovered = await h.queue.requeueApprovedHeroUpload({
    jobId: JOB_ID,
    leaseToken: claimed.job.lease_token,
    reason: "lost_terminal_response",
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.completed, true);
  assert.equal(recovered.reused, true);
  assert.equal(h.rows[0].status, "done");
  assert.equal((await h.queue.validateHeroReelJobCapabilityLease({
    jobId: JOB_ID,
    leaseToken: "wrong-lease",
    phase: "upload",
    approvedSha256: APPROVED_SHA,
  })).ok, false);
  h.advance(capability.HERO_JOB_CAPABILITY_TTL_SECONDS.upload * 1000 + 1);
  assert.equal((await h.queue.validateHeroReelJobCapabilityLease({
    jobId: JOB_ID,
    leaseToken: claimed.job.lease_token,
    phase: "upload",
    approvedSha256: APPROVED_SHA,
  })).ok, false);
});

test("upload requeue preserves approved bytes and consumes the old attempt", async () => {
  const h = memoryQueue({ upload: true });
  const uploadClaims = claims("upload", { jti: "55555555-5555-4555-8555-555555555555" });
  const approvedBefore = structuredClone(h.rows[0].payload);
  assert.equal((await h.queue.recordHeroJobCapabilityGrant({
    jobId: JOB_ID, claims: uploadClaims, expectedGrantJtiSha256: "",
  })).ok, true);
  const claimed = await h.queue.claimHeroReelJobWithCapability({ claims: uploadClaims, redemptionId: REDEMPTION_A });
  assert.equal(claimed.ok, true);
  const requeued = await h.queue.requeueApprovedHeroUpload({
    jobId: JOB_ID,
    leaseToken: claimed.job.lease_token,
    reason: "storage_write_failed",
  });
  assert.equal(requeued.ok, true);
  assert.equal(h.rows[0].status, "queued");
  assert.deepEqual(h.rows[0].payload.approved_clip, approvedBefore.approved_clip);
  assert.deepEqual(h.rows[0].payload.approved_artifact, approvedBefore.approved_artifact);
  assert.deepEqual(h.rows[0].payload.optimized_asset, approvedBefore.optimized_asset);
  assert.equal(h.rows[0].result.retry_without_generation, true);
  const lostResponseReplay = await h.queue.requeueApprovedHeroUpload({
    jobId: JOB_ID,
    leaseToken: claimed.job.lease_token,
    reason: "storage_write_failed",
  });
  assert.equal(lostResponseReplay.ok, true);
  assert.equal(lostResponseReplay.reused, true);
  assert.equal(h.rows[0].attempts, 1);
  assert.equal((await h.queue.claimHeroReelJobWithCapability({ claims: uploadClaims, redemptionId: REDEMPTION_A })).ok, false);
  assert.equal(h.rows[0].attempts, 1);
});
