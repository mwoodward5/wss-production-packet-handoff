"use strict";

// test/mirror-lane-dispatch.test.js — the dashboard's build stage, now able to
// reach the mirror engine.
//
// buildPreviewForProspect never called mirror() (grep-proven). dispatchMirrorLane
// is the seam that lets it, mapped into the same `dispatch` shape the rest of the
// pipeline consumes. These tests lock the properties that make the seam safe:
// it produces the right shape on success, refuses fail-closed without handing
// routing permission to another renderer, and preserves the compatibility flag.

const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatchMirrorLane, mirrorLaneEnabled } = require("../lib/full-run");

const PROSPECT = {
  prospect_id: "place-x", business_name: "Acme Concrete", industry: "concrete",
  city: "Denver", state: "CO", current_website: "https://acme-concrete.com/",
  email: "hi@acme-concrete.com", logo_url: "https://acme-concrete.com/logo.png",
};

test("a successful mirror build maps into the dispatch shape the pipeline consumes", async () => {
  const out = await dispatchMirrorLane(PROSPECT, {
    buildMirror: async () => ({
      ok: true, revealable: true,
      preview_url: "https://wss-test-acme-concrete-denver.wss-ai.com/",
      slug: "wss-test-acme-concrete-denver", donor: "concrete-elconstruction",
      vertical: "concrete", photoCount: 6, contentCoverage: { services: 4, reviews: 3, hours: 7 },
    }),
  });
  assert.equal(out.mode, "mirror_lane");
  assert.equal(out.pending, false);
  assert.equal(out.urls.preview_url, "https://wss-test-acme-concrete-denver.wss-ai.com/");
  assert.equal(out.buildStatus.ready, true, "a revealable mirror is a ready build");
  assert.equal(out.buildStatus.renderer, "mirror-engine@v1");
  assert.deepEqual(out.buildStatus.blocked, []);
  assert.equal(out.buildStatus.mirror.donor, "concrete-elconstruction");
  assert.equal(out.buildStatus.mirror.photos, 6, "the client's own photo count rides on the build status");
});

test("a refusal returns a blocked Mirror shape and never authorizes fallback", async () => {
  const refused = await dispatchMirrorLane(PROSPECT, {
    buildMirror: async () => ({ ok: false, reason: "vertical_retired_for_outreach" }),
  });
  assert.equal(refused.fail_closed, true);
  assert.equal(refused.buildStatus.renderer, "mirror-engine@v1");
  assert.deepEqual(refused.buildStatus.blocked, ["vertical_retired_for_outreach"]);

  const notRevealable = await dispatchMirrorLane(PROSPECT, {
    buildMirror: async () => ({ ok: true, revealable: false, preview_url: "https://x.wss-ai.com/" }),
  });
  assert.equal(notRevealable.fail_closed, true);
  assert.equal(notRevealable.buildStatus.ready, false, "a build that is not revealable is not shown as ready");

  const noUrl = await dispatchMirrorLane(PROSPECT, {
    buildMirror: async () => ({ ok: true, revealable: true, preview_url: "" }),
  });
  assert.equal(noUrl.fail_closed, true, "revealable but no https preview url fails closed");
});

test("a fleet outage remains a retryable system hold and is never logged as a lead refusal", async () => {
  let refusal = null;
  const out = await dispatchMirrorLane(PROSPECT, {
    onRefusal: (payload) => { refusal = payload; },
    buildMirror: async () => ({
      ok: false,
      reason: "mirror_fleet_read_unavailable",
      retryable: true,
      disposition: "system_hold",
      lead_rejection: false,
      system_hold: {
        schema: "wss.mirror.system_hold.v1",
        type: "system",
        code: "mirror_fleet_read_unavailable",
        retryable: true,
        scope: "mirror_build",
      },
    }),
  });

  assert.equal(refusal, null);
  assert.equal(out.mode, "mirror_lane_system_hold");
  assert.equal(out.pending, true);
  assert.equal(out.retryable, true);
  assert.equal(out.disposition, "system_hold");
  assert.equal(out.lead_rejection, false);
  assert.equal(out.buildStatus.pending, true);
});

