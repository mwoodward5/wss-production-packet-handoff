"use strict";

// test/fleet-polish-audit-css.test.js
//
// THE COMET AUDIT CROSS-CUTTING CSS LAWS (issue #563, owner-endorsed), pins
// for the four fixes this layer still owed after PR #564:
//
//   1. HEADER RIGHT-CLUSTER COLLISION — phone CTA vs theme toggle share the
//      header's right cluster and collide (Rumsey, Good Life, All Florida,
//      Nevada, Precision, Pure).
//   5. TESTIMONIAL CARD OVERFLOW — donor testimonial cards clip on narrow
//      viewports (Good Life); they get the scroll-snap track treatment, and
//      the engine's own .wss-rv__track is never double-applied.
//   8. HERO BLUR/BLANK FLASH — command-template donors gate the headline
//      behind JS; the words are forced visible, with a no-js safety and an
//      OPT-IN 0.5s heroIn fade that starts from a visible-safe state.
//   9. STAR TOGGLE UNLABELED — lives in content-inject.js
//      (controlA11yPatchScript); pinned in content-inject-ai-fill.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { fleetPolishCss, polishSite } = require("../lib/mirror-engine/fleet-polish");

// ---------------------------------------------------------------------------
// FIX 1 — header right-cluster collision
// ---------------------------------------------------------------------------
test("fix 1: the header right cluster is a gapped flex row, the toggle orders last, the phone number never wraps", () => {
  const css = fleetPolishCss();
  assert.match(css, /header :is\(\.header-actions, \.header__actions, \.nav-actions, \.nav__actions, \.right-cluster\) \{\s*\n\s*display: flex; align-items: center; gap: 0\.75rem;/);
  assert.match(css, /header :is\(a\[href\^="tel:"\], \.phone, \.phone-cta\) \{ white-space: nowrap; \}/);
  // Generic donor toggles too, not only the engine-injected one.
  assert.match(css, /header :is\(\[data-wss-theme-toggle\], \[data-theme-toggle\], \.theme-toggle\) \{ order: 99; flex: none; \}/);
});

test("fix 1: below 1024px the inline nav steps aside for the donor's burger", () => {
  const css = fleetPolishCss();
  assert.match(css, /@media \(max-width: 1023px\) \{ header :is\(nav, \.nav, \.navigation\) \{ display: none; \} \}/);
});

// ---------------------------------------------------------------------------
// FIX 5 — testimonial card overflow becomes a snap track
// ---------------------------------------------------------------------------
test("fix 5: testimonial containers become snap tracks with snap slides", () => {
  const css = fleetPolishCss();
  // The track: testimonial-scoped containers only.
  assert.match(css, /\[class\*="testimonial"\], \[id\*="testimonial"\], \[data-testimonials\], \[aria-label\*="testimonial" i\]/);
  assert.match(css, /scroll-snap-type: x mandatory/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /overscroll-behavior-x: contain/);
  // The cards: direct children become fixed-basis snap slides.
  assert.match(css, /> :is\(figure, blockquote, article, li, \[class\*="testimonial"\]\) \{\s*\n\s*flex: 0 0 min\(340px, 85%\); scroll-snap-align: start;/);
});

test("fix 5: the engine's own .wss-rv__track is excluded, never double-applied", () => {
  const css = fleetPolishCss();
  // Judge only the selectors, never the documentation comments.
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Both the track rule and the slide rule carry the explicit exclusion, so
  // .wss-rv__track keeps its own basis (min(360px, 86%)) and snap behaviour.
  const selectors = cssNoComments.match(/[^{}\n]*\.wss-rv__track[^{}\n]*\{/g) || [];
  assert.ok(selectors.length >= 2, `both testimonial rules exclude .wss-rv__track (got ${selectors.length})`);
  for (const selector of selectors) {
    assert.match(selector, /:not\(\.wss-rv__track\)/,
      `.wss-rv__track may appear in a selector only as an :not() exclusion: ${selector}`);
  }
});

test("fix 5: a donor testimonial section ships the track via polishSite", () => {
  const files = {
    "index.html": "<html><head><title>Good Life</title></head><body><section class='testimonials'><figure>Card</figure><figure>Card</figure></section></body></html>",
  };
  const result = polishSite(files, {});
  assert.equal(result.applied.tapCss, true);
  const html = result.files["index.html"];
  assert.match(html, /id="wss-fleet-polish"/);
  assert.match(html, /scroll-snap-type: x mandatory/);
  assert.match(html, /flex: 0 0 min\(340px, 85%\)/);
});

// ---------------------------------------------------------------------------
// FIX 8 — hero blur/blank flash
// ---------------------------------------------------------------------------
test("fix 8: hero headlines and data-animate nodes are forced visible (opacity, filter, transform)", () => {
  const css = fleetPolishCss();
  assert.match(css, /:is\(\.hero, \.hero-section, \[data-hero\]\) :is\(h1, \[data-animate\]\) \{ opacity: 1 !important; filter: none !important; transform: none !important; \}/);
  assert.match(css, /\[data-animate\] h1 \{ opacity: 1 !important; filter: none !important; transform: none !important; \}/);
});

test("fix 8: the no-js safety keeps the words visible without JavaScript", () => {
  const css = fleetPolishCss();
  assert.match(css, /html\.no-js :is\(\.hero, \.hero-section, \[data-hero\]\) :is\(h1, \[data-animate\]\) \{ opacity: 1 !important; filter: none !important; transform: none !important; \}/);
});

test("fix 8: wssHeroIn is opt-in, starts from a VISIBLE-SAFE state, and honours reduced motion", () => {
  const css = fleetPolishCss();
  // Never opacity:0: the fade starts at 0.4, an already-readable hero.
  assert.match(css, /@keyframes wssHeroIn \{ from \{ opacity: 0\.4; transform: translateY\(8px\); \} to \{ opacity: 1; transform: none; \} \}/);
  assert.doesNotMatch(css, /wssHeroIn \{ from \{ opacity: 0[;\s]/, "the fade must never start from a blank hero");
  // Opt-in only, 0.5s, and reduced motion stands it down.
  assert.match(css, /\[data-wss-hero-in\] :is\(h1, \[data-animate\]\) \{ animation: wssHeroIn 0\.5s ease-out both; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \[data-wss-hero-in\] :is\(h1, \[data-animate\]\) \{ animation: none; \} \}/);
});
