"use strict";

// test/photo-ships.test.js — THE PHOTO-SHIPS CONTRACT (final-qa Class A,
// 2026-09). The 8 plumbing builds shipped pages whose photo references
// broke in two ways every asset-level gate missed:
//
//   · ROOT-ABSOLUTE refs the engine itself stamps (`/assets/wss-people.webp`,
//     `/assets/wss-stock-1.webp`, `/assets/client-logo.png`) resolve only on
//     a domain-root deploy; under the path-based local viewer the same bytes
//     the build SHIPS 404 — the team band, lightbox and brand mark rendered
//     as blank holes (probes: 4 broken imgs desktop, 8 mobile).
//   · ONERROR CHAINS with no compile-time guarantee: a broken primary fell
//     back through this.src to ANOTHER reference nobody proved ships — both
//     ends 404, the reader sees the broken-image icon.
//
// lib/mirror-engine/photo-ships.js owns both, in the hero-poster.js pattern:
// normalize root-absolute forms to page-depth-correct relative refs, then
// assert every reference (and every onerror target) resolves to shipped
// image bytes — dangling refs self-heal to the donor's bundled real photo.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyPhotoShipsPass,
  applyRootAbsoluteNormalization,
  assertPhotosShip,
  resolvePhotoFallback,
  relativePrefix,
} = require("../lib/mirror-engine/photo-ships");

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 0)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20, 0)]);
const WEBP = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4, 0), Buffer.from("WEBP", "ascii")]);

test("relativePrefix: depth-correct prefixes for pages and css", () => {
  assert.equal(relativePrefix("index.html"), "");
  assert.equal(relativePrefix("service-area/austin/index.html"), "../../");
  assert.equal(relativePrefix("assets/design.css"), "../");
});

test("normalization: root-absolute refs with shipped bytes become relative; og:image stays absolute", () => {
  const files = {
    "index.html": Buffer.from(
      '<meta property="og:image" content="https://site.example/assets/hero.jpg">' +
      '<img src="/assets/wss-people.webp" alt="team">' +
      '<a href="/assets/shot.jpg" data-lb><img src="/assets/shot.jpg" alt="x"></a>' +
      '<div style="background-image:url(/assets/tile.png)"></div>',
      "utf8",
    ),
    "service-area/austin/index.html": Buffer.from('<img src="/assets/wss-people.webp" alt="team">', "utf8"),
    "assets/design.css": Buffer.from(".x{background:url(/assets/tile.png)}", "utf8"),
    "assets/wss-people.webp": WEBP,
    "assets/shot.jpg": JPG,
    "assets/tile.png": PNG,
  };
  const out = applyRootAbsoluteNormalization({ files });
  const home = files["index.html"].toString("utf8");
  const deep = files["service-area/austin/index.html"].toString("utf8");
  const css = files["assets/design.css"].toString("utf8");

  assert.ok(home.includes('src="assets/wss-people.webp"'), "root-absolute img src normalized");
  assert.ok(home.includes('href="assets/shot.jpg"'), "root-absolute lightbox href normalized");
  assert.ok(home.includes("url('assets/tile.png')"), "inline style url normalized");
  assert.ok(home.includes("https://site.example/assets/hero.jpg"), "absolute og:image untouched");
  assert.ok(deep.includes('src="../../assets/wss-people.webp"'), "deep page gets the depth-correct prefix");
  assert.equal(css.includes("url('../assets/tile.png')"), true,
    "css url() rewritten relative to the css file's own depth (assets/design.css -> ../assets/tile.png)");
  assert.ok(out.rewritten >= 4, `rewrites counted (saw ${out.rewritten})`);
});

