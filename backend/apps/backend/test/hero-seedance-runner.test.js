"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const validation = require("../lib/hero-clip-validation");
const policy = require("../lib/hero-video-policy");
const runner = require("../lib/hero-seedance-runner");
const heroBudget = require("../lib/line-hero-budget");
const {
  CLIENT_ASSETS_PREFIX,
  assetKeyForSha256,
  createMemoryAssetStore,
} = require("../lib/client-asset-store");
const worker = require("../scripts/seedance-worker.cjs");

function jpegBytes(width, height, payload = "seedance-source-photo") {
  const header = Buffer.alloc(16);
  header[0] = 0xff;
  header[1] = 0xd8;
  header[2] = 0xff;
  header[3] = 0xc0;
  header.writeUInt16BE(11, 4);
  header[6] = 8;
  header.writeUInt16BE(height, 7);
  header.writeUInt16BE(width, 9);
  header[11] = 1;
  return Buffer.concat([header, Buffer.from(payload)]);
}

function pngBytes(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, 4, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function gifBytes(width, height) {
  const bytes = Buffer.alloc(16);
  bytes.write("GIF89a", 0, 6, "ascii");
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

function webpBytes(width, height) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, 4, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, 4, "ascii");
  bytes.write("VP8X", 12, 4, "ascii");
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

const SOURCE_BYTES = jpegBytes(1600, 900);
const SOURCE_SHA = createHash("sha256").update(SOURCE_BYTES).digest("hex");
const SOURCE_URL = "https://client.example/work/hero.jpg";
const SOURCE_ASSET_KEY = assetKeyForSha256(SOURCE_SHA, { prefix: CLIENT_ASSETS_PREFIX, ext: "jpg" });
const SOURCE_ASSET_URL = `https://our-cdn.wss-ai.com/${SOURCE_ASSET_KEY}`;

function seedanceConfig(overrides = {}) {
  const {
    sourceDownloadImpl = async () => SOURCE_BYTES,
    sourceContentType = "image/jpeg",
    sourceVisualPreflightImpl = async () => ({ ok: true }),
    ...rest
  } = overrides;
  return runner.configFromEnv({}, {
    sourceDownloadImpl: async (url, options) => {
      const downloaded = await sourceDownloadImpl(url, options);
      if (
        Buffer.isBuffer(downloaded)
        || ArrayBuffer.isView(downloaded)
        || downloaded instanceof ArrayBuffer
      ) return { bytes: downloaded, contentType: sourceContentType };
      return downloaded;
    },
    persistCheckpointImpl: async () => ({ ok: true }),
    sourceVisualPreflightImpl,
    sourceAssetStore: createMemoryAssetStore({ prefix: CLIENT_ASSETS_PREFIX, isPublic: true }),
    ...rest,
  });
}

test("a claimed job whose parent Line halted stops before heartbeat, provider submit, or settlement", async () => {
  let fetches = 0;
  let intervals = 0;
  const config = seedanceConfig({
    parentBatchHalted: async () => ({ ok: true, halted: true }),
    fetchImpl: async () => { fetches += 1; throw new Error("provider_must_not_run"); },
    setIntervalImpl: () => { intervals += 1; return 1; },
  });
  const result = await runner.processJob(config, {
    jobId: "hrj_halted_parent",
    leaseToken: "lease_halted_parent",
    producer: "openrouter_seedance",
    lineHandle: { batchId: "line_halted", rowId: "row_halted" },
  });
  assert.deepEqual(result, {
    status: "halted_parent",
    reason: "parent_line_batch_halted",
    retry_without_generation: true,
  });
  assert.equal(fetches, 0);
  assert.equal(intervals, 0);
});

test("the paid-submit boundary rechecks a parent that halts after source preparation", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-halted-parent-submit-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  let providerCalls = 0;
  const config = seedanceConfig({
    reviewDir,
    openrouterApiKey: "unused",
    parentBatchHalted: async () => ({ ok: true, halted: true }),
    fetchImpl: async () => { providerCalls += 1; throw new Error("provider_must_not_run"); },
  });
  const bound = job({ line_handle: { batchId: "line_halted", rowId: "row_halted" } });
  await assert.rejects(
    runner.submitAndDownload(config, bound, runner.selectOwnedScene(bound)),
    /parent_line_batch_halted/,
  );
  assert.equal(providerCalls, 0);
});

test("picked or qualified-without-binding Line rows requeue immediately with zero provider calls", async () => {
  const unboundRows = [
    { rowId: "row_binding", prospectId: "wss-seedance-1", status: "picked" },
    (() => {
      const row = { rowId: "row_binding", prospectId: "wss-seedance-1", status: "qualified" };
      return {
        ...row,
        heroStartCheckpointed: true,
        heroStartCheckpoint: heroBudget.make({
          disposition: "qualified",
          batchId: "line_binding",
          rowId: row.rowId,
          prospectId: row.prospectId,
          jobId: "",
          generationRevision: 0,
        }),
      };
    })(),
  ];
  let requeues = 0;
  let providerCalls = 0;
  let intervals = 0;
  for (const row of unboundRows) {
    const config = seedanceConfig({
      loadLineBatchImpl: async () => ({ ok: true, batch: { status: "building", rows: [row] } }),
      fetchImpl: async (url, options = {}) => {
        if (String(url).endsWith("/api/admin/hero-reel")) {
          const body = JSON.parse(options.body);
          assert.equal(body.action, "requeue");
          assert.equal(body.verdict.reason, "parent_line_hero_binding_pending");
          requeues += 1;
          return response(200, { ok: true });
        }
        providerCalls += 1;
        throw new Error("provider_must_not_run");
      },
      setIntervalImpl: () => { intervals += 1; return 1; },
    });
    const result = await runner.processJob(config, job({
      line_handle: { batchId: "line_binding", rowId: "row_binding" },
    }));
    assert.deepEqual(result, {
      status: "requeued",
      reason: "parent_line_hero_binding_pending",
      retry_without_generation: true,
    });
  }
  assert.equal(requeues, 2);
  assert.equal(providerCalls, 0);
  assert.equal(intervals, 0, "binding is checked before the hour-long lease heartbeat starts");
});

test("an exact durable Line binding permits the existing paid-submit path", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-bound-parent-submit-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const marker = {
    required: true,
    ready: false,
    pending: true,
    jobId: "hrj_seedance_1",
    attemptId: "hero_attempt:1",
  };
  const row = {
    rowId: "row_bound",
    prospectId: "wss-seedance-1",
    status: "qualified",
    heroRemaster: marker,
    heroStartCheckpointed: true,
    heroStartCheckpoint: heroBudget.make({
      disposition: "job_bound",
      batchId: "line_bound",
      rowId: "row_bound",
      prospectId: "wss-seedance-1",
      jobId: marker.jobId,
      generationRevision: 1,
    }),
  };
  let providerCalls = 0;
  const config = seedanceConfig({
    reviewDir,
    openrouterApiKey: "test-only",
    loadLineBatchImpl: async () => ({ ok: true, batch: { status: "building", rows: [row] } }),
    fetchImpl: async (url) => {
      if (String(url) === runner.OPENROUTER_VIDEO_ENDPOINT) providerCalls += 1;
      return response(500, { error: "provider_test_stop" });
    },
  });
  const bound = job({ line_handle: { batchId: "line_bound", rowId: "row_bound" } });
  await assert.rejects(
    runner.submitAndDownload(config, bound, runner.selectOwnedScene(bound)),
    /seedance_submit_reconciliation_required/,
  );
  assert.equal(providerCalls, 1, "the exact persisted binding is the paid-provider permission boundary");
});

test("legacy submitting or accepted checkpoints resume without a new Line marker or paid POST", async (t) => {
  for (const state of ["submitting", "accepted"]) {
    const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `wss-legacy-paid-${state}-`));
    t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
    const candidate = job({
      lease_token: `lease-${state}`,
      line_handle: { batchId: `line_${state}`, rowId: `row_${state}` },
    });
    const photo = runner.selectOwnedScene(candidate);
    candidate.providerCheckpoint = {
      schema_version: "wss.hero.seedance_provider_checkpoint.v1",
      job_id: candidate.jobId,
      prospect_id: candidate.prospectId,
      generation_revision: candidate.generationRevision,
      source_sha256: photo.sha256,
      source_mime: "image/jpeg",
      source_bytes: SOURCE_BYTES.length,
      model_id: validation.SEEDANCE_MODEL_ID,
      duration_seconds: 8,
      intent_sha256: runner.generationIdentity(candidate, photo),
      submission_state: state,
      polling_url: state === "accepted" ? `https://openrouter.ai/api/v1/videos/jobs/legacy-${state}` : "",
      ...(state === "accepted" ? { provider_job_id: `legacy-${state}`, submitted_at: "2026-08-30T00:00:02.000Z" } : {}),
      created_at: "2026-08-30T00:00:00.000Z",
      submit_started_at: "2026-08-30T00:00:01.000Z",
    };
    const qualificationCheckpoint = heroBudget.make({
      disposition: "qualified",
      batchId: `line_${state}`,
      rowId: `row_${state}`,
      prospectId: candidate.prospectId,
    });
    let providerSubmits = 0;
    let settlement = null;
    const config = seedanceConfig({
      reviewDir,
      openrouterApiKey: "test-only",
      nowMs: () => Date.parse("2026-08-30T00:01:00.000Z"),
      loadLineBatchImpl: async () => ({
        ok: true,
        batch: {
          status: "building",
          rows: [{
            rowId: `row_${state}`,
            prospectId: candidate.prospectId,
            status: "qualified",
            heroStartCheckpointed: true,
            heroStartCheckpoint: qualificationCheckpoint,
          }],
        },
      }),
      fetchImpl: async (url, options = {}) => {
        if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
          providerSubmits += 1;
          throw new Error("legacy_checkpoint_must_not_resubmit");
        }
        if (url === `https://openrouter.ai/api/v1/videos/jobs/legacy-${state}`) {
          return response(503, {});
        }
        if (String(url).endsWith("/api/admin/hero-reel")) {
          settlement = JSON.parse(options.body);
          return response(200, { ok: true });
        }
        throw new Error(`unexpected_url:${url}`);
      },
    });
    const result = await runner.processJob(config, candidate);
    assert.equal(providerSubmits, 0, state);
    assert.equal(settlement.action, state === "accepted" ? "requeue" : "hold");
    assert.equal(result.status, state === "accepted" ? "queued" : "awaiting_review");
  }
});

test("a stale, replaced, or inactive parent Line row stops before heartbeat or provider work", async () => {
  const staleRows = [
    [{ rowId: "row_current", prospectId: "wss-seedance-1", status: "rejected" }],
    [{ rowId: "row_replacement", prospectId: "replacement", status: "qualified" }],
    [{ rowId: "row_current", prospectId: "replacement", status: "qualified" }],
    [{
      rowId: "row_current",
      prospectId: "wss-seedance-1",
      status: "qualified",
      heroRemaster: { jobId: "hrj_new_generation" },
    }],
  ];
  let providerCalls = 0;
  let refusals = 0;
  let intervals = 0;
  for (const [index, rows] of staleRows.entries()) {
    const config = seedanceConfig({
      loadLineBatchImpl: async (batchId) => {
        assert.equal(batchId, "line_current");
        return { ok: true, batch: { status: "building", rows } };
      },
      fetchImpl: async (url, options = {}) => {
        if (String(url).endsWith("/api/admin/hero-reel")) {
          const body = JSON.parse(options.body);
          assert.equal(body.action, "refuse");
          assert.equal(body.verdict.reason, "parent_line_row_not_current");
          refusals += 1;
          return response(200, { ok: true });
        }
        providerCalls += 1;
        throw new Error("provider_must_not_run");
      },
      setIntervalImpl: () => { intervals += 1; return 1; },
    });
    const result = await runner.processJob(config, job({
      line_handle: { batchId: "line_current", rowId: "row_current" },
    }));
    assert.deepEqual(result, {
      status: "refused",
      reason: "parent_line_row_not_current",
      retry_without_generation: true,
    });
    assert.equal(refusals, index + 1);
  }
  assert.equal(providerCalls, 0);
  assert.equal(refusals, staleRows.length);
  assert.equal(intervals, 0);
});

test("the paid-submit boundary rechecks a row that became inactive after claim", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-inactive-parent-submit-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  let lineReads = 0;
  let providerCalls = 0;
  let refusals = 0;
  const marker = {
    required: true,
    ready: false,
    pending: true,
    jobId: "hrj_seedance_1",
    attemptId: "hero_attempt:1",
  };
  const config = seedanceConfig({
    reviewDir,
    openrouterApiKey: "unused",
    loadLineBatchImpl: async () => ({
      ok: true,
      batch: {
        status: "building",
        rows: [{
          rowId: "row_race",
          prospectId: "wss-seedance-1",
          status: lineReads++ === 0 ? "qualified" : "rejected",
          heroRemaster: marker,
          heroStartCheckpointed: true,
          heroStartCheckpoint: heroBudget.make({
            disposition: "job_bound",
            batchId: "line_race",
            rowId: "row_race",
            prospectId: "wss-seedance-1",
            jobId: marker.jobId,
            generationRevision: 1,
          }),
        }],
      },
    }),
    fetchImpl: async (url, options = {}) => {
      if (String(url).endsWith("/api/admin/hero-reel")) {
        const body = JSON.parse(options.body);
        assert.equal(body.action, "refuse");
        assert.equal(body.verdict.reason, "parent_line_row_not_current");
        refusals += 1;
        return response(200, { ok: true });
      }
      providerCalls += 1;
      throw new Error("provider_must_not_run");
    },
  });
  const result = await runner.processJob(config, job({
    line_handle: { batchId: "line_race", rowId: "row_race" },
  }));
  assert.deepEqual(result, {
    status: "refused",
    reason: "parent_line_row_not_current",
    retry_without_generation: true,
  });
  assert.equal(lineReads, 2);
  assert.equal(providerCalls, 0);
  assert.equal(refusals, 1);
});

