"use strict";

// test/media-provenance.test.js — MEDIA PROVENANCE, SEMANTIC CLASSIFICATION,
// AND THE CROSS-PROSPECT CONTAMINATION GUARD.
//
// Owner's video research report (2026-09-02), the three findings pinned here:
//
//   1. "The repeated construction hero visual across different prospects is
//      a red flag. Asset selection must be keyed by prospect/release
//      identity and verified before render."        -> the guard + hero gate
//   2. "Jeff Sullivan's WSS gallery visibly includes interior-room imagery
//      alongside concrete/outdoor work. Introduce semantic media
//      classification and section eligibility rules."
//                                                     -> the classifier + the
//                                                        wrong-trade rejection
//   3. "Never count an asset as 'placed' merely because a URL exists."
//                                                     -> content-hash licence
//
// Unit half: the classifier rules, the placement verifier, the pool guard and
// the hero gate, directly. Engine half: real mirror() builds on the concrete
// donor (the Jeff Sullivan vertical) with the no-network harness from
// test/owned-photo-placement.test.js, proving the guard runs inside the
// placement path and every refusal is named per asset.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-media-provenance-"));

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { siteEditLog } = require("../lib/site-edit-log");
const mediaProvenance = require("../lib/mirror-engine/media-provenance");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// Unit: the semantic classifier
// ---------------------------------------------------------------------------

test("trade keywords classify URL, alt and context into the coarse classes", () => {
  const concrete = mediaProvenance.classifyMediaAsset({ url: "https://sullivan.example/photos/stamped-driveway-patio.jpg" });
  assert.equal(concrete.media_class, "concrete");
  assert.ok(concrete.section_eligibility.includes("hero"));
  assert.ok(concrete.section_eligibility.includes("gallery"));

  const interior = mediaProvenance.classifyMediaAsset({
    url: "https://sullivan.example/uploads/img_2741.jpg",
    alt: "finished kitchen remodel with new countertops",
  });
  assert.equal(interior.media_class, "interior_remodel");

  const contextOnly = mediaProvenance.classifyMediaAsset({
    url: "https://sullivan.example/uploads/img_2742.jpg",
    context: "our latest bathroom renovation gallery",
  });
  assert.equal(contextOnly.media_class, "interior_remodel");

  const people = mediaProvenance.classifyMediaAsset({ url: "https://sullivan.example/about-our-crew.jpg" });
  assert.equal(people.media_class, "people_team");

  const vehicle = mediaProvenance.classifyMediaAsset({ url: "https://sullivan.example/fleet-truck-2.jpg" });
  assert.equal(vehicle.media_class, "vehicle");

  const logo = mediaProvenance.classifyMediaAsset({ url: "https://sullivan.example/brandmark.png" });
  assert.equal(logo.media_class, "logo");
});

test("no classification possible degrades to generic_stock: owned stays gallery/about-eligible, never hero; stock is background-only", () => {
  const owned = mediaProvenance.classifyMediaAsset({ url: "https://maps.googleapis.com/AF1QipMtOpaqueToken123.jpg" });
  assert.equal(owned.media_class, "generic_stock");
  assert.equal(owned.ownership_tier, "owned_verified");
  assert.ok(!owned.section_eligibility.includes("hero"), "an unclassifiable picture never washes the hero");
  assert.ok(owned.section_eligibility.includes("gallery"));

  const flagged = mediaProvenance.classifyMediaAsset({
    url: "https://sullivan.example/uploads/photo.jpg",
    stockSuspect: true,
  });
  assert.equal(flagged.media_class, "generic_stock");
  assert.equal(flagged.ownership_tier, "stock_suspect");
  assert.deepEqual(flagged.section_eligibility, ["background"]);

  const libraryPath = mediaProvenance.classifyMediaAsset({ url: "https://cdn.example/istockphoto-123-driveway.jpg" });
  assert.equal(libraryPath.ownership_tier, "stock_suspect", "a stock-library path is stock even when the filename says driveway");
  assert.deepEqual(libraryPath.section_eligibility, ["background"]);
});

test("outdoor kitchens are hardscape, not interior remodel", () => {
  const cls = mediaProvenance.classifyMediaAsset({ url: "https://sullivan.example/projects/outdoor-kitchen-patio.jpg" });
  assert.equal(cls.media_class, "concrete");
});

