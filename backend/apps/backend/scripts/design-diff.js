#!/usr/bin/env node
"use strict";

// scripts/design-diff.js — give the build a designer's eye.
//
// OWNER, 2026-08-11: "we need a designer to kinda screenshot their page to
// understand what elements are there that are popping out and make sure
// they're brought over into ours."
//
// So: render THEIR site and OUR mirror side by side, at desktop and at phone,
// and answer the one question a designer would ask — WHAT DOES THEIR PAGE HAVE
// THAT OURS DOES NOT?
//
//   node scripts/design-diff.js --their https://theirsite.com \
//                               --ours  https://slug.wss-ai.com/ \
//                               --name "Their Business"
//   node scripts/design-diff.js --batch scripts/design-diff-batch.json
//   node scripts/design-diff.js --their ... --ours ... --no-vision
//
// Writes to artifacts/design-diffs/<their-host>/ :
//   report.md                 the readable half — for a human to act on
//   diff.json                 the machine half — every field, every refusal
//   carry-over.json           JUST the carry-over candidates (the later pass's input)
//   their-desktop-full.png    what a visitor sees, whole page, 1280
//   their-mobile-full.png     whole page, 390
//   our-desktop-full.png / our-mobile-full.png
//   shots/their-desktop-0.jpg …   the exact frames the vision model was shown
//   evidence/carry-01-*.png       a clip of the thing each candidate came from
//
// Flags:
//   --their URL      the prospect's own current website        (required)
//   --ours  URL      our live mirror of it                     (required)
//   --name  TEXT     business name, for the report header
//   --trade TEXT     vertical, for the report header
//   --batch FILE     JSON array of { name, trade, their, ours } — runs each
//   --out   DIR      write somewhere other than the default
//   --no-vision      measured half only. No API key needed, no spend.
//   --with-panels    do NOT suppress our own sign-up floater on the mirror
//   --model X        override the vision model id
//   --json           print diff.json to stdout instead of the summary
//   --limit N        batch only: stop after N pairs
//
// ===========================================================================
// WHY THIS IS A SEPARATE TOOL AND NOT PART OF THE ENGINE
// ===========================================================================
// It imports nothing from the build. Deliberately. Its whole value is being an
// INDEPENDENT SECOND OPINION on what the build produced: if it shared the
// engine's idea of "the accent colour" it would agree with the engine by
// construction and could never catch the engine being wrong. Node builtins and
// Playwright, nothing else.
//
// ===========================================================================
// THE TRUTH LAW, AND EXACTLY HOW IT IS ENFORCED HERE  (spec point 4)
// ===========================================================================
// "The tool may only report what it can SEE in the two screenshots. It must not
// infer a credential, an award or a claim that is not legible in the image. A
// misread badge becomes a fabricated credential on a real business's website."
//
// A vision model cannot be asked to police itself on this, so it is policed
// from outside, by a rule that is CHECKABLE:
//
//   Every quoted string the model reports is looked up in the rendered page's
//   own visible text (document.innerText, captured in the same render as the
//   screenshot). If the string is there, it is REAL — a human reading that page
//   sees those exact words. If it is not there, then it was read off a raster
//   image, and we have no way to tell a correct read from a confident misread.
//
// The two are then treated differently by CLASS:
//
//   · A CLAIM — certification, licence number, award, warranty, insurance,
//     rating, guarantee, accreditation, financing offer, "family owned since
//     1974", "BBB A+" — is ACCEPTED ONLY when its quoted text is verified in
//     the DOM. Unverified claims are DROPPED into refusals[], with the reason,
//     and never appear in carry-over.json. This is the rule that stops us
//     carrying "Master Plumber Lic. #44219" onto a business that never said it.
//
//   · A DECORATIVE element — a truck, an owner photo, a mascot, a big phone
//     number, a promo band, a financing STRIP (as a shape, not as its terms) —
//     may be reported from the picture alone, and is marked
//     textVerified:false so a reader knows the difference at a glance.
//
// Two more edges, same principle:
//   · The model never emits a colour. It is not asked to. Every hex in the
//     output is measured from pixels or computed styles on this side. (Shown a
//     flat #C53F34 swatch, frontier vision models answer #C44B3B and #D23B2A —
//     plausible, both wrong, and either one shipped is a business rendered in a
//     colour it has never used.)
//   · The model may indicate WHERE a thing is. That rectangle is used only to
//     cut an evidence clip for a human to look at, and is stamped
//     rectSource:"indicated" — it is a pointer, not a measurement. Where the
//     text was DOM-verified we locate the real element instead and stamp
//     rectSource:"measured".
//
// Nothing in carry-over.json is applied to anything. Every entry carries
// apply:"manual_review_required" and the file's header says so (spec point 3).

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const DIFF_VERSION = "design-diff-v1";
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const VISION_SCREENS = 2;          // desktop frames per site shown to the model
const SEEN_CEILING = 0.75;         // nothing judged from a picture reads as certain
const FULLPAGE_CAP = 12000;        // px — a 30,000px page is captured to here and said so
const PANEL_SUPPRESSION_FLAG = "wssthumb"; // our own floater, off for a fair comparison

/**
 * Words that make a statement a CLAIM about the business rather than a
 * description of its page. Anything matching must be DOM-verified or dropped.
 *
 * Deliberately broad. A false positive costs one carry-over candidate demoted
 * to "unverified"; a false negative ships a fabricated credential onto a real
 * business's live website. Those are not the same size of mistake.
 */
const CLAIM_PATTERNS = [
  /\bBBB\b|better business bureau|accredit/i,
  /\blicen[cs]e[d]?\b|\blic\.?\s*#|\bcertified\b|\bcertification\b|\bmaster\s+(plumber|electrician|technician)\b/i,
  /\bawards?\b|\bwinner\b|\bbest of\b|super service|\btop rated\b|\bangi\b|\bnextdoor\b/i,
  /\bwarrant(y|ies)\b|\bguarantee[d]?\b|\bsatisfaction\b/i,
  /\binsured\b|\bbonded\b|\bliability\b/i,
  /\b\d(\.\d)?\s*(stars?\b|\/\s*5\b)|\b\d{2,}\s+(reviews|google reviews)\b/i,
  /\bsince\s+(18|19|20)\d{2}\b|\bfamily[- ]owned\b|\bveteran[- ]owned\b|\bwoman[- ]owned\b/i,
  /\bfinanc(e|ing)\b|\b0%\s*apr\b|\bno interest\b|\bapproved\b/i,
  /\bEPA\b|\bOSHA\b|\bNATE\b|\bIICRC\b|\bGAF\b|\bOWENS CORNING\b|\bmaster elite\b/i,
  /\$\s?\d/,                       // any price or dollar offer ("$89 Drain Special")
  /\b\d+\s*%\s*off\b|\bfree estimate\b|\bno obligation\b/i,
];

/** A CSS hex colour and nothing else: 3, 4, 6 or 8 digits, not 5, not 7. */
const LOOKS_LIKE_HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-fA-F])/i;

function looksLikeClaim(text) {
  const s = String(text || "");
  if (!s.trim()) return false;
  return CLAIM_PATTERNS.some((re) => re.test(s));
}

// ---------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

function slugify(value, max = 48) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "site";
}

function hostOf(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./i, ""); } catch { return ""; }
}

/** Whitespace-insensitive, case-insensitive text for containment checks. */
function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^a-z0-9$%#./'"-]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseCssColor(value) {
  const s = String(value || "").trim();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const i = parseInt(m[1], 16);
    return { r: (i >> 16) & 255, g: (i >> 8) & 255, b: i & 255, a: 1 };
  }
  return null;
}

