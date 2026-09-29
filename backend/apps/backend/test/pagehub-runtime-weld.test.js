"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  pageHubBuildSupplement,
  stagePageHubBuildPacket,
} = require("../lib/pagehub-build-packet");
const { buildMirrorForProspect } = require("../lib/mirror-lane-build");

const SITE = "https://fixture-plumbing.example/";
const SOCIAL = "https://www.facebook.com/fixtureplumbing";
const SERVICES = ["Drain cleaning", "Water heater repair", "Hydro jetting"];

function packet2() {
  return {
    version: "intake-genie-v2",
    facts: {
      name: "Packet Name Must Stay Quarantined",
      phone: "+19999999999",
      rating: 5,
      review_count: 999999,
      website: SITE,
      services: [
        ...SERVICES.map((name) => ({ name, description: `Generated claim for ${name}` })),
        { name: "Invented luxury service", description: "Generated and unsupported" },
      ],
      socials: [SOCIAL, "https://www.facebook.com/not-the-prospect"],
    },
    content: {
      services: SERVICES.map((name) => ({ name, description: "Generated prose never crosses the seam" })),
      reviews: [{ author: "Invented", text: "Packet trust must stay quarantined" }],
    },
    assets: [
      { kind: "logo", url: `${SITE}assets/packet-logo.svg`, observed_on: SITE },
      { kind: "photo", url: "https://images.example-cdn.test/owned-job.jpg", observed_on: `${SITE}gallery` },
      { kind: "photo", url: "https://competitor.example/work.jpg", observed_on: "https://competitor.example/" },
    ],
    brand: {
      source: SITE,
      palette: [
        { hex: "#123456", role: "primary", observed_on: SITE },
        { hex: "#F47A1F", role: "cta accent", observed_on: SITE },
        { hex: "#FFFFFF", role: "background", observed_on: SITE },
      ],
      fonts: {
        display: "\"Oswald\", sans-serif",
        body: "Inter",
        href: "https://fonts.googleapis.com/css2?family=Inter&family=Oswald",
        source: SITE,
      },
    },
    packet2: {
      version: "2.0",
      sources: { urls: [SOCIAL, SITE], social: [SOCIAL] },
    },
    evidence: [
      {
        field: "services",
        value: SERVICES,
        source: `${SITE}services`,
        confidence: 0.82,
        verification_status: "source_observation",
      },
      {
        field: "services",
        value: ["Invented luxury service"],
        source: "https://competitor.example/services",
        confidence: 0.99,
        verification_status: "source_observation",
      },
      {
        field: "socials",
        value: [SOCIAL],
        source: SITE,
        verification_status: "source_observation",
      },
    ],
  };
}

function stagedRecord() {
  return stagePageHubBuildPacket({}, packet2(), new Date("2026-08-22T12:00:00.000Z")).record;
}

function proof(source, sourceKind = "website") {
  return {
    source,
    source_kind: sourceKind,
    captured_at: "2026-08-22T11:55:00.000Z",
  };
}

function leadMinerProspect() {
  const places = "https://places.googleapis.com/v1/places/ChIJPacket2Runtime";
  return {
    prospect_id: "place-packet2-runtime",
    record: stagedRecord(),
    truth_packet: {
      meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
      mirror_ready: {
        business_name: "Verified Fixture Plumbing",
        place_id: "ChIJPacket2Runtime",
        industry: "plumber",
        city: "Fresno",
        state: "CA",
        phone_e164: "+15595550112",
        rating: 4.8,
        review_count: 214,
        website_url: SITE,
        logo_url: `${SITE}assets/verified-logo.svg`,
        logo_source_url: SITE,
        photos: [{ url: `${SITE}assets/verified-truck.jpg`, source: "own_site" }],
        provenance: {
          "/business_name": proof(places, "google_places_api"),
          "/place_id": proof(places, "google_places_api"),
          "/industry": proof("leadminer:project-trade:plumber", "leadminer_derived"),
          "/city": proof(places, "google_places_api"),
          "/state": proof(places, "google_places_api"),
          "/phone_e164": proof(places, "google_places_api"),
          "/rating": proof(places, "google_places_api"),
          "/review_count": proof(places, "google_places_api"),
          "/website_url": proof(places, "google_places_api"),
          "/logo_url": proof(SITE),
          "/logo_source_url": proof(SITE),
          "/photos/0/url": proof(`${SITE}gallery`),
          "/photos/0/source": proof(`${SITE}gallery`),
        },
      },
    },
  };
}

