"use strict";

// lib/mirror-engine/donor-fingerprint.js — THE CLIENT'S VISUAL DNA, MEASURED
// AND DEFENDED.
//
// Owner directive (2026-09, the Atlanta / Jeff Sullivan video review): "Atlanta
// and Jeff Sullivan WSS renders share a very similar hero composition, header,
// typography scale, red CTA treatment, section rhythm, and light-page component
// system. Add a similarity budget so donor-independent sites cannot converge
// too strongly. The WSS render should use the real logo when technically
// usable rather than reducing identity to text. Donor blue/orange is strong
// and recognizable — WSS should derive a controlled palette from donor
// identity instead of defaulting to the same red/light template treatment."
//
// NAMING, because this file sits in mirror-engine/ where "donor" has always
// meant the TEMPLATE: here "donor" means the CLIENT'S OWN LIVE SITE — the
// business's original website whose identity the mirror is supposed to carry
// forward. The "donor fingerprint" is that site's measured visual DNA, and the
// "distinctiveness score" asks one question of every generated site: does this
// render still look like THE CLIENT, or does it look like the same template
// with the names swapped?
//
// TWO HALVES, one file:
//
//   1. extractDonorFingerprint() — build-time extraction from the client's own
//      homepage HTML (already in the miner's hand; zero extra fetches). It
//      consumes lib/brand-extractor's palette verdict rather than re-deriving
//      colour, and layers on what no existing lane measures: logo candidates
//      with dimensions and alt text, heading typography pattern, the hero's
//      dominant motif, section ordering, THE ACTUAL SERVICE NAMES (a client who
//      sells "Stamped Concrete", "Concrete Driveways" and "Concrete Patios" is
//      NOT sold as "Concrete Services"), the proof inventory (reviews, photos,
//      certifications, years-in-business) and the CTA structure.
//
//   2. scoreDonorFingerprint() — after the build, five measured components —
//      logo_used, palette_proximity, hero_provenance, taxonomy_retention,
//      proof_retention — weighted to 0..100. Below DONOR_FINGERPRINT_FLOOR (50)
//      the build "looks like the same template with names swapped": it is
//      refused certification and flagged for closer donor-fidelity mode. This
//      is INSTRUMENTATION FIRST (owner scope for this change): the score rides
//      the build report and the release gate logs a warning — it never blocks
//      publication, and it never enters the build hash, so a fingerprint added
//      to a request cannot invalidate a memo or a proof shot.
//
// A client who HAS no logo, no reviews and no service names is not punished:
// components whose donor-side signal is absent are "not applicable" and their
// weight is redistributed, so the score stays a fair measure of FIDELITY, not
// of wealth.
//
// Server-side, regex over HTML the caller already holds, zero npm deps, never
// throws for absence — an empty page yields an honest sparse fingerprint.

const { hexToHsl, relativeLuminance } = require("./theme");
const { htmlToVisibleText } = require("./visible-text");
const brandExtractor = require("../brand-extractor");

/** Below this the build is "the same template with names swapped". */
const DONOR_FINGERPRINT_FLOOR = 50;

// Component weights — they sum to 100 over a fully applicable fingerprint.
const WEIGHTS = Object.freeze({
  logo_used: 25,
  palette_proximity: 20,
  hero_provenance: 15,
  taxonomy_retention: 25,
  proof_retention: 15,
});

const HERO_MOTIFS = Object.freeze([
  "photo-led", "texture-led", "illustration-led", "video-led", "text-minimal", "unknown",
]);
const HEADING_PATTERNS = Object.freeze(["condensed", "normal", "light", "unknown"]);
const CTA_STRUCTURES = Object.freeze(["phone-dominant", "form-dominant", "quote-dominant", "unknown"]);

// ---------------------------------------------------------------------------
// shared HTML helpers (attribute reads that tolerate every quoting style)
// ---------------------------------------------------------------------------

function tagAttr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(String(tag || ""));
  if (!m) return "";
  return (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || "").trim();
}

/** Strip tags + entities to comparable lowercase words: "Fences &#038; Decks"
 *  and "fences & decks" must be the same string to every matcher below. */
