"use strict";
/**
 * mailable-scan.js — "is this site mailable?" in one command.
 *
 * INDEPENDENCE CONTRACT
 * ---------------------
 * This file requires NOTHING from lib/ and nothing from the mirror engine or
 * its gates. Its whole purpose is to catch what those gates already passed, so
 * it may not borrow their predicates, their allowlists, or their notion of
 * "clean". Node builtins + playwright + the secrets loader only. If you are
 * tempted to `require("../lib/...")` here, you have broken the tool.
 *
 * It renders each live mirror in a real browser (these are React SPAs; fetching
 * raw HTML proves nothing) and judges the DOM a human would actually see.
 *
 * VERDICTS
 *   BLOCK — never mail this site.
 *   WARN  — mail is allowed, the operator should know.
 *   PASS  — nothing found.
 *
 * WHAT THIS CANNOT PROVE
 *   PASS means "none of these checks fired", not "this site is good". In
 *   particular the scanner cannot read a logo: it can prove two businesses
 *   share the same mark, and it can catch a mark whose file name or alt text
 *   names a manufacturer, but a logo that is a *picture* of someone else's
 *   badge will pass. --html writes a contact sheet of every logo so an
 *   operator can close that gap by eye in half a minute.
 *   It also cannot tell a client's own second phone number from a donor leak;
 *   it reports the number and where it sits, and a human decides.
 *
 * USAGE
 *   node scripts/mailable-scan.js
 *   node scripts/mailable-scan.js --limit 6 --concurrency 3
 *   node scripts/mailable-scan.js --host rocky --verbose
 *   node scripts/mailable-scan.js --no-geo          (skip town distance checks)
 *   node scripts/mailable-scan.js --json out.json --html sheet.html
 *   node scripts/mailable-scan.js --urls urls.txt   (scan an explicit list)
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REPO_BACKEND = path.resolve(__dirname, "..");
const { chromium } = require(path.join(REPO_BACKEND, "node_modules", "playwright"));
const { loadEnv } = require(path.join(__dirname, "brightdata-edit-proof", "env.js"));

// ---------------------------------------------------------------------------
// 0. Knowledge this scanner owns (deliberately NOT imported from the engine)
// ---------------------------------------------------------------------------

/** Phone numbers that legitimately belong to WSS, not to the client. */
const WSS_PHONES = new Set(["9493395562", "9493395562"]);

/** Email domains that legitimately belong to WSS. */
const WSS_EMAIL_DOMAINS = ["wss-ai.com", "wsslabs.com", "woodwardsoftware.com", "wssai.com"];

/**
 * Nav items and section labels that are NOT services. Shipped as services by
 * this system on live mirrors. Matched case-insensitively against the whole
 * label after normalisation.
 */
const NAV_NOT_SERVICE = new Set([
  "home", "about", "about us", "our story", "contact", "contact us", "blog", "news",
  "careers", "jobs", "employment", "financing", "finance options", "products",
  "product", "photo gallery", "gallery", "photos", "our work", "portfolio",
  "comfort club", "membership", "memberships", "join our team", "reviews",
  "testimonials", "specials", "coupons", "promotions", "offers", "faq", "faqs",
  "service area", "service areas", "areas we serve", "our team", "team", "staff",
  "customer service", "services", "our services", "all services", "more",
  "resources", "privacy policy", "terms", "sitemap", "book online", "schedule",
  "schedule service", "request service", "get a quote", "free estimate",
  "free estimates", "estimates", "menu",
  "search", "login", "log in", "sign in", "my account", "pay bill", "pay online",
  "shop", "store", "locations", "location", "hours", "directions", "español",
]);

/**
 * Nav nouns that make a label a nav item wherever they appear inside it.
 * Exact-match alone is not enough: this system shipped "Employment
 * Opportunities" as a plumbing company's only published service, and the
 * exact-match list only said "employment".
 */
const NAV_SUBSTRINGS = [
  "employment", "career", "job opening", "hiring", "photo gallery",
  "our gallery", "image gallery", "financing", "finance option", "blog",
  "newsletter", "press release", "privacy policy", "terms of", "sitemap",
  "our team", "meet the team", "about us", "comfort club", "membership plan",
  "loyalty program", "coupon", "testimonial", "leave a review",
  "write a review", "customer portal", "pay your bill", "opportunities",
  "web special", "special offer", "rebate", "incentive", "promotion",
];

/**
 * Verbs that make a label a call-to-action, not a service offered. The trailing
 * \s+ matters: "Shop/Garage Heaters" is a real HVAC service, "Shop our store"
 * is not.
 */
const CTA_PREFIX = /^(request|call|book|schedule|get|claim|start|click|tap|see|view|learn|read|download|apply|join|sign|shop|browse|explore|contact|ask|talk|speak|order|save|available for|now offering|why choose|meet)\s+/i;

/** Shapes that make a label a blog post / marketing line, not a service. */
const BLOGGY = [
  /\?\s*$/,                                  // a question
  /^\s*\d+\s+(ways|tips|signs|reasons|things|steps|myths|mistakes)\b/i,
  /\b(how to|what to do|when to|should you|do i need|top \d+|guide to|the ultimate)\b/i,
  /\b(tips|tricks|checklist|blog|article|newsletter|press release)\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i,
];

