"use strict";

// lib/line-motion-shot.js — the site that MOVES.
//
// The email's right-hand thumbnail should not be another still. It should be a
// short LIVE-VIDEO LOOP of the prospect's NEW mirror — their hero playing, in
// place, the way it plays when a customer lands on the page — sitting next to
// the static shot of their current site. The contrast IS the pitch: "my site
// has video."
//
// ---------------------------------------------------------------------------
// WHY THE FIRST VERSION LOOKED LIKE "a gif clipping looking crap"
// ---------------------------------------------------------------------------
// v1 shipped 10 frames at 120 centiseconds each and PANNED the camera with
// window.scrollTo between every one of them. Three separate mistakes compound
// into the artefact the owner rejected:
//
//   · 0.83 frames per second is not motion. Below roughly 10fps the eye stops
//     integrating and starts counting — it reads as a slideshow of stills,
//     which is exactly what it was.
//   · A 350ms "settle" before each screenshot made every frame a POSED shot.
//     The interval between frames was a pause for the page to stop moving,
//     which is the opposite of recording something that moves.
//   · The pan guaranteed no two frames shared a single pixel, so the encoder
//     had to store all ten in FULL. That full-frame cost is what forced the
//     frame count down to ten in the first place. The pan caused the slideshow.
//
// The fix is one idea applied three times: LOCK THE CAMERA.
//
//   · Camera locked at scrollY=0, clipped to the measured bottom of the hero,
//     so the frame is the hero and nothing but the hero. Measured across six
//     live mirrors: the plumbing lane's hero card ends at y=724 whatever the
//     viewport height, so a blanket 800px window shipped 35px of the NEXT
//     section along the bottom edge. The clip is derived from the page, not
//     assumed.
//   · Frames are SEEK-DRIVEN: the hero <video> is paused and its currentTime
//     is set to i/12s per frame. page.screenshot costs 165–250ms measured, so
//     a free-running capture caps out near 5fps AND couples the cadence to
//     however fast the machine happens to be. Seeking makes the frame interval
//     a real, exact 1/12s of the subject's own time — the "settle" is now only
//     a repaint wait, not the thing that defines the spacing.
//   · Because the camera no longer moves, consecutive frames are ~80% identical
//     and the encoder can store only what CHANGED (see below). 18 frames of
//     real motion now cost less than 10 posed stills used to.
//
// Loop length is 1.5s at 12fps. The hero clips do not loop — measured, the
// distance from t=0 never returns, and a straight wrap is a 7.5x jump against
// a typical inter-frame step, which the eye reads as a stutter. The last four
// frames are crossfaded back toward frame 0, which costs no extra frames and
// makes the wrap SMALLER than a normal step (0.63x measured, spike gone when
// the bytes are handed to a real browser and its own frame deltas are sampled).
//
// ---------------------------------------------------------------------------
// Mechanics, and why each choice is what it is:
// ---------------------------------------------------------------------------
//   · Frames come from the same Chromium the render gates use
//     (lib/serverless-chromium), at a 1280x800 desktop viewport with
//     deviceScaleFactor = 560/1280, so every screenshot arrives already 560px
//     wide. Measured three ways — direct rasterisation at the target scale is
//     CRISPER (acutance 16.5) than capturing at 1280 and box-filtering down
//     (13.8), because Chromium rasterises glyphs at the target resolution and
//     downscaling already-antialiased type double-blurs it. So the box filter
//     is not in the normal path; it exists only as a budget rung.
//   · Our own CSS animations are pinned before the first frame: finite ones
//     finished, infinite ones paused at 0. The plumbing lane's h1 runs a 1.2s
//     blur-in; captured mid-flight the headline is a smear. Measured, CSS
//     contributes under 10% of the frame delta anyway — pinning it removes an
//     unsynchronisable motion source for almost nothing.
//   · The mirror is loaded with ?wssthumb=1, the same suppression flag the
//     stills use, so our own sign-up floater never sits over the picture.
//     Verified absent at frame 0 on every mirror in the framing study.
//   · The GIF is written here, byte by byte (GIF89a, LZW, median-cut palette,
//     ordered/Floyd–Steinberg dithering). node_modules has no GIF encoder and
//     the format is small enough that vendoring one for this would be the
//     bigger risk.
//   · Screenshot PNGs are decoded here too (node:zlib inflate + the five
//     standard filters) for the same reason: no PNG decoder in node_modules.
//   · The object lives in the SAME proof bucket, at the SAME content-addressed
//     key derivation as the stills — proofObjectPath({url, variant:"gif"}) —
//     with the extension the bytes actually deserve (.gif, not .jpg).
//   · Like the "new" stills, OUR mirror is re-captured EVERY run — the key is
//     derived from the URL, which does not change when the site is rebuilt, so
//     trusting a stored copy is how the recoloured-mirror-with-stale-thumbnail
//     bug happened. The sha256 of the encoded bytes travels back to the caller
//     so the email can mint a cache-busting URL Gmail's proxy has never seen.
//   · Size is a budget, not a hope: target ≤ 900KB. The ladder was REORDERED
//     when diffing landed, because diffing changed what is cheap: dithering
//     used to cost +26% and now costs +49% (Floyd–Steinberg diffuses error
//     along the scanline, so a change anywhere re-rolls indices downstream in
//     STATIC content and the diff collapses), while a downscale rung — which
//     v1 did not have at all, leaving output locked at capture size — is now
//     the cheapest large saving available. Nothing fits ⇒ it FAILS CLOSED
//     rather than shipping a megabyte into someone's data plan.
//
// ---------------------------------------------------------------------------
// WHY THE PAN IS STILL HERE
// ---------------------------------------------------------------------------
// One of the six mirrors measured has no hero <video> at all — a static <img>
// — and its inter-frame delta is 0.012 against 2.7–3.3 for the live ones. A
// locked camera on a dead hero is a GIF that does not move, which is WORSE
// than the slideshow: it looks broken rather than slow. Faking motion with a
// ken-burns push was measured too and does not survive the budget (resampling
// changes 41–51% of indices every frame, so diffing buys nothing and the file
// lands 3.7–4x over). So the honest answer is: measure the motion at capture
// time, and if the hero is dead, fall back to the old pan. The pan lane below
// is intact and unchanged in spirit for exactly that case.

const { createHash } = require("node:crypto");
const zlib = require("node:zlib");
const {
  proofObjectPath,
  proofMetaPath,
  publicProofUrl,
  uploadProofShot,
  fetchProofShot,
  registrableDomain,
  suppressOurPanelsUrl,
} = require("./proof-storage");
const { launchChromium } = require("./serverless-chromium");

// ---------------------------------------------------------------------------
// Defaults.
//
// HERO LANE: delayCs 8 = 12fps; 18 frames = a 1.50s loop. Both measured, both
// load-bearing — 12fps is the slowest rate that still integrates as motion at
// this size, and 1.5s is the longest loop whose crossfaded wrap stays under a
// normal step while the bytes stay inside budget with headroom.
//
// PAN LANE (fallback only): the v1 numbers, deliberately unchanged, because a
// slow deliberate glide is what a still hero should get.
// ---------------------------------------------------------------------------
const MOTION_DEFAULTS = Object.freeze({
  // hero-locked live loop
  frameCount: 18,
  delayCs: 8,
  crossfadeFrames: 4,
  viewport: Object.freeze({ width: 1280, height: 800 }),
  targetWidth: 560,
  heroMinHeight: 480, // never crop tighter than this, whatever the DOM claims
  heroMaxHeight: 800, // never taller than the viewport we captured
  repaintMs: 45, // a REPAINT wait, not a frame interval — seek defines spacing
  // Below this mean per-frame luma delta the "video" is a picture. Measured:
  // dead hero 0.012, live heroes 1.49 at this size and rate. 0.30 sits an
  // order of magnitude clear of both.
  minMeanDelta: 0.3,

  // pan fallback
  panFrameCount: 10,
  panDelayCs: 120,
  scrollViewports: 2.5, // FALLBACK span when the page has no findable trust rail
  settleMs: 350, // lazy content settling between pan stops

  maxBytes: 900 * 1024,
});

