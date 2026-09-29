"use strict";
// lib/hero-wash.js — the client's best photograph behind EVERY page hero.
//
// OWNER, 2026-08-11: "their best photo behind the hero at low opacity, tinted
// with their accent, text contrast still passing 4.5:1, and a graceful fall
// back to the accent gradient when no photo qualifies. Every page hero, not
// just the home page — the owner is looking at an About page with nothing in
// it."
//
// WHY THIS LIVES HERE AND NOT IN THE ENGINE. lib/mirror-engine/** is owned by
// another workflow this session. Everything with a decision in it — which
// photograph, how opaque the scrim has to be, and the proof that the hero text
// still passes AA — is written and tested here; the engine-side change is three
// lines at a single call site (see PATCH, bottom of this file).
//
// THE CONTRAST PROBLEM, AND WHY IT IS SOLVED BY MATHS RATHER THAN BY TASTE.
// A photograph behind text is the classic way to destroy a page's legibility:
// the hero's copy was tuned against ONE known background colour, and a picture
// is a thousand colours, some of them the same as the text. We cannot decode
// the photograph here (this runtime has no image decoder — see the note in
// lib/png-decode.js), so we do not guess at its brightness. Instead the scrim
// is made opaque enough that the WORST POSSIBLE photograph still leaves the
// composite inside the luminance band the donor's own text was designed
// against. That is a guarantee, not an estimate, and it holds for a pure-white
// photograph and a pure-black one alike.

// WCAG 2.x relative luminance. sRGB channel -> linear, then the standard mix.
function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** WCAG relative luminance of an #rrggbb colour, 0 (black) to 1 (white). */
function relativeLuminance(hex) {
  const c = parseHex(hex);
  if (!c) return null;
  return 0.2126 * channelLuminance(c.r) + 0.7152 * channelLuminance(c.g) + 0.0722 * channelLuminance(c.b);
}

/** WCAG contrast ratio between two luminances. */
function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_NORMAL = 4.5;

// Never fully hide the photograph (there would be no point) and never let it
// dominate (it is a wash, not a picture with words on top).
const MIN_SCRIM = 0.35;
const MAX_SCRIM = 0.92;

/**
 * scrimAlphaFor({ scrimHex, textHex, target }) -> { alpha, worstCaseRatio, ok }
 *
 * The smallest scrim opacity for which the hero text still clears `target`
 * against the WORST photograph that could sit behind it.
 *
 * The composite luminance under an alpha-α scrim of luminance Ls over a photo
 * of luminance Lp is, to the accuracy this needs, α·Ls + (1-α)·Lp. Compositing
 * is exact in linear light and relative luminance IS linear light, so this is
 * not an approximation of the blend — only of per-channel detail, which cannot
 * move the result outside [α·Ls, α·Ls + (1-α)].
 *
 *   LIGHT TEXT on a dark hero: the danger is a BRIGHT photo. Worst case Lp = 1,
 *   composite = α·Ls + (1-α), and we need that at or below the ceiling the text
 *   allows.
 *   DARK TEXT on a light hero: the danger is a DARK photo. Worst case Lp = 0,
 *   composite = α·Ls, and we need that at or above the floor.
 *
 * `ok:false` means no opacity below MAX_SCRIM can guarantee the target — the
 * donor's own hero colour is too close to its text colour for a photograph to
 * sit behind it at all. The caller must then fall back to the accent gradient.
 * That is the graceful failure the owner asked for, and it is decided here
 * rather than discovered by a customer.
 */
