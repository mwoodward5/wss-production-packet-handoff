import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runBuild } from "../../factory/lib/build-runtime.mjs";
import { createMemoryStore } from "../../factory/lib/vertical-history.mjs";
import { buildPremierPacket, createPremierProvider } from "../../factory/lib/siteforge-premier-provider.mjs";
import { planPremierComposition } from "../../factory/lib/premier-composer.mjs";
import { toPremierInputs } from "../../factory/lib/snowflake-to-premier.mjs";
import { build } from "../../factory/pipeline/05-build-v8.mjs";
import {
  buildAuthoritativeQcVerdict,
  isPublishableQc,
  PROJECT_PRECERTIFICATION_POLICY,
} from "../lib/engine-adapter.mjs";

const REQUIRED_BUILD_COMPLETE_FIELDS = [
  "schema_version", "build_id", "prospect_id", "idempotency_key", "renderer",
  "renderer_version", "authority_profile_version", "truth_packet_version",
  "qc_contract", "generation_fingerprint", "status", "preview_url",
  "report_url", "qc_passed", "visual_qc_passed", "logo_provenance",
  "media_provenance", "optimization_manifest", "completed_at",
];

function rendererPacket() {
  return {
    slug: "runtime-default-roofing",
    forge: { demo: true },
    build_type: "single_page_cinematic",
    business: {
      name: "Runtime Roofing",
      category: "roofing",
      city: "Austin",
      state: "TX",
    },
    services: ["Roof inspection", "Roof repair"],
    media: { catalog: [] },
    enrichment_sources: {},
  };
}

test("primary QC failure stays authoritative over a duplicate passing extension", () => {
  const primary = [
    { name: "screenshots", pass: true, detail: "all present" },
    { name: "hero-layer-count", pass: true, detail: "six layers" },
    { name: "grade-a-readiness", pass: false, detail: "pre-certification review remains" },
    { name: "visual-hero-geometry", pass: false, detail: "primary detected crushed mobile hero" },
  ];
  const extensions = [
    { name: "visual-hero-geometry", pass: true, detail: "extension claimed geometry passed" },
    { name: "extension-only", pass: true, detail: "new extension evidence" },
  ];

  const qc = buildAuthoritativeQcVerdict(primary, extensions);
  assert.deepEqual(qc.results.map((result) => result.name), [
    "screenshots",
    "hero-layer-count",
    "grade-a-readiness",
    "visual-hero-geometry",
    "extension-only",
  ]);
  assert.equal(qc.results.filter((result) => result.name === "visual-hero-geometry").length, 1);
  assert.deepEqual(
    qc.results.find((result) => result.name === "visual-hero-geometry"),
    primary[3],
  );
  assert.equal(qc.grade, "B");
  assert.deepEqual(qc.failed.map((result) => result.name), [
    "grade-a-readiness",
    "visual-hero-geometry",
  ]);
  assert.equal(isPublishableQc(qc, { policy: PROJECT_PRECERTIFICATION_POLICY }), false);
});