// The budget ladders. Each rung trades something a viewer is least likely to
// notice, in measured order of cost. Frames go LAST — dropping them changes
// the motion itself, which is the whole product.
const HERO_LADDER = Object.freeze([
  { width: 560, maxColors: 255, dither: "ordered", tol: 0 },
  { width: 560, maxColors: 255, dither: "ordered", tol: 90 },
  { width: 560, maxColors: 160, dither: "ordered", tol: 90 },
  { width: 480, maxColors: 160, dither: "ordered", tol: 90 },
  { width: 400, maxColors: 128, dither: "ordered", tol: 120 },
  { width: 400, maxColors: 96, dither: "none", tol: 120 },
  { width: 400, maxColors: 96, dither: "none", tol: 120, frameStride: 2 },
].map(Object.freeze));

// The pan shares no pixels frame to frame (measured saving from diffing on a
// pan: 1.00x), so its rungs are the full-frame ones — plus the downscale rung
// v1 never had.
const PAN_LADDER = Object.freeze([
  { width: 560, maxColors: 256, dither: "floyd" },
  { width: 560, maxColors: 256, dither: "none" },
  { width: 480, maxColors: 128, dither: "none" },
  { width: 400, maxColors: 128, dither: "none" },
  { width: 400, maxColors: 64, dither: "none" },
  { width: 400, maxColors: 64, dither: "none", frameStride: 2 },
].map(Object.freeze));

/**
 * How far the pan travels. The brief is "hero THROUGH the trust rail", and the
 * rail is not at a fixed depth — on the Poor John mirror it sits at y≈10,258
 * of 14,708, nowhere near the first few screens. So when the capture found the
 * rail, the final frame is anchored to it (rail in the upper third of the
 * viewport); only when no rail exists does the span fall back to a fixed
 * couple-of-screens glide. Pure so it can be tested without a browser.
 */
function motionScrollSpan({
  scrollHeight = 0,
  innerHeight = 0,
  railTop = null,
  scrollViewports = MOTION_DEFAULTS.scrollViewports,
} = {}) {
  const maxScroll = Math.max(0, scrollHeight - innerHeight);
  // A "rail" inside the first screen is just the hero; panning to it is no pan.
  const railUsable = Number.isFinite(railTop) && railTop > innerHeight;
  const wanted = railUsable
    ? Math.round(railTop - innerHeight * 0.35)
    : Math.round(innerHeight * scrollViewports);
  return Math.max(0, Math.min(maxScroll, wanted));
}

/**
 * The hero's clip height, in CSS px, and the output height it rasterises to.
 *
 * Two things are happening. First the DOM's claimed hero bottom is clamped
 * into [heroMinHeight, viewport height] — a hero that measures 813 on an
 * 800-tall window is a viewport-height hero that overshot by a border, and a
 * hero that measures 120 is a mis-detection, not a hero. Second the clip is
 * SNAPPED so that clipHeight * scale is a whole number: an unsnapped clip
 * makes Chromium round the raster height, and a one-pixel drift between the
 * first frame and the rest throws "frame_dimensions_drifted" mid-capture.
 *
 * Pure — the geometry is testable without a browser.
 */
function heroClipHeight({
  heroBottomCssPx = 0,
  viewportWidth = MOTION_DEFAULTS.viewport.width,
  viewportHeight = MOTION_DEFAULTS.viewport.height,
  targetWidth = MOTION_DEFAULTS.targetWidth,
  minHeight = MOTION_DEFAULTS.heroMinHeight,
  maxHeight = MOTION_DEFAULTS.heroMaxHeight,
} = {}) {
  const scale = targetWidth / viewportWidth;
  const ceiling = Math.min(viewportHeight, maxHeight);
  const clamped = Math.max(
    Math.min(minHeight, ceiling),
    Math.min(ceiling, Math.round(heroBottomCssPx || 0)),
  );
  const snapped = Math.max(1, Math.round(Math.floor(clamped * scale) / scale));
  return {
    scale,
    clipHeightCssPx: snapped,
    outWidth: Math.round(viewportWidth * scale),
    outHeight: Math.max(1, Math.round(snapped * scale)),
  };
}

// ---------------------------------------------------------------------------
// Object keys. Same derivation as every other proof shot — sha256(url|variant)
// via proofObjectPath — so writer and reader never have to talk. The stills'
// path helper hard-codes .jpg (it predates this variant); the GIF swaps the
// extension so the object's name tells the truth about its bytes.
// ---------------------------------------------------------------------------
function gifObjectPath({ url } = {}) {
  return proofObjectPath({ url, variant: "gif" });
}

function gifMetaPath({ url } = {}) {
  return proofMetaPath({ url, variant: "gif" });
}

/**
 * The motion shot is a picture of OUR mirror, so the sign-up floater is
 * suppressed exactly the way the "new" stills do it. The object key is derived
 * from the CLEAN url; the flag exists only on the navigation, and is written by
 * the single owner in proof-storage rather than a third private copy of it.
 */
function motionShotUrl(url) {
  return suppressOurPanelsUrl(url);
}

// ===========================================================================
// PNG DECODE — Playwright screenshots to raw RGBA.
// Supports what Chromium actually emits (8-bit, RGB/RGBA, non-interlaced) and
// refuses everything else loudly instead of producing garbage pixels.
// ===========================================================================
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("png_bad_signature");
  }
  let pos = 8;
  let ihdr = null;
  const idats = [];
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length; // length + type + data + crc
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!ihdr) throw new Error("png_missing_ihdr");
  if (ihdr.bitDepth !== 8) throw new Error(`png_unsupported_depth_${ihdr.bitDepth}`);
  if (ihdr.colorType !== 2 && ihdr.colorType !== 6) throw new Error(`png_unsupported_colortype_${ihdr.colorType}`);
  if (ihdr.interlace !== 0) throw new Error("png_interlaced_unsupported");
  if (!idats.length) throw new Error("png_missing_idat");

  const bpp = ihdr.colorType === 6 ? 4 : 3;
  const stride = ihdr.width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idats));
  if (raw.length < (stride + 1) * ihdr.height) throw new Error("png_truncated_data");

  const rgba = Buffer.alloc(ihdr.width * ihdr.height * 4);
  let prevRow = Buffer.alloc(stride); // row above the first row is defined as zeroes
  let off = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[off++];
    const row = raw.subarray(off, off + stride); // mutated in place: reconstruction needs its own left-bytes
    off += stride;
    switch (filter) {
      case 0:
        break;
      case 1:
        for (let x = bpp; x < stride; x++) row[x] = (row[x] + row[x - bpp]) & 255;
        break;
      case 2:
        for (let x = 0; x < stride; x++) row[x] = (row[x] + prevRow[x]) & 255;
        break;
      case 3:
        for (let x = 0; x < stride; x++) {
          const left = x >= bpp ? row[x - bpp] : 0;
          row[x] = (row[x] + ((left + prevRow[x]) >> 1)) & 255;
        }
        break;
      case 4:
        for (let x = 0; x < stride; x++) {
          const left = x >= bpp ? row[x - bpp] : 0;
          const upLeft = x >= bpp ? prevRow[x - bpp] : 0;
          row[x] = (row[x] + paeth(left, prevRow[x], upLeft)) & 255;
        }
        break;
      default:
        throw new Error(`png_unknown_filter_${filter}`);
    }
    let out = y * ihdr.width * 4;
    for (let x = 0; x < stride; x += bpp) {
      rgba[out++] = row[x];
      rgba[out++] = row[x + 1];
      rgba[out++] = row[x + 2];
      rgba[out++] = bpp === 4 ? row[x + 3] : 255;
    }
    prevRow = row;
  }
  return { width: ihdr.width, height: ihdr.height, rgba };
}

