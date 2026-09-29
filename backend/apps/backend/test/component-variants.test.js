"use strict";

// test/component-variants.test.js — TEMPLATE DIVERSIFICATION acceptance
// tests (owner directive, 2026-09-02 video report): two unrelated prospects
// must never produce the same-looking site, even from the same donor.
//
// Covers the five laws of lib/mirror-engine/component-variants.js:
//   1. the catalog — every section type carries 3-5 real visual variants
//   2. deterministic per-prospect selection (stable across rebuilds)
//   3. different prospects from the same donor select differently, and the
//      SIMILARITY BUDGET forces >=2 of {hero, section order, CTA, type scale}
//      to differ between consecutive same-donor builds
//   4. donor fingerprint pins (dark/photo-led -> full-bleed, light/text-minimal
//      -> minimal, hero video -> video-cinematic, typography cues -> scale)
//   5. donor section_order preserved on static-HTML donors (reviews before
//      services stays reviews before services)
// plus the engine wiring: the selection hashes, reports in checks.variants,
// stamps the scoping attributes, appends the variant CSS, and the registry
// rotates the second same-donor prospect.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
// Fixture clients must never stamp the real client registry (Gate 4C).
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-"));
if (!process.env.MIRROR_EVIDENCE_HMAC_KEY) process.env.MIRROR_EVIDENCE_HMAC_KEY = "test-evidence-key";

const cv = require("../lib/mirror-engine/component-variants");
const theme = require("../lib/mirror-engine/theme");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function request(slug, extra = {}) {
  return {
    slug,
    donor: "mirror-donor-sections",
    facts: {
      business_name: "Sullivan & Sons Roofing",
      industry: "roofing",
      city: "Tucson",
      state: "AZ",
      phone: "+15205550142",
    },
    ...extra,
  };
}

async function dryBuild(req, registry = createRegistry()) {
  const res = await mirror(req, { dryRun: true, registry });
  assert.equal(res.ok, true, JSON.stringify(res.body).slice(0, 400));
  return res.body;
}

