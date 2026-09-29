"use strict";

// lib/mirror-engine/perf-pipeline.js — FEATURE 8: build-time performance
// transforms over the hydrated mirror's HTML, as a self-contained pass wired
// into the engine's per-page emit.
//
// The spec's Lighthouse-mobile-≥85 class of improvement, from MARKUP ALONE:
//
//   1. CLS KILL — every <img> whose source resolves to a file in the build
//      gets width/height attributes. The dimensions are read from the image
//      bytes themselves (PNG IHDR / JPEG SOF / GIF / WEBP headers, pure JS —
//      no sharp, no native dep, works in the serverless build env where an
//      image pipeline does not). With intrinsic dimensions present, the
//      browser reserves the exact aspect-ratio box before the bytes arrive.
//   2. LAZY BELOW-FOLD — every <img> without an explicit loading attribute
//      gets loading="lazy" decoding="async", so offscreen photographs stop
//      competing with the LCP image for bandwidth.
//   3. EAGER HERO — the hero image (the asset the engine identified as the
//      hero/poster, and any image inside the SSR hero section) gets
//      loading="eager" decoding="async", and the single hero asset gets
//      fetchpriority="high". A hero that carries loading="lazy" — donors do
//      ship it — loses it here: lazy-loading your own LCP element is the one
//      mistake this pipeline exists to erase. The hero also gains a
//      <link rel="preload"> when no preload exists yet (content-inject adds
//      one on content builds; this covers the content-empty path).
//   4. PRECONNECT — the third-party origins the pages actually reference
//      (webfonts, media CDNs) get <link rel="preconnect"> hints before
//      </head>, so the first font/image request skips the DNS+TCP+TLS
//      handshake. fonts.googleapis.com/fonts.gstatic.com included when the
//      page loads webfonts from them.
//
// Everything is guarded by "already present" checks, so the pass is
// IDEMPOTENT: transform(transform(tree)) === transform(tree). A perf failure
// must never fail a build — the engine wraps the call; this module itself
// never throws on malformed input, it skips and reports.

// ---------------------------------------------------------------------------
// Image header parsing — intrinsic dimensions from bytes, no dependencies.
// ---------------------------------------------------------------------------

/**
 * {width, height} from an image Buffer's header, or null when the bytes are
 * not a decodable PNG/JPEG/GIF/WEBP (or are too short to tell).
 */
function imageSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24) return null;
  // PNG: 8-byte signature, IHDR at offset 16 (big-endian u32 each).
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    if (bytes.length < 24) return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  // GIF: "GIF8" then little-endian u16 logical screen size.
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  // WEBP: "RIFF"...."WEBP", then VP8/VP8L/VP8X chunk.
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") {
    return webpSize(bytes);
  }
  // JPEG: walk the segment chain for a SOFn frame header.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return jpegSize(bytes);
  }
  return null;
}