test("V8 keeps its default composition and pc1 fingerprint without Premier overrides", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-v8-default-"));
  const packet = rendererPacket();
  const expected = planPremierComposition(packet).compositionFingerprint;
  try {
    const result = await build(packet, { outDir, capture: false });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    assert.equal(result.generation_fingerprint, expected);
    assert.match(expected, /^pc1-[a-f0-9]{24}$/);
    assert.match(html, new RegExp(`data-composition-fingerprint="${expected}"`));
    assert.doesNotMatch(html, /data-premier-widget=/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("Premier packet uses supplied truth and assets without filling evidence gaps", () => {
  const packet = buildPremierPacket({
    truthPacket: {
      slug: "truth-only-roofing",
      business_name: "Truth Only Roofing",
      city: "Austin",
      state: "TX",
      vertical: "roofing",
      services: ["Roof inspection"],
      license_credentials: [],
      hours: [],
      service_area_cities: [],
    },
    assets: {
      logo_url: "https://cdn.example.test/truth-only-logo.png",
      photo_urls: ["https://cdn.example.test/truth-only-project.jpg"],
      reviews: [{ source: "google", author: "A. R.", rating: 5, text: "Unverified review", verified: false }],
    },
    buildId: "build_truth_only",
    prospectId: "prospect_truth_only",
  });

  assert.equal(packet.business.name, "Truth Only Roofing");
  assert.equal(packet.business.phone, undefined);
  assert.equal(packet.business.address, undefined);
  assert.equal(packet.enrichment_sources.phone, undefined);
  assert.equal(packet.enrichment_sources.hours, undefined);
  assert.equal(packet.enrichment_sources.reviews_attributed, undefined);
  assert.equal(packet.logo_source.origin, "owner-uploaded");
  assert.deepEqual(packet.media.catalog.map(({ url, source }) => ({ url, source })), [
    { url: "https://cdn.example.test/truth-only-project.jpg", source: "build-request" },
  ]);
});

test("direct assets.logo_url emits build-complete owner-uploaded provenance", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-runtime-logo-"));
  const logoUrl = "https://cdn.example.test/direct-logo.png";
  const providers = {
    store: createMemoryStore(),
    idFactory: () => "build_runtime_logo",
    runPremier: createPremierProvider({
      outDir,
      capture: false,
      previewUrl: "https://artifacts.example.test/builds/build_runtime_logo/",
    }),
  };
  const request = {
    schema_version: "siteforge-build-request-v1",
    idempotency_key: "idem_runtime_logo_0001",
    prospect_id: "prospect_runtime_logo",
    plan_tier: "free-preview",
    mode: "single-page-cinematic",
    truth_packet: {
      business_name: "Direct Logo Roofing",
      city: "Austin",
      state: "TX",
      vertical: "roofing",
      services: ["Roof inspection"],
    },
    assets: { logo_url: logoUrl },
  };

  try {
    const payload = await runBuild(request, {
      providers,
      now: () => new Date("2026-07-15T12:00:00.000Z"),
    });
    assert.equal(payload.logo_provenance.source, "owner-uploaded");
    assert.notEqual(payload.logo_provenance.source, "build-request");
    assert.equal(payload.logo_provenance.final_url, logoUrl);
    assert.match(payload.logo_provenance.source, /^(?:owner-uploaded|firecrawl-scrape|gbp-scrape|procedural-monogram|fallback-textmark)$/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("mapped parallax overrides the media reset and Ken Burns uses cinematic light", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-runtime-motion-"));
  const packet = {
    ...rendererPacket(),
    slug: "runtime-mapped-motion",
    media: {
      catalog: [{
        kind: "photo",
        url: "https://cdn.example.test/runtime-motion.jpg",
        source: "upload",
        label: "Owner supplied project photo",
      }],
    },
  };
  const premierInputs = toPremierInputs({
    archetype: "atlas-authority",
    widget: "service-atlas-live",
    typography_pair: "Fraunces + Inter Tight",
    palette_family: "cream-paper-oxblood",
    section_cadence_signature: "atlas-first",
    motion_grammar: "parallax-multiplane",
    media_treatment: "ken-burns-restrained",
    card_geometry: "ledger-cream",
    trust_spine: "stat-band-4up",
    cta_grammar: "single-hero-cta + text-photo",
  });

  try {
    await build(packet, { outDir, capture: false, premierInputs });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    const scorecard = JSON.parse(readFileSync(path.join(outDir, "scorecard.json"), "utf8"));

    assert.equal(scorecard.composition.mediaFrame.treatment, "ken-burns");
    assert.match(html, /data-motion-grammar="parallax-3plane"/);
    assert.match(html, /data-media-treatment="cinematic-light-shader" data-requested-media-treatment="ken-burns"/);
    assert.match(html, /\.hero\[data-motion-grammar="parallax-3plane"\] \.hero-media-layer :is\(img,video\)\{animation:premierMappedDrift 12s ease-in-out infinite alternate!important/);
    assert.match(html, /\.hero\[data-motion-grammar\] \.premier-treatment-cinematic-light-shader \.cinematic-light\{animation-duration:12s\}/);
    assert.match(html, /\.hero:not\(\[data-motion-grammar\]\) \.hero-media-layer video,[^}]+animation:none!important;transform:none!important/);
    assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{\.hero\[data-motion-grammar\] :is\(\.cinematic-light,\.hero-motif,\.hero-veil\)[^}]+animation:none!important;transform:none!important/);
    assert.doesNotMatch(html, /\.premier-treatment-ken-burns img|@keyframes\s+[\w-]*burns/i);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("cinemagraph media treatment renders a distinct pan with reduced-motion fallback", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-runtime-cinemagraph-"));
  const packet = {
    ...rendererPacket(),
    slug: "runtime-cinemagraph-motion",
    media: {
      catalog: [{
        kind: "photo",
        url: "https://cdn.example.test/runtime-cinemagraph.jpg",
        source: "upload",
        label: "Owner supplied project photo",
      }],
    },
  };
  const premierInputs = toPremierInputs({
    archetype: "cinemagraph-immersive",
    widget: "service-atlas-live",
    typography_pair: "Fraunces + Inter Tight",
    palette_family: "cream-paper-oxblood",
    section_cadence_signature: "atlas-first",
    motion_grammar: "parallax-multiplane",
    media_treatment: "cinemagraph-single-motion",
    card_geometry: "ledger-cream",
    trust_spine: "stat-band-4up",
    cta_grammar: "single-hero-cta + text-photo",
  });

  try {
    await build(packet, { outDir, capture: false, premierInputs });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    assert.match(html, /data-media-treatment="cinemagraph"/);
    assert.match(html, /premier-treatment-cinemagraph[^}]+animation:premierCinemagraph/);
    assert.match(html, /@keyframes premierCinemagraph/);
    assert.match(html, /@media\(prefers-reduced-motion:reduce\)[^}]+animation:none!important/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("mapped no-motion keeps kinetic headline words visible", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-runtime-no-motion-"));
  const premierInputs = toPremierInputs({
    archetype: "atlas-authority",
    widget: "service-atlas-live",
    typography_pair: "Fraunces + Inter Tight",
    palette_family: "cream-paper-oxblood",
    section_cadence_signature: "atlas-first",
    motion_grammar: "static-restrained",
    media_treatment: "ken-burns-restrained",
    card_geometry: "ledger-cream",
    trust_spine: "stat-band-4up",
    cta_grammar: "single-hero-cta + text-photo",
  });

  try {
    await build(rendererPacket(), { outDir, capture: false, premierInputs });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    assert.match(html, /\.hero\[data-motion-grammar="none"\] \.kinetic span\{opacity:1!important;transform:none!important;animation:none!important\}/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("runBuild drives real V8 through runPremier and materializes every crosswalk axis", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-runtime-v8-"));
  const previewUrl = "https://artifacts.example.test/builds/build_runtime_v8/";
  const reportUrl = `${previewUrl}optimization-manifest.json`;
  let providerContext;
  const realProvider = createPremierProvider({
    outDir,
    capture: false,
    previewUrl,
    reportUrl,
  });
  const providers = {
    store: createMemoryStore(),
    idFactory: () => "build_runtime_v8",
    runPremier: async (context) => {
      providerContext = context;
      return realProvider(context);
    },
  };
  const request = {
    schema_version: "siteforge-build-request-v1",
    idempotency_key: "idem_runtime_v8_0001",
    prospect_id: "prospect_runtime_v8",
    plan_tier: "free-preview",
    mode: "single-page-cinematic",
    truth_packet: {
      business_name: "Runtime V8 Roofing",
      city: "Austin",
      state: "TX",
      vertical: "roofing",
      services: ["Roof inspection", "Roof repair"],
    },
    assets: {
      reviews: [
        { source: "google", author: "J. D.", rating: 5, text: "Clear communication.", verified: true },
        { source: "google", author: "No Proof", rating: 5, text: "Do not publish.", verified: false },
      ],
    },
  };

  try {
    const payload = await runBuild(request, {
      providers,
      now: () => new Date("2026-07-15T12:00:00.000Z"),
    });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    const scorecard = JSON.parse(readFileSync(path.join(outDir, "scorecard.json"), "utf8"));
    const publicPacket = JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8"));
    const composition = scorecard.composition;
    const mapped = providerContext.premierInputs;

    assert.equal(composition.archetype.id, mapped.archetype.premier_archetype);
    assert.equal(composition.archetype.heroFamily, mapped.archetype.hero_family);
    assert.equal(composition.heroAnatomy.widget.premier_widget, mapped.widget.premier_widget);
    assert.equal(composition.typographyPair.display, mapped.typography.display);
    assert.equal(composition.typographyPair.body, mapped.typography.body);
    assert.equal(composition.palette.accent, mapped.palette.accent);
    assert.equal(composition.palette.mappedSurface, mapped.palette.surface);
    assert.deepEqual(composition.sectionCadence.sequence, mapped.cadence.section_order);
    assert.equal(composition.motionEffect.primary, mapped.motion.primary);
    assert.equal(composition.motionEffect.intensity, mapped.motion.intensity);
    assert.equal(composition.mediaFrame.treatment, mapped.media.treatment);
    assert.deepEqual(composition.layoutGravity.cardGeometry, mapped.card);
    assert.deepEqual(composition.reviewTreatment.trustBlocks, mapped.trust.blocks);
    assert.equal(composition.buttonGrammar.primary, mapped.cta.primary);
    assert.equal(composition.buttonGrammar.secondary, mapped.cta.secondary);

    assert.match(composition.compositionFingerprint, /^pc1-[a-f0-9]{24}$/);
    assert.match(html, new RegExp(`data-composition-fingerprint="${composition.compositionFingerprint}"`));
    assert.match(html, new RegExp(`data-premier-widget="${mapped.widget.premier_widget}"`));
    const renderedMediaTreatment = mapped.media.treatment === "ken-burns" ? "cinematic-light-shader" : mapped.media.treatment;
    assert.match(html, new RegExp(`data-media-treatment="${renderedMediaTreatment}"`));
    if (renderedMediaTreatment !== mapped.media.treatment) {
      assert.match(html, new RegExp(`data-requested-media-treatment="${mapped.media.treatment}"`));
    }
    assert.match(html, new RegExp(`data-card-geometry="${mapped.card.style}"`));
    assert.match(html, new RegExp(`data-cta-grammar="${mapped.cta.primary}"`));
    assert.match(html, new RegExp(`data-motion-grammar="${mapped.motion.primary}"`));

    assert.match(payload.generation_fingerprint, /^[a-f0-9]{64}$/);
    assert.notEqual(payload.generation_fingerprint, composition.compositionFingerprint);
    assert.equal(payload.build_id, "build_runtime_v8");
    assert.equal(payload.prospect_id, "prospect_runtime_v8");
    assert.equal(payload.preview_url, previewUrl);
    assert.equal(payload.report_url, reportUrl);
    assert.equal(payload.logo_provenance.source, "fallback-textmark");
    assert.equal(payload.qc_summary.batch_hamming_min >= 5, true);
    assert.equal(payload.optimization_manifest.checks.length, 108);
    assert.ok(payload.optimization_manifest.checks.every((check) => typeof check.state === "string"));
    assert.ok(payload.optimization_manifest.checks.every((check) => [
      "passed", "failed", "not-applicable", "needs-owner-input", "runtime-verification",
    ].includes(check.state)));
    for (const field of REQUIRED_BUILD_COMPLETE_FIELDS) assert.ok(Object.hasOwn(payload, field), `missing ${field}`);

    assert.equal(publicPacket.business.name, "Runtime V8 Roofing");
    assert.equal(publicPacket.business.phone, undefined);
    assert.equal(publicPacket.business.address, undefined);
    assert.equal(publicPacket.voice_persona.owner_name, null);
    assert.deepEqual(publicPacket.enrichment_sources.reviews_attributed.value.map((review) => review.text), ["Clear communication."]);
    assert.doesNotMatch(JSON.stringify(publicPacket), /Do not publish/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
