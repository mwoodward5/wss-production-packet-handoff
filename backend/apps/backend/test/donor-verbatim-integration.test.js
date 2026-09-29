"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { heroWashCss, AA_NORMAL } = require("../lib/hero-wash");

const DONORS = path.join(__dirname, "..", "donors-clean");
const PRIMARY = {
  concrete: "concrete-elconstruction",
  fencing: "fencing-sterling",
  hvac: "hvac-premier",
  landscaping: "landscaping-evergreen",
  "med spa": "medspa-luma",
  plumbing: "plumbing-clean",
  roofing: "roofing-falcon-clean",
  salon: "salon-lacquer-studio",
  tattoo: "tattoo-aurelia",
};

test("all production primary donors are installed and routable", () => {
  const { resolveDonor } = require("../lib/mirror-engine/donor");
  for (const [vertical, expected] of Object.entries(PRIMARY)) {
    const out = resolveDonor({ industry: vertical });
    assert.equal(out.ok, true, `${vertical}: ${out.error || "not routable"}`);
    assert.equal(out.name, expected, `${vertical}: production donor drift`);
    assert.ok(fs.existsSync(path.join(DONORS, expected, "BOILERPLATE.json")));
  }
});

test("shared hero wash remains opt-in and every opted-in donor carries render evidence + AA", () => {
  let optedIn = 0;
  for (const donor of fs.readdirSync(DONORS)) {
    const file = path.join(DONORS, donor, "BOILERPLATE.json");
    if (!fs.existsSync(file)) continue;
    const man = JSON.parse(fs.readFileSync(file, "utf8"));
    const spec = man.hero_wash;
    if (!spec) continue; // verbatim designs may own their hero pixels outright
    optedIn++;
    assert.ok(spec.selector, `${donor}: hero_wash selector`);
    assert.match(String(spec.background || ""), /^#[0-9a-f]{6}$/i, `${donor}: measured background`);
    assert.match(String(spec.text_color || ""), /^#[0-9a-f]{6}$/i, `${donor}: measured text`);
    assert.ok(Array.isArray(spec.pages_verified), `${donor}: pages_verified array`);
    assert.ok(String(spec.verified || "").length > 20, `${donor}: render evidence`);
    if (!spec.pages_verified.length) {
      assert.match(String(spec.verified), /IMG|image[- ]?covered|covers the wash|full-bleed/i,
        `${donor}: empty page scope needs an image-covered explanation`);
    }
    const out = heroWashCss({
      imageHref: "/assets/hero-proof.jpg",
      accent: spec.background,
      scrimHex: spec.background,
      textHex: spec.text_color,
      selectors: [spec.selector],
    });
    assert.equal(out.applied, true, `${donor}: ${out.reason}`);
    assert.ok(out.worstCaseRatio >= AA_NORMAL, `${donor}: shared wash must clear AA`);
  }
  assert.ok(optedIn >= 1, "at least one donor must exercise the shared wash path");
});

test("verbatim source-owned heroes are not forced back under a shared overlay", () => {
  // landscaping-evergreen left this roster on 2026-08-19: it was re-measured
  // and EXPLICITLY opted back in — the exact escape hatch this assertion's own
  // message names. With no hero_wash selector the engine reported
  // donor_hero_unmeasured for BOTH heroWash and mobile_fold on every live
  // build (measured on the Keane Landscaping build), so the donor now declares
  // its hero (section#top) with the checked-and-explained empty pages_verified
  // (the design's own full-bleed IMG covers the wash pixels — the
  // hvac-brandforge shape). The opted-in loop above validates its selector,
  // measured hexes and AA; the render proof lives at
  // scratch-landscaping/prove-staged-landscaping.cjs.
  for (const donor of ["roofing-falcon-clean", "plumbing-premier"]) {
    const man = JSON.parse(fs.readFileSync(path.join(DONORS, donor, "BOILERPLATE.json"), "utf8"));
    assert.match(String(man.source || man.label || ""), /verbatim/i, `${donor}: expected verbatim source port`);
    assert.equal(man.hero_wash, undefined, `${donor}: verbatim hero should own its pixels unless re-measured and explicitly opted in`);
  }
});

test("verified concrete coordinates survive hydration as semantic GeoCoordinates", () => {
  const { loadDonor } = require("../lib/mirror-engine/donor");
  const { hydrate } = require("../lib/mirror-engine/hydrate");
  const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");
  const { files } = loadDonor(path.join(DONORS, "concrete-elconstruction"));
  const values = {};
  for (const token of ALLOWED_TOKENS) values[token] = "";
  Object.assign(values, {
    BUSINESS_NAME: "Granite Ridge Concrete", PHONE: "(208) 555-0161", PHONE_DIGITS: "2085550161",
    CITY: "Boise", ADDRESS_CITY: "Boise", STATE: "ID", REGION: "ID",
    HERO_HEADLINE: "Concrete in Boise, ID", LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com", PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
    GEO_LAT: "43.6150", GEO_LNG: "-116.2023",
  });
  const out = hydrate({ donorFiles: files, tokenValues: values });
  assert.equal(out.ok, true, out.error);
  const html = out.files["index.html"].toString("utf8");
  assert.match(html, /"@type"\s*:\s*"GeoCoordinates"/);
  assert.match(html, /"latitude"\s*:\s*"43\.6150"/);
  assert.match(html, /"longitude"\s*:\s*"-116\.2023"/);
});
