"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMirrorForProspect,
  leadMinerMirrorInput,
  serviceFloorReport,
} = require("../lib/mirror-lane-build");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { resolveBrandAssets } = require("../lib/mirror-engine/brand-assets");

const capturedAt = "2026-08-14T12:00:00.000Z";
const logoBytes = Buffer.from("anchor-logo-bytes");
const proof = (source = "https://maps.example/place") => ({
  source,
  source_kind: "google_places_api",
  captured_at: capturedAt,
});

function thinPacket(extraLead = {}, extraPacket = {}) {
  return {
    source: "leadminer_mirror_ready",
    meta: {
      source: "leadminer_mirror_ready",
      build_ready: false,
      missing_build_evidence: ["verified_logo", "verified_photo_or_video", "verified_service_evidence"],
    },
    identity: {
      name: { value: "Anchor Plumbing Co", verified: true, status: "verified", confidence: 1, source: "google_places_api" },
      place_id: { value: "ChIJthin", verified: true, status: "verified", confidence: 1, source: "google_places_api" },
      category: { value: "plumbing", verified: true, status: "verified", confidence: 1, source: "google_places_api" },
    },
    mirror_ready: {
      business_name: "Anchor Plumbing Co",
      place_id: "ChIJthin",
      industry: "plumbing",
      city: "Anchorage",
      state: "AK",
      provenance: {
        "/city": proof(),
        "/state": proof(),
      },
      ...extraLead,
    },
    ...extraPacket,
  };
}

function verifiedService(name = "Hydronic Heating") {
  return {
    field: "services",
    value: name,
    source: "https://anchor.example/services",
    source_url: "https://anchor.example/services",
    verified: true,
    status: "verified",
    confidence: 1,
  };
}

function engineDeps(captured, overrides = {}) {
  return {
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
    captureFonts: async () => ({ ok: false }),
    readFleetIdentities: () => [],
    recordFleetIdentity: () => {},
    firstPartySite: async () => ({ status: "ok" }),
    resolveVerifiedFacts: async () => ({
      ok: false,
      content: { services: [{ name: "Hydronic Heating" }] },
      provenance: {
        services: {
          class: "self_published",
          corroboration: "single_self_published",
          sources: [{ source: "first_party_site", observer: "business_self", transport: "direct_fetch" }],
        },
      },
      cost: { requests: 1 },
    }),
    brandFromWebsite: async () => ({
      logo: {
        url: "https://anchor.example/assets/anchor-logo.png",
        b64: logoBytes.toString("base64"),
      },
      sourceUrl: "https://anchor.example/",
      logoPick: { reason: "header_logo", tier: "explicit_brand" },
      measured: true,
    }),
    mirror: async (request) => {
      const validation = checkMirrorRequest(request);
      assert.equal(validation.ok, true, JSON.stringify(validation.body?.detail || []));
      captured.request = request;
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: `https://${request.slug}.wss-ai.com/`,
          renderer: "mirror-engine@v1",
          qc_contract: "mirror-qc-v1",
          evidence_schema: "mirror-evidence-v1",
          evidence_sha: "e".repeat(64),
          donor_content_hash: "d".repeat(64),
          logo_sha: "a".repeat(64),
          build_hash: "b".repeat(64),
          deploy_id: "dpl_test",
          deploy_url: "https://dpl-test.vercel.app",
          checks: { content: { status: "injected", sections: 1 } },
        },
      };
    },
    ...overrides,
  };
}

test("strict packets still refuse missing build evidence", () => {
  const out = leadMinerMirrorInput(thinPacket());
  assert.equal(out.ok, false);
  assert.equal(out.reason, "leadminer_truth_packet_incomplete");
});

test("a strict packet whose only legacy gap is verified_logo now selects the wordmark rung", () => {
  const packet = thinPacket({
    services: [{ name: "Drain Cleaning" }],
    photos: [{ url: "https://lh3.googleusercontent.com/anchor-job.jpg", source: "gbp" }],
    provenance: {
      "/city": proof(),
      "/state": proof(),
      "/services/0/name": proof(),
      "/photos/0/url": proof(),
      "/photos/0/source": proof(),
    },
  }, {
    meta: {
      source: "leadminer_mirror_ready",
      build_ready: false,
      missing_build_evidence: ["verified_logo"],
    },
  });

  const out = leadMinerMirrorInput(packet);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.brand.logo, undefined);
  assert.equal(out.brand.mark.rung, "wordmark");
  assert.equal(out.brand.mark.value.text, "Anchor Plumbing Co");
});

