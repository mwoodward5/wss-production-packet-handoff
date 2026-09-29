"use strict";

// scripts/fleet-audit.cjs — the FLEET AUDITOR.
//
// Walks every live mirror and scores it 0-100 against the defect classes the
// 2026-08-22 manual probe found (donor fonts instead of client brand_truth —
// the Anton/Fraunces tell, accent not applied, hero text missing, gallery
// duplication, client photo buried low in the page, missing logo, missing
// noindex/attribution legal hygiene, title sanity, hero video missing).
//
// It is a REPORT, never a gate: exit code is 0 no matter how bad the fleet is.
//
//   node scripts/fleet-audit.cjs                                    # durable store if configured, else the known campaign-9 list
//   node scripts/fleet-audit.cjs https://site-a.wss-ai.com/ ...
//   echo "https://site-a.wss-ai.com/" | node scripts/fleet-audit.cjs
//   node scripts/fleet-audit.cjs --expects test/fixtures/fleet-expects.json
//   node scripts/fleet-audit.cjs --expect-fonts canyon-plumbing-llc-las-vegas=Lora --expect-accent canyon-plumbing-llc-las-vegas=#0074F0
//
// Detectors are exported pure functions so test/fleet-audit.test.js can pin
// each one against fixture HTML/CSS without any network.

const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// The known fleet (static fallback when no URLs are given and no store env).
// Campaign line_mti8u213 — the first sites the factory ever shipped.
// ---------------------------------------------------------------------------

const MIRROR_URL_PATTERN = (slug) => `https://wss-test-${slug}.wss-ai.com/`;

const DEFAULT_SLUGS = Object.freeze([
  "canyon-plumbing-llc-las-vegas",
  "dms-plumbing-llc-las-vegas",
  "nevada-plumbing-authority-north-las-vegas",
  "precision-plumbing-llc-las-vegas",
  "pure-plumbing-and-air-las-vegas",
  "p1mitigators-jacksonville",
  "all-florida-fence-solutions-newberry",
  "mr-fence-of-florida-panama-city",
  "rumsey-construction-wilton",
  "good-life-construction-north-highlands",
]);

// ---------------------------------------------------------------------------
// Defect classes + weights. Named constants so the scorecard rows and the
// fleet-wide frequency roll-up speak the same language.
// ---------------------------------------------------------------------------

const DEFECTS = Object.freeze({
  FETCH_FAILED: { weight: 100, label: "fetch failed" },
  FONT_DONOR_TELL: { weight: 20, label: "donor fonts served instead of client brand_truth" },
  FONT_EXPECTED_MISSING: { weight: 20, label: "expected client font not the primary display face" },
  ACCENT_MISSING: { weight: 10, label: "expected accent color not applied in CSS" },
  HERO_EMPTY: { weight: 15, label: "hero text missing or empty" },
  HERO_TITLE_ONLY: { weight: 5, label: "hero headline is JS-mounted; only <title> carries it statically" },
  IMG_DUPLICATED: { weight: 10, label: "same image src served 2+ times" },
  IMG_NO_CLIENT_PHOTO: { weight: 10, label: "no client-bank image found in served HTML" },
  IMG_FIRST_CLIENT_LOW: { weight: 10, label: "first client-bank image buried low in the HTML" },
  LOGO_MISSING: { weight: 10, label: "no logo element found" },
  NOINDEX_MISSING: { weight: 10, label: "no noindex robots meta" },
  ATTRIBUTION_MISSING: { weight: 10, label: "no WSS attribution footer" },
  TITLE_UNSANE: { weight: 5, label: "title empty/placeholder" },
  HERO_VIDEO_MISSING: { weight: 10, label: "no hero video element or ladder" },
});

// The donor boilerplate ships Anton (condensed) + Fraunces (display). When one
// of these is the PRIMARY display face, the client's brand_truth fonts never
// made it into the build — the #1 Aug-22 defect class.
const DONOR_FONT_TELLS = Object.freeze(["anton", "fraunces"]);

// URL fragments that mark an image as WSS-owned/AI-generated rather than a
// client photo-bank asset.
const AI_IMAGE_MARKERS = /(hero-fallback|hero-cgi|\/cgi[-_]|generated|seedance|placeholder|placekitten|dummyimage|picsum)/i;

