"use strict";
// lib/web-brand.js — the prospect's REAL logo and brand colors, from THEIR OWN
// site, serverless-safe (no ffmpeg, no headless browser).
//
// WHY THIS EXISTS (2026-07-29): every mirror shipped with a generic text
// wordmark and the same dark-green theme, because:
//   1. hydrateBoilerplate hardcoded {{LOGO_URL}} to the generated wordmark and
//      nothing ever supplied a real logo to prefer;
//   2. media_submit AI-GENERATED a logo with a fixed "deep green and warm gold"
//      palette — inventing a brand identity instead of mirroring one;
//   3. lib/capture-brand.js (the real measurement code) needs a LandedWP capture
//      directory + ffmpeg, which the serverless forge-jobs lane never has.
// Separately, the email once rendered an APOC (roofing manufacturer) logo as a
// prospect's own mark because a logo URL from image-search evidence was trusted
// with no ownership check.
//
// THE RULES, fail-closed:
//   - A logo is the client's ONLY if it is served from the client's own
//     registrable domain (sameOwner). Any other host — CDN of an image search,
//     a manufacturer, a social network — is rejected outright.
//   - Filenames matching capture-brand's third-party denylist (facebook, gaf,
//     visa, ...) are rejected even on the client's own domain.
//   - Brand colors are MEASURED from the client's own published CSS/HTML.
//     When nothing can be measured, `accent` is null and the caller keeps the
//     donor theme — a wrong color is worse than a neutral one (TRUTH LAW).

const { isThirdPartyMark, namesThirdPartyMark, isBrandCandidate, hexToHsl, classifyHeaderMark } = require("./capture-brand");
const { isIP } = require("node:net");

const UA = "Mozilla/5.0 (compatible; WSSLabsBot/1.0; +https://wss-ai.com)";
const FETCH_TIMEOUT_MS = 15000;
const MAX_LOGO_BYTES = 3 * 1024 * 1024;

