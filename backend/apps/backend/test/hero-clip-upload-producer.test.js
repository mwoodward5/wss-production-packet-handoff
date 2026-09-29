"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const upload = require("../api/admin/hero-clip-upload");
const validation = require("../lib/hero-clip-validation");
const {
  WAN_PRODUCER,
  ADS_PRODUCER,
  OPENROUTER_SEEDANCE_PRODUCER,
} = require("../lib/hero-video-policy");
const {
  WAN_MODEL_ID,
  WAN_MODEL_REVISION,
  WAN_REMASTER_RECIPE_SHA256,
  WAN_DEFAULT_SETTINGS,
  stableSerialize,
} = require("../lib/wan-hero-policy");

function box(type, payload) {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, "ascii");
  payload.copy(output, 8);
  return output;
}

function validHeroMp4(options = {}) {
  const ftyp = box("ftyp", Buffer.from("isom\x00\x00\x02\x00isomiso2", "binary"));
  const mvhd = Buffer.alloc(24);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(5000, 16);
  const tkhd = Buffer.alloc(24);
  tkhd.writeUInt32BE(1920 * 65536, 16);
  tkhd.writeUInt32BE(1080 * 65536, 20);
  const hdlr = Buffer.alloc(12);
  hdlr.write("vide", 8, 4, "ascii");
  const stsdHead = Buffer.alloc(8);
  stsdHead.writeUInt32BE(1, 4);
  const stsd = box("stsd", Buffer.concat([stsdHead, box("avc1", Buffer.alloc(8))]));
  const minf = box("minf", box("stbl", stsd));
  const mdia = box("mdia", Buffer.concat([box("hdlr", hdlr), minf]));
  const trak = box("trak", Buffer.concat([box("tkhd", tkhd), mdia]));
  const audioHdlr = Buffer.alloc(12);
  audioHdlr.write("soun", 8, 4, "ascii");
  const audioTrak = box("trak", box("mdia", box("hdlr", audioHdlr)));
  return Buffer.concat([
    ftyp,
    box("moov", Buffer.concat([box("mvhd", mvhd), trak, ...(options.audio ? [audioTrak] : [])])),
    box("mdat", Buffer.from([1])),
  ]);
}

const SOURCE_SHA = "a".repeat(64);
const OPTIMIZED_SHA = "b".repeat(64);
const SOURCE_URL = "https://client.example/work/real-job.jpg";
const APPROVED_AT = "2026-08-21T19:59:00.000Z";

function responseHarness() {
  const captured = { status: 0, body: null };
  return {
    captured,
    statusCode: 200,
    setHeader() {},
    writeHead(status) { this.statusCode = status; return this; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(String(body));
    },
  };
}

function durableWanPayload(clipSha256) {
  const modelSettings = { ...WAN_DEFAULT_SETTINGS, seed: 7, numFrames: 81 };
  const settingsSha256 = createHash("sha256").update(stableSerialize(modelSettings)).digest("hex");
  return {
    photo_bank: { photos: [{ sha256: SOURCE_SHA, url: SOURCE_URL, source: "own_site" }] },
    approved_clip: {
      approved: true,
      approved_by: "Mark",
      approved_at: APPROVED_AT,
      sha256: clipSha256,
    },
    approved_artifact: {
      raw_sha256: SOURCE_SHA,
      source_url: SOURCE_URL,
      clip_sha256: clipSha256,
      optimized_sha256: OPTIMIZED_SHA,
      optimized_asset_fingerprint: "wan/source-prep/receipt-1",
      prompt_sha256: WAN_REMASTER_RECIPE_SHA256,
      producer: WAN_PRODUCER,
      generator: WAN_PRODUCER,
      generation_receipt: {
        schema_version: "wss.hero_generation_receipt.v1",
        producer: WAN_PRODUCER,
        generator: WAN_PRODUCER,
        source_sha256: SOURCE_SHA,
        raw_sha256: SOURCE_SHA,
        optimized_sha256: OPTIMIZED_SHA,
        master_sha256: "e".repeat(64),
        clip_sha256: clipSha256,
        recipe_sha256: WAN_REMASTER_RECIPE_SHA256,
        model_id: WAN_MODEL_ID,
        model_revision: WAN_MODEL_REVISION,
        model_settings: modelSettings,
        model_settings_sha256: settingsSha256,
        wall_time_ms: 3_600_000,
        generation_time_ms: 3_300_000,
        energy_kwh: 0.24,
        cost_usd: 0.031,
        local_path: "C:\\private\\wan-master.mp4",
      },
    },
  };
}