test("a stale-row refusal outage stays retry-safe and still makes zero provider calls", async () => {
  let providerCalls = 0;
  let refusalAttempts = 0;
  const config = seedanceConfig({
    loadLineBatchImpl: async () => ({
      ok: true,
      batch: {
        status: "building",
        rows: [{ rowId: "row_stale", prospectId: "wss-seedance-1", status: "error" }],
      },
    }),
    fetchImpl: async (url) => {
      if (String(url).endsWith("/api/admin/hero-reel")) {
        refusalAttempts += 1;
        return response(503, { ok: false, error: "temporary_settle_outage" });
      }
      providerCalls += 1;
      throw new Error("provider_must_not_run");
    },
    sleepImpl: async () => {},
  });
  const result = await runner.processJob(config, job({
    line_handle: { batchId: "line_stale", rowId: "row_stale" },
  }));
  assert.deepEqual(result, {
    status: "failed",
    reason: "parent_line_row_not_current",
    retry_without_generation: true,
  });
  assert.equal(refusalAttempts, 2, "the exact lease gets the existing bounded settlement retry");
  assert.equal(providerCalls, 0);
});

function box(type, payload) {
  const buf = Buffer.alloc(8 + payload.length);
  buf.writeUInt32BE(8 + payload.length, 0);
  buf.write(type, 4, 4, "ascii");
  payload.copy(buf, 8);
  return buf;
}

function validMp4(durationMs = 8000, options = {}) {
  const mvhd = Buffer.alloc(24);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(durationMs, 16);
  const tkhd = Buffer.alloc(24);
  tkhd.writeUInt32BE((options.width || 1280) * 65536, 16);
  tkhd.writeUInt32BE((options.height || 720) * 65536, 20);
  const hdlr = Buffer.alloc(12);
  hdlr.write("vide", 8, 4, "ascii");
  const stsdHead = Buffer.alloc(8);
  stsdHead.writeUInt32BE(1, 4);
  const stsd = box("stsd", Buffer.concat([stsdHead, box("avc1", Buffer.alloc(8))]));
  const mdia = box("mdia", Buffer.concat([
    box("hdlr", hdlr),
    box("minf", box("stbl", stsd)),
  ]));
  const audioHdlr = Buffer.alloc(12);
  audioHdlr.write("soun", 8, 4, "ascii");
  const audioTrak = box("trak", box("mdia", box("hdlr", audioHdlr)));
  return Buffer.concat([
    box("ftyp", Buffer.from("isom\x00\x00\x02\x00isomiso2", "binary")),
    box("moov", Buffer.concat([
      box("mvhd", mvhd),
      box("trak", Buffer.concat([box("tkhd", tkhd), mdia])),
      ...(options.audio ? [audioTrak] : []),
    ])),
    box("mdat", Buffer.from([1])),
  ]);
}

function oversizedValidMp4(targetBytes = 6 * 1024 * 1024, options = {}) {
  const base = validMp4(8000, options);
  return Buffer.concat([base, box("free", Buffer.alloc(targetBytes - base.length - 8))]);
}

function fakeClipTranscoder(outputBytes, observed = {}, error = null) {
  return (_bin, args, _options, callback) => {
    const child = new EventEmitter();
    queueMicrotask(() => {
      observed.args = args;
      if (!error) fs.writeFileSync(args.at(-1), outputBytes);
      callback(error, "", error ? "transcode failed" : "");
    });
    return child;
  };
}

function job(overrides = {}) {
  return runner.normalizeJob({
    job_id: "hrj_seedance_1",
    prospect_id: "wss-seedance-1",
    lease_token: "lease-1",
    producer: policy.OPENROUTER_SEEDANCE_PRODUCER,
    source_url: "https://client.example/",
    business_name: "Client Service Co",
    vertical: "plumbing",
    generation_revision: 1,
    duration_seconds: 8,
    openrouter_model: validation.SEEDANCE_MODEL_ID,
    photo_bank: { photos: [{
      url: SOURCE_URL,
      sha256: SOURCE_SHA,
      source: "own_site",
      found_on: "https://client.example/gallery",
      asset_type: "real_scene",
      width: 1600,
      height: 900,
    }] },
    ...overrides,
  });
}

function response(status, body, bytes) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => Uint8Array.from(bytes || []).buffer,
  };
}

function fakeHttps(sequence, observed = []) {
  return {
    request(url, options, onResponse) {
      const request = new EventEmitter();
      request.destroy = (error) => queueMicrotask(() => request.emit("error", error));
      request.end = () => {
        options.lookup(url.hostname, { family: 0 }, (error, address) => {
          if (error) return request.emit("error", error);
          const item = sequence.shift() || {};
          const remoteAddress = item.remoteAddress || address;
          observed.push({ url: url.toString(), address, headers: options.headers });
          const socket = new EventEmitter();
          socket.remoteAddress = remoteAddress;
          request.emit("socket", socket);
          socket.emit("secureConnect");
          const stream = new PassThrough();
          stream.statusCode = item.status || 200;
          stream.headers = item.headers || {};
          stream.socket = { remoteAddress };
          onResponse(stream);
          stream.end(item.body || Buffer.alloc(0));
        });
      };
      return request;
    },
  };
}

test("automatic hero producer is Seedance and its kill switch falls back to Ads", () => {
  assert.equal(policy.autolineHeroProducer({}), policy.OPENROUTER_SEEDANCE_PRODUCER);
  assert.equal(policy.autolineHeroProducer({ GHOST_AGENCY_SEEDANCE_PRIMARY: "0" }), policy.ADS_PRODUCER);
  assert.equal(policy.autolineHeroProducer({ GHOST_AGENCY_HERO_AUTOLINE: "0" }), "");
});

test("Seedance byte validation refuses an audio track even when the receipt says no audio", () => {
  const bytes = validMp4(8000, { audio: true });
  assert.equal(validation.validateHeroClip(bytes).audioTrackCount, 1);
  assert.equal(validation.validateHeroClip(bytes, { forbidAudio: true }).reason, "clip_audio_forbidden");
});

test("the production migration admits Seedance and makes it the database default", () => {
  const migration = fs.readFileSync(path.resolve(
    __dirname,
    "../../../db/migrations/2026-08-24_seedance_hero_producer.sql",
  ), "utf8");
  assert.match(migration, /producer\s+in\s*\(\s*'wan2_i2v_local',\s*'ads_image_to_video',\s*'openrouter_seedance'\s*\)/i);
  assert.match(migration, /set\s+default\s+'openrouter_seedance'/i);
  assert.match(migration, /validate\s+constraint\s+ghost_agency_hero_reel_jobs_producer_check/i);
});

test("the continuous worker uses worker auth and picks up a full wave immediately", async () => {
  let claimRequest;
  const claimed = await runner.claimJob(seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    workerId: "seedance-1",
    fetchImpl: async (url, options) => {
      claimRequest = { url, options };
      return response(200, { ok: true, job: null });
    },
  }));
  assert.equal(claimed, null);
  assert.match(claimRequest.url, /producer=openrouter_seedance/);
  assert.equal(claimRequest.options.headers["x-ghost-hero-worker-token"], "worker-token");

  const ids = ["one", "two", "three"];
  const capsule = JSON.stringify({
    schema: "wss.hero.job-capability-launch.v1",
    phase: "generate",
    capability: "wss1.payload.signature",
  });
  let active = 0;
  let peak = 0;
  const wave = await worker.runWave({ parallelism: 3, workerId: "seedance", continuous: true }, {
    requestLaunchCapsuleImpl: async () => capsule,
    claimJobImpl: async (config) => job({ job_id: ids.shift(), lease_token: config.workerId }),
    processJobImpl: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { status: "complete" };
    },
  });
  assert.equal(wave.claimed, 3);
  assert.equal(peak, 3);
});

test("Practice worker broker request is locked to one exact batch row", async () => {
  assert.equal(runner.configFromEnv({}).practiceOnly, false, "normal worker remains unscoped when opt-in is absent");
  let body;
  const config = runner.configFromEnv({
    GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-token",
    GHOST_AGENCY_SEEDANCE_PRACTICE_ONLY: "1",
    GHOST_AGENCY_SEEDANCE_PRACTICE_BATCH_ID: "line_practice_exact",
    GHOST_AGENCY_SEEDANCE_PRACTICE_ROW_ID: "row_practice_exact",
  }, {
    apiBase: "https://ghost.example",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response(200, { ok: true, job: null });
    },
  });
  assert.equal(await runner.requestLaunchCapsule(config), null);
  assert.equal(config.practiceOnly, true);
  assert.deepEqual(body, {
    action: "next",
    practice: true,
    batch_id: "line_practice_exact",
    row_id: "row_practice_exact",
  });
  await assert.rejects(runner.requestLaunchCapsule({
    ...config,
    practiceRowId: "",
  }), /seedance_practice_target_incomplete/);
  await assert.rejects(runner.requestLaunchCapsule({
    ...config,
    practiceBatchId: "",
    practiceRowId: "",
  }), /seedance_practice_target_required/);
});

test("eight-second direct-source Seedance receipt passes the durable upload validator", () => {
  const clip = validation.validateHeroClip(validMp4());
  const source = runner.selectOwnedScene(job());
  const verdict = runner.reviewContract(job(), source, { ...clip, bytes: validMp4().length }, {
    wallTimeMs: 20_000,
    generationTimeMs: 18_000,
    costUsd: 0.12,
  });
  const result = validation.validateDurableRemasterArtifact({
    optimized_sha256: SOURCE_SHA,
    optimized_asset_fingerprint: `direct-source:${SOURCE_SHA}`,
    prompt_sha256: validation.DIRECT_SOURCE_RECIPE_SHA256,
  }, verdict.approved_artifact, {
    sourceSha256: SOURCE_SHA,
    sourceUrl: SOURCE_URL,
    clipSha256: clip.sha256,
    producer: policy.OPENROUTER_SEEDANCE_PRODUCER,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.generator, policy.OPENROUTER_SEEDANCE_PRODUCER);
  assert.equal(result.generationReceipt.duration_seconds, 8);
  assert.equal(result.generationReceipt.generate_audio, false);

  for (const drift of [
    { duration_seconds: 5 },
    { generate_audio: true },
    { cost_usd: 0 },
    { cost_usd: 0.26 },
  ]) {
    const hostile = structuredClone(verdict.approved_artifact);
    Object.assign(hostile.generation_receipt, drift);
    assert.equal(validation.validateDurableRemasterArtifact({
      optimized_sha256: SOURCE_SHA,
      optimized_asset_fingerprint: `direct-source:${SOURCE_SHA}`,
      prompt_sha256: validation.DIRECT_SOURCE_RECIPE_SHA256,
    }, hostile, {
      sourceSha256: SOURCE_SHA,
      sourceUrl: SOURCE_URL,
      clipSha256: clip.sha256,
      producer: policy.OPENROUTER_SEEDANCE_PRODUCER,
    }).reason, "durable_seedance_generation_receipt_required");
  }
});

test("the worker refuses model or duration drift before spending", async () => {
  for (const drift of [
    { openrouter_model: "bytedance/other-model" },
    { duration_seconds: 5 },
  ]) {
    let openRouterCalls = 0;
    const config = seedanceConfig({
      apiBase: "https://ghost.example",
      workerToken: "worker-token",
      openrouterApiKey: "openrouter-key",
      fetchImpl: async (url, options = {}) => {
        if (url === runner.OPENROUTER_VIDEO_ENDPOINT) openRouterCalls += 1;
        assert.equal(url, "https://ghost.example/api/admin/hero-reel");
        assert.equal(JSON.parse(options.body).action, "refuse");
        return response(200, { ok: true });
      },
    });
    const result = await runner.processJob(config, job(drift));
    assert.equal(result.reason, "seedance_job_contract_mismatch");
    assert.equal(openRouterCalls, 0);
  }
});

test("worker and owner watcher share the same default review directory", () => {
  const expected = path.join(os.tmpdir(), "wss-hero-reviews");
  assert.equal(runner.configFromEnv({}).reviewDir, expected);
});

test("the automatic Seedance wave launches ten jobs and requests an invisible drone-style fly-in", () => {
  assert.equal(runner.configFromEnv({}).parallelism, 10);
  assert.equal(job().durationSeconds, 8, "new work is frozen to the current eight-second contract");
  assert.equal(job({ duration_seconds: 4 }).durationSeconds, 4, "legacy four-second work remains resumable");
  const prompt = runner.buildPrompt({ vertical: "fencing", businessName: "Viking Fence" });
  assert.match(prompt, /8-second/);
  assert.match(prompt, /aerial-style fly-in/);
  assert.match(prompt, /never show a drone/);
  assert.match(prompt, /ultra-realistic/);
});

test("OpenRouter submit failures persist only safe status and allowlisted type", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-provider-failure-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  let providerPosts = 0;
  let failVerdict;
  const poison = "Bearer never-persist https://private.example/secret.jpg";
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerPosts += 1;
        return response(402, {
          error: {
            message: poison,
            metadata: { error_type: "payment_required", poisoned: poison },
          },
        });
      }
      if (url === "https://ghost.example/api/admin/hero-reel") {
        const body = JSON.parse(options.body);
        assert.equal(body.action, "fail");
        failVerdict = body.verdict;
        return response(200, { ok: true });
      }
      throw new Error(`unexpected_url:${url}`);
    },
  });
  const result = await runner.processJob(config, job());
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "openrouter_submit_failed");
  assert.equal(providerPosts, 1);
  const expected = {
    schema_version: "wss.openrouter_failure.v1",
    provider: "openrouter",
    operation: "video_submit",
    http_status: 402,
    error_type: "payment_required",
  };
  assert.deepEqual(result.provider_failure, expected);
  assert.deepEqual(failVerdict.provider_failure, expected);
  const serialized = JSON.stringify({ result, failVerdict });
  assert.doesNotMatch(serialized, /never-persist|private\.example|Bearer|poisoned/);
});

