"use strict";

// THE RESIDUAL AFTER THE TWO-WORLDS FIX — three donor-token mechanisms the
// 2026-08-20 live rebuild of wss-test-plumbers-local-union-3-aurora (and a
// local Chromium probe of the concrete donor) rendered, each locked here:
//
//   1. CHAIN-BLIND INK CLASSIFIERS. darkCustomProperties resolved
//      `--slurry: var(--slurry-src)` chains; its three siblings did not, so
//      the plumbing donor's `.bg-slurry`/`.bg-bone` surfaces flipped per mode
//      while `.text-slurry` — the page-wrapper ink every injected section
//      inherits — stayed near-black in dark mode: the review-carousel footer
//      measured ~1.13:1 on the repointed dark paper.
//   2. COMMA-GROUP-BLIND HARVEST. Tailwind v4 writes
//      `.bg-primary,.bg-primary\/10{background-color:var(--primary)}` as one
//      grouped rule; the one-selector regexes captured only the alpha twin,
//      so concrete's `.bg-primary` footer band was never repointed.
//   3. TRIPLET TOKENS IN A DIRECT-CONSUMING DONOR. The theme wrote every
//      shadcn token as a bare `H S% L%` triplet; a v4 donor consumes
//      `var(--primary)` DIRECTLY, where a triplet is an invalid colour — the
//      band painted nothing (footer ink on the body: 1.02:1 light) and the
//      ink fell back (rgb(24,24,27) on rgb(25,16,16) dark). Tokens now ship
//      per-token in the spelling their own donor can drink.
const test = require("node:test");
const assert = require("node:assert/strict");
const theme = require("../lib/mirror-engine/theme");
const { buttonInkRuleForSheet } = require("../lib/mirror-engine/engine");

// A miniature of plumbing-clean's saturation-dial architecture: the ink
// colour lives behind an indirection AND an @supports color-mix upgrade.
const CHAIN_DONOR = [
  ":root{--slurry-src:oklch(12% .015 60);--neutral-ink:oklab(12% 0 0);--slurry:var(--slurry-src);--bone:oklch(96% .02 80)}",
  "@supports (color:color-mix(in lab,red,red)){:root{--slurry:color-mix(in oklab, var(--slurry-src) 38%, var(--neutral-ink))}}",
  ".bg-bone{background-color:var(--bone)}",
  ".bg-slurry{background-color:var(--slurry)}",
  ".text-slurry{color:var(--slurry)}",
  ".text-slurry\\/60{color:var(--slurry)}",
  ".text-bone{color:var(--bone)}",
].join("\n");

// A miniature of concrete-elconstruction: v4 comma-grouped utilities that
// consume the tokens DIRECTLY, plus the alias layer.
const V4_DONOR = [
  ":root{--background:oklch(98.5% .005 85);--foreground:oklch(18% .03 260);--primary:oklch(24% .06 260);--primary-foreground:oklch(98.5% .005 85);--color-background:var(--background);--color-foreground:var(--foreground)}",
  ".bg-primary,.bg-primary\\/10{background-color:var(--primary)}",
  ".bg-primary\\/10{background-color:color-mix(in oklab,var(--primary) 10%,transparent)}",
  ".text-primary-foreground,.text-primary-foreground\\/60{color:var(--primary-foreground)}",
  ".bg-background{background-color:var(--background)}",
].join("\n");

// A shadcn miniature: the SAME token names, hsl-wrapped.
const SHADCN_DONOR = [
  ":root{--primary:215 60% 16%;--primary-foreground:0 0% 98%}",
  ".bg-primary{background-color:hsl(var(--primary))}",
  ".text-primary-foreground{color:hsl(var(--primary-foreground))}",
].join("\n");

// ---------------------------------------------------------------------------
// 1. chains
// ---------------------------------------------------------------------------

test("darkTextUtilities resolves the plumbing indirection — .text-slurry and its ladder", () => {
  const ink = theme.darkTextUtilities(CHAIN_DONOR);
  assert.ok(ink.vars.includes("--slurry"), "the chained name classifies dark");
  assert.ok(ink.selectors.includes(".text-slurry"), "the flat ink is harvested");
  assert.ok(ink.selectors.includes(".text-slurry\\/60"), "the faded step comes too");
});

test("a color-mix of two knowns classifies; a mix with an unknown does not", () => {
  // Only the @supports color-mix declaration, no plain var() fallback: both
  // components resolve dark, so the mix classifies.
  const mixOnly = [
    ":root{--a:oklch(12% .015 60);--b:oklab(12% 0 0);--x:color-mix(in oklab, var(--a) 38%, var(--b))}",
    ".text-x{color:var(--x)}",
  ].join("\n");
  assert.ok(theme.darkTextUtilities(mixOnly).selectors.includes(".text-x"));
  const mixUnknown = [
    ":root{--a:oklch(12% .015 60);--x:color-mix(in oklab, var(--a) 38%, var(--mystery))}",
    ".text-x{color:var(--x)}",
  ].join("\n");
  assert.deepStrictEqual(theme.darkTextUtilities(mixUnknown).selectors, []);
});

test("an owned token is a dead end ALONG the chain, not just at the surface", () => {
  // `--color-background: var(--background)` — the v4 alias. themeCss owns
  // --background per mode; classifying through the alias would double-govern
  // the same paint (the .bg-border-flattening hazard, one indirection deep).
  const owned = new Set(["--background", "--foreground"]);
  const paper = theme.lightSurfaceSelectors(V4_DONOR, { owned });
  assert.ok(!paper.vars.includes("--color-background"),
    "the alias must not re-classify through an owned token");
  const noOwned = theme.lightSurfaceSelectors(V4_DONOR);
  assert.ok(noOwned.vars.includes("--color-background"),
    "and without owned it would have — proving the dead end is load-bearing");
});

