"use strict";
// lib/client-photo-bank.js — the CLIENT'S OWN PHOTOGRAPHY, banked with provenance.
//
// WHY THIS FILE EXISTS (measured 2026-08-11, whole store, 1333 rows).
//
// A photo harvester (lib/mirror-engine/client-photos.js) was built and is live.
// It works: run against mmheatingandcooling.com it returns eleven photographs in
// ten seconds. But NOT ONE of the 424 stored mirror contracts carries a single
// entry in brand.photos, because the contract is written by lead-miner's
// mineBuildReady, whose brand block has only four keys — logo, logo_sha256,
// accent, accent_source. The harvester runs inside ONE of the two build paths in
// mirror-lane-build.js and its output has never been written down anywhere.
//
// Three consequences, all of them visible:
//   * anything reading the stored contract — the outreach email, the Connect
//     site KB, Riley's brief, a rebuild-from-contract — sees exactly one image
//     per client: the logo. That is the "1.0 images per site" the owner measured.
//   * every rebuild re-crawls the client's website from scratch (~10s) and can
//     get a different set each time. No sha, so no photo is recognisable across
//     rebuilds and nothing can be diffed, ranked by a human, or corrected.
//   * when the client's site is down at build time the photographs are simply
//     gone. Nothing was ever banked.
//
// And the packet path (a LeadMiner mirror_ready packet) never calls the
// harvester at all — it uses only the GBP photo URLs the packet happens to
// carry, so a business with a website full of photographs and no Google media
// builds with none.
//
// THE BANK is that missing durable layer. It never re-implements the ownership
// gate — lib/mirror-engine/client-photos.js owns that, and is called here
// verbatim, once per page, so `found_on` is exact. What this file adds is:
//
//   1. GBP RESOLUTION. Google gives the miner photo RESOURCE NAMES
//      ("places/X/photos/Y"), not URLs. Nothing resolved them, so the owner's
//      second named source has never reached a single build on the mined lane.
//   2. THE REFUSALS THE URL GATE CANNOT SEE — manufacturer badges and review
//      marks on the client's own domain, a site builder's SHARED stock library
//      served from the same CDN as the client's uploads, marketing banner
//      strips, and AI-generated pictures.
//   3. PROVENANCE — source, the page it was found on, dimensions, bytes and a
//      sha256, so the same photograph is the same row across every rebuild.
//   4. A GRADE. A 1920x907 photograph of their van is hero-grade; a 600x350
//      promo tile is not. The donor shows two slots, so which two is the product.
//
// TRUTH LAW. Everything here is REFUSED BY DEFAULT unless it is demonstrably the
// client's own picture. This system has already published a manufacturer's
// marketing shot as a client's logo; the failure mode is not hypothetical. When
// a business genuinely has no usable photography the bank says so, in a sentence,
// per host — that is a real answer and the caller must be able to act on it.

const { createHash } = require("node:crypto");
const {
  harvestClientPhotos,
  candidatesFromHtml,
  pageLinksFromHtml,
} = require("./mirror-engine/client-photos");
const { isThirdPartyMark } = require("./capture-brand");

const BANK_VERSION = 1;

// How many of the client's own pages to open. The harvester's own crawl is
// disabled here and replaced by this one for a single reason: it does not report
// WHICH page a photo came from, and provenance without a source page is not
// provenance. Same request budget, exact attribution.
const MAX_PAGES = 5;
const PAGE_HINTS = /(gallery|photo|project|portfolio|work|about|team|service|install|before|after)/i;

// Their Google Business media is only worth paying for when their own site did
// not supply enough. Places Photo media is a billed request per photo.
const GBP_WHEN_FEWER_THAN = 4;
const MAX_GBP_RESOLVES = 6;

const MAX_BANK = 20;

function cleanPlaceId(value) {
  const id = String(value || "").trim();
  return id && id.length <= 255 && !/[\u0000-\u001f\u007f]/.test(id) ? id : "";
}

/** The verified Google identity pin carried by mined/durable record shapes. */
function placeIdFromRecord(record = {}) {
  for (const value of [
    record.place_id,
    record.placeId,
    record.google_place_id,
    record?.mirror_request?.facts?.place_id,
    record?.build_ready?.mirror_request?.facts?.place_id,
    record?.truth_packet?.mirror_ready?.place_id,
    record?.leadminer_mirror_ready?.place_id,
  ]) {
    const id = cleanPlaceId(value);
    if (id) return id;
  }
  return "";
}

/** Parse the opaque Places media identity without weakening its exact shape. */
function parsePlacePhotoResourceName(value) {
  const resourceName = String(value || "").trim();
  const match = /^places\/([^/\s]+)\/photos\/([^/\s]+)$/.exec(resourceName);
  if (!match) return null;
  return {
    resource_name: resourceName,
    place_id: match[1],
    photo_id: match[2],
  };
}

function isGoogleMediaUrl(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return /(^|\.)(googleusercontent|ggpht)\.com$/.test(host);
  } catch { return false; }
}

function exactGoogleProfileUrl(value) {
  const raw = String(value || "").trim();
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const mapsHost = host === "maps.google.com" || host.endsWith(".maps.google.com");
    const googleHost = host === "google.com" || host.endsWith(".google.com");
    const mapsPath = url.pathname === "/maps" || url.pathname.startsWith("/maps/");
    return url.protocol === "https:"
      && !url.username && !url.password
      && (!url.port || url.port === "443")
      && (mapsHost || (googleHost && mapsPath))
      ? raw : "";
  } catch { return ""; }
}

function gbpProfileUrlFromRecord(record = {}) {
  for (const value of [
    record.gbp_url,
    record.maps_uri,
    record.google_maps_uri,
    record?.last_mine_observation?.googleMapsUri,
    record?.place?.googleMapsUri,
  ]) {
    const url = exactGoogleProfileUrl(value);
    if (url) return url;
  }
  return "";
}

// ---------------------------------------------------------------------------
// REFUSALS THE URL-OWNERSHIP GATE CANNOT SEE
// ---------------------------------------------------------------------------

