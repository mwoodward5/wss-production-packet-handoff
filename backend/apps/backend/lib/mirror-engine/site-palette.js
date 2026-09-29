"use strict";

/**
 * lib/mirror-engine/site-palette.js — the client's WHOLE WEBSITE palette, not
 * just their logo's.
 *
 * OWNER DIRECTIVE (2026-09-03): "we want to take THEIR SITE colors not just
 * their LOGO colors — that's what I think is going on." The engine derived the
 * client palette primarily from the harvested logo (stage 4_brand_logo_and_
 * accent measures the mark's pixels), so a warm-cream plumbing site with a
 * cool-blue logo rebuilt as a cold blue page, and a dark-navy site rebuilt as
 * near-white with pale tints. Brand fidelity means the rebuild wears THEIR
 * look: the surfaces, the ink, the accent usage and the dark-section rhythm
 * their own homepage actually paints — with the logo as ONE input (accent
 * corroboration), never the only one.
 *
 * PURE EXTRACTION, ZERO NETWORK. The homepage HTML is already in hand at
 * 2_homepage_fetch; this module reads inline <style> blocks, style=""
 * attributes (how Wix and the page-builders actually paint), and any
 * stylesheet texts the caller ALREADY fetched for the brand-extraction lane
 * (lib/brand-extractor.js fetches up to 4 of the page's own stylesheets —
 * the two extractors now SHARE those fetches, so adding the site palette
 * costs zero additional network). When no stylesheets were fetched the
 * extraction simply runs on the inline evidence and reports what it saw.
 *
 * WHAT IT MEASURES:
 *   · canvas/surface — the page's own paper: <body> background, the
 *     meta theme-color, else the most frequent light background the page
 *     paints on its sections.
 *   · ink — the page's own text colour: <body> color, else the most
 *     frequent dark colour used as text.
 *   · link/accent — the chromatic colour the page spends most (frequency
 *     over the whole CSS pool, saturation-floored like every accent lane in
 *     this engine), plus the declared anchor colour when present.
 *   · slab presence — how many genuinely dark background declarations the
 *     page carries (its full-bleed bands), vs light ones. A light site with
 *     dark bands keeps its rhythm in the rebuild instead of being flattened.
 *
 * Absence stays absence: a page that declares nothing readable yields
 * ok:false with a reason, and the palette falls back to the logo lane
 * exactly as before (thin-flow law — this extraction gates nothing).
 */

const { normalizeHex, hexToHsl, hslToHex, relativeLuminance } = require("./theme");

// The same saturation floor brand-harvest's collectAccentHexes holds a CSS
// accent to: below 25% HSL saturation a colour is paper, ink or a hairline,
// not a brand accent.
const ACCENT_SATURATION_FLOOR = 25;

// How dark a background declaration must be to count as a SLAB (full-bleed
// band). Mirrors theme.js darkCustomProperties' hex threshold (luminance
// <= 0.05) with a little headroom for slightly raised dark panels.
const DARK_SLAB_MAX_LUMINANCE = 0.08;

// How light a background declaration must be to count as a light section.
const LIGHT_SECTION_MIN_LUMINANCE = 0.55;

// The light/dark canvas line theme.decideMode already holds for extraction
// backgrounds (brand_identity and now site_palette use the same number).
const DARK_CANVAS_MAX_LUMINANCE = 0.4;

/** Every CSS colour spelling — via theme's hex normalizer plus rgb()/hsl(). */
const HEX_RE = /(?<!&)#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi;
const HSL_RE = /hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/gi;

function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** One comparable #RRGGBB from any spelling a homepage actually uses. */
function toHex(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const short = normalizeHex(value);
  if (short) return short;
  const rgb = RGB_RE.exec(value);
  if (rgb) { RGB_RE.lastIndex = 0; return rgbToHex({ r: +rgb[1], g: +rgb[2], b: +rgb[3] }); }
  const hsl = HSL_RE.exec(value);
  if (hsl) {
    RGB_RE.lastIndex = 0; HSL_RE.lastIndex = 0;
    const sat = Math.min(100, Number(hsl[2]));
    const lig = Math.min(100, Number(hsl[3]));
    // hexToHsl/hslToHex round-trip through theme's own maths.
    return hslToHex({ h: ((Number(hsl[1]) % 360) + 360) % 360, s: sat, l: lig });
  }
  RGB_RE.lastIndex = 0; HSL_RE.lastIndex = 0;
  return "";
}

function saturationPercent(hex) {
  const hsl = hexToHsl(hex);
  return hsl ? hsl.s : 0;
}

