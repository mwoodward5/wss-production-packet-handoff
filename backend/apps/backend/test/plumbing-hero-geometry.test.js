"use strict";

// test/plumbing-hero-geometry.test.js — THE PLUMBING HERO GEOMETRY LAW
// (final-qa Class A, 2026-09; the 8 plumbing builds).
//
// The Class A defect was never an asset-gate failure: every emitted file
// hashed, every check reported green, and the owner was still shown a
// near-empty dark slab for the entire first viewport — a 100vh prehydration
// skeleton stamped INTO the hero (hero 1411px desktop / 1837px mobile), a
// source-less <video> whose poster was a 1,276-byte drawn SVG, and a page
// whose only h1 was the donor's own sentence promoted from a services
// sub-heading at y≈1961/2499 — below the fold on BOTH viewports.
//
// What the bytes could not prove, this file now holds on a FULL mirror()
// compile of the real plumbing-clean donor (real engine, files captured
// through the shared-publisher seam — never a fixture shortcut):
//
//   1. THE STATIC HERO CONTRACT — the served index.html carries exactly one
//      h1, the composed client headline inside the hero section, with no
//      prehydration skeleton and no static video element; the hero stage
//      img reference resolves to a shipped raster photograph.
//   2. THE PHOTO-SHIPS CONTRACT — every image reference on every emitted
//      page (and every onerror fallback target) resolves to bundle bytes
//      that sniff as an image; nothing root-absolute remains in img srcs.
//   3. THE GEOMETRY CONTRACT (render level, real chromium, never scrolled)
//      — at 1280x800 AND 390x844 the hero h1 and the primary CTA sit above
//      the fold, the stage photograph actually decodes, and zero /assets
//      requests 404. Skipped cleanly where chromium is not installed.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const BACKEND = path.join(__dirname, "..");

// The REAL donor library, not a fixture root: this suite exists to catch a
// regression in the shipped donor hero contract itself.
process.env.MIRROR_DONOR_ROOT = path.join(BACKEND, "donors-clean");
// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = process.env.MIRROR_CLIENT_ROOT
  || fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-plumbing-hero-"));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
if (!process.env.MIRROR_EVIDENCE_HMAC_KEY) process.env.MIRROR_EVIDENCE_HMAC_KEY = "plumbing-hero-test-evidence-key";
if (!process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY) {
  process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY = "plumbing-hero-geometry-test-key-000000";
}

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { sniffImage } = require("../lib/mirror-engine/hero-media");
const { assertPhotosShip } = require("../lib/mirror-engine/photo-ships");

const HOST = "wss-test-plumbing-hero-check.wss-ai.com";

async function compilePlumbing() {
  const captured = {};
  let routeMap = {};
  const serveFile = (url) => {
    const u = new URL(url);
    let rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    let buf = captured[rel];
    if (!buf) {
      const mapped = routeMap[u.pathname] || routeMap[`${u.pathname}/`];
      if (mapped) buf = captured[mapped];
    }
    const type = /\.html?$/i.test(rel) ? "text/html; charset=utf-8"
      : /\.css$/i.test(rel) ? "text/css; charset=utf-8"
      : /\.m?js$/i.test(rel) ? "application/javascript"
      : /\.json$/i.test(rel) ? "application/json"
      : "application/octet-stream";
    return {
      status: buf ? 200 : 404,
      headers: { "content-type": type },
      body: buf ? buf : Buffer.from("<!doctype html><title>404</title>"),
    };
  };

  const deps = {
    siteEditLog: async () => ({ ok: true, configured: false, fingerprint: "", active: [], revoked: [], legacy: [] }),
    resolveBrandAssets: async () => ({
      ok: true,
      logo: null,
      accent: null,
      primary: null,
      hashes: {},
      mediaMode: "housed",
      photos: [],
      heroVideo: null,
    }),
    sharedPublisher: {
      supportsTwoPhaseQc: true,
      stage: async (input) => {
        Object.assign(captured, input.files);
        routeMap = input.routeMap || {};
        return {
          ok: true,
          state: "staged",
          previewUrl: `https://${HOST}/`,
          proofIdentity: {
            site_id: "33333333-3333-4333-8333-333333333333",
            release_id: "44444444-4444-4444-8444-444444444444",
            build_hash: input.buildHash,
          },
          releaseEvidence: {
            evidence_schema: "shared-site-release-evidence-v1",
            site_id: "33333333-3333-4333-8333-333333333333",
            release_id: "44444444-4444-4444-8444-444444444444",
            build_hash: input.buildHash,
            canonical_host: HOST,
            manifest_path: "sites/x/releases/y/manifest.json",
            manifest_sha256: "b".repeat(64),
            generation: 1,
            deployment_env: "production",
          },
          openPreview: async () => ({
            origin: `https://${HOST}/`,
            fetch: async (url) => {
              const file = serveFile(url);
              return {
                ok: file.status === 200,
                status: file.status,
                headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? file.headers["content-type"] : null) },
                text: async () => file.body.toString("utf8"),
                arrayBuffer: async () => {
                  const ab = new ArrayBuffer(file.body.length);
                  new Uint8Array(ab).set(file.body);
                  return ab;
                },
              };
            },
            preparePage: async () => {},
          }),
        };
      },
      activate: async (receipt) => ({ ok: true, previewUrl: `https://${HOST}/`, proofIdentity: receipt.proofIdentity }),
    },
    renderCheck: async () => ({ status: "passed", problems: [] }),
    renderAudit: async () => ({ status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] }),
  };

  const result = await mirror({
    slug: "wss-test-plumbing-hero-check",
    donor: "plumbing-clean",
    facts: {
      business_name: "Hero Check Plumbing",
      industry: "plumbing",
      city: "Columbia",
      state: "SC",
      phone: "+18038848163",
    },
    content: {
      services: [
        { name: "Drain Cleaning", description: "Cabling and hydro-jetting with a camera pass afterwards." },
        { name: "Water Heaters", description: "Tank and tankless installs, repairs and flushes." },
      ],
      faqs: [
        { q: "Do you quote before you start?", a: "Yes — flat-rate pricing is quoted before the wrench comes out." },
      ],
      reviews: [
        { text: "On time, flat-rate, floor protected.", author: "Columbia homeowner" },
      ],
    },
    brand: { media_mode: "housed", photos: [] },
  }, { registry: createRegistry(), deps });

  assert.equal(result.ok, true, `plumbing compile failed: ${JSON.stringify(result.body).slice(0, 600)}`);
  assert.ok(Object.keys(captured).length >= 10, "the shared-publisher seam captured no files");
  return captured;
}

