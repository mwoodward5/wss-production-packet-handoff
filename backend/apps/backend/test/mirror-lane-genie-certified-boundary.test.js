"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");

const {
  createContentCertification,
  retainSourceBoundServices,
} = require("../lib/intake-genie-client");
const { buildMirrorForProspect, certifiedGenieContentFromRecord, certifiedUmbrellaService } = require("../lib/mirror-lane-build");
const { visitorCopyProjection, proseFrom } = require("../lib/intake-packet");

const KEY = "test-only-mirror-boundary-certification-key";
const NOW = "2026-08-24T18:05:00.000Z";
const GBP = "https://google.com/maps/place/certified+plumbing";
const SERVICES = ["Drain Cleaning", "Water Heater Repair", "Sewer Line Replacement"];

// The canonical path projects the packet's structured search intent
// (optimization.target_queries first, then the Packet 2 search plan) into the
// schema-bounded keywords slot. By MirrorContent contract these terms can only
// choose which VERIFIED service leads the meta description — they can never
// inject text onto a page — and builder/directive markdown never reaches them.
const COMPILER_SHAPE_KEYWORDS = [
  "drain cleaning reno nv",
  "water heater repair reno nv",
  "sewer line replacement reno nv",
  "drain cleaning reno nv generated plan",
];
const RICH_PACKET_KEYWORDS = ["drain cleaning reno", "water heater repair reno"];

function proof(source, sourceKind = "google_places_api") {
  return { source, source_kind: sourceKind, captured_at: "2026-08-24T18:00:00.000Z" };
}

function certifiedPracticeContract(category = "plumbing", files = {
  "content/home.md": "# Certified Plumbing\n\nCertified Plumbing offers plumbing services for customers in Reno.",
  "content/services/drain-cleaning.md": "# Drain Cleaning\n\nContact Certified Plumbing to discuss drain cleaning for your property in Reno.",
  "content/services/water-heater-repair.md": "# Water Heater Repair\n\nContact Certified Plumbing to discuss water heater repair for your property in Reno.",
  "content/services/sewer-line-replacement.md": "# Sewer Line Replacement\n\nContact Certified Plumbing to discuss sewer line replacement for your property in Reno.",
  "content/faq.md": "# Frequently Asked Questions\n\n## How do I request service?\n\nShare the service location and a short description when you contact Certified Plumbing.",
}) {
  return {
    schema: "CertifiedPracticePacket/v1",
    kind: "certified_practice_packet",
    version: 1,
    facts: { category },
    assets: {},
    builder_instructions: { public: false },
    visitor_copy: {
      kind: "visitor_copy",
      files,
      file_hashes: Object.fromEntries(Object.entries(files).map(([file, body]) => [
        file,
        createHash("sha256").update(body).digest("hex"),
      ])),
      safety: { pass: true, violations: [] },
    },
  };
}

function canonicalPacket() {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: "genie-job-certified-plumbing",
    request_id: "ghost:certified-plumbing:line-genie-certified-v7",
    idempotency_key: "ghost:certified-plumbing:line-genie-certified-v7",
    sources: { gbp_url: GBP },
    facts: {
      name: "Certified Plumbing",
      city: "Reno",
      state: "NV",
      category: "plumbing",
      services: SERVICES,
      // These are deliberately present to prove the content-only adapter never
      // turns a signed content receipt into an identity/NAP/trust fast pass.
      phone: "+17755550100",
      address: "100 Invented Way",
      rating: 5,
    },
    content: {
      services: SERVICES.map((name) => ({ name, description: `Compiler copy for ${name}` })),
      about: "Compiler prose must not cross this content-completeness adapter.",
      reviews: [{ text: "Invented trust must not cross.", author: "Compiler" }],
      content_contract: certifiedPracticeContract(),
    },
    evidence: SERVICES.map((name) => ({
      field: "services",
      value: name,
      source_url: GBP,
      verified: true,
      status: "verified",
    })),
  };
}

function thinLeadMinerProspect(packet = canonicalPacket(), { attachWebsite = true, compileSources = packet.sources } = {}) {
  const prospect = {
    prospect_id: "certified-plumbing",
    business_name: "Certified Plumbing",
    industry: "plumbing",
    city: "Reno",
    state: "NV",
    place_id: "ChIJCertifiedPlumbing",
    gbp_url: GBP,
    truth_packet: {
      meta: {
        source: "leadminer_mirror_ready",
        build_ready: false,
        missing_build_evidence: ["content"],
      },
      mirror_ready: {
        business_name: "Certified Plumbing",
        place_id: "ChIJCertifiedPlumbing",
        industry: "plumber",
        city: "Reno",
        state: "NV",
        gbp_url: GBP,
        photos: [{ url: "https://images.example.test/certified-truck.jpg", source: "gbp" }],
        provenance: {
          "/business_name": proof(GBP),
          "/place_id": proof(GBP),
          "/industry": proof("leadminer:project-trade:plumber", "leadminer_derived"),
          "/city": proof(GBP),
          "/state": proof(GBP),
          "/gbp_url": proof(GBP),
          "/photos/0/url": proof(GBP),
          "/photos/0/source": proof(GBP),
        },
      },
    },
  };
  if (attachWebsite && /^https?:\/\//i.test(String(packet.facts?.website || ""))) {
    prospect.website_url = packet.facts.website;
    prospect.truth_packet.mirror_ready.website_url = packet.facts.website;
    prospect.truth_packet.mirror_ready.provenance["/website_url"] = proof(packet.facts.website, "website");
  }
  // Match the production certification input: the immutable LeadMiner source
  // declaration lives inside the durable record, not only on the dispatch row.
  prospect.record = {
    truth_packet_source: "leadminer_mirror_ready",
    truth_packet: prospect.truth_packet,
  };
  const certification = createContentCertification(packet, prospect, {
    signingKey: KEY,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.idempotency_key,
    requestSources: compileSources,
    certifiedAt: "2026-08-24T18:00:00.000Z",
  });
  assert.equal(certification.ok, true, JSON.stringify(certification));
  // Match the production persistence shape. This copy must never become an
  // unsigned fallback when the receipt below fails verification.
  prospect.truth_packet.intakeGenie = packet;
  prospect.record = {
    truth_packet_source: "leadminer_mirror_ready",
    truth_packet: prospect.truth_packet,
    genie_canonical_packet: packet,
    genie_compile_sources: compileSources,
    genie_compile_idempotency_key: packet.idempotency_key,
    genie_content_certification_contract: {
      version: "ghost-line-genie-receipt-v7",
      pipeline_version: "line-genie-certified-v7",
      idempotency_key_sha256: require("node:crypto").createHash("sha256")
        .update(packet.idempotency_key)
        .digest("hex"),
    },
    genie_content_certification: certification.receipt,
    // Compatibility display only. Every test below keeps this true so it can
    // never accidentally become the thing that authorizes a build.
    genie_build_certified: true,
  };
  return prospect;
}

test("the final mirror boundary refuses a fully valid v6 compiler marker", () => {
  const packet = canonicalPacket();
  packet.request_id = "ghost:certified-plumbing:line-genie-certified-v6";
  packet.idempotency_key = packet.request_id;
  const prospect = thinLeadMinerProspect(packet);
  prospect.record.genie_content_certification_contract = {
    version: "ghost-line-genie-receipt-v6",
    pipeline_version: "line-genie-certified-v6",
    idempotency_key_sha256: require("node:crypto").createHash("sha256")
      .update(packet.idempotency_key)
      .digest("hex"),
  };

  assert.deepEqual(certifiedGenieContentFromRecord(prospect, {
    signingKey: KEY,
    nowMs: Date.parse(NOW),
  }), { ok: false, reason: "receipt_pipeline_contract_stale" });
});