function spoofedFields() {
  return {
    prospect_id: "wss-test-acme",
    job_id: "hrj_wan_upload",
    lease_token: "lease_wan_upload",
    source_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    approved: "true",
    approved_by: "Mark",
    approved_at: APPROVED_AT,
    optimized_sha256: OPTIMIZED_SHA,
    optimized_asset_fingerprint: "wan/source-prep/receipt-1",
    prompt_sha256: WAN_REMASTER_RECIPE_SHA256,
    producer: ADS_PRODUCER,
    generator: ADS_PRODUCER,
    source: "asset_studio_manual",
    model_id: "hostile/form-spoof",
    cost_usd: "9999",
  };
}

test("WAN upload attribution and immutable telemetry come only from the durable lease", async () => {
  const clip = validHeroMp4();
  const clipSha = validation.validateHeroClip(clip).sha256;
  const events = [];
  const patches = [];
  const completions = [];
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    readMultipart: async () => ({
      ok: true,
      fields: spoofedFields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    select: async () => ({ ok: true, data: [{
      prospect_id: "wss-test-acme",
      record: { build_ready: { photo_bank: { photos: [{ sha256: SOURCE_SHA, url: SOURCE_URL }] } } },
    }] }),
    validateHeroReelJobLease: async () => ({
      ok: true,
      job: { producer: WAN_PRODUCER, payload: durableWanPayload(clipSha) },
    }),
    uploadProofShot: async (objectPath) => ({ ok: true, publicUrl: `https://assets.example/${objectPath}` }),
    recordEvent: async (type, payload) => {
      events.push({ type, payload });
      return { ok: true, mode: "live_write", event_id: "event-1" };
    },
    patchHeroReel: async (prospectId, reel) => {
      patches.push({ prospectId, reel });
      return { ok: true, write_id: "record-1" };
    },
    enqueueRebuildJob: async () => ({ ok: true, job_id: "rebuild-1" }),
    kickRebuildJob: () => {},
    completeHeroReelJobAfterUpload: async (input) => {
      completions.push(input);
      return { ok: true };
    },
  });
  const response = responseHarness();
  await handler({ method: "POST", headers: {} }, response);

  assert.equal(response.captured.status, 202, JSON.stringify(response.captured.body));
  assert.equal(response.captured.body.producer, WAN_PRODUCER);
  assert.equal(response.captured.body.generator, WAN_PRODUCER);
  assert.equal(response.captured.body.source, "wan_local_i2v");
  assert.equal(patches[0].reel.generator, WAN_PRODUCER);

  const audit = events.find((entry) => entry.type === "hero_clip.asset_stored").payload;
  assert.equal(audit.producer, WAN_PRODUCER);
  assert.equal(audit.generator, WAN_PRODUCER);
  assert.equal(audit.source, "wan_local_i2v");
  assert.equal(audit.model_id, WAN_MODEL_ID);
  assert.equal(audit.model_revision, WAN_MODEL_REVISION);
  const durableSettingsSha = durableWanPayload(clipSha).approved_artifact.generation_receipt.model_settings_sha256;
  assert.equal(audit.model_settings_sha256, durableSettingsSha);
  assert.equal(audit.wall_time_ms, 3_600_000);
  assert.equal(audit.generation_time_ms, 3_300_000);
  assert.equal(audit.energy_kwh, 0.24);
  assert.equal(audit.cost_usd, 0.031);
  assert.doesNotMatch(JSON.stringify(audit), /private|local_path/i);
  assert.equal(completions[0].receipt.producer, WAN_PRODUCER);
  assert.equal(completions[0].receipt.source, "wan_local_i2v");
  assert.deepEqual(completions[0].receipt.generation_receipt, {
    producer: WAN_PRODUCER,
    generator: WAN_PRODUCER,
    model_id: WAN_MODEL_ID,
    model_revision: WAN_MODEL_REVISION,
    model_settings_sha256: durableSettingsSha,
    wall_time_ms: 3_600_000,
    generation_time_ms: 3_300_000,
    energy_kwh: 0.24,
    cost_usd: 0.031,
  });
});

