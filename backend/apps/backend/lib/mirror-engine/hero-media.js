"use strict";

// lib/mirror-engine/hero-media.js — the client's OWN hero imagery, extracted
// from their live site at build time.
//
// OWNER (2026-09-02, hero-authenticity report): "A hero is the highest-impact
// identity surface. Prefer a donor-owned, relevant, high-resolution hero;
// otherwise use a neutral trade fallback that cannot be mistaken for
// donor-owned project evidence." The measured defect behind this module: a
// concrete contractor with strong blue/orange branding, a JS logo, a
// stamped-concrete texture and local project imagery shipped behind a GENERIC
// Atlanta/construction hero — the template's visual language wearing their
// name, which is the exact opposite of what a mirror is for.
//
// WHY A DEDICATED PASS WHEN client-photos.js ALREADY HARVESTS. The general
// harvest ranks GALLERY photography first (correct for slots) and demotes the
// Open Graph share card to the bottom (correct for slots); a hero <video> is
// not carried at all, and a hero that exists only as a CSS background-image
// on a class competes with twenty gallery photos for two slots. The hero is
// a different question — "what does THEIR site lead with today?" — and it
// needs its own extraction, its own width floor (1200px), and a fallback
// ladder that ends somewhere honest instead of at a stock-looking default.
//
// THE SELECTION LADDER (selectHeroMedia):
//   rung 1  the client's own hero image/video, extracted and verified
//   rung 2  the client's og:image (their chosen share card, high-res by
//           convention) — then their own banked photography (same ownership
//           law, one rung down because it is their imagery but not their hero)
//   rung 3  a neutral trade fallback from the WSS asset pool — a texture or
//           pattern that cannot be mistaken for this client's project
//           evidence (the donor's own drawn/texture base hero)
//   rung 4  a solid accent-derived surface with a subtle CSS texture — no
//           photograph at all
//   NEVER  another prospect's hero image. The cross-prospect guard below
//           binds every accepted candidate to THIS prospect's registrable
//           domain and refuses any content hash already registered to a
//           different prospect.
//
// Node 20+, CommonJS, zero npm deps, node builtins only — same law as every
// other module in this directory.

const { createHash } = require("node:crypto");
// The pixel measurement and the responsive-variant identity are already
// solved problems in the general harvest; reuse them so the two passes can
// never disagree about how wide a photograph is or whether two URLs are one
// picture.
const { imageSize, variantKey } = require("./client-photos");

/* ------------------------------------------------------------------ *
 * The ownership law (single source of truth lives in client-photos.js;
 * the constants are re-declared here with the same meaning because that
 * module does not export them — the same twin-pattern engine.js uses for
 * parseHexColor. If client-photos widens its list, widen this one to match.)
 * ------------------------------------------------------------------ */

const registrable = (h) =>
  String(h || "").toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");

const GBP_HOSTS = /(^|\.)googleusercontent\.com$|(^|\.)ggpht\.com$/i;
const BUILDER_HOSTS = new RegExp(
  "(^\\.)?(" + [
    "cdn-website\\.com", "multiscreensite\\.com", "website\\.thryv\\.com",
    "hibuwebsites\\.com", "websites\\.hibu\\.com", "wixstatic\\.com",
    "squarespace-cdn\\.com", "wsimg\\.com", "godaddysites\\.com",
    "weeblysite\\.com", "editmysite\\.com", "nitrocdn\\.com",
    "wpenginepowered\\.com", "squarespace\\.com", "jimdo\\.com",
    "jimcdn\\.com", "sitehubcdn\\.com", "duda\\.co",
  ].join("|") + ")$",
  "i",
);

// A licensed stock file is nobody's hero to give — refused on ANY host,
// including the client's own domain (the re-hosted Getty file on a real
// prospect's homepage is the documented case; see client-photos.js).
const STOCK_RE = new RegExp([
  "gettyimages", "getty[_-]images", "shutterstock", "istockphoto", "istock[_-]",
  "adobestock", "adobe[_-]stock", "depositphotos", "dreamstime", "123rf",
  "vecteezy", "freepik", "unsplash", "pexels", "pixabay", "envato", "stockphoto",
  "stock[_-]photo", "photodune", "canva[_-]",
].join("|"), "i");

// An `<img>` whose name says decoration/mark is not the hero surface, no
// matter where it sits. (og:image is exempt: share cards are named that way
// by convention and are still the client's own chosen picture.)
const NON_HERO_NAME_RE = /(logo|brand[-_ ]?mark|icon|favicon|badge|avatar|spacer|sprite|pixel|emoji|payment|visa|mastercard|amex)/i;

