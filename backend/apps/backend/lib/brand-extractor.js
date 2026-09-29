"use strict";

/**
 * lib/brand-extractor.js — brand identity from ANY website, not just the ones
 * that ship CSS custom properties.
 *
 * THE FAILURE THIS EXISTS FOR (Hurricane Fence, 2026-09): hurricanefenceinc.com
 * is a WordPress site whose brand is unmistakable — #e31e24 red used 8x, a
 * white theme-color, a real logo at wp-content/uploads/2026/05/screenshot.webp —
 * and the shipped mirror still wore the fencing-sterling donor's dark navy and
 * gold with no logo. The extraction paths that ran before this module all
 * needed a signal the site did not carry: a measurable logo raster (the mark is
 * a WebP and ffmpeg is absent from the serverless runtime, so measureAccent
 * returns null and the held mark was refused), or Firecrawl branding, or CSS
 * custom properties in a shape the old scrapers recognised. Every plain
 * WordPress / Wix / Squarespace site fails the same way, because the one place
 * their brand ALWAYS lives — the page's own HTML and CSS — was never counted.
 *
 * THE LAYERED STRATEGY (first strong signal wins, and they corroborate):
 *
 *   1. META THEME-COLOR — <meta name="theme-color" content="...">. The fastest,
 *      most reliable single signal a page offers. Frequently neutral (#ffffff),
 *      which is itself useful: it is the BACKGROUND, not the accent.
 *   2. CSS COLOR FREQUENCY — every hex / rgb() / hsl() colour in every inline
 *      <style> block, every style="" attribute (how Wix paints), and up to
 *      `cssLimit` linked stylesheets (how WordPress ships wp-content theme CSS
 *      and how a Vite/React SPA ships its compiled bundle) is counted, and the
 *      most frequent NON-NEUTRAL colour is the brand accent. Neutrals —
 *      #fff, #000, grays, near-white tints, near-black shades — are excluded by
 *      chroma and HSL saturation, because a page that says #fff forty times is
 *      telling you its paper is white, not that its brand is white.
 *   3. LOGO — an <img> whose class/id/alt/title/src says "logo" (header/nav
 *      placements outrank the rest), else the first <img> inside <header>,
 *      else the favicon ladder (apple-touch-icon, then icon). The URL is a
 *      CANDIDATE: it still runs the miner's ownsLogo / denylist / sniff /
 *      measure pipeline before it ever ships (provenance never weakened).
 *   4. FONT — the Google Fonts <link> family, else the most frequently
 *      declared non-generic font-family in the CSS pool (icon fonts excluded;
 *      dashicons is not a brand).
 *
 * WHAT COMES BACK: { accent_color, secondary_color, background, logo_url,
 * font_family, extraction_method, confidence } with confidence HIGH (theme-
 * color and CSS analysis agree), MEDIUM (one independent signal), LOW (nothing
 * found — the caller keeps its neutral/vertical fallback and says so). The
 * shape is exactly the mirror-request schema's brand_identity, whose render
 * side lives in theme.normalizeBrandIdentity: HIGH and MEDIUM are applied and
 * override the donor's default palette; LOW is refused there and the build
 * takes the neutral path — so this module reports LOW honestly rather than
 * dressing absence up as a colour.
 *
 * Server-side, no browser, zero npm deps: fetch the HTML, hand it here with an
 * optional bounded fetchCss callback for linked stylesheets.
 *
 * THE HTML-ENTITY TRAP, because it has already bitten an analysis of this very
 * fixture: `Fences &#038; Decks` is how WordPress writes an ampersand, and a
 * naive /#[0-9a-f]{3,8}/g reads `&#038;` as the colour #038. The scanner
 * refuses any # immediately preceded by `&`, so an entity can never be
 * promoted to a brand colour.
 */

const { hexToHsl, hslToHex, relativeLuminance } = require("./mirror-engine/theme");

// ---------------------------------------------------------------------------
// colour primitives
// ---------------------------------------------------------------------------