test("needs_fill cannot waive unverified identity", () => {
  const packet = thinPacket({}, { identity: undefined });
  const out = leadMinerMirrorInput(packet, { needsFill: true });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "leadminer_identity_unverified");
  assert.deepEqual(out.missing, ["business_name", "place_id", "industry"]);
});

test("needs_fill input stays empty instead of inventing service or accent", () => {
  const out = leadMinerMirrorInput(thinPacket(), { needsFill: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.needs_fill, true);
  assert.deepEqual(out.content, {});
  assert.equal(out.content_source, undefined);
  assert.equal(out.brand.logo, undefined);
  assert.equal(out.brand.accent_fallback, undefined);
  assert.equal(out.facts.rating, undefined);
  assert.equal(out.facts.review_count, undefined);
});

test("verified service_evidence is rescued with provenance; generated evidence is refused", () => {
  const packet = thinPacket({}, {
    service_evidence: [
      { ...verifiedService("Emergency Plumbing"), generated: true },
      verifiedService("Drain Cleaning"),
    ],
  });
  const out = leadMinerMirrorInput(packet, { needsFill: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.content.services, [{ name: "Drain Cleaning" }]);
  assert.equal(out.content_source, "verified_packet");
  assert.equal(out.content_provenance.services.source, "verified_packet");
  assert.equal(out.content_provenance.services.evidence[0].source_url, "https://anchor.example/services");
});

test("first-party rescue reaches the real validator and carries native release evidence", async () => {
  const captured = {};
  const out = await buildMirrorForProspect({
    prospect_id: "place_thin",
    business_name: "Anchor Plumbing Co",
    current_website: "https://anchor.example/",
    truth_packet: thinPacket(),
    truth_packet_source: "leadminer_mirror_ready",
    needs_fill: true,
  }, { dryRun: true, designBrief: false, deps: engineDeps(captured) });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.content_source, "first_party_site");
  assert.equal(out.needs_fill, true);
  assert.deepEqual(captured.request.content.services, [{ name: "Hydronic Heating", description: undefined }]);
  assert.equal(captured.request.brand.logo, "https://anchor.example/assets/anchor-logo.png");
  assert.match(captured.request.brand.logo_sha256, /^[0-9a-f]{64}$/);
  assert.equal(captured.request.brand.mark, undefined);
  assert.equal(captured.request.brand.accent_fallback, undefined);
  assert.equal(out.truth_packet.mirror_ready.logo_url, "https://anchor.example/assets/anchor-logo.png");
  assert.equal(out.truth_packet.mirror_ready.logo_source_url, "https://anchor.example/");
  assert.equal(out.truth_packet.mirror_ready.logo_sha256, captured.request.brand.logo_sha256);
  const rescuedPacket = leadMinerMirrorInput(out.truth_packet, { needsFill: true });
  assert.equal(rescuedPacket.brand.logo, "https://anchor.example/assets/anchor-logo.png");
  assert.equal(rescuedPacket.brand.logo_sha256, captured.request.brand.logo_sha256);
  assert.equal(captured.request.content.nearby, undefined);
  assert.equal(out.service_floor.verdict, "met");
  assert.equal(out.renderer, "mirror-engine@v1");
  assert.equal(out.qc_contract, "mirror-qc-v1");
  assert.equal(out.evidence_schema, "mirror-evidence-v1");
  assert.equal(out.evidence_sha, "e".repeat(64));
  assert.equal(out.donor_content_hash, "d".repeat(64));
  assert.equal(out.logo_sha, "a".repeat(64));
  assert.equal(out.deploy_id, "dpl_test");
  assert.equal(out.provider_calls.first_party_site, 1);
  assert.equal(out.provider_calls.brand_site, 1);
});

test("stored MirrorRequest contract rescues content and real brand without a site call", async () => {
  const captured = {};
  let siteCalls = 0;
  const out = await buildMirrorForProspect({
    business_name: "Anchor Plumbing Co",
    truth_packet: thinPacket(),
    needs_fill: true,
    record: {
      build_ready: {
        mirror_request: {
          facts: { current_website: "" },
          brand: { logo: "https://anchor.example/logo.png" },
          content: { services: [{ name: "Boiler Repair" }] },
        },
      },
    },
  }, {
    dryRun: true,
    designBrief: false,
    deps: engineDeps(captured, {
      resolveVerifiedFacts: async () => { siteCalls += 1; return null; },
      brandFromWebsite: async () => { siteCalls += 1; return null; },
    }),
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(siteCalls, 0);
  assert.equal(out.content_source, "stored_contract");
  assert.deepEqual(captured.request.content.services, [{ name: "Boiler Repair" }]);
  assert.equal(captured.request.brand.logo, "https://anchor.example/logo.png");
  assert.equal(captured.request.brand.mark, undefined);
});

test("stored site accent survives a needs-fill rescue without requiring a stored logo", async () => {
  const captured = {};
  const out = await buildMirrorForProspect({
    business_name: "Anchor Plumbing Co",
    truth_packet: thinPacket(),
    needs_fill: true,
    record: {
      build_ready: {
        mirror_request: {
          facts: { current_website: "" },
          brand: {
            site_accent: "#0b5cab",
            site_accent_source: "https://anchor.example/",
          },
          content: { services: [{ name: "Boiler Repair" }] },
        },
      },
    },
  }, {
    dryRun: true,
    designBrief: false,
    deps: engineDeps(captured),
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(captured.request.brand.logo, undefined);
  assert.equal(captured.request.brand.mark.rung, "wordmark");
  assert.equal(captured.request.brand.site_accent, "#0b5cab");
  assert.equal(captured.request.brand.site_accent_source, "https://anchor.example/");
  const brandOut = await resolveBrandAssets(captured.request.brand);
  assert.equal(brandOut.accent, "#0B5CAB");
  assert.equal(brandOut.mark.rung, "wordmark");
});

test("zero logo sources fall to a recorded wordmark and the build continues", async () => {
  const captured = {};
  const out = await buildMirrorForProspect({
    business_name: "Anchor Plumbing Co",
    truth_packet: thinPacket({
      brand_colors: { accent: "#0b5cab" },
      provenance: {
        "/city": proof(),
        "/state": proof(),
        "/brand_colors/accent": {
          source: "https://anchor.example/",
          source_kind: "site_scrape",
          captured_at: capturedAt,
        },
      },
    }, { service_evidence: [verifiedService("Drain Cleaning")] }),
    needs_fill: true,
  }, {
    dryRun: true,
    designBrief: false,
    deps: engineDeps(captured, { brandFromWebsite: async () => null }),
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(captured.request.brand.logo, undefined);
  assert.deepEqual(captured.request.brand.mark, {
    rung: "wordmark",
    value: { type: "wordmark", text: "Anchor Plumbing Co", color: "#0b5cab" },
    reason: "no usable image fell to wordmark",
  });
  assert.equal(captured.request.brand.accent_fallback, undefined);
  assert.equal(captured.request.brand.site_accent, "#0b5cab");
  assert.equal(captured.request.brand.site_accent_source, "https://anchor.example/");
  const brandOut = await resolveBrandAssets(captured.request.brand);
  assert.equal(brandOut.accent, "#0B5CAB");
  assert.equal(brandOut.accent_decision.winner, "site_chrome");
  assert.equal(brandOut.mark.rung, "wordmark");
  assert.match(brandOut.hashes.mark_sha, /^[0-9a-f]{64}$/);
  assert.equal(out.brand_provenance.source, "logo_ladder");
  assert.equal(out.brand_provenance.rung, "wordmark");
});

test("the logo ladder is default-on and its kill switch restores the needs-fill logo refusal", async () => {
  const envName = "GHOST_AGENCY_LOGO_LADDER_FALLBACK";
  const previous = process.env[envName];
  try {
    delete process.env[envName];
    const defaultCaptured = {};
    const prospect = {
      business_name: "Anchor Plumbing Co",
      truth_packet: thinPacket({}, { service_evidence: [verifiedService("Drain Cleaning")] }),
      needs_fill: true,
    };
    const defaultOut = await buildMirrorForProspect(prospect, {
      dryRun: true,
      designBrief: false,
      deps: engineDeps(defaultCaptured, { brandFromWebsite: async () => null }),
    });
    assert.equal(defaultOut.ok, true, JSON.stringify(defaultOut));
    assert.equal(defaultCaptured.request.brand.mark.rung, "wordmark");

    process.env[envName] = "0";
    const disabledCaptured = {};
    const disabledOut = await buildMirrorForProspect(prospect, {
      dryRun: true,
      designBrief: false,
      deps: engineDeps(disabledCaptured, { brandFromWebsite: async () => null }),
    });
    assert.equal(disabledOut.ok, false);
    assert.equal(disabledOut.reason, "no_verified_logo");
    assert.equal(disabledCaptured.request, undefined, "the kill switch must refuse before mirror()");
  } finally {
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
  }
});

test("a provenance-failing first-party logo candidate still refuses instead of falling back", async () => {
  const captured = {};
  const out = await buildMirrorForProspect({
    business_name: "Anchor Plumbing Co",
    current_website: "https://anchor.example/",
    truth_packet: thinPacket({}, { service_evidence: [verifiedService("Drain Cleaning")] }),
    needs_fill: true,
  }, {
    dryRun: true,
    designBrief: false,
    deps: engineDeps(captured, {
      brandFromWebsite: async () => ({
        logo: { url: "https://anchor.example/assets/blogger_logo.png" },
        sourceUrl: "https://anchor.example/",
      }),
    }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, "logo_third_party_mark");
  assert.equal(captured.request, undefined, "the foreign mark must stop before mirror()");
});

test("a packet logo without provenance still fails closed even when a hash is present", () => {
  const packet = thinPacket({
    services: [{ name: "Drain Cleaning" }],
    photos: [{ url: "https://lh3.googleusercontent.com/anchor-job.jpg", source: "gbp" }],
    logo_url: "https://anchor.example/assets/anchor-logo.png",
    logo_source_url: "https://anchor.example/",
    logo_sha256: "a".repeat(64),
    provenance: {
      "/city": proof(),
      "/state": proof(),
      "/services/0/name": proof(),
      "/photos/0/url": proof(),
      "/photos/0/source": proof(),
    },
  }, {
    meta: {
      source: "leadminer_mirror_ready",
      build_ready: true,
      missing_build_evidence: [],
    },
  });
  const out = leadMinerMirrorInput(packet);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "leadminer_truth_packet_incomplete");
  assert.deepEqual(out.missing, ["logo"]);
});

test("a redirect-provenance failure cannot be laundered through the logo ladder", async () => {
  const captured = {};
  const out = await buildMirrorForProspect({
    business_name: "Anchor Plumbing Co",
    current_website: "https://anchor.example/",
    truth_packet: thinPacket({}, { service_evidence: [verifiedService("Drain Cleaning")] }),
    needs_fill: true,
  }, {
    dryRun: true,
    designBrief: false,
    deps: engineDeps(captured, {
      brandFromWebsite: async () => ({
        logo: null,
        hardProvenanceFailure: {
          reason: "logo_redirect_provenance_failed",
          requestedUrl: "https://anchor.example/logo.svg",
          finalUrl: "https://competitor.example/logo.svg",
        },
      }),
    }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, "logo_provenance_failed");
  assert.equal(captured.request, undefined);
});

test("a real mark with no verified service list fails closed as no_verified_content", async () => {
  const captured = {};
  const out = await buildMirrorForProspect({
    business_name: "Anchor Plumbing Co",
    current_website: "https://anchor.example/",
    truth_packet: thinPacket(),
    needs_fill: true,
  }, {
    dryRun: true,
    designBrief: false,
    deps: engineDeps(captured, {
      resolveVerifiedFacts: async () => ({ ok: false, content: {}, provenance: {}, cost: { requests: 1 } }),
    }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_verified_content");
  assert.equal(captured.request, undefined);
});

test("needs_fill never lowers the configured service floor", () => {
  process.env.MIRROR_SERVICE_FLOOR = "3";
  try {
    const out = serviceFloorReport({ services: [{ name: "Drain Cleaning" }] }, undefined, { aiFill: true });
    assert.equal(out.status, "failed");
    assert.equal(out.floor, 3);
    assert.equal(out.ai_fill, undefined);
  } finally {
    delete process.env.MIRROR_SERVICE_FLOOR;
  }
});