// A hero region is the part of the page whose imagery IS the identity
// surface. Header first (the task's first door), then the conventional
// hero/banner/mastheart class+id names, then a first-viewport fallback for
// templates that name their hero nothing at all.
const HERO_REGION_RE = /<(section|div|header|main|aside)\b[^>]*(?:class|id)\s*=\s*["'][^"']*\b(hero|banner|masthead|jumbotron|splash|landing)["'][^"']*["'][^>]*>/i;

/* ------------------------------------------------------------------ *
 * Width floors
 * ------------------------------------------------------------------ */

// The owner's "high-resolution": a hero at 1200px+ carries under a scrim.
const MIN_HERO_WIDTH = 1200;
// The hard floor is hero-wash's CURRENT_HERO_MIN_WIDTH law, restated: below
// ~560px a picture upscales into visible mush even under a scrim. "Highest
// available" never means "any size at all" — an og card or hero below this
// is a thumbnail, and a thumbnail hero is the generic-template smell again.
const HARD_HERO_FLOOR = 560;
// Some formats (avif, odd encodings) do not parse; a heavy file is the only
// honest proxy left, and it must be a HIGH bar, not a shrug.
const UNKNOWN_WIDTH_MIN_BYTES = 120_000;
// client-photos' byte floor — below this it is an icon, not photography.
const MIN_IMAGE_BYTES = 12_000;
// A hero "clip" under 50KB is a stub or a poster-frame mistake, not a loop.
const MIN_VIDEO_BYTES = 50_000;

// The color-grade veil over the client's own hero photo: brand accent at
// ~30% opacity, so the photo becomes the design surface while staying
// recognizable as THEIR photo (owner's report: the client's photo must not
// read as a template's stock).
const HERO_GRADE_ALPHA = 0.30;

const MAX_CANDIDATE_FETCHES = 10;
const PER_FETCH_TIMEOUT_MS = 6000;
const PAGE_BYTES_CAP = 1_500_000;
const USER_AGENT = "Mozilla/5.0 (compatible; WSSLabs-hero-media/1.0)";

/* ------------------------------------------------------------------ *
 * Sniffing (magic bytes only — a URL that says .jpg is not a jpg)
 * ------------------------------------------------------------------ */

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return { ext: "jpg", mime: "image/jpeg" };
  if (buf[0] === 0x89 && buf[1] === 0x50) return { ext: "png", mime: "image/png" };
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  if (buf.slice(4, 12).toString().includes("ftypavif")) return { ext: "avif", mime: "image/avif" };
  return null; // svg and everything else: not hero photography
}

function sniffVideo(buf) {
  if (!buf || buf.length < 12) return null;
  const isMp4 = buf.slice(4, 8).toString("latin1") === "ftyp";
  if (isMp4) return { ext: "mp4", mime: "video/mp4" };
  const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  if (isWebm) return { ext: "webm", mime: "video/webm" };
  return null;
}

/* ------------------------------------------------------------------ *
 * THE CROSS-PROSPECT GUARD
 *
 * Two doors, both mandatory:
 *   URL  — every accepted candidate must live on THIS prospect's registrable
 *          domain, Google's GBP media host, or a named site-builder tenant
 *          host (every candidate here was found in the prospect's OWN
 *          markup, which is what binds a builder asset to this business).
 *          Another prospect's URL cannot pass this door even if it leaks
 *          into the page (a designer's other client, a shared template).
 *   SHA  — a content hash already registered to a DIFFERENT prospect's
 *          domain is refused outright. This is the re-host door: the same
 *          bytes at a different URL (a designer reusing client A's hero for
 *          client B) still carries A's project evidence and cannot ship on
 *          B's hero.
 * ------------------------------------------------------------------ */

const defaultHeroOwnershipRegistry = new Map(); // sha256 -> registrable domain

function registerHeroOwnership(sha256, clientDomain, registry = defaultHeroOwnershipRegistry) {
  const sha = String(sha256 || "");
  const domain = registrable(clientDomain);
  if (!/^[0-9a-f]{64}$/i.test(sha) || !domain) return false;
  registry.set(sha.toLowerCase(), domain);
  return true;
}

function crossProspectVerdict({ url, sha256, clientDomain, registry = defaultHeroOwnershipRegistry }) {
  const domain = registrable(clientDomain);
  if (!domain) return { ok: false, reason: "no_client_domain" };
  let host = "";
  try { host = new URL(url).hostname; } catch { return { ok: false, reason: "bad_url" }; }
  const owned = registrable(host) === domain || GBP_HOSTS.test(host) || BUILDER_HOSTS.test(host);
  if (!owned) {
    return {
      ok: false,
      reason: "cross_prospect_domain",
      detail: `${registrable(host)} is not ${domain} (and is no GBP/builder host bound to their markup)`,
    };
  }
  const sha = String(sha256 || "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(sha)) {
    const registeredTo = registry.get(sha);
    if (registeredTo && registeredTo !== domain) {
      return {
        ok: false,
        reason: "cross_prospect_sha_registered",
        detail: `these bytes are already ${registeredTo}'s hero`,
      };
    }
  }
  return { ok: true };
}

/** Test seam: empty the registry between scenarios. */
function resetHeroOwnershipRegistry() {
  defaultHeroOwnershipRegistry.clear();
}

/* ------------------------------------------------------------------ *
 * HTML parsing — regex scans, same style as client-photos.js. No DOM
 * dependency exists in this runtime, and every module before this one
 * parses with bounded regexes; the bounds below keep them honest.
 * ------------------------------------------------------------------ */

