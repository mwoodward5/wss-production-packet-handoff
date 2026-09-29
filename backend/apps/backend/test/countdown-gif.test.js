"use strict";

// The countdown GIF is only worth shipping if the bytes themselves prove out:
// these tests decode the actual GIF89a stream (own decoder, not the encoder's
// internals), composite the frames the way a mail client would, and read the
// digits back off the pixels by sampling the seven segment centers. "QC PASS is
// never proof" — so the assertion chain here is bytes -> pixels -> digits.

const test = require("node:test");
const assert = require("node:assert");

const {
  COLORS,
  DIGITS_Y,
  DIGIT_GAP,
  DIGIT_W,
  FRAME_DELAY_CS,
  GLOBAL_PALETTE,
  HEIGHT,
  SEGMENTS_BY_DIGIT,
  SEGMENT_RECTS,
  WIDTH,
  groupX,
  renderCountdownGif,
  sanitizeLabel,
} = require("../lib/countdown-gif");
const handler = require("../api/countdown");
const { buildCountdownUrl } = require("../api/countdown");
const { PALETTE } = require("../lib/wss-email-design");

// ------------------------------------------------- a standalone GIF decoder

function lzwDecode(minCodeSize, bytes, pixelCount) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let next = eoi + 1;
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    next = eoi + 1;
    size = minCodeSize + 1;
  };
  reset();

  let bitPos = 0;
  const readCode = () => {
    let v = 0;
    for (let b = 0; b < size; b++) {
      v |= ((bytes[bitPos >> 3] >> (bitPos & 7)) & 1) << b;
      bitPos++;
    }
    return v;
  };

  const out = [];
  let prev = -1;
  while (out.length < pixelCount) {
    const code = readCode();
    if (code === clear) {
      reset();
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    let seq;
    if (code < next && dict[code]) seq = dict[code];
    else {
      assert.strictEqual(code, next, `LZW code ${code} out of range (next=${next})`);
      seq = dict[prev].concat(dict[prev][0]);
    }
    out.push(...seq);
    if (prev >= 0) {
      dict[next++] = dict[prev].concat(seq[0]);
      if (next >= 1 << size && size < 12) size++;
    }
    prev = code;
  }
  return out;
}

/** Parse a GIF89a buffer into screen size, palette, and raw frames. */
function parseGif(buf) {
  assert.strictEqual(buf.subarray(0, 6).toString("ascii"), "GIF89a");
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10];
  assert.ok(packed & 0x80, "expected a global color table");
  const gctSize = 2 << (packed & 0x07);
  let pos = 13;
  const palette = [];
  for (let i = 0; i < gctSize; i++) {
    palette.push([buf[pos], buf[pos + 1], buf[pos + 2]]);
    pos += 3;
  }

  const frames = [];
  let gce = null;
  while (pos < buf.length) {
    const b = buf[pos++];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      const extLabel = buf[pos++];
      if (extLabel === 0xf9) {
        const blockSize = buf[pos++];
        assert.strictEqual(blockSize, 4);
        gce = {
          disposal: (buf[pos] >> 2) & 0x07,
          transparentFlag: buf[pos] & 0x01,
          delayCs: buf.readUInt16LE(pos + 1),
          transparentIndex: buf[pos + 3],
        };
        pos += 4;
        assert.strictEqual(buf[pos++], 0x00);
      } else {
        // skip any other extension's sub-blocks
        let len = buf[pos++];
        while (len !== 0) {
          pos += len;
          len = buf[pos++];
        }
      }
      continue;
    }
    assert.strictEqual(b, 0x2c, `unexpected block 0x${b.toString(16)} at ${pos - 1}`);
    const left = buf.readUInt16LE(pos);
    const top = buf.readUInt16LE(pos + 2);
    const w = buf.readUInt16LE(pos + 4);
    const h = buf.readUInt16LE(pos + 6);
    const localPacked = buf[pos + 8];
    assert.strictEqual(localPacked & 0x80, 0, "no local color tables expected");
    pos += 9;
    const minCodeSize = buf[pos++];
    const dataBytes = [];
    let len = buf[pos++];
    while (len !== 0) {
      for (let i = 0; i < len; i++) dataBytes.push(buf[pos + i]);
      pos += len;
      len = buf[pos++];
    }
    const pixels = lzwDecode(minCodeSize, dataBytes, w * h);
    assert.strictEqual(pixels.length, w * h, "decoded pixel count");
    frames.push({ left, top, width: w, height: h, pixels, ...gce });
    gce = null;
  }
  return { width, height, palette, frames };
}

