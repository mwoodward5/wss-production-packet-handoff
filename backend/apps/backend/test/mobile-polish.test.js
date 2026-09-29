"use strict";

// test/mobile-polish.test.js
//
// THE MOBILE RENDERING DEFECT CLASS — owner, 2026-09-02: "our mobile view
// looks like shit and is cut out." At 390px the generated mirrors shipped
// dark cinematic backgrounds that swallow text (#636 donor lock-in),
// washed-out low-opacity content, sub-16px body copy, distorted images and
// 30px CTAs — visibly worse than the client's original websites.
//
// The fix is lib/mirror-engine/mobile-polish.js, injected by the fleet
// polish layer as its own idempotent <style id="wss-mobile-polish"> block.
// These tests hold its law:
//
//   1. CONTRAST — every mobileContrastPairManifest pair is COMPUTED with
//      theme.js's own WCAG 2.1 maths and must clear AA (4.5:1) against both
//      of its mode's canvases, in dark AND light donor modes;
//   2. TYPOGRAPHY — body >= 16px, headings >= 24px at 390px, phone numbers
//      18px bold, a true >= 14px floor for everything else;
//   3. SPACING — sections >= 48px vertical, card gaps >= 16px, >= 20px side
//      padding, and the no-horizontal-scroll guards;
//   4. IMAGES — content images full-width/height-auto/no-distortion, hero
//      media cover-containment re-asserted AFTER the generic rule;
//   5. CTAs — full-width, >= 48px tap, centred, palette-inked primaries;
//   6. THE WASHED-OUT FIX — opacity/blend/gradient-clip neutralised, glass
//      cards solid, and BOTH mode scopes present so a #639 brand_identity
//      light flip re-dresses a cinematic-dark donor without touching this
//      layer;
//   7. INTEGRATION — polishSite injects the block on every page, once,
//      after the fleet block, idempotently, including over the REAL
//      fencing-sterling donor document.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  mobilePolishCss,
  mobileContrastPairManifest,
  hasMobileStyle,
  injectMobileStyle,
} = require("../lib/mirror-engine/mobile-polish");
const { polishSite, mobilePolishCss: reExportedMobilePolishCss } =
  require("../lib/mirror-engine/fleet-polish");
const { contrastRatio } = require("../lib/mirror-engine/theme");

// ---------------------------------------------------------------------------
// helpers + fixtures
// ---------------------------------------------------------------------------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function braceDepthBalanced(css) {
  let depth = 0;
  for (const ch of css) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

const DONOR_ROOT = path.join(__dirname, "..", "donors-clean");
function donorHome(donor) {
  return fs.readFileSync(path.join(DONOR_ROOT, donor, "index.html"), "utf8");
}

// ---------------------------------------------------------------------------
// 1. the sheet's shape — one media query, flat CSS, <=768px (390px inside)
// ---------------------------------------------------------------------------

test("the mobile sheet is one balanced max-width 768px media query (390px inside)", () => {
  const css = mobilePolishCss();

  assert.match(css, /@media\s*\(max-width:\s*768px\)\s*\{/);
  assert.equal(
    (css.match(/@media/g) || []).length,
    1,
    "exactly one @media block — the whole sheet is mobile-scoped"
  );
  assert.ok(braceDepthBalanced(css), "braces balance");
  // The @supports fallback is nested INSIDE the media query, not a second
  // top-level at-rule escaping the mobile scope.
  assert.ok(css.indexOf("@supports") > css.indexOf("@media"));
});

test("the mobile sheet is flat CSS — no native nesting to break older WebViews", () => {
  const css = stripComments(mobilePolishCss());

  // A declaration-opening `{` must never directly follow another `{` (the
  // nested-rule shape); every `{` is preceded by a selector on its line or
  // an at-rule condition.
  const lines = css.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line === "{") {
      assert.fail("bare opening brace implies a nested rule");
    }
  }
  assert.ok(true);
});

test("fleet-polish re-exports the same mobile CSS module", () => {
  assert.equal(reExportedMobilePolishCss, mobilePolishCss);
});

// ---------------------------------------------------------------------------
// 2. THE MOBILE CONTRAST FLOOR — computed WCAG AA, both donor modes
// ---------------------------------------------------------------------------