// ===========================================================================
// PIXEL MATH — downscale, crossfade, and the motion measurement the fallback
// decision hangs on. All pure, all testable without a browser.
// ===========================================================================

/**
 * Exact-area (box filter) downscale of an RGBA buffer, in plain JS.
 *
 * Deliberately NOT in the normal path: capturing directly at the target scale
 * is measurably sharper. This exists so the budget ladder has somewhere to go
 * that is not "throw away frames" — v1's ladder had no size rung at all, which
 * is why its output stayed locked at the capture dimensions.
 */
function boxDownscaleRGBA(src, sw, sh, dw, dh) {
  if (dw === sw && dh === sh) return src;
  if (dw > sw || dh > sh) throw new Error("downscale_only");
  const dst = Buffer.alloc(dw * dh * 4);
  const xr = sw / dw;
  const yr = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0f = dy * yr;
    const y1f = y0f + yr;
    const y0 = Math.floor(y0f);
    const y1 = Math.min(sh, Math.ceil(y1f));
    for (let dx = 0; dx < dw; dx++) {
      const x0f = dx * xr;
      const x1f = x0f + xr;
      const x0 = Math.floor(x0f);
      const x1 = Math.min(sw, Math.ceil(x1f));
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = y0; sy < y1; sy++) {
        const wy = Math.min(sy + 1, y1f) - Math.max(sy, y0f);
        if (wy <= 0) continue;
        for (let sx = x0; sx < x1; sx++) {
          const wx = Math.min(sx + 1, x1f) - Math.max(sx, x0f);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const i = (sy * sw + sx) * 4;
          r += src[i] * wgt; g += src[i + 1] * wgt; b += src[i + 2] * wgt; a += src[i + 3] * wgt;
          wsum += wgt;
        }
      }
      const o = (dy * dw + dx) * 4;
      dst[o] = Math.round(r / wsum);
      dst[o + 1] = Math.round(g / wsum);
      dst[o + 2] = Math.round(b / wsum);
      dst[o + 3] = Math.round(a / wsum);
    }
  }
  return dst;
}

/**
 * Crossfade the last K frames toward frame 0 so the loop wraps instead of
 * cutting. Costs no extra frames — the tail is re-blended in place. Weight
 * ramps 1/(K+1) .. K/(K+1) so the final frame is close to, but never equal to,
 * frame 0 (an exactly-equal final frame is a wasted frame of screen time).
 */
function crossfadeTail(frames, k) {
  const K = Math.max(0, Math.min(Math.floor(k) || 0, Math.max(0, frames.length - 2)));
  if (!K) return frames.slice();
  const first = frames[0];
  return frames.map((f, i) => {
    const back = frames.length - 1 - i;
    if (back >= K) return f;
    const w = (K - back) / (K + 1);
    const out = Buffer.alloc(f.length);
    for (let p = 0; p < f.length; p++) out[p] = Math.round(f[p] * (1 - w) + first[p] * w);
    return out;
  });
}

/** Mean absolute Rec.601 luma delta between two RGBA frames, 0..255. */
function frameLumaDelta(a, b) {
  let sum = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    sum += Math.abs(la - lb);
  }
  return n ? sum / n : 0;
}

/**
 * Is this sequence actually moving? Returns the consecutive-step statistics the
 * fallback decision reads. mean is the headline number; max matters because a
 * hero that is dead for 17 frames and flickers once is still dead.
 */
function sequenceMotion(frames) {
  if (!Array.isArray(frames) || frames.length < 2) {
    return { steps: 0, meanDelta: 0, maxDelta: 0, minDelta: 0 };
  }
  const deltas = [];
  for (let i = 1; i < frames.length; i++) deltas.push(frameLumaDelta(frames[i - 1], frames[i]));
  const sum = deltas.reduce((s, d) => s + d, 0);
  return {
    steps: deltas.length,
    meanDelta: sum / deltas.length,
    maxDelta: Math.max(...deltas),
    minDelta: Math.min(...deltas),
  };
}

