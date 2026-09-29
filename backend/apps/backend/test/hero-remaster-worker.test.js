"use strict";

// Desktop-worker contracts with every external edge injected. No browser, API,
// or storage call can escape this file.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");

const workerModule = require("../scripts/ads-station/hero-forge-worker.cjs");
const jobQueue = require("../lib/hero-reel-job-queue");

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
const mvhdPayload = Buffer.alloc(20);
mvhdPayload.writeUInt32BE(1000, 12);
mvhdPayload.writeUInt32BE(4000, 16);
const tkhdPayload = Buffer.alloc(8);
tkhdPayload.writeUInt32BE(1280 * 65536, 0);
tkhdPayload.writeUInt32BE(720 * 65536, 4);
const hdlrPayload = Buffer.alloc(12);
hdlrPayload.write("vide", 8, 4, "ascii");
const stsdPayload = Buffer.concat([Buffer.alloc(8), box("avc1", Buffer.alloc(0))]);
stsdPayload.writeUInt32BE(1, 4);
const stbl = box("stbl", box("stsd", stsdPayload));
const minf = box("minf", stbl);
const mdia = box("mdia", Buffer.concat([box("hdlr", hdlrPayload), minf]));
const trak = box("trak", Buffer.concat([box("tkhd", tkhdPayload), mdia]));
const moov = box("moov", Buffer.concat([box("mvhd", mvhdPayload), trak]));
const CLIP = Buffer.concat([ftyp, moov, box("mdat", Buffer.from("approved-client-clip"))]);
const CLIP_SHA = workerModule.sha256Hex(CLIP);
const CLIP_V2 = Buffer.concat([ftyp, moov, box("mdat", Buffer.from("regenerated-client-clip"))]);
const CLIP_V2_SHA = workerModule.sha256Hex(CLIP_V2);
const OPTIMIZED = {
  sha256: "b".repeat(64),
  url_fingerprint: "googleusercontent.example/Optimized/Asset",
  width: 1280,
  height: 720,
  prompt_sha256: "c".repeat(64),
};
const DIRECT_OPTIMIZED = {
  sha256: RAW_SHA,
  url_fingerprint: `direct-source:${RAW_SHA}`,
  width: 1920,
  height: 1080,
  prompt_sha256: workerModule.DIRECT_SOURCE_RECIPE_SHA256,
  image_preparation: "direct_client_photo",
};
const APPROVED_ARTIFACT = workerModule.approvedArtifactFrom({
  sourceSha256: RAW_SHA,
  sourceUrl: "https://acme.example.com/work/job.jpg",
  clipSha256: CLIP_SHA,
  optimizedAsset: OPTIMIZED,
});
const APPROVED_ARTIFACT_V2 = workerModule.approvedArtifactFrom({
  sourceSha256: RAW_SHA,
  sourceUrl: "https://acme.example.com/work/job.jpg",
  clipSha256: CLIP_V2_SHA,
  optimizedAsset: OPTIMIZED,
});
const REMASTER = {
  optimizedSha256: OPTIMIZED.sha256,
  assetIdentity: {
    urlFingerprint: OPTIMIZED.url_fingerprint,
    width: OPTIMIZED.width,
    height: OPTIMIZED.height,
  },
  promptSha256: OPTIMIZED.prompt_sha256,
};

function reviewCandidate(clipPath, bytes, overrides = {}) {
  return {
    clipPath,
    sha256: workerModule.sha256Hex(bytes),
    bytes: bytes.length,
    durationSeconds: 4,
    width: 1280,
    height: 720,
    codec: "avc1",
    ...overrides,
  };
}

function leased(overrides = {}) {
  return {
    job_id: "hrj_worker",
    lease_token: "lease_worker",
    producer: "ads_image_to_video",
    prospect_id: "wss-test-acme",
    source_url: "https://acme.example.com/",
    photo_bank: {
      photos: [{
        url: "https://acme.example.com/work/job.jpg",
        sha256: RAW_SHA,
        source: "own_site",
        found_on: "https://acme.example.com/gallery",
        width: 1920,
        height: 1080,
        bytes: RAW.length,
        grade: "hero",
      }],
    },
    ...overrides,
  };
}

function workerHarness(overrides = {}) {
  const calls = { settled: [], renewed: [], upload: [], runner: [], wanRunner: [], cleanup: [] };
  const dirs = [];
  const apiImpl = async (pathname, request = {}) => {
    if (pathname === "/api/admin/hero-reel" && request.method === "POST") {
      const body = JSON.parse(request.body);
      if (body.action === "renew") {
        calls.renewed.push(body);
        return {
          ok: true,
          status: 200,
          body: { ok: true, reused: false, lease_expires_at: "2026-08-22T12:00:00.000Z" },
        };
      }
      calls.settled.push(body);
      return { ok: true, status: 200, body: { ok: true } };
    }
    throw new Error(`unexpected API call ${pathname}`);
  };
  const worker = workerModule.createWorker({
    env: {},
    config: { reviewDir: os.tmpdir(), workerToken: "worker-test-token" },
    apiImpl,
    selector: (candidates) => ({ best: candidates[0] || null }),
    makeWorkDir: async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-remaster-worker-test-"));
      dirs.push(dir);
      return dir;
    },
    downloadImpl: async (candidate, dir) => {
      const filePath = path.join(dir, "source-raw.jpg");
      fs.writeFileSync(filePath, RAW);
      return { filePath, bytes: RAW.length, sha256: candidate.sha256, ext: ".jpg" };
    },
    faceDetector: async () => ({ ok: true, faceCount: 0 }),
    runnerImpl: async (jobFile, job) => {
      calls.runner.push({ jobFile, job });
      return { verdict: { ok: false, reason: "fixture_runner_refusal" } };
    },
    wanRunnerImpl: async (jobFile, job) => {
      calls.wanRunner.push({ jobFile, job });
      throw new Error("Ads lease reached the WAN runner");
    },
    uploadImpl: async (...args) => {
      calls.upload.push(args);
      return { ok: true, terminal: true, url: "https://assets.example.com/hero.mp4", rebuild_queued: true };
    },
    persistReviewImpl: async () => ({ saved: true, path: "C:/review/clip.mp4", sha256: CLIP_SHA, bytes: CLIP.length }),
    cleanupImpl: async (dir) => { calls.cleanup.push(dir); fs.rmSync(dir, { recursive: true, force: true }); },
    ...overrides,
  });
  return { worker, calls, dirs };
}

test("Ads lease carries its producer to the unchanged Ads runner and never dispatches WAN", async () => {
  const h = workerHarness();
  const result = await h.worker.processJob(leased());
  assert.equal(result.status, "failed");
  assert.equal(h.calls.runner.length, 1);
  assert.equal(h.calls.runner[0].job.producer, "ads_image_to_video");
  assert.equal(h.calls.wanRunner.length, 0);
  assert.equal(workerModule.normalizeLeasedJob(leased()).producer, "ads_image_to_video");
});

test("OpenCV face preflight requires a clean process result and scrubs its environment", async () => {
  let childOptions;
  const success = await workerModule.detectFacesWithOpenCv("C:/fixture/source.jpg", {
    env: { PATH: "C:/Python", SECRET_TOKEN: "must-not-cross" },
    execFileImpl: (_file, _args, options, callback) => {
      childOptions = options;
      callback(null, JSON.stringify({ ok: true, faceCount: 2 }), "");
    },
  });
  assert.deepEqual(success, { ok: true, faceCount: 2 });
  assert.equal(childOptions.windowsHide, true);
  assert.equal(childOptions.env.PATH, "C:/Python");
  assert.equal(childOptions.env.SECRET_TOKEN, undefined);

  const malformed = await workerModule.detectFacesWithOpenCv("C:/fixture/source.jpg", {
    execFileImpl: (_file, _args, _options, callback) => callback(null, "not-json", ""),
  });
  assert.deepEqual(malformed, { ok: false, reason: "face_preflight_unavailable" });

  const nonzeroWithPlausibleJson = await workerModule.detectFacesWithOpenCv("C:/fixture/source.jpg", {
    execFileImpl: (_file, _args, _options, callback) => {
      const error = Object.assign(new Error("exit 1"), { code: 1 });
      callback(error, JSON.stringify({ ok: true, faceCount: 0 }), "");
    },
  });
  assert.deepEqual(nonzeroWithPlausibleJson, { ok: false, reason: "face_preflight_unavailable" });

  const timeoutWithPlausibleJson = await workerModule.detectFacesWithOpenCv("C:/fixture/source.jpg", {
    execFileImpl: (_file, _args, _options, callback) => {
      const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true });
      callback(error, JSON.stringify({ ok: true, faceCount: 0 }), "");
    },
  });
  assert.deepEqual(timeoutWithPlausibleJson, { ok: false, reason: "face_preflight_timeout" });
});

