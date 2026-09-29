import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  build,
  buildStaticCaptureHtml,
  classifyGoogleMapResponseUrl,
  freezeMapEmbedsForCapture,
  hydrateLazyMedia,
  writeEsriSatelliteEvidence,
} from "../../factory/pipeline/05-build-v8.mjs";
import { prepareMediaCatalog } from "../../factory/lib/media-intelligence.mjs";
import { applyVisualContract } from "../../factory/pipeline/premier-visual-contract.mjs";
import { runVisualFidelityChecks } from "../../qc-audit/qc-visual-fidelity.mjs";

function packet(overrides = {}) {
  return {
    slug: "barriga-media-map-quality",
    forge: { demo: true },
    build_type: "multi-page",
    business: {
      name: "Barriga Landscaping",
      category: "landscaping",
      city: "Sacramento",
      state: "CA",
      address: "2805 Wah Ave, Sacramento, CA 95822",
    },
    services: ["Lawn care", "Sprinkler checks", "Cleanup visits"],
    voice_persona: { owner_name: "Barriga Landscaping team", first_person_snippets: [] },
    launch: { purchase_url: "https://buy.example.test/site", agent_phone: "(949) 339-5562" },
    logo_source: { url: "https://cdn.example.test/assets/barriga-logo.png", origin: "site", proposed: false },
    enrichment_sources: {
      address: { value: "2805 Wah Ave, Sacramento, CA 95822", source: "gbp" },
      phone: { value: "(916) 926-8639", source: "gbp" },
      services: { value: ["Lawn care", "Fence installation"], source: "firecrawl", confidence: 0.9 },
    },
    media: {
      catalog: [
        { kind: "photo", url: "https://cdn.example.test/assets/barriga-logo.png", source: "site", label: "Source photo" },
        { kind: "photo", url: "https://d13cw1lxlociqy.cloudfront.net/opaque-building", source: "site", label: "Source photo" },
        { kind: "photo", url: "https://d13cw1lxlociqy.cloudfront.net/opaque-building-2", source: "business-site", label: "Source photo 2" },
        { kind: "photo", url: "https://loremflickr.com/1600/900/landscaping", source: "site", label: "Source photo" },
        { kind: "photo", url: "https://cdn.example.test/projects/sacramento-lawn-care-cleanup.jpg", source: "site", label: "Lawn care project", role: "project-gallery", width: 1600, height: 1000 },
      ],
    },
    ...overrides,
  };
}

test("media intelligence rejects logos, opaque generic proxies, and placeholder feeds", () => {
  const catalog = prepareMediaCatalog(packet());
  assert.equal(catalog.length, 1);
  assert.match(catalog[0].url, /lawn-care-cleanup/);
  assert.equal(catalog[0].hero_eligible, true);
  assert.equal(catalog[0].proof_eligible, true);
});

test("unknown trade media never inherits unrelated default stock", () => {
  const input = packet({
    business: { name: "Red Clay Fencing", category: "fencing", city: "Moultrie", state: "GA" },
    logo_source: null,
    media: { catalog: [] },
  });
  applyVisualContract(input);
  assert.equal(input.media.catalog.length, 0);
});

test("landscaping supplement preserves the visually vetted stock order", () => {
  const input = packet({ media: { catalog: [] } });
  applyVisualContract(input);
  const stock = input.media.catalog.filter((item) => item.source === "stock-ambiance");
  assert.match(stock[0].url, /photo-1770664945615-52203ab54c88/);
  assert.equal(stock[0].proof_eligible, false);
});

