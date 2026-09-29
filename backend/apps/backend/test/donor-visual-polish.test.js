"use strict";

// test/donor-visual-polish.test.js
//
// THE FIRST-FACTORY VERDICT (owner, 2026-09-01, on the first-ever completed
// factory sites), pinned here law by law:
//
//   1. LOGO PLATE — "Plumbing sites (dark-mode donor start) — the client
//      logo/top area looks jacked up." A raster client logo (no transparency
//      guarantee) on a dark canvas ships on a light pill; a light-default
//      canvas and an SVG mark never get one.
//   2. HERO CONTRAST FLOOR — "Fencing site starts LIGHT but looks better
//      dark; hero text is washed out (opacity too low)." The fencing donor
//      keeps its native DARK default (its compiled tokens ARE dark), and a
//      donor that declares hero_floor gets a proven veil plus solid sub-line
//      ink in BOTH modes.
//   3. CLIENT-PHOTO PROMINENCE — "Client images sit too LOW on the page —
//      especially fencing." A donor that declares photo_slot_prominence has
//      its HIGHEST slot filled with the FIRST owned photograph; donor stock
//      fills every gap from the bottom up.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-visual-polish-"));

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { siteEditLog } = require("../lib/site-edit-log");
const fleetPolish = require("../lib/mirror-engine/fleet-polish");
const theme = require("../lib/mirror-engine/theme");
const { scrimAlphaFor, HERO_SUB_INK } = require("../lib/hero-wash");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// THE HARNESS — same no-network shape as test/owned-photo-placement.test.js
// ---------------------------------------------------------------------------
function photosOf(ext, count) {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://fixture-dealer.example/p${i}.${ext}`,
    ok: true,
    sha256: sha(`photo-${i}`),
    ext,
    mime: `image/${ext}`,
    bytes: Buffer.from(`FAKE CLIENT ${ext.toUpperCase()} PHOTO BYTES ${i}`, "utf8"),
  }));
}

function fakeResolve({ mediaMode = "housed", photos = [], logo = null } = {}) {
  return async () => ({
    ok: true,
    logo,
    accent: logo ? "#c4873a" : null,
    primary: null,
    hashes: {},
    mediaMode,
    photos,
    heroVideo: null,
  });
}

function rasterLogo(ext = "png") {
  const bytes = Buffer.from(`FAKE ${ext.toUpperCase()} LOGO BYTES`, "utf8");
  return { ext, bytes, sha256: sha(bytes.toString("utf8")) };
}