test("OpenRouter poll 401 and 404 are terminal, sanitized failures", () => {
  const unauthorized = runner.openRouterPollError(401, { error: { message: "bad bearer" } });
  assert.equal(unauthorized.message, "openrouter_poll_unauthorized");
  assert.deepEqual(unauthorized.providerFailure, {
    schema_version: "wss.openrouter_failure.v1",
    provider: "openrouter",
    operation: "video_poll",
    http_status: 401,
    error_type: "authentication",
  });

  const missing = runner.openRouterPollError(404, { error: { message: "generation not found" } });
  assert.equal(missing.message, "openrouter_poll_not_found");
  assert.equal(missing.providerFailure.operation, "video_poll");
  assert.equal(missing.providerFailure.error_type, "not_found");
});

test("accepted checkpoint retry budget is bounded by total age and claims", () => {
  const checkpoint = { submission_state: "accepted", submitted_at: "2026-08-29T00:00:00.000Z" };
  assert.deepEqual(runner.acceptedCheckpointBudget({
    acceptedClaimCap: 8,
    acceptedMaxAgeMs: 6 * 60 * 60 * 1000,
    nowMs: () => Date.parse("2026-08-29T00:01:00.000Z"),
  }, { attempts: 9 }, checkpoint), { ok: false, reason: "openrouter_accepted_claims_exhausted" });
  assert.deepEqual(runner.acceptedCheckpointBudget({
    acceptedClaimCap: 8,
    acceptedMaxAgeMs: 6 * 60 * 60 * 1000,
    nowMs: () => Date.parse("2026-08-29T07:00:00.000Z"),
  }, { attempts: 2 }, checkpoint), { ok: false, reason: "openrouter_accepted_checkpoint_expired" });
});

test("OpenRouter submit failure drops an unrecognized provider error type", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-provider-type-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const config = seedanceConfig({
    openrouterApiKey: "openrouter-key",
    reviewDir,
    fetchImpl: async () => response(401, {
      error: { metadata: { error_type: "credential_secret_value" } },
    }),
  });
  await assert.rejects(
    runner.submitAndDownload(config, job(), runner.selectOwnedScene(job())),
    (error) => {
      assert.equal(error.message, "openrouter_unauthorized");
      assert.deepEqual(error.providerFailure, {
        schema_version: "wss.openrouter_failure.v1",
        provider: "openrouter",
        operation: "video_submit",
        http_status: 401,
      });
      return true;
    },
  );
});

test("OpenRouter submit failure reduces a raw validation message to an allowlisted parameter", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-provider-parameter-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const config = seedanceConfig({
    openrouterApiKey: "openrouter-key",
    reviewDir,
    fetchImpl: async () => response(400, {
      error: { message: "frame_images[0].image_url cannot use data URLs: secret-input" },
    }),
  });
  await assert.rejects(
    runner.submitAndDownload(config, job(), runner.selectOwnedScene(job())),
    (error) => {
      assert.equal(error.message, "openrouter_submit_failed");
      assert.equal(error.providerFailure.parameter, "frame_images");
      assert.doesNotMatch(JSON.stringify(error.providerFailure), /secret-input|data URLs/);
      return true;
    },
  );
});

test("OpenRouter frame_images 400 terminally refuses that unaccepted source SHA and never resubmits it", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-frame-rejected-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const normalized = job({ job_id: "hrj_frame_rejected" });
  const photo = runner.selectOwnedScene(normalized);
  let providerPosts = 0;
  let refusal = null;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerPosts += 1;
        return response(400, {
          error: { message: "frame_images[0] is not accepted by the provider" },
        });
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      refusal = JSON.parse(options.body);
      return response(200, { ok: true });
    },
  });

  const result = await runner.processJob(config, normalized);
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "source_image_openrouter_frame_rejected");
  assert.equal(result.source_sha256, SOURCE_SHA);
  assert.equal(providerPosts, 1);
  assert.equal(refusal.action, "refuse");
  assert.equal(refusal.verdict.source_sha256, SOURCE_SHA);
  assert.deepEqual(refusal.verdict.provider_failure, {
    schema_version: "wss.openrouter_failure.v1",
    provider: "openrouter",
    operation: "video_submit",
    http_status: 400,
    parameter: "frame_images",
  });

  await assert.rejects(
    runner.submitAndDownload(config, normalized, photo),
    /seedance_submit_reconciliation_required/,
  );
  assert.equal(providerPosts, 1, "the same rejected source checkpoint must never POST again");
});

test("an untrusted polling URL is refused without leaking the OpenRouter bearer", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-hostile-poll-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const calls = [];
  const config = seedanceConfig({
    openrouterApiKey: "never-send-to-evil",
    reviewDir,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return response(202, { id: "evil", polling_url: "https://evil.example/collect" });
    },
  });
  await assert.rejects(
    runner.submitAndDownload(config, job(), runner.selectOwnedScene(job())),
    /seedance_submit_reconciliation_required/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, runner.OPENROUTER_VIDEO_ENDPOINT);
  assert.match(calls[0].options.headers.authorization, /^Bearer /);
});

test("a signed cross-origin output is downloaded without OpenRouter auth", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-signed-output-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const clipBytes = validMp4();
  let downloadedUrl;
  const config = seedanceConfig({
    openrouterApiKey: "openrouter-secret",
    reviewDir,
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        return response(202, { id: "signed", polling_url: "/api/v1/videos/jobs/signed" });
      }
      if (url === "https://openrouter.ai/api/v1/videos/jobs/signed") {
        assert.equal(options.headers.authorization, "Bearer openrouter-secret");
        return response(200, {
          status: "completed",
          output: { url: "https://signed-cdn.example/hero.mp4?sig=abc" },
          usage: { cost: 0.12 },
        });
      }
      throw new Error(`unexpected_url:${url}`);
    },
    downloadImpl: async (url, options) => {
      assert.equal(url, "https://signed-cdn.example/hero.mp4?sig=abc");
      downloadedUrl = url;
      assert.equal(options.timeoutMs, config.downloadTimeoutMs);
      return clipBytes;
    },
  });
  const generated = await runner.submitAndDownload(config, job(), runner.selectOwnedScene(job()));
  assert.equal(generated.clip.ok, true);
  assert.equal(downloadedUrl, "https://signed-cdn.example/hero.mp4?sig=abc");
});

test("provider download enforces the canonical upload aspect and size guards", async (t) => {
  async function downloadClip(clipBytes, suffix) {
    const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `wss-seedance-aspect-${suffix}-`));
    t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
    const config = seedanceConfig({
      openrouterApiKey: "openrouter-key",
      reviewDir,
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
          return response(202, { id: suffix, polling_url: `/api/v1/videos/jobs/${suffix}` });
        }
        if (url === `https://openrouter.ai/api/v1/videos/jobs/${suffix}`) {
          return response(200, {
            status: "completed",
            output: { url: `https://signed-cdn.example/${suffix}.mp4` },
            usage: { cost: 0.12 },
          });
        }
        throw new Error(`unexpected_url:${url}`);
      },
      downloadImpl: async () => clipBytes,
    });
    return runner.submitAndDownload(config, job({ job_id: `hrj_${suffix}` }), runner.selectOwnedScene(job()));
  }

  await assert.rejects(
    downloadClip(validMp4(8000, { width: 720, height: 1280 }), "portrait"),
    /clip_dimensions_out_of_range/,
  );
  await assert.rejects(
    downloadClip(validMp4(8000, { width: 320, height: 720 }), "too-small"),
    /clip_dimensions_out_of_range/,
  );
});

test("relative polling URLs resolve only onto the documented OpenRouter origin", async () => {
  const checked = await runner.validatePublicOutputUrl(
    "https://cdn.example/video.mp4",
    async () => [{ address: "8.8.8.8", family: 4 }],
  );
  assert.equal(checked.url.hostname, "cdn.example");
  for (const hostile of [
    "https://user:pass@cdn.example/video.mp4",
    "https://cdn.example:8443/video.mp4",
    "https://127.0.0.1/video.mp4",
    "https://169.254.169.254/latest/meta-data",
    "https://192.0.2.2/video.mp4",
    "https://[::1]/video.mp4",
    "https://[2001:db8::1]/video.mp4",
  ]) {
    await assert.rejects(
      runner.validatePublicOutputUrl(hostile, async () => [{ address: "8.8.8.8", family: 4 }]),
      /openrouter_output_url_refused/,
    );
  }
  await assert.rejects(
    runner.validatePublicOutputUrl("https://rebind.example/video.mp4", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /openrouter_output_url_refused/,
  );
});

test("owned-image redirects stay on the exact host", async () => {
  const lookupImpl = async () => [{ address: "8.8.8.8", family: 4 }];
  const sameHost = fakeHttps([
    { status: 302, headers: { location: "https://images.example/final.webp" } },
    { status: 200, body: Buffer.from("owned-bytes") },
  ]);
  const bytes = await runner.downloadPublicOutput("https://images.example/start.webp", {
    requiredHost: "images.example", lookupImpl, httpsImpl: sameHost, maxBytes: 1024,
  });
  assert.equal(bytes.toString(), "owned-bytes");

  const crossHost = fakeHttps([{ status: 302, headers: { location: "https://other.example/final.webp" } }]);
  await assert.rejects(
    runner.downloadPublicOutput("https://images.example/start.webp", {
      requiredHost: "images.example", lookupImpl, httpsImpl: crossHost, maxBytes: 1024,
    }),
    /public_download_owner_redirect_refused/,
  );
});

test("the public downloader carries the final GET content type into source admission", async () => {
  const downloaded = await runner.downloadPublicOutput("https://images.example/owned.jpg", {
    includeResponseMetadata: true,
    lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
    httpsImpl: fakeHttps([{
      status: 200,
      headers: { "content-type": "image/jpeg; charset=binary" },
      body: SOURCE_BYTES,
    }]),
    maxBytes: 1024,
  });
  assert.deepEqual(downloaded.bytes, SOURCE_BYTES);
  assert.equal(downloaded.contentType, "image/jpeg");
});

test("the output downloader pins DNS, strips cross-origin auth, and refuses private redirects", async () => {
  const observed = [];
  const clip = validMp4();
  const downloaded = await runner.downloadPublicOutput("https://signed.example/hero.mp4", {
    openrouterApiKey: "must-not-leak",
    lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
    httpsImpl: fakeHttps([{ body: clip }], observed),
    timeoutMs: 1_000,
  });
  assert.deepEqual(downloaded, clip);
  assert.equal(observed[0].address, "8.8.8.8");
  assert.equal(observed[0].headers.authorization, undefined);

  const redirectObserved = [];
  await assert.rejects(
    runner.downloadPublicOutput("https://signed.example/hero.mp4", {
      openrouterApiKey: "must-not-leak",
      lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
      httpsImpl: fakeHttps([{
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data" },
      }], redirectObserved),
      timeoutMs: 1_000,
    }),
    /openrouter_output_url_refused/,
  );
  assert.equal(redirectObserved.length, 1, "the private redirect was never requested");

  const authObserved = [];
  await runner.downloadPublicOutput(
    "https://openrouter.ai/api/v1/videos/job/content?index=0",
    {
      openrouterApiKey: "openrouter-secret",
      lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
      httpsImpl: fakeHttps([
        { status: 302, headers: { location: "https://signed.example/hero.mp4" } },
        { body: clip },
      ], authObserved),
      timeoutMs: 1_000,
    },
  );
  assert.equal(authObserved[0].headers.authorization, "Bearer openrouter-secret");
  assert.equal(authObserved[1].headers.authorization, undefined, "redirecting off origin strips the bearer");
});

test("the output downloader preserves its public error while exposing the HTTP status to source callers", async () => {
  await assert.rejects(
    runner.downloadPublicOutput("https://signed.example/missing.mp4", {
      lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
      httpsImpl: fakeHttps([{ status: 404 }]),
      timeoutMs: 1_000,
    }),
    (error) => error?.message === "openrouter_download_failed" && error?.httpStatus === 404,
  );
});

test("the pinned output socket refuses a DNS-rebound remote address", async () => {
  await assert.rejects(
    runner.downloadPublicOutput("https://rebind.example/hero.mp4", {
      lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
      httpsImpl: fakeHttps([{ remoteAddress: "127.0.0.1", body: validMp4() }]),
      timeoutMs: 1_000,
    }),
    /openrouter_output_dns_rebinding_refused/,
  );
});

test("missing cost and a spend-ceiling breach fail closed", async (t) => {
  for (const [label, usage, expected] of [
    ["missing", {}, /openrouter_cost_unavailable/],
    ["over", { cost: 0.51 }, /openrouter_cost_ceiling_exceeded/],
  ]) {
    const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `wss-seedance-cost-${label}-`));
    t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
    const config = seedanceConfig({
      openrouterApiKey: "openrouter-secret",
      reviewDir,
      maxCostUsd: 0.25,
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
          return response(202, { id: label, polling_url: `/api/v1/videos/jobs/${label}` });
        }
        return response(200, { status: "completed", usage });
      },
    });
    await assert.rejects(
      runner.submitAndDownload(config, job(), runner.selectOwnedScene(job())),
      expected,
    );
  }
});