function engineSuccess(request) {
  return {
    status: 200,
    body: {
      ok: true,
      revealable: true,
      preview_url: `https://${request.slug}.wss-ai.com/`,
      checks: { content: { status: "injected", sections: 1 } },
    },
  };
}

test("the staged sidecar is hash-checked and exposes only source-bound supplements", () => {
  const record = stagedRecord();
  const supplement = pageHubBuildSupplement(record, { website: SITE });

  assert.equal(supplement.ok, true);
  assert.deepEqual(supplement.services, SERVICES.map((name) => ({ name })));
  assert.deepEqual(supplement.socials, [{ network: "facebook", url: SOCIAL, provenance: "own_site_link" }]);
  assert.deepEqual(supplement.asset_candidates.map((asset) => asset.url), [
    `${SITE}assets/packet-logo.svg`,
    "https://images.example-cdn.test/owned-job.jpg",
  ]);
  assert.equal(supplement.logo_candidate.url, `${SITE}assets/packet-logo.svg`);
  assert.deepEqual(supplement.brand.fonts, {
    display: "Oswald",
    body: "Inter",
    href: "https://fonts.googleapis.com/css2?family=Inter&family=Oswald",
    source: SITE,
    provider: "google",
  });
  assert.equal(supplement.brand.primary, "#123456");
  assert.equal(supplement.brand.site_accent, "#F47A1F");
  for (const protectedField of ["name", "phone", "rating", "review_count", "reviews", "content"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(supplement, protectedField), false, protectedField);
  }

  record.pagehub_build_packet.snapshot.facts.phone = "+18888888888";
  const tampered = pageHubBuildSupplement(record, { website: SITE });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, "pagehub_build_packet_hash_mismatch");
  assert.deepEqual(tampered.asset_candidates, []);
  assert.deepEqual(tampered.services, []);
  assert.deepEqual(tampered.brand, {});

  const competitorBrandPacket = packet2();
  competitorBrandPacket.brand.fonts.source = "https://competitor.example/";
  competitorBrandPacket.brand.palette = competitorBrandPacket.brand.palette.map((row) => ({
    ...row,
    observed_on: "https://competitor.example/",
  }));
  const competitorBrandRecord = stagePageHubBuildPacket({}, competitorBrandPacket).record;
  const competitorBrand = pageHubBuildSupplement(competitorBrandRecord, { website: SITE });
  assert.deepEqual(competitorBrand.brand, {}, "a mixed-in competitor brand cannot style this prospect");
});