function attrOf(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(String(tag || ""));
  return m ? m[2] : "";
}

/** Slice one element (open tag at `start`) to its matching close tag. */
function sliceElement(html, start, tagName) {
  const token = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "gi");
  token.lastIndex = start + 1 + tagName.length;
  let depth = 1;
  let m;
  while ((m = token.exec(html)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { inner: html.slice(start, token.lastIndex), end: token.lastIndex };
  }
  return { inner: html.slice(start, Math.min(html.length, start + 40_000)), end: html.length };
}

/**
 * The hero regions of a page, in the priority the task names:
 *   1. the <header> element (its primary img / video poster)
 *   2. elements whose class/id says hero/banner/masthead/...
 * Bounded to the first 3 hero-named regions; a carousel-heavy template that
 * names nine sections "hero-slide" must not turn this into a page crawler.
 */
function heroRegions(html) {
  const regions = [];
  const headerOpen = /<header\b[^>]*>/i.exec(html);
  if (headerOpen) {
    const sliced = sliceElement(html, headerOpen.index, "header");
    regions.push({ kind: "header", inner: sliced.inner });
  }
  const heroOpen = new RegExp(HERO_REGION_RE.source, "gi");
  let m;
  let found = 0;
  while ((m = heroOpen.exec(html)) !== null && found < 3) {
    if (m[1].toLowerCase() === "header") continue; // already captured above
    const sliced = sliceElement(html, m.index, m[1].toLowerCase());
    regions.push({ kind: "hero", inner: sliced.inner });
    found += 1;
    heroOpen.lastIndex = sliced.end;
  }
  return regions;
}

/** Largest srcset entry — a hero served responsively is the big one. */
function largestSrcset(value) {
  const parts = String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "";
  let best = "";
  let bestW = -1;
  for (const p of parts) {
    const [url, desc] = p.split(/\s+/);
    const w = desc && /(\d+)w/i.test(desc) ? Number(/(\d+)w/i.exec(desc)[1]) : 0;
    if (w >= bestW) { bestW = w; best = url; }
  }
  return best || parts[parts.length - 1].split(/\s+/)[0];
}

function absUrl(raw, baseUrl) {
  const v = String(raw || "").trim();
  if (!v || /^data:/i.test(v)) return "";
  try { return new URL(v, baseUrl).href; } catch { return ""; }
}

/**
 * Image candidates from the hero regions, in the task's order:
 * header/hero <img> -> <video poster> -> <picture>/<source> -> inline CSS
 * background-image. Each carries its source kind for the report.
 */
