"use strict";

// lib/hero-compose.js — THE CUSTOM HERO VIDEO, MADE OF THEIR OWN WORK.
//
// Owner's brief: "use their own imagery, maybe integrate their logo in one of
// their pictures — a total custom hero video that's free."
//
// What this builds is a CINEMATIC MULTI-SHOT REEL: two to six of the client's
// own photographs, each given a slow zoom/pan in an alternating direction,
// crossfaded into one another, darkened at the bottom edge so a headline can
// sit on it, with the client's own mark fading up in the corner over the last
// shot. Twelve seconds, muted, H.264, loopable, and it costs nothing but CPU.
//
// This is deliberately NOT single-photo Ken Burns. One photo pushing slowly in
// is a screensaver, and every trade site that ships one looks like every other.
// A reel of four real job shots is the pitch: that is THEIR truck, THEIR roof,
// THEIR crew, moving, above the fold.
//
// ---------------------------------------------------------------------------
// TRUTH LAW — WHAT THIS MODULE WILL NOT DO
// ---------------------------------------------------------------------------
// It composes ONLY the bytes it is handed. It never fetches an image, never
// searches for one, never generates one, and never draws a word of text. The
// caller guarantees provenance — that every path in `photos` is the client's
// OWN verified photograph and that `logoPath` is the client's OWN mark, not a
// manufacturer badge or a platform icon that merely happened to be hosted on
// their domain (see the Mastercool/Blogger incident: owning the HOST is not
// owning the MARK). If the caller hands us someone else's picture, this module
// will faithfully make a beautiful video of someone else's picture. The gate
// belongs upstream, at the point of verification, and it is not weakened here.
//
// ---------------------------------------------------------------------------
// FAIL-SOFT, ALWAYS
// ---------------------------------------------------------------------------
// A hero video is an UPGRADE on a rung of a ladder that already works. If any
// part of this fails — a missing file, an ffmpeg that is not on PATH, a filter
// graph the local build refuses, an encode that blows its time or size budget —
// the answer is `{ ok:false, reason }` and the caller simply stays on the next
// rung (the WSS fallback clip, then the still poster). Nothing here throws.
// A half-written mp4 is deleted rather than left where a later step could
// mistake its existence for success.
//
// ---------------------------------------------------------------------------
// WHY THE FILTER GRAPH IS SHAPED THIS WAY
// ---------------------------------------------------------------------------
//   · SUPERSAMPLE BEFORE ZOOMPAN. zoompan computes its source window at integer
//     pixel offsets. Fed a 1280x720 still it steps a whole source pixel at a
//     time and the motion visibly ratchets. Scaling to 2x first (2560x1440)
//     halves the step and the ratchet goes away; 4x costs memory for a
//     difference nobody can see at hero size.
//   · COVER, THEN CROP. `scale=...:force_original_aspect_ratio=increase` then
//     `crop` is the CSS `object-fit: cover` of ffmpeg. Client photos arrive in
//     every aspect ratio there is; letterboxing one into a hero is the
//     "abomination site" look, and stretching it is worse.
//   · MOTION AS A FUNCTION OF `on`, NOT OF `zoom`. The classic zoompan recipe
//     (`z='min(zoom+0.0008,1.12)'`) is stateful — it reads its own previous
//     output — which makes the end point depend on frame count, and the
//     zoom-OUT form of it is a notorious source of first-frame snaps. Every
//     expression here is a closed form in `on` (the output frame index), so
//     each shot starts and ends exactly where it is supposed to.
//   · FOUR MOTIONS, ROTATED. push-in centred, pull-out drifting right,
//     push-in drifting down, pull-out drifting left. Alternating direction is
//     what stops a reel feeling like a slideshow with one gimmick.
//   · THE GRADIENT IS ONE FRAME, LOOPED. A `geq` alpha ramp evaluated per frame
//     for 360 frames is the slowest thing in this file by an order of
//     magnitude. Generated once at 1x1-frame and held with `loop=-1:size=1`, it
//     is free. The ramp is quadratic (`(Y/H)^2`), so it is invisible where it
//     meets the picture and firm where the text sits — a linear ramp reads as a
//     grey band with an edge.
//   · NO COMMAS INSIDE FILTER EXPRESSIONS. `pow(Y/H,1.7)` would need escaping
//     that behaves differently on every layer between here and ffmpeg's own
//     parser, so the ramp is written `(Y/H)*(Y/H)` instead. Cheaper to read,
//     and it cannot be broken by a quoting change.
//   · FADE FROM AND TO BLACK. 0.35s at each end. This is what makes the clip
//     LOOPABLE without a wrap-around crossfade eating a shot: black meets
//     black at the seam, so the restart is invisible. The site plays it on
//     `loop`, and nobody ever sees the join.
//   · NO AUDIO STREAM AT ALL (`-an`). A hero video that can make noise is a
//     hero video that will one day make noise on someone's phone.
//
// ---------------------------------------------------------------------------
// RUNTIME CONSTRAINT — READ BEFORE WIRING THIS IN
// ---------------------------------------------------------------------------
// FFMPEG IS NOT IN THE SERVERLESS RUNTIME. The repo already documents the trap
// twice, in blood: lib/mirror-engine/favicon.js ("ffmpeg is on a developer
// machine and is NOT in the serverless runtime") and brand-assets.js
// measureAccent, which "returned null for every logo in production" for exactly
// this reason. Called from a Vercel function as things stand today, every call
// here returns `{ ok:false, reason:"ffmpeg_missing" }` — correctly, silently,
// and uselessly.
//
// So this module is only worth wiring where ffmpeg genuinely exists: the
// SiteForge/Chromium-bearing build host, a container image that ships ffmpeg,
// or the local forge lane. Wiring it into the lambda path without first putting
// an ffmpeg binary there would be "enabled ≠ wired" a third time, and the only
// visible symptom would be a hero that quietly stays on the fallback clip.
//
// ---------------------------------------------------------------------------
// COST
// ---------------------------------------------------------------------------
// Measured here, real ffmpeg 8.1.2, 12s at 1280x720 from JPEG sources:
//   2 photos 1.55s / 0.48MB · 4 photos 1.66s / 0.62MB · 6 photos 1.98s / 2.11MB
//   1920x1080, 4 photos: 3.39s / 1.28MB
// Every one inside the 4MB target with room to spare. Compare Veo, the #1
// uncapped line on the cost map. This rung is free.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HERO_COMPOSE_DEFAULTS = Object.freeze({
  durationSec: 12,
  width: 1280,
  height: 720,
  fps: 30,
  crossfadeSec: 1,
  crf: 26,
  preset: "veryfast",
  supersample: 2,

  // Motion. 14% travel over a shot is a slow push at hero size — enough that
  // the eye reads it as a moving image, little enough that nobody watches it
  // move.
  zoomTravel: 0.14,

  // The bottom scrim. 40% of frame height, 75% black at its darkest edge:
  // measured against white 700-weight display type at hero size, this is the
  // shallowest scrim that keeps a headline legible over a bright sky.
  gradientHeightRatio: 0.4,
  gradientAlpha: 0.75,

  // The watermark. A sixth of the frame wide, 88% opaque, fading up over 1.2s
  // shortly after the final shot begins. Tasteful means: present, not stamped.
  logoWidthRatio: 1 / 6,
  logoOpacity: 0.88,
  logoMargin: 44,
  logoFadeSec: 1.2,

  edgeFadeSec: 0.35,
  blackHoldFrames: 3,

  // Budgets. maxBytes is the TARGET — exceeding it triggers a re-encode ladder
  // rather than a refusal. hardMaxBytes is the refusal: past it the clip is
  // worse for the visitor than the fallback and the ladder should step down.
  maxBytes: 4 * 1024 * 1024,
  hardMaxBytes: 6 * 1024 * 1024,
  minBytes: 100 * 1024,
  shrinkCrfSteps: Object.freeze([5, 10]),

  timeoutMs: 120000,
  maxBuffer: 16 * 1024 * 1024,

  minPhotos: 2,
  maxPhotos: 6,
  durationBounds: Object.freeze({ min: 6, max: 30 }),

  // ffprobe's duration may legitimately differ from the request by a frame or
  // two of rounding. 20% is the caller-facing contract; anything past it means
  // the graph did not build what we asked for.
  durationTolerance: 0.2,
});