test("assertion: every reference and onerror target resolves; dangling ones heal to the donor photo", () => {
  const files = {
    "index.html": Buffer.from(
      '<img src="assets/ok.jpg" alt="a">' +
      '<img src="assets/missing.jpg" alt="b" onerror="this.onerror=null;this.src=\'assets/gone.webp\'">' +
      '<a href="assets/missing2.png"><img src="assets/ok.jpg" alt="c"></a>',
      "utf8",
    ),
    "assets/ok.jpg": JPG,
    "assets/donor-poster.jpg": JPG,
  };
  const proof = assertPhotosShip({ files, fallbackRel: "assets/donor-poster.jpg" });
  assert.equal(proof.ok, true, `healed: ${JSON.stringify(proof.dangling)}`);
  assert.ok(proof.refs >= 5, `src + href + onerror all counted (saw ${proof.refs})`);
  assert.ok(proof.healed >= 3, `two dangling refs + one dangling onerror healed (saw ${proof.healed})`);
  assert.equal(proof.onerror_fixed >= 1, true, "the dangling onerror target was re-pointed");

  const html = files["index.html"].toString("utf8");
  assert.ok(!html.includes("assets/missing.jpg"), "dangling primary healed");
  assert.ok(!html.includes("assets/gone.webp"), "dangling onerror target healed — never a second 404");
  assert.match(html, /onerror="this\.onerror=null;this\.src='assets\/donor-poster\.jpg'"/);
});

test("assertion: a dangling ref with NO fallback target fails honestly, changing no bytes it cannot heal", () => {
  const files = {
    "index.html": Buffer.from('<img src="assets/missing.jpg" alt="a">', "utf8"),
    "assets/ok.jpg": JPG,
  };
  const before = files["index.html"].toString("utf8");
  const proof = assertPhotosShip({ files, fallbackRel: "" });
  assert.equal(proof.ok, false, "no fallback -> the dangling ref must read as a failure, not a silent pass");
  assert.equal(files["index.html"].toString("utf8"), before, "nothing was healed, nothing was changed");
});

test("fallback resolution: manifest poster wins, then the largest shipped slot raster", () => {
  const files = {
    "assets/hero-poster.jpg": JPG,
    "assets/gallery-big.jpg": Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]),
    "assets/gallery-small.jpg": Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4, 0)]),
    "assets/other.png": PNG,
  };
  const byPoster = resolvePhotoFallback({
    files,
    manifest: { hero_video: { poster: "assets/hero-poster.jpg" }, photo_slots: ["assets/gallery-small.jpg"] },
  });
  assert.equal(byPoster.rel, "assets/hero-poster.jpg");

  const bySlot = resolvePhotoFallback({ files, manifest: { photo_slots: ["assets/gallery-small.jpg", "assets/gallery-big.jpg"] } });
  assert.equal(bySlot.rel, "assets/gallery-big.jpg", "the largest shipped slot raster wins");

  const any = resolvePhotoFallback({ files, manifest: {} });
  assert.equal(any.rel, "assets/gallery-big.jpg", "any shipped raster under assets/ is the last rung (largest wins)");
});

test("full pass: the two Class A shapes heal in one compile step and the tree reads clean", () => {
  const files = {
    "index.html": Buffer.from(
      '<img src="/assets/wss-people.webp" alt="team">' +
      '<a href="/assets/missing.jpg"><img src="assets/ok.jpg" onerror="this.src=\'/assets/gone.webp\'"></a>',
      "utf8",
    ),
    "assets/wss-people.webp": WEBP,
    "assets/ok.jpg": JPG,
    "assets/donor-poster.jpg": JPG,
  };
  const r = applyPhotoShipsPass({
    files,
    manifest: { hero_video: { poster: "assets/donor-poster.jpg" }, photo_slots: ["assets/ok.jpg"] },
  });
  assert.equal(r.applied, true);
  assert.equal(r.assertion.ok, true, `assertion: ${JSON.stringify(r.assertion)}`);
  const html = files["index.html"].toString("utf8");
  assert.ok(html.includes('src="assets/wss-people.webp"'), "shipped root-absolute bytes normalized to relative");
  assert.ok(!html.includes("/assets/missing.jpg"), "dangling href healed to the donor photo");
  assert.ok(!html.includes("gone.webp"), "dangling onerror target healed");
});