/** Composite frames the way a viewer does (disposal 1 = do not dispose). */
function compositeFrames(gif) {
  const canvases = [];
  const canvas = new Uint8Array(gif.width * gif.height);
  for (const frame of gif.frames) {
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const idx = frame.pixels[y * frame.width + x];
        if (frame.transparentFlag && idx === frame.transparentIndex) continue;
        canvas[(frame.top + y) * gif.width + frame.left + x] = idx;
      }
    }
    canvases.push(Uint8Array.from(canvas));
  }
  return canvases;
}

// -------------------------------- read the clock back off the actual pixels

const DIGIT_BY_SEGMENT_KEY = new Map(
  SEGMENTS_BY_DIGIT.map((segs, digit) => [segs.split("").sort().join(""), digit]),
);

function readDigit(canvas, x, y) {
  const lit = [];
  for (const [name, [sx, sy, sw, sh]] of Object.entries(SEGMENT_RECTS)) {
    const sampleX = x + Math.floor(sx + sw / 2);
    const sampleY = y + Math.floor(sy + sh / 2);
    const idx = canvas[sampleY * WIDTH + sampleX];
    if (idx === COLORS.INK) lit.push(name);
    else assert.strictEqual(idx, COLORS.GHOST, `segment ${name} at ${sampleX},${sampleY} is neither lit nor ghost`);
  }
  const digit = DIGIT_BY_SEGMENT_KEY.get(lit.sort().join(""));
  assert.notStrictEqual(digit, undefined, `unrecognized segment pattern ${lit.join("")}`);
  return digit;
}

function readClock(canvas) {
  const values = [];
  for (let i = 0; i < 4; i++) {
    const gx = groupX(i);
    const tens = readDigit(canvas, gx, DIGITS_Y);
    const ones = readDigit(canvas, gx + DIGIT_W + DIGIT_GAP, DIGITS_Y);
    values.push(tens * 10 + ones);
  }
  return values; // [days, hours, minutes, seconds]
}

function countColor(canvas, color) {
  let n = 0;
  for (const idx of canvas) if (idx === color) n++;
  return n;
}

// ------------------------------------------------------------------- tests

const NOW = Date.parse("2026-08-07T17:00:00.000Z");
const SEVEN_DAYS = 7 * 86400e3;

test("a 7-day countdown decodes to 60 one-second frames showing the true remaining time", () => {
  const gif = renderCountdownGif({ until: NOW + SEVEN_DAYS, now: NOW, label: "preview" });
  assert.ok(gif.length < 300 * 1024, `GIF must stay under 300KB, got ${gif.length}`);

  const parsed = parseGif(gif);
  assert.strictEqual(parsed.width, WIDTH);
  assert.strictEqual(parsed.height, HEIGHT);
  assert.strictEqual(parsed.frames.length, 60);
  for (const frame of parsed.frames) {
    assert.strictEqual(frame.delayCs, FRAME_DELAY_CS, "each frame is one real second");
    assert.strictEqual(frame.disposal, 1, "do-not-dispose so partial frames stack");
  }
  assert.strictEqual(parsed.frames[0].width, WIDTH, "first frame paints the full panel");
  assert.ok(
    parsed.frames[1].width * parsed.frames[1].height < WIDTH * HEIGHT,
    "later frames only repaint what changed",
  );

  const canvases = compositeFrames(parsed);
  assert.deepStrictEqual(readClock(canvases[0]), [7, 0, 0, 0], "first frame = true remaining time");
  assert.deepStrictEqual(readClock(canvases[1]), [6, 23, 59, 59], "second frame is one second later");
  assert.deepStrictEqual(readClock(canvases[59]), [6, 23, 59, 1], "last frame = first minus 59s");
});

