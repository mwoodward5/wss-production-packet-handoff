"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { safeBatch } = require("../api/admin/line");
const { prepareMirroredHero } = require("../lib/line-adapters");
const { processRowPhase } = require("../lib/line-runner");
const lineState = require("../lib/line-state");

function batchWith(row) {
  return {
    batchId: "line_public_hero_status",
    lane: "live",
    target: "roofing",
    requested: 1,
    status: "building",
    rows: [{
      prospectId: "wss-test-hero-status",
      businessName: "Safe Roofing",
      status: "qualified",
      reason: "",
      history: [
        { status: "picked", at: "2026-08-22T19:00:00.000Z" },
        { status: "qualified", at: "2026-08-22T19:01:00.000Z" },
      ],
      ...row,
    }],
  };
}

test("safeBatch exposes an Ads awaiting-review blocker without changing the Line row status", () => {
  const retryAt = "2026-08-22T19:06:00.000Z";
  const safe = safeBatch(batchWith({
    heroRemaster: {
      pending: true,
      status: "awaiting_review",
      reason: "awaiting_owner_review",
      producer: "ads_image_to_video",
      jobId: "hrj_public",
      attemptId: "hero_attempt:1",
    },
    buildRetryAfter: retryAt,
  }));
  const row = safe.rows[0];

  assert.equal(row.status, "qualified");
  assert.equal(row.reason, "");
  assert.deepEqual(row.heroRemaster, {
    pending: true,
    status: "awaiting_review",
    reason: "awaiting_owner_review",
    producer: "ads_image_to_video",
  });
  assert.equal(row.buildRetryAfter, retryAt);
});

test("safeBatch exposes only the operator action marker while the Line row stays qualified", () => {
  const retryAt = "2026-08-22T19:06:00.000Z";
  const safe = safeBatch(batchWith({
    heroRemaster: {
      pending: true,
      status: "operator_action_required",
      reason: "ads_blocked_by_extension",
      jobId: "hrj_private_job",
      attemptId: "hero_attempt:4",
      localPath: "C:\\private\\profile",
      accountId: "private-account",
    },
    buildRetryAfter: retryAt,
  }));
  const row = safe.rows[0];

  assert.equal(row.status, "qualified");
  assert.equal(row.reason, "");
  assert.deepEqual(row.heroRemaster, {
    pending: true,
    status: "operator_action_required",
    reason: "ads_blocked_by_extension",
    producer: "ads_image_to_video",
  });
  assert.equal(row.buildRetryAfter, retryAt);
  assert.doesNotMatch(JSON.stringify(row.heroRemaster), /private|job|path|account/i);
});

test("public hero status omits artifacts, paths, URLs, hashes, prompts, and private detail", () => {
  const secretHash = "a".repeat(64);
  const safe = safeBatch(batchWith({
    status: "rejected",
    reason: "quality_refused:render_gate",
    heroRemaster: {
      pending: false,
      status: "refused",
      reason: "verified_client_hero_failed",
      producer: "ads_image_to_video",
      jobId: "hrj_private_job",
      clipPath: "C:\\private\\hero.mp4",
      reelUrl: "https://private.example/hero.mp4",
      buildHash: secretHash,
      prompt: "private generation prompt",
      approvedArtifact: { clip_sha256: secretHash, source_url: "https://private.example/source.jpg" },
      generationReceipt: { local_path: "/tmp/private.mp4" },
    },
    buildRetryAfter: "not-a-public-timestamp",
  }));
  const row = safe.rows[0];

  assert.equal(row.reason, "quality_refused:render_gate", "terminal Line reasons remain exact");
  assert.deepEqual(row.heroRemaster, {
    pending: false,
    status: "refused",
    reason: "verified_client_hero_failed",
    producer: "ads_image_to_video",
  });
  assert.equal(row.buildRetryAfter, undefined);
  assert.deepEqual(Object.keys(row.heroRemaster).sort(), ["pending", "producer", "reason", "status"]);
  assert.doesNotMatch(JSON.stringify(row.heroRemaster), /private|https?:|[a-f0-9]{64}|prompt|path|artifact|receipt/i);

  const ordinary = safeBatch(batchWith({ buildRetryAfter: "2026-08-22T19:06:00.000Z" })).rows[0];
  assert.equal(ordinary.heroRemaster, undefined);
  assert.equal(ordinary.buildRetryAfter, undefined);
});

test("public hero status refuses token-shaped unknown reasons", () => {
  for (const reason of [
    "sk_live_abcdef",
    "hrj_private_job",
    "private_account_id",
    "unknown_but_structurally_valid",
    "https:private.example",
    "a".repeat(64),
  ]) {
    const row = safeBatch(batchWith({
      heroRemaster: {
        pending: true,
        status: "running",
        reason,
        producer: "ads_image_to_video",
        jobId: "hrj_known",
        attemptId: "hero_attempt:1",
      },
    })).rows[0];

    assert.deepEqual(row.heroRemaster, {
      pending: true,
      status: "running",
      producer: "ads_image_to_video",
    }, `unknown reason must stay private: ${reason}`);
    assert.doesNotMatch(JSON.stringify(row.heroRemaster), new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("public hero status clears phantom pending markers without durable job+attempt identity", () => {
  const row = safeBatch(batchWith({
    heroRemaster: {
      pending: true,
      status: "queued",
      reason: "verified_client_hero_pending",
      producer: "ads_image_to_video",
    },
  })).rows[0];
  assert.deepEqual(row.heroRemaster, {
    pending: false,
    status: "blocked",
    reason: "hero_pending_identity_missing",
    producer: "ads_image_to_video",
  });
});

test("a durable no-source prospect joins a skipped hero fallback to the exact mirrored build", async () => {
  const buildHash = "d".repeat(64);
  let row = lineState.newRow({
    prospectId: "wss-test-durable-no-hero-source",
    businessName: "Durable No Source Roofing",
  });
  row = lineState.advanceRow(row, "qualified", {
    now: "2026-08-24T18:00:00.000Z",
  }).row;

  const durableProspect = {
    prospect_id: row.prospectId,
    business_name: row.businessName,
    current_website: "",
    updated_at: "2026-08-24T17:59:00.000Z",
    record: {
      mirror_request: { facts: {} },
      build_ready: { discovery: {} },
      social_evidence: { attached: [] },
    },
  };

  const out = await processRowPhase(row, {
    lane: "sandbox",
    batchId: "line_durable_no_source",
    operationKey: "line_durable_no_source:wss-test-durable-no-hero-source:mirror",
  }, {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "1" },
    mirror: async () => ({
      ok: true,
      previewUrl: "https://wss-test-durable-no-hero-source.wss-ai.com/",
      currentWebsite: "",
      buildHash,
    }),
    prepareHero: (lineRow, built, options) => prepareMirroredHero(lineRow, built, {
      ...options,
      select: async () => ({ ok: true, data: [durableProspect] }),
    }),
    now: () => "2026-08-24T18:01:00.000Z",
  });

  assert.equal(out.ok, true);
  assert.equal(out.complete, false);
  assert.equal(out.phase, "mirror");
  assert.equal(out.row.status, "mirrored");
  assert.equal(out.row.buildHash, buildHash);
  assert.deepEqual(out.row.heroRemaster, {
    required: false,
    ready: true,
    pending: false,
    hold: false,
    fallback: true,
    applied: false,
    status: "skipped",
    jobId: "",
    rebuildStatus: "",
    rebuildJobId: "",
    buildHash,
    reelUrl: "",
    reason: "no_scannable_hero_source",
  });
});