// A SITE BUILDER'S SHARED STOCK LIBRARY, served from the same CDN as the
// client's own uploads.
//
// Measured on mmheatingandcooling.com (Hibu), 2026-08-11. The ownership gate
// correctly admits le-cdn.hibuwebsites.com because that is where this client's
// photographs live — but three of the eleven it returned were
//   /md/dmtmpl/dms3rep/multi/opt/people_pool_party-1920w.jpg
//   /md/dmip/dms3rep/multi/opt/woman-boxer-sport-1920w.jpg
//   /md/dmip/dms3rep/multi/opt/living-room-interior-design-white-sofa-1920w.jpg
// A pool party, a woman boxing and a white sofa, on an HVAC contractor's mirror.
// Those are Hibu's shared template imagery. The discriminator is the path, and
// it is unambiguous: this client's own uploads all sit under their tenant id
// (/b847cc53fe7645bc9f7477d935660aac/), Hibu's library sits under /md/.
//
// Everything else in this list is the same shape in another vendor's spelling,
// or a generic marker any CMS uses for demo content.
const SHARED_STOCK_PATH_RE = new RegExp([
  "/md/(dmtmpl|dmip|dmstock)/",       // Hibu shared template + image pool
  "/_dm/s/rw/",                        // Duda shared render pipeline
  "/(stock|stockphotos?|stock[-_]images?)/",
  "/(templates?|theme[-_]?demo|demo[-_]?content|dummy[-_]?content|sample[-_]images?)/",
  "/placeholders?/",
].join("|"), "i");

// A STOCK LIBRARY ID WITH THE VENDOR'S NAME STRIPPED OFF.
//
// Measured on mmheatingandcooling.com, 2026-08-11, by DOWNLOADING THE FILES AND
// LOOKING AT THEM. Their tenant space serves both
//   RSshutterstock_66958438-1920w.jpg     (refused — the word is in the name)
//   RS3204056-2440x3660-1920w.jpg         (kept, and it should not have been)
// The second is a professional studio photograph of a basement furnace whose
// service sticker reads "WESTMINSTER MECHANICAL INC." — a different company, in
// a picture we were about to publish as M & M's own work. Its sibling
// RS86517326 is the same: a stock utility-closet interior.
//
// The pattern is the builder's stock-ingestion convention: RS + the library's
// asset id, with the original asset dimensions carried in the filename
// (-2440x3660). It is narrow — six or more digits directly after RS at a name
// boundary — and the direction of error is the safe one: at worst we lose a
// photograph whose name looks like a stock id.
//
// The trailing boundary is a lookahead rather than a character class because
// the third sibling on that site is "RS86517326 (1)-1920w.jpg": the copy suffix
// puts a SPACE (percent-encoded, so a literal "+" in the pathname) directly
// after the id. A `[-_.]` class let that one through on the first pass and it
// shipped into the bank — same stock utility-closet interior as the other two.
const STOCK_ID_RE = /(^|[/_-])RS\d{6,}(?![0-9A-Za-z])/;

// PICTURES THAT ARE NOT PHOTOGRAPHS OF THEIR WORK.
//
// mmheatingandcooling.com publishes two files named
// Gemini_Generated_Image_6mayjy6mayjy6may-1920w.png. They are on the client's
// own tenant space and the client put them there, so they pass every ownership
// test — and they are still not a picture of this company doing this job. A
// generated image in a slot that reads as "our work" is the same lie as a stock
// photograph, so it is refused here rather than ranked low.
const GENERATED_IMAGE_RE = new RegExp([
  "gemini[-_]?generated", "chatgpt[-_]?image", "dall[-_]?e", "midjourney",
  "stable[-_]?diffusion", "firefly[-_]?generated", "ai[-_]?generated",
  "generated[-_]?image", "[-_]aigen[-_]", "leonardo[-_]?ai",
].join("|"), "i");

// A BANNER IS NOT A PHOTOGRAPH. "Web Banner 468 x 60", "SpecialFinancing_
// LearnMore_728x90", a manufacturer's logo strip — all of them are wide, thin
// marketing furniture. They only failed the existing gate by accident of file
// size. Shape is the honest test, and it is applied in both directions so a
// tall sidebar rail is caught too.
const BANNER_MAX_RATIO = 4.0;
const BANNER_MIN_RATIO = 0.25;

/**
 * notTheirPicture(photo) -> reason string, or "" when the photo may be kept.
 *
 * Runs AFTER lib/mirror-engine/client-photos.js has proved ownership of the
 * bytes. This is the second question — "granted it is served from their space,
 * is this picture theirs to give?" — and every branch has a live example
 * recorded against it above.
 */
function notTheirPicture(photo = {}) {
  const url = String(photo.url || "");
  if (!url) return "no_url";
  let host = "";
  let path = "";
  try { const u = new URL(url); host = u.hostname; path = u.pathname; }
  catch { return "bad_url"; }

  if (SHARED_STOCK_PATH_RE.test(path)) return "builder_shared_stock";
  if (STOCK_ID_RE.test(path)) return "stock_library_id";
  if (GENERATED_IMAGE_RE.test(path)) return "ai_generated_image";
  // The manufacturer/review/social denylist, shared with the miner and the
  // engine so the three can never disagree about whose mark is whose. Fed
  // `host + path` exactly as brand-assets.js feeds it, because the host is half
  // the evidence (a Facebook pixel gives nothing away in its filename).
  //
  // NOT APPLIED TO GOOGLE BUSINESS MEDIA. A GBP filename is an opaque ~200-char
  // token, and three of the denylist's entries are three letters long ("gaf",
  // "iko", "epa"): run against random base64 the basename test would refuse a
  // handful of perfectly good profile photographs for spelling a roofing brand
  // by accident. It costs nothing to skip, because GBP media needs no filename
  // evidence — the resource name binds the bytes to THIS place, which is a
  // stronger ownership proof than any path on any domain.
  if (!/(^|\.)(googleusercontent|ggpht)\.com$/i.test(host) && isThirdPartyMark(`${host}${path}`)) {
    return "third_party_mark";
  }

  const w = Number(photo.width) || 0;
  const h = Number(photo.height) || 0;
  if (w > 0 && h > 0) {
    const ratio = w / h;
    if (ratio > BANNER_MAX_RATIO || ratio < BANNER_MIN_RATIO) return "banner_shape";
  }
  return "";
}

// ---------------------------------------------------------------------------
// GRADE — which two of their photographs the donor's two slots get
// ---------------------------------------------------------------------------

