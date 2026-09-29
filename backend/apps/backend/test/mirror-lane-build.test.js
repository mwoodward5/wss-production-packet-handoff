"use strict";

// test/mirror-lane-build.test.js — the missing link, locked.
//
// buildMirrorForProspect is the one call a "Mine N" pipeline stage makes to turn
// a raw mined record into a polished mirror-engine site. These tests inject every
// resolver so they run with no network, and assert the two properties that matter:
// the REQUEST it hands mirror() carries the client's own photos + verified content
// + a true-shape donor, and it REFUSES rather than trade-swaps or invents.

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMirrorForProspect, contentFromVerified, contentFromContract, slugFor } = require("../lib/mirror-lane-build");
const { signEvidence } = require("../lib/mirror-engine/evidence-signature");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/mirror-engine-contract");

// A raw mined record, exactly the shape lib/lead-miner emits.
const MINED = {
  prospect_id: "place-abc",
  business_name: "Wilbourn & McCabe Plumbing",
  industry: "plumbing",
  site: "https://wilbournmccabeplumbing.com/",
  email: "wmcplumbing@yahoo.com",
  logo: "https://wilbournmccabeplumbing.com/wp-content/uploads/logo.png",
  marketing_city: "Wichita Falls",
  marketing_city_state: "TX",
  place_id: "ChIJabc",
};

function leadMinerProspect() {
  const site = "https://fixture-plumbing.example/";
  const places = "https://places.googleapis.com/v1/places/ChIJMirrorControl";
  const proof = (source, source_kind = "website") => ({
    source,
    source_kind,
    captured_at: "2026-08-14T12:00:00.000Z",
  });
  return {
    prospect_id: "place-mirror-control",
    truth_packet: {
      meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
      mirror_ready: {
        business_name: "Mirror Control Plumbing",
        place_id: "ChIJMirrorControl",
        industry: "plumber",
        city: "Tulsa",
        state: "OK",
        logo_url: `${site}logo.svg`,
        logo_source_url: site,
        photos: [{ url: `${site}truck.jpg`, source: "own_site" }],
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
          "/logo_url": proof(site),
          "/logo_source_url": proof(site),
          "/photos/0/url": proof(site),
          "/photos/0/source": proof(site),
          "/services/0/name": proof(`${site}services`),
          "/services/1/name": proof(`${site}services`),
          "/services/2/name": proof(`${site}services`),
        },
      },
    },
  };
}

// Deps that never touch the network. mirror() is a spy: it records the request.
function deps({ donorOk = true, phone = "(940) 761-2800", photos = 8, socials = null } = {}) {
  const captured = {};
  return {
    captured,
    // Social discovery touches the wire (their homepage + one search), so it is
    // injected here like every other resolver — that is what "these tests run
    // with no network" means. The default is deliberately EMPTY: a mirror with
    // no owned profiles is the ordinary case and must still build.
    resolveSocials: async () => (socials ? { socials, source: "stub" } : { socials: [], source: "not_attempted" }),
    resolveBuildableDonor: () => (donorOk ? { ok: true, donor: "plumbing-premier", vertical: "plumbing" } : { ok: false, reason: "vertical_retired_for_outreach" }),
    resolveVerifiedFacts: async () => ({
      ok: true,
      facts: {
        business_name: "Wilbourn & McCabe Plumbing", city: "Wichita Falls", state: "TX",
        ...(phone ? { phone } : {}), current_website: "https://wilbournmccabeplumbing.com/",
        rating: 4.4, review_count: 60,
      },
      content: {
        // Three, not two, since 2026-08-11: serviceFloorReport holds a build
        // whose services section has fewer than three real services. Nothing
        // this test is about changed — see bare-template-and-the-place-pin for
        // the floor's own coverage.
        services: ["Drain cleaning", "Water heater repair", "Hydro jetting"],
        reviews: [{ text: "Great crew, fair price.", author: "Jimmy B." }],
        hours: ["Mon 8-5", "Tue 8-5"],
      },
      coverage: {},
    }),
    harvestClientPhotos: async () => ({
      ok: true,
      photos: Array.from({ length: photos }, (_, i) => ({ url: `https://wilbournmccabeplumbing.com/p${i}.jpg`, sha256: "s" + i, ext: "jpg", bytes: 50000 })),
    }),
    // The durable fleet reader is a store call too. A valid empty fleet is the
    // deterministic no-network baseline; failure cases override it below.
    readFleetIdentities: async () => ({ ok: true, identities: [] }),
    // `checks.content` echoes what the engine ALWAYS reports on a successful
    // build (engine.js sets it unconditionally, status "none" when nothing was
    // injected). An empty `checks` was not a simpler stub, it was an untrue
    // one — and contentFloorReport reads exactly this evidence.
    mirror: async (req, options) => {
      Object.assign(captured, { req, options });
      const sections = req.content && Object.keys(req.content).length ? 3 : 0;
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: `https://${req.slug}.wss-ai.com/`,
          checks: { content: { status: sections ? "injected" : "none", sections } },
        },
      };
    },
  };
}

function signedDeployedEvidence({
  slug = slugFor("Wilbourn & McCabe Plumbing", "Wichita Falls"),
  buildHash = "d".repeat(64),
  overrides = {},
} = {}) {
  const baseChecks = {
    content: { status: "injected", sections: 3 },
    sameness: {
      status: "passed",
      rendered_h1: "Wilbourn & McCabe Plumbing. Plumbing in Wichita Falls, TX.",
      served_title: "Wilbourn & McCabe Plumbing | Wichita Falls Plumbing",
    },
    alias_target: { status: "passed", deployment_id: "deployment-123" },
  };
  const body = {
    ok: true,
    revealable: true,
    preview_url: `https://${slug}.wss-ai.com/`,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: buildHash,
    deploy_id: "deployment-123",
    deploy_url: "https://deployment-123.vercel.app",
    ...overrides,
    checks: { ...baseChecks, ...(overrides.checks || {}) },
  };
  delete body.evidence_sha;
  body.evidence_sha = signEvidence(body);
  return body;
}