const HEX_RE = /(?<!&)#([0-9a-fA-F]{3,8})\b/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi;
const HSL_RE = /hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/gi;

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex({ r, g, b }) {
  const c = (v) => clampByte(v).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/**
 * Any CSS colour spelling this page might use — #abc, #abcd, #aabbcc,
 * #aabbccdd, rgb(), rgba(), hsl(), hsla() — into one comparable #RRGGBB.
 * Alpha is dropped (a 12% glass tint is not a brand accent); anything
 * unparseable becomes "".
 */
function normalizeCssColor(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const hash = /^#([0-9a-fA-F]{3,8})$/.exec(value);
  if (hash) {
    const h = hash[1];
    if (h.length === 3 || h.length === 4) {
      return rgbToHex({ r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) });
    }
    if (h.length === 6 || h.length === 8) {
      return `#${h.slice(0, 6).toUpperCase()}`;
    }
    return "";
  }
  const rgb = RGB_RE.exec(value);
  if (rgb) return rgbToHex({ r: +rgb[1], g: +rgb[2], b: +rgb[3] });
  const hsl = HSL_RE.exec(value);
  if (hsl) {
    const hex = hslToHex({ h: ((Number(hsl[1]) % 360) + 360) % 360, s: Math.min(100, Number(hsl[2])), l: Math.min(100, Number(hsl[3])) });
    RGB_RE.lastIndex = 0; HSL_RE.lastIndex = 0;
    return hex;
  }
  RGB_RE.lastIndex = 0; HSL_RE.lastIndex = 0;
  return "";
}

/** Hue distance in degrees, 0..180. */
function hueDistance(a, b) {
  const ha = hexToHsl(a), hb = hexToHsl(b);
  if (!ha || !hb) return 180;
  const d = Math.abs(ha.h - hb.h) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * THE NEUTRAL WALL. A colour is "neutral" — paper, ink, a hairline, a shadow —
 * when its RGB chroma is too small for a recognisable brand hue, or when HSL
 * saturation agrees it is a grey. Both floors exist because HSL saturation
 * alone lies at the lightness extremes: #f8f5f1 measures s≈33% while its RGB
 * spread is 7/255 — a tint, not a brand.
 */
function isNeutralColor(hex, { maxChroma = 24, maxSaturation = 15 } = {}) {
  const h = /^#[0-9a-fA-F]{6}$/.test(String(hex || "")) ? hex : null;
  if (!h) return true;
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  if (Math.max(r, g, b) - Math.min(r, g, b) < maxChroma) return true;
  const hsl = hexToHsl(h);
  return !hsl || hsl.s < maxSaturation;
}

function isLightColor(hex, { minLightness = 88 } = {}) {
  const hsl = hexToHsl(hex);
  return !!hsl && hsl.l >= minLightness;
}

// ---------------------------------------------------------------------------
// WordPress ships this exact preset duotone set (wp-includes/classic-theme or
// a default theme.json) on nearly every uncustomised install. Each appears
// once or twice in the block library CSS while the REAL brand colour usually
// outranks it — but on a thin page a preset can tie or beat a single-use brand
// colour, so presets are DEMOTED (half weight) rather than trusted at face
// value. Transcribed from the Hurricane Fence fixture's own inline styles.
// ---------------------------------------------------------------------------
const KNOWN_THEME_PRESETS = new Set([
  "#F78DA7", "#CF2E2E", "#FF6900", "#FCB900", "#7BDCB5", "#00D084",
  "#8ED1FC", "#0693E3", "#ABB8C3", "#313131", "#020381", "#2874FC",
  "#34E2E4", "#4721FB", "#AB1DFE", "#FAACA8", "#DAD0EC", "#FAFAE1",
  "#67A671", "#FDD79A", "#004A59", "#330968", "#31CDCF", "#EEE",
]);

// ---------------------------------------------------------------------------
// CSS + HTML collection
// ---------------------------------------------------------------------------

/** Inline <style> blocks, with HTML/XML wrapper noise stripped. */
function collectStyleBlocks(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    out.push(m[1].replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[|\]\]>/g, ""));
  }
  return out;
}

/** Every style="..." attribute — how Wix and page-builders actually paint. */
function collectInlineStyleAttrs(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    out.push(m[2] !== undefined ? m[2] : m[3]);
  }
  return out;
}