// The four motions, rotated across the shots. `zoom` is the direction of the
// push; `pan` is the drift laid over it.
const MOTIONS = Object.freeze([
  Object.freeze({ zoom: "in", pan: "center" }),
  Object.freeze({ zoom: "out", pan: "lr" }),
  Object.freeze({ zoom: "in", pan: "tb" }),
  Object.freeze({ zoom: "out", pan: "rl" }),
]);

// ---------------------------------------------------------------------------
// PLANNING — pure, so the arithmetic can be tested without an encoder.
// ---------------------------------------------------------------------------

/**
 * planReel({ photoCount, durationSec, fps, crossfadeSec })
 *
 * N shots of L seconds overlapping by XF give a total of N*L - (N-1)*XF. Solve
 * for L at the requested total, then SNAP L to a whole number of frames and
 * recompute the total from the snap — an unsnapped L makes every xfade offset
 * land between frames, and the accumulated drift is what turns a 12.000s
 * request into an 11.87s clip that then argues with the duration check.
 *
 * The crossfade is clamped to half the un-overlapped shot length: at six photos
 * in twelve seconds a full second of dissolve is most of the shot, and the reel
 * stops being a reel of photographs and becomes a smear.
 *
 * Snapping both the shot and the dissolve to whole frames means `totalSec` can
 * differ from the request by up to half a frame per shot — 0.07s on a four-shot
 * 30fps reel, three orders of magnitude inside the 20% duration contract. That
 * drift is the price of every xfade offset landing exactly on a frame boundary,
 * which is what the eye actually notices.
 */
