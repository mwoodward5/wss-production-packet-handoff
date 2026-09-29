"use strict";

// test/perf-pipeline.test.js — FEATURE 8: the build-time performance pipeline.
//
// The contract under test:
//   · CLS KILL — <img> tags whose src resolves into the build's file map get
//     width/height attributes read from the image bytes themselves (PNG,
//     JPEG, GIF, WEBP headers, no native deps).
//   · LAZY below-fold — every <img> without an explicit loading attribute
//     gets loading="lazy" decoding="async"; data URIs are left alone.
//   · EAGER hero — the hero asset and any image inside the SSR hero section
//     never ship loading="lazy"; the hero gets eager + fetchpriority=high.
//   · PRECONNECT — third-party origins referenced by the page get
//     <link rel="preconnect"> hints in <head> (gstatic gets crossorigin),
//     the site's own origin never does, and the list is capped.
//   · IDEMPOTENCE — transform(transform(page)) === transform(page), both per
//     page and over the whole files map.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  imageSize,
  transformHtml,
  applyPerfTransforms,
  MAX_PRECONNECTS,
} = require("../lib/mirror-engine/perf-pipeline");

// ---- header fixtures (headers only are enough for the parser) -------------
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000320000002540806000000"
    + "9dd14c5c0000000a49444154789c6360000002000148afa4710000000049454e44ae426082",
  "hex",
); // IHDR 0x320=800 x 0x254=596

function jpegBuffer(width, height) {
  const head = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9];
  // Pad past the parser's minimum header window — a real JPEG continues with
  // scan data after the EOI-less segments anyway.
  return Buffer.from([...head, 0x00, 0x00, 0x00, 0x00]);
}
const GIF = Buffer.concat([
  Buffer.from("GIF89a", "ascii"),
  Buffer.from([0x64, 0x00, 0x32, 0x00, 0xf0, 0x00, 0x00]), // 100x50, global color table follows
  Buffer.alloc(32), // color table + image data: real files continue past the header
]);

function webpVp8xBuffer(width, height) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUInt32LE(10, 16);
  b.writeUInt32LE(0, 20); // flags
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