function loose(value) {
  return String(value == null ? "" : value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;|&#0?38;|&/gi, " and ")
    .replace(/&rsquo;|&#8217;|['’`]/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP_WORDS = new Set(["and", "or", "the", "a", "an", "of", "for", "in", "on", "with", "our", "your", "all", "new"]);

/** Content words of a phrase (len > 2, not stopwords) — the partial-match basis. */
function contentWords(value) {
  return loose(value).split(" ").filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// 1a. LOGO CANDIDATES — every header-grade image, with dimensions and alt text
// ---------------------------------------------------------------------------

function usableImageSrc(src, baseUrl) {
  if (!src) return "";
  if (/^(?:data|blob|javascript):/i.test(src)) return "";
  if (/\b(?:sprite|pixel|1x1|blank|spacer|tracking)\b/i.test(src)) return "";
  try {
    const abs = new URL(src, baseUrl);
    if (abs.protocol !== "https:") return "";
    return abs.href;
  } catch { return ""; }
}

/** Walk JSON-LD blocks; collect schema.org logo declarations (Organization /
 *  LocalBusiness `logo`, string or ImageObject). Tolerates broken blocks. */
function schemaLogoUrls(html) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const logo = node.logo;
    if (typeof logo === "string" && /^https:\/\//i.test(logo)) out.push(logo);
    else if (logo && typeof logo === "object") {
      const url = String(logo.url || logo.contentUrl || "");
      if (/^https:\/\//i.test(url)) out.push(url);
    }
    for (const value of Object.values(node)) walk(value);
  };
  for (const m of String(html || "").matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* a broken block is not a logo */ }
  }
  return out;
}

/**
 * Header-grade logo candidates, best first: class/id/alt/src that says "logo"
 * (header placements outrank), then schema.org logo declarations, then the
 * first <img> inside <header>/<nav>. Each carries URL, width/height attributes
 * and alt text — the fields the render-time logo decision needs.
 */
function logoCandidates(html, baseUrl) {
  const text = String(html || "");
  const headerRegions = [
    ...[...text.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi)].map((m) => m[1]),
    ...[...text.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi)].map((m) => m[1]),
  ];
  const scored = [];
  const scan = (region, inHeader) => {
    for (const m of String(region || "").matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const url = usableImageSrc(tagAttr(tag, "src"), baseUrl);
      if (!url) continue;
      const w = parseInt(tagAttr(tag, "width"), 10);
      const h = parseInt(tagAttr(tag, "height"), 10);
      if (w === 1 || h === 1) continue; // a tracking pixel is nobody's logo
      const cls = `${tagAttr(tag, "class")} ${tagAttr(tag, "id")}`;
      const label = `${tagAttr(tag, "alt")} ${tagAttr(tag, "title")}`;
      const src = tagAttr(tag, "src");
      let score = 0;
      if (/logo/i.test(cls)) score = Math.max(score, 4);
      if (/logo/i.test(label)) score = Math.max(score, 3);
      if (/logo/i.test(src)) score = Math.max(score, 2);
      if (inHeader) score += 2;
      if (score >= 2) {
        scored.push({
          url, score, index: scored.length,
          width: Number.isFinite(w) ? w : null,
          height: Number.isFinite(h) ? h : null,
          alt: tagAttr(tag, "alt").slice(0, 200),
          grade: /logo/i.test(cls) ? "logo_class" : /logo/i.test(label) || /logo/i.test(src) ? "logo_labeled" : "header_image",
        });
      }
    }
  };
  for (const region of headerRegions) scan(region, true);
  scan(text, false);
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const out = [];
  const seen = new Set();
  const push = (entry) => {
    if (!entry || !entry.url || seen.has(entry.url)) return;
    seen.add(entry.url);
    out.push(entry);
  };
  for (const c of scored) {
    push({ url: c.url, width: c.width, height: c.height, alt: c.alt, grade: c.grade });
  }
  for (const url of schemaLogoUrls(text)) {
    push({ url, width: null, height: null, alt: "", grade: "schema_org" });
  }
  // Positional fallback: the first <img> inside a <header>.
  for (const region of headerRegions) {
    const m = /<img\b[^>]*>/i.exec(String(region || ""));
    if (!m) continue;
    const url = usableImageSrc(tagAttr(m[0], "src"), baseUrl);
    if (url) {
      const w = parseInt(tagAttr(m[0], "width"), 10);
      const h = parseInt(tagAttr(m[0], "height"), 10);
      if (w === 1 || h === 1) continue;
      push({
        url, width: Number.isFinite(w) ? w : null, height: Number.isFinite(h) ? h : null,
        alt: tagAttr(m[0], "alt").slice(0, 200), grade: "header_first",
      });
    }
    break;
  }
  return out.slice(0, 8);
}

// ---------------------------------------------------------------------------
// 1b. PALETTE — consumed from lib/brand-extractor, never re-derived
// ---------------------------------------------------------------------------

function paletteFromBrandIdentity(brandIdentity) {
  const id = brandIdentity && typeof brandIdentity === "object" ? brandIdentity : {};
  const hex = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toUpperCase() : "");
  const background = hex(id.background);
  let mode = "unknown";
  if (background) {
    try { mode = relativeLuminance(background) < 0.35 ? "dark" : "light"; } catch { mode = "unknown"; }
  }
  return {
    accent_color: hex(id.accent_color),
    secondary_color: hex(id.secondary_color),
    background,
    mode,
    // The extraction lane's own confidence rides along: a LOW accent is a
    // weaker DNA claim than a HIGH one, and the audit can say so.
    confidence: ["HIGH", "MEDIUM", "LOW"].includes(String(id.confidence || "").toUpperCase())
      ? String(id.confidence).toUpperCase() : "LOW",
  };
}

// ---------------------------------------------------------------------------
// 1c. TYPOGRAPHY — the font, and the heading weight/scale pattern
// ---------------------------------------------------------------------------

/**
 * Heading typography pattern from the page's own CSS: font-weight, negative
 * letter-spacing and uppercase transform on h1-h6. The three-way verdict the
 * owner's review named (condensed vs normal vs light):
 *   condensed — heavy weight (>=600) worn tight (negative tracking) or loud
 *               (uppercase), or a family that says so in its name
 *   light     — headings declared at <=300 weight
 *   normal    — headings declared, unremarkably
 *   unknown   — no heading declarations found (the common WordPress case)
 */
function headingPattern(html) {
  const css = brandExtractor.collectStyleBlocks(html).join("\n");
  const weights = [];
  let tightOrLoud = false;
  let scaleMax = 0;
  let bodySize = 16;
  for (const rule of css.match(/(^|})\s*([^{}]*\bh[1-6]\b[^{}]*)\s*\{([^{}]*)\}/gi) || []) {
    const body = /\{([^{}]*)\}/i.exec(rule);
    const decls = body ? body[1] : "";
    const w = /font-weight\s*:\s*(\d{3,4})/i.exec(decls);
    if (w) weights.push(parseInt(w[1], 10));
    if (/letter-spacing\s*:\s*-\d/.test(decls) || /text-transform\s*:\s*uppercase/i.test(decls)) tightOrLoud = true;
    const size = /font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(decls);
    if (size) scaleMax = Math.max(scaleMax, parseFloat(size[1]));
  }
  const bodyPx = /(^|})\s*(body|html)\s*\{([^{}]*)\}/i.exec(css);
  const bodyDecl = bodyPx ? bodyPx[3] : "";
  const bs = /font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(bodyDecl);
  if (bs) bodySize = Math.max(9, parseFloat(bs[1]));
  // An inline-styled h1 counts: the full Hurricane capture wears its pattern
  // there (font-weight:1000; letter-spacing:-3px; uppercase).
  for (const m of String(html || "").matchAll(/<h[1-6]\b[^>]*style\s*=\s*["']([^"']*)["']/gi)) {
    const decls = m[1];
    const w = /font-weight\s*:\s*(\d{3,4})/i.exec(decls);
    if (w) weights.push(parseInt(w[1], 10));
    if (/letter-spacing\s*:\s*-\d/.test(decls) || /text-transform\s*:\s*uppercase/i.test(decls)) tightOrLoud = true;
    const size = /font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(decls);
    if (size) scaleMax = Math.max(scaleMax, parseFloat(size[1]));
  }
  const family = (brandExtractor.extractFontFamily({ html, cssTexts: [css] }) || "");
  if (/condensed|narrow|impact|compressed/i.test(family)) tightOrLoud = true;
  if (!weights.length) {
    return { font_family: family, heading_weight_pattern: "unknown", heading_scale: scaleMax ? Math.round((scaleMax / bodySize) * 10) / 10 : null };
  }
  // The DISPLAY heading sets the page's voice, so the heaviest declared
  // weight decides "condensed" — the full Hurricane capture mixes 100-300
  // body headings with a 1000-weight uppercase h1, and the page is loud.
  const heaviest = Math.max(...weights);
  const pattern = heaviest >= 600 && tightOrLoud ? "condensed" : heaviest <= 300 ? "light" : "normal";
  return {
    font_family: family,
    heading_weight_pattern: pattern,
    heading_scale: scaleMax ? Math.round((scaleMax / bodySize) * 10) / 10 : null,
  };
}