// Google review-avatar crops: client-adjacent but not photo-bank material.
const AVATAR_URL_RE = /=s\d+-c[^=]*-mo-ba|-ba2(\/|$|=)/;

const PLACEHOLDER_TITLES = /^(untitled|new document|home|index|vite(\s*app)?|react\s*app|404[^a-z]*)$/i;

// ---------------------------------------------------------------------------
// URL / arg plumbing
// ---------------------------------------------------------------------------

function slugFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^wss-test-([a-z0-9-]+)\.wss-ai\.com$/i);
    if (m) return m[1].toLowerCase();
    return host.toLowerCase();
  } catch {
    return String(url).toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  }
}

function parseArgs(argv) {
  const out = {
    urls: [],
    expects: {},
    jsonOut: "",
    firstImageKb: 48,
    timeoutMs: 20000,
    fromStore: false,
  };
  const sidecar = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--expect-fonts" || a === "--expect-accent") {
      const pair = String(argv[i + 1] || "");
      const eq = pair.indexOf("=");
      if (eq > 0) {
        const slug = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (!out.expects[slug]) out.expects[slug] = {};
        if (a === "--expect-fonts") {
          out.expects[slug].fonts = value.split(",").map((s) => s.trim()).filter(Boolean);
        } else {
          out.expects[slug].accent = value;
        }
      }
      i += 1;
    } else if (a === "--expects") {
      sidecar.push(String(argv[i + 1] || ""));
      i += 1;
    } else if (a === "--json") {
      out.jsonOut = String(argv[i + 1] || "");
      i += 1;
    } else if (a === "--first-image-kb") {
      out.firstImageKb = Number(argv[i + 1]) || out.firstImageKb;
      i += 1;
    } else if (a === "--timeout") {
      out.timeoutMs = Number(argv[i + 1]) || out.timeoutMs;
      i += 1;
    } else if (a === "--store") {
      out.fromStore = true;
    } else if (!a.startsWith("--")) {
      out.urls.push(a);
    }
  }
  for (const file of sidecar) {
    try {
      const map = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [slug, spec] of Object.entries(map || {})) {
        if (!out.expects[slug]) out.expects[slug] = {};
        if (Array.isArray(spec?.fonts)) out.expects[slug].fonts = spec.fonts;
        if (typeof spec?.accent === "string") out.expects[slug].accent = spec.accent;
      }
    } catch (error) {
      console.error(`(sidecar ${file} unreadable: ${error.message})`);
    }
  }
  return out;
}

