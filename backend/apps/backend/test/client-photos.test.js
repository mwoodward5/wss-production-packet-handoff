"use strict";

// test/client-photos.test.js — the ownership gate is the whole point.
//
// The owner's bar is 10-20 of the CLIENT'S OWN photos, priority-first. The danger
// is the APOC failure: an image search with no ownership check putting another
// company's photo on a client's site. Every test here is about the gate, not the
// happy count — an off-domain image, an icon, a page URL labelled "photo", a
// duplicate, and an svg must each be refused, with a clear reason.

const test = require("node:test");
const assert = require("node:assert/strict");
const { harvestClientPhotos, candidatesFromHtml } = require("../lib/mirror-engine/client-photos");

// Distinct JPEG/PNG magic-number buffers above the 12KB floor. `fill` varies per
// image so each has a distinct sha256 — real photos are never byte-identical, and
// reusing one buffer would trip the dedup gate spuriously.
const jpeg = (fill) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20000, fill)]);
const png = (fill) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20000, fill)]);
const JPEG = jpeg(1);
const PNG = png(2);
const TINY = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function fetchStub(routes) {
  return async (url) => {
    const body = routes[url];
    if (body === undefined) return { ok: false, status: 404, async arrayBuffer() { return new ArrayBuffer(0); }, async text() { return ""; } };
    if (typeof body === "string") return { ok: true, status: 200, url, async text() { return body; }, async arrayBuffer() { return new ArrayBuffer(0); } };
    // Return a standalone ArrayBuffer copy so Buffer.from() sees exactly these bytes.
    const copy = Uint8Array.from(body);
    return { ok: true, status: 200, url, async arrayBuffer() { return copy.buffer; }, async text() { return ""; } };
  };
}

test("harvests only images on the client's own registrable domain", async () => {
  const site = "https://acme-plumbing.com/";
  const html = `
    <img src="/photos/van.jpg">
    <img src="https://cdn.competitor.com/stock.jpg">
    <img src="https://www.acme-plumbing.com/team.png">
    <meta property="og:image" content="https://acme-plumbing.com/hero.jpg">`;
  const fetchImpl = fetchStub({
    [site]: html,
    "https://acme-plumbing.com/photos/van.jpg": jpeg(1),
    "https://cdn.competitor.com/stock.jpg": jpeg(9),
    "https://www.acme-plumbing.com/team.png": png(2),
    "https://acme-plumbing.com/hero.jpg": jpeg(3),
  });
  const r = await harvestClientPhotos({ website: site, fetchImpl });
  assert.equal(r.ok, true);
  const hosts = r.photos.map((p) => new URL(p.url).hostname);
  assert.ok(hosts.every((h) => h.endsWith("acme-plumbing.com")), "every kept photo is on their own domain");
  assert.equal(r.photos.length, 3, "van, team and hero kept; the competitor CDN image rejected");
  assert.ok(r.rejected.some((x) => x.reason === "not_owned"), "the off-domain image is rejected as not_owned");
});

test("rejects icons, tiny images, svgs and page URLs labelled as photos", async () => {
  const site = "https://acme.com/";
  const html = `
    <img src="/logo-icon.png">
    <img src="/real-photo.jpg">
    <img src="/thumb.jpg">
    <img src="/brand.svg">`;
  const fetchImpl = fetchStub({
    [site]: html,
    "https://acme.com/logo-icon.png": PNG,    // icon hint in the name
    "https://acme.com/real-photo.jpg": JPEG,
    "https://acme.com/thumb.jpg": TINY,       // below the size floor
    "https://acme.com/brand.svg": SVG,        // not a raster photo
  });
  const r = await harvestClientPhotos({ website: site, fetchImpl });
  assert.equal(r.photos.length, 1, "only the real photo survives");
  assert.equal(r.photos[0].url, "https://acme.com/real-photo.jpg");
  const reasons = new Set(r.rejected.map((x) => x.reason));
  assert.ok(reasons.has("icon_hint"));
  assert.ok(reasons.has("too_small") || reasons.has("not_a_photo"));
});