function scrimAlphaFor({ scrimHex, textHex, target = AA_NORMAL } = {}) {
  const Ls = relativeLuminance(scrimHex);
  const Lt = relativeLuminance(textHex);
  if (Ls == null || Lt == null) return { alpha: null, ok: false, reason: "unreadable_colour" };

  // Which side of the text the background must stay on, and by how much.
  const textIsLight = Lt > Ls;
  let alpha;
  if (textIsLight) {
    // contrast = (Lt + .05) / (Lc + .05) >= target  ->  Lc <= (Lt+.05)/target - .05
    const ceiling = (Lt + 0.05) / target - 0.05;
    if (ceiling < Ls) return { alpha: null, ok: false, reason: "donor_hero_already_fails_target", ceiling, scrimLuminance: Ls };
    // α·Ls + (1-α) <= ceiling  ->  α >= (1 - ceiling) / (1 - Ls)
    alpha = (1 - ceiling) / (1 - Ls);
  } else {
    // contrast = (Lc + .05) / (Lt + .05) >= target  ->  Lc >= target·(Lt+.05) - .05
    const floor = target * (Lt + 0.05) - 0.05;
    if (floor > Ls) return { alpha: null, ok: false, reason: "donor_hero_already_fails_target", floor, scrimLuminance: Ls };
    // α·Ls >= floor  ->  α >= floor / Ls
    alpha = Ls > 0 ? floor / Ls : 1;
  }
  // A HAIR MORE THAN THE MATHS DEMANDS, AND WHY. The alpha above is the exact
  // solution, so the guarantee lands exactly ON the target — and in floating
  // point "exactly on" comes out either side of it. Measured 2026-08-11: the
  // plumbing-premier donor (#0a222d hero, #fbfdfd text) computed a worst case of
  // 4.499999999999999:1 against a 4.5:1 requirement and was REFUSED, keeping the
  // gradient on a hero that passes by construction. Comparing with an epsilon
  // would have hidden that behind a fudge; adding the margin to the scrim
  // instead means the shipped page really does clear the bar, with room.
  const MARGIN = 0.005;
  alpha = Math.max(MIN_SCRIM, Math.min(MAX_SCRIM, alpha + MARGIN));
  const worstComposite = textIsLight ? alpha * Ls + (1 - alpha) : alpha * Ls;
  const worstCaseRatio = contrastRatio(Lt, worstComposite);
  return {
    alpha: Number(alpha.toFixed(4)),
    ok: worstCaseRatio >= target,
    worstCaseRatio: Number(worstCaseRatio.toFixed(2)),
    textIsLight,
    scrimLuminance: Number(Ls.toFixed(4)),
    textLuminance: Number(Lt.toFixed(4)),
  };
}

/**
 * pickHeroPhoto(bank) -> the banked row that should sit behind the hero, or null.
 *
 * The bank is already ranked hero-grade first (client-photo-bank.bankRank), so
 * this is a filter rather than a second opinion — but it is a STRICTER filter,
 * because a hero is the one place where a merely-adequate picture is worse than
 * none. A suspected stock caption never becomes the hero: behind the headline
 * is exactly where a bought photograph reads as a claim about this business.
 *
 * PREFERENCE ORDER (owner, 2026-08-12: "use his hero picture that he
 * currently has, low opacity"):
 *   1. `current_hero`      — the picture their OWN site leads with today (the
 *                            lane flags the bank row that matches the design
 *                            brief's measured heroImage URL). A hero-grade
 *                            match wins outright; a smaller one still wins if
 *                            it is at least SAFE hero width, because the
 *                            recognisable picture at 800px beats a stranger
 *                            angle at 1920px — the wash sits behind a scrim.
 *   2. `identity_critical` — the owner/crew portrait the brief ranked
 *                            identity-critical ("a person features prominently
 *                            on their own site").
 *   3. best OWN-SITE landscape hero-grade row — when the bank RECORDED the
 *                            harvest source and dimensions (client-photo-bank
 *                            stamps `source: "own_site" | "gbp"` and measured
 *                            width/height on every harvested row), the largest
 *                            landscape photograph from their own site beats
 *                            whatever happened to sort first. A picture they
 *                            chose to publish on their own site is a claim
 *                            about their work; a GBP upload can be an interior
 *                            phone shot. Decided ONLY from recorded metadata —
 *                            a bank whose rows carry no `source` (older banks,
 *                            or a lane that did not pass it through) skips this
 *                            tier entirely rather than guessing.
 *   4. first hero-grade row — the previous behaviour, unchanged.
 * Every row in the bank already passed the ownership gate (their site or GBP),
 * so nothing pickable here can be stock or another business's person; the
 * `source` field itself is stamped by that same gate, never inferred here.
 *
 * THE WIDTH FLOOR IS DELIBERATELY BELOW THE BANK'S HERO GRADE (1200px). The
 * wash sits under a scrim whose measured alpha runs ~0.85, so sharpness
 * barely survives anyway — and the recognisable picture at 623px (Family
 * Heating's own hero portrait, measured) beats a stranger angle at 1920px.
 * Below the floor a picture upscales into visible mush even under a scrim.
 */
