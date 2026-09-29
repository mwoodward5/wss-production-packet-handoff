"use strict";

// test/line-motion-shot.test.js — THE SITE THAT MOVES, VERIFIED BY DECODING.
//
// The motion shot is a hand-written GIF89a: our own LZW, our own palette, our
// own PNG decode feeding it. A hand-written encoder that is "probably right"
// ships a torn or truncated image into a prospect's inbox, so nothing here is
// asserted by eyeballing bytes: every test DECODES what the encoder wrote —
// with an independent LZW decoder written in this file, not the encoder's own
// code — and compares pixels. "QC PASS is never proof; decode the artifact."

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const {
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
  _indexFrame,
  _buildPalette,
  _makeNearest,
} = require("../lib/line-motion-shot");
const { proofObjectPath, proofMetaPath } = require("../lib/proof-storage");

// ---------------------------------------------------------------------------
// An independent GIF reader: block walk + LZW decode, written from the spec,
// sharing no code with the encoder. If encoder and decoder agree on every
// pixel, a browser will too.
// ---------------------------------------------------------------------------
function lzwDecode(minCodeSize, data) {
  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const resetDict = () => {
    dict = [];
    for (let i = 0; i < CLEAR; i++) dict[i] = [i];
    dict[CLEAR] = null;
    dict[EOI] = null;
  };
  resetDict();
  let next = EOI + 1;
  const out = [];
  let acc = 0;
  let accBits = 0;
  let pos = 0;
  let prev = null;
  const read = () => {
    while (accBits < codeSize && pos < data.length) {
      acc |= data[pos++] << accBits;
      accBits += 8;
    }
    if (accBits < codeSize) return -1;
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    accBits -= codeSize;
    return code;
  };
  for (;;) {
    const code = read();
    if (code < 0) throw new Error("lzw_ran_out_of_bits_before_eoi");
    if (code === CLEAR) {
      resetDict();
      next = EOI + 1;
      codeSize = minCodeSize + 1;
      prev = null;
      continue;
    }
    if (code === EOI) break;
    let entry;
    if (code < next && dict[code]) entry = dict[code];
    else if (code === next && prev) entry = [...prev, prev[0]];
    else throw new Error(`lzw_bad_code_${code}`);
    out.push(...entry);
    if (prev) {
      dict[next++] = [...prev, entry[0]];
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}

/**
 * Full independent decode AND COMPOSITE. Frames are no longer guaranteed to be
 * full-size opaque rectangles — the locked-camera encoder writes only what
 * changed, over a persistent canvas, with one palette index reserved as
 * transparent. So this walks the canvas the way a browser does: paint the
 * sub-rectangle, skip the transparent index, keep everything else. Every
 * returned frame is the FULL screen as it would appear at that moment.
 */
function decodeGifPixels(buf) {
  assert.equal(buf.toString("ascii", 0, 6), "GIF89a");
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10];
  assert.ok(packed & 0x80, "global colour table must be present");
  const gctLen = 1 << ((packed & 0x07) + 1);
  let pos = 13;
  const gct = [];
  for (let i = 0; i < gctLen; i++, pos += 3) gct.push([buf[pos], buf[pos + 1], buf[pos + 2]]);

  const canvas = new Array(width * height).fill(0);
  const frames = [];
  const descriptors = [];
  let gce = null;
  while (pos < buf.length) {
    const block = buf[pos++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = buf[pos++];
      if (label === 0xf9) {
        const p = buf[pos + 1];
        gce = {
          disposal: (p >> 2) & 0x07,
          transparent: (p & 0x01) === 1,
          tIndex: buf[pos + 4],
          delay: buf.readUInt16LE(pos + 2),
        };
      }
      while (buf[pos]) pos += buf[pos] + 1;
      pos++;
    } else if (block === 0x2c) {
      const left = buf.readUInt16LE(pos);
      const top = buf.readUInt16LE(pos + 2);
      const w = buf.readUInt16LE(pos + 4);
      const h = buf.readUInt16LE(pos + 6);
      const p = buf[pos + 8];
      pos += 9;
      assert.equal(p & 0x80, 0, "encoder never writes local colour tables");
      assert.ok(w >= 1 && h >= 1, "no zero-size rectangles");
      assert.ok(left + w <= width && top + h <= height, "rectangle stays on the logical screen");
      // Disposal 2 clears the canvas between frames, which would turn every
      // transparent hole into a background hole and dissolve the sequence.
      assert.notEqual(gce && gce.disposal, 2, "disposal must stay 'leave in place'");
      const minCodeSize = buf[pos++];
      const chunks = [];
      while (buf[pos]) {
        const n = buf[pos++];
        chunks.push(buf.subarray(pos, pos + n));
        pos += n;
      }
      pos++;
      const indices = lzwDecode(minCodeSize, Buffer.concat(chunks));
      assert.equal(indices.length, w * h, "decoded pixel count");
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = indices[y * w + x];
          if (gce && gce.transparent && v === gce.tIndex) continue;
          canvas[(top + y) * width + (left + x)] = v;
        }
      }
      descriptors.push({ left, top, w, h, ...(gce || {}) });
      frames.push(canvas.map((i) => gct[i]));
      gce = null;
    } else {
      throw new Error(`unexpected_block_0x${block.toString(16)}`);
    }
  }
  return { width, height, frames, descriptors, gct };
}

