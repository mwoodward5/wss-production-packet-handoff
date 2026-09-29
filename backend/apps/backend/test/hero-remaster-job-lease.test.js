"use strict";

// Durable lease/idempotency tests with an in-memory store.  No Supabase and no
// browser: races are simulated at the conditional-update boundary the live
// queue uses.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const jobs = require("../lib/hero-reel-job-queue");
const seedanceRunner = require("../lib/hero-seedance-runner");
const {
  REMASTER_PROMPT_SHA256,
  DIRECT_SOURCE_RECIPE_SHA256,
} = require("../lib/hero-clip-validation");
const {
  WAN_PRODUCER,
  ADS_PRODUCER,
  OPENROUTER_SEEDANCE_PRODUCER,
} = require("../lib/hero-video-policy");
const {
  WAN_MODEL_ID,
  WAN_MODEL_REVISION,
  WAN_REMASTER_RECIPE_SHA256,
  defaultWanGeneration,
  stableSerialize,
} = require("../lib/wan-hero-policy");
const { createHeroReelHandler } = require("../api/admin/hero-reel");

const SOURCE_SHA = "1".repeat(64);
const CLIP_SHA = "2".repeat(64);
const OPTIMIZED_SHA = "3".repeat(64);
const MASTER_SHA = "4".repeat(64);
const SOURCE_URL = "https://acme.example.com/work/job.jpg";
const OPTIMIZED_FINGERPRINT = "GoogleHost.example/Asset/CaseSensitive";

function prospect(prospectId = "wss-test-acme") {
  return {
    prospect_id: prospectId,
    business_name: "Acme Plumbing",
    industry: "Plumbing",
    record: {
      preview_url: "https://wss-test-acme.wss-ai.com/",
      current_website: "https://acme.example.com/",
      build_ready: {
        photo_bank: {
          version: 3,
          harvested_at: "2026-08-21T00:00:00.000Z",
          website: "https://acme.example.com/",
          photos: [{
            url: SOURCE_URL,
            sha256: SOURCE_SHA,
            source: "own_site",
            found_on: "https://acme.example.com/gallery",
            width: 1920,
            height: 1080,
            bytes: 300000,
            grade: "hero",
            asset_type: "real_scene",
          }],
        },
      },
    },
  };
}

function acceptedSeedanceCheckpoint(job) {
  const durationSeconds = Number(job.payload.duration_seconds);
  const intentSha = createHash("sha256").update(Buffer.from(stableSerialize({
    schema: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: job.job_id,
    prospect_id: job.prospect_id,
    generation_revision: job.payload.generation_revision,
    source_sha256: SOURCE_SHA,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: durationSeconds,
  }))).digest("hex");
  return {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: job.job_id,
    prospect_id: job.prospect_id,
    generation_revision: job.payload.generation_revision,
    source_sha256: SOURCE_SHA,
    source_mime: "image/jpeg",
    source_bytes: 300000,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: durationSeconds,
    intent_sha256: intentSha,
    submission_state: "accepted",
    polling_url: "https://openrouter.ai/api/v1/videos/jobs/durable-recovery",
    provider_job_id: "durable-recovery",
    created_at: "2026-08-21T20:00:00.000Z",
    submit_started_at: "2026-08-21T20:00:01.000Z",
    submitted_at: "2026-08-21T20:00:02.000Z",
  };
}

async function persistAcceptedSeedanceCheckpoint(h, jobId, leaseToken) {
  const accepted = acceptedSeedanceCheckpoint(h.rows[0]);
  const { provider_job_id, polling_url, submit_started_at, submitted_at, ...base } = accepted;
  for (const checkpoint of [
    { ...base, submission_state: "intent", polling_url: "" },
    { ...base, submission_state: "submitting", polling_url: "", submit_started_at },
    accepted,
  ]) {
    const saved = await h.queue.checkpointHeroReelJob({ jobId, leaseToken, checkpoint });
    assert.equal(saved.ok, true, JSON.stringify(saved));
  }
  return accepted;
}

function memoryQueue(options = {}) {
  const rows = [];
  let clock = Date.parse("2026-08-21T20:00:00.000Z");
  let jobNo = 0;
  let leaseNo = 0;

  function queryValue(query, key) {
    const m = new RegExp(`${key}=eq\\.([^&]+)`).exec(String(query));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function guardPass(row, guards) {
    return Object.entries(guards || {}).every(([key, condition]) => {
      const jsonMatch = /^([a-z0-9_]+)->>([a-z0-9_]+)$/.exec(key);
      const nestedJsonMatch = /^([a-z0-9_]+)->([a-z0-9_]+)->>([A-Za-z0-9_]+)$/.exec(key);
      const value = nestedJsonMatch
        ? row[nestedJsonMatch[1]]?.[nestedJsonMatch[2]]?.[nestedJsonMatch[3]]
        : jsonMatch ? row[jsonMatch[1]]?.[jsonMatch[2]] : row[key];
      if (condition === "is.null") return value === null || value === undefined || value === "";
      if (String(condition).startsWith("eq.")) return String(value ?? "") === String(condition).slice(3);
      if (String(condition).startsWith("lte.")) return Date.parse(String(value || "")) <= Date.parse(String(condition).slice(4));
      if (String(condition).startsWith("gt.")) return Date.parse(String(value || "")) > Date.parse(String(condition).slice(3));
      return false;
    });
  }

  const queue = jobs.createHeroReelJobQueue({
    env: options.env || {},
    now: () => new Date(clock),
    newJobId: () => `hrj_${++jobNo}`,
    newLeaseToken: () => `lease_${++leaseNo}`,
    parentBatchStatus: options.parentBatchStatus,
    insertRow: options.insertRow || (async (_table, row) => {
      if (rows.some((item) => item.prospect_id === row.prospect_id)) return { ok: false, mode: "live_write_failed" };
      const stored = structuredClone(row);
      rows.push(stored);
      return { ok: true, mode: "live_write", rows: [structuredClone(stored)] };
    }),
    select: async (_table, query) => {
      let found = rows.slice();
      const jobId = queryValue(query, "job_id");
      const prospectId = queryValue(query, "prospect_id");
      const status = queryValue(query, "status");
      const producer = queryValue(query, "producer");
      const orExpression = /(?:^|[?&])or=([^&]+)/.exec(String(query));
      if (jobId) found = found.filter((row) => row.job_id === jobId);
      if (prospectId) found = found.filter((row) => row.prospect_id === prospectId);
      if (status) found = found.filter((row) => row.status === status);
      if (producer) found = found.filter((row) => row.producer === producer);
      if (orExpression) {
        const expression = decodeURIComponent(orExpression[1]);
        const leaseExpiry = /lease_expires_at\.lte\.([^)]+)/.exec(expression);
        if (expression.includes("lease_token.is.null") && leaseExpiry) {
          const cutoff = Date.parse(leaseExpiry[1]);
          found = found.filter((row) => !row.lease_token
            || (Number.isFinite(cutoff) && Date.parse(String(row.lease_expires_at || "")) <= cutoff));
        }
      }
      if (/lease_token=is\.null/.test(query)) found = found.filter((row) => !row.lease_token);
      if (/order=updated_at\.asc,attempts\.asc,created_at\.asc,job_id\.asc/.test(query)) {
        found.sort((a, b) => (
          String(a.updated_at).localeCompare(String(b.updated_at))
          || Number(a.attempts || 0) - Number(b.attempts || 0)
          || String(a.created_at).localeCompare(String(b.created_at))
          || String(a.job_id).localeCompare(String(b.job_id))
        ));
      } else if (/order=created_at\.asc/.test(query)) {
        found.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      }
      if (/order=lease_expires_at\.asc/.test(query)) found.sort((a, b) => String(a.lease_expires_at).localeCompare(String(b.lease_expires_at)));
      // Honor the query's limit so claim-window starvation is reproducible in
      // the harness exactly as Supabase enforces it in production.
      const limitMatch = /(?:^|[?&])limit=(\d+)/.exec(String(query));
      if (limitMatch) found = found.slice(0, Number(limitMatch[1]));
      return { ok: true, data: found.map((row) => structuredClone(row)) };
    },
    conditionalUpdate: async (_table, key, id, guards, patch) => {
      const row = rows.find((item) => item[key] === id);
      if (row && typeof options.beforeConditionalUpdate === "function") {
        await options.beforeConditionalUpdate(row, guards, patch);
      }
      if (!row || !guardPass(row, guards)) return { ok: true, updated: false, rows: [] };
      Object.assign(row, structuredClone(patch));
      return { ok: true, updated: true, rows: [structuredClone(row)] };
    },
  });

  return {
    queue,
    rows,
    advance(ms) { clock += ms; },
  };
}

function reviewVerdict(clipSha256 = CLIP_SHA, revision = 1, options = {}) {
  const producer = options.producer || WAN_PRODUCER;
  const generator = options.generator || (producer === WAN_PRODUCER ? WAN_PRODUCER : "ads_animate_image");
  const promptSha256 = options.promptSha256
    || (generator === WAN_PRODUCER ? WAN_REMASTER_RECIPE_SHA256 : REMASTER_PROMPT_SHA256);
  const optimizedSha256 = options.optimizedSha256 || OPTIMIZED_SHA;
  const optimizedAssetFingerprint = options.optimizedAssetFingerprint || OPTIMIZED_FINGERPRINT;
  const imagePreparation = options.imagePreparation || (producer === ADS_PRODUCER
    ? promptSha256 === DIRECT_SOURCE_RECIPE_SHA256 ? "direct_client_photo" : "image_editor"
    : "");
  const verdict = {
    producer,
    generator,
    generation_revision: revision,
    source_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    clip_sha256: clipSha256,
    optimized_sha256: optimizedSha256,
    optimized_asset_fingerprint: optimizedAssetFingerprint,
    prompt_sha256: promptSha256,
    canonical_recipe_sha256: options.canonicalPromptSha256 || promptSha256,
    ...(imagePreparation ? { image_preparation: imagePreparation } : {}),
    optimized_asset: {
      sha256: optimizedSha256,
      url_fingerprint: optimizedAssetFingerprint,
      width: 1920,
      height: 1080,
      prompt_sha256: promptSha256,
      ...(imagePreparation ? { image_preparation: imagePreparation } : {}),
    },
    bytes: 900000,
    captured_at: "2026-08-21T20:05:00.000Z",
  };
  if (producer !== WAN_PRODUCER) return verdict;
  const wan = defaultWanGeneration({
    prospectId: options.prospectId || "wss-test-acme",
    vertical: "plumbing",
    preset: "cheap_5s",
  });
  verdict.generation_receipt = {
    schema_version: "wss.hero_generation_receipt.v1",
    requested_producer: WAN_PRODUCER,
    generator,
    source: {
      prospect_id: options.prospectId || "wss-test-acme",
      domain: "acme.example.com",
      type: "own_site",
      asset_type: "real_scene",
      raw_sha256: SOURCE_SHA,
    },
    artifacts: {
      raw_sha256: SOURCE_SHA,
      optimized_sha256: OPTIMIZED_SHA,
      master_sha256: MASTER_SHA,
      clip_sha256: clipSha256,
      recipe_sha256: promptSha256,
    },
    model: {
      id: WAN_MODEL_ID,
      revision: WAN_MODEL_REVISION,
      settings: wan.modelSettings,
    },
    metrics: {
      wall_time_ms: 120000,
      generation_time_ms: 90000,
      energy: {
        method: "configured_power_estimate",
        estimated_power_watts: 300,
        estimated_kwh: 0.01,
        gpu_telemetry: {
          samples: 30,
          avg_power_watts: 250,
          peak_power_watts: 320,
          energy_kwh: 0.008,
          peak_vram_mib: 15000,
        },
      },
      electricity_rate_usd_per_kwh: 0.2,
      estimated_electricity_cost_usd: 0.002,
    },
    ...(options.fallback ? { fallback: options.fallback } : {}),
  };
  return verdict;
}

function reviewCandidate(verdict, clipSha256, overrides = {}) {
  return {
    sha256: clipSha256,
    bytes: 900000,
    durationSeconds: 5,
    width: 1920,
    height: 1080,
    codec: "avc1",
    approved_artifact: {
      raw_sha256: verdict.source_sha256,
      source_url: verdict.source_url,
      clip_sha256: clipSha256,
      optimized_sha256: verdict.optimized_sha256,
      optimized_asset_fingerprint: verdict.optimized_asset_fingerprint,
      prompt_sha256: verdict.prompt_sha256,
    },
    ...overrides,
  };
}

function verifiedUploadReceipt(clipSha256 = CLIP_SHA) {
  return {
    clip_sha256: clipSha256,
    url: "https://cdn.example.com/proof/hero-reel.mp4",
    storage: {
      object_path: "wss-test-acme/hero-reel.mp4",
      sha256: clipSha256,
      write_id: "storage-write-1",
    },
    audit: { type: "hero_clip.asset_stored", write_id: "event-1" },
    record: { prospect_id: "wss-test-acme", write_id: "record-write-1" },
    rebuild: { job_id: "rebuild-1" },
  };
}

function verifiedSharedUploadReceipt(clipSha256 = CLIP_SHA) {
  const receipt = verifiedUploadReceipt(clipSha256);
  delete receipt.rebuild;
  const siteId = "11111111-1111-4111-8111-111111111111";
  const previousReleaseId = "22222222-2222-4222-8222-222222222222";
  const releaseId = "33333333-3333-4333-8333-333333333333";
  const buildHash = "5".repeat(64);
  receipt.shared_release = {
    preview_url: "https://wss-test-acme.wss-ai.com/",
    proof_identity: { site_id: siteId, release_id: releaseId, build_hash: buildHash },
    previous_proof_identity: {
      site_id: siteId,
      release_id: previousReleaseId,
      build_hash: "6".repeat(64),
    },
    release_evidence: {
      evidence_schema: "shared-site-release-evidence-v1",
      site_id: siteId,
      release_id: releaseId,
      build_hash: buildHash,
      canonical_host: "wss-test-acme.wss-ai.com",
      manifest_path: `sites/${siteId}/releases/${releaseId}/manifest.json`,
      manifest_sha256: "7".repeat(64),
      deployment_env: "production",
      generation: 2,
      route_generation: 2,
      state: "active",
      hero_video_path: "assets/hero-fallback.mp4",
      hero_video_sha256: clipSha256,
    },
    hero_video_path: "assets/hero-fallback.mp4",
    hero_video_sha256: clipSha256,
    record_write_id: receipt.record.write_id,
    line_handle: { batchId: "line_client", rowId: "line_client:0" },
  };
  return receipt;
}

