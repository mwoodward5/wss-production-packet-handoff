import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultHandler = require(join(repoRoot, "api", "intake-genie-compile.js"));

test("compile route keeps the five-minute Firecrawl execution budget", () => {
  assert.deepEqual(defaultHandler.config, { maxDuration: 300 });
});

function captureResponse() {
  let resolve;
  const complete = new Promise(done => { resolve = done; });
  const headers = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body, headers }); return this; },
    end(body = "") { resolve({ status: this.statusCode, body, headers }); return this; },
  };
  return { response, complete };
}

async function invoke(handler, { method = "POST", body = {}, authorization = "Bearer packet2-test-token", idempotencyKey = "", url = "/api/intake-genie/compile" } = {}) {
  const { response, complete } = captureResponse();
  await handler({ method, url, headers: { authorization, "idempotency-key": idempotencyKey }, body }, response);
  return complete;
}

async function withConfig(run) {
  const originalToken = process.env.INTAKE_GENIE_TOKEN;
  const originalFirecrawl = process.env.FIRECRAWL_API_KEY;
  process.env.INTAKE_GENIE_TOKEN = "packet2-test-token";
  process.env.FIRECRAWL_API_KEY = "firecrawl-test-key";
  try {
    return await run();
  } finally {
    if (originalToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalToken;
    if (originalFirecrawl === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawl;
  }
}

test("authenticated route rejects a bad bearer token before any harvest call", async () => {
  await withConfig(async () => {
    let harvestCalls = 0;
    const handler = defaultHandler.createHandler({
      harvestSources: async () => { harvestCalls += 1; throw new Error("must not run"); },
    });
    const result = await invoke(handler, { authorization: "Bearer wrong-token" });
    assert.equal(result.status, 401);
    assert.equal(result.body.ok, false);
    assert.equal(harvestCalls, 0);
    assert.equal(result.headers.get("cache-control"), "no-store");
  });
});

test("compiler surfaces an all-page harvest failure as retryable HTTP 503", async () => {
  await withConfig(async () => {
    let compileCalls = 0;
    const failureCoverage = {
      schema: "SourceHarvestCoverage/v1",
      attempted: ["https://harvest-down.example/", "https://harvest-down.example/services"],
      succeeded: [],
      failed: [
        { source: "https://harvest-down.example/", code: "provider_scrape_failed", error: "timeout" },
        { source: "https://harvest-down.example/services", code: "provider_scrape_failed", error: "timeout" },
      ],
      truncated: [],
      counts: { attempted: 2, succeeded: 0, failed: 2, truncated: 0, truncated_omitted: 0 },
    };
    const handler = defaultHandler.createHandler({
      harvestSources: async () => {
        const error = new Error("Firecrawl failed to harvest every attempted public source page.");
        error.code = "source_harvest_failed";
        error.retryable = true;
        error.statusCode = 503;
        error.coverage = failureCoverage;
        throw error;
      },
      compilePacket: () => { compileCalls += 1; throw new Error("compile must not run"); },
    });
    const result = await invoke(handler, {
      body: {
        request_id: "ghost:harvest-down:line-genie-certified-v7",
        website_url: "https://harvest-down.example/",
        prospect_hints: { name: "Harvest Down Roofing", city: "Reno", state: "NV", category: "Roofing" },
      },
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, "source_harvest_failed");
    assert.equal(result.body.retryable, true);
    assert.deepEqual(result.body.source_coverage, failureCoverage);
    assert.equal(compileCalls, 0);
  });
});

test("concurrent idempotent all-page failures share one harvest and both return typed retryable 503", async () => {
  await withConfig(async () => {
    let harvestCalls = 0;
    let rejectHarvest;
    let markHarvestStarted;
    const harvestStarted = new Promise(resolve => { markHarvestStarted = resolve; });
    const failureCoverage = {
      schema: "SourceHarvestCoverage/v1",
      attempted: ["https://concurrent-harvest-down.example/"],
      succeeded: [],
      failed: [{ source: "https://concurrent-harvest-down.example/", code: "provider_scrape_failed", error: "timeout" }],
      truncated: [],
      counts: { attempted: 1, succeeded: 0, failed: 1, truncated: 0, truncated_omitted: 0 },
    };
    const handler = defaultHandler.createHandler({
      harvestSources: () => {
        harvestCalls += 1;
        markHarvestStarted();
        return new Promise((unused, reject) => { rejectHarvest = reject; });
      },
    });
    const body = {
      request_id: "ghost:concurrent-harvest-down:line-genie-certified-v7",
      website_url: "https://concurrent-harvest-down.example/",
      prospect_hints: { name: "Concurrent Roofing", city: "Reno", state: "NV", category: "Roofing" },
    };

    const first = invoke(handler, { body, idempotencyKey: "same-failing-harvest" });
    await harvestStarted;
    const duplicate = invoke(handler, { body, idempotencyKey: "same-failing-harvest" });
    const error = new Error("Firecrawl failed to harvest every attempted public source page.");
    error.code = "source_harvest_failed";
    error.retryable = true;
    error.statusCode = 503;
    error.coverage = failureCoverage;
    rejectHarvest(error);

    const results = await Promise.all([first, duplicate]);
    assert.equal(harvestCalls, 1);
    for (const result of results) {
      assert.equal(result.status, 503);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.code, "source_harvest_failed");
      assert.equal(result.body.retryable, true);
      assert.deepEqual(result.body.source_coverage, failureCoverage);
    }
  });
});

test("partial harvest coverage and bounded page captures remain private and packet-hashed", async () => {
  await withConfig(async () => {
    const privatePhrase = "PRIVATE HARVEST PROSE MUST NEVER BECOME VISITOR COPY";
    const coverage = {
      schema: "SourceHarvestCoverage/v1",
      attempted: [
        "https://partial-roofing.example/",
        "https://partial-roofing.example/services",
        "https://partial-roofing.example/dead",
      ],
      succeeded: ["https://partial-roofing.example/services"],
      failed: [{
        source: "https://partial-roofing.example/dead",
        code: "provider_scrape_failed",
        error: "upstream timeout",
      }],
      truncated: ["https://partial-roofing.example/page-over-limit"],
      counts: { attempted: 3, succeeded: 1, failed: 1, truncated: 1, truncated_omitted: 0 },
    };
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://partial-roofing.example/services"],
        extracted: {
          brandName: "Partial Roofing",
          city: "Reno",
          state: "NV",
          domainUrl: "https://partial-roofing.example/",
          exactServices: "Roof Repair",
          mainServices: "Roof Repair",
        },
        observations: [
          {
            source: "https://partial-roofing.example/services",
            status: "succeeded",
            extracted: {
              brandName: "Partial Roofing",
              city: "Reno",
              state: "NV",
              domainUrl: "https://partial-roofing.example/",
              exactServices: "Roof Repair",
              mainServices: "Roof Repair",
            },
            private_source: {
              markdown: `${privatePhrase}\n${"x".repeat(30000)}`,
              markdown_chars: 30052,
              markdown_truncated: true,
              metadata: { title: "Partial Roofing services", ignored: "not retained" },
              media: {
                images: Array.from({ length: 30 }, (_, index) => ({
                  url: `https://partial-roofing.example/image-${index}.webp`,
                  alt: `Roof ${index}`,
                })),
                branding: { logo: "https://partial-roofing.example/logo.svg", colors: { primary: "#123456" } },
              },
            },
          },
          {
            source: "https://partial-roofing.example/dead",
            status: "failed",
            extracted: { exactServices: "Teleportation Roofing", mainServices: "Teleportation Roofing" },
            private_source: { markdown: "failed pages are not observations" },
          },
        ],
        evidence: [],
        coverage,
      }),
    });
    const result = await invoke(handler, {
      body: {
        request_id: "ghost:partial-roofing:line-genie-certified-v7",
        website_url: "https://partial-roofing.example/",
        prospect_hints: { name: "Partial Roofing", city: "Reno", state: "NV", category: "Roofing" },
      },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.status, "compiled");
    assert.deepEqual(result.body.facts.services, ["Roof Repair"]);
    assert.deepEqual(result.body.source_coverage, coverage);
    assert.deepEqual(result.body.packet2.sources.coverage, coverage);
    assert.equal(result.body.packet2.sources.observations.length, 1);
    const privateSource = result.body.packet2.sources.observations[0].private_source;
    assert.equal(privateSource.markdown, `${privatePhrase}
${"x".repeat(30000)}`);
    assert.equal(privateSource.markdown_truncated, true);
    assert.equal(privateSource.metadata.title, "Partial Roofing services");
    assert.equal(privateSource.metadata.ignored, undefined);
    assert.equal(privateSource.media.images.length, 24);
    assert.equal(privateSource.media.branding.logo, "https://partial-roofing.example/logo.svg");
    const visitorCopy = Object.values(result.body.content.content_contract.visitor_copy.files).join("\n");
    assert.doesNotMatch(visitorCopy, new RegExp(privatePhrase, "i"));
    assert.doesNotMatch(visitorCopy, /Teleportation Roofing/i);
    const mutatedPacket = structuredClone(result.body.packet2);
    mutatedPacket.sources.coverage.succeeded.push("https://partial-roofing.example/changed");
    assert.notEqual(defaultHandler.semanticPacketHash(mutatedPacket), result.body.packet2_hash);
  });
});