test("Tennessee-like face preflight falls through owned bank order before one Ads call", async () => {
  const faceBanner = {
    ...leased().photo_bank.photos[0],
    url: "https://acme.example.com/uploads/banner-default-imgx.jpg",
    found_on: "https://acme.example.com/sewage-pump/",
    sha256: "a".repeat(64),
    width: 1920,
    height: 762,
  };
  const equipment = {
    ...leased().photo_bank.photos[0],
    url: "https://acme.example.com/uploads/water-heater-for-homes.jpg",
    found_on: "https://acme.example.com/water-heaters/",
    sha256: "b".repeat(64),
    width: 1600,
    height: 900,
  };
  const byPath = new Map();
  const detectorCalls = [];
  const h = workerHarness({
    selector: undefined,
    downloadImpl: async (candidate, dir) => {
      const filePath = path.join(dir, "source-raw.jpg");
      fs.writeFileSync(filePath, RAW);
      byPath.set(filePath, candidate);
      return { filePath, bytes: RAW.length, sha256: candidate.sha256, ext: ".jpg" };
    },
    faceDetector: async (filePath) => {
      const candidate = byPath.get(filePath);
      detectorCalls.push(candidate.url);
      return { ok: true, faceCount: candidate.url === faceBanner.url ? 2 : 0 };
    },
  });

  const result = await h.worker.processJob(leased({ photo_bank: { photos: [faceBanner, equipment] } }));

  assert.equal(result.status, "failed", "fixture runner supplies the terminal refusal");
  assert.deepEqual(detectorCalls, [faceBanner.url, equipment.url]);
  assert.equal(h.calls.runner.length, 1, "only the face-free source reaches Ads");
  assert.equal(h.calls.runner[0].job.heroImageUrl, equipment.url);
  assert.equal(h.calls.runner[0].job.heroImageSha256, equipment.sha256);
});

test("missing face detector refuses closed before Ads unless bank has explicit evidence", async () => {
  const unknown = leased().photo_bank.photos[0];
  const noDetector = workerHarness({
    faceDetector: async () => ({ ok: false, reason: "face_preflight_unavailable" }),
  });
  const refused = await noDetector.worker.processJob(leased());
  assert.deepEqual(refused, { status: "refused", reason: "people_free_evidence_required" });
  assert.equal(noDetector.calls.runner.length, 0);
  assert.equal(noDetector.calls.settled[0].verdict.reason, "people_free_evidence_required");

  const explicitlySafe = { ...unknown, people_free: true };
  let detectorCalls = 0;
  const bypassed = workerHarness({
    faceDetector: async () => { detectorCalls += 1; return { ok: false, reason: "must_not_run" }; },
  });
  const result = await bypassed.worker.processJob(leased({ photo_bank: { photos: [explicitlySafe] } }));
  assert.equal(result.status, "failed", "fixture runner supplies the terminal refusal");
  assert.equal(detectorCalls, 0, "explicit evidence needs no local inference");
  assert.equal(bypassed.calls.runner.length, 1);
});

test("an all-faces bank makes zero Ads calls", async () => {
  const first = leased().photo_bank.photos[0];
  const second = {
    ...first,
    url: "https://acme.example.com/work/crew-two.jpg",
    sha256: "e".repeat(64),
  };
  const h = workerHarness({
    selector: undefined,
    faceDetector: async () => ({ ok: true, faceCount: 1 }),
  });

  const result = await h.worker.processJob(leased({ photo_bank: { photos: [first, second] } }));

  assert.deepEqual(result, { status: "refused", reason: "no_people_free_owned_photo" });
  assert.equal(h.calls.runner.length, 0);
  assert.equal(h.calls.settled[0].verdict.reason, "no_people_free_owned_photo");
});

test("source preflight reaches a face-free photo at bank position 13 before one Ads call", async () => {
  const base = leased().photo_bank.photos[0];
  const photos = Array.from({ length: 13 }, (_, index) => ({
    ...base,
    url: `https://acme.example.com/work/source-${index + 1}.jpg`,
    sha256: (index + 1).toString(16).repeat(64).slice(0, 64),
  }));
  const byPath = new Map();
  const detectorCalls = [];
  const h = workerHarness({
    selector: undefined,
    downloadImpl: async (candidate, dir) => {
      const filePath = path.join(dir, "source-raw.jpg");
      fs.writeFileSync(filePath, RAW);
      byPath.set(filePath, candidate);
      return { filePath, bytes: RAW.length, sha256: candidate.sha256, ext: ".jpg" };
    },
    faceDetector: async (filePath) => {
      const candidate = byPath.get(filePath);
      detectorCalls.push(candidate.url);
      return { ok: true, faceCount: candidate.url === photos[12].url ? 0 : 1 };
    },
  });

  const result = await h.worker.processJob(leased({ photo_bank: { photos } }));

  assert.equal(result.status, "failed", "fixture runner supplies the terminal refusal");
  assert.equal(detectorCalls.length, 13);
  assert.equal(h.calls.runner.length, 1);
  assert.equal(h.calls.runner[0].job.heroImageUrl, photos[12].url);
  assert.equal(h.calls.runner[0].job.heroImageSha256, photos[12].sha256);
});

test("approved re-lease stays pinned to the face-free fallback source with zero Ads reruns", async () => {
  const reviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hero-source-fallback-review-"));
  const faceBanner = {
    ...leased().photo_bank.photos[0],
    url: "https://acme.example.com/uploads/banner-with-faces.jpg",
    sha256: "a".repeat(64),
  };
  const safeEquipment = {
    ...leased().photo_bank.photos[0],
    url: "https://acme.example.com/uploads/equipment-only.jpg",
    sha256: "d".repeat(64),
  };
  const bank = { photos: [faceBanner, safeEquipment] };

  try {
    const byPath = new Map();
    let firstAdsCalls = 0;
    const first = workerHarness({
      selector: undefined,
      config: { reviewDir: reviewRoot, workerToken: "worker-test-token" },
      downloadImpl: async (candidate, dir) => {
        const filePath = path.join(dir, "source-raw.jpg");
        fs.writeFileSync(filePath, RAW);
        byPath.set(filePath, candidate);
        return { filePath, bytes: RAW.length, sha256: candidate.sha256, ext: ".jpg" };
      },
      faceDetector: async (filePath) => ({
        ok: true,
        faceCount: byPath.get(filePath).url === faceBanner.url ? 2 : 0,
      }),
      runnerImpl: async (_jobFile, job) => {
        firstAdsCalls += 1;
        const clipPath = path.join(job.outDir, "safe-source-review.mp4");
        fs.writeFileSync(clipPath, CLIP);
        return { verdict: {
          ok: false,
          status: "awaiting_review",
          review: reviewCandidate(clipPath, CLIP),
          remaster: REMASTER,
        } };
      },
      persistReviewImpl: workerModule.persistReviewArtifact,
    });
    const held = await first.worker.processJob(leased({ photo_bank: bank }));
    assert.equal(held.status, "awaiting_review");
    assert.equal(firstAdsCalls, 1);
    const heldVerdict = first.calls.settled[0].verdict;
    const approvedArtifact = heldVerdict.candidates[0].approved_artifact;
    assert.equal(approvedArtifact.raw_sha256, safeEquipment.sha256);
    assert.equal(approvedArtifact.source_url, safeEquipment.url);

    const approvedAt = new Date(Date.now() - 1000).toISOString();
    let detectorCalls = 0;
    let adsRunnerCalls = 0;
    let uploadedCandidate = null;
    const resumed = workerHarness({
      selector: undefined,
      config: { reviewDir: reviewRoot, workerToken: "worker-test-token" },
      faceDetector: async () => { detectorCalls += 1; return { ok: true, faceCount: 0 }; },
      runnerImpl: async () => { adsRunnerCalls += 1; throw new Error("approved clip must not rerun Ads"); },
      uploadImpl: async (_api, _job, candidate) => {
        uploadedCandidate = candidate;
        return { ok: true, terminal: true, url: "https://assets.example.com/fallback.mp4", rebuild_queued: true };
      },
    });
    const completed = await resumed.worker.processJob(leased({
      photo_bank: bank,
      approved_clip: { approved: true, approved_by: "Mark", approved_at: approvedAt, sha256: CLIP_SHA },
      approved_artifact: approvedArtifact,
      optimized_asset: OPTIMIZED,
    }));

    assert.equal(completed.status, "complete");
    assert.equal(detectorCalls, 0);
    assert.equal(adsRunnerCalls, 0);
    assert.equal(uploadedCandidate.url, safeEquipment.url);
    assert.equal(uploadedCandidate.sha256, safeEquipment.sha256);
  } finally {
    fs.rmSync(reviewRoot, { recursive: true, force: true });
  }
});

test("image preparation defaults to editor and the explicit off values select direct client photo", () => {
  assert.equal(workerModule.configFromEnv({}).imagePreparation, "image_editor");
  for (const value of ["0", "false", "off", "no", " FALSE "]) {
    assert.equal(
      workerModule.configFromEnv({ GHOST_AGENCY_HERO_IMAGE_EDITOR: value }).imagePreparation,
      "direct_client_photo",
      value,
    );
  }
  for (const value of ["1", "true", "on", "yes", "unexpected"]) {
    assert.equal(
      workerModule.configFromEnv({ GHOST_AGENCY_HERO_IMAGE_EDITOR: value }).imagePreparation,
      "image_editor",
      value,
    );
  }
});

test("direct preparation and verified source dimensions reach the Ads runner", async () => {
  const h = workerHarness({ env: { GHOST_AGENCY_HERO_IMAGE_EDITOR: "0" } });
  const result = await h.worker.processJob(leased());
  assert.equal(result.status, "failed");
  assert.equal(h.calls.runner.length, 1);
  assert.equal(h.calls.runner[0].job.imagePreparation, "direct_client_photo");
  assert.equal(h.calls.runner[0].job.heroImageWidth, 1920);
  assert.equal(h.calls.runner[0].job.heroImageHeight, 1080);
});