function isolatedDeps() {
  const captured = { mirrorCalls: 0, providerCalls: [] };
  return {
    captured,
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-premier", vertical: "plumbing" }),
    resolveVerifiedFacts: async () => {
      captured.providerCalls.push("resolveVerifiedFacts");
      throw new Error("LeadMiner certified packet must not open the resolver lane");
    },
    harvestClientPhotos: async () => {
      captured.providerCalls.push("harvestClientPhotos");
      throw new Error("LeadMiner certified packet must not harvest at the build boundary");
    },
    firstPartySite: async () => {
      captured.providerCalls.push("firstPartySite");
      throw new Error("content certification must not trigger first-party rescue");
    },
    brandFromWebsite: async () => {
      captured.providerCalls.push("brandFromWebsite");
      throw new Error("content certification must not trigger brand rescue");
    },
    captureFonts: async () => {
      captured.providerCalls.push("captureFonts");
      return { ok: false };
    },
    harvestFontsFallback: async () => {
      captured.providerCalls.push("harvestFontsFallback");
      return { ok: false };
    },
    readIntakePacket: () => {
      captured.providerCalls.push("readIntakePacket");
      return { ok: false };
    },
    mergeIntoContent: (content, packet) => {
      assert.equal(packet.ok, false, "no unsigned filesystem packet is adapted");
      return content;
    },
    readFleetIdentities: async () => ({ ok: true, identities: [] }),
    recordFleetIdentity: async () => ({ ok: true }),
    mirror: async (request) => {
      captured.mirrorCalls += 1;
      captured.request = request;
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: `https://${request.slug}.wss-ai.com/`,
          checks: { content: { status: "injected", sections: 1 } },
        },
      };
    },
  };
}

async function build(prospect, deps = isolatedDeps()) {
  const result = await buildMirrorForProspect(prospect, {
    deps,
    certificationKey: KEY,
    nowMs: Date.parse(NOW),
  });
  return { result, deps };
}

test("a thin LeadMiner packet builds from re-verified canonical services only", async () => {
  const packet = canonicalPacket();
  packet.evidence.unshift({
    field: "services",
    value: SERVICES[0],
    source_url: "https://foreign.example/services",
    verified: true,
    status: "verified",
  });
  const { result, deps } = await build(thinLeadMinerProspect(packet));

  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.equal(result.revealable, true);
  assert.equal(deps.captured.mirrorCalls, 1);
  assert.deepEqual(deps.captured.providerCalls, [], "the webhook/build boundary remains zero-provider");
  assert.deepEqual(
    deps.captured.request.content.services.map((service) => service.name),
    SERVICES,
  );
  assert.match(deps.captured.request.content.about, /offers plumbing services/);
  assert.equal(deps.captured.request.content.reviews, undefined);
  assert.equal(deps.captured.request.facts.phone, undefined);
  assert.equal(deps.captured.request.facts.address, undefined);
  assert.equal(deps.captured.request.facts.rating, undefined);
  assert.equal(result.content_source, "intake_genie_certified_content");
  assert.equal(result.content_provenance.services.verified, true);
  assert.equal(result.content_provenance.services.status, "verified");
  assert.equal(result.content_provenance.services.scope, "content_completeness_only");
  assert.match(result.content_provenance.services.receipt.packet_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.provider_calls, { google: 0, firecrawl: 0, intake_genie: 0 });
});

function richCanonicalPacket() {
  const packet = canonicalPacket();
  const website = "https://certified-plumbing.example/";
  packet.sources = { ...packet.sources, website_url: website };
  packet.facts.website = website;
  packet.evidence.push(
    { field: "city", value: "Reno", source_url: website, provenance: "observed", verification_status: "source_observation" },
    { field: "state", value: "NV", source_url: website, provenance: "observed", verification_status: "source_observation" },
  );
  packet.assets = [
    { kind: "logo", url: `${website}assets/brand.svg`, observed_on: website, approved: true, ownership_verified: true, verified: true },
    { kind: "photo", url: `${website}assets/finished-drain.webp`, observed_on: website, approved: true, ownership_verified: true, verified: true },
    { kind: "video", url: `${website}assets/crew-loop.mp4`, observed_on: website, approved: true, ownership_verified: true, verified: true },
    { kind: "photo", url: "https://foreign.example/stolen.webp", observed_on: website, approved: true, ownership_verified: true, verified: true },
  ];
  packet.brand = {
    source_url: website,
    palette: [
      { hex: "#123456", role: "primary", source_url: website },
      { hex: "#F47A1F", role: "cta accent", source_url: website },
    ],
    fonts: {
      display: "Oswald",
      body: "Inter",
      href: "https://fonts.googleapis.com/css2?family=Inter&family=Oswald",
      source_url: website,
    },
  };
  packet.content.content_files = {
    "content/about.md": "# About\n\nCertified Plumbing lists drain cleaning, water heater repair, and sewer line replacement for customers in Reno.",
    "content/services/drain-cleaning.md": "# Drain Cleaning\n\nDrain Cleaning is one of Certified Plumbing's source-bound services for customers in Reno.",
    "content/faq.md": "# Frequently Asked Questions\n\n## Does the service list include drain cleaning?\n\nYes. Drain Cleaning appears in the source-bound service list for Certified Plumbing.",
  };
  packet.content.page_plan = [
    { title: "About", slug: "about" },
    { title: "Frequently Asked Questions", slug: "faq" },
  ];
  packet.content.route_content_map = [
    { title: "About", route: "/about", contentFiles: ["content/about.md"] },
    { title: "Frequently Asked Questions", route: "/faq", contentFiles: ["content/faq.md"] },
  ];
  packet.optimization = {
    target_queries: ["drain cleaning reno", "water heater repair reno"],
  };
  packet.packet2 = {
    sources: {
      urls: [website],
      observations: [{
        source: website,
        extracted: {
          brandPalette: [
            { hex: "#123456", role: "primary" },
            { hex: "#F47A1F", role: "cta accent" },
          ],
          typographyDisplay: "Oswald",
          typographyBody: "Inter",
          googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter&family=Oswald",
        },
      }],
    },
    pagePlan: packet.content.page_plan,
    requirements: {
      pagesNeeded: "About\nFrequently Asked Questions",
      mustInclude: "Use only verified business evidence.",
    },
    compiled: {
      routeContentMap: packet.content.route_content_map,
      services: SERVICES.map((name) => ({ name, faqs: [] })),
      searchOptimizationPlan: {
        primaryKeyword: "drain cleaning reno",
        secondaryKeywords: ["water heater repair reno"],
      },
    },
  };
  return packet;
}