test("completion retry keeps WAN attribution and rejects a mismatched durable receipt", () => {
  const clip = validation.validateHeroClip(validHeroMp4());
  const payload = durableWanPayload(clip.sha256);
  const frozenGeneration = validation.validateDurableRemasterArtifact(
    spoofedFields(),
    payload.approved_artifact,
    {
      sourceSha256: SOURCE_SHA,
      sourceUrl: SOURCE_URL,
      clipSha256: clip.sha256,
      producer: WAN_PRODUCER,
    },
  ).generationReceipt;
  const base = {
    ok: true,
    job: {
      jobId: "hrj_wan_upload",
      prospectId: "wss-test-acme",
      producer: WAN_PRODUCER,
      status: "done",
      payload,
      result: {
        clip_sha256: clip.sha256,
        url: `https://assets.example/hero-reels/${clip.sha256}.mp4`,
        settled_by_lease: "lease_wan_upload",
        action: "complete",
        completed_by: "verified_upload",
        upload_receipt: {
          producer: WAN_PRODUCER,
          generator: WAN_PRODUCER,
          source: "wan_local_i2v",
          generation_receipt: frozenGeneration,
          storage: { object_path: `acme/hero-reels/approved/${clip.sha256}.mp4`, sha256: clip.sha256 },
          audit: { type: "hero_clip.asset_stored" },
          record: { prospect_id: "wss-test-acme" },
          rebuild: { job_id: "rebuild-1" },
        },
      },
    },
  };
  const input = {
    jobId: "hrj_wan_upload",
    leaseToken: "lease_wan_upload",
    prospectId: "wss-test-acme",
    clip,
    sourceSha256: SOURCE_SHA,
    sourceUrl: SOURCE_URL,
    fields: spoofedFields(),
    now: new Date("2026-08-21T20:00:00.000Z"),
  };
  const retry = upload.completedUploadRetry(base, input);
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.durable.attribution.producer, WAN_PRODUCER);

  base.job.result.upload_receipt.producer = ADS_PRODUCER;
  assert.equal(upload.completedUploadRetry(base, input).error, "completed_upload_retry_mismatch");
});

test("legacy and explicit Ads jobs keep the existing generator and source", () => {
  assert.deepEqual(upload.durableHeroAttribution({ payload: {} }), {
    ok: true,
    producer: ADS_PRODUCER,
    generator: "ads_image_to_video",
    source: "asset_studio_manual",
    actualGenerator: "ads_animate_image",
    wanFallback: false,
  });
  assert.deepEqual(upload.durableHeroAttribution({ producer: ADS_PRODUCER, payload: {} }), {
    ok: true,
    producer: ADS_PRODUCER,
    generator: "ads_image_to_video",
    source: "asset_studio_manual",
    actualGenerator: "ads_animate_image",
    wanFallback: false,
  });
  assert.deepEqual(upload.durableHeroAttribution({
    producer: ADS_PRODUCER,
    payload: { approved_artifact: { producer: ADS_PRODUCER, generator: "ads_animate_image" } },
  }), {
    ok: true,
    producer: ADS_PRODUCER,
    generator: "ads_image_to_video",
    source: "asset_studio_manual",
    actualGenerator: "ads_animate_image",
    wanFallback: false,
  });
});

test("Seedance upload refuses real audio bytes before storage even when transport says approved", async () => {
  const clip = validHeroMp4({ audio: true });
  let uploads = 0;
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    readMultipart: async () => ({
      ok: true,
      fields: spoofedFields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    getHeroReelJob: null,
    select: async () => ({ ok: true, data: [{
      prospect_id: "wss-test-acme",
      record: { build_ready: { photo_bank: { photos: [{ sha256: SOURCE_SHA, url: SOURCE_URL }] } } },
    }] }),
    validateHeroReelJobLease: async () => ({
      ok: true,
      job: { producer: OPENROUTER_SEEDANCE_PRODUCER, payload: {} },
    }),
    uploadProofShot: async () => { uploads += 1; return { ok: true }; },
  });
  const response = responseHarness();
  await handler({ method: "POST", headers: {} }, response);
  assert.equal(response.captured.status, 422);
  assert.equal(response.captured.body.error, "clip_audio_forbidden");
  assert.equal(uploads, 0);
});

