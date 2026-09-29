"use strict";

// hero-compose.test.js — the custom hero reel, proved by the bytes it writes.
//
// "QC PASS is never proof, render the DOM" applies to encoders too: an ffmpeg
// exit code of 0 is not evidence that a browser will play the file. So the
// happy-path test here ENCODES A REAL VIDEO with the real ffmpeg on PATH and
// then reads the result back with ffprobe — codec, pixel format, dimensions,
// duration, frame count — and additionally decodes single frames back out to
// check that the picture actually moves and that the scrim and watermark
// landed where the graph said they would.
//
// The photographs are synthesised HERE, with ffmpeg itself (testsrc2, smptebars,
// mandelbrot), so this test carries no image fixtures and touches no client
// asset. Nothing in this file reaches the network.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const {
  HERO_COMPOSE_DEFAULTS,
  composeHeroVideo,
  planReel,
  motionExpressions,
  buildFilterGraph,
  probeVideo,
} = require("../lib/hero-compose");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sh(bin, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${bin} failed: ${String(stderr || err.message).slice(0, 400)}`));
      resolve(String(stdout || ""));
    });
  });
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "hero-compose-"));

/** Three synthetic 1280x720 "client photos", plus a logo png with real alpha. */
async function makeFixtures() {
  const photos = [];
  const sources = [
    "testsrc2=size=1280x720:rate=1:duration=1",
    "smptebars=size=1280x720:rate=1:duration=1",
    // Not 16:9 on purpose: real client photos arrive in every aspect ratio and
    // the cover-crop has to handle it.
    "mandelbrot=size=1400x1050:rate=1",
  ];
  for (let i = 0; i < sources.length; i++) {
    const p = path.join(WORK, `photo-${i}.png`);
    await sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", sources[i], "-frames:v", "1", p]);
    photos.push(p);
  }
  const logo = path.join(WORK, "logo.png");
  await sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i",
    "color=c=0x00000000:s=240x120:d=0.04:r=1,format=rgba,geq=r=255:g=210:b=60:a='if(lt(hypot(X-120,Y-60),52),255,0)'",
    "-frames:v", "1", logo]);
  return { photos, logo };
}

/** Mean luma of a single decoded frame at time t. 0..255. */
async function frameLuma(video, t, crop = null) {
  const vf = [
    ...(crop ? [`crop=${crop}`] : []),
    "signalstats",
    "metadata=print:key=lavfi.signalstats.YAVG:file=-",
  ].join(",");
  const out = await sh("ffmpeg", ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", vf, "-f", "null", "-"]);
  const m = out.match(/YAVG=([\d.]+)/);
  assert.ok(m, `no YAVG reported at t=${t}`);
  return Number(m[1]);
}

/** Mean absolute inter-frame luma difference over a window. 0 means a still. */
async function motionOverWindow(video, start, end) {
  const out = await sh("ffmpeg", ["-v", "error", "-i", video, "-vf",
    `trim=start=${start}:end=${end},setpts=PTS-STARTPTS,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    "-f", "null", "-"]);
  const values = [...out.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(values.length > 5, "not enough frames sampled for a motion measurement");
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ===========================================================================
// PURE PLANNING — the arithmetic, without spending encoder time on it.
// ===========================================================================

test("planReel: shots overlap to exactly the requested duration", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const plan = planReel({ photoCount: n, durationSec: 12, fps: 30, crossfadeSec: 1 });
    assert.equal(plan.shots, n);
    // Whole-frame shots cost at most half a frame of drift each, so the bound
    // is n/(2*fps) — 0.10s at six shots, against a 20% (2.4s) contract.
    const bound = n / (2 * plan.fps) + 1e-6;
    assert.ok(Math.abs(plan.totalSec - 12) <= bound, `n=${n} total ${plan.totalSec} (bound ${bound})`);
    assert.equal(plan.offsets.length, n - 1);
    // Every crossfade must start inside the clip and after the previous one.
    let prev = -1;
    for (const off of plan.offsets) {
      assert.ok(off > prev, "offsets must increase");
      assert.ok(off + plan.crossfadeSec <= plan.totalSec + 1e-6, "a crossfade may not run past the end");
      prev = off;
    }
  }
});