// Mirrors the deployed compiler response contract. In particular, observed
// assets are candidates (never ownership-approved), brand values carry their
// exact observation URL, and generated Packet 2 prose/search plans remain
// distinct from provenance-bound optimization.target_queries.
function realCompilerPacketShape() {
  const website = "https://certified-plumbing.example/";
  const observedOn = `${website}services`;
  const extracted = {
    brandName: "Certified Plumbing",
    city: "Reno",
    state: "NV",
    category: "Plumbing",
    domainUrl: website,
    exactServices: SERVICES.join("\n"),
    logoCandidates: [{ url: `${website}assets/brand.svg`, role: "header logo" }],
    imageCandidates: [{ url: `${website}assets/finished-drain.webp`, role: "project" }],
    brandPalette: [
      { hex: "#123456", role: "primary", source: "site CSS" },
      { hex: "#F47A1F", role: "cta accent", source: "site CSS" },
    ],
    typographyDisplay: "Oswald",
    typographyBody: "Inter",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter&family=Oswald",
  };
  const assets = [
    {
      kind: "logo", url: `${website}assets/brand.svg`, observed_on: observedOn,
      source: "public_source_observation", verification_status: "unverified_url_observation", ownership_verified: false,
    },
    {
      kind: "photo", url: `${website}assets/finished-drain.webp`, observed_on: observedOn,
      source: "public_source_observation", verification_status: "unverified_url_observation", ownership_verified: false,
    },
  ];
  const packet = canonicalPacket();
  delete packet.sources;
  packet.status = "compiled";
  packet.facts = { ...packet.facts, website };
  packet.evidence = [
    ...SERVICES.map((name) => ({
      field: "services", value: name, source_url: observedOn,
      provenance: "observed", verification_status: "source_observation",
    })),
    { field: "city", value: "Reno", source_url: observedOn, provenance: "observed", verification_status: "source_observation" },
    { field: "state", value: "NV", source_url: observedOn, provenance: "observed", verification_status: "source_observation" },
  ];
  packet.service_evidence = packet.evidence.filter((row) => row.field === "services");
  packet.assets = assets;
  packet.brand = {
    source_url: observedOn,
    logo: `${website}assets/brand.svg`,
    logo_candidates: [`${website}assets/brand.svg`],
    photo_candidates: [`${website}assets/finished-drain.webp`],
    palette: extracted.brandPalette.map((row) => ({ ...row, source_url: observedOn })),
    colors: ["#123456", "#F47A1F"],
    fonts: {
      display: "Oswald",
      body: "Inter",
      href: extracted.googleFontsUrl,
      source_url: observedOn,
    },
  };
  packet.content = {
    services: SERVICES.map((name) => ({ name, description: `Generated claim for ${name}` })),
    content_files: {
      "content/about.md": "# About\n\nGenerated claims about awards, guarantees, and round-the-clock service must stay withheld.",
      "content/faq.md": "# FAQ\n\nGenerated answers must stay withheld without claim-level provenance.",
    },
    page_plan: [{ title: "Home", slug: "" }, { title: "Services", slug: "services" }],
    route_content_map: [{ title: "Services", route: "/services", contentFiles: ["content/services.md"] }],
    content_contract: certifiedPracticeContract(),
  };
  packet.optimization = {
    target_queries: ["Drain Cleaning Reno NV", "Water Heater Repair Reno NV"],
  };
  packet.packet2 = {
    version: "2.0",
    sources: {
      urls: [website, observedOn],
      logos: assets.filter((row) => row.kind === "logo"),
      images: assets.filter((row) => row.kind === "photo"),
      palette: packet.brand.palette,
      extracted,
      observations: [{ source: observedOn, extracted }],
    },
    business: { businessName: "Certified Plumbing", domainUrl: website, city: "Reno", state: "NV" },
    brand: {
      source_url: observedOn,
      logoLink: `${website}assets/brand.svg`,
      brandPalette: packet.brand.palette,
      fonts: packet.brand.fonts,
    },
    requirements: { pagesNeeded: "Home\nServices", mustInclude: "Use only verified business evidence." },
    pagePlan: packet.content.page_plan,
    compiled: {
      services: packet.content.services,
      contentFiles: packet.content.content_files,
      routeContentMap: packet.content.route_content_map,
      searchOptimizationPlan: {
        primaryKeyword: "Sewer Line Replacement Reno NV",
        secondaryKeywords: ["Drain Cleaning Reno NV generated plan"],
      },
    },
  };
  return packet;
}

function realCompilerProspect(packet = realCompilerPacketShape()) {
  return thinLeadMinerProspect(packet, {
    compileSources: { website_url: packet.facts.website },
  });
}

function routePrefixedCompilerProspect(website, observedOn) {
  const packet = realCompilerPacketShape();
  packet.facts.website = website;
  packet.evidence = packet.evidence.map((row) => ({
    ...row,
    source_url: row.field === "services" ? website : observedOn,
  }));
  packet.service_evidence = packet.evidence.filter((row) => row.field === "services");
  packet.brand.source_url = observedOn;
  packet.brand.palette = packet.brand.palette.map((row) => ({ ...row, source_url: observedOn }));
  packet.brand.fonts.source_url = observedOn;
  packet.packet2.business.domainUrl = website;
  packet.packet2.brand.source_url = observedOn;
  packet.packet2.brand.brandPalette = packet.brand.palette;
  packet.packet2.brand.fonts = packet.brand.fonts;
  packet.packet2.sources.urls = [website, observedOn];
  packet.packet2.sources.extracted.domainUrl = website;
  packet.packet2.sources.observations = [{
    source: observedOn,
    extracted: packet.packet2.sources.extracted,
  }];
  return thinLeadMinerProspect(packet, { compileSources: { website_url: website } });
}

test("the exact compiler Packet 2 shape crosses only certified visitor copy and value-bound brand", async () => {
  const packet = realCompilerPacketShape();
  const { result, deps } = await build(realCompilerProspect(packet));
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  const request = deps.captured.request;
  assert.deepEqual(request.content.keywords, COMPILER_SHAPE_KEYWORDS,
    "structured search intent rides the schema-bounded keywords slot only");
  assert.equal(request.brand.primary, "#123456");
  assert.equal(request.brand.site_accent, "#F47A1F");
  assert.equal(request.brand.fonts.display, "Oswald");
  assert.equal(request.brand.logo, undefined, "an observed URL is not an ownership approval");
  assert.equal(request.brand.photos.includes(`${packet.facts.website}assets/finished-drain.webp`), false);
  assert.match(request.content.about, /offers plumbing services/);
  assert.equal(request.content.faqs[0].q, "How do I request service?");
  assert.match(request.content.services[0].description, /discuss drain cleaning/);
  assert.equal(request.content.seo_description, undefined,
    "a search plan without explicit search-copy fields supplies no description");
});

test("same-site source labels cannot promote brand values or location intent that the observation does not contain", () => {
  const packet = realCompilerPacketShape();
  packet.brand.palette = [{ hex: "#ABCDEF", role: "primary", source_url: `${packet.facts.website}services` }];
  packet.packet2.brand.brandPalette = packet.brand.palette;
  packet.brand.fonts.display = "Roboto";
  packet.packet2.brand.fonts.display = "Roboto";
  packet.evidence = packet.evidence.map((row) => row.field === "city"
    ? { ...row, provenance: "hint", verification_status: "source_observation", source_url: "" }
    : row);
  const out = certifiedGenieContentFromRecord(realCompilerProspect(packet), {
    signingKey: KEY,
    nowMs: Date.parse(NOW),
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.canonical_packet.brand, {});
  assert.deepEqual(out.canonical_packet.keywords, COMPILER_SHAPE_KEYWORDS);
});

test("a path-scoped shared host cannot borrow brand or location evidence from a sibling tenant", () => {
  const packet = realCompilerPacketShape();
  const victim = "https://linktr.ee/victim-plumbing";
  const sibling = "https://linktr.ee/competitor";
  packet.facts.website = victim;
  packet.evidence = packet.evidence.map((row) => ({
    ...row,
    source_url: row.field === "services" ? victim : sibling,
  }));
  packet.service_evidence = packet.evidence.filter((row) => row.field === "services");
  packet.brand.source_url = sibling;
  packet.brand.palette = packet.brand.palette.map((row) => ({ ...row, source_url: sibling }));
  packet.brand.fonts.source_url = sibling;
  packet.packet2.business.domainUrl = victim;
  packet.packet2.brand.source_url = sibling;
  packet.packet2.brand.brandPalette = packet.brand.palette;
  packet.packet2.brand.fonts = packet.brand.fonts;
  packet.packet2.sources.urls = [victim, sibling];
  packet.packet2.sources.observations = [{
    source: sibling,
    extracted: packet.packet2.sources.extracted,
  }];

  const out = certifiedGenieContentFromRecord(thinLeadMinerProspect(packet, {
    compileSources: { website_url: victim },
  }), { signingKey: KEY, nowMs: Date.parse(NOW) });
  assert.equal(out.ok, true);
  assert.deepEqual(out.canonical_packet.brand, {});
  assert.deepEqual(out.canonical_packet.keywords, COMPILER_SHAPE_KEYWORDS);
});

test("an exact tenant subdomain at root keeps its own brand and observed-location intent", () => {
  const packet = realCompilerPacketShape();
  const website = "https://victim.notion.site/";
  packet.facts.website = website;
  packet.evidence = packet.evidence.map((row) => ({ ...row, source_url: website }));
  packet.service_evidence = packet.evidence.filter((row) => row.field === "services");
  packet.brand.source_url = website;
  packet.brand.palette = packet.brand.palette.map((row) => ({ ...row, source_url: website }));
  packet.brand.fonts.source_url = website;
  packet.packet2.business.domainUrl = website;
  packet.packet2.brand.source_url = website;
  packet.packet2.brand.brandPalette = packet.brand.palette;
  packet.packet2.brand.fonts = packet.brand.fonts;
  packet.packet2.sources.urls = [website];
  packet.packet2.sources.extracted.domainUrl = website;
  packet.packet2.sources.observations = [{
    source: website,
    extracted: packet.packet2.sources.extracted,
  }];

  const out = certifiedGenieContentFromRecord(thinLeadMinerProspect(packet, {
    compileSources: { website_url: website },
  }), { signingKey: KEY, nowMs: Date.parse(NOW) });
  assert.equal(out.ok, true);
  assert.deepEqual(out.canonical_packet.keywords, COMPILER_SHAPE_KEYWORDS);
  assert.equal(out.canonical_packet.brand.primary, "#123456");
  assert.equal(out.canonical_packet.brand.fonts.display, "Oswald");
});

test("Square book and YouTube channel routes bind their tenant ID", () => {
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
    const rejected = certifiedGenieContentFromRecord(routePrefixedCompilerProspect(row.website, row.sibling), {
      signingKey: KEY,
      nowMs: Date.parse(NOW),
    });
    assert.equal(rejected.ok, true, row.label);
    assert.deepEqual(rejected.canonical_packet.brand, {}, row.label);
    assert.deepEqual(rejected.canonical_packet.keywords, COMPILER_SHAPE_KEYWORDS, row.label);

    const accepted = certifiedGenieContentFromRecord(routePrefixedCompilerProspect(row.website, row.own), {
      signingKey: KEY,
      nowMs: Date.parse(NOW),
    });
    assert.equal(accepted.ok, true, row.label);
    assert.deepEqual(accepted.canonical_packet.keywords, COMPILER_SHAPE_KEYWORDS, row.label);
    assert.equal(accepted.canonical_packet.brand.primary, "#123456", row.label);
    assert.equal(accepted.canonical_packet.brand.fonts.display, "Oswald", row.label);
  }
});