function toHex(rgb) {
  if (!rgb) return "";
  return `#${[rgb.r, rgb.g, rgb.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance. */
function relLum({ r, g, b }) {
  const f = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** HSL, for hue-family comparison. h in degrees, s and l in 0..1. */
function rgbToHsl({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/** Shortest distance between two hues, 0..180 degrees. */
function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Is this colour a COLOUR, or is it paper and ink?
 * Greys, near-blacks and near-whites carry no brand family, and letting them
 * into a palette comparison makes every site on earth "match" every other.
 */
function isChromatic(hex, { minSat = 0.22, minL = 0.08, maxL = 0.94 } = {}) {
  const rgb = parseCssColor(hex);
  if (!rgb) return false;
  const { s, l } = rgbToHsl(rgb);
  return s >= minSat && l >= minL && l <= maxL;
}

// ---------------------------------------------------------------------------
// PNG → pixels.  The one reading that cannot lie: what was actually drawn.
// ---------------------------------------------------------------------------

/**
 * Minimal PNG decoder (non-interlaced, 8-bit, colour types 0/2/3/4/6).
 *
 * Standalone on purpose — see the header. It exists so the colour half of this
 * tool is measured from the screenshot's own pixels rather than asked of a
 * model, and so this file keeps its promise of importing nothing from the app.
 */
function decodePng(buffer) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(SIG)) return null;

  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null, trns = null;

  let off = 8;
  while (off + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(off);
    const type = buffer.toString("ascii", off + 4, off + 8);
    const start = off + 8;
    if (start + len > buffer.length) break;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      depth = buffer[start + 8];
      colorType = buffer[start + 9];
      interlace = buffer[start + 12];
    } else if (type === "PLTE") {
      palette = buffer.subarray(start, start + len);
    } else if (type === "tRNS") {
      trns = buffer.subarray(start, start + len);
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(start, start + len));
    } else if (type === "IEND") {
      break;
    }
    off = start + len + 4;
  }
  // Refuse rather than mis-decode. An unreadable screenshot is an honest
  // "no pixel histogram"; a wrongly-decoded one is a wrong brand colour.
  if (!width || !height || depth !== 8 || interlace !== 0) return null;

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) return null;

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }

  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);

  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    if (pos >= raw.length) break;
    const filter = raw[pos]; pos += 1;
    raw.copy(line, 0, pos, pos + stride); pos += stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      switch (filter) {
        case 1: line[i] = (line[i] + a) & 255; break;
        case 2: line[i] = (line[i] + b) & 255; break;
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 255; break;
        case 4: line[i] = (line[i] + paeth(a, b, c)) & 255; break;
        default: break;
      }
    }
    line.copy(prev);
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const s = x * bpp;
      if (colorType === 0) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = 255; }
      else if (colorType === 2) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = 255; }
      else if (colorType === 3) {
        const idx = line[s];
        if (!palette) return null;
        out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 4) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = line[s + 1]; }
      else { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = line[s + 3]; }
    }
  }
  return { width, height, data: out };
}

/**
 * The top colours a visitor actually sees, by share of drawn pixels.
 *
 * Quantised to a 16-level cube so a gradient or a photograph's sheen does not
 * shatter one colour into fifty buckets, then reported at the bucket's mean —
 * which is the real colour of the real pixels, not a bucket centre.
 */
function paletteFromPng(pngBuffer, { step = 4, top = 10 } = {}) {
  const decoded = decodePng(pngBuffer);
  if (!decoded) return null;
  const { data, width, height } = decoded;
  const buckets = new Map();
  let total = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 200) continue;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      let b = buckets.get(key);
      if (!b) { b = { n: 0, r: 0, g: 0, bl: 0 }; buckets.set(key, b); }
      b.n += 1; b.r += data[i]; b.g += data[i + 1]; b.bl += data[i + 2];
      total += 1;
    }
  }
  if (!total) return null;
  const describe = (b) => {
    const hex = toHex({ r: b.r / b.n, g: b.g / b.n, b: b.bl / b.n });
    const hsl = rgbToHsl(parseCssColor(hex));
    return { hex, share: round3(b.n / total), hue: Math.round(hsl.h), sat: round2(hsl.s), lum: round2(hsl.l), chromatic: isChromatic(hex) };
  };
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const ranked = sorted.slice(0, top).map(describe);
  // EVERY bucket above a rounding error, not just the top ten. "Does our page
  // show this colour at all?" is a question the top-ten list cannot answer — a
  // bright CTA yellow is a real part of a design and still loses the pixel
  // count to one dark hero photograph.
  const all = sorted.filter((b) => b.n / total >= 0.0004).slice(0, 400).map(describe);
  return { total, sampledPixels: total, colors: ranked, all, surface: ranked[0] || null };
}

/**
 * How much of a rendered page is actually painted in (something close to) this
 * colour. The direct answer to "did we carry their colour over, or do we just
 * own a swatch of it somewhere off-screen?"
 */
function pixelShareNear(palette, hex, { hueTol = 20, lumTol = 0.14, satTol = 0.3 } = {}) {
  const target = hslOf(hex);
  if (!target || !palette || !Array.isArray(palette.all)) return null;
  let share = 0;
  for (const c of palette.all) {
    if (hueDistance(target.h, c.hue) > hueTol) continue;
    if (Math.abs(target.l - c.lum) > lumTol) continue;
    if (Math.abs(target.s - c.sat) > satTol) continue;
    share += c.share;
  }
  return round3(share);
}

// ---------------------------------------------------------------------------
// what the browser measures, in the page  (must be self-contained)
// ---------------------------------------------------------------------------

function measureInPage() {
  const hex = (value) => {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/i.exec(String(value || "").trim());
    if (!m) return "";
    if (m[4] !== undefined && Number(m[4]) < 0.06) return "";
    return "#" + [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, "0")).join("");
  };
  const tally = (map, key, weight) => {
    if (!key) return;
    map[key] = (map[key] || 0) + (weight || 1);
  };
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  const doc = document.documentElement;
  const all = Array.from(document.querySelectorAll("*")).slice(0, 6000);

  const backgrounds = {};
  const textColors = {};
  const borderColors = {};
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (area < 400) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) continue;
    tally(backgrounds, hex(cs.backgroundColor), area);
    if (clean(el.textContent).length > 8) tally(textColors, hex(cs.color), Math.min(area, 60000));
    if (parseFloat(cs.borderTopWidth) > 0) tally(borderColors, hex(cs.borderTopColor), area);
  }

  // Action surfaces: what the page uses to say "do this". The brand colour
  // usually lives here, and it is the one colour a mirror MUST get right.
  const actionColors = {};
  const actionTextColors = {};
  for (const el of Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],.btn,.button')).slice(0, 600)) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 18) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    tally(actionColors, hex(cs.backgroundColor), r.width * r.height);
    tally(actionTextColors, hex(cs.color), r.width * r.height);
  }

  const renderedFamily = (stack) => {
    const parts = String(stack || "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    for (const p of parts) {
      if (/^(system-ui|-apple-system|sans-serif|serif|monospace|cursive|fantasy|ui-\w+|blinkmacsystemfont|segoe ui|roboto|helvetica( neue)?|arial)$/i.test(p)) return p;
      try { if (document.fonts && document.fonts.check(`16px "${p}"`)) return p; } catch (e) { /* fall through */ }
    }
    return parts[0] || "";
  };

  const fontOf = (selector, limit) => {
    const out = {};
    for (const el of Array.from(document.querySelectorAll(selector)).slice(0, limit || 40)) {
      const t = clean(el.textContent);
      if (!t) continue;
      const cs = getComputedStyle(el);
      const fam = renderedFamily(cs.fontFamily);
      if (!fam) continue;
      const k = `${fam}|${cs.fontWeight}`;
      out[k] = (out[k] || 0) + t.length;
    }
    return out;
  };

  const images = [];
  for (const img of Array.from(document.images || []).slice(0, 300)) {
    const r = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    images.push({
      src: String(img.currentSrc || img.src || "").slice(0, 400),
      alt: clean(img.alt).slice(0, 160),
      naturalWidth: img.naturalWidth || 0,
      naturalHeight: img.naturalHeight || 0,
      renderedWidth: Math.round(r.width),
      renderedHeight: Math.round(r.height),
      top: Math.round(r.top + window.scrollY),
    });
  }

  // A CSS background-image is still a photograph on the page — heroes are
  // routinely painted this way and an <img> census alone misses every one.
  const bgImages = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    const bi = cs.backgroundImage;
    if (!bi || bi === "none" || !/url\(/i.test(bi)) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 12000) continue;
    const m = /url\((["']?)([^"')]+)\1\)/i.exec(bi);
    if (m) bgImages.push({ src: String(m[2]).slice(0, 400), width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top + window.scrollY) });
    if (bgImages.length >= 60) break;
  }

  // Cookie banners and chat widgets sit ON TOP of the fold and are in every
  // screenshot the model is shown. They are not the client's design, and a
  // report that does not say how much of the first screen they covered is
  // hiding the reason an element was "missing".
  const overlays = [];
  let overlayArea = 0;
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.2) continue;
    const r = el.getBoundingClientRect();
    const a = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0))
      * Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    if (a < window.innerWidth * window.innerHeight * 0.03) continue;
    if (el.parentElement && overlays.some((o) => o.el === el.parentElement)) continue;
    overlays.push({ el, area: a, text: clean(el.textContent).slice(0, 100) });
    overlayArea += a;
  }

  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .map((h) => ({ tag: h.tagName.toLowerCase(), text: clean(h.textContent).slice(0, 200) }))
    .filter((h) => h.text).slice(0, 60);

  const buttons = Array.from(document.querySelectorAll('a,button,[role="button"]'))
    .map((b) => clean(b.textContent).slice(0, 80)).filter((t) => t && t.length < 60).slice(0, 120);

  return {
    finalUrl: location.href,
    title: clean(document.title).slice(0, 200),
    metaDescription: clean((document.querySelector('meta[name="description"]') || {}).content || "").slice(0, 300),
    docHeight: Math.round(doc.scrollHeight),
    docWidth: Math.round(doc.scrollWidth),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyBackground: hex(getComputedStyle(document.body).backgroundColor),
    bodyColor: hex(getComputedStyle(document.body).color),
    backgrounds, textColors, borderColors, actionColors, actionTextColors,
    fontsHeading: fontOf("h1,h2,h3", 40),
    fontsBody: fontOf("p,li,td,span", 120),
    images,
    bgImages,
    overlays: overlays.map((o) => ({ text: o.text, shareOfFold: Math.round((o.area / (window.innerWidth * window.innerHeight)) * 100) / 100 })).slice(0, 8),
    overlayShareOfFold: Math.round(Math.min(1, overlayArea / (window.innerWidth * window.innerHeight)) * 100) / 100,
    videoCount: document.querySelectorAll("video").length,
    iframeCount: document.querySelectorAll("iframe").length,
    inlineSvgCount: document.querySelectorAll("svg").length,
    sectionCount: document.querySelectorAll("section,footer,header,main > div").length,
    formCount: document.querySelectorAll("form").length,
    headings,
    buttons,
    visibleText: clean(document.body.innerText || "").slice(0, 80000),
  };
}

/** Rank a weighted tally into [{hex, weight, share}]. */
function rankTally(tally, limit = 8) {
  const rows = Object.entries(tally || {}).filter(([hex]) => hex);
  const total = rows.reduce((a, [, w]) => a + w, 0) || 1;
  return rows.sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([hex, weight]) => ({ hex, share: round3(weight / total) }));
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

async function settlePage(page, { settleMs = 900, scrollSteps = 14 } = {}) {
  // Fonts and lazy images must SETTLE before anything is measured. A screenshot
  // taken mid-load photographs the fallback serif and half the pictures, and a
  // brief built on it reports a typeface the business has never used.
  await page.evaluate(async (steps) => {
    const h = window.innerHeight;
    for (let i = 1; i <= steps; i += 1) {
      window.scrollTo(0, h * i);
      await new Promise((r) => setTimeout(r, 90));
      if (window.scrollY + h >= document.documentElement.scrollHeight - 4) break;
    }
    window.scrollTo(0, 0);
  }, scrollSteps).catch(() => {});
  await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())).catch(() => {});
  await page.evaluate(async () => {
    const imgs = Array.from(document.images || []).slice(0, 150);
    await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => {
      const done = () => r();
      i.addEventListener("load", done, { once: true });
      i.addEventListener("error", done, { once: true });
      setTimeout(done, 3000);
    }))));
  }).catch(() => {});
  await page.waitForTimeout(settleMs);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

/**
 * Render one site at both sizes and record everything measurable.
 *
 * The desktop page is LEFT OPEN (`_page`) so evidence clips can be cut after
 * the vision pass has chosen what to clip. Callers must `await ev._close()`.
 */
async function captureSite(browser, url, { label, outDir, prefix, timeoutMs = 45000, suppressPanels = false } = {}) {
  const started = Date.now();
  let target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) return { ok: false, reason: "not_http_url", url: target, label };
  if (suppressPanels) {
    try { const u = new URL(target); u.searchParams.set(PANEL_SUPPRESSION_FLAG, "1"); target = u.toString(); } catch { /* leave as-is */ }
  }

  const shots = [];
  const files = {};
  let page = null;
  let mobilePage = null;

  const go = async (p) => {
    await p.goto(target, { waitUntil: "networkidle", timeout: timeoutMs })
      .catch(async () => { await p.goto(target, { waitUntil: "load", timeout: timeoutMs }); });
  };

  page = await browser.newPage({
    viewport: { width: DESKTOP.width, height: DESKTOP.height },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    colorScheme: "light",
  });
  await go(page);
  await settlePage(page);

  const measured = await page.evaluate(measureInPage);
  const landedOn = hostOf(measured.finalUrl);

  // Full page, whole thing, for a human to open and argue with (spec point 1).
  const capHeight = Math.min(measured.docHeight || DESKTOP.height, FULLPAGE_CAP);
  const truncated = (measured.docHeight || 0) > FULLPAGE_CAP;
  const fullPng = await page.screenshot({
    type: "png", fullPage: true,
    clip: { x: 0, y: 0, width: DESKTOP.width, height: capHeight },
  }).catch(() => null);
  if (fullPng) {
    files.desktopFull = path.join(outDir, `${prefix}-desktop-full.png`);
    fs.writeFileSync(files.desktopFull, fullPng);
  }

  // Viewport-sized frames are what the model is actually shown. A 12,000px page
  // handed to a vision model in one piece is downscaled to illegibility and
  // then read badly — which is exactly the failure mode that invents badges.
  // THE FOLD, MEASURED SEPARATELY. A whole-page histogram of a 12,000px page
  // says "light" about a site whose first screen is near-black, because 11,000
  // white pixels outvote the one screen a visitor actually lands on. Measured
  // on mmheatingandcooling.com's mirror: page #fbfcfd (light), fold #2a1420
  // (dark) — and the fold is the answer to "did we match their site".
  const foldPng = await page.screenshot({ type: "png" }).catch(() => null);

  const shotDir = path.join(outDir, "shots");
  fs.mkdirSync(shotDir, { recursive: true });
  for (let i = 0; i < VISION_SCREENS; i += 1) {
    const y = i * DESKTOP.height;
    if (i > 0 && y >= (measured.docHeight || 0)) break;
    await page.evaluate((top) => window.scrollTo(0, top), y).catch(() => {});
    await page.waitForTimeout(320);
    const buffer = await page.screenshot({ type: "jpeg", quality: 74 }).catch(() => null);
    if (!buffer) continue;
    const file = path.join(shotDir, `${prefix}-desktop-${i}.jpg`);
    fs.writeFileSync(file, buffer);
    shots.push({ id: `${prefix}-desktop-${i}`, site: label, viewport: "desktop", scrollY: y, width: DESKTOP.width, height: DESKTOP.height, mediaType: "image/jpeg", buffer, file });
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

  let mobileMeasured = null;
  try {
    mobilePage = await browser.newPage({
      viewport: { width: MOBILE.width, height: MOBILE.height },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: "light",
      userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    });
    await go(mobilePage);
    await settlePage(mobilePage, { settleMs: 700, scrollSteps: 10 });
    mobileMeasured = await mobilePage.evaluate(measureInPage).catch(() => null);
    const mobFullHeight = Math.min((mobileMeasured && mobileMeasured.docHeight) || MOBILE.height, FULLPAGE_CAP);
    const mobFull = await mobilePage.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: MOBILE.width, height: mobFullHeight } }).catch(() => null);
    if (mobFull) {
      files.mobileFull = path.join(outDir, `${prefix}-mobile-full.png`);
      fs.writeFileSync(files.mobileFull, mobFull);
    }
    const mobShot = await mobilePage.screenshot({ type: "jpeg", quality: 74 }).catch(() => null);
    if (mobShot) {
      const file = path.join(shotDir, `${prefix}-mobile-0.jpg`);
      fs.writeFileSync(file, mobShot);
      shots.push({ id: `${prefix}-mobile-0`, site: label, viewport: "mobile", scrollY: 0, width: MOBILE.width, height: MOBILE.height, mediaType: "image/jpeg", buffer: mobShot, file });
    }
  } catch (e) {
    files.mobileError = String((e && e.message) || e).split("\n")[0].slice(0, 140);
  } finally {
    if (mobilePage) await mobilePage.close().catch(() => {});
  }

  const palette = fullPng ? paletteFromPng(fullPng) : null;
  const foldPalette = foldPng ? paletteFromPng(foldPng, { step: 3 }) : null;

  return {
    ok: true,
    label,
    requestedUrl: url,
    fetchedUrl: target,
    finalUrl: measured.finalUrl,
    landedOn,
    capturedAt: new Date().toISOString(),
    captureMs: Date.now() - started,
    fullPageTruncated: truncated,
    measured,
    mobileMeasured,
    palette,
    foldPalette,
    shots,
    files,
    _page: page,
    _close: async () => { if (page) await page.close().catch(() => {}); },
  };
}

// ---------------------------------------------------------------------------
// the measured comparison — facts, before anyone is asked for an opinion
// ---------------------------------------------------------------------------

const modeOf = (hex) => {
  const rgb = parseCssColor(hex);
  if (!rgb) return { mode: "unknown", luminance: null };
  const lum = relLum(rgb);
  return { mode: lum < 0.4 ? "dark" : "light", luminance: round3(lum) };
};

/**
 * Light or dark — answered TWICE, because there are two honest answers.
 *
 * The computed body background is exact but can be a lie of SCOPE: plenty of
 * sites leave body white and paint every section black. The pixel histogram
 * cannot lie about that — it is literally what was drawn.
 *
 * And a whole-page histogram is itself a lie of SCALE. M & M's mirror measures
 * #fbfcfd across 12,000px and reads "light" while the screen a visitor actually
 * lands on is near-black. So the FOLD is measured on its own and is what
 * `mode` reports; the whole-page reading is kept beside it as `pageMode`.
 */
function surfaceOf(ev) {
  const computed = ev.measured.bodyBackground || (rankTally(ev.measured.backgrounds)[0] || {}).hex || "";
  const pixel = ev.palette && ev.palette.surface ? ev.palette.surface.hex : "";
  const fold = ev.foldPalette && ev.foldPalette.surface ? ev.foldPalette.surface.hex : "";
  const page = pixel || computed;
  const chosen = fold || page;
  return {
    hex: chosen,
    source: fold ? "fold pixels" : pixel ? "whole-page pixels" : computed ? "computed" : "none",
    computed, pixel, fold,
    foldShare: ev.foldPalette && ev.foldPalette.surface ? ev.foldPalette.surface.share : null,
    pixelShare: ev.palette && ev.palette.surface ? ev.palette.surface.share : null,
    agrees: Boolean(pixel && computed) ? hueAndLumClose(pixel, computed) : null,
    ...modeOf(chosen),
    pageHex: page,
    pageMode: modeOf(page).mode,
    foldDisagreesWithPage: Boolean(fold && page) && modeOf(fold).mode !== modeOf(page).mode,
  };
}

function hueAndLumClose(a, b) {
  const ra = parseCssColor(a), rb = parseCssColor(b);
  if (!ra || !rb) return false;
  return Math.abs(relLum(ra) - relLum(rb)) < 0.08;
}

/**
 * The brand colour, as MEASURED — the commonest chromatic colour used on
 * action surfaces, falling back to the commonest chromatic colour on the page.
 * Never asked of a model. See the header.
 */
function accentOf(ev) {
  const actions = rankTally(ev.measured.actionColors, 12).filter((c) => isChromatic(c.hex));
  if (actions.length) return { hex: actions[0].hex, source: "action surfaces (computed styles)", share: actions[0].share, candidates: actions.slice(0, 5) };
  const pageColors = (ev.palette ? ev.palette.colors : []).filter((c) => c.chromatic);
  if (pageColors.length) return { hex: pageColors[0].hex, source: "pixel histogram", share: pageColors[0].share, candidates: pageColors.slice(0, 5).map((c) => ({ hex: c.hex, share: c.share })) };
  const bgs = rankTally(ev.measured.backgrounds, 12).filter((c) => isChromatic(c.hex));
  if (bgs.length) return { hex: bgs[0].hex, source: "section backgrounds (computed styles)", share: bgs[0].share, candidates: bgs.slice(0, 5) };
  return { hex: "", source: "unmeasurable", share: null, candidates: [] };
}

function topFont(tally) {
  const rows = Object.entries(tally || {}).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return { family: "", weight: "", chars: 0 };
  const [key, chars] = rows[0];
  const [family, weight] = key.split("|");
  return { family, weight, chars };
}

function hslOf(hex) {
  const rgb = parseCssColor(hex);
  return rgb ? rgbToHsl(rgb) : null;
}

/**
 * Do our colours belong to the same FAMILY as theirs?
 *
 * "Family" is measured, not a vibe — but HUE ALONE IS NOT ENOUGH, and the first
 * cut of this got it wrong on the very first real site. M & M's navy #2d3093
 * matched our #181727 at 6° of hue and was reported "same colour". It is not:
 * theirs is a mid navy a customer would call blue, ours is a near-black with a
 * blue cast. Same hue, half the lightness, and nobody would call them the same
 * paint. So the verdict needs lightness too, and reports both numbers.
 */
function comparePalettes(theirEv, ourEv) {
  const theirs = (theirEv.palette ? theirEv.palette.colors : []).filter((c) => c.chromatic && c.share >= 0.01);
  const decorate = (hex, share, from) => {
    const h = hslOf(hex);
    return h ? { hex, share, from, hue: Math.round(h.h), sat: round2(h.s), lum: round2(h.l) } : null;
  };
  const oursAll = [
    ...((ourEv.palette ? ourEv.palette.colors : []).filter((c) => c.chromatic).map((c) => decorate(c.hex, c.share, "pixels"))),
    ...rankTally(ourEv.measured.actionColors, 10).filter((c) => isChromatic(c.hex)).map((c) => decorate(c.hex, c.share, "actions")),
    ...rankTally(ourEv.measured.backgrounds, 10).filter((c) => isChromatic(c.hex)).map((c) => decorate(c.hex, c.share, "backgrounds")),
  ].filter(Boolean);

  const rows = theirs.map((t) => {
    const th = hslOf(t.hex);
    let best = null;
    for (const o of oursAll) {
      const hueDelta = hueDistance(t.hue, o.hue);
      const lumDelta = Math.abs(th.l - o.lum);
      const satDelta = Math.abs(th.s - o.sat);
      // Roughly perceptual: a big lightness gap separates two colours more than
      // a few degrees of hue ever will.
      const distance = (hueDelta / 180) + lumDelta * 1.2 + satDelta * 0.6;
      if (!best || distance < best.distance) {
        best = { hex: o.hex, hue: o.hue, from: o.from, hueDelta: Math.round(hueDelta), lumDelta: round2(lumDelta), satDelta: round2(satDelta), distance, share: o.share };
      }
    }
    // MATCHED IS NOT THE SAME AS USED. Pioneer Fence's brand green #024f35 is
    // 7% of their page — the whole nav bar and the callback form — and the
    // nearest green on our mirror is a mint #05cc86 that a visitor never sees.
    // Reporting that as "same family" says we carried their colour over.
    //
    // So the answer comes from OUR OWN PIXELS: how much of our rendered page is
    // actually painted in something close to the match. Not which tally the
    // match came from — that proxy called Pioneer's heavily-used CTA yellow
    // "barely used" because one dark hero photograph outvoted it in the top ten.
    const ourPixelShare = best ? pixelShareNear(ourEv.palette, best.hex) : null;
    // A RATIO, not a floor. A disciplined accent is a small share of any long
    // page; what says "we did not carry this over" is their page being drenched
    // in it and ours barely showing it. Pioneer: 17% of theirs, 0.4% of ours.
    const muted = Boolean(best) && t.share >= 0.03 && ourPixelShare !== null && ourPixelShare * 5 < t.share;
    const verdict = !best ? "no chromatic colour on our page"
      : best.hueDelta <= 20 && best.lumDelta <= 0.15 ? (muted ? "same colour, far less of the page" : "same colour")
        : best.hueDelta <= 45 && best.lumDelta <= 0.30 ? (muted ? "same family, far less of the page" : "same family")
          : best.hueDelta <= 20 ? "right hue, wrong lightness"
            : "different colour";
    return {
      theirs: t.hex, theirHue: t.hue, theirShare: t.share,
      nearestOurs: best ? best.hex : "", hueDelta: best ? best.hueDelta : null,
      lumDelta: best ? best.lumDelta : null,
      nearestFrom: best ? best.from : "", ourPixelShare,
      verdict,
    };
  });
  const matched = rows.filter((r) => r.verdict === "same colour" || r.verdict === "same family").length;
  return {
    theirChromaticCount: theirs.length,
    ourChromaticCount: oursAll.length,
    rows,
    matchedCount: matched,
    familyMatch: !rows.length ? "unknown" : matched === rows.length ? "yes" : matched === 0 ? "no" : "partial",
  };
}

/** Which of their headline strings never appear anywhere on our page. Exact. */
function compareCopy(theirEv, ourEv) {
  const ourText = normalizeText(ourEv.measured.visibleText);
  const missing = [];
  const present = [];
  for (const h of theirEv.measured.headings.slice(0, 40)) {
    const n = normalizeText(h.text);
    if (n.length < 6) continue;
    (ourText.includes(n) ? present : missing).push(h.text);
  }
  return { theirHeadingCount: theirEv.measured.headings.length, ourHeadingCount: ourEv.measured.headings.length, presentInOurs: present, missingFromOurs: missing.slice(0, 30) };
}

function countPhotos(ev) {
  const imgs = (ev.measured.images || []);
  const real = imgs.filter((i) => i.naturalWidth >= 300 && i.naturalHeight >= 200);
  const small = imgs.filter((i) => i.renderedWidth > 24 && i.renderedWidth <= 260 && i.renderedHeight <= 260);
  return {
    imgTags: imgs.length,
    photographs: real.length,
    smallGraphics: small.length,        // badge/seal/logo-sized. A COUNT, not a reading.
    cssBackgroundImages: (ev.measured.bgImages || []).length,
    distinctSources: new Set(imgs.map((i) => i.src).filter(Boolean)).size,
    videos: ev.measured.videoCount || 0,
    inlineSvg: ev.measured.inlineSvgCount || 0,
  };
}

function measuredDiff(theirEv, ourEv) {
  const theirSurface = surfaceOf(theirEv);
  const ourSurface = surfaceOf(ourEv);
  const theirAccent = accentOf(theirEv);
  const ourAccent = accentOf(ourEv);
  const theirAccentHsl = theirAccent.hex ? hslOf(theirAccent.hex) : null;
  const ourAccentHsl = ourAccent.hex ? hslOf(ourAccent.hex) : null;
  const accentHueDelta = theirAccentHsl && ourAccentHsl ? Math.round(hueDistance(theirAccentHsl.h, ourAccentHsl.h)) : null;
  const accentLumDelta = theirAccentHsl && ourAccentHsl ? round2(Math.abs(theirAccentHsl.l - ourAccentHsl.l)) : null;

  return {
    mode: {
      // "theirs"/"ours" are THE FOLD — the screen a visitor lands on.
      theirs: theirSurface.mode, ours: ourSurface.mode,
      matched: theirSurface.mode === ourSurface.mode,
      wholePageTheirs: theirSurface.pageMode, wholePageOurs: ourSurface.pageMode,
      wholePageMatched: theirSurface.pageMode === ourSurface.pageMode,
      theirSurface, ourSurface,
    },
    accent: {
      theirs: theirAccent, ours: ourAccent,
      hueDelta: accentHueDelta, lumDelta: accentLumDelta,
      verdict: accentHueDelta === null ? "unmeasurable"
        : accentHueDelta <= 20 && accentLumDelta <= 0.15 ? "same colour"
          : accentHueDelta <= 45 && accentLumDelta <= 0.30 ? "same family"
            : accentHueDelta <= 20 ? "right hue, wrong lightness"
              : "different colour",
      contrastOnOurSurface: ourAccent.hex && ourSurface.hex && parseCssColor(ourAccent.hex) && parseCssColor(ourSurface.hex)
        ? round2(contrastRatio(parseCssColor(ourAccent.hex), parseCssColor(ourSurface.hex))) : null,
    },
    palette: comparePalettes(theirEv, ourEv),
    typography: {
      theirs: { display: topFont(theirEv.measured.fontsHeading), body: topFont(theirEv.measured.fontsBody) },
      ours: { display: topFont(ourEv.measured.fontsHeading), body: topFont(ourEv.measured.fontsBody) },
      displayMatched: topFont(theirEv.measured.fontsHeading).family.toLowerCase() === topFont(ourEv.measured.fontsHeading).family.toLowerCase(),
      bodyMatched: topFont(theirEv.measured.fontsBody).family.toLowerCase() === topFont(ourEv.measured.fontsBody).family.toLowerCase(),
    },
    media: { theirs: countPhotos(theirEv), ours: countPhotos(ourEv) },
    scale: {
      theirDocHeight: theirEv.measured.docHeight, ourDocHeight: ourEv.measured.docHeight,
      theirSections: theirEv.measured.sectionCount, ourSections: ourEv.measured.sectionCount,
      theirForms: theirEv.measured.formCount, ourForms: ourEv.measured.formCount,
      theirWords: (theirEv.measured.visibleText || "").split(/\s+/).filter(Boolean).length,
      ourWords: (ourEv.measured.visibleText || "").split(/\s+/).filter(Boolean).length,
    },
    copy: compareCopy(theirEv, ourEv),
  };
}

// ---------------------------------------------------------------------------
// the vision pass — JUDGEMENT ONLY.  It is never asked for a number.
// ---------------------------------------------------------------------------

function buildPrompt(images, ctx) {
  const manifest = images.map((s, i) => `  IMAGE ${i + 1} — ${s.site === "theirs" ? "THEIR CURRENT SITE" : "OUR REBUILD"}, ${s.viewport}${s.scrollY ? `, scrolled to ${s.scrollY}px` : ", top of page"}  [id: ${s.id}]`).join("\n");

  return `You are a senior designer. You are shown screenshots of TWO websites for the same business${ctx.name ? ` (${ctx.name}${ctx.trade ? `, ${ctx.trade}` : ""})` : ""}.

${manifest}

THEIR CURRENT SITE is the business's real, existing website.
OUR REBUILD is a replacement we built for them. It is supposed to be a facelift OF THEIR SITE — their content, their character, their identity — not a generic template wearing their logo.

Answer one question: WHAT DOES THEIR SITE HAVE THAT OURS DOES NOT?

RULES — these are not style preferences, they are the point of the exercise:

1. Report ONLY what you can actually SEE and READ in these images. If you cannot read it, it does not exist for the purposes of this report. An empty list is a correct answer. A guess is not.

2. NEVER report a colour value, a hex code, a font name you are not certain of, a phone number, an address, or any number you cannot read character by character. Colours and fonts are measured separately and your answer would be discarded anyway.

3. THE CREDENTIAL RULE. If you report a badge, a seal, a certification, a licence, an award, a rating, a warranty, a guarantee, an "insured/bonded", a financing offer, a price, or a "since <year>" / "family owned" claim, you MUST set "isClaim": true and put the words EXACTLY AS PRINTED in "quotedText" — character for character, no paraphrase, no expansion of an abbreviation. If you cannot read the words exactly, do not report the item at all. These strings are checked against the page's real text and dropped if they do not match. A misread seal becomes a fabricated credential on a real business's live website.

4. For each distinctive element, give "region" as fractions of the image it is in: {"image": <IMAGE number>, "x":0..1, "y":0..1, "w":0..1, "h":0..1}. This is used to cut a crop for a human to check. Approximate is fine; it is a pointer, not a measurement.

Reply with ONE JSON object and nothing else:

{
  "mode": { "theirs": "light|dark|mixed", "ours": "light|dark|mixed", "note": "one short sentence" },
  "colorImpression": { "matches": "yes|partial|no", "note": "what a customer would say about the colour difference, in one sentence, WITHOUT naming any hex" },
  "typography": {
    "theirCharacter": "e.g. bold and industrial / warm and handwritten / clinical / friendly rounded / traditional serif",
    "ourCharacter": "same vocabulary",
    "matches": true|false,
    "note": "one sentence"
  },
  "distinctive": [
    {
      "kind": "badge|certification|award|warranty|financing|rating|mascot|slogan|owner_photo|team_photo|family_photo|truck|equipment|before_after|promo_banner|phone_number|hours|map|service_area|price|guarantee|logo_lockup|texture|illustration|other",
      "label": "short plain description of what it IS",
      "quotedText": "the exact words printed on it, or \\"\\" if it has no legible words",
      "isClaim": true|false,
      "where": "theirs|ours|both",
      "prominence": "dominant|noticeable|minor",
      "region": { "image": 1, "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0 },
      "confidence": 0.0
    }
  ],
  "missingFromOurs": ["plain sentences: what theirs has that ours does not"],
  "presentOnlyInOurs": ["plain sentences: what ours has that theirs does not"],
  "customerWouldNotice": ["if the two were swapped, what would this business's own customer notice first? Be concrete and blunt."],
  "closeness": { "score": 0, "reason": "one sentence. 0 = unrecognisable as the same business, 10 = clearly the same business, better built." }
}

Be blunt. A polite report that says our rebuild is close when it is not is worse than useless — it ships.`;
}

function extractJsonObject(text) {
  const s = String(text || "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf("{");
  if (start < 0) return null;
  for (let end = body.lastIndexOf("}"); end > start; end = body.lastIndexOf("}", end - 1)) {
    try { return JSON.parse(body.slice(start, end + 1)); } catch { /* try a shorter tail */ }
  }
  return null;
}

const MODEL_PRICES = [
  { match: /claude-(sonnet-4|3-5-sonnet|sonnet-4\.5|sonnet-4-5)/i, inPerM: 3, outPerM: 15 },
  { match: /claude-(opus-4|opus-4\.1|opus-4-1)/i, inPerM: 15, outPerM: 75 },
  { match: /claude-(haiku-4|3-5-haiku|haiku-4-5|haiku-4\.5)/i, inPerM: 1, outPerM: 5 },
  { match: /gemini-[23]\.\d-flash/i, inPerM: 0.3, outPerM: 2.5 },
];

function readUsage(model, raw) {
  const u = raw || {};
  const inputTokens = Number(u.input_tokens ?? u.prompt_tokens);
  const outputTokens = Number(u.output_tokens ?? u.completion_tokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  const row = MODEL_PRICES.find((p) => p.match.test(String(model || "")));
  const costUsd = row && Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
    ? Math.round(((inputTokens / 1e6) * row.inPerM + (outputTokens / 1e6) * row.outPerM) * 1e6) / 1e6
    : null;   // unknown model → no number, rather than an invented one
  return { inputTokens: Number.isFinite(inputTokens) ? inputTokens : null, outputTokens: Number.isFinite(outputTokens) ? outputTokens : null, costUsd };
}

/**
 * One vision call, over whichever provider answers.
 *
 * Anthropic first, OpenRouter second. Measured 2026-08-10 on this box: the
 * breadcrumb ANTHROPIC_API_KEY 401s for every model while OpenRouter answers
 * with images on the first try; production's Anthropic key does work. So an
 * auth failure falls through to the next provider instead of failing the run,
 * and every attempt is reported by name when both fail.
 */
async function callVision({ prompt, images, model = "", timeoutMs = 120000 } = {}) {
  if (!images.length) return { ok: false, reason: "no_screenshots" };
  const anthropicKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  const openrouterKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!anthropicKey && !openrouterKey) return { ok: false, reason: "no_vision_key" };

  const attempts = [];
  const started = Date.now();
  const withTimeout = async (fn) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fn(controller.signal); } finally { clearTimeout(timer); }
  };

  if (anthropicKey) {
    const m = model || process.env.DESIGN_DIFF_MODEL || "claude-sonnet-4-5";
    try {
      const res = await withTimeout((signal) => fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal,
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: m, max_tokens: 4000,
          messages: [{
            role: "user",
            content: [
              ...images.map((s) => ({ type: "image", source: { type: "base64", media_type: s.mediaType, data: Buffer.from(s.buffer).toString("base64") } })),
              { type: "text", text: prompt },
            ],
          }],
        }),
      }));
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const text = (json.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("\n");
        const parsed = extractJsonObject(text);
        if (parsed) return { ok: true, provider: "anthropic", model: m, parsed, raw: text, usage: readUsage(m, json.usage), ms: Date.now() - started };
        attempts.push(`anthropic:${m}:unparseable`);
      } else attempts.push(`anthropic:${m}:${res.status}:${String(json?.error?.type || "").slice(0, 40)}`);
    } catch (e) { attempts.push(`anthropic:${m}:${String((e && e.message) || e).slice(0, 60)}`); }
  }

  if (openrouterKey) {
    const m = model || process.env.DESIGN_DIFF_MODEL_OPENROUTER || "anthropic/claude-sonnet-4.5";
    try {
      const res = await withTimeout((signal) => fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", signal,
        headers: { authorization: `Bearer ${openrouterKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: m, max_tokens: 4000,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...images.map((s) => ({ type: "image_url", image_url: { url: `data:${s.mediaType};base64,${Buffer.from(s.buffer).toString("base64")}` } })),
            ],
          }],
        }),
      }));
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const text = String(json?.choices?.[0]?.message?.content || "");
        const parsed = extractJsonObject(text);
        if (parsed) return { ok: true, provider: "openrouter", model: m, parsed, raw: text, usage: readUsage(m, json.usage), ms: Date.now() - started };
        attempts.push(`openrouter:${m}:unparseable`);
      } else attempts.push(`openrouter:${m}:${res.status}:${String(json?.error?.message || "").slice(0, 70)}`);
    } catch (e) { attempts.push(`openrouter:${m}:${String((e && e.message) || e).slice(0, 60)}`); }
  }

  return { ok: false, reason: `vision_unavailable: ${attempts.join(" || ")}` };
}

