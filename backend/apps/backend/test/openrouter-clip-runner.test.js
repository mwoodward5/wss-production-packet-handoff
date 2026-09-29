"use strict";

/**
 * test/openrouter-clip-runner.test.js
 *
 * FULLY MOCKED: no network, no disk writes, no real OpenRouter API calls.
 * Every network dependency is injected so these tests run in any environment.
 *
 * Coverage:
 *   - buildPrompt: vertical-specific camera directions; preset A vs B
 *   - generate_audio is hardwired to false and asserted in the submission body
 *   - submit → poll → download round-trip (happy path)
 *   - cost recorded in verdict (from poll usage.cost)
 *   - honest failure codes: openrouter_unauthorized, openrouter_generation_failed,
 *     openrouter_poll_timeout, openrouter_clip_too_small, no_verified_owned_photo
 *   - upload fields include producer = openrouter_seedance
 *   - normalizeLeasedJob maps job contract correctly
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRODUCER_STAMP,
  GENERATE_AUDIO,
  MOTION_A_LABEL,
  MOTION_B_LABEL,
  NEGATIVE_PROMPT,
  VERTICAL_DIRECTIONS,
  buildPrompt,
  submitVideoJob,
  pollVideoJob,
  downloadClip,
  normalizeLeasedJob,
  bestOwnedPhoto,
  runOpenRouterClipJob,
} = require("../scripts/ads-station/openrouter-clip-runner.cjs");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PHOTO_SHA = "a".repeat(64);
const PHOTO_URL = "https://client.example/work/hero.jpg";
const POLLING_URL = "https://openrouter.ai/api/v1/videos/EVmCkr3799kO8vwaiwgm/status";
const CONTENT_URL = "https://openrouter.ai/api/v1/videos/EVmCkr3799kO8vwaiwgm/content?index=0";
const DUMMY_API_KEY = "sk-openrouter-test-key";
const DUMMY_WORKER_TOKEN = "wss-hero-worker-token";

function validMp4() {
  // Minimal valid ftyp+moov MP4 — matches what the route validation accepts.
  function box(type, payload) {
    const buf = Buffer.alloc(8 + payload.length);
    buf.writeUInt32BE(8 + payload.length, 0);
    buf.write(type, 4, 4, "ascii");
    payload.copy(buf, 8);
    return buf;
  }
  const mvhd = Buffer.alloc(24);
  mvhd.writeUInt32BE(1000, 12);  // timescale
  mvhd.writeUInt32BE(5000, 16);  // duration → 5 s
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
  const ftyp = box("ftyp", Buffer.from("isom\x00\x00\x02\x00isomiso2", "binary"));
  return Buffer.concat([
    ftyp,
    box("moov", Buffer.concat([box("mvhd", mvhd), trak])),
    box("mdat", Buffer.from([1])),
  ]);
}

function leasedJob(overrides = {}) {
  return {
    job_id: "hrj_or_test",
    lease_token: "lease_or_test",
    prospect_id: "wss-test-prospect",
    source_url: "https://prospect.example/",
    producer: PRODUCER_STAMP,
    vertical: "roofing",
    business_name: "Acme Roofing Co.",
    photo_bank: {
      photos: [{
        url: PHOTO_URL,
        sha256: PHOTO_SHA,
        source: "own_site",
        found_on: "https://prospect.example/gallery",
      }],
    },
    ...overrides,
  };
}

function makeConfig(env = {}) {
  return {
    apiBase: "https://ghost.example",
    workerToken: DUMMY_WORKER_TOKEN,
    openrouterApiKey: DUMMY_API_KEY,
    ...env,
  };
}

// ---------------------------------------------------------------------------
// CONSTANT ASSERTIONS — these never change; if they do the test catches it.
// ---------------------------------------------------------------------------

test("PRODUCER_STAMP is 'openrouter_seedance'", () => {
  assert.equal(PRODUCER_STAMP, "openrouter_seedance");
});

test("GENERATE_AUDIO is hardwired to false", () => {
  assert.strictEqual(GENERATE_AUDIO, false);
});

test("NEGATIVE_PROMPT includes cartoon and CGI look and duplicated objects", () => {
  assert.match(NEGATIVE_PROMPT, /cartoon/i);
  assert.match(NEGATIVE_PROMPT, /CGI look/i);
  assert.match(NEGATIVE_PROMPT, /duplicated objects/i);
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

test("buildPrompt preset A (default) mentions push-in camera direction", () => {
  const prompt = buildPrompt({ motionPreset: "A" });
  assert.match(prompt, /push|dolly|stabilized/i);
  assert.match(prompt, /negative/i);   // includes the negative prompt
});

test("buildPrompt preset B mentions lateral or glide", () => {
  const prompt = buildPrompt({ motionPreset: "B" });
  assert.match(prompt, /glide|lateral/i);
});

test("buildPrompt for roofing uses the vertical-specific camera direction", () => {
  const prompt = buildPrompt({ vertical: "roofing" });
  assert.match(prompt, /drone|rise|glide/i);
});

test("buildPrompt for landscaping uses landscaping-specific direction", () => {
  const prompt = buildPrompt({ vertical: "landscaping" });
  assert.match(prompt, /drone|glide|landscape/i);
});

test("buildPrompt includes businessName in prompt", () => {
  const prompt = buildPrompt({ businessName: "Valley Plumbing" });
  assert.match(prompt, /Valley Plumbing/);
});

test("buildPrompt with unknown vertical falls back to preset camera", () => {
  const prompt = buildPrompt({ vertical: "underwater_welding", motionPreset: "A" });
  assert.match(prompt, /push|dolly|stabilized/i);
});

test("MOTION_A_LABEL is cinematic-push, MOTION_B_LABEL is low-glide", () => {
  assert.equal(MOTION_A_LABEL, "cinematic-push");
  assert.equal(MOTION_B_LABEL, "low-glide");
});

test("VERTICAL_DIRECTIONS covers all supported trade verticals", () => {
  const requiredVerticals = [
    "plumbing", "hvac", "electrical", "roofing", "fencing",
    "concrete", "landscaping", "med_spa", "hair_salon",
    "tattoo", "restoration", "general_contractor",
  ];
  for (const v of requiredVerticals) {
    assert.ok(VERTICAL_DIRECTIONS[v], `vertical '${v}' missing from VERTICAL_DIRECTIONS`);
  }
});

// ---------------------------------------------------------------------------
// normalizeLeasedJob / bestOwnedPhoto
// ---------------------------------------------------------------------------

test("normalizeLeasedJob maps all standard fields", () => {
  const raw = leasedJob();
  const job = normalizeLeasedJob(raw);
  assert.equal(job.jobId, "hrj_or_test");
  assert.equal(job.leaseToken, "lease_or_test");
  assert.equal(job.prospectId, "wss-test-prospect");
  assert.equal(job.vertical, "roofing");
  assert.equal(job.businessName, "Acme Roofing Co.");
  assert.equal(job.producer, PRODUCER_STAMP);
  assert.equal(job.photos.length, 1);
});

test("normalizeLeasedJob defaults motionPreset to A", () => {
  const job = normalizeLeasedJob(leasedJob());
  assert.equal(job.motionPreset, "A");
});

test("normalizeLeasedJob accepts motion_preset B", () => {
  const job = normalizeLeasedJob(leasedJob({ motion_preset: "B" }));
  assert.equal(job.motionPreset, "B");
});

test("bestOwnedPhoto returns the first own_site photo with valid sha256", () => {
  const job = normalizeLeasedJob(leasedJob());
  const photo = bestOwnedPhoto(job.photos);
  assert.ok(photo);
  assert.equal(photo.url, PHOTO_URL);
  assert.equal(photo.sha256, PHOTO_SHA);
});

test("bestOwnedPhoto rejects stock photos", () => {
  const photos = [{ url: PHOTO_URL, sha256: PHOTO_SHA, source: "stock" }];
  assert.equal(bestOwnedPhoto(photos), null);
});

test("bestOwnedPhoto rejects non-https URLs", () => {
  const photos = [{ url: "http://client.example/img.jpg", sha256: PHOTO_SHA, source: "own_site" }];
  assert.equal(bestOwnedPhoto(photos), null);
});

// ---------------------------------------------------------------------------
// submitVideoJob — unit tests for the submit helper
// ---------------------------------------------------------------------------

test("submitVideoJob refuses when apiKey is empty", async () => {
  const result = await submitVideoJob("", {}, async () => ({}));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_unauthorized");
});

test("submitVideoJob maps HTTP 401 to openrouter_unauthorized", async () => {
  const result = await submitVideoJob(DUMMY_API_KEY, {}, async () => ({
    status: 401, json: { error: { message: "Unauthorized" } },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_unauthorized");
});

test("submitVideoJob maps non-202 to openrouter_submit_failed", async () => {
  const result = await submitVideoJob(DUMMY_API_KEY, {}, async () => ({
    status: 422, json: { error: { message: "model not available" } },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_submit_failed");
});

test("submitVideoJob returns pollingUrl on 202", async () => {
  const result = await submitVideoJob(DUMMY_API_KEY, {}, async () => ({
    status: 202, json: { polling_url: POLLING_URL },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.pollingUrl, POLLING_URL);
});

test("submitVideoJob reports openrouter_submit_no_polling_url when polling_url is missing", async () => {
  const result = await submitVideoJob(DUMMY_API_KEY, {}, async () => ({
    status: 202, json: {},
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_submit_no_polling_url");
});

// ---------------------------------------------------------------------------
// pollVideoJob — unit tests for the poll helper
// ---------------------------------------------------------------------------

test("pollVideoJob returns completed when status is 'completed'", async () => {
  let calls = 0;
  const result = await pollVideoJob(DUMMY_API_KEY, POLLING_URL, {
    pollIntervalMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls++;
      return {
        status: 200,
        json: {
          status: "completed",
          url: CONTENT_URL,
          usage: { cost: 0.152 },
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.costUsd, 0.152);
  assert.equal(calls, 1);
});

test("pollVideoJob waits through pending → in_progress → completed", async () => {
  const responses = ["pending", "in_progress", "completed"];
  let i = 0;
  const result = await pollVideoJob(DUMMY_API_KEY, POLLING_URL, {
    pollIntervalMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => ({
      status: 200,
      json: {
        status: responses[i++],
        url: i >= responses.length ? CONTENT_URL : undefined,
        usage: { cost: 0.05 },
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(i, responses.length);
});

test("pollVideoJob maps 'failed' status to openrouter_generation_failed", async () => {
  const result = await pollVideoJob(DUMMY_API_KEY, POLLING_URL, {
    pollIntervalMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => ({
      status: 200,
      json: {
        status: "failed",
        error: { message: "copyright filter triggered" },
        usage: { cost: 0.01 },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_generation_failed");
  assert.match(result.detail, /copyright/i);
});

test("pollVideoJob returns openrouter_poll_timeout after maxAttempts", async () => {
  const result = await pollVideoJob(DUMMY_API_KEY, POLLING_URL, {
    maxAttempts: 3,
    pollIntervalMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => ({ status: 200, json: { status: "in_progress" } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_poll_timeout");
});

test("pollVideoJob maps HTTP 401 to openrouter_unauthorized", async () => {
  const result = await pollVideoJob(DUMMY_API_KEY, POLLING_URL, {
    pollIntervalMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async () => ({ status: 401, json: {} }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_unauthorized");
});

// ---------------------------------------------------------------------------
// downloadClip — unit tests for the download helper
// ---------------------------------------------------------------------------

test("downloadClip returns bytes on HTTP 200", async () => {
  // Pad to exceed MIN_CLIP_BYTES (10,000) — the valid MP4 structure alone is <200 bytes.
  const bytes = Buffer.concat([validMp4(), Buffer.alloc(10_000)]);
  const result = await downloadClip(CONTENT_URL, DUMMY_API_KEY, async () => ({
    status: 200, rawBody: bytes,
  }));
  assert.equal(result.ok, true);
  assert.ok(Buffer.isBuffer(result.bytes));
});

test("downloadClip maps HTTP 4xx to openrouter_download_failed", async () => {
  const result = await downloadClip(CONTENT_URL, DUMMY_API_KEY, async () => ({
    status: 403, rawBody: Buffer.from("{}"),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_download_failed");
});

test("downloadClip rejects an empty response", async () => {
  const result = await downloadClip(CONTENT_URL, DUMMY_API_KEY, async () => ({
    status: 200, rawBody: Buffer.from([]),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_clip_too_small");
});

// ---------------------------------------------------------------------------
// runOpenRouterClipJob — full round-trip mocked test
// ---------------------------------------------------------------------------

function makeRoundTripDeps(clipBytes) {
  const settled = [];
  const uploads = [];
  return {
    settled,
    uploads,
    deps: {
      submitImpl: async (_key, body) => {
        assert.strictEqual(body.generate_audio, false, "generate_audio must be false");
        return { ok: true, pollingUrl: POLLING_URL };
      },
      pollImpl: async () => ({
        ok: true,
        status: "completed",
        contentUrl: CONTENT_URL,
        costUsd: 0.152,
      }),
      downloadImpl: async () => ({ ok: true, bytes: clipBytes }),
      uploadImpl: async (args) => {
        uploads.push(args);
        assert.equal(args.verdict.generate_audio, false, "upload verdict must record generate_audio=false");
        assert.equal(Number(args.verdict.costUsd), 0.152);
        return { ok: true, status: 202, body: { ok: true } };
      },
      settleImpl: async (_base, _token, _job, action, verdict) => {
        settled.push({ action, verdict });
        return { ok: true };
      },
    },
  };
}

test("happy path round-trip: submit → poll → download → upload → settle complete", async () => {
  const clip = validMp4();
  const { settled, uploads, deps } = makeRoundTripDeps(clip);
  const job = normalizeLeasedJob(leasedJob());
  const result = await runOpenRouterClipJob(job, makeConfig(), deps);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.costUsd, 0.152);

  // Upload must stamp producer correctly
  assert.equal(uploads.length, 1);
  assert.ok(uploads[0].photo, "photo passed to upload");

  // Final settle must be 'complete'
  const completion = settled.find((s) => s.action === "complete");
  assert.ok(completion, "job must be settled as complete");
  assert.equal(completion.verdict.producer, PRODUCER_STAMP);
  assert.equal(completion.verdict.generator, PRODUCER_STAMP);
  assert.equal(completion.verdict.source, "openrouter_i2v");
  assert.strictEqual(completion.verdict.generate_audio, false);
  assert.equal(completion.verdict.cost_usd, 0.152);
});

test("generate_audio is false in every submission body", async () => {
  const submittedBodies = [];
  const clip = validMp4();
  const deps = {
    submitImpl: async (_key, body) => {
      submittedBodies.push(body);
      return { ok: true, pollingUrl: POLLING_URL };
    },
    pollImpl: async () => ({ ok: true, status: "completed", contentUrl: CONTENT_URL, costUsd: 0 }),
    downloadImpl: async () => ({ ok: true, bytes: clip }),
    uploadImpl: async () => ({ ok: true, status: 202, body: {} }),
    settleImpl: async () => ({ ok: true }),
  };
  await runOpenRouterClipJob(normalizeLeasedJob(leasedJob()), makeConfig(), deps);
  assert.equal(submittedBodies.length, 1);
  assert.strictEqual(submittedBodies[0].generate_audio, false,
    "generate_audio MUST be false — audio generation trips a copyright filter");
});

test("no_verified_owned_photo: job with stock-only photos is refused", async () => {
  const settled = [];
  const deps = {
    submitImpl: async () => { throw new Error("must not reach submit"); },
    pollImpl: async () => { throw new Error("must not reach poll"); },
    downloadImpl: async () => { throw new Error("must not reach download"); },
    uploadImpl: async () => { throw new Error("must not reach upload"); },
    settleImpl: async (_base, _token, _job, action, verdict) => {
      settled.push({ action, verdict });
      return { ok: true };
    },
  };
  const stockJob = normalizeLeasedJob(leasedJob({
    photo_bank: { photos: [{ url: PHOTO_URL, sha256: PHOTO_SHA, source: "stock" }] },
  }));
  const result = await runOpenRouterClipJob(stockJob, makeConfig(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_verified_owned_photo");
  assert.equal(settled[0].action, "refuse");
});

test("openrouter_unauthorized: missing API key causes fail and settle", async () => {
  const settled = [];
  const deps = {
    submitImpl: async () => { throw new Error("must not call submit without key"); },
    pollImpl: async () => { throw new Error("must not reach poll"); },
    downloadImpl: async () => { throw new Error("must not reach download"); },
    uploadImpl: async () => { throw new Error("must not reach upload"); },
    settleImpl: async (_base, _token, _job, action, verdict) => {
      settled.push({ action, verdict });
      return { ok: true };
    },
  };
  const result = await runOpenRouterClipJob(
    normalizeLeasedJob(leasedJob()),
    makeConfig({ openrouterApiKey: "" }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_unauthorized");
  assert.equal(settled[0].action, "fail");
});

test("openrouter_generation_failed: poll failure settles job as failed with honest reason", async () => {
  const settled = [];
  const deps = {
    submitImpl: async (_key, body) => {
      assert.strictEqual(body.generate_audio, false);
      return { ok: true, pollingUrl: POLLING_URL };
    },
    pollImpl: async () => ({
      ok: false,
      reason: "openrouter_generation_failed",
      detail: "copyright filter triggered",
      costUsd: 0.01,
    }),
    downloadImpl: async () => { throw new Error("must not reach download"); },
    uploadImpl: async () => { throw new Error("must not reach upload"); },
    settleImpl: async (_base, _token, _job, action, verdict) => {
      settled.push({ action, verdict });
      return { ok: true };
    },
  };
  const result = await runOpenRouterClipJob(normalizeLeasedJob(leasedJob()), makeConfig(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_generation_failed");
  assert.equal(settled[0].action, "fail");
  assert.equal(settled[0].verdict.reason, "openrouter_generation_failed");
});

test("cost is recorded in the settle verdict from poll usage.cost", async () => {
  const clip = validMp4();
  const settled = [];
  const deps = {
    submitImpl: async (_key, body) => {
      assert.strictEqual(body.generate_audio, false);
      return { ok: true, pollingUrl: POLLING_URL };
    },
    pollImpl: async () => ({
      ok: true, status: "completed", contentUrl: CONTENT_URL, costUsd: 0.152,
    }),
    downloadImpl: async () => ({ ok: true, bytes: clip }),
    uploadImpl: async (args) => {
      assert.equal(Number(args.verdict.costUsd), 0.152);
      return { ok: true, status: 202, body: {} };
    },
    settleImpl: async (_base, _token, _job, action, verdict) => {
      settled.push({ action, verdict });
      return { ok: true };
    },
  };
  const result = await runOpenRouterClipJob(normalizeLeasedJob(leasedJob()), makeConfig(), deps);
  assert.equal(result.ok, true);
  const completion = settled.find((s) => s.action === "complete");
  assert.equal(completion.verdict.cost_usd, 0.152);
});

test("openrouter_clip_too_small: tiny download body causes fail", async () => {
  const settled = [];
  const deps = {
    submitImpl: async () => ({ ok: true, pollingUrl: POLLING_URL }),
    pollImpl: async () => ({ ok: true, status: "completed", contentUrl: CONTENT_URL, costUsd: 0 }),
    downloadImpl: async () => ({ ok: false, reason: "openrouter_clip_too_small" }),
    uploadImpl: async () => { throw new Error("must not reach upload"); },
    settleImpl: async (_base, _token, _job, action, verdict) => {
      settled.push({ action, verdict });
      return { ok: true };
    },
  };
  const result = await runOpenRouterClipJob(normalizeLeasedJob(leasedJob()), makeConfig(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "openrouter_clip_too_small");
  assert.equal(settled[0].action, "fail");
});