test("Wix requires both the account subdomain and site slug", () => {
  const website = "https://username.wixsite.com/site-one";
  const rejected = certifiedGenieContentFromRecord(routePrefixedCompilerProspect(
    website,
    "https://username.wixsite.com/site-two",
  ), { signingKey: KEY, nowMs: Date.parse(NOW) });
  assert.equal(rejected.ok, true);
  assert.deepEqual(rejected.canonical_packet.brand, {});
  assert.deepEqual(rejected.canonical_packet.keywords, COMPILER_SHAPE_KEYWORDS);

  const accepted = certifiedGenieContentFromRecord(routePrefixedCompilerProspect(
    website,
    "https://username.wixsite.com/site-one/services",
  ), { signingKey: KEY, nowMs: Date.parse(NOW) });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.canonical_packet.keywords, COMPILER_SHAPE_KEYWORDS);
  assert.equal(accepted.canonical_packet.brand.primary, "#123456");
  assert.equal(accepted.canonical_packet.brand.fonts.display, "Oswald");
});

test("a valid canonical receipt carries bounded search intent and evidence-bound brand media into the exact Mirror request", async () => {
  const prospect = thinLeadMinerProspect(richCanonicalPacket());
  const first = certifiedGenieContentFromRecord(prospect, { signingKey: KEY, nowMs: Date.parse(NOW) });
  const second = certifiedGenieContentFromRecord(prospect, { signingKey: KEY, nowMs: Date.parse(NOW) });
  assert.deepEqual(second, first, "the same packet hash must project identically on every retry");
  assert.equal(first.canonical_packet.source, `intake-genie:${prospect.record.genie_content_certification.packet_sha256}`);
  assert.deepEqual(first.canonical_packet.plan, {
    page_count: 2,
    route_count: 2,
    requirements_present: true,
  });

  const { result, deps } = await build(prospect);
  const request = deps.captured.request;
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.deepEqual(deps.captured.providerCalls, [], "signed brand fonts must not reopen a provider at the final seam");
  assert.match(request.content.about, /offers plumbing services for customers in Reno/);
  assert.equal(request.content.faqs[0].q, "How do I request service?");
  assert.match(request.content.services[0].description, /discuss drain cleaning/);
  assert.deepEqual(request.content.keywords, RICH_PACKET_KEYWORDS,
    "the receipt-covered search intent reaches the schema-bounded keywords slot");
  assert.equal(result.content_provenance.keywords.receipt_verified, true);
  assert.equal(request.brand.logo, "https://certified-plumbing.example/assets/brand.svg");
  assert.equal(request.brand.primary, "#123456");
  assert.equal(request.brand.site_accent, "#F47A1F");
  assert.equal(request.brand.fonts.display, "Oswald");
  assert.deepEqual(request.brand.hero_video, { url: "https://certified-plumbing.example/assets/crew-loop.mp4" });
  assert.ok(request.brand.photos.includes("https://certified-plumbing.example/assets/finished-drain.webp"));
  assert.equal(request.brand.photos.includes("https://foreign.example/stolen.webp"), false);
  assert.equal(result.content_provenance.about.packet_sha256, prospect.record.genie_content_certification.packet_sha256);
  assert.equal(result.content_provenance.about.receipt_verified, true);
});

test("content-completeness signing never promotes generated marketing claims", async () => {
  const packet = richCanonicalPacket();
  packet.content.content_files["content/about.md"] = "# About\n\nCertified Plumbing in Reno installs gas lines statewide with patented equipment.";
  packet.content.services[0].description = "Certified Plumbing in Reno always clears every Drain Cleaning clog.";
  packet.packet2.compiled.services[0].faqs = [{
    q: "Does Certified Plumbing offer Drain Cleaning in Reno?",
    a: "Every technician is BBB accredited and the work is guaranteed.",
  }];
  packet.packet2.compiled.seo = { description: "Reno's guaranteed 24/7 Drain Cleaning leader." };
  packet.optimization = { target_queries: ["Certified Plumbing gas line Reno"] };

  const { result, deps } = await build(thinLeadMinerProspect(packet));
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  const content = deps.captured.request.content;
  // RENDERED copy stays certified-only: the generated about prose, the
  // generated service description, the generated FAQ, and the generated
  // seo.description never cross.
  for (const rendered of [
    content.about,
    JSON.stringify(content.faqs),
    JSON.stringify(content.services),
    content.seo_description,
  ]) {
    if (rendered == null) continue;
    assert.doesNotMatch(rendered, /gas lines?|patented|always clears|BBB|guaranteed|24\/7/i,
      String(rendered).slice(0, 120));
  }
  assert.equal(content.seo_description, undefined,
    "generated seo.description is not explicit search copy and never projects");
  assert.match(content.about, /offers plumbing services/);
  assert.equal(content.faqs[0].q, "How do I request service?");
  assert.match(content.services[0].description, /discuss drain cleaning/);
  // The compiler's own target query rides ONLY the keywords slot, which by
  // MirrorContent contract can pick the lead VERIFIED service and nothing else
  // — it is never rendered and can never introduce an unverified service. The
  // packet's honest search-plan terms project beside it, as they always do.
  assert.deepEqual(content.keywords, [
    "certified plumbing gas line reno",
    "drain cleaning reno",
    "water heater repair reno",
  ]);
  assert.equal(JSON.stringify(content.keywords).includes("guaranteed"), false);
});

