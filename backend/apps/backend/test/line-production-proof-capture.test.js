"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { processRowPhase } = require("../lib/line-runner");
const { automaticProofShotRecord } = require("../lib/line-email-assets");
const { createProductionGate } = require("../lib/line-production-gate");

const OLD_URL = "https://client.example/";
const NEW_URL = "https://client.wss-ai.com/";
const BUILD_HASH = "build-proof-production";

function mirroredRow(overrides = {}) {
  return {
    prospectId: "proof-production",
    businessName: "Proof Production Plumbing",
    status: "mirrored",
    previewUrl: NEW_URL,
    currentWebsite: OLD_URL,
    buildHash: BUILD_HASH,
    email: "owner@client.example",
    hasEmail: true,
    contactReady: true,
    history: [{ status: "mirrored", at: "2026-08-21T00:01:00.000Z" }],
    failedFacts: [],
    reason: "",
    ...overrides,
  };
}

function completeShots() {
  return {
    build_hash: BUILD_HASH,
    old_captured_url: OLD_URL,
    old_shot_sha: "1".repeat(64),
    new_captured_url: NEW_URL,
    new_shot_sha: "2".repeat(64),
  };
}

function gateFor(captureResult, environment = {}) {
  return createProductionGate({
    environment,
    captureEmailAssets: async ({ environment: receivedEnvironment }) => {
      assert.equal(receivedEnvironment, environment);
      return captureResult;
    },
    runRenderGate: async (args) => ({
      pass: true,
      failed: [],
      checks: [],
      capture: await args.capture({ browser: { open: true }, url: args.url }),
    }),
  });
}

async function runGatePhase(captureResult, { environment = {}, rowOverrides = {} } = {}) {
  let writes = 0;
  let queues = 0;
  const out = await processRowPhase(mirroredRow(rowOverrides), {
    batchId: "proof-production-batch",
  }, {
    sourceFacts: async () => ({}),
    gate: gateFor(captureResult, environment),
    writePreviewUrl: async () => { writes += 1; return { ok: true }; },
    queueEmail: async () => { queues += 1; return { ok: true }; },
    now: () => "2026-08-21T00:02:00.000Z",
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
  });
  return { out, writes, queues };
}

test("complete production capture reaches proof_shots in the same gate tick", async () => {
  const shots = completeShots();
  const { out, writes, queues } = await runGatePhase({ ok: true, shots, results: [] });

  assert.equal(out.ok, true);
  assert.equal(out.row.status, "gate_passed");
  assert.deepEqual(out.row.proof_shots, shots);
  assert.equal(writes, 0);
  assert.equal(queues, 0, "proof is durable on the row before the later email phase");
});

test("a lead with no current website reaches the gate with verified ours-only proof", async () => {
  const shots = {
    build_hash: BUILD_HASH,
    new_captured_url: NEW_URL,
    new_shot_sha: "2".repeat(64),
  };
  const { out, writes, queues } = await runGatePhase(
    { ok: true, shots, results: [] },
    { rowOverrides: { currentWebsite: "" } },
  );

  assert.equal(out.ok, true);
  assert.equal(out.row.status, "gate_passed");
  assert.deepEqual(out.row.proof_shots, shots);
  assert.equal(writes, 0);
  assert.equal(queues, 0);
});

test("passing DOM gate remains gate_passed when automatic proof capture is incomplete", async () => {
  const incomplete = {
    ok: true,
    shots: {
      build_hash: BUILD_HASH,
      new_captured_url: NEW_URL,
      new_shot_sha: "2".repeat(64),
    },
    results: [{ variant: "old", ok: false, reason: "capture_budget_exhausted" }],
  };
  const { out, writes, queues } = await runGatePhase(incomplete);

  assert.equal(out.ok, true);
  assert.equal(out.row.status, "gate_passed", "email proof capture cannot reverse a passing rendered-DOM verdict");
  assert.equal(Object.hasOwn(out.row, "proof_shots"), false, "partial proof is never made durable");
  assert.equal(Object.hasOwn(out.row, "captured"), false, "partial capture cannot leak into delivery evidence");
  assert.equal(writes, 0, "preview publication remains the next durable phase");
  assert.equal(queues, 0, "the gate tick never queues email");
});

test("source identity mismatch still records no proof and preserves the existing visual-refusal path", async () => {
  const mismatch = {
    ok: true,
    shots: {
      build_hash: BUILD_HASH,
      new_captured_url: NEW_URL,
      new_shot_sha: "2".repeat(64),
      before_refused: "capture_identity_capture_domain_mismatch",
    },
    results: [{ variant: "old", ok: false, reason: "capture_identity_capture_domain_mismatch" }],
  };
  const { out, writes, queues } = await runGatePhase(mismatch);

  assert.equal(out.ok, true, "identity refusal is settled, not retried as a transport failure");
  assert.equal(out.row.status, "gate_passed");
  assert.equal(automaticProofShotRecord(mismatch), null);
  assert.equal(Object.hasOwn(out.row, "proof_shots"), false);
  assert.equal(Object.hasOwn(out.row, "captured"), false);
  assert.equal(writes, 0);
  assert.equal(queues, 0);
});

test("the exact zero kill switch restores the unchanged send-time fallback", async () => {
  const disabled = { ok: false, reason: "automatic_proof_shots_disabled", shots: {}, results: [] };
  const environment = { GHOST_AGENCY_LINE_PROOF_SHOTS: "0" };
  const { out, writes, queues } = await runGatePhase(disabled, { environment });

  assert.equal(out.ok, true);
  assert.equal(out.row.status, "gate_passed");
  assert.equal(Object.hasOwn(out.row, "proof_shots"), false);
  assert.equal(writes, 0);
  assert.equal(queues, 0);
});
