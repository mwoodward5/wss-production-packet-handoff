"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const lineState = require("../lib/line-state");
const {
  enqueueCompletedLineHero,
  heroJoinOnlyRecheck,
  mirrorProspect,
  prepareMirroredHero,
  startQualifiedHero,
  verifySandboxStaticHeroFallbackReceipt,
} = require("../lib/line-adapters");
const { processRowPhase } = require("../lib/line-runner");
const {
  heroQueueWakeEnabled,
  normalizeLineHandle,
  wakeLineForCompletedHero,
} = require("../lib/line-hero-wakeup");
const { lineBuildMirror, mirrorProspectResumable } = require("../lib/line-mirror-resume");
const {
  createRebuildJobs,
  durableBuildArtifact,
  lineHeroRebuildMarker,
  publicVerdict,
} = require("../lib/rebuild-jobs");
const { createHeroReelJobQueue } = require("../lib/hero-reel-job-queue");
const { watchdogVerdict } = require("../api/cron/hero-lease-watchdog");
const { signEvidence } = require("../lib/mirror-engine/engine");
const { stableSerialize } = require("../lib/wan-hero-policy");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/siteforge");

const NOW = "2026-08-21T20:00:00.000Z";
const PREVIEW = "https://client-hero.wss-ai.com/";
const SOURCE = "https://client.example.com/";
const PHOTO_SHA = "a".repeat(64);
const HERO_CLIP_SHA = "b".repeat(64);
const HERO_BUILD_HASH = "e".repeat(64);
const REEL_URL = `https://assets.wss-ai.com/client/hero-reels/approved/${HERO_CLIP_SHA}.mp4`;
const SHARED_SITE_ID = "11111111-1111-4111-8111-111111111111";
const SHARED_RELEASE_ID = "33333333-3333-4333-8333-333333333333";
const SHARED_PREVIOUS_RELEASE_ID = "22222222-2222-4222-8222-222222222222";

test("qualification starts Seedance from a website when no photo bank is stored", async () => {
  let enqueued = 0;
  const result = await startQualifiedHero({
    prospectId: "website-only-prospect",
    businessName: "Website Only Fence",
    currentWebsite: SOURCE,
    rowId: "row-website-only",
  }, {
    batchId: "line-website-only",
    env: { GHOST_AGENCY_HERO_AUTOLINE: "1" },
    select: async () => ({
      ok: true,
      data: [{
        prospect_id: "website-only-prospect",
        business_name: "Website Only Fence",
        current_website: SOURCE,
        record: { current_website: SOURCE },
        updated_at: NOW,
      }],
    }),
    enqueueHeroRemasterForBuild: async (prospect, options) => {
      enqueued += 1;
      assert.equal(prospect.current_website, SOURCE);
      assert.deepEqual(options.lineHandle, {
        batchId: "line-website-only",
        rowId: "row-website-only",
      });
      return { ok: true, job_id: "hrj-website-only" };
    },
  });

  assert.equal(enqueued, 1);
  assert.equal(result.ok, true);
  assert.equal(result.rowPatch.ownedPhotoBank, undefined);
  assert.equal(result.rowPatch.heroRemaster.required, true);
  assert.equal(result.rowPatch.heroRemaster.pending, true);
  assert.equal(result.rowPatch.heroRemaster.jobId, "hrj-website-only");
});

function heroBuildOutput(buildHash = HERO_BUILD_HASH) {
  const releaseEvidence = {
    ok: true,
    dry_run: false,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: buildHash,
    preview_url: PREVIEW,
    revealable: true,
    checks: {
      brand: {
        media_mode: "housed",
        hero_video: { supplied: true, usable: true, placed: 1 },
      },
    },
  };
  releaseEvidence.evidence_sha = signEvidence(releaseEvidence);
  const buildEvidence = {
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: releaseEvidence.evidence_sha,
    ready: true,
    pending: false,
    qc_passed: true,
    visual_qc_passed: true,
    generation_fingerprint: `mirror-engine:${buildHash}`,
    build_hash: buildHash,
    content_source: "verified_mined_contract",
    release_evidence: releaseEvidence,
  };
  return {
    ok: true,
    previewUrl: PREVIEW,
    buildHash,
    currentWebsite: SOURCE,
    contentSource: "verified_mined_contract",
    buildEvidence,
    releaseEvidence,
    publishedAggregate: { rating: 4.9, reviews: 221 },
    photoAccounting: { banked: 1, placed: 1, photos_unplaced: [] },
  };
}

function exactHeroMarker(record, overrides = {}) {
  return lineHeroRebuildMarker({
    prospectId: "client-hero-1",
    rebuildJobId: "rebuild_client",
    heroJobId: "hrj_client",
    heroClipSha256: HERO_CLIP_SHA,
    lineHandle: { batchId: "line_client", rowId: "line_client:0" },
    reelUrl: REEL_URL,
    photoBank: record.photo_bank,
    artifact: durableBuildArtifact(heroBuildOutput()),
    completedAt: NOW,
    ...overrides,
  });
}

function sharedCompletionFixture() {
  const base = heroBuildOutput();
  const sharedReleaseEvidence = {
    evidence_schema: "shared-site-release-evidence-v1",
    site_id: SHARED_SITE_ID,
    release_id: SHARED_RELEASE_ID,
    build_hash: HERO_BUILD_HASH,
    canonical_host: "client-hero.wss-ai.com",
    manifest_path: `sites/${SHARED_SITE_ID}/releases/${SHARED_RELEASE_ID}/manifest.json`,
    manifest_sha256: "f".repeat(64),
    deployment_env: "production",
    generation: 2,
    route_generation: 2,
    state: "active",
    hero_video_path: "assets/hero-fallback.mp4",
    hero_video_sha256: HERO_CLIP_SHA,
  };
  const proofIdentity = {
    site_id: SHARED_SITE_ID,
    release_id: SHARED_RELEASE_ID,
    build_hash: HERO_BUILD_HASH,
  };
  const nativeEvidence = {
    ...base.releaseEvidence,
    build_hash: HERO_BUILD_HASH,
    deploy_id: SHARED_RELEASE_ID,
    proofIdentity,
    sharedReleaseEvidence,
  };
  nativeEvidence.evidence_sha = signEvidence(nativeEvidence);
  const dispatch = {
    ...base.buildEvidence,
    preview_url: PREVIEW,
    urls: { preview_url: PREVIEW },
    build_hash: HERO_BUILD_HASH,
    evidence_sha: nativeEvidence.evidence_sha,
    generation_fingerprint: `mirror-engine:${HERO_BUILD_HASH}`,
    release_evidence: nativeEvidence,
    job_id: "line_client:client-hero-1:mirror",
  };
  const current = {
    ...durable(ownedBank()),
    preview_url: PREVIEW,
    status: "previewed",
    updated_at: "2026-08-21T20:01:00.000Z",
    record: {
      ...durable(ownedBank()).record,
      preview_url: PREVIEW,
      media_bank: { hero_reel: { url: REEL_URL } },
      build_dispatch: dispatch,
      release_evidence: nativeEvidence,
      mirror_release_evidence: nativeEvidence,
    },
  };
  const shared = {
    preview_url: PREVIEW,
    proof_identity: proofIdentity,
    previous_proof_identity: {
      site_id: SHARED_SITE_ID,
      release_id: SHARED_PREVIOUS_RELEASE_ID,
      build_hash: "d".repeat(64),
    },
    release_evidence: sharedReleaseEvidence,
    hero_video_path: sharedReleaseEvidence.hero_video_path,
    hero_video_sha256: HERO_CLIP_SHA,
    record_write_id: "shared-record-write",
    line_handle: { batchId: "line_client", rowId: "line_client:0" },
  };
  const job = {
    jobId: "hrj_client",
    producer: "openrouter_seedance",
    status: "done",
    updatedAt: "2026-08-21T20:02:00.000Z",
    payload: { line_handle: { batchId: "line_client", rowId: "line_client:0" } },
    result: {
      ok: true,
      clip_sha256: HERO_CLIP_SHA,
      url: REEL_URL,
      completed_by: "verified_upload",
      action: "complete",
      upload_receipt: {
        storage: {
          object_path: `client/hero-reels/approved/${HERO_CLIP_SHA}.mp4`,
          sha256: HERO_CLIP_SHA,
        },
        audit: { type: "hero_clip.asset_stored", write_id: "shared-audit-write" },
        record: { prospect_id: "client-hero-1", write_id: "shared-record-write" },
        shared_release: shared,
      },
    },
  };
  return { current, job, shared, nativeEvidence, proofIdentity };
}

function ownedBank(overrides = {}) {
  return {
    version: 1,
    harvested_at: new Date().toISOString(),
    website: SOURCE,
    photos: [{
      url: "https://client.example.com/projects/crew.jpg",
      source: "own_site",
      found_on: "https://client.example.com/projects",
      sha256: PHOTO_SHA,
      width: 1600,
      height: 900,
      bytes: 240000,
      grade: "hero",
      rank: 0,
      ...(overrides.photo || {}),
    }],
    ...overrides,
  };
}

function durable(bank = null) {
  return {
    prospect_id: "client-hero-1",
    business_name: "Client Hero Plumbing",
    current_website: SOURCE,
    preview_url: null,
    status: "held",
    updated_at: NOW,
    record: {
      business_name: "Client Hero Plumbing",
      current_website: SOURCE,
      ...(bank ? { photo_bank: bank } : {}),
    },
  };
}

function qualifiedRow() {
  let row = lineState.newRow({
    prospectId: "client-hero-1",
    businessName: "Client Hero Plumbing",
    city: "Tulsa",
    state: "OK",
    vertical: "plumbing",
    email: "owner@client.example.com",
    now: NOW,
  });
  row = lineState.advanceRow(row, "qualified", { now: NOW }).row;
  return {
    ...row,
    rowId: "line_client:0",
    batchId: "line_client",
    durableUpdatedAt: NOW,
    currentWebsite: SOURCE,
  };
}

async function inspectForeignTerminalHero({
  reason,
  reofferCount,
  producer = "openrouter_seedance",
  providerCheckpoint,
  signedBase = true,
  status = "refused",
} = {}) {
  const fixture = sharedCompletionFixture();
  delete fixture.current.record.media_bank.hero_reel;
  if (!signedBase) delete fixture.current.record.build_dispatch;
  const payload = {
    generation_revision: 4,
    line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
    line_build_hash: HERO_BUILD_HASH,
    ...(reofferCount == null ? {} : { line_same_build_reoffer_count: reofferCount }),
  };
  let enqueues = 0;
  const out = await enqueueCompletedLineHero({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    heroRemaster: { required: true, pending: true, jobId: "hrj_client" },
  }, fixture.current, fixture.current.record, {
    env: {},
    reuseOnly: true,
    enqueueHeroRemasterForBuild: async () => {
      enqueues += 1;
      throw new Error("read-only terminal classification must never enqueue");
    },
    getHeroReelJobForProspect: async () => ({ ok: true, job: {
      jobId: "hrj_client",
      prospectId: "client-hero-1",
      status,
      producer,
      payload,
      result: {
        reason,
        ...(providerCheckpoint === undefined ? {} : { provider_checkpoint: providerCheckpoint }),
      },
    } }),
  });
  return { out, enqueues };
}

function acceptedSeedanceCheckpoint(overrides = {}) {
  return {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: "hrj_client",
    prospect_id: "client-hero-1",
    generation_revision: 4,
    source_sha256: PHOTO_SHA,
    source_mime: "image/jpeg",
    source_bytes: 240000,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: 8,
    intent_sha256: "f".repeat(64),
    submission_state: "accepted",
    polling_url: "https://openrouter.ai/api/v1/videos/jobs/provider-video-1",
    provider_job_id: "provider-video-1",
    ...overrides,
  };
}

function rejectedSubmittingSeedanceCheckpoint(overrides = {}) {
  const checkpoint = acceptedSeedanceCheckpoint({
    submission_state: "submitting",
    polling_url: "",
    submit_started_at: "2026-08-21T19:58:30.000Z",
    ...overrides,
  });
  delete checkpoint.provider_job_id;
  checkpoint.intent_sha256 = createHash("sha256").update(Buffer.from(stableSerialize({
    schema: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: checkpoint.job_id,
    prospect_id: checkpoint.prospect_id,
    generation_revision: checkpoint.generation_revision,
    source_sha256: checkpoint.source_sha256,
    model_id: checkpoint.model_id,
    duration_seconds: checkpoint.duration_seconds,
  }))).digest("hex");
  return checkpoint;
}

function verifiedStaticBaseFixture({
  mutateEvidence,
  bank: suppliedBank = null,
  photoSource = "client_current_hero",
} = {}) {
  const base = heroBuildOutput();
  const bank = suppliedBank || ownedBank({ photo: { current_hero: true } });
  const releaseEvidence = {
    ...base.releaseEvidence,
    checks: {
      ...base.releaseEvidence.checks,
      brand: {
        media_mode: "origin",
        photos: { supplied: 2, usable: 2, placed: 1, unplaced: 1 },
        hero_video: { supplied: false, usable: false, placed: 0 },
        hero_wash: {
          applied: true,
          reason: null,
          alpha: 0.72,
          worst_case_contrast: 5.1,
          ink_floor_contrast: 4.7,
          photo_source: photoSource,
          photo_sha: PHOTO_SHA,
          photo_url: "https://client.example.com/projects/crew.jpg",
          selector: "main > section:first-child",
          pages_verified: ["/"],
        },
      },
    },
  };
  if (typeof mutateEvidence === "function") mutateEvidence(releaseEvidence);
  releaseEvidence.evidence_sha = signEvidence(releaseEvidence);
  const dispatch = {
    ...base.buildEvidence,
    preview_url: PREVIEW,
    urls: { preview_url: PREVIEW },
    build_hash: HERO_BUILD_HASH,
    evidence_sha: releaseEvidence.evidence_sha,
    release_evidence: releaseEvidence,
    job_id: "line_client:client-hero-1:mirror",
  };
  const current = {
    ...durable(bank),
    preview_url: PREVIEW,
    status: "previewed",
    updated_at: "2026-08-21T20:01:00.000Z",
    record: {
      ...durable(bank).record,
      preview_url: PREVIEW,
      build_dispatch: dispatch,
      mirror_release_evidence: releaseEvidence,
    },
  };
  return { current, releaseEvidence, dispatch, bank };
}

async function inspectSameHandleStaticFallback({
  lane = "sandbox",
  reason = "openrouter_submit_failed",
  attempts = 3,
  producer = "openrouter_seedance",
  status = "failed",
  mutateEvidence,
  mutateCurrent,
  lineHandle = { batchId: "line_client", rowId: "line_client:0" },
  generationRevision = 4,
  rowOverrides = {},
  jobResultOverrides = {},
  fixtureOptions = {},
} = {}) {
  const fixture = verifiedStaticBaseFixture({ ...fixtureOptions, mutateEvidence });
  if (typeof mutateCurrent === "function") mutateCurrent(fixture.current);
  const row = {
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    releaseEvidence: fixture.releaseEvidence,
    ownedPhotoBank: fixture.bank,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      attemptId: `hero_attempt:${generationRevision}`,
      buildHash: HERO_BUILD_HASH,
    },
    ...rowOverrides,
  };
  const job = {
    jobId: "hrj_client",
    prospectId: "client-hero-1",
    status,
    producer,
    attempts,
    generation_revision: generationRevision,
    payload: {
      generation_revision: generationRevision,
      ...(lineHandle ? { line_handle: lineHandle } : {}),
    },
    result: { reason, ...jobResultOverrides },
  };
  const out = await enqueueCompletedLineHero(row, fixture.current, fixture.current.record, {
    lane,
    batchId: "line_client",
    env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    reuseOnly: true,
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(job) }),
  });
  return { out, fixture, row, job };
}

async function inspectForeignOperationalStaticFallback({
  lane = "sandbox",
  reason = "openrouter_submit_failed",
  attempts = 1,
  producer = "openrouter_seedance",
  status = "failed",
  generationRevision = 4,
  jobProspectId = "client-hero-1",
  jobBuildHash = HERO_BUILD_HASH,
  lineHandle = { batchId: "old_batch", rowId: "old_batch:0" },
  rowOverrides = {},
  sealConflict = false,
  leaseToken = "",
  providerCheckpoint,
  currentHasCanonical = true,
  checkpointSnapshotChanged = false,
  mutateCurrent,
  mutateJob,
} = {}) {
  const fixture = verifiedStaticBaseFixture();
  if (!currentHasCanonical) {
    fixture.current.preview_url = null;
    delete fixture.current.record.preview_url;
    delete fixture.current.record.build_dispatch;
    delete fixture.current.record.mirror_release_evidence;
  }
  if (typeof mutateCurrent === "function") mutateCurrent(fixture.current);
  const row = {
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    releaseEvidence: fixture.releaseEvidence,
    ownedPhotoBank: fixture.bank,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      attemptId: `hero_attempt:${generationRevision}`,
      buildHash: HERO_BUILD_HASH,
    },
    ...rowOverrides,
  };
  const job = {
    jobId: "hrj_client",
    prospectId: jobProspectId,
    status,
    producer,
    attempts,
    generation_revision: generationRevision,
    payload: {
      generation_revision: generationRevision,
      line_handle: lineHandle,
      line_build_hash: jobBuildHash,
      duration_seconds: 8,
      photo_bank: {
        ...structuredClone(fixture.bank),
        fresh: true,
        photos: fixture.bank.photos.map((photo) => ({ ...photo, asset_type: "real_scene" })),
      },
    },
    result: {
      reason,
      ...(providerCheckpoint === undefined ? {} : { provider_checkpoint: structuredClone(providerCheckpoint) }),
      ...(providerCheckpoint?.submission_state === "submitting" ? {
        provider_failure: {
          provider: "openrouter",
          operation: "video_submit",
          parameter: "frame_images",
          http_status: 400,
          schema_version: "wss.openrouter_failure.v1",
        },
      } : {}),
    },
    ...(leaseToken ? {
      leaseToken,
      leaseOwner: "active-worker",
      leaseExpiresAt: "2026-08-21T21:00:00.000Z",
    } : {}),
    updatedAt: "2026-08-21T19:59:00.000Z",
    finishedAt: "2026-08-21T19:59:00.000Z",
  };
  if (typeof mutateJob === "function") mutateJob(job);
  let sealWrites = 0;
  const queue = createHeroReelJobQueue({
    now: () => new Date(NOW),
    conditionalUpdate: async (table, idColumn, idValue, guards, patch) => {
      assert.equal(table, "ghost_agency_hero_reel_jobs");
      assert.equal(idColumn, "job_id");
      assert.equal(idValue, "hrj_client");
      assert.equal(guards.status, "eq.failed");
      assert.equal(guards.prospect_id, "eq.client-hero-1");
      assert.equal(guards.producer, "eq.openrouter_seedance");
      assert.equal(guards.attempts, `eq.${attempts}`);
      assert.equal(guards.updated_at, "eq.2026-08-21T19:59:00.000Z");
      assert.equal(guards.finished_at, "eq.2026-08-21T19:59:00.000Z");
      assert.equal(guards.lease_token, "is.null");
      assert.equal(guards.lease_owner, "is.null");
      assert.equal(guards.lease_expires_at, "is.null");
      assert.equal(guards["payload->>generation_revision"], `eq.${generationRevision}`);
      assert.equal(guards["payload->line_handle->>batchId"], `eq.${lineHandle.batchId}`);
      assert.equal(guards["payload->line_handle->>rowId"], `eq.${lineHandle.rowId}`);
      assert.equal(guards["payload->>line_build_hash"], `eq.${jobBuildHash}`);
      assert.equal(guards["result->>reason"], `eq.${reason}`);
      assert.equal(guards["result->provider_checkpoint"], "is.null");
      assert.equal(guards["result->provider_submission_review"], "is.null");
      assert.equal(guards["result->seedance_submit_review"], "is.null");
      assert.equal(guards["result->submission_review"], "is.null");
      if (sealConflict) return { ok: true, updated: false };
      sealWrites += 1;
      job.status = patch.status;
      job.result = structuredClone(patch.result);
      job.updatedAt = patch.updated_at;
      job.finishedAt = patch.finished_at;
      return { ok: true, updated: true };
    },
  });
  let enqueues = 0;
  let jobReads = 0;
  const out = await enqueueCompletedLineHero(row, fixture.current, fixture.current.record, {
    lane,
    batchId: "line_client",
    env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    reuseOnly: true,
    enqueueHeroRemasterForBuild: async () => {
      enqueues += 1;
      throw new Error("foreign terminal join must never enqueue provider work");
    },
    getHeroReelJobForProspect: async () => {
      jobReads += 1;
      const loaded = structuredClone(job);
      if (checkpointSnapshotChanged && jobReads > 1) loaded.updatedAt = "2026-08-21T19:59:01.000Z";
      return { ok: true, job: loaded };
    },
    sealForeignTerminalForPracticeStatic: queue.sealForeignTerminalForPracticeStatic,
  });
  return { out, fixture, row, job, enqueues, sealWrites, queue, jobReads };
}

