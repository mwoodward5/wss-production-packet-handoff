"use strict";

// Producer-dispatch tests keep every API, browser, model, and upload edge
// injected. No provider or WAN model is invoked by this file.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const workerModule = require("../scripts/ads-station/hero-forge-worker.cjs");
const { REMASTER_PROMPT_SHA256 } = require("../lib/hero-clip-validation");
const {
  ADS_PRODUCER,
  WAN_PRODUCER,
} = require("../lib/hero-video-policy");
const {
  WAN_MODEL_ID,
  WAN_MODEL_REVISION,
  WAN_REMASTER_RECIPE_SHA256,
} = require("../lib/wan-hero-policy");

const RAW = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const RAW_SHA = workerModule.sha256Hex(RAW);
const box = (type, payload) => {
  const bytes = Buffer.alloc(8 + payload.length);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write(type, 4, 4, "ascii");
  payload.copy(bytes, 8);
  return bytes;
};
const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isomavc1", "latin1"));
const mvhd = Buffer.alloc(20);
mvhd.writeUInt32BE(1000, 12);
mvhd.writeUInt32BE(4000, 16);
const tkhd = Buffer.alloc(8);
tkhd.writeUInt32BE(1280 * 65536, 0);
tkhd.writeUInt32BE(720 * 65536, 4);
const hdlr = Buffer.alloc(12);
hdlr.write("vide", 8, 4, "ascii");
const stsd = Buffer.concat([Buffer.alloc(8), box("avc1", Buffer.alloc(0))]);
stsd.writeUInt32BE(1, 4);
const moov = box("moov", Buffer.concat([
  box("mvhd", mvhd),
  box("trak", Buffer.concat([
    box("tkhd", tkhd),
    box("mdia", Buffer.concat([
      box("hdlr", hdlr),
      box("minf", box("stbl", box("stsd", stsd))),
    ])),
  ])),
]));
const CLIP = Buffer.concat([ftyp, moov, box("mdat", Buffer.from("wan-worker-review"))]);
const CLIP_SHA = workerModule.sha256Hex(CLIP);
const OPTIMIZED_SHA = "b".repeat(64);
const MASTER_SHA = "d".repeat(64);
const SOURCE_URL = "https://acme.example.com/work/job.jpg";

function wanLease(overrides = {}) {
  return {
    job_id: "hrj_wan_worker",
    lease_token: "lease_wan_worker",
    producer: WAN_PRODUCER,
    prospect_id: "wss-test-acme",
    business_name: "Acme Plumbing",
    source_url: "https://acme.example.com/",
    vertical: "plumbing",
    source_asset_type: "real_scene",
    overlay_side: "left",
    photo_bank: {
      photos: [{
        url: SOURCE_URL,
        sha256: RAW_SHA,
        source: "own_site",
        found_on: "https://acme.example.com/gallery",
        asset_type: "real_scene",
        width: 1920,
        height: 1080,
        bytes: RAW.length,
        grade: "hero",
      }],
    },
    ...overrides,
  };
}

function harness(t, overrides = {}) {
  const calls = {
    ads: [],
    wan: [],
    settled: [],
    renewed: [],
    persisted: [],
    upload: [],
    download: [],
  };
  const dirs = [];
  const env = overrides.env || {};
  const config = { reviewDir: os.tmpdir(), workerToken: "wan-worker-token", ...(overrides.config || {}) };
  const worker = workerModule.createWorker({
    env,
    config,
    selector: (items) => ({ best: items[0] || null }),
    apiImpl: async (pathname, request = {}) => {
      assert.equal(pathname, "/api/admin/hero-reel");
      const body = JSON.parse(request.body);
      if (body.action === "renew") {
        calls.renewed.push(body);
        return { ok: true, status: 200, body: { ok: true, lease_expires_at: "2099-01-01T00:00:00.000Z" } };
      }
      calls.settled.push(body);
      return { ok: true, status: 200, body: { ok: true } };
    },
    makeWorkDir: async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hero-wan-worker-test-"));
      dirs.push(directory);
      return directory;
    },
    downloadImpl: async (candidate, directory) => {
      calls.download.push(candidate);
      const filePath = path.join(directory, "source-raw.jpg");
      fs.writeFileSync(filePath, RAW);
      return { filePath, bytes: RAW.length, sha256: candidate.sha256, ext: ".jpg" };
    },
    adsRunnerImpl: async (jobFile, job) => {
      calls.ads.push({ jobFile, job });
      return { verdict: { ok: false, reason: "unexpected_ads_runner" } };
    },
    wanRunnerImpl: async (jobFile, job) => {
      calls.wan.push({ jobFile, job });
      return { ok: false, reason: "unexpected_wan_runner" };
    },
    persistReviewImpl: async (job, verdict) => {
      calls.persisted.push({ job, verdict });
      return { saved: true, path: verdict.review.clipPath, sha256: verdict.review.sha256, bytes: CLIP.length };
    },
    uploadImpl: async (...args) => {
      calls.upload.push(args);
      return { ok: true, terminal: true, url: "https://assets.example.com/wan-hero.mp4", rebuild_queued: true };
    },
    cleanupImpl: async (directory) => fs.rmSync(directory, { recursive: true, force: true }),
    ...overrides,
    env,
    config,
  });
  t.after(() => {
    for (const directory of dirs) fs.rmSync(directory, { recursive: true, force: true });
  });
  return { worker, calls };
}