test("THE JEFF SULLIVAN RULE: interior_remodel on a concrete vertical is trade-conflicted and rejected from the gallery", () => {
  const cls = mediaProvenance.classifyMediaAsset({
    url: "https://sullivan.example/uploads/interior-kitchen-after.jpg",
    vertical: "concrete",
  });
  assert.equal(cls.media_class, "interior_remodel");
  assert.equal(cls.trade_conflict, true);
  assert.deepEqual(cls.section_eligibility, [], "wrong-trade media is eligible for no proof section");

  const mirrored = mediaProvenance.classifyMediaAsset({
    url: "https://kitchens.example/projects/stamped-driveway-patio.jpg",
    vertical: "kitchen remodeling",
  });
  assert.equal(mirrored.trade_conflict, true, "the symmetric lie: a driveway cannot prove a kitchen remodeler either");

  const legal = mediaProvenance.classifyMediaAsset({
    url: "https://kitchens.example/uploads/interior-kitchen-after.jpg",
    vertical: "kitchen remodeling",
  });
  assert.equal(legal.trade_conflict, false, "a remodeler's own interior photos are exactly their trade");
  assert.ok(legal.section_eligibility.includes("gallery"));
});

// ---------------------------------------------------------------------------
// Unit: provenance binding + the placement verifier
// ---------------------------------------------------------------------------

const BUILD_ID = mediaProvenance.buildProspectId({
  slug: "wss-test-sullivan-concrete",
  facts: { business_name: "Sullivan Concrete" },
});

function boundAsset(overrides = {}) {
  return {
    url: "https://sullivan.example/photos/stamped-driveway.jpg",
    sha256: sha("photo-driveway"),
    provenance: mediaProvenance.bindProvenance(
      { url: "https://sullivan.example/photos/stamped-driveway.jpg", sha256: sha("photo-driveway") },
      { prospectId: BUILD_ID, sourceUrl: "https://sullivan.example/photos/stamped-driveway.jpg", vertical: "concrete" },
    ),
    ...overrides,
  };
}

test("an asset with no provenance is dropped, never placed", () => {
  const verdict = mediaProvenance.verifyAssetPlacement(
    { url: "https://sullivan.example/photos/x.jpg", sha256: sha("x") },
    { prospectId: BUILD_ID, section: "gallery" },
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "asset_missing_prospect_binding");
});

test("an asset whose content hash was never verified is dropped — a URL is not placement", () => {
  const verdict = mediaProvenance.verifyAssetPlacement(
    boundAsset({ sha256: undefined, provenance: mediaProvenance.bindProvenance(
      { url: "https://sullivan.example/photos/x.jpg" },
      { prospectId: BUILD_ID, contentHash: "", vertical: "concrete" },
    ) }),
    { prospectId: BUILD_ID, section: "gallery" },
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "asset_content_hash_unverified");
});