test("every color in the stream is a brand token from wss-email-design", () => {
  const gif = renderCountdownGif({ until: NOW + SEVEN_DAYS, now: NOW });
  const parsed = parseGif(gif);

  const hex = ([r, g, b]) =>
    `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  assert.strictEqual(hex(parsed.palette[COLORS.PANEL]), PALETTE.inkPanel);
  assert.strictEqual(hex(parsed.palette[COLORS.INK]), PALETTE.inkPanelInk);
  assert.strictEqual(hex(parsed.palette[COLORS.ACCENT]), PALETTE.accent);
  assert.strictEqual(hex(parsed.palette[COLORS.MUTED]), PALETTE.inkPanelMuted);
  assert.strictEqual(hex(parsed.palette[COLORS.GHOST]), PALETTE.inkPanelLine);
  assert.strictEqual(hex(parsed.palette[COLORS.DANGER]), PALETTE.danger);
  assert.deepStrictEqual(
    GLOBAL_PALETTE.slice(1, 7).map(hex),
    [PALETTE.inkPanel, PALETTE.inkPanelInk, PALETTE.accent, PALETTE.inkPanelMuted, PALETTE.inkPanelLine, PALETTE.danger],
  );

  for (const frame of parsed.frames) {
    for (const idx of frame.pixels) {
      assert.ok(idx >= 0 && idx <= COLORS.DANGER, `pixel index ${idx} outside the brand palette`);
    }
  }
});

test("a passed deadline renders a single static expired card, never negative numbers", () => {
  const gif = renderCountdownGif({ until: NOW - 1000, now: NOW, label: "preview" });
  const parsed = parseGif(gif);
  assert.strictEqual(parsed.frames.length, 1);

  const [canvas] = compositeFrames(parsed);
  assert.strictEqual(countColor(canvas, COLORS.GHOST), 0, "no seven-segment digits on the expired card");
  assert.strictEqual(countColor(canvas, COLORS.ACCENT), 0, "no unit labels on the expired card");
  assert.ok(countColor(canvas, COLORS.DANGER) > 0, "the danger rule marks the card as expired");
  assert.ok(countColor(canvas, COLORS.INK) > 0, "the EXPIRED text is drawn");
});

test("a deadline inside the 60s window counts to zero then holds on the expired card", () => {
  const gif = renderCountdownGif({ until: NOW + 5500, now: NOW });
  const parsed = parseGif(gif);
  assert.strictEqual(parsed.frames.length, 7, "5..0 plus the expired card");

  const canvases = compositeFrames(parsed);
  assert.deepStrictEqual(readClock(canvases[0]), [0, 0, 0, 5]);
  assert.deepStrictEqual(readClock(canvases[5]), [0, 0, 0, 0]);
  const last = canvases[6];
  assert.ok(countColor(last, COLORS.DANGER) > 0, "final frame is the expired card");
  assert.strictEqual(parsed.frames[6].delayCs, 0, "the expired card holds");
});

test("the /api/countdown handler serves image/gif with no-store, and 400s on garbage", async () => {
  const call = async (query) => {
    const headers = {};
    let status = 0;
    let body = null;
    const res = {
      setHeader: (k, v) => {
        headers[k.toLowerCase()] = v;
      },
      end: (b) => {
        body = b;
      },
      get statusCode() {
        return status;
      },
      set statusCode(v) {
        status = v;
      },
    };
    await handler({ query }, res);
    return { status, headers, body };
  };

  const ok = await call({ until: new Date(NOW + SEVEN_DAYS).toISOString(), now: String(NOW) });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.headers["content-type"], "image/gif");
  assert.ok(ok.headers["cache-control"].includes("no-store"), "every open must re-render");
  assert.strictEqual(ok.body.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.strictEqual(Number(ok.headers["content-length"]), ok.body.length);
  const clock = readClock(compositeFrames(parseGif(ok.body))[0]);
  assert.deepStrictEqual(clock, [7, 0, 0, 0]);

  const bad = await call({ until: "not-a-date" });
  assert.strictEqual(bad.status, 400);
  const missing = await call({});
  assert.strictEqual(missing.status, 400);
});

test("labels are sanitized and the composer URL is well-formed", () => {
  assert.strictEqual(sanitizeLabel("preview"), "PREVIEW");
  assert.strictEqual(sanitizeLabel(""), "PREVIEW");
  assert.strictEqual(sanitizeLabel("<script>alert(1)</script>"), "SCRIPTALERT1");
  assert.strictEqual(sanitizeLabel("a".repeat(50)).length, 12);

  const url = buildCountdownUrl(NOW + SEVEN_DAYS);
  assert.ok(url.startsWith("https://ghost.wss-ai.com/api/countdown?until="));
  assert.ok(url.includes("label=preview"));
  const parsed = new URL(url);
  assert.ok(Number.isFinite(Date.parse(parsed.searchParams.get("until"))));
});
