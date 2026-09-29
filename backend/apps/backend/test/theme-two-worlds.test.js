"use strict";

// THE TWO-WORLDS BUG, locked. Measured by the 2026-08-20 dual-viewport WCAG
// audit on 8 live sites: the engine themed by [data-wss-theme] while the
// shadcn donors keyed dark styles on the `.dark` CLASS, and neither world
// could see the other's switch. Footers rendered near-black text on a
// near-black donor band in dark mode (rgb(24,24,27) on ~rgb(25,20,16)); Glo
// Med Spa showed the inverse (light-gray on light-gray when toggled dark).
//
// The fix is symmetrical and these tests pin both halves:
//   1. boot + toggle scripts drive classList.toggle("dark", …) beside the
//      attribute, so donor `.dark` rules follow the same switch;
//   2. every mode-scoped rule the theme emits carries a class twin — dark
//      scopes are an ARRAY of prefixes ([attr="dark"] plus :root.dark), light
//      scopes carry :not(.dark).
//
// Plus the hero-gradient half of the audit: --gradient-hero must be DARK in
// both modes, because the hero ink pass forces white with !important and a
// white headline on a pale l=96 wash measured 1.02:1 in light mode.
const test = require("node:test");
const assert = require("node:assert/strict");
const theme = require("../lib/mirror-engine/theme");

const PAPER_DONOR = [
  ":root{--bone:oklch(96% 0.032 135.1);--slurry:oklch(12% 0.083 135.1)}",
  ".bg-bone{background-color:var(--bone)}",
  ".bg-slurry{background-color:var(--slurry)}",
  ".text-slurry{color:var(--slurry)}",
  ".text-bone{color:var(--bone)}",
].join("\n");

// ---------------------------------------------------------------------------
// the scope helpers
// ---------------------------------------------------------------------------

test("dark scopes are an ARRAY carrying the .dark class twin", () => {
  assert.deepStrictEqual(theme.modeScopePrefixes("dark", "light"), [
    '[data-wss-theme="dark"] ',
    ":root.dark ",
  ]);
  assert.deepStrictEqual(theme.modeScopePrefixes("dark", "dark"), [
    ':root:not([data-wss-theme="light"]) ',
    ":root.dark ",
  ]);
});

test("light scopes carry :not(.dark) so they never bleed into a class-dark page", () => {
  assert.deepStrictEqual(theme.modeScopePrefixes("light", "light"), [
    ':root:not([data-wss-theme="dark"]):not(.dark) ',
  ]);
  assert.deepStrictEqual(theme.modeScopePrefixes("light", "dark"), [
    '[data-wss-theme="light"]:not(.dark) ',
  ]);
});

test("scopeSelectors flat-maps every prefix over every selector", () => {
  const out = theme.scopeSelectors(["A ", "B "], [".x", ".y"]);
  assert.equal(out, "A .x,A .y,B .x,B .y");
});

// ---------------------------------------------------------------------------
// the emitted sheet
// ---------------------------------------------------------------------------

test("the dark counterpart variables answer to the class world too", () => {
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "hvac", mode: "light" });
  const sheet = theme.themeCss({ palette, donorCss: PAPER_DONOR, defaultMode: "light" });
  // The dark vars rule must match [attr="dark"] AND :root.dark — one set of
  // values, both switching mechanisms.
  assert.ok(sheet.includes('[data-wss-theme="dark"],:root.dark{'),
    "dark counterpart vars must carry the :root.dark twin");
});

test("a dark DEFAULT carries the twin on its own vars, and the light counterpart is class-guarded", () => {
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "hvac", mode: "dark" });
  const sheet = theme.themeCss({ palette, donorCss: PAPER_DONOR, defaultMode: "dark" });
  assert.ok(sheet.includes(':root,[data-wss-theme="dark"],:root.dark{'),
    "dark default vars must carry the :root.dark twin");
  assert.ok(sheet.includes('[data-wss-theme="light"]:not(.dark){'),
    "the light counterpart must refuse to apply while the .dark class stands");
});