// ---------------------------------------------------------------------------
// THE GATE — everything the model said, checked before it is allowed out
// ---------------------------------------------------------------------------

const ALLOWED_KINDS = new Set([
  "badge", "certification", "award", "warranty", "financing", "rating", "mascot", "slogan",
  "owner_photo", "team_photo", "family_photo", "truck", "equipment", "before_after",
  "promo_banner", "phone_number", "hours", "map", "service_area", "price", "guarantee",
  "logo_lockup", "texture", "illustration", "other",
]);

/** Kinds that ASSERT something about the business, not about the page. */
const CLAIM_KINDS = new Set(["badge", "certification", "award", "warranty", "financing", "rating", "price", "guarantee"]);

function verifyRegion(region, images) {
  if (!region || typeof region !== "object") return null;
  const idx = Math.round(Number(region.image));
  if (!Number.isFinite(idx) || idx < 1 || idx > images.length) return null;
  const x = clamp01(region.x), y = clamp01(region.y);
  const w = clamp01(region.w), h = clamp01(region.h);
  if (w <= 0.005 || h <= 0.005) return null;
  return { imageIndex: idx, imageId: images[idx - 1].id, x: round3(x), y: round3(Math.min(y, 0.995)), w: round3(Math.min(w, 1 - x)), h: round3(Math.min(h, 1 - y)) };
}

