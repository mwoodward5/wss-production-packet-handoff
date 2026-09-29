"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const attester = require("../lib/hero-video-visual-attester");
const visualGate = require("../lib/hero-video-visual-gate");

const SECRET = "visual-attester-test-secret-at-least-32-bytes";
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function scene(seed, shift = 0) {
  const out = Buffer.alloc(attester.FRAME_BYTES);
  for (let y = 0; y < attester.FRAME_SIDE; y += 1) {
    for (let x = 0; x < attester.FRAME_SIDE; x += 1) {
      const offset = ((y * attester.FRAME_SIDE) + x) * 3;
      const moved = (x + shift + attester.FRAME_SIDE) % attester.FRAME_SIDE;
      out[offset] = (seed + (moved * 3) + (y * 2)) % 256;
      out[offset + 1] = (seed * 2 + (moved * 2) + (y * 5)) % 256;
      out[offset + 2] = (seed * 3 + (moved * 7) + y) % 256;
    }
  }
  return out;
}

function unrelatedScene(shift = 0) {
  const out = Buffer.alloc(attester.FRAME_BYTES);
  for (let y = 0; y < attester.FRAME_SIDE; y += 1) {
    for (let x = 0; x < attester.FRAME_SIDE; x += 1) {
      const offset = ((y * attester.FRAME_SIDE) + x) * 3;
      const checker = ((Math.floor((x + shift) / 5) + Math.floor(y / 7)) % 2) ? 225 : 18;
      out[offset] = checker;
      out[offset + 1] = (x * y + (shift * 17)) % 97;
      out[offset + 2] = 255 - checker;
    }
  }
  return out;
}

function blockMeanMosaic(source, polarity, amplitude = 9) {
  const out = Buffer.alloc(source.length);
  const block = 8;
  for (let by = 0; by < attester.FRAME_SIDE; by += block) {
    for (let bx = 0; bx < attester.FRAME_SIDE; bx += block) {
      const totals = [0, 0, 0];
      for (let y = by; y < by + block; y += 1) {
        for (let x = bx; x < bx + block; x += 1) {
          const offset = ((y * attester.FRAME_SIDE) + x) * 3;
          totals[0] += source[offset];
          totals[1] += source[offset + 1];
          totals[2] += source[offset + 2];
        }
      }
      const means = totals.map((value) => Math.round(value / (block * block)));
      for (let y = by; y < by + block; y += 1) {
        for (let x = bx; x < bx + block; x += 1) {
          const offset = ((y * attester.FRAME_SIDE) + x) * 3;
          const flicker = (((x + y + polarity) & 1) === 0 ? amplitude : -amplitude);
          for (let channel = 0; channel < 3; channel += 1) {
            out[offset + channel] = Math.max(0, Math.min(255, means[channel] + flicker));
          }
        }
      }
    }
  }
  return out;
}

