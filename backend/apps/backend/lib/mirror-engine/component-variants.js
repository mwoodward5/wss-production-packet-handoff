"use strict";

// lib/mirror-engine/component-variants.js — TEMPLATE DIVERSIFICATION.
//
// Owner directive (video report, 2026-09-02): "Atlanta and Jeff Sullivan WSS
// renders share a very similar hero composition, header, typography scale,
// red CTA treatment, section rhythm, and light-page component system. Add a
// similarity budget so donor-independent sites cannot converge too strongly."
//
// Two unrelated prospects built from the SAME donor used to receive the same
// geometry, the same heading sizes, the same button treatment and the same
// section rhythm — everything the donor's compiled dist ships — because the
// engine only ever re-skinned colours (theme.js) and words (content-inject).
// The donor's LAYOUT was law. This module makes layout a CHOICE, made
// deterministically per prospect, so a shared donor can no longer produce
// same-looking sites:
//
//   1. THE CATALOG. Every major section type (hero, services, about, gallery,
//      testimonials, contact, footer) has 3-5 named visual variants with
//      different geometry, spacing and type scale. The variants are CSS
//      packages appended after the donor's stylesheet (the same discipline as
//      the theme sheet — donor bytes stay byte-identical) plus, on static-HTML
//      donors, data-wss-section hooks stamped by the reorder pass.
//
//   2. SELECTION BY DONOR FINGERPRINT. The donor fingerprint — the
//      measurement lane's reading of the donor's design (mode, photo-led,
//      typography, section_order) — PINS the axes it speaks about: a
//      dark/photo-led donor gets the full-bleed hero, a light/text-minimal
//      donor gets the minimal hero, a condensed-type donor gets the tall
//      condensed scale, and a donor whose fingerprint carries section_order
//      keeps that order. Axes the fingerprint does not pin are chosen by a
//      SEEDED pick (seed = prospect identity + donor), so the selection is
//      deterministic per prospect and stable across rebuilds.
//
//   3. THE SIMILARITY BUDGET. For any two sites built from the same donor, at
//      least 2 of {hero variant, section order, CTA treatment, typography
//      scale} must differ. When a second prospect's selection would collide
//      with a prior same-donor selection on every axis, the second one gets a
//      DETERMINISTIC ROTATION (advance the CTA/scale/hero indices by the
//      rotation step) until the budget clears. Pins are respected first; the
//      budget outranks a typography cue when honouring it would converge two
//      sites (the cue describes the donor, not the prospect — two prospects
//      share it by construction).
//
//   4. SECTION ORDER FROM THE DONOR. When the fingerprint carries
//      section_order, the generated site preserves the donor's meaningful
//      order (reviews before services stays reviews before services) instead
//      of every site walking the same template sequence. Applied by slot-
//      preserving reordering of the plain-HTML <section> elements on static
//      donors — never on SPA donors, whose sections are created at runtime by
//      the compiled bundle.
//
//   5. TYPOGRAPHY SCALE VARIATION. Three heading scales (condensed-tall,
//      normal, wide-short — see theme.js, which owns the CSS) selected by
//      donor typography cues, seeded otherwise. Two sites from the same donor
//      do not share a heading scale unless the donor's fingerprint calls for
//      one and the similarity budget can still clear elsewhere.
//
// The whole system is FAIL-SAFE: every colour the variant CSS writes comes
// from the theme's contrast-proven --wss-* token pairs (with transparent/
// inherit fallbacks), geometry-only rules ship even when the theme did not
// apply, and a donor the pass cannot understand keeps its natural layout with
// a report that says so.

const { createHash } = require("node:crypto");
const {
  buildSectionCatalog,
  scoreName,
} = require("../section-reorder");

const VARIANT_SYSTEM_VERSION = "component-variants@v1";

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------
// Every variant id is globally unique and stable — the similarity budget and
// the build hash both compare them as strings, so a renamed variant is a
// behaviour change, not a refactor.

// HERO VARIANT SCOPING (audit A5, 2026-09-04 fleet sweep — the flex-bomb).
// The old fallback led with bare `[class*="hero" i]` / `[id*="hero" i]`,
// which match EVERY descendant whose class or id merely CONTAINS "hero":
// `.hero-word` spans, `.hero-visual`, `.hero-inner`, `.hero-scrim`, all of
// it. The variant sheet's `display:flex!important;
// min-height:min(92vh,52rem)!important` then flex-bombed the whole hero
// column fleet-wide — measured on the live roofing baseline: every
// `.hero-word` span became a ~600x736px flex block (6 words -> a 3,827px
// H1 pushed to y=1865), the hero section swelled to 8,563px, and all 38
// reveals stayed stranded below the fold at opacity 0.
//
// A hero variant lays out the hero SECTION CONTAINER — never hero-classed
// descendants — so every selector here is one of:
//   - a structural hook the engine itself stamps ([data-wss-section="hero"]),
//   - an exact class token (`.banner` — token match, `.banner-text` cannot hit),
//   - a tag-qualified substring (`section[class*="hero" i]`): a
//     `<span class="hero-word">` or `<div class="hero-inner">` can NEVER
//     match because it is not a section/header,
//   - a positional anchor (`main > section:first-of-type`).
// A donor this list cannot find keeps its natural layout — the fail-safe
// direction this module promises. (The CTA selectors below are already
// tag-qualified to a/button and write no layout properties, so their
// substring form cannot re-flow page structure.)
const HERO_SELECTOR_FALLBACK = Object.freeze([
  '[data-wss-section="hero"]',
  'section[class*="hero" i]',
  'header[class*="hero" i]',
  'section[id*="hero" i]',
  'header[id*="hero" i]',
  "main > section:first-of-type",
  ".banner",
]);