/**
 * The truth-law gate. Every element the model reported goes through here.
 *
 * Returns { kept, refused }. `refused` is not a debug log — it is printed in
 * the operator's report and stored in diff.json, because a tool that silently
 * discards a third of what it found is a tool whose silence you cannot read.
 */
function enforceTruthLaw(seen, { theirEv, ourEv, images }) {
  const kept = [];
  const refused = [];
  const theirText = normalizeText(theirEv.measured.visibleText);
  const ourText = normalizeText(ourEv.measured.visibleText);

  for (const raw of Array.isArray(seen && seen.distinctive) ? seen.distinctive : []) {
    if (!raw || typeof raw !== "object") continue;
    const label = String(raw.label || "").slice(0, 200).trim();
    const kindRaw = String(raw.kind || "other").toLowerCase().trim();
    const kind = ALLOWED_KINDS.has(kindRaw) ? kindRaw : "other";
    const where = ["theirs", "ours", "both"].includes(String(raw.where)) ? String(raw.where) : "theirs";
    const quoted = String(raw.quotedText || "").slice(0, 300).trim();
    const prominence = ["dominant", "noticeable", "minor"].includes(String(raw.prominence)) ? String(raw.prominence) : "noticeable";

    if (!label) { refused.push({ label: "(no label)", kind, reason: "no_label", detail: "element reported with nothing describing it" }); continue; }

    // A model that describes a colour by value has stepped outside its remit.
    // Colours here are measured; one that arrived by opinion is dropped whole.
    //
    // The pattern is EXACT-LENGTH on purpose. `/#[0-9a-f]{3,8}/` also matches
    // "Lic. #44219" — a real licence number is hex-shaped — and the first cut of
    // this rule silently threw away the exact class of credential the tool
    // exists to carry across.
    if (LOOKS_LIKE_HEX.test(label)) {
      refused.push({ label, kind, reason: "model_emitted_a_colour", detail: "colour values are measured on our side, never taken from vision" });
      continue;
    }

    const isClaim = raw.isClaim === true || CLAIM_KINDS.has(kind) || looksLikeClaim(quoted) || looksLikeClaim(label);
    const normQuoted = normalizeText(quoted);
    const inTheirs = normQuoted.length >= 3 && theirText.includes(normQuoted);
    const inOurs = normQuoted.length >= 3 && ourText.includes(normQuoted);
    const textVerified = where === "ours" ? inOurs : where === "both" ? (inTheirs && inOurs) : inTheirs;

    // A hex INSIDE quoted text is fine if the page really prints it — quoting
    // what is on the page is the whole job. Unverified, it is a colour by
    // another route, and goes out the same door.
    if (LOOKS_LIKE_HEX.test(quoted) && !textVerified) {
      refused.push({ label, kind, quotedText: quoted, reason: "model_emitted_a_colour", detail: "a colour value quoted as page text that the page does not contain" });
      continue;
    }

    // THE RULE THAT MATTERS. A claim we cannot find in the page's own text was
    // read off a raster image, and there is no way to tell a correct read from
    // a confident misread. Drop it, name it, never carry it over.
    if (isClaim && !quoted) {
      refused.push({ label, kind, reason: "claim_without_quoted_text", detail: "a credential/award/offer must quote its exact printed words" });
      continue;
    }
    if (isClaim && !textVerified) {
      // TWO VERY DIFFERENT FAILURES WEAR THE SAME MASK.
      //
      // If the words are nowhere at all, the model read a badge off a JPEG and
      // we cannot trust the read. If the words are on OUR MIRROR and not on
      // their site, nothing was misread: our build is publishing a claim the
      // business never made. Measured on monolithtattoocompany.com — their
      // entire page carries no tattoo price, and our mirror advertises a $150
      // deposit, a $250 minimum and a $220/hr rate under their logo.
      const onlyOnOurs = where !== "ours" && inOurs && !inTheirs;
      refused.push({
        label, kind, quotedText: quoted,
        reason: onlyOnOurs ? "claim_only_on_our_mirror" : "claim_text_not_found_in_page",
        detail: onlyOnOurs
          ? `"${quoted}" is on OUR MIRROR and nowhere in the prospect's own rendered text — we are publishing a claim they never made`
          : `"${quoted}" does not appear in the ${where === "ours" ? "mirror's" : "prospect's"} own rendered text — it was read off an image and cannot be trusted`,
      });
      continue;
    }

    const confidence = Math.min(SEEN_CEILING, clamp01(raw.confidence === undefined ? 0.5 : raw.confidence));
    kept.push({
      kind, label, quotedText: quoted, isClaim, textVerified, where, prominence,
      confidence: round2(textVerified && isClaim ? Math.min(SEEN_CEILING + 0.15, confidence + 0.15) : confidence),
      region: verifyRegion(raw.region, images),
      source: "seen",
    });
  }

  return { kept, refused };
}