test("post-deploy reconciliation stays owner-only pending with exact release and no redeploy permission", async () => {
  let refusal = null;
  const releaseEvidence = {
    evidence_schema: "mirror-engine-release-evidence-v1",
    build_hash: "d".repeat(64),
    evidence_sha: "e".repeat(64),
    preview_url: "https://wss-test-acme-concrete-denver.wss-ai.com/",
    deploy_id: "deployment-123",
  };
  const reconciliation = {
    schema: "wss.mirror.fleet_reconciliation.v1",
    action: "record_fleet_identity",
    redeploy_allowed: false,
    release: {
      build_hash: releaseEvidence.build_hash,
      preview_url: releaseEvidence.preview_url,
      deploy_id: releaseEvidence.deploy_id,
      evidence_sha: releaseEvidence.evidence_sha,
    },
    fleet_identity: { slug: "wss-test-acme-concrete-denver", prospect_id: "place-x" },
  };
  const systemHold = {
    schema: "wss.mirror.system_hold.v1",
    type: "system",
    code: "mirror_fleet_record_unavailable",
    retryable: true,
    scope: "mirror_reconciliation",
    manual_reconciliation_required: true,
    reconciliation,
  };
  const out = await dispatchMirrorLane(PROSPECT, {
    onRefusal: (payload) => { refusal = payload; },
    buildMirror: async () => ({
      ok: false,
      revealable: false,
      reason: "mirror_fleet_record_unavailable",
      retryable: true,
      disposition: "system_hold",
      lead_rejection: false,
      provider_attempted: true,
      manual_reconciliation_required: true,
      system_hold: systemHold,
      reconciliation,
      release_evidence: releaseEvidence,
    }),
  });

  assert.equal(refusal, null);
  assert.equal(out.mode, "mirror_lane_system_hold");
  assert.equal(out.pending, true);
  assert.equal(out.fail_closed, true);
  assert.equal(out.buildStatus.ready, false);
  assert.deepEqual(out.urls, {});
  assert.equal(out.provider_attempted, true);
  assert.equal(out.manual_reconciliation_required, true);
  assert.equal(out.reconciliation, reconciliation);
  assert.equal(out.reconciliation.redeploy_allowed, false);
  assert.equal(out.release_evidence, releaseEvidence);
});

test("operation key and cancellation budget reach the Mirror builder unchanged", async () => {
  const signal = new AbortController().signal;
  let seen;
  await dispatchMirrorLane(PROSPECT, {
    operationKey: "line:batch-7:row-2:mirror",
    signal,
    deadlineAt: 12_345,
    buildMirror: async (_prospect, options) => {
      seen = options;
      return { ok: false, reason: "test_refusal" };
    },
  });
  assert.equal(seen.operationKey, "line:batch-7:row-2:mirror");
  assert.equal(seen.signal, signal);
  assert.equal(seen.deadlineAt, 12_345);
});

test("the enable flag is fail-closed", () => {
  assert.equal(mirrorLaneEnabled({}), false, "unset => off, so existing behaviour is unchanged");
  assert.equal(mirrorLaneEnabled({ GHOST_MIRROR_LANE: "" }), false);
  assert.equal(mirrorLaneEnabled({ GHOST_MIRROR_LANE: "no" }), false);
  assert.equal(mirrorLaneEnabled({ GHOST_MIRROR_LANE: "maybe" }), false);
  assert.equal(mirrorLaneEnabled({ GHOST_MIRROR_LANE: "1" }), true);
  assert.equal(mirrorLaneEnabled({ GHOST_MIRROR_LANE: "true" }), true);
  assert.equal(mirrorLaneEnabled({ GHOST_MIRROR_LANE: "ON" }), true);
});

// ---------------------------------------------------------------------------
// THE REFUSAL BRACKET MUST NAME THE CAUSE, NOT THE MEASUREMENTS
// ---------------------------------------------------------------------------
// Tallied across 5,794 system.run events (2026-07-12 .. 2026-08-08): of 45
// `not_revealable` refusals, content=injected appeared on 42, optimization_108
// =scored on 45 and editable=archived on 41 — none of which can ever block,
// because none of them is in computeRevealable's required list. Every dead lead
// therefore wore a bracket of three findings that had nothing to do with why it
// died, and an operator had to know which names to ignore.

