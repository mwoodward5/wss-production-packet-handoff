"use strict";

// Readable buttons, enforced. The recolor passes mapped --primary-foreground
// right along with --primary; Texas Best Fence & Patio (2026-08-20) shipped
// every CTA as a dark pill with invisible text: --primary "31 30% 15%" with
// --primary-foreground "32 32% 16%" — one lightness point apart. The
// foreground of a shadcn pair is whatever READS on the base, never a brand hue.
const test = require("node:test");
const assert = require("node:assert/strict");
const { enforcePairedForegroundContrast, wcagContrast, hslTripletToRgb } = require("../lib/capture-brand");

test("the live Texas Best failure is repaired to readable white-on-brown", () => {
  const css = ":root{--primary: 31 30% 15%;--primary-foreground: 32 32% 16%;}";
  const { css: out, changed, repaired } = enforcePairedForegroundContrast(css);
  assert.equal(changed, 1);
  assert.deepEqual(repaired, ["primary-foreground"]);
  assert.match(out, /--primary-foreground: 0 0% 98%/);
  const ratio = wcagContrast(hslTripletToRgb("31 30% 15%"), hslTripletToRgb("0 0% 98%"));
  assert.ok(ratio >= 4.5, `repaired pair must clear AA, got ${ratio.toFixed(2)}`);
});

test("a pair the donor tuned correctly is left byte-identical", () => {
  const css = ":root{--primary: 31 30% 15%;--primary-foreground: 0 0% 98%;--accent: 33 79% 55%;--accent-foreground: 240 4% 5%;}";
  const { css: out, changed } = enforcePairedForegroundContrast(css);
  assert.equal(changed, 0);
  assert.equal(out, css);
});

test("a LIGHT base with light text gets near-black text, not white", () => {
  const css = ":root{--secondary: 48 90% 92%;--secondary-foreground: 50 80% 85%;}";
  const { css: out, changed } = enforcePairedForegroundContrast(css);
  assert.equal(changed, 1);
  assert.match(out, /--secondary-foreground: 240 6% 10%/);
});

test("a foreground with no matching base variable is never touched", () => {
  const css = ":root{--mystery-foreground: 10 10% 10%;}";
  const { changed } = enforcePairedForegroundContrast(css);
  assert.equal(changed, 0);
});