async function approveHeldClip(h, jobId, claimed, clipSha256 = CLIP_SHA) {
  const held = await h.queue.settleHeroReelJob({
    jobId,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict: reviewVerdict(clipSha256),
  });
  assert.equal(held.ok, true, JSON.stringify(held));
  assert.equal(held.job.status, "awaiting_review");
  const approved = await h.queue.approveHeroReelJob({
    jobId,
    clipSha256,
    generationRevision: 1,
    approvedBy: "owner_console",
    approvedAt: "2026-08-21T20:06:00.000Z",
  });
  assert.equal(approved.ok, true, JSON.stringify({ approved, row: h.rows[0] }));
  assert.equal(approved.job.status, "queued");
  return approved;
}

test("two enqueues for one prospect reuse exactly one durable job", async () => {
  const h = memoryQueue();
  const first = await h.queue.enqueueHeroReelJob(prospect(), { actor: "full_run" });
  const second = await h.queue.enqueueHeroReelJob(prospect(), { actor: "full_run" });
  assert.equal(first.ok, true);
  assert.equal(first.reused, false);
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
  assert.equal(second.job_id, first.job_id);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].producer, ADS_PRODUCER);
  assert.equal(h.rows[0].payload.photo_bank.photos[0].sha256, SOURCE_SHA);
  assert.equal(h.rows[0].payload.vertical, undefined);
  assert.equal(h.rows[0].payload.wan, undefined);
});

test("WAN enqueue requires a supported vertical while explicit Ads keeps its legacy contract", async () => {
  const wan = memoryQueue();
  const missingVertical = prospect();
  delete missingVertical.industry;
  const refused = await wan.queue.enqueueHeroReelJob(missingVertical, { producer: WAN_PRODUCER });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "wan_vertical_required");
  assert.equal(wan.rows.length, 0);

  const ads = memoryQueue();
  const queued = await ads.queue.enqueueHeroReelJob(missingVertical, { producer: ADS_PRODUCER });
  assert.equal(queued.ok, true);
  assert.equal(ads.rows[0].producer, ADS_PRODUCER);
  assert.equal(ads.rows[0].payload.vertical, undefined);
  assert.equal(ads.rows[0].payload.wan, undefined);
});

test("enqueue accepts all durable producers and freezes the Seedance eight-second contract", async () => {
  const ads = memoryQueue();
  const queued = await ads.queue.enqueueHeroReelJob(prospect(), { producer: "ads_image_to_video" });
  assert.equal(queued.ok, true);
  assert.equal(ads.rows[0].producer, "ads_image_to_video");

  const seedance = memoryQueue();
  const seedanceQueued = await seedance.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(seedanceQueued.ok, true);
  assert.equal(seedance.rows[0].producer, OPENROUTER_SEEDANCE_PRODUCER);
  assert.equal(seedance.rows[0].payload.duration_seconds, 8);
  assert.equal(seedance.rows[0].payload.openrouter_model, "bytedance/seedance-2.0-mini");

  const legacy = memoryQueue();
  const refused = await legacy.queue.enqueueHeroReelJob(prospect(), { producer: "hero_compose_local" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "producer_not_enabled");
  assert.deepEqual(refused.allowed, ["wan2_i2v_local", "ads_image_to_video", "openrouter_seedance"]);
  assert.equal(legacy.rows.length, 0);
});

test("a halted parent Line cannot claim or requeue its hero while another batch remains claimable", async () => {
  let halted = true;
  const h = memoryQueue({
    parentBatchStatus: async (batchId) => ({ ok: true, halted: batchId === "line_halted" && halted }),
  });
  const stopped = await h.queue.enqueueHeroReelJob(prospect("wss-test-stopped"), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "line_halted", rowId: "row_stopped" },
  });
  const active = await h.queue.enqueueHeroReelJob(prospect("wss-test-active"), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "line_active", rowId: "row_active" },
  });
  const claimed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  assert.equal(claimed.job.job_id, active.job_id, "the unrelated live batch is unaffected");
  assert.deepEqual(claimed.job.line_handle, { batchId: "line_active", rowId: "row_active" });
  const stoppedRow = h.rows.find((row) => row.job_id === stopped.job_id);
  assert.equal(stoppedRow.status, "queued");
  assert.equal(stoppedRow.attempts, 0);
  assert.equal(stoppedRow.lease_token, null);

  halted = false;
  const stoppedClaim = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker-2",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(stoppedClaim.job.job_id, stopped.job_id);
  halted = true;
  const before = structuredClone(stoppedRow);
  const requeue = await h.queue.settleHeroReelJob({
    jobId: stopped.job_id,
    action: "requeue",
    leaseToken: stoppedClaim.job.lease_token,
    verdict: { reason: "transport_retry" },
  });
  assert.deepEqual(requeue, { ok: false, error: "parent_line_batch_halted", terminal: true });
  assert.deepEqual(stoppedRow, before, "halted-parent evidence and lease stay unchanged");
});

test("a missing historical parent cannot starve an unrelated active hero claim", async () => {
  const h = memoryQueue({
    parentBatchStatus: async (batchId) => (batchId === "line_missing"
      ? { ok: false, error: "batch_not_found" }
      : { ok: true, halted: false, status: "building" }),
  });
  const orphan = await h.queue.enqueueHeroReelJob(prospect("wss-test-orphan"), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "line_missing", rowId: "row_orphan" },
  });
  const active = await h.queue.enqueueHeroReelJob(prospect("wss-test-active-after-orphan"), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "line_active", rowId: "row_active" },
  });

  const claimed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  assert.equal(claimed.job.job_id, active.job_id);
  const orphanRow = h.rows.find((candidate) => candidate.job_id === orphan.job_id);
  assert.equal(orphanRow.status, "queued");
  assert.equal(orphanRow.attempts, 0);
  assert.equal(orphanRow.lease_token, null);
});