/**
 * Hero variants — the composition a visitor sees first. Different geometry,
 * spacing and type scale; never a different colour law (the theme owns ink).
 */
const HERO_VARIANTS = Object.freeze([
  Object.freeze({
    id: "split-media",
    label: "Split: text left, media right",
    geometry: "two-column grid, content column max 56ch, media column min 0",
    spacing: "generous block padding, 76vh max height",
    typography: "h1 clamp(2.4rem,5.5vw,4rem), measure 20ch",
  }),
  Object.freeze({
    id: "full-bleed-overlay",
    label: "Full-bleed image with overlay text",
    geometry: "centered flex column, 92vh max height",
    spacing: "cinematic block padding, safe-area aware",
    typography: "h1 clamp(2.6rem,6.5vw,4.5rem), centered, measure 22ch",
  }),
  Object.freeze({
    id: "minimal-texture",
    label: "Minimal text with texture background",
    geometry: "auto height, no forced viewport fill",
    spacing: "tight block padding (2.5-4.5rem)",
    typography: "h1 clamp(2rem,4.5vw,3.25rem), measure 18ch, left",
  }),
  Object.freeze({
    id: "video-cinematic",
    label: "Video hero, bottom-anchored caption",
    geometry: "88vh max height, content docked to the bottom",
    spacing: "deep bottom padding for the caption band",
    typography: "h1 clamp(2.5rem,6vw,4.25rem), balanced wrapping",
  }),
  Object.freeze({
    id: "card-intro",
    label: "Card-based intro",
    geometry: "centered card plate (max 44rem) on the page surface",
    spacing: "card padding clamp(1.5rem,3vw,2.5rem), soft shadow",
    typography: "h1 clamp(2rem,4.5vw,3.4rem), contained measure",
  }),
]);

const SECTION_VARIANTS = Object.freeze({
  services: Object.freeze([
    Object.freeze({ id: "card-grid", label: "Card grid", geometry: "responsive minmax card grid, 1.25rem gap" }),
    Object.freeze({ id: "numbered-list", label: "Numbered list", geometry: "single column, accent left rule, hanging numerals" }),
    Object.freeze({ id: "stacked-rows", label: "Stacked rows", geometry: "full-width rows, alternating padding rhythm" }),
    Object.freeze({ id: "chip-cluster", label: "Chip cluster", geometry: "wrapped pill rows, tight 0.75rem gap" }),
  ]),
  about: Object.freeze([
    Object.freeze({ id: "split-media", label: "Split media", geometry: "two-column, text column 58ch" }),
    Object.freeze({ id: "stats-band", label: "Stats band", geometry: "accent top rule, enlarged numeral emphasis" }),
    Object.freeze({ id: "quote-led", label: "Quote-led", geometry: "oversized opening quote, italic lead" }),
  ]),
  gallery: Object.freeze([
    Object.freeze({ id: "masonry-columns", label: "Masonry columns", geometry: "CSS columns, 0.75rem gap" }),
    Object.freeze({ id: "strip", label: "Single-row strip", geometry: "one row, horizontal scroll on overflow" }),
    Object.freeze({ id: "feature-pairs", label: "Feature pairs", geometry: "two-column pairs, wide first item" }),
  ]),
  testimonials: Object.freeze([
    Object.freeze({ id: "carousel-frame", label: "Carousel frame", geometry: "centered 60ch quote stage" }),
    Object.freeze({ id: "stacked-cards", label: "Stacked cards", geometry: "offset stacked cards, 1rem gap" }),
    Object.freeze({ id: "stat-led", label: "Stat-led", geometry: "oversized rating numeral above the quotes" }),
    Object.freeze({ id: "inline-strip", label: "Inline strip", geometry: "single-line quotes, dividers" }),
  ]),
  contact: Object.freeze([
    Object.freeze({ id: "split-form", label: "Split form", geometry: "two-column: details left, form/card right" }),
    Object.freeze({ id: "banner-cta", label: "Banner CTA", geometry: "full-width slab band, centered" }),
    Object.freeze({ id: "card-centered", label: "Centered card", geometry: "single centered card, 36rem max" }),
  ]),
  footer: Object.freeze([
    Object.freeze({ id: "columns", label: "Column footer", geometry: "multi-column link grid" }),
    Object.freeze({ id: "minimal-bar", label: "Minimal bar", geometry: "single row, space-between" }),
    Object.freeze({ id: "mega", label: "Mega footer", geometry: "accent top border, wide padded grid" }),
  ]),
});

/** The axes the similarity budget compares. Section-level variants add
 *  further divergence but are not budget axes (the owner's report named
 *  hero, section rhythm/order, CTA treatment and typography scale). */
const BUDGET_AXES = Object.freeze(["hero", "section_order", "cta", "type_scale"]);

const CTA_TREATMENTS = Object.freeze([
  Object.freeze({ id: "solid-pill", label: "Solid pill", shape: "999px radius", fill: "accent slab, accent ink" }),
  Object.freeze({ id: "sharp-outline", label: "Sharp outline", shape: "2px radius", fill: "transparent, 2px accent border" }),
  Object.freeze({ id: "underline-accent", label: "Underline accent", shape: "none", fill: "transparent, thick accent underline" }),
  Object.freeze({ id: "slab-block", label: "Slab block", shape: "0.45rem radius", fill: "slab fill, accent top bar" }),
]);

/** Section types that participate in selection + section-variant CSS. */
const SECTION_TYPES = Object.freeze(Object.keys(SECTION_VARIANTS));

// ---------------------------------------------------------------------------
// Deterministic seeding
// ---------------------------------------------------------------------------
// sha256 -> mulberry32. No Math.random anywhere in this module: the same
// prospect, donor and cues must produce byte-identical selections on every
// machine and every rebuild.