// Hero grade is defined by what the hero SLOT needs: a wide photograph big
// enough that a retina viewport is not asked to invent pixels. 1200px is the
// donor's hero laid out at 600 CSS px on a 2x screen. Ratio bounds keep out
// portrait phone snaps (which letterbox badly behind text) without excluding the
// 3:2 and 16:9 shapes a camera actually produces.
const HERO_MIN_WIDTH = 1200;
const HERO_MIN_RATIO = 1.15;
const HERO_MAX_RATIO = 2.6;
const GALLERY_MIN_WIDTH = 640;

const BRAND_ASSET_TYPES = new Set(["logo", "brand_mark", "wordmark", "emblem"]);

/**
 * Preserve only explicit machine-readable identity signals. Google media names
 * are opaque, so a filename/path can never manufacture one of these fields.
 * `kind` is normalized onto the single durable `asset_type` contract.
 */
function explicitBrandSignals(photo = {}) {
  const out = {};
  if (photo.logo_like === true || photo.logoLike === true) out.logo_like = true;
  for (const value of [photo.asset_type, photo.assetType, photo.kind]) {
    let normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (normalized === "brandmark") normalized = "brand_mark";
    if (normalized === "word_mark") normalized = "wordmark";
    if (BRAND_ASSET_TYPES.has(normalized)) {
      out.asset_type = normalized;
      break;
    }
  }
  return out;
}

function classifiedAssetType(photo = {}, { deriveOwnSiteScene = false } = {}) {
  const brand = explicitBrandSignals(photo).asset_type;
  if (brand) return brand;
  const explicit = String(photo.asset_type || photo.assetType || photo.kind || "")
    .trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (explicit === "real_scene") return "real_scene";
  if (!deriveOwnSiteScene
    || Object.hasOwn(photo, "asset_type") || Object.hasOwn(photo, "assetType") || Object.hasOwn(photo, "kind")
    || String(photo.source || "") !== "own_site"
    || photo.logo_like === true || photo.logoLike === true
    || photo.stock_caption_suspect === true
    || !/^[a-f0-9]{64}$/i.test(String(photo.sha256 || ""))
    || notTheirPicture(photo)) return "";
  const width = Number(photo.width);
  const height = Number(photo.height);
  const measuredGrade = gradePhoto(photo).grade;
  const storedGrade = String(photo.grade || "");
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1
    || !["hero", "gallery"].includes(storedGrade)
    || measuredGrade !== storedGrade) return "";
  return "real_scene";
}

/** What a picture of the WORK looks like in a filename, in the words businesses use. */
const WORK_SUBJECT_RE = /(gallery|portfolio|project|our-?work|job|install|repair|before|after|team|crew|staff|truck|van|fleet|shop|office|building|storefront|jobsite|site|tech|technician)/i;

/**
 * A STOCK CAPTION WEARING THE CLIENT'S UPLOAD FOLDER.
 *
 * Measured on azurefrisco.com (Azure Med Spa), 2026-08-11, by downloading and
 * looking. Their /wp-content/uploads/ holds, side by side:
 *   IMG-20230607-WA0004.jpg                                    (their own)
 *   DrRamirez_AzureMedSpa-ezgif…webp                           (their own)
 *   a-permanent-makeup-master-checking-the-symmetry-of-the-eyebrow-marking.jpg
 *   slim-woman-in-overweight-pants-looking-herself-in-a-mirror-after-loosing…
 * The last two are studio stock — the filename IS the library's caption, kept
 * when a designer downloaded it. Ownership of the folder proves nothing here.
 *
 * THIS IS A DEMOTION, NOT A REFUSAL, and deliberately so. A contractor can
 * honestly name a real photograph "new-furnace-install-in-north-dallas.jpg",
 * and refusing that would cost them their own picture to block a suspicion. So
 * the rule only decides ORDER: with two donor slots, their unmistakable photos
 * go first and a suspected caption waits behind them. The flag rides on the
 * banked row so a person can overrule it.
 *
 * A stem carrying a token of their own name or domain is never flagged — that
 * is the business labelling its own work.
 */
const CAPTION_MIN_WORDS = 5;

function stockCaptionSuspect(url, businessTokens = []) {
  let stem = "";
  try {
    stem = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch { return false; }
  stem = stem.replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/-\d{2,5}x\d{2,5}$/i, "")
    .replace(/[-_](scaled|large|medium|small|thumb(nail)?)$/i, "");
  const words = stem.split(/[-_]+/).filter(Boolean);
  if (words.length < CAPTION_MIN_WORDS) return false;
  // Any digit-bearing token reads as a camera/CMS stamp (IMG_0182, 20230607),
  // not as prose.
  if (words.some((w) => /\d/.test(w))) return false;
  if (!words.every((w) => /^[a-z]+$/.test(w))) return false;
  const lower = stem.toLowerCase();
  return !businessTokens.some((t) => t && t.length >= 4 && lower.includes(t));
}

/**
 * gradePhoto(photo) -> { grade, why }
 *
 * grade is one of "hero" | "gallery" | "thumbnail". Unknown dimensions are
 * graded on bytes rather than refused: an unreadable header must never cost a
 * real photograph, exactly as in the harvester it sits behind.
 */
function gradePhoto(photo = {}) {
  const w = Number(photo.width) || 0;
  const h = Number(photo.height) || 0;
  if (!w || !h) {
    const bytes = Number(photo.bytes) || 0;
    return bytes >= 120_000
      ? { grade: "gallery", why: `dimensions_unreadable_but_${Math.round(bytes / 1024)}kb` }
      : { grade: "thumbnail", why: "dimensions_unreadable" };
  }
  const ratio = w / h;
  if (w >= HERO_MIN_WIDTH && ratio >= HERO_MIN_RATIO && ratio <= HERO_MAX_RATIO) {
    return { grade: "hero", why: `wide_${w}x${h}` };
  }
  if (w >= GALLERY_MIN_WIDTH || h >= GALLERY_MIN_WIDTH) {
    return { grade: "gallery", why: `${w}x${h}` };
  }
  return { grade: "thumbnail", why: `small_${w}x${h}` };
}

const GRADE_ORDER = { hero: 0, gallery: 1, thumbnail: 2 };