test("assembles the client's own photos, verified content and a true-shape donor", async () => {
  const d = deps();
  const out = await buildMirrorForProspect(MINED, { deps: d });
  assert.equal(out.ok, true);
  assert.equal(out.revealable, true);
  assert.equal(out.donor, "plumbing-premier");
  assert.equal(out.photoCount, 8);
  // faces/faqs/nearby joined the report on 2026-08-06: a build that ships
  // without reviewer faces or a single nearby town has to SAY so in its own
  // coverage line, or the next silent regression is invisible again.
  assert.deepEqual(out.contentCoverage, { services: 3, reviews: 1, faces: 0, hours: 2, faqs: 0, nearby: 0, socials: 0 });
  assert.equal(out.social_discovery.source, "not_attempted");

  const req = d.captured.req;
  assert.equal(req.donor, "plumbing-premier", "the resolved donor is what mirror() builds");
  assert.equal(req.brand.logo, MINED.logo, "the client's OWN logo, not a donor mark");
  assert.equal(req.brand.photos.length, 8, "the client's own photography rides in brand.photos");
  assert.equal(req.content.services.length, 3, "verified services are injected, not donor copy");
  assert.equal(req.content.reviews[0].author, "Jimmy B.");
  assert.equal(req.facts.phone, "(940) 761-2800", "a phone the cross-check found, even one their site never published");
});

test("both build paths forward the operation key, signal and deadline to the Mirror engine", async () => {
  const operationKey = "line:batch-7:row-2:mirror";
  const signal = new AbortController().signal;
  const deadlineAt = Date.now() + 60_000;

  const resolver = deps();
  const resolverPublisher = { publish: async () => ({ ok: false, reason: "not_called_by_spy" }) };
  resolver.sharedPublisher = resolverPublisher;
  resolver.mirrorEngineDeps = { preservedEngineSeam: "resolver" };
  resolver.readFleetIdentities = async () => ({ ok: true, identities: [] });
  await buildMirrorForProspect(MINED, { deps: resolver, operationKey, signal, deadlineAt });

  const packet = deps();
  const packetPublisher = { publish: async () => ({ ok: false, reason: "not_called_by_spy" }) };
  packet.sharedPublisher = packetPublisher;
  packet.mirrorEngineDeps = { preservedEngineSeam: "packet" };
  packet.readFleetIdentities = async () => ({ ok: true, identities: [] });
  packet.captureFonts = async () => ({ ok: false });
  packet.readIntakePacket = () => ({ ok: false });
  packet.mergeIntoContent = (content) => content;
  await buildMirrorForProspect(leadMinerProspect(), { deps: packet, operationKey, signal, deadlineAt });

  for (const [path, options] of [["resolver", resolver.captured.options], ["LeadMiner packet", packet.captured.options]]) {
    assert.equal(options.operationKey, operationKey, `${path} path keeps the stable operation key`);
    assert.equal(options.signal, signal, `${path} path keeps the caller's exact AbortSignal`);
    assert.equal(options.deadlineAt, deadlineAt, `${path} path keeps the absolute deadline`);
    assert.equal(typeof options.deps.fleetIdentities, "function", `${path} path keeps the durable fleet reader`);
  }
  assert.equal(resolver.captured.options.deps.sharedPublisher, resolverPublisher);
  assert.equal(resolver.captured.options.deps.preservedEngineSeam, "resolver");
  assert.equal(packet.captured.options.deps.sharedPublisher, packetPublisher);
  assert.equal(packet.captured.options.deps.preservedEngineSeam, "packet");
});

test("fleet read failures are retryable system holds before the engine or deploy can run", async (t) => {
  const failures = [
    ["throw", async () => { throw new Error("fleet store offline"); }, "fleet store offline"],
    ["not ok", async () => ({ ok: false, identities: [], reason: "fleet query unavailable" }), "fleet query unavailable"],
    ["missing result", async () => null, "fleet_read_malformed"],
    ["missing identities", async () => ({ ok: true }), "fleet_identities_missing"],
    ["identities are not an array", async () => ({ ok: true, identities: {} }), "fleet_identities_missing"],
    ["malformed identity", async () => ({ ok: true, identities: [null] }), "fleet_identity_malformed"],
    ["malformed identity fields", async () => ({ ok: true, identities: [{ slug: 7, h1: "Old", title: "Old" }] }), "fleet_identity_malformed"],
    ["incomplete identity", async () => ({ ok: true, identities: [{ slug: "wss-test-old", h1: "", title: "" }] }), "fleet_identity_incomplete"],
    ["legacy backfill lookup unavailable", async () => ({
      ok: true,
      identities: [],
      backfill: {
        attempted: 1, written: 0, reused: 0, previewed: 0, unresolved: 1, ambiguous: 0,
        reason: "prospect_lookup_unavailable",
      },
    }), "fleet_backfill_unavailable"],
  ];

  for (const [name, readFleetIdentities, expectedDetail] of failures) {
    await t.test(name, async () => {
      let engineRuns = 0;
      let fleetRecords = 0;
      const d = deps();
      d.readFleetIdentities = readFleetIdentities;
      d.recordFleetIdentity = async () => { fleetRecords += 1; };
      d.mirror = async () => {
        engineRuns += 1;
        throw new Error("engine/deploy must not run");
      };

      const out = await buildMirrorForProspect(MINED, { deps: d });

      assert.equal(engineRuns, 0, "the Mirror engine/deploy boundary stays untouched");
      assert.equal(fleetRecords, 0, "no published identity is recorded without a complete read");
      assert.equal(out.ok, false);
      assert.equal(out.status, 503);
      assert.equal(out.reason, "mirror_fleet_read_unavailable");
      assert.equal(out.retryable, true);
      assert.equal(out.disposition, "system_hold");
      assert.equal(out.lead_rejection, false);
      assert.deepEqual(out.system_hold, {
        schema: "wss.mirror.system_hold.v1",
        type: "system",
        code: "mirror_fleet_read_unavailable",
        retryable: true,
        scope: "mirror_build",
      });
      assert.equal(out.detail[0].reason, expectedDetail);
    });
  }
});

