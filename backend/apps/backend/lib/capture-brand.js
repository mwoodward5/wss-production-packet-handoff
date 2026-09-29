"use strict";
// lib/capture-brand.js — derive a client's REAL brand from a rendered capture.
//
// Ghost has been painting every mirror with a generic fallback accent (#B4552D)
// because the logo-colour binding never produced anything usable. The owner's
// directive is the opposite: the palette MUST come from the client's own logo,
// so the site reads as theirs the moment they open it.
//
// Input is a capture directory produced by the lovable2wp/LandedWP extractor
// (Playwright renders the real page, then writes the logo, the media, a full
// computed-style tree and a rendered screenshot). That extractor works on any
// site — Wix, Squarespace, hand-rolled — which is exactly the cold-outreach case.
//
// TRUTH LAW: everything here is MEASURED from the client's own published assets.
// A colour is reported only if it is actually in their logo. Nothing is invented,
// and when we cannot measure a brand colour we say so and let the caller fall
// back explicitly rather than silently shipping a made-up one.

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

// --- pure colour maths (unit-testable, no IO) --------------------------------

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Perceived luminance (ITU-R BT.601). 0 = black, 1 = white. */
function luminance(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** 0 = grey, 1 = fully saturated. */
function saturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

/**
 * A brand colour has to actually be a colour. Logos are overwhelmingly white,
 * black and grey — without this filter the "brand palette" of every business on
 * earth comes back as #ffffff, which is how a generic fallback wins by default.
 */
function isBrandCandidate(r, g, b, { minSat = 0.25, minLum = 0.06, maxLum = 0.96 } = {}) {
  const lum = luminance(r, g, b);
  if (lum < minLum || lum > maxLum) return false;
  return saturation(r, g, b) >= minSat;
}

/**
 * Rank distinct colours in a raw RGB buffer by how much of the image they cover.
 * Colours are bucketed (default 5 bits/channel) so near-identical pixels from
 * antialiasing and JPEG ringing collapse into one entry instead of splitting the
 * vote a thousand ways.
 *
 * Returns [{ hex, share, r, g, b }], most-used first. `share` is the fraction of
 * QUALIFYING pixels, so it answers "of the actual colour in this logo, how much
 * is this one" — not "how much of the image is white".
 */
function rankColors(rgb, { bucketBits = 3, max = 6, filter = isBrandCandidate, channels = 3, minAlpha = 200 } = {}) {
  if (!rgb || !rgb.length) return [];
  const shift = 8 - Math.max(1, Math.min(8, 8 - bucketBits));
  const counts = new Map();
  let qualifying = 0;

  for (let i = 0; i + 2 < rgb.length; i += channels) {
    // channels=4 (RGBA): skip transparent pixels entirely. Composited-over-
    // black transparency is how a palette-PNG logo once "measured" a muted
    // green (#48704b) that exists nowhere in the mark (2026-07-29, twice).
    if (channels === 4 && rgb[i + 3] < minAlpha) continue;
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    if (!filter(r, g, b)) continue;
    qualifying++;
    // quantise so antialiased edges collapse into the parent colour
    const key = ((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift);
    let e = counts.get(key);
    if (!e) counts.set(key, (e = { r: 0, g: 0, b: 0, n: 0 }));
    e.r += r; e.g += g; e.b += b; e.n++;
  }
  if (!qualifying) return [];

  return [...counts.values()]
    .sort((a, b2) => b2.n - a.n)
    .slice(0, max)
    .map((e) => {
      const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
      return { hex: toHex(r, g, b), share: e.n / qualifying, r: clamp255(r), g: clamp255(g), b: clamp255(b) };
    });
}

/**
 * Split a ranked palette into the roles a template needs.
 * accent = the loudest colour (buttons, highlights)
 * ink    = the darkest colour, if the logo carries one (headings, nav)
 * Anything we cannot measure comes back null — never a guess.
 */
function assignRoles(ranked = []) {
  if (!ranked.length) return { accent: null, ink: null, palette: [] };
  const accent = ranked[0].hex;
  const darkest = [...ranked].sort((a, b) => luminance(a.r, a.g, a.b) - luminance(b.r, b.g, b.b))[0];
  const ink = darkest && luminance(darkest.r, darkest.g, darkest.b) < 0.4 && darkest.hex !== accent
    ? darkest.hex
    : null;
  return { accent, ink, palette: ranked.map((c) => c.hex) };
}

// --- applying a measured brand to a boilerplate ------------------------------

/**
 * #rrggbb -> {h,s,l} with s/l as percentages, matching the "H S% L%" form the
 * boilerplates store in CSS custom properties (e.g. `--accent: 152 100% 40%`).
 */
function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255, g = ((int >> 8) & 255) / 255, b = (int & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** "H S% L%" — the exact shape these boilerplates expect. */
function hslTriplet(hex) {
  const hsl = hexToHsl(hex);
  return hsl ? `${hsl.h} ${hsl.s}% ${hsl.l}%` : null;
}

/**
 * Rewrite a boilerplate stylesheet so its accent becomes the CLIENT's colour.
 *
 * Only the accent custom-properties are touched. Rewriting every colour would
 * wreck the template's contrast relationships (foreground/background pairs are
 * tuned against each other); swapping the accent is what makes the page read as
 * the client's brand while keeping the design intact.
 *
 * `--accent-glow` is derived rather than copied so the existing gradient keeps
 * its depth instead of flattening to a single flat colour.
 */
/** sRGB hex -> OKLCH {l (0-1), c, h(deg)}. Same math as the CSS oklch() space. */
function hexToOklch(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const srgb = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((v) => v / 255);
  const lin = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [r, g, bl] = lin;
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c: C, h: H };
}

/**
 * Re-hue a donor's SURFACE palette to the client's primary colour.
 *
 * WHY THIS EXISTS (owner, 2026-08-05, reviewing the RiverCity mirror): the
 * accent remap alone left "this dramatic blue and teal look for their current
 * website and our golden white look on our site". The client's brand is TWO
 * colours; only one of them was ever applied.
 *
 * The donor's oklch surfaces encode its whole contrast design in LIGHTNESS.
 * So lightness is never touched. Hue becomes the client's; chroma is lifted
 * toward the client's but bounded, so a near-neutral donor tint reads clearly
 * as their colour without turning garish. Alpha suffixes are preserved.
 */
/**
 * applyLiteralHues(text, { primary }) — re-hue BARE oklch() colours.
 *
 * applySurfaceToCss deliberately touches only `--custom-property:` declarations.
 * That left the donor's decoration untouched, and the decoration is where the
 * donor's brand actually hides: the plumbing hero's glow is a literal
 * `oklch(0.96 0.02 80 / 0.2)` — hue 80, amber — baked into a utility class
 * inside the COMPILED JS BUNDLE, not into any variable. So the surfaces went
 * navy, the accent went teal, and a gold wash still sat over the hero.
 *
 * Rule, identical to the surface pass: lightness and alpha are never touched
 * (they encode the donor's contrast design), chroma is preserved, only HUE
 * moves to the client's. NEUTRALS ARE LEFT ALONE — a colour below the chroma
 * floor is greyscale scaffolding (borders, shadows, paper), and tinting those
 * is how a recolour starts looking like a filter.
 */
function applyLiteralHues(text, { primary, minChroma = 0.015 } = {}) {
  const target = hexToOklch(primary);
  if (!target || !text) return { text, changed: 0 };
  let changed = 0;
  const out = text.replace(
    /(^|[^-\w])oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*(\/\s*[^)]+)?\)/gi,
    (all, lead, L, C, _H, alpha) => {
      const c = Number(C);
      if (!(c >= minChroma)) return all;
      changed++;
      const pct = /%/.test(all.slice(all.indexOf(L) + String(L).length, all.indexOf(L) + String(L).length + 1));
      return `${lead}oklch(${L}${pct ? "%" : ""} ${C} ${target.h.toFixed(1)}${alpha ? ` ${alpha.trim()}` : ""})`;
    },
  );
  return { text: out, changed };
}