// THE SAME PHOTOGRAPH, RE-ENCODED UNDER ANOTHER NAME.
//
// Measured on mmheatingandcooling.com, 2026-08-11, by looking at the pictures:
//   IMG_0182-1920w.jpg                              1920x907  241470 bytes
//   m-and-m-heating-and-cooling-hero-ductwork-1920w.jpg  1920x907  241405 bytes
// are the identical photograph of M & M's two branded vans. Different bytes, so
// the sha dedupe cannot see it; different stems, so the responsive-variant
// dedupe cannot either. With two photo_slots on the donor, that one duplicate
// would have filled the client's ENTIRE gallery with the same van twice.
//
// The test is deliberately narrow — identical pixel dimensions AND file sizes
// within 1.5% — because it is a heuristic and the cost of a false positive is a
// lost photograph. Two genuinely different frames from one shoot can match on
// dimensions, but landing inside 1.5% on compressed size as well is the
// signature of a re-encode, not of two exposures.
const NEAR_DUP_BYTE_TOLERANCE = 0.015;

function isNearDuplicate(a = {}, b = {}) {
  if (!a.width || !a.height || !b.width || !b.height) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  const big = Math.max(a.bytes || 0, b.bytes || 0);
  if (!big) return false;
  return Math.abs((a.bytes || 0) - (b.bytes || 0)) / big <= NEAR_DUP_BYTE_TOLERANCE;
}

/**
 * Lower sorts first. Grade dominates, because the donor's slot count is small
 * and a thumbnail in the hero is the defect this ranking exists to prevent.
 * Inside a grade the harvester's own rank is respected — it already encodes the
 * promotions and demotions measured on real prospects (job photography up,
 * share cards and bought illustrations down) — and a filename that names the
 * subject of the work wins the tie.
 */
function bankRank(photo = {}) {
  let score = (GRADE_ORDER[photo.grade] ?? 3) * 1000;
  score += Number(photo.rank) || 0;
  if (photo.source === "gbp") score -= 120;                 // the owner's stated priority
  // Behind everything we are sure of, but still in the gallery. See
  // stockCaptionSuspect for why this is an order rule and not a refusal.
  if (photo.stock_caption_suspect) score += 700;
  if (WORK_SUBJECT_RE.test(String(photo.url || ""))) score -= 60;
  const area = (Number(photo.width) || 0) * (Number(photo.height) || 0);
  if (area) score -= Math.min(100, Math.round(Math.sqrt(area) / 16));
  return score;
}

// ---------------------------------------------------------------------------
// GOOGLE BUSINESS PROFILE — resolving what the miner already paid to discover
// ---------------------------------------------------------------------------

/**
 * The miner stores Places photo RESOURCE NAMES ("places/X/photos/Y"). They are
 * not URLs and nothing in the lane ever turned them into any, which is why the
 * owner's second named source has never reached a build on the mined path. The
 * media endpoint with skipHttpRedirect returns the CDN URI as JSON instead of a
 * 302, so one call yields a durable https URL we can bank.
 *
 * Billed per request, so callers gate it on the own-site harvest coming up short.
 */
async function resolvePlaceMediaUrl(name, { apiKey, fetchImpl = fetch, maxWidthPx = 1600 } = {}) {
  const resource = String(name || "").trim();
  if (!/^places\/[^/]+\/photos\/[^/]+$/.test(resource) || !apiKey) return null;
  const url = `https://places.googleapis.com/v1/${resource}/media`
    + `?maxWidthPx=${encodeURIComponent(maxWidthPx)}&skipHttpRedirect=true&key=${encodeURIComponent(apiKey)}`;
  try {
    const r = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!r || !r.ok) return null;
    const j = await r.json();
    const uri = j && (j.photoUri || j.photo_uri);
    return typeof uri === "string" && /^https:\/\//i.test(uri) ? uri : null;
  } catch { return null; }
}

/**
 * Every already-resolved GBP media URL on a prospect record, wherever the lane
 * that wrote it happened to leave it.
 *
 * THE POINT OF THIS FUNCTION. mirror-lane-build reads `record.photos` — a field
 * NOTHING writes (0 of 1333 rows). The resolved Google URLs are real and they
 * are on the record: M & M Heating carries four at
 * record.leadminer_mirror_ready.photos[].url, as OBJECTS, so even a caller that
 * found the right array would have dropped them on `typeof p === "string"`.
 * Reading the record correctly costs nothing and recovers photography we have
 * already paid Google for.
 */
function inspectResolvedGbpMedia(record = {}) {
  const verifiedPlaceId = placeIdFromRecord(record);
  const recordProfileUrl = gbpProfileUrlFromRecord(record);
  const refused = [];
  const byUrl = new Map();
  const scan = (v) => {
    // A legacy URL string has no row-level identity. It may remain on the old
    // record, but it cannot become newly minted GBP hero proof.
    if (typeof v === "string") {
      if (/^https:\/\//i.test(v) && isGoogleMediaUrl(v)) {
        refused.push({ url: v, reason: "gbp_identity_unpinned" });
      }
      return;
    }
    if (!v || typeof v !== "object") return;
    const url = String(v.url || "").trim();
    const looksGbp = v.source === "gbp" || isGoogleMediaUrl(url);
    if (!looksGbp || !/^https:\/\//i.test(url)) return;
    const rowPlaceId = cleanPlaceId(v.place_id || v.placeId);
    const rawResource = String(v.resource_name || v.name || "").trim();
    const resource = rawResource ? parsePlacePhotoResourceName(rawResource) : null;
    if (!verifiedPlaceId || !rowPlaceId) {
      refused.push({ url, reason: "gbp_identity_unpinned" });
      return;
    }
    if (rowPlaceId !== verifiedPlaceId) {
      refused.push({ url, reason: "gbp_place_id_mismatch" });
      return;
    }
    if (!resource) {
      refused.push({ url, reason: rawResource ? "gbp_resource_name_invalid" : "gbp_resource_name_unpinned" });
      return;
    }
    if (resource.place_id !== verifiedPlaceId) {
      refused.push({ url, reason: "gbp_place_id_mismatch" });
      return;
    }
    const row = {
      url,
      place_id: verifiedPlaceId,
      resource_name: resource.resource_name,
      ...((exactGoogleProfileUrl(v.found_on) || recordProfileUrl)
        ? { found_on: exactGoogleProfileUrl(v.found_on) || recordProfileUrl }
        : {}),
    };
    const previous = byUrl.get(url);
    if (!previous || (!previous.resource_name && row.resource_name)) byUrl.set(url, row);
  };
  const arrays = [
    record.photos,
    record.leadminer_mirror_ready && record.leadminer_mirror_ready.photos,
    record.truth_packet && record.truth_packet.mirror_ready && record.truth_packet.mirror_ready.photos,
    record.leadminer_truth_packet && record.leadminer_truth_packet.mirror_ready
      && record.leadminer_truth_packet.mirror_ready.photos,
  ];
  for (const arr of arrays) if (Array.isArray(arr)) for (const v of arr) scan(v);
  return { accepted: [...byUrl.values()], refused };
}

/** Identity-pinned resolved GBP objects, never unproved legacy URL strings. */
function gbpMediaFromRecord(record = {}) {
  return inspectResolvedGbpMedia(record).accepted;
}

function gbpUrlsFromRecord(record = {}) {
  return gbpMediaFromRecord(record).map((row) => row.url);
}

/** Places photo resource names on a record — the ones still needing a media call. */
function gbpNamesFromRecord(record = {}) {
  const out = [];
  const scan = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const v of arr) {
      const name = typeof v === "string" ? v : (v && typeof v === "object" ? (v.resource_name || v.name || "") : "");
      if (parsePlacePhotoResourceName(name) && !out.includes(name)) out.push(name);
    }
  };
  scan(record.photos);
  scan(record.last_mine_observation && record.last_mine_observation.photos);
  scan(record.place && record.place.photos);
  return out;
}