/** RGBA test frame: vertical bands of the given colours. */
function bandedFrame(width, height, colors) {
  const f = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = colors[Math.floor((x * colors.length) / width)];
      const i = (y * width + x) * 4;
      f[i] = c[0]; f[i + 1] = c[1]; f[i + 2] = c[2]; f[i + 3] = 255;
    }
  }
  return f;
}

// ---------------------------------------------------------------------------
// The encoder round-trips: what we wrote is what a decoder reads back.
// ---------------------------------------------------------------------------

test("a flat-colour animation survives encode → independent decode, pixel for pixel", () => {
  const colors = [
    [22, 21, 27],    // ink
    [74, 108, 247],  // accent
    [247, 247, 250], // page
    [200, 60, 40],
  ];
  const width = 24;
  const height = 16;
  const frames = [
    bandedFrame(width, height, colors),
    bandedFrame(width, height, [...colors].reverse()),
    bandedFrame(width, height, [colors[1], colors[3], colors[0], colors[2]]),
  ];
  const gif = encodeGif({ frames, width, height, delayCs: 120, loop: 0, maxColors: 256, dither: false });

  const decoded = decodeGifPixels(gif);
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  assert.equal(decoded.frames.length, 3);
  // With ≤4 distinct source colours and a 256-colour budget, median cut
  // isolates every colour exactly — so the round trip must be EXACT.
  frames.forEach((src, fi) => {
    const got = decoded.frames[fi];
    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      assert.deepEqual(got[p], [src[i], src[i + 1], src[i + 2]], `frame ${fi} pixel ${p}`);
    }
  });
});

test("a busy dithered frame still round-trips: decoded indices equal the encoder's own quantization", () => {
  // Deterministic pseudo-noise: hundreds of distinct colours forces real
  // quantization, dithering, LZW dictionary growth and code-size widening.
  const width = 96;
  const height = 64;
  const frame = Buffer.alloc(width * height * 4);
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < frame.length; i += 4) {
    frame[i] = Math.floor(rnd() * 256);
    frame[i + 1] = Math.floor(rnd() * 256);
    frame[i + 2] = Math.floor(rnd() * 256);
    frame[i + 3] = 255;
  }
  const gif = encodeGif({ frames: [frame], width, height, maxColors: 256, dither: true });
  const decoded = decodeGifPixels(gif);
  assert.equal(decoded.frames.length, 1);

  // The exact palette-mapped image the encoder should have written:
  const palette = _buildPalette([frame], 256);
  const indices = _indexFrame(frame, width, height, palette, true, _makeNearest(palette));
  const got = decoded.frames[0];
  for (let p = 0; p < width * height; p++) {
    assert.deepEqual(got[p], palette[indices[p]], `pixel ${p}`);
  }
});

test("the GIF's public anatomy: 89a header, loop-forever, 12.5fps, one descriptor per frame", () => {
  const width = 12;
  const height = 8;
  const frames = [0, 1, 2, 3].map((k) =>
    bandedFrame(width, height, [[k * 60, 0, 0], [0, k * 60, 0]]));
  const gif = encodeGif({ frames, width, height, delayCs: MOTION_DEFAULTS.delayCs, loop: 0 });

  const meta = parseGifMeta(gif);
  assert.equal(meta.ok, true);
  assert.equal(meta.width, width);
  assert.equal(meta.height, height);
  assert.equal(meta.frameCount, 4);
  assert.equal(meta.loop, 0, "NETSCAPE loop=0 means forever");
  assert.deepEqual(meta.delaysCs, [8, 8, 8, 8], "8cs = 12.5fps, the rate that reads as motion");
  assert.deepEqual(meta.disposals, [1, 1, 1, 1], "leave in place, always");
});