const stampedOrder = (html) =>
  [...String(html).matchAll(/data-wss-section="([a-z-]+)"/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// 1. the catalog
// ---------------------------------------------------------------------------
test("catalog: every major section type has 3-5 visual variants with unique ids", () => {
  const expected = ["hero", "services", "about", "gallery", "testimonials", "contact", "footer"];
  assert.deepEqual(Object.keys(cv.SECTION_VARIANTS).sort(), expected.slice(1).sort());
  const allIds = new Set();
  for (const [type, variants] of Object.entries(cv.SECTION_VARIANTS)) {
    assert.ok(variants.length >= 3 && variants.length <= 5, `${type} has ${variants.length} variants`);
    for (const v of variants) {
      assert.ok(v.id && v.label && v.geometry, `${type}/${v.id} is not fully described`);
      assert.ok(!allIds.has(`${type}/${v.id}`), `duplicate variant id ${type}/${v.id}`);
      allIds.add(`${type}/${v.id}`);
    }
  }
  assert.ok(cv.HERO_VARIANTS.length >= 5, "hero needs at least 5 variants");
  assert.ok(cv.CTA_TREATMENTS.length >= 4, "at least 4 CTA treatments");
  for (const v of cv.HERO_VARIANTS) assert.ok(v.geometry && v.spacing && v.typography, `hero ${v.id} lacks a characteristic`);
});

test("catalog: every selectable variant ships real CSS", () => {
  for (const hero of cv.HERO_VARIANTS) {
    assert.ok(cv.heroVariantCss({ variant: hero.id }).length > 40, `hero ${hero.id} has no CSS`);
  }
  for (const cta of cv.CTA_TREATMENTS) {
    assert.ok(cv.ctaTreatmentCss({ treatment: cta.id, withColors: true }).length > 40, `cta ${cta.id} has no CSS`);
    // without theme tokens only shape remains — and never a colour declaration
    const bare = cv.ctaTreatmentCss({ treatment: cta.id, withColors: false });
    assert.ok(!/color:|background:/.test(bare.replace(/border-color/i, "X")), `cta ${cta.id} writes colours with withColors:false`);
  }
  for (const [type, variants] of Object.entries(cv.SECTION_VARIANTS)) {
    for (const v of variants) {
      assert.ok(cv.sectionVariantCss({ type, variant: v.id }).length > 10, `${type}/${v.id} has no CSS`);
    }
  }
});

test("catalog: three typography scales exist and only non-normal ones write CSS", () => {
  assert.deepEqual([...theme.TYPOGRAPHY_SCALE_IDS], ["condensed-tall", "normal", "wide-short"]);
  assert.equal(theme.typographyScaleCss("normal"), "", "normal is the donor's own scale, inert");
  const condensed = theme.typographyScaleCss("condensed-tall");
  const wide = theme.typographyScaleCss("wide-short");
  assert.match(condensed, /letter-spacing:-0\.025em/);
  assert.match(condensed, /line-height:0\.98/);
  assert.match(wide, /letter-spacing:0\.012em/);
  const h1Of = (css) => parseFloat(/--wss-h1-size:clamp\(([0-9.]+)rem/.exec(css)[1]);
  assert.ok(h1Of(condensed) > h1Of(wide), "condensed runs larger than wide");
  assert.notEqual(condensed, wide);
  assert.equal(theme.typographyScaleCss("bogus"), "", "unknown scale keeps the donor's");
});

// ---------------------------------------------------------------------------
// 2. deterministic per-prospect selection
// ---------------------------------------------------------------------------
test("selection is deterministic per prospect (seeded by prospect + donor)", () => {
  const a = cv.selectVariants({ prospectId: "wss-test-alpha", donor: "hvac-premier", cues: {} });
  for (let i = 0; i < 10; i += 1) {
    const b = cv.selectVariants({ prospectId: "wss-test-alpha", donor: "hvac-premier", cues: {} });
    assert.deepEqual(b, a);
  }
  // different donor -> different seed stream -> (almost surely) different pick
  const c = cv.selectVariants({ prospectId: "wss-test-alpha", donor: "plumbing-clean", cues: {} });
  assert.notEqual(c.seed, a.seed);
});

test("rebuilds of one prospect keep the same selection once published", () => {
  const first = cv.enforceSimilarityBudget({
    selection: cv.selectVariants({ prospectId: "wss-test-one", donor: "d", cues: {} }),
    priors: [],
    prospectId: "wss-test-one",
  });
  // A rebuild sees its OWN row in the registry: same prospect is excluded, so
  // the selection never moves under a rebuild.
  const rebuilt = cv.enforceSimilarityBudget({
    selection: cv.selectVariants({ prospectId: "wss-test-one", donor: "d", cues: {} }),
    priors: [{ prospectId: "wss-test-one", signature: cv.selectionSignature(first) }],
    prospectId: "wss-test-one",
  });
  assert.deepEqual(cv.selectionSignature(rebuilt), cv.selectionSignature(first));
});

// ---------------------------------------------------------------------------
// 3. divergence + the similarity budget
// ---------------------------------------------------------------------------
test("two different prospects from the same donor get different variant selections", () => {
  const picks = new Set();
  for (let i = 0; i < 30; i += 1) {
    const s = cv.selectVariants({ prospectId: `prospect-${i}`, donor: "same-donor", cues: {} });
    picks.add(JSON.stringify(cv.selectionSignature(s)));
  }
  assert.ok(picks.size >= 20, `30 prospects produced only ${picks.size} distinct selections`);
});

test("similarity budget: identical consecutive same-donor selections get a deterministic rotation", () => {
  const base = cv.selectVariants({ prospectId: "p2", donor: "d", cues: {} });
  const second = cv.enforceSimilarityBudget({
    selection: cv.selectVariants({ prospectId: "p2", donor: "d", cues: {} }),
    priors: [{ prospectId: "p1", signature: cv.selectionSignature(base) }],
    prospectId: "p2",
  });
  assert.equal(second.budget.enforced, true);
  assert.ok(second.budget.rotated >= 1, "the second build rotated");
  assert.ok(cv.axesDiffering(second, cv.selectionSignature(base)) >= 2,
    `only ${cv.axesDiffering(second, cv.selectionSignature(base))} axes differ after rotation`);
  // deterministic: the same prior state produces the same rotation
  const again = cv.enforceSimilarityBudget({
    selection: cv.selectVariants({ prospectId: "p2", donor: "d", cues: {} }),
    priors: [{ prospectId: "p1", signature: cv.selectionSignature(base) }],
    prospectId: "p2",
  });
  assert.deepEqual(again, second);
});

test("similarity budget: consecutive same-donor builds always clear the 2-axis law", () => {
  const published = [];
  for (let i = 0; i < 50; i += 1) {
    const selection = cv.enforceSimilarityBudget({
      selection: cv.selectVariants({ prospectId: `prospect-${i}`, donor: "shared-donor", cues: {} }),
      priors: published.slice(-8).map((p) => ({ prospectId: p.prospectId, signature: cv.selectionSignature(p) })),
      prospectId: `prospect-${i}`,
    });
    assert.equal(selection.budget.enforced, true, JSON.stringify(selection.budget));
    const previous = published[published.length - 1];
    if (previous) {
      const differing = cv.axesDiffering(selection, cv.selectionSignature(previous));
      assert.ok(differing >= 2, `consecutive builds ${previous.prospectId} -> prospect-${i} differ on only ${differing} axes`);
    }
    published.push({ prospectId: `prospect-${i}`, ...selection });
  }
});

test("similarity budget: fingerprint pins hold under rotation; free axes clear the budget", () => {
  const cues = cv.deriveCues({ fingerprint: { mode: "dark", photo_led: true } });
  const first = cv.enforceSimilarityBudget({
    selection: cv.selectVariants({ prospectId: "pa", donor: "dd", cues }),
    priors: [],
    prospectId: "pa",
  });
  const second = cv.enforceSimilarityBudget({
    selection: cv.selectVariants({ prospectId: "pb", donor: "dd", cues }),
    priors: [{ prospectId: "pa", signature: cv.selectionSignature(first) }],
    prospectId: "pb",
  });
  // The dark/photo-led pin is a measured fact of the donor: it holds.
  assert.equal(second.hero, "full-bleed-overlay");
  assert.equal(second.pinned.hero, "full-bleed-overlay");
  assert.equal(second.budget.enforced, true);
  assert.ok(cv.axesDiffering(second, cv.selectionSignature(first)) >= 2);
});

// ---------------------------------------------------------------------------
// 4. donor fingerprint pins
// ---------------------------------------------------------------------------
test("fingerprint: dark/photo-led donor pins the full-bleed hero variant", () => {
  const cues = cv.deriveCues({ fingerprint: cv.normalizeFingerprint({ mode: "dark", photo_led: true }) });
  assert.equal(cues.photo_led, true);
  assert.equal(cv.selectVariants({ prospectId: "x", donor: "d", cues }).hero, "full-bleed-overlay");
});

test("fingerprint: light/text-minimal donor pins the minimal hero variant", () => {
  const cues = cv.deriveCues({ fingerprint: cv.normalizeFingerprint({ mode: "light", photo_led: false }) });
  assert.equal(cues.photo_led, false);
  assert.equal(cv.selectVariants({ prospectId: "x", donor: "d", cues }).hero, "minimal-texture");
});

test("fingerprint: a prospect hero video pins the video hero variant", () => {
  const cues = cv.deriveCues({ fingerprint: null, heroVideo: true });
  assert.equal(cv.selectVariants({ prospectId: "x", donor: "d", cues }).hero, "video-cinematic");
});

test("fingerprint: typography cues pin the heading scale", () => {
  assert.equal(cv.selectVariants({ prospectId: "x", donor: "d", cues: { typography: "condensed" } }).type_scale, "condensed-tall");
  assert.equal(cv.selectVariants({ prospectId: "x", donor: "d", cues: { typography: "wide" } }).type_scale, "wide-short");
  assert.equal(cv.selectVariants({ prospectId: "x", donor: "d", cues: { typography: "normal" } }).type_scale, "normal");
});

test("fingerprint: unknown or malformed values are ignored, never thrown", () => {
  assert.equal(cv.normalizeFingerprint(null), null);
  assert.equal(cv.normalizeFingerprint("dark"), null);
  assert.equal(cv.normalizeFingerprint({ mode: "sepia", typography: "spooky", section_order: "reviews-first" }), null);
  const partial = cv.normalizeFingerprint({ mode: "dark", photo_led: "yes??? no" });
  assert.equal(partial.mode, "dark");
  assert.ok(!("photo_led" in partial));
  // deriveCues never throws on sparse input
  assert.deepEqual(cv.deriveCues({}), { mode: null, photo_led: null, typography: null, section_order: null, hero_video: false });
});

test("fingerprint: request evidence fills the gaps when no fingerprint was supplied", () => {
  // dark client surface -> photo-led reading
  assert.equal(cv.deriveCues({ clientSurface: { mode: "dark" } }).photo_led, true);
  // light surface with no photography -> text-minimal
  assert.equal(cv.deriveCues({ clientSurface: { mode: "light" }, photoCount: 0 }).photo_led, false);
  // a photo-heavy brand reads photo-led regardless of surface
  assert.equal(cv.deriveCues({ clientSurface: { mode: "light" }, photoCount: 5 }).photo_led, true);
  // a condensed brand font carries the type cue
  assert.equal(cv.deriveCues({ brandFont: "Oswald Condensed" }).typography, "condensed");
  assert.equal(cv.deriveCues({ brandFont: "Extended Gothic" }).typography, "wide");
});

// ---------------------------------------------------------------------------
// 5. donor section order
// ---------------------------------------------------------------------------
const FIXTURE_HTML = fs.readFileSync(
  path.join(__dirname, "fixtures", "mirror-donor-sections", "index.html"),
  "utf8",
);

test("section order: the donor's meaningful order is preserved (reviews before services)", () => {
  const out = cv.applySectionOrder(FIXTURE_HTML, ["reviews", "services", "gallery", "contact"]);
  assert.equal(out.applied, true);
  assert.deepEqual(stampedOrder(out.html), ["testimonials", "services", "gallery", "contact"]);
  assert.ok(out.html.indexOf('data-wss-section="testimonials"') < out.html.indexOf('data-wss-section="services"'),
    "reviews (canonical testimonials) must render before services");
  // byte conservation: every section still appears exactly once, and the SET
  // of section blocks is exactly the donor's (order aside, content intact).
  assert.equal((out.html.match(/<section\b/g) || []).length, (FIXTURE_HTML.match(/<section\b/g) || []).length);
  const strip = (html) => html.replace(/\s+data-wss-section="[^"]*"/g, "");
  const sortedBlocks = (html) => [...html.matchAll(/<section\b[\s\S]*?<\/section>/g)].map((m) => m[0]).sort();
  assert.deepEqual(sortedBlocks(strip(out.html)), sortedBlocks(FIXTURE_HTML), "no section content was created, altered or lost");
});

test("section order: unmapped sections never move, unknown names are ignored", () => {
  const out = cv.applySectionOrder(FIXTURE_HTML, ["gallery", "contact", "nonexistent-section"]);
  assert.equal(out.applied, true);
  // Only gallery + contact were mapped, so only they carry the stamp; the
  // unmapped services and reviews keep the donor's sequence AHEAD of them.
  assert.deepEqual(stampedOrder(out.html), ["gallery", "contact"]);
  const headings = [...out.html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ["What we do", "Reviews", "Our work", "Contact"],
    "unmapped sections keep their donor positions");
});

test("section order: a page without plain-HTML sections reports the honest reason", () => {
  const out = cv.applySectionOrder("<html><body><div id=\"root\"></div></body></html>", ["reviews", "services"]);
  assert.equal(out.applied, false);
  assert.equal(out.reason, "no_plain_html_sections");
});

test("section order: synonyms map donor vocabulary to canonical hooks", () => {
  const out = cv.applySectionOrder(FIXTURE_HTML, ["testimonials", "contact", "services", "gallery"]);
  assert.equal(out.applied, true);
  assert.deepEqual(stampedOrder(out.html), ["testimonials", "contact", "services", "gallery"]);
});

// ---------------------------------------------------------------------------
// engine wiring
// ---------------------------------------------------------------------------
test("engine: the selection reports in checks.variants and stamps the built pages", async () => {
  const manifest = await dryBuild(request("wss-test-sullivan-stamp-tucson"));
  const variants = manifest.checks.variants;
  assert.ok(variants, "checks.variants exists");
  assert.equal(variants.status, "passed");
  assert.ok(cv.HERO_VARIANTS.some((v) => v.id === variants.hero), "hero is a catalog id");
  assert.ok(cv.CTA_TREATMENTS.some((c) => c.id === variants.cta), "cta is a catalog id");
  assert.ok(theme.TYPOGRAPHY_SCALE_IDS.includes(variants.type_scale), "type scale is a catalog id");
  assert.equal(variants.budget.enforced, true);
});

test("engine: the selection participates in the build hash (identical rebuild replays the same hash)", async () => {
  const a = await dryBuild(request("wss-test-sullivan-hash-tucson"));
  const b = await dryBuild(request("wss-test-sullivan-hash-tucson"));
  assert.equal(a.build_hash, b.build_hash);
});

test("engine: two different prospects from the same donor build with >=2 differing axes", async () => {
  const registry = createRegistry();
  const first = await dryBuild(request("wss-test-sullivan-sib-tucson"), registry);
  // Register the first build's selection the way a published build does.
  registry.variantSet("mirror-donor-sections", {
    prospectId: "wss-test-sullivan-sib-tucson",
    signature: cv.selectionSignature(first.checks.variants),
  });
  const second = await dryBuild(request("wss-test-cactus-sib-tucson", {
    facts: { business_name: "Cactus Valley Roofing", industry: "roofing", city: "Tucson", state: "AZ", phone: "+15205550188" },
  }), registry);
  const differing = cv.axesDiffering(second.checks.variants, first.checks.variants);
  assert.ok(differing >= 2,
    `two same-donor siblings differ on only ${differing} axes: ${JSON.stringify(cv.selectionSignature(first.checks.variants))} vs ${JSON.stringify(cv.selectionSignature(second.checks.variants))}`);
});

test("engine: registry variant rows rotate the second identical same-donor selection", async () => {
  const registry = createRegistry();
  const first = await dryBuild(request("wss-test-sullivan-rot-tucson"), registry);
  const base = cv.selectionSignature(first.checks.variants);
  registry.variantSet("mirror-donor-sections", { prospectId: "wss-test-sullivan-rot-tucson", signature: base });
  // A second prospect whose seeded selection would COLLIDE gets rotated by
  // the engine: find a prospect id whose base selection is identical, then
  // prove the build's shipped selection differs on >=2 axes.
  let collidingSlug = null;
  for (let i = 0; i < 400 && !collidingSlug; i += 1) {
    const slug = `wss-test-ridge-rot${i}-tucson`;
    const seeded = cv.selectVariants({ prospectId: slug, donor: "mirror-donor-sections", cues: {} });
    if (JSON.stringify(cv.selectionSignature(seeded)) === JSON.stringify(base)) collidingSlug = slug;
  }
  if (collidingSlug) {
    const rotated = await dryBuild(request(collidingSlug, {
      facts: { business_name: "Rolling Ridge Roofing", industry: "roofing", city: "Tucson", state: "AZ", phone: "+15205550199" },
    }), registry);
    assert.ok(cv.axesDiffering(rotated.checks.variants, base) >= 2, "the colliding sibling was rotated");
    assert.ok(rotated.checks.variants.budget.rotated >= 1);
  } else {
    // No collision exists in this window: prove the rotation directly through
    // the same registry seam the engine reads.
    const second = cv.enforceSimilarityBudget({
      selection: cv.selectVariants({ prospectId: "any", donor: "mirror-donor-sections", cues: {} }),
      priors: registry.variantRows("mirror-donor-sections"),
      prospectId: "any",
    });
    assert.ok(second.budget.rotated >= 1 && cv.axesDiffering(second, base) >= 2);
  }
});

test("engine: donor section_order reorders the built index.html and the variant CSS ships", async () => {
  const manifest = await dryBuild(request("wss-test-sullivan-order-tucson", {
    donor_fingerprint: {
      mode: "light",
      photo_led: false,
      section_order: ["reviews", "services", "gallery", "contact"],
    },
  }));
  const variants = manifest.checks.variants;
  assert.deepEqual(variants.section_order, ["testimonials", "services", "gallery", "contact"]);
  assert.equal(variants.dom.section_order.applied, true);
  assert.equal(variants.hero, "minimal-texture", "light/text-minimal fingerprint pins the minimal hero");
  // The fingerprint survives schema validation end to end.
  assert.equal(checkMirrorRequest(request("wss-test-sullivan-order-tucson", {
    donor_fingerprint: { mode: "light", photo_led: false, section_order: ["reviews", "services"] },
  })).ok, true);
});

test("engine: a donor_fingerprint with unknown fields is rejected by the closed schema", () => {
  const res = checkMirrorRequest(request("wss-test-sullivan-bad-tucson", {
    donor_fingerprint: { vibes: "excellent" },
  }));
  assert.equal(res.ok, false);
});

// ---------------------------------------------------------------------------
// registry seam
// ---------------------------------------------------------------------------
test("registry: variant rows are capped, de-duplicated per prospect and readable", () => {
  const registry = createRegistry();
  for (let i = 0; i < 12; i += 1) {
    registry.variantSet("donor-x", { prospectId: `p${i}`, signature: { hero: `h${i}`, cta: "solid-pill", type_scale: "normal", section_order: null } });
  }
  assert.equal(registry.variantRows("donor-x").length, 8, "capped at 8");
  // the same prospect re-registers in place, never duplicated
  registry.variantSet("donor-x", { prospectId: "p11", signature: { hero: "h11b", cta: "solid-pill", type_scale: "normal", section_order: null } });
  const rows = registry.variantRows("donor-x");
  assert.equal(rows.filter((r) => r.prospectId === "p11").length, 1);
  assert.equal(rows[rows.length - 1].signature.hero, "h11b");
  // junk is ignored, never stored
  registry.variantSet("donor-x", null);
  registry.variantSet("", { prospectId: "p", signature: {} });
  assert.equal(registry.variantRows("donor-x").length, 8);
  assert.deepEqual(registry.variantRows("never-seen"), []);
});