test("Seedance hold freezes the exact receipt before owner approval can requeue it", async () => {
  const h = memoryQueue();
  const queued = await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const claimed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const generationReceipt = {
    schema_version: "wss.hero.seedance_generation_receipt.v1",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    prospect_id: "wss-test-acme",
    domain: "acme.example.com",
    source_type: "own_site",
    source_asset_type: "real_scene",
    source_sha256: SOURCE_SHA,
    raw_sha256: SOURCE_SHA,
    optimized_sha256: SOURCE_SHA,
    clip_sha256: CLIP_SHA,
    recipe_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: 8,
    generate_audio: false,
    wall_time_ms: 30000,
    generation_time_ms: 28000,
    cost_usd: 0.12,
  };
  const artifact = {
    raw_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    clip_sha256: CLIP_SHA,
    optimized_sha256: SOURCE_SHA,
    optimized_asset_fingerprint: `direct-source:${SOURCE_SHA}`,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    image_preparation: "direct_client_photo",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    generation_receipt: generationReceipt,
  };
  const held = await h.queue.settleHeroReelJob({
    jobId: queued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict: {
      producer: OPENROUTER_SEEDANCE_PRODUCER,
      generator: OPENROUTER_SEEDANCE_PRODUCER,
      generation_revision: 1,
      source_sha256: SOURCE_SHA,
      source_url: SOURCE_URL,
      clip_sha256: CLIP_SHA,
      optimized_sha256: SOURCE_SHA,
      optimized_asset_fingerprint: `direct-source:${SOURCE_SHA}`,
      prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
      canonical_recipe_sha256: DIRECT_SOURCE_RECIPE_SHA256,
      image_preparation: "direct_client_photo",
      optimized_asset: {
        sha256: SOURCE_SHA,
        url_fingerprint: `direct-source:${SOURCE_SHA}`,
        width: 1920,
        height: 1080,
        prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
        image_preparation: "direct_client_photo",
      },
      approved_artifact: artifact,
      generation_receipt: generationReceipt,
      candidates: [{
        sha256: CLIP_SHA,
        bytes: 900000,
        durationSeconds: 4,
        width: 720,
        height: 1280,
        codec: "avc1",
        approved_artifact: artifact,
      }],
    },
  });
  assert.equal(held.ok, true, JSON.stringify(held));
  assert.equal(held.job.status, "awaiting_review");
  assert.equal(h.rows[0].payload.approved_clip, undefined);
  assert.equal(held.job.result.generation_receipt.duration_seconds, 8);

  const approved = await h.queue.approveHeroReelJob({
    jobId: queued.job_id,
    clipSha256: CLIP_SHA,
    generationRevision: 1,
    approvedBy: "factory_verified",
    approvedAt: "2026-08-21T20:06:00.000Z",
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal(h.rows[0].payload.approved_clip.sha256, CLIP_SHA);
  assert.equal(h.rows[0].payload.approved_artifact.generation_receipt.generate_audio, false);

  const ads = memoryQueue();
  const adsJob = await ads.queue.enqueueHeroReelJob(prospect("wss-test-ads-portrait"), {
    producer: ADS_PRODUCER,
  });
  const adsClaim = await ads.queue.claimNextHeroReelJob({
    workerId: "ads-worker",
    producer: ADS_PRODUCER,
  });
  const adsVerdict = reviewVerdict(CLIP_SHA, 1, {
    producer: ADS_PRODUCER,
    prospectId: "wss-test-ads-portrait",
  });
  adsVerdict.candidates = [reviewCandidate(adsVerdict, CLIP_SHA, { width: 720, height: 1280 })];
  const adsRefused = await ads.queue.settleHeroReelJob({
    jobId: adsJob.job_id,
    action: "hold",
    leaseToken: adsClaim.job.lease_token,
    verdict: adsVerdict,
  });
  assert.equal(adsRefused.ok, false);
  assert.equal(adsRefused.error, "review_candidate_invalid");
});

test("ambiguous paid Seedance submit is held without an artifact and only owner regeneration may spend again", async () => {
  const h = memoryQueue();
  const queued = await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const claimed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const intentSha = createHash("sha256").update(Buffer.from(stableSerialize({
    schema: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: queued.job_id,
    prospect_id: "wss-test-acme",
    generation_revision: 1,
    source_sha256: SOURCE_SHA,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: 8,
  }))).digest("hex");
  const verdict = {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    generation_revision: 1,
    reason: "seedance_submit_reconciliation_required",
    provider_submission_review: {
      schema_version: "wss.hero.seedance_submit_review.v1",
      intent_sha256: intentSha,
      source_sha256: SOURCE_SHA,
      model_id: "bytedance/seedance-2.0-mini",
      duration_seconds: 8,
      submit_started_at: "2026-08-21T20:00:00.000Z",
    },
  };
  const held = await h.queue.settleHeroReelJob({
    jobId: queued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict,
  });
  assert.equal(held.ok, true);
  assert.equal(held.job.status, "awaiting_review");
  assert.equal(held.job.result.reason, "seedance_submit_reconciliation_required");
  assert.equal(held.job.result.approved_artifact, undefined);
  assert.equal(held.job.result.provider_submission_review.intent_sha256, intentSha);

  const malformed = memoryQueue();
  const malformedQueued = await malformed.queue.enqueueHeroReelJob(prospect("wss-test-malformed"), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const malformedClaim = await malformed.queue.claimNextHeroReelJob({
    workerId: "seedance-worker",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const refused = await malformed.queue.settleHeroReelJob({
    jobId: malformedQueued.job_id,
    action: "hold",
    leaseToken: malformedClaim.job.lease_token,
    verdict: {
      ...verdict,
      provider_submission_review: { ...verdict.provider_submission_review, polling_url: "https://evil.example" },
    },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "seedance_submit_review_invalid");
});

test("Seedance provider checkpoint advances durably and is returned only to the leased worker", async () => {
  const h = memoryQueue();
  const queued = await h.queue.enqueueHeroReelJob(prospect(), { producer: OPENROUTER_SEEDANCE_PRODUCER });
  const claimed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const intentSha = createHash("sha256").update(Buffer.from(stableSerialize({
    schema: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: queued.job_id,
    prospect_id: "wss-test-acme",
    generation_revision: 1,
    source_sha256: SOURCE_SHA,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: 8,
  }))).digest("hex");
  const base = {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: queued.job_id,
    prospect_id: "wss-test-acme",
    generation_revision: 1,
    source_sha256: SOURCE_SHA,
    source_mime: "image/jpeg",
    source_bytes: 300000,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: 8,
    intent_sha256: intentSha,
    submission_state: "intent",
    polling_url: "",
    created_at: "2026-08-21T20:00:00.000Z",
  };
  for (const checkpoint of [
    base,
    { ...base, submission_state: "submitting", submit_started_at: "2026-08-21T20:00:01.000Z" },
    {
      ...base,
      submission_state: "accepted",
      polling_url: "https://openrouter.ai/api/v1/videos/jobs/durable-one",
      provider_job_id: "durable-one",
      submit_started_at: "2026-08-21T20:00:01.000Z",
      submitted_at: "2026-08-21T20:00:02.000Z",
    },
  ]) {
    const saved = await h.queue.checkpointHeroReelJob({
      jobId: queued.job_id,
      leaseToken: claimed.job.lease_token,
      checkpoint,
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
  }
  assert.equal(h.rows[0].result.provider_checkpoint.submission_state, "accepted");
  assert.equal(h.rows[0].result.provider_checkpoint.polling_url, "https://openrouter.ai/api/v1/videos/jobs/durable-one");
  const publicView = jobs.publicJob(jobs.jobFromRow(h.rows[0]));
  assert.equal(publicView.result?.provider_checkpoint, undefined, "public status hides provider recovery state");

  h.advance(60 * 60 * 1000 + 1);
  const reclaimed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker-2",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(reclaimed.job.provider_checkpoint.submission_state, "accepted");
  assert.equal(reclaimed.job.provider_checkpoint.provider_job_id, "durable-one");
});

test("only an unleased queued job can switch producer and bump its revision", async () => {
  const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const first = await h.queue.enqueueHeroReelJob(prospect());
  assert.equal(first.producer, "wan2_i2v_local");
  const switched = await h.queue.enqueueHeroReelJob(prospect(), { producer: "ads_image_to_video" });
  assert.equal(switched.ok, true);
  assert.equal(switched.refreshed, true);
  assert.equal(h.rows[0].producer, "ads_image_to_video");
  assert.equal(h.rows[0].payload.generation_revision, 2);
});

test("producer enqueue never steals a leased, running, review, or done job", async () => {
  for (const status of ["queued", "running", "awaiting_review", "done"]) {
    const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
    await h.queue.enqueueHeroReelJob(prospect());
    h.rows[0].status = status;
    if (["queued", "running"].includes(status)) {
      h.rows[0].lease_token = "existing_lease";
      h.rows[0].lease_owner = "worker-a";
      h.rows[0].lease_expires_at = "2026-08-21T21:00:00.000Z";
    }
    const result = await h.queue.enqueueHeroReelJob(prospect(), { producer: "ads_image_to_video" });
    assert.equal(result.ok, true, status);
    assert.equal(result.reused, true, status);
    assert.equal(result.producer, "wan2_i2v_local", status);
    assert.equal(h.rows[0].producer, "wan2_i2v_local", status);
    assert.equal(h.rows[0].payload.generation_revision, 1, status);
  }
});

test("an explicit retry keeps a failed job on its original producer", async () => {
  const h = memoryQueue();
  const lineHandle = { batchId: "line_client", rowId: "line_client:0" };
  await h.queue.enqueueHeroReelJob(prospect(), {
    producer: "ads_image_to_video",
    lineHandle,
  });
  h.rows[0].status = "failed";
  h.rows[0].result = { reason: "worker_failed" };
  const retried = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "operator",
    retry: true,
    producer: WAN_PRODUCER,
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.retried, true);
  assert.equal(h.rows[0].status, "queued");
  assert.equal(h.rows[0].producer, "ads_image_to_video");
  assert.equal(h.rows[0].payload.wan, undefined);
  assert.equal(h.rows[0].payload.generation_revision, 2);
  assert.deepEqual(h.rows[0].payload.line_handle, lineHandle);
});

test("a failed live insert is re-read and never reported as a phantom queued job", async () => {
  let inserts = 0;
  const h = memoryQueue({
    insertRow: async () => {
      inserts++;
      return { mode: "live_write_failed", error: "simulated" };
    },
  });
  const result = await h.queue.enqueueHeroReelJob(prospect());
  assert.equal(inserts, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, "hero_reel_queue_unavailable");
  assert.equal(h.rows.length, 0);
});

test("enqueue refuses before insert without a fresh SHA-pinned owned photo", async () => {
  let inserts = 0;
  const h = memoryQueue({ insertRow: async () => { inserts++; return { mode: "live_write" }; } });
  const row = prospect();
  row.record.build_ready.photo_bank.photos[0].sha256 = "not-a-sha";
  const result = await h.queue.enqueueHeroReelJob(row);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_verified_owned_photo");
  assert.equal(inserts, 0);
});

test("owned Wix CDN bytes remain valid when bank and found_on bind to the legacy domain", async () => {
  const h = memoryQueue();
  const row = prospect();
  row.record.build_ready.photo_bank.photos[0].url = "https://static.wixstatic.com/media/acme-job.jpg";
  const result = await h.queue.enqueueHeroReelJob(row);
  assert.equal(result.ok, true);
  assert.equal(h.rows[0].payload.photo_bank.photos[0].url, "https://static.wixstatic.com/media/acme-job.jpg");
});

test("an unleased queued job refreshes when durable source bytes change", async () => {
  const h = memoryQueue();
  await h.queue.enqueueHeroReelJob(prospect());
  const changed = prospect();
  changed.record.build_ready.photo_bank.photos[0].sha256 = "9".repeat(64);
  const refreshed = await h.queue.enqueueHeroReelJob(changed);
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.refreshed, true);
  assert.equal(h.rows[0].payload.photo_bank.photos[0].sha256, "9".repeat(64));
  assert.equal(h.rows[0].payload.generation_revision, 2);
});

test("worker selection flags and rank are part of the queued source fingerprint", async () => {
  const h = memoryQueue();
  await h.queue.enqueueHeroReelJob(prospect());
  const firstFingerprint = h.rows[0].payload.source_fingerprint;
  const changed = prospect();
  changed.record.build_ready.photo_bank.photos[0].rank = 99;
  changed.record.build_ready.photo_bank.photos[0].stock_caption_suspect = true;
  const refreshed = await h.queue.enqueueHeroReelJob(changed);
  assert.equal(refreshed.refreshed, true);
  assert.notEqual(h.rows[0].payload.source_fingerprint, firstFingerprint);
  assert.equal(h.rows[0].payload.photo_bank.photos[0].stock_caption_suspect, true);
});

test("future banks and private photo targets are refused before durable enqueue", async () => {
  const futureHarness = memoryQueue();
  const future = prospect();
  future.record.build_ready.photo_bank.harvested_at = "2099-01-01T00:00:00.000Z";
  assert.equal((await futureHarness.queue.enqueueHeroReelJob(future)).reason, "photo_bank_stale_or_missing");
  assert.equal(futureHarness.rows.length, 0);

  for (const hostileUrl of [
    "https://127.0.0.1/private.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://user:pass@cdn.example.com/private.jpg",
    "https://cdn.example.com:8443/private.jpg",
  ]) {
    const h = memoryQueue();
    const row = prospect();
    row.record.build_ready.photo_bank.photos[0].url = hostileUrl;
    const refused = await h.queue.enqueueHeroReelJob(row);
    assert.equal(refused.reason, "no_verified_owned_photo", hostileUrl);
    assert.equal(h.rows.length, 0);
  }
});

test("legacy HTTP identity is normalized to the worker HTTPS contract", async () => {
  const h = memoryQueue();
  const row = prospect();
  row.record.current_website = "http://acme.example.com/";
  row.record.build_ready.photo_bank.website = "http://acme.example.com/";
  row.record.build_ready.photo_bank.photos[0].found_on = "http://acme.example.com/gallery";
  const result = await h.queue.enqueueHeroReelJob(row);
  assert.equal(result.ok, true);
  assert.equal(h.rows[0].payload.source_url, "https://acme.example.com/");
});

test("GBP identity requires exact record/bank/photo place pin and Google media host", async () => {
  function gbpRow(placeId, url = "https://lh3.googleusercontent.com/place-photo") {
    const row = prospect();
    row.record.place_id = placeId;
    const bank = row.record.build_ready.photo_bank;
    bank.place_id = placeId;
    bank.photos[0] = {
      ...bank.photos[0],
      url,
      source: "gbp",
      found_on: "google_business_profile",
      place_id: placeId,
      resource_name: `places/${placeId}/photos/photo-1`,
    };
    return row;
  }

  const hostile = memoryQueue();
  assert.equal((await hostile.queue.enqueueHeroReelJob(gbpRow("ChIJ_A", "https://evil.example/photo.jpg"))).reason, "no_verified_owned_photo");
  const mismatched = gbpRow("ChIJ_A");
  mismatched.record.build_ready.photo_bank.photos[0].place_id = "ChIJ_B";
  assert.equal((await memoryQueue().queue.enqueueHeroReelJob(mismatched)).reason, "no_verified_owned_photo");
  const mismatchedResource = gbpRow("ChIJ_A");
  mismatchedResource.record.build_ready.photo_bank.photos[0].resource_name = "places/ChIJ_B/photos/photo-1";
  assert.equal((await memoryQueue().queue.enqueueHeroReelJob(mismatchedResource)).reason, "no_verified_owned_photo");
  const missingResource = gbpRow("ChIJ_A");
  delete missingResource.record.build_ready.photo_bank.photos[0].resource_name;
  assert.equal((await memoryQueue().queue.enqueueHeroReelJob(missingResource)).reason, "no_verified_owned_photo");

  const h = memoryQueue();
  const first = await h.queue.enqueueHeroReelJob(gbpRow("ChIJ_A"));
  const firstFingerprint = h.rows[0].payload.source_fingerprint;
  assert.equal(first.ok, true);
  const changed = await h.queue.enqueueHeroReelJob(gbpRow("ChIJ_B"));
  assert.equal(changed.refreshed, true);
  assert.notEqual(h.rows[0].payload.source_fingerprint, firstFingerprint);
  assert.equal(h.rows[0].payload.place_id, "ChIJ_B");

  const opaqueMapsUri = "https://www.google.com/maps/place/Acme+Plumbing/data=!4m2!3m1!1sopaque";
  const opaque = gbpRow("ChIJ_OPAQUE");
  opaque.record.build_ready.mirror_request = {
    facts: { place_id: "ChIJ_OPAQUE", profile_url: opaqueMapsUri },
  };
  opaque.record.build_ready.photo_bank.photos[0].found_on = opaqueMapsUri;
  assert.equal((await memoryQueue().queue.enqueueHeroReelJob(opaque)).ok, true);

  const swappedMapsUri = gbpRow("ChIJ_OPAQUE");
  swappedMapsUri.record.build_ready.mirror_request = {
    facts: { place_id: "ChIJ_OPAQUE", profile_url: opaqueMapsUri },
  };
  swappedMapsUri.record.build_ready.photo_bank.photos[0].found_on = "https://www.google.com/maps/place/Someone+Else";
  assert.equal((await memoryQueue().queue.enqueueHeroReelJob(swappedMapsUri)).reason, "no_verified_owned_photo");
});

test("explicit GBP logo truth flags change the fingerprint and survive the worker claim", async () => {
  function gbpBrandMark(flagged) {
    const row = prospect();
    const placeId = "ChIJ_LOGO";
    row.record.place_id = placeId;
    const bank = row.record.build_ready.photo_bank;
    bank.place_id = placeId;
    bank.photos[0] = {
      ...bank.photos[0],
      url: "https://lh3.googleusercontent.com/opaque-brand-asset",
      source: "gbp",
      found_on: "google_business_profile",
      place_id: placeId,
      resource_name: `places/${placeId}/photos/photo-brand`,
      ...(flagged ? { logo_like: true, asset_type: "brand_mark" } : {}),
    };
    return row;
  }

  const h = memoryQueue();
  await h.queue.enqueueHeroReelJob(gbpBrandMark(false));
  const unflaggedFingerprint = h.rows[0].payload.source_fingerprint;
  const refreshed = await h.queue.enqueueHeroReelJob(gbpBrandMark(true));
  assert.equal(refreshed.refreshed, true);
  assert.notEqual(h.rows[0].payload.source_fingerprint, unflaggedFingerprint);

  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
  assert.equal(claimed.job.photo_bank.photos[0].logo_like, true);
  assert.equal(claimed.job.photo_bank.photos[0].asset_type, "brand_mark");
});

test("operator Ads parameters refresh only an unleased queued job and survive full-run reuse", async () => {
  const h = memoryQueue();
  await h.queue.enqueueHeroReelJob(prospect(), { actor: "full_run" });
  const configured = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "operator",
    adsParams: "mode=image-to-video&quality=high",
    allowUnverifiedLength: true,
  });
  assert.equal(configured.refreshed, true);
  assert.equal(h.rows[0].payload.ads_params, "mode=image-to-video&quality=high");
  const reused = await h.queue.enqueueHeroReelJob(prospect(), { actor: "full_run" });
  assert.equal(reused.refreshed, undefined);
  assert.equal(h.rows[0].payload.ads_params, "mode=image-to-video&quality=high");
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
  assert.equal(claimed.job.ads_params, "mode=image-to-video&quality=high");
  assert.equal(claimed.job.allow_unverified_length, true);
});

test("one worker leases a job; public status never exposes its token", async () => {
  const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "worker-a", leaseMs: 30 * 60 * 1000 });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.job.job_id, enqueued.job_id);
  assert.equal(claimed.job.lease_token, "lease_1");
  assert.equal(claimed.job.photo_bank.photos[0].sha256, SOURCE_SHA);
  assert.equal(claimed.job.photo_bank.photos[0].asset_type, "real_scene");
  assert.equal(claimed.job.generation_revision, 1);
  assert.equal(claimed.job.vertical, "plumbing");
  assert.deepEqual(claimed.job.wan, h.rows[0].payload.wan);

  const polled = await h.queue.getHeroReelJob(enqueued.job_id);
  const publicView = jobs.publicJob(polled.job);
  assert.equal("lease_token" in publicView, false);
  assert.equal("photo_bank" in publicView, false);
});

test("producer-scoped workers never claim across WAN and Ads lanes", async () => {
  const h = memoryQueue();
  const wan = await h.queue.enqueueHeroReelJob(prospect("wss-test-wan"), {
    producer: WAN_PRODUCER,
    vertical: "Plumbing",
  });
  const adsRow = prospect("wss-test-ads");
  delete adsRow.industry;
  const ads = await h.queue.enqueueHeroReelJob(adsRow, { producer: ADS_PRODUCER });
  assert.equal(wan.ok, true);
  assert.equal(ads.ok, true);

  const adsClaim = await h.queue.claimNextHeroReelJob({ workerId: "ads-worker", producer: ADS_PRODUCER });
  assert.equal(adsClaim.job.job_id, ads.job_id);
  assert.equal(adsClaim.job.producer, ADS_PRODUCER);
  assert.equal(h.rows.find((row) => row.job_id === wan.job_id).status, "queued");

  const wanClaim = await h.queue.claimNextHeroReelJob({ workerId: "wan-worker", producer: WAN_PRODUCER });
  assert.equal(wanClaim.job.job_id, wan.job_id);
  assert.equal(wanClaim.job.producer, WAN_PRODUCER);

  const invalid = await h.queue.claimNextHeroReelJob({ workerId: "bad-worker", producer: "tour_video" });
  assert.equal(invalid.error, "producer_not_enabled");
});

test("heartbeat atomically extends only the exact live worker lease", async () => {
  const h = memoryQueue();
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const claimed = await h.queue.claimNextHeroReelJob({
    workerId: "worker-a",
    leaseMs: 30 * 60 * 1000,
  });
  const originalExpiry = claimed.job.lease_expires_at;
  const originalAttempts = h.rows[0].attempts;
  h.advance(10 * 60 * 1000);

  const renewed = await h.queue.renewHeroReelJobLease({
    jobId: enqueued.job_id,
    leaseToken: claimed.job.lease_token,
    workerId: "worker-a",
    leaseMs: 30 * 60 * 1000,
  });
  assert.equal(renewed.ok, true, JSON.stringify(renewed));
  assert.equal(renewed.reused, false);
  assert.ok(Date.parse(renewed.lease_expires_at) > Date.parse(originalExpiry));
  assert.equal(h.rows[0].status, "running");
  assert.equal(h.rows[0].attempts, originalAttempts);
  assert.equal(h.rows[0].lease_token, claimed.job.lease_token);
  assert.equal(h.rows[0].lease_owner, "worker-a");
  assert.doesNotMatch(JSON.stringify(renewed), /lease_1|lease_token|leaseToken/,
    "heartbeat response may return the expiry but never the secret token");

  const bounded = await h.queue.renewHeroReelJobLease({
    jobId: enqueued.job_id,
    leaseToken: claimed.job.lease_token,
    workerId: "worker-a",
    leaseMs: 24 * 60 * 60 * 1000,
  });
  assert.equal(
    Date.parse(bounded.lease_expires_at),
    Date.parse("2026-08-21T20:10:00.000Z") + jobs.MAX_LEASE_MS,
    "a caller cannot push one heartbeat beyond the queue's hard lease cap",
  );
  assert.equal(h.rows[0].attempts, originalAttempts);
});

test("wrong worker, wrong token, expired lease, and stale reclaimed lease cannot heartbeat", async () => {
  const h = memoryQueue();
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const first = await h.queue.claimNextHeroReelJob({ workerId: "worker-a", leaseMs: 30 * 60 * 1000 });

  for (const input of [
    { leaseToken: "wrong-token", workerId: "worker-a" },
    { leaseToken: first.job.lease_token, workerId: "worker-b" },
  ]) {
    const refused = await h.queue.renewHeroReelJobLease({
      jobId: enqueued.job_id,
      leaseMs: 30 * 60 * 1000,
      ...input,
    });
    assert.equal(refused.error, "lease_conflict");
  }

  h.advance(31 * 60 * 1000);
  const expired = await h.queue.renewHeroReelJobLease({
    jobId: enqueued.job_id,
    leaseToken: first.job.lease_token,
    workerId: "worker-a",
  });
  assert.equal(expired.error, "lease_conflict");

  const second = await h.queue.claimNextHeroReelJob({ workerId: "worker-b", leaseMs: 30 * 60 * 1000 });
  const stale = await h.queue.renewHeroReelJobLease({
    jobId: enqueued.job_id,
    leaseToken: first.job.lease_token,
    workerId: "worker-a",
  });
  assert.equal(stale.error, "lease_conflict");
  assert.equal(h.rows[0].lease_token, second.job.lease_token);
  assert.equal(h.rows[0].lease_owner, "worker-b");
});

test("settlement is idempotent for the winning lease", async () => {
  const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const reviewClaim = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
  await approveHeldClip(h, enqueued.job_id, reviewClaim);
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
  const input = {
    jobId: enqueued.job_id,
    action: "complete",
    leaseToken: claimed.job.lease_token,
    verdict: { ok: true, clip_sha256: CLIP_SHA },
  };
  const forged = await h.queue.settleHeroReelJob(input);
  assert.equal(forged.ok, false);
  assert.equal(forged.error, "completion_requires_verified_upload");
  const first = await h.queue.completeHeroReelJobAfterUpload({
    jobId: enqueued.job_id,
    leaseToken: claimed.job.lease_token,
    receipt: verifiedUploadReceipt(),
  });
  const retried = await h.queue.settleHeroReelJob(input);
  assert.equal(first.ok, true);
  assert.equal(first.reused, false);
  assert.equal(first.job.status, "done");
  assert.equal(first.job.result.generation_receipt.generator, WAN_PRODUCER);
  assert.equal(first.job.result.generation_receipt.cost_usd, 0.002);
  assert.equal(retried.ok, true);
  assert.equal(retried.reused, true);
  assert.equal(h.rows.length, 1);
});

test("an untyped verified own-site scene reaches Seedance while stock-suspect stays excluded", async () => {
  const h = memoryQueue();
  const row = prospect();
  delete row.record.build_ready.photo_bank.photos[0].asset_type;
  row.record.build_ready.photo_bank.photos.push({
    ...row.record.build_ready.photo_bank.photos[0],
    url: "https://acme.example.com/gallery/perfect-technician-fixing-air-conditioner.jpg",
    found_on: "https://acme.example.com/gallery",
    sha256: "8".repeat(64),
    stock_caption_suspect: true,
  });
  const queued = await h.queue.enqueueHeroReelJob(row, { producer: OPENROUTER_SEEDANCE_PRODUCER });
  assert.equal(queued.ok, true);
  assert.equal(h.rows[0].payload.photo_bank.photos[0].asset_type, "real_scene");
  assert.equal(h.rows[0].payload.photo_bank.photos[1].asset_type, undefined);
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "seedance-worker", producer: OPENROUTER_SEEDANCE_PRODUCER });
  const selected = seedanceRunner.selectOwnedScene(seedanceRunner.normalizeJob(claimed.job));
  assert.equal(selected.sha256, SOURCE_SHA);
});