test("a crash after the accepted checkpoint resumes polling without another paid submit", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-checkpoint-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const clipBytes = validMp4();
  let providerSubmits = 0;
  let crashOnce = true;
  const config = seedanceConfig({
    openrouterApiKey: "openrouter-secret",
    reviewDir,
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerSubmits += 1;
        assert.equal(options.headers["idempotency-key"], undefined);
        return response(202, { id: "checkpoint", polling_url: "/api/v1/videos/jobs/checkpoint" });
      }
      if (url === "https://openrouter.ai/api/v1/videos/jobs/checkpoint") {
        if (crashOnce) {
          crashOnce = false;
          throw new Error("simulated_process_crash");
        }
        return response(200, {
          status: "completed",
          output: { url: "https://openrouter.ai/api/v1/videos/jobs/checkpoint/content" },
          usage: { cost: 0.12 },
        });
      }
      throw new Error(`unexpected_url:${url}`);
    },
    downloadImpl: async () => clipBytes,
  });
  await assert.rejects(
    runner.submitAndDownload(config, job(), runner.selectOwnedScene(job())),
    /simulated_process_crash/,
  );
  const recovered = await runner.submitAndDownload(config, job(), runner.selectOwnedScene(job()));
  assert.equal(recovered.clip.ok, true);
  assert.equal(providerSubmits, 1);
});

test("source bytes must match the harvested SHA before any provider checkpoint or spend", async () => {
  let checkpoints = 0;
  let providerCalls = 0;
  const normalized = job();
  const config = seedanceConfig({
    openrouterApiKey: "openrouter-key",
    sourceDownloadImpl: async () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("changed")]),
    persistCheckpointImpl: async () => { checkpoints += 1; return { ok: true }; },
    fetchImpl: async () => { providerCalls += 1; throw new Error("must_not_call"); },
  });
  await assert.rejects(
    runner.submitAndDownload(config, normalized, runner.selectOwnedScene(normalized)),
    /source_sha256_mismatch/,
  );
  assert.equal(checkpoints, 0);
  assert.equal(providerCalls, 0);
});

test("source admission accepts only the four frozen formats at the exact geometry edges", async () => {
  const cases = [
    { bytes: jpegBytes(300, 750), contentType: "image/jpeg", width: 300, height: 750, mime: "image/jpeg" },
    { bytes: pngBytes(6000, 2400), contentType: "image/png; charset=binary", width: 6000, height: 2400, mime: "image/png" },
    { bytes: webpBytes(300, 300), contentType: "image/webp", width: 300, height: 300, mime: "image/webp" },
    { bytes: gifBytes(6000, 6000), contentType: "image/gif", width: 6000, height: 6000, mime: "image/gif" },
  ];
  for (const item of cases) {
    const digest = createHash("sha256").update(item.bytes).digest("hex");
    const photo = {
      ...job().photos[0],
      sha256: digest,
      width: item.width,
      height: item.height,
    };
    const admitted = await runner.verifiedSourceImage(seedanceConfig({
      sourceDownloadImpl: async () => ({ bytes: item.bytes, contentType: item.contentType }),
    }), photo);
    assert.equal(admitted.mime, item.mime);
    assert.equal(admitted.width, item.width);
    assert.equal(admitted.height, item.height);
    assert.equal(createHash("sha256").update(admitted.bytes).digest("hex"), digest);
    assert.deepEqual(admitted.bytes, item.bytes, "admission must not re-encode source bytes");
  }
});

test("source admission boundaries refuse before checkpoint or provider work", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-source-admission-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const avif = Buffer.alloc(24);
  avif.write("ftyp", 4, 4, "ascii");
  avif.write("avif", 8, 4, "ascii");
  const cases = [
    { label: "299 edge", bytes: jpegBytes(299, 600), width: 299, height: 600, contentType: "image/jpeg", reason: "source_image_dimensions_invalid" },
    { label: "6001 edge", bytes: jpegBytes(6001, 3000), width: 6001, height: 3000, contentType: "image/jpeg", reason: "source_image_dimensions_invalid" },
    { label: "0.399 aspect", bytes: jpegBytes(399, 1000), width: 399, height: 1000, contentType: "image/jpeg", reason: "source_image_aspect_invalid" },
    { label: "2.501 aspect", bytes: jpegBytes(2501, 1000), width: 2501, height: 1000, contentType: "image/jpeg", reason: "source_image_aspect_invalid" },
    { label: "declared mismatch", bytes: jpegBytes(1600, 900), width: 1601, height: 900, contentType: "image/jpeg", reason: "source_image_dimensions_mismatch" },
    { label: "content type mismatch", bytes: jpegBytes(1600, 900), width: 1600, height: 900, contentType: "image/png", reason: "source_image_content_type_mismatch" },
    { label: "unsupported format", bytes: avif, width: 1600, height: 900, contentType: "image/avif", reason: "source_image_type_invalid" },
  ];
  let providerCalls = 0;
  let checkpoints = 0;
  for (const [index, item] of cases.entries()) {
    const digest = createHash("sha256").update(item.bytes).digest("hex");
    const candidate = job({
      job_id: `hrj_source_boundary_${index}`,
      lease_token: `lease-source-boundary-${index}`,
      photo_bank: { photos: [{
        ...job().photos[0],
        sha256: digest,
        width: item.width,
        height: item.height,
      }] },
    });
    const result = await runner.processJob(seedanceConfig({
      apiBase: "https://ghost.example",
      reviewDir,
      openrouterApiKey: "openrouter-key",
      sourceDownloadImpl: async () => ({ bytes: item.bytes, contentType: item.contentType }),
      persistCheckpointImpl: async () => { checkpoints += 1; return { ok: true }; },
      fetchImpl: async (url, options = {}) => {
        if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
          providerCalls += 1;
          throw new Error("invalid_source_must_not_reach_provider");
        }
        assert.equal(url, "https://ghost.example/api/admin/hero-reel");
        assert.equal(JSON.parse(options.body).action, "refuse");
        return response(200, { ok: true });
      },
    }), candidate);
    assert.equal(result.status, "refused", item.label);
    assert.equal(result.reason, item.reason, item.label);
  }
  assert.equal(checkpoints, 0);
  assert.equal(providerCalls, 0);
});

test("an invalid frozen photo rotates to the next admitted owned scene", async () => {
  const invalidBytes = jpegBytes(299, 600);
  const invalidSha = createHash("sha256").update(invalidBytes).digest("hex");
  const candidate = job({
    photo_bank: { photos: [
      {
        ...job().photos[0],
        url: "https://client.example/work/too-small.jpg",
        sha256: invalidSha,
        width: 299,
        height: 600,
      },
      { ...job().photos[0] },
    ] },
  });
  const attempts = [];
  const selected = await runner.selectVerifiedOwnedScene(seedanceConfig({
    sourceDownloadImpl: async (url) => {
      attempts.push(url);
      const bytes = url.includes("too-small") ? invalidBytes : SOURCE_BYTES;
      return { bytes, contentType: "image/jpeg" };
    },
  }), candidate);
  assert.equal(selected.photo.url, SOURCE_URL);
  assert.deepEqual(selected.source.bytes, SOURCE_BYTES);
  assert.deepEqual(attempts, ["https://client.example/work/too-small.jpg", SOURCE_URL]);
});

test("source publication failure leaves the durable intent and makes zero OpenRouter calls", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-source-store-fail-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const checkpoints = [];
  let providerCalls = 0;
  const config = seedanceConfig({
    reviewDir,
    openrouterApiKey: "openrouter-key",
    sourceAssetStore: {
      ensureBucket: async () => ({ ok: true }),
      putContentAddressed: async () => ({ ok: false, reason: "source_store_write_failed" }),
    },
    persistCheckpointImpl: async ({ checkpoint }) => {
      checkpoints.push(structuredClone(checkpoint));
      return { ok: true };
    },
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("must_not_call_openrouter");
    },
  });
  await assert.rejects(
    runner.submitAndDownload(config, job(), runner.selectOwnedScene(job())),
    /source_store_write_failed/,
  );
  assert.equal(providerCalls, 0);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].submission_state, "intent");
  assert.equal(checkpoints[0].polling_url, "");
});

test("an oversized first scene is skipped for the next frozen owned photo", async () => {
  const oversizedSha = "a".repeat(64);
  const candidateJob = job({
    photo_bank: { photos: [
      {
        ...job().photos[0],
        url: "https://client.example/work/oversized.jpg",
        sha256: oversizedSha,
      },
      { ...job().photos[0] },
    ] },
  });
  const attempts = [];
  const selected = await runner.selectVerifiedOwnedScene(seedanceConfig({
    sourceDownloadImpl: async (url, options) => {
      attempts.push({ url, maxBytes: options.maxBytes });
      if (url.includes("oversized")) throw new Error("openrouter_clip_size_invalid");
      return SOURCE_BYTES;
    },
  }), candidateJob);
  assert.equal(selected.photo.url, SOURCE_URL);
  assert.deepEqual(selected.source.bytes, SOURCE_BYTES);
  assert.deepEqual(attempts.map((item) => item.url), [
    "https://client.example/work/oversized.jpg",
    SOURCE_URL,
  ]);
  assert.deepEqual([...new Set(attempts.map((item) => item.maxBytes))], [4_000_000]);
});

test("a dead owned-image URL rotates to the next verified scene", async () => {
  const deadUrl = "https://client.example/work/dead.jpg";
  const candidateJob = job({
    photo_bank: { photos: [
      { ...job().photos[0], url: deadUrl },
      { ...job().photos[0] },
    ] },
  });
  const attempts = [];
  const selected = await runner.selectVerifiedOwnedScene(seedanceConfig({
    sourceDownloadImpl: async (url) => {
      attempts.push(url);
      if (url === deadUrl) {
        const error = new Error("openrouter_download_failed");
        error.httpStatus = 404;
        throw error;
      }
      return SOURCE_BYTES;
    },
  }), candidateJob);
  assert.equal(selected.photo.url, SOURCE_URL);
  assert.deepEqual(selected.source.bytes, SOURCE_BYTES);
  assert.deepEqual(attempts, [deadUrl, SOURCE_URL]);
});

test("an exhausted permanent source URL is terminally refused without a provider call", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-source-dead-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const actions = [];
  let providerCalls = 0;
  const result = await runner.processJob(seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sourceDownloadImpl: async () => {
      const error = new Error("openrouter_download_failed");
      error.httpStatus = 404;
      throw error;
    },
    fetchImpl: async (url, options = {}) => {
      if (url === "https://ghost.example/api/admin/hero-reel") {
        actions.push(JSON.parse(options.body));
        return response(200, { ok: true });
      }
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) providerCalls += 1;
      throw new Error(`unexpected_url:${url}`);
    },
  }), job({ attempts: 108 }));
  assert.deepEqual(result, { status: "refused", reason: "source_image_http_404" });
  assert.equal(providerCalls, 0);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "refuse");
  assert.equal(actions[0].verdict.reason, "source_image_http_404");
  assert.equal(actions[0].verdict.retry_without_generation, undefined);
});

test("transient source HTTP failures requeue only through the bounded attempt limit", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-source-bounded-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const actions = [];
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sourceRetryAttempts: 2,
    sourceDownloadImpl: async () => {
      const error = new Error("openrouter_download_failed");
      error.httpStatus = 503;
      throw error;
    },
    fetchImpl: async (url, options = {}) => {
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      actions.push(JSON.parse(options.body));
      return response(200, { ok: true });
    },
  });
  const first = await runner.processJob(config, job({ attempts: 1 }));
  const exhausted = await runner.processJob(config, job({ attempts: 2, lease_token: "lease-2" }));
  assert.deepEqual(first, {
    status: "queued",
    reason: "source_image_http_503",
    retry_without_generation: true,
  });
  assert.deepEqual(exhausted, {
    status: "refused",
    reason: "source_image_http_503_retry_exhausted",
  });
  assert.deepEqual(actions.map((action) => action.action), ["requeue", "refuse"]);
  assert.equal(actions[1].verdict.detail, "source_attempts=2");
  assert.equal(actions[1].verdict.retry_without_generation, undefined);
});

