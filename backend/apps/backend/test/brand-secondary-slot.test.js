"use strict";

/**
 * test/brand-secondary-slot.test.js
 *
 * The owner on the Rimrock Plumbing mirror (2026-08-05): "our CSS colors
 * background integration is not happening ... they have way more use of this
 * green color, and we are just doing the black with the gold again."
 *
 * Rimrock's logo is two colours — "Rimrock" in orange #fcb040 and "Plumbing"
 * in green #6db33f. Both were measured correctly and both were APPLIED. The
 * green went into the donor's surface variables, where applySurfaceToCss must
 * not touch lightness, so it landed as oklch(96% 0.032 135) paper and
 * oklch(12% 0.083 135) ink: their green, at off-white and near-black, invisible.
 * The only saturated colour left on the page was the gold accent.
 *
 * These pin the fix: the second colour now fills a PAINT ROLE the donor already
 * spends (plumbing-clean's --copper — section eyebrows, step numbers, the
 * full-width CTA band, the hero wash, form focus), it is visibly saturated
 * there, it is contrast-safe, the accent is untouched, and a donor that never
 * declared the slot comes back byte-identical.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  applySecondaryToCss,
  applyBrandToCss,
  applySurfaceToCss,
  hexToOklch,
  toHex,
} = require("../lib/capture-brand");

const ACCENT = "#fcb040";  // "Rimrock" — orange, 51% share of the logo
const SECOND = "#6db33f";  // "Plumbing" — green

const DONOR_CSS_PATH = path.join(
  __dirname, "..", "donors-clean", "plumbing-clean", "assets",
  fs.readdirSync(path.join(__dirname, "..", "donors-clean", "plumbing-clean", "assets"))
    .find((f) => /^index-.*\.css$/.test(f)),
);
const donorCss = () => fs.readFileSync(DONOR_CSS_PATH, "utf8");

// A trimmed stand-in with the same shape as the real donor, for the cases where
// reading 53KB of minified Tailwind would only obscure what is being asserted.
const SLOT_DONOR =
  ":root{--accent:41 68% 52%;--accent-glow:41 68% 48%;--brand-secondary:var(--accent-glow);"
  + "--bone:oklch(96% .02 80);--gold:hsl(var(--accent));--copper:hsl(var(--brand-secondary))}";

// shadcn's --secondary is a MUTED PANEL declared beside the text colour that
// sits on it, not a brand slot. Eight of the nine clean donors ship one.
const SHADCN_DONOR =
  ":root{--secondary: 206 22% 92%;--secondary-foreground: 213 45% 14%;--accent: 41 68% 52%}";

// --- what a browser would actually paint -------------------------------------
// The assertions below are about a colour a CUSTOMER sees, so the test resolves
// the donor's declarations the way a renderer does rather than trusting that a
// substring appeared in the file.

function hslTripletToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function oklchToRgb(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lr = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const lg = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const lb = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_;
  const f = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);
  return [f(lr) * 255, f(lg) * 255, f(lb) * 255];
}

/** color-mix(in oklab, <hex> <pct>, black) — the donor's own copper recipe. */
function mixTowardBlack(hex, pct) {
  const o = hexToOklch(hex);
  const a = o.c * Math.cos((o.h * Math.PI) / 180) * pct;
  const b = o.c * Math.sin((o.h * Math.PI) / 180) * pct;
  const L = o.l * pct;
  const C = Math.hypot(a, b);
  const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c: C, h: H, rgb: oklchToRgb(L, C, H) };
}

