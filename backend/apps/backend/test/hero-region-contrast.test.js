"use strict";

// test/hero-region-contrast.test.js
//
// THE SUITE THAT SHOULD HAVE CAUGHT CLASS B (final QA, 2026-09-04).
//
// The light-theme "wash": on the fencing and HVAC mirrors the hero H1, the
// sub-line, the primary CTA pills and the stat numerals all rendered
// ghost-white on the themed near-white hero — measured on the live builds at
// 1.02-1.61:1 (master-fence, middle-tn, armock, earth-power; worst:
// master-fence H1 at 1.12:1). Every shipped token pair was green in
// check:contrast, because the gate measured only the palette's DECLARED
// roles and never the pairs the hero region actually paints. Three defects
// compounded there, all fixed in the theme/polish layer and pinned here:
//
//   1. fleet-polish's light "hero-ink guard" forced `color: #ffffff` on every
//      hero word, trusting a generic dark veil — while the theme pass had
//      already repointed those hero surfaces to pale tints. The guard ink is
//      now the palette's proven --wss-text.
//   2. The polish raise (`:is(.hero) > * { z-index: 1 }`, unlayered)
//      DEMOTED the donors' layered content wrappers below the donors' own
//      translucent scrims (fencing: .hero-inner 21 -> 1, scrim stays 20), so
//      the pale scrim painted ON TOP of the words. The raise now clears the
//      donor stack.
//   3. The engine's --wss-accent-ink / --wss-accent-text tokens mean the
//      OPPOSITE of what the clean donors' sheets mean, so repainting them
//      verbatim shipped white stat numerals on near-white cards
//      (`--wss-accent-ink` is ink-ON-accent for the engine, accent-AS-ink
//      for the donors). themeCss now remaps the donors' own color: spends
//      per rule, proven per role.
//
// The assertions below parse the EMITTED theme sheet's actual values and
// measure the pairs with the same WCAG maths the engine uses — so a white-
// on-white hero region can never ship again silently.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const theme = require("../lib/mirror-engine/theme");
const fleetPolish = require("../lib/mirror-engine/fleet-polish");

const DONORS_ROOT = path.join(__dirname, "..", "donors-clean");

const ratioOf = (fg, bg) => theme.contrastRatio(theme.normalizeHex(fg), theme.normalizeHex(bg));

/** The donors the final-QA verdict named as the Class B wash, plus the
 *  concrete donor whose family convention the token swap serves. */
const WASH_DONORS = [
  { donor: "fencing-sterling", vertical: "fencing", accent: "#2f6f4f" },
  { donor: "hvac-premier", vertical: "hvac", accent: "#c2703b" },
  { donor: "concrete-elconstruction", vertical: "concrete", accent: "#3c6ea5" },
];

function donorCssOf(donor) {
  const assets = path.join(DONORS_ROOT, donor, "assets");
  for (const f of fs.readdirSync(assets).filter((f) => /\.css$/i.test(f))) {
    const css = fs.readFileSync(path.join(assets, f), "utf8");
    if (/(^|[^a-z-])--wss-slab\s*:/i.test(css)) return css;
  }
  return "";
}

/** Parse the FIRST custom-property block of the emitted theme sheet — the
 *  main palette's shipped values — into a Map. */