test("an asset keyed to another prospect is refused as cross-prospect contamination", () => {
  const foreign = boundAsset({ provenance: mediaProvenance.bindProvenance(
    { url: "https://other-roofer.example/hero.jpg", sha256: sha("foreign") },
    { prospectId: "wss-someone-else|Someone Else Roofing", vertical: "concrete" },
  ) });
  const verdict = mediaProvenance.verifyAssetPlacement(foreign, { prospectId: BUILD_ID, section: "hero" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "cross_prospect_contamination");
  assert.equal(verdict.detail.asset_prospect, "wss-someone-else|Someone Else Roofing");
});

test("an explicit WSS brand asset (the flag) is the one cross-prospect exemption", () => {
  const flag = boundAsset({ provenance: mediaProvenance.bindProvenance(
    { url: "https://cdn.wss.example/wss-flag.svg", wss_brand_asset: true, sha256: sha("flag") },
    { prospectId: "wss-brand-assets|Woodward flag", wssBrandAsset: true },
  ) });
  const verdict = mediaProvenance.verifyAssetPlacement(flag, { prospectId: BUILD_ID, section: "about" });
  assert.equal(verdict.ok, true);
});

test("guardAssetPool drops carried foreign bindings and binds everything else to the build", () => {
  const pool = [
    { url: "https://sullivan.example/a-driveway.jpg", ok: true, sha256: sha("a") },
    { url: "https://sullivan.example/b-patio.jpg", ok: true, sha256: sha("b") },
  ];
  const bank = [
    { url: "https://sullivan.example/a-driveway.jpg", prospect_id: "wss-donor-a|Donor A Concrete" },
    { url: "https://sullivan.example/b-patio.jpg", prospect_id: BUILD_ID },
  ];
  const guarded = mediaProvenance.guardAssetPool(pool, { prospectId: BUILD_ID, vertical: "concrete", bank });
  assert.equal(guarded.allowed.length, 1);
  assert.equal(guarded.allowed[0].url, "https://sullivan.example/b-patio.jpg");
  assert.equal(guarded.allowed[0].provenance.prospect_id, BUILD_ID);
  assert.equal(guarded.dropped.length, 1);
  assert.equal(guarded.dropped[0].reason, "cross_prospect_contamination");
  assert.equal(guarded.dropped[0].prospect_id, "wss-donor-a|Donor A Concrete");
});

test("selectHeroAsset prefers the donor-owned flagged hero over generic stock, and refuses everything contaminated", () => {
  const stockSuspect = {
    url: "https://sullivan.example/stock-team-photo.jpg",
    provenance: mediaProvenance.bindProvenance(
      { url: "https://sullivan.example/stock-team-photo.jpg", sha256: sha("stock") },
      { prospectId: BUILD_ID, vertical: "concrete", stockSuspect: true },
    ),
  };
  const genericOwned = {
    url: "https://sullivan.example/IMG_001.jpg",
    provenance: mediaProvenance.bindProvenance(
      { url: "https://sullivan.example/IMG_001.jpg", sha256: sha("generic") },
      { prospectId: BUILD_ID, vertical: "concrete" },
    ),
  };
  const flaggedCurrentHero = {
    url: "https://sullivan.example/hero-stamped-driveway.jpg",
    provenance: mediaProvenance.bindProvenance(
      { url: "https://sullivan.example/hero-stamped-driveway.jpg", sha256: sha("current-hero") },
      { prospectId: BUILD_ID, vertical: "concrete", currentHero: true },
    ),
  };

  const pick = mediaProvenance.selectHeroAsset([stockSuspect, genericOwned, flaggedCurrentHero], { prospectId: BUILD_ID });
  assert.equal(pick.asset, flaggedCurrentHero, "their own flagged current hero image wins");
  assert.ok(pick.rejected.some((r) => r.reason === "stock_media_not_proof"), "the stock picture is named and refused");

  const none = mediaProvenance.selectHeroAsset([stockSuspect], { prospectId: BUILD_ID });
  assert.equal(none.asset, null);
  assert.equal(none.fallback, "neutral_donor_surface", "with nothing verified the donor's neutral surface stands in");

  const contaminated = {
    url: "https://other.example/hero.jpg",
    provenance: mediaProvenance.bindProvenance(
      { url: "https://other.example/hero.jpg", sha256: sha("foreign-hero") },
      { prospectId: "wss-other|Other Co", vertical: "concrete", currentHero: true },
    ),
  };
  const refused = mediaProvenance.selectHeroAsset([contaminated], { prospectId: BUILD_ID });
  assert.equal(refused.asset, null, "never silently fall back to another prospect's hero image");
  assert.ok(refused.rejected.some((r) => r.reason === "cross_prospect_contamination"));
});

// ---------------------------------------------------------------------------
// Engine: real mirror() builds on the concrete donor, guard inside the loop
// ---------------------------------------------------------------------------

// resolveBrandAssets stand-in, network-free (the contract from
// test/owned-photo-placement.test.js): housed rows carry bytes + sha256.
function fakeResolve({ photos = [] } = {}) {
  return async () => ({
    ok: true,
    logo: null,
    accent: null,
    primary: null,
    hashes: {},
    mediaMode: "housed",
    photos,
    heroVideo: null,
  });
}

function makeHarness({ resolve }) {
  let captured = null;
  const deps = {
    slugPolicy,
    siteEditLog: (args) => siteEditLog({ ...args, select: async () => ({ ok: true, mode: "live_select", data: [] }) }),
    resolveBrandAssets: resolve,
    readArchivedFile: async () => null,
    withSpaRewrite: (files) => { captured = files; return files; },
    ensureProject: async () => "prj_stub",
    uploadFiles: async (files) => ({ manifest: Object.keys(files).map((f) => ({ file: f })), uploaded: 1, deduped: 0 }),
    createDeployment: async () => ({ id: "dpl_stub", url: "stub.vercel.app", readyState: "QUEUED" }),
    waitReady: async () => ({ readyState: "READY" }),
    byteDiff: async () => ({ clean: true, checked: 9, mismatches: [] }),
    deepLinkCheck: async () => ({ clean: true, failures: [] }),
    attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
    aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
    renderCheck: async () => ({ status: "passed", problems: [] }),
    renderAudit: async () => ({ status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] }),
  };
  return { deps, files: () => captured };
}

