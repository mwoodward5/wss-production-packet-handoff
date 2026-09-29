"use strict";

// A tasteful 7-day countdown that actually ticks.
//
// Email cannot run JavaScript, but an animated GIF regenerated per open can
// genuinely count down: every open of /api/countdown re-renders ~60 frames, one
// per second, starting from the TRUE remaining time. A client that only shows
// the first frame (old Outlook) still sees the correct remaining time frozen.
//
// Everything here is drawn from lib/wss-email-design.js tokens — the ink panel,
// the accent labels, the muted colons. Digits are 7-segment blocks (the closest
// a hand-built bitmap gets to FONT_MONO), with unlit segments ghosted in
// inkPanelLine so the display reads as a real instrument, not floating shapes.
//
// The GIF89a encoder below is pure JS (no native image deps exist in this
// node_modules, verified). Frames after the first encode only the bounding box
// of pixels that changed (disposal "do not dispose"), which is what keeps a
// 60-frame file far under the 300KB budget.

const { PALETTE } = require("./wss-email-design");

// ------------------------------------------------------------------ palette

function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Index 0 is the transparent key (rounded corners); it must never be visible,
// so its RGB is an arbitrary sentinel. Indices 1..6 are the brand tokens.
const COLORS = Object.freeze({
  TRANSPARENT: 0,
  PANEL: 1, // PALETTE.inkPanel   — the dark card background
  INK: 2, // PALETTE.inkPanelInk — lit digit segments
  ACCENT: 3, // PALETTE.accent     — DAYS / HRS / MIN / SEC labels
  MUTED: 4, // PALETTE.inkPanelMuted — eyebrow line + colons
  GHOST: 5, // PALETTE.inkPanelLine  — unlit segments
  DANGER: 6, // PALETTE.danger     — the rule under "EXPIRED"
});

const GLOBAL_PALETTE = [
  [255, 0, 255], // 0 transparent key, never shown
  hexToRgb(PALETTE.inkPanel),
  hexToRgb(PALETTE.inkPanelInk),
  hexToRgb(PALETTE.accent),
  hexToRgb(PALETTE.inkPanelMuted),
  hexToRgb(PALETTE.inkPanelLine),
  hexToRgb(PALETTE.danger),
  [0, 0, 0], // 7 pad — global color table sizes are powers of two
];

// ------------------------------------------------------------------- layout

const WIDTH = 440;
const HEIGHT = 150;
const CORNER_RADIUS = 18;

const DIGIT_W = 32;
const DIGIT_H = 52;
const SEG_T = 6; // segment thickness
const DIGIT_GAP = 8; // between the two digits of a group
const GROUP_W = DIGIT_W * 2 + DIGIT_GAP; // 72
const COLON_W = 24;
const STRIP_W = GROUP_W * 4 + COLON_W * 3; // 360
const STRIP_X = (WIDTH - STRIP_W) / 2; // 40
const DIGITS_Y = 52;
const EYEBROW_Y = 20;
const UNIT_LABEL_Y = 116;

// --------------------------------------------------------- 7-segment digits

// Segment order: A top, B top-right, C bottom-right, D bottom, E bottom-left,
// F top-left, G middle.
const SEGMENTS_BY_DIGIT = [
  "ABCDEF", // 0
  "BC", // 1
  "ABGED", // 2
  "ABGCD", // 3
  "FGBC", // 4
  "AFGCD", // 5
  "AFGEDC", // 6
  "ABC", // 7
  "ABCDEFG", // 8
  "ABCDFG", // 9
];

// Rectangles for each segment inside a DIGIT_W x DIGIT_H cell.
function segmentRects() {
  const W = DIGIT_W;
  const H = DIGIT_H;
  const t = SEG_T;
  const midY = (H - t) / 2;
  const vTopH = midY - t;
  const vBotY = midY + t;
  const vBotH = H - t - vBotY;
  return {
    A: [t, 0, W - 2 * t, t],
    B: [W - t, t, t, vTopH],
    C: [W - t, vBotY, t, vBotH],
    D: [t, H - t, W - 2 * t, t],
    E: [0, vBotY, t, vBotH],
    F: [0, t, t, vTopH],
    G: [t, midY, W - 2 * t, t],
  };
}
const SEGMENT_RECTS = segmentRects();

// ------------------------------------------------------------ 5x7 bitmap font