test("a place-id-only receipt cannot authorize an arbitrary packet website or its brand", () => {
  const packet = richCanonicalPacket();
  delete packet.sources.website_url;
  const prospect = thinLeadMinerProspect(packet, { attachWebsite: false });
  const out = certifiedGenieContentFromRecord(prospect, { signingKey: KEY, nowMs: Date.parse(NOW) });
  assert.equal(out.ok, true);
  assert.equal(out.canonical_packet.ok, true);
  assert.deepEqual(out.canonical_packet.brand, {}, "a place receipt cannot authorize an arbitrary packet website or brand");
});

test("a shared-builder sibling tenant cannot borrow the receipt domain", () => {
  const victim = "https://victim.wixsite.com/site-one/";
  const sibling = "https://other.wixsite.com/site-two/";
  const packet = richCanonicalPacket();
  packet.sources.website_url = victim;
  packet.facts.website = victim;
  packet.assets = packet.assets.map((asset) => ({
    ...asset,
    url: asset.url.replace("https://certified-plumbing.example/", sibling),
    observed_on: sibling,
  }));
  packet.brand.source = sibling;
  packet.brand.palette = packet.brand.palette.map((row) => ({ ...row, source: sibling }));
  packet.brand.fonts.source = sibling;
  const prospect = thinLeadMinerProspect(packet);
  prospect.truth_packet.mirror_ready.website_url = sibling;
  prospect.truth_packet.mirror_ready.provenance["/website_url"] = proof(sibling, "website");

  const out = certifiedGenieContentFromRecord(prospect, { signingKey: KEY, nowMs: Date.parse(NOW) });
  assert.equal(out.ok, true);
  assert.equal(out.canonical_packet.ok, true);
  assert.deepEqual(out.canonical_packet.brand, {});
});

test("unapproved canonical media stays outside the direct Mirror request", async () => {
  const packet = richCanonicalPacket();
  packet.assets = packet.assets.map((asset) => ({ ...asset, approved: false, ownership_verified: false }));
  const { result, deps } = await build(thinLeadMinerProspect(packet));
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.equal(deps.captured.request.brand.logo, undefined);
  assert.equal(deps.captured.request.brand.hero_video, undefined);
  assert.equal(deps.captured.request.brand.photos.includes("https://certified-plumbing.example/assets/finished-drain.webp"), false);
});

test("an unsigned local intake_packet_dir is ignored even when it contains renderable prose", async () => {
  const prospect = thinLeadMinerProspect(canonicalPacket());
  prospect.intake_packet_dir = "C:\\unsigned\\packet";
  prospect.record.intake_packet_dir = prospect.intake_packet_dir;
  const deps = isolatedDeps();
  deps.readIntakePacket = () => {
    throw new Error("unsigned intake_packet_dir must never be read");
  };
  deps.mergeIntoContent = () => ({
    services: SERVICES.map((name) => ({ name })),
    about: "FOREIGN UNSIGNED PROSE",
    keywords: ["foreign unsigned keyword"],
  });

  const result = await buildMirrorForProspect(prospect, {
    deps,
    packetDir: prospect.intake_packet_dir,
    certificationKey: KEY,
    nowMs: Date.parse(NOW),
  });
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.doesNotMatch(JSON.stringify(deps.captured.request.content), /FOREIGN|foreign unsigned/i);
  assert.deepEqual(deps.captured.providerCalls, []);
});

test("forged, expired, and packet-mismatched receipts expose no canonical rich projection", () => {
  const cases = [];
  const forged = thinLeadMinerProspect(richCanonicalPacket());
  forged.record.genie_content_certification.signature = "0".repeat(64);
  cases.push(["forged", forged]);

  const expired = thinLeadMinerProspect(richCanonicalPacket());
  const packet = expired.record.genie_canonical_packet;
  expired.record.genie_content_certification = createContentCertification(packet, expired, {
    signingKey: KEY,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.idempotency_key,
    requestSources: packet.sources,
    certifiedAt: "2026-08-24T17:00:00.000Z",
    ttlMs: 60_000,
  }).receipt;
  cases.push(["expired", expired]);

  const mismatched = thinLeadMinerProspect(richCanonicalPacket());
  mismatched.record.genie_canonical_packet.content.content_files["content/about.md"] += " tampered";
  cases.push(["mismatched", mismatched]);

  for (const [name, prospect] of cases) {
    const out = certifiedGenieContentFromRecord(prospect, { signingKey: KEY, nowMs: Date.parse(NOW) });
    assert.equal(out.ok, false, name);
    assert.equal(Object.hasOwn(out, "canonical_packet"), false, name);
  }
});

test("an alias-only bound packet certifies and supplies mirror services", async () => {
  const raw = canonicalPacket();
  delete raw.facts.services;
  delete raw.content.services;
  raw.primary_services = SERVICES;
  const packet = retainSourceBoundServices(raw, raw.sources);

  const { result, deps } = await build(thinLeadMinerProspect(packet));

  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.deepEqual(
    deps.captured.request.content.services.map((service) => service.name),
    SERVICES,
  );
  assert.equal(result.content_source, "intake_genie_certified_content");
  assert.equal(result.content_provenance.services.source, "intake_genie_certified_content");
  assert.equal(result.content_provenance.services.evidence[0].source_url, GBP);
});

function collapsedServicePacket({ category = "plumbing", phrase = "Plumbing Services" } = {}) {
  const first = `Appliance Installation Battery Backup Systems Drains Faucets and Fixtures Garbage Disposals Gas Lines Reverse Osmosis Sewage Ejectors Sump Pumps Vanities Wall Hydrants Water Heaters Water Lines Water Softeners ${phrase} RV Water Heater Service RV Water Service`;
  const second = `Residential Service Light Commercial Service RV Water Service RV Water Heater Service licensed and insured ${phrase} Reverse Osmosis System Installation`;
  const packet = canonicalPacket();
  packet.scope = { supported: true, category };
  packet.facts = {
    ...packet.facts,
    category,
    services: [first, second],
  };
  delete packet.content.services;
  packet.evidence = [{
    field: "services",
    value: [first, second],
    source_url: GBP,
    verified: true,
    status: "verified",
  }];
  return packet;
}

