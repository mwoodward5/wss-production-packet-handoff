"use strict";

// test/logo-palette.test.js — the logo outranks the scrape.
//
// The RiverCity incident, pinned: their logo.svg declares #094463 + #1B7D9F
// (blue/teal) and NOTHING orange, yet the harvester shipped accent #E67E22
// from a page CTA and four consecutive emails went out orange. These tests
// pin that the SVG palette wins and that neutrals never become a "brand".

const test = require("node:test");
const assert = require("node:assert");
const { paletteFromLogoSvg, paletteFromLogo } = require("../lib/logo-palette");

const RIVERCITY = `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#094463"/><path fill="#1B7D9F"/><path fill="#FFFFFF"/></svg>`;

test("RiverCity: teal accent, deep-blue primary, no orange anywhere", () => {
  const p = paletteFromLogoSvg(RIVERCITY);
  assert.equal(p.accent, "#1B7D9F");
  assert.equal(p.primary, "#094463");
  assert.ok(!p.colors.includes("#E67E22"));
});

test("neutral-only logo yields null, never a grey brand", () => {
  assert.equal(paletteFromLogoSvg(`<svg><path fill="#111111"/><path fill="#fff"/></svg>`), null);
});

test("shorthand hex, rgb() and named colours are all read", () => {
  const p = paletteFromLogoSvg(`<svg><path fill="#0aF"/><rect style="fill:rgb(200,30,30)"/><circle fill="teal"/></svg>`);
  assert.ok(p.colors.includes("#00AAFF"));
  assert.ok(p.colors.includes("#C81E1E"));
  assert.ok(p.colors.includes("#008080"));
});

test("raster logos are left to pixel measurement (returns null)", () => {
  assert.equal(paletteFromLogo({ bytes: Buffer.from([0x89, 0x50]), contentType: "image/png", url: "a.png" }), null);
});

test("svg detected by content type or url extension", () => {
  assert.ok(paletteFromLogo({ bytes: RIVERCITY, contentType: "image/svg+xml", url: "" }));
  assert.ok(paletteFromLogo({ bytes: RIVERCITY, contentType: "", url: "https://x.com/logo.svg?v=2" }));
});