function successfulWanResult(job) {
  const output = path.join(job.outputDirectory, "fixture-cache");
  fs.mkdirSync(output, { recursive: true });
  const optimizedPath = path.join(output, "optimized-source.jpg");
  const masterPath = path.join(output, "wan-master.mp4");
  const clipPath = path.join(output, "hero-browser.mp4");
  fs.writeFileSync(optimizedPath, Buffer.from("optimized"));
  fs.writeFileSync(masterPath, CLIP);
  fs.writeFileSync(clipPath, CLIP);
  return {
    ok: true,
    schemaVersion: "wss.wan_i2v_runner_result.v1",
    sourceIdentity: {
      prospectId: job.prospectId,
      domain: job.domain,
      type: job.sourceType,
      assetType: job.sourceAssetType,
      sha256: RAW_SHA,
    },
    model: {
      id: job.modelId,
      revision: job.modelRevision,
      settings: job.modelSettings,
    },
    artifacts: {
      raw: { sha256: RAW_SHA, bytes: RAW.length, width: 1920, height: 1080 },
      optimized: {
        path: optimizedPath,
        sha256: OPTIMIZED_SHA,
        bytes: 1000,
        width: 832,
        height: 480,
        promptSha256: WAN_REMASTER_RECIPE_SHA256,
        recipeSha256: WAN_REMASTER_RECIPE_SHA256,
      },
      masterVideo: { path: masterPath, sha256: MASTER_SHA, bytes: CLIP.length, width: 832, height: 480 },
      browserVideo: { path: clipPath, sha256: CLIP_SHA, bytes: CLIP.length, width: 832, height: 480 },
    },
    metrics: {
      wallTimeMs: 123456,
      generationTimeMs: 120000,
      energy: {
        method: "configured_power_estimate",
        estimatedPowerWatts: 500,
        estimatedKwh: 0.01714667,
        gpuTelemetry: {
          samples: 20,
          avgPowerWatts: 410,
          peakPowerWatts: 505,
          energyKwh: 0.013667,
          peakVramMiB: 22340,
        },
      },
      electricityRateUsdPerKwh: 0.2,
      estimatedElectricityCostUsd: 0.003429,
    },
    sideEffects: { providerCalls: 0, fetches: 0, uploads: 0, databaseWrites: 0, emails: 0 },
  };
}

function adsAwaitingReview(job) {
  const clipPath = path.join(job.outDir, "ads-fallback.mp4");
  fs.writeFileSync(clipPath, CLIP);
  return { verdict: {
    ok: false,
    status: "awaiting_review",
    review: { clipPath, sha256: CLIP_SHA, bytes: CLIP.length },
    remaster: {
      optimizedSha256: OPTIMIZED_SHA,
      assetIdentity: {
        urlFingerprint: "googleusercontent.example/optimized/fallback",
        width: 1280,
        height: 720,
      },
      promptSha256: REMASTER_PROMPT_SHA256,
    },
  } };
}

