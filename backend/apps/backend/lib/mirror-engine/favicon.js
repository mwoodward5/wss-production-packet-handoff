"use strict";

// lib/mirror-engine/favicon.js — the tab icon is part of the client's identity.
//
// MEASURED 2026-08-10: wss-test-sears-heating-and-cooling-columbus and
// wss-test-air-creation-heating-and-cooling-llc-baton served a BYTE-IDENTICAL
// /favicon.ico — md5 prefix 9f504444, 20373 bytes. Two unrelated companies in
// different states flying the same flag in the browser tab. Those bytes are the
// DONOR's favicon (both donors came from Lovable): donors-clean/hvac-premier
// and donors-clean/salon-lacquer-studio ship the same file, and the engine
// copied it through untouched because nothing here ever looked at it.
//
// This is the manufacturer-badge defect class the header mark already fails
// closed on (lib/mirror-engine/engine.js, brand_logo_unreferenced): someone
// else's mark presented as the client's identity. The header was fixed; the tab
// was not, because a favicon is requested by PATH, not by markup — see PURGE.
//
// THREE RULES, in the order they matter:
//
// 1. DERIVE FROM THE CLIENT'S OWN VERIFIED LOGO. The same bytes the header
//    renders, carrying the same ownership binding (SSRF guard, third-party-mark
//    denylist, magic-byte sniff, sha256 pin in brand-assets.js). No second
//    fetch, no second source of truth.
//
// 2. TRUTH LAW. With no verified logo we do NOT fall back to the donor's icon
//    and we do NOT invent a mark. A neutral monogram cut from the business
//    name, or no icon at all. A borrowed favicon is the bug — replacing it with
//    a DIFFERENT borrowed thing is the same bug.
//
// 3. PURGE, don't merely unlink. This is the subtle part and the reason the
//    defect survived a header fix: browsers request /favicon.ico with no link
//    tag at all, so an unreferenced donor file is still SERVED. Rewriting the
//    <link> tags alone would have left 9f504444 live on every mirror. The donor
//    file has to leave the output tree, and the proof is a fetch of the path,
//    not a read of the markup.
//
// RUNTIME CONSTRAINT: pure JS + node builtins only. ffmpeg is on a developer
// machine and is NOT in the serverless runtime — lib/mirror-engine/brand-assets.js
// documents that trap (measureAccent returned null for every logo in production
// for exactly this reason). So: zlib for PNG encoding, a hand-rolled ICO
// container, an area-average resampler, and a bitmap font. Nothing shells out.

const zlib = require("node:zlib");
const { createHash } = require("node:crypto");
const { decodePngToRgba } = require("../png-decode");

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_SIZES = [16, 32, 48];
const APPLE_SIZE = 180;
const MANIFEST_SIZES = [192, 512];