test("a signed collapsed service menu uses only its exact verified category-service phrase", async () => {
  const packet = collapsedServicePacket();
  packet.evidence.unshift({
    field: "services",
    value: packet.facts.services[0],
    source_url: "https://foreign.example/services",
    verified: true,
    status: "verified",
  });
  const prospect = thinLeadMinerProspect(packet);
  prospect.truth_packet.meta.missing_build_evidence = ["verified_service_evidence"];
  assert.ok(certifiedUmbrellaService(packet, prospect, packet.facts.services));
  const admitted = certifiedGenieContentFromRecord(prospect, {
    signingKey: KEY,
    nowMs: Date.parse(NOW),
  });
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  assert.deepEqual(admitted.services, [{ name: "Plumbing Services" }]);

  const { result, deps } = await build(prospect);

  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.deepEqual(deps.captured.request.content.services, [{ name: "Plumbing Services" }]);
  assert.equal(JSON.stringify(deps.captured.request.content).includes(packet.facts.services[0]), false);
  assert.equal(result.content_provenance.services.evidence[0].projection, "verbatim_category_service_phrase");
  assert.equal(result.content_provenance.services.evidence[0].source_url, GBP);
  assert.match(result.content_provenance.services.evidence[0].source_value_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(deps.captured.providerCalls, []);
  assert.deepEqual(result.provider_calls, { google: 0, firecrawl: 0, intake_genie: 0 });
});

test("a proven secondary donor becomes the packet request and result industry", async () => {
  const services = ["Home Repair", "Emergency Repairs", "Roofing replacement and repairs"];
  const packet = canonicalPacket();
  packet.job_id = "genie-job-roy-briley";
  packet.request_id = "ghost:roy-briley:line-genie-certified-v7";
  packet.idempotency_key = packet.request_id;
  packet.facts = {
    ...packet.facts,
    name: "Roy Briley General Contracting, Fire & Water Damage Restoration",
    city: "Anchorage",
    state: "AK",
    category: "general contractor",
    services,
  };
  packet.scope = { supported: true, category: "general contractor" };
  packet.content = {
    services,
    content_contract: certifiedPracticeContract("general contractor"),
  };
  packet.evidence = services.map((name) => ({
    field: "services", value: name, source_url: GBP, verified: true, status: "verified",
  }));

  const prospect = {
    prospect_id: "roy-briley",
    business_name: packet.facts.name,
    industry: "general contractor",
    city: "Anchorage",
    state: "AK",
    place_id: "ChIJRoyBriley",
    gbp_url: GBP,
    truth_packet: {
      meta: { source: "leadminer_mirror_ready", build_ready: false, missing_build_evidence: ["content"] },
      mirror_ready: {
        business_name: packet.facts.name,
        place_id: "ChIJRoyBriley",
        industry: "general contractor",
        city: "Anchorage",
        state: "AK",
        gbp_url: GBP,
        photos: [{ url: "https://images.example.test/roy-crew.jpg", source: "gbp" }],
        provenance: {
          "/business_name": proof(GBP),
          "/place_id": proof(GBP),
          "/industry": proof("leadminer:project-trade:general contractor", "leadminer_derived"),
          "/city": proof(GBP),
          "/state": proof(GBP),
          "/gbp_url": proof(GBP),
          "/photos/0/url": proof(GBP),
          "/photos/0/source": proof(GBP),
        },
      },
    },
  };
  prospect.record = {
    truth_packet_source: "leadminer_mirror_ready",
    truth_packet: prospect.truth_packet,
  };
  const certification = createContentCertification(packet, prospect, {
    signingKey: KEY,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.idempotency_key,
    requestSources: packet.sources,
    certifiedAt: "2026-08-24T18:00:00.000Z",
  });
  assert.equal(certification.ok, true, JSON.stringify(certification));
  prospect.record = {
    truth_packet_source: "leadminer_mirror_ready",
    truth_packet: prospect.truth_packet,
    genie_canonical_packet: packet,
    genie_compile_sources: packet.sources,
    genie_compile_idempotency_key: packet.idempotency_key,
    genie_content_certification_contract: {
      version: "ghost-line-genie-receipt-v7",
      pipeline_version: "line-genie-certified-v7",
      idempotency_key_sha256: require("node:crypto").createHash("sha256")
        .update(packet.idempotency_key)
        .digest("hex"),
    },
    genie_content_certification: certification.receipt,
  };

  const deps = isolatedDeps();
  deps.resolveBuildableDonor = (vertical) => {
    deps.captured.donorVertical = vertical;
    return vertical === "general contractor"
      ? { ok: true, donor: "concrete-elconstruction", vertical }
      : { ok: false, reason: "no_clean_donor_for_vertical" };
  };
  const { result } = await build(prospect, deps);

  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.equal(deps.captured.donorVertical, "general contractor");
  assert.equal(deps.captured.request.facts.industry, "general contractor");
  assert.equal(result.facts.industry, "general contractor");
});

test("collapsed service fallback fails closed without exact category agreement and phrase", async (t) => {
  for (const item of [
    { name: "missing phrase", packet: collapsedServicePacket({ phrase: "Licensed Trade Work" }) },
    { name: "negated phrase", packet: collapsedServicePacket({ phrase: "We do not offer Plumbing Services" }) },
  ]) {
    await t.test(item.name, async () => {
      const prospect = thinLeadMinerProspect(item.packet);
      prospect.truth_packet.meta.missing_build_evidence = ["verified_service_evidence"];
      const { result, deps } = await build(prospect);
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.ok(result.missing.includes("services"));
      assert.equal(deps.captured.mirrorCalls, 0);
      assert.deepEqual(deps.captured.providerCalls, []);
    });
  }

  const categoryMismatch = collapsedServicePacket({ category: "hvac", phrase: "HVAC Services" });
  const refused = createContentCertification(categoryMismatch, {
    prospect_id: "certified-plumbing",
    business_name: "Certified Plumbing",
    industry: "plumbing",
    city: "Reno",
    state: "NV",
    place_id: "ChIJCertifiedPlumbing",
    gbp_url: GBP,
    record: { truth_packet_source: "leadminer_mirror_ready", truth_packet: { mirror_ready: {} } },
  }, {
    signingKey: KEY,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: categoryMismatch.request_id,
    jobId: categoryMismatch.job_id,
    idempotencyKey: categoryMismatch.idempotency_key,
    requestSources: categoryMismatch.sources,
    certifiedAt: "2026-08-24T18:00:00.000Z",
  });
  assert.equal(refused.ok, false);
  assert.ok(refused.reasons.includes("compiler_packet_category_mismatch"));
});

test("a fresh v7 receipt exposes certified visitor copy without legacy truth_packet_source", () => {
  const website = "https://certified-plumbing.example/";
  const packet = canonicalPacket();
  packet.sources = { website_url: website };
  packet.facts.website = website;
  packet.evidence = packet.evidence.map((row) => ({ ...row, source_url: website }));
  const prospect = {
    prospect_id: "certified-plumbing",
    business_name: "Certified Plumbing",
    industry: "plumbing",
    city: "Reno",
    state: "NV",
    place_id: "ChIJCertifiedPlumbing",
    website,
  };
  const certification = createContentCertification(packet, prospect, {
    signingKey: KEY,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.idempotency_key,
    requestSources: packet.sources,
    certifiedAt: "2026-08-24T18:00:00.000Z",
  });
  assert.equal(certification.ok, true, JSON.stringify(certification));
  prospect.record = {
    genie_canonical_packet: packet,
    genie_compile_sources: packet.sources,
    genie_compile_idempotency_key: packet.idempotency_key,
    genie_content_certification_contract: {
      version: "ghost-line-genie-receipt-v7",
      pipeline_version: "line-genie-certified-v7",
      idempotency_key_sha256: createHash("sha256").update(packet.idempotency_key).digest("hex"),
    },
    genie_content_certification: certification.receipt,
  };

  const out = certifiedGenieContentFromRecord(prospect, {
    signingKey: KEY,
    nowMs: Date.parse(NOW),
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(out.canonical_packet.about, /offers plumbing services/);
  assert.equal(Object.hasOwn(prospect.record, "truth_packet_source"), false);
});

test("a forged collapsed-service receipt cannot create the category umbrella", async () => {
  const prospect = thinLeadMinerProspect(collapsedServicePacket());
  prospect.truth_packet.meta.missing_build_evidence = ["verified_service_evidence"];
  prospect.record.genie_content_certification.signature = "0".repeat(64);
  const { result, deps } = await build(prospect);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("services"));
  assert.equal(deps.captured.mirrorCalls, 0);
});

test("a mixed compiler packet cannot resurrect unbound services through aliases or evidence", async () => {
  const raw = canonicalPacket();
  raw.facts.services = [...SERVICES, "Broad Plumbing Guess"];
  raw.facts.service_list = ["Drain Cleaning", "Suggested Upgrade"];
  raw.primary_services = ["Water Heater Repair", "Generic Plumbing"];
  raw.primaryServices = ["Sewer Line Replacement", "Recommended Service"];
  raw.content.services = [
    ...raw.content.services,
    { name: "Invented Expansion", description: "Must not render." },
  ];
  raw.evidence.push({
    field: "services",
    value: "Broad Plumbing Guess",
    source: "ghost_prospect_hint",
    verified: true,
    status: "verified",
  });
  raw.evidence.push({
    field: "services_not_offered",
    value: "Invented Expansion",
    source_url: GBP,
    verified: true,
    status: "verified",
  });

  const packet = retainSourceBoundServices(raw, raw.sources);
  const { result, deps } = await build(thinLeadMinerProspect(packet));
  const rendered = deps.captured.request.content.services.map((service) => service.name);

  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.deepEqual(rendered, SERVICES);
  for (const refused of [
    "Broad Plumbing Guess",
    "Suggested Upgrade",
    "Generic Plumbing",
    "Recommended Service",
    "Invented Expansion",
  ]) {
    assert.equal(rendered.includes(refused), false, refused);
  }
  assert.equal(
    packet.evidence.some((row) => row.field === "services" && row.value === "Broad Plumbing Guess"),
    false,
  );
  assert.equal(result.content_source, "intake_genie_certified_content");
  assert.equal(result.content_provenance.services.source, "intake_genie_certified_content");
});

test("a certified category default reaches Mirror only as an honest estimate", async () => {
  const raw = canonicalPacket();
  raw.facts.services_source = "category_default";
  raw.facts.services = ["Drain Cleaning", "Water Heater Repair"];
  raw.content.services = [];
  raw.evidence = [
    { field: "name", value: raw.facts.name, source_url: GBP },
    {
      field: "services",
      value: raw.facts.services,
      source: "category_default",
      source_type: "category_default",
      provenance: "estimated",
      verification_status: "estimated",
      estimated: true,
      verified: false,
      status: "estimated",
      source_url: "",
    },
  ];
  const packet = retainSourceBoundServices(raw, raw.sources);
  const prospect = thinLeadMinerProspect(packet);
  prospect.truth_packet.meta.missing_build_evidence = ["content"];

  const certified = certifiedGenieContentFromRecord(prospect, {
    signingKey: KEY,
    nowMs: Date.parse(NOW),
  });
  assert.equal(certified.ok, true, JSON.stringify(certified));
  assert.deepEqual(certified.services, [
    { name: "Drain Cleaning" },
    { name: "Water Heater Repair" },
  ]);
  assert.deepEqual(certified.provenance.services, {
    source: "category_default",
    source_type: "category_default",
    services_source: "category_default",
    provenance: "estimated",
    verification_status: "estimated",
    estimated: true,
    verified: false,
    status: "estimated",
    scope: "content_completeness_only",
    receipt: {
      version: prospect.record.genie_content_certification.version,
      status: "certified",
      packet_sha256: prospect.record.genie_content_certification.packet_sha256,
      certified_at: "2026-08-24T18:00:00.000Z",
      expires_at: prospect.record.genie_content_certification.expires_at,
    },
    evidence: [
      {
        name: "Drain Cleaning",
        source: "category_default",
        source_type: "category_default",
        services_source: "category_default",
        provenance: "estimated",
        verification_status: "estimated",
        estimated: true,
        verified: false,
        status: "estimated",
      },
      {
        name: "Water Heater Repair",
        source: "category_default",
        source_type: "category_default",
        services_source: "category_default",
        provenance: "estimated",
        verification_status: "estimated",
        estimated: true,
        verified: false,
        status: "estimated",
      },
    ],
  });
  assert.equal(Object.hasOwn(certified.provenance.services.evidence[0], "source_url"), false);

  const { result, deps } = await build(prospect);
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.deepEqual(
    deps.captured.request.content.services.map((service) => service.name),
    ["Drain Cleaning", "Water Heater Repair"],
  );
  assert.equal(result.content_provenance.services.services_source, "category_default");
  assert.equal(result.content_provenance.services.estimated, true);
  assert.equal(result.content_provenance.services.verified, false);
  assert.equal(
    Object.hasOwn(result.content_provenance.services.evidence[0], "source_url"),
    false,
  );
});

test("a forged receipt cannot bridge canonical services into a thin build", async () => {
  const prospect = thinLeadMinerProspect();
  prospect.record.genie_content_certification.signature = "0".repeat(64);
  const { result, deps } = await build(prospect);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "leadminer_truth_packet_incomplete");
  assert.ok(result.missing.includes("services"));
  assert.equal(deps.captured.mirrorCalls, 0);
  assert.deepEqual(deps.captured.providerCalls, []);
});

test("an expired receipt cannot fall back through the persisted Intake packet", async () => {
  const prospect = thinLeadMinerProspect();
  const packet = prospect.record.genie_canonical_packet;
  const expired = createContentCertification(packet, prospect, {
    signingKey: KEY,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId: packet.request_id,
    jobId: packet.job_id,
    idempotencyKey: packet.idempotency_key,
    requestSources: packet.sources,
    certifiedAt: "2026-08-24T17:00:00.000Z",
    ttlMs: 60_000,
  });
  assert.equal(expired.ok, true, JSON.stringify(expired));
  prospect.record.genie_content_certification = expired.receipt;

  const { result, deps } = await build(prospect);

  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("services"));
  assert.equal(deps.captured.mirrorCalls, 0);
});