/**
 * applyFontsToCss(cssText, { display, body }) — wear the CLIENT's typeface.
 *
 * The donor declares its faces as custom properties (`--font-display`,
 * `--font-sans`, `--font-body`). Rewriting those swaps the typography
 * everywhere at once — headings, body, buttons — without touching a single
 * layout rule, because every component already reads the variable.
 *
 * The donor's own fallback chain is KEPT behind the client's family: if their
 * webfont fails to load, the page degrades to the face the donor was designed
 * around instead of to Times New Roman.
 */
function applyFontsToCss(cssText, { display = "", body = "" } = {}) {
  if (!cssText || (!display && !body)) return { css: cssText, changed: 0 };
  let changed = 0;
  const esc = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A declaration value we must NOT touch: inherit (button/input reset),
  // monospace stacks (code/kbd/pre), or a value that already leads with the
  // client family. Prepending to any of these corrupts the compiled bundle.
  const guarded = (family, value) => {
    const v = value.trim();
    if (/^\s*inherit\b/i.test(v)) return null;
    if (/\b(mono|ui-monospace|monospace)\b/i.test(v)) return null;
    if (new RegExp(`^\\s*["']?${esc(family)}["']?\\s*,?`, "i").test(v)) return null;
    return v;
  };
  // 1) The donor's --font-* custom properties (covers the 4 var-donors).
  const swapVar = (varName, family) => {
    if (!family) return;
    const re = new RegExp(`(--${varName}\\s*:\\s*)([^;}]+)`, "gi");
    cssText = cssText.replace(re, (all, head, rest) => {
      const v = guarded(family, rest);
      if (v === null) return all;
      changed += 1;
      return `${head}"${family}", ${v}`;
    });
  };
  swapVar("font-display", display);
  swapVar("font-sans", body);
  swapVar("font-body", body);
  // 2) Literal `font-family:` declarations inside specific rules. 7/11 donors
  //    (fencing included) bake the family as a literal, not a --font-* var, so
  //    the client's captured face downloads via <link> but is referenced by
  //    nothing. `[^}]*?` stays inside the rule and never crosses `}`. The donor
  //    fallback chain is kept behind the client family.
  const swapRule = (rulePattern, family) => {
    if (!family) return;
    cssText = cssText.replace(rulePattern, (all, head, value) => {
      const v = guarded(family, value);
      if (v === null) return all;
      changed += 1;
      return `${head}"${family}", ${v}`;
    });
  };
  // Headings (element rule) -> display face.
  swapRule(/(h1\s*,\s*h2\s*,\s*h3\s*,\s*h4\s*,\s*h5\s*,\s*h6\s*\{[^}]*?font-family:\s*)([^;}]+)/gi, display);
  // Tailwind `.font-display{...}` utility -> display face.
  swapRule(/(\.font-display\s*\{[^}]*?font-family:\s*)([^;}]+)/gi, display);
  // Tailwind arbitrary-value heading utility `.font-\['Outfit'\]{...}` (the
  // 38x heading class on fencing, whose class specificity beats the h1..h6
  // element rule) -> display face. Mandatory to cure Metro Fence.
  swapRule(/(\.font-\\\[[^}]*?font-family:\s*)([^;}]+)/gi, display);
  // Base body/html rule -> body face (bare `body{`/`html{` only, never
  // `body.dark{` or `code,kbd,samp,pre{`).
  swapRule(/((?:^|[}])\s*body\s*\{[^}]*?font-family:\s*)([^;}]+)/gi, body);
  swapRule(/((?:^|[}])\s*html\s*\{[^}]*?font-family:\s*)([^;}]+)/gi, body);
  return { css: cssText, changed };
}

function applySurfaceToCss(cssText, { primary } = {}) {
  const target = hexToOklch(primary);
  if (!target || !cssText) return { css: cssText, changed: 0 };
  let changed = 0;
  // Only custom-property declarations, so arbitrary inline colours in the
  // donor's own art are left alone.
  const css = cssText.replace(
    /(--[a-z0-9-]+:\s*)oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(\/\s*[^)]+)?\)/gi,
    (_all, head, L, C, _H, alpha) => {
      changed++;
      const donorC = Number(C);
      // Chroma budget by lightness. The same chroma reads as a rich navy at
      // 12% lightness and as a tinted-blue "white" at 96% — a near-white
      // surface must stay near-white, so the budget widens as the surface
      // darkens. Never below the donor's own chroma.
      const l = Number(L) / 100;
      const budget = Math.max(donorC, 0.03 + (1 - l) * 0.06);
      // Clamp the client's chroma INTO the donor's band. Math.min alone let a
      // greyscale brand (chroma 0) flatten a colourful donor to neutral.
      const c = Math.max(donorC, Math.min(target.c, budget));
      return `${head}oklch(${L}% ${c.toFixed(3)} ${target.h.toFixed(1)}${alpha ? ` ${alpha.trim()}` : ""})`;
    },
  );
  return { css, changed, hue: Number(target.h.toFixed(1)) };
}

