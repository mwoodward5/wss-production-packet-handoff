"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
const { isUnrecognizedLogoAssetFailure, isDeadDomainLogoFailure } = require("../lib/mirror-engine/brand-assets");

const SITE = "https://anchor.example/";
const LOGO = `${SITE}assets/anchor-logo.png`;
const CAPTURED_AT = "2026-08-22T12:00:00.000Z";

function proof(source = SITE, source_kind = "website") {
  return { source, source_kind, captured_at: CAPTURED_AT };
}

function prospect(logo = LOGO) {
  const places = "https://places.googleapis.com/v1/places/ChIJAnchor";
  return {
    prospect_id: "place-anchor",
    business_name: "Anchor Plumbing Co",
    truth_packet: {
      meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
      mirror_ready: {
        business_name: "Anchor Plumbing Co",
        place_id: "ChIJAnchor",
        industry: "plumber",
        city: "Anchorage",
        state: "AK",
        logo_url: logo,
        logo_source_url: SITE,
        brand_colors: { accent: "#0b5cab" },
        photos: [{ url: `${SITE}truck.jpg`, source: "own_site" }],
        services: [
          { name: "Drain cleaning" },
          { name: "Water heater repair" },
          { name: "Hydro jetting" },
        ],
        provenance: {
          "/business_name": proof(places, "google_places_api"),
          "/place_id": proof(places, "google_places_api"),
          "/industry": proof("leadminer:project-trade:plumber", "leadminer_derived"),
          "/city": proof(places, "google_places_api"),
          "/state": proof(places, "google_places_api"),
          "/logo_url": proof(),
          "/logo_source_url": proof(),
          "/brand_colors/accent": proof(),
          "/photos/0/url": proof(),
          "/photos/0/source": proof(),
          "/services/0/name": proof(`${SITE}services`),
          "/services/1/name": proof(`${SITE}services`),
          "/services/2/name": proof(`${SITE}services`),
        },
      },
    },
  };
}

function deps(mirror) {
  return {
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
    captureFonts: async () => ({ ok: false }),
    readFleetIdentities: async () => ({ ok: true, identities: [] }),
    recordFleetIdentity: async () => {},
    mirror,
  };
}

function success(request) {
  return {
    status: 200,
    body: {
      ok: true,
      revealable: true,
      preview_url: `https://${request.slug}.wss-ai.com/`,
      checks: {
        content: { status: "injected", sections: 1 },
        brand: {
          status: "passed",
          logo: "wordmark-fallback",
          mark: request.brand.mark,
          mark_fallback: request.brand.mark?.rung || null,
        },
      },
    },
  };
}

test("owned logo URL serving non-image bytes retries with the exact recorded ladder mark", async () => {
  const requests = [];
  const out = await buildMirrorForProspect(prospect(), {
    dryRun: true,
    designBrief: false,
    deps: deps(async (request) => {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        return {
          status: 422,
          body: {
            ok: false,
            error: "brand_asset_rejected",
            detail: [{ path: "/brand/logo", reason: "not_a_recognized_image" }],
          },
        };
      }
      return success(request);
    }),
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].brand.logo, LOGO, "the owned candidate is tried once");
  assert.equal(requests[1].brand.logo, undefined);
  assert.equal(requests[1].brand.logo_sha256, undefined);
  assert.deepEqual(requests[1].brand.mark, {
    rung: "wordmark",
    value: { type: "wordmark", text: "Anchor Plumbing Co", color: "#0b5cab" },
    reason: "no usable image fell to wordmark",
  });
  assert.deepEqual(out.checks.brand.mark, requests[1].brand.mark);
});

test("only HTTP 422 may turn unrecognized logo bytes into a ladder retry", async () => {
  const body = {
    ok: false,
    error: "brand_asset_rejected",
    detail: [{ path: "/brand/logo", reason: "not_a_recognized_image" }],
  };

  assert.equal(isUnrecognizedLogoAssetFailure({ status: 422, body }), true);
  assert.equal(isUnrecognizedLogoAssetFailure({ status: 500, body }), false);
  assert.equal(isUnrecognizedLogoAssetFailure(body), true, "internal body-only results remain compatible");

  let calls = 0;
  const out = await buildMirrorForProspect(prospect(), {
    dryRun: true,
    designBrief: false,
    deps: deps(async () => {
      calls += 1;
      return { status: 500, body };
    }),
  });

  assert.equal(calls, 1, "matching error text on HTTP 500 must never erase the logo and retry");
  assert.equal(out.ok, false);
  assert.equal(out.reason, "brand_asset_rejected");
  assert.deepEqual(out.detail, body.detail);
});

