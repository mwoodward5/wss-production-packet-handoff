"use strict";
// lib/mirror-engine/client-photos.js — harvest the CLIENT'S OWN photography.
//
// The owner's bar: 10-20 real images from the prospect's Google Business or
// their own website, priority first, filling the donor's photo_slots so the
// mirror reads as THEIR business, not a template wearing their logo.
//
// SOURCES ARE CANDIDATES, NEVER FACTS. The Intake Genie's assets[] may point
// here — but the Genie fabricates (documented: a Facebook page id shipped as a
// "operator_verified" phone), so nothing it says is trusted. Every URL from
// every source passes the same gate:
//   1. OWNERSHIP — the bytes live on the client's own registrable domain, on
//      Google's GBP media host for THEIR place, or in the tenant asset space of
//      a NAMED site builder that their own page is built on (see BUILDER_HOSTS).
//      The APOC incident was an image search with no ownership check putting
//      another company's mark on a client's page; this gate is why that cannot
//      recur.
//   2. IT IS ACTUALLY A PHOTO — fetched, sniffed, not an svg/icon, above a
//      floor size AND a floor pixel dimension. A page URL labeled "photo" (the
//      Genie does this) fails here.
//   3. IT IS NOT SOMEBODY ELSE'S PICTURE TO GIVE — stock-library files and
//      third-party marks are refused wherever they are hosted, including on the
//      client's own domain.
//   4. DEDUPED BY CONTENT HASH *AND* BY RESPONSIVE VARIANT — the same image at
//      two URLs, or at five widths, is one photo.
//
// Missing photos are a smaller gallery, never a stock substitution. The donor
// keeps its cinematic layer; only photo_slots are swapped (see the donors'
// photo_slots_note).
//
// ORDER IS THE PRODUCT. Measured 2026-08-07: the plumbing donor declares TWO
// photo_slots and the request schema caps brand.photos at 8, so a business that
// supplies twenty photographs shows two. Which two was previously decided by
// DOM order, which on Owens Plumbing put a stock "customer-review-3d-
// illustration-free-png" and a resized copy of their logo ahead of the
// photographs of their actual work. rankCandidate below is therefore not a
// nicety — it is what the client sees.

const { createHash } = require("node:crypto");

const registrable = (h) =>
  String(h || "").toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");

// GBP media is served from Google's own hosts; those bytes are the business's
// (or its customers') uploads for that place, which is exactly the "from your
// Google business" source the owner named. Anything else off-domain is refused.
const GBP_HOSTS = /(^|\.)googleusercontent\.com$|(^|\.)ggpht\.com$/i;

// SITE-BUILDER TENANT ASSET SPACE — the single biggest cause of "photos: 0".
//
// Measured across the thirteen live plumbing mirrors that shipped with no
// client imagery (2026-08-07): 180 of 211 total rejections were `not_owned`,
// and essentially all of them were the prospect's own uploads served from the
// asset CDN of the site builder their website is built on — Duda
// (irp/lirp.cdn-website.com, dd-cdn.multiscreensite.com), Thryv, Hibu, Wix,
// NitroPack. Best Plumbing & Heating had eighteen of its own images refused;
// Holt Plumbing fifty-nine. These are exactly the cheap-site-builder businesses
// the worst-website targeting rule aims at, so the defect was concentrated in
// the segment we actually pitch.
//
// This is NOT a general "trust CDNs" hole. Three things hold it shut:
//   * the host must be one of these NAMED builders — a builder only ever serves
//     files uploaded to a tenant of that builder, never the open web;
//   * the URL must have been found in the CLIENT'S OWN page markup (source
//     "own_site"). A builder host offered by the Genie or by a caller is
//     refused, because then nothing binds the asset to this business;
//   * stock libraries and third-party marks are refused separately, below —
//     which is what stops irp.cdn-website.com/…/GettyImages-1320565081-698w.jpg
//     (a real candidate on a real prospect's homepage) from shipping.
const BUILDER_HOSTS = new RegExp(
  "(^|\\.)(" + [
    "cdn-website\\.com",          // Duda (irp./lirp.)
    "multiscreensite\\.com",      // Duda legacy
    "website\\.thryv\\.com",      // Thryv
    "hibuwebsites\\.com",         // Hibu
    "websites\\.hibu\\.com",      // Hibu
    "wixstatic\\.com",            // Wix
    "squarespace-cdn\\.com",      // Squarespace
    "wsimg\\.com",                // GoDaddy Website Builder
    "godaddysites\\.com",
    "weeblysite\\.com",
    "editmysite\\.com",           // Weebly
    "nitrocdn\\.com",             // NitroPack — per-site pull zone over their own origin
    "wpenginepowered\\.com",      // WP Engine
    "squarespace\\.com",
    "jimdo\\.com",
    "jimcdn\\.com",
    "sitehubcdn\\.com",
    "duda\\.co",
  ].join("|") + ")$",
  "i",
);