test("health check reports the canonical contract without exposing secrets", async () => {
  await withConfig(async () => {
    const result = await invoke(defaultHandler, { method: "GET", authorization: "", url: "/healthz" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, version: "intake-genie-v2", configured: true });
    assert.doesNotMatch(JSON.stringify(result.body), /packet2-test-token|firecrawl-test-key/);
    const post = await invoke(defaultHandler, { method: "POST", body: { website_url: "https://should-not-run.example" }, url: "/healthz" });
    assert.equal(post.status, 405);
    assert.match(post.body.error, /health check uses GET/i);
  });
});

test("Ghost URL-first request compiles one lossless PageHub Packet 2 and preserves rich source observations", async () => {
  await withConfig(async () => {
    const harvestCalls = [];
    const harvestSources = async options => {
      harvestCalls.push(structuredClone(options));
      const result = {
        ok: true,
        sources: [
          "https://fixture-plumbing.example/",
          "https://www.google.com/maps/place/Fixture+Plumbing",
          "https://facebook.com/fixtureplumbing",
          "https://instagram.com/fixtureplumbing",
        ],
        notes: ["Fixture source capture"],
        extracted: {
          brandName: "Fixture Plumbing",
          city: "Albuquerque",
          state: "NM",
          finalPhone: "(505) 555-0100",
          email: "hello@fixture-plumbing.example",
          address: "101 Water Way, Albuquerque, NM 87101",
          domainUrl: "https://fixture-plumbing.example",
          serviceArea: "Albuquerque, NM; Rio Rancho, NM",
          hours: "Monday-Friday 8:00 AM-5:00 PM",
          hoursSource: "Client website",
          exactServices: "Drain Cleaning\nWater Heater Repair",
          mainServices: "Drain Cleaning\nWater Heater Repair",
          protectedArtifacts: "Family-owned since 1998",
          logoCandidates: [{ url: "https://fixture-plumbing.example/assets/logo.svg", role: "header logo" }],
          imageCandidates: [
            { url: "https://fixture-plumbing.example/photos/van.webp", alt: "Fixture Plumbing van", role: "fleet" },
            { url: "https://fixture-plumbing.example/photos/team.webp", alt: "Fixture Plumbing team", role: "team" },
          ],
          brandPalette: [
            { hex: "#0A4A7A", role: "primary", source: "site CSS" },
            { hex: "#F4A024", role: "accent", source: "site CSS" },
          ],
          typographyDisplay: "Fraunces",
          typographyBody: "Inter",
          googleFontsUrl: "https://fonts.googleapis.com/css2?family=Fraunces&family=Inter",
          socialLinks: ["https://facebook.com/fixtureplumbing", "https://instagram.com/fixtureplumbing"],
        },
      };
      result.observations = [
        {
          source: "https://fixture-plumbing.example/unrelated",
          extracted: {
            brandPalette: [{ hex: "#FFFFFF", role: "background", source: "site CSS" }],
            typographyDisplay: "Roboto",
            typographyBody: "Arial",
            googleFontsUrl: "https://fonts.googleapis.com/css2?family=Roboto",
          },
        },
        {
          source: "https://copied-styles.example/fixture",
          extracted: {
            brandPalette: result.extracted.brandPalette,
            typographyDisplay: result.extracted.typographyDisplay,
            typographyBody: result.extracted.typographyBody,
            googleFontsUrl: result.extracted.googleFontsUrl,
          },
        },
        { source: "https://fixture-plumbing.example/services", extracted: result.extracted },
        { source: "https://facebook.com/fixtureplumbing", extracted: { socialLinks: ["https://facebook.com/fixtureplumbing"] } },
      ];
      return result;
    };
    let clock = 0;
    const handler = defaultHandler.createHandler({
      harvestSources,
      now: () => `2026-08-22T05:31:0${clock++}.000Z`,
    });
    const request = {
      request_id: "ghost:fixture-1:canonical-v1",
      mode: "full",
      website_url: "https://fixture-plumbing.example/",
      gbp_url: "https://www.google.com/maps/place/Fixture+Plumbing",
      facebook_url: "https://facebook.com/fixtureplumbing",
      instagram_url: "https://instagram.com/fixtureplumbing",
      social_url: "https://facebook.com/fixtureplumbing",
      sources: {
        website_url: "https://fixture-plumbing.example/",
        additional_urls: ["https://instagram.com/fixtureplumbing"],
      },
      prospect_hints: {
        name: "Fixture Plumbing hint",
        city: "Albuquerque",
        state: "NM",
        category: "Plumbing",
      },
      latlng: { lat: 35.0844, lng: -106.6504 },
      brand: {
        fonts: {
          display: "Fraunces",
          body: "Inter",
          href: "https://fonts.googleapis.com/css2?family=Fraunces&family=Inter",
        },
      },
      dry_run: true,
      build_preview: false,
      truth_law: "source_or_owner_only",
    };

    const first = await invoke(handler, { body: request, idempotencyKey: "fixture-run" });
    const second = await invoke(handler, { body: request, idempotencyKey: "fixture-run" });
    const transportOnly = await invoke(handler, {
      body: { ...request, request_id: "ghost:fixture-1:another-pipeline" },
      idempotencyKey: "fixture-run-transport",
    });
    const corrected = await invoke(handler, {
      body: { ...request, corrections: { phone: "(505) 555-0199" } },
      idempotencyKey: "fixture-run",
    });

    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.version, "intake-genie-v2");
    assert.equal(first.body.status, "compiled");
    assert.equal(first.body.scope.supported, true);
    assert.equal(first.body.facts.name, "Fixture Plumbing");
    assert.equal(first.body.facts.city, "Albuquerque");
    assert.equal(first.body.facts.state, "NM");
    assert.equal(first.body.facts.category, "Plumbing");
    assert.deepEqual(first.body.facts.services, ["Drain Cleaning", "Water Heater Repair"]);
    assert.deepEqual(first.body.facts.socials, ["https://facebook.com/fixtureplumbing", "https://instagram.com/fixtureplumbing"]);
    assert.deepEqual(first.body.facts.latlng, { lat: 35.0844, lng: -106.6504 });

    assert.equal(harvestCalls.length, 3, "same key+payload dedupes; transport replay and changed corrections are evaluated independently");
    assert.deepEqual(harvestCalls[0].urls, [
      "https://fixture-plumbing.example/",
      "https://www.google.com/maps/place/Fixture+Plumbing",
      "https://facebook.com/fixtureplumbing",
      "https://instagram.com/fixtureplumbing",
    ]);
    assert.equal(harvestCalls[0].apiKey, "firecrawl-test-key");

    const logo = first.body.assets.find(asset => asset.kind === "logo");
    const photos = first.body.assets.filter(asset => asset.kind === "photo");
    assert.equal(logo.url, "https://fixture-plumbing.example/assets/logo.svg");
    assert.equal(logo.observed_on, "https://fixture-plumbing.example/services");
    assert.equal(logo.ownership_verified, false);
    assert.equal(logo.verification_status, "unverified_url_observation");
    assert.equal(photos.length, 2);
    assert.ok(first.body.assets.every(asset => asset.ownership_verified === false));
    assert.ok(first.body.assets.every(asset => asset.approved !== true && asset.verified !== true));
    const phoneEvidence = first.body.evidence.find(row => row.field === "phone");
    assert.equal(phoneEvidence.source, "https://fixture-plumbing.example/services");
    assert.deepEqual(phoneEvidence.source_observations, ["https://fixture-plumbing.example/services"]);
    const aggregateServices = first.body.evidence.find(row => row.field === "services");
    assert.deepEqual(aggregateServices.value, ["Drain Cleaning", "Water Heater Repair"], "legacy aggregate evidence remains stable");
    assert.deepEqual(first.body.service_evidence.map(row => row.value), ["Drain Cleaning", "Water Heater Repair"]);
    assert.ok(first.body.service_evidence.every(row => row.source_url === "https://fixture-plumbing.example/services"));
    assert.deepEqual(first.body.brand.colors.slice(0, 2), ["#0A4A7A", "#F4A024"]);
    assert.equal(first.body.brand.source_url, "https://fixture-plumbing.example/services");
    assert.ok(first.body.brand.palette.every(row => row.source_url === "https://fixture-plumbing.example/services"));
    assert.deepEqual(first.body.brand.fonts, {
      display: "Fraunces",
      body: "Inter",
      href: "https://fonts.googleapis.com/css2?family=Fraunces&family=Inter",
      source_url: "https://fixture-plumbing.example/services",
    });
    assert.deepEqual(first.body.optimization.target_queries, [
      "Drain Cleaning Albuquerque NM",
      "Water Heater Repair Albuquerque NM",
    ]);

    assert.equal(first.body.packet2.version, "2.0");
    assert.equal(first.body.packet2.sources.extracted.protectedArtifacts, "Family-owned since 1998");
    assert.deepEqual(first.body.packet2.sources.intakeRequest.prospect_hints, request.prospect_hints);
    assert.deepEqual(first.body.packet2.brand.fonts, first.body.brand.fonts);
    assert.equal(first.body.packet2.brand.source_url, first.body.brand.source_url);
    assert.deepEqual(first.body.packet2.assetQa.logoCandidates, ["https://fixture-plumbing.example/assets/logo.svg"]);
    assert.equal(first.body.packet2.assetQa.imageCandidates.length, 2);
    assert.equal(first.body.packet2.compiled.services.length, 2);
    assert.match(first.body.packet2.compiled.services[0].longDescMd, /Drain Cleaning/i);
    assert.ok(Object.keys(first.body.packet2.compiled.contentFiles).length >= 8);
    assert.ok(first.body.packet2.compiled.contentQuality.totalWords > 0);
    assert.equal(first.body.packet2.compiled.contentQuality.reviewCount, 0, "visitor copy is judged by safety, not padding");
    assert.equal(first.body.content.content_files["content/home.md"], first.body.packet2.compiled.contentFiles["content/home.md"]);
    assert.deepEqual(first.body.content.content_contract, first.body.packet2.compiled.contentContract);
    assert.equal(first.body.content.content_contract.schema, "CertifiedPracticePacket/v1");
    assert.equal(first.body.content.content_contract.kind, "certified_practice_packet");
    assert.equal(first.body.content.content_contract.version, 1);
    assert.equal(first.body.content.content_contract.builder_instructions.public, false);
    assert.equal(first.body.content.content_contract.visitor_copy.kind, "visitor_copy");
    assert.equal(first.body.content.content_contract.visitor_copy.safety.pass, true);
    assert.deepEqual(first.body.content.content_contract.visitor_copy.safety.violations, []);
    const visitorFiles = first.body.content.content_contract.visitor_copy.files;
    const visitorHashes = first.body.content.content_contract.visitor_copy.file_hashes;
    assert.deepEqual(Object.keys(visitorHashes).sort(), Object.keys(visitorFiles).sort());
    for (const [path, copy] of Object.entries(visitorFiles)) {
      assert.equal(typeof copy, "string", `${path} visitor copy must be text`);
      assert.equal(visitorHashes[path], createHash("sha256").update(copy, "utf8").digest("hex"));
    }
    assert.equal(first.body.packet2.review.policy_version, "intake-request-service-fallback-v1");
    assert.deepEqual(first.body.packet2.review.warnings, []);
    assert.match(first.body.packet2_hash, /^[0-9a-f]{64}$/);
    const mutatedPacket = structuredClone(first.body.packet2);
    const firstVisitorPath = Object.keys(mutatedPacket.compiled.contentContract.visitor_copy.files)[0];
    mutatedPacket.compiled.contentContract.visitor_copy.files[firstVisitorPath] += "\nMutation";
    assert.notEqual(defaultHandler.semanticPacketHash(mutatedPacket), first.body.packet2_hash, "visitor-copy mutations change the packet hash");
    assert.equal(first.body.packet2_hash, second.body.packet2_hash, "idempotent replay returns the same Packet 2");
    assert.equal(first.body.packet2_hash, transportOnly.body.packet2_hash, "transport-only request fields do not change the semantic hash");
    assert.notEqual(first.body.packet2_hash, corrected.body.packet2_hash, "owner corrections change the semantic hash");
    assert.equal(corrected.body.facts.phone, "(505) 555-0199");
  });
});