test("Practice can close an immutable foreign-handle operational failure on its exact signed static base", async () => {
  const { out, fixture, row, job, enqueues, sealWrites, queue } = await inspectForeignOperationalStaticFallback();
  assert.equal(enqueues, 0, "the read-only foreign join never submits provider work");
  assert.equal(sealWrites, 1, "the failed job is consumed exactly once before fallback");
  assert.equal(job.status, "refused", "watchdog status=failed CAS can no longer match");
  assert.equal(job.result.reason, "foreign_line_practice_static_sealed");
  assert.equal(watchdogVerdict({ status: job.status, attempts: job.attempts, result: job.result }, Date.parse(NOW)).action, "skip");
  assert.equal(out.required, false);
  assert.equal(out.ready, true);
  assert.equal(out.fallback, true);
  assert.equal(out.applied, false);
  assert.equal(out.reason, "sandbox_foreign_video_terminal_static_hero_verified");
  assert.equal(out.line_batch_id, "line_client");
  assert.equal(out.line_row_id, "line_client:0");
  assert.equal(out.foreign_job_binding_schema, "wss.line.static_hero_foreign_job.v1");
  assert.match(out.foreign_job_binding_sha256, /^[a-f0-9]{64}$/);
  assert.equal(out.foreign_job_prospect_id, "client-hero-1");
  assert.equal(out.foreign_job_generation_revision, 4);
  assert.equal(out.foreign_job_line_batch_id, "old_batch");
  assert.equal(out.foreign_job_line_row_id, "old_batch:0");
  assert.equal(out.foreign_job_build_hash, HERO_BUILD_HASH);
  assert.equal(out.video_failure_reason, "openrouter_submit_failed");
  assert.equal(out.video_terminal_reason, "openrouter_submit_failed");
  assert.equal(out.video_attempts, 1, "the receipt records the one real attempt");
  assert.equal(out.video_attempt_cap, 3, "the configured cap is not rewritten");
  assert.equal(out.video_retry_budget_exhausted_by, undefined);
  assert.equal(out.foreign_job_consumption_reason, "foreign_terminal_job_consumed");
  assert.equal(out.reel_url, undefined);
  assert.equal(out.rebuild_job_id, undefined);

  let mirrorCalls = 0;
  const deps = {
    env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(job) }),
    mirror: async () => {
      mirrorCalls += 1;
      throw new Error("the signed base must not rebuild");
    },
    heroJoinOnly: (candidate, options) => heroJoinOnlyRecheck(candidate, {
      ...options,
      select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(job) }),
      sealForeignTerminalForPracticeStatic: queue.sealForeignTerminalForPracticeStatic,
    }),
    sourceFacts: async () => ({}),
    gate: async () => ({
      pass: true,
      failed: [],
      checks: [],
      capture: {
        ok: true,
        shots: {
          build_hash: HERO_BUILD_HASH,
          old_captured_url: SOURCE,
          old_shot_sha: "c".repeat(64),
          new_captured_url: PREVIEW,
          new_shot_sha: "d".repeat(64),
        },
        results: [],
      },
    }),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async (queuedRow, options) => {
      assert.equal(options.lane, "sandbox");
      assert.equal(queuedRow.heroRemaster.reelUrl, "");
      assert.equal(queuedRow.heroRemaster.foreignJobLineBatchId, "old_batch");
      return { ok: true };
    },
    now: () => NOW,
  };
  let phase = await processRowPhase(row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "mirrored", JSON.stringify(phase));
  assert.equal(phase.row.heroRemaster.foreignJobBindingSchema, "wss.line.static_hero_foreign_job.v1");
  assert.equal(phase.row.heroRemaster.videoAttempts, 1);
  assert.equal(mirrorCalls, 0);
  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "gate_passed", JSON.stringify(phase));
  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "queued", JSON.stringify(phase));
});

test("foreign-handle static receipt rejects replay, tampering, and the wrong immutable job", async () => {
  const { out, fixture, row, job } = await inspectForeignOperationalStaticFallback();
  const candidate = { ...row, heroRemaster: structuredClone(out) };
  const verify = (candidateRow, loadedJob = job, batchId = "line_client") => (
    verifySandboxStaticHeroFallbackReceipt(candidateRow, {
      lane: "sandbox",
      batchId,
      env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
      select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(loadedJob) }),
    })
  );
  assert.equal((await verify(candidate)).verified, true);
  const jsonbReordered = structuredClone(job);
  jsonbReordered.result.current_line_handle = {
    rowId: job.result.current_line_handle.rowId,
    batchId: job.result.current_line_handle.batchId,
  };
  jsonbReordered.result.original_line_handle = {
    rowId: job.result.original_line_handle.rowId,
    batchId: job.result.original_line_handle.batchId,
  };
  assert.equal((await verify(candidate, jsonbReordered)).verified, true,
    "JSONB key order cannot invalidate an exact durable seal");

  const replayed = {
    ...candidate,
    rowId: "line_other:0",
    batchId: "line_other",
  };
  assert.equal((await verify(replayed, job, "line_other")).verified, false, "a receipt cannot move to another current row");

  for (const [name, mutate] of [
    ["binding_digest", (marker) => { marker.foreign_job_binding_sha256 = "f".repeat(64); }],
    ["original_handle", (marker) => { marker.foreign_job_line_row_id = "old_batch:9"; }],
    ["revision", (marker) => { marker.foreign_job_generation_revision = 5; }],
    ["reason", (marker) => { marker.video_failure_reason = "openrouter_download_failed"; }],
    ["cap", (marker) => { marker.video_attempt_cap = 4; }],
    ["static_base", (marker) => { marker.static_hero_photo_sha256 = "f".repeat(64); }],
  ]) {
    const tampered = structuredClone(candidate);
    mutate(tampered.heroRemaster);
    assert.equal((await verify(tampered)).verified, false, name);
  }

  for (const [name, mutate] of [
    ["prospect", (loaded) => { loaded.prospectId = "other-prospect"; }],
    ["build", (loaded) => { loaded.payload.line_build_hash = "f".repeat(64); }],
    ["handle", (loaded) => { loaded.payload.line_handle = { batchId: "other_old", rowId: "other_old:0" }; }],
  ]) {
    const wrongJob = structuredClone(job);
    mutate(wrongJob);
    assert.equal((await verify(candidate, wrongJob)).verified, false, name);
  }
});

test("foreign operational fallback stays closed without a real attempt and in live/client mode", async () => {
  const zeroAttempt = await inspectForeignOperationalStaticFallback({ attempts: 0 });
  assert.equal(zeroAttempt.out.hold, true);
  assert.equal(zeroAttempt.out.fallback, undefined);
  assert.equal(zeroAttempt.enqueues, 0);

  const live = await inspectForeignOperationalStaticFallback({ lane: "live" });
  assert.equal(live.out.hold, true);
  assert.equal(live.out.fallback, undefined);
  assert.equal(live.enqueues, 0);

  const assetFailure = await inspectForeignOperationalStaticFallback({ reason: "source_sha256_mismatch" });
  assert.equal(assetFailure.out.required, true);
  assert.equal(assetFailure.out.fallback, undefined);
  assert.equal(assetFailure.out.reason, "hero_remaster_line_handle_mismatch");

  const casLoss = await inspectForeignOperationalStaticFallback({ sealConflict: true });
  assert.equal(casLoss.out.pending, true, "a watchdog/CAS winner forces an exact reread");
  assert.equal(casLoss.out.status, "foreign_terminal_seal_pending");
  assert.equal(casLoss.out.fallback, false);
  assert.equal(casLoss.sealWrites, 0);

  const leased = await inspectForeignOperationalStaticFallback({ leaseToken: "lease-active" });
  assert.equal(leased.out.fallback, undefined, "an active worker lease cannot be consumed");
  assert.equal(leased.sealWrites, 0);

  const checkpointed = await inspectForeignOperationalStaticFallback({
    providerCheckpoint: { submission_state: "accepted", provider_job_id: "paid-job" },
  });
  assert.equal(checkpointed.out.fallback, undefined, "accepted provider work cannot be consumed");
  assert.equal(checkpointed.sealWrites, 0);
});

test("Practice observes the exact rejected submitting checkpoint without mutating it and ships only a signed static base", async () => {
  const providerCheckpoint = rejectedSubmittingSeedanceCheckpoint();
  const observed = await inspectForeignOperationalStaticFallback({
    providerCheckpoint,
    currentHasCanonical: false,
  });
  const { out, fixture, row, job } = observed;
  assert.equal(observed.enqueues, 0, "a foreign checkpoint never starts provider work");
  assert.equal(observed.sealWrites, 0, "the submitting checkpoint is never cleared or sealed");
  assert.equal(observed.jobReads, 2, "the exact rejection snapshot is re-read before fallback");
  assert.equal(job.status, "failed");
  assert.deepEqual(job.result.provider_checkpoint, providerCheckpoint);
  assert.equal(out.required, false);
  assert.equal(out.ready, true);
  assert.equal(out.fallback, true);
  assert.equal(out.reason, "sandbox_foreign_submit_rejected_static_hero_verified");
  assert.equal(out.foreign_job_binding_schema, "wss.line.static_hero_foreign_checkpoint_job.v1");
  assert.match(out.foreign_job_binding_sha256, /^[a-f0-9]{64}$/);
  assert.match(out.foreign_job_snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.match(out.foreign_job_checkpoint_sha256, /^[a-f0-9]{64}$/);
  assert.equal(out.foreign_job_status, "failed");
  assert.equal(out.foreign_job_result_reason, "openrouter_submit_failed");
  assert.equal(out.foreign_job_consumption_reason, "foreign_submit_rejection_observed_read_only");
  assert.equal(out.static_hero_verified, true);
  assert.equal(out.base_evidence_sha, fixture.releaseEvidence.evidence_sha,
    "the newly signed row packet may bridge the pre-canonical post-Mirror seam");
  assert.equal(out.reel_url, undefined);

  const candidate = { ...row, heroRemaster: structuredClone(out) };
  const verify = (loadedJob = job, current = fixture.current) => verifySandboxStaticHeroFallbackReceipt(candidate, {
    lane: "sandbox",
    batchId: "line_client",
    env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    select: async () => ({ ok: true, data: [structuredClone(current)] }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(loadedJob) }),
  });
  assert.equal((await verify()).verified, true);

  const changed = structuredClone(job);
  changed.updatedAt = "2026-08-21T19:59:01.000Z";
  assert.equal((await verify(changed)).verified, false, "a changed durable job cannot replay the snapshot receipt");
  const changedCheckpoint = structuredClone(job);
  changedCheckpoint.result.provider_checkpoint.submit_started_at = "2026-08-21T19:58:31.000Z";
  assert.equal((await verify(changedCheckpoint)).verified, false, "checkpoint-byte drift is fail-closed");

  const unsigned = await inspectForeignOperationalStaticFallback({
    providerCheckpoint,
    currentHasCanonical: false,
    rowOverrides: { releaseEvidence: { ...fixture.releaseEvidence, evidence_sha: "f".repeat(64) } },
  });
  assert.equal(unsigned.out.fallback, undefined, "an unverified row marker is never a static base");
  assert.equal(unsigned.out.required, true);
  assert.notEqual(unsigned.out.ready, true);

  const nullableCanonical = await inspectForeignOperationalStaticFallback({
    providerCheckpoint,
    currentHasCanonical: false,
    mutateCurrent: (current) => {
      current.record.build_dispatch = null;
      current.record.mirror_release_evidence = null;
    },
  });
  assert.equal(nullableCanonical.out.fallback, true, "null canonical fields are the live pre-write absence shape");

  for (const [name, mutateCurrent] of [
    ["malformed canonical dispatch", (current) => { current.record.build_dispatch = {}; }],
    ["malformed canonical evidence", (current) => { current.record.mirror_release_evidence = {}; }],
    ["conflicting canonical preview", (current) => { current.preview_url = PREVIEW; }],
  ]) {
    const conflicted = await inspectForeignOperationalStaticFallback({
      providerCheckpoint,
      currentHasCanonical: false,
      mutateCurrent,
    });
    assert.equal(conflicted.out.fallback, undefined, name);
  }

  for (const [name, mutateJob] of [
    ["non-scene source", (candidate) => { candidate.payload.photo_bank.photos[0].asset_type = "logo"; }],
    ["wrong intent", (candidate) => { candidate.result.provider_checkpoint.intent_sha256 = "f".repeat(64); }],
    ["ambiguous provider failure", (candidate) => { candidate.result.provider_failure.http_status = 500; }],
  ]) {
    const unsafeCheckpoint = await inspectForeignOperationalStaticFallback({
      providerCheckpoint,
      currentHasCanonical: false,
      mutateJob,
    });
    assert.equal(unsafeCheckpoint.out.fallback, undefined, name);
  }

  const live = await inspectForeignOperationalStaticFallback({
    lane: "live",
    providerCheckpoint,
    currentHasCanonical: false,
  });
  assert.equal(live.out.fallback, undefined, "client delivery remains held");
  assert.equal(live.out.required, true);
  assert.notEqual(live.out.ready, true);

  const raced = await inspectForeignOperationalStaticFallback({
    providerCheckpoint,
    currentHasCanonical: false,
    checkpointSnapshotChanged: true,
  });
  assert.equal(raced.out.pending, true);
  assert.equal(raced.out.status, "foreign_checkpoint_snapshot_pending");
  assert.equal(raced.sealWrites, 0);
});

test("Practice uses an honest static hero only for exhausted operational video failures", async () => {
  for (const reason of [
    "openrouter_submit_failed",
    "openrouter_download_failed",
    "boomerang_ffmpeg_missing",
    "boomerang_ffmpeg_timeout",
    "write_EPROTO_SSL_wrong_version_number",
    "seedance_clip_transcode_timeout",
    "seedance_transcode_clip_too_large",
    "hero_lease_expired_max_attempts",
    "hero_lost_settle_max_attempts",
  ]) {
    const { out, fixture } = await inspectSameHandleStaticFallback({ reason });
    assert.equal(out.ok, true, reason);
    assert.equal(out.required, false, reason);
    assert.equal(out.ready, true, reason);
    assert.equal(out.pending, false, reason);
    assert.equal(out.hold, false, reason);
    assert.equal(out.fallback, true, reason);
    assert.equal(out.applied, false, reason);
    assert.equal(out.status, "skipped", reason);
    assert.equal(out.reason, "sandbox_video_retries_exhausted_static_hero_verified", reason);
    assert.equal(out.static_hero_verified, true, reason);
    assert.equal(out.static_hero_source, "client_current_hero", reason);
    assert.equal(out.static_hero_photo_sha256, PHOTO_SHA, reason);
    assert.equal(out.static_hero_photo_url, "https://client.example.com/projects/crew.jpg", reason);
    assert.match(out.static_hero_bank_fingerprint, /^[a-f0-9]{64}$/, reason);
    assert.equal(out.base_evidence_sha, fixture.releaseEvidence.evidence_sha, reason);
    assert.equal(out.line_batch_id, "line_client", reason);
    assert.equal(out.line_row_id, "line_client:0", reason);
    assert.equal(out.video_failure_reason, reason);
    assert.equal(out.video_terminal_reason, reason);
    assert.equal(out.video_attempts, 3);
    assert.equal(out.video_attempt_cap, 3);
    assert.equal(out.producer, "openrouter_seedance");
    assert.equal(out.hero_attempt_id, "hero_attempt:4");
    assert.equal(out.reel_url, undefined, "the fallback never claims a video");
    assert.equal(out.rebuild_job_id, undefined, "the fallback never claims a video rebuild");
  }
});

test("Practice may use the signed static hero after an abandoned one-shot claim without inventing retries", async () => {
  const exactTerminal = {
    exhausted_reason: "hero_capability_unrenewed_no_checkpoint",
    attempt_cap: 3,
    retry_budget_exhausted: true,
    retry_budget_exhausted_by: "provider_spend_uncertain",
    provider_checkpoint_present: false,
  };
  const { out, fixture, row, job } = await inspectSameHandleStaticFallback({
    reason: "hero_capability_unrenewed_no_checkpoint",
    attempts: 1,
    jobResultOverrides: exactTerminal,
  });
  assert.equal(out.fallback, true);
  assert.equal(out.static_hero_verified, true);
  assert.equal(out.video_failure_reason, "hero_capability_unrenewed_no_checkpoint");
  assert.equal(out.video_terminal_reason, "hero_capability_unrenewed_no_checkpoint");
  assert.equal(out.video_attempts, 1, "the durable counter remains the one real capability claim");
  assert.equal(out.video_attempt_cap, 3);
  assert.equal(out.video_retry_budget_exhausted_by, "provider_spend_uncertain");
  assert.equal(out.reel_url, undefined);

  const deps = {
    env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(job) }),
    mirror: async () => { throw new Error("join-only fallback must not rebuild"); },
    heroJoinOnly: (pendingRow, options) => heroJoinOnlyRecheck(pendingRow, {
      ...options,
      select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(job) }),
    }),
    sourceFacts: async () => ({}),
    gate: async () => ({
      pass: true,
      failed: [],
      checks: [],
      capture: {
        ok: true,
        shots: {
          build_hash: HERO_BUILD_HASH,
          old_captured_url: SOURCE,
          old_shot_sha: "c".repeat(64),
          new_captured_url: PREVIEW,
          new_shot_sha: "d".repeat(64),
        },
        results: [],
      },
    }),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async (queuedRow, options) => {
      assert.equal(options.lane, "sandbox");
      assert.equal(queuedRow.heroRemaster.reelUrl, "");
      assert.equal(queuedRow.heroRemaster.videoAttempts, 1);
      return { ok: true };
    },
    now: () => NOW,
  };
  let phase = await processRowPhase(row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "mirrored");
  assert.equal(phase.row.heroRemaster.videoRetryBudgetExhaustedBy, "provider_spend_uncertain");
  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "gate_passed", "canonical render verification remains mandatory");
  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "queued", "only the owner Practice email queue is reachable");

  const missingDurableMarker = await inspectSameHandleStaticFallback({
    reason: "hero_capability_unrenewed_no_checkpoint",
    attempts: 1,
    jobResultOverrides: { exhausted_reason: "hero_capability_unrenewed_no_checkpoint", attempt_cap: 3 },
  });
  assert.equal(missingDurableMarker.out.hold, true,
    "the reason string alone can never authorize static fallback");

  const live = await inspectSameHandleStaticFallback({
    lane: "live",
    reason: "hero_capability_unrenewed_no_checkpoint",
    attempts: 1,
    jobResultOverrides: exactTerminal,
  });
  assert.equal(live.out.hold, true, "live/client delivery remains fail-closed");
});

test("signed first-usable static photo is matched by exact SHA and URL when no hero-grade row exists", async () => {
  const firstUsableBank = ownedBank({ photo: { grade: "support" } });
  const { out, fixture, row, job } = await inspectSameHandleStaticFallback({
    fixtureOptions: {
      bank: firstUsableBank,
      photoSource: "first_usable_photo",
    },
  });
  assert.equal(out.fallback, true);
  assert.equal(out.static_hero_source, "first_usable_photo");
  assert.equal(out.static_hero_photo_sha256, PHOTO_SHA);
  assert.equal(out.static_hero_photo_url, "https://client.example.com/projects/crew.jpg");

  const deps = {
    env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(job) }),
    mirror: async () => { throw new Error("join-only fallback must not rebuild"); },
    heroJoinOnly: (pendingRow, options) => heroJoinOnlyRecheck(pendingRow, {
      ...options,
      select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(job) }),
    }),
    sourceFacts: async () => ({}),
    gate: async () => ({
      pass: true,
      failed: [],
      checks: [],
      capture: {
        ok: true,
        shots: {
          build_hash: HERO_BUILD_HASH,
          old_captured_url: SOURCE,
          old_shot_sha: "c".repeat(64),
          new_captured_url: PREVIEW,
          new_shot_sha: "d".repeat(64),
        },
        results: [],
      },
    }),
    now: () => NOW,
  };
  let phase = await processRowPhase(row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "mirrored");
  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "gate_passed");
});

test("watchdog exhaustion preserves the exact operational reason without poll-order dependence", async () => {
  const operational = await inspectSameHandleStaticFallback({
    reason: "hero_stale_failure_max_attempts",
    jobResultOverrides: {
      exhausted_reason: "openrouter_submit_failed",
      attempt_cap: 3,
    },
  });
  assert.equal(operational.out.fallback, true);
  assert.equal(operational.out.video_failure_reason, "openrouter_submit_failed");
  assert.equal(operational.out.video_terminal_reason, "hero_stale_failure_max_attempts");

  const assetFailure = await inspectSameHandleStaticFallback({
    reason: "hero_stale_failure_max_attempts",
    jobResultOverrides: {
      exhausted_reason: "clip_dimensions_out_of_range",
      attempt_cap: 3,
    },
  });
  assert.equal(assetFailure.out.hold, true);
  assert.notEqual(assetFailure.out.reason, "sandbox_video_retries_exhausted_static_hero_verified");
});