test("capture recognizes keyless Google embeds and hydrates lazy media", async () => {
  assert.equal(classifyGoogleMapResponseUrl("https://www.google.com/maps?q=Sacramento&t=k&output=embed"), "embed");
  assert.equal(classifyGoogleMapResponseUrl("https://www.google.com/maps/embed/v1/place?key=old"), "embed");
  assert.equal(classifyGoogleMapResponseUrl("https://maps.googleapis.com/maps/api/js"), "asset");
  assert.equal(classifyGoogleMapResponseUrl("https://maps.gstatic.com/mapfiles/foo.png"), "asset");
  assert.equal(classifyGoogleMapResponseUrl("https://www.google.com.evil/maps?output=embed"), null);
  assert.equal(classifyGoogleMapResponseUrl("https://google.evil/maps?output=embed"), null);
  assert.equal(classifyGoogleMapResponseUrl("http://www.google.com/maps?output=embed"), null);
  assert.equal(classifyGoogleMapResponseUrl("https://example.test/maps?output=embed"), null);

  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    if (request.url === "/broken.svg") {
      response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("not found");
      return;
    }
    setTimeout(() => {
      response.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#4f8a10"/></svg>');
    }, 150);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const address = server.address();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const staticMap = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#56734a"/></svg>')}`;
    const liveMapHtml = '<!doctype html><html><head></head><body><div class="premier-map" data-google-map="satellite"><iframe title="Live satellite map" src="https://www.google.com/maps?q=Sacramento&amp;output=embed" style="width:100%;height:220px"></iframe></div></body></html>';
    const staticDocument = buildStaticCaptureHtml(liveMapHtml, { mapImageUrl: staticMap, mapVerified: true });
    assert.match(liveMapHtml, /output=embed/);
    assert.equal(staticDocument.map_replacements, 1);
    assert.doesNotMatch(staticDocument.html, /<iframe/i);
    assert.match(staticDocument.html, /siteforge-capture-static/);
    assert.match(buildStaticCaptureHtml(liveMapHtml, { mapVerified: false }).html, /data-siteforge-frozen-map="unavailable"/);
    await page.setContent(staticDocument.html);
    const frozenMap = await freezeMapEmbedsForCapture(page, { mapImageUrl: staticMap });
    assert.equal(frozenMap.frozen, 1);
    assert.equal(frozenMap.live_iframes, 0);
    assert.equal(await page.locator("[data-siteforge-frozen-map='true']").count(), 1);

    const lazyImages = Array.from({ length: 12 }, (_, index) =>
      `<div style="height:900px"></div><img id="project-${index}" loading="lazy" src="http://127.0.0.1:${address.port}/project-${index}.svg" alt="Project ${index}">`,
    ).join("");
    await page.setContent(`<main>${lazyImages}</main>`);
    await page.evaluate(() => {
      window.__siteforgeDecodeCalls = 0;
      HTMLImageElement.prototype.decode = function decode() {
        window.__siteforgeDecodeCalls += 1;
        return new Promise(() => {});
      };
    });
    const hydration = await hydrateLazyMedia(page, { timeoutMs: 5000, stepDelayMs: 10 });
    const naturalWidth = await page.locator("#project-11").evaluate((image) => image.naturalWidth);
    assert.ok(requests >= 12);
    assert.equal(hydration.loaded, 12);
    assert.equal(hydration.failed, 0);
    assert.equal(naturalWidth, 1200);
    assert.equal(await page.evaluate(() => window.__siteforgeDecodeCalls), 0);
    assert.equal(await page.evaluate(() => window.scrollY), 0);

    await page.setContent(`<main style="height:6200px"></main><img id="broken-project" loading="lazy" src="http://127.0.0.1:${address.port}/broken.svg" alt="Broken project">`);
    await assert.rejects(
      hydrateLazyMedia(page, { timeoutMs: 1000, stepDelayMs: 10 }),
      (error) => error?.code === "capture_lazy_media_incomplete" && /failed=1/.test(error.message),
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Esri satellite evidence succeeds only with confirmed coordinates and diverse pixels", async () => {
  const siteDir = mkdtempSync(path.join(tmpdir(), "siteforge-esri-evidence-"));
  const screenshotRoot = path.join(siteDir, "screenshots");
  const previousFetch = globalThis.fetch;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  };
  const page = {
    evaluate: async (_callback, argument) => argument
      ? { uniqueColors: 32, variance: 144 }
      : { lat: 38.6301749, lng: -121.3822236 },
  };
  try {
    const evidence = await writeEsriSatelliteEvidence(page, screenshotRoot);
    assert.equal(evidence.pass, true);
    assert.equal(evidence.provider, "esri-world-imagery");
    assert.match(requestedUrl, /World_Imagery\/MapServer\/export/);
    assert.match(requestedUrl, /size=640%2C400/);
    assert.equal(existsSync(path.join(screenshotRoot, "desktop", "map.png")), true);
    assert.match(readFileSync(path.join(screenshotRoot, "rendered-dom.html"), "utf8"), /data-satellite-rendered="verified"/);
    for (const relative of [
      "desktop/hero.png", "desktop/mid.png", "desktop/footer.png", "desktop/full.png",
      "mobile/hero.png", "mobile/mid.png", "mobile/footer.png", "mobile/full.png",
    ]) {
      const file = path.join(screenshotRoot, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, png);
    }
    writeFileSync(path.join(siteDir, "index.html"), '<!doctype html><main><div class="premier-map" data-google-map="satellite" data-lat="38.6301749" data-lng="-121.3822236"><iframe src="https://www.google.com/maps?q=38.6301749,-121.3822236&t=k&output=embed"></iframe><a href="https://www.google.com/maps/dir/?api=1&destination=3550%20Watt%20Ave">Directions</a></div></main>');
    writeFileSync(path.join(siteDir, "packet.json"), JSON.stringify({ business: { address: "3550 Watt Ave #170, Sacramento, CA 95821" } }));
    const visualChecks = runVisualFidelityChecks(siteDir);
    const satelliteCheck = visualChecks.find((item) => item.name === "visual-satellite-map-evidence");
    const directionsCheck = visualChecks.find((item) => item.name === "visual-address-map-directions");
    assert.equal(satelliteCheck?.pass, true, satelliteCheck?.detail);
    assert.equal(directionsCheck?.pass, true, directionsCheck?.detail);

    page.evaluate = async (_callback, argument) => argument
      ? { uniqueColors: 15, variance: 79 }
      : { lat: 38.6301749, lng: -121.3822236 };
    const rejected = await writeEsriSatelliteEvidence(page, screenshotRoot);
    assert.equal(rejected.pass, false);
    assert.equal(rejected.response_ok, true);
    assert.equal(existsSync(path.join(screenshotRoot, "desktop", "map.png")), false);
    assert.equal(existsSync(path.join(screenshotRoot, "rendered-dom.html")), false);
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(siteDir, { recursive: true, force: true });
  }
});