test("real Ghost v7 top-level category and vertical are fallback hints, never observed evidence", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://ghost-shape.example/"],
        extracted: {
          brandName: "Ghost Shape Plumbing",
          city: "Reno",
          state: "NV",
          domainUrl: "https://ghost-shape.example/",
        },
        observations: [{
          source: "https://ghost-shape.example/",
          extracted: { brandName: "Ghost Shape Plumbing", city: "Reno", state: "NV" },
        }],
        evidence: [],
      }),
    });
    const result = await invoke(handler, {
      body: {
        request_id: "ghost:ghost-shape:line-genie-certified-v7",
        website_url: "https://ghost-shape.example/",
        sources: { website_url: "https://ghost-shape.example/" },
        category: "Plumbing",
        vertical: "Plumbing",
        prospect_hints: { name: "Ghost Shape Plumbing", city: "Reno", state: "NV" },
        intake_mode: "url_first",
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "compiled");
    assert.equal(result.body.facts.category, "Plumbing");
    assert.equal(result.body.facts.services_source, "category_default");
    const categoryEvidence = result.body.evidence.find(row => row.field === "category");
    assert.equal(categoryEvidence.source, "ghost_prospect_hint");
    assert.equal(categoryEvidence.provenance, "hint");
    assert.equal(categoryEvidence.verification_status, "unverified_hint");
    assert.equal(categoryEvidence.source_url, "");
  });
});

test("zero-source manual fallback compiles sparse structured hints without invoking Firecrawl", async () => {
  await withConfig(async () => {
    let harvestCalls = 0;
    const handler = defaultHandler.createHandler({
      harvestSources: async () => { harvestCalls += 1; throw new Error("manual fallback must not invoke a provider"); },
    });
    const result = await invoke(handler, {
      body: {
        request_id: "ghost:no-site-practice:line-genie-certified-v7",
        sources: {},
        category: "Dental",
        vertical: "Dental",
        prospect_hints: {
          name: "No Site Family Dental",
          city: "Reno",
          state: "NV",
          services: ["Unverified cosmetic laser dentistry"],
        },
        intake_mode: "manual_fallback",
      },
    });

    assert.equal(harvestCalls, 0);
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "compiled");
    assert.equal(result.body.facts.category, "Dental");
    assert.equal(result.body.facts.website, "");
    assert.equal(result.body.facts.services_source, "category_default");
    assert.deepEqual(result.body.facts.services, defaultHandler.categoryDefaultServices("Dental"));
    assert.deepEqual(result.body.assets, []);
    assert.deepEqual(result.body.packet2.sources.urls, []);
    assert.deepEqual(result.body.warnings.map(row => row.code), [
      "manual_fallback_no_public_sources",
      "service_hint_dropped",
    ]);
    assert.deepEqual(result.body.warnings[1].values, ["Unverified cosmetic laser dentistry"]);
    for (const field of ["name", "city", "state", "category"]) {
      const row = result.body.evidence.find(candidate => candidate.field === field);
      assert.equal(row.provenance, "hint", field);
      assert.equal(row.verification_status, "unverified_hint", field);
      assert.deepEqual(row.source_observations, [], field);
    }
    assert.equal(result.body.packet2.review.policy_version, "intake-request-service-fallback-v1");
    assert.deepEqual(result.body.packet2.review.warnings, result.body.warnings);
  });
});

test("search intent stays withheld when the canonical candidate has no city", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://locationless-plumbing.example/"],
        extracted: {
          brandName: "Locationless Plumbing",
          category: "Plumbing",
          domainUrl: "https://locationless-plumbing.example/",
          exactServices: "Drain Cleaning",
        },
        observations: [{
          source: "https://locationless-plumbing.example/services",
          extracted: {
            brandName: "Locationless Plumbing",
            category: "Plumbing",
            domainUrl: "https://locationless-plumbing.example/",
            exactServices: "Drain Cleaning",
          },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://locationless-plumbing.example/",
        prospect_hints: { name: "Locationless Plumbing", city: "Phoenix", state: "AZ", category: "Plumbing" },
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.optimization.target_queries, []);
  });
});

test("search intent normalizes a source-observed full state name to its abbreviation", async () => {
  await withConfig(async () => {
    const extracted = {
      brandName: "Nevada Roofing",
      city: "Reno",
      state: "Nevada",
      category: "Roofing",
      domainUrl: "https://nevada-roofing.example/",
      exactServices: "Roof repair",
    };
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://nevada-roofing.example/"],
        extracted,
        observations: [{ source: "https://nevada-roofing.example/services", extracted }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://nevada-roofing.example/",
        prospect_hints: { name: "Nevada Roofing", city: "Reno", state: "NV", category: "Roofing" },
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.optimization.target_queries, ["Roof repair Reno NV"]);
  });
});

test("path-scoped shared hosts cannot borrow a sibling tenant's brand or location evidence", async () => {
  await withConfig(async () => {
    const extracted = {
      brandName: "Victim Plumbing",
      city: "Reno",
      state: "NV",
      category: "Plumbing",
      domainUrl: "https://linktr.ee/victim-plumbing",
      exactServices: "Drain Cleaning",
      brandPalette: [{ hex: "#123456", role: "primary", source: "page CSS" }],
      typographyDisplay: "Oswald",
      typographyBody: "Inter",
      googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter&family=Oswald",
    };
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://linktr.ee/victim-plumbing", "https://linktr.ee/competitor"],
        extracted,
        observations: [{ source: "https://linktr.ee/competitor", extracted }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://linktr.ee/victim-plumbing",
        prospect_hints: { name: "Victim Plumbing", city: "Reno", state: "NV", category: "Plumbing" },
      },
    });
    // 2026-08-29 owner unblock: the sibling-tenant observation's services are
    // dropped (never adopted); the packet ships honest category defaults.
    assert.equal(result.status, 200);
    assert.equal(result.body.facts.services_source, "category_default");
    assert.deepEqual(result.body.facts.services, result.body.facts.services.filter(service => service !== "Drain Cleaning"));
  });
});

test("an exact tenant subdomain remains first-party when its canonical path is root", async () => {
  await withConfig(async () => {
    const website = "https://victim.notion.site/";
    const extracted = {
      brandName: "Victim Plumbing",
      city: "Reno",
      state: "NV",
      category: "Plumbing",
      domainUrl: website,
      exactServices: "Drain Cleaning",
      brandPalette: [{ hex: "#123456", role: "primary", source: "page CSS" }],
      typographyDisplay: "Oswald",
      typographyBody: "Inter",
      googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter&family=Oswald",
    };
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: [website],
        extracted,
        observations: [{ source: website, extracted }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: website,
        prospect_hints: { name: "Victim Plumbing", city: "Reno", state: "NV", category: "Plumbing" },
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.brand.source_url, website);
    assert.equal(result.body.brand.palette[0].source_url, website);
    assert.equal(result.body.brand.fonts.source_url, website);
    assert.deepEqual(result.body.optimization.target_queries, ["Drain Cleaning Reno NV"]);
  });
});

