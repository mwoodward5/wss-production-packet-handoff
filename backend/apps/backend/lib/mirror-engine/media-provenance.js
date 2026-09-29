"use strict";

// lib/mirror-engine/media-provenance.js — MEDIA PROVENANCE, SEMANTIC
// CLASSIFICATION, AND THE CROSS-PROSPECT CONTAMINATION GUARD.
//
// Owner's video research report (verbatim, the three findings this module
// exists to answer):
//
//   "The repeated construction hero visual across different prospects is a
//    red flag. Asset selection must be keyed by prospect/release identity and
//    verified before render."
//
//   "Jeff Sullivan's WSS gallery visibly includes interior-room imagery
//    alongside concrete/outdoor work. Introduce semantic media classification
//    and section eligibility rules."
//
//   "Never count an asset as 'placed' merely because a URL exists."
//
// THE MODEL
//
// Every image/video the engine places on a generated site carries a
// provenance record (schema wss.media-provenance.v1):
//
//   prospect_id          — the prospect this asset belongs to. The engine
//                          derives the build's identity from {slug, facts}
//                          (buildProspectId); a banked row that already
//                          carries a prospect_id is honoured and CHECKED
//                          against the build's id.
//   source_url           — where the asset was extracted from (the
//                          prospect's own site / GBP media URL).
//   content_hash         — sha256 of the bytes the resolver fetched and
//                          magic-byte sniffed. An asset with no verified hash
//                          is never placed: a URL alone is not placement.
//   media_class          — coarse semantic classification (the eight classes
//                          below) from the URL + alt text + surrounding
//                          context + photo-bank flags.
//   section_eligibility  — which page sections (hero / gallery / about /
//                          service_card / background) the class + vertical +
//                          ownership tier make this asset eligible for.
//   ownership_tier       — "owned_verified" (fetched+hashed from THIS build's
//                          own brand media) or "stock_suspect" (banked with a
//                          stock-caption verdict, or a stock-library path).
//
// THE CONTAMINATION GUARD
//
// An asset extracted for prospect A cannot appear in prospect B's build. At
// build time every asset's prospect_id is verified against the current
// build's prospect_id; a mismatch DROPS the asset with reason
// "cross_prospect_contamination" — it is never replaced with someone else's
// picture. The donor's own generic imagery (trade-matched template stock) is
// the only fallback, which is exactly the "neutral trade-appropriate fallback
// that cannot be mistaken for the client's own project work". The sole
// exemption is an explicit WSS brand asset (the flag) marked
// wss_brand_asset: true.
//
// THE TRADE RULES (the Jeff Sullivan failure)
//
// The classifier keys trade keywords to classes; a class that belongs to a
// DIFFERENT trade than the build's vertical is trade-conflicted and rejected
// from every proof section — interior_remodel on a concrete contractor is
// the exact live defect ("interior-room imagery alongside concrete/outdoor
// work"), and the symmetric case (a driveway photo on a kitchen remodeler)
// is the same lie told backwards.
//
// GENERIC STOCK vs OWNED-UNCLASSIFIED — a deliberate, documented split:
//
// The eight-class enum's "generic_stock" bucket conflates two different
// things, and the guard separates them by ownership tier:
//
//   · stock_suspect (a stock-caption verdict from the photo bank, or a
//     stock-library path) is background/texture ONLY — never hero, never
//     gallery proof, never a service card. Someone else's studio picture is
//     not this client's work.
//
//   · owned_verified with no classification signal (the fleet's bulk: GBP
//     media URLs are opaque ~200-char tokens with no filename evidence) is
//     the CLIENT'S OWN picture. It stays eligible for gallery/about — the
//     ownership gate upstream already refused third-party and stock-library
//     URLs — but NEVER for the hero, where the bar is trade-relevant media
//     or their own flagged current-hero/identity portrait, and never as a
//     silent substitute for classified work imagery.

const { createHash } = require("node:crypto");

const MEDIA_CLASSES = [
  "concrete",
  "exterior",
  "interior_remodel",
  "people_team",
  "vehicle",
  "logo",
  "map",
  "generic_stock",
];

const SECTION_NAMES = ["hero", "gallery", "about", "service_card", "background"];

const PROVENANCE_SCHEMA = "wss.media-provenance.v1";

