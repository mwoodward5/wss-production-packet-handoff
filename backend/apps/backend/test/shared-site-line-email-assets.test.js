"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  captureLineEmailAssets,
  deliveryProofIdentity,
  proofShotsForSend,
} = require("../lib/line-email-assets");
const { signedVisualPath } = require("../lib/preview-visuals");
const { createProductionGate } = require("../lib/line-production-gate");
const { gateWithCapture: adminGateWithCapture } = require("../api/admin/line");

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const BUILD_HASH = "a".repeat(64);
const PREVIEW = "https://shared-proof.wss-ai.com/";
const CURRENT = "https://shared-proof.example/";
const IDENTITY = Object.freeze({
  site_id: SITE_ID,
  release_id: RELEASE_ID,
  build_hash: BUILD_HASH,
});

function capturedShots(overrides = {}) {
  return {
    old_captured_url: CURRENT,
    old_shot_sha: "b".repeat(64),
    new_captured_url: PREVIEW,
    new_shot_sha: "c".repeat(64),
    ...overrides,
  };
}

test("both production capture doors forward the exact shared release tuple", async () => {
  let gateArgs = null;
  const gate = await captureLineEmailAssets({
    previewUrl: PREVIEW,
    currentWebsite: CURRENT,
    buildHash: BUILD_HASH,
    proofIdentity: IDENTITY,
    motion: false,
    proofShots: async (args) => {
      gateArgs = args;
      return { ok: true, shots: capturedShots(IDENTITY), results: [] };
    },
  });

  assert.deepEqual(gateArgs.proofIdentity, IDENTITY);
  assert.equal(gateArgs.buildHash, BUILD_HASH);
  assert.deepEqual(
    { site_id: gate.shots.site_id, release_id: gate.shots.release_id, build_hash: gate.shots.build_hash },
    IDENTITY,
  );

  let sendArgs = null;
  const send = await proofShotsForSend({
    row: { previewUrl: PREVIEW, buildHash: BUILD_HASH },
    record: {},
    currentWebsite: CURRENT,
    proofIdentity: IDENTITY,
    captureShots: async (args) => {
      sendArgs = args;
      return { ok: true, shots: capturedShots(IDENTITY), results: [] };
    },
  });

  assert.deepEqual(sendArgs.proofIdentity, IDENTITY);
  assert.equal(sendArgs.buildHash, BUILD_HASH);
  assert.equal(send.source, "send_path_capture");
  assert.deepEqual(
    { site_id: send.shots.site_id, release_id: send.shots.release_id, build_hash: send.shots.build_hash },
    IDENTITY,
  );
});

test("a partial shared marker refuses before either capture door and cannot mint an email visual", async () => {
  const partial = { site_id: SITE_ID, build_hash: BUILD_HASH };
  let gateCalls = 0;
  const gate = await captureLineEmailAssets({
    previewUrl: PREVIEW,
    currentWebsite: CURRENT,
    buildHash: BUILD_HASH,
    proofIdentity: partial,
    proofShots: async () => {
      gateCalls += 1;
      return { ok: true, shots: capturedShots(), results: [] };
    },
  });
  assert.equal(gateCalls, 0);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "shared_proof_identity_incomplete");
  assert.deepEqual(gate.shots, {});

  let sendCalls = 0;
  const send = await proofShotsForSend({
    row: { previewUrl: PREVIEW, buildHash: BUILD_HASH },
    record: { proof_shots: capturedShots({ build_hash: BUILD_HASH }) },
    currentWebsite: CURRENT,
    proofIdentity: partial,
    captureShots: async () => {
      sendCalls += 1;
      return { ok: true, shots: capturedShots(), results: [] };
    },
  });
  assert.equal(sendCalls, 0);
  assert.equal(send.source, "shared_identity_refused");
  assert.equal(send.reason, "shared_proof_identity_incomplete");
  assert.equal(send.shots, null);
  assert.equal(signedVisualPath({ kind: "new", previewUrl: PREVIEW, proofIdentity: partial }), "");
});

test("a complete-looking but non-registry tuple also refuses before capture", async () => {
  let calls = 0;
  const out = await captureLineEmailAssets({
    previewUrl: PREVIEW,
    buildHash: BUILD_HASH,
    proofIdentity: { site_id: "site_guess", release_id: "release_guess", build_hash: BUILD_HASH },
    proofShots: async () => {
      calls += 1;
      return { ok: true, shots: capturedShots(), results: [] };
    },
  });
  assert.equal(calls, 0);
  assert.match(out.reason, /^shared_proof_identity_malformed:site_id:/);
  assert.deepEqual(out.shots, {});
});