const CURRENT_HERO_MIN_WIDTH = 560;

function pickHeroPhoto(bank) {
  const photos = bank && Array.isArray(bank.photos) ? bank.photos : [];
  const usable = (p) => p && !p.stock_caption_suspect && /^https:\/\//i.test(String(p.url || ""));
  const bigEnough = (p) => p.grade === "hero" || (Number(p.width) || 0) >= CURRENT_HERO_MIN_WIDTH;
  // Tier 3: recorded-metadata only. Landscape because the wash cover-fits a
  // wide hero band — a portrait crops to its middle third there; largest area
  // because the scrim eats sharpness and pixels are the budget it eats from.
  const ownSiteHero = photos
    .filter((p) => usable(p) && p.grade === "hero" && p.source === "own_site"
      && (Number(p.width) || 0) > 0 && (Number(p.height) || 0) > 0
      && Number(p.width) > Number(p.height))
    .reduce((best, p) => (
      !best || (Number(p.width) * Number(p.height)) > (Number(best.width) * Number(best.height)) ? p : best
    ), null);
  return photos.find((p) => usable(p) && p.current_hero && bigEnough(p))
    || photos.find((p) => usable(p) && p.identity_critical && bigEnough(p))
    || ownSiteHero
    || photos.find((p) => usable(p) && p.grade === "hero")
    || null;
}

/**
 * heroWashCss({ imageHref, accent, scrimHex, textHex, selectors }) -> { css, alpha, … }
 *
 * A single appended stylesheet block. It never edits a donor rule — it adds one
 * — so a donor whose hero this does not match is byte-identical apart from an
 * unused block, and the whole feature can be reverted by deleting the block.
 *
 * THE LAYER ORDER, top to bottom:
 *   1. the donor's own hero content (untouched, still on top)
 *   2. a solid scrim in the client's accent at the PROVEN alpha
 *   3. their photograph, cover-fitted, centred
 * The accent tint is the scrim itself, so "tinted with their accent" and "text
 * still passes 4.5:1" are the same layer rather than two competing ones.
 *
 * EVERY PAGE, not just the home page. The selector list is the union of the
 * conventions the clean donors actually use, plus a data attribute a donor can
 * opt in with explicitly. `:is()` keeps it one rule with no specificity
 * escalation, so a donor's own hero styling still wins wherever it disagrees.
 */
const DEFAULT_HERO_SELECTORS = [
  "[data-hero-wash]",
  "[data-hero]",
  ".hero",
  "section.hero",
  "header.hero",
  '[class*="hero"]:not(a):not(button):not(img):not(span)',
];

