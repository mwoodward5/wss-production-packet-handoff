"use strict";

/**
 * test/brand-surface-recolor.test.js
 *
 * The owner's verdict on the RiverCity mirror (2026-08-05): "why are we not
 * changing all the colors ... so we don't have this dramatic blue and teal
 * look for their current website and our golden white look on our site".
 *
 * The accent remap already worked; the donor's SURFACES never moved. These
 * pin the second half: hue becomes theirs, lightness stays the donor's (it
 * carries the whole contrast design), chroma is budgeted by lightness so a
 * near-white surface cannot turn into tinted blue.
 */
const test = require("node:test");
const assert = require("node:assert");

const { applySurfaceToCss, applyBrandToCss, hexToOklch } = require("../lib/capture-brand");

const DONOR = ":root{--bone:oklch(96% .02 80);--slurry:oklch(12% .015 60);--line:oklch(85% .02 70);--grid-line:oklch(12% .015 60/.08)}";
const NAVY = "#0A1F3C";

function varsOf(css) {
  const out = {};
  for (const m of css.matchAll(/--([a-z-]+):oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/g)) {
    out[m[1]] = { l: Number(m[2]), c: Number(m[3]), h: Number(m[4]) };
  }
  return out;
}

test("every surface adopts the client's hue", () => {
  const { css, changed, hue } = applySurfaceToCss(DONOR, { primary: NAVY });
  assert.equal(changed, 4);
  const v = varsOf(css);
  for (const name of ["bone", "slurry", "line", "grid-line"]) {
    assert.ok(Math.abs(v[name].h - hue) < 0.2, `${name} kept the donor hue ${v[name].h}`);
  }
  assert.ok(hue > 240 && hue < 275, `navy should land in the blue arc, got ${hue}`);
});

test("lightness is never touched — it carries the donor's contrast design", () => {
  const before = varsOf(DONOR);
  const after = varsOf(applySurfaceToCss(DONOR, { primary: NAVY }).css);
  for (const name of Object.keys(before)) {
    assert.equal(after[name].l, before[name].l, `${name} lightness drifted`);
  }
});

test("chroma is budgeted by lightness: near-white stays near-white, darks go rich", () => {
  const v = varsOf(applySurfaceToCss(DONOR, { primary: NAVY }).css);
  assert.ok(v.bone.c <= 0.035, `96% surface must stay subtle, got ${v.bone.c}`);
  assert.ok(v.slurry.c >= 0.05, `12% surface should read as their colour, got ${v.slurry.c}`);
  assert.ok(v.slurry.c > v.bone.c, "the dark surface carries more chroma than the light one");
});

test("chroma never drops below the donor's own", () => {
  const grey = ":root{--panel:oklch(40% .09 200)}";
  const v = varsOf(applySurfaceToCss(grey, { primary: "#808080" }).css);
  assert.ok(v.panel.c >= 0.09, `donor chroma must not be flattened, got ${v.panel.c}`);
});

test("alpha suffixes survive the rewrite", () => {
  const { css } = applySurfaceToCss(DONOR, { primary: NAVY });
  assert.match(css, /--grid-line:oklch\([^)]*\/\s*\.08\)/, "the /.08 alpha was dropped");
});

test("only custom properties are rewritten — donor art is left alone", () => {
  const art = ".hero{background:oklch(50% .2 30)}:root{--x:oklch(50% .2 30)}";
  const { css, changed } = applySurfaceToCss(art, { primary: NAVY });
  assert.equal(changed, 1);
  assert.match(css, /\.hero\{background:oklch\(50% \.2 30\)\}/, "an inline art colour was rewritten");
});

test("a missing or malformed primary is a no-op, never a crash", () => {
  for (const bad of [undefined, "", "not-a-hex", "#12345"]) {
    const { css, changed } = applySurfaceToCss(DONOR, { primary: bad });
    assert.equal(changed, 0);
    assert.equal(css, DONOR);
  }
});

test("accent and surface remaps compose without fighting each other", () => {
  const donor = `:root{--accent:41 68% 52%;--accent-glow:41 68% 48%;--bone:oklch(96% .02 80);--slurry:oklch(12% .015 60)}`;
  const accented = applyBrandToCss(donor, { accent: "#E67E22" });
  const both = applySurfaceToCss(accented.css, { primary: NAVY });
  assert.match(both.css, /--accent:\s*28\s+\d+%/, "client accent hue lost");
  assert.ok(varsOf(both.css).slurry.h > 240, "client surface hue lost");
});

test("hexToOklch matches known values", () => {
  const navy = hexToOklch(NAVY);
  assert.ok(navy.l > 0.15 && navy.l < 0.30, `navy lightness ${navy.l}`);
  assert.ok(navy.h > 240 && navy.h < 275, `navy hue ${navy.h}`);
  assert.equal(hexToOklch("nope"), null);
});