/**
 * The donor's SECOND BRAND COLOUR slot — the one a customer can actually see.
 *
 * WHY THIS EXISTS (owner, 2026-08-05, on the Rimrock Plumbing mirror): "our CSS
 * colors background integration is not happening… they have way more use of
 * this green color, and we are just doing the black with the gold again."
 *
 * He was right, and applySurfaceToCss is why. That pass moves the donor's
 * SURFACE variables to the client's hue but must not touch their lightness,
 * because those variables are the page's paper and its ink. On Rimrock's live
 * mirror they came out as
 *     --bone:   oklch(96% 0.032 135.1)
 *     --slurry: oklch(12% 0.083 135.1)
 * Hue 135 IS their green (#6db33f). At 96% and 12% lightness with chroma 0.03
 * it is off-white and near-black. The green was applied where nobody can see
 * it, so the only colour left on the page was the gold accent.
 *
 * The fix is not more re-hueing — it is giving the second colour a PAINT ROLE.
 * A donor opts in by declaring `--brand-secondary` in its :root and wiring an
 * existing role at it (plumbing-clean points `--copper` there: section
 * eyebrows, step numbers, the full-width CTA band, the hero wash, form focus
 * borders). This pass fills that slot and nothing else. A donor that does not
 * declare the slot comes back BYTE-IDENTICAL — we never invent a role in a
 * design we did not draw.
 *
 * THE NAME IS DELIBERATE. It is `--brand-secondary`, not `--secondary`,
 * because 8 of the 9 clean donors already ship shadcn's `--secondary` and there
 * it means the opposite thing: a near-neutral muted panel, always declared
 * beside its `--secondary-foreground` text colour (plumbing-premier:
 * `--secondary: 206 22% 92%` / `--secondary-foreground: 213 45% 14%`). Writing
 * a saturated brand colour into that pair would put a loud colour behind body
 * text on eight donors at once.
 *
 * Lightness is CLAMPED into the band the donor designed this role at, exactly
 * as applyBrandToCss does for the accent: the role is used both as text on the
 * light surface and as a fill under light text, so its lightness is what those
 * two contrast pairs were tuned against. Hue and saturation are the client's —
 * that is the part a person recognises as their brand.
 */
function applySecondaryToCss(cssText, { secondary, maxLightnessDrift = 14 } = {}) {
  const hsl = hexToHsl(secondary);
  if (!hsl || !cssText) return { css: cssText, changed: 0 };

  let changed = 0;
  let donorLightness = null;
  let appliedLightness = null;
  let lightnessClamped = false;

  // The leading `^|[{;]` makes this a whole DECLARATION rather than a substring
  // match, so a donor that ever ships `--x-brand-secondary` is not hit by it.
  const css = cssText.replace(
    /(^|[{;])(\s*--brand-secondary\s*:\s*)([^;}]+)/gi,
    (_all, lead, head, value) => {
      // Resolve against the ORIGINAL stylesheet — cssText, not the partially
      // rewritten output — so every slot in the file reads the same default.
      const donor = resolveHslTripletVar(cssText, value);
      let L = hsl.l;
      if (donor) {
        donorLightness = donor.l;
        const lo = Math.max(0, donor.l - maxLightnessDrift);
        const hi = Math.min(100, donor.l + maxLightnessDrift);
        if (L < lo) { L = lo; lightnessClamped = true; }
        else if (L > hi) { L = hi; lightnessClamped = true; }
      }
      appliedLightness = L;
      changed++;
      return `${lead}${head}${hsl.h} ${hsl.s}% ${L}%`;
    },
  );

  return { css, changed, hue: hsl.h, saturation: hsl.s, donorLightness, appliedLightness, lightnessClamped };
}

/**
 * Follow a custom property's value to the `H S% L%` triplet behind it.
 *
 * The slot's donor default is allowed to be an indirection, and in
 * plumbing-clean it is: `--brand-secondary: var(--accent-glow)`. That default
 * is what makes the slot collapse correctly — a client with no measured second
 * colour keeps the donor's own arrangement AND still follows their accent,
 * instead of stranding the role on the donor's gold. Reading the lightness it
 * was designed at therefore means chasing one hop, so chase up to four.
 */
function resolveHslTripletVar(cssText, value, depth = 0) {
  const raw = String(value == null ? "" : value).trim();
  const direct = /^(\d{1,3})\s+(\d{1,3})%\s+(\d{1,3})%$/.exec(raw);
  if (direct) return { h: Number(direct[1]), s: Number(direct[2]), l: Number(direct[3]) };
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw);
  if (!ref || depth >= 4) return null;
  const found = new RegExp(`${ref[1]}\\s*:\\s*([^;}]+)`, "i").exec(cssText);
  return found ? resolveHslTripletVar(cssText, found[1], depth + 1) : null;
}

// How far from the donor's accent hue a declaration can sit and still count as
// part of the accent family. 30 degrees is roughly one step around a colour
// wheel: it catches a donor's gold-and-amber pairing (18 and 32) without ever
// reaching into a neighbouring role.
const ACCENT_FAMILY_TOLERANCE = 30;
// Below this saturation a colour is doing a NEUTRAL's job — a tinted grey, a
// near-white foreground — and rotating its hue changes nothing a customer would
// call their brand while risking the contrast pair it belongs to.
const ACCENT_MIN_SATURATION = 25;

function protectCssComments(cssText) {
  const comments = [];
  const masked = String(cssText || "").replace(/\/\*[\s\S]*?\*\//g, (comment) => {
    const index = comments.push(comment) - 1;
    return "/*!wss-comment-" + index + "*/";
  });
  return {
    masked,
    restore(value) {
      return String(value || "").replace(/\/\*!wss-comment-(\d+)\*\//g, (_all, index) => comments[Number(index)] || _all);
    },
  };
}