test("the paper repoint reaches the class-dark world (Glo Med Spa inverse, locked)", () => {
  // A LIGHT-default mirror whose visitor toggles dark: the paper rules were
  // scoped [data-wss-theme="dark"] only, so a page made dark via the class
  // world kept its light-donor paper under our dark inks — light-gray on
  // light-gray, measured live. Every paper rule now ships with both prefixes.
  const palette = theme.buildThemePair({ accent: "#ED1C24", vertical: "plumbing", mode: "light" });
  const sheet = theme.themeCss({ palette, donorCss: PAPER_DONOR, defaultMode: "light" });
  const paperRule = sheet.split("\n").find((l) => l.includes(".bg-bone{background-color:var(--wss-surface)}"));
  assert.ok(paperRule, "the paper rule exists");
  assert.match(paperRule, /\[data-wss-theme="dark"\] \.bg-bone/);
  assert.match(paperRule, /:root\.dark \.bg-bone/, "the class twin must be present");
});

// ---------------------------------------------------------------------------
// the scripts — half 1 of the fix
// ---------------------------------------------------------------------------

test("the boot script drives the .dark class beside the attribute", () => {
  for (const mode of ["light", "dark"]) {
    const s = theme.themeBootScript(mode);
    assert.match(s, /classList\.toggle\("dark",m==="dark"\)/);
    // The catch path too — a storage exception must not strand the class.
    assert.match(s, /catch\(e\)\{[^}]*classList\.toggle\("dark"/);
  }
});

test("the toggle re-syncs the class on every paint and every click", () => {
  const html = theme.themeToggleHtml();
  const toggles = html.match(/classList\.toggle\("dark",m==="dark"\)/g) || [];
  assert.ok(toggles.length >= 2, `paint AND click must both sync the class — found ${toggles.length}`);
});

// ---------------------------------------------------------------------------
// the hero gradient — dark in BOTH modes
// ---------------------------------------------------------------------------

test("--gradient-hero is built from a scrim that carries white ink in light mode", () => {
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "hvac", mode: "light" });
  const sheet = theme.themeCss({ palette, donorCss: PAPER_DONOR, defaultMode: "light" });
  const m = /--wss-hero-scrim:(#[0-9A-Fa-f]{6})/.exec(sheet);
  assert.ok(m, "the hero scrim variable must be declared");
  // The scrim is the DARK theme's slab, not the light theme's pale l=96 tint.
  assert.equal(m[1].toUpperCase(), String(palette.counterpart.slab).toUpperCase());
  const ratio = theme.contrastRatio("#FFFFFF", m[1]);
  assert.ok(ratio >= 4.5, `white hero ink must clear AA on the scrim — got ${ratio.toFixed(2)}:1`);
  assert.ok(sheet.includes("--gradient-hero:linear-gradient(115deg,color-mix(in srgb,var(--wss-hero-scrim) 92%"),
    "the hero gradient must be built from the hero scrim, not the mode slab");
});

test("a dark-default build keeps its own slab as the hero scrim", () => {
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "hvac", mode: "dark" });
  const sheet = theme.themeCss({ palette, donorCss: PAPER_DONOR, defaultMode: "dark" });
  const m = /--wss-hero-scrim:(#[0-9A-Fa-f]{6})/.exec(sheet);
  assert.ok(m);
  assert.equal(m[1].toUpperCase(), String(palette.slab).toUpperCase());
});

test("heroScrimFallback collapses garbage to the dark anchor and darkens anything real", () => {
  assert.equal(theme.heroScrimFallback(""), "#0B1220");
  const washed = theme.heroScrimFallback("#F8F7F4");
  assert.ok(theme.contrastRatio("#FFFFFF", washed) >= 4.5,
    "even a near-white input must come back dark enough for white ink");
});

// ---------------------------------------------------------------------------
// mobile tap targets (2026-08-20 audit: 40-53 sub-44px links per site)
// ---------------------------------------------------------------------------

test("footer and nav links get a 44px minimum hit area on phones", () => {
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "hvac", mode: "light" });
  const sheet = theme.themeCss({ palette, donorCss: PAPER_DONOR, defaultMode: "light" });
  assert.match(sheet, /@media \(max-width:640px\)\{nav a,nav button,footer a,footer button\{min-height:44px/);
});