/** Free-text lists: keep them short, strip anything shaped like a hex. */
function cleanList(list, limit = 12) {
  return (Array.isArray(list) ? list : []).map((s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 300))
    .filter((s) => s && !/#[0-9a-f]{6}\b/i.test(s)).slice(0, limit);
}

// Grammatical words that are capitalised only because they start a sentence.
// Everything NOT here that is capitalised is treated as a name worth checking.
const PROSE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "their", "theirs", "our", "ours", "its", "it", "this", "that",
  "these", "those", "there", "here", "no", "not", "all", "both", "same", "different", "more", "less",
  "missing", "loss", "lost", "complete", "completely", "absence", "shift", "transformation", "from",
  "with", "without", "for", "of", "in", "on", "at", "to", "by", "as", "is", "are", "was", "were",
  "what", "when", "where", "which", "while", "whereas", "if", "then", "than", "very", "much",
]);

/**
 * Words that describe a PAGE, never a party. Only consulted for the first word
 * of a sentence, where English capitalises everything and the signal is gone.
 *
 * Without it the quarantine fills with "Dark purple background…", "Monospace
 * annotations…", "Photo of the van…" — measured, first real run — and the four
 * entries that actually matter (Wells, Fargo, Trane, BBB) are buried in noise.
 * A quarantine nobody reads protects nobody.
 */
const DESIGN_VOCAB = new Set([
  "dark", "light", "bright", "bold", "large", "small", "clean", "simple", "modern", "classic",
  "elegant", "refined", "warm", "cool", "minimal", "dramatic", "extensive", "detailed", "individual",
  "prominent", "subtle", "heavy", "thin", "wide", "narrow", "rounded", "sharp", "flat",
  "text", "type", "typography", "font", "serif", "sans", "monospace", "display", "headline", "heading",
  "photo", "photograph", "image", "picture", "video", "icon", "logo", "badge", "banner", "button",
  "link", "form", "map", "grid", "card", "section", "header", "footer", "hero", "layout", "design",
  "style", "colour", "color", "palette", "gradient", "background", "foreground", "overlay", "contrast",
  "whitespace", "space", "spacing", "border", "shadow", "animation", "motion", "scrolling", "sticky",
  "interactive", "technical", "editorial", "cinematic", "corner", "social", "star", "rating", "review",
  "reviews", "service", "services", "business", "page", "site", "website", "content", "copy",
  "artist", "team", "customer", "visitor", "user", "one", "two", "three", "four", "five", "several",
  "multiple", "various", "additional", "overall", "entire", "whole", "real", "actual", "original",
]);