test("route-prefixed shared hosts bind the tenant ID, not only the route name", async () => {
  await withConfig(async () => {
    const compile = async (website, observedOn) => {
      const extracted = {
        brandName: "Victim Plumbing",
        city: "Reno",
        state: "NV",
        category: "Plumbing",
        domainUrl: website,
        exactServices: "Drain Cleaning",
        brandPalette: [{ hex: "#123456", role: "primary", source: "page CSS" }],
      };
      const handler = defaultHandler.createHandler({
        harvestSources: async () => ({
          ok: true,
          sources: [website, observedOn],
          extracted,
          observations: [{ source: observedOn, extracted }],
        }),
      });
      return invoke(handler, {
        body: {
          website_url: website,
          prospect_hints: { name: "Victim Plumbing", city: "Reno", state: "NV", category: "Plumbing" },
        },
      });
    };
    const cases = [
      {
        label: "Square book",
        website: "https://square.site/book/VICTIM",
        sibling: "https://square.site/book/COMPETITOR",
        own: "https://square.site/book/VICTIM/services",
      },
      {
        label: "YouTube channel",
        website: "https://youtube.com/channel/VICTIM",
        sibling: "https://youtube.com/channel/COMPETITOR",
        own: "https://youtube.com/channel/VICTIM/about",
      },
    ];
    for (const row of cases) {
      // 2026-08-29 owner unblock: sibling-tenant service observations are
      // dropped, never adopted; the packet ships honest category defaults.
      const rejected = await compile(row.website, row.sibling);
      assert.equal(rejected.status, 200, row.label);
      assert.equal(rejected.body.facts.services_source, "category_default", row.label);
      assert.deepEqual(rejected.body.facts.services.filter(service => service === "Drain Cleaning"), [], row.label);

      const accepted = await compile(row.website, row.own);
      assert.equal(accepted.status, 200, row.label);
      assert.equal(accepted.body.brand.source_url, row.own, row.label);
      assert.equal(accepted.body.brand.palette[0].source_url, row.own, row.label);
      assert.deepEqual(accepted.body.optimization.target_queries, ["Drain Cleaning Reno NV"], row.label);
    }
  });
});

test("Wix requires both the account subdomain and site slug", async () => {
  await withConfig(async () => {
    const website = "https://username.wixsite.com/site-one";
    const compile = async (observedOn) => {
      const extracted = {
        brandName: "Victim Plumbing",
        city: "Reno",
        state: "NV",
        category: "Plumbing",
        domainUrl: website,
        exactServices: "Drain Cleaning",
        brandPalette: [{ hex: "#123456", role: "primary", source: "page CSS" }],
      };
      const handler = defaultHandler.createHandler({
        harvestSources: async () => ({
          ok: true,
          sources: [website, observedOn],
          extracted,
          observations: [{ source: observedOn, extracted }],
        }),
      });
      return invoke(handler, {
        body: {
          website_url: website,
          prospect_hints: { name: "Victim Plumbing", city: "Reno", state: "NV", category: "Plumbing" },
        },
      });
    };

    // 2026-08-29 owner unblock: dropped sibling services -> honest defaults.
    const rejected = await compile("https://username.wixsite.com/site-two");
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.facts.services_source, "category_default");
    assert.deepEqual(rejected.body.facts.services.filter(service => service === "Drain Cleaning"), []);

    const accepted = await compile("https://username.wixsite.com/site-one/services");
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.brand.source_url, "https://username.wixsite.com/site-one/services");
    assert.equal(accepted.body.brand.palette[0].source_url, "https://username.wixsite.com/site-one/services");
    assert.deepEqual(accepted.body.optimization.target_queries, ["Drain Cleaning Reno NV"]);
  });
});

test("missing identity needs input, while missing logo alone never blocks the canonical Ghost handoff", async () => {
  await withConfig(async () => {
    const missingIdentityHandler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://unnamed.example/"],
        extracted: { domainUrl: "https://unnamed.example/", exactServices: "Repair" },
        notes: [],
      }),
    });
    const missing = await invoke(missingIdentityHandler, {
      body: { website_url: "https://unnamed.example/", prospect_hints: { city: "Austin", state: "TX" } },
    });
    assert.equal(missing.status, 200);
    assert.equal(missing.body.status, "needs_input");
    assert.deepEqual(missing.body.missing_facts, ["name", "category"]);
    assert.equal(missing.body.facts.name, "");
    assert.equal(missing.body.facts.category, "");

    const noLogoHandler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://no-logo-plumbing.example/"],
        extracted: {
          brandName: "No Logo Plumbing",
          domainUrl: "no-logo-plumbing.example",
          exactServices: "Drain Repair",
          logoCandidates: [],
          imageCandidates: [],
        },
        observations: [{
          source: "https://no-logo-plumbing.example/",
          extracted: { brandName: "No Logo Plumbing", exactServices: "Drain Repair" },
        }],
        notes: [],
      }),
    });
    const noLogo = await invoke(noLogoHandler, {
      body: {
        website_url: "https://no-logo-plumbing.example/",
        prospect_hints: { city: "Austin", state: "TX", category: "Plumbing" },
      },
    });
    assert.equal(noLogo.body.packet2.compiled.logoQa.status, "block", "legacy Packet 2 advisory remains visible");
    assert.equal(noLogo.body.status, "compiled", "canonical handoff leaves missing-logo fallback to Ghost's logo ladder");
    assert.equal(noLogo.body.facts.website, "https://no-logo-plumbing.example/");
    assert.equal(noLogo.body.evidence.find(row => row.field === "website").source, "https://no-logo-plumbing.example/");
    assert.deepEqual(noLogo.body.assets, []);
  });
});

test("business-name matching is token-safe across accents, punctuation, legal suffixes, and trailing location", () => {
  const locations = [{ city: "Dallas", state: "TX" }];
  const accepted = [
    ["ACME Roofing, LLC", "Acme Roofing"],
    ["Acme Roofing & Co.", "Acme Roofing"],
    ["Acme Roofing, L.L.C.", "Acme Roofing"],
    ["José's Roofing, Inc.", "Joses Roofing"],
    ["Acme Roofing — Dallas, Texas", "Acme Roofing"],
    ["North Star Roofing Company Dallas TX", "North Star Roofing"],
    ["Acme Roofing & Exteriors", "Acme Roofing"],
    ["Elite Concrete Contractors of Houston", "Elite Concrete Contractors"],
    ["Houston Elite Concrete Contractors", "Elite Concrete Contractors"],
    ["A-1 Roofing", "A1 Roofing"],
    ["C.A.R.S. Plumbing", "CARS Plumbing"],
    ["A-1 Roofing & Exteriors", "A1 Roofing"],
    ["C.A.R.S. Plumbing Services", "CARS Plumbing"],
    ["Acme", "Acme Roofing"],
    // Production certification kills (wss_batches.json, business_name_mismatch):
    // spaced initials must match their compacted registration forms.
    ["E.R. Services", "ER Services"],
    ["E.R. Services, Inc.", "E.R. Services"],
    ["H D Pros, LLC.", "HD Pros"],
    // Embedded (non-prefix) candidate sequences inside a longer compiled name.
    ["LS Ready Mix, LLC", "LS Ready Mix of Texas"],
    // Ampersand/punctuation forms of the same multi-trade brand.
    ["ASAP Heating, Air & Plumbing", "ASAP Heating Air and Plumbing, LLC"],
    ["Rite Way Heating, Cooling & Plumbing", "Rite Way Heating Cooling and Plumbing LLC"],
    // Compiled short-form registration of a longer site brand.
    ["Suddenly Slimmer Day and Med Spa", "Suddenly Slimmer"],
    // Documented policy: a single-token candidate matches when the shared token
    // is fully embedded in the compiled name (token-sequence contains match).
    ["Fence", "Dallas Fence Company"],
  ];
  for (const [candidate, compiled] of accepted) {
    assert.equal(defaultHandler.businessNamesMatch(candidate, compiled, locations), true, `${candidate} matches ${compiled}`);
  }
  const refused = [
    ["Acme Roofing", "Acme Plumbing"],
    ["Roof", "Roofer"],
    ["North Star Roofing", "South Star Roofing"],
    // Different company in a different trade must never certify.
    ["Bill's Plumbing", "Acme Roofing"],
    // Scraped page headlines passed as candidate names must not certify an
    // unrelated compiled brand (production headline-kill class).
    ["Your Full-Service Plumbing Partner", "Acme Roofing"],
    ["Building Quality. Building Value. Building People.", "Acme Roofing"],
    // A candidate subset bridged by extra tokens is not an adjacent sequence:
    // "day and med spa" does not contain "day spa" (no reordering, no gaps).
    ["Suddenly Slimmer Day and Med Spa", "Suddenly Slimmer Day Spa"],
  ];
  for (const [candidate, compiled] of refused) {
    assert.equal(defaultHandler.businessNamesMatch(candidate, compiled, locations), false, `${candidate} does not match ${compiled}`);
  }
  assert.equal(defaultHandler.businessNamesMatch(
    "Blue Sky Plumbing Austin",
    "Blue Sky Plumbing Dallas",
    [{ city: "Austin", state: "TX" }, { city: "Dallas", state: "TX" }],
  ), false, "conflicting locations cannot both be normalized away");
});

