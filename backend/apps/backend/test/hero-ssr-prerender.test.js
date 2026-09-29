"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

process.env.GHOST_AGENCY_REMOTE_BROWSER = "0";

const { loadDonor, donorRoot } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");
const { identityCopyFor, marketCity, addressCity } = require("../lib/mirror-engine/facts");
const contentInject = require("../lib/mirror-engine/content-inject");
const { launchChromium } = require("../lib/serverless-chromium");

const FACTS = {
  business_name: "Copper Mesa Home Services",
  industry: "plumbing",
  city: "Austin",
  service_area: "Austin",
  state: "TX",
  phone: "(512) 555-0100",
  email: "hello@coppermesa.example",
  address: "123 Main St, Austin, TX 78701",
  zip: "78701",
  rating: 4.9,
  review_count: 87,
};

function manifestFor(name) {
  return JSON.parse(fs.readFileSync(path.join(donorRoot(), name, "BOILERPLATE.json"), "utf8"));
}

function tokenValues(facts, copy, slug) {
  const tv = {};
  for (const token of ALLOWED_TOKENS) tv[token] = "";
  Object.assign(tv, {
    BUSINESS_NAME: facts.business_name,
    PHONE: facts.phone,
    PHONE_DIGITS: String(facts.phone || "").replace(/[^0-9]/g, ""),
    CITY: marketCity(facts),
    ADDRESS_CITY: addressCity(facts),
    STATE: facts.state,
    REGION: facts.state,
    EMAIL: facts.email,
    ADDRESS: facts.address,
    ZIP: facts.zip,
    GEO_LAT: "30.2672",
    GEO_LNG: "-97.7431",
    RATING: String(facts.rating),
    REVIEW_COUNT: String(facts.review_count),
    LICENSE: "TX TEST-001",
    OWNER_NAME: "",
    PROFILE_URL: "https://maps.google.com/?cid=1",
    LOGO_URL: "/assets/brand-logo.svg",
    SITE_URL: `https://${slug}.wss-ai.com/`,
    PREVIEW_URL: `https://${slug}.wss-ai.com/`,
    HERO_HEADLINE: copy.headline,
    HERO_LINE_A: copy.lines.a,
    HERO_LINE_B: copy.lines.b,
    HERO_LINE_C: copy.lines.c,
    HERO_ACCENT: "",
    HERO_BADGE: "",
  });
  return tv;
}

function buildDonor(name, facts, slug) {
  const manifest = manifestFor(name);
  const donor = loadDonor(path.join(donorRoot(), name));
  const copy = identityCopyFor(facts);
  const h = hydrate({ donorFiles: donor.files, tokenValues: tokenValues(facts, copy, slug) });
  assert.equal(h.ok, true, JSON.stringify(h.detail || h));
  const injected = contentInject.inject({
    files: h.files,
    content: { services: [{ name: facts.industry === "plumbing" ? "Water Leak Detection" : "Landscape Maintenance" }] },
    facts,
    phoneDigits: String(facts.phone || "").replace(/[^0-9]/g, ""),
    slug,
    manifest,
    identityCopy: copy,
  });
  return { files: injected.files, html: injected.files["index.html"].toString("utf8"), copy, report: injected.report };
}

function h1Count(html) {
  return (String(html).match(/<h1[\s>]/gi) || []).length;
}