test("asset, hash, source, policy, ambiguous, and unexhausted failures stay held", async () => {
  for (const reason of [
    "clip_dimensions_out_of_range",
    "source_sha256_mismatch",
    "seedance_content_policy_refusal",
    "openrouter_unauthorized",
    "hero_stale_failure_max_attempts",
  ]) {
    const { out } = await inspectSameHandleStaticFallback({ reason });
    assert.equal(out.hold, true, reason);
    assert.notEqual(out.reason, "sandbox_video_retries_exhausted_static_hero_verified", reason);
  }

  const belowCap = await inspectSameHandleStaticFallback({ attempts: 2 });
  assert.equal(belowCap.out.pending, true, "the row waits while its bounded retry remains");
  assert.equal(belowCap.out.hold, false);
  assert.equal(belowCap.out.required, true);
  assert.equal(belowCap.out.status, "retry_pending");
  assert.equal(belowCap.out.video_attempts, 2);
  assert.equal(belowCap.out.video_attempt_cap, 3);
  assert.notEqual(belowCap.out.reason, "sandbox_video_retries_exhausted_static_hero_verified");
  const belowCapWithoutStaticProof = await inspectSameHandleStaticFallback({
    attempts: 2,
    mutateCurrent: (current) => { delete current.record.build_dispatch; },
    rowOverrides: { releaseEvidence: null, ownedPhotoBank: null },
  });
  assert.equal(belowCapWithoutStaticProof.out.pending, true,
    "remaining video retries do not depend on fallback proof that is not yet needed");
  assert.equal(belowCapWithoutStaticProof.out.status, "retry_pending");
  const live = await inspectSameHandleStaticFallback({ lane: "live" });
  assert.equal(live.out.hold, true);
  const missingHandle = await inspectSameHandleStaticFallback({ lineHandle: null });
  assert.equal(missingHandle.out.hold, true);
  const foreignHandle = await inspectSameHandleStaticFallback({
    lineHandle: { batchId: "old_line", rowId: "old_line:0" },
  });
  assert.notEqual(foreignHandle.out.reason, "sandbox_video_retries_exhausted_static_hero_verified");
});

test("Practice keeps an operational failure parked until the retry budget is exhausted", async () => {
  const fixture = verifiedStaticBaseFixture();
  let mirrors = 0;
  let gates = 0;
  let emails = 0;
  const row = {
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    releaseEvidence: fixture.releaseEvidence,
    buildEvidence: fixture.dispatch,
    ownedPhotoBank: fixture.bank,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      attemptId: "hero_attempt:4",
      buildHash: HERO_BUILD_HASH,
    },
  };
  const out = await processRowPhase(row, { batchId: "line_client", lane: "sandbox" }, {
    env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    mirror: async () => { mirrors += 1; throw new Error("pending retry must not rebuild"); },
    heroJoinOnly: (pendingRow, options) => heroJoinOnlyRecheck(pendingRow, {
      ...options,
      select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: {
        jobId: "hrj_client",
        prospectId: "client-hero-1",
        status: "failed",
        producer: "openrouter_seedance",
        attempts: 2,
        generation_revision: 4,
        payload: {
          generation_revision: 4,
          line_handle: { batchId: "line_client", rowId: "line_client:0" },
        },
        result: { reason: "openrouter_submit_failed" },
      } }),
    }),
    gate: async () => { gates += 1; return { pass: true }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });
  assert.equal(out.row.status, "qualified");
  assert.equal(out.phase, "hero_remaster");
  assert.equal(out.row.heroRemaster.pending, true);
  assert.equal(out.row.heroRemaster.status, "retry_pending");
  assert.equal(out.row.heroRemaster.videoAttempts, 2);
  assert.equal(out.row.heroRemaster.videoAttemptCap, 3);
  assert.equal(mirrors, 0);
  assert.equal(gates, 0);
  assert.equal(emails, 0);
});

test("a bank harvested by the base Mirror survives pending and authorizes only its exact later fallback", async () => {
  const fixture = verifiedStaticBaseFixture();
  let mirrorCalls = 0;
  const first = await processRowPhase(qualifiedRow(), {
    batchId: "line_client",
    lane: "sandbox",
  }, {
    mirror: async () => {
      mirrorCalls += 1;
      return {
        heroRemasterPending: true,
        previewUrl: PREVIEW,
        buildHash: HERO_BUILD_HASH,
        currentWebsite: SOURCE,
        buildEvidence: fixture.dispatch,
        releaseEvidence: fixture.releaseEvidence,
        ownedPhotoBank: fixture.bank,
        heroRemaster: {
          required: true,
          ready: false,
          pending: true,
          status: "queued",
          job_id: "hrj_client",
          hero_attempt_id: "hero_attempt:4",
          build_hash: HERO_BUILD_HASH,
          producer: "openrouter_seedance",
        },
      };
    },
    now: () => NOW,
  });
  assert.equal(first.row.status, "qualified");
  assert.equal(first.row.ownedPhotoBank.photos[0].sha256, PHOTO_SHA);
  assert.equal(first.row.heroRemaster.pending, true);

  const exhaustedJob = {
    jobId: "hrj_client",
    prospectId: "client-hero-1",
    status: "failed",
    producer: "openrouter_seedance",
    attempts: 3,
    generation_revision: 4,
    payload: {
      generation_revision: 4,
      line_handle: { batchId: "line_client", rowId: "line_client:0" },
    },
    result: {
      reason: "hero_stale_failure_max_attempts",
      exhausted_reason: "openrouter_submit_failed",
      attempt_cap: 3,
    },
  };
  const legacyPending = structuredClone(first.row);
  delete legacyPending.ownedPhotoBank;
  const laterDeps = {
    env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(exhaustedJob) }),
    sourceFacts: async () => ({}),
    gate: async () => ({
      pass: true,
      failed: [],
      checks: [],
      capture: {
        ok: true,
        shots: {
          build_hash: HERO_BUILD_HASH,
          old_captured_url: SOURCE,
          old_shot_sha: "c".repeat(64),
          new_captured_url: PREVIEW,
          new_shot_sha: "d".repeat(64),
        },
        results: [],
      },
    }),
    mirror: async () => { throw new Error("pending join must not rebuild"); },
    heroJoinOnly: (row, options) => heroJoinOnlyRecheck(row, {
      ...options,
      select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(exhaustedJob) }),
    }),
    now: () => NOW,
  };
  const second = await processRowPhase(legacyPending, {
    batchId: "line_client",
    lane: "sandbox",
  }, laterDeps);
  assert.equal(second.row.status, "mirrored");
  assert.equal(second.row.heroRemaster.fallback, true);
  assert.equal(second.row.heroRemaster.staticHeroPhotoSha256, PHOTO_SHA);
  assert.equal(second.row.ownedPhotoBank.photos[0].sha256, PHOTO_SHA,
    "the durable current-record bank is hydrated onto a legacy pending row");
  const third = await processRowPhase(second.row, {
    batchId: "line_client",
    lane: "sandbox",
  }, laterDeps);
  assert.equal(third.row.status, "gate_passed");
  assert.equal(mirrorCalls, 1);
});

test("static fallback refuses unsigned bases, unowned banks, video claims, and weak hero proof", async () => {
  const unsigned = await inspectSameHandleStaticFallback({
    mutateCurrent: (current) => { current.record.build_dispatch.release_evidence.evidence_sha = "0".repeat(64); },
  });
  assert.equal(unsigned.out.hold, true);

  const unowned = await inspectSameHandleStaticFallback({
    mutateCurrent: (current) => { current.record.photo_bank.website = "https://someone-else.example/"; },
  });
  assert.equal(unowned.out.hold, true);

  const videoPresent = await inspectSameHandleStaticFallback({
    mutateEvidence: (evidence) => {
      evidence.checks.brand.hero_video = { supplied: true, usable: true, placed: 1 };
    },
  });
  assert.equal(videoPresent.out.hold, true);

  const weakContrast = await inspectSameHandleStaticFallback({
    mutateEvidence: (evidence) => { evidence.checks.brand.hero_wash.worst_case_contrast = 4.49; },
  });
  assert.equal(weakContrast.out.hold, true);

  const unsignedPhotoIdentity = await inspectSameHandleStaticFallback({
    mutateEvidence: (evidence) => { delete evidence.checks.brand.hero_wash.photo_sha; },
  });
  assert.equal(unsignedPhotoIdentity.out.hold, true);

  const mismatchedPhotoIdentity = await inspectSameHandleStaticFallback({
    mutateEvidence: (evidence) => {
      evidence.checks.brand.hero_wash.photo_url = "https://client.example.com/projects/other.jpg";
    },
  });
  assert.equal(mismatchedPhotoIdentity.out.hold, true);

  const wrongBuild = await inspectSameHandleStaticFallback({ rowOverrides: { buildHash: "d".repeat(64) } });
  assert.equal(wrongBuild.out.hold, true);
});

test("Practice fallback still needs the render proof and can never cross the live boundary", async () => {
  const fixture = verifiedStaticBaseFixture();
  const failedJob = {
    jobId: "hrj_client",
    prospectId: "client-hero-1",
    status: "failed",
    producer: "openrouter_seedance",
    attempts: 3,
    generation_revision: 4,
    payload: {
      generation_revision: 4,
      line_handle: { batchId: "line_client", rowId: "line_client:0" },
    },
    result: { reason: "write_EPROTO_SSL_wrong_version_number" },
  };
  let mirrorCalls = 0;
  let gateCalls = 0;
  let writes = 0;
  let emails = 0;
  const deps = {
    env: { GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(failedJob) }),
    mirror: async () => { mirrorCalls += 1; throw new Error("join-only fallback must not rebuild"); },
    heroJoinOnly: (row, options) => heroJoinOnlyRecheck(row, {
      ...options,
      select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(failedJob) }),
    }),
    sourceFacts: async () => ({}),
    gate: async () => {
      gateCalls += 1;
      return {
        pass: true,
        failed: [],
        checks: [],
        capture: {
          ok: true,
          shots: {
            build_hash: HERO_BUILD_HASH,
            old_captured_url: SOURCE,
            old_shot_sha: "c".repeat(64),
            new_captured_url: PREVIEW,
            new_shot_sha: "d".repeat(64),
          },
          results: [],
        },
      };
    },
    writePreviewUrl: async () => { writes += 1; return { ok: true }; },
    queueEmail: async (row, options) => {
      emails += 1;
      assert.equal(options.lane, "sandbox");
      assert.equal(row.heroRemaster.staticHeroVerified, true);
      assert.equal(row.heroRemaster.reelUrl, "");
      return { ok: true };
    },
    now: () => NOW,
  };
  let row = {
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    releaseEvidence: fixture.releaseEvidence,
    buildEvidence: fixture.dispatch,
    ownedPhotoBank: fixture.bank,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      attemptId: "hero_attempt:4",
      buildHash: HERO_BUILD_HASH,
    },
  };

  let phase = await processRowPhase(row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "mirrored");
  assert.equal(phase.row.heroRemaster.reason, "sandbox_video_retries_exhausted_static_hero_verified");
  assert.equal(phase.row.heroRemaster.staticHeroVerified, true);
  assert.equal(phase.row.heroRemaster.videoFailureReason, "write_EPROTO_SSL_wrong_version_number");
  assert.equal(phase.row.heroRemaster.videoTerminalReason, "write_EPROTO_SSL_wrong_version_number");
  assert.equal(phase.row.heroRemaster.videoAttempts, 3);
  assert.equal(phase.row.heroRemaster.videoAttemptCap, 3);
  assert.equal(phase.row.heroRemaster.lineBatchId, "line_client");
  assert.equal(phase.row.heroRemaster.lineRowId, "line_client:0");
  assert.equal(phase.row.heroRemaster.staticHeroPhotoSha256, PHOTO_SHA);
  assert.equal(phase.row.heroRemaster.staticHeroPhotoUrl, "https://client.example.com/projects/crew.jpg");
  assert.match(phase.row.heroRemaster.staticHeroBankFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(mirrorCalls, 0);

  const liveReplay = await processRowPhase(structuredClone(phase.row), {
    batchId: "line_client",
    lane: "live",
  }, deps);
  assert.equal(liveReplay.row.status, "rejected");
  assert.equal(liveReplay.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(gateCalls, 0);
  assert.equal(emails, 0);

  for (const mutate of [
    (candidate) => { delete candidate.ownedPhotoBank; },
    (candidate) => { candidate.heroRemaster.videoAttempts = 2; },
    (candidate) => { candidate.heroRemaster.videoAttemptCap = 2; },
    (candidate) => { candidate.heroRemaster.videoFailureReason = "clip_dimensions_out_of_range"; },
    (candidate) => { candidate.heroRemaster.videoTerminalReason = "hero_stale_failure_requeue"; },
    (candidate) => { candidate.heroRemaster.lineBatchId = "other_line"; },
    (candidate) => { candidate.heroRemaster.lineRowId = "other_line:0"; },
    (candidate) => { candidate.heroRemaster.staticHeroPhotoSha256 = "0".repeat(64); },
    (candidate) => { candidate.heroRemaster.staticHeroPhotoUrl = "https://client.example.com/projects/other.jpg"; },
    (candidate) => { candidate.heroRemaster.staticHeroBankFingerprint = "0".repeat(64); },
    (candidate) => { candidate.heroRemaster.baseEvidenceSha = "0".repeat(64); },
  ]) {
    const tampered = structuredClone(phase.row);
    mutate(tampered);
    const refused = await processRowPhase(tampered, {
      batchId: "line_client",
      lane: "sandbox",
    }, deps);
    assert.equal(refused.row.status, "rejected");
    assert.equal(refused.row.reason, "hero_media_requires_fresh_mirror");
  }
  assert.equal(gateCalls, 0, "tampered fallback markers never reach render");
  assert.equal(emails, 0);

  const fabricated = {
    ...structuredClone(phase.row),
    heroRemaster: {
      required: false,
      ready: true,
      pending: false,
      hold: false,
      fallback: true,
      applied: false,
      status: "skipped",
      reason: "sandbox_video_retries_exhausted_static_hero_verified",
      jobId: "hrj_fabricated",
      attemptId: "hero_attempt:4",
      producer: "openrouter_seedance",
      buildHash: HERO_BUILD_HASH,
      staticHeroVerified: true,
      staticHeroSource: "client_current_hero",
      staticHeroPhotoSha256: PHOTO_SHA,
      staticHeroPhotoUrl: "https://client.example.com/projects/crew.jpg",
      staticHeroBankFingerprint: phase.row.heroRemaster.staticHeroBankFingerprint,
      baseEvidenceSha: fixture.releaseEvidence.evidence_sha,
      lineBatchId: "line_client",
      lineRowId: "line_client:0",
      videoFailureReason: "openrouter_submit_failed",
      videoTerminalReason: "openrouter_submit_failed",
      videoAttempts: 3,
      videoAttemptCap: 3,
    },
  };
  const fabricatedRefusal = await processRowPhase(fabricated, {
    batchId: "line_client",
    lane: "sandbox",
  }, {
    ...deps,
    getHeroReelJobForProspect: async () => ({ ok: true, job: null }),
  });
  assert.equal(fabricatedRefusal.row.status, "rejected");
  assert.equal(fabricatedRefusal.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(gateCalls, 0, "a copied signed base cannot replace the durable job receipt");

  const receiptOutage = await processRowPhase(structuredClone(phase.row), {
    batchId: "line_client",
    lane: "sandbox",
  }, {
    ...deps,
    getHeroReelJobForProspect: async () => { throw new Error("temporary read outage"); },
  });
  assert.equal(receiptOutage.row.status, "mirrored");
  assert.equal(receiptOutage.phase, "hero_remaster");
  assert.equal(receiptOutage.row.lastRetryableError, "static_hero_job_receipt_read_unavailable");
  assert.equal(gateCalls, 0, "receipt uncertainty waits and cannot reach render");

  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "gate_passed");
  assert.equal(gateCalls, 1);

  const missingProof = structuredClone(phase.row);
  delete missingProof.proof_shots;
  delete missingProof.captured;
  const proofRefusal = await processRowPhase(missingProof, {
    batchId: "line_client",
    lane: "sandbox",
  }, deps);
  assert.equal(proofRefusal.row.status, "rejected");
  assert.equal(proofRefusal.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(writes, 0);
  assert.equal(emails, 0);

  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "queued");
  assert.equal(writes, 1);
  assert.equal(emails, 1);
});

test("newly harvested client-owned photo is persisted and queued before any stock gate", async () => {
  let stored = durable();
  const order = [];
  const refreshedBytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(refreshedBytes);
  refreshedBytes.writeUInt32BE(1600, 16);
  refreshedBytes.writeUInt32BE(900, 20);
  const refreshedSha = createHash("sha256").update(refreshedBytes).digest("hex");
  const result = await prepareMirroredHero(qualifiedRow(), {
    ok: true,
    previewUrl: PREVIEW,
    currentWebsite: SOURCE,
    ownedPhotoBank: ownedBank(),
  }, {
    env: {},
    downloadPublicImage: async () => refreshedBytes,
    select: async () => ({ ok: true, data: [structuredClone(stored)] }),
    conditionalUpdate: async (_table, _column, _id, _guards, patch) => {
      order.push("persist_owned_bank");
      stored = { ...stored, ...structuredClone(patch) };
      return { ok: true, updated: true, rows: [structuredClone(stored)] };
    },
    enqueueHeroRemasterForBuild: async (prospect, options) => {
      order.push("enqueue_remaster");
      assert.equal(prospect.record.photo_bank.photos[0].sha256, refreshedSha);
      assert.deepEqual(options.lineHandle, { batchId: "line_client", rowId: "line_client:0" });
      return { ok: true, queued: true, job_id: "hrj_client" };
    },
    getHeroReelJobForProspect: async () => ({
      ok: true,
      job: { jobId: "hrj_client", status: "queued", result: {} },
    }),
  });

  assert.deepEqual(order, ["persist_owned_bank", "enqueue_remaster"]);
  assert.equal(stored.record.photo_bank.photos[0].source, "own_site");
  assert.equal(stored.record.photo_bank.photos[0].sha256, refreshedSha);
  assert.equal(stored.record.photo_bank.photos[0].asset_type, "real_scene");
  assert.equal(result.heroRemaster.pending, true);
  assert.equal(result.heroRemaster.ready, false);
});

test("the durable-bank fallback forwards the completed build hash into the hero reoffer guard", async () => {
  const built = heroBuildOutput("7".repeat(64));
  const stored = durable(ownedBank({
    photo: {
      source: "google_business_profile",
      found_on: "https://maps.google.com/client-hero-plumbing",
    },
  }));
  let reofferBuildHash = null;
  const result = await prepareMirroredHero(qualifiedRow(), built, {
    batchId: "line_client",
    env: {},
    select: async () => ({ ok: true, data: [structuredClone(stored)] }),
    enqueueHeroRemasterForBuild: async (_prospect, options) => {
      reofferBuildHash = options.reofferBuildHash;
      return { ok: true, queued: true, job_id: "hrj_durable_bank", generation_revision: 4 };
    },
    getHeroReelJobForProspect: async () => ({
      ok: true,
      job: {
        jobId: "hrj_durable_bank",
        status: "queued",
        payload: {
          generation_revision: 4,
          line_handle: { batchId: "line_client", rowId: "line_client:0" },
        },
        result: {},
      },
    }),
  });

  assert.equal(reofferBuildHash, built.buildHash);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.heroRemaster.pending, true);
});

test("the automatic Line handle is stored on the durable hero job", async () => {
  let inserted = null;
  const queue = createHeroReelJobQueue({
    now: () => new Date(),
    newJobId: () => "hrj_line_handle",
    select: async () => ({ ok: true, data: [] }),
    insertRow: async (_table, row) => {
      inserted = structuredClone(row);
      return { ok: true, mode: "live_write", data: [structuredClone(row)] };
    },
    conditionalUpdate: async () => ({ ok: false }),
  });
  const lineHandle = { batchId: "line_client", rowId: "line_client:0" };
  const out = await queue.enqueueHeroReelJob({
    prospect_id: "client-hero-1",
    record: durable(ownedBank()).record,
  }, { actor: "full_run", lineHandle, vertical: "plumbing" });
  assert.equal(out.ok, true);
  assert.deepEqual(inserted.payload.line_handle, lineHandle);
});

test("a provenance-mismatched photo is never persisted, queued, or used", async () => {
  let writes = 0;
  let enqueues = 0;
  const result = await prepareMirroredHero(qualifiedRow(), {
    ok: true,
    previewUrl: PREVIEW,
    currentWebsite: SOURCE,
    ownedPhotoBank: ownedBank({ photo: { found_on: "https://foreign.example.net/stolen" } }),
  }, {
    select: async () => ({ ok: true, data: [durable()] }),
    conditionalUpdate: async () => { writes += 1; return { ok: true, updated: true }; },
    enqueueHeroRemasterForBuild: async () => { enqueues += 1; return { ok: true }; },
  });

  assert.equal(result.required, true);
  assert.equal(result.heroRemaster.hold, true);
  assert.equal(result.heroRemaster.reason, "hero_photo_bank_provenance_mismatch");
  assert.equal(writes, 0);
  assert.equal(enqueues, 0);
});

test("a provenance-mismatched photo can never reach gate, proof, or email", async () => {
  let gates = 0;
  let writes = 0;
  let emails = 0;
  const badBank = ownedBank({ photo: { found_on: "https://foreign.example.net/stolen" } });
  const out = await processRowPhase(qualifiedRow(), { batchId: "line_client" }, {
    mirror: async () => ({
      ok: true,
      previewUrl: PREVIEW,
      currentWebsite: SOURCE,
      ownedPhotoBank: badBank,
    }),
    prepareHero: (row, built, options) => prepareMirroredHero(row, built, {
      ...options,
      select: async () => ({ ok: true, data: [durable()] }),
    }),
    gate: async () => { gates += 1; return { pass: true }; },
    writePreviewUrl: async () => { writes += 1; return { ok: true }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });

  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "hero_photo_bank_provenance_mismatch");
  assert.equal(gates, 0);
  assert.equal(writes, 0);
  assert.equal(emails, 0);
});

