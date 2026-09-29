"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const {
  createLineSender,
  lineDeliveryIdempotencyKey,
  deliveryInputFingerprint,
  fingerprintsMatch,
  safeProviderResult,
  currentReadiness,
} = require("../lib/line-delivery");
const {
  automaticProofShotRecord,
  proofShotsForSend,
} = require("../lib/line-email-assets");
const {
  createContentCertification,
  verifyContentCertification,
} = require("../lib/intake-genie-client");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/mirror-engine-contract");
const { signEvidence, verifyEvidence } = require("../lib/mirror-engine/evidence-signature");
const {
  mirrorRecordPatch,
  nativeMirrorBuildEvidence,
} = require("../lib/line-adapters");

const OWNER = "owner@example.test";
const CANONICAL = "current@example.test";
const SIGNAL_REPORT = "https://callprep.wss-ai.com/report/3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44";
const SHARED_PREVIEW = "https://practice-proof.wss-ai.com/";
const SHARED_SITE_ID = "11111111-1111-4111-8111-111111111111";
const SHARED_RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const SHARED_BUILD_HASH = "a".repeat(64);
const SHARED_PROOF_IDENTITY = Object.freeze({
  site_id: SHARED_SITE_ID,
  release_id: SHARED_RELEASE_ID,
  build_hash: SHARED_BUILD_HASH,
});

function sharedReleaseEvidence() {
  const shared = {
    evidence_schema: "shared-site-release-evidence-v1",
    state: "active",
    ...SHARED_PROOF_IDENTITY,
    canonical_host: "practice-proof.wss-ai.com",
  };
  return {
    build_hash: SHARED_BUILD_HASH,
    preview_url: SHARED_PREVIEW,
    proofIdentity: { ...SHARED_PROOF_IDENTITY },
    sharedReleaseEvidence: shared,
  };
}

function exactPublicRelease(input = {}) {
  return {
    ok: true,
    fallback: false,
    previewUrl: input.previewUrl,
    siteId: input.proofIdentity.site_id,
    releaseId: input.proofIdentity.release_id,
    buildHash: input.proofIdentity.build_hash,
  };
}

function fingerprint(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

function baseHarness(overrides = {}) {
  const state = {
    selects: [],
    upserts: [],
    sends: [],
    captures: 0,
    readinessCalls: 0,
  };
  const durable = {
    prospect_id: "prospect-1",
    business_name: "Current Business",
    email: CANONICAL,
    current_website: "https://current.example.test",
    preview_url: SHARED_PREVIEW,
    status: "line_queued",
    updated_at: "2026-08-14T11:59:00.000Z",
    record: {
      proof_shots: {
        ...SHARED_PROOF_IDENTITY,
        old_desktop: "https://proof.example.test/old.png",
      },
      build_dispatch: {
        build_hash: SHARED_BUILD_HASH,
        release_evidence: sharedReleaseEvidence(),
      },
      build_release_evidence: { pass: true },
    },
  };
  const deps = {
    select: async (table, query) => {
      state.selects.push({ table, query });
      return { ok: true, data: [durable] };
    },
    conditionalUpdate: async (table, key, keyValue, guards, row) => {
      state.upserts.push({ table, key, keyValue, guards, row });
      Object.assign(durable, row);
      return { ok: true, updated: true, rows: [{ ...durable }] };
    },
    sendSequenceStep: async (input) => {
      state.sends.push(input);
      return { ok: true, mode: "sent", id: "provider-1" };
    },
    ensureLineProofShots: async () => {
      state.captures += 1;
      return { ok: true };
    },
    proofShotsForSend: async ({ row, captureShots }) => {
      state.proofRow = row;
      await captureShots();
      return {
        shots: {
          old_desktop: "https://proof.example.test/old.png",
          new_desktop: "https://proof.example.test/new.png",
        },
        persist: true,
      };
    },
    ensureLineReport: async () => ({ ok: true, reportUrl: SIGNAL_REPORT }),
    verifyActiveRelease: exactPublicRelease,
    clientReferenceCode: () => "WSS-ABC123",
    ownerSandboxAddress: () => OWNER,
    forceOwnerRecipient: (prospect, owner) => ({
      ...prospect,
      email: owner,
      ownerEmail: owner,
      owner_email: owner,
    }),
    assertOwnerOnly: (prospect, owner) => [prospect.email, prospect.ownerEmail, prospect.owner_email]
      .every((value) => String(value).toLowerCase() === String(owner).toLowerCase()),
    recipientFingerprint: fingerprint,
    suppressionStatus: async () => ({ known: true, suppressed: false }),
    deliveryPauseStatus: async () => ({ active: false, known: true }),
    reviewHoldActive: () => false,
    readiness: async (input) => {
      state.readinessCalls += 1;
      state.readinessInput = input;
      return { ready: true, blockers: [] };
    },
    liveSendsEnabled: true,
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    ...overrides,
  };
  return { state, durable, deps };
}

function queuedRow(overrides = {}) {
  return {
    prospectId: "prospect-1",
    businessName: "Approved Business",
    email: "stale-row@example.test",
    previewUrl: SHARED_PREVIEW,
    buildHash: SHARED_BUILD_HASH,
    proofIdentity: SHARED_PROOF_IDENTITY,
    releaseEvidence: sharedReleaseEvidence(),
    recipientFingerprint: fingerprint(CANONICAL),
    status: "queued",
    ...overrides,
  };
}

test("delivery idempotency uses only batch, prospect, sequence and step", () => {
  const input = { batchId: "batch-1", prospectId: "prospect-1", sequence: 1, step: 1 };
  const first = lineDeliveryIdempotencyKey({ ...input, lane: "sandbox", email: "one@example.test" });
  const second = lineDeliveryIdempotencyKey({ ...input, lane: "live", email: "two@example.test" });
  assert.equal(first, second);
  assert.match(first, /^ghost-line-[a-f0-9]{64}$/);
  assert.notEqual(first, lineDeliveryIdempotencyKey({ ...input, step: 2 }));
  assert.equal(lineDeliveryIdempotencyKey({ prospectId: "prospect-1" }), "");
});

test("fingerprint comparison is strict and constant-width", () => {
  const value = fingerprint(CANONICAL);
  assert.equal(fingerprintsMatch(value, value.toUpperCase()), true);
  assert.equal(fingerprintsMatch(value, fingerprint("changed@example.test")), false);
  assert.equal(fingerprintsMatch("", value), false);
  assert.equal(fingerprintsMatch("not-a-digest", value), false);
});

test("live send carries automatic row proof_shots through the server-owned resolver without changing provider counts", async () => {
  const { state, deps } = baseHarness();
  const send = createLineSender({ lane: "live", batchId: "batch-1", deps });
  const deadlineAt = Date.now() + 120_000;
  const automaticShots = {
    build_hash: "build-proof-1",
    old_captured_url: "https://current.example.test/",
    old_shot_sha: "1".repeat(64),
    new_captured_url: "https://preview.example.test/",
    new_shot_sha: "2".repeat(64),
  };
  const result = await send(queuedRow({ proof_shots: automaticShots }), { sequence: 1, step: 1, deadlineAt });

  assert.deepEqual(result, {
    ok: true,
    reason: "",
    mode: "sent",
    idempotencyKey: lineDeliveryIdempotencyKey({
      batchId: "batch-1",
      prospectId: "prospect-1",
      sequence: 1,
      step: 1,
    }),
    acceptedAt: "2026-08-14T12:00:00.000Z",
    providerReceipt: "provider-1",
  });
  assert.equal(state.selects.length, 4, "canonical state is checked after evidence, after its CAS, and at the provider boundary");
  assert.equal(state.selects[0].table, "ghost_agency_prospects");
  assert.match(state.selects[0].query, /prospect_id=eq\.prospect-1/);
  assert.equal(state.sends.length, 1);
  assert.deepEqual(state.proofRow.proof_shots, automaticShots, "the direct durable proof record must reach proofShotsForSend");
  const input = state.sends[0];
  assert.equal(input.prospect.email, CANONICAL, "the stale row recipient is never used");
  assert.equal(input.prospect.preview_url, SHARED_PREVIEW);
  assert.equal(input.prospect.record.report_url, SIGNAL_REPORT);
  assert.equal(input.prospect.record.client_id, "WSS-ABC123");
  assert.equal(input.prospect.record.proof_shots.new_desktop, "https://proof.example.test/new.png");
  assert.equal(input.lineBatchApproved, true);
  assert.equal(input.dryRun, false);
  assert.equal(input.bcc, OWNER);
  assert.equal(input.internalOwnerProof, undefined);
  assert.equal(input.deadlineAt, deadlineAt);
  assert.equal(input.idempotencyKey, result.idempotencyKey);
  assert.equal(state.captures, 1);
  assert.equal(state.upserts.length, 1, "proof, report, and client reference persist in one guarded write");
  assert.deepEqual(state.upserts[0].guards, {
    updated_at: "eq.2026-08-14T11:59:00.000Z",
    status: "eq.line_queued",
    email: "eq.current@example.test",
  });
  assert.equal(state.readinessCalls, 1);
  assert.deepEqual(state.readinessInput, { lane: "live", batchId: "batch-1" });
  assert.doesNotMatch(JSON.stringify(result), /@|\+?\d{3}[- ().]\d{3}/);
});

test("prepare drops stale queued build proof and resolves only the current durable build without a provider call", async () => {
  const { state, durable, deps } = baseHarness();
  durable.preview_url = "https://build-b.wss-ai.com/";
  durable.record = {
    ...durable.record,
    preview_url: durable.preview_url,
    build_dispatch: { build_hash: "build-b" },
    proof_shots: {
      build_hash: "build-b",
      old_captured_url: "https://current.example.test/",
      old_shot_sha: "3".repeat(64),
      new_captured_url: durable.preview_url,
      new_shot_sha: "4".repeat(64),
    },
  };
  let resolverInput = null;
  deps.proofShotsForSend = async (input) => {
    resolverInput = input;
    return { shots: input.record.proof_shots, source: "stored_record", persist: false };
  };

  const send = createLineSender({ lane: "live", batchId: "batch-1", deps });
  const plan = await send.prepare(queuedRow({
    previewUrl: "https://build-a.wss-ai.com/",
    buildHash: "build-a",
    proofIdentity: undefined,
    releaseEvidence: undefined,
    proof_shots: {
      build_hash: "build-a",
      old_captured_url: "https://wrong-before.example/",
      old_shot_sha: "1".repeat(64),
      new_captured_url: "https://build-a.wss-ai.com/",
      new_shot_sha: "2".repeat(64),
    },
  }), { deadlineAt: Date.now() + 120_000 });

  assert.equal(plan.ok, true);
  assert.equal(state.sends.length, 0, "prepare proves evidence without calling the provider");
  assert.equal(resolverInput.row.previewUrl, durable.preview_url);
  assert.equal(resolverInput.row.buildHash, "build-b");
  assert.equal(Object.hasOwn(resolverInput.row, "proof_shots"), false, "build A proof cannot render as build B");
  assert.equal(Object.hasOwn(resolverInput.row, "captured"), false);
  assert.equal(resolverInput.record.proof_shots.build_hash, "build-b");
});

test("live delivery passes the reconciled shared release tuple into the proof resolver", async () => {
  const siteId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  const buildHash = "a".repeat(64);
  const { state, durable, deps } = baseHarness();
  durable.record = {
    ...durable.record,
    build_dispatch: { build_hash: buildHash },
    proof_shots: {
      site_id: siteId,
      release_id: releaseId,
      build_hash: buildHash,
      old_captured_url: durable.current_website,
      old_shot_sha: "b".repeat(64),
      new_captured_url: durable.preview_url,
      new_shot_sha: "c".repeat(64),
    },
  };
  let resolverInput = null;
  deps.proofShotsForSend = async (input) => {
    resolverInput = input;
    return { shots: input.record.proof_shots, source: "stored_record", persist: false };
  };

  const send = createLineSender({ lane: "live", batchId: "batch-shared-proof", deps });
  const result = await send(queuedRow({ buildHash }), { deadlineAt: Date.now() + 120_000 });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(resolverInput.proofIdentity, {
    site_id: siteId,
    release_id: releaseId,
    build_hash: buildHash,
  });
  assert.equal(state.sends.length, 1);
});

test("live delivery carries a row-only shared identity into proof resolution", async () => {
  const identity = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: "22222222-2222-4222-8222-222222222222",
    build_hash: "a".repeat(64),
  };
  const { state, durable, deps } = baseHarness();
  durable.record = {
    ...durable.record,
    build_dispatch: { build_hash: identity.build_hash },
  };
  let resolverInput = null;
  deps.proofShotsForSend = async (input) => {
    resolverInput = input;
    return { shots: input.record.proof_shots, source: "stored_record", persist: false };
  };

  const send = createLineSender({ lane: "live", batchId: "batch-shared-row-only", deps });
  const result = await send(queuedRow({
    buildHash: identity.build_hash,
    proofIdentity: identity,
  }), { deadlineAt: Date.now() + 120_000 });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(resolverInput.proofIdentity, identity);
  assert.equal(state.sends.length, 1);
});

