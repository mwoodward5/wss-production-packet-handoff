"use strict";

// test/compiled-site-skeleton.test.js — THE RENDER-REGRESSION LAW.
//
// (2026-09-03 emergency lane; the owner failed every post-#696 smoke2
// falcon build on sight.) The asset-level gates all stayed green while the
// owner was shown pages that looked like raw unstyled dumps: html.js set,
// zero failed requests, style.css serving real bytes. What the bytes could
// not prove — and what this file now holds — is that a COMPILED falcon
// build still carries the structural skeleton its stylesheet selects
// against, and that the painted page actually shows it.
//
// Three contracts, one law each:
//
//   1. THE SKELETON CONTRACT. A full mirror() compile of
//      roofing-falcon-clean (real donor bytes, real engine, files captured
//      through the shared-publisher seam — never a fixture shortcut) must
//      ship index.html whose main > section chain and per-section wrapper
//      classes match the falcon contract exactly: #top .hero, #services
//      .shell .section-head .card, #work .gallery figure a.shot (raster
//      hrefs — the GALLERY LAW), #process, #about, #reviews, #faq,
//      #contact, .site-footer — and the compiled assets/style.css must
//      still carry the rules those classes depend on. A donor markup
//      rewrite that renames a wrapper, drops a section id, or breaks the
//      class/CSS pairing fails HERE, at compile level, before any deploy
//      is spent.
//
//   2. THE NO-PROSPECT-HOTLINK CONTRACT (owner order, 2026-09-04). The
//      compile runs in media_mode:"origin" with five verified client
//      photographs — the lane that used to paint the prospect's origin
//      URLs into our galleries, before/after slider, hero poster and hero
//      ladder. Our mirror never hotlinks the prospect's domain: every
//      slot serves the family's bundled real photographs, zero prospect
//      bytes are housed, and the verified URL manifest the paid migration
//      houses from still ships.
//
//   3. THE CAPTURE-SAFETY CONTRACT. The falcon's scroll-reveal entrance
//      (.js .reveal { opacity: 0 } until IntersectionObserver fires) reads
//      as a BROKEN PAGE in every non-interactive renderer — full-page
//      screenshots, PDF prints, surface measures — because nothing ever
//      scrolls, the observer never fires below the fold, and the content
//      paints as blank bands between scattered words. That is the exact
//      artifact behind the "raw unstyled dump" owner read on otherwise
//      healthy builds. The donors now carry a bounded fallback that
//      reveals anything the observer has not reached; this test loads the
//      compiled page in real chromium and NEVER scrolls, then asserts
//      every .reveal carries .in and the painted styles are live (gallery
//      grid, card surfaces, themed type). Skipped cleanly where chromium
//      is not installed, matching the line-proof-shots fixture suite.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");

// The REAL donor library, not a fixture root: this suite exists to catch a
// regression in the shipped donor markup contract itself.
process.env.MIRROR_DONOR_ROOT = path.join(BACKEND, "donors-clean");
// GATE 4C: never stamp a test build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-skeleton-"));
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
if (!process.env.MIRROR_EVIDENCE_HMAC_KEY) process.env.MIRROR_EVIDENCE_HMAC_KEY = "skeleton-test-evidence-key";
// node --test supplies the fixture signing key via NODE_TEST_CONTEXT; plain
// `node --test test/compiled-site-skeleton.test.js` from a dev shell does too,
// but an explicit >=32-byte key keeps direct `node test/...` runs deterministic.
if (!process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY) {
  process.env.GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY = "compiled-site-skeleton-test-key-0000000000";
}

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

const HOST = "wss-test-skeleton-check-roofing.wss-ai.com";
const RASTER_RE = /\.(?:jpe?g|png|webp)$/i;

/** The compiled falcon, captured whole through the shared-publisher seam.
 * The fetch stub serves the captured bytes back through openPreview so the
 * engine's staged verification reads the same files this suite asserts on. */
