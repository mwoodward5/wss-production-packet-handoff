"use strict";

// test/hero-stock-suppression.test.js — THE A3 HERO DOUBLE-RENDER FIX.
//
// (Audit A3, 2026-09-03 — Earth Power, hvac-premier, verified live with a
// cold-context chromium repro.) A build with a client PHOTO hero shipped TWO
// stacked presentations on section.hero: (A) the engine hero-wash photo + the
// donor split-hero poster tile; then (B) the deferred bundle mounted
// <video data-hero-video hidden>, the ladder walker set src to the donor's
// 1.2MB GENERIC STOCK fallback clip (no client clip exists), and on
// loadeddata (~2s cold) the stock video hard-cut full-bleed over the client
// photo hero. The owner sees the hero "bug out and swap to the older hero".
//
// THE LAW THIS FILE HOLDS:
//   1. When the client's photograph owns the hero (the wash painted) and no
//      client clip shipped, the stock fallback rung is SUPPRESSED: the ladder
//      island ships sources:[] with an explicit, non-failing suppressed
//      verdict. The photo hero IS the hero — one stable state, no swap.
//   2. A build with no photo hero keeps the stock rung (it is that build's
//      only motion surface) — the ladder must stay armed exactly as before.
//   3. A real client clip always outranks the suppression — the ladder stays
//      intact (client rung first, stock fallback under it).
//   4. The runtime honors the suppression: no video mount survives, nothing
//      arms, the stock clip is never fetched (proven on real chromium).
//   5. #707's loadeddata arming law is untouched — the no-photo control still
//      arms the stock clip only when a full first frame exists.
//   6. THE TILE (A3(C)): a landscape client poster is not cover-cropped into
//      the donors' 4:5 portrait .hero-visual tile — the donor's own mobile
//      16/10 ratio is promoted to all viewports and the img width/height
//      attributes tell the browser the truth. Portrait keeps the 4:5 design.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const BACKEND = path.join(__dirname, "..");

// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-hero-suppression-"));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
if (!process.env.MIRROR_EVIDENCE_HMAC_KEY) process.env.MIRROR_EVIDENCE_HMAC_KEY = "hero-suppression-test-evidence-key";
if (!process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY) {
  process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY = "hero-suppression-test-release-key-000000000";
}

const { mirror, finalizeHeroArtifact, applyHeroTileAspect } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { siteEditLog } = require("../lib/site-edit-log");
const { launchChromium } = require("../lib/serverless-chromium");

const MANIFEST = {
  hero_video: {
    client_video_path: "assets/hero-client-hvac.mp4",
    wss_fallback_clip_path: "hero/hero-loop.mp4",
  },
};

const ISLAND = '<!doctype html><html><head><title>HVAC</title></head><body><section class="hero"></section>'
  + '<script type="application/json" id="hero-video-ladder">{"sources":["assets/hero-client-hvac.mp4","hero/hero-loop.mp4"]}</script>'
  + "</body></html>";

