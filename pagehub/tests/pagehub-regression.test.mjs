import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const AUTH_TOKEN = "pagehub-regression-auth-token";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function captureResponse() {
  let resolve;
  const complete = new Promise(done => { resolve = done; });
  const headers = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body, headers }); return this; },
    end(body = "") { resolve({ status: this.statusCode, body, headers }); return this; }
  };
  return { response, complete };
}

function candidateUrl(candidate) {
  return typeof candidate === "string" ? candidate : String(candidate?.url || candidate?.src || candidate?.href || "");
}

test("Firecrawl fallback keeps real logo and colors when structured fields are empty", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalAuthToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.FIRECRAWL_API_KEY = "test-key";
  process.env.INTAKE_GENIE_TOKEN = AUTH_TOKEN;
  const firecrawlHandler = require(join(repoRoot, "api", "firecrawl-intake.js"));
  const html = `<!doctype html>
    <html><head><link rel="stylesheet" href="/assets/brand.css"></head>
    <body><header class="site-header"><a class="brand-logo" href="/">
      <picture><source srcset="/assets/BillSmithPlumbing_LogoHiRes500center.jpg 1x, /assets/BillSmithPlumbing_LogoHiRes1000center.jpg 2x">
      <img class="header-logo" src="/assets/bill-smith-logo.svg" alt="Bill Smith Plumbing logo"></picture>
    </a></header></body></html>`;
  globalThis.fetch = async input => {
    const url = String(input);
    if (/sitemap(?:_index)?\.xml|wp-sitemap\.xml/.test(url)) return new Response("not found", { status: 404 });
    if (url === "https://api.firecrawl.dev/v2/map") return jsonResponse({ success: true, links: [] });
    if (url === "https://api.firecrawl.dev/v2/scrape") {
      return jsonResponse({
        success: true,
        data: {
          json: { logoLink: "", logoCandidates: [], brandColors: "", brandPalette: [] },
          markdown: "Bill Smith Plumbing",
          rawHtml: html,
          metadata: { title: "Bill Smith Plumbing" },
          branding: {
            logo: "https://billsmith-plumbing.com/assets/bill-smith-logo.svg",
            colors: { primary: "#0A4A7A", accent: "#F4A024" }
          },
          links: [],
          images: []
        }
      });
    }
    if (url === "https://billsmith-plumbing.com/assets/brand.css") {
      return new Response(":root{--brand-navy:#112B4A;--brand-gold:#E7A62B}", { status: 200 });
    }
    throw new Error(`Unexpected fetch in regression test: ${url}`);
  };

  try {
    const { response, complete } = captureResponse();
    await firecrawlHandler({
      method: "POST",
      headers: {
        origin: "https://pagehub-intake-lock-form.vercel.app",
        authorization: `Bearer ${AUTH_TOKEN}`
      },
      body: { urls: ["https://billsmith-plumbing.com/"] }
    }, response);
    const result = await complete;
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ok, true);
    const logos = (result.body.extracted.logoCandidates || []).map(candidateUrl);
    assert.ok(logos.some(url => /BillSmithPlumbing_LogoHiRes500center\.jpg/i.test(url)), logos.join("\n"));
    assert.ok(!logos.some(url => /undefined/i.test(url)), logos.join("\n"));
    const palette = result.body.extracted.brandPalette || [];
    const colors = palette.map(item => String(item.hex || item.color || item)).join(" ").toUpperCase();
    assert.match(colors, /#0A4A7A|#112B4A/);
    assert.notEqual(String(result.body.extracted.brandColors || "").trim(), "");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
    if (originalAuthToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalAuthToken;
  }
});

