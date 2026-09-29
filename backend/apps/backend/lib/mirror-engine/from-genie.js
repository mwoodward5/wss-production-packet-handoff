"use strict";

const { sameOwner } = require("../web-brand");
// SANITIZE BEFORE VALIDATE. Every URI this pipe attaches to the request lands
// in a RequiredHttpsUri slot (brand.photos items, brand.logo,
// brand.accent_source, brand.hero_video.url) and one malformed value — a
// space inside an otherwise good URL, a data: or relative candidate — 400s
// the WHOLE request at validation, a failure no retry can fix. Un-URI-able
// values are dropped and counted, never fatal.
// See lib/mirror-engine/photo-uri-sanitize.js.
const { sanitizeHttpsUri, sanitizePhotoUris } = require("./photo-uri-sanitize");

// lib/mirror-engine/from-genie.js — THE PIPE, NOW A QUARANTINE.
//
// The SiteForge Intake Genie (handoff/intake-genie-clean-20260729:
// app/lib/intake-genie-core.mjs) emits an `intake-genie-v2` canonical packet.
// The Mirror Engine consumes a MirrorRequest. This module is the seam that maps
// one to the other so Ghost never re-derives truth, never calls
// Firecrawl/BrightLocal directly, and never invents a Dallas/TX fallback (the
// Ghost-boundary rules in the handoff).
//
// It was written on the premise that the Genie IS the source of truth for
// business facts. That premise is retracted as of 2026-07-31: the Genie
// fabricated a phone number for a real prospect and labelled it
// "operator_verified" (see the QUARANTINE block below and
// test/genie-fabrication.test.js). The seam still maps assets, geography and
// descriptive copy — but it is now a boundary that assumes the packet may be
// wrong, not a conduit that assumes it is right.
//
// Truth-law preserved end to end: a Genie fact that is blank stays blank here;
// an asset the Genie did not mark `approved` is not used. Added to it: contact
// identity (NAP) never passes through at all, the trust numerals (rating /
// review_count) never pass through at all, and descriptive content passes only
// when an operator has explicitly opted in.

const SUPPORTED_MIN = ["name", "city", "state", "category"];

// ---------------------------------------------------------------------------
// GENIE QUARANTINE (2026-07-31) — WHY THIS SEAM IS NOW CLOSED BY DEFAULT
//
// The live packet for jacksonvilleroofingusa.com returned
//   facts.phone = "16872518405"
// stamped in evidence[] as source_type "operator_verified", confidence 0.9.
// That number is not the business's phone. It is the first 11 digits of the
// Facebook page id in the same packet's facts.socials
//   .../Jacksonville-Roofing-USA-LLC-168725184055402/
//                                    ^^^^^^^^^^^ ->  16872518405
// i.e. the Genie took an opaque id it had scraped, called it a phone number,
// and attached its own highest trust label to the result.
//
// Two consequences, both encoded below:
//
//   1. A SOURCE ASSERTING ITS OWN TRUSTWORTHINESS IS NOT EVIDENCE.
//      "operator_verified" is a string the Genie writes about itself. It is
//      not a second observation and it cannot corroborate anything. Nothing in
//      this module may treat a source_type or a confidence number as proof.
//
//   2. THE FABRICATION CLASS IS NAP (name/address/phone — plus email and
//      website, the other contact-identity fields). A wrong service label is
//      a cosmetic defect; a wrong phone number on a live mirror sends the
//      client's customers to a stranger. So every NAP-shaped key is dropped at
//      this boundary UNCONDITIONALLY — there is no flag that re-enables it.
//      NAP must arrive from the caller, from an independent source, via
//      `verifiedNap`.
//
//   3. THE TRUST NUMERALS ARE THE SAME CLASS AS THE PHONE (added 2026-07-31).
//      `trust.rating` and `trust.review_count` reached request.facts on nothing
//      but the Genie's own say-so, and they are not internal bookkeeping — they
//      are customer-visible on a live mirror:
//        · tokens.js hydrates {{RATING}} / {{REVIEW_COUNT}} into the donor DOM;
//        · content-inject.js copies them into window.__WSS_CONTENT__.facts, and
//          a `consumes_content` donor reads them back and renders the stars
//          (donors-clean/concrete-elconstruction does exactly this);
//        · local-seo.js and content-inject.js attach them to JSON-LD
//          aggregateRating — a machine-readable claim to Google.
//      A fabricated 4.9 from 412 reviews is the same failure as a fabricated
//      phone, with a manual action attached. So rating/review_count are dropped
//      here UNCONDITIONALLY, exactly like NAP, and may re-enter ONLY through
//      `verifiedReviews` from a source that is not the Genie.
//
//      A per-review star number (trust.reviews[].rating) is dropped for the
//      same reason: it is a trust numeral, not descriptive copy, it rides into
//      the data island verbatim, and unlike review TEXT it can be silently
//      aggregated. Review text stays behind GENIE_CONTENT_ENABLED; the number
//      attached to it does not come back at all.
//
// Descriptive, non-NAP content (services, about, faqs, areas, ...) is only
// QUARANTINED, not condemned: it is withheld behind GENIE_CONTENT_ENABLED
// (default OFF) until an independent cross-check exists to corroborate it.
// When quarantined the mapper returns content `null` WITH A REASON, so a build
// runs on verified facts only and visibly ships less, rather than silently
// shipping something invented.
// ---------------------------------------------------------------------------

/**
 * NAP-shaped keys. Matching is by KEY NAME, exact (case-insensitive), against
 * an explicit list — never a substring heuristic, so an unrelated key can
 * never be silently swallowed and a new alias must be added deliberately.
 */
const NAP_KEYS = new Set([
  "phone", "phones", "phone_number", "phone_numbers", "telephone", "tel",
  "mobile", "fax", "call_tracking_number", "tracking_number",
  "address", "address1", "address_line1", "street", "street_address",
  "full_address", "formatted_address", "postal_address", "mailing_address",
  "email", "emails", "email_address", "contact_email",
  "website", "websites", "website_url", "current_website", "url", "site",
  "site_url", "homepage", "domain", "booking_url",
]);