// ---------------------------------------------------------------------------
// THE HARVEST
// ---------------------------------------------------------------------------

/**
 * A fetch that answers the same URL once.
 *
 * The bank calls the harvester once per page so that `found_on` is exact; a
 * photograph in a header appears on every page, and without this every one of
 * them would be downloaded five times. Caches the BYTES and hands each caller a
 * fresh Response over the same buffer.
 */
function memoFetch(fetchImpl = fetch) {
  const cache = new Map();
  return async (url, init) => {
    const key = String(url);
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const r = await fetchImpl(url, init);
        const buf = Buffer.from(await r.arrayBuffer());
        return { ok: r.ok, status: r.status, buf };
      })().catch((e) => ({ error: e })));
    }
    const hit = await cache.get(key);
    if (hit.error) throw hit.error;
    return {
      ok: hit.ok,
      status: hit.status,
      arrayBuffer: async () => hit.buf,
      text: async () => hit.buf.toString("utf8"),
    };
  };
}

/** The client's own pages worth opening, homepage first. */
function pagesToOpen(website, html) {
  const pages = [website];
  if (!html) return pages;
  const links = pageLinksFromHtml(html, website)
    .filter((u) => PAGE_HINTS.test(u))
    .slice(0, MAX_PAGES - 1);
  return [...pages, ...links];
}

/**
 * buildPhotoBank(input) -> bank
 *
 * input:
 *   website        their site (https preferred; http is upgraded downstream)
 *   html           their homepage markup if the caller already has it (the
 *                  miner does — free, no extra request)
 *   record         the prospect record, read ONLY for already-resolved GBP media
 *   placesApiKey   enables resolving Places photo resource names to URLs
 *   fetchImpl      injected for tests
 *
 * Never throws. Every failure is a smaller bank with a reason attached, because
 * the alternative to a photograph is the donor's own imagery — always safe,
 * never a lie — and never a stock substitution.
 */
