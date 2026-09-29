"use strict";

// test/header-mark-shape.test.js
//
// WHY THIS EXISTS, measured on the live mirrors 2026-08-07: eleven headers were
// serving a FAVICON where the company name belongs. Decoding the bytes the
// mirrors actually serve (86 marks across 102 hosts) put numbers on it:
//
//   50x50    Paschal Air, Plumbing & Electric   paschal_favicon_new-2018.png
//   57x57    JAM Plumbing                       apple-icon-57x57.png
//   90x92    Platero Parada Plumbing
//   100x92   Knoxville Concrete Kings
//   141x111  Fix It All Plumbing
//   150x150  The Local Guys Plumbing
//   179x179  Monolith Tattoo
//   180x180  Crown, Edwards, JL, McIndy, Middletown, Noble, Royal Ink,
//            The Drain Surgeon                  cropped-favicon-180x180.png
//   192x192  Diamond State Plumbing
//   200x200  Cardinal Plumbing
//   137x72   Galli Plumbing      (a WordPress crop of its own 1024x540 mark)
//   150x58   Bulldog Rooter      (a WordPress crop of its own 296x114 mark)
//
// Rendering the headers settled the argument: Edwards' and JL's were opaque
// WHITE BOXES on a coloured header, Paschal's and JAM's were visibly mushy, and
// The Drain Surgeon's was a nameless cartoon plumber. In this donor the logo is
// the ONLY identity in the bar — no name text beside it — so a site icon leaves
// the page anonymous.
//
// THE MECHANISM behind all of it, proven with ffmpeg off the PATH (which is what
// the serverless runtime is): png-decode only reads PNG, so a client whose real
// mark is a JPEG (crownplumbingpdx.com), a WebP (mcindyplumbing.com) or a
// colourless SVG (drainsurgeonaugusta.com) measured no accent and the picker
// fell through to the first PNG on the page — which on WordPress is always the
// site icon. The pipeline was effectively selecting "the first PNG".
//
// The numbers in the gate are not guesses. In the measured distribution the
// site-icon family tops out at 200x200 and the smallest genuine square logo is
// 300x230; among wide marks the failures are 137x72 and 150x58 and the smallest
// genuine wordmark is 165x85. Both thresholds sit inside those empty bands, and
// HEADER_MIN_PX 216 is also exactly what the slot demands (72 CSS px at 3x).

const test = require("node:test");
const assert = require("node:assert");
const { createHash } = require("node:crypto");
const zlib = require("node:zlib");

const {
  imageDimensions,
  classifyHeaderMark,
  WORDMARK_MIN_RATIO,
  HEADER_MIN_PX,
  WIDE_MIN_WIDTH,
} = require("../lib/capture-brand");
const { rankLogoCandidates, findLogoCandidates, upgradeToHttps, isSizedDerivative } = require("../lib/web-brand");