test("a fresh Mirror checkpoint reoffers one same-build repair only from its exact stale snapshot", async () => {
  const h = memoryQueue();
  await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
  });
  const originalJobId = h.rows[0].job_id;
  assert.equal(h.rows[0].payload.line_build_hash, null, "initial Line enqueue records the one legacy-migration slot");
  h.rows[0].status = "refused";
  h.rows[0].result = { reason: "no_verified_owned_real_scene" };

  const retried = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "full_run",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "line_client", rowId: "line_client:0" },
    reofferBuildHash: "a".repeat(64),
  });

  assert.equal(retried.ok, true);
  assert.equal(retried.retried, true);
  assert.equal(h.rows.length, 1, "the unique job is reopened, never duplicated");
  assert.equal(h.rows[0].job_id, originalJobId);
  assert.equal(h.rows[0].status, "queued");
  assert.equal(h.rows[0].attempts, 0);
  assert.equal(h.rows[0].payload.generation_revision, 2);
  assert.equal(h.rows[0].payload.line_build_hash, "a".repeat(64));
  assert.deepEqual(h.rows[0].payload.line_handle, { batchId: "line_client", rowId: "line_client:0" });

  h.rows[0].status = "refused";
  h.rows[0].result = { reason: "source_sha256_mismatch" };
  const sameBuildSnapshot = {
    job_id: originalJobId,
    status: "refused",
    revision: 2,
    line_handle: { batchId: "line_client", rowId: "line_client:0" },
    lease_token: "", lease_owner: "", lease_expires_at: "",
  };
  const sameBuild = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "full_run",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "third_batch", rowId: "third_batch:0" },
    reofferBuildHash: "a".repeat(64),
    expectedStaleJobSnapshot: sameBuildSnapshot,
  });
  assert.equal(sameBuild.retried, true);
  assert.equal(sameBuild.job_id, originalJobId);
  assert.equal(h.rows[0].status, "queued");
  assert.equal(h.rows[0].payload.generation_revision, 3);
  assert.equal(h.rows[0].payload.line_same_build_reoffer_count, 1);
  assert.deepEqual(h.rows[0].payload.line_handle, { batchId: "third_batch", rowId: "third_batch:0" });

  const refreshedProspect = prospect();
  refreshedProspect.record.build_ready.photo_bank.photos[0].url = "https://acme.example.com/work/refreshed-job.jpg";
  const refreshed = await h.queue.enqueueHeroReelJob(refreshedProspect, {
    actor: "full_run",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "third_batch", rowId: "third_batch:0" },
    reofferBuildHash: "a".repeat(64),
  });
  assert.equal(refreshed.refreshed, true);
  assert.equal(h.rows[0].payload.line_same_build_reoffer_count, 1, "payload refresh preserves the one-time recovery marker");

  h.rows[0].status = "refused";
  h.rows[0].result = { reason: "photo_bank_stale_or_missing" };
  const thirdForeignHandle = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "full_run",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "fourth_batch", rowId: "fourth_batch:0" },
    reofferBuildHash: "a".repeat(64),
    expectedStaleJobSnapshot: {
      job_id: originalJobId,
      status: "refused",
      revision: h.rows[0].payload.generation_revision,
      line_handle: { batchId: "third_batch", rowId: "third_batch:0" },
      lease_token: "", lease_owner: "", lease_expires_at: "",
    },
  });
  assert.equal(thirdForeignHandle.retried, undefined);
  assert.equal(h.rows[0].status, "refused");
  assert.equal(h.rows[0].payload.generation_revision, 4);
  assert.equal(h.rows[0].payload.line_same_build_reoffer_count, 1);
});

test("a same-build foreign-handle terminal job without a stale snapshot never reoffers", async () => {
  const h = memoryQueue();
  await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
    reofferBuildHash: "a".repeat(64),
  });
  h.rows[0].status = "failed";
  h.rows[0].result = { reason: "no_verified_owned_real_scene" };
  const out = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "full_run",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "new_batch", rowId: "new_batch:0" },
    reofferBuildHash: "a".repeat(64),
  });
  assert.equal(out.retried, undefined);
  assert.equal(h.rows[0].status, "failed");
  assert.equal(h.rows[0].payload.generation_revision, 1);
  assert.equal(h.rows[0].payload.line_same_build_reoffer_count, undefined);
});

test("an accepted Seedance clip-dimensions failure requeues one foreign same-build row without another submit", async () => {
  const h = memoryQueue();
  const created = await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
    reofferBuildHash: "a".repeat(64),
  });
  // Simulate a paid checkpoint created before the eight-second default. The
  // reoffer must preserve the four-second identity instead of rewriting it.
  h.rows[0].payload.duration_seconds = 4;
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "seedance-worker", producer: OPENROUTER_SEEDANCE_PRODUCER });
  assert.equal(claimed.job.duration_seconds, 4);
  const checkpoint = await persistAcceptedSeedanceCheckpoint(h, created.job_id, claimed.job.lease_token);
  const attemptsBeforeRecovery = h.rows[0].attempts;
  h.rows[0].status = "failed";
  h.rows[0].lease_token = null;
  h.rows[0].lease_owner = null;
  h.rows[0].lease_expires_at = null;
  h.rows[0].result = { ...h.rows[0].result, reason: "clip_dimensions_out_of_range" };
  const snapshot = {
    job_id: created.job_id, status: "failed", revision: 1,
    line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
    lease_token: "", lease_owner: "", lease_expires_at: "",
  };
  const rescored = prospect();
  rescored.record.build_ready.photo_bank.photos[0].rank = 17;
  rescored.record.build_ready.photo_bank.photos[0].grade = "gallery";
  rescored.record.build_ready.photo_bank.photos[0].current_hero = true;
  const outcomes = await Promise.all([
    h.queue.enqueueHeroReelJob(rescored, {
      actor: "full_run", producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "new_batch", rowId: "new_batch:0" }, reofferBuildHash: "a".repeat(64),
      expectedStaleJobSnapshot: snapshot,
    }),
    h.queue.enqueueHeroReelJob(rescored, {
      actor: "full_run", producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "new_batch", rowId: "new_batch:0" }, reofferBuildHash: "a".repeat(64),
      expectedStaleJobSnapshot: snapshot,
    }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.retried === true).length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.error === "retry_conflict").length, 1, "the losing poll cannot consume the one-shot counter");
  assert.equal(h.rows.length, 1, "recovery never creates another paid job");
  assert.equal(h.rows[0].status, "queued");
  assert.equal(h.rows[0].attempts, attemptsBeforeRecovery, "recovery preserves the bounded attempt count");
  assert.equal(h.rows[0].payload.generation_revision, 1, "the accepted provider identity remains valid");
  assert.equal(h.rows[0].payload.line_same_build_reoffer_count, 1);
  assert.deepEqual(h.rows[0].payload.line_handle, { batchId: "new_batch", rowId: "new_batch:0" });
  assert.deepEqual(h.rows[0].result.provider_checkpoint, checkpoint, "worker must poll the paid provider job, never submit again");
  const resumed = await h.queue.claimNextHeroReelJob({ workerId: "seedance-worker-2", producer: OPENROUTER_SEEDANCE_PRODUCER });
  assert.equal(resumed.job.generation_revision, 1);
  assert.equal(resumed.job.duration_seconds, 4);
  assert.equal(resumed.job.provider_checkpoint.duration_seconds, 4);
  assert.equal(resumed.job.provider_checkpoint.provider_job_id, "durable-recovery");
});

test("an accepted oversized Seedance clip resumes the paid checkpoint without a new generation", async () => {
  const h = memoryQueue();
  const created = await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
    reofferBuildHash: "a".repeat(64),
  });
  const claimed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const checkpoint = await persistAcceptedSeedanceCheckpoint(h, created.job_id, claimed.job.lease_token);
  const attemptsBeforeRecovery = h.rows[0].attempts;
  h.rows[0].status = "failed";
  h.rows[0].lease_token = null;
  h.rows[0].lease_owner = null;
  h.rows[0].lease_expires_at = null;
  h.rows[0].result = { ...h.rows[0].result, reason: "openrouter_clip_size_invalid" };

  const out = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "full_run",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "new_batch", rowId: "new_batch:0" },
    reofferBuildHash: "a".repeat(64),
    expectedStaleJobSnapshot: {
      job_id: created.job_id,
      status: "failed",
      revision: 1,
      line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
      lease_token: "",
      lease_owner: "",
      lease_expires_at: "",
    },
  });

  assert.equal(out.retried, true);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].status, "queued");
  assert.equal(h.rows[0].attempts, attemptsBeforeRecovery);
  assert.equal(h.rows[0].payload.generation_revision, 1);
  assert.equal(h.rows[0].payload.line_same_build_reoffer_count, 1);
  assert.deepEqual(h.rows[0].result.provider_checkpoint, checkpoint);
  const resumed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker-2",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(resumed.job.provider_checkpoint.submission_state, "accepted");
  assert.equal(resumed.job.provider_checkpoint.provider_job_id, "durable-recovery");
});