let compiled = null;
async function plumbing() {
  if (!compiled) compiled = await compilePlumbing();
  return compiled;
}

// ---------------------------------------------------------------------------
// 1. THE STATIC HERO CONTRACT (compile level)
// ---------------------------------------------------------------------------

test("the compiled plumbing hero is photo-first with exactly one static composed h1 and no slab machinery", { timeout: 240_000 }, async () => {
  const files = await plumbing();
  const html = files["index.html"].toString("utf8");

  // Exactly one h1, and it is the donor's own marked static headline.
  assert.equal((html.match(/<h1[\s>]/gi) || []).length, 1, "exactly one h1 in the served bytes");
  const h1 = /<h1[^>]*data-wss-hero-headline[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  assert.ok(h1, "the h1 is the donor's marked static hero headline");
  assert.match(h1[1], /Hero Check Plumbing/, "the composed client headline hydrates into the h1");
  assert.match(h1[1], /Plumbing in Columbia/, "the trade+market line is the h1's own text — not a donor sentence");

  // The h1 lives INSIDE the hero section (above any other section).
  const heroAt = html.search(/class="sect hero on-slab grain"/);
  const h1At = html.indexOf("<h1");
  assert.ok(heroAt > -1, "the hero section ships");
  assert.ok(h1At > heroAt && h1At - heroAt < 4000, "the h1 sits at the top of the hero section markup");

  // THE SLAB MACHINERY IS GONE.
  assert.ok(!html.includes("data-wss-prehydration-layout"),
    "no 100vh prehydration skeleton — it was the empty first viewport");
  assert.ok(!/<video[\s>]/i.test(html), "no static video element — a video layer mounts only when a clip ships");

  // The stage photograph is a real raster that SHIPS in this bundle.
  const heroImg = /<img[^>]*data-wss-hero-(?:poster|stage)[^>]*>|<div class="hero-visual[^"]*">\s*<img[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const imgTag = /<img[^>]*>/i.exec((/<div class="hero-visual[^"]*">([\s\S]*?)<\/div>/i.exec(html) || ["", ""])[1] || "");
  assert.ok(imgTag, "the hero visual card ships an img");
  const src = /src="([^"]+)"/i.exec(imgTag[0]);
  assert.ok(src, "the stage img carries a src");
  const rel = src[1].replace(/^\//, "").split("?")[0];
  assert.ok(files[rel] && sniffImage(files[rel]),
    `the stage reference resolves to shipped raster bytes (saw ${rel}: ${files[rel] ? "non-image bytes" : "missing"})`);
  assert.ok(!/\.svg$/i.test(rel), "the visible stage is a photograph, never the drawn placeholder");
  assert.ok(imgTag[0].includes("loading=\"eager\""), "the stage loads eager — it is the first-second surface");
});

// ---------------------------------------------------------------------------
// 2. THE PHOTO-SHIPS CONTRACT (compile level, every emitted page)
// ---------------------------------------------------------------------------