test("dedupes the same image served at two URLs", async () => {
  const site = "https://acme.com/";
  const html = '<img src="/a.jpg"><img src="/b.jpg">';
  const fetchImpl = fetchStub({ [site]: html, "https://acme.com/a.jpg": JPEG, "https://acme.com/b.jpg": JPEG });
  const r = await harvestClientPhotos({ website: site, fetchImpl });
  assert.equal(r.photos.length, 1, "identical bytes at two URLs count once");
  assert.ok(r.rejected.some((x) => x.reason === "duplicate_bytes"));
});

test("a Genie asset is a candidate, never a trusted fact — still ownership-gated", async () => {
  const site = "https://acme.com/";
  const fetchImpl = fetchStub({
    [site]: "<html></html>",
    "https://acme.com/from-genie.jpg": JPEG,
    "https://evil.com/from-genie.jpg": JPEG,
  });
  const r = await harvestClientPhotos({
    website: site, fetchImpl,
    genieAssets: [
      { kind: "photo", url: "https://acme.com/from-genie.jpg" },
      { kind: "photo", url: "https://evil.com/from-genie.jpg" },
    ],
  });
  assert.equal(r.photos.length, 1, "the Genie's own-domain suggestion is kept, the off-domain one refused");
  assert.equal(r.photos[0].source, "genie_candidate");
});