test("stock first pass cannot reach render proof or email while verified hero is pending", async () => {
  let gates = 0;
  let writes = 0;
  let emails = 0;
  const out = await processRowPhase(qualifiedRow(), { batchId: "line_hero" }, {
    mirror: async () => ({ ok: true, previewUrl: PREVIEW, ownedPhotoBank: ownedBank() }),
    prepareHero: async () => ({
      ok: true,
      heroRemaster: { required: true, ready: false, pending: true, status: "queued", job_id: "hrj_client" },
      rowPatch: { durableUpdatedAt: "2026-08-21T20:00:01.000Z" },
    }),
    gate: async () => { gates += 1; return { pass: true }; },
    writePreviewUrl: async () => { writes += 1; return { ok: true }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });

  assert.equal(out.ok, true);
  assert.equal(out.row.status, "qualified");
  assert.equal(out.phase, "hero_remaster");
  assert.equal(out.row.heroRemaster.pending, true);
  assert.equal(gates, 0);
  assert.equal(writes, 0);
  assert.equal(emails, 0);
});

test("a refused hero plus signed stale build and reel cannot block a row without a current build checkpoint", async () => {
  const persisted = sharedCompletionFixture().current;
  persisted.record.truth_packet_source = "leadminer_mirror_ready";
  persisted.record.truth_packet = { source: "leadminer_mirror_ready", mirror_ready: { business_name: persisted.business_name } };
  let dispatched = 0;
  let joinReads = 0;
  const base = heroBuildOutput("f".repeat(64));
  const out = await mirrorProspect({
    ...qualifiedRow(),
    needs_fill: true,
    heroRemaster: { required: true, ready: false, pending: true, jobId: "hrj_parallel" },
  }, {
    lane: "sandbox",
    env: {},
    select: async () => ({ ok: true, data: [persisted] }),
    mirrorLaneEnabled: () => true,
    enqueueHeroRemasterForBuild: async (_prospect, options) => {
      assert.deepEqual(options.lineHandle, { batchId: "line_client", rowId: "line_client:0" });
      assert.equal(options.deferJoin, true, "pending pre-build hero must not join before base Mirror harvests");
      return {
        ok: true,
        reused: true,
        job_id: "hrj_parallel",
        skipped: "no_verified_owned_real_scene",
        line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
      };
    },
    getHeroReelJobForProspect: async () => {
      joinReads += 1;
      return { ok: true, job: { jobId: "hrj_parallel", status: "refused", result: { reason: "no_verified_owned_real_scene" } } };
    },
    dispatchMirrorLane: async () => {
      dispatched += 1;
      return { ...base, urls: { preview_url: PREVIEW }, build_hash: base.buildHash };
    },
  });

  assert.equal(dispatched, 1);
  assert.equal(joinReads, 0);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.previewUrl, PREVIEW);
});

test("zero photos from Mirror refreshes the durable bank before hero enqueue", async () => {
  let stored = durable(ownedBank());
  stored.record.photo_bank.photos = Array.from({ length: 13 }, (_, index) => ({
    ...stored.record.photo_bank.photos[0],
    url: `https://client.example.com/projects/crew-${index}.png`,
    sha256: String((index % 9) + 1).repeat(64),
  }));
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(1600, 16);
  bytes.writeUInt32BE(900, 20);
  const sha = createHash("sha256").update(bytes).digest("hex");
  let enqueued = 0;
  let downloads = 0;
  const out = await prepareMirroredHero(qualifiedRow(), { ok: true, previewUrl: PREVIEW, currentWebsite: SOURCE }, {
    env: {},
    select: async () => ({ ok: true, data: [structuredClone(stored)] }),
    downloadPublicImage: async (_url, options) => {
      downloads += 1;
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 30_000);
      return bytes;
    },
    conditionalUpdate: async (_table, _column, _id, _guards, patch) => {
      stored = { ...stored, ...structuredClone(patch) };
      return { ok: true, updated: true, rows: [structuredClone(stored)] };
    },
    enqueueHeroRemasterForBuild: async (prospect) => {
      enqueued += 1;
      assert.equal(prospect.record.photo_bank.photos[0].sha256, sha);
      return { ok: true, queued: true, job_id: "hrj_refreshed" };
    },
    getHeroReelJobForProspect: async () => ({ ok: true, job: { jobId: "hrj_refreshed", status: "queued", result: {} } }),
  });
  assert.equal(enqueued, 1);
  assert.equal(downloads, 12, "one refresh caps a hostile bank at twelve URLs");
  assert.equal(stored.record.hero_photo_refresh.reason, "refreshed");
  assert.equal(out.heroRemaster.pending, true);
});

test("refresh failure and refresh CAS loss enqueue no provider work", async () => {
  for (const mode of ["download_failure", "cas_loss"]) {
    let stored = durable(ownedBank());
    let downloads = 0;
    let enqueues = 0;
    const bytes = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.writeUInt32BE(1600, 16);
    bytes.writeUInt32BE(900, 20);
    const out = await prepareMirroredHero(qualifiedRow(), { ok: true, previewUrl: PREVIEW, currentWebsite: SOURCE }, {
      env: {},
      select: async () => ({ ok: true, data: [structuredClone(stored)] }),
      downloadPublicImage: async () => {
        downloads += 1;
        if (mode === "download_failure") throw new Error("timed_out");
        return bytes;
      },
      conditionalUpdate: async (_table, _column, _id, _guards, patch) => {
        if (mode === "cas_loss") return { ok: true, updated: false, rows: [] };
        stored = { ...stored, ...structuredClone(patch) };
        return { ok: true, updated: true, rows: [structuredClone(stored)] };
      },
      enqueueHeroRemasterForBuild: async () => { enqueues += 1; return { ok: true, queued: true }; },
    });
    assert.equal(downloads, 1, mode);
    assert.equal(enqueues, 0, mode);
    assert.equal(out.pending, true, JSON.stringify(out));
    assert.match(String(out.reason), /hero_photo_refresh_(?:failed|cas_pending)/);
  }
});

test("a verified source durably selects Seedance before the base mirror dispatch", async () => {
  const persisted = durable();
  persisted.record.truth_packet_source = "leadminer_mirror_ready";
  persisted.record.truth_packet = {
    source: "leadminer_mirror_ready",
    mirror_ready: { business_name: persisted.business_name },
  };
  const order = [];
  let queuedOptions = null;
  const base = heroBuildOutput("9".repeat(64));

  const out = await mirrorProspect({ ...qualifiedRow(), needs_fill: true }, {
    lane: "sandbox",
    env: {},
    select: async () => ({ ok: true, data: [persisted] }),
    mirrorLaneEnabled: () => true,
    enqueueHeroReelJob: async (_prospect, options) => {
      order.push("durable_seedance_enqueue");
      queuedOptions = options;
      return { ok: true, queued: true, job_id: "hrj_seedance_source" };
    },
    getHeroReelJobForProspect: async () => {
      order.push("hero_join_read");
      return { ok: true, job: { jobId: "hrj_seedance_source", status: "queued", result: {} } };
    },
    dispatchMirrorLane: async () => {
      order.push("base_mirror");
      return { ...base, urls: { preview_url: PREVIEW }, build_hash: base.buildHash };
    },
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(queuedOptions, "a verified current website must create the durable hero job before Mirror returns");
  assert.equal(queuedOptions.producer, "openrouter_seedance");
  assert.deepEqual(queuedOptions.lineHandle, { batchId: "line_client", rowId: "line_client:0" });
  assert.ok(order.indexOf("durable_seedance_enqueue") < order.indexOf("base_mirror"));
});

test("a current build checkpoint polls its pending hero without dispatching Mirror again", async () => {
  const persisted = sharedCompletionFixture().current;
  persisted.record.truth_packet_source = "leadminer_mirror_ready";
  persisted.record.truth_packet = { source: "leadminer_mirror_ready", mirror_ready: { business_name: persisted.business_name } };
  let dispatched = 0;
  const out = await mirrorProspect({
    ...qualifiedRow(),
    needs_fill: true,
    buildHash: HERO_BUILD_HASH,
    heroRemaster: { required: true, pending: true, jobId: "hrj_client", buildHash: HERO_BUILD_HASH, reelUrl: REEL_URL },
  }, {
    lane: "sandbox",
    env: {},
    select: async () => ({ ok: true, data: [persisted] }),
    mirrorLaneEnabled: () => true,
    enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: {
      jobId: "hrj_client",
      status: "queued",
      payload: { line_handle: { batchId: "line_client", rowId: "line_client:0" } },
      result: {},
    } }),
    dispatchMirrorLane: async () => { dispatched += 1; throw new Error("current build must not dispatch twice"); },
  });

  assert.equal(out.heroRemasterPending, true, JSON.stringify(out));
  assert.equal(dispatched, 0);
});

test("a stale done hero from another Line handle ships only the verified base without rebuilding or claiming video", async () => {
  const fixture = sharedCompletionFixture();
  fixture.current.record.truth_packet_source = "leadminer_mirror_ready";
  fixture.current.record.truth_packet = {
    source: "leadminer_mirror_ready",
    mirror_ready: { business_name: fixture.current.business_name },
  };
  delete fixture.current.record.media_bank.hero_reel;
  fixture.job.payload.line_handle = { batchId: "old_batch", rowId: "old_batch:0" };
  const built = heroBuildOutput();
  let mirrorDispatches = 0;
  const row = {
    ...qualifiedRow(),
    previewUrl: built.previewUrl,
    buildHash: built.buildHash,
    currentWebsite: built.currentWebsite,
    contentSource: built.contentSource,
    buildEvidence: built.buildEvidence,
    releaseEvidence: built.releaseEvidence,
    publishedAggregate: built.publishedAggregate,
    photoAccounting: built.photoAccounting,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      buildHash: HERO_BUILD_HASH,
      status: "stale_line_handle",
      reason: "hero_remaster_line_handle_mismatch",
    },
  };
  const deps = {
    env: {},
    mirror: async () => {
      mirrorDispatches += 1;
      throw new Error("a verified base must not be rebuilt for a foreign completed clip");
    },
    heroJoinOnly: (candidate, options) => heroJoinOnlyRecheck(candidate, {
      ...options,
      select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
      enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(fixture.job) }),
    }),
    sourceFacts: async () => ({}),
    gate: async () => ({
      pass: true,
      failed: [],
      checks: [],
      capture: {
        ok: true,
        shots: {
          build_hash: HERO_BUILD_HASH,
          old_captured_url: SOURCE,
          old_shot_sha: "c".repeat(64),
          new_captured_url: PREVIEW,
          new_shot_sha: "d".repeat(64),
        },
        results: [],
      },
    }),
    now: () => NOW,
  };
  let phase = await processRowPhase(row, { batchId: "line_client", lane: "sandbox" }, deps);

  assert.equal(phase.row.status, "mirrored", JSON.stringify(phase));
  assert.equal(mirrorDispatches, 0, "the already-proven base Mirror is reused");
  assert.equal(phase.row.heroRemaster.required, false);
  assert.equal(phase.row.heroRemaster.fallback, true);
  assert.equal(phase.row.heroRemaster.reason, "stale_done_line_handle_ignored");
  assert.equal(phase.row.heroRemaster.applied, false);
  assert.equal(phase.row.heroRemaster.reelUrl, "", "the old handle's video is never claimed");
  assert.equal(phase.row.heroRemaster.buildHash, HERO_BUILD_HASH);
  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "gate_passed", JSON.stringify(phase));
  assert.notEqual(phase.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(mirrorDispatches, 0, "render gating also reuses the same verified base");
});

test("a stale done hero cannot authorize fallback without the current signed base checkpoint", async () => {
  const fixture = sharedCompletionFixture();
  delete fixture.current.record.build_dispatch;
  fixture.job.payload.line_handle = { batchId: "old_batch", rowId: "old_batch:0" };
  const out = await enqueueCompletedLineHero({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    heroRemaster: { required: true, pending: true, jobId: "hrj_client" },
  }, fixture.current, fixture.current.record, {
    env: {},
    enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(fixture.job) }),
  });

  assert.equal(out.required, true);
  assert.equal(out.pending, true);
  assert.equal(out.fallback, undefined);
  assert.equal(out.reason, "hero_remaster_line_handle_mismatch");
});

test("a foreign same-build allowlisted refusal at counter zero exposes one exact reoffer snapshot", async () => {
  const { out, enqueues } = await inspectForeignTerminalHero({
    reason: "no_verified_owned_real_scene",
  });

  assert.equal(enqueues, 0);
  assert.equal(out.required, true);
  assert.equal(out.pending, true);
  assert.equal(out.ready, false);
  assert.equal(out.fallback, undefined);
  assert.equal(out.reason, "hero_remaster_line_handle_mismatch");
  assert.deepEqual(out.stale_job_snapshot, {
    job_id: "hrj_client",
    status: "refused",
    revision: 4,
    line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
    lease_token: "",
    lease_owner: "",
    lease_expires_at: "",
  });
});

test("a foreign same-build definitive refusal at counter one ships the exact signed base fallback", async () => {
  const { out, enqueues } = await inspectForeignTerminalHero({
    reason: "no_verified_owned_real_scene",
    reofferCount: 1,
  });

  assert.equal(enqueues, 0);
  assert.equal(out.required, false);
  assert.equal(out.ready, true);
  assert.equal(out.fallback, true);
  assert.equal(out.hold, false);
  assert.equal(out.pending, false);
  assert.equal(out.reason, "no_verified_owned_real_scene");
  assert.equal(out.build_hash, HERO_BUILD_HASH);
  assert.equal(out.job_id, "hrj_client");
  assert.equal(out.hero_attempt_id, "hero_attempt:4");
  assert.equal(out.producer, "openrouter_seedance");
  assert.equal(out.reel_url, undefined, "a foreign clip is never attached");
  assert.notEqual(out.applied, true);
});

test("a foreign same-build technical failure at counter one becomes a durable live-producer hold", async () => {
  const { out, enqueues } = await inspectForeignTerminalHero({
    reason: "source_sha256_mismatch",
    reofferCount: 1,
  });

  assert.equal(enqueues, 0);
  assert.equal(out.required, true);
  assert.equal(out.ready, false);
  assert.equal(out.pending, false);
  assert.equal(out.hold, true);
  assert.equal(out.fallback, undefined);
  assert.equal(out.reason, "source_sha256_mismatch");
  assert.equal(out.build_hash, HERO_BUILD_HASH);
  assert.equal(out.job_id, "hrj_client");
  assert.equal(out.hero_attempt_id, "hero_attempt:4");
  assert.equal(out.producer, "openrouter_seedance");
});

test("a foreign same-build content-policy refusal holds immediately even before the retry counter is spent", async () => {
  const { out, enqueues } = await inspectForeignTerminalHero({
    reason: "video_content_policy",
  });

  assert.equal(enqueues, 0);
  assert.equal(out.hold, true);
  assert.equal(out.pending, false);
  assert.equal(out.fallback, undefined);
  assert.equal(out.reason, "video_content_policy");
  assert.equal(out.job_id, "hrj_client");
  assert.equal(out.hero_attempt_id, "hero_attempt:4");
  assert.equal(out.producer, "openrouter_seedance");
});

test("a foreign same-build Seedance dimensions failure with an accepted checkpoint reaches the one-shot retry path", async () => {
  const { out, enqueues } = await inspectForeignTerminalHero({
    reason: "clip_dimensions_out_of_range",
    status: "failed",
    providerCheckpoint: acceptedSeedanceCheckpoint(),
  });

  assert.equal(enqueues, 0, "inspect-only admission cannot enqueue provider work");
  assert.equal(out.required, true);
  assert.equal(out.pending, true);
  assert.equal(out.ready, false);
  assert.equal(out.hold, undefined);
  assert.equal(out.fallback, undefined);
  assert.equal(out.reason, "hero_remaster_line_handle_mismatch");
  assert.deepEqual(out.stale_job_snapshot, {
    job_id: "hrj_client",
    status: "failed",
    revision: 4,
    line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
    lease_token: "",
    lease_owner: "",
    lease_expires_at: "",
  });
  assert.equal(out.reel_url, undefined, "the foreign clip is never attached");
  assert.notEqual(out.applied, true);
});

test("missing or malformed Seedance checkpoints keep a foreign dimensions failure on technical hold", async () => {
  for (const [name, providerCheckpoint] of [
    ["missing", undefined],
    ["non_object", "accepted"],
    ["not_accepted", acceptedSeedanceCheckpoint({ submission_state: "intent", polling_url: "", provider_job_id: "" })],
    ["accepted_without_identity", { submission_state: "accepted" }],
  ]) {
    const { out, enqueues } = await inspectForeignTerminalHero({
      reason: "clip_dimensions_out_of_range",
      status: "failed",
      providerCheckpoint,
    });
    assert.equal(enqueues, 0, name);
    assert.equal(out.required, true, name);
    assert.equal(out.ready, false, name);
    assert.equal(out.pending, false, name);
    assert.equal(out.hold, true, name);
    assert.equal(out.fallback, undefined, name);
    assert.equal(out.reason, "clip_dimensions_out_of_range", name);
    assert.equal(out.job_id, "hrj_client", name);
    assert.equal(out.hero_attempt_id, "hero_attempt:4", name);
    assert.equal(out.producer, "openrouter_seedance", name);
    assert.equal(out.reel_url, undefined, name);
  }
});

test("a spent Seedance dimensions retry stays on technical hold even with its accepted checkpoint", async () => {
  const { out, enqueues } = await inspectForeignTerminalHero({
    reason: "clip_dimensions_out_of_range",
    status: "failed",
    reofferCount: 1,
    providerCheckpoint: acceptedSeedanceCheckpoint(),
  });

  assert.equal(enqueues, 0);
  assert.equal(out.required, true);
  assert.equal(out.ready, false);
  assert.equal(out.pending, false);
  assert.equal(out.hold, true);
  assert.equal(out.fallback, undefined);
  assert.equal(out.reason, "clip_dimensions_out_of_range");
  assert.equal(out.job_id, "hrj_client");
  assert.equal(out.hero_attempt_id, "hero_attempt:4");
  assert.equal(out.producer, "openrouter_seedance");
  assert.equal(out.reel_url, undefined);
});

test("openrouter submit failure remains a foreign technical hold and never enters dimensions recovery", async () => {
  const { out, enqueues } = await inspectForeignTerminalHero({
    reason: "openrouter_submit_failed",
    status: "failed",
    providerCheckpoint: acceptedSeedanceCheckpoint(),
  });

  assert.equal(enqueues, 0);
  assert.equal(out.pending, false);
  assert.equal(out.hold, true);
  assert.equal(out.fallback, undefined);
  assert.equal(out.reason, "openrouter_submit_failed");
  assert.equal(out.producer, "openrouter_seedance");
});

test("a foreign same-build Ads blocker keeps the explicit operator hold", async () => {
  const { out, enqueues } = await inspectForeignTerminalHero({
    reason: "ads_blocked_by_extension",
    producer: "ads_image_to_video",
    status: "failed",
  });

  assert.equal(enqueues, 0);
  assert.equal(out.required, true);
  assert.equal(out.ready, false);
  assert.equal(out.pending, true);
  assert.equal(out.hold, undefined);
  assert.equal(out.fallback, undefined);
  assert.equal(out.status, "operator_action_required");
  assert.equal(out.reason, "ads_blocked_by_extension");
  assert.equal(out.build_hash, HERO_BUILD_HASH);
  assert.equal(out.job_id, "hrj_client");
  assert.equal(out.hero_attempt_id, "hero_attempt:4");
  assert.equal(out.producer, "ads_image_to_video");
});

test("a foreign terminal refusal without an exact signed current base can never authorize fallback", async () => {
  const { out, enqueues } = await inspectForeignTerminalHero({
    reason: "no_verified_owned_real_scene",
    reofferCount: 1,
    signedBase: false,
  });

  assert.equal(enqueues, 0);
  assert.equal(out.required, true);
  assert.equal(out.pending, true);
  assert.equal(out.fallback, undefined);
  assert.equal(out.reason, "hero_remaster_line_handle_mismatch");
});

test("repeat foreign-terminal resolution spends neither another hero enqueue nor another Mirror dispatch", async () => {
  const fixture = sharedCompletionFixture();
  const signedBase = heroBuildOutput();
  delete fixture.current.record.media_bank.hero_reel;
  fixture.job.status = "refused";
  fixture.job.producer = "openrouter_seedance";
  fixture.job.payload = {
    generation_revision: 5,
    line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
    line_build_hash: HERO_BUILD_HASH,
    line_same_build_reoffer_count: 1,
  };
  fixture.job.result = { reason: "no_verified_owned_real_scene" };
  let heroEnqueues = 0;
  let mirrorDispatches = 0;
  const row = {
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    buildEvidence: signedBase.buildEvidence,
    releaseEvidence: signedBase.releaseEvidence,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      attemptId: "hero_attempt:5",
      status: "stale_line_handle",
      reason: "hero_remaster_line_handle_mismatch",
    },
  };
  const deps = {
    mirror: async () => {
      mirrorDispatches += 1;
      throw new Error("resolved signed base must not dispatch Mirror");
    },
    heroJoinOnly: (candidate, options) => heroJoinOnlyRecheck(candidate, {
      ...options,
      env: {},
      select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
      enqueueHeroRemasterForBuild: async () => {
        heroEnqueues += 1;
        throw new Error("spent same-build retry must not enqueue again");
      },
      getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(fixture.job) }),
    }),
    now: () => NOW,
  };

  const first = await processRowPhase(structuredClone(row), { batchId: "line_client", lane: "sandbox" }, deps);
  const repeat = await processRowPhase(structuredClone(row), { batchId: "line_client", lane: "sandbox" }, deps);

  assert.equal(heroEnqueues, 0);
  assert.equal(mirrorDispatches, 0);
  for (const result of [first, repeat]) {
    assert.equal(result.row.status, "mirrored", JSON.stringify(result));
    assert.equal(result.row.heroRemaster.fallback, true);
    assert.equal(result.row.heroRemaster.reason, "no_verified_owned_real_scene");
    assert.equal(result.row.heroRemaster.jobId, "hrj_client");
    assert.equal(result.row.heroRemaster.attemptId, "hero_attempt:5");
    assert.equal(result.row.heroRemaster.producer, "openrouter_seedance");
    assert.equal(result.row.heroRemaster.reelUrl, "");
  }
});