test("every emitted plumbing img reference and onerror target ships real image bytes", { timeout: 60_000 }, async () => {
  const files = await plumbing();
  const proof = assertPhotosShip({ files, fallbackRel: "assets/hero-cgi-flagship-Dla_-qtr.jpg" });
  assert.equal(proof.ok, true, `dangling photo refs: ${JSON.stringify(proof.dangling.slice(0, 8))}`);
  assert.ok(proof.refs >= 10, `the gallery/team/logo surfaces were actually asserted (saw ${proof.refs})`);

  // No root-absolute img srcs remain on any page: the exact Class A 404
  // shape under the path-based local viewer.
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.html$/i.test(rel)) continue;
    const html = buf.toString("utf8");
    for (const m of html.matchAll(/<img\b[^>]*\bsrc="(\/assets\/[^"]+)"/gi)) {
      assert.fail(`${rel} still ships a root-absolute img src: ${m[1]}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. THE GEOMETRY CONTRACT (render level, real chromium, never scrolled)
// ---------------------------------------------------------------------------

let chromiumWorks = null;
async function chromiumAvailable() {
  if (chromiumWorks !== null) return chromiumWorks;
  try {
    const { launchChromium } = require("../lib/serverless-chromium");
    const b = await launchChromium({ retries: 0 });
    await b.close();
    chromiumWorks = true;
  } catch {
    chromiumWorks = false;
  }
  return chromiumWorks;
}

function mime(rel) {
  if (/\.js$/i.test(rel)) return "text/javascript; charset=utf-8";
  if (/\.css$/i.test(rel)) return "text/css; charset=utf-8";
  if (/\.svg$/i.test(rel)) return "image/svg+xml";
  if (/\.png$/i.test(rel)) return "image/png";
  if (/\.jpe?g$/i.test(rel)) return "image/jpeg";
  if (/\.webp$/i.test(rel)) return "image/webp";
  if (/\.mp4$/i.test(rel)) return "video/mp4";
  if (/\.json$/i.test(rel)) return "application/json; charset=utf-8";
  if (/\.html$/i.test(rel)) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

async function serve(files) {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname).replace(/^\/+/, "");
    const rel = pathname || "index.html";
    const body = files[rel] || null;
    if (!body) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime(rel), "Cache-Control": "no-store" });
    res.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/` };
}

test("the compiled plumbing hero renders with the h1 and CTA above the fold at BOTH viewports (real chromium)", { timeout: 240_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const files = await plumbing();
  const { launchChromium } = require("../lib/serverless-chromium");
  const browser = await launchChromium({ retries: 0 });
  t.after(async () => { await browser.close(); });

  const served = await serve(files);
  t.after(async () => { await new Promise((resolve) => served.server.close(resolve)); });

  for (const vp of [{ label: "desktop", width: 1280, height: 800 }, { label: "mobile", width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const asset404s = [];
    page.on("response", (res) => {
      try {
        const u = new URL(res.url());
        if (u.pathname.startsWith("/assets/") && res.status() >= 400) asset404s.push(`${res.status()} ${u.pathname}`);
      } catch { /* ignore */ }
    });
    await page.goto(served.url, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2500); // the Class A defect was measured at rest; no scrolling, ever

    const state = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const hero = document.querySelector(".hero");
      const cta = document.querySelector(".hero .btn-primary");
      const stage = document.querySelector(".hero-visual img");
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height) };
      };
      const imgs = [...document.querySelectorAll("img")];
      return {
        h1: rect(h1),
        h1Text: h1 ? h1.textContent.trim().replace(/\s+/g, " ").slice(0, 80) : "",
        h1Visible: h1 ? getComputedStyle(h1).visibility !== "hidden" && getComputedStyle(h1).display !== "none" : false,
        hero: rect(hero),
        cta: rect(cta),
        stageOk: stage ? stage.complete && stage.naturalWidth > 1 : false,
        brokenEagerImgs: imgs.filter((i) => i.loading !== "lazy" && !(i.complete && i.naturalWidth > 1)).map((i) => i.getAttribute("src")).slice(0, 5),
        prehydrationSkeleton: Boolean(document.querySelector("[data-wss-prehydration-layout]")),
      };
    });

    assert.ok(state.h1, `${vp.label}: no h1 rendered`);
    assert.ok(state.h1Visible, `${vp.label}: the h1 is hidden`);
    assert.ok(state.h1.top < vp.height, `${vp.label}: h1 must sit above the fold (top=${state.h1.top}, viewport=${vp.height}) — the Class A defect put it at y≈1961/2499`);
    assert.ok(state.h1.top > 0 || state.h1.top <= vp.height, `${vp.label}: sane h1 geometry`);
    assert.match(state.h1Text, /Hero Check Plumbing/i, `${vp.label}: the h1 is the composed client headline`);
    assert.ok(state.cta && state.cta.top < vp.height, `${vp.label}: the hero call CTA must sit above the fold (top=${state.cta && state.cta.top})`);
    assert.equal(state.prehydrationSkeleton, false, `${vp.label}: the prehydration skeleton must never render`);
    assert.equal(state.stageOk, true, `${vp.label}: the hero stage photograph must actually decode`);
    assert.deepEqual(state.brokenEagerImgs, [], `${vp.label}: broken eager imgs: ${JSON.stringify(state.brokenEagerImgs)}`);
    assert.deepEqual(asset404s, [], `${vp.label}: /assets 404s at render: ${JSON.stringify(asset404s.slice(0, 8))}`);
    await page.close();
  }
});