test("imageSize reads intrinsic dimensions from PNG, JPEG, GIF and WEBP bytes", () => {
  assert.deepEqual(imageSize(PNG), { width: 800, height: 596 });
  assert.deepEqual(imageSize(jpegBuffer(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageSize(GIF), { width: 100, height: 50 });
  assert.deepEqual(imageSize(webpVp8xBuffer(1024, 768)), { width: 1024, height: 768 });
  assert.equal(imageSize(Buffer.from("<html>not an image</html>")), null, "non-image bytes -> null");
  assert.equal(imageSize(Buffer.alloc(0)), null, "empty bytes -> null");
});

const FILES = {
  "assets/hero-cinematic.jpg": jpegBuffer(1600, 900),
  "assets/gallery-shot.png": PNG,
  "assets/tiny.gif": GIF,
  "assets/extended.webp": webpVp8xBuffer(1024, 768),
  "index.html": "",
  "about.html": "",
};

const BASE_PAGE = [
  "<!doctype html><html><head><title>t</title></head><body>",
  `<section data-wss-ssr-hero="full-bleed"><img src="/assets/hero-cinematic.jpg" alt="hero"></section>`,
  `<img src="assets/gallery-shot.png" alt="gallery">`,
  `<img src="/assets/tiny.gif" alt="tiny" loading="lazy">`,
  `<img src="assets/extended.webp" alt="extended" loading="eager">`,
  `<img src="/assets/missing-from-map.jpg" alt="unknown">`,
  `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="inline">`,
  `<img src="https://cdn.remote.example/photo.webp" alt="remote">`,
  `<a href="https://fonts.googleapis.com/css2?family=Rubik">f</a>`,
  `<link href="https://fonts.gstatic.com/s/rubik.woff2" rel="stylesheet">`,
  "</body></html>",
].join("");

function build() {
  return transformHtml(BASE_PAGE, {
    files: FILES,
    pageRel: "index.html",
    heroAsset: "assets/hero-cinematic.jpg",
    siteUrl: "https://client-slug.wss-ai.com/",
  });
}

test("CLS: images served from the build get width/height from their own bytes", () => {
  const { html } = build();
  const hero = /<img\b[^>]*hero-cinematic[^>]*>/i.exec(html)[0];
  assert.ok(/\bwidth="1600"/.test(hero) && /\bheight="900"/.test(hero), "jpeg dims: " + hero);
  const png = /<img\b[^>]*gallery-shot[^>]*>/i.exec(html)[0];
  assert.ok(/\bwidth="800"/.test(png) && /\bheight="596"/.test(png), "png dims");
  const gif = /<img\b[^>]*tiny\.gif[^>]*>/i.exec(html)[0];
  assert.ok(/\bwidth="100"/.test(gif) && /\bheight="50"/.test(gif), "gif dims");
  const webp = /<img\b[^>]*extended\.webp[^>]*>/i.exec(html)[0];
  assert.ok(/\bwidth="1024"/.test(webp) && /\bheight="768"/.test(webp), "webp dims");
  const unknown = /<img\b[^>]*missing-from-map[^>]*>/i.exec(html)[0];
  assert.ok(!/\bwidth=/.test(unknown), "unknown asset is left untouched, never guessed");
});

test("below-fold images are lazy + async; data URIs are left alone", () => {
  const { html, report } = build();
  const png = /<img\b[^>]*gallery-shot[^>]*>/i.exec(html)[0];
  assert.ok(/loading="lazy"/.test(png) && /decoding="async"/.test(png), "gallery img lazy");
  const inline = /<img\b[^>]*data:image[^>]*>/i.exec(html)[0];
  assert.ok(!/loading=/.test(inline), "data URI needs no loading gate");
  const remote = /<img\b[^>]*cdn\.remote[^>]*>/i.exec(html)[0];
  assert.ok(/loading="lazy"/.test(remote), "remote below-fold img lazy too");
  assert.ok(report.imgs_lazy >= 3, "report counts lazy additions");
});

test("hero is eager with fetchpriority=high and never ships loading=lazy", () => {
  const { html } = build();
  const hero = /<img\b[^>]*hero-cinematic[^>]*>/i.exec(html)[0];
  assert.ok(/loading="eager"/.test(hero), "hero eager");
  assert.ok(/fetchpriority="high"/.test(hero), "hero fetchpriority");
  assert.ok(!/loading="lazy"/.test(hero), "no lazy on the LCP image");
  // An image inside the SSR hero section is above the fold even when it is
  // not the hero asset itself.
  const sectionPage = BASE_PAGE.replace(
    `<img src="/assets/hero-cinematic.jpg" alt="hero">`,
    `<img src="/assets/hero-cinematic.jpg" alt="hero" loading="lazy"><img src="/assets/gallery-shot.png" alt="in-hero">`,
  );
  const res = transformHtml(sectionPage, { files: FILES, pageRel: "index.html", heroAsset: "assets/hero-cinematic.jpg", siteUrl: "https://c.wss-ai.com/" });
  const inHero = /<img\b[^>]*gallery-shot[^>]*alt="in-hero"[^>]*>/i.exec(res.html)[0];
  assert.ok(!/loading="lazy"/.test(inHero), "hero-section image un-lazied");
  assert.ok(res.report.imgs_lazy_from_eager >= 1, "donor-shipped hero lazy is removed, and counted");
});

test("preconnect hints: third-party origins linked, own origin excluded, gstatic gets crossorigin, list capped", () => {
  const { html, report } = build();
  assert.ok(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"/.test(html), "googleapis preconnect");
  assert.ok(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin/.test(html), "gstatic preconnect with crossorigin");
  assert.ok(/<link rel="preconnect" href="https:\/\/cdn\.remote\.example"/.test(html), "media CDN preconnect");
  assert.ok(!/preconnect[^>]*wss-ai\.com/.test(html), "own origin never preconnected");
  assert.ok(report.preconnects_added <= MAX_PRECONNECTS, "capped at " + MAX_PRECONNECTS);

  // A page already carrying its own preconnects earns no duplicates.
  const withOwn = transformHtml(
    `<html><head><link rel="preconnect" href="https://fonts.googleapis.com"></head><body><a href="https://fonts.googleapis.com/x">x</a></body></html>`,
    { files: {}, pageRel: "index.html", siteUrl: "https://c.wss-ai.com/" },
  );
  assert.equal((withOwn.html.match(/fonts\.googleapis\.com/g) || []).length, 2, "one link tag + one reference, no duplicate hint");
});

test("hero preload link added only when the page has none", () => {
  const none = build();
  assert.equal(none.report.hero_preloaded, true, "content-empty page gains the hero preload");
  assert.ok(/rel="preload" as="image" href="\/assets\/hero-cinematic\.jpg" fetchpriority="high"/.test(none.html));
  const already = transformHtml(
    `<html><head><link rel="preload" as="image" href="/assets/hero-cinematic.jpg"></head><body><img src="/assets/hero-cinematic.jpg" alt="h"></body></html>`,
    { files: FILES, pageRel: "index.html", heroAsset: "assets/hero-cinematic.jpg", siteUrl: "https://c.wss-ai.com/" },
  );
  assert.equal(already.report.hero_preloaded, false, "existing preload respected");
  assert.equal((already.html.match(/rel="preload"/g) || []).length, 1);
});

test("per-page transform idempotence: a second pass changes no bytes", () => {
  const one = build();
  const two = transformHtml(one.html, {
    files: FILES,
    pageRel: "index.html",
    heroAsset: "assets/hero-cinematic.jpg",
    siteUrl: "https://client-slug.wss-ai.com/",
  });
  assert.equal(two.html, one.html, "transform(transform(x)) === transform(x)");
  assert.equal(two.report.imgs_dimensioned, 0);
  assert.equal(two.report.imgs_lazy, 0);
  assert.equal(two.report.imgs_eager, 0);
  assert.equal(two.report.preconnects_added, 0);
  assert.equal(two.report.hero_preloaded, false);
});

test("files-map pass: every html page transformed, non-html untouched, map-level idempotence", () => {
  const files = {
    ...FILES,
    "index.html": Buffer.from(BASE_PAGE, "utf8"),
    "about.html": Buffer.from('<html><head></head><body><img src="/assets/gallery-shot.png" alt="a"><script src="https://cdn.other.example/app.js"></script></body></html>', "utf8"),
    "assets/gallery-shot.png": PNG,
    "assets/app.js": Buffer.from('document.write("<img src=x>")', "utf8"),
    "assets/styles.css": Buffer.from("img{max-width:100%}", "utf8"),
  };
  const one = applyPerfTransforms({ files, siteUrl: "https://s.wss-ai.com/" });
  assert.equal(one.report.pages_transformed, 2, "index + about");
  // No caller-supplied heroAsset: the fallback heuristic finds the hero-named
  // file in the map — the same rule content-inject uses.
  assert.equal(one.report.hero_asset, "assets/hero-cinematic.jpg");

  // A map with no hero-named file reports the absence honestly.
  const heroless = applyPerfTransforms({
    files: { "index.html": Buffer.from("<html><head></head><body><img src='https://x/y.jpg'></body></html>"), "y.jpg": PNG },
    siteUrl: "https://s.wss-ai.com/",
  });
  assert.equal(heroless.report.hero_asset, "");

  // about.html was transformed: dims + lazy + a preconnect for its script host.
  const about = one.files["about.html"].toString("utf8");
  const aboutImg = /<img\b[^>]*gallery-shot[^>]*>/i.exec(about)[0];
  assert.ok(/width="800"/.test(aboutImg) && /height="596"/.test(aboutImg), "about dims");
  assert.ok(/loading="lazy"/.test(aboutImg), "about lazy");
  assert.ok(/preconnect[^>]*cdn\.other\.example/.test(about), "about preconnect");

  // Non-HTML files ride through unchanged.
  assert.equal(one.files["assets/app.js"], files["assets/app.js"], "js untouched");
  assert.equal(one.files["assets/styles.css"], files["assets/styles.css"], "css untouched");

  // Map-level idempotence: second pass, same bytes.
  const two = applyPerfTransforms({ files: one.files, siteUrl: "https://s.wss-ai.com/" });
  assert.equal(two.files["index.html"].toString("utf8"), one.files["index.html"].toString("utf8"));
  assert.equal(two.files["about.html"].toString("utf8"), one.files["about.html"].toString("utf8"));
  assert.equal(two.report.imgs_dimensioned, 0);
});

test("pipeline cooperates with the project gallery: gallery images get lazy attrs and preconnects reach the gallery hosts", () => {
  const gallery = require("../lib/mirror-engine/project-gallery");
  const facts = {
    business_name: "Harbor Line Contracting",
    project_photos: [{
      before_url: "https://media.client-host.example/deck-before.jpg",
      after_url: "https://media.client-host.example/deck-after.jpg",
      caption: "Deck rebuild",
    }],
  };
  const withGallery = gallery.injectProjectGallery({
    files: { "index.html": Buffer.from('<html><head></head><body><main>x</main></body></html>', "utf8").toString("utf8"), ...{} },
    facts,
  });
  const perfed = applyPerfTransforms({ files: withGallery.files, siteUrl: "https://s.wss-ai.com/" });
  const html = perfed.files["index.html"].toString("utf8");
  assert.ok(/deck-before[^>]*loading="lazy"/.test(html) || /loading="lazy"[^>]*deck-before/.test(html), "gallery before img lazy");
  assert.ok(/preconnect[^>]*media\.client-host\.example/.test(html), "gallery media host preconnected");
});