test("a transient source-proxy outage requeues before any paid provider call", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-source-proxy-retry-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const actions = [];
  let providerCalls = 0;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sourceAssetStore: null,
    persistCheckpointImpl: async () => ({ ok: true }),
    fetchImpl: async (url, options = {}) => {
      if (url === "https://ghost.example/api/admin/hero-source-asset") {
        return response(503, { ok: false, error: "source_asset_storage_unavailable" });
      }
      if (url === "https://ghost.example/api/admin/hero-reel") {
        actions.push(JSON.parse(options.body));
        return response(200, { ok: true });
      }
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) providerCalls += 1;
      throw new Error(`unexpected_url:${url}`);
    },
  });
  const result = await runner.processJob(config, job());
  assert.equal(result.status, "queued");
  assert.equal(result.reason, "seedance_source_publish_unavailable");
  assert.equal(result.retry_without_generation, true);
  assert.equal(providerCalls, 0);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "requeue");
  assert.equal(actions[0].verdict.provider_checkpoint.submission_state, "intent");
});

test("a raw source socket reset is normalized and requeued without paid work", async () => {
  const actions = [];
  const networkError = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    sourceDownloadImpl: async () => { throw networkError; },
    fetchImpl: async (url, options = {}) => {
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      actions.push(JSON.parse(options.body));
      return response(200, { ok: true });
    },
  });
  const result = await runner.processJob(config, job());
  assert.equal(result.status, "queued");
  assert.equal(result.reason, "source_image_download_unavailable");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "requeue");
  assert.equal(actions[0].verdict.provider_checkpoint, undefined);
});

test("an immutable public-read socket reset is normalized before paid work", async () => {
  const sourceBytes = Buffer.from(SOURCE_BYTES);
  const frozen = job();
  const key = SOURCE_ASSET_KEY;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    sourceAssetStore: null,
    fetchImpl: async () => response(200, {
      ok: true,
      key,
      url: `https://cdn.wss-ai.com/${key}`,
      sha256: SOURCE_SHA,
    }),
    publicSourceDownloadImpl: async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    },
  });
  await assert.rejects(
    runner.immutableProviderSource(
      config,
      frozen,
      { bytes: sourceBytes, mime: "image/jpeg", url: SOURCE_URL },
      frozen.photos[0],
    ),
    /seedance_source_public_read_unavailable/,
  );
});

test("a legacy accepted four-second job resumes polling with zero provider submits", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-legacy-four-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const legacy = job({ duration_seconds: 4, lease_token: "lease-legacy-four" });
  const photo = runner.selectOwnedScene(legacy);
  legacy.providerCheckpoint = {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: legacy.jobId,
    prospect_id: legacy.prospectId,
    generation_revision: legacy.generationRevision,
    source_sha256: photo.sha256,
    source_mime: "image/jpeg",
    source_bytes: SOURCE_BYTES.length,
    model_id: validation.SEEDANCE_MODEL_ID,
    duration_seconds: 4,
    intent_sha256: runner.generationIdentity(legacy, photo),
    submission_state: "accepted",
    polling_url: "https://openrouter.ai/api/v1/videos/jobs/legacy-four",
    provider_job_id: "legacy-four",
    created_at: "2026-08-21T20:00:00.000Z",
    submit_started_at: "2026-08-21T20:00:01.000Z",
    submitted_at: "2026-08-21T20:00:02.000Z",
  };
  let providerSubmits = 0;
  let polls = 0;
  const config = seedanceConfig({
    reviewDir,
    openrouterApiKey: "openrouter-key",
    sourceDownloadImpl: async () => { throw new Error("accepted_checkpoint_must_not_refetch_source"); },
    fetchImpl: async (url) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerSubmits += 1;
        throw new Error("must_not_resubmit");
      }
      assert.equal(url, "https://openrouter.ai/api/v1/videos/jobs/legacy-four");
      polls += 1;
      return response(200, {
        status: "completed",
        output: { url: "https://openrouter.ai/api/v1/videos/jobs/legacy-four/content" },
        usage: { cost: 0.12 },
      });
    },
    downloadImpl: async () => validMp4(4000),
  });
  const recovered = await runner.submitAndDownload(config, legacy, photo);
  assert.equal(recovered.clip.durationSec, 4);
  assert.equal(providerSubmits, 0);
  assert.equal(polls, 1);
});

test("an accepted historical source over four MB resumes polling with zero resubmit", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-large-accepted-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const historical = job({
    photo_bank: { photos: [{ ...job().photos[0], bytes: 5_000_000 }] },
  });
  const photo = historical.photos[0];
  historical.providerCheckpoint = {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: historical.jobId,
    prospect_id: historical.prospectId,
    generation_revision: historical.generationRevision,
    source_sha256: photo.sha256,
    source_mime: "image/jpeg",
    source_bytes: 5_000_000,
    model_id: validation.SEEDANCE_MODEL_ID,
    duration_seconds: 8,
    intent_sha256: runner.generationIdentity(historical, photo),
    submission_state: "accepted",
    polling_url: "https://openrouter.ai/api/v1/videos/jobs/large-accepted",
    provider_job_id: "large-accepted",
    created_at: "2026-08-21T20:00:00.000Z",
    submit_started_at: "2026-08-21T20:00:01.000Z",
    submitted_at: "2026-08-21T20:00:02.000Z",
  };
  let providerSubmits = 0;
  const config = seedanceConfig({
    reviewDir,
    openrouterApiKey: "openrouter-key",
    sourceAssetStore: null,
    sourceDownloadImpl: async () => { throw new Error("accepted_checkpoint_must_not_refetch_source"); },
    fetchImpl: async (url) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) providerSubmits += 1;
      assert.equal(url, "https://openrouter.ai/api/v1/videos/jobs/large-accepted");
      return response(200, {
        status: "completed",
        output: { url: "https://openrouter.ai/api/v1/videos/jobs/large-accepted/content" },
        usage: { cost: 0.12 },
      });
    },
    downloadImpl: async () => validMp4(),
  });
  const selected = runner.selectOwnedScene(historical);
  assert.equal(selected.sha256, photo.sha256);
  const recovered = await runner.submitAndDownload(config, historical, selected);
  assert.equal(recovered.clip.ok, true);
  assert.equal(providerSubmits, 0);
});

test("a durable accepted checkpoint survives a different host with an empty review directory", async (t) => {
  const firstDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-host-a-"));
  const secondDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-host-b-"));
  t.after(() => Promise.all([
    fs.promises.rm(firstDir, { recursive: true, force: true }),
    fs.promises.rm(secondDir, { recursive: true, force: true }),
  ]));
  let durable = null;
  let submits = 0;
  const firstJob = job();
  const first = seedanceConfig({
    reviewDir: firstDir,
    openrouterApiKey: "openrouter-secret",
    persistCheckpointImpl: async ({ checkpoint }) => { durable = structuredClone(checkpoint); return { ok: true }; },
    fetchImpl: async (url) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        submits += 1;
        return response(202, { id: "cross-host", polling_url: "/api/v1/videos/jobs/cross-host" });
      }
      throw new Error("host_a_crashed");
    },
  });
  await assert.rejects(
    runner.submitAndDownload(first, firstJob, runner.selectOwnedScene(firstJob)),
    /host_a_crashed/,
  );
  assert.equal(durable.submission_state, "accepted");

  const secondJob = job({ provider_checkpoint: durable, lease_token: "lease-host-b" });
  const second = seedanceConfig({
    reviewDir: secondDir,
    openrouterApiKey: "openrouter-secret",
    sourceDownloadImpl: async () => { throw new Error("accepted_checkpoint_must_not_refetch_source"); },
    fetchImpl: async (url) => {
      assert.equal(url, "https://openrouter.ai/api/v1/videos/jobs/cross-host");
      return response(200, {
        status: "completed",
        output: { url: "https://openrouter.ai/api/v1/videos/jobs/cross-host/content" },
        usage: { cost: 0.12 },
      });
    },
    downloadImpl: async () => validMp4(),
  });
  const recovered = await runner.submitAndDownload(second, secondJob, runner.selectOwnedScene(secondJob));
  assert.equal(recovered.clip.ok, true);
  assert.equal(submits, 1);
});

test("accepted transient poll failure requeues immediately with the durable checkpoint", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-transient-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  let durable;
  let requeue;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    persistCheckpointImpl: async ({ checkpoint }) => { durable = structuredClone(checkpoint); return { ok: true }; },
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        return response(202, { id: "transient", polling_url: "/api/v1/videos/jobs/transient" });
      }
      if (url === "https://openrouter.ai/api/v1/videos/jobs/transient") return response(503, {});
      if (url === "https://ghost.example/api/admin/hero-reel") {
        requeue = JSON.parse(options.body);
        return response(200, { ok: true });
      }
      throw new Error(`unexpected_url:${url}`);
    },
  });
  const result = await runner.processJob(config, job());
  assert.equal(result.status, "queued");
  assert.equal(result.retry_without_generation, true);
  assert.equal(durable.submission_state, "accepted");
  assert.equal(requeue.action, "requeue");
  assert.equal(requeue.verdict.provider_checkpoint.submission_state, "accepted");
});

test("a lost accepted-checkpoint response requeues from the local accepted mirror", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-accepted-write-loss-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  let requeue;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    persistCheckpointImpl: async ({ checkpoint }) => {
      if (checkpoint.submission_state === "accepted") throw new Error("fetch failed");
      return { ok: true };
    },
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        return response(202, { id: "accepted-write-loss", polling_url: "/api/v1/videos/jobs/accepted-write-loss" });
      }
      if (url === "https://ghost.example/api/admin/hero-reel") {
        requeue = JSON.parse(options.body);
        return response(200, { ok: true });
      }
      throw new Error(`unexpected_url:${url}`);
    },
  });
  const result = await runner.processJob(config, job());
  assert.equal(result.status, "queued");
  assert.equal(result.reason, "fetch_failed");
  assert.equal(requeue.action, "requeue");
  assert.equal(requeue.verdict.provider_checkpoint.submission_state, "accepted");
});

test("a long Seedance task heartbeats the exact slot lease", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-heartbeat-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const renewals = [];
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    heartbeatMs: 2,
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        return response(202, { id: "heartbeat", polling_url: "/api/v1/videos/jobs/heartbeat" });
      }
      if (url === "https://openrouter.ai/api/v1/videos/jobs/heartbeat") {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return response(200, {
          status: "completed",
          output: { url: "https://openrouter.ai/api/v1/videos/jobs/heartbeat/content" },
          usage: { cost: 0.12 },
        });
      }
      if (url === "https://ghost.example/api/admin/hero-reel") {
        const body = JSON.parse(options.body);
        if (body.action === "renew") renewals.push(body);
        return response(200, { ok: true });
      }
      throw new Error(`unexpected_url:${url}`);
    },
    downloadImpl: async () => validMp4(),
  });
  const result = await runner.processJob(config, job({ worker_id: "seedance-slot-3" }));
  assert.equal(result.status, "awaiting_review");
  assert.ok(renewals.length >= 1);
  assert.equal(renewals[0].worker_id, "seedance-slot-3");
});

test("a crash exactly after provider acceptance but before polling persistence holds for owner review and never resubmits", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-paid-window-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  let providerSubmits = 0;
  let holdVerdict;
  const normalized = job();
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    afterProviderAccepted: async () => { throw new Error("crash_after_accept_before_persist"); },
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerSubmits += 1;
        assert.equal(options.headers["idempotency-key"], undefined);
        return response(202, { id: "paid-job", polling_url: "/api/v1/videos/paid-job" });
      }
      if (url === "https://ghost.example/api/admin/hero-reel") {
        const body = JSON.parse(options.body);
        assert.equal(body.action, "hold");
        holdVerdict = body.verdict;
        return response(200, { ok: true });
      }
      throw new Error(`unexpected_url:${url}`);
    },
  });
  const result = await runner.processJob(config, normalized);
  assert.equal(result.status, "awaiting_review");
  assert.equal(result.reason, runner.SUBMIT_REVIEW_REASON);
  assert.equal(providerSubmits, 1);
  assert.equal(holdVerdict.approved_artifact, undefined);
  assert.equal(holdVerdict.provider_submission_review.schema_version, "wss.hero.seedance_submit_review.v1");

  await assert.rejects(
    runner.submitAndDownload(config, normalized, runner.selectOwnedScene(normalized)),
    /seedance_submit_reconciliation_required/,
  );
  assert.equal(providerSubmits, 1, "an ambiguous accepted request can only be regenerated by owner action");
  const checkpoint = await runner.readProviderCheckpoint(
    reviewDir,
    normalized,
    runner.selectOwnedScene(normalized),
  );
  assert.equal(checkpoint.submission_state, "submitting");
  assert.equal(checkpoint.polling_url, "");
});