test("the defaults are the measured live-loop numbers, and the pan keeps its own slow ones", () => {
  // 12.5fps for 1.44s. Below ~10fps the eye counts frames instead of
  // integrating them, which is exactly what the flipbook did wrong.
  assert.equal(MOTION_DEFAULTS.delayCs, 8);
  assert.equal(MOTION_DEFAULTS.frameCount, 18);
  assert.ok(100 / MOTION_DEFAULTS.delayCs >= 12, "at least 12fps");
  assert.ok((MOTION_DEFAULTS.frameCount * MOTION_DEFAULTS.delayCs) / 100 <= 2.0, "loop stays around 1.5s");
  assert.equal(MOTION_DEFAULTS.targetWidth, 560, "email thumbnail width, not the 1280 capture width");
  // The fallback is deliberately unchanged: a still hero gets a slow glide.
  assert.equal(MOTION_DEFAULTS.panDelayCs, 120);
  assert.equal(MOTION_DEFAULTS.panFrameCount, 10);
});

test("parseGifMeta refuses what is not a GIF, without throwing", () => {
  assert.equal(parseGifMeta(Buffer.from("JFIF not a gif at all")).ok, false);
  assert.equal(parseGifMeta(Buffer.alloc(4)).ok, false);
  const truncated = encodeGif({
    frames: [bandedFrame(8, 8, [[1, 2, 3]])], width: 8, height: 8,
  }).subarray(0, 40);
  assert.equal(parseGifMeta(truncated).ok, false);
});

test("encodeGif fails loudly on malformed input instead of writing garbage", () => {
  assert.throws(() => encodeGif({ frames: [], width: 8, height: 8 }), /gif_no_frames/);
  assert.throws(
    () => encodeGif({ frames: [Buffer.alloc(10)], width: 8, height: 8 }),
    /gif_frame_size_mismatch/,
  );
  assert.throws(
    () => encodeGif({ frames: [Buffer.alloc(16)], width: 0, height: 0 }),
    /gif_bad_dimensions/,
  );
});

// ---------------------------------------------------------------------------
// PNG decode — the screenshot side of the pipeline. Forward-filter each of the
// five standard filters here, then require decodePng to reconstruct the exact
// source pixels. Tests all the arithmetic paeth/average/sub/up depend on.
// ---------------------------------------------------------------------------
function buildPng(width, height, rgba, filterForRow) {
  const bpp = 4;
  const stride = width * bpp;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filterForRow(y);
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const v = rgba[y * stride + x];
      const left = x >= bpp ? rgba[y * stride + x - bpp] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? rgba[(y - 1) * stride + x - bpp] : 0;
      let out = v;
      if (filter === 1) out = (v - left) & 255;
      else if (filter === 2) out = (v - up) & 255;
      else if (filter === 3) out = (v - ((left + up) >> 1)) & 255;
      else if (filter === 4) out = (v - paeth(left, up, upLeft)) & 255;
      raw[y * (stride + 1) + 1 + x] = out;
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4); // decodePng never checks CRC; zeroes are fine
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("decodePng reconstructs exact pixels through all five PNG filter types", () => {
  const width = 9;
  const height = 10; // 2 rows per filter type
  const rgba = Buffer.alloc(width * height * 4);
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) & 255;
  for (let i = 0; i < rgba.length; i++) rgba[i] = rnd();
  const png = buildPng(width, height, rgba, (y) => Math.floor(y / 2)); // 0,0,1,1,2,2,3,3,4,4

  const decoded = decodePng(png);
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  assert.ok(decoded.rgba.equals(rgba), "decoded RGBA must equal the source exactly");
});

test("decodePng refuses non-PNG bytes and unsupported layouts loudly", () => {
  assert.throws(() => decodePng(Buffer.from("GIF89a nope")), /png_bad_signature/);
  const png = buildPng(4, 4, Buffer.alloc(64), () => 0);
  const interlaced = Buffer.from(png);
  interlaced[8 + 8 + 12] = 1; // IHDR interlace byte
  assert.throws(() => decodePng(interlaced), /png_interlaced_unsupported/);
});

// ---------------------------------------------------------------------------
// Storage keying — same bucket, same derivation, honest extension.
// ---------------------------------------------------------------------------