test("renderer uses relevant media and a verified Google satellite map", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-media-map-"));
  const previous = process.env.SITEFORGE_GOOGLE_MAPS_EMBED_KEY;
  process.env.SITEFORGE_GOOGLE_MAPS_EMBED_KEY = "test-browser-key";
  try {
    await build(packet(), { outDir });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    const scorecard = JSON.parse(readFileSync(path.join(outDir, "scorecard.json"), "utf8"));
    const publicPacket = JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8"));
    assert.match(html, /sacramento-lawn-care-cleanup\.jpg/);
    assert.doesNotMatch(html, /opaque-building|loremflickr/);
    assert.match(html, /data-google-map="satellite"/);
    assert.match(html, /maptype=satellite/);
    assert.match(html, /[?&](?:amp;)?output=embed(?:&|&amp;|")/);
    assert.doesNotMatch(html, /[?&](?:amp;)?key=|\/embed\/v1/i);
    assert.match(html, /2805%20Wah%20Ave%2C%20Sacramento%2C%20CA%2095822/);
    assert.doesNotMatch(html, /Barriga Landscaping team, Barriga Landscaping/i);
    assert.equal((html.match(/class="svc-photo"/g) || []).length, 0);
    assert.ok((html.match(/data-service-media="text-only"/g) || []).length >= 3);
    assert.doesNotMatch(html, /class="svc-visual"[^>]*>\s*<svg/i);
    assert.equal(scorecard.media.hero_source, "photo");
    assert.deepEqual(publicPacket.services, ["Lawn care", "Sprinkler checks", "Cleanup visits"]);
    assert.deepEqual(publicPacket.enrichment_sources.services.value, publicPacket.services);
    assert.ok(publicPacket.enrichment_sources.services.confidence >= 0.8);
    assert.deepEqual(publicPacket.visual_system.kitchens, ["razzle-fx-kitchen", "site-superpowers-kitchen", "master-glue-kitchen"]);
    assert.ok(publicPacket.visual_system.recipes.length >= 4);
    const schemaTypes = [];
    const visitSchema = (value) => {
      if (Array.isArray(value)) return value.forEach(visitSchema);
      if (!value || typeof value !== "object") return;
      if (value["@type"]) schemaTypes.push(...(Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]]));
      Object.values(value).forEach(visitSchema);
    };
    for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) visitSchema(JSON.parse(match[1]));
    for (const type of ["LocalBusiness", "Service", "FAQPage", "BreadcrumbList"]) assert.ok(schemaTypes.includes(type), `schema missing ${type}`);
    assert.doesNotMatch(JSON.stringify(publicPacket), /Fence installation|firecrawl/i);

    const publicText = [];
    const collect = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(file);
        else if (/\.(?:html|json|txt|xml)$/i.test(entry.name)) publicText.push(readFileSync(file, "utf8"));
      }
    };
    collect(outDir);
    assert.doesNotMatch(publicText.join("\n"), /pagehub|ricardo|firecrawl|brightlocal|brightdata|leadminer|ghost agency|truth_packet|\bscrap(?:e|er|ing)\b|\bcrawler\b|\bvapi\b|\btwilio\b|\bwss\b(?!\s+labs)|point_of_interest|establishment|general_contractor/i);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(pathToFileURL(path.join(outDir, "index.html")).href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(80);
      const boxes = await page.evaluate(() => Object.fromEntries(
        [".launch-rail", ".pchat-fab", ".sticky-cta"].map((selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          return [selector, box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null];
        }),
      ));
      const overlaps = (a, b) => Boolean(a && b && Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top));
      assert.equal(overlaps(boxes[".launch-rail"], boxes[".pchat-fab"]), false);
      assert.equal(overlaps(boxes[".launch-rail"], boxes[".sticky-cta"]), false);
    } finally {
      await browser.close();
    }
  } finally {
    if (previous == null) delete process.env.SITEFORGE_GOOGLE_MAPS_EMBED_KEY;
    else process.env.SITEFORGE_GOOGLE_MAPS_EMBED_KEY = previous;
    rmSync(outDir, { recursive: true, force: true });
  }
});