test("WAN success maps exact provenance and measured metrics into the owner-review hold", async (t) => {
  const h = harness(t, {
    wanRunnerImpl: async (jobFile, job) => {
      h.calls.wan.push({ jobFile, job });
      return successfulWanResult(job);
    },
  });
  const result = await h.worker.processJob(wanLease());
  assert.equal(result.status, "awaiting_review");
  assert.equal(h.calls.wan.length, 1);
  assert.equal(h.calls.ads.length, 0);
  assert.equal(h.calls.wan[0].job.producer, WAN_PRODUCER);
  assert.equal(h.calls.wan[0].job.sourceAssetType, "real_scene");
  assert.equal(h.calls.wan[0].job.modelId, WAN_MODEL_ID);
  assert.equal(h.calls.settled.length, 1);
  const held = h.calls.settled[0];
  assert.equal(held.job_id, "hrj_wan_worker");
  assert.equal(held.lease_token, "lease_wan_worker");
  assert.equal(held.action, "hold");
  assert.equal(held.verdict.producer, WAN_PRODUCER);
  assert.equal(held.verdict.generator, WAN_PRODUCER);
  assert.equal(held.verdict.raw_sha256, RAW_SHA);
  assert.equal(held.verdict.optimized_sha256, OPTIMIZED_SHA);
  assert.equal(held.verdict.master_sha256, MASTER_SHA);
  assert.equal(held.verdict.clip_sha256, CLIP_SHA);
  assert.equal(held.verdict.canonical_recipe_sha256, WAN_REMASTER_RECIPE_SHA256);
  assert.equal(held.verdict.model_revision, WAN_MODEL_REVISION);
  assert.deepEqual(held.verdict.model_settings, h.calls.wan[0].job.modelSettings);
  assert.equal(held.verdict.generation_receipt.metrics.wall_time_ms, 123456);
  assert.equal(held.verdict.generation_receipt.metrics.generation_time_ms, 120000);
  assert.equal(held.verdict.generation_receipt.metrics.energy.gpu_telemetry.energyKwh, 0.013667);
  assert.equal(held.verdict.generation_receipt.metrics.estimated_electricity_cost_usd, 0.003429);
  assert.equal(h.calls.upload.length, 0);
});

test("known setup failure falls back to Ads by default without changing the WAN lease and still holds for review", async (t) => {
  const h = harness(t, {
    wanRunnerImpl: async (jobFile, job) => {
      h.calls.wan.push({ jobFile, job });
      return { ok: false, reason: "local_model_directory_required" };
    },
    adsRunnerImpl: async (jobFile, job) => {
      h.calls.ads.push({ jobFile, job });
      return adsAwaitingReview(job);
    },
  });
  const result = await h.worker.processJob(wanLease());
  assert.equal(result.status, "awaiting_review");
  assert.equal(h.calls.wan.length, 1);
  assert.equal(h.calls.ads.length, 1);
  assert.equal(h.calls.ads[0].job.producer, WAN_PRODUCER, "fallback never switches the leased producer");
  const held = h.calls.settled[0];
  assert.equal(held.action, "hold");
  assert.equal(held.job_id, "hrj_wan_worker");
  assert.equal(held.lease_token, "lease_wan_worker");
  assert.equal(held.verdict.producer, WAN_PRODUCER);
  assert.equal(held.verdict.generator, "ads_animate_image");
  assert.equal(held.verdict.prompt_sha256, REMASTER_PROMPT_SHA256);
  assert.equal(held.verdict.canonical_recipe_sha256, REMASTER_PROMPT_SHA256);
  assert.equal(held.verdict.master_sha256, CLIP_SHA);
  assert.equal(held.verdict.generation_receipt.model.revision, WAN_MODEL_REVISION);
  assert.ok(held.verdict.generation_receipt.metrics.wall_time_ms >= 0);
  assert.ok(held.verdict.generation_receipt.metrics.energy.estimated_kwh >= 0);
  assert.ok(held.verdict.generation_receipt.metrics.estimated_electricity_cost_usd >= 0);
  assert.deepEqual(held.verdict.generation_receipt.fallback, {
    used: true,
    from: WAN_PRODUCER,
    to: ADS_PRODUCER,
    reason: "local_model_directory_required",
  });
  assert.equal(h.calls.upload.length, 0);
});