function planReel({
  photoCount,
  durationSec = HERO_COMPOSE_DEFAULTS.durationSec,
  fps = HERO_COMPOSE_DEFAULTS.fps,
  crossfadeSec = HERO_COMPOSE_DEFAULTS.crossfadeSec,
} = {}) {
  const n = Math.max(1, Math.floor(photoCount) || 0);
  const bounds = HERO_COMPOSE_DEFAULTS.durationBounds;
  const target = Math.min(bounds.max, Math.max(bounds.min, Number(durationSec) || HERO_COMPOSE_DEFAULTS.durationSec));
  const rate = Math.max(1, Math.round(Number(fps) || HERO_COMPOSE_DEFAULTS.fps));
  const wanted = Math.max(0, Number(crossfadeSec) || 0);
  // Half the naive per-shot slice, never more than asked for, always at least
  // one frame — xfade with duration 0 is a filter error, not a hard cut.
  const xfadeFrames = n > 1 ? Math.max(1, Math.round(Math.min(wanted, (target / n) * 0.5) * rate)) : 0;
  const xfade = xfadeFrames / rate;

  const shotFrames = Math.max(xfadeFrames + 1, Math.round(((target + (n - 1) * xfade) / n) * rate));
  const shotSec = shotFrames / rate;
  const totalSec = Number((n * shotSec - (n - 1) * xfade).toFixed(6));

  // Offsets are where each xfade STARTS on the accumulated timeline.
  const offsets = [];
  for (let k = 1; k < n; k++) offsets.push(Number((k * (shotSec - xfade)).toFixed(4)));

  return { shots: n, fps: rate, shotFrames, shotSec, crossfadeSec: xfade, totalSec, offsets, requestedSec: target };
}

/**
 * The zoompan expressions for shot `index`. Closed form in `on` — see the
 * header note on why the stateful `zoom` recipe is not used.
 */