/**
 * Enforce readable text on every paired shadcn color variable.
 *
 * The recolor passes map the donor's brand hues onto the client's — and they
 * mapped `--primary-foreground` right along with `--primary`. Measured live on
 * Texas Best Fence & Patio (2026-08-20): --primary landed at `31 30% 15%`
 * (their dark brown) and --primary-foreground at `32 32% 16%` — button text
 * one lightness point away from its own fill. Every CTA on the page rendered
 * as a dark pill with invisible text.
 *
 * The foreground of a pair is not a brand hue; it is WHATEVER READS on the
 * base. So after all hue passes: for each `--X` that has an `--X-foreground`
 * in :root-scope custom props (h s% l% triplet form), if the WCAG contrast of
 * the pair is under 4.5:1, the foreground is rewritten to near-white on a dark
 * base or near-black on a light base. Pairs that already read fine are left
 * exactly as the donor designed them.
 */
function hslTripletToRgb(triplet) {
  const m = String(triplet || "").trim().match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return null;
  const h = ((Number(m[1]) % 360) + 360) % 360 / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const chan = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [chan(h + 1 / 3), chan(h), chan(h - 1 / 3)].map((v) => Math.round(v * 255));
}

function wcagRelativeLuminance([r, g, b]) {
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : (((c + 0.055) / 1.055) ** 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function wcagContrast(rgbA, rgbB) {
  const a = wcagRelativeLuminance(rgbA);
  const b = wcagRelativeLuminance(rgbB);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function enforcePairedForegroundContrast(cssText, { floor = 4.5 } = {}) {
  if (!cssText) return { css: cssText, changed: 0, repaired: [] };
  const VAR_RE = /--([a-z0-9-]+)\s*:\s*(-?[\d.]+\s+[\d.]+%\s+[\d.]+%)\s*[;}]/gi;
  const bases = new Map();
  let m;
  while ((m = VAR_RE.exec(cssText))) {
    const name = m[1].toLowerCase();
    if (!name.endsWith("-foreground") && !bases.has(name)) bases.set(name, m[2]);
  }
  let changed = 0;
  const repaired = [];
  const css = cssText.replace(
    /(--([a-z0-9-]+)-foreground\s*:\s*)(-?[\d.]+\s+[\d.]+%\s+[\d.]+%)(\s*[;}])/gi,
    (all, head, baseName, value, tail) => {
      const base = bases.get(String(baseName).toLowerCase());
      const baseRgb = base && hslTripletToRgb(base);
      const fgRgb = hslTripletToRgb(value);
      if (!baseRgb || !fgRgb) return all;
      if (wcagContrast(baseRgb, fgRgb) >= floor) return all;
      const darkBase = wcagRelativeLuminance(baseRgb) < 0.35;
      const fixed = darkBase ? "0 0% 98%" : "240 6% 10%";
      changed += 1;
      repaired.push(`${baseName}-foreground`);
      return `${head}${fixed}${tail}`;
    },
  );
  return { css, changed, repaired };
}

function applyBrandToCss(cssText, { accent, preserveLuminance = true, maxLightnessDrift = 14 } = {}) {
  const triplet = hslTriplet(accent);
  if (!triplet || !cssText) return { css: cssText, changed: 0 };
  const hsl = hexToHsl(accent);
  // CSS comments are documentation, never declarations. The old regex passes
  // rewrote examples such as --accent: H S% L% inside donor comments, and
  // because the match ran through the next semicolon it could swallow the real
  // :root declaration that followed. Mask comments byte-for-byte while the
  // accent family is rewritten, then restore them unchanged.
  const commentGuard = protectCssComments(cssText);
  cssText = commentGuard.masked;

  // LUMINANCE-PRESERVING HUE REMAP.
  //
  // Swapping hue alone breaks the donor's contrast pairs: a donor that pairs
  // its light gold accent with near-black ink becomes unreadable when the
  // client's accent is a dark navy (measured live: 1.99:1 on a primary CALL
  // button, where AA needs 4.5:1). The client's HUE is what a customer
  // recognises as their brand; the donor's LIGHTNESS is what its foreground
  // pairs were tuned against. So we adopt hue + saturation and keep lightness
  // inside the donor's designed band.
  const donorL = (() => {
    const m = /--accent:\s*(\d{1,3})\s+(\d{1,3})%\s+(\d{1,3})%/.exec(cssText);
    return m ? Number(m[3]) : null;
  })();
  let L = hsl.l;
  let clamped = false;
  if (preserveLuminance && donorL != null) {
    const lo = Math.max(0, donorL - maxLightnessDrift);
    const hi = Math.min(100, donorL + maxLightnessDrift);
    if (L < lo) { L = lo; clamped = true; }
    else if (L > hi) { L = hi; clamped = true; }
  }
  const finalTriplet = `${hsl.h} ${hsl.s}% ${L}%`;
  const glow = `${hsl.h} ${hsl.s}% ${Math.max(0, L - 4)}%`;

  let changed = 0;
  let css = cssText.replace(/--accent:\s*[^;]+;/g, () => { changed++; return `--accent: ${finalTriplet};`; });
  css = css.replace(/--accent-glow:\s*[^;]+;/g, () => { changed++; return `--accent-glow: ${glow};`; });

  // THE REST OF THE ACCENT FAMILY.
  //
  // Rewriting --accent alone left a live mirror with a client's BLUE logo and a
  // hero still glowing the donor's gold, because this donor spells its family
  // --accent-soft and paints half the page from bare hsl() literals in Tailwind
  // arbitrary values. Neither was reachable by two fixed variable names, and
  // every donor spells its family differently, so the rule cannot be a list of
  // names: it is "same hue as the donor's accent" — those declarations ARE the
  // accent, wherever they live and whatever they are called.
  //
  // Deliberately NOT touched:
  //   · a different hue (this donor's --primary-glow is blue at 210 and stays
  //     blue — a palette is not one colour),
  //   · anything desaturated (--accent-foreground is a contrast pair, usually
  //     near-white; hue-shifting it would wreck the pairing it exists for),
  //   · lightness anywhere — the donor tuned its own contrast, so only H and S
  //     move and each declaration keeps its own L.
  const donorHue = (() => {
    const m = /--accent:\s*(\d{1,3})\s+(\d{1,3})%\s+(\d{1,3})%/.exec(cssText);
    return m ? Number(m[1]) : null;
  })();
  let family = 0;
  if (donorHue != null) {
    // Circular distance in degrees. Written out rather than golfed because the
    // first version returned `180 - d` and inverted the whole rule: it rotated
    // everything FAR from the donor accent and preserved the accent itself, so
    // a live mirror kept the donor's gold and repainted its blues.
    const near = (h) => {
      const raw = Math.abs(Number(h) - donorHue) % 360;
      const distance = raw > 180 ? 360 - raw : raw;
      return distance <= ACCENT_FAMILY_TOLERANCE;
    };
    // Sibling custom properties: --accent-soft, --accent-2, --brand-accent…
    css = css.replace(
      /(--[a-z0-9-]*accent[a-z0-9-]*)\s*:\s*(\d{1,3})\s+(\d{1,3})%\s+(\d{1,3})%\s*;/gi,
      (whole, name, h, s, l) => {
        if (/foreground/i.test(name)) return whole;
        if (Number(s) < ACCENT_MIN_SATURATION || !near(h)) return whole;
        family++;
        return `${name}: ${hsl.h} ${hsl.s}% ${l}%;`;
      },
    );
    // Bare literals: hsl(18 92% 54%) and the slash-alpha form, as emitted by
    // Tailwind arbitrary values like bg-[hsl(18_92%_54%)].
    css = css.replace(
      /hsl\(\s*(\d{1,3})\s+(\d{1,3})%\s+(\d{1,3})%\s*(\/\s*[^)]+)?\)/gi,
      (whole, h, s, l, alpha) => {
        if (Number(s) < ACCENT_MIN_SATURATION || !near(h)) return whole;
        family++;
        return `hsl(${hsl.h} ${hsl.s}% ${l}%${alpha ? ` ${alpha.trim()}` : ""})`;
      },
    );
  }

  return {
    css: commentGuard.restore(css),
    changed: changed + family,
    familyChanged: family,
    donorLightness: donorL,
    donorHue,
    appliedLightness: L,
    lightnessClamped: clamped,
    hue: hsl.h,
  };
}