test("the gif is keyed exactly like the stills — proofObjectPath's reserved 'gif' variant — with a .gif name", () => {
  const url = "https://wss-test-poor-john-s-plumbing-parkville.wss-ai.com";
  // THE WRITER AND THE READER MUST DERIVE THE SAME STRING.
  //
  // This used to assert `proofObjectPath(...).replace(/\.jpg$/, ".gif")` —
  // i.e. that the writer renamed the key on its way out. api/media/preview-shot
  // derives the path from proofObjectPath ALONE, so under that contract the
  // route looked for the loop at `…/gif/<sha>.jpg` and always missed. The
  // extension now belongs to proofObjectPath, and the assertion is the thing
  // that actually has to hold: one derivation, one name, both sides.
  assert.equal(gifObjectPath({ url }), proofObjectPath({ url, variant: "gif" }));
  assert.match(gifObjectPath({ url }), /^preview-shots\/gif\/[0-9a-f]{64}\.gif$/);
  assert.equal(gifMetaPath({ url }), proofMetaPath({ url, variant: "gif" }));
  assert.match(gifMetaPath({ url }), /^preview-shots\/gif\/[0-9a-f]{64}\.json$/);
  // The digest is unchanged by the rename, so every JPEG already in the bucket
  // keeps its key.
  assert.match(proofObjectPath({ url, variant: "new" }), /^preview-shots\/new\/[0-9a-f]{64}\.jpg$/);
  // Two spellings of the same host land on ONE object (writer/reader contract).
  assert.equal(gifObjectPath({ url }), gifObjectPath({ url: `${url}/` }));
  // And an unkeyable URL is refused, not guessed at.
  assert.equal(gifObjectPath({ url: "" }), "");
});

test("the capture navigates with the floater suppressed, but the key comes from the clean URL", () => {
  const url = "https://wss-test-poor-john-s-plumbing-parkville.wss-ai.com/";
  assert.match(motionShotUrl(url), /[?&]wssthumb=1/);
  assert.doesNotMatch(gifObjectPath({ url }), /wssthumb/);
});

// ---------------------------------------------------------------------------
// The pan's span — "hero THROUGH the trust rail", not "the first n screens".
// ---------------------------------------------------------------------------

test("when the trust rail was found, the pan ends anchored on it — even 10,000px down", () => {
  // The real Poor John numbers: rail at 10,258 on a 14,708px page.
  const span = motionScrollSpan({ scrollHeight: 14708, innerHeight: 800, railTop: 10258 });
  assert.equal(span, 10258 - Math.round(800 * 0.35), "final frame holds the rail in the upper third");
  assert.ok(span <= 14708 - 800, "never scrolls past the page's end");
});

test("without a findable rail, the span falls back to the fixed glide and never overruns the page", () => {
  assert.equal(
    motionScrollSpan({ scrollHeight: 14708, innerHeight: 800, railTop: null }),
    Math.round(800 * MOTION_DEFAULTS.scrollViewports),
  );
  // Short page: the cap is the page itself.
  assert.equal(motionScrollSpan({ scrollHeight: 1200, innerHeight: 800, railTop: null }), 400);
  // Single-screen page: no scroll at all, never negative.
  assert.equal(motionScrollSpan({ scrollHeight: 700, innerHeight: 800, railTop: null }), 0);
});

test("a 'rail' inside the first screen is the hero, not the rail — the fallback span wins", () => {
  const withHeroRail = motionScrollSpan({ scrollHeight: 14708, innerHeight: 800, railTop: 500 });
  const fallback = motionScrollSpan({ scrollHeight: 14708, innerHeight: 800, railTop: null });
  assert.equal(withHeroRail, fallback);
});

test("a rail below the last scrollable line still ends within the page", () => {
  const span = motionScrollSpan({ scrollHeight: 5000, innerHeight: 800, railTop: 4900 });
  assert.equal(span, 5000 - 800);
});

// ---------------------------------------------------------------------------
// THE LOCKED CAMERA — hero framing geometry. Measured on six live mirrors:
// the plumbing lane's hero card ends at 724 whatever the viewport height, so a
// blanket 800px window shipped 35px of the NEXT section along the bottom edge.
// ---------------------------------------------------------------------------

