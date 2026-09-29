"use strict";

// test/line-runner.test.js — the operator line's batch registry.

const test = require("node:test");
const assert = require("node:assert/strict");

test("qualification durably starts the hero lane without waiting for generation", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const bank = { fresh: true, photos: [{ url: "https://client.example/crew.jpg", sha256: "a".repeat(64) }] };
  const calls = [];
  const row = {
    rowId: "qualified-hero-row-1",
    prospectId: "qualified-hero-1",
    businessName: "Qualified Hero Plumbing",
    status: "picked",
    history: [{ status: "picked", at: "2026-08-25T00:00:00.000Z" }],
    failedFacts: [],
    reason: "",
    ownedPhotoBank: bank,
  };
  const startHero = async (candidate, options) => {
      calls.push({ candidate, options });
      return {
        ok: true,
        rowPatch: {
          ownedPhotoBank: bank,
          heroRemaster: { required: true, ready: false, pending: true, jobId: "hrj_qualified_1", attemptId: "hero_attempt:1" },
        },
      };
    };
  const out = await processRowPhase(row, { batchId: "hero-batch", lane: "live" }, {
    qualify: async () => ({ ok: true }),
    startHero,
    now: () => "2026-08-25T00:01:00.000Z",
  });
  assert.equal(out.ok, true);
  assert.equal(out.row.status, "qualified");
  assert.equal(out.row.heroRemaster, undefined);
  assert.equal(out.row.heroStartCheckpoint.disposition, "qualified");
  assert.deepEqual(out.row.ownedPhotoBank, bank);
  assert.equal(calls.length, 0, "picked only persists qualified; it does not enqueue");

  const bound = await processRowPhase(out.row, { batchId: "hero-batch", lane: "live" }, {
    startHero,
    mirror: async () => { throw new Error("mirror_must_wait_for_bound_snapshot"); },
    now: () => "2026-08-25T00:01:30.000Z",
  });
  assert.equal(bound.phase, "hero_start_checkpoint");
  assert.equal(bound.row.heroRemaster.jobId, "hrj_qualified_1");
  assert.equal(bound.row.heroRemaster.pending, true);
  assert.equal(bound.row.heroStartCheckpoint.disposition, "job_bound");
  assert.equal(bound.row.heroStartCheckpointed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.batchId, "hero-batch");

  let mirrors = 0;
  const building = await processRowPhase(bound.row, { batchId: "hero-batch", lane: "live" }, {
    mirror: async () => {
      mirrors += 1;
      return { ok: true, previewUrl: "https://qualified-hero.wss-ai.com/", buildHash: "base-build" };
    },
    prepareHero: async () => ({
      pending: true,
      heroRemaster: { required: true, ready: false, pending: true, job_id: "hrj_qualified_1", hero_attempt_id: "hero_attempt:1" },
      rowPatch: { heroRemaster: bound.row.heroRemaster },
    }),
    now: () => "2026-08-25T00:02:00.000Z",
  });
  assert.equal(mirrors, 1, "the base mirror starts while Seedance is pending");
  assert.equal(building.row.status, "qualified", "the post-build join still holds before render");
  assert.equal(building.row.heroRemaster.pending, true);
});


test("the console's batch list survives a cold lambda", async () => {
  // Owner, 2026-08-07: "the stuff in the dashboard disappeared... I don't know
  // where all the sites went." putBatch() wrote every snapshot to the event
  // log, but listBatches() read only the per-instance Map — so a fresh lambda
  // showed an empty dashboard over a full history.
  const runner = require("../lib/line-runner");
  runner.resetBatches(); // the cold lambda
  const stored = [
    { payload: { batchId: "b_old", batch: { batchId: "b_old", startedAt: "2026-08-06T01:00:00Z", status: "settled", rows: [1, 2] } } },
    // newest snapshot of the SAME batch must win over its older one
    { payload: { batchId: "b_new", batch: { batchId: "b_new", startedAt: "2026-08-07T02:00:00Z", status: "sent", rows: [1] } } },
    { payload: { batchId: "b_new", batch: { batchId: "b_new", startedAt: "2026-08-07T02:00:00Z", status: "running", rows: [] } } },
  ];
  const list = await runner.listBatchesDurable({ selectRows: async () => ({ rows: stored }) });
  assert.equal(list.length, 2);
  assert.equal(list[0].batchId, "b_new");
  assert.equal(list[0].status, "sent", "the FIRST (newest) snapshot per id wins");
  assert.equal(list[1].batchId, "b_old");

  // and a store outage degrades to the old memory-only view, never a throw
  const empty = await runner.listBatchesDurable({ selectRows: async () => { throw new Error("store down"); } });
  assert.deepEqual(empty, []);
});