/** Inline <style> blocks, wrapper noise stripped. */
function collectStyleBlocks(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    out.push(m[1].replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[|\]\]>/g, ""));
  }
  return out;
}

/** Every style="..." attribute's declaration text, in document order. */
function collectStyleAttrDeclarations(html) {
  const parts = [];
  for (const m of String(html || "").matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    parts.push(m[1] !== undefined ? m[1] : m[2] || "");
  }
  return parts;
}

/**
 * A deliberately small tolerant rule parser — the same contract
 * brand-harvest's parseCssRules holds: selector + body for simple
 * (non-nested, non-at-rule) declarations, which is what inline styles and
 * page-builder CSS actually are.
 */
function parseCssRules(css) {
  const rules = [];
  const clean = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(clean)) !== null) {
    const selector = match[1].trim();
    const body = match[2].trim();
    if (!selector || !body) continue;
    if (selector.startsWith("@")) continue;
    rules.push({ selector, body });
  }
  return rules;
}

/** First declared value of `property` in a rule body, or null. */
function cssProperty(body, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;!}]+)`, "i").exec(String(body || ""));
  return m ? m[1].trim() : null;
}

function selectorHasElement(selector, element) {
  const escaped = element.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zA-Z0-9_-])${escaped}(?=$|[^a-zA-Z0-9_-])`, "i").test(String(selector || ""));
}