// ---------------------------------------------------------------------------
// Keyword evidence. Phrases are matched against URL + alt + context with all
// separators (/, ., -, _, query syntax) folded to single spaces, so
// "driveway-stamped.jpg", "stamped_driveway" and "/Driveway%20Stamped" all
// read the same. Keyword sets are deliberately coarse: the classification
// feeds placement rules, not alt text.
//
// CHECK ORDER IS LOAD-BEARING and fails toward the SAFER class: logo and map
// first (narrow, unambiguous), then interior_remodel BEFORE concrete — an
// image carrying both kitchen and concrete evidence must land interior so the
// wrong-trade rejection fires (under-placing is recoverable; contaminating a
// gallery is not). people_team/vehicle follow, exterior last.
// ---------------------------------------------------------------------------

// Phrases that OVERRIDE the keyword ladder entirely. An outdoor kitchen is
// hardscape (concrete contractors build them); the bare word "kitchen" must
// not reclassify it as interior work.
const PHRASE_OVERRIDES = [
  { phrase: "outdoor kitchen", media_class: "concrete" },
  { phrase: "outdoor living", media_class: "exterior" },
];

const CLASS_KEYWORDS = {
  logo: [
    "logo", "logos", "brandmark", "brand mark", "wordmark", "word mark",
    "emblem", "company seal",
  ],
  map: [
    "map", "maps", "service area", "servicearea", "coverage map",
    "location map", "service map", "areas we serve",
  ],
  interior_remodel: [
    "interior", "interiors", "kitchen", "kitchens", "bathroom", "bathrooms",
    "living room", "bedroom", "bedrooms", "dining room", "indoors", "indoor",
    "basement", "countertop", "countertops", "cabinets", "cabinetry",
    "vanity", "interior remodel", "interior renovation", "home remodel",
    "home renovation",
  ],
  concrete: [
    "concrete", "concreting", "driveway", "driveways", "patio", "patios",
    "stamped", "flatwork", "sidewalk", "sidewalks", "walkway", "walkways",
    "hardscape", "hardscaping", "masonry", "paver", "pavers", "paving",
    "curbing", "retaining wall", "foundation", "slab", "slabs", "overlay",
    "exposed aggregate", "polished concrete", "colored concrete",
  ],
  people_team: [
    "team", "teams", "crew", "crews", "staff", "owner", "owners", "portrait",
    "headshot", "about us", "aboutus", "employee", "employees", "worker",
    "workers", "technician", "technicians", "family",
  ],
  vehicle: [
    "truck", "trucks", "van", "vans", "fleet", "trailer", "trailers",
    "pickup", "excavator", "skid steer", "bobcat", "equipment", "machinery",
  ],
  exterior: [
    "exterior", "outdoor", "outdoors", "yard", "backyard", "front yard",
    "landscape", "landscaping", "lawn", "sod", "mulch", "fence", "fences",
    "fencing", "deck", "decks", "decking", "pergola", "roof", "roofs",
    "roofing", "gutter", "gutters", "siding", "windows", "shingle",
    "shingles",
  ],
};

const CLASS_CHECK_ORDER = [
  "logo",
  "map",
  "interior_remodel",
  "concrete",
  "people_team",
  "vehicle",
  "exterior",
];

// Stock-library vocabulary: a URL/alt wearing a library's name or the words
// "stock photo" is someone else's studio picture, whatever else it says.
const STOCK_LIBRARY_PHRASES = [
  "shutterstock", "istock", "istockphoto", "gettyimages", "getty images",
  "depositphotos", "123rf", "dreamstime", "pexels", "unsplash", "freepik",
  "adobe stock", "stock photo", "stock photos", "stockphoto",
  "stock image", "stock photography",
];

// ---------------------------------------------------------------------------
// Vertical families. The trade-conflict rule needs to know which family the
// BUILD's vertical belongs to; anything unmapped is cross-trade-neutral and
// conflicts with nothing.
// ---------------------------------------------------------------------------

const CONCRETE_FAMILY = new Set([
  "concrete", "concrete contractor", "concrete contractors", "cement",
  "cement contractor", "masonry", "mason", "hardscaping", "hardscape",
  "flatwork", "paving", "paver", "pavers", "driveway",
  "driveway contractor", "sidewalk contractor", "curbing",
]);