test("direct preparation skips an ineligible bank-best format without changing eligible order", async () => {
  const webp = {
    ...leased().photo_bank.photos[0],
    url: "https://acme.example.com/work/job.webp",
    sha256: "e".repeat(64),
    ext: "webp",
  };
  const jpeg = { ...leased().photo_bank.photos[0], ext: "jpg" };
  let downloaded = "";
  const h = workerHarness({
    env: { GHOST_AGENCY_HERO_IMAGE_EDITOR: "0" },
    downloadImpl: async (candidate, dir) => {
      downloaded = candidate.url;
      const filePath = path.join(dir, "source-raw.jpg");
      fs.writeFileSync(filePath, RAW);
      return { filePath, bytes: RAW.length, sha256: candidate.sha256, ext: ".jpg" };
    },
  });
  const result = await h.worker.processJob(leased({ photo_bank: { photos: [webp, jpeg] } }));
  assert.equal(result.status, "failed");
  assert.equal(downloaded, jpeg.url);
  assert.equal(h.calls.runner[0].job.heroImageUrl, jpeg.url);

  const refused = workerHarness({
    env: { GHOST_AGENCY_HERO_IMAGE_EDITOR: "0" },
    downloadImpl: async () => assert.fail("an ineligible direct source must not be downloaded"),
  });
  const noEligible = await refused.worker.processJob(leased({ photo_bank: { photos: [webp] } }));
  assert.deepEqual(noEligible, { status: "refused", reason: "no_verified_owned_photo" });
  assert.equal(refused.calls.runner.length, 0);
});

test("direct preparation verifies downloaded magic before the Ads runner", async () => {
  const h = workerHarness({
    env: { GHOST_AGENCY_HERO_IMAGE_EDITOR: "0" },
    downloadImpl: async (candidate, dir) => {
      const filePath = path.join(dir, "source-raw.webp");
      fs.writeFileSync(filePath, RAW);
      return { filePath, bytes: RAW.length, sha256: candidate.sha256, ext: ".webp" };
    },
  });
  const result = await h.worker.processJob(leased());
  assert.deepEqual(result, { status: "refused", reason: "direct_source_format_unsupported" });
  assert.equal(h.calls.runner.length, 0);
});

test("unknown internal image preparation fails before the runner", async () => {
  const h = workerHarness({
    config: { reviewDir: os.tmpdir(), workerToken: "worker-test-token", imagePreparation: "unknown" },
  });
  const result = await h.worker.processJob(leased());
  assert.deepEqual(result, { status: "failed", reason: "hero_image_preparation_invalid" });
  assert.equal(h.calls.runner.length, 0);
  assert.equal(h.calls.settled[0].verdict.reason, "hero_image_preparation_invalid");
});

test("raw equals optimized only for the canonical direct-source receipt", () => {
  const direct = workerModule.approvedArtifactFrom({
    sourceSha256: RAW_SHA,
    sourceUrl: "https://acme.example.com/work/job.jpg",
    clipSha256: CLIP_SHA,
    optimizedAsset: DIRECT_OPTIMIZED,
  });
  assert.equal(direct.valid, true);
  assert.equal(direct.raw_sha256, direct.optimized_sha256);
  assert.equal(direct.image_preparation, "direct_client_photo");
  const withoutMode = { ...direct };
  delete withoutMode.valid;
  delete withoutMode.image_preparation;
  assert.equal(workerModule.normalizeApprovedArtifact(withoutMode).valid, true, "canonical legacy-shaped receipt is inferred safely");

  for (const optimizedAsset of [
    { ...DIRECT_OPTIMIZED, url_fingerprint: `direct-source:${"0".repeat(64)}` },
    { ...DIRECT_OPTIMIZED, prompt_sha256: "d".repeat(64) },
    { ...DIRECT_OPTIMIZED, image_preparation: "image_editor" },
    { ...OPTIMIZED, sha256: RAW_SHA },
  ]) {
    assert.equal(workerModule.approvedArtifactFrom({
      sourceSha256: RAW_SHA,
      sourceUrl: "https://acme.example.com/work/job.jpg",
      clipSha256: CLIP_SHA,
      optimizedAsset,
    }).valid, false);
  }
  assert.equal(APPROVED_ARTIFACT.valid, true, "existing remaster contract remains valid");
  assert.equal(APPROVED_ARTIFACT.image_preparation, "image_editor");
});

test("Valley View fleet photo reaches Ads; the anniversary graphic never does", async () => {
  const fleet = {
    url: "https://acme.example.com/uploads/ValleyViewPlumbing-Van6-2880w.jpg",
    sha256: "a".repeat(64),
    source: "own_site",
    found_on: "https://acme.example.com/",
    width: 1920,
    height: 1296,
    bytes: 253285,
    grade: "hero",
    rank: -579,
  };
  const anniversary = {
    url: "https://acme.example.com/uploads/25th-Anniversary-for-Valley-View-Plumbing-2160-x-1080-px-1.jpg",
    sha256: "b".repeat(64),
    source: "own_site",
    found_on: "https://acme.example.com/",
    width: 2048,
    height: 1024,
    bytes: 188218,
    grade: "hero",
    rank: -211,
  };
  const h = workerHarness({ selector: undefined });
  const result = await h.worker.processJob(leased({ photo_bank: { photos: [fleet, anniversary] } }));

  assert.equal(result.status, "failed", "fixture runner still supplies the terminal refusal");
  assert.equal(h.calls.runner.length, 1);
  assert.equal(h.calls.runner[0].job.heroImageUrl, fleet.url);
  assert.equal(h.calls.runner[0].job.heroImageSha256, fleet.sha256);
  assert.notEqual(h.calls.runner[0].job.heroImageUrl, anniversary.url);
});

test("an anniversary graphic alone is refused before download or Ads", async () => {
  let downloads = 0;
  const anniversary = {
    url: "https://acme.example.com/uploads/25th-Anniversary-for-Valley-View-Plumbing.jpg",
    sha256: "b".repeat(64),
    source: "own_site",
    found_on: "https://acme.example.com/",
    width: 2048,
    height: 1024,
    bytes: 188218,
    grade: "hero",
    rank: -211,
  };
  const h = workerHarness({
    selector: undefined,
    downloadImpl: async () => { downloads += 1; throw new Error("must not download"); },
  });
  const result = await h.worker.processJob(leased({ photo_bank: { photos: [anniversary] } }));

  assert.equal(result.status, "refused");
  assert.equal(result.reason, "no_verified_owned_photo");
  assert.equal(downloads, 0);
  assert.equal(h.calls.runner.length, 0);
});

test("a custom selector refusal cannot be overridden by photo-bank order", () => {
  const job = workerModule.normalizeLeasedJob(leased());
  const belowThreshold = () => ({ best: null, ranked: [{ candidate: job.photos[0], score: 84 }] });

  assert.equal(workerModule.selectOwnedCandidate(job, belowThreshold).best, null);
  assert.equal(workerModule.selectOwnedCandidate(job, () => null).best, null);
});

test("normal worker requests carry only the worker credential", async () => {
  const seen = [];
  const worker = workerModule.createWorker({
    env: {
      GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token",
      ADS_STATION_WORKER_ID: "credential-test",
    },
    apiImpl: async (pathname, request, authKind) => {
      seen.push({ pathname, headers: request.headers, authKind });
      return { ok: true, status: 200, body: { ok: true, job: null } };
    },
  });
  await worker.claimJob();
  assert.equal(worker.config.adminToken, "", "normal polling never retains the owner credential");
  assert.equal(worker.config.producer, "openrouter_seedance");
  assert.equal(
    seen[0].pathname,
    "/api/admin/hero-reel?next=1&worker_id=credential-test&producer=openrouter_seedance",
  );
  assert.equal(seen[0].authKind, "worker");
  assert.equal(seen[0].headers["x-ghost-hero-worker-token"], "worker-test-token");
  assert.equal(seen[0].headers.authorization, undefined);
});

test("WAN-selected worker claims only the explicit WAN producer lane", async () => {
  const seen = [];
  const worker = workerModule.createWorker({
    env: {
      GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token",
      ADS_STATION_WORKER_ID: "wan-worker",
      GHOST_AGENCY_HERO_WORKER_PRODUCER: "wan2_i2v_local",
    },
    apiImpl: async (pathname) => {
      seen.push(pathname);
      return {
        ok: true,
        status: 200,
        body: {
          ok: true,
          job: { job_id: "wan_job", lease_token: "lease", producer: "wan2_i2v_local" },
        },
      };
    },
  });

  const claimed = await worker.claimJob();
  assert.equal(worker.config.producer, "wan2_i2v_local");
  assert.deepEqual(seen, [
    "/api/admin/hero-reel?next=1&worker_id=wan-worker&producer=wan2_i2v_local",
  ]);
  assert.equal(claimed.producer, "wan2_i2v_local");
});

test("worker refuses a cross-producer claim before processing", async () => {
  let calls = 0;
  const worker = workerModule.createWorker({
    env: {
      GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token",
      GHOST_AGENCY_HERO_WORKER_PRODUCER: "wan2_i2v_local",
    },
    apiImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        body: {
          ok: true,
          job: { job_id: "wrong_lane", lease_token: "lease", producer: "ads_image_to_video" },
        },
      };
    },
  });

  await assert.rejects(() => worker.claimJob(), { code: "claim_producer_mismatch" });
  assert.equal(calls, 1);
});

