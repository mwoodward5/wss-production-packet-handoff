"use strict";

// test/png-decode.test.js
//
// WHY: measureAccent decoded images by shelling out to ffmpeg. ffmpeg is on a
// developer machine and is NOT in the serverless runtime, and no image decoder
// was ever a dependency — so in production every decode failed and every logo
// measured as null. The miner reported that as `accent_unmeasurable` and we
// read it as "this logo is greyscale". Measured: whitebirdfence.com's mark is
// #f78f1e at 63% share locally, rejected in production. That contradiction is
// what exposed it.
//
// These tests run with no binaries, which is the whole point: if they pass in
// CI they pass in the lambda.

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { decodePngToRgba } = require("../lib/png-decode");

/** Build a minimal, valid truecolour+alpha PNG from raw pixels. */
function makePng(width, height, rgba, { colorType = 6, depth = 8 } = {}) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = Buffer.alloc((width * ch + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * ch + 1)] = 0;                       // filter: none
    for (let x = 0; x < width * ch; x++) raw[y * (width * ch + 1) + 1 + x] = rgba[y * width * ch + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

test("decodes a truecolour+alpha PNG to straight RGBA", () => {
  // 2x1: one opaque orange pixel, one transparent.
  const px = Uint8Array.from([0xf7, 0x8f, 0x1e, 0xff, 0x00, 0x00, 0x00, 0x00]);
  const img = decodePngToRgba(makePng(2, 1, px));
  assert.ok(img, "should decode");
  assert.equal(img.width, 2);
  assert.equal(img.height, 1);
  assert.deepEqual([...img.data.slice(0, 4)], [0xf7, 0x8f, 0x1e, 0xff]);
  assert.equal(img.data[7], 0, "alpha is preserved, not flattened");
});

test("decodes truecolour without alpha, filling alpha opaque", () => {
  const px = Uint8Array.from([0x11, 0x22, 0x33]);
  const img = decodePngToRgba(makePng(1, 1, px, { colorType: 2 }));
  assert.deepEqual([...img.data], [0x11, 0x22, 0x33, 255]);
});

test("decodes greyscale, expanding to RGB", () => {
  const img = decodePngToRgba(makePng(1, 1, Uint8Array.from([0x40]), { colorType: 0 }));
  assert.deepEqual([...img.data], [0x40, 0x40, 0x40, 255]);
});

test("REFUSES rather than guesses: non-PNG, truncated, interlaced, 16-bit", () => {
  assert.equal(decodePngToRgba(Buffer.from("not a png at all")), null);
  assert.equal(decodePngToRgba(Buffer.alloc(4)), null);
  assert.equal(decodePngToRgba(null), null);
  assert.equal(decodePngToRgba("string"), null);

  // Interlaced: decoding without Adam7 would return scrambled pixels, and a
  // wrong colour on a client's site is worse than no colour.
  const inter = makePng(1, 1, Uint8Array.from([1, 2, 3, 255]));
  inter[8 + 8 + 12] = 1;                                  // IHDR interlace = 1
  assert.equal(decodePngToRgba(inter), null);

  const deep = makePng(1, 1, Uint8Array.from([1, 2, 3, 255]), { depth: 16 });
  assert.equal(decodePngToRgba(deep), null);
});

test("a corrupt IDAT is null, never a throw", () => {
  const good = makePng(1, 1, Uint8Array.from([1, 2, 3, 255]));
  const bad = Buffer.from(good);
  const idatAt = bad.indexOf(Buffer.from("IDAT", "ascii"));
  bad[idatAt + 6] = 0xff;                                 // corrupt the zlib stream
  assert.doesNotThrow(() => decodePngToRgba(bad));
  assert.equal(decodePngToRgba(bad), null);
});

test("runs with no external binary — the property that was actually broken", () => {
  // If this test can decode, so can a lambda: nothing here shells out.
  const px = Uint8Array.from([0xf7, 0x8f, 0x1e, 0xff]);
  assert.ok(decodePngToRgba(makePng(1, 1, px)), "decode must not depend on ffmpeg");
});