/* ------------------------------------------------------------------ PNG out */

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(buf) {
  const t = crcTable();
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode 8-bit RGBA into a PNG. Filter type 0 throughout — deterministic. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    const start = y * stride;
    for (let i = 0; i < stride; i++) raw[p++] = rgba[start + i];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Wrap PNGs in an ICO container.
 *
 * PNG-compressed ICO entries are what every browser released this decade
 * expects; the alternative (BMP + AND mask) buys nothing but bytes. Dimension
 * 256 is encoded as 0 by the format — irrelevant at our sizes, kept honest.
 */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const b = i * 16;
    dir[b] = e.size >= 256 ? 0 : e.size;
    dir[b + 1] = e.size >= 256 ? 0 : e.size;
    dir.writeUInt16LE(1, b + 4); // colour planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/* ------------------------------------------------------------ raster helpers */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Perceptual luminance, 0..1. Decides ink colour over a given tile. */
function lum({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Fit source RGBA into a square canvas, preserving aspect ratio.
 *
 * A wordmark is usually 5:1, so it MUST be letterboxed rather than squashed —
 * a stretched mark is a different mark. Downsampling is an area average over
 * the source box (premultiplied, so transparent pixels cannot drag the colour
 * toward black), which is what keeps a 600px logo legible at 16px.
 */
function squareFit(src, sw, sh, size, background) {
  const out = new Uint8Array(size * size * 4);
  const bg = background ? hexToRgb(background) : null;
  if (bg) {
    for (let i = 0; i < size * size; i++) {
      out[i * 4] = bg.r; out[i * 4 + 1] = bg.g; out[i * 4 + 2] = bg.b; out[i * 4 + 3] = 255;
    }
  }
  // Inset slightly: a mark flush to the tile edge reads as clipped.
  const box = Math.max(1, Math.round(size * 0.92));
  const scale = Math.min(box / sw, box / sh);
  const dw = Math.max(1, Math.min(size, Math.round(sw * scale)));
  const dh = Math.max(1, Math.min(size, Math.round(sh * scale)));
  const ox = Math.floor((size - dw) / 2);
  const oy = Math.floor((size - dh) / 2);

  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor((y * sh) / dh);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor((x * sw) / dw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = sy0; yy < sy1 && yy < sh; yy++) {
        for (let xx = sx0; xx < sx1 && xx < sw; xx++) {
          const i = (yy * sw + xx) * 4;
          const al = src[i + 3];
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al;
          a += al; n++;
        }
      }
      if (!n) continue;
      const alpha = a / n / 255;
      const R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0;
      const o = ((oy + y) * size + (ox + x)) * 4;
      if (bg) {
        out[o] = Math.round(R * alpha + bg.r * (1 - alpha));
        out[o + 1] = Math.round(G * alpha + bg.g * (1 - alpha));
        out[o + 2] = Math.round(B * alpha + bg.b * (1 - alpha));
        out[o + 3] = 255;
      } else {
        out[o] = Math.round(R);
        out[o + 1] = Math.round(G);
        out[o + 2] = Math.round(B);
        out[o + 3] = Math.round(alpha * 255);
      }
    }
  }
  return out;
}

/* --------------------------------------------------- finding the square mark */

// A favicon is a SQUARE at 16 pixels. Most business logos are horizontal
// wordmarks at 4:1 or worse, and letterboxing one into that square yields a
// three-pixel coloured dash — technically the client's own pixels, visually
// nothing. Rendered and looked at, that is obviously not a tab icon.
//
// So: find the part of their mark that IS square. Three outcomes, in order,
// and none of them distorts or invents anything:
//
//   1. trim the transparent margin — nearly always enough on its own;
//   2. if a symbol sits beside the words (the common "logo + name" lockup),
//      crop to the symbol — still entirely their artwork;
//   3. if what remains is still far too wide, this logo has no square form.
//      Say so and let the caller fall back to the monogram, rather than ship
//      an illegible smear and call it branding.

const ALPHA_FLOOR = 8;

function alphaBounds(src, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[(y * w + x) * 4 + 3] <= ALPHA_FLOOR) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function cropRgba(src, w, { x0, y0, x1, y1 }) {
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const from = ((y0 + y) * w + x0) * 4;
    out.set(src.subarray(from, from + cw * 4), y * cw * 4);
  }
  return { data: out, width: cw, height: ch };
}

/**
 * Crop a "symbol + wordmark" lockup down to the symbol.
 *
 * THE DISCRIMINATOR IS GUTTER WIDTH, NOT GUTTER PRESENCE. A wordmark is full of
 * gaps — one between every letter — so "split at the first gap wide enough"
 * crops to the first LETTER and ships a meaningless fragment as the client's
 * mark. Caught by rendering the sheet, not by any check: a pure wordmark
 * reported `symbol_cropped` and looked plausible in the report.
 *
 * A real lockup separates its symbol from its words by a gutter markedly wider
 * than the letter spacing. So the split is only taken when the largest gap
 * dominates every other gap. Even letter spacing throughout means there is no
 * symbol, and null is the correct answer.
 */
const GUTTER_DOMINANCE = 1.8;