function assertHeroOutsideNoscript(html) {
  const blocks = String(html).match(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi) || [];
  for (const block of blocks) assert.doesNotMatch(block, /data-wss-ssr-hero/i);
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

const plumbing = buildDonor("plumbing-clean", FACTS, "wss-test-hero-ssr-plumbing");
const landscapingFacts = { ...FACTS, industry: "landscaping", business_name: "Copper Mesa Landscapes" };
const fullBleed = buildDonor("landscaping-evergreen", landscapingFacts, "wss-test-hero-ssr-landscape");

test("served plumbing HTML carries the hero identity with JavaScript absent (STATIC hero h1 contract)", () => {
  // FINAL-QA CLASS A (2026-09): the plumbing donor's hero headline is now a
  // STATIC <h1 data-wss-hero-headline>{{HERO_HEADLINE}}</h1> — the client's
  // own composed headline hydrated into the served bytes, above the fold
  // with no bridge, no prehydration skeleton and no JS dependency. The
  // engine's hero bridge and prehydration reserve both stand down for a
  // page that already owns its headline; the report names that refusal so
  // QA can tell bridge-satisfied from static-satisfied.
  assert.equal(plumbing.report.hero_ssr.present, false, JSON.stringify(plumbing.report.hero_ssr));
  assert.equal(plumbing.report.hero_ssr.reason, "static_h1_already_present",
    "the static-h1 refusal must be named so QA can tell bridge-satisfied from static-satisfied");
  assert.equal(h1Count(plumbing.html), 1, "exactly one h1 — the static hero headline");
  assert.match(plumbing.html, /<h1[^>]*data-wss-hero-headline[^>]*>/,
    "the static hero headline is the donor's own marked h1, not a promoted section heading");
  const heroH1 = /<h1[^>]*data-wss-hero-headline[^>]*>([\s\S]*?)<\/h1>/i.exec(plumbing.html);
  assert.ok(heroH1 && /Copper Mesa Home Services\. Plumbing in Austin, TX\./.test(heroH1[1]),
    `the composed headline hydrates INTO the h1 (saw: ${heroH1 && heroH1[1]})`);
  // The trade/market line still ships as the hero eyebrow ("Licensed
  // plumbers in Austin, TX") with JS absent.
  assert.match(plumbing.html, /Licensed plumbers in Austin, TX/);
  assertHeroOutsideNoscript(plumbing.html);
  // The SPA mount contract survives (React still has its root), but the
  // page carries NO prehydration skeleton: the 100vh skeleton stamped into
  // a bare #root inside the hero was the Class A empty-slab geometry
  // (hero 1411px desktop / 1837px mobile, headline below the fold).
  assert.match(plumbing.html, /id=["']root["']/, "the SPA mount root remains");
  assert.doesNotMatch(plumbing.html, /data-wss-prehydration-layout/,
    "a page with a static hero h1 never gets the prehydration skeleton stamped into its hero");
});

test("served full-bleed HTML carries the hero identity with JavaScript absent (full-bleed bridge or static h1)", () => {
  assert.equal(fullBleed.report.hero_ssr.present, true, JSON.stringify(fullBleed.report.hero_ssr));
  assert.equal(h1Count(fullBleed.html), 1);
  assert.match(fullBleed.html, /Copper Mesa Landscapes/);
  // The trade/market line: the full-bleed bridge composes "Landscaping in
  // Austin, TX"; a static donor ships it as the hero eyebrow ("Landscape
  // design &amp; build in Austin, TX"). Either shape carries the market
  // identity with JS absent.
  assert.match(fullBleed.html, /Landscap(?:ing|e design &amp; build) in Austin, TX/);
  assertHeroOutsideNoscript(fullBleed.html);

  if (fullBleed.report.hero_ssr.family === "static") {
    // ENGINE-REQUEST #681: a hand-authored donor owns a real <h1> in the
    // served markup — exactly what the full-bleed bridge exists to fake — so
    // the guarantee holds with no bridge, no #root mount and no composed
    // lines. The single-<h1> count above is the no-JS hero itself.
    assert.equal(fullBleed.report.hero_ssr.reason, "static_h1_already_present",
      "the static family must name its reason so QA can tell bridge-satisfied from static-satisfied");
    return;
  }

  // SPA-shaped donor: the full-bleed bridge contract stands in full.
  assert.equal(fullBleed.report.hero_ssr.family, "full-bleed");
  assert.match(fullBleed.html, /data-wss-ssr-hero="full-bleed"/);
});

test("the served page shows exactly one H1 after boot: the SPA bridge is replaced, a static h1 stands on its own", async (t) => {
  const browser = await launchChromium({ retries: 0 });
  t.after(async () => { await browser.close(); });

  for (const built of [plumbing, fullBleed]) {
    const served = await serve(built.files);
    try {
      const page = await browser.newPage();
      await page.goto(served.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForFunction(() => document.querySelectorAll("h1").length === 1, null, { timeout: 20000 });
      const state = await page.evaluate(() => ({
        count: document.querySelectorAll("h1").length,
        text: document.querySelector("h1") ? document.querySelector("h1").textContent : "",
        bridgeStillMounted: Boolean(document.querySelector("[data-wss-ssr-hero]")),
      }));
      assert.equal(state.count, 1, JSON.stringify(state));
      assert.equal(state.bridgeStillMounted, false,
        "createRoot must replace the no-JS bridge with the donor component tree — and a static donor never ships one");
      if (built.report.hero_ssr.family === "static") {
        // A static donor's h1 is the donor's own hero copy; the page (not the
        // h1 node) carries the business name. It must render identically with
        // or without a client ever mounting.
        assert.ok(state.text.trim().length > 0, "the static hero headline must actually render");
      } else {
        assert.match(state.text, /Copper Mesa/);
      }
      await page.close();
    } finally {
      await new Promise((resolve) => served.server.close(resolve));
    }
  }
});

test("SSR/non-empty roots and pages that already own an H1 are refused; a document-owned static H1 reports family static", () => {
  const manifest = manifestFor("landscaping-evergreen");
  const copy = identityCopyFor(landscapingFacts);
  const prerendered = contentInject.injectHeroPrerender(
    '<html><body><div id="root"><main><h2>Already rendered</h2></main></div></body></html>',
    { facts: landscapingFacts, manifest, identityCopy: copy },
  );
  assert.equal(prerendered.report.present, false);
  assert.equal(prerendered.report.reason, "empty_spa_root_not_found");

  const h1Owned = contentInject.injectHeroPrerender(
    '<html><body><div id="root"><h1>React SSR owns this</h1></div></body></html>',
    { facts: landscapingFacts, manifest, identityCopy: copy },
  );
  assert.equal(h1Owned.report.present, false, "an H1 inside an SPA mount belongs to the app's SSR — the bridge still refuses");
  assert.equal(h1Owned.report.reason, "static_h1_already_present");

  // ENGINE-REQUEST #681: the same H1 on a page with NO SPA mount is the
  // static-donor contract — the guarantee holds, the bridge is unnecessary.
  const staticDoc = "<html><body><main><h1>Hand-authored hero</h1></main></body></html>";
  const staticOwned = contentInject.injectHeroPrerender(staticDoc, { facts: landscapingFacts, manifest, identityCopy: copy });
  assert.equal(staticOwned.report.present, true);
  assert.equal(staticOwned.report.family, "static");
  assert.equal(staticOwned.report.reason, "static_h1_already_present");
  assert.equal(staticOwned.html, staticDoc, "a static donor's HTML passes through untouched");
});