function heroImageCandidates(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const push = (rawUrl, kind) => {
    const url = absUrl(rawUrl, baseUrl);
    if (!url) return;
    const key = variantKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url, kind });
  };

  const imgsFrom = (region, kind) => {
    const tagRe = /<img\b[^>]*>/gi;
    let m;
    while ((m = tagRe.exec(region.inner)) !== null) {
      const tag = m[0];
      const name = `${attrOf(tag, "src")} ${attrOf(tag, "alt")} ${attrOf(tag, "class")}`;
      if (NON_HERO_NAME_RE.test(name)) continue; // their logo is not their hero
      const srcset = attrOf(tag, "srcset");
      push(srcset ? largestSrcset(srcset) : "", kind);
      push(attrOf(tag, "src"), kind);
    }
    for (const s of region.inner.matchAll(/<source[^>]+srcset=["']([^"']+)["']/gi)) {
      push(largestSrcset(s[1]), kind === "header" ? "header_picture" : "hero_picture");
    }
    for (const v of region.inner.matchAll(/<video\b[^>]*>/gi)) {
      push(attrOf(v[0], "poster"), kind === "header" ? "header_video_poster" : "hero_video_poster");
    }
    // Inline CSS background on the hero element itself.
    for (const b of region.inner.matchAll(/background(?:-image)?\s*:\s*url\((["']?)([^"')]+)\1\)/gi)) {
      push(b[2], kind === "header" ? "header_css_background" : "hero_css_background");
    }
  };

  const regions = heroRegions(html);
  for (const region of regions) imgsFrom(region, region.kind);

  // First-viewport fallback: templates that name their hero nothing. The
  // first content photograph in the first 8KB of <body> is the surface a
  // visitor sees first — the design brief's own "inFirstViewport" heuristic,
  // restated with the same 8KB window.
  const bodyAt = /<body\b[^>]*>/i.exec(html);
  if (!out.length && bodyAt) {
    const window0 = html.slice(bodyAt.index, bodyAt.index + 8000);
    for (const m of window0.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const name = `${attrOf(tag, "src")} ${attrOf(tag, "alt")} ${attrOf(tag, "class")}`;
      if (NON_HERO_NAME_RE.test(name)) continue;
      push(attrOf(tag, "src"), "first_viewport_img");
      break;
    }
  }
  return out;
}

/**
 * background-image URLs from <style> blocks whose SELECTOR says hero. A
 * hero painted purely by stylesheet (very common on builder sites) has no
 * <img> anywhere near it.
 */
function heroCssBackgroundCandidates(html, baseUrl) {
  const out = [];
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of style[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/hero|banner|masthead|jumbotron|splash/i.test(rule[1])) continue;
      for (const b of rule[2].matchAll(/background(?:-image)?\s*:\s*url\((["']?)([^"')]+)\1\)/gi)) {
        const url = absUrl(b[2], baseUrl);
        if (url && !out.some((c) => c.url === url)) out.push({ url, kind: "hero_css_background" });
      }
    }
  }
  return out;
}

function ogImageCandidates(html, baseUrl) {
  const out = [];
  for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]*>/gi)) {
    const url = absUrl(attrOf(m[0], "content"), baseUrl);
    if (url && !out.some((c) => c.url === url)) out.push({ url, kind: "og_image" });
  }
  // name="og:image" (mis-declared but real in the wild)
  for (const m of html.matchAll(/<meta[^>]+name=["']og:image["'][^>]*>/gi)) {
    const url = absUrl(attrOf(m[0], "content"), baseUrl);
    if (url && !out.some((c) => c.url === url)) out.push({ url, kind: "og_image" });
  }
  return out;
}

/** mp4/webm sources inside the hero/header regions — the ladder's client clip. */
function heroVideoCandidates(html, baseUrl) {
  const out = [];
  const push = (rawUrl, kind) => {
    const url = absUrl(rawUrl, baseUrl);
    if (!url) return;
    if (!/\.(mp4|webm|m4v)(\?|#|$)/i.test(url)) return;
    if (out.some((c) => c.url === url)) return;
    out.push({ url, kind });
  };
  for (const region of heroRegions(html)) {
    for (const v of region.inner.matchAll(/<video\b[^>]*>/gi)) {
      const src = attrOf(v[0], "src");
      if (src) push(src, "hero_video");
    }
    for (const s of region.inner.matchAll(/<source\b[^>]*>/gi)) {
      push(attrOf(s[0], "src"), "hero_video");
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Fetch + verify
 * ------------------------------------------------------------------ */

async function fetchBytes(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (!r || !r.ok) return { ok: false, status: r ? r.status : 0 };
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, buf, finalUrl: (r.url && String(r.url)) || url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify one image candidate: guard, fetch, sniff, measure. Never throws —
 * a refusal is data, and the ladder falls to the next rung.
 */
async function verifyImageCandidate(candidate, ctx) {
  const { clientDomain, fetchImpl, registry, rejected } = ctx;
  // HTTPS OR NOTHING (client-photos law): the mirror serves https; an http
  // hero is mixed content that never paints. Try the upgrade, keep what serves.
  const url = candidate.url.replace(/^http:\/\//i, "https://");
  if (STOCK_RE.test(url)) { rejected.push({ url: candidate.url, reason: "stock_library" }); return null; }
  if (ctx.fetches >= ctx.maxFetches) { rejected.push({ url: candidate.url, reason: "fetch_budget" }); return null; }

  const preGuard = crossProspectVerdict({ url, clientDomain, registry });
  if (!preGuard.ok) { rejected.push({ url: candidate.url, reason: preGuard.reason }); return null; }

  let fetched;
  try {
    ctx.fetches += 1;
    fetched = await fetchBytes(url, fetchImpl, ctx.perFetchTimeoutMs);
  } catch (e) {
    rejected.push({ url: candidate.url, reason: `fetch_failed:${String(e.message || e).slice(0, 48)}` });
    return null;
  }
  if (!fetched.ok) { rejected.push({ url: candidate.url, reason: `http_${fetched.status}` }); return null; }
  const sniffed = sniffImage(fetched.buf);
  if (!sniffed) { rejected.push({ url: candidate.url, reason: "not_a_photo" }); return null; }
  if (fetched.buf.length < MIN_IMAGE_BYTES) { rejected.push({ url: candidate.url, reason: "too_small" }); return null; }

  const size = imageSize(fetched.buf, sniffed.ext);
  const width = size.w || 0;
  const height = size.h || 0;
  if (width && height && width < HARD_HERO_FLOOR) {
    rejected.push({ url: candidate.url, reason: `too_small_pixels:${width}x${height}` });
    return null;
  }
  const widthUnknown = !width || !height;
  if (widthUnknown && fetched.buf.length < UNKNOWN_WIDTH_MIN_BYTES) {
    rejected.push({ url: candidate.url, reason: "unmeasurable_and_light" });
    return null;
  }

  const sha256 = createHash("sha256").update(fetched.buf).digest("hex");
  const guard = crossProspectVerdict({ url, sha256, clientDomain, registry });
  if (!guard.ok) { rejected.push({ url: candidate.url, reason: guard.reason }); return null; }
  registerHeroOwnership(sha256, clientDomain, registry);

  return {
    url,
    originUrl: fetched.finalUrl || url,
    sha256,
    ext: sniffed.ext,
    mime: sniffed.mime,
    ...(ctx.mediaMode === "origin" ? {} : { bytes: fetched.buf }),
    width,
    height,
    widthUnknown,
    source: candidate.kind,
  };
}

/** Verified video row in brand-assets' heroVideo shape, so the ladder's
 *  existing placement gates (ext match, origin manifest) apply unchanged. */
async function verifyVideoCandidate(candidate, ctx) {
  const { clientDomain, fetchImpl, registry, rejected } = ctx;
  const url = candidate.url.replace(/^http:\/\//i, "https://");
  if (STOCK_RE.test(url)) { rejected.push({ url: candidate.url, reason: "stock_library" }); return null; }
  if (ctx.fetches >= ctx.maxFetches) { rejected.push({ url: candidate.url, reason: "fetch_budget" }); return null; }
  const preGuard = crossProspectVerdict({ url, clientDomain, registry });
  if (!preGuard.ok) { rejected.push({ url: candidate.url, reason: preGuard.reason }); return null; }

  let fetched;
  try {
    ctx.fetches += 1;
    fetched = await fetchBytes(url, fetchImpl, ctx.perFetchTimeoutMs);
  } catch (e) {
    rejected.push({ url: candidate.url, reason: `fetch_failed:${String(e.message || e).slice(0, 48)}` });
    return null;
  }
  if (!fetched.ok) { rejected.push({ url: candidate.url, reason: `http_${fetched.status}` }); return null; }
  const sniffed = sniffVideo(fetched.buf);
  if (!sniffed) { rejected.push({ url: candidate.url, reason: "not_a_video" }); return null; }
  if (fetched.buf.length < MIN_VIDEO_BYTES) { rejected.push({ url: candidate.url, reason: "video_stub_too_small" }); return null; }

  const sha256 = createHash("sha256").update(fetched.buf).digest("hex");
  const guard = crossProspectVerdict({ url, sha256, clientDomain, registry });
  if (!guard.ok) { rejected.push({ url: candidate.url, reason: guard.reason }); return null; }
  registerHeroOwnership(sha256, clientDomain, registry);

  // `ok:true` carries the brandOut.heroVideo contract (engine.js reads .ok,
  // .bytes, .ext, .mime, .sha256, .sourceUrl-adjacent fields), so the ladder's
  // existing placement gates apply to the extracted clip unchanged.
  return {
    ok: true,
    url,
    originUrl: fetched.finalUrl || url,
    // brandOut.heroVideo spells the verified public origin "sourceUrl"
    // (engine.js's origin-mode URL manifest reads it); carry both spellings
    // so the ladder needs no translation.
    sourceUrl: fetched.finalUrl || url,
    sha256,
    ext: sniffed.ext,
    mime: sniffed.mime,
    ...(ctx.mediaMode === "origin" ? {} : { bytes: fetched.buf }),
    source: "hero_video",
  };
}

/**
 * Among verified candidates: the first that clears MIN_HERO_WIDTH (priority
 * order is extraction order), else the WIDEST that clears the hard floor —
 * "at least 1200px wide (or highest available)", and "highest available"
 * means measured-highest, with unmeasurable-but-heavy candidates ranked
 * below every measured one.
 */
function bestByWidth(verified) {
  if (!verified.length) return null;
  const full = verified.filter((v) => !v.widthUnknown && v.width >= MIN_HERO_WIDTH);
  if (full.length) return full[0];
  const measurable = verified.filter((v) => !v.widthUnknown);
  const pool = measurable.length ? measurable : verified;
  return pool.reduce((best, v) => (
    !best || (v.width || 0) > (best.width || 0) ? v : best
  ), null);
}

/* ------------------------------------------------------------------ *
 * extractClientHeroMedia — the build-time entry point
 * ------------------------------------------------------------------ */

/**
 * extractClientHeroMedia({ website, html?, fetchImpl?, mediaMode?, registry? })
 *   -> { ok, reason?, hero|null, og|null, video|null, poster|null,
 *        rejected: [{url, reason}], candidates: number }
 *
 * `hero`  — the verified hero IMAGE (rung 1 for the wash).
 * `og`    — the verified og:image (rung 2).
 * `video` — the verified hero mp4/webm, brandOut.heroVideo-shaped so the
 *           donor's video ladder gates it exactly like a supplied clip.
 * `poster`— the verified poster of a hero video, reported beside the video
 *           (paint-under, hero-video-fallback law).
 * Fail-soft by contract: every failure is { ok:false, reason } and the
 * caller's ladder falls through unchanged.
 */
async function extractClientHeroMedia({
  website = "",
  html = "",
  fetchImpl = fetch,
  mediaMode = "housed",
  registry = defaultHeroOwnershipRegistry,
  maxFetches = MAX_CANDIDATE_FETCHES,
  perFetchTimeoutMs = PER_FETCH_TIMEOUT_MS,
} = {}) {
  const site = String(website || "").trim();
  if (!/^https?:\/\//i.test(site)) {
    return { ok: false, reason: "no_website", hero: null, og: null, video: null, poster: null, rejected: [], candidates: 0 };
  }
  let baseUrl;
  let clientDomain;
  try {
    baseUrl = new URL(site);
    clientDomain = registrable(baseUrl.hostname);
  } catch {
    return { ok: false, reason: "bad_website_url", hero: null, og: null, video: null, poster: null, rejected: [], candidates: 0 };
  }

  const ctx = {
    clientDomain, fetchImpl, registry, rejected: [], fetches: 0,
    maxFetches, perFetchTimeoutMs, mediaMode,
  };

  let pageHtml = String(html || "");
  if (!pageHtml) {
    try {
      ctx.fetches += 1;
      const page = await fetchBytes(site.replace(/^http:\/\//i, "https://"), fetchImpl, perFetchTimeoutMs);
      if (!page.ok) {
        return { ok: false, reason: `homepage_http_${page.status}`, hero: null, og: null, video: null, poster: null, rejected: ctx.rejected, candidates: 0 };
      }
      pageHtml = page.buf.slice(0, PAGE_BYTES_CAP).toString("utf8");
    } catch (e) {
      return {
        ok: false, reason: `homepage_fetch_failed:${String(e.message || e).slice(0, 48)}`,
        hero: null, og: null, video: null, poster: null, rejected: ctx.rejected, candidates: 0,
      };
    }
  }

  // Candidate assembly, in the task's order. The <style> backgrounds sit
  // AFTER the region scans because an <img> the visitor actually sees in the
  // hero is the stronger claim than the stylesheet's paint layer.
  const heroImgs = heroImageCandidates(pageHtml, baseUrl.href);
  const cssBgs = heroCssBackgroundCandidates(pageHtml, baseUrl.href);
  const ogImgs = ogImageCandidates(pageHtml, baseUrl.href);
  const videos = heroVideoCandidates(pageHtml, baseUrl.href);
  const posterKinds = new Set(["hero_video_poster", "header_video_poster"]);

  // Verify hero images until one clears 1200px, then keep going only within
  // the remaining budget so "highest available" has a real pool to pick from.
  const verifiedHero = [];
  let stoppedAt = heroImgs.length;
  for (let i = 0; i < heroImgs.length; i += 1) {
    const row = await verifyImageCandidate(heroImgs[i], ctx);
    if (!row) continue;
    verifiedHero.push(row);
    if (!posterKinds.has(heroImgs[i].kind) && !row.widthUnknown && row.width >= MIN_HERO_WIDTH) {
      stoppedAt = i + 1;
      break;
    }
  }
  // THE PAINT-UNDER POSTER is verified even when the primary hero broke the
  // loop early: it is the video ladder's fallback surface (hero-video-fallback
  // law — a failed clip must show the hero image, never black), reported
  // beside the clip rather than competing with the hero itself.
  for (let i = stoppedAt; i < heroImgs.length && ctx.fetches < ctx.maxFetches; i += 1) {
    if (!posterKinds.has(heroImgs[i].kind)) continue;
    const row = await verifyImageCandidate(heroImgs[i], ctx);
    if (row) verifiedHero.push(row);
    break; // one poster is enough
  }
  const verifiedCss = [];
  for (const candidate of cssBgs) {
    const haveFullWidth = verifiedHero.some((v) => !v.widthUnknown && v.width >= MIN_HERO_WIDTH);
    if (haveFullWidth || ctx.fetches >= ctx.maxFetches) break;
    const row = await verifyImageCandidate(candidate, ctx);
    if (row && !verifiedHero.some((h) => h.url === row.url || h.sha256 === row.sha256)) {
      verifiedCss.push(row);
    }
  }
  const verifiedOg = [];
  for (const candidate of ogImgs.slice(0, 2)) {
    const row = await verifyImageCandidate(candidate, ctx);
    if (row) verifiedOg.push(row);
    if (!row || (!row.widthUnknown && row.width >= MIN_HERO_WIDTH)) break;
  }
  const verifiedVideos = [];
  for (const candidate of videos.slice(0, 2)) {
    const row = await verifyVideoCandidate(candidate, ctx);
    if (row) verifiedVideos.push(row);
  }

  const heroPool = [...verifiedHero, ...verifiedCss];
  const hero = bestByWidth(heroPool);
  const og = bestByWidth(verifiedOg.filter((v) => v.url !== (hero && hero.url)));
  const video = verifiedVideos[0] || null;
  const poster = heroPool.find((v) => posterKinds.has(v.source) && (!hero || v.sha256 !== hero.sha256)) || null;

  const anyVerified = Boolean(hero || og || video);
  return {
    ok: anyVerified,
    reason: anyVerified ? "" : (ctx.rejected[0] ? ctx.rejected[0].reason : "no_hero_media_found"),
    hero,
    og,
    video,
    poster,
    rejected: ctx.rejected,
    candidates: heroImgs.length + cssBgs.length + ogImgs.length + videos.length,
    clientDomain,
  };
}

/* ------------------------------------------------------------------ *
 * The selection ladder
 * ------------------------------------------------------------------ */

/**
 * The neutral trade fallback from the WSS asset pool: a donor-shipped
 * texture/pattern whose NAME says it is a surface, not a project photo —
 * topographic contours, grass texture, drawn grain. A candidate whose name
 * says photography (gallery/job/project/truck/...) is excluded on purpose:
 * the rung exists so nothing on the hero can be mistaken for THIS client's
 * project evidence, and a generic project-looking photo is exactly the
 * Atlanta/construction smell the owner reported.
 */
const NEUTRAL_HERO_NAME_RE = /(?:^|[/_-])(topo|texture|grain|contour|pattern|mesh|blueprint|map-fields|noise)(?:[-_.][a-z0-9]+)*\.(?:jpe?g|png|webp|avif)$/i;
const PHOTO_LIKE_NAME_RE = /(gallery|project|job|crew|truck|van|fleet|cgi|hands|pump|flagship|before|after|install|technician|work|patio|driveway|site)/i;

function neutralHeroAsset(files) {
  const rels = Object.keys(files || {}).filter((rel) =>
    /^assets\//i.test(rel)
    && NEUTRAL_HERO_NAME_RE.test(rel)
    && !PHOTO_LIKE_NAME_RE.test(rel));
  rels.sort();
  return rels.length ? { rel: rels[0], basis: "wss_neutral_texture" } : null;
}

/**
 * selectHeroMedia({ extracted, bankedRow, firstUsableRow, neutralAsset })
 *   -> { choice, rung, hero, heroOrigin, reason, overlay }
 *
 * rung 1  client_hero            — extracted hero image, or the bank row the
 *                                  lane already flagged as their CURRENT hero
 * rung 2  client_og_image        — their verified og:image
 * rung 2  client_photo_bank      — their own banked photography (ownership
 *                                  law already passed; their imagery, not
 *                                  their hero — honest rung, reported by name)
 * rung 3  neutral_trade_fallback — WSS neutral texture, never project evidence
 * rung 4  brand_solid            — accent solid + subtle CSS texture (no photo)
 *
 * `heroOrigin` says which lane the winner came from — "extracted_hero",
 * "extracted_og", "bank_current_hero", "bank", "bank_first_usable" or null —
 * because the extracted rows carry their own verified bytes/origin URL while
 * a bank row still has to be joined to the resolved photo list for bytes.
 *
 * `overlay` is true exactly when the winner is CLIENT-OWNED hero imagery
 * (rungs 1-2) — the color-grade treatment that makes their photo the design
 * surface. The neutral and solid rungs get no grade: there is nothing of
 * theirs to keep recognizable.
 */
function selectHeroMedia({
  extracted = null,
  bankedRow = null,
  firstUsableRow = null,
  neutralAsset = null,
} = {}) {
  const hero = extracted && extracted.hero ? extracted.hero : null;
  if (hero) {
    return { choice: "client_hero", rung: 1, hero, heroOrigin: "extracted_hero", reason: "", overlay: true };
  }
  if (bankedRow && bankedRow.current_hero) {
    return { choice: "client_hero", rung: 1, hero: bankedRow, heroOrigin: "bank_current_hero", reason: "bank_current_hero_flag", overlay: true };
  }
  const og = extracted && extracted.og ? extracted.og : null;
  if (og) {
    return { choice: "client_og_image", rung: 2, hero: og, heroOrigin: "extracted_og", reason: "", overlay: true };
  }
  if (bankedRow) {
    return { choice: "client_photo_bank", rung: 2, hero: bankedRow, heroOrigin: "bank", reason: "", overlay: false };
  }
  if (firstUsableRow) {
    return { choice: "client_photo_bank", rung: 2, hero: firstUsableRow, heroOrigin: "bank_first_usable", reason: "first_usable_photo", overlay: false };
  }
  if (neutralAsset) {
    return { choice: "neutral_trade_fallback", rung: 3, hero: null, heroOrigin: null, reason: "", overlay: false, neutralAsset };
  }
  return { choice: "brand_solid", rung: 4, hero: null, heroOrigin: null, reason: "no_client_hero_and_no_neutral_asset", overlay: false };
}

/* ------------------------------------------------------------------ *
 * The overlay + the solid surface
 * ------------------------------------------------------------------ */

function parseHexLocal(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbaOf({ r, g, b }, a) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * heroOverlayCss({ selector, accent, wash, imageHref }) -> { css, applied, … }
 *
 * THE COLOR GRADE (owner's hero-authenticity report): when the hero is the
 * client's OWN photo, a brand-palette grade at ~30% opacity goes BETWEEN
 * the proven text scrim and the photograph. The layer order, top to bottom:
 *   1. the wash's proven scrim, UNCHANGED — the AA guarantee is computed for
 *      the worst possible backdrop, and a 30% monotone veil cannot move a
 *      photo's luminance outside [0,1], so the proof covers the graded photo
 *      exactly as it covered the raw one;
 *   2. the accent grade at HERO_GRADE_ALPHA — the design surface;
 *   3. their photograph, cover-fitted.
 * The mobile variant mirrors heroWashCss's taper (full scrim under the text
 * band, 0.30x over the photo area) with the grade still in the stack, so
 * the photo reads as theirs on the phone too.
 */
function heroOverlayCss({ selector = "", accent = "", wash = null, imageHref = "" } = {}) {
  const scrim = wash && typeof wash.rgba === "string" ? wash.rgba : "";
  if (!selector || !scrim || !imageHref) {
    return { css: "", applied: false, reason: !selector ? "no_selector" : !scrim ? "no_proven_scrim" : "no_image_href" };
  }
  const grade = parseHexLocal(accent)
    || ((m) => m && { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) })(/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(scrim));
  if (!grade) return { css: "", applied: false, reason: "no_measured_accent" };

  const veil = rgbaOf(grade, HERO_GRADE_ALPHA);
  // The wash's mobile "clear" band: same tint at clearAlpha (heroWashCss
  // contract). Derived here from the scrim tint so the two blocks can never
  // disagree about the hue.
  const tint = (m => m && { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) })(/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(scrim));
  const clearAlpha = wash && Number.isFinite(Number(wash.clearAlpha)) ? Number(wash.clearAlpha) : 0.26;
  const clear = tint ? rgbaOf(tint, clearAlpha) : scrim;

  const css = [
    "",
    "/* --- client hero color grade (wss hero-media) ------------------------",
    "   Their own hero photograph, graded toward the brand palette at",
    `   ${HERO_GRADE_ALPHA} opacity, UNDER the proven text scrim (the AA proof`,
    "   bounds the worst backdrop, so the grade cannot break it). The photo",
    "   stays recognizable as THEIRS; the surface speaks their palette. */",
    `:is(${selector}) {`,
    `  background-image: linear-gradient(${scrim}, ${scrim}), linear-gradient(${veil}, ${veil}), url("${imageHref}");`,
    "}",
    "@media (max-width: 640px) {",
    `  :is(${selector}) {`,
    `    background-image: linear-gradient(to bottom, ${scrim} 0%, ${scrim} 38%, ${clear} 100%), linear-gradient(${veil}, ${veil}), url("${imageHref}");`,
    "  }",
    "}",
    "",
  ].join("\n");
  return { css, applied: true, alpha: HERO_GRADE_ALPHA, accentRgb: grade };
}

/**
 * solidHeroCss({ selector, accent }) — rung 4, the last resort: a solid
 * surface derived from the brand accent with a subtle CSS texture, and NO
 * photograph at all. Better an honest brand color than somebody else's
 * project photo posing as evidence.
 */
function solidHeroCss({ selector = "", accent = "" } = {}) {
  const c = parseHexLocal(accent);
  if (!selector || !c) {
    return { css: "", applied: false, reason: !selector ? "no_selector" : "no_accent" };
  }
  const css = [
    "",
    "/* --- wss solid hero (no photograph qualified) ------------------------",
    "   Brand-accent solid with a subtle woven texture. Deliberately no",
    "   photo: with no owned hero and no neutral asset, a photograph here",
    "   would be somebody else's evidence. */",
    `:is(${selector}) {`,
    `  background-color: ${String(accent).trim()};`,
    "  background-image:",
    "    linear-gradient(rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.04)),",
    "    repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.035) 0 2px, rgba(0, 0, 0, 0) 2px 6px);",
    "}",
    "",
  ].join("\n");
  return { css, applied: true, accent: String(accent).trim() };
}

/* ------------------------------------------------------------------ *
 * Build-hash identity — fixed-key canonical input so a hero change moves
 * the build hash (a memo must never replay another prospect's hero, or the
 * same prospect's pre-hero build, as "identical").
 * ------------------------------------------------------------------ */

function heroMediaIdentity(extraction) {
  if (!extraction || (!extraction.hero && !extraction.og && !extraction.video)) return null;
  const lane = (row) => (row ? [String(row.url || ""), String(row.sha256 || "")] : null);
  return {
    schema: "hero-media@v1",
    hero: lane(extraction.hero),
    og: lane(extraction.og),
    video: lane(extraction.video),
    ...(extraction.poster ? { poster: lane(extraction.poster) } : {}),
  };
}

module.exports = {
  // extraction + verification
  extractClientHeroMedia,
  heroRegions,
  heroImageCandidates,
  heroCssBackgroundCandidates,
  ogImageCandidates,
  heroVideoCandidates,
  sniffImage,
  sniffVideo,
  // the ladder
  selectHeroMedia,
  neutralHeroAsset,
  // the treatments
  heroOverlayCss,
  solidHeroCss,
  // the cross-prospect guard
  crossProspectVerdict,
  registerHeroOwnership,
  resetHeroOwnershipRegistry,
  defaultHeroOwnershipRegistry,
  // identity
  heroMediaIdentity,
  // constants (for tests + the engine's report)
  MIN_HERO_WIDTH,
  HARD_HERO_FLOOR,
  HERO_GRADE_ALPHA,
  MIN_VIDEO_BYTES,
};