test("planReel: the crossfade is clamped so a six-shot reel is not one long smear", () => {
  const plan = planReel({ photoCount: 6, durationSec: 8, fps: 30, crossfadeSec: 1 });
  assert.ok(plan.crossfadeSec < 1, "an 8s six-shot reel must shorten the dissolve");
  assert.ok(plan.crossfadeSec <= plan.shotSec / 2, "dissolve may never exceed half a shot");
});

test("planReel: an absurd duration is clamped, not obeyed", () => {
  assert.equal(planReel({ photoCount: 3, durationSec: 900 }).requestedSec, HERO_COMPOSE_DEFAULTS.durationBounds.max);
  assert.equal(planReel({ photoCount: 3, durationSec: 0.2 }).requestedSec, HERO_COMPOSE_DEFAULTS.durationBounds.min);
});

test("motionExpressions: alternating directions, closed form in `on`, no stateful zoom", () => {
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    const m = motionExpressions(i, { shotFrames: 140 });
    seen.add(m.motion);
    assert.ok(m.z.includes("on/"), "the zoom must be a function of the output frame index");
    assert.ok(!/min\(zoom|max\(zoom/.test(m.z), "the stateful zoompan recipe is the one that snaps");
  }
  assert.equal(seen.size, 4, "four shots in a row must not share a motion");
  assert.equal(motionExpressions(4, { shotFrames: 140 }).motion, motionExpressions(0, { shotFrames: 140 }).motion);
});

test("buildFilterGraph: no bare commas inside quoted filter expressions", () => {
  const plan = planReel({ photoCount: 3, durationSec: 12 });
  const graph = buildFilterGraph({ plan, width: 1280, height: 720, hasLogo: true });
  for (const quoted of graph.match(/'[^']*'/g) || []) {
    assert.ok(!quoted.includes(","), `a comma inside ${quoted} is a quoting bug waiting to happen`);
  }
  assert.ok(graph.includes("[out]"), "the graph must end at the mapped label");
  assert.ok(graph.includes("xfade=transition=fade"), "shots must be crossfaded");
  assert.ok(graph.includes("zoompan="), "each shot must move");
  assert.ok(graph.includes("[3:v]"), "the logo takes the input index after the photos");
});

test("buildFilterGraph: no logo means no logo input is referenced", () => {
  const plan = planReel({ photoCount: 3, durationSec: 12 });
  const graph = buildFilterGraph({ plan, width: 1280, height: 720, hasLogo: false });
  assert.ok(!graph.includes("[3:v]"), "a fourth input must not be referenced when there is no logo");
  assert.ok(!graph.includes("[logo]"));
});

// ===========================================================================
// THE REAL ENCODE — bytes on disk, read back with ffprobe.
// ===========================================================================

test("composeHeroVideo: three client photos plus a logo become a playable, moving reel", async (t) => {
  const { photos, logo } = await makeFixtures();
  const outPath = path.join(WORK, "nested", "hero-composed.mp4");

  const started = Date.now();
  const res = await composeHeroVideo({ photos, logoPath: logo, outPath, durationSec: 12, width: 1280, height: 720 });
  const wall = Date.now() - started;

  assert.equal(res.ok, true, `compose failed: ${JSON.stringify(res)}`);
  t.diagnostic(`encode ${res.encodeMs}ms · total ${wall}ms · ${res.bytes} bytes · crf ${res.crf} · ${res.frames} frames`);

  // --- the contract the caller reads -------------------------------------
  assert.equal(res.width, 1280);
  assert.equal(res.height, 720);
  assert.equal(res.codec, "h264");
  assert.equal(res.pixFmt, "yuv420p");
  assert.equal(res.photosUsed, 3);
  assert.equal(res.logo, true);
  assert.ok(res.bytes > 100 * 1024, "an mp4 under 100KB at 720p is an empty container");
  assert.ok(res.bytes < 6 * 1024 * 1024, `size budget blown: ${res.bytes}`);
  assert.ok(Math.abs(res.durationSec - 12) / 12 <= 0.2, `duration ${res.durationSec}`);
  assert.ok(res.fps >= 24 && res.fps <= 30, `fps ${res.fps}`);

  // --- the same facts, straight off the file, not off the return value ----
  const st = fs.statSync(outPath);
  assert.equal(st.size, res.bytes);
  const probe = await probeVideo(outPath);
  assert.equal(probe.ok, true);
  assert.equal(probe.codec, "h264");
  assert.equal(probe.pixFmt, "yuv420p");
  assert.equal(probe.width, 1280);
  assert.equal(probe.height, 720);
  assert.ok(Math.abs(probe.durationSec - 12) / 12 <= 0.2);

  // --- faststart: the moov atom has to be at the front or the browser
  //     downloads the whole clip before the first frame paints -------------
  const head = Buffer.alloc(4096);
  const fd = fs.openSync(outPath, "r");
  fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const moov = head.indexOf(Buffer.from("moov", "ascii"));
  const mdat = head.indexOf(Buffer.from("mdat", "ascii"));
  assert.ok(moov > 0, "moov atom not in the first 4KB — faststart did not apply");
  assert.ok(mdat === -1 || moov < mdat, "moov must precede mdat");

  // --- muted: a hero video that can make noise eventually will -------------
  const streams = await sh("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", outPath]);
  assert.ok(!streams.includes("audio"), `an audio stream shipped: ${streams.trim()}`);

  // --- IT ACTUALLY MOVES. A still encoded as video is the failure this
  //     whole module exists to avoid; a zoompan that silently produced one
  //     repeated frame would pass every check above ------------------------
  const midShotMotion = await motionOverWindow(outPath, 1.0, 3.0);
  assert.ok(midShotMotion > 0.05, `the reel is not moving: mean inter-frame delta ${midShotMotion}`);
  t.diagnostic(`mid-shot mean inter-frame luma delta ${midShotMotion.toFixed(3)}`);

  // --- the crossfade is a real dissolve: the moment two shots overlap moves
  //     far more than the middle of a shot does --------------------------
  const xfadeMotion = await motionOverWindow(outPath, res.shotSec - res.crossfadeSec + 0.1, res.shotSec - 0.1);
  assert.ok(xfadeMotion > midShotMotion, `the dissolve (${xfadeMotion}) should move more than a slow push (${midShotMotion})`);

  // --- the bottom scrim is really darker than the same picture higher up ---
  const bottomBand = await frameLuma(outPath, 2.0, "1280:120:0:600");
  const upperBand = await frameLuma(outPath, 2.0, "1280:120:0:200");
  assert.ok(bottomBand < upperBand, `the scrim did not darken the bottom (${bottomBand} vs ${upperBand})`);
  t.diagnostic(`scrim: bottom band luma ${bottomBand.toFixed(1)} vs upper band ${upperBand.toFixed(1)}`);

  // --- the watermark is absent early and present late ---------------------
  //     Sampled in the bottom-right corner where the graph places it.
  const corner = `200:120:${1280 - 200 - 30}:${720 - 120 - 30}`;
  const cornerEarly = await frameLuma(outPath, 1.5, corner);
  const cornerLate = await frameLuma(outPath, res.durationSec - 1.2, corner);
  assert.ok(cornerLate > cornerEarly, `the logo never faded up (${cornerEarly} -> ${cornerLate})`);
  t.diagnostic(`watermark corner luma ${cornerEarly.toFixed(1)} -> ${cornerLate.toFixed(1)}`);

  // --- loopable: both ends land on black, so the wrap is invisible --------
  //     Y=16 IS black in limited-range yuv420p, which is what h264 writes by
  //     default; asserting < 12 would be asserting blacker-than-black.
  const first = await frameLuma(outPath, 0);
  const last = await frameLuma(outPath, res.durationSec - 0.04);
  const mid = await frameLuma(outPath, res.durationSec / 2);
  assert.ok(first >= 12 && first <= 20, `the clip does not open from limited-range black (${first})`);
  assert.ok(last >= 12 && last <= 20, `the clip does not close to limited-range black (${last})`);
  assert.ok(mid > first + 20 && mid > last + 20, `the fades are not fades — mid ${mid} vs ends ${first}/${last}`);
  t.diagnostic(`loop seam: first ${first.toFixed(1)} · mid ${mid.toFixed(1)} · last ${last.toFixed(1)}`);
});