test("location-bridge tolerance binds only the prospect's own city or state between brand tokens", () => {
  const austin = [{ city: "Austin", state: "TX" }];
  const hvacAustin = [
    { city: "Austin", state: "TX", category: "HVAC" },
    { city: "Austin", state: "TX", category: "HVAC" },
  ];
  // Pinned production regression (eliteaustinac.com): the miner-harvested pick
  // inserts the prospect's own city between brand tokens while the site
  // identity omits it. Strict adjacent-sequence containment refused the pair.
  const accepted = [
    ["Elite Austin AC & Plumbing", "Elite AC & Plumbing", austin],
    ["Elite AC & Plumbing", "Elite Austin AC & Plumbing", austin],
    // The prospect's own state bridges the same way, in either spelling.
    ["Elite Texas AC & Plumbing", "Elite AC & Plumbing", austin],
    ["Elite AC Texas & Plumbing", "Elite AC & Plumbing", austin],
    // Bridge survives the HVAC alias expansion on both sides.
    ["Elite Austin AC & Plumbing", "Elite AC & Plumbing", hvacAustin],
    // Two bridged tokens in one gap stay inside the cap.
    ["Elite Austin Texas AC & Plumbing", "Elite AC & Plumbing", austin],
  ];
  for (const [candidate, compiled, contexts] of accepted) {
    assert.equal(defaultHandler.businessNamesMatch(candidate, compiled, contexts), true, `${candidate} matches ${compiled}`);
  }
  const refused = [
    // A different city is not the prospect's location context and must not
    // bridge, in either direction.
    ["Elite Dallas AC & Plumbing", "Elite AC & Plumbing", austin],
    ["Elite AC & Plumbing", "Elite Dallas AC & Plumbing", austin],
    // Any non-location bridge word still breaks contiguity.
    ["Elite Premium AC & Plumbing", "Elite AC & Plumbing", austin],
    ["Elite AC & Plumbing", "Elite Premium AC & Plumbing", austin],
    // Per-gap cap: a three-token city cannot bridge in one gap.
    ["Elite Salt Lake City AC & Plumbing", "Elite AC & Plumbing", [{ city: "Salt Lake City", state: "UT" }]],
    // Total cap: four bridged tokens across two gaps refuse.
    ["Elite Austin Texas AC Austin Texas & Plumbing", "Elite AC & Plumbing", austin],
  ];
  for (const [candidate, compiled, contexts] of refused) {
    assert.equal(defaultHandler.businessNamesMatch(candidate, compiled, contexts), false, `${candidate} does not match ${compiled}`);
  }
});

test("HVAC name aliases match standard AC decoration only inside a confirmed HVAC category", () => {
  const hvacContexts = [
    { city: "Austin", state: "TX", category: "HVAC" },
    { city: "Austin", state: "TX", category: "Air conditioning contractor" },
  ];
  const accepted = [
    ["Island Breeze AC", "Island Breeze Air Conditioning & Heating"],
    ["Island Breeze A/C", "Island Breeze Air Conditioning and Heating"],
    ["Island Breeze A.C.", "Island Breeze Air Conditioning & Heating"],
  ];
  for (const [candidate, compiled] of accepted) {
    assert.equal(defaultHandler.businessNamesMatch(candidate, compiled, hvacContexts), true, `${candidate} matches ${compiled}`);
  }
  for (const category of ["Heating contractor", "Heating & Cooling contractor", "Cooling contractor"]) {
    const contexts = [
      { city: "Austin", state: "TX", category },
      { city: "Austin", state: "TX", category },
    ];
    assert.equal(
      defaultHandler.businessNamesMatch("Island Breeze AC", "Island Breeze Air Conditioning & Heating", contexts),
      true,
      `standard directory category ${category} enables the alias`,
    );
  }

  const refused = [
    ["Acme Roofing", "Acme Plumbing", hvacContexts],
    ["Island Breeze AC", "Island Plumbing", hvacContexts],
    ["AC", "Air Conditioning", hvacContexts],
    [
      "Island Breeze AC",
      "Island Breeze Air Conditioning & Heating",
      [
        { city: "Austin", state: "TX", category: "Plumbing" },
        { city: "Austin", state: "TX", category: "Plumbing contractor" },
      ],
    ],
  ];
  for (const [candidate, compiled, contexts] of refused) {
    assert.equal(defaultHandler.businessNamesMatch(candidate, compiled, contexts), false, `${candidate} does not match ${compiled}`);
  }
});

test("the live Island Breeze AC candidate clears full certification against its expanded site name", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://island-breeze.example/"],
        extracted: {
          brandName: "Island Breeze Air Conditioning & Heating",
          city: "Austin",
          state: "TX",
          category: "Air conditioning contractor",
          domainUrl: "https://island-breeze.example/",
          exactServices: "Air conditioning repair",
        },
        observations: [{
          source: "https://island-breeze.example/",
          extracted: {
            brandName: "Island Breeze Air Conditioning & Heating",
            exactServices: "Air conditioning repair",
          },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://island-breeze.example/",
        prospect_hints: {
          name: "Island Breeze AC",
          city: "Austin",
          state: "TX",
          category: "HVAC",
        },
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "compiled");
    assert.equal(result.body.facts.name, "Island Breeze Air Conditioning & Heating");
  });
});

test("the live Elite Austin AC & Plumbing pick clears certification against its city-bridged site name", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://eliteaustinac.example/"],
        extracted: {
          brandName: "Elite AC & Plumbing",
          city: "Austin",
          state: "TX",
          category: "Plumbing",
          domainUrl: "https://eliteaustinac.example/",
          exactServices: "Drain cleaning",
        },
        observations: [{
          source: "https://eliteaustinac.example/",
          extracted: { brandName: "Elite AC & Plumbing", exactServices: "Drain cleaning" },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        request_id: "ghost:elite-austin:1",
        website_url: "https://eliteaustinac.example/",
        prospect_hints: {
          name: "Elite Austin AC & Plumbing",
          city: "Austin",
          state: "TX",
          category: "Plumbing",
        },
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "compiled");
    assert.equal(result.body.facts.name, "Elite AC & Plumbing");
  });
});

test("a wrong-city bridge in the pick name still refuses certification", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://eliteaustinac.example/"],
        extracted: {
          brandName: "Elite AC & Plumbing",
          city: "Austin",
          state: "TX",
          category: "Plumbing",
          domainUrl: "https://eliteaustinac.example/",
          exactServices: "Drain cleaning",
        },
        observations: [{
          source: "https://eliteaustinac.example/",
          extracted: { brandName: "Elite AC & Plumbing", exactServices: "Drain cleaning" },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        request_id: "ghost:elite-dallas:1",
        website_url: "https://eliteaustinac.example/",
        prospect_hints: {
          name: "Elite Dallas AC & Plumbing",
          city: "Austin",
          state: "TX",
          category: "Plumbing",
        },
      },
    });
    assert.equal(result.status, 422);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.status, "refused");
    assert.equal(result.body.problems[0].code, "business_name_mismatch");
    assert.deepEqual(result.body.problems[0].compared, {
      candidate: "Elite Dallas AC & Plumbing",
      compiled: "Elite AC & Plumbing",
    });
  });
});

test("punctuated state abbreviations normalize without hiding category mismatches", async () => {
  await withConfig(async () => {
    const matchingHandler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-roofing.example/"],
        extracted: {
          brandName: "Acme Roofing",
          city: "Albany",
          state: "N.Y.",
          category: "Roofing contractor",
          domainUrl: "https://acme-roofing.example/",
          exactServices: "Roof repair",
        },
        observations: [{
          source: "https://acme-roofing.example/",
          extracted: { brandName: "Acme Roofing", city: "Albany", state: "N.Y.", exactServices: "Roof repair" },
        }],
      }),
    });
    const matching = await invoke(matchingHandler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: { name: "Acme Roofing", city: "Albany", state: "NY", category: "Roofing" },
      },
    });
    assert.equal(matching.status, 200);
    assert.equal(matching.body.status, "compiled");
    assert.equal(matching.body.facts.category, "Roofing");
    assert.equal(matching.body.content.content_contract.facts.category, "roofing");
    assert.equal(matching.body.packet2.sources.extracted.category, "Roofing contractor");
    assert.deepEqual(matching.body.optimization.target_queries, ["Roof repair Albany NY"]);

    const genericCategoryHandler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://sparse-roofing.example/"],
        extracted: {
          brandName: "Sparse Roofing",
          city: "Albany",
          state: "NY",
          category: "Contractor",
          domainUrl: "https://sparse-roofing.example/",
        },
        observations: [{
          source: "https://sparse-roofing.example/",
          extracted: { brandName: "Sparse Roofing", category: "Contractor" },
        }],
      }),
    });
    const genericCategory = await invoke(genericCategoryHandler, {
      body: {
        website_url: "https://sparse-roofing.example/",
        prospect_hints: { name: "Sparse Roofing", city: "Albany", state: "NY", category: "Roofing" },
      },
    });
    assert.equal(genericCategory.status, 200);
    assert.equal(genericCategory.body.status, "compiled");
    assert.equal(genericCategory.body.facts.category, "Roofing");
    assert.equal(genericCategory.body.facts.services_source, "category_default");
    assert.equal(genericCategory.body.packet2.sources.extracted.category, "Contractor");
    const categoryEvidence = genericCategory.body.evidence.find(row => row.field === "category");
    assert.equal(categoryEvidence.source, "ghost_prospect_hint");
    assert.equal(categoryEvidence.provenance, "hint");

    let compileCalls = 0;
    const mismatchHandler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-roofing.example/"],
        extracted: {
          brandName: "Acme Roofing",
          city: "Albany",
          state: "NY",
          category: "Plumbing contractor",
          domainUrl: "https://acme-roofing.example/",
        },
        observations: [{
          source: "https://acme-roofing.example/",
          extracted: { brandName: "Acme Roofing" },
        }],
      }),
      compilePacket: () => { compileCalls += 1; throw new Error("category refusal must precede Packet 2 compilation"); },
    });
    const mismatch = await invoke(mismatchHandler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: { name: "Acme Roofing", city: "Albany", state: "NY", category: "Roofing" },
      },
    });

    assert.equal(mismatch.status, 422);
    assert.equal(compileCalls, 0);
    const problem = mismatch.body.problems.find(row => row.code === "business_category_mismatch");
    assert.deepEqual(problem.compared, {
      candidate: "Roofing",
      compiled: "Plumbing contractor",
    });
    assert.equal(problem.expected, "Roofing");
    assert.equal(problem.actual, "Plumbing contractor");
  });
});