async function buildPhotoBank({
  website = "",
  html = "",
  record = {},
  placesApiKey = process.env.GOOGLE_PLACES_API_KEY || "",
  fetchImpl = fetch,
  harvest = harvestClientPhotos,
  resolveMedia = resolvePlaceMediaUrl,
  max = MAX_BANK,
  gbpWhenFewerThan = GBP_WHEN_FEWER_THAN,
  maxGbpResolves = MAX_GBP_RESOLVES,
  now = () => new Date().toISOString(),
} = {}) {
  const site = String(website || "").trim();
  const placeId = placeIdFromRecord(record);
  const gbpProfileUrl = gbpProfileUrlFromRecord(record);
  const bank = {
    version: BANK_VERSION,
    harvested_at: now(),
    website: site,
    ...(placeId ? { place_id: placeId } : {}),
    photos: [],
    refused: [],
    counts: { kept: 0, refused: 0, own_site: 0, gbp: 0, pages_opened: 0 },
    cost: { page_fetches: 0, gbp_media_calls: 0 },
    verdict: "no_website",
    note: "",
  };
  const fetcher = memoFetch(fetchImpl);
  const bySha = new Map();
  // Tokens of their own identity, so a filename that names THEM is never
  // mistaken for a stock caption. Taken from the registrable domain and the
  // host label — the two places a business writes its own name in a URL.
  const businessTokens = (() => {
    try {
      const host = new URL(site).hostname.toLowerCase().replace(/^www\./, "");
      return [host.split(".")[0], host.split(".").slice(-2)[0]].filter(Boolean);
    } catch { return []; }
  })();
  const refuse = (url, reason) => {
    bank.refused.push({ url: String(url || "").slice(0, 300), reason });
  };

  const take = (photo, foundOn, gbpEvidence = null) => {
    if (photo && photo.source === "gbp" && !gbpEvidence) {
      refuse(photo.url, "gbp_identity_unpinned");
      return;
    }
    const why = notTheirPicture(photo);
    if (why) { refuse(photo.url, why); return; }
    const { grade, why: gradeWhy } = gradePhoto(photo);
    const row = {
      url: photo.url,
      source: photo.source === "gbp" ? "gbp" : "own_site",
      found_on: foundOn,
      ...(photo.source === "gbp" ? {
        place_id: gbpEvidence.place_id,
        ...(gbpEvidence.resource_name ? { resource_name: gbpEvidence.resource_name } : {}),
      } : {}),
      width: Number(photo.width) || 0,
      height: Number(photo.height) || 0,
      bytes: Number(photo.bytes) || 0,
      ext: photo.ext || "",
      sha256: photo.sha256 || "",
      grade,
      grade_why: gradeWhy,
      ...explicitBrandSignals(photo),
      // Suspected library caption rather than a name a person typed. An ORDER
      // signal only — the flag is on the row so an operator can overrule it.
      ...(stockCaptionSuspect(photo.url, businessTokens) ? { stock_caption_suspect: true } : {}),
    };
    const classifiedType = classifiedAssetType(row, { deriveOwnSiteScene: true });
    if (classifiedType) row.asset_type = classifiedType;
    row.rank = bankRank({ ...row, rank: photo.rank });
    const seen = bySha.get(row.sha256);
    if (seen) {
      // The same photograph on two pages is one photograph. Keep the earlier
      // (better-ranked) row and record the second sighting rather than dropping
      // it silently — "it is on their gallery page too" is evidence.
      if (!seen.also_on) seen.also_on = [];
      if (foundOn !== seen.found_on && !seen.also_on.includes(foundOn)) seen.also_on.push(foundOn);
      return;
    }
    for (const kept of bySha.values()) {
      if (!isNearDuplicate(kept, row)) continue;
      // Keep whichever one the ranking prefers; the loser is recorded, not
      // silently dropped, so an operator can see the pair.
      if (row.rank < kept.rank) {
        bySha.delete(kept.sha256);
        refuse(kept.url, `near_duplicate_of:${row.sha256.slice(0, 12)}`);
        break;
      }
      refuse(row.url, `near_duplicate_of:${kept.sha256.slice(0, 12)}`);
      return;
    }
    bySha.set(row.sha256, row);
  };

  if (!/^https?:\/\//i.test(site)) {
    bank.note = "no website on the record, so their own site could not be read";
  } else {
    // THEIR OWN SITE, page by page. The harvester's internal crawl is off
    // (crawl:false) and replaced by this loop for provenance — see MAX_PAGES.
    let homeHtml = html;
    if (!homeHtml) {
      try {
        const r = await fetcher(site, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 WSSLabs-photos" } });
        bank.cost.page_fetches++;
        if (r.ok) homeHtml = await r.text();
      } catch { /* unreachable homepage: GBP may still carry them */ }
    }
    const pages = pagesToOpen(site, homeHtml);
    for (const page of pages) {
      let pageHtml = page === site ? homeHtml : "";
      if (!pageHtml) {
        try {
          const r = await fetcher(page, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 WSSLabs-photos" } });
          bank.cost.page_fetches++;
          if (!r.ok) continue;
          pageHtml = await r.text();
        } catch { continue; }
      }
      if (!pageHtml) continue;
      // Nothing to harvest from a page with no images at all — skip the call
      // rather than pay the harvester's own homepage GET for an empty result.
      if (!candidatesFromHtml(pageHtml, page).length) continue;
      bank.counts.pages_opened++;
      let out;
      try {
        // THE PAGE, not the site root, is the base URL. The harvester resolves
        // every relative src against whatever `website` it is given, so passing
        // the site root would turn `images/van.jpg` on /about into
        // https://site/images/van.jpg — a 404 on any site whose pages live in
        // folders. Its ownership gate is unaffected: the registrable domain of
        // a sub-page is the registrable domain of the site.
        out = await harvest({ website: page, html: pageHtml, fetchImpl: fetcher, crawl: false });
      } catch (e) {
        refuse(page, `harvest_threw:${String(e.message || e).slice(0, 60)}`);
        continue;
      }
      if (!out || !out.ok) { refuse(page, (out && out.reason) || "harvest_failed"); continue; }
      for (const p of out.photos || []) take(p, page);
      for (const r of out.rejected || []) refuse(r.url, r.reason);
    }
  }

  // THEIR GOOGLE BUSINESS MEDIA. Free when the record already carries resolved
  // URLs (the LeadMiner packet does, and nothing was reading them); billed when
  // only resource names exist, so that path is gated on the site coming up short.
  const inspectedResolved = inspectResolvedGbpMedia(record);
  for (const r of inspectedResolved.refused) refuse(r.url, r.reason);
  const gbpEvidence = [...inspectedResolved.accepted];
  const alreadyResolvedNames = new Set(gbpEvidence.map((row) => row.resource_name));
  const names = gbpNamesFromRecord(record);
  const validNames = [];
  for (const name of names) {
    const parsed = parsePlacePhotoResourceName(name);
    if (!placeId) {
      refuse(name, "gbp_place_id_unverified");
    } else if (!parsed || parsed.place_id !== placeId) {
      refuse(name, "gbp_place_id_mismatch");
    } else if (!alreadyResolvedNames.has(parsed.resource_name)) {
      validNames.push(parsed);
    }
  }
  const alreadyResolved = gbpEvidence.map((row) => row.url);
  const needMore = bySha.size < gbpWhenFewerThan;
  let gbpUrls = alreadyResolved;
  if (needMore && placesApiKey) {
    for (const parsed of validNames.slice(0, maxGbpResolves)) {
      const url = await resolveMedia(parsed.resource_name, { apiKey: placesApiKey, fetchImpl });
      bank.cost.gbp_media_calls++;
      if (url) {
        if (!gbpUrls.includes(url)) gbpUrls = [...gbpUrls, url];
        if (!gbpEvidence.some((row) => row.url === url)) {
          gbpEvidence.push({
            url,
            place_id: placeId,
            resource_name: parsed.resource_name,
            ...(gbpProfileUrl ? { found_on: gbpProfileUrl } : {}),
          });
        }
      }
    }
  }
  if (gbpUrls.length && (needMore || alreadyResolved.length)) {
    try {
      // `html` is a single comment so the harvester finds no page candidates and
      // does not re-fetch the homepage; only the GBP urls are offered.
      const out = await harvest({
        website: site || "https://example.invalid/",
        html: "<!-- gbp only -->",
        gbpPhotos: gbpUrls,
        fetchImpl: fetcher,
        crawl: false,
      });
      if (out && out.ok) {
        const evidenceByUrl = new Map(gbpEvidence.map((row) => [row.url, row]));
        for (const p of out.photos || []) {
          const evidence = evidenceByUrl.get(p.url) || null;
          take(p, (evidence && evidence.found_on) || gbpProfileUrl || "google_business_profile", evidence);
        }
        for (const r of out.rejected || []) refuse(r.url, r.reason);
      }
    } catch (e) { refuse("google_business_profile", `harvest_threw:${String(e.message || e).slice(0, 60)}`); }
  }

  bank.photos = [...bySha.values()].sort((a, b) => a.rank - b.rank).slice(0, max);
  bank.counts.kept = bank.photos.length;
  bank.counts.refused = bank.refused.length;
  bank.counts.own_site = bank.photos.filter((p) => p.source === "own_site").length;
  bank.counts.gbp = bank.photos.filter((p) => p.source === "gbp").length;
  bank.counts.hero = bank.photos.filter((p) => p.grade === "hero").length;
  bank.counts.caption_suspect = bank.photos.filter((p) => p.stock_caption_suspect).length;

  // THE HONEST PER-HOST SENTENCE. "No usable photography" is a real answer for
  // a real business and must be distinguishable from "we did not look".
  if (!/^https?:\/\//i.test(site) && !gbpUrls.length) {
    bank.verdict = "not_attempted";
    bank.note = "no website and no Google Business media on the record — nothing to read";
  } else if (bank.photos.length) {
    bank.verdict = "photography";
    bank.note = `${bank.photos.length} of their own photograph(s)`
      + `${bank.counts.hero ? `, ${bank.counts.hero} hero-grade` : ", none hero-grade"}`
      + ` (${bank.counts.own_site} from their site, ${bank.counts.gbp} from their Google profile)`;
  } else {
    bank.verdict = "no_usable_photography";
    const top = topReasons(bank.refused);
    bank.note = bank.refused.length
      ? `this business publishes no usable photography of its own — ${bank.refused.length} candidate(s) all refused (${top})`
      : "this business publishes no images at all on the pages we can read";
  }
  return bank;
}

function topReasons(refused = [], limit = 3) {
  const counts = {};
  for (const r of refused) counts[r.reason] = (counts[r.reason] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, n]) => `${reason} x${n}`)
    .join(", ");
}