test("an accepted Seedance checkpoint does not reopen openrouter_submit_failed", async () => {
  const h = memoryQueue();
  const created = await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "old_batch", rowId: "old_batch:0" }, reofferBuildHash: "a".repeat(64),
  });
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "seedance-worker", producer: OPENROUTER_SEEDANCE_PRODUCER });
  const checkpoint = await persistAcceptedSeedanceCheckpoint(h, created.job_id, claimed.job.lease_token);
  h.rows[0].status = "failed";
  h.rows[0].lease_token = null;
  h.rows[0].lease_owner = null;
  h.rows[0].lease_expires_at = null;
  h.rows[0].result = { ...h.rows[0].result, reason: "openrouter_submit_failed" };
  const out = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "full_run", producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "new_batch", rowId: "new_batch:0" }, reofferBuildHash: "a".repeat(64),
    expectedStaleJobSnapshot: {
      job_id: created.job_id, status: "failed", revision: 1,
      line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
      lease_token: "", lease_owner: "", lease_expires_at: "",
    },
  });
  assert.equal(out.retried, undefined);
  assert.equal(h.rows[0].status, "failed");
  assert.equal(h.rows[0].payload.line_same_build_reoffer_count, undefined);
});

test("an explicit operator retry keeps the preexisting same-build foreign-handle recovery path", async () => {
  const h = memoryQueue();
  const created = await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
    reofferBuildHash: "a".repeat(64),
  });
  h.rows[0].status = "failed";
  h.rows[0].result = { reason: "operator_requested_retry" };
  const out = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "operator", retry: true, producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "new_batch", rowId: "new_batch:0" },
    reofferBuildHash: "a".repeat(64),
  });
  assert.equal(out.retried, true);
  assert.equal(out.job_id, created.job_id);
  assert.equal(h.rows[0].status, "queued");
  assert.equal(h.rows[0].payload.generation_revision, 2);
  assert.equal(h.rows[0].payload.line_same_build_reoffer_count, undefined);
  assert.deepEqual(h.rows[0].payload.line_handle, { batchId: "new_batch", rowId: "new_batch:0" });
});

test("a same-build recovery loses its first-win CAS when another recovery records the counter", async () => {
  let raced = false;
  const h = memoryQueue({
    beforeConditionalUpdate: (row) => {
      if (raced || row.status !== "refused") return;
      raced = true;
      row.payload.line_same_build_reoffer_count = 1;
    },
  });
  const created = await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
    reofferBuildHash: "a".repeat(64),
  });
  h.rows[0].status = "refused";
  h.rows[0].result = { reason: "source_sha256_mismatch" };
  const out = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "full_run", producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "new_batch", rowId: "new_batch:0" },
    reofferBuildHash: "a".repeat(64),
    expectedStaleJobSnapshot: {
      job_id: created.job_id, status: "refused", revision: 1,
      line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
      lease_token: "", lease_owner: "", lease_expires_at: "",
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "retry_conflict");
  assert.equal(h.rows[0].status, "refused");
  assert.equal(h.rows[0].payload.line_same_build_reoffer_count, 1);
});

test("automatic Line reoffer refuses partial leases and invalid identity changes", async () => {
  for (const leaseField of ["lease_token", "lease_owner", "lease_expires_at"]) {
    const h = memoryQueue();
    await h.queue.enqueueHeroReelJob(prospect(), {
      producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
    });
    h.rows[0].status = "refused";
    h.rows[0][leaseField] = leaseField === "lease_expires_at" ? "2026-08-21T21:00:00.000Z" : "occupied";
    const out = await h.queue.enqueueHeroReelJob(prospect(), {
      actor: "full_run",
      producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "new_batch", rowId: "new_batch:0" },
      reofferBuildHash: "b".repeat(64),
    });
    assert.equal(out.retried, undefined, leaseField);
    assert.equal(h.rows[0].status, "refused", leaseField);
  }

  for (const input of [
    { name: "missing hash", hash: "", handle: { batchId: "new_batch", rowId: "new_batch:0" } },
    { name: "invalid hash", hash: "bad", handle: { batchId: "new_batch", rowId: "new_batch:0" } },
    { name: "same handle", hash: "b".repeat(64), handle: { batchId: "old_batch", rowId: "old_batch:0" } },
  ]) {
    const h = memoryQueue();
    await h.queue.enqueueHeroReelJob(prospect(), {
      producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
    });
    h.rows[0].status = "refused";
    const out = await h.queue.enqueueHeroReelJob(prospect(), {
      actor: "full_run", producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: input.handle, reofferBuildHash: input.hash,
    });
    assert.equal(out.retried, undefined, input.name);
    assert.equal(h.rows[0].status, "refused", input.name);
  }
});

test("initial Line build hash persists and nonterminal jobs never reset for a new handle", async () => {
  const initial = memoryQueue();
  await initial.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "line_client", rowId: "line_client:0" },
    reofferBuildHash: "d".repeat(64),
  });
  assert.equal(initial.rows[0].payload.line_build_hash, "d".repeat(64));

  for (const status of ["running", "awaiting_review", "done"]) {
    const h = memoryQueue();
    await h.queue.enqueueHeroReelJob(prospect(), {
      producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
      reofferBuildHash: "d".repeat(64),
    });
    h.rows[0].status = status;
    const out = await h.queue.enqueueHeroReelJob(prospect(), {
      actor: "full_run", producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "new_batch", rowId: "new_batch:0" },
      reofferBuildHash: "e".repeat(64),
    });
    assert.equal(out.reused, true, status);
    assert.equal(h.rows[0].status, status);
    assert.equal(h.rows[0].payload.generation_revision, 1);
    assert.deepEqual(h.rows[0].payload.line_handle, { batchId: "old_batch", rowId: "old_batch:0" });
  }
});

test("automatic Line reoffer loses CAS when the snapshot changes", async () => {
  for (const drift of ["updated_at", "line_handle"]) {
    let mutated = false;
    const h = memoryQueue({
      beforeConditionalUpdate: (row) => {
        if (mutated || row.status !== "refused") return;
        mutated = true;
        if (drift === "updated_at") row.updated_at = "2026-08-21T20:00:01.000Z";
        else row.payload.line_handle = { batchId: "racing_batch", rowId: "racing_batch:0" };
      },
    });
    await h.queue.enqueueHeroReelJob(prospect(), {
      producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
    });
    h.rows[0].status = "refused";
    const out = await h.queue.enqueueHeroReelJob(prospect(), {
      actor: "full_run", producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "new_batch", rowId: "new_batch:0" },
      reofferBuildHash: "c".repeat(64),
    });
    assert.equal(out.ok, false, drift);
    assert.equal(out.error, "retry_conflict", drift);
    assert.equal(h.rows[0].status, "refused", drift);
  }
});

test("inspected stale snapshot loses atomically when revision and handle race before reset", async () => {
  let raced = false;
  const h = memoryQueue({
    beforeConditionalUpdate: (row) => {
      if (raced || row.status !== "refused") return;
      raced = true;
      row.payload.generation_revision = 5;
      row.payload.line_handle = { batchId: "line_client", rowId: "line_client:0" };
      row.updated_at = "2026-08-21T20:00:05.000Z";
    },
  });
  await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "old_batch", rowId: "old_batch:0" },
  });
  const jobId = h.rows[0].job_id;
  h.rows[0].status = "refused";
  h.rows[0].payload.generation_revision = 4;
  h.rows[0].result = { reason: "no_verified_owned_real_scene" };
  const out = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "full_run",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "new_batch", rowId: "new_batch:0" },
    reofferBuildHash: "f".repeat(64),
    expectedStaleJobSnapshot: {
      job_id: jobId,
      status: "refused",
      revision: 4,
      line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
      lease_token: "", lease_owner: "", lease_expires_at: "",
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "retry_conflict");
  assert.equal(h.rows[0].status, "refused");
  assert.equal(h.rows[0].payload.generation_revision, 5);
  assert.deepEqual(h.rows[0].payload.line_handle, { batchId: "line_client", rowId: "line_client:0" });
});

test("a disappeared inspected stale job cannot fall through to replacement insert", async () => {
  let inserts = 0;
  const h = memoryQueue({
    insertRow: async () => { inserts += 1; return { ok: true, rows: [] }; },
  });
  const out = await h.queue.enqueueHeroReelJob(prospect(), {
    actor: "full_run",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "new_batch", rowId: "new_batch:0" },
    reofferBuildHash: "f".repeat(64),
    expectedStaleJobSnapshot: {
      job_id: "hrj_deleted",
      status: "refused",
      revision: 4,
      line_handle: { batchId: "old_batch", rowId: "old_batch:0" },
      lease_token: "", lease_owner: "", lease_expires_at: "",
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "stale_job_snapshot_conflict");
  assert.equal(inserts, 0);
  assert.equal(h.rows.length, 0);
});

test("verified upload settles exactly one strict shared release proof", async (t) => {
  const lineHandle = { batchId: "line_client", rowId: "line_client:0" };
  async function run(receipt, { durableLineHandle = lineHandle } = {}) {
    const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
    const enqueued = await h.queue.enqueueHeroReelJob(prospect(), {
      ...(durableLineHandle ? { lineHandle: durableLineHandle } : {}),
    });
    const reviewClaim = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
    await approveHeldClip(h, enqueued.job_id, reviewClaim);
    const claimed = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
    const result = await h.queue.completeHeroReelJobAfterUpload({
      jobId: enqueued.job_id,
      leaseToken: claimed.job.lease_token,
      receipt,
    });
    return { h, result };
  }

  const accepted = await run(verifiedSharedUploadReceipt());
  assert.equal(accepted.result.ok, true, JSON.stringify(accepted.result));
  assert.equal(accepted.result.job.status, "done");
  assert.equal(Object.hasOwn(accepted.result.job.result.upload_receipt, "rebuild"), false);
  assert.equal(
    accepted.result.job.result.upload_receipt.shared_release.proof_identity.release_id,
    "33333333-3333-4333-8333-333333333333",
  );
  assert.deepEqual(
    accepted.result.job.result.upload_receipt.shared_release.line_handle,
    { batchId: "line_client", rowId: "line_client:0" },
  );

  const hostile = [
    ["both publication proofs", (receipt) => { receipt.rebuild = { job_id: "rebuild-1" }; }],
    ["neither publication proof", (receipt) => { delete receipt.shared_release; }],
    ["release tuple drift", (receipt) => { receipt.shared_release.release_evidence.release_id = "44444444-4444-4444-8444-444444444444"; }],
    ["hero SHA drift", (receipt) => { receipt.shared_release.hero_video_sha256 = "8".repeat(64); }],
    ["record write drift", (receipt) => { receipt.shared_release.record_write_id = "other-write"; }],
    ["invalid Line handle", (receipt) => { receipt.shared_release.line_handle.rowId = "bad row id"; }],
    ["valid but wrong Line handle", (receipt) => { receipt.shared_release.line_handle.rowId = "line_client:9"; }],
    ["missing receipt Line handle", (receipt) => { delete receipt.shared_release.line_handle; }],
  ];
  for (const [name, mutate] of hostile) {
    await t.test(name, async () => {
      const receipt = verifiedSharedUploadReceipt();
      mutate(receipt);
      const refused = await run(receipt);
      assert.deepEqual(refused.result, { ok: false, error: "verified_upload_receipt_invalid" });
      assert.equal(refused.h.rows[0].status, "running");
    });
  }
  await t.test("missing durable job Line handle", async () => {
    const refused = await run(verifiedSharedUploadReceipt(), { durableLineHandle: null });
    assert.deepEqual(refused.result, { ok: false, error: "verified_upload_receipt_invalid" });
    assert.equal(refused.h.rows[0].status, "running");
  });
});

test("a stale lease is recovered and its zombie cannot overwrite the winner", async () => {
  const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const workerA = await h.queue.claimNextHeroReelJob({ workerId: "worker-a", leaseMs: 30 * 60 * 1000 });
  h.advance(31 * 60 * 1000);
  const workerB = await h.queue.claimNextHeroReelJob({ workerId: "worker-b", leaseMs: 30 * 60 * 1000 });
  assert.equal(workerB.job.job_id, enqueued.job_id);
  assert.notEqual(workerB.job.lease_token, workerA.job.lease_token);

  const zombie = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "complete",
    leaseToken: workerA.job.lease_token,
    verdict: { ok: true, clip_sha256: "a".repeat(64) },
  });
  assert.equal(zombie.ok, false);
  assert.equal(zombie.error, "lease_conflict");

  await approveHeldClip(h, enqueued.job_id, workerB, "b".repeat(64));
  const winnerClaim = await h.queue.claimNextHeroReelJob({ workerId: "worker-b" });
  const staleWinnerLease = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "complete",
    leaseToken: workerB.job.lease_token,
    verdict: { ok: true, clip_sha256: "b".repeat(64) },
  });
  assert.equal(staleWinnerLease.ok, false);
  assert.equal(staleWinnerLease.error, "lease_conflict");

  const winner = await h.queue.completeHeroReelJobAfterUpload({
    jobId: enqueued.job_id,
    leaseToken: winnerClaim.job.lease_token,
    receipt: verifiedUploadReceipt("b".repeat(64)),
  });
  assert.equal(winner.ok, true);
  assert.equal(winner.job.status, "done");
  assert.equal(h.rows[0].result.clip_sha256, "b".repeat(64));
});

test("queued rows with expired stale lease tokens are claimable", async () => {
  const h = memoryQueue();
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  h.rows[0].lease_token = "stale_lease";
  h.rows[0].lease_owner = "worker-a";
  h.rows[0].lease_expires_at = "2026-08-21T19:59:00.000Z";

  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "worker-b" });
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  assert.equal(claimed.job.job_id, enqueued.job_id);
  assert.notEqual(claimed.job.lease_token, "stale_lease");
  assert.equal(h.rows[0].lease_owner, "worker-b");
});

test("queued rows with fresh lease tokens are not claimable", async () => {
  const h = memoryQueue();
  await h.queue.enqueueHeroReelJob(prospect());
  h.rows[0].lease_token = "live_lease";
  h.rows[0].lease_owner = "worker-a";
  h.rows[0].lease_expires_at = "2026-08-21T20:10:00.000Z";

  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "worker-b" });
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  assert.equal(claimed.job, null);
  assert.equal(h.rows[0].lease_token, "live_lease");
  assert.equal(h.rows[0].lease_owner, "worker-a");
});