test("ordinary owner-only sandbox slugs keep raw sameness evidence without legacy enrichment", async (t) => {
  const existing = {
    slug: "wss-test-existing-plumber",
    h1: "Existing Plumbing. Plumbing in Wichita Falls, TX.",
    title: "Existing Plumbing | Plumbing in Wichita Falls, TX",
  };
  const incompleteBackfill = {
    attempted: 13,
    written: 0,
    reused: 0,
    previewed: 0,
    unresolved: 13,
    ambiguous: 0,
  };

  await t.test("Practice build proceeds with the complete raw headline and title inventory", async () => {
    let engineRuns = 0;
    let fleetReadOptions = null;
    const d = deps();
    d.readFleetIdentities = async (options) => {
      fleetReadOptions = options;
      return { ok: true, identities: [existing], backfill: incompleteBackfill };
    };
    d.mirror = async (_request, options) => {
      engineRuns += 1;
      assert.deepEqual(await options.deps.fleetIdentities(), [existing]);
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: "https://wss-test-anchor-plumbing-phoenix.wss-ai.com/",
          checks: { content: { status: "injected", sections: 3 } },
        },
      };
    };

    const out = await buildMirrorForProspect(MINED, { deps: d, lane: "sandbox" });

    assert.equal(engineRuns, 1);
    assert.equal(fleetReadOptions.writeBackfill, false);
    assert.equal(out.ok, true);
  });

  await t.test("a duplicate in that raw inventory still fails sameness", async () => {
    let fleetRecords = 0;
    const d = deps();
    d.readFleetIdentities = async () => ({
      ok: true,
      identities: [existing],
      backfill: incompleteBackfill,
    });
    d.recordFleetIdentity = async () => { fleetRecords += 1; };
    d.claimSamenessRetry = async () => ({ ok: false, claimed: false, reason: "not_claimed" });
    d.mirror = async (_request, options) => {
      assert.deepEqual(await options.deps.fleetIdentities(), [existing]);
      return {
        status: 409,
        body: {
          ok: false,
          revealable: false,
          error: "not_revealable",
          checks: {
            content: { status: "injected", sections: 3 },
            sameness: {
              status: "failed",
              problems: [`duplicate_h1_with_${existing.slug}:${existing.h1}`],
            },
          },
        },
      };
    };

    const out = await buildMirrorForProspect(MINED, {
      deps: d,
      lane: "sandbox",
      operationKey: "sandbox-raw-fleet-collision",
    });

    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_revealable");
    assert.equal(fleetRecords, 0);
  });

  await t.test("the live lane proceeds with raw identity protection when legacy records cannot enrich", async () => {
    let engineRuns = 0;
    const d = deps();
    d.readFleetIdentities = async () => ({
      ok: true,
      identities: [existing],
      backfill: incompleteBackfill,
    });
    d.mirror = async (_request, options) => {
      engineRuns += 1;
      assert.deepEqual(await options.deps.fleetIdentities(), [existing]);
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: "https://wss-test-anchor-plumbing-phoenix.wss-ai.com/",
          checks: { content: { status: "injected", sections: 3 } },
        },
      };
    };

    const out = await buildMirrorForProspect(MINED, { deps: d, lane: "live" });

    assert.equal(engineRuns, 1);
    assert.equal(out.ok, true);
  });
});

test("a complete fleet read preserves normal success and collision behavior", async (t) => {
  const existing = {
    slug: "wss-test-existing-plumber",
    h1: "Existing Plumbing. Plumbing in Wichita Falls, TX.",
    title: "Existing Plumbing | Plumbing in Wichita Falls, TX",
  };

  await t.test("success", async () => {
    let engineRuns = 0;
    const d = deps();
    d.readFleetIdentities = async () => ({ ok: true, identities: [existing] });
    d.mirror = async (request, options) => {
      engineRuns += 1;
      assert.deepEqual(await options.deps.fleetIdentities(), [existing]);
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: `https://${request.slug}.wss-ai.com/`,
          checks: { content: { status: "injected", sections: 3 } },
        },
      };
    };

    const out = await buildMirrorForProspect(MINED, { deps: d });
    assert.equal(engineRuns, 1);
    assert.equal(out.ok, true);
    assert.equal(out.revealable, true);
  });

  await t.test("collision", async () => {
    let engineRuns = 0;
    let fleetRecords = 0;
    const d = deps();
    d.readFleetIdentities = async () => ({ ok: true, identities: [existing] });
    d.recordFleetIdentity = async () => { fleetRecords += 1; };
    d.claimSamenessRetry = async () => ({ ok: false, claimed: false, reason: "not_claimed" });
    d.mirror = async (_request, options) => {
      engineRuns += 1;
      assert.deepEqual(await options.deps.fleetIdentities(), [existing]);
      return {
        status: 409,
        body: {
          ok: false,
          revealable: false,
          error: "not_revealable",
          checks: {
            content: { status: "injected", sections: 3 },
            sameness: {
              status: "failed",
              problems: [`duplicate_h1_with_${existing.slug}:${existing.h1}`],
            },
          },
        },
      };
    };

    const out = await buildMirrorForProspect(MINED, { deps: d, operationKey: "fleet-collision-1" });
    assert.equal(engineRuns, 1, "the existing one-retry claim boundary is unchanged");
    assert.equal(fleetRecords, 0, "a collision never becomes a fleet identity");
    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_revealable");
    assert.match(out.detail.problems[0], /^duplicate_h1_with_wss-test-existing-plumber:/);
  });
});

test("a deployed Mirror is held with exact reconciliation identity when the fleet write is unconfirmed", async (t) => {
  const proofIdentity = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: "22222222-2222-4222-8222-222222222222",
    build_hash: "d".repeat(64),
  };
  const outcomes = [
    ["not ok", async () => ({ ok: false, reason: "events_store_unavailable" }), "events_store_unavailable"],
    ["resolved without a write mode", async () => ({ ok: true }), "fleet_identity_write_unconfirmed"],
    ["dry-run receipt", async () => ({ ok: true, mode: "dry_run" }), "fleet_identity_write_mode_dry_run"],
    ["malformed", async () => null, "fleet_identity_write_malformed"],
    ["throw", async () => { throw new Error("fleet write timeout"); }, "fleet write timeout"],
  ];

  for (const [name, recordFleetIdentity, expectedDetail] of outcomes) {
    await t.test(name, async () => {
      const d = deps();
      d.recordFleetIdentity = recordFleetIdentity;
      const slug = slugFor("Wilbourn & McCabe Plumbing", "Wichita Falls");
      const deployedEvidence = signedDeployedEvidence({
        slug,
        buildHash: proofIdentity.build_hash,
        overrides: {
          deploy_id: proofIdentity.release_id,
          deploy_url: `https://${slug}.wss-ai.com`,
          shared_publish: true,
          proofIdentity,
          sharedReleaseEvidence: {
            evidence_schema: "shared-site-release-evidence-v1",
            ...proofIdentity,
            canonical_host: `${slug}.wss-ai.com`,
          },
          checks: {
            alias_target: { status: "passed", deployment_id: proofIdentity.release_id },
          },
        },
      });
      d.mirror = async () => ({ status: 200, body: deployedEvidence });

      const out = await buildMirrorForProspect(MINED, { deps: d });

      assert.equal(out.ok, false);
      assert.equal(out.revealable, false, "an unrecorded fleet identity is never sendable");
      assert.equal(out.status, 503);
      assert.equal(out.reason, "mirror_fleet_record_unavailable");
      assert.equal(out.retryable, true);
      assert.equal(out.disposition, "system_hold");
      assert.equal(out.lead_rejection, false);
      assert.equal(out.provider_attempted, true);
      assert.equal(out.manual_reconciliation_required, true);
      assert.ok(out.detail[0].reason.startsWith(expectedDetail), `detail should lead with ${expectedDetail}: ${out.detail[0].reason}`);
      if (name !== "malformed" && name !== "throw") {
        assert.match(out.detail[0].reason, / \| raw=/, "the store's raw answer rides on the hold");
      }
      assert.equal(out.system_hold.scope, "mirror_reconciliation");
      assert.equal(out.system_hold.manual_reconciliation_required, true);
      assert.equal(out.reconciliation.release.build_hash, proofIdentity.build_hash);
      assert.equal(out.reconciliation.release.preview_url, deployedEvidence.preview_url);
      assert.deepEqual(out.reconciliation.release.proof_identity, proofIdentity);
      assert.equal(
        out.reconciliation.fleet_identity.slug,
        slugFor("Wilbourn & McCabe Plumbing", "Wichita Falls"),
      );
      assert.equal(out.reconciliation.fleet_identity.prospect_id, MINED.prospect_id);
      assert.equal(out.release_evidence, deployedEvidence, "the exact signed deployment stays available for reconciliation");
      assert.equal(out.reconciliation.redeploy_allowed, false);
    });
  }
});