/**
 * The names and numbers in a sentence — the parts that could be a third party's
 * brand, a licence number, a rating, or a year. These are what have to be found
 * on the page before a sentence naming them may be read as fact.
 *
 * Capitalisation is the signal, and English destroys it at the start of a
 * sentence. So a first word only counts as a name when a second capital follows
 * it ("Wells Fargo…") or when it is not design vocabulary ("Google reviews…").
 */
function significantTokens(line) {
  const s = String(line || "");
  const out = new Set();

  // Acronyms carry credentials: BBB, NATE, EPA, GAF, IICRC.
  for (const m of s.matchAll(/\b[A-Z]{2,}\b/g)) out.add(m[0]);

  // Numbers of two or more characters: 4.7, 681, 1961, 2026. A lone digit is
  // usually incidental and would only add noise.
  for (const m of s.matchAll(/\b\d[\d.,]*\d\b/g)) out.add(m[0]);

  const words = [...s.matchAll(/[A-Za-z][A-Za-z&'’-]*/g)].map((m) => m[0]);
  const nameish = (w) => w && /^[A-Z][a-z]/.test(w) && !PROSE_STOPWORDS.has(w.toLowerCase());
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w.length < 3 || !/^[A-Z]/.test(w) || PROSE_STOPWORDS.has(w.toLowerCase())) continue;
    if (i === 0 && !nameish(words[1]) && DESIGN_VOCAB.has(w.toLowerCase())) continue;
    out.add(w);
  }
  return [...out];
}

/**
 * The same rule as the element gate, applied to the model's PROSE.
 *
 * Without this the report contradicts itself: the gate refuses to carry over a
 * "Wells Fargo Home Projects credit card" it cannot find in the page, and then
 * the summary underneath tells the owner in plain English that the prospect has
 * one. Measured on the first real run — mmheatingandcooling.com's financing
 * banner and Trane badge exist only as pixels inside a JPEG, and the string
 * "Wells Fargo" is not anywhere in that page's HTML at all.
 *
 * Nothing is deleted. Unverifiable sentences move to a section that says so, so
 * they can still send a human to look at the screenshot — which is exactly the
 * right thing to do with them, and the wrong thing to do with a fact.
 */
function gateProse(list, pageText, limit = 20) {
  const verified = [];
  const unverified = [];
  for (const line of cleanList(list, limit)) {
    const tokens = significantTokens(line);
    const missing = tokens.filter((t) => !pageText.includes(normalizeText(t)));
    if (!missing.length) verified.push(line);
    else unverified.push({ text: line, notFoundInPageText: missing });
  }
  return { verified, unverified };
}

/**
 * Shapes of statement that a business is ACCOUNTABLE for. Scanned on our own
 * mirror, checked against the prospect's page, and reported when only we say it.
 */
const CLAIM_SCAN = [
  { kind: "price", re: /\$\s?\d[\d,]*(?:\.\d{2})?(?:\s*\/\s*(?:hr|hour))?/g },
  { kind: "rating", re: /\b\d(?:\.\d)?\s*(?:stars?\b|\/\s*5\b)/gi },
  { kind: "review_count", re: /\b\d{1,6}\s*\+?\s*(?:google\s+)?reviews?\b/gi },
  { kind: "since_year", re: /\bsince\s+(?:18|19|20)\d{2}\b/gi },
  { kind: "years_experience", re: /\b\d{1,3}\+?\s*years?(?:\s+of)?\s+experience\b/gi },
  { kind: "licence", re: /\blic(?:ense|ence)?d?\.?\s*#?\s*[A-Z0-9][A-Z0-9-]{2,}/gi },
  { kind: "warranty", re: /\b\d{1,3}[- ]year\s+(?:warranty|guarantee)\b/gi },
  { kind: "accreditation", re: /\bBBB\b[^.]{0,24}|\bA\+\s*(?:rated|accredited)\b/gi },
];

/**
 * Every accountable claim our mirror publishes that the prospect's own site
 * does not corroborate. MEASURED — no model is involved, and it runs even with
 * --no-vision.
 *
 * This is NOT automatically a lie: a Google rating legitimately comes from
 * Google and would not appear on their website. It IS the complete list of
 * statements a business could be asked to stand behind that they have not
 * themselves published — which is exactly the list a human should read before
 * the mirror goes to the business it names.
 */
function scanUncorroboratedClaims(ourText, theirText) {
  const theirs = normalizeText(theirText);
  const out = [];
  const seen = new Set();
  for (const { kind, re } of CLAIM_SCAN) {
    for (const m of String(ourText || "").matchAll(re)) {
      const text = m[0].replace(/\s+/g, " ").trim();
      const norm = normalizeText(text);
      if (norm.length < 2) continue;
      const key = `${kind}|${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (theirs.includes(norm)) continue;
      out.push({ kind, text, corroboratedOnTheirSite: false });
    }
  }
  return out.slice(0, 40);
}

// ---------------------------------------------------------------------------
// evidence crops
// ---------------------------------------------------------------------------

/**
 * Cut the clip each candidate came from, so a human can check the claim against
 * the actual pixels instead of taking the report's word for it.
 *
 * Two kinds, and the difference is stamped on every entry:
 *   measured   — we found the quoted text in the DOM and clipped its real box.
 *   indicated  — the model pointed at a rectangle. A pointer, not a measurement.
 */
async function cutEvidence(candidate, { theirEv, ourEv, images, dir, index }) {
  const ev = candidate.where === "ours" ? ourEv : theirEv;
  const page = ev._page;
  if (!page) return null;
  const file = path.join(dir, `carry-${String(index).padStart(2, "0")}-${slugify(candidate.label, 32)}.png`);

  if (candidate.textVerified && candidate.quotedText) {
    const box = await page.evaluate((needle) => {
      const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
      const want = norm(needle);
      if (!want) return null;
      let best = null;
      for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 6000)) {
        if (!norm(el.textContent).includes(want)) continue;
        if (Array.from(el.children).some((c) => norm(c.textContent).includes(want))) continue; // deepest wins
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        best = { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
        break;
      }
      return best;
    }, candidate.quotedText).catch(() => null);
    if (box) {
      const pad = 24;
      const clip = {
        x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
        width: Math.min(DESKTOP.width, box.width + pad * 2), height: Math.min(2000, box.height + pad * 2),
      };
      const buf = await page.screenshot({ type: "png", fullPage: true, clip }).catch(() => null);
      if (buf) { fs.writeFileSync(file, buf); return { file, rectSource: "measured", rect: clip, note: "DOM box of the element containing the quoted text" }; }
    }
  }

  if (candidate.region) {
    const shot = images[candidate.region.imageIndex - 1];
    if (!shot) return null;
    // Frame coords → page coords. Each frame is a viewport screenshot taken at
    // a known scrollY, so this conversion is exact for the desktop frames.
    if (shot.viewport !== "desktop" || shot.site !== (candidate.where === "ours" ? "ours" : "theirs")) return null;
    const clip = {
      x: Math.max(0, candidate.region.x * shot.width),
      y: Math.max(0, shot.scrollY + candidate.region.y * shot.height),
      width: Math.max(24, Math.min(shot.width, candidate.region.w * shot.width)),
      height: Math.max(24, Math.min(shot.height, candidate.region.h * shot.height)),
    };
    const buf = await page.screenshot({ type: "png", fullPage: true, clip }).catch(() => null);
    if (buf) { fs.writeFileSync(file, buf); return { file, rectSource: "indicated", rect: clip, note: "region the model pointed at — approximate, verify by eye" }; }
  }
  return null;
}

// ---------------------------------------------------------------------------
// the report
// ---------------------------------------------------------------------------

function bar(label, theirs, ours) {
  return `| ${label} | ${theirs} | ${ours} |`;
}

function renderReport(diff) {
  const m = diff.measured;
  const s = diff.seen || {};
  const L = [];
  const name = diff.business.name || hostOf(diff.their.url);

  L.push(`# Design diff — ${name}`);
  L.push("");
  L.push(`**Their site:** ${diff.their.url}`);
  L.push(`**Our mirror:** ${diff.ours.url}`);
  L.push(`${diff.business.trade ? `**Trade:** ${diff.business.trade}  ` : ""}**Run:** ${diff.generatedAt}  **Version:** ${diff.version}`);
  L.push("");

  if (s.closeness) {
    L.push(`## Verdict — ${s.closeness.score}/10`);
    L.push("");
    L.push(`> ${s.closeness.reason}`);
    L.push("");
  }

  L.push("## What is measured (not judged)");
  L.push("");
  L.push("| | Their site | Our mirror |");
  L.push("|---|---|---|");
  L.push(bar("Light or dark — **the fold**", `**${m.mode.theirs}** (${m.mode.theirSurface.hex || "?"})`, `**${m.mode.ours}** (${m.mode.ourSurface.hex || "?"}) ${m.mode.matched ? "matched" : "**MISMATCH**"}`));
  L.push(bar("Light or dark — whole page", `${m.mode.wholePageTheirs} (${m.mode.theirSurface.pageHex || "?"})`, `${m.mode.wholePageOurs} (${m.mode.ourSurface.pageHex || "?"}) ${m.mode.wholePageMatched ? "matched" : "**MISMATCH**"}`));
  L.push(bar("Brand colour", `${m.accent.theirs.hex || "unmeasurable"} <br><sub>${m.accent.theirs.source}</sub>`, `${m.accent.ours.hex || "unmeasurable"} <br><sub>${m.accent.ours.source}</sub>`));
  L.push(bar("Brand colour verdict", `${m.palette.theirChromaticCount} chromatic colours on the page`, `hue ${m.accent.hueDelta === null ? "?" : `${m.accent.hueDelta}°`} / lightness ${m.accent.lumDelta === null ? "?" : m.accent.lumDelta} apart — **${m.accent.verdict}**`));
  L.push(bar("Whole palette carried", `${m.palette.theirChromaticCount} to match`, `${m.palette.matchedCount} of ${m.palette.theirChromaticCount} in family — **${m.palette.familyMatch}**`));
  L.push(bar("Headline type", `${m.typography.theirs.display.family || "?"} ${m.typography.theirs.display.weight || ""}`, `${m.typography.ours.display.family || "?"} ${m.typography.ours.display.weight || ""} ${m.typography.displayMatched ? "matched" : "**different**"}`));
  L.push(bar("Body type", `${m.typography.theirs.body.family || "?"} ${m.typography.theirs.body.weight || ""}`, `${m.typography.ours.body.family || "?"} ${m.typography.ours.body.weight || ""} ${m.typography.bodyMatched ? "matched" : "**different**"}`));
  L.push(bar("Photographs (≥300px)", String(m.media.theirs.photographs), `**${m.media.ours.photographs}**`));
  L.push(bar("Distinct image files", String(m.media.theirs.distinctSources), String(m.media.ours.distinctSources)));
  L.push(bar("Badge-sized graphics", String(m.media.theirs.smallGraphics), String(m.media.ours.smallGraphics)));
  L.push(bar("Video", String(m.media.theirs.videos), String(m.media.ours.videos)));
  L.push(bar("Page height", `${m.scale.theirDocHeight}px`, `${m.scale.ourDocHeight}px`));
  L.push(bar("Words of copy", String(m.scale.theirWords), String(m.scale.ourWords)));
  L.push(bar("Forms", String(m.scale.theirForms), String(m.scale.ourForms)));
  L.push("");

  if (m.palette.rows.length) {
    L.push("### Their colours, and the nearest thing on ours");
    L.push("");
    L.push("| Theirs | Share of their page | Nearest on ours | Share of our page | Hue delta | Lightness delta | Verdict |");
    L.push("|---|---|---|---|---|---|---|");
    for (const r of m.palette.rows.slice(0, 8)) {
      const ourShare = r.ourPixelShare === null || r.ourPixelShare === undefined ? "—"
        : r.ourPixelShare >= 0.01 ? `${Math.round(r.ourPixelShare * 100)}%` : `${(r.ourPixelShare * 100).toFixed(1)}%`;
      L.push(`| ${r.theirs} | ${Math.round(r.theirShare * 100)}% | ${r.nearestOurs || "—"} | ${ourShare} | ${r.hueDelta === null ? "—" : `${r.hueDelta}°`} | ${r.lumDelta === null ? "—" : r.lumDelta} | ${r.verdict} |`);
    }
    L.push("");
  }

  if (s.typography) {
    L.push("### Typography character (seen)");
    L.push("");
    L.push(`- **Theirs reads:** ${s.typography.theirCharacter || "—"}`);
    L.push(`- **Ours reads:** ${s.typography.ourCharacter || "—"}`);
    L.push(`- ${s.typography.matches ? "Same character." : "**Different character.**"} ${s.typography.note || ""}`);
    L.push("");
  }

  if (s.colorImpression) {
    L.push(`### Colour, as a customer sees it (seen)`);
    L.push("");
    L.push(`**${String(s.colorImpression.matches || "?").toUpperCase()}** — ${s.colorImpression.note || ""}`);
    L.push("");
  }

  const unc = diff.uncorroboratedClaims || { measured: [], seen: [] };
  const uncCount = unc.measured.length + unc.seen.length;
  if (uncCount) {
    L.push(`## Claims our mirror makes that their own site does not — ${uncCount}`);
    L.push("");
    L.push(`_${unc.note}_`);
    L.push("");
    for (const r of unc.seen) L.push(`- **"${r.quotedText}"** — ${r.label} (seen, then checked)`);
    for (const c of unc.measured) L.push(`- \`${c.kind}\` **${c.text}**`);
    L.push("");
  }

  const carry = diff.carryOver || [];
  L.push(`## Carry-over candidates — ${carry.length}`);
  L.push("");
  L.push("_Nothing here is applied. This is a shortlist for a human, and the input to a later carry-over pass._");
  L.push("");
  if (!carry.length) {
    L.push("Nothing survived the checks. See refusals below.");
  } else {
    for (const c of carry) {
      L.push(`**${c.id}. ${c.label}** — \`${c.kind}\`, ${c.prominence}, confidence ${c.confidence}`);
      if (c.quotedText) L.push(`   - Reads: "${c.quotedText}" ${c.textVerified ? "(**verified in their page text**)" : "(not verified in page text — decorative only)"}`);
      if (c.isClaim) L.push(`   - CLAIM — verified against their own page text before being listed.`);
      if (c.evidence && c.evidence.file) L.push(`   - Evidence: \`${path.basename(c.evidence.file)}\` (${c.evidence.rectSource})`);
      else L.push(`   - Evidence: none could be cut — check the full-page screenshot by hand.`);
      L.push("");
    }
  }

  const missing = cleanList(s.missingFromOurs, 20);
  if (missing.length) {
    L.push("## What theirs has that ours does not (seen)");
    L.push("");
    for (const x of missing) L.push(`- ${x}`);
    L.push("");
  }
  if (m.copy.missingFromOurs.length) {
    L.push(`### Their headlines that appear nowhere on our page (measured — ${m.copy.missingFromOurs.length} of ${m.copy.theirHeadingCount})`);
    L.push("");
    for (const x of m.copy.missingFromOurs.slice(0, 15)) L.push(`- "${x}"`);
    L.push("");
  }
  const onlyOurs = cleanList(s.presentOnlyInOurs, 12);
  if (onlyOurs.length) {
    L.push("## What ours has that theirs does not (seen)");
    L.push("");
    for (const x of onlyOurs) L.push(`- ${x}`);
    L.push("");
  }
  const notice = cleanList(s.customerWouldNotice, 12);
  if (notice.length) {
    L.push("## What their customer would notice if the two were swapped (seen)");
    L.push("");
    for (const x of notice) L.push(`- ${x}`);
    L.push("");
  }

  const unverified = diff.unverifiedObservations || [];
  if (unverified.length) {
    L.push(`## Seen in the picture, NOT found in the page's own words — ${unverified.length}`);
    L.push("");
    L.push("**Do not act on these as facts.** Each names something the page's rendered text does not contain, which means it was read off a raster image and could be a misread. Open the screenshot and look before using any of it.");
    L.push("");
    for (const u of unverified) L.push(`- ${u.text}  <br><sub>not in ${u.checkedAgainst}: ${u.notFoundInPageText.map((t) => `\`${t}\``).join(", ")}</sub>`);
    L.push("");
  }

  const refusals = diff.refusals || [];
  L.push(`## Refused — ${refusals.length}`);
  L.push("");
  if (!refusals.length) L.push("Nothing was refused on this run.");
  else {
    L.push("_Dropped by the truth-law gate. Printed here on purpose: a tool that silently discards what it found is a tool whose silence you cannot read._");
    L.push("");
    for (const r of refusals) L.push(`- **${r.label}** \`${r.reason}\` — ${r.detail}`);
  }
  L.push("");

  L.push("## Provenance");
  L.push("");
  L.push(`- Screenshots: their site ${diff.their.captureMs}ms, our mirror ${diff.ours.captureMs}ms. Landed on \`${diff.their.landedOn}\` and \`${diff.ours.landedOn}\`.`);
  if (diff.their.fullPageTruncated || diff.ours.fullPageTruncated) L.push(`- Full-page capture capped at ${FULLPAGE_CAP}px${diff.their.fullPageTruncated ? " (theirs is longer)" : ""}${diff.ours.fullPageTruncated ? " (ours is longer)" : ""}.`);
  if (diff.their.overlayShareOfFold >= 0.05 || diff.ours.overlayShareOfFold >= 0.05) {
    L.push(`- **Overlays covered part of the fold in the shots the model was shown**: theirs ${Math.round((diff.their.overlayShareOfFold || 0) * 100)}%${(diff.their.overlays || []).length ? ` (${diff.their.overlays.map((o) => `"${o.text.slice(0, 40)}"`).join(", ")})` : ""}, ours ${Math.round((diff.ours.overlayShareOfFold || 0) * 100)}%. Anything reported "missing" behind one of these may simply have been covered.`);
  }
  L.push(`- Our own sign-up floater ${diff.ours.panelsSuppressed ? "was suppressed" : "was LEFT ON"} on the mirror capture.`);
  if (diff.vision) {
    L.push(`- Vision: ${diff.vision.provider} \`${diff.vision.model}\`, ${diff.vision.ms}ms${diff.vision.usage ? `, ${diff.vision.usage.inputTokens} in / ${diff.vision.usage.outputTokens} out${diff.vision.usage.costUsd !== null ? `, $${diff.vision.usage.costUsd.toFixed(4)}` : ""}` : ""}.`);
  } else {
    L.push(`- Vision: **not run** — ${diff.visionSkipped || "unknown reason"}. Everything above is the measured half only.`);
  }
  L.push(`- Colours and fonts in this report are MEASURED from the render. The vision model was never asked for one and any it volunteered was dropped.`);
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// one pair, end to end
// ---------------------------------------------------------------------------

async function runPair(browser, pair, opts) {
  const { their, ours, name = "", trade = "" } = pair;
  const outDir = opts.out || path.join(__dirname, "..", "artifacts", "design-diffs", slugify(hostOf(their) || name));
  fs.mkdirSync(outDir, { recursive: true });
  // Clear the evidence from the LAST run first. Crop filenames are numbered by
  // position, and the shortlist changes between runs — leaving the old ones in
  // place means an operator can open carry-04-*.png from a report that has no
  // fourth candidate and check a claim nobody made.
  const evidenceDir = path.join(outDir, "evidence");
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  let theirEv = null;
  let ourEv = null;
  try {
    theirEv = await captureSite(browser, their, { label: "theirs", outDir, prefix: "their", suppressPanels: false });
    if (!theirEv.ok) return { ok: false, reason: `their_site_capture_failed:${theirEv.reason}`, outDir };
    ourEv = await captureSite(browser, ours, { label: "ours", outDir, prefix: "our", suppressPanels: !opts.withPanels });
    if (!ourEv.ok) return { ok: false, reason: `our_mirror_capture_failed:${ourEv.reason}`, outDir };

    const measured = measuredDiff(theirEv, ourEv);

    // Interleave so the model reads them as a pair, not as two galleries.
    const images = [
      ...theirEv.shots.filter((s) => s.viewport === "desktop"),
      ...ourEv.shots.filter((s) => s.viewport === "desktop"),
      ...theirEv.shots.filter((s) => s.viewport === "mobile"),
      ...ourEv.shots.filter((s) => s.viewport === "mobile"),
    ];

    let vision = null;
    let seen = null;
    let refusals = [];
    let kept = [];
    let visionSkipped = "";

    if (opts.noVision) {
      visionSkipped = "--no-vision";
    } else {
      const res = await callVision({ prompt: buildPrompt(images, { name, trade }), images, model: opts.model });
      if (res.ok) {
        vision = { provider: res.provider, model: res.model, ms: res.ms, usage: res.usage };
        seen = res.parsed;
        const gate = enforceTruthLaw(seen, { theirEv, ourEv, images });
        kept = gate.kept;
        refusals = gate.refused;
      } else {
        visionSkipped = res.reason;
      }
    }

    // Carry-over = things on THEIR page that ours does not have. An element the
    // model marks "both" is not a gap and does not belong on the shortlist.
    const carryOver = [];
    let i = 0;
    for (const c of kept) {
      if (c.where !== "theirs") continue;
      // Measured cross-check: if we can find its words on OUR page too, it is
      // already carried over, whatever the model said.
      if (c.quotedText && normalizeText(ourEv.measured.visibleText).includes(normalizeText(c.quotedText))) {
        refusals.push({ label: c.label, kind: c.kind, reason: "already_present_on_our_page", detail: `"${c.quotedText}" is already in our mirror's rendered text` });
        continue;
      }
      i += 1;
      const evidence = await cutEvidence(c, { theirEv, ourEv, images, dir: evidenceDir, index: i }).catch(() => null);
      carryOver.push({
        id: i, kind: c.kind, label: c.label, quotedText: c.quotedText, isClaim: c.isClaim,
        textVerified: c.textVerified, prominence: c.prominence, confidence: c.confidence,
        source: "seen", evidence: evidence || null,
        apply: "manual_review_required",
      });
    }

    const theirText = normalizeText(theirEv.measured.visibleText);
    const ourText = normalizeText(ourEv.measured.visibleText);
    const prose = seen ? {
      missing: gateProse(seen.missingFromOurs, theirText, 20),
      onlyOurs: gateProse(seen.presentOnlyInOurs, ourText, 12),
      notice: gateProse(seen.customerWouldNotice, theirText, 12),
    } : { missing: { verified: [], unverified: [] }, onlyOurs: { verified: [], unverified: [] }, notice: { verified: [], unverified: [] } };

    const diff = {
      version: DIFF_VERSION,
      generatedAt: new Date().toISOString(),
      business: { name, trade },
      their: {
        url: their, finalUrl: theirEv.finalUrl, landedOn: theirEv.landedOn, captureMs: theirEv.captureMs,
        fullPageTruncated: theirEv.fullPageTruncated, files: theirEv.files,
        overlays: theirEv.measured.overlays || [], overlayShareOfFold: theirEv.measured.overlayShareOfFold || 0,
        shots: theirEv.shots.map((s) => ({ id: s.id, file: s.file, viewport: s.viewport, scrollY: s.scrollY })),
      },
      ours: {
        url: ours, finalUrl: ourEv.finalUrl, landedOn: ourEv.landedOn, captureMs: ourEv.captureMs,
        fullPageTruncated: ourEv.fullPageTruncated, panelsSuppressed: !opts.withPanels, files: ourEv.files,
        overlays: ourEv.measured.overlays || [], overlayShareOfFold: ourEv.measured.overlayShareOfFold || 0,
        shots: ourEv.shots.map((s) => ({ id: s.id, file: s.file, viewport: s.viewport, scrollY: s.scrollY })),
      },
      measured,
      seen: seen ? {
        mode: seen.mode || null,
        colorImpression: seen.colorImpression || null,
        typography: seen.typography || null,
        missingFromOurs: prose.missing.verified,
        presentOnlyInOurs: prose.onlyOurs.verified,
        customerWouldNotice: prose.notice.verified,
        closeness: seen.closeness && Number.isFinite(Number(seen.closeness.score))
          ? { score: Math.max(0, Math.min(10, Math.round(Number(seen.closeness.score)))), reason: String(seen.closeness.reason || "").slice(0, 400) }
          : null,
        distinctiveKept: kept,
      } : null,
      carryOver,
      // The list a human must read before this mirror reaches the business it
      // names: every accountable claim we publish that their own site does not.
      uncorroboratedClaims: {
        measured: scanUncorroboratedClaims(ourEv.measured.visibleText, theirEv.measured.visibleText),
        seen: refusals.filter((r) => r.reason === "claim_only_on_our_mirror"),
        note: "measured on our mirror's rendered text, checked against theirs. Not automatically wrong — a Google rating comes from Google — but nothing here is corroborated by the business's own website.",
      },
      refusals,
      // Seen in the picture, NOT found in the page's own words. Kept, labelled,
      // and never presented as fact — see gateProse().
      unverifiedObservations: [
        ...prose.missing.unverified.map((u) => ({ ...u, list: "missingFromOurs", checkedAgainst: "their page text" })),
        ...prose.onlyOurs.unverified.map((u) => ({ ...u, list: "presentOnlyInOurs", checkedAgainst: "our page text" })),
        ...prose.notice.unverified.map((u) => ({ ...u, list: "customerWouldNotice", checkedAgainst: "their page text" })),
      ],
      vision,
      visionSkipped: visionSkipped || null,
      truthLaw: {
        rule: "every quoted string is checked against the page's own rendered innerText; a CLAIM that is not found there is refused, never carried over",
        seenConfidenceCeiling: SEEN_CEILING,
        modelMayEmitColours: false,
      },
    };

    // MEASURED disagreeing with SEEN is worth knowing about, and measured wins.
    //
    // But only when BOTH measurements disagree. The first cut of this refused
    // vision's "ours is dark" on M & M because the whole-page histogram said
    // light — and vision was right about the screen a visitor lands on. A gate
    // that overrules a correct observation with a mis-scoped measurement is
    // worse than no gate.
    const contradiction = (side, saw) => {
      const surface = side === "theirs" ? measured.mode.theirSurface : measured.mode.ourSurface;
      if (!saw || saw === "mixed") return;
      if (saw === surface.mode || saw === surface.pageMode) return;
      diff.refusals.push({
        label: `vision called ${side === "theirs" ? "their site" : "our mirror"} "${saw}"`,
        kind: "mode", reason: "contradicted_by_measurement",
        detail: `pixels measured ${surface.mode} at the fold (${surface.hex}) and ${surface.pageMode} across the whole page (${surface.pageHex}); the measurement stands`,
      });
    };
    if (seen && seen.mode) { contradiction("theirs", seen.mode.theirs); contradiction("ours", seen.mode.ours); }

    // The exact text every verification ran against, on disk, so a refusal can
    // still be checked next week without re-rendering anything.
    fs.writeFileSync(path.join(outDir, "their-page-text.txt"), theirEv.measured.visibleText || "");
    fs.writeFileSync(path.join(outDir, "our-page-text.txt"), ourEv.measured.visibleText || "");
    fs.writeFileSync(path.join(outDir, "diff.json"), JSON.stringify(diff, null, 2));
    fs.writeFileSync(path.join(outDir, "carry-over.json"), JSON.stringify({
      schema: "design-diff-carry-over-v1",
      note: "CANDIDATES ONLY. Nothing here has been applied and nothing here may be applied automatically. Every entry with isClaim:true has had its quoted text verified against the prospect's own rendered page text; entries with textVerified:false are decorative shapes only and carry no claim.",
      business: { name, trade }, their: their, ours: ours, generatedAt: diff.generatedAt,
      candidates: carryOver,
    }, null, 2));
    const report = renderReport(diff);
    fs.writeFileSync(path.join(outDir, "report.md"), report);

    return { ok: true, outDir, diff, report };
  } finally {
    if (theirEv && theirEv._close) await theirEv._close();
    if (ourEv && ourEv._close) await ourEv._close();
  }
}

// ---------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { flags[a.slice(2)] = next; i += 1; }
    else flags[a.slice(2)] = true;
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(4, 40).join("\n").replace(/^\/\/ ?/gm, ""));
    return 0;
  }

  if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    try { require("./brightdata-edit-proof/env").loadEnv(); } catch { /* env carries what it carries */ }
  }

  const pairs = [];
  if (typeof flags.batch === "string") {
    const raw = JSON.parse(fs.readFileSync(path.resolve(flags.batch), "utf8"));
    for (const row of Array.isArray(raw) ? raw : []) {
      pairs.push({
        name: String(row.name || row.business_name || ""),
        trade: String(row.trade || row.industry || ""),
        their: String(row.their || row.their_site || row.current_website || row.own || ""),
        ours: String(row.ours || row.mirror || row.preview_url || ""),
      });
    }
  }
  if (typeof flags.their === "string" && typeof flags.ours === "string") {
    pairs.push({ name: String(flags.name || ""), trade: String(flags.trade || ""), their: flags.their, ours: flags.ours });
  }
  const limit = Number(flags.limit) || pairs.length;
  const work = pairs.filter((p) => /^https?:\/\//i.test(p.their) && /^https?:\/\//i.test(p.ours)).slice(0, limit);

  if (!work.length) {
    console.error("usage: node scripts/design-diff.js --their <url> --ours <url> [--name X] [--trade Y] [--no-vision]");
    console.error("       node scripts/design-diff.js --batch pairs.json [--limit N]");
    return 2;
  }

  const opts = {
    noVision: Boolean(flags["no-vision"]),
    withPanels: Boolean(flags["with-panels"]),
    model: typeof flags.model === "string" ? flags.model : "",
    out: typeof flags.out === "string" ? path.resolve(flags.out) : "",
  };

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const summaries = [];
  try {
    for (const pair of work) {
      const label = pair.name || hostOf(pair.their);
      process.stderr.write(`\n=== ${label}\n    theirs: ${pair.their}\n    ours:   ${pair.ours}\n`);
      const t0 = Date.now();
      let res;
      try {
        res = await runPair(browser, pair, work.length > 1 ? { ...opts, out: "" } : opts);
      } catch (e) {
        res = { ok: false, reason: `threw:${String((e && e.message) || e).split("\n")[0].slice(0, 160)}` };
      }
      if (!res.ok) {
        process.stderr.write(`    FAILED: ${res.reason}\n`);
        summaries.push({ name: label, ok: false, reason: res.reason });
        continue;
      }
      const d = res.diff;
      process.stderr.write(
        `    ${Math.round((Date.now() - t0) / 1000)}s  closeness=${d.seen && d.seen.closeness ? `${d.seen.closeness.score}/10` : "n/a"}` +
        `  mode ${d.measured.mode.theirs}/${d.measured.mode.ours}${d.measured.mode.matched ? "" : " MISMATCH"}` +
        `  accent ${d.measured.accent.theirs.hex || "?"}→${d.measured.accent.ours.hex || "?"} (${d.measured.accent.verdict})` +
        `  photos ${d.measured.media.theirs.photographs}→${d.measured.media.ours.photographs}` +
        `  carry-over ${d.carryOver.length}  refused ${d.refusals.length}` +
        `  uncorroborated ${d.uncorroboratedClaims.measured.length + d.uncorroboratedClaims.seen.length}\n    -> ${res.outDir}\n`,
      );
      summaries.push({
        name: label, ok: true, outDir: res.outDir,
        closeness: d.seen && d.seen.closeness ? d.seen.closeness.score : null,
        modeMatched: d.measured.mode.matched, accentVerdict: d.measured.accent.verdict,
        carryOver: d.carryOver.length, refusals: d.refusals.length,
        uncorroborated: d.uncorroboratedClaims.measured.length + d.uncorroboratedClaims.seen.length,
        costUsd: d.vision && d.vision.usage ? d.vision.usage.costUsd : null,
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (flags.json) console.log(JSON.stringify(summaries, null, 2));
  else {
    console.log("\n================ design-diff summary ================");
    for (const s of summaries) {
      console.log(s.ok
        ? `${String(s.name).slice(0, 32).padEnd(32)} close=${s.closeness === null ? " - " : `${s.closeness}/10`}  mode=${s.modeMatched ? "match" : "MISMATCH"}  accent=${s.accentVerdict.padEnd(16)} carry=${String(s.carryOver).padStart(2)}  refused=${String(s.refusals).padStart(2)}  uncorroborated=${String(s.uncorroborated).padStart(2)}`
        : `${String(s.name).slice(0, 32).padEnd(32)} FAILED ${s.reason}`);
    }
    const spend = summaries.reduce((a, s) => a + (s.costUsd || 0), 0);
    if (spend) console.log(`\nvision spend: $${spend.toFixed(4)}`);
  }
  return summaries.some((s) => !s.ok) ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = {
  // exported for tests — every one of these is pure
  DIFF_VERSION, SEEN_CEILING, CLAIM_KINDS, ALLOWED_KINDS,
  looksLikeClaim, normalizeText, parseCssColor, toHex, rgbToHsl, hueDistance, isChromatic,
  relLum, contrastRatio, rankTally, decodePng, paletteFromPng,
  surfaceOf, accentOf, comparePalettes, compareCopy, measuredDiff,
  enforceTruthLaw, verifyRegion, extractJsonObject, cleanList, renderReport,
  significantTokens, gateProse, scanUncorroboratedClaims, captureSite, runPair,
};