test("only unrecognized bytes qualify: hash, foreign-mark and render failures remain hard", async (t) => {
  const cases = [
    {
      name: "content hash mismatch",
      status: 422,
      error: "brand_asset_rejected",
      detail: [{ path: "/brand/logo_sha256", reason: "content_hash_mismatch" }],
    },
    {
      name: "foreign mark after redirect",
      status: 422,
      error: "brand_asset_rejected",
      detail: [{ path: "/brand/logo", reason: "third_party_mark_denylisted_after_redirect" }],
    },
    {
      name: "valid logo written but unrendered",
      status: 500,
      error: "brand_logo_unreferenced",
      detail: [{ path: "/brand/logo", reason: "client_logo_written_but_never_referenced_in_served_markup" }],
    },
  ];

  for (const example of cases) {
    await t.test(example.name, async () => {
      let calls = 0;
      const refusal = { status: example.status, body: { ok: false, error: example.error, detail: example.detail } };
      assert.equal(isUnrecognizedLogoAssetFailure(refusal), false);
      const out = await buildMirrorForProspect(prospect(), {
        dryRun: true,
        designBrief: false,
        deps: deps(async () => {
          calls += 1;
          return refusal;
        }),
      });
      assert.equal(calls, 1, "a truth/render failure must never be retried without the logo");
      assert.equal(out.ok, false);
      assert.equal(out.reason, example.error);
      assert.deepEqual(out.detail, example.detail);
    });
  }
});

test("an unrecognized-image detail cannot launder a combined truth failure", async () => {
  let calls = 0;
  const refusal = {
    status: 422,
    body: {
      ok: false,
      error: "brand_asset_rejected",
      detail: [
        { path: "/brand/logo", reason: "not_a_recognized_image" },
        { path: "/brand/logo_sha256", reason: "content_hash_mismatch" },
      ],
    },
  };
  assert.equal(isUnrecognizedLogoAssetFailure(refusal), false);

  const out = await buildMirrorForProspect(prospect(), {
    dryRun: true,
    designBrief: false,
    deps: deps(async () => {
      calls += 1;
      return refusal;
    }),
  });

  assert.equal(calls, 1, "mixed evidence must never trigger a logo-free retry");
  assert.equal(out.ok, false);
  assert.equal(out.reason, "brand_asset_rejected");
  assert.deepEqual(out.detail, refusal.body.detail);
});

test("the logo-ladder kill switch keeps unrecognized image bytes as a refusal", async () => {
  const envName = "GHOST_AGENCY_LOGO_LADDER_FALLBACK";
  const previous = process.env[envName];
  let calls = 0;
  try {
    process.env[envName] = "0";
    const out = await buildMirrorForProspect(prospect(), {
      dryRun: true,
      designBrief: false,
      deps: deps(async () => {
        calls += 1;
        return {
          status: 422,
          body: {
            ok: false,
            error: "brand_asset_rejected",
            detail: [{ path: "/brand/logo", reason: "not_a_recognized_image" }],
          },
        };
      }),
    });
    assert.equal(calls, 1);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "brand_asset_rejected");
  } finally {
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
  }
});

test("an explicitly foreign candidate still refuses before the engine", async () => {
  let calls = 0;
  const out = await buildMirrorForProspect(prospect(`${SITE}assets/blogger_logo.png`), {
    dryRun: true,
    designBrief: false,
    deps: deps(async () => {
      calls += 1;
      throw new Error("foreign mark reached engine");
    }),
  });

  assert.equal(calls, 0);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "logo_third_party_mark");
});