function ladderOf(html) {
  const m = String(html).match(/<script[^>]+id=["']hero-video-ladder["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ---------------------------------------------------------------------------
// 1-3. THE ENGINE LAW — suppression fires ONLY for stock-fallback-with-photo
// ---------------------------------------------------------------------------
test("(a) photo hero + no client clip: the stock fallback rung is suppressed — empty ladder, passed status, named verdict", () => {
  const files = {
    "index.html": Buffer.from(ISLAND),
    "hero/hero-loop.mp4": Buffer.from("fallback-bytes"),
  };
  const out = finalizeHeroArtifact({
    files,
    manifest: MANIFEST,
    heroVideoSlot: MANIFEST.hero_video.client_video_path,
    heroVideoPlaced: 0,
    heroWashApplied: true,
  });
  // Non-failing: the truth gate reads hero_provenance.status, so the
  // deliberate empty ladder must read "passed", never "failed".
  assert.equal(out.status, "passed", "the suppressed ladder is the design, not a defect");
  assert.deepEqual(out.sources, [], "the shipped ladder carries no rung at all");
  assert.equal(out.source_count, 0);
  assert.equal(out.provenance, "suppressed_for_client_photo_hero");
  assert.equal(out.stock_fallback_suppressed, true);
  assert.equal(out.suppressed_fallback, "hero/hero-loop.mp4", "the audit names the rung that was withheld");
  assert.equal(out.path, null);
  assert.equal(out.sha256, null);
  assert.equal(out.reason, undefined, "a suppressed ladder carries no failure reason");
  // The page itself: the island is rewritten to the empty ladder, the walker
  // never arms (its empty-rungs return), and the engine fail-safe net (with
  // the A3 empty-ladder mount removal) is stamped beside it.
  assert.deepEqual(ladderOf(files["index.html"].toString("utf8")).sources, []);
  const html = files["index.html"].toString("utf8");
  assert.ok(html.includes("data-wss-hero-failsafe"), "the fail-safe net ships beside the suppressed ladder");
  assert.ok(/rungs&&rungs\.length===0/.test(html), "the net's empty-ladder branch is present");
});

test("(b) no photo hero: the stock fallback rung still ships — the no-photo build keeps its only motion surface", () => {
  const files = {
    "index.html": Buffer.from(ISLAND),
    "hero/hero-loop.mp4": Buffer.from("fallback-bytes"),
  };
  const out = finalizeHeroArtifact({
    files,
    manifest: MANIFEST,
    heroVideoSlot: MANIFEST.hero_video.client_video_path,
    heroVideoPlaced: 0,
    heroWashApplied: false,
  });
  assert.equal(out.status, "passed");
  assert.deepEqual(out.sources, ["hero/hero-loop.mp4"]);
  assert.equal(out.provenance, "wss_static_fallback");
  assert.equal(out.stock_fallback_suppressed, undefined);
  assert.deepEqual(ladderOf(files["index.html"].toString("utf8")).sources, ["hero/hero-loop.mp4"],
    "the walker still arms the stock clip on a build with nothing to protect");
});

test("(c) client clip present: the ladder stays intact — suppression never fires when a real rung exists", () => {
  const files = {
    "index.html": Buffer.from(ISLAND),
    "assets/hero-client-hvac.mp4": Buffer.from("client-clip"),
    "hero/hero-loop.mp4": Buffer.from("fallback-bytes"),
  };
  const out = finalizeHeroArtifact({
    files,
    manifest: MANIFEST,
    heroVideoSlot: MANIFEST.hero_video.client_video_path,
    heroVideoPlaced: 1,
    heroWashApplied: true,
  });
  assert.equal(out.status, "passed");
  assert.deepEqual(out.sources, ["assets/hero-client-hvac.mp4", "hero/hero-loop.mp4"],
    "a photo hero with a real client clip keeps the full ladder — the clip outranks the wash");
  assert.equal(out.provenance, "verified_client_media");
  assert.deepEqual(ladderOf(files["index.html"].toString("utf8")).sources,
    ["assets/hero-client-hvac.mp4", "hero/hero-loop.mp4"]);
});

test("the fail-safe net leaves a POPULATED ladder completely alone (edit-time clip injection keeps its ladder)", () => {
  const files = {
    "index.html": Buffer.from(ISLAND),
    "hero/hero-loop.mp4": Buffer.from("fallback-bytes"),
  };
  finalizeHeroArtifact({
    files,
    manifest: MANIFEST,
    heroVideoSlot: MANIFEST.hero_video.client_video_path,
    heroVideoPlaced: 0,
    heroWashApplied: false,
  });
  const html = files["index.html"].toString("utf8");
  // The net is present (it is stamped beside EVERY declared ladder) and its
  // removal branch is strictly `sources parses to an empty array` — a page
  // whose island carries rungs never triggers it.
  assert.ok(html.includes("data-wss-hero-failsafe"));
  assert.match(html, /Array\.isArray\(p\.sources\)/);
  assert.match(html, /rungs&&rungs\.length===0/);
  assert.deepEqual(ladderOf(html).sources, ["hero/hero-loop.mp4"]);
});

// ---------------------------------------------------------------------------
// 6. THE TILE — landscape posters keep their composition; portrait keeps the
//    4:5 design tile (donor CSS law, applied engine-side from real bytes)
// ---------------------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** A REAL, chromium-decodable solid-color PNG at exact dimensions. */
function solidPng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: width }, () => Buffer.from([r, g, b])))]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const TILE_HTML = (src, w, h) => Buffer.from(
  `<!doctype html><html><body>
    <section class="hero"><div class="hero-copy"><h1>Heating and cooling</h1></div>
    <div class="hero-visual reveal">
      <img src="${src}" alt="Technician at a condenser" width="${w}" height="${h}" loading="eager" decoding="async">
    </div></section>
  </body></html>`,
);