test("a wrong harvested business is refused with HTTP 422 and exact compared values", async () => {
  await withConfig(async () => {
    let compileCalls = 0;
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://wrong-plumbing.example/"],
        extracted: {
          brandName: "Wrong Plumbing LLC",
          city: "Austin",
          state: "TX",
          category: "Plumbing",
          domainUrl: "https://wrong-plumbing.example/",
          exactServices: "Drain cleaning",
        },
        observations: [{
          source: "https://wrong-plumbing.example/",
          extracted: { brandName: "Wrong Plumbing LLC", exactServices: "Drain cleaning" },
        }],
      }),
      compilePacket: () => { compileCalls += 1; throw new Error("refusal must happen before Packet 2 compilation"); },
    });
    const request = {
      request_id: "ghost:right-roofing:1",
      website_url: "https://wrong-plumbing.example/",
      prospect_hints: { name: "Right Roofing, LLC", city: "Austin", state: "TX", category: "Roofing" },
    };
    const first = await invoke(handler, { body: request, idempotencyKey: "wrong-business" });
    const cached = await invoke(handler, { body: request, idempotencyKey: "wrong-business" });

    assert.equal(first.status, 422);
    assert.equal(cached.status, 422, "cached refusals keep their candidate-local HTTP status");
    assert.equal(first.body.ok, false);
    assert.equal(first.body.status, "refused");
    assert.equal(compileCalls, 0);
    assert.deepEqual(first.body.problems[0].compared, {
      candidate: "Right Roofing, LLC",
      compiled: "Wrong Plumbing LLC",
    });
    assert.equal(first.body.problems[0].expected, "Right Roofing, LLC");
    assert.equal(first.body.problems[0].actual, "Wrong Plumbing LLC");
    assert.equal(first.body.problems[0].code, "business_name_mismatch");
  });
});

test("known categories receive explicitly estimated default services when no service claim was found", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-roofing.example/"],
        extracted: {
          brandName: "Acme Roofing LLC",
          domainUrl: "https://acme-roofing.example/",
        },
        observations: [{
          source: "https://acme-roofing.example/",
          extracted: { brandName: "Acme Roofing LLC", domainUrl: "https://acme-roofing.example/" },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: { name: "Acme Roofing", city: "Dallas", state: "TX", category: "Roofing contractor" },
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "compiled");
    assert.equal(result.body.facts.services_source, "category_default");
    assert.equal(result.body.facts.estimated, true);
    assert.deepEqual(result.body.facts.services, defaultHandler.categoryDefaultServices("Roofing contractor"));
    const evidence = result.body.evidence.filter(row => row.field === "services");
    assert.equal(evidence.length, result.body.facts.services.length);
    assert.deepEqual(evidence.map(row => row.value), result.body.facts.services);
    for (const row of evidence) {
      assert.equal(row.source_type, "category_default");
      assert.equal(row.provenance, "estimated");
      assert.equal(row.verification_status, "estimated");
      assert.equal(row.estimated, true);
      for (const key of ["source", "source_url", "url", "evidence_url", "verified", "status"]) {
        assert.equal(Object.prototype.hasOwnProperty.call(row, key), false, `${key} must be absent from default disclosure`);
      }
    }
    assert.equal(result.body.packet2.business.servicesSource, "category_default");
    assert.equal(result.body.packet2.business.exactServices, "", "estimated defaults do not become public service claims");
    assert.equal(result.body.content.services.length, 0, "estimated defaults do not generate service pages or schema input");
    assert.deepEqual(result.body.optimization.target_queries, [], "estimated defaults do not become proven search intent");
    assert.deepEqual(defaultHandler.categoryDefaultServices("Unknown vertical"), []);
    assert.ok(defaultHandler.categoryDefaultServices("Plumber").length >= 3);
    assert.ok(defaultHandler.categoryDefaultServices("HVAC contractor").length >= 3);
    assert.ok(defaultHandler.categoryDefaultServices("Electrician").length >= 3);
    assert.deepEqual(
      defaultHandler.categoryDefaultServices("Clean energy solar installer"),
      defaultHandler.categoryDefaultServices("Solar"),
    );
    assert.deepEqual(
      defaultHandler.categoryDefaultServices("Construction company"),
      defaultHandler.categoryDefaultServices("General contractor"),
    );
    assert.deepEqual(
      defaultHandler.categoryDefaultServices("Carpenter"),
      defaultHandler.categoryDefaultServices("General contractor"),
    );
    for (const [specific, family] of [
      ["Concrete construction company", "Concrete"],
      ["Fence construction", "Fencing"],
      ["Landscape construction", "Landscaping"],
      ["Pool construction", "Pool service"],
    ]) {
      assert.deepEqual(
        defaultHandler.categoryDefaultServices(specific),
        defaultHandler.categoryDefaultServices(family),
        `${specific} keeps the specific vertical`,
      );
    }
  });
});

test("resource and navigation headings are absence, so supported categories use honest defaults", async () => {
  await withConfig(async () => {
    for (const heading of [
      "Useful Links for Your Community", "Community Resources", "About Us", "Reviews",
      "FAQs", "Service Areas", "Contact Us", "Financing", "Blog",
    ]) {
      const handler = defaultHandler.createHandler({
        harvestSources: async () => ({
          ok: true,
          sources: ["https://acme-roofing.example/"],
          extracted: {
            brandName: "Acme Roofing", domainUrl: "https://acme-roofing.example/", exactServices: heading,
          },
          observations: [{
            source: "https://acme-roofing.example/",
            extracted: { brandName: "Acme Roofing", exactServices: heading },
          }],
        }),
      });
      const result = await invoke(handler, {
        body: {
          website_url: "https://acme-roofing.example/",
          prospect_hints: { name: "Acme Roofing", city: "Dallas", state: "TX", category: "Roofing" },
        },
      });
      assert.equal(result.status, 200, heading);
      assert.equal(result.body.facts.services_source, "category_default", heading);
      assert.deepEqual(result.body.content.services, [], heading);
      assert.equal(result.body.packet2.business.exactServices, "", heading);
      assert.ok(result.body.evidence.filter(row => row.field === "services").every(row => row.source_type === "category_default"), heading);
    }
  });
});

test("source-backed real services remain source observations after heading filtering", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-fence.example/"],
        extracted: { brandName: "Acme Fence", domainUrl: "https://acme-fence.example/", exactServices: "Fence Installation" },
        observations: [{
          source: "https://acme-fence.example/",
          extracted: { brandName: "Acme Fence", exactServices: "Fence Installation" },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-fence.example/",
        prospect_hints: { name: "Acme Fence", city: "Dallas", state: "TX", category: "Fencing" },
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.facts.services_source, "source_observation");
    assert.deepEqual(result.body.facts.services, ["Fence Installation"]);
  });
});