function isNapKey(key) {
  return NAP_KEYS.has(String(key || "").trim().toLowerCase());
}

/**
 * TRUST-NUMERAL keys — the aggregate star rating and the count behind it.
 * Same matching discipline as NAP: an explicit, exact, case-insensitive list,
 * never a substring heuristic. `reviews` is deliberately NOT here — review TEXT
 * is descriptive content governed by GENIE_CONTENT_ENABLED. Only the NUMBERS
 * are contraband, because a number is what gets rendered as stars and what gets
 * asserted to Google as aggregateRating.
 */
const TRUST_KEYS = new Set([
  "rating", "ratings", "stars", "star_rating", "starrating",
  "avg_rating", "average_rating", "aggregate_rating", "aggregaterating",
  "overall_rating", "review_score", "google_rating", "googlerating",
  "gbp_rating", "yelp_rating", "facebook_rating", "rating_value", "ratingvalue",
  "review_count", "reviewcount", "reviews_count", "review_counts",
  "rating_count", "ratingcount", "ratings_count", "ratings_total",
  "user_ratings_total", "total_reviews", "total_review_count",
  "num_reviews", "number_of_reviews", "google_review_count", "review_total",
]);

function isTrustKey(key) {
  return TRUST_KEYS.has(String(key || "").trim().toLowerCase());
}

/** Either class of self-asserted fact the Genie may not vouch for. */
function isQuarantinedKey(key) {
  return isNapKey(key) || isTrustKey(key);
}

/**
 * Remove every key matching `match` from a plain object.
 * Returns the survivors plus the NAMES of what was dropped — names only, never
 * the values, so a quarantined number cannot ride out in the audit trail.
 */
function stripFields(obj, match) {
  const clean = {};
  const dropped = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (match(k)) {
      if (v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) dropped.push(k);
      continue;
    }
    clean[k] = v;
  }
  return { clean, dropped };
}

/** Remove every NAP-shaped key from a plain object. */
function stripNapFields(obj) {
  return stripFields(obj, isNapKey);
}

/** Remove every trust-numeral key from a plain object. */
function stripTrustFields(obj) {
  return stripFields(obj, isTrustKey);
}

const GENIE_CONTENT_FLAG = "GENIE_CONTENT_ENABLED";
const GENIE_CONTENT_QUARANTINE_REASON = "genie_content_quarantined";

/**
 * Is Genie descriptive content allowed onto a mirror request?
 *
 * DEFAULT: NO. An unset/blank/unrecognized flag is OFF — the only values that
 * open the pipe are an explicit "1"/"true"/"on", or an explicit boolean from
 * the caller. Fail-closed: a typo'd env var quarantines, it does not enable.
 */