test("a packet-mismatched receipt cannot fall back through persisted Intake evidence", async () => {
  const prospect = thinLeadMinerProspect();
  prospect.record.genie_canonical_packet = {
    ...prospect.record.genie_canonical_packet,
    status: "ready",
  };

  const { result, deps } = await build(prospect);

  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("services"));
  assert.equal(deps.captured.mirrorCalls, 0);
});

test("a bare compatibility boolean never authorizes unsigned canonical content", async () => {
  const prospect = thinLeadMinerProspect();
  delete prospect.record.genie_content_certification;
  const { result, deps } = await build(prospect);

  assert.equal(prospect.record.genie_build_certified, true);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("services"));
  assert.equal(deps.captured.mirrorCalls, 0);
});

test("a valid content receipt cannot waive other LeadMiner gates", async () => {
  const cases = [
    {
      name: "identity provenance",
      mutate(prospect) { delete prospect.truth_packet.mirror_ready.provenance["/place_id"]; },
      missing: "place_id",
    },
    {
      name: "a non-content build gap",
      mutate(prospect) { prospect.truth_packet.meta.missing_build_evidence.push("duplicate"); },
      missing: "missing_build_evidence",
    },
  ];

  for (const item of cases) {
    const prospect = thinLeadMinerProspect();
    item.mutate(prospect);
    const { result, deps } = await build(prospect);
    assert.equal(result.ok, false, item.name);
    assert.ok(result.missing.includes(item.missing), `${item.name}: ${JSON.stringify(result)}`);
    assert.equal(deps.captured.mirrorCalls, 0, item.name);
  }
});

// ---------------------------------------------------------------------------
// Full-usage projection: extra certified pages and structured search intent
// ---------------------------------------------------------------------------

function fullUsageContractFiles() {
  return {
    "content/home.md": "# Home\n\nCertified Plumbing offers plumbing services for customers in Reno.",
    "content/about.md": "# About\n\nCertified Plumbing describes its team for customers in Reno.",
    "content/faq.md": "# FAQ\n\n## How do I request service?\n\nShare the location when you call.",
    "content/services/drain-cleaning.md": "# Drain Cleaning\n\nContact Certified Plumbing to discuss drain cleaning for your property in Reno.",
    "content/services/water-heater-repair.md": "# Water Heater Repair\n\nContact Certified Plumbing to discuss water heater repair for your property in Reno.",
    "content/services/sewer-line-replacement.md": "# Sewer Line Replacement\n\nContact Certified Plumbing to discuss sewer line replacement for your property in Reno.",
    "content/process.md": "# Process\n\nThe first visit walks the property and records what each fixture needs before any work begins.",
    "content/service-areas.md": "# Service Areas\n\nCertified Plumbing answers calls across Reno and the neighboring communities every weekday.",
    "content/contact.md": "# Contact\n\nReach the office by phone during business hours to describe the problem and pick a time.",
    "content/blog/drain-guide.md": "# Guide\n\nA slow drain usually means the trap needs clearing before the line backs up completely.",
  };
}