function seedFor({ prospectId, donor }) {
  return createHash("sha256")
    .update(`${VARIANT_SYSTEM_VERSION}|${String(prospectId || "")}|${String(donor || "")}`)
    .digest("hex");
}

function mulberry32(hexSeed) {
  let a = parseInt(String(hexSeed).slice(0, 8), 16) >>> 0;
  if (!Number.isFinite(a)) a = 0x9e3779b9;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickSeeded = (rand, list) => list[Math.floor(rand() * list.length) % list.length];

// ---------------------------------------------------------------------------
// The donor fingerprint input
// ---------------------------------------------------------------------------
// Produced by the measurement lane (lib/mirror-engine/donor-fingerprint.js,
// another work stream) and carried on the request as `donor_fingerprint`.
// Normalization is TOLERANT BY DESIGN: this module must work before, beside
// and after that lane lands, so unknown or malformed values are ignored
// (never thrown) and every field is optional.

const TYPOGRAPHY_CUES = Object.freeze({
  condensed: "condensed-tall",
  tall: "condensed-tall",
  narrow: "condensed-tall",
  normal: "normal",
  wide: "wide-short",
  short: "wide-short",
  extended: "wide-short",
});

/** Canonical section names selection + reorder understand. */
const KNOWN_SECTIONS = Object.freeze([
  "hero", "services", "about", "gallery", "testimonials", "reviews",
  "contact", "footer", "faq", "pricing", "team",
]);

/** Reviews/testimonials are one section to a visitor; same for a few others. */
const CANONICAL_SECTION = Object.freeze({
  reviews: "testimonials",
  testimonials: "testimonials",
  pricing: "services",
  team: "about",
});

function normalizeFingerprint(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};

  const mode = String(raw.mode || raw.surface_mode || "").toLowerCase().trim();
  if (mode === "dark" || mode === "light" || mode === "mid") out.mode = mode;

  // photo_led accepts boolean or the spoken spellings.
  if (typeof raw.photo_led === "boolean") out.photo_led = raw.photo_led;
  else {
    const led = String(raw.photo_led || raw.lead || "").toLowerCase().trim();
    if (led === "photo-led" || led === "photo_led" || led === "photo" || led === "true") out.photo_led = true;
    if (led === "text-minimal" || led === "text_minimal" || led === "minimal" || led === "false") out.photo_led = false;
  }

  const typo = String(raw.typography || raw.heading_scale || raw.type_scale || "").toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(TYPOGRAPHY_CUES, typo)) out.typography = typo;

  if (Array.isArray(raw.section_order)) {
    const order = [];
    for (const item of raw.section_order) {
      const name = String(item || "").toLowerCase().trim().replace(/\s+/g, "-");
      if (!name || name.length > 40) continue;
      if (order.includes(name)) continue; // uniqueItems, same as the schema
      order.push(name);
    }
    if (order.length) out.section_order = order.slice(0, 12);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Merge the fingerprint with request-derived evidence. The fingerprint is
 * authoritative for what it measured; the request fills the gaps so the
 * system works the day a build carries no fingerprint at all.
 *
 *   dark + photo-led  -> full-bleed hero (the owner's report: photo-led
 *                        donors converging on one cinematic treatment)
 *   light + minimal   -> minimal-texture hero
 *   brand hero video  -> video-cinematic hero
 */
function deriveCues({
  fingerprint = null,
  clientSurface = null,
  brandIdentityBackground = "",
  brandFont = "",
  heroVideo = false,
  photoCount = 0,
} = {}) {
  const fp = fingerprint || {};
  const surfaceMode = String(fp.mode || (clientSurface && clientSurface.mode) || "").toLowerCase();

  let photoLed = null;
  if (typeof fp.photo_led === "boolean") photoLed = fp.photo_led;
  else if (surfaceMode === "dark") photoLed = true;
  else if (surfaceMode === "light" && photoCount === 0) photoLed = false;
  else if (photoCount >= 3) photoLed = true;

  // A brand_identity background is the extraction lane's direct reading of
  // the canvas; dark keeps the photo-led reading honest when no fingerprint
  // spoke.
  const bg = String(brandIdentityBackground || "").toLowerCase();
  if (photoLed === null && /^#[0-9a-f]{6}$/.test(bg)) {
    const lum = hexLuminance(bg);
    photoLed = lum < 0.12;
  }

  let typography = fp.typography || null;
  if (!typography) {
    const font = String(brandFont || "");
    if (/conden|narrow|tall|compressed/i.test(font)) typography = "condensed";
    else if (/wide|extended|expans/i.test(font)) typography = "wide";
  }

  return {
    mode: surfaceMode || null,
    photo_led: photoLed,
    typography: typography || null,
    section_order: Array.isArray(fp.section_order) ? fp.section_order : null,
    hero_video: Boolean(heroVideo),
  };
}

function hexLuminance(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = v.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const TYPE_SCALES = Object.freeze(["condensed-tall", "normal", "wide-short"]);

/** The hero variant a cue pins, or null. Cue pins are contractual: they come
 *  from a measurement, and the similarity budget does not override them. */
function pinnedHero(cues) {
  if (cues.hero_video) return "video-cinematic";
  if (cues.photo_led === true && (cues.mode === "dark" || cues.mode === null || cues.mode === "mid")) return "full-bleed-overlay";
  if (cues.photo_led === false && (cues.mode === "light" || cues.mode === null)) return "minimal-texture";
  if (cues.photo_led === true) return "full-bleed-overlay";
  return null;
}

function pinnedTypeScale(cues) {
  return cues.typography ? TYPOGRAPHY_CUES[cues.typography] || null : null;
}

function canonicalSectionOrder(order) {
  if (!Array.isArray(order)) return null;
  const out = [];
  for (const raw of order) {
    const name = String(raw || "").toLowerCase().trim().replace(/\s+/g, "-");
    if (!name) continue;
    const canonical = Object.prototype.hasOwnProperty.call(CANONICAL_SECTION, name)
      ? CANONICAL_SECTION[name]
      : (KNOWN_SECTIONS.includes(name) ? name : "");
    if (!canonical || out.includes(canonical)) continue;
    out.push(canonical);
  }
  return out.length ? out : null;
}

/**
 * selectVariants({ prospectId, donor, cues }) -> selection
 *
 * Deterministic: prospect identity + donor + cues in, same selection out.
 * Unpinned axes come from the seeded PRNG; pinned axes from the cues.
 */
function selectVariants({ prospectId, donor, cues = {} } = {}) {
  const rand = mulberry32(seedFor({ prospectId, donor }));

  const hero = pinnedHero(cues) || pickSeeded(rand, HERO_VARIANTS).id;
  const typeScale = pinnedTypeScale(cues) || pickSeeded(rand, TYPE_SCALES);
  const cta = pickSeeded(rand, CTA_TREATMENTS).id;

  const section_variants = {};
  for (const type of SECTION_TYPES) {
    section_variants[type] = pickSeeded(rand, SECTION_VARIANTS[type]).id;
  }

  const section_order = canonicalSectionOrder(cues.section_order);

  return {
    version: VARIANT_SYSTEM_VERSION,
    prospect_id: String(prospectId || ""),
    donor: String(donor || ""),
    hero,
    type_scale: typeScale,
    cta,
    section_variants,
    section_order,
    pinned: {
      hero: pinnedHero(cues) || null,
      type_scale: pinnedTypeScale(cues) || null,
      section_order: Boolean(section_order),
    },
    seed: seedFor({ prospectId, donor }),
  };
}

/** The compact comparable form the budget and the build hash consume. */
function selectionSignature(selection) {
  const s = selection || {};
  return {
    hero: String(s.hero || ""),
    section_order: Array.isArray(s.section_order) ? s.section_order : null,
    cta: String(s.cta || ""),
    type_scale: String(s.type_scale || ""),
  };
}

/**
 * How many of the four budget axes differ between two selections.
 * Section order compares as a whole sequence (meaningful ORDER, not set).
 */
function axesDiffering(a, b) {
  const A = selectionSignature(a);
  const B = selectionSignature(b);
  let n = 0;
  if (A.hero !== B.hero) n += 1;
  if (A.cta !== B.cta) n += 1;
  if (A.type_scale !== B.type_scale) n += 1;
  const orderA = Array.isArray(A.section_order) ? A.section_order.join("|") : "";
  const orderB = Array.isArray(B.section_order) ? B.section_order.join("|") : "";
  if (orderA !== orderB) n += 1;
  return n;
}

// DETERMINISTIC ROTATION, mixed-radix. The budget needs the second build to
// LAND somewhere else, deterministically. Rotation step k walks the space of
// unpinned axes in a fixed order — CTA first (cheapest, never pinned), then
// the type scale (a donor typography cue is a PIN: "unless the donor
// specifically calls for it" — it holds even under budget pressure, and the
// budget clears on the other free axes), then the hero (a measured pin
// always holds). With 4 CTAs, 3 scales and 5 heroes the walk covers every
// combination, so a candidate satisfying the budget against a bounded window
// of priors is always found long before the walk ends.
const rotateId = (id, list, step) => {
  const i = list.findIndex((v) => v.id === id);
  if (i < 0 || !step) return id;
  return list[(i + step) % list.length].id;
};

const CTA_COUNT = CTA_TREATMENTS.length;
const SCALE_COUNT = TYPE_SCALES.length;
const HERO_COUNT = HERO_VARIANTS.length;

function rotateSelection(selection, step) {
  if (!step) return selection;
  const scalePinned = Boolean(selection.pinned && selection.pinned.type_scale
    && selection.pinned.type_scale === selection.type_scale);
  const heroPinned = Boolean(selection.pinned && selection.pinned.hero);
  const ctaStep = step % CTA_COUNT;
  const scaleStep = scalePinned ? 0 : Math.floor(step / CTA_COUNT) % SCALE_COUNT;
  const heroStep = heroPinned ? 0 : Math.floor(step / (CTA_COUNT * SCALE_COUNT)) % HERO_COUNT;
  return {
    ...selection,
    cta: rotateId(selection.cta, CTA_TREATMENTS, ctaStep),
    type_scale: scalePinned
      ? selection.type_scale
      : rotateId(selection.type_scale, TYPE_SCALES.map((id) => ({ id })), scaleStep),
    hero: heroPinned ? selection.hero : rotateId(selection.hero, HERO_VARIANTS, heroStep),
    rotated: step,
  };
}

// The full walk covers CTA x scale x hero combinations (minus pins); a couple
// of guard steps on top covers the pinned degenerate cases.
const ROTATION_LIMIT = CTA_COUNT * SCALE_COUNT * HERO_COUNT + CTA_COUNT;
const PRIOR_WINDOW = 8;

/**
 * enforceSimilarityBudget({ selection, priors, prospectId })
 *
 *   priors — [{ prospectId, signature }] earlier selections for the SAME
 *            donor (the registry's in-process rows; the durable seam is the
 *            same one the sameness fleet uses).
 *
 * THE LAW, in two tiers. The owner's mechanism is CONSECUTIVE: "if two
 * consecutive builds from the same donor would produce identical variant
 * selections, the second one gets a different selection." So the HARD
 * constraint is against the most recent prior — at least 2 of {hero variant,
 * section order, CTA treatment, typography scale} differ (the full 2-axis
 * budget), and every earlier selection in the window is a PREFERENCE: among
 * the candidates that clear the hard constraint, the walk keeps the one
 * whose WORST-case axis difference over the whole window is largest, so
 * divergence spreads beyond the adjacent pair wherever the catalog has room.
 * An all-pairs-forever guarantee over a bounded axis space is a pigeonhole
 * (5 heroes x 4 CTAs x 3 scales cannot host unbounded prospects at distance
 * 2); the consecutive hard law plus the window preference is the strongest
 * enforceable form, and it is exactly what the directive describes.
 *
 * PINS. A fingerprint-pinned axis is an intentional share ("unless the donor
 * specifically calls for it"): two dark photo-led prospects both wear the
 * full-bleed hero because the donor's measured design calls for it, and the
 * budget then clears on the free axes. When pins leave fewer than 2 free
 * axes the target degrades honestly (every remaining free axis — always at
 * least the CTA — differs from the latest prior) and the report says the
 * pins were the reason rather than silently claiming enforcement.
 *
 * Returns a selection (rotated when needed) plus a `budget` report. Rebuilds
 * of the SAME prospect are excluded: a rebuild must keep its look, and the
 * memo already replays identical builds without reaching here.
 */
function enforceSimilarityBudget({ selection, priors = [], prospectId = "" } = {}) {
  const relevant = (Array.isArray(priors) ? priors : [])
    .filter((p) => p && p.signature && String(p.prospectId || "") !== String(prospectId || ""))
    .slice(-PRIOR_WINDOW);
  const pinned = (selection && selection.pinned) || {};
  const freeAxes = BUDGET_AXES.filter((axis) => {
    if (axis === "hero") return !pinned.hero;
    if (axis === "type_scale") return !pinned.type_scale;
    if (axis === "section_order") return !Array.isArray(selection && selection.section_order);
    return true; // cta is never fingerprint-pinned
  }).length;
  const target = Math.min(2, freeAxes);
  const budgetBase = { target, ...(freeAxes < 2 ? { degraded_reason: "fingerprint_pinned_axes" } : {}) };
  if (!relevant.length) {
    return { ...selection, budget: { enforced: true, rotated: 0, compared: 0, ...budgetBase } };
  }
  const latest = relevant[relevant.length - 1];
  let best = null;
  for (let step = 0; step < ROTATION_LIMIT; step += 1) {
    const candidate = rotateSelection(selection, step);
    const consecutive = axesDiffering(candidate, latest.signature);
    if (consecutive < target) continue; // the hard law
    const worst = relevant.reduce((min, p) => Math.min(min, axesDiffering(candidate, p.signature)), Infinity);
    if (!best || worst > best.worst) {
      best = { candidate, step, worst, consecutive };
    }
  }
  if (best) {
    return {
      ...best.candidate,
      budget: {
        enforced: true,
        rotated: best.step,
        compared: relevant.length,
        consecutive_axes_differing: best.consecutive,
        window_axes_differing: Number.isFinite(best.worst) ? best.worst : null,
        ...budgetBase,
      },
    };
  }
  // Unreachable with this catalog size against a bounded prior window; if a
  // future catalog shrinks, say so honestly instead of converging silently.
  return {
    ...selection,
    budget: { enforced: false, reason: "rotation_exhausted", compared: relevant.length, ...budgetBase },
  };
}

// ---------------------------------------------------------------------------
// Applying a selection to the built tree
// ---------------------------------------------------------------------------

/** Attributes stamped on <html>; CSS rules key on them. Idempotent. */
const HTML_ATTRIBUTES = Object.freeze([
  ["data-wss-variant", (s) => s.hero],
  ["data-wss-type-scale", (s) => s.type_scale],
  ["data-wss-cta", (s) => s.cta],
]);

function stampHtmlAttributes(html, selection) {
  let out = String(html);
  for (const [attr, get] of HTML_ATTRIBUTES) {
    const value = String(get(selection) || "").replace(/[^a-z0-9-]/gi, "");
    if (!value) continue;
    const open = /<html\b[^>]*>/i.exec(out);
    if (!open) continue;
    if (new RegExp(`\\s${attr}="`, "i").test(open[0])) continue; // already stamped
    const tagged = open[0].replace(/>$/, ` ${attr}="${value}">`);
    out = out.slice(0, open.index) + tagged + out.slice(open.index + open[0].length);
  }
  return out;
}

/**
 * The open tag and class vocabulary of a catalogued section. Class is the
 * donor's own vocabulary ("services"); heading match uses the same scoring
 * law as the edit lane's reorder (scoreName + synonym table).
 */
function sectionOpenTag(block) {
  return /<section\b[^>]*>/i.exec(block) || null;
}

function classListFrom(openTag) {
  const m = /class=["']([^"']*)["']/i.exec(openTag || "");
  return m ? m[1].split(/\s+/).map((c) => c.toLowerCase().trim()).filter(Boolean) : [];
}

/**
 * applySectionOrder(html, sectionOrder) -> { html, applied, order, stamped }
 *
 * Slot-preserving reorder: the POSITIONS of the mapped sections become slots
 * and the fingerprint-ordered sections fill them in sequence; unmapped
 * sections never move. Every mapped section is stamped
 * data-wss-section="<canonical name>" — the hook the section-variant CSS and
 * the CTA scoping key on. Single pass, no regex over rewritten output.
 */
function applySectionOrder(html, sectionOrder) {
  const order = canonicalSectionOrder(sectionOrder);
  const text = String(html || "");
  if (!order || !text) return { html: text, applied: false, order: null, stamped: 0, reason: "no_section_order" };

  const catalog = buildSectionCatalog(text);
  if (!catalog.length) return { html: text, applied: false, order, stamped: 0, reason: "no_plain_html_sections" };

  // Map each fingerprint name to ONE catalog entry (first unmatched match;
  // ambiguous matches are skipped — never guess where a section goes).
  // Catalog entries carry {start, end, heading} — the block itself is sliced
  // from the page, never trusted from the catalog's byte-length field.
  const blockOf = (entry) => text.slice(entry.start, entry.end);
  const claimed = new Set();
  const nameByEntry = new Map();
  for (const name of order) {
    let match = null;
    for (const entry of catalog) {
      if (claimed.has(entry)) continue;
      const classes = classListFrom(sectionOpenTag(blockOf(entry)));
      const target = CANONICAL_SECTION[name] || name;
      const byClass = classes.some((c) => c === target || c === `section-${target}` || c.includes(target));
      const byHeading = scoreName(target, entry.heading) >= 40;
      if (byClass || byHeading) { match = entry; break; }
    }
    if (match) {
      claimed.add(match);
      nameByEntry.set(match, name);
    }
  }
  if (!nameByEntry.size) return { html: text, applied: false, order, stamped: 0, reason: "no_sections_matched" };

  // Fingerprint-ordered queue of mapped sections fills the mapped slots.
  const orderedMapped = [...nameByEntry.keys()]
    .sort((a, b) => catalog.indexOf(a) - catalog.indexOf(b)) // stable base
    .sort((a, b) => {
      const ia = order.indexOf(nameByEntry.get(a));
      const ib = order.indexOf(nameByEntry.get(b));
      return ia - ib;
    });
  const slotEntries = catalog.filter((e) => nameByEntry.has(e));
  const replacement = new Map();
  let stamped = 0;
  slotEntries.forEach((slot, i) => {
    const src = orderedMapped[i];
    let bytes = blockOf(src || slot);
    const name = nameByEntry.get(src) || nameByEntry.get(slot);
    if (name) {
      const open = sectionOpenTag(bytes);
      if (open && !/data-wss-section=/.test(open[0])) {
        bytes = bytes.replace(open[0], open[0].replace(/>$/, ` data-wss-section="${name}">`));
        stamped += 1;
      }
    }
    replacement.set(slot, bytes);
  });

  let out = "";
  let cursor = 0;
  for (const entry of catalog) {
    out += text.slice(cursor, entry.start);
    out += replacement.has(entry) ? replacement.get(entry) : blockOf(entry);
    cursor = entry.end;
  }
  out += text.slice(cursor);
  return { html: out, applied: true, order, stamped };
}

/**
 * applyToFiles(files, selection) -> report
 *
 *   files — the hydrated tree (Buffers, mutated in place like every other
 *           engine pass).
 *
 * Stamps the scoping attributes on every HTML page and reorders/stamps the
 * plain-HTML sections when the selection carries a donor section order.
 */
function applyToFiles(files, selection) {
  const report = { attributes: 0, pages: 0, section_order: { applied: false, reason: "no_section_order" } };
  if (!files || typeof files !== "object") return report;

  const orderResult = { html: null, applied: false };
  for (const rel of Object.keys(files)) {
    if (!/\.html$/i.test(rel)) continue;
    let html = files[rel].toString("utf8");
    const before = html;
    const perPage = applySectionOrder(html, selection && selection.section_order);
    if (perPage.applied) html = perPage.html;
    if (orderResult.html === null && perPage.applied) {
      orderResult.html = true;
      report.section_order = {
        applied: true,
        order: perPage.order,
        sections_stamped: perPage.stamped,
        file: rel,
      };
    }
    const stamped = stampHtmlAttributes(html, selection);
    if (stamped !== before) report.pages += 1;
    if (stamped !== html || perPage.applied) files[rel] = Buffer.from(stamped, "utf8");
  }
  if (!report.section_order.applied && selection && Array.isArray(selection.section_order)) {
    report.section_order = {
      applied: false,
      reason: "spa_runtime_sections_or_none_matched",
      order: canonicalSectionOrder(selection.section_order),
    };
  } else if (!report.section_order.applied) {
    report.section_order = { applied: false, reason: "donor_order_not_carried" };
  }
  report.attributes = report.pages;
  return report;
}

// ---------------------------------------------------------------------------
// The CSS
// ---------------------------------------------------------------------------
// Appended to the LAST stylesheet, after the theme sheet and BEFORE the hero
// wash, so the wash's proven inks win wherever both speak. Every colour comes
// from a --wss-* token with a no-op fallback; when the theme did not apply
// (colour rules are then withheld entirely via `withColors:false`) the
// geometry still ships and the page cannot lose contrast.

function heroSelectorCss(heroSelector) {
  const selectors = Array.isArray(heroSelector) && heroSelector.length
    ? heroSelector
    : HERO_SELECTOR_FALLBACK;
  return selectors.join(",\n");
}

function heroVariantCss({ variant, heroSelector } = {}) {
  const sel = heroSelectorCss(heroSelector);
  const common = (body) => [`html[data-wss-variant="${variant}"] :is(${sel}){${body}}`];
  const h1 = (body) => [`html[data-wss-variant="${variant}"] :is(${sel}) h1{${body}}`];
  const mobile = (body) => [`@media (max-width:768px){html[data-wss-variant="${variant}"] :is(${sel}){${body}}}`];
  switch (variant) {
    case "split-media":
      return [
        `/* wss hero variant: split — text left, media right */`,
        ...common(`min-height:min(76vh,44rem)!important;display:grid!important;grid-template-columns:minmax(0,7fr) minmax(0,5fr);align-items:center!important;gap:clamp(1.5rem,4vw,3.5rem)!important;padding-block:clamp(2.5rem,6vw,4.5rem)!important`),
        `html[data-wss-variant="split-media"] :is(${sel})>:nth-child(n+2){grid-column:2}`,
        `html[data-wss-variant="split-media"] :is(${sel})>:first-child{grid-column:1;min-width:0}`,
        ...h1(`max-width:20ch;font-size:clamp(2.4rem,5.5vw,4rem)`),
        ...mobile(`grid-template-columns:minmax(0,1fr);min-height:0!important;padding-block:clamp(2rem,8vw,3rem)!important`),
      ].join("\n");
    case "full-bleed-overlay":
      return [
        `/* wss hero variant: full-bleed with overlay text */`,
        ...common(`min-height:min(92vh,52rem)!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;text-align:center!important;padding:clamp(3rem,8vh,5rem) max(1.25rem,env(safe-area-inset-right))!important`),
        ...h1(`max-width:22ch;margin-inline:auto!important;font-size:clamp(2.6rem,6.5vw,4.5rem)`),
        ...mobile(`min-height:max(56vh,24rem)!important;padding-block:clamp(2.5rem,10vw,4rem)!important`),
      ].join("\n");
    case "minimal-texture":
      return [
        `/* wss hero variant: minimal text on a texture field */`,
        ...common(`min-height:0!important;display:block!important;text-align:start!important;padding:clamp(2.5rem,6vw,4.5rem) max(1.25rem,env(safe-area-inset-right))!important;background-image:radial-gradient(color-mix(in srgb,var(--wss-accent,transparent) 8%,transparent) 1px,transparent 1px)!important;background-size:22px 22px!important`),
        ...h1(`max-width:18ch;font-size:clamp(2rem,4.5vw,3.25rem);letter-spacing:-0.01em`),
      ].join("\n");
    case "video-cinematic":
      return [
        `/* wss hero variant: video, bottom-anchored caption */`,
        ...common(`min-height:min(88vh,48rem)!important;display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:flex-end!important;padding:clamp(3rem,8vh,6rem) max(1.25rem,env(safe-area-inset-right))!important`),
        ...h1(`max-width:20ch;font-size:clamp(2.5rem,6vw,4.25rem);text-wrap:balance`),
        ...mobile(`min-height:max(60vh,26rem)!important`),
      ].join("\n");
    case "card-intro":
      return [
        `/* wss hero variant: card-based intro */`,
        ...common(`min-height:0!important;display:grid!important;place-items:center!important;padding-block:clamp(2rem,5vw,4rem)!important`),
        `html[data-wss-variant="card-intro"] :is(${sel})>:first-child{background:var(--wss-surface-alt,transparent);border:1px solid var(--wss-border,transparent);border-radius:1rem;padding:clamp(1.5rem,3vw,2.5rem);max-width:44rem;margin-inline:auto;box-shadow:0 18px 50px -24px rgba(11,18,32,.35)}`,
        ...h1(`font-size:clamp(2rem,4.5vw,3.4rem)`),
        ...mobile(`padding-block:clamp(1.25rem,6vw,2rem)!important`),
      ].join("\n");
    default:
      return "";
  }
}

function ctaSelector() {
  return [
    'a[class*="cta" i]',
    'button[class*="cta" i]',
    "[data-cta]",
    'a[class*="btn" i]',
    'button[class*="btn" i]',
    'a[class*="button" i]',
    'button[class*="button" i]',
    "a.btn",
    "a.button",
  ].join(",");
}

function ctaTreatmentCss({ treatment, withColors } = {}) {
  const sel = ctaSelector();
  const scoped = (body) => [`html[data-wss-cta="${treatment}"] :is(${sel}){${body}}`];
  switch (treatment) {
    case "solid-pill":
      return [
        `/* wss cta treatment: solid pill */`,
        ...scoped(`border-radius:999px!important;padding:.8em 1.6em!important;${withColors ? `background:var(--wss-accent,inherit)!important;color:var(--wss-accent-ink,inherit)!important;border-color:transparent!important` : ""}`),
      ].join("\n");
    case "sharp-outline":
      return [
        `/* wss cta treatment: sharp outline */`,
        ...scoped(`border-radius:2px!important;padding:.7em 1.4em!important;${withColors ? `background:transparent!important;color:var(--wss-accent-text,var(--wss-text,inherit))!important;border:2px solid var(--wss-accent,currentColor)!important` : ""}`),
      ].join("\n");
    case "underline-accent":
      return [
        `/* wss cta treatment: underline accent */`,
        ...scoped(`border-radius:0!important;padding:.35em .1em!important;${withColors ? `background:transparent!important;border-color:transparent!important;color:var(--wss-accent-text,var(--wss-text,inherit))!important;text-decoration:underline!important;text-decoration-color:var(--wss-accent,currentColor)!important;text-decoration-thickness:.12em!important;text-underline-offset:.25em!important;font-weight:700!important` : ""}`),
      ].join("\n");
    case "slab-block":
      return [
        `/* wss cta treatment: slab block */`,
        ...scoped(`border-radius:.45rem!important;padding:.9em 1.5em!important;${withColors ? `background:var(--wss-slab,inherit)!important;color:var(--wss-slab-ink,inherit)!important;border-color:transparent!important;border-top:4px solid var(--wss-accent,transparent)!important` : ""}`),
      ].join("\n");
    default:
      return "";
  }
}

function sectionVariantCss({ type, variant } = {}) {
  const sel = `section[data-wss-section="${type}"]`;
  switch (`${type}/${variant}`) {
    case "services/card-grid":
      return [`${sel}{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(16rem,100%),1fr));gap:1.25rem}`].join("\n");
    case "services/numbered-list":
      return [`${sel}{display:flex!important;flex-direction:column!important;gap:1rem}`, `${sel}>*{border-left:3px solid var(--wss-accent,transparent);padding-left:1.25rem}`].join("\n");
    case "services/stacked-rows":
      return [`${sel}>*{padding-block:clamp(1.25rem,3vw,2rem)}`, `${sel}>*:nth-child(even){padding-inline-start:clamp(1rem,4vw,3rem)}`].join("\n");
    case "services/chip-cluster":
      return [`${sel}{display:flex!important;flex-wrap:wrap!important;gap:.75rem}`, `${sel}>*{border:1px solid var(--wss-border,transparent);border-radius:999px;padding:.5em 1.1em}`].join("\n");
    case "about/split-media":
      return [`@media (min-width:900px){${sel}{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(2rem,4vw,3.5rem);align-items:center}}`].join("\n");
    case "about/stats-band":
      return [`${sel}{border-top:4px solid var(--wss-accent,transparent);padding-top:1.5rem}`, `${sel} :is(strong,b){font-size:1.35em;line-height:1.1;display:inline-block}`].join("\n");
    case "about/quote-led":
      return [`${sel}>:first-child{font-size:clamp(1.5rem,3vw,2.25rem);font-style:italic;max-width:32ch;line-height:1.2}`].join("\n");
    case "gallery/masonry-columns":
      return [`@media (min-width:700px){${sel}{columns:2;column-gap:.75rem}${sel}>*{break-inside:avoid;margin-bottom:.75rem}}`].join("\n");
    case "gallery/strip":
      return [`${sel}{display:flex!important;gap:.75rem;overflow-x:auto;scroll-snap-type:x mandatory}`, `${sel}>*{flex:0 0 auto;scroll-snap-align:start;max-width:min(28rem,80vw)}`].join("\n");
    case "gallery/feature-pairs":
      return [`@media (min-width:700px){${sel}{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}${sel}>:first-child{grid-column:1/-1}}`].join("\n");
    case "testimonials/carousel-frame":
      return [`@media (min-width:800px){${sel}>*{max-width:60ch;margin-inline:auto;text-align:center}}`].join("\n");
    case "testimonials/stacked-cards":
      return [`${sel}>*{border:1px solid var(--wss-border,transparent);border-radius:.9rem;padding:1.25rem;margin-bottom:1rem;background:var(--wss-surface-alt,transparent)}`].join("\n");
    case "testimonials/stat-led":
      return [`${sel}>:first-child{font-size:clamp(2.5rem,6vw,4rem);line-height:1;letter-spacing:-0.02em;display:block}`].join("\n");
    case "testimonials/inline-strip":
      return [`${sel}{display:flex!important;flex-wrap:wrap!important;gap:0}`, `${sel}>*{padding:.75rem 1.25rem;border-right:1px solid var(--wss-border,transparent)}`].join("\n");
    case "contact/split-form":
      return [`@media (min-width:900px){${sel}{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2rem;align-items:start}}`].join("\n");
    case "contact/banner-cta":
      return [`${sel}{background:var(--wss-slab,transparent);color:var(--wss-slab-ink,inherit);text-align:center;padding-block:clamp(2.5rem,6vw,4rem)}`].join("\n");
    case "contact/card-centered":
      return [`${sel}{display:grid!important;place-items:center!important}`, `${sel}>*{max-width:36rem;width:100%}`].join("\n");
    case "footer/columns":
      return [`@media (min-width:800px){${sel}{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(12rem,100%),1fr));gap:2rem}}`].join("\n");
    case "footer/minimal-bar":
      return [`@media (min-width:800px){${sel}{display:flex!important;justify-content:space-between;align-items:center;gap:2rem;flex-wrap:wrap}}`].join("\n");
    case "footer/mega":
      return [`${sel}{border-top:4px solid var(--wss-accent,transparent);padding-top:clamp(2rem,5vw,3.5rem)}`, `@media (min-width:900px){${sel}{display:grid!important;grid-template-columns:2fr repeat(auto-fit,minmax(min(10rem,100%),1fr));gap:2.5rem}}`].join("\n");
    default:
      return "";
  }
}

/**
 * variantCss(selection, { heroSelector, withColors }) -> string
 *
 * The full CSS package for a selection. `heroSelector` is the donor's proven
 * hero selector when the manifest declares one (hero_wash.selector), else the
 * generic fallbacks. `withColors:false` (theme did not apply) withholds every
 * colour declaration — shape and geometry only, so contrast can never regress.
 */
function variantCss(selection, { heroSelector = null, withColors = true } = {}) {
  const s = selection || {};
  const blocks = [];
  const hero = heroVariantCss({ variant: s.hero, heroSelector });
  if (hero) blocks.push(hero);
  const cta = ctaTreatmentCss({ treatment: s.cta, withColors });
  if (cta) blocks.push(cta);
  for (const type of SECTION_TYPES) {
    const variant = s.section_variants && s.section_variants[type];
    if (!variant) continue;
    const css = sectionVariantCss({ type, variant });
    if (css) blocks.push(css);
  }
  return blocks.length ? `/* === wss component variants (${VARIANT_SYSTEM_VERSION}) === */\n${blocks.join("\n")}\n` : "";
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  VARIANT_SYSTEM_VERSION,
  HERO_VARIANTS,
  SECTION_VARIANTS,
  SECTION_TYPES,
  CTA_TREATMENTS,
  TYPE_SCALES,
  BUDGET_AXES,
  KNOWN_SECTIONS,
  normalizeFingerprint,
  deriveCues,
  selectVariants,
  selectionSignature,
  axesDiffering,
  enforceSimilarityBudget,
  applyToFiles,
  applySectionOrder,
  variantCss,
  heroVariantCss,
  ctaTreatmentCss,
  sectionVariantCss,
};