const INTERIOR_FAMILY = new Set([
  "interior", "interior design", "interior designer", "interior remodeling",
  "interior remodel", "remodel", "remodeler", "remodeling", "remodeling contractor",
  "kitchen remodeler", "bathroom remodeler", "kitchen remodeling",
  "bathroom remodeling", "kitchen and bath", "home remodeling",
]);

// class -> classes it must never sit beside on a proof surface of the other's
// trade. Symmetric: interior work has no business proving a concrete
// contractor, and a driveway cannot prove a kitchen remodeler. A family's own
// trade class is never in its conflict set — a remodeler's kitchen photos are
// exactly their trade.
const TRADE_CONFLICTS = {
  concrete: new Set(["interior_remodel"]),
  interior: new Set(["concrete"]),
};

// Base section eligibility per class, before vertical conflicts, ownership
// tier and identity flags adjust it.
const BASE_SECTION_ELIGIBILITY = {
  concrete: ["hero", "gallery", "about", "service_card"],
  exterior: ["hero", "gallery", "about", "service_card"],
  interior_remodel: ["hero", "gallery", "about", "service_card"],
  people_team: ["about", "gallery"],
  vehicle: ["gallery", "about"],
  logo: [],
  map: ["about"],
  generic_stock: ["gallery", "about", "background"],
};

const SHA256_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Text normalisation + matching
// ---------------------------------------------------------------------------

/**
 * Fold URL/alt/context text into lowercase single-spaced words. The URL
 * contributes its PATH AND QUERY only — never the hostname: hosts are CDNs
 * and API endpoints whose names lie ("maps.googleapis.com" serves place
 * photographs, not maps), and a false "map" there would misclassify the
 * fleet's entire GBP media supply.
 */
