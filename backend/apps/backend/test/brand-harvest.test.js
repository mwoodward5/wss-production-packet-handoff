"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { harvestBrand } = require("../lib/mirror-engine/brand-harvest");

// REAL production page shape (Bill Smith Plumbing, Divi 4.27.4, 2026-08-20):
// fonts declared in a Google Fonts href AND inline <style> rules; palette on
// body/h1; generator meta. This is the case the font-capture stylesheet walk
// missed — the whole reason the brand-harvest fallback exists.
const DIVI_FIXTURE = `<!DOCTYPE html>
<html lang="en-US"><head>
<meta charset="UTF-8" />
<link href="https://fonts.googleapis.com/css?family=Open%20Sans%3A400%2C700%7CRubik%3A400%2C700%7CArimo%3A400&display=swap" media="print" onload="this.media='all'" rel="stylesheet">
<title>Plumbing, Heating &amp; Cooling | Bill Smith Plumbing | Denver, Colo</title>
<meta name="description" content="Need home plumbing, heating, &amp; cooling services? We got you covered by basing quotes on the unique needs of each home; not flat rates. Call." />
<meta content="Divi v.4.27.4" name="generator"/>
<style>
body{font-family:Open Sans,Arial,sans-serif;font-size:14px;color:#666;background-color:#fff;line-height:1.7em}
h1,h2,h3,h4,h5,h6{color:#333;padding-bottom:10px;line-height:1em;font-weight:500}
</style>
<style>.et_pb_text h1{font-family:'Rubik',Helvetica,Arial,Lucida,sans-serif}</style>
</head><body>
<img class="header-logo" src="https://billsmith-plumbing.com/wp-content/uploads/2025/07/BillSmithPlumbing_LogoHiRes500center.jpg" alt="Bill Smith Plumbing logo">
<a href="tel:+13037817856">(303) 781-7856</a>
</body></html>`;

test("harvestBrand reads a real Divi client: fonts, palette, marks, voice, platform", () => {
  const brand = harvestBrand(DIVI_FIXTURE, { logoAccent: "#fb0505" });
  assert.equal(brand.fonts.display, "Rubik", "display face comes from the h1 rule");
  assert.equal(brand.fonts.body, "Open Sans", "body face comes from the body rule");
  assert.ok(brand.fonts.googleHref.startsWith("https://fonts.googleapis.com/"));
  assert.deepEqual(brand.fonts.families, ["Open Sans", "Rubik", "Arimo"]);
  assert.equal(brand.palette.accent, "#fb0505", "trusted logo accent passes through");
  assert.equal(brand.palette.background, "#fff");
  assert.equal(brand.palette.text, "#666");
  assert.equal(brand.palette.heading, "#333");
  assert.equal(brand.palette.mode, "light");
  assert.ok(brand.marks.logo.includes("BillSmithPlumbing"));
  assert.ok(brand.voice.tagline.length > 10);
  assert.equal(brand.platform, "divi");
});

test("harvestBrand never throws on garbage and never guesses", () => {
  for (const bad of ["", null, "<html>", ">>>", JSON.stringify({ a: 1 })]) {
    const brand = harvestBrand(bad, {});
    assert.equal(brand.fonts.display, null);
    assert.equal(brand.fonts.families.length, 0);
    assert.equal(brand.palette.mode, "light", "missing background defaults light — 95% of the fleet is light");
  }
});

test("harvestBrand fonts survive the resolveBrandAssets href contract", () => {
  const brand = harvestBrand(DIVI_FIXTURE, {});
  // mirror-engine/brand-assets.js only carries hrefs pointing at fonts.googleapis.com
  assert.match(brand.fonts.googleHref, /^https:\/\/fonts\.googleapis\.com\//i);
});