// NOBODY'S PICTURE TO GIVE. A licensed stock file is not the client's
// photography, and re-hosting it on a mirror we send them is both a lie about
// their work and somebody else's copyright. Refused on ANY host — including
// their own domain, where WordPress uploads land after a designer bought them.
// Live candidate that made this necessary: Best Plumbing & Heating's homepage
// serves GettyImages-1320565081-698w.jpg from its Duda tenant space.
const STOCK_RE = new RegExp([
  "gettyimages", "getty[_-]images", "shutterstock", "istockphoto", "istock[_-]",
  "adobestock", "adobe[_-]stock", "depositphotos", "dreamstime", "123rf",
  "vecteezy", "freepik", "unsplash", "pexels", "pixabay", "envato", "stockphoto",
  "stock[_-]photo", "photodune", "canva[_-]",
].join("|"), "i");

const IMG_EXT = /\.(jpe?g|png|webp|avif)(\?|$)/i;
const SKIP_HINTS = /(sprite|icon|favicon|logo|badge|placeholder|spacer|pixel|avatar|emoji)/i;
const MIN_BYTES = 12_000;      // below this it's an icon, not photography
const MIN_EDGE = 320;          // …and so is a 212x93 file that happens to be heavy
const MAX_PHOTOS = 20;

// How many internal pages to open when the homepage alone is thin. Poor John's
// Plumbing (live, donor-only) has exactly ONE image on its homepage — its
// logo.svg — and its real photography on /services.html and /about.html. A
// homepage-only harvest can only ever report "photos: 0" for a site shaped that
// way, which is not the same thing as a business having no photographs.
const MAX_CRAWL_PAGES = 4;
const CRAWL_WHEN_FEWER_THAN = 6;
const CRAWL_HINTS = /(gallery|photo|project|portfolio|work|about|team|service|install|before|after)/i;

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  if (buf.slice(4, 12).toString().includes("ftypavif")) return "avif";
  return null;                  // svg and everything else: not a photo
}

/**
 * Pixel dimensions from the file header, or {w:0,h:0} when unreadable.
 *
 * Bytes alone are a poor proxy for "is this photography": Galli Plumbing's
 * Plumbing-Tulsa.jpg is 4KB AND 212x93 (correctly refused), but a heavily
 * compressed 1600px hero can sit near the byte floor while a decorative PNG
 * badge sails over it. Dimensions also drive ranking — with two slots, the
 * biggest real photograph should be one of them.
 *
 * Unreadable (avif, truncated header) returns zeros and is treated as "unknown",
 * never as "too small" — a missing measurement must not refuse a real photo.
 */
