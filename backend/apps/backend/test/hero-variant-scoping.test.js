"use strict";

// test/hero-variant-scoping.test.js — THE FLEX-BOMB REGRESSION (audit A5,
// 2026-09-04 fleet sweep). The `full-bleed-overlay` (and every other hero)
// variant sheet used to lead its selector fallback with bare
// `[class*="hero" i]` / `[id*="hero" i]`, so `display:flex!important;
// min-height:min(92vh,52rem)!important` matched EVERY hero-classed
// DESCENDANT — `.hero-word` spans, `.hero-visual`, `.hero-inner`,
// `.hero-scrim` — flex-bombing hero columns fleet-wide (live roofing
// baseline: 3,827px H1 pushed to y=1865, 8,563px hero section, all reveals
// stranded below the fold). These tests pin the bug CLASS, not the one
// selector: a hero variant may lay out the hero SECTION container only.
//
//   1. SELECTOR-SCOPE LAW — every hero variant's emitted CSS: no
//      attribute-substring selector on class/id may appear without a type
//      selector in front of it (the CTA sheet's tag-qualified a/button
//      substrings are the legal form).
//   2. COMPILED-OUTPUT LAW — a full engine build of the word-span hero
//      donor (the audited donor shape), pinned to full-bleed-overlay the
//      way the live roofing/plumbing cohort is, ships the scoped selector
//      list only.
//   3. GEOMETRY LAW — the compiled page on real chromium: H1 above the
//      fold, sane hero height, `.hero-word` inline, `.hero-visual` not a
//      flex slab, reveals fire — and the ORIGIN/MAIN sheet appended to the
//      same page reproduces the bomb, proving this suite would have caught
//      it. Skipped where chromium is not installed (same guard as the
//      proof-shot suites).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
// Fixture clients must never stamp the real client registry (Gate 4C).
process.env.MIRROR_CLIENT_ROOT = process.env.MIRROR_CLIENT_ROOT
  || fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-hero-scope-"));
if (!process.env.MIRROR_EVIDENCE_HMAC_KEY) process.env.MIRROR_EVIDENCE_HMAC_KEY = "test-evidence-key";

const cv = require("../lib/mirror-engine/component-variants");

// The exact selector list origin/main shipped — the flex-bomb. Kept here so
// the geometry test can prove the suite detects it, and so the list can
// never quietly return.
const ORIGIN_MAIN_HERO_SELECTORS = Object.freeze([
  '[class*="hero" i]',
  '[id*="hero" i]',
  "main > section:first-of-type",
  ".banner",
  '[data-wss-section="hero"]',
]);

/** A substring selector on class/id with NO type selector in front of it —
 *  the bomb shape. `section[class*="hero" i]` is legal; a bare
 *  `[class*="hero" i]` (or `.x[class*="hero" i]`) matches every descendant. */