// --- byte builders: real container headers, not mocks ------------------------

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A structurally valid PNG of the given size (one solid row of pixels). */
function png(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 2; // 8-bit truecolour
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height, 0);
  return Buffer.concat([sig, chunk("IHDR", ihdrData), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A JPEG with a real SOF0 frame header behind a JFIF APP0 segment. */
function jpeg(width, height) {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0", "ascii"),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  ]);
  const sof = Buffer.alloc(21);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function webpVp8(width, height) {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8 ", 12, "ascii");
  buf.writeUInt32LE(10, 16);
  buf.writeUInt16LE(width & 0x3fff, 26);
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

function gif(width, height) {
  const buf = Buffer.alloc(16);
  buf.write("GIF89a", 0, "ascii");
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function ico(sizes) {
  const buf = Buffer.alloc(6 + 16 * sizes.length);
  buf.writeUInt16LE(0, 0); buf.writeUInt16LE(1, 2); buf.writeUInt16LE(sizes.length, 4);
  sizes.forEach(([w, h], i) => { buf[6 + i * 16] = w % 256; buf[6 + i * 16 + 1] = h % 256; });
  return buf;
}

const svg = (attrs) => Buffer.from(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><path d="M0 0h10v10H0z"/></svg>`, "utf8");

// --- the decoder --------------------------------------------------------------

test("dimensions come from the CONTAINER HEADER, in every format a logo arrives in", () => {
  assert.deepStrictEqual(imageDimensions(png(1000, 600)), { width: 1000, height: 600, format: "png" });
  assert.deepStrictEqual(imageDimensions(jpeg(600, 236)), { width: 600, height: 236, format: "jpg" });
  assert.deepStrictEqual(imageDimensions(webpVp8(304, 242)), { width: 304, height: 242, format: "webp" });
  assert.deepStrictEqual(imageDimensions(gif(180, 180)), { width: 180, height: 180, format: "gif" });
  // ICO carries a directory: the largest entry is what a browser would render,
  // and a 0 byte means 256 by spec.
  assert.deepStrictEqual(imageDimensions(ico([[16, 16], [0, 0], [48, 48]])), { width: 256, height: 256, format: "ico" });
});

test("a JPEG's size is found past its APP segments, not guessed from the first bytes", () => {
  // The naive reader takes bytes 5..9 of the file, which inside a JFIF APP0 are
  // version and density fields — it would report 1x1 for every JPEG on earth.
  const j = jpeg(2401, 639);
  assert.notDeepStrictEqual(imageDimensions(j), { width: 1, height: 1, format: "jpg" });
  assert.deepStrictEqual(imageDimensions(j), { width: 2401, height: 639, format: "jpg" });
});

test("an SVG's geometry is its declared size, or its viewBox when the size is relative", () => {
  assert.deepStrictEqual(imageDimensions(svg('width="350" height="101"')), { width: 350, height: 101, format: "svg" });
  assert.deepStrictEqual(imageDimensions(svg('width="350px" height="101px"')), { width: 350, height: 101, format: "svg" });
  // A percentage width is a layout instruction, not a size. drainsurgeonaugusta
  // .com's mark is exactly this shape and its real proportions are in the viewBox.
  assert.deepStrictEqual(imageDimensions(svg('width="100%" viewBox="0 0 314.48 129.12"')), { width: 314.48, height: 129.12, format: "svg" });
  assert.strictEqual(imageDimensions(svg("")), null);
});

test("an unreadable file yields null rather than a fabricated size", () => {
  assert.strictEqual(imageDimensions(Buffer.from("not an image at all, really")), null);
  assert.strictEqual(imageDimensions(Buffer.alloc(0)), null);
  assert.strictEqual(imageDimensions(null), null);
  assert.strictEqual(imageDimensions(png(100, 100).subarray(0, 12)), null); // truncated fetch
});

// --- the gate ------------------------------------------------------------------

const verdict = (bytes, url = "") => classifyHeaderMark(bytes, { url });

test("every site icon the live mirrors shipped as a header logo is refused", () => {
  // The exact geometries measured on wss-ai.com mirrors, 2026-08-07.
  for (const [w, h, who] of [
    [50, 50, "Paschal"], [57, 57, "JAM Plumbing"], [90, 92, "Platero Parada"],
    [100, 92, "Knoxville Concrete Kings"], [141, 111, "Fix It All"],
    [150, 150, "The Local Guys"], [179, 179, "Monolith Tattoo"],
    [180, 180, "Crown / Edwards / JL / McIndy / Middletown / Noble / Royal Ink / Drain Surgeon"],
    [192, 192, "Diamond State"], [200, 200, "Cardinal"],
  ]) {
    const v = verdict(png(w, h));
    assert.strictEqual(v.ok, false, `${who} ${w}x${h} must not be a header mark`);
    assert.strictEqual(v.kind, "site_icon");
  }
});

test("a WordPress crop of the client's own mark is refused so the original can win", () => {
  // galliplumbingservices.com GPS-logo.png and bulldogrooter.com
  // BulldogLogo_296x114-150x58.png — both are their real logo, downscaled.
  for (const [w, h] of [[137, 72], [150, 58]]) {
    const v = verdict(png(w, h));
    assert.strictEqual(v.ok, false, `${w}x${h} is a thumbnail, not a header mark`);
    assert.strictEqual(v.kind, "thumbnail");
  }
});

test("every real mark the live mirrors shipped is KEPT — this is the regression that matters", () => {
  // Re-measured from the served bytes of 67 passing marks; these are the ones
  // closest to each threshold, plus a spread of the rest. A business with a real
  // wide logo must never be downgraded to our typography.
  const keep = [
    [165, 85], [182, 83], [203, 90], [212, 108], [218, 78], [221, 114], [230, 77],
    [232, 80], [290, 56], [300, 97], [308, 100], [882, 111], [1024, 517], [1352, 317],
    [1603, 300], [2401, 639],                       // wordmarks
    [300, 230], [400, 269], [415, 347], [763, 496], [1024, 1024], [1289, 1470],
    [1401, 1409], [1920, 1207],                     // genuine square emblems
  ];
  for (const [w, h] of keep) {
    const v = verdict(png(w, h));
    assert.strictEqual(v.ok, true, `${w}x${h} is a real mark and must be kept (got ${v.reason})`);
  }
});

test("the thresholds sit in the measured empty bands, so nothing straddles them", () => {
  // Wide: refused tops out at 150 wide, kept starts at 165.
  assert.strictEqual(verdict(png(WIDE_MIN_WIDTH - 1, 60)).ok, false);
  assert.strictEqual(verdict(png(WIDE_MIN_WIDTH, 60)).ok, true);
  // Square: refused tops out at 200, kept starts at 230.
  assert.strictEqual(verdict(png(HEADER_MIN_PX - 1, HEADER_MIN_PX - 1)).ok, false);
  assert.strictEqual(verdict(png(HEADER_MIN_PX, HEADER_MIN_PX)).ok, true);
  assert.ok(HEADER_MIN_PX > 200 && HEADER_MIN_PX < 230, "must fall between the site-icon ceiling and the smallest real emblem");
  assert.ok(WIDE_MIN_WIDTH > 150 && WIDE_MIN_WIDTH <= 165);
  assert.strictEqual(WORDMARK_MIN_RATIO, 1.6);
});

test("a vector mark is never refused for its shape — there is nothing to upscale", () => {
  // rivercityplumbing's mark is a 167x157 SVG: square, small, and perfect at any
  // size. Refusing it on geometry would throw away a real logo for nothing.
  const v = verdict(svg('width="167" height="157"'));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.kind, "vector");
});

test("geometry we FAILED to read passes — we refuse what is measured small, never what is unmeasured", () => {
  // AVIF, a truncated fetch, a format this parser does not cover. The direction
  // of error matters: a false refusal costs the client their real mark.
  const v = verdict(Buffer.from("\0\0\0 ftypavif................", "binary"));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.kind, "unknown");
  assert.strictEqual(v.width, null);
});

test("a tall mark is judged on its short edge, not on being taller than wide", () => {
  // buddytheplumber.com's mark is 1289x1470 — portrait, and entirely fine.
  assert.strictEqual(verdict(png(1289, 1470)).ok, true);
  assert.strictEqual(verdict(png(120, 400)).ok, false, "a narrow strip is not a header mark either");
});

// --- the two ranking fixes that feed the gate ---------------------------------

test("an http:// asset on the site's own https host is upgraded, and nothing else is", () => {
  // edwardsplumbingnc.com serves its real 1000x600 mark over http:// while the
  // page itself is https. guardedFetch refuses non-https, so the real logo was
  // skipped and the build shipped cropped-favicon-180x180.png.
  assert.strictEqual(
    upgradeToHttps("http://edwardsplumbingnc.com/wp-content/uploads/2022/08/logo-Edwards-Plumbing.png", "https://edwardsplumbingnc.com/"),
    "https://edwardsplumbingnc.com/wp-content/uploads/2022/08/logo-Edwards-Plumbing.png",
  );
  // A different origin is a different server: leave the scheme exactly as written.
  assert.strictEqual(
    upgradeToHttps("http://cdn.example.com/logo.png", "https://edwardsplumbingnc.com/"),
    "http://cdn.example.com/logo.png",
  );
  // If we do not trust THIS page over TLS we cannot claim to trust its assets.
  assert.strictEqual(
    upgradeToHttps("http://edwardsplumbingnc.com/logo.png", "http://edwardsplumbingnc.com/"),
    "http://edwardsplumbingnc.com/logo.png",
  );
  assert.strictEqual(upgradeToHttps("https://a.com/logo.png", "https://a.com/"), "https://a.com/logo.png");
});

test("rankLogoCandidates hands the caller the https form of the client's own mark", () => {
  const html = `<header><a href="/" class="logo"><img src="http://edwardsplumbingnc.com/wp-content/uploads/2022/08/logo-Edwards-Plumbing.png" alt="Edwards Plumbing NC, LLC"></a></header>
    <link rel="apple-touch-icon" href="https://edwardsplumbingnc.com/wp-content/uploads/2022/08/cropped-favicon-180x180.png">`;
  const urls = findLogoCandidates(html, "https://edwardsplumbingnc.com/", "Edwards Plumbing NC, LLC");
  assert.ok(urls[0].startsWith("https://"), `first candidate must be fetchable, got ${urls[0]}`);
  assert.match(urls[0], /logo-Edwards-Plumbing\.png$/);
});

test("a sized derivative is recognised as one, by path as well as by suffix", () => {
  assert.strictEqual(isSizedDerivative("https://x.com/BulldogLogo_296x114-150x58.png"), true);
  assert.strictEqual(isSizedDerivative("https://x.com/wp-content/uploads/elementor/thumbs/mark-abc.png"), true);
  // The ORIGINAL happens to carry its size in the stem. That is a name, not a
  // crop marker, and demoting it would be exactly backwards.
  assert.strictEqual(isSizedDerivative("https://x.com/BulldogLogo_296x114.png"), false);
  assert.strictEqual(isSizedDerivative("https://x.com/logo.png"), false);
});

test("a downscaled crop never outranks the full-size original it was cut from", () => {
  // bulldogrooter.com ships both in the same header link; the crop was seen
  // first and won the tie, so the mirror's header was a 150x58 mush.
  const html = `<header><a href="/" class="site-logo">
      <img src="https://bulldogrooter.com/wp-content/uploads/BulldogLogo_296x114-150x58.png" alt="Bulldog Rooter">
      <img src="https://bulldogrooter.com/wp-content/uploads/BulldogLogo_296x114.png" alt="Bulldog Rooter">
    </a></header>`;
  const urls = findLogoCandidates(html, "https://bulldogrooter.com/", "Bulldog Rooter");
  assert.match(urls[0], /BulldogLogo_296x114\.png$/, `full size must lead, got ${urls[0]}`);
});

test("a lone mark that happens to carry a size suffix is not demoted — there is nothing better", () => {
  const html = `<header><a href="/" class="logo"><img src="https://only.com/wp-content/uploads/mark-300x100.png" alt="Only Co"></a></header>`;
  const ranked = rankLogoCandidates(html, "https://only.com/", "Only Co");
  assert.strictEqual(ranked.candidates.length, 1);
  assert.match(ranked.candidates[0].url, /mark-300x100\.png$/);
});

test("the site icon still ranks below every real declaration — the ladder is unchanged", () => {
  const html = `<header><a href="/"><img class="custom-logo" src="/real-mark.png" alt="Acme"></a></header>
    <link rel="apple-touch-icon" href="/cropped-favicon-180x180.png">`;
  const ranked = rankLogoCandidates(html, "https://acme.com/", "Acme Plumbing");
  assert.match(ranked.candidates[0].url, /real-mark\.png$/);
  assert.strictEqual(ranked.candidates[0].signal, "class=custom-logo");
});

test("the refusal is about the SLOT, never about ownership — the bytes stay the client's", () => {
  // A refused icon is still their artwork and still a legitimate colour source;
  // lead-miner borrows its accent so the lead is never lost to this gate.
  const v = verdict(png(180, 180), "https://client.com/cropped-favicon-180x180.png");
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.url, "https://client.com/cropped-favicon-180x180.png");
  assert.strictEqual(v.width, 180);
  assert.match(v.reason, /below_216px_header_minimum/);
});

test("the same bytes always get the same verdict, whoever asks", () => {
  // web-brand re-exports capture-brand's classifier rather than reimplementing
  // it: the miner, the forge lane and the engine must not be able to disagree.
  const { classifyHeaderMark: viaWebBrand } = require("../lib/web-brand");
  assert.strictEqual(viaWebBrand, classifyHeaderMark);
  const bytes = png(180, 180);
  assert.strictEqual(createHash("sha256").update(bytes).digest("hex").length, 64);
  assert.deepStrictEqual(viaWebBrand(bytes, { url: "x" }), classifyHeaderMark(bytes, { url: "x" }));
});