test("a passing automatic Line build exposes canonical proof_shots in the same gate tick", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const oldUrl = "https://client.example/";
  const newUrl = "https://client.wss-ai.com/";
  const shots = {
    build_hash: "build-proof-1",
    old_captured_url: oldUrl,
    old_shot_sha: "1".repeat(64),
    new_captured_url: newUrl,
    new_shot_sha: "2".repeat(64),
  };
  let queued = 0;
  const row = {
    prospectId: "proof-1",
    businessName: "Proof Plumbing",
    status: "mirrored",
    previewUrl: newUrl,
    currentWebsite: oldUrl,
    buildHash: "build-proof-1",
    history: [{ status: "picked", at: "2026-08-21T00:00:00.000Z" }, { status: "mirrored", at: "2026-08-21T00:01:00.000Z" }],
    failedFacts: [],
    reason: "",
  };

  const out = await processRowPhase(row, { batchId: "proof-batch" }, {
    sourceFacts: async () => ({}),
    gate: async () => ({
      pass: true,
      failed: [],
      checks: [],
      capture: { ok: true, shots, results: [] },
    }),
    queueEmail: async () => { queued += 1; return { ok: true }; },
    now: () => "2026-08-21T00:02:00.000Z",
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
  });

  assert.equal(out.ok, true);
  assert.equal(out.row.status, "gate_passed");
  assert.deepEqual(out.row.proof_shots, shots);
  assert.equal(queued, 0, "capture is durable before the later email-queue phase");
});

test("sandbox queues the owner proof email even when the prospect has no email", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  let queued = 0;
  const row = {
    prospectId: "sandbox-no-contact",
    businessName: "No Contact Plumbing",
    status: "gate_passed",
    previewUrl: "https://sandbox-no-contact.wss-ai.com/",
    currentWebsite: "https://no-contact.example/",
    hasEmail: false,
    contactReady: false,
    gate: { pass: true, failed: [], checks: [] },
    history: [{ status: "gate_passed", at: "2026-08-24T10:00:00.000Z" }],
    failedFacts: [],
    reason: "",
  };
  const out = await processRowPhase(row, { lane: "sandbox", batchId: "sandbox-no-contact-batch" }, {
    writePreviewUrl: async () => ({ ok: true, rowPatch: {} }),
    queueEmail: async () => { queued += 1; return { ok: true }; },
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    now: () => "2026-08-24T10:01:00.000Z",
  });
  assert.equal(out.ok, true);
  assert.equal(out.row.status, "queued");
  assert.equal(queued, 1);
});