test("invalid worker producer fails before a claim request", () => {
  let calls = 0;
  assert.throws(
    () => workerModule.createWorker({
      env: {
        GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token",
        GHOST_AGENCY_HERO_WORKER_PRODUCER: "hero_compose_local",
      },
      apiImpl: async () => {
        calls += 1;
        return { ok: true, status: 200, body: { ok: true, job: null } };
      },
    }),
    { code: "hero_worker_producer_invalid" },
  );
  assert.equal(calls, 0);
});

test("worker credentials can only be sent to HTTPS or explicit loopback HTTP", () => {
  assert.equal(workerModule.apiBaseFromEnv({ GHOST_AGENCY_API_URL: "https://ghost.wss-ai.com/" }), "https://ghost.wss-ai.com");
  assert.equal(workerModule.apiBaseFromEnv({ GHOST_AGENCY_API_URL: "http://127.0.0.1:3000/" }), "http://127.0.0.1:3000");
  assert.throws(
    () => workerModule.apiBaseFromEnv({ GHOST_AGENCY_API_URL: "http://evil.example/collect" }),
    { code: "GHOST_AGENCY_API_URL_https_required" },
  );
  assert.throws(
    () => workerModule.apiBaseFromEnv({ GHOST_AGENCY_API_URL: "https://worker:secret@evil.example/" }),
    { code: "GHOST_AGENCY_API_URL_https_required" },
  );
});

test("normal polling refuses a distinct owner token in its process", async () => {
  let calls = 0;
  const worker = workerModule.createWorker({
    env: {
      GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token",
      GHOST_AGENCY_ADMIN_TOKEN: "owner-test-token",
    },
    apiImpl: async () => { calls += 1; return { ok: true, status: 200, body: { ok: true } }; },
  });
  await assert.rejects(() => worker.claimJob(), { code: "owner_token_forbidden_in_worker_mode" });
  assert.equal(calls, 0);
});

test("normal polling also refuses and never retains the secondary owner token", async () => {
  let calls = 0;
  const worker = workerModule.createWorker({
    env: {
      GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token",
      GHOST_AGENCY_ADMIN_TOKEN_SECONDARY: "secondary-owner-token",
    },
    apiImpl: async () => { calls += 1; return { ok: true, status: 200, body: { ok: true } }; },
  });
  assert.equal(worker.config.adminToken, "");
  assert.equal(Object.hasOwn(worker.config, "secondaryOwnerToken"), false);
  await assert.rejects(() => worker.claimJob(), { code: "owner_token_forbidden_in_worker_mode" });
  assert.equal(calls, 0);

  const collision = workerModule.createWorker({
    env: {
      GHOST_AGENCY_HERO_WORKER_TOKEN: "same-token",
      GHOST_AGENCY_ADMIN_TOKEN_SECONDARY: "same-token",
    },
    apiImpl: async () => { calls += 1; return { ok: true, status: 200, body: { ok: true } }; },
  });
  await assert.rejects(() => collision.claimJob(), { code: "hero_worker_token_must_differ_from_admin" });
  assert.equal(calls, 0);
});

test("admin token cannot substitute for a missing worker token", async () => {
  let calls = 0;
  const worker = workerModule.createWorker({
    env: { GHOST_AGENCY_ADMIN_TOKEN: "owner-test-token" },
    apiImpl: async () => { calls += 1; return { ok: true, status: 200, body: { ok: true } }; },
  });
  await assert.rejects(() => worker.claimJob(), { code: "GHOST_AGENCY_HERO_WORKER_TOKEN_required" });
  assert.equal(calls, 0);
});

test("equal worker and admin credentials fail closed without retaining admin", async () => {
  let calls = 0;
  const worker = workerModule.createWorker({
    env: {
      GHOST_AGENCY_HERO_WORKER_TOKEN: "same-token",
      GHOST_AGENCY_ADMIN_TOKEN: "same-token",
    },
    apiImpl: async () => { calls += 1; return { ok: true, status: 200, body: { ok: true } }; },
  });
  assert.equal(worker.config.adminToken, "");
  await assert.rejects(() => worker.claimJob(), { code: "hero_worker_token_must_differ_from_admin" });
  assert.equal(calls, 0);
});

test("owner approval carries only admin Authorization and requires the admin token", async () => {
  const reviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hero-owner-auth-test-"));
  try {
    const jobDir = path.join(reviewRoot, "hrj_owner");
    fs.mkdirSync(jobDir);
    const clipPath = path.join(jobDir, `${CLIP_SHA}.mp4`);
    const receiptPath = path.join(jobDir, `${CLIP_SHA}.json`);
    fs.writeFileSync(clipPath, CLIP);
    fs.writeFileSync(receiptPath, JSON.stringify({
      job_id: "hrj_owner",
      prospect_id: "wss-test-acme",
      source_sha256: RAW_SHA,
      source_url: "https://acme.example.com/work/job.jpg",
      clip_sha256: CLIP_SHA,
      clip_path: clipPath,
      approved_artifact: APPROVED_ARTIFACT,
      optimized_asset: OPTIMIZED,
    }));

    let seen;
    const worker = workerModule.createWorker({
      env: {
        GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token",
        GHOST_AGENCY_ADMIN_TOKEN: "owner-test-token",
      },
      allowOwnerApproval: true,
      config: { reviewDir: reviewRoot },
      apiImpl: async (_pathname, request, authKind) => {
        seen = { headers: request.headers, authKind };
        return { ok: true, status: 200, body: { ok: true, job: { status: "queued" } } };
      },
    });
    await worker.approveReview("hrj_owner", "Mark");
    assert.equal(seen.authKind, "owner");
    assert.equal(seen.headers.authorization, "Bearer owner-test-token");
    assert.equal(seen.headers["x-ghost-hero-worker-token"], undefined);
    await assert.rejects(() => worker.claimJob(), { code: "owner_mode_worker_operation_forbidden" });

    const workerOnly = workerModule.createWorker({
      env: { GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token" },
      config: { reviewDir: reviewRoot },
      apiImpl: async () => { throw new Error("must not call"); },
    });
    await assert.rejects(
      () => workerOnly.approveReview("hrj_owner", "Mark"),
      { code: "GHOST_AGENCY_ADMIN_TOKEN_required_for_approval" },
    );
  } finally {
    fs.rmSync(reviewRoot, { recursive: true, force: true });
  }
});

test("multi-candidate owner approval requires and posts the exact chosen SHA", async () => {
  const reviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hero-owner-candidates-"));
  try {
    const jobDir = path.join(reviewRoot, "hrj_candidates");
    fs.mkdirSync(jobDir);
    const receipts = [
      { bytes: CLIP, sha256: CLIP_SHA, artifact: APPROVED_ARTIFACT },
      { bytes: CLIP_V2, sha256: CLIP_V2_SHA, artifact: APPROVED_ARTIFACT_V2 },
    ];
    for (const row of receipts) {
      const clipPath = path.join(jobDir, `${row.sha256}.mp4`);
      fs.writeFileSync(clipPath, row.bytes);
      fs.writeFileSync(path.join(jobDir, `${row.sha256}.json`), JSON.stringify({
        job_id: "hrj_candidates",
        prospect_id: "wss-test-acme",
        source_sha256: RAW_SHA,
        source_url: "https://acme.example.com/work/job.jpg",
        clip_sha256: row.sha256,
        clip_path: clipPath,
        approved_artifact: row.artifact,
        optimized_asset: OPTIMIZED,
      }));
    }

    const posts = [];
    const worker = workerModule.createWorker({
      env: {
        GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token",
        GHOST_AGENCY_ADMIN_TOKEN: "owner-test-token",
      },
      allowOwnerApproval: true,
      config: { reviewDir: reviewRoot },
      apiImpl: async (_pathname, request) => {
        posts.push(JSON.parse(request.body));
        return { ok: true, status: 200, body: { ok: true, job: { status: "queued" } } };
      },
    });

    await assert.rejects(
      () => worker.approveReview("hrj_candidates", "Mark"),
      { code: "review_candidate_sha256_required" },
    );
    assert.equal(posts.length, 0, "ambiguous job ID never reaches approval API");
    await assert.rejects(
      () => worker.approveReview("hrj_candidates", "Mark", "e".repeat(64)),
      { code: "review_candidate_sha256_not_found" },
    );
    assert.equal(posts.length, 0);

    const approved = await worker.approveReview("hrj_candidates", "Mark", CLIP_V2_SHA);
    assert.equal(approved.sha256, CLIP_V2_SHA);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].clip_sha256, CLIP_V2_SHA);
    assert.equal(posts[0].action, "approve");
    const firstReceipt = JSON.parse(fs.readFileSync(path.join(jobDir, `${CLIP_SHA}.json`), "utf8"));
    const secondReceipt = JSON.parse(fs.readFileSync(path.join(jobDir, `${CLIP_V2_SHA}.json`), "utf8"));
    assert.equal(firstReceipt.approved, undefined);
    assert.equal(secondReceipt.approved, true);
  } finally {
    fs.rmSync(reviewRoot, { recursive: true, force: true });
  }
});

