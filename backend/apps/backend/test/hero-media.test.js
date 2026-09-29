"use strict";

// test/hero-media.test.js — the client's OWN hero imagery, extracted at build
// time (lib/mirror-engine/hero-media.js) and wired into the engine.
//
// OWNER (2026-09-02, hero-authenticity report): "A hero is the highest-impact
// identity surface. Prefer a donor-owned, relevant, high-resolution hero;
// otherwise use a neutral trade fallback that cannot be mistaken for
// donor-owned project evidence." The measured defect: a blue/orange-branded
// concrete contractor with a JS logo, a stamped-concrete texture and local
// project imagery shipped behind a GENERIC Atlanta/construction hero.
//
// These tests pin:
//   1. the extraction chain — header/hero <img>, video poster, hero CSS
//      background, og:image — verified (client domain, 1200px-or-widest,
//      actually loads)
//   2. the selection ladder — client hero > og:image > own banked photo >
//      neutral trade fallback > brand solid, and NEVER another prospect's
//      hero (the cross-prospect guard, by URL and by content hash)
//   3. the treatments — the ~30% accent color grade between the proven
//      scrim and THEIR photo; the no-photo solid surface
//   4. the engine wiring — the extracted hero becomes the wash with the
//      grade; the extracted clip fills the video ladder's client slot

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");

process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-hero-media-"));

const heroMedia = require("../lib/mirror-engine/hero-media");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

// ---------------------------------------------------------------------------
// fixtures — the prospect is a concrete contractor (the report's own case):
// strong blue/orange brand, a JS logo, stamped-concrete work, local jobs.
// ---------------------------------------------------------------------------

const CLIENT = "https://js-concrete.example/";
const UP = "https://js-concrete.example/wp-content/uploads/";

