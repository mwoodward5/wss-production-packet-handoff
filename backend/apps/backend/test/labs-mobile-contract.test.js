"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const labsRoot = path.resolve(__dirname, "../../labs-site");
const html = fs.readFileSync(path.join(labsRoot, "index.html"), "utf8");
const css = fs.readFileSync(path.join(labsRoot, "site.css"), "utf8");
const script = fs.readFileSync(path.join(labsRoot, "site.js"), "utf8");

test("mobile comparison keeps at least 200px for the end card", () => {
  const source = script.match(/function beforeAfterBounds\([\s\S]*?\n  }/);
  assert.ok(source, "before/after bounds function must remain testable");
  const bounds = vm.runInNewContext(`(${source[0]})`);
  for (const width of [290, 360]) {
    const result = bounds(width, 200);
    assert.ok(width * (1 - result.max / 100) >= 199.9);
    assert.equal(result.min, 4);
  }
  assert.match(css, /--ba-endcard-min:200px/);
  assert.match(css, /width:calc\(100% - var\(--ba-x,50%\)\)/);
});

test("comparison slider exposes its real keyboard range", () => {
  assert.match(html, /aria-valuemin="4" aria-valuemax="96"/);
  assert.match(script, /setAttribute\("aria-valuemin", String\(bounds\.min\)\)/);
  assert.match(script, /setAttribute\("aria-valuemax", String\(Math\.round\(bounds\.max\)\)\)/);
  assert.match(script, /window\.addEventListener\("resize", normalizeX\)/);
});

test("320px end-card uses the compact vertical contract", () => {
  assert.match(css, /\.ba-endcard-inner\{top:10px;padding:0 10px;gap:4px/);
  assert.match(css, /\.ba-endcard \.ba-endcheck\{display:none\}/);
  assert.match(css, /\.ba-endcard small\{font-size:10\.5px;line-height:1\.25;max-width:176px\}/);
  assert.match(css, /\.ba-endcard \.ba-endcta\{margin-top:1px;padding:6px 10px;font-size:11px\}/);
});