const FONT_5X7 = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", "..#..", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  0: [".###.", "#..##", "#.#.#", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "#####"],
  2: [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
  3: [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: [".###.", "#....", "####.", "#...#", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

// -------------------------------------------------------------- frame buffer

function makeFrame() {
  const px = new Uint8Array(WIDTH * HEIGHT); // starts all TRANSPARENT (0)
  return px;
}

function fillRect(px, x, y, w, h, color) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(WIDTH, Math.round(x + w));
  const y1 = Math.min(HEIGHT, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    px.fill(color, yy * WIDTH + x0, yy * WIDTH + x1);
  }
}

/** The ink panel with rounded corners; outside the radius stays transparent. */
function drawPanel(px) {
  const r = CORNER_RADIUS;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const cx = x < r ? r - 0.5 - x : x >= WIDTH - r ? x - (WIDTH - r - 0.5) : 0;
      const cy = y < r ? r - 0.5 - y : y >= HEIGHT - r ? y - (HEIGHT - r - 0.5) : 0;
      if (cx > 0 && cy > 0 && cx * cx + cy * cy > r * r) continue;
      px[y * WIDTH + x] = COLORS.PANEL;
    }
  }
}

function drawSevenSegDigit(px, x, y, digit, litColor) {
  const lit = SEGMENTS_BY_DIGIT[digit] || "";
  for (const name of Object.keys(SEGMENT_RECTS)) {
    const [sx, sy, sw, sh] = SEGMENT_RECTS[name];
    fillRect(px, x + sx, y + sy, sw, sh, lit.includes(name) ? litColor : COLORS.GHOST);
  }
}

function textWidth(text, scale, tracking) {
  const advance = 5 * scale + tracking;
  return text.length * advance - tracking;
}

function drawText(px, x, y, text, scale, color, tracking) {
  const advance = 5 * scale + tracking;
  let cx = Math.round(x);
  for (const ch of text) {
    const glyph = FONT_5X7[ch] || FONT_5X7[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === "#") {
          fillRect(px, cx + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cx += advance;
  }
}

function drawTextCentered(px, y, text, scale, color, tracking) {
  drawText(px, (WIDTH - textWidth(text, scale, tracking)) / 2, y, text, scale, color, tracking);
}

// ------------------------------------------------------------- compositions

const GROUP_LABELS = ["DAYS", "HRS", "MIN", "SEC"];

function groupX(i) {
  return STRIP_X + i * (GROUP_W + COLON_W);
}

/** One full countdown frame for a remaining time of `total` whole seconds. */
function renderClockFrame(total, eyebrowText) {
  const px = makeFrame();
  drawPanel(px);
  drawTextCentered(px, EYEBROW_Y, eyebrowText, 2, COLORS.MUTED, 4);

  const days = Math.min(99, Math.floor(total / 86400));
  const hrs = Math.floor((total % 86400) / 3600);
  const min = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const values = [days, hrs, min, sec];

  for (let i = 0; i < 4; i++) {
    const gx = groupX(i);
    drawSevenSegDigit(px, gx, DIGITS_Y, Math.floor(values[i] / 10), COLORS.INK);
    drawSevenSegDigit(px, gx + DIGIT_W + DIGIT_GAP, DIGITS_Y, values[i] % 10, COLORS.INK);
    const label = GROUP_LABELS[i];
    drawText(px, gx + (GROUP_W - textWidth(label, 2, 2)) / 2, UNIT_LABEL_Y, label, 2, COLORS.ACCENT, 2);
    if (i < 3) {
      const dotX = gx + GROUP_W + (COLON_W - SEG_T) / 2;
      fillRect(px, dotX, DIGITS_Y + 15, SEG_T, SEG_T, COLORS.MUTED);
      fillRect(px, dotX, DIGITS_Y + 31, SEG_T, SEG_T, COLORS.MUTED);
    }
  }
  return px;
}

/** The static frame shown once the deadline has passed. */
function renderExpiredFrame(labelText) {
  const px = makeFrame();
  drawPanel(px);
  const text = `${labelText} EXPIRED`;
  drawTextCentered(px, 58, text, 3, COLORS.INK, 3);
  const ruleW = 44;
  fillRect(px, (WIDTH - ruleW) / 2, 96, ruleW, 4, COLORS.DANGER);
  return px;
}

// ------------------------------------------------------------ GIF89a writer

function u16(arr, v) {
  arr.push(v & 0xff, (v >> 8) & 0xff);
}

/**
 * GIF-flavoured LZW, transcribed from the reference algorithm: variable code
 * width starting at minCodeSize+1, clear code emitted up front and again if the
 * table fills at 4096.
 */
function lzwEncode(minCodeSize, pixels) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let table = new Map();

  const out = [];
  let cur = 0;
  let curBits = 0;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) {
      out.push(cur & 0xff);
      cur >>= 8;
      curBits -= 8;
    }
  };

  emit(clearCode);
  let chain = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = (chain << 8) | k;
    const found = table.get(key);
    if (found !== undefined) {
      chain = found;
      continue;
    }
    emit(chain);
    if (nextCode === 4096) {
      emit(clearCode);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
      table = new Map();
    } else {
      if (nextCode >= 1 << codeSize) codeSize++;
      table.set(key, nextCode++);
    }
    chain = k;
  }
  emit(chain);
  emit(eoiCode);
  if (curBits > 0) out.push(cur & 0xff);
  return out;
}