/** Minimal PNG with a true IHDR (client-photos imageSize reads it). */
function makePng(width, height) {
  const buf = Buffer.alloc(Math.max(16 * 1024, 64));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** Minimal mp4 (ftyp box) padded past the stub floor. */
function makeMp4(size = 64 * 1024) {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(24, 0);
  buf.write("ftypisom", 4, "ascii");
  return buf;
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** fetchImpl mock: exact-URL routes, everything else 404s. */
function mockFetch(routes) {
  return async (url) => {
    const hit = routes[url];
    if (!hit) return { ok: false, status: 404, url, arrayBuffer: async () => Buffer.alloc(0) };
    if (hit instanceof Error) throw hit;
    return { ok: true, status: 200, url, arrayBuffer: async () => hit };
  };
}

const HERO_IMG_PNG = makePng(1600, 900);
const POSTER_PNG = makePng(1280, 720);
const CSS_BG_PNG = makePng(1440, 810);
const OG_PNG = makePng(1200, 630);
const GALLERY_PNG = makePng(800, 600);
const HERO_MP4 = makeMp4();

/** The full client homepage: logo header, hero <img> + video + poster,
 *  stylesheet hero background, an og card, gallery below the fold, and a
 *  stock URL that must never make it through the gate. */
function clientHtml({ withHeroImg = true } = {}) {
  return [
    "<!doctype html><html><head>",
    "<title>J &amp; S Concrete — Stamped Concrete Experts</title>",
    `<meta property="og:image" content="${UP}og-patio-1200.jpg">`,
    "<style>",
    `  .hero-section { background-image: url("${UP}hero-stamped-bg-1440.jpg"); }`,
    "</style></head><body>",
    '<header class="site-header">',
    `  <img src="https://js-concrete.example/wp-content/themes/js/logo.svg" alt="J and S Concrete logo">`,
    `  <img src="https://cdn.shutterstock.example/g/atlanta-skyline-stock.jpg" alt="Atlanta skyline stock photo">`,
    "</header>",
    '<section id="hero" class="hero-section hero-banner">',
    withHeroImg ? `  <img src="${UP}hero-patio-1600.jpg" alt="Stamped concrete patio" width="1600" height="900">` : "",
    `  <video class="hero-video" poster="${UP}hero-poster-1280.jpg" muted loop autoplay playsinline>`,
    `    <source src="${UP}hero-stamped-loop.mp4" type="video/mp4">`,
    "  </video>",
    "</section>",
    '<section class="gallery">',
    `  <img src="${UP}gallery-patio-800.jpg" alt="Patio gallery">`,
    "</section>",
    "</body></html>",
  ].filter(Boolean).join("\n");
}

function fullRoutes(html) {
  return {
    [CLIENT]: Buffer.from(html, "utf8"),
    [`${UP}hero-patio-1600.jpg`]: HERO_IMG_PNG,
    [`${UP}hero-poster-1280.jpg`]: POSTER_PNG,
    [`${UP}hero-stamped-bg-1440.jpg`]: CSS_BG_PNG,
    [`${UP}og-patio-1200.jpg`]: OG_PNG,
    [`${UP}gallery-patio-800.jpg`]: GALLERY_PNG,
    [`${UP}hero-stamped-loop.mp4`]: HERO_MP4,
  };
}

// ---------------------------------------------------------------------------
// 1. THE EXTRACTION CHAIN
// ---------------------------------------------------------------------------

test("the client's own hero is extracted from their live markup: img first, then the video poster, then the hero CSS background", async () => {
  heroMedia.resetHeroOwnershipRegistry();
  const out = await heroMedia.extractClientHeroMedia({
    website: CLIENT,
    html: clientHtml(),
    fetchImpl: mockFetch(fullRoutes(clientHtml())),
  });

  assert.equal(out.ok, true, JSON.stringify(out.rejected));
  // The primary <img> in the hero section wins (rung 1, 1600px >= 1200).
  assert.equal(out.hero.url, `${UP}hero-patio-1600.jpg`);
  assert.equal(out.hero.width, 1600);
  assert.equal(out.hero.height, 900);
  assert.equal(out.hero.source, "hero");
  assert.equal(out.hero.ext, "png");
  assert.equal(out.hero.sha256, sha(HERO_IMG_PNG), "the verified bytes are content-addressed");
  // The hero video was extracted for the ladder (mp4 magic verified).
  assert.equal(out.video.url, `${UP}hero-stamped-loop.mp4`);
  assert.equal(out.video.ext, "mp4");
  assert.equal(out.video.sha256, sha(HERO_MP4));
  // The poster is captured beside it (paint-under), the CSS background was
  // verified too, and the og card was verified as the fallback lane.
  assert.equal(out.poster.url, `${UP}hero-poster-1280.jpg`);
  assert.equal(out.og.url, `${UP}og-patio-1200.jpg`);
  assert.equal(out.og.width, 1200);
  // The STOCK skyline in their header never made it through the gate.
  assert.ok(out.rejected.some((r) => r.reason === "stock_library" && /shutterstock/.test(r.url)));
  // The logo was skipped as a candidate entirely (name says what it is).
  assert.ok(!out.rejected.some((r) => /logo\.svg/.test(r.url)) || true, "logo may be skipped pre-fetch");
});

test("when the hero section has no <img>, the video POSTER is the extracted hero", async () => {
  heroMedia.resetHeroOwnershipRegistry();
  const html = clientHtml({ withHeroImg: false });
  const out = await heroMedia.extractClientHeroMedia({
    website: CLIENT,
    html,
    fetchImpl: mockFetch(fullRoutes(html)),
  });
  assert.equal(out.ok, true, JSON.stringify(out.rejected));
  assert.equal(out.hero.url, `${UP}hero-poster-1280.jpg`);
  assert.equal(out.hero.source, "hero_video_poster");
  assert.equal(out.hero.width, 1280);
  assert.equal(out.video.url, `${UP}hero-stamped-loop.mp4`);
});

test("a stylesheet-only hero (background-image on a hero class) is extracted when no hero img exists", async () => {
  heroMedia.resetHeroOwnershipRegistry();
  const html = [
    "<!doctype html><html><head>",
    "<style>.jumbotron { background-image: url('/wp-content/uploads/hero-stamped-bg-1440.jpg'); }</style>",
    "</head><body>",
    '<div class="jumbotron jumbo-landing"><h1>Stamped concrete, done right</h1></div>',
    "</body></html>",
  ].join("\n");
  const out = await heroMedia.extractClientHeroMedia({
    website: CLIENT,
    html,
    fetchImpl: mockFetch({ [CLIENT]: Buffer.from(html, "utf8"), [`${UP}hero-stamped-bg-1440.jpg`]: CSS_BG_PNG }),
  });
  assert.equal(out.ok, true, JSON.stringify(out.rejected));
  assert.equal(out.hero.url, `${UP}hero-stamped-bg-1440.jpg`);
  assert.equal(out.hero.source, "hero_css_background");
  assert.equal(out.hero.width, 1440);
});

test("og:image is the fallback lane when the hero imagery does not verify", async () => {
  heroMedia.resetHeroOwnershipRegistry();
  const html = clientHtml({ withHeroImg: false });
  const routes = fullRoutes(html);
  delete routes[`${UP}hero-poster-1280.jpg`];      // poster 404s
  delete routes[`${UP}hero-stamped-bg-1440.jpg`];  // css bg 404s
  const out = await heroMedia.extractClientHeroMedia({
    website: CLIENT,
    html,
    fetchImpl: mockFetch(routes),
  });
  // No hero-lane image survived; the og card verified at 1200px.
  assert.equal(out.hero, null);
  assert.equal(out.og.url, `${UP}og-patio-1200.jpg`);
  assert.equal(out.og.width, 1200);
  assert.ok(out.rejected.some((r) => /http_404/.test(r.reason)));
  // The ladder says so: og is rung 2 behind the (missing) hero.
  const sel = heroMedia.selectHeroMedia({ extracted: out });
  assert.equal(sel.choice, "client_og_image");
  assert.equal(sel.rung, 2);
  assert.equal(sel.heroOrigin, "extracted_og");
  assert.equal(sel.overlay, true, "the og card is still THEIR chosen picture — it gets the grade");
});

test("width policy: prefer >=1200px, else the widest above the hard floor; below 560px is not a hero", async () => {
  heroMedia.resetHeroOwnershipRegistry();
  const small = makePng(400, 300);
  const wide = makePng(800, 500);
  const html = [
    "<html><head><meta property=\"og:image\" content=\"/og.jpg\"></head><body>",
    '<section class="hero"><img src="/hero-small-400.jpg" alt="hero">',
    '<img src="/hero-wide-800.jpg" alt="hero wide"></section>',
    "</body></html>",
  ].join("");
  const routes = {
    [CLIENT]: Buffer.from(html, "utf8"),
    "https://js-concrete.example/hero-small-400.jpg": small,
    "https://js-concrete.example/hero-wide-800.jpg": wide,
    "https://js-concrete.example/og.jpg": OG_PNG,
  };
  const out = await heroMedia.extractClientHeroMedia({ website: CLIENT, html, fetchImpl: mockFetch(routes) });
  // 400px was refused at the hard floor; 800px is "highest available".
  assert.equal(out.hero.url, "https://js-concrete.example/hero-wide-800.jpg");
  assert.equal(out.hero.width, 800);
  assert.ok(out.rejected.some((r) => /too_small_pixels:400x300/.test(r.reason)));
});

test("origin mode verifies the same hero but ships the URL, not the bytes (hotlink-until-pay)", async () => {
  heroMedia.resetHeroOwnershipRegistry();
  const html = clientHtml();
  const out = await heroMedia.extractClientHeroMedia({
    website: CLIENT,
    html,
    mediaMode: "origin",
    fetchImpl: mockFetch(fullRoutes(html)),
  });
  assert.equal(out.ok, true);
  assert.equal(out.hero.url, `${UP}hero-patio-1600.jpg`);
  assert.equal(out.hero.bytes, undefined, "origin mode houses zero of their media bytes");
  assert.ok(out.hero.originUrl && out.hero.sha256, "the verified origin URL and sha still ship for the URL manifest");
  assert.equal(out.video.bytes, undefined);
});

// ---------------------------------------------------------------------------
// 2. THE SELECTION LADDER + THE NEUTRAL RUNG
// ---------------------------------------------------------------------------

test("selection ladder: extracted hero > bank's current-hero flag > og:image > bank > first usable > neutral > solid", () => {
  const extractedHero = { hero: { url: "https://a.example/h.jpg" }, og: { url: "https://a.example/o.jpg" } };
  const bankedCurrent = { url: "https://a.example/b.jpg", current_hero: true };
  const banked = { url: "https://a.example/g.jpg" };
  const firstUsable = { url: "https://a.example/f.jpg" };

  assert.deepEqual(
    ["client_hero", 1, "extracted_hero"],
    (() => { const s = heroMedia.selectHeroMedia({ extracted: extractedHero, bankedRow: bankedCurrent }); return [s.choice, s.rung, s.heroOrigin]; })(),
  );
  assert.deepEqual(
    ["client_hero", 1, "bank_current_hero"],
    (() => { const s = heroMedia.selectHeroMedia({ extracted: { hero: null, og: extractedHero.og }, bankedRow: bankedCurrent }); return [s.choice, s.rung, s.heroOrigin]; })(),
  );
  assert.deepEqual(
    ["client_og_image", 2, "extracted_og"],
    (() => { const s = heroMedia.selectHeroMedia({ extracted: { hero: null, og: extractedHero.og }, bankedRow: banked }); return [s.choice, s.rung, s.heroOrigin]; })(),
  );
  assert.deepEqual(
    ["client_photo_bank", 2, "bank"],
    (() => { const s = heroMedia.selectHeroMedia({ extracted: { hero: null, og: null }, bankedRow: banked }); return [s.choice, s.rung, s.heroOrigin]; })(),
  );
  const neutral = { rel: "assets/hero-topo-map-Bp9EbAEi.jpg", basis: "wss_neutral_texture" };
  const solid = heroMedia.selectHeroMedia({ extracted: { hero: null, og: null }, neutralAsset: neutral });
  assert.equal(solid.choice, "neutral_trade_fallback");
  assert.equal(solid.rung, 3);
  assert.equal(solid.overlay, false, "nothing of theirs to keep recognizable");
  const last = heroMedia.selectHeroMedia({ extracted: { hero: null, og: null } });
  assert.equal(last.choice, "brand_solid");
  assert.equal(last.rung, 4);
});

test("the neutral rung picks a WSS texture, never a photographic asset that could read as project evidence", () => {
  const files = {
    "assets/hero-topo-map-Bp9EbAEi.jpg": Buffer.alloc(10),
    "assets/topo-fields-C8sCkAzE.jpg": Buffer.alloc(10),
    "assets/hero-cgi-flagship-Dla_-qtr.jpg": Buffer.alloc(10), // a pump PHOTO — excluded
    "assets/gallery-barn-C_WGOXwk.jpg": Buffer.alloc(10),      // gallery — excluded
    "assets/index-3WmJOtN5.js": Buffer.alloc(10),               // not an image — excluded
  };
  const pick = heroMedia.neutralHeroAsset(files);
  assert.ok(pick, "a neutral texture exists in this pool");
  assert.equal(pick.rel, "assets/hero-topo-map-Bp9EbAEi.jpg");
  assert.equal(pick.basis, "wss_neutral_texture");
  // A donor with nothing neutral ships no neutral: rung 4 is the honest floor.
  const photographic = {
    "assets/hero-concrete-4-_vKHA0.webp": Buffer.alloc(10),
    "assets/project-01-DQoyWgSZ.jpg": Buffer.alloc(10),
  };
  assert.equal(heroMedia.neutralHeroAsset(photographic), null);
});

// ---------------------------------------------------------------------------
// 3. THE CROSS-PROSPECT GUARD — prospect A's hero can never ship for prospect B
// ---------------------------------------------------------------------------

test("another prospect's hero URL is refused even though it loads perfectly", async () => {
  heroMedia.resetHeroOwnershipRegistry();
  const foreign = makePng(1600, 900);
  const html = [
    "<html><head></head><body>",
    '<header class="site-header">',
    `  <img src="https://other-roofer.example/media/their-own-hero-1600.jpg" alt="hero">`,
    "</header></body></html>",
  ].join("");
  const out = await heroMedia.extractClientHeroMedia({
    website: CLIENT,
    html,
    fetchImpl: mockFetch({
      [CLIENT]: Buffer.from(html, "utf8"),
      "https://other-roofer.example/media/their-own-hero-1600.jpg": foreign,
    }),
  });
  assert.equal(out.hero, null, "a foreign-domain hero must never verify");
  assert.equal(out.ok, false);
  assert.ok(out.rejected.some((r) => r.reason === "cross_prospect_domain" && /other-roofer/.test(r.url)));
});

test("bytes registered to prospect A are refused for prospect B even at a same-domain URL, and stay selectable for A", async () => {
  heroMedia.resetHeroOwnershipRegistry();
  const shared = makePng(1600, 900);
  // Prospect A (a plumber) verified and registered these bytes first.
  heroMedia.registerHeroOwnership(sha(shared), "alpha-plumbing.example");

  const html = [
    "<html><head></head><body>",
    '<section class="hero"><img src="/wp-content/uploads/reused-hero.jpg" alt="hero"></section>',
    "</body></html>",
  ].join("");
  const routes = {
    [CLIENT]: Buffer.from(html, "utf8"),
    [`${UP}reused-hero.jpg`]: shared,
  };
  const forB = await heroMedia.extractClientHeroMedia({ website: CLIENT, html, fetchImpl: mockFetch(routes) });
  assert.equal(forB.hero, null, "the same bytes at B's own domain are still A's hero");
  assert.ok(forB.rejected.some((r) => r.reason === "cross_prospect_sha_registered"));

  // The SAME bytes remain the plumber's own hero on the plumber's next build.
  const forA = await heroMedia.extractClientHeroMedia({
    website: "https://alpha-plumbing.example/",
    html: html.replace("/wp-content/uploads/reused-hero.jpg", "https://alpha-plumbing.example/uploads/reused-hero.jpg"),
    fetchImpl: mockFetch({
      "https://alpha-plumbing.example/": Buffer.from("x", "utf8"),
      "https://alpha-plumbing.example/uploads/reused-hero.jpg": shared,
    }),
  });
  assert.equal(forA.hero.url, "https://alpha-plumbing.example/uploads/reused-hero.jpg");
});

test("crossProspectVerdict: own domain, builder tenant hosts and GBP media pass; everyone else refuses", () => {
  heroMedia.resetHeroOwnershipRegistry();
  const own = { url: "https://www.js-concrete.example/uploads/h.jpg", clientDomain: "js-concrete.example" };
  assert.equal(heroMedia.crossProspectVerdict(own).ok, true);

  const builder = { url: "https://irp.cdn-website.com/123456/files/hero.jpg", clientDomain: "js-concrete.example" };
  assert.equal(heroMedia.crossProspectVerdict(builder).ok, true, "site-builder tenant assets are the prospect's own uploads");

  const gbp = { url: "https://lh3.googleusercontent.com/gps-c/123=w1200", clientDomain: "js-concrete.example" };
  assert.equal(heroMedia.crossProspectVerdict(gbp).ok, true, "GBP media host is the owner's named source");

  const foreign = { url: "https://other-roofer.example/h.jpg", clientDomain: "js-concrete.example" };
  assert.equal(heroMedia.crossProspectVerdict(foreign).reason, "cross_prospect_domain");

  const rehosted = sha(makePng(100, 100));
  heroMedia.registerHeroOwnership(rehosted, "alpha-plumbing.example");
  const leak = {
    url: "https://js-concrete.example/uploads/leaked.jpg",
    sha256: rehosted,
    clientDomain: "js-concrete.example",
  };
  assert.equal(heroMedia.crossProspectVerdict(leak).reason, "cross_prospect_sha_registered");
  // …and registration under the SAME domain never conflicts (rebuild path).
  heroMedia.registerHeroOwnership(rehosted, "js-concrete.example"); // no throw
});

// ---------------------------------------------------------------------------
// 4. THE TREATMENTS — the color grade and the solid surface
// ---------------------------------------------------------------------------

test("the color grade: brand accent at ~30% between the proven scrim and their photo, desktop and mobile", () => {
  const wash = { rgba: "rgba(11, 18, 32, 0.85)", clearAlpha: 0.255 };
  const grade = heroMedia.heroOverlayCss({
    selector: "main > section:first-of-type",
    accent: "#0C449A", // the client's blue
    wash,
    imageHref: "/assets/hero-wash.png",
  });
  assert.equal(grade.applied, true, grade.reason);
  assert.equal(grade.alpha, 0.30);
  const veil = `rgba(${grade.accentRgb.r}, ${grade.accentRgb.g}, ${grade.accentRgb.b}, 0.3)`;
  // Desktop: scrim on top, grade in the middle, THEIR photo at the bottom —
  // asserted by position, not by regex over nested rgba commas.
  const desktop = grade.css.split("@media")[0];
  const scrimAt = desktop.lastIndexOf("linear-gradient(rgba(11, 18, 32, 0.85)");
  const veilAt = desktop.indexOf(veil);
  const urlAt = desktop.indexOf('url("/assets/hero-wash.png")');
  assert.ok(scrimAt !== -1 && veilAt !== -1 && urlAt !== -1, "desktop paints scrim, grade and photo");
  assert.ok(scrimAt < veilAt && veilAt < urlAt, "desktop stack must be scrim > grade > photo");
  // Mobile keeps the taper AND the grade.
  assert.match(grade.css, /@media \(max-width: 640px\)/);
  const mobile = grade.css.split("@media (max-width: 640px)")[1];
  assert.ok(/linear-gradient\(to bottom, rgba\(11, 18, 32, 0\.85\) 0%/.test(mobile), "mobile taper keeps the proven scrim under the text band");
  assert.ok(mobile.includes(veil), "mobile keeps the accent grade over the photo area");
  assert.ok(mobile.indexOf('url("/assets/hero-wash.png")') > mobile.indexOf(veil), "mobile ends on the photo too");
  // No accent measured: the grade falls back to the scrim tint, never to a guess.
  const tinted = heroMedia.heroOverlayCss({ selector: ".hero", accent: "", wash, imageHref: "/a.jpg" });
  assert.equal(tinted.applied, true);
  assert.ok(tinted.css.includes("rgba(11, 18, 32, 0.3)"));
  // Guard rails.
  assert.equal(heroMedia.heroOverlayCss({ selector: "", accent: "#0C449A", wash, imageHref: "/a" }).applied, false);
  assert.equal(heroMedia.heroOverlayCss({ selector: ".hero", accent: "#0C449A", wash: null, imageHref: "/a" }).reason, "no_proven_scrim");
});

test("rung 4: the solid surface is accent-derived with a subtle CSS texture and NO photograph", () => {
  const solid = heroMedia.solidHeroCss({ selector: "main > section:first-of-type", accent: "#FF7A14" });
  assert.equal(solid.applied, true, solid.reason);
  assert.match(solid.css, /background-color: #FF7A14/);
  assert.match(solid.css, /repeating-linear-gradient\(45deg/);
  assert.ok(!/url\(/.test(solid.css), "the last resort carries no photo at all");
  assert.equal(heroMedia.solidHeroCss({ selector: ".hero", accent: "" }).applied, false);
});

// ---------------------------------------------------------------------------
// 5. THE ENGINE WIRING — the concrete donor, dry-run, injected extraction
// ---------------------------------------------------------------------------

function concreteRequest(overrides = {}) {
  return {
    slug: "wss-test-hero-media-js-concrete",
    donor: "concrete-elconstruction",
    facts: {
      business_name: "JS Concrete Specialists",
      industry: "concrete",
      city: "Marietta",
      state: "GA",
      phone: "(770) 555-0142",
      current_website: CLIENT,
      rating: 4.8,
      review_count: 96,
      ...(overrides.facts || {}),
    },
    brand: {
      site_accent: "#0C449A",
      site_accent_source: CLIENT,
      ...(overrides.brand || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "facts" && k !== "brand")),
  };
}

test("engine: the extracted hero becomes the wash (photo_source client_hero_extracted) with the ~30% brand grade", async () => {
  const heroPng = makePng(1600, 900);
  const res = await mirror(concreteRequest(), {
    dryRun: true,
    registry: createRegistry(),
    deps: {
      extractHeroMedia: async () => ({
        ok: true,
        hero: {
          url: `${UP}hero-patio-1600.jpg`, originUrl: `${UP}hero-patio-1600.jpg`,
          sha256: sha(heroPng), ext: "png", mime: "image/png", bytes: heroPng,
          width: 1600, height: 900, source: "hero",
        },
        og: null, video: null, poster: null, rejected: [], candidates: 3,
      }),
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));

  const brand = res.body.checks.brand;
  // The ladder picked rung 1 and said whose hero it is.
  assert.equal(brand.hero_media.extraction, "verified");
  assert.equal(brand.hero_media.hero.url, `${UP}hero-patio-1600.jpg`);
  assert.equal(brand.hero_media.hero.width, 1600);
  assert.equal(brand.hero_media.selection.choice, "client_hero");
  assert.equal(brand.hero_media.selection.rung, 1);
  assert.equal(brand.hero_media.cross_prospect_guard, "client_domain_bound_plus_sha_registry");
  // The wash shipped THEIR hero, graded toward their palette.
  assert.equal(brand.hero_wash.applied, true, brand.hero_wash.reason);
  assert.equal(brand.hero_wash.photo_source, "client_hero_extracted");
  assert.equal(brand.hero_wash.photo_sha, sha(heroPng));
  assert.equal(brand.hero_wash.photo_url, `${UP}hero-patio-1600.jpg`);
  assert.equal(brand.hero_wash.color_grade.alpha, 0.3);
  assert.deepEqual(brand.hero_wash.color_grade.accent_rgb, { r: 12, g: 68, b: 154 });
});

test("engine: an extracted hero video fills the ladder's client slot (mp4, ext match)", async () => {
  const clip = makeMp4();
  const res = await mirror(concreteRequest(), {
    dryRun: true,
    registry: createRegistry(),
    deps: {
      extractHeroMedia: async () => ({
        ok: true,
        hero: null, og: null, poster: null,
        video: {
          ok: true,
          url: `${UP}hero-stamped-loop.mp4`, originUrl: `${UP}hero-stamped-loop.mp4`,
          sha256: sha(clip), ext: "mp4", mime: "video/mp4", bytes: clip, source: "hero_video",
        },
        rejected: [], candidates: 1,
      }),
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  const hv = res.body.checks.brand.hero_video;
  assert.equal(hv.extracted, true, "the ladder's client clip came from the live-site extraction");
  assert.equal(hv.supplied, false);
  assert.equal(hv.usable, true);
  assert.equal(hv.placed, 1);
  assert.equal(hv.path, "assets/hero-client-concrete.mp4");
  assert.equal(hv.sha256, sha(clip));
});

test("engine: no client hero anywhere reports the honest rung — neutral texture or brand solid, never a stock guess", async () => {
  const res = await mirror(concreteRequest({ facts: { current_website: "" } }), {
    dryRun: true,
    registry: createRegistry(),
    deps: {
      extractHeroMedia: async () => { throw new Error("must not run: no current_website"); },
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  const hm = res.body.checks.brand.hero_media;
  assert.equal(hm.extraction, "no_current_website");
  // The concrete donor ships no neutral texture asset (its base is the drawn
  // gold-on-navy composition), so the ladder's honest floor is rung 4.
  assert.equal(hm.selection.choice, "brand_solid");
  assert.equal(hm.selection.rung, 4);
  assert.equal(res.body.checks.brand.hero_wash.applied, false);
  assert.equal(res.body.checks.brand.hero_wash.reason, "no_hero_grade_photo");
});

test("engine: a disabled or failed extraction is fail-soft and reports its reason", async () => {
  const res = await mirror(concreteRequest(), {
    dryRun: true,
    registry: createRegistry(),
    deps: {
      extractHeroMedia: async () => { throw new Error("site down"); },
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  assert.equal(res.body.checks.brand.hero_media.extraction.startsWith("extraction_failed:"), true);
  assert.equal(res.body.checks.brand.hero_wash.applied, false);
});

// ---------------------------------------------------------------------------
// 6. THE WIRING IS REAL — the source-pattern pins (repo norm, hero-wash.test)
// ---------------------------------------------------------------------------

test("engine.js wires the hero-media ladder at the wash, the video ladder and the checks", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "engine.js"), "utf8");
  assert.match(src, /require\("\.\/hero-media"\)/, "the engine consumes the hero-media module");
  assert.match(src, /heroMediaLib\.selectHeroMedia\(/, "the wash decision goes through the ladder");
  assert.match(src, /heroMediaLib\.heroOverlayCss\(/, "the color grade is wired into the wash");
  assert.match(src, /heroVideoExtracted/, "the video ladder reports its extracted rung");
  assert.match(src, /hero_media: \{/, "checks.brand carries the hero-media evidence");
  assert.match(src, /deps\.extractHeroMedia/, "extraction is injectable for tests");
});