test("a dead-domain logo (private-address SSRF) falls to the wordmark ladder, not a hard refusal", async () => {
  const requests = [];
  const out = await buildMirrorForProspect(prospect(), {
    dryRun: true,
    designBrief: false,
    deps: deps(async (request) => {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        return {
          status: 422,
          body: {
            ok: false,
            error: "brand_asset_rejected",
            detail: [{ path: "/brand/logo", reason: "ssrf: anchor.example resolves to private address 192.168.1.10" }],
          },
        };
      }
      return success(request);
    }),
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(requests.length, 2, "the dead-domain logo is retried without the logo");
  assert.equal(requests[0].brand.logo, LOGO, "the owned candidate is tried once");
  assert.equal(requests[1].brand.logo, undefined);
  assert.equal(requests[1].brand.logo_sha256, undefined);
  assert.deepEqual(requests[1].brand.mark, {
    rung: "wordmark",
    value: { type: "wordmark", text: "Anchor Plumbing Co", color: "#0b5cab" },
    reason: "no usable image fell to wordmark",
  });
});

test("a non-resolving (NXDOMAIN) logo also falls to the wordmark ladder", async () => {
  let calls = 0;
  const out = await buildMirrorForProspect(prospect(), {
    dryRun: true,
    designBrief: false,
    deps: deps(async (request) => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 422,
          body: {
            ok: false,
            error: "brand_asset_rejected",
            detail: [{ path: "/brand/logo", reason: "ssrf: anchor.example does not resolve" }],
          },
        };
      }
      return success(request);
    }),
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(calls, 2);
});

test("only the two dead-domain SSRF signals qualify; other SSRF and truth failures stay hard", async (t) => {
  const hardCases = [
    { name: "forbidden host", reason: "ssrf: forbidden host anchor.local" },
    { name: "literal private address", reason: "ssrf: literal private address 192.168.1.10" },
    { name: "non-https URL", reason: "ssrf: non-https URL http://anchor.example/logo.png" },
    { name: "content hash mismatch", reason: "content_hash_mismatch", path: "/brand/logo_sha256" },
    { name: "foreign mark after redirect", reason: "third_party_mark_denylisted_after_redirect" },
  ];
  for (const example of hardCases) {
    await t.test(example.name, async () => {
      const refusal = {
        status: 422,
        body: {
          ok: false,
          error: "brand_asset_rejected",
          detail: [{ path: example.path || "/brand/logo", reason: example.reason }],
        },
      };
      assert.equal(isDeadDomainLogoFailure(refusal), false, "must not classify as dead-domain");
      let calls = 0;
      const out = await buildMirrorForProspect(prospect(), {
        dryRun: true,
        designBrief: false,
        deps: deps(async () => {
          calls += 1;
          return refusal;
        }),
      });
      assert.equal(calls, 1, "a non-dead-domain failure must never retry without the logo");
      assert.equal(out.ok, false);
      assert.equal(out.reason, "brand_asset_rejected");
    });
  }
});

test("a dead-domain detail cannot launder a combined truth failure", async () => {
  let calls = 0;
  const refusal = {
    status: 422,
    body: {
      ok: false,
      error: "brand_asset_rejected",
      detail: [
        { path: "/brand/logo", reason: "ssrf: anchor.example resolves to private address 192.168.1.10" },
        { path: "/brand/logo_sha256", reason: "content_hash_mismatch" },
      ],
    },
  };
  assert.equal(isDeadDomainLogoFailure(refusal), false);
  const out = await buildMirrorForProspect(prospect(), {
    dryRun: true,
    designBrief: false,
    deps: deps(async () => {
      calls += 1;
      return refusal;
    }),
  });
  assert.equal(calls, 1, "mixed evidence must never trigger a logo-free retry");
  assert.equal(out.ok, false);
  assert.equal(out.reason, "brand_asset_rejected");
});

test("the logo-ladder kill switch also keeps dead-domain logos as a refusal", async () => {
  const envName = "GHOST_AGENCY_LOGO_LADDER_FALLBACK";
  const previous = process.env[envName];
  let calls = 0;
  try {
    process.env[envName] = "0";
    const out = await buildMirrorForProspect(prospect(), {
      dryRun: true,
      designBrief: false,
      deps: deps(async () => {
        calls += 1;
        return {
          status: 422,
          body: {
            ok: false,
            error: "brand_asset_rejected",
            detail: [{ path: "/brand/logo", reason: "ssrf: anchor.example resolves to private address 192.168.1.10" }],
          },
        };
      }),
    });
    assert.equal(calls, 1);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "brand_asset_rejected");
  } finally {
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
  }
});