test("only a signed, publicly attached revealable release can enter the durable fleet", async (t) => {
  const cases = [
    ["alias failed", { checks: { alias_target: { status: "failed", reason: "alias_mismatch" } } }, "alias_target_unconfirmed"],
    ["not revealable", { revealable: false }, "release_not_revealable"],
    ["preview missing", { preview_url: "" }, "preview_identity_invalid"],
    ["deployment proof missing", { deploy_id: "" }, "release_deployment_identity_missing"],
  ];

  for (const [name, overrides, expectedDetail] of cases) {
    await t.test(name, async () => {
      let fleetWrites = 0;
      let engineRuns = 0;
      const d = deps();
      d.recordFleetIdentity = async () => {
        fleetWrites += 1;
        return { ok: true, mode: "live_write" };
      };
      const deployedEvidence = signedDeployedEvidence({ overrides });
      d.mirror = async () => {
        engineRuns += 1;
        return { status: 200, body: deployedEvidence };
      };

      const out = await buildMirrorForProspect(MINED, { deps: d });

      assert.equal(engineRuns, 1);
      assert.equal(fleetWrites, 0, "an unproven public release never becomes a fleet identity");
      assert.equal(out.ok, false);
      assert.equal(out.revealable, false);
      assert.equal(out.reason, "mirror_release_unconfirmed");
      assert.equal(out.status, 503);
      assert.equal(out.disposition, "system_hold");
      assert.equal(out.lead_rejection, false);
      assert.equal(out.provider_attempted, true);
      assert.equal(out.manual_reconciliation_required, true);
      // The cause leads with the publication problem and now names the exact
      // host plus the engine's alias_target status for re-verification.
      assert.equal(
        String(out.detail[0].reason).startsWith(expectedDetail),
        true,
        `expected cause to start with ${expectedDetail}, got ${out.detail[0].reason}`,
      );
      assert.match(String(out.detail[0].reason), / host=[^;]+;/);
      assert.match(String(out.detail[0].reason), /alias_target=[a-z_]+$/);
      assert.equal(out.system_hold.scope, "mirror_reconciliation");
      assert.equal(out.reconciliation.action, "verify_public_release");
      assert.equal(out.reconciliation.redeploy_allowed, false);
      assert.equal(out.release_evidence, deployedEvidence);
    });
  }
});

test("fleet preview validation uses the deploy slug policy for explicitly enabled real slugs", async () => {
  const envName = "MIRROR_ALLOW_REAL_SLUGS";
  const previous = process.env[envName];
  const realSlug = "wilbourn-mccabe-plumbing";
  const prospect = {
    ...MINED,
    record: { preview_url: `https://${realSlug}.wss-ai.com/` },
  };
  let fleetWrites = 0;
  const d = deps();
  d.recordFleetIdentity = async () => {
    fleetWrites += 1;
    return { ok: true, mode: "live_write" };
  };
  d.mirror = async (request) => ({
    status: 200,
    body: signedDeployedEvidence({ slug: request.slug }),
  });

  try {
    delete process.env[envName];
    const gated = await buildMirrorForProspect(prospect, { deps: d });
    assert.equal(fleetWrites, 0, "the default test namespace gate still refuses a real slug");
    assert.equal(gated.ok, false);
    assert.equal(gated.reason, "mirror_release_unconfirmed");
    assert.equal(
      String(gated.detail[0].reason).startsWith("preview_identity_invalid"),
      true,
      `unexpected cause: ${gated.detail[0].reason}`,
    );
    assert.equal(gated.reconciliation.redeploy_allowed, false);

    process.env[envName] = "1";
    const allowed = await buildMirrorForProspect(prospect, { deps: d });
    assert.equal(allowed.slug, realSlug);
    assert.equal(allowed.preview_url, `https://${realSlug}.wss-ai.com/`);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.revealable, true);
    assert.equal(fleetWrites, 1, "the exact canonical real-slug release earns one live fleet write");
  } finally {
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
  }
});

test("both build paths carry shared release identity out to proof and hero workers", async () => {
  const proofIdentity = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: "22222222-2222-4222-8222-222222222222",
    build_hash: "b".repeat(64),
  };
  const sharedReleaseEvidence = {
    evidence_schema: "shared-site-release-evidence-v1",
    ...proofIdentity,
    canonical_host: "wss-test-shared.wss-ai.com",
    hero_video_path: "media/hero-loop.mp4",
    hero_video_sha256: "c".repeat(64),
  };
  const wire = (d) => {
    d.mirror = async (req, options) => {
      Object.assign(d.captured, { req, options });
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: `https://${req.slug}.wss-ai.com/`,
          build_hash: proofIdentity.build_hash,
          proofIdentity,
          sharedReleaseEvidence,
          checks: { content: { status: "injected", sections: 3 } },
        },
      };
    };
    d.readFleetIdentities = async () => ({ ok: true, identities: [] });
    return d;
  };

  const resolver = wire(deps());
  const resolverOut = await buildMirrorForProspect(MINED, { deps: resolver });

  const packet = wire(deps());
  packet.captureFonts = async () => ({ ok: false });
  packet.readIntakePacket = () => ({ ok: false });
  packet.mergeIntoContent = (content) => content;
  const packetOut = await buildMirrorForProspect(leadMinerProspect(), { deps: packet });

  for (const out of [resolverOut, packetOut]) {
    assert.deepEqual(out.proofIdentity, proofIdentity);
    assert.deepEqual(out.sharedReleaseEvidence, sharedReleaseEvidence);
    assert.deepEqual(out.release_evidence.proofIdentity, proofIdentity);
  }
});