test("inspectOnly returns the canonical stale Line-handle shape without enqueueing", async () => {
  const current = sharedCompletionFixture().current;
  let enqueues = 0;
  const out = await enqueueCompletedLineHero({
    ...qualifiedRow(), buildHash: HERO_BUILD_HASH,
    heroRemaster: { required: true, jobId: "hrj_client" },
  }, current, current.record, {
    env: {}, inspectOnly: true,
    enqueueHeroRemasterForBuild: async () => { enqueues += 1; return { ok: true, queued: true }; },
    getHeroReelJobForProspect: async () => ({ ok: true, job: {
      jobId: "hrj_client", status: "refused",
      payload: { line_handle: { batchId: "old_batch", rowId: "old_batch:0" }, generation_revision: 4 },
      result: { reason: "no_verified_owned_real_scene" },
    } }),
  });
  assert.equal(enqueues, 0);
  assert.deepEqual({ pending: out.pending, status: out.status, reason: out.reason }, {
    pending: true, status: "stale_line_handle", reason: "hero_remaster_line_handle_mismatch",
  });
});

test("join-only recheck yields a stale terminal handle to the guarded reoffer path", async () => {
  const fixture = sharedCompletionFixture();
  fixture.job.status = "refused";
  fixture.job.payload = {
    line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
    generation_revision: 4,
  };
  fixture.job.result = { reason: "no_verified_owned_real_scene" };
  delete fixture.current.record.media_bank.hero_reel;

  let enqueues = 0;
  const out = await heroJoinOnlyRecheck({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      buildHash: HERO_BUILD_HASH,
      status: "stale_line_handle",
      reason: "hero_remaster_line_handle_mismatch",
    },
  }, {
    batchId: "line_client",
    env: {},
    select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
    enqueueHeroRemasterForBuild: async () => {
      enqueues += 1;
      throw new Error("join-only recheck must never mutate or reoffer");
    },
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(fixture.job) }),
  });

  assert.equal(enqueues, 0);
  assert.deepEqual(out, {
    skipped: true,
    reason: "hero_line_handle_reoffer_required",
  });
});

test("read-only join keeps a same-handle definitive refusal on the donor fallback rung", async () => {
  const fixture = sharedCompletionFixture();
  fixture.job.status = "refused";
  fixture.job.payload = {
    line_handle: { batchId: "line_client", rowId: "line_client:0" },
    generation_revision: 4,
  };
  fixture.job.result = { reason: "no_verified_owned_real_scene" };
  delete fixture.current.record.media_bank.hero_reel;
  let enqueues = 0;

  const out = await heroJoinOnlyRecheck({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      buildHash: HERO_BUILD_HASH,
    },
  }, {
    batchId: "line_client",
    env: {},
    select: async () => ({ ok: true, data: [structuredClone(fixture.current)] }),
    enqueueHeroRemasterForBuild: async () => {
      enqueues += 1;
      throw new Error("read-only join must never enqueue");
    },
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(fixture.job) }),
  });

  assert.equal(enqueues, 0);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.heroRemaster.fallback, true);
  assert.equal(out.heroRemaster.required, false);
  assert.equal(out.heroRemaster.reason, "no_verified_owned_real_scene");
  assert.equal(out.rowPatch.heroRemaster.pending, false);
});

test("inspectable completed shared hero cannot apply without its persisted reel", async () => {
  const fixture = sharedCompletionFixture();
  delete fixture.current.record.media_bank.hero_reel;
  const out = await enqueueCompletedLineHero({
    ...qualifiedRow(), buildHash: HERO_BUILD_HASH,
    heroRemaster: { required: true, jobId: "hrj_client", buildHash: HERO_BUILD_HASH },
  }, fixture.current, fixture.current.record, {
    env: {}, inspectOnly: true,
    getHeroReelJobForProspect: async () => ({ ok: true, job: fixture.job }),
  });
  assert.notEqual(out.applied, true);
  assert.equal(out.hold, true);
  assert.equal(out.reason, "hero_shared_release_identity_unproven");
});

test("a current build refreshes and reoffers a stale-Line hero before returning pending", async () => {
  let persisted = sharedCompletionFixture().current;
  persisted.record.truth_packet_source = "leadminer_mirror_ready";
  persisted.record.truth_packet = { source: "leadminer_mirror_ready", mirror_ready: { business_name: persisted.business_name } };
  delete persisted.record.media_bank.hero_reel;
  const beforeCheckpoint = { ...structuredClone(persisted), updated_at: "2026-08-21T19:59:59.000Z" };
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(1600, 16);
  bytes.writeUInt32BE(900, 20);
  const freshSha = createHash("sha256").update(bytes).digest("hex");
  let enqueues = 0;
  let reads = 0;
  let prospectReads = 0;
  let dispatched = 0;
  const out = await mirrorProspect({
    ...qualifiedRow(),
    needs_fill: true,
    buildHash: HERO_BUILD_HASH,
    heroRemaster: {
      required: true, pending: true, jobId: "hrj_client",
      buildHash: "", reelUrl: "", status: "stale_line_handle", reason: "hero_remaster_line_handle_mismatch",
    },
  }, {
    lane: "sandbox",
    env: {},
    select: async () => ({ ok: true, data: [structuredClone(prospectReads++ === 0 ? beforeCheckpoint : persisted)] }),
    mirrorLaneEnabled: () => true,
    downloadPublicImage: async () => bytes,
    conditionalUpdate: async (_table, _column, _id, guards, patch) => {
      assert.equal(guards.updated_at, `eq.${persisted.updated_at}`);
      persisted = { ...persisted, ...structuredClone(patch) };
      return { ok: true, updated: true, rows: [structuredClone(persisted)] };
    },
    enqueueHeroRemasterForBuild: async (prospect) => {
      enqueues += 1;
      assert.equal(prospect.record.photo_bank.photos[0].sha256, freshSha);
      return { ok: true, queued: true, job_id: "hrj_client" };
    },
    getHeroReelJobForProspect: async () => {
      reads += 1;
      return { ok: true, job: {
        jobId: "hrj_client",
        status: "refused",
        payload: { line_handle: { batchId: "old_batch", rowId: "old_batch:0" }, generation_revision: 4 },
        result: { reason: "no_verified_owned_real_scene" },
      } };
    },
    dispatchMirrorLane: async () => { dispatched += 1; throw new Error("current build must not dispatch twice"); },
  });

  assert.equal(enqueues, 1, "the stale probe is read-only; only the refreshed bank may reoffer");
  assert.equal(reads, 2);
  assert.equal(dispatched, 0);
  assert.equal(persisted.record.hero_photo_refresh.reason, "refreshed");
  assert.equal(persisted.record.hero_photo_refresh.admission_source, "carried_marker");
  assert.equal(persisted.record.photo_bank.photos[0].sha256, freshSha);
  assert.equal(out.heroRemasterPending, true, JSON.stringify(out));
  assert.equal(out.heroRemaster.reason, "hero_remaster_line_handle_mismatch", "the next poll may still observe the old snapshot after reoffer");
});

test("stale-Line inspection cannot reopen or spend when refresh or prospect CAS fails", async () => {
  for (const mode of ["download_failure", "cas_loss"]) {
    const persisted = sharedCompletionFixture().current;
    persisted.record.truth_packet_source = "leadminer_mirror_ready";
    persisted.record.truth_packet = { source: "leadminer_mirror_ready", mirror_ready: { business_name: persisted.business_name } };
    const job = {
      status: "refused",
      revision: 4,
      payload: { line_handle: { batchId: "old_batch", rowId: "old_batch:0" }, generation_revision: 4, line_build_hash: mode === "cas_loss" ? "d".repeat(64) : null },
    };
    const before = structuredClone(job);
    const bytes = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.writeUInt32BE(1600, 16);
    bytes.writeUInt32BE(900, 20);
    let providerStarts = 0;
    const out = await mirrorProspect({
      ...qualifiedRow(), needs_fill: true, buildHash: HERO_BUILD_HASH,
      heroRemaster: { required: true, pending: true, jobId: "hrj_client", buildHash: HERO_BUILD_HASH, reelUrl: REEL_URL },
    }, {
      lane: "sandbox", env: {}, mirrorLaneEnabled: () => true,
      select: async () => ({ ok: true, data: [structuredClone(persisted)] }),
      downloadPublicImage: async () => {
        if (mode === "download_failure") throw new Error("timed_out");
        return bytes;
      },
      conditionalUpdate: async () => mode === "cas_loss"
        ? { ok: true, updated: false, rows: [] }
        : { ok: true, updated: true, rows: [] },
      enqueueHeroRemasterForBuild: async () => {
        providerStarts += 1;
        job.status = "queued";
        job.revision += 1;
        job.payload.line_handle = { batchId: "line_client", rowId: "line_client:0" };
        return { ok: true, queued: true, job_id: "hrj_client" };
      },
      getHeroReelJobForProspect: async () => ({ ok: true, job: {
        jobId: "hrj_client", status: job.status, payload: job.payload, result: { reason: "no_verified_owned_real_scene" },
      } }),
      dispatchMirrorLane: async () => { throw new Error("pending current build cannot dispatch"); },
    });

    assert.equal(providerStarts, 0, mode);
    assert.deepEqual(job, before, `${mode}: queue revision, handle, and status stay unchanged`);
    assert.equal(out.heroRemasterPending, true, JSON.stringify(out));
    assert.match(String(out.heroRemaster.reason), /hero_photo_refresh_(?:failed|cas_pending)/);
  }
});

test("a carried stale marker refuses unsafe durable job snapshots with zero spend", async () => {
  for (const mode of ["current_handle", "queued", "running", "wrong_job_id"]) {
    const persisted = sharedCompletionFixture().current;
    persisted.record.truth_packet_source = "leadminer_mirror_ready";
    persisted.record.truth_packet = { source: "leadminer_mirror_ready", mirror_ready: { business_name: persisted.business_name } };
    delete persisted.record.media_bank.hero_reel;
    let downloads = 0;
    let enqueues = 0;
    const out = await mirrorProspect({
      ...qualifiedRow(), needs_fill: true, buildHash: HERO_BUILD_HASH,
      heroRemaster: { required: true, pending: true, jobId: "hrj_client", status: "stale_line_handle", reason: "hero_remaster_line_handle_mismatch" },
    }, {
      lane: "sandbox", env: {}, mirrorLaneEnabled: () => true,
      select: async () => ({ ok: true, data: [structuredClone(persisted)] }),
      downloadPublicImage: async () => { downloads += 1; throw new Error("must_not_download"); },
      enqueueHeroRemasterForBuild: async () => { enqueues += 1; return { ok: true, queued: true }; },
      getHeroReelJobForProspect: async () => ({ ok: true, job: {
        jobId: mode === "wrong_job_id" ? "hrj_other" : "hrj_client",
        status: ["queued", "running"].includes(mode) ? mode : "refused",
        payload: {
          generation_revision: 4,
          line_handle: mode === "current_handle"
            ? { batchId: "line_client", rowId: "line_client:0" }
            : { batchId: "old_batch", rowId: "old_batch:0" },
        },
        result: { reason: "no_verified_owned_real_scene" },
      } }),
      dispatchMirrorLane: async () => { throw new Error("unsafe carried marker must remain pending/held"); },
    });
    assert.equal(downloads, 0, mode);
    assert.equal(enqueues, 0, mode);
    assert.equal(persisted.record.hero_photo_refresh, undefined, mode);
    assert.ok(out.heroRemasterPending === true || out.heroRemasterHold === true, `${mode}: ${JSON.stringify(out)}`);
  }
});

test("persisted signed Mirror recovery supplies an absent Line build checkpoint before stale hero refresh", async () => {
  let persisted = sharedCompletionFixture().current;
  persisted.record.truth_packet_source = "leadminer_mirror_ready";
  persisted.record.truth_packet = { source: "leadminer_mirror_ready", mirror_ready: { business_name: persisted.business_name } };
  delete persisted.record.media_bank.hero_reel;
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(1600, 16);
  bytes.writeUInt32BE(900, 20);
  let jobReads = 0;
  let reoffers = 0;
  let mirrorDispatches = 0;
  const row = {
    ...qualifiedRow(), needs_fill: true,
    heroRemaster: { required: true, ready: false, pending: true, jobId: "hrj_client", status: "stale_line_handle", reason: "hero_remaster_line_handle_mismatch" },
  };
  delete row.buildHash;
  delete row.previewUrl;
  const recoveredBuild = { ok: true, recovered: true, recovery: "persisted_signed_mirror", previewUrl: PREVIEW, buildHash: HERO_BUILD_HASH, currentWebsite: SOURCE };
  const out = await mirrorProspectResumable(row, {
    lane: "sandbox", env: {}, mirrorLaneEnabled: () => true,
    recoverPersistedMirrorBuild: async () => ({ recovered: true, build: recoveredBuild }),
    select: async () => ({ ok: true, data: [structuredClone(persisted)] }),
    downloadPublicImage: async () => bytes,
    conditionalUpdate: async (_table, _column, _id, _guards, patch) => {
      persisted = { ...persisted, ...structuredClone(patch) };
      return { ok: true, updated: true, rows: [structuredClone(persisted)] };
    },
    getHeroReelJobForProspect: async () => {
      jobReads += 1;
      return { ok: true, job: {
        jobId: "hrj_client", status: jobReads === 1 ? "failed" : "queued",
        payload: { generation_revision: jobReads === 1 ? 4 : 5, line_handle: jobReads === 1
          ? { batchId: "old_batch", rowId: "old_batch:0" }
          : { batchId: "line_client", rowId: "line_client:0" } },
        result: jobReads === 1 ? { reason: "source_sha256_mismatch" } : {},
      } };
    },
    enqueueHeroRemasterForBuild: async (_prospect, options) => {
      reoffers += 1;
      assert.equal(options.expectedStaleJobSnapshot.job_id, "hrj_client");
      return { ok: true, queued: true, job_id: "hrj_client" };
    },
    dispatchMirrorLane: async () => { mirrorDispatches += 1; throw new Error("must not redispatch recovered Mirror"); },
  });
  assert.equal(reoffers, 1);
  assert.equal(mirrorDispatches, 0);
  assert.equal(persisted.record.hero_photo_refresh.reason, "refreshed");
  assert.equal(out.heroRemasterPending, true, JSON.stringify(out));
  assert.equal(out.revealable, true);
  assert.equal(out.previewUrl, PREVIEW);
  assert.equal(out.buildHash, HERO_BUILD_HASH);
});

test("persisted signed same-build recovery reoffers a foreign terminal hero once across concurrent polls", { timeout: 5_000 }, async () => {
  let persisted = sharedCompletionFixture().current;
  persisted.status = "line_gate_passed";
  persisted.record.truth_packet_source = "leadminer_mirror_ready";
  persisted.record.truth_packet = { source: "leadminer_mirror_ready", mirror_ready: { business_name: persisted.business_name } };
  delete persisted.record.media_bank.hero_reel;
  const selectedVersion = persisted.updated_at;
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(1600, 16);
  bytes.writeUInt32BE(900, 20);

  let job = {
    jobId: "hrj_client",
    producer: "openrouter_seedance",
    status: "refused",
    payload: {
      generation_revision: 4,
      line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
      line_build_hash: HERO_BUILD_HASH,
    },
    result: { reason: "source_sha256_mismatch" },
    leaseToken: "",
    leaseOwner: "",
    leaseExpiresAt: "",
  };
  const expectedStaleSnapshot = {
    job_id: "hrj_client",
    status: "refused",
    revision: 4,
    line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
    lease_token: "",
    lease_owner: "",
    lease_expires_at: "",
  };
  let initialJobReads = 0;
  let releaseInitialJobReads;
  const bothReadTerminalJob = new Promise((resolve) => { releaseInitialJobReads = resolve; });
  let refreshCasAttempts = 0;
  let refreshCasWins = 0;
  let releaseRefreshCas;
  const bothReachedRefreshCas = new Promise((resolve) => { releaseRefreshCas = resolve; });
  let queueResets = 0;
  let mirrorDispatches = 0;

  const row = {
    ...qualifiedRow(),
    needs_fill: true,
    durableUpdatedAt: selectedVersion,
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      attemptId: "hero_attempt:4",
      status: "stale_line_handle",
      reason: "hero_remaster_line_handle_mismatch",
    },
  };
  const options = {
    lane: "sandbox",
    batchId: "line_client",
    env: {},
    mirrorLaneEnabled: () => true,
    select: async () => ({ ok: true, data: [structuredClone(persisted)] }),
    downloadPublicImage: async () => bytes,
    conditionalUpdate: async (_table, _column, _id, guards, patch) => {
      refreshCasAttempts += 1;
      assert.equal(guards.updated_at, `eq.${selectedVersion}`);
      if (refreshCasAttempts === 2) releaseRefreshCas();
      await bothReachedRefreshCas;
      if (refreshCasWins > 0) return { ok: true, updated: false, rows: [] };
      refreshCasWins += 1;
      persisted = { ...persisted, ...structuredClone(patch) };
      return { ok: true, updated: true, rows: [structuredClone(persisted)] };
    },
    getHeroReelJobForProspect: async () => {
      if (job.status === "refused" && initialJobReads < 2) {
        const snapshot = structuredClone(job);
        initialJobReads += 1;
        if (initialJobReads === 2) releaseInitialJobReads();
        await bothReadTerminalJob;
        return { ok: true, job: snapshot };
      }
      return { ok: true, job: structuredClone(job) };
    },
    enqueueHeroRemasterForBuild: async (_prospect, enqueueOptions) => {
      queueResets += 1;
      assert.equal(queueResets, 1);
      assert.deepEqual(enqueueOptions.expectedStaleJobSnapshot, expectedStaleSnapshot);
      job = {
        ...job,
        status: "queued",
        payload: {
          ...job.payload,
          generation_revision: 5,
          line_same_build_reoffer_count: 1,
          line_handle: { batchId: "line_client", rowId: "line_client:0" },
          line_build_hash: HERO_BUILD_HASH,
        },
        result: {},
      };
      return { ok: true, queued: true, retried: true, job_id: "hrj_client", generation_revision: 5 };
    },
    dispatchMirrorLane: async () => {
      mirrorDispatches += 1;
      throw new Error("must not redispatch recovered Mirror");
    },
  };

  const poll = () => mirrorProspectResumable(structuredClone(row), options);
  const concurrent = await Promise.all([poll(), poll()]);

  assert.equal(refreshCasAttempts, 2);
  assert.equal(refreshCasWins, 1);
  assert.equal(queueResets, 1);
  assert.equal(mirrorDispatches, 0);
  assert.equal(persisted.record.hero_photo_refresh.reason, "refreshed");
  for (const out of concurrent) {
    assert.equal(out.heroRemasterPending, true, JSON.stringify(out));
    assert.equal(out.revealable, true);
    assert.equal(out.previewUrl, PREVIEW);
    assert.equal(out.buildHash, HERO_BUILD_HASH);
  }

  const secondPoll = await mirrorProspectResumable({
    ...structuredClone(row),
    durableUpdatedAt: persisted.updated_at,
  }, options);
  assert.equal(secondPoll.heroRemasterPending, true, JSON.stringify(secondPoll));
  assert.equal(secondPoll.previewUrl, PREVIEW);
  assert.equal(secondPoll.buildHash, HERO_BUILD_HASH);
  assert.equal(refreshCasAttempts, 2);
  assert.equal(refreshCasWins, 1);
  assert.equal(queueResets, 1);
  assert.equal(mirrorDispatches, 0);
  assert.equal(job.payload.generation_revision, 5);
  assert.equal(job.payload.line_same_build_reoffer_count, 1);
  assert.deepEqual(job.payload.line_handle, { batchId: "line_client", rowId: "line_client:0" });
  assert.equal(job.payload.line_build_hash, HERO_BUILD_HASH);
});

test("a refresh retry reason is visible on the durable Line row", async () => {
  const out = await processRowPhase(qualifiedRow(), { batchId: "line_client" }, {
    mirror: async () => ({
      ok: true,
      revealable: true,
      previewUrl: PREVIEW,
      buildHash: HERO_BUILD_HASH,
      buildEvidence: { build_hash: HERO_BUILD_HASH },
      releaseEvidence: { build_hash: HERO_BUILD_HASH, evidence_sha: "a".repeat(64) },
      heroRemasterPending: true,
      heroRemaster: {
        required: true,
        pending: true,
        ready: false,
        job_id: "hrj_refresh_retry",
        hero_attempt_id: "hero_attempt:2",
        reason: "hero_photo_refresh_cas_pending",
      },
    }),
    now: () => NOW,
  });
  assert.equal(out.row.reason, "hero_photo_refresh_cas_pending");
  assert.equal(out.row.lastRetryableError, "hero_photo_refresh_cas_pending");
  assert.equal(out.row.previewUrl, PREVIEW);
  assert.equal(out.row.buildHash, HERO_BUILD_HASH);
  assert.equal(out.row.status, "qualified");
});

