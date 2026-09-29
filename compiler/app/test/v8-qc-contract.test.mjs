import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { checkHeroLayers, V8_HERO_LAYERS } from "../../qc-audit/qc.mjs";
import { isPublishableQc } from "../lib/engine-adapter.mjs";

function heroHtml(layers = V8_HERO_LAYERS) {
  return `<section class="hero" data-renderer="05-build-v8">${layers.map((layer) => `<div data-hero-layer="${layer}"></div>`).join("")}</section>`;
}

test("primary QC accepts the explicit V8 six-layer hero contract", () => {
  const result = checkHeroLayers(new JSDOM(heroHtml()).window.document);
  assert.equal(result.pass, true, result.detail);
  assert.match(result.detail, /V8 six-layer contract/);
});

test("primary QC rejects obsolete or incomplete hero markup", () => {
  const obsolete = new JSDOM('<section class="hero"><div class="hero-stage"></div></section>').window.document;
  assert.equal(checkHeroLayers(obsolete).pass, false);

  const missing = new JSDOM(heroHtml(V8_HERO_LAYERS.slice(0, -1))).window.document;
  const result = checkHeroLayers(missing);
  assert.equal(result.pass, false);
  assert.match(result.detail, /lead-widget/);
});

test("publishable QC requires a real, non-deferred screenshot pass", () => {
  const base = {
    grade: "A",
    degraded: false,
    results: [
      { name: "hero-layer-count", pass: true },
      { name: "screenshots", pass: true },
    ],
  };
  assert.equal(isPublishableQc(base), true);
  assert.equal(isPublishableQc({ ...base, degraded: true }), false);
  assert.equal(isPublishableQc({ ...base, results: [...base.results.slice(0, 1), { name: "screenshots", pass: false, deferred: true }] }), false);
  assert.equal(isPublishableQc({ ...base, grade: "B" }), false);
  // Minimum-QC policy: a recorded advisory miss (pass: true, advisory_failed)
  // never blocks publication; a raw cosmetic failure that skipped the advisory
  // transform still does.
  assert.equal(isPublishableQc({ ...base, results: [...base.results, { name: "visual-cinematic-motion", pass: true, advisory_failed: true, detail: "advisory: hero has no cinematic motion" }] }), true);
  assert.equal(isPublishableQc({ ...base, results: [...base.results, { name: "visual-cinematic-motion", pass: false, detail: "hero has no cinematic motion" }] }), false);
});

test("conversion and batch hero visual gates stay blocking and receive the batch directory", () => {
  const source = readFileSync(new URL("../lib/engine-adapter.mjs", import.meta.url), "utf8");
  const floor = source.match(/const BLOCKING_QC_FLOOR = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  for (const name of [
    "visual-conversion-rail",
    "visual-hero-geometry",
    "visual-composition-fingerprint-batch",
    "visual-rendered-uniqueness-batch",
    "visual-hero-anatomy-batch",
    "visual-hero-architecture-batch",
    "visual-layout-gravity-batch",
    "visual-media-behavior-batch",
    "visual-logo-identity-batch",
    "visual-rendered-media-manifests",
    "visual-service-media-honesty",
    "visual-provenance-restraint",
    "visual-copy-mechanics",
    "visual-gallery-grid-integrity",
  ]) {
    assert.match(floor, new RegExp(`"${name}"`));
  }
  assert.match(source, /safeVisualChecks\(siteDir, batchDir\)/);
  assert.match(source, /runVisualFidelityChecks\(siteDir, batchDir \? \{ batchDir, filterCohort: true \} : \{\}\)/);
});

test("standalone primary QC loads the visual fidelity results it needs for Grade A", () => {
  const source = readFileSync(new URL("../../qc-audit/qc.mjs", import.meta.url), "utf8");
  assert.match(source, /await loadVisualFidelityResults\(siteDir, batchDir\)/);
  assert.match(source, /runVisualFidelityChecks\(siteDir, batchDir \? \{ batchDir, filterCohort: true \} : \{\}\)/);
  assert.match(source, /Array\.isArray\(options\.v7Results\)/);
  assert.match(source, /await loadV7Results\(siteDir\)/);
  assert.match(source, /const \{ runV7Checks \} = await import\("\.\/qc-v7-ext\.mjs"\)/);
  assert.match(source, /return runV7Checks\(siteDir\)/);
  for (const name of [
    "visual-fidelity",
    "visual-public-surface-scrub",
    "visual-no-fake-proof",
    "visual-composition-fingerprint-batch",
    "visual-rendered-uniqueness-batch",
  ]) {
    assert.match(source, new RegExp(`"${name}"`));
  }
  assert.match(source, /visualResult\?\.name === "visual-fidelity" \|\| GRADE_A_VISUAL_CHECKS\.includes\(visualResult\?\.name\)/);
});