test("the hero clip is the measured hero, not a blanket viewport — and it snaps so the raster cannot drift", () => {
  // Plumbing lane: fixed-aspect hero card at 724.
  const plumbing = heroClipHeight({ heroBottomCssPx: 724 });
  assert.equal(plumbing.clipHeightCssPx, 722, "snapped so clip * scale is a whole number");
  assert.equal(plumbing.outWidth, 560);
  assert.equal(plumbing.outHeight, 316);
  assert.ok(plumbing.clipHeightCssPx <= 724, "never taller than the hero the DOM reported");
  assert.equal(Math.round(plumbing.clipHeightCssPx * plumbing.scale), plumbing.outHeight,
    "an unsnapped clip lets Chromium round differently and the capture dies mid-way");

  // Roofing lane: hero measures 813 on an 800-tall window — a viewport hero
  // that overshot by a border, not a reason to screenshot past the fold.
  const roofing = heroClipHeight({ heroBottomCssPx: 813 });
  assert.equal(roofing.clipHeightCssPx, 800);
  assert.equal(roofing.outHeight, 350);
});

test("a mis-detected hero is floored, not honoured — a 120px 'hero' is a bug, not a hero", () => {
  const tiny = heroClipHeight({ heroBottomCssPx: 120 });
  assert.equal(tiny.clipHeightCssPx, MOTION_DEFAULTS.heroMinHeight);
  assert.equal(heroClipHeight({ heroBottomCssPx: 0 }).clipHeightCssPx, MOTION_DEFAULTS.heroMinHeight);
  // And a floor taller than the window we captured cannot win either.
  const short = heroClipHeight({ heroBottomCssPx: 0, viewportHeight: 300, minHeight: 480 });
  assert.ok(short.clipHeightCssPx <= 300, "never taller than the window we actually captured");
  assert.ok(short.clipHeightCssPx >= 299, "and not needlessly shorter than the snap requires");
});

// ---------------------------------------------------------------------------
// FRAME DIFFERENCING — what buys the frame rate. Verified by decoding and
// COMPOSITING, because a diffed GIF that "parses" can still paint garbage.
// ---------------------------------------------------------------------------

/** A locked camera: static noise background, one small block that moves. */
function lockedCameraFrames(width, height, count) {
  const bg = Buffer.alloc(width * height * 4);
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < bg.length; i += 4) {
    const v = Math.floor(rnd() * 200);
    bg[i] = v; bg[i + 1] = 255 - v; bg[i + 2] = (v * 3) & 255; bg[i + 3] = 255;
  }
  const frames = [];
  for (let f = 0; f < count; f++) {
    const frame = Buffer.from(bg);
    const bx = 2 + f * 2;
    for (let y = 4; y < 12; y++) {
      for (let x = bx; x < bx + 6 && x < width; x++) {
        const i = (y * width + x) * 4;
        frame[i] = 255; frame[i + 1] = 0; frame[i + 2] = 0; frame[i + 3] = 255;
      }
    }
    frames.push(frame);
  }
  return frames;
}

test("a differenced animation composites back to exactly what the full-frame encoder would have painted", () => {
  const width = 40;
  const height = 24;
  const frames = lockedCameraFrames(width, height, 6);
  // 254 vs 255 on purpose: diffing buys its transparent slot out of the colour
  // budget, so this is the same 254-colour palette on both sides and any
  // disagreement is the differencing, not the quantiser.
  const flat = encodeGif({ frames, width, height, delayCs: 8, maxColors: 254, dither: "ordered", diff: false });
  const diffed = encodeGif({ frames, width, height, delayCs: 8, maxColors: 255, dither: "ordered", diff: true });

  const a = decodeGifPixels(flat);
  const b = decodeGifPixels(diffed);
  assert.equal(a.frames.length, b.frames.length);
  // Both encoders quantise with the same rules; the diffed one just stops
  // re-sending pixels it already sent. Composited, they must be identical.
  for (let f = 0; f < a.frames.length; f++) {
    for (let p = 0; p < width * height; p++) {
      assert.deepEqual(b.frames[f][p], a.frames[f][p], `frame ${f} pixel ${p}`);
    }
  }
});