test("exact receipt path still requires its matching candidate SHA", async () => {
  const reviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hero-owner-exact-receipt-"));
  try {
    const jobDir = path.join(reviewRoot, "hrj_exact");
    fs.mkdirSync(jobDir);
    const clipPath = path.join(jobDir, `${CLIP_SHA}.mp4`);
    const receiptPath = path.join(jobDir, `${CLIP_SHA}.json`);
    fs.writeFileSync(clipPath, CLIP);
    fs.writeFileSync(receiptPath, JSON.stringify({
      job_id: "hrj_exact",
      prospect_id: "wss-test-acme",
      source_sha256: RAW_SHA,
      source_url: "https://acme.example.com/work/job.jpg",
      clip_sha256: CLIP_SHA,
      clip_path: clipPath,
      approved_artifact: APPROVED_ARTIFACT,
      optimized_asset: OPTIMIZED,
    }));

    await assert.rejects(
      () => workerModule.resolveReviewReceipt(receiptPath, reviewRoot),
      { code: "review_candidate_sha256_required" },
    );
    await assert.rejects(
      () => workerModule.resolveReviewReceipt(receiptPath, reviewRoot, CLIP_V2_SHA),
      { code: "review_candidate_sha256_mismatch" },
    );
    const resolved = await workerModule.resolveReviewReceipt(receiptPath, reviewRoot, CLIP_SHA);
    assert.equal(resolved.artifact.clip_sha256, CLIP_SHA);
  } finally {
    fs.rmSync(reviewRoot, { recursive: true, force: true });
  }
});

