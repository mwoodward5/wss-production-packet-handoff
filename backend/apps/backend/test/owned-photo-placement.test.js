"use strict";

// test/owned-photo-placement.test.js
//
// THE CAMPAIGN KILL (line_mthy1zg2, 2026-08-31): an HVAC build banked 2 owned
// photographs, placed ZERO, and died at the render gate with
//   "owned_photos_retained: only 0 of 2 owned photo(s) placed (floor 1);
//    0 per-asset rejection reason(s) do not cover the 1-photo gap"
//
// Root cause chain — all three links pinned here:
//
//   1. PLACEMENT. The campaign lane builds on the serverless runner, where
//      ffmpeg is absent (lib/full-run.js documents the same fact for the hero
//      reel: "ffmpeg is not in the Vercel lambda"), so transcodePhoto()
//      returns null. A client whose imagery is all .webp (site-builder CDNs —
//      wixstatic, duda — serve webp) against the HVAC donor's .jpg-only
//      slots therefore placed nothing: exact-match -1, transcode null,
//      `continue`, five times over. The fix places the photograph at the
//      slot's path stem under its REAL extension and rewrites every
//      reference — the same proven needle swap the origin-mode rewriter
//      performs. Vercel serves content-type by extension, so the true bytes
//      under their true extension mislabel nothing.
//
//   2. WIRING. The engine reported only counts (`unplaced: 2` — a NUMBER),
//      while every reader of per-asset evidence reads `photos_unplaced` —
//      an ARRAY of {url, reason} (render-gate checkOwnedPhotos,
//      line-adapters sourceFactsFor, line-production-source-facts
//      photoAccountingFromRow). No producer existed, so EVERY zero-placement
//      looked identical and unexplained. The engine now emits a reason per
//      photograph that did not land: the resolver's own refusal
//      (unusable_at_build:...) for photos that failed fetch/sniff/mark, and
//      the placement environment's dead end (no_photo_slots_in_donor,
//      origin_mode_ext_mismatch_no_transcode, more_photos_than_slots, ...)
//      for usable ones. THE INVARIANT: usable photographs that do not land
//      are never silent again.
//
//   3. NO-SLOT DONORS. general-contractor-clean and medspa-luma ship empty
//      photo_slots BY DESIGN (their manifests say so — medspa photography is
//      the vertical's highest-liability surface). The one legitimate
//      owned-photo surface those donors' own structure declares is the hero
//      wash (manifest.hero_wash.selector). When the wash paints an OWNED
//      photograph, that photograph is shipped and seen, and the accounting
//      counts it — placed means "a visitor will see this".

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-owned-photo-"));

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { siteEditLog } = require("../lib/site-edit-log");
const { checkOwnedPhotos } = require("../lib/render-gate");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// resolveBrandAssets stand-in, network-free: N photos of a chosen extension,
// each distinct by sha and bytes — the exact contract the real resolver
// returns (housed rows carry bytes; origin rows carry originUrl and none).
function photosOf(ext, count, { refuse = [] } = {}) {
  return Array.from({ length: count }, (_, i) => (
    refuse.includes(i)
      ? { url: `https://fixture-dealer.example/p${i}.${ext}`, ok: false, reason: "not_a_photo" }
      : {
        url: `https://fixture-dealer.example/p${i}.${ext}`,
        ok: true,
        sha256: sha(`photo-${i}`),
        ext,
        mime: `image/${ext}`,
        bytes: Buffer.from(`FAKE CLIENT ${ext.toUpperCase()} PHOTO BYTES ${i}`, "utf8"),
      }
  ));
}

function fakeResolve({ mediaMode = "housed", photos = [] } = {}) {
  return async () => ({
    ok: true,
    logo: null,
    accent: null,
    primary: null,
    hashes: {},
    mediaMode,
    photos: photos.map((p) => (mediaMode === "origin" && p.ok
      ? { ...p, originUrl: p.url, bytes: undefined }
      : p)),
    heroVideo: null,
  });
}