// The regression this test exists for: PNG fixtures alone shipped a module
// that refused every real build. A JPEG decodes FULL RANGE, that range reaches
// libx264, and the stream comes back tagged `yuvj420p` — which is both the
// module's own refusal reason and, in a player that honours the tag, crushed
// blacks. Client photographs are JPEGs. This is the realistic input.
test("composeHeroVideo: JPEG photos (full-range) still produce limited-range yuv420p", async (t) => {
  const jpegs = [];
  const sources = [
    "mandelbrot=size=1920x1080:rate=1:start_scale=3",
    "testsrc2=size=1600x1200:rate=1:duration=1",
    "mandelbrot=size=1280x1600:rate=1:start_scale=9",
  ];
  for (let i = 0; i < sources.length; i++) {
    const p = path.join(WORK, `jpeg-${i}.jpg`);
    await sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", sources[i], "-frames:v", "1", "-q:v", "2", p]);
    jpegs.push(p);
  }
  // Prove the premise: the fixtures really are full-range.
  const inFmt = await sh("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=pix_fmt", "-of", "csv=p=0", jpegs[0]]);
  assert.ok(/yuvj|pc/.test(inFmt), `fixture is not full-range JPEG: ${inFmt.trim()}`);

  const outPath = path.join(WORK, "hero-jpeg.mp4");
  const res = await composeHeroVideo({ photos: jpegs, outPath, durationSec: 12 });
  assert.equal(res.ok, true, `JPEG photos must compose: ${JSON.stringify(res)}`);
  assert.equal(res.pixFmt, "yuv420p", "a yuvj420p hero is the full-range bug back again");

  const tagged = (await sh("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=pix_fmt,color_range", "-of", "csv=p=0", outPath])).trim();
  assert.ok(tagged.includes("yuv420p") && !tagged.includes("yuvj"), tagged);
  // `tv` or an absent tag are both correct — untagged yuv420p is limited by
  // universal convention. `pc` is the bug.
  assert.ok(!/\bpc\b/.test(tagged), `stream tagged full range: ${tagged}`);

  // THE EVIDENCE THAT MATTERS: the levels must have been CONVERTED, not merely
  // relabelled. A relabel leaves 0..255 data claiming to be 16..235 and the
  // blacks crush. The fade-to-black frame is the deterministic probe — it is
  // pure RGB(0,0,0) before conversion, so it must land on limited black.
  const black = await frameLuma(outPath, 0);
  assert.ok(black >= 12 && black <= 20, `faded-to-black frame is not limited-range black: Y=${black}`);
  t.diagnostic(`JPEG reel: ${res.encodeMs}ms · ${res.bytes} bytes · ${tagged} · black frame Y=${black.toFixed(1)}`);
});