function readStdinUrls() {
  if (process.stdin.isTTY) return [];
  try {
    return fs
      .readFileSync(0, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

// The durable store (lib/store) knows every live mirror. When it is configured
// we read preview_urls from it; when it is not, the caller decides via the
// static list or argv. Never throws — a missing store degrades, it does not kill.
async function urlsFromStore() {
  try {
    const { selectRows } = require("../lib/store");
    const result = await selectRows("ghost_agency_prospects", {
      select: "preview_url",
      filter: "preview_url=not.is.null",
      order: "updated_at.desc",
      limit: 500,
    });
    if (!result || result.mode === "dry_run") return { ok: false, reason: result?.reason || "store not configured" };
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const urls = rows.map((r) => String(r.preview_url || "").trim()).filter(Boolean);
    return urls.length ? { ok: true, urls } : { ok: false, reason: "store returned no preview_urls" };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

// ---------------------------------------------------------------------------
// Fetch layer: homepage + linked CSS from the SAME host (external stylesheet
// links, e.g. Google Fonts, are parsed from the href itself and never fetched).
// ---------------------------------------------------------------------------

async function fetchText(url, timeoutMs, fetchImpl = fetch) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: { "user-agent": "wss-fleet-auditor/1.0 (+https://ghost.wss-ai.com)" },
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, contentType: response.headers.get("content-type") || "", body };
  } finally {
    clearTimeout(timer);
  }
}

function linkedStylesheetUrls(html, baseUrl) {
  const out = [];
  const re = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi;
  const hrefRe = /href=["']([^"']+)["']/i;
  for (const tag of html.match(re) || []) {
    const m = tag.match(hrefRe);
    if (!m) continue;
    try {
      const abs = new URL(m[1], baseUrl).toString();
      out.push(abs);
    } catch {
      /* malformed href — skip */
    }
  }
  return out;
}

function inlineStyleText(html) {
  return (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || [])
    .map((block) => block.replace(/<style\b[^>]*>/i, "").replace(/<\/style>/i, ""))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Detector: FONTS
// ---------------------------------------------------------------------------

// Google Fonts links name their families right in the href — no fetch needed.
function collectGoogleFontFamilies(html) {
  const families = new Set();
  // Grab each css2 href whole, then read EVERY family= param inside it (a
  // greedy one-shot regex would silently keep only the last family).
  for (const href of html.match(/fonts\.googleapis\.com\/css2\?[^"']+/gi) || []) {
    for (const param of href.split(/[&?]/)) {
      const m = param.match(/^family=([^&"'\\]+)/i);
      if (!m) continue;
      const name = decodeURIComponent(m[1].split(":")[0]).replace(/\+/g, " ").trim();
      if (name) families.add(name);
    }
  }
  return [...families];
}

function collectAtFaceFamilies(cssText) {
  const families = new Set();
  const re = /@font-face\s*\{[^}]*\}/gi;
  let m;
  while ((m = re.exec(cssText || ""))) {
    const f = m[0].match(/font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;}"']+))/i);
    const name = (f && (f[1] || f[2] || f[3]) || "").trim();
    if (name) families.add(name);
  }
  return [...families];
}

// The effective display face: the FIRST family named by --font-display (the
// var every headline rule defers to). Falls back to the first declared
// Google/@font-face family when the var is absent.
function effectiveDisplayFont(cssText) {
  const m = (cssText || "").match(/--font-display\s*:\s*([^;}]+)/i);
  if (m) {
    const first = m[1].split(",")[0].replace(/["']/g, "").trim();
    if (first) return first;
  }
  return null;
}

function detectFonts({ html, cssText, expectFonts }) {
  const googleFamilies = collectGoogleFontFamilies(html);
  const atFaceFamilies = collectAtFaceFamilies(cssText);
  const declared = [...new Set([...googleFamilies, ...atFaceFamilies])];
  const primary = effectiveDisplayFont(cssText) || declared[0] || null;
  const notes = [];
  let status = "pass";
  let defect = null;

  if (primary && DONOR_FONT_TELLS.includes(primary.toLowerCase())) {
    status = "fail";
    defect = "FONT_DONOR_TELL";
  } else if (expectFonts && expectFonts.length) {
    const wanted = expectFonts.map((f) => f.toLowerCase());
    const primaryHit = primary && wanted.includes(primary.toLowerCase());
    if (!primaryHit) {
      status = "fail";
      defect = "FONT_EXPECTED_MISSING";
      notes.push(`expected primary display font [${expectFonts.join(", ")}], served "${primary || "(none)"}"`);
    }
  }
  // Even on a pass, a donor tell loaded as a non-primary family is worth a
  // note (dead donor payload the client's brand has to outrank).
  const donorLoaded = declared.filter((f) => DONOR_FONT_TELLS.includes(f.toLowerCase()));
  if (donorLoaded.length && status === "pass") {
    notes.push(`donor families still loaded (non-primary): ${donorLoaded.join(", ")}`);
  }
  return {
    status,
    defect,
    notes,
    primary,
    declared,
    googleFamilies,
    atFaceFamilies,
  };
}

// ---------------------------------------------------------------------------
// Detector: ACCENT COLOR
// ---------------------------------------------------------------------------

function normalizeHex(value) {
  const m = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? `#${m[1].toLowerCase()}` : null;
}

function hexToHslTriplet(hex) {
  const n = normalizeHex(hex);
  if (!n) return null;
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function cssFormsOfAccent(accent) {
  const forms = new Set();
  const hex = normalizeHex(accent);
  if (hex) {
    forms.add(hex); // #1a3047
    forms.add(hex.toUpperCase());
    const noHash = hex.slice(1);
    forms.add(noHash);
    forms.add(noHash.toUpperCase());
    const { h, s, l } = hexToHslTriplet(hex) || {};
    if (h !== undefined) {
      forms.add(`${h} ${s}% ${l}%`);
      forms.add(`${h}, ${s}%, ${l}%`);
      // The CSS var shorthand triplet the new-generation build emits:
      // `--accent: 213 100% 38%`
      forms.add(`${h} ${s}% ${l}%`.replace(/%/g, ""));
    }
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    forms.add(`rgb(${r}, ${g}, ${b})`);
    forms.add(`rgb(${r},${g},${b})`);
    return [...forms];
  }
  // Already an hsl()/triplet or other literal — search it verbatim.
  const raw = String(accent).trim();
  return raw ? [raw, raw.replace(/%/g, "")] : [];
}

// Literal search is exact, and hex→HSL rounding differs by tool (measured:
// #0074F0 is h=211 by hand, h=213 in one build's CSS). So when the expected
// accent parses as an HSL triplet, any DECLARED accent triplet within
// tolerance counts as applied.
const TRIPLET_RE = /(\d{1,3})\s+(\d{1,3})%\s+(\d{1,3})%/;

function declaredTriplets(cssText) {
  const out = [];
  for (const m of (cssText || "").matchAll(/--[a-z-]*accent[a-z-]*\s*:\s*([^;}]+)/gi)) {
    const t = m[1].match(TRIPLET_RE);
    if (t) out.push([Number(t[1]), Number(t[2]), Number(t[3])]);
  }
  return out;
}

function tripletNear(expected, actual, { dh = 3, ds = 4, dl = 4 } = {}) {
  return (
    Math.min(Math.abs(expected[0] - actual[0]), 360 - Math.abs(expected[0] - actual[0])) <= dh
    && Math.abs(expected[1] - actual[1]) <= ds
    && Math.abs(expected[2] - actual[2]) <= dl
  );
}

// No expectation? Auto-note the dominant accent the CSS actually declares so
// the scorecard still teaches the operator what each site carries.
function dominantAccent(cssText) {
  const m = (cssText || "").match(/--accent(?:-soft)?\s*:\s*([^;}]+)/i);
  return m ? m[1].trim() : null;
}

function detectAccent(cssText, expectAccent) {
  const dominant = dominantAccent(cssText);
  if (!expectAccent) {
    return { status: "note", defect: null, dominant, notes: dominant ? [`auto-noted dominant accent: ${dominant}`] : ["no --accent declaration found"] };
  }
  const forms = cssFormsOfAccent(expectAccent);
  const hit = forms.find((form) => (cssText || "").includes(form));
  if (hit) return { status: "pass", defect: null, dominant, notes: [`found ${hit}`] };
  // Rounding-tolerant triplet match against every declared accent var.
  const expectedTriplet = hexToHslTriplet(expectAccent);
  if (expectedTriplet) {
    const want = [expectedTriplet.h, expectedTriplet.s, expectedTriplet.l];
    const near = declaredTriplets(cssText).find((t) => tripletNear(want, t));
    if (near) {
      return { status: "pass", defect: null, dominant, notes: [`matched declared triplet ${near.join(" ")} ~ expected ${want.join(" ")} (within rounding)`] };
    }
  }
  return {
    status: "fail",
    defect: "ACCENT_MISSING",
    dominant,
    notes: [`expected ${expectAccent} (searched ${forms.length} literal forms incl. hsl triplet); CSS carries ${dominant || "no --accent"}`],
  };
}

// ---------------------------------------------------------------------------
// Detector: HERO TEXT
// ---------------------------------------------------------------------------

function firstTagText(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  if (!m) return null;
  return m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function detectHeroText(html) {
  const h1 = firstTagText(html, "h1");
  if (h1 !== null && h1.length > 0) {
    return { status: "pass", defect: null, text: h1.slice(0, 140), source: "h1" };
  }
  if (h1 !== null && h1.length === 0) {
    // An h1 that renders empty is the worst case: the slot exists, the copy
    // never shipped.
    return { status: "fail", defect: "HERO_EMPTY", text: "", source: "h1" };
  }
  const title = firstTagText(html, "title");
  if (title && title.length > 3) {
    return { status: "warn", defect: "HERO_TITLE_ONLY", text: title.slice(0, 140), source: "title" };
  }
  return { status: "fail", defect: "HERO_EMPTY", text: "", source: "none" };
}

// ---------------------------------------------------------------------------
// Detector: IMAGE CENSUS (dedup violations + first client-bank position)
// ---------------------------------------------------------------------------

function collectImageRefs(html, pageUrl) {
  const refs = [];
  const push = (raw, offset) => {
    const src = raw.trim();
    if (!src || src.startsWith("data:")) return;
    refs.push({ src, offset });
  };
  const patterns = [
    /<img\b[^>]*\bsrc=["']([^"']+)["']/gi,
    /<source\b[^>]*\bsrcset=["']([^"'\s]+)[^"']*["']/gi,
    /url\(\s*["']?(\/?[^)"'\s]+\.(?:png|jpe?g|webp|avif|gif))["']?\s*\)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) {
      push(m[1], m.index);
    }
  }
  const og = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
  if (og) push(og[1], og.index);
  // Normalize protocol-relative + relative forms against the page URL so the
  // same asset referenced two ways still counts as a duplicate.
  for (const ref of refs) {
    try {
      ref.src = new URL(ref.src, pageUrl).toString();
    } catch {
      /* keep raw */
    }
  }
  refs.sort((a, b) => a.offset - b.offset);
  return refs;
}

function isClientBankImage(src, pageUrl) {
  let host = "";
  let pathname = "";
  try {
    const u = new URL(src);
    host = u.hostname.toLowerCase();
    pathname = u.pathname.toLowerCase();
  } catch {
    return false;
  }
  let pageHost = "";
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    /* ignore */
  }
  if (host === pageHost) return false; // mirror-owned asset (incl. AI hero CGI)
  if (AI_IMAGE_MARKERS.test(src)) return false; // AI/placeholder marker
  if (/lh3\.googleusercontent\.com/.test(host) && AVATAR_URL_RE.test(src)) return false; // review avatar crop
  if (/^fonts\./.test(host) || host.endsWith("gstatic.com")) return false;
  if (/\.svg$/.test(pathname)) return false; // icons/logos are not photo bank
  return true;
}

function imageCensus(html, pageUrl, firstImageKb) {
  const refs = collectImageRefs(html, pageUrl);
  const counts = new Map();
  for (const ref of refs) counts.set(ref.src, (counts.get(ref.src) || 0) + 1);
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([src, count]) => ({ src, count }));
  const firstClient = refs.find((ref) => isClientBankImage(ref.src, pageUrl)) || null;
  const firstClientKb = firstClient ? Math.round((firstClient.offset / 1024) * 10) / 10 : null;
  const totalBytes = Buffer.byteLength(html, "utf8");
  return {
    total: refs.length,
    unique: counts.size,
    duplicates,
    firstClientImage: firstClient
      ? {
          src: firstClient.src,
          offsetKb: firstClientKb,
          position: firstClient.offset <= firstImageKb * 1024 ? "high" : "low",
        }
      : null,
    htmlKb: Math.round(totalBytes / 102.4) / 10,
  };
}

// ---------------------------------------------------------------------------
// Detector: LOGO
// ---------------------------------------------------------------------------

function detectLogo(html) {
  if (/(<img|<source)[^>]+(?:class|id|alt)=["'][^"']*logo/i.test(html)) return { status: "pass", hint: "img.logo" };
  if (/<svg\b[^>]+(?:class|id)=["'][^"']*logo/i.test(html)) return { status: "pass", hint: "svg.logo" };
  const og = html.match(/property=["']og:image["'][^>]*content=["']([^"']*logo[^"']*)["']/i)
    || html.match(/content=["']([^"']*logo[^"']*)["'][^>]*property=["']og:image["']/i);
  if (og) return { status: "pass", hint: "og:image logo" };
  if (/(class|id)=["'][^"']*\bbrand\b[^"']*["'][^>]*>\s*<(img|svg)/i.test(html)) return { status: "pass", hint: "brand block img/svg" };
  return { status: "fail", defect: "LOGO_MISSING", hint: null };
}

// ---------------------------------------------------------------------------
// Detector: LEGAL HYGIENE (noindex + attribution footer)
// ---------------------------------------------------------------------------

function detectLegalHygiene(html) {
  const robots = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i)
    || html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']robots["']/i);
  const noindex = !!robots && /\bnoindex\b/i.test(robots[1]);
  const attribution = /class=["'][^"']*wss-attr|data-wss-attribution|Unofficial concept by/i.test(html);
  const notes = [];
  if (!noindex) notes.push(robots ? `robots meta exists but has no noindex: "${robots[1]}"` : "no robots meta at all");
  if (!attribution) notes.push("no WSS attribution footer found");
  return {
    status: noindex && attribution ? "pass" : "fail",
    noindex,
    attribution,
    defect: null, // filled by the scorer per missing mark
    notes,
  };
}

// ---------------------------------------------------------------------------
// Detector: TITLE / ROBOTS SANITY
// ---------------------------------------------------------------------------

function detectTitleSanity(html) {
  const title = firstTagText(html, "title");
  if (!title || title.length < 10 || PLACEHOLDER_TITLES.test(title.trim())) {
    return { status: "fail", defect: "TITLE_UNSANE", title: title || "", notes: [`title: "${title || "(missing)"}"`] };
  }
  return { status: "pass", defect: null, title, notes: [] };
}

// ---------------------------------------------------------------------------
// Detector: HERO VIDEO (marked <video> or the rung ladder)
// ---------------------------------------------------------------------------

function detectHeroVideo(html) {
  const ladder = html.match(/<script\s+type=["']application\/json["']\s+id=["']hero-video-ladder["'][^>]*>([\s\S]*?)<\/script>/i);
  let sources = [];
  if (ladder) {
    try {
      sources = JSON.parse(ladder[1]).sources || [];
    } catch {
      sources = [];
    }
  }
  const hasVideoTag = /<video\b/i.test(html);
  const present = sources.length > 0 || hasVideoTag;
  const clientClip = sources.find((s) => !AI_IMAGE_MARKERS.test(s) && !/hero-fallback/i.test(s)) || null;
  const notes = [];
  if (present && !clientClip && sources.length) notes.push(`ladder carries only the WSS fallback: ${sources[0]}`);
  return {
    status: present ? (clientClip ? "pass" : "warn") : "fail",
    defect: present ? null : "HERO_VIDEO_MISSING",
    sources,
    clientClip,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreSite(site) {
  const rows = [];
  const push = (check, defectOverride, note) => {
    if (!check || check.status === "pass") return;
    const key = defectOverride || check.defect;
    if (!key) return; // pure note (e.g. accent auto-note)
    const spec = DEFECTS[key];
    rows.push({
      check: note || key,
      status: check.status,
      deduction: spec.weight,
      label: spec.label,
    });
  };

  if (site.fetchError) {
    return { score: 0, rows: [{ check: "FETCH_FAILED", status: "fail", deduction: 100, label: site.fetchError }] };
  }

  const fonts = site.checks.fonts;
  if (fonts.status === "fail") push(fonts);
  for (const note of fonts.notes) {
    rows.push({ check: "fonts-note", status: "note", deduction: 0, label: note });
  }

  const accent = site.checks.accent;
  if (accent.status === "fail") push(accent);
  else if (accent.status === "note") rows.push({ check: "accent-note", status: "note", deduction: 0, label: accent.notes[0] });

  const hero = site.checks.hero;
  if (hero.status !== "pass") push(hero);

  const images = site.checks.images;
  if (images.duplicates.length) {
    push({ status: "fail", defect: "IMG_DUPLICATED" }, null,
      `IMG_DUPLICATED (${images.duplicates.length} src${images.duplicates.length > 1 ? "s" : ""}, worst ${images.duplicates[0].count}x)`);
  }
  if (!images.firstClientImage) {
    push({ status: "fail", defect: "IMG_NO_CLIENT_PHOTO" });
  } else if (images.firstClientImage.position === "low") {
    push({ status: "fail", defect: "IMG_FIRST_CLIENT_LOW" }, null,
      `IMG_FIRST_CLIENT_LOW (first client photo at ${images.firstClientImage.offsetKb}kB of ${images.htmlKb}kB)`);
  }

  const logo = site.checks.logo;
  if (logo.status === "fail") push(logo);

  const hygiene = site.checks.hygiene;
  if (!hygiene.noindex) push({ status: "fail", defect: "NOINDEX_MISSING" });
  if (!hygiene.attribution) push({ status: "fail", defect: "ATTRIBUTION_MISSING" });

  const title = site.checks.title;
  if (title.status === "fail") push(title);

  const video = site.checks.video;
  if (video.status === "fail") push(video);
  else if (video.status === "warn") rows.push({ check: "hero-video-note", status: "note", deduction: 0, label: video.notes[0] || "fallback-only hero video" });

  const deduction = rows.reduce((sum, row) => sum + row.deduction, 0);
  return { score: Math.max(0, 100 - deduction), rows };
}

// ---------------------------------------------------------------------------
// Site walk
// ---------------------------------------------------------------------------

async function auditSite(url, options, fetchImpl = fetch) {
  const site = { url, slug: slugFromUrl(url) };
  try {
    const page = await fetchText(url, options.timeoutMs, fetchImpl);
    if (!page.ok || !/text\/html|application\/xhtml/i.test(page.contentType)) {
      site.fetchError = `GET ${url} -> ${page.status} (${page.contentType || "no content-type"})`;
      return site;
    }
    const html = page.body;
    site.htmlKb = Math.round(Buffer.byteLength(html, "utf8") / 102.4) / 10;

    const cssUrls = linkedStylesheetUrls(html, url).filter((u) => {
      try {
        return new URL(u).hostname === new URL(url).hostname;
      } catch {
        return false;
      }
    });
    const cssChunks = [inlineStyleText(html)];
    site.cssFetched = [];
    for (const cssUrl of cssUrls.slice(0, 6)) {
      try {
        const css = await fetchText(cssUrl, options.timeoutMs, fetchImpl);
        if (css.ok) {
          cssChunks.push(css.body);
          site.cssFetched.push(cssUrl);
        }
      } catch {
        /* one dead stylesheet must not kill the audit */
      }
    }
    const cssText = cssChunks.join("\n");

    const expect = options.expects[site.slug] || {};
    site.checks = {
      fonts: detectFonts({ html, cssText, expectFonts: expect.fonts || null }),
      accent: detectAccent(cssText, expect.accent || null),
      hero: detectHeroText(html),
      images: imageCensus(html, url, options.firstImageKb),
      logo: detectLogo(html),
      hygiene: detectLegalHygiene(html),
      title: detectTitleSanity(html),
      video: detectHeroVideo(html),
    };
  } catch (error) {
    site.fetchError = `${error.name === "AbortError" ? "timeout" : "fetch error"}: ${error.message}`;
  }
  return site;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function rankAndScore(sites) {
  return sites
    .map((site) => {
      const { score, rows } = scoreSite(site);
      return { ...site, score, rows };
    })
    .sort((a, b) => a.score - b.score || a.slug.localeCompare(b.slug));
}

function frequencyRollup(sites) {
  const counts = new Map();
  for (const site of sites) {
    for (const row of site.rows) {
      if (row.deduction <= 0) continue;
      const key = row.check.replace(/\s*\(.*/, "");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function renderTable(ranked) {
  const lines = [];
  const width = Math.max(...ranked.map((s) => s.slug.length), 8);
  lines.push("");
  lines.push("FLEET AUDIT — ranked worst first (0-100)");
  lines.push("=".repeat(width + 46));
  lines.push(`${"SITE".padEnd(width)}  SCORE  TOP DEFECTS`);
  lines.push("-".repeat(width + 46));
  for (const site of ranked) {
    const defects = site.rows.filter((r) => r.deduction > 0).map((r) => r.check).join(", ");
    const mark = site.score >= 90 ? "" : site.score >= 70 ? "~" : "!";
    lines.push(`${site.slug.padEnd(width)}  ${mark}${String(site.score).padStart(3)}   ${defects || "(clean)"}`);
  }
  const avg = Math.round(ranked.reduce((s, x) => s + x.score, 0) / Math.max(1, ranked.length));
  lines.push("-".repeat(width + 46));
  lines.push(`fleet average: ${avg}/100 across ${ranked.length} sites`);
  return lines.join("\n");
}

function renderDefectDetails(ranked) {
  const lines = ["", "DEFECT DETAIL (deductions only)"];
  for (const site of ranked) {
    const rows = site.rows.filter((r) => r.deduction > 0);
    if (!rows.length) continue;
    lines.push(`  ${site.slug}  (${site.score})`);
    for (const row of rows) {
      lines.push(`    -${String(row.deduction).padStart(3)}  ${row.label}${row.check !== row.label ? `  [${row.check}]` : ""}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let urls = options.urls;
  let source = "argv";
  if (!urls.length) {
    urls = readStdinUrls();
    if (urls.length) source = "stdin";
  }
  if (!urls.length) {
    const store = await urlsFromStore();
    if (store.ok) {
      urls = store.urls;
      source = `durable store (${urls.length} preview_urls)`;
    } else {
      urls = DEFAULT_SLUGS.map(MIRROR_URL_PATTERN);
      source = `static campaign-9 list (store unavailable: ${store.reason})`;
    }
  }
  urls = [...new Set(urls.map((u) => (/^https?:\/\//i.test(u) ? u : MIRROR_URL_PATTERN(u.replace(/\/+$/, "")))))];

  console.error(`auditing ${urls.length} mirrors (source: ${source})`);

  // Bounded parallelism: never more than 5 concurrent hosts.
  const queue = [...urls];
  const sites = [];
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      sites.push(await auditSite(url, options));
      process.stderr.write(".");
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, urls.length) }, worker));
  process.stderr.write("\n");

  const ranked = rankAndScore(sites);
  const report = {
    generatedAt: new Date().toISOString(),
    source,
    firstImageKbThreshold: options.firstImageKb,
    average: Math.round(ranked.reduce((s, x) => s + x.score, 0) / Math.max(1, ranked.length)),
    sites: ranked.map((site) => ({
      slug: site.slug,
      url: site.url,
      score: site.score,
      fetchError: site.fetchError || null,
      htmlKb: site.htmlKb || null,
      primaryFont: site.checks?.fonts?.primary || null,
      dominantAccent: site.checks?.accent?.dominant || null,
      hero: site.checks?.hero
        ? { source: site.checks.hero.source, status: site.checks.hero.status, text: site.checks.hero.text }
        : null,
      images: site.checks?.images
        ? {
            total: site.checks.images.total,
            unique: site.checks.images.unique,
            duplicateCount: site.checks.images.duplicates.length,
            firstClientImage: site.checks.images.firstClientImage,
          }
        : null,
      logo: site.checks?.logo?.status || null,
      noindex: site.checks?.hygiene?.noindex ?? null,
      attribution: site.checks?.hygiene?.attribution ?? null,
      title: site.checks?.title?.title || null,
      heroVideo: site.checks?.video
        ? { present: site.checks.video.status !== "fail", clientClip: !!site.checks.video.clientClip, sources: site.checks.video.sources }
        : null,
      rows: site.rows,
    })),
    defectFrequency: frequencyRollup(ranked).map(([check, count]) => ({ check, sites: count })),
  };

  console.log(renderTable(ranked));
  console.log(renderDefectDetails(ranked));
  const top = report.defectFrequency.slice(0, 3);
  if (top.length) {
    console.log(`\nFLEET-WIDE TOP DEFECTS: ${top.map((d) => `${d.check} x${d.sites}`).join(" | ")}`);
  }
  console.log(`\n${JSON.stringify(report, null, 1)}`);

  if (options.jsonOut) {
    const p = path.isAbsolute(options.jsonOut) ? options.jsonOut : path.join(__dirname, "..", options.jsonOut);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(report, null, 1));
    console.error(`\nwrote ${p}`);
  }
  // A report, never a gate — and NO process.exit() here: an explicit exit can
  // truncate a large stdout write still sitting in the pipe.
}

module.exports = {
  // detectors (pure — pinned by test/fleet-audit.test.js)
  collectGoogleFontFamilies,
  collectAtFaceFamilies,
  effectiveDisplayFont,
  detectFonts,
  detectAccent,
  cssFormsOfAccent,
  hexToHslTriplet,
  declaredTriplets,
  tripletNear,
  detectHeroText,
  collectImageRefs,
  isClientBankImage,
  imageCensus,
  detectLogo,
  detectLegalHygiene,
  detectTitleSanity,
  detectHeroVideo,
  scoreSite,
  rankAndScore,
  // plumbing
  parseArgs,
  slugFromUrl,
  linkedStylesheetUrls,
  inlineStyleText,
  MIRROR_URL_PATTERN,
  DEFAULT_SLUGS,
  DEFECTS,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 0; // a report, never a gate — even a crash must not block CI
  });
}