const BARE_SUBSTRING_SELECTOR = /(^|[\s,>~+])\[(?:class|id)\*=/i;

function variantSheetOf(css) {
  const text = String(css || "");
  const start = text.indexOf("/* === wss component variants");
  // Raw heroVariantCss() output has no composite wrapper — it is already
  // only variant bytes. The composite (what the engine appends) does.
  if (start < 0) return text;
  const end = text.indexOf("/* wss typography scale", start);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

// ---------------------------------------------------------------------------
// 1. the selector-scope law, straight off the generator
// ---------------------------------------------------------------------------
test("hero-variant scoping: no hero variant sheet may carry an unqualified class/id substring selector", () => {
  for (const hero of cv.HERO_VARIANTS) {
    const css = cv.heroVariantCss({ variant: hero.id });
    assert.ok(css.length > 40, `hero ${hero.id} has no CSS`);
    const sheet = variantSheetOf(css);
    assert.ok(sheet.length > 0, `hero ${hero.id} sheet marker not found`);
    assert.ok(!BARE_SUBSTRING_SELECTOR.test(sheet),
      `hero ${hero.id} ships a bare [class*=/[id*= selector — the flex-bomb shape:\n${sheet.slice(0, 300)}`);
  }
});

test("hero-variant scoping: the fallback targets the hero section container (stamped hook + tag-qualified substrings)", () => {
  for (const hero of cv.HERO_VARIANTS) {
    const sheet = variantSheetOf(cv.heroVariantCss({ variant: hero.id }));
    assert.ok(sheet.includes('[data-wss-section="hero" i]') || sheet.includes('[data-wss-section="hero"]'),
      `hero ${hero.id} lost the engine-stamped hero hook`);
    assert.ok(sheet.includes('section[class*="hero" i]'),
      `hero ${hero.id} cannot find a <section class="hero-section"> donor`);
    assert.ok(sheet.includes('header[class*="hero" i]'),
      `hero ${hero.id} cannot find a <header class="site-hero"> donor`);
    assert.ok(sheet.includes("main > section:first-of-type"),
      `hero ${hero.id} lost the positional anchor`);
  }
});

test("hero-variant scoping: the generator refuses the origin/main selector list through the byte law (canary)", () => {
  // Proving the law bites: feeding the generator the ORIGIN/MAIN list must
  // produce a sheet the byte law rejects.
  const bombed = variantSheetOf(cv.heroVariantCss({
    variant: "full-bleed-overlay",
    heroSelector: [...ORIGIN_MAIN_HERO_SELECTORS],
  }));
  assert.ok(BARE_SUBSTRING_SELECTOR.test(bombed), "the origin/main sheet no longer trips the law — the law is dead");
});

// ---------------------------------------------------------------------------
// 2. the compiled-output law — a full engine build
// ---------------------------------------------------------------------------
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { siteEditLog } = require("../lib/site-edit-log");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

async function buildWordSpanHeroSite() {
  const { mirror } = require("../lib/mirror-engine/engine");
  const captured = { files: null };
  const deps = {
    slugPolicy,
    siteEditLog: (args) => siteEditLog({ ...args, select: async () => ({ ok: true, mode: "live_select", data: [] }) }),
    resolveBrandAssets: async () => ({
      ok: true, logo: null, accent: null, primary: null, hashes: {}, mediaMode: "housed", photos: [], heroVideo: null,
    }),
    readArchivedFile: async () => null,
    withSpaRewrite: (files) => { captured.files = files; return files; },
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
  const res = await mirror({
    slug: "wss-test-heroscope-zilker-austin",
    donor: "mirror-donor-hero",
    facts: {
      business_name: "Zilker Test Roofing",
      industry: "roofing",
      city: "Austin",
      state: "TX",
      phone: "+15125550142",
    },
    // The exact pin the live roofing/plumbing cohort carries: a dark client
    // surface reads photo-led and pins full-bleed-overlay.
    client_surface: { mode: "dark" },
  }, { registry: createRegistry(), deps });
  assert.equal(res.status, 200, `build rejected: ${JSON.stringify(res.body).slice(0, 400)}`);
  assert.equal(res.body.checks.variants.hero, "full-bleed-overlay", "the cohort's variant must be selected");
  const files = captured.files || {};
  assert.ok(files["index.html"], "the build shipped an index");
  return files;
}

test("compiled output: the full-bleed build stamps the variant and ships only section-scoped hero selectors", async () => {
  const files = await buildWordSpanHeroSite();
  const html = files["index.html"].toString("utf8");
  assert.match(html, /<html[^>]*data-wss-variant="full-bleed-overlay"/, "the page wears the variant attribute");
  assert.ok((html.match(/class="hero-word"/g) || []).length >= 3,
    "the donor's hero word spans must survive the build (they are what the bomb used to flex)");

  const cssRels = Object.keys(files).filter((r) => /\.css$/i.test(r)).sort();
  assert.ok(cssRels.length, "the build shipped stylesheets");
  const sheet = variantSheetOf(files[cssRels[cssRels.length - 1]].toString("utf8"));
  assert.ok(sheet.includes('data-wss-variant="full-bleed-overlay"'), "the variant sheet landed in the last stylesheet");
  assert.ok(sheet.includes("display:flex!important"), "the full-bleed geometry is present (scoped, not absent)");
  assert.ok(!BARE_SUBSTRING_SELECTOR.test(sheet),
    `the compiled variant sheet ships a bare [class*=/[id*= selector:\n${sheet.slice(0, 300)}`);
});

// ---------------------------------------------------------------------------
// 3. the geometry law — real chromium on the compiled bytes
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".png": "image/png",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

function serveFiles(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heroscope-site-"));
  for (const [rel, buf] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
  }
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = req.url.split("?")[0].replace(/^\/+/, "") || "index.html";
      const p = path.resolve(root, rel);
      if (!p.startsWith(root + path.sep) || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(p).toLowerCase()] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

async function chromiumAvailable() {
  try {
    const { launchChromium } = require("../lib/serverless-chromium");
    const browser = await launchChromium();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const GEOMETRY = `(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { y: b.y + window.scrollY, h: b.height, w: b.width };
  };
  const h1 = q("main h1");
  const hero = q("main section.hero");
  const word = q(".hero-word");
  const visual = q(".hero-visual");
  const wordCs = word ? getComputedStyle(word) : null;
  const visualCs = visual ? getComputedStyle(visual) : null;
  return {
    h1: r(h1),
    hero: r(hero),
    wordDisplay: wordCs ? wordCs.display : null,
    wordMinHeight: wordCs ? parseFloat(wordCs.minHeight) : null,
    visualDisplay: visualCs ? visualCs.display : null,
    visualMinHeight: visualCs ? parseFloat(visualCs.minHeight) : null,
    reveals: [...document.querySelectorAll(".reveal")].map((el) => Number(getComputedStyle(el).opacity)),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`;

test("geometry: the compiled hero renders intact on chromium and the origin/main sheet would have bombed it", { timeout: 120_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const files = await buildWordSpanHeroSite();
  const { srv, base } = await serveFiles(files);
  const { launchChromium } = require("../lib/serverless-chromium");
  const browser = await launchChromium();
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500); // reveals arm on load; the audit sampled 0.5/2/5s
      const g = await page.evaluate(GEOMETRY);
      const vw = viewport.width === 1280 ? 900 : viewport.height;
      assert.ok(g.h1 && g.h1.y + g.h1.h < vw,
        `H1 must sit above the fold (${viewport.width}px): ${JSON.stringify(g.h1)}`);
      assert.ok(g.h1 && g.h1.h < 1200, `H1 height must stay sane: ${JSON.stringify(g.h1)}`);
      assert.ok(g.hero && g.hero.h < 2000, `hero section must stay under 2000px: ${JSON.stringify(g.hero)}`);
      assert.notEqual(g.wordDisplay, "flex", `.hero-word must not be flexed (${g.wordDisplay})`);
      assert.ok(!g.wordMinHeight || g.wordMinHeight === 0, `.hero-word must carry no forced min-height (${g.wordMinHeight})`);
      assert.notEqual(g.visualDisplay, "flex", `.hero-visual must not be flexed (${g.visualDisplay})`);
      assert.ok(g.reveals.length >= 1 && g.reveals.every((o) => o >= 0.9),
        `reveals must fire, not strand below the fold: ${JSON.stringify(g.reveals)}`);
      assert.equal(g.overflowX, false, "no horizontal overflow");

      // THE CANARY: append the exact origin/main variant sheet to the same
      // page and the bomb must come back — this is the regression the suite
      // exists to catch, so prove the harness sees it.
      if (viewport.width === 1280) {
        await page.addStyleTag({ content: cv.heroVariantCss({ variant: "full-bleed-overlay", heroSelector: [...ORIGIN_MAIN_HERO_SELECTORS] }) });
        await page.waitForTimeout(200);
        const bombed = await page.evaluate(GEOMETRY);
        assert.equal(bombed.wordDisplay, "flex", "origin/main CSS must flex .hero-word (else this harness is blind)");
        assert.ok(bombed.wordMinHeight > 100, `origin/main CSS must min-height .hero-word (${bombed.wordMinHeight})`);
        assert.ok(bombed.h1 && bombed.h1.h > 1500, `origin/main CSS must balloon the H1 (${JSON.stringify(bombed.h1)})`);
        assert.ok(bombed.hero && bombed.hero.h > 4000, `origin/main CSS must swell the hero section (${JSON.stringify(bombed.hero)})`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
});