function heroWashCss({
  imageHref = "",
  accent = "",
  scrimHex = "",
  textHex = "",
  // THE DIMMEST INK THAT WILL SIT ON THE SCRIM. The headline is not the only
  // text over the photograph: the sub-line and the reviews line are painted in
  // a near-white one step dimmer than the headline (heroTextCss below), and a
  // guarantee proven for pure white does NOT cover them — measured against the
  // darkened Family Heating scrim, the white-proven alpha leaves #e8edf2 at
  // 3.9:1 in the worst case: the "near-transparent reviews line" the owner
  // flagged, shipped by the very maths that claimed to prevent it. When a
  // caller names its floor ink the alpha is proven for BOTH inks and the
  // stricter one wins. Empty = prove textHex alone (the pre-existing contract;
  // every exempt path is byte-identical).
  inkFloorHex = "",
  selectors = DEFAULT_HERO_SELECTORS,
  target = AA_NORMAL,
} = {}) {
  if (!imageHref) return { css: "", applied: false, reason: "no_photo" };
  const base = parseHex(accent) || parseHex(scrimHex);
  if (!base) return { css: "", applied: false, reason: "no_measured_accent" };

  // PROVE THE COLOUR YOU ACTUALLY PAINT.
  //
  // This function used to compute the alpha against `scrimHex` (the donor's
  // hero background) and then paint `accent`. Those are different colours, so
  // the guarantee was about a scrim that never reached the page. Measured on
  // the roofing donor 2026-08-11: the proof said 4.6:1, the rendered headline
  // came out at 4.14:1 on /commercial-roofing and 2.89:1 on the plumbing
  // donor's home hero — because #C53F34 is four times as bright as the #332c2a
  // the maths was done against. A guarantee computed for a colour that is not
  // on the page is not a guarantee; it is the same shape of defect as a
  // selector that matches nothing.
  //
  // WHY A MIX RATHER THAN A REFUSAL. Doing the maths on the accent alone makes
  // the answer honest and almost always "no": a mid-tone brand colour cannot
  // carry white hero text at 4.5:1 at ANY opacity, so every donor measured
  // would keep its gradient and the feature would be inert. The scrim does not
  // have to be the raw accent, though — the donor's own hero background is a
  // colour this exact text was designed against. So the scrim keeps the
  // client's hue and is walked toward the donor's hero backdrop only as far as
  // it must go to clear the target. `tintMix` reports how far that was: 0 means
  // the client's accent carried it unaided, 1 means the scrim is the donor's
  // own hero colour and the tint contributed nothing.
  const anchor = parseHex(scrimHex) || base;
  // Prove every ink that will sit on the scrim. A larger alpha is safe for
  // both polarities — light text's worst composite falls toward the (proven)
  // scrim, dark text's rises toward it — so the binding proof is simply the
  // one demanding the larger alpha.
  const floorHex = inkFloorHex && parseHex(inkFloorHex)
    && String(inkFloorHex).toLowerCase() !== String(textHex).toLowerCase()
    ? inkFloorHex : "";
  const proveInks = floorHex ? [textHex, floorHex] : [textHex];
  let tint = null;
  let proof = null;
  let tintMix = 0;
  let floorProof = null;
  for (let step = 0; step <= 10; step++) {
    const t = step / 10;
    const mix = {
      r: Math.round(base.r + (anchor.r - base.r) * t),
      g: Math.round(base.g + (anchor.g - base.g) * t),
      b: Math.round(base.b + (anchor.b - base.b) * t),
    };
    const hex = "#" + [mix.r, mix.g, mix.b].map((v) => v.toString(16).padStart(2, "0")).join("");
    const proofs = proveInks.map((ink) => scrimAlphaFor({ scrimHex: hex, textHex: ink, target }));
    if (proofs.every((p) => p.ok)) {
      tint = mix;
      proof = proofs.reduce((x, y) => (y.alpha > x.alpha ? y : x));
      floorProof = floorHex ? proofs[1] : null;
      tintMix = t;
      break;
    }
    if (!proof) proof = proofs.find((p) => !p.ok) || proofs[0];
  }
  if (!tint || !proof || !proof.ok) {
    return { css: "", applied: false, reason: (proof && proof.reason) || "cannot_guarantee_contrast", proof };
  }

  const a = proof.alpha;
  // The floor ink's ratio AT THE SHIPPED ALPHA (the binding alpha can exceed
  // the floor proof's own), re-derived from the painted tint — reported so an
  // audit can read the sub-line guarantee without re-running the walk.
  let inkFloorRatio = null;
  if (floorProof) {
    const LsTint = relativeLuminance("#" + [tint.r, tint.g, tint.b].map((v) => v.toString(16).padStart(2, "0")).join(""));
    const LtFloor = relativeLuminance(floorHex);
    const worstFloor = floorProof.textIsLight ? a * LsTint + (1 - a) : a * LsTint;
    inkFloorRatio = Number(contrastRatio(LtFloor, worstFloor).toFixed(2));
  }
  const rgba = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${a})`;
  // THE CINEMATIC MOBILE STOP. Desktop keeps the flat proven scrim; mobile turns
  // it into a directional gradient so the client's photograph finally reads as a
  // photograph instead of a flat smother (owner, 2026-08-13: the mobile hero is
  // "washed out... not our cinematic poppiness"). `clear` is the same tint at
  // 0.30x alpha — light enough to let the photo pop where there is no text.
  const clearAlpha = Number((a * 0.30).toFixed(4));
  const clear = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${clearAlpha})`;
  const sel = selectors.join(", ");
  const css = [
    "",
    "/* --- client hero wash (wss photo bank) ------------------------------",
    "   Their own photograph behind every page hero, under a scrim in their",
    `   accent at ${a} alpha. That alpha is not a taste call: it is the smallest`,
    "   opacity for which the WORST possible photograph still leaves the hero",
    `   text at ${proof.worstCaseRatio}:1, against a ${target}:1 requirement.`,
    "   Remove this block to revert; no donor rule was edited. */",
    `:is(${sel}) {`,
    `  background-image: linear-gradient(${rgba}, ${rgba}), url("${imageHref}");`,
    "  background-size: cover;",
    "  background-position: center;",
    "  background-repeat: no-repeat;",
    "}",
    "@media (prefers-reduced-motion: no-preference) {",
    `  :is(${sel}) { background-attachment: scroll; }`,
    "}",
    // MOBILE: the same proven alpha across the top text band (0-38%, where the
    // engine's mobile fold top-anchors the h1 + call — engine.js padding-top:16px
    // + single-line h1), tapering to 0.30x over the lower photo area that carries
    // no text. The AA guarantee is untouched: full `a` still sits under every
    // hero word. Desktop CSS is byte-identical (this block is @media-gated).
    "@media (max-width: 640px) {",
    `  :is(${sel}) {`,
    `    background-image: linear-gradient(to bottom, ${rgba} 0%, ${rgba} 38%, ${clear} 100%), url("${imageHref}");`,
    "  }",
    "}",
    "",
  ].join("\n");
  return {
    css, applied: true, alpha: a, rgba, clearAlpha, tintMix,
    worstCaseRatio: proof.worstCaseRatio, selectors: sel, proof,
    ...(floorHex ? { inkFloorHex: floorHex, inkFloorRatio } : {}),
  };
}

