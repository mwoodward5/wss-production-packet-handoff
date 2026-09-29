"use strict";

// lib/png-decode.js — a dependency-free PNG decoder, because the one we had
// shells out to ffmpeg.
//
// THE BUG THIS FIXES, measured 2026-08-01: capture-brand's decodeToRgba runs
// `execFile("ffmpeg", ...)`. ffmpeg is on a developer machine and is NOT in the
// Vercel serverless runtime, and no image decoder is a dependency at all. So
// measureAccent() could only ever return null in production — for every logo,
// forever. The miner reported `accent_unmeasurable` and we read it as "this
// logo is greyscale", when the truth was "this environment cannot decode any
// image". whitebirdfence.com's mark measures #f78f1e at 63% share locally and
// was rejected in production; that contradiction is what exposed it.
//
// Same shape as the Chromium-in-a-lambda problem: a binary that exists where we
// test and never where we run. The fix is the same shape too — do it in JS.
//
// Scope is deliberate: PNG only, and only what a logo needs. PNG covers the
// overwhelming majority of logos; JPEG/WebP fall back to the old path (and to
// null), which is honest — a colour we cannot measure stays unmeasured rather
// than being guessed. Interlaced PNGs are refused rather than mis-decoded.

const zlib = require("node:zlib");

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Paeth predictor — the one filter type that is not obvious by name. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * decodePngToRgba(buffer) -> { width, height, data: Uint8Array (RGBA) } | null
 *
 * Returns null — never throws and never guesses — for anything it cannot decode
 * honestly: a non-PNG, an interlaced PNG, an unsupported colour type.
 */
function decodePngToRgba(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;

  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];

  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const start = off + 8;
    if (start + len > buf.length) break;

    if (type === "IHDR") {
      width = buf.readUInt32BE(start);
      height = buf.readUInt32BE(start + 4);
      depth = buf[start + 8];
      colorType = buf[start + 9];
      interlace = buf[start + 12];
    } else if (type === "PLTE") {
      palette = buf.subarray(start, start + len);
    } else if (type === "tRNS") {
      trns = buf.subarray(start, start + len);
    } else if (type === "IDAT") {
      idat.push(buf.subarray(start, start + len));
    } else if (type === "IEND") {
      break;
    }
    off = start + len + 4; // + CRC
  }

  // Only the shapes a logo actually uses, and only 8-bit. Interlaced PNGs need
  // Adam7 deinterlacing; refusing is better than returning scrambled pixels,
  // because a wrong colour on a client's site is worse than no colour.
  if (!width || !height || depth !== 8 || interlace !== 0) return null;
  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!CHANNELS) return null;
  if (colorType === 3 && !palette) return null;
  if (width * height > 40e6) return null;             // refuse absurd allocations

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }

  const stride = width * CHANNELS;
  if (raw.length < (stride + 1) * height) return null;

  // Undo the per-scanline filters in place.
  const px = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= CHANNELS ? out[x - CHANNELS] : 0;
      const b = prev[x];
      const c = x >= CHANNELS ? prev[x - CHANNELS] : 0;
      const v = line[x];
      out[x] = filter === 0 ? v
        : filter === 1 ? (v + a) & 0xff
          : filter === 2 ? (v + b) & 0xff
            : filter === 3 ? (v + ((a + b) >> 1)) & 0xff
              : filter === 4 ? (v + paeth(a, b, c)) & 0xff
                : v;
    }
    prev = out;
  }

  // Normalise every colour type to straight RGBA.
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const s = i * CHANNELS;
    if (colorType === 0) {                            // greyscale
      data[p] = data[p + 1] = data[p + 2] = px[s];
      data[p + 3] = 255;
    } else if (colorType === 4) {                     // greyscale + alpha
      data[p] = data[p + 1] = data[p + 2] = px[s];
      data[p + 3] = px[s + 1];
    } else if (colorType === 2) {                     // truecolour
      data[p] = px[s]; data[p + 1] = px[s + 1]; data[p + 2] = px[s + 2]; data[p + 3] = 255;
    } else if (colorType === 6) {                     // truecolour + alpha
      data[p] = px[s]; data[p + 1] = px[s + 1]; data[p + 2] = px[s + 2]; data[p + 3] = px[s + 3];
    } else {                                          // indexed
      const idx = px[s] * 3;
      if (idx + 2 >= palette.length) return null;
      data[p] = palette[idx]; data[p + 1] = palette[idx + 1]; data[p + 2] = palette[idx + 2];
      data[p + 3] = trns && px[s] < trns.length ? trns[px[s]] : 255;
    }
  }

  return { width, height, data };
}

module.exports = { decodePngToRgba };