test("post-deploy abort or deadline becomes record-only reconciliation, never revealable success", async (t) => {
  async function run({ signal, deadlineAt, abortDuringBuild = false }) {
    let records = 0;
    let engineRuns = 0;
    const d = deps();
    d.readFleetIdentities = async () => ({ ok: true, identities: [] });
    d.recordFleetIdentity = async () => { records += 1; return { ok: true, mode: "live_write" }; };
    let deployedEvidence;
    d.mirror = async (request, options) => {
      engineRuns += 1;
      if (abortDuringBuild) signal.abort(new Error("worker_deadline"));
      deployedEvidence = signedDeployedEvidence({
        slug: request.slug,
        overrides: {
          checks: {
            sameness: { status: "passed", rendered_h1: "Unique plumbing", served_title: "Unique plumbing" },
          },
        },
      });
      return { status: 200, body: deployedEvidence };
    };
    const out = await buildMirrorForProspect(MINED, {
      deps: d,
      signal: signal.signal,
      deadlineAt,
      operationKey: "line:batch-7:row-2:mirror",
    });
    return { out, records, engineRuns, deployedEvidence };
  }

  await t.test("completed build still records the passed sameness identity", async () => {
    const controller = new AbortController();
    const result = await run({ signal: controller, deadlineAt: Date.now() + 60_000 });
    assert.equal(result.records, 1);
    assert.equal(result.engineRuns, 1);
    assert.equal(result.out.ok, true);
    assert.equal(result.out.revealable, true);
  });

  await t.test("abort raised while the engine is running", async () => {
    const controller = new AbortController();
    const result = await run({ signal: controller, deadlineAt: Date.now() + 60_000, abortDuringBuild: true });
    assert.equal(result.records, 0);
    assert.equal(result.engineRuns, 1, "the already-completed deployment is not run a second time");
    assert.equal(result.out.ok, false);
    assert.equal(result.out.revealable, false);
    assert.equal(result.out.disposition, "system_hold");
    assert.equal(result.out.provider_attempted, true);
    assert.equal(result.out.manual_reconciliation_required, true);
    assert.equal(result.out.system_hold.scope, "mirror_reconciliation");
    assert.equal(result.out.reconciliation.action, "record_fleet_identity");
    assert.equal(result.out.reconciliation.redeploy_allowed, false);
    assert.equal(result.out.detail[0].reason, "fleet_identity_write_aborted_after_deploy");
    assert.equal(result.out.release_evidence, result.deployedEvidence);
  });

  await t.test("absolute deadline already elapsed", async () => {
    const controller = new AbortController();
    const result = await run({ signal: controller, deadlineAt: Date.now() - 1_000 });
    assert.equal(result.records, 0);
    assert.equal(result.engineRuns, 1, "the already-completed deployment is not run a second time");
    assert.equal(result.out.ok, false);
    assert.equal(result.out.revealable, false);
    assert.equal(result.out.disposition, "system_hold");
    assert.equal(result.out.provider_attempted, true);
    assert.equal(result.out.manual_reconciliation_required, true);
    assert.equal(result.out.system_hold.scope, "mirror_reconciliation");
    assert.equal(result.out.reconciliation.action, "record_fleet_identity");
    assert.equal(result.out.reconciliation.redeploy_allowed, false);
    assert.equal(result.out.detail[0].reason, "fleet_identity_write_deadline_elapsed_after_deploy");
    assert.equal(result.out.release_evidence, result.deployedEvidence);
  });
});

test("REFUSES a vertical with no clean donor rather than trade-swap", async () => {
  const d = deps({ donorOk: false });
  const out = await buildMirrorForProspect(MINED, { deps: d });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "vertical_retired_for_outreach");
  assert.equal(d.captured.req, undefined, "mirror() is never called for a refused vertical");
});

test("no phone is a smaller site, never a fabricated number", async () => {
  const d = deps({ phone: null });
  const out = await buildMirrorForProspect(MINED, { deps: d });
  assert.equal(out.ok, true);
  assert.equal(d.captured.req.facts.phone, undefined, "absent phone stays absent — phone is optional");
});

test("a business with no name or no industry cannot build", async () => {
  assert.equal((await buildMirrorForProspect({ industry: "plumbing" }, { deps: deps() })).reason, "no_business_name");
  assert.equal((await buildMirrorForProspect({ business_name: "X" }, { deps: deps() })).reason, "no_industry");
});

test("a marketing city distinct from the postal city becomes a service_area, not the address", async () => {
  const d = deps();
  const out = await buildMirrorForProspect({ ...MINED, city: "Buda", query_city: "Austin", marketing_city: "Austin" }, { deps: {
    ...d,
    resolveVerifiedFacts: async () => ({ ok: true, facts: { business_name: "X", city: "Buda", state: "TX" }, content: {} }),
  } });
  assert.equal(out.ok, true);
  assert.equal(d.captured.req.facts.city, "Buda");
  assert.equal(d.captured.req.facts.service_area, "Austin");
});

test("the builder uses verified NAP when a stored market is administrative or disagrees with the mining city", async () => {
  const cases = [
    { market: "United States", query: "Houston", nap: "Houston", reason: "country_claim_is_not_a_city" },
    { market: "Texas", query: "Irving", nap: "Irving", reason: "statewide_claim_is_not_a_city" },
    { market: "Austin", query: "San Antonio", nap: "San Antonio", reason: "asserted_market_disagrees_with_mining_query" },
  ];
  for (const item of cases) {
    const d = deps();
    const out = await buildMirrorForProspect({
      ...MINED,
      city: item.nap,
      query_city: item.query,
      query_state: "TX",
      marketing_city: item.market,
    }, { deps: {
      ...d,
      resolveVerifiedFacts: async () => ({
        ok: true,
        facts: { business_name: "Market Truth Plumbing", city: item.nap, state: "TX" },
        content: {},
      }),
    } });
    assert.equal(out.ok, true, JSON.stringify(item));
    assert.equal(d.captured.req.facts.city, item.nap);
    assert.equal(d.captured.req.facts.service_area, undefined);
    assert.equal(out.marketing_city_refused.reason, item.reason);
    assert.equal(out.marketing_city_refused.used, item.nap);
  }
});

