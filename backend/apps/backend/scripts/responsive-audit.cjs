"use strict";

// scripts/responsive-audit.cjs — the RESPONSIVE AUDITOR.
//
//   node scripts/responsive-audit.cjs --url https://site.wss-ai.com/
//   node scripts/responsive-audit.cjs --url https://a.example/ --url https://b.example/
//   node scripts/responsive-audit.cjs --file urls.txt          # one URL per line
//   npm run audit:responsive -- --url https://site.wss-ai.com/
//   npm run audit:responsive:self-test                          # fixture verification
//
// WHY: the fleet ships client mirrors that MUST hold up at every sales-window
// width — a sales manager scrolling a 390px phone sees the same page a
// desktop buyer does. Horizontal scroll, washed-out ink, dead side margins,
// floating-CTA collisions and crushed flex rows are exactly the defects that
// make a mirror look cheap in the field, and none of them need a browser to
// detect: they are all visible in the declared CSS once media queries are
// resolved per width.
//
// WHAT IT DOES (zero npm dependencies, Node >= 18 global fetch):
//
//   1. Fetches the page HTML, every linked stylesheet, and @import chains.
//   2. Parses the CSS (own tokenizer — no deps) into flat rules carrying
//      their @media query chains, then re-evaluates the queries at the five
//      canonical audit widths: 1440 / 1280 / 1024 / 768 / 390.
//   3. At each width it checks the defect classes the spec pins:
//        CRITICAL  fixed width / min-width greater than the viewport
//                  (horizontal scroll)
//        CRITICAL  color-on-background-color contrast below 4.5:1
//                  (hex, rgb(), rgba(), hsl(), hsla(); alpha is composited)
//        MAJOR     container max-width under 70% of 1440px at desktop widths
//                  (unused horizontal space)
//        MAJOR     fixed/sticky elements anchored near the bottom corners
//                  (floating widget / CTA overlap)
//        MAJOR     display:flex without flex-wrap at <= 768px
//                  (content compression on phones)
//        MINOR     <img> tags missing width/height attributes (CLS risk)
//        MINOR     heading font-size over 4x body font-size (type scale)
//   4. Emits JSON on stdout (per-width issues + scores, deduped totals,
//      overall score) and a one-line human summary on stderr.
//
// EXIT CODES (the gate contract):
//   0  clean — no CRITICAL anywhere.
//   1  at least one CRITICAL found (audit itself succeeded).
//   2  infrastructure failure — page unreachable, bad args, broken
//      self-test. Nothing was verified, so nothing passes.
//
// HONEST LIMITS (static analysis, no browser): the cascade is read as
// authored — a pair split across two rules (color here, background there) or
// a flex-wrap added in a later override of the same selector is not merged;
// @container blocks and calc()/var() values are skipped rather than guessed.
// Issues carry their selector + evidence so a human can confirm in seconds.
// Detectors are exported pure functions so tests can pin each one.

const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANONICAL_WIDTHS = Object.freeze([1440, 1280, 1024, 768, 390]);
const DESKTOP_WIDTHS = Object.freeze([1440, 1280, 1024]);
const NARROW_CONTAINER_LIMIT_PX = Math.round(1440 * 0.7); // 1008 — spec: 70% of 1440
const CONTRAST_FLOOR = 4.5; // WCAG 2.x AA body text
const TYPE_SCALE_LIMIT = 4; // heading > 4x body
const ROOT_FONT_SIZE_PX = 16; // em/rem in queries + font sizes resolve against this
const FETCH_TIMEOUT_MS = 20000;
const MAX_STYLESHEET_FETCHES = 40; // links + @imports combined
const MAX_IMPORT_DEPTH = 3;
const SCORE_WEIGHTS = Object.freeze({ critical: 15, major: 5, minor: 1 });

const SEVERITIES = Object.freeze(["critical", "major", "minor"]);

// Selectors that plausibly own the page column — a 300px max-width on
// `.card` is a card, on `.container` it is dead side margin.
const CONTAINER_SELECTOR_RE =
  /(container|wrapper|\bwrap\b|main|content|page|shell|inner|site|-layout|column\b)/i;