function motionExpressions(index, { shotFrames, zoomTravel = HERO_COMPOSE_DEFAULTS.zoomTravel } = {}) {
  const m = MOTIONS[index % MOTIONS.length];
  const last = Math.max(1, shotFrames - 1);
  const top = (1 + zoomTravel).toFixed(4);
  const z = m.zoom === "in"
    ? `1+${zoomTravel}*on/${last}`
    : `${top}-${zoomTravel}*on/${last}`;
  // `zoom` inside x/y is the CURRENT frame's zoom, so these stay centred (or
  // travel edge to edge) whatever the push is doing.
  let x = "iw/2-(iw/zoom/2)";
  let y = "ih/2-(ih/zoom/2)";
  if (m.pan === "lr") x = `(iw-iw/zoom)*on/${last}`;
  if (m.pan === "rl") x = `(iw-iw/zoom)*(1-on/${last})`;
  if (m.pan === "tb") y = `(ih-ih/zoom)*on/${last}`;
  return { z, x, y, motion: `${m.zoom}/${m.pan}` };
}

/**
 * buildFilterGraph({ plan, width, height, hasLogo, opts }) -> string
 *
 * Pure. The whole graph, ready for -filter_complex, so a test can read it
 * without spending three seconds of encoder time.
 */
function buildFilterGraph({ plan, width, height, hasLogo = false, opts = {} } = {}) {
  const o = { ...HERO_COMPOSE_DEFAULTS, ...opts };
  const W = width;
  const H = height;
  const ss = Math.max(1, Math.round(o.supersample));
  const parts = [];

  for (let i = 0; i < plan.shots; i++) {
    const { z, x, y } = motionExpressions(i, { shotFrames: plan.shotFrames, zoomTravel: o.zoomTravel });
    parts.push(
      `[${i}:v]scale=${W * ss}:${H * ss}:force_original_aspect_ratio=increase`
      + `,crop=${W * ss}:${H * ss},setsar=1`
      + `,zoompan=z='${z}':x='${x}':y='${y}':d=${plan.shotFrames}:s=${W}x${H}:fps=${plan.fps}`
      + `,setsar=1,format=rgb24[v${i}]`,
    );
  }

  let cur = "v0";
  for (let k = 1; k < plan.shots; k++) {
    const label = `x${k}`;
    parts.push(`[${cur}][v${k}]xfade=transition=fade:duration=${plan.crossfadeSec}:offset=${plan.offsets[k - 1]}[${label}]`);
    cur = label;
  }

  // The scrim: one generated frame, held forever, composited along the bottom.
  const gradH = Math.max(2, Math.round(H * o.gradientHeightRatio));
  parts.push(
    `color=c=black:s=${W}x${gradH}:d=0.04:r=1,format=rgba`
    + `,geq=r=0:g=0:b=0:a='255*${o.gradientAlpha}*(Y/H)*(Y/H)'`
    + `,loop=loop=-1:size=1:start=0,setpts=N/${plan.fps}/TB[grad]`,
  );
  // `format=rgb` on the overlays is not cosmetic — see the range note below.
  // overlay's DEFAULT is format=yuv420, which silently converts the reel to
  // YUV in the middle of the graph with no range metadata attached.
  parts.push(`[${cur}][grad]overlay=x=0:y=H-h:format=rgb:shortest=1[base]`);
  cur = "base";

  if (hasLogo) {
    // Up shortly after the last shot begins, so the mark reads as a sign-off
    // rather than a stamp sitting over the whole reel.
    const logoIn = Math.max(0, plan.totalSec - plan.shotSec + 0.6);
    const logoW = Math.max(24, Math.round(W * o.logoWidthRatio));
    parts.push(
      `[${plan.shots}:v]scale=${logoW}:-2,format=rgba`
      + `,colorchannelmixer=aa=${o.logoOpacity}`
      + `,fade=t=in:st=${logoIn.toFixed(3)}:d=${o.logoFadeSec}:alpha=1[logo]`,
    );
    parts.push(`[${cur}][logo]overlay=x=W-w-${o.logoMargin}:y=H-h-${o.logoMargin}:format=rgb:shortest=1[marked]`);
    cur = "marked";
  }

  // The fade-out has to COMPLETE BEFORE the last rendered frame, not at the
  // clip's theoretical end — no frame occupies t=totalSec, so ending the fade
  // there leaves the final frames one step short of black and the loop seam
  // flashes. Finishing three frames early leaves a 0.1s hold on true black:
  // invisible in twelve seconds, and it makes the wrap seamless whichever
  // frame a browser happens to hold while it restarts.
  const fadeOut = Math.max(0, plan.totalSec - o.edgeFadeSec - o.blackHoldFrames / plan.fps);
  // ONE EXPLICIT RANGE CONVERSION, AT THE END — the bug real inputs found.
  //
  // Every client photograph is a JPEG, and a JPEG decodes FULL RANGE. Carry
  // that range to the encoder and libx264 writes a stream whose VUI says
  // "full", which ffprobe reports as pix_fmt `yuvj420p` — so the module's own
  // yuv420p check refused 100% of real builds while a PNG-only test passed.
  //
  // The half-fix (`scale=out_range=tv`) is worse than no fix, and measuring it
  // is the only way to know: swscale converts only when it knows the SOURCE
  // range, so a PNG reel — range "unknown" — came out full-range data wearing
  // no tag at all (measured YMIN 0, YMAX 231), which every player renders with
  // crushed blacks and clipped whites. So:
  //   · the graph stays RGB end to end (overlay's default format=yuv420 was
  //     quietly converting it mid-chain, which is where the range was lost),
  //   · `in_range=full` is DECLARED, because RGB is full range by definition
  //     and swscale will not guess it,
  //   · `setrange=limited` then tags what the conversion actually produced.
  // Relabelling without converting was never an option: that is the same
  // crushed picture with a more confident label on it.
  //
  // Measured after the fix: a faded-to-black frame reads Y≈16 (limited black)
  // instead of Y=0, from both JPEG and PNG sources. The VUI tag itself still
  // comes out `tv` from range-carrying sources and `unknown` from sources with
  // no range metadata; untagged yuv420p is limited by universal convention, so
  // that is correct either way. What must never appear is `pc`/`yuvj420p`.
  parts.push(
    `[${cur}]fade=t=in:st=0:d=${o.edgeFadeSec}`
    + `,fade=t=out:st=${fadeOut.toFixed(3)}:d=${o.edgeFadeSec}`
    + `,format=rgb24,scale=in_range=full:out_range=tv,format=yuv420p,setrange=limited[out]`,
  );

  return parts.join(";");
}