/** Superlative marketing strings that get harvested as services. */
const MARKETING_ONLY = [
  /^(fast|quick|same[- ]day|24\/?7|affordable|reliable|honest|trusted|licensed|insured|professional|quality|best|top|award[- ]winning|family[- ]owned|locally owned|free)\b[\w\s&/'-]*$/i,
  /\b(satisfaction guaranteed|no hidden fees|upfront pricing|financing available|we answer)\b/i,
];

/**
 * Manufacturer / certification marks. Seeing one of these in the LOGO slot means
 * someone else's mark is being presented as the client's identity — this system
 * has shipped exactly that (Mastercool, Google Blogger) with every gate green.
 * Seeing one in body copy is only worth a note.
 */
const MANUFACTURER_MARKS = [
  "mastercool", "blogger", "nate certified", "energy star",
  "carrier", "trane", "lennox", "goodman", "rheem", "ruud", "bryant", "york",
  "amana", "daikin", "mitsubishi electric", "american standard", "navien",
  "rinnai", "bradford white", "ao smith", "moen", "kohler",
  "delta faucet", "insinkerator", "ridgid", "roto-rooter",
  "gaf", "owens corning", "certainteed", "malarkey", "velux",
  "wordpress", "wix", "squarespace", "godaddy", "shopify",
];

/**
 * Directories and social platforms. Legitimate as an outbound link or a review
 * badge; NOT legitimate as the site's logo.
 */
const PLATFORM_MARKS = [
  "bbb", "better business bureau", "angi", "angies list", "homeadvisor",
  "home advisor", "yelp", "nextdoor", "thumbtack", "porch", "facebook",
  "instagram", "google guaranteed",
];

/** Word-boundary test so "angi" does not match "changing". */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function brandHit(haystack, brand) {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(brand)}([^a-z0-9]|$)`, "i").test(haystack);
}

/** Donor identities this system has previously leaked into client sites. */
const KNOWN_DONOR_IDENTITIES = [
  "falcon roof", "falcon roofing", "falcon roof craft", "tekline", "forchione",
  "mccabe", "oasis med spa", "urban nail bar", "luma aesthetics", "brand forge",
  "texans hvac", "ab detailing", "drain terrier", "scarlett's landscape",
  "roof replacement inc", "hb landscape",
];

/** Census / legal-entity artefacts that are not towns a human would recognise. */
const NOT_A_TOWN = [
  /\bprecinct\b/i, /\bcensus\b/i, /\bcdp\b/i, /\b\(balance\)\b/i,
  /\bconsolidated government\b/i, /\bunified government\b/i, /\bmetro government\b/i,
  /\bunincorporated\b/i, /\bcounty subdivision\b/i, /\btownship of\b/i,
  /\bdistrict\s+\d+\b/i, /\bward\s+\d+\b/i, /\bzcta\b/i, /\btract\b/i,
];

/** Unresolved template tokens. */
const TOKEN_PATTERNS = [
  { name: "js-template", re: /\$\{[^}\n]{1,80}\}/g },
  { name: "handlebars", re: /\{\{[^}\n]{1,80}\}\}/g },
  { name: "erb", re: /<%[^%\n]{1,80}%>/g },
  { name: "square", re: /\[\[[^\]\n]{1,60}\]\]/g },
];

const DIST_WARN_MILES = 45;
const DIST_BLOCK_MILES = 75;

/** A state is not a city. */
const US_STATES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
  "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
  "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york", "north carolina",
  "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
  "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington", "west virginia", "wisconsin", "wyoming",
]);

// ---------------------------------------------------------------------------
// 1. Small utilities
// ---------------------------------------------------------------------------

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Fold curly quotes, dashes, accents and case so string comparisons are fair. */
function fold(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Strip legal suffixes and punctuation so "Rocky's Plumbing, LLC" ~ "rockys plumbing". */
function slugWords(s) {
  return fold(s)
    .replace(/\b(llc|l\.l\.c|inc|inc\.|co|co\.|corp|corporation|company|ltd|plc|pllc|dba)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function last10(phone) {
  const d = String(phone || "").replace(/\D+/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

function haversineMiles(a, b) {
  if (!a || !b) return null;
  const R = 3958.7613;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function truncate(s, n = 120) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function uniq(arr) {
  return [...new Set(arr)];
}

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(size, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await worker(items[i], i);
      } catch (err) {
        out[i] = { __error: err && err.message ? err.message : String(err) };
      }
    }
  });
  await Promise.all(runners);
  return out;
}

async function fetchBuffer(url, timeoutMs = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "follow" });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf, contentType: res.headers.get("content-type") || "" };
  } catch (err) {
    return { status: 0, buf: Buffer.alloc(0), contentType: "", error: err.message };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// 2. Fleet source — read the store directly, no engine adapters
// ---------------------------------------------------------------------------

/**
 * A BLOCK THAT MEANS "I HAVE NO DATA" IS A LIE, and --urls told seven of them.
 *
 * Every store-relative check here compares the page against the stored row:
 * is this phone theirs, is this email theirs, does the title carry their name.
 * `--urls` used to hand those checks `row: null`, so each one compared against
 * `undefined` and every comparison failed. Measured 2026-08-12 on seven mirrors
 * that had just been rebuilt: 7/7 DO NOT MAIL, on
 *
 *     BLOCK title_no_business   title="Air Creation Heating & Cooling, LLC |
 *                               HVAC Contractor in Baton Rouge, LA"
 *                               name="undefined"
 *     BLOCK foreign_phone       2253130550 (stored: none)
 *     BLOCK foreign_email       aircreation@ymail.com (stored: none)
 *
 * The name is in the title. The phone and the email are theirs. An operator
 * reading that summary would have concluded the whole fleet was unmailable and
 * gone looking for a defect that did not exist — which is worse than a missed
 * defect, because it burns the trust that makes the scanner worth running.
 *
 * So a --urls run now looks each host up. The row is matched by preview_url,
 * exactly as the default path gets it. A URL with no row still scans, still
 * says so, and its store-relative checks are the ones that go quiet — they have
 * nothing to compare against and must not pretend otherwise.
 */
async function rowsForUrls(urls) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !key) return new Map();
  const select =
    "id,prospect_id,status,business_name,owner_name,email,owner_email,phone," +
    "current_website,industry,city,state,primary_services,preview_url,record,site_slug";
  const byHost = new Map();
  // Matched on HOST rather than on the full string: a stored preview_url may or
  // may not carry its trailing slash, and one character must not cost a row.
  const wanted = new Set(urls.map((u) => { try { return new URL(u).host; } catch { return ""; } }).filter(Boolean));
  const res = await fetch(
    `${base}/rest/v1/ghost_agency_prospects?select=${encodeURIComponent(select)}`
    + `&preview_url=not.is.null&order=updated_at.desc&limit=1000`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return byHost;
  for (const row of await res.json()) {
    let host = "";
    try { host = new URL(row.preview_url).host; } catch { continue; }
    if (!wanted.has(host) || byHost.has(host)) continue;
    byHost.set(host, row);
  }
  return byHost;
}

async function loadFleet(opts) {
  if (opts.urlsFile) {
    const lines = fs
      .readFileSync(opts.urlsFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    let byHost = new Map();
    try { byHost = await rowsForUrls(lines); } catch { byHost = new Map(); }
    let matched = 0;
    const fleet = lines.map((url) => {
      let host = "";
      try { host = new URL(url).host; } catch { host = ""; }
      const row = byHost.get(host) || null;
      if (row) matched++;
      return { url, row };
    });
    console.log(`--urls: ${lines.length} host(s), ${matched} matched to a stored prospect`
      + `${matched < lines.length ? ` — ${lines.length - matched} will skip every store-relative check` : ""}`);
    return fleet;
  }

  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not loaded");

  const select =
    "id,prospect_id,status,business_name,owner_name,email,owner_email,phone," +
    "current_website,industry,city,state,primary_services,preview_url,record,site_slug";
  const url =
    `${base}/rest/v1/ghost_agency_prospects?select=${encodeURIComponent(select)}` +
    `&status=eq.${encodeURIComponent(opts.status)}&preview_url=not.is.null` +
    `&order=created_at.desc&limit=${opts.dbLimit}`;

  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`store read failed: HTTP ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows.map((row) => ({ url: row.preview_url, row }));
}

// ---------------------------------------------------------------------------
// 3. Observation — what a human's browser actually receives
// ---------------------------------------------------------------------------