function makeHarness({ resolve } = {}) {
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

function buildRequest({ slug, donor, industry, city, state, name, service_area, photos = [], logo = null, hero = undefined }) {
  return {
    slug,
    donor,
    facts: { business_name: name, industry, city, state, ...(service_area ? { service_area } : {}), phone: "(330) 555-0153" },
    ...(hero === null ? {} : { hero: hero || { headline: `Work in ${city}, ${state}` } }),
    brand: {
      ...(photos.length ? { photos: photos.map((p) => p.url) } : {}),
      ...(logo ? { logo: `https://fixture-dealer.example/logo.${logo.ext}` } : {}),
    },
  };
}

async function build(opts) {
  const h = makeHarness({ resolve: fakeResolve(opts) });
  const res = await mirror(buildRequest(opts), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);
  return { res, files: h.files() };
}

const shippedCss = (files) => {
  const name = Object.keys(files).find((f) => /^assets\/index-.*\.css$/.test(f));
  assert.ok(name, "the compiled css shipped");
  return files[name].toString("utf8");
};

// ---------------------------------------------------------------------------
// LAW 1 — THE LOGO PLATE
// ---------------------------------------------------------------------------
test("logoPlateCss: a pill scoped to the EXPLICIT dark state, never light", () => {
  const css = fleetPolish.logoPlateCss();
  assert.match(css, /\[data-wss-theme="dark"\] img\[src\*="client-logo"\]/);
  assert.match(css, /:root\.dark img\[src\*="client-logo"\]/);
  // The plate itself: light plate, padding, hairline border, contain fit.
  assert.match(css, /background:\s*#f6f4ef/);
  assert.match(css, /padding:\s*0\.3rem 0\.6rem/);
  assert.match(css, /border:\s*1px solid rgba\(255, 255, 255, 0\.28\)/);
  assert.match(css, /border-radius:\s*0\.55rem/);
  assert.match(css, /object-fit:\s*contain/);
  // No rule may fire when the canvas is light: nothing is scoped to the
  // light state and nothing is unscoped.
  assert.doesNotMatch(css, /\[data-wss-theme="light"\]/);
  assert.doesNotMatch(css, /^img\[src\*="client-logo"\]/m);
});

test("logoPlateCss: dark header donor groups can plate the header, and SVG gets the light fallback", () => {
  const plate = fleetPolish.logoPlateCss({ includeHeader: true });
  assert.match(plate, /header img\[src\*="client-logo"\]/);
  assert.match(plate, /background:\s*#f6f4ef/);

  const fallback = fleetPolish.lightLogoFallbackCss({ includeHeader: true });
  assert.match(fallback, /\[data-wss-theme="dark"\] img\[src\*="client-logo\.svg"\]/);
  assert.match(fallback, /header img\[src\*="client-logo\.svg"\]/);
  assert.match(fallback, /filter:\s*brightness\(0\) invert\(1\)/);
});

test("dark canvas + raster logo SHIPS the plate; the light-default canvas does not", async () => {
  const logo = rasterLogo("png");
  const dark = await build({
    slug: "wss-test-vpl-polish-plumbing-las-vegas",
    donor: "plumbing-clean", industry: "plumbing",
    city: "Las Vegas", state: "NV", name: "Polish Plumbing LLC",
    logo, photos: photosOf("jpg", 1),
  });
  assert.match(shippedCss(dark.files), /#f6f4ef/, "the dark-default build carries the plate");
  assert.equal(dark.res.body.checks.theme.logo_plate, true);

  const light = await build({
    slug: "wss-test-vpl-polish-air-las-vegas",
    donor: "hvac-brandforge", industry: "hvac",
    city: "Las Vegas", state: "NV", name: "Polish Air LLC",
    logo, photos: [],
  });
  assert.doesNotMatch(shippedCss(light.files), /#f6f4ef/, "a light-default canvas never paints a plate");
  assert.equal(light.res.body.checks.theme.logo_plate, false);
});

test("roofing dark header + raster logo SHIPS the plate even when the page default is light", async () => {
  const logo = rasterLogo("png");
  const out = await build({
    slug: "wss-test-vpl-roof-plate-dallas",
    donor: "roofing-falcon-clean", industry: "roofing",
    city: "Dallas", state: "TX", name: "Plate Roofing LLC",
    logo, photos: photosOf("jpg", 1),
  });
  const css = shippedCss(out.files);
  assert.match(css, /header img\[src\*="client-logo"\]/, "dark-header donor groups get a header-scoped plate");
  assert.match(css, /#f6f4ef/);
  assert.equal(out.res.body.checks.theme.logo_plate, true);
});

test("an SVG mark never gets a plate, even on a dark canvas (it carries its own transparency)", async () => {
  const svgLogo = rasterLogo("svg");
  const dark = await build({
    slug: "wss-test-vpl-vector-plumbing-las-vegas",
    donor: "plumbing-clean", industry: "plumbing",
    city: "Las Vegas", state: "NV", name: "Vector Plumbing LLC",
    logo: svgLogo, photos: [],
  });
  assert.doesNotMatch(shippedCss(dark.files), /#f6f4ef/, "svg marks read on dark unaided");
  assert.match(shippedCss(dark.files), /filter:\s*brightness\(0\) invert\(1\)/, "svg marks get the light-logo fallback when no plate is painted");
  assert.equal(dark.res.body.checks.theme.logo_plate, false);
});

// ---------------------------------------------------------------------------
// LAW 2 — THE HERO CONTRAST FLOOR
// ---------------------------------------------------------------------------
test("fencing-sterling keeps its native DARK default (the owner's 'looks better dark')", () => {
  const d = theme.decideMode(null, { donor: "fencing-sterling" });
  assert.equal(d.mode, "dark");
  assert.equal(d.measured, false);
  // A client whose own site is STRONGLY measured light still wins — the
  // escape hatch is part of the law.
  const strong = theme.decideMode(
    { mode: "light", basis: "paper", brightShare: 0.9, darkShare: 0.05 },
    { donor: "fencing-sterling" },
  );
  assert.equal(strong.mode, "light");
  // Unrelated donors keep the light-by-default prior.
  assert.equal(theme.decideMode(null, { donor: "salon-lacquer-studio" }).mode, "light");
});

test("heroContrastFloorCss: banded veil carries the PROVEN alpha under the text band, both modes", () => {
  const proof = scrimAlphaFor({ scrimHex: "#0b1220", textHex: HERO_SUB_INK, target: 4.5 });
  assert.ok(proof.ok, "the dark anchor must be provable for the dimmest hero ink");
  const css = fleetPolish.heroContrastFloorCss({
    selector: "section:has(video[data-hero-video])",
    darkScrim: `rgba(11, 18, 32, ${proof.alpha})`,
    lightScrim: "rgba(253, 253, 252, 0.35)",
  });
  // The text band (25%-75%) carries the full proven alpha…
  assert.match(css, new RegExp(`rgba\\(11, 18, 32, ${proof.alpha}\\) 25%`));
  assert.match(css, new RegExp(`rgba\\(11, 18, 32, ${proof.alpha}\\) 75%`));
  // …the photo breathes above and below at a reduced alpha…
  assert.match(css, /rgba\(11, 18, 32, 0\.\d+\) 0%/);
  // …the veil sits ABOVE the photograph and BELOW the words.
  assert.match(css, /z-index: 5/);
  // The sub-line is a solid proven ink in dark mode, and the palette's own
  // text ink in light mode; the headline keeps its colour but not its
  // transparency; a gradient-filled headline is darkened on the light veil.
  assert.match(css, /\[data-wss-theme="dark"\][^{]*h1 \+ p[^{]*\{[^}]*color: #e8edf2 !important/s);
  assert.match(css, /h1 \+ p \{[^}]*color: var\(--wss-text\) !important/s);
  assert.match(css, /h1 \{[^}]*opacity: 1 !important/s);
  assert.match(css, /\.text-gradient \{[^}]*filter: brightness\(0\.62\)/s);
  // An empty selector ships nothing.
  assert.equal(fleetPolish.heroContrastFloorCss({ selector: "  " }), "");
});

test("a fencing build SHIPS the hero floor (veil + solid sub ink) and reports it", async () => {
  const out = await build({
    slug: "wss-test-vpl-fence-floor-panama-city",
    donor: "fencing-sterling", industry: "fencing",
    city: "Panama City", state: "FL", name: "Fence Floor Co",
    logo: rasterLogo("png"), photos: photosOf("jpg", 1),
  });
  const css = shippedCss(out.files);
  assert.match(css, /:is\(section:has\(video\[data-hero-video\]\)\)::after/, "the veil targets the photographic hero");
  assert.match(css, /hero contrast floor/, "the floor block is labelled for the auditor");
  const floor = out.res.body.checks.theme.hero_floor;
  assert.equal(floor.applied, true);
  assert.ok(floor.dark_alpha >= 0.35, `the dark alpha is at least the wash minimum (got ${floor.dark_alpha})`);
  // The boot script opens DARK: the donor-native canvas the owner graded
  // better is the one a first visitor sees.
  assert.match(out.files["index.html"].toString("utf8"), /var K="wss-theme",d="dark"/);
});

test("instrument-widget plumbing donors SHIP the hero floor (copy scrim) and report it", async () => {
  for (const t of [
    { slug: "wss-test-vpl-plumb-clean-floor-las-vegas", donor: "plumbing-clean", selector: "#top" },
    { slug: "wss-test-vpl-plumb-premier-floor-las-vegas", donor: "plumbing-premier", selector: "section:has(video[data-hero-video])" },
  ]) {
    const out = await build({
      slug: t.slug,
      donor: t.donor, industry: "plumbing",
      city: "Las Vegas", state: "NV", name: `${t.donor} Floor LLC`,
      logo: rasterLogo("png"), photos: photosOf("jpg", 1),
    });
    const css = shippedCss(out.files);
    assert.match(css, /hero contrast floor/, `${t.donor}: the floor block is labelled for the auditor`);
    assert.equal(out.res.body.checks.theme.hero_floor.applied, true);
    assert.equal(out.res.body.checks.theme.hero_floor.selector, t.selector);
  }
});

// ---------------------------------------------------------------------------
// LAW 3 — CLIENT-PHOTO PROMINENCE
// ---------------------------------------------------------------------------
test("fencing: the FIRST owned photograph takes the HERO slot, the second the about slot — gallery stock fills gaps", async () => {
  const photos = photosOf("jpg", 2);
  const out = await build({
    slug: "wss-test-vpl-fence-hero-panama-city",
    donor: "fencing-sterling", industry: "fencing",
    city: "Panama City", state: "FL", name: "Fence Hero Co",
    photos, logo: rasterLogo("png"),
  });
  const files = out.files;
  assert.ok(files["images/hero.jpg"].equals(photos[0].bytes),
    "the hero photograph (parallax image AND video poster) is the client's first owned photograph");
  assert.ok(files["images/about-hero.jpg"].equals(photos[1].bytes),
    "the immediately-after-hero about panel is the client's second photograph");
  assert.ok(!files["images/image0.jpeg"].equals(photos[0].bytes),
    "the gallery keeps donor stock for the gap — client photos never bury themselves again");
});

test("plumbing: the hero-strip detail plate outranks the Gallery mosaic for the first owned photograph", async () => {
  const photos = photosOf("jpg", 1);
  const out = await build({
    slug: "wss-test-vpl-plumb-strip-las-vegas",
    donor: "plumbing-clean", industry: "plumbing",
    city: "Las Vegas", state: "NV", name: "Plumb Strip LLC",
    photos, logo: rasterLogo("png"),
  });
  const files = out.files;
  assert.ok(files["assets/hero-detail-fitting-CjWkqcPK.jpg"].equals(photos[0].bytes),
    "the highest-rendering slot (the hero strip) carries the client's photograph");
  assert.ok(!files["assets/gallery-truck-side--xD2eLS2.jpg"].equals(photos[0].bytes),
    "the mid-page Gallery mosaic keeps donor stock when no owned photo is left for it");
});

test("plumbing-premier: the owner-card client photo slot outranks lower service artwork", async () => {
  const photos = photosOf("jpg", 1);
  const out = await build({
    slug: "wss-test-vpl-plumb-premier-photo-las-vegas",
    donor: "plumbing-premier", industry: "plumbing",
    city: "Las Vegas", state: "NV", name: "Premier Photo Plumbing LLC",
    photos, logo: rasterLogo("png"),
  });
  const files = out.files;
  assert.ok(files["assets/hero-plumber-BQApchPL.jpg"].equals(photos[0].bytes),
    "the high client-photo module gets the first owned photograph");
  assert.ok(!files["assets/water-heater-DUmyxTEf.jpg"].equals(photos[0].bytes),
    "lower service artwork no longer consumes the first owned photograph");
});

test("empty-root SPA donors ship a server-side pre-hydration grid reservation", async () => {
  const out = await build({
    slug: "wss-test-vpl-prehydration-las-vegas",
    donor: "plumbing-premier", industry: "plumbing",
    city: "Las Vegas", state: "NV", name: "Prehydrate Plumbing LLC",
    photos: photosOf("jpg", 1), logo: rasterLogo("png"),
  });
  const html = out.files["index.html"].toString("utf8");
  assert.match(html, /id="wss-prehydration-layout-css"/);
  assert.match(html, /data-wss-prehydration-layout/);
  assert.match(html, /data-wss-prehydration-widget/);
  assert.equal(out.res.body.checks.pre_hydration_layout.applied, true);
});

test("theme toggle static label matches the server-selected initial mode", async () => {
  const out = await build({
    slug: "wss-test-vpl-toggle-dark-las-vegas",
    donor: "plumbing-clean", industry: "plumbing",
    city: "Las Vegas", state: "NV", name: "Toggle Plumbing LLC",
    photos: [], logo: rasterLogo("png"),
  });
  const html = out.files["index.html"].toString("utf8");
  assert.match(html, /<span data-wss-icon-light hidden>/);
  assert.match(html, /<span data-wss-icon-dark>/);
  assert.match(html, /<span data-wss-theme-label>Dark<\/span>/);
});

test("hero locale uses the prospect NAP city/state, not the mining metro service area", async () => {
  const out = await build({
    slug: "wss-test-vpl-locale-wilton",
    donor: "plumbing-premier", industry: "plumbing",
    city: "Wilton", state: "Ca", service_area: "Sacramento", name: "Wilton Locale Plumbing LLC",
    photos: [], logo: rasterLogo("png"), hero: null,
  });
  const js = Object.entries(out.files)
    .find(([rel]) => /^assets\/index-.*\.js$/.test(rel))[1]
    .toString("utf8");
  assert.match(js, /Plumbing in Wilton, CA\./);
  assert.doesNotMatch(js, /Plumbing in Sacramento, CA\./);
  assert.doesNotMatch(js, /Wilton, Ca\.|Sacramento, Ca\./);
});

test("with NO owned photographs the donor's own imagery ships untouched on both donors", async () => {
  for (const t of [
    { slug: "wss-test-vpl-fence-stock-panama-city", donor: "fencing-sterling", industry: "fencing", city: "Panama City", state: "FL", name: "Fence Stock Co", heroSlot: "images/hero.jpg" },
    { slug: "wss-test-vpl-plumb-stock-las-vegas", donor: "plumbing-clean", industry: "plumbing", city: "Las Vegas", state: "NV", name: "Plumb Stock LLC", heroSlot: "assets/hero-detail-fitting-CjWkqcPK.jpg" },
  ]) {
    const out = await build({ ...t, logo: rasterLogo("png"), photos: [] });
    const donorRoot = path.join(__dirname, "..", "donors-clean", t.donor);
    const shipped = out.files[t.heroSlot];
    const onDisk = fs.readFileSync(path.join(donorRoot, t.heroSlot));
    assert.ok(shipped.equals(onDisk), `${t.donor}: the donor's own bytes ship at ${t.heroSlot} when no photo is owned`);
  }
});