// ===========================================================================
// PALETTE — median cut over samples drawn from ALL frames, so one global
// colour table serves the whole animation (a per-frame table would let colours
// pulse frame to frame, which reads as glitch, not motion — and with frame
// differencing a per-frame table is not merely ugly but WRONG: index N has to
// mean the same RGB on every frame or a transparent hole exposes the wrong
// colour underneath).
// ===========================================================================
function buildPalette(frames, maxColors) {
  const totalPixels = frames.reduce((n, f) => n + f.length / 4, 0);
  const stride = Math.max(1, Math.floor(totalPixels / 120000));
  const samples = [];
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      if (k++ % stride !== 0) continue;
      const a = f[i + 3];
      // Composite over white: the email background family is light, and the
      // screenshots are opaque anyway — this is a guard, not a feature.
      const r = a === 255 ? f[i] : Math.round((f[i] * a + 255 * (255 - a)) / 255);
      const g = a === 255 ? f[i + 1] : Math.round((f[i + 1] * a + 255 * (255 - a)) / 255);
      const b = a === 255 ? f[i + 2] : Math.round((f[i + 2] * a + 255 * (255 - a)) / 255);
      samples.push((r << 16) | (g << 8) | b);
    }
  }
  if (!samples.length) throw new Error("palette_no_samples");

  const widestChannel = (box) => {
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (const c of box) {
      const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (g < minG) minG = g; if (g > maxG) maxG = g;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
    }
    const spans = [maxR - minR, maxG - minG, maxB - minB];
    let ch = 0;
    if (spans[1] >= spans[0] && spans[1] >= spans[2]) ch = 1;
    else if (spans[2] > spans[0] && spans[2] > spans[1]) ch = 2;
    return { ch, span: spans[ch] };
  };

  let boxes = [samples];
  while (boxes.length < maxColors) {
    let best = -1;
    let bestCount = 0;
    let bestCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const { ch, span } = widestChannel(boxes[i]);
      if (span < 1) continue;
      if (boxes[i].length > bestCount) {
        bestCount = boxes[i].length;
        best = i;
        bestCh = ch;
      }
    }
    if (best < 0) break; // every box is a single colour; nothing left to split
    const shift = bestCh === 0 ? 16 : bestCh === 1 ? 8 : 0;
    const box = boxes[best].slice().sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const c of box) {
      r += (c >> 16) & 255;
      g += (c >> 8) & 255;
      b += c & 255;
    }
    const n = box.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function makeNearest(palette) {
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = r - palette[i][0];
      const dg = g - palette[i][1];
      const db = b - palette[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    cache.set(key, best);
    return best;
  };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// The classic 8x8 ordered-dither threshold matrix.
const BAYER8 = Object.freeze([
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
].map(Object.freeze));

const ORDERED_STRENGTH = 16;

/**
 * RGBA frame -> palette indices.
 *
 * `dither` is "none"/false, "ordered", or "floyd"/true (true keeps the old
 * caller contract). ORDERED IS NOT A COSMETIC PREFERENCE: Floyd–Steinberg
 * diffuses quantisation error rightward and downward, so a change in one
 * corner re-rolls the indices of pixels that did not change at all, and frame
 * differencing collapses — measured, FS costs +26% on a full-frame encode but
 * +49% on a differenced one. Bayer is a pure function of (x, y, colour), so
 * identical pixels always quantise to identical indices.
 */
function indexFrame(rgba, width, height, palette, dither, nearest) {
  const mode = dither === true ? "floyd" : dither === false || !dither ? "none" : String(dither);
  const out = Buffer.alloc(width * height);

  if (mode === "none") {
    for (let p = 0, i = 0; p < out.length; p++, i += 4) {
      out[p] = nearest(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
    return out;
  }

  if (mode === "ordered") {
    for (let y = 0; y < height; y++) {
      const brow = BAYER8[y & 7];
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const bias = (brow[x & 7] / 64 - 0.5) * ORDERED_STRENGTH;
        out[y * width + x] = nearest(
          clamp255(Math.round(rgba[i] + bias)),
          clamp255(Math.round(rgba[i + 1] + bias)),
          clamp255(Math.round(rgba[i + 2] + bias)),
        );
      }
    }
    return out;
  }

  // Floyd–Steinberg. Two rolling error rows, offset by 1 so x±1 never needs a
  // bounds check.
  let cur = new Float32Array((width + 2) * 3);
  let next = new Float32Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const e = (x + 1) * 3;
      const r = clamp255(Math.round(rgba[i] + cur[e]));
      const g = clamp255(Math.round(rgba[i + 1] + cur[e + 1]));
      const b = clamp255(Math.round(rgba[i + 2] + cur[e + 2]));
      const idx = nearest(r, g, b);
      out[y * width + x] = idx;
      const er = r - palette[idx][0];
      const eg = g - palette[idx][1];
      const eb = b - palette[idx][2];
      cur[e + 3] += er * (7 / 16); cur[e + 4] += eg * (7 / 16); cur[e + 5] += eb * (7 / 16);
      next[e - 3] += er * (3 / 16); next[e - 2] += eg * (3 / 16); next[e - 1] += eb * (3 / 16);
      next[e] += er * (5 / 16); next[e + 1] += eg * (5 / 16); next[e + 2] += eb * (5 / 16);
      next[e + 3] += er * (1 / 16); next[e + 4] += eg * (1 / 16); next[e + 5] += eb * (1 / 16);
    }
    const swap = cur;
    cur = next;
    next = swap;
    next.fill(0);
  }
  return out;
}