function pushImageData(bytes, minCodeSize, encoded) {
  bytes.push(minCodeSize);
  for (let i = 0; i < encoded.length; i += 255) {
    const chunk = encoded.slice(i, i + 255);
    bytes.push(chunk.length, ...chunk);
  }
  bytes.push(0);
}

/**
 * frames: [{ px, delayCs, left, top, width, height }] where px is the indexed
 * sub-rectangle. Disposal is "do not dispose" so partial frames paint over the
 * previous state; index 0 is transparent in every frame.
 */
function encodeGif(frames) {
  const bytes = [];
  // Header + logical screen descriptor
  for (const c of "GIF89a") bytes.push(c.charCodeAt(0));
  u16(bytes, WIDTH);
  u16(bytes, HEIGHT);
  bytes.push(0xf2, 0, 0); // GCT present, 8 colours; bg index 0; square pixels
  for (const [r, g, b] of GLOBAL_PALETTE) bytes.push(r, g, b);

  for (const frame of frames) {
    // Graphic control: disposal=1 (do not dispose), transparent index 0
    bytes.push(0x21, 0xf9, 0x04, 0x05);
    u16(bytes, frame.delayCs);
    bytes.push(0x00, 0x00);
    // Image descriptor
    bytes.push(0x2c);
    u16(bytes, frame.left);
    u16(bytes, frame.top);
    u16(bytes, frame.width);
    u16(bytes, frame.height);
    bytes.push(0x00); // no local colour table
    pushImageData(bytes, 3, lzwEncode(3, frame.px));
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

/** Bounding box of pixels that differ between two full frames. */
function diffBox(prev, next) {
  let minX = WIDTH;
  let minY = HEIGHT;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < HEIGHT; y++) {
    const row = y * WIDTH;
    for (let x = 0; x < WIDTH; x++) {
      if (prev[row + x] !== next[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function cropFrame(full, box) {
  const out = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) {
    const src = (box.top + y) * WIDTH + box.left;
    out.set(full.subarray(src, src + box.width), y * box.width);
  }
  return out;
}

// ---------------------------------------------------------------- public API

const MAX_FRAMES = 60;
const FRAME_DELAY_CS = 100; // one real second per frame

function sanitizeLabel(raw) {
  const cleaned = String(raw || "preview")
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, "")
    .trim()
    .slice(0, 12);
  return cleaned || "PREVIEW";
}

/**
 * Render the countdown GIF.
 *  - until: ms epoch of the deadline
 *  - now:   ms epoch of "now" (defaults to Date.now())
 *  - label: e.g. "preview" -> eyebrow "PREVIEW ENDS IN", expired "PREVIEW EXPIRED"
 * Counts the next 60 seconds down from the true remaining time; if the deadline
 * falls inside that window the last frame is the expired card, and once the
 * deadline has passed the whole GIF is the single static expired card.
 */
function renderCountdownGif({ until, now = Date.now(), label = "preview" } = {}) {
  const cleanLabel = sanitizeLabel(label);
  const remaining = Math.floor((until - now) / 1000);

  const fullFrames = [];
  if (remaining <= 0) {
    fullFrames.push({ px: renderExpiredFrame(cleanLabel), delayCs: 0 });
  } else {
    const eyebrowText = `${cleanLabel} ENDS IN`;
    const ticks = Math.min(MAX_FRAMES, remaining + 1); // remaining .. remaining-ticks+1
    for (let f = 0; f < ticks; f++) {
      fullFrames.push({ px: renderClockFrame(remaining - f, eyebrowText), delayCs: FRAME_DELAY_CS });
    }
    if (remaining < MAX_FRAMES) {
      // The deadline lands inside this window: end on the expired card and hold.
      fullFrames.push({ px: renderExpiredFrame(cleanLabel), delayCs: 0 });
    }
  }

  const frames = [];
  for (let i = 0; i < fullFrames.length; i++) {
    const { px, delayCs } = fullFrames[i];
    if (i === 0) {
      frames.push({ px, delayCs, left: 0, top: 0, width: WIDTH, height: HEIGHT });
      continue;
    }
    const box = diffBox(fullFrames[i - 1].px, px) || { left: 0, top: 0, width: 1, height: 1 };
    frames.push({ px: cropFrame(px, box), delayCs, ...box });
  }
  // No loop extension on purpose: the GIF plays once and holds its final frame,
  // so it never wraps back to a stale higher number.
  return encodeGif(frames);
}

module.exports = {
  COLORS,
  DIGITS_Y,
  DIGIT_GAP,
  DIGIT_H,
  DIGIT_W,
  FRAME_DELAY_CS,
  GLOBAL_PALETTE,
  HEIGHT,
  MAX_FRAMES,
  SEGMENTS_BY_DIGIT,
  SEGMENT_RECTS,
  WIDTH,
  groupX,
  renderCountdownGif,
  sanitizeLabel,
};