/**
 * bankFromHarvest(harvestPhotos, { website, foundOn, now }) -> bank
 *
 * The SAME durable bank buildPhotoBank produces, but assembled from a harvest
 * that ALREADY RAN — no second network pass.
 *
 * WHY THIS EXISTS. mirror-lane-build's resolver path harvests the client's
 * photography inline (one crawl, bytes fetched, a sha per photo) and then kept
 * only the URL strings for brand.photos. The ranked bank ROWS — with the grade
 * the hero slot needs and the sha the engine joins on — were thrown away, so
 * the design brief's identity verdicts (their CURRENT hero image, the owner/
 * crew portrait) had nothing to land on, `brand.photo_bank` was absent, and the
 * engine's hero wash reported "no_photo_bank" and left EVERY page hero on the
 * donor's own empty default. Nothing ever wrote a bank onto a mined record
 * either (see this file's header: 0 of 1333 rows), so bankFromRecord could not
 * cover for it. This turns the in-hand harvest into the bank those consumers
 * read, through the SAME ownership (notTheirPicture), grade (gradePhoto) and
 * rank (bankRank) primitives the crawling path uses — the two can never
 * disagree about which photograph is hero-grade or whose picture it is.
 *
 * `harvestPhotos` are harvestClientPhotos() rows: { url, source, sha256, ext,
 * bytes, width, height, rank }. Never throws; bad input is an empty bank.
 */