test("content shaper drops malformed entries and caps the arrays", () => {
  const c = contentFromVerified({
    services: ["A", { name: "B", description: "d" }, { description: "no name" }],
    reviews: [{ text: "t", author: "a" }, { text: "no author" }],
    hours: ["Mon"],
  });
  assert.equal(c.services.length, 2, "the nameless service is dropped");
  assert.equal(c.reviews.length, 1, "the authorless review is dropped");
  assert.equal(c.hours.length, 1);
});

test("public contact labels cannot enter Mirror services from verified or stored content", async () => {
  const labels = [
    "(505) 555-0123",
    "dispatch@example.com",
    "- [(505) 555-0123](tel:5055550123)",
    "- [505-555-0123](tel:5055550123)",
    "24/7 Emergency Plumbing",
    "5 Star Plumbing",
    "24000 BTU Installation",
  ];
  const publishable = labels.slice(4);
  const names = (content) => (content.services || []).map((service) => service.name);

  assert.deepEqual(names(contentFromVerified({ services: labels })), publishable,
    "verified contact details are dropped while legitimate numeric service names survive");

  const storedProspect = {
    ...MINED,
    record: {
      build_ready: {
        mirror_request: { content: { services: labels } },
      },
    },
  };
  assert.deepEqual(names(contentFromContract(storedProspect)), publishable,
    "stored contact details are dropped before the contract can override resolver services");

  const verified = deps();
  verified.resolveVerifiedFacts = async () => ({
    ok: true,
    facts: {
      business_name: MINED.business_name,
      city: MINED.marketing_city,
      state: MINED.marketing_city_state,
      phone: "(505) 555-0123",
      current_website: MINED.site,
      rating: 4.4,
      review_count: 60,
    },
    content: {
      services: labels,
      reviews: [{ text: "Great crew, fair price.", author: "Jimmy B." }],
      hours: ["Mon 8-5", "Tue 8-5"],
    },
    coverage: {},
  });
  assert.equal((await buildMirrorForProspect(MINED, { deps: verified })).ok, true);
  assert.deepEqual(names(verified.captured.req.content), publishable,
    "the verified resolver path gives Mirror only publishable authority-page service names");

  const stored = deps();
  assert.equal((await buildMirrorForProspect(storedProspect, { deps: stored })).ok, true);
  assert.deepEqual(names(stored.captured.req.content), publishable,
    "the stored contract overrides fresher nav content only after contact labels are removed");
});

test("a rebuild never moves a mirror — the record's established host wins over re-derivation", async () => {
  // Measured 2026-08-20: all three fleet rebuilds published to twin hosts
  // (fence-AND-patio vs the emailed fence-patio) because the slug was derived
  // fresh from the business name each build. The emailed link is frozen in
  // the prospect's inbox; the label must be too.
  const d = deps();
  const out = await buildMirrorForProspect({
    ...MINED,
    record: { preview_url: "https://wss-test-wilbourn-mccabe-plumbing-wichita.wss-ai.com/" },
  }, { deps: d });
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 200));
  assert.equal(d.captured.req.slug, "wss-test-wilbourn-mccabe-plumbing-wichita",
    "the host the first build published — and the email froze — is the host the rebuild refreshes");
});

test("slug is namespaced and url-safe", () => {
  assert.equal(slugFor("Wilbourn & McCabe Plumbing", "Wichita Falls"), "wss-test-wilbourn-and-mccabe-plumbing-wichita-falls");
});

test("owned social profiles ride onto the request, and the report names their provenance", async () => {
  const d = deps({
    socials: [
      { network: "facebook", url: "https://www.facebook.com/WilbournMcCabe", provenance: "own_site_link" },
      { network: "yelp", url: "https://www.yelp.com/biz/wilbourn-mccabe-plumbing", provenance: "named_match" },
    ],
  });
  const out = await buildMirrorForProspect(MINED, { deps: d });
  assert.equal(out.ok, true);
  assert.equal(out.contentCoverage.socials, 2);
  assert.deepEqual(out.social_discovery.attached, ["facebook:own_site_link", "yelp:named_match"]);
  assert.deepEqual(d.captured.req.facts.socials.map((s) => s.network), ["facebook", "yelp"]);
});

test("no owned profiles is not a refusal — the mirror builds and ships without a social bar", async () => {
  const d = deps({ socials: [] });
  const out = await buildMirrorForProspect(MINED, { deps: d });
  assert.equal(out.ok, true);
  assert.equal(out.revealable, true, "a missing signal is an absent section, never a blocked build");
  assert.equal(out.contentCoverage.socials, 0);
  assert.equal("socials" in d.captured.req.facts, false, "absent, not an empty array");
});

// --- THE LABEL IS A HINT; THE SERVICES ARE THE EVIDENCE --------------------
//
// M & M Heating & Cooling, LLC carries record.industry === "plumbing" while
// every one of its ten services is an air conditioner, a furnace, a boiler or a
// mini-split. leadMinerMirrorInput has inferred the trade from services since
// that was first found; the RESOLVER branch — taken by every rebuild — did not,
// and on 2026-08-11 a rebuild published them live as
// "M & M Heating & Cooling, LLC — Plumbing in Stratford, CT" on the plumbing
// donor. These lock the two lanes to the same answer.

const MISLABELLED_HVAC = {
  prospect_id: "place-mm",
  business_name: "M & M Heating & Cooling, LLC",
  industry: "plumbing",                       // what the record actually says
  site: "https://mmheatingandcooling.com/",
  logo: "https://mmheatingandcooling.com/logo.png",
  marketing_city: "Stratford",
  marketing_city_state: "CT",
  place_id: "ChIJmm",
  primary_services: [
    { name: "AC Maintenance/Repair Services" },
    { name: "Air Conditioner Installation" },
    { name: "Furnace Installation and Repair" },
    { name: "Boiler Installation and Repair" },
    { name: "Preventative HVAC Maintenance" },
  ],
};