test("composeHeroVideo: two photos and no logo still make a reel", async (t) => {
  const { photos } = await makeFixtures();
  const outPath = path.join(WORK, "hero-two.mp4");
  const res = await composeHeroVideo({ photos: photos.slice(0, 2), outPath, durationSec: 8 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.photosUsed, 2);
  assert.equal(res.logo, false);
  assert.ok(Math.abs(res.durationSec - 8) / 8 <= 0.2, `duration ${res.durationSec}`);
  t.diagnostic(`2-photo reel: ${res.encodeMs}ms · ${res.bytes} bytes · ${res.durationSec}s`);
});

test("composeHeroVideo: a named-but-missing logo is skipped, not fatal", async (t) => {
  const { photos } = await makeFixtures();
  const outPath = path.join(WORK, "hero-nologo.mp4");
  const res = await composeHeroVideo({
    photos,
    logoPath: path.join(WORK, "there-is-no-such-logo.png"),
    outPath,
    durationSec: 6,
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.logo, false);
  assert.equal(res.logoSkipped, "logo_missing");
  t.diagnostic(`logo-skipped reel: ${res.encodeMs}ms · ${res.bytes} bytes`);
});

// ===========================================================================
// FAIL-SOFT — every one of these must RETURN, never throw, and must leave no
// file behind that a later step could mistake for a hero video.
// ===========================================================================

test("composeHeroVideo: a nonexistent photo fails soft", async () => {
  const { photos } = await makeFixtures();
  const outPath = path.join(WORK, "hero-missing.mp4");
  const res = await composeHeroVideo({
    photos: [photos[0], path.join(WORK, "no-such-photo.jpg")],
    outPath,
    durationSec: 8,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "photo_missing");
  assert.equal(fs.existsSync(outPath), false, "a failed compose must leave nothing behind");
});

test("composeHeroVideo: one photo is not a reel", async () => {
  const { photos } = await makeFixtures();
  const res = await composeHeroVideo({ photos: [photos[0]], outPath: path.join(WORK, "hero-one.mp4") });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "need_at_least_two_photos");
});

test("composeHeroVideo: the same photo twice is not two shots", async () => {
  const { photos } = await makeFixtures();
  const res = await composeHeroVideo({ photos: [photos[0], photos[0]], outPath: path.join(WORK, "hero-dup.mp4") });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "need_at_least_two_photos");
});

test("composeHeroVideo: garbage in, a reason out — never a throw", async () => {
  const cases = [
    [{}, "no_out_path"],
    [{ outPath: path.join(WORK, "x.mp4") }, "photos_not_an_array"],
    [{ photos: "not-an-array", outPath: path.join(WORK, "x.mp4") }, "photos_not_an_array"],
    [{ photos: [null, 7], outPath: path.join(WORK, "x.mp4") }, "photo_path_not_a_string"],
  ];
  for (const [input, reason] of cases) {
    const res = await composeHeroVideo(input);
    assert.equal(res.ok, false, JSON.stringify({ input, res }));
    assert.equal(res.reason, reason);
  }
  // Called with nothing at all.
  const bare = await composeHeroVideo();
  assert.equal(bare.ok, false);
  assert.equal(bare.reason, "no_out_path");
});

test("composeHeroVideo: a photo file that is not an image fails soft on ffmpeg's own refusal", async () => {
  const { photos } = await makeFixtures();
  const junk = path.join(WORK, "not-an-image.png");
  fs.writeFileSync(junk, Buffer.from("this is not a photograph, it is a sentence"));
  const outPath = path.join(WORK, "hero-junk.mp4");
  const res = await composeHeroVideo({ photos: [photos[0], junk], outPath, durationSec: 8 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "ffmpeg_failed");
  assert.ok(res.detail && res.detail.length > 0, "the encoder's own complaint should reach the caller");
  assert.equal(fs.existsSync(outPath), false);
});

test("composeHeroVideo: an unreasonably tight size ceiling refuses rather than shipping", async (t) => {
  const { photos } = await makeFixtures();
  const outPath = path.join(WORK, "hero-tiny-budget.mp4");
  const res = await composeHeroVideo({
    photos,
    outPath,
    durationSec: 6,
    // Both budgets below any real 720p reel: the shrink ladder runs, fails to
    // reach the target, and the hard ceiling then refuses.
    maxBytes: 40 * 1024,
    hardMaxBytes: 60 * 1024,
    minBytes: 1024,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "over_size_budget");
  assert.ok(Array.isArray(res.shrinkPasses) && res.shrinkPasses.length > 0, "the shrink ladder should have been tried");
  assert.equal(fs.existsSync(outPath), false, "an over-budget clip must not be left on disk");
  t.diagnostic(`shrink ladder: ${JSON.stringify(res.shrinkPasses)} then refused at ${res.detail}`);
});

test("probeVideo: a file that is not a video reports a reason instead of throwing", async () => {
  const junk = path.join(WORK, "junk.mp4");
  fs.writeFileSync(junk, Buffer.from("nope"));
  const res = await probeVideo(junk);
  assert.equal(res.ok, false);
  assert.ok(res.reason);
});

test.after(() => {
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* temp dir */ }
});