test("no site_id/release_id markers preserve byte-identical legacy capture calls", async () => {
  const legacyOnly = { build_hash: BUILD_HASH };
  const browser = { lane: "gate" };
  const fixedNow = () => 1_000;
  let gateArgs = null;
  await captureLineEmailAssets({
    browser,
    previewUrl: PREVIEW,
    currentWebsite: CURRENT,
    buildHash: BUILD_HASH,
    proofIdentity: legacyOnly,
    budgetMs: 500,
    now: fixedNow,
    motion: false,
    proofShots: async (args) => {
      gateArgs = args;
      return { ok: true, shots: capturedShots(), results: [] };
    },
  });
  assert.deepEqual(gateArgs, {
    currentWebsite: CURRENT,
    previewUrl: PREVIEW,
    buildHash: BUILD_HASH,
    browser,
    deadlineAt: 1_500,
    now: fixedNow,
  });
  assert.equal(Object.hasOwn(gateArgs, "proofIdentity"), false);

  let sendArgs = null;
  const send = await proofShotsForSend({
    row: { previewUrl: PREVIEW, buildHash: BUILD_HASH },
    record: {},
    currentWebsite: CURRENT,
    proofIdentity: legacyOnly,
    deadlineAt: 9_000,
    now: fixedNow,
    captureShots: async (args) => {
      sendArgs = args;
      return { ok: true, shots: capturedShots(), results: [] };
    },
  });
  assert.deepEqual(sendArgs, {
    currentWebsite: CURRENT,
    previewUrl: PREVIEW,
    buildHash: BUILD_HASH,
    deadlineAt: 9_000,
    now: fixedNow,
  });
  assert.equal(Object.hasOwn(sendArgs, "proofIdentity"), false);
  assert.equal(send.source, "send_path_capture");
  assert.equal(send.shots.build_hash, BUILD_HASH);
});

test("production proof identity reconciliation refuses partial and conflicting current sources", () => {
  assert.deepEqual(
    deliveryProofIdentity({
      sources: [{ site_id: SITE_ID, build_hash: BUILD_HASH }],
      buildHash: BUILD_HASH,
    }),
    {
      ok: false,
      active: true,
      proofIdentity: null,
      reason: "shared_proof_identity_incomplete",
    },
  );
  assert.deepEqual(
    deliveryProofIdentity({
      sources: [IDENTITY, { ...IDENTITY, release_id: "33333333-3333-4333-8333-333333333333" }],
      buildHash: BUILD_HASH,
    }),
    {
      ok: false,
      active: true,
      proofIdentity: null,
      reason: "shared_proof_identity_conflict",
    },
  );
  assert.deepEqual(
    deliveryProofIdentity({ sources: [{ build_hash: BUILD_HASH }], buildHash: BUILD_HASH }),
    { ok: true, active: false, proofIdentity: null, reason: "" },
  );
});

test("a shared send capture cannot be relabeled when it omits or changes the exact tuple", async () => {
  const gate = await captureLineEmailAssets({
    previewUrl: PREVIEW,
    currentWebsite: CURRENT,
    buildHash: BUILD_HASH,
    proofIdentity: IDENTITY,
    motion: false,
    proofShots: async () => ({ ok: true, shots: capturedShots(), results: [] }),
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "shared_proof_capture_identity_missing");
  assert.deepEqual(gate.shots, {}, "the render gate cannot relabel a legacy capture either");

  for (const capturedIdentity of [
    {},
    { ...IDENTITY, release_id: "33333333-3333-4333-8333-333333333333" },
  ]) {
    let captureArgs = null;
    const out = await proofShotsForSend({
      row: { previewUrl: PREVIEW, buildHash: BUILD_HASH },
      record: {
        proof_shots: {
          ...IDENTITY,
          old_captured_url: CURRENT,
          old_shot_sha: "b".repeat(64),
        },
      },
      currentWebsite: CURRENT,
      proofIdentity: IDENTITY,
      captureShots: async (args) => {
        captureArgs = args;
        return { ok: true, shots: capturedShots(capturedIdentity), results: [] };
      },
    });

    assert.deepEqual(captureArgs.proofIdentity, IDENTITY, "capture receives the exact expected tuple");
    assert.equal(out.refuseDelivery, true);
    assert.equal(out.persist, false);
    assert.equal(out.shots, null, "no legacy-key capture can be relabeled as shared proof");
  }
});

test("production and legacy-admin build gates forward exact shared identity and leave legacy args unchanged", async () => {
  for (const [name, makeGate] of [
    ["production", (dependencies) => createProductionGate(dependencies)],
    ["legacy-admin", (dependencies) => adminGateWithCapture(dependencies)],
  ]) {
    let captureArgs = null;
    const gate = makeGate({
      clock: () => 1_000,
      captureEmailAssets: async (args) => {
        captureArgs = args;
        return { ok: true, shots: {} };
      },
      runRenderGate: async (args) => args.capture({ browser: { open: true }, url: args.url }),
    });
    await gate({
      url: PREVIEW,
      deadlineAt: 100_000,
      build: { currentWebsite: CURRENT, buildHash: BUILD_HASH, proofIdentity: IDENTITY },
    });
    assert.deepEqual(captureArgs.proofIdentity, IDENTITY, name);

    await gate({ url: PREVIEW, deadlineAt: 100_000, build: {} });
    assert.equal(Object.hasOwn(captureArgs, "proofIdentity"), false, `${name} legacy args`);
  }
});