function shippedTokens(themeSheet) {
  const key = themeSheet.indexOf("--wss-surface:");
  const open = themeSheet.lastIndexOf("{", key);
  const close = themeSheet.indexOf("}", key);
  const body = themeSheet.slice(open + 1, close);
  const map = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

function sheetHasRule(sheet, selector, declaration) {
  for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (sels.includes(selector) && m[2].includes(declaration)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1. the shipped token pairs of the hero region, both modes, per donor
// ---------------------------------------------------------------------------
for (const { donor, vertical, accent } of WASH_DONORS) {
  for (const mode of ["light", "dark"]) {
    test(`hero region ${donor}/${mode}: every shipped hero-region pair clears AA 4.5:1`, () => {
      const donorCss = donorCssOf(donor);
      assert.ok(donorCss, `${donor} ships a --wss-* stylesheet`);
      const palette = theme.buildPalette({ vertical, mode, accent });
      const sheet = theme.themeCss({ palette, donorCss, defaultMode: mode });
      const tokens = shippedTokens(sheet);

      const pairs = [
        // hero words on the themed slab band and on cards/alt bands
        ["hero H1 on slab", tokens.get("--wss-text"), tokens.get("--wss-slab")],
        ["hero H1 on cards", tokens.get("--wss-text"), tokens.get("--wss-surface-alt")],
        // primary CTA label on the accent fill (donor .btn-primary pair)
        ["CTA label on accent", tokens.get("--wss-accent-ink"), tokens.get("--wss-accent")],
        // slab-block CTA treatment
        ["CTA label on slab variant", tokens.get("--wss-slab-ink"), tokens.get("--wss-slab")],
        // accent-as-text: stat numerals, hover links, ratings (the ghost cards)
        ["stat numeral on cards", tokens.get("--wss-accent-text"), tokens.get("--wss-surface-alt")],
        ["accent link on paper", tokens.get("--wss-accent-text"), tokens.get("--wss-surface")],
      ];
      for (const [label, fg, bg] of pairs) {
        assert.ok(fg && bg, `${label}: both inks ship (${fg} on ${bg})`);
        const ratio = ratioOf(fg, bg);
        assert.ok(
          ratio >= 4.5,
          `${donor}/${mode} ${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 — below AA 4.5:1 ` +
          `(the Class B wash shipped this pair at 1.02-1.61:1)`
        );
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 2. the donor accent-role swap — the token collision behind the ghost cards
// ---------------------------------------------------------------------------
test("themeCss remaps the donors' accent-ink/-text color spends to the proven role values", () => {
  const donorCss = donorCssOf("fencing-sterling");
  const palette = theme.buildPalette({ vertical: "fencing", mode: "light", accent: "#2f6f4f" });
  const sheet = theme.themeCss({ palette, donorCss, defaultMode: "light" });
  // The donors' -ink means accent-AS-text (stat numerals): remapped to the
  // proven accent-text ink.
  assert.ok(
    sheetHasRule(sheet, ".stat b", "color:var(--wss-accent-text)"),
    "the ghost stat numerals (.stat b) must be remapped to the accent-as-text ink"
  );
  assert.ok(
    sheetHasRule(sheet, ".nav a:hover", "color:var(--wss-accent-text)"),
    "nav hovers spend the same accent-as-text role and must follow"
  );
  // The donors' -text means ink-ON-accent (button labels): remapped to the
  // ink proven on the accent fill.
  assert.ok(
    sheetHasRule(sheet, ".btn-primary", "color:var(--wss-accent-ink)"),
    "the primary button label (.btn-primary) must be remapped to the ink-on-accent"
  );
  // The TOKENS themselves keep the engine meanings (the engine's own islands
  // and the mobile CTA rule consume them).
  const tokens = shippedTokens(sheet);
  assert.equal(
    tokens.get("--wss-accent-ink"),
    palette.accentInk,
    "--wss-accent-ink stays the engine's ink-on-accent"
  );
});

test("the swap does not fire for a sheet without the clean-family defaults", () => {
  // A donorCss with no --wss-accent-ink/-text defaults gets a sheet with no
  // swap rules — detection is from declared defaults, not a name guess.
  const donorCss = ":root{--wss-slab:#12211b;--wss-surface:#ffffff}.x{color:var(--wss-accent-ink)}";
  const palette = theme.buildPalette({ vertical: "fencing", mode: "light", accent: "#2f6f4f" });
  const sheet = theme.themeCss({ palette, donorCss, defaultMode: "light" });
  assert.equal(
    sheetHasRule(sheet, ".x", "color:var(--wss-accent-text)"),
    false,
    "no defaults, no swap"
  );
});

// ---------------------------------------------------------------------------
// 2b. the hvac band tokens — the on-slab hero inks the theme used not to know
// ---------------------------------------------------------------------------
test("hvac-premier's band inks follow the theme into both modes", () => {
  const donorCss = donorCssOf("hvac-premier");
  assert.match(donorCss, /--wss-band-ink\s*:/, "the donor declares the band pair");
  for (const mode of ["light", "dark"]) {
    const palette = theme.buildPalette({ vertical: "hvac", mode, accent: "#c2703b" });
    const sheet = theme.themeCss({ palette, donorCss, defaultMode: mode });
    const tokens = shippedTokens(sheet);
    assert.equal(tokens.get("--wss-band-ink"), palette.slabInk,
      `${mode}: the band ink is the slab ink (proven 7:1 against the slab)`);
    assert.equal(tokens.get("--wss-band-accent"), palette.accentOnSlab,
      `${mode}: the band accent phrase is the accent proven ON the slab`);
    // The H1 accent phrase sits on the band: prove the pair it actually paints.
    const ratio = ratioOf(tokens.get("--wss-band-accent"), tokens.get("--wss-slab"));
    assert.ok(ratio >= 4.5, `${mode}: band accent on slab = ${ratio.toFixed(2)}:1, below 4.5`);
  }
});

test("the accent spent directly as text gets the proven accent-text ink", () => {
  // hvac-premier's hero `.accent-line` paints `color: var(--wss-accent)` —
  // same-on-same in light mode for a bright client accent (measured 4.27:1
  // on earth-power, Class B). The spend is remapped to the accent-text ink.
  const donorCss = donorCssOf("hvac-premier");
  const palette = theme.buildPalette({ vertical: "hvac", mode: "light", accent: "#0881c1" });
  const sheet = theme.themeCss({ palette, donorCss, defaultMode: "light" });
  assert.ok(
    sheetHasRule(sheet, ".accent-line", "color:var(--wss-accent-text)"),
    "the hero accent phrase must wear the accent-as-text ink, not the raw accent"
  );
  // ...and a multi-declaration rule that LEADS with the color declaration is
  // still collected (the collector must see donor component rules, not just
  // single-declaration utilities).
  assert.ok(
    sheetHasRule(sheet, ".rating-stars", "color:var(--wss-accent-text)"),
    "color-first rule bodies are collected too"
  );
});

// ---------------------------------------------------------------------------
// 3. the polish floor's hero-ink guard and veil — the white-on-white defect
// ---------------------------------------------------------------------------
test("the wash ink pass restates its pair light-scoped when the light palette ships", () => {
  const { heroTextCss } = require("../lib/hero-wash");
  const palette = theme.buildPalette({ vertical: "hvac", mode: "light", accent: "#0881c1" });
  const out = heroTextCss({
    selector: "section.hero",
    lightInk: palette.slabInk,
    lightSubInk: palette.slabMuted,
  });
  assert.ok(out.applied);
  // The light state wears the themed band ink (the pale donor hero layers
  // paint over the wash there); the dark state keeps the proven white pair.
  assert.match(out.css, /\[data-wss-theme="light"\] :is\(section\.hero\) h1/);
  assert.match(out.css, /color: #ffffff !important;/);
  // The light-state pair is proven: slab ink on the themed slab clears AA.
  const ratio = ratioOf(palette.slabInk, palette.slab);
  assert.ok(ratio >= 4.5, `slabInk on slab = ${ratio.toFixed(2)}:1, below 4.5`);
  // Without light inks the sheet is the historical block — no light scope.
  const plain = heroTextCss({ selector: "section.hero" });
  assert.doesNotMatch(plain.css, /data-wss-theme="light"/);
});

test("the light hero-ink guard ships the themed ink, never bare white", () => {
  const css = fleetPolish.contrastFloorCss();
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(
    noComments,
    /:root:not\(\[data-wss-theme="dark"\]\):not\(\.dark\) :is\(\.hero, \.hero-section, \[data-hero\]\) :is\(h1, h2, h3, h4, h5, h6, p, a, span, li, small, strong, em, figcaption, blockquote, label\) \{\s*\n\s*color: var\(--wss-text, #242933\);/,
    "the hero guard must force the palette's proven text ink (fallback for unthemed builds)"
  );
  assert.doesNotMatch(
    noComments,
    /color:\s*#ffffff;/,
    "a bare white ink in the light floor is the Class B wash guard"
  );
});

test("the generic hero veil paints in dark mode only", () => {
  const css = fleetPolish.fleetPolishCss();
  assert.match(
    css,
    /\[data-wss-theme="dark"\] :is\(\.hero, \.hero-section, \[data-hero\]\)::before/,
    "the dark veil keeps darkening the dark canvas"
  );
  // In light mode the theme owns the hero surfaces; an unscoped black veil
  // greyed them and sat under the old white guard (the wash). Every hero
  // ::before rule in the sheet must be dark-scoped on BOTH selector worlds.
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of noComments.matchAll(/([^{}]+)\{[^{}]*::before[^{}]*\}/g)) {
    const sels = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    assert.ok(sels.length, "hero veil rule parsed");
    for (const sel of sels) {
      assert.ok(
        /^\[data-wss-theme="dark"\]/.test(sel) || /^:root\.dark\b/.test(sel),
        `hero ::before selector must be dark-scoped, got: ${sel}`
      );
    }
  }
});

test("the hero content raise clears the donors' own decorative layers", () => {
  const css = fleetPolish.fleetPolishCss();
  // The old z-index: 1 out-ranked the clean donors' LAYERED content wrappers
  // (fencing raises .hero-inner to 21) while their scrims kept z-index 20 —
  // the pale scrim painted ON TOP of the words and washed every hero
  // element, ink pair correct or not.
  assert.match(
    css,
    /:is\(\.hero, \.hero-section, \[data-hero\]\) > \* \{ position: relative; z-index: 30; \}/,
    "the raise must clear the donor scrim stack (<= 21) and stay under header/floater/drawer (60/70/80)"
  );
});

test("the primary-CTA ink follows the palette's ink-on-accent, with the unthemed fallback", () => {
  const css = fleetPolish.fleetPolishCss();
  assert.match(
    css,
    /:is\(\.btn-primary, \[data-cta="primary"\]\) \{ color: var\(--wss-accent-ink, #111827\) !important; \}/,
    "the hard-coded navy measured 1.36:1 on a dark brand accent; the themed builds get the proven ink"
  );
});

// ---------------------------------------------------------------------------
// 4. the check:contrast gate itself covers the hero region
// ---------------------------------------------------------------------------
test("check:contrast measures the hero-region pairs (the gate that was missing)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "check-contrast.js"), "utf8");
  assert.match(source, /hero-ink-on-slab/);
  assert.match(source, /cta-ink-on-accent/);
  assert.match(source, /stat-ink-on-cards/);
  assert.match(source, /HERO_REGION_MINIMUM = 4\.5/);
  // And the gate must run green on the current tree.
  const { execFileSync } = require("node:child_process");
  execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "check-contrast.js")], {
    stdio: "pipe",
  });
});