test("LeadMiner packet consumes safe Packet2 design evidence with zero resolver or harvester calls", async () => {
  const calls = { facts: 0, harvest: 0, captureFonts: 0, fontFallback: 0 };
  let request;
  const out = await buildMirrorForProspect(leadMinerProspect(), {
    dryRun: true,
    research: false,
    designBrief: false,
    deps: {
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
      resolveVerifiedFacts: async () => { calls.facts += 1; throw new Error("resolver_forbidden"); },
      harvestClientPhotos: async () => { calls.harvest += 1; throw new Error("harvester_forbidden"); },
      captureFonts: async () => { calls.captureFonts += 1; throw new Error("font_capture_forbidden"); },
      harvestFontsFallback: async () => { calls.fontFallback += 1; throw new Error("font_fallback_forbidden"); },
      readFleetIdentities: async () => ({ ok: true, identities: [] }),
      recordFleetIdentity: async () => ({ ok: true }),
      readIntakePacket: () => ({ ok: false }),
      mergeIntoContent: (content) => content,
      mirror: async (value) => { request = value; return engineSuccess(value); },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.revealable, true);
  assert.deepEqual(calls, { facts: 0, harvest: 0, captureFonts: 0, fontFallback: 0 });
  assert.deepEqual(out.provider_calls, { google: 0, firecrawl: 0, intake_genie: 0 });
  assert.equal(request.facts.business_name, "Verified Fixture Plumbing");
  assert.equal(request.facts.phone, "+15595550112");
  assert.equal(request.facts.rating, 4.8);
  assert.equal(request.facts.review_count, 214);
  assert.deepEqual(request.facts.socials, [{ network: "facebook", url: SOCIAL, provenance: "own_site_link" }]);
  assert.deepEqual(request.content.services, SERVICES.map((name) => ({ name })));
  assert.doesNotMatch(JSON.stringify(request.content), /Generated|Invented/);
  assert.equal(request.brand.logo, `${SITE}assets/verified-logo.svg`, "LeadMiner's verified mark outranks Packet2");
  assert.deepEqual(request.brand.photos, [`${SITE}assets/verified-truck.jpg`], "unverified Packet2 photos never enter the exact packet path");
  assert.equal(request.brand.fonts.display, "Oswald");
  assert.equal(request.brand.primary, "#123456");
  assert.equal(request.brand.site_accent, "#F47A1F");
  assert.deepEqual(request.brand.source_packet, {
    contract: "pagehub-build-packet",
    packet_id: leadMinerProspect().record.pagehub_build_packet.packet_id,
    snapshot_sha256: leadMinerProspect().record.pagehub_build_packet.snapshot_sha256,
  });
});

test("resolver path sends Packet2 photos through the existing harvester before publication", async () => {
  const captured = { harvest: null, request: null, captureFonts: 0, socialContract: null };
  const record = stagedRecord();
  const acceptedPhoto = `${SITE}assets/harvester-approved-job.jpg`;
  const out = await buildMirrorForProspect({
    prospect_id: "place-packet2-resolver",
    business_name: "Verified Fixture Plumbing",
    industry: "plumbing",
    city: "Fresno",
    state: "CA",
    current_website: SITE,
    record,
  }, {
    dryRun: true,
    research: false,
    designBrief: false,
    trustLookup: false,
    deps: {
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
      resolveVerifiedFacts: async () => ({
        ok: true,
        facts: {
          business_name: "Verified Fixture Plumbing",
          city: "Fresno",
          state: "CA",
          phone: "+15595550112",
          current_website: SITE,
          rating: 4.8,
          review_count: 214,
        },
        content: {
          reviews: [{ author: "Real Reviewer", text: "Observed review" }],
          hours: ["Monday: 8:00 AM – 5:00 PM"],
        },
        coverage: {},
      }),
      harvestClientPhotos: async (args) => {
        captured.harvest = args;
        return {
          ok: true,
          photos: [{
            url: acceptedPhoto,
            sha256: "a".repeat(64),
            ext: "jpg",
            bytes: 85000,
            width: 1600,
            height: 1000,
            found_on: `${SITE}gallery`,
          }],
        };
      },
      captureFonts: async () => { captured.captureFonts += 1; throw new Error("staged_font_should_win"); },
      resolveSocials: async ({ contract }) => {
        captured.socialContract = contract;
        return { socials: contract.socials || [], source: "contract", refused: [] };
      },
      readFleetIdentities: async () => ({ ok: true, identities: [] }),
      recordFleetIdentity: async () => ({ ok: true }),
      mirror: async (request) => { captured.request = request; return engineSuccess(request); },
    },
  });

  assert.equal(out.ok, true);
  assert.ok(captured.harvest, "the existing media gate ran");
  assert.deepEqual(captured.harvest.genieAssets.map((asset) => asset.url), [
    "https://images.example-cdn.test/owned-job.jpg",
  ]);
  assert.deepEqual(captured.request.brand.photos, [acceptedPhoto], "only the harvester survivor is published");
  assert.equal(captured.request.brand.logo, `${SITE}assets/packet-logo.svg`);
  assert.equal(captured.captureFonts, 0);
  assert.equal(captured.request.brand.fonts.display, "Oswald");
  assert.equal(captured.request.brand.site_accent, "#F47A1F");
  assert.deepEqual(captured.request.brand.source_packet, {
    contract: "pagehub-build-packet",
    packet_id: record.pagehub_build_packet.packet_id,
    snapshot_sha256: record.pagehub_build_packet.snapshot_sha256,
  });
  assert.deepEqual(captured.request.content.services, SERVICES.map((name) => ({ name })));
  assert.doesNotMatch(JSON.stringify(captured.request.content), /Generated|Invented/);
  assert.equal(captured.request.facts.phone, "+15595550112");
  assert.equal(captured.request.facts.rating, 4.8);
  assert.equal(captured.request.facts.review_count, 214);
  assert.deepEqual(captured.socialContract.socials, [{ network: "facebook", url: SOCIAL, provenance: "own_site_link" }]);
});

test("resolver binds Packet2 only after the final verified website and drops a stale company's supplement", async () => {
  const staleSite = "https://wrong-company.example/";
  const verifiedSite = "https://right-company.example/";
  const stalePacket = packet2();
  stalePacket.facts.website = staleSite;
  stalePacket.assets = [
    { kind: "logo", url: `${staleSite}wrong-logo.svg`, observed_on: staleSite },
    { kind: "photo", url: `${staleSite}wrong-job.jpg`, observed_on: staleSite },
  ];
  stalePacket.brand = {
    palette: [{ hex: "#FF3300", role: "cta accent", observed_on: staleSite }],
    fonts: {
      display: "Wrong Company Display",
      body: "Wrong Company Body",
      href: "https://fonts.googleapis.com/css2?family=Inter",
      source: staleSite,
    },
  };
  stalePacket.packet2.sources = { urls: [staleSite] };
  stalePacket.evidence = [{
    field: "services",
    value: ["Wrong Company Service"],
    source: `${staleSite}services`,
    confidence: 0.99,
    verification_status: "source_observation",
  }];
  stalePacket.facts.services = [{ name: "Wrong Company Service" }];
  stalePacket.content.services = [{ name: "Wrong Company Service" }];
  const record = stagePageHubBuildPacket({}, stalePacket).record;
  const captured = { harvest: null, request: null };

  const out = await buildMirrorForProspect({
    prospect_id: "place-packet2-stale-resolver",
    business_name: "Right Company Plumbing",
    industry: "plumbing",
    city: "Fresno",
    state: "CA",
    // This is only a resolver hint. It is deliberately the stale Packet2 site.
    current_website: staleSite,
    // The stored contract is the final verified fallback when today's resolver
    // cannot re-observe the site. It must outrank the loose resolver hint.
    verified_facts: { current_website: verifiedSite },
    record,
  }, {
    dryRun: true,
    research: false,
    designBrief: false,
    trustLookup: false,
    deps: {
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
      resolveVerifiedFacts: async () => ({
        ok: true,
        facts: {
          business_name: "Right Company Plumbing",
          city: "Fresno",
          state: "CA",
          phone: "+15595550113",
          rating: 4.7,
          review_count: 88,
        },
        content: {
          services: ["Drain cleaning", "Water heater repair", "Hydro jetting"],
          reviews: [{ author: "Real Reviewer", text: "Observed review" }],
          hours: ["Monday: 8:00 AM – 5:00 PM"],
        },
        coverage: {},
      }),
      harvestClientPhotos: async (args) => {
        captured.harvest = args;
        return { ok: false, photos: [] };
      },
      captureFonts: async () => ({ ok: false }),
      resolveSocials: async () => ({ socials: [], source: "none", refused: [] }),
      readFleetIdentities: async () => ({ ok: true, identities: [] }),
      recordFleetIdentity: async () => ({ ok: true }),
      mirror: async (request) => { captured.request = request; return engineSuccess(request); },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(captured.request.facts.current_website, verifiedSite);
  assert.deepEqual(captured.harvest.genieAssets, []);
  assert.equal(captured.request.brand.logo, undefined);
  assert.ok(captured.request.brand.mark, "true logo absence uses the logo ladder");
  assert.equal(captured.request.brand.fonts, undefined);
  assert.equal(captured.request.brand.site_accent, undefined);
  assert.deepEqual(captured.request.brand.source_packet, {
    contract: "pagehub-build-packet",
    packet_id: record.pagehub_build_packet.packet_id,
    snapshot_sha256: record.pagehub_build_packet.snapshot_sha256,
  }, "the signed receipt records the inspected snapshot even though every foreign observation was dropped");
  assert.deepEqual(captured.request.content.services, SERVICES.map((name) => ({ name })));
  assert.doesNotMatch(JSON.stringify(captured.request), /wrong-company|Wrong Company|#FF3300/);
});