test("(d) landscape poster: the tile adopts the donor's own 16/10 ratio and the img attributes tell the truth", () => {
  const files = {
    "index.html": TILE_HTML("assets/hero-poster.png", 800, 1000),
    "assets/hero-poster.png": solidPng(620, 410, [46, 88, 148]), // Earth Power's real poster shape
    "assets/style.css": Buffer.from(".hero-visual{aspect-ratio:4/5}@media (max-width:900px){.hero-visual{aspect-ratio:16/10}}"),
  };
  const report = applyHeroTileAspect({ files });
  assert.equal(report.applied, true);
  assert.equal(report.landscape, true);
  assert.deepEqual(report.photo, { width: 620, height: 410 });
  assert.equal(report.pages, 1);
  const html = files["index.html"].toString("utf8");
  assert.match(html, /width="620"/, "the img width attribute is the real pixel width");
  assert.match(html, /height="410"/, "the img height attribute is the real pixel height");
  assert.ok(!html.includes('width="800"'), "the stale donor width is gone (no false aspect reservation)");
  const css = files["assets/style.css"].toString("utf8");
  assert.match(css, /\.hero-visual \{ aspect-ratio: 16 \/ 10; \}/,
    "the appended override promotes the donor's own mobile ratio to all viewports");
  // Source order: the override lands AFTER the donor rules so the cascade
  // resolves to 16/10 at every viewport.
  assert.ok(css.indexOf(".hero-visual { aspect-ratio: 16 / 10; }") > css.indexOf("aspect-ratio:4/5"));
});

test("(d) portrait poster: the 4:5 design tile ships untouched", () => {
  const files = {
    "index.html": TILE_HTML("assets/hero-poster.png", 800, 1000),
    "assets/hero-poster.png": solidPng(800, 1000, [46, 88, 148]),
    "assets/style.css": Buffer.from(".hero-visual{aspect-ratio:4/5}"),
  };
  const report = applyHeroTileAspect({ files });
  assert.equal(report.applied, false);
  assert.equal(report.landscape, false);
  assert.equal(report.pages, 0);
  assert.ok(!files["assets/style.css"].toString("utf8").includes("16 / 10"),
    "a portrait poster keeps the donor's portrait design tile");
  assert.ok(files["index.html"].toString("utf8").includes('width="800"'),
    "portrait attributes were already truthful and stay untouched");
});

test("(d) unmeasurable bytes (the donor's own svg tile art): no adaptation, no error", () => {
  const files = {
    "index.html": TILE_HTML("assets/hero-poster.svg", 800, 1000),
    "assets/hero-poster.svg": Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    "assets/style.css": Buffer.from(".hero-visual{aspect-ratio:4/5}"),
  };
  const report = applyHeroTileAspect({ files });
  assert.equal(report.applied, false);
  assert.equal(report.landscape, false);
});

// ---------------------------------------------------------------------------
// THE FULL BUILD — the wiring is real: a photo-hero hvac-premier compile
// suppresses the stock rung and adapts the tile; a no-photo compile does not
// ---------------------------------------------------------------------------
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

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