test("no website means no photos, never a substitution", async () => {
  const r = await harvestClientPhotos({ website: "", fetchImpl: fetchStub({}) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_website");
  assert.deepEqual(r.photos, []);
});

test("candidatesFromHtml pulls src, srcset and og:image", () => {
  const c = candidatesFromHtml(
    '<img src="/a.jpg"><img srcset="/s-320.jpg 320w, /s-640.jpg 640w"><meta property="og:image" content="/og.jpg">',
    "https://x.com/",
  );
  assert.ok(c.includes("https://x.com/a.jpg"));
  assert.ok(c.includes("https://x.com/s-640.jpg"), "the largest srcset variant is taken");
  assert.ok(c.includes("https://x.com/og.jpg"));
});

test("candidatesFromHtml pulls <picture>/<source srcset> and a <video poster>", () => {
  // A video-hero site (the Swoosh audit case): the ONLY hero imagery is a
  // <video poster> and a <picture> the <img> scans never reach. Both must be
  // candidates, or the home hero is uncapturable and ships barren.
  const c = candidatesFromHtml(
    '<picture><source srcset="/p-800.webp 800w, /p-1600.webp 1600w"><img src="/fallback.jpg"></picture>'
    + '<video poster="/hero-poster.jpg" autoplay muted><source src="/hero.mp4" type="video/mp4"></video>',
    "https://x.com/",
  );
  assert.ok(c.includes("https://x.com/p-1600.webp"), "the largest <source srcset> variant is taken");
  assert.ok(c.includes("https://x.com/hero-poster.jpg"), "the hero video's poster still frame is captured");
  assert.ok(c.includes("https://x.com/fallback.jpg"), "the <picture>'s <img> fallback is still captured");
});

// --- http:// in the markup must not kill the build (40-metro plumbing run) ---
//
// A prospect's page is https but its markup still hard-codes http:// image
// sources — an old template, a site that gained a certificate years after its
// content was written. Those URLs reached brand.photos, where the request
// schema requires ^https:// and ONE of them 400s the entire build as
// "invalid_request". All Home Plumbing and Advanced Plumbing Service both died
// that way with eight good photos on a host serving every one over https.

test("an http:// image is fetched over https and reported as https", async () => {
  const site = "https://acme-plumbing.com/";
  const html = '<img src="http://acme-plumbing.com/photos/van.jpg">';
  const r = await harvestClientPhotos({
    website: site,
    html,
    // Only the https URL answers. If the harvester asked for http it gets 404
    // and the photo is lost — which is the regression this pins.
    fetchImpl: fetchStub({ "https://acme-plumbing.com/photos/van.jpg": JPEG }),
  });
  assert.equal(r.photos.length, 1);
  assert.equal(r.photos[0].url, "https://acme-plumbing.com/photos/van.jpg");
});

test("every harvested URL is https, so no single photo can 400 the build", async () => {
  const site = "https://acme-plumbing.com/";
  const html = `
    <img src="http://acme-plumbing.com/a.jpg">
    <img src="https://acme-plumbing.com/b.jpg">
    <img src="http://acme-plumbing.com/c.jpg">`;
  const r = await harvestClientPhotos({
    website: site,
    html,
    fetchImpl: fetchStub({
      "https://acme-plumbing.com/a.jpg": jpeg(11),
      "https://acme-plumbing.com/b.jpg": jpeg(12),
      "https://acme-plumbing.com/c.jpg": jpeg(13),
    }),
  });
  assert.equal(r.photos.length, 3);
  for (const p of r.photos) assert.match(p.url, /^https:\/\//);
});

test("an image that only exists over http is dropped, not passed through", async () => {
  // A mirror is served over https, where the browser blocks mixed content. An
  // http-only photo is a broken image however far it travels, so a smaller
  // gallery is the honest outcome — and the reason says which rule refused it.
  const site = "https://acme-plumbing.com/";
  const html = `
    <img src="http://acme-plumbing.com/legacy.jpg">
    <img src="https://acme-plumbing.com/good.jpg">`;
  const r = await harvestClientPhotos({
    website: site,
    html,
    fetchImpl: fetchStub({ "https://acme-plumbing.com/good.jpg": JPEG }),
  });
  assert.deepEqual(r.photos.map((p) => p.url), ["https://acme-plumbing.com/good.jpg"]);
  const dropped = r.rejected.find((x) => x.url === "http://acme-plumbing.com/legacy.jpg");
  assert.match(dropped.reason, /no_https/);
});

// ---------------------------------------------------------------------------
// SITE-BUILDER TENANT ASSET SPACE (2026-08-07)
//
// Measured across the thirteen live plumbing mirrors that shipped with NO client
// imagery: 180 of 211 rejections were `not_owned`, and nearly all of them were
// the prospect's own uploads on the asset CDN of the builder their site runs on
// — Duda, Thryv, Hibu, Wix. Best Plumbing & Heating lost eighteen of its own
// photographs that way; Holt Plumbing fifty-nine. These are precisely the
// cheap-site-builder businesses the worst-website targeting rule aims at.
//
// Widening the gate is only safe because it stays bound three ways: a NAMED
// builder host, a URL the CLIENT'S OWN PAGE embeds, and the stock/third-party
// refusals below. The first test proves the win; the next three prove the gate
// did not become a hole.
// ---------------------------------------------------------------------------

test("a builder CDN asset embedded by the client's own page is theirs", async () => {
  const site = "https://bestplumbing.com/";
  const html = '<img src="https://irp.cdn-website.com/309fe278/dms3rep/multi/opt/billboard-874w.jpg">';
  const r = await harvestClientPhotos({
    website: site, html,
    fetchImpl: fetchStub({ "https://irp.cdn-website.com/309fe278/dms3rep/multi/opt/billboard-874w.jpg": JPEG }),
  });
  assert.equal(r.photos.length, 1, "their Duda tenant upload is their photograph");
  assert.equal(r.photos[0].source, "own_site");
});

test("the same builder host is refused when the client's page did not embed it", async () => {
  // The binding IS the client's own markup. A builder host offered by the Genie
  // (which fabricates) or by a caller has nothing tying it to this business, so
  // the widened ownership rule must not reach it.
  const site = "https://acme.com/";
  const r = await harvestClientPhotos({
    website: site, html: "<html></html>",
    genieAssets: [{ kind: "photo", url: "https://irp.cdn-website.com/999zzz/dms3rep/multi/opt/someone-else-874w.jpg" }],
    extraUrls: ["https://static.wixstatic.com/media/not-ours~mv2.jpg"],
    fetchImpl: fetchStub({
      "https://irp.cdn-website.com/999zzz/dms3rep/multi/opt/someone-else-874w.jpg": JPEG,
      "https://static.wixstatic.com/media/not-ours~mv2.jpg": jpeg(4),
    }),
  });
  assert.equal(r.photos.length, 0, "a builder host is only theirs via their own page");
  assert.equal(r.rejected.filter((x) => x.reason === "not_owned").length, 2);
});

test("stock-library files are refused wherever they are hosted", async () => {
  // Real candidate: bestplumbingchattanooga.com serves
  // irp.cdn-website.com/…/GettyImages-1320565081-698w.jpg from its own tenant
  // space. Re-hosting a licensed stock file is both a lie about their work and
  // somebody else's copyright — and the tenant rule alone would have let it in.
  const site = "https://acme.com/";
  const html = `
    <img src="https://irp.cdn-website.com/309fe278/dms3rep/multi/opt/GettyImages-1320565081-698w.jpg">
    <img src="https://acme.com/wp-content/uploads/shutterstock_44921.jpg">
    <img src="https://acme.com/wp-content/uploads/our-crew.jpg">`;
  const r = await harvestClientPhotos({
    website: site, html,
    fetchImpl: fetchStub({
      "https://irp.cdn-website.com/309fe278/dms3rep/multi/opt/GettyImages-1320565081-698w.jpg": jpeg(5),
      "https://acme.com/wp-content/uploads/shutterstock_44921.jpg": jpeg(6),
      "https://acme.com/wp-content/uploads/our-crew.jpg": jpeg(7),
    }),
  });
  assert.deepEqual(r.photos.map((p) => p.url), ["https://acme.com/wp-content/uploads/our-crew.jpg"]);
  assert.equal(r.rejected.filter((x) => x.reason === "stock_library").length, 2);
});

test("a gbp candidate is refused unless it is on Google's own media host", async () => {
  const site = "https://acme.com/";
  const r = await harvestClientPhotos({
    website: site, html: "<html></html>",
    gbpPhotos: [
      "https://lh3.googleusercontent.com/places/real-photo",
      "https://not-google.example.com/pretend-gbp.jpg",
    ],
    fetchImpl: fetchStub({
      "https://lh3.googleusercontent.com/places/real-photo": JPEG,
      "https://not-google.example.com/pretend-gbp.jpg": jpeg(8),
    }),
  });
  assert.deepEqual(r.photos.map((p) => p.source), ["gbp"]);
  assert.equal(r.photos.length, 1);
  assert.ok(r.rejected.some((x) => x.reason === "not_owned"));
});

// ---------------------------------------------------------------------------
// ORDER IS THE PRODUCT
//
// The plumbing donor declares TWO photo_slots and the request schema caps
// brand.photos at 8, so a business supplying twenty photographs shows two.
// Which two was previously DOM order — which on Owens Plumbing put a bought
// "customer-review-3d-illustration-free-png" and a resized copy of their logo
// ahead of photographs of their actual work.
// ---------------------------------------------------------------------------

test("real work outranks the share card and the bought illustration", async () => {
  const site = "https://acme.com/";
  const html = `
    <img src="https://acme.com/uploads/share.jpg">
    <img src="https://acme.com/uploads/customer-review-3d-illustration-free-png.jpg">
    <img src="https://acme.com/uploads/gallery/water-heater-install.jpg">`;
  const r = await harvestClientPhotos({
    website: site, html,
    fetchImpl: fetchStub({
      "https://acme.com/uploads/share.jpg": jpeg(21),
      "https://acme.com/uploads/customer-review-3d-illustration-free-png.jpg": jpeg(22),
      "https://acme.com/uploads/gallery/water-heater-install.jpg": jpeg(23),
    }),
  });
  assert.equal(
    r.photos[0].url,
    "https://acme.com/uploads/gallery/water-heater-install.jpg",
    "the photograph of their job takes the donor's first slot",
  );
});

test("one picture at five widths is one photo, not five slots", async () => {
  // Content hashing cannot see this: Untitled-1.png and Untitled-1-300x100.png
  // genuinely differ byte-for-byte. Both reached Owens Plumbing's request, where
  // two duplicated logos could have consumed the client's entire gallery.
  const site = "https://acme.com/";
  const html = `
    <img src="https://acme.com/uploads/crew.jpg">
    <img src="https://acme.com/uploads/crew-1024x517.jpg">
    <img src="https://acme.com/uploads/crew-300x100.jpg">
    <img src="https://acme.com/uploads/other-job.jpg">`;
  const r = await harvestClientPhotos({
    website: site, html,
    fetchImpl: fetchStub({
      "https://acme.com/uploads/crew.jpg": jpeg(31),
      "https://acme.com/uploads/crew-1024x517.jpg": jpeg(32),
      "https://acme.com/uploads/crew-300x100.jpg": jpeg(33),
      "https://acme.com/uploads/other-job.jpg": jpeg(34),
    }),
  });
  assert.equal(r.photos.length, 2, "crew counts once however many widths it ships at");
  assert.equal(r.rejected.filter((x) => x.reason === "duplicate_variant").length, 2);
});

// ---------------------------------------------------------------------------
// THE HOMEPAGE IS NOT THE SITE
//
// Poor John's Plumbing shipped donor-only because its homepage carries exactly
// one image — its logo. A homepage-only harvest reports "photos: 0" for a site
// shaped that way, which is not the same claim as "this business has no
// photographs".
// ---------------------------------------------------------------------------

test("a thin homepage sends the harvester to their gallery page", async () => {
  const site = "https://acme.com/";
  const home = '<img src="/logo.svg"><a href="/gallery.html">Our work</a><a href="https://elsewhere.com/x">off site</a>';
  const r = await harvestClientPhotos({
    website: site, html: home,
    fetchImpl: fetchStub({
      "https://acme.com/gallery.html": '<img src="/uploads/job-1.jpg">',
      "https://acme.com/uploads/job-1.jpg": JPEG,
    }),
  });
  assert.deepEqual(r.photos.map((p) => p.url), ["https://acme.com/uploads/job-1.jpg"]);
});

test("a photo-rich homepage is not crawled, so it costs the one request it always did", async () => {
  const site = "https://acme.com/";
  const html = Array.from({ length: 6 }, (_, i) => `<img src="/p${i}.jpg">`).join("")
    + '<a href="/gallery.html">gallery</a>';
  const fetched = [];
  const stub = fetchStub(Object.fromEntries([
    ...Array.from({ length: 6 }, (_, i) => [`https://acme.com/p${i}.jpg`, jpeg(40 + i)]),
    ["https://acme.com/gallery.html", '<img src="/uploads/extra.jpg">'],
  ]));
  const r = await harvestClientPhotos({
    website: site, html,
    fetchImpl: async (u, o) => { fetched.push(u); return stub(u, o); },
  });
  assert.equal(r.photos.length, 6);
  assert.ok(!fetched.includes("https://acme.com/gallery.html"), "no crawl when the homepage already delivered");
});

test("a heavy file that is only 212x93 is still not photography", async () => {
  // Galli Plumbing's Plumbing-Tulsa.jpg is 4KB AND 212x93. The byte floor caught
  // that one; a decorative PNG badge can clear the byte floor and still be a
  // 200px sliver, so dimensions are read from the header too. An UNREADABLE
  // header stays "unknown" and is never treated as small — a missing
  // measurement must not cost a real photograph.
  const { imageSize } = require("../lib/mirror-engine/client-photos");
  const sliver = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(8), // chunk length + "IHDR"
    (() => { const b = Buffer.alloc(8); b.writeUInt32BE(212, 0); b.writeUInt32BE(93, 4); return b; })(),
    Buffer.alloc(20000, 7),
  ]);
  assert.deepEqual(imageSize(sliver, "png"), { w: 212, h: 93 });
  const r = await harvestClientPhotos({
    website: "https://acme.com/",
    html: '<img src="/wide-thin-banner.png">',
    fetchImpl: fetchStub({ "https://acme.com/wide-thin-banner.png": sliver }),
  });
  assert.equal(r.photos.length, 0);
  assert.equal(r.rejected[0].reason, "too_small_pixels");
});