// ---------------------------------------------------------------------------
// 2. comma groups
// ---------------------------------------------------------------------------

test("a v4 comma group yields EVERY member — the concrete footer band regression", () => {
  const slabs = theme.darkSurfaceSelectors(V4_DONOR);
  assert.ok(slabs.bgUtilities.includes(".bg-primary"),
    "the flat member must be harvested (it was silently skipped before)");
  assert.ok(slabs.bgUtilities.includes(".bg-primary\\/10"),
    "the alpha twin still comes along");
  // And the flat one lands in the slab repoint while the alpha keeps its step.
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "concrete", mode: "light" });
  const sheet = theme.themeCss({ palette, donorCss: V4_DONOR, defaultMode: "light" });
  const slabRule = sheet.split("\n").find((l) => l.includes("var(--wss-slab)!important") && /\.bg-primary[,{]/.test(l));
  assert.ok(slabRule, "the footer band is repointed to the slab");
  assert.match(sheet, /\.bg-primary\\\/10\{background-color:color-mix\(in oklab,var\(--wss-slab\) 10%,transparent\)\}/);
});

test("selectorsSpending splits groups and refuses structural selectors", () => {
  const css = ".a,.b\\/10{color:var(--x)}.c .d{color:var(--x)}";
  assert.deepStrictEqual(theme.selectorsSpending(css, /^color:var\(--x\)$/), [".a", ".b\\/10"]);
});

// ---------------------------------------------------------------------------
// 3. per-token value format
// ---------------------------------------------------------------------------

test("a direct-consuming donor gets REAL colours; a wrapping donor keeps triplets", () => {
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "concrete", mode: "light" });
  const v4sheet = theme.themeCss({ palette, donorCss: V4_DONOR, defaultMode: "light" });
  // v4: `--primary:#...` — a bare triplet there is an invalid colour and the
  // measured 1.02:1 transparent-band defect.
  assert.match(v4sheet, /--primary:#[0-9A-Fa-f]{6}/);
  assert.doesNotMatch(v4sheet, /--primary:-?[\d.]+ [\d.]+% [\d.]+%/);

  const shadcnSheet = theme.themeCss({ palette, donorCss: SHADCN_DONOR, defaultMode: "light" });
  // shadcn: `hsl(var(--primary))` needs the triplet — hex inside hsl() is
  // invalid the other way around.
  assert.match(shadcnSheet, /--primary:-?[\d.]+ [\d.]+% [\d.]+%/);
  assert.doesNotMatch(shadcnSheet, /--primary:#[0-9A-Fa-f]{6}/);
});

test("a MIXED donor decides per token — the plumbing shape", () => {
  // plumbing-clean wraps --accent (`--gold:hsl(var(--accent))`) and consumes
  // --background directly. One donor, both spellings, each token in its own.
  const mixed = [
    ":root{--gold:hsl(var(--accent))}",
    "body{background-color:var(--background)}",
    ".text-gold{color:var(--gold)}",
  ].join("\n");
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "plumbing", mode: "light" });
  const sheet = theme.themeCss({ palette, donorCss: mixed, defaultMode: "light" });
  assert.match(sheet, /--accent:-?[\d.]+ [\d.]+% [\d.]+%/, "wrapped token stays a triplet");
  assert.match(sheet, /--background:#[0-9A-Fa-f]{6}/, "direct token becomes a real colour");
});

test("a donor-private accent alias spent as TEXT follows the soft accent", () => {
  // plumbing-clean: `--gold: hsl(var(--accent))`, spent as the footer brand
  // lockup's italic eyebrow — measured 2.59:1 on the pale light-mode slab.
  // Same split the theme already makes for `.text-accent`: fills keep the
  // true colour, the TEXT role gets the contrast-enforced soft accent.
  const donor = [
    ":root{--gold:hsl(var(--accent))}",
    ".text-gold{color:var(--gold)}",
    ".bg-gold{background-color:var(--gold)}",
  ].join("\n");
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "plumbing", mode: "dark" });
  const sheet = theme.themeCss({ palette, donorCss: donor, defaultMode: "dark" });
  assert.match(sheet, /\.text-gold\{color:var\(--wss-accent-soft\)!important\}/);
  assert.ok(!/\.bg-gold\{color:var\(--wss-accent-soft\)/.test(sheet),
    "the FILL use of the alias is untouched");
});

// ---------------------------------------------------------------------------
// button ink: hex values + the slab-repoint skip
// ---------------------------------------------------------------------------

test("buttonInkRuleForSheet reads hex token values from a v4 sheet", () => {
  const rule = buttonInkRuleForSheet(":root{--accent:#C2D42B}");
  // Light lime fill -> dark label, same maths as the triplet path.
  assert.match(rule, /\.bg-accent/);
  assert.match(rule, /hsl\(240 6% 10%\)/);
});

test("a slab-repointed .bg-primary is left to the slab's own ink pairing", () => {
  // When the theme repoints .bg-primary to var(--wss-slab), slabRules already
  // pair it with --wss-slab-ink per mode. Forcing the TOKEN-fill's ink over
  // that with !important painted light ink on the pale light-mode slab.
  const sheet = [
    ":root{--primary:31 30% 15%;--accent:#C2D42B}",
    ".bg-x,.bg-primary{background-color:var(--wss-slab)!important;color:var(--wss-slab-ink)}",
  ].join("\n");
  const rule = buttonInkRuleForSheet(sheet);
  assert.ok(!rule.includes(".bg-primary"), "primary skipped — the slab pairing governs");
  assert.ok(rule.includes(".bg-accent"), "accent still covered");
});