test("a gate-passed row with verified hero identity queues without proof shots", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const buildHash = "verified-hero-build";
  let queuedRow = null;
  const row = {
    prospectId: "verified-hero-no-shots",
    businessName: "Verified Hero Plumbing",
    email: "owner@verified-hero.example",
    hasEmail: true,
    contactReady: true,
    status: "gate_passed",
    previewUrl: "https://verified-hero-no-shots.wss-ai.com/",
    currentWebsite: "https://verified-hero.example/",
    buildHash,
    heroRemaster: {
      required: false,
      fallback: true,
      ready: true,
      pending: false,
      hold: false,
      applied: false,
      status: "skipped",
      reason: "no_scannable_hero_source",
      buildHash,
    },
    gate: { pass: true, failed: [], checks: [] },
    history: [{ status: "gate_passed", at: "2026-08-26T01:00:00.000Z" }],
    failedFacts: [],
    reason: "",
  };

  const out = await processRowPhase(row, { lane: "live", batchId: "verified-hero-batch" }, {
    writePreviewUrl: async () => ({ ok: true, rowPatch: {} }),
    queueEmail: async (input) => { queuedRow = input; return { ok: true }; },
    env: { GHOST_AGENCY_HERO_AUTOLINE: "1" },
    now: () => "2026-08-26T01:01:00.000Z",
  });

  assert.equal(out.ok, true);
  assert.equal(out.row.status, "queued");
  assert.equal(Object.hasOwn(row, "proof_shots"), false);
  assert.equal(Object.hasOwn(queuedRow, "proof_shots"), false, "delivery owns proof resolution");
});

test("durable Line rows carry an exact shared release tuple from mirror through the gate", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const lineState = require("../lib/line-state");
  const identity = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: "22222222-2222-4222-8222-222222222222",
    build_hash: "a".repeat(64),
  };
  let row = lineState.newRow({ prospectId: "shared-durable", businessName: "Shared Durable" });
  row = lineState.advanceRow(row, "qualified").row;

  const mirrored = await processRowPhase(row, { batchId: "shared-durable-batch" }, {
    mirror: async () => ({
      ok: true,
      previewUrl: "https://shared-durable.wss-ai.com/",
      currentWebsite: "https://shared-durable.example/",
      buildHash: identity.build_hash,
      proofIdentity: identity,
    }),
  });
  assert.equal(mirrored.row.status, "mirrored");
  assert.deepEqual(mirrored.row.proofIdentity, identity);

  let gateBuild = null;
  const gated = await processRowPhase(mirrored.row, { batchId: "shared-durable-batch" }, {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    sourceFacts: async () => ({}),
    gate: async (input) => {
      gateBuild = input.build;
      return {
        pass: true,
        failed: [],
        checks: [],
        capture: {
          ok: true,
          shots: {
            ...identity,
            old_captured_url: "https://shared-durable.example/",
            old_shot_sha: "b".repeat(64),
            new_captured_url: "https://shared-durable.wss-ai.com/",
            new_shot_sha: "c".repeat(64),
          },
          results: [],
        },
      };
    },
  });
  assert.equal(gated.row.status, "gate_passed");
  assert.deepEqual(gateBuild.proofIdentity, identity);
  assert.deepEqual(gated.row.proof_shots.site_id, identity.site_id);
});

test("malformed shared mirror identity is terminal while legacy mirror rows stay unchanged", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const lineState = require("../lib/line-state");
  const buildHash = "a".repeat(64);
  for (const [proofIdentity, reason] of [
    [{ site_id: "11111111-1111-4111-8111-111111111111", build_hash: buildHash }, /^shared_proof_identity_incomplete:/],
    [{
      site_id: "11111111-1111-4111-8111-111111111111",
      release_id: "22222222-2222-4222-8222-222222222222",
      build_hash: "b".repeat(64),
    }, /^shared_proof_build_hash_mismatch$/],
  ]) {
    let row = lineState.newRow({ prospectId: `shared-refused-${reason}` });
    row = lineState.advanceRow(row, "qualified").row;
    const out = await processRowPhase(row, {}, {
      mirror: async () => ({
        ok: true,
        previewUrl: "https://shared-refused.wss-ai.com/",
        buildHash,
        proofIdentity,
      }),
    });
    assert.equal(out.row.status, "rejected");
    assert.match(String(out.row.reason || ""), reason);
    assert.equal(out.policyHold, true);
  }

  let legacy = lineState.newRow({ prospectId: "legacy-no-shared-tuple" });
  legacy = lineState.advanceRow(legacy, "qualified").row;
  const out = await processRowPhase(legacy, {}, {
    mirror: async () => ({ ok: true, previewUrl: "https://legacy.wss-ai.com/", buildHash: "legacy-build" }),
  });
  assert.equal(out.row.status, "mirrored");
  assert.equal(Object.hasOwn(out.row, "proofIdentity"), false);
});