// ===========================================================================
// LZW — the GIF flavour: variable code width starting at minCodeSize+1,
// dictionary reset via CLEAR at 4096 entries. The code-size growth rule
// (widen BEFORE assigning the first code that would not fit) is the one every
// mainstream decoder expects; get it wrong and the image tears diagonally.
// ===========================================================================
function lzwEncode(indices, minCodeSize) {
  const bytes = [];
  let acc = 0;
  let accBits = 0;
  const emit = (code, size) => {
    acc |= code << accBits;
    accBits += size;
    while (accBits >= 8) {
      bytes.push(acc & 255);
      acc >>>= 8;
      accBits -= 8;
    }
  };

  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = EOI + 1;
  let table = new Map();

  emit(CLEAR, codeSize);
  let chain = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (chain << 8) | k;
    const found = table.get(key);
    if (found !== undefined) {
      chain = found;
      continue;
    }
    emit(chain, codeSize);
    if (nextCode === 4096) {
      emit(CLEAR, codeSize);
      table = new Map();
      codeSize = minCodeSize + 1;
      nextCode = EOI + 1;
    } else {
      if (nextCode >= 1 << codeSize) codeSize++;
      table.set(key, nextCode++);
    }
    chain = k;
  }
  emit(chain, codeSize);
  emit(EOI, codeSize);
  if (accBits > 0) bytes.push(acc & 255);

  // Sub-block the stream: [minCodeSize] then runs of ≤255 bytes, then 0x00.
  const parts = [Buffer.from([minCodeSize])];
  for (let i = 0; i < bytes.length; i += 255) {
    const run = bytes.slice(i, i + 255);
    parts.push(Buffer.from([run.length]), Buffer.from(run));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

// ===========================================================================
// GIF89a WRITER
// ===========================================================================
/**
 * encodeGif({ frames, width, height, delayCs, loop, maxColors, dither,
 *             diff, tol })
 * frames: RGBA buffers, all width*height*4. loop: 0 = forever.
 *
 * diff:false writes every frame in full — the v1 behaviour, and the right one
 * for the pan lane where consecutive frames share no pixels.
 *
 * diff:true is the locked-camera encoder, and it is what buys the frame rate:
 *
 *   · ONE palette slot is spent on transparency. There is no trick around
 *     this — a 256-colour table has no spare index — so median cut is asked
 *     for one colour fewer and the first index it can never emit becomes the
 *     transparent one. Designating an EXISTING colour as transparent would
 *     punch permanent holes wherever that colour legitimately appears.
 *   · Each frame after the first is compared against the COMPOSITED CANVAS —
 *     what a decoder actually has on screen — not against the previous source
 *     frame. Canvas-relative is what bounds the error when `tol` is in play: a
 *     pixel drifting slowly is redrawn the moment it leaves the dead band,
 *     whereas frame-relative comparison lets drift accumulate forever and the
 *     image rots.
 *   · Only the bounding box of changed pixels is written, and unchanged pixels
 *     inside it become transparent. Disposal stays 1 (leave in place) — with
 *     disposal 2 the canvas is cleared between frames and every transparent
 *     hole becomes a background-coloured hole, so the sequence dissolves.
 *   · Measured on real locked-camera frames: transparency is the win (1.37x to
 *     2.49x), the bounding box adds only 3–11% on a hero that fills the frame.
 *     Both are implemented; expect the bytes to come from transparency.
 *
 * tol is an OPTIONAL dead band in squared palette distance. Real video is
 * noisy — 54.6% of pixels differ frame to frame at all, but only 5.6% differ
 * by more than 16 RGB — so exact diffing redraws a quarter of the frame for
 * invisible codec noise. tol=90 bounds the worst per-pixel deviation near
 * 9.5/255 and is a deliberate, named, lossy choice, never silently on.
 */
function encodeGif({
  frames,
  width,
  height,
  delayCs = MOTION_DEFAULTS.delayCs,
  loop = 0,
  maxColors = 256,
  dither = true,
  diff = false,
  tol = 0,
} = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new Error("gif_no_frames");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("gif_bad_dimensions");
  }
  for (const f of frames) {
    if (!f || f.length !== width * height * 4) throw new Error("gif_frame_size_mismatch");
  }
  // Floor at 3 when diffing: 2 colours minus the transparent slot leaves ONE
  // colour and a hole, which is a solid plate, not a picture.
  const colors = Math.max(diff ? 3 : 2, Math.min(256, maxColors | 0));

  const palette = buildPalette(frames, diff ? colors - 1 : colors);
  const transparentIndex = diff ? palette.length : -1;
  // Derive the table size from the number of ENTRIES the file needs, not from
  // the palette. If median cut happens to return exactly a power of two while
  // diffing, sizing off palette.length leaves no free index and the file is
  // corrupt — 128 colours would give a 128-entry table with 0..127 all used.
  const entries = palette.length + (diff ? 1 : 0);
  const gctBits = Math.max(1, Math.ceil(Math.log2(Math.max(2, entries))));
  const gctSize = 1 << gctBits;
  const minCodeSize = Math.max(2, gctBits);
  if (diff && transparentIndex >= (1 << minCodeSize)) {
    throw new Error("gif_transparent_index_unrepresentable");
  }
  const nearest = makeNearest(palette);

  const parts = [];
  parts.push(Buffer.from("GIF89a", "ascii"));

  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0x80 | 0x70 | (gctBits - 1); // GCT present, 8-bit colour resolution
  parts.push(lsd);

  // The transparent slot's RGB stays 00 00 00; it is never rendered.
  const gct = Buffer.alloc(gctSize * 3);
  for (let i = 0; i < palette.length; i++) {
    gct[i * 3] = palette[i][0];
    gct[i * 3 + 1] = palette[i][1];
    gct[i * 3 + 2] = palette[i][2];
  }
  parts.push(gct);

  // NETSCAPE2.0 looping extension: loop=0 means forever.
  parts.push(Buffer.from([
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // "NETSCAPE2.0"
    0x03, 0x01, loop & 255, (loop >> 8) & 255, 0x00,
  ]));

  const delay = Math.max(2, Math.min(0xffff, Math.round(delayCs)));
  const canvas = diff ? Buffer.alloc(width * height) : null;
  const paletteDist = (a, b) => {
    const dr = palette[a][0] - palette[b][0];
    const dg = palette[a][1] - palette[b][1];
    const db = palette[a][2] - palette[b][2];
    return dr * dr + dg * dg + db * db;
  };
  const rects = [];

  for (let n = 0; n < frames.length; n++) {
    const idx = indexFrame(frames[n], width, height, palette, dither, nearest);
    let left = 0, top = 0, w = width, h = height;
    let payload = idx;
    let useT = false;

    if (diff) {
      if (n === 0) {
        // Nothing is beneath the first frame; a transparent pixel here would
        // expose undefined background. Full and opaque, always.
        idx.copy(canvas);
      } else {
        let minX = width, minY = height, maxX = -1, maxY = -1;
        const redraw = Buffer.alloc(width * height);
        for (let p = 0; p < idx.length; p++) {
          const a = idx[p];
          const b = canvas[p];
          if (a === b) continue;
          if (tol > 0 && paletteDist(a, b) <= tol) continue;
          redraw[p] = 1;
          const x = p % width;
          const y = (p / width) | 0;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        // Nothing moved: a 1x1 transparent pixel, never a zero-size rect.
        if (maxX < 0) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
        left = minX; top = minY;
        w = maxX - minX + 1; h = maxY - minY + 1;
        const sub = Buffer.alloc(w * h);
        for (let y = 0; y < h; y++) {
          const srcRow = (top + y) * width + left;
          const dstRow = y * w;
          for (let x = 0; x < w; x++) {
            if (redraw[srcRow + x]) {
              sub[dstRow + x] = idx[srcRow + x];
              canvas[srcRow + x] = idx[srcRow + x];
            } else {
              sub[dstRow + x] = transparentIndex;
            }
          }
        }
        payload = sub;
        useT = true;
      }
    }

    // Graphic Control Extension. 0x04 = disposal 1 (leave in place); 0x05 adds
    // the transparent-colour flag, and byte 6 then carries the real index.
    parts.push(Buffer.from([
      0x21, 0xf9, 0x04,
      useT ? 0x05 : 0x04,
      delay & 255, (delay >> 8) & 255,
      useT ? transparentIndex : 0x00,
      0x00,
    ]));
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(left, 1);
    descriptor.writeUInt16LE(top, 3);
    descriptor.writeUInt16LE(w, 5);
    descriptor.writeUInt16LE(h, 7);
    descriptor[9] = 0x00; // no local colour table, ever — see the palette note
    parts.push(descriptor);
    parts.push(lzwEncode(payload, minCodeSize));
    rects.push([left, top, w, h]);
  }

  parts.push(Buffer.from([0x3b]));
  const out = Buffer.concat(parts);
  // Attached for the encoder's own callers/tests; invisible to the bytes.
  Object.defineProperty(out, "__rects", { value: rects, enumerable: false });
  Object.defineProperty(out, "__paletteSize", { value: palette.length, enumerable: false });
  Object.defineProperty(out, "__transparentIndex", { value: transparentIndex, enumerable: false });
  return out;
}

// ===========================================================================
// GIF STRUCTURAL PARSE — the verification half of "QC PASS is never proof".
// Walks the real block structure (no LZW decode) and reports what a decoder
// would see: dimensions, frame count, loop, per-frame delays, and — now that
// frames are sub-rectangles — where each frame actually lands and whether it
// carries transparency.
// ===========================================================================
function parseGifMeta(buf) {
  const bad = (reason) => ({ ok: false, reason });
  if (!Buffer.isBuffer(buf) || buf.length < 13) return bad("too_short");
  const sig = buf.toString("ascii", 0, 6);
  if (sig !== "GIF89a" && sig !== "GIF87a") return bad("not_a_gif");
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10];
  let pos = 13;
  if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));

  let frameCount = 0;
  let loop = null;
  const delaysCs = [];
  const rects = [];
  const disposals = [];
  const transparentFrames = [];
  let pendingGce = null;
  let sawTrailer = false;
  const skipSubBlocks = () => {
    while (pos < buf.length) {
      const n = buf[pos++];
      if (!n) return true;
      pos += n;
    }
    return false;
  };

  while (pos < buf.length) {
    const block = buf[pos++];
    if (block === 0x3b) { sawTrailer = true; break; }
    if (block === 0x21) {
      const label = buf[pos++];
      if (label === 0xf9 && buf[pos] >= 4) {
        const p = buf[pos + 1];
        delaysCs.push(buf.readUInt16LE(pos + 2));
        pendingGce = {
          disposal: (p >> 2) & 0x07,
          transparent: (p & 0x01) === 1,
          tIndex: buf[pos + 4],
        };
      }
      if (label === 0xff && buf[pos] === 11 && buf.toString("ascii", pos + 1, pos + 12) === "NETSCAPE2.0") {
        const sub = pos + 12;
        if (buf[sub] >= 3 && buf[sub + 1] === 1) loop = buf.readUInt16LE(sub + 2);
      }
      if (!skipSubBlocks()) return bad("truncated_extension");
    } else if (block === 0x2c) {
      if (pos + 9 > buf.length) return bad("truncated_descriptor");
      rects.push([
        buf.readUInt16LE(pos),
        buf.readUInt16LE(pos + 2),
        buf.readUInt16LE(pos + 4),
        buf.readUInt16LE(pos + 6),
      ]);
      disposals.push(pendingGce ? pendingGce.disposal : null);
      transparentFrames.push(pendingGce ? pendingGce.transparent : false);
      pendingGce = null;
      const p = buf[pos + 8];
      pos += 9;
      if (p & 0x80) pos += 3 * (1 << ((p & 0x07) + 1));
      pos++; // LZW min code size
      if (!skipSubBlocks()) return bad("truncated_image_data");
      frameCount++;
    } else {
      return bad(`unknown_block_0x${block.toString(16)}`);
    }
  }
  if (!sawTrailer) return bad("missing_trailer");
  // A frame whose rectangle leaves the logical screen is a decoder crash, not
  // a cosmetic defect — catch it here rather than in someone's inbox.
  for (const [l, t, w, h] of rects) {
    if (w < 1 || h < 1 || l + w > width || t + h > height) return bad("frame_rect_outside_screen");
  }
  return { ok: true, width, height, frameCount, loop, delaysCs, rects, disposals, transparentFrames };
}