test("a lost hold response settles in the same lease without a second provider spend", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-reconcile-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const clipBytes = validMp4();
  let providerSubmits = 0;
  let holdCalls = 0;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerSubmits += 1;
        return response(202, { id: "reconcile", polling_url: "/api/v1/videos/jobs/reconcile" });
      }
      if (url === "https://openrouter.ai/api/v1/videos/jobs/reconcile") {
        return response(200, {
          status: "completed",
          output: { url: "https://openrouter.ai/api/v1/videos/jobs/reconcile/content" },
          usage: { cost: 0.12 },
        });
      }
      if (url === "https://ghost.example/api/admin/hero-reel") {
        const action = JSON.parse(options.body).action;
        if (action === "hold") {
          holdCalls += 1;
          if (holdCalls === 1) throw new Error("lost_hold_response");
          return response(200, { ok: true });
        }
        throw new Error(`unexpected_settlement:${action}`);
      }
      throw new Error(`unexpected_url:${url}`);
    },
    downloadImpl: async () => clipBytes,
  });
  const first = await runner.processJob(config, job());
  assert.equal(first.status, "awaiting_review");
  assert.equal(providerSubmits, 1);
  assert.equal(holdCalls, 2);
});

test("capability settlement retries one lost response with the same lease", async () => {
  let calls = 0;
  const waits = [];
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    capabilityMode: true,
    capabilityPhase: "generate",
    workerToken: "",
    sleepImpl: async (ms) => waits.push(ms),
    fetchImpl: async (url, options = {}) => {
      assert.equal(url, "https://ghost.example/api/admin/hero-job-capability");
      assert.equal(options.headers["x-ghost-hero-job-lease"], "lease-1");
      const body = JSON.parse(options.body);
      assert.equal(body.action, "settle");
      assert.equal(body.outcome, "hold");
      calls += 1;
      if (calls === 1) throw new Error("lost_settle_response");
      return response(200, { ok: true, status: "awaiting_review" });
    },
  });

  const settled = await runner.settleJob(config, job(), "hold", { ok: true });
  assert.equal(settled.status, "awaiting_review");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [250]);
});

test("capability settlement never retries a rejected oversized payload", async () => {
  let calls = 0;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    capabilityMode: true,
    capabilityPhase: "generate",
    workerToken: "",
    sleepImpl: async () => { throw new Error("unexpected_retry"); },
    fetchImpl: async () => {
      calls += 1;
      return response(413, {});
    },
  });

  await assert.rejects(runner.settleJob(config, job(), "hold", { ok: true }), /seedance_settle_failed/);
  assert.equal(calls, 1);
});

test("new Seedance job generates once, freezes review evidence, and holds for approval", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-test-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const clipBytes = validMp4();
  const calls = [];
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        const input = JSON.parse(options.body);
        assert.equal(input.duration, 8);
        assert.equal(input.generate_audio, false);
        assert.equal(input.frame_images[0].image_url.url, SOURCE_ASSET_URL);
        assert.match(input.frame_images[0].image_url.url, /^https:\/\/our-cdn\.wss-ai\.com\/assets\/sha256\//);
        assert.doesNotMatch(input.frame_images[0].image_url.url, /client\.example|^data:/);
        return response(202, { id: "one", polling_url: "/api/v1/videos/jobs/1" });
      }
      if (url === "https://openrouter.ai/api/v1/videos/jobs/1") {
        return response(200, { status: "completed", output: { url: "https://openrouter.ai/api/v1/videos/jobs/1/content" }, usage: { cost: 0.12 } });
      }
      if (url === "https://ghost.example/api/admin/hero-reel") {
        assert.ok(Buffer.byteLength(options.body, "utf8") < 64 * 1024, "hold metadata must never embed the MP4 buffer");
        const body = JSON.parse(options.body);
        assert.equal(body.action, "hold");
        assert.equal(body.verdict.producer, policy.OPENROUTER_SEEDANCE_PRODUCER);
        assert.equal(body.verdict.generation_receipt.duration_seconds, 8);
        assert.equal(body.verdict.candidates[0].bytes, clipBytes.length);
        return response(200, { ok: true });
      }
      throw new Error(`unexpected_url:${url}`);
    },
    downloadImpl: async () => clipBytes,
  });
  const result = await runner.processJob(config, job());
  assert.equal(result.status, "awaiting_review", JSON.stringify(result));
  assert.equal(calls.filter((call) => call.url === runner.OPENROUTER_VIDEO_ENDPOINT).length, 1);
  const receipt = JSON.parse(await fs.promises.readFile(result.receiptPath, "utf8"));
  assert.equal(receipt.status, "awaiting_review");
  assert.equal(receipt.bytes, clipBytes.length);
  assert.equal(receipt.candidates[0].bytes, clipBytes.length);
  assert.ok((await fs.promises.stat(result.receiptPath)).size < 64 * 1024);
  assert.equal(receipt.generation_receipt.model_id, validation.SEEDANCE_MODEL_ID);
  assert.equal(receipt.generation_receipt.generate_audio, false);
  assert.equal(path.basename(receipt.source_path), `${SOURCE_SHA}.jpg`);
  assert.deepEqual(await fs.promises.readFile(receipt.source_path), SOURCE_BYTES);
  const sourceStat = await fs.promises.lstat(receipt.source_path);
  assert.equal(sourceStat.isFile(), true);
  assert.equal(sourceStat.isSymbolicLink(), false);
});

test("source visual preflight reuses the attester blank floor and rejects flat logo art", () => {
  const faintLogo = Buffer.alloc(64 * 64 * 3, 1);
  for (let y = 24; y < 40; y += 1) {
    for (let x = 22; x < 42; x += 1) {
      const offset = ((y * 64) + x) * 3;
      faintLogo[offset] = 9;
      faintLogo[offset + 1] = 9;
      faintLogo[offset + 2] = 9;
    }
  }
  assert.equal(runner.sourceFrameQuality(faintLogo).reason, "source_visual_frame_blank");

  const flatLogo = Buffer.alloc(64 * 64 * 3, 248);
  for (let y = 24; y < 40; y += 1) {
    for (let x = 22; x < 42; x += 1) {
      const offset = ((y * 64) + x) * 3;
      flatLogo[offset] = 20;
      flatLogo[offset + 1] = 20;
      flatLogo[offset + 2] = 20;
    }
  }
  assert.equal(runner.sourceFrameQuality(flatLogo).reason, "source_visual_logo_like");

  const realScene = Buffer.alloc(64 * 64 * 3);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const offset = ((y * 64) + x) * 3;
      realScene[offset] = ((x * 4) + y) % 256;
      realScene[offset + 1] = ((y * 4) + (x * 2)) % 256;
      realScene[offset + 2] = ((x * 3) + (y * 3)) % 256;
    }
  }
  assert.equal(runner.sourceFrameQuality(realScene).ok, true);
});

test("a square source rotates to a wide source before the only provider submit", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-source-shape-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const squareBytes = jpegBytes(1800, 1800, "square-source");
  const squareSha = createHash("sha256").update(squareBytes).digest("hex");
  const squareUrl = "https://client.example/work/square.jpg";
  const candidate = job({
    photo_bank: { photos: [
      { ...job().photos[0], url: squareUrl, sha256: squareSha, width: 1800, height: 1800 },
      { ...job().photos[0] },
    ] },
  });
  let providerSubmits = 0;
  const sourceDownloads = [];
  const result = await runner.processJob(seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sleepImpl: async () => {},
    sourceDownloadImpl: async (url) => {
      sourceDownloads.push(url);
      return url === squareUrl ? squareBytes : SOURCE_BYTES;
    },
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerSubmits += 1;
        const body = JSON.parse(options.body);
        assert.equal(body.frame_images[0].image_url.url, SOURCE_ASSET_URL);
        return response(202, { id: "wide-only", polling_url: "/api/v1/videos/jobs/wide-only" });
      }
      if (url === "https://openrouter.ai/api/v1/videos/jobs/wide-only") {
        return response(200, {
          status: "completed",
          output: { url: "https://openrouter.ai/api/v1/videos/jobs/wide-only/content" },
          usage: { cost: 0.12 },
        });
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      assert.equal(JSON.parse(options.body).action, "hold");
      return response(200, { ok: true });
    },
    downloadImpl: async () => validMp4(),
  }), candidate);
  assert.equal(result.status, "awaiting_review", JSON.stringify(result));
  assert.equal(providerSubmits, 1);
  assert.deepEqual(sourceDownloads, [squareUrl, SOURCE_URL]);
});

test("all non-hero-shaped sources make zero checkpoints and provider calls", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-all-source-shapes-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const squareBytes = jpegBytes(1800, 1800, "square-source");
  const portraitBytes = jpegBytes(900, 1600, "portrait-source");
  const squareUrl = "https://client.example/work/square.jpg";
  const portraitUrl = "https://client.example/work/portrait.jpg";
  const candidate = job({
    photo_bank: { photos: [
      {
        ...job().photos[0],
        url: squareUrl,
        sha256: createHash("sha256").update(squareBytes).digest("hex"),
        width: 1800,
        height: 1800,
      },
      {
        ...job().photos[0],
        url: portraitUrl,
        sha256: createHash("sha256").update(portraitBytes).digest("hex"),
        width: 900,
        height: 1600,
      },
    ] },
  });
  let checkpoints = 0;
  let providerCalls = 0;
  let settled;
  const result = await runner.processJob(seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sourceDownloadImpl: async (url) => url === squareUrl ? squareBytes : portraitBytes,
    persistCheckpointImpl: async () => { checkpoints += 1; return { ok: true }; },
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerCalls += 1;
        throw new Error("bad_shape_must_not_reach_provider");
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      settled = JSON.parse(options.body);
      return response(200, { ok: true });
    },
  }), candidate);
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "source_image_hero_aspect_invalid");
  assert.equal(settled.action, "refuse");
  assert.equal(checkpoints, 0);
  assert.equal(providerCalls, 0);
});

test("square provider output cannot persist an awaiting-review receipt", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-output-shape-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  let providerSubmits = 0;
  let settled;
  const result = await runner.processJob(seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerSubmits += 1;
        return response(202, { id: "square-output", polling_url: "/api/v1/videos/jobs/square-output" });
      }
      if (url === "https://openrouter.ai/api/v1/videos/jobs/square-output") {
        return response(200, {
          status: "completed",
          output: { url: "https://openrouter.ai/api/v1/videos/jobs/square-output/content" },
          usage: { cost: 0.12 },
        });
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      settled = JSON.parse(options.body);
      return response(200, { ok: true });
    },
    downloadImpl: async () => validMp4(8000, { width: 960, height: 960 }),
  }), job({ job_id: "hrj_square_output" }));
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "clip_dimensions_out_of_range");
  assert.equal(settled.action, "fail");
  assert.equal(providerSubmits, 1);
  const jobDir = path.join(reviewDir, "hrj_square_output");
  const reviewReceipts = (await fs.promises.readdir(jobDir))
    .filter((name) => /^[a-f0-9]{64}\.json$/i.test(name));
  assert.deepEqual(reviewReceipts, []);
});

test("default source visual preflight decodes the exact admitted bytes", async () => {
  let decoded = 0;
  const config = seedanceConfig({
    sourceDecodeImpl: async (sourcePath) => {
      decoded += 1;
      assert.deepEqual(await fs.promises.readFile(sourcePath), SOURCE_BYTES);
      const rgb = Buffer.alloc(64 * 64 * 3);
      for (let index = 0; index < rgb.length; index += 1) rgb[index] = index % 251;
      return rgb;
    },
  });
  delete config.sourceVisualPreflightImpl;
  const selected = await runner.selectVerifiedOwnedScene(config, job());
  assert.equal(selected.photo.url, SOURCE_URL);
  assert.equal(decoded, 1);
});

test("a blank verified source rotates to the next candidate before provider work", async () => {
  const blankBytes = jpegBytes(1600, 900, "blank-frame-source");
  const blankSha = createHash("sha256").update(blankBytes).digest("hex");
  const blankUrl = "https://client.example/work/blank.jpg";
  const candidate = job({
    photo_bank: { photos: [
      { ...job().photos[0], url: blankUrl, sha256: blankSha },
      { ...job().photos[0] },
    ] },
  });
  const inspected = [];
  const selected = await runner.selectVerifiedOwnedScene(seedanceConfig({
    sourceDownloadImpl: async (url) => url === blankUrl ? blankBytes : SOURCE_BYTES,
    sourceVisualPreflightImpl: async ({ photo }) => {
      inspected.push(photo.url);
      return photo.url === blankUrl
        ? { ok: false, reason: "source_visual_frame_blank" }
        : { ok: true };
    },
  }), candidate);
  assert.equal(selected.photo.url, SOURCE_URL);
  assert.deepEqual(selected.source.bytes, SOURCE_BYTES);
  assert.deepEqual(inspected, [blankUrl, SOURCE_URL]);
});