test("runner child environment cannot receive worker or owner credentials", async () => {
  let childEnv;
  await workerModule.runRunner("C:/safe/job.json", {
    cdpUrl: "http://127.0.0.1:9222",
    env: {
      GHOST_AGENCY_HERO_WORKER_TOKEN: "worker-test-token",
      GHOST_AGENCY_ADMIN_TOKEN: "owner-test-token",
      GHOST_AGENCY_ADMIN_SESSION_SECRET: "session-test-secret",
      SUPABASE_SERVICE_ROLE_KEY: "storage-secret",
      SUPABASE_DB_URL: "postgres://credential-bearing-url",
      DATABASE_URL: "postgres://credential-bearing-url",
      SESSION_COOKIE: "session-cookie",
      AUTHORIZATION: "Bearer secret",
      ADS_STATION_PARAMS: "safe-ads-params",
      ADS_STATION_BACKGROUND_BROWSER: "1",
      ADS_STATION_BROWSER_EXECUTABLE: "C:\\Program Files\\Chromium\\chrome.exe",
    },
    execFileImpl: (_node, _args, options, callback) => {
      childEnv = options.env;
      callback(null, '{"ok":false,"status":"awaiting_review"}', "");
    },
  });
  assert.equal(childEnv.GHOST_AGENCY_HERO_WORKER_TOKEN, undefined);
  assert.equal(childEnv.GHOST_AGENCY_ADMIN_TOKEN, undefined);
  assert.equal(childEnv.GHOST_AGENCY_ADMIN_SESSION_SECRET, undefined);
  assert.equal(childEnv.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(childEnv.SUPABASE_DB_URL, undefined);
  assert.equal(childEnv.DATABASE_URL, undefined);
  assert.equal(childEnv.SESSION_COOKIE, undefined);
  assert.equal(childEnv.AUTHORIZATION, undefined);
  assert.equal(childEnv.ADS_STATION_PARAMS, "safe-ads-params");
  assert.equal(childEnv.ADS_STATION_BACKGROUND_BROWSER, "1");
  assert.equal(childEnv.ADS_STATION_BROWSER_EXECUTABLE, "C:\\Program Files\\Chromium\\chrome.exe");
  assert.equal(childEnv.ADS_STATION_CDP_URL, "http://127.0.0.1:9222");
  assert.equal(childEnv.CDP_URL, "http://127.0.0.1:9222", "direct runner fallback receives the exact worker port");
});

test("runner dependency failure becomes one bounded path-free reason", async () => {
  const outcome = await workerModule.runRunner("C:/safe/job.json", {
    execFileImpl: (_node, _args, _options, callback) => {
      const error = Object.assign(
        new Error("Command failed: C:\\Users\\Owner\\private\\animate-image-runner.cjs --token owner-secret"),
        { code: 1 },
      );
      callback(
        error,
        "",
        "Error: Cannot find module 'C:\\Users\\Owner\\private\\node_modules\\playwright-core'\nAuthorization: Bearer owner-secret",
      );
    },
  });

  assert.deepEqual(outcome, { error: "runner_dependency_missing", verdict: null });
  assert.ok(outcome.error.length <= 96);
  assert.doesNotMatch(JSON.stringify(outcome), /Owner|private|token|secret|Authorization|playwright/i);
});

test("runner crash detail is classified, bounded, and discarded", async () => {
  const outcome = await workerModule.runRunner("C:/safe/job.json", {
    execFileImpl: (_node, _args, _options, callback) => {
      const error = Object.assign(new Error("Command failed: hidden runner"), { code: 1 });
      callback(
        error,
        JSON.stringify({
          ok: false,
          reason: "runner_crashed",
          detail: "browserType.launch: Executable doesn't exist at C:\\Users\\Owner\\private\\chrome.exe --token owner-secret",
        }),
        "",
      );
    },
  });

  assert.deepEqual(outcome, {
    error: "runner_dependency_missing",
    verdict: { ok: false, reason: "runner_crashed" },
  });
  assert.doesNotMatch(JSON.stringify(outcome), /Owner|private|chrome|token|secret/i);
});

test("runner timeout metadata wins over child stderr text", async () => {
  const outcome = await workerModule.runRunner("C:/safe/job.json", {
    execFileImpl: (_node, _args, _options, callback) => {
      const error = Object.assign(new Error("Command failed: hidden runner"), { killed: true, signal: "SIGTERM" });
      callback(
        error,
        JSON.stringify({ ok: false, reason: "no_verified_owned_photo" }),
        JSON.stringify({ reason: "runner_dependency_missing" }),
      );
    },
  });

  assert.deepEqual(outcome, {
    error: "runner_timed_out",
    verdict: { ok: false, reason: "no_verified_owned_photo" },
  });
});

test("specific stdout verdict survives an ordinary numeric exit", async () => {
  const outcome = await workerModule.runRunner("C:/safe/job.json", {
    execFileImpl: (_node, _args, _options, callback) => {
      callback(
        Object.assign(new Error("Command failed: hidden runner"), { code: 1 }),
        JSON.stringify({ ok: false, reason: "cdp_connection_failed" }),
        "",
      );
    },
  });

  assert.deepEqual(outcome, {
    error: "cdp_connection_failed",
    verdict: { ok: false, reason: "cdp_connection_failed" },
  });
});

test("runner output cap metadata wins over partial child diagnostics", async () => {
  const outcome = await workerModule.runRunner("C:/safe/job.json", {
    execFileImpl: (_node, _args, _options, callback) => {
      callback(
        Object.assign(new Error("stdout maxBuffer length exceeded"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
        JSON.stringify({ ok: false, reason: "cdp_connection_failed" }),
        JSON.stringify({ reason: "runner_dependency_missing" }),
      );
    },
  });

  assert.equal(outcome.error, "runner_output_limit_exceeded");
});

test("Playwright crash details map to bounded operation reasons", async () => {
  const cases = [
    ["page.goto: Timeout 60000ms exceeded at C:\\Users\\Owner\\private", "runner_operation_timed_out"],
    ["Target page, context or browser has been closed at C:\\Users\\Owner\\private", "runner_browser_closed"],
  ];
  for (const [detail, expected] of cases) {
    const outcome = await workerModule.runRunner("C:/safe/job.json", {
      execFileImpl: (_node, _args, _options, callback) => callback(
        Object.assign(new Error("Command failed: hidden runner"), { code: 1 }),
        JSON.stringify({ ok: false, reason: "runner_crashed", detail }),
        "",
      ),
    });
    assert.equal(outcome.error, expected);
    assert.doesNotMatch(JSON.stringify(outcome), /Owner|private/i);
  }
});

test("processJob sanitizes legacy command output before durable failure settlement", async () => {
  const h = workerHarness({
    runnerImpl: async () => ({
      error: "Command failed: C:\\Users\\Owner\\private\\animate-image-runner.cjs --api-key owner-secret",
      stderr: "reason: runner_dependency_missing\nC:\\Users\\Owner\\private\\owner-secret",
    }),
  });

  const result = await h.worker.processJob(leased());
  assert.deepEqual(result, { status: "failed", reason: "runner_dependency_missing" });
  assert.equal(h.calls.settled.length, 1);
  assert.deepEqual(h.calls.settled[0].verdict, { ok: false, reason: "runner_dependency_missing" });
  assert.equal(h.calls.upload.length, 0, "diagnostics never weaken the approval/upload truth gate");
  assert.doesNotMatch(JSON.stringify(h.calls.settled), /Owner|private|api-key|secret/i);
});

test("stderr cannot impersonate a source truth-gate reason", async () => {
  const h = workerHarness({
    runnerImpl: async () => ({
      error: "Command failed: hidden runner",
      stderr: "reason: source_sha256_mismatch",
    }),
  });

  const result = await h.worker.processJob(leased());
  assert.deepEqual(result, { status: "failed", reason: "runner_failed" });
  assert.deepEqual(h.calls.settled[0].verdict, { ok: false, reason: "runner_failed" });
  assert.equal(h.calls.upload.length, 0);
});

test("processJob persists transport failure over conflicting child verdicts", async () => {
  for (const expected of ["runner_timed_out", "runner_output_limit_exceeded"]) {
    const h = workerHarness({
      runnerImpl: async () => ({
        error: expected,
        verdict: { ok: false, reason: "no_verified_owned_photo" },
      }),
    });

    const result = await h.worker.processJob(leased());
    assert.deepEqual(result, { status: "failed", reason: expected });
    assert.deepEqual(h.calls.settled[0].verdict, { ok: false, reason: expected });
    assert.equal(h.calls.upload.length, 0);
  }
});

test("desktop source fetch refuses localhost before the first request", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-ssrf-test-"));
  let fetches = 0;
  try {
    await assert.rejects(
      () => workerModule.downloadAndVerifySource(
        { url: "https://127.0.0.1/private.jpg", sha256: RAW_SHA },
        dir,
        async () => { fetches += 1; throw new Error("must not fetch"); },
      ),
      { code: "source_url_not_public" },
    );
    assert.equal(fetches, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("queue-canonicalized opaque Google Maps photo reaches worker; swapped identity reaches no media call", async () => {
  const placeId = "ChIJ_OPAQUE_REAL";
  const mapsUri = "https://www.google.com/maps/place/Acme+Plumbing/data=!4m2!3m1!1sopaque";
  const mediaUrl = "https://lh3.googleusercontent.com/place-photo";
  const record = {
    place_id: placeId,
    build_ready: {
      mirror_request: { facts: { place_id: placeId, profile_url: mapsUri } },
      photo_bank: {
        version: 1,
        harvested_at: new Date().toISOString(),
        website: "https://acme.example.com/",
        place_id: placeId,
        photos: [{
          url: mediaUrl,
          sha256: RAW_SHA,
          source: "gbp",
          found_on: mapsUri,
          place_id: placeId,
          resource_name: `places/${placeId}/photos/photo-opaque`,
          width: 1600,
          height: 900,
        }],
      },
    },
  };
  const bank = jobQueue.normalizedPhotoBank(record, "https://acme.example.com/", new Date());
  assert.equal(bank.photos.length, 1);
  const normalized = workerModule.normalizeLeasedJob(leased({ photo_bank: bank }));
  const selected = workerModule.selectOwnedCandidate(normalized, (items) => ({ best: items[0] || null }));
  assert.equal(selected.best.url, mediaUrl);
  assert.equal(selected.best.resource_name, `places/${placeId}/photos/photo-opaque`);

  let downloads = 0;
  const swapped = {
    ...bank,
    photos: [{ ...bank.photos[0], found_on: "https://www.google.com/maps/place/Someone+Else" }],
  };
  const h = workerHarness({ downloadImpl: async () => { downloads += 1; throw new Error("must not download"); } });
  const result = await h.worker.processJob(leased({ photo_bank: swapped }));
  assert.equal(result.reason, "no_verified_owned_photo");
  assert.equal(downloads, 0);
  assert.equal(h.calls.runner.length, 0);
  assert.equal(h.calls.upload.length, 0);
});

test("desktop source fetch revalidates redirects and refuses a private Location", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-ssrf-test-"));
  let fetches = 0;
  try {
    await assert.rejects(
      () => workerModule.downloadAndVerifySource(
        { url: "https://cdn.example.com/photo.jpg", sha256: RAW_SHA },
        dir,
        async () => {
          fetches += 1;
          return {
            ok: false,
            status: 302,
            headers: { get: (name) => name === "location" ? "https://127.0.0.1/admin" : null },
          };
        },
        { lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }] },
      ),
      { code: "source_url_not_public" },
    );
    assert.equal(fetches, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("desktop source fetch preserves public CDN downloads and source SHA proof", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-ssrf-test-"));
  try {
    const result = await workerModule.downloadAndVerifySource(
      { url: "https://cdn.example.com/photo.jpg", sha256: RAW_SHA },
      dir,
      async (_url, options) => {
        assert.equal(options.redirect, "manual");
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => name === "content-length" ? String(RAW.length) : null },
          arrayBuffer: async () => RAW,
        };
      },
      { lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }] },
    );
    assert.equal(result.sha256, RAW_SHA);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("desktop HTTPS socket is pinned to the preflight address and never re-resolves", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-rebind-test-"));
  let systemResolverCalled = false;
  let pinnedAddress = "";
  const httpsImpl = {
    request(url, options, onResponse) {
      const request = new EventEmitter();
      request.destroy = (error) => queueMicrotask(() => request.emit("error", error));
      request.end = () => {
        const resolver = options.lookup || ((_host, _opts, callback) => {
          systemResolverCalled = true;
          callback(null, "127.0.0.1", 4);
        });
        resolver(url.hostname, { family: 0 }, (error, address) => {
          if (error) return request.emit("error", error);
          pinnedAddress = address;
          const socket = new EventEmitter();
          socket.remoteAddress = address;
          request.emit("socket", socket);
          socket.emit("secureConnect");
          const response = new PassThrough();
          response.statusCode = 200;
          response.headers = { "content-type": "image/jpeg", "content-length": String(RAW.length) };
          response.socket = { remoteAddress: address };
          onResponse(response);
          response.end(RAW);
        });
      };
      return request;
    },
  };
  try {
    const result = await workerModule.downloadAndVerifySource(
      { url: "https://rebind.example.com/photo.jpg", sha256: RAW_SHA },
      dir,
      fetch,
      {
        lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
        httpsImpl,
      },
    );
    assert.equal(result.sha256, RAW_SHA);
    assert.equal(pinnedAddress, "8.8.8.8");
    assert.equal(systemResolverCalled, false, "a second, rebinding resolver was never used");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("slow response bodies stay under the total deadline and are cancelled", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-slow-test-"));
  let cancelled = false;
  try {
    await assert.rejects(
      () => workerModule.downloadAndVerifySource(
        { url: "https://cdn.example.com/photo.jpg", sha256: RAW_SHA },
        dir,
        async () => ({
          ok: true,
          status: 200,
          headers: { get: (name) => name === "content-type" ? "image/jpeg" : null },
          body: { getReader: () => ({
            read: () => new Promise(() => {}),
            cancel: async () => { cancelled = true; },
          }) },
        }),
        { lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }], timeoutMs: 20 },
      ),
      { code: "source_download_timeout" },
    );
    assert.equal(cancelled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("chunked bodies are cancelled at the hard byte cap", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-size-test-"));
  const chunk = Buffer.alloc(13 * 1024 * 1024, 1);
  let reads = 0;
  let cancelled = false;
  try {
    await assert.rejects(
      () => workerModule.downloadAndVerifySource(
        { url: "https://cdn.example.com/photo.jpg", sha256: RAW_SHA },
        dir,
        async () => ({
          ok: true,
          status: 200,
          headers: { get: (name) => name === "content-type" ? "image/jpeg" : null },
          body: { getReader: () => ({
            read: async () => ({ done: false, value: chunk.subarray(0, ++reads ? chunk.length : 0) }),
            cancel: async () => { cancelled = true; },
          }) },
        }),
        { lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }], timeoutMs: 1000 },
      ),
      { code: "source_too_large" },
    );
    assert.equal(reads, 2);
    assert.equal(cancelled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no owned photo refuses honestly before download, runner, or upload", async () => {
  const h = workerHarness();
  const result = await h.worker.processJob(leased({ photo_bank: { photos: [] } }));
  assert.deepEqual(result, { status: "refused", reason: "no_verified_owned_photo" });
  assert.equal(h.calls.runner.length, 0);
  assert.equal(h.calls.upload.length, 0);
  assert.equal(h.calls.settled.length, 1);
  assert.equal(h.calls.settled[0].action, "refuse");
  assert.equal(h.calls.settled[0].verdict.reason, "no_verified_owned_photo");
});

test("downloaded source SHA mismatch is a truth refusal and never reaches the runner", async () => {
  const error = Object.assign(new Error("mismatch"), { code: "source_sha256_mismatch" });
  const h = workerHarness({ downloadImpl: async () => { throw error; } });
  const result = await h.worker.processJob(leased());
  assert.deepEqual(result, { status: "refused", reason: "source_sha256_mismatch" });
  assert.equal(h.calls.runner.length, 0);
  assert.equal(h.calls.upload.length, 0);
  assert.equal(h.calls.settled[0].action, "refuse");
});

test("long Google runner work renews the exact lease every heartbeat and stops before settlement", async () => {
  const h = workerHarness({
    heartbeatIntervalMs: 5,
    runnerImpl: async (_jobFile, job) => {
      h.calls.runner.push(job);
      await new Promise((resolve) => setTimeout(resolve, 22));
      return { verdict: { ok: false, reason: "fixture_runner_refusal" } };
    },
  });
  const result = await h.worker.processJob(leased());
  assert.equal(result.status, "failed");
  assert.ok(h.calls.renewed.length >= 2, "long browser work receives periodic renewals");
  for (const renewal of h.calls.renewed) {
    assert.deepEqual(renewal, {
      job_id: "hrj_worker",
      action: "renew",
      lease_token: "lease_worker",
      worker_id: h.worker.config.workerId,
      lease_ms: 60 * 60 * 1000,
    });
  }
  const stoppedAt = h.calls.renewed.length;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(h.calls.renewed.length, stoppedAt, "heartbeat stops before terminal settlement");
  assert.equal(h.calls.settled.length, 1);
});

test("a lost heartbeat halts stale work before upload or any settlement", async () => {
  let renewals = 0;
  const h = workerHarness({
    heartbeatIntervalMs: 5,
    renewImpl: async () => {
      renewals += 1;
      if (renewals === 1) {
        return { ok: true, lease_expires_at: "2026-08-22T12:00:00.000Z" };
      }
      throw Object.assign(new Error("stolen"), { code: "lease_conflict" });
    },
    runnerImpl: async (_jobFile, job) => {
      h.calls.runner.push(job);
      await new Promise((resolve) => setTimeout(resolve, 22));
      return { verdict: { ok: false, reason: "must_not_settle" } };
    },
  });
  const result = await h.worker.processJob(leased());
  assert.deepEqual(result, { status: "failed", reason: "lease_renewal_failed", halt: false });
  assert.ok(renewals >= 2);
  assert.equal(h.calls.upload.length, 0);
  assert.equal(h.calls.settled.length, 0);
});

test("unapproved render is held once, never uploaded, and leaves the worker free for the next job", async () => {
  const h = workerHarness({
    runnerImpl: async (_jobFile, job) => {
      h.calls.runner.push(job);
      const clipPath = path.join(job.outDir, "review.mp4");
      fs.writeFileSync(clipPath, CLIP);
      return { verdict: {
        ok: false,
        status: "awaiting_review",
        review: { clipPath, sha256: CLIP_SHA, bytes: CLIP.length },
        remaster: REMASTER,
      } };
    },
  });
  const result = await h.worker.processJob(leased());
  assert.equal(result.status, "awaiting_review");
  assert.equal(result.halt, false);
  assert.equal(h.calls.upload.length, 0);
  assert.equal(h.calls.settled.length, 1);
  assert.equal(h.calls.settled[0].action, "hold");
  assert.equal(h.calls.settled[0].verdict.status, "awaiting_review");
  assert.equal(h.calls.settled[0].verdict.clip_sha256, CLIP_SHA);
  assert.equal(h.calls.settled[0].verdict.optimized_asset.url_fingerprint, OPTIMIZED.url_fingerprint);
  assert.equal(h.calls.settled[0].verdict.review, undefined, "server receipt never gets a local path");
});

test("candidate set is byte-validated, SHA-deduped, and held as a bounded path-free manifest", async () => {
  const h = workerHarness({
    runnerImpl: async (_jobFile, job) => {
      const firstPath = path.join(job.outDir, "candidate-a.mp4");
      const duplicatePath = path.join(job.outDir, "candidate-a-copy.mp4");
      const secondPath = path.join(job.outDir, "candidate-b.mp4");
      fs.writeFileSync(firstPath, CLIP);
      fs.writeFileSync(duplicatePath, CLIP);
      fs.writeFileSync(secondPath, CLIP_V2);
      return { verdict: {
        ok: false,
        status: "awaiting_review",
        candidates: [
          reviewCandidate(firstPath, CLIP),
          reviewCandidate(duplicatePath, CLIP),
          reviewCandidate(secondPath, CLIP_V2),
        ],
        remaster: REMASTER,
      } };
    },
  });

  const result = await h.worker.processJob(leased());
  assert.equal(result.status, "awaiting_review");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((row) => row.sha256), [CLIP_SHA, CLIP_V2_SHA]);
  assert.equal(h.calls.upload.length, 0);
  assert.equal(h.calls.settled.length, 1);
  const held = h.calls.settled[0].verdict;
  assert.equal(held.candidates.length, 2);
  assert.ok(held.candidates.every((row) => !Object.hasOwn(row, "clipPath") && !Object.hasOwn(row, "clip_path")));
  assert.deepEqual(held.candidates.map((row) => row.approved_artifact.clip_sha256), [CLIP_SHA, CLIP_V2_SHA]);
  assert.equal(held.clip_sha256, CLIP_SHA, "legacy single-review fields still point at candidate one");
});

test("one unsafe candidate rejects the entire set before persistence or upload", async (t) => {
  for (const fixture of [
    { name: "outside outDir", expected: "clip_path_outside_job", mutate: (row, outside) => ({ ...row, clipPath: outside }) },
    { name: "declared SHA mismatch", expected: "clip_sha256_mismatch", mutate: (row) => ({ ...row, sha256: "f".repeat(64) }) },
    { name: "oversized manifest", expected: "review_candidate_limit_exceeded", oversized: true },
  ]) {
    await t.test(fixture.name, async () => {
      const outside = path.join(os.tmpdir(), `hero-outside-${Date.now()}-${Math.random()}.mp4`);
      fs.writeFileSync(outside, CLIP_V2);
      let persisted = 0;
      try {
        const h = workerHarness({
          persistReviewImpl: async () => { persisted += 1; return { saved: true }; },
          runnerImpl: async (_jobFile, job) => {
            const safePath = path.join(job.outDir, "safe.mp4");
            fs.writeFileSync(safePath, CLIP);
            const safe = reviewCandidate(safePath, CLIP);
            const candidates = fixture.oversized
              ? Array.from({ length: workerModule.MAX_REVIEW_CANDIDATES + 1 }, () => ({ ...safe }))
              : [safe, fixture.mutate(reviewCandidate(safePath, CLIP), outside)];
            return { verdict: { ok: false, status: "awaiting_review", candidates, remaster: REMASTER } };
          },
        });
        const result = await h.worker.processJob(leased());
        assert.equal(result.status, "failed");
        assert.equal(result.reason, fixture.expected);
        assert.equal(persisted, 0);
        assert.equal(h.calls.upload.length, 0);
        assert.equal(h.calls.settled[0].action, "fail");
      } finally {
        fs.rmSync(outside, { force: true });
      }
    });
  }
});

test("approval of candidate two resumes and uploads only that exact SHA", async () => {
  const reviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hero-candidate-review-"));
  try {
    const first = workerHarness({
      config: { reviewDir: reviewRoot, workerToken: "worker-test-token" },
      persistReviewImpl: workerModule.persistReviewArtifact,
      runnerImpl: async (_jobFile, job) => {
        const firstPath = path.join(job.outDir, "candidate-a.mp4");
        const secondPath = path.join(job.outDir, "candidate-b.mp4");
        fs.writeFileSync(firstPath, CLIP);
        fs.writeFileSync(secondPath, CLIP_V2);
        return { verdict: {
          ok: false,
          status: "awaiting_review",
          candidates: [reviewCandidate(firstPath, CLIP), reviewCandidate(secondPath, CLIP_V2)],
          remaster: REMASTER,
        } };
      },
    });
    const heldResult = await first.worker.processJob(leased());
    assert.equal(heldResult.status, "awaiting_review");
    const approvedArtifact = first.calls.settled[0].verdict.candidates[1].approved_artifact;
    const approvedAt = new Date(Date.now() - 1000).toISOString();

    const resumed = workerHarness({
      config: { reviewDir: reviewRoot, workerToken: "worker-test-token" },
      runnerImpl: async (_jobFile, job) => {
        const bytes = fs.readFileSync(job.approvedClip.path);
        assert.equal(job.approvedClip.sha256, CLIP_V2_SHA);
        assert.equal(workerModule.sha256Hex(bytes), CLIP_V2_SHA);
        return { verdict: {
          ok: true,
          status: "approved",
          generator: "ads_animate_image",
          clipPath: job.approvedClip.path,
          sha256: CLIP_V2_SHA,
          approval: { approved: true, approved_by: "Mark", approved_at: approvedAt, sha256: CLIP_V2_SHA },
        } };
      },
    });
    const result = await resumed.worker.processJob(leased({
      approved_clip: { approved: true, approved_by: "Mark", approved_at: approvedAt, sha256: CLIP_V2_SHA },
      approved_artifact: approvedArtifact,
      optimized_asset: OPTIMIZED,
    }));
    assert.equal(result.status, "complete");
    assert.equal(resumed.calls.upload.length, 1);
    assert.equal(resumed.calls.upload[0][3].sha256, CLIP_V2_SHA);
  } finally {
    fs.rmSync(reviewRoot, { recursive: true, force: true });
  }
});

test("regenerate revision 2 ignores revision 1 receipt and runs Google anew", async () => {
  const reviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hero-revision-test-"));
  try {
    const jobDir = path.join(reviewRoot, "hrj_worker");
    fs.mkdirSync(jobDir);
    const oldClipPath = path.join(jobDir, `${CLIP_SHA}.mp4`);
    fs.writeFileSync(oldClipPath, CLIP);
    fs.writeFileSync(path.join(jobDir, `${CLIP_SHA}.json`), JSON.stringify({
      job_id: "hrj_worker",
      prospect_id: "wss-test-acme",
      source_sha256: RAW_SHA,
      source_url: "https://acme.example.com/work/job.jpg",
      clip_sha256: CLIP_SHA,
      clip_path: oldClipPath,
      approved_artifact: APPROVED_ARTIFACT,
      optimized_asset: OPTIMIZED,
      generation_revision: 1,
    }));

    const h = workerHarness({
      config: { reviewDir: reviewRoot, workerToken: "worker-test-token" },
      persistReviewImpl: workerModule.persistReviewArtifact,
      runnerImpl: async (_jobFile, job) => {
        h.calls.runner.push(job);
        const clipPath = path.join(job.outDir, "revision-2.mp4");
        fs.writeFileSync(clipPath, CLIP_V2);
        return { verdict: {
          ok: false,
          status: "awaiting_review",
          review: { clipPath, sha256: CLIP_V2_SHA, bytes: CLIP_V2.length },
          remaster: REMASTER,
        } };
      },
    });
    const result = await h.worker.processJob(leased({ generation_revision: 2 }));
    assert.equal(result.status, "awaiting_review", JSON.stringify(result));
    assert.equal(h.calls.runner.length, 1, "stale revision was ignored instead of re-held");
    assert.equal(h.calls.settled.length, 1);
    assert.equal(h.calls.settled[0].action, "hold");
    assert.equal(h.calls.settled[0].verdict.generation_revision, 2);
    assert.equal(h.calls.settled[0].verdict.clip_sha256, CLIP_V2_SHA);
  } finally {
    fs.rmSync(reviewRoot, { recursive: true, force: true });
  }
});

test("approved exact held clip resumes without regeneration, uploads once, and completes once", async () => {
  const approvedAt = new Date(Date.now() - 60_000).toISOString();
  let resumedPath = "";
  const h = workerHarness({
    stageApprovedReviewImpl: async (_job, _candidate, artifact, _reviewRoot, dir) => {
      const clipPath = path.join(dir, "approved-review.mp4");
      fs.writeFileSync(clipPath, CLIP);
      resumedPath = clipPath;
      return { path: clipPath, artifact, clip: { bytes: CLIP, sha256: CLIP_SHA }, receipt: { optimized_asset: OPTIMIZED } };
    },
    runnerImpl: async () => assert.fail("an approved held clip must not rerun Ads"),
  });
  const result = await h.worker.processJob(leased({
    approved_clip: { approved: true, approved_by: "Mark", approved_at: approvedAt, sha256: CLIP_SHA },
    approved_artifact: APPROVED_ARTIFACT,
    optimized_asset: OPTIMIZED,
  }));
  assert.equal(result.status, "complete");
  assert.match(path.basename(resumedPath), /approved-review\.mp4/);
  assert.equal(h.calls.runner.length, 0, "staged bytes are locally verified without rerunning Ads");
  assert.equal(h.calls.upload.length, 1);
  assert.equal(h.calls.settled.length, 0, "upload route owns the terminal settlement");
  assert.equal(h.calls.upload[0][2].sha256, RAW_SHA);
  assert.equal(h.calls.upload[0][3].sha256, CLIP_SHA);
});

test("a lost upload response retries once with fresh multipart and never self-settles fail", async () => {
  const approvedAt = new Date(Date.now() - 60_000).toISOString();
  const forms = [];
  const h = workerHarness({
    stageApprovedReviewImpl: async (_job, _candidate, artifact, _reviewRoot, dir) => {
      const clipPath = path.join(dir, "approved-review.mp4");
      fs.writeFileSync(clipPath, CLIP);
      return { path: clipPath, artifact, clip: { bytes: CLIP, sha256: CLIP_SHA }, receipt: { optimized_asset: OPTIMIZED } };
    },
    runnerImpl: async (_jobFile, job) => ({ verdict: {
      ok: true,
      status: "approved",
      generator: "ads_animate_image",
      clipPath: job.approvedClip.path,
      sha256: CLIP_SHA,
      approval: { approved: true, approved_by: "Mark", approved_at: approvedAt, sha256: CLIP_SHA },
    } }),
    uploadImpl: async (_workerApi, ...args) => workerModule.uploadApprovedClip(
      async (_pathname, request) => {
        forms.push(request.body);
        if (forms.length === 1) throw new Error("response_lost_after_server_commit");
        return {
          ok: true,
          status: 202,
          body: { ok: true, terminal: true, job_status: "done", reused: true, url: "https://assets.example.com/hero.mp4" },
        };
      },
      ...args,
    ),
  });
  const result = await h.worker.processJob(leased({
    approved_clip: { approved: true, approved_by: "Mark", approved_at: approvedAt, sha256: CLIP_SHA },
    approved_artifact: APPROVED_ARTIFACT,
    optimized_asset: OPTIMIZED,
  }));
  assert.equal(result.status, "complete");
  assert.equal(forms.length, 2);
  assert.notEqual(forms[0], forms[1], "a consumed multipart body is never reused");
  assert.equal(forms[0].get("lease_token"), "lease_worker");
  assert.equal(forms[1].get("lease_token"), "lease_worker");
  assert.equal(forms[0].get("image_preparation"), "image_editor");
  assert.equal(h.calls.settled.length, 0, "server-owned terminal recovery prevents worker fail settlement");
});

test("direct client-photo upload carries its truth mode without requiring a response field", async () => {
  const artifact = workerModule.approvedArtifactFrom({
    sourceSha256: RAW_SHA,
    sourceUrl: "https://acme.example.com/work/job.jpg",
    clipSha256: CLIP_SHA,
    optimizedAsset: DIRECT_OPTIMIZED,
  });
  let form;
  const result = await workerModule.uploadApprovedClip(
    async (_pathname, request) => {
      form = request.body;
      return { ok: true, status: 202, body: { ok: true, terminal: true, url: "https://assets.example.com/hero.mp4" } };
    },
    workerModule.normalizeLeasedJob(leased()),
    leased().photo_bank.photos[0],
    { bytes: CLIP, sha256: CLIP_SHA },
    { approvedBy: "Mark", approvedAt: new Date(Date.now() - 1000).toISOString(), clipSha256: CLIP_SHA },
    artifact,
  );
  assert.equal(result.terminal, true);
  assert.equal(form.get("image_preparation"), "direct_client_photo");
  assert.equal(form.get("optimized_sha256"), RAW_SHA);
  assert.equal(form.get("optimized_asset_fingerprint"), `direct-source:${RAW_SHA}`);
});

test("deterministic upload HTTP failures are never retried", async () => {
  let attempts = 0;
  const approvedAt = new Date(Date.now() - 60_000).toISOString();
  await assert.rejects(
    () => workerModule.uploadApprovedClip(
      async () => {
        attempts += 1;
        return { ok: false, status: 409, body: { ok: false, error: "completed_upload_retry_mismatch" } };
      },
      workerModule.normalizeLeasedJob(leased()),
      leased().photo_bank.photos[0],
      { bytes: CLIP, sha256: CLIP_SHA },
      { approvedBy: "Mark", approvedAt, clipSha256: CLIP_SHA },
      APPROVED_ARTIFACT,
    ),
    { code: "clip_upload_failed" },
  );
  assert.equal(attempts, 1);
});

test("wrong receipt generator or mismatched durable approval refuses before upload", async () => {
  const approvedAt = new Date(Date.now() - 60_000).toISOString();
  for (const { generator, approvedSha, expected } of [
    { generator: "tour_video", approvedSha: CLIP_SHA, expected: "approved_generation_receipt_mismatch" },
    { generator: "ads_animate_image", approvedSha: "f".repeat(64), expected: "approved_artifact_mismatch" },
  ]) {
    const h = workerHarness({
      stageApprovedReviewImpl: async (_job, _candidate, artifact, _reviewRoot, dir) => {
        const clipPath = path.join(dir, "approved-review.mp4");
        fs.writeFileSync(clipPath, CLIP);
        return { path: clipPath, artifact, clip: { bytes: CLIP, sha256: CLIP_SHA }, receipt: { optimized_asset: OPTIMIZED, generator } };
      },
      runnerImpl: async () => assert.fail("invalid approved receipts never rerun Ads"),
    });
    const result = await h.worker.processJob(leased({
      approved_clip: { approved: true, approved_by: "Mark", approved_at: approvedAt, sha256: approvedSha },
      approved_artifact: APPROVED_ARTIFACT,
      optimized_asset: OPTIMIZED,
    }));
    assert.equal(result.reason, expected);
    assert.equal(h.calls.upload.length, 0);
    assert.equal(h.calls.settled[0].action, "refuse");
  }
});

test("a lease conflict abandons one job but the long-running worker keeps polling", async () => {
  const processed = [];
  let claims = 0;
  let sleeps = 0;
  await workerModule.runWorkerLoop({
    claimJob: async () => ({ job_id: `job_${++claims}` }),
    processJob: async (job) => {
      processed.push(job.job_id);
      if (job.job_id === "job_1") throw Object.assign(new Error("stale"), { code: "lease_conflict" });
      return { status: "failed", reason: "test_complete", halt: true };
    },
  }, {
    pollMs: 1,
    sleepImpl: async () => { sleeps += 1; },
    logImpl: () => {},
  });
  assert.deepEqual(processed, ["job_1", "job_2"]);
  assert.equal(sleeps, 1);
});

test("heartbeat loss abandons stale work without killing the automatic worker", async () => {
  const processed = [];
  let claims = 0;
  await workerModule.runWorkerLoop({
    claimJob: async () => ({ job_id: `job_${++claims}` }),
    processJob: async (job) => {
      processed.push(job.job_id);
      if (job.job_id === "job_1") {
        return { status: "failed", reason: "lease_renewal_failed", halt: false };
      }
      return { status: "complete", halt: true };
    },
  }, { pollMs: 1, sleepImpl: async () => {}, logImpl: () => {} });
  assert.deepEqual(processed, ["job_1", "job_2"]);
});

test("worker relies only on leased photo bank and has no prospect-detail or send path", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "ads-station", "hero-forge-worker.cjs"), "utf8");
  assert.doesNotMatch(source, /\/api\/admin\/prospect-detail/);
  const imports = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  for (const imported of imports) assert.doesNotMatch(imported, /email|sms|twilio|resend|outreach|send/i);
});