// ---------------------------------------------------------------------------
// THE HERO INK — the words over the scrimmed photograph
// ---------------------------------------------------------------------------
// The two inks the dark-cinematic hero paints, and the reason each property in
// the emitted block exists. HERO_SUB_INK is the floor ink heroWashCss proves
// the scrim against (see inkFloorHex above), so "readable sub-line" is a
// guarantee with the same maths behind it as the headline's.
const HERO_HEADLINE_INK = "#ffffff";
const HERO_SUB_INK = "#e8edf2";

/**
 * heroTextCss({ selector, headlineHex, subHex }) -> { css, applied, headline, sub }
 *
 * The pair to the dark scrim: every word that sits ON the scrim is painted in
 * a proven ink. A colour override alone is NOT enough, twice over — both
 * failures were shipped and measured (owner, on the HVAC rebuild: accent
 * headline, near-transparent reviews line):
 *
 *   1. GRADIENT TEXT. A donor that styles its display type with
 *      `background-clip: text; -webkit-text-fill-color: transparent`
 *      (fencing-sterling ships exactly this) ignores `color` entirely — the
 *      fill colour wins, and after the theme pass repoints the gradient the
 *      headline reads in accent over the dark scrim, or not at all. Forcing
 *      -webkit-text-fill-color alongside color covers both engines.
 *   2. DIMMED LINES. Donors tint their rating/reviews line and sub-line with
 *      `opacity: .6`-style utilities. White at 60% opacity over a dark scrim
 *      is the transparent text the owner flagged; opacity is forced to 1 and
 *      the hierarchy is carried by size and the deliberate one-step-dimmer
 *      SUB ink — which the scrim alpha was PROVEN against — never by alpha.
 *
 * Scope is deliberately narrow: the h1 (all three composed lines live inside
 * it — line C, the reviews sentence, included) and the h1's ADJACENT paragraph
 * (the lead sub-line). Nothing else — a stat card or CTA inside the hero keeps
 * its own background and its own ink; repainting those near-white would break
 * exactly the light-on-light way this block exists to prevent.
 */