test("the refusal bracket omits render and route_render because they are polish checks", async () => {
  let refusal = null;
  await dispatchMirrorLane(PROSPECT, {
    onRefusal: (payload) => { refusal = payload; },
    buildMirror: async () => ({
      ok: true, revealable: false, preview_url: "https://x.wss-ai.com/",
      checks: {
        // never required, never "passed" — pure noise in a refusal
        content: { status: "injected" },
        optimization_108: { status: "scored" },
        editable: { status: "archived" },
        // polish findings: recorded in cause/polish_flags, never reveal blockers
        render: { status: "failed", problems: ["hero_video_not_playing (readyState=1 paused=true)"] },
        route_render: { status: "failed", problems: ['broken_prose:dangling_word:"with to…"'] },
        brand: { status: "passed" },
      },
    }),
  });
  assert.ok(refusal, "a real refusal must still be reported");
  assert.deepEqual(refusal.detail, []);
  for (const noise of ["content=", "optimization_108=", "editable=", "render=", "route_render="]) {
    assert.ok(!refusal.detail.join(",").includes(noise), `${noise} is not a blocker`);
  }
});

test("the brand check's refusal names the fields that hold its cause", async () => {
  // Just Air LLC's row read `brand: status=unbranded with no recorded cause`
  // while logo, accent and accent_origin were all in the same object.
  let refusal = null;
  await dispatchMirrorLane(PROSPECT, {
    onRefusal: (payload) => { refusal = payload; },
    buildMirror: async () => ({
      ok: true, revealable: false, preview_url: "https://x.wss-ai.com/",
      checks: {
        brand: { status: "unbranded", logo: "client", accent: "donor-default", accent_origin: "unmeasurable" },
      },
    }),
  });
  assert.match(refusal.cause.brand, /logo=client/);
  assert.match(refusal.cause.brand, /accent=donor-default/);
  assert.match(refusal.cause.brand, /accent_origin=unmeasurable/);
  assert.doesNotMatch(refusal.cause.brand, /no recorded cause/);
});

test("A DRY RUN IS NOT A REFUSAL", async () => {
  // computeRevealable requires `passed` on every named check, and a dry run
  // deliberately marks five of them "skipped_dry_run" — it makes zero Vercel
  // calls. Four businesses were written into the refusal tally for doing
  // exactly what was asked of them.
  let refusal = null;
  const out = await dispatchMirrorLane(PROSPECT, {
    dryRun: true,
    onRefusal: (payload) => { refusal = payload; },
    buildMirror: async () => ({
      ok: true, revealable: false, preview_url: "",
      checks: {
        hydration_parse: { status: "passed" }, token_scan: { status: "passed" },
        identity_scan: { status: "passed" }, brand: { status: "passed" }, routes: { status: "passed" },
        asset_diff: { status: "skipped_dry_run" }, deep_link: { status: "skipped_dry_run" },
        alias_target: { status: "skipped_dry_run" }, render: { status: "skipped_dry_run" },
        route_render: { status: "skipped_dry_run" },
      },
    }),
  });
  assert.equal(refusal, null, "a dry run must not be recorded as a refused build");
  assert.equal(out.mode, "mirror_lane_dry_run");
  assert.equal(out.dry_run, true);
  assert.equal(out.buildStatus.ready, false);
  assert.deepEqual(out.buildStatus.blocked, ["dry_run_makes_no_reveal"]);
});

test("a real refusal is still recorded when the run is not a dry run", async () => {
  // The guard above must not become a way to silence genuine failures.
  let refusal = null;
  await dispatchMirrorLane(PROSPECT, {
    dryRun: false,
    onRefusal: (payload) => { refusal = payload; },
    buildMirror: async () => ({
      ok: true, revealable: false, preview_url: "https://x.wss-ai.com/",
      checks: {
        render: { status: "failed", problems: ["chromium closed"] },
        brand: { status: "unbranded", logo: "wordmark-fallback", accent: "donor-default" },
      },
    }),
  });
  assert.ok(refusal);
  assert.equal(refusal.reason, "not_revealable");
  assert.deepEqual(refusal.detail, ["brand=unbranded"]);
});
