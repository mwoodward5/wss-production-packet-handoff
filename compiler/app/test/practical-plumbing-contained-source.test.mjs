import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import sharp from "sharp";

const testRoot = mkdtempSync(path.join(tmpdir(), "siteforge-practical-contained-"));
const previousDataDir = process.env.SITEFORGE_DATA_DIR;
const previousFirecrawlKey = process.env.FIRECRAWL_API_KEY;
process.env.SITEFORGE_DATA_DIR = path.join(testRoot, "data");
process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";

const [
  { compileFromInput },
  { approvedPhotoCatalog, hardenPreviewMedia },
  { build },
  { checkMediaDepth },
  { runV7Checks },
  { runVisualFidelityChecks },
  { isBoundContainedSourceProof },
  { selectPremierMedia },
] = await Promise.all([
  import("../lib/intake-genie.mjs"),
  import("../lib/engine-adapter.mjs"),
  import("../../factory/pipeline/05-build-v8.mjs"),
  import("../../qc-audit/qc.mjs"),
  import("../../qc-audit/qc-v7-ext.mjs"),
  import("../../qc-audit/qc-visual-fidelity.mjs"),
  import("../../factory/lib/media-intelligence.mjs"),
  import("../../factory/lib/premier-media.mjs"),
]);

const websiteUrl = "https://practical-contained-e2e.example/";
const gbpUrl = "https://www.google.com/maps/place/?q=place_id:practical-contained-e2e";
const gbpPhotoLink = "https://lh3.googleusercontent.com/p/practical-contained-e2e=w1200";
const sourcePhotoUrl = "https://lh3.googleusercontent.com/p/practical-contained-e2e=w1600-h1200";
const logoUrl = `${websiteUrl}images/practical-plumbing-logo.png`;

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function imageResponse(body, contentType) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-length": String(body.length),
      "content-type": contentType,
    },
  });
}