test("a pending post-build hero keeps the Mirror checkpoint for the next poll", async () => {
  const out = await processRowPhase(qualifiedRow(), { batchId: "line_client" }, {
    mirror: async () => ({
      ok: true,
      previewUrl: PREVIEW,
      buildHash: HERO_BUILD_HASH,
      currentWebsite: SOURCE,
      releaseEvidence: { build_hash: HERO_BUILD_HASH },
    }),
    prepareHero: async () => ({
      ok: true,
      heroRemaster: { required: true, pending: true, ready: false, job_id: "hrj_client" },
      rowPatch: { durableUpdatedAt: NOW },
    }),
    now: () => NOW,
  });

  assert.equal(out.row.status, "qualified");
  assert.equal(out.row.buildHash, HERO_BUILD_HASH);
  assert.equal(out.row.previewUrl, PREVIEW);
  assert.equal(out.row.heroRemaster.pending, true);
});

test("a three-minute Seedance join cannot delay the base mirror", async () => {
  const persisted = durable(ownedBank());
  persisted.record.truth_packet_source = "leadminer_mirror_ready";
  persisted.record.truth_packet = {
    source: "leadminer_mirror_ready",
    mirror_ready: { business_name: persisted.business_name },
  };
  let releaseJoin;
  const slowJoin = new Promise((resolve) => { releaseJoin = resolve; });
  let mirrorStarted = false;
  const base = heroBuildOutput("8".repeat(64));

  const running = mirrorProspect({ ...qualifiedRow(), needs_fill: true }, {
    lane: "sandbox",
    env: {},
    select: async () => ({ ok: true, data: [persisted] }),
    mirrorLaneEnabled: () => true,
    enqueueHeroRemasterForBuild: async () => ({ ok: true, queued: true, job_id: "hrj_slow_seedance" }),
    getHeroReelJobForProspect: async () => slowJoin,
    dispatchMirrorLane: async () => {
      mirrorStarted = true;
      return { ...base, urls: { preview_url: PREVIEW }, build_hash: base.buildHash };
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const overlapped = mirrorStarted;
  releaseJoin({ ok: true, job: { jobId: "hrj_slow_seedance", status: "queued", result: {} } });
  await running;

  assert.equal(overlapped, true, "base Mirror must start while the long Seedance job remains pending");
});

// REPLACES "no owned photo holds the default-on Line" (2026-08-23). That test
// pinned a gate that demanded OUR harvested photo bank and held the whole build
// without one — but the hero producer never reads our bank. The Ads Station
// scans the client's own legacy site (and their socials) for its images. The old
// rule rejected roughly 8 of every 12 prospects and took the factory's yield to
// zero for a resource the lane was never going to use.
test("no owned photo still builds when the Station has a site to scan", async () => {
  let gates = 0;
  let writes = 0;
  let emails = 0;
  const out = await processRowPhase(qualifiedRow(), { batchId: "line_client" }, {
    // No ownedPhotoBank — but a real legacy URL, which is all the Station needs.
    mirror: async () => ({ ok: true, previewUrl: PREVIEW, buildHash: "stock-build", currentWebsite: SOURCE }),
    prepareHero: (row, built, options) => prepareMirroredHero(row, built, {
      ...options,
      env: {},
      // Record has no photo_bank: honest refusal expected.
      select: async () => ({ ok: true, data: [durable()] }),
    }),
    gate: async () => { gates += 1; return { pass: true }; },
    writePreviewUrl: async () => { writes += 1; return { ok: true }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });

  // The contract this test guards is narrow and deliberate: the retired gate
  // must never again reject a prospect for lacking OUR photo bank. What the
  // surrounding phase does afterwards is pinned by its own tests; over-asserting
  // here would couple this to internals this change did not touch.
  assert.notEqual(out.row.reason, "hero_owned_photo_required", "the retired gate must not fire");
  assert.notEqual(out.row.status, "rejected", "a scannable source is not grounds for rejection");
  assert.equal(emails, 0, "and nothing may be emailed while the hero is still unresolved");
});

test("no owned photo AND nothing to scan ships on the donor rung — it never holds", async () => {
  // The genuinely sourceless case. A missing couture hero is a missing garnish,
  // not a broken build: the mirror ships on the donor's fallback clip and the
  // reason is recorded, rather than the whole site being held hostage.
  const out = await prepareMirroredHero(
    { prospectId: "p-no-source" },
    { previewUrl: PREVIEW, buildHash: "stock-build" }, // no bank, no currentWebsite
    { env: {} },
  );

  assert.equal(out.ok, true, "a sourceless prospect must not fail the build");
  assert.equal(out.hold, false, "it must not hold");
  assert.equal(out.required, false);
  assert.equal(out.fallback, true, "it ships on the donor fallback rung");
  assert.equal(out.heroRemaster.reason, "no_scannable_hero_source", "and it says why");
});

test("a durable no-source fallback survives mirror, render proof, and owner email queue", async () => {
  const order = [];
  const deps = {
    env: {},
    mirror: async () => ({ ok: true, previewUrl: PREVIEW, buildHash: "fallback-build", currentWebsite: "" }),
    prepareHero: (row, built, options) => prepareMirroredHero(row, built, {
      ...options,
      env: {},
      select: async () => ({ ok: true, data: [] }),
    }),
    sourceFacts: async () => ({}),
    gate: async () => ({
      pass: true,
      failed: [],
      checks: [],
      capture: {
        ok: true,
        shots: {
          build_hash: "fallback-build",
          old_captured_url: SOURCE,
          old_shot_sha: "c".repeat(64),
          new_captured_url: PREVIEW,
          new_shot_sha: "d".repeat(64),
        },
        results: [],
      },
    }),
    writePreviewUrl: async () => { order.push("write"); return { ok: true }; },
    queueEmail: async () => { order.push("email"); return { ok: true }; },
    now: () => NOW,
  };
  let row = { ...qualifiedRow(), currentWebsite: "" };
  let phase = await processRowPhase(row, { batchId: "line_fallback", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "mirrored");
  assert.deepEqual(phase.row.heroRemaster, {
    required: false,
    ready: true,
    pending: false,
    hold: false,
    fallback: true,
    applied: false,
    status: "skipped",
    jobId: "",
    rebuildStatus: "",
    rebuildJobId: "",
    buildHash: "fallback-build",
    reelUrl: "",
    reason: "no_scannable_hero_source",
  });
  phase = await processRowPhase(phase.row, { batchId: "line_fallback", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "gate_passed");
  phase = await processRowPhase(phase.row, { batchId: "line_fallback", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "queued");
  assert.deepEqual(order, ["write", "email"]);
});

test("no owned photo + GBP photos on record auto-queues the hero job (pending)", async () => {
  const PLACE_ID = "ChIJplaceid1234";
  const GBP_PHOTO_SHA = "c".repeat(64);
  const gbpBank = {
    version: 1,
    harvested_at: new Date().toISOString(),
    website: SOURCE,
    place_id: PLACE_ID,
    photos: [{
      url: "https://lh3.googleusercontent.com/places/crew.jpg",
      source: "gbp",
      found_on: `https://maps.google.com/maps/place/?q=place_id:${PLACE_ID}`,
      sha256: GBP_PHOTO_SHA,
      place_id: PLACE_ID,
      resource_name: `places/${PLACE_ID}/photos/ATJ83xhero`,
      width: 1200,
      height: 800,
    }],
  };
  let enqueues = 0;
  const out = await prepareMirroredHero(qualifiedRow(), {
    ok: true,
    previewUrl: PREVIEW,
    buildHash: "stock-build",
    currentWebsite: SOURCE,
    // Deliberately NO ownedPhotoBank — builder found no own-site photos.
  }, {
    env: {},
    select: async () => ({ ok: true, data: [durable(gbpBank)] }),
    enqueueHeroRemasterForBuild: async () => {
      enqueues += 1;
      return { ok: true, queued: true, job_id: "hrj_gbp" };
    },
    getHeroReelJobForProspect: async () => ({
      ok: true,
      job: { jobId: "hrj_gbp", status: "queued", result: {} },
    }),
  });

  assert.equal(enqueues, 1, "exactly one hero job must be enqueued");
  assert.equal(out.ok, true);
  assert.equal(out.heroRemaster.pending, true);
});

test("a hero enqueue store outage stays required and retries without terminal rejection", async () => {
  let mirrors = 0;
  let enqueues = 0;
  let heroReads = 0;
  let gates = 0;
  let writes = 0;
  let emails = 0;
  const deps = {
    env: {},
    mirror: async () => {
      mirrors += 1;
      return {
        ok: true,
        previewUrl: PREVIEW,
        buildHash: "stock-build",
        currentWebsite: SOURCE,
      };
    },
    prepareHero: (row, built, options) => prepareMirroredHero(row, built, {
      ...options,
      env: {},
      select: async () => ({ ok: true, data: [durable()] }),
      enqueueHeroRemasterForBuild: async () => {
        enqueues += 1;
        if (enqueues === 1) {
          return { ok: false, queued: false, reason: "hero_store_write_uncertain" };
        }
        return { ok: true, queued: true, job_id: "hrj_store_retry" };
      },
      getHeroReelJobForProspect: async () => {
        heroReads += 1;
        return {
          ok: true,
          job: { jobId: "hrj_store_retry", status: "queued", result: {} },
        };
      },
    }),
    gate: async () => { gates += 1; return { pass: true }; },
    writePreviewUrl: async () => { writes += 1; return { ok: true }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  };

  let phase = await processRowPhase(
    qualifiedRow(),
    { batchId: "line_store_retry", lane: "sandbox" },
    deps,
  );
  assert.equal(phase.ok, true, JSON.stringify(phase));
  assert.equal(phase.complete, true);
  assert.equal(phase.phase, "hero_remaster");
  assert.equal(phase.row.status, "qualified");
  assert.equal(phase.row.heroRemaster.required, true);
  assert.equal(phase.row.heroRemaster.ready, false);
  assert.equal(phase.row.heroRemaster.pending, true);
  assert.equal(phase.row.heroRemaster.hold, false);
  assert.equal(phase.row.heroRemaster.fallback, false);
  assert.equal(phase.row.heroRemaster.reason, "hero_store_write_uncertain");
  assert.ok(phase.row.buildRetryAfter, "the uncertain store write must schedule a retry");
  assert.equal(mirrors, 1);
  assert.equal(enqueues, 1);
  assert.equal(heroReads, 0, "a failed enqueue has no durable job to read yet");

  phase = await processRowPhase(
    phase.row,
    { batchId: "line_store_retry", lane: "sandbox" },
    deps,
  );
  assert.equal(phase.ok, true);
  assert.equal(phase.complete, true);
  assert.equal(phase.phase, "hero_remaster");
  assert.equal(phase.row.status, "qualified");
  assert.equal(phase.row.heroRemaster.required, true);
  assert.equal(phase.row.heroRemaster.ready, false);
  assert.equal(phase.row.heroRemaster.pending, true);
  assert.equal(phase.row.heroRemaster.hold, false);
  assert.equal(phase.row.heroRemaster.fallback, false);
  assert.equal(phase.row.heroRemaster.jobId, "hrj_store_retry");
  assert.equal(mirrors, 2, "the qualified row must retry its mirror/hero join");
  assert.equal(enqueues, 2, "the failed durable enqueue must be retried");
  assert.equal(heroReads, 1);
  assert.equal(gates, 0);
  assert.equal(writes, 0);
  assert.equal(emails, 0);
});

test("the hero kill switch restores the prior Line gate and queue behavior", async () => {
  const order = [];
  const deps = {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    mirror: async () => ({
      ok: true,
      previewUrl: PREVIEW,
      buildHash: "stock-build",
      currentWebsite: SOURCE,
      ownedPhotoBank: ownedBank(),
    }),
    prepareHero: (row, built, options) => prepareMirroredHero(row, built, options),
    sourceFacts: async () => ({}),
    gate: async () => {
      order.push("gate");
      return {
        pass: true,
        failed: [],
        checks: [],
        capture: {
          ok: true,
          shots: {
            build_hash: "stock-build",
            old_captured_url: SOURCE,
            old_shot_sha: "c".repeat(64),
            new_captured_url: PREVIEW,
            new_shot_sha: "d".repeat(64),
          },
          results: [],
        },
      };
    },
    writePreviewUrl: async () => { order.push("write"); return { ok: true }; },
    queueEmail: async () => { order.push("email"); return { ok: true }; },
    now: () => NOW,
  };

  let out = await processRowPhase(qualifiedRow(), { batchId: "line_client" }, deps);
  assert.equal(out.row.status, "mirrored");
  assert.equal(out.row.heroRemaster, undefined);
  out = await processRowPhase(out.row, { batchId: "line_client" }, deps);
  assert.equal(out.row.status, "gate_passed");
  out = await processRowPhase(out.row, { batchId: "line_client" }, deps);
  assert.equal(out.row.status, "queued");
  assert.deepEqual(order, ["gate", "write", "email"]);
});

test("a resumed mirrored row with no hero marker fails before render", async () => {
  let gates = 0;
  let emails = 0;
  const row = {
    ...qualifiedRow(),
    status: "mirrored",
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
  };
  const out = await processRowPhase(row, { batchId: "line_client" }, {
    gate: async () => { gates += 1; return { pass: true }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });

  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(gates, 0);
  assert.equal(emails, 0);
});

test("a resumed mirrored row with a pending hero marker fails before render", async () => {
  let gates = 0;
  const row = {
    ...qualifiedRow(),
    status: "mirrored",
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    heroRemaster: {
      required: true,
      applied: false,
      ready: false,
      pending: true,
      buildHash: HERO_BUILD_HASH,
    },
  };
  const out = await processRowPhase(row, { batchId: "line_client" }, {
    gate: async () => { gates += 1; return { pass: true }; },
    now: () => NOW,
  });

  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(gates, 0);
});

test("a verified hero rebuild releases the normal fresh gate and only then queues email", async () => {
  const order = [];
  const applied = {
    required: true,
    ready: true,
    applied: true,
    status: "done",
    job_id: "hrj_client",
    rebuild_status: "done",
    rebuild_job_id: "rebuild_client",
    build_hash: "hero-build-final",
    reel_url: "https://assets.wss-ai.com/client/hero.mp4",
  };
  const deps = {
    mirror: async () => {
      order.push("mirror_final_hero");
      return { ok: true, previewUrl: PREVIEW, buildHash: "hero-build-final", ownedPhotoBank: ownedBank() };
    },
    prepareHero: async () => {
      order.push("hero_verified");
      return { ok: true, heroRemaster: applied, rowPatch: { heroRemaster: applied } };
    },
    sourceFacts: async () => ({}),
    gate: async () => {
      order.push("fresh_gate_and_proof");
      return {
        pass: true,
        failed: [],
        checks: [],
        capture: {
          ok: true,
          shots: {
            build_hash: "hero-build-final",
            old_captured_url: SOURCE,
            old_shot_sha: "c".repeat(64),
            new_captured_url: PREVIEW,
            new_shot_sha: "d".repeat(64),
          },
          results: [],
        },
      };
    },
    writePreviewUrl: async (row) => {
      order.push("persist_final_proof");
      assert.equal(row.buildHash, "hero-build-final");
      assert.equal(row.proof_shots.new_captured_url, PREVIEW);
      return { ok: true, heroRemaster: applied, rowPatch: { heroRemaster: applied } };
    },
    queueEmail: async (row) => {
      order.push("queue_email");
      assert.equal(row.proof_shots.new_captured_url, PREVIEW);
      return { ok: true };
    },
    now: () => NOW,
  };

  let out = await processRowPhase(qualifiedRow(), { batchId: "line_hero" }, deps);
  assert.equal(out.row.status, "mirrored");
  out = await processRowPhase(out.row, { batchId: "line_hero" }, deps);
  assert.equal(out.row.status, "gate_passed");
  out = await processRowPhase(out.row, { batchId: "line_hero" }, deps);
  assert.equal(out.row.status, "queued");
  assert.deepEqual(order, [
    "mirror_final_hero",
    "hero_verified",
    "fresh_gate_and_proof",
    "persist_final_proof",
    "queue_email",
  ]);
});

test("verified provider failure is a visible hold and never falls through to stock email", async () => {
  let emails = 0;
  const out = await processRowPhase(qualifiedRow(), { batchId: "line_hero" }, {
    mirror: async () => ({
      ok: false,
      heroRemasterHold: true,
      reason: "hero_remaster_failed",
      heroRemaster: { required: true, hold: true, status: "failed", reason: "hero_remaster_failed" },
    }),
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });
  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "hero_remaster_failed");
  assert.equal(emails, 0);
});

test("done hero plus identity-matched successful rebuild is the only applied verdict", async () => {
  const record = {
    ...durable(ownedBank()).record,
    media_bank: { hero_reel: { url: REEL_URL } },
  };
  record.line_hero_rebuild = exactHeroMarker(record);
  const out = await enqueueCompletedLineHero({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
  }, { ...durable(), preview_url: PREVIEW, record }, record, {
    enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: {
      jobId: "hrj_client",
      status: "done",
      payload: { line_handle: { batchId: "line_client", rowId: "line_client:0" } },
      result: { url: REEL_URL, upload_receipt: { rebuild: { job_id: "rebuild_client" } } },
    } }),
    getRebuildJob: async () => ({ ok: true, job: {
      status: "done",
      updatedAt: NOW,
      result: {
        ok: true,
        preview_url: PREVIEW,
        build_hash: HERO_BUILD_HASH,
        proof_shots_ready: true,
        proof_build_hash: HERO_BUILD_HASH,
        line_artifact_ready: true,
      },
    } }),
  });
  assert.equal(out.applied, true);
  assert.equal(out.build_hash, HERO_BUILD_HASH);
});

test("exact shared release completion applies, clears the shared Line gate, and never reads legacy rebuild", async () => {
  let fixture = sharedCompletionFixture();
  let rebuildReads = 0;
  let mirrorDispatches = 0;
  let durableRow = fixture.current;
  durableRow.record.truth_packet_source = "leadminer_mirror_ready";
  durableRow.record.truth_packet = {
    source: "leadminer_mirror_ready",
    mirror_ready: { business_name: durableRow.business_name },
  };
  const resumedBuild = await mirrorProspect({
    ...qualifiedRow(),
    needs_fill: true,
    heroRemaster: { required: true, ready: true, applied: true, jobId: "hrj_client", buildHash: HERO_BUILD_HASH, reelUrl: REEL_URL },
  }, {
    lane: "sandbox",
    env: {},
    select: async () => ({ ok: true, data: [structuredClone(durableRow)] }),
    mirrorLaneEnabled: () => true,
    enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(fixture.job) }),
    getRebuildJob: async () => { rebuildReads += 1; return { ok: false }; },
    dispatchMirrorLane: async () => {
      mirrorDispatches += 1;
      throw new Error("verified shared completion must reconnect, not publish again");
    },
  });
  assert.equal(resumedBuild.ok, true, JSON.stringify(resumedBuild));
  assert.equal(resumedBuild.recovery, "persisted_signed_shared_hero");
  assert.equal(resumedBuild.buildHash, HERO_BUILD_HASH);
  assert.equal(mirrorDispatches, 0);
  assert.equal(rebuildReads, 0);

  const noBankFixture = sharedCompletionFixture();
  delete noBankFixture.current.record.photo_bank;
  noBankFixture.current.record.truth_packet_source = "leadminer_mirror_ready";
  noBankFixture.current.record.truth_packet = {
    source: "leadminer_mirror_ready",
    mirror_ready: { business_name: noBankFixture.current.business_name },
  };
  let noBankDispatches = 0;
  const noBankRow = {
    ...qualifiedRow(),
    needs_fill: true,
    heroRemaster: { required: true, ready: true, applied: true, jobId: "hrj_client", buildHash: HERO_BUILD_HASH, reelUrl: REEL_URL },
  };
  const noBankBuild = await mirrorProspect(noBankRow, {
    lane: "sandbox",
    env: {},
    select: async () => ({ ok: true, data: [structuredClone(noBankFixture.current)] }),
    mirrorLaneEnabled: () => true,
    enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(noBankFixture.job) }),
    getRebuildJob: async () => { rebuildReads += 1; return { ok: false }; },
    dispatchMirrorLane: async () => { noBankDispatches += 1; return null; },
  });
  assert.equal(noBankBuild.ok, true, JSON.stringify(noBankBuild));
  assert.equal(noBankBuild.recovery, "persisted_signed_shared_hero");
  assert.equal(noBankDispatches, 0, "a scannable source with no stored bank still reconnects the exact shared release");
  let noBankDurable = noBankFixture.current;
  let recoveryEnqueues = 0;
  let recoveryDownloads = 0;
  const noBankPrepared = await prepareMirroredHero(noBankRow, noBankBuild, {
    batchId: "line_client",
    env: {},
    select: async () => ({ ok: true, data: [structuredClone(noBankDurable)] }),
    conditionalUpdate: async (_table, _column, _id, _guards, patch) => {
      noBankDurable = { ...noBankDurable, ...structuredClone(patch) };
      return { ok: true, updated: true, rows: [structuredClone(noBankDurable)] };
    },
    enqueueHeroRemasterForBuild: async () => { recoveryEnqueues += 1; return { ok: true, reused: true, job_id: "hrj_client" }; },
    downloadPublicImage: async () => { recoveryDownloads += 1; return Buffer.alloc(0); },
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(noBankFixture.job) }),
    getRebuildJob: async () => { rebuildReads += 1; return { ok: false }; },
  });
  assert.equal(noBankPrepared.heroRemaster.applied, true, JSON.stringify(noBankPrepared));
  assert.equal(recoveryEnqueues, 0);
  assert.equal(recoveryDownloads, 0);
  assert.equal(noBankDurable.record.hero_reel_applied.shared_release_id, SHARED_RELEASE_ID);
  const prepare = (row, built, options) => prepareMirroredHero(row, built, {
    ...options,
    select: async () => ({ ok: true, data: [structuredClone(durableRow)] }),
    conditionalUpdate: async (_table, _column, _id, _guards, patch) => {
      durableRow = { ...durableRow, ...structuredClone(patch) };
      return { ok: true, updated: true, rows: [structuredClone(durableRow)] };
    },
    enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: structuredClone(fixture.job) }),
    getRebuildJob: async () => { rebuildReads += 1; return { ok: false }; },
  });
  const order = [];
  const deps = {
    env: {},
    mirror: async () => resumedBuild,
    prepareHero: prepare,
    sourceFacts: async () => ({}),
    gate: async ({ build }) => {
      order.push("fresh_gate");
      assert.equal(build.buildHash, HERO_BUILD_HASH);
      return {
        pass: true,
        failed: [],
        checks: [],
        capture: {
          ok: true,
          shots: {
            build_hash: HERO_BUILD_HASH,
            old_captured_url: SOURCE,
            old_shot_sha: "c".repeat(64),
            new_captured_url: PREVIEW,
            new_shot_sha: "d".repeat(64),
          },
          results: [],
        },
      };
    },
    writePreviewUrl: async () => { order.push("write"); return { ok: true }; },
    queueEmail: async () => { order.push("email"); return { ok: true }; },
    now: () => NOW,
  };

  let phase = await processRowPhase(qualifiedRow(), { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "mirrored", JSON.stringify(phase));
  assert.equal(phase.row.heroRemaster.completionMode, "shared_release");
  assert.equal(phase.row.heroRemaster.sharedSiteId, SHARED_SITE_ID);
  assert.equal(phase.row.heroRemaster.sharedReleaseId, SHARED_RELEASE_ID);
  assert.equal(phase.row.heroRemaster.rebuildJobId, "");
  assert.equal(durableRow.record.hero_reel_applied.completion_mode, "shared_release");
  assert.equal(durableRow.record.hero_reel_applied.shared_release_id, SHARED_RELEASE_ID);
  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "gate_passed", JSON.stringify(phase));
  const gatePassedRow = structuredClone(phase.row);
  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "queued", JSON.stringify(phase));
  assert.deepEqual(order, ["fresh_gate", "write", "email"]);
  assert.equal(rebuildReads, 0, "shared completion never enters the legacy rebuild queue");

  let hostileWrites = 0;
  let hostileEmails = 0;
  const mismatchedMarker = structuredClone(gatePassedRow);
  mismatchedMarker.heroRemaster.sharedReleaseId = SHARED_PREVIOUS_RELEASE_ID;
  const refusedQueue = await processRowPhase(mismatchedMarker, {
    batchId: "line_client",
    lane: "sandbox",
  }, {
    ...deps,
    writePreviewUrl: async () => { hostileWrites += 1; return { ok: true }; },
    queueEmail: async () => { hostileEmails += 1; return { ok: true }; },
  });
  assert.equal(refusedQueue.row.status, "rejected", JSON.stringify(refusedQueue));
  assert.equal(refusedQueue.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(hostileWrites, 0, "an unrelated shared UUID tuple cannot cross the final write gate");
  assert.equal(hostileEmails, 0, "an unrelated shared UUID tuple cannot queue owner email");

  const hostile = [
    ["Line handle", (value) => { value.job.result.upload_receipt.shared_release.line_handle.rowId = "line_client:9"; }],
    ["durable job Line handle", (value) => { value.job.payload.line_handle.rowId = "line_client:9"; }],
    ["missing durable job Line handle", (value) => { delete value.job.payload.line_handle; }],
    ["proof identity", (value) => { value.job.result.upload_receipt.shared_release.proof_identity.release_id = SHARED_PREVIOUS_RELEASE_ID; }],
    ["clip SHA", (value) => { value.job.result.upload_receipt.shared_release.hero_video_sha256 = "9".repeat(64); }],
    ["reel URL", (value) => { value.job.result.url = `https://assets.wss-ai.com/client/hero-reels/approved/${"9".repeat(64)}.mp4`; }],
  ];
  for (const [name, mutate] of hostile) {
    fixture = sharedCompletionFixture();
    mutate(fixture);
    const held = await enqueueCompletedLineHero({ ...qualifiedRow(), previewUrl: PREVIEW }, fixture.current, fixture.current.record, {
      batchId: "line_client",
      enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: fixture.job }),
      getRebuildJob: async () => { rebuildReads += 1; return { ok: false }; },
    });
    if (name === "durable job Line handle") {
      assert.equal(held.pending, true, "an old batch job is deferred for the fresh row");
      assert.equal(held.reason, "hero_remaster_line_handle_mismatch");
    } else {
      assert.equal(held.hold, true, `${name} must hold`);
      assert.equal(held.reason, "hero_shared_release_identity_unproven");
    }
  }
  assert.equal(rebuildReads, 0, "tampered shared receipts never query the legacy rebuild lane");
});