test("the first differenced frame is full and opaque; every later one is a transparent sub-rectangle", () => {
  const width = 40;
  const height = 24;
  const gif = encodeGif({
    frames: lockedCameraFrames(width, height, 5),
    width, height, delayCs: 8, maxColors: 255, dither: "ordered", diff: true,
  });
  const { descriptors } = decodeGifPixels(gif);

  // Nothing is beneath frame 0 — a transparent pixel there exposes undefined
  // background, which is a hole in the middle of the prospect's hero.
  assert.equal(descriptors[0].transparent, false);
  assert.deepEqual(
    [descriptors[0].left, descriptors[0].top, descriptors[0].w, descriptors[0].h],
    [0, 0, width, height],
  );
  for (const d of descriptors.slice(1)) {
    assert.equal(d.transparent, true, "later frames carry the transparent flag");
    assert.equal(d.disposal, 1, "leave in place — disposal 2 would dissolve the chain");
    assert.ok(d.w * d.h < width * height, "and only the changed rectangle is written");
  }

  const meta = parseGifMeta(gif);
  assert.equal(meta.ok, true);
  assert.deepEqual(meta.transparentFrames, [false, true, true, true, true]);
});

test("frame differencing is what makes the frame rate affordable — it must actually be smaller", () => {
  const width = 64;
  const height = 40;
  const frames = lockedCameraFrames(width, height, 12);
  const opts = { width, height, delayCs: 8, maxColors: 255, dither: "ordered" };
  const flat = encodeGif({ frames, ...opts, diff: false });
  const diffed = encodeGif({ frames, ...opts, diff: true });
  assert.ok(diffed.length < flat.length * 0.5,
    `diffed ${diffed.length} vs flat ${flat.length} — the saving is the whole point`);
});

test("a frame in which nothing changed becomes a 1x1 hole, never a zero-size rectangle", () => {
  const width = 20;
  const height = 12;
  const one = bandedFrame(width, height, [[10, 20, 30], [200, 180, 160]]);
  const gif = encodeGif({
    frames: [one, Buffer.from(one), Buffer.from(one)],
    width, height, delayCs: 8, maxColors: 64, dither: false, diff: true,
  });
  const { descriptors, frames } = decodeGifPixels(gif);
  assert.deepEqual([descriptors[1].w, descriptors[1].h], [1, 1]);
  assert.deepEqual([descriptors[2].w, descriptors[2].h], [1, 1]);
  // And the screen still shows the picture, not a hole.
  for (let p = 0; p < width * height; p++) assert.deepEqual(frames[2][p], frames[0][p]);
});

test("the transparent index is bought from the palette, never stolen from a colour in use", () => {
  const width = 32;
  const height = 20;
  const frames = lockedCameraFrames(width, height, 4);
  // 129 requested is the trap: median cut can return exactly 128, and sizing
  // the colour table off the palette alone would leave no free index at all.
  for (const maxColors of [4, 64, 128, 129, 255, 256]) {
    const gif = encodeGif({ frames, width, height, delayCs: 8, maxColors, dither: false, diff: true });
    const { descriptors, gct } = decodeGifPixels(gif);
    const tIndex = descriptors[1].tIndex;
    assert.ok(tIndex < gct.length, `maxColors ${maxColors}: transparent index inside the table`);
    // One reserved index, the same one, for the whole animation — a per-frame
    // choice would mean a per-frame palette, and a hole would expose a colour
    // that means something else two frames later.
    const reserved = new Set(descriptors.slice(1).map((d) => d.tIndex));
    assert.equal(reserved.size, 1, `maxColors ${maxColors}: one reserved index throughout`);
    assert.equal([...reserved][0], tIndex);
  }
});

test("encodeGif refuses to write a transparent index a decoder could not read", () => {
  const width = 8;
  const height = 8;
  const frames = [bandedFrame(width, height, [[0, 0, 0], [255, 255, 255]])];
  // maxColors 2 while diffing leaves one colour and a hole — a solid plate,
  // not a picture. The floor at 3 is a guard, and it must hold.
  const gif = encodeGif({ frames, width, height, maxColors: 2, dither: false, diff: true });
  assert.equal(parseGifMeta(gif).ok, true);
});

test("ordered dither is position-deterministic — the property frame differencing stands on", () => {
  // Two identical tiles far apart must quantise identically, or an unchanged
  // pixel gets a new index next frame and the diff collapses. Floyd–Steinberg
  // cannot promise this; it diffuses error along the scanline.
  const width = 64;
  const height = 8;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Tiles at x∈[0,8) and x∈[32,40) are identical, 8px apart in Bayer phase.
      const v = 60 + ((x % 32) < 8 ? 37 : 150);
      rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255;
    }
  }
  const palette = _buildPalette([rgba], 8);
  const nearest = _makeNearest(palette);
  const idx = _indexFrame(rgba, width, height, palette, "ordered", nearest);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 8; x++) {
      assert.equal(idx[y * width + x], idx[y * width + 32 + x],
        `ordered dither must be a pure function of (x mod 8, y mod 8, colour) at ${x},${y}`);
    }
  }
});