test("a resumed mirrored row revalidates its durable shared tuple before source or gate work", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const lineState = require("../lib/line-state");
  const buildHash = "a".repeat(64);
  let sourceCalls = 0;
  let gateCalls = 0;

  let row = lineState.newRow({ prospectId: "shared-resume-tampered" });
  row = lineState.advanceRow(row, "qualified").row;
  row = lineState.advanceRow(row, "mirrored", {
    previewUrl: "https://shared-resume-tampered.wss-ai.com/",
  }).row;
  row = {
    ...row,
    buildHash,
    proofIdentity: {
      site_id: "11111111-1111-4111-8111-111111111111",
      build_hash: buildHash,
    },
  };

  const out = await processRowPhase(row, {}, {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    sourceFacts: async () => { sourceCalls += 1; return {}; },
    gate: async () => { gateCalls += 1; return { pass: true, failed: [], checks: [] }; },
  });

  assert.equal(out.row.status, "rejected");
  assert.match(String(out.row.reason || ""), /^shared_proof_identity_incomplete:/);
  assert.equal(out.phase, "gate");
  assert.equal(out.policyHold, true);
  assert.equal(sourceCalls, 0);
  assert.equal(gateCalls, 0);
});

test("an identity-mismatched source capture records no proof_shots and preserves visual refusal", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const { proofReadiness } = require("../lib/outreach-email-v2");
  const oldUrl = "https://client.example/";
  const newUrl = "https://client.wss-ai.com/";
  const row = {
    prospectId: "proof-mismatch",
    status: "mirrored",
    previewUrl: newUrl,
    currentWebsite: oldUrl,
    buildHash: "build-proof-mismatch",
    email: "owner@client.example",
    hasEmail: true,
    contactReady: true,
    history: [{ status: "mirrored", at: "2026-08-21T00:01:00.000Z" }],
    failedFacts: [],
    reason: "",
  };
  const out = await processRowPhase(row, { batchId: "proof-batch" }, {
    sourceFacts: async () => ({}),
    gate: async () => ({
      pass: true,
      failed: [],
      checks: [],
      capture: {
        ok: true,
        shots: {
          build_hash: row.buildHash,
          new_captured_url: newUrl,
          new_shot_sha: "2".repeat(64),
          before_refused: "capture_identity_capture_domain_mismatch",
        },
        results: [{ variant: "old", ok: false, reason: "capture_identity_capture_domain_mismatch" }],
      },
    }),
    now: () => "2026-08-21T00:02:00.000Z",
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
  });

  assert.equal(out.ok, true);
  assert.equal(Object.hasOwn(out.row, "proof_shots"), false, "the durable gate checkpoint records no partial proof contract");
  assert.equal(Object.hasOwn(out.row, "captured"), false, "legacy fallback cannot smuggle the partial record to email");

  let writtenRow = null;
  let queued = 0;
  const next = await processRowPhase(out.row, { batchId: "proof-batch" }, {
    writePreviewUrl: async (input) => { writtenRow = input; return { ok: true }; },
    queueEmail: async () => { queued += 1; return { ok: true }; },
    now: () => "2026-08-21T00:03:00.000Z",
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
  });
  assert.equal(next.ok, true);
  assert.equal(Object.hasOwn(writtenRow, "proof_shots"), false, "the build-completion CAS receives nothing from a mismatched capture");
  assert.equal(queued, 1, "the queue may stage the row, but the visual gate still owns send refusal");

  const visual = proofReadiness({
    cta: {
      previewUrl: newUrl,
      currentUrl: oldUrl,
      beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=old&s=x&v=old",
      afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=new&s=x&v=new",
      beforeImageSource: "",
    },
  });
  assert.equal(visual.ok, false);
  assert.equal(visual.reason, "before_image_capture_source_unrecorded");
});