/** The colour of a background declaration, skipping image/gradient paints. */
function backgroundHex(value) {
  const v = String(value || "");
  // A url() or a gradient() is an image paint, not a flat surface; reading a
  // colour out of one would call a photograph's fallback the page's paper.
  if (/url\(|gradient\(/i.test(v)) return "";
  // transparent / fully-alpha'd declarations are not paper.
  if (/transparent/i.test(v)) return "";
  return firstColorIn(v);
}

/** The first colour literal in any declaration value (for `color:` uses). */
function firstColorIn(value) {
  const v = String(value || "");
  for (const m of v.matchAll(HEX_RE)) {
    const hex = toHex(m[0]);
    if (hex) return hex;
  }
  const rgb = RGB_RE.exec(v);
  if (rgb) { RGB_RE.lastIndex = 0; return rgbToHex({ r: +rgb[1], g: +rgb[2], b: +rgb[3] }); }
  const hsl = HSL_RE.exec(v);
  if (hsl) {
    RGB_RE.lastIndex = 0; HSL_RE.lastIndex = 0;
    return hslToHex({ h: ((Number(hsl[1]) % 360) + 360) % 360, s: Math.min(100, Number(hsl[2])), l: Math.min(100, Number(hsl[3])) });
  }
  RGB_RE.lastIndex = 0; HSL_RE.lastIndex = 0;
  return "";
}

/** <meta name="theme-color"> — the site's own claim about its chrome. */
function themeColorFromHtml(html) {
  for (const tag of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const t = tag[0];
    if (!/\bname\s*=\s*["']?theme-color["']?/i.test(t)) continue;
    const content = /(?:\bcontent\s*=\s*("([^"]*)"|'([^']*)'))/i.exec(t);
    const value = content ? (content[2] !== undefined ? content[2] : content[3] || "") : "";
    const hex = toHex(value);
    if (hex) return hex;
  }
  return "";
}

/** The <body> tag's own style="" background/color, when present. */
function bodyTagStyleColors(html) {
  const m = /<body\b[^>]*\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(String(html || ""));
  if (!m) return {};
  const css = m[1] !== undefined ? m[1] : m[2] || "";
  const bg = cssProperty(css, "background-color") || cssProperty(css, "background");
  const color = cssProperty(css, "color");
  return {
    background: bg ? backgroundHex(bg) : "",
    color: color ? firstColorIn(color) : "",
  };
}

/**
 * Frequency rank of every chromatic colour in a CSS pool: count desc, then
 * first-seen order — the same stable order brand-harvest's collectAccentHexes
 * uses, with the entity guard `(?<!&)` so `&#038;` can never become #038.
 *
 * ACCENT CANDIDATES ALSO CARRY A LIGHTNESS BAND (the same one the miner's
 * usableSiteAccent holds a declared site colour to): a near-black navy and a
 * near-white tint are both highly saturated in HSL terms, but they are SLABS
 * and PAPER, not accents — a dark-navy site whose identity is navy + gold must
 * rank its gold as the accent, not the hero band it paints once. Surface, ink
 * and slab detection read those colours through their own doors; this band
 * governs the accent role only.
 */
function rankChromaticColors(cssPool) {
  const counts = new Map();
  const firstSeen = new Map();
  let sequence = 0;
  const add = (hex) => {
    if (!hex || saturationPercent(hex) < ACCENT_SATURATION_FLOOR) return;
    const hsl = hexToHsl(hex);
    if (hsl && (hsl.l < 18 || hsl.l > 85)) return;
    counts.set(hex, (counts.get(hex) || 0) + 1);
    if (!firstSeen.has(hex)) firstSeen.set(hex, sequence++);
  };
  const text = String(cssPool || "");
  for (const m of text.matchAll(HEX_RE)) add(toHex(m[0]));
  const rgbRe = new RegExp(RGB_RE.source, "gi");
  for (const m of text.matchAll(rgbRe)) add(rgbToHex({ r: +m[1], g: +m[2], b: +m[3] }));
  const hslRe = new RegExp(HSL_RE.source, "gi");
  for (const m of text.matchAll(hslRe)) {
    add(hslToHex({ h: ((Number(m[1]) % 360) + 360) % 360, s: Math.min(100, Number(m[2])), l: Math.min(100, Number(m[3])) }));
  }
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count, firstSeen: firstSeen.get(hex) }))
    .sort((a, b) => (b.count - a.count) || (a.firstSeen - b.firstSeen));
}

/**
 * extractSitePalette — the module's one entry point.
 *
 * @param {object} input
 *   html     the prospect's homepage HTML (already fetched at 2_homepage_fetch)
 *   cssTexts stylesheet texts the caller ALREADY fetched (shared with the
 *            brand-extraction lane) — this function never touches the network
 *   baseUrl  provenance only: recorded as extracted_from
 *
 * Returns { ok, surface, ink, link, accent, mode, hasDarkSlabs,
 * darkSectionCount, lightSectionCount, extractedFrom, extractionMethod,
 * signals }. Never throws; unreadable input is ok:false plus a reason.
 */
function extractSitePalette({ html = "", cssTexts = [], baseUrl = "" } = {}) {
  const result = {
    ok: false,
    reason: "",
    surface: "",
    ink: "",
    link: "",
    accent: "",
    mode: "light",
    hasDarkSlabs: false,
    darkSectionCount: 0,
    lightSectionCount: 0,
    extractedFrom: String(baseUrl || ""),
    extractionMethod: "site_html_css",
    signals: {},
  };
  try {
    const source = String(html || "");
    if (!source.trim()) {
      result.reason = "no_html";
      return result;
    }

    const styleBlocks = collectStyleBlocks(source);
    const styleAttrs = collectStyleAttrDeclarations(source);
    const styleAttrText = styleAttrs.join(";");
    const pool = [...styleBlocks, ...cssTexts.map(String)].join("\n");
    // Style attributes are RULES TOO — how Wix and the page-builders actually
    // paint. Their declarations are bare (no selector/braces), so each one
    // becomes a pseudo-rule the background/ink/link walks below can read; the
    // <body> tag's own attribute keeps its dedicated precedence above them.
    const rules = [
      ...parseCssRules(pool),
      ...styleAttrs.filter(Boolean).map((css) => ({ selector: "[style]", body: css })),
    ];

    // ---- backgrounds: canvas, sections, slabs --------------------------------
    const backgrounds = []; // document-order [{ selector, hex }]
    for (const rule of rules) {
      const declared = cssProperty(rule.body, "background-color") || cssProperty(rule.body, "background");
      const hex = declared ? backgroundHex(declared) : "";
      if (hex) backgrounds.push({ selector: rule.selector, hex });
    }
    const bodyTag = bodyTagStyleColors(source);

    // CANVAS — the page's own paper, in evidence order: the body element's
    // declared background, the meta theme-color, else the most frequent LIGHT
    // background the page paints (its sections show its paper).
    let surface = bodyTag.background || "";
    let surfaceFrom = "body_style_attribute";
    if (!surface) {
      for (const rule of rules) {
        if (!selectorHasElement(rule.selector, "body") && !selectorHasElement(rule.selector, "html")) continue;
        const declared = cssProperty(rule.body, "background-color") || cssProperty(rule.body, "background");
        const hex = declared ? backgroundHex(declared) : "";
        if (hex) { surface = hex; surfaceFrom = "body_rule"; break; }
      }
    }
    const themeColor = themeColorFromHtml(source);
    if (!surface && themeColor) { surface = themeColor; surfaceFrom = "meta_theme_color"; }
    if (!surface) {
      const lightCounts = new Map();
      for (const bg of backgrounds) {
        if (relativeLuminance(bg.hex) >= 0.7) lightCounts.set(bg.hex, (lightCounts.get(bg.hex) || 0) + 1);
      }
      const best = [...lightCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) { surface = best[0]; surfaceFrom = "frequent_light_background"; }
    }

    // ---- ink ---------------------------------------------------------------
    let ink = bodyTag.color || "";
    let inkFrom = "body_style_attribute";
    if (!ink) {
      for (const rule of rules) {
        if (!selectorHasElement(rule.selector, "body") && !selectorHasElement(rule.selector, "html")) continue;
        const declared = cssProperty(rule.body, "color");
        const hex = declared ? firstColorIn(declared) : "";
        if (hex) { ink = hex; inkFrom = "body_rule"; break; }
      }
    }
    if (!ink) {
      // The most frequent DARK colour the page paints as text — but body
      // copy is near-neutral by nature, so an accent-grade saturated colour
      // (a red used once on a heading link) must not become the ink and
      // vanish from the accent role. A page whose only "text colour" is a
      // saturated red has an accent and an UNKNOWN ink; absence is the
      // honest reading, and the accent keeps its colour.
      const darkCounts = new Map();
      for (const rule of rules) {
        const declared = cssProperty(rule.body, "color");
        const hex = declared ? firstColorIn(declared) : "";
        if (hex && relativeLuminance(hex) <= DARK_CANVAS_MAX_LUMINANCE && saturationPercent(hex) <= 45) {
          darkCounts.set(hex, (darkCounts.get(hex) || 0) + 1);
        }
      }
      const best = [...darkCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) { ink = best[0]; inkFrom = "frequent_dark_text"; }
    }

    // ---- link colour -------------------------------------------------------
    let link = "";
    for (const rule of rules) {
      if (!selectorHasElement(rule.selector, "a")) continue;
      const declared = cssProperty(rule.body, "color");
      const hex = declared ? firstColorIn(declared) : "";
      if (hex && saturationPercent(hex) >= ACCENT_SATURATION_FLOOR) { link = hex; break; }
    }

    // ---- the chromatic rank, for the accent below ----------------------------
    const ranked = rankChromaticColors(`${pool}\n${styleAttrText}`);

    // ---- slab presence ------------------------------------------------------
    let darkSectionCount = 0;
    let lightSectionCount = 0;
    const slabColors = new Set();
    for (const bg of backgrounds) {
      const lum = relativeLuminance(bg.hex);
      if (lum <= DARK_SLAB_MAX_LUMINANCE) { darkSectionCount += 1; slabColors.add(bg.hex); }
      else if (lum >= LIGHT_SECTION_MIN_LUMINANCE) lightSectionCount += 1;
    }

    // THE ACCENT IS NOT A COLOUR THE PAGE PAINTS AS A BAND. A dark navy hero
    // is the site's slab, not its accent; excluding every detected dark-section
    // colour (and the canvas itself) keeps a navy+gold site's gold as the
    // accent even when the navy outranks it by raw frequency.
    const accentEntry = ranked.find((e) => e.hex !== surface && e.hex !== ink && !slabColors.has(e.hex)) || null;
    const accent = accentEntry ? accentEntry.hex : "";

    const canvasLuminance = surface ? relativeLuminance(surface) : null;
    const mode = canvasLuminance !== null && canvasLuminance < 0.4 ? "dark" : "light";

    const usable = Boolean(surface || ink || accent);
    result.ok = usable;
    result.reason = usable ? "" : "no_readable_colors";
    result.surface = surface;
    result.ink = ink;
    result.link = link;
    result.accent = accent;
    result.mode = mode;
    result.hasDarkSlabs = darkSectionCount >= 1;
    result.darkSectionCount = darkSectionCount;
    result.lightSectionCount = lightSectionCount;
    result.signals = {
      style_blocks: styleBlocks.length,
      style_attributes: (String(source).match(/\bstyle\s*=\s*(?:"[^"]*"|'[^']*')/gi) || []).length,
      stylesheet_texts: Array.isArray(cssTexts) ? cssTexts.length : 0,
      rules_parsed: rules.length,
      background_declarations: backgrounds.length,
      surface_from: surface ? surfaceFrom : "",
      ink_from: ink ? inkFrom : "",
      theme_color: themeColor || "",
      accent_count: accentEntry ? accentEntry.count : 0,
      canvas_luminance: canvasLuminance !== null ? Number(canvasLuminance.toFixed(3)) : null,
    };
    return result;
  } catch (e) {
    return {
      ...result,
      ok: false,
      reason: `extraction_failed:${String((e && e.message) || e).slice(0, 60)}`,
    };
  }
}

module.exports = {
  extractSitePalette,
  // seams for tests
  parseCssRules,
  rankChromaticColors,
  themeColorFromHtml,
};