// ---------------------------------------------------------------------------
// PROCESS PLUMBING
// ---------------------------------------------------------------------------

function run(bin, args, { timeoutMs, maxBuffer }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(
        bin,
        args,
        { timeout: timeoutMs, maxBuffer, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) return resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") });
          const timedOut = error.killed === true || error.signal === "SIGTERM";
          const missing = error.code === "ENOENT";
          resolve({
            ok: false,
            timedOut,
            missing,
            code: error.code,
            message: String(error.message || error).slice(0, 400),
            stdout: String(stdout || ""),
            stderr: String(stderr || ""),
          });
        },
      );
    } catch (e) {
      return resolve({ ok: false, missing: true, message: String((e && e.message) || e).slice(0, 400) });
    }
    // execFile can also surface spawn failures on the child itself.
    if (child && typeof child.on === "function") child.on("error", () => {});
  });
}

/** The last few lines of ffmpeg's own complaint — the useful half of a failure. */
function tailError(stderr, limit = 240) {
  const lines = String(stderr || "").trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-3).join(" | ").slice(0, limit) || "ffmpeg_failed";
}

/**
 * probeVideo(file) -> { ok, codec, pixFmt, width, height, durationSec, frames }
 *
 * "QC PASS is never proof" — the encoder claiming success is not evidence that
 * a browser will play the bytes. ffprobe reads what was actually written.
 */