function gatePassedRow(prospectId) {
  const lineState = require("../lib/line-state");
  let row = lineState.newRow({ prospectId, businessName: "Policy Test", now: "2026-08-21T01:00:00.000Z" });
  row = lineState.advanceRow(row, "qualified", { now: "2026-08-21T01:01:00.000Z" }).row;
  row = lineState.advanceRow(row, "mirrored", {
    previewUrl: `https://${prospectId}.wss-ai.com/`,
    now: "2026-08-21T01:02:00.000Z",
  }).row;
  return lineState.applyGate(row, { pass: true, failed: [], checks: [] }, {
    now: "2026-08-21T01:03:00.000Z",
  }).row;
}

test("preview write policy and evidence refusals are terminal, while store conflicts retry", async (t) => {
  const { processRowPhase } = require("../lib/line-runner");

  for (const refusal of [
    {
      name: "protected vertical hold",
      result: {
        ok: false,
        reason: "vertical_mismatch_sport_fencing",
        code: "line_preview_write_policy_hold",
        retryable: false,
        policyHold: true,
        terminal: "rejected",
      },
    },
    {
      name: "identity-mismatched Mirror evidence",
      result: {
        ok: false,
        reason: "mirror_engine_evidence_identity_mismatch",
        code: "line_preview_write_evidence_refused",
        retryable: false,
        terminal: "rejected",
      },
    },
    {
      name: "invalid signed Mirror evidence",
      result: {
        ok: false,
        reason: "mirror_engine_release_evidence_invalid",
        code: "line_preview_write_evidence_refused",
        retryable: false,
        terminal: "rejected",
      },
    },
  ]) {
    await t.test(refusal.name, async () => {
      let queued = 0;
      const out = await processRowPhase(gatePassedRow(`terminal-${queued}-${refusal.name.replace(/\W+/g, "-")}`), {}, {
        writePreviewUrl: async () => refusal.result,
        queueEmail: async () => { queued += 1; return { ok: true }; },
        now: () => "2026-08-21T01:04:00.000Z",
        env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
      });

      assert.equal(out.ok, true, JSON.stringify(out));
      assert.equal(out.complete, true);
      assert.equal(out.phase, "preview_write");
      assert.equal(out.retryable, false);
      assert.equal(out.row.status, "rejected");
      assert.equal(out.row.reason, refusal.result.reason);
      assert.equal(queued, 0);
      if (refusal.result.policyHold) assert.equal(out.policyHold, true);
    });
  }

  await t.test("transient write conflict", async () => {
    const row = gatePassedRow("transient-write-conflict");
    const out = await processRowPhase(row, {}, {
      writePreviewUrl: async () => ({ ok: false, reason: "preview_url_write_conflict" }),
      env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    });
    assert.equal(out.ok, false);
    assert.equal(out.retryable, true);
    assert.equal(out.code, "line_preview_write_retryable");
    assert.equal(out.row.status, "gate_passed", "the queue worker can retry the same durable phase");
  });
});

test("pre-build mirror refusal is classified as dispatch failed before build", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const lineState = require("../lib/line-state");
  let row = lineState.newRow({ prospectId: "prebuild-failure", businessName: "Prebuild Failure" });
  row = lineState.advanceRow(row, "qualified").row;
  const out = await processRowPhase(row, { batchId: "line_prebuild_failure" }, {
    mirror: async () => ({
      ok: false,
      reason: "mirror_build_not_revealable",
      dispatchFailure: {
        code: "invalid_request",
        detail: "/brand/logo: must match pattern \"^https://\"",
        beforeBuild: true,
      },
    }),
  });
  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(out.phase, "mirror");
  assert.equal(out.row.status, "error");
  assert.equal(out.row.reason, "mirror_dispatch_failed_before_build");
  assert.equal(out.row.mirrorDispatch.status, "failed_before_build");
  assert.equal(out.row.mirrorDispatch.failure.code, "invalid_request");
});