function buildRequest({ slug, photos }) {
  return {
    slug,
    donor: "hvac-premier",
    facts: {
      business_name: "Earth Power AC and Heat Spring",
      industry: "hvac",
      city: "Spring",
      state: "TX",
      phone: "(281) 555-0139",
    },
    hero: { headline: "AC repair in Spring, TX" },
    content: {
      services: [
        { name: "AC Replacement", description: "Right-sized variable-capacity systems installed in one day." },
      ],
      reviews: [
        { text: "Honest quote, cold house, clean yard.", author: "Spring homeowner" },
      ],
    },
    brand: { photos },
  };
}

async function compilePhotoHero() {
  const photo = {
    url: "https://fixture-earthpower.example/hero.png",
    ok: true,
    sha256: sha("earthpower-hero"),
    ext: "png",
    mime: "image/png",
    bytes: solidPng(620, 410, [46, 88, 148]), // the landscape client poster
  };
  const h = makeHarness({ resolve: fakeResolve({ photos: [photo] }) });
  const res = await mirror(buildRequest({
    slug: "wss-test-earth-power-hero-suppression-photo",
    photos: [photo.url],
  }), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `photo-hero build was refused: ${JSON.stringify(res.body).slice(0, 800)}`);
  return { files: h.files(), report: res.body };
}

async function compileNoPhoto() {
  const h = makeHarness({ resolve: fakeResolve({ photos: [] }) });
  const res = await mirror(buildRequest({
    slug: "wss-test-earth-power-hero-suppression-nophoto",
    photos: [],
  }), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `no-photo build was refused: ${JSON.stringify(res.body).slice(0, 800)}`);
  return { files: h.files(), report: res.body };
}

let photoBuild = null;
async function photoHero() {
  if (!photoBuild) photoBuild = await compilePhotoHero();
  return photoBuild;
}
let noPhotoBuild = null;
async function noPhoto() {
  if (!noPhotoBuild) noPhotoBuild = await compileNoPhoto();
  return noPhotoBuild;
}

test("full build, photo hero: the wash paints, the island ships empty, the verdict is suppressed — and the gate passes", { timeout: 240_000 }, async () => {
  const { files, report } = await photoHero();
  // The wash really painted (the precondition the suppression keys on).
  assert.equal(report.checks.brand.hero_wash.applied, true,
    `the wash must apply for the suppression to be legitimate (got: ${report.checks.brand.hero_wash.reason})`);
  // The ladder: empty, suppressed, non-failing.
  const html = files["index.html"].toString("utf8");
  assert.deepEqual(ladderOf(html).sources, [], "the compiled photo-hero page ships an empty ladder");
  const hv = report.checks.brand.hero_video;
  assert.equal(hv.stock_fallback_suppressed, true);
  assert.equal(hv.suppressed_fallback, "hero/hero-loop.mp4");
  assert.equal(hv.provenance, "suppressed_for_client_photo_hero");
  assert.equal(report.checks.hero_provenance.status, "passed",
    "the truth gate must read the deliberate empty ladder as passed");
  assert.equal(report.checks.critical_visual.status, "passed");
  // Nothing on the page fetches the stock clip: no src, no <source>, no path
  // reference outside the (data-only) island and the donor's own fallback
  // narration comments.
  assert.doesNotMatch(html, /(?:src|href)="[^"]*hero-loop\.mp4"/,
    "no markup may point at the suppressed stock clip");
  // The fail-safe net (with the empty-ladder mount removal) is stamped.
  assert.ok(html.includes("data-wss-hero-failsafe"));
  assert.match(html, /rungs&&rungs\.length===0/);
  // The clip bytes still ship in the tree (they are the donor's owned asset
  // and the no-photo fallback for edit-time injection) — the PAGE simply
  // never arms them.
  assert.ok(files["hero/hero-loop.mp4"], "the donor's owned clip still ships as an asset");
  // #707's loadeddata arming law is untouched in the shipped walker.
  assert.match(html, /loadeddata/, "#707's loadeddata arming stays in the walker");
});