/** Runs inside the page. Must be a pure, self-contained function. */
function harvest() {
  const textOf = (n) => (n && n.textContent ? n.textContent.replace(/\s+/g, " ").trim() : "");
  const inside = (node, sel) => {
    let p = node;
    while (p) {
      if (p.matches && p.matches(sel)) return true;
      p = p.parentElement;
    }
    return false;
  };

  const reviewsRoot = document.querySelector("#reviews, [data-wss-reviews]");
  const floaterRoot = document.querySelector(
    "#wss-signup-floater, .wss-floater, [data-wss-floater], #wss-chat-panel"
  );

  // --- services the site publishes as services -----------------------------
  const services = [];
  const svcSection = document.querySelector("#services-detail");
  if (svcSection) {
    svcSection.querySelectorAll("li, h3, h4, .wss-svc, [data-service]").forEach((n) => {
      const t = textOf(n).replace(/^\s*\d{1,2}\s*[.·)\-]?\s*/, "").trim();
      if (t && t.length < 90) services.push(t);
    });
    if (!services.length) {
      const raw = (svcSection.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < raw.length; i += 1) {
        if (/^\d{1,2}$/.test(raw[i]) && raw[i + 1]) services.push(raw[i + 1]);
      }
    }
  }
  // donor-template service cards (the visual "what we do" grid)
  const donorServices = [];
  const donorSvc = document.querySelector("#services");
  if (donorSvc) {
    donorSvc.querySelectorAll("h3, h4").forEach((n) => {
      const t = textOf(n);
      if (t && t.length < 90) donorServices.push(t);
    });
  }

  // --- nav labels ----------------------------------------------------------
  const navLabels = [];
  document.querySelectorAll("nav a, header a").forEach((a) => {
    const t = textOf(a).replace(/^\s*\d{1,2}\s*/, "").trim();
    if (t && t.length < 40) navLabels.push(t);
  });

  // --- coverage towns ------------------------------------------------------
  // Service-area towns. The "drive from X" links carry the town verbatim in
  // ?origin=, anywhere on the page; the coverage section lists them as text.
  const townSeen = new Set();
  const towns = [];
  const addTown = (name, label) => {
    const clean = String(name || "").replace(/\+/g, " ").replace(/\s+/g, " ").trim();
    // The same town appears twice per page (a link and an all-caps rail); one
    // finding per town, not two.
    const key = clean.toLowerCase();
    if (!clean || townSeen.has(key)) return;
    townSeen.add(key);
    towns.push({ name: clean, label: label || clean });
  };
  document.querySelectorAll("a[href*='origin=']").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const m = href.match(/[?&]origin=([^&]+)/);
    if (!m) return;
    try {
      addTown(decodeURIComponent(m[1]), textOf(a));
    } catch (_) {
      addTown(m[1], textOf(a));
    }
  });
  document.querySelectorAll("#coverage, #region, [data-wss-coverage]").forEach((cov) => {
    (cov.innerText || "").split("\n").forEach((line) => {
      const t = line.trim();
      const bare = t.replace(/^(serving|service area|areas served)\s*[:\-]?\s*/i, "").replace(/\s*\d+\s*mi\s*$/i, "");
      if (/^[A-Z][A-Za-z .'\-]{1,30},\s*[A-Z]{2}\b/.test(bare)) addTown(bare, t);
    });
  });

  // --- links, images, icons -----------------------------------------------
  const links = [...document.querySelectorAll("a[href]")].map((a) => ({
    href: a.getAttribute("href") || "",
    text: textOf(a).slice(0, 80),
  }));
  const images = [...document.querySelectorAll("img")].map((i) => ({
    src: i.currentSrc || i.src || "",
    alt: i.alt || "",
    w: i.naturalWidth || 0,
    h: i.naturalHeight || 0,
    inHeader: inside(i, "header, nav, #site-header, [data-logo]"),
    inReviews: reviewsRoot ? reviewsRoot.contains(i) : false,
  }));
  const icons = [...document.querySelectorAll("link[rel]")]
    .filter((l) => /icon/i.test(l.getAttribute("rel") || ""))
    .map((l) => ({ rel: l.getAttribute("rel"), href: l.getAttribute("href") }));

  // --- meta ----------------------------------------------------------------
  const meta = {};
  document.querySelectorAll("meta[property], meta[name]").forEach((m) => {
    const k = m.getAttribute("property") || m.getAttribute("name");
    if (k) meta[k] = m.getAttribute("content") || "";
  });
  const canonical = (document.querySelector("link[rel=canonical]") || {}).href || "";

  const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(
    (s) => s.textContent || ""
  );

  // --- text, partitioned ---------------------------------------------------
  const fullText = document.body ? document.body.innerText || "" : "";
  const reviewsText = reviewsRoot ? reviewsRoot.innerText || "" : "";
  const floaterText = floaterRoot ? floaterRoot.innerText || "" : "";

  // token scan over rendered text + user-visible attributes
  const attrText = [];
  document.querySelectorAll("[alt],[title],[aria-label],[placeholder]").forEach((n) => {
    ["alt", "title", "aria-label", "placeholder"].forEach((a) => {
      const v = n.getAttribute(a);
      if (v) attrText.push(v);
    });
  });

  return {
    title: document.title || "",
    h1: [...document.querySelectorAll("h1")].map(textOf),
    h2: [...document.querySelectorAll("h2")].map(textOf),
    h3: [...document.querySelectorAll("h3")].map(textOf),
    services,
    donorServices,
    navLabels,
    towns,
    links,
    images,
    icons,
    meta,
    canonical,
    jsonld,
    fullText,
    reviewsText,
    floaterText,
    attrText,
    bodyChildCount: document.body ? document.body.childElementCount : 0,
    hasReviewsSection: Boolean(reviewsRoot),
    hasClientServiceSection: Boolean(svcSection) && services.length > 0,
    hoursText: (() => {
      const m = fullText.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[^\n]{0,60}\d/i);
      return m ? m[0] : "";
    })(),
  };
}

async function observe(browser, entry, opts) {
  const url = entry.url;
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/125.0 Safari/537.36 wss-mailable-scan/1",
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 200)));

  const obs = { url, httpStatus: 0, navError: "", consoleErrors, renderMs: 0 };
  const t0 = Date.now();
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.navTimeout });
    obs.httpStatus = res ? res.status() : 0;
    obs.finalUrl = page.url();
    await page.waitForTimeout(opts.settleMs);
    Object.assign(obs, await page.evaluate(harvest));
  } catch (err) {
    obs.navError = err.message ? err.message.slice(0, 220) : String(err);
  } finally {
    obs.renderMs = Date.now() - t0;
    await ctx.close().catch(() => {});
  }

  // Byte-level identity assets, fetched outside the page.
  const origin = (() => {
    try {
      return new URL(url).origin;
    } catch (_) {
      return "";
    }
  })();
  if (origin && !obs.navError) {
    const fav = await fetchBuffer(`${origin}/favicon.ico`);
    obs.favicon = {
      status: fav.status,
      bytes: fav.buf.length,
      sha256: fav.buf.length ? sha256(fav.buf) : "",
    };
    const logoSrc = pickLogoSrc(obs, origin);
    obs.logoSrc = logoSrc;
    if (logoSrc) {
      const lg = await fetchBuffer(logoSrc);
      obs.logo = { status: lg.status, bytes: lg.buf.length, sha256: lg.buf.length ? sha256(lg.buf) : "" };
    }
  }
  return obs;
}

function pickLogoSrc(obs, origin) {
  const imgs = obs.images || [];
  const named = imgs.find((i) => /client-logo|logo/i.test(i.src));
  if (named) return named.src;
  const header = imgs.find((i) => i.inHeader);
  if (header) return header.src;
  return "";
}

// ---------------------------------------------------------------------------
// 4. Geocoding (independent town verification)
// ---------------------------------------------------------------------------

/**
 * Towns are resolved independently of anything the site claims. Google's
 * Geocoding API is not enabled on this project's key and the Places key is
 * HTTP-referrer locked, so this uses OpenStreetMap's Nominatim: free, no key,
 * and — importantly — not the same source the engine used to invent the list.
 * Rate limit is 1 req/s, so results are cached on disk across runs.
 */
const GEO_CACHE_FILE = path.join(require("node:os").tmpdir(), "wss-mailable-geocache.json");

function loadGeoCache() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(GEO_CACHE_FILE, "utf8"))));
  } catch (_) {
    return new Map();
  }
}