// ---------------------------------------------------------------------------
// THE DOWNSCALE RUNG — v1's ladder had no size step at all, so its output was
// locked at whatever the capture happened to be.
// ---------------------------------------------------------------------------

test("the box filter is a true area average, and it refuses to invent pixels", () => {
  // 4x2 of known values -> 2x1: each output is the mean of its 2x2 block.
  const src = Buffer.alloc(4 * 2 * 4);
  const vals = [[0, 0, 0], [100, 100, 100], [200, 200, 200], [40, 40, 40],
    [10, 10, 10], [90, 90, 90], [210, 210, 210], [50, 50, 50]];
  vals.forEach((c, p) => {
    src[p * 4] = c[0]; src[p * 4 + 1] = c[1]; src[p * 4 + 2] = c[2]; src[p * 4 + 3] = 255;
  });
  const out = boxDownscaleRGBA(src, 4, 2, 2, 1);
  assert.equal(out.length, 2 * 4);
  assert.equal(out[0], Math.round((0 + 100 + 10 + 90) / 4));
  assert.equal(out[4], Math.round((200 + 40 + 210 + 50) / 4));
  assert.equal(out[3], 255, "alpha survives");
  // Same size is a pass-through, and upscaling is refused rather than faked.
  assert.equal(boxDownscaleRGBA(src, 4, 2, 4, 2), src);
  assert.throws(() => boxDownscaleRGBA(src, 4, 2, 8, 4), /downscale_only/);
});

test("the ladder shrinks the picture before it sacrifices the motion, and stretches the delay when it must drop frames", () => {
  const width = 64;
  const height = 40;
  const frames = lockedCameraFrames(width, height, 10);
  const full = encodeGif({ frames, width, height, delayCs: 8, maxColors: 255, dither: "ordered", diff: true });

  // A budget just under the full-size encode must be met by a SMALLER PICTURE,
  // with every frame still present.
  const squeezed = encodeWithinBudget({
    frames, width, height, delayCs: 8, maxBytes: full.length - 1, diff: true,
    ladder: [
      { width: 64, maxColors: 255, dither: "ordered", tol: 0 },
      { width: 32, maxColors: 255, dither: "ordered", tol: 0 },
      { width: 32, maxColors: 64, dither: "none", tol: 0, frameStride: 2 },
    ],
  });
  assert.ok(squeezed.gif, "a rung fits");
  assert.equal(squeezed.used.width, 32, "the downscale rung, not the frame-drop rung");
  assert.equal(squeezed.used.frames, 10, "frames go last — they are the product");
  assert.ok(squeezed.gif.length <= full.length - 1);
  const meta = parseGifMeta(squeezed.gif);
  assert.equal(meta.width, 32);
  assert.equal(meta.height, 20);
  assert.equal(meta.frameCount, 10);

  // Only when nothing else works do frames go — and then the delay stretches
  // so the loop keeps its length instead of playing at double speed.
  const strided = encodeWithinBudget({
    frames, width, height, delayCs: 8, maxBytes: 1200, diff: true,
    ladder: [
      { width: 64, maxColors: 255, dither: "ordered", tol: 0 },
      { width: 16, maxColors: 8, dither: "none", tol: 0, frameStride: 2 },
    ],
  });
  assert.ok(strided.gif, "the last rung fits");
  assert.equal(strided.used.frames, 5);
  assert.deepEqual([...new Set(parseGifMeta(strided.gif).delaysCs)], [16],
    "half the frames means twice the delay, or the loop runs at double speed");
});

test("nothing fits ⇒ nothing ships. The budget fails closed and reports the smallest it managed", () => {
  const width = 64;
  const height = 40;
  const frames = lockedCameraFrames(width, height, 10);
  const walk = encodeWithinBudget({
    frames, width, height, delayCs: 8, maxBytes: 64, diff: true, ladder: HERO_LADDER,
  });
  assert.equal(walk.gif, null, "an email must never carry a megabyte because the ladder ran out");
  assert.ok(walk.smallest > 64);
  assert.ok(walk.smallestRung.bytes === walk.smallest);
});