// ===========================================================================
// CAPTURE — the page helpers both lanes share.
// ===========================================================================

/**
 * Pin OUR chrome so the only thing moving is the client's hero video: finite
 * animations are FINISHED (an entrance blur caught mid-flight is a smeared
 * headline, not motion), infinite ones are paused at 0.
 */
const settleAnimations = (page) => page.evaluate(() => {
  let infinite = 0;
  let finished = 0;
  for (const a of document.getAnimations()) {
    try {
      const iterations = a.effect && a.effect.getComputedTiming().iterations;
      if (iterations === Infinity) { a.pause(); a.currentTime = 0; infinite++; }
      else { a.finish(); finished++; }
    } catch { /* an animation we cannot touch is not worth failing the shot */ }
  }
  return { infinite, finished };
});

/**
 * Measure where the hero actually ends, in CSS px. Two hero families exist in
 * the live lanes and a single rule has to serve both:
 *   · fixed-aspect card (the plumbing lane) — the <video> OVERSCANS its card,
 *     so walking up to the nearest ≥85%-wide ancestor is what finds the real
 *     visible edge;
 *   · viewport-height hero (fence, roofing) — the walk lands on the full
 *     screen, which is already correct.
 * No video at all: the first flow section's bottom.
 */
const measureHero = (page) => page.evaluate(() => {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const videos = [...document.querySelectorAll("video")];
  let bottom = null;
  if (videos.length) {
    let el = videos[0].parentElement;
    let best = null;
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.width >= vw * 0.85 && r.height > 150) {
        const b = Math.round(r.bottom + window.scrollY);
        if (best === null || b < best) best = b;
      }
      el = el.parentElement;
    }
    bottom = best;
  }
  if (bottom === null) {
    const root = document.querySelector("main") || document.body;
    let node = root;
    while (node.children.length && node.children.length < 3) node = node.children[0];
    const first = [...node.children].find((e) => e.getBoundingClientRect().height > 100);
    bottom = first ? Math.round(first.getBoundingClientRect().bottom + window.scrollY) : vh;
  }
  return {
    viewportHeight: vh,
    viewportWidth: vw,
    heroBottomRawCssPx: bottom,
    videoCount: videos.length,
    scrollHeight: document.documentElement.scrollHeight,
  };
});

/** Pause every video and seek it to t seconds, resolving on `seeked`. */
const seekVideos = (page, t) => page.evaluate((tt) => new Promise((resolve) => {
  const vs = [...document.querySelectorAll("video")];
  if (!vs.length) return resolve(null);
  let pending = vs.length;
  const landed = [];
  const done = (v, i) => {
    if (v.__wssDone) return;
    v.__wssDone = true;
    landed[i] = v.currentTime;
    if (--pending === 0) resolve(landed);
  };
  vs.forEach((v, i) => {
    v.__wssDone = false;
    v.pause();
    // Assigning currentTime to the value it already holds fires no `seeked`,
    // and waiting 3s for an event that will never come turns an 18-frame
    // capture into a minute. Frame 0 of a just-loaded video hits this.
    if (Math.abs(v.currentTime - tt) < 1e-4) return done(v, i);
    const h = () => { v.removeEventListener("seeked", h); done(v, i); };
    v.addEventListener("seeked", h);
    v.currentTime = tt;
    setTimeout(() => done(v, i), 3000);
  });
}), t);

/**
 * A browser, and who has to close it.
 *
 * Both capture lanes used to launch their own chromium unconditionally. The
 * render gate already has one open on this exact mirror, and a second launch
 * costs a permit (lib/serverless-chromium meters browsers at one), a cold
 * start and a second full navigation of a page we are already looking at. So a
 * caller may hand its browser in; whoever OPENED it closes it.
 */
async function acquireBrowser(injected) {
  if (injected) return { browser: injected, release: async () => {} };
  const browser = await launchChromium();
  return { browser, release: async () => { await browser.close().catch(() => {}); } };
}

async function openMirror(browser, url, deviceScaleFactor, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  const nav = motionShotUrl(url);
  await page.goto(nav, { waitUntil: "networkidle", timeout: 45000 }).catch(async () => {
    // A slow third-party beacon must not cost the capture; fall back to load.
    await page.goto(nav, { waitUntil: "load", timeout: 45000 });
  });
  return page;
}