test("full build, photo hero: the landscape poster tile ships adapted (16/10 + true attributes)", { timeout: 240_000 }, async () => {
  const { files, report } = await photoHero();
  const html = files["index.html"].toString("utf8");
  // The tile img: the client photo (the .svg slot took the photograph at its
  // own stem), carrying its REAL dimensions.
  const tileImg = html.match(/class="hero-visual[^"]*"[^>]*>\s*<img\b[^>]*>/);
  assert.ok(tileImg, "the split-hero tile ships");
  assert.match(tileImg[0], /src="assets\/hero-poster\.png"/, "the tile paints the client photograph");
  assert.match(tileImg[0], /width="620"/, "the tile img tells the browser the true width");
  assert.match(tileImg[0], /height="410"/, "the tile img tells the browser the true height");
  // The stylesheet: the donor's own 16/10 promoted to all viewports.
  const css = files["assets/style.css"].toString("utf8");
  assert.match(css, /\.hero-visual \{ aspect-ratio: 16 \/ 10; \}/,
    "the landscape tile override is appended at the last-css seam");
  const tileReport = report.checks.brand.hero_tile_aspect;
  assert.ok(tileReport && tileReport.applied === true && tileReport.landscape === true,
    "the build report records the tile adaptation");
  assert.deepEqual(tileReport.photo, { width: 620, height: 410 });
});

test("full build, no photo: the island keeps the stock rung and the walker contract is unchanged", { timeout: 240_000 }, async () => {
  const { files, report } = await noPhoto();
  assert.equal(report.checks.brand.hero_wash.applied, false,
    "the control build has no photo hero (nothing to protect)");
  const html = files["index.html"].toString("utf8");
  assert.deepEqual(ladderOf(html).sources, ["hero/hero-loop.mp4"],
    "the no-photo build still arms the WSS-owned fallback clip");
  assert.equal(report.checks.hero_provenance.status, "passed");
  assert.equal(report.checks.brand.hero_video.provenance, "wss_static_fallback");
  assert.equal(report.checks.brand.hero_video.stock_fallback_suppressed, undefined);
  // No tile adaptation: the donor's svg art is unmeasurable, portrait contract intact.
  assert.doesNotMatch(files["assets/style.css"].toString("utf8"), /aspect-ratio: 16 \/ 10; \}\s*$/);
});

