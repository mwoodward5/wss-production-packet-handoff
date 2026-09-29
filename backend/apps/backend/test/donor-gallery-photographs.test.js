"use strict";

// test/donor-gallery-photographs.test.js
//
// THE GALLERY LAW (owner verdict, 2026-09-02 render smoke): gallery images
// are REAL PHOTOGRAPHS, never generated line-art SVGs. The first factory
// roofing mirror shipped six gradient-and-stroke work-N.svg files (and a
// generated placeholder.svg as the onerror fallback) in the gallery slots,
// and the owner failed the build on sight.
//
// This test holds the law across EVERY donors-clean family:
//
//   1. No generated-art filename (work-N.svg, placeholder.svg,
//      before-1.svg, after-1.svg) is referenced by any index.html.
//   2. Every gallery <figure> image and its lightbox href resolve to a
//      bundled RASTER photograph (jpg/jpeg/png/webp) that exists in the
//      family tree.
//   3. JSON-LD ImageGallery contentUrls point at those same real photos.
//   4. Gallery onerror fallbacks point at real photographs, never art.
//   5. No manifest declares a work-N.svg photo slot, and every declared
//      slot ships a real file (client-photo substitution lands on slots —
//      a slot pointing at deleted art would strand the client's photos).
//
// A family that ships NO gallery (the photoless families, whose galleries
// were removed rather than filled with art) passes vacuously on 2-4.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS = path.join(BACKEND, "donors-clean");

const ART_RE = /(?:work-\d\.svg|placeholder\.svg|before-1\.svg|after-1\.svg)/;
const RASTER_RE = /\.(?:jpe?g|png|webp)$/i;

const families = fs.readdirSync(DONORS, { withFileTypes: true })
  .filter((e) => e.isDirectory()
    && fs.existsSync(path.join(DONORS, e.name, "index.html"))
    && fs.existsSync(path.join(DONORS, e.name, "BOILERPLATE.json")))
  .map((e) => e.name)
  .sort();

assert.ok(families.length >= 12, `expected at least 12 complete donor families, saw ${families.length}`);

function familyFiles(dir) {
  // The loader's shape: every file under the family dir, keyed by relative path.
  const files = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else files.add(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return files;
}

for (const fam of families) {
  const dir = path.join(DONORS, fam);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const files = familyFiles(dir);

  test(`${fam}: no generated-art gallery references in index.html`, () => {
    const hits = html.match(new RegExp(ART_RE, "g")) || [];
    assert.deepEqual(hits, [], `generated art referenced by the shipped page: ${hits.join(", ")}`);
  });

  // Structure-tolerant: a gallery shot is any lightbox anchor. Families wrap
  // these differently (falcon lineage: <figure class="reveal">; salon: bare
  // anchors inside the grid; the reel reuses the same photographs).
  const shotAnchors = [...html.matchAll(/<a class="shot" data-lb href="([^"]+)"[\s\S]*?<\/a>/g)];
  const shotHrefs = shotAnchors.map((m) => m[1]);
  // Only fallbacks INSIDE gallery anchors — the page's other onerror hooks
  // (logo fallbacks etc.) are identity marks, not gallery law.
  const onerrorFallbacks = shotAnchors.flatMap(
    (m) => [...m[0].matchAll(/onerror="this\.src='([^']+)'"/g)].map((x) => x[1]));
  const jsonldGallery = [...html.matchAll(/"@type": "ImageObject"(?:\[\[NEED:DOMAIN\]\])?, "contentUrl": "https:\/\/\{\{DOMAIN\}\}\/([^"]+)"/g)]
    .map((m) => m[1]);

  test(`${fam}: every gallery shot is a bundled real photograph`, () => {
    for (const href of shotHrefs) {
      assert.match(href, RASTER_RE, `gallery shot must be a raster photo: ${href}`);
      assert.ok(files.has(href), `gallery image must ship with the family: ${href}`);
    }
    for (const fallback of onerrorFallbacks) {
      assert.match(fallback, RASTER_RE, `onerror fallback must be a real photo, never art: ${fallback}`);
      assert.ok(files.has(fallback), `onerror fallback must ship with the family: ${fallback}`);
    }
  });

  test(`${fam}: JSON-LD gallery images are the same real photographs`, () => {
    for (const url of jsonldGallery) {
      assert.match(url, RASTER_RE, `JSON-LD contentUrl must be a raster photo: ${url}`);
      assert.ok(files.has(url), `JSON-LD image must ship with the family: ${url}`);
      assert.ok(shotHrefs.includes(url), `JSON-LD image not shown in the gallery: ${url}`);
    }
  });

  test(`${fam}: manifest photo slots are real shipped files, never art`, () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "BOILERPLATE.json"), "utf8"));
    for (const slot of manifest.photo_slots || []) {
      assert.doesNotMatch(slot, /work-\d\.svg$/, `art slot declared: ${slot}`);
      assert.ok(files.has(slot), `declared photo slot does not ship: ${slot}`);
    }
  });
}