test("requeue clears the lease and the next worker can claim it", async () => {
  const h = memoryQueue();
  await h.queue.enqueueHeroReelJob(prospect());
  const first = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
  const requeued = await h.queue.settleHeroReelJob({
    jobId: first.job.job_id,
    action: "requeue",
    leaseToken: first.job.lease_token,
    verdict: { reason: "clip_approval_required" },
  });
  assert.equal(requeued.ok, true);
  assert.equal(requeued.job.status, "queued");
  const second = await h.queue.claimNextHeroReelJob({ workerId: "worker-b" });
  assert.equal(second.job.job_id, first.job.job_id);
  assert.notEqual(second.job.lease_token, first.job.lease_token);
});

test("accepted-download requeue rotates behind fresh queued work", async () => {
  const h = memoryQueue();
  const poison = await h.queue.enqueueHeroReelJob(prospect("wss-test-poison"), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const first = await h.queue.claimNextHeroReelJob({
    workerId: "worker-a",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(first.job.job_id, poison.job_id);
  const checkpoint = await persistAcceptedSeedanceCheckpoint(h, poison.job_id, first.job.lease_token);
  h.advance(1_000);
  const fresh = await h.queue.enqueueHeroReelJob(prospect("wss-test-fresh"), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  h.advance(1_000);
  const requeued = await h.queue.settleHeroReelJob({
    jobId: first.job.job_id,
    action: "requeue",
    leaseToken: first.job.lease_token,
    verdict: {
      reason: "openrouter_download_failed",
      retry_without_generation: true,
      provider_checkpoint: checkpoint,
    },
  });
  assert.equal(requeued.ok, true);
  const poisonRow = h.rows.find((row) => row.job_id === poison.job_id);
  assert.equal(poisonRow.status, "queued");
  assert.equal(poisonRow.attempts, 1);
  assert.equal(poisonRow.result.retry_without_generation, true);
  assert.equal(poisonRow.result.provider_checkpoint.submission_state, "accepted");

  const next = await h.queue.claimNextHeroReelJob({
    workerId: "worker-b",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(next.job.job_id, fresh.job_id);
  assert.equal(h.rows.find((row) => row.job_id === fresh.job_id).attempts, 1);
  const finishedFresh = await h.queue.settleHeroReelJob({
    jobId: next.job.job_id,
    action: "fail",
    leaseToken: next.job.lease_token,
    verdict: { reason: "test_finished_fresh_job" },
  });
  assert.equal(finishedFresh.ok, true);
  const resumed = await h.queue.claimNextHeroReelJob({
    workerId: "worker-c",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(resumed.job.job_id, poison.job_id);
});

test("hold is not reclaimed until owner approval freezes the exact artifact", async () => {
  const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const reviewClaim = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
  const held = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: reviewClaim.job.lease_token,
    verdict: reviewVerdict(),
  });
  assert.equal(held.ok, true);
  assert.equal(held.job.status, "awaiting_review");
  assert.doesNotMatch(JSON.stringify(held.job), /approved_artifact|optimized_asset|CaseSensitive/);
  assert.equal((await h.queue.claimNextHeroReelJob({ workerId: "worker-b" })).job, null);

  const staleRevision = await h.queue.approveHeroReelJob({
    jobId: enqueued.job_id,
    clipSha256: CLIP_SHA,
    generationRevision: 2,
    approvedBy: "owner_console",
    approvedAt: "2026-08-21T20:06:00.000Z",
  });
  assert.equal(staleRevision.error, "approval_revision_mismatch");

  const mismatch = await h.queue.approveHeroReelJob({
    jobId: enqueued.job_id,
    clipSha256: "8".repeat(64),
    generationRevision: 1,
    approvedBy: "owner_console",
    approvedAt: "2026-08-21T20:06:00.000Z",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, "approval_sha_mismatch");

  const approved = await h.queue.approveHeroReelJob({
    jobId: enqueued.job_id,
    clipSha256: CLIP_SHA,
    generationRevision: 1,
    approvedBy: "owner_console",
    approvedAt: "2026-08-21T20:06:00.000Z",
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.job.result.generation_receipt.model_id, WAN_MODEL_ID);
  assert.deepEqual(Object.keys(h.rows[0].payload.approved_artifact).sort(), [
    "clip_sha256",
    "generation_receipt",
    "generator",
    "optimized_asset_fingerprint",
    "optimized_sha256",
    "producer",
    "prompt_sha256",
    "raw_sha256",
    "source_url",
  ]);
  assert.equal(h.rows[0].payload.approved_artifact.optimized_asset_fingerprint, OPTIMIZED_FINGERPRINT);
  assert.equal(h.rows[0].payload.approved_artifact.generation_receipt.model_revision, WAN_MODEL_REVISION);
  assert.equal(h.rows[0].payload.approved_artifact.generation_receipt.cost_usd, 0.002);
  assert.equal(h.rows[0].payload.optimized_asset.width, 1920);
  assert.equal(h.rows[0].payload.approved_clip.approved_at, "2026-08-21T20:00:00.000Z");

  const finalClaim = await h.queue.claimNextHeroReelJob({ workerId: "worker-b" });
  assert.equal(finalClaim.job.approved_artifact.optimized_asset_fingerprint, OPTIMIZED_FINGERPRINT);
  assert.equal(finalClaim.job.optimized_asset.height, 1080);
  assert.equal(finalClaim.job.approved_clip.approved, true);
  assert.equal(finalClaim.job.generation_revision, 1);
});

test("Ads jobs retain the existing Ads generator and remaster recipe contract", async () => {
  const h = memoryQueue();
  const enqueued = await h.queue.enqueueHeroReelJob(prospect(), { producer: ADS_PRODUCER });
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "ads-worker", producer: ADS_PRODUCER });
  const held = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict: reviewVerdict(CLIP_SHA, 1, { producer: ADS_PRODUCER }),
  });
  assert.equal(held.ok, true, JSON.stringify(held));
  assert.equal(h.rows[0].result.generator, "ads_animate_image");
  assert.equal(h.rows[0].result.approved_artifact.prompt_sha256, REMASTER_PROMPT_SHA256);
  assert.equal(h.rows[0].result.approved_artifact.image_preparation, "image_editor");
  assert.equal(h.rows[0].result.optimized_asset.image_preparation, "image_editor");
  assert.equal(h.rows[0].result.generation_receipt, undefined);
});

test("Ads direct-source reviews preserve the owned source receipt through owner approval", async () => {
  const h = memoryQueue();
  const enqueued = await h.queue.enqueueHeroReelJob(prospect(), { producer: ADS_PRODUCER });
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "ads-worker", producer: ADS_PRODUCER });
  const fingerprint = `direct-source:${SOURCE_SHA}`;
  const held = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict: reviewVerdict(CLIP_SHA, 1, {
      producer: ADS_PRODUCER,
      promptSha256: DIRECT_SOURCE_RECIPE_SHA256,
      optimizedSha256: SOURCE_SHA,
      optimizedAssetFingerprint: fingerprint,
    }),
  });

  assert.equal(held.ok, true, JSON.stringify(held));
  assert.deepEqual(h.rows[0].result.approved_artifact, {
    raw_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    clip_sha256: CLIP_SHA,
    optimized_sha256: SOURCE_SHA,
    optimized_asset_fingerprint: fingerprint,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    image_preparation: "direct_client_photo",
    producer: ADS_PRODUCER,
    generator: "ads_animate_image",
  });
  assert.deepEqual(h.rows[0].result.optimized_asset, {
    sha256: SOURCE_SHA,
    url_fingerprint: fingerprint,
    width: 1920,
    height: 1080,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    image_preparation: "direct_client_photo",
  });

  const approved = await h.queue.approveHeroReelJob({
    jobId: enqueued.job_id,
    clipSha256: CLIP_SHA,
    generationRevision: 1,
    approvedBy: "owner_console",
    approvedAt: "2026-08-21T20:06:00.000Z",
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const finalClaim = await h.queue.claimNextHeroReelJob({ workerId: "ads-worker-2", producer: ADS_PRODUCER });
  assert.equal(finalClaim.job.approved_artifact.raw_sha256, SOURCE_SHA);
  assert.equal(finalClaim.job.approved_artifact.source_url, SOURCE_URL);
  assert.equal(finalClaim.job.approved_artifact.image_preparation, "direct_client_photo");
  assert.equal(finalClaim.job.optimized_asset.url_fingerprint, fingerprint);
  assert.equal(finalClaim.job.optimized_asset.image_preparation, "direct_client_photo");
});

test("Ads direct-source markers fail closed unless recipe, raw SHA, and fingerprint all agree", async () => {
  const cases = [
    {
      name: "direct recipe with changed optimized bytes",
      options: {
        promptSha256: DIRECT_SOURCE_RECIPE_SHA256,
        optimizedSha256: OPTIMIZED_SHA,
        optimizedAssetFingerprint: `direct-source:${SOURCE_SHA}`,
      },
      error: "direct_source_receipt_mismatch",
    },
    {
      name: "direct fingerprint bound to another source",
      options: {
        promptSha256: DIRECT_SOURCE_RECIPE_SHA256,
        optimizedSha256: SOURCE_SHA,
        optimizedAssetFingerprint: `direct-source:${"e".repeat(64)}`,
      },
      error: "direct_source_receipt_mismatch",
    },
    {
      name: "direct artifact with a legacy canonical recipe",
      options: {
        promptSha256: DIRECT_SOURCE_RECIPE_SHA256,
        canonicalPromptSha256: REMASTER_PROMPT_SHA256,
        optimizedSha256: SOURCE_SHA,
        optimizedAssetFingerprint: `direct-source:${SOURCE_SHA}`,
      },
      error: "noncanonical_remaster_prompt",
    },
    {
      name: "direct artifact mislabeled as image-editor output",
      options: {
        promptSha256: DIRECT_SOURCE_RECIPE_SHA256,
        optimizedSha256: SOURCE_SHA,
        optimizedAssetFingerprint: `direct-source:${SOURCE_SHA}`,
        imagePreparation: "image_editor",
      },
      error: "image_preparation_mismatch",
    },
    {
      name: "legacy recipe reusing unchanged raw bytes",
      options: {
        promptSha256: REMASTER_PROMPT_SHA256,
        optimizedSha256: SOURCE_SHA,
        optimizedAssetFingerprint: OPTIMIZED_FINGERPRINT,
      },
      error: "optimized_asset_not_distinct",
    },
    {
      name: "direct marker smuggled into the legacy recipe",
      options: {
        promptSha256: REMASTER_PROMPT_SHA256,
        optimizedSha256: OPTIMIZED_SHA,
        optimizedAssetFingerprint: `direct-source:${SOURCE_SHA}`,
      },
      error: "noncanonical_remaster_prompt",
    },
  ];

  for (const item of cases) {
    const h = memoryQueue();
    const enqueued = await h.queue.enqueueHeroReelJob(prospect(), { producer: ADS_PRODUCER });
    const claimed = await h.queue.claimNextHeroReelJob({ workerId: "ads-worker", producer: ADS_PRODUCER });
    const verdict = reviewVerdict(CLIP_SHA, 1, { producer: ADS_PRODUCER, ...item.options });
    const refused = await h.queue.settleHeroReelJob({
      jobId: enqueued.job_id,
      action: "hold",
      leaseToken: claimed.job.lease_token,
      verdict,
    });
    assert.equal(refused.ok, false, item.name);
    assert.equal(refused.error, item.error, item.name);
    assert.equal(h.rows[0].status, "running", item.name);
  }
});

test("the Ads direct-source recipe does not weaken WAN receipt validation", async () => {
  const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "wan-worker", producer: WAN_PRODUCER });
  const verdict = reviewVerdict(CLIP_SHA, 1, {
    promptSha256: DIRECT_SOURCE_RECIPE_SHA256,
    optimizedSha256: SOURCE_SHA,
    optimizedAssetFingerprint: `direct-source:${SOURCE_SHA}`,
  });
  const refused = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "noncanonical_remaster_prompt");
  assert.equal(h.rows[0].status, "running");
});

test("a durable review manifest exposes safe metadata and owner approval selects one exact SHA", async () => {
  const h = memoryQueue();
  const secondSha = "5".repeat(64);
  const enqueued = await h.queue.enqueueHeroReelJob(prospect(), { producer: ADS_PRODUCER });
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "ads-worker", producer: ADS_PRODUCER });
  const verdict = reviewVerdict(CLIP_SHA, 1, { producer: ADS_PRODUCER });
  verdict.candidates = [
    reviewCandidate(verdict, CLIP_SHA, { clipPath: "C:\\private\\first.mp4" }),
    reviewCandidate(verdict, secondSha, { clip_path: "/tmp/private-second.mp4" }),
  ];

  const held = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict,
  });
  assert.equal(held.ok, true, JSON.stringify(held));
  assert.deepEqual(held.job.result.candidates.map((candidate) => candidate.sha256), [CLIP_SHA, secondSha]);
  assert.equal(held.job.result.candidates[0].approved_artifact, undefined);
  assert.doesNotMatch(JSON.stringify(held.job), /approved_artifact|candidate_set_sha256|private-second|private\\first/i);
  assert.equal(h.rows[0].result.candidates[1].approved_artifact.clip_sha256, secondSha);
  assert.match(h.rows[0].result.candidate_set_sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(h.rows[0].result.candidates), /clipPath|clip_path|private-second|private\\first/i);

  const unknown = await h.queue.approveHeroReelJob({
    jobId: enqueued.job_id,
    clipSha256: "6".repeat(64),
    generationRevision: 1,
    approvedBy: "owner_console",
    approvedAt: "2026-08-21T20:06:00.000Z",
  });
  assert.equal(unknown.error, "approval_sha_mismatch");

  const approved = await h.queue.approveHeroReelJob({
    jobId: enqueued.job_id,
    clipSha256: secondSha,
    generationRevision: 1,
    approvedBy: "owner_console",
    approvedAt: "2026-08-21T20:06:00.000Z",
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal(h.rows[0].payload.approved_clip.sha256, secondSha);
  assert.equal(h.rows[0].payload.approved_artifact.clip_sha256, secondSha);
  assert.equal(h.rows[0].result.clip_sha256, secondSha);
});