function findSymbol(img) {
  const { data, width: w, height: h } = img;
  const ink = new Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_FLOOR) ink[x]++;
    }
  }

  // Interior runs of empty columns only — leading/trailing space is margin.
  const gaps = [];
  let run = 0;
  for (let x = 0; x < w; x++) {
    if (ink[x] === 0) { run++; continue; }
    if (run > 0 && x - run > 0) gaps.push({ start: x - run, end: x - 1, len: run });
    run = 0;
  }
  if (!gaps.length) return null;

  const sorted = [...gaps].sort((a, b) => b.len - a.len);
  const widest = sorted[0];
  const runnerUp = sorted[1];
  if (runnerUp && widest.len < runnerUp.len * GUTTER_DOMINANCE) return null;
  if (widest.len < Math.max(2, Math.round(w * 0.03))) return null;

  // Try the side the symbol usually sits on, then the other one.
  const candidates = [
    { x0: 0, x1: widest.start - 1 },
    { x0: widest.end + 1, x1: w - 1 },
  ];
  for (const box of candidates) {
    if (box.x1 - box.x0 < 7) continue;
    const block = cropRgba(data, w, { ...box, y0: 0, y1: h - 1 });
    const tight = alphaBounds(block.data, block.width, block.height);
    if (!tight) continue;
    const sym = cropRgba(block.data, block.width, tight);
    const aspect = sym.width / sym.height;
    if (aspect < 0.5 || aspect > 1.8) continue;
    if (sym.width < 8 || sym.height < 8) continue;
    // A symbol stands as tall as the lockup; a stray fragment does not.
    if (sym.height < h * 0.5) continue;
    return sym;
  }
  return null;
}

// Beyond this the mark cannot read as a 16px icon whatever we do with it.
const MAX_ICON_ASPECT = 2.2;

/**
 * Reduce a decoded logo to the square-ish artwork an icon can use.
 * Returns null when the logo has no such form — the honest answer.
 */
function squareMark(img) {
  const bounds = alphaBounds(img.data, img.width, img.height);
  const trimmed = bounds ? cropRgba(img.data, img.width, bounds) : img;
  const aspect = trimmed.width / trimmed.height;
  if (aspect <= MAX_ICON_ASPECT && 1 / aspect <= MAX_ICON_ASPECT) {
    return { img: trimmed, how: bounds ? "trimmed" : "as_is" };
  }
  const symbol = findSymbol(trimmed);
  if (symbol) return { img: symbol, how: "symbol_cropped" };
  return null;
}

/* ---------------------------------------------------------------- monogram */

// A 5x7 bitmap face. There is no font renderer in this runtime and no font file
// to load, so the letters are drawn. Only the glyphs a business name can
// actually reduce to are present; anything else is refused rather than drawn
// as a box (initialsFrom filters to this set).
// One row per line, five cells per row, seven rows per glyph. Written this way
// on purpose: as flat 35-character literals six of these glyphs were silently
// off by one and rendered as noise, and nothing but an eyeball catches that.
// The shape is now the spec, and buildFont asserts it.
const FONT_SOURCE = {
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
  N: ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  3: ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
};
const GLYPH_W = 5;
const GLYPH_H = 7;

/**
 * Flatten the row table, refusing anything malformed.
 *
 * A glyph that is short by one cell does not throw at draw time — it renders
 * scrambled and ships. Throwing here turns a typo into a failed require()
 * instead of a customer-visible smear.
 */
function buildFont(source) {
  const out = {};
  for (const [ch, rows] of Object.entries(source)) {
    if (rows.length !== GLYPH_H || rows.some((r) => r.length !== GLYPH_W)) {
      throw new Error(`favicon font glyph ${ch} is not ${GLYPH_W}x${GLYPH_H}`);
    }
    out[ch] = rows.join("");
  }
  return out;
}
const FONT = buildFont(FONT_SOURCE);

const NAME_NOISE = new Set([
  "the", "and", "of", "for", "llc", "l.l.c", "inc", "co", "corp", "corporation",
  "company", "ltd", "llp", "pllc", "pc", "group", "services", "service",
  "solutions", "systems", "&",
]);

/**
 * Initials for the neutral monogram.
 *
 * The client's own name, reduced — not a generated mark. Legal suffixes and
 * filler are dropped so "Air Creation Heating and Cooling LLC" reads AC rather
 * than AL, and a single-word name keeps one letter rather than inventing a
 * second from nothing.
 */