test("explicit fallback kill switch fails a technical WAN setup error without Ads dispatch", async (t) => {
  const h = harness(t, {
    env: { GHOST_AGENCY_WAN_FALLBACK_ADS: "0" },
    wanRunnerImpl: async (jobFile, job) => {
      h.calls.wan.push({ jobFile, job });
      return { ok: false, reason: "local_model_directory_required" };
    },
  });
  const result = await h.worker.processJob(wanLease());
  assert.deepEqual(result, { status: "failed", reason: "local_model_directory_required" });
  assert.equal(h.calls.ads.length, 0);
  assert.equal(h.calls.settled[0].action, "fail");
});

test("policy, truth, provenance, and ambiguous runtime failures never fall back to Ads", async (t) => {
  for (const reason of [
    "vertical_not_allowed",
    "source_sha256_mismatch",
    "wan_result_identity_mismatch",
    "wan_i2v_failed",
    "unknown_wan_failure",
  ]) {
    const h = harness(t, {
      wanRunnerImpl: async (jobFile, job) => {
        h.calls.wan.push({ jobFile, job });
        return { ok: false, reason };
      },
    });
    const result = await h.worker.processJob(wanLease({ job_id: `hrj_${reason}` }));
    assert.equal(result.reason, reason);
    assert.equal(h.calls.ads.length, 0, reason);
    assert.notEqual(h.calls.settled[0].action, "requeue", reason);
  }
});

test("approved WAN receipt uploads the exact held clip without rerunning either generator", async (t) => {
  const wanOptimized = {
    sha256: OPTIMIZED_SHA,
    url_fingerprint: `${WAN_PRODUCER}:${OPTIMIZED_SHA}`,
    width: 832,
    height: 480,
    prompt_sha256: WAN_REMASTER_RECIPE_SHA256,
  };
  const approvedArtifact = workerModule.approvedArtifactFrom({
    sourceSha256: RAW_SHA,
    sourceUrl: SOURCE_URL,
    clipSha256: CLIP_SHA,
    optimizedAsset: wanOptimized,
  });
  const approvedAt = new Date(Date.now() - 60_000).toISOString();
  const generationReceipt = {
    schema_version: "wss.hero_generation_receipt.v1",
    requested_producer: WAN_PRODUCER,
    generator: WAN_PRODUCER,
    artifacts: { recipe_sha256: WAN_REMASTER_RECIPE_SHA256 },
    model: { id: WAN_MODEL_ID, revision: WAN_MODEL_REVISION, settings: { seed: 20260822 } },
    fallback: null,
  };
  const h = harness(t, {
    stageApprovedReviewImpl: async (_job, _candidate, artifact, _root, directory) => {
      const clipPath = path.join(directory, "approved-review.mp4");
      fs.writeFileSync(clipPath, CLIP);
      return {
        path: clipPath,
        artifact,
        clip: { bytes: CLIP, sha256: CLIP_SHA },
        receipt: {
          producer: WAN_PRODUCER,
          generator: WAN_PRODUCER,
          generation_receipt: generationReceipt,
          optimized_asset: wanOptimized,
        },
      };
    },
  });
  const result = await h.worker.processJob(wanLease({
    approved_clip: { approved: true, approved_by: "Mark", approved_at: approvedAt, sha256: CLIP_SHA },
    approved_artifact: approvedArtifact,
    optimized_asset: wanOptimized,
  }));
  assert.equal(result.status, "complete");
  assert.equal(h.calls.wan.length, 0);
  assert.equal(h.calls.ads.length, 0);
  assert.equal(h.calls.upload.length, 1);
  assert.equal(h.calls.upload[0][1].producer, WAN_PRODUCER);
  assert.equal(h.calls.upload[0][3].sha256, CLIP_SHA);
  assert.equal(h.calls.settled.length, 0, "verified upload route owns terminal settlement");
});

test("unknown leased producer is refused before download or either runner", async (t) => {
  const h = harness(t);
  const result = await h.worker.processJob(wanLease({ producer: "tour_video" }));
  assert.deepEqual(result, { status: "refused", reason: "unsupported_leased_producer" });
  assert.equal(h.calls.download.length, 0);
  assert.equal(h.calls.wan.length, 0);
  assert.equal(h.calls.ads.length, 0);
  assert.equal(h.calls.settled[0].action, "refuse");
});