test("a terminal rebuild identity mismatch holds instead of polling forever", async () => {
  const reelUrl = "https://assets.wss-ai.com/client/hero.mp4";
  const record = {
    ...durable(ownedBank()).record,
    media_bank: { hero_reel: { url: reelUrl } },
  };
  const out = await enqueueCompletedLineHero({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
  }, { ...durable(), preview_url: PREVIEW, record }, record, {
    enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: {
      jobId: "hrj_client",
      status: "done",
      result: { url: reelUrl, upload_receipt: { rebuild: { job_id: "rebuild_client" } } },
    } }),
    getRebuildJob: async () => ({ ok: true, job: {
      status: "done",
      result: { ok: true, preview_url: "https://wrong-client.wss-ai.com/", build_hash: "hero-build-final" },
    } }),
  });
  assert.equal(out.hold, true);
  assert.equal(out.pending, false);
  assert.equal(out.reason, "hero_rebuild_artifact_unproven");
});

test("the real frozen-request adapter replaces donor stock with the durable owned reel", async () => {
  const reelUrl = "https://assets.wss-ai.com/client/hero.mp4";
  let engineRequest = null;
  const prospect = {
    prospect_id: "client-hero-1",
    current_website: SOURCE,
    record: {
      current_website: SOURCE,
      media_bank: {
        hero_reel: {
          url: reelUrl,
          generator: "ads_image_to_video",
          composed_from: [PHOTO_SHA],
        },
      },
      build_ready: {
        mirror_request: {
          slug: "client-hero",
          donor: "plumbing",
          facts: { business_name: "Client Hero Plumbing", industry: "plumbing" },
          brand: { hero_video: { url: "https://stock.example.com/donor.mp4" }, photos: [] },
          content: { services: [{ name: "Drain repair" }] },
        },
      },
    },
  };
  await lineBuildMirror(prospect, {
    freezeVisualIdentity: async (_prospect, request) => ({ request, measured: false, persisted: false, reason: "already_frozen" }),
    resolveSignupConfig: () => ({}),
    runEngine: async (request) => {
      engineRequest = structuredClone(request);
      return { status: 200, body: { ok: true, revealable: true, checks: {} } };
    },
  });
  assert.equal(engineRequest.brand.hero_video.url, reelUrl);
  assert.notEqual(engineRequest.brand.hero_video.url, "https://stock.example.com/donor.mp4");
});

test("a stale gate-passed hero marker can never write or queue email", async () => {
  let writes = 0;
  let emails = 0;
  const row = {
    ...qualifiedRow(),
    status: "gate_passed",
    previewUrl: PREVIEW,
    buildHash: "stock-build",
    gate: { pass: true },
    proof_shots: {
      build_hash: "stock-build",
      old_captured_url: SOURCE,
      old_shot_sha: "c".repeat(64),
      new_captured_url: PREVIEW,
      new_shot_sha: "d".repeat(64),
    },
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      applied: false,
      buildHash: "hero-build-final",
    },
  };
  const out = await processRowPhase(row, { batchId: "line_client" }, {
    writePreviewUrl: async () => { writes += 1; return { ok: true }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });
  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(writes, 0);
  assert.equal(emails, 0);
});

test("the hero marker is rechecked immediately before email queueing", async () => {
  let emails = 0;
  const row = {
    ...qualifiedRow(),
    status: "gate_passed",
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    gate: { pass: true },
    proof_shots: {
      build_hash: HERO_BUILD_HASH,
      old_captured_url: SOURCE,
      old_shot_sha: "c".repeat(64),
      new_captured_url: PREVIEW,
      new_shot_sha: "d".repeat(64),
    },
    heroRemaster: {
      required: true,
      applied: true,
      ready: true,
      pending: false,
      status: "done",
      jobId: "hrj_client",
      rebuildStatus: "done",
      rebuildJobId: "rebuild_client",
      buildHash: HERO_BUILD_HASH,
      reelUrl: "https://assets.wss-ai.com/client/hero.mp4",
    },
  };
  const out = await processRowPhase(row, { batchId: "line_client" }, {
    writePreviewUrl: async () => ({
      ok: true,
      rowPatch: {
        heroRemaster: {
          required: true,
          applied: false,
          ready: false,
          pending: true,
          buildHash: HERO_BUILD_HASH,
        },
      },
    }),
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });

  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(out.phase, "hero_remaster");
  assert.equal(emails, 0);
});

test("an incomplete proof record does not block the queue because delivery resolves proof", async () => {
  let writes = 0;
  let emails = 0;
  const row = {
    ...qualifiedRow(),
    status: "gate_passed",
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    gate: { pass: true },
    proof_shots: { build_hash: HERO_BUILD_HASH },
    heroRemaster: {
      required: true,
      applied: true,
      ready: true,
      pending: false,
      status: "done",
      jobId: "hrj_client",
      rebuildStatus: "done",
      rebuildJobId: "rebuild_client",
      buildHash: HERO_BUILD_HASH,
      reelUrl: "https://assets.wss-ai.com/client/hero.mp4",
    },
  };
  const out = await processRowPhase(row, { batchId: "line_client" }, {
    writePreviewUrl: async () => { writes += 1; return { ok: true }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });

  assert.equal(out.row.status, "queued");
  assert.equal(writes, 1);
  assert.equal(emails, 1);
});

test("a hero marker without reel and worker receipts cannot authorize the email queue", async () => {
  let writes = 0;
  let emails = 0;
  const row = {
    ...qualifiedRow(),
    status: "gate_passed",
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    gate: { pass: true },
    proof_shots: {
      build_hash: HERO_BUILD_HASH,
      old_captured_url: SOURCE,
      old_shot_sha: "c".repeat(64),
      new_captured_url: PREVIEW,
      new_shot_sha: "d".repeat(64),
    },
    heroRemaster: {
      required: true,
      applied: true,
      ready: true,
      pending: false,
      status: "done",
      rebuildStatus: "done",
      buildHash: HERO_BUILD_HASH,
    },
  };
  const out = await processRowPhase(row, { batchId: "line_client" }, {
    writePreviewUrl: async () => { writes += 1; return { ok: true }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => NOW,
  });

  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(writes, 0);
  assert.equal(emails, 0);
});

test("successful rebuild wakes only its exact Line row; mismatch, duplicate, no handle, and switch use cron", async () => {
  assert.equal(heroQueueWakeEnabled({}), true);
  assert.equal(heroQueueWakeEnabled({ GHOST_AGENCY_HERO_QUEUE_WAKE: "0" }), false);
  const handle = { batchId: "line_client", rowId: "line_client:0" };
  assert.deepEqual(normalizeLineHandle(handle), handle);
  const messages = [];
  const waitingRow = {
    rowId: handle.rowId,
    prospectId: "client-hero-1",
    status: "qualified",
    heroRemaster: { required: true, pending: true },
  };
  const options = {
    environment: {},
    persistence: { loadBatch: async () => ({ ok: true, batch: {
      batchId: "line_client", status: "building", version: 7, rows: [waitingRow],
    } }) },
    enqueueLineMessage: async (message) => { messages.push(message); return { accepted: true }; },
  };
  const out = await wakeLineForCompletedHero("client-hero-1", handle, options);
  assert.equal(out.accepted, true);
  assert.deepEqual(messages, [{ batchId: "line_client", phase: "hero", sequence: 7, rowId: "line_client:0" }]);

  const mismatch = await wakeLineForCompletedHero("client-hero-1", { ...handle, rowId: "line_client:9" }, options);
  assert.equal(mismatch.reason, "hero_line_handle_mismatch");
  assert.equal(messages.length, 1);

  const duplicate = await wakeLineForCompletedHero("client-hero-1", handle, {
    ...options,
    persistence: { loadBatch: async () => ({ ok: true, batch: {
      batchId: "line_client", status: "building", version: 7, rows: [waitingRow, { ...waitingRow }],
    } }) },
  });
  assert.equal(duplicate.reason, "hero_line_handle_mismatch");
  assert.equal(messages.length, 1);

  const missing = await wakeLineForCompletedHero("client-hero-1", null, options);
  assert.equal(missing.reason, "hero_line_handle_required");

  const off = await wakeLineForCompletedHero("client-hero-1", handle, {
    environment: { GHOST_AGENCY_HERO_QUEUE_WAKE: "0" },
    persistence: { loadBatch: async () => { throw new Error("not called"); } },
  });
  assert.equal(off.recovery, "cron");
});

function rebuildProofHarness(capture) {
  let job = null;
  let prospect = {
    ...durable(ownedBank()),
    status: "held",
    email: "kept@example.com",
    record: {
      ...durable(ownedBank()).record,
      media_bank: { hero_reel: { url: REEL_URL } },
      send_marker: "kept",
    },
  };
  const wakes = [];
  const captures = [];
  const select = async (table, query = "") => {
    if (table === "ghost_agency_rebuild_jobs") return { ok: true, data: job ? [structuredClone(job)] : [] };
    if (table === "ghost_agency_prospects") return { ok: true, data: [structuredClone(prospect)] };
    return { ok: true, data: [] };
  };
  const conditionalUpdate = async (table, _column, id, guards, patch) => {
    if (table === "ghost_agency_rebuild_jobs") {
      if (!job || job.job_id !== id) return { ok: true, updated: false, rows: [] };
      if (guards.status && job.status !== String(guards.status).replace(/^eq\./, "")) return { ok: true, updated: false, rows: [] };
      if (guards["result->>claim"]
        && String(job.result?.claim || "") !== String(guards["result->>claim"]).replace(/^eq\./, "")) {
        return { ok: true, updated: false, rows: [] };
      }
      job = { ...job, ...structuredClone(patch) };
      return { ok: true, updated: true, rows: [structuredClone(job)] };
    }
    if (table === "ghost_agency_prospects") {
      if (prospect.prospect_id !== id
        || String(guards.updated_at).replace(/^eq\./, "") !== prospect.updated_at) {
        return { ok: true, updated: false, rows: [] };
      }
      prospect = { ...prospect, ...structuredClone(patch) };
      return { ok: true, updated: true, rows: [structuredClone(prospect)] };
    }
    return { ok: false };
  };
  const jobs = createRebuildJobs({
    now: () => new Date(NOW),
    newJobId: () => "rebuild_client",
    insertRow: async (_table, row) => {
      job = structuredClone(row);
      return { ok: true, mode: "live_write", data: [structuredClone(row)] };
    },
    select,
    conditionalUpdate,
    recordEvent: async () => ({ ok: true }),
    captureLineEmailAssets: async (input) => {
      captures.push(input);
      return structuredClone(capture);
    },
    wakeLineForCompletedHero: async (prospectId, lineHandle) => {
      wakes.push({ prospectId, lineHandle });
      return { accepted: true };
    },
  });
  return {
    jobs,
    select,
    conditionalUpdate,
    captures,
    wakes,
    job: () => job,
    prospect: () => prospect,
  };
}

test("successful hero rebuild persists fresh proof only and exposes proof readiness", async () => {
  const proof = {
    ok: true,
    shots: {
      build_hash: HERO_BUILD_HASH,
      old_captured_url: "https://proof.example.com/old.webp",
      old_shot_sha: "c".repeat(64),
      new_captured_url: "https://proof.example.com/new.webp",
      new_shot_sha: "d".repeat(64),
    },
    results: [],
  };
  const h = rebuildProofHarness(proof);
  const lineHandle = { batchId: "line_client", rowId: "line_client:0" };
  const enqueued = await h.jobs.enqueueRebuildJob({
    prospectId: "client-hero-1",
    actor: "hero_clip_upload",
    lineHandle,
    heroJobId: "hrj_client",
    heroClipSha256: HERO_CLIP_SHA,
  });
  const out = await h.jobs.runRebuildJob(enqueued.jobId, {
    select: h.select,
    mirrorProspect: async (_row, options) => {
      assert.equal(options.heroRebuild, true);
      return heroBuildOutput();
    },
  });
  assert.equal(out.verdict.proof_shots_ready, true);
  assert.equal(out.verdict.proof_build_hash, HERO_BUILD_HASH);
  assert.equal(out.verdict.proof_reason, "");
  assert.equal(out.verdict.line_artifact_ready, true);
  assert.equal(h.captures[0].motion, false);
  assert.equal(h.prospect().record.proof_shots.build_hash, HERO_BUILD_HASH);
  assert.equal(h.prospect().record.line_hero_rebuild.schema, "line_hero_rebuild/v1");
  assert.equal(h.prospect().record.send_marker, "kept");
  assert.equal(h.prospect().status, "held");
  assert.equal(h.prospect().email, "kept@example.com");
  assert.deepEqual(h.wakes, [{ prospectId: "client-hero-1", lineHandle }]);

  const shown = publicVerdict({
    jobId: enqueued.jobId,
    prospectId: "client-hero-1",
    status: "done",
    result: out.verdict,
  });
  assert.equal(shown.proof_shots_ready, true);
  assert.equal(shown.proof_build_hash, HERO_BUILD_HASH);
  assert.equal(shown.proof_reason, "");
});

test("the rebuild artifact wakes the exact row, gates fresh, and never mirrors twice", async () => {
  const proof = {
    ok: true,
    shots: {
      build_hash: HERO_BUILD_HASH,
      old_captured_url: "https://proof.example.com/old.webp",
      old_shot_sha: "c".repeat(64),
      new_captured_url: "https://proof.example.com/new.webp",
      new_shot_sha: "d".repeat(64),
    },
    results: [],
  };
  const h = rebuildProofHarness(proof);
  const lineHandle = { batchId: "line_client", rowId: "line_client:0" };
  let mirrorBuilders = 0;
  const enqueued = await h.jobs.enqueueRebuildJob({
    prospectId: "client-hero-1",
    actor: "hero_clip_upload",
    lineHandle,
    heroJobId: "hrj_client",
    heroClipSha256: HERO_CLIP_SHA,
  });
  const rebuilt = await h.jobs.runRebuildJob(enqueued.jobId, {
    select: h.select,
    mirrorProspect: async () => {
      mirrorBuilders += 1;
      return heroBuildOutput();
    },
  });
  assert.equal(rebuilt.verdict.line_artifact_ready, true);

  const heroJob = {
    jobId: "hrj_client",
    status: "done",
    payload: { line_handle: lineHandle },
    result: {
      url: REEL_URL,
      upload_receipt: { rebuild: { job_id: enqueued.jobId, line_handle: lineHandle } },
    },
  };
  const phaseDeps = {
    mirror: (row, options) => mirrorProspectResumable(row, {
      ...options,
      select: h.select,
      dispatchMirrorLane: async () => {
        mirrorBuilders += 1;
        throw new Error("a recovered hero rebuild must not dispatch again");
      },
    }),
    prepareHero: (row, built, options) => prepareMirroredHero(row, built, {
      ...options,
      select: h.select,
      conditionalUpdate: h.conditionalUpdate,
      enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
      getHeroReelJobForProspect: async () => ({ ok: true, job: heroJob }),
      getRebuildJob: (id) => h.jobs.getRebuildJob(id),
    }),
    sourceFacts: async (_row, options) => {
      assert.equal(options.photoAccounting.placed, 1);
      return {};
    },
    gate: async () => ({ pass: true, failed: [], checks: [], capture: proof }),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
    now: () => NOW,
  };
  let row = {
    ...qualifiedRow(),
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
    },
  };
  let phase = await processRowPhase(row, { batchId: "line_client", lane: "live" }, phaseDeps);
  assert.equal(phase.row.status, "mirrored");
  assert.equal(phase.row.heroRemaster.applied, true);
  assert.equal(phase.row.buildHash, HERO_BUILD_HASH);
  assert.equal(phase.row.publishedAggregate.reviews, 221);
  assert.equal(mirrorBuilders, 1, "the durable rebuild is the only Mirror build");

  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "live" }, phaseDeps);
  assert.equal(phase.row.status, "gate_passed");
  phase = await processRowPhase(phase.row, { batchId: "line_client", lane: "live" }, phaseDeps);
  assert.equal(phase.row.status, "queued");
  assert.equal(mirrorBuilders, 1);
});