test("a mislabelled record builds the trade its SERVICES prove, not the label", async () => {
  const d = deps();
  let askedFor = "";
  d.resolveBuildableDonor = (vertical) => {
    askedFor = vertical;
    return { ok: true, donor: "hvac-premier", vertical };
  };
  const out = await buildMirrorForProspect(MISLABELLED_HVAC, { deps: d });
  assert.equal(out.ok, true);
  assert.equal(askedFor, "hvac", 'the donor is resolved for "hvac" even though the record says "plumbing"');
  assert.equal(out.donor, "hvac-premier");
});

test("a two-trade business builds on its LEAD trade's donor — refusal retired 2026-08-20", async () => {
  // The old doctrine refused these outright ("a single-trade mirror would
  // misrepresent them"). Its premise is gone: authority pages render a page
  // for EVERY verified service regardless of trade, and the render gate
  // exempts the client's own name/services/reviews, so the secondary trade is
  // told in the client's own words. Name + three plumbing services outweigh
  // three HVAC services, so the plumbing donor is the shell.
  const d = deps();
  let askedFor = "";
  d.resolveBuildableDonor = (vertical) => { askedFor = vertical; return { ok: true, donor: "plumbing-premier", vertical }; };
  const out = await buildMirrorForProspect({
    ...MISLABELLED_HVAC,
    business_name: "Complete Plumbing, Electric & Air",
    primary_services: [
      { name: "Drain cleaning" }, { name: "Water heater repair" }, { name: "Sewer line replacement" },
      { name: "AC repair" }, { name: "Furnace installation" }, { name: "Heat pump service" },
    ],
  }, { deps: d });
  assert.equal(out.ok, true, `two-trade admission failed: ${JSON.stringify(out).slice(0, 300)}`);
  assert.equal(askedFor, "plumbing", "the LEAD trade (name counts double) picks the donor shell");
  assert.ok(d.captured.req, "mirror() IS called — the client's full service list rides along");
});

test("with no service evidence the label still decides — this is not a new gate", async () => {
  const d = deps();
  let askedFor = "";
  d.resolveBuildableDonor = (vertical) => { askedFor = vertical; return { ok: true, donor: "plumbing-premier", vertical }; };
  const out = await buildMirrorForProspect({ ...MINED, business_name: "Wilbourn & McCabe" }, { deps: d });
  assert.equal(out.ok, true);
  assert.equal(askedFor, "plumbing", "a silent record falls back to the label, exactly as before");
});

// ---------------------------------------------------------------------------
// THE CONTENT FLOOR'S OWN SENTENCE — pinned 2026-08-31, the day two Omaha
// plumbers died as a bare `content_floor=failed`.
//
// American Rooter Plumbing and Micro Plumbing Inc. were fresh-mined (zero
// Google — reviews and hours structurally empty), CERTIFIED by the Intake
// Genie compile at pick, and killed by the content floor after full 240s
// builds. The operator's row said only `content_floor=failed`: the verdict,
// the per-channel counts, and the dispatch-time Genie receipt outcome were
// all computed and then dropped before the row. These tests pin the
// self-describing sentence so the next occurrence is diagnosable from the
// row alone.
//
// THE BAR ITSELF IS UNCHANGED. The diagnostic can never turn a failed floor
// into a pass, and an unverified receipt still contributes nothing — the
// signature is the anti-fabrication guarantee, and the owner's rule stands:
// never build from nothing, never trust an unsigned "something".
// ---------------------------------------------------------------------------

const {
  contentFloorReport: floorReport,
  contentFloorDiagnostics,
} = require("../lib/mirror-lane-build");
const { failingGateSummary } = require("../lib/full-run");

const FLOOR_INJECTED = { checks: { content: { status: "injected", sections: 4 } } };

test("a failed floor names WHICH channels were empty and WHY the compile was not merged", () => {
  // The exact shape of the two deaths: no floor channel in request.content,
  // photos present, phone present, and a stored canonical packet whose receipt
  // failed dispatch-time re-verification for a strict identity check.
  const out = floorReport({}, FLOOR_INJECTED, {
    photos: 3,
    nap: "phone",
    certified_compile: { status: "unverified", reason: "receipt_city_mismatch" },
  });
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "no_verified_content");
  assert.match(out.diagnostic, /services:0,reviews:0,hours:0,faqs:0,areas:0,about:0/);
  assert.match(out.diagnostic, /photos:3/);
  assert.match(out.diagnostic, /nap:phone/);
  assert.match(out.diagnostic, /compiled:unverified\(receipt_city_mismatch\)/);
  assert.deepEqual(out.certified_compile, { status: "unverified", reason: "receipt_city_mismatch" });
});

test("a PASSED floor still carries the sentence, with the verified compile's channels", () => {
  const out = floorReport({ services: [{ name: "Drain cleaning" }] }, FLOOR_INJECTED, {
    photos: 2,
    nap: "phone+address",
    certified_compile: { status: "verified", services: 4, about: true, faqs: 5 },
  });
  assert.equal(out.status, "passed");
  assert.match(out.diagnostic, /services:1/);
  assert.match(out.diagnostic, /compiled:verified\(services:4,about:yes,faqs:5\)/);
});

test("contentFloorDiagnostics distinguishes no-packet, unverified, and verified receipts", () => {
  // No stored canonical packet: the compile never ran for this row.
  const none = contentFloorDiagnostics({ facts: { phone: "5035550100" }, record: {} });
  assert.equal(none.certified_compile, undefined, "no compiled part when no packet exists");
  assert.equal(none.nap, "phone");
  assert.equal(none.needs_fill, undefined);

  // A packet exists but its receipt failed re-verification at dispatch: the
  // reason MUST surface — this is the fact that was silently dropped on
  // 2026-08-31.
  const unverified = contentFloorDiagnostics({
    facts: {},
    record: { genie_canonical_packet: { version: "intake-genie-v2" } },
    certifiedGenieContent: { ok: false, reason: "receipt_expired" },
  });
  assert.deepEqual(unverified.certified_compile, { status: "unverified", reason: "receipt_expired" });

  // A verified receipt: the compiled channels are counted so a green row can
  // be audited for near-misses with the same one read.
  const verified = contentFloorDiagnostics({
    facts: { phone: "5035550100", address: "123 Main St" },
    photos: 7,
    needsFill: false,
    record: { genie_canonical_packet: { version: "intake-genie-v2" } },
    certifiedGenieContent: {
      ok: true,
      services: [{ name: "Drain cleaning" }],
      canonical_packet: { about: "Two paragraphs.", faqs: [{ q: "q", a: "a" }] },
    },
  });
  assert.deepEqual(verified.certified_compile, { status: "verified", services: 1, about: true, faqs: 1 });
  assert.equal(verified.photos, 7);
  assert.equal(verified.nap, "phone+address");

  // needs_fill rides along when set — the evidence-only path is the other way
  // compiled substance is legitimately absent from request.content.
  const fill = contentFloorDiagnostics({ facts: {}, needsFill: true, record: {} });
  assert.equal(fill.needs_fill, true);
});