test("malformed or changed review candidates cannot become owner approval", async () => {
  const malformed = memoryQueue();
  const malformedJob = await malformed.queue.enqueueHeroReelJob(prospect(), { producer: ADS_PRODUCER });
  const malformedClaim = await malformed.queue.claimNextHeroReelJob({ workerId: "ads-worker", producer: ADS_PRODUCER });
  const malformedVerdict = reviewVerdict(CLIP_SHA, 1, { producer: ADS_PRODUCER });
  malformedVerdict.candidates = [reviewCandidate(malformedVerdict, CLIP_SHA, {
    approved_artifact: {
      ...reviewCandidate(malformedVerdict, CLIP_SHA).approved_artifact,
      clip_sha256: "7".repeat(64),
    },
  })];
  const refusedHold = await malformed.queue.settleHeroReelJob({
    jobId: malformedJob.job_id,
    action: "hold",
    leaseToken: malformedClaim.job.lease_token,
    verdict: malformedVerdict,
  });
  assert.equal(refusedHold.ok, false);
  assert.equal(refusedHold.error, "review_candidate_artifact_invalid");
  assert.equal(malformed.rows[0].status, "running");

  const tampered = memoryQueue();
  const secondSha = "5".repeat(64);
  const tamperedJob = await tampered.queue.enqueueHeroReelJob(prospect(), { producer: ADS_PRODUCER });
  const tamperedClaim = await tampered.queue.claimNextHeroReelJob({ workerId: "ads-worker", producer: ADS_PRODUCER });
  const tamperedVerdict = reviewVerdict(CLIP_SHA, 1, { producer: ADS_PRODUCER });
  tamperedVerdict.candidates = [
    reviewCandidate(tamperedVerdict, CLIP_SHA),
    reviewCandidate(tamperedVerdict, secondSha),
  ];
  const held = await tampered.queue.settleHeroReelJob({
    jobId: tamperedJob.job_id,
    action: "hold",
    leaseToken: tamperedClaim.job.lease_token,
    verdict: tamperedVerdict,
  });
  assert.equal(held.ok, true, JSON.stringify(held));
  tampered.rows[0].result.candidates[1].bytes += 1;
  const refusedApproval = await tampered.queue.approveHeroReelJob({
    jobId: tamperedJob.job_id,
    clipSha256: secondSha,
    generationRevision: 1,
    approvedBy: "owner_console",
    approvedAt: "2026-08-21T20:06:00.000Z",
  });
  assert.equal(refusedApproval.ok, false);
  assert.equal(refusedApproval.error, "approval_artifact_invalid");
  assert.equal(refusedApproval.detail, "review_candidate_set_mismatch");
  assert.equal(tampered.rows[0].status, "awaiting_review");
});

test("WAN hold rejects model, identity, telemetry, and unknown-fallback receipt drift", async () => {
  for (const [mutate, expected] of [
    [(verdict) => { verdict.generation_receipt.model.revision = "wrong"; }, "wan_generation_receipt_mismatch"],
    [(verdict) => { verdict.generation_receipt.source.prospect_id = "other"; }, "wan_generation_receipt_mismatch"],
    [(verdict) => { verdict.generation_receipt.metrics.wall_time_ms = -1; }, "wan_generation_telemetry_invalid"],
    [(verdict) => {
      verdict.generator = "ads_animate_image";
      verdict.prompt_sha256 = REMASTER_PROMPT_SHA256;
      verdict.canonical_recipe_sha256 = REMASTER_PROMPT_SHA256;
      verdict.optimized_asset.prompt_sha256 = REMASTER_PROMPT_SHA256;
      verdict.generation_receipt.generator = "ads_animate_image";
      verdict.generation_receipt.artifacts.recipe_sha256 = REMASTER_PROMPT_SHA256;
      verdict.generation_receipt.fallback = {
        used: true, from: WAN_PRODUCER, to: ADS_PRODUCER, reason: "truth_gate_failed",
      };
    }, "wan_fallback_receipt_invalid"],
  ]) {
    const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
    const enqueued = await h.queue.enqueueHeroReelJob(prospect());
    const claimed = await h.queue.claimNextHeroReelJob({ workerId: "wan-worker", producer: WAN_PRODUCER });
    const verdict = reviewVerdict();
    mutate(verdict);
    const refused = await h.queue.settleHeroReelJob({
      jobId: enqueued.job_id,
      action: "hold",
      leaseToken: claimed.job.lease_token,
      verdict,
    });
    assert.equal(refused.error, expected);
    assert.equal(h.rows[0].status, "running");
  }

  const unmarked = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const row = prospect();
  delete row.record.build_ready.photo_bank.photos[0].asset_type;
  const enqueued = await unmarked.queue.enqueueHeroReelJob(row);
  const claimed = await unmarked.queue.claimNextHeroReelJob({ workerId: "wan-worker", producer: WAN_PRODUCER });
  const verdict = reviewVerdict();
  const refused = await unmarked.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict,
  });
  assert.equal(refused.ok, true, "an otherwise proven untyped own-site scene is classified before worker settlement");
});

test("a tightly classified WAN technical fallback preserves actual Ads provenance and bounded telemetry", async () => {
  const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "wan-worker", producer: WAN_PRODUCER });
  const verdict = reviewVerdict(CLIP_SHA, 1, {
    generator: "ads_animate_image",
    promptSha256: REMASTER_PROMPT_SHA256,
    fallback: {
      used: true,
      from: WAN_PRODUCER,
      to: ADS_PRODUCER,
      reason: "python_executable_invalid",
    },
  });
  const held = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict,
  });
  assert.equal(held.ok, true, JSON.stringify(held));
  const receipt = h.rows[0].result.generation_receipt;
  assert.equal(h.rows[0].producer, WAN_PRODUCER);
  assert.equal(receipt.producer, WAN_PRODUCER);
  assert.equal(receipt.generator, "ads_animate_image");
  assert.equal(receipt.fallback_from, WAN_PRODUCER);
  assert.equal(receipt.fallback_to, ADS_PRODUCER);
  assert.equal(receipt.fallback_reason, "python_executable_invalid");
  assert.equal(receipt.recipe_sha256, REMASTER_PROMPT_SHA256);
  assert.doesNotMatch(JSON.stringify(receipt), /[A-Z]:\\|\/tmp\/|clip_path|source_path/i);
});

test("hold rejects a noncanonical prompt and malformed opaque fingerprint", async () => {
  const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
  const wrongPrompt = reviewVerdict();
  wrongPrompt.prompt_sha256 = "f".repeat(64);
  wrongPrompt.optimized_asset.prompt_sha256 = "f".repeat(64);
  const promptResult = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict: wrongPrompt,
  });
  assert.equal(promptResult.error, "noncanonical_remaster_prompt");

  const badFingerprint = reviewVerdict();
  badFingerprint.optimized_asset_fingerprint = "bad\nvalue";
  badFingerprint.optimized_asset.url_fingerprint = "bad\nvalue";
  const fingerprintResult = await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict: badFingerprint,
  });
  assert.equal(fingerprintResult.error, "invalid_optimized_asset_fingerprint");
  assert.equal(h.rows[0].status, "running");
});

test("owner can regenerate or reject a held clip without a worker lease", async () => {
  const h = memoryQueue({ env: { GHOST_AGENCY_WAN_PRIMARY: "1" } });
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const firstClaim = await h.queue.claimNextHeroReelJob({ workerId: "worker-a" });
  await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: firstClaim.job.lease_token,
    verdict: reviewVerdict(),
  });
  const regenerated = await h.queue.reviewHeroReelJob({
    jobId: enqueued.job_id,
    action: "regenerate",
    reason: "motion was not credible",
    reviewedBy: "owner_console",
  });
  assert.equal(regenerated.ok, true);
  assert.equal(regenerated.job.status, "queued");
  assert.equal(regenerated.job.result.previous_generation_receipt.model_revision, WAN_MODEL_REVISION);
  assert.equal(h.rows[0].payload.approved_artifact, undefined);
  assert.equal(h.rows[0].payload.review_history.at(-1).reason, "motion was not credible");

  const secondClaim = await h.queue.claimNextHeroReelJob({ workerId: "worker-b" });
  assert.equal(secondClaim.job.generation_revision, 2);
  await h.queue.settleHeroReelJob({
    jobId: enqueued.job_id,
    action: "hold",
    leaseToken: secondClaim.job.lease_token,
    verdict: reviewVerdict("4".repeat(64), 2),
  });
  const rejected = await h.queue.reviewHeroReelJob({
    jobId: enqueued.job_id,
    action: "reject",
    reason: "wrong motion for this business",
    reviewedBy: "owner_console",
  });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.job.status, "refused");
  assert.equal(h.rows[0].finished_at, "2026-08-21T20:00:00.000Z");
});

test("HTTP claim and settlement carry worker identity and the exact lease token", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin";
  process.env.GHOST_AGENCY_HERO_WORKER_TOKEN = "test-worker";
  const calls = { claims: [], renewals: [], checkpoints: [], settlements: [] };
  const handler = createHeroReelHandler({
    claimNextHeroReelJob: async (input) => {
      calls.claims.push(input);
      return {
        ok: true,
        job: {
          job_id: "hrj_http",
          prospect_id: "wss-test-acme",
          status: "running",
          lease_token: "lease_http",
          lease_expires_at: "2026-08-21T21:00:00.000Z",
          photo_bank: { photos: [] },
        },
      };
    },
    settleHeroReelJob: async (input) => {
      calls.settlements.push(input);
      return input.leaseToken === "lease_http"
        ? { ok: true, job: { job_id: input.jobId, status: "refused" } }
        : { ok: false, error: "lease_conflict", status: "running" };
    },
    renewHeroReelJobLease: async (input) => {
      calls.renewals.push(input);
      return {
        ok: true,
        reused: false,
        job: { job_id: input.jobId, status: "running" },
        lease_expires_at: "2026-08-21T21:30:00.000Z",
      };
    },
    checkpointHeroReelJob: async (input) => {
      calls.checkpoints.push(input);
      return { ok: true, reused: false, checkpoint: input.checkpoint };
    },
  });

  const claimed = httpRes();
  await handler(httpReq({
    method: "GET",
    url: "/api/admin/hero-reel?next=1&worker_id=desktop-1",
    headers: { "x-ghost-hero-worker-token": "test-worker" },
  }), claimed);
  assert.equal(claimed.captured.status, 200);
  assert.equal(claimed.captured.body.job.lease_token, "lease_http");
  assert.deepEqual(calls.claims, [{ workerId: "desktop-1", producer: "ads_image_to_video" }]);

  const heartbeat = httpRes();
  await handler(httpReq({ headers: { "x-ghost-hero-worker-token": "test-worker" }, body: {
    job_id: "hrj_http",
    action: "renew",
    lease_token: "lease_http",
    worker_id: "desktop-1",
    lease_ms: 1800000,
  } }), heartbeat);
  assert.equal(heartbeat.captured.status, 200);
  assert.equal(heartbeat.captured.body.lease_expires_at, "2026-08-21T21:30:00.000Z");
  assert.deepEqual(calls.renewals, [{
    jobId: "hrj_http",
    leaseToken: "lease_http",
    workerId: "desktop-1",
    leaseMs: 1800000,
  }]);

  const durableCheckpoint = { schema_version: "wss.hero.seedance_provider_checkpoint.v1", submission_state: "intent" };
  const checkpointed = httpRes();
  await handler(httpReq({ headers: { "x-ghost-hero-worker-token": "test-worker" }, body: {
    job_id: "hrj_http",
    action: "checkpoint",
    lease_token: "lease_http",
    checkpoint: durableCheckpoint,
  } }), checkpointed);
  assert.equal(checkpointed.captured.status, 200);
  assert.deepEqual(calls.checkpoints, [{
    jobId: "hrj_http",
    leaseToken: "lease_http",
    checkpoint: durableCheckpoint,
  }]);

  const settled = httpRes();
  await handler(httpReq({ headers: { "x-ghost-hero-worker-token": "test-worker" }, body: {
    job_id: "hrj_http",
    action: "refuse",
    lease_token: "lease_http",
    verdict: { reason: "no_owned_photo" },
  } }), settled);
  assert.equal(settled.captured.status, 200);
  assert.deepEqual(calls.settlements[0], {
    jobId: "hrj_http",
    action: "refuse",
    leaseToken: "lease_http",
    verdict: { reason: "no_owned_photo" },
  });

  const zombie = httpRes();
  await handler(httpReq({ headers: { "x-ghost-hero-worker-token": "test-worker" }, body: {
    job_id: "hrj_http", action: "complete", lease_token: "stale", verdict: { ok: true },
  } }), zombie);
  assert.equal(zombie.captured.status, 409);
  assert.equal(zombie.captured.body.error, "lease_conflict");
});

test("HTTP worker credential cannot approve/review and admin credential cannot claim or renew", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin";
  process.env.GHOST_AGENCY_HERO_WORKER_TOKEN = "test-worker";
  const calls = { approvals: [], reviews: [], claims: [], renewals: [] };
  const handler = createHeroReelHandler({
    approveHeroReelJob: async (input) => {
      calls.approvals.push(input);
      return { ok: true, job: { job_id: input.jobId, status: "queued" } };
    },
    reviewHeroReelJob: async (input) => {
      calls.reviews.push(input);
      return { ok: true, job: { job_id: input.jobId, status: input.action === "reject" ? "refused" : "queued" } };
    },
    claimNextHeroReelJob: async (input) => {
      calls.claims.push(input);
      return { ok: true, job: null };
    },
    renewHeroReelJobLease: async (input) => {
      calls.renewals.push(input);
      return { ok: true, lease_expires_at: "2026-08-21T21:30:00.000Z" };
    },
  });

  const workerApproval = httpRes();
  await handler(httpReq({ headers: { "x-ghost-hero-worker-token": "test-worker" }, body: {
    job_id: "hrj_http",
    action: "approve",
    clip_sha256: CLIP_SHA,
    generation_revision: 1,
    approved_by: "worker",
    approved_at: "2026-08-21T20:06:00.000Z",
  } }), workerApproval);
  assert.equal(workerApproval.captured.status, 401);
  assert.equal(calls.approvals.length, 0);

  const adminApproval = httpRes();
  await handler(httpReq({ headers: { authorization: "Bearer test-admin" }, body: {
    job_id: "hrj_http",
    action: "approve",
    clip_sha256: CLIP_SHA,
    generation_revision: 1,
    approved_by: "owner_console",
    approved_at: "2026-08-21T20:06:00.000Z",
  } }), adminApproval);
  assert.equal(adminApproval.captured.status, 200);
  assert.equal(calls.approvals.length, 1);
  assert.equal(calls.approvals[0].leaseToken, undefined);

  const workerRegenerate = httpRes();
  await handler(httpReq({ headers: { "x-ghost-hero-worker-token": "test-worker" }, body: {
    job_id: "hrj_http", action: "regenerate", reason: "bad", reviewed_by: "worker",
  } }), workerRegenerate);
  assert.equal(workerRegenerate.captured.status, 401);
  assert.equal(calls.reviews.length, 0);

  const adminClaim = httpRes();
  await handler(httpReq({
    method: "GET",
    url: "/api/admin/hero-reel?next=1&worker_id=desktop-1",
    headers: { authorization: "Bearer test-admin" },
  }), adminClaim);
  assert.equal(adminClaim.captured.status, 401);
  assert.equal(calls.claims.length, 0);

  const adminSettlement = httpRes();
  await handler(httpReq({ headers: { authorization: "Bearer test-admin" }, body: {
    job_id: "hrj_http", action: "refuse", lease_token: "lease_http", verdict: { reason: "bad" },
  } }), adminSettlement);
  assert.equal(adminSettlement.captured.status, 401);

  const adminRenew = httpRes();
  await handler(httpReq({ headers: { authorization: "Bearer test-admin" }, body: {
    job_id: "hrj_http",
    action: "renew",
    lease_token: "lease_http",
    worker_id: "desktop-1",
  } }), adminRenew);
  assert.equal(adminRenew.captured.status, 401);
  assert.equal(calls.renewals.length, 0);
});