function sullivanRequest({ slug, photos, photoBank } = {}) {
  return {
    slug,
    donor: "concrete-elconstruction",
    facts: {
      business_name: "Jeff Sullivan Concrete",
      industry: "concrete",
      city: "Spokane",
      state: "WA",
      phone: "(509) 555-0172",
    },
    hero: { headline: "Stamped concrete driveways in Spokane" },
    brand: {
      photos,
      ...(photoBank ? { photo_bank: { photos: photoBank } } : {}),
    },
  };
}

test("JEFF SULLIVAN CASE (engine): the interior-room photo is rejected from the concrete gallery, the driveway is not", async () => {
  const photos = [
    {
      url: "https://sullivanconcrete.example/projects/stamped-driveway-patio.jpg",
      ok: true,
      sha256: sha("sullivan-driveway"),
      ext: "jpg",
      mime: "image/jpeg",
      bytes: Buffer.from("SULLIVAN STAMPED DRIVEWAY BYTES", "utf8"),
    },
    {
      url: "https://sullivanconcrete.example/uploads/interior-kitchen-remodel.jpg",
      ok: true,
      sha256: sha("sullivan-kitchen"),
      ext: "jpg",
      mime: "image/jpeg",
      bytes: Buffer.from("SULLIVAN KITCHEN INTERIOR BYTES", "utf8"),
    },
  ];
  const h = makeHarness({ resolve: fakeResolve({ photos }) });
  const res = await mirror(sullivanRequest({
    slug: "wss-test-mp-sullivan-concrete",
    photos: photos.map((p) => p.url),
  }), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);

  const accounting = res.body.checks.brand.photos;
  assert.equal(accounting.usable, 2);
  assert.equal(accounting.provenance_verified, 1, "only the driveway survives the provenance guard");
  assert.equal(accounting.placed, 1, "the concrete photo places; the interior photo does not");

  const refusal = (accounting.photos_unplaced || []).find((r) => r.url.endsWith("interior-kitchen-remodel.jpg"));
  assert.ok(refusal, "the interior photo carries its per-asset refusal");
  assert.equal(refusal.reason, "wrong_trade_media:interior_remodel");

  const report = res.body.checks.brand.media_provenance;
  assert.equal(report.prospect_id, "wss-test-mp-sullivan-concrete|jeff sullivan concrete");
  assert.equal(report.vertical, "concrete");
  assert.equal(report.classes.interior_remodel, 1);
  assert.equal(report.classes.concrete, 1);
  assert.ok(report.dropped.some((d) => d.reason === "wrong_trade_media:interior_remodel"));

  // REAL, not a count: the driveway bytes ship, the kitchen bytes ship nowhere.
  const files = h.files();
  assert.ok(files, "the build reached the deploy stage");
  const shipped = Object.values(files).filter(Buffer.isBuffer);
  assert.ok(shipped.some((b) => b.equals(photos[0].bytes)), "the concrete photograph's bytes are in the tree");
  assert.ok(!shipped.some((b) => b.equals(photos[1].bytes)), "the interior-room photograph ships nowhere on a concrete build");
});

test("CROSS-PROSPECT CASE (engine): a photo bank keyed to another prospect places nothing — the donor's own slots stand", async () => {
  const photos = [1, 2].map((i) => ({
    url: `https://sullivanconcrete.example/p${i}-driveway.jpg`,
    ok: true,
    sha256: sha(`sullivan-${i}`),
    ext: "jpg",
    mime: "image/jpeg",
    bytes: Buffer.from(`SULLIVAN DRIVEWAY ${i} BYTES`, "utf8"),
  }));
  const foreignBank = photos.map((p) => ({
    url: p.url,
    sha256: p.sha256,
    grade: "gallery",
    prospect_id: "wss-ramon-framing|Ramon Framing LLC",
  }));
  const h = makeHarness({ resolve: fakeResolve({ photos }) });
  const res = await mirror(sullivanRequest({
    slug: "wss-test-mp-sullivan-cross",
    photos: photos.map((p) => p.url),
    photoBank: foreignBank,
  }), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `a guarded-out gallery is an explained gap, never a failed build: ${JSON.stringify(res.body).slice(0, 400)}`);

  const accounting = res.body.checks.brand.photos;
  assert.equal(accounting.placed, 0, "no asset keyed to another prospect may appear on this build");
  assert.equal(accounting.provenance_verified, 0);
  for (const refusal of accounting.photos_unplaced || []) {
    assert.equal(refusal.reason, "cross_prospect_contamination");
  }

  const report = res.body.checks.brand.media_provenance;
  assert.equal(report.dropped.length, 2);
  assert.ok(report.dropped.every((d) => d.prospect_id === "wss-ramon-framing|Ramon Framing LLC"));

  // The donor's own imagery keeps the slots — the neutral fallback, never a
  // substitution with someone else's picture.
  const files = h.files();
  const shipped = Object.values(files).filter(Buffer.isBuffer);
  for (const p of photos) {
    assert.ok(!shipped.some((b) => b.equals(p.bytes)), `prospect A's bytes (${p.url}) ship nowhere on prospect B's build`);
  }
});