test("Firecrawl returns retryable source_harvest_failed when every attempted page fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalAuthToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.FIRECRAWL_API_KEY = "test-key";
  process.env.INTAKE_GENIE_TOKEN = AUTH_TOKEN;
  const firecrawlHandler = require(join(repoRoot, "api", "firecrawl-intake.js"));
  globalThis.fetch = async input => {
    const url = String(input);
    if (/sitemap(?:_index)?\.xml|wp-sitemap\.xml/.test(url)) return new Response("not found", { status: 404 });
    if (url === "https://api.firecrawl.dev/v2/map") return jsonResponse({ success: true, links: [] });
    if (/^https:\/\/api\.firecrawl\.dev\/v[12]\/scrape$/.test(url)) {
      return jsonResponse({ success: false, error: "provider temporarily unavailable" }, 503);
    }
    throw new Error(`Unexpected fetch in all-failed harvest test: ${url}`);
  };

  try {
    const { response, complete } = captureResponse();
    await firecrawlHandler({
      method: "POST",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      body: { urls: ["https://example.com/"] },
    }, response);
    const result = await complete;
    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, "source_harvest_failed");
    assert.equal(result.body.retryable, true);
    assert.equal(result.body.coverage.schema, "SourceHarvestCoverage/v1");
    assert.deepEqual(result.body.coverage.succeeded, []);
    assert.equal(result.body.coverage.counts.attempted, 1);
    assert.equal(result.body.coverage.counts.failed, 1);
    assert.equal(result.body.coverage.failed[0].source, "https://example.com/");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
    if (originalAuthToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalAuthToken;
  }
});

test("Firecrawl rejects a provider-reported cross-owner final URL before competitor facts can certify", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalAuthToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.FIRECRAWL_API_KEY = "test-key";
  process.env.INTAKE_GENIE_TOKEN = AUTH_TOKEN;
  const firecrawlHandler = require(join(repoRoot, "api", "firecrawl-intake.js"));
  let scrapeCalls = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (/sitemap(?:_index)?\.xml|wp-sitemap\.xml/.test(url)) return new Response("not found", { status: 404 });
    if (url === "https://api.firecrawl.dev/v2/map") return jsonResponse({ success: true, links: [] });
    if (/^https:\/\/api\.firecrawl\.dev\/v[12]\/scrape$/.test(url)) {
      scrapeCalls += 1;
      return jsonResponse({
        success: true,
        data: {
          finalUrl: "https://competitor.example/services",
          json: {
            brandName: "Competitor Roofing",
            exactServices: "Teleportation Roofing",
            mainServices: "Teleportation Roofing",
          },
          markdown: "Competitor Roofing offers Teleportation Roofing.",
          metadata: { sourceURL: "https://competitor.example/services" },
        },
      });
    }
    throw new Error(`Unexpected fetch in cross-owner source test: ${url}`);
  };

  try {
    const { response, complete } = captureResponse();
    await firecrawlHandler({
      method: "POST",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      body: { urls: ["https://victim.example/"] },
    }, response);
    const result = await complete;
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "source_harvest_failed");
    assert.equal(result.body.retryable, true);
    assert.equal(scrapeCalls, 1, "tenant mismatch is deterministic and must not amplify provider retries");
    assert.deepEqual(result.body.coverage.succeeded, []);
    assert.match(result.body.coverage.failed[0].error, /outside the submitted source identity/i);
    assert.doesNotMatch(JSON.stringify(result.body), /Teleportation Roofing|Competitor Roofing/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
    if (originalAuthToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalAuthToken;
  }
});