test("unauthenticated POST is rejected before any request body listener is attached", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin";
  process.env.GHOST_AGENCY_HERO_WORKER_TOKEN = "test-worker";
  const handler = createHeroReelHandler();
  const req = httpReq({ body: { prospect_id: "wss-test-acme" } });
  let listeners = 0;
  req.on = () => { listeners++; return req; };
  const res = httpRes();
  await handler(req, res);
  assert.equal(res.captured.status, 401);
  assert.equal(listeners, 0);
});

test("lease validation binds job, token, prospect, and expiry; public output strips nested secrets", async () => {
  const h = memoryQueue();
  const enqueued = await h.queue.enqueueHeroReelJob(prospect());
  const claimed = await h.queue.claimNextHeroReelJob({ workerId: "worker-a", leaseMs: 30 * 60 * 1000 });
  assert.equal((await h.queue.validateHeroReelJobLease({
    jobId: enqueued.job_id,
    leaseToken: claimed.job.lease_token,
    prospectId: "wss-test-acme",
  })).ok, true);
  assert.equal((await h.queue.validateHeroReelJobLease({
    jobId: enqueued.job_id, leaseToken: "wrong", prospectId: "wss-test-acme",
  })).error, "lease_conflict");
  assert.equal((await h.queue.validateHeroReelJobLease({
    jobId: enqueued.job_id, leaseToken: claimed.job.lease_token, prospectId: "other-prospect",
  })).error, "lease_conflict");
  h.advance(31 * 60 * 1000);
  assert.equal((await h.queue.validateHeroReelJobLease({
    jobId: enqueued.job_id,
    leaseToken: claimed.job.lease_token,
    prospectId: "wss-test-acme",
  })).error, "lease_conflict");

  const shown = jobs.publicJob({
    jobId: "hrj_secret",
    prospectId: "wss-test-acme",
    producer: "ads_image_to_video",
    status: "done",
    attempts: 1,
    payload: {},
    result: {
      ok: true,
      lease_token: "must-not-leak",
      nested: { leaseToken: "also-secret", settled_by_lease: "secret" },
    },
  });
  assert.doesNotMatch(JSON.stringify(shown), /must-not-leak|also-secret|settled_by_lease|lease_token|leaseToken/);
});

function httpReq({ method = "POST", url = "/api/admin/hero-reel", body = {}, headers = {} } = {}) {
  const json = JSON.stringify(body);
  return {
    method,
    url,
    headers: { "content-type": "application/json", ...headers },
    on(event, cb) {
      if (event === "data") cb(Buffer.from(json));
      if (event === "end") cb();
      return this;
    },
    setEncoding() { return this; },
  };
}

function httpRes() {
  const captured = { status: 0, body: null };
  return {
    captured,
    statusCode: 200,
    setHeader() {},
    writeHead(code) { this.statusCode = code; return this; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(String(body));
    },
  };
}

// THE STATION SOURCES ITS OWN IMAGES (owner-measured 2026-08-23). Every live
// prospect was refused `photo_bank_stale_or_missing` even though its legacy site
// was perfectly scannable — the queue was gating the Google Ads AI Station on a
// harvested bank the Station never reads. It scans the client's own website (and
// the socials it finds there) inside the picker. The legacy URL IS the input.
test("the ads Station enqueues on a legacy URL alone, with no photo bank", async () => {
  const h = memoryQueue();
  const row = prospect();
  delete row.record.build_ready.photo_bank; // nothing harvested — the real case
  const result = await h.queue.enqueueHeroReelJob(row);
  assert.equal(result.ok, true, "a scannable legacy site is sufficient for the Station");
  assert.equal(h.rows.length, 1, "the job is durably enqueued");
});

// ...but the bypass is narrow ON PURPOSE. "We have no photos" is relaxed;
// "our photos did not check out" is not, on any lane. A declared-but-invalid
// bank is a defect in our own harvest and still refuses.
test("a declared but unverifiable bank still refuses, even on the Station lane", async () => {
  const h = memoryQueue({ insertRow: async () => { throw new Error("must not insert"); } });
  const row = prospect();
  row.record.build_ready.photo_bank.photos[0].sha256 = "not-a-sha";
  const result = await h.queue.enqueueHeroReelJob(row);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_verified_owned_photo");
});

// And with no legacy site there is nothing to scan, so the Station cannot run
// regardless of producer — that refusal predates and survives this change.
test("no legacy site refuses even for the Station", async () => {
  const h = memoryQueue();
  const row = prospect();
  delete row.record.build_ready.photo_bank;
  delete row.record.current_website;
  const result = await h.queue.enqueueHeroReelJob(row);
  assert.equal(result.ok, false, "nothing to scan is still a refusal");
});
test("a recovered portrait Seedance clip settles to awaiting_review while other producers stay landscape-only", async () => {
  // PR #475 widened the Seedance generation gate (hero-seedance-runner) to
  // 0.5–4.0 so a recovered clip_dimensions_out_of_range job can re-validate its
  // already-paid portrait clip. The settlement gate must agree, or the worker
  // stages the clip and then can never hold it — the job churns in `running`
  // forever with the one-shot reoffer counter already spent.
  const h = memoryQueue();
  const queued = await h.queue.enqueueHeroReelJob(prospect(), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const claimed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  const generationReceipt = {
    schema_version: "wss.hero.seedance_generation_receipt.v1",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    prospect_id: "wss-test-acme",
    domain: "acme.example.com",
    source_type: "own_site",
    source_asset_type: "real_scene",
    source_sha256: SOURCE_SHA,
    raw_sha256: SOURCE_SHA,
    optimized_sha256: SOURCE_SHA,
    clip_sha256: CLIP_SHA,
    recipe_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    model_id: "bytedance/seedance-2.0-mini",
    duration_seconds: 8,
    generate_audio: false,
    wall_time_ms: 30000,
    generation_time_ms: 28000,
    cost_usd: 0.12,
  };
  const artifact = {
    raw_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    clip_sha256: CLIP_SHA,
    optimized_sha256: SOURCE_SHA,
    optimized_asset_fingerprint: `direct-source:${SOURCE_SHA}`,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    image_preparation: "direct_client_photo",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    generation_receipt: generationReceipt,
  };
  const verdict = (width, height) => ({
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    generation_revision: 1,
    source_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    clip_sha256: CLIP_SHA,
    optimized_sha256: SOURCE_SHA,
    optimized_asset_fingerprint: `direct-source:${SOURCE_SHA}`,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    canonical_recipe_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    image_preparation: "direct_client_photo",
    optimized_asset: {
      sha256: SOURCE_SHA,
      url_fingerprint: `direct-source:${SOURCE_SHA}`,
      width: 1920,
      height: 1080,
      prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
      image_preparation: "direct_client_photo",
    },
    approved_artifact: artifact,
    generation_receipt: generationReceipt,
    candidates: [{
      sha256: CLIP_SHA,
      bytes: 900000,
      durationSeconds: 8,
      width,
      height,
      codec: "avc1",
      approved_artifact: artifact,
    }],
  });

  const portrait = await h.queue.settleHeroReelJob({
    jobId: queued.job_id,
    action: "hold",
    leaseToken: claimed.job.lease_token,
    verdict: verdict(720, 1280),
  });
  assert.equal(portrait.ok, true, JSON.stringify(portrait));
  assert.equal(portrait.job.status, "awaiting_review");
  assert.equal(portrait.job.result.candidates[0].width, 720);
  assert.equal(portrait.job.result.candidates[0].height, 1280);

  const approved = await h.queue.approveHeroReelJob({
    jobId: queued.job_id,
    clipSha256: CLIP_SHA,
    generationRevision: 1,
    approvedBy: "factory_verified",
    approvedAt: "2026-08-27T20:06:00.000Z",
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));

  // A non-Seedance candidate outside the historical 1.4–2.5 landscape band is
  // still rejected: the widening is the Seedance exemption and nothing else.
  const wanJob = await h.queue.enqueueHeroReelJob(prospect("wss-test-acme-2"), {
    producer: WAN_PRODUCER,
    vertical: "plumbing",
  });
  assert.equal(wanJob.ok, true, JSON.stringify(wanJob));
  const wanClaimed = await h.queue.claimNextHeroReelJob({
    workerId: "wan-worker",
    producer: WAN_PRODUCER,
  });
  assert.equal(wanClaimed.job?.job_id, wanJob.job_id, JSON.stringify(wanClaimed));
  const wanReceipt = {
    schema_version: "wss.hero_generation_receipt.v1",
    producer: WAN_PRODUCER,
    generator: WAN_PRODUCER,
    prospect_id: "wss-test-acme-2",
    domain: "acme.example.com",
    source_type: "own_site",
    source_asset_type: "real_scene",
    source_sha256: SOURCE_SHA,
    raw_sha256: SOURCE_SHA,
    optimized_sha256: OPTIMIZED_SHA,
    master_sha256: MASTER_SHA,
    clip_sha256: CLIP_SHA,
    recipe_sha256: WAN_REMASTER_RECIPE_SHA256,
    model_id: WAN_MODEL_ID,
    model_revision: WAN_MODEL_REVISION,
    model_settings: wanClaimed.job.wan.modelSettings,
    wall_time_ms: 30000,
    generation_time_ms: 28000,
    estimated_power_watts: 300,
    energy_kwh: 0.01,
    electricity_rate_usd_per_kwh: 0.2,
    cost_usd: 0.01,
  };
  const wanVerdict = {
    producer: WAN_PRODUCER,
    generator: WAN_PRODUCER,
    generation_revision: 1,
    source_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    clip_sha256: CLIP_SHA,
    optimized_sha256: OPTIMIZED_SHA,
    prompt_sha256: WAN_REMASTER_RECIPE_SHA256,
    canonical_recipe_sha256: WAN_REMASTER_RECIPE_SHA256,
    optimized_asset: {
      sha256: OPTIMIZED_SHA,
      url_fingerprint: OPTIMIZED_FINGERPRINT,
      width: 1920,
      height: 1080,
      prompt_sha256: WAN_REMASTER_RECIPE_SHA256,
    },
    approved_artifact: {
      raw_sha256: SOURCE_SHA,
      source_url: SOURCE_URL,
      clip_sha256: CLIP_SHA,
      optimized_sha256: OPTIMIZED_SHA,
      optimized_asset_fingerprint: OPTIMIZED_FINGERPRINT,
      prompt_sha256: WAN_REMASTER_RECIPE_SHA256,
      producer: WAN_PRODUCER,
      generator: WAN_PRODUCER,
      generation_receipt: wanReceipt,
    },
    generation_receipt: wanReceipt,
    candidates: [{
      sha256: CLIP_SHA,
      bytes: 900000,
      durationSeconds: 8,
      width: 720,
      height: 1280,
      codec: "avc1",
    }],
  };
  const wanHeld = await h.queue.settleHeroReelJob({
    jobId: wanJob.job_id,
    action: "hold",
    leaseToken: wanClaimed.job.lease_token,
    verdict: wanVerdict,
  });
  assert.equal(wanHeld.ok, false);
  assert.equal(wanHeld.error, "review_candidate_invalid");
});

test("a deep dead-parent backlog cannot starve a live batch's hero claim", async () => {
  // Live 2026-08-29: the queued scan (FIFO, limit 25) was filled entirely by
  // queued jobs from halted campaigns, so the building batch's freshly queued
  // hero never entered the window and every worker wave errored
  // parent_line_batch_halted for two hours. The scan must reach past any
  // realistic dead-cohort backlog.
  let halted = true;
  const h = memoryQueue({
    parentBatchStatus: async (batchId) => ({ ok: true, halted: batchId === "line_dead" && halted }),
  });
  let queued = 0;
  for (let i = 0; i < 45; i += 1) {
    const dead = await h.queue.enqueueHeroReelJob(prospect(`wss-test-dead-${i}`), {
      producer: OPENROUTER_SEEDANCE_PRODUCER,
      lineHandle: { batchId: "line_dead", rowId: `row_dead_${i}` },
    });
    assert.equal(dead.ok, true);
    queued += 1;
  }
  const live = await h.queue.enqueueHeroReelJob(prospect("wss-test-live-tail"), {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    lineHandle: { batchId: "line_live", rowId: "row_live" },
  });
  assert.equal(live.ok, true);
  assert.equal(queued, 45);

  const claimed = await h.queue.claimNextHeroReelJob({
    workerId: "seedance-worker",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  assert.equal(claimed.job.job_id, live.job_id, "the live job behind 45 dead-parent jobs must be reached");
  assert.deepEqual(claimed.job.line_handle, { batchId: "line_live", rowId: "row_live" });
  const deadRow = h.rows.find((row) => row.job_id === h.rows[0].job_id);
  assert.equal(deadRow.status, "queued", "dead-parent jobs stay queued and untouched");
});