// ---------------------------------------------------------------------------
// 1d. HERO MOTIF — what the donor's hero is actually made of
// ---------------------------------------------------------------------------

/** The region the page itself treats as its hero: a section/element named
 *  hero/banner/masthead/jumbotron, else the <section> carrying the h1, else
 *  the window of body around the first h1. */
function heroRegion(html) {
  const text = String(html || "");
  const named = /<(?:section|div|header)\b[^>]*class\s*=\s*["'][^"']*\b(?:hero|banner|masthead|jumbotron)[^"']*["'][^>]*>/i.exec(text);
  if (named) {
    const start = named.index;
    const close = text.slice(start).search(/<\/(?:section|div|header)>/i);
    if (close > 0) return text.slice(start, start + close);
  }
  const h1At = text.search(/<h1\b/i);
  if (h1At >= 0) {
    for (const m of text.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)) {
      if (/<h1\b/i.test(m[1])) return m[1];
    }
    return text.slice(Math.max(0, h1At - 1500), h1At + 3500);
  }
  return "";
}

/** The dominant hero visual type. Photo before illustration before texture,
 *  because a photo with a gradient over it is still a photo; video outranks
 *  everything. Absence of all of them is the honest "text-minimal". Only REAL
 *  media elements count — a <video> tag or a background-video class — never a
 *  script URL that happens to mention mp4. */