test("category defaults cover every supported Ghost vertical without collapsing specific trades", () => {
  // Snapshot of Ghost APPROVED_CATEGORIES, plus the two compatibility
  // verticals required by this compiler contract. Keep this independent from
  // the compiler map so a new Ghost vertical cannot silently ship with no default.
  const supportedGhostVerticals = [
    "tattoo", "med spa", "dental", "photographer", "piercing",
    "attorney", "massage", "hair salon", "barber", "nail studio",
    "wedding vendor", "event vendor", "real estate agent", "auto detailing",
    "ceramic coating", "roofing", "water damage restoration", "hvac",
    "plumbing", "home remodeling", "concrete", "electrical", "masonry",
    "general contractor", "landscaping", "tree service", "fencing",
    "garage door", "pest control", "flooring contractor",
    "pressure washing service",
  ];

  assert.deepEqual(
    supportedGhostVerticals.filter(category => defaultHandler.categoryDefaultServices(category).length < 3),
    [],
    "every supported vertical has a useful estimated service menu",
  );

  const specificDefaults = new Map([
    ["event vendors", "Event vendor services"],
    ["water damage", "Water damage restoration services"],
    ["mason", "Masonry services"],
    ["floor installer", "Flooring services"],
    ["power washing", "Pressure washing services"],
    ["realtor", "Real estate services"],
  ]);
  for (const [category, expectedFirstService] of specificDefaults) {
    assert.equal(
      defaultHandler.categoryDefaultServices(category)[0],
      expectedFirstService,
      `${category} resolves to its specific service family`,
    );
  }

  assert.notDeepEqual(
    defaultHandler.categoryDefaultServices("Masonry contractor"),
    defaultHandler.categoryDefaultServices("General contractor"),
    "masonry must not collapse into generic contracting",
  );
  assert.notDeepEqual(
    defaultHandler.categoryDefaultServices("Pressure washing service"),
    defaultHandler.categoryDefaultServices("Cleaning service"),
    "pressure washing must not collapse into generic cleaning",
  );
  assert.deepEqual(
    defaultHandler.categoryDefaultServices("Salon"),
    defaultHandler.categoryDefaultServices("Hair salon"),
    "the required plain salon category maps to conservative hair-salon defaults",
  );
  for (const productCategory of [
    "Roofing materials supplier",
    "Dental equipment supplier",
    "Solar panel retailer",
  ]) {
    assert.deepEqual(
      defaultHandler.categoryDefaultServices(productCategory),
      [],
      `${productCategory} is a product business, not an eligible service vertical`,
    );
  }
  for (const category of ["Wedding photographer", "Bridal photographer"]) {
    assert.deepEqual(
      defaultHandler.categoryDefaultServices(category),
      defaultHandler.categoryDefaultServices("Photographer"),
      `${category} stays in the photographer family`,
    );
  }

  const everyDefault = Object.values(defaultHandler.CATEGORY_DEFAULT_SERVICES).flat();
  assert.doesNotMatch(
    everyDefault.join("\n"),
    /\b(?:emergency|warrant(?:y|ies)|financing|certified|credential|paint correction|ceramic coating|hot towel|day-of|vendor coordination|event design|monitoring|stump grinding|implant|veneer|injectable|botox|filler)\b/i,
    "estimated defaults stay generic and never invent specialty or commercial claims",
  );
});

test("plumbing no-service packets use the same URL-free estimated scaffold", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://superior-plumbing.example/"],
        extracted: {
          brandName: "Superior Plumbing",
          city: "Denver",
          state: "CO",
          category: "Plumber",
          domainUrl: "https://superior-plumbing.example/",
        },
        observations: [{
          source: "https://superior-plumbing.example/",
          extracted: { brandName: "Superior Plumbing", city: "Denver", state: "CO", category: "Plumber" },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        request_id: "ghost:superior-plumbing:fixture",
        website_url: "https://superior-plumbing.example/",
        prospect_hints: { name: "Superior Plumbing", city: "Denver", state: "CO", category: "Plumbing" },
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "compiled");
    assert.equal(result.body.facts.services_source, "category_default");
    assert.equal(result.body.facts.estimated, true);
    assert.deepEqual(result.body.facts.services, defaultHandler.categoryDefaultServices("Plumbing"));
    const rows = result.body.evidence.filter(row => row.field === "services");
    assert.equal(rows.length, result.body.facts.services.length);
    assert.ok(rows.every(row => row.estimated === true && row.source_type === "category_default"));
    assert.ok(rows.every(row => !Object.keys(row).some(key => /(?:^|_)url$/.test(key))));
  });
});

test("unknown categories remain a structured missing-services refusal", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://unknown-trade.example/"],
        extracted: { brandName: "Unknown Trade", domainUrl: "https://unknown-trade.example/" },
        observations: [{ source: "https://unknown-trade.example/", extracted: { brandName: "Unknown Trade" } }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://unknown-trade.example/",
        prospect_hints: { name: "Unknown Trade", city: "Austin", state: "TX", category: "Unmapped specialty" },
      },
    });

    assert.equal(result.status, 422);
    assert.deepEqual(result.body.facts.services, []);
    assert.equal(result.body.facts.services_source, "");
    assert.deepEqual(
      result.body.problems.map(problem => problem.code),
      ["services_missing", "category_default_unavailable"],
    );
  });
});

test("missing category is named in a structured missing-services refusal", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://unknown-trade.example/"],
        extracted: { brandName: "Unknown Trade", domainUrl: "https://unknown-trade.example/" },
        observations: [{ source: "https://unknown-trade.example/", extracted: { brandName: "Unknown Trade" } }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://unknown-trade.example/",
        prospect_hints: { name: "Unknown Trade", city: "Austin", state: "TX" },
      },
    });

    assert.equal(result.status, 422);
    assert.deepEqual(
      result.body.problems.map(problem => problem.code),
      ["services_missing", "category_unknown", "category_default_unavailable"],
    );
  });
});

test("a wrong-domain present service claim refuses instead of laundering into defaults", async () => {
  await withConfig(async () => {
    const wrongDomainClaim = {
      field: "services",
      value: "Unsupported specialty coating",
      source_url: "https://other-business.example/services",
      verified: true,
    };
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-roofing.example/"],
        extracted: { brandName: "Acme Roofing", domainUrl: "https://acme-roofing.example/" },
        observations: [{ source: "https://acme-roofing.example/", extracted: { brandName: "Acme Roofing" } }],
        evidence: [structuredClone(wrongDomainClaim)],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: { name: "Acme Roofing", city: "Austin", state: "TX", category: "Roofing" },
        evidence: [wrongDomainClaim],
      },
    });

    assert.equal(result.status, 422);
    assert.equal(result.body.facts.services_default_disqualified, true);
    assert.notEqual(result.body.facts.services_source, "category_default");
    assert.equal(result.body.evidence.some(row => row.source_type === "category_default"), false);
    assert.deepEqual(result.body.warnings, []);
    assert.match(result.body.problems[0].message, /independently wrong-domain/i);
    assert.deepEqual(
      result.body.problems.map(problem => problem.code),
      ["present_service_evidence_invalid"],
    );
  });
});

test("same-domain verified service evidence cannot invent a service absent from source observations", async () => {
  await withConfig(async () => {
    const inventedClaim = {
      field: "services",
      value: "Teleportation Roofing",
      source_url: "https://acme-roofing.example/fake",
      verified: true,
      verification_status: "verified",
    };
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-roofing.example/"],
        extracted: { brandName: "Acme Roofing", domainUrl: "https://acme-roofing.example/" },
        observations: [{
          source: "https://acme-roofing.example/",
          extracted: { brandName: "Acme Roofing" },
        }],
        evidence: [structuredClone(inventedClaim)],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: { name: "Acme Roofing", city: "Austin", state: "TX", category: "Roofing" },
        evidence: [inventedClaim],
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "compiled");
    assert.equal(result.body.facts.services_source, "category_default");
    assert.equal(result.body.facts.services.includes("Teleportation Roofing"), false);
    assert.equal(JSON.stringify(result.body.evidence).includes("Teleportation Roofing"), false);
    assert.deepEqual(result.body.warnings, [{
      code: "service_evidence_dropped",
      field: "services",
      values: ["Teleportation Roofing"],
      message: "Unaccepted service evidence was dropped because it was not independently verified.",
    }]);
    assert.deepEqual(result.body.problems || [], []);
  });
});

test("a caller-listed competitor social profile cannot certify the competitor's service", async () => {
  await withConfig(async () => {
    const competitorProfile = "https://instagram.com/competitor-rooter";
    const competitorClaim = {
      field: "services",
      value: "Competitor hydro-jetting",
      source_url: competitorProfile,
      verified: true,
    };
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-plumbing.example/", competitorProfile],
        extracted: {
          brandName: "Acme Plumbing",
          city: "Austin",
          state: "TX",
          domainUrl: "https://acme-plumbing.example/",
        },
        observations: [
          {
            source: "https://acme-plumbing.example/",
            extracted: { brandName: "Acme Plumbing", city: "Austin", state: "TX" },
          },
          {
            source: competitorProfile,
            extracted: { brandName: "Competitor Rooter", exactServices: "Competitor hydro-jetting" },
          },
        ],
        evidence: [structuredClone(competitorClaim)],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-plumbing.example/",
        instagram_url: competitorProfile,
        prospect_hints: { name: "Acme Plumbing", city: "Austin", state: "TX", category: "Plumbing" },
        evidence: [competitorClaim],
      },
    });

    assert.equal(result.status, 422);
    assert.equal(result.body.status, "refused");
    assert.deepEqual(result.body.problems.map(row => row.code), ["present_service_evidence_invalid"]);
    assert.deepEqual(result.body.problems[0].actual, ["Competitor hydro-jetting"]);
    assert.equal(result.body.evidence.some(row => JSON.stringify(row).includes("Competitor hydro-jetting")), false);
    assert.equal(result.body.facts.services_source, "");
  });
});

test("a present source service with no supporting observation drops to defaults instead of refusing", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-roofing.example/"],
        extracted: {
          brandName: "Acme Roofing",
          domainUrl: "https://acme-roofing.example/",
          exactServices: "Unsupported specialty coating",
        },
        observations: [{ source: "https://acme-roofing.example/", extracted: { brandName: "Acme Roofing" } }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: { name: "Acme Roofing", city: "Austin", state: "TX", category: "Roofing" },
      },
    });

    // 2026-08-29 owner unblock: unsupported own-site extraction noise (page
    // headings) no longer disqualifies the candidate. The packet keeps
    // whatever is source-backed and falls back to category defaults.
    assert.equal(result.status, 200);
    assert.equal(result.body.facts.services_source, "category_default");
    assert.deepEqual(result.body.facts.services, ["Roofing services", "Roof repair", "Roof installation"]);
    assert.deepEqual(result.body.warnings, [{
      code: "service_extraction_dropped",
      field: "services",
      values: ["Unsupported specialty coating"],
      message: "Unsupported extracted service labels were dropped because no accepted source observation backed them.",
    }]);
    assert.deepEqual(result.body.packet2.review.warnings, result.body.warnings);
  });
});