function classificationText({ url = "", alt = "", context = "" } = {}) {
  let urlPart = String(url || "");
  try {
    const u = new URL(url);
    urlPart = `${u.pathname}${u.search}`;
  } catch { /* not an absolute URL: classify the string as given (filenames, keys) */ }
  const raw = `${urlPart} ${alt} ${context}`;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* % sequences that are not valid escapes stay literal */ }
  return decoded
    .toLowerCase()
    .replace(/[\s_\-./\\?&=+,:;'"]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phrasesIn(text, phrases) {
  const hit = (p) => {
    const phrase = String(p).toLowerCase().trim();
    if (!phrase) return false;
    return phrase.includes(" ")
      ? text.includes(phrase)
      : new RegExp(`(^| )${phrase}( |$)`).test(text);
  };
  return phrases.filter(hit);
}

/** @returns {"concrete"|"interior"|null} */
function verticalFamily(vertical) {
  const v = String(vertical || "").toLowerCase().trim();
  if (!v) return null;
  if (CONCRETE_FAMILY.has(v)) return "concrete";
  if (INTERIOR_FAMILY.has(v)) return "interior";
  return null;
}

/**
 * The build's prospect identity. Derived from the two fields every mirror
 * request already carries — slug + verified business_name — because the
 * request schema has no prospect id, and client-isolation (step 3b of the
 * engine) already treats slug+name as the durable identity of a client.
 * Deterministic and readable, so a dropped asset's report names both sides
 * of a contamination refusal.
 */
function buildProspectId({ slug = "", facts = {} } = {}) {
  const name = String((facts && (facts.business_name || facts.name)) || "")
    .trim().toLowerCase().replace(/\s+/g, " ");
  const s = String(slug || "").trim().toLowerCase();
  return `${s || "no-slug"}|${name || "no-name"}`.slice(0, 200);
}

/**
 * Coarse semantic classification of one asset.
 *
 * @param {object} input
 *   url, alt, context — the text evidence (context = surrounding page/section
 *                       text when the caller has it).
 *   vertical          — the build's vertical (prospects' industry / donor's).
 *   stockSuspect      — the photo bank's stock-caption verdict, or a
 *                       stock-library path match.
 * @returns {{ media_class: string, basis: {where: string, matched: string[]},
 *            ownership_tier: "owned_verified"|"stock_suspect",
 *            trade_conflict: boolean, section_eligibility: string[] }}
 */
function classifyMediaAsset({ url = "", alt = "", context = "", vertical = "", stockSuspect = false } = {}) {
  const text = classificationText({ url, alt, context });
  const stockPhrases = phrasesIn(text, STOCK_LIBRARY_PHRASES);
  const isStock = stockSuspect === true || stockPhrases.length > 0;

  let mediaClass = "generic_stock";
  let where = "none";
  let matched = [];

  for (const override of PHRASE_OVERRIDES) {
    if (phrasesIn(text, [override.phrase]).length) {
      mediaClass = override.media_class;
      where = "phrase";
      matched = [override.phrase];
      break;
    }
  }

  if (mediaClass === "generic_stock") {
    for (const cls of CLASS_CHECK_ORDER) {
      const hits = phrasesIn(text, CLASS_KEYWORDS[cls]);
      if (hits.length) {
        mediaClass = cls;
        where = url && classificationText({ url }).includes(hits[0]) ? "url" : "alt_or_context";
        matched = hits.slice(0, 4);
        break;
      }
    }
  }

  // STOCK EVIDENCE OUTRANKS THE KEYWORD LADDER. A library path or a
  // stock-caption verdict means the picture is someone else's, whatever the
  // filename says about driveways — it degrades to generic_stock under the
  // stock tier (background/texture only), with the keyword hits kept in the
  // basis so a report still shows what nearly redeemed it.
  if (isStock && mediaClass !== "generic_stock") {
    matched = [...matched, ...stockPhrases.slice(0, 2)];
    mediaClass = "generic_stock";
    where = "stock_path_or_flag";
  }

  const family = verticalFamily(vertical);
  const tradeConflict = Boolean(
    family
    && TRADE_CONFLICTS[family]
    && TRADE_CONFLICTS[family].has(mediaClass)
    && mediaClass !== "generic_stock",
  );

  return {
    media_class: mediaClass,
    basis: { where, matched: isStock && !matched.length ? stockPhrases.slice(0, 2) : matched },
    ownership_tier: isStock ? "stock_suspect" : "owned_verified",
    trade_conflict: tradeConflict,
    section_eligibility: sectionEligibilityFor(mediaClass, {
      vertical, tradeConflict, stockSuspect: isStock,
    }),
  };
}

/**
 * Section eligibility for a classified asset: base class map, emptied by a
 * trade conflict, tightened for stock, widened for the identity flags the
 * photo bank carries (their own current hero image / an identity-critical
 * portrait earns the hero on any owned class).
 */
function sectionEligibilityFor(mediaClass, { vertical = "", tradeConflict = false, stockSuspect = false, currentHero = false, identityCritical = false } = {}) {
  if (tradeConflict) return [];
  let sections = [...(BASE_SECTION_ELIGIBILITY[mediaClass] || [])];
  if (mediaClass === "generic_stock" && stockSuspect) {
    sections = sections.filter((s) => s === "background");
  }
  if (
    (currentHero || identityCritical)
    && !stockSuspect
    && mediaClass !== "logo"
    && mediaClass !== "map"
    && !sections.includes("hero")
  ) {
    sections.unshift("hero");
  }
  return sections;
}

/**
 * Bind a provenance record onto an asset description.
 * Pure: returns the record; the caller attaches it.
 */
function bindProvenance(asset = {}, {
  prospectId = "",
  sourceUrl = "",
  contentHash = "",
  url = "",
  alt = "",
  context = "",
  vertical = "",
  currentHero = false,
  identityCritical = false,
  stockSuspect = false,
  wssBrandAsset = false,
} = {}) {
  const cls = classifyMediaAsset({
    url: url || String(asset.url || ""),
    alt: alt || String(asset.alt || ""),
    context: context || String(asset.context || ""),
    vertical,
    stockSuspect,
  });
  const eligibility = sectionEligibilityFor(cls.media_class, {
    vertical,
    tradeConflict: cls.trade_conflict,
    stockSuspect: cls.ownership_tier === "stock_suspect",
    currentHero,
    identityCritical,
  });
  const record = {
    schema: PROVENANCE_SCHEMA,
    prospect_id: String(prospectId || asset.prospect_id || "").trim(),
    source_url: String(sourceUrl || asset.originUrl || asset.url || "").trim(),
    content_hash: String(contentHash || asset.sha256 || "").toLowerCase(),
    media_class: cls.media_class,
    section_eligibility: eligibility,
    ownership_tier: cls.ownership_tier,
    trade_conflict: cls.trade_conflict,
    classified_from: cls.basis,
    bound_at_build: true,
  };
  if (currentHero || asset.current_hero === true) record.current_hero = true;
  if (identityCritical || asset.identity_critical === true) record.identity_critical = true;
  if (wssBrandAsset || asset.wss_brand_asset === true) record.wss_brand_asset = true;
  return record;
}

/** An explicit WSS brand asset (the flag) is the one thing allowed to cross prospects. */
function isWssBrandAsset(asset = {}) {
  return asset.wss_brand_asset === true
    || Boolean(asset.provenance && asset.provenance.wss_brand_asset === true);
}

/**
 * BUILD-TIME PLACEMENT VERIFICATION — the guard every placement site calls.
 *
 * @param {object} asset — must carry `.provenance` (see bindProvenance).
 * @param {object} opts
 *   prospectId — the current build's prospect id (verified on every call).
 *   section    — "hero" | "gallery" | "about" | "service_card" | "background".
 * @returns {{ ok: boolean, reason?: string, detail?: object, provenance?: object }}
 */
function verifyAssetPlacement(asset, { prospectId = "", section = "" } = {}) {
  const provenance = asset && asset.provenance;
  if (!provenance || typeof provenance !== "object" || provenance.schema !== PROVENANCE_SCHEMA) {
    return { ok: false, reason: "asset_missing_prospect_binding" };
  }
  if (!String(provenance.prospect_id || "").trim()) {
    return { ok: false, reason: "asset_missing_prospect_binding" };
  }
  // "Never count an asset as 'placed' merely because a URL exists": the
  // content hash of the fetched, sniffed bytes is the placement licence.
  if (!SHA256_RE.test(String(provenance.content_hash || ""))) {
    return { ok: false, reason: "asset_content_hash_unverified" };
  }
  const buildId = String(prospectId || "").trim();
  if (buildId && provenance.prospect_id !== buildId) {
    if (isWssBrandAsset(asset)) {
      // The explicit WSS brand exemption (the flag graphic). Nothing else
      // may cross prospects — a refusal is never a substitution.
    } else {
      return {
        ok: false,
        reason: "cross_prospect_contamination",
        detail: { asset_prospect: provenance.prospect_id, build_prospect: buildId },
      };
    }
  }
  if (section) {
    if (provenance.trade_conflict) {
      return { ok: false, reason: `wrong_trade_media:${provenance.media_class}` };
    }
    if (provenance.ownership_tier === "stock_suspect" && section !== "background") {
      return { ok: false, reason: "stock_media_not_proof" };
    }
    if (provenance.media_class === "logo" && section !== "background") {
      return { ok: false, reason: "logo_is_not_photo_media" };
    }
    if (provenance.media_class === "map" && section !== "about" && section !== "background") {
      return { ok: false, reason: "map_is_not_work_media" };
    }
  }
  return { ok: true, provenance };
}

function urlsEqual(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  return !!x && x === y;
}

/**
 * Bind + verify the engine's resolved photo pool in one pass.
 *
 * Carried bindings (photo_bank rows stamped with prospect_id, or resolver
 * rows that already carry one) are honoured: a row extracted for another
 * prospect is DROPPED here with cross_prospect_contamination — before any
 * slot, wash or manifest can see it. Everything else is bound to THIS build
 * and re-verified; assets without a usable content hash are dropped rather
 * than placed.
 *
 * @returns {{ allowed: object[], dropped: {url:string, reason:string}[],
 *            classCounts: object, prospectId: string, vertical: string }}
 */
function guardAssetPool(assets = [], { prospectId = "", vertical = "", bank = [] } = {}) {
  const rows = Array.isArray(bank) ? bank : [];
  const allowed = [];
  const dropped = [];
  const classCounts = {};

  for (const asset of Array.isArray(assets) ? assets : []) {
    if (!asset || !asset.url) continue;
    const row = rows.find((r) => r && urlsEqual(r.url, asset.url)) || {};
    const carried = String(row.prospect_id || asset.prospect_id || "").trim();
    const flags = {
      currentHero: row.current_hero === true || asset.current_hero === true,
      identityCritical: row.identity_critical === true || asset.identity_critical === true,
      stockSuspect: row.stock_caption_suspect === true || asset.stock_caption_suspect === true,
      wssBrandAsset: row.wss_brand_asset === true || asset.wss_brand_asset === true,
    };

    const provenance = bindProvenance(asset, {
      prospectId: carried || prospectId,
      sourceUrl: asset.originUrl || asset.url,
      contentHash: asset.sha256,
      url: asset.url,
      vertical,
      ...flags,
    });
    const bound = { ...asset, provenance };

    // The class census counts everything CLASSIFIED, kept or dropped — the
    // report must show the interior-room picture the guard caught, not only
    // the photographs that survived it.
    classCounts[provenance.media_class] = (classCounts[provenance.media_class] || 0) + 1;

    // The cross-prospect refusal: an asset keyed to another prospect is
    // dropped, never swapped for a same-shaped one.
    if (carried && !flags.wssBrandAsset && prospectId && carried !== prospectId) {
      dropped.push({
        url: asset.url,
        reason: "cross_prospect_contamination",
        prospect_id: carried,
      });
      continue;
    }

    const verified = verifyAssetPlacement(bound, { prospectId });
    if (!verified.ok) {
      dropped.push({ url: asset.url, reason: verified.reason });
      continue;
    }
    // An asset eligible for NO section never reaches placement: wrong-trade
    // media (interior rooms on a concrete contractor) and logo-class files
    // have empty eligibility by construction, and the guard is where that
    // becomes a named per-asset drop instead of a slot-loop surprise.
    if (!Array.isArray(provenance.section_eligibility) || !provenance.section_eligibility.length) {
      dropped.push({
        url: asset.url,
        reason: provenance.trade_conflict
          ? `wrong_trade_media:${provenance.media_class}`
          : `ineligible_media_class:${provenance.media_class}`,
      });
      continue;
    }

    allowed.push(bound);
  }

  return { allowed, dropped, classCounts, prospectId, vertical };
}

/**
 * THE HERO PROVENANCE GATE. The hero is the highest-impact identity surface:
 * a wrong hero is the "repeated construction hero visual across different
 * prospects" the owner flagged.
 *
 * Ranking among verified candidates (prospect match + no stock + no trade
 * conflict are HARD gates applied first):
 *   4 — their own flagged current hero image
 *   3 — an identity-critical portrait (owner/crew)
 *   2 — trade-relevant work imagery (concrete / exterior / trade-matched
 *       interior)
 *   1 — any other OWNED, verified picture — only chosen when nothing better
 *       exists, because a donor with no photo slots has no other surface for
 *       the client's photography (the pinned no-slot-donor contract).
 *
 * When nothing passes, the hero keeps the donor's own neutral, trade-matched
 * surface — never another prospect's image, which the prospect check above
 * has already made structurally impossible.
 *
 * @returns {{ asset: object|null, reason: string, fallback: string|null,
 *             rejected: {url:string, reason:string}[] }}
 */
function selectHeroAsset(candidates = [], { prospectId = "" } = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  const rejected = [];
  const scored = [];
  let firstRefusal = "";

  for (const candidate of list) {
    const verified = verifyAssetPlacement(candidate, { prospectId, section: "hero" });
    if (!verified.ok) {
      rejected.push({ url: candidate.url, reason: verified.reason });
      if (!firstRefusal) firstRefusal = verified.reason;
      continue;
    }
    const prov = candidate.provenance;
    let score = 1;
    if (["concrete", "exterior", "interior_remodel"].includes(prov.media_class)) score = 2;
    if (prov.identity_critical) score = 3;
    if (prov.current_hero) score = 4;
    scored.push({ asset: candidate, score });
  }

  if (!scored.length) {
    return {
      asset: null,
      reason: list.length ? (firstRefusal || "no_hero_eligible_owned_media") : "no_hero_candidates",
      fallback: "neutral_donor_surface",
      rejected,
    };
  }
  let best = scored[0];
  for (const entry of scored.slice(1)) {
    if (entry.score > best.score) best = entry;
  }
  return { asset: best.asset, reason: "", fallback: null, rejected };
}

module.exports = {
  MEDIA_CLASSES,
  SECTION_NAMES,
  PROVENANCE_SCHEMA,
  buildProspectId,
  classifyMediaAsset,
  sectionEligibilityFor,
  bindProvenance,
  verifyAssetPlacement,
  guardAssetPool,
  selectHeroAsset,
  isWssBrandAsset,
  verticalFamily,
};