function heroMotif(html) {
  const region = heroRegion(html);
  if (!region) return "unknown";
  if (/<video\b/i.test(region) || /class\s*=\s*["'][^"']*\b(?:background-video|video-hero|hero-video)\b/i.test(region)) return "video-led";
  const imgs = [...region.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const contentImg = imgs.find((t) => !/logo/i.test(`${tagAttr(t, "class")} ${tagAttr(t, "alt")} ${tagAttr(t, "src")}`));
  const bgImage = /background[^;:]*:\s*[^;]*url\((?!["']?data:)/i.test(region);
  if (contentImg || bgImage) return "photo-led";
  if (/<svg\b/i.test(region) || /\.svg/i.test(region)) return "illustration-led";
  if (/(?:linear|radial)-gradient|pattern|texture/i.test(region)) return "texture-led";
  return "text-minimal";
}

// ---------------------------------------------------------------------------
// 1e. SECTION ORDERING — nav labels, then the H1/H2 sequence
// ---------------------------------------------------------------------------

function sectionOrdering(html) {
  const text = String(html || "");
  const navLabels = [];
  const navSeen = new Set();
  const navRegions = [
    ...[...text.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi)].map((m) => m[1]),
    ...[...text.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi)].map((m) => m[1]),
  ].filter(Boolean);
  for (const region of navRegions) {
    for (const m of region.matchAll(/<a\b[^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
      const label = htmlToVisibleText(m[1]).replace(/\s+/g, " ").trim();
      if (!label || label.length > 60) continue;
      const key = loose(label);
      if (!key || navSeen.has(key)) continue;
      navSeen.add(key);
      navLabels.push(label);
      if (navLabels.length >= 16) break;
    }
    if (navLabels.length >= 16) break;
  }
  const headingSequence = [];
  for (const m of text.matchAll(/<(h[1-3])\b[^>]*>([\s\S]{0,400}?)<\/\1>/gi)) {
    const head = htmlToVisibleText(m[2]).replace(/\s+/g, " ").trim();
    if (!head) continue;
    headingSequence.push({ level: Number(m[1][1]), text: head.slice(0, 160) });
    if (headingSequence.length >= 24) break;
  }
  return { nav_labels: navLabels, heading_sequence: headingSequence };
}

// ---------------------------------------------------------------------------
// 1f. SERVICE TAXONOMY — the client's actual service names, never collapsed
// ---------------------------------------------------------------------------

const NAV_STOP = new Set([
  "home", "contact", "contact us", "about", "about us", "blog", "news", "reviews",
  "testimonials", "gallery", "call", "phone", "menu", "login", "sign in", "careers",
  "privacy", "terms", "faq", "hours", "directions", "service area", "our team",
]);

function servicesFromJsonLd(html) {
  const out = [];
  const nameOf = (node) => {
    if (!node || typeof node !== "object") return "";
    // An Offer names the thing OFFERED; the catalog's own name ("Fence
    // Installation Catalog") is a container label, never a service.
    if (node.itemOffered && typeof node.itemOffered === "object") return String(node.itemOffered.name || "").trim();
    if (typeof node.itemOffered === "string") return node.itemOffered.trim();
    if (Array.isArray(node.makesOffer) || node.hasOfferCatalog || node.itemListElement) return "";
    return String(node.name || "").trim();
  };
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    for (const offer of Array.isArray(node.makesOffer) ? node.makesOffer : node.makesOffer ? [node.makesOffer] : []) {
      const name = nameOf(offer);
      if (name) out.push({ name: name.slice(0, 80), source: "jsonld" });
    }
    if (node.hasOfferCatalog) {
      const catalog = Array.isArray(node.hasOfferCatalog) ? node.hasOfferCatalog : [node.hasOfferCatalog];
      for (const c of catalog) walk(c && c.itemListElement);
    }
    if (Array.isArray(node.itemListElement)) {
      for (const entry of node.itemListElement) {
        const item = entry && typeof entry === "object" ? (entry.itemOffered || entry) : entry;
        const name = nameOf(item);
        if (name) out.push({ name: name.slice(0, 80), source: "jsonld" });
      }
    }
    for (const value of Object.values(node)) walk(value);
  };
  for (const m of String(html || "").matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* skip */ }
  }
  return out;
}

/** Sections the page itself frames as its offer: a class that says service /
 *  what-we-do / offering, or a heading that does. */
function serviceSections(html) {
  const text = String(html || "");
  const out = [];
  for (const m of text.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)) {
    const open = /<section\b([^>]*)>/i.exec(m[0]);
    const attrs = open ? open[1] : "";
    const inner = m[1];
    const h = /<(?:h[1-6])\b[^>]*>([\s\S]{0,200}?)<\/(?:h[1-6])>/i.exec(inner);
    const headText = h ? htmlToVisibleText(h[1]) : "";
    if (/service|what-we-do|what we do|offering|products/i.test(attrs) || /service|what we do|offering|products we offer/i.test(headText)) {
      out.push({ inner, heading: headText });
    }
  }
  if (!out.length && /<(?:h[1-6])\b[^>]*>[^<]{0,120}(?:services|products we offer)/i.test(text)) {
    out.push({ inner: text, heading: "" });
  }
  return out;
}

/**
 * The service taxonomy. Sources, in trust order: JSON-LD makesOffer /
 * hasOfferCatalog names; h3 headings inside service sections; list items
 * inside service sections; comma-separated phrase lists in service-section
 * prose (the Hurricane Fence shape: "Wood privacy fences, aluminum ornamental
 * fencing, chain link, and vinyl."); finally nav labels that are not chrome.
 * Every name is kept AS THE CLIENT SPELLS IT — collapsing is the failure this
 * field exists to catch, so nothing here pluralizes, merges or genericizes.
 */
function serviceTaxonomy(html) {
  const found = [];
  const seen = new Set();
  const add = (name, source) => {
    const clean = String(name || "").replace(/\s+/g, " ").replace(/^[,\-–—:;.\s]+|[,\-–—:;.\s]+$/g, "").trim();
    if (!clean || clean.length < 3 || clean.length > 80) return;
    const words = clean.split(" ");
    if (words.length > 6) return;
    const key = loose(clean);
    // Site chrome is not a service, whatever lane proposed it — the JSON-LD
    // of the full Hurricane capture happily offers "Home" and "Gallery".
    if (!key || seen.has(key) || NAV_STOP.has(key)) return;
    seen.add(key);
    found.push({ name: clean, source });
  };

  for (const s of servicesFromJsonLd(html)) add(s.name, s.source);

  for (const section of serviceSections(html)) {
    for (const m of section.inner.matchAll(/<h[3-6]\b[^>]*>([\s\S]{0,200}?)<\/h[3-6]>/gi)) {
      add(htmlToVisibleText(m[1]), "heading");
    }
    for (const m of section.inner.matchAll(/<li\b[^>]*>([\s\S]{0,240}?)<\/li>/gi)) {
      const item = htmlToVisibleText(m[1]);
      if (item && item.split(" ").length <= 6) add(item, "list");
    }
    // The prose phrase list — only when the paragraph is REALLY a list: at
    // least three segments, nearly all of them short noun phrases.
    for (const m of section.inner.matchAll(/<p\b[^>]*>([\s\S]{0,600}?)<\/p>/gi)) {
      const para = htmlToVisibleText(m[1]);
      const segments = para.split(/,|\band\b/i).map((s) => s.trim()).filter(Boolean);
      if (segments.length < 3) continue;
      const short = segments.filter((s) => s.split(" ").length >= 1 && s.split(" ").length <= 5 && s.length <= 44);
      if (short.length / segments.length < 0.7) continue;
      for (const seg of segments) add(seg, "prose_list");
    }
  }

  const nav = sectionOrdering(html).nav_labels;
  for (const label of nav) {
    if (NAV_STOP.has(loose(label))) continue;
    if (found.length >= 24) break;
    add(label, "nav");
  }

  const services = found.slice(0, 24);
  // The pattern is judged on the SUBSTANTIVE sources when any exist; nav
  // labels are one-word segments ("Residential") that would drag a real
  // specialty list below the multi-word line and read as generic.
  const substantive = services.filter((s) => s.source !== "nav");
  const patternPool = substantive.length ? substantive : services;
  const multi = patternPool.filter((s) => s.name.split(" ").length >= 2).length;
  const namingPattern = !services.length ? "none"
    : multi / patternPool.length >= 0.6 ? "named_specialties" : "umbrella_terms";
  return { naming_pattern: namingPattern, services };
}

// ---------------------------------------------------------------------------
// 1g. PROOF INVENTORY — reviews, photos, certifications, years-in-business
// ---------------------------------------------------------------------------

function proofInventory(html) {
  const text = String(html || "");
  const visible = htmlToVisibleText(text);
  // Reviews: JSON-LD aggregateRating is the declared claim; visible star /
  // "N reviews" patterns are the displayed one. Absence is a real answer.
  let reviews = { displayed: false, rating: null, count: null, source: "none" };
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const agg = node.aggregateRating;
    if (agg && typeof agg === "object" && (agg.ratingValue != null || agg.reviewCount != null)) {
      const rating = Number(agg.ratingValue);
      const count = Number(String(agg.reviewCount || "").replace(/[^0-9]/g, ""));
      reviews = {
        displayed: true,
        rating: Number.isFinite(rating) ? rating : null,
        count: Number.isFinite(count) ? count : null,
        source: "jsonld_aggregate_rating",
      };
    }
    for (const value of Object.values(node)) walk(value);
  };
  for (const m of text.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* skip */ }
  }
  if (!reviews.displayed) {
    const star = /(\d(?:\.\d)?)\s*(?:\/\s*5|\s*stars?|\s*-star)/i.exec(visible);
    const count = /(\d[\d,]*)\s+reviews?/i.exec(visible);
    if (star || count) {
      reviews = {
        displayed: true,
        rating: star ? Number(star[1]) : null,
        count: count ? parseInt(count[1].replace(/,/g, ""), 10) : null,
        source: "visible_text",
      };
    }
  }
  // Project photos: content images outside logo/tracking chrome, preferring
  // gallery-flavored containers when the page has any.
  const imgs = [...text.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const isChrome = (t) => /logo|icon|avatar|sponsor/i.test(`${tagAttr(t, "class")} ${tagAttr(t, "alt")} ${tagAttr(t, "src")}`)
    || parseInt(tagAttr(t, "width"), 10) === 1 || parseInt(tagAttr(t, "height"), 10) === 1;
  const galleryRegion = /<(?:section|div)\b[^>]*class\s*=\s*["'][^"']*\b(?:gallery|portfolio|our-work|projects)[^"']*["'][^>]*>([\s\S]*?)<\/(?:section|div)>/i.exec(text);
  const pool = galleryRegion ? galleryRegion[1] : text;
  const photoCount = [...String(pool).matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((t) => !isChrome(t)).length;
  // Certifications: the trust vocabulary, harvested as distinct phrases.
  const certs = new Set();
  for (const m of visible.matchAll(/\b(licensed and insured|licensed|insured|bonded|certified|accredited|award-winning|family owned and operated|family owned)\b/ig)) {
    certs.add(m[1].toLowerCase());
    if (certs.size >= 12) break;
  }
  // Years in business: "Since 1994", "30+ years", "founded in 1990".
  let years = { displayed: false, claim: "", since: null };
  const since = /\b(?:since|est\.?(?:ablished)?)\s+(19|20)\d{2}\b/i.exec(visible);
  const spans = /\b(\d{2,3})\s*\+?\s*(?:years|yr)/i.exec(visible);
  if (since) years = { displayed: true, claim: since[0].trim(), since: parseInt(since[0].replace(/[^0-9]/g, ""), 10) };
  else if (spans) years = { displayed: true, claim: spans[0].trim(), since: null };
  return {
    reviews,
    project_photos: Math.min(photoCount, 99),
    certifications: [...certs],
    years_in_business: years,
  };
}

// ---------------------------------------------------------------------------
// 1h. CTA STRUCTURE — phone-dominant, form-dominant, or quote-dominant
// ---------------------------------------------------------------------------

function ctaStructure(html) {
  const text = String(html || "");
  const telLinks = [...text.matchAll(/<a\b[^>]*href\s*=\s*["']tel:/gi)].length;
  const forms = [...text.matchAll(/<form\b/gi)].length;
  let quoteCtas = 0;
  for (const m of text.matchAll(/<(?:a|button)\b[^>]*>([\s\S]{0,160}?)<\/(?:a|button)>/gi)) {
    const attrs = /<(?:a|button)\b([^>]*)>/i.exec(m[0]);
    const label = htmlToVisibleText(m[1]).replace(/\s+/g, " ").trim();
    if (!label) continue;
    const ctaish = /btn|button|cta/i.test(attrs ? attrs[1] : "") || /\b(?:get|call|book|request|schedule|free)\b/i.test(label);
    if (ctaish && /quote|estimate|consultation|book|schedule|inquire/i.test(label)) quoteCtas++;
  }
  const phoneWeight = Math.min(3, telLinks);
  const formWeight = forms >= 1 ? 2 : 0;
  const quoteWeight = Math.min(3, quoteCtas);
  let dominant = "unknown";
  if (phoneWeight === 0 && formWeight === 0 && quoteWeight === 0) dominant = "unknown";
  else if (phoneWeight >= quoteWeight && phoneWeight >= formWeight && phoneWeight > 0) dominant = "phone-dominant";
  else if (quoteWeight >= formWeight && quoteWeight > 0) dominant = "quote-dominant";
  else dominant = "form-dominant";
  return { dominant, signals: { tel_links: Math.min(telLinks, 99), forms: Math.min(forms, 99), quote_ctas: Math.min(quoteCtas, 99) } };
}

// ---------------------------------------------------------------------------
// 1. THE EXTRACTOR
// ---------------------------------------------------------------------------

/**
 * extractDonorFingerprint — the client's visual DNA from their own homepage.
 *
 * @param {object} input
 *   html          (required) the client's homepage HTML
 *   baseUrl       (required) the URL it was fetched from (resolves relatives)
 *   brandIdentity optional lib/brand-extractor verdict — the palette is
 *                 CONSUMED from it, never re-derived here
 *
 * Returns the fingerprint object (schema: MirrorRequest.donor_fingerprint).
 * Never throws for absence; every field degrades to an honest empty value.
 */
function extractDonorFingerprint({ html = "", baseUrl = "", brandIdentity = null } = {}) {
  const fingerprint = {
    version: 1,
    extracted_from: String(baseUrl || "").slice(0, 2048),
    extracted_at: new Date().toISOString(),
    logo_candidates: [],
    palette: { accent_color: "", secondary_color: "", background: "", mode: "unknown", confidence: "LOW" },
    typography: { font_family: "", heading_weight_pattern: "unknown", heading_scale: null },
    hero_motif: "unknown",
    section_ordering: { nav_labels: [], heading_sequence: [] },
    service_taxonomy: { naming_pattern: "none", services: [] },
    proof_inventory: {
      reviews: { displayed: false, rating: null, count: null, source: "none" },
      project_photos: 0,
      certifications: [],
      years_in_business: { displayed: false, claim: "", since: null },
    },
    cta_structure: { dominant: "unknown", signals: { tel_links: 0, forms: 0, quote_ctas: 0 } },
  };
  if (!html || typeof html !== "string") return fingerprint;
  fingerprint.logo_candidates = logoCandidates(html, baseUrl);
  fingerprint.palette = paletteFromBrandIdentity(brandIdentity);
  fingerprint.typography = headingPattern(html);
  fingerprint.hero_motif = heroMotif(html);
  fingerprint.section_ordering = sectionOrdering(html);
  fingerprint.service_taxonomy = serviceTaxonomy(html);
  fingerprint.proof_inventory = proofInventory(html);
  fingerprint.cta_structure = ctaStructure(html);
  return fingerprint;
}

// ---------------------------------------------------------------------------
// 2. THE DISTINCTIVENESS SCORE
// ---------------------------------------------------------------------------

// --- perceptual colour distance (CIE76 on Lab) ------------------------------

function srgbToLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToLab(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = srgbToLinear((int >> 16) & 255), g = srgbToLinear((int >> 8) & 255), b = srgbToLinear(int & 255);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 delta-E between two hex colours; null when either is unparseable. */
function deltaE(hexA, hexB) {
  const a = hexToLab(hexA), b = hexToLab(hexB);
  if (!a || !b) return null;
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/** Palette proximity 0..1 from delta-E: <=12 is the same colour family (an
 *  accent nudged for contrast must still score full), >=60 is a stranger. */
function paletteProximityScore(donorAccent, renderAccent) {
  const d = deltaE(donorAccent, renderAccent);
  if (d == null) return { score: 0, delta_e: null };
  if (d <= 12) return { score: 1, delta_e: Math.round(d * 10) / 10 };
  if (d >= 60) return { score: 0, delta_e: Math.round(d * 10) / 10 };
  return { score: (60 - d) / (60 - 12), delta_e: Math.round(d * 10) / 10 };
}

// --- name matching ------------------------------------------------------------

function phraseInText(text, phrase) {
  const t = loose(text);
  const p = loose(phrase);
  return Boolean(t && p) && t.includes(p);
}

/** 0.5 partial credit when most of the name's content words survive, e.g.
 *  "Stamped Concrete Patios" -> a page selling "stamped concrete patios and
 *  walkways". A generic umbrella ("Concrete Services") matches nothing. */
function phraseScoreInText(text, phrase) {
  if (phraseInText(text, phrase)) return "full";
  const words = contentWords(phrase);
  if (!words.length) return "absent";
  const t = ` ${loose(text)} `;
  const present = words.filter((w) => t.includes(` ${w} `)).length;
  return present / words.length >= 0.6 ? "partial" : "absent";
}

// --- the scorer ----------------------------------------------------------------

/**
 * scoreDonorFingerprint — measure a generated site against the client's DNA.
 *
 * @param {object} input
 *   fingerprint          the extracted donor fingerprint (required)
 *   logo_used            boolean: the render shipped the client's verified
 *                        logo, not a wordmark
 *   render_accent        "#RRGGBB" the accent the build actually painted
 *   hero_first_party     boolean: the hero wears the client's own media
 *                        (photo wash, client video, placed owned photo)
 *   built_text           visible text of the built tree (htmlToVisibleText of
 *                        the pages + the JS bundles' copy) — the surface the
 *                        taxonomy and proof components are measured on
 *   built_reviews_visible boolean: the render displays a rating/review proof
 *                        (engine-side evidence; the text pattern backs it up)
 *
 * Returns { status, score, certified, floor, components, ... }. Components
 * whose donor-side signal is absent are not_applicable and their weight is
 * redistributed — the score measures fidelity to what the client HAS.
 */
function scoreDonorFingerprint({
  fingerprint = null,
  logo_used = false,
  render_accent = "",
  hero_first_party = false,
  built_text = "",
  built_reviews_visible = false,
} = {}) {
  const fp = fingerprint && typeof fingerprint === "object" ? fingerprint : null;
  if (!fp) {
    return { status: "skipped", reason: "no_donor_fingerprint", score: null, certified: false, floor: DONOR_FINGERPRINT_FLOOR, components: {} };
  }
  const text = String(built_text || "");
  const donorAccent = fp.palette && typeof fp.palette.accent_color === "string" && /^#[0-9a-fA-F]{6}$/.test(fp.palette.accent_color)
    ? fp.palette.accent_color.toUpperCase() : "";
  const services = (fp.service_taxonomy && Array.isArray(fp.service_taxonomy.services) ? fp.service_taxonomy.services : [])
    .map((s) => (typeof s === "string" ? s : (s && s.name) || "")).filter(Boolean);
  const proof = fp.proof_inventory || {};
  const reviews = proof.reviews || {};
  const certs = Array.isArray(proof.certifications) ? proof.certifications.filter(Boolean) : [];
  const years = proof.years_in_business || {};
  const motif = HERO_MOTIFS.includes(fp.hero_motif) ? fp.hero_motif : "unknown";

  // ---- component: logo_used ------------------------------------------------
  const hasLogo = (fp.logo_candidates || []).length > 0;
  const logoComponent = {
    applies: hasLogo,
    weight: WEIGHTS.logo_used,
    donor_logo_candidates: (fp.logo_candidates || []).length,
    used: Boolean(logo_used),
    score: hasLogo ? (logo_used ? 1 : 0) : null,
    evidence: hasLogo
      ? (logo_used ? "verified client logo shipped in the header" : "no client logo in the render — a text wordmark is not the client's mark")
      : "client site publishes no header-grade logo (not applicable)",
  };

  // ---- component: palette_proximity ------------------------------------------
  const paletteComponent = {
    applies: Boolean(donorAccent),
    weight: WEIGHTS.palette_proximity,
    donor_accent: donorAccent || null,
    render_accent: /^#[0-9a-fA-F]{6}$/.test(String(render_accent || "")) ? String(render_accent).toUpperCase() : null,
    delta_e: null,
    score: 0,
    evidence: "client site declares no measurable accent (not applicable)",
  };
  if (donorAccent) {
    const prox = paletteProximityScore(donorAccent, render_accent);
    paletteComponent.delta_e = prox.delta_e;
    paletteComponent.score = prox.score;
    paletteComponent.evidence = prox.delta_e == null
      ? "the build shipped no accent to compare (donor template default)"
      : `delta-E ${prox.delta_e} between the client's ${donorAccent} and the shipped ${paletteComponent.render_accent}`;
  }

  // ---- component: hero_provenance --------------------------------------------
  // N/A when the client's own hero was text on a plain field AND they publish
  // no first-party media anywhere — there is nothing whose provenance could
  // disappoint. (A photo-led donor site with a stock-hero render is exactly
  // the failure this component exists to catch.)
  const donorHasMedia = motif !== "text-minimal" && motif !== "unknown"
    || (fp.logo_candidates || []).some((c) => c && c.width >= 400)
    || Number(proof.project_photos) > 0;
  const heroComponent = {
    applies: donorHasMedia,
    weight: WEIGHTS.hero_provenance,
    donor_motif: motif,
    first_party: Boolean(hero_first_party),
    score: donorHasMedia ? (hero_first_party ? 1 : 0) : null,
    evidence: donorHasMedia
      ? (hero_first_party ? "hero wears the client's own media" : "hero is generic/template media, not the client's")
      : "client hero is text-minimal with no first-party media to carry (not applicable)",
  };

  // ---- component: taxonomy_retention -----------------------------------------
  const matches = services.map((name) => ({ name, match: phraseScoreInText(text, name) }));
  const retained = matches.filter((m) => m.match === "full").length + 0.5 * matches.filter((m) => m.match === "partial").length;
  const taxonomyComponent = {
    applies: services.length > 0,
    weight: WEIGHTS.taxonomy_retention,
    donor_services: services.length,
    retained_full: matches.filter((m) => m.match === "full").length,
    retained_partial: matches.filter((m) => m.match === "partial").length,
    ratio: services.length ? Math.round((retained / services.length) * 1000) / 1000 : null,
    score: services.length ? retained / services.length : null,
    matches: matches.slice(0, 24),
    evidence: services.length
      ? `${matches.filter((m) => m.match === "full").length}/${services.length} donor service names appear by name`
      : "client site names no distinct services (not applicable)",
  };

  // ---- component: proof_retention --------------------------------------------
  const present = [];
  if (reviews.displayed) present.push({ key: "reviews", weight: 0.5, kept: Boolean(built_reviews_visible) || /\b\d[\d,]*\s+reviews?\b/i.test(text) || (reviews.rating != null && text.includes(String(reviews.rating))) });
  if (certs.length) {
    const keptCerts = certs.filter((c) => phraseInText(text, c));
    present.push({ key: "certifications", weight: 0.25, kept: keptCerts.length >= Math.ceil(certs.length / 2), kept_of: `${keptCerts.length}/${certs.length}` });
  }
  if (years.displayed) {
    const keptYears = (years.since != null && text.includes(String(years.since)))
      || /\b(?:since|est\.?)\s+(19|20)\d{2}\b/i.test(text) || /\b\d{2,3}\s*\+?\s*(?:years|yr)/i.test(text);
    present.push({ key: "years_in_business", weight: 0.25, kept: keptYears });
  }
  const totalWeight = present.reduce((a, p) => a + p.weight, 0);
  const proofScore = totalWeight > 0 ? present.reduce((a, p) => a + (p.kept ? p.weight : 0), 0) / totalWeight : null;
  const proofComponent = {
    applies: present.length > 0,
    weight: WEIGHTS.proof_retention,
    elements: Object.fromEntries(present.map((p) => [p.key, { kept: p.kept, ...(p.kept_of ? { kept_of: p.kept_of } : {}) }])),
    score: proofScore,
    evidence: present.length
      ? `reviews ${present.find((p) => p.key === "reviews") ? (present.find((p) => p.key === "reviews").kept ? "visible" : "not visible") : "n/a"}`
      : "client site displays no proof inventory (not applicable)",
  };

  // ---- the weighted sum, over APPLICABLE components only ---------------------
  const components = {
    logo_used: logoComponent,
    palette_proximity: paletteComponent,
    hero_provenance: heroComponent,
    taxonomy_retention: taxonomyComponent,
    proof_retention: proofComponent,
  };
  const applicable = Object.entries(components).filter(([, c]) => c.applies && c.score != null);
  if (!applicable.length) {
    return {
      status: "not_applicable",
      reason: "donor fingerprint carries no scorable signal",
      score: null,
      certified: false,
      floor: DONOR_FINGERPRINT_FLOOR,
      components,
    };
  }
  const weightSum = applicable.reduce((a, [, c]) => a + c.weight, 0);
  const score = Math.round((applicable.reduce((a, [, c]) => a + c.score * c.weight, 0) / weightSum) * 100);
  const belowFloor = score < DONOR_FINGERPRINT_FLOOR;
  return {
    status: belowFloor ? "below_floor" : "passed",
    score,
    certified: !belowFloor,
    floor: DONOR_FINGERPRINT_FLOOR,
    weights_applied: applicable.reduce((a, [name, c]) => ({ ...a, [name]: c.weight }), {}),
    ...(belowFloor ? {
      recommended_mode: "closer_donor_fidelity",
      warning: `donor_fingerprint_score ${score} < ${DONOR_FINGERPRINT_FLOOR}: the render reads as the same template with the names swapped — logo ${logoComponent.used ? "kept" : "lost"}, taxonomy ${taxonomyComponent.retained_full}/${taxonomyComponent.donor_services} names retained`,
    } : {}),
    components,
  };
}

// ---------------------------------------------------------------------------
// transport + engine-side normalization
// ---------------------------------------------------------------------------

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HTTPS_URI = /^https:\/\//i;

function cleanHex(v) {
  return typeof v === "string" && HEX6.test(v.trim()) ? v.trim().toUpperCase() : "";
}
function cleanStr(v, max) {
  const s = String(v == null ? "" : v).trim();
  return s ? s.slice(0, max) : "";
}
function cleanInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.round(n))) : null;
}

/**
 * fingerprintForRequest — the fingerprint shaped and clamped to EXACTLY what
 * the mirror-request schema's donor_fingerprint accepts, so a malformed colour
 * or a non-https URL is dropped field-by-field rather than failing the whole
 * request at Ajv. Returns null when nothing scorable survives.
 */
function fingerprintForRequest(fp) {
  if (!fp || typeof fp !== "object") return null;
  const out = {
    version: 1,
    prospect_id: cleanStr(fp.prospect_id, 120),
    extracted_from: typeof fp.extracted_from === "string" && HTTPS_URI.test(fp.extracted_from) ? fp.extracted_from.slice(0, 2048) : "",
    extracted_at: cleanStr(fp.extracted_at, 40),
    logo_candidates: (Array.isArray(fp.logo_candidates) ? fp.logo_candidates : []).slice(0, 8)
      .filter((c) => c && typeof c === "object" && typeof c.url === "string" && HTTPS_URI.test(c.url))
      .map((c) => ({
        url: c.url.slice(0, 2048),
        width: cleanInt(c.width),
        height: cleanInt(c.height),
        alt: cleanStr(c.alt, 200),
        grade: cleanStr(c.grade, 40),
      })),
    palette: {
      accent_color: cleanHex(fp.palette && fp.palette.accent_color),
      secondary_color: cleanHex(fp.palette && fp.palette.secondary_color),
      background: cleanHex(fp.palette && fp.palette.background),
      mode: ["light", "dark", "unknown"].includes(fp.palette && fp.palette.mode) ? fp.palette.mode : "unknown",
      confidence: ["HIGH", "MEDIUM", "LOW"].includes(fp.palette && fp.palette.confidence) ? fp.palette.confidence : "LOW",
    },
    typography: {
      font_family: cleanStr(fp.typography && fp.typography.font_family, 60),
      heading_weight_pattern: HEADING_PATTERNS.includes(fp.typography && fp.typography.heading_weight_pattern)
        ? fp.typography.heading_weight_pattern : "unknown",
      heading_scale: typeof (fp.typography && fp.typography.heading_scale) === "number"
        ? Math.round(fp.typography.heading_scale * 10) / 10 : null,
    },
    hero_motif: HERO_MOTIFS.includes(fp.hero_motif) ? fp.hero_motif : "unknown",
    section_ordering: {
      nav_labels: (Array.isArray(fp.section_ordering && fp.section_ordering.nav_labels) ? fp.section_ordering.nav_labels : [])
        .slice(0, 16).map((s) => cleanStr(s, 60)).filter(Boolean),
      heading_sequence: (Array.isArray(fp.section_ordering && fp.section_ordering.heading_sequence) ? fp.section_ordering.heading_sequence : [])
        .slice(0, 24)
        .filter((h) => h && typeof h === "object" && cleanStr(h.text, 160))
        .map((h) => ({ level: Math.min(3, Math.max(1, cleanInt(h.level) || 1)), text: cleanStr(h.text, 160) })),
    },
    service_taxonomy: {
      naming_pattern: ["named_specialties", "umbrella_terms", "none"].includes(fp.service_taxonomy && fp.service_taxonomy.naming_pattern)
        ? fp.service_taxonomy.naming_pattern : "none",
      services: (Array.isArray(fp.service_taxonomy && fp.service_taxonomy.services) ? fp.service_taxonomy.services : [])
        .slice(0, 24)
        .map((s) => (typeof s === "string" ? { name: cleanStr(s, 80), source: "unknown" } : { name: cleanStr(s && s.name, 80), source: cleanStr(s && s.source, 24) || "unknown" }))
        .filter((s) => s.name),
    },
    proof_inventory: {
      reviews: {
        displayed: Boolean(fp.proof_inventory && fp.proof_inventory.reviews && fp.proof_inventory.reviews.displayed),
        rating: typeof (fp.proof_inventory && fp.proof_inventory.reviews && fp.proof_inventory.reviews.rating) === "number"
          ? Math.round(fp.proof_inventory.reviews.rating * 10) / 10 : null,
        count: cleanInt(fp.proof_inventory && fp.proof_inventory.reviews && fp.proof_inventory.reviews.count),
        source: cleanStr(fp.proof_inventory && fp.proof_inventory.reviews && fp.proof_inventory.reviews.source, 40),
      },
      project_photos: cleanInt(fp.proof_inventory && fp.proof_inventory.project_photos) || 0,
      certifications: (Array.isArray(fp.proof_inventory && fp.proof_inventory.certifications) ? fp.proof_inventory.certifications : [])
        .slice(0, 12).map((c) => cleanStr(c, 80)).filter(Boolean),
      years_in_business: {
        displayed: Boolean(fp.proof_inventory && fp.proof_inventory.years_in_business && fp.proof_inventory.years_in_business.displayed),
        claim: cleanStr(fp.proof_inventory && fp.proof_inventory.years_in_business && fp.proof_inventory.years_in_business.claim, 80),
        since: cleanInt(fp.proof_inventory && fp.proof_inventory.years_in_business && fp.proof_inventory.years_in_business.since),
      },
    },
    cta_structure: {
      dominant: CTA_STRUCTURES.includes(fp.cta_structure && fp.cta_structure.dominant) ? fp.cta_structure.dominant : "unknown",
      signals: {
        tel_links: cleanInt(fp.cta_structure && fp.cta_structure.signals && fp.cta_structure.signals.tel_links) || 0,
        forms: cleanInt(fp.cta_structure && fp.cta_structure.signals && fp.cta_structure.signals.forms) || 0,
        quote_ctas: cleanInt(fp.cta_structure && fp.cta_structure.signals && fp.cta_structure.signals.quote_ctas) || 0,
      },
    },
  };
  if (!out.logo_candidates.length && !out.palette.accent_color && !out.service_taxonomy.services.length
    && out.proof_inventory.reviews.displayed === false && !out.proof_inventory.certifications.length) {
    return null;
  }
  return out;
}

/**
 * Engine-side normalization of a request-carried fingerprint. Tolerant of any
 * junk a caller may hand in: unknown keys dropped, malformed fields dropped,
 * never a build failure. Returns the sanitized fingerprint or null.
 */
function normalizeDonorFingerprint(raw) {
  try {
    return fingerprintForRequest(raw);
  } catch {
    return null;
  }
}

/**
 * The built tree as a matching surface: visible text of every HTML page, plus
 * the raw text of the JS bundles (a client-rendered donor SPA keeps its copy
 * ONLY in string literals, and the dry run has no browser to render it).
 * Bounded so a 300-file tree cannot stall the check.
 */
function builtTreeText(files = {}, { maxFiles = 60, maxBytes = 3_000_000 } = {}) {
  const parts = [];
  let budget = maxBytes;
  let scanned = 0;
  for (const rel of Object.keys(files).sort()) {
    if (scanned >= maxFiles || budget <= 0) break;
    if (!/\.(?:html?|js|mjs)$/i.test(rel)) continue; // CSS carries no service names worth matching
    const bytes = files[rel];
    if (!bytes || !bytes.length) continue;
    let text;
    try { text = bytes.toString("utf8"); } catch { continue; }
    if (/\.(?:html?)$/i.test(rel)) text = htmlToVisibleText(text);
    if (text.length > budget) text = text.slice(0, budget);
    budget -= text.length;
    scanned++;
    parts.push(text);
  }
  return parts.join("\n");
}

module.exports = {
  DONOR_FINGERPRINT_FLOOR,
  WEIGHTS,
  HERO_MOTIFS,
  HEADING_PATTERNS,
  CTA_STRUCTURES,
  extractDonorFingerprint,
  scoreDonorFingerprint,
  fingerprintForRequest,
  normalizeDonorFingerprint,
  builtTreeText,
  // internals exported for tests
  logoCandidates,
  schemaLogoUrls,
  headingPattern,
  heroMotif,
  heroRegion,
  sectionOrdering,
  serviceTaxonomy,
  proofInventory,
  ctaStructure,
  deltaE,
  paletteProximityScore,
  phraseScoreInText,
  loose,
};