// The no-network deploy harness from test/hotlink-origin-mode.test.js. The
// transcode seam is injected so a test can STATE "no transcoder" — the
// serverless fact — and still demand placement.
function makeHarness({ resolve, transcode } = {}) {
  let captured = null;
  const deps = {
    slugPolicy,
    siteEditLog: (args) => siteEditLog({ ...args, select: async () => ({ ok: true, mode: "live_select", data: [] }) }),
    resolveBrandAssets: resolve,
    ...(transcode ? { transcodePhoto: transcode } : {}),
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

function buildRequest({ slug, donor, industry, city = "Akron", state = "OH", name = "Trane Dealer Heating and Air" }, photos) {
  return {
    slug,
    donor,
    facts: {
      business_name: name,
      industry,
      city,
      state,
      phone: "(330) 555-0153",
    },
    hero: { headline: "Heating and cooling in Akron, OH" },
    brand: { photos },
  };
}

// ---------------------------------------------------------------------------
// 1. THE KILL, PINNED: webp-only client, jpg-only donor, NO TRANSCODER
// ---------------------------------------------------------------------------
test("webp photos against jpg slots with no transcoder still PLACE (the campaign kill stays dead)", async () => {
  const photos = photosOf("webp", 2);
  const h = makeHarness({ resolve: fakeResolve({ photos }), transcode: async () => null });
  const res = await mirror(buildRequest({
    slug: "wss-test-ownphoto-trane-dealer-akron",
    donor: "hvac-brandforge",
    industry: "hvac",
  }, photos.map((p) => p.url)), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);

  const accounting = res.body.checks.brand.photos;
  // THE FLOOR'S OWN LAW: owned photos exist => at least one is placed.
  assert.ok(accounting.placed >= 1, `placed must be >= 1 (got ${accounting.placed})`);
  assert.equal(accounting.usable, 2);
  assert.equal(accounting.placed, 2, "both owned photographs place on a five-slot donor");

  // Placement is REAL, not a count: the true bytes ship at the slot's stem
  // under their true extension, and the compiled bundle points there.
  const files = h.files();
  assert.ok(files, "the build never reached the deploy stage");
  assert.ok(files["assets/hero-hvac-BowSuqa2.webp"], "the hero slot stem carries the client's .webp bytes");
  assert.ok(
    files["assets/hero-hvac-BowSuqa2.webp"].equals(photos[0].bytes),
    "the shipped hero bytes are the client's first photograph",
  );
  const bundle = files["assets/index-BMZ4eaGZ.js"].toString("utf8");
  assert.ok(bundle.includes("/assets/hero-hvac-BowSuqa2.webp"), "the compiled bundle references the rewritten path");
  assert.ok(!bundle.includes("/assets/hero-hvac-BowSuqa2.jpg"), "the unreplaced slot path is gone from the bundle");
  assert.ok(accounting.ext_fallback >= 1, "the accounting names the fallback that shipped the photos");
});

// ---------------------------------------------------------------------------
// 2. THE INVARIANT: a photograph that does not land is never silent
// ---------------------------------------------------------------------------
test("origin mode with ext-mismatched photos: slots stay donor-owned but every unplaced photo carries a reason — the gate passes as an explained gap", async () => {
  const photos = photosOf("webp", 3);
  const h = makeHarness({ resolve: fakeResolve({ mediaMode: "origin", photos }) });
  const res = await mirror(buildRequest({
    slug: "wss-test-ownphoto-origin-gap-akron",
    donor: "hvac-brandforge",
    industry: "hvac",
  }, photos.map((p) => p.url)), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);

  const accounting = res.body.checks.brand.photos;
  // Origin mode cannot transcode, so no SLOT takes a .webp photograph — but
  // the hero wash hotlinks one of them (the verified origin URL), and that
  // photograph is shipped and seen.
  assert.equal(accounting.placed, 1);
  assert.equal(accounting.hero_wash_placed, 1);
  assert.equal(accounting.ext_fallback, 0, "origin mode never rewrites bytes it does not house");
  const reasons = accounting.photos_unplaced;
  assert.ok(Array.isArray(reasons) && reasons.length === 2,
    `every usable photograph that did not land carries a reason (got ${JSON.stringify(reasons)})`);
  for (const r of reasons) {
    assert.match(r.url, /^https:\/\/fixture-dealer\.example\/p\d\.webp$/);
    assert.equal(r.reason, "origin_mode_ext_mismatch_no_transcode");
  }

  // The gate's own law, exercised on the engine's real accounting: 3 banked,
  // 1 placed, floor 2 — an EXPLAINED 1-photo gap passes; the same counts
  // without reasons are the production kill.
  const explained = checkOwnedPhotos({}, {
    photos_captured: 3,
    photos_placed: accounting.placed,
    photos_unplaced: reasons,
  });
  assert.equal(explained.pass, true, `the explained gap must pass: ${JSON.stringify(explained)}`);
  const silent = checkOwnedPhotos({}, {
    photos_captured: 3,
    photos_placed: accounting.placed,
  });
  assert.equal(silent.pass, false, "the same gap with no reasons is exactly the production kill");
});

test("photographs the resolver refused carry THEIR OWN reason into the accounting", async () => {
  // One good photograph, one the resolver refused — the refusal reason must
  // arrive per asset (unusable_at_build:<why>), never as a bare count.
  const good = photosOf("jpg", 1)[0];
  const refusedPhoto = { url: "https://fixture-dealer.example/refused.jpg", ok: false, reason: "not_a_photo" };
  const photos = [good, refusedPhoto];
  const h = makeHarness({ resolve: fakeResolve({ photos }) });
  const res = await mirror(buildRequest({
    slug: "wss-test-ownphoto-refused-photo-akron",
    donor: "hvac-brandforge",
    industry: "hvac",
  }, photos.map((p) => p.url)), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);

  const accounting = res.body.checks.brand.photos;
  assert.equal(accounting.usable, 1);
  assert.equal(accounting.placed, 1);
  const refused = (accounting.photos_unplaced || []).find((r) => r.url === refusedPhoto.url);
  assert.ok(refused, `the refused photograph is named per asset (got ${JSON.stringify(accounting.photos_unplaced)})`);
  assert.equal(refused.reason, "unusable_at_build:not_a_photo");
});

test("the engine never emits usable-but-unplaced photographs without a covering reason", async () => {
  // THE PINNED INVARIANT, stated generally: for every build, every usable
  // photograph either landed (placed) or carries a {url, reason}. A count
  // gap with no reasons is structurally impossible after this change —
  // this test fails if any future edit reintroduces the silent zero.
  const photos = photosOf("webp", 3);
  for (const mode of ["housed", "origin"]) {
    const h = makeHarness({
      resolve: fakeResolve({ mediaMode: mode, photos }),
      transcode: async () => null,
    });
    const res = await mirror(buildRequest({
      slug: `wss-test-ownphoto-invariant-${mode}-akron`,
      donor: "hvac-brandforge",
      industry: "hvac",
    }, photos.map((p) => p.url)), { registry: createRegistry(), deps: h.deps });
    assert.equal(res.status, 200, `[${mode}] build was rejected: ${JSON.stringify(res.body).slice(0, 400)}`);
    const accounting = res.body.checks.brand.photos;
    const urls = photos.map((p) => p.url);
    const accounted = accounting.placed + (accounting.photos_unplaced || []).length;
    assert.ok(accounted >= accounting.usable,
      `[${mode}] every usable photograph is accounted for: placed=${accounting.placed} reasons=${(accounting.photos_unplaced || []).length} usable=${accounting.usable}`);
    for (const r of accounting.photos_unplaced || []) {
      assert.ok(urls.includes(r.url), `[${mode}] the reason names a real photograph (${r.url})`);
      assert.ok(String(r.reason || "").trim(), `[${mode}] the reason is non-blank for ${r.url}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. NO-SLOT DONORS: the hero wash is the donor's own owned-photo surface
// ---------------------------------------------------------------------------
for (const [donor, industry, name, slug] of [
  ["medspa-luma", "medspa", "Portland Skin Collective", "wss-test-ownphoto-portland-skin-collective"],
  ["general-contractor-clean", "general-contractor", "Cascade General Contracting", "wss-test-ownphoto-cascade-general-contracting"],
]) {
  test(`${donor} (no photo_slots by design): an owned photograph still ships — behind the hero wash its own manifest declares`, async () => {
    const photos = photosOf("jpg", 2);
    const h = makeHarness({ resolve: fakeResolve({ photos }) });
    const res = await mirror(buildRequest({
      slug,
      donor,
      industry,
      city: "Portland",
      state: "OR",
      name,
    }, photos.map((p) => p.url)), { registry: createRegistry(), deps: h.deps });
    assert.equal(res.status, 200, `build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);

    const accounting = res.body.checks.brand.photos;
    assert.equal(accounting.slots_in_donor, 0, `${donor} ships no photo slots`);
    assert.equal(accounting.placed, 1, "the hero-wash photograph counts as placed — a visitor sees it");
    assert.equal(accounting.hero_wash_placed, 1);
    assert.equal(res.body.checks.brand.hero_wash.applied, true);

    // REAL, not a count: the wash bytes ship and a stylesheet paints them.
    const files = h.files();
    assert.ok(files, "the build never reached the deploy stage");
    assert.ok(files["assets/hero-wash.jpg"], "the client's photograph ships as the wash layer");
    const cssRels = Object.keys(files).filter((r) => /\.css$/i.test(r));
    const css = cssRels.map((r) => files[r].toString("utf8")).join("\n");
    assert.ok(css.includes("/assets/hero-wash.jpg"), "a stylesheet points the hero at the client's photograph");

    // The unwashed second photograph is not silent: the donor's structure
    // has no other surface for it, and the reason says exactly that.
    const reasons = accounting.photos_unplaced || [];
    assert.ok(reasons.some((r) => r.url === photos[1].url && r.reason === "no_photo_slots_in_donor"),
      `the leftover names the donor's shape (got ${JSON.stringify(reasons)})`);
  });
}

// ---------------------------------------------------------------------------
// 4. REGRESSION CONTROL: exact-format photos still take the slot path itself
// ---------------------------------------------------------------------------
test("exact-format photos still place at the declared slot path (no behavior change)", async () => {
  const photos = photosOf("jpg", 2);
  const h = makeHarness({ resolve: fakeResolve({ photos }) });
  const res = await mirror(buildRequest({
    slug: "wss-test-ownphoto-exact-jpg-akron",
    donor: "hvac-brandforge",
    industry: "hvac",
  }, photos.map((p) => p.url)), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);

  const accounting = res.body.checks.brand.photos;
  assert.equal(accounting.placed, 2);
  assert.equal(accounting.ext_fallback, 0, "no fallback was needed");
  const files = h.files();
  assert.ok(files["assets/hero-hvac-BowSuqa2.jpg"].equals(photos[0].bytes),
    "the jpg photograph lands at the declared slot path itself");
});