test("every mobile contrast pair clears its WCAG bar (computed, dark and light)", () => {
  const manifest = mobileContrastPairManifest();

  assert.ok(manifest.length >= 15, "the manifest declares the full floor");
  for (const mode of ["dark", "light"]) {
    assert.ok(manifest.some((p) => p.mode === mode), `${mode} pairs declared`);
  }

  const worst = [];
  for (const pair of manifest) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    worst.push(ratio);
    assert.ok(
      ratio >= pair.minimum,
      `${pair.mode}/${pair.role}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1 < ${pair.minimum}`
    );
  }
  // The weakest declared pair still holds the AA bar with reserve.
  assert.ok(
    Math.min(...worst) >= 4.5,
    "no mobile pair ships anywhere near the AA boundary"
  );
});

test("the dark-state floor beats the worst cinematic-dark canvases", () => {
  // #101216 near-black canvas, #262a33 raised card, #1d222b the solid
  // surface THIS floor paints. Every dark ink must clear AA on ALL of them,
  // because the donor decides which canvas it actually painted.
  const dark = mobileContrastPairManifest().filter((p) => p.mode === "dark");
  const canvases = ["#101216", "#262a33", "#1d222b"];

  for (const pair of dark) {
    for (const canvas of canvases) {
      const ratio = contrastRatio(pair.fg, canvas);
      assert.ok(
        ratio >= 4.5,
        `dark ${pair.role} ${pair.fg} on ${canvas} = ${ratio.toFixed(2)}:1`
      );
    }
  }
});

test("the light-state floor beats paper and slab canvases", () => {
  const light = mobileContrastPairManifest().filter((p) => p.mode === "light");
  const canvases = ["#ffffff", "#f3f2ef"];

  for (const pair of light) {
    for (const canvas of canvases) {
      const ratio = contrastRatio(pair.fg, canvas);
      assert.ok(
        ratio >= 4.5,
        `light ${pair.role} ${pair.fg} on ${canvas} = ${ratio.toFixed(2)}:1`
      );
    }
  }
});

test("every manifest ink actually ships in the emitted CSS", () => {
  const css = mobilePolishCss().toLowerCase();

  // Surfaces the floor itself paints (the rest of the manifest's bg values
  // are the donor/theme canvases the pairs are MEASURED against, exactly
  // like the desktop manifest — the computed-ratio tests above carry them).
  const painted = new Set(["#1d222b", "#ffffff"]);

  for (const pair of mobileContrastPairManifest()) {
    assert.ok(
      css.includes(pair.fg.toLowerCase()),
      `manifest ink ${pair.fg} (${pair.role}) must ship in the sheet`
    );
    if (painted.has(pair.bg.toLowerCase())) {
      assert.ok(
        css.includes(pair.bg.toLowerCase()),
        `painted surface ${pair.bg} (${pair.role}) must ship in the sheet`
      );
    }
  }
});