function initialsFrom(businessName) {
  const words = String(businessName || "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .filter((w) => !NAME_NOISE.has(w.toLowerCase()));
  const letters = [];
  for (const w of words) {
    const ch = w[0].toUpperCase();
    if (FONT[ch]) letters.push(ch);
    if (letters.length === 2) break;
  }
  return letters.join("");
}

/**
 * Draw initials on a filled tile.
 *
 * Nearest-neighbour at an integer scale on purpose: at 16px an interpolated
 * letter is a grey smudge, while a hard-edged one stays readable.
 */
function monogramRgba(size, initials, bgHex, fgHex, { rounded = true } = {}) {
  const out = new Uint8Array(size * size * 4);
  const bg = hexToRgb(bgHex) || { r: 47, g: 54, b: 64 };
  const fg = hexToRgb(fgHex) || { r: 255, g: 255, b: 255 };
  const radius = rounded ? size * 0.22 : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = true;
      if (radius > 0) {
        const cx = x < radius ? radius : x > size - 1 - radius ? size - 1 - radius : x;
        const cy = y < radius ? radius : y > size - 1 - radius ? size - 1 - radius : y;
        const dx = x - cx, dy = y - cy;
        inside = dx * dx + dy * dy <= radius * radius;
      }
      const o = (y * size + x) * 4;
      out[o] = bg.r; out[o + 1] = bg.g; out[o + 2] = bg.b;
      out[o + 3] = inside ? 255 : 0;
    }
  }

  const chars = String(initials || "").split("").filter((c) => FONT[c]);
  if (!chars.length) return out;

  const scale = Math.max(1, Math.round((size * 0.46) / GLYPH_H));
  const gap = chars.length > 1 ? Math.max(1, scale) : 0;
  const textW = chars.length * GLYPH_W * scale + (chars.length - 1) * gap;
  const textH = GLYPH_H * scale;
  let penX = Math.round((size - textW) / 2);
  const penY = Math.round((size - textH) / 2);

  for (const ch of chars) {
    const glyph = FONT[ch];
    for (let gy = 0; gy < GLYPH_H; gy++) {
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (glyph[gy * GLYPH_W + gx] !== "#") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = penX + gx * scale + sx;
            const py = penY + gy * scale + sy;
            if (px < 0 || py < 0 || px >= size || py >= size) continue;
            const o = (py * size + px) * 4;
            out[o] = fg.r; out[o + 1] = fg.g; out[o + 2] = fg.b; out[o + 3] = 255;
          }
        }
      }
    }
    penX += GLYPH_W * scale + gap;
  }
  return out;
}