test("Firecrawl partial harvest keeps bounded private page sources and exact coverage", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalAuthToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.FIRECRAWL_API_KEY = "test-key";
  process.env.INTAKE_GENIE_TOKEN = AUTH_TOKEN;
  const firecrawlHandler = require(join(repoRoot, "api", "firecrawl-intake.js"));
  const sitemapUrls = [
    "https://example.com/",
    "https://example.com/services",
    ...Array.from({ length: 13 }, (_, index) => `https://example.com/page-${index + 1}`),
  ];
  const sitemap = `<urlset>${sitemapUrls.map(url => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
  const longMarkdown = `PRIVATE SOURCE ONLY ${"x".repeat(26000)}`;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url === "https://example.com/sitemap.xml") return new Response(sitemap, { status: 200 });
    if (/sitemap_index\.xml|wp-sitemap\.xml/.test(url)) return new Response("not found", { status: 404 });
    if (url === "https://api.firecrawl.dev/v2/map") return jsonResponse({ success: true, links: [] });
    if (/^https:\/\/api\.firecrawl\.dev\/v[12]\/scrape$/.test(url)) {
      const pageUrl = JSON.parse(String(options.body || "{}")).url;
      if (["https://example.com/", "https://example.com/services"].includes(pageUrl)) {
        return jsonResponse({
          success: true,
          data: {
            json: { brandName: "Example Roofing", exactServices: "Roof Repair" },
            markdown: longMarkdown,
            metadata: { title: "Example Roofing", description: "Roof repair", ignored: "z".repeat(5000) },
            images: Array.from({ length: 30 }, (_, index) => ({
              url: `https://example.com/media-${index}.webp`,
              alt: `Roof image ${index}`,
              width: 1200,
              height: 800,
            })),
            branding: { logo: "https://example.com/logo.svg", colors: { primary: "#123456" } },
          },
        });
      }
      return jsonResponse({ success: false, error: "page scrape failed" }, 502);
    }
    throw new Error(`Unexpected fetch in partial harvest test: ${url}`);
  };

  try {
    const { response, complete } = captureResponse();
    await firecrawlHandler({
      method: "POST",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      body: { urls: ["https://example.com/"] },
    }, response);
    const result = await complete;
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ok, true);
    assert.deepEqual(result.body.sources, ["https://example.com/", "https://example.com/services"]);
    assert.equal(result.body.observations.length, 2);
    assert.ok(result.body.observations.every(row => row.status === "succeeded"));
    assert.equal(result.body.observations[0].private_source.markdown, longMarkdown);
    assert.equal(result.body.observations[0].private_source.markdown_truncated, false);
    assert.equal(result.body.observations[0].private_source.media.images.length, 24);
    assert.equal(result.body.observations[0].private_source.metadata.ignored, undefined);
    assert.deepEqual(result.body.coverage.counts, {
      attempted: 15,
      succeeded: 2,
      failed: 13,
      truncated: 0,
      truncated_omitted: 0,
    });
    assert.equal(result.body.coverage.attempted.length, 15);
    assert.deepEqual(result.body.coverage.succeeded, ["https://example.com/", "https://example.com/services"]);
    assert.equal(result.body.coverage.failed.length, 13);
    assert.equal(result.body.coverage.truncated.length, 0);
    assert.ok(result.body.observations.every(row => !result.body.coverage.failed.some(failed => failed.source === row.source)));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
    if (originalAuthToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalAuthToken;
  }
});

test("compiler always emits empty brand fonts and never verifies blank geo as 0,0", async () => {
  const originalAuthToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.INTAKE_GENIE_TOKEN = AUTH_TOKEN;
  const compileHandler = require(join(repoRoot, "api", "compile-build-packet.js"));
  try {
    const { response, complete } = captureResponse();
    await compileHandler({
      method: "POST",
      headers: {
        origin: "https://pagehub-intake-lock-form.vercel.app",
        authorization: `Bearer ${AUTH_TOKEN}`
      },
      body: {
        packet: {
          packetName: "Schema regression",
          brand: {},
          business: { businessName: "Fixture Business", geoLat: "", geoLng: "" },
          requirements: {},
          pagePlan: [{ title: "Home", slug: "" }],
          goldenArtifacts: { exactServices: [] }
        }
      }
    }, response);
    const result = await complete;
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.packet.brand.fonts, { display: "", body: "", href: "" });
    assert.equal(result.body.packet.compiled.mapSdkContract.geo.verified, false);
    assert.equal(result.body.packet.compiled.mapSdkContract.geo.lat, null);
    assert.equal(result.body.packet.compiled.mapSdkContract.geo.lng, null);
  } finally {
    if (originalAuthToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalAuthToken;
  }
});