test("HERO CASE (engine): the donor-owned flagged current hero image washes the hero; generic stock does not", async () => {
  const photos = [
    {
      url: "https://sullivanconcrete.example/IMG_4471.jpg",
      ok: true,
      sha256: sha("sullivan-generic"),
      ext: "jpg",
      mime: "image/jpeg",
      bytes: Buffer.from("SULLIVAN UNCLASSIFIED OWNED BYTES", "utf8"),
    },
    {
      url: "https://sullivanconcrete.example/hero-stamped-driveway.jpg",
      ok: true,
      sha256: sha("sullivan-current-hero"),
      ext: "jpg",
      mime: "image/jpeg",
      bytes: Buffer.from("SULLIVAN CURRENT HERO DRIVEWAY BYTES", "utf8"),
    },
  ];
  // The bank ranks their CURRENT hero image first, exactly as the lane does.
  const bank = [
    { url: photos[0].url, sha256: photos[0].sha256, grade: "gallery" },
    { url: photos[1].url, sha256: photos[1].sha256, grade: "hero", current_hero: true },
  ];
  const h = makeHarness({ resolve: fakeResolve({ photos }) });
  const res = await mirror(sullivanRequest({
    slug: "wss-test-mp-sullivan-hero",
    photos: photos.map((p) => p.url),
    photoBank: bank,
  }), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);

  const wash = res.body.checks.brand.hero_wash;
  assert.equal(wash.applied, true, `the wash must apply on the concrete donor: ${JSON.stringify(wash).slice(0, 300)}`);
  assert.equal(wash.photo_sha, sha("sullivan-current-hero"), "the hero paints THEIR flagged current image, not the first generic picture");
  assert.equal(wash.photo_source, "client_current_hero");
  assert.equal(wash.provenance.media_class, "concrete");
  assert.equal(wash.provenance.prospect_id, "wss-test-mp-sullivan-hero|jeff sullivan concrete");

  const heroReport = res.body.checks.brand.media_provenance.hero;
  assert.equal(heroReport.applied, true);
  assert.equal(heroReport.photo_source, "client_current_hero");
  assert.equal(heroReport.provenance.media_class, "concrete");
});

test("NO-PROVENANCE CASE (engine): photographs with no verified content hash are dropped, not placed", async () => {
  // The resolver seam returning "usable" rows that were never hashed is the
  // literal shape of "a URL exists": ok:true, bytes present, NO sha256.
  const photos = [
    {
      url: "https://sullivanconcrete.example/unverified-driveway.jpg",
      ok: true,
      ext: "jpg",
      mime: "image/jpeg",
      bytes: Buffer.from("NEVER HASHED BYTES", "utf8"),
    },
  ];
  const h = makeHarness({ resolve: fakeResolve({ photos }) });
  const res = await mirror(sullivanRequest({
    slug: "wss-test-mp-sullivan-unverified",
    photos: photos.map((p) => p.url),
  }), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `an unplaceable photograph is an explained gap, never a failed build: ${JSON.stringify(res.body).slice(0, 400)}`);

  const accounting = res.body.checks.brand.photos;
  assert.equal(accounting.placed, 0, "an asset with no verified content hash is never placed");
  assert.equal(accounting.provenance_verified, 0);
  const refusal = (accounting.photos_unplaced || []).find((r) => r.url.endsWith("unverified-driveway.jpg"));
  assert.ok(refusal, "the drop is named per asset");
  assert.equal(refusal.reason, "asset_content_hash_unverified");

  const files = h.files();
  const shipped = Object.values(files).filter(Buffer.isBuffer);
  assert.ok(!shipped.some((b) => b.equals(photos[0].bytes)), "the unverified bytes ship nowhere");
});