// ===========================================================================
// CAPTURE — HERO LANE. Locked camera, seek-driven, real frame interval.
// ===========================================================================
async function captureHeroFrames({
  url,
  frameCount = MOTION_DEFAULTS.frameCount,
  delayCs = MOTION_DEFAULTS.delayCs,
  viewport = MOTION_DEFAULTS.viewport,
  targetWidth = MOTION_DEFAULTS.targetWidth,
  repaintMs = MOTION_DEFAULTS.repaintMs,
  minHeight = MOTION_DEFAULTS.heroMinHeight,
  browser: injectedBrowser = null,
} = {}) {
  if (!url) throw new Error("no_url");
  const { browser, release } = await acquireBrowser(injectedBrowser);
  try {
    // Geometry is measured in CSS px and is independent of deviceScaleFactor,
    // so ONE page serves both the measurement and the capture.
    const scaleProbe = heroClipHeight({ heroBottomCssPx: viewport.height, viewportWidth: viewport.width, targetWidth });
    const page = await openMirror(browser, url, scaleProbe.scale, viewport);
    try {
      await page.waitForTimeout(2500);
      await page.evaluate(() => window.scrollTo(0, 0));
      const hero = await measureHero(page);
      const anims = await settleAnimations(page);
      await page.waitForTimeout(300);

      const geom = heroClipHeight({
        heroBottomCssPx: hero.heroBottomRawCssPx,
        viewportWidth: viewport.width,
        viewportHeight: Math.min(viewport.height, hero.viewportHeight || viewport.height),
        targetWidth,
        minHeight,
      });
      const clip = { x: 0, y: 0, width: viewport.width, height: geom.clipHeightCssPx };

      // THE FRAME INTERVAL. Not a settle: one twelfth of a second of the
      // subject's own time, landed exactly, whatever the screenshot costs.
      const dt = Math.max(1, Math.round(delayCs)) / 100;
      const frames = [];
      const landedTimes = [];
      let width = 0;
      let height = 0;
      const t0 = Date.now();
      for (let i = 0; i < frameCount; i++) {
        const landed = await seekVideos(page, Number((i * dt).toFixed(6)));
        landedTimes.push(landed ? landed[0] : null);
        await page.waitForTimeout(repaintMs);
        await settleAnimations(page); // animations created after load, pinned too
        const decoded = decodePng(await page.screenshot({ type: "png", clip }));
        if (!width) { width = decoded.width; height = decoded.height; }
        if (decoded.width !== width || decoded.height !== height) {
          throw new Error("frame_dimensions_drifted");
        }
        frames.push(decoded.rgba);
      }

      const motion = sequenceMotion(frames);
      return {
        lane: "hero",
        frames,
        width,
        height,
        motion,
        videoCount: hero.videoCount,
        videoPlaying: hero.videoCount > 0 && motion.meanDelta > 0,
        heroBottomCssPx: hero.heroBottomRawCssPx,
        clipHeightCssPx: geom.clipHeightCssPx,
        deviceScaleFactor: geom.scale,
        animationsPinned: anims,
        landedVideoTimes: landedTimes,
        captureMs: Date.now() - t0,
        landed: page.url(),
      };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await release();
  }
}

// ===========================================================================
// CAPTURE — PAN LANE (fallback). Kept intact for the dead-hero case: a GIF
// that does not move at all looks broken, and a slow glide at least shows the
// page. This is the v1 behaviour, unchanged in spirit.
// ===========================================================================
async function captureMotionFrames({
  url,
  frameCount = MOTION_DEFAULTS.panFrameCount,
  viewport = MOTION_DEFAULTS.viewport,
  targetWidth = MOTION_DEFAULTS.targetWidth,
  scrollViewports = MOTION_DEFAULTS.scrollViewports,
  settleMs = MOTION_DEFAULTS.settleMs,
  browser: injectedBrowser = null,
} = {}) {
  if (!url) throw new Error("no_url");
  const { browser, release } = await acquireBrowser(injectedBrowser);
  try {
    const page = await openMirror(browser, url, targetWidth / viewport.width, viewport);
    try {
      await page.waitForTimeout(1200);

      // Does the hero video actually play headless? Two samples, 600ms apart.
      // Recorded honestly either way: the truth law reaches the meta sidecar.
      const sampleVideos = () => page.evaluate(() =>
        [...document.querySelectorAll("video")].map((v) => ({ t: v.currentTime, paused: v.paused })));
      const before = await sampleVideos();
      await page.waitForTimeout(600);
      const after = await sampleVideos();
      const videoPlaying = after.some((v, i) => !v.paused && before[i] && v.t > before[i].t + 0.05);

      // Find the trust rail so the pan can END on it. Heuristic on visible
      // text — star glyphs or an "N Google reviews" count in a compact element
      // below the first screen. Absence is fine; the span falls back.
      const metrics = await page.evaluate(() => {
        let railTop = null;
        const railish = /(★{3,})|(\d[\d,]*\s+google\s+reviews?)/i;
        for (const el of document.querySelectorAll("section, div, h2, h3, p, span")) {
          const t = (el.innerText || "").trim();
          if (!t || t.length > 120 || !railish.test(t)) continue;
          const r = el.getBoundingClientRect();
          if (r.height < 8 || r.height > 400) continue;
          const top = Math.round(r.top + window.scrollY);
          if (top <= window.innerHeight) continue; // that's the hero, not the rail
          if (railTop === null || top < railTop) railTop = top;
        }
        return {
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          railTop,
        };
      });
      const total = motionScrollSpan({ ...metrics, scrollViewports });

      const frames = [];
      let width = 0;
      let height = 0;
      for (let i = 0; i < frameCount; i++) {
        // Cosine ease-in-out: the pan lingers at the hero (where the video is
        // moving on its own), glides through the middle, settles at the rail.
        const t = frameCount === 1 ? 0 : i / (frameCount - 1);
        const y = Math.round((total * (1 - Math.cos(Math.PI * t))) / 2);
        await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
        await page.waitForTimeout(settleMs);
        const decoded = decodePng(await page.screenshot({ type: "png" }));
        if (!width) { width = decoded.width; height = decoded.height; }
        if (decoded.width !== width || decoded.height !== height) {
          throw new Error("frame_dimensions_drifted");
        }
        frames.push(decoded.rgba);
      }
      return {
        lane: "pan",
        frames, width, height, videoPlaying,
        motion: sequenceMotion(frames),
        landed: page.url(),
        scrollTotalCssPx: total,
        railTopCssPx: metrics.railTop,
      };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await release();
  }
}

// ===========================================================================
// THE BUDGET LADDER — walked here so both lanes obey the same fail-closed rule.
// ===========================================================================
/**
 * Walk the rungs until one fits. A rung may shrink the picture (box filter),
 * thin the palette, drop dithering, widen the dead band, or — last — drop
 * frames. Dropping frames STRETCHES the delay by the same factor so the loop
 * keeps its length instead of playing at double speed.
 *
 * Returns { gif, used } or { gif:null, smallest, smallestRung }. It never
 * returns something over budget: an email must not carry a megabyte.
 */
function encodeWithinBudget({
  frames,
  width,
  height,
  delayCs,
  maxBytes = MOTION_DEFAULTS.maxBytes,
  ladder,
  diff = false,
  loop = 0,
}) {
  let smallest = Infinity;
  let smallestRung = null;
  for (const rung of ladder) {
    const stride = rung.frameStride || 1;
    const src = stride > 1 ? frames.filter((_, i) => i % stride === 0) : frames;
    const outWidth = Math.min(rung.width || width, width);
    const outHeight = outWidth === width
      ? height
      : Math.max(1, Math.round((height * outWidth) / width));
    const scaled = outWidth === width && outHeight === height
      ? src
      : src.map((f) => boxDownscaleRGBA(f, width, height, outWidth, outHeight));
    const rungDelay = Math.max(2, Math.round(delayCs * stride));
    const buf = encodeGif({
      frames: scaled,
      width: outWidth,
      height: outHeight,
      delayCs: rungDelay,
      loop,
      maxColors: rung.maxColors,
      dither: rung.dither,
      diff,
      tol: rung.tol || 0,
    });
    const used = {
      ...rung,
      diff,
      frames: scaled.length,
      width: outWidth,
      height: outHeight,
      delayCs: rungDelay,
      bytes: buf.length,
    };
    if (buf.length < smallest) { smallest = buf.length; smallestRung = used; }
    if (buf.length <= maxBytes) return { gif: buf, used };
  }
  return { gif: null, smallest, smallestRung };
}

// ===========================================================================
// THE LINE'S ENTRY POINT — capture, encode within budget, upload, report.
// ===========================================================================
/**
 * ensureLineMotionShot({ previewUrl }) ->
 *   { ok, publicUrl, objectPath, bytes, sha, frames, width, height,
 *     delayCs, lane, motion, videoPlaying, encoder }   — on success
 *   { ok:false, reason }                               — on any failure
 *
 * Always re-captures (see header). The sha256 of the ENCODED bytes is returned
 * so the caller can cache-bust the email <img> URL, exactly like the stills'
 * shot_sha.
 */
async function ensureLineMotionShot({
  previewUrl = "",
  frameCount = MOTION_DEFAULTS.frameCount,
  delayCs = MOTION_DEFAULTS.delayCs,
  crossfadeFrames = MOTION_DEFAULTS.crossfadeFrames,
  minMeanDelta = MOTION_DEFAULTS.minMeanDelta,
  maxBytes = MOTION_DEFAULTS.maxBytes,
  allowPanFallback = true,
  buildHash = "",
  browser = null,
} = {}) {
  if (!previewUrl) return { ok: false, reason: "no_preview_url" };
  const objectPath = gifObjectPath({ url: previewUrl });
  if (!objectPath) return { ok: false, reason: "unkeyable_url" };

  // AN UNCHANGED BUILD REUSES ITS LOOP. Same rule as the stills: the object key
  // comes from the URL, so only the sidecar's build_hash can say whether the
  // stored loop is a loop of the page that is live now. Encoding one costs
  // 7–8s of browser measured, and a gate that runs twice on the same build
  // (a retried batch, a memoised rebuild) has nothing new to record.
  //
  // No hash on either side is NOT a match — that is the always-re-encode
  // behaviour this had before, kept as the fail-closed default.
  const wantedHash = String(buildHash || "").trim();
  if (wantedHash) {
    const storedMeta = await fetchProofShot(gifMetaPath({ url: previewUrl })).catch(() => null);
    if (storedMeta && storedMeta.ok) {
      let meta = null;
      try { meta = JSON.parse(storedMeta.buffer.toString("utf8")); } catch { meta = null; }
      const sha = String((meta && meta.gif_sha256) || "");
      if (meta && String(meta.build_hash || "").trim() === wantedHash && /^[0-9a-f]{64}$/i.test(sha)) {
        return {
          ok: true,
          reused: true,
          publicUrl: publicProofUrl(objectPath),
          objectPath,
          bytes: Number(meta.bytes) || 0,
          sha,
          lane: meta.lane || "",
          frames: Number(meta.frames) || 0,
          width: Number(meta.width) || 0,
          height: Number(meta.height) || 0,
          delayCs: Number(meta.delay_cs) || 0,
          fps: Number(meta.fps) || 0,
          videoPlaying: meta.video_playing === true,
        };
      }
    }
  }

  let capture;
  let fallbackReason = null;
  try {
    capture = await captureHeroFrames({ url: previewUrl, frameCount, delayCs, browser });
  } catch (e) {
    return { ok: false, reason: `capture_failed: ${String(e.message || e).slice(0, 160)}` };
  }

  // THE DEAD-HERO CHECK. A locked camera over a static <img> hero is a GIF
  // that never moves — worse than the old slideshow, because it looks broken
  // rather than slow. Measured: a live hero steps 1.5+ per frame at this size,
  // a dead one 0.012. Anything under the floor goes back to the pan.
  if (capture.videoCount < 1 || capture.motion.meanDelta < minMeanDelta) {
    fallbackReason = capture.videoCount < 1
      ? "no_hero_video"
      : `hero_static: mean_delta_${capture.motion.meanDelta.toFixed(3)} < ${minMeanDelta}`;
    if (!allowPanFallback) return { ok: false, reason: fallbackReason };
    try {
      capture = await captureMotionFrames({ url: previewUrl, browser });
    } catch (e) {
      return { ok: false, reason: `pan_fallback_failed: ${String(e.message || e).slice(0, 160)}` };
    }
  }

  const hero = capture.lane === "hero";
  // The wrap. Only the hero lane loops back on itself; the pan ends where it
  // ends and a crossfade there would just smear the trust rail into the hero.
  const sequence = hero ? crossfadeTail(capture.frames, crossfadeFrames) : capture.frames;
  const laneDelay = hero ? delayCs : MOTION_DEFAULTS.panDelayCs;

  let walk;
  try {
    walk = encodeWithinBudget({
      frames: sequence,
      width: capture.width,
      height: capture.height,
      delayCs: laneDelay,
      maxBytes,
      ladder: hero ? HERO_LADDER : PAN_LADDER,
      diff: hero,
    });
  } catch (e) {
    return { ok: false, reason: `encode_failed: ${String(e.message || e).slice(0, 160)}` };
  }
  // FAIL CLOSED: an email must never carry a megabyte into a phone's data
  // plan because the encoder could not make budget.
  if (!walk.gif) {
    return { ok: false, reason: `gif_over_budget: smallest_${walk.smallest}_bytes > ${maxBytes}` };
  }
  const gif = walk.gif;
  const used = walk.used;

  // Decode our own structure before shipping it. QC PASS is never proof.
  const parsed = parseGifMeta(gif);
  if (parsed.ok !== true || parsed.frameCount !== used.frames) {
    return { ok: false, reason: `gif_selfcheck_failed: ${parsed.reason || `frames_${parsed.frameCount}_of_${used.frames}`}` };
  }

  const sha = createHash("sha256").update(gif).digest("hex");
  const up = await uploadProofShot(objectPath, gif, { contentType: "image/gif" });
  if (up.ok !== true) return { ok: false, reason: `upload_failed: ${up.reason || ""}`.trim() };
  await uploadProofShot(
    gifMetaPath({ url: previewUrl }),
    Buffer.from(JSON.stringify({
      schema: "wss-motion-shot-meta-v3",
      variant: "gif",
      lane: capture.lane,
      fallback_reason: fallbackReason,
      // WHICH BUILD THIS IS A LOOP OF. Same reason as the stills' sidecar: the
      // object key comes from the URL, which survives a rebuild, so without
      // this there is no way to ask whether the stored loop is current.
      build_hash: String(buildHash || "") || null,
      requested_url: String(previewUrl),
      captured_url: capture.landed,
      captured_domain: registrableDomain(capture.landed),
      bytes: gif.length,
      gif_sha256: sha,
      frames: used.frames,
      width: used.width,
      height: used.height,
      capture_width: capture.width,
      capture_height: capture.height,
      delay_cs: used.delayCs,
      fps: +(100 / used.delayCs).toFixed(2),
      loop_seconds: +((used.frames * used.delayCs) / 100).toFixed(2),
      crossfade_frames: hero ? crossfadeFrames : 0,
      video_playing: capture.videoPlaying,
      video_count: capture.videoCount ?? null,
      motion_mean_delta: capture.motion ? +capture.motion.meanDelta.toFixed(4) : null,
      motion_min_delta: capture.motion ? +capture.motion.minDelta.toFixed(4) : null,
      motion_max_delta: capture.motion ? +capture.motion.maxDelta.toFixed(4) : null,
      hero_bottom_css_px: capture.heroBottomCssPx ?? null,
      clip_height_css_px: capture.clipHeightCssPx ?? null,
      device_scale_factor: capture.deviceScaleFactor ?? null,
      animations_pinned: capture.animationsPinned ?? null,
      scroll_total_css_px: capture.scrollTotalCssPx ?? null,
      rail_top_css_px: capture.railTopCssPx ?? null,
      encoder: used,
      parsed_frame_rects: parsed.rects,
      captured_at: new Date().toISOString(),
      captured_by: "line-motion-shot",
    }, null, 2), "utf8"),
    { contentType: "application/json" },
  );

  return {
    ok: true,
    publicUrl: publicProofUrl(objectPath),
    objectPath,
    bytes: gif.length,
    sha,
    lane: capture.lane,
    fallbackReason,
    frames: used.frames,
    width: used.width,
    height: used.height,
    delayCs: used.delayCs,
    fps: +(100 / used.delayCs).toFixed(2),
    loopSeconds: +((used.frames * used.delayCs) / 100).toFixed(2),
    motion: capture.motion,
    videoPlaying: capture.videoPlaying,
    encoder: used,
    landed: capture.landed,
  };
}

module.exports = {
  MOTION_DEFAULTS,
  HERO_LADDER,
  PAN_LADDER,
  gifObjectPath,
  gifMetaPath,
  motionShotUrl,
  motionScrollSpan,
  heroClipHeight,
  decodePng,
  encodeGif,
  encodeWithinBudget,
  parseGifMeta,
  boxDownscaleRGBA,
  crossfadeTail,
  sequenceMotion,
  captureHeroFrames,
  captureMotionFrames,
  ensureLineMotionShot,
  // exported for tests only
  _buildPalette: buildPalette,
  _indexFrame: indexFrame,
  _makeNearest: makeNearest,
  _lzwEncode: lzwEncode,
  _frameLumaDelta: frameLumaDelta,
};