function saveGeoCache(cache) {
  try {
    fs.writeFileSync(GEO_CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
  } catch (_) {
    /* cache is an optimisation, never a requirement */
  }
}

/**
 * Anchored lookup. "Monroe, OH" has a town next door to Middletown AND a county
 * 176 miles away; an unanchored geocoder returns the county and the scanner
 * would accuse a clean site. So: ask first whether a place by that name exists
 * NEAR the business (bounded box), and only fall back to a nationwide lookup
 * when it does not — at which point "far away" is a real answer.
 */
async function geocodeOnce(place, anchor) {
  const base = "https://nominatim.openstreetmap.org/search";
  const headers = {
    "User-Agent": "wss-mailable-scan/1 (operator verification, woodwardsoftware@gmail.com)",
  };
  const attempts = [];
  const d = 1.6; // ~110 mi box
  const box = anchor
    ? `&bounded=1&viewbox=${anchor.lng - d},${anchor.lat + d},${anchor.lng + d},${anchor.lat - d}`
    : "";
  // A structured city/state lookup is the difference between "Lawrence, the
  // Indianapolis suburb" and "Lawrence COUNTY, 67 miles away". Freeform search
  // returns the county; structured search returns the town.
  const parsed = String(place).match(/^\s*([A-Za-z .'\-]+?)\s*,\s*([A-Za-z]{2})\s*$/);
  if (parsed) {
    attempts.push(
      `${base}?city=${encodeURIComponent(parsed[1])}&state=${encodeURIComponent(parsed[2])}` +
        `&country=us&format=json&limit=1&addressdetails=1${box}`
    );
    if (box) {
      attempts.push(
        `${base}?city=${encodeURIComponent(parsed[1])}&state=${encodeURIComponent(parsed[2])}` +
          "&country=us&format=json&limit=1&addressdetails=1"
      );
    }
  }
  if (anchor) {
    attempts.push(
      `${base}?q=${encodeURIComponent(place)}&format=json&countrycodes=us&limit=1&addressdetails=1${box}`
    );
  }
  attempts.push(`${base}?q=${encodeURIComponent(place)}&format=json&countrycodes=us&limit=1&addressdetails=1`);

  for (let i = 0; i < attempts.length; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, 1100));
    try {
      const res = await fetch(attempts[i], { headers });
      if (!res.ok) continue;
      const json = await res.json();
      const hit = Array.isArray(json) && json[0];
      if (!hit) continue;
      // A county is not a town. If that is all this attempt found, try the next
      // query form rather than measuring the distance to a county centroid.
      const first = String(hit.display_name || "").split(",")[0].trim();
      if (/\bcounty\b/i.test(first) && i < attempts.length - 1) continue;
      return {
        lat: Number(hit.lat),
        lng: Number(hit.lon),
        formatted: hit.display_name,
        klass: `${hit.class || ""}/${hit.type || ""}`,
        bounded: i === 0 && Boolean(anchor),
      };
    } catch (_) {
      /* try the next form */
    }
  }
  return null;
}

// v2: structured city/state lookups. Bump this whenever the query strategy
// changes so stale answers cannot survive in the on-disk cache.
function geoKey(place, anchor) {
  const a = anchor ? `${anchor.lat.toFixed(1)},${anchor.lng.toFixed(1)}` : "-";
  return `v2|${fold(place)}|${a}`;
}

/** Resolve a batch of {q, anchor} lookups, once each, cached on disk. */
async function resolveGeo(requests, label) {
  const cache = loadGeoCache();
  const seen = new Map();
  for (const r of requests) {
    if (!r || !r.q) continue;
    const k = geoKey(r.q, r.anchor);
    if (!seen.has(k)) seen.set(k, r);
  }
  const missing = [...seen.entries()].filter(([k]) => !cache.has(k));
  if (missing.length) {
    process.stderr.write(`geocoding ${missing.length} distinct ${label} (${seen.size - missing.length} cached)…\n`);
  }
  let n = 0;
  for (const [k, req] of missing) {
    cache.set(k, await geocodeOnce(req.q, req.anchor));
    n += 1;
    if (n % 25 === 0) saveGeoCache(cache);
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim usage policy
  }
  saveGeoCache(cache);
  return cache;
}

// ---------------------------------------------------------------------------
// 5. Judgement
// ---------------------------------------------------------------------------

function classifyServiceLabel(label) {
  const f = fold(label);
  const bare = f.replace(/[^\w\s/&'-]/g, "").trim();
  if (!bare) return { bad: true, why: "empty service label" };
  if (NAV_NOT_SERVICE.has(bare)) return { bad: true, why: "navigation/section label, not a service" };
  for (const n of NAV_SUBSTRINGS) {
    if (bare.includes(n)) return { bad: true, why: `navigation label (contains "${n}"), not a service` };
  }
  if (CTA_PREFIX.test(bare)) return { bad: true, why: "call-to-action, not a service" };
  for (const re of BLOGGY) if (re.test(label)) return { bad: true, why: "blog-post/marketing title, not a service" };
  for (const re of MARKETING_ONLY) if (re.test(label)) return { bad: true, why: "marketing slogan, not a service" };
  if (/^\d+$/.test(bare)) return { bad: true, why: "numeric label" };
  if (label.length > 70) return { bad: true, why: "sentence, not a service name" };
  return { bad: false };
}

function extractPhones(text) {
  const out = [];
  const re = /(?:\+?1[\s.\-]?)?\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/g;
  let m;
  while ((m = re.exec(text))) out.push(m[0].trim());
  return out;
}

function extractEmails(text) {
  const out = [];
  const re = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  let m;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}

function extractStreetAddresses(text) {
  // Line-scoped on purpose: a greedy \s+ crosses newlines and glues an
  // unrelated number ("318446") onto the real street address.
  const out = [];
  const re =
    /\b\d{1,6}[ \t]+[A-Z0-9][A-Za-z0-9.'\-]*(?:[ \t]+[A-Z0-9][A-Za-z0-9.'\-]*){0,4}[ \t]+(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Hwy|Highway|Pl|Place|Ter|Terrace|Cir|Circle|Trl|Trail|Loop|Pike|Sq)\b\.?/g;
  for (const line of String(text || "").split(/\r?\n/)) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) out.push(m[0].trim());
  }
  return out;
}

function normStreet(addr) {
  return fold(addr)
    .replace(/[.,#]/g, " ")
    .replace(/\b(suite|ste|unit|apt|bldg|building|floor|fl)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Judge one observation. `context` carries the stored row and the cross-fleet
 * duplicate index. Returns { verdict, blocks[], warns[], facts }.
 */
async function judge(obs, entry, context, opts) {
  const blocks = [];
  const warns = [];
  const row = entry.row || {};
  const rec = row.record || {};
  const host = (() => {
    try {
      return new URL(obs.url).host;
    } catch (_) {
      return obs.url;
    }
  })();

  const B = (code, detail, offending) => blocks.push({ code, detail, offending: offending || "" });
  const W = (code, detail, offending) => warns.push({ code, detail, offending: offending || "" });

  // ---- 5a. Does the page exist at all? ------------------------------------
  if (obs.navError) {
    B("dead_page", `navigation failed: ${obs.navError}`, obs.url);
    return finish();
  }
  if (obs.httpStatus >= 400 || obs.httpStatus === 0) {
    B("dead_page", `HTTP ${obs.httpStatus}`, obs.url);
    return finish();
  }
  const textLen = (obs.fullText || "").length;
  if (textLen < 400) {
    B("blank_shell", `rendered text is ${textLen} chars — blank or error shell`, truncate(obs.fullText, 160));
    return finish();
  }
  if (/vercel authentication|log in to vercel|sso protection/i.test(obs.fullText)) {
    B("blank_shell", "page is a Vercel auth wall, not the mirror", truncate(obs.fullText, 120));
    return finish();
  }
  if (/application error|something went wrong|minified react error|404\s*[|—-]\s*not found/i.test(obs.fullText.slice(0, 900))) {
    B("error_shell", "page renders an application error", truncate(obs.fullText, 160));
  }

  // Where the business actually is: stored coordinates, else its address
  // geocoded independently. Used by both the title check and the town check.
  const home =
    rec.latitude && rec.longitude
      ? { lat: rec.latitude, lng: rec.longitude }
      : context.geo.get(geoKey(rec.address || "", null)) || null;

  // ---- 5b. Identity in the title ------------------------------------------
  const bizWords = slugWords(row.business_name || rec.business_name || "");
  const city = row.city || rec.city || "";
  const title = obs.title || "";
  if (!title.trim()) {
    B("title_missing", "<title> is empty", "");
  } else {
    const tf = slugWords(title);
    // business name matches if every significant word of the name appears
    const words = bizWords.split(" ").filter((w) => w.length > 2);
    const nameHit = words.length ? words.every((w) => tf.includes(w)) : false;
    if (!nameHit) B("title_no_business", "<title> does not contain the business name", `title="${title}" name="${row.business_name}"`);
    if (city && !fold(title).includes(fold(city))) {
      // Which town does the title actually claim?
      const claimedFull = (title.match(/\bin\s+([A-Z][A-Za-z .'\-]+,\s*[A-Z]{2})\b/) || [])[1] || "";
      const claimed = claimedFull.replace(/,\s*[A-Z]{2}$/, "").trim();
      if (!claimed) {
        B("title_no_city", "<title> names no city at all", `title="${title}" stored city="${city}"`);
      } else if (US_STATES.has(fold(claimed)) || /^(central|northern|southern|eastern|western|greater|upper|lower)\b/i.test(claimed)) {
        B("title_not_a_city", `<title> puts a state or region where the city goes: "${claimed}"`, title);
      } else if (
        // the business name bled into the city slot: "AGL Heating & Air" →
        // "in Air Charleston, SC"
        slugWords(claimed)
          .split(" ")
          .some((w) => w.length > 2 && slugWords(row.business_name || "").split(" ").includes(w))
      ) {
        B("title_city_contaminated", `<title>'s city contains a word from the business name: "${claimed}"`, title);
      } else {
        const sharedWord = fold(claimed)
          .split(" ")
          .some((w) => w.length > 3 && fold(city).split(" ").includes(w));
        const g = home ? context.geo.get(geoKey(claimedFull, home)) : null;
        const miles = g && home ? haversineMiles(home, g) : null;
        if (sharedWord || (miles !== null && miles <= DIST_WARN_MILES)) {
          W(
            "title_metro_city",
            `<title> names "${claimed}" instead of the town of record "${city}"${miles !== null ? ` (${Math.round(miles)} mi away)` : ""}`,
            title
          );
        } else {
          B(
            "title_wrong_city",
            `<title> names a different town than the store: "${claimed}" vs "${city}"${miles !== null ? ` (${Math.round(miles)} mi apart)` : ""}`,
            title
          );
        }
      }
    }
  }

  // ---- 5c. Template sameness across the fleet ------------------------------
  const h1 = (obs.h1 || [])[0] || "";
  if (!h1.trim()) {
    W("h1_missing", "no <h1> on the page", "");
  } else {
    const twins = (context.h1Index.get(h1) || []).filter((h) => h !== host);
    if (twins.length) {
      B("h1_duplicate", `h1 is byte-identical to ${twins.length} other live mirror(s): ${twins.slice(0, 3).join(", ")}`, h1);
    }
  }
  if (title.trim()) {
    const twins = (context.titleIndex.get(title) || []).filter((h) => h !== host);
    if (twins.length) {
      B("title_duplicate", `<title> is byte-identical to ${twins.length} other live mirror(s): ${twins.slice(0, 3).join(", ")}`, title);
    }
  }

  // ---- 5d. Favicon / logo identity ----------------------------------------
  if (obs.favicon && obs.favicon.sha256) {
    const twins = (context.faviconIndex.get(obs.favicon.sha256) || []).filter((h) => h !== host);
    if (twins.length) {
      B("favicon_duplicate", `favicon bytes identical to ${twins.length} other business(es): ${twins.slice(0, 3).join(", ")}`, obs.favicon.sha256.slice(0, 16));
    }
  } else if (obs.favicon) {
    W("favicon_missing", `/favicon.ico returned HTTP ${obs.favicon.status} (${obs.favicon.bytes} bytes)`, "");
  }
  if (obs.logo && obs.logo.sha256) {
    const twins = (context.logoIndex.get(obs.logo.sha256) || []).filter((h) => h !== host);
    if (twins.length) {
      B("logo_duplicate", `logo bytes identical to ${twins.length} other business(es): ${twins.slice(0, 3).join(", ")}`, obs.logoSrc);
    }
  } else if (!obs.logoSrc) {
    W("logo_missing", "no logo image found in the header", "");
  }

  // third-party mark presented as their identity
  const logoHay = fold(`${obs.logoSrc || ""} ${(obs.images || []).filter((i) => i.inHeader).map((i) => `${i.src} ${i.alt}`).join(" ")}`);
  const ownName = slugWords(row.business_name || "");
  for (const mark of [...MANUFACTURER_MARKS, ...PLATFORM_MARKS]) {
    if (brandHit(logoHay, mark) && !ownName.includes(mark.replace(/[^a-z0-9 ]/g, ""))) {
      B("third_party_mark", `header/logo carries a third-party mark: "${mark}"`, truncate(`${obs.logoSrc} | ${logoHay}`, 200));
      break;
    }
  }
  // cross-origin logo (their mark should be served from their own mirror)
  if (obs.logoSrc) {
    try {
      const lh = new URL(obs.logoSrc).host;
      if (lh && lh !== host) W("logo_cross_origin", `logo is served from ${lh}, not the mirror`, obs.logoSrc);
    } catch (_) {
      /* relative src, fine */
    }
  }

  // ---- 5e. Unresolved template tokens -------------------------------------
  const tokenHay = `${obs.fullText}\n${(obs.attrText || []).join("\n")}\n${title}`;
  for (const { name, re } of TOKEN_PATTERNS) {
    const found = uniq(tokenHay.match(new RegExp(re.source, "g")) || []);
    if (found.length) {
      B("template_token", `unresolved ${name} token(s) rendered on the page`, found.slice(0, 5).join(" | "));
    }
  }

  // ---- 5f. Services that are not services ---------------------------------
  // Two different lists live on these pages and they must not be conflated:
  //   clientServices — the injected "Services in <city>" list, derived from
  //                    this business. This is what the mirror claims they do.
  //   donorServices  — the template's own three cards, byte-identical on every
  //                    mirror in the vertical. Generic copy, not their services.
  // A page whose only "services" are the donor's cards has published nothing
  // about this business at all.
  const clientServices = uniq(obs.services || []).filter(Boolean);
  const donorServices = uniq(obs.donorServices || []).filter(Boolean);
  const publishedServices = uniq([...clientServices, ...donorServices]);
  const navSet = new Set((obs.navLabels || []).map((n) => fold(n)));
  const townNames = new Set(
    (obs.towns || []).map((t) => fold(String(t.name || "").replace(/,\s*[A-Za-z]{2}\s*$/, "")))
  );
  const badServices = [];
  for (const s of publishedServices) {
    const verdict = classifyServiceLabel(s);
    if (verdict.bad) badServices.push({ label: s, why: verdict.why });
    else if (navSet.has(fold(s))) badServices.push({ label: s, why: "duplicates a nav item" });
    else if (city && fold(s) === fold(city)) badServices.push({ label: s, why: "is the city name" });
    else if (bizWords && slugWords(s) === bizWords) badServices.push({ label: s, why: "is the business name" });
    // A town is a place, not a service. Seen live: "Clackamas" and "Beaverton"
    // published in a Portland HVAC company's service list.
    else if (townNames.has(fold(s))) badServices.push({ label: s, why: "is a service-area town, not a service" });
  }
  if (badServices.length) {
    B(
      "service_not_a_service",
      `${badServices.length} published "service(s)" are nav items, CTAs or marketing lines`,
      badServices.map((b) => `"${b.label}" (${b.why})`).join(" | ")
    );
  }
  const badSet = new Set(badServices.map((b) => b.label));
  const realClientServices = clientServices.filter((s) => !badSet.has(s));
  if (!obs.hasClientServiceSection) {
    W("services_missing", "no client-derived service list on the page — only the template's generic cards", donorServices.join(" | "));
  } else if (!realClientServices.length) {
    W("services_missing", "the client service list contains nothing that is a real service", clientServices.join(" | "));
  } else if (realClientServices.length < 3) {
    W("services_thin", `only ${realClientServices.length} real service(s) published`, realClientServices.join(" | "));
  }

  // ---- 5g. Contact facts that are not theirs (donor leak) -----------------
  const ownText = `${obs.fullText}`;
  const reviewsText = obs.reviewsText || "";
  const floaterText = obs.floaterText || "";
  // NB: never String.split("") — it explodes into characters. Only strip
  // sections that actually rendered.
  const stripSection = (haystack, section) =>
    section && section.length > 20 ? haystack.split(section).join("\n") : haystack;
  const nonReviewText = stripSection(stripSection(ownText, reviewsText), floaterText);

  const storedPhone = last10(row.phone || rec.phone || "");
  const pagePhones = uniq([
    ...extractPhones(nonReviewText),
    ...(obs.links || []).filter((l) => l.href.startsWith("tel:")).map((l) => l.href.slice(4)),
  ]);
  const foreignPhones = uniq(
    pagePhones.map(last10).filter((p) => p && p !== storedPhone && !WSS_PHONES.has(p))
  );
  if (foreignPhones.length) {
    B("foreign_phone", `phone number(s) that are not theirs (stored: ${row.phone || "none"})`, foreignPhones.join(", "));
  }
  if (!storedPhone) W("no_stored_phone", "store has no phone for this business — page phones unverifiable", pagePhones.join(", "));

  const storedEmails = uniq([row.email, row.owner_email, rec.email].filter(Boolean).map((e) => fold(e)));
  const pageEmails = uniq([
    ...extractEmails(nonReviewText),
    ...(obs.links || []).filter((l) => l.href.startsWith("mailto:")).map((l) => l.href.slice(7).split("?")[0]),
  ]).map((e) => fold(e));
  const foreignEmails = pageEmails.filter(
    (e) => !storedEmails.includes(e) && !WSS_EMAIL_DOMAINS.some((d) => e.endsWith(`@${d}`))
  );
  if (foreignEmails.length) {
    B("foreign_email", `email address(es) that are not theirs (stored: ${storedEmails.join(", ") || "none"})`, uniq(foreignEmails).join(", "));
  }

  const storedAddr = normStreet(rec.address || "");
  const storedAddrNum = (storedAddr.match(/^\d+/) || [""])[0];
  const storedAddrStreet = storedAddr.split(" ").slice(1, 3).join(" ");
  const pageAddrs = uniq(extractStreetAddresses(nonReviewText));
  const foreignAddrs = pageAddrs.filter((a) => {
    if (!storedAddr) return false;
    const n = normStreet(a);
    const num = (n.match(/^\d+/) || [""])[0];
    const street = n.split(" ").slice(1, 3).join(" ");
    // theirs when both the number and the first two street words agree
    return !(num && num === storedAddrNum && street && storedAddrStreet.startsWith(street.split(" ")[0]));
  });
  if (foreignAddrs.length) {
    B("foreign_address", `street address(es) that do not match the stored address ("${rec.address || "none"}")`, foreignAddrs.join(" | "));
  }

  // JSON-LD identity must agree with the store
  for (const raw of obs.jsonld || []) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      continue;
    }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (node.telephone && last10(node.telephone) && last10(node.telephone) !== storedPhone && !WSS_PHONES.has(last10(node.telephone))) {
        B("foreign_phone", "schema.org telephone is not theirs", `${node.telephone} (stored ${row.phone})`);
      }
      if (node.name && bizWords && !slugWords(node.name).includes(bizWords.split(" ")[0])) {
        B("schema_wrong_name", "schema.org name is a different business", `${node.name} (stored ${row.business_name})`);
      }
    }
  }

  // person names in an ownership slot, and known donor identities anywhere
  const nameSlot =
    nonReviewText.match(/\b(owner|founder|president|ceo|proprietor)\s*[·:\-—]\s*([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,2})/g) || [];
  for (const hit of nameSlot) {
    const who = hit.split(/[·:\-—]/).slice(1).join(" ").trim();
    const stored = fold(row.owner_name || "");
    if (!stored || !fold(who).includes(stored)) {
      B("foreign_person", `a person is presented as the owner but the store has ${row.owner_name ? `"${row.owner_name}"` : "no owner name"}`, hit);
    }
  }
  const donorHay = fold(nonReviewText);
  for (const donor of KNOWN_DONOR_IDENTITIES) {
    if (donorHay.includes(donor) && !slugWords(row.business_name || "").includes(donor.replace(/[^a-z0-9 ]/g, ""))) {
      B("donor_identity_leak", `donor identity "${donor}" appears in the page copy`, donor);
    }
  }
  // A manufacturer named in body copy is a note, not a block — trades sites
  // legitimately say "we install Trane". A directory/social name is normal too
  // (it is a link), so it is not reported at all outside the logo slot.
  for (const mark of MANUFACTURER_MARKS) {
    if (brandHit(donorHay, mark) && !ownName.includes(mark.replace(/[^a-z0-9 ]/g, ""))) {
      W("third_party_mention", `manufacturer brand "${mark}" appears in the page copy`, mark);
    }
  }

  // ---- 5h. Towns --------------------------------------------------------
  const townFindings = [];
  if (opts.geo && !home && (obs.towns || []).length) {
    W("towns_unverifiable", "store has no coordinates and the address would not geocode — service-area towns could not be checked", rec.address || "");
  }
  for (const t of obs.towns || []) {
    const name = String(t.name || "").trim();
    if (!name) continue;
    const bare = name.replace(/,\s*[A-Z]{2}\s*$/, "").trim();
    if (/^\d+$/.test(bare)) {
      B("bad_town", "a service-area town is a bare number", name);
      continue;
    }
    const artefact = NOT_A_TOWN.find((re) => re.test(name));
    if (artefact) {
      B("bad_town", "a service-area town is a Census/legal-entity artefact, not a place people say", name);
      continue;
    }
    const g = opts.geo && home ? context.geo.get(geoKey(name, home)) : null;
    if (!g) {
      townFindings.push({ name, miles: null, formatted: "" });
      continue;
    }
    const miles = haversineMiles(home, g);
    townFindings.push({ name, miles: Math.round(miles), formatted: g.formatted });
    if (miles > DIST_BLOCK_MILES) {
      B("town_far", `service-area town is ${Math.round(miles)} mi from the business`, `${name} → ${g.formatted}`);
    } else if (miles > DIST_WARN_MILES) {
      W("town_distant", `service-area town is ${Math.round(miles)} mi away`, `${name} → ${g.formatted}`);
    }
  }

  // ---- 5i. Soft quality ---------------------------------------------------
  if (!obs.hasReviewsSection || !/★|\bstar\b|\breview\b/i.test(reviewsText)) {
    W("no_reviews", "no reviews shown on the page", "");
  }
  if (!obs.hoursText) W("no_hours", "no opening hours shown on the page", "");

  return finish();

  function finish() {
    const verdict = blocks.length ? "BLOCK" : warns.length ? "WARN" : "PASS";
    return {
      host,
      url: obs.url,
      business: row.business_name || "(unknown)",
      city: row.city || "",
      state: row.state || "",
      industry: row.industry || "",
      verdict,
      blocks,
      warns,
      facts: {
        httpStatus: obs.httpStatus,
        renderMs: obs.renderMs,
        title: obs.title,
        h1: (obs.h1 || [])[0] || "",
        textLen: (obs.fullText || "").length,
        publishedServices: uniq([...(obs.services || []), ...(obs.donorServices || [])]),
        towns: townFindings,
        faviconSha: obs.favicon ? obs.favicon.sha256 : "",
        logoSrc: obs.logoSrc || "",
        logoSha: obs.logo ? obs.logo.sha256 : "",
        pagePhones: uniq(extractPhones(obs.fullText || "")),
        storedPhone: row.phone || "",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// 6. Reporting
// ---------------------------------------------------------------------------

function renderReport(results, meta) {
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  const blocked = results.filter((r) => r.verdict === "BLOCK");
  const warned = results.filter((r) => r.verdict === "WARN");
  const passed = results.filter((r) => r.verdict === "PASS");

  lines.push("");
  lines.push("=".repeat(100));
  lines.push(`MAILABLE SCAN — ${results.length} live mirrors — ${meta.startedAt}`);
  lines.push("=".repeat(100));

  for (const r of results) {
    lines.push("");
    lines.push(`${r.verdict.padEnd(5)} ${r.business}  [${r.city}, ${r.state} · ${r.industry}]`);
    lines.push(`      ${r.url}`);
    for (const b of r.blocks) {
      lines.push(`      BLOCK ${pad(b.code, 22)} ${b.detail}`);
      if (b.offending) lines.push(`            ↳ ${truncate(b.offending, 400)}`);
    }
    for (const w of r.warns) {
      lines.push(`      warn  ${pad(w.code, 22)} ${w.detail}`);
      if (w.offending) lines.push(`            ↳ ${truncate(w.offending, 220)}`);
    }
  }

  const codeCounts = new Map();
  for (const r of results) {
    for (const b of r.blocks) codeCounts.set(`BLOCK ${b.code}`, (codeCounts.get(`BLOCK ${b.code}`) || 0) + 1);
    for (const w of r.warns) codeCounts.set(`warn  ${w.code}`, (codeCounts.get(`warn  ${w.code}`) || 0) + 1);
  }

  lines.push("");
  lines.push("=".repeat(100));
  lines.push("FLEET SUMMARY");
  lines.push("=".repeat(100));
  lines.push(`  scanned : ${results.length}`);
  lines.push(`  MAILABLE (PASS)      : ${passed.length}`);
  lines.push(`  MAILABLE with notes  : ${warned.length}  (WARN)`);
  lines.push(`  DO NOT MAIL (BLOCK)  : ${blocked.length}`);
  lines.push("");
  lines.push("  defect frequency (hosts affected):");
  const hostsByCode = new Map();
  for (const r of results) {
    for (const b of uniq(r.blocks.map((x) => x.code))) hostsByCode.set(`BLOCK ${b}`, (hostsByCode.get(`BLOCK ${b}`) || 0) + 1);
    for (const w of uniq(r.warns.map((x) => x.code))) hostsByCode.set(`warn  ${w}`, (hostsByCode.get(`warn  ${w}`) || 0) + 1);
  }
  for (const [code, n] of [...hostsByCode.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`    ${pad(code, 32)} ${String(n).padStart(3)} / ${results.length}`);
  }
  lines.push("");
  if (blocked.length) {
    lines.push("  blocked hosts:");
    for (const r of blocked) lines.push(`    ${pad(r.business, 44)} ${uniq(r.blocks.map((b) => b.code)).join(", ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * A contact sheet of every mirror's logo and favicon. Automated checks can
 * prove two businesses share a mark, and can catch a mark whose file name or
 * alt text names a manufacturer — they cannot read a logo that is a picture of
 * someone else's badge. Thirty seconds of an operator's eyes closes that gap,
 * so the scanner hands over the evidence instead of pretending it is complete.
 */
function renderContactSheet(results) {
  const esc = (s) =>
    String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const colour = { PASS: "#1a7f37", WARN: "#9a6700", BLOCK: "#b42318" };
  const cards = results
    .map(
      (r) => `<figure class="c">
  <div class="v" style="background:${colour[r.verdict]}">${r.verdict}</div>
  <div class="art">
    ${r.facts.logoSrc ? `<img class="logo" src="${esc(r.facts.logoSrc)}" alt="">` : '<div class="none">no logo</div>'}
    <img class="fav" src="${esc(new URL("/favicon.ico", r.url).href)}" alt="">
  </div>
  <figcaption>
    <b>${esc(r.business)}</b><br>
    <span class="m">${esc(r.city)}, ${esc(r.state)} · ${esc(r.industry)}</span><br>
    <a href="${esc(r.url)}" target="_blank" rel="noopener">open</a>
  </figcaption>
</figure>`
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Mailable scan — logo contact sheet</title>
<style>
 body{font:14px/1.4 system-ui,sans-serif;margin:24px;background:#fbfbfa;color:#111}
 h1{font-size:18px} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
 .c{margin:0;border:1px solid #ddd;border-radius:8px;background:#fff;overflow:hidden}
 .v{color:#fff;font:700 11px/1 system-ui;padding:6px 8px;letter-spacing:.06em}
 .art{height:110px;display:flex;align-items:center;justify-content:center;gap:12px;background:#f2f2f0;position:relative}
 .logo{max-width:150px;max-height:80px;object-fit:contain}
 .fav{width:24px;height:24px;position:absolute;right:8px;bottom:8px;border:1px solid #ccc;background:#fff}
 .none{color:#b42318;font-size:12px} figcaption{padding:8px} .m{color:#666;font-size:12px}
</style>
<h1>Logo contact sheet — ${results.length} live mirrors</h1>
<p>Look for: someone else's brand, a manufacturer badge, a logo that repeats.</p>
<div class="grid">
${cards}
</div>`;
}

// ---------------------------------------------------------------------------
// 7. Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    concurrency: 6,
    dbLimit: 400,
    limit: 0,
    status: "line_queued",
    host: "",
    urlsFile: "",
    json: "",
    html: "",
    geo: true,
    navTimeout: 45000,
    settleMs: 2600,
    selfTest: false,
    verbose: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--concurrency") o.concurrency = Number(next());
    else if (a === "--limit") o.limit = Number(next());
    else if (a === "--status") o.status = next();
    else if (a === "--host") o.host = next();
    else if (a === "--urls") o.urlsFile = next();
    else if (a === "--json") o.json = next();
    else if (a === "--html") o.html = next();
    else if (a === "--no-geo") o.geo = false;
    else if (a === "--settle") o.settleMs = Number(next());
    else if (a === "--self-test") o.selfTest = true;
    else if (a === "--verbose") o.verbose = true;
  }
  return o;
}

/**
 * --self-test: proves the pure predicates behave, offline. Run this after any
 * edit to the rule tables; a scanner that quietly stops detecting is worse than
 * no scanner.
 */
function selfTest() {
  const fails = [];
  const eq = (label, got, want) => {
    if (got !== want) fails.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  };
  const bad = (s) => classifyServiceLabel(s).bad;

  // things that are NOT services
  ["Photo Gallery", "Comfort Club", "Products", "About", "Home", "Blog", "Careers",
    "Financing", "Customer Service", "All services", "Free Estimate",
    "Request an Estimate", "Schedule a Free Consultation",
    "Request Plumbing Service – Chickamauga", "Available for 24/7 Emergency Service",
    "FAST RELIABLE SERVICE", "5 Signs Your Water Heater Is Failing",
    "How to unclog a drain", "Is my furnace too old?",
    "Employment Opportunities", "Career Opportunities", "View Our Photo Gallery",
    "Financing Options"].forEach((s) => eq(`bad("${s}")`, bad(s), true));

  // things that ARE services and must not be flagged
  ["Drain Cleaning", "Water Heater Installation", "Shop/Garage Heaters",
    "AC Repair", "Sewer Line Replacement", "Emergency Service", "Repairs & Fixtures",
    "Heat Pump Maintenance", "Backflow Testing", "Hydro Jetting"].forEach((s) =>
    eq(`good("${s}")`, bad(s), false));

  // brand word boundaries
  eq("brandHit changing/angi", brandHit("we are changing filters", "angi"), false);
  eq("brandHit angi", brandHit("reviews on angi and yelp", "angi"), true);
  eq("brandHit carrier", brandHit("carrier dealer", "carrier"), true);

  // address extraction must not cross newlines
  eq("addr newline", JSON.stringify(extractStreetAddresses("318446\n28 Harp Switch Road")),
    JSON.stringify(["28 Harp Switch Road"]));
  eq("addr inline", JSON.stringify(extractStreetAddresses("Visit 3080 Scioto Darby Executive Ct today")),
    JSON.stringify(["3080 Scioto Darby Executive Ct"]));

  // phone / email
  eq("phone", JSON.stringify(extractPhones("call (706) 841-3132 now")), JSON.stringify(["(706) 841-3132"]));
  eq("last10", last10("+1 (706) 841-3132"), "7068413132");
  eq("email", JSON.stringify(extractEmails("a@b.com and x@y.co.uk")), JSON.stringify(["a@b.com", "x@y.co.uk"]));

  // name folding
  eq("slugWords", slugWords("Rocky’s Plumbing, LLC"), "rockys plumbing");
  eq("fold curly", fold("Rocky’s"), "rocky's");

  // distance sanity: Chattanooga TN to Fort Oglethorpe GA is ~10 mi
  const miles = haversineMiles({ lat: 35.0457, lng: -85.3095 }, { lat: 34.95, lng: -85.2457 });
  if (!(miles > 5 && miles < 15)) fails.push(`haversine: got ${miles} mi, expected ~10`);

  if (fails.length) {
    console.error(`SELF-TEST FAILED (${fails.length}):`);
    fails.forEach((f) => console.error(`  ${f}`));
    process.exit(1);
  }
  console.log("self-test OK");
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.selfTest) return selfTest();
  loadEnv();
  const startedAt = new Date().toISOString();

  let fleet = await loadFleet(opts);
  if (opts.host) fleet = fleet.filter((e) => e.url.includes(opts.host));
  if (opts.limit) fleet = fleet.slice(0, opts.limit);
  if (!fleet.length) throw new Error("no hosts to scan");

  process.stderr.write(`scanning ${fleet.length} live mirrors, concurrency ${opts.concurrency}…\n`);

  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  let done = 0;
  const observations = await pool(fleet, opts.concurrency, async (entry) => {
    const obs = await observe(browser, entry, opts);
    done += 1;
    process.stderr.write(`  [${String(done).padStart(3)}/${fleet.length}] ${obs.httpStatus || "ERR"} ${entry.url}\n`);
    return obs;
  });
  await browser.close();

  // cross-fleet duplicate indexes, built only from what was actually rendered
  const context = {
    h1Index: new Map(),
    titleIndex: new Map(),
    faviconIndex: new Map(),
    logoIndex: new Map(),
    geo: new Map(),
  };
  observations.forEach((obs, i) => {
    if (!obs || obs.__error || obs.navError) return;
    const host = (() => {
      try {
        return new URL(fleet[i].url).host;
      } catch (_) {
        return fleet[i].url;
      }
    })();
    const push = (map, key) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(host);
    };
    push(context.h1Index, (obs.h1 || [])[0] || "");
    push(context.titleIndex, obs.title || "");
    push(context.faviconIndex, obs.favicon ? obs.favicon.sha256 : "");
    push(context.logoIndex, obs.logo ? obs.logo.sha256 : "");
  });

  if (opts.geo) {
    // Phase 1 — where is each business? Stored coordinates, else its address.
    const addressLookups = [];
    for (const entry of fleet) {
      const rec = (entry.row && entry.row.record) || {};
      if (!rec.latitude && rec.address) addressLookups.push({ q: rec.address, anchor: null });
    }
    context.geo = await resolveGeo(addressLookups, "business addresses");

    // Phase 2 — towns and the title's claimed city, anchored to that business.
    const anchored = [];
    fleet.forEach((entry, i) => {
      const rec = (entry.row && entry.row.record) || {};
      const home =
        rec.latitude && rec.longitude
          ? { lat: rec.latitude, lng: rec.longitude }
          : context.geo.get(geoKey(rec.address || "", null)) || null;
      if (!home) return;
      const obs = observations[i] || {};
      for (const t of obs.towns || []) if (t && t.name) anchored.push({ q: t.name, anchor: home });
      const claimed = ((obs.title || "").match(/\bin\s+([A-Z][A-Za-z .'\-]+,\s*[A-Z]{2})\b/) || [])[1];
      if (claimed) anchored.push({ q: claimed, anchor: home });
    });
    context.geo = await resolveGeo(anchored, "towns");
  }

  const results = [];
  for (let i = 0; i < fleet.length; i += 1) {
    const obs = observations[i] || { url: fleet[i].url, navError: "scanner crashed" };
    if (obs.__error) obs.navError = obs.__error;
    results.push(await judge(obs, fleet[i], context, opts));
  }

  const report = renderReport(results, { startedAt });
  process.stdout.write(report);

  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify({ startedAt, opts, results }, null, 1));
    process.stderr.write(`\nwrote ${opts.json}\n`);
  }
  if (opts.html) {
    fs.writeFileSync(opts.html, renderContactSheet(results));
    process.stderr.write(`wrote ${opts.html}\n`);
  }
  const blocked = results.filter((r) => r.verdict === "BLOCK").length;
  process.exitCode = blocked ? 1 : 0;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("mailable-scan failed:", err && err.stack ? err.stack : err);
    process.exit(2);
  });
}

module.exports = {
  classifyServiceLabel,
  extractPhones,
  extractEmails,
  extractStreetAddresses,
  brandHit,
  fold,
  slugWords,
  last10,
  haversineMiles,
  selfTest,
};