test("WAN-requested technical fallback publishes through the legacy Ads reel contract", () => {
  const payload = durableWanPayload("c".repeat(64));
  payload.approved_artifact.prompt_sha256 = validation.REMASTER_PROMPT_SHA256;
  payload.approved_artifact.generator = "ads_animate_image";
  Object.assign(payload.approved_artifact.generation_receipt, {
    generator: "ads_animate_image",
    recipe_sha256: validation.REMASTER_PROMPT_SHA256,
    fallback_used: true,
    fallback_from: WAN_PRODUCER,
    fallback_to: ADS_PRODUCER,
    fallback_reason: "wan_timeout_invalid",
  });
  assert.deepEqual(upload.durableHeroAttribution({ producer: WAN_PRODUCER, payload }), {
    ok: true,
    producer: WAN_PRODUCER,
    generator: "ads_image_to_video",
    source: "asset_studio_manual",
    actualGenerator: "ads_animate_image",
    wanFallback: true,
  });
});

test("fallback finalization keeps WAN request attribution and the durable Ads actual generator", async () => {
  const clip = validHeroMp4();
  const clipSha = validation.validateHeroClip(clip).sha256;
  const payload = durableWanPayload(clipSha);
  payload.approved_artifact.prompt_sha256 = validation.REMASTER_PROMPT_SHA256;
  payload.approved_artifact.generator = "ads_animate_image";
  Object.assign(payload.approved_artifact.generation_receipt, {
    generator: "ads_animate_image",
    recipe_sha256: validation.REMASTER_PROMPT_SHA256,
    fallback_used: true,
    fallback_from: WAN_PRODUCER,
    fallback_to: ADS_PRODUCER,
    fallback_reason: "wan_timeout_invalid",
  });
  const fields = { ...spoofedFields(), prompt_sha256: validation.REMASTER_PROMPT_SHA256 };
  const events = [];
  const patches = [];
  const completions = [];
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    readMultipart: async () => ({
      ok: true,
      fields,
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    select: async () => ({ ok: true, data: [{
      prospect_id: "wss-test-acme",
      record: { build_ready: { photo_bank: { photos: [{ sha256: SOURCE_SHA, url: SOURCE_URL }] } } },
    }] }),
    validateHeroReelJobLease: async () => ({ ok: true, job: { producer: WAN_PRODUCER, payload } }),
    uploadProofShot: async (objectPath) => ({ ok: true, publicUrl: `https://assets.example/${objectPath}` }),
    recordEvent: async (type, eventPayload) => {
      events.push({ type, payload: eventPayload });
      return { ok: true, mode: "live_write", event_id: "event-1" };
    },
    patchHeroReel: async (_prospectId, reel) => {
      patches.push(reel);
      return { ok: true, write_id: "record-1" };
    },
    enqueueRebuildJob: async () => ({ ok: true, job_id: "rebuild-1" }),
    kickRebuildJob: () => {},
    completeHeroReelJobAfterUpload: async (input) => {
      completions.push(input);
      return { ok: true };
    },
  });
  const response = responseHarness();
  await handler({ method: "POST", headers: {} }, response);

  assert.equal(response.captured.status, 202, JSON.stringify(response.captured.body));
  assert.equal(response.captured.body.producer, WAN_PRODUCER);
  assert.equal(response.captured.body.generator, "ads_image_to_video");
  assert.equal(response.captured.body.source, "asset_studio_manual");
  assert.equal(patches[0].generator, "ads_image_to_video");
  const audit = events.find((entry) => entry.type === "hero_clip.asset_stored").payload;
  assert.equal(audit.producer, WAN_PRODUCER);
  assert.equal(audit.generator, "ads_animate_image");
  assert.equal(audit.source, "asset_studio_manual");
  assert.equal(audit.fallback_reason, "wan_timeout_invalid");
  assert.equal(completions[0].receipt.producer, WAN_PRODUCER);
  assert.equal(completions[0].receipt.generator, "ads_image_to_video");
  assert.equal(completions[0].receipt.generation_receipt.generator, "ads_animate_image");
});

test("durable row and artifact producer disagreement is refused", () => {
  assert.equal(upload.durableHeroAttribution({
    producer: ADS_PRODUCER,
    payload: { approved_artifact: { generation_receipt: { producer: WAN_PRODUCER } } },
  }).reason, "durable_hero_producer_mismatch");
});