test("failingGateSummary prints the floor's sentence in the operator's detail bracket", () => {
  const summary = failingGateSummary({
    sameness: { status: "passed" },
    content_floor: {
      status: "failed",
      diagnostic: "services:0,reviews:0,hours:0,faqs:0,areas:0,about:0 | compiled:unverified(receipt_city_mismatch)",
    },
    // by-design measurements stay filtered out, exactly as before
    content: { status: "injected" },
    optimization_108: { status: "scored" },
  });
  assert.deepEqual(summary, [
    "content_floor=failed(services:0,reviews:0,hours:0,faqs:0,areas:0,about:0 | compiled:unverified(receipt_city_mismatch))",
  ]);
  // A check with no diagnostic keeps the exact historical string.
  assert.deepEqual(failingGateSummary({ sameness: { status: "failed", problems: ["x"] } }), ["sameness=failed"]);
});

test("reconciliation detail serializes thrown objects instead of [object Object]", () => {
  const { fleetRecordSystemHold } = require("../lib/mirror-lane-build");
  const hold = fleetRecordSystemHold({ code: "release_verify_failed", host: "h.example" }, { body: {} });
  const encoded = JSON.stringify(hold);
  assert.equal(encoded.includes("[object Object]"), false, "object details must not collapse");
  assert.match(encoded, /release_verify_failed/, "the object's evidence must survive");
  assert.match(encoded, /h\.example/);
});

test("pride lists can never exceed the schema caps — belt and suspenders, never a 400", () => {
  // The caps were RAISED 6/6/4/4 -> 24/24/12/12 (owner directive: "If they
  // have more content than we can handle, we still dump it in"), and the
  // truncation safety net from PR #543 now runs UNCONDITIONALLY at the higher
  // caps. This drives the real producer path — an extraction with far more
  // pride than any cap — and pins the observable contract: what leaves the
  // lane is at/below cap and validates against the mirror-request schema
  // (production root cause: Roof It Right, invalid_request
  // /content/pride/sections/credentials killed a full 185s build).
  const { prideBlockFor, PRIDE_LIST_CAPS } = require("../lib/mirror-lane-build");
  const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

  // 1. THE PRODUCER CAPS AGREE WITH THE SCHEMA — parse the schema and compare,
  // so a future cap change in either place fails here instead of in production.
  const schema = require("../lib/mirror-engine/mirror-request.schema.json");
  const prideSections = schema.$defs.MirrorContent.properties.pride.properties.sections.properties;
  assert.equal(PRIDE_LIST_CAPS.credentials, prideSections.credentials.maxItems, "credentials: producer cap == schema maxItems");
  assert.equal(PRIDE_LIST_CAPS.differentiators, prideSections.differentiators.maxItems, "differentiators: producer cap == schema maxItems");
  assert.equal(PRIDE_LIST_CAPS.promotions, prideSections.promotions.maxItems, "promotions: producer cap == schema maxItems");
  assert.equal(PRIDE_LIST_CAPS.plans, prideSections.plans.maxItems, "plans: producer cap == schema maxItems");

  // 2. A HUGE EXTRACTION COMES OUT AT THE CAPS, NOT PAST THEM. owner-pride
  // reduces 30/30/14/14 to the caps and prideBlockFor truncates anything that
  // still slips through — neither layer may ever hand the engine an over-cap
  // request.
  const entry = (value) => ({
    status: "FOUND", confidence: "high", value,
    evidence: [{ source_url: "https://client.example/pride", quote: String(value) }],
  });
  const extraction = {
    B_credentials_and_trust: {
      certifications: Array.from({ length: 30 }, (_, i) => entry(`Master Certified Level ${i + 1}`)),
    },
    C_differentiators: Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`differentiator_${i + 1}`, entry(`Differentiator number ${i + 1} for the pride section`)]),
    ),
    E_productized_offers_and_pricing: {
      maintenance_plans: Array.from({ length: 14 }, (_, i) => ({
        status: "FOUND", confidence: "high",
        value: { name: `Service plan tier ${i + 1}`, price: `$${10 + i} per month` },
        evidence: [{ source_url: "https://client.example/plans", quote: "plan" }],
      })),
      promotions: Array.from({ length: 14 }, (_, i) => entry(`Seasonal promotion ${i + 1}`)),
    },
  };
  const out = prideBlockFor({ site: "https://client.example/", record: { owner_behind: extraction } });
  assert.ok(out && out.sections, "the extraction yields a pride block");
  assert.ok(out.sections.credentials.length <= PRIDE_LIST_CAPS.credentials, "credentials at/below cap");
  assert.ok(out.sections.differentiators.length <= PRIDE_LIST_CAPS.differentiators, "differentiators at/below cap");
  assert.ok(out.sections.promotions.length <= PRIDE_LIST_CAPS.promotions, "promotions at/below cap");
  assert.ok(out.sections.plans.length <= PRIDE_LIST_CAPS.plans, "plans at/below cap");
  // The rich content is KEPT up to the cap, not cut at the old 6/6/4/4.
  assert.equal(out.sections.credentials.length, PRIDE_LIST_CAPS.credentials, "all 24 credentials kept");
  assert.equal(out.sections.differentiators.length, PRIDE_LIST_CAPS.differentiators, "all 24 differentiators kept");
  assert.equal(out.sections.promotions.length, PRIDE_LIST_CAPS.promotions, "all 12 promotions kept");
  assert.equal(out.sections.plans.length, PRIDE_LIST_CAPS.plans, "all 12 plans kept");

  // 3. WHAT LEAVES THE LANE VALIDATES. The truncated block must clear the
  // mirror-request schema — the "truncation-at-cap can never 400" guarantee.
  const verdict = checkMirrorRequest({
    slug: "wss-test-pride-caps",
    donor: "hvac-premier",
    facts: { business_name: "Pride Caps Roofing", industry: "roofing", city: "Dallas", state: "TX" },
    content: { pride: out },
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.body || {}).slice(0, 600));
});