test("both ladders end smaller than they start, and the hero ladder never dithers Floyd–Steinberg", () => {
  for (const ladder of [HERO_LADDER, PAN_LADDER]) {
    const widths = ladder.map((r) => r.width);
    assert.ok(widths[0] === MOTION_DEFAULTS.targetWidth, "starts at the email thumbnail width");
    assert.ok(Math.min(...widths) < widths[0], "and has somewhere smaller to go");
    assert.equal(ladder.filter((r) => r.frameStride).length, 1, "exactly one frame-dropping rung");
    assert.ok(ladder[ladder.length - 1].frameStride, "and it is the last resort");
  }
  // Floyd–Steinberg costs +49% once frames are differenced (it re-rolls indices
  // in static content), so it has no place on the hero ladder at all.
  assert.equal(HERO_LADDER.filter((r) => r.dither === "floyd").length, 0);
});

// ---------------------------------------------------------------------------
// THE LOOP AND THE DEAD-HERO CHECK.
// ---------------------------------------------------------------------------

test("the tail crossfade closes the loop without spending a frame on it", () => {
  const width = 16;
  const height = 8;
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const b = Buffer.alloc(width * height * 4);
    b.fill(f * 30, 0, b.length);
    for (let i = 3; i < b.length; i += 4) b[i] = 255;
    frames.push(b);
  }
  const faded = crossfadeTail(frames, 4);
  assert.equal(faded.length, frames.length, "no frames are spent — the tail is re-blended in place");
  // The head is untouched; only the tail bends back toward frame 0.
  for (let i = 0; i < 4; i++) assert.ok(faded[i].equals(frames[i]), `head frame ${i} untouched`);
  const gap = (a, b) => Math.abs(a[0] - b[0]);
  assert.ok(gap(faded[7], faded[0]) < gap(frames[7], frames[0]),
    "the wrap must be smaller than it was, or the loop still stutters");
  // Monotonic approach: each of the last frames is closer to frame 0.
  assert.ok(gap(faded[7], faded[0]) < gap(faded[6], faded[0]));
  assert.ok(gap(faded[6], faded[0]) < gap(faded[5], faded[0]));
  // A crossfade wider than the sequence cannot eat the whole animation.
  assert.equal(crossfadeTail(frames, 99).length, frames.length);
  assert.ok(crossfadeTail(frames, 0)[7].equals(frames[7]));
});

test("a hero that does not move is measured as not moving — the fallback's whole trigger", () => {
  const width = 32;
  const height = 20;
  const still = bandedFrame(width, height, [[20, 30, 40], [200, 190, 180]]);
  const dead = [still, Buffer.from(still), Buffer.from(still), Buffer.from(still)];
  const deadMotion = sequenceMotion(dead);
  assert.equal(deadMotion.meanDelta, 0);
  assert.ok(deadMotion.meanDelta < MOTION_DEFAULTS.minMeanDelta,
    "a static <img> hero must fall back to the pan; a frozen GIF looks broken, not slow");

  const live = lockedCameraFrames(width, height, 6);
  const liveMotion = sequenceMotion(live);
  assert.equal(liveMotion.steps, 5);
  assert.ok(liveMotion.meanDelta > MOTION_DEFAULTS.minMeanDelta, "real motion clears the floor");
  assert.ok(liveMotion.minDelta > 0);

  // Degenerate inputs report zero rather than throwing mid-capture.
  assert.equal(sequenceMotion([]).meanDelta, 0);
  assert.equal(sequenceMotion([still]).steps, 0);
});

test("parseGifMeta refuses a frame rectangle that runs off the logical screen", () => {
  const width = 20;
  const height = 12;
  const frames = lockedCameraFrames(width, height, 3);
  const gif = encodeGif({ frames, width, height, delayCs: 8, maxColors: 64, dither: false, diff: true });
  assert.equal(parseGifMeta(gif).ok, true);
  // Corrupt the second frame's descriptor width and the parse must catch it:
  // a rectangle off the screen is a decoder crash in someone's inbox.
  const corrupted = Buffer.from(gif);
  const GCE = Buffer.from([0x21, 0xf9, 0x04]);
  const first = corrupted.indexOf(GCE, 13);
  const second = corrupted.indexOf(GCE, first + 8);
  const descriptor = second + 8; // the image descriptor follows its GCE
  assert.equal(corrupted[descriptor], 0x2c, "found the second frame's descriptor");
  corrupted.writeUInt16LE(width + 8, descriptor + 5);
  assert.equal(parseGifMeta(corrupted).ok, false);
});