test("pre-build Mirror system hold stays qualified and retryable instead of becoming a terminal lead error", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const lineState = require("../lib/line-state");
  let row = lineState.newRow({ prospectId: "prebuild-system-hold", businessName: "Prebuild System Hold" });
  row = lineState.advanceRow(row, "qualified").row;
  const out = await processRowPhase(row, { batchId: "line_prebuild_system_hold" }, {
    mirror: async () => ({
      ok: false,
      retryable: true,
      disposition: "system_hold",
      lead_rejection: false,
      reason: "mirror_fleet_read_unavailable",
      system_hold: {
        schema: "wss.mirror.system_hold.v1",
        type: "system",
        code: "mirror_fleet_read_unavailable",
        retryable: true,
        scope: "mirror_build",
      },
      dispatchFailure: {
        code: "mirror_fleet_read_unavailable",
        beforeBuild: true,
        hasDurableBuildIdentity: false,
        retryable: true,
      },
    }),
    now: () => "2026-08-29T12:00:00.000Z",
  });

  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(out.phase, "mirror_system_hold");
  assert.equal(out.retryable, true);
  assert.equal(out.lead_rejection, false);
  assert.equal(out.row.status, "qualified");
  assert.equal(out.row.reason, "");
  assert.equal(out.row.mirrorDispatch.status, "system_hold_retryable");
  assert.equal(out.row.mirrorDispatch.rebuild_allowed, true);
  assert.equal(out.row.lastRetryableError, "mirror_fleet_read_unavailable");
  assert.ok(Date.parse(out.row.buildRetryAfter) > Date.parse("2026-08-29T12:00:00.000Z"));
});

test("post-deploy Mirror reconciliation is terminal to rebuild/send but preserves exact repair evidence", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const lineState = require("../lib/line-state");
  let row = lineState.newRow({ prospectId: "postdeploy-system-hold", businessName: "Postdeploy System Hold" });
  row = lineState.advanceRow(row, "qualified").row;
  const buildHash = "f".repeat(64);
  const releaseEvidence = {
    schema: "mirror-engine-release-v1",
    build_hash: buildHash,
    preview_url: "https://postdeploy-system-hold.wss-ai.com/",
    evidence_sha: "a".repeat(64),
  };
  const reconciliation = {
    schema: "wss.mirror.fleet_reconciliation.v1",
    action: "record_fleet_identity",
    release: {
      build_hash: buildHash,
      preview_url: releaseEvidence.preview_url,
      deploy_id: "dpl_postdeploy_system_hold",
      deploy_url: "https://postdeploy-system-hold.vercel.app/",
      evidence_sha: releaseEvidence.evidence_sha,
    },
    fleet_identity: {
      slug: "postdeploy-system-hold",
      h1: "Postdeploy System Hold",
      title: "Postdeploy System Hold",
      prospect_id: "postdeploy-system-hold",
      donor: "plumbing-premium-donor",
      build_hash: buildHash,
      attempt: 1,
    },
  };
  const out = await processRowPhase(row, { batchId: "line_postdeploy_system_hold" }, {
    mirror: async () => ({
      ok: false,
      retryable: false,
      disposition: "system_hold",
      lead_rejection: false,
      reason: "mirror_fleet_record_unavailable",
      provider_attempted: true,
      manual_reconciliation_required: true,
      rebuild_allowed: false,
      reconciliation,
      releaseEvidence,
      system_hold: {
        schema: "wss.mirror.system_hold.v1",
        type: "system",
        code: "mirror_fleet_record_unavailable",
        retryable: true,
        scope: "mirror_reconciliation",
        manual_reconciliation_required: true,
        reconciliation,
      },
      dispatchFailure: {
        code: "mirror_fleet_record_unavailable",
        beforeBuild: false,
        hasDurableBuildIdentity: true,
        retryable: false,
        rebuild_allowed: false,
        reconciliation,
        release_evidence: releaseEvidence,
      },
    }),
    now: () => "2026-08-29T12:00:00.000Z",
  });

  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(out.phase, "mirror_reconciliation");
  assert.equal(out.retryable, false);
  assert.equal(out.lead_rejection, false);
  assert.equal(out.row.status, "error", "terminal Line state blocks both rebuild and send");
  assert.equal(out.row.mirrorDispatch.status, "manual_reconciliation_required");
  assert.equal(out.row.mirrorDispatch.rebuild_allowed, false);
  assert.deepEqual(out.row.mirrorDispatch.reconciliation, reconciliation);
  assert.deepEqual(out.row.mirrorDispatch.release_evidence, releaseEvidence);
  assert.deepEqual(out.row.systemHold.reconciliation, reconciliation);
});