function relativeLuminance([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const tripletOf = (css, name) => {
  const m = new RegExp(`--${name}\\s*:\\s*(\\d{1,3})\\s+(\\d{1,3})%\\s+(\\d{1,3})%`).exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/**
 * The colour --copper computes to, and the page surface it is read against.
 * --copper is `color-mix(in oklab, hsl(var(--brand-secondary)) 72%, black)`,
 * so the slot's triplet is only half the answer.
 */
function paintedCopperAndPage(css) {
  const sec = tripletOf(css, "brand-secondary") || tripletOf(css, "accent-glow");
  const copper = mixTowardBlack(toHex(...hslTripletToRgb(...sec)), 0.72);
  const bone = /--bone\s*:\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/.exec(css);
  const page = oklchToRgb(Number(bone[1]) / 100, Number(bone[2]), Number(bone[3]));
  return { copper, page };
}

/** The engine's brand chain, in engine.js's order. */
function brandChain(css, { accent, secondary }) {
  let text = css;
  if (secondary) text = applySecondaryToCss(text, { secondary }).css;
  if (accent) text = applyBrandToCss(text, { accent }).css;
  if (secondary) text = applySurfaceToCss(text, { primary: secondary }).css;
  return text;
}

// --- the donor's half of the contract ----------------------------------------

test("the shipped plumbing donor declares the slot and spends it on a real role", () => {
  const css = donorCss();
  // If a re-port of this donor ever drops these three lines the mirror silently
  // returns to black-and-gold, which is the exact defect the slot was added for.
  assert.match(css, /--brand-secondary\s*:\s*var\(--accent-glow\)/,
    "the slot is gone, or no longer defaults to the donor's own accent-glow");
  assert.match(css, /--copper\s*:\s*hsl\(var\(--brand-secondary\)\)/,
    "--copper no longer reads the secondary slot");
  assert.match(css, /--copper\s*:\s*color-mix\(in oklab, hsl\(var\(--brand-secondary\)\) 72%, black\)/,
    "the copper darkening mix was lost — that mix is what keeps the role contrast-safe");
  // The accent's own two-tier expression must NOT have been rerouted with it.
  assert.match(css, /--gold\s*:\s*hsl\(var\(--accent\)\)/, "the accent stopped driving --gold");
});

// --- a supplied second colour becomes visible --------------------------------

test("a supplied second colour fills the slot at the donor's designed lightness", () => {
  const r = applySecondaryToCss(SLOT_DONOR, { secondary: SECOND });
  assert.equal(r.changed, 1);
  assert.equal(r.hue, 96);          // #6db33f
  assert.equal(r.saturation, 48);
  assert.equal(r.donorLightness, 48); // resolved through var(--accent-glow)
  assert.equal(r.lightnessClamped, false);
  assert.match(r.css, /--brand-secondary\s*:\s*96 48% 47%/);
});

test("the customer sees a genuinely SATURATED second colour, not a tinted neutral", () => {
  const css = brandChain(donorCss(), { accent: ACCENT, secondary: SECOND });
  const { copper } = paintedCopperAndPage(css);

  // Their green, not the donor's gold and not the client's own orange.
  assert.ok(Math.abs(copper.h - hexToOklch(SECOND).h) < 2,
    `the painted role should be the client's hue, got ${copper.h.toFixed(1)}`);

  // THE POINT OF THIS WHOLE CHANGE. The surface variables the second colour
  // used to be confined to come out at chroma 0.032 (bone) and 0.039 (line) —
  // present and invisible. A paint role has to be an order away from that.
  // (The verbatim port spells the light neutrals the shadcn way — bone, muted,
  // border, input, card, popover — the hand-sanitised CSS's --line is gone.
  // Only the LIGHT declarations count: the .dark block re-declares the same
  // names at 18-22% lightness where the surface pass rightly budgets ~0.08
  // chroma, and that is not the page the copper role is painted on.)
  const surfaces = [...css.matchAll(/--(?:bone|muted|border|input|card|popover)\s*:\s*oklch\(\s*([\d.]+)%\s+([\d.]+)/g)]
    .map((m) => ({ l: Number(m[1]), c: Number(m[2]) }))
    .filter((s) => s.l >= 80)
    .map((s) => s.c);
  assert.ok(surfaces.length >= 2, "expected the donor's light surfaces to still be there");
  assert.ok(copper.c >= 0.10,
    `the secondary must carry real chroma, got ${copper.c.toFixed(3)}`);
  assert.ok(copper.c > Math.max(...surfaces) * 2,
    `secondary chroma ${copper.c.toFixed(3)} is not meaningfully above the invisible `
    + `surfaces at ${Math.max(...surfaces)}`);
});

test("the second colour is contrast-safe on the page it is painted on", () => {
  const before = brandChain(donorCss(), { accent: ACCENT, secondary: null });
  const after = brandChain(donorCss(), { accent: ACCENT, secondary: SECOND });
  const b = paintedCopperAndPage(before);
  const a = paintedCopperAndPage(after);

  const beforeRatio = contrastRatio(b.copper.rgb, b.page);
  const afterRatio = contrastRatio(a.copper.rgb, a.page);

  // --copper is used BOTH as label text on the light surface and as a fill
  // under light text (the full-width CTA band is `bg-copper text-bone`), so it
  // has to clear AA in both directions.
  assert.ok(afterRatio >= 4.5, `secondary vs page is ${afterRatio.toFixed(2)}:1, below AA`);

  // Measured 2026-08-05: driving the role off the client's ACCENT put it at
  // 3.99:1 — the shipped mirror was already failing AA on its eyebrows. Giving
  // the role the client's real second colour is also the contrast fix, so this
  // asserts an improvement rather than merely "no worse".
  assert.ok(beforeRatio < 4.5, `baseline was expected to be the failing 3.99:1, got ${beforeRatio.toFixed(2)}`);
  assert.ok(afterRatio > beforeRatio, "the secondary made contrast worse");
});

test("the accent stays the accent — the two colours are never swapped", () => {
  const accentOnly = brandChain(donorCss(), { accent: ACCENT, secondary: null });
  const withSecond = brandChain(donorCss(), { accent: ACCENT, secondary: SECOND });
  // #fcb040 -> hsl(36 97% 62%), clamped into the donor's lightness band.
  assert.deepEqual(tripletOf(withSecond, "accent"), [36, 97, 62]);
  assert.deepEqual(tripletOf(withSecond, "accent"), tripletOf(accentOnly, "accent"));
  assert.deepEqual(tripletOf(withSecond, "accent-glow"), tripletOf(accentOnly, "accent-glow"));
  // --gold is the accent's paint role and must still read from --accent.
  assert.match(withSecond, /--gold\s*:\s*hsl\(var\(--accent\)\)/);
});

// --- collapse to the donor's own default -------------------------------------

test("no second colour is a byte-identical no-op", () => {
  const css = donorCss();
  for (const bad of [undefined, null, "", "not-a-hex", "#12345", "#6db33"]) {
    const r = applySecondaryToCss(css, { secondary: bad });
    assert.equal(r.changed, 0, `secondary=${String(bad)} rewrote something`);
    assert.equal(r.css, css, `secondary=${String(bad)} changed the bytes`);
  }
});

test("with no second colour the slot collapses to the donor's default and follows the accent", () => {
  // The default is `var(--accent-glow)`, so a client who has only one brand
  // colour keeps the donor's arrangement AND still gets THEIR colour there —
  // the role must never strand on the donor's own gold.
  const css = brandChain(donorCss(), { accent: ACCENT, secondary: null });
  assert.match(css, /--brand-secondary\s*:\s*var\(--accent-glow\)/, "the default was overwritten");
  assert.deepEqual(tripletOf(css, "accent-glow"), [36, 97, 58], "the slot no longer tracks the client accent");
  const { copper } = paintedCopperAndPage(css);
  const donorGoldHue = mixTowardBlack("#ce9927", 0.72).h; // the donor's own 41 68% 48%
  assert.ok(Math.abs(copper.h - donorGoldHue) > 5,
    "the role stranded on the DONOR's gold instead of following the client's accent");
});

test("a donor without the slot is byte-identical — shadcn's --secondary is not a brand slot", () => {
  // shadcn ships --secondary as a near-neutral panel paired with
  // --secondary-foreground. Rewriting it would drop a saturated colour behind
  // body text on the eight donors that have one.
  const r = applySecondaryToCss(SHADCN_DONOR, { secondary: SECOND });
  assert.equal(r.changed, 0);
  assert.equal(r.css, SHADCN_DONOR);

  // And the same, proven against every real donor that ships one.
  const donorsRoot = path.join(__dirname, "..", "donors-clean");
  let checked = 0;
  for (const donor of fs.readdirSync(donorsRoot)) {
    const assets = path.join(donorsRoot, donor, "assets");
    if (!fs.existsSync(assets)) continue;
    for (const file of fs.readdirSync(assets).filter((f) => f.endsWith(".css"))) {
      const text = fs.readFileSync(path.join(assets, file), "utf8");
      if (!/--secondary\s*:/.test(text) || /--brand-secondary\s*:/.test(text)) continue;
      checked++;
      const out = applySecondaryToCss(text, { secondary: SECOND });
      assert.equal(out.changed, 0, `${donor}/${file}: shadcn --secondary was rewritten`);
      assert.equal(out.css, text, `${donor}/${file}: bytes changed`);
    }
  }
  assert.ok(checked >= 8, `expected the shadcn donors to be covered, checked ${checked}`);
});

test("a --brand-secondary substring in some other property is not the slot", () => {
  const css = ":root{--x-brand-secondary: 10 10% 10%;--brand-secondary-foreground: 0 0% 100%}";
  const r = applySecondaryToCss(css, { secondary: SECOND });
  assert.equal(r.changed, 0);
  assert.equal(r.css, css);
});

// --- contrast discipline on an extreme brand ---------------------------------

test("a second colour far outside the donor's band is clamped, keeping hue and saturation", () => {
  // A near-white brand yellow. Painted raw it would put ~95% lightness where
  // the donor designed for ~48% — label text that vanishes into the paper and a
  // CTA band that swallows its own white type.
  const pale = applySecondaryToCss(SLOT_DONOR, { secondary: "#FFF9C4" });
  assert.equal(pale.lightnessClamped, true);
  assert.equal(pale.appliedLightness, 62, "clamped to donorLightness 48 + the 14pt drift");
  assert.match(pale.css, /--brand-secondary\s*:\s*54 \d+% 62%/, "hue/saturation must still be theirs");

  const dark = applySecondaryToCss(SLOT_DONOR, { secondary: "#0A1F3C" });
  assert.equal(dark.lightnessClamped, true);
  assert.equal(dark.appliedLightness, 34, "clamped to donorLightness 48 - the 14pt drift");
});

test("a donor that declares the slot as a literal triplet needs no indirection", () => {
  const literal = ":root{--brand-secondary: 200 40% 30%;--copper:hsl(var(--brand-secondary))}";
  const r = applySecondaryToCss(literal, { secondary: SECOND });
  assert.equal(r.changed, 1);
  assert.equal(r.donorLightness, 30);
  assert.equal(r.appliedLightness, 44, "clamped up into the donor's band from the client's 47");
  assert.match(r.css, /--brand-secondary:\s*96 48% 44%/);
});

test("an unresolvable default is filled at the client's own lightness rather than skipped", () => {
  // No triplet to measure a band from, so there is nothing to clamp against and
  // the honest answer is the client's colour exactly as measured.
  const odd = ":root{--brand-secondary:var(--nope)}";
  const r = applySecondaryToCss(odd, { secondary: SECOND });
  assert.equal(r.changed, 1);
  assert.equal(r.donorLightness, null);
  assert.equal(r.appliedLightness, 47);
  assert.equal(r.lightnessClamped, false);
});