test("a foreign observation cannot make an extracted service source-backed", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-roofing.example/", "https://other-business.example/services"],
        extracted: {
          brandName: "Acme Roofing",
          domainUrl: "https://acme-roofing.example/",
          exactServices: "Unsupported specialty coating",
        },
        observations: [{
          source: "https://other-business.example/services",
          extracted: { exactServices: "Unsupported specialty coating" },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: { name: "Acme Roofing", city: "Austin", state: "TX", category: "Roofing" },
      },
    });

    // 2026-08-29 owner unblock: the foreign observation cannot BACK the value
    // (never adopted, never in evidence); the packet ships category defaults.
    assert.equal(result.status, 200);
    assert.equal(result.body.facts.services_source, "category_default");
    assert.deepEqual(result.body.facts.services.filter(service => service === "Unsupported specialty coating"), []);
    assert.equal(result.body.evidence.some(row => row.field === "services" && String(row.value).includes("specialty coating")), false);
  });
});

test("a harvested foreign domain cannot redefine the request service anchor", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://competitor-roofing.example/"],
        extracted: {
          brandName: "Acme Roofing",
          city: "Austin",
          state: "TX",
          category: "Roofing",
          domainUrl: "https://competitor-roofing.example/",
          exactServices: "Competitor-only roof coating",
        },
        observations: [{
          source: "https://competitor-roofing.example/services",
          extracted: {
            brandName: "Acme Roofing",
            exactServices: "Competitor-only roof coating",
          },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: { name: "Acme Roofing", city: "Austin", state: "TX", category: "Roofing" },
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.facts.website, "https://acme-roofing.example/");
    // 2026-08-29 owner unblock: competitor-only services are dropped, never
    // adopted; honest category defaults ship instead.
    assert.equal(result.body.facts.services_source, "category_default");
    assert.deepEqual(result.body.facts.services.filter(service => service === "Competitor-only roof coating"), []);
    assert.equal(result.body.evidence.some(row => row.field === "services" && String(row.value).includes("Competitor")), false);
  });
});

test("extracted services with zero observations refuse and never gain request-domain evidence", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-roofing.example/"],
        extracted: {
          brandName: "Acme Roofing",
          domainUrl: "https://acme-roofing.example/",
          exactServices: "Unsupported specialty coating",
        },
        observations: [],
        evidence: [],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: { name: "Acme Roofing", city: "Austin", state: "TX", category: "Roofing" },
      },
    });

    // 2026-08-29 owner unblock: unobserved extraction noise drops; honest
    // category defaults ship; nothing fabricated as evidence.
    assert.equal(result.status, 200);
    assert.equal(result.body.facts.services_source, "category_default");
    assert.equal(result.body.evidence.some(row => row.field === "services" && row.source_type !== "category_default"), false);
    assert.equal(result.body.evidence.some(row => row.source_url === "https://acme-roofing.example/" && row.field === "services"), false);
    assert.deepEqual((result.body.problems || []).map(problem => problem.code), [],
    );
  });
});

test("unsupported prospect service hints warn and drop before honest category defaults", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-plumbing.example/"],
        extracted: { brandName: "Acme Plumbing", domainUrl: "https://acme-plumbing.example/" },
        observations: [{ source: "https://acme-plumbing.example/", extracted: { brandName: "Acme Plumbing" } }],
        evidence: [],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-plumbing.example/",
        prospect_hints: {
          name: "Acme Plumbing",
          city: "Austin",
          state: "TX",
          category: "Plumbing",
          services: ["24/7 emergency sewer repair"],
        },
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "compiled");
    assert.deepEqual(result.body.facts.services, defaultHandler.categoryDefaultServices("Plumbing"));
    assert.equal(result.body.facts.services_source, "category_default");
    assert.equal(result.body.facts.services_default_disqualified, undefined);
    assert.equal(result.body.evidence.some(row => row.value === "24/7 emergency sewer repair"), false);
    assert.deepEqual(result.body.warnings, [{
      code: "service_hint_dropped",
      field: "services",
      values: ["24/7 emergency sewer repair"],
      message: "Unsupported service hints were dropped because hints are not observed truth.",
    }]);
    assert.deepEqual(result.body.packet2.review.warnings, result.body.warnings);
    assert.deepEqual(result.body.problems || [], []);
  });
});

test("caller corrections cannot assign verified provenance to unsupported services", async () => {
  await withConfig(async () => {
    const handler = defaultHandler.createHandler({
      harvestSources: async () => ({
        ok: true,
        sources: ["https://acme-roofing.example/"],
        extracted: {
          brandName: "Acme Roofing",
          domainUrl: "https://acme-roofing.example/",
          exactServices: "Invented Moon Roofs",
        },
        observations: [{
          source: "https://acme-roofing.example/",
          extracted: { brandName: "Acme Roofing", domainUrl: "https://acme-roofing.example/" },
        }],
      }),
    });
    const result = await invoke(handler, {
      body: {
        website_url: "https://acme-roofing.example/",
        prospect_hints: {
          name: "Acme Roofing",
          city: "Dallas",
          state: "TX",
          category: "Roofing",
          services: ["Invented Moon Roofs"],
        },
        corrections: { services: ["Invented Moon Roofs"], services_source: "verified_url" },
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.facts.services_source, "owner_correction");
    assert.deepEqual(result.body.facts.services, ["Invented Moon Roofs"]);
    const serviceRow = result.body.evidence.find(row => row.field === "services");
    assert.equal(serviceRow.verification_status, "owner_supplied");
    assert.equal(serviceRow.source_url, "");
    assert.deepEqual(result.body.service_evidence, []);
  });
});

test("mixed verified and invalid services preserve proof but remain terminal", async () => {
  await withConfig(async () => {
    const verifiedService = {
      field: "services",
      value: ["Historic slate roof restoration"],
      source_url: "https://heritage-roofing.example/slate-restoration",
      verified: true,
      status: "verified",
      confidence: 0.99,
      provenance: "first_party_url",
    };
    const verifiedClaim = {
      field: "certification",
      value: "GAF Master Elite",
      source: { url: "https://heritage-roofing.example/credentials" },
      verification_status: "source_verified",
      confidence: 1,
      provenance: "first_party_url",
    };
    const unverified = {
      field: "services",
      value: ["Unverified moon-roof coating"],
      source_url: "https://heritage-roofing.example/moon-roofs",
      status: "candidate",
    };
    const selfAsserted = {
      field: "services",
      value: ["Self-asserted roof teleportation"],
      source_url: "https://heritage-roofing.example/teleportation",
      status: "verified",
    };
    const foreign = {
      field: "services",
      value: ["Competitor roof replacement"],
      source_url: "https://competitor-roofing.example/services",
      verified: true,
      status: "verified",
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => {
      const url = String(input);
      if (/^https:\/\/heritage-roofing\.example\/(?:sitemap\.xml|sitemap_index\.xml|wp-sitemap\.xml)$/.test(url)) {
        return new Response("not found", { status: 404 });
      }
      if (url === "https://api.firecrawl.dev/v2/map") {
        return new Response(JSON.stringify({ success: true, links: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://api.firecrawl.dev/v2/scrape") {
        return new Response(JSON.stringify({
          success: true,
          data: {
            json: {
              brandName: "Heritage Roofing",
              exactServices: "Historic slate roof restoration",
            },
            markdown: "Heritage Roofing provides historic slate roof restoration in Tucson.",
            rawHtml: "<h1>Heritage Roofing</h1>",
            metadata: { title: "Heritage Roofing" },
            links: [], images: [], branding: {},
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected live-harvest fetch: ${url}`);
    };
    let result;
    try {
      const handler = defaultHandler.createHandler();
      result = await invoke(handler, {
        body: {
          website_url: "https://heritage-roofing.example/",
          prospect_hints: { name: "Heritage Roofing LLC", city: "Tucson", state: "AZ", category: "Roofing" },
          evidence: [verifiedService, verifiedClaim, unverified, selfAsserted, foreign],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(result.status, 422);
    assert.equal(result.body.status, "refused");
    assert.equal(result.body.facts.services_source, "verified_url");
    assert.deepEqual(result.body.facts.services, ["Historic slate roof restoration"]);
    assert.equal(result.body.facts.services_default_disqualified, true);
    assert.deepEqual(result.body.evidence[0], verifiedService);
    assert.deepEqual(result.body.evidence[1], verifiedClaim);
    assert.equal(result.body.evidence.some(row => JSON.stringify(row).includes("moon-roof")), false);
    assert.equal(result.body.evidence.some(row => JSON.stringify(row).includes("teleportation")), false);
    assert.equal(result.body.evidence.some(row => JSON.stringify(row).includes("Competitor")), false);
    assert.equal(result.body.evidence.some(row => row.source_type === "category_default"), false);
    assert.deepEqual(
      result.body.problems.map(problem => problem.code),
      ["present_service_evidence_invalid"],
    );
  });
});