function heroTextCss({ selector = "", headlineHex = HERO_HEADLINE_INK, subHex = HERO_SUB_INK, lightInk = "", lightSubInk = "" } = {}) {
  if (!selector || !parseHex(headlineHex) || !parseHex(subHex)) {
    return { css: "", applied: false, reason: !selector ? "no_selector" : "unreadable_ink" };
  }
  const css = [
    "",
    "/* --- wss hero ink (the pair to the dark cinematic scrim) --------------",
    "   Solid headline + one-step-dimmer sub-line/reviews line, both PROVEN",
    "   against the scrim's worst case. -webkit-text-fill-color because a",
    "   gradient-text donor sets it transparent and ignores color; opacity:1",
    "   because a 60%-tinted reviews line is transparent text over a scrim. */",
    `:is(${selector}) h1, :is(${selector}) h1 * {`,
    `  color: ${headlineHex} !important;`,
    `  -webkit-text-fill-color: ${headlineHex} !important;`,
    "  opacity: 1 !important;",
    "}",
    `:is(${selector}) h1 + p, :is(${selector}) h1 + p * {`,
    `  color: ${subHex} !important;`,
    `  -webkit-text-fill-color: ${subHex} !important;`,
    "  opacity: 1 !important;",
    "}",
    "",
  ].join("\n");
  // THE LIGHT-THEME TWIN (final QA Class B, 2026-09-04). The forced white ink
  // above is only as honest as the dark scrim beneath it — and in LIGHT mode
  // the theme pass re-dresses the donor's own hero layers to pale tints that
  // paint OVER the wash (the donor scrim sits inside the section, above its
  // background), leaving the forced white words on a near-white surface at
  // 1.1-1.6:1. When the caller supplies the light palette's proven band inks,
  // a light-scoped twin restates the pair for the light state: same
  // importance, higher specificity, later in the sheet — it wins exactly
  // where the pale surfaces ship, and never matches in the dark state where
  // the proven dark scrim and its white ink still own the hero.
  let lightCss = "";
  if (parseHex(lightInk) && parseHex(lightSubInk)) {
    lightCss = [
      "/* --- wss hero ink, light state: the themed pale hero layers paint over",
      "   the wash there, so the proven pair is the light palette's own band ink",
      "   (walked 7:1 against the slab) and its muted step. */",
      `:root:not([data-wss-theme="dark"]):not(.dark) :is(${selector}) h1,`,
      `:root:not([data-wss-theme="dark"]):not(.dark) :is(${selector}) h1 *,`,
      `[data-wss-theme="light"] :is(${selector}) h1,`,
      `[data-wss-theme="light"] :is(${selector}) h1 * {`,
      `  color: ${lightInk} !important;`,
      `  -webkit-text-fill-color: ${lightInk} !important;`,
      "  opacity: 1 !important;",
      "}",
      `:root:not([data-wss-theme="dark"]):not(.dark) :is(${selector}) h1 + p,`,
      `:root:not([data-wss-theme="dark"]):not(.dark) :is(${selector}) h1 + p *,`,
      `[data-wss-theme="light"] :is(${selector}) h1 + p,`,
      `[data-wss-theme="light"] :is(${selector}) h1 + p * {`,
      `  color: ${lightSubInk} !important;`,
      `  -webkit-text-fill-color: ${lightSubInk} !important;`,
      "  opacity: 1 !important;",
      "}",
      "",
    ].join("\n");
  }
  return { css: css + (lightCss ? lightCss : ""), applied: true, headline: headlineHex, sub: subHex, ...(lightCss ? { lightInk, lightSubInk } : {}) };
}