function imageSize(buf, ext) {
  try {
    if (ext === "png" && buf.length > 24) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (ext === "jpg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        const len = buf.readUInt16BE(i + 2);
        if (!Number.isFinite(len) || len < 2) break;
        i += 2 + len;
      }
    }
    if (ext === "webp" && buf.length > 30) {
      const fourcc = buf.slice(12, 16).toString();
      if (fourcc === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (fourcc === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
      if (fourcc === "VP8X") {
        return {
          w: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
          h: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
        };
      }
    }
  } catch { /* unreadable header: unknown, not small */ }
  return { w: 0, h: 0 };
}

/**
 * The identity of a picture, independent of which RESIZE of it this URL is.
 *
 * Content hashing alone cannot see that Untitled-1.png and
 * Untitled-1-300x100.png are one photograph — the bytes genuinely differ. Both
 * reached Owens Plumbing's request and, with two slots on the donor, a single
 * duplicated logo could have consumed the client's entire gallery. Strips the
 * responsive-width conventions of the builders we actually meet:
 *   WordPress   name-1024x517.png
 *   Duda/Thryv  name-874w.jpg
 *   Elementor   /elementor/thumbs/name-1234.jpg
 *   Wix         name~mv2.jpg/v1/fill/w_800,h_600/…
 */
function variantKey(url) {
  let u = String(url || "").split("?")[0].toLowerCase();
  u = u.replace(/\/v1\/(fill|crop|fit)\/[^/]+\//, "/");     // Wix render pipeline
  u = u.replace(/\/elementor\/thumbs\//, "/");
  const file = u.split("/").pop() || u;
  const dir = u.slice(0, u.length - file.length);
  const base = file
    .replace(/\.(jpe?g|png|webp|avif)$/i, "")
    .replace(/~mv2$/i, "")
    .replace(/-e\d{10,}$/i, "")            // WordPress edit stamp
    .replace(/-\d{2,5}x\d{2,5}$/i, "")     // -1024x517
    .replace(/-\d{2,5}w$/i, "")            // -874w
    .replace(/[-_](scaled|large|medium|small|thumb(nail)?)$/i, "");
  return dir + base;
}

/** Pull candidate image URLs out of the client's own homepage HTML. */
function candidatesFromHtml(html, baseUrl) {
  const out = [];
  const push = (u) => {
    const raw = String(u || "").trim();
    // Inline placeholders. Lazy-loading themes put a transparent SVG in `src`
    // and the real file in `data-lazy-src`; both match the src= regex below, so
    // the placeholder has to be dropped by value rather than by attribute.
    if (!raw || /^data:/i.test(raw)) return;
    try { out.push(new URL(raw, baseUrl).href); } catch { /* skip */ }
  };
  for (const m of String(html).matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of String(html).matchAll(/<img[^>]+srcset=["']([^"']+)["']/gi)) {
    const last = m[1].split(",").pop();          // largest variant listed
    if (last) push(last.trim().split(/\s+/)[0]);
  }
  // <picture> and responsive <source srcset> — the largest variant, same as an
  // <img srcset>. A photo-dense site often serves its hero ONLY through a
  // <source> inside a <picture> (or a <source> feeding an <img>), which the
  // <img> scans above never see — so a real hero was silently uncaptured.
  for (const m of String(html).matchAll(/<source[^>]+srcset=["']([^"']+)["']/gi)) {
    const last = m[1].split(",").pop();
    if (last) push(last.trim().split(/\s+/)[0]);
  }
  // <video poster> — the still frame a hero VIDEO shows before it plays. We do
  // not carry the video itself (the bank is photographs), but its poster IS a
  // real photograph of their business and is frequently the ONLY hero image on a
  // video-hero site: the render audit's Swoosh case had a hero <video> and no
  // <img> hero at all, so the home hero was uncapturable by any <img> scan.
  for (const m of String(html).matchAll(/<video[^>]+poster=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of String(html).matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of String(html).matchAll(/background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi)) push(m[1]);
  return out;
}

/** Same-site page links worth opening when the homepage has no photography. */
function pageLinksFromHtml(html, baseUrl) {
  const out = [];
  let ownDomain;
  try { ownDomain = registrable(new URL(baseUrl).hostname); } catch { return out; }
  for (const m of String(html).matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    let u;
    try { u = new URL(m[1], baseUrl); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (registrable(u.hostname) !== ownDomain) continue;
    if (/\.(pdf|jpe?g|png|webp|avif|zip|mp4|docx?)$/i.test(u.pathname)) continue;
    const href = u.href.split("#")[0];
    if (href.replace(/\/$/, "") === String(baseUrl).replace(/\/$/, "")) continue;
    if (!CRAWL_HINTS.test(u.pathname)) continue;
    out.push(href);
  }
  return [...new Set(out)];
}

/**
 * Lower sorts first. What lands in the donor's two slots is decided here.
 *
 * The demotions are all things that are technically on the client's site and
 * technically photographs, but are not pictures of THEIR WORK: the Open Graph
 * share card, a resized logo, a designer's shapes-and-arrows asset, a bought
 * "customer review" illustration. Every one of those was a real candidate on a
 * real prospect. The promotions are the paths businesses actually file job
 * photography under.
 */
function rankCandidate({ url, source, size = { w: 0, h: 0 } }) {
  const name = String(url || "").toLowerCase().split("?")[0];
  const file = name.split("/").pop() || "";
  let score = 0;
  if (source === "gbp") score -= 400;                                  // their Business Profile media is the owner's stated priority
  if (/(gallery|portfolio|project|our-?work|job|install|before|after|team|crew|truck|van|fleet)/.test(name)) score -= 300;
  if (/(service|about)/.test(name)) score -= 80;
  if (/(hero|banner|slide)/.test(name)) score -= 40;
  if (/(share|og[-_]?image|social|facebook|twitter|card)/.test(file)) score += 500;
  if (/(untitled|asset[-_]?\d|image[-_]?\d{1,2}$|img[-_]?\d{1,2}$|shape|arrow|pattern|texture|bg[-_])/.test(file)) score += 400;
  if (/(illustration|clipart|clip[-_]art|vector|3d[-_]|free[-_]png|mockup|graphic)/.test(file)) score += 450;
  if (/(review|rating|star|award|certified|licensed|insured|financing|coupon|offer)/.test(file)) score += 250;
  // Bigger is better, but only as a tie-break inside a band — a huge share card
  // must not outrank a modest photograph of a real job.
  const area = (size.w || 0) * (size.h || 0);
  if (area) score -= Math.min(120, Math.round(Math.sqrt(area) / 12));
  return score;
}

/**
 * harvestClientPhotos({ website, html?, genieAssets?, gbpPhotos?, extraUrls?, fetchImpl?, crawl? })
 * -> { ok, photos: [{url, source, sha256, ext, bytes, width, height}], rejected: [{url, reason}] }
 *
 * `photos` is ranked best-first (see rankCandidate), capped at MAX_PHOTOS.
 */
async function harvestClientPhotos({
  website = "",
  html = "",
  genieAssets = [],
  gbpPhotos = [],
  extraUrls = [],
  fetchImpl = fetch,
  crawl = true,
} = {}) {
  const site = String(website || "").trim();
  if (!/^https?:\/\//i.test(site)) return { ok: false, reason: "no_website", photos: [], rejected: [] };
  const ownDomain = registrable(new URL(site).hostname);

  const seenUrl = new Set();
  const candidates = [];
  const add = (u, source) => {
    const key = String(u || "").split("#")[0];
    if (!key || seenUrl.has(key)) return;
    seenUrl.add(key);
    candidates.push({ url: key, source });
  };

  const getPage = async (url) => {
    try {
      const r = await fetchImpl(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 WSSLabs-photos" } });
      if (r && r.ok) return await r.text();
    } catch { /* unreachable page: the other sources may still work */ }
    return "";
  };

  let pageHtml = html;
  if (!pageHtml) pageHtml = await getPage(site);
  for (const u of candidatesFromHtml(pageHtml || "", site)) add(u, "own_site");

  // THE HOMEPAGE IS NOT THE SITE. Only opened when the homepage was thin, so a
  // photo-rich site costs exactly the one request it always did.
  if (crawl && candidates.length < CRAWL_WHEN_FEWER_THAN && pageHtml) {
    for (const link of pageLinksFromHtml(pageHtml, site).slice(0, MAX_CRAWL_PAGES)) {
      const sub = await getPage(link);
      if (!sub) continue;
      for (const u of candidatesFromHtml(sub, link)) add(u, "own_site");
    }
  }

  // Their Google Business media — the owner's second named source, and the only
  // one that works for a business whose website is a single JS-rendered page.
  // Gated to Google's own hosts below like every other candidate.
  for (const u of gbpPhotos) add(u, "gbp");
  for (const a of genieAssets) if (a && a.url && /photo|image|gallery|hero/i.test(String(a.kind))) add(a.url, "genie_candidate");
  for (const u of extraUrls) add(u, "caller");

  const kept = [];
  const rejected = [];
  const seenSha = new Set();
  const seenVariant = new Set();

  for (const c of candidates) {
    if (kept.length >= MAX_PHOTOS) break;
    let host;
    try { host = new URL(c.url).hostname; } catch { rejected.push({ url: c.url, reason: "bad_url" }); continue; }

    // OWNERSHIP. Own domain, Google's GBP media host, or — only for a URL their
    // own page embeds — the tenant asset space of a named site builder.
    const owned = registrable(host) === ownDomain
      || GBP_HOSTS.test(host)
      || (c.source === "own_site" && BUILDER_HOSTS.test(host));
    if (!owned) { rejected.push({ url: c.url, reason: "not_owned" }); continue; }
    if (c.source === "gbp" && !GBP_HOSTS.test(host)) { rejected.push({ url: c.url, reason: "not_gbp_media" }); continue; }
    if (STOCK_RE.test(c.url)) { rejected.push({ url: c.url, reason: "stock_library" }); continue; }
    if (SKIP_HINTS.test(c.url)) { rejected.push({ url: c.url, reason: "icon_hint" }); continue; }
    // A bare page URL has no image extension and no GBP host — cheap pre-filter,
    // but only when the URL has a path extension at all (GBP media has none).
    if (!GBP_HOSTS.test(host) && /\.[a-z0-9]{2,5}(\?|$)/i.test(c.url) && !IMG_EXT.test(c.url)) {
      rejected.push({ url: c.url, reason: "not_an_image_url" });
      continue;
    }
    // The same picture at another width is not another picture.
    const vkey = variantKey(c.url);
    if (seenVariant.has(vkey)) { rejected.push({ url: c.url, reason: "duplicate_variant" }); continue; }

    // HTTPS OR NOTHING, and try the upgrade before giving up.
    //
    // A prospect's page is https but its markup often still hard-codes
    // http:// image sources — old templates, pasted absolute URLs, a site that
    // gained a certificate years after its content was written. Those URLs
    // travel all the way into brand.photos, where the mirror-request schema
    // requires ^https:// and a SINGLE one 400s the whole build with
    // "invalid_request". That is how All Home Plumbing and Advanced Plumbing
    // Service both died as "mirror_build_not_revealable" in the 40-metro run:
    // not a brand problem, not a render problem — eight perfectly good photos
    // on a host that serves every one of them over https.
    //
    // So we ask for https and keep what answers. If https does not serve the
    // image we DROP it (a smaller gallery, exactly like every other rejection
    // here) rather than passing http downstream: the mirror is served over
    // https, where a browser blocks mixed content anyway, so an http photo is
    // a broken image no matter how far it gets.
    const secureUrl = c.url.replace(/^http:\/\//i, "https://");
    try {
      const r = await fetchImpl(secureUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 WSSLabs-photos" } });
      if (!r.ok) {
        rejected.push({ url: c.url, reason: secureUrl === c.url ? `http_${r.status}` : `no_https_${r.status}` });
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = sniffImage(buf);
      if (!ext) { rejected.push({ url: c.url, reason: "not_a_photo" }); continue; }
      if (buf.length < MIN_BYTES) { rejected.push({ url: c.url, reason: "too_small" }); continue; }
      const size = imageSize(buf, ext);
      // Known-and-tiny is refused however heavy the file is. Unknown is not a
      // refusal — an unreadable header must never cost a real photograph.
      if (size.w && size.h && (size.w < MIN_EDGE || size.h < MIN_EDGE)) {
        rejected.push({ url: c.url, reason: "too_small_pixels" });
        continue;
      }
      const sha256 = createHash("sha256").update(buf).digest("hex");
      if (seenSha.has(sha256)) { rejected.push({ url: c.url, reason: "duplicate_bytes" }); continue; }
      seenSha.add(sha256);
      seenVariant.add(vkey);
      // Report the URL we actually READ, not the one the markup advertised —
      // it is the one the request carries and the one the bytes came from.
      kept.push({
        url: secureUrl,
        source: c.source,
        sha256,
        ext,
        bytes: buf.length,
        width: size.w,
        height: size.h,
        rank: rankCandidate({ url: secureUrl, source: c.source, size }),
      });
    } catch (e) {
      rejected.push({
        url: c.url,
        reason: secureUrl === c.url
          ? String(e.message || e).slice(0, 60)
          : `no_https: ${String(e.message || e).slice(0, 48)}`,
      });
    }
  }

  // BEST FIRST. The donor has two slots; this decides which two.
  const photos = kept
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.rank - b.p.rank) || (a.i - b.i))
    .map(({ p }) => p);

  return { ok: true, photos, rejected, ownDomain };
}

module.exports = {
  harvestClientPhotos,
  candidatesFromHtml,
  pageLinksFromHtml,
  variantKey,
  rankCandidate,
  imageSize,
  MAX_PHOTOS,
  MIN_BYTES,
  MIN_EDGE,
};