test("all visually unusable sources refuse before checkpoint or paid submit", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-source-visual-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  let checkpoints = 0;
  let providerCalls = 0;
  let settled;
  const result = await runner.processJob(seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sourceVisualPreflightImpl: async () => ({ ok: false, reason: "source_visual_logo_like" }),
    persistCheckpointImpl: async () => { checkpoints += 1; return { ok: true }; },
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerCalls += 1;
        throw new Error("unusable_source_must_not_reach_provider");
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      settled = JSON.parse(options.body);
      return response(200, { ok: true });
    },
  }), job());
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "source_visual_logo_like");
  assert.equal(settled.action, "refuse");
  assert.equal(checkpoints, 0);
  assert.equal(providerCalls, 0);
});

test("an intent checkpoint keeps its source SHA and blank art makes zero provider calls", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-intent-visual-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const base = job();
  const secondBytes = jpegBytes(1600, 900, "second-valid-scene");
  const secondSha = createHash("sha256").update(secondBytes).digest("hex");
  const secondUrl = "https://client.example/work/second.jpg";
  const intent = {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: base.jobId,
    prospect_id: base.prospectId,
    generation_revision: base.generationRevision,
    source_sha256: SOURCE_SHA,
    source_mime: "image/jpeg",
    source_bytes: SOURCE_BYTES.length,
    model_id: validation.SEEDANCE_MODEL_ID,
    duration_seconds: base.durationSeconds,
    intent_sha256: runner.generationIdentity(base, base.photos[0]),
    submission_state: "intent",
    polling_url: "",
    created_at: new Date().toISOString(),
  };
  const frozen = job({
    provider_checkpoint: intent,
    photo_bank: { photos: [
      { ...base.photos[0] },
      { ...base.photos[0], url: secondUrl, sha256: secondSha },
    ] },
  });
  const downloads = [];
  let checkpoints = 0;
  let providerCalls = 0;
  let settled;
  const result = await runner.processJob(seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sourceDownloadImpl: async (url) => {
      downloads.push(url);
      return url === secondUrl ? secondBytes : SOURCE_BYTES;
    },
    sourceVisualPreflightImpl: async () => ({ ok: false, reason: "source_visual_frame_blank" }),
    persistCheckpointImpl: async () => { checkpoints += 1; return { ok: true }; },
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerCalls += 1;
        throw new Error("blank_intent_must_not_reach_provider");
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      settled = JSON.parse(options.body);
      return response(200, { ok: true });
    },
  }), frozen);
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "source_visual_frame_blank");
  assert.equal(settled.action, "refuse");
  assert.deepEqual(downloads, [SOURCE_URL], "immutable intent must not rotate to a different photo SHA");
  assert.equal(checkpoints, 0);
  assert.equal(providerCalls, 0);
});

test("visual preflight outage uses bounded source requeue before any checkpoint or provider POST", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-visual-unavailable-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  let checkpoints = 0;
  let providerCalls = 0;
  let settled;
  const result = await runner.processJob(seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sourceRetryAttempts: 3,
    sourceVisualPreflightImpl: async () => ({ ok: false, reason: "source_visual_preflight_unavailable" }),
    persistCheckpointImpl: async () => { checkpoints += 1; return { ok: true }; },
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerCalls += 1;
        throw new Error("unavailable_preflight_must_not_reach_provider");
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      settled = JSON.parse(options.body);
      return response(200, { ok: true });
    },
  }), job({ attempts: 1 }));
  assert.deepEqual(result, {
    status: "queued",
    reason: "source_visual_preflight_unavailable",
    retry_without_generation: true,
  });
  assert.equal(settled.action, "requeue");
  assert.equal(checkpoints, 0);
  assert.equal(providerCalls, 0);
});

test("mutable original source bytes fall back only to the exact immutable client-asset SHA key", async () => {
  const changedOriginal = jpegBytes(1600, 900, "mutable-cdn-returned-different-bytes");
  const requested = [];
  const config = seedanceConfig({
    sourceDownloadImpl: async (url) => {
      requested.push(url);
      if (url === SOURCE_URL) return changedOriginal;
      if (url === SOURCE_ASSET_URL) return SOURCE_BYTES;
      const error = new Error("not_found");
      error.httpStatus = 404;
      throw error;
    },
  });
  const selected = await runner.verifiedSourceImage(config, runner.selectOwnedScene(job()));
  assert.deepEqual(selected.bytes, SOURCE_BYTES);
  assert.equal(selected.url, SOURCE_ASSET_URL);
  assert.deepEqual(requested, [SOURCE_URL, SOURCE_ASSET_URL]);
});

test("a 5-10 MB direct eight-second provider clip is compressed into a compliant silent receipt", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-oversize-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const providerBytes = oversizedValidMp4(6 * 1024 * 1024, { audio: true });
  const finalBytes = validMp4();
  const transcode = {};
  let providerSubmits = 0;
  let downloadMaxBytes = 0;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    sleepImpl: async () => {},
    execFileImpl: fakeClipTranscoder(finalBytes, transcode),
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerSubmits += 1;
        return response(202, { id: "oversize", polling_url: "/api/v1/videos/jobs/oversize" });
      }
      if (url === "https://openrouter.ai/api/v1/videos/jobs/oversize") {
        return response(200, {
          status: "completed",
          output: { url: "https://openrouter.ai/api/v1/videos/jobs/oversize/content" },
          usage: { cost: 0.12 },
        });
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      assert.equal(JSON.parse(options.body).action, "hold");
      return response(200, { ok: true });
    },
    downloadImpl: async (_url, options) => {
      downloadMaxBytes = options.maxBytes;
      return providerBytes;
    },
  });

  const result = await runner.processJob(config, job());
  assert.equal(result.status, "awaiting_review", JSON.stringify(result));
  assert.equal(providerSubmits, 1);
  assert.equal(downloadMaxBytes, runner.MAX_PROVIDER_CLIP_BYTES);
  assert.ok(providerBytes.length > validation.MAX_CLIP_BYTES);
  assert.ok(providerBytes.length >= 5 * 1024 * 1024 && providerBytes.length <= 10 * 1024 * 1024);
  assert.ok(transcode.args.includes("-an"));
  assert.doesNotMatch(transcode.args.join(" "), /reverse|concat|\s-t\s/);

  const receipt = JSON.parse(await fs.promises.readFile(result.receiptPath, "utf8"));
  const staged = await fs.promises.readFile(receipt.clip_path);
  const checked = validation.validateHeroClip(staged, { forbidAudio: true, minAspect: 0.5, maxAspect: 4.0 });
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.durationSec, 8);
  assert.ok(staged.length <= validation.MAX_CLIP_BYTES);
  assert.equal(receipt.bytes, staged.length);
  assert.equal(receipt.clip_sha256, checked.sha256);
  assert.equal(receipt.generation_receipt.clip_sha256, checked.sha256);
});

test("transcode failure keeps the accepted checkpoint and never resubmits paid work", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-transcode-fail-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const accepted = job({ lease_token: "lease-transcode-fail" });
  const photo = runner.selectOwnedScene(accepted);
  accepted.providerCheckpoint = {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: accepted.jobId,
    prospect_id: accepted.prospectId,
    generation_revision: accepted.generationRevision,
    source_sha256: photo.sha256,
    source_mime: "image/jpeg",
    source_bytes: SOURCE_BYTES.length,
    model_id: validation.SEEDANCE_MODEL_ID,
    duration_seconds: 8,
    intent_sha256: runner.generationIdentity(accepted, photo),
    submission_state: "accepted",
    polling_url: "https://openrouter.ai/api/v1/videos/jobs/transcode-fail",
    provider_job_id: "transcode-fail",
    created_at: "2026-08-28T00:00:00.000Z",
    submit_started_at: "2026-08-28T00:00:01.000Z",
    submitted_at: "2026-08-28T00:00:02.000Z",
  };
  const frozenCheckpoint = structuredClone(accepted.providerCheckpoint);
  const missingFfmpeg = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
  let providerSubmits = 0;
  let settled = null;
  const result = await runner.processJob(seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    nowMs: () => Date.parse("2026-08-28T00:01:00.000Z"),
    sourceDownloadImpl: async () => { throw new Error("accepted_checkpoint_must_not_refetch_source"); },
    execFileImpl: fakeClipTranscoder(Buffer.alloc(0), {}, missingFfmpeg),
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerSubmits += 1;
        throw new Error("must_not_resubmit");
      }
      if (url === accepted.providerCheckpoint.polling_url) {
        return response(200, {
          status: "completed",
          output: { url: `${accepted.providerCheckpoint.polling_url}/content` },
          usage: { cost: 0.12 },
        });
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-reel");
      settled = JSON.parse(options.body);
      return response(200, { ok: true });
    },
    downloadImpl: async () => oversizedValidMp4(),
  }), accepted);

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "seedance_clip_transcode_unavailable");
  assert.equal(result.retry_without_generation, true);
  assert.equal(providerSubmits, 0);
  assert.equal(settled.action, "fail");
  assert.deepEqual(settled.verdict.provider_checkpoint, frozenCheckpoint);
  assert.deepEqual(accepted.providerCheckpoint, frozenCheckpoint);
});

test("approved Seedance job uploads the exact frozen clip without regenerating", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-approved-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const normalized = job();
  const clipBytes = validMp4();
  const checked = validation.validateHeroClip(clipBytes);
  const verdict = runner.reviewContract(normalized, runner.selectOwnedScene(normalized), { ...checked, bytes: clipBytes.length }, {
    wallTimeMs: 20_000,
    generationTimeMs: 18_000,
    costUsd: 0.12,
  });
  await runner.persistReview(reviewDir, normalized, clipBytes, verdict);
  const approvedAt = new Date(Date.now() - 1000).toISOString();
  const approved = job({
    approved_clip: { approved: true, sha256: checked.sha256, approved_by: "factory_verified", approved_at: approvedAt },
    approved_artifact: verdict.approved_artifact,
  });
  let uploads = 0;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    workerToken: "worker-token",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    fetchImpl: async (url, options = {}) => {
      assert.equal(url, "https://ghost.example/api/admin/hero-clip-upload");
      uploads += 1;
      assert.equal(options.headers["x-ghost-hero-worker-token"], "worker-token");
      assert.equal(options.body.get("approved"), "true");
      assert.equal(options.body.get("approved_at"), approvedAt);
      return response(202, { ok: true, terminal: true, url: "https://cdn.example/hero.mp4" });
    },
  });
  const result = await runner.processJob(config, approved);
  assert.equal(result.status, "complete", JSON.stringify(result));
  assert.equal(uploads, 1);
});

test("one-job capability claim uses the opaque header once, clears it, and returns the exact phase lease", async () => {
  const capsule = JSON.stringify({
    schema: "wss.hero.job-capability-launch.v1",
    phase: "generate",
    capability: "wss1.payload.signature",
  });
  const requests = [];
  const config = runner.configFromLaunchCapsule(capsule, { OPENROUTER_API_KEY: "openrouter-key" }, {
    apiBase: "https://ghost.example",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) throw new Error("lost_claim_response");
      return response(200, { ok: true, job: {
        job_id: "hrj_seedance_cap",
        prospect_id: "wss-seedance-cap",
        lease_token: "lease-cap",
        producer: policy.OPENROUTER_SEEDANCE_PRODUCER,
        source_url: "https://client.example/",
        generation_revision: 1,
        duration_seconds: 8,
        openrouter_model: validation.SEEDANCE_MODEL_ID,
        photo_bank: { photos: [] },
      } });
    },
  });
  assert.equal(config.workerToken, "");
  assert.equal(config.parallelism, 1);
  assert.equal(config.continuous, false);
  const claimed = await runner.claimJob(config);
  assert.equal(claimed.jobId, "hrj_seedance_cap");
  assert.equal(claimed.capabilityPhase, "generate");
  assert.equal(config.jobCapability, "", "the one-time mint token is dropped after redemption");
  assert.equal(config.capabilityRedemptionId, "", "the raw redemption id is dropped after redemption");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://ghost.example/api/admin/hero-job-capability");
  assert.equal(requests[0].options.headers["x-ghost-hero-job-capability"], "wss1.payload.signature");
  assert.equal(requests[0].options.headers["x-ghost-hero-worker-token"], undefined);
  const firstBody = JSON.parse(requests[0].options.body);
  const secondBody = JSON.parse(requests[1].options.body);
  assert.equal(firstBody.action, "claim");
  assert.match(firstBody.redemption_id, /^[0-9a-f-]{36}$/i);
  assert.equal(secondBody.redemption_id, firstBody.redemption_id, "lost-response retry keeps one redemption identity");
  await assert.rejects(runner.claimJob(config), /seedance_capability_required/);
});