async function compileFalcon() {
  const captured = {};
  let routeMap = {};
  const serveFile = (url) => {
    const u = new URL(url);
    let rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    let buf = captured[rel];
    if (!buf) {
      // The engine's deep-link verification probes SPA and authority routes;
      // the staged route map is the deploy's own answer for those paths.
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
    // ORIGIN-MODE BRAND FIXTURE (the no-hotlink law below): five "client"
    // photographs whose bytes were verified at build time but are NOT housed
    // — exactly the shape brand-assets returns for media_mode:"origin". The
    // prospect fixture domain must never reach the compiled page.
    resolveBrandAssets: async () => ({
      ok: true,
      logo: null,
      accent: null,
      primary: null,
      hashes: {},
      mediaMode: "origin",
      photos: [1, 2, 3, 4, 5].map((i) => ({
        url: `https://www.skeleton-prospect-fixture.com/assets/p${i}.jpg`,
        ok: true,
        sha256: require("node:crypto").createHash("sha256").update(`skeleton-photo-${i}`).digest("hex"),
        ext: "jpg",
        mime: "image/jpeg",
        originUrl: `https://www.skeleton-prospect-fixture.com/assets/final-p${i}.jpg`,
      })),
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
            site_id: "11111111-1111-4111-8111-111111111111",
            release_id: "22222222-2222-4222-8222-222222222222",
            build_hash: input.buildHash,
          },
          releaseEvidence: {
            evidence_schema: "shared-site-release-evidence-v1",
            site_id: "11111111-1111-4111-8111-111111111111",
            release_id: "22222222-2222-4222-8222-222222222222",
            build_hash: input.buildHash,
            canonical_host: HOST,
            manifest_path: "sites/x/releases/y/manifest.json",
            manifest_sha256: "a".repeat(64),
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
    slug: "wss-test-skeleton-check-roofing",
    donor: "roofing-falcon-clean",
    facts: {
      business_name: "Skeleton Check Roofing",
      industry: "roofing",
      city: "Austin",
      state: "TX",
      phone: "+15125550142",
    },
    content: {
      services: [
        { name: "Roof Replacement", description: "Full tear-off and rebuild in architectural shingle." },
        { name: "Storm & Hail Repair", description: "Insurance-documented storm restoration." },
      ],
      faqs: [
        { q: "Do you offer free inspections?", a: "Yes — every inspection is free and photographed." },
      ],
      reviews: [
        { text: "Clean crew, clean yard, honest quote.", author: "Austin homeowner" },
      ],
    },
    brand: {
      media_mode: "origin",
      photos: [1, 2, 3, 4, 5].map((i) => `https://www.skeleton-prospect-fixture.com/assets/p${i}.jpg`),
    },
  }, { registry: createRegistry(), deps });

  assert.equal(result.ok, true, `falcon compile failed: ${JSON.stringify(result.body).slice(0, 600)}`);
  assert.ok(Object.keys(captured).length >= 10, "the shared-publisher seam captured no files");
  return captured;
}

let compiled = null;
async function falcon() {
  if (!compiled) compiled = await compileFalcon();
  return compiled;
}

// ---------------------------------------------------------------------------
// 1. THE SKELETON CONTRACT (compile level)
// ---------------------------------------------------------------------------

test("the compiled falcon keeps the section chain and per-section wrappers the CSS selects against", { timeout: 240_000 }, async () => {
  const files = await falcon();
  const html = files["index.html"].toString("utf8");

  // The wrapper classes seen in the served pre-regression falcon build —
  // the exact contract between donor markup and assets/style.css.
  const sectionIds = [...html.matchAll(/<main[^>]*>([\s\S]*?)<\/main>/gi)]
    .flatMap((m) => [...m[1].matchAll(/<section[^>]*\bid="([a-z-]+)"/g)].map((s) => s[1]));  const coreOrder = ["top", "services", "work", "process", "about", "reviews", "faq", "contact"];
  let cursor = -1;
  for (const id of coreOrder) {
    const at = sectionIds.indexOf(id);
    assert.ok(at > cursor, `compiled main>section chain lost #${id} (saw: ${sectionIds.join(", ")})`);
    cursor = at;
  }

  const section = (id) => {
    const m = html.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`, "i"));
    assert.ok(m, `section #${id} missing from compiled html`);
    return m[0];
  };

  assert.match(section("top"), /class="hero[^"]*"/, "the hero wrapper class must survive compilation");
  for (const id of ["services", "work", "process", "about", "reviews", "faq", "contact"]) {
    assert.match(section(id), /class="shell"/, `#${id} lost its .shell wrapper`);
  }
  assert.match(section("services"), /class="section-head/, "#services lost .section-head");
  assert.match(section("services"), /class="card/, "#services lost its .card articles");
  assert.match(html, /<footer[^>]*class="site-footer"/, "the site footer wrapper must survive");

  // THE GALLERY LAW rides along with the structure: every gallery shot is a
  // lightbox anchor around a real bundled photograph.
  const gallery = section("work");
  assert.match(gallery, /class="gallery"/, "#work lost its .gallery grid wrapper");
  const shots = [...gallery.matchAll(/<a class="shot" data-lb href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(shots.length >= 5, `#work gallery lost its photos (saw ${shots.length})`);
  for (const href of shots) {
    assert.match(href, RASTER_RE, `gallery shot must stay a raster photograph: ${href}`);
    assert.ok(files[href], `gallery photograph must ship in the build: ${href}`);
  }
});

test("the compiled stylesheet still carries the rules the skeleton depends on", { timeout: 240_000 }, async () => {
  const files = await falcon();
  const html = files["index.html"].toString("utf8");
  const css = files["assets/style.css"].toString("utf8");

  assert.match(html, /<link rel="stylesheet" href="assets\/style\.css">/, "the page must still reference its stylesheet");
  for (const rule of [".gallery", ".shell", ".section-head", ".card", ".js .reveal", ".js .reveal.in"]) {
    assert.ok(css.includes(rule), `compiled style.css lost the ${rule} rules the markup is styled by`);
  }
});

test("the donors ship the capture-safety reveal fallback (the .reveal contract can never strand content hidden)", () => {
  const donorsRoot = path.join(BACKEND, "donors-clean");
  for (const fam of fs.readdirSync(donorsRoot, { withFileTypes: true })) {
    if (!fam.isDirectory()) continue;
    const htmlPath = path.join(donorsRoot, fam.name, "index.html");
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, "utf8");
    if (!html.includes("querySelectorAll('.reveal')")) continue; // family has no reveal wiring
    assert.ok(
      html.includes("querySelectorAll('.reveal:not(.in)')"),
      `${fam.name}: scroll-reveal wiring present but the capture-safety fallback is gone — full-page captures of this family read as broken pages`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. THE NO-PROSPECT-HOTLINK CONTRACT (compile level, owner order 2026-09-04)
// ---------------------------------------------------------------------------

test("law: the compiled mirror hotlinks ZERO prospect-domain media — the family's bundled photographs serve every slot", { timeout: 240_000 }, async () => {
  const files = await falcon();

  // The compile above runs in media_mode:"origin" with five verified client
  // photographs — the exact lane that used to paint the prospect's origin
  // into our <img> tags (galleries, before/after slider, hero poster, hero
  // ladder string constants). No surface a visitor's browser LOADS may carry
  // the prospect's domain. (assets/wss-origin-media.json is deliberately
  // exempt below: it is build metadata for the paid migration, never
  // fetched by the page.)
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.(html|js|css)$/i.test(rel)) continue;
    const text = buf.toString("utf8");
    assert.ok(!text.includes("skeleton-prospect-fixture.com"),
      `origin mode leaked the prospect's origin into ${rel} — our mirror never hotlinks the prospect's domain`);
  }

  // And the page actually references the family's bundled media by its local
  // slot paths (both bare and absolute forms are legal reference shapes).
  const html = files["index.html"].toString("utf8");
  const shots = [...html.matchAll(/<a class="shot" data-lb href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(shots.length >= 5, `#work gallery lost its photos (saw ${shots.length})`);
  for (const href of shots) {
    assert.ok(files[href], `gallery photograph must ship in the build: ${href}`);
  }

  // THE ECONOMICS SURVIVE: origin mode still houses zero prospect bytes and
  // still records the verified URL manifest the paid migration houses from.
  const manifestRaw = files["assets/wss-origin-media.json"];
  assert.ok(manifestRaw, "origin mode still writes assets/wss-origin-media.json for the paid migration");
  const manifest = JSON.parse(manifestRaw.toString("utf8"));
  assert.equal(manifest.media_mode, "origin");
  assert.ok(manifest.entries.length >= 1, "at least one verified photograph is recorded for migration");
  for (const entry of manifest.entries) {
    assert.match(entry.slot, /^assets\/[\w.-]+$/);
    assert.match(entry.url, /^https:\/\/www\.skeleton-prospect-fixture\.com\//);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  }
});

// ---------------------------------------------------------------------------
// 3. THE CAPTURE-SAFETY CONTRACT (render level, real chromium)
// ---------------------------------------------------------------------------

let chromiumWorks = null;
async function chromiumAvailable() {
  if (chromiumWorks !== null) return chromiumWorks;
  try {
    const { launchChromium } = require("../lib/serverless-chromium");
    const browser = await launchChromium();
    await browser.close();
    chromiumWorks = true;
  } catch {
    chromiumWorks = false;
  }
  return chromiumWorks;
}

test("the compiled falcon renders styled and fully revealed WITHOUT any scrolling (real chromium)", { timeout: 180_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const files = await falcon();

  // Serve the captured build exactly as the deploy would.
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname.replace(/^\/+/, ""));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const buf = files[rel];
    if (!buf) { res.writeHead(404); res.end("missing"); return; }
    const type = /\.html?$/i.test(rel) ? "text/html; charset=utf-8"
      : /\.css$/i.test(rel) ? "text/css; charset=utf-8"
      : /\.m?js$/i.test(rel) ? "application/javascript"
      : rel.endsWith(".mp4") ? "video/mp4"
      : "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": buf.length });
    res.end(buf);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}/`;

  const { launchChromium } = require("../lib/serverless-chromium");
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message || e)));

    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // NO scroll — that is the point. Wait past the donors' capture-safety
    // window (1600ms) plus paint, as a full-page capture tool would.
    await page.waitForTimeout(2_600);

    const report = await page.evaluate(() => {
      const q = (sel) => document.querySelector(sel);
      const cs = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop) : "NO-ELEMENT");
      const reveals = [...document.querySelectorAll(".reveal")];
      return {
        revealTotal: reveals.length,
        revealStillHidden: reveals.filter((el) => !el.classList.contains("in")).length,
        galleryDisplay: cs(q("#work .gallery"), "display"),
        figureBackground: cs(q("#work figure"), "background-color"),
        shellMaxWidth: cs(q("#work .shell"), "max-width"),
        bodyFontFamily: cs(document.body, "font-family"),
        sectionCount: document.querySelectorAll("main > section").length,
        sectionHeights: [...document.querySelectorAll("main > section")].map((s) => Math.round(s.getBoundingClientRect().height)),
        htmlClass: document.documentElement.className,
      };
    });

    assert.deepEqual(pageErrors, [], "the compiled page must not throw");
    assert.match(report.htmlClass, /\bjs\b/, "the shell's js class must land");
    assert.ok(report.revealTotal >= 10, `expected the falcon's reveal population, saw ${report.revealTotal}`);
    assert.equal(report.revealStillHidden, 0,
      "capture-safety regression: .reveal elements stayed hidden without scrolling — this is the raw-dump owner read");
    assert.equal(report.galleryDisplay, "grid", "the gallery must paint as a grid");
    assert.notEqual(report.figureBackground, "rgba(0, 0, 0, 0)", "gallery figures must paint a surface");
    assert.notEqual(report.shellMaxWidth, "none", "the .shell wrapper must be width-constrained");
    assert.ok(!/^(serif|Times)/i.test(report.bodyFontFamily.trim()), `themed typography missing (font-family: ${report.bodyFontFamily})`);
    assert.ok(report.sectionCount >= 7, `the compiled page lost sections (saw ${report.sectionCount})`);
    assert.ok(report.sectionHeights.every((h) => h > 40), `a section collapsed below legibility: ${report.sectionHeights}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
});