const USER_AGENT =
  "WSS-Responsive-Audit/1.0 (dependency-free CSS auditor; +https://github.com/mwoodward5/woodward-ghost-agency)";

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Split on `sep` at nesting depth 0 only — parens/brackets/quotes guard. */
function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (ch === sep && depth <= 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Parse a CSS length to px. Supports px, em, rem (root-em basis). Returns
 * null for %, vw, calc(), var(), bare numbers — anything we refuse to guess.
 */
function lengthToPx(value) {
  const m = /^\(-?[\d.]+(?:px|em|rem)\)$/.exec(value); // paranoid () wrap
  const raw = m ? value.slice(1, -1) : value;
  const match = /^(-?[\d.]+)(px|em|rem)$/.exec(raw.trim());
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  if (match[2] === "px") return n;
  return n * ROOT_FONT_SIZE_PX;
}

/**
 * Extract the largest absolute px/rem/em magnitude inside a clamp()/min()/
 * max() expression — the worst-case the value can reach. null if none.
 */
function worstCaseLengthPx(value) {
  const nums = [...value.matchAll(/(-?[\d.]+)(px|em|rem)\b/g)];
  if (nums.length === 0) return null;
  let worst = 0;
  for (const n of nums) {
    const px = Number(n[1]) * (n[2] === "px" ? 1 : ROOT_FONT_SIZE_PX);
    if (Math.abs(px) > Math.abs(worst)) worst = px;
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Colour maths — same WCAG 2.1 sRGB pipeline as scripts/check-contrast.js
// ---------------------------------------------------------------------------

function srgbChannelToLinear(v) {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  return (
    0.2126 * srgbChannelToLinear(rgb[0]) +
    0.7152 * srgbChannelToLinear(rgb[1]) +
    0.0722 * srgbChannelToLinear(rgb[2])
  );
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** #abc, #abcd, #aabbcc, #aabbccdd -> [r,g,b,a?]. */
function hexToRgbChannels(value) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (!m) return null;
  const hex = m[1];
  if (hex.length === 3 || hex.length === 4) {
    const chans = hex
      .slice(0, 3)
      .split("")
      .map((c) => parseInt(c + c, 16));
    const alpha = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
    return [...chans, alpha];
  }
  if (hex.length === 6 || hex.length === 8) {
    const chans = [0, 1, 2].map((i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    const alpha =
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [...chans, alpha];
  }
  return null;
}

function pctOrNum(token, scale) {
  if (token.endsWith("%")) return (parseFloat(token) / 100) * scale;
  return parseFloat(token);
}

/**
 * Split the inside of an rgb()/hsl() function into channel tokens + optional
 * alpha token. Handles comma syntax, space syntax, and `/ alpha` (space
 * syntax with slash alpha, e.g. `rgb(153 153 153 / 50%)`).
 */
function splitColorTokens(inner) {
  if (inner.includes("/")) {
    const [before, ...rest] = splitTopLevel(inner, "/");
    if (rest.length !== 1) return null;
    return {
      channels: before.trim().split(/[\s,]+/).filter(Boolean),
      alpha: rest[0].trim(),
    };
  }
  if (inner.includes(",")) {
    const parts = splitTopLevel(inner, ",").map((p) => p.trim());
    return { channels: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : null };
  }
  const tokens = inner.trim().split(/\s+/).filter(Boolean);
  return { channels: tokens.slice(0, 3), alpha: tokens.length > 3 ? tokens[3] : null };
}

/** rgb()/rgba() with comma or space syntax, % or 0-255 channels. */
function functionalRgbToChannels(value) {
  const m =
    /^rgba?\(\s*([^)]*)\)$/i.exec(value.trim().replace(/\s+/g, " "));
  if (!m) return null;
  const { channels, alpha: alphaToken } = splitColorTokens(m[1].trim()) ?? {};
  if (!channels || channels.length < 3) return null;
  const chans = channels.map((p) => pctOrNum(p, 255));
  if (chans.some((c) => !Number.isFinite(c))) return null;
  let alpha = 1;
  if (alphaToken) {
    alpha = alphaToken.endsWith("%")
      ? parseFloat(alphaToken) / 100
      : parseFloat(alphaToken);
    if (!Number.isFinite(alpha)) return null;
  }
  return [...chans.map((c) => Math.max(0, Math.min(255, c))), Math.max(0, Math.min(1, alpha))];
}

/** hsl()/hsla() — h in deg, s/l %. */
function hslToChannels(value) {
  const m =
    /^hsla?\(\s*([^)]*)\)$/i.exec(value.trim().replace(/\s+/g, " "));
  if (!m) return null;
  const { channels, alpha: alphaToken } = splitColorTokens(m[1].trim()) ?? {};
  if (!channels || channels.length < 3) return null;
  const h = parseFloat(channels[0]) % 360;
  const s = pctOrNum(channels[1], 1);
  const l = pctOrNum(channels[2], 1);
  if (![h, s, l].every(Number.isFinite)) return null;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  let alpha = 1;
  if (alphaToken) {
    alpha = alphaToken.endsWith("%")
      ? parseFloat(alphaToken) / 100
      : parseFloat(alphaToken);
    if (!Number.isFinite(alpha)) return null;
  }
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
    Math.max(0, Math.min(1, alpha)),
  ];
}

/**
 * Parse any supported colour declaration to [r,g,b,a]; null when we refuse
 * to guess (var(), gradients, named colours beyond the map, oklch, ...).
 */
function parseColor(value) {
  const v = value.trim().toLowerCase();
  if (!v || v === "inherit" || v === "currentcolor" || v === "transparent") {
    return null;
  }
  if (v.startsWith("#")) return hexToRgbChannels(v);
  if (/^rgba?\(/.test(v)) return functionalRgbToChannels(v);
  if (/^hsla?\(/.test(v)) return hslToChannels(v);
  return null;
}

/** Composite `over` (with alpha) onto `base` (opaque). */
function compositeOver(over, base) {
  const a = over[3];
  return [
    over[0] * a + base[0] * (1 - a),
    over[1] * a + base[1] * (1 - a),
    over[2] * a + base[2] * (1 - a),
  ];
}

const WHITE = [255, 255, 255];

/**
 * Resolve a foreground/background pair the way the spec pins: foreground
 * alpha composites over the rule's own background; background alpha over
 * white (the page default we must assume). Returns [fg, bg] opaque RGB.
 */
function resolvePair(fg, bg) {
  const f = fg[3] < 1 ? compositeOver(fg, bg) : fg.slice(0, 3);
  const b = bg[3] < 1 ? compositeOver(bg, WHITE) : bg.slice(0, 3);
  return [f, b];
}

// ---------------------------------------------------------------------------
// CSS parsing — flat rules carrying their @media chains
// ---------------------------------------------------------------------------

/** Find the index of the first of `chars` at depth 0, respecting strings. */
function indexOfTopLevel(css, from, chars) {
  let quote = null;
  for (let i = from; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === quote && css[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (chars.includes(ch)) return i;
  }
  return -1;
}

/** Index of the `}` matching the `{` at `openIdx`, respecting strings/nests. */
function matchingBrace(css, openIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === quote && css[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parse a stylesheet into flat rules. `mediaChain` accumulates ancestor
 * @media queries (nested media ANDs). @import statements are collected (the
 * caller fetches them); @keyframes/@font-face/@page/@property bodies are
 * skipped; @supports/@layer are treated as active and recursed into;
 * @container blocks are skipped (a container's size is unknowable statically).
 */
function parseStylesheet(cssText, mediaChain, rulesOut, importsOut) {
  const css = stripCssComments(cssText);
  let i = 0;
  while (i < css.length) {
    const nextBrace = indexOfTopLevel(css, i, ["{", ";"]);
    if (nextBrace === -1) break;
    const prelude = css.slice(i, nextBrace).trim();
    const terminator = css[nextBrace];
    if (terminator === ";") {
      recordStatement(prelude, importsOut);
      i = nextBrace + 1;
      continue;
    }
    const close = matchingBrace(css, nextBrace);
    if (close === -1) break; // unbalanced — bail out of this sheet
    const body = css.slice(nextBrace + 1, close);
    if (prelude.startsWith("@")) {
      dispatchAtRule(prelude, body, mediaChain, rulesOut, importsOut);
    } else if (prelude) {
      if (indexOfTopLevel(body, 0, ["{"]) !== -1) {
        // CSS nesting: analyse the inner rules (selector scoping is not
        // reconstructed — declarations keep their nested selector text).
        parseStylesheet(body, mediaChain, rulesOut, importsOut);
      } else {
        const declarations = parseDeclarations(body);
        if (declarations.length > 0) {
          rulesOut.push({
            selector: prelude.replace(/\s+/g, " ").trim(),
            declarations,
            media: mediaChain.slice(),
          });
        }
      }
    }
    i = close + 1;
  }
}

function recordStatement(prelude, importsOut) {
  const m = /^@import(?:\s+layer)?\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*$/i.exec(
    prelude
  );
  if (m && importsOut) importsOut.push(m[1]);
}

function dispatchAtRule(prelude, body, mediaChain, rulesOut, importsOut) {
  const name = /^@([a-zA-Z-]+)/.exec(prelude);
  const at = name ? name[1].toLowerCase() : "";
  if (at === "media") {
    const query = prelude.replace(/^@media/i, "").trim();
    parseStylesheet(body, mediaChain.concat([query]), rulesOut, importsOut);
    return;
  }
  if (at === "supports" || at === "layer" || at === "scope") {
    // Progressive blocks are presumed active; nesting keeps the media chain.
    parseStylesheet(body, mediaChain, rulesOut, importsOut);
    return;
  }
  // keyframes, font-face, page, property, counter-style, container, ...: skip.
}

/** Declarations -> [{prop, value}] (prop lowercased). */
function parseDeclarations(body) {
  const out = [];
  for (const chunk of splitTopLevel(body, ";")) {
    const colon = chunk.indexOf(":");
    if (colon === -1) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (prop && value) out.push({ prop, value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Media query evaluation at a width
// ---------------------------------------------------------------------------

function mediaConditionMatches(condition, width) {
  const c = condition.trim().toLowerCase();
  if (!c) return true;
  if (/^(only\s+)?(screen|all)$/.test(c)) return true;
  if (/^(only\s+)?print$/.test(c)) return false;
  if (c.startsWith("not ")) {
    return !mediaConditionMatches(c.slice(4), width);
  }

  // Modern range syntax: (min-width <= 900px), (900px <= width <= 1200px),
  // (width >= 900px).
  let m = /^\(\s*([\d.]+(?:px|em|rem))\s*<=\s*width\s*<=\s*([\d.]+(?:px|em|rem))\s*\)$/.exec(c);
  if (m) {
    const lo = lengthToPx(m[1]);
    const hi = lengthToPx(m[2]);
    return lo !== null && hi !== null && width >= lo && width <= hi;
  }
  m = /^\(\s*(min-width|max-width)\s*(<=|<)\s*([\d.]+(?:px|em|rem))\s*\)$/.exec(c);
  if (m) {
    const bound = lengthToPx(m[3]);
    if (bound === null) return true; // unresolvable unit — include, do not hide
    return m[1] === "min-width"
      ? m[2] === "<="
        ? width <= bound
        : width < bound
      : m[2] === "<="
        ? width >= bound
        : width > bound;
  }
  m = /^\(\s*width\s*(>=|<=|>|<)\s*([\d.]+(?:px|em|rem))\s*\)$/.exec(c);
  if (m) {
    const bound = lengthToPx(m[2]);
    if (bound === null) return true;
    switch (m[1]) {
      case ">=": return width >= bound;
      case "<=": return width <= bound;
      case ">": return width > bound;
      default: return width < bound;
    }
  }

  // Classic syntax: (min-width: 900px), (max-width: 600px), (width: 320px),
  // (orientation: landscape), (prefers-*: ...), (hover: hover), ...
  m = /^\(\s*([a-z-]+)\s*:\s*([^)]+)\s*\)$/.exec(c);
  if (m) {
    const feature = m[1];
    const val = m[2].trim();
    if (feature === "min-width") {
      const bound = lengthToPx(val);
      return bound === null ? true : width >= bound;
    }
    if (feature === "max-width") {
      const bound = lengthToPx(val);
      return bound === null ? true : width <= bound;
    }
    if (feature === "width") {
      const bound = lengthToPx(val);
      return bound === null ? true : width === bound;
    }
    // orientation, prefers-color-scheme, hover, pointer, resolution, ...
    // Unresolvable from CSS alone: include the block rather than hide it.
    return true;
  }

  // Anything else malformed/unknown: include.
  return true;
}

/** Evaluate a full @media prelude (commas = any, "and" = all). */
function mediaQueryMatches(query, width) {
  const q = stripCssComments(query).trim().toLowerCase();
  if (!q || q === "all" || q === "screen" || q === "only screen") return true;
  if (q === "print") return false;
  for (const alternative of splitTopLevel(q, ",")) {
    const conditions = alternative
      .split(/\s+and\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (conditions.length === 0) continue;
    if (conditions.every((cond) => mediaConditionMatches(cond, width))) {
      return true;
    }
  }
  return false;
}

function rulesActiveAt(rules, width) {
  return rules.filter((rule) => rule.media.every((q) => mediaQueryMatches(q, width)));
}

// ---------------------------------------------------------------------------
// HTML extraction helpers
// ---------------------------------------------------------------------------

function extractStyleBlocks(html) {
  const blocks = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);
  return blocks;
}

function extractStylesheetHrefs(html) {
  const hrefs = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const rel = /rel\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const relValue = rel ? (rel[2] ?? rel[3] ?? "") : "";
    if (!/\bstylesheet\b/i.test(relValue)) continue;
    const href = attrOf(tag, "href");
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function attrOf(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? "").trim() || null;
}

function extractImgTags(html) {
  const imgs = [];
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) imgs.push(m[0]);
  return imgs;
}

// ---------------------------------------------------------------------------
// Detectors — pure, exported for pinning
// ---------------------------------------------------------------------------

function declValue(rule, props) {
  for (const d of rule.declarations) {
    if (props.includes(d.prop)) return d.value;
  }
  return null;
}

/**
 * CRITICAL — fixed width / min-width exceeding the viewport. px/em/rem only;
 * calc()/var()/% are skipped rather than guessed. Same-rule position:fixed
 * is exempt (fixed overlays do not grow the scroll area).
 */
function detectHorizontalScroll(activeRules, width) {
  const issues = [];
  for (const rule of activeRules) {
    const position = declValue(rule, ["position"]);
    if (position && /fixed/.test(position)) continue;
    for (const prop of ["width", "min-width"]) {
      const value = declValue(rule, [prop]);
      if (!value) continue;
      const px = value.includes("clamp(")
        ? worstCaseLengthPx(value)
        : lengthToPx(value);
      if (px === null) continue;
      if (px > width) {
        issues.push({
          severity: "critical",
          type: "horizontal-scroll",
          selector: rule.selector,
          width,
          key: `hscroll|${rule.selector}|${prop}|${value}`,
          message: `${rule.selector} { ${prop}: ${value} } is ${Math.round(px)}px wide — exceeds the ${width}px viewport and forces horizontal scroll`,
          evidence: { prop, value, px },
        });
      }
    }
  }
  return issues;
}

/**
 * CRITICAL — declared color/background-color pairs under 4.5:1. The pair
 * must live in one rule (static analysis; cascade merges are documented as
 * out of scope). rgba/hsla alpha is composited: fg over the rule's bg, bg
 * over white.
 */
function detectContrastFailures(activeRules) {
  const issues = [];
  for (const rule of activeRules) {
    const colorValue = declValue(rule, ["color"]);
    const bgValue =
      declValue(rule, ["background-color"]) ?? plainBackgroundColor(rule);
    if (!colorValue || !bgValue) continue;
    const fg = parseColor(colorValue);
    const bg = parseColor(bgValue);
    if (!fg || !bg) continue;
    const [fgOpaque, bgOpaque] = resolvePair(fg, bg);
    const ratio = contrastRatio(fgOpaque, bgOpaque);
    if (ratio < CONTRAST_FLOOR) {
      issues.push({
        severity: "critical",
        type: "contrast",
        selector: rule.selector,
        key: `contrast|${rule.selector}|${colorValue}|${bgValue}`,
        message: `${rule.selector} text/background pair is ${round2(ratio)}:1 (< ${CONTRAST_FLOOR}:1): color: ${colorValue}; background-color: ${bgValue}`,
        evidence: {
          color: colorValue,
          backgroundColor: bgValue,
          ratio: round2(ratio),
          floor: CONTRAST_FLOOR,
        },
      });
    }
  }
  return issues;
}

/** `background: <color> ...` shorthand when it starts with a plain colour. */
function plainBackgroundColor(rule) {
  for (const d of rule.declarations) {
    if (d.prop !== "background") continue;
    const first = splitTopLevel(d.value, ",")[0].trim();
    if (!/[()]/.test(first) && !first.includes(" ")) {
      // A single token: a colour (or unresolvable keyword parseColor rejects).
      return first;
    }
    if (/^(#|rgb|hsl)/i.test(first) && !first.includes(" ")) return first;
  }
  return null;
}

/**
 * MAJOR — container max-width under 70% of 1440px at desktop widths. Only
 * container-like selectors (or near-full-width values) count: a 300px
 * max-width on `.card` is a card, on `.container` it is dead margin.
 */
function detectNarrowContainers(activeRules, width) {
  if (!DESKTOP_WIDTHS.includes(width)) return [];
  const issues = [];
  for (const rule of activeRules) {
    const value = declValue(rule, ["max-width"]);
    if (!value) continue;
    const px = value.includes("clamp(")
      ? worstCaseLengthPx(value)
      : lengthToPx(value);
    if (px === null) continue;
    if (px >= NARROW_CONTAINER_LIMIT_PX) continue;
    const containerish =
      CONTAINER_SELECTOR_RE.test(rule.selector) || px >= 900;
    if (!containerish) continue;
    issues.push({
      severity: "major",
      type: "narrow-container",
      selector: rule.selector,
      width,
      key: `narrow|${rule.selector}|${value}`,
      message: `${rule.selector} { max-width: ${value} } (${Math.round(px)}px) leaves ${Math.round(1440 - px)}px unused at desktop — under the ${NARROW_CONTAINER_LIMIT_PX}px (70% of 1440) floor`,
      evidence: { maxWidthPx: Math.round(px), floor: NARROW_CONTAINER_LIMIT_PX },
    });
  }
  return issues;
}

/**
 * MAJOR — fixed/sticky elements anchored to a bottom corner (floating chat
 * widgets, sticky mobile CTAs) that can overlap page content.
 */
function detectFloatingWidgets(activeRules, width) {
  const issues = [];
  for (const rule of activeRules) {
    const position = declValue(rule, ["position"]);
    if (!position || !/^(fixed|sticky)$/i.test(position.trim())) continue;
    const bottom = declValue(rule, ["bottom"]);
    const side = declValue(rule, ["left"]) ?? declValue(rule, ["right"]);
    if (bottom === null || side === null) continue;
    const bottomPx =
      lengthToPx(bottom) ??
      (bottom.trim().endsWith("%")
        ? (parseFloat(bottom) / 100) * width
        : null);
    const sidePx =
      lengthToPx(side) ??
      (side.trim().endsWith("%")
        ? (parseFloat(side) / 100) * width
        : null);
    if (bottomPx === null || sidePx === null) continue;
    if (bottomPx > 160 || sidePx > 160) continue; // not "near" the corner
    issues.push({
      severity: "major",
      type: "floating-widget",
      selector: rule.selector,
      width,
      key: `float|${rule.selector}|${position.trim()}|${bottom}|${side}`,
      message: `${rule.selector} is position:${position.trim()} at bottom:${bottom} ${declValue(rule, ["left"]) !== null ? "left" : "right"}:${side} — a corner-anchored overlay that can cover content`,
      evidence: { position: position.trim(), bottom, side, bottomPx, sidePx },
    });
  }
  return issues;
}

/**
 * MAJOR — display:flex without flex-wrap at <= 768px. Same-rule wrap (or
 * flex-flow: ...wrap / flex-direction: column) exempts; cross-rule overrides
 * are a documented blind spot.
 */
function detectFlexNoWrap(activeRules, width) {
  if (width > 768) return [];
  const issues = [];
  for (const rule of activeRules) {
    const display = declValue(rule, ["display"]);
    if (!display || !/^(inline-)?flex$/.test(display.trim())) continue;
    const wrap = declValue(rule, ["flex-wrap"]);
    if (wrap && /wrap\b/.test(wrap)) continue;
    const flow = declValue(rule, ["flex-flow", "flex-direction"]);
    if (flow) {
      if (/wrap\b/.test(flow)) continue;
      if (/column\b/.test(flow)) continue;
    }
    issues.push({
      severity: "major",
      type: "flex-no-wrap",
      selector: rule.selector,
      width,
      key: `flex|${rule.selector}|${display.trim()}`,
      message: `${rule.selector} { display: ${display.trim()} } has no flex-wrap — children compress instead of wrapping on a ${width}px viewport`,
      evidence: { display: display.trim() },
    });
  }
  return issues;
}

/**
 * MINOR — <img> without BOTH width and height attributes (CLS risk).
 * Width-independent; reported at every width, deduped in the totals.
 */
function detectImgMissingDimensions(imgTags, width) {
  const issues = [];
  for (const tag of imgTags) {
    const w = attrOf(tag, "width");
    const h = attrOf(tag, "height");
    if (w !== null && h !== null) continue;
    const src = attrOf(tag, "src") ?? "(no src)";
    issues.push({
      severity: "minor",
      type: "img-dimensions",
      width,
      key: `img|${src}|${w === null ? "w" : ""}${h === null ? "h" : ""}`,
      message: `<img src="${src.slice(0, 120)}"> is missing ${w === null ? "width" : ""}${w === null && h === null ? " and " : ""}${h === null ? "height" : ""} attributes — layout shifts when it loads (CLS risk)`,
      evidence: { src, missingWidth: w === null, missingHeight: h === null },
    });
  }
  return issues;
}

/**
 * MINOR — heading font-size beyond 4x the body font-size. Body size resolves
 * from active body/html rules (default 16px); clamp() contributes its
 * worst-case bound.
 */
function detectTypeScale(activeRules) {
  const issues = [];
  let bodyPx = ROOT_FONT_SIZE_PX;
  for (const rule of activeRules) {
    if (!/(^|,)\s*(body|html)\s*(,|$)/.test(rule.selector)) continue;
    const value = declValue(rule, ["font-size"]);
    if (!value) continue;
    const px = value.includes("clamp(")
      ? worstCaseLengthPx(value)
      : lengthToPx(value);
    if (px !== null && px > 0) bodyPx = px;
  }
  for (const rule of activeRules) {
    if (!/(^|[,\s>~+])(h[1-6])\b/.test(rule.selector)) continue;
    const value = declValue(rule, ["font-size"]);
    if (!value) continue;
    const px = value.includes("clamp(")
      ? worstCaseLengthPx(value)
      : lengthToPx(value);
    if (px === null) continue;
    const ratio = px / bodyPx;
    if (ratio > TYPE_SCALE_LIMIT) {
      issues.push({
        severity: "minor",
        type: "type-scale",
        selector: rule.selector,
        key: `type|${rule.selector}|${value}`,
        message: `${rule.selector} { font-size: ${value} } is ${round2(ratio)}x the ${bodyPx}px body size (limit ${TYPE_SCALE_LIMIT}x)`,
        evidence: { fontSize: value, px, bodyPx, ratio: round2(ratio) },
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Audit core — document-level, sync, pure (exported for the self-test)
// ---------------------------------------------------------------------------

function issueKey(issue) {
  if (issue.key) return issue.key;
  const evidence = issue.evidence ? JSON.stringify(issue.evidence) : "";
  return `${issue.severity}|${issue.type}|${issue.selector ?? ""}|${issue.message}|${evidence}`;
}

function countBySeverity(issues) {
  const counts = { critical: 0, major: 0, minor: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

function scoreFor(counts) {
  const penalty =
    SCORE_WEIGHTS.critical * counts.critical +
    SCORE_WEIGHTS.major * counts.major +
    SCORE_WEIGHTS.minor * counts.minor;
  return Math.max(0, 100 - penalty);
}

/**
 * Audit one document's HTML + CSS texts across the canonical widths.
 * Returns the per-URL result object used in the JSON report.
 */
function auditDocument({ url, html, cssTexts, warnings = [] }) {
  const cssSources = extractStyleBlocks(html).concat(cssTexts ?? []);
  const rules = [];
  const ignoredImports = [];
  for (const css of cssSources) {
    const imports = [];
    parseStylesheet(css, [], rules, imports);
    for (const href of imports) ignoredImports.push(href); // fetched by caller wrapper
  }
  const imgTags = extractImgTags(html);

  const perWidth = {};
  const dedupe = new Map();

  for (const width of CANONICAL_WIDTHS) {
    const active = rulesActiveAt(rules, width);
    const issues = []
      .concat(detectHorizontalScroll(active, width))
      .concat(detectContrastFailures(active))
      .concat(detectNarrowContainers(active, width))
      .concat(detectFloatingWidgets(active, width))
      .concat(detectFlexNoWrap(active, width))
      .concat(detectImgMissingDimensions(imgTags, width))
      .concat(detectTypeScale(active));
    for (const issue of issues) {
      const key = issueKey(issue);
      const existing = dedupe.get(key);
      if (existing) existing.widths.push(width);
      else dedupe.set(key, { ...issue, widths: [width] });
    }
    const counts = countBySeverity(issues);
    perWidth[String(width)] = {
      issues: issues.map((i) => {
        const { key: _dropKey, width: _dropWidth, ...rest } = i;
        return { ...rest, widths: dedupe.get(issueKey(i)).widths };
      }),
      counts,
      score: scoreFor(counts),
    };
  }

  const uniqueIssues = [...dedupe.values()].map((i) => {
    const { key: _dropKey, width: _dropWidth, ...rest } = i;
    return rest;
  });
  const totals = countBySeverity(uniqueIssues);
  const widthScores = CANONICAL_WIDTHS.map((w) => perWidth[String(w)].score);
  const score = Math.round(
    widthScores.reduce((a, b) => a + b, 0) / widthScores.length
  );

  return {
    url,
    stylesheets: cssSources.length,
    rulesAnalyzed: rules.length,
    widths: perWidth,
    totals,
    score,
    warnings,
    unresolvedImports: ignoredImports,
  };
}

// ---------------------------------------------------------------------------
// Fetching layer
// ---------------------------------------------------------------------------

async function fetchText(url, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/css,text/html;q=0.9,*/*;q=0.8",
        "user-agent": USER_AGENT,
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function readLocalFile(url) {
  // file:// and bare Windows/POSIX paths — lets --url hit local fixtures.
  const p = url.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1");
  return fs.readFileSync(p, "utf8");
}

async function auditUrl(url, opts) {
  const warnings = [];
  const fetchOne = async (target) => {
    if (target.startsWith("file://") || !/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
      return readLocalFile(target);
    }
    return fetchText(target, opts.fetchFn ?? fetch);
  };

  const html = await fetchOne(url);
  const baseUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
    ? url
    : `file://${path.resolve(url).replace(/\\/g, "/")}`;

  const cssTexts = [];
  let fetchCount = 0;
  const queue = []; // {href, depth}
  for (const href of extractStylesheetHrefs(html)) {
    queue.push({ href, depth: 0 });
  }

  const seen = new Set();
  while (queue.length > 0 && fetchCount < MAX_STYLESHEET_FETCHES) {
    const { href, depth } = queue.shift();
    let absolute;
    try {
      absolute = new URL(href, baseUrl).href;
    } catch {
      warnings.push(`unresolvable stylesheet href: ${href}`);
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    fetchCount += 1;
    let text;
    try {
      text = await fetchOne(absolute);
    } catch (err) {
      warnings.push(`stylesheet unreachable (${absolute}): ${err.message}`);
      continue;
    }
    cssTexts.push(text);
    if (depth < MAX_IMPORT_DEPTH) {
      const imports = [];
      parseStylesheet(text, [], [], imports);
      for (const imp of imports) queue.push({ href: imp, depth: depth + 1 });
    }
  }

  return auditDocument({ url, html, cssTexts, warnings });
}

// ---------------------------------------------------------------------------
// Self-test — fixtures under scripts/responsive-audit-fixtures/
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(__dirname, "responsive-audit-fixtures");

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function runSelfTest() {
  const checks = [];
  const check = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // 1. clean.html — a responsive, AA-compliant page must audit fully clean.
  const clean = auditDocument({
    url: "fixture://clean.html",
    html: loadFixture("clean.html"),
    cssTexts: [],
  });
  const cleanAll = Object.values(clean.widths)
    .map((w) => w.issues)
    .flat();
  check(
    "clean.html audits with zero issues at all 5 widths",
    cleanAll.length === 0,
    cleanAll.length === 0
      ? `score ${clean.score}`
      : cleanAll
          .slice(0, 4)
          .map((i) => `${i.severity}/${i.type}: ${i.message}`)
          .join(" | ")
  );
  check("clean.html scores 100", clean.score === 100, `score=${clean.score}`);

  // 2. horizontal-scroll.html — oversized fixed widths must be CRITICAL,
  //    and must be seen at the phone width where they hurt sales review.
  const overflow = auditDocument({
    url: "fixture://horizontal-scroll.html",
    html: loadFixture("horizontal-scroll.html"),
    cssTexts: [],
  });
  const overflowCriticals = overflow.widths["390"].issues.filter(
    (i) => i.severity === "critical" && i.type === "horizontal-scroll"
  );
  check(
    "horizontal-scroll.html flags CRITICAL horizontal-scroll at 390px",
    overflowCriticals.length >= 1,
    overflowCriticals.map((i) => i.message).join(" | ") || "none found"
  );
  check(
    "horizontal-scroll.html has a width/min-width rule exceeding the viewport",
    overflow.totals.critical >= 1,
    `critical=${overflow.totals.critical}`
  );

  // 3. contrast.html — sub-4.5:1 pairs (hex and rgba) must be CRITICAL with
  //    the computed ratio as evidence.
  const contrast = auditDocument({
    url: "fixture://contrast.html",
    html: loadFixture("contrast.html"),
    cssTexts: [],
  });
  const contrastIssues = Object.values(contrast.widths)
    .map((w) => w.issues)
    .flat()
    .filter((i) => i.type === "contrast" && i.severity === "critical");
  const hexCaught = contrastIssues.some(
    (i) => i.evidence && i.evidence.color.includes("#")
  );
  const rgbaCaught = contrastIssues.some(
    (i) => i.evidence && i.evidence.color.includes("rgba")
  );
  const uniqueContrastMessages = [
    ...new Set(contrastIssues.map((i) => i.message)),
  ];
  check(
    "contrast.html flags CRITICAL contrast failures",
    contrastIssues.length >= 1,
    uniqueContrastMessages.join(" | ") || "none found"
  );
  check(
    "contrast detector parses hex colour pairs",
    hexCaught,
    hexCaught ? "" : "no hex-based failure detected"
  );
  check(
    "contrast detector parses rgba and composites alpha",
    rgbaCaught,
    rgbaCaught ? "" : "no rgba-based failure detected"
  );
  check(
    "contrast fixture would exit 1 (critical found)",
    contrast.totals.critical >= 1 && overflow.totals.critical >= 1,
    `contrast critical=${contrast.totals.critical}, overflow critical=${overflow.totals.critical}`
  );

  // 4. Exit-code contract on the aggregate helpers.
  check(
    "clean fixture would exit 0",
    clean.totals.critical === 0,
    `critical=${clean.totals.critical}`
  );

  const failed = checks.filter((c) => !c.pass);
  console.log(
    `\nself-test: ${checks.length - failed.length}/${checks.length} checks passed`
  );
  return failed.length === 0 ? 0 : 2;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  return [
    "usage: node scripts/responsive-audit.cjs [--url <url>...] [--file <path>] [--self-test]",
    "",
    "  --url <url>      audit this URL (repeatable)",
    "  --file <path>    audit URLs from a file, one per line (# comments ok)",
    "  --self-test      verify detectors against the bundled fixtures and exit",
    "",
    "Widths audited: " + CANONICAL_WIDTHS.join(" / "),
    "Exit codes: 0 clean · 1 critical found · 2 infrastructure failure",
  ].join("\n");
}

async function main(argv) {
  const urls = [];
  let file = null;
  let selfTest = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url" || arg === "-u") {
      const next = argv[i + 1];
      if (!next) {
        console.error(`error: ${arg} requires a value`);
        console.error(usage());
        return 2;
      }
      urls.push(next);
      i += 1;
    } else if (arg === "--file" || arg === "-f") {
      const next = argv[i + 1];
      if (!next) {
        console.error(`error: ${arg} requires a value`);
        console.error(usage());
        return 2;
      }
      file = next;
      i += 1;
    } else if (arg === "--self-test") {
      selfTest = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return 0;
    } else {
      console.error(`error: unknown argument ${arg}`);
      console.error(usage());
      return 2;
    }
  }

  if (selfTest) return runSelfTest();

  if (file) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (err) {
      console.error(`error: cannot read --file ${file}: ${err.message}`);
      return 2;
    }
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith("#")) urls.push(t);
    }
  }

  if (urls.length === 0) {
    console.error("error: nothing to audit — pass --url <url> or --file <path>");
    console.error(usage());
    return 2;
  }

  if (typeof fetch !== "function") {
    console.error("error: Node >= 18 required for global fetch");
    return 2;
  }

  const results = [];
  const infraErrors = [];
  for (const url of urls) {
    try {
      results.push(await auditUrl(url, {}));
    } catch (err) {
      infraErrors.push({ url, error: err.message });
      console.error(`infrastructure failure (${url}): ${err.message}`);
    }
  }

  const totals = { critical: 0, major: 0, minor: 0 };
  for (const r of results) {
    for (const sev of SEVERITIES) totals[sev] += r.totals[sev];
  }
  const overallScore =
    results.length === 0
      ? 0
      : Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);

  let exitCode = 0;
  let exitReason = "clean";
  if (infraErrors.length > 0) {
    exitCode = 2;
    exitReason = "infrastructure failure";
  } else if (totals.critical > 0) {
    exitCode = 1;
    exitReason = `critical issues found (${totals.critical})`;
  }

  const report = {
    tool: "responsive-audit",
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    widths: CANONICAL_WIDTHS,
    contrastFloor: CONTRAST_FLOOR,
    results,
    totals,
    score: overallScore,
    exitCode,
    exitReason,
    infrastructureErrors: infraErrors,
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `responsive-audit: ${results.length} URL(s), score ${overallScore}, ` +
      `critical=${totals.critical} major=${totals.major} minor=${totals.minor} → exit ${exitCode} (${exitReason})`
  );
  return exitCode;
}

// Exported for tests (mirrors fleet-audit.cjs's pure-detector pattern) —
// the CLI only runs when invoked directly.
module.exports = {
  CANONICAL_WIDTHS,
  CONTRAST_FLOOR,
  NARROW_CONTAINER_LIMIT_PX,
  TYPE_SCALE_LIMIT,
  parseColor,
  contrastRatio,
  resolvePair,
  lengthToPx,
  mediaQueryMatches,
  parseStylesheet,
  auditDocument,
  detectHorizontalScroll,
  detectContrastFailures,
  detectNarrowContainers,
  detectFloatingWidgets,
  detectFlexNoWrap,
  detectImgMissingDimensions,
  detectTypeScale,
  runSelfTest,
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      // exitCode (not exit()) so fetch keep-alive sockets drain before the
      // process ends — process.exit() races libuv handle teardown on Windows.
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`fatal: ${err && err.stack ? err.stack : err}`);
      process.exitCode = 2;
    });
}