// --- donor-asset guard -------------------------------------------------------

/**
 * Brand assets a boilerplate ships that belong to the DONOR, not the client.
 *
 * Verified live on 2026-07-28: roofing-formula-llc-kirkland.wss-ai.com rendered
 * "TEKLINE ROOFING" in its header, beside the client's own name, because
 * assets/logo-*.png is the donor's logo and simply gets copied through. It is an
 * IMAGE, so every text scrubber and QC gate reported PASS while a prospect's
 * first impression was another company's brand.
 *
 * Matches the brand-carrying assets by convention (logo/wordmark/brand/emblem in
 * assets/). Hero photography is deliberately NOT included — that is stock imagery
 * for the template, not an identity claim.
 */
const DONOR_BRAND_ASSET_RE = /(^|\/)assets\/(logo|wordmark|brand|emblem)[-_.][^/]*\.(png|jpe?g|webp|svg)$/i;

function donorBrandAssets(relPaths = []) {
  return relPaths.filter((p) => DONOR_BRAND_ASSET_RE.test(String(p)));
}

/**
 * Fail-closed check: given the files about to ship and the set that were
 * replaced with the client's own asset, return the donor assets still present.
 *
 * A non-empty result must BLOCK the build. Shipping is not a judgement call
 * here — it is another company's mark on a customer's homepage.
 */
function unreplacedDonorAssets(relPaths = [], replaced = []) {
  const done = new Set(replaced);
  return donorBrandAssets(relPaths).filter((p) => !done.has(p));
}

// --- image geometry, read from the BYTES --------------------------------------
//
// WHY (2026-08-07, measured on the live mirrors): eleven headers were rendering
// a FAVICON where the business's name belongs — apple-icon-57x57.png,
// cropped-favicon-180x180.png, paschal_favicon_new-2018.png. A 57-pixel square
// blown up to header width is not a logo; it is a blurred stamp, and it is the
// first thing the prospect sees.
//
// The filename is not evidence. "cropped-favicon-180x180.png" happens to be
// honest; "apple-icon-57x57.png" is 152x152 on disk; and Cardinal's mark is
// called cropped-Screenshot_2024-04-07_at_8.02.41_AM-removebg-preview.png,
// which says nothing at all. So the geometry is DECODED from the header bytes
// of the file itself — no ffmpeg, no dependency, no shelling out (the runtime
// has neither; see lib/png-decode.js for the same lesson learned the hard way).
//
// Only the dimension headers are parsed, never the pixel data, so this is a few
// hundred bytes of work per image and is safe to run on every candidate.