function bankFromHarvest(harvestPhotos = [], {
  website = "", foundOn = "", placeId: rawPlaceId = "", gbpEvidence = [], now = () => new Date().toISOString(),
} = {}) {
  const site = String(website || "").trim();
  const where = String(foundOn || site || "client_website");
  const placeId = cleanPlaceId(rawPlaceId);
  const bank = {
    version: BANK_VERSION,
    harvested_at: now(),
    website: site,
    ...(placeId ? { place_id: placeId } : {}),
    photos: [],
    refused: [],
    counts: { kept: 0, refused: 0, own_site: 0, gbp: 0, pages_opened: 0 },
    cost: { page_fetches: 0, gbp_media_calls: 0 },
    source: "inline_harvest",
    verdict: "no_usable_photography",
    note: "",
  };
  // Tokens of their own identity, so a filename that names THEM is never
  // mistaken for a stock caption — exactly as buildPhotoBank derives them.
  const businessTokens = (() => {
    try {
      const host = new URL(site).hostname.toLowerCase().replace(/^www\./, "");
      return [host.split(".")[0], host.split(".").slice(-2)[0]].filter(Boolean);
    } catch { return []; }
  })();
  const refuse = (url, reason) => bank.refused.push({ url: String(url || "").slice(0, 300), reason });
  const bySha = new Map();
  const evidenceByUrl = new Map();
  for (const evidence of Array.isArray(gbpEvidence) ? gbpEvidence : []) {
    if (!evidence || typeof evidence !== "object") continue;
    const url = String(evidence.url || "").trim();
    const evidencePlaceId = cleanPlaceId(evidence.place_id || evidence.placeId);
    const rawResource = String(evidence.resource_name || evidence.name || "").trim();
    const resource = rawResource ? parsePlacePhotoResourceName(rawResource) : null;
    if (!/^https:\/\//i.test(url) || !placeId || evidencePlaceId !== placeId) continue;
    if (!resource || resource.place_id !== placeId) continue;
    evidenceByUrl.set(url, {
      place_id: placeId,
      resource_name: resource.resource_name,
      ...((exactGoogleProfileUrl(evidence.found_on) || evidence.found_on === "google_business_profile")
        ? { found_on: evidence.found_on }
        : {}),
    });
  }
  for (const photo of Array.isArray(harvestPhotos) ? harvestPhotos : []) {
    if (!photo || !photo.url || !photo.sha256) continue;
    let pinnedGbp = null;
    if (photo.source === "gbp") {
      pinnedGbp = evidenceByUrl.get(photo.url) || null;
      if (!pinnedGbp) {
        const photoPlaceId = cleanPlaceId(photo.place_id || photo.placeId);
        const rawResource = String(photo.resource_name || photo.name || "").trim();
        const resource = rawResource ? parsePlacePhotoResourceName(rawResource) : null;
        if (placeId && photoPlaceId === placeId && resource && resource.place_id === placeId) {
          pinnedGbp = {
            place_id: placeId,
            resource_name: resource.resource_name,
            ...((exactGoogleProfileUrl(photo.found_on) || photo.found_on === "google_business_profile")
              ? { found_on: photo.found_on }
              : {}),
          };
        }
      }
      if (!pinnedGbp) { refuse(photo.url, "gbp_identity_unpinned"); continue; }
    }
    const why = notTheirPicture(photo);
    if (why) { refuse(photo.url, why); continue; }
    const { grade, why: gradeWhy } = gradePhoto(photo);
    const row = {
      url: photo.url,
      source: photo.source === "gbp" ? "gbp" : "own_site",
      found_on: photo.source === "gbp" ? (pinnedGbp.found_on || "google_business_profile") : where,
      ...(pinnedGbp ? {
        place_id: pinnedGbp.place_id,
        ...(pinnedGbp.resource_name ? { resource_name: pinnedGbp.resource_name } : {}),
      } : {}),
      width: Number(photo.width) || 0,
      height: Number(photo.height) || 0,
      bytes: Number(photo.bytes) || 0,
      ext: photo.ext || "",
      sha256: photo.sha256 || "",
      grade,
      grade_why: gradeWhy,
      ...explicitBrandSignals(photo),
      ...(stockCaptionSuspect(photo.url, businessTokens) ? { stock_caption_suspect: true } : {}),
    };
    row.rank = bankRank({ ...row, rank: photo.rank });
    if (bySha.has(row.sha256)) continue;                       // same bytes, one photo
    let dropped = false;
    for (const kept of bySha.values()) {
      if (!isNearDuplicate(kept, row)) continue;
      // The same photograph re-encoded under another name. Keep whichever the
      // ranking prefers; record the loser rather than dropping it silently.
      if (row.rank < kept.rank) {
        bySha.delete(kept.sha256);
        refuse(kept.url, `near_duplicate_of:${row.sha256.slice(0, 12)}`);
      } else {
        refuse(row.url, `near_duplicate_of:${kept.sha256.slice(0, 12)}`);
        dropped = true;
      }
      break;
    }
    if (dropped) continue;
    bySha.set(row.sha256, row);
  }
  bank.photos = [...bySha.values()].sort((a, b) => a.rank - b.rank).slice(0, MAX_BANK);
  bank.counts.kept = bank.photos.length;
  bank.counts.refused = bank.refused.length;
  bank.counts.own_site = bank.photos.filter((p) => p.source === "own_site").length;
  bank.counts.gbp = bank.photos.filter((p) => p.source === "gbp").length;
  bank.counts.hero = bank.photos.filter((p) => p.grade === "hero").length;
  bank.counts.caption_suspect = bank.photos.filter((p) => p.stock_caption_suspect).length;
  bank.verdict = bank.photos.length ? "photography" : "no_usable_photography";
  bank.note = bank.photos.length
    ? `${bank.photos.length} of their own photograph(s) from an inline harvest`
      + `${bank.counts.hero ? `, ${bank.counts.hero} hero-grade` : ", none hero-grade"}`
    : "the inline harvest returned no usable photography";
  return bank;
}

/**
 * bankToRequestPhotos(bank, max) -> ["https://…", …]
 *
 * The plain array MirrorRequest.brand.photos takes, hero-grade first. ORDER IS
 * THE PRODUCT: the engine fills the donor's photo_slots in array order and
 * plumbing-clean declares two, so this decides which two of a client's twenty
 * photographs a visitor sees.
 */
function bankToRequestPhotos(bank, max = 8) {
  const photos = bank && Array.isArray(bank.photos) ? bank.photos : [];
  return photos
    .map((p) => String(p.url || ""))
    .filter((u) => /^https:\/\//i.test(u))
    .slice(0, max);
}

/** A bank stored on a record, whatever shape the row is in. */
function bankFromRecord(record = {}) {
  const direct = record && record.photo_bank;
  if (direct && typeof direct === "object" && Array.isArray(direct.photos)) return direct;
  const br = record && record.build_ready;
  if (br && typeof br === "object" && br.photo_bank && Array.isArray(br.photo_bank.photos)) return br.photo_bank;
  return null;
}

/** Is a banked harvest still worth reusing instead of re-crawling their site? */
function bankIsFresh(bank, { maxAgeDays = 30, now = Date.now } = {}) {
  if (!bank || !Array.isArray(bank.photos)) return false;
  const t = Date.parse(String(bank.harvested_at || ""));
  if (!Number.isFinite(t)) return false;
  const ageMs = Number(now()) - t;
  // Clock skew of a few minutes is harmless. A bank dated years in the future
  // is not freshness evidence and must never become an indefinite bypass.
  return ageMs >= -5 * 60_000 && ageMs <= maxAgeDays * 86_400_000;
}

/** sha of the bank's contents — changes only when the photographs change. */
function bankFingerprint(bank) {
  const urls = (bank && Array.isArray(bank.photos) ? bank.photos : []).map((p) => p.sha256 || p.url).join("|");
  return createHash("sha256").update(urls).digest("hex").slice(0, 16);
}

/**
 * enrichGbpPhotos(record, options) -> bank | null
 *
 * Pull the prospect's Google Business Profile photos into a photo bank using
 * the Places API photo-media endpoint.  This is the miner/packet-stage entry
 * point: it is a thin wrapper around buildPhotoBank that runs in GBP-only mode
 * (no website crawl) and returns null immediately when the record carries no
 * verified place_id — so callers never need to guard the call themselves.
 *
 * AC compliance:
 *   (1) place_id + resource names  →  ≥1 GBP photo after enrichment
 *   (2) stock-looking GBP URLs rejected via notTheirPicture (reuses client-photos rules)
 *   (3) no API call when place_id is absent — returns null, zero network I/O
 *   (4) fully injectable resolveMedia / harvest / fetchImpl for unit tests
 */
async function enrichGbpPhotos(record, options = {}) {
  if (!placeIdFromRecord(record)) return null;
  return buildPhotoBank({ website: "", record, ...options });
}

module.exports = {
  BANK_VERSION,
  HERO_MIN_WIDTH,
  HERO_MIN_RATIO,
  HERO_MAX_RATIO,
  GALLERY_MIN_WIDTH,
  SHARED_STOCK_PATH_RE,
  GENERATED_IMAGE_RE,
  STOCK_ID_RE,
  isNearDuplicate,
  stockCaptionSuspect,
  notTheirPicture,
  gradePhoto,
  classifiedAssetType,
  bankRank,
  gbpUrlsFromRecord,
  gbpMediaFromRecord,
  gbpNamesFromRecord,
  parsePlacePhotoResourceName,
  resolvePlaceMediaUrl,
  pagesToOpen,
  memoFetch,
  buildPhotoBank,
  bankFromHarvest,
  bankToRequestPhotos,
  bankFromRecord,
  bankIsFresh,
  bankFingerprint,
  cleanPlaceId,
  placeIdFromRecord,
  topReasons,
  enrichGbpPhotos,
};