test("Practical Plumbing compile to mirror to render preserves one real contained GBP photo and passes media QC", async (t) => {
  const outDir = path.join(testRoot, "site");
  const sourcePhoto = await sharp({
    create: { width: 450, height: 600, channels: 3, background: "#6f6253" },
  }).jpeg({ quality: 88 }).toBuffer();
  const sourceLogo = await sharp({
    create: { width: 640, height: 200, channels: 4, background: "#163b59" },
  }).png().toBuffer();
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    rmSync(testRoot, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.SITEFORGE_DATA_DIR;
    else process.env.SITEFORGE_DATA_DIR = previousDataDir;
    if (previousFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previousFirecrawlKey;
  });

  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : {};
    requests.push({ target, source: body.url || "" });
    if (target.endsWith("/map")) {
      return jsonResponse({ success: true, links: [] });
    }
    if (target.endsWith("/scrape") && body.url === websiteUrl) {
      return jsonResponse({
        success: true,
        data: {
          markdown: [
            "# Practical Plumbing",
            "Practical Plumbing serves Killeen, Texas.",
            "Call (254) 768-9043 for water heater service, drain cleaning, leak repair, and plumbing fixtures.",
            "Our team handles residential plumbing service and repair.",
          ].join("\n\n"),
          links: [],
          images: [{ url: logoUrl, alt: "Practical Plumbing logo", context: "header brand logo" }],
          branding: { logo: logoUrl },
          rawHtml: "",
          metadata: { title: "Practical Plumbing" },
        },
      });
    }
    if (target.endsWith("/scrape") && String(body.url || "").includes("place_id:practical-contained-e2e")) {
      return jsonResponse({
        success: true,
        data: {
          markdown: "# Practical Plumbing\n1002 E Elms Rd Ste 103, Killeen, TX 76542\n[Call](tel:+12547689043)",
          links: [gbpPhotoLink],
          images: [],
          branding: {},
          rawHtml: "",
          metadata: { title: "Practical Plumbing" },
        },
      });
    }
    if (target === sourcePhotoUrl) return imageResponse(sourcePhoto, "image/jpeg");
    if (target === logoUrl) return imageResponse(sourceLogo, "image/png");
    throw new Error(`Unexpected request: ${target} ${body.url || ""}`);
  };
  globalThis.fetch = fetchImpl;

  const compiled = await compileFromInput({
    build_preview: false,
    name: "Practical Plumbing",
    city: "Killeen",
    state: "TX",
    category: "plumbing",
    phone: "(254) 768-9043",
    address: "1002 E Elms Rd Ste 103, Killeen, TX 76542",
    website_url: websiteUrl,
    gbp_url: gbpUrl,
    description: "Build from Practical Plumbing's public business content.",
  });
  assert.equal(compiled.ok, true);
  const compiledPhoto = compiled.assets.find((asset) => asset.kind === "photo");
  assert.ok(compiledPhoto, JSON.stringify({ assets: compiled.assets, sources: compiled.sources, warnings: compiled.warnings, requests }));
  assert.equal(compiledPhoto.source, "business-profile");
  assert.equal(compiledPhoto.width, 450);
  assert.equal(compiledPhoto.height, 600);
  assert.equal(compiledPhoto.hero_eligible, false);
  assert.equal(compiledPhoto.proof_eligible, true);
  assert.equal(compiledPhoto.meta.contained_source, true);
  assert.equal(compiledPhoto.meta.display_policy, "contained-source-proof");
  assert.deepEqual(compiledPhoto.meta.identity_evidence, ["name:practical", "phone:last7"]);

  const packet = {
    slug: "practical-plumbing-contained-e2e",
    forge: { demo: true },
    build_type: "single_page_cinematic",
    business: {
      name: "Practical Plumbing",
      category: "plumbing",
      city: "Killeen",
      state: "TX",
      phone: "(254) 768-9043",
      address: "1002 E Elms Rd Ste 103, Killeen, TX 76542",
      current_website: websiteUrl,
    },
    services: ["Water heater service", "Drain cleaning", "Leak repair", "Plumbing fixtures"],
    section_plan: ["trust-strip", "services", "process", "proof", "map", "faq", "cta"],
    media: { catalog: approvedPhotoCatalog(compiled.assets) },
    enrichment_sources: {
      name: { value: "Practical Plumbing", source: "business-site" },
      category: { value: "plumbing", source: "business-site" },
      city: { value: "Killeen", source: "business-site" },
      state: { value: "TX", source: "business-site" },
      phone: { value: "(254) 768-9043", source: "business-site" },
      website: { value: websiteUrl, source: "business-site" },
      address: { value: "1002 E Elms Rd Ste 103, Killeen, TX 76542", source: "business-profile" },
      latlng: { value: { lat: 31.0844, lng: -97.7289 }, source: "business-profile" },
    },
  };

  await hardenPreviewMedia(packet, { outDir, fetchImpl });
  assert.equal(packet.media.catalog.length, 1);
  const mirroredPhoto = packet.media.catalog[0];
  assert.equal(existsSync(mirroredPhoto.local_path), true);
  assert.equal(mirroredPhoto.width, 450);
  assert.equal(mirroredPhoto.height, 600);
  assert.equal(mirroredPhoto.meta.contained_source, true);
  assert.equal(mirroredPhoto.hero_eligible, false);
  assert.equal(mirroredPhoto.proof_eligible, true);
  assert.equal(isBoundContainedSourceProof(mirroredPhoto), true, JSON.stringify(mirroredPhoto));

  const ambiance = {
    kind: "video",
    url: "https://ai-ambiance.example/practical-plumbing-concept.mp4",
    source: "ai-ambiance",
    role: "ambiance",
    generated: true,
    ai_generated: true,
    hero_eligible: true,
    proof_eligible: false,
    approved: true,
  };
  const largeSourcePhoto = {
    kind: "photo",
    url: "https://business-site.example/hero-project.jpg",
    source: "business-site",
    label: "Completed plumbing project",
    width: 1200,
    height: 800,
    hero_eligible: true,
    proof_eligible: true,
    approved: true,
  };
  const mixedContainedPhoto = { ...mirroredPhoto, url: "media/practical-contained.jpg" };
  const mixedSelection = selectPremierMedia({
    media: { catalog: [mixedContainedPhoto, largeSourcePhoto, ambiance] },
  });
  assert.equal(mixedSelection.mode, "photo-cinematic-light");
  assert.equal(mixedSelection.hero?.url, largeSourcePhoto.url);
  assert.equal(mixedSelection.gallery.some((asset) => isBoundContainedSourceProof(asset)), true);

  const dimensionlessSourcePhoto = {
    ...largeSourcePhoto,
    url: "https://business-site.example/legacy-project.jpg",
  };
  delete dimensionlessSourcePhoto.width;
  delete dimensionlessSourcePhoto.height;
  const dimensionlessSelection = selectPremierMedia({
    media: { catalog: [dimensionlessSourcePhoto] },
  });
  assert.equal(dimensionlessSelection.mode, "photo-cinematic-light");
  assert.equal(dimensionlessSelection.hero?.url, dimensionlessSourcePhoto.url);

  packet.media.catalog.push(ambiance);
  await build(packet, { outDir, capture: false });

  const html = readFileSync(path.join(outDir, "index.html"), "utf8");
  const doc = new JSDOM(html).window.document;
  const containedFrame = doc.querySelector(".hero .premier-media--contained-source-proof");
  const containedFigure = containedFrame?.querySelector(".premier-source-sheet__item");
  const containedImage = containedFigure?.querySelector("img");
  assert.ok(containedFrame, "the real contained source photo must be the framed hero art");
  assert.ok(containedFrame.closest(".hero")?.classList.contains("has-real-media"));
  assert.equal(containedFrame.closest(".hero")?.classList.contains("media-blocked"), false);
  assert.equal(containedImage?.getAttribute("width"), "450");
  assert.equal(containedImage?.getAttribute("height"), "600");
  assert.ok(containedFigure.closest(".hero"));
  assert.equal(doc.querySelector('[data-media-source="ai-ambiance"]'), null);
  assert.equal(doc.querySelector("section.gallery"), null);
  assert.equal(doc.querySelectorAll(".premier-media--contained-source-proof img").length, 1);
  assert.equal(doc.querySelector("video[poster]"), null);
  assert.doesNotMatch(containedFrame.outerHTML, /w1600-h1200|unsplash|pexels|pixabay|data-ai-media|object-fit:\s*cover/i);

  const mediaDepth = checkMediaDepth(outDir);
  assert.equal(mediaDepth.pass, true, mediaDepth.detail);
  assert.equal(mediaDepth.verified_available_photo_count, 1);
  assert.equal(mediaDepth.verified_rendered_photo_count, 1);
  assert.equal(mediaDepth.target_photo_count, 1);

  const v7 = runV7Checks(outDir);
  assert.equal(v7.find((check) => check.name === "ai-imagery-labeled")?.pass, true);
  const visual = runVisualFidelityChecks(outDir);
  for (const gate of ["visual-rendered-media", "visual-source-carry-through", "visual-service-media-honesty"]) {
    const result = visual.find((check) => check.name === gate);
    assert.equal(result?.pass, true, `${gate}: ${result?.detail || "missing"}`);
  }

  const publicPacket = JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8"));
  const publicPhoto = publicPacket.media.catalog.find((asset) => asset.kind === "photo");
  assert.equal(publicPhoto.proof_eligible, true);
  assert.equal(publicPhoto.hero_eligible, false);
  assert.equal(publicPhoto.asset_identity.method, "content-sha256");
  assert.match(publicPhoto.asset_identity.sha256, /^[a-f0-9]{64}$/);

  const normalOutDir = path.join(testRoot, "normal-one-photo");
  await build({
    ...packet,
    slug: "normal-one-photo-regression",
    media: {
      catalog: [{
        kind: "photo",
        url: "https://business-site.example/project.jpg",
        source: "business-site",
        label: "Completed project",
        width: 1200,
        height: 800,
        hero_eligible: true,
        proof_eligible: true,
        approved: true,
      }],
    },
  }, { outDir: normalOutDir, capture: false });
  const normalDoc = new JSDOM(readFileSync(path.join(normalOutDir, "index.html"), "utf8")).window.document;
  assert.ok(normalDoc.querySelector('[data-media-source="photo"]'));
  assert.equal(normalDoc.querySelector("section.gallery"), null, "one normal hero photo must not be duplicated into a gallery");
});