/** SVG's declared geometry: explicit width/height first, then the viewBox. */
function svgDimensions(head) {
  const attr = (name) => {
    const m = new RegExp(`(?<![-\\w])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(head);
    return m ? (m[2] ?? m[3] ?? "").trim() : "";
  };
  // A percentage width is a layout instruction, not a size — it tells us the
  // mark scales, which is exactly what a vector mark does. Fall through to the
  // viewBox, which always carries the real proportions.
  const num = (v) => {
    const m = /^([0-9]*\.?[0-9]+)\s*(px|pt|mm|cm|in|)$/i.exec(String(v).trim());
    return m ? Number(m[1]) : NaN;
  };
  const w = num(attr("width"));
  const h = num(attr("height"));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h, format: "svg" };
  const vb = attr("viewBox").split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    return { width: vb[2], height: vb[3], format: "svg" };
  }
  return null;
}

/** JPEG: walk the marker chain to the frame header. */
function jpegDimensions(buf) {
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }              // resync on padding
    const marker = buf[p + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    // SOF0-3, 5-7, 9-11, 13-15 all carry the frame size at the same offsets.
    // C4 (Huffman tables), C8 (extension) and CC (arithmetic coding) do not.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { width: buf.readUInt16BE(p + 7), height: buf.readUInt16BE(p + 5), format: "jpg" };
    if (len < 2) return null;
    p += 2 + len;
  }
  return null;
}

/** WebP: three container flavours, each storing the size differently. */
function webpDimensions(buf) {
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 " && buf.length >= 30) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: "webp" };
  }
  if (chunk === "VP8L" && buf.length >= 25) {
    const b = [buf[21], buf[22], buf[23], buf[24]];
    return {
      width: 1 + (((b[1] & 0x3f) << 8) | b[0]),
      height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)),
      format: "webp",
    };
  }
  if (chunk === "VP8X" && buf.length >= 30) {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), format: "webp" };
  }
  return null;
}

/**
 * imageDimensions(bytes) -> { width, height, format } | null
 *
 * Never throws and never guesses. A format we cannot read returns null, and
 * every caller must treat that as "unknown", not as "small" — refusing a mark
 * we simply failed to parse would throw away real logos.
 */
function imageDimensions(input) {
  const buf = Buffer.isBuffer(input) ? input : input ? Buffer.from(input) : null;
  if (!buf || buf.length < 16) return null;
  try {
    if (buf.readUInt32BE(0) === 0x89504e47 && buf.toString("ascii", 12, 16) === "IHDR") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "png" };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return jpegDimensions(buf);
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return webpDimensions(buf);
    if (["GIF87a", "GIF89a"].includes(buf.toString("ascii", 0, 6))) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: "gif" };
    }
    if (buf.toString("ascii", 0, 2) === "BM") {
      return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)), format: "bmp" };
    }
    // ICO/CUR: a directory of sizes. Take the LARGEST entry — that is what a
    // browser would pick, and 0 means 256 by spec.
    if (buf.readUInt32LE(0) === 0x00010000 || buf.readUInt32LE(0) === 0x00020000) {
      const count = buf.readUInt16LE(4);
      let best = null;
      for (let i = 0; i < count && 6 + i * 16 + 2 < buf.length; i++) {
        const o = 6 + i * 16;
        const w = buf[o] || 256;
        const h = buf[o + 1] || 256;
        if (!best || w * h > best.width * best.height) best = { width: w, height: h, format: "ico" };
      }
      return best;
    }
    const head = buf.toString("utf8", 0, Math.min(buf.length, 4096));
    if (/<svg[\s>]/i.test(head)) return svgDimensions(head);
  } catch {
    return null;                                  // a truncated header is unknown, not zero
  }
  return null;
}

// --- is this a HEADER MARK, or a site icon? ----------------------------------
//
// THE CALL, and the evidence behind it.
//
// Eleven live mirrors put a FAVICON where the company name belongs. Measured on
// the served bytes, 2026-08-07: Paschal 50x50, JAM Plumbing 57x57, Platero
// Parada 90x92, Knoxville Concrete Kings 100x92, Fix It All 141x111, and then a
// dense band of WordPress/Apple site icons — The Local Guys 150x150, Monolith
// 179x179, and 180x180 for Crown, Edwards, JL, McIndy, Middletown, Noble, Royal
// Ink and The Drain Surgeon; Diamond State 192x192; Cardinal 200x200.
//
// Rendering those headers settles the argument. Edwards' and JL's are opaque
// WHITE BOXES sitting on a coloured header. Paschal's and JAM's are visibly
// mushy — a 50px source in a slot the browser asks 144 device pixels for. The
// Drain Surgeon's is a nameless cartoon plumber. In this donor the header logo
// is the ONLY identity in the bar: there is no name text beside it, just empty
// space and then the nav. A site icon there leaves the page anonymous.
//
// The alternative is not "nothing". forge.js/brandWordmarkSvg sets the
// business's REAL NAME as clean type in their own measured brand colour. It is
// their name, it is legible at any size, and it looks deliberate. And in
// practice the alternative is usually better than that: refusing the icon lets
// the NEXT candidate through, which is normally the client's actual mark that
// the icon was shadowing (Paschal mainLogo.png 334x154; Galli's own logo at
// 1024x540 instead of its 137x72 thumbnail; Cardinal's 535x467 original instead
// of a 200x200 Elementor crop).
//
// So the rule is: a header mark must be big enough that the header does not
// have to invent pixels. Both thresholds sit in MEASURED EMPTY BANDS of the
// live distribution, so neither is a guess:
//
//   * WORDMARK_MIN_RATIO 1.6 — wider than 8:5 is a lockup or a wordmark, the
//     shape the slot is built for. Below that it is an emblem or an icon.
//   * WIDE_MIN_WIDTH 160 — among wide marks the only two failures were 137x72
//     and 150x58 (both WordPress crops of a larger original); the smallest
//     genuine wordmark measured 165x85. 137/150 | 165: the gap is 150-165.
//   * HEADER_MIN_PX 216 — among square marks the site-icon family tops out at
//     200x200 and the smallest genuine square logo measured 300x230. The gap is
//     200-230, and 216 is also exactly what the slot demands: the donor lays the
//     mark out at 72 CSS px, and a phone at 3x asks for 72*3 = 216 device
//     pixels. The physics and the data agree on the same number.
//
// Vector marks are exempt: an SVG has no native resolution, so a 1:1 SVG crest
// renders perfectly at any size. Shape alone never disqualifies it.
const WORDMARK_MIN_RATIO = 1.6;
const HEADER_MIN_PX = 216;
const WIDE_MIN_WIDTH = 160;

/**
 * classifyHeaderMark(bytes, { url }) ->
 *   { ok, kind, width, height, ratio, format, reason }
 *
 * `ok:false` means "do not put this in the HEADER" — the caller should try the
 * next candidate and, failing that, ship the client's wordmark. It never means
 * the file is not theirs, and it is not a truth-law failure: the bytes are
 * still the client's own icon and remain fine as a colour source.
 *
 * UNKNOWN GEOMETRY PASSES. A format this parser cannot read (AVIF, a truncated
 * fetch) yields ok:true with kind "unknown": we refuse what we have MEASURED to
 * be too small, never what we merely failed to measure. The direction of error
 * matters — a false refusal costs the client their real mark.
 */
function classifyHeaderMark(bytes, { url = "" } = {}) {
  const dim = imageDimensions(bytes);
  if (!dim || !(dim.width > 0) || !(dim.height > 0)) {
    return { ok: true, kind: "unknown", width: null, height: null, ratio: null, format: null, reason: "dimensions_unreadable" };
  }
  const { width, height, format } = dim;
  const ratio = width / height;
  const base = { width, height, ratio: Number(ratio.toFixed(3)), format, url: String(url || "").slice(0, 200) };

  // A vector mark is resolution-independent: there is nothing to upscale.
  if (format === "svg") return { ok: true, kind: "vector", ...base, reason: "vector_scales_losslessly" };

  if (ratio >= WORDMARK_MIN_RATIO) {
    return width >= WIDE_MIN_WIDTH
      ? { ok: true, kind: "wordmark", ...base, reason: `wide_mark_${width}x${height}` }
      : { ok: false, kind: "thumbnail", ...base, reason: `wide_but_only_${width}px_wide_min_${WIDE_MIN_WIDTH}` };
  }

  const shortEdge = Math.min(width, height);
  return shortEdge >= HEADER_MIN_PX
    ? { ok: true, kind: "emblem", ...base, reason: `square_${width}x${height}_is_header_grade` }
    : { ok: false, kind: "site_icon", ...base, reason: `icon_${width}x${height}_below_${HEADER_MIN_PX}px_header_minimum` };
}

// --- IO edge -----------------------------------------------------------------

/** Decode an image to a small raw RGB buffer via ffmpeg. Downscaled on purpose:
 *  we want dominant colour, and 64x64 is both far faster and less noisy. */
function decodeToRgb(file, { size = 64, ffmpeg = "ffmpeg" } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      ["-v", "error", "-i", file, "-vf", `scale=${size}:${size}:flags=bilinear`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/** RGBA decode — the transparency-safe path for logo measurement. Pair with
 *  rankColors(buf, { channels: 4 }) so transparent pixels never vote. */
function decodeToRgba(file, { size = 64, ffmpeg = "ffmpeg" } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      ["-v", "error", "-i", file, "-vf", `scale=${size}:${size}:flags=bilinear`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const LOGO_RE = /(^|[/\\_-])logo([_-]|\.|$)/i;

// Third-party marks that live in every small-business site's media folder:
// social icons, review badges, trade associations, payment logos.
//
// This list is NOT cosmetic. A first pass matched "1024px-Facebook_f_logo_2021"
// on the word "logo" and confidently reported Facebook blue (#15a3fa) as a
// roofing company's brand colour. Shipping that paints someone else's identity
// onto the client's site — the same failure as the Tekline and donor-name leaks,
// just wearing a palette. Anything here can never be treated as the client's own.
const THIRD_PARTY_RE = new RegExp(
  [
    "facebook", "fb[_-]?img", "instagram", "twitter", "(?<![a-z])x[_-]logo", "linkedin", "youtube",
    "tiktok", "pinterest", "snapchat", "nextdoor", "whatsapp",
    "google", "yelp", "bbb", "better[_-]?business", "homeadvisor", "angi", "angies",
    "thumbtack", "houzz", "trustpilot", "porch", "buildzoom",
    "visa", "mastercard", "amex", "discover", "paypal", "stripe", "venmo",
    // Amazon's mark, WITHOUT swallowing AWS infrastructure hosts. This regex is
    // also run against `hostname + path + query` (brand-assets.js), where a bare
    // "amazon" would hard-fail every client logo served from s3.amazonaws.com —
    // rejecting the client's own brand as someone else's. The lookahead keeps
    // the mark ("amazon-logo.png", "shop-on-amazon-badge.svg") and lets the
    // carrier host ("acme-co.s3.amazonaws.com/logo.png") through.
    "amazon(?!aws|ses)", "amzn",
    "gaf", "owens[_-]?corning", "certainteed", "atlas", "iko", "malarkey", "tamko",
    // "epa" needs letter boundaries or it matches inside "rEPAir" — and
    // "repair" is the commonest word in a plumbing logo filename. Measured
    // 2026-08-06: drain-repair-logo.png was refused as an EPA badge. Same shape
    // for the X (Twitter) mark: bare "x[_-]logo" matches inside "maxx-logo.png".
    // Both lookarounds NARROW the denylist, and only where it was refusing the
    // client's own mark; nothing that this list ever caught legitimately stops
    // being caught (epa-certified.png, epa_logo.png, twitter-x-logo.png all
    // still match).
    "energy[_-]?star", "nrca", "osha", "nari", "(?<![a-z])epa(?![a-z])",
    "wordpress", "wix", "squarespace", "godaddy", "shopify", "duda", "weebly",
    // Blogging platforms. Added 2026-08-06 with the mark live on our own host:
    // wss-test-all-home-plumbing-co-chattanooga.wss-ai.com/assets/client-logo.png
    // was Google's orange Blogger "B" (32747 bytes, sha256 79d6232a…), taken
    // from allhomeplumbing.com/images/blogger_logo.png — a "follow our blog"
    // badge sitting in the client's own /images folder, so sameOwner passed and
    // the basename said "logo". It shipped as their schema.org Organization
    // logo. "google" was already on this list and did not catch it; the product
    // name is what appears in the filename.
    "blogger", "blogspot",
    // PLUMBING / HVAC MANUFACTURER BADGES — the same family as the roofing marks
    // above, which were added after the APOC incident, and missing for the lane
    // we actually mine. Proven the same day, also live:
    // wss-test-simmons-plumbing-and-mechanical-llc-albuqu.wss-ai.com served
    // Mastercool, Inc.'s registered trademark ("Mastercool® World Class
    // Quality", sha256 844aa338…) as Simmons Plumbing's own mark, and the
    // client's whole palette was then measured from Mastercool's blue.
    // A contractor's site displays the brands they install; those badges live on
    // the contractor's own domain and are named "<brand>-logo.png", which is
    // exactly the shape this denylist exists to refuse.
    //
    // Only tokens that read as a manufacturer and not as a plausible business
    // name are listed. "carrier", "york", "goodman" and "amana" are deliberately
    // ABSENT: a real "York Plumbing" exists and refusing it would cost a lead to
    // block a badge. The direction of error for everything that IS here is the
    // safe one — we lose a lead named after a fixture brand rather than publish
    // somebody else's trademark as a client's identity.
    "mastercool", "rheem", "rinnai", "navien", "noritz", "bradford[_-]?white",
    "ao[_-]?smith", "insinkerator", "zoeller", "moen", "kohler", "grohe",
    "american[_-]?standard", "delta[_-]?faucet", "trane", "lennox", "daikin",
  ].join("|"),
  "i",
);

// Hosts that ARE the third-party mark. brand-assets.js hands this function a
// `hostname + path + query` probe precisely so a Facebook tracking pixel —
// facebook.com/tr?id=…&ev=PageView — is caught, but the basename test below
// sees only "tr?id=…" and passed it. The pixel defense was documented and
// broken; this is the half that reads the host.
//
// Deliberately NOT here: google / gstatic / googleusercontent. Google hosts
// carry the client's own Business Profile photos, which the photo harvester
// depends on. Denying them would throw away the client's real photography to
// block a logo the basename test already catches.
const THIRD_PARTY_HOST_RE = new RegExp(
  "(^|\\.)(" + [
    "facebook", "fbcdn", "instagram", "cdninstagram", "twitter", "twimg", "linkedin", "licdn",
    "youtube", "ytimg", "tiktok", "pinterest", "pinimg", "snapchat", "nextdoor",
    "yelp", "yelpcdn", "bbb", "homeadvisor", "angi", "angies", "thumbtack", "houzz",
    "trustpilot", "buildzoom", "paypal", "venmo",
  ].join("|") + ")\\.[a-z]{2,}(\\.[a-z]{2,})?$",
  "i",
);

/**
 * True when a media file is a third-party mark rather than the client's own.
 *
 * Accepts either a filesystem path or a `hostname/path?query` probe. The
 * filename test catches the mark by name; the host test catches an asset served
 * BY the third party, whose filename gives nothing away.
 */
function isThirdPartyMark(file) {
  const raw = String(file || "");
  if (THIRD_PARTY_RE.test(path.basename(raw))) return true;
  const host = raw.split(/[/?#]/)[0];
  return host.includes(".") && THIRD_PARTY_HOST_RE.test(host);
}

/**
 * The same denylist, run against FREE TEXT rather than a path.
 *
 * WHY (2026-08-06): smithandsonstx.com labels its Google review badge
 * `alt="Google Reviews logo"` and its neighbours "Facebook Reviews logo" and
 * "Yelp logo". The filenames — logo-02/03/04-free-img.png — name nothing, so
 * isThirdPartyMark saw nothing and the badge shipped as the client's identity.
 * The page said whose mark it was in words; this reads the words.
 *
 * Callers must only apply this where the text does NOT also carry the client's
 * own name: a contractor legitimately writes "Acme Plumbing — Google Guaranteed"
 * in the alt of their own logo, and a positive identification of the client
 * outranks the presence of somebody else's name.
 */
function namesThirdPartyMark(text) {
  return THIRD_PARTY_RE.test(String(text || ""));
}

function listMedia(captureDir) {
  const mediaDir = path.join(captureDir, "theme", "assets", "media");
  if (!fs.existsSync(mediaDir)) return [];
  return fs.readdirSync(mediaDir).filter((f) => IMAGE_RE.test(f)).map((f) => path.join(mediaDir, f));
}

/**
 * Candidate logo files for THIS client, best first.
 *
 * Third-party marks are excluded outright, never merely deprioritised — a badge
 * we cannot rule out is not a brand source. Remaining candidates are ranked by
 * how cleanly the filename reads as a primary logo, so "logo-a1b2c3.png" wins
 * over "footer-logo-small-alt.png".
 */
function findLogos(captureDir) {
  return listMedia(captureDir)
    .filter((f) => LOGO_RE.test(path.basename(f)) && !isThirdPartyMark(f))
    .sort((a, b) => logoRank(a) - logoRank(b));
}

/**
 * Lower is better.
 *
 * The demotion outweighs the "starts with logo-" bonus on purpose: a file named
 * "logo-icon-mono.png" is a stripped one-colour variant, and reading a palette
 * from it yields a monochrome brand. A plain "header-logo.png" is a better
 * source than any icon/mono/favicon variant, however well-named the variant is.
 */
function logoRank(file) {
  const name = path.basename(String(file || "")).toLowerCase();
  let score = name.length; // tie-break: simpler names are usually the primary mark
  if (/^logo[_-]/.test(name)) score -= 1000;                       // "logo-<hash>.png"
  if (/(header|primary|main|brand)/.test(name)) score -= 200;
  if (/(footer|small|alt|mobile|white|dark|mono|icon|favicon)/.test(name)) score += 1500;
  return score;
}

function findBeforeShot(captureDir) {
  const p = path.join(captureDir, "preview", "home.png");
  return fs.existsSync(p) ? p : null;
}

/**
 * Build the brand kit for one captured site.
 *
 * Returns { accent, ink, palette, logo, beforeShot, photos, measured }.
 * `measured` is false when no logo colour could be read — the caller must then
 * choose a fallback deliberately instead of inheriting a silent default.
 */
async function brandFromCapture(captureDir, { decode = decodeToRgb } = {}) {
  const logos = findLogos(captureDir);
  // Photos are the client's OWN imagery only. Review badges, social icons and
  // manufacturer marks are somebody else's property and are not evidence of this
  // business's work — presenting them as gallery photos is the same truth-law
  // breach as an invented testimonial.
  const photos = listMedia(captureDir).filter(
    (f) => !LOGO_RE.test(path.basename(f)) && !isThirdPartyMark(f),
  );
  const beforeShot = findBeforeShot(captureDir);

  for (const logo of logos) {
    let ranked = [];
    try {
      // RGBA first so transparent pixels cannot vote (see rankColors header);
      // fall back to the RGB decoder for formats ffmpeg gives us opaque.
      try {
        ranked = rankColors(await decodeToRgba(logo), { channels: 4 });
      } catch {
        ranked = [];
      }
      if (!ranked.length) ranked = rankColors(await decode(logo));
    } catch {
      continue; // unreadable file — try the next logo candidate
    }
    if (!ranked.length) continue;
    return { ...assignRoles(ranked), logo, beforeShot, photos, measured: true };
  }

  return { accent: null, ink: null, palette: [], logo: logos[0] || null, beforeShot, photos, measured: false };
}

module.exports = {
  // pure
  isThirdPartyMark,
  namesThirdPartyMark,
  logoRank,
  donorBrandAssets,
  unreplacedDonorAssets,
  hexToHsl,
  hslTriplet,
  applyBrandToCss,
  enforcePairedForegroundContrast,
  imageDimensions,
  wcagContrast,
  wcagRelativeLuminance,
  hslTripletToRgb,
  applyLiteralHues,
  applyFontsToCss,
  applySurfaceToCss,
  applySecondaryToCss,
  hexToOklch,
  toHex,
  luminance,
  saturation,
  isBrandCandidate,
  rankColors,
  assignRoles,
  classifyHeaderMark,
  WORDMARK_MIN_RATIO,
  HEADER_MIN_PX,
  WIDE_MIN_WIDTH,
  // io
  decodeToRgb,
  decodeToRgba,
  findLogos,
  findBeforeShot,
  listMedia,
  brandFromCapture,
};