async function fetchWithTimeout(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { redirect: "follow", ...opts, signal: ctl.signal, headers: { "user-agent": UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Normalize one host for the fail-closed ownership comparison below.
 *
 * Do not try to derive an eTLD+1 by taking the last two labels. That collapses
 * every business under a multi-label public suffix (`victim.co.uk` and
 * `competitor.co.uk` both became `co.uk`) and turns a provenance check into a
 * cross-company logo door. `www` is the only alias we deliberately fold.
 */
function ownerHost(value) {
  try {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

const PUBLIC_SECOND_LEVEL_LABELS = new Set([
  "ac", "asso", "co", "com", "edu", "firm", "gen", "go", "gob", "gov",
  "id", "ind", "me", "mil", "ne", "net", "nom", "or", "org", "pe",
  "re", "sch", "school", "tur",
]);
const SHARED_SUFFIX_ROOTS = new Set([
  "blogspot.com", "github.io", "pages.dev", "vercel.app", "netlify.app",
  "workers.dev", "web.app", "firebaseapp.com",
]);

function isRegistrableHost(host) {
  if (!host) return false;
  if (isIP(host)) return true;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2 || SHARED_SUFFIX_ROOTS.has(host)) return false;
  const [second, top] = labels.slice(-2);
  if (labels.length === 2 && top.length === 2 && PUBLIC_SECOND_LEVEL_LABELS.has(second)) return false;
  return true;
}

// Historical export retained for callers/tests. It is intentionally strict
// now: without a complete PSL, returning a guessed eTLD+1 is less safe than
// returning the normalized observed host.
function registrableDomain(value) {
  return ownerHost(value);
}

/**
 * True only for the exact verified host or a child host of it. Parent and
 * sibling hosts are refused because proving that they share an owner requires
 * a public-suffix database or independent evidence; guessing is not acceptable
 * at the logo boundary.
 */
function sameOwner(siteUrl, candidateUrl) {
  const site = ownerHost(siteUrl);
  const candidate = ownerHost(candidateUrl);
  if (!isRegistrableHost(site) || !candidate) return false;
  if (isIP(site)) return site === candidate;
  return site === candidate || candidate.endsWith(`.${site}`);
}

// --- builder-CDN ownership, OFF BY DEFAULT ----------------------------------
//
// MEASURED, 2026-08-01: a 300-candidate mine across concrete and fencing
// produced 32 weak sites and zero qualified leads. Every one died at the logo
// gate. The gate was right and the marks were real — they were just not on the
// client's domain. hessefenceanddeck.com serves
// `hesse-fence-and-deck-logo.png` from le-cdn.hibuwebsites.com;
// bettersolutionsconstruction.org serves from cdn-website.com (Duda). This is
// the anti-correlation at the heart of the funnel: a site weak enough to need
// us is usually on a builder, and builders host the logo on their own CDN.
//
// The safe widening is NOT "trust the CDN". It is: accept a foreign host only
// when the FILENAME itself carries the business's own name. A file called
// hesse-fence-and-deck-logo.png is evidence about Hesse Fence & Deck no matter
// who serves the bytes; a generic logo.png on a shared CDN is evidence about
// nobody, and is exactly how another company's mark reached a client's page.
//
// This stays DISABLED unless BUILDER_CDN_LOGOS=1 AND a business name is passed.
// Absent either, behaviour is byte-identical to sameOwner alone.
const BUILDER_CDN_RE = /(^|\.)(hibuwebsites\.com|hibu\.com|cdn-website\.com|mktgcdn\.com|squarespace-cdn\.com|wixstatic\.com|godaddy(?:sites)?\.com|weebly\.com|shopifycdn\.com|b-cdn\.net)$/i;

// Words that describe the TRADE, not the business. Every fencing company's
// filename contains "fence"; matching on those alone identifies an industry and
// adopts a competitor's mark.
const TRADE_WORD_RE = /^(fence|fencing|deck|decking|concrete|paving|masonry|roof|roofing|plumb|plumbing|hvac|heating|cooling|air|electric|electrical|landscape|landscaping|lawn|tree|construction|contractor|builders?|remodel|remodeling|home|pro|pros|expert|experts|solutions?|systems?)$/i;

/** "Hesse Fence & Deck" -> ["hesse","fence","deck"] — junk and stopwords dropped. */
function nameTokens(businessName) {
  return String(businessName || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(llc|inc|co|corp|company|the|and|of|services?|group)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

// --- caching-proxy rewrites of the client's OWN origin file -----------------
//
// MEASURED, 2026-08-08, on six real Phoenix plumbers. Every one of the empty
// candidate lists came back `not_own_mark_host` — not the "ambiguous, refused
// on purpose" path. AZ Family Plumbing's header mark is served at:
//
//   https://cdn-ilcdbif.nitrocdn.com/<key>/assets/images/optimized/rev-0839a14/
//     www.azfamilyplumbing.com/wp-content/uploads/header-logo.svg
//
// That is a NitroPack rewrite of THEIR OWN origin file: the client's
// registrable domain is right there, as a path segment, because the proxy keys
// its cache by origin. ownsLogo read hostname and filename only, never the
// path, so it called the client's own artwork a stranger's and the lead died at
// the brand stage having already paid for Firecrawl and a homepage fetch.
//
// The ownership claim here is stronger than the builder-CDN filename rule, not
// weaker: the asset's own path names the origin it was copied from. So it is
// checked BEFORE the flag — a proxied copy of their own file IS same-domain,
// which is exactly what BUILDER_CDN_LOGOS=0 means to keep.
//
// BOUNDED: the domain must appear as a WHOLE PATH SEGMENT (optionally with a
// www. prefix). "notazfamilyplumbing.com" and "azfamilyplumbing.com.evil.test"
// do not match. And nothing else about the pick changes — the third-party
// denylist, the header-grade byte classifier and the declaration ranker all
// still run. Verified against the same CDN path: Navien-new-logo-2021-1.png and
// delta-faucets-logo-png-transparent-1.png are still rejected by name.
const ORIGIN_PROXY_HOST_RE = /(?:^|\.)nitrocdn\.com$/i;

function proxiedOwnOrigin(siteUrl, candidateUrl) {
  let own, candidate, segments;
  try {
    own = ownerHost(siteUrl);
    candidate = new URL(candidateUrl);
    if (!ORIGIN_PROXY_HOST_RE.test(candidate.hostname)) return false;
    segments = candidate.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s).toLowerCase());
  } catch { return false; }
  if (!isRegistrableHost(own)) return false;
  const origin = segments.findIndex((segment) => segment === own || segment === `www.${own}`);
  const direct = origin === 3
    && segments[1] === "assets"
    && segments[2] === "images";
  const optimized = origin === 5
    && segments[1] === "assets"
    && segments[2] === "images"
    && segments[3] === "optimized"
    && /^rev-[a-z0-9-]+$/i.test(segments[4] || "");
  return direct || optimized;
}

/**
 * ownsLogo(siteUrl, candidateUrl, businessName, env)
 * True when the candidate is on the client's own domain (always), when a
 * caching proxy is serving the client's own origin file (the path names their
 * domain), OR when the flag is on, the host is a known site-builder CDN, and
 * the filename carries at least two distinct tokens of the business's own name.
 */
function ownsLogo(siteUrl, candidateUrl, businessName = "", env = process.env) {
  if (sameOwner(siteUrl, candidateUrl)) return true;
  if (proxiedOwnOrigin(siteUrl, candidateUrl)) return true;
  // DEFAULT ON as of 2026-08-06, measured. The brand stage was killing 7 of
  // every 11 otherwise-qualified leads with no_own_domain_logo_candidate, and a
  // logo is MANDATORY — computeRevealable requires the brand check, and brand
  // only passes with a real logo and a measurable accent. So this flag was not
  // a nice-to-have; it was the difference between roughly one site per metro
  // and a sendable run. The anti-correlation above is the whole reason: the
  // sites weak enough to need us are on builders, and builders host the logo on
  // their own CDN.
  //
  // Turning it on does NOT trust the CDN. Every guard below still holds — a
  // known builder host, a business name supplied, two matching name tokens, and
  // at least one of them distinctive rather than a trade word. Set
  // BUILDER_CDN_LOGOS=0 to return to same-domain-only.
  if (/^(0|false|off|no)$/i.test(String(env.BUILDER_CDN_LOGOS || "").trim())) return false;
  let host, file;
  try {
    const u = new URL(candidateUrl);
    host = u.hostname;
    file = decodeURIComponent(u.pathname.split("/").pop() || "").toLowerCase();
  } catch { return false; }
  if (!BUILDER_CDN_RE.test(host)) return false;      // an arbitrary CDN is still a stranger
  const tokens = nameTokens(businessName);
  if (tokens.length < 2) return false;               // a one-word name cannot corroborate

  // THE DISTINCTIVE TOKEN IS THE WHOLE POINT. An earlier version required two
  // matching tokens and would have adopted "baker-fence-and-deck-logo.png" for
  // Hesse Fence & Deck — "fence" and "deck" both matched, and both are the
  // industry, not the business. Trade words identify the vertical; only the
  // distinctive part of the name identifies the company. So the filename must
  // carry at least one NON-TRADE token, and two tokens overall.
  const hits = tokens.filter((t) => file.includes(t));
  if (hits.length < 2) return false;
  const distinctive = tokens.filter((t) => !TRADE_WORD_RE.test(t));
  if (!distinctive.length) return false;             // nothing but trade words: cannot identify
  return distinctive.some((t) => file.includes(t));
}

// --- logo discovery ----------------------------------------------------------
//
// READ THE PAGE'S DECLARATION. DO NOT GUESS FROM THE FILENAME.
//
// WHY THIS WAS REWRITTEN (2026-08-06, measured on a 250-candidate plumbing
// mine): 3 of 17 build-ready leads shipped ANOTHER COMPANY'S MARK as the
// client's identity, and every one passed brand_check. The scorer awarded -100
// for the literal string "logo" appearing in the filename and nothing at all
// for class="custom-logo", so on smithandsonstx.com a Google review badge named
// logo-04-free-img.png (its own alt text: "Google Reviews logo") scored -100,
// the client's real mark scored 0, and the badge won. Google blue #3175f2 then
// became Smith & Sons' brand colour. murrayplumbing.com lost the same way to a
// partner-carousel slide (LightRay_Logo.svg, class="swiper-slide-image") while
// its real mark — Asset-1-3.svg, alt="primary murray logo", wrapped in a link
// to its own homepage — sat unread on the same page.
//
// A filename denylist cannot fix this: none of those filenames name anything.
// The page already SAYS which image is its own logo. This module now reads that
// statement — WordPress's class="custom-logo", a mark in the <header> inside the
// home link, alt text carrying the business's own name, schema.org
// Organization.logo — and treats a "logo"-shaped filename as the last resort it
// always was.
//
// OWNERSHIP OF THE HOST IS NOT OWNERSHIP OF THE MARK.

// (?<![-\w]) rather than \b: `\bsrc=` also matches inside `data-src=`, so
// attrOf(tag,"src") could silently return a lazy-loading placeholder's value
// (and attrOf(tag,"srcset") the data-srcset). The lookbehind makes each
// attribute name mean itself. Memoised because the walker asks for five
// attributes on every open tag in the document.
const ATTR_CACHE = new Map();
const ATTR_RE = (name) => {
  let re = ATTR_CACHE.get(name);
  if (!re) ATTR_CACHE.set(name, (re = new RegExp(`(?<![-\\w])${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")));
  return re;
};

function attrOf(tag, name) {
  const m = ATTR_RE(name).exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
}

// A CSS background-image url(...) — the way most site builders paint a logo.
// Group 1 is the raw inner value, quotes and all; the caller strips them.
const BG_URL_RE = /background(?:-image)?\s*:\s*url\(([^)]+)\)/gi;
const LOGO_HINT_RE = /logo|brand[-_]?mark|site[-_]?identity|wordmark/i;

// A "logo" token in a CLASS or an ID is markup the author wrote to describe
// what the element IS. A "logo" token in a filename is not, and neither is one
// in alt text — "Google Reviews logo", "Review Author Logo" and "Blog Logo" are
// all real alt strings from this mine that name somebody else's thing. So role
// hints are read from class/id (and the wrapping anchor's class) only.
const ROLE_HINT_RE = /logo|wordmark|brand[-_]?mark|site[-_]?identity|branding/i;

// Carousel / slider machinery. Partner strips, manufacturer badges and
// "brands we install" rows live here; a business's own mark never does.
const CAROUSEL_RE = /(swiper|slick|carousel|owl[-_]|glide|splide|flickity|marquee|logo[-_]?(strip|cloud|slider|row)|partner[-_]?slider|brand[-_]?(strip|slider))/i;

// Badge / award / review furniture. Ray's Plumbing serves review-author-logo.png
// inside .review-author; DrainBusters serves bbb-logo.webp inside a link to
// bbb.org. Both are third-party identity by context, whatever they are called.
const BADGE_RE = /(badge|award|review|accredit|partner|affiliat|certif|sponsor|association|testimonial|trust[-_]?seal)/i;

// Header / branding containers, by tag or by class. Astra writes .site-header,
// Elementor writes data-elementor-type="header", Duda writes .dmHeaderContainer,
// GeneratePress child themes write .nav-primary__logo-container.
const HEADER_CLASS_RE = /(header|masthead|topbar|top[-_]?bar|navbar|nav[-_]primary|site[-_]branding|branding)/i;
const FOOTER_CLASS_RE = /(footer|colophon)/i;

// Anchors that mean "this is the site's own home", i.e. the mark is the site's
// identity and not an outbound link to somebody else's brand.
function isHomeHref(href, baseUrl) {
  const raw = String(href || "").trim();
  if (!raw) return false;
  if (/^(\/|\.\/|#|index\.(html?|php)|home\/?)$/i.test(raw)) return true;
  try {
    const u = new URL(raw, baseUrl);
    const b = new URL(baseUrl);
    if (!sameOwner(b.href, u.href)) return false;
    return /^\/?(index\.(html?|php))?$/i.test(u.pathname);
  } catch { return false; }
}

/** <html>/<body> carry site-wide template classes, not element context. */
const isContainer = (a) => a.name !== "html" && a.name !== "body";

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const SKIP_CONTENT = new Set(["script", "style", "template"]);
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;

/**
 * Walk the document and yield every <img> together with its chain of open
 * ancestors. Regex, not a DOM — this runs in a serverless function with no
 * headless browser (see the module header) — but it is the ANCESTORS that carry
 * the declaration: <header> … <a href="/"> … <img class="custom-logo">.
 *
 * <script>/<style>/<template> bodies are skipped whole rather than parsed:
 * ss-plumbing.com embeds an escaped `<img src=\"https:\/\/…\">` inside a JSON
 * blob in a <script>, and the old extractor ranked that mangled string FIRST,
 * ahead of the real mark. Comments are skipped for the same reason — commented
 * -out markup is not on the page.
 */
function* imagesWithContext(html) {
  const src = String(html || "");
  // Lowercased ONCE. Finding the end of each <script> with
  // src.toLowerCase().indexOf(...) re-cased the whole document per script tag —
  // 183ms of a 185ms run on trinityplumbingla.com's 1.4MB page.
  const lower = src.toLowerCase();
  const stack = [];
  TAG_RE.lastIndex = 0;
  // Comments are tracked with a FORWARD cursor. Asking "am I inside a comment?"
  // with lastIndexOf on every tag is quadratic, and these documents run to 1.5MB.
  let nextComment = src.indexOf("<!--");
  let m;
  while ((m = TAG_RE.exec(src))) {
    // Walk the cursor past every comment that closes before this tag; if the
    // tag turns out to be inside one, jump the scanner past it. The cursor only
    // ever moves forward, so this stays linear over the whole document.
    let inComment = false;
    while (nextComment !== -1 && nextComment < m.index) {
      const end = src.indexOf("-->", nextComment + 4);
      if (end === -1) { nextComment = -1; break; }   // unterminated: stop tracking
      if (m.index < end) { inComment = true; TAG_RE.lastIndex = end + 3; break; }
      nextComment = src.indexOf("<!--", end + 3);
    }
    if (inComment) continue;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const attrs = m[3] || "";
    if (name === "img") { yield { tag: m[0], ancestors: stack }; continue; }
    if (VOID_TAGS.has(name)) continue;
    if (!closing && SKIP_CONTENT.has(name) && !/\/\s*$/.test(attrs)) {
      const close = lower.indexOf(`</${name}`, TAG_RE.lastIndex);
      TAG_RE.lastIndex = close === -1 ? src.length : close;
      // A script body can contain "<!--" (old-school JS comment wrappers,
      // JSON strings); resync so a stale cursor cannot swallow real markup.
      if (nextComment !== -1 && nextComment < TAG_RE.lastIndex) nextComment = src.indexOf("<!--", TAG_RE.lastIndex);
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }
    if (/\/\s*$/.test(attrs)) continue;          // XHTML self-closing
    if (stack.length > 300) continue;            // runaway malformed document
    stack.push({
      name,
      class: attrOf(m[0], "class"),
      id: attrOf(m[0], "id"),
      href: attrOf(m[0], "href"),
      rel: attrOf(m[0], "rel"),
      elementor: attrOf(m[0], "data-elementor-type"),
    });
  }
}

// Non-production subdomains. buddytheplumber.com ships its nav mark twice — once
// from its own host and once from https://staging.buddytheplumber.com, which no
// longer resolves. sameOwner accepts both (a subdomain IS the same site), and
// the staging copy happened to carry the better alt text, so it ranked first and
// the fetch died. The live page is the identity; a staging host is a leftover.
const NONPROD_HOST_RE = /^(staging|stage|dev|devel|test|testing|preview|beta|sandbox|uat|demo|old|new|temp|wp)\d*\./i;

function offHostPenalty(baseUrl, candidateUrl) {
  let a, b;
  try { a = new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { return 0; }
  try { b = new URL(candidateUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { return 0; }
  if (a === b) return 0;
  if (NONPROD_HOST_RE.test(b)) return 1500;   // below anything the live host offers
  return 250;                                  // a CDN or subdomain: fine, just second choice
}

/** Distinctive (non-trade) tokens of the business name found in a text blob. */
function nameHitsIn(text, businessName) {
  const hay = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const tokens = nameTokens(businessName).filter((t) => !TRADE_WORD_RE.test(t));
  return tokens.filter((t) => hay.includes(t));
}

/** filename without extension, WordPress size suffix stripped. */
function baseStem(url) {
  let file = "";
  try { file = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch { file = String(url).split("/").pop() || ""; }
  return file.replace(/\.[a-z0-9]+$/i, "").replace(/-\d+x\d+$/i, "").toLowerCase();
}

/**
 * An http:// asset on the site's own https:// host, upgraded.
 *
 * MEASURED 2026-08-07: edwardsplumbingnc.com serves its real 1000x600 mark as
 * `http://edwardsplumbingnc.com/wp-content/uploads/2022/08/logo-Edwards-Plumbing.png`
 * — WordPress emitted the old scheme into the markup while the site itself is
 * https. The miner requires https (guardedFetch refuses anything else, and
 * rightly: a plaintext fetch is tamperable), so the real logo was skipped and
 * the build walked down to `cropped-favicon-180x180.png`. Edwards' header
 * shipped a white box with a faucet in it.
 *
 * The upgrade is only applied when the page we are reading is itself https and
 * the asset is on the SAME registrable domain — i.e. we already trust this
 * origin over TLS, and the scheme in the markup is stale metadata, not a
 * different server. Proven: the https URL returns the same 1000x600 mark and
 * measures accent #0062c7, Edwards' own blue. Anything cross-domain is left
 * exactly as written and still faces every ownership gate.
 */
function upgradeToHttps(candidateUrl, baseUrl) {
  try {
    const u = new URL(candidateUrl);
    if (u.protocol !== "http:") return candidateUrl;
    const b = new URL(baseUrl);
    if (b.protocol !== "https:") return candidateUrl;
    if (!sameOwner(b.href, u.href)) return candidateUrl;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return candidateUrl;
  }
}

// WordPress writes a downscaled derivative next to every upload:
// BulldogLogo_296x114-150x58.png beside BulldogLogo_296x114.png. Elementor does
// the same into /elementor/thumbs/. Both are the SAME artwork at a fraction of
// the resolution, and bulldogrooter.com shipped the 150x58 crop as its header
// mark because the two tie on tier and the crop happened to be seen first.
//
// A derivative is never a better source than the original it was cut from, so
// it is demoted BEHIND its own full-size sibling — a within-tier tie-break, not
// a claim about identity. The byte-level shape gate still has the final say.
const WP_SIZED_DERIVATIVE_RE = /-\d{2,4}x\d{2,4}(?=\.[a-z0-9]+(?:$|\?|#))/i;
const THUMB_PATH_RE = /\/(elementor\/thumbs|thumbs?|thumbnails?)\//i;

function isSizedDerivative(url) {
  const raw = String(url || "");
  return WP_SIZED_DERIVATIVE_RE.test(raw) || THUMB_PATH_RE.test(raw);
}

/** "logo-04-free-img" -> "logo-#-free-img": the shape a numbered strip shares. */
function digitStem(url) {
  return baseStem(url).replace(/\d+/g, "#");
}

// Confidence ladder. Lower wins. Everything from DECLARED_MAX up is a guess.
const TIER = {
  CUSTOM_LOGO: 0,      // class="custom-logo" — WordPress says so
  HEADER_HOME_NAME: 1, // in <header>, inside the home link, alt carries the business name
  HEADER_HOME: 2,      // in <header>, inside the home link
  ALT_NAME: 3,         // alt text carries the business's own distinctive name
  ROLE_CLASS: 4,       // class/id says "logo" — markup describing the element's role
  SCHEMA: 5,           // schema.org Organization.logo / publisher.logo / og:logo
  HEADER: 6,           // in <header>, no home link
  TOUCH_ICON: 7,       // rel="apple-touch-icon" — the site's own icon by spec
  OG_IMAGE: 8,         // og:image with a logo-shaped URL — weak
  FILENAME: 9,         // nothing but the word "logo" in the URL — LAST RESORT
};
const DECLARED_MAX = TIER.OG_IMAGE;   // tiers 0..8 are things the page states

const TIER_NAME = Object.fromEntries(Object.entries(TIER).map(([k, v]) => [v, k.toLowerCase()]));

/** JSON-LD `logo` / `publisher.logo` values, as raw strings. */
function schemaLogoUrls(html) {
  const out = [];
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) { for (const n of node) visit(n, depth + 1); return; }
    for (const [k, v] of Object.entries(node)) {
      if (/^logo$/i.test(k)) {
        if (typeof v === "string") out.push(v);
        else if (v && typeof v === "object") { if (typeof v.url === "string") out.push(v.url); if (typeof v.contentUrl === "string") out.push(v.contentUrl); }
      }
      if (v && typeof v === "object") visit(v, depth + 1);
    }
  };
  for (const m of String(html || "").matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* a malformed block is not a fact */ }
  }
  return out;
}

/**
 * rankLogoCandidates(html, baseUrl, businessName)
 *
 * Returns { candidates, rejected, declared }. `candidates` is best-first, each
 * carrying the SIGNAL THAT WON and its tier, so a wrong pick can be audited
 * from the funnel record instead of re-derived by hand.
 *
 * THE CHOICE THIS FILE MAKES, stated plainly: when the page declares a logo we
 * take the declaration and stop — every undeclared image is dropped, even one
 * whose filename shouts "logo", because that is exactly the guess that shipped
 * Google's badge as Smith & Sons' identity. When the page declares NOTHING, we
 * accept a filename-shaped guess ONLY if it is unambiguous: exactly one such
 * file on the whole page, on the client's own domain, with no badge, carousel,
 * third-party or numbered-strip signal against it. Two or more competing
 * undeclared files and we return nothing at all. Losing the lead costs one
 * mirror; publishing somebody else's trademark costs the customer.
 */
function rankLogoCandidates(html, baseUrl, businessName = "") {
  const source = String(html || "");
  const rejected = [];
  const byUrl = new Map();

  const reject = (url, why, detail, also) => {
    rejected.push({ url: String(url || "").slice(0, 300), why, ...(detail ? { detail } : {}), ...(also && also.length ? { also } : {}) });
  };

  // Absolute URL + the ownership gate that predates this rewrite (the APOC fix)
  // and is untouched by it: same registrable domain, or a known site-builder CDN
  // whose filename carries the business's own distinctive name.
  const resolve = (raw) => {
    const src = String(raw || "").trim();
    if (!src || /^data:/i.test(src)) return null;
    let abs;
    try { abs = new URL(src, baseUrl).toString(); } catch { return null; }
    abs = upgradeToHttps(abs, baseUrl);
    if (!ownsLogo(baseUrl, abs, businessName)) { reject(abs, "not_own_mark_host"); return null; }
    if (isThirdPartyMark(abs)) { reject(abs, "third_party_filename_or_host"); return null; }
    if (!/\.(png|svg|webp|jpe?g|gif)(\?|#|$)/i.test(abs) && !LOGO_HINT_RE.test(abs)) { reject(abs, "not_an_image_url"); return null; }
    return abs;
  };

  const add = (url, tier, signal, tweak = 0) => {
    if (!url) return;
    const score = tier * 1000 + tweak;
    const prev = byUrl.get(url);
    if (!prev || score < prev.score) byUrl.set(url, { url, tier, score, signal, order: byUrl.size });
    else if (prev.signal !== signal) prev.alsoSeen = [...new Set([...(prev.alsoSeen || []), signal])];
  };

  // --- what the page states about itself, before any image is judged ---------
  const schema = new Set();
  for (const raw of schemaLogoUrls(source)) { const abs = resolve(raw); if (abs) schema.add(abs); }
  let ogLogo = null;
  let ogImage = null;
  for (const tag of source.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attrOf(tag, "property") || attrOf(tag, "name") || attrOf(tag, "itemprop")).toLowerCase();
    if (key === "og:logo" || key === "logo") ogLogo = ogLogo || attrOf(tag, "content");
    else if (key === "og:image") ogImage = ogImage || attrOf(tag, "content");
  }

  // --- pass 1: gather every <img> with its evidence --------------------------
  const imgs = [];
  for (const { tag, ancestors } of imagesWithContext(source)) {
    const anchor = [...ancestors].reverse().find((a) => a.name === "a" && a.href);
    const own = `${attrOf(tag, "class")} ${attrOf(tag, "id")}`;
    const ancText = ancestors.slice(-14).map((a) => `${a.class} ${a.id}`).join(" ");
    const alt = `${attrOf(tag, "alt")} ${attrOf(tag, "title")}`.trim();
    const urls = [];
    for (const attr of ["src", "data-src", "data-lazy-src", "data-original"]) {
      const v = attrOf(tag, attr);
      if (v) urls.push(v);
    }
    // srcset: take the LARGEST listed variant (a logo shipped responsively has
    // no plain src on builder themes).
    for (const attr of ["srcset", "data-srcset"]) {
      const set = attrOf(tag, attr);
      if (!set) continue;
      const last = set.split(",").pop();
      if (last) urls.push(last.trim().split(/[ \t]+/)[0]);
    }
    imgs.push({
      tag, alt, own, ancText, anchor,
      urls: urls.map(resolve).filter(Boolean),
      customLogo: /(^|\s)custom-logo(\s|$)/i.test(attrOf(tag, "class")) || /custom-logo-link/i.test(anchor?.class || ""),
      // <html> and <body> are excluded from the CLASS tests on purpose:
      // WordPress stamps the page template onto the body, and murrayplumbing.com
      // ships `body class="… page-template-elementor_header_footer …"`, which
      // made every image on the page read as both in-header and in-footer.
      inHeader: ancestors.some((a) => a.name === "header" || (isContainer(a) && (/header/i.test(a.elementor) || HEADER_CLASS_RE.test(a.class) || HEADER_CLASS_RE.test(a.id)))),
      inFooter: ancestors.some((a) => a.name === "footer" || (isContainer(a) && (/footer/i.test(a.elementor) || FOOTER_CLASS_RE.test(a.class)))),
      homeLink: Boolean(anchor && (isHomeHref(anchor.href, baseUrl) || /(^|\s)home(\s|$)/i.test(anchor.rel || ""))),
      offsiteAnchor: Boolean(anchor && !isHomeHref(anchor.href, baseUrl) && !sameOwner(baseUrl, (() => { try { return new URL(anchor.href, baseUrl).toString(); } catch { return baseUrl; } })())),
      anchorHref: anchor?.href || "",
      roleClass: ROLE_HINT_RE.test(own) || ROLE_HINT_RE.test(anchor?.class || ""),
      carousel: CAROUSEL_RE.test(own) || CAROUSEL_RE.test(ancText),
      badge: BADGE_RE.test(own) || BADGE_RE.test(ancText) || BADGE_RE.test(anchor?.class || ""),
    });
  }

  // A numbered strip: 3+ DISTINCT files on the page sharing one digit-normalised
  // stem (logo-02-free-img, logo-03-free-img, logo-04-free-img). One business
  // has one mark; a run of numbered siblings is a row of other people's.
  const stems = new Map();
  for (const img of imgs) for (const u of img.urls) {
    const k = digitStem(u);
    if (!stems.has(k)) stems.set(k, new Set());
    stems.get(k).add(baseStem(u));
  }
  const inNumberedStrip = (u) => (stems.get(digitStem(u))?.size || 0) >= 3;

  // Which stems are present on the page in FULL SIZE. A `-150x58` crop is only
  // demoted when the original it was cut from is right there to be had instead;
  // a site whose one and only mark happens to carry a size suffix keeps its
  // place, because there is nothing better to promote.
  const fullSizeStems = new Set();
  for (const img of imgs) for (const u of img.urls) if (!isSizedDerivative(u)) fullSizeStems.add(baseStem(u));
  const hasFullSizeSibling = (u) => isSizedDerivative(u) && fullSizeStems.has(baseStem(u));

  // --- pass 2: judge ---------------------------------------------------------
  //
  // QUALIFICATION FIRST, then ranking. An image is even considered when it
  // carries a logo signal — "logo" in the URL, a role class, custom-logo, a
  // schema declaration — or when it is the branding mark in the header's home
  // link. Alt text is deliberately NOT a qualifier: on a WordPress site every
  // photo is captioned with the business name ("Trinity Plumbing bathroom
  // renovations", "About Local Plumbing llc"), so qualifying on the name would
  // put the client's hero photography in the running for their logo. The name in
  // the alt is strong evidence about WHOSE mark this is; it is no evidence that
  // the image IS a mark.
  let brandingSlotTaken = false;
  for (const img of imgs) {
    const imgHinted = img.customLogo || img.roleClass || img.urls.some((u) => LOGO_HINT_RE.test(u) || schema.has(u));
    if (!imgHinted) {
      // The first un-hinted image inside the header's home link IS the branding
      // mark — localplumbingllc.net ships Local-Plumbing-SOLID.jpg with no
      // "logo" anywhere in the markup, and its own schema.org Organization.logo
      // confirms that exact file. Everything after it in that slot is
      // decoration (AccuTemp hangs a calendar icon off the same home link).
      if (!(img.inHeader && !img.offsiteAnchor && img.homeLink)) { for (const u of img.urls) reject(u, "no_logo_signal_and_not_the_header_mark"); continue; }
      if (brandingSlotTaken) { for (const u of img.urls) reject(u, "not_the_first_mark_in_the_header_home_link"); continue; }
    }
    // The branding slot closes after the FIRST mark in the header's home link,
    // whether it announced itself or not: anything hung off that link afterwards
    // is furniture (accutempbr.com puts a calendar icon there).
    if (img.inHeader && !img.offsiteAnchor && img.homeLink) brandingSlotTaken = true;
    for (const url of img.urls) {
      const declaredBySchema = schema.has(url);
      // A positive declaration outranks the absence of a negative, so
      // custom-logo and schema survive the soft context rejections below.
      const protectedPick = img.customLogo || declaredBySchema;

      // EVERY negative signal is recorded, not just the first to fire. When
      // smithandsonstx.com's Google badge is refused it is refused for three
      // independent reasons at once (its alt names Google, it links to a Google
      // profile, and it is one of a numbered strip); an audit that saw only the
      // first would not know the other two rules were even working.
      const anchorHost = (() => { try { return new URL(img.anchorHref, baseUrl).hostname; } catch { return ""; } })();
      // Whose name the page puts on this image. A hit here is what lets a
      // contractor's own mark keep an alt like "Acme Plumbing — Google
      // Guaranteed": the client is positively identified, so the other brand's
      // name in the same string is not a claim of ownership.
      const altHits = nameHitsIn(img.alt, businessName);
      const negatives = [];
      if (img.alt && namesThirdPartyMark(img.alt) && !altHits.length) negatives.push(["alt_names_another_brand", img.alt.slice(0, 120)]);
      if (anchorHost && isThirdPartyMark(`${anchorHost}/`)) negatives.push(["links_to_third_party_profile", img.anchorHref.slice(0, 120)]);
      if (img.carousel) negatives.push(["carousel_or_partner_strip"]);
      if (img.badge) negatives.push(["badge_or_review_context"]);
      if (inNumberedStrip(url)) negatives.push(["numbered_sibling_strip", digitStem(url)]);
      if (negatives.length && !protectedPick) {
        reject(url, negatives[0][0], negatives[0][1], negatives.slice(1).map((n) => n[0]));
        continue;
      }

      const header = img.inHeader && !img.offsiteAnchor;
      const home = img.homeLink;

      // Within-tier tie-breaks, unchanged in spirit from the original scorer: a
      // footer/mono/icon variant is the same identity but a worse SOURCE — a
      // one-colour mark measures a one-colour brand.
      let tweak = 0;
      if (/footer|white|mono|icon|favicon|small/i.test(`${url} ${img.alt} ${img.own}`)) tweak += 200;
      if (img.inFooter) tweak += 150;
      if (LOGO_HINT_RE.test(url)) tweak -= 20;
      // A downscaled crop never outranks the original it came from.
      if (hasFullSizeSibling(url)) tweak += 300;
      tweak += offHostPenalty(baseUrl, url);

      if (img.customLogo) add(url, TIER.CUSTOM_LOGO, "class=custom-logo", tweak);
      else if (header && home && altHits.length) add(url, TIER.HEADER_HOME_NAME, `header+home-link, alt names ${altHits.join("/")}`, tweak);
      else if (header && home) add(url, TIER.HEADER_HOME, "header+home-link", tweak);
      else if (altHits.length) add(url, TIER.ALT_NAME, `alt names ${altHits.join("/")}`, tweak);
      else if (declaredBySchema) add(url, TIER.SCHEMA, "schema.org logo", tweak);
      else if (img.roleClass && !img.offsiteAnchor) add(url, TIER.ROLE_CLASS, "class/id says logo", tweak);
      else if (header) add(url, TIER.HEADER, "inside <header>", tweak);
      else if (home) add(url, TIER.HEADER_HOME, "inside the home link", tweak + 100);
      else if (LOGO_HINT_RE.test(url)) add(url, TIER.FILENAME, "filename contains \"logo\"", tweak);
      else reject(url, "no_declaration_and_no_logo_hint");
    }
  }

  // Schema / og:logo URLs that are not <img> on the homepage at all (a Yoast
  // Organization.logo often is not) still count — the site published them as its
  // own mark in machine-readable form.
  for (const url of schema) add(url, TIER.SCHEMA, "schema.org logo");
  const ogLogoAbs = resolve(ogLogo);
  if (ogLogoAbs) add(ogLogoAbs, TIER.SCHEMA, "og:logo");

  // apple-touch-icon: square, high-res, and by spec the site's OWN identity —
  // never a third party's. It is the safe tail of the declared set, which is why
  // it survives the "declared only" cut below.
  for (const tag of source.match(/<link\b[^>]*>/gi) || []) {
    if (!/apple-touch-icon/i.test(attrOf(tag, "rel"))) continue;
    const abs = resolve(attrOf(tag, "href"));
    if (abs) add(abs, TIER.TOUCH_ICON, "rel=apple-touch-icon");
  }

  // CSS background-image marks: Wix, Squarespace, Duda and GoDaddy paint the
  // logo this way. There is no element context to read here, so these can only
  // ever be filename-tier guesses.
  for (const m of source.matchAll(BG_URL_RE)) {
    const raw = String(m[1] || "").trim().replace(/^["']|["']$/g, "");
    if (!LOGO_HINT_RE.test(raw)) continue;
    const abs = resolve(raw);
    if (abs && !inNumberedStrip(abs)) add(abs, TIER.FILENAME, "css background-image url");
  }

  // og:image last and only when it looks like a mark — it is normally a share
  // card or a photo, and a photo in the header is worse than no logo.
  const ogAbs = resolve(ogImage);
  if (ogAbs && LOGO_HINT_RE.test(ogAbs)) add(ogAbs, TIER.OG_IMAGE, "og:image (logo-shaped)");

  let candidates = [...byUrl.values()].sort((a, b) => a.score - b.score || a.order - b.order);
  const declared = candidates.some((c) => c.tier <= DECLARED_MAX);

  if (declared) {
    for (const c of candidates) if (c.tier > DECLARED_MAX) reject(c.url, "undeclared_filename_guess_page_declares_a_logo");
    candidates = candidates.filter((c) => c.tier <= DECLARED_MAX);
  } else if (candidates.length > 1) {
    // Nothing declared and several files competing on filename alone: this is
    // the ambiguity that produced every leak. Refuse rather than pick.
    for (const c of candidates) reject(c.url, "ambiguous_undeclared_candidates");
    candidates = [];
  }

  return { candidates, rejected, declared };
}

/**
 * Candidate logo URLs from a homepage's HTML, best first.
 * Thin wrapper over rankLogoCandidates for the callers that only want URLs.
 */
function findLogoCandidates(html, baseUrl, businessName = "") {
  return rankLogoCandidates(html, baseUrl, businessName).candidates.map((c) => c.url);
}

function responseUrl(res, requestedUrl) {
  const resolved = String(res && res.url || "").trim();
  return resolved || requestedUrl;
}

function trustedRedirect(requestedUrl, finalUrl, siteUrl) {
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);
    if (requested.protocol === "https:" && final.protocol !== "https:") return false;
    if (requested.href === final.href) return true;
    return sameOwner(siteUrl, final.href);
  } catch {
    return false;
  }
}

/** Download a logo; returns { buffer, contentType, url } or null. */
async function downloadLogo(url, { siteUrl = "", businessName = "", env = process.env } = {}) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const finalUrl = responseUrl(res, url);
    if (!trustedRedirect(url, finalUrl, siteUrl)) {
      return { rejected: "logo_redirect_provenance_failed", finalUrl };
    }
    if (!ownsLogo(siteUrl, finalUrl, businessName, env)) {
      return { rejected: "logo_provenance_failed", finalUrl };
    }
    if (isThirdPartyMark(finalUrl)) {
      return { rejected: "logo_third_party_mark", finalUrl };
    }
    const ct = String(res.headers.get("content-type") || "");
    if (!/^image\//i.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_LOGO_BYTES) return null;
    return { buffer: buf, contentType: ct, url: finalUrl };
  } catch {
    return null;
  }
}

function extForContentType(ct) {
  if (/svg/i.test(ct)) return "svg";
  if (/webp/i.test(ct)) return "webp";
  if (/jpe?g/i.test(ct)) return "jpg";
  return "png";
}

// --- color measurement from published CSS ------------------------------------

const HEX_RE = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const STYLESHEET_RE = /<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi;

function expandHex(h) {
  const v = h.replace("#", "").toLowerCase();
  return v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
}

/**
 * Rank brand-candidate colors by how often they appear in the given CSS/HTML
 * text blobs. Whites/greys/near-blacks are excluded (isBrandCandidate), so the
 * loudest surviving color is the site's accent by construction.
 */
function rankCssColors(texts = [], { max = 6 } = {}) {
  const counts = new Map();
  for (const text of texts) {
    for (const m of String(text || "").match(HEX_RE) || []) {
      const hex = expandHex(m);
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
      if (!isBrandCandidate(r, g, b)) continue;
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([hex, n]) => ({ hex: `#${hex}`, count: n }));
}

// --- the one entry point -----------------------------------------------------

/**
 * Fetch the prospect's own site and return their brand kit:
 * { logo: {b64, contentType, ext, url} | null, accent, palette, sourceUrl, measured }
 *
 * Never throws — mirroring proceeds on wordmark + donor theme when the site is
 * unreachable. `measured:false` tells the caller nothing real was found.
 */
async function brandFromWebsite(siteUrl, { businessName = "" } = {}) {
  const empty = { logo: null, accent: null, palette: [], sourceUrl: siteUrl || "", measured: false, logoPick: null };
  const url = String(siteUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return empty;

  let html = "";
  let pageUrl = url;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return empty;
    pageUrl = responseUrl(res, url);
    if (!trustedRedirect(url, pageUrl, url) || !sameOwner(url, pageUrl)) {
      return {
        ...empty,
        hardProvenanceFailure: {
          reason: "homepage_redirect_provenance_failed",
          requestedUrl: url,
          finalUrl: pageUrl,
        },
      };
    }
    html = await res.text();
  } catch {
    return empty;
  }

  // logo: first candidate that actually downloads as an image
  let logo = null;
  // WHY the reason is carried out of here: all three marks that leaked in the
  // 2026-08-06 plumbing mine passed brand_check with logo_refs_in_output 3, and
  // nothing in the record said WHICH image had been believed or what had been
  // refused. "QC PASS is never proof" — so the pick now states its evidence.
  const rankedLogos = rankLogoCandidates(html, pageUrl, businessName);
  const logoPick = {
    declared: rankedLogos.declared,
    reason: rankedLogos.candidates[0] ? rankedLogos.candidates[0].signal : "no_candidate",
    tier: rankedLogos.candidates[0] ? TIER_NAME[rankedLogos.candidates[0].tier] : null,
    considered: rankedLogos.candidates.slice(0, 5).map((c) => ({ url: c.url, tier: TIER_NAME[c.tier], signal: c.signal })),
    rejected: rankedLogos.rejected.slice(0, 12),
  };
  // THE HEADER SLOT IS NOT A FAVICON SLOT.
  //
  // Ranking alone cannot settle this: nothing in the markup says how many pixels
  // a file has. The geometry is DECODED from the bytes we just downloaded (see
  // capture-brand/classifyHeaderMark for the thresholds and the measured
  // distribution they came from). A mark that is too small for the header does
  // not end the search — it is skipped and the NEXT candidate gets its turn,
  // which is normally the client's real mark that the icon was shadowing.
  //
  // Only when nothing in the list is header-grade does `logo` stay null, and
  // the caller then ships brandWordmarkSvg: the business's own name, set in
  // their own colour. Their name beats their favicon.
  let iconOnly = null;
  let hardProvenanceFailure = null;
  for (const cand of rankedLogos.candidates.slice(0, 5)) {
    const got = await downloadLogo(cand.url, { siteUrl: pageUrl, businessName });
    if (!got) continue;
    if (got.rejected) {
      logoPick.rejected.push({ url: String(got.finalUrl || cand.url).slice(0, 300), why: got.rejected });
      hardProvenanceFailure ||= { reason: got.rejected, requestedUrl: cand.url, finalUrl: got.finalUrl || "" };
      continue;
    }
    const shape = classifyHeaderMark(got.buffer, { url: got.url });
    if (!shape.ok) {
      logoPick.rejected.push({ url: got.url.slice(0, 300), why: "not_header_grade", detail: shape.reason });
      // Keep the first one anyway: it is still the client's own image, and a
      // caller that measures brand colour from it is measuring THEIR palette.
      if (!iconOnly) iconOnly = { ...shape, b64: got.buffer.toString("base64"), contentType: got.contentType, ext: extForContentType(got.contentType), url: got.url };
      continue;
    }
    logo = { b64: got.buffer.toString("base64"), contentType: got.contentType, ext: extForContentType(got.contentType), url: got.url };
    logoPick.reason = cand.signal;
    logoPick.tier = TIER_NAME[cand.tier];
    logoPick.shape = shape;
    break;
  }
  if (!logo && iconOnly) {
    logoPick.reason = "wordmark_preferred_over_site_icon";
    logoPick.tier = null;
    logoPick.shape = { ok: false, kind: iconOnly.kind, width: iconOnly.width, height: iconOnly.height, reason: iconOnly.reason };
  }

  // colors: homepage inline styles + up to 3 same-owner stylesheets
  const cssTexts = [html];
  const sheets = [];
  for (const tag of html.match(STYLESHEET_RE) || []) {
    const href = attrOf(tag, "href");
    if (!href) continue;
    try {
      const abs = new URL(href, pageUrl).toString();
      if (sameOwner(pageUrl, abs)) sheets.push(abs);
    } catch { /* skip */ }
  }
  for (const sheet of sheets.slice(0, 3)) {
    try {
      const res = await fetchWithTimeout(sheet);
      const finalUrl = responseUrl(res, sheet);
      if (res.ok && trustedRedirect(sheet, finalUrl, pageUrl) && sameOwner(pageUrl, finalUrl)) cssTexts.push(await res.text());
    } catch { /* skip */ }
  }
  const rankedColors = rankCssColors(cssTexts);
  // An accent must be a real color the template can theme with; hexToHsl guards
  // against anything that slipped through malformed.
  const accent = rankedColors.length && hexToHsl(rankedColors[0].hex) ? rankedColors[0].hex : null;

  return {
    logo,
    accent,
    palette: rankedColors.map((c) => c.hex),
    sourceUrl: url,
    // `iconOnly` is the client's own site icon when it was the ONLY image on
    // offer: too small for the header, but still their artwork and still a
    // legitimate colour source. Reported rather than dropped so the caller can
    // ship the wordmark in their real palette instead of the donor's.
    iconOnly: iconOnly ? { url: iconOnly.url, width: iconOnly.width, height: iconOnly.height, kind: iconOnly.kind, b64: iconOnly.b64, contentType: iconOnly.contentType, ext: iconOnly.ext } : null,
    measured: Boolean(logo || accent),
    logoPick,
    ...(hardProvenanceFailure ? { hardProvenanceFailure } : {}),
  };
}

module.exports = {
  registrableDomain,
  sameOwner,
  ownsLogo,
  nameTokens,
  findLogoCandidates,
  rankLogoCandidates,
  rankCssColors,
  brandFromWebsite,
  upgradeToHttps,
  isSizedDerivative,
  // One import point, so the miner, the forge lane and the engine all ask the
  // same question of the same bytes.
  classifyHeaderMark,
  // internals exported for tests
  attrOf,
  extForContentType,
  imagesWithContext,
  isHomeHref,
  schemaLogoUrls,
  TIER,
};