// ---------------------------------------------------------------------------
// 4-5. THE RUNTIME — real chromium, cold-context page loads of both builds
// ---------------------------------------------------------------------------
function serveFiles(files) {
  const requested = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    let rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const buf = files[rel];
    requested.push(u.pathname);
    const type = /\.html?$/i.test(rel) ? "text/html; charset=utf-8"
      : /\.css$/i.test(rel) ? "text/css"
      : /\.m?js$/i.test(rel) ? "application/javascript"
      : /\.json$/i.test(rel) ? "application/json"
      : /\.png$/i.test(rel) ? "image/png"
      : /\.svg$/i.test(rel) ? "image/svg+xml"
      : /\.mp4$/i.test(rel) ? "video/mp4"
      : "application/octet-stream";
    if (!buf) {
      res.statusCode = 404;
      res.end("missing");
      return;
    }
    res.setHeader("content-type", type);
    res.end(buf);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}/`,
        requested: () => requested,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const SNAP = () => {
  const v = document.querySelector("video[data-hero-video]");
  const anyVideo = document.querySelectorAll("video").length;
  const tile = document.querySelector(".hero-visual");
  const hero = document.querySelector("section.hero");
  return {
    anyVideo,
    video: v ? {
      exists: true,
      hidden: v.hidden,
      ready: v.getAttribute("data-hero-ready"),
      armed: v.getAttribute("data-hero-armed"),
      dead: v.getAttribute("data-hero-dead"),
      src: v.getAttribute("src"),
      readyState: v.readyState,
    } : { exists: false },
    tile: tile ? {
      exists: true,
      aspect: getComputedStyle(tile).aspectRatio,
      imgNatural: (() => { const i = tile.querySelector("img"); return i ? [i.naturalWidth, i.naturalHeight] : null; })(),
    } : { exists: false },
    heroBackground: hero ? getComputedStyle(hero).backgroundImage.slice(0, 160) : null,
  };
};

async function chromiumAvailable() {
  try {
    const browser = await launchChromium();
    await browser.close().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

test("(e) RUNTIME, photo hero: no video mount survives, nothing arms, the stock clip is never fetched — the photo IS the hero", { timeout: 180_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const { files } = await photoHero();
  const site = await serveFiles(files);
  let browser;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(site.baseUrl, { waitUntil: "load", timeout: 30_000 });
    // The A3 cadence: the defect landed at ~2s cold. Snapshot past it.
    const snaps = [];
    for (const wait of [600, 1400, 3000]) {
      await page.waitForTimeout(wait);
      snaps.push(await page.evaluate(SNAP));
    }
    for (const [i, s] of snaps.entries()) {
      assert.equal(s.video.exists, false, `snapshot ${i}: the dormant hero-video mount must be removed`);
      assert.equal(s.anyVideo, 0, `snapshot ${i}: the page must carry no video at all (the render gate's poll sees none)`);
      assert.ok(s.tile.exists, `snapshot ${i}: the split-hero tile is the standing hero surface`);
      assert.equal(s.tile.aspect, "16 / 10", `snapshot ${i}: the landscape poster tile renders at the adapted ratio`);
    }
    // The client photo hero painted: the wash carries the client photograph.
    assert.ok(snaps[snaps.length - 1].heroBackground.includes("hero-wash"),
      "the hero surface is the wash over the client's photograph");
    assert.deepEqual(snaps[snaps.length - 1].tile.imgNatural, [620, 410],
      "the tile decoded the real client photograph");
    // Zero network pull of the stock clip — the suppression's whole point.
    const clipFetches = site.requested().filter((p) => p.includes("hero-loop.mp4"));
    assert.deepEqual(clipFetches, [], "the suppressed stock clip must never be fetched");
    // And the island the page shipped was the empty one.
    const island = await page.evaluate(() => {
      const el = document.getElementById("hero-video-ladder");
      try { return JSON.parse(el ? el.textContent : "{}"); } catch { return null; }
    });
    assert.deepEqual(island && island.sources, []);
    await page.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
    await site.close();
  }
});

test("(e) RUNTIME, no photo: the ladder still arms the stock clip on loadeddata — #707's law intact", { timeout: 180_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const { files } = await noPhoto();
  const site = await serveFiles(files);
  let browser;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(site.baseUrl, { waitUntil: "load", timeout: 30_000 });
    // Poll to the armed verdict, the walker's own law: loadeddata (a real
    // first frame), then hidden=false + data-hero-ready.
    const deadline = Date.now() + 20_000;
    let armed = null;
    while (Date.now() < deadline) {
      armed = await page.evaluate(() => {
        const v = document.querySelector("video[data-hero-video]");
        if (!v) return { exists: false };
        return {
          exists: true,
          src: v.getAttribute("src"),
          ready: v.getAttribute("data-hero-ready"),
          armedAttr: v.getAttribute("data-hero-armed"),
          readyState: v.readyState,
        };
      });
      if (armed.exists && armed.ready === "1") break;
      await page.waitForTimeout(400);
    }
    assert.ok(armed && armed.exists, "the no-photo build mounts its hero video");
    // CLASS D path law (final-qa 2026-09-04): the walker arms the island's
    // rung VERBATIM — site-relative, never the old `"/"+src` absolutization
    // that 404'd under any mount-below-prefix server.
    assert.equal(armed.src, "hero/hero-loop.mp4", "the walker armed the WSS-owned fallback rung, site-relative");
    assert.equal(armed.ready, "1", "data-hero-ready set — armed only once a first frame existed (loadeddata, #707)");
    assert.ok(site.requested().some((p) => p.includes("hero-loop.mp4")),
      "the stock clip is served and fetched on the no-photo build");
    await page.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
    await site.close();
  }
});