function monogramSvg(initials, bgHex, fgHex) {
  const bg = hexToRgb(bgHex) ? bgHex : "#2f3640";
  const fg = hexToRgb(fgHex) ? fgHex : "#ffffff";
  const text = String(initials || "").replace(/[<>&"']/g, "");
  const fontSize = text.length > 1 ? 30 : 40;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">`
    + `<rect width="64" height="64" rx="14" fill="${bg}"/>`
    + `<text x="32" y="32" fill="${fg}" font-family="Helvetica,Arial,sans-serif"`
    + ` font-size="${fontSize}" font-weight="700" letter-spacing="1"`
    + ` text-anchor="middle" dominant-baseline="central">${text}</text></svg>`,
    "utf8",
  );
}

/**
 * The client's own SVG mark, made safe to use as an icon.
 *
 * Served as-is wherever possible — it IS their file. The only edit is supplying
 * a viewBox when the root element has none: without one a browser scales by the
 * width/height attributes and a 600px-wide mark overflows a 16px tile instead
 * of letterboxing into it.
 */
function normalizeSvgIcon(bytes) {
  let svg = bytes.toString("utf8");
  const open = /<svg\b[^>]*>/i.exec(svg);
  if (!open) return null;
  const tag = open[0];
  if (/\bviewBox\s*=/i.test(tag)) return Buffer.from(svg, "utf8");
  const w = /\bwidth\s*=\s*["']?\s*([0-9.]+)/i.exec(tag);
  const h = /\bheight\s*=\s*["']?\s*([0-9.]+)/i.exec(tag);
  if (!w || !h) return Buffer.from(svg, "utf8");
  const patched = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${w[1]} ${h[1]}"`);
  svg = svg.replace(tag, patched);
  return Buffer.from(svg, "utf8");
}

/* -------------------------------------------------------------- the builder */

/**
 * Build the icon set for one client.
 *
 * Returns { files, links, manifestIcons, report }. `report.source` names where
 * the pixels came from and is the field an operator should read: "client_logo"
 * means their own mark, "monogram" means we refused to guess.
 */
function buildFavicons({ logo = null, businessName = "", accent = null, primary = null } = {}) {
  const files = {};
  const links = [];
  const manifestIcons = [];
  const report = { source: "none", raster_source: "none", initials: "", sizes: [] };

  const initials = initialsFrom(businessName);
  report.initials = initials;

  // Raster from the client's logo when the bytes are decodable here. PNG is the
  // only format with a pure-JS decoder in this runtime; JPEG/WebP/GIF marks are
  // NOT rasterised by guesswork, they fall to the monogram and say so.
  let rgba = null;
  if (logo && logo.bytes && String(logo.ext).toLowerCase() === "png") {
    let decoded = null;
    try {
      decoded = decodePngToRgba(Buffer.isBuffer(logo.bytes) ? logo.bytes : Buffer.from(logo.bytes));
    } catch {
      decoded = null;
    }
    if (decoded && decoded.width > 0 && decoded.height > 0) {
      // Reduce to the square artwork inside their mark. A wordmark with no
      // square form yields null here, and the monogram takes over — see
      // squareMark. This is the difference between an icon that reads and a
      // three-pixel dash that merely passes a check.
      const mark = squareMark(decoded);
      if (mark) {
        rgba = mark.img;
        report.logo_fit = mark.how;
      } else {
        report.logo_fit = "no_square_form";
        report.logo_fit_detail = `logo is ${decoded.width}x${decoded.height}; no symbol to crop`;
      }
    } else {
      report.logo_fit = "undecodable_png";
    }
  } else if (logo && logo.bytes && String(logo.ext).toLowerCase() !== "svg") {
    // JPEG/WebP/GIF: no pure-JS decoder exists in this runtime and ffmpeg is
    // not deployed with the functions. Naming the reason matters — an operator
    // seeing "monogram" on a client who clearly HAS a logo should be able to
    // tell "we could not read the file" from "their mark has no square form".
    report.logo_fit = `format_not_decodable_here(${String(logo.ext).toLowerCase()})`;
  }

  const isSvgLogo = Boolean(logo && logo.bytes && String(logo.ext).toLowerCase() === "svg");
  let svgIcon = null;
  if (isSvgLogo) {
    svgIcon = normalizeSvgIcon(Buffer.isBuffer(logo.bytes) ? logo.bytes : Buffer.from(logo.bytes));
  }

  // TRUTH LAW GATE. Nothing derived from the client and nothing to cut a
  // monogram from means NO ICON — never the donor's, never an invented one.
  if (!rgba && !svgIcon && !initials) {
    report.reason = "no_verified_logo_and_no_usable_business_name";
    return { files, links, manifestIcons, report };
  }

  const monoBg = hexToRgb(accent) ? accent : hexToRgb(primary) ? primary : "#2f3640";
  const monoFg = lum(hexToRgb(monoBg)) > 0.6 ? "#14181d" : "#ffffff";

  const raster = (size, { flatten = false, rounded = true } = {}) => {
    if (rgba) {
      // Apple composites transparency to black, so the touch icon is flattened
      // onto the client's own accent (or white when that would swallow a dark
      // mark). Everything else keeps the logo's real alpha.
      const bg = flatten ? (lum(hexToRgb(monoBg)) < 0.5 ? "#ffffff" : monoBg) : null;
      return squareFit(rgba.data, rgba.width, rgba.height, size, bg);
    }
    return monogramRgba(size, initials, monoBg, monoFg, { rounded: rounded && !flatten });
  };

  report.source = rgba ? "client_logo" : svgIcon ? "client_logo_svg" : "monogram";
  report.raster_source = rgba ? "client_logo" : "monogram";

  // /favicon.ico — the path browsers request with no markup at all. It is
  // emitted whenever we have anything legitimate to draw, precisely so the
  // default request can never fall through to a leftover donor file.
  if (rgba || initials) {
    const icoEntries = ICO_SIZES.map((size) => ({
      size,
      png: encodePng(size, size, raster(size)),
    }));
    files["favicon.ico"] = encodeIco(icoEntries);
    links.push('<link rel="icon" sizes="16x16 32x32 48x48" href="/favicon.ico" />');
    report.sizes.push(...ICO_SIZES);

    files["apple-touch-icon.png"] = encodePng(
      APPLE_SIZE, APPLE_SIZE, raster(APPLE_SIZE, { flatten: true, rounded: false }),
    );
    links.push(`<link rel="apple-touch-icon" sizes="${APPLE_SIZE}x${APPLE_SIZE}" href="/apple-touch-icon.png" />`);
    report.sizes.push(APPLE_SIZE);

    for (const size of MANIFEST_SIZES) {
      const rel = `icon-${size}.png`;
      files[rel] = encodePng(size, size, raster(size));
      manifestIcons.push({ src: `/${rel}`, sizes: `${size}x${size}`, type: "image/png" });
      report.sizes.push(size);
    }
    links.push(`<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />`);
    // Compatibility path for compiled clients that request /favicon.png
    // at runtime after the static icon links have been sanitized.
    files["favicon.png"] = Buffer.from(files["icon-192.png"]);
  }

  // The vector icon: their real SVG mark when they have one, else the monogram
  // drawn crisply. Declared AFTER the .ico so browsers that understand it win.
  if (svgIcon) {
    files["favicon.svg"] = svgIcon;
    links.push('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  } else if (!rgba && initials) {
    files["favicon.svg"] = monogramSvg(initials, monoBg, monoFg);
    links.push('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  }

  report.bytes = Object.fromEntries(
    Object.entries(files).map(([rel, buf]) => [rel, buf.length]),
  );
  report.sha256 = files["favicon.ico"]
    ? createHash("sha256").update(files["favicon.ico"]).digest("hex")
    : files["favicon.svg"]
      ? createHash("sha256").update(files["favicon.svg"]).digest("hex")
      : null;
  return { files, links, manifestIcons, report };
}

/* ----------------------------------------------------------------- the seam */

// Root-level icon files a donor ships. Deliberately anchored to the output ROOT:
// `assets/icon-check.png` is UI furniture the app references and must survive,
// while `/favicon.ico` is identity. Matching on basename anywhere would delete
// working imagery to fix a tab.
const DONOR_ICON_RE = new RegExp(
  "^(?:"
  + "favicon(?:[-_.][^/]*)?\\.(?:ico|png|svg|gif|jpe?g|webp)"
  + "|apple-touch-icon(?:-precomposed)?(?:-[0-9x]+)?\\.png"
  + "|apple-icon[^/]*\\.png"
  + "|android-chrome-[^/]*\\.png"
  + "|mstile-[^/]*\\.png"
  + "|safari-pinned-tab\\.svg"
  + "|browserconfig\\.xml"
  + "|icon-[0-9]+\\.png"
  + ")$",
  "i",
);

// Any <link> that declares an icon. `rel="alternate icon"` is in here because
// donors-clean/salon-lacquer-studio ships exactly that pointing at the shared
// 9f504444 file — a second, quieter route to the same borrowed mark.
const ICON_LINK_PATTERN = "<link\\b[^>]*\\brel\\s*=\\s*[\"']?(?:shortcut\\s+icon|alternate\\s+icon|icon\\s+shortcut|icon|apple-touch-icon(?:-precomposed)?|mask-icon)[\"']?[^>]*>\\s*";
// A fresh instance per use. A shared /g regex carries lastIndex between calls,
// which silently skips matches on every other page.
function iconLinkRe() { return new RegExp(ICON_LINK_PATTERN, "gi"); }
const ICON_LINK_RE = iconLinkRe();

function isHtml(rel) { return /\.html?$/i.test(rel); }

/**
 * Replace every donor icon in a built tree with the client's own.
 *
 * Mutates `files` in place, the way the rest of engine.js treats the tree.
 * Order matters: PURGE first so a generated file can never be deleted by the
 * sweep that follows it.
 */
function applyFavicons({ files, logo = null, businessName = "", accent = null, primary = null }) {
  const removed = [];

  // 1. PURGE. The whole point — see the header comment. An unreferenced
  //    /favicon.ico is still served on the browser's default request.
  for (const rel of Object.keys(files)) {
    if (rel.includes("/")) continue;
    if (DONOR_ICON_RE.test(rel)) {
      delete files[rel];
      removed.push(rel);
    }
  }

  const built = buildFavicons({ logo, businessName, accent, primary });
  for (const [rel, buf] of Object.entries(built.files)) files[rel] = buf;

  // 2. Strip the donor's icon markup from every page, then declare ours.
  let pagesRewritten = 0;
  for (const [rel, buf] of Object.entries(files)) {
    if (!isHtml(rel)) continue;
    const before = buf.toString("utf8");
    let html = before.replace(iconLinkRe(), "");
    if (built.links.length && /<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `${built.links.join("\n    ")}\n  </head>`);
    }
    if (html !== before) {
      files[rel] = Buffer.from(html, "utf8");
      pagesRewritten++;
    }
  }

  // 3. The manifest points at icons too, and an installed PWA reads it instead
  //    of the <link> tags. A donor manifest listing /favicon.svg would resurrect
  //    the borrowed mark on the home screen after we cleaned the tab.
  let manifestRewritten = false;
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.webmanifest$/i.test(rel) && !/(^|\/)manifest\.json$/i.test(rel)) continue;
    let doc;
    try {
      doc = JSON.parse(buf.toString("utf8"));
    } catch {
      continue; // hydrate.js already gates JSON validity; never make it worse
    }
    doc.icons = built.manifestIcons;
    files[rel] = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, "utf8");
    manifestRewritten = true;
  }

  // 4. VERIFY THE TREE, DON'T TRUST THE PURGE.
  //
  // "QC PASS is never proof — render the DOM." The equivalent here is to
  // measure the file list we are about to ship rather than assert that the
  // sweep above worked: anything icon-shaped that is not ours is a residual
  // borrowed mark, and any icon <link> pointing outside our emitted set is a
  // path we did not author. Both are reported as evidence so a caller can fail
  // closed on them instead of taking this function's word for it.
  const ours = new Set(Object.keys(built.files));
  const residualFiles = Object.keys(files).filter(
    (rel) => !rel.includes("/") && DONOR_ICON_RE.test(rel) && !ours.has(rel),
  );
  const strayLinks = [];
  for (const [rel, buf] of Object.entries(files)) {
    if (!isHtml(rel)) continue;
    for (const m of buf.toString("utf8").matchAll(iconLinkRe())) {
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]);
      const target = href ? href[1].replace(/^\//, "") : "";
      if (!ours.has(target)) strayLinks.push({ page: rel, href: href ? href[1] : m[0].slice(0, 80) });
    }
  }

  return {
    files,
    report: {
      ...built.report,
      donor_icons_removed: removed,
      emitted: Object.keys(built.files),
      pages_rewritten: pagesRewritten,
      manifest_rewritten: manifestRewritten,
      residual_donor_icons: residualFiles,
      stray_icon_links: strayLinks.slice(0, 8),
      clean: residualFiles.length === 0 && strayLinks.length === 0,
    },
  };
}

module.exports = {
  applyFavicons,
  buildFavicons,
  initialsFrom,
  encodePng,
  encodeIco,
  squareFit,
  monogramRgba,
  normalizeSvgIcon,
  DONOR_ICON_RE,
  ICON_LINK_RE,
};