test("two capability processes use different redemption ids and only one reaches provider work", async () => {
  const capsule = JSON.stringify({
    schema: "wss.hero.job-capability-launch.v1",
    phase: "generate",
    capability: "wss1.payload.signature",
  });
  let winningRedemption = "";
  const seen = [];
  let providerRuns = 0;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    seen.push(body.redemption_id);
    if (!winningRedemption) winningRedemption = body.redemption_id;
    if (body.redemption_id !== winningRedemption) {
      return response(409, { ok: false, error: "capability_replay_conflict" });
    }
    return response(200, { ok: true, job: {
      job_id: "hrj_seedance_cap",
      prospect_id: "wss-seedance-cap",
      lease_token: "lease-cap",
      producer: policy.OPENROUTER_SEEDANCE_PRODUCER,
    } });
  };
  const configs = [
    runner.configFromLaunchCapsule(capsule, {}, { apiBase: "https://ghost.example", fetchImpl }),
    runner.configFromLaunchCapsule(capsule, {}, { apiBase: "https://ghost.example", fetchImpl }),
  ];
  const outcomes = await Promise.allSettled(configs.map((config) => worker.runWave(config, {
    processJobImpl: async () => { providerRuns += 1; return { status: "awaiting_review" }; },
  })));
  assert.equal(new Set(seen).size, 2);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal(providerRuns, 1);
});

test("an expired capability remint preserves a submitting checkpoint and never repeats the paid POST", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-cap-remint-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const base = job({ capability_phase: "generate", lease_token: "lease-remint" });
  const photo = runner.selectOwnedScene(base);
  base.providerCheckpoint = {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: base.jobId,
    prospect_id: base.prospectId,
    generation_revision: base.generationRevision,
    source_sha256: photo.sha256,
    source_mime: "image/jpeg",
    source_bytes: SOURCE_BYTES.length,
    model_id: validation.SEEDANCE_MODEL_ID,
    duration_seconds: 8,
    intent_sha256: runner.generationIdentity(base, photo),
    submission_state: "submitting",
    polling_url: "",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    submit_started_at: new Date(Date.now() - 30_000).toISOString(),
  };
  let providerPosts = 0;
  let holdCalls = 0;
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    capabilityMode: true,
    capabilityPhase: "generate",
    workerToken: "",
    openrouterApiKey: "openrouter-key",
    reviewDir,
    fetchImpl: async (url, options = {}) => {
      if (url === runner.OPENROUTER_VIDEO_ENDPOINT) {
        providerPosts += 1;
        return response(202, {});
      }
      assert.equal(url, "https://ghost.example/api/admin/hero-job-capability");
      const body = JSON.parse(options.body);
      assert.equal(body.action, "settle");
      assert.equal(body.outcome, "hold");
      holdCalls += 1;
      return response(200, { ok: true });
    },
  });
  const result = await runner.processJob(config, base);
  assert.equal(result.status, "awaiting_review");
  assert.equal(result.reason, runner.SUBMIT_REVIEW_REASON);
  assert.equal(providerPosts, 0);
  assert.equal(holdCalls, 1);
});

test("capability worker is one job, one slot, and refuses oversized stdin", async () => {
  let claims = 0;
  const wave = await worker.runWave({
    capabilityMode: true,
    capabilityPhase: "generate",
    jobCapability: "wss1.payload.signature",
    continuous: false,
    parallelism: 1,
  }, {
    claimJobImpl: async () => {
      claims += 1;
      return job({ capability_phase: "generate" });
    },
    processJobImpl: async () => ({ status: "awaiting_review" }),
  });
  assert.equal(wave.claimed, 1);
  assert.equal(claims, 1);
  await assert.rejects(worker.runWave({ capabilityMode: true, continuous: false, parallelism: 2 }), /one_shot_required/);

  const oversized = new PassThrough();
  oversized.end(Buffer.alloc(worker.MAX_LAUNCH_CAPSULE_BYTES + 1, 1));
  await assert.rejects(worker.readBoundedLaunchCapsule(oversized), /launch_capsule_too_large/);
  assert.throws(() => runner.configFromLaunchCapsule(JSON.stringify({
    schema: "wss.hero.job-capability-launch.v1",
    phase: "generate",
    capability: "wss1.payload.signature",
    extra: true,
  }), {}), /launch_capsule_invalid/);
});

test("broker and claim failures preserve non-JSON 401 and 403 status", async () => {
  for (const status of [401, 403]) {
    const config = seedanceConfig({
      apiBase: "https://ghost.example",
      workerToken: "worker-token",
      fetchImpl: async () => ({
        ok: false,
        status,
        json: async () => { throw new Error("non_json_response"); },
      }),
    });
    const rejectedWithStatus = (error) => {
      assert.equal(error.status, status);
      return true;
    };

    await assert.rejects(runner.requestLaunchCapsule(config), rejectedWithStatus);
    await assert.rejects(runner.claimJob(config), rejectedWithStatus);
    await assert.rejects(runner.claimJob({
      ...config,
      capabilityMode: true,
      capabilityPhase: "generate",
      jobCapability: "wss1.payload.signature",
    }), rejectedWithStatus);
  }
});

test("approved capability upload sends only the exact lease and never calls OpenRouter", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-cap-upload-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const base = job();
  const clipBytes = validMp4();
  const checked = validation.validateHeroClip(clipBytes);
  const verdict = runner.reviewContract(base, runner.selectOwnedScene(base), { ...checked, bytes: clipBytes.length }, {
    wallTimeMs: 20_000,
    generationTimeMs: 18_000,
    costUsd: 0.12,
  });
  await runner.persistReview(reviewDir, base, clipBytes, verdict);
  const approvedAt = new Date(Date.now() - 1000).toISOString();
  const approved = job({
    capability_phase: "upload",
    approved_clip: { approved: true, sha256: checked.sha256, approved_by: "factory_verified", approved_at: approvedAt },
    approved_artifact: verdict.approved_artifact,
  });
  const calls = [];
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    capabilityMode: true,
    capabilityPhase: "upload",
    workerToken: "",
    openrouterApiKey: "",
    reviewDir,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      assert.equal(url, "https://ghost.example/api/admin/hero-clip-upload");
      assert.equal(options.headers["x-ghost-hero-job-lease"], "lease-1");
      assert.equal(options.headers["x-ghost-hero-worker-token"], undefined);
      return response(202, { ok: true, terminal: true, url: "https://cdn.example/hero.mp4" });
    },
  });
  const result = await runner.processJob(config, approved);
  assert.equal(result.status, "complete");
  assert.equal(calls.length, 1);
  assert.equal(calls.some((call) => call.url === runner.OPENROUTER_VIDEO_ENDPOINT), false);
});

test("capability upload failure requeues approved bytes and never generic-fails or regenerates", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-cap-requeue-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const base = job();
  const clipBytes = validMp4();
  const checked = validation.validateHeroClip(clipBytes);
  const verdict = runner.reviewContract(base, runner.selectOwnedScene(base), { ...checked, bytes: clipBytes.length }, {
    wallTimeMs: 20_000,
    generationTimeMs: 18_000,
    costUsd: 0.12,
  });
  await runner.persistReview(reviewDir, base, clipBytes, verdict);
  const approved = job({
    capability_phase: "upload",
    approved_clip: {
      approved: true,
      sha256: checked.sha256,
      approved_by: "factory_verified",
      approved_at: new Date(Date.now() - 1000).toISOString(),
    },
    approved_artifact: verdict.approved_artifact,
  });
  const actions = [];
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    capabilityMode: true,
    capabilityPhase: "upload",
    workerToken: "",
    openrouterApiKey: "",
    reviewDir,
    fetchImpl: async (url, options = {}) => {
      assert.notEqual(url, runner.OPENROUTER_VIDEO_ENDPOINT);
      if (url.endsWith("/api/admin/hero-clip-upload")) return response(502, { ok: false, error: "storage_write_failed" });
      if (url.endsWith("/api/admin/hero-job-capability")) {
        const body = JSON.parse(options.body);
        actions.push(body);
        assert.equal(options.headers["x-ghost-hero-job-lease"], "lease-1");
        if (actions.length === 1) throw new Error("lost_requeue_response");
        return response(200, { ok: true, job: { status: "queued" } });
      }
      throw new Error(`unexpected_url:${url}`);
    },
  });
  const result = await runner.processJob(config, approved);
  assert.equal(result.status, "queued");
  assert.equal(result.retry_without_generation, true);
  assert.equal(result.approved_bytes_preserved, true);
  assert.deepEqual(actions, [1, 2].map(() => ({
    action: "requeue_upload",
    job_id: approved.jobId,
    reason: "storage_write_failed",
  })));
});

test("capability upload lost response recognizes exact terminal completion without requeue or regeneration", async (t) => {
  const reviewDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wss-seedance-cap-complete-"));
  t.after(() => fs.promises.rm(reviewDir, { recursive: true, force: true }));
  const base = job();
  const clipBytes = validMp4();
  const checked = validation.validateHeroClip(clipBytes);
  const verdict = runner.reviewContract(base, runner.selectOwnedScene(base), { ...checked, bytes: clipBytes.length }, {
    wallTimeMs: 20_000,
    generationTimeMs: 18_000,
    costUsd: 0.12,
  });
  await runner.persistReview(reviewDir, base, clipBytes, verdict);
  const approved = job({
    capability_phase: "upload",
    approved_clip: {
      approved: true,
      sha256: checked.sha256,
      approved_by: "factory_verified",
      approved_at: new Date(Date.now() - 1000).toISOString(),
    },
    approved_artifact: verdict.approved_artifact,
  });
  const calls = [];
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    capabilityMode: true,
    capabilityPhase: "upload",
    workerToken: "",
    openrouterApiKey: "",
    reviewDir,
    fetchImpl: async (url, options = {}) => {
      calls.push(url);
      assert.notEqual(url, runner.OPENROUTER_VIDEO_ENDPOINT);
      if (url.endsWith("/api/admin/hero-clip-upload")) throw new Error("fetch_failed");
      const body = JSON.parse(options.body);
      assert.deepEqual(body, {
        action: "requeue_upload",
        job_id: approved.jobId,
        reason: "fetch_failed",
      });
      return response(200, {
        ok: true,
        reused: true,
        completed: true,
        job: { status: "done", result: { url: "https://cdn.example/hero.mp4" } },
      });
    },
  });
  const result = await runner.processJob(config, approved);
  assert.deepEqual(result, {
    status: "complete",
    reused: true,
    url: "https://cdn.example/hero.mp4",
  });
  assert.equal(calls.length, 2);
});

test("source-store preflight proves the immutable SHA object is anonymously readable", async () => {
  const store = createMemoryAssetStore();
  let publicReads = 0;
  const result = await runner.preflightImmutableSourceStore(seedanceConfig({
    sourceAssetStore: store,
    publicSourceFetchImpl: async (url, options = {}) => {
      publicReads += 1;
      assert.match(url, /\/assets\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);
      assert.deepEqual(options.headers, { accept: "image/png" });
      assert.equal(options.headers.authorization, undefined);
      const objectPath = new URL(url).pathname.replace(/^\//, "");
      const stored = store._objects.get(objectPath);
      return new Response(stored.buffer, { status: 200, headers: { "content-type": "image/png" } });
    },
  }));
  assert.equal(result.ok, true);
  assert.equal(publicReads, 1);
});

test("source-store preflight fails before queue work when the public SHA URL is unreadable", async () => {
  const store = createMemoryAssetStore();
  await assert.rejects(
    runner.preflightImmutableSourceStore(seedanceConfig({
      sourceAssetStore: store,
      publicSourceFetchImpl: async () => new Response("", { status: 403 }),
    })),
    /seedance_source_public_read_403/,
  );
});

test("worker requests generation work without requiring a local Supabase master key", async () => {
  const order = [];
  const result = await worker.main({
    argv: [],
    env: {
      GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-token",
      OPENROUTER_API_KEY: "openrouter-token",
    },
    configOverrides: {
      continuous: false,
      parallelism: 1,
      sleepImpl: async () => {},
    },
    requestLaunchCapsuleImpl: async () => {
      order.push("broker");
      return null;
    },
    write: () => {},
  });
  assert.deepEqual(order, ["broker"]);
  assert.equal(result.status, "idle");
});

test("production source publication is lease-bound and byte-verifies the public SHA URL", async () => {
  const base = job();
  const sourceBytes = Buffer.from(SOURCE_BYTES);
  const sourceSha = createHash("sha256").update(sourceBytes).digest("hex");
  const frozen = job({
    photos: [{ ...base.photos[0], sha256: sourceSha }],
  });
  const requests = [];
  const config = seedanceConfig({
    apiBase: "https://ghost.example",
    sourceAssetStore: null,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      const key = `assets/sha256/${sourceSha.slice(0, 2)}/${sourceSha}.jpg`;
      return response(200, { ok: true, key, url: `https://cdn.wss-ai.com/${key}`, sha256: sourceSha });
    },
    publicSourceDownloadImpl: async () => sourceBytes,
  });
  const published = await runner.immutableProviderSource(
    config,
    frozen,
    { bytes: sourceBytes, mime: "image/jpeg", url: frozen.photos[0].url },
    frozen.photos[0],
  );
  assert.match(published.url, new RegExp(`${sourceSha}\\.jpg$`));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://ghost.example/api/admin/hero-source-asset");
  assert.equal(requests[0].options.headers["x-ghost-hero-job-id"], frozen.jobId);
  assert.equal(requests[0].options.headers["x-ghost-hero-job-lease"], frozen.leaseToken);
  assert.equal(requests[0].options.headers["x-ghost-prospect-id"], frozen.prospectId);
  assert.equal(requests[0].options.headers["x-ghost-source-sha256"], sourceSha);
  assert.deepEqual(Buffer.from(requests[0].options.body), sourceBytes);
});