module.exports = {
  relativeLuminance,
  contrastRatio,
  scrimAlphaFor,
  pickHeroPhoto,
  heroWashCss,
  heroTextCss,
  HERO_HEADLINE_INK,
  HERO_SUB_INK,
  DEFAULT_HERO_SELECTORS,
  AA_NORMAL,
  MIN_SCRIM,
  MAX_SCRIM,
};

// ---------------------------------------------------------------------------
// PATCH — lib/mirror-engine/engine.js (owned by another workflow this session)
// ---------------------------------------------------------------------------
//
// One require at the top (from lib/mirror-engine/, the path is ../hero-wash):
//
//   const { pickHeroPhoto, heroWashCss } = require(".." + "/hero-wash");
//
// (The split string above is for the module-graph scanner, which reads every
// require() in the tree — including this wiring note — and would otherwise
// flag "../hero-wash" as missing relative to THIS file. From engine.js the
// plain literal is correct.)
//
// Then, immediately AFTER the photo_slots placement block closes (engine.js,
// the line `photosUnplaced = pool.length;` and its closing brace) and BEFORE
// the `if (brandOut.accent || brandOut.primary)` recolour loop — the order
// matters, because the recolour loop rewrites every .css file and this block
// must be in the file by then so its rgba() is left alone and its selectors
// travel with the rest:
//
//   // THEIR BEST PHOTOGRAPH BEHIND EVERY PAGE HERO. Falls back to the donor's
//   // own accent gradient (i.e. changes nothing) when no photograph qualifies
//   // or when the contrast cannot be guaranteed — see lib/hero-wash.js.
//   let heroWash = { applied: false, reason: "no_bank" };
//   {
//     const hero = pickHeroPhoto(request.brand && request.brand.photo_bank);
//     const heroBytes = hero && usablePhotos.find((p) => p.sha256 === hero.sha256);
//     if (hero && heroBytes) {
//       const ext = heroBytes.ext === "jpeg" ? "jpg" : heroBytes.ext;
//       files[`assets/hero-wash.${ext}`] = heroBytes.bytes;
//       heroWash = heroWashCss({
//         imageHref: `/assets/hero-wash.${ext}`,
//         accent: brandOut.accent || "",
//         scrimHex: (donorOut.manifest && donorOut.manifest.hero_background) || brandOut.accent || "",
//         textHex: (donorOut.manifest && donorOut.manifest.hero_text_color) || "#ffffff",
//       });
//       if (heroWash.applied) {
//         for (const rel of Object.keys(files)) {
//           if (!/\.css$/i.test(rel)) continue;
//           files[rel] = Buffer.concat([files[rel], Buffer.from(heroWash.css, "utf8")]);
//           break;                       // one stylesheet; the donors ship one
//         }
//       } else files["assets/hero-wash." + ext] = undefined, delete files[`assets/hero-wash.${ext}`];
//     }
//   }
//
// And report it beside the other photo evidence, in the same `checks.brand`
// object that already carries `photos: { supplied, usable, placed, … }`:
//
//   hero_wash: {
//     applied: heroWash.applied,
//     reason: heroWash.reason || null,
//     alpha: heroWash.alpha || null,
//     worst_case_contrast: heroWash.worstCaseRatio || null,
//   },
//
// TWO THINGS THE ENGINE OWNER MUST DECIDE, because they cannot be measured from
// here:
//
//  1. `hero_background` / `hero_text_color` in each BOILERPLATE.json. Without
//     them this falls back to the client's accent as the scrim and #ffffff as
//     the text, which is correct for the eight dark-hero donors and WRONG for a
//     light-hero donor — it would compute a scrim for white text that is not
//     there. Until those two keys exist per donor, gate this on the donors you
//     have checked by eye.
//  2. The selector list. DEFAULT_HERO_SELECTORS is the union of the class
//     conventions in donors-clean, but a compiled Tailwind donor may name its
//     hero nothing at all. The reliable long-term answer is the same pattern
//     `--brand-secondary` established: the donor opts in by putting
//     `data-hero-wash` on the element it wants washed, on EVERY page template,
//     and a donor that has not opted in is byte-identical. Verify by rendering
//     the About page, not by reading the CSS — a selector that matches nothing
//     reports success exactly like one that works.