function genieContentEnabled(override) {
  if (typeof override === "boolean") return override;
  const flag = String(process.env[GENIE_CONTENT_FLAG] || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

// ---------------------------------------------------------------------------
// CONTENT MAPPING (MirrorContent, mirror-request.schema.json #/$defs/MirrorContent)
//
// The seam used to emit `{ services, hours, booking_url, socials, reviews,
// optimization, evidence }`. Four of those keys do not exist in MirrorContent
// and the schema is `additionalProperties: false`, so any caller that passed
// this straight to the engine got a hard 400 invalid_request — which is why
// request.content was never once supplied and every mirror shipped
// `content: "none"`. Schema-homed keys now go in `content`; the rest go in a
// sibling `extra` that no validator sees.
//
// Alias tables are EXPLICIT. Nothing is inferred: a packet key that is not
// listed here is not read, and a field the packet does not carry is ABSENT
// from the output (TRUTH LAW) rather than defaulted, blanked or invented.
// Verified against the live intake-genie-v2 packet for jacksonvilleroofingusa.com
// (2026-07-31): facts carries name/city/state/category/phone/email/website/
// address/latlng/hours/booking_url/services/socials; trust carries rating/
// review_count/reviews; optimization carries seo_gaps/target_queries/
// schema_types/local_presence. It carried NONE of the about/areas/faqs/team/
// awards/press/mission/founded aliases below — so those stayed absent, which is
// the correct behaviour, not a mapping failure.
// ---------------------------------------------------------------------------
const ALIASES = {
  services: ["services", "service_list"],
  faqs: ["faqs", "faq"],
  areas: ["areas", "areas_served", "service_areas", "service_area", "cities_served"],
  about: ["about", "about_text", "description", "summary", "story"],
  mission: ["mission", "mission_statement", "values"],
  founded_year: ["founded_year", "year_founded", "founded"],
  team: ["team", "staff", "people"],
  awards: ["awards", "certifications", "accreditations"],
  press: ["press", "media_mentions"],
};

// Schema maxItems / maxLength, mirrored here so the mapper can never emit an
// over-length array or string that the validator would then reject.
const CAP = { services: 24, faqs: 20, reviews: 10, areas: 18, team: 12, awards: 10, press: 6 };
const MAXLEN = { about: 4000, mission: 600, bio: 800 };

/** Trim to a string; non-strings become "" rather than "undefined"/"[object Object]". */
function str(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * Mechanical residue trim — NOT a rewrite. Scrapes carry markup leftovers on
 * the tail of nav labels (the live packet returned the literal `Roofing \\`).
 * Stripping trailing backslashes/pipes/slashes/whitespace removes characters
 * the business never wrote; it never adds or reinterprets a word.
 */
function trimResidue(s) {
  return str(s).replace(/[\\|/\s ]+$/u, "").trim();
}

/** First alias key present on any of the given source objects. */
function pick(sources, keys) {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const k of keys) {
      const v = src[k];
      if (v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) return v;
    }
  }
  return undefined;
}

function arr(v) { return Array.isArray(v) ? v : []; }

// Packet 2 carries design observations beside the canonical facts. They are
// useful inputs to a mirror, but they are not business identity: a font family
// or a CSS colour cannot corroborate a phone number, review count, or owned
// social profile. Keep this lane deliberately separate from `facts` and retain
// the page on which every mapped observation was seen.
const NON_FIRST_PARTY_BRAND_HOST = /(?:^|\.)(?:facebook\.com|fb\.com|instagram\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|yelp\.com|bbb\.org|angi\.com|nextdoor\.com|houzz\.com|google\.com|goo\.gl|g\.page)$/i;

function httpsUrl(value) {
  const raw = str(value);
  if (!/^https:\/\//i.test(raw)) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function firstPartyBrandSource(value, expectedWebsite = "") {
  const href = httpsUrl(value);
  if (!href) return "";
  try {
    if (NON_FIRST_PARTY_BRAND_HOST.test(new URL(href).hostname)) return "";
    // A non-social host is not automatically this prospect's host. Bind every
    // render-driving observation to the independently verified website.
    if (!expectedWebsite || !sameOwner(expectedWebsite, href)) return "";
    return href;
  } catch {
    return "";
  }
}

function explicitBrandSourceUrl(value) {
  const candidate = value && typeof value === "object"
    ? value.url || value.href || value.source_url || value.observed_on || value.found_on
    : value;
  const raw = str(candidate);
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function safeFontFamily(value) {
  // Packet 2 records one family, but a browser scrape can return a whole CSS
  // fallback stack. Only the leading family is ours to carry. Quotes,
  // backslashes and declaration delimiters are rejected rather than escaped:
  // applyFontsToCss wraps this string in quotes, so accepting those characters
  // would turn an observation into executable CSS.
  const leading = str(value).split(",")[0].trim().replace(/^(?:"([^"]+)"|'([^']+)')$/, "$1$2").trim();
  if (!leading || leading.length > 60 || /[\\"';{}<>\r\n]/.test(leading)) return "";
  return leading;
}

function hex6(value) {
  const valueString = str(value);
  return /^#[0-9a-f]{6}$/i.test(valueString) ? valueString.toUpperCase() : "";
}

function chromatic(hex) {
  const clean = hex6(hex);
  if (!clean) return false;
  const channels = [1, 3, 5].map((i) => Number.parseInt(clean.slice(i, i + 2), 16) / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  if (max === min) return false;
  const lightness = (max + min) / 2;
  const saturation = (max - min) / (1 - Math.abs((2 * lightness) - 1));
  return Number.isFinite(saturation) && saturation >= 0.18;
}

function packetBrandSourceUrls(packet, expectedWebsite = "") {
  const packet2 = packet && packet.packet2 && typeof packet.packet2 === "object" ? packet.packet2 : {};
  const packet2Sources = packet2.sources && typeof packet2.sources === "object" ? packet2.sources : {};
  const rootSources = packet && packet.sources && typeof packet.sources === "object" ? packet.sources : {};
  const candidates = [
    ...arr(packet2Sources.urls),
    ...arr(rootSources.urls),
  ];
  const seen = new Set();
  return candidates.map((value) => firstPartyBrandSource(value, expectedWebsite)).filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function packetToObservedBrand(packet, expectedWebsite = "") {
  const rootBrand = packet && packet.brand && typeof packet.brand === "object" ? packet.brand : {};
  const packet2 = packet && packet.packet2 && typeof packet.packet2 === "object" ? packet.packet2 : {};
  const packet2Brand = packet2.brand && typeof packet2.brand === "object" ? packet2.brand : {};
  const packet2Sources = packet2.sources && typeof packet2.sources === "object" ? packet2.sources : {};
  const brand = { ...packet2Brand, ...rootBrand };
  const packet2Fonts = packet2Brand.fonts && typeof packet2Brand.fonts === "object" ? packet2Brand.fonts : {};
  const rootFonts = rootBrand.fonts && typeof rootBrand.fonts === "object" ? rootBrand.fonts : {};
  const fontInput = { ...packet2Fonts, ...rootFonts };
  const paletteInput = arr(rootBrand.palette).length
    ? rootBrand.palette
    : arr(rootBrand.brandPalette).length
      ? rootBrand.brandPalette
      : arr(packet2Brand.palette).length
        ? packet2Brand.palette
        : arr(packet2Brand.brandPalette).length
          ? packet2Brand.brandPalette
      : packet2Sources.palette;
  const colorsInput = arr(brand.colors);
  const defaultSources = packetBrandSourceUrls(packet, expectedWebsite);

  const palette = [];
  const seenColors = new Set();
  for (const raw of [...arr(paletteInput), ...colorsInput]) {
    const row = raw && typeof raw === "object" ? raw : { hex: raw };
    const hex = hex6(row.hex || row.color || row.value || raw);
    if (!hex || seenColors.has(hex)) continue;
    seenColors.add(hex);
    const declaredSource = row.observed_on || row.source_url || row.source;
    const explicitUrl = explicitBrandSourceUrl(declaredSource);
    const explicitSource = firstPartyBrandSource(declaredSource, expectedWebsite);
    palette.push({
      hex,
      role: str(row.role).slice(0, 40),
      source: str(row.source) || "public_source_observation",
      // A source label (for example `public_source_observation`) may use the
      // packet's first-party source envelope. An explicit URL is different:
      // if that URL is foreign or invalid it fails closed and must not borrow
      // an unrelated first-party URL from the surrounding packet.
      observed_on: explicitUrl ? explicitSource : (explicitSource || defaultSources[0] || ""),
      verification_status: "unverified_source_observation",
    });
  }

  const display = safeFontFamily(fontInput.display || fontInput.heading || fontInput.headingFont);
  const body = safeFontFamily(fontInput.body || fontInput.bodyFont);
  const href = /^https:\/\/fonts\.googleapis\.com\//i.test(str(fontInput.href)) ? str(fontInput.href) : "";
  const declaredFontSource = fontInput.source || fontInput.observed_on;
  const explicitFontUrl = explicitBrandSourceUrl(declaredFontSource);
  const validatedFontSource = firstPartyBrandSource(declaredFontSource, expectedWebsite);
  const fontSource = explicitFontUrl
    ? validatedFontSource
    : (validatedFontSource || defaultSources[0] || "");
  const fonts = (display || body) ? {
    ...(display ? { display } : {}),
    ...(body ? { body } : {}),
    ...(href ? { href } : {}),
    source: fontSource,
    provider: href ? "google" : "declared",
    verification_status: "unverified_source_observation",
  } : null;

  const chromaticRows = palette.filter((row) => chromatic(row.hex));
  const byRole = (pattern) => chromaticRows.find((row) => pattern.test(row.role));
  const siteAccent = byRole(/(?:accent|action|cta|button)/i)
    || byRole(/(?:primary|brand)/i)
    || chromaticRows[0]
    || null;
  const primary = byRole(/(?:primary|surface|brand|secondary)/i)
    || chromaticRows.find((row) => !siteAccent || row.hex !== siteAccent.hex)
    || siteAccent;

  // Only observations tied to an actual first-party HTTPS page enter the
  // request. Everything else remains in the audit sibling below. In
  // particular, a social-network URL cannot become site_accent_source and a
  // malformed font name cannot become CSS.
  const requestBrand = {};
  if (fonts && fontSource) {
    requestBrand.fonts = {
      ...(fonts.display ? { display: fonts.display } : {}),
      ...(fonts.body ? { body: fonts.body } : {}),
      ...(fonts.href ? { href: fonts.href } : {}),
      source: fontSource,
      provider: fonts.provider,
    };
  }
  if (primary && primary.observed_on) requestBrand.primary = primary.hex;
  if (siteAccent && siteAccent.observed_on) {
    requestBrand.site_accent = siteAccent.hex;
    requestBrand.site_accent_source = siteAccent.observed_on;
  }

  const hasObservations = Boolean(fonts || palette.length);
  return {
    request_brand: requestBrand,
    audit: hasObservations ? {
      verification_status: "unverified_source_observation",
      mapped_to_request: Boolean(Object.keys(requestBrand).length),
      source_urls: defaultSources,
      ...(fonts ? { fonts } : {}),
      ...(palette.length ? { palette } : {}),
    } : null,
  };
}

// Certified financing: pass through only the schema-homed keys, with the
// apply URL held to the same https bar as every URI the request carries.
// Limits mirror mirror-request.schema.json (partner 80, payment_methods 8)
// so the sanitize-before-validate doctrine holds: a value that cannot
// validate is dropped here, never a 400 the retry cannot fix.
const CERTIFIED_FINANCING_LIMITS = { partner: 80, payment_methods: 8, method: 40 };

function certifiedFinancingFacts(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const financing = {};
  if (raw.enabled === true) financing.enabled = true;
  else if (raw.enabled === false) financing.enabled = false;
  if (str(raw.partner)) financing.partner = str(raw.partner).slice(0, CERTIFIED_FINANCING_LIMITS.partner);
  const applyUrl = sanitizeHttpsUri(raw.apply_url);
  if (applyUrl) financing.apply_url = applyUrl;
  const methods = mapStrings(raw.payment_methods, CERTIFIED_FINANCING_LIMITS.payment_methods)
    .map((method) => method.slice(0, CERTIFIED_FINANCING_LIMITS.method));
  if (methods.length) financing.payment_methods = methods;
  return Object.keys(financing).length ? financing : null;
}

// Certified before/after photos: [{ before_url, after_url, caption? }] —
// the project-gallery contract renders only COMPLETE pairs, so the schema
// requires both URLs. A URL that cannot travel in a RequiredHttpsUri slot is
// dropped (the photo-uri-sanitize doctrine — sanitize BEFORE validate); a
// pair whose URL died is not a photograph any more.
const CERTIFIED_PHOTO_LIMITS = { photos: 12, caption: 160 };

function certifiedProjectPhotoFacts(raw) {
  if (!Array.isArray(raw)) return [];
  const photos = [];
  for (const row of raw.slice(0, CERTIFIED_PHOTO_LIMITS.photos)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const beforeUrl = sanitizeHttpsUri(row.before_url);
    const afterUrl = sanitizeHttpsUri(row.after_url);
    if (!beforeUrl || !afterUrl) continue;
    const photo = { before_url: beforeUrl, after_url: afterUrl };
    if (str(row.caption)) photo.caption = str(row.caption).slice(0, CERTIFIED_PHOTO_LIMITS.caption);
    photos.push(photo);
  }
  return photos;
}

/** services -> [{ name, description? }] (schema also allows bare strings; objects are richer). */
function mapServices(raw, businessName) {
  const seen = new Set();
  const bn = str(businessName).toLowerCase();
  const out = [];
  for (const s of arr(raw)) {
    const name = trimResidue(typeof s === "string" ? s : (s && (s.name || s.title || s.label)));
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    // A scraped label identical to the business's own name is a nav artifact,
    // not a service. Omitting it can never fabricate anything.
    if (bn && key === bn) continue;
    seen.add(key);
    const description = typeof s === "string" ? "" : trimResidue(s && (s.description || s.text || s.summary));
    out.push(description ? { name, description } : { name });
    if (out.length >= CAP.services) break;
  }
  return out;
}

/**
 * reviews -> [{ text, author? }]. text is required; a nameless review keeps no
 * author.
 *
 * The schema also allows `rating` on a review and this mapper used to copy it.
 * It no longer does. A per-review star number is a TRUST NUMERAL, not
 * descriptive copy: it is passed verbatim into window.__WSS_CONTENT__.reviews,
 * a `consumes_content` donor can render it as stars, and a number is the one
 * shape that can be silently averaged into an aggregate. The Genie cannot
 * verify it, so it does not come across. The words stay (behind the content
 * flag); the score does not.
 */
function mapReviews(raw) {
  const out = [];
  for (const r of arr(raw)) {
    if (!r) continue;
    const text = typeof r === "string" ? str(r) : str(r.text || r.quote || r.review || r.comment || r.body);
    if (!text) continue;
    const entry = { text };
    const author = typeof r === "string" ? "" : str(r.author || r.name || r.reviewer);
    if (author) entry.author = author;
    out.push(entry);
    if (out.length >= CAP.reviews) break;
  }
  return out;
}

/** faqs -> [{ q, a }]; both sides required, so a half-empty pair is dropped. */
function mapFaqs(raw) {
  const out = [];
  for (const f of arr(raw)) {
    if (!f || typeof f !== "object") continue;
    const q = str(f.q || f.question);
    const a = str(f.a || f.answer);
    if (!q || !a) continue;
    out.push({ q, a });
    if (out.length >= CAP.faqs) break;
  }
  return out;
}

function mapStrings(raw, cap) {
  const seen = new Set();
  const out = [];
  for (const v of arr(raw)) {
    const s = trimResidue(typeof v === "string" ? v : (v && (v.name || v.city || v.label)));
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/** team -> [{ name, role?, bio? }]. A member without a name is not a person we can name. */
function mapTeam(raw) {
  const out = [];
  for (const t of arr(raw)) {
    if (!t) continue;
    const name = str(typeof t === "string" ? t : (t.name || t.full_name));
    if (!name) continue;
    const entry = { name };
    const role = typeof t === "string" ? "" : str(t.role || t.title || t.position);
    if (role) entry.role = role;
    const bio = typeof t === "string" ? "" : str(t.bio || t.description);
    if (bio) entry.bio = bio.slice(0, MAXLEN.bio);
    out.push(entry);
    if (out.length >= CAP.team) break;
  }
  return out;
}

/** press -> [{ label, href }]; the schema requires an https href, so http/relative is dropped. */
function mapPress(raw) {
  const out = [];
  for (const p of arr(raw)) {
    if (!p || typeof p !== "object") continue;
    const label = str(p.label || p.title || p.outlet);
    const href = str(p.href || p.url || p.link);
    if (!label || !/^https:\/\//i.test(href)) continue;
    out.push({ label, href });
    if (out.length >= CAP.press) break;
  }
  return out;
}

/**
 * Build the MirrorContent object. Every field is optional and a field the
 * packet does not carry is OMITTED — never blanked, never defaulted, never
 * generated. An empty result is an empty object, and the caller must not
 * attach it (the engine treats `{}` as no content, which is correct).
 */
function packetToMirrorContent(packet, { truthSource } = {}) {
  const f = packet.facts || {};
  const trust = packet.trust || {};
  const sources = [f, packet];
  const content = {};

  const services = mapServices(pick(sources, ALIASES.services), f.name);
  if (services.length) content.services = services;

  const faqs = mapFaqs(pick(sources, ALIASES.faqs));
  if (faqs.length) content.faqs = faqs;

  const reviews = mapReviews(trust.reviews);
  if (reviews.length) content.reviews = reviews;

  const areas = mapStrings(pick(sources, ALIASES.areas), CAP.areas);
  if (areas.length) content.areas = areas;

  // hours: schema accepts the Genie's map form or a list form. Unknown hours
  // are absent, not `null` — a null renders nothing either way, and absence is
  // the honest statement.
  const hours = f.hours;
  if (hours && (Array.isArray(hours) ? hours.length : Object.keys(hours).length)) content.hours = hours;

  const about = str(pick(sources, ALIASES.about));
  if (about) content.about = about.slice(0, MAXLEN.about);

  const mission = str(pick(sources, ALIASES.mission));
  if (mission) content.mission = mission.slice(0, MAXLEN.mission);

  const founded = Number(pick(sources, ALIASES.founded_year));
  if (Number.isInteger(founded) && founded >= 1800 && founded <= 2100) content.founded_year = founded;

  const team = mapTeam(pick(sources, ALIASES.team));
  if (team.length) content.team = team;

  const awards = mapStrings(pick(sources, ALIASES.awards), CAP.awards);
  if (awards.length) content.awards = awards;

  const press = mapPress(pick(sources, ALIASES.press));
  if (press.length) content.press = press;

  // GATE 4C provenance. Only a real on-disk packet path counts; we never
  // manufacture one, because a fabricated truth_source defeats the gate.
  const ts = (Array.isArray(truthSource) ? truthSource : [truthSource]).map(str).filter(Boolean).slice(0, 12);
  if (ts.length) content.truth_source = ts;

  // QUARANTINE BOUNDARY. MirrorContent declares no phone/address/email/website
  // key and no rating/review_count key, so by construction none can be here —
  // this strip is the belt to that suspenders. If someone later adds a NAP- or
  // trust-shaped alias to the map above, it dies here instead of on a
  // customer's live mirror.
  return stripFields(content, isQuarantinedKey).clean;
}

/**
 * Everything the packet carries that MirrorContent has no home for. Returned
 * as a sibling so nothing is silently dropped, and kept OUT of `content` so
 * `additionalProperties: false` can never 400 the build again.
 */
function packetToExtra(packet, expectedWebsite = "") {
  const f = packet.facts || {};
  const trust = packet.trust || {};
  const extra = {};
  const dropped = [];
  const trustDropped = [];

  // booking_url used to live here. It is website-class NAP (a URL that tells a
  // customer where to transact) and is now dropped with the rest.
  if (f.booking_url) dropped.push("booking_url");

  // socials survive: they are not NAP and they are never attached to a request.
  // They are also the forensic trail — the fabricated phone was a truncation of
  // the Facebook page id sitting in this very array.
  const socials = mapStrings(f.socials, 12);
  if (socials.length) {
    extra.socials = socials;
    // Packet 2 may observe a social URL in a crawl or receive it as an intake
    // source. That is useful research metadata, but it is not proof that the
    // prospect owns the profile. Preserve the evidence and its explicit
    // unverified status here; never copy it to request.facts.socials (whose
    // schema requires own_site_link/named_match provenance).
    const socialEvidence = arr(packet.evidence).filter((row) => row && /^(?:social|socials)$/i.test(str(row.field)));
    extra.social_observations = socials.map((url) => {
      const evidence = socialEvidence.find((row) => {
        const values = Array.isArray(row.value) ? row.value.map(str) : [str(row.value)];
        return values.includes(url);
      }) || socialEvidence[0] || null;
      return {
        url,
        source: evidence ? str(evidence.source || evidence.source_type) : "public_source_observation",
        verification_status: "unverified_source_observation",
      };
    });
  }

  const observedBrand = packetToObservedBrand(packet, expectedWebsite);
  if (observedBrand.audit) extra.observed_brand = observedBrand.audit;

  if (packet.optimization && Object.keys(packet.optimization).length) extra.optimization = packet.optimization;

  // evidence: rows ABOUT a NAP field or a trust numeral are removed
  // value-and-all. Keeping them would preserve the fabricated number verbatim
  // under an "operator_verified" badge — exactly the artifact a careless caller
  // would trust. A packet is free to stamp that badge on a rating too.
  if (Array.isArray(packet.evidence) && packet.evidence.length) {
    const kept = packet.evidence.filter((e) => !(e && isQuarantinedKey(e.field)));
    for (const e of packet.evidence) {
      if (!e) continue;
      if (isNapKey(e.field)) dropped.push(`evidence:${e.field}`);
      else if (isTrustKey(e.field)) trustDropped.push(`evidence:${e.field}`);
    }
    if (kept.length) extra.evidence = kept;
  }

  if (packet.scope && Object.keys(packet.scope).length) extra.scope = packet.scope;
  if (Array.isArray(packet.warnings) && packet.warnings.length) extra.warnings = packet.warnings;

  // Whatever else the packet carried under a NAP-shaped key.
  for (const k of Object.keys(f)) {
    if (isNapKey(k) && k !== "booking_url" && f[k] != null && f[k] !== "" && !dropped.includes(k)) dropped.push(k);
  }
  // Trust numerals, from wherever the packet chose to put them. NAMES ONLY —
  // the whole point is that the number itself does not survive the boundary.
  for (const src of [trust, f]) {
    for (const [k, v] of Object.entries(src || {})) {
      if (isTrustKey(k) && v != null && v !== "" && !trustDropped.includes(k)) trustDropped.push(k);
    }
  }
  // A per-review star number is dropped by mapReviews; note that it happened.
  if (arr(trust.reviews).some((r) => r && typeof r === "object" && r.rating != null && r.rating !== "")) {
    trustDropped.push("reviews[].rating");
  }
  if (dropped.length) extra.dropped_nap = dropped;
  if (trustDropped.length) extra.dropped_trust = trustDropped;
  return extra;
}

/** Title-case a canonical category token into an industry display label. */
function categoryToIndustry(category) {
  return String(category || "").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** First approved asset of a kind, from the Genie assets[] array. */
function firstApproved(assets, kind) {
  return (Array.isArray(assets) ? assets : []).find((a) => a && a.kind === kind && a.approved && a.url) || null;
}
function allApproved(assets, kind) {
  return (Array.isArray(assets) ? assets : []).filter((a) => a && a.kind === kind && a.approved && a.url).map((a) => a.url);
}

/**
 * genieToMirrorRequest(packet, { slug, donor, accent, verifiedNap, verifiedReviews }) ->
 *   { ok, request, content, content_quarantine, extra } | { ok:false, error, detail }
 *
 * - packet: a validated intake-genie-v2 canonical packet (the Genie's output).
 * - slug: caller-provided wss subdomain label (the engine still owns naming).
 * - donor: optional explicit donor; omitted -> engine selects by category.
 * - accent: optional pre-measured hex. Omitted -> the engine measures it from
 *   the logo via capture-brand (brand.logo + accent_source). We do NOT invent
 *   a color here; a blank accent means "engine, you measure it".
 *
 * - truthSource: absolute path(s) to the on-disk packet this was compiled from.
 *   Supplied only by a caller that actually wrote one; it arms GATE 4C
 *   (client-isolation) and must never be manufactured here.
 *
 * - verifiedNap: { phone, address?, email?, website?, source } — the ONLY way a
 *   phone/address/email/website reaches the request. `source` must name where
 *   the value was independently observed (LeadMiner row, CallPrep record, the
 *   operator's own check). It may not name the Genie: laundering the packet's
 *   own value through this parameter is the failure this gate exists to stop.
 *
 * - verifiedReviews: { rating, review_count, source } — the ONLY way a star
 *   rating or review count reaches the request. Same rules as verifiedNap, plus
 *   BOTH numerals are required together: a rating with no count behind it is
 *   not evidence, and local-seo.js already refuses to render one without the
 *   other. Omitted -> the mirror ships with no stars at all, which is the
 *   honest outcome (TRUTH LAW), not a defect.
 *
 * - genieContent: explicit boolean override for GENIE_CONTENT_ENABLED. Default
 *   (undefined) reads the env flag, which defaults to OFF/quarantined.
 *
 * Content is attached to the request ONLY when the flag is on AND the packet
 * carried something the MirrorContent schema has a home for. When quarantined,
 * `content` is null and `content_quarantine` says why — a build then runs on
 * verified facts alone instead of silently degrading into invented copy.
 */
function genieToMirrorRequest(packet, { slug, donor, accent, truthSource, verifiedNap, verifiedReviews, genieContent } = {}) {
  if (!packet || packet.ok === false) {
    return { ok: false, error: "genie_packet_unusable", detail: [{ reason: packet && packet.status ? packet.status : "no_packet" }] };
  }
  if (!String(packet.version || "").startsWith("intake-genie-v")) {
    return { ok: false, error: "genie_packet_unusable", detail: [{ reason: "unrecognized_version", value: packet.version }] };
  }
  const f = packet.facts || {};
  const missing = SUPPORTED_MIN.filter((k) => !String(f[k] || "").trim());
  if (missing.length) {
    return { ok: false, error: "genie_packet_incomplete", detail: missing.map((k) => ({ path: `/facts/${k}`, reason: "blank" })) };
  }
  if (!slug || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(slug)) {
    return { ok: false, error: "slug_required", detail: [{ path: "/slug", reason: "caller must supply a valid slug" }] };
  }

  // NAP GATE. The packet's own phone/address/email/website are dropped here and
  // are never consulted again — not as a value, not as a fallback, not as a
  // "confirmation" of the caller's. `napDropped` records only the key names.
  const { dropped: napDropped } = stripNapFields(f);
  const nap = verifiedNap && typeof verifiedNap === "object" ? verifiedNap : null;
  const napSource = str(nap && nap.source);
  const verifiedPhone = str(nap && nap.phone);
  if (!verifiedPhone) {
    return {
      ok: false,
      error: "nap_unverified",
      detail: [{
        path: "/facts/phone",
        reason: "genie_nap_quarantined",
        note: "the Genie's phone is dropped at this boundary; supply verifiedNap.phone from an independent source",
        genie_supplied_nap: napDropped,
      }],
    };
  }
  if (!napSource) {
    return {
      ok: false,
      error: "nap_source_required",
      detail: [{ path: "/verifiedNap/source", reason: "must name where the NAP was independently observed" }],
    };
  }
  if (/genie/i.test(napSource)) {
    return {
      ok: false,
      error: "nap_source_not_independent",
      detail: [{ path: "/verifiedNap/source", reason: "the Genie cannot corroborate itself", value: napSource }],
    };
  }

  // TRUST GATE. The packet's own rating/review_count are dropped here and are
  // never consulted again — not as a value, not as a fallback, not as a
  // "confirmation" of the caller's. `trustDropped` records only the key names.
  const trust = packet.trust || {};
  const trustDropped = [...new Set([
    ...stripTrustFields(trust).dropped,
    ...stripTrustFields(f).dropped,
  ])];
  const rv = verifiedReviews && typeof verifiedReviews === "object" ? verifiedReviews : null;
  let reviewsSource = null;
  let verifiedRating = null;
  let verifiedReviewCount = null;
  if (rv) {
    const src = str(rv.source);
    if (!src) {
      return {
        ok: false,
        error: "reviews_source_required",
        detail: [{ path: "/verifiedReviews/source", reason: "must name where the rating was independently observed" }],
      };
    }
    if (/genie/i.test(src)) {
      return {
        ok: false,
        error: "reviews_source_not_independent",
        detail: [{ path: "/verifiedReviews/source", reason: "the Genie cannot corroborate itself", value: src }],
      };
    }
    const rating = Number(str(rv.rating));
    const count = Number(str(rv.review_count ?? rv.reviewCount ?? rv.count));
    // Both, or neither. Same sanity window local-seo.js enforces before it will
    // emit aggregateRating, kept identical on purpose so the two cannot drift.
    const ratingOk = Number.isFinite(rating) && rating > 0 && rating <= 5;
    const countOk = Number.isFinite(count) && count > 0;
    if (!ratingOk || !countOk) {
      return {
        ok: false,
        error: "reviews_incomplete",
        detail: [{
          path: "/verifiedReviews",
          reason: "a rating and a review_count must BOTH be supplied and in range (0 < rating <= 5, count > 0)",
          rating_ok: ratingOk,
          review_count_ok: countOk,
        }],
      };
    }
    reviewsSource = src;
    verifiedRating = rating;
    verifiedReviewCount = Math.round(count);
  }

  const logoAsset = firstApproved(packet.assets, "logo");
  // The whole bank, not a leaflet. The owner's audit rejected the eight-photo
  // contract for shrinking a rich site into a brochure; 20 matches MAX_PHOTOS
  // in client-photos.js so the photo bank and the request agree on the ceiling.
  // Sanitized against the request schema's uri format: the approved list may
  // still carry a URL the schema would 400 on, and a gallery that shrinks by
  // the malformed few beats a build that never runs.
  const sanitizedPhotoList = sanitizePhotoUris(allApproved(packet.assets, "photo"), { max: 20 });
  const photos = sanitizedPhotoList.photos;
  // Their own hero video, when the Genie verified one — rung 1 of the
  // donor's hero_video ladder. Absent is honest; never a borrowed clip.
  const heroVideoAsset = firstApproved(packet.assets, "video");

  // Facts: only what the Genie actually verified. latlng -> lat/lng pair.
  const facts = {
    business_name: f.name,
    industry: categoryToIndustry(f.category),
    city: f.city,
    state: String(f.state || "").toUpperCase(),
    phone: verifiedPhone,
  };
  if (str(nap.email)) facts.email = str(nap.email);
  if (str(nap.address)) facts.address = str(nap.address);
  if (str(nap.website)) facts.current_website = str(nap.website);
  if (Array.isArray(f.latlng) && f.latlng.length === 2) {
    facts.latitude = Number(f.latlng[0]);
    facts.longitude = Number(f.latlng[1]);
  } else if (f.latlng && typeof f.latlng === "object" && f.latlng.lat != null) {
    facts.latitude = Number(f.latlng.lat);
    facts.longitude = Number(f.latlng.lng ?? f.latlng.lon);
  }
  // TRUST NUMERALS. `trust` is deliberately NOT read here. The only path to a
  // star rating on a mirror is verifiedReviews, from a non-Genie source, with
  // both numerals present. No verifiedReviews -> no rating, no review_count,
  // no aggregateRating, no stars. That is the honest mirror.
  if (verifiedRating !== null) {
    facts.rating = verifiedRating;
    facts.review_count = verifiedReviewCount;
  }

  // CERTIFIED BUSINESS FACTS (2026-09-02 12-feature spec). Optional owner-
  // certified truths carried in the signed packet's facts: the compiler only
  // admits them from an owner corrections map or the explicit certified
  // business lane, the receipt's packet_sha256 covers them, and re-verification
  // re-hashes the same packet. None of them is NAP (they cannot hijack a
  // contact channel) and none is a trust numeral (they cannot fabricate a
  // star), so a present value passes into request.facts where the MirrorFacts
  // schema and validateFacts stay the boundary. ABSENT STAYS ABSENT — a packet
  // without them produces the exact request it always did.
  // MirrorFacts caps (license_number 60, associations items 80) are mirrored
  // here so an over-long certified value is dropped at the seam instead of
  // 400ing a request no retry can fix.
  if (str(f.license_number) && str(f.license_number).length <= 60) facts.license_number = str(f.license_number);
  if (f.insured === true) facts.insured = true;
  if (f.sms_capable === true) facts.sms_capable = true;
  if (str(f.google_place_id)) facts.google_place_id = str(f.google_place_id);
  const certifiedAssociations = mapStrings(f.associations, 12)
    .filter((name) => name.length <= 80);
  if (certifiedAssociations.length) facts.associations = certifiedAssociations;
  const certifiedFinancing = certifiedFinancingFacts(f.financing);
  if (certifiedFinancing) facts.financing = certifiedFinancing;
  const certifiedPhotos = certifiedProjectPhotoFacts(f.project_photos);
  if (certifiedPhotos.length) facts.project_photos = certifiedPhotos;

  const request = { slug, facts };
  if (donor) request.donor = donor;

  // Brand: their own logo (engine fetches + content-addresses + measures the
  // accent from it). accent passed only if the caller pre-measured one.
  // The logo URL is sanitized like the photos: a logo the schema would 400 on
  // is no logo — the brand falls to the photos-only rung, never a 400.
  const logoUrl = sanitizeHttpsUri(logoAsset && logoAsset.url);
  if (logoUrl) {
    request.brand = { logo: logoUrl };
    if (accent) { request.brand.accent = accent; request.brand.accent_source = logoUrl; }
    if (photos.length) request.brand.photos = photos;
  } else if (photos.length) {
    request.brand = { photos };
  }
  // The client's own hero video when the Genie verified one on their site.
  // Rung 1 of the donor's hero_video ladder; absent is honest — the ladder
  // falls to the WSS-owned clip or their photograph, never a borrowed video.
  const heroVideoUrl = sanitizeHttpsUri(heroVideoAsset && heroVideoAsset.url);
  if (heroVideoUrl) {
    request.brand = request.brand || {};
    request.brand.hero_video = { url: heroVideoUrl };
  }

  // Packet 2 design observations. These live only in the brand channel, never
  // in business facts. A first-party HTTPS source is mandatory before a font
  // or colour can influence rendered output; the full observation record stays
  // in `extra.observed_brand` for downstream audit. We intentionally map a
  // scraped colour as site_accent (site chrome), never as accent (logo proof).
  const verifiedWebsite = httpsUrl(nap && nap.website);
  const observedBrand = packetToObservedBrand(packet, verifiedWebsite);
  if (Object.keys(observedBrand.request_brand).length) {
    request.brand = { ...(request.brand || {}), ...observedBrand.request_brand };
  }

  // CONTENT — QUARANTINED BY DEFAULT.
  //
  // When the flag is on, content is schema-homed and ATTACHED: engine.js gates
  // its whole content stage on `request.content`, so content that never lands
  // on the request renders nothing. Attached only when non-empty; `{}` means
  // "no content" to the engine anyway.
  //
  // When the flag is off (the default) content is NULL with a stated reason.
  // The build then runs on verified facts only. That is a smaller mirror, and
  // a smaller mirror is the correct outcome — the alternative is shipping
  // whatever the Genie decided to assert about a business it half-scraped.
  const extra = packetToExtra(packet, verifiedWebsite);
  const contentAllowed = genieContentEnabled(genieContent);
  let content = null;
  let contentQuarantine = null;
  if (contentAllowed) {
    const mapped = packetToMirrorContent(packet, { truthSource });
    if (Object.keys(mapped).length) {
      content = mapped;
      request.content = mapped;
    }
  } else {
    contentQuarantine = {
      quarantined: true,
      flag: GENIE_CONTENT_FLAG,
      reason: GENIE_CONTENT_QUARANTINE_REASON,
      detail: "Genie descriptive content is withheld until an independent NAP cross-check exists; "
        + `set ${GENIE_CONTENT_FLAG}=1 (or pass genieContent:true) only once that cross-check is in place.`,
      withheld: Object.keys(packetToMirrorContent(packet, { truthSource })),
    };
  }

  return {
    ok: true,
    request,
    content,
    content_quarantine: contentQuarantine,
    // Counted note: approved photo values dropped as un-URI-able by the
    // pre-validation sanitizer (photo-uri-sanitize.js).
    ...(sanitizedPhotoList.droppedInvalid ? { brand_photos_dropped_invalid: sanitizedPhotoList.droppedInvalid } : {}),
    extra,
    nap_source: napSource,
    genie_nap_dropped: napDropped,
    reviews_source: reviewsSource,
    genie_trust_dropped: trustDropped,
    logo_evidence: logoAsset ? (logoAsset.meta || {}) : null,
  };
}

module.exports = {
  genieToMirrorRequest,
  packetToMirrorContent,
  packetToExtra,
  categoryToIndustry,
  certifiedFinancingFacts,
  certifiedProjectPhotoFacts,
  firstApproved,
  allApproved,
  packetToObservedBrand,
  ALIASES,
  // Quarantine surface — exported so the gate is testable and so a caller can
  // ask whether the pipe is open instead of guessing.
  NAP_KEYS,
  isNapKey,
  stripNapFields,
  TRUST_KEYS,
  isTrustKey,
  stripTrustFields,
  isQuarantinedKey,
  genieContentEnabled,
  GENIE_CONTENT_FLAG,
  GENIE_CONTENT_QUARANTINE_REASON,
};