test("rebuild proof identity mismatch records nothing and remains visibly incomplete", async () => {
  const h = rebuildProofHarness({
    ok: true,
    shots: {
      build_hash: "hero-build-final",
      new_captured_url: "https://proof.example.com/new.webp",
      new_shot_sha: "d".repeat(64),
    },
    results: [{ variant: "old", ok: false, reason: "capture_identity_domain_mismatch" }],
  });
  const before = structuredClone(h.prospect().record);
  const enqueued = await h.jobs.enqueueRebuildJob({ prospectId: "client-hero-1" });
  const out = await h.jobs.runRebuildJob(enqueued.jobId, {
    select: h.select,
    mirrorProspect: async () => ({ ok: true, previewUrl: PREVIEW, buildHash: "hero-build-final" }),
  });
  assert.equal(out.verdict.ok, true, "the mirror built; proof readiness is a separate fail-closed fact");
  assert.equal(out.verdict.proof_shots_ready, false);
  assert.equal(out.verdict.proof_reason, "capture_identity_domain_mismatch");
  assert.deepEqual(h.prospect().record, before, "identity mismatch writes no proof or send fields");
});

test("a Line proof mismatch writes no marker, wakes nobody, and becomes a terminal hero hold", async () => {
  const h = rebuildProofHarness({
    ok: false,
    reason: "capture_identity_domain_mismatch",
    shots: {},
    results: [{ variant: "old", ok: false, reason: "capture_identity_domain_mismatch" }],
  });
  const lineHandle = { batchId: "line_client", rowId: "line_client:0" };
  const enqueued = await h.jobs.enqueueRebuildJob({
    prospectId: "client-hero-1",
    actor: "hero_clip_upload",
    lineHandle,
    heroJobId: "hrj_client",
    heroClipSha256: HERO_CLIP_SHA,
  });
  const rebuilt = await h.jobs.runRebuildJob(enqueued.jobId, {
    select: h.select,
    mirrorProspect: async () => heroBuildOutput(),
  });
  assert.equal(rebuilt.verdict.ok, false);
  assert.equal(rebuilt.verdict.proof_reason, "capture_identity_domain_mismatch");
  assert.equal(rebuilt.verdict.line_artifact_ready, false);
  assert.equal(h.prospect().record.line_hero_rebuild, undefined);
  assert.deepEqual(h.wakes, []);

  const current = h.prospect();
  const held = await enqueueCompletedLineHero({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
  }, current, current.record, {
    batchId: "line_client",
    enqueueHeroRemasterForBuild: async () => ({ ok: true, reused: true, job_id: "hrj_client" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: {
      jobId: "hrj_client",
      status: "done",
      result: { url: REEL_URL, upload_receipt: { rebuild: { job_id: enqueued.jobId } } },
    } }),
    getRebuildJob: (id) => h.jobs.getRebuildJob(id),
  });
  assert.equal(held.hold, true);
  assert.equal(held.pending, undefined);
  assert.equal(held.reason, "capture_identity_domain_mismatch");
});

test("a definitive hero-enqueue provenance refusal ships the build on the donor rung", async () => {
  // The durable queue's owner-decreed narrow bypass refuses a declared bank
  // that fails verification (no_verified_owned_photo / photo_bank_stale_or_
  // missing) no matter how many times the Line retries. That refusal must
  // become a fallback ship, not an eternal pending loop over a finished site.
  const result = await prepareMirroredHero(qualifiedRow(), {
    ok: true,
    previewUrl: PREVIEW,
    currentWebsite: SOURCE,
    ownedPhotoBank: ownedBank(),
  }, {
    select: async () => ({ ok: true, data: [durable()] }),
    downloadPublicImage: async () => {
      const b = Buffer.alloc(64);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
      b.writeUInt32BE(1600, 16); b.writeUInt32BE(900, 20);
      return b;
    },
    conditionalUpdate: async (_t, _c, _i, _g, patch) => ({ ok: true, updated: true, rows: [{ ...durable(), ...patch }] }),
    enqueueHeroRemasterForBuild: async () => ({ ok: false, queued: false, reason: "no_verified_owned_photo" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.required, false);
  assert.equal(result.ready, true);
  assert.equal(result.fallback, true);
  assert.notEqual(result.pending, true);
  assert.notEqual(result.hold, true);
  assert.equal(result.heroRemaster.status, "skipped");
  assert.equal(result.heroRemaster.reason, "no_verified_owned_photo");
});

test("a stale declared bank refusal also falls back instead of pending forever", async () => {
  const result = await prepareMirroredHero(qualifiedRow(), {
    ok: true,
    previewUrl: PREVIEW,
    currentWebsite: SOURCE,
    ownedPhotoBank: ownedBank(),
  }, {
    select: async () => ({ ok: true, data: [durable()] }),
    downloadPublicImage: async () => {
      const b = Buffer.alloc(64);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
      b.writeUInt32BE(1600, 16); b.writeUInt32BE(900, 20);
      return b;
    },
    conditionalUpdate: async (_t, _c, _i, _g, patch) => ({ ok: true, updated: true, rows: [{ ...durable(), ...patch }] }),
    enqueueHeroRemasterForBuild: async () => ({ ok: false, queued: false, reason: "photo_bank_stale_or_missing" }),
  });

  assert.equal(result.required, false);
  assert.equal(result.ready, true);
  assert.equal(result.fallback, true);
  assert.notEqual(result.pending, true);
});

test("a disabled automatic producer is a definitive skip that ships on the donor rung", async () => {
  const result = await prepareMirroredHero(qualifiedRow(), {
    ok: true,
    previewUrl: PREVIEW,
    currentWebsite: SOURCE,
    ownedPhotoBank: ownedBank(),
  }, {
    select: async () => ({ ok: true, data: [durable()] }),
    downloadPublicImage: async () => {
      const b = Buffer.alloc(64);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
      b.writeUInt32BE(1600, 16); b.writeUInt32BE(900, 20);
      return b;
    },
    conditionalUpdate: async (_t, _c, _i, _g, patch) => ({ ok: true, updated: true, rows: [{ ...durable(), ...patch }] }),
    enqueueHeroRemasterForBuild: async () => ({ ok: false, error: "producer_not_enabled", allowed: [] }),
  });

  assert.equal(result.required, false);
  assert.equal(result.ready, true);
  assert.equal(result.fallback, true);
  assert.equal(result.heroRemaster.reason, "producer_not_enabled");
});

test("a transient enqueue outage still pends the row for retry", async () => {
  const result = await prepareMirroredHero(qualifiedRow(), {
    ok: true,
    previewUrl: PREVIEW,
    currentWebsite: SOURCE,
    ownedPhotoBank: ownedBank(),
  }, {
    select: async () => ({ ok: true, data: [durable()] }),
    downloadPublicImage: async () => {
      const b = Buffer.alloc(64);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
      b.writeUInt32BE(1600, 16); b.writeUInt32BE(900, 20);
      return b;
    },
    conditionalUpdate: async (_t, _c, _i, _g, patch) => ({ ok: true, updated: true, rows: [{ ...durable(), ...patch }] }),
    enqueueHeroRemasterForBuild: async () => ({ ok: false, queued: false, reason: "hero_remaster_enqueue_timeout" }),
  });

  assert.equal(result.required, true);
  assert.equal(result.heroRemaster.pending, true);
  assert.equal(result.heroRemaster.ready, false);
  assert.equal(result.heroRemaster.reason, "hero_remaster_enqueue_timeout");
});

test("a refused retired-Ads hero job ships the build on the donor rung at join time", async () => {
  // The durable queue reuses the prospect's terminal job on retry. Those old
  // Ads-producer refusals (no_verified_owned_real_scene) can never be worked
  // again — the Station is retired and the reoffer needs a refreshed bank.
  // Polling that dead verdict parked finished sites forever; the join must
  // resolve it as a fallback ship, not a hold.
  const out = await enqueueCompletedLineHero(qualifiedRow(), durable(), durable().record, {
    env: {},
    enqueueHeroRemasterForBuild: async () => ({ ok: true, queued: true, job_id: "hrj_dead_ads" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: {
      jobId: "hrj_dead_ads",
      status: "refused",
      producer: "ads_image_to_video",
      result: { reason: "no_verified_owned_real_scene" },
    } }),
  });

  assert.equal(out.required, false);
  assert.equal(out.ready, true);
  assert.equal(out.fallback, true);
  assert.notEqual(out.hold, true);
  assert.notEqual(out.pending, true);
  assert.equal(out.status, "skipped");
  assert.equal(out.reason, "no_verified_owned_real_scene");
});

test("a live-producer refusal still holds for operator review at join time", async () => {
  const out = await enqueueCompletedLineHero(qualifiedRow(), durable(), durable().record, {
    env: {},
    enqueueHeroRemasterForBuild: async () => ({ ok: true, queued: true, job_id: "hrj_seed" }),
    getHeroReelJobForProspect: async () => ({ ok: true, job: {
      jobId: "hrj_seed",
      status: "refused",
      producer: "openrouter_seedance",
      result: { reason: "video_content_policy" },
    } }),
  });

  assert.equal(out.required, true);
  assert.equal(out.hold, true);
  assert.equal(out.ready, false);
  assert.equal(out.reason, "video_content_policy");
});

test("a hero-pending qualified row ships on the donor rung via the join-only recheck without another mirror dispatch", async () => {
  // 2026-08-28: pending rows used to re-enter the FULL mirror pipeline per
  // ~30s poll and rebuild the site every time. The recheck answers the hero
  // question directly; a definitive refusal ships the donor rung with zero
  // dispatches.
  let mirrorCalls = 0;
  let rechecks = 0;
  const built = heroBuildOutput();
  const row = {
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    buildEvidence: built.buildEvidence,
    releaseEvidence: built.releaseEvidence,
    currentWebsite: SOURCE,
    heroRemaster: { required: true, pending: true, jobId: "hrj_client", attemptId: "attempt_1" },
  };
  const out = await processRowPhase(row, { batchId: "line_client" }, {
    mirror: async () => { mirrorCalls += 1; throw new Error("recheck must not re-dispatch the mirror"); },
    heroJoinOnly: async (passedRow, options) => {
      rechecks += 1;
      assert.equal(passedRow.prospectId, "client-hero-1");
      assert.equal(options.batchId, "line_client");
      return {
        ok: true,
        heroRemaster: { required: false, ready: true, fallback: true, status: "skipped", reason: "no_verified_owned_real_scene" },
        rowPatch: { heroRemaster: { required: false, ready: true, fallback: true, reason: "no_verified_owned_real_scene" } },
      };
    },
    gate: async () => ({ pass: true }),
    now: () => NOW,
  });

  assert.equal(rechecks, 1);
  assert.equal(mirrorCalls, 0);
  assert.equal(out.ok, true);
  assert.equal(out.row.status, "mirrored");
  assert.equal(out.row.previewUrl, PREVIEW);
  assert.equal(out.row.heroRemaster.fallback, true);
});

test("the join-only recheck keeps a still-pending hero parked without re-dispatching the mirror", async () => {
  let mirrorCalls = 0;
  const built = heroBuildOutput();
  const row = {
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    buildEvidence: built.buildEvidence,
    releaseEvidence: built.releaseEvidence,
    heroRemaster: { required: true, pending: true, jobId: "hrj_client", attemptId: "attempt_1" },
  };
  const out = await processRowPhase(row, { batchId: "line_client" }, {
    mirror: async () => { mirrorCalls += 1; throw new Error("pending recheck must not re-dispatch"); },
    heroJoinOnly: async () => ({
      heroRemasterPending: true,
      heroRemaster: { required: true, ready: false, pending: true, status: "queued", job_id: "hrj_client", hero_attempt_id: "attempt_1" },
    }),
    now: () => NOW,
  });

  assert.equal(mirrorCalls, 0);
  assert.equal(out.ok, true);
  assert.equal(out.row.status, "qualified");
  assert.equal(out.phase, "hero_remaster");
  assert.equal(out.row.heroRemaster.pending, true);
  assert.ok(out.row.buildRetryAfter, "recheck pending schedules the next poll");
});

test("a transient join-only read parks an exact signed build instead of re-dispatching Mirror", async () => {
  const built = heroBuildOutput();
  const baseRow = {
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    buildEvidence: built.buildEvidence,
    releaseEvidence: built.releaseEvidence,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      attemptId: "hero_attempt:4",
      status: "queued",
    },
  };

  for (const [name, heroJoinOnly] of [
    ["classified", async () => ({
      skipped: true,
      retryable: true,
      reason: "hero_recheck_read_unavailable",
    })],
    ["thrown", async () => { throw new Error("temporary read outage"); }],
  ]) {
    let mirrorCalls = 0;
    const out = await processRowPhase(structuredClone(baseRow), { batchId: "line_client" }, {
      heroJoinOnly,
      mirror: async () => {
        mirrorCalls += 1;
        throw new Error("transient hero read must never rebuild Mirror");
      },
      now: () => NOW,
    });

    assert.equal(mirrorCalls, 0, name);
    assert.equal(out.ok, true, name);
    assert.equal(out.phase, "hero_remaster", name);
    assert.equal(out.row.status, "qualified", name);
    assert.equal(out.row.previewUrl, PREVIEW, name);
    assert.equal(out.row.buildHash, HERO_BUILD_HASH, name);
    assert.equal(out.row.heroRemaster.pending, true, name);
    assert.equal(out.row.heroRemaster.jobId, "hrj_client", name);
    assert.equal(out.row.heroRemaster.attemptId, "hero_attempt:4", name);
    assert.equal(out.row.heroRemaster.reason, "hero_recheck_read_unavailable", name);
    assert.equal(out.row.reason, "hero_recheck_read_unavailable", name);
    assert.ok(out.row.buildRetryAfter, name);
  }

  let untrustedMirrorCalls = 0;
  await processRowPhase({
    ...structuredClone(baseRow),
    releaseEvidence: { ...built.releaseEvidence, evidence_sha: "f".repeat(64) },
  }, { batchId: "line_client" }, {
    heroJoinOnly: async () => ({
      skipped: true,
      retryable: true,
      reason: "hero_recheck_read_unavailable",
    }),
    mirror: async () => {
      untrustedMirrorCalls += 1;
      return {
        ok: true,
        heroRemasterPending: true,
        heroRemaster: {
          required: true,
          ready: false,
          pending: true,
          status: "queued",
          job_id: "hrj_client",
          hero_attempt_id: "hero_attempt:4",
        },
      };
    },
    now: () => NOW,
  });
  assert.equal(untrustedMirrorCalls, 1, "tampered release evidence cannot authorize the transient park");
});

test("only an exact signed build identity enters join-only; incomplete or foreign identity falls through unchanged", async () => {
  const exact = heroBuildOutput();
  const foreign = heroBuildOutput("d".repeat(64));
  const wrongPreviewEvidence = {
    ...structuredClone(exact.releaseEvidence),
    preview_url: "https://other-client.wss-ai.com/",
  };
  wrongPreviewEvidence.evidence_sha = signEvidence(wrongPreviewEvidence);
  const marker = {
    required: true,
    ready: false,
    pending: true,
    status: "queued",
    jobId: "hrj_client",
    attemptId: "hero_attempt:4",
  };
  const validRow = () => ({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    buildEvidence: structuredClone(exact.buildEvidence),
    releaseEvidence: structuredClone(exact.releaseEvidence),
    heroRemaster: structuredClone(marker),
  });
  const cases = [
    { name: "exact signed identity", row: validRow(), joinCalls: 1, mirrorCalls: 0 },
    {
      name: "preview only",
      row: (() => {
        const value = validRow();
        delete value.buildHash;
        delete value.buildEvidence;
        delete value.releaseEvidence;
        return value;
      })(),
      joinCalls: 0,
      mirrorCalls: 1,
    },
    {
      name: "missing build hash",
      row: (() => { const value = validRow(); delete value.buildHash; return value; })(),
      joinCalls: 0,
      mirrorCalls: 1,
    },
    {
      name: "malformed build hash",
      row: { ...validRow(), buildHash: "not-a-build-hash" },
      joinCalls: 0,
      mirrorCalls: 1,
    },
    {
      name: "missing release evidence",
      row: (() => {
        const value = validRow();
        delete value.buildEvidence;
        delete value.releaseEvidence;
        return value;
      })(),
      joinCalls: 0,
      mirrorCalls: 1,
    },
    {
      name: "tampered evidence SHA",
      row: {
        ...validRow(),
        releaseEvidence: { ...structuredClone(exact.releaseEvidence), evidence_sha: "f".repeat(64) },
      },
      joinCalls: 0,
      mirrorCalls: 1,
    },
    {
      name: "foreign evidence build hash",
      row: { ...validRow(), releaseEvidence: structuredClone(foreign.releaseEvidence) },
      joinCalls: 0,
      mirrorCalls: 1,
    },
    {
      name: "foreign evidence preview",
      row: { ...validRow(), releaseEvidence: wrongPreviewEvidence },
      joinCalls: 0,
      mirrorCalls: 1,
    },
  ];

  for (const scenario of cases) {
    let joinCalls = 0;
    let mirrorCalls = 0;
    let mirrorMarker = null;
    const out = await processRowPhase(structuredClone(scenario.row), { batchId: "line_client" }, {
      heroJoinOnly: async () => {
        joinCalls += 1;
        return {
          heroRemasterPending: true,
          heroRemaster: {
            required: true,
            ready: false,
            pending: true,
            status: "queued",
            job_id: "hrj_client",
            hero_attempt_id: "hero_attempt:4",
          },
        };
      },
      mirror: async (passedRow) => {
        mirrorCalls += 1;
        mirrorMarker = structuredClone(passedRow.heroRemaster);
        return {
          ok: true,
          heroRemasterPending: true,
          heroRemaster: {
            required: true,
            ready: false,
            pending: true,
            status: "queued",
            job_id: "hrj_client",
            hero_attempt_id: "hero_attempt:4",
          },
        };
      },
      now: () => NOW,
    });

    assert.equal(joinCalls, scenario.joinCalls, scenario.name);
    assert.equal(mirrorCalls, scenario.mirrorCalls, scenario.name);
    if (scenario.mirrorCalls) assert.deepEqual(mirrorMarker, marker, scenario.name);
    assert.equal(out.ok, true, scenario.name);
    assert.equal(out.phase, "hero_remaster", scenario.name);
    assert.equal(out.row.heroRemaster.pending, true, scenario.name);
  }
});

test("the real join-only adapter classifies a transient prospect read without enqueue or Mirror work", async () => {
  let heroEnqueues = 0;
  const out = await heroJoinOnlyRecheck({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: "hrj_client",
      attemptId: "hero_attempt:4",
    },
  }, {
    select: async () => { throw new Error("temporary Supabase read outage"); },
    enqueueHeroRemasterForBuild: async () => {
      heroEnqueues += 1;
      throw new Error("read classification cannot enqueue");
    },
  });

  assert.equal(heroEnqueues, 0);
  assert.deepEqual(out, {
    skipped: true,
    retryable: true,
    reason: "hero_recheck_read_unavailable",
  });
});

test("a skipped or absent recheck falls through to the full mirror pipeline unchanged", async () => {
  const pendingNoPreview = {
    ...qualifiedRow(),
    heroRemaster: { required: true, pending: true, jobId: "hrj_client", attemptId: "attempt_1" },
  };
  const out = await processRowPhase(pendingNoPreview, { batchId: "line_client" }, {
    mirror: async () => ({ ok: true, previewUrl: PREVIEW, ownedPhotoBank: ownedBank() }),
    heroJoinOnly: async () => { throw new Error("no preview identity: recheck must not even be attempted"); },
    prepareHero: async () => ({
      ok: true,
      heroRemaster: { required: true, ready: false, pending: true, status: "queued", job_id: "hrj_client", hero_attempt_id: "attempt_1" },
      rowPatch: {},
    }),
    now: () => NOW,
  });

  assert.equal(out.ok, true);
  assert.equal(out.phase, "hero_remaster");
  assert.equal(out.row.status, "qualified");

  const skipped = await processRowPhase({
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    heroRemaster: { required: true, pending: true, jobId: "hrj_client", attemptId: "attempt_1" },
  }, { batchId: "line_client" }, {
    mirror: async () => ({ ok: true, previewUrl: PREVIEW, ownedPhotoBank: ownedBank() }),
    heroJoinOnly: async () => ({ skipped: true }),
    prepareHero: async () => ({
      ok: true,
      heroRemaster: { required: true, ready: false, pending: true, status: "queued", job_id: "hrj_client", hero_attempt_id: "attempt_1" },
      rowPatch: {},
    }),
    now: () => NOW,
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.phase, "hero_remaster");
});

test("the join-only recheck holds a verified-client hero refusal instead of looping", async () => {
  const built = heroBuildOutput();
  const row = {
    ...qualifiedRow(),
    previewUrl: PREVIEW,
    buildHash: HERO_BUILD_HASH,
    buildEvidence: built.buildEvidence,
    releaseEvidence: built.releaseEvidence,
    heroRemaster: { required: true, pending: true, jobId: "hrj_client", attemptId: "attempt_1" },
  };
  const out = await processRowPhase(row, { batchId: "line_client" }, {
    mirror: async () => { throw new Error("hold recheck must not re-dispatch"); },
    heroJoinOnly: async () => ({
      heroRemasterHold: true,
      reason: "verified_client_hero_failed",
      heroRemaster: { required: true, ready: false, hold: true, reason: "verified_client_hero_failed" },
    }),
    now: () => NOW,
  });
  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "verified_client_hero_failed");
});