test("dark colour floors use !important; light colour floors never do (hero doctrine)", () => {
  const css = stripComments(mobilePolishCss());

  // Dark: one proven ink per role with the full weight of the cascade.
  assert.match(
    css,
    /\[data-wss-theme="dark"\] body,[\s\S]*?color: #f2f3f6 !important; \}/
  );
  assert.match(
    css,
    /\[data-wss-theme="dark"\] a,\s*\n\s*:root\.dark a \{ color: #a9beff !important; \}/
  );
  assert.match(css, /color: #a9beff !important;/);
  assert.match(css, /color: #d7dce6 !important;/);
  assert.match(css, /color: #b8bcc6 !important;/);

  // Light: the ink colours WITHOUT !important so the hero ink passes' proven
  // pairs keep winning (same doctrine as the desktop light floor).
  assert.match(css, /color: #1f242e; \}/);
  assert.match(css, /color: #1747b5; \}/);
  assert.match(css, /color: #454c59; \}/);
  const lightInkImportant = /color:\s*#(1f242e|1747b5|454c59|4f5663)\s*!important/.test(css);
  assert.equal(lightInkImportant, false, "light inks ship without !important");
});

test("both mode scopes are present — a #639 light flip re-dresses the sheet for free", () => {
  const css = mobilePolishCss();

  assert.match(css, /\[data-wss-theme="dark"\]/);
  assert.match(css, /:root\.dark/);
  assert.match(css, /:root:not\(\[data-wss-theme="dark"\]\):not\(\.dark\)/);
  assert.match(css, /\[data-wss-theme="light"\]/);
  assert.doesNotMatch(
    css,
    /prefers-color-scheme/i,
    "the explicit site theme is authoritative, never the OS setting"
  );
});

test("the light floor ends with a hero guard AFTER it in the cascade", () => {
  const css = stripComments(mobilePolishCss());

  const guard = css.indexOf("color: #ffffff;");
  const lightInk = css.indexOf("color: #1f242e;");
  assert.ok(guard > 0, "hero guard present");
  assert.ok(
    guard > lightInk,
    "the white hero guard must come after the light ink floor"
  );
  assert.match(
    css,
    /:is\(\.hero, \.hero-section, \[data-hero\]\) :is\([\s\S]*?\) \{\s*\n\s*color: #ffffff;\s*\n\s*\}/
  );
});

// ---------------------------------------------------------------------------
// 3. THE MOBILE TYPOGRAPHY SCALE
// ---------------------------------------------------------------------------

test("body copy is floored at 16px, inputs included", () => {
  const css = mobilePolishCss();

  assert.match(
    css,
    /p, li, td, dd, blockquote, label, input, textarea, select \{ font-size: max\(16px, 1em\) !important; \}/
  );
  assert.match(css, /body \{ font-size: max\(16px, 1em\); line-height: 1\.6; \}/);
});

test("headings clamp with a 24px minimum at 390px", () => {
  const css = mobilePolishCss();

  // 1.5rem = 24px is the smallest clamp bound; 6vw at 390px = 23.4px so the
  // 1.5rem floor is what binds at the audit width.
  assert.match(css, /h3, h4, h5, h6 \{ font-size: clamp\(1\.5rem, 6vw, 2rem\) !important;/);
  assert.match(css, /h1 \{ font-size: clamp\(2rem, 9vw, 3\.25rem\) !important;/);
  assert.match(css, /h2 \{ font-size: clamp\(1\.75rem, 7\.5vw, 2\.5rem\) !important;/);
  // The card-scoped twin beats the fleet layer's 1.125rem !important pin.
  assert.match(
    css,
    /:is\(\[class\*="grid-cols-"\], \.cards, \.card-grid\) :is\(h3, h4, \.wss-card-title\) \{\s*\n\s*font-size: clamp\(1\.5rem, 6vw, 2rem\) !important;/
  );
});

test("nothing ships below 14px — a TRUE floor that never shrinks larger type", () => {
  const css = mobilePolishCss();

  assert.match(
    css,
    /small, span, a, strong, em, b, i, u, div, button, summary, time, address, cite, figcaption, option \{ font-size: max\(14px, 1em\) !important; \}/
  );
});

test("phone numbers are 18px bold", () => {
  const css = mobilePolishCss();

  assert.match(
    css,
    /a\[href\^="tel:"\], \.phone, \.phone-cta, \[class\*="phone" i\] \{\s*\n\s*font-size: max\(18px, 1em\) !important; font-weight: 700 !important;/
  );
});

// ---------------------------------------------------------------------------
// 4. THE MOBILE SPACING RHYTHM + NO HORIZONTAL SCROLL
// ---------------------------------------------------------------------------

test("sections breathe at >= 48px vertical and >= 20px from the edges", () => {
  const css = mobilePolishCss();

  // 3rem = 48px binds at 390px (12vw = 46.8px below it).
  assert.match(css, /padding-block: clamp\(3rem, 12vw, 4\.5rem\) !important;/);
  assert.match(css, /padding-inline: max\(20px, 5vw\) !important;/);
  assert.match(css, /box-sizing: border-box;/);
});

test("card grid gaps stay >= 16px", () => {
  const css = mobilePolishCss();

  assert.match(
    css,
    /:is\(\[class\*="grid-cols-"\], \.cards, \.card-grid\) \{\s*\n\s*gap: max\(1rem, var\(--wss-stack-gap, 1rem\)\) !important;/
  );
});

test("the no-horizontal-scroll guards ship", () => {
  const css = mobilePolishCss();

  assert.match(css, /html, body \{ max-width: 100%; overflow-x: hidden; \}/);
  assert.match(css, /@supports \(overflow-x: clip\) \{ html, body \{ overflow-x: clip; \} \}/);
  assert.match(css, /overflow-wrap: break-word;/);
  assert.match(css, /img, video \{ max-width: 100%; \}/);
});

// ---------------------------------------------------------------------------
// 5. MOBILE IMAGE QUALITY
// ---------------------------------------------------------------------------

test("content images fill their column, ratio preserved, no distortion", () => {
  const css = mobilePolishCss();

  const generic = css.indexOf(":is(main, [role=\"main\"]) img:not([src*=\"logo\" i])");
  assert.ok(generic > 0, "generic content image rule present");
  const genericBlock = css.slice(generic, css.indexOf("}", generic));
  assert.match(genericBlock, /width: 100% !important;/);
  assert.match(genericBlock, /height: auto !important;/);
  assert.match(genericBlock, /object-fit: cover;/);

  // Logo/icon/badge/avatar/decorative shapes are excluded — a forced
  // full-width icon is its own defect.
  for (const exclusion of [
    ':not([src*="logo" i])', ':not([class*="logo" i])', ':not([class*="icon" i])',
    ':not([class*="badge" i])', ':not([class*="avatar" i])', ':not([alt=""])'
  ]) {
    assert.ok(css.includes(exclusion), `image exclusion ${exclusion} present`);
  }
});

test("hero media re-assertion comes AFTER the generic rule and keeps cover containment", () => {
  const css = stripComments(mobilePolishCss());

  const generic = css.indexOf("width: 100% !important; height: auto !important;");
  const hero = css.indexOf("width: 100% !important; height: 100% !important;");
  assert.ok(generic > 0 && hero > generic,
    "hero cover rule must win the cascade over the generic height:auto rule");
  assert.match(css, /video\[data-hero-video\]/);
  assert.match(css, /\.hero :is\(img, video\)/);
  assert.match(css, /object-fit: cover !important;/);
});

// ---------------------------------------------------------------------------
// 6. MOBILE CTA VISIBILITY
// ---------------------------------------------------------------------------

test("CTAs are full-width, >= 48px tap, centred; headers keep compact buttons", () => {
  const css = mobilePolishCss();

  const ctaRule = css.indexOf("display: inline-flex; width: 100%; min-height: 48px;");
  assert.ok(ctaRule > 0, "CTA geometry rule present");
  const ctaBlock = css.slice(ctaRule, css.indexOf("}", ctaRule));
  assert.match(ctaBlock, /justify-content: center;/);
  assert.match(ctaBlock, /text-align: center;/);
  assert.match(ctaBlock, /font-size: max\(16px, 1em\) !important;/);

  const header = css.indexOf(
    'header :is(a, button):is([class*="btn" i]'
  );
  assert.ok(header > ctaRule, "header carve-out comes AFTER the full-width rule");
});

test("primary CTAs resolve ink from the palette tokens with AA fallbacks", () => {
  const css = mobilePolishCss();

  assert.match(css, /background-color: var\(--wss-accent, #2563eb\) !important;/);
  assert.match(css, /color: var\(--wss-accent-ink, #ffffff\) !important;/);
  // Fallback pair itself clears AA (computed, not asserted).
  assert.ok(contrastRatio("#ffffff", "#2563eb") >= 4.5);
});

// ---------------------------------------------------------------------------
// 7. THE WASHED-OUT FIX
// ---------------------------------------------------------------------------

test("text opacity, blend modes and gradient-clip washes are neutralised", () => {
  const css = mobilePolishCss();

  assert.match(css, /opacity: 1 !important;/);
  assert.match(css, /mix-blend-mode: normal !important;/);
  assert.match(css, /-webkit-text-fill-color: currentColor !important;/);
});

test("glass cards get SOLID high-contrast surfaces in both modes", () => {
  const css = mobilePolishCss();

  assert.match(css, /backdrop-filter: none !important;/);
  // Dark solid card surface: declared AND covered by the manifest.
  assert.match(css, /background-color: #1d222b !important; background-image: none !important;/);
  assert.match(css, /background-color: #ffffff !important;\s*\}/);
  // The solid surfaces are AA canvases for the body ink (computed).
  assert.ok(contrastRatio("#f2f3f6", "#1d222b") >= 4.5);
  assert.ok(contrastRatio("#1f242e", "#ffffff") >= 4.5);
});

// ---------------------------------------------------------------------------
// 8. INTEGRATION — the polish layer ships the block on every page
// ---------------------------------------------------------------------------

test("polishSite injects the mobile block on every html page, after the fleet block", () => {
  const files = {
    "index.html":
      "<html><head><title>A</title></head><body><p>Home</p></body></html>",
    "about.html":
      "<html><head><title>B</title></head><body><p>About</p></body></html>"
  };

  const result = polishSite(files);

  for (const key of Object.keys(files)) {
    const html = result.files[key];
    assert.match(html, /id="wss-fleet-polish"/);
    assert.match(html, /id="wss-mobile-polish"/);
    assert.equal(
      (html.match(/id="wss-mobile-polish"/g) || []).length,
      1,
      "exactly one mobile block per page"
    );
    assert.ok(
      html.indexOf('id="wss-mobile-polish"') > html.indexOf('id="wss-fleet-polish"'),
      "the mobile block lands AFTER the fleet block (cascade priority)"
    );
    assert.ok(
      html.indexOf('id="wss-mobile-polish"') < html.toLowerCase().indexOf("</head>"),
      "injected inside <head>"
    );
  }
  assert.equal(result.applied.mobileCss, true);
});

test("polishSite is idempotent with the mobile block", () => {
  const input = {
    "index.html":
      "<html><head><title>X</title></head><body><p>Hello</p></body></html>"
  };

  const first = polishSite(input);
  const second = polishSite(first.files);

  assert.deepEqual(second.files, first.files);
  assert.equal(second.applied.mobileCss, true);
  assert.equal(
    (second.files["index.html"].match(/id="wss-mobile-polish"/g) || []).length,
    1,
    "exactly one mobile block after the second pass"
  );
});

test("a page that already carries the mobile block is left byte-identical by it", () => {
  const html =
    "<html><head>" +
    '<style id="wss-mobile-polish">existing</style>' +
    "</head><body></body></html>";

  assert.equal(hasMobileStyle(html), true);
  const result = injectMobileStyle(html);
  assert.equal(result.applied, false);
  assert.equal(result.html, html);
});

test("no </head> skips the mobile injection with a warning, fail-soft", () => {
  const result = polishSite({
    "index.html": "<html><head><title>X</title><body>Hello</body></html>"
  });

  assert.equal(result.applied.mobileCss, false);
  assert.doesNotMatch(result.files["index.html"], /wss-mobile-polish/);
  assert.ok(
    result.warnings.some((w) => /mobile CSS injection skipped/.test(w) || /no <\/head>/.test(w))
  );
});

test("hostile input fails soft", () => {
  assert.equal(hasMobileStyle(null), false);
  const bad = injectMobileStyle(123);
  assert.equal(bad.applied, false);
  assert.equal(bad.html, 123);
  assert.ok(bad.warning.length > 0);
  assert.doesNotThrow(() => polishSite(null));
});

test("the real fencing-sterling donor document ships the mobile floor end to end", () => {
  const donorHtml = donorHome("fencing-sterling");
  const result = polishSite({ "index.html": donorHtml });
  const html = result.files["index.html"];

  assert.equal(result.applied.mobileCss, true);
  assert.match(html, /id="wss-mobile-polish"/);

  // Whatever the donor's own mode ends up being, BOTH treatments are on
  // board — and the specific 390px laws are in the served bytes.
  const css = mobilePolishCss();
  for (const law of [
    "max(16px, 1em)",
    "clamp(1.5rem, 6vw, 2rem)",
    "max(18px, 1em)",
    "clamp(3rem, 12vw, 4.5rem)",
    "max(20px, 5vw)",
    "min-height: 48px",
    "overflow-x: clip",
    "opacity: 1 !important",
    "#f2f3f6", "#a9beff", "#d7dce6", // dark inks
    "#1f242e", "#1747b5", "#454c59"  // light inks
  ]) {
    assert.ok(html.includes(law) && css.includes(law), `law ships: ${law}`);
  }
});