/** CSS comments and @font-face base64 blobs carry no brand signal and a lot of bytes. */
function stripCssNoise(css) {
  return String(css || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\(\s*["']?data:[^)]*["']?\s*\)/gi, "url(data:stripped)")
    .slice(0, 1_000_000);
}

/** Absolute https hrefs of linked stylesheets (and preloaded styles), document order. */
function collectStylesheetHrefs(html, baseUrl) {
  const out = [];
  let base = null;
  try { base = new URL(String(baseUrl || "")); } catch { return out; }
  for (const tag of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
    const t = tag[0];
    const rel = /(?:\brel\s*=\s*("([^"]*)"|'([^']*)'))/i.exec(t);
    const relVal = rel ? (rel[2] !== undefined ? rel[2] : rel[3] || "") : "";
    const isSheet = /\bstylesheet\b/i.test(relVal)
      || (/\bpreload\b/i.test(relVal) && /\bas\s*=\s*["']?style["']?/i.test(t));
    if (!isSheet) continue;
    const href = /(?:\bhref\s*=\s*("([^"]*)"|'([^']*)'))/i.exec(t);
    const hrefVal = href ? (href[2] !== undefined ? href[2] : href[3] || "") : "";
    if (!hrefVal) continue;
    try {
      const abs = new URL(hrefVal, base);
      if (abs.protocol !== "https:") continue;
      if (!out.includes(abs.href)) out.push(abs.href);
    } catch { /* unresolvable href — skip */ }
  }
  return out;
}

/**
 * Every colour occurrence in a CSS pool, in document order, as normalized
 * #RRGGBB. The `(?<!&)` guard is the HTML-entity trap: `&#038;` is an
 * ampersand, not the colour #038, and this line is why it can never win.
 */
function extractColors(css) {
  const text = String(css || "");
  const out = [];
  for (const m of text.matchAll(HEX_RE)) {
    const hex = normalizeCssColor(m[0]);
    if (hex) out.push(hex);
  }
  for (const m of text.matchAll(RGB_RE)) {
    out.push(rgbToHex({ r: +m[1], g: +m[2], b: +m[3] }));
  }
  for (const m of text.matchAll(HSL_RE)) {
    out.push(hslToHex({ h: ((Number(m[1]) % 360) + 360) % 360, s: Math.min(100, Number(m[2])), l: Math.min(100, Number(m[3])) }));
  }
  return out;
}

/**
 * Frequency ranking with the neutral wall and the preset demotion applied.
 * Returns [{ hex, count, weight, firstIndex }] sorted by (weight desc,
 * firstIndex asc) — a stable, auditable order.
 */
function rankColors(colors) {
  const seen = new Map();
  (colors || []).forEach((hex, i) => {
    if (!hex) return;
    const entry = seen.get(hex) || { hex, count: 0, firstIndex: i };
    entry.count += 1;
    seen.set(hex, entry);
  });
  const ranked = [...seen.values()].map((e) => ({
    ...e,
    weight: KNOWN_THEME_PRESETS.has(e.hex) ? e.count * 0.5 : e.count,
  }));
  ranked.sort((a, b) => (b.weight - a.weight) || (a.firstIndex - b.firstIndex));
  return ranked;
}

/**
 * The accent and the secondary, from a ranked list. The accent is the loudest
 * chromatic colour. The secondary is the loudest chromatic colour from a
 * DIFFERENT hue family (30deg+ away) — a lighter tint of the accent is the
 * same idea twice, not a second brand colour.
 */
function pickAccentPair(ranked) {
  const chromatic = (ranked || []).filter((e) => !isNeutralColor(e.hex));
  const accent = chromatic[0] || null;
  const secondary = accent
    ? chromatic.find((e) => e.hex !== accent.hex && hueDistance(e.hex, accent.hex) >= 30) || null
    : null;
  return { accent, secondary };
}

// ---------------------------------------------------------------------------
// layer 1 — meta theme-color
// ---------------------------------------------------------------------------

/**
 * <meta name="theme-color"> — the browser-chrome colour the page declares.
 * Pages may ship several (media-queried dark-mode variants); the un-mediated
 * one wins, else the first. "" when the page declares none.
 */
function extractThemeColor(html) {
  let first = "";
  for (const tag of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const t = tag[0];
    if (!/\bname\s*=\s*["']?theme-color["']?/i.test(t)) continue;
    const content = /(?:\bcontent\s*=\s*("([^"]*)"|'([^']*)'))/i.exec(t);
    const value = content ? (content[2] !== undefined ? content[2] : content[3] || "") : "";
    const hex = normalizeCssColor(value);
    if (!hex) continue;
    if (/\bmedia\s*=/i.test(t)) { if (!first) first = hex; continue; }
    return hex;
  }
  return first;
}

// ---------------------------------------------------------------------------
// layer 3 — logo
// ---------------------------------------------------------------------------

const IMG_TAG_RE = /<img\b[^>]*>/gi;

function imgAttr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(tag);
  if (!m) return "";
  return (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || "").trim();
}

function isUsableLogoSrc(src) {
  if (!src) return false;
  if (/^(?:data|blob|javascript):/i.test(src)) return false;
  if (/\b(?:sprite|pixel|1x1|blank|spacer)\b/i.test(src)) return false;
  return true;
}

function resolveLogoCandidate(tag, baseUrl) {
  const src = imgAttr(tag, "src");
  if (!isUsableLogoSrc(src)) return "";
  const w = imgAttr(tag, "width"), h = imgAttr(tag, "height");
  if (w === "1" || h === "1") return ""; // tracking pixel, whatever it claims to be
  try {
    const abs = new URL(src, baseUrl);
    if (abs.protocol !== "https:") return "";
    return abs.href;
  } catch { return ""; }
}

/**
 * Logo candidates, best first. Scoring: class/id/alt/title/src that says
 * "logo" (+4 / +3 / +2), placement inside <header> or <nav> (+2). A tag needs
 * at least one logo signal to outrank the positional fallbacks. After the
 * logo-named images come: the first <img> inside <header>, then the favicon
 * ladder (apple-touch-icon, then icon).
 */
function findLogoCandidates(html, baseUrl) {
  const text = String(html || "");
  const out = [];
  const push = (url) => { if (url && !out.includes(url)) out.push(url); };

  const headerRegions = [
    ...[...text.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi)].map((m) => m[1]),
    ...[...text.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi)].map((m) => m[1]),
  ];

  const scored = [];
  const scan = (region, inHeader) => {
    for (const m of region.matchAll(IMG_TAG_RE)) {
      const tag = m[0];
      const url = resolveLogoCandidate(tag, baseUrl);
      if (!url) continue;
      const cls = `${imgAttr(tag, "class")} ${imgAttr(tag, "id")}`;
      const label = `${imgAttr(tag, "alt")} ${imgAttr(tag, "title")}`;
      const src = imgAttr(tag, "src");
      let score = 0;
      if (/\blogo\b|\blogo[-_a-z0-9]*\b|logo/i.test(cls)) score = Math.max(score, 4);
      if (/logo/i.test(label)) score = Math.max(score, 3);
      if (/logo/i.test(src)) score = Math.max(score, 2);
      if (inHeader) score += 2;
      if (score >= 2) scored.push({ url, score, index: scored.length });
    }
  };
  const headStart = scored.length;
  for (const region of headerRegions) scan(region, true);
  const headerScored = scored.slice(headStart);
  scan(text, false);

  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  for (const c of scored) push(c.url);

  // Positional fallbacks, in the task's order: first <img> inside <header>,
  // then apple-touch-icon, then icon.
  for (const region of headerRegions) {
    for (const m of region.matchAll(IMG_TAG_RE)) {
      push(resolveLogoCandidate(m[0], baseUrl));
      break;
    }
  }
  const iconHref = (wantApple) => {
    for (const tag of text.matchAll(/<link\b[^>]*>/gi)) {
      const t = tag[0];
      const rel = /(?:\brel\s*=\s*("([^"]*)"|'([^']*)'))/i.exec(t);
      const relVal = rel ? (rel[2] !== undefined ? rel[2] : rel[3] || "") : "";
      const isApple = /\bapple-touch-icon\b/i.test(relVal);
      const isIcon = /(^|\s)(?:shortcut\s+)?icon(\s|$)/i.test(relVal.trim());
      if (wantApple !== isApple) continue;
      if (!isApple && !isIcon) continue;
      const href = /(?:\bhref\s*=\s*("([^"]*)"|'([^']*)'))/i.exec(t);
      const hrefVal = href ? (href[2] !== undefined ? href[2] : href[3] || "") : "";
      if (!hrefVal) continue;
      try {
        const abs = new URL(hrefVal, baseUrl);
        if (abs.protocol === "https:") return abs.href;
      } catch { /* skip */ }
    }
    return "";
  };
  push(iconHref(true));
  push(iconHref(false));
  return out;
}

function extractLogoUrl(html, baseUrl) {
  const candidates = findLogoCandidates(html, baseUrl);
  return candidates.length ? candidates[0] : "";
}

// ---------------------------------------------------------------------------
// layer 4 — font
// ---------------------------------------------------------------------------

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji",
  "fangsong", "inherit", "initial", "unset", "-apple-system",
]);
const ICON_FONT_RE = /(?:icon|awesome|glyph|dashicon|genericon|material|fontello)/i;

function cleanFamilyName(raw) {
  const name = String(raw || "").split(",")[0].trim().replace(/^['"]+|['"]+$/g, "").trim();
  if (!name || name.startsWith("-")) return "";
  if (GENERIC_FAMILIES.has(name.toLowerCase())) return "";
  if (ICON_FONT_RE.test(name)) return "";
  // The mirror-request schema caps font_family at 60 and the engine's
  // brandIdentityFont allowlist refuses anything longer — same number, both
  // doors.
  return name.slice(0, 60);
}

/**
 * The page's primary display/body family: the Google Fonts <link> family when
 * one is declared (the strongest, most intentional signal), else the most
 * frequently declared non-generic font-family across the CSS pool. "" when the
 * page publishes nothing usable — the caller keeps its own typography rather
 * than guessing.
 */
function extractFontFamily({ html = "", cssTexts = [] } = {}) {
  const google = /fonts\.googleapis\.com\/css(?:2)?\?[^"'\s>]*family=([A-Za-z0-9+_%.-]+)/i.exec(String(html || ""));
  if (google) {
    const name = decodeURIComponent(google[1].replace(/\+/g, " ")).split(":")[0].trim();
    const cleaned = cleanFamilyName(name);
    if (cleaned) return cleaned;
  }
  const counts = new Map();
  for (const css of cssTexts) {
    for (const m of String(css || "").matchAll(/(?:^|[^-])font-family\s*:\s*([^;{}]+)/gi)) {
      const family = cleanFamilyName(m[1]);
      if (!family) continue;
      counts.set(family, (counts.get(family) || 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : "";
}

// ---------------------------------------------------------------------------
// the extractor
// ---------------------------------------------------------------------------

const MAX_TOTAL_CSS_BYTES = 2_000_000;

/**
 * extractBrandIdentity — the module's one entry point.
 *
 * @param {object} input
 *   html      (required) the prospect's homepage HTML
 *   baseUrl   (required) the URL it was fetched from (resolves relative URLs)
 *   cssTexts  optional array of already-fetched stylesheet text
 *   fetchCss  optional async (href) => cssText — enables linked-stylesheet
 *             fetching (WordPress wp-content CSS, Squarespace site.css, a
 *             Vite/React SPA's compiled bundle)
 *   cssLimit  max linked stylesheets fetched when fetchCss is given (default 4)
 *
 * Returns the structured brand_identity object plus `signals` (per-layer
 * evidence for the record) and `css_fetches` for the cost ledger. Never
 * throws for absence: an empty page yields the LOW-confidence neutral result.
 */
async function extractBrandIdentity({
  html = "",
  baseUrl = "",
  cssTexts = [],
  fetchCss = null,
  cssLimit = 4,
} = {}) {
  const result = {
    accent_color: "",
    secondary_color: "",
    background: "",
    logo_url: "",
    font_family: "",
    extraction_method: "fallback_neutral",
    confidence: "LOW",
    extracted_from: String(baseUrl || ""),
    css_fetches: 0,
    signals: {},
  };
  if (!html || typeof html !== "string") return result;

  // ---- gather the CSS pool ------------------------------------------------
  const styleBlocks = collectStyleBlocks(html).map(stripCssNoise);
  const styleAttrs = [collectInlineStyleAttrs(html).join(";")];
  const linked = [];
  if (typeof fetchCss === "function" && cssLimit > 0) {
    const hrefs = collectStylesheetHrefs(html, baseUrl).slice(0, cssLimit);
    const settled = await Promise.allSettled(hrefs.map((href) => fetchCss(href)));
    for (const s of settled) {
      if (s.status === "fulfilled" && typeof s.value === "string" && s.value) {
        linked.push(stripCssNoise(s.value));
        result.css_fetches += 1;
      }
    }
  }
  const cssPool = [];
  let budget = MAX_TOTAL_CSS_BYTES;
  for (const css of [...styleBlocks, ...cssTexts.map(stripCssNoise), ...linked, ...styleAttrs]) {
    if (budget <= 0) break;
    const slice = css.length > budget ? css.slice(0, budget) : css;
    budget -= slice.length;
    cssPool.push(slice);
  }
  const poolText = cssPool.join("\n");

  // ---- layer 1: theme-color ----------------------------------------------
  const themeColor = extractThemeColor(html);
  const themeNeutral = !themeColor || isNeutralColor(themeColor);

  // ---- layer 2: CSS frequency --------------------------------------------
  const ranked = rankColors(extractColors(poolText));
  const { accent, secondary } = pickAccentPair(ranked);
  const backgroundFallback = ranked.find((e) => isNeutralColor(e.hex) && isLightColor(e.hex));

  result.background = themeColor || (backgroundFallback ? backgroundFallback.hex : "");

  let cssAccent = accent ? accent.hex : "";
  if (cssAccent && themeColor && !themeNeutral && hueDistance(cssAccent, themeColor) < 30 && (accent.weight < themeWeightOf(themeColor, ranked))) {
    // A non-neutral theme-color that OUTRANKS the whole CSS pool is the more
    // intentional declaration; prefer it when they are the same hue family.
    cssAccent = themeColor;
  }

  if (cssAccent) {
    result.accent_color = cssAccent;
    result.secondary_color = secondary ? secondary.hex : "";
  } else if (themeColor && !themeNeutral) {
    result.accent_color = themeColor;
  }

  // ---- confidence ---------------------------------------------------------
  const accentFromCss = Boolean(accent);
  if (result.accent_color && accentFromCss && themeColor && !themeNeutral
    && hueDistance(result.accent_color, themeColor) < 30) {
    result.confidence = "HIGH";
    result.extraction_method = "theme_color+css_frequency";
  } else if (result.accent_color) {
    result.confidence = "MEDIUM";
    result.extraction_method = accentFromCss ? "css_frequency" : "theme_color";
  } else {
    result.confidence = "LOW";
    result.extraction_method = "fallback_neutral";
  }

  // ---- layer 3: logo ------------------------------------------------------
  result.logo_url = extractLogoUrl(html, baseUrl);

  // ---- layer 4: font ------------------------------------------------------
  result.font_family = extractFontFamily({ html, cssTexts: cssPool });

  // ---- evidence for the record -------------------------------------------
  result.signals = {
    theme_color: themeColor,
    css_colors_counted: ranked.reduce((n, e) => n + e.count, 0),
    css_colors_distinct: ranked.length,
    accent_count: accent ? accent.count : 0,
    secondary_count: secondary ? secondary.count : 0,
    logo_candidates: findLogoCandidates(html, baseUrl).length,
  };
  return result;
}

/** Weight of the ranked entry matching `hex` (0 when absent). */
function themeWeightOf(hex, ranked) {
  const hit = (ranked || []).find((e) => e.hex === hex);
  return hit ? hit.weight : 0;
}

module.exports = {
  extractBrandIdentity,
  // layers, exported individually for tests and for callers that need one
  extractThemeColor,
  extractLogoUrl,
  findLogoCandidates,
  extractFontFamily,
  extractColors,
  rankColors,
  pickAccentPair,
  collectStyleBlocks,
  collectInlineStyleAttrs,
  collectStylesheetHrefs,
  // colour primitives (theme.js-derived, re-exported for test ergonomics)
  normalizeCssColor,
  isNeutralColor,
  isLightColor,
  hueDistance,
  relativeLuminance,
};