test("proof resolver failure cannot resurrect or write stale durable proof", async () => {
  const { state, durable, deps } = baseHarness();
  durable.record = {
    ...durable.record,
    build_dispatch: {
      build_hash: SHARED_BUILD_HASH,
      release_evidence: sharedReleaseEvidence(),
    },
    proof_shots: {
      build_hash: "build-old",
      old_captured_url: durable.current_website,
      old_shot_sha: "d".repeat(64),
      new_captured_url: "https://old-preview.wss-ai.com/",
      new_shot_sha: "e".repeat(64),
    },
  };
  deps.proofShotsForSend = async () => { throw new Error("resolver unavailable"); };

  const send = createLineSender({ lane: "sandbox", batchId: "batch-proof-error", deps });
  const result = await send(queuedRow());

  assert.equal(result.ok, false);
  assert.equal(result.reason, "proof_resolution_unavailable");
  assert.equal(result.providerAttempted, false);
  assert.equal(state.sends.length, 0, "stale proof never reaches the composer or provider");
  assert.equal(state.upserts.length, 0, "a proof-resolution failure writes nothing");
});

test("unresolved delivery proof blocks before compose or provider", async () => {
  const { state, deps } = baseHarness();
  deps.proofShotsForSend = async () => ({
    shots: null,
    persist: false,
    refuseDelivery: true,
    reason: "proof_capture_incomplete",
  });

  const send = createLineSender({ lane: "live", batchId: "batch-unresolved-proof", deps });
  const result = await send(queuedRow(), { deadlineAt: Date.now() + 120_000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "proof_capture_incomplete");
  assert.equal(result.providerAttempted, false);
  assert.equal(result.policyHold, true);
  assert.equal(state.sends.length, 0, "unresolved proof cannot reach composition or the provider");
  assert.equal(state.upserts.length, 0, "a refused proof attempt writes no delivery evidence");
});

test("partial or conflicting shared proof stops before capture, write, compose, or provider", async () => {
  const siteId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  const otherReleaseId = "33333333-3333-4333-8333-333333333333";
  const buildHash = "a".repeat(64);

  for (const rowProof of [
    { proof_shots: { site_id: siteId, build_hash: buildHash } },
    { proof_shots: { site_id: siteId, release_id: otherReleaseId, build_hash: buildHash } },
    { proofIdentity: { site_id: siteId, build_hash: buildHash } },
  ]) {
    const { state, durable, deps } = baseHarness();
    durable.record = {
      ...durable.record,
      build_dispatch: { build_hash: buildHash },
      proof_shots: {
        site_id: siteId,
        release_id: releaseId,
        build_hash: buildHash,
        old_captured_url: durable.current_website,
        old_shot_sha: "b".repeat(64),
      },
    };
    let resolverCalls = 0;
    deps.proofShotsForSend = async () => { resolverCalls += 1; return { shots: null }; };

    const send = createLineSender({ lane: "sandbox", batchId: "batch-shared-refusal", deps });
    const result = await send(queuedRow({ buildHash, ...rowProof }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "owner_proof_public_release_unavailable");
    assert.equal(result.retryableBeforeProvider, true);
    assert.equal(result.releaseFailureKind, "identity_invalid");
    assert.equal(resolverCalls, 0);
    assert.equal(state.captures, 0);
    assert.equal(state.upserts.length, 0);
    assert.equal(state.sends.length, 0);
  }
});

test("an identity-refused before capture reaches the email refusal but records no partial proof", async () => {
  const originalShots = {
    build_hash: "build-old",
    old_captured_url: "https://current.example.test/",
    old_shot_sha: "1".repeat(64),
    new_captured_url: "https://old-preview.wss-ai.com/",
    new_shot_sha: "2".repeat(64),
  };
  const { state, durable, deps } = baseHarness();
  durable.preview_url = SHARED_PREVIEW;
  durable.record = {
    ...durable.record,
    build_dispatch: {
      build_hash: SHARED_BUILD_HASH,
      release_evidence: sharedReleaseEvidence(),
    },
    proof_shots: { ...originalShots },
  };
  deps.proofShotsForSend = require("../lib/line-email-assets").proofShotsForSend;
  deps.ensureLineProofShots = async () => ({
    ok: false,
    reason: "no_before_shot",
    shots: {
      ...SHARED_PROOF_IDENTITY,
      new_captured_url: durable.preview_url,
      new_shot_sha: "3".repeat(64),
      before_refused: "capture_identity_capture_domain_mismatch",
    },
    results: [{
      variant: "old",
      ok: false,
      reason: "capture_identity_capture_domain_mismatch",
    }],
  });
  deps.sendSequenceStep = async (input) => {
    state.sends.push(input);
    assert.equal(input.prospect.proof_shots.old_captured_url, undefined);
    assert.equal(input.prospect.proof_shots.before_refused, "capture_identity_capture_domain_mismatch");
    return { ok: false, blocked: "no_before_after_visuals" };
  };

  const send = createLineSender({ lane: "sandbox", batchId: "batch-proof-refused", deps });
  const result = await send(queuedRow({
    previewUrl: durable.preview_url,
    buildHash: SHARED_BUILD_HASH,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_before_after_visuals");
  assert.equal(state.sends.length, 1, "the composer receives the refusal; no provider success is possible");
  assert.equal(state.upserts.length, 1, "only the report/client-id write remains; no proof write runs");
  assert.deepEqual(
    state.upserts[0].row.record.proof_shots,
    originalShots,
    "the later record write must keep the durable proof field byte-for-byte unchanged",
  );
  assert.doesNotMatch(JSON.stringify(state.upserts), /"3{64}"/);
});

test("legacy admin send also keeps identity-refused proof in-memory and out of every record write", async () => {
  const originalOwner = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_OWNER_EMAIL = OWNER;
  const originalShots = {
    build_hash: "build-old",
    old_captured_url: "https://current.example.test/",
    old_shot_sha: "4".repeat(64),
    new_captured_url: "https://old-preview.wss-ai.com/",
    new_shot_sha: "5".repeat(64),
  };
  const durable = {
    prospect_id: "prospect-admin-refused",
    business_name: "Admin Refusal",
    email: CANONICAL,
    current_website: "https://current.example.test/",
    preview_url: "https://current-preview.wss-ai.com/",
    status: "line_queued",
    record: {
      build_dispatch: { build_hash: "build-new" },
      proof_shots: { ...originalShots },
    },
  };
  const writes = [];
  let composed = 0;
  try {
    const { defaultSend } = require("../api/admin/line");
    const send = defaultSend("sandbox", {
      select: async () => ({ ok: true, data: [durable] }),
      upsertRow: async (table, row, conflict) => {
        writes.push({ table, row, conflict });
        return { ok: true };
      },
      proofShotsForSend: require("../lib/line-email-assets").proofShotsForSend,
      ensureLineProofShots: async () => ({
        ok: false,
        reason: "no_before_shot",
        shots: {
          new_captured_url: durable.preview_url,
          new_shot_sha: "6".repeat(64),
          before_refused: "capture_identity_capture_domain_mismatch",
        },
        results: [{
          variant: "old",
          ok: false,
          reason: "capture_identity_capture_domain_mismatch",
        }],
      }),
      ensureLineReport: async () => ({ ok: true, reportUrl: SIGNAL_REPORT }),
      sendSequenceStep: async ({ prospect }) => {
        composed += 1;
        assert.equal(prospect.proof_shots.old_captured_url, undefined);
        assert.equal(prospect.proof_shots.before_refused, "capture_identity_capture_domain_mismatch");
        return { ok: false, blocked: "no_before_after_visuals" };
      },
    });

    const result = await send({
      prospectId: durable.prospect_id,
      businessName: durable.business_name,
      email: durable.email,
      previewUrl: durable.preview_url,
      buildHash: "build-new",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_before_after_visuals");
    assert.equal(composed, 1);
    assert.equal(writes.length, 1, "no direct proof write runs");
    assert.deepEqual(writes[0].row.record.proof_shots, originalShots);
    assert.doesNotMatch(JSON.stringify(writes), /"6{64}"/);
  } finally {
    if (originalOwner === undefined) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = originalOwner;
  }
});

test("legacy admin caller forwards the exact reconciled shared proof tuple", async () => {
  const originalOwner = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_OWNER_EMAIL = OWNER;
  const identity = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: "22222222-2222-4222-8222-222222222222",
    build_hash: "a".repeat(64),
  };
  const shots = {
    ...identity,
    old_captured_url: "https://current.example.test/",
    old_shot_sha: "b".repeat(64),
    new_captured_url: "https://current-preview.wss-ai.com/",
    new_shot_sha: "c".repeat(64),
  };
  const durable = {
    prospect_id: "prospect-admin-shared",
    business_name: "Admin Shared",
    email: CANONICAL,
    current_website: "https://current.example.test/",
    preview_url: "https://current-preview.wss-ai.com/",
    status: "line_queued",
    record: { build_dispatch: { build_hash: identity.build_hash }, proof_shots: shots },
  };
  let resolverInput = null;
  try {
    const { defaultSend } = require("../api/admin/line");
    const send = defaultSend("sandbox", {
      select: async () => ({ ok: true, data: [durable] }),
      upsertRow: async () => ({ ok: true }),
      proofShotsForSend: async (input) => {
        resolverInput = input;
        return { shots, source: "stored_record", persist: false };
      },
      ensureLineReport: async () => ({ ok: true, reportUrl: SIGNAL_REPORT }),
      sendSequenceStep: async () => ({ ok: true, mode: "sent", id: "admin-shared" }),
    });
    const result = await send({
      prospectId: durable.prospect_id,
      businessName: durable.business_name,
      email: durable.email,
      previewUrl: durable.preview_url,
      buildHash: identity.build_hash,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(resolverInput.proofIdentity, identity);
  } finally {
    if (originalOwner === undefined) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = originalOwner;
  }
});

test("legacy admin caller carries a row-only shared tuple into proof resolution", async () => {
  const originalOwner = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_OWNER_EMAIL = OWNER;
  const identity = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: "22222222-2222-4222-8222-222222222222",
    build_hash: "a".repeat(64),
  };
  const durable = {
    prospect_id: "prospect-admin-shared-row-only",
    business_name: "Admin Shared Row Only",
    email: CANONICAL,
    current_website: "https://current.example.test/",
    preview_url: "https://current-preview.wss-ai.com/",
    status: "line_queued",
    record: {
      build_dispatch: { build_hash: identity.build_hash },
      proof_shots: { build_hash: identity.build_hash },
    },
  };
  let resolverInput = null;
  try {
    const { defaultSend } = require("../api/admin/line");
    const send = defaultSend("sandbox", {
      select: async () => ({ ok: true, data: [durable] }),
      upsertRow: async () => ({ ok: true }),
      proofShotsForSend: async (input) => {
        resolverInput = input;
        return { shots: input.record.proof_shots, source: "stored_record", persist: false };
      },
      ensureLineReport: async () => ({ ok: true, reportUrl: SIGNAL_REPORT }),
      sendSequenceStep: async () => ({ ok: true, mode: "sent", id: "admin-shared-row-only" }),
    });
    const result = await send({
      prospectId: durable.prospect_id,
      businessName: durable.business_name,
      email: durable.email,
      previewUrl: durable.preview_url,
      buildHash: identity.build_hash,
      proofIdentity: identity,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(resolverInput.proofIdentity, identity);
  } finally {
    if (originalOwner === undefined) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = originalOwner;
  }
});

test("a preexisting durable sport-fencing hold stops automatic delivery before capture", async () => {
  const { state, deps, durable } = baseHarness();
  durable.status = "held";
  durable.record.vertical_hold = { reason: "vertical_mismatch_sport_fencing" };
  const send = createLineSender({ lane: "live", batchId: "batch-sport-held", deps });

  const result = await send(queuedRow());

  assert.equal(result.ok, false);
  assert.equal(result.reason, "vertical_mismatch_sport_fencing");
  assert.equal(state.selects.length, 1);
  assert.equal(state.captures, 0, "the canonical hold runs before proof capture");
  assert.equal(state.upserts.length, 0);
  assert.equal(state.sends.length, 0);
});

test("a sport-fencing terminal status remains a site-truth blocker for owner Practice", async () => {
  const { state, durable, deps } = baseHarness();
  durable.status = "vertical_mismatch_sport_fencing";
  const sender = createLineSender({ lane: "sandbox", batchId: "batch-sport-status", deps });

  const result = await sender.prepare(queuedRow());

  assert.equal(result.ok, false);
  assert.equal(result.reason, "vertical_mismatch_sport_fencing");
  assert.equal(result.policyHold, true);
  assert.equal(state.captures, 0);
  assert.equal(state.sends.length, 0);
});

test("a named sport-fencing reason blocks a line_queued row until reclassification clears it", async () => {
  const { state, deps, durable } = baseHarness();
  assert.equal(durable.status, "line_queued");
  durable.record.blocked_reason = "vertical_mismatch_sport_fencing";
  const send = createLineSender({ lane: "live", batchId: "batch-sport-reason", deps });

  const result = await send(queuedRow());

  assert.equal(result.ok, false);
  assert.equal(result.reason, "vertical_mismatch_sport_fencing");
  assert.equal(result.policyHold, true);
  assert.equal(result.providerAttempted, false);
  assert.equal(state.selects.length, 1);
  assert.equal(state.captures, 0, "the truth reason is checked before proof work");
  assert.equal(state.upserts.length, 0);
  assert.equal(state.sends.length, 0, "status drift cannot cross the provider boundary");
});

test("an unrelated reason does not turn a normal line_queued delivery into a sport hold", async () => {
  const { state, deps, durable } = baseHarness();
  durable.record.blocked_reason = "unrelated_review_note";
  const send = createLineSender({ lane: "live", batchId: "batch-unrelated-reason", deps });

  const result = await send(queuedRow());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.sends.length, 1);
});

test("a sport-fencing hold written during evidence work stops the provider send", async () => {
  let reads = 0;
  const { state, deps, durable } = baseHarness({
    select: async (table, query) => {
      reads += 1;
      state.selects.push({ table, query });
      if (reads === 1) return { ok: true, data: [durable] };
      return {
        ok: true,
        data: [{
          ...durable,
          status: "held",
          record: {
            ...durable.record,
            blocked_reason: "vertical_mismatch_sport_fencing",
          },
        }],
      };
    },
  });
  const send = createLineSender({ lane: "live", batchId: "batch-sport-race", deps });

  const result = await send(queuedRow());

  assert.equal(result.ok, false);
  assert.equal(result.reason, "vertical_mismatch_sport_fencing");
  assert.equal(reads, 2, "the durable hold is re-read after evidence work");
  assert.equal(state.captures, 1);
  assert.equal(state.sends.length, 0, "the second durable hold check precedes provider send");
});

test("live send fails closed for a missing or changed queued recipient fingerprint", async (t) => {
  for (const recipientFingerprint of ["", fingerprint("former@example.test")]) {
    await t.test(recipientFingerprint ? "changed" : "missing", async () => {
      const { state, deps } = baseHarness();
      const send = createLineSender({ lane: "live", batchId: "batch-1", deps });
      const result = await send(queuedRow({ recipientFingerprint }));
      assert.equal(result.ok, false);
      assert.equal(result.reason, "recipient_reapproval_required");
      assert.equal(result.reapprovalRequired, true);
      assert.equal(state.selects.length, 1, "the current canonical recipient is checked");
      assert.equal(state.sends.length, 0);
      assert.equal(state.captures, 0);
      assert.doesNotMatch(JSON.stringify(result), /@/);
    });
  }
});

test("sandbox still rehydrates canonical prospect, then forces and asserts owner-only", async () => {
  let asserted = 0;
  let verified = 0;
  const { state, deps } = baseHarness({
    verifyActiveRelease: async (input) => {
      verified += 1;
      return exactPublicRelease(input);
    },
    assertOwnerOnly: (prospect, owner) => {
      asserted += 1;
      return prospect.email === owner && prospect.ownerEmail === owner && prospect.owner_email === owner;
    },
  });
  const send = createLineSender({ lane: "sandbox", batchId: "batch-proof", deps });
  const result = await send(queuedRow({ recipientFingerprint: fingerprint("old@example.test") }));

  assert.equal(result.ok, true, `${JSON.stringify(result)} verifier=${verified}`);
  assert.equal(verified, 1);
  assert.equal(state.selects.length, 4);
  assert.equal(asserted, 1);
  assert.equal(state.sends.length, 1);
  const input = state.sends[0];
  assert.equal(input.prospect.email, OWNER);
  assert.equal(input.prospect.ownerEmail, OWNER);
  assert.equal(input.prospect.owner_email, OWNER);
  assert.equal(input.internalOwnerProof, true);
  assert.equal(input.allowReviewHoldBypass, true);
  assert.equal(input.allowDeliveryPauseBypass, true);
  assert.equal(input.allowContactHoldBypass, true);
  assert.equal(input.requireSignalReportInEmail, true);
  assert.equal(input.bcc, undefined);
  assert.equal(input.idempotencyKey, lineDeliveryIdempotencyKey({
    batchId: "batch-proof",
    prospectId: "prospect-1",
    sequence: 1,
    step: 1,
  }));
  assert.doesNotMatch(JSON.stringify(result), /@/);
});

test("only owner-Practice delivery prefers the immutable zero-scan Signal path", async () => {
  for (const lane of ["sandbox", "live"]) {
    let reportOptions = null;
    const { state, deps } = baseHarness({
      ensureLineReport: async (_prospect, options) => {
        reportOptions = options;
        return { ok: true, reportUrl: SIGNAL_REPORT };
      },
    });
    const send = createLineSender({ lane, batchId: `batch-report-mode-${lane}`, deps });

    // eslint-disable-next-line no-await-in-loop
    const result = await send(queuedRow());

    assert.equal(result.ok, true, `${lane}: ${JSON.stringify(result)}`);
    assert.equal(reportOptions.preferImmutablePacket, lane === "sandbox", lane);
    assert.equal(state.sends.length, 1, lane);
  }
});

test("an ambiguous Practice Signal save halts for reconciliation before email/provider work", async () => {
  let reportCalls = 0;
  const { state, deps } = baseHarness({
    ensureLineReport: async (_prospect, options) => {
      reportCalls += 1;
      assert.equal(options.preferImmutablePacket, true);
      return {
        ok: false,
        reportUrl: "",
        mode: "immutable_packet",
        ambiguousSave: true,
        reconciliationRequired: true,
      };
    },
  });
  const send = createLineSender({ lane: "sandbox", batchId: "batch-signal-ambiguous", deps });

  const result = await send(queuedRow());

  assert.equal(result.ok, false);
  assert.equal(result.reason, "owner_proof_signal_report_save_reconciliation_required");
  assert.equal(result.manualReconciliationRequired, true);
  assert.equal(result.providerAttempted, false);
  assert.equal(reportCalls, 1);
  assert.equal(state.sends.length, 0);
});

test("Practice persists a created Signal URL after a late first GET and reuses it without a duplicate POST", async () => {
  const createdUrl = "https://callprep.wss-ai.com/report/7f861376-5304-4f47-9d63-1129af8dfe24";
  let postCalls = 0;
  let getOnlyCalls = 0;
  let providerCalls = 0;
  const { state, durable, deps } = baseHarness({
    proofShotsForSend: async ({ record }) => ({
      shots: record.proof_shots,
      source: "stored_record",
      persist: false,
    }),
    ensureLineReport: async (prospect, options) => {
      assert.equal(options.preferImmutablePacket, true);
      if (prospect.record.report_url === createdUrl) {
        getOnlyCalls += 1;
        return { ok: true, reportUrl: createdUrl, mode: "existing" };
      }
      postCalls += 1;
      return {
        ok: false,
        reportUrl: createdUrl,
        persistReportUrl: createdUrl,
        reason: "created_report_availability_unknown",
        retryable: true,
        retryableBeforeProvider: true,
        ambiguousSave: true,
        reconciliationRequired: true,
      };
    },
    clientReferenceCode: () => "",
    sendSequenceStep: async () => {
      providerCalls += 1;
      return { ok: true, mode: "sent", id: "must-not-run-during-prepare" };
    },
  });
  delete durable.report_url;
  delete durable.record.report_url;
  const sender = createLineSender({ lane: "sandbox", batchId: "batch-signal-late-get", deps });
  const row = queuedRow();

  const first = await sender.prepare(row, { deadlineAt: Date.now() + 120_000 });

  assert.equal(first.ok, false);
  assert.equal(first.reason, "owner_proof_signal_report_save_reconciliation_required");
  assert.equal(first.retryableBeforeProvider, true);
  assert.equal(first.providerAttempted, false);
  assert.equal(first.inputFingerprint, undefined);
  assert.equal(postCalls, 1);
  assert.equal(getOnlyCalls, 0);
  assert.equal(providerCalls, 0);
  assert.equal(state.sends.length, 0);
  assert.equal(state.upserts.length, 1, "the canonical created UUID is durably written once");
  assert.equal(state.upserts[0].row.report_url, createdUrl);
  assert.equal(state.upserts[0].row.record.report_url, createdUrl);
  assert.equal(state.upserts[0].row.record.client_id, undefined);
  assert.deepEqual(state.upserts[0].row.record.proof_shots, durable.record.proof_shots);

  const second = await sender.prepare(row, { deadlineAt: Date.now() + 120_000 });

  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(durable.report_url, createdUrl);
  assert.equal(durable.record.report_url, createdUrl);
  assert.equal(postCalls, 1, "the persisted URL forces GET-only reuse; no duplicate create POST");
  assert.equal(getOnlyCalls, 1);
  assert.equal(state.upserts.length, 1, "the already-persisted URL is not rewritten");
  assert.equal(providerCalls, 0, "both calls are dry prepare only");
  assert.equal(state.sends.length, 0);
});

test("Practice uses only the exact identity-verified Signal URL returned for this packet", async () => {
  const { state, durable, deps } = baseHarness({
    ensureLineReport: async () => ({ ok: true, reportUrl: SIGNAL_REPORT }),
    verifyActiveRelease: exactPublicRelease,
  });
  durable.record.report_url = "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc";
  durable.report_url = "https://wss-ai.com/report/3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44";
  const send = createLineSender({ lane: "sandbox", batchId: "batch-signal-preference", deps });

  const result = await send(queuedRow());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.sends.length, 1);
  assert.equal(state.sends[0].prospect.report_url, SIGNAL_REPORT);
  assert.equal(state.sends[0].prospect.record.report_url, SIGNAL_REPORT);
});

test("automatic Practice refuses a legacy row with no complete shared release before capture or verifier", async () => {
  let verifyCalls = 0;
  const { state, durable, deps } = baseHarness({
    verifyActiveRelease: async () => {
      verifyCalls += 1;
      return { ok: true };
    },
  });
  durable.preview_url = "https://legacy-preview.wss-ai.com/";
  durable.record = {
    build_dispatch: { build_hash: "legacy-build" },
    proof_shots: {
      build_hash: "legacy-build",
      old_desktop: "https://proof.example.test/old.png",
    },
  };
  const sender = createLineSender({ lane: "sandbox", batchId: "batch-legacy-practice", deps });

  const result = await sender.prepare(queuedRow({
    previewUrl: durable.preview_url,
    buildHash: "legacy-build",
    proofIdentity: undefined,
    releaseEvidence: undefined,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "owner_proof_public_release_unavailable");
  assert.equal(result.retryableBeforeProvider, true);
  assert.equal(result.releaseFailureKind, "identity_invalid");
  assert.equal(result.providerAttempted, false);
  assert.equal(result.policyHold, undefined);
  assert.equal(verifyCalls, 0, "an incomplete tuple cannot be sent to the public verifier");
  assert.equal(state.captures, 0);
  assert.equal(state.upserts.length, 0);
  assert.equal(state.sends.length, 0);
});

test("automatic Practice prepare verifies the exact active public shared release before a provider checkpoint", async () => {
  const order = [];
  const releaseEvidence = sharedReleaseEvidence();
  const { state, durable, deps } = baseHarness({
    proofShotsForSend: async ({ record, proofIdentity }) => {
      order.push("proof");
      assert.deepEqual(proofIdentity, SHARED_PROOF_IDENTITY);
      return {
        shots: { ...record.proof_shots, ...proofIdentity },
        source: "stored_record",
        persist: false,
      };
    },
    ensureLineReport: async () => {
      order.push("report");
      return { ok: true, reportUrl: SIGNAL_REPORT };
    },
    verifyActiveRelease: async (input) => {
      order.push("verify");
      assert.deepEqual(input.proofIdentity, SHARED_PROOF_IDENTITY);
      assert.equal(input.releaseEvidence, releaseEvidence.sharedReleaseEvidence);
      assert.equal(input.previewUrl, SHARED_PREVIEW);
      assert.ok(input.deadlineAt > Date.now());
      assert.ok(input.deadlineAt <= Date.now() + 60_000);
      return exactPublicRelease(input);
    },
    sendSequenceStep: async (input) => {
      order.push("provider");
      state.sends.push(input);
      return { ok: true, mode: "sent", id: "shared-owner-proof" };
    },
  });
  durable.preview_url = SHARED_PREVIEW;
  durable.record = {
    ...durable.record,
    preview_url: SHARED_PREVIEW,
    build_dispatch: { build_hash: SHARED_BUILD_HASH, release_evidence: releaseEvidence },
    proof_shots: {
      build_hash: SHARED_BUILD_HASH,
      old_captured_url: durable.current_website,
      old_shot_sha: "b".repeat(64),
      new_captured_url: SHARED_PREVIEW,
      new_shot_sha: "c".repeat(64),
    },
  };
  const sender = createLineSender({ lane: "sandbox", batchId: "batch-active-shared", deps });
  const row = queuedRow({
    previewUrl: SHARED_PREVIEW,
    buildHash: SHARED_BUILD_HASH,
    releaseEvidence,
  });

  const plan = await sender.prepare(row, { deadlineAt: Date.now() + 120_000 });

  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.deepEqual(order, ["proof", "report", "verify"]);
  assert.equal(state.sends.length, 0, "prepare is the dry, pre-claim boundary");

  const result = await sender.deliver(plan, { expectedInputFingerprint: plan.inputFingerprint });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(order, ["proof", "report", "verify", "provider"]);
  assert.equal(state.sends.length, 1);
});

// ---------------------------------------------------------------------------
// THE DURABLE RECORD'S SIGNED RELEASE AS A SENDER SOURCE (2026-09-01).
//
// Production proved rows can reach queued with NONE of their own proof fields:
// record.proof_shots and the row's captured payload ride the gate-tick
// writePreviewUrl patch, which dies on preview_url_write_conflict (CAS) for
// rows drained after a halt. The SIGNED release evidence still exists —
// mirrorRecordPatch persisted it on the prospect at BUILD time
// (record.build_dispatch.release_evidence + record.mirror_release_evidence).
// The sender must read that source; every test below feeds it through the
// same deliveryProofIdentity reconciliation and the same public verifier.
// ---------------------------------------------------------------------------

const MIRROR_EVIDENCE_KEY = "wss-mirror-release-evidence-test-key-v1-only";

function signedSharedRelease({
  buildHash = SHARED_BUILD_HASH,
  previewUrl = SHARED_PREVIEW,
  canonicalHost = "practice-proof.wss-ai.com",
  releaseId = SHARED_RELEASE_ID,
} = {}) {
  const manifest = {
    ok: true,
    dry_run: false,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: buildHash,
    preview_url: previewUrl,
    shared_publish: true,
    proofIdentity: {
      site_id: SHARED_SITE_ID,
      release_id: releaseId,
      build_hash: buildHash,
    },
    sharedReleaseEvidence: {
      evidence_schema: "shared-site-release-evidence-v1",
      state: "active",
      site_id: SHARED_SITE_ID,
      release_id: releaseId,
      build_hash: buildHash,
      canonical_host: canonicalHost,
    },
    revealable: true,
  };
  manifest.evidence_sha = signEvidence(manifest, { key: MIRROR_EVIDENCE_KEY });
  return manifest;
}

/**
 * The durable prospect record exactly as the passing gate's real write path
 * persists it: signed manifest -> nativeMirrorBuildEvidence -> mirrorRecordPatch.
 * This pins that recordOf(claimed row) carries build_dispatch for gate_passed
 * rows — the persistedMirrorEvidenceMatches contract.
 */
function durableRecordFromWritePath(manifest, { previewUrl = SHARED_PREVIEW } = {}) {
  assert.equal(verifyEvidence(manifest, { key: MIRROR_EVIDENCE_KEY }), true);
  const nativeBuild = nativeMirrorBuildEvidence({
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: manifest.evidence_sha,
    build_hash: manifest.build_hash,
    releaseEvidence: manifest,
  }, previewUrl);
  assert.equal(nativeBuild.native, true);
  assert.ok(nativeBuild.evidence, "the signed manifest must survive the build gate");
  const patch = mirrorRecordPatch({
    prospect_id: "prospect-1",
    status: "line_gate_passed",
    preview_url: previewUrl,
    record: {},
  }, previewUrl, { operationKey: "op-sender-evidence-source" }, nativeBuild.evidence);
  return patch.record;
}

/** The production 2026-09-01 row shape: queued, live preview, no proof fields. */
function drainedRow() {
  return queuedRow({
    previewUrl: SHARED_PREVIEW,
    buildHash: SHARED_BUILD_HASH,
    proofIdentity: undefined,
    releaseEvidence: undefined,
    proof_shots: undefined,
    captured: undefined,
  });
}

test("the write path persists the signed release on the record for gate_passed rows", () => {
  const manifest = signedSharedRelease();
  const gateRecord = durableRecordFromWritePath(manifest);
  assert.equal(gateRecord.status, "line_gate_passed");
  assert.equal(gateRecord.preview_url, SHARED_PREVIEW);
  assert.ok(gateRecord.build_dispatch, "recordOf(claimed row) carries build_dispatch");
  assert.equal(gateRecord.build_dispatch.ready, true);
  assert.equal(gateRecord.build_dispatch.qc_passed, true);
  assert.equal(gateRecord.build_dispatch.visual_qc_passed, true);
  assert.deepEqual(gateRecord.mirror_release_evidence, gateRecord.build_dispatch.release_evidence,
    "both signed copies agree exactly, as persistedMirrorEvidenceMatches demands");
  assert.equal(gateRecord.build_dispatch.release_evidence.evidence_sha, manifest.evidence_sha);
  assert.equal(gateRecord.build_dispatch.release_evidence.proofIdentity.build_hash, SHARED_BUILD_HASH);
});

test("a drained row with no proof fields sends from the durable record's signed release", async () => {
  const signedRelease = signedSharedRelease();
  const gateRecord = durableRecordFromWritePath(signedRelease);
  assert.equal(Object.hasOwn(gateRecord, "proof_shots"), false,
    "the fixture mirrors production: no record.proof_shots on these rows");

  let verifyInput = null;
  const { state, durable, deps } = baseHarness({
    proofShotsForSend: async ({ proofIdentity }) => ({
      shots: {
        ...proofIdentity,
        old_captured_url: "https://current.example.test/",
        old_shot_sha: "1".repeat(64),
        new_captured_url: SHARED_PREVIEW,
        new_shot_sha: "2".repeat(64),
      },
      source: "stored_record",
      persist: false,
    }),
    verifyActiveRelease: async (input) => {
      verifyInput = input;
      return exactPublicRelease(input);
    },
    sendSequenceStep: async (input) => {
      if (input.requireOwnerPracticeActiveRelease === true
        && typeof input.verifyOwnerPracticeActiveRelease === "function"
        && await input.verifyOwnerPracticeActiveRelease() !== true) {
        return {
          ok: false,
          mode: "send_blocked",
          blocked: "owner_proof_public_release_unavailable",
          releaseFailureKind: "transient",
          retryableBeforeProvider: true,
          providerAttempted: false,
        };
      }
      state.sends.push(input);
      return { ok: true, mode: "sent", id: "drained-signed-record" };
    },
  });
  durable.preview_url = SHARED_PREVIEW;
  durable.record = gateRecord;

  const send = createLineSender({ lane: "sandbox", batchId: "batch-drained-signed", deps });
  const result = await send(drainedRow(), { deadlineAt: Date.now() + 120_000 });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.providerReceipt, "drained-signed-record");
  assert.equal(state.sends.length, 1);
  assert.equal(state.sends[0].internalOwnerProof, true);
  assert.equal(state.sends[0].prospect.email, OWNER, "Practice still routes to the owner only");
  assert.equal(state.sends[0].prospect.record.report_url, SIGNAL_REPORT);
  assert.deepEqual(verifyInput.proofIdentity, SHARED_PROOF_IDENTITY,
    "the record's signed identity is what the public verifier re-proves");
  assert.equal(verifyInput.releaseEvidence, signedRelease.sharedReleaseEvidence);
  assert.equal(verifyInput.previewUrl, SHARED_PREVIEW);
});

test("the same drained row without any signed release evidence still refuses", async () => {
  let verifyCalls = 0;
  const { state, durable, deps } = baseHarness({
    verifyActiveRelease: async (input) => {
      verifyCalls += 1;
      return exactPublicRelease(input);
    },
  });
  durable.preview_url = SHARED_PREVIEW;
  durable.record = {
    status: "line_gate_passed",
    preview_url: SHARED_PREVIEW,
    build_dispatch: { build_hash: SHARED_BUILD_HASH },
  };

  const send = createLineSender({ lane: "sandbox", batchId: "batch-drained-unsigned", deps });
  const result = await send(drainedRow(), { deadlineAt: Date.now() + 120_000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "owner_proof_public_release_unavailable");
  assert.equal(result.releaseFailureKind, "identity_invalid");
  assert.equal(result.retryableBeforeProvider, true);
  assert.equal(result.providerAttempted, false);
  assert.equal(verifyCalls, 0, "an unsigned record mints nothing to verify publicly");
  assert.equal(state.sends.length, 0);
  assert.equal(state.upserts.length, 0);
});

test("a durable record whose signed sources disagree still refuses — no source outranks reconciliation", async () => {
  const signedRelease = signedSharedRelease();
  const gateRecord = durableRecordFromWritePath(signedRelease);
  gateRecord.mirror_release_evidence = signedSharedRelease({
    releaseId: "33333333-3333-4333-8333-333333333333",
  });

  let verifyCalls = 0;
  const { state, durable, deps } = baseHarness({
    verifyActiveRelease: async (input) => {
      verifyCalls += 1;
      return exactPublicRelease(input);
    },
  });
  durable.preview_url = SHARED_PREVIEW;
  durable.record = gateRecord;

  const send = createLineSender({ lane: "sandbox", batchId: "batch-drained-conflict", deps });
  const result = await send(drainedRow(), { deadlineAt: Date.now() + 120_000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "owner_proof_public_release_unavailable");
  assert.equal(result.releaseFailureKind, "identity_invalid");
  assert.equal(result.providerAttempted, false);
  assert.equal(verifyCalls, 0, "conflicting signed sources are never reconciled by force");
  assert.equal(state.sends.length, 0);
});

test("automatic website-less Practice sends an after-only owner proof while Live keeps the comparison gate", async () => {
  const certificationKey = "test-only-domainless-intake-genie-certification-key";
  const mirrorEvidenceKey = "wss-mirror-release-evidence-test-key-v1-only";
  const sourceUrl = "https://google.com/maps/place/domainless+plumbing";
  const prospectId = "domainless-practice-1";
  const businessName = "Domainless Plumbing";
  const requestId = "ghost:domainless-practice-1:line-genie-certified-v7";
  const certifiedAt = "2026-08-29T10:00:00.000Z";
  const contentFiles = {
    "content/home.md": "# Domainless Plumbing\n\nSource-backed plumbing help for customers in Fresno.",
    "content/services/drain-cleaning.md": "# Drain Cleaning\n\nAsk Domainless Plumbing about drain cleaning in Fresno.",
  };
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: "genie-job-domainless-1",
    request_id: requestId,
    facts: {
      name: businessName,
      city: "Fresno",
      state: "CA",
      category: "plumbing",
      services: ["Drain Cleaning"],
    },
    evidence: [
      { field: "name", value: businessName, source_url: sourceUrl },
      { field: "services", value: "Drain Cleaning", source_url: sourceUrl },
    ],
    content: {
      content_contract: {
        schema: "CertifiedPracticePacket/v1",
        kind: "certified_practice_packet",
        version: 1,
        facts: { category: "plumbing" },
        assets: {},
        builder_instructions: { public: false },
        visitor_copy: {
          kind: "visitor_copy",
          files: contentFiles,
          file_hashes: Object.fromEntries(Object.entries(contentFiles).map(([name, body]) => [
            name,
            createHash("sha256").update(body).digest("hex"),
          ])),
          safety: { pass: true, violations: [] },
        },
      },
    },
  };
  const certifiedProspect = {
    prospect_id: prospectId,
    business_name: businessName,
    city: "Fresno",
    state: "CA",
    place_id: "ChIJ-domainless-practice-1",
    gbp_url: sourceUrl,
    current_website: "",
    website: "",
    industry: "plumbing",
    record: {
      truth_packet_source: "leadminer_mirror_ready",
      leadminer_mirror_ready: { gbp_url: sourceUrl },
    },
  };
  const certificationOptions = {
    signingKey: certificationKey,
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId,
    jobId: packet.job_id,
    idempotencyKey: requestId,
    requestSources: { gbp_url: sourceUrl },
    certifiedAt,
  };
  const certified = createContentCertification(packet, certifiedProspect, certificationOptions);
  assert.equal(certified.ok, true, JSON.stringify(certified));
  assert.equal(certified.receipt.identity.canonical_domain, "");
  assert.equal(verifyContentCertification(certified.receipt, packet, certifiedProspect, {
    signingKey: certificationKey,
    requestSources: { gbp_url: sourceUrl },
    idempotencyKey: requestId,
    nowMs: Date.parse("2026-08-30T10:00:00.000Z"),
  }).ok, true, "the domainless compiler receipt is genuinely signed and exact-packet bound");

  const shared = sharedReleaseEvidence();
  const signedRelease = {
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    revealable: true,
    build_hash: SHARED_BUILD_HASH,
    preview_url: SHARED_PREVIEW,
    proofIdentity: { ...SHARED_PROOF_IDENTITY },
    sharedReleaseEvidence: shared.sharedReleaseEvidence,
  };
  signedRelease.evidence_sha = signEvidence(signedRelease, { key: mirrorEvidenceKey });
  assert.equal(verifyEvidence(signedRelease, { key: mirrorEvidenceKey }), true);

  function domainlessHarness(lane) {
    let captureCalls = 0;
    let verifierCalls = 0;
    let providerBoundaryCalls = 0;
    const acceptedOwnerSends = [];
    const { state, durable, deps } = baseHarness({
      proofShotsForSend,
      ensureLineProofShots: async (input) => {
        captureCalls += 1;
        assert.equal(input.currentWebsite, "", "no fictitious before URL is passed to capture");
        assert.deepEqual(input.proofIdentity, SHARED_PROOF_IDENTITY);
        return {
          ok: true,
          reason: "",
          shots: {
            ...SHARED_PROOF_IDENTITY,
            new_captured_url: "https://proof.wss-ai.com/domainless-after.webp",
            new_shot_sha: "d".repeat(64),
          },
          results: [{ variant: "new", ok: true }],
        };
      },
      ensureLineReport: async (prospect) => {
        assert.equal(prospect.current_website, "");
        assert.equal(prospect.record.genie_content_certification.signature, certified.receipt.signature);
        return { ok: true, reportUrl: SIGNAL_REPORT };
      },
      verifyActiveRelease: async (input) => {
        verifierCalls += 1;
        assert.deepEqual(input.proofIdentity, SHARED_PROOF_IDENTITY);
        assert.equal(input.releaseEvidence, signedRelease.sharedReleaseEvidence);
        return exactPublicRelease(input);
      },
      clientReferenceCode: () => "",
      sendSequenceStep: async (input) => {
        providerBoundaryCalls += 1;
        const shots = input.prospect.proof_shots;
        assert.equal(shots.old_captured_url, undefined);
        assert.equal(shots.old_shot_sha, undefined);
        assert.equal(shots.before_refused, undefined);
        const usable = automaticProofShotRecord(
          { ok: true, shots, results: [] },
          { currentWebsite: input.internalOwnerProof === true ? "" : null },
        );
        if (!usable) {
          return {
            ok: false,
            mode: "send_blocked",
            blocked: "no_before_after_visuals",
            providerAttempted: false,
          };
        }
        acceptedOwnerSends.push(input);
        state.sends.push(input);
        return { ok: true, mode: "sent", id: "website-less-owner-proof" };
      },
    });
    durable.prospect_id = prospectId;
    durable.business_name = businessName;
    durable.city = certifiedProspect.city;
    durable.state = certifiedProspect.state;
    durable.place_id = certifiedProspect.place_id;
    durable.gbp_url = sourceUrl;
    durable.current_website = "";
    durable.website = "";
    durable.industry = "plumbing";
    durable.record = {
      genie_canonical_packet: packet,
      genie_content_certification: certified.receipt,
      current_website: "",
      website: "",
      place_id: certifiedProspect.place_id,
      gbp_url: sourceUrl,
      build_dispatch: { build_hash: SHARED_BUILD_HASH, release_evidence: signedRelease },
    };
    const row = queuedRow({
      prospectId,
      businessName,
      previewUrl: SHARED_PREVIEW,
      buildHash: SHARED_BUILD_HASH,
      proofIdentity: SHARED_PROOF_IDENTITY,
      releaseEvidence: signedRelease,
      recipientFingerprint: fingerprint(durable.email),
    });
    const sender = createLineSender({ lane, batchId: `batch-domainless-${lane}`, deps });
    return {
      sender,
      row,
      state,
      get captureCalls() { return captureCalls; },
      get verifierCalls() { return verifierCalls; },
      get providerBoundaryCalls() { return providerBoundaryCalls; },
      acceptedOwnerSends,
    };
  }

  const practice = domainlessHarness("sandbox");
  const practicePlan = await practice.sender.prepare(practice.row, { deadlineAt: Date.now() + 120_000 });
  assert.equal(practicePlan.ok, true, JSON.stringify(practicePlan));
  const practiceResult = await practice.sender.deliver(practicePlan, {
    expectedInputFingerprint: practicePlan.inputFingerprint,
  });
  assert.equal(practiceResult.ok, true, JSON.stringify(practiceResult));
  assert.equal(practice.captureCalls, 1);
  assert.equal(practice.verifierCalls, 1);
  assert.equal(practice.providerBoundaryCalls, 1);
  assert.equal(practice.acceptedOwnerSends.length, 1);
  assert.equal(practice.acceptedOwnerSends[0].prospect.email, OWNER);
  assert.equal(practice.acceptedOwnerSends[0].internalOwnerProof, true);
  assert.equal(practice.state.sends.length, 1);

  const live = domainlessHarness("live");
  const livePlan = await live.sender.prepare(live.row, { deadlineAt: Date.now() + 120_000 });
  assert.equal(livePlan.ok, true, JSON.stringify(livePlan));
  const liveResult = await live.sender.deliver(livePlan, {
    expectedInputFingerprint: livePlan.inputFingerprint,
  });
  assert.equal(liveResult.ok, false);
  assert.equal(liveResult.reason, "no_before_after_visuals");
  assert.equal(liveResult.providerAttempted, false);
  assert.equal(live.captureCalls, 1);
  assert.equal(live.verifierCalls, 0, "the active-release verifier remains Practice-only");
  assert.equal(live.providerBoundaryCalls, 1);
  assert.equal(live.acceptedOwnerSends.length, 0);
  assert.equal(live.state.sends.length, 0);
});

test("Live delivery never invokes the owner-Practice public-release verifier", async () => {
  const releaseEvidence = sharedReleaseEvidence();
  let verifyCalls = 0;
  const { state, durable, deps } = baseHarness({
    proofShotsForSend: async ({ record }) => ({
      shots: record.proof_shots,
      source: "stored_record",
      persist: false,
    }),
    verifyActiveRelease: async () => {
      verifyCalls += 1;
      throw new Error("Practice-only verifier reached Live");
    },
  });
  durable.preview_url = SHARED_PREVIEW;
  durable.record = {
    ...durable.record,
    preview_url: SHARED_PREVIEW,
    build_dispatch: { build_hash: SHARED_BUILD_HASH, release_evidence: releaseEvidence },
    proof_shots: {
      ...SHARED_PROOF_IDENTITY,
      old_captured_url: durable.current_website,
      old_shot_sha: "b".repeat(64),
      new_captured_url: SHARED_PREVIEW,
      new_shot_sha: "c".repeat(64),
    },
  };
  const sender = createLineSender({ lane: "live", batchId: "batch-live-shared", deps });

  const result = await sender(queuedRow({
    previewUrl: SHARED_PREVIEW,
    buildHash: SHARED_BUILD_HASH,
    proofIdentity: SHARED_PROOF_IDENTITY,
    releaseEvidence,
  }), { deadlineAt: Date.now() + 120_000 });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(verifyCalls, 0);
  assert.equal(state.sends.length, 1);
});

test("automatic Practice dry prepare parks stale or mismatched public shared releases without fallback", async (t) => {
  const cases = [
    {
      name: "stale active release",
      verify: async () => ({ ok: false, reason: "shared_release_not_current_active" }),
    },
    {
      name: "reassigned release receipt",
      verify: async (input) => ({
        ...exactPublicRelease(input),
        releaseId: "33333333-3333-4333-8333-333333333333",
      }),
    },
    {
      name: "mismatched public URL receipt",
      verify: async (input) => ({
        ...exactPublicRelease(input),
        previewUrl: "https://other-proof.wss-ai.com/",
      }),
    },
    {
      name: "mismatched site receipt",
      verify: async (input) => ({
        ...exactPublicRelease(input),
        siteId: "44444444-4444-4444-8444-444444444444",
      }),
    },
    {
      name: "mismatched build receipt",
      verify: async (input) => ({
        ...exactPublicRelease(input),
        buildHash: "f".repeat(64),
      }),
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const releaseEvidence = sharedReleaseEvidence();
      let providerCalls = 0;
      let verifyCalls = 0;
      const { state, durable, deps } = baseHarness({
        proofShotsForSend: async ({ record }) => ({
          shots: record.proof_shots,
          source: "stored_record",
          persist: false,
        }),
        verifyActiveRelease: async (input) => {
          verifyCalls += 1;
          return item.verify(input);
        },
        sendSequenceStep: async () => {
          providerCalls += 1;
          return { ok: true, mode: "sent", id: "must-not-send" };
        },
      });
      durable.preview_url = SHARED_PREVIEW;
      durable.record = {
        ...durable.record,
        preview_url: SHARED_PREVIEW,
        report_url: SIGNAL_REPORT,
        build_dispatch: { build_hash: SHARED_BUILD_HASH, release_evidence: releaseEvidence },
        proof_shots: {
          ...SHARED_PROOF_IDENTITY,
          old_captured_url: durable.current_website,
          old_shot_sha: "d".repeat(64),
          new_captured_url: SHARED_PREVIEW,
          new_shot_sha: "e".repeat(64),
        },
      };
      const sender = createLineSender({ lane: "sandbox", batchId: `batch-public-${item.name}`, deps });

      const plan = await sender.prepare(queuedRow({
        previewUrl: SHARED_PREVIEW,
        buildHash: SHARED_BUILD_HASH,
        proofIdentity: SHARED_PROOF_IDENTITY,
        releaseEvidence,
      }), { deadlineAt: Date.now() + 120_000 });

      assert.equal(plan.ok, false);
      assert.equal(plan.reason, "owner_proof_public_release_unavailable");
      assert.equal(plan.retryableBeforeProvider, true);
      assert.equal(plan.releaseFailureKind, "transient");
      assert.equal(plan.providerAttempted, false);
      assert.equal(plan.policyHold, undefined);
      assert.equal(verifyCalls, 1);
      assert.equal(providerCalls, 0);
      assert.equal(state.sends.length, 0);
    });
  }
});

test("Practice stops before the email/provider boundary when no exact verified Signal is returned", async (t) => {
  for (const item of [
    { name: "null", output: null },
    { name: "missing", output: { ok: false, reportUrl: "" } },
    { name: "unsafe", output: { ok: true, reportUrl: "https://callprep.wss-ai.com/report/current-business" } },
  ]) {
    await t.test(item.name, async () => {
      const { state, durable, deps } = baseHarness({
        ensureLineReport: async () => item.output,
      });
      durable.record.report_url = SIGNAL_REPORT;
      durable.report_url = SIGNAL_REPORT;
      const send = createLineSender({ lane: "sandbox", batchId: `batch-signal-${item.name}`, deps });

      const result = await send(queuedRow());

      assert.equal(result.ok, false);
      assert.equal(result.reason, "owner_proof_signal_report_unavailable");
      assert.equal(result.retryableBeforeProvider, true);
      assert.equal(result.policyHold, undefined);
      assert.equal(result.providerAttempted, false);
      assert.equal(state.sends.length, 0, "stale durable URLs cannot reach email or the provider");
      assert.equal(durable.status, "line_queued", "the finished build stays resumable");
    });
  }

  await t.test("live", async () => {
    const { state, deps } = baseHarness({
      ensureLineReport: async () => ({ ok: false, reportUrl: "" }),
    });
    const send = createLineSender({ lane: "live", batchId: "batch-signal-live", deps });

    const result = await send(queuedRow());

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(state.sends.length, 1);
    assert.equal(state.sends[0].requireSignalReportInEmail, undefined);
    assert.equal(state.sends[0].prospect.report_url, undefined);
    assert.equal(state.sends[0].prospect.record.report_url, undefined);
  });
});

test("sandbox owner proof works with no prospect email while live remains held", async () => {
  const { state, durable, deps } = baseHarness();
  durable.email = "";
  durable.record.contactReady = false;
  durable.record.contact_hold_reason = "no_contact_evidence";

  const sandbox = createLineSender({ lane: "sandbox", batchId: "batch-no-contact-proof", deps });
  const sandboxResult = await sandbox(queuedRow({ recipientFingerprint: "", email: "" }));
  assert.equal(sandboxResult.ok, true, JSON.stringify(sandboxResult));
  assert.equal(state.sends.length, 1);
  assert.equal(state.sends[0].prospect.email, OWNER);
  assert.equal(state.sends[0].internalOwnerProof, true);

  state.sends.length = 0;
  const live = createLineSender({ lane: "live", batchId: "batch-no-contact-live", deps });
  const liveResult = await live(queuedRow({ recipientFingerprint: "", email: "" }));
  assert.equal(liveResult.ok, false);
  assert.equal(liveResult.reason, "invalid_email");
  assert.equal(state.sends.length, 0);
});

test("sandbox owner routing ignores prospect contact locks but preserves the owner-only envelope", async (t) => {
  const cases = [
    {
      name: "top-level suppression flag",
      apply(durable) { durable.suppressed = true; },
    },
    {
      name: "do-not-contact flag",
      apply(durable) { durable.record.do_not_contact = true; },
    },
    {
      name: "terminal contact status",
      apply(durable) { durable.status = "do_not_contact"; },
    },
    {
      name: "embedded email suppression verdict",
      apply(durable) {
        durable.record.contact_enrichment = {
          outreach: {
            review_hold: true,
            hold_reasons: ["email_suppressed"],
            sendable_email: null,
          },
        };
      },
    },
    {
      name: "suppression table match",
      apply() {},
      suppressionStatus: async () => ({ known: true, suppressed: true }),
    },
    {
      name: "suppression lookup unavailable",
      apply() {},
      suppressionStatus: async () => { throw new Error("suppression unavailable"); },
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      let contactGateCalls = 0;
      const { state, durable, deps } = baseHarness({
        ...(item.suppressionStatus ? { suppressionStatus: item.suppressionStatus } : {}),
        contactSendGate: () => {
          contactGateCalls += 1;
          throw new Error("prospect contact gate must not run for owner Practice");
        },
      });
      durable.email = "";
      item.apply(durable);
      const send = createLineSender({ lane: "sandbox", batchId: `batch-${item.name}`, deps });
      const result = await send(queuedRow({ recipientFingerprint: "", email: "" }));

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(contactGateCalls, 0);
      assert.equal(state.sends.length, 1);
      assert.equal(state.sends[0].prospect.email, OWNER);
      assert.equal(state.sends[0].prospect.ownerEmail, OWNER);
      assert.equal(state.sends[0].prospect.owner_email, OWNER);
      assert.equal(state.sends[0].internalOwnerProof, true);
    });
  }
});

test("the same prospect contact locks remain fail-closed for Live delivery", async (t) => {
  const cases = [
    ["do-not-contact", (durable) => { durable.status = "do_not_contact"; }, "do_not_contact"],
    ["suppressed", (durable) => { durable.suppressed = true; }, "suppressed"],
    ["missing email", (durable) => { durable.email = ""; }, "invalid_email"],
  ];
  for (const [name, apply, reason] of cases) {
    await t.test(name, async () => {
      const { state, durable, deps } = baseHarness();
      apply(durable);
      const sender = createLineSender({ lane: "live", batchId: `live-${name}`, deps });
      const result = await sender(queuedRow());
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.equal(state.sends.length, 0);
    });
  }
});

test("sandbox refuses before provider work when owner-only assertion fails", async () => {
  const { state, deps } = baseHarness({ assertOwnerOnly: () => false });
  const send = createLineSender({ lane: "sandbox", batchId: "batch-proof", deps });
  const result = await send(queuedRow());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "owner_only_assertion_failed");
  assert.equal(state.selects.length, 3);
  assert.equal(state.sends.length, 0);
});

test("readiness and canonical fetch failures are fail-closed without PII", async (t) => {
  await t.test("readiness", async () => {
    const { state, deps } = baseHarness({
      readiness: async () => ({ ready: false, blockers: [{ code: "delivery_paused" }] }),
    });
    const send = createLineSender({ lane: "live", batchId: "batch-1", deps });
    const result = await send(queuedRow());
    assert.equal(result.reason, "delivery_paused");
    assert.equal(state.selects.length, 0);
    assert.equal(state.sends.length, 0);
  });

  await t.test("canonical recipient", async () => {
    const { state, deps } = baseHarness({ select: async () => ({ ok: true, data: [] }) });
    const send = createLineSender({ lane: "sandbox", batchId: "batch-1", deps });
    const result = await send(queuedRow());
    assert.equal(result.reason, "canonical_recipient_unavailable");
    assert.equal(state.sends.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /@/);
  });
});

test("default readiness isolates owner-only sandbox from outreach locks while live stays fail-closed", async (t) => {
  const common = {
    ownerSandboxAddress: () => OWNER,
    deliveryPauseStatus: async () => ({ active: false, known: true }),
    reviewHoldActive: () => false,
    liveSendsEnabled: true,
  };
  await t.test("unknown pause", async () => {
    const out = await currentReadiness({ lane: "live", batchId: "b" }, {
      ...common,
      deliveryPauseStatus: async () => ({ active: false, known: false }),
    });
    assert.deepEqual(out, { ready: false, reason: "delivery_pause_status_unavailable" });
  });
  await t.test("review hold", async () => {
    const out = await currentReadiness({ lane: "live", batchId: "b" }, {
      ...common,
      reviewHoldActive: () => true,
    });
    assert.deepEqual(out, { ready: false, reason: "review_hold" });
  });
  await t.test("sandbox owner proof bypasses pause and review hold without consulting either lock", async () => {
    let pauseReads = 0;
    let holdReads = 0;
    const out = await currentReadiness({ lane: "sandbox", batchId: "b" }, {
      ...common,
      deliveryPauseStatus: async () => {
        pauseReads += 1;
        return { active: true, known: true };
      },
      reviewHoldActive: () => {
        holdReads += 1;
        return true;
      },
    });
    assert.deepEqual(out, { ready: true, reason: "" });
    assert.equal(pauseReads, 0);
    assert.equal(holdReads, 0);
  });
  await t.test("sandbox owner proof still requires the configured owner", async () => {
    const out = await currentReadiness({ lane: "sandbox", batchId: "b" }, {
      ...common,
      ownerSandboxAddress: () => "",
    });
    assert.deepEqual(out, { ready: false, reason: "owner_address_unset" });
  });
  await t.test("sandbox custom readiness bypasses only pause and review blockers", async () => {
    const bypassed = await currentReadiness({ lane: "sandbox", batchId: "b" }, {
      ...common,
      readiness: async () => ({
        ready: false,
        blockers: [{ code: "delivery_paused" }, { code: "review_hold" }],
      }),
    });
    assert.deepEqual(bypassed, { ready: true, reason: "" });

    const protectedResult = await currentReadiness({ lane: "sandbox", batchId: "b" }, {
      ...common,
      readiness: async () => ({
        ready: false,
        blockers: [{ code: "delivery_paused" }, { code: "proof_resolution_refused" }],
      }),
    });
    assert.deepEqual(protectedResult, { ready: false, reason: "delivery_paused" });
  });
  await t.test("live switch", async () => {
    const out = await currentReadiness({ lane: "live", batchId: "b" }, {
      ...common,
      liveSendsEnabled: false,
    });
    assert.deepEqual(out, { ready: false, reason: "live_lane_disabled" });
  });
});

test("provider failures are reduced to safe codes", () => {
  const unsafe = safeProviderResult({ ok: false, error: "rejected current@example.test +1 (555) 111-2222" }, "key");
  assert.deepEqual(unsafe, {
    ok: false,
    reason: "delivery_refused",
    idempotencyKey: "key",
    providerAttempted: false,
    policyHold: true,
  });
  const phoneOnly = safeProviderResult({ ok: false, blocked: "15551112222" }, "key");
  assert.deepEqual(phoneOnly, {
    ok: false,
    reason: "delivery_refused",
    idempotencyKey: "key",
    providerAttempted: false,
    policyHold: true,
  });
  const safe = safeProviderResult({ ok: false, blocked: "suppressed" }, "key");
  assert.deepEqual(safe, {
    ok: false,
    reason: "suppressed",
    idempotencyKey: "key",
    providerAttempted: false,
    policyHold: true,
  });
  const dryRun = safeProviderResult({ ok: true, mode: "dry_run" }, "key");
  assert.deepEqual(dryRun, {
    ok: false,
    reason: "provider_not_sent",
    idempotencyKey: "key",
    providerAttempted: false,
    policyHold: true,
  });
  const attempted = safeProviderResult({ ok: false, mode: "send_failed", blocked: "delivery_provider_timeout" }, "key");
  assert.deepEqual(attempted, { ok: false, reason: "delivery_provider_timeout", idempotencyKey: "key" });
  const transientRelease = safeProviderResult({
    ok: false,
    blocked: "owner_proof_public_release_unavailable",
    retryableBeforeProvider: true,
    providerAttempted: false,
    releaseFailureKind: "transient",
  }, "key");
  assert.deepEqual(transientRelease, {
    ok: false,
    reason: "owner_proof_public_release_unavailable",
    idempotencyKey: "key",
    retryableBeforeProvider: true,
    providerAttempted: false,
    releaseFailureKind: "transient",
  });
  const untrustedReleaseKind = safeProviderResult({
    ok: false,
    blocked: "owner_proof_public_release_unavailable",
    retryableBeforeProvider: true,
    providerAttempted: false,
    releaseFailureKind: "identity_invalid",
  }, "key");
  assert.equal(Object.hasOwn(untrustedReleaseKind, "releaseFailureKind"), false);
  const missingReceipt = safeProviderResult({ ok: true, mode: "sent" }, "key", "2026-08-14T12:00:00Z");
  assert.deepEqual(missingReceipt, {
    ok: false,
    reason: "provider_receipt_missing",
    manualReconciliationRequired: true,
    idempotencyKey: "key",
  });
});

test("prepare is PII-free, finishes evidence, and rechecks the recipient before provider delivery", async () => {
  const timeline = [];
  const { state, deps } = baseHarness({
    select: async () => {
      timeline.push(`read:${timeline.filter((event) => event.startsWith("read:")).length + 1}`);
      return {
        ok: true,
        data: [{
          prospect_id: "prospect-1",
          business_name: "Current Business",
          email: CANONICAL,
          record: {},
        }],
      };
    },
    proofShotsForSend: async () => {
      timeline.push("evidence");
      return { shots: { new_desktop: "https://proof.example.test/new.png" }, persist: false };
    },
    ensureLineReport: async () => ({ ok: false }),
    clientReferenceCode: () => "",
    sendSequenceStep: async () => {
      timeline.push("provider");
      return { ok: true, mode: "sent", id: "re_safe_receipt" };
    },
  });
  const sender = createLineSender({ lane: "live", batchId: "batch-two-phase", deps });
  const plan = await sender.prepare(queuedRow(), { sequence: 1, step: 1, deadlineAt: Date.now() + 120_000 });

  assert.equal(plan.ok, true);
  assert.match(plan.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(plan), /@|Current Business/);
  assert.deepEqual(timeline, ["read:1", "evidence", "read:2", "read:3"]);
  assert.equal(state.sends.length, 0, "prepare cannot call the provider");

  const delivered = await sender.deliver(plan, { expectedInputFingerprint: plan.inputFingerprint });
  assert.equal(delivered.ok, true);
  assert.deepEqual(timeline, ["read:1", "evidence", "read:2", "read:3", "read:4", "provider"]);
});

test("a durable sport hold written after prepare stops deliver at the provider boundary", async () => {
  const { state, deps, durable } = baseHarness();
  const sender = createLineSender({ lane: "live", batchId: "batch-checkpoint-race", deps });
  const plan = await sender.prepare(queuedRow());
  assert.equal(plan.ok, true);
  assert.equal(state.sends.length, 0);

  durable.status = "held";
  durable.record.vertical_hold = { reason: "vertical_mismatch_sport_fencing" };
  const delivered = await sender.deliver(plan, { expectedInputFingerprint: plan.inputFingerprint });

  assert.equal(delivered.ok, false);
  assert.equal(delivered.reason, "vertical_mismatch_sport_fencing");
  assert.equal(delivered.policyHold, true);
  assert.equal(delivered.providerAttempted, false);
  assert.equal(state.selects.length, 4, "deliver performs the post-checkpoint canonical read");
  assert.equal(state.sends.length, 0, "the provider is untouched after a checkpoint-window hold");
});

test("an unavailable provider-boundary reread fails closed without a send", async () => {
  let reads = 0;
  const { state, deps, durable } = baseHarness({
    select: async () => {
      reads += 1;
      return reads < 4 ? { ok: true, data: [durable] } : { ok: false, data: [] };
    },
  });
  const sender = createLineSender({ lane: "live", batchId: "batch-boundary-read-fail", deps });
  const plan = await sender.prepare(queuedRow());
  assert.equal(plan.ok, true);

  const delivered = await sender.deliver(plan, { expectedInputFingerprint: plan.inputFingerprint });

  assert.equal(delivered.ok, false);
  assert.equal(delivered.reason, "canonical_recipient_unavailable");
  assert.equal(delivered.providerAttempted, false);
  assert.equal(reads, 4);
  assert.equal(state.sends.length, 0);
});

test("a canonical recipient TOCTOU change after evidence requires reapproval before provider work", async () => {
  let reads = 0;
  const { state, deps } = baseHarness({
    select: async () => {
      reads += 1;
      return {
        ok: true,
        data: [{
          prospect_id: "prospect-1",
          email: reads === 1 ? CANONICAL : "changed-after-evidence@example.test",
          record: {},
        }],
      };
    },
  });
  const sender = createLineSender({ lane: "live", batchId: "batch-toctou", deps });
  const result = await sender.prepare(queuedRow());

  assert.equal(result.ok, false);
  assert.equal(result.reason, "recipient_reapproval_required");
  assert.equal(result.reapprovalRequired, true);
  assert.equal(reads, 2);
  assert.equal(state.sends.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /@/);
});

test("delivery input fingerprint binds exact deterministic inputs but excludes transport time", () => {
  const first = deliveryInputFingerprint({
    lane: "live",
    batchId: "batch-fingerprint",
    input: {
      prospect: { email: "secret@example.test", business_name: "Alpha" },
      sequence: 1,
      step: 1,
      bcc: OWNER,
      deadlineAt: 1,
    },
  });
  const reordered = deliveryInputFingerprint({
    lane: "live",
    batchId: "batch-fingerprint",
    input: {
      deadlineAt: 999,
      bcc: OWNER,
      step: 1,
      sequence: 1,
      prospect: { business_name: "Alpha", email: "secret@example.test" },
    },
  });
  const changed = deliveryInputFingerprint({
    lane: "live",
    batchId: "batch-fingerprint",
    input: {
      prospect: { email: "secret@example.test", business_name: "Beta" },
      sequence: 1,
      step: 1,
      bcc: OWNER,
    },
  });

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /secret|@/);
});

test("deliver refuses a forged or mismatched prepared plan without touching the provider", async () => {
  const { state, deps } = baseHarness();
  const sender = createLineSender({ lane: "sandbox", batchId: "batch-plan", deps });
  const plan = await sender.prepare(queuedRow());
  const mismatch = await sender.deliver(plan, { expectedInputFingerprint: "f".repeat(64) });
  const forged = await sender.deliver({ ...plan }, { expectedInputFingerprint: plan.inputFingerprint });

  assert.equal(mismatch.manualReconciliationRequired, true);
  assert.equal(forged.manualReconciliationRequired, true);
  assert.equal(state.sends.length, 0);
});

test("timed-out evidence fails closed before the provider reserve", async () => {
  const never = new Promise(() => {});
  const { deps, state } = baseHarness({
    proofShotsForSend: async () => never,
  });
  const send = createLineSender({ lane: "sandbox", batchId: "line_deadline", deps });
  const started = Date.now();
  const out = await send(queuedRow(), { deadlineAt: started + 30_020 });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "proof_resolution_unavailable");
  assert.ok(Date.now() - started < 1_000, "provider reserve was consumed by evidence work");
  assert.equal(state.sends.length, 0);
  assert.equal(state.upserts.length, 0);
});