test("certified extra content pages project as pageCopy without touching the Mirror request schema", async () => {
  const packet = richCanonicalPacket();
  packet.content.content_contract = certifiedPracticeContract("plumbing", fullUsageContractFiles());
  const prospect = thinLeadMinerProspect(packet);

  const out = certifiedGenieContentFromRecord(prospect, { signingKey: KEY, nowMs: Date.parse(NOW) });
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 500));
  assert.deepEqual(Object.keys(out.canonical_packet.pageCopy), [
    "contact",
    "process",
    "service-areas",
    "blog/drain-guide",
  ], "home/about/faq/services are consumed by their own slots; the rest is pageCopy");
  for (const [slug, prose] of Object.entries(out.canonical_packet.pageCopy)) {
    assert.equal(prose, proseFrom(fullUsageContractFiles()[`content/${slug}.md`]).join("\n\n"), slug);
  }
  assert.equal(Object.keys(out.canonical_packet.serviceCopy).length, 3,
    "every certified service markdown still lands in serviceCopy");

  const { result, deps } = await build(prospect);
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
  assert.equal(deps.captured.request.content.pageCopy, undefined,
    "MirrorContent has no extra-page slot; pageCopy is not forced into the request");
  assert.equal(JSON.stringify(deps.captured.request.content).includes("first visit walks the property"), false,
    "extra-page prose never renders until the engine grows a consumer");
});

test("directive and builder markdown never projects as visitor copy, keywords, or pages", () => {
  const files = {
    "content/home.md": "# Home\n\nCertified Plumbing offers plumbing services for customers in Reno.",
    "VERCEL-BUILD-PROMPT.md": "# Build\n\nThe selected template receives the compiled data and packet marks.",
    "00-READ-ME-FIRST.md": "# Read Me\n\nThis intake packet lists the compiled data the builder must use.",
    "01-VERCEL-BUILD-COMMAND-CENTER.md": "# Command\n\nThe production build follows the selected template intake steps.",
    "02-TEMPLATE-SANITATION-CONTRACT.md": "# Contract\n\nThe finished site must match the template contract marks.",
    "VERCEL-OPERATOR-RUNBOOK.md": "# Runbook\n\nOperators follow the build steps in order before delivery credits.",
    "05-PACKET-DELTA-FIX-PROMPT.md": "# Delta\n\nCopy should match the compiled data from the packet.",
    "content/services/drain-cleaning.md": "# Drain Cleaning\n\nContact Certified Plumbing to discuss drain cleaning for your property in Reno.",
  };
  const packet = {
    ok: true,
    facts: { category: "plumbing" },
    content: { content_contract: certifiedPracticeContract("plumbing", files) },
    // Only builder markdown is available as a keyword-adjacent source; nothing
    // may be derived from it.
    packet2: { compiled: {} },
  };
  const out = visitorCopyProjection(packet);
  assert.equal(out.ok, true);
  assert.deepEqual(Object.keys(out.serviceCopy), ["drain-cleaning"]);
  assert.deepEqual(out.pageCopy, {}, "no builder markdown becomes a page");
  assert.deepEqual(out.keywords, [], "no builder markdown becomes search copy");
  assert.deepEqual(out.seo, { title: "", description: "" });
});

test("certified search-copy JSON files project keywords and SEO exactly like the disk packet", () => {
  const files = {
    "content/home.md": "# Home\n\nCertified Plumbing offers plumbing services for customers in Reno.",
    "seo.json": JSON.stringify({
      siteTitle: "Certified Plumbing Reno NV",
      siteDescription: "Certified Plumbing serves Reno with drain cleaning and water heater repair.",
      keywords: ["drain cleaning reno", "water heater repair reno nv"],
    }),
    "brightdata-serp-audit.json": JSON.stringify({
      queries: [{ keyword: "sewer line replacement reno", query: "sewer line replacement reno nv" }],
    }),
    "voice-search.json": JSON.stringify({ primaryService: "Drain Cleaning", city: "Reno NV" }),
  };
  const packet = {
    ok: true,
    facts: { category: "plumbing" },
    content: { content_contract: certifiedPracticeContract("plumbing", files) },
    packet2: { compiled: {} },
  };
  const out = visitorCopyProjection(packet);
  assert.deepEqual(out.keywords, [
    "drain cleaning reno",
    "water heater repair reno nv",
    "sewer line replacement reno",
    "drain cleaning reno nv",
  ]);
  assert.equal(out.seo.title, "Certified Plumbing Reno NV");
  assert.equal(out.seo.description, "Certified Plumbing serves Reno with drain cleaning and water heater repair.");
});

test("structured packet search intent is capped, length-bounded, and never invents a description", () => {
  const packet = {
    ok: true,
    facts: { category: "plumbing" },
    content: { content_contract: certifiedPracticeContract("plumbing", {
      "content/home.md": "# Home\n\nCertified Plumbing offers plumbing services for customers in Reno.",
    }) },
    optimization: {
      target_queries: [
        ...Array.from({ length: 20 }, (_, i) => `provenance bound query ${i} reno nv`),
        "a far too long keyword that exceeds the eighty character limit the MirrorContent schema enforces on every single keyword item",
      ],
    },
    packet2: { compiled: {
      searchOptimizationPlan: {
        primaryKeyword: "drain cleaning reno",
        secondaryKeywords: Array.from({ length: 8 }, (_, i) => `generated plan term ${i} reno nv`),
      },
      seo: {
        // Generated plan prose is not explicit search copy and must not project.
        description: "Reno's guaranteed 24/7 Drain Cleaning leader.",
      },
    } },
  };
  const out = visitorCopyProjection(packet);
  assert.equal(out.keywords.length, 24, "same ≤24 cap as the disk path");
  assert.ok(out.keywords.every((term) => term.length <= 80), "schema maxLength 80 respected");
  assert.equal(out.keywords.includes("a far too long keyword that exceeds the eighty character limit the MirrorContent schema enforces on every single keyword item"), false);
  assert.equal(out.keywords[0], "provenance bound query 0 reno nv", "provenance-bound queries lead");
  assert.equal(out.seo.description, "", "generated seo.description never projects");
  assert.equal(out.seo.title, "");
});

test("an explicit packet meta description projects word-bounded to the schema limit", () => {
  const packet = {
    ok: true,
    facts: { category: "plumbing" },
    content: { content_contract: certifiedPracticeContract("plumbing", {
      "content/home.md": "# Home\n\nCertified Plumbing offers plumbing services for customers in Reno.",
    }) },
    optimization: {
      target_queries: ["drain cleaning reno"],
      meta_description: `${Array.from({ length: 30 }, (_, i) => "word" + i).join(" ")} end`,
    },
  };
  const out = visitorCopyProjection(packet);
  assert.ok(out.seo.description.length > 0 && out.seo.description.length <= 200);
  assert.match(out.seo.description, / word\d+$/);
  assert.equal(out.seo.description.endsWith(" "), false);
});

test("pageCopy caps at twelve certified pages, top-level pages ahead of nested guides", () => {
  const files = {
    "content/home.md": "# Home\n\nCertified Plumbing offers plumbing services for customers in Reno.",
  };
  for (let i = 0; i < 10; i++) {
    files[`content/blog/guide-${i}.md`] = `# Guide ${i}\n\nThis guide paragraph runs long enough to count as real prose for readers in Reno.`;
  }
  for (let i = 0; i < 8; i++) {
    files[`content/area-${i}.md`] = `# Area ${i}\n\nThis area paragraph runs long enough to count as real prose for readers in Reno.`;
  }
  const packet = {
    ok: true,
    facts: { category: "plumbing" },
    content: { content_contract: certifiedPracticeContract("plumbing", files) },
  };
  const out = visitorCopyProjection(packet);
  assert.equal(Object.keys(out.pageCopy).length, 12);
  assert.deepEqual(Object.keys(out.pageCopy).slice(0, 8), ["area-0", "area-1", "area-2", "area-3", "area-4", "area-5", "area-6", "area-7"],
    "top-level pages are admitted before nested blog guides");
});