function shiftFrame(source, shift) {
  const out = Buffer.alloc(source.length);
  for (let y = 0; y < attester.FRAME_SIDE; y += 1) {
    for (let x = 0; x < attester.FRAME_SIDE; x += 1) {
      const fromX = (x + shift + attester.FRAME_SIDE) % attester.FRAME_SIDE;
      const to = ((y * attester.FRAME_SIDE) + x) * 3;
      const from = ((y * attester.FRAME_SIDE) + fromX) * 3;
      source.copy(out, to, from, from + 3);
    }
  }
  return out;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hero-attester-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceBytes = Buffer.from("exact-client-source-image-bytes");
  const clipBytes = Buffer.from("exact-staged-generated-video-bytes-0000000000");
  const sourceSha = sha(sourceBytes);
  const clipSha = sha(clipBytes);
  const jobDir = path.join(root, "hrj_attester");
  fs.mkdirSync(jobDir);
  const sourcePath = path.join(jobDir, "downloaded-source.jpg");
  fs.writeFileSync(sourcePath, sourceBytes);
  const clipPath = path.join(jobDir, `${clipSha}.mp4`);
  fs.writeFileSync(clipPath, clipBytes);
  const receiptPath = path.join(jobDir, `${clipSha}.json`);
  const receipt = {
    job_id: "hrj_attester",
    prospect_id: "wss-attester",
    generation_revision: 1,
    source_url: "https://client.example/real-scene.jpg",
    source_sha256: sourceSha,
    clip_sha256: clipSha,
    clip_path: clipPath,
    status: "awaiting_review",
    approved_artifact: {
      raw_sha256: sourceSha,
      source_url: "https://client.example/real-scene.jpg",
      clip_sha256: clipSha,
    },
    optimized_asset: { sha256: "a".repeat(64) },
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  return { root, sourceBytes, sourcePath, clipPath, receiptPath, receipt };
}

function happyOptions(f, overrides = {}) {
  const source = scene(37);
  const frames = [scene(37, 0), scene(37, 1), scene(37, 2), scene(37, 3), scene(37, 4)];
  let decodeIndex = 0;
  return {
    secret: SECRET,
    reviewRoot: f.root,
    downloadSourceImpl: async (_receipt, tempDir) => {
      const staged = path.join(tempDir, "source-raw.jpg");
      fs.writeFileSync(staged, f.sourceBytes);
      return { filePath: staged, sha256: sha(f.sourceBytes) };
    },
    probeImpl: async () => ({ duration: 4, width: 1280, height: 720, frameCount: 96 }),
    decodeImpl: async () => decodeIndex++ === 0 ? source : frames[decodeIndex - 2],
    ...overrides,
  };
}

function addPersistedSource(f) {
  const sourceSha = sha(f.sourceBytes);
  const sourcePath = path.join(path.dirname(f.receiptPath), `${sourceSha}.jpg`);
  fs.writeFileSync(sourcePath, f.sourceBytes);
  f.sourcePath = sourcePath;
  f.receipt = { ...f.receipt, source_path: sourcePath };
  fs.writeFileSync(f.receiptPath, JSON.stringify(f.receipt));
  return f;
}

test("exact source and clip bytes plus live matching frames produce a signed gate", async (t) => {
  const f = fixture(t);
  const result = await attester.attestVisualGateReceipt({ path: f.receiptPath, raw: f.receipt }, happyOptions(f));
  assert.equal(result.ok, true);
  assert.equal(result.gate.evaluator, attester.EVALUATOR);
  assert.equal(visualGate.verifyVisualGateReceipt(result.receipt, { secret: SECRET }).ok, true);
  const saved = JSON.parse(fs.readFileSync(f.receiptPath, "utf8"));
  assert.equal(saved.visual_gate.signature, result.gate.signature);
});

test("a hash-bound persisted source wins over a mutable remote URL", async (t) => {
  const f = addPersistedSource(fixture(t));
  let remoteDownloads = 0;
  const result = await attester.attestVisualGateReceipt(
    { path: f.receiptPath, raw: f.receipt },
    happyOptions(f, {
      downloadSourceImpl: async () => {
        remoteDownloads += 1;
        throw new Error("mutable_remote_must_not_be_read");
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(remoteDownloads, 0);
});

test("persisted source tampering, symlinks, and path escape fail closed", async (t) => {
  await t.test("tampered bytes", async () => {
    const f = addPersistedSource(fixture(t));
    fs.writeFileSync(f.sourcePath, "changed-source-bytes");
    await assert.rejects(
      () => attester.attestVisualGateReceipt({ path: f.receiptPath, raw: f.receipt }, happyOptions(f)),
      { code: "hero_visual_source_sha256_mismatch" },
    );
  });

  await t.test("symlink", async (subtest) => {
    const f = fixture(t);
    const target = path.join(path.dirname(f.receiptPath), "source-target.jpg");
    fs.writeFileSync(target, f.sourceBytes);
    const sourcePath = path.join(path.dirname(f.receiptPath), `${sha(f.sourceBytes)}.jpg`);
    try { fs.symlinkSync(target, sourcePath, "file"); }
    catch (error) {
      if (error?.code === "EPERM") { subtest.skip("file symlinks unavailable on this host"); return; }
      throw error;
    }
    f.receipt = { ...f.receipt, source_path: sourcePath };
    fs.writeFileSync(f.receiptPath, JSON.stringify(f.receipt));
    await assert.rejects(
      () => attester.attestVisualGateReceipt({ path: f.receiptPath, raw: f.receipt }, happyOptions(f)),
      { code: "hero_visual_source_path_refused" },
    );
  });

  await t.test("path escape", async () => {
    const f = fixture(t);
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-attester-outside-"));
    t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
    const sourcePath = path.join(outsideDir, `${sha(f.sourceBytes)}.jpg`);
    fs.writeFileSync(sourcePath, f.sourceBytes);
    f.receipt = { ...f.receipt, source_path: sourcePath };
    fs.writeFileSync(f.receiptPath, JSON.stringify(f.receipt));
    await assert.rejects(
      () => attester.attestVisualGateReceipt({ path: f.receiptPath, raw: f.receipt }, happyOptions(f)),
      { code: "hero_visual_source_path_refused" },
    );
  });
});

test("legacy receipts without source_path retain the hardened remote fallback", async (t) => {
  const f = fixture(t);
  let remoteDownloads = 0;
  const result = await attester.attestVisualGateReceipt(
    { path: f.receiptPath, raw: f.receipt },
    happyOptions(f, {
      downloadSourceImpl: async (_receipt, tempDir) => {
        remoteDownloads += 1;
        const staged = path.join(tempDir, "source-raw.jpg");
        fs.writeFileSync(staged, f.sourceBytes);
        return { filePath: staged };
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(remoteDownloads, 1);
});

test("source or staged clip SHA mismatch fails before visual approval", async (t) => {
  const sourceMismatch = fixture(t);
  await assert.rejects(
    () => attester.attestVisualGateReceipt(
      { path: sourceMismatch.receiptPath, raw: sourceMismatch.receipt },
      happyOptions(sourceMismatch, {
        downloadSourceImpl: async (_receipt, tempDir) => {
          const staged = path.join(tempDir, "source-raw.jpg");
          fs.writeFileSync(staged, "different-source");
          return { filePath: staged };
        },
      }),
    ),
    { code: "hero_visual_source_sha256_mismatch" },
  );

  const clipMismatch = fixture(t);
  fs.appendFileSync(clipMismatch.clipPath, "tampered");
  await assert.rejects(
    () => attester.attestVisualGateReceipt(
      { path: clipMismatch.receiptPath, raw: clipMismatch.receipt },
      happyOptions(clipMismatch),
    ),
    { code: "hero_visual_clip_sha256_mismatch" },
  );
});

test("blank, frozen, and unrelated video frames are refused", () => {
  const source = scene(37);
  assert.throws(
    () => attester.inspectFrames(source, Array.from({ length: 5 }, () => Buffer.alloc(attester.FRAME_BYTES))),
    { code: "hero_visual_clip_blank" },
  );
  assert.throws(
    () => attester.inspectFrames(source, Array.from({ length: 5 }, () => Buffer.from(source))),
    { code: "hero_visual_clip_frozen" },
  );
  const unrelated = [0, 2, 4, 6, 8].map(unrelatedScene);
  assert.throws(
    () => attester.inspectFrames(source, unrelated),
    { code: "hero_visual_source_identity_mismatch" },
  );
});

test("block-mean source reconstruction with alternating checker flicker is refused", () => {
  const source = scene(37);
  const corrupt = [0, 1, 0, 1, 0].map((polarity) => blockMeanMosaic(source, polarity));
  assert.throws(
    () => attester.inspectFrames(source, corrupt),
    { code: "hero_visual_clip_temporal_flicker" },
  );
});

test("subtle source-bound motion keeps high-resolution edges and passes", () => {
  const source = scene(37);
  const subtle = [0, 1, 2, 3, 4].map((shift) => scene(37, shift));
  const result = attester.inspectFrames(source, subtle);
  assert.ok(result.strongMatches >= 1);
  assert.ok(result.credibleMatches >= 3);
  assert.ok(result.maxEdge >= 0.075);
  assert.ok(result.maxHighPass >= 0.035);
});

test("a moving coarse block reconstruction is not the source scene", () => {
  const source = scene(37);
  const mosaic = blockMeanMosaic(source, 0, 0);
  const movingMosaic = [0, 1, 2, 3, 4].map((shift) => shiftFrame(mosaic, shift));
  assert.throws(
    () => attester.inspectFrames(source, movingMosaic),
    { code: "hero_visual_source_identity_mismatch" },
  );
});

test("a moving checker mosaic is refused even without alternating frame polarity", () => {
  const source = scene(37);
  const checkerMosaic = blockMeanMosaic(source, 0, 9);
  const movingMosaic = [0, 2, 4, 6, 8].map((shift) => shiftFrame(checkerMosaic, shift));
  assert.throws(
    () => attester.inspectFrames(source, movingMosaic),
    { code: "hero_visual_clip_mosaic" },
  );
});

test("one authentic opening frame cannot hide a substituted scene", () => {
  const source = scene(37);
  const substituted = [source, 0, 2, 4, 6].map((frame, index) => (
    index === 0 ? Buffer.from(source) : unrelatedScene(frame)
  ));
  assert.throws(
    () => attester.inspectFrames(source, substituted),
    { code: "hero_visual_source_identity_mismatch" },
  );
});

test("missing secret or local tools fails closed without a signature", async (t) => {
  const noSecret = fixture(t);
  await assert.rejects(
    () => attester.attestVisualGateReceipt(
      { path: noSecret.receiptPath, raw: noSecret.receipt },
      { ...happyOptions(noSecret), secret: "" },
    ),
    { code: "hero_visual_gate_secret_required" },
  );

  const noProbe = fixture(t);
  await assert.rejects(
    () => attester.attestVisualGateReceipt(
      { path: noProbe.receiptPath, raw: noProbe.receipt },
      happyOptions(noProbe, {
        probeImpl: undefined,
        execFileImpl: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
      }),
    ),
    { code: "hero_visual_ffprobe_unavailable" },
  );
  assert.equal(JSON.parse(fs.readFileSync(noProbe.receiptPath, "utf8")).visual_gate, undefined);

  const noDecode = fixture(t);
  await assert.rejects(
    () => attester.attestVisualGateReceipt(
      { path: noDecode.receiptPath, raw: noDecode.receipt },
      happyOptions(noDecode, {
        decodeImpl: undefined,
        execFileImpl: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
      }),
    ),
    { code: "hero_visual_ffmpeg_unavailable" },
  );
});

test("real ffmpeg accepts a moving clip made from the exact source", async (t) => {
  const ffmpeg = childProcess.spawnSync("ffmpeg", ["-version"], { windowsHide: true });
  const ffprobe = childProcess.spawnSync("ffprobe", ["-version"], { windowsHide: true });
  if (ffmpeg.status !== 0 || ffprobe.status !== 0) {
    t.skip("ffmpeg/ffprobe are not installed on this test host");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hero-attester-real-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.png");
  const clip = path.join(root, "clip.mp4");
  assert.equal(childProcess.spawnSync("ffmpeg", [
    "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=1",
    "-frames:v", "1", source,
  ], { windowsHide: true }).status, 0);
  assert.equal(childProcess.spawnSync("ffmpeg", [
    "-y", "-v", "error", "-loop", "1", "-i", source,
    "-vf", "zoompan=z='min(zoom+0.0015,1.12)':d=96:s=1280x720:fps=24",
    "-t", "4", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip,
  ], { windowsHide: true }).status, 0);
  const probe = await attester.probeClip(clip);
  const sourceFrame = await attester.decodeRgb(source);
  const frames = [];
  for (const fraction of [0.02, 0.22, 0.5, 0.78, 0.96]) {
    frames.push(await attester.decodeRgb(clip, { atSeconds: probe.duration * fraction }));
  }
  const metrics = attester.inspectFrames(sourceFrame, frames);
  assert.ok(metrics.maxMotion >= 0.75);
  assert.ok(metrics.maxSpatial >= 0.28 || metrics.maxHistogram >= 0.42);
});
