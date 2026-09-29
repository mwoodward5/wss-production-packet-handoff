"use strict";

// The theme's :root override serves two masters with one token: --primary is
// the page's TEXT ink and the shadcn button FILL at once. On a dark-brand
// client that shipped dark-on-dark CTAs (Texas Best, 2026-08-20: fill
// "31 30% 15%", label "32 32% 16%" — ~1:1). The repair is a rule scoped to
// primary-FILLED surfaces whose ink is picked by contrast against the sheet's
// own --primary; slab/text uses of the token stay untouched.
//
// 2026-08-21: the rule became PER MODE. The theme sheet declares each token
// twice — default mode first, counterpart second — and the old single rule
// read the LAST triplet (always the counterpart) and shipped its ink UNSCOPED,
// so one mode always wore the other mode's label colour. The WCAG audit
// measured the wreckage on live headers: phone pills and tel CTAs illegible in
// BOTH modes. Now each mode gets its own ink, scoped with the class-twin
// discipline ([data-wss-theme] AND the shadcn `.dark` world), and --accent
// fills are covered too (white-on-lime CTA, 1.65:1, measured live).
const test = require("node:test");
const assert = require("node:assert/strict");
const { buttonInkRuleForSheet } = require("../lib/mirror-engine/engine.js");

test("a dark primary earns a light button label", () => {
  const rule = buttonInkRuleForSheet(":root{--primary:31 30% 15%;--primary-foreground:32 32% 16%}");
  assert.match(rule, /\.bg-primary/);
  assert.match(rule, /hsl\(0 0% 98%\)/);
  assert.match(rule, /!important/);
});

test("a light primary earns a dark label", () => {
  const rule = buttonInkRuleForSheet(":root{--primary:48 90% 92%}");
  assert.match(rule, /hsl\(240 6% 10%\)/);
});

test("TWO declarations produce TWO scoped rules — each mode wears its own ink", () => {
  // Default (light) mode's primary is light -> dark label, scoped to light;
  // the counterpart's primary is dark -> light label, scoped to dark. The old
  // code shipped ONLY the counterpart's ink, unscoped — wrong for light mode.
  const rule = buttonInkRuleForSheet(":root{--primary:48 90% 92%} :root{--primary:31 30% 15%}", "light");
  // Light-mode rule: dark ink, guarded away from the class-dark world.
  assert.match(rule, /:root:not\(\[data-wss-theme="dark"\]\):not\(\.dark\) \.bg-primary[^{]*\{color:hsl\(240 6% 10%\)/);
  // Dark-mode rule: light ink, present in BOTH worlds (attr and .dark class).
  assert.match(rule, /\[data-wss-theme="dark"\] \.bg-primary/);
  assert.match(rule, /:root\.dark \.bg-primary/);
  assert.match(rule, /hsl\(0 0% 98%\)/);
});

test("a dark DEFAULT mode maps the first declaration to dark scope", () => {
  const rule = buttonInkRuleForSheet(":root{--primary:31 30% 15%} :root{--primary:48 90% 92%}", "dark");
  // First triplet is the dark default -> light ink under the no-JS-safe scope.
  assert.match(rule, /:root:not\(\[data-wss-theme="light"\]\) \.bg-primary[^{]*\{color:hsl\(0 0% 98%\)/);
  // Counterpart (light) -> dark ink under the light scope.
  assert.match(rule, /\[data-wss-theme="light"\]:not\(\.dark\) \.bg-primary[^{]*\{color:hsl\(240 6% 10%\)/);
});

test("alpha-tint pills are exempt — a 10% tint is not a primary-filled surface", () => {
  // The header phone pill is `bg-primary/10`: its painted surface is the page
  // tint, so forcing the FILL's ink onto it is the invisible-pill defect
  // (measured on 3+ live sites, both modes). The substring selector must
  // carry the :not guard that releases every alpha step.
  const rule = buttonInkRuleForSheet(":root{--primary:31 30% 15%}");
  assert.match(rule, /\[class\*="bg-primary"\]:not\(\[class\*="bg-primary\/"\]\)/);
});

test("an accent fill gets the same treatment — the white-on-lime CTA", () => {
  // Lime at 74% lightness carried WHITE labels at 1.65:1 on a live site. The
  // accent fill now earns a contrast-picked dark ink of its own.
  const rule = buttonInkRuleForSheet(":root{--accent:68 66% 46%}");
  assert.match(rule, /\.bg-accent/);
  assert.match(rule, /\.bg-gradient-accent/);
  assert.match(rule, /hsl\(240 6% 10%\)/);
});

test("neither token in the sheet means no rule at all", () => {
  assert.equal(buttonInkRuleForSheet(":root{--secondary:33 79% 55%}"), "");
  assert.equal(buttonInkRuleForSheet(""), "");
});