test("Google Places mapping fills verified geo and an explicitly reviewable radius default", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalAuthToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.GOOGLE_PLACES_API_KEY = "test-google-key";
  process.env.INTAKE_GENIE_TOKEN = AUTH_TOKEN;
  const googleHandler = require(join(repoRoot, "api", "google-places-intake.js"));
  const googleCalls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    googleCalls.push({ url: url.href, options });
    if (url.href === "https://places.googleapis.com/v1/places:searchText") {
      assert.equal(options.method, "POST");
      assert.equal(options.headers?.["Content-Type"], "application/json");
      assert.equal(options.headers?.["X-Goog-Api-Key"], "test-google-key");
      assert.equal(options.headers?.["X-Goog-FieldMask"], "places.id");
      assert.deepEqual(JSON.parse(options.body), {
        textQuery: "Bill Smith Plumbing Test City TX",
        languageCode: "en",
        regionCode: "US",
        pageSize: 1,
        includePureServiceAreaBusinesses: true
      });
      return jsonResponse({ places: [{ id: "ChIJFIXTURE" }] });
    }
    if (url.href === "https://places.googleapis.com/v1/places/ChIJFIXTURE") {
      assert.equal(options.method, "GET");
      assert.equal(options.headers?.["X-Goog-Api-Key"], "test-google-key");
      assert.equal(options.headers?.["Content-Type"], undefined);
      assert.equal(options.headers?.["X-Goog-FieldMask"], [
        "id", "displayName", "formattedAddress", "nationalPhoneNumber", "internationalPhoneNumber",
        "websiteUri", "googleMapsUri", "location", "regularOpeningHours", "types", "rating",
        "userRatingCount", "businessStatus", "addressComponents"
      ].join(","));
      return jsonResponse({
        id: "ChIJFIXTURE",
        displayName: { text: "Bill Smith Plumbing", languageCode: "en" },
        formattedAddress: "100 Water Way, Test City, TX 75000, USA",
        nationalPhoneNumber: "(555) 222-3333",
        websiteUri: "https://billsmith-plumbing.com/",
        googleMapsUri: "https://maps.google.com/?cid=123",
        location: { latitude: 32.12345, longitude: -96.54321 },
        regularOpeningHours: { weekdayDescriptions: ["Monday: 8:00 AM-5:00 PM"] },
        businessStatus: "OPERATIONAL",
        addressComponents: [
          { longText: "Test City", shortText: "Test City", types: ["locality"] },
          { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1"] }
        ]
      });
    }
    throw new Error(`Unexpected Google fetch: ${url}`);
  };
  try {
    const { response, complete } = captureResponse();
    await googleHandler({
      method: "POST",
      headers: {
        origin: "https://pagehub-intake-lock-form.vercel.app",
        authorization: `Bearer ${AUTH_TOKEN}`
      },
      body: { query: "Bill Smith Plumbing Test City TX", gbpLink: "https://share.google/bill-smith" }
    }, response);
    const result = await complete;
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "mapped");
    assert.equal(result.body.fields.geoLat, "32.12345");
    assert.equal(result.body.fields.geoLng, "-96.54321");
    assert.equal(result.body.fields.serviceRadiusMiles, 25);
    assert.equal(result.body.fields.serviceRadiusNeedsReview, true);
    assert.match(result.body.fields.serviceRadiusSource, /default.*review/i);
    assert.equal(googleCalls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalKey;
    if (originalAuthToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalAuthToken;
  }
});

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const bundled = "C:\\Users\\Main\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright";
    return require(bundled);
  }
}

