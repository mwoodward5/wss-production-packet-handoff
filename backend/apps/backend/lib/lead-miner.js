"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { recordEvent, select, selectRows, upsertRow, insertRow, conditionalUpdate } = require("./store");
const { buildBusinessTruthPacket } = require("./business-truth");
const { enrichContactEvidence } = require("./contact-enrichment");
const { canonicalIdentity, matchCanonicalIdentity, mergeSafePlan } = require("./prospect-identity");
const { firstValue, slugify } = require("./prospects");
const { normalizeUsLocation, publicServiceNames } = require("./public-data");
const { approvedIndustry } = require("./copilot");
const { telemetryPayload } = require("./agent-telemetry");
const { analyzeWebsite, reviewRecencyDays } = require("./site-weakness");
const namePlausibility = require("./name-plausibility");
const { clientReferenceCode } = require("./client-reference");
const { CircuitBreaker, callProvider } = require("./discovery-health");

// --- BUILD-READY FUNNEL DEPENDENCIES ---------------------------------------
// Everything under lib/mirror-engine/* is READ-ONLY for this module. We call
// the engine's own gates rather than re-implementing them, because a miner-side
// copy of a build-time rule is a second source of truth that drifts.
const dnsPromises = require("node:dns").promises;
const { createHash } = require("node:crypto");
const { listDonors, donorRetirement } = require("./mirror-engine/donor");
const { resolveAlias } = require("./donor-verticals");
const { isDonorExcluded, DONOR_EXCLUSION_CAUSE } = require("./donor-exclusions");
const { guardedFetch, sniffImage, measureAccent } = require("./mirror-engine/brand-assets");
const { paletteFromLogo } = require("./logo-palette");
const { extractBrandIdentity, collectStylesheetHrefs } = require("./brand-extractor");
const { extractSitePalette } = require("./mirror-engine/site-palette");
const {
  extractDonorFingerprint: extractClientDonorFingerprint,
  fingerprintForRequest: donorFingerprintForRequest,
} = require("./mirror-engine/donor-fingerprint");
const { serviceAreaAssertion, stateCodeOf, shapeReviews, stripTrailingLocality } = require("./mirror-engine/verified-facts");
const { harvestPageServices } = require("./mirror-engine/service-harvest");
const { latLngInState, derivePhoneDigits, FORBIDDEN_VALUE_CHARS } = require("./mirror-engine/facts");
const { slugCoherence } = require("./mirror-engine/client-isolation");
const { RESERVED_SLUGS } = require("./mirror-engine/deploy");
const { mirror } = require("./mirror-engine/engine");
const {
  sameOwner,
  ownsLogo,
  registrableDomain,
  rankLogoCandidates,
  classifyHeaderMark,
  attrOf,
  schemaLogoUrls,
  imagesWithContext,
  isHomeHref,
  upgradeToHttps,
} = require("./web-brand");
const { sanitizeEmail } = require("./forge");
const { hoursFromWeekdayDescriptions, isGoogleReviewerFace } = require("./verified-trust-lookup");
// NATIONAL-CHAIN EXCLUSION — a franchise name is refused at candidate
// admission (stage 1) with cause national_chain_excluded, the same terminal
// cause the pick-time admission in lib/line-adapters.js quarantines on.
const { NATIONAL_CHAIN_EXCLUDED, isNationalChainName } = require("./pick-name-plausibility");
const buildQual = require("./build-qualification");
const socialDiscovery = require("./mirror-engine/social-discovery");
const {
  deepQueries,
  pagesFor,
  isFacebookSite,
  flatnessScore,
  rankCandidates,
} = require("./mirror-engine/miner-retarget");
const { chooseBrandMark } = require("./mirror-engine/logo-ladder");
const { hexToHsl } = require("./mirror-engine/theme");
const { nearbyCities: resolveNearbyCities } = require("./mirror-engine/nearby-cities");
const { eligibleMarketCity } = require("./mirror-engine/place-names");
const { fencingVerticalVerdict, sportFencingGuardEnabled } = require("./trade-inference");
// Region/ZIP market ladder tokens — the query-shape diversity ladders shared
// with the quota source rotation (lib/line-quota.js), resolved here so the
// metro fence can check a "plumbing in 79401" plan at its true state line.
const { marketTokenLocation, ZIP_MARKETS } = require("./market-tokens");
// TARGET_MAX_POLISH — the heavy-target admission cap dial (owner directive
// 2026-09-03), kept beside the other campaign dials in lib/line-quota.js.
const { targetMaxPolish } = require("./line-quota");
// THE CLIENT'S OWN PHOTOGRAPHS, banked with provenance. See client-photo-bank.js
// for why this is here: the harvester has always worked, and its output had
// never once been written into the contract this file produces.
const photoBank = require("./client-photo-bank");

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Non-global twin of EMAIL_RE for VALIDATING a single candidate. A global regex
// carries lastIndex, and `.test()` mutates it — so validating with EMAIL_RE (as
// the filter used to) left lastIndex advanced across candidates and across
// calls. extractEmail is invoked once per enriched place, so that leak
// corrupted later leads' extraction ("owner@acme.com" -> "wner@acme.com"). This
// stateless twin does the validating; EMAIL_RE is now used only by matchAll.
const EMAIL_VALIDATE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const JUNK_EMAIL =
  /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|\.css|\.js)$|@(example|sentry|wixpress|schema)\./i;
const PLATFORM_EMAIL = /@(godaddy|wordpress|wix|squarespace|shopify|google|gstatic|cloudflare|sentry)\./i;
const IDENTITY_INDEX_READ_ATTEMPTS = 3;
const IDENTITY_INDEX_RETRY_DELAY_MS = 25;
const waitForIdentityIndexRetry = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// PLACEHOLDER EMAILS — a scrape artifact, not a mailbox. "your@email.com" and
// "name@email.com" reached the store from a contact form's own input
// placeholder left in the page source; both would hard-bounce. A lead whose
// only email is a placeholder is UNCONTACTABLE, and this predicate is asked
// wherever an email decides contactability so it is treated exactly like no
// email: never captured (extractEmail), never scored contactable
// (opportunityInputFromRow), never qualified for a send (qualifyEmail), never
// admitted to the send pool (full-run.js).
//
// JUNK_EMAIL/PLATFORM_EMAIL above judge crawler and platform domains; this is
// the missing half — the classic form-field placeholders on BOTH the local
// part ("your@", "name@", "test@", noreply) and the domain ("@email.com",
// "@example.*", the RFC-2606/6761 reserved names). Conservative on purpose: a
// real business address (info@acmehvac.com, john@smithplumbing.com) is never
// caught, because its local part is not a placeholder token and its domain is
// neither a reserved name nor a bare form-field stand-in.
const PLACEHOLDER_LOCALPART = /^(?:your|name|your[._-]?name|your[._-]?email|youremail|first[._-]?name|last[._-]?name|firstname|lastname|example|sample|test|testing|placeholder|changeme|email|e[._-]?mail|noreply|no[._-]?reply|donotreply|do[._-]?not[._-]?reply)$/i;
// First domain label that only ever appears in a placeholder ("email.com",
// "yourdomain.net", "yoursite.com"). Real trade domains never start with these.
const PLACEHOLDER_DOMAIN_FIRST_LABEL = new Set([
  "email", "domain", "yourdomain", "yourcompany", "yourbusiness",
  "mysite", "yoursite", "website", "sample", "placeholder", "example",
]);
// RFC-2606/6761 reserved TLDs: an address under one is by definition not real.
const RESERVED_TLDS = new Set(["example", "invalid", "localhost", "test"]);

function isPlaceholderEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return false; // not an address shape
  const localPart = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (PLACEHOLDER_LOCALPART.test(localPart)) return true;
  const labels = domain.split(".").filter(Boolean);
  if (!labels.length) return false;
  if (PLACEHOLDER_DOMAIN_FIRST_LABEL.has(labels[0])) return true;     // email.com, yourdomain.net…
  if (labels.includes("example")) return true;                        // example.* and sub.example.*
  if (RESERVED_TLDS.has(labels[labels.length - 1])) return true;      // *.test / *.invalid / *.localhost
  return false;
}

const MAX_LIMIT = 1000;
const MAX_PAGE_SIZE = 20;
let opportunityModulePromise = null;

function opportunityModule() {
  if (!opportunityModulePromise) {
    const url = pathToFileURL(path.join(__dirname, "..", "asset-pipeline", "opportunity-score.mjs")).href;
    opportunityModulePromise = import(url);
  }
  return opportunityModulePromise;
}

function parseCsv(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback;
}

function numberInRange(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Default-on owner policy. A literal 0 is the only kill switch. */
function flatSiteFirstEnabled(env = process.env) {
  return String((env || {}).GHOST_AGENCY_FLAT_SITE_FIRST ?? "1").trim() !== "0";
}

// LINE DEEP BATCH DEPTH (owner doctrine 2026-09-04, "scaling and rapid
// production flow"). The operator Line's deep-verification wave was pinned to
// the goal-sized cohort: pickProspects asked the miner for exactly the
// remaining quota, so of the ~40 email-surviving discovery candidates only the
// first 10 ever reached stages 6-8. This env widens that ONE wave: set to an
// integer >= 1 (e.g. LINE_DEEP_BATCH_DEPTH=40) and up to that many
// email-surviving candidates enter deep verification together. Unset, blank,
// non-numeric, or < 1 keeps the historical behaviour exactly (the goal size).
// The 100 ceiling is the provider SERP width — discovery cannot name more
// survivors in one wave than the search returned, so anything beyond it is a
// typo, not a dial.
const LINE_DEEP_BATCH_DEPTH_ENV = "LINE_DEEP_BATCH_DEPTH";
const LINE_DEEP_BATCH_DEPTH_CEILING = 100;
function lineDeepBatchDepth(env = process.env) {
  const raw = Number(String((env || {})[LINE_DEEP_BATCH_DEPTH_ENV] ?? "").trim());
  if (!Number.isInteger(raw) || raw < 1) return 0;
  return Math.min(raw, LINE_DEEP_BATCH_DEPTH_CEILING);
}

/** JOB 4: true logo absence is a default-on polish downgrade. */
function logoLadderFallbackEnabled(env = process.env) {
  return String((env || {}).GHOST_AGENCY_LOGO_LADDER_FALLBACK ?? "1").trim() !== "0";
}

function homepageScrapeFallbackEnabled(env = process.env) {
  return String((env || {}).GHOST_AGENCY_MINER_SCRAPE_FALLBACK ?? "1").trim() !== "0";
}

function homepageScrapeFallbackLimit(env = process.env) {
  // Cost law removed (owner directive 2026-08-31). This is a sanity ceiling —
  // one recovery scrape per candidate site, up to 200 sites per run — not a
  // spend throttle. Every scrape still lands on the cost ledger.
  return numberInRange((env || {}).GHOST_AGENCY_MINER_SCRAPE_FALLBACK_LIMIT, 200, 0, 200);
}

/**
 * EMERGENCY KILL-SWITCH — the one Firecrawl control that remains (owner
 * directive 2026-08-31: dump the cost law, keep an emergency stop only,
 * default OFF). GHOST_AGENCY_FIRECRAWL_EMERGENCY_STOP=1 halts every Firecrawl
 * call: search, scrape, branding, crawl, and rendered JSON-LD. This is
 * infrastructure safety against a runaway, not spend policing — with the
 * switch off (the default) no cap ever refuses work, and the cost ledger
 * still meters everything.
 */
function firecrawlEmergencyStop(env = process.env) {
  return String((env || {}).GHOST_AGENCY_FIRECRAWL_EMERGENCY_STOP ?? "0").trim() === "1";
}

/**
 * Operator Line paid Firecrawl fallback pool per mining invocation. The old
 * cost law (default 1, hard max 2) was removed: rendered JSON-LD, homepage
 * HTML recovery, and branding share one generous pool (default 25, max 25) so
 * discovery and compile depth are never throttled by spend.
 */
function operatorLineFirecrawlFallbackLimit(input = {}, env = process.env) {
  if (String(input && input.trigger || "").trim() !== "operator_line") return null;
  return numberInRange((env || {}).GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT, 25, 0, 25);
}

/** Firecrawl `branding` format logo recovery — default-on, kill-switchable. */
function brandingFallbackEnabled(env = process.env) {
  return String((env || {}).GHOST_AGENCY_MINER_BRANDING_FALLBACK ?? "1").trim() !== "0";
}

/**
 * Static-site brand extraction (lib/brand-extractor) — default-on,
 * kill-switchable. Reads the prospect's own HTML/CSS for the accent, logo
 * candidate and font when the verified-logo pipeline found nothing. Costs at
 * most cssLimit fetches of the site's OWN stylesheets; no provider calls.
 */
function brandExtractionEnabled(env = process.env) {
  return String((env || {}).GHOST_AGENCY_BRAND_EXTRACTION ?? "1").trim() !== "0";
}

/**
 * Donor-fingerprint extraction (lib/mirror-engine/donor-fingerprint) —
 * default-on, kill-switchable, and deliberately NOT chained to the brand
 * extraction switch: the fingerprint's structure half (taxonomy, proof
 * inventory, section ordering, CTA shape) is worth recording even when the
 * palette lane is off. Zero fetches — pure regex over the HTML stage 4
 * already holds.
 */
function donorFingerprintEnabled(env = process.env) {
  return String((env || {}).GHOST_AGENCY_DONOR_FINGERPRINT ?? "1").trim() !== "0";
}

/**
 * The extractor's full result, mapped to the mirror-request schema's
 * brand_identity shape (the render side is theme.normalizeBrandIdentity).
 * Anything the schema cannot carry — signals, fetch counts, the extraction
 * URL, error detail — is dropped here, and anything malformed is dropped
 * field-by-field rather than failing the whole request at Ajv.
 *
 * The schema REQUIRES accent_color + extraction_method + confidence as a
 * trio: an identity without a usable accent (the LOW/fallback_neutral and
 * extractor_error cases) maps to an empty object and the caller omits the
 * field entirely — the engine would refuse a LOW verdict at render anyway,
 * and an accent-less object is a transport error, not a documented refusal.
 */
function brandIdentityForRequest(identity) {
  const hex = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toUpperCase() : "");
  const httpsUri = (v) => (typeof v === "string" && /^https:\/\//i.test(v) ? v : "");
  const accent = hex(identity && identity.accent_color);
  if (!accent) return {};
  const out = { accent_color: accent };
  const secondary = hex(identity && identity.secondary_color);
  if (secondary) out.secondary_color = secondary;
  const background = hex(identity && identity.background);
  if (background) out.background = background;
  const logo = httpsUri(identity && identity.logo_url);
  if (logo) out.logo_url = logo;
  const font = String((identity && identity.font_family) || "").trim().slice(0, 60);
  if (font) out.font_family = font;
  const method = String((identity && identity.extraction_method) || "").trim().slice(0, 60);
  if (method) out.extraction_method = method;
  const confidence = String((identity && identity.confidence) || "").trim().toUpperCase();
  if (["HIGH", "MEDIUM", "LOW"].includes(confidence)) out.confidence = confidence;
  if (!out.extraction_method || !out.confidence) return {};
  return out;
}

/**
 * The site-palette harvester's result, mapped to the mirror-request schema's
 * site_palette shape (the render side is theme.normalizeSitePalette). Same
 * field-by-field law as brandIdentityForRequest: anything malformed is
 * dropped, not repaired, and a verdict with no usable colour maps to an
 * empty object the caller omits entirely — absence is the honest transport
 * for "the homepage declares nothing readable", never a gate.
 */
function sitePaletteForRequest(sitePalette) {
  const hex = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toUpperCase() : "");
  const httpsUri = (v) => (typeof v === "string" && /^https:\/\//i.test(v) ? v : "");
  const sp = sitePalette && typeof sitePalette === "object" ? sitePalette : null;
  if (!sp || sp.ok !== true) return {};
  const surface = hex(sp.surface);
  const ink = hex(sp.ink);
  const accent = hex(sp.accent);
  if (!surface && !ink && !accent) return {};
  const out = {
    mode: sp.mode === "dark" ? "dark" : "light",
    extraction_method: "site_html_css",
  };
  if (surface) out.surface = surface;
  if (ink) out.ink = ink;
  const link = hex(sp.link);
  if (link) out.link = link;
  if (accent) out.accent = accent;
  const darkSections = Math.max(0, Math.trunc(Number(sp.darkSectionCount) || 0));
  out.has_dark_slabs = darkSections > 0;
  out.dark_section_count = darkSections;
  out.light_section_count = Math.max(0, Math.trunc(Number(sp.lightSectionCount) || 0));
  const extractedFrom = httpsUri(sp.extractedFrom);
  if (extractedFrom) out.extracted_from = extractedFrom;
  return out;
}

/** Directory crawl — recover businesses behind directory/chamber pages. */
function directoryCrawlEnabled(env = process.env) {
  // Cost law removed (owner directive 2026-08-31): directory expansion is
  // default-on again. GHOST_AGENCY_MINER_DIRECTORY_CRAWL=0 still opts out.
  return String((env || {}).GHOST_AGENCY_MINER_DIRECTORY_CRAWL ?? "1").trim() !== "0";
}

function directoryCrawlLimit(env = process.env) {
  // Sanity ceiling, not a spend throttle: how many skipped directories one
  // run may expand. Each crawl is itself page-capped at 200 (see firecrawlCrawl).
  return numberInRange((env || {}).GHOST_AGENCY_MINER_DIRECTORY_CRAWL_LIMIT, 10, 0, 25);
}

function logoFailureCanUseLadder(brand) {
  // Brand assets are enrichment, never prospect admission. A missing, tiny,
  // stale, redirected, or otherwise unusable image falls to the frozen
  // business-name ladder. Identity and vertical checks still protect the row;
  // this function only prevents a cosmetic asset from killing the build.
  return Boolean(brand && brand.ok !== true);
}

function scopedMiningTerms(value, state) {
  const source = Array.isArray(value) ? value : parseCsv(value);
  const wantedState = String(state || "").toUpperCase();
  const terms = [];
  const seen = new Set();
  for (const item of source) {
    const itemState = item && typeof item === "object" ? String(item.state || "").toUpperCase() : "";
    if (itemState && wantedState && itemState !== wantedState) continue;
    const term = String(item && typeof item === "object" ? item.name || item.city || "" : item || "").trim();
    const key = term.toLocaleLowerCase("en-US");
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

function verifiedMiningCoordinates(input = {}) {
  const explicit = input.verifiedCoordinates && typeof input.verifiedCoordinates === "object"
    ? input.verifiedCoordinates
    : (input.coordinatesVerified === true ? (input.coordinates || input) : null);
  if (!explicit) return null;
  const lat = Number(explicit.lat ?? explicit.latitude);
  const lng = Number(explicit.lng ?? explicit.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

async function withMiningNearbyCities(input = {}) {
  if (!flatSiteFirstEnabled(input.env || process.env)) return input;
  const supplied = input.nearbyCities ?? input.nearby_cities ?? input.cachedNearbyCities;
  if (scopedMiningTerms(supplied).length) return { ...input, nearbyCities: supplied };
  const coordinates = verifiedMiningCoordinates(input);
  if (!coordinates) return input;
  const explicitLocation = String(input.location || input.metro || "").trim();
  const locations = explicitLocation ? [explicitLocation] : parseCsv(input.metros || input.locations);
  // One coordinate pair can truthfully describe one market only.
  if (locations.length !== 1) return input;
  const resolve = typeof input.nearbyCitiesImpl === "function" ? input.nearbyCitiesImpl : resolveNearbyCities;
  try {
    const metro = metroOfPlan(locations[0]);
    const towns = await resolve({ ...coordinates, excludeCity: metro.city, count: 6 });
    return Array.isArray(towns) && towns.length ? { ...input, nearbyCities: towns } : input;
  } catch {
    return input;
  }
}

function queryPlansFor({ industry, location, textQuery, rawQuery = false, queryGroup }, input = {}) {
  const env = input.env || process.env;
  const fallback = [{
    industry,
    location,
    textQuery: String(textQuery || `${industry} in ${location}`).trim(),
    pages: [1],
    queryGroup,
    queryShapeIndex: 0,
    queryShapeCount: 1,
    retargeted: false,
    rawQuery,
  }];
  if (rawQuery || !flatSiteFirstEnabled(env)) return fallback;

  const metro = metroOfPlan(location);
  const shapes = deepQueries({
    trade: industry,
    city: metro.city,
    state: metro.state,
    nearbyCities: scopedMiningTerms(input.nearbyCities, metro.state),
    neighborhoods: scopedMiningTerms(input.neighborhoods, metro.state),
  });
  if (!shapes.length) return fallback;
  // SERVICE-MODIFIER LONG-TAILS — appended AFTER the proven deep shapes so the
  // existing ladder (plain -> neighborhoods -> nearby -> small business) keeps
  // its exact rotation priority and head positions; the dispatch cursor then
  // wraps into the long-tails, so a later attempt reads a genuinely different
  // SERP. `{trade} {modifier} {place}` with place = "City ST" (the metro's own
  // fenceable form).
  const place = [metro.city, metro.state].filter(Boolean).join(" ");
  const seen = new Set();
  const withLongTails = [];
  const pushShape = (shape) => {
    const normalized = shape.replace(/\s+/g, " ").trim();
    const key = normalized.toLocaleLowerCase("en-US");
    if (normalized && !seen.has(key)) {
      seen.add(key);
      withLongTails.push(normalized);
    }
  };
  for (const shape of shapes) pushShape(shape);
  for (const modifier of SERVICE_MODIFIERS) pushShape(`${industry} ${modifier} ${place}`);
  const shapesWithLongTails = withLongTails.slice(0, 34); // deepQueries' own 24 + the 10 modifiers
  return shapesWithLongTails.map((shape, index) => ({
    industry,
    location,
    textQuery: shape,
    pages: pagesFor(shape, true),
    queryGroup,
    queryShapeIndex: index,
    queryShapeCount: shapesWithLongTails.length,
    retargeted: true,
  }));
}

function dispatchQueryPlans(plans = [], cursor = Math.floor(Date.now() / 86400000), groupOffset = 0) {
  const groups = new Map();
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    const key = plan.queryGroup ?? `ungrouped:${index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(plan);
  }
  const start = Number.isFinite(Number(cursor)) ? Math.trunc(Number(cursor)) : 0;
  const grouped = [...groups.values()].map((group, index) => ({ group, index }));
  if (!grouped.length) return [];
  const rawOffset = Number.isFinite(Number(groupOffset)) ? Math.trunc(Number(groupOffset)) : 0;
  const offset = ((rawOffset % grouped.length) + grouped.length) % grouped.length;
  const ordered = grouped.slice(offset).concat(grouped.slice(0, offset));
  return ordered.map(({ group, index }) => {
    const selected = ((start + index) % group.length + group.length) % group.length;
    return group[selected];
  });
}

function buildQueries(input = {}) {
  const env = input.env || process.env;
  if (input.query && String(input.query).trim()) {
    const industry = String(input.industry || "").trim();
    const location = String(input.location || input.metro || "").trim();
    if (!industry || !location) {
      const error = new Error("A raw mining query still requires an explicit approved category and city/location.");
      error.code = "mine_plan_incomplete";
      throw error;
    }
    const allowRawQuery = input.trigger === "scheduled_cron" && input.allowRawQuery === true;
    return queryPlansFor({
      textQuery: allowRawQuery ? String(input.query).trim() : `${industry} in ${location}`,
      industry,
      location,
      rawQuery: allowRawQuery,
      queryGroup: 0,
    }, input);
  }

  const allowScheduledDefaults = input.trigger === "scheduled_cron";
  const verticals = parseCsv(
    input.verticals || input.industries || input.industry,
    allowScheduledDefaults ? parseCsv(env.GHOST_AGENCY_DAILY_MINING_VERTICALS) : [],
  );
  const metros = parseCsv(
    input.metros || input.locations || input.location || input.metro,
    allowScheduledDefaults ? parseCsv(env.GHOST_AGENCY_DAILY_MINING_METROS) : [],
  );

  if (!verticals.length || !metros.length) {
    const error = new Error("Mining requires an explicit approved category and city/location.");
    error.code = "mine_plan_incomplete";
    throw error;
  }

  const out = [];
  let queryGroup = 0;
  for (const industry of verticals) {
    for (const location of metros) {
      out.push(...queryPlansFor({
        industry,
        location,
        textQuery: `${industry} in ${location}`.trim(),
        queryGroup,
      }, input));
      queryGroup++;
    }
  }
  return out;
}

async function fetchText(url, ms) {
  const attempts = numberInRange(process.env.GHOST_AGENCY_MINER_FETCH_RETRIES, 3, 1, 5);
  let lastFailure = "fetch_failed";
  let lastStatus = null;
  const started = Date.now();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const response = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 WoodwardLeadMiner/1.0" },
      });
      lastStatus = response.status;
      if (!response.ok) {
        lastFailure = `http_${response.status}`;
      } else {
        const contentType = response.headers.get("content-type") || "";
        if (contentType && !/text|html|xml|json/i.test(contentType)) {
          lastFailure = "unsupported_content_type";
        } else {
          // status + elapsedMs feed the weakness probe (lib/site-weakness.js):
          // the SAME fetch that finds an email now also measures the site.
          return { ok: true, text: await response.text(), attempts: attempt, status: response.status, elapsedMs: Date.now() - started };
        }
      }
    } catch (error) {
      lastFailure = error.name === "AbortError" ? "timeout" : "fetch_error";
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  return { ok: false, text: "", attempts, failure: lastFailure, status: lastStatus, elapsedMs: Date.now() - started };
}

function extractEmail(html) {
  const found = new Set();
  for (const m of String(html || "").matchAll(/mailto:([^"'?\s<>]+)/gi)) {
    found.add(decodeURIComponent(m[1]).trim());
  }
  for (const m of String(html || "").matchAll(EMAIL_RE)) found.add(m[0].trim());
  return (
    [...found]
      .map((email) => email.replace(/[.,;)]+$/, "").toLowerCase())
      .filter((email) => EMAIL_VALIDATE.test(email) && !JUNK_EMAIL.test(email) && !PLATFORM_EMAIL.test(email) && !isPlaceholderEmail(email))[0] || null
  );
}

function placeName(place = {}) {
  return firstValue(place.displayName || {}, ["text"], firstValue(place, ["displayName", "name"], ""));
}

function scorePlace(place = {}, email) {
  let score = 40;
  if (!place.websiteUri) score += 25;
  // GHOST_AGENCY_REQUIRE_WEBSITE=true biases the machine toward businesses with
  // a real site on their profile - richer assets (logo, photos, brand colors)
  // make dramatically better previews. No-website leads stay minable but are
  // excluded from selection when the flag is on.
  if (email) score += 15;
  if (place.nationalPhoneNumber) score += 5;
  if (place.formattedAddress) score += 5;
  const reviewCount = Number(place.userRatingCount || 0);
  const rating = Number(place.rating || 0);
  // DEMAND, NOT OBSCURITY. This block used to pay +10 for a business with
  // FEWER than 50 reviews, which ranked the quietest operators in the metro
  // highest — the exact inverse of "a decent amount of reviews, let's say
  // above forty". A business nobody is calling cannot afford us and does not
  // prove the product works. The floor now RAISES the proven traders; it never
  // refuses anyone, so the thin ones still mine, they just sort below.
  const demand = demandRank(reviewCount, rating);
  score += { proven_demand: 14, above_floor: 10, unmeasured: 0, below_floor: 2 }[demand.band] || 0;
  if (rating >= 4.4) score += 5;
  // A 300+ review business is usually already well served — still minable,
  // still not refused, just nudged down the same way it always was.
  if (reviewCount > 300) score -= 10;
  return Math.min(99, Math.max(1, score));
}

/**
 * THE REVIEW FLOOR — A QUALIFIER, NOT A GATE.
 *
 * The owner: "If they have a website button available and a decent amount of
 * reviews, let's say above forty reviews, we then capture the website."
 *
 * Forty reviews is PROVEN DEMAND: a business with 40+ reviews is really
 * trading, really answering the phone, and can really afford $200/month. That
 * makes it the single best thing to SORT by.
 *
 * It is deliberately NOT a refusal, and this is the owner's philosophy applied
 * literally: "If we meet eighty percent of the criteria... that shouldn't break
 * the site from sending or being mirrored." A 22-review plumber with a dying
 * Wix site still needs a website; he is simply further down the list than the
 * 140-review one. Nothing is thrown away for missing the floor.
 *
 * Returns a band, highest first, so ordering is explainable in the console
 * rather than being an opaque number.
 */
const REVIEW_FLOOR = 40;

function demandRank(reviewCount, rating) {
  const n = Number(reviewCount);
  const r = Number(rating);
  if (!Number.isFinite(n) || n <= 0) {
    // UNMEASURED IS NOT ZERO. A business we never got a count for has not been
    // shown to lack demand — it sits above the ones we measured as thin, not
    // below them, and certainly is not refused.
    return { band: "unmeasured", rank: 2, reviewCount: null, meetsFloor: false, floor: REVIEW_FLOOR };
  }
  const meetsFloor = n >= REVIEW_FLOOR;
  // Above the floor AND well-rated is the sweet spot the owner described.
  if (meetsFloor && Number.isFinite(r) && r >= 4.0) return { band: "proven_demand", rank: 4, reviewCount: n, meetsFloor, floor: REVIEW_FLOOR };
  if (meetsFloor) return { band: "above_floor", rank: 3, reviewCount: n, meetsFloor, floor: REVIEW_FLOOR };
  return { band: "below_floor", rank: 1, reviewCount: n, meetsFloor, floor: REVIEW_FLOOR };
}

function builderFromUrl(url = "") {
  const value = String(url || "");
  if (/wix/i.test(value)) return "wix";
  if (/godaddy|secureserver/i.test(value)) return "godaddy";
  if (/weebly/i.test(value)) return "weebly";
  if (/squarespace/i.test(value)) return "squarespace";
  if (/wordpress\.com/i.test(value)) return "wordpress.com";
  if (/business\.site/i.test(value)) return "google business.site";
  return "";
}

function flatnessPlatform(builder = "") {
  const value = String(builder || "").trim().toLowerCase();
  if (/^wix(?:\.com|site)?$|wixsite|wix-code|_wixcss/i.test(value)) return "wix";
  if (/weebly/i.test(value)) return "weebly";
  if (/godaddy|secureserver/i.test(value)) return "godaddy";
  if (/squarespace/i.test(value)) return "squarespace-free";
  if (/wordpress\.com/i.test(value)) return "wordpress-free";
  if (/elementor|divi|wpbakery|visual composer/i.test(value)) return "wordpress";
  if (/site123|business\.site|webnode|jimdo|homestead|networksolutions|yolasite|tripod|angelfire|duda|bandzoogle/i.test(value)) {
    return "unknown-builder";
  }
  return value;
}

function measuredHtmlSignals(html, websiteUrl) {
  if (typeof html !== "string" || html.length === 0) return {};
  const internal = new Set();
  let base = null;
  try { base = new URL(websiteUrl); } catch { /* relative links cannot be classified without an origin */ }
  if (base) {
    const baseDomain = registrableDomain(base.hostname);
    for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      const href = String(match[1] || "").trim();
      if (!href || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      try {
        const target = new URL(href, base);
        if (!/^https?:$/i.test(target.protocol) || registrableDomain(target.hostname) !== baseDomain) continue;
        target.hash = "";
        internal.add(`${target.pathname || "/"}${target.search || ""}`);
      } catch { /* malformed href is not a measured internal link */ }
    }
  }
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => String(match[1] || ""));
  return {
    htmlBytes: Buffer.byteLength(html, "utf8"),
    internalLinks: base ? internal.size : undefined,
    hasServicePage: hrefs.some((href) => /(?:^|[/?#_-])(?:services?|what-we-do|our-work)(?:[/?#_.-]|$)/i.test(href)),
    hasVideo: /<video\b|(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|wistia\.(?:com|net))\//i.test(html),
  };
}

function websiteFlatness({ websiteUrl = "", gbpWebsiteUrl = "", html, probe } = {}) {
  const measured = measuredHtmlSignals(html, websiteUrl || gbpWebsiteUrl);
  const analyzedProbe = probe && typeof probe === "object" ? probe : {};
  const score = flatnessScore({
    platform: flatnessPlatform(analyzedProbe.builder || builderFromUrl(websiteUrl || gbpWebsiteUrl)),
    ...measured,
    hasSchema: typeof analyzedProbe.hasSchema === "boolean" ? analyzedProbe.hasSchema : undefined,
  });
  // Facebook gold requires the GBP website field. A search hit or an arbitrary
  // social link is not ownership evidence and cannot trigger the override.
  if (isFacebookSite(String(gbpWebsiteUrl || ""))) {
    return {
      flat: true,
      score: 100,
      signals: [...score.signals, "Google Business Profile website is a Facebook page"],
      facebookSite: true,
    };
  }
  return { ...score, facebookSite: false };
}

// ---------------------------------------------------------------------------
// THIN-TARGET SCORING (issue #689, owner doctrine 2026-09-04: thin/un-
// integrated sites are the BEST converts).
// ---------------------------------------------------------------------------
//
// The Austin campaign pulled LOA Roofing & Construction — a Top-100 gorgeous
// site — and that is the WRONG target class: a polished, fully integrated site
// has no wow left to sell. A site whose BUSINESS is verified but whose CURRENT
// homepage shows no Google reviews, no maps embed, no socials and no booking
// widget is the sweet spot, because the rebuild GIVES them those integrations
// as the headline feature.
//
// This detector is PURE and reads ONLY what stage 2 (2_homepage_fetch) already
// fetched: the homepage HTML, the weakness probe, the parsed page and the
// social links. Zero new network calls, zero new fetches of any kind.
//
// THE SIGNAL IS POSITIVE, NEVER A GATE (the thin-flow law, same doctrine):
// a missing integration is conversion UPSIDE. Nothing here refuses, blocks or
// downgrades a candidate — the flags ride the packet as provenance
// (qualification.integration_gap) and feed the RANKING preference, so
// campaigns surface thin targets instead of skipping anyone. Identity stays
// exactly what it was: business verified via first-party/Place evidence,
// completely independent of the site's integrations.
const REVIEW_WIDGET_MARK = /elfsight|trustindex|trustpilot|reviews\.io|reviewsonmywebsite|richplugins|shapo|judge\.me|yotpo|stamped\.io|birdeye|podium|broadly|nicejob|review[-_ ]?(?:widget|slider|carousel|badge)|google[^"'<>]{0,32}review[^"'<>]{0,32}(?:widget|embed)|(?:widget|embed)[^"'<>]{0,32}google[^"'<>]{0,32}reviews?/i;
const MAPS_EMBED_MARK = /google\.com\/maps\/embed|maps\.google(?:apis)?\.com\/maps|google\.com\/maps\?[^"'<>]*output=embed|maps\.google\.com\/maps\?/i;
const BOOKING_WIDGET_MARK = /calendly|acuityscheduling|squareup\.com\/appointments|square\.site\/book|booksy|schedulicity|setmore|simplybook|vagaro|mindbodyonline|housecallpro|servicetitan|launch27|appointy|bookingkit|goschedule/i;

// schema carries NO preference weight on purpose: a homepage with no
// structured data cannot prove first-party identity, so ranking it up would
// spend deep-verification pool slots on candidates stage 6 then refuses. The
// schema gap is still RECORDED in gaps[] for provenance — it is simply not
// conversion upside this pipeline can act on.
const INTEGRATION_GAP_WEIGHTS = Object.freeze({
  reviews: 35, // the headline pitch (#689): their Google reviews exist, the site never showed them
  booking: 20,
  maps: 15,
  socials: 15,
  schema: 0,
});

function integrationGapFromHomepage({ html = "", probe = null, parsed = null, social = null, ownedProfiles = null } = {}) {
  const body = String(html || "");
  if (!body) return { gap: false, gaps: [], score: 0, signals: [], measured: false };

  const gaps = [];
  const signals = [];

  // REVIEWS — the gap the outreach line sells. "Never showed" is only claimed
  // when BOTH a third-party/Google review widget AND any review or testimonial
  // content are absent from the fetched homepage. The signal text is
  // deliberately provider-neutral: a first-party record carries no Google
  // observer string anywhere (test/places-optional-mining pins that law), and
  // the pitch's "Google reviews" wording lives only in the send-time email.
  const reviewWidget = REVIEW_WIDGET_MARK.test(body);
  if (!reviewWidget && !(probe && probe.hasReviews === true)) {
    gaps.push("reviews");
    signals.push("no reviews or review widget shown on the homepage");
  }

  if (!MAPS_EMBED_MARK.test(body)) {
    gaps.push("maps");
    signals.push("no maps embed on the homepage");
  }

  const socialLinkCount = Math.max(
    Object.keys(social || {}).length,
    Array.isArray(ownedProfiles) ? ownedProfiles.length : 0,
  );
  if (socialLinkCount === 0) {
    gaps.push("socials");
    signals.push("no social profile links on the homepage");
  }

  if (!probe || probe.hasSchema === false) {
    gaps.push("schema");
    signals.push("no structured data on the homepage");
  }

  if (!BOOKING_WIDGET_MARK.test(body)) {
    gaps.push("booking");
    signals.push("no online booking or scheduling widget on the homepage");
  }

  let score = gaps.reduce((sum, gapName) => sum + (INTEGRATION_GAP_WEIGHTS[gapName] || 0), 0);

  // SITE SOPHISTICATION — the polish penalty. A highly polished site is the
  // wrong target class even when an integration is missing, so a measured
  // modern-premium site caps the upside at a token and a modern framework
  // stack halves it. This DOWNWEIGHTS a positive signal; it never refuses
  // anyone and never touches a quality verdict.
  if (probe && probe.modernPremium === true) {
    score = Math.min(score, 10);
    signals.push("already-modern premium site — polished, weak thin-target upside");
  } else if (parsed && parsed.modernStack) {
    score = Math.round(score / 2);
    signals.push("modern framework stack detected — polish halves the thin-target score");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { gap: gaps.length > 0, gaps, score, signals, measured: true };
}

// HEAVY-TARGET ADMISSION CAP (#689 doctrine, owner directive 2026-09-03). The
// #694 ranking only ORDERS survivors; once a market's thin pool exhausts, the
// build pool still admitted heavy polished sites to fill the requested count
// — exactly the LOA-class roofing site the owner rejected as "too heavy of a
// site" to rebuild. Polish is the complement of the measured integration-gap
// score: a fully integrated homepage measures 100, the rejected LOA-class
// heavyweight measures 100 (or 90 under the modern-premium cap), and a basic
// un-integrated contractor site measures 15-30. A candidate whose polish
// exceeds TARGET_MAX_POLISH (lib/line-quota.js; default 75, literal 0 =
// disabled) is skipped at admission with the reason recorded on the
// 2_homepage_fetch funnel stage — never silent. This is TARGET SELECTION, not
// a build quality ceiling, so it does not touch the thin-flow law: the
// zone-flood "record never refuse" doctrine governs OUR build ceilings, while
// target admission MAY skip with a recorded reason. UNMEASURED rows score 0
// polish — assumed absent, never assumed present (the same law
// rankingFacts obeys), so an unmeasured candidate never trips the cap.
const TARGET_POLISH_SKIP_REASON = "target_too_polished:skip";
function targetPolishScore(integrationGap) {
  if (!integrationGap || integrationGap.measured !== true) return 0;
  const gapScore = Math.max(0, Math.min(100, Math.trunc(Number(integrationGap.score) || 0)));
  return 100 - gapScore;
}
function polishAdmissionVerdict(integrationGap, environment = process.env) {
  const ceiling = targetMaxPolish(environment);
  if (!Number.isFinite(ceiling) || ceiling <= 0) return null;
  const polish = targetPolishScore(integrationGap);
  if (polish <= ceiling) return null;
  return { reason: TARGET_POLISH_SKIP_REASON, polish, ceiling };
}

function rankingFacts(candidate = {}) {
  const record = candidate.record && typeof candidate.record === "object" ? candidate.record : {};
  const qualification = candidate.qualification && typeof candidate.qualification === "object"
    ? candidate.qualification
    : (record.build_ready && typeof record.build_ready === "object"
      && record.build_ready.qualification && typeof record.build_ready.qualification === "object"
      ? record.build_ready.qualification
      : {});
  const facts = candidate.mirror_request && candidate.mirror_request.facts
    ? candidate.mirror_request.facts
    : {};
  return {
    flatness: candidate.website_flatness || record.website_flatness,
    // THIN-TARGET PREFERENCE (issue #689): the measured integration-gap score
    // joins the ranking facts. Unmeasured rows score 0 — assumed absent, never
    // assumed present.
    integrationGap: Math.max(0, Math.trunc(Number(qualification.integration_gap && qualification.integration_gap.score) || 0)),
    rating: facts.rating ?? record.rating ?? candidate.rating,
    reviewCount: facts.review_count ?? record.review_count ?? candidate.reviewCount,
  };
}

function rankFlatSiteCandidates(candidates = [], env = process.env) {
  if (!Array.isArray(candidates)) return [];
  if (!flatSiteFirstEnabled(env)) return candidates.slice();
  const ranked = rankCandidates(candidates.map((candidate) => ({ candidate, ...rankingFacts(candidate) })))
    .map((entry) => entry.candidate);
  // The frozen ranker promises ordering only. Keep that safety law local too:
  // an unexpected contract drift falls back to the untouched input, never loss.
  return ranked.length === candidates.length ? ranked : candidates.slice();
}

function opportunityInputFromRow(row = {}) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  const truth = record.truth_packet && typeof record.truth_packet === "object" ? record.truth_packet : {};
  const opportunities = Array.isArray(truth.opportunities) ? truth.opportunities.map((item) => item.type || item.headline || "") : [];
  const website = row.current_website || record.current_website || "";

  // The MEASURED website probe (lib/site-weakness.js), captured at mine time
  // from the same fetch that looks for an email. This is the whole fix: the
  // opportunity model's weakness axis now sees real HTTP status, mobile
  // viewport, thinness, builder, load time and age instead of a hardcoded
  // status:200 that pinned weakness near its floor and flattened the ranking.
  const probe = record.website_probe && typeof record.website_probe === "object" ? record.website_probe : null;

  const websiteInput = probe
    ? {
      exists: probe.exists,
      status: probe.status,
      https: probe.https,
      mobile: probe.mobile,
      thin: probe.thin,
      hasSchema: probe.hasSchema,
      hasReviews: probe.hasReviews,
      builder: probe.builder || "",
      loadMs: probe.loadMs,
      ageYears: probe.ageYears,
      modernPremium: probe.modernPremium,
    }
    : {
      // Legacy rows mined before the probe existed: fall back to the old
      // truth-packet heuristics, but NEVER fabricate status:200 — an unknown
      // site is unknown, so weaknessScore uses its own floor rather than a
      // false "healthy" signal.
      exists: Boolean(website),
      status: null,
      https: website ? /^https:\/\//i.test(website) : false,
      thin: opportunities.includes("thin_copy"),
      hasSchema: !opportunities.includes("no_schema"),
      hasReviews: !opportunities.includes("no_reviews"),
      builder: builderFromUrl(website),
      modernPremium: false,
    };

  // runningAds: a real signal when we can see it (gtag/adwords/fbq/utm on the
  // scraped page, or an explicit truth-packet flag), not a hardcoded false
  // that silently killed the affordability boost for businesses that
  // demonstrably pay to be found.
  const runningAds = Boolean(
    record.running_ads
    || (probe && probe.runningAds)
    || opportunities.includes("running_ads"),
  );

  // The stored contact email, or "". A placeholder ("your@email.com",
  // "name@email.com") is a scrape artifact that would bounce — it counts as NO
  // email, so the lead is scored uncontactable and routed to call_or_sms rather
  // than the email send pool.
  const rawEmail = String(row.email || row.owner_email || record.email || record.owner_email || "").trim();
  return {
    name: row.business_name || record.business_name || "",
    place_id: record.place_id || row.place_id || "",
    address: record.address || row.address || "",
    category: row.industry || record.industry || record.primary_type || "",
    rating: record.rating || row.rating || 0,
    reviewCount: record.review_count || row.review_count || 0,
    reviewRecencyDays: record.review_recency_days ?? null,
    hasEmail: Boolean(rawEmail) && !isPlaceholderEmail(rawEmail),
    // Claimed only on evidence of a real Google observation — a first-party
    // record has no place_id and asserts nothing about GBP.
    gbpClaimed: Boolean(record.place_id || row.place_id)
      || (record.build_ready && record.build_ready.identity_source === "google_places"),
    runningAds,
    serviceAreaCount: Array.isArray(record.service_area) ? record.service_area.length : (record.service_area_count || 0),
    website: websiteInput,
  };
}

function prospectIdForPlace(place = {}) {
  if (place.id) return slugify(`place-${place.id}`, "place-lead");
  return slugify(`${placeName(place)}-${place.formattedAddress || ""}`, "places-lead");
}

async function mapLimit(items, limit, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ONE breaker per process for the discovery lane. Module-level on purpose: a
// provider outage is a property of the PROVIDER, not of one mine.run, so three
// separate console clicks must share the same failure count and the third must
// fail fast instead of hanging again.
const discoveryBreaker = new CircuitBreaker();

/** What the miner card renders for provider health. */
function discoveryStatus() { return discoveryBreaker.status(); }

// IDENTITY FIELDS ONLY — the whole allowed mask for every searchText call.
// COST DIRECTIVE 2026-08-25: reviews, rating, userRatingCount, hours,
// editorialSummary and photos are the expensive tiers and identity needs none
// of them; they are banned from every identity lookup. Downstream shaping is
// kept for observations that already carry them (webhook packets, stored
// rows); a live response is honestly absent instead.
const PLACES_IDENTITY_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.businessStatus",
  "places.primaryType",
  "places.types",
  "places.addressComponents",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

async function searchPlacesPage({ key, textQuery, pageSize, pageToken, fetchImpl, breaker = discoveryBreaker, retries, signal }) {
  const body = { textQuery, pageSize };
  if (pageToken) body.pageToken = pageToken;
  const call = await callProvider({
    url: "https://places.googleapis.com/v1/places:searchText",
    fetchImpl,
    breaker,
    retries,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": PLACES_IDENTITY_FIELD_MASK,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    },
  });

  if (!call.ok) {
    // NAMED, not generic. "discovery provider unavailable — 503" is actionable;
    // "Error: timeout" sent the operator hunting through miner logic that was
    // working perfectly the whole time.
    const mode = call.mode === "quota" ? "quota_exceeded"
      : call.mode === "breaker_open" ? "provider_down"
        : (call.mode === "unavailable" || call.mode === "timeout" || call.mode === "network") ? "provider_unavailable"
          : "places_error";
    return {
      ok: false,
      mode,
      status: call.status,
      error: call.error,
      // The provider's OWN sentence, e.g. "PERMISSION_DENIED/
      // API_KEY_HTTP_REFERRER_BLOCKED: Requests from referer <empty> are
      // blocked." Without it a refusal reads "places_error" and the operator
      // has nothing to act on — which is why this failure went undiagnosed.
      fault: call.fault || null,
      attempts: call.attempts,
      // Real HTTP requests dispatched for this page. 0 when the breaker
      // short-circuited: the cost ledger must not bill a call never made.
      httpCalls: call.attempts || 0,
      countedAgainstProvider: Boolean(call.countedAgainstProvider),
      provider: "google_places_searchtext",
      providerHealth: call.breaker,
      detail: call.json,
    };
  }
  const json = call.json || {};
  return {
    ok: true,
    places: Array.isArray(json.places) ? json.places : [],
    nextPageToken: json.nextPageToken || null,
    attempts: call.attempts,
    httpCalls: call.attempts || 0,
    providerHealth: call.breaker,
  };
}

/**
 * How many result pages to walk past before we start collecting.
 *
 * THE OWNER'S THESIS, verbatim: "You then start at page five or six instead of
 * the first page, so we automatically are starting a lower run of customer."
 *
 * Page one of a Google search for "plumbers in Indianapolis" is the businesses
 * who are ALREADY WINNING — they have the agency, the SEO budget and the site.
 * They are the least likely to buy a website from us and the most likely to
 * make us look small. The businesses at page five have the reviews and the
 * demand and a site built in 2011, and they are the whole market.
 *
 * COST IS REAL AND IS NOT HIDDEN. Places has no offset parameter: the only way
 * to reach page 5 is to request pages 1-4 and throw them away, so a start page
 * of 4 means four extra billed SearchText calls PER QUERY. Those calls are
 * counted in `pagesSkipped`/`httpCalls` and reported, never quietly absorbed —
 * a skipped page still costs money and the ledger must say so.
 *
 * Default 0 keeps today's behaviour until the owner turns it on, which is the
 * honest default for a change that costs money per run.
 */
function discoveryStartPage(env = process.env) {
  return numberInRange(env.GHOST_AGENCY_MINER_START_PAGE, 0, 0, 8);
}

async function searchPlaces({ key, textQuery, limit, startPage = discoveryStartPage(), pages, fetchImpl, breaker = discoveryBreaker, retries, signal }) {
  const places = [];
  let pageToken = null;
  let page = 0;
  let httpCalls = 0;
  let pagesSkipped = 0;
  const pagesWalked = [];
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, limit));
  const skip = Math.max(0, Math.trunc(Number(startPage) || 0));
  const wanted = Math.ceil(limit / pageSize);
  const plannedPages = Array.isArray(pages)
    ? [...new Set(pages.map((value) => Math.trunc(Number(value))).filter((value) => value >= 1 && value <= 4))]
    : null;
  const selectedPages = plannedPages ? new Set(plannedPages.filter((value) => value <= wanted)) : null;

  while (places.length < limit && page < skip + wanted) {
    const result = await searchPlacesPage({ key, textQuery, pageSize, pageToken, fetchImpl, breaker, retries, signal });
    httpCalls += Number.isFinite(result.httpCalls) ? result.httpCalls : 0;
    pagesWalked.push(page + 1);
    if (!result.ok) return { ...result, places, httpCalls, pagesSkipped, pagesWalked, plannedPages };
    // Pages before the start line are PAID FOR AND DISCARDED. That is the
    // whole mechanism, and it is the reason the default is 0.
    const relativePage = page - skip + 1;
    if (page >= skip && (!selectedPages || selectedPages.has(relativePage))) places.push(...result.places);
    else pagesSkipped++;
    pageToken = result.nextPageToken;
    page++;
    // Running out of pages before reaching the start line is not an error — a
    // thin market simply has no page five. It yields fewer leads, honestly,
    // rather than silently falling back to the page-one businesses we were
    // deliberately trying to skip.
    if (!pageToken) break;
  }

  return { ok: true, mode: "live", places: places.slice(0, limit), httpCalls, pagesSkipped, pagesWalked, plannedPages, startPage: skip };
}

async function enrichPlaces(places, timeoutMs) {
  return mapLimit(places, numberInRange(process.env.GHOST_AGENCY_MINER_ENRICH_CONCURRENCY, 5, 1, 12), async (place) => {
    let email = null;
    let websiteFetch = null;
    if (place.websiteUri) {
      websiteFetch = await fetchText(place.websiteUri, timeoutMs);
      if (websiteFetch.text) email = extractEmail(websiteFetch.text);
    }
    // The weakness probe rides the fetch we already paid for. This is what
    // makes the opportunity model's weakness axis REAL instead of the
    // hardcoded status:200 that flattened every ranking before.
    const websiteProbe = analyzeWebsite({
      url: place.websiteUri || "",
      status: websiteFetch ? websiteFetch.status : null,
      html: websiteFetch ? websiteFetch.text : "",
      elapsedMs: websiteFetch ? websiteFetch.elapsedMs : null,
      ok: websiteFetch ? websiteFetch.ok : null,
      failure: websiteFetch ? websiteFetch.failure : null,
    });
    const flatness = websiteFlatness({
      websiteUrl: place.websiteUri || "",
      // In the legacy lane this URL came directly from Places, so it is valid
      // GBP evidence for the Facebook override.
      gbpWebsiteUrl: place.websiteUri || "",
      html: websiteFetch && websiteFetch.ok ? websiteFetch.text : undefined,
      probe: websiteProbe,
    });
    return {
      place,
      email,
      websiteProbe,
      websiteFlatness: flatness,
      reviewRecency: reviewRecencyDays(place.reviews),
      enrichmentStatus: email
        ? "email_found"
        : place.websiteUri
          ? websiteFetch?.ok
            ? "no_public_email_found"
            : "site_fetch_failed_after_retries"
          : "no_website_to_enrich",
      enrichmentAttempts: websiteFetch?.attempts || 0,
      enrichmentFailure: websiteFetch?.failure || null,
    };
  });
}

// Places (New) returns the postal code only nested inside addressComponents, and
// hours as a structured object. Both are flattened here so the stored record
// carries render-ready values and nothing downstream needs to know Google's shape.
function postalFromComponents(components) {
  if (!Array.isArray(components)) return null;
  const hit = components.find((c) => Array.isArray(c && c.types) && c.types.includes("postal_code"));
  return (hit && (hit.longText || hit.shortText)) || null;
}

// Google supplies weekdayDescriptions like "Monday: 7:00 AM - 5:00 PM". We keep
// those verbatim rather than re-deriving a schema.org-style range, because a
// re-derivation is a chance for the marked-up hours and the displayed hours to
// disagree — and a structured-data/DOM mismatch is exactly what gets penalised.
function openingHoursFrom(regular) {
  if (!regular || !Array.isArray(regular.weekdayDescriptions)) return [];
  return regular.weekdayDescriptions.filter(Boolean);
}

/**
 * Google's own review text, attributed — the only review source that is not
 * the business talking about itself. The identity mask no longer requests
 * reviews, so live lookups arrive without them; this shaper remains for
 * observations that already carry them. Absent input shapes to an absent key.
 *
 * Shape matches what mirror-lane-build reads: text, author, rating, the
 * reviewer's own photo, and the publish time.
 */
function reviewsFromPlace(place = {}) {
  return (Array.isArray(place.reviews) ? place.reviews : [])
    .map((r) => {
      const text = (r && r.text && typeof r.text === "object" ? r.text.text : r && r.text) || "";
      const author = (r && r.authorAttribution && r.authorAttribution.displayName) || "";
      const photo = (r && r.authorAttribution && r.authorAttribution.photoUri) || "";
      const rating = Number(r && r.rating);
      return {
        text: String(text).trim(),
        ...(author ? { author: String(author).trim() } : {}),
        ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
        // Google serves reviewer photos from its own CDN; the URL travels
        // verbatim and is never re-hosted (see content-inject's face rail).
        //
        // A bare /^https:\/\// test was NOT the rule the renderer applies, and
        // the disagreement mattered: Google answers with a generated
        // initial-tile (/a/ACg8oc…) for most reviewers, this stored it as a
        // face, and the builder then silently dropped it — so the contract
        // claimed faces the page could never show. One rule now, in
        // lib/verified-trust-lookup.js, so the two cannot drift.
        ...(isGoogleReviewerFace(photo) ? { author_photo_url: photo } : {}),
        ...(r && r.publishTime ? { published_at: String(r.publishTime) } : {}),
      };
    })
    .filter((r) => r.text)
    .slice(0, 5);
}

async function rowFromPlace({ place, email, query, enrichmentStatus, enrichmentAttempts, enrichmentFailure, websiteProbe, websiteFlatness: flatness, reviewRecency }) {
  const businessName = placeName(place);
  const prospectId = prospectIdForPlace(place);
  const score = scorePlace(place, email);
  const location = normalizeUsLocation({
    location: query.location,
    address: place.formattedAddress || "",
  });
  const serviceHints = publicServiceNames(
    [place.primaryType, ...(Array.isArray(place.types) ? place.types : [])],
    query.industry,
  );
  const coordinates = place.location && Number.isFinite(Number(place.location.latitude)) && Number.isFinite(Number(place.location.longitude))
    ? { lat: Number(place.location.latitude), lng: Number(place.location.longitude) }
    : null;
  const placeReviews = reviewsFromPlace(place);
  const measuredFlatness = flatness || websiteFlatness({
    websiteUrl: place.websiteUri || "",
    gbpWebsiteUrl: place.websiteUri || "",
    probe: websiteProbe,
  });
  const truthPacket = buildBusinessTruthPacket({
    source: "places_basic",
    profile: {
      business_name: businessName,
      industry: query.industry || place.primaryType || "local service",
      city: location.city,
      state: location.state,
      phone: place.nationalPhoneNumber || "",
      address: place.formattedAddress || "",
    },
    found: {
      contact: {
        phone: place.nationalPhoneNumber || "",
        address: place.formattedAddress || "",
      },
      services: serviceHints.length ? serviceHints : [query.industry].filter(Boolean),
      seo_gaps: !place.websiteUri
        ? ["no structured data detected", "no FAQ surface for AI answer engines", "no visible review proof"]
        : ["no visible review proof"],
      missingWebsite: !place.websiteUri,
      photos: [],
      reviews: placeReviews,
    },
    gbp: {
      name: businessName,
      phone: place.nationalPhoneNumber || "",
      address: place.formattedAddress || "",
      rating: place.rating || null,
      review_count: place.userRatingCount || null,
      reviews: placeReviews,
      latlng: coordinates,
    },
  });
  const contactEnrichment = enrichContactEvidence({
    sources: {
      gbp: {
        source_url: place.id ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.id)}` : null,
        phone: place.nationalPhoneNumber || null,
        confidence: 0.88,
      },
      website: place.websiteUri && email ? {
        source_url: place.websiteUri,
        email,
        confidence: 0.8,
        email_reachable: null,
      } : null,
    },
  });
  const record = {
    prospect_id: prospectId,
    place_id: place.id || null,
    // Scrapeable Google Business Profile link (no-website lane, Mark 2026-07-20):
    // durably persisted so SiteForge can source real first-party GBP photos for
    // a business that has no website. Derived from the place id we already have.
    gbp_url: place.id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}` : null,
    business_name: businessName,
    email,
    phone: place.nationalPhoneNumber || null,
    current_website: place.websiteUri || null,
    address: place.formattedAddress || null,
    latlng: coordinates,
    latitude: coordinates?.lat ?? null,
    longitude: coordinates?.lng ?? null,
    rating: place.rating || null,
    review_count: place.userRatingCount || null,
    // ADDED 2026-07-31 alongside the widened field mask. The gap audit measured
    // postal code, opening hours and photos at 0% across 40 prospects, so the
    // preview rendered those regions empty for EVERY prospect — not because the
    // data was lost, because it was never asked for. All three land in the
    // JSON-LD (postalCode, openingHours, image) and the visible NAP.
    postal: postalFromComponents(place.addressComponents),
    hours: openingHoursFrom(place.regularOpeningHours),
    // Persisted on the record as well as in the packet: the resolver build path
    // reads the record, the packet path reads the packet, and both must produce
    // the same site.
    reviews: placeReviews,
    photos: Array.isArray(place.photos)
      ? place.photos.map((p) => p && p.name).filter(Boolean).slice(0, 12)
      : [],
    maps_uri: place.googleMapsUri || null,
    primary_type: place.primaryType || null,
    types: place.types || [],
    city: location.city,
    state: location.state,
    industry: query.industry,
    text_query: query.textQuery,
    leadminer_score: score,
    // MEASURED site weakness + review recency: the evidence the opportunity
    // model consumes, persisted so a re
    enrichment_attempts: enrichmentAttempts || 0,
    enrichment_failure: enrichmentFailure || null,
    contact_enrichment: contactEnrichment,
    outreach_review_hold: contactEnrichment.outreach.review_hold,
    outreach_hold_reasons: contactEnrichment.outreach.hold_reasons,
    truth_packet: truthPacket,
    truth_packet_source: "places_basic",
    // Measured website weakness + review recency, persisted so the opportunity
    // scorer reads real signals rather than fabricated ones.
    website_probe: websiteProbe || null,
    website_flatness: measuredFlatness,
    flat_site: Boolean(measuredFlatness.flat),
    review_recency_days: reviewRecency ?? null,
    source: "places-live-mine",
  };
  // GBP PHOTO ENRICHMENT — resolve resource names the Places mine already put
  // on the record into a durable photo bank so the hero and build lanes do not
  // need to hit the Places API again. Fail soft: if place_id is missing or the
  // call throws, record.photo_bank is simply absent and the build lane falls
  // back to its existing crawl path.
  try {
    const gbpBank = await photoBank.enrichGbpPhotos(record, {
      placesApiKey: process.env.GOOGLE_PLACES_API_KEY || "",
    });
    if (gbpBank && gbpBank.photos.length) record.photo_bank = gbpBank;
  } catch (_) { /* enrichment is best-effort */ }
  return {
    prospect_id: prospectId,
    status: "new",
    business_name: businessName,
    email: email || null,
    owner_email: contactEnrichment.recommended_fields.owner_email,
    phone: place.nationalPhoneNumber || null,
    current_website: place.websiteUri || null,
    industry: query.industry,
    city: location.city,
    state: location.state,
    leadminer_score: score,
    source: "places-live-mine",
    record,
    updated_at: new Date().toISOString(),
  };
}

function existingProspectRows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

// The identity pass used to download as many as 5,000 complete prospect
// records. Photo banks, build contracts, proof shots and reports made that read
// large enough to hit the store's eight-second ceiling before persistence even
// began. These are the only fields canonicalIdentity() and
// resolveCanonicalMatch() need. JSON scalars are projected as top-level aliases
// so legacy rows remain matchable without transferring the rest of `record`.
const PROSPECT_IDENTITY_INDEX_SELECT = [
  "prospect_id",
  "status",
  "business_name",
  "phone",
  "current_website",
  "city",
  "state",
  "canonical_domain",
  "canonical_phone",
  "canonical_name_address",
  "canonical_place_id",
  "canonical_prospect_id",
  "merged_into_prospect_id",
  "place_id:record->>place_id",
  "address:record->>address",
  "postal_code:record->>postal_code",
].join(",");

function prospectIdentityIndexRead() {
  return {
    select: PROSPECT_IDENTITY_INDEX_SELECT,
    order: "updated_at.desc",
    limit: 5000,
  };
}

function hasCompleteProspectRecord(row) {
  return Boolean(
    row
    && Object.prototype.hasOwnProperty.call(row, "record")
    && row.record
    && typeof row.record === "object"
    && !Array.isArray(row.record),
  );
}

function exactProspectRows(result) {
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

async function hydrateIdentityMatch(match, selectImpl = select) {
  if (!match) return { ok: false, row: null };
  // Unit callers and older adapters may already supply the complete row. Do
  // not add a provider call in that case.
  if (hasCompleteProspectRecord(match)) return { ok: true, row: match, hydrated: false };
  const prospectId = String(match.prospect_id || "").trim();
  if (!prospectId) return { ok: false, row: null };
  let exact;
  try {
    exact = await selectImpl(
      "ghost_agency_prospects",
      `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    );
  } catch {
    return { ok: false, row: null };
  }
  if (!exact || (exact.ok !== true && exact.mode !== "live_select")) {
    return { ok: false, row: null };
  }
  const row = exactProspectRows(exact)[0];
  if (!row || !hasCompleteProspectRecord(row)) return { ok: false, row: null };
  // Replace, rather than overlay, the projection. JSON aliases such as
  // `place_id` do not exist as columns on select=*; if the exact row no longer
  // carries one, Object.assign alone would retain the stale projected alias and
  // could make the post-hydration identity check pass incorrectly.
  for (const key of Object.keys(match)) delete match[key];
  Object.assign(match, row);
  return { ok: true, row: match, hydrated: true };
}

function canonicalIdentityForMatch(prospect = {}) {
  const flat = { ...prospect, ...(prospect.record || {}) };
  const derived = canonicalIdentity(flat);
  const storedPlaceId = String(prospect.canonical_place_id || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 240);
  const storedDomain = canonicalIdentity({ current_website: prospect.canonical_domain }).domain;
  const storedPhone = canonicalIdentity({ phone: prospect.canonical_phone }).phone;
  const storedNameAddress = String(prospect.canonical_name_address || "").trim();
  const storedKeys = [
    storedPlaceId ? `place:${storedPlaceId}` : "",
    storedDomain ? `domain:${storedDomain}` : "",
    storedPhone ? `phone:${storedPhone}` : "",
    storedNameAddress && storedNameAddress.includes("|") ? `name_address:${storedNameAddress}` : "",
  ].filter(Boolean);
  const keys = [...new Set([...derived.keys, ...storedKeys])];
  return { ...derived, keys, canonicalKey: keys[0] || "" };
}

function canonicalOwnerId(row) {
  return String(
    row?.merged_into_prospect_id
    || row?.canonical_prospect_id
    || row?.prospect_id
    || "",
  ).trim();
}

async function hydratedIdentityResolutionIsCurrent(resolution, survivor, incoming, selectImpl) {
  const survivorId = String(survivor?.prospect_id || "").trim();
  if (!survivorId || canonicalOwnerId(survivor) !== survivorId) return false;
  // An incoming row may legitimately match a merged alias whose canonical
  // survivor does not repeat that alias key. Revalidate an exact matching
  // witness and its pointer, rather than requiring the survivor itself to own
  // every historical key.
  for (const witness of resolution.matches || []) {
    let exactWitness = survivor;
    if (String(witness?.prospect_id || "").trim() !== survivorId) {
      const hydration = await hydrateIdentityMatch(witness, selectImpl);
      if (!hydration.ok) continue;
      exactWitness = hydration.row;
    }
    if (canonicalOwnerId(exactWitness) !== survivorId) continue;
    if (matchCanonicalIdentity(
      canonicalIdentityForMatch(exactWitness),
      canonicalIdentityForMatch(incoming),
    ).matched) return true;
  }
  return false;
}

function resolveCanonicalMatch(existing, incoming) {
  const incomingIdentity = canonicalIdentityForMatch(incoming);
  const matches = existing.filter((candidate) => matchCanonicalIdentity(
      canonicalIdentityForMatch(candidate),
      incomingIdentity,
    ).matched);
  if (!matches.length) return { match: null, conflict: false, matches: [] };
  const canonicalIds = [...new Set(matches.map((candidate) =>
    candidate.merged_into_prospect_id || candidate.canonical_prospect_id || candidate.prospect_id,
  ).filter(Boolean))];
  if (canonicalIds.length !== 1) return { match: null, conflict: true, matches, canonicalIds };
  const canonicalId = canonicalIds[0];
  const survivor = existing.find((candidate) => candidate.prospect_id === canonicalId && !candidate.merged_into_prospect_id)
    || matches.find((candidate) => candidate.prospect_id === canonicalId && !candidate.merged_into_prospect_id);
  if (!survivor) return { match: null, conflict: true, matches, canonicalIds };
  return { match: survivor, conflict: false, matches, canonicalIds };
}

// These identity facts live inside `ghost_agency_prospects.record`; production
// has never exposed them as top-level PostgREST columns. mergeSafePlan still
// treats them as protected facts, so keep filling the durable JSON record while
// preventing a matched-row merge from promoting them into an invalid column.
const PROSPECT_RECORD_ONLY_MERGE_FIELDS = new Set(["address", "postal", "postal_code"]);

function topLevelProspectMergeFields(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(
    ([field]) => !PROSPECT_RECORD_ONLY_MERGE_FIELDS.has(field),
  ));
}

function recordOnlyProspectMergeFields(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(
    ([field]) => PROSPECT_RECORD_ONLY_MERGE_FIELDS.has(field),
  ));
}

function mergeIncomingSafely(existing, incoming) {
  const existingFlat = { ...existing, ...(existing.record || {}) };
  const incomingFlat = { ...incoming, ...(incoming.record || {}) };
  const plan = mergeSafePlan(existingFlat, incomingFlat);
  const patch = plan.patch;
  const topLevelExisting = topLevelProspectMergeFields(existing);
  const topLevelPatch = topLevelProspectMergeFields(patch);
  const existingRecord = existing.record && typeof existing.record === "object" ? existing.record : {};
  const incomingRecordOnly = recordOnlyProspectMergeFields(incoming.record || {});
  const recordOnlyFill = Object.fromEntries(Object.entries(incomingRecordOnly).filter(([field, value]) => {
    const current = existingRecord[field];
    return (current === null || current === undefined || String(current).trim() === "")
      && value !== null && value !== undefined && String(value).trim() !== "";
  }));
  const incomingBuildReady = incoming.record && typeof incoming.record.build_ready === "object"
    ? incoming.record.build_ready
    : null;
  return {
    plan,
    changed: Object.keys(patch).length > 0
      || Object.keys(recordOnlyFill).length > 0
      || Boolean(incomingBuildReady),
    row: {
      ...topLevelExisting,
      ...topLevelPatch,
      prospect_id: existing.prospect_id,
      record: {
        ...existingRecord,
        ...recordOnlyFill,
        ...Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "prospect_id")),
        identity_aliases: plan.aliases,
        identity_conflicts: plan.conflicts,
        ...(incomingBuildReady
          ? { build_ready: incomingBuildReady }
          : { last_mine_observation: incoming.record }),
      },
      updated_at: new Date().toISOString(),
    },
  };
}

function sportVerticalHold(row = {}) {
  return String(row.status || "").toLowerCase() === "held"
    && String(row.record?.blocked_reason || "") === "vertical_mismatch_sport_fencing";
}

// A first-party candidate quarantined at identity: unverifiable evidence or a
// cross-owner redirect. Held for a human, never scored, never merged over an
// existing row, never in the send pool.
function identityUnverifiedHold(row = {}) {
  return String(row.status || "").toLowerCase() === "held"
    && /^identity_(unverified_first_party|cross_owner_redirect)$/.test(String(row.record?.blocked_reason || ""));
}

/** Every mined quarantine kind. One predicate so a new hold cannot silently
 * fall into the opportunity-scored, sendable path. */
function minedQuarantineHold(row = {}) {
  return sportVerticalHold(row) || identityUnverifiedHold(row);
}

function canApplySportVerticalHold(row = {}) {
  const rec = row.record && typeof row.record === "object" ? row.record : {};
  const statuses = [row.status, rec.status].map((value) => String(value || "").toLowerCase()).filter(Boolean);
  const contactTerminal = new Set(["sent", "delivered", "contacted", "replied", "converted", "paid", "opted_out", "unsubscribed", "do_not_contact", "bounced", "complained", "archived", "archived_legacy"]);
  if (statuses.some((status) => contactTerminal.has(status))) return false;
  if (statuses.some((value) => new Set(["previewed", "built", "ready"]).has(value))) return false;
  // Current queue state is authoritative. Historical send/delivery/contact
  // timestamps remain in the row for audit but do not exempt a current queued
  // mismatch. Current terminal STATUS values above still block mutation.
  if (statuses.includes("line_queued")) return true;
  if ([row.sent_at, row.email_sent_at, row.contacted_at, row.last_contacted_at, row.delivered_at, rec.sent_at, rec.email_sent_at, rec.contacted_at, rec.last_contacted_at, rec.delivered_at]
    .some((value) => String(value || "").trim())) return false;
  const preview = row.preview_url || rec.preview_url || rec.urls?.preview_url || rec.build_ready?.preview_url;
  if (String(preview || "").trim()) return false;
  return statuses.some((status) => ["held", "new", "queued"].includes(status));
}

async function applyOpportunityScoring(rows = [], count = rows.length) {
  const { scoreLead, selectTop } = await opportunityModule();
  // GHOST_AGENCY_REQUIRE_WEBSITE=true: only select businesses whose Google
  // profile links a real website - richer intake assets (logo, photos, brand
  // colors) produce dramatically better previews.
  const requireSite = /^(1|true|yes|on)$/i.test(String(process.env.GHOST_AGENCY_REQUIRE_WEBSITE || "").trim());
  const sitePool = requireSite ? rows.filter((r) => r.current_website || (r.record && r.record.current_website) || r.websiteUri) : rows;

  // Legacy rollback only: before the flat-site decree, modernPremium was a
  // build-qualification veto. It remains measurable but is no longer a gate in
  // the default flow; GHOST_AGENCY_FLAT_SITE_FIRST=0 restores that exact rule.
  const premiumSkipped = [];
  // The flat-site decree makes every website grade an ordering signal only.
  // Keep the old premium veto solely behind the same rollback switch; default
  // operation retains classy sites and lets rankCandidates place them lower.
  const pool = flatSiteFirstEnabled() ? sitePool : sitePool.filter((r) => {
    const probe = r.record && r.record.website_probe;
    if (!probe || probe.modernPremium !== true) return true;
    premiumSkipped.push(r.current_website || (r.record && r.record.current_website) || r.name || "unknown");
    return false;
  });
  if (premiumSkipped.length) {
    console.log(`[lead-miner] build-qualification: skipped ${premiumSkipped.length} lead(s) with an already-modern site — ${premiumSkipped.slice(0, 5).join(", ")}${premiumSkipped.length > 5 ? ", …" : ""}`);
  }

  const candidates = pool.map((row) => opportunityInputFromRow(row));
  const ranked = selectTop(candidates, count);
  // TRADE SPREAD (default when >1 trade is present): selectTop now round-robins
  // across the distinct trades so one dense vertical cannot fill the whole run.
  // A short run is reported honestly rather than backfilled from the densest
  // trade — say so in the log the same way the premium-skip line does.
  if (ranked.mode === "spread") {
    const mix = ranked.industries.filter((it) => it.selected > 0).map((it) => `${it.selected} ${it.industry}`).join(", ");
    console.log(`[lead-miner] trade-spread: selected ${ranked.selected.length}/${ranked.requested} across ${ranked.industries.filter((it) => it.selected > 0).length} trade(s) — ${mix}`);
    if (ranked.shortfall > 0) {
      console.log(`[lead-miner] trade-spread: ${ranked.shortfall} short of ${ranked.requested}${ranked.ranDry.length ? ` — ran dry: ${ranked.ranDry.join(", ")}` : ""} (not backfilled)`);
    }
  }
  const selectedKeys = new Map(
    ranked.selected.map((lead, index) => [
      lead.place_id || `${lead.name || ""}${lead.address || ""}`,
      { rank: index + 1, opportunity: lead.opportunity },
    ]),
  );
  const scoredRows = pool.map((row) => {
    const input = opportunityInputFromRow(row);
    const key = input.place_id || `${input.name || ""}${input.address || ""}`;
    const selected = selectedKeys.get(key);
    const opportunity = selected ? selected.opportunity : scoreLead(input);
    const rank = selected ? selected.rank : null;
    const record = {
      ...(row.record || {}),
      opportunity,
      opportunity_rank: rank,
      opportunity_selected: Boolean(selected),
      contact_lane: opportunity.lane,
    };
    return {
      ...row,
      leadminer_score: opportunity.score,
      record: { ...record, leadminer_score: opportunity.score },
      _opportunity: opportunity,
      _opportunityRank: rank,
      _opportunitySelected: Boolean(selected),
    };
  });
  const orderedRows = flatSiteFirstEnabled()
    ? rankFlatSiteCandidates(scoredRows)
    : scoredRows.sort((a, b) => {
      const ar = a._opportunityRank || Number.MAX_SAFE_INTEGER;
      const br = b._opportunityRank || Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return (b.leadminer_score || 0) - (a.leadminer_score || 0);
    });
  return {
    // Surfaced, not just logged: a caller reporting "we mined 40 and kept 12"
    // must be able to say WHY the other 28 went, or the gate looks like a thin
    // metro instead of a deliberate refusal.
    qualificationSkipped: premiumSkipped.length,
    qualificationSkippedSites: premiumSkipped.slice(0, 25),
    scoredCount: ranked.scoredCount,
    eligibleCount: ranked.eligibleCount,
    selectedCount: ranked.selected.length,
    // The trade breakdown of this run, so the console can show "6 plumbing, 4
    // hvac, 2 roofing — electrician ran dry" instead of a bare selected count.
    tradeSpread: {
      mode: ranked.mode,
      requested: ranked.requested,
      industries: ranked.industries,
      shortfall: ranked.shortfall,
      ranDry: ranked.ranDry,
    },
    rows: orderedRows,
  };
}

function existingLookupToken(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
}

function persistedRows(result) {
  return Array.isArray(result?.data) ? result.data : [];
}

async function existingProspectsFor(rows = []) {
  const prospectIds = [...new Set(rows.map((row) => existingLookupToken(row.prospect_id)).filter(Boolean))];
  if (!prospectIds.length) return { ok: true, rows: [] };
  // prospect_id is derived deterministically from the Google place id and is
  // the table's real conflict key. place_id lives inside record JSON and is
  // not a top-level PostgREST column in production.
  const result = await select("ghost_agency_prospects", `prospect_id=in.(${prospectIds.join(",")})`);
  // A local/no-Supabase run cannot create a database duplicate; let the normal
  // dry-run writer report projections instead of pretending it persisted rows.
  if (result.mode === "dry_run") return { ok: true, rows: [] };
  if (!result.ok) return { ok: false, result };
  return { ok: true, rows: persistedRows(result) };
}

function comparableProspect(row = {}) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  const value = (key) => row[key] ?? record[key] ?? null;
  return {
    business_name: value("business_name"),
    email: value("email"),
    owner_email: value("owner_email"),
    phone: value("phone"),
    current_website: value("current_website"),
    industry: value("industry"),
    city: value("city"),
    state: value("state"),
    place_id: value("place_id"),
  };
}

function sameProspect(existing, candidate) {
  const prior = comparableProspect(existing);
  const next = comparableProspect(candidate);
  return Object.keys(next).every((key) => String(prior[key] || "") === String(next[key] || ""));
}

function stripResponseOnlyFields(row = {}) {
  const { _opportunity, _opportunityRank, _opportunitySelected, ...persistedRow } = row;
  // STAMP THE CLIENT ID AT WRITE TIME. Riley resolves callers by this code, and
  // when it is stored nowhere his lookup recomputes a sha256 across the whole
  // prospects table, page by page, on EVERY phone call — measured at 2.6-3.8s
  // per tool call, which is most of the dead air callers complained about. The
  // 2026-08-07 backfill stamped 1,200 existing rows (3.7s -> ~1s measured);
  // this keeps every NEW row on the indexed path so the latency cannot creep
  // back one mined lead at a time.
  try {
    const rec = persistedRow.record;
    if (rec && typeof rec === "object" && !rec.reference) {
      const code = clientReferenceCode({ ...rec, prospect_id: persistedRow.prospect_id });
      if (code) rec.reference = code;
    }
  } catch { /* a row that cannot be coded still persists; the resolver scans for it */ }
  return persistedRow;
}

// ===========================================================================
//                          THE BUILD-READY FUNNEL
// ===========================================================================
//
// GOVERNING RULE (owner, 2026-07-31): a row in the leads table is a PROMISE
// that a truthful, revealable mirror can be built for that business right now.
// Every gate the engine will apply is applied BEFORE the row is written. A
// candidate that fails any gate is not a weaker lead — it is not a lead, and it
// is never written. There is no "lead with a to-do list".
//
// The old lane wrote a row for every Google result and discovered at BUILD time
// that the lead was never buildable: no logo (so `brand` can never reach
// "passed", so revealable:false, so unsendable), no donor for the vertical (404
// donor_not_found on 21 of 26 approved categories), no verified email. That is
// how a table of 200 rows yields 12 sites.
//
// COST ORDERING. Stages run cheapest-and-most-eliminating first. The measured
// rates are reported by every run in `funnel[]`, so the ordering is justified by
// arithmetic and not by intuition. Operator discovery is website-first and
// resolves identity from that site; one optional Places lookup remains only on
// the separately opted-in manual_exact lane.
//
//   0  vertical/donor gate     free (local disk)   — kills whole categories
//   1  discovery               Places or Firecrawl — 1 bounded search per query
//   2  homepage GET            free                — one fetch, seven signals
//   3  website axis (C+)       free                — same bytes
//   4  brand: logo + accent    1 image GET         — same bytes for discovery
//   5  email                   free + DNS MX       — no message is ever sent
//   6  identity                first-party (zero Google) or one opted-in lookup
//   6b composite axis (C+)     free
//   7  identity + slug         free
//   8  dry-run build proof     free (zero Vercel)  — the closer
//
// STAGE 8 is what makes the row a promise rather than a hope: mirror() with
// dry_run runs validate -> facts -> donor -> brand -> hydrate -> scans -> routes
// and returns a build_hash with zero Vercel calls. A record that has not passed
// a dry run is not written.

const DEFAULT_FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/search";
const DEFAULT_FIRECRAWL_SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const DEFAULT_FIRECRAWL_CRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/crawl";
// SEARCH WIDTH (owner directive 2026-09-01: "when we first started it was fish
// in a barrel — we had more agents on Firecrawl"). The provider's /v1/search
// spec accepts limit 1..100 (default 10); the operator Line had been searching
// ~10 per query. Default 50, env-tunable, hard-clamped to the provider ceiling
// so no environment value can ask for more results than the endpoint returns.
const FIRECRAWL_SEARCH_PROVIDER_MAX = 100;
const FIRECRAWL_SEARCH_DEFAULT_LIMIT = 50;

function firecrawlSearchLimit(env = process.env) {
  return numberInRange((env || {}).GHOST_AGENCY_SEARCH_LIMIT, FIRECRAWL_SEARCH_DEFAULT_LIMIT, 1, FIRECRAWL_SEARCH_PROVIDER_MAX);
}

// NEGATIVE OPERATORS (owner-validated 2026-09-01: "plumbing company Odessa TX
// -site:yelp.com -site:angi.com -site:facebook.com" doubled the keep rate —
// 8/10 direct sites vs 4/10). Every fresh-mining discovery search appends this
// frozen exclusion list; the post-search directory filter (isDirectoryUrl)
// still runs — belt and suspenders, because a negative operator only cleans
// the SERP, it does not guarantee one.
const SEARCH_NEGATIVE_SITES = Object.freeze([
  "yelp.com", "angi.com", "facebook.com", "bbb.org",
  "expertise.com", "porch.com", "thumbtack.com",
]);

function searchQueryWithNegatives(query) {
  const base = String(query || "").trim();
  if (!base) return base;
  // Idempotent: a query that already carries the operators (a raw operator
  // query, a replayed plan) is returned unchanged rather than doubled.
  const alreadyNegative = SEARCH_NEGATIVE_SITES.every((site) => base.includes(`-site:${site}`));
  if (alreadyNegative) return base;
  return `${base} ${SEARCH_NEGATIVE_SITES.map((site) => `-site:${site}`).join(" ")}`;
}

// SERVICE-MODIFIER ROTATION (same owner evidence): long-tail shapes
// "{trade} {modifier} {place}" rotate into the query-shape ladder with every
// attempt, so a refill never re-reads the same grammatical form of SERP. The
// list is deliberately generic — every approved trade takes every modifier —
// because "plumbing estimate Midland TX" and "fencing contractor Spokane WA"
// are both real pages real operators write.
const SERVICE_MODIFIERS = Object.freeze([
  "company", "repair", "replacement", "installation", "emergency",
  "near me", "services", "estimate", "contractor", "specialist",
]);

// GOOGLE MAPS SEARCH-PAGE DISCOVERY (proven live 2026-09-01). A Firecrawl v2
// scrape of `https://www.google.com/maps/search/{query}/@{lat},{lng},{zoom}m`
// with formats ["links","html"] + waitFor ~8000 returns ~20-40 place links
// (`/maps/place/{Name}/data=!...!1s0x<hex>:0x<hex>!...!3d{lat}!4d{lng}`) and
// the headline names in class="fontHeadlineSmall" — real businesses with ZERO
// directory noise. Toggle: GHOST_AGENCY_MAPS_DISCOVERY, default ON; "0" is the
// emergency stop. The scrape IS a Firecrawl call: it shares FIRECRAWL_API_KEY
// and the v2 scrape endpoint with the rest of the miner, and it meters as
// `maps_scrape_calls` in the same cost ledger.
function mapsDiscoveryEnabled(env = process.env) {
  return String((env || {}).GHOST_AGENCY_MAPS_DISCOVERY ?? "1").trim() !== "0";
}
// Zoom, in the proven meters form: a REGION token sweeps a wide multi-city
// area, so it uses the live-proven 553408m regional scale; a metro or ZIP
// target sweeps one city, so it uses the tighter 22000m per-metro scale.
const MAPS_REGIONAL_ZOOM_METERS = 553408;
const MAPS_METRO_ZOOM_METERS = 22000;
// One maps scrape is one paid Firecrawl call; the Places resolution of each
// place→website is ALSO metered spend, so a scrape never admits more places
// than the run's per-query candidate budget.
function mapsDiscoveryAdmissionCap(input = {}, env = process.env) {
  return Math.max(1, numberInRange(input.candidatesPerQuery, 20, 1, 50));
}

// Market centers for the Maps viewport, keyed "<city>|<ST>" uppercased.
// Ordinary metros and region tokens (whose metroOfPlan city IS the token);
// ZIP targets resolve through their ZIP_MARKETS city below. A market with no
// entry simply omits the @viewport — Google Maps still scopes the search by
// the query text itself ("plumbing in Lubbock TX"); the viewport only tightens
// the results bias.
const MAPS_MARKET_CENTERS = Object.freeze({
  "HOUSTON|TX": [29.7589, -95.3677],
  "DALLAS|TX": [32.7767, -96.7970],
  "SAN ANTONIO|TX": [29.4252, -98.4946],
  "AUSTIN|TX": [30.2672, -97.7431],
  "FORT WORTH|TX": [32.7555, -97.3308],
  "OKLAHOMA CITY|OK": [35.4676, -97.5164],
  "TULSA|OK": [36.1540, -95.9928],
  "PHOENIX|AZ": [33.4484, -112.0740],
  "TUCSON|AZ": [32.2226, -110.9747],
  "ALBUQUERQUE|NM": [35.0844, -106.6504],
  "DENVER|CO": [39.7392, -104.9903],
  "COLORADO SPRINGS|CO": [38.8339, -104.8214],
  "KANSAS CITY|MO": [39.0997, -94.5786],
  "ST LOUIS|MO": [38.6270, -90.1994],
  "OMAHA|NE": [41.2565, -95.9345],
  "WICHITA|KS": [37.6872, -97.3301],
  "LITTLE ROCK|AR": [34.7465, -92.2896],
  "MEMPHIS|TN": [35.1495, -90.0490],
  "NASHVILLE|TN": [36.1627, -86.7816],
  "KNOXVILLE|TN": [35.9606, -83.9207],
  "LOUISVILLE|KY": [38.2527, -85.7585],
  "BIRMINGHAM|AL": [33.5186, -86.8104],
  "JACKSON|MS": [32.2988, -90.1848],
  "BATON ROUGE|LA": [30.4515, -91.1871],
  "SHREVEPORT|LA": [32.5252, -93.7502],
  "ATLANTA|GA": [33.7490, -84.3880],
  "CHARLOTTE|NC": [35.2271, -80.8431],
  "COLUMBIA|SC": [34.0007, -81.0348],
  "CHARLESTON|SC": [32.7765, -79.9311],
  "JACKSONVILLE|FL": [30.3322, -81.6557],
  "TAMPA|FL": [27.9506, -82.4572],
  "ORLANDO|FL": [28.5383, -81.3792],
  "BOISE|ID": [43.6150, -116.2023],
  "SALT LAKE CITY|UT": [40.7608, -111.8910],
  "LAS VEGAS|NV": [36.1699, -115.1398],
  "RENO|NV": [39.5296, -119.8138],
  "FRESNO|CA": [36.7378, -119.7871],
  "SACRAMENTO|CA": [38.5816, -121.4944],
  "SPOKANE|WA": [47.6588, -117.4260],
  "PORTLAND|OR": [45.5152, -122.6784],
  "DES MOINES|IA": [41.5868, -93.6250],
  "INDIANAPOLIS|IN": [39.7684, -86.1581],
  "COLUMBUS|OH": [39.9612, -82.9988],
  "CINCINNATI|OH": [39.1031, -84.5120],
  // Region tokens (representative in-region center, swept at regional zoom).
  "WEST TEXAS|TX": [31.9973, -102.0779],
  "NORTH TEXAS|TX": [33.2009, -97.1331],
  "EAST TEXAS|TX": [32.3512, -95.3011],
  "CENTRAL TEXAS|TX": [31.1000, -97.3500],
  "SOUTH TEXAS|TX": [27.7423, -97.4019],
  "EAST TENNESSEE|TN": [35.9606, -83.9207],
  "MIDDLE TENNESSEE|TN": [35.8456, -86.3903],
  "WEST TENNESSEE|TN": [35.1495, -90.0490],
  "NORTH FLORIDA|FL": [30.4518, -84.2812],
  "CENTRAL FLORIDA|FL": [28.5383, -81.3792],
  "SOUTH FLORIDA|FL": [26.1224, -80.1373],
  "SOUTHWEST FLORIDA|FL": [26.6406, -81.8723],
  "NORTH GEORGIA|GA": [34.2949, -83.8216],
  "SOUTH GEORGIA|GA": [32.0835, -81.0998],
  "NORTH ALABAMA|AL": [34.7304, -86.5861],
  "SOUTH ALABAMA|AL": [30.6954, -88.0431],
  "NORTH MISSISSIPPI|MS": [34.2576, -88.7034],
  "SOUTH MISSISSIPPI|MS": [30.3674, -89.0928],
  "EASTERN NORTH CAROLINA|NC": [35.6127, -77.3664],
  "WESTERN NORTH CAROLINA|NC": [35.5951, -82.5515],
  "NORTHERN VIRGINIA|VA": [38.8462, -77.3064],
  "SOUTHWEST OHIO|OH": [39.1031, -84.5120],
  "NORTHEAST OHIO|OH": [41.0814, -81.5190],
  "WEST MICHIGAN|MI": [42.9634, -85.6681],
  "UPSTATE NEW YORK|NY": [43.0481, -76.1474],
  // Secondary ZIP-ladder towns (the West Texas / High Plains directive set and
  // the other postal codes whose town is not itself a nationwide metro).
  "LUBBOCK|TX": [33.5779, -101.8552],
  "AMARILLO|TX": [35.2220, -101.8313],
  "EL PASO|TX": [31.7619, -106.4850],
  "SAN ANGELO|TX": [31.4638, -100.4370],
  "ABILENE|TX": [32.4487, -99.7331],
  "BIG SPRING|TX": [32.2504, -101.4787],
  "WICHITA FALLS|TX": [33.9137, -98.4934],
  "GALVESTON|TX": [29.3013, -94.7977],
  "CONROE|TX": [30.3119, -95.4561],
  "MCALLEN|TX": [26.2034, -98.2300],
  "CORPUS CHRISTI|TX": [27.7423, -97.4019],
  "TOPEKA|KS": [39.0473, -95.6752],
});

function mapsMarketCenter({ metro, queryShape, verifiedCoordinates } = {}) {
  if (verifiedCoordinates
    && Number.isFinite(verifiedCoordinates.lat) && Number.isFinite(verifiedCoordinates.lng)) {
    return { lat: verifiedCoordinates.lat, lng: verifiedCoordinates.lng, zoomMeters: MAPS_METRO_ZOOM_METERS };
  }
  const city = String((metro && metro.city) || "").trim().toUpperCase();
  const state = String((metro && metro.state) || "").trim().toUpperCase();
  let center = (city && state && MAPS_MARKET_CENTERS[`${city}|${state}`]) || null;
  if (!center && /^\d{5}$/.test(city)) {
    // A ZIP target keeps the token as its "city"; sweep the ZIP's real town.
    const zip = ZIP_MARKETS.find((entry) => entry.zip === city);
    if (zip) center = MAPS_MARKET_CENTERS[`${String(zip.city).toUpperCase()}|${zip.state}`] || null;
  }
  if (!center) return null;
  return {
    lat: center[0],
    lng: center[1],
    zoomMeters: queryShape === "region" ? MAPS_REGIONAL_ZOOM_METERS : MAPS_METRO_ZOOM_METERS,
  };
}
const FIRECRAWL_RENDER_MAX_SCRIPTS = 12;
const FIRECRAWL_RENDER_SCRIPT_MAX_BYTES = 64_000;
const FIRECRAWL_RENDER_JSONLD_MAX_BYTES = 192_000;
const FIRECRAWL_RENDER_RESPONSE_MAX_BYTES = 512_000;
const FIRECRAWL_RENDER_ACTION_SCRIPT = "(()=>{const jsonLd=[];let total=0;for(const node of Array.from(document.querySelectorAll('script[type=\\\"application/ld+json\\\"]')).slice(0,12)){const text=String(node.textContent||'');if(!text)continue;if(text.length>64000||total+text.length>192000)continue;jsonLd.push(text);total+=text.length;}return{finalUrl:String(location.href),jsonLd};})()";

// Aggregators, directories and marketplaces. These are not businesses; their
// pages rank for every local query and would consume the whole funnel.
const DIRECTORY_DOMAINS = new Set([
  "yelp.com", "angi.com", "angieslist.com", "homeadvisor.com", "thumbtack.com",
  "bbb.org", "houzz.com", "porch.com", "buildzoom.com", "manta.com",
  "yellowpages.com", "superpages.com", "mapquest.com", "foursquare.com",
  "facebook.com", "instagram.com", "linkedin.com", "nextdoor.com", "x.com",
  "twitter.com", "youtube.com", "tiktok.com", "pinterest.com", "reddit.com",
  "indeed.com", "ziprecruiter.com", "glassdoor.com", "craigslist.org",
  "google.com", "bing.com", "apple.com", "wikipedia.org", "tripadvisor.com",
  "chamberofcommerce.com", "cylex.us.com", "hotfrog.com", "birdeye.com",
  "expertise.com", "trustpilot.com", "alignable.com", "yellowbook.com",
  "networx.com", "modernize.com", "gaf.com", "owenscorning.com", "certainteed.com",
]);

// Mailbox providers a real small business legitimately publishes as its own
// contact channel. Anything ELSE off the prospect's own domain is somebody
// else's address — the site designer, a font foundry, a platform — which is
// exactly the class that shipped in the Jul-27 batch.
const CONSUMER_MAILBOX = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com",
  "hotmail.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "bellsouth.net",
  "cox.net", "charter.net", "protonmail.com", "proton.me", "zoho.com",
]);

// Local-parts that are structurally not a route to the owner of the business.
const NON_BUSINESS_LOCALPART = /^(webmaster|postmaster|abuse|noreply|no-reply|donotreply|do-not-reply|privacy|legal|dmca|press|media|jobs|careers|hr|recruiting|billing|ap|accountspayable|unsubscribe|bounce|mailer-daemon|root|hostmaster|security|test|example|user|name|email|your.?email)$/i;

const SOCIAL_HOSTS = Object.freeze([
  ["facebook", /(?:^|\.)facebook\.com$/i],
  ["instagram", /(?:^|\.)instagram\.com$/i],
  ["linkedin", /(?:^|\.)linkedin\.com$/i],
  ["youtube", /(?:^|\.)youtube\.com$/i],
  ["tiktok", /(?:^|\.)tiktok\.com$/i],
  ["twitter", /(?:^|\.)(?:twitter|x)\.com$/i],
  ["yelp", /(?:^|\.)yelp\.com$/i],
]);

// Google place types that NAME a trade. A type from this table that disagrees
// with the vertical we are about to build is a TRADE SWAP and disqualifies the
// lead: an HVAC company must never ship as a plumber, because donor selection
// is downstream of `industry` and the whole site would describe the wrong
// business. Google's assignment is an INDEPENDENT statement about the trade;
// the business's own site is not (a source that vouches for itself is not
// evidence of what it is).
const TRADE_TYPES = Object.freeze({
  plumber: "plumbing",
  roofing_contractor: "roofing",
  electrician: "electrician",
  general_contractor: "general contractor",
  hvac_contractor: "hvac",
  painter: "painting",
  locksmith: "locksmith",
  moving_company: "moving",
  pest_control_service: "pest control",
  landscaper: "landscaping",
  lawn_care_service: "landscaping",
  car_repair: "auto repair",
  dentist: "dental",
  lawyer: "attorney",
  hair_salon: "hair salon",
  beauty_salon: "hair salon",
  hair_care: "hair salon",
  barber_shop: "barber",
  nail_salon: "nail studio",
  spa: "med spa",
  tattoo_parlor: "tattoo",
  real_estate_agency: "real estate agent",
});

// Generic contractor types carry no trade claim of their own — they neither
// corroborate nor contradict, so they fall through to the self-published check.
const GENERIC_TRADE_TYPES = new Set([
  "contractor", "home_improvement_store", "store",
  "point_of_interest", "establishment", "finance", "local_services",
]);

// TEMPLATE-FIT ADMISSION (operator line only). Search terms and donor labels
// are instructions, not evidence. A candidate earns its template family only
// from the business's own name, schema @type declarations, and the service
// names harvested from its own page. Category-default services are downstream
// presentation fallbacks and never enter this calculation.
const TEMPLATE_FAMILY_PATTERNS = Object.freeze({
  plumbing: /\b(?:plumb(?:er|ers|ing)?|drain(?:age)?|sewer|water\s*heaters?|pipes?|pipe\s*fittings?|leak|toilet|faucet)\b/i,
  hvac: /\b(?:hvac|heating|air\s*condition(?:er|ing)?|cooling|furnace|heat\s*pump|ductless)\b/i,
  construction: /\b(?:carpenter|carpentry|framing|cabinet(?:ry|s)?|general\s+contract(?:or|ing)|construction|remodel(?:ing)?|renovation)\b/i,
  landscaping: /\b(?:arborist|tree\s+(?:services?|removal|care|trimming|pruning)|stump\s+grinding|garden(?:er|ing)?|landscap(?:e|er|ing)|lawn|irrigation|hardscap(?:e|ing))\b/i,
  roofing: /\b(?:roof(?:er|ers|ing)?|shingle|gutter)\b/i,
  electrical: /\b(?:electric(?:al|ian|ians)?|rewiring|panel\s+upgrade|generator)\b/i,
  fencing: /\b(?:fence|fences|fencing|gate\s+installation|deck|decking)\b/i,
  concrete: /\b(?:concrete|masonry|mason|foundation|flatwork|paving)\b/i,
  painting: /\b(?:paint(?:er|ers|ing)?|drywall|wallpaper)\b/i,
  pest_control: /\b(?:pest|exterminat(?:e|or|ion)|termite|rodent|wildlife\s+control)\b/i,
  moving: /\b(?:mover|movers|moving|relocation|packing\s+service)\b/i,
  locksmith: /\b(?:locksmith|lockout|rekey|key\s+replacement)\b/i,
  auto_repair: /\b(?:auto(?:motive)?\s+repair|car\s+repair|mechanic|brake\s+repair|oil\s+change|collision\s+repair)\b/i,
  dental: /\b(?:dentist|dental|orthodont(?:ic|ist)|teeth|tooth)\b/i,
  legal: /\b(?:attorney|lawyer|law\s+(?:firm|office)|legal\s+service)\b/i,
  salon: /\b(?:salons?|barber|nail\s+studio|haircut|stylist)\b/i,
  med_spa: /\b(?:med(?:ical)?\s*spa|aesthetic(?:s|ian)?|botox|filler|laser\s+(?:skin|hair))\b/i,
  tattoo: /\b(?:tattoo|tattoos|piercing)\b/i,
  real_estate: /\b(?:real\s+estate|realtor|realty|property\s+(?:listing|sales)|home\s+(?:listing|sales))\b/i,
});

const TEMPLATE_TARGET_FAMILIES = Object.freeze({
  plumbing: "plumbing",
  plumber: "plumbing",
  hvac: "hvac",
  "ac repair": "hvac",
  fencing: "fencing",
  fence: "fencing",
  deck: "fencing",
  decking: "fencing",
  concrete: "concrete",
  masonry: "concrete",
  mason: "concrete",
  hardscape: "concrete",
  hardscaping: "concrete",
  electrical: "electrical",
  electrician: "electrical",
  "general contractor": "construction",
  "general contracting": "construction",
  gc: "construction",
  construction: "construction",
  carpenter: "construction",
  carpentry: "construction",
  framing: "construction",
  cabinetry: "construction",
  landscaping: "landscaping",
  arborist: "landscaping",
  "tree service": "landscaping",
  "tree services": "landscaping",
  gardening: "landscaping",
  roofing: "roofing",
  "med spa": "med_spa",
  salon: "salon",
  tattoo: "tattoo",
  "real estate agent": "real_estate",
  "real estate": "real_estate",
  realtor: "real_estate",
  realty: "real_estate",
});

const SCHEMA_TYPE_FAMILIES = Object.freeze({
  plumber: "plumbing",
  hvacbusiness: "hvac",
  electrician: "electrical",
  generalcontractor: "construction",
  homeandconstructionbusiness: "construction",
  landscaper: "landscaping",
  roofingcontractor: "roofing",
  pestcontrolservice: "pest_control",
  autorepair: "auto_repair",
  dentist: "dental",
  legalservice: "legal",
  hairsalon: "salon",
  haircare: "salon",
  beautysalon: "salon",
  nailsalon: "salon",
  barbershop: "salon",
  dayspa: "med_spa",
  tattooparlor: "tattoo",
  realestateagent: "real_estate",
  realestateagency: "real_estate",
});

function templateFamiliesForText(value) {
  const text = String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, " ");
  const found = Object.entries(TEMPLATE_FAMILY_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([family]) => family);
  // "Concrete Construction" and similar names describe a specific trade, not
  // two competing families. Generic construction language loses to a more
  // specific family; carpentry/framing/cabinetry remains construction evidence.
  if (found.length > 1 && found.includes("construction")
    && !/\b(?:carpenter|carpentry|framing|cabinet(?:ry|s)?|remodel(?:ing)?|renovation)\b/i.test(text)) {
    return found.filter((family) => family !== "construction");
  }
  return found;
}

function templateFamilyForTarget(value) {
  const key = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return TEMPLATE_TARGET_FAMILIES[key] || templateFamiliesForText(key)[0] || "";
}

function templateFamiliesForSchemaType(value) {
  const normalized = normalizedSchemaType(value);
  const mapped = SCHEMA_TYPE_FAMILIES[normalized];
  return mapped ? [mapped] : templateFamiliesForText(normalized);
}

function schemaTypesFromFirstParty(nodes) {
  const out = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    for (const type of [].concat(value["@type"] || []).filter(Boolean)) {
      const normalized = normalizedSchemaType(type);
      if (normalized) out.push(normalized);
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(Array.isArray(nodes) ? nodes : []);
  return out;
}

function productCommerceSignals(html) {
  const source = String(html || "");
  return [
    /\badd\s+to\s+(?:cart|bag)\b/i,
    /\b(?:checkout|check\s+out)\b|["']\/checkout(?:[/?#"'])/i,
    /\bshopping\s+(?:cart|bag)\b|["']\/cart(?:[/?#"'])/i,
    /\b(?:product\s+catalog|shop\s+(?:our\s+)?products|browse\s+(?:our\s+)?catalog|buy\s+now)\b/i,
  ].filter((pattern) => pattern.test(source)).length;
}

function firstPartyServiceTextFragments(html) {
  const source = String(html || "")
    .replace(/<(?:script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/(?:script|style|nav|header|footer)>/gi, " ");
  const out = [];
  const seen = new Set();
  for (const match of source.matchAll(/<(?:p|li|h[2-6])\b[^>]*>([\s\S]*?)<\/(?:p|li|h[2-6])>/gi)) {
    const text = String(match[1] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:amp|#38);/gi, "&")
      .replace(/&(?:nbsp|#160);/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    for (const fragment of text.split(/\s+(?:and|or)\s+|[,;|•]+|\s+\/\s+/i)) {
      const clean = stripTrailingLocality(String(fragment || "").trim()).slice(0, 120);
      const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen.has(key) || !templateFamiliesForText(clean).length) continue;
      seen.add(key);
      out.push(clean);
      if (out.length >= 24) return out;
    }
  }
  return out;
}

/**
 * First-party template-family admission. Returned problems contain only family
 * names and counts: no business name, URL, service copy, email, or phone.
 */
function templateFitAdmission({ trigger, targetVertical, businessName, ldNodes, serviceNames, html, placePrimaryType = "" }) {
  if (String(trigger || "") !== "operator_line") {
    return { ok: true, skipped: true, reason: "not_operator_line" };
  }
  const targetFamily = templateFamilyForTarget(targetVertical);
  const schemaTypes = schemaTypesFromFirstParty(ldNodes);
  const services = (Array.isArray(serviceNames) ? serviceNames : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const businessNameFamilies = templateFamiliesForText(businessName);
  const schemaFamilies = schemaTypes.flatMap(templateFamiliesForSchemaType);
  const evidence = [
    ...businessNameFamilies,
    ...schemaFamilies,
    ...services.flatMap(templateFamiliesForText),
  ];
  const targetSignals = targetFamily ? evidence.filter((family) => family === targetFamily).length : 0;
  const totalSignals = evidence.length;
  const serviceFamilySignals = services.map(templateFamiliesForText);
  const corroboratingServiceSignals = targetFamily
    ? serviceFamilySignals.filter((families) => families.includes(targetFamily)).length
    : 0;
  const targetIdentitySignals = targetFamily
    ? [...businessNameFamilies, ...schemaFamilies].filter((family) => family === targetFamily).length
    : 0;
  const serviceEvidence = serviceFamilySignals.filter((families) => families.length > 0).length
    + businessNameFamilies.length
    + schemaFamilies.length;
  const productSchemaSignals = new Set(schemaTypes.filter((type) => type === "store" || type === "product")).size;
  const commerceSignals = productCommerceSignals(html);
  const productEvidence = productSchemaSignals + commerceSignals;
  const share = totalSignals ? targetSignals / totalSignals : 0;
  // A real service company may also sell fixtures, supplies, or care products.
  // Its own target-family name/schema plus two target-family service statements
  // is stronger identity evidence than generic Store/Product/cart plumbing.
  // Conversely, a schema-free shop must not turn product labels into fake
  // services merely because those labels contain target-family words.
  const serviceBusinessProof = targetIdentitySignals > 0 && corroboratingServiceSignals >= 2;
  const schemaFreeProductShop = productSchemaSignals === 0
    && commerceSignals >= 3
    && corroboratingServiceSignals >= 2
    && !serviceBusinessProof;
  const productDominantWithSchema = productSchemaSignals > 0
    && commerceSignals >= 2
    && productEvidence > serviceEvidence
    && !serviceBusinessProof;

  if (schemaFreeProductShop || productDominantWithSchema) {
    const actual = {
      productSchemaSignals,
      commerceSignals,
      productEvidence,
      serviceEvidence,
      targetIdentitySignals,
      corroboratingServiceSignals,
    };
    return {
      ok: false,
      reason: "product_dominant_site",
      detail: `product-dominant first-party evidence ${productEvidence} outweighs service evidence ${serviceEvidence}`,
      problems: [{
        code: "product_dominant_site",
        check: "product_vs_service_evidence",
        expected: { siteKind: "service_business" },
        actual,
      }],
    };
  }

  // A matching Google Place type is independent category evidence. It may
  // admit a sparse first-party site to Intake Genie, but it never becomes a
  // fabricated service and it never overrides the product-dominant veto above.
  // The compiler receives the actual site and decides what content it can
  // certify; this gate only answers whether we selected the right template
  // family for the real business Google identified.
  const googleTypeFamilies = templateFamiliesForSchemaType(placePrimaryType);
  const googleTypeCorroboratesTarget = Boolean(
    targetFamily && googleTypeFamilies.includes(targetFamily),
  );
  if (googleTypeCorroboratesTarget) {
    return {
      ok: true,
      targetFamily,
      admittedBy: "google_place_type",
      share: Number(share.toFixed(4)),
      targetSignals,
      totalSignals,
      corroboratingServiceSignals,
      targetIdentitySignals,
      productEvidence,
      serviceEvidence,
    };
  }

  if (!targetFamily || share < 0.80 || corroboratingServiceSignals < 2) {
    const actual = {
      targetFamily: targetFamily || "unsupported",
      targetSignals,
      totalSignals,
      share: Number(share.toFixed(4)),
      corroboratingServiceSignals,
    };
    return {
      ok: false,
      reason: "template_family_fit_below_threshold",
      detail: `first-party template fit ${actual.share} with ${corroboratingServiceSignals} corroborating service signals`,
      problems: [{
        code: "template_family_fit_below_threshold",
        check: "first_party_template_family_fit",
        expected: { minimumShare: 0.80, minimumCorroboratingServiceSignals: 2 },
        actual,
      }],
    };
  }

  return {
    ok: true,
    targetFamily,
    share: Number(share.toFixed(4)),
    targetSignals,
    totalSignals,
    corroboratingServiceSignals,
    targetIdentitySignals,
    productEvidence,
    serviceEvidence,
  };
}

// ---------------------------------------------------------------------------
// STAGE 0 — VERTICAL / DONOR GATE.  Free. The single most eliminating filter.
// ---------------------------------------------------------------------------
//
// `retired_for_outreach` is documented in two files as "stop mining this
// category" and, until now, was READ BY NOTHING. donor.js deliberately ignores
// it (those donors still build for existing customers) and donor-verticals.js
// deliberately ignores it. This is the one place it is enforced, which is
// exactly where it belongs: it is a MINING rule, not a build rule.

function outreachDonors(root) {
  const out = [];
  for (const donor of listDonors(root)) {
    const vertical = String(donor.vertical || "").toLowerCase().trim();
    if (!vertical || vertical.startsWith("__retired__")) continue;
    if (donorRetirement(donor)) continue;                 // unsafe to ship at all
    if (donor.retired_for_outreach === true) continue;    // safe to build, closed to mining
    if (isDonorExcluded(donor.name)) continue;            // owner-barred for line campaigns (lib/donor-exclusions.js)
    out.push({ donor: donor.name, vertical });
  }
  return out.sort((a, b) => a.donor.localeCompare(b.donor));
}

/** Every industry string this machine can mine AND build AND send today. */
function buildableVerticals(root) {
  const donors = outreachDonors(root);
  const byVertical = new Map();
  for (const d of donors) if (!byVertical.has(d.vertical)) byVertical.set(d.vertical, d.donor);
  const out = [...byVertical.entries()].map(([vertical, donor]) => ({ industry: vertical, donor, via: "canonical" }));
  // Aliases only count when they land on an outreach-eligible donor.
  const eligible = new Set(donors.map((d) => d.donor));
  const table = require("./donor-verticals").loadTable();
  for (const [alias, donor] of Object.entries((table && table.aliases) || {})) {
    const key = String(alias).toLowerCase().trim();
    if (byVertical.has(key)) continue;
    if (!eligible.has(donor)) continue;
    const hit = resolveAlias(key, root ? { root } : {});
    if (!hit || hit.donor !== donor) continue;
    out.push({ industry: key, donor, via: "alias" });
  }
  return out;
}

/**
 * resolveBuildableDonor(industry) -> {ok:true, donor, vertical, via}
 *                                  | {ok:false, reason}
 * The reason is NAMED so a refused run reads as a decision, not a thin metro.
 */
function resolveBuildableDonor(industry, root) {
  const requested = String(industry || "").toLowerCase().trim();
  if (!requested) return { ok: false, reason: "no_industry" };
  // Mining approves the public category "hair salon" while the donor
  // registry's canonical vertical is "salon". Bridge only that known routing
  // seam; qualification evidence and both registries remain unchanged.
  const wanted = requested === "hair salon" ? "salon" : requested;
  const all = listDonors(root);
  const forVertical = all.filter((d) => String(d.vertical || "").toLowerCase() === wanted);
  const hit = buildableVerticals(root).find((v) => v.industry === wanted);
  if (hit) return {
    ok: true,
    donor: hit.donor,
    vertical: wanted,
    via: requested === wanted ? hit.via : "category_bridge",
  };
  // DONOR EXCLUSIONS (lib/donor-exclusions.js): a vertical whose every
  // in-service, outreach-eligible donor is owner-barred refuses with the
  // NAMED cause, so the line's admission kill reads as a decision — these
  // donors are off for line campaigns — instead of "no template exists".
  // Runs before the retirement reasons: an excluded LIVE donor is the
  // sharper diagnosis, and the exclusions are env-overridable while a
  // manifest retirement is not.
  const selectable = forVertical.filter((d) => !donorRetirement(d) && d.retired_for_outreach !== true);
  if (selectable.length && selectable.every((d) => isDonorExcluded(d.name))) {
    return {
      ok: false,
      reason: DONOR_EXCLUSION_CAUSE,
      vertical: wanted,
      excludedDonors: selectable.map((d) => d.name),
    };
  }
  if (forVertical.some((d) => d.retired_for_outreach === true)) {
    return { ok: false, reason: "vertical_retired_for_outreach" };
  }
  if (forVertical.some((d) => donorRetirement(d))) return { ok: false, reason: "donor_retired" };
  return { ok: false, reason: "no_clean_donor_for_vertical" };
}

// ---------------------------------------------------------------------------
// STAGE 1 — DISCOVERY. Every fresh mining trigger starts from website search
// and hands a first-party URL to stages 2-5. Google Places is never the
// operator's candidate source.
// ---------------------------------------------------------------------------

async function firecrawlSearch({ query, limit = firecrawlSearchLimit(), apiKey, endpoint = DEFAULT_FIRECRAWL_ENDPOINT, fetchImpl = global.fetch, timeoutMs = 45000, env = process.env }) {
  if (firecrawlEmergencyStop(env)) return { ok: false, reason: "firecrawl_emergency_stop", results: [] };
  if (!apiKey) return { ok: false, reason: "no_firecrawl_key", results: [] };
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, limit: Math.min(FIRECRAWL_SEARCH_PROVIDER_MAX, Math.max(1, limit)) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, reason: "firecrawl_unreachable", detail: String(e.message || e).slice(0, 160), results: [] };
  }
  if (!res.ok) return { ok: false, reason: `firecrawl_http_${res.status}`, results: [] };
  const json = await res.json().catch(() => null);
  const rows = (json && (json.data || json.results)) || [];
  const web = Array.isArray(rows) ? rows : (Array.isArray(rows.web) ? rows.web : []);
  return {
    ok: true,
    results: web.map((r) => ({ url: r.url || r.link || "", title: r.title || "", description: r.description || r.snippet || "" })).filter((r) => r.url),
  };
}

/** True when a URL is a directory/aggregator/social page rather than a business. */
function isDirectoryUrl(url) {
  try {
    const host = registrableDomain(new URL(url).hostname);
    return [...DIRECTORY_DOMAINS].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return true; }
}

// --- GOOGLE MAPS SEARCH-PAGE DISCOVERY --------------------------------------
//
// mapsSearchDiscovery scrapes the LIVE Maps search page for the SAME balanced
// target the Firecrawl search just used ("plumbing in West Texas") and parses
// the place links Google renders for it. Output is shaped exactly like
// firecrawlSearch's ({ ok, results: [{url,title,description}] }) so the mining
// loop consumes both sources with the same code path; each result additionally
// carries `mapsPlace` — the raw place evidence from the link.

// The `data=!...!1s0x<hex>:0x<hex>!...!3d{lat}!4d{lng}` feature blob on a Maps
// place link. The hex pair is kept RAW (we do not pretend it is a Places-API
// place_id); the second hex is the CID — the numeric place id — from which the
// canonical `?api=1&query_place_id=` URL is derived ONLY when it parses.
const MAPS_PLACE_LINK = /^https:\/\/www\.google\.com\/maps\/place\/([^/?#]+)(?:\/(?:data=([^?#\s]+))?)?/i;
const MAPS_PLACE_REF = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i;
const MAPS_PLACE_COORDS = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i;
const MAPS_HEADLINE_NAME = /class="fontHeadlineSmall"[^>]*>([^<]{2,120})</g;

function mapsPlaceRefToCid(placeRef) {
  const tail = (String(placeRef || "").split(":").pop() || "").replace(/^0x/i, "");
  return /^[0-9a-f]+$/i.test(tail) && tail.length % 2 === 0 ? BigInt(`0x${tail}`).toString(10) : "";
}

/** Parse one Maps place URL into the raw evidence a Maps candidate carries. */
function parseMapsPlaceLink(url) {
  const match = MAPS_PLACE_LINK.exec(String(url || ""));
  if (!match) return null;
  let name = "";
  try {
    name = decodeURIComponent(match[1].replace(/\+/g, " ")).trim();
  } catch {
    name = match[1].replace(/\+/g, " ").trim();
  }
  if (!name) return null;
  const data = match[2] ? decodeURIComponent(match[2]) : "";
  const placeRef = MAPS_PLACE_REF.exec(data)?.[1] || "";
  const coords = MAPS_PLACE_COORDS.exec(data);
  const lat = coords ? Number(coords[1]) : null;
  const lng = coords ? Number(coords[2]) : null;
  const cid = placeRef ? mapsPlaceRefToCid(placeRef) : "";
  return {
    name,
    placeRef, // raw `0x<hex>:0x<hex>` feature pair — NOT a Places-API place_id
    cid,
    // Canonical one-tap Maps URL only when the numeric place id exists;
    // otherwise the coords + name ARE the stored identity.
    ...(cid ? { canonicalUrl: `https://www.google.com/maps/search/?api=1&query_place_id=${cid}` } : {}),
    ...(coords && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
  };
}

function parseMapsHeadlineNames(html) {
  const names = [];
  const seen = new Set();
  for (const match of String(html || "").matchAll(MAPS_HEADLINE_NAME)) {
    const name = String(match[1] || "").replace(/&amp;/g, "&").trim();
    const key = name.toLocaleLowerCase("en-US");
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

function mapsSearchUrl({ query, center }) {
  const encoded = encodeURIComponent(String(query || "").trim()).replace(/%20/g, "+");
  const viewport = center && Number.isFinite(center.lat) && Number.isFinite(center.lng) && Number.isFinite(center.zoomMeters)
    ? `@${center.lat},${center.lng},${center.zoomMeters}m`
    : "";
  return `https://www.google.com/maps/search/${encoded}/${viewport}`;
}

async function mapsSearchDiscovery({
  query,
  center = null,
  apiKey,
  endpoint = DEFAULT_FIRECRAWL_SCRAPE_ENDPOINT,
  fetchImpl = global.fetch,
  timeoutMs = 30_000,
} = {}) {
  // One Maps scrape = ONE Firecrawl call. Same key, same endpoint family, same
  // emergency stop (GHOST_AGENCY_MAPS_DISCOVERY=0) as the rest of discovery.
  if (!apiKey) return { ok: false, reason: "no_firecrawl_key", results: [], calls: 0, headlineNames: [] };
  const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 30_000, 8_000), 45_000);
  const url = mapsSearchUrl({ query, center });
  let response;
  try {
    // waitFor ~8000: the Maps results render client-side; the proven payload
    // gave the page eight seconds before the links were harvested.
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        formats: ["links", "html"],
        waitFor: 8000,
        timeout: boundedTimeout,
        storeInCache: false,
      }),
      signal: AbortSignal.timeout(boundedTimeout + 5_000),
    });
  } catch (error) {
    return { ok: false, reason: "maps_scrape_unreachable", detail: String(error?.message || error).slice(0, 160), results: [], calls: 1, headlineNames: [] };
  }
  if (!response.ok) return { ok: false, reason: `maps_scrape_http_${response.status}`, results: [], calls: 1, headlineNames: [] };
  const body = await readResponseTextBounded(response, FIRECRAWL_RENDER_RESPONSE_MAX_BYTES);
  if (!body.ok) return { ok: false, reason: body.reason, results: [], calls: 1, headlineNames: [] };
  let json;
  try { json = JSON.parse(body.text); } catch {
    return { ok: false, reason: "maps_scrape_invalid_json", results: [], calls: 1, headlineNames: [] };
  }
  const data = plainObject(json) && json.success === true && plainObject(json.data) ? json.data : null;
  const links = data && Array.isArray(data.links) ? data.links : [];
  const html = data && typeof data.html === "string" ? data.html : "";
  const headlineNames = parseMapsHeadlineNames(html);
  const results = [];
  const seen = new Set();
  for (const link of links) {
    const href = String((link && (link.url || link.href)) || "");
    const place = parseMapsPlaceLink(href);
    if (!place) continue; // not a place link: directions, /maps/search/, UI chrome
    const key = place.placeRef || place.name.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      url: place.canonicalUrl || href,
      title: place.name,
      // A Maps candidate has NO website; the description carries the place
      // evidence (coords + raw feature pair) until Places resolves a site.
      description: [place.lat, place.lng].filter(Number.isFinite).join(","),
      mapsPlace: place,
    });
  }
  if (!results.length) return { ok: false, reason: "maps_scrape_no_place_links", results: [], calls: 1, headlineNames };
  return { ok: true, results, calls: 1, headlineNames, mapsUrl: url };
}

/**
 * Resolve a Maps candidate to its Google place — the pipeline's EXISTING
 * Places-details path, not a new call type: one searchText lookup (the same
 * searchPlacesPage every identity observation uses), matched by the business
 * name Google itself rendered on the Maps page. The matched place's
 * websiteUri becomes the candidate's website and the place object rides the
 * candidate as `discoveryPlace`, so stage 6 verifies identity through
 * napFromPlace exactly like every other Google-observed lead
 * (record.identity_source = "google_places").
 */
async function resolveMapsCandidatePlace({ key, name, cityHint, fetchImpl, breaker = discoveryBreaker, retries = 0 }) {
  const page = await searchPlacesPage({
    key,
    textQuery: `${name} ${cityHint}`.trim(),
    pageSize: 5,
    fetchImpl,
    breaker,
    retries,
  });
  if (!page.ok) {
    return {
      ok: false,
      reason: page.mode,
      detail: [page.error, page.fault].filter(Boolean).join(" — ") || `discovery provider ${page.status || "failure"}`,
      providerAtFault: Boolean(page.countedAgainstProvider) || page.mode === "provider_down",
      httpCalls: page.httpCalls || 0,
    };
  }
  const wanted = normalizeIdentityToken(name);
  const match = (page.places || []).find((place) => {
    const have = normalizeIdentityToken(placeName(place));
    if (!have || !wanted) return false;
    return have === wanted
      || (have.length >= 4 && wanted.length >= 4 && (have.includes(wanted) || wanted.includes(have)));
  }) || null;
  if (!match) {
    return {
      ok: false,
      reason: "maps_place_not_confirmed",
      detail: `searched "${name} ${cityHint}" — ${((page.places || []).length)} result(s), none matching the Maps listing "${name}"`,
      providerAtFault: false,
      httpCalls: page.httpCalls || 0,
    };
  }
  return { ok: true, place: match, httpCalls: page.httpCalls || 0 };
}

/**
 * A Facebook hostname is shared by millions of businesses, so the registrable
 * domain cannot prove identity. Preserve the page path (or profile id) and use
 * that exact key when the later GBP observation is matched. Generic Facebook
 * surfaces are deliberately not page identities and remain directory rejects.
 */
function facebookPageIdentity(url) {
  if (!isFacebookSite(String(url || ""))) return "";
  try {
    const parsed = new URL(String(url));
    const pathName = decodeURIComponent(parsed.pathname || "/")
      .replace(/\/+$/g, "")
      .toLocaleLowerCase("en-US");
    if (!pathName || pathName === "/") return "";
    if (pathName === "/profile.php") {
      const id = String(parsed.searchParams.get("id") || "").trim();
      return id ? `facebook.com/profile.php?id=${id}` : "";
    }
    if (/^\/(?:login|share|sharer|plugins|tr)(?:\/|$)/i.test(pathName)) return "";
    return `facebook.com${pathName}`;
  } catch {
    return "";
  }
}

function canonicalFacebookPageUrl(url) {
  const identity = facebookPageIdentity(url);
  if (!identity) return "";
  if (identity.startsWith("facebook.com/profile.php?id=")) {
    return `https://www.${identity}`;
  }
  return `https://www.${identity}`;
}

function hasExplicitLogoClaim(html) {
  const source = String(html || "");
  return /["']logo["']\s*:/i.test(source)
    || /<meta\b[^>]*(?:property|name|itemprop)=["'](?:og:logo|logo)["']/i.test(source)
    || /<img\b[^>]*(?:class|id|src)=["'][^"']*(?:custom-logo|\blogo\b)/i.test(source);
}

function resolvedLogoSignalUrls(html, siteUrl) {
  const source = String(html || "");
  const raw = [...schemaLogoUrls(source)];
  for (const tag of source.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attrOf(tag, "property") || attrOf(tag, "name") || attrOf(tag, "itemprop")).toLowerCase();
    if (key === "og:logo" || key === "logo") raw.push(attrOf(tag, "content"));
    if (key === "og:image" && /logo|brand[-_]?mark|site[-_]?identity|wordmark/i.test(attrOf(tag, "content"))) {
      raw.push(attrOf(tag, "content"));
    }
  }
  for (const { tag, ancestors } of imagesWithContext(source)) {
    const anchor = [...ancestors].reverse().find((item) => item.name === "a" && item.href);
    const inHeader = ancestors.some((item) => (
      item.name !== "html"
      && item.name !== "body"
      && (
        item.name === "header"
        || /header/i.test(item.elementor || "")
        || /header|masthead|topbar|top[-_]?bar|navbar|nav[-_]?primary|site[-_]?branding|branding/i.test(`${item.class || ""} ${item.id || ""}`)
      )
    ));
    const homeLink = Boolean(anchor && (
      isHomeHref(anchor.href, siteUrl)
      || /(^|\s)home(\s|$)/i.test(anchor.rel || "")
    ));
    const values = [];
    for (const name of ["src", "data-src", "data-lazy-src", "data-original"]) values.push(attrOf(tag, name));
    for (const name of ["srcset", "data-srcset"]) {
      for (const item of attrOf(tag, name).split(",")) values.push(item.trim().split(/[ \t]+/)[0]);
    }
    const roleText = `${attrOf(tag, "class")} ${attrOf(tag, "id")} ${anchor && anchor.class || ""}`;
    const roleClaim = /logo|wordmark|brand[-_]?mark|site[-_]?identity|branding/i.test(roleText);
    const urlClaim = values.some((value) => /logo|brand[-_]?mark|site[-_]?identity|wordmark/i.test(value));
    if (!roleClaim && !urlClaim && !(inHeader && homeLink)) continue;
    raw.push(...values);
  }
  for (const tag of source.match(/<link\b[^>]*>/gi) || []) {
    if (/apple-touch-icon/i.test(attrOf(tag, "rel"))) raw.push(attrOf(tag, "href"));
  }
  for (const match of source.matchAll(/background(?:-image)?\s*:\s*url\(([^)]+)\)/gi)) {
    const value = String(match[1] || "").trim().replace(/^["']|["']$/g, "");
    if (/logo|brand[-_]?mark|site[-_]?identity|wordmark/i.test(value)) raw.push(value);
  }
  const urls = [];
  const seen = new Set();
  for (const value of raw) {
    if (!value || /^data:/i.test(value)) continue;
    try {
      const url = new URL(value, siteUrl);
      const href = upgradeToHttps(url.href, siteUrl);
      if (seen.has(href)) continue;
      seen.add(href);
      urls.push(href);
    } catch { /* malformed declarations are refused by the ordinary resolver */ }
  }
  return urls;
}

function rankedLogoProvenanceFailure(ranked, html, siteUrl) {
  const signaled = new Set(resolvedLogoSignalUrls(html, siteUrl));
  for (const rejection of (ranked && ranked.rejected) || []) {
    if (!signaled.has(String(rejection && rejection.url || ""))) continue;
    if (rejection.why === "not_own_mark_host") return "logo_not_own_registrable_domain";
    if (rejection.why === "third_party_filename_or_host") return "logo_third_party_mark";
  }
  return "";
}

// ---------------------------------------------------------------------------
// STAGE 2 — ONE homepage GET. Seven signals off one fetch: weakness probe,
// logo candidates, emails, the self-published market assertion, social links,
// the site's own name assertion, and the response headers the security axis
// needs. Anything that needs a SECOND fetch of the same page is a bug.
// ---------------------------------------------------------------------------

async function fetchPageBytes(url, timeoutMs = 12000, fetchImpl = global.fetch) {
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WSSLabsBot/1.0; +https://wss-ai.com)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ct = String(res.headers.get("content-type") || "");
    const headers = {};
    try { res.headers.forEach((v, k) => { headers[k] = v; }); } catch { /* header iteration unsupported */ }
    if (!/text\/html|application\/xhtml/i.test(ct) && res.ok) {
      return { ok: false, failure: "not_html", status: res.status, html: "", headers, elapsedMs: Date.now() - started, finalUrl: res.url || url };
    }
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, headers, elapsedMs: Date.now() - started, finalUrl: res.url || url, failure: res.ok ? null : `http_${res.status}` };
  } catch (e) {
    return { ok: false, failure: e && e.name === "TimeoutError" ? "timeout" : "fetch_error", status: null, html: "", headers: {}, elapsedMs: Date.now() - started, finalUrl: url };
  }
}

const META_RE = (name) => new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i");

function parsePage(html) {
  const text = String(html || "");
  const grab = (re) => { const m = re.exec(text); return m ? m[1].trim() : ""; };
  return {
    title: grab(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i).replace(/\s+/g, " "),
    metaDescription: grab(META_RE("description")),
    h1: grab(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    openGraph: /<meta[^>]+property=["']og:/i.test(text),
    canonical: /<link[^>]+rel=["']canonical["']/i.test(text),
    modernStack: /__NEXT_DATA__|__NUXT__|astro-island|data-svelte|data-reactroot|\/_next\/|gatsby|remix-|vite/i.test(text),
    legacyScript: (/jquery[.-]1\.\d/i.test(text) && "jquery-1.x") || (/document\.write\(/i.test(text) && "document.write") || null,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function appendJsonLdValue(value, nodes) {
  let parsed = value;
  if (typeof parsed === "string") {
    const source = parsed.trim();
    if (!source || source.length > 200_000) return;
    try { parsed = JSON.parse(source); } catch { return; }
  }
  for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!node || typeof node !== "object") continue;
    if (nodes.length >= 100) return;
    nodes.push(node);
    if (Array.isArray(node["@graph"])) {
      for (const child of node["@graph"]) {
        if (nodes.length >= 100) return;
        if (child && typeof child === "object") nodes.push(child);
      }
    }
    if (nodes.length >= 100) return;
  }
}

function jsonLdNodes(html) {
  const nodes = [];
  for (const m of String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    appendJsonLdValue(m[1], nodes);
    if (nodes.length >= 100) break;
  }
  return nodes;
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObjectKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

async function readResponseTextBounded(response, maxBytes) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    return { ok: false, reason: "firecrawl_render_response_unreadable" };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "firecrawl_render_response_unreadable" };
      }
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "firecrawl_render_response_too_large" };
      }
      chunks.push(Buffer.from(part.value));
    }
  } catch {
    return { ok: false, reason: "firecrawl_render_response_unreadable" };
  } finally {
    try { reader.releaseLock(); } catch { /* already released or cancelled */ }
  }
  return { ok: true, text: Buffer.concat(chunks, bytes).toString("utf8") };
}

/**
 * Fetch only the rendered JSON-LD that a client-side page placed in its DOM.
 * This is a bounded fallback for a static homepage with zero parseable nodes;
 * it never turns visible prose or the mining query into identity evidence.
 */
async function firecrawlRenderedJsonLd({
  url,
  apiKey,
  endpoint = DEFAULT_FIRECRAWL_SCRAPE_ENDPOINT,
  fetchImpl = global.fetch,
  timeoutMs = 20_000,
  env = process.env,
} = {}) {
  if (firecrawlEmergencyStop(env)) return { ok: false, reason: "firecrawl_emergency_stop", nodes: [], calls: 0 };
  if (!apiKey) return { ok: false, reason: "no_firecrawl_key", nodes: [], calls: 0 };
  const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 20_000, 5_000), 30_000);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: false,
        timeout: boundedTimeout,
        storeInCache: false,
        actions: [{
          type: "executeJavascript",
          script: FIRECRAWL_RENDER_ACTION_SCRIPT,
        }],
      }),
      signal: AbortSignal.timeout(boundedTimeout),
    });
  } catch (error) {
    return { ok: false, reason: "firecrawl_render_unreachable", detail: String(error?.message || error).slice(0, 160), nodes: [], calls: 1 };
  }
  if (!response.ok) {
    return { ok: false, reason: `firecrawl_render_http_${response.status}`, nodes: [], calls: 1 };
  }
  const body = await readResponseTextBounded(response, FIRECRAWL_RENDER_RESPONSE_MAX_BYTES);
  if (!body.ok) return { ok: false, reason: body.reason, nodes: [], calls: 1 };
  let json;
  try { json = JSON.parse(body.text); } catch {
    return { ok: false, reason: "firecrawl_render_invalid_json", nodes: [], calls: 1 };
  }
  const data = plainObject(json) && json.success === true && plainObject(json.data)
    ? json.data
    : null;
  const returns = data && plainObject(data.actions) && Array.isArray(data.actions.javascriptReturns)
    ? data.actions.javascriptReturns
    : null;
  const result = returns && returns.length === 1 ? returns[0] : null;
  const payload = plainObject(result) && result.type === "object" && exactObjectKeys(result.value, ["finalUrl", "jsonLd"])
    ? result.value
    : null;
  if (!payload || typeof payload.finalUrl !== "string" || !Array.isArray(payload.jsonLd)) {
    return { ok: false, reason: "firecrawl_render_schema_invalid", nodes: [], calls: 1 };
  }
  const finalUrl = payload.finalUrl.trim();
  if (!finalUrl || finalUrl.length > 2_048 || !(sameOwner(url, finalUrl) || sameOwner(finalUrl, url))) {
    return { ok: false, reason: "firecrawl_render_cross_owner", nodes: [], calls: 1 };
  }
  // Provider metadata is never final-URL proof. When present it can only make
  // the action's location.href evidence stricter by agreeing on the owner.
  if (data.metadata !== undefined) {
    if (!plainObject(data.metadata)) {
      return { ok: false, reason: "firecrawl_render_schema_invalid", nodes: [], calls: 1 };
    }
    for (const field of ["url", "sourceURL"]) {
      if (!Object.prototype.hasOwnProperty.call(data.metadata, field)) continue;
      const metadataUrl = data.metadata[field];
      if (typeof metadataUrl !== "string" || !metadataUrl.trim()) {
        return { ok: false, reason: "firecrawl_render_schema_invalid", nodes: [], calls: 1 };
      }
      if (!(sameOwner(finalUrl, metadataUrl) || sameOwner(metadataUrl, finalUrl))) {
        return { ok: false, reason: "firecrawl_render_cross_owner", nodes: [], calls: 1 };
      }
    }
  }
  if (payload.jsonLd.length > FIRECRAWL_RENDER_MAX_SCRIPTS) {
    return { ok: false, reason: "firecrawl_render_schema_invalid", nodes: [], calls: 1 };
  }
  const nodes = [];
  let jsonLdBytes = 0;
  for (const value of payload.jsonLd) {
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, reason: "firecrawl_render_schema_invalid", nodes: [], calls: 1 };
    }
    const valueBytes = Buffer.byteLength(value, "utf8");
    jsonLdBytes += valueBytes;
    if (valueBytes > FIRECRAWL_RENDER_SCRIPT_MAX_BYTES || jsonLdBytes > FIRECRAWL_RENDER_JSONLD_MAX_BYTES) {
      return { ok: false, reason: "firecrawl_render_jsonld_too_large", nodes: [], calls: 1 };
    }
    let parsed;
    try { parsed = JSON.parse(value); } catch {
      return { ok: false, reason: "firecrawl_render_jsonld_invalid", nodes: [], calls: 1 };
    }
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    if (!roots.length || roots.some((node) => !plainObject(node))) {
      return { ok: false, reason: "firecrawl_render_jsonld_invalid", nodes: [], calls: 1 };
    }
    for (const root of roots) {
      if (root["@graph"] !== undefined && (
        !Array.isArray(root["@graph"])
        || root["@graph"].some((node) => !plainObject(node))
      )) {
        return { ok: false, reason: "firecrawl_render_jsonld_invalid", nodes: [], calls: 1 };
      }
    }
    appendJsonLdValue(parsed, nodes);
  }
  return nodes.length
    ? { ok: true, nodes, finalUrl, calls: 1 }
    : { ok: false, reason: "firecrawl_render_jsonld_missing", nodes: [], calls: 1 };
}

/**
 * Recover full homepage HTML via Firecrawl's scrape endpoint when the direct
 * GET is refused by anti-bot protection (403/429) or returns non-HTML bytes.
 * Firecrawl renders JavaScript and bypasses the bot blocks the raw fetch hits,
 * so the same source-evidence pipeline (services, email, logo, identity) keeps
 * running for sites the free GET could not read. This is the owner's stated
 * direction: Firecrawl is the main scraping engine, and Google Places is not
 * used for content extraction (cost). The cost law is gone: the per-run
 * ceiling is a generous sanity bound (one scrape per candidate site), the
 * only hard stop is the emergency kill-switch, and every scrape stays on
 * the cost ledger.
 */
async function firecrawlScrapeHtml({
  url,
  apiKey,
  endpoint = DEFAULT_FIRECRAWL_SCRAPE_ENDPOINT,
  fetchImpl = global.fetch,
  timeoutMs = 20_000,
  env = process.env,
} = {}) {
  if (firecrawlEmergencyStop(env)) return { ok: false, reason: "firecrawl_emergency_stop", html: "", calls: 0 };
  if (!apiKey) return { ok: false, reason: "no_firecrawl_key", html: "", calls: 0 };
  const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 20_000, 5_000), 30_000);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        formats: ["html"],
        onlyMainContent: false,
        timeout: boundedTimeout,
        storeInCache: false,
      }),
      signal: AbortSignal.timeout(boundedTimeout),
    });
  } catch (error) {
    return { ok: false, reason: "firecrawl_scrape_unreachable", detail: String(error?.message || error).slice(0, 160), html: "", calls: 1 };
  }
  if (!response.ok) {
    return { ok: false, reason: `firecrawl_scrape_http_${response.status}`, html: "", calls: 1 };
  }
  const body = await readResponseTextBounded(response, FIRECRAWL_RENDER_RESPONSE_MAX_BYTES);
  if (!body.ok) return { ok: false, reason: body.reason, html: "", calls: 1 };
  let json;
  try { json = JSON.parse(body.text); } catch {
    return { ok: false, reason: "firecrawl_scrape_invalid_json", html: "", calls: 1 };
  }
  const data = plainObject(json) && json.success === true && plainObject(json.data) ? json.data : null;
  const html = data && typeof data.html === "string" ? data.html : "";
  const finalUrl = data && typeof data.url === "string" ? data.url : url;
  if (!html.trim()) return { ok: false, reason: "firecrawl_scrape_empty_html", html: "", calls: 1 };
  return { ok: true, html, finalUrl, status: response.status, calls: 1 };
}

/**
 * Recover a logo URL via Firecrawl's `branding` format when the HTML heuristic
 * found no own-domain logo candidate. Firecrawl's branding extractor handles
 * logos in background images, CSS, and JS-rendered marks that the static
 * HTML heuristic misses — the exact small-business sites (Wix, Framer) that
 * defeat rankLogoCandidates. Bounded and opt-in via a kill switch; the result
 * is only a URL hint, still subject to the same ownsLogo/denylist/sniff/measure
 * pipeline in resolveOwnLogo.
 */
async function firecrawlBranding({
  url,
  apiKey,
  endpoint = DEFAULT_FIRECRAWL_SCRAPE_ENDPOINT,
  fetchImpl = global.fetch,
  timeoutMs = 20_000,
  env = process.env,
} = {}) {
  if (firecrawlEmergencyStop(env)) return { ok: false, reason: "firecrawl_emergency_stop", logo: "", calls: 0 };
  if (!apiKey) return { ok: false, reason: "no_firecrawl_key", logo: "", calls: 0 };
  const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 20_000, 5_000), 30_000);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        url,
        formats: ["branding"],
        onlyMainContent: false,
        timeout: boundedTimeout,
        storeInCache: false,
      }),
      signal: AbortSignal.timeout(boundedTimeout),
    });
  } catch (error) {
    return { ok: false, reason: "firecrawl_branding_unreachable", detail: String(error?.message || error).slice(0, 160), logo: "", calls: 1 };
  }
  if (!response.ok) {
    return { ok: false, reason: `firecrawl_branding_http_${response.status}`, logo: "", calls: 1 };
  }
  const body = await readResponseTextBounded(response, FIRECRAWL_RENDER_RESPONSE_MAX_BYTES);
  if (!body.ok) return { ok: false, reason: body.reason, logo: "", calls: 1 };
  let json;
  try { json = JSON.parse(body.text); } catch {
    return { ok: false, reason: "firecrawl_branding_invalid_json", logo: "", calls: 1 };
  }
  const data = plainObject(json) && json.success === true && plainObject(json.data) ? json.data : null;
  const branding = data && plainObject(data.branding) ? data.branding : null;
  const logo = branding && typeof branding.logo === "string" ? branding.logo.trim() : "";
  if (!/^https:\/\//i.test(logo)) return { ok: false, reason: "firecrawl_branding_no_logo", logo: "", calls: 1 };
  return { ok: true, logo, calls: 1 };
}

/**
 * Crawl a directory / chamber / association listing with Firecrawl and return
 * the business URLs it links to. The search lane deliberately skips directory
 * pages (they are not businesses); this recovers the businesses BEHIND a
 * directory by crawling it for links and handing those URLs back to the same
 * qualification funnel. Async: start a crawl, poll to completion, harvest
 * links. Bounded by the caller (a small directory allowance per run).
 */
async function firecrawlCrawl({
  url,
  apiKey,
  endpoint = DEFAULT_FIRECRAWL_CRAWL_ENDPOINT,
  // Sanity ceiling, not a spend throttle: a small-business site is <200 pages.
  limit = 200,
  fetchImpl = global.fetch,
  timeoutMs = 60_000,
  pollMs = 3_000,
  env = process.env,
} = {}) {
  if (firecrawlEmergencyStop(env)) return { ok: false, reason: "firecrawl_emergency_stop", urls: [], calls: 0 };
  if (!apiKey) return { ok: false, reason: "no_firecrawl_key", urls: [], calls: 0 };
  const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 60_000, 10_000), 120_000);
  const pollInterval = Math.min(Math.max(Number(pollMs) || 3_000, 1_000), 10_000);
  let startRes;
  try {
    startRes = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, limit, scrapeOptions: { formats: ["links"] } }),
      signal: AbortSignal.timeout(boundedTimeout),
    });
  } catch (e) {
    return { ok: false, reason: "firecrawl_crawl_unreachable", detail: String(e?.message || e).slice(0, 160), urls: [], calls: 1 };
  }
  if (!startRes.ok) return { ok: false, reason: `firecrawl_crawl_http_${startRes.status}`, urls: [], calls: 1 };
  const startBody = await readResponseTextBounded(startRes, FIRECRAWL_RENDER_RESPONSE_MAX_BYTES);
  if (!startBody.ok) return { ok: false, reason: startBody.reason, urls: [], calls: 1 };
  let startJson;
  try { startJson = JSON.parse(startBody.text); } catch { return { ok: false, reason: "firecrawl_crawl_invalid_json", urls: [], calls: 1 }; }
  const jobId = startJson && typeof startJson.id === "string" ? startJson.id : "";
  if (!jobId) return { ok: false, reason: "firecrawl_crawl_no_job_id", urls: [], calls: 1 };
  const deadline = Date.now() + boundedTimeout;
  while (Date.now() < deadline) {
    let pollRes;
    try {
      pollRes = await fetchImpl(`${endpoint}/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(Math.min(pollInterval + 2_000, 10_000)),
      });
    } catch (e) {
      return { ok: false, reason: "firecrawl_crawl_poll_unreachable", detail: String(e?.message || e).slice(0, 160), urls: [], calls: 1 };
    }
    if (!pollRes.ok) return { ok: false, reason: `firecrawl_crawl_poll_http_${pollRes.status}`, urls: [], calls: 1 };
    const pollBody = await readResponseTextBounded(pollRes, FIRECRAWL_RENDER_RESPONSE_MAX_BYTES);
    if (!pollBody.ok) return { ok: false, reason: pollBody.reason, urls: [], calls: 1 };
    let pollJson;
    try { pollJson = JSON.parse(pollBody.text); } catch { return { ok: false, reason: "firecrawl_crawl_poll_invalid_json", urls: [], calls: 1 }; }
    const status = pollJson && typeof pollJson.status === "string" ? pollJson.status : "";
    if (status === "completed" || status === "failed" || status === "cancelled") {
      if (status !== "completed") return { ok: false, reason: `firecrawl_crawl_${status}`, urls: [], calls: 1 };
      // The directory's own domain (navigation, other category pages) is not a
      // business; only off-domain https links are handed back.
      let crawlDomain = "";
      try { crawlDomain = registrableDomain(new URL(url).hostname); } catch { /* leave empty; no same-domain filter */ }
      const urls = [];
      const data = Array.isArray(pollJson.data) ? pollJson.data : [];
      for (const page of data) {
        const links = Array.isArray(page && page.links) ? page.links : [];
        for (const link of links) {
          if (typeof link !== "string") continue;
          if (!/^https:\/\//i.test(link)) continue; // skip tel:, mailto:, #anchors
          if (crawlDomain) {
            let linkDomain;
            try { linkDomain = registrableDomain(new URL(link).hostname); } catch { continue; }
            if (linkDomain === crawlDomain) continue; // the directory's own navigation
          }
          urls.push(link);
        }
      }
      return { ok: true, urls, calls: 1 };
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  return { ok: false, reason: "firecrawl_crawl_timeout", urls: [], calls: 1 };
}

function socialLinksFrom(html) {
  const out = {};
  for (const m of String(html || "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let host;
    try { host = new URL(m[1], "https://x.invalid").hostname; } catch { continue; }
    for (const [key, re] of SOCIAL_HOSTS) {
      if (!out[key] && re.test(host)) out[key] = m[1];
    }
  }
  return out;
}

/** Every plausible address on the page, in document order, deduped. */
function allEmails(html) {
  const found = [];
  const seen = new Set();
  const push = (raw) => {
    const clean = sanitizeEmail(String(raw || "").replace(/[.,;)]+$/, "")).toLowerCase();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    found.push(clean);
  };
  for (const m of String(html || "").matchAll(/mailto:([^"'?\s<>]+)/gi)) push(decodeURIComponent(m[1]));
  for (const m of String(html || "").matchAll(EMAIL_RE)) push(m[0]);
  return found.filter((e) => !JUNK_EMAIL.test(e));
}

// ---------------------------------------------------------------------------
// STAGE 4 — BRAND.  The gate that decides sendability.
// ---------------------------------------------------------------------------
//
// engine.js:401  status: !logoInDom ? "failed"
//                      : brandOut.logo && brandOut.accent ? "passed"
//                      : "unbranded"
//
// "unbranded" is not "passed", so NO LOGO => not revealable => unsendable. And
// `accent` comes from measureAccent(), which returns null unless a ranked colour
// has saturation >= 0.35 and luminance in [0.15, 0.85] — so a greyscale mark
// fetches fine, hashes fine, ships fine, and STILL yields "unbranded". Sourcing
// a logo is not passing this gate; the accent must be MEASURABLE. We run the
// engine's own measureAccent here so the answer cannot differ at build time.
// `max` was 4. The header-grade gate below can now skip a candidate that used
// to be accepted, so the list needs headroom for the real mark sitting behind
// the icon — on gopaschal.com the favicon is #1 and mainLogo.png is #2, on
// cardinalplumbingservice.com the Elementor 200x200 crop is #1 and the 535x467
// original is #2. Each extra slot costs at most one image GET, and only on a
// lead that would otherwise have been lost.
// THE COLOUR THE SITE DECLARES, for the mark whose bytes this runtime cannot
// decode. measureAccent reads PNG in pure JS and shells out to ffmpeg for every
// other format — and ffmpeg is not in the serverless runtime — so a JPEG or
// WebP logo measures null here however good it is. Before the mark is thrown
// away, read what the site says about itself: a meta theme-color, or the
// theme's own declared custom properties (`:root { --accent: #e31e24 }` is
// plain text in the HTML we ALREADY fetched — hurricanefenceinc.com declares
// exactly that). Only a saturated, mid-luminance colour qualifies, the same bar
// measureAccent holds a logo pixel to; a white theme-color or a navy --main
// abstains honestly.
function parseSiteColor(raw) {
  const s = String(raw || "").trim();
  let m = /^#([0-9a-fA-F]{6})\b/.exec(s);
  if (!m) m = /^#([0-9a-fA-F]{3})\b/.exec(s);
  if (m) {
    const hex = m[1].length === 3
      ? "#" + m[1].split("").map((c) => c + c).join("")
      : "#" + m[1];
    return hex.toUpperCase();
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  if (m) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, "0");
    return ("#" + h(m[1]) + h(m[2]) + h(m[3])).toUpperCase();
  }
  return "";
}

function usableSiteAccent(raw) {
  const hex = parseSiteColor(raw);
  if (!hex) return "";
  const hsl = hexToHsl(hex);
  if (!hsl) return "";
  if (hsl.s < 35 || hsl.l < 15 || hsl.l > 85) return "";
  return hex;
}

function siteAccentFromHtml(html) {
  const h = String(html || "");
  if (!h) return null;
  // 1. meta theme-color — the site's own claim about its chrome.
  const meta = /<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i.exec(h)
    || /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']theme-color["']/i.exec(h);
  if (meta) {
    const hex = usableSiteAccent(meta[1]);
    if (hex) return { hex, source: "meta_theme_color", method: "site_meta_theme_color" };
  }
  // 2. declared brand tokens, in accent-declaration priority order. WordPress
  // block themes, Elementor and Bricks all inline these in <style> blocks.
  for (const name of ["accent", "primary", "main", "brand"]) {
    const m = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\))`, "i").exec(h);
    if (m) {
      const hex = usableSiteAccent(m[1]);
      if (hex) return { hex, source: "css_root_token", method: `site_css_token(--${name})` };
    }
  }
  // 3. the commonest saturated hex literal in the page source. A last resort:
  // it is still first-party evidence (their own markup), still saturation-gated.
  const counts = new Map();
  for (const m of h.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const hex = `#${m[1].toUpperCase()}`;
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const ranked = [...counts.entries()]
    .filter(([hex]) => usableSiteAccent(hex))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length) {
    return { hex: ranked[0][0], source: "common_hex_in_source", method: "site_common_hex" };
  }
  return null;
}

async function resolveOwnLogo({
  siteUrl,
  html,
  businessName = "",
  max = 6,
  hintLogoUrl = "",
  hintAccentHex = "",
  hintAccentSource = "",
}) {
  // One ranker pass is the source of truth for both accepted candidates and
  // provenance refusals. This matters when a foreign header/home, touch-icon,
  // or CSS mark is rejected before a later owned-but-tiny icon reaches the
  // byte loop: the later icon may downgrade to a wordmark, but it can never
  // erase the earlier truth refusal.
  const ranked = rankLogoCandidates(html, siteUrl, businessName);
  const hardProvenanceFailure = rankedLogoProvenanceFailure(ranked, html, siteUrl);
  const candidates = ranked.candidates.slice(0, max).map((candidate) => candidate.url);
  // A Firecrawl branding hint is a strong signal (it sees CSS/JS marks the
  // static HTML ranker misses) but is still subject to the same ownsLogo /
  // denylist / sniff / measure pipeline below. It is tried first only because
  // the caller only supplies it after the HTML ranker already came up empty.
  if (hintLogoUrl && !candidates.includes(hintLogoUrl)) candidates.unshift(hintLogoUrl);
  if (!candidates.length) return {
    ok: false,
    reason: "no_own_domain_logo_candidate",
    fetches: 0,
    ...(hardProvenanceFailure ? { hardProvenanceFailure } : {}),
  };
  let fetches = 0;
  let lastReason = "no_own_domain_logo_candidate";
  // THE MARK AND THE COLOUR ARE TWO DIFFERENT QUESTIONS.
  //
  // Measured 2026-08-07 with ffmpeg off the PATH, which is what the serverless
  // runtime actually looks like: crownplumbingpdx.com's real mark is a JPEG,
  // mcindyplumbing.com's is a WebP, drainsurgeonaugusta.com's is a colourless
  // SVG. png-decode only reads PNG, so all three measured no accent and the
  // loop fell through to the first PNG on the page — which on WordPress is
  // always the 180x180 site icon. That is the whole mechanism behind the eleven
  // favicon headers: the pipeline was effectively selecting "the first PNG".
  //
  // Refusing the icon for the header (below) would then have dropped those
  // leads entirely, and the owner's rule is that a missing signal never blocks
  // a build. So a header-grade mark that cannot report its own colour is held,
  // and the colour is taken from ANOTHER LOGO CANDIDATE ON THE SAME SITE —
  // typically the very icon we refused, which is that same artwork cropped
  // (cropped-crown_logo_600h-1-1-180x180.png is a crop of crownlogo-002.jpg).
  // Every borrowed source has already passed ownsLogo and the third-party
  // denylist, so it is the client's own artwork by construction, and the source
  // URL is recorded in accent_method so the pick can be audited.
  let pendingMark = null;      // header-grade, but its own colour is unreadable here
  let borrowedAccent = null;   // a colour measured from another of THEIR OWN candidates
  // Declared site colour, read once from the HTML we already hold. Spent only
  // when a header-grade mark's OWN bytes cannot be decoded in this runtime.
  const siteAccent = siteAccentFromHtml(html);
  for (const url of candidates) {
    if (!/^https:\/\//i.test(url)) { lastReason = "logo_not_https"; continue; }
    if (!ownsLogo(siteUrl, url, businessName)) { lastReason = "logo_not_own_registrable_domain"; continue; }
    fetches++;
    let got;
    try { got = await guardedFetch(url); } catch (e) { lastReason = `logo_fetch_failed:${String(e.message || e).slice(0, 60)}`; continue; }
    const sniffed = sniffImage(got.bytes);
    if (!sniffed) { lastReason = "logo_not_an_image"; continue; }
    // THE HEADER SLOT IS NOT A FAVICON SLOT.
    //
    // Measured on the live mirrors 2026-08-07: eleven headers were serving a
    // site icon — 50x50, 57x57, and a band of 150x150 to 200x200 WordPress /
    // apple-touch crops — where the company name belongs. Nothing in the markup
    // reveals that; only decoding the bytes does. classifyHeaderMark measures
    // the file it was handed and refuses what is too small for the slot, so the
    // loop moves on to the next candidate, which is usually the client's real
    // mark that the icon was standing in front of.
    const shape = classifyHeaderMark(got.bytes, { url: got.finalUrl });
    if (!shape.ok) {
      // Too small to wear, still theirs to measure.
      if (!borrowedAccent) {
        const a = await measureAccent(got.bytes, sniffed.ext);
        if (a) borrowedAccent = { ...a, from: got.finalUrl };
      }
      lastReason = `logo_not_header_grade:${shape.kind}_${shape.width}x${shape.height}`;
      continue;
    }
    // AN SVG LOGO DECLARES ITS COLOURS AS TEXT. measureAccent decodes PIXELS,
    // so it returns null for every SVG mark — and a vector logo is what most
    // modern sites serve. That single blind spot rejected otherwise-perfect
    // leads as "accent_unmeasurable" and is why this funnel kept ending
    // 3 -> 0 at the brand stage across every vertical.
    //
    // This must stay in step with resolveBrandAssets (brand-assets.js), which
    // now resolves an SVG palette the same way: if the miner and the engine
    // disagree about whether a brand is measurable, the miner either throws
    // away buildable leads or admits ones the build will refuse.
    let accent = null;
    if (sniffed.ext === "svg") {
      const declared = paletteFromLogo({ bytes: got.bytes, contentType: sniffed.mime, url: got.finalUrl });
      if (declared) accent = { hex: declared.accent, method: "declared_in_logo_svg", share: 1, palette: declared.colors };
    }
    if (!accent) accent = await measureAccent(got.bytes, sniffed.ext);
    if (!accent) {
      // Hold it: a colour from a later candidate may rescue this mark.
      if (!pendingMark) pendingMark = { got, sniffed };
      lastReason = "accent_unmeasurable";
      continue;
    }
    return { ok: true, fetches, logo: markRecord(got, sniffed, accent) };
  }
  if (pendingMark && borrowedAccent) {
    return {
      ok: true, fetches,
      logo: markRecord(pendingMark.got, pendingMark.sniffed, {
        ...borrowedAccent,
        // Capped: this string is echoed into the funnel record and the accent
        // origin line, and a WordPress upload URL runs long.
        method: `${borrowedAccent.method}_from_own_site_asset(${String(borrowedAccent.from).slice(-80)})`,
      }),
    };
  }
  // THE EXTRACTOR'S ACCENT RESCUES THE HELD MARK (the Hurricane Fence case).
  //
  // A header-grade WebP mark measures null in this runtime (png-decode reads
  // PNG only; ffmpeg is not installed), and when no other own-domain candidate
  // lends a colour the mark was refused outright — which is how a red-and-blue
  // fencing company shipped a mirror wearing its donor's navy and gold. The
  // caller may now hand in an accent measured by lib/brand-extractor from the
  // SAME site's own CSS. The mark here has already passed ownsLogo, the
  // third-party denylist and the header-grade gate — only its colour was
  // unreadable — and the accent carries its own provenance string, so the pick
  // stays auditable. A measured-later logo accent still outranks it upstream:
  // resolveBrandAssets re-measures the bytes at build time and this value is
  // mirrored into brand.accent_fallback, which fills holes but never overrides
  // a measurement.
  if (pendingMark && /^#[0-9a-fA-F]{6}$/.test(String(hintAccentHex || "").trim())) {
    return {
      ok: true, fetches,
      logo: markRecord(pendingMark.got, pendingMark.sniffed, {
        hex: String(hintAccentHex).trim().toUpperCase(),
        method: `brand_identity_css_frequency(${String(hintAccentSource || "").slice(-80)})`,
        share: 0,
      }),
    };
  }
  // THE MARK IS WORTH MORE THAN THIS RUNTIME CAN DECODE — SAY SO, AND SHIP IT
  // ANYWAY. A header-grade mark that measures null here (a WebP, a JPEG — no
  // ffmpeg in serverless) used to fall through to a colourless wordmark, and
  // the site's real logo was thrown away by the same pipeline that had just
  // classified it. Measured on hurricanefenceinc.com (2026-09 diagnostic):
  // screenshot.webp, class custom-logo, 358x81, refused by no gate, dropped for
  // no accent — while `--accent: #e31e24` sat in a plain <style> block. Two
  // rescues, in rank order:
  //   · a declared site colour (meta theme-color / :root token / common hex)
  //     ships WITH the mark: the request carries logo + accent_fallback, and
  //     the engine — which cannot decode these bytes either — fills the accent
  //     from a colour the client's own page declared;
  //   · no colour anywhere: the mark's coordinates are persisted on the record
  //     (pendingLogo) so the render-time design brief, which HAS a real
  //     browser, can measure the page and re-attach the logo there. The
  //     wordmark that covers this case keeps whatever colour the site declared.
  if (pendingMark && siteAccent && /^https:\/\//i.test(siteUrl || "")) {
    return {
      ok: true,
      fetches,
      deferredAccent: true,
      logo: {
        url: pendingMark.got.finalUrl,
        sha256: createHash("sha256").update(pendingMark.got.bytes).digest("hex"),
        ext: pendingMark.sniffed.ext,
        mime: pendingMark.sniffed.mime,
        bytes: pendingMark.got.bytes.length,
        // Never claimed as measured. The engine's own measurement still runs
        // first wherever it CAN decode the bytes; this only fills its hole.
        accent: "",
        accent_method: `deferred_to_render_browser(unmeasurable_here:${pendingMark.sniffed.ext})`,
        accent_share: 0,
      },
      accentFallback: {
        hex: siteAccent.hex,
        source: siteUrl,
        method: siteAccent.method,
      },
    };
  }
  if (pendingMark) {
    return {
      ok: false,
      reason: lastReason,
      fetches,
      pendingLogo: {
        url: pendingMark.got.finalUrl,
        sha256: createHash("sha256").update(pendingMark.got.bytes).digest("hex"),
        ext: pendingMark.sniffed.ext,
        mime: pendingMark.sniffed.mime,
        bytes: pendingMark.got.bytes.length,
        reason: "accent_unmeasurable_in_miner",
      },
      ...(siteAccent ? { siteAccent: { ...siteAccent, source: siteUrl } } : {}),
      ...(hardProvenanceFailure ? { hardProvenanceFailure } : {}),
    };
  }
  return {
    ok: false,
    reason: lastReason,
    fetches,
    ...(hardProvenanceFailure ? { hardProvenanceFailure } : {}),
  };
}

function markRecord(got, sniffed, accent) {
  return {
    url: got.finalUrl,
    sha256: createHash("sha256").update(got.bytes).digest("hex"),
    ext: sniffed.ext,
    mime: sniffed.mime,
    bytes: got.bytes.length,
    accent: accent.hex,
    accent_method: accent.method,
    accent_share: accent.share,
  };
}

// ---------------------------------------------------------------------------
// STAGE 5 — EMAIL.  Outreach is email-only, so an unreachable address is a
// build with no delivery. This is NOT the old denylist: an address qualifies
// only by POSITIVE evidence — it is published on the business's own homepage,
// it is on their own registrable domain (or a consumer mailbox they chose to
// publish), its local-part is not structurally a non-route, and its domain
// actually has MX records. No message is ever sent to verify anything.
// ---------------------------------------------------------------------------

async function qualifyEmail({ emails, siteUrl, resolveMx = (d) => dnsPromises.resolveMx(d) }) {
  if (!emails.length) return { ok: false, reason: "no_email_published" };
  let siteDomain = "";
  try { siteDomain = registrableDomain(new URL(siteUrl).hostname); } catch { /* handled below */ }
  const rejects = [];
  for (const email of emails) {
    const [localPart, domain] = email.split("@");
    const emailDomain = registrableDomain(domain);
    // A role account (noreply@, webmaster@, abuse@) is a REAL mailbox on a real
    // domain — just not one a human reads. Name it non_business_localpart FIRST,
    // even though the placeholder guard below would also flag the noreply family
    // (isPlaceholderEmail is intentionally broad — see placeholder-email.test.js).
    // Ordering matters for the funnel counter: on a site whose only published
    // address is noreply@theirdomain, the honest killer is "role account", not
    // "template placeholder", so an operator isn't sent hunting a phantom.
    if (NON_BUSINESS_LOCALPART.test(localPart)) { rejects.push({ email, reason: "non_business_localpart" }); continue; }
    // A form-field placeholder ("your@email.com", "name@email.com") looks like a
    // published address but bounces. Refuse it by name, BEFORE the domain-ownership
    // check, so a genuine placeholder is never mislabelled a third-party domain.
    if (isPlaceholderEmail(email)) { rejects.push({ email, reason: "placeholder_email" }); continue; }
    const own = siteDomain && emailDomain === siteDomain;
    const consumer = CONSUMER_MAILBOX.has(emailDomain);
    if (!own && !consumer) {
      // The Jul-27 font-author class: an address on somebody ELSE's domain that
      // merely appeared in the page source. Never ours to write to.
      rejects.push({ email, reason: "third_party_domain", domain: emailDomain });
      continue;
    }
    let mx = [];
    try { mx = await resolveMx(domain); } catch { mx = []; }
    if (!mx.length) { rejects.push({ email, reason: "no_mx_record", domain }); continue; }
    return {
      ok: true,
      email,
      domain_class: own ? "own_registrable_domain" : "published_consumer_mailbox",
      mx: mx.map((r) => r.exchange).slice(0, 3),
      rejected: rejects,
    };
  }
  return { ok: false, reason: rejects.length ? rejects[0].reason : "no_email_published", rejected: rejects };
}

// ---------------------------------------------------------------------------
// STAGE 6 — NAP VERIFICATION.  The optional Google identity lookup (opted-in
// manual_exact lane only), on survivors only.
// ---------------------------------------------------------------------------

function addressComponent(place, type, prefer = "longText") {
  const parts = Array.isArray(place && place.addressComponents) ? place.addressComponents : [];
  const hit = parts.find((c) => Array.isArray(c && c.types) && c.types.includes(type));
  if (!hit) return "";
  return String(hit[prefer] || hit.longText || hit.shortText || "").trim();
}

/** Does Google's own type assignment contradict the trade we are about to build? */
function tradeSwapCheck({ place, vertical, html, env = process.env }) {
  const types = [place.primaryType, ...(Array.isArray(place.types) ? place.types : [])].filter(Boolean);
  if (vertical === "fencing" && sportFencingGuardEnabled(env)) {
    const fencing = fencingVerticalVerdict({
      intendedTrade: vertical,
      categories: types,
      businessName: placeName(place),
      siteText: String(html || "").replace(/<[^>]+>/g, " "),
    });
    if (!fencing.ok) {
      return {
        ok: false,
        reason: fencing.reason,
        observed: fencing.sportSignals,
        contractorSignals: fencing.contractorSignals,
        claimed: vertical,
      };
    }
    return {
      ok: true,
      corroboration: "fence_contracting_signals",
      observed: fencing.contractorSignals,
    };
  }
  const named = types.map((type) => ({ type, vertical: TRADE_TYPES[type] })).filter((row) => row.vertical);
  if (named.length) {
    // Google and the donor registry use different labels for several exact
    // service families (electrician/electrical, hair salon/salon, and general
    // contractor/construction). Compare their canonical template families,
    // not the spelling of the labels, or exact Google evidence becomes a false
    // trade swap before the sparse-site Intake bridge can run.
    const claimedFamily = templateFamilyForTarget(vertical);
    const matches = named.filter((row) => {
      const observedFamily = templateFamilyForTarget(row.vertical);
      return claimedFamily && observedFamily
        ? claimedFamily === observedFamily
        : row.vertical === vertical;
    });
    if (matches.length) {
      return { ok: true, corroboration: "google_place_type", observed: matches.map((row) => row.type) };
    }
    return { ok: false, reason: "trade_swap", observed: named.map((row) => row.vertical), claimed: vertical };
  }
  const generic = types.filter((t) => GENERIC_TRADE_TYPES.has(t));
  // No trade type at all: Google is silent, so the only remaining evidence is
  // the business's own site. That is a self-published corroboration and is
  // LABELLED as such — it is not independent, and the record says so.
  const word = new RegExp(`\\b${vertical.replace(/[^a-z ]/g, "").split(/\s+/).join("\\w*\\s+")}\\w*`, "i");
  if (word.test(String(html || "").replace(/<[^>]+>/g, " "))) {
    return { ok: true, corroboration: "self_published_only", observed: generic };
  }
  return { ok: false, reason: "vertical_uncorroborated", observed: types.slice(0, 6), claimed: vertical };
}

// ---------------------------------------------------------------------------
// THE METRO FENCE — is the business we resolved in the market we searched?
//
// THE INCIDENT (Jackson MS, 2026-08-06). The metro's ONLY build-ready lead was
// Liberty Plumbing of 7853 Draper Rd, Jackson, MICHIGAN — 700 miles from the
// market that was mined, (517) 937-8274, 42.149/-84.384 — and it cleared every
// gate. Nothing caught it because nothing ever compared the RESOLVED place to
// the QUERIED one: cityHint only composed the Places query string, the match was
// then accepted on registrable-domain equality alone, and latLngInState checks
// the NAP against ITS OWN state, so MI/MI passed with room to spare.
//
// WHY THE UNIT IS THE STATE. A metro is not a shape this codebase owns. There is
// no MSA boundary set here and no gazetteer, and inventing one would be the same
// class of defect as inventing a review. Two things we DO hold are exact and
// comparable: Google's administrative_area_level_1 on the resolved place, and
// the state the operator's own metro string carries ("Jackson MS", "Houston TX"
// — all 44 metros in the console rotation carry one, and all 57 build-ready rows
// in the store were mined from one). So the fence is drawn at the state line,
// and the funnel names it `out_of_metro_state` rather than "out of metro",
// because the counter must not claim a precision the check does not have.
//
// THE RESIDUE, STATED PLAINLY. This still admits a same-state lead from a
// different metro — Gulfport MS on a Jackson MS query. That is a worse lead, not
// a different business, and closing it needs metro-membership data we do not
// have. Every emitted record carries its `metro_fence` stamp, so the looser case
// is visible in the packet rather than hidden behind a green check.
//
// THE BORDER CASE IS REAL AND IS NOT WAVED THROUGH. Kansas City, Memphis,
// Cincinnati, St Louis, Portland and Charlotte are genuinely two-state metros; a
// plumber on the Kansas side of Kansas City is a legitimate Kansas City lead.
// Refusing every crossing throws real businesses away; admitting every crossing
// is how Jackson MI got in. So a crossing is allowed only on EVIDENCE, and only
// where a border can physically exist:
//
//   1. the business's OWN site must name the queried metro as the market it
//      sells into, WITH ITS STATE — serviceAreaAssertion(), the same
//      self-published market claim the engine already trusts to write the hero
//      headline. A Kansas-side plumber's own title says "Kansas City, MO".
//      Liberty Plumbing of Jackson MI never says "Jackson, MS".
//   2. the two states must actually touch. A metro border runs along a state
//      line, so a business three states away is not near one. MS and MI do not
//      touch, which refuses the Jackson case a second time on its own.
//
// A bare city-NAME match is deliberately NOT sufficient, because
// same-name-across-states IS the failure: Jackson MS/MI, Columbus OH/MS (already
// in the store — see the audit), Portland OR/ME, Springfield nearly everywhere.

// Land borders, each stated ONCE and mirrored below, so a typo cannot produce an
// asymmetric relation where A may cross into B but not B into A. Land only: MI
// and MN meet across Lake Superior and are deliberately absent, because the
// conservative reading of "near a border" costs a lead and the loose reading
// costs a customer's identity.
const US_STATE_BORDERS = `
AL-FL AL-GA AL-MS AL-TN AR-LA AR-MS AR-MO AR-OK AR-TN AR-TX AZ-CA AZ-CO AZ-NV
AZ-NM AZ-UT CA-NV CA-OR CO-KS CO-NE CO-NM CO-OK CO-UT CO-WY CT-MA CT-NY CT-RI
DC-MD DC-VA DE-MD DE-NJ DE-PA FL-GA GA-NC GA-SC GA-TN IA-IL IA-MN IA-MO IA-NE
IA-SD IA-WI ID-MT ID-NV ID-OR ID-UT ID-WA ID-WY IL-IN IL-KY IL-MO IL-WI IN-KY
IN-MI IN-OH KS-MO KS-NE KS-OK KY-MO KY-OH KY-TN KY-VA KY-WV LA-MS LA-TX MA-NH
MA-NY MA-RI MA-VT MD-PA MD-VA MD-WV ME-NH MI-OH MI-WI MN-ND MN-SD MN-WI MO-NE
MO-OK MO-TN MS-TN MT-ND MT-SD MT-WY NC-SC NC-TN NC-VA ND-SD NE-SD NE-WY NH-VT
NJ-NY NJ-PA NM-OK NM-TX NM-UT NV-OR NV-UT NY-PA NY-VT OH-PA OH-WV OK-TX OR-WA
PA-WV SD-WY TN-VA UT-WY VA-WV`;

const US_STATE_NEIGHBOURS = (() => {
  const map = new Map();
  const link = (a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  };
  for (const edge of US_STATE_BORDERS.trim().split(/\s+/)) {
    const [a, b] = edge.split("-");
    link(a, b);
    link(b, a);
  }
  return map;
})();

function statesAdjacent(a, b) {
  const set = US_STATE_NEIGHBOURS.get(String(a || "").toUpperCase());
  return Boolean(set && set.has(String(b || "").toUpperCase()));
}

/** The metro half of a mining plan, as {city, state}. Empty state = uncheckable. */
function metroOfPlan(location) {
  const raw = String(location || "").trim();
  // QUERY-SHAPE LADDERS (owner directive 2026-09-01), resolved FIRST because
  // ordinary parsing shreds them: "West Texas" would come back city "West" +
  // state TX (Texas is a state name), and "79401" carries no state at all.
  // Each ladder token lives in exactly ONE state, so the fence stays exact,
  // and the city keeps the token itself — the ZIP must remain "79401"
  // downstream so the deep-query shapes keep searching the ZIP SERP instead of
  // collapsing onto its metro name.
  const token = marketTokenLocation(raw);
  if (token) return { city: token.city, state: token.state };
  const parsed = normalizeUsLocation({ location: raw });
  const state = (parsed.state || "").toUpperCase();
  let city = parsed.city || "";
  // normalizeUsLocation reads a city that is ALSO a state name as the state and
  // blanks the city — "Washington DC" comes back {city:"", state:"DC"}. Recover
  // it from the raw string here rather than lose the strictest half of the
  // fence: with no metro city, the cross-border branch can never match and a
  // legitimate Arlington VA business in the DC metro is refused for a quirk of
  // a shared name.
  if (!city && state) {
    const m = new RegExp(`^(.*?)[,\\s]+${state}$`, "i").exec(raw);
    if (m && m[1].trim()) city = m[1].trim().replace(/[ ,]+$/, "");
  }
  return { city, state };
}

/**
 * metroFence({ metro, state, locality, assertion }) -> {ok, basis} | {ok:false, reason, detail}
 *
 * `metro` is the QUERIED market (metroOfPlan). `state`/`locality` are the
 * RESOLVED Google NAP. `assertion` is the business's own service-area claim, or
 * null. Never widens on absence: no assertion means no crossing.
 */
function metroFence({ metro = {}, state, locality, assertion }) {
  const queried = String(metro.state || "").toUpperCase();
  const resolved = String(state || "").toUpperCase();
  if (!queried) return { ok: false, reason: "metro_state_unstated" };
  if (!/^[A-Z]{2}$/.test(resolved)) return { ok: false, reason: "nap_no_state_code" };

  const where = `queried ${metro.city || "?"} ${queried} -> resolved ${locality || "?"} ${resolved}`;
  if (resolved === queried) {
    return { ok: true, basis: "metro_state_match", queried: `${metro.city}, ${queried}`, resolved: `${locality}, ${resolved}` };
  }

  const assertedState = String((assertion && assertion.state) || "").toUpperCase();
  const assertedCity = normalizeIdentityToken((assertion && assertion.city) || "");
  const metroCity = normalizeIdentityToken(metro.city || "");
  const said = assertion ? `${assertion.city || "?"} ${assertion.state || "--"} (${assertion.surface})` : "nothing";
  if (!assertedState || assertedState !== queried || !metroCity || assertedCity !== metroCity) {
    return { ok: false, reason: "out_of_metro_state", detail: `${where}; own site asserts ${said}` };
  }
  if (!statesAdjacent(queried, resolved)) {
    return { ok: false, reason: "out_of_metro_state", detail: `${where}; own site names the metro but ${resolved} does not border ${queried}` };
  }
  return {
    ok: true,
    basis: "cross_border_metro_self_asserted",
    queried: `${metro.city}, ${queried}`,
    resolved: `${locality}, ${resolved}`,
    evidence: { surface: assertion.surface, asserted: `${assertion.city}, ${assertion.state}`, border: `${queried}-${resolved}` },
  };
}

// `breaker` is injectable so a test can exercise the blast radius without
// sharing (or mutating) the module-level provider breaker, which would make
// the suite order-dependent.
function napFromPlace(match, httpCalls = 0) {
  const locality = addressComponent(match, "locality") || addressComponent(match, "postal_town");
  const state = (addressComponent(match, "administrative_area_level_1", "shortText") || "").toUpperCase();
  if (!locality) return { ok: false, reason: "nap_no_locality", place_id: match.id, providerAtFault: false, httpCalls };
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, reason: "nap_no_state_code", place_id: match.id, providerAtFault: false, httpCalls };
  const lat = Number(match.location && match.location.latitude);
  const lng = Number(match.location && match.location.longitude);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
  if (hasGeo) {
    const geo = latLngInState({ latitude: lat, longitude: lng, state });
    if (geo.known && !geo.ok) return { ok: false, reason: "state_bbox_violation", place_id: match.id, providerAtFault: false, httpCalls };
  }
  return {
    ok: true,
    httpCalls,
    place: match,
    locality,
    state,
    latitude: hasGeo ? lat : null,
    longitude: hasGeo ? lng : null,
    county: addressComponent(match, "administrative_area_level_2"),
    postal_code: addressComponent(match, "postal_code", "shortText"),
  };
}

async function verifyNapForCandidate({ key, name, cityHint, siteDomain, siteUrl = "", fetchImpl, breaker = discoveryBreaker, maxQueries = 2, retries }) {
  // TWO QUERIES, CHEAPEST-FIRST. The name is scraped from a page <title>, which
  // for a small business is often marketing copy ("Tulsa's Best Fencing Since
  // 1994") rather than the name Google indexes. Measured 2026-08-01: every
  // candidate that reached this stage died on nap_not_found_for_domain while
  // Places itself was healthy and returning rows — the query was wrong, not the
  // key. The domain is the one string both sources agree on, so it is the
  // fallback. `maxQueries`/`retries` let the opted-in single-lookup lane bound
  // this to exactly one HTTP attempt; shared callers keep the defaults.
  const facebookIdentity = facebookPageIdentity(siteUrl);
  const fallbackIdentity = facebookIdentity ? siteUrl : siteDomain;
  const queries = [`${name} ${cityHint}`.trim(), `${fallbackIdentity} ${cityHint}`.trim()]
    .slice(0, Math.max(1, Math.trunc(Number(maxQueries) || 0)));
  const domainOf = (u) => { try { return registrableDomain(new URL(u).hostname); } catch { return ""; } };

  let match = null;
  let searched = "";
  let returned = 0;
  // Real HTTP requests this candidate cost, summed across both queries and
  // every bounded retry inside them. Reported so the ledger can stop counting
  // LEADS and start counting CALLS.
  let httpCalls = 0;
  for (const q of queries) {
    if (!q || (match)) break;
    const page = await searchPlacesPage({ key, textQuery: q, pageSize: 10, fetchImpl, breaker, retries });
    httpCalls += page.httpCalls || 0;
    if (!page.ok) {
      // A REFUSAL CARRIES ITS REASON. Previously this returned the mode alone
      // ("places_error"), the caller logged the mode alone, and the underlying
      // status and the provider's message were discarded — so a funnel that
      // died at stage 6 told nobody WHY. detail is the operator-facing string;
      // status and fault are kept structured for the events record.
      const detail = [page.error, page.fault].filter(Boolean).join(" — ") ||
        `discovery provider ${page.status || "failure"}`;
      return {
        ok: false,
        reason: page.mode,
        detail,
        status: page.status || null,
        fault: page.fault || null,
        query: q,
        // False for a per-lead 4xx: this candidate failed, the provider did not.
        providerAtFault: Boolean(page.countedAgainstProvider) || page.mode === "provider_down",
        httpCalls,
        provider: page,
      };
    }
    searched = q;
    returned = (page.places || []).length;
    // A website that resolves to the same registrable domain is the normal
    // identity proof. Facebook is the one shared-host exception: facebook.com
    // alone proves nothing, so its exact page path/profile id must agree with
    // the GBP website field before the place can be adopted or score 100.
    match = (page.places || []).find((p) => {
      if (!p.websiteUri) return false;
      if (facebookIdentity) return facebookPageIdentity(p.websiteUri) === facebookIdentity;
      return domainOf(p.websiteUri) === siteDomain;
    }) || null;
  }
  // A clean 200 that simply contains no business at this domain. The provider
  // worked perfectly; this lead has no Google match. It is not, and must never
  // be counted as, a provider failure.
  if (!match) {
    return {
      ok: false, reason: "nap_not_found_for_domain", searched, returned,
      detail: `searched "${searched}" — ${returned} result(s), none on ${siteDomain}`,
      providerAtFault: false, httpCalls,
    };
  }
  return napFromPlace(match, httpCalls);
}

// ---------------------------------------------------------------------------
// FIRST-PARTY IDENTITY — the zero-Places lane.
// ---------------------------------------------------------------------------
//
// FIRST-PARTY IDENTITY (2026-08-25): Places is optional, and when no Google
// observation exists identity comes from the prospect's own homepage bytes.
// STRICT: it requires SEPARATE STRUCTURED first-party fields — a schema.org
// JSON-LD business name plus a PostalAddress locality+region. A marketing
// <title>, og tag or service-area claim is MARKET copy, never NAP, and one
// string is never both the name and the place. Without those fields the
// candidate is QUARANTINED, never passed with the queried city. Market fencing
// happens downstream in the standard metroFence, same as the Google lane.
// Accepted schema.org business types — EXACT normalized names (a plain name
// or a schema.org URL tail), never substrings: Disorganization is not an
// Organization and MyPlumberArticle is not a Plumber. LocalBusiness and
// Organization families plus the local-business subtypes our verticals
// publish. Bare Service, Person, WebSite and Article are NOT identity carriers.
const FIRST_PARTY_BUSINESS_TYPES = new Set([
  "localbusiness", "organization", "generalcontractor",
  "homeandconstructionbusiness", "professionalservice",
  "plumber", "electrician", "roofingcontractor", "hvacbusiness",
  "dentist", "hairsalon", "beautysalon", "nailsalon", "dayspa",
  "realestateagent", "autorepair", "tattooparlor", "massagebusiness",
  "legalservice", "barbershop", "medicalbusiness", "healthandbeautybusiness",
  "pestcontrolservice", "store",
]);

// ---------------------------------------------------------------------------
// IDENTITY TRUST MODE (owner directive 2026-08-31).
//
// TRUST THE SITE: whatever NAP the business's own site carries is good, and a
// human corrects the details over the phone later. Google Places is OPTIONAL
// enrichment, never a dependency — a business with no Google observation is
// an underserved lead, not a defect. In trust mode the first-party identity
// stage is advisory: a candidate the strict lane quarantined for missing
// structured NAP proceeds with the name/phone/place the site itself
// published, and a lead the metro fence refused for another state keeps the
// SITE's market, tagged identity_trust_overridden:out_of_metro_state for
// audit. The strict quarantine and fence refusals are restored exactly —
// held rows, funnel counts and all — by GHOST_AGENCY_IDENTITY_TRUST=0.
// ---------------------------------------------------------------------------
const TRUSTED_IDENTITY_REASONS = new Set([
  "identity_unverified_first_party",
  "operator_intake_identity_incomplete",
]);

/** Trust mode is ON by default; only the explicit kill switch restores strict. */
function identityTrustEnabled(env = process.env) {
  const raw = String((env && env.GHOST_AGENCY_IDENTITY_TRUST) ?? "1").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
}

/** "https://schema.org/Dentist" | "Dentist" -> "dentist"; anything else -> "". */
function normalizedSchemaType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return (raw.split(/[/#]/).pop() || "").replace(/[^a-z]/g, "");
}

function firstPartyIdentity({ html = "", ldNodes = [], url = "" }) {
  const text = String(html || "");
  const attr = (re) => { const m = re.exec(text); return m ? m[1].trim() : ""; };
  // Parse EVERY accepted business node, then pick the best COMPLETE one
  // (nonempty name + PostalAddress locality+region) — a partial Organization
  // earlier in the document must not shadow a complete node after it.
  const parsedNodes = (Array.isArray(ldNodes) ? ldNodes : [])
    .filter((n) => n && typeof n === "object")
    .filter((n) => {
      const types = [].concat(n["@type"] || []).map(normalizedSchemaType);
      return types.some((t) => FIRST_PARTY_BUSINESS_TYPES.has(t))
        && (typeof n.name === "string" || n.address || n.telephone);
    })
    .map((n) => {
      const name = typeof n.name === "string" ? n.name.trim().slice(0, 120) : "";
      const address = n.address ? (Array.isArray(n.address) ? n.address[0] : n.address) : null;
      let locality = "";
      let state = "";
      let postal = "";
      if (address && typeof address === "object") {
        const cityRaw = String(address.addressLocality || "").trim();
        const region = stateCodeOf(String(address.addressRegion || "").trim());
        if (cityRaw && region) {
          locality = cityRaw.slice(0, 80);
          state = region;
          postal = String(address.postalCode || "").trim().slice(0, 16);
        }
      }
      const telephone = typeof n.telephone === "string" ? n.telephone.trim().slice(0, 40) : "";
      return { name, locality, state, postal, telephone };
    });
  const businessNode = parsedNodes.find((n) => n.name && n.locality && n.state)
    || parsedNodes.find((n) => n.name)
    || parsedNodes[0]
    || null;

  const name = (businessNode && businessNode.name) || "";
  const locality = (businessNode && businessNode.locality) || "";
  const state = (businessNode && businessNode.state) || "";
  const postal = (businessNode && businessNode.postal) || "";

  const missing = [
    ...(name ? [] : ["business_name"]),
    ...(locality && state ? [] : ["locality", "state"]),
  ];

  // THE PHONE, optional exactly as on the Google path — read BEFORE the
  // strict verdict so identity-trust mode can carry the number the site
  // publishes even when the structured NAP is incomplete.
  let phone = "";
  let phoneSurface = "";
  if (businessNode && businessNode.telephone) {
    phone = businessNode.telephone;
    phoneSurface = "schema_org_telephone";
  } else {
    const tel = attr(/href\s*=\s*["']tel:([^"']+)["']/i);
    if (tel) {
      let decoded = tel;
      try { decoded = decodeURIComponent(tel); } catch { /* keep the raw href */ }
      phone = decoded.trim().slice(0, 40);
      phoneSurface = "tel_link";
    }
  }

  if (missing.length) {
    return {
      ok: false,
      reason: "identity_unverified_first_party",
      missing,
      detail: `own site publishes no structured ${missing.join(", ")} (schema.org name + PostalAddress required) — quarantined for review, never defaulted from the query`,
      // Whatever the site DID publish, for identity-trust mode to carry on.
      partial: { name, locality, state, postal, telephone: phone, phoneSurface },
    };
  }

  return {
    ok: true,
    identity: {
      ok: true,
      source: "first_party",
      httpCalls: 0,
      place: null,
      name,
      nameSurface: "schema_org_name",
      locality,
      state,
      latitude: null,
      longitude: null,
      county: "",
      postal_code: postal,
      phone,
      phoneSurface,
      addressSurface: "schema_postal_address",
      evidenceUrl: url,
    },
  };
}

/**
 * Temporary operator identity used only to carry a reachable first-party site
 * into the signed Intake Genie compile. The name comes from the site's own
 * visible HTML. City/state are explicitly marked as the operator's requested
 * market, never presented as postal NAP. Intake must replace or corroborate
 * them before a live build can leave the owner-only pipeline.
 */
function operatorWebsiteIntakeIdentity({ parsed = {}, metro = {}, url = "" }) {
  const clean = (value) => String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  const h1Name = clean(parsed.h1);
  const titleName = clean(parsed.title).split(/[|–—]/)[0].trim();
  const name = (h1Name || titleName).slice(0, 120);
  const locality = clean(metro.city).slice(0, 80);
  const state = stateCodeOf(clean(metro.state));
  const missing = [
    ...(name ? [] : ["business_name"]),
    ...(locality && state ? [] : ["operator_market"]),
  ];
  if (missing.length) {
    return {
      ok: false,
      reason: "operator_intake_identity_incomplete",
      missing,
      // Whatever the site DID publish, for identity-trust mode to carry on.
      partial: { name, locality, state },
    };
  }
  return {
    ok: true,
    identity: {
      ok: true,
      source: "owner_only_practice_intake_bridge",
      httpCalls: 0,
      place: null,
      name,
      nameSurface: h1Name ? "html_h1" : "html_title",
      locality,
      state,
      latitude: null,
      longitude: null,
      county: "",
      postal_code: "",
      phone: "",
      phoneSurface: "",
      addressSurface: "operator_market_hint",
      provisionalMarket: true,
      evidenceUrl: url,
    },
  };
}

/**
 * IDENTITY TRUST MODE — the site-truth identity a strict refusal becomes.
 *
 * Every field the site DID publish rides through verbatim; a field it did not
 * (locality/state) is carried as the queried market, explicitly labelled a
 * hint. Nothing here is invented and nothing here is tagged: an absent Google
 * observation or an incomplete schema block is not a failure, so the row
 * proceeds clean and the provenance names exactly what was observed. The one
 * tag this stage still mints — out_of_metro_state — belongs to the metro
 * fence, where a real refusal really is being overridden.
 */
function trustedNapFromRefusal({ refusal = {}, nameHint = "", parsed = {}, metro = {}, url = "" }) {
  const partial = (refusal && refusal.partial) || {};
  const clean = (value) => String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  const h1Name = clean(parsed.h1).slice(0, 120);
  const titleName = clean(parsed.title).split(/[|–—]/)[0].trim().slice(0, 120);
  const name = String(partial.name || h1Name || titleName || nameHint || "").trim().slice(0, 120);
  const siteLocality = String(partial.locality || "").trim().slice(0, 80);
  const siteState = stateCodeOf(String(partial.state || ""));
  const marketCity = String((metro && metro.city) || "").trim().slice(0, 80);
  const marketState = stateCodeOf(String((metro && metro.state) || ""));
  return {
    ok: true,
    source: "first_party",
    httpCalls: 0,
    place: null,
    name,
    nameSurface: partial.name ? "schema_org_name" : (h1Name ? "html_h1_trust" : "html_title_trust"),
    locality: siteLocality || marketCity,
    state: siteState || marketState,
    latitude: null,
    longitude: null,
    county: "",
    postal_code: String(partial.postal || "").trim().slice(0, 16),
    phone: String(partial.telephone || "").trim().slice(0, 40),
    phoneSurface: String(partial.phoneSurface || ""),
    addressSurface: siteLocality ? "schema_postal_address" : "queried_market_trust_hint",
    evidenceUrl: url,
    identity_trust: {
      reason: String(refusal.reason || "identity_unverified_first_party"),
      missing: Array.isArray(refusal.missing) ? refusal.missing.slice(0, 4) : [],
      site_locality: Boolean(siteLocality),
      site_state: Boolean(siteState),
    },
  };
}

// ---------------------------------------------------------------------------
// STAGE 7 — IDENTITY + SLUG.  Identity is normalised name + CITY, never name
// alone: a multi-location brand is several separate leads and several separate
// mirrors, and collapsing them would bind one slug to two businesses.
// ---------------------------------------------------------------------------

function normalizeIdentityToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(llc|inc|co|corp|corporation|company|ltd|the|and)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function identityKeyFor(name, city) {
  return `${normalizeIdentityToken(name)}|${normalizeIdentityToken(city)}`;
}

/** wss-test-<name>-<city>, <=63 chars, coherent with name or city by construction. */
function mintSlug(name, city) {
  const base = `${normalizeIdentityToken(name)} ${normalizeIdentityToken(city)}`.trim().replace(/\s+/g, "-");
  let slug = `wss-test-${base}`.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/-+$/g, "");
  if (slug.length > 63) {
    slug = slug.slice(0, 63).replace(/-+$/g, "");
  }
  return slug;
}

/**
 * Stable SOURCE identity for a mined business.  A wss-test-* slug names a
 * future generated deployment; it must never double as the prospect identity
 * or a brand-new source becomes indistinguishable from historical inventory.
 */
function sourceProspectId(rec = {}) {
  const raw = String(rec.lead_id || "").trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(raw) && !/^wss-test-/i.test(raw)) return raw;
  const identity = String(rec.identity_key || raw || [
    rec.mirror_request?.facts?.business_name,
    rec.mirror_request?.facts?.city,
    rec.discovery?.url,
  ].filter(Boolean).join("|"));
  return `lm-${createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 40)}`;
}

// ---------------------------------------------------------------------------
// THE RECORD
// ---------------------------------------------------------------------------
//
// Everything the contract requires lands inside the existing `record` JSON blob
// under a versioned key. ZERO migrations: the 7 held LeadMiner migrations are
// destructive and unauthorised, and nothing here needs them.
//
// Every field carries {value, source, observer, method}. A field with no
// provenance is not a fact and is not written — `null`, `""`, `0` and a
// plausible guess are all defects, so an unverified field is simply ABSENT.

function prov(value, source, observer, method, extra = {}) {
  return { value, source, observer, method, ...extra };
}

/** The exact, schema-valid MirrorRequest for an emitted record. Deep copy. */
function mirrorRequestFrom(record) {
  const br = (record && (record.build_ready || (record.record && record.record.build_ready))) || null;
  if (!br || !br.mirror_request) return null;
  return JSON.parse(JSON.stringify(br.mirror_request));
}

// ---------------------------------------------------------------------------
// THE FUNNEL
// ---------------------------------------------------------------------------

function funnelStage(name, cost) {
  return { stage: name, cost, entered: 0, survived: 0, rejected: {} };
}

function reject(stage, reason) {
  stage.rejected[reason] = (stage.rejected[reason] || 0) + 1;
}

// THIN-FLOW LAW (owner doctrine 2026-09-04, "scaling and rapid production
// flow"): the quality ceilings — website axis, composite signal, first-party
// template fit — are MEASUREMENTS, not refusals. A candidate a ceiling would
// have refused proceeds instead, and the stage records the acceptance on its
// row as `accepted_thin` so telemetry shows the law working instead of a
// silent pass. The score itself still rides the record
// (qualification.website_axis / composite_signal / template_fit), so bank
// provenance and every downstream audit keep the number. Arithmetic is
// untouched: accepted_thin candidates sit inside `survived`, and
// entered === survived + Σ rejected keeps reconciling.
function acceptThin(stage, reason) {
  stage.accepted_thin = stage.accepted_thin || {};
  stage.accepted_thin[reason] = (stage.accepted_thin[reason] || 0) + 1;
}

// ---------------------------------------------------------------------------
// WHY THE LEADS DIED — PERSISTED, NOT JUST RETURNED
// ---------------------------------------------------------------------------
//
// `rejects` is the per-candidate record of every elimination the funnel made,
// and until now it existed only for the length of one HTTP response. The
// aggregate mining yield is 3.2% (4,684 Firecrawl results -> 150 build-ready)
// and nobody could tell whether that is the market or our own grader, because
// the evidence was thrown away the moment the run returned. Worse, stage 8
// refuses ~32% of leads that EACH already cost discovery and fetch work, and
// the DETAIL naming what the dry-run build actually objected to was the part
// that got dropped.
//
// It is written back as a GROUPED summary rather than the raw array: a 500-lead
// run can eliminate thousands of candidates, and an unbounded blob in the event
// store is how a diagnostic turns into an outage. Counts are exact at every
// stage/reason pair; the free-text details are sampled and truncated.
const REJECT_MAX_GROUPS = 40;
const REJECT_MAX_EXAMPLES = 3;
const REJECT_DETAIL_CHARS = 160;
const REJECT_CANDIDATE_CHARS = 120;

/**
 * summarizeRejects(rejects) -> { total, groups[], groupsTruncated }
 *
 * One group per (stage, reason) with an EXACT count, ordered by count so the
 * biggest killer is first and survives the group cap. Each group carries up to
 * three example candidates with their detail where one exists — that detail is
 * the whole answer to "what did the dry run object to?".
 */
function summarizeRejects(rejects) {
  const list = Array.isArray(rejects) ? rejects : [];
  const byKey = new Map();
  for (const item of list) {
    if (!item) continue;
    const stage = String(item.stage || "unknown");
    const reason = String(item.reason || "unstated");
    const key = `${stage}\u0000${reason}`;
    let group = byKey.get(key);
    if (!group) {
      group = { stage, reason, count: 0, examples: [] };
      byKey.set(key, group);
    }
    group.count++;
    if (group.examples.length < REJECT_MAX_EXAMPLES) {
      const example = {};
      if (item.candidate) example.candidate = String(item.candidate).slice(0, REJECT_CANDIDATE_CHARS);
      if (item.detail) example.detail = String(item.detail).slice(0, REJECT_DETAIL_CHARS);
      if (Array.isArray(item.problems) && item.problems.length) {
        example.problems = item.problems.slice(0, 4);
      }
      // An example with neither field says nothing the count does not already
      // say, so it is not stored.
      if (example.candidate || example.detail || example.problems) group.examples.push(example);
    }
  }
  const groups = [...byKey.values()].sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage));
  return {
    total: list.length,
    groups: groups.slice(0, REJECT_MAX_GROUPS),
    groupsTruncated: Math.max(0, groups.length - REJECT_MAX_GROUPS),
  };
}

/**
 * mineBuildReady(input) -> { ok, mode, funnel[], cost, records[], rejects[] }
 *
 * Emits ONLY records that have passed every engine gate, each proven by a real
 * dry-run build. `funnel` is the measured elimination at each stage and must
 * reconcile: entered(stage n) === survived(stage n) + sum(rejected(stage n)).
 *
 * THIN-FLOW LAW (owner doctrine 2026-09-04): the three quality stages
 * (3_website_axis_ceiling, 6a_first_party_template_fit, 6b_composite_ceiling)
 * still measure and still record — on the stage row as `accepted_thin`, on the
 * packet as qualification.* — but a low score no longer refuses. Refusals are
 * reserved for identity failure, unreachable/broken sources, and the other
 * non-quality hard gates.
 */
async function mineBuildReady(input = {}) {
  const env = input.env || process.env;
  const placesKey = String(env.GOOGLE_PLACES_API_KEY || "").trim();
  const firecrawlKey = String(env.FIRECRAWL_API_KEY || "").trim();
  const donorRoot = input.donorRoot;
  const fetchImpl = input.fetchImpl || global.fetch;
  const resolveMx = input.resolveMx || ((d) => dnsPromises.resolveMx(d));
  const mirrorImpl = input.mirrorImpl || mirror;
  const placesBreaker = input.discoveryBreaker || discoveryBreaker;
  const perQuery = numberInRange(input.candidatesPerQuery, 20, 1, 100);
  const operatorLine = String(input.trigger || "") === "operator_line";
  // Admission relief is an owner-only delivery policy, not an operator-Line
  // default. Accept only the two explicit names used by the Console contract;
  // a missing, unknown, or live value fails closed onto the production gates.
  const requestedAdmissionMode = String(input.lane || input.mode || "").trim().toLowerCase();
  const ownerOnlyPractice = operatorLine
    && (requestedAdmissionMode === "sandbox" || requestedAdmissionMode === "practice");
  // SEARCH WIDTH vs PROOF POOL. The discovery search asks for the full wide
  // SERP (GHOST_AGENCY_SEARCH_LIMIT, default 50, provider max 100) so the
  // funnel sees enough businesses to survive directory hits, dedup and dead
  // links — "fish in a barrel". The paid/slow PROOF pool below is bounded by
  // the quota (candidatesPerQuery) by default, so a wide search never turns a
  // 3-site batch into 50 dry-run builds; LINE_DEEP_BATCH_DEPTH is the one
  // owner dial that widens that wave deliberately.
  const operatorDiscoveryLimit = operatorLine ? Math.max(perQuery, firecrawlSearchLimit(env)) : perQuery;
  // DEEP-VERIFICATION WAVE. The proof pool is how many email-surviving
  // candidates enter stages 6-8 (identity, fit, composite, slug, dry-run
  // build). LINE_DEEP_BATCH_DEPTH raises it above the goal-sized cohort so
  // every email survivor can be deep-verified in one wave; unset keeps the
  // historical goal-sized pool exactly (see lineDeepBatchDepth above).
  const operatorProofPool = operatorLine
    ? Math.max(perQuery, 5, lineDeepBatchDepth(env))
    : perQuery;
  const refillRound = Math.max(0, Math.trunc(Number(input.refillRound) || 0));
  const fixedMarketSource = String(input.sourceMode || "fixed_market").trim() === "fixed_market";
  // `placesVerify: true` opts in ONLY the explicit manual_exact trigger with an exact
  // single-candidate shape (one dispatched market, candidatesPerQuery === 1,
  // non-bulk). The manual_exact lookup runs one query with
  // zero retries: at most ONE outbound HTTP attempt. Provider failure on it is
  // NONTERMINAL (first-party fallback); a healthy no-match still refuses.
  const placesLane = Boolean(placesKey)
    && input.placesVerify === true
    && String(input.trigger || "") === "manual_exact"
    && input.bulk !== true
    && dispatchQueryPlans(input.queries || [], input.queryShapeCursor, input.queryGroupOffset).length === 1
    && input.candidatesPerQuery === 1;
  let placesVerified = false;
  // Rendered-identity fallback pool. The old cost law held this at a literal
  // ONE scrape per run with no way to raise it; it now draws from the same
  // generous sanity ceiling as homepage-HTML recovery (one rendered scrape
  // per candidate site, up to 200 per run). The only hard stop left is the
  // emergency kill-switch, checked inside every Firecrawl helper.
  const operatorLineFallbackCap = operatorLineFirecrawlFallbackLimit(input, env);
  let operatorLineFallbacksRemaining = operatorLineFallbackCap;
  const operatorLineFallbackAvailable = () => operatorLineFallbackCap === null || operatorLineFallbacksRemaining > 0;
  const consumeOperatorLineFallback = () => {
    if (operatorLineFallbackCap === null) return true;
    if (operatorLineFallbacksRemaining <= 0) return false;
    operatorLineFallbacksRemaining -= 1;
    return true;
  };
  // Per-run sanity ceiling on Firecrawl homepage-HTML recovery. When a
  // prospect's own site refuses the free GET (403/429 anti-bot) the pipeline
  // falls back to one Firecrawl scrape for the HTML; this bounds the batch at
  // one scrape per candidate site (200/run) — a work bound, never a spend
  // refusal. The counters still meter every scrape on the cost ledger.
  const scrapeFallbackCap = homepageScrapeFallbackEnabled(env)
    ? Math.max(0, homepageScrapeFallbackLimit(env))
    : 0;
  let homepageScrapeFallbacksRemaining = operatorLineFallbackCap === null
    ? scrapeFallbackCap
    : Math.min(scrapeFallbackCap, operatorLineFallbackCap);
  let renderedScrapesRemaining = operatorLineFallbackCap === null
    ? scrapeFallbackCap
    : Math.min(scrapeFallbackCap, operatorLineFallbackCap);

  // GOOGLE REPORTING IS LAZY. A manual_exact run whose
  // candidate never reaches the optional lookup is a zero-Places run in fact,
  // so it reports skipped. Website-first operator runs do not call Places.
  let providerHealthAtStart = null;

  const cost = {
    firecrawl_search_calls: 0, firecrawl_scrape_calls: 0, firecrawl_branding_calls: 0,
    homepage_fetches: 0, homepage_scrape_fallbacks: 0, logo_fetches: 0, places_calls: 0,
    dns_mx_lookups: 0, dry_runs: 0,
    // Maps discovery meters in the SAME ledger: one maps scrape is one paid
    // Firecrawl call (reported separately so the owner can price the lane).
    maps_scrape_calls: 0,
    // The photo bank's own two meters, declared here so a run that banked
    // nothing still reports zero rather than an absent key.
    photo_page_fetches: 0, places_photo_media_calls: 0,
  };
  const stages = {
    s0: funnelStage("0_vertical_donor_gate", "free"),
    s1: funnelStage("1_discovery_firecrawl", "firecrawl_search"),
    s2: funnelStage("2_homepage_fetch", "free_http_get"),
    s3: funnelStage("3_website_axis_ceiling", "free"),
    s4: funnelStage("4_brand_logo_and_accent", "1_image_get"),
    s5: funnelStage("5_email", "free_plus_dns_mx"),
    s6: funnelStage(operatorLine ? "6_first_party_identity" : "6_nap_verification", "first_party_zero_google"),
    s6fit: funnelStage("6a_first_party_template_fit", "free"),
    s6b: funnelStage("6b_composite_ceiling", "free"),
    s7: funnelStage("7_identity_and_slug", "free"),
    s8: funnelStage("8_dry_run_build_proof", "free_zero_vercel"),
  };
  const refreshStage6Cost = () => {
    const google = cost.places_calls > 0;
    const rendered = cost.firecrawl_scrape_calls > 0;
    stages.s6.cost = google && rendered
      ? "google_places_plus_firecrawl_render"
      : google
        ? "google_places"
        : rendered
          ? "first_party_plus_firecrawl_render"
          : "first_party_zero_google";
  };
  const rejects = [];
  const note = (stage, key, candidate, reason, detail, problems) => {
    reject(stage, reason);
    rejects.push({
      stage: stage.stage,
      candidate: key,
      reason,
      ...(detail ? { detail } : {}),
      ...(Array.isArray(problems) && problems.length ? { problems } : {}),
    });
  };

  // ---- STAGE 0 -------------------------------------------------------------
  const plans = [];
  for (const query of input.queries || []) {
    stages.s0.entered++;
    // THE METRO MUST NAME ITS STATE, and it is refused HERE — before one
    // search call, one homepage GET or one paid Places lookup is spent on a
    // market whose leads could never be checked against it. "plumbing in Austin"
    // cannot be fenced; "plumbing in Austin TX" can. Refusing 20 candidates
    // one-by-one at stage 6 would bill for the whole funnel and then blame the
    // leads for a defect in the plan.
    const metro = metroOfPlan(query.location);
    if (!metro.state) { note(stages.s0, query.textQuery, null, "metro_state_unstated", String(query.location || "")); continue; }
    const donor = resolveBuildableDonor(query.industry, donorRoot);
    if (!donor.ok) { note(stages.s0, query.textQuery, null, donor.reason); continue; }
    stages.s0.survived++;
    plans.push({ ...query, metro, donor: donor.donor, vertical: donor.vertical, donorVia: donor.via });
  }
  if (!plans.length) {
    // Name the reason that actually emptied the plan list. Reporting
    // "no_buildable_donor" for a metro that never stated its state would send
    // the operator to the donor library to fix a typo in a city box.
    if (stages.s0.rejected.metro_state_unstated === stages.s0.entered) {
      return {
        ok: false,
        mode: "metro_state_unstated",
        message: "Every requested metro was given without a state, so no lead could be checked against the market it was mined for. Add the state — \"Jackson MS\", not \"Jackson\" — and run again.",
        funnel: Object.values(stages), cost, records: [], rejects,
      };
    }
    return {
      ok: false,
      mode: "no_buildable_donor",
      message: `No in-service, outreach-eligible donor exists for the requested vertical(s). Buildable today: ${buildableVerticals(donorRoot).map((v) => v.industry).join(", ") || "(none)"}.`,
      funnel: Object.values(stages), cost, records: [], rejects,
    };
  }
  if (!firecrawlKey) {
    return { ok: false, mode: "no_discovery_key", message: "FIRECRAWL_API_KEY is not set; discovery cannot run.", funnel: Object.values(stages), cost, records: [], rejects };
  }

  // ---- STAGE 1 -------------------------------------------------------------
  const candidates = [];
  const seenDomains = new Set();
  // Maps-discovery place dedup: the raw `0x<hex>:0x<hex>` feature pair (or the
  // decoded name when a link carried no data blob) keys the Maps lane, exactly
  // as the registrable domain keys the search lane.
  const seenMapsPlaces = new Set();
  // MAPS LANE ARMING. The scrape is a Firecrawl call (shared key/endpoint) and
  // every candidate it yields must be resolved to a website through the
  // existing Places searchText path — so the lane needs BOTH keys. With either
  // missing the lane stays off; GHOST_AGENCY_MAPS_DISCOVERY=0 is the stop.
  const mapsLaneOn = mapsDiscoveryEnabled(env) && Boolean(firecrawlKey) && Boolean(placesKey);
  const mapsAdmissionCap = mapsDiscoveryAdmissionCap(input, env);
  // Directory pages the search skipped — crawled after the search loop to
  // recover the businesses behind them (bounded, kill-switchable).
  const directoryUrls = [];
  // Directory expansion is useful for manual mining, but it starts up to three
  // 60-second crawl jobs before any direct result can be checkpointed. The
  // operator Line uses only direct website results and never expands directory
  // pages into another crawl lane.
  const allowDirectoryCrawl = !operatorLine && directoryCrawlEnabled(env);
  // One provider slot per original trade+metro, exactly as before retargeting.
  // The selected shape rotates inside that fixed slot; expansion never creates
  // another discovery allowance.
  const dispatchPlans = dispatchQueryPlans(plans, input.queryShapeCursor, input.queryGroupOffset);
  let exhaustedOperatorPlans = 0;
  for (const plan of dispatchPlans) {
    if (operatorLine) {
      const shapeCount = Math.max(1, Math.trunc(Number(plan.queryShapeCount) || 1));
      if (fixedMarketSource && refillRound >= shapeCount) {
        exhaustedOperatorPlans += 1;
        note(stages.s1, plan.textQuery, null, "operator_query_cycle_exhausted",
          `refill ${refillRound} would repeat one of ${shapeCount} already-paid query shapes`);
        continue;
      }
    }
    const discoveryLimit = operatorLine ? operatorDiscoveryLimit : perQuery;
    const search = await firecrawlSearch({
      // NEGATIVE OPERATORS: the SERP is cleaned at the source (owner-measured
      // keep-rate doubling); the directory filter below stays as the backstop.
      query: searchQueryWithNegatives(plan.textQuery),
      limit: discoveryLimit,
      apiKey: firecrawlKey,
      endpoint: input.firecrawlEndpoint,
      fetchImpl,
      env,
    });
    cost.firecrawl_search_calls++;
    if (!search.ok) { note(stages.s1, plan.textQuery, null, search.reason, search.detail); continue; }
    for (const result of search.results.slice(0, discoveryLimit)) {
      stages.s1.entered++;
      const facebookUrl = canonicalFacebookPageUrl(result.url);
      // A named Facebook business page is a target under the flat-site policy,
      // not a generic directory hit. It still receives no trust here: the path
      // is retained so a verified identity (the opted-in manual_exact GBP
      // observation, when one runs) can prove the exact page, and so page-level
      // deduplication and quarantine IDs remain distinct.
      if (isDirectoryUrl(result.url) && !facebookUrl) {
        if (allowDirectoryCrawl && directoryUrls.length < directoryCrawlLimit(env)) {
          directoryUrls.push({ url: result.url, plan });
        }
        note(stages.s1, result.url, null, "directory_or_social_page");
        continue;
      }
      // NATIONAL-CHAIN EXCLUSION at candidate admission: a franchise search
      // result ("Roto-Rooter Plumbing & Water Cleanup") never enters the
      // funnel — the quarantine names the cause, same terminal path as
      // pick_name_implausible rides at pick time.
      if (isNationalChainName(result.title, env)) {
        note(stages.s1, result.title, null, NATIONAL_CHAIN_EXCLUDED);
        continue;
      }
      let origin;
      let domain;
      try {
        const u = new URL(result.url);
        origin = facebookUrl || `${u.protocol}//${u.host}/`;
        domain = registrableDomain(u.hostname);
      } catch { note(stages.s1, result.url, null, "unparseable_url"); continue; }
      const discoveryKey = facebookUrl ? facebookPageIdentity(facebookUrl) : domain;
      if (seenDomains.has(discoveryKey)) { note(stages.s1, result.url, null, "duplicate_domain_in_batch"); continue; }
      seenDomains.add(discoveryKey);
      stages.s1.survived++;
      candidates.push({ plan, url: origin, domain, searchTitle: result.title, facebookDiscovery: Boolean(facebookUrl), discoveryVia: "firecrawl_search" });
    }

    // MAPS DISCOVERY — the same balanced target, scraped from the live Google
    // Maps search page (one Firecrawl call, metered as maps_scrape_calls).
    // Each place is resolved to its website through the EXISTING Places
    // searchText path and then enters THIS funnel as a normal candidate, so
    // dedup, the metro fence and every downstream gate apply unchanged; the
    // place object rides as discoveryPlace, making the eventual record's
    // identity_source "google_places".
    if (mapsLaneOn) {
      const center = mapsMarketCenter({
        metro: plan.metro,
        queryShape: plan.queryShape || (/^\d{5}$/.test(String(plan.location || "").trim()) ? "zip" : "metro"),
        verifiedCoordinates: verifiedMiningCoordinates(input),
      });
      const maps = await mapsSearchDiscovery({
        query: plan.textQuery,
        center,
        apiKey: firecrawlKey,
        endpoint: input.firecrawlScrapeEndpoint || env.GHOST_AGENCY_FIRECRAWL_SCRAPE_ENDPOINT,
        fetchImpl,
        timeoutMs: numberInRange(env.GHOST_AGENCY_FIRECRAWL_RENDER_TIMEOUT_MS, 30_000, 8_000, 45_000),
      });
      cost.maps_scrape_calls += maps.calls || 0;
      if (!maps.ok) {
        // A PLAN-level provider failure admits no candidates, so it must NOT
        // count as a stage rejection: the funnel's reconciliation invariant
        // (entered === survived + Σ rejected) only covers candidates. The
        // failure still reaches the operator via the rejects diagnostics.
        rejects.push({
          stage: stages.s1.stage,
          candidate: plan.textQuery,
          reason: maps.reason,
          ...(maps.detail ? { detail: maps.detail } : {}),
        });
      } else {
        for (const result of maps.results.slice(0, mapsAdmissionCap)) {
          stages.s1.entered++;
          // Dedup keys: the raw feature pair when the link carried one, else
          // the CID, else the decoded name — so the same business rendered
          // once with and once without its data blob still collapses.
          const placeKey = (result.mapsPlace && (result.mapsPlace.placeRef || result.mapsPlace.cid))
            || result.title.toLocaleLowerCase("en-US");
          const nameKey = result.title.toLocaleLowerCase("en-US");
          if (seenMapsPlaces.has(placeKey) || (nameKey !== placeKey && seenMapsPlaces.has(nameKey))) {
            note(stages.s1, result.title, null, "duplicate_map_place");
            continue;
          }
          seenMapsPlaces.add(placeKey);
          seenMapsPlaces.add(nameKey);
          if (isNationalChainName(result.title, env)) {
            note(stages.s1, result.title, null, NATIONAL_CHAIN_EXCLUDED);
            continue;
          }
          const resolved = await resolveMapsCandidatePlace({
            key: placesKey,
            name: result.title,
            cityHint: `${plan.metro.city} ${plan.metro.state}`,
            fetchImpl,
            breaker: placesBreaker,
            retries: 0,
          });
          cost.places_calls += resolved.httpCalls || 0;
          refreshStage6Cost();
          if (!resolved.ok) { note(stages.s1, result.title, null, resolved.reason, resolved.detail); continue; }
          if (!resolved.place.websiteUri) {
            // Google observes the business but lists no site — unbuildable in
            // this website-first funnel, and named as such in the funnel.
            note(stages.s1, result.title, null, "maps_place_without_website");
            continue;
          }
          let origin;
          let domain;
          try {
            const u = new URL(resolved.place.websiteUri);
            origin = `${u.protocol}//${u.host}/`;
            domain = registrableDomain(u.hostname);
          } catch { note(stages.s1, result.title, null, "unparseable_url"); continue; }
          if (seenDomains.has(domain)) { note(stages.s1, result.title, null, "duplicate_domain_in_batch"); continue; }
          seenDomains.add(domain);
          stages.s1.survived++;
          candidates.push({
            plan,
            url: origin,
            domain,
            searchTitle: result.title,
            facebookDiscovery: false,
            mapsDiscovery: true,
            discoveryPlace: resolved.place,
            discoveryVia: "google_maps_scrape",
          });
        }
      }
    }
  }

  // DIRECTORY CRAWL — recover the businesses BEHIND a directory/chamber page.
  // The search lane skips directories (they are not businesses); this crawls the
  // skipped directories for the business URLs they link to and hands those URLs
  // back to the same funnel. Generous work bounds (default 10 directories per
  // run, 200 pages per crawl) and kill-switchable; a crawl that fails or times
  // out is recorded, never fatal.
  if (allowDirectoryCrawl && directoryUrls.length) {
    for (const dir of directoryUrls) {
      const crawl = await firecrawlCrawl({
        url: dir.url,
        apiKey: firecrawlKey,
        endpoint: env.GHOST_AGENCY_FIRECRAWL_CRAWL_ENDPOINT || DEFAULT_FIRECRAWL_CRAWL_ENDPOINT,
        fetchImpl,
        env,
      });
      cost.firecrawl_crawl_calls = (cost.firecrawl_crawl_calls || 0) + crawl.calls;
      if (!crawl.ok) { note(stages.s1, dir.url, null, crawl.reason, crawl.detail); continue; }
      for (const link of crawl.urls) {
        if (isDirectoryUrl(link)) continue; // a directory linking to another directory
        stages.s1.entered++;
        let domain;
        try { domain = registrableDomain(new URL(link).hostname); } catch { note(stages.s1, link, null, "unparseable_url"); continue; }
        if (seenDomains.has(domain)) { note(stages.s1, link, null, "duplicate_domain_in_batch"); continue; }
        seenDomains.add(domain);
        stages.s1.survived++;
        candidates.push({ plan: dir.plan, url: link, domain, searchTitle: "", facebookDiscovery: false, directoryCrawled: true, discoveryVia: "firecrawl_crawl" });
      }
    }
  }

  // ---- STAGES 2-5: FREE, and therefore CONCURRENT --------------------------
  // Nothing in this phase costs money, so the only reason to serialise it would
  // be politeness to the prospect's own server — one GET each, so concurrency
  // is bounded, not absent. The identity/proof phase below stays sequential.
  const freeConcurrency = numberInRange(input.freeConcurrency ?? env.GHOST_AGENCY_MINER_ENRICH_CONCURRENCY, 6, 1, 12);
  const freePhase = await mapLimit(candidates, freeConcurrency, async (cand) => {
    const out = { cand, cost: { homepage_fetches: 0, firecrawl_scrape_calls: 0, homepage_scrape_fallbacks: 0, logo_fetches: 0, dns_mx_lookups: 0 } };
    let page = await fetchPageBytes(cand.url, numberInRange(env.GHOST_AGENCY_MINER_FETCH_TIMEOUT_MS, 12000, 1000, 30000), fetchImpl);
    out.cost.homepage_fetches++;
    out.page = page;
    const fallbackUrl = page.finalUrl || cand.url;
    const fallbackSameOwner = sameOwner(cand.url, fallbackUrl) || sameOwner(fallbackUrl, cand.url);
    if ((!page.ok || !page.html) && !fallbackSameOwner) {
      out.stop = {
        stage: "s2",
        reason: "identity_cross_owner_redirect",
        detail: `fetch of ${cand.domain} landed on ${registrableDomain(fallbackUrl) || String(fallbackUrl).slice(0, 120)} — paid recovery cannot scrape a foreign owner's page`,
      };
      return out;
    }
    // ANTI-BOT RECOVERY: when the prospect's own site refuses the free GET
    // (403/429, non-HTML, timeout) fall back to ONE Firecrawl scrape for the
    // rendered HTML. Firecrawl bypasses the bot block the raw fetch hit, so the
    // service/email/logo/identity pipeline keeps running on the recovered bytes.
    // Bounded by a per-run cap and a kill switch; the original failure is kept as
    // provenance so the operator can see the site was only readable via scrape.
    if ((!page.ok || !page.html)
      && firecrawlKey
      && homepageScrapeFallbacksRemaining > 0
      && operatorLineFallbackAvailable()) {
      homepageScrapeFallbacksRemaining -= 1;
      consumeOperatorLineFallback();
      const scraped = await firecrawlScrapeHtml({
        url: fallbackUrl,
        apiKey: firecrawlKey,
        endpoint: input.firecrawlScrapeEndpoint,
        fetchImpl,
        timeoutMs: numberInRange(env.GHOST_AGENCY_FIRECRAWL_RENDER_TIMEOUT_MS, 20_000, 5_000, 30_000),
        env,
      });
      out.cost.firecrawl_scrape_calls += Number.isFinite(scraped.calls) ? scraped.calls : 0;
      out.cost.homepage_scrape_fallbacks += 1;
      if (scraped.ok && scraped.html) {
        page = {
          ok: true,
          status: scraped.status || 200,
          html: scraped.html,
          headers: {},
          elapsedMs: 0,
          finalUrl: scraped.finalUrl || page.finalUrl || cand.url,
          failure: null,
          scrapedViaFirecrawl: true,
          directFetchFailure: page.failure || "site_unreachable",
        };
        out.page = page;
        out.scrapedViaFirecrawl = true;
      } else {
        out.stop = {
          stage: "s2",
          reason: page.failure || "site_unreachable",
          detail: `firecrawl_scrape_fallback: ${scraped.reason}`,
        };
        return out;
      }
    }
    if (!page.ok || !page.html) { out.stop = { stage: "s2", reason: page.failure || "site_unreachable" }; return out; }
    out.probe = analyzeWebsite({ url: cand.url, status: page.status, html: page.html, elapsedMs: page.elapsedMs, ok: page.ok, failure: page.failure });
    out.parsed = parsePage(page.html);
    out.ld = jsonLdNodes(page.html);
    out.social = socialLinksFrom(page.html);
    // THE OWNED PROFILES, off the SAME homepage GET. Zero extra cost and the
    // strongest provenance there is: a link in their own footer is the business
    // asserting the account is theirs. `out.social` above is a flat
    // host-matched map kept for the legacy row shape; this is the strict,
    // path-validated, canonicalised list the mirror actually renders.
    out.ownedProfiles = socialDiscovery.profilesFromOwnSite(page.html, cand.url);

    // THIN-TARGET SCORING (issue #689) — measured off THIS same fetch, before
    // any quality stage runs: additive telemetry and ranking input, never a
    // gate. A site with weak/no review, maps, social or booking integrations is
    // a POSITIVE targeting signal (the rebuild supplies them), so the flags
    // ride the candidate and the ranking prefers it.
    out.integrationGap = integrationGapFromHomepage({
      html: page.html,
      probe: out.probe,
      parsed: out.parsed,
      social: out.social,
      ownedProfiles: out.ownedProfiles,
    });

    // IDENTITY PLAUSIBILITY (audit A2 defect 2; issue #700 class) — the
    // #700-required forum/board/UGC site-class markers, measured off THIS same
    // fetch exactly like the integration-gap pass above: zero new network
    // calls. The verdict is refused later, at the identity stage, only when
    // ≥2 independent marker families fired; here it is measured telemetry
    // riding the candidate (qualification.ugc_platform).
    out.ugcPlatform = namePlausibility.ugcPlatformMarkersFromHomepage({
      html: page.html,
      title: (out.parsed && out.parsed.title) || "",
      h1: (out.parsed && out.parsed.h1) || "",
    });

    // HEAVY-TARGET ADMISSION CAP (owner directive 2026-09-03 — see
    // polishAdmissionVerdict above): a too-polished original is the WRONG
    // rebuild target. Skip HERE — after the measurement, before any stage 3+
    // spend — with the reason riding the 2_homepage_fetch funnel stage exactly
    // like site_unreachable, so an under-filled batch is explainable, never
    // silent. While thinner candidates exist the #694 ranking already seats
    // them first; when the whole SERP window is heavy, this skip is what makes
    // the batch UNDER-FILL (fewer rows, honest halt/wait-for-refill) instead
    // of force-filling with the class the owner rejected.
    const polishSkip = polishAdmissionVerdict(out.integrationGap, env);
    if (polishSkip) {
      out.stop = {
        stage: "s2",
        reason: polishSkip.reason,
        detail: `polish ${polishSkip.polish}/100 over TARGET_MAX_POLISH=${polishSkip.ceiling}`
          + ` (integration-gap upside ${Math.max(0, Math.trunc(Number(out.integrationGap.score) || 0))})`,
      };
      return out;
    }

    out.websiteCats = buildQual.minedWebsiteCategories({ probe: out.probe, headers: page.headers, page: out.parsed });
    out.websiteVerdict = buildQual.qualifyWebsiteAxis({ probe: out.probe, categories: out.websiteCats, env });
    // THIN-FLOW LAW (owner doctrine 2026-09-04, "scaling and rapid production
    // flow"). The website-axis ceiling — and the modernPremium structural
    // veto with it — is retired from the refusing set: it is a quality score,
    // and quality scores no longer refuse. A low or unmeasured grade is
    // tallied on this stage as accepted_thin and the candidate proceeds; the
    // compiler enriches thin content from the harvested first-party evidence
    // (local-research / identity-copy / taxonomy). The verdict still rides
    // the record via qualification.website_axis, so the proof email's
    // before/after and the bank's provenance keep the number. The counter key
    // still names the ceiling that WOULD have refused, so the funnel shows
    // exactly which old law stopped binding.
    if (!out.websiteVerdict.ok) {
      out.acceptedThin = {
        stage: "s3",
        reason: out.probe.modernPremium === true ? "already_modern_premium"
          : !out.websiteCats ? "website_axis_unmeasured"
          : `website_axis_above_${buildQual.gradeSlug(out.websiteVerdict.ceiling)}`,
      };
    }

    // searchTitle is the only name available at this point — verified identity
    // is not resolved until stage 6. It is a search-result title ("Hesse Fence
    // & Deck | Wichita KS"), so nameTokens' stopword stripping does the rest.
    // Facebook is a shared host: none of its chrome or image URLs can prove a
    // business-owned logo. Do not weaken provenance. Across every site, true
    // absence and an already-owned-but-small icon defer an honest wordmark
    // until a verified business name exists (a Google observation or the
    // structured first-party identity). An explicit candidate whose provenance
    // fails still runs the normal refusal path.
    // STATIC-SITE BRAND EXTRACTION — runs BEFORE the logo pipeline so its
    // findings ride the SAME resolveOwnLogo call: the extracted logo URL joins
    // the ranked candidates through the existing hint seam (ownership-gated
    // before any fetch, and a no-op when the ranker already listed it), and
    // the extracted accent rescues a HELD mark — header-grade, own-domain, but
    // unmeasurable in this runtime. That is the exact Hurricane Fence failure:
    // a WebP logo measuring null refused the whole brand, and the mirror
    // shipped in the fencing-sterling donor's navy and gold with no logo, while
    // the client's own red sat unextracted in their page CSS. lib/brand-
    // extractor reads that page itself — theme-color, CSS colour frequency
    // (the layer that needs no CSS custom properties, no measurable raster and
    // no provider), logo candidates, fonts — at the cost of at most four
    // fetches of the site's OWN stylesheets and zero provider calls. Never a
    // blocker: an extractor failure is recorded and the funnel moves on.
    let brandIdentity = null;
    // THE SITE PALETTE — the whole-website reading (owner directive
    // 2026-09-03: "we want to take THEIR SITE colors not just their LOGO
    // colors"). The stylesheet texts below are fetched ONCE and shared by
    // BOTH extractors, so adding the site palette costs ZERO new network:
    // the same <=4 fetches of the site's OWN stylesheets the brand lane
    // already made. When brand extraction is switched off the site palette
    // still runs on the inline evidence the HTML itself carries (style
    // blocks + style attributes) at zero fetches — the directive's cheap
    // path, never a spend.
    let sitePalette = null;
    if (page && page.html) {
      let sharedCssTexts = [];
      if (brandExtractionEnabled(env)) {
        try {
          const hrefs = collectStylesheetHrefs(page.html, page.finalUrl || cand.url).slice(0, 4);
          const settled = await Promise.allSettled(hrefs.map((href) => fetchText(href, 8000)));
          sharedCssTexts = settled
            .filter((s) => s.status === "fulfilled" && typeof s.value === "string" && s.value)
            .map((s) => s.value);
          out.cost.brand_css_fetches = (out.cost.brand_css_fetches || 0) + sharedCssTexts.length;
        } catch {
          // Stylesheet fetch failure is enrichment failure, not lead failure.
        }
      }
      if (brandExtractionEnabled(env)) {
        try {
          brandIdentity = await extractBrandIdentity({
            html: page.html,
            baseUrl: page.finalUrl || cand.url,
            cssTexts: sharedCssTexts,
          });
        } catch (e) {
          brandIdentity = {
            extraction_method: "extractor_error",
            confidence: "LOW",
            detail: String((e && e.message) || e).slice(0, 160),
          };
        }
        out.brand_identity = brandIdentity;
      }
      try {
        sitePalette = extractSitePalette({
          html: page.html,
          baseUrl: page.finalUrl || cand.url,
          cssTexts: sharedCssTexts,
        });
      } catch (e) {
        sitePalette = {
          ok: false,
          reason: `extraction_failed:${String((e && e.message) || e).slice(0, 60)}`,
        };
      }
      out.site_palette = sitePalette;
      // POSITIVE provenance counter, the integration_gap precedent: how many
      // homepages yielded a whole-website palette. Telemetry only — a lead
      // whose page declares nothing readable flows on exactly as before.
      if (sitePalette && sitePalette.ok) {
        stages.s4.site_palette_positive = (stages.s4.site_palette_positive || 0) + 1;
      }
    }
    // THE DONOR FINGERPRINT — the client's own visual DNA, extracted from the
    // same HTML stage 4 already holds (palette CONSUMED from brand_identity
    // above, never re-derived). This is the measured half of the owner's
    // "similarity budget": the build-time scorer compares the shipped mirror
    // against THIS and refuses to certify a render that reads as the same
    // template with the names swapped. Recorded on the prospect row and
    // carried on the mirror request; never a blocker — an extraction failure
    // is recorded as absence and the funnel moves on.
    if (page && page.html && donorFingerprintEnabled(env)) {
      try {
        out.donor_fingerprint = extractClientDonorFingerprint({
          html: page.html,
          baseUrl: page.finalUrl || cand.url,
          brandIdentity: brandIdentity || null,
        });
      } catch (e) {
        out.donor_fingerprint = {
          version: 1,
          extraction_error: String((e && e.message) || e).slice(0, 160),
        };
      }
    }
    const declaredLogo = hasExplicitLogoClaim(page.html);
    let brand = cand.facebookDiscovery && !declaredLogo
      ? { ok: false, reason: "no_own_domain_logo_candidate", fetches: 0 }
      : await resolveOwnLogo({
        siteUrl: page.finalUrl || cand.url,
        html: page.html,
        businessName: cand.searchTitle || cand.domain || "",
        // The extractor's candidate and accent ride the FIRST pass, so the
        // common path pays no duplicate logo fetches.
        hintLogoUrl: (brandIdentity && brandIdentity.logo_url) || "",
        hintAccentHex: (brandIdentity && brandIdentity.accent_color) || "",
        hintAccentSource: (brandIdentity && brandIdentity.extracted_from) || "",
      });
    // Firecrawl `branding` recovery: when the static HTML ranker came up empty,
    // ask Firecrawl's branding extractor for the logo URL (it sees CSS/JS marks
    // that defeat the ranker). One bounded call, only on an empty result, and
    // the returned URL still runs the ownsLogo / denylist / sniff / measure
    // pipeline in resolveOwnLogo — so provenance is never weakened.
    if (
      !brand.ok
      && !cand.facebookDiscovery
      && brandingFallbackEnabled(env)
      && firecrawlKey
      && operatorLineFallbackAvailable()
    ) {
      consumeOperatorLineFallback();
      const branding = await firecrawlBranding({
        url: page.finalUrl || cand.url,
        apiKey: firecrawlKey,
        endpoint: env.GHOST_AGENCY_FIRECRAWL_SCRAPE_ENDPOINT || DEFAULT_FIRECRAWL_SCRAPE_ENDPOINT,
        fetchImpl,
        env,
      });
      out.cost.firecrawl_branding_calls = (out.cost.firecrawl_branding_calls || 0) + branding.calls;
      if (branding.ok && branding.logo) {
        const hinted = await resolveOwnLogo({
          siteUrl: page.finalUrl || cand.url,
          html: page.html,
          businessName: cand.searchTitle || cand.domain || "",
          hintLogoUrl: branding.logo,
        });
        out.cost.logo_fetches += hinted.fetches || 0;
        if (hinted.ok) brand = { ...hinted, brandingHint: true };
      }
    }
    if (
      !brand.ok
      && (ownerOnlyPractice || logoLadderFallbackEnabled(env))
      && logoFailureCanUseLadder(brand)
    ) {
      brand = {
        ...brand,
        ok: true,
        markPending: true,
        markFallbackReason: brand.reason,
      };
    }
    out.cost.logo_fetches += brand.fetches || 0;
    out.brand = brand;
    if (!brand.ok && !ownerOnlyPractice) { out.stop = { stage: "s4", reason: brand.reason }; return out; }
    if (!brand.ok) {
      brand = {
        ...brand,
        ok: true,
        markPending: true,
        markFallbackReason: brand.reason || "no_own_domain_logo_candidate",
      };
      out.brand = brand;
    }

    const emailOut = await qualifyEmail({ emails: allEmails(page.html), siteUrl: cand.url, resolveMx });
    out.cost.dns_mx_lookups += (emailOut.rejected || []).filter((r) => r.reason === "no_mx_record").length + (emailOut.ok ? 1 : 0);
    out.emailOut = emailOut;
    // A homepage email is a useful fast-path, not a build admission gate.
    // Intake Genie now receives the website, GBP, and discovered social URLs
    // and performs the deeper contact/about crawl. A missing address holds
    // LIVE delivery later; sandbox still builds and emails the owner.
    if (!emailOut.ok) out.contactHoldReason = emailOut.reason || "no_email_published";
    return out;
  });

  // Fold the concurrent results back in FUNNEL ORDER, so `entered` and
  // `survived` mean what they say at every stage and the arithmetic reconciles:
  // entered === survived + Σ rejected, at each of s2..s5.
  const FREE_ORDER = ["s2", "s3", "s4", "s5"];
  const survivors = [];
  for (const out of freePhase) {
    for (const [k, v] of Object.entries(out.cost)) cost[k] += v;
    for (const key of FREE_ORDER) {
      stages[key].entered++;
      if (out.stop && out.stop.stage === key) {
        note(stages[key], out.cand.domain, null, out.stop.reason, out.stop.detail);
        break;
      }
      stages[key].survived++;
    }
    // THIN-FLOW telemetry: a candidate a quality ceiling would have refused
    // is tallied on the stage that accepted it (see acceptThin above).
    if (out.acceptedThin && stages[out.acceptedThin.stage]) {
      acceptThin(stages[out.acceptedThin.stage], out.acceptedThin.reason);
    }
    // THIN-TARGET telemetry (issue #689): additive count of survivors whose
    // measured homepage shows integration gaps. Pure counting — it changes no
    // entered/survived/rejected arithmetic and refuses nothing.
    if (!out.stop && out.integrationGap && out.integrationGap.gap) {
      stages.s2.integration_gap_positive = (stages.s2.integration_gap_positive || 0) + 1;
    }
    // IDENTITY PLAUSIBILITY telemetry (audit A2 / #700): additive count of
    // survivors whose measured homepage carries ≥2 forum/board/UGC marker
    // families. Pure counting; the refusal (when it fires) is recorded on
    // stage 6 with its own reason key.
    if (!out.stop && out.ugcPlatform && out.ugcPlatform.platform) {
      stages.s2.ugc_platform_markers = (stages.s2.ugc_platform_markers || 0) + 1;
    }
    if (!out.stop) survivors.push(out);
  }

  // THIN-TARGET PREFERENCE (issue #689, owner doctrine: thin/un-integrated
  // sites are the BEST converts). ORDERING ONLY — no candidate is refused,
  // dropped or gated here; every survivor keeps flowing exactly as before.
  // What changes is which survivors the goal-sized deep-verification pool
  // reaches FIRST when discovery returned more than the quota: measured
  // integration-gap upside now leads, so a thin/un-integrated site outranks a
  // highly-polished one (the LOA Roofing class) for the same demand. The sort
  // is stable, so candidates without a measured gap keep funnel order.
  survivors.sort(
    (a, b) => ((b.integrationGap && b.integrationGap.score) || 0)
      - ((a.integrationGap && a.integrationGap.score) || 0),
  );

  // ---- STAGES 6-8: identity (reused discovery or optional lookup) + proof --
  const records = [];
  const heldRows = [];
  const emittedIdentities = new Set();
  // Dry-run-ready candidates, drained by a bounded concurrent pass after the
  // identity phase. The dry-run mirror build is the slow step; running it
  // concurrently (instead of inline in the sequential identity loop) keeps a
  // 10-50 site run from serializing on the mirror build.
  const dryRunQueue = [];

  for (const out of survivors) {
    if (operatorLine && dryRunQueue.length >= operatorProofPool) break;
    const { cand, page, probe, parsed, ld, social, websiteCats, websiteVerdict, brand, emailOut, integrationGap, ugcPlatform } = out;
    // The stage-4 extractor receipt travels on the stage record (like `brand`
    // does) — it is the pick phase's second chance at a client's own colours.
    const brandIdentity = out.brand_identity || null;
    // The stage-4 WHOLE-WEBSITE palette receipt rides beside it — the
    // surfaces/ink/slab reading that outranks the logo for the page canvas.
    const sitePalette = out.site_palette || null;
    // And the stage-4 donor fingerprint rides beside it: the client's own
    // measured DNA, scored against the build by the engine.
    const donorFingerprint = out.donor_fingerprint || null;

    // STAGE 6 — identity. Operator discovery already selected the website and
    // resolves identity from that first-party site. Places remains confined to
    // the separate, explicit manual_exact verification lane.
    stages.s6.entered++;
    const nameHint = (parsed.title || cand.searchTitle || "").split(/[|–—-]/)[0].trim().slice(0, 80);
    // Resolved once: the fence and the facts block are its two readers.
    let effectiveLd = ld;
    let identityEvidenceUrl = cand.url;
    let assertion = serviceAreaAssertion({ html: page.html, ldNodes: effectiveLd });
    // CROSS-OWNER REDIRECT, checked BEFORE any identity lookup — Google
    // included. A fetch that landed on another owner's site means every byte
    // in hand (HTML, JSON-LD, email, logo) is someone else's page, and a
    // Google match on the original domain cannot launder it. Ownership uses
    // the engine's fail-closed sameOwner rule. It is directional, so check
    // both directions: an exact host and its OWNED CHILD host (www.,
    // locations., m.) pass regardless of which side redirected. Siblings and
    // foreign owners still quarantine.
    const landedUrl = page.finalUrl || cand.url;
    const crossOwner = (sameOwner(cand.url, landedUrl) || sameOwner(landedUrl, cand.url))
      ? null
      : {
        ok: false,
        reason: "identity_cross_owner_redirect",
        missing: [],
        detail: `fetch of ${cand.domain} landed on ${registrableDomain(landedUrl) || String(landedUrl).slice(0, 120)} — a foreign page's bytes are not this candidate's evidence`,
      };
    let nap = null;
    let identityFallback = null;
    // IDENTITY TRUST MODE — the stage's genuine refusals that trust overrode,
    // stamped on the emitted row for audit (owner directive 2026-08-31).
    const trustOverrides = [];
    if (!crossOwner && cand.discoveryPlace) {
      const discovered = napFromPlace(cand.discoveryPlace);
      if (!discovered.ok) {
        if (!identityTrustEnabled(env)) {
          note(stages.s6, cand.domain, null, discovered.reason, discovered.detail);
          continue;
        }
        // IDENTITY TRUST MODE: the observation is incomplete and Places is
        // enrichment, not a dependency — the candidate falls back to its own
        // site's truth. No tag: an unusable observation is not the business's
        // failure to override.
        identityFallback = { from: "discovery_place", reason: discovered.reason, detail: String(discovered.detail || "").slice(0, 200) };
      } else {
        nap = discovered;
      }
    } else if (!crossOwner && placesLane && !placesVerified) {
      placesVerified = true;
      // The manual exact lookup is a distinct run and may clear a closed
      // breaker's prior failure tally.
      providerHealthAtStart = placesBreaker.beginRun();
      // One query, zero retries: at most one outbound HTTP attempt, and the
      // cost ledger bills exactly the attempts callProvider reports.
      const verified = await verifyNapForCandidate({
        key: placesKey, name: nameHint || cand.domain, cityHint: cand.plan.location,
        siteDomain: cand.domain, siteUrl: cand.url, fetchImpl,
        maxQueries: 1, retries: 0, breaker: placesBreaker,
      });
      cost.places_calls += Number.isFinite(verified.httpCalls) ? verified.httpCalls : 0;
      refreshStage6Cost();
      if (verified.ok) {
        nap = verified;
      } else if (verified.provider || identityTrustEnabled(env)) {
        // Provider failures are nonterminal on the explicit manual lane. In
        // identity-trust mode a healthy NO is the same non-event: Places is
        // optional enrichment and a business with no Google observation is an
        // underserved lead, so the candidate proceeds on its own site's
        // truth. No tag — absence is not a failure. The kill switch keeps
        // every healthy-NO refusal exactly as it was.
        identityFallback = { from: "google_places", reason: verified.reason, detail: String(verified.detail || "").slice(0, 200) };
      } else {
        // A healthy provider answered NO (no match, no locality, bbox). These
        // are truth refusals and they refuse exactly as they always have.
        note(stages.s6, cand.domain, null, verified.reason, verified.detail);
        continue;
      }
    }
    if (!nap) {
      let fp = crossOwner || firstPartyIdentity({
        html: page.html,
        ldNodes: effectiveLd,
        url: identityEvidenceUrl,
      });
      if (!fp.ok && ownerOnlyPractice && !crossOwner) {
        fp = operatorWebsiteIntakeIdentity({
          parsed,
          metro: cand.plan.metro,
          url: page.finalUrl || cand.url,
        });
      }
      // Paid rendering is the final identity fallback only: the candidate has
      // survived every free gate, any explicitly authorised Places lookup ran
      // first, and the static first-party bytes still proved no identity.
      if (
        !fp.ok
        && !crossOwner
        && !cand.facebookDiscovery
        && Boolean(firecrawlKey)
        && renderedScrapesRemaining > 0
        && operatorLineFallbackAvailable()
      ) {
        renderedScrapesRemaining--;
        consumeOperatorLineFallback();
        const rendered = await firecrawlRenderedJsonLd({
          url: page.finalUrl || cand.url,
          apiKey: firecrawlKey,
          endpoint: input.firecrawlScrapeEndpoint,
          fetchImpl,
          timeoutMs: numberInRange(env.GHOST_AGENCY_FIRECRAWL_RENDER_TIMEOUT_MS, 20_000, 5_000, 30_000),
          env,
        });
        cost.firecrawl_scrape_calls += Number.isFinite(rendered.calls) ? rendered.calls : 0;
        refreshStage6Cost();
        if (rendered.ok) {
          effectiveLd = rendered.nodes;
          identityEvidenceUrl = rendered.finalUrl;
          assertion = serviceAreaAssertion({ html: page.html, ldNodes: effectiveLd });
          fp = firstPartyIdentity({
            html: page.html,
            ldNodes: effectiveLd,
            url: identityEvidenceUrl,
          });
        }
      }
      if (!fp.ok && !(identityTrustEnabled(env) && TRUSTED_IDENTITY_REASONS.has(String(fp.reason)))) {
        // QUARANTINE, never a pretend pass — and simultaneously a funnel
        // rejection so entered === survived + Σ rejected stays exact.
        const at = new Date().toISOString();
        const holdName = nameHint || cand.domain;
        // Facebook pages share one registrable domain; the hold id must carry
        // the canonical page identity, never a shared fp-hold-facebook-com.
        const holdKey = (cand.facebookDiscovery && facebookPageIdentity(cand.url)) || cand.domain;
        const holdId = slugify(`fp-hold-${holdKey}`, "fp-hold");
        heldRows.push({
          prospect_id: holdId,
          status: "held",
          business_name: holdName,
          email: emailOut.email || null,
          owner_email: null,
          phone: null,
          current_website: cand.url,
          industry: cand.plan.vertical,
          city: null,
          state: null,
          leadminer_score: 0,
          source: "build-ready-mine-held",
          record: {
            prospect_id: holdId,
            place_id: null,
            business_name: holdName,
            email: emailOut.email || null,
            phone: null,
            current_website: cand.url,
            industry: cand.plan.vertical,
            city: null,
            state: null,
            text_query: cand.plan.textQuery,
            website_probe: probe,
            source: "build-ready-mine-held",
            status: "held",
            blocked_reason: fp.reason,
            identity_hold: {
              reason: fp.reason,
              at,
              missing: fp.missing || [],
              ...(fp.detail ? { detail: fp.detail } : {}),
              ...(identityFallback ? { provider_fallback: identityFallback } : {}),
              evidence_sources: ["first_party_site"],
            },
          },
          updated_at: at,
        });
        note(stages.s6, cand.domain, null, fp.reason, fp.detail);
        continue;
      }
      // IDENTITY TRUST MODE: the strict quarantine above did not fire, so the
      // site is the whole identity. The row proceeds with the name, phone and
      // place fields the site itself published — the queried market carried
      // as the labelled hint for anything absent. No override tag: an
      // incomplete schema block is not a failure being suppressed, it is site
      // truth carried as-is, and the provenance names exactly what was seen.
      nap = fp.ok
        ? fp.identity
        : trustedNapFromRefusal({ refusal: fp, nameHint, parsed, metro: cand.plan.metro, url: identityEvidenceUrl });
      if (identityFallback) nap.fallback = identityFallback;
    }
    const measuredFlatness = websiteFlatness({
      websiteUrl: cand.url,
      gbpWebsiteUrl: (nap.place && nap.place.websiteUri) || "",
      html: page.html,
      probe,
    });

    // THE METRO FENCE. `assertion` was resolved once, above, where the
    // first-party identity lane also reads it.
    let fence = null;
    if (nap.provisionalMarket === true) {
      fence = {
          ok: true,
          basis: "operator_requested_market_provisional",
          queried: `${cand.plan.metro.city}, ${cand.plan.metro.state}`,
          provisional: true,
          meaning: "owner-only Intake routing hint; no resolved postal market has been observed",
        };
    } else if (nap.identity_trust && !(nap.identity_trust.site_locality && nap.identity_trust.site_state)) {
      // IDENTITY TRUST MODE: the site published no structured market to fence
      // against and the queried market is only a hint — recording a
      // "metro_state_match" here would fabricate a basis the site never
      // stated. The fence records what it actually knows: nothing resolved,
      // a human confirms the market by phone.
      fence = {
        ok: true,
        basis: "identity_trust_market_hint",
        queried: `${cand.plan.metro.city}, ${cand.plan.metro.state}`,
        resolved: "",
        provisional: true,
        meaning: "site published no structured locality/state; the queried market is carried as a routing hint until a human confirms it by phone",
      };
    } else {
      fence = metroFence({ metro: cand.plan.metro, state: nap.state, locality: nap.locality, assertion });
    }
    if (!fence.ok) {
      if (identityTrustEnabled(env) && fence.reason === "out_of_metro_state") {
        // IDENTITY TRUST MODE: the site's own published market outranks the
        // one we queried. This is the one refusal the stage genuinely
        // overrides, so it is the one that rides the row as
        // identity_trust_overridden:<cause>. Strict mode keeps the refusal
        // and its funnel count exactly as they are.
        fence = {
          ok: true,
          basis: "identity_trust_overridden",
          queried: `${cand.plan.metro.city}, ${cand.plan.metro.state}`,
          resolved: `${nap.locality}, ${nap.state}`,
          trust: { overridden: "out_of_metro_state", original_detail: String(fence.detail || "").slice(0, 200) },
        };
        trustOverrides.push("identity_trust_overridden:out_of_metro_state");
      } else {
        note(stages.s6, cand.domain, null, fence.reason, fence.detail);
        continue;
      }
    }

    const businessName = nap.place ? placeName(nap.place) : nap.name;
    if (!businessName || FORBIDDEN_VALUE_CHARS.test(businessName)) {
      note(stages.s6, cand.domain, null, businessName ? "business_name_forbidden_characters" : "no_business_name"); continue;
    }
    // IDENTITY PLAUSIBILITY SCREEN (audit A2 defect 2; issue #700 class).
    // Runs AFTER identity resolution, so every lane's name — Places name,
    // schema.org name, or the operator h1/title fallback — is screened with
    // the same tight, name-field-only rules: a count phrase ("21,030 live
    // jobs") or a platform head noun ("FOX8 Jobs", "… News & Forums") is a
    // page title or platform statistic, not a business entity. The refusal is
    // RECORDED on the funnel exactly like no_business_name and the batch
    // continues — record, never refuse the batch (thin-flow law). Unusual
    // real names ("24/7 Emergency Plumbing LLC", "411 Plumbing", "Job's
    // Plumbing") pass: digits, possessives and mid-name platform words never
    // fire alone.
    const nameScreen = namePlausibility.businessNamePlausibility({ name: businessName });
    if (!nameScreen.ok) {
      note(
        stages.s6, cand.domain, null, nameScreen.reason,
        `business_name "${businessName.slice(0, 80)}" — ${nameScreen.signals.join("; ")}`,
      );
      continue;
    }
    // #700's site-class signal: the stage-2 measured forum/board/UGC marker
    // families. Two or more independent families (forum software + thread
    // URLs, job-board UI + count title, …) mean the homepage IS a platform —
    // a fan forum or a job board is not a local service business, whatever
    // its structured data claims. One weak family alone never refuses (a
    // careers nav or a footer community link on a real business site).
    if (ugcPlatform && ugcPlatform.platform) {
      note(
        stages.s6, cand.domain, null, "identity_ugc_platform",
        `families: ${ugcPlatform.families.join("+")} (${ugcPlatform.signals.join("; ").slice(0, 160)})`,
      );
      continue;
    }
    // Harvest once, before admission, then reuse the exact same first-party
    // service evidence in the emitted contract. This gate never reads the
    // query, donor, requested category label, or downstream category defaults.
    const serviceHarvest = harvestPageServices({
      html: (page && page.html) || "",
      ldNodes: effectiveLd,
      normalize: stripTrailingLocality,
      max: 12,
    });
    const pageServices = serviceHarvest.services.map((s) => ({ name: s.name }));
    const fitServiceNames = [...new Set([
      ...pageServices.map((service) => service.name),
      ...firstPartyServiceTextFragments(page.html),
    ].map((value) => String(value || "").trim()).filter(Boolean))];
    const templateFitAssessment = operatorLine
      ? templateFitAdmission({
          trigger: input.trigger,
          targetVertical: cand.plan.vertical,
          businessName,
          ldNodes: effectiveLd,
          serviceNames: fitServiceNames,
          html: page.html,
          placePrimaryType: nap.place ? nap.place.primaryType : "",
        })
      : null;
    const templateFit = ownerOnlyPractice
      ? {
          ...templateFitAssessment,
          ok: true,
          original_ok: templateFitAssessment.ok === true,
          advisory: true,
          provenance_class: "provisional",
          admittedBy: "operator_requested_provisional",
          requested_vertical: cand.plan.vertical,
          ...(templateFitAssessment.ok
            ? { evidence_observation: templateFitAssessment.admittedBy || "first_party_website" }
            : { advisory_reason: templateFitAssessment.reason || "template_fit_unconfirmed" }),
        }
      : templateFitAssessment;
    const tradeAssessment = tradeSwapCheck({
      place: nap.place || {},
      vertical: cand.plan.vertical,
      html: page.html,
      env,
    });
    const sportFencingMismatch = tradeAssessment.reason === "vertical_mismatch_sport_fencing";
    const trade = ownerOnlyPractice && !sportFencingMismatch
      ? {
          ok: true,
          advisory: true,
          provenance_class: "provisional",
          basis: "operator_requested_trade",
          requested_trade: cand.plan.vertical,
          observed: tradeAssessment.observed || [],
          ...(tradeAssessment.ok
            ? { evidence_observation: tradeAssessment.corroboration || "website_trade_signal" }
            : { advisory_reason: tradeAssessment.reason || "category_disagreement" }),
        }
      : tradeAssessment;
    if (!trade.ok) {
      if (trade.reason === "vertical_mismatch_sport_fencing") {
        const at = new Date().toISOString();
        const slug = mintSlug(businessName, nap.locality);
        heldRows.push({
          prospect_id: slug,
          status: "held",
          business_name: businessName,
          email: emailOut.email || null,
          owner_email: null,
          phone: (nap.place && nap.place.nationalPhoneNumber) || nap.phone || null,
          current_website: (nap.place && nap.place.websiteUri) || cand.url,
          industry: cand.plan.vertical,
          city: nap.locality,
          state: nap.state,
          leadminer_score: 0,
          source: "build-ready-mine-held",
          record: {
            prospect_id: slug,
            place_id: (nap.place && nap.place.id) || null,
            business_name: businessName,
            email: emailOut.email || null,
            phone: (nap.place && nap.place.nationalPhoneNumber) || nap.phone || null,
            current_website: (nap.place && nap.place.websiteUri) || cand.url,
            industry: cand.plan.vertical,
            city: nap.locality,
            state: nap.state,
            text_query: cand.plan.textQuery,
            website_probe: probe,
            source: "build-ready-mine-held",
            status: "held",
            blocked_reason: "vertical_mismatch_sport_fencing",
            vertical_hold: {
              reason: "vertical_mismatch_sport_fencing",
              at,
              sport_signals: trade.observed || [],
              contractor_signals: trade.contractorSignals || [],
              // Only sources that actually testified: a first-party identity
              // has no Google observation to cite.
              evidence_sources: [...(nap.place ? ["google_business_profile"] : []), "business_name", "first_party_site"],
            },
          },
          updated_at: at,
        });
      }
      note(stages.s6, cand.domain, null, trade.reason, JSON.stringify(trade.observed));
      continue;
    }
    if (brand.markPending) {
      // THE WORDMARK IS NEVER COLOURLESS WHEN THE SITE DECLARED A COLOUR. The
      // ladder mark is the honest answer to an unusable image; an empty colour
      // is not an honest answer to "what does their brand look like" when
      // `--accent` is sitting in the HTML we fetched. (Empty stays possible —
      // a site with no saturated colour anywhere has nothing to declare.)
      brand.mark = chooseBrandMark({
        logoCandidates: [],
        businessName,
        accent: (brand.siteAccent && brand.siteAccent.hex) || "",
      });
      delete brand.markPending;
    }
    stages.s6.survived++;

    if (String(input.trigger || "") === "operator_line") {
      stages.s6fit.entered++;
      if (!templateFit.ok) {
        // THIN-FLOW LAW (2026-09-04): the template-family fit verdict is a
        // quality score, so it records instead of refusing. A sparse or
        // below-threshold site proceeds to the compiler, which enriches thin
        // content from the harvested first-party evidence; the verdict itself
        // stays on the packet (qualification.template_fit) for provenance.
        // Identity, trade holds, and the other non-quality gates keep their
        // refusals untouched.
        acceptThin(stages.s6fit, templateFit.reason || "template_fit_unconfirmed");
      }
      stages.s6fit.survived++;
    }

    // STAGE 6b — the composite axis. The identity mask buys no trust fields,
    // so this lane measures NO Google score axes: a partial place would coerce
    // absent fields to a measured zero and bias the C+ ceiling toward
    // admitting. Legacy/store enrichment keeps its own measured path elsewhere.
    stages.s6b.entered++;
    const socialCat = buildQual.minedSocialCategory(social);
    const allCats = { ...websiteCats, ...(socialCat ? { socialMedia: socialCat } : {}) };
    const geoCat = buildQual.minedGeoCategory(allCats);
    if (geoCat) allCats.geo = geoCat;
    const composite = buildQual.minedComposite(allCats);
    const compositeVerdict = buildQual.qualifyCompositeAxis(composite, env);
    if (!compositeVerdict.ok) {
      // THIN-FLOW LAW (2026-09-04): the composite ceiling is a quality score
      // and no longer refuses. The measured composite still rides the packet
      // (qualification.composite_signal) and the counter key still names the
      // ceiling that WOULD have refused, so the funnel shows the law working.
      acceptThin(stages.s6b, composite ? `composite_above_${buildQual.gradeSlug(compositeVerdict.ceiling)}` : "composite_unmeasured");
    }
    stages.s6b.survived++;

    // STAGE 7 — identity + slug.
    stages.s7.entered++;
    const identityKey = identityKeyFor(businessName, nap.locality);
    if (emittedIdentities.has(identityKey)) { note(stages.s7, cand.domain, null, "duplicate_identity_in_batch"); continue; }
    const slug = mintSlug(businessName, nap.locality);
    if (slug.length < 3 || RESERVED_SLUGS.has(slug)) { note(stages.s7, cand.domain, null, "slug_reserved_or_too_short"); continue; }
    const coherence = slugCoherence(slug, businessName, nap.locality);
    if (!coherence.ok) { note(stages.s7, cand.domain, null, "slug_incoherent", coherence.reason); continue; }
    stages.s7.survived++;

    // ---- BUILD THE FACTS. Absent beats invented, everywhere. ---------------
    // NAP and trade are separate evidence questions. `nap.place` controls the
    // identity/address/phone labels. Industry credits Google only when an exact
    // mapped Place type corroborates the trade; otherwise it stays labelled as
    // self-published first-party evidence even when Google proved the identity.
    const firstParty = !nap.place;
    const businessNameFirstParty = firstParty;
    // IDENTITY TRUST MODE bookkeeping: which locality/state came from the
    // site itself, and which are the queried-market hint carried in their
    // absence. Per-field, because a site may publish a city and no state.
    const identityTrustInfo = (nap.identity_trust && typeof nap.identity_trust === "object")
      ? nap.identity_trust
      : null;
    const identityTrustCityHint = Boolean(identityTrustInfo && !identityTrustInfo.site_locality);
    const identityTrustStateHint = Boolean(identityTrustInfo && !identityTrustInfo.site_state);
    const provisionalMarket = nap.provisionalMarket === true;
    const provisionalTrade = trade.provenance_class === "provisional";
    const homepageRetrieval = page.scrapedViaFirecrawl === true
      ? {
          retrieval_method: "firecrawl_scrape",
          direct_fetch_failure: String(page.directFetchFailure || "site_unreachable")
            .replace(/[^a-z0-9_.:-]/gi, "_")
            .slice(0, 80),
        }
      : { retrieval_method: "direct_fetch" };
    const homepageObserver = page.scrapedViaFirecrawl === true
      ? "firecrawl_scrape"
      : "wss_miner_fetch";
    const photoObserver = page.scrapedViaFirecrawl === true
      ? "wss_miner_fetch + firecrawl_scrape"
      : "wss_miner_fetch";
    const tradeObserver = page.scrapedViaFirecrawl === true
      ? "wss_miner + firecrawl_scrape"
      : "wss_miner";
    // NAP provenance and trade provenance are separate questions. A Google
    // place may prove the business identity while remaining silent about the
    // trade; in that case the industry conclusion is still self-published.
    const googleTradeCorroborated = trade.corroboration === "google_place_type";
    const facts = {
      business_name: businessName,
      industry: cand.plan.vertical,
      city: nap.locality,
      state: nap.state,
    };
    const provenance = {
      business_name: businessNameFirstParty
        ? prov(businessName, cand.url, "the business itself", `self_published:${firstParty ? nap.nameSurface : (parsed.title ? "html_title" : "search_result_title")}`, {
          class: "self_published",
          meaning: "the name the business publishes on its own site — no independent NAP observation exists for this record",
          ...homepageRetrieval,
          ...(identityTrustInfo ? { identity_trust: identityTrustInfo.reason } : {}),
        })
        : prov(businessName, "google_places_searchtext", "google", "nap_display_name", { class: "nap" }),
      industry: googleTradeCorroborated
        ? prov(cand.plan.vertical, "donor_library + google_place_types", "wss_miner + google", `corroboration:${trade.corroboration}`, { class: "derived", observed_types: trade.observed })
        : provisionalTrade
        ? prov(cand.plan.vertical, "operator_requested_trade", "wss_operator", "operator_requested_provisional", {
          class: "provisional",
          advisory: true,
          observed_types: trade.observed,
          meaning: "temporary Practice template-routing request; Intake must verify the business offer before live delivery",
        })
        : prov(cand.plan.vertical, "donor_library + first_party_site", tradeObserver, `corroboration:${trade.corroboration}`, {
          class: "derived",
          observed_types: trade.observed,
          ...homepageRetrieval,
        }),
      city: identityTrustCityHint
        ? prov(nap.locality, "queried_market_hint", "wss_miner", "identity_trust_mode", {
          class: "provisional",
          identity_trust: identityTrustInfo.reason,
          meaning: "site published no structured locality — the queried market is carried as a hint until a human confirms it by phone",
        })
        : provisionalMarket
        ? prov(nap.locality, "operator_requested_market", "wss_operator", "candidate_market_hint", {
          class: "provisional",
          meaning: "temporary Intake routing hint — not postal NAP and not deploy authority",
        })
        : firstParty
        ? prov(nap.locality, cand.url, "the business itself", `self_published:${nap.addressSurface}`, { class: "self_published", ...homepageRetrieval })
        : prov(nap.locality, "google_places_address_components", "google", "locality", { class: "nap", meaning: "POSTAL city — ADDRESS_CITY only" }),
      // The state fact records WHICH market it was fenced against and on what
      // basis, so a stored packet can be re-audited without re-deriving the
      // mining plan from the text_query.
      state: identityTrustStateHint
        ? prov(nap.state, "queried_market_hint", "wss_miner", "identity_trust_mode", {
          class: "provisional",
          identity_trust: identityTrustInfo.reason,
          meaning: "site published no structured state — the queried market is carried as a hint until a human confirms it by phone",
          mined_for: fence.queried,
        })
        : provisionalMarket
        ? prov(nap.state, "operator_requested_market", "wss_operator", "candidate_market_hint", {
          class: "provisional",
          meaning: "temporary Intake routing hint — not postal NAP and not deploy authority",
          mined_for: fence.queried,
        })
        : firstParty
        ? prov(nap.state, cand.url, "the business itself", `self_published:${nap.addressSurface}`, { class: "self_published", metro_fence: fence.basis, mined_for: fence.queried, ...homepageRetrieval })
        : prov(nap.state, "google_places_address_components", "google", "administrative_area_level_1.shortText", { class: "nap", metro_fence: fence.basis, mined_for: fence.queried }),
    };

    // Phone: OPTIONAL since 2026-08-01 (outreach is email-only) but FROZEN at
    // write time — client-isolation stamps phoneDigits on the first build and
    // every later build must agree, so "phone-optional" never means
    // "phone-mutable". A number that cannot reduce to 10 clean NANP digits is
    // dropped here rather than 422-ing the build later.
    const phoneRaw = String((nap.place && nap.place.nationalPhoneNumber) || nap.phone || "").trim();
    if (phoneRaw) {
      const digits = derivePhoneDigits(phoneRaw);
      if (digits.ok) {
        facts.phone = phoneRaw;
        provenance.phone = firstParty
          ? prov(phoneRaw, cand.url, "the business itself", `self_published:${nap.phoneSurface}`, { class: "self_published", digits: digits.digits, frozen: true, ...homepageRetrieval })
          : prov(phoneRaw, "google_places_searchtext", "google", "national_phone_number", { class: "nap", digits: digits.digits, frozen: true });
      }
    }

    const cleanEmail = sanitizeEmail(emailOut.email);
    if (cleanEmail) {
      facts.email = cleanEmail;
      provenance.email = prov(cleanEmail, cand.url, homepageObserver, "published_on_first_party_homepage", {
        class: "self_published",
        domain_class: emailOut.domain_class,
        mx: emailOut.mx,
        verified_by: ["sanitize_email", emailOut.domain_class, "dns_mx_record"],
        ...homepageRetrieval,
      });
    }

    // MARKET vs POSTAL — two fields, two sources, two resolvers. Never merged.
    // The engine's own serviceAreaAssertion() reads the client's OWN site; the
    // coherence rule is verified-facts.js's, reproduced exactly. `assertion` was
    // resolved once, above, where the metro fence also reads it.
    if (assertion && assertion.city) {
      const assertedState = (assertion.state || "").toUpperCase();
      const market = eligibleMarketCity({
        assertedCity: assertion.city,
        assertedState,
        queryCity: cand.plan.metro.city,
        queryState: cand.plan.metro.state,
        napCity: nap.locality,
        napState: nap.state,
        businessName,
      });
      if (market.eligible && !FORBIDDEN_VALUE_CHARS.test(market.service_area)) {
        facts.service_area = market.service_area;
        provenance.service_area = prov(market.service_area, cand.url, "the business itself", `self_published:${assertion.surface}`, {
          class: "self_published",
          meaning: "MARKETING city — drives CITY, the title and the hero headline",
          differs_from_nap_city: nap.locality,
          mined_for: cand.plan.metro.city,
          ...homepageRetrieval,
        });
      }
    }

    if (nap.latitude != null && nap.longitude != null) {
      facts.latitude = nap.latitude;
      facts.longitude = nap.longitude;
      provenance.latitude = prov(nap.latitude, "google_places_searchtext", "google", "location.latitude", { class: "geo", bbox_checked: nap.state });
      provenance.longitude = prov(nap.longitude, "google_places_searchtext", "google", "location.longitude", { class: "geo", bbox_checked: nap.state });
    }
    // Geo, address and place_id exist ONLY when Google observed them: the
    // first-party lane ships with no coordinates and no place_id (the mirror
    // renders without a map pin rather than pinning an unverified location).
    // The one first-party exception is a postal code the site printed itself.
    if (firstParty) {
      const postal = String(nap.postal_code || "").trim();
      if (postal && !FORBIDDEN_VALUE_CHARS.test(postal)) {
        facts.postal_code = postal;
        provenance.postal_code = prov(postal, cand.url, "the business itself", `self_published:${nap.addressSurface}`, { class: "self_published" });
      }
    } else {
      for (const [field, value, method] of [
        ["address", nap.place.formattedAddress, "formatted_address"],
        ["county", nap.county, "administrative_area_level_2"],
        ["postal_code", nap.postal_code, "postal_code"],
        ["place_id", nap.place.id, "place_id"],
      ]) {
        const v = String(value || "").trim();
        if (!v || FORBIDDEN_VALUE_CHARS.test(v)) continue;
        facts[field] = v;
        provenance[field] = prov(v, "google_places_searchtext", "google", method, { class: field === "place_id" ? "nap" : "geo" });
      }
    }
    if (operatorLine && /^https:\/\//i.test(cand.url)) {
      facts.current_website = cand.url;
      provenance.current_website = prov(cand.url, cand.url, "the business itself", "own_site_url", { class: "self_published" });
    } else if (nap.place && nap.place.websiteUri && /^https:\/\//i.test(nap.place.websiteUri)) {
      facts.current_website = nap.place.websiteUri;
      provenance.current_website = prov(nap.place.websiteUri, "google_places_searchtext", "google", "website_uri", { class: "nap" });
    } else if (firstParty && /^https:\/\//i.test(cand.url)) {
      // Domain-bound asset proof (logos, photos, emails) keys off the record's
      // website — a first-party record must state the site it was read from.
      facts.current_website = cand.url;
      provenance.current_website = prov(cand.url, cand.url, "the business itself", "own_site_url", { class: "self_published" });
    }
    // RATING + REVIEW_COUNT are third_party_trust: the subject is structurally
    // disqualified from supplying them, and toMirrorRequest drops BOTH unless
    // BOTH are present. Google is an independent observer, so the pair is
    // admissible — and it is written as a PAIR or not at all. The first-party
    // lane can never write them: the business itself is not an admissible
    // observer of its own stars.
    const rating = Number(nap.place && nap.place.rating);
    const reviewCount = Number(nap.place && nap.place.userRatingCount);
    if (Number.isFinite(rating) && rating > 0 && Number.isInteger(reviewCount) && reviewCount > 0) {
      facts.rating = rating;
      facts.review_count = reviewCount;
      const observers = ["google_places_searchtext"];
      provenance.rating = prov(rating, "google_places_searchtext", "google", "rating", { class: "third_party_trust", observers });
      provenance.review_count = prov(reviewCount, "google_places_searchtext", "google", "user_rating_count", { class: "third_party_trust", observers });
    }

    // ---- THE CONTENT AN OBSERVATION ALREADY CARRIES -------------------------
    //
    // COST DIRECTIVE 2026-08-25: `places.reviews` and `places.regularOpeningHours`
    // are no longer requested on the identity mask (they were the fields that
    // put every call on the highest SKU tier), so a LIVE Google identity lookup
    // arrives without them and this block honestly writes nothing. The shaping
    // is retained for the observations that still carry these fields — webhook
    // packets, stored place objects, injected tests — because throwing away
    // data an observation already holds was the original defect here.
    //
    // TRUTH, unchanged: these come off the SAME place object that supplied the
    // identity, a place accepted only because its own websiteUri supplied or
    // resolves to this candidate's registrable domain. The first-party lane has
    // no Google observation and therefore no reviews and no GBP hours — absent,
    // never invented.
    // SHAPED WITH THE ENGINE'S OWN SHAPER, NOT BY HAND. reviewsFromPlace emits
    // the STORE's field names (author_photo_url, published_at); MirrorContent
    // declares avatarUrl/publishedAt and is additionalProperties:false. Feeding
    // the raw shape into content.reviews hard-400s the dry run with
    //   /content/reviews/0 · must NOT have additional properties
    // shapeReviews already accepts both spellings, so nothing is lost.
    const placeReviews = nap.place ? shapeReviews(reviewsFromPlace(nap.place)) : [];
    const placeHours = nap.place
      ? hoursFromWeekdayDescriptions(
        (nap.place.regularOpeningHours && nap.place.regularOpeningHours.weekdayDescriptions) || [],
      )
      : [];
    // ---- THE SERVICES THIS LANE HAS BEEN THROWING AWAY SINCE IT WAS WRITTEN --
    //
    // The identical defect as the reviews and hours above, in the identical
    // function, left behind by the identical fix. `rowFromPlace` — the LEGACY
    // lane — has written services since the beginning (see publicServiceNames at
    // its line 601). This lane wrote `facts` and a two-key content block and
    // stopped, so every build-ready contract went to the store with no services
    // at all. Measured against the whole store on 2026-08-11:
    //
    //   record.services (legacy lanes)                        737 rows non-empty
    //   build_ready.mirror_request.content.services             0 rows non-empty
    //   build-ready-mine rows with services ANYWHERE            0 of 212
    //
    // Content keys present across all 212 build-ready contracts: {hours, reviews}.
    // The word "services" never appeared once.
    //
    // WHY THE MIRRORS STILL HAD SERVICE CARDS, and why they were wrong. With the
    // contract silent, the only surviving source was mirror-lane-build's
    // resolver, whose services come from ANCHOR TEXT IN THE CLIENT'S NAVIGATION
    // — and mergeContentSources puts the resolver first, so nav won by design on
    // every build-ready lead. That is how wss-test-rose-city-heating-and-air-
    // portland came to publish "Photo Gallery", "Comfort Club", "Filter Club"
    // and "Products" as four of its twelve schema.org Services.
    //
    // WHAT IS HARVESTED HERE, in the owner's words: "real services harvested
    // from the client's own page content, never nav labels." Two first-party
    // sources off `page.html` — bytes already fetched, in hand, free:
    //   · the site's declared schema.org OfferCatalog / makesOffer / Service
    //     nodes (`ld`, already parsed for this lead), and
    //   · the headings inside the page's own services section.
    // No navigation is read on this path at all. See service-harvest.js.
    //
    // Cost of the fix: ZERO. Not one extra request.
    const content = {
      ...(pageServices.length ? { services: pageServices } : {}),
      ...(placeReviews.length ? { reviews: placeReviews } : {}),
      ...(placeHours.length ? { hours: placeHours } : {}),
    };
    // ---- THE PHOTOGRAPHS, BANKED WITH THE CONTRACT ------------------------
    //
    // The identical defect as the services above, one field along. A photo
    // harvester has been live since 2026-08-03 and it works — run against
    // mmheatingandcooling.com it returns their own photographs in ten seconds —
    // but nothing has ever written its output into a contract. Measured across
    // the whole store on 2026-08-11:
    //
    //   stored contracts carrying brand.photos                 0 of 424
    //   live mirrors serving no client photograph at all      24 of 88
    //   record.photos (the field mirror-lane-build reads)       0 of 1333 rows
    //
    // So every downstream reader of the contract — the outreach email, the
    // Connect site KB, Riley's brief, a rebuild — has only ever seen ONE image
    // per client: the logo. That is the "1.0 images per site" the owner
    // measured. The pictures existed; nobody wrote them down.
    //
    // MOSTLY FREE. The homepage bytes are already in hand; the only new
    // requests are the client's own pages and one GET per candidate image.
    // Places Photo media is billed per request and this lane never resolves
    // it — no key is handed to the bank, so Google photos stay out of every
    // mining path by construction. Already-resolved URLs on a record
    // (webhook packets) remain free and are still read.
    let bank = null;
    if (String(env.GHOST_AGENCY_PHOTO_BANK ?? "true").toLowerCase() !== "false") {
      try {
        bank = await photoBank.buildPhotoBank({
          website: page.finalUrl || cand.url,
          html: page.html || "",
          // The Google observation, when one exists; its photo RESOURCE NAMES
          // pin GBP media to the exact verified business. First-party lane:
          // no place, own-site photography only.
          record: nap.place ? {
            place_id: nap.place.id || "",
            photos: Array.isArray(nap.place.photos) ? nap.place.photos.map((p) => p && p.name).filter(Boolean) : [],
            gbp_url: nap.place.googleMapsUri || "",
          } : {},
          placesApiKey: "",
          fetchImpl,
        });
        cost.places_photo_media_calls = (cost.places_photo_media_calls || 0) + (bank.cost.gbp_media_calls || 0);
        cost.photo_page_fetches = (cost.photo_page_fetches || 0) + (bank.cost.page_fetches || 0);
      } catch (e) {
        // Photography is enrichment. A smaller gallery, never a lost lead —
        // the donor's own imagery is the documented safe fallback.
        bank = { version: photoBank.BANK_VERSION, photos: [], refused: [], verdict: "harvest_failed", note: String(e.message || e).slice(0, 160) };
      }
    }
    const bankPhotos = photoBank.bankToRequestPhotos(bank, 8);
    if (bankPhotos.length) {
      provenance.photos = prov(
        `${bankPhotos.length} photograph(s)`,
        cand.url,
        photoObserver,
        "client_photo_bank",
        {
          class: "self_published",
          own_site: bank.counts.own_site,
          gbp: bank.counts.gbp,
          hero_grade: bank.counts.hero,
          refused: bank.counts.refused,
          shas: bank.photos.slice(0, 8).map((p) => p.sha256.slice(0, 12)),
          meaning: bank.note,
          ...homepageRetrieval,
        },
      );
    }
    if (pageServices.length) {
      provenance.services = prov(
        `${pageServices.length} service(s)`, cand.url, homepageObserver, "first_party_page_content",
        {
          class: "self_published",
          sources: serviceHarvest.counts,
          refused: serviceHarvest.dropped.length,
          meaning: "the client's own declared offer catalogue and the headings in their own services section — never their navigation",
          ...homepageRetrieval,
        },
      );
    }
    if (placeReviews.length) {
      provenance.reviews = prov(
        `${placeReviews.length} review(s)`, "google_places_searchtext", "google", "places.reviews",
        {
          class: "third_party_trust",
          place_id: nap.place.id || "",
          faces: placeReviews.filter((r) => r.avatarUrl).length,
          meaning: "Google's own corpus, authored by customers — the one review source that is not the business talking about itself",
        },
      );
    }
    if (placeHours.length) {
      provenance.hours = prov(
        `${placeHours.length} day(s)`, "google_places_searchtext", "google",
        "places.regularOpeningHours.weekdayDescriptions", { class: "self_published_via_gbp", place_id: nap.place.id || "" },
      );
    }
    // The client's Google Maps listing — the destination behind the "see our
    // reviews" and map links, and schema.org sameAs. Google's own URL for the
    // place we verified, never assembled by hand from a name and a city.
    if (nap.place && /^https:\/\//i.test(String(nap.place.googleMapsUri || ""))) {
      facts.profile_url = nap.place.googleMapsUri;
      provenance.profile_url = prov(nap.place.googleMapsUri, "google_places_searchtext", "google", "google_maps_uri", { class: "nap" });
    }

    // ---- THE PROFILES THEY DID NOT KNOW WERE THEIRS ------------------------
    //
    // The owner's own words for why this exists: "we have gathered their assets
    // that they didn't even know they were on and put them all on their site
    // for them to see clearly."
    //
    // Two sources, one strict rule. The homepage links were already harvested
    // for free in the free phase (own_site_link — they linked it themselves, so
    // ownership is not in question). Non-operator lanes may add ONE Firecrawl
    // search only after every gate; operator_line stays on own-site links and
    // never makes a second Firecrawl Search call.
    // Anything the search returns must carry EVERY distinctive token of the
    // verified business name or it is refused by name — and the refusals are
    // recorded, because a silent drop is how a wrong page creeps back in.
    //
    // NEVER A BLOCKER. Zero profiles is a normal, common outcome and the mirror
    // ships without the bar. "If they don't have Google reviews, they get it —
    // they don't have Google reviews. They still need a website."
    let socialRefusals = [];
    try {
      // The operator Line already spent its one Firecrawl website-search call at
      // stage 1. Socials linked from the prospect's own site still flow through,
      // but it must not silently add another search call.
      const socialSearchOn = !operatorLine
        && String(env.GHOST_AGENCY_SOCIAL_SEARCH ?? "true").toLowerCase() !== "false";
      const found = await socialDiscovery.discoverSocials({
        businessName,
        siteUrl: cand.url,
        html: page.html,
        maxSearches: socialSearchOn ? 1 : 0,
        search: socialSearchOn
          ? ({ query, limit }) => firecrawlSearch({ query, limit, apiKey: firecrawlKey, endpoint: input.firecrawlEndpoint, fetchImpl, env })
          : null,
      });
      cost.firecrawl_search_calls += found.searchCalls;
      socialRefusals = found.refused;
      if (found.profiles.length) {
        facts.socials = found.profiles.map((p) => ({
          network: p.network, url: p.url, label: p.label, handle: p.handle, provenance: p.provenance,
        }));
        provenance.socials = prov(
          `${found.profiles.length} owned profile(s)`,
          found.searchCalls > 0
            ? "prospect_own_site_links + firecrawl_search"
            : "prospect_own_site_links",
          "wss_miner",
          "social_discovery",
          {
            class: "self_published",
            networks: found.profiles.map((p) => `${p.network}:${p.provenance}`),
            refused: socialRefusals.length,
            meaning: "Profiles the business linked from its own site, or whose handle/title carries every distinctive token of its verified name. Nothing else was attached.",
          },
        );
      }
    } catch (e) {
      // Discovery is enrichment. It does not get to kill a qualified lead, and
      // it must not be recorded as a funnel rejection either: stage 7 has
      // already counted this lead as survived, and `note` here would break the
      // funnel's reconciliation invariant (entered === survived + rejected)
      // for a lead that in fact survived. The failure is carried on the record.
      socialRefusals = [{ reason: "social_discovery_threw", detail: String(e.message || e).slice(0, 160) }];
    }

    // The identity mapped to EXACTLY the schema's brand_identity shape once —
    // both the request field and the accent_fallback pair are cut from this,
    // so a malformed colour or a non-https source can never reach Ajv.
    const identityForRequest = brandIdentity ? brandIdentityForRequest(brandIdentity) : null;
    // The whole-website palette, cut to the schema's site_palette shape the
    // same way — malformed fields drop, a colourless verdict transports as
    // nothing (Ajv never sees the key).
    const sitePaletteRequest = sitePalette ? sitePaletteForRequest(sitePalette) : null;

    const mirrorRequest = {
      slug,
      donor: cand.plan.donor,
      facts,
      brand: {
        ...(brand.logo ? {
          logo: brand.logo.url,
          logo_sha256: brand.logo.sha256,
          // A MEASURED accent rides as THE accent (engine skips measuring). An
          // unmeasurable mark rides as accent_fallback only: the engine still
          // measures the bytes itself at build time and the fallback fills the
          // hole a decoder-less runtime leaves. (Break 2: this is the line
          // lane's mirror dispatch finally carrying accent data the miner
          // proved — the webhook lane's brand_colors path, wired from what the
          // miner itself measured of the client's own page.)
          ...(brand.logo.accent ? {
            accent: brand.logo.accent,
            accent_source: brand.logo.url,
          } : {}),
          ...(brand.accentFallback ? {
            accent_fallback: brand.accentFallback.hex,
            accent_fallback_source: brand.accentFallback.source,
          } : {}),
        } : { mark: brand.mark }),
        // THEIR OWN PHOTOGRAPHS. Hero-grade first — the engine fills the
        // donor's photo_slots in array order and plumbing-clean declares two,
        // so this array IS which two of a client's photographs a visitor sees.
        ...(bankPhotos.length ? { photos: bankPhotos } : {}),
        // THE EXTRACTOR'S CSS-MEASURED ACCENT AS THE BUILD-TIME FALLBACK. When
        // the logo bytes cannot be decoded in the serverless runtime (the WebP
        // case), resolveBrandAssets measures null and would otherwise ship the
        // donor's palette; accent_fallback is its sanctioned "the miner already
        // proved this colour" fill. Same colour the accent above carries when
        // the hint rescue ran — carried twice on purpose, because the two keys
        // answer different failures at build time. The SOURCE is the page the
        // extraction ran against (raw identity, https-gated — the schema's
        // accent_fallback_source is RequiredHttpsUri).
        ...(brand.logo && identityForRequest && identityForRequest.accent_color
          && typeof brandIdentity.extracted_from === "string" && /^https:\/\//i.test(brandIdentity.extracted_from) ? {
          accent_fallback: identityForRequest.accent_color,
          accent_fallback_source: brandIdentity.extracted_from,
        } : {}),
      },
      // The structured identity itself, schema-carried so the engine's palette
      // can wear the client's colours even when NO logo survived verification
      // (wordmark path): brand_identity.accent_color is buildPalette's
      // last-resort accent source.
      ...(identityForRequest && Object.keys(identityForRequest).length
        ? { brand_identity: identityForRequest }
        : {}),
      // THE WHOLE-WEBSITE PALETTE, schema-carried so the engine's buildPalette
      // can dress the mirror in the prospect's own page colours (surfaces,
      // ink, dark-band rhythm — the logo becomes one input, not the only
      // one). Sanitized above; a page with nothing readable is omitted
      // entirely and the build falls through logo → donor → vertical.
      ...(sitePaletteRequest && Object.keys(sitePaletteRequest).length
        ? { site_palette: sitePaletteRequest }
        : {}),
      // THE CLIENT'S MEASURED DNA, schema-carried so the engine can score the
      // build's distinctiveness against it (instrumentation only — it never
      // changes the render or the build hash). Sanitized field-by-field to the
      // schema's donor_fingerprint shape; a fingerprint with nothing scorable
      // is omitted rather than transported as noise.
      ...(() => {
        const carried = donorFingerprint && !donorFingerprint.extraction_error
          ? donorFingerprintForRequest(donorFingerprint) : null;
        return carried ? { donor_fingerprint: carried } : {};
      })(),
      ...(Object.keys(content).length ? { content } : {}),
    };

    // The extraction receipt, for the same audit the socials keep.
    if (brandIdentity && brandIdentity.accent_color) {
      provenance.brand_identity = prov(
        `${String(brandIdentity.accent_color).toUpperCase()} (${String(brandIdentity.confidence || "LOW")}, ${String(brandIdentity.extraction_method || "unknown")})`,
        "prospect_own_site_html+css",
        "wss_miner",
        "brand_extraction",
        {
          class: "self_published",
          extracted_from: brandIdentity.extracted_from || "",
          logo_candidate: brandIdentity.logo_url || "",
          meaning: "Colours, logo candidate and font read from the prospect's own page HTML and CSS by lib/brand-extractor. Drives the mirror palette only where no stronger brand signal exists; the logo URL stays a candidate until the ownsLogo/denylist/sniff pipeline verifies it.",
        },
      );
    }

    // The whole-website palette receipt, for the same audit: the surfaces,
    // ink, accent and dark-band reading that dressed the mirror's canvas.
    if (sitePalette && sitePalette.ok) {
      provenance.site_palette = prov(
        `surface ${sitePalette.surface || "(none)"} / ink ${sitePalette.ink || "(none)"} / accent ${sitePalette.accent || "(none)"} (${sitePalette.darkSectionCount || 0} dark band(s))`,
        "prospect_own_site_html+css",
        "wss_miner",
        "site_palette_extraction",
        {
          class: "self_published",
          extracted_from: sitePalette.extractedFrom || "",
          meaning: "The prospect's own page surfaces, ink, accent usage and dark-band rhythm, read from their homepage HTML (plus the site's own stylesheets the brand lane already fetched) by lib/mirror-engine/site-palette. PRIMARY source for the mirror's surfaces and ink; the logo corroborates the accent. Never gates a build.",
        },
      );
    }

    // The fingerprint receipt, beside it: what DNA was recorded, and the fact
    // that it is instrumentation (scores the build; never gates it).
    if (donorFingerprint && !donorFingerprint.extraction_error) {
      const fpForRecord = donorFingerprintForRequest(donorFingerprint);
      if (fpForRecord) {
        provenance.donor_fingerprint = prov(
          `${fpForRecord.logo_candidates.length} logo candidate(s), ${fpForRecord.service_taxonomy.services.length} named service(s), motif ${fpForRecord.hero_motif}, CTA ${fpForRecord.cta_structure.dominant}`,
          "prospect_own_site_html",
          "wss_miner",
          "donor_fingerprint_extraction",
          {
            class: "self_published",
            extracted_from: fpForRecord.extracted_from,
            meaning: "The client's own visual DNA (logo candidates with dimensions/alt, palette consumed from brand_identity, typography pattern, hero motif, section ordering, service taxonomy by name, proof inventory, CTA structure) read from their homepage by lib/mirror-engine/donor-fingerprint. Scores the mirror's distinctiveness at build time; it never gates publication and never enters the build hash.",
          },
        );
      }
    }

    // STAGE 8 — THE CLOSER. A record that has not passed a dry run is not
    // written. The dry run itself is deferred to a bounded concurrent pass
    // below so the mirror build does not serialize the whole batch.
    dryRunQueue.push({
      mirrorRequest,
      domain: cand.domain,
      identityKey,
      record: {
      lead_id: facts.place_id || identityKey,
      slug,
      identity_key: identityKey,
      // The observer that supplied the identity, stated once at the record
      // root; a provider-failure fallback carries the refusal it fell from.
      identity_source: provisionalMarket
        ? "owner_only_practice_provisional"
        : (firstParty ? "first_party" : "google_places"),
      // Delivery policy is independent of identity quality. Every record
      // admitted under the explicit owner-only Practice lane carries this
      // durable scope, including records whose first-party identity is fully
      // proven. Live selection rejects the scope before Intake/provider work.
      ...(ownerOnlyPractice ? { admission_scope: "owner_only_practice" } : {}),
      ...(provisionalMarket ? {
        identity_provisional: true,
        identity_provisional_reason: "awaiting_intake_genie_identity",
      } : {}),
      ...(nap.fallback ? { identity_fallback: nap.fallback } : {}),
      ...(trustOverrides.length ? { identity_trust_overrides: trustOverrides } : {}),
      donor: cand.plan.donor,
      donor_via: cand.plan.donorVia,
      mirror_request: mirrorRequest,
      provenance,
      // THE DONOR FINGERPRINT, stored first-party on the prospect record —
      // keyed to the row's prospect_id by rowFromBuildReady, so every rebuild
      // can re-score against the client's DNA without re-crawling their site.
      // Carries the extraction_error marker when it failed, so absence is
      // always distinguishable from never-looked.
      ...(donorFingerprint ? { donor_fingerprint: donorFingerprint } : {}),
      // THE FULL PHOTO BANK — every kept photograph with its source page,
      // dimensions, byte count, sha256 and grade, plus every candidate we
      // refused and why. brand.photos above is only the URLs; this is the
      // evidence behind them, and the sha is what makes a photograph the same
      // row across rebuilds instead of an anonymous URL that may have moved.
      //
      // `verdict: "no_usable_photography"` is a REAL ANSWER for a real
      // business, and is deliberately distinguishable from never having looked.
      ...(bank ? { photo_bank: bank } : {}),
      brand_evidence: brand.logo ? {
        logo_url: brand.logo.url,
        logo_sha256: brand.logo.sha256,
        logo_bytes: brand.logo.bytes,
        logo_mime: brand.logo.mime,
        // MEASURED vs DEFERRED are different claims and both must be auditable.
        // A deferred accent ("") means this runtime could not decode the bytes;
        // the colour the site declared rides beside it as accent_fallback, and
        // the engine re-measures the logo wherever a decoder exists.
        ...(brand.logo.accent ? {
          accent: brand.logo.accent,
          accent_origin: `measured_from_logo(${brand.logo.accent_method}, share ${Number(brand.logo.accent_share).toFixed(2)})`,
        } : {
          accent: "",
          accent_origin: brand.logo.accent_method || "unmeasured",
          ...(brand.accentFallback ? {
            accent_fallback: brand.accentFallback.hex,
            accent_fallback_source: brand.accentFallback.source,
            accent_fallback_origin: brand.accentFallback.method,
          } : {}),
        }),
        source: "prospect's own registrable domain",
        verified_by: [
          "same_owner_registrable_domain",
          "third_party_mark_denylist",
          "magic_byte_image_sniff",
          ...(brand.logo.accent ? ["measure_accent_saturation>=0.35"] : []),
        ],
      } : {
        mark: brand.mark,
        source: firstParty ? `first_party_site:${nap.nameSurface}` : "google_places_searchtext.displayName",
        verified_by: [
          ...(cand.facebookDiscovery ? ["exact_facebook_page_match"] : []),
          firstParty ? "self_published_site_name" : "google_places_display_name",
          "frozen_logo_ladder",
        ],
        fallback_reason: brand.markFallbackReason || "true_logo_absence",
        // The header-grade mark this runtime could not measure, held so the
        // render-time design brief (a real browser) can re-attach it. Same
        // owner, same pipeline, one stage later — never erased, only deferred.
        ...(brand.pendingLogo ? { unmeasured_logo: brand.pendingLogo } : {}),
        ...(brand.siteAccent ? {
          site_accent_hint: { hex: brand.siteAccent.hex, method: brand.siteAccent.method },
        } : {}),
      },
      // What we attached, and — just as important — what we DECLINED to
      // attach. An operator auditing a mirror must be able to see that the
      // Facebook page three towns over was seen and refused by name, rather
      // than never found.
      social_evidence: {
        attached: (facts.socials || []).map((s) => ({ network: s.network, url: s.url, provenance: s.provenance })),
        refused: socialRefusals,
      },
      email_evidence: {
        email: cleanEmail,
        domain_class: emailOut.domain_class,
        mx: emailOut.mx,
        discarded: emailOut.rejected,
      },
      qualification: {
        // Two ceilings, recorded separately since 2026-08-05. THIN-FLOW LAW
        // (2026-09-04): neither ceiling refuses any more — both verdicts are
        // kept MEASURED here so the proof email's before/after and every bank
        // / provenance audit keep the number that would have gated the lead.
        ceiling: buildQual.MAX_BUILDABLE_GRADE,
        website_ceiling: websiteVerdict.ceiling,
        website_axis: websiteVerdict.website,
        composite_signal: composite,
        categories: allCats,
        // THIN-TARGET PROVENANCE (issue #689): the stage-2 integration-gap
        // measurement — { gap, gaps[], score, signals[], measured } off the
        // same homepage fetch the probe rides. A POSITIVE targeting signal
        // (conversion upside), recorded exactly as measured; it feeds ranking
        // and the outreach pitch line, and refuses nothing.
        ...(integrationGap ? { integration_gap: integrationGap } : {}),
        // IDENTITY PLAUSIBILITY provenance (audit A2 / #700): the name-field
        // screen verdict and the stage-2 measured forum/board/UGC families —
        // recorded exactly as measured on every admitted row, so an auditor
        // can see the screen ran (and what it saw) even when it passed.
        name_plausibility: nameScreen,
        ...(ugcPlatform ? { ugc_platform: ugcPlatform } : {}),
        ...(templateFit ? { template_fit: templateFit } : {}),
        probe,
        reasons: [...websiteVerdict.reasons, ...compositeVerdict.reasons],
      },
      website_flatness: measuredFlatness,
      flat_site: Boolean(measuredFlatness.flat),
      trade_corroboration: trade,
      // The market this lead was mined for, the market it resolved to, and the
      // rule that let it through. `cross_border_metro_self_asserted` is the
      // loosened branch and it is never silent — it names the evidence and the
      // border it crossed.
      metro_fence: fence,
      discovery: { url: cand.url, domain: cand.domain, query: cand.plan.textQuery, via: cand.discoveryVia || (cand.directoryCrawled ? "firecrawl_crawl" : "firecrawl_search") },
      ...(cand.directoryCrawled ? { directory_crawled: true } : {}),
      },
    });
  }

  // STAGE 8 (concurrent) — run the deferred dry runs in a bounded pool. The
  // mirror build is the slow step; running it concurrently keeps a 10-50 site
  // run from serializing on it. Bounded (default 4) so the mirror lane is not
  // starved the way the render pool once was.
  const dryRunConcurrency = numberInRange(env.GHOST_AGENCY_DRY_RUN_CONCURRENCY, 4, 1, 8);
  const proveDryRun = async (item) => {
    stages.s8.entered++;
    let dry;
    try {
      dry = await mirrorImpl(JSON.parse(JSON.stringify(item.mirrorRequest)), { dryRun: true });
    } catch (e) {
      note(stages.s8, item.domain, null, "dry_run_threw", String(e.message || e).slice(0, 160));
      return;
    }
    cost.dry_runs++;
    if (!dry || !dry.ok || !dry.body || dry.body.ok !== true) {
      const body = (dry && dry.body) || {};
      note(stages.s8, item.domain, null, `dry_run_${body.error || (dry && dry.status) || "failed"}`, JSON.stringify(body.detail || "").slice(0, 200));
      return;
    }
    const brandCheck = (dry.body.checks && dry.body.checks.brand) || {};
    if (brandCheck.status !== "passed") {
      note(stages.s8, item.domain, null, `dry_run_brand_${brandCheck.status || "missing"}`, JSON.stringify({ logo: brandCheck.logo, accent: brandCheck.accent }));
      return;
    }
    stages.s8.survived++;
    emittedIdentities.add(item.identityKey);
    item.record.proof = {
      dry_run_ok: true,
      build_hash: dry.body.build_hash,
      donor_content_hash: dry.body.donor_content_hash,
      file_count: dry.body.file_count,
      brand_check: brandCheck.status,
      logo_refs_in_output: brandCheck.logo_refs_in_output,
      evidence_sha: dry.body.evidence_sha,
      renderer: dry.body.renderer,
      dry_run_at: new Date().toISOString(),
    };
    records.push(item.record);
  };
  if (operatorLine) {
    // The operator asks for an exact quota: prove candidates in rank-neutral
    // source order and stop as soon as that quota is met — never persist or
    // compile nine extra rows merely because one paid Places call returned
    // ten. LINE DEEP BATCH DEPTH lifts that stop: when the dial is raised the
    // WHOLE wave is proven (the queue is already bounded by the wave), and
    // the Line seats the goal and banks the surplus downstream.
    const proofCeiling = lineDeepBatchDepth(env) > 0 ? Number.POSITIVE_INFINITY : perQuery;
    for (const item of dryRunQueue) {
      if (records.length >= proofCeiling) break;
      await proveDryRun(item);
    }
  } else {
    await mapLimit(dryRunQueue, dryRunConcurrency, proveDryRun);
  }

  // ORDER BY FLATNESS x PROVEN DEMAND — a rank, never a filter. Every record
  // that reached this line is emitted. The kill switch restores the prior
  // demand-only order without changing any qualification gate.
  if (flatSiteFirstEnabled(env)) {
    records.splice(0, records.length, ...rankFlatSiteCandidates(records, env));
  } else {
    records.sort((a, b) => {
      const ra = demandRank(a.mirror_request.facts.review_count, a.mirror_request.facts.rating);
      const rb = demandRank(b.mirror_request.facts.review_count, b.mirror_request.facts.rating);
      if (rb.rank !== ra.rank) return rb.rank - ra.rank;
      return (rb.reviewCount || 0) - (ra.reviewCount || 0);
    });
  }
  for (const rec of records) {
    rec.demand = demandRank(rec.mirror_request.facts.review_count, rec.mirror_request.facts.rating);
  }

  return {
    ok: true,
    mode: "build_ready",
    funnel: Object.values(stages),
    cost,
    records,
    held_rows: heldRows,
    rejects,
    ...(operatorLine && dispatchPlans.length > 0 && exhaustedOperatorPlans === dispatchPlans.length
      ? {
          // PII-FREE TERMINAL SOURCE CONTRACT. The durable Line may persist
          // this reason and halt immediately; query text, market, business
          // identity, and provider payloads never cross this boundary.
          source_exhausted: {
            exhausted: true,
            reason: "operator_query_cycle_exhausted",
            refill_round: refillRound,
          },
        }
      : {}),
    // Google breaker health at both ends when discovery or verification ran; a
    // run that never entered either path reports skipped instead of stale state.
    provider_health: placesVerified
      ? { at_start: providerHealthAtStart, at_end: placesBreaker.status() }
      : { mode: "skipped_zero_google" },
    buildable_verticals: buildableVerticals(donorRoot).map((v) => v.industry),
  };
}

/** The legacy top-level row shape, carrying the build-ready contract in `record`. */
function rowFromBuildReady(rec, query) {
  const f = rec.mirror_request.facts;
  const sourceId = sourceProspectId(rec);
  // THE TOP-LEVEL SERVICE LIST, which this lane has never written.
  //
  // The contract now carries services (see the content block in mineBuildReady),
  // but a dozen surfaces — the console drawer, the Signal report, Riley's brief,
  // siteforge.js, packets.js — read `record.services`, the shape the LEGACY lane
  // has always written. Leaving it absent here is what made the store read
  // "737 rows have services, 0 of 212 build-ready rows do" while the contract
  // underneath held a real list. One source, copied to the name every reader
  // already asks for; never a second harvest that could disagree with it.
  const contractServices = ((rec.mirror_request.content || {}).services || [])
    .map((s) => (typeof s === "string" ? s : (s && s.name) || ""))
    .filter(Boolean);
  return {
    prospect_id: sourceId,
    status: "new",
    business_name: f.business_name,
    email: f.email || null,
    owner_email: null,
    phone: f.phone || null,
    current_website: f.current_website || rec.discovery.url,
    industry: f.industry,
    city: f.city,
    state: f.state,
    leadminer_score: 0,
    source: "build-ready-mine",
    record: {
      prospect_id: sourceId,
      place_id: f.place_id || null,
      business_name: f.business_name,
      email: f.email || null,
      phone: f.phone || null,
      current_website: f.current_website || rec.discovery.url,
      address: f.address || null,
      latitude: f.latitude ?? null,
      longitude: f.longitude ?? null,
      rating: f.rating ?? null,
      review_count: f.review_count ?? null,
      postal: f.postal_code || null,
      city: f.city,
      // MARKET city lives in its own column, written by its own resolver.
      service_area: f.service_area || null,
      state: f.state,
      industry: f.industry,
      text_query: (query && query.textQuery) || rec.discovery.query,
      website_probe: rec.qualification.probe,
      website_flatness: rec.website_flatness || null,
      flat_site: Boolean(rec.flat_site),
      // THIN-TARGET PROVENANCE (issue #689), surfaced beside website_probe so
      // the email mapper and every bank audit read it without digging into
      // build_ready.qualification. Same object the funnel measured at stage 2.
      integration_gap: (rec.qualification && rec.qualification.integration_gap) || null,
      source: "build-ready-mine",
      // THE DONOR FINGERPRINT, keyed to this row's prospect_id (first-party
      // storage: the record blob IS the prospect's own measured DNA).
      ...(rec.donor_fingerprint ? {
        donor_fingerprint: {
          ...rec.donor_fingerprint,
          prospect_id: sourceId,
        },
      } : {}),
      ...(contractServices.length ? { services: contractServices, primary_services: contractServices.slice(0, 6) } : {}),
      // The whole contract, versioned, inside the JSON blob. No migration.
      build_ready: { version: 1, ...rec },
    },
    updated_at: new Date().toISOString(),
  };
}

/**
 * Persist a batch of already-qualified rows through the SAME canonical-identity
 * machinery the legacy lane uses (split-brain hold, safe merge, write-conflict
 * classification). Nothing about identity resolution changes for the new lane:
 * identity is normalised name + CITY, and a conflict is held for review rather
 * than guessed at.
 */
async function persistMinedRows({
  rows,
  persist,
  actor,
  trigger,
  selectCount,
  selectRowsImpl = selectRows,
  selectImpl = select,
  upsertRowImpl = upsertRow,
  insertRowImpl = insertRow,
  conditionalUpdateImpl = conditionalUpdate,
  identityReadAttempts = IDENTITY_INDEX_READ_ATTEMPTS,
  identityReadRetryDelayMs = IDENTITY_INDEX_RETRY_DELAY_MS,
  identityReadSleepImpl = waitForIdentityIndexRetry,
}) {
  // Quarantine is a truth/identity decision, never an opportunity grade. Keep
  // held rows (sport mismatches AND unverified first-party identities) outside
  // every website/demand ranking switch so the legacy flat-site kill switch
  // cannot filter away a required hold.
  const verticalHolds = rows.filter(minedQuarantineHold);
  const rankableRows = rows.filter((row) => !minedQuarantineHold(row));
  const scored = await applyOpportunityScoring(rankableRows, selectCount || rankableRows.length);
  const rowsToPersist = [...scored.rows, ...verticalHolds];
  let existingResult = { mode: "not_requested", rows: [] };
  if (persist) {
    const attempts = numberInRange(identityReadAttempts, IDENTITY_INDEX_READ_ATTEMPTS, 1, IDENTITY_INDEX_READ_ATTEMPTS);
    const retryDelayMs = numberInRange(identityReadRetryDelayMs, IDENTITY_INDEX_RETRY_DELAY_MS, 0, 250);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      existingResult = await selectRowsImpl("ghost_agency_prospects", prospectIdentityIndexRead());
      if (existingResult && existingResult.mode !== "live_select_failed") break;
      if (attempt < attempts) await identityReadSleepImpl(retryDelayMs);
    }
  }
  if (persist && (!existingResult || existingResult.mode !== "live_select")) {
    await recordEvent("mine.run", {
      actor, status: "blocked", telemetry: "dependency-wait", trigger,
      blocked: "prospect_identity_index_unavailable", result: "nothing_persisted",
      identity_index_mode: existingResult?.mode ?? "no_result",
      identity_index_status: existingResult?.status ?? null,
      identity_index_error_code: existingResult?.error?.code ?? null,
      identity_index_error_category: existingResult?.error?.category ?? null,
    }).catch(() => null);
    return {
      blocked: {
        ok: false,
        mode: "prospect_identity_index_unavailable",
        message: "The existing prospect index could not be checked safely, so no leads were written.",
        created: 0, updated: 0, duplicateSkipped: 0, rejected: 0,
      },
    };
  }
  const persistenceAvailable = existingResult.mode === "live_select";
  const existing = existingProspectRows(existingResult);
  let created = 0;
  let updated = 0;
  let duplicateSkipped = 0;
  let heldForReview = 0;
  let writeFailed = 0;
  const out = [];
  const applyExistingSportHold = async (matched, row) => {
    if (!canApplySportVerticalHold(matched)) {
      duplicateSkipped++;
      return "terminal_sport_mismatch_observed";
    }
    const heldRecord = {
      ...(matched.record || {}),
      status: "held",
      blocked_reason: "vertical_mismatch_sport_fencing",
      vertical_hold: row.record.vertical_hold,
      last_mine_observation: row.record,
    };
    const updatedAt = new Date().toISOString();
    const guards = {
      ...(String(matched.updated_at || "").trim() ? { updated_at: `eq.${String(matched.updated_at).trim()}` } : {}),
      ...(String(matched.status || "").trim() ? { status: `eq.${String(matched.status).trim()}` } : {}),
    };
    let result;
    try {
      result = await conditionalUpdateImpl(
        "ghost_agency_prospects",
        "prospect_id",
        matched.prospect_id,
        guards,
        { status: "held", record: heldRecord, updated_at: updatedAt },
      );
    } catch {
      result = null;
    }
    if (!result || result.ok !== true || result.updated !== true) {
      writeFailed++;
      return "vertical_hold_write_conflict";
    }
    updated++;
    Object.assign(matched, { status: "held", record: heldRecord, updated_at: updatedAt });
    return "updated_vertical_mismatch_hold";
  };
  for (const row of rowsToPersist) {
    const resolution = resolveCanonicalMatch(existing, row);
    let matched = resolution.match;
    let hydrationFailure = "";
    if (persist && matched && !resolution.conflict) {
      const hydration = await hydrateIdentityMatch(matched, selectImpl);
      if (!hydration.ok) hydrationFailure = "prospect_identity_hydration_failed";
      else if (hydration.hydrated && !(await hydratedIdentityResolutionIsCurrent(resolution, hydration.row, row, selectImpl))) {
        hydrationFailure = "prospect_identity_hydration_mismatch";
      } else matched = hydration.row;
    }
    let persistence = "not_persisted";
    let canonicalProspectId = row.prospect_id;
    if (persist) {
      if (resolution.conflict) {
        heldForReview++;
        persistence = "identity_split_brain_review_hold";
        await recordEvent("prospect.identity_review_required", {
          actor, telemetry: "dependency-wait",
          incomingProspectId: row.prospect_id,
          canonicalIds: resolution.canonicalIds || [],
          safeNextAction: "Resolve the conflicting canonical identities. No fields were changed.",
        }).catch(() => null);
      } else if (hydrationFailure) {
        writeFailed++;
        persistence = hydrationFailure;
      } else if (matched) {
        canonicalProspectId = matched.prospect_id;
        if (sportVerticalHold(row)) {
          persistence = await applyExistingSportHold(matched, row);
        } else if (identityUnverifiedHold(row)) {
          // The store already knows this business under a canonical identity —
          // possibly a fully verified row. An unverified incoming observation
          // has no authority to touch it, in either direction.
          duplicateSkipped++;
          persistence = "identity_hold_existing_row_untouched";
        } else {
          const merged = mergeIncomingSafely(matched, row);
          if (merged.plan.requiresReview) {
            heldForReview++;
            persistence = "duplicate_conflict_review_hold";
            await recordEvent("prospect.identity_review_required", {
              actor, telemetry: "dependency-wait",
              prospectId: canonicalProspectId,
              incomingProspectId: row.prospect_id,
              matchingKeys: merged.plan.match.matches,
              conflicts: merged.plan.conflicts.map((conflict) => conflict.field),
              safeNextAction: "Review the conflicting identity evidence. No fields were changed.",
            }).catch(() => null);
          } else if (!merged.changed) {
            duplicateSkipped++;
            persistence = "duplicate_skipped";
          } else {
            const result = await upsertRowImpl("ghost_agency_prospects", stripResponseOnlyFields(merged.row), "prospect_id");
            if (result.mode !== "live_upsert") {
              if (result.error?.category === "write_conflict") { duplicateSkipped++; persistence = "concurrent_duplicate_skipped"; }
              else writeFailed++;
            } else {
              updated++;
              persistence = "updated";
              Object.assign(matched, merged.row);
            }
          }
        }
      } else {
        row.record.identity = canonicalIdentity({ ...row, ...(row.record || {}) });
        if (minedQuarantineHold(row)) {
          // A broad 5,000-row snapshot is not authority to merge-overwrite a
          // quarantine. Exact-read this deterministic id first. If absent,
          // INSERT (never merge-upsert) so a concurrent terminal row wins the
          // unique-key race and remains untouched. Labels name the hold kind.
          const holdLabel = sportVerticalHold(row) ? "vertical_hold" : "identity_hold";
          let exact;
          try {
            exact = await selectImpl(
              "ghost_agency_prospects",
              `?select=*&prospect_id=eq.${encodeURIComponent(row.prospect_id)}&limit=1`,
            );
          } catch {
            exact = null;
          }
          const exactRows = exact && Array.isArray(exact.data)
            ? exact.data
            : (exact && Array.isArray(exact.rows) ? exact.rows : []);
          const exactOk = Boolean(exact && (exact.ok === true || exact.mode === "live_select"));
          if (!exactOk) {
            writeFailed++;
            persistence = `${holdLabel}_identity_recheck_failed`;
          } else if (exactRows[0]) {
            canonicalProspectId = exactRows[0].prospect_id || row.prospect_id;
            if (sportVerticalHold(row)) {
              persistence = await applyExistingSportHold(exactRows[0], row);
            } else {
              duplicateSkipped++;
              persistence = "identity_hold_existing_row_untouched";
            }
          } else {
            let result;
            try {
              result = await insertRowImpl("ghost_agency_prospects", stripResponseOnlyFields(row));
            } catch {
              result = null;
            }
            if (!result || result.mode !== "live_write") {
              writeFailed++;
              persistence = result && result.error?.category === "write_conflict"
                ? `${holdLabel}_insert_conflict`
                : `${holdLabel}_write_failed`;
            } else {
              created++;
              persistence = "created";
              existing.push(row);
            }
          }
        } else {
          const result = await upsertRowImpl("ghost_agency_prospects", stripResponseOnlyFields(row), "prospect_id");
          if (result.mode !== "live_upsert") {
            if (result.error?.category === "write_conflict") { duplicateSkipped++; persistence = "concurrent_duplicate_skipped"; }
            else writeFailed++;
          } else {
            created++;
            persistence = "created";
            existing.push(row);
          }
        }
      }
    }
    const br = (row.record && row.record.build_ready) || null;
    out.push({
      prospect_id: canonicalProspectId,
      name: row.business_name,
      email: row.email,
      score: row.leadminer_score,
      opportunity: row._opportunity,
      rank: row._opportunityRank,
      selected: row._opportunitySelected,
      lane: row.record && row.record.contact_lane,
      place_id: (row.record && row.record.place_id) || null,
      query: (row.record && row.record.text_query) || "",
      persistence,
      ...(br ? { slug: br.slug, donor: br.donor, build_hash: br.proof && br.proof.build_hash, brand_check: br.proof && br.proof.brand_check } : {}),
    });
  }
  return { created, updated, duplicateSkipped, heldForReview, writeFailed, persistenceAvailable, rows: out, scored };
}

/**
 * COST DIRECTIVE 2026-08-25: the scheduled mining cron is DISABLED by default
 * (it dialed paid discovery every four hours unattended). One explicit env
 * flag re-enables it — still at zero Places. Manual mining is unaffected.
 */
function scheduledMiningEnabled(env = process.env) {
  return String(env.GHOST_AGENCY_SCHEDULED_MINING || "").trim().toLowerCase() === "true";
}

async function mineLeads(input = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY && process.env.GOOGLE_PLACES_API_KEY.trim();
  const actor = input.actor || "agent_01_prospect_miner";
  const trigger = input.trigger || "manual_console";
  const operationKey = /^[A-Za-z0-9_-]{16,160}$/.test(String(input.operationKey || ""))
    ? String(input.operationKey)
    : "";
  await recordEvent("agent.lifecycle", telemetryPayload(actor, "received", {
    trigger,
    originalCommand: String(input.originalCommand || input.command || "").slice(0, 500),
  })).catch(() => null);
  if (trigger === "scheduled_cron" && !scheduledMiningEnabled(input.env || process.env)) {
    // Refused before buildQueries: a disabled cron makes zero mining, provider
    // and Census calls. The TWO audit events (agent.lifecycle above, mine.run
    // below) are the only writes that remain.
    await recordEvent("mine.run", {
      actor,
      status: "refused",
      telemetry: "disabled",
      trigger,
      ...(operationKey ? { operationKey } : {}),
      blocked: "scheduled_mining_disabled",
      result: "nothing_run",
    }).catch(() => null);
    return {
      ok: false,
      mode: "scheduled_mining_disabled",
      message: "Scheduled mining is disabled (cost control, 2026-08-25). Set GHOST_AGENCY_SCHEDULED_MINING=true to re-enable the cron lane; manual console mining is unaffected.",
      queries: [],
    };
  }
  let queries;
  try {
    // Validate the requested trade/metro before the optional Census lookup.
    // A refused plan must not create external work of any kind.
    for (const query of buildQueries(input)) {
      if (!approvedIndustry(query.industry)) {
        const error = new Error(`Mining category is not approved: ${query.industry || "missing"}.`);
        error.code = "mine_category_not_approved";
        throw error;
      }
    }
    const planningInput = await withMiningNearbyCities(input);
    queries = buildQueries(planningInput).map((query) => {
      const industry = approvedIndustry(query.industry);
      if (!industry) {
        const error = new Error(`Mining category is not approved: ${query.industry || "missing"}.`);
        error.code = "mine_category_not_approved";
        throw error;
      }
      const originalTrade = String(query.industry || "");
      const textQuery = query.rawQuery
        ? query.textQuery
        : `${industry}${String(query.textQuery || "").slice(originalTrade.length)}`;
      return { ...query, industry, textQuery };
    });
  } catch (error) {
    await recordEvent("mine.run", {
      actor,
      status: "refused",
      telemetry: "failed",
      trigger,
      blocked: error.code || "mine_plan_incomplete",
      originalCommand: String(input.originalCommand || input.command || "").slice(0, 500),
      parsedIntent: { industry: input.industry || null, location: input.location || input.metro || null },
      finalQueries: [],
      result: "nothing_run",
    });
    return { ok: false, mode: error.code || "mine_plan_incomplete", message: error.message, queries: [] };
  }
  const limit = numberInRange(input.limit || process.env.GHOST_AGENCY_DAILY_MINING_LIMIT, 10, 1, MAX_LIMIT);
  const persist = input.persist !== false;
  const providerQueries = dispatchQueryPlans(queries, input.queryShapeCursor, input.queryGroupOffset);
  const perQueryLimit = Math.max(1, Math.ceil(limit / Math.max(providerQueries.length, 1)));
  const started = Date.now();

  // PROVIDER SPLIT: operator_line and other fresh build-ready triggers discover
  // websites through Firecrawl. `placesVerify: true` may opt one exact manual
  // candidate into a single capped Places attempt (see mineBuildReady). The
  // legacy raw Places lane below remains separate and explicitly gated.

  // =========================================================================
  // THE BUILD-READY LANE IS THE DEFAULT.
  //
  // Owner directive 2026-07-31: the miner must produce EXACTLY the prospect we
  // want, rather than mining raw results and discovering at build time that a
  // lead was never buildable. Everything the engine will check is checked here,
  // and a candidate that fails any gate is never written.
  //
  // `buildReadyGate:false` is the ONE opt-out and exists for the legacy raw
  // Places lane below. It is deliberately explicit and greppable: no production
  // caller passes it, and a row mined that way carries `source:
  // "places-live-mine"` rather than "build-ready-mine", so the two kinds of row
  // can never be confused in the table.
  // =========================================================================
  if (input.buildReadyGate !== false) {
    const runBuildReady = input.mineBuildReady || mineBuildReady;
    const funnel = await runBuildReady({
      queries,
      candidatesPerQuery: input.candidatesPerQuery ?? Math.max(10, Math.min(100, limit * 4)),
      donorRoot: input.donorRoot,
      fetchImpl: input.fetchImpl,
      resolveMx: input.resolveMx,
      mirrorImpl: input.mirrorImpl,
      firecrawlEndpoint: input.firecrawlEndpoint,
      queryShapeCursor: input.queryShapeCursor,
      queryGroupOffset: input.queryGroupOffset,
      refillRound: input.refillRound,
      sourceMode: input.sourceMode,
      trigger,
      // The admission boundary is explicit end to end. A missing lane must not
      // acquire owner-only Practice relief merely because the trigger came from
      // the operator Line.
      lane: input.lane,
      mode: input.mode,
      bulk: input.bulk,
      placesVerify: input.placesVerify,
      env: input.env,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      ...(operationKey ? { operationKey } : {}),
    });
    if (!funnel.ok) {
      await recordEvent("mine.run", {
        actor, status: "refused", telemetry: "failed", trigger,
        blocked: funnel.mode, finalQueries: queries.map((q) => q.textQuery),
        funnel: funnel.funnel, rejects: summarizeRejects(funnel.rejects), result: "nothing_run",
      }).catch(() => null);
      return { ok: false, mode: funnel.mode, message: funnel.message, queries, funnel: funnel.funnel, cost: funnel.cost, rejects: funnel.rejects, buildableVerticals: funnel.buildable_verticals };
    }
    const buildReadyRows = funnel.records.map((rec) => rowFromBuildReady(rec, queries.find((q) => q.textQuery === rec.discovery.query) || queries[0]));
    const verticalHoldRows = Array.isArray(funnel.held_rows) ? funnel.held_rows : [];
    const persistRows = input.persistMinedRows || persistMinedRows;
    const operatorSourceExhausted = funnel.source_exhausted?.exhausted === true
      && funnel.source_exhausted.reason === "operator_query_cycle_exhausted"
      && buildReadyRows.length === 0
      && verticalHoldRows.length === 0;
    // A proven query-cycle stop owns no rows. Do not make its terminal signal
    // depend on an unrelated prospect-index read: a store outage here would
    // otherwise turn the zero-cost stop into another 11 queue/miner passes.
    const persisted = operatorSourceExhausted
      ? {
          created: 0,
          updated: 0,
          duplicateSkipped: 0,
          heldForReview: 0,
          writeFailed: 0,
          persistenceAvailable: false,
          rows: [],
        }
      : await persistRows({
        rows: [...buildReadyRows, ...verticalHoldRows], persist, actor, trigger,
        selectCount: input.selectCount || buildReadyRows.length,
      });
    if (persisted.blocked) return persisted.blocked;
    await recordEvent("mine.run", {
      actor, status: "ok", telemetry: "completed", trigger,
      lane: "build_ready",
      queryCount: queries.length,
      requestedLimit: limit,
      candidates: funnel.funnel[1].entered,
      emitted: funnel.records.length,
      held: verticalHoldRows.length,
      created: persisted.created,
      updated: persisted.updated,
      duplicateSkipped: persisted.duplicateSkipped,
      heldForReview: persisted.heldForReview,
      writeFailed: persisted.writeFailed,
      funnel: funnel.funnel,
      // Grouped, bounded, exact-count record of every elimination — the only
      // copy that outlives the response.
      rejects: summarizeRejects(funnel.rejects),
      cost: funnel.cost,
      durationMs: Date.now() - started,
      finalQueries: queries.map((q) => q.textQuery),
    }).catch(() => null);
    return {
      ok: true,
      mode: "build_ready",
      lane: "build_ready",
      queries,
      requestedLimit: limit,
      // Funnel arithmetic must reconcile at every stage:
      //   entered === survived + Σ rejected
      funnel: funnel.funnel,
      cost: funnel.cost,
      rejects: funnel.rejects,
      ...(funnel.source_exhausted ? { sourceExhausted: funnel.source_exhausted } : {}),
      providerHealth: funnel.provider_health,
      buildableVerticals: funnel.buildable_verticals,
      found: funnel.funnel[1].entered,
      emitted: funnel.records.length,
      held: verticalHoldRows.length,
      withEmail: funnel.records.length,   // an emailless record is never emitted
      created: persisted.created,
      updated: persisted.updated,
      upserted: persisted.created + persisted.updated,
      duplicateSkipped: persisted.duplicateSkipped,
      rejected: funnel.rejects.length,
      heldForReview: persisted.heldForReview,
      writeFailed: persisted.writeFailed,
      writeFailures: persisted.writeFailed,
      persisted: persist && persisted.persistenceAvailable && persisted.writeFailed === 0,
      rows: persisted.rows,
      records: input.includeRecords ? funnel.records : undefined,
      note: "Every row is build-ready: it carries either a provenance-safe logo or a frozen-ladder brand mark, plus a verified email, an in-service donor, and a dry-run build_hash proving mirror() accepts it as written.",
    };
  }

  // LEGACY RAW PLACES LANE ONLY from here down. Places is this lane's
  // discovery provider, so the key requirement is real — and scoped to the
  // lane instead of blocking the Firecrawl-first default above.
  if (!key) {
    const textQuery = queries.map((query) => query.textQuery).join(" | ");
    await recordEvent("mine.run", {
      actor,
      status: "blocked",
      telemetry: "dependency-wait",
      trigger,
      blocked: "no_places_key",
      textQuery,
      queryCount: queries.length,
      requestedLimit: limit,
    });
    return {
      ok: false,
      mode: "no_key",
      message: "GOOGLE_PLACES_API_KEY is not set on the backend. The legacy raw Places lane (buildReadyGate:false) cannot run without it; the default build-ready lane mines without a Places key.",
      textQuery,
      queries,
      requestedLimit: limit,
    };
  }

  const seen = new Set();
  const places = [];
  let duplicatesSkipped = 0;
  const queryResults = [];
  const miningEnv = input.env || process.env;
  for (const query of providerQueries) {
    if (places.length >= limit) break;
    const result = await searchPlaces({
      key,
      textQuery: query.textQuery,
      limit: perQueryLimit,
      startPage: discoveryStartPage(miningEnv),
      pages: query.pages,
      fetchImpl: input.fetchImpl,
    });
    queryResults.push({
      textQuery: query.textQuery,
      ok: result.ok,
      mode: result.mode,
      status: result.status,
      found: (result.places || []).length,
      httpCalls: result.httpCalls || 0,
      pagesWalked: result.pagesWalked || [],
      plannedPages: result.plannedPages || null,
    });
    if (!result.ok) {
      await recordEvent("mine.run", {
        actor,
        status: "blocked",
        telemetry: "failed",
        trigger,
        blocked: result.mode,
        textQuery: query.textQuery,
        statusCode: result.status,
      });
      return {
        ok: false,
        mode: result.mode,
        message:
          result.mode === "quota_exceeded"
            ? "Google Places daily quota exceeded. Raise the SearchText quota in Google Cloud Console."
            : "Google Places returned an error.",
        status: result.status,
        detail: result.detail,
        queryResults,
      };
    }
    for (const place of result.places) {
      const id = place.id || `${placeName(place)}|${place.formattedAddress || ""}`.toLowerCase();
      if (!id || seen.has(id)) {
        duplicatesSkipped++;
        continue;
      }
      seen.add(id);
      places.push({ place, query });
      if (places.length >= limit) break;
    }
  }

  const requestedEnrichLimit = numberInRange(
    input.enrichLimit ?? process.env.GHOST_AGENCY_MINER_ENRICH_LIMIT,
    Math.min(places.length, 60),
    0,
    MAX_LIMIT,
  );
  const enrichLimit = Math.min(requestedEnrichLimit, places.length);
  await recordEvent("agent.lifecycle", telemetryPayload("agent_02_enrichment", "started", {
    trigger,
    total: enrichLimit,
    nextDependency: enrichLimit ? "public_source_fetch" : "none",
  })).catch(() => null);
  const enriched = await enrichPlaces(
    places.slice(0, enrichLimit).map((item) => item.place),
    numberInRange(process.env.GHOST_AGENCY_MINER_FETCH_TIMEOUT_MS, 3500, 1000, 10000),
  );
  const enrichmentByIndex = new Map(
    enriched.map((item, index) => [
      index,
      {
        ...item,
        enrichmentStatus: item.enrichmentStatus || (item.email ? "email_found" : "no_public_email_found"),
      },
    ]),
  );
  await recordEvent("agent.lifecycle", telemetryPayload("agent_02_enrichment", "completed", {
    trigger,
    total: enrichLimit,
    emailFound: enriched.filter((item) => item.email).length,
    unreachable: enriched.filter((item) => !item.email).length,
  })).catch(() => null);

  let withEmail = 0;
  let rejected = 0;
  const pendingRows = [];
  for (let i = 0; i < places.length; i++) {
    const item =
      enrichmentByIndex.get(i) || {
        place: places[i].place,
        email: null,
        enrichmentStatus: "queued_not_enriched",
      };
    const query = places[i].query;
    const name = placeName(item.place);
    if (!name) {
      rejected++;
      continue;
    }
    if (item.email) withEmail++;
    pendingRows.push(await rowFromPlace({ ...item, query }));
  }

  const scored = await applyOpportunityScoring(pendingRows, input.selectCount || pendingRows.length);
  const existingResult = persist
    ? await selectRows("ghost_agency_prospects", prospectIdentityIndexRead())
    : { mode: "not_requested", rows: [] };
  if (persist && existingResult.mode === "live_select_failed") {
    await recordEvent("mine.run", {
      actor,
      status: "blocked",
      telemetry: "dependency-wait",
      trigger,
      blocked: "prospect_identity_index_unavailable",
      result: "nothing_persisted",
      identity_index_mode: existingResult.mode,
      identity_index_status: existingResult?.status ?? null,
      identity_index_error_code: existingResult?.error?.code ?? null,
      identity_index_error_category: existingResult?.error?.category ?? null,
    }).catch(() => null);
    return {
      ok: false,
      mode: "prospect_identity_index_unavailable",
      message: "The existing prospect index could not be checked safely, so no leads were written.",
      found: places.length,
      created: 0,
      updated: 0,
      duplicateSkipped: duplicatesSkipped,
      rejected,
    };
  }
  const persistenceAvailable = existingResult.mode === "live_select";
  const existing = existingProspectRows(existingResult);
  let created = 0;
  let updated = 0;
  let duplicateSkipped = duplicatesSkipped;
  let heldForReview = 0;
  let writeFailed = 0;
  const rows = [];
  for (const row of scored.rows) {
    const resolution = resolveCanonicalMatch(existing, row);
    let matched = resolution.match;
    let hydrationFailure = "";
    if (persist && matched && !resolution.conflict) {
      const hydration = await hydrateIdentityMatch(matched, select);
      if (!hydration.ok) hydrationFailure = "prospect_identity_hydration_failed";
      else if (hydration.hydrated && !(await hydratedIdentityResolutionIsCurrent(resolution, hydration.row, row, select))) {
        hydrationFailure = "prospect_identity_hydration_mismatch";
      } else matched = hydration.row;
    }
    let persistence = "not_persisted";
    let canonicalProspectId = row.prospect_id;
    if (persist) {
      if (resolution.conflict) {
        heldForReview++;
        persistence = "identity_split_brain_review_hold";
        await recordEvent("prospect.identity_review_required", {
          actor,
          telemetry: "dependency-wait",
          incomingProspectId: row.prospect_id,
          canonicalIds: resolution.canonicalIds || [],
          safeNextAction: "Resolve the conflicting canonical identities. No fields were changed.",
        }).catch(() => null);
      } else if (hydrationFailure) {
        writeFailed++;
        persistence = hydrationFailure;
      } else if (matched) {
        canonicalProspectId = matched.prospect_id;
        const merged = mergeIncomingSafely(matched, row);
        if (merged.plan.requiresReview) {
          heldForReview++;
          persistence = "duplicate_conflict_review_hold";
          await recordEvent("prospect.identity_review_required", {
            actor,
            telemetry: "dependency-wait",
            prospectId: canonicalProspectId,
            incomingProspectId: row.prospect_id,
            matchingKeys: merged.plan.match.matches,
            conflicts: merged.plan.conflicts.map((conflict) => conflict.field),
            safeNextAction: "Review the conflicting identity evidence. No fields were changed.",
          }).catch(() => null);
        } else if (!Object.keys(merged.plan.patch).length) {
          duplicateSkipped++;
          persistence = "duplicate_skipped";
        } else {
          const result = await upsertRow("ghost_agency_prospects", stripResponseOnlyFields(merged.row), "prospect_id");
          if (result.mode !== "live_upsert") {
            if (result.error?.category === "write_conflict") {
              duplicateSkipped++;
              persistence = "concurrent_duplicate_skipped";
            } else writeFailed++;
          } else {
            updated++;
            persistence = "updated";
            Object.assign(matched, merged.row);
          }
        }
      } else {
        const identity = canonicalIdentity({ ...row, ...(row.record || {}) });
        row.record.identity = identity;
        const result = await upsertRow("ghost_agency_prospects", stripResponseOnlyFields(row), "prospect_id");
        if (result.mode !== "live_upsert") {
          if (result.error?.category === "write_conflict") {
            duplicateSkipped++;
            persistence = "concurrent_duplicate_skipped";
          } else writeFailed++;
        } else {
          created++;
          persistence = "created";
          existing.push(row);
        }
      }
    }
    rows.push({
      prospect_id: canonicalProspectId,
      name: row.business_name,
      email: row.email,
      score: row.leadminer_score,
      opportunity: row._opportunity,
      rank: row._opportunityRank,
      selected: row._opportunitySelected,
      lane: row.record && row.record.contact_lane,
      enrichment_status: row.record.enrichment_status,
      place_id: row.record.place_id || null,
      query: row.record.text_query || row.record.truth_packet_source || "places_basic",
      persistence,
    });
  }

  const upserted = created + updated;

  if (persist || input.logEvent !== false) {
    await recordEvent("mine.run", {
      actor,
      status: "ok",
      telemetry: "completed",
      trigger,
      queryCount: queries.length,
      requestedLimit: limit,
      found: places.length,
      upserted,
      created,
      updated,
      duplicateSkipped,
      rejected,
      heldForReview,
      writeFailed,
      writeFailures: writeFailed,
      withEmail,
      enriched: enrichLimit,
      scoredCount: scored.scoredCount,
      eligibleCount: scored.eligibleCount,
      selectedCount: scored.selectedCount,
      persisted: persist,
      persistenceAvailable,
      durationMs: Date.now() - started,
      originalCommand: String(input.originalCommand || input.command || "").slice(0, 500),
      parsedIntent: { industry: input.industry || input.industries || input.verticals, location: input.location || input.locations || input.metros },
      finalQueries: queries.map((query) => query.textQuery),
      result: { found: places.length, created, updated, duplicateSkipped, rejected, heldForReview, writeFailed },
    });
  }

  return {
    ok: true,
    mode: "live",
    queries,
    queryResults,
    requestedLimit: limit,
    found: places.length,
    deduped: duplicatesSkipped,
    duplicateSkipped: duplicatesSkipped,
    upserted,
    created,
    updated,
    duplicateSkipped,
    rejected,
    heldForReview,
    writeFailed,
    writeFailures: writeFailed,
    withEmail,
    enriched: enrichLimit,
    scoredCount: scored.scoredCount,
    eligibleCount: scored.eligibleCount,
    selectedCount: scored.selectedCount,
    persisted: persist && persistenceAvailable && writeFailed === 0,
    rows,
    records: input.includeRecords ? scored.rows : undefined,
    note: "New leads saved at status 'new'. Advance the pipeline to build previews before campaigning.",
  };
}

module.exports = {
  // Provider health for the miner card + the 503 tests.
  discoveryStatus,
  searchPlacesPage,
  searchPlaces,
  discoveryStartPage,
  flatSiteFirstEnabled,
  lineDeepBatchDepth,
  LINE_DEEP_BATCH_DEPTH_ENV,
  LINE_DEEP_BATCH_DEPTH_CEILING,
  verifiedMiningCoordinates,
  withMiningNearbyCities,
  dispatchQueryPlans,
  demandRank,
  REVIEW_FLOOR,
  applyOpportunityScoring,
  buildQueries,
  flatnessPlatform,
  measuredHtmlSignals,
  websiteFlatness,
  integrationGapFromHomepage,
  INTEGRATION_GAP_WEIGHTS,
  TARGET_POLISH_SKIP_REASON,
  targetPolishScore,
  polishAdmissionVerdict,
  rankFlatSiteCandidates,
  comparableProspect,
  existingProspectsFor,
  extractEmail,
  isPlaceholderEmail,
  mineLeads,
  scheduledMiningEnabled,
  parseCsv,
  prospectIdForPlace,
  scorePlace,
  sameProspect,
  // --- the build-ready funnel -------------------------------------------
  mineBuildReady,
  summarizeRejects,
  buildableVerticals,
  resolveBuildableDonor,
  outreachDonors,
  firecrawlSearch,
  firecrawlSearchLimit,
  FIRECRAWL_SEARCH_PROVIDER_MAX,
  searchQueryWithNegatives,
  SEARCH_NEGATIVE_SITES,
  SERVICE_MODIFIERS,
  mapsSearchDiscovery,
  mapsSearchUrl,
  mapsDiscoveryEnabled,
  mapsMarketCenter,
  parseMapsPlaceLink,
  parseMapsHeadlineNames,
  resolveMapsCandidatePlace,
  MAPS_REGIONAL_ZOOM_METERS,
  MAPS_METRO_ZOOM_METERS,
  firecrawlRenderedJsonLd,
  firecrawlScrapeHtml,
  firecrawlBranding,
  firecrawlCrawl,
  brandingFallbackEnabled,
  firecrawlEmergencyStop,
  operatorLineFirecrawlFallbackLimit,
  directoryCrawlEnabled,
  directoryCrawlLimit,
  homepageScrapeFallbackEnabled,
  homepageScrapeFallbackLimit,
  isDirectoryUrl,
  fetchPageBytes,
  parsePage,
  jsonLdNodes,
  socialLinksFrom,
  allEmails,
  resolveOwnLogo,
  siteAccentFromHtml,
  parseSiteColor,
  qualifyEmail,
  verifyNapForCandidate,
  firstPartyIdentity,
  identityTrustEnabled,
  trustedNapFromRefusal,
  tradeSwapCheck,
  templateFitAdmission,
  // The metro fence: a lead must resolve inside the market it was mined for.
  metroFence,
  metroOfPlan,
  statesAdjacent,
  addressComponent,
  identityKeyFor,
  normalizeIdentityToken,
  mintSlug,
  sourceProspectId,
  rowFromBuildReady,
  persistMinedRows,
  // The one supported way to hand an emitted record to mirror(): no hand-editing.
  mirrorRequestFrom,
  // Static-site brand extraction (lib/brand-extractor) seams, exported for tests.
  brandIdentityForRequest,
  brandExtractionEnabled,
  // Whole-website palette (lib/mirror-engine/site-palette) seams, for tests.
  sitePaletteForRequest,
  // Donor-fingerprint (lib/mirror-engine/donor-fingerprint) seams, exported for tests.
  donorFingerprintEnabled,
  DIRECTORY_DOMAINS,
  CONSUMER_MAILBOX,
  TRADE_TYPES,
};