function webpSize(bytes) {
  const format = bytes.slice(12, 16).toString("ascii");
  try {
    if (format === "VP8 ") {
      // Lossy: frame tag at 20, then 3-byte start code, then 14-bit dims.
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (format === "VP8L") {
      // Lossless: 14-bit width-1 and height-1 packed into 4 bytes at 21.
      const b = bytes.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (format === "VP8X") {
      // Extended: 24-bit width-1 and height-1 at offsets 24 and 27.
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
  } catch {
    return null;
  }
  return null;
}

function jpegSize(bytes) {
  let off = 2;
  try {
    while (off + 9 < bytes.length) {
      if (bytes[off] !== 0xff) { off += 1; continue; }
      const marker = bytes[off + 1];
      // Standalone markers without a length payload.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
      const len = bytes.readUInt16BE(off + 2);
      // SOF0-SOF15 minus DHT (C4), JPG (C8), DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(off + 5), width: bytes.readUInt16BE(off + 7) };
      }
      if (marker === 0xda) break; // start of scan — no SOF found
      off += 2 + len;
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML transform helpers.
// ---------------------------------------------------------------------------

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const DATA_URI_RE = /^data:/i;

function attrOf(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null; // null = absent; "" = present but empty
}

function hasAttr(tag, name) {
  return new RegExp(`\\b${name}\\s*=`, "i").test(tag);
}

/**
 * Resolve an img src against the build's file map. Accepts root-relative
 * ("/assets/x.jpg"), page-relative ("assets/x.jpg", "./assets/x.jpg") and
 * absolute same-origin URLs. Returns the files-map key or "".
 */
function resolveLocalAsset(src, files, pageRel) {
  const raw = String(src || "").trim();
  if (!raw || DATA_URI_RE.test(raw)) return "";
  const clean = raw.split(/[?#]/)[0].replace(/^\.\/+/, "");
  const candidates = [];
  if (/^https?:\/\//i.test(clean)) {
    try {
      const u = new URL(clean);
      candidates.push(u.pathname.replace(/^\//, ""));
    } catch { /* not same-origin parseable */ }
  } else {
    candidates.push(clean.replace(/^\/+/, ""));
    const dir = pageRel.includes("/") ? pageRel.slice(0, pageRel.lastIndexOf("/") + 1) : "";
    candidates.push(dir + clean.replace(/^\/+/, ""));
  }
  for (const c of candidates) {
    const key = Object.keys(files).find((k) => k.toLowerCase() === c.toLowerCase());
    if (key && Buffer.isBuffer(files[key])) return key;
  }
  return "";
}

/** Insert width/height attributes right after `<img` (start-tag head). */
function withDimensions(tag, width, height) {
  return tag.replace(/^<img\b/i, `<img width="${width}" height="${height}"`);
}

/** Set/replace a single attribute's value on a tag. */
function setAttr(tag, name, value) {
  if (hasAttr(tag, name)) {
    return tag.replace(new RegExp(`\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "i"), `${name}="${value}"`);
  }
  return tag.replace(/^<img\b/i, `<img ${name}="${value}"`);
}

function dropAttr(tag, name) {
  return tag.replace(new RegExp(`\\s*\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "i"), "");
}

/**
 * The spans of the SSR hero section (content-inject's data-wss-ssr-hero
 * instrument / full-bleed variants): images inside these are above the fold
 * by definition and must never ship lazy.
 */
function heroSpans(html) {
  const spans = [];
  const re = /<section\b[^>]*data-wss-ssr-hero[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const close = html.indexOf("</section>", m.index);
    spans.push([m.index, close === -1 ? html.length : close]);
  }
  return spans;
}

function inSpans(spans, index) {
  return spans.some(([a, b]) => index >= a && index <= b);
}

/**
 * Third-party https origins referenced by the page (link/script/img/iframe/
 * source), excluding the site's own origin. Ordered by first appearance;
 * the caller caps how many earn a preconnect slot.
 */
function externalOrigins(html, siteUrl) {
  let selfHost = "";
  try { selfHost = new URL(siteUrl || "https://invalid.invalid").host; } catch { /* no site url */ }
  const origins = [];
  const seen = new Set();
  const re = /(?:src|href|data-src)\s*=\s*"(https:\/\/[^"']+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    let u;
    try { u = new URL(m[1]); } catch { continue; }
    if (!u.hostname || u.hostname === selfHost) continue;
    const origin = u.origin;
    if (seen.has(origin)) continue;
    seen.add(origin);
    origins.push(origin);
  }
  return origins;
}

const MAX_PRECONNECTS = 4;
const PRECONNECT_MARKER = "data-wss-perf";

/**
 * The whole pipeline over the build's flat file map { rel -> Buffer }.
 * Every .html file is transformed independently (page-relative asset paths
 * resolve against the page's own directory); image bytes for dimension
 * extraction come from the same map, so no network request is ever made.
 *
 * Hero detection: the caller's heroAsset (content-inject's hero_preload)
 * wins; otherwise the same heuristic content-inject uses — a shipped file
 * named "hero…" or "poster…" with an image extension. Returns
 * { files, report } shaped like every other engine pass, never throwing.
 */
function applyPerfTransforms({ files = {}, heroAsset = "", siteUrl = "" } = {}) {
  const out = {};
  for (const [rel, buf] of Object.entries(files)) out[rel] = buf;
  const report = {
    status: "applied",
    pages_transformed: 0,
    imgs_dimensioned: 0,
    imgs_lazy: 0,
    imgs_eager: 0,
    imgs_lazy_from_eager: 0,
    preconnects_added: 0,
    hero_preloaded: false,
    hero_asset: "",
  };
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    report.status = "files_must_be_a_flat_object_map";
    return { files: out, report };
  }
  let hero = String(heroAsset || "");
  if (!hero) {
    hero = Object.keys(out).find((f) => /(hero|poster)[^/]*\.(jpe?g|png|webp|avif)$/i.test(f)) || "";
  }
  report.hero_asset = hero;

  for (const rel of Object.keys(files)) {
    if (!/\.html$/i.test(rel)) continue;
    const buf = files[rel];
    // The engine ships Buffers; string values (the fleet-polish input shape)
    // are accepted so both callers transform identically. Anything else skips.
    const html = Buffer.isBuffer(buf) ? buf.toString("utf8")
      : typeof buf === "string" ? buf
      : null;
    if (html == null) continue;
    try {
      const result = transformHtml(html, { files: out, pageRel: rel, heroAsset: hero, siteUrl });
      out[rel] = Buffer.from(result.html, "utf8");
      report.pages_transformed += 1;
      report.imgs_dimensioned += result.report.imgs_dimensioned;
      report.imgs_lazy += result.report.imgs_lazy;
      report.imgs_eager += result.report.imgs_eager;
      report.imgs_lazy_from_eager += result.report.imgs_lazy_from_eager;
      report.preconnects_added += result.report.preconnects_added;
      report.hero_preloaded = report.hero_preloaded || result.report.hero_preloaded;
    } catch {
      // One malformed page skips alone; the rest of the fleet still ships.
    }
  }
  return { files: out, report };
}

/**
 * The whole pipeline over one HTML string. Returns { html, report } where
 * report counts each applied transform for the engine's build manifest.
 */
function transformHtml(html, { files = {}, pageRel = "", heroAsset = "", siteUrl = "" } = {}) {
  const report = {
    imgs_dimensioned: 0,
    imgs_lazy: 0,
    imgs_eager: 0,
    imgs_lazy_from_eager: 0,
    preconnects_added: 0,
    hero_preloaded: false,
  };

  // The hero asset's basename: an <img> whose src carries it IS the hero.
  const heroBase = String(heroAsset || "").split("/").pop().toLowerCase();

  const spans = heroSpans(html);
  let out = html.replace(IMG_TAG_RE, (tag, offset) => {
    const src = attrOf(tag, "src") || attrOf(tag, "data-src") || "";
    let next = tag;

    // --- CLS: intrinsic dimensions from the build's own bytes -------------
    if (!hasAttr(next, "width") || !hasAttr(next, "height")) {
      const assetKey = resolveLocalAsset(src, files, pageRel);
      const dims = assetKey ? imageSize(files[assetKey]) : null;
      if (dims && dims.width > 0 && dims.height > 0) {
        next = withDimensions(next, dims.width, dims.height);
        report.imgs_dimensioned += 1;
      }
    }

    // --- EAGER vs LAZY -----------------------------------------------------
    const srcLower = String(src).toLowerCase();
    const isHeroAsset = heroBase && srcLower.includes(heroBase);
    const isHeroSection = inSpans(spans, offset);
    if (isHeroAsset || isHeroSection) {
      // The LCP image never waits behind a lazy gate.
      if (/\bloading\s*=\s*["']?lazy/i.test(next)) {
        next = dropAttr(next, "loading");
        report.imgs_lazy_from_eager += 1;
      }
      if (!hasAttr(next, "loading")) {
        next = setAttr(next, "loading", "eager");
        report.imgs_eager += 1;
      }
      if (isHeroAsset && !hasAttr(next, "fetchpriority")) {
        next = setAttr(next, "fetchpriority", "high");
      }
      if (!hasAttr(next, "decoding")) next = setAttr(next, "decoding", "async");
    } else if (!DATA_URI_RE.test(src)) {
      if (!hasAttr(next, "loading")) {
        next = setAttr(next, "loading", "lazy");
        report.imgs_lazy += 1;
      }
      if (!hasAttr(next, "decoding")) next = setAttr(next, "decoding", "async");
    }
    return next;
  });

  // NOTE on offsets: String.replace with a replacer passes each match's
  // offset into the ORIGINAL string, and heroSpans() was computed over that
  // same original — so hero-section membership is exact for every tag even
  // as earlier substitutions change the output length.

  // --- HEAD: hero preload + preconnect hints ------------------------------
  const headClose = out.search(/<\/head>/i);
  if (headClose > -1) {
    const head = out.slice(0, headClose);
    const add = [];
    if (heroAsset && /\.(jpe?g|png|webp|avif)$/i.test(heroAsset) && !/rel\s*=\s*["']preload["']/i.test(out)) {
      add.push(`<link rel="preload" as="image" href="/${String(heroAsset).replace(/"/g, "&quot;")}" fetchpriority="high" ${PRECONNECT_MARKER}="preload" />`);
      report.hero_preloaded = true;
    }
    const already = (head.match(/<link\b[^>]*rel=["']preconnect["'][^>]*>/gi) || [])
      .map((t) => (attrOf(t, "href") || "").toLowerCase());
    const origins = externalOrigins(out, siteUrl)
      .filter((o) => !already.includes(o.toLowerCase()))
      .slice(0, MAX_PRECONNECTS);
    for (const origin of origins) {
      const cross = /(?:^|\.)gstatic\.com$/.test(new URL(origin).hostname) ? " crossorigin" : "";
      add.push(`<link rel="preconnect" href="${origin}"${cross} ${PRECONNECT_MARKER}="preconnect" />`);
      report.preconnects_added += 1;
    }
    if (add.length) {
      out = out.slice(0, headClose) + add.join("\n") + "\n" + out.slice(headClose);
    }
  }

  return { html: out, report };
}

module.exports = {
  imageSize,
  resolveLocalAsset,
  externalOrigins,
  transformHtml,
  applyPerfTransforms,
  MAX_PRECONNECTS,
  PRECONNECT_MARKER,
};

// -------------------------------------------------------------------------
// Self-test: node lib/mirror-engine/perf-pipeline.js --test
// -------------------------------------------------------------------------
if (require.main === module && process.argv.includes("--test")) {
  const assert = require("node:assert/strict");

  // A real 1x2 PNG (IHDR says 1x2) so header parsing is proven, not mocked.
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000020806000000f47848be0000000a49444154789c6360000002000148afa4710000000049454e44ae426082",
    "hex",
  );
  const dims = imageSize(png);
  assert.equal(dims.width, 1);
  assert.equal(dims.height, 2);

  const files = { "assets/hero-sunset.jpg": png, "assets/body.jpg": png };
  const page = [
    "<html><head><title>t</title></head><body>",
    `<section data-wss-ssr-hero="full-bleed"><img src="/assets/hero-sunset.jpg" alt="hero"></section>`,
    `<img src="assets/body.jpg" alt="body">`,
    `<img src="https://images.example.com/remote.webp" alt="remote" width="100">`,
    `<img src="data:image/gif;base64,R0lGOD" alt="inline">`,
    `<img src="/assets/hero-sunset.jpg" alt="dupe" loading="lazy">`,
    `<script src="https://fonts.googleapis.com/css2?family=Rubik"></script>`,
    "</body></html>",
  ].join("");

  const one = transformHtml(page, { files, pageRel: "index.html", heroAsset: "assets/hero-sunset.jpg", siteUrl: "https://x.wss-ai.com/" });
  const heroTag = /<img\b[^>]*hero-sunset[^>]*>/gi.exec(one.html)[0];
  assert.ok(/\bwidth="1"\s+height="2"|<img\s+width="1"\s+height="2"/.test(heroTag.replace(/^<img\s+/, "<img ")), "dims from bytes");
  assert.ok(!/loading="lazy"/i.test(heroTag), "hero never lazy");
  assert.ok(/loading="eager"/i.test(heroTag), "hero eager");
  assert.ok(/fetchpriority="high"/i.test(heroTag), "hero fetchpriority");
  const bodyTag = /<img\b[^>]*assets\/body\.jpg[^>]*>/i.exec(one.html)[0];
  assert.ok(/width="1"/.test(bodyTag) && /height="2"/.test(bodyTag), "body dims");
  assert.ok(/loading="lazy"/.test(bodyTag), "body lazy");
  assert.ok(one.report.preconnects_added >= 1, "preconnect added");
  const two = transformHtml(one.html, { files, pageRel: "index.html", heroAsset: "assets/hero-sunset.jpg", siteUrl: "https://x.wss-ai.com/" });
  assert.equal(two.html, one.html, "idempotent");
  console.log("perf-pipeline self-test: OK");
}