async function probeVideo(file, { timeoutMs = 30000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  const res = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,pix_fmt,width,height,nb_frames,duration",
    "-show_entries", "format=duration",
    "-of", "json",
    file,
  ], { timeoutMs, maxBuffer });
  if (!res.ok) {
    return { ok: false, reason: res.missing ? "ffprobe_missing" : "ffprobe_failed", detail: tailError(res.stderr || res.message) };
  }
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return { ok: false, reason: "ffprobe_unparsable" };
  }
  const stream = (parsed.streams || [])[0];
  if (!stream) return { ok: false, reason: "no_video_stream" };
  const durationSec = Number(
    (parsed.format && parsed.format.duration) || stream.duration || 0,
  );
  return {
    ok: true,
    codec: String(stream.codec_name || ""),
    pixFmt: String(stream.pix_fmt || ""),
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    frames: Number(stream.nb_frames) || 0,
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
  };
}

function statFile(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

function removeQuietly(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* a leftover we cannot remove is not worth failing over */ }
}

/**
 * Photo intake. Order is preserved (the caller's order is the reel's order —
 * they know which shot is the best one), duplicates are dropped (the same
 * photograph twice is not a multi-shot reel), and every survivor must be a
 * real, non-empty file on disk before ffmpeg is asked to spend a second.
 */
function resolvePhotos(photos, { maxPhotos }) {
  if (!Array.isArray(photos)) return { ok: false, reason: "photos_not_an_array" };
  const seen = new Set();
  const resolved = [];
  for (const entry of photos) {
    if (typeof entry !== "string" || !entry.trim()) return { ok: false, reason: "photo_path_not_a_string" };
    const abs = path.resolve(entry);
    const key = process.platform === "win32" ? abs.toLowerCase() : abs;
    if (seen.has(key)) continue;
    seen.add(key);
    const st = statFile(abs);
    if (!st) return { ok: false, reason: "photo_missing", detail: path.basename(abs) };
    if (st.size <= 0) return { ok: false, reason: "photo_empty", detail: path.basename(abs) };
    resolved.push(abs);
    if (resolved.length >= maxPhotos) break;
  }
  return { ok: true, photos: resolved, deduped: photos.length - resolved.length };
}

// ---------------------------------------------------------------------------
// THE ENTRY POINT
// ---------------------------------------------------------------------------

/**
 * composeHeroVideo({ photos, logoPath, outPath, durationSec, width, height })
 *
 * photos   — 2..6 paths to the client's OWN verified photographs. Provenance is
 *            the caller's guarantee (see the truth-law note at the top).
 * logoPath — optional path to the client's OWN mark. A logo that is named but
 *            missing is SKIPPED, not fatal: a reel of their work without a
 *            watermark is still their reel, and refusing the whole video over a
 *            corner graphic would drop the ladder a rung for nothing. The skip
 *            is reported, never silent.
 * outPath   — where the mp4 lands. Parent directories are created.
 *
 * Resolves to { ok:true, ... } or { ok:false, reason }. Never throws, never
 * rejects.
 */
