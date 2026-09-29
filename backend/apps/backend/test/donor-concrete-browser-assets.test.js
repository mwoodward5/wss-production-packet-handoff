"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { loadDonor } = require("../lib/mirror-engine/donor");
const { parseGate } = require("../lib/mirror-engine/hydrate");

const DIR = path.join(__dirname, "..", "donors-clean", "concrete-elconstruction");
const ASSETS = path.join(DIR, "assets");

// The guarantee this file protects is unchanged: the concrete donor's browser
// JS must survive Vercel's serverless packaging untouched. HOW it satisfies
// that changed on 2026-08-19: the fragile TanStack SSG dist (many ESM chunks,
// each needing an opaque .js.raw sidecar so Vercel would not CommonJS-transpile
// it — and still un-buildable at serve time, React #418) was replaced by a
// client-SPA recompile of the IDENTICAL source: ONE self-contained IIFE bundle
// with zero ESM syntax, which Vercel's transpiler has no reason to touch, so no
// .raw pinning is needed at all. The cross-library law lives in
// test/donor-esm-invariant.test.js: any donor chunk that DOES carry ESM syntax
// must be stored .js.raw. This file pins the concrete donor's side of it.
const ESM_SYNTAX = /(^|[;}])\s*(import|export)[{\s]|import\.meta|import\s*\(/;

test("concrete ships one self-contained browser bundle with no ESM to transpile", () => {
  const names = fs.readdirSync(ASSETS);
  const rawSidecars = names.filter((name) => name.endsWith(".js.raw"));
  assert.deepEqual(rawSidecars, [], "the SPA rebuild needs no raw pinning; a reappearing sidecar means the fragile multi-chunk shape is back");

  const bundles = names.filter((name) => /^index-.*\.js$/.test(name));
  assert.equal(bundles.length, 1, `exactly one browser bundle, got: ${bundles.join(", ")}`);

  const bundleSource = fs.readFileSync(path.join(ASSETS, bundles[0]), "utf8");
  assert.equal(ESM_SYNTAX.test(bundleSource), false,
    "the bundle must carry no ESM syntax — that is what makes it safe from Vercel's CommonJS transpilation without .raw storage");
  assert.doesNotMatch(bundleSource, /Object\.defineProperty\(exports\b/,
    "the bundle must never depend on CommonJS exports at serve time");

  // The shell must actually load that bundle (a renamed bundle nothing
  // references would pass the checks above while shipping a blank page).
  const shell = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  assert.ok(shell.includes(`assets/${bundles[0]}`), "index.html must reference the shipped bundle");
});

test("loadDonor serves the bundle bytes untouched and the parse gate stays clean", () => {
  const { files } = loadDonor(DIR);
  assert.equal(Object.keys(files).some((rel) => rel.endsWith(".js.raw")), false,
    "nothing may ship under a .raw URL");
  const bundleRel = Object.keys(files).find((rel) => /^assets\/index-.*\.js$/.test(rel));
  assert.ok(bundleRel, "loadDonor must expose the browser bundle");
  assert.deepEqual(
    files[bundleRel],
    fs.readFileSync(path.join(DIR, bundleRel)),
    "loadDonor must serve byte-identical bundle content",
  );
  const failures = parseGate(files).filter((failure) => failure.file.endsWith(".js"));
  assert.deepEqual(failures, [], `all shipped browser JS must parse: ${JSON.stringify(failures)}`);
});

test("concrete clips horizontal overflow at the document, body, and app root", () => {
  const cssName = fs.readdirSync(ASSETS).find((name) => /^index-.*\.css$/.test(name));
  assert.ok(cssName, "the donor stylesheet must ship");
  const css = fs.readFileSync(path.join(ASSETS, cssName), "utf8");

  for (const selector of ["html", "body", "#root"]) {
    const match = css.match(new RegExp(`${selector.replace("#", "\\#")}\\{([^}]*)\\}`));
    assert.ok(match, `${selector} must have a compiled rule`);
    assert.match(match[1], /max-width:100%/, `${selector} must stay inside the viewport`);
    assert.match(match[1], /overflow-x:hidden;overflow-x:clip/,
      `${selector} must clip motion/decorative overflow with a hidden fallback`);
  }
});