async function startFixtureServer(indexHtml) {
  let brightDataCalls = 0;
  let sendCalls = 0;
  let compileCalls = 0;
  const firecrawlBodies = [];
  const googlePlacesBodies = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") : {};
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.method === "GET" && (request.url === "/" || request.url?.startsWith("/?"))) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(indexHtml);
      return;
    }
    if (request.url === "/api/firecrawl-intake") {
      firecrawlBodies.push(body);
      response.end(JSON.stringify({
        ok: true,
        sources: ["https://billsmith-plumbing.com/", "https://share.google/bill-smith"],
        notes: [],
        observations: [{
          source: "https://billsmith-plumbing.com/",
          status: "succeeded",
          extracted: { exactServices: "Drain Cleaning\nWater Heater Repair" },
          private_source: { markdown: "# Drain Cleaning\nBill Smith Plumbing offers Drain Cleaning for clogged drains.\n# Water Heater Repair\nBill Smith Plumbing offers Water Heater Repair for homes." }
        }],
        extracted: {
          brandName: "Bill Smith Plumbing",
          finalPhone: "(555) 222-3333",
          smsNumber: "(555) 222-3333",
          email: "hello@billsmith-plumbing.com",
          gbpLink: "https://share.google/bill-smith",
          domainUrl: "https://billsmith-plumbing.com",
          address: "100 Water Way, Test City, TX",
          serviceArea: "Test City, TX",
          hours: "Mon-Fri 8:00 AM-5:00 PM",
          hoursSource: "Client website",
          mainServices: "Drain Cleaning\nWater Heater Repair",
          exactServices: "Drain Cleaning\nWater Heater Repair",
          protectedArtifacts: "Family-owned wording from source",
          mainCta: "Call Bill Smith",
          logoLink: "",
          logoCandidates: [
            { url: "https://billsmith-plumbing.com/assets/footer-logo.svg", role: "footer logo" },
            { url: "https://billsmith-plumbing.com/assets/BillSmithPlumbing_LogoHiRes500center.jpg", role: "header upper-left logo" }
          ],
          brandPalette: [
            { hex: "#0A4A7A", role: "primary" },
            { hex: "#F4A024", role: "accent" }
          ],
          imageCandidates: [],
          socialLinks: []
        }
      }));
      return;
    }
    if (request.url === "/api/google-places-intake") {
      googlePlacesBodies.push(body);
      response.end(JSON.stringify({
        ok: true,
        status: "mapped",
        fields: {
          businessName: "Bill Smith Plumbing",
          gbpPlaceId: "ChIJBILL123",
          geoLat: "32.12345",
          geoLng: "-96.54321",
          serviceRadiusMiles: "25",
          serviceRadiusSource: "default display radius - review before production",
          serviceRadiusNeedsReview: true,
          address: "100 Water Way, Test City, TX",
          serviceArea: "Test City, TX",
          hours: "Monday: 8:00 AM-5:00 PM",
          hoursSource: "Google Business Profile",
          listingConfidence: "Exact business match"
        }
      }));
      return;
    }
    if (request.url === "/api/brightdata-serp-audit") {
      brightDataCalls += 1;
      const audit = brightDataCalls === 1
        ? { status: "not_configured", queries: [], queryPlan: { queries: [] }, aggregate: { topCompetitorDomains: [] } }
        : { status: "compiled", queries: [{ query: "plumber test city", status: "pass" }], aggregate: { topCompetitorDomains: [] } };
      response.end(JSON.stringify({ ok: true, configured: brightDataCalls > 1, audit }));
      return;
    }
    if (request.url === "/api/send-intake-packet") sendCalls += 1;
    if (request.url === "/api/compile-build-packet") compileCalls += 1;
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/`,
    calls: () => ({ brightDataCalls, sendCalls, compileCalls }),
    requestBodies: () => ({
      firecrawl: structuredClone(firecrawlBodies),
      googlePlaces: structuredClone(googlePlacesBodies)
    })
  };
}

test("domain change replaces client data, promotes branding, auto-maps GBP, and carries fonts", async t => {
  const { chromium } = loadPlaywright();
  const indexHtml = await readFile(join(repoRoot, "index.html"), "utf8");
  const fixture = await startFixtureServer(indexHtml);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => fixture.server.close(resolve));
  });
  const page = await browser.newPage();
  await page.goto(fixture.url, { waitUntil: "domcontentloaded" });

  const fill = (name, value) => page.locator(`[data-field="${name}"]`).fill(value);
  await fill("websiteUrl", "https://prisconcrete.com/");
  await fill("domainUrl", "https://prisconcrete.com/");
  await fill("businessName", "PRIS Concrete");
  await fill("contactName", "Old Contact");
  await fill("phone", "(555) 111-1111");
  await fill("smsNumber", "(555) 111-1111");
  await fill("email", "old@prisconcrete.com");
  await fill("gbpLink", "https://share.google/pris-concrete");
  await fill("socialUrl", "https://instagram.com/prisconcrete");
  await fill("assetFolder", "https://drive.google.com/drive/folders/pris-concrete-assets");
  await fill("googleDriveUrl", "https://drive.google.com/drive/folders/pris-concrete-photo-library");
  await fill("gbpPlaceId", "OLDPLACE");
  await fill("geoLat", "1");
  await fill("geoLng", "2");
  await fill("serviceRadiusMiles", "99");
  await fill("mainServices", "Concrete Repair\nConcrete Patios");
  await fill("exactServices", "Concrete Repair\nConcrete Patios");
  await fill("protectedArtifacts", "Old concrete credential");
  await fill("logoLink", "https://prisconcrete.com/logo.svg");
  await fill("brandColors", "#111111");
  await fill("galleryLink", "https://prisconcrete.com/gallery");
  await fill("meetingNotes", "Concrete Repair must remain visible");
  await fill("pagesNeeded", "Concrete Patios");
  await fill("marketingPlan", "Concrete marketing plan");
  await fill("mustInclude", "Concrete Repair");
  await fill("mustAvoid", "Old PRIS exclusion");
  await fill("packetName", "PRIS packet");

  await fill("websiteUrl", "https://www.billsmith-plumbing.com/");
  await page.locator("#importBtn").click();
  await page.waitForFunction(() => document.querySelector('[data-field="gbpPlaceId"]')?.value === "ChIJBILL123");

  const fields = await page.evaluate(() => Object.fromEntries([
    "businessName", "contactName", "phone", "smsNumber", "email", "gbpPlaceId", "geoLat", "geoLng",
    "serviceRadiusMiles", "domainUrl", "address", "serviceArea", "hours", "hoursSource", "mainServices",
    "exactServices", "protectedArtifacts", "mainCta", "logoLink", "brandColors", "galleryLink", "googleDriveUrl",
    "meetingNotes", "pagesNeeded", "marketingPlan", "mustInclude", "mustAvoid", "packetName"
  ].map(name => [name, document.querySelector(`[data-field="${name}"]`)?.value || ""])));
  assert.equal(fields.businessName, "Bill Smith Plumbing");
  assert.equal(fields.contactName, "");
  assert.equal(fields.gbpPlaceId, "ChIJBILL123");
  assert.equal(fields.geoLat, "32.12345");
  assert.equal(fields.geoLng, "-96.54321");
  assert.equal(fields.serviceRadiusMiles, "25");
  assert.match(fields.logoLink, /BillSmithPlumbing_LogoHiRes500center\.jpg$/);
  assert.match(fields.brandColors, /#0A4A7A/i);
  assert.doesNotMatch(Object.values(fields).join("\n"), /PRIS|Concrete Repair|Concrete Patios|old@prisconcrete/i);
  assert.match(fields.exactServices, /Drain Cleaning/);

  const requestBodies = fixture.requestBodies();
  assert.equal(requestBodies.firecrawl.length, 1);
  assert.deepEqual(requestBodies.firecrawl[0].urls, ["https://www.billsmith-plumbing.com/"]);
  assert.equal(requestBodies.googlePlaces.length, 1);
  assert.equal(requestBodies.googlePlaces[0].websiteUrl, "https://www.billsmith-plumbing.com/");
  assert.equal(requestBodies.googlePlaces[0].gbpLink, "https://share.google/bill-smith");
  assert.doesNotMatch(JSON.stringify(requestBodies), /prisconcrete|pris-concrete/i);

  const emptyFonts = await page.evaluate(() => buildPacket().brand.fonts);
  assert.deepEqual(emptyFonts, { display: "", body: "", href: "" });
  await fill("typographyDisplay", "Fraunces");
  await fill("typographyBody", "Inter");
  await fill("googleFontsUrl", "https://fonts.googleapis.com/css2?family=Fraunces&family=Inter");
  const fonts = await page.evaluate(() => buildPacket().brand.fonts);
  assert.deepEqual(fonts, {
    display: "Fraunces",
    body: "Inter",
    href: "https://fonts.googleapis.com/css2?family=Fraunces&family=Inter"
  });

  await page.locator("#runBrightDataAuditBtn").click();
  await assertStatus(page, /Bright Data not connected.*used Firecrawl evidence/i);
  await page.locator("#runBrightDataAuditBtn").click();
  await assertStatus(page, /no competitors found/i);

  assert.deepEqual(fixture.calls(), { brightDataCalls: 2, sendCalls: 0, compileCalls: 0 });
});

test("www and subdomain reharvest keeps same-client services and dedupes merged names", async t => {
  const { chromium } = loadPlaywright();
  const indexHtml = await readFile(join(repoRoot, "index.html"), "utf8");
  const fixture = await startFixtureServer(indexHtml);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => fixture.server.close(resolve));
  });
  const page = await browser.newPage();
  await page.goto(fixture.url, { waitUntil: "domcontentloaded" });

  const fill = (name, value) => page.locator(`[data-field="${name}"]`).fill(value);
  await fill("websiteUrl", "https://www.billsmith-plumbing.com/");
  await fill("domainUrl", "https://billsmith-plumbing.com/");
  await fill("businessName", "Bill Smith Plumbing - operator reviewed");
  await fill("mainServices", "Drain Cleaning\nExisting Same-Domain Service");
  await fill("exactServices", "Drain Cleaning\nExisting Same-Domain Service");

  await fill("websiteUrl", "https://booking.billsmith-plumbing.com/schedule");
  await page.locator("#importBtn").click();
  await page.waitForFunction(() => document.querySelector('[data-field="gbpPlaceId"]')?.value === "ChIJBILL123");

  const values = await page.evaluate(() => ({
    businessName: document.querySelector('[data-field="businessName"]')?.value || "",
    mainServices: document.querySelector('[data-field="mainServices"]')?.value || "",
    exactServices: document.querySelector('[data-field="exactServices"]')?.value || ""
  }));
  assert.equal(values.businessName, "Bill Smith Plumbing - operator reviewed");
  for (const value of [values.mainServices, values.exactServices]) {
    assert.match(value, /^Drain Cleaning$/m);
    assert.match(value, /^Existing Same-Domain Service$/m);
    assert.match(value, /^Water Heater Repair$/m);
    assert.equal(value.split(/\r?\n/).filter(line => line.trim() === "Drain Cleaning").length, 1);
  }

  const requestBodies = fixture.requestBodies();
  assert.deepEqual(requestBodies.firecrawl[0].urls, ["https://booking.billsmith-plumbing.com/schedule"]);
  assert.doesNotMatch(JSON.stringify(requestBodies), /prisconcrete|pris-concrete/i);
  assert.deepEqual(fixture.calls(), { brightDataCalls: 0, sendCalls: 0, compileCalls: 0 });
});

async function assertStatus(page, pattern) {
  await page.waitForFunction(source => {
    const value = document.querySelector("#marketingPlanStatus")?.textContent || "";
    return new RegExp(source, "i").test(value);
  }, pattern.source);
  const text = await page.locator("#marketingPlanStatus").textContent();
  assert.match(text, pattern);
}