test("hero pending marker without durable job+attempt identity is blocked", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const lineState = require("../lib/line-state");
  let row = lineState.newRow({ prospectId: "phantom-hero", businessName: "Phantom Hero" });
  row = lineState.advanceRow(row, "qualified").row;
  const out = await processRowPhase(row, { batchId: "line_phantom_hero" }, {
    mirror: async () => ({
      ok: true,
      heroRemasterPending: true,
      heroRemaster: { required: true, pending: true, status: "queued", job_id: "hrj_missing_attempt" },
    }),
    now: () => "2026-08-26T00:00:00.000Z",
  });
  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(out.row.status, "qualified");
  assert.equal(out.row.heroRemaster.pending, false);
  assert.equal(out.row.heroRemaster.status, "blocked");
  assert.equal(out.row.heroRemaster.reason, "hero_pending_identity_missing");
});

test("an in-flight hero with durable job+attempt stays pending even when built carries no build identity", async () => {
  // Reachable contract (line-adapters enqueueCompletedLineHero "inspect existing"
  // branch): a real hero job already has a durable job_id and attempt_id, but
  // the Mirror build identity lives on the row, not in this `built` snapshot.
  // Such a hero is NOT a phantom — pending is correct, and the row's existing
  // preview/build identity must be preserved rather than cleared.
  const { processRowPhase } = require("../lib/line-runner");
  const lineState = require("../lib/line-state");
  let row = lineState.newRow({ prospectId: "inflight-hero", businessName: "Inflight Hero" });
  row = lineState.advanceRow(row, "qualified").row;
  const out = await processRowPhase(row, { batchId: "line_inflight_hero" }, {
    mirror: async () => ({
      ok: true,
      heroRemasterPending: true,
      heroRemaster: {
        required: true,
        pending: true,
        status: "queued",
        job_id: "hrj_real_job",
        hero_attempt_id: "hero_attempt:1",
        reason: "verified_client_hero_pending",
      },
    }),
    now: () => "2026-08-26T00:00:00.000Z",
  });
  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(out.row.status, "qualified");
  assert.equal(out.row.heroRemaster.pending, true, "a real in-flight hero job stays pending");
  assert.equal(out.row.heroRemaster.status, "queued");
  assert.equal(out.row.heroRemaster.attemptId, "hero_attempt:1");
  assert.notEqual(out.row.heroRemaster.reason, "hero_pending_identity_missing");
});

test("hero attach diagnostic names every explicit autoline kill switch without changing rollback behavior", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const switches = [
    "GHOST_AGENCY_HERO_AUTOLINE",
    "GHOST_AGENCY_HERO_REMMASTER",
    "GHOST_AGENCY_HERO_REMASTER",
  ];

  for (const key of switches) {
    let queued = 0;
    const row = {
      rowId: `diag-${key}`,
      prospectId: `diag-${key}`,
      businessName: "Diagnostic Plumbing",
      status: "gate_passed",
      previewUrl: "https://diag-plumbing.wss-ai.com/",
      currentWebsite: "https://diag-plumbing.example/",
      gate: { pass: true, failed: [], checks: [] },
      history: [{ status: "gate_passed", at: "2026-09-01T07:00:00.000Z" }],
      failedFacts: [],
      reason: "",
    };
    const out = await processRowPhase(row, { lane: "sandbox", batchId: "diag-batch" }, {
      writePreviewUrl: async () => ({ ok: true, rowPatch: {} }),
      queueEmail: async () => { queued += 1; return { ok: true }; },
      env: { [key]: "0" },
      now: () => "2026-09-01T07:01:00.000Z",
    });

    assert.equal(out.ok, true, key);
    assert.equal(out.row.status, "queued", key);
    assert.equal(queued, 1, key);
    assert.equal(out.row.heroAttachDiagnostic.finding, "most likely per code trace", key);
    assert.equal(out.row.heroAttachDiagnostic.brokenLink, "hero_autoline_disabled_by_env", key);
    assert.equal(out.row.heroAttachDiagnostic.autolineEnabled, false, key);
    assert.deepEqual(out.row.heroAttachDiagnostic.disabledBy, [key], key);
  }
});