async function composeHeroVideo({
  photos,
  logoPath = null,
  outPath,
  durationSec = HERO_COMPOSE_DEFAULTS.durationSec,
  width = HERO_COMPOSE_DEFAULTS.width,
  height = HERO_COMPOSE_DEFAULTS.height,
  fps = HERO_COMPOSE_DEFAULTS.fps,
  crossfadeSec = HERO_COMPOSE_DEFAULTS.crossfadeSec,
  crf = HERO_COMPOSE_DEFAULTS.crf,
  preset = HERO_COMPOSE_DEFAULTS.preset,
  maxBytes = HERO_COMPOSE_DEFAULTS.maxBytes,
  hardMaxBytes = HERO_COMPOSE_DEFAULTS.hardMaxBytes,
  minBytes = HERO_COMPOSE_DEFAULTS.minBytes,
  timeoutMs = HERO_COMPOSE_DEFAULTS.timeoutMs,
  maxBuffer = HERO_COMPOSE_DEFAULTS.maxBuffer,
  ...rest
} = {}) {
  const startedAt = Date.now();
  try {
    if (typeof outPath !== "string" || !outPath.trim()) return { ok: false, reason: "no_out_path" };

    const W = Math.max(16, Math.round(Number(width) || HERO_COMPOSE_DEFAULTS.width) & ~1);
    const H = Math.max(16, Math.round(Number(height) || HERO_COMPOSE_DEFAULTS.height) & ~1);

    const intake = resolvePhotos(photos, { maxPhotos: HERO_COMPOSE_DEFAULTS.maxPhotos });
    if (!intake.ok) return { ok: false, reason: intake.reason, ...(intake.detail ? { detail: intake.detail } : {}) };
    if (intake.photos.length < HERO_COMPOSE_DEFAULTS.minPhotos) {
      // The honest reason a build stays on the fallback rung: we did not have
      // enough of their work to make a reel out of.
      return { ok: false, reason: "need_at_least_two_photos", detail: `have:${intake.photos.length}` };
    }

    // The mark is optional and never fatal.
    let logoAbs = null;
    let logoSkipped = null;
    if (typeof logoPath === "string" && logoPath.trim()) {
      const abs = path.resolve(logoPath);
      const st = statFile(abs);
      if (st && st.size > 0) logoAbs = abs;
      else logoSkipped = st ? "logo_empty" : "logo_missing";
    }

    const out = path.resolve(outPath);
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
    } catch (e) {
      return { ok: false, reason: "out_dir_unwritable", detail: String((e && e.message) || e).slice(0, 160) };
    }
    // A stale file at outPath must never be mistaken for this run's output.
    removeQuietly(out);

    const plan = planReel({ photoCount: intake.photos.length, durationSec, fps, crossfadeSec });
    const opts = { ...HERO_COMPOSE_DEFAULTS, ...rest };
    const graph = buildFilterGraph({ plan, width: W, height: H, hasLogo: Boolean(logoAbs), opts });

    const args = ["-y", "-v", "error", "-nostdin"];
    for (const p of intake.photos) args.push("-i", p);
    if (logoAbs) args.push("-loop", "1", "-framerate", String(plan.fps), "-t", String(plan.totalSec), "-i", logoAbs);
    args.push(
      "-filter_complex", graph,
      "-map", "[out]",
      "-an",
      "-c:v", "libx264",
      "-profile:v", "high",
      "-preset", String(preset),
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      // Belt and braces with the graph's out_range=tv: the tag on the stream
      // and the levels in the pixels must agree, whichever one a later edit
      // touches. See the note on the final filter chain.
      "-color_range", "tv",
      "-r", String(plan.fps),
      "-movflags", "+faststart",
      "-t", String(plan.totalSec),
      out,
    );

    const encodeStartedAt = Date.now();
    const enc = await run("ffmpeg", args, { timeoutMs, maxBuffer });
    const encodeMs = Date.now() - encodeStartedAt;
    if (!enc.ok) {
      removeQuietly(out);
      const reason = enc.missing ? "ffmpeg_missing" : enc.timedOut ? "ffmpeg_timeout" : "ffmpeg_failed";
      return { ok: false, reason, detail: tailError(enc.stderr || enc.message), encodeMs };
    }

    let st = statFile(out);
    if (!st) {
      return { ok: false, reason: "no_output_file", encodeMs };
    }
    if (st.size < minBytes) {
      // An mp4 this small at 720p is a container with nothing in it — the
      // classic shape of a graph that ran but produced one frame.
      removeQuietly(out);
      return { ok: false, reason: "output_too_small", detail: `${st.size}B`, encodeMs };
    }

    // THE SIZE BUDGET. Over target, re-encode FROM THE MP4 rather than
    // rebuilding the reel: the second pass is a plain transcode and costs a
    // fraction of the zoompan work. Past the hard ceiling the ladder should
    // step down instead — a hero that stalls on a phone is worse than a still.
    const shrinkPasses = [];
    let finalCrf = Number(crf);
    for (const step of HERO_COMPOSE_DEFAULTS.shrinkCrfSteps) {
      if (st.size <= maxBytes) break;
      const nextCrf = Math.min(40, Number(crf) + step);
      if (nextCrf === finalCrf) continue;
      const tmp = `${out}.shrink${step}.mp4`;
      const pass = await run("ffmpeg", [
        "-y", "-v", "error", "-nostdin", "-i", out,
        "-an", "-c:v", "libx264", "-profile:v", "high", "-preset", String(preset),
        "-crf", String(nextCrf), "-pix_fmt", "yuv420p", "-color_range", "tv",
        "-movflags", "+faststart", tmp,
      ], { timeoutMs, maxBuffer });
      const tmpStat = pass.ok ? statFile(tmp) : null;
      if (!tmpStat || tmpStat.size < minBytes || tmpStat.size >= st.size) {
        removeQuietly(tmp);
        shrinkPasses.push({ crf: nextCrf, ok: false });
        continue;
      }
      try {
        fs.rmSync(out, { force: true });
        fs.renameSync(tmp, out);
      } catch {
        removeQuietly(tmp);
        shrinkPasses.push({ crf: nextCrf, ok: false });
        continue;
      }
      finalCrf = nextCrf;
      st = statFile(out) || st;
      shrinkPasses.push({ crf: nextCrf, ok: true, bytes: st.size });
    }

    if (st.size > hardMaxBytes) {
      removeQuietly(out);
      return { ok: false, reason: "over_size_budget", detail: `${st.size}B`, encodeMs, shrinkPasses };
    }

    // RENDER THE BYTES, DO NOT TRUST THE EXIT CODE.
    const probe = await probeVideo(out, { timeoutMs: Math.min(timeoutMs, 30000), maxBuffer });
    if (!probe.ok) {
      removeQuietly(out);
      return { ok: false, reason: probe.reason, ...(probe.detail ? { detail: probe.detail } : {}), encodeMs };
    }
    if (probe.codec !== "h264") {
      removeQuietly(out);
      return { ok: false, reason: "not_h264", detail: probe.codec, encodeMs };
    }
    if (probe.pixFmt !== "yuv420p") {
      // Anything else is the "plays in VLC, black in Safari" failure.
      removeQuietly(out);
      return { ok: false, reason: "not_yuv420p", detail: probe.pixFmt, encodeMs };
    }
    if (probe.width !== W || probe.height !== H) {
      removeQuietly(out);
      return { ok: false, reason: "dimensions_drifted", detail: `${probe.width}x${probe.height}`, encodeMs };
    }
    const drift = Math.abs(probe.durationSec - plan.requestedSec) / plan.requestedSec;
    if (!(drift <= HERO_COMPOSE_DEFAULTS.durationTolerance)) {
      removeQuietly(out);
      return { ok: false, reason: "duration_out_of_tolerance", detail: `${probe.durationSec.toFixed(3)}s`, encodeMs };
    }

    return {
      ok: true,
      path: out,
      bytes: st.size,
      durationSec: probe.durationSec,
      requestedSec: plan.requestedSec,
      width: probe.width,
      height: probe.height,
      fps: plan.fps,
      frames: probe.frames,
      codec: probe.codec,
      pixFmt: probe.pixFmt,
      photosUsed: intake.photos.length,
      photosDeduped: intake.deduped,
      shotSec: plan.shotSec,
      crossfadeSec: plan.crossfadeSec,
      logo: Boolean(logoAbs),
      ...(logoSkipped ? { logoSkipped } : {}),
      crf: finalCrf,
      overBudget: st.size > maxBytes,
      shrinkPasses,
      encodeMs,
      totalMs: Date.now() - startedAt,
    };
  } catch (e) {
    // The contract is "never throws". Anything that got past the guards above
    // still leaves the caller on the next rung of the ladder.
    return { ok: false, reason: "unexpected_error", detail: String((e && e.message) || e).slice(0, 200) };
  }
}

module.exports = {
  HERO_COMPOSE_DEFAULTS,
  MOTIONS,
  composeHeroVideo,
  planReel,
  motionExpressions,
  buildFilterGraph,
  probeVideo,
};