test("hero attach diagnostic names a missing fresh enqueue checkpoint before the existing freshness refusal", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  let writes = 0;
  let emails = 0;
  const row = {
    rowId: "diag-missing-enqueue",
    prospectId: "diag-missing-enqueue",
    businessName: "Fresh Diagnostic Plumbing",
    status: "gate_passed",
    previewUrl: "https://fresh-diag.wss-ai.com/",
    currentWebsite: "https://fresh-diag.example/",
    buildHash: "fresh-diag-build",
    gate: { pass: true, failed: [], checks: [] },
    history: [{ status: "gate_passed", at: "2026-09-01T07:00:00.000Z" }],
    failedFacts: [],
    reason: "",
  };
  const out = await processRowPhase(row, { lane: "live", batchId: "diag-batch" }, {
    startHero: async () => ({ ok: true }),
    writePreviewUrl: async () => { writes += 1; return { ok: true, rowPatch: {} }; },
    queueEmail: async () => { emails += 1; return { ok: true }; },
    env: {},
    now: () => "2026-09-01T07:01:00.000Z",
  });

  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(writes, 0);
  assert.equal(emails, 0);
  assert.equal(out.row.heroAttachDiagnostic.finding, "most likely per code trace");
  assert.equal(out.row.heroAttachDiagnostic.brokenLink, "hero_enqueue_checkpoint_missing");
  assert.equal(out.row.heroAttachDiagnostic.autolineEnabled, true);
  assert.deepEqual(out.row.heroAttachDiagnostic.disabledBy, []);
  assert.equal(out.row.heroAttachDiagnostic.checkpointStarted, false);
});

test("hero attach diagnostic distinguishes the historical owner-review hold from missing enqueue", async () => {
  const { processRowPhase } = require("../lib/line-runner");
  const row = {
    rowId: "diag-owner-review",
    prospectId: "diag-owner-review",
    businessName: "Legacy Ads Diagnostic",
    status: "mirrored",
    previewUrl: "https://legacy-ads-diag.wss-ai.com/",
    currentWebsite: "https://legacy-ads-diag.example/",
    buildHash: "legacy-ads-build",
    heroRemaster: {
      required: true,
      ready: false,
      pending: false,
      hold: true,
      applied: false,
      status: "awaiting_review",
      producer: "ads_image_to_video",
      reason: "awaiting_owner_review",
    },
    history: [{ status: "mirrored", at: "2026-09-01T07:00:00.000Z" }],
    failedFacts: [],
    reason: "",
  };
  const out = await processRowPhase(row, { lane: "live", batchId: "diag-batch" }, {
    startHero: async () => ({ ok: true }),
    env: {},
    sourceFacts: async () => { throw new Error("freshness boundary must stop before source work"); },
    gate: async () => { throw new Error("freshness boundary must stop before render"); },
    now: () => "2026-09-01T07:01:00.000Z",
  });

  assert.equal(out.row.status, "rejected");
  assert.equal(out.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(out.row.heroAttachDiagnostic.finding, "most likely per code trace");
  assert.equal(out.row.heroAttachDiagnostic.brokenLink, "hero_owner_review_hold");
  assert.equal(out.row.heroAttachDiagnostic.heroProducer, "ads_image_to_video");
  assert.equal(out.row.heroAttachDiagnostic.heroReason, "awaiting_owner_review");
});
