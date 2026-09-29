"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { signEvidence } = require("../lib/mirror-engine/evidence-signature");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/mirror-engine-contract");
const {
  CLAIM_TYPE,
  acquireClaim,
  deliverOwnerProof,
  lineArtifactIdentity,
  ownerProofOperationKey,
  replayFromClaim,
} = require("../lib/owner-proof-delivery");
const { PROOF_SENT_EVENT_TYPE } = require("../lib/prospect-detail");
const { createSendMirrorProofHandler } = require("../api/admin/send-mirror-proof");

const PREVIEW = "https://owner-proof.wss-ai.com/";
const BUILD_HASH = "a".repeat(64);
const SITE_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const PROOF_IDENTITY = Object.freeze({
  site_id: SITE_ID,
  release_id: RELEASE_ID,
  build_hash: BUILD_HASH,
});
const qualityPassed = () => ({ ok: true });
const verifiedPublicRelease = async ({ proofIdentity, previewUrl }) => ({
  ok: true,
  fallback: false,
  previewUrl,
  siteId: proofIdentity.site_id,
  releaseId: proofIdentity.release_id,
  buildHash: proofIdentity.build_hash,
  generation: 1,
  routes: ["/"],
});

function releaseEvidence() {
  const evidence = {
    ok: true,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: BUILD_HASH,
    preview_url: PREVIEW,
    proofIdentity: PROOF_IDENTITY,
    sharedReleaseEvidence: {
      evidence_schema: "shared-site-release-evidence-v1",
      state: "active",
      ...PROOF_IDENTITY,
      canonical_host: "owner-proof.wss-ai.com",
    },
    checks: { render: { status: "passed" }, route_render: { status: "passed" } },
    revealable: true,
  };
  evidence.evidence_sha = signEvidence(evidence);
  return evidence;
}

function fixture() {
  const evidence = releaseEvidence();
  const dispatch = {
    mode: "mirror_engine",
    pending: false,
    ready: true,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: evidence.evidence_sha,
    build_hash: BUILD_HASH,
    qc_passed: true,
    visual_qc_passed: true,
    release_evidence: evidence,
  };
  const prospect = {
    prospect_id: "practice-owner-proof-1",
    business_name: "Owner Proof Practice",
    status: "line_queued",
    preview_url: PREVIEW,
    record: {
      status: "line_queued",
      preview_url: PREVIEW,
      build_dispatch: dispatch,
      mirror_release_evidence: evidence,
    },
  };
  const lineRow = {
    row_id: "practice-batch:0",
    batch_id: "practice-batch",
    status: "queued",
    payload: {
      prospectId: prospect.prospect_id,
      previewUrl: PREVIEW,
      buildHash: BUILD_HASH,
      proofIdentity: PROOF_IDENTITY,
      releaseEvidence: evidence,
      buildEvidence: {
        ready: true,
        pending: false,
        renderer: MIRROR_ENGINE_RENDERER,
        qc_contract: MIRROR_ENGINE_QC_CONTRACT,
        evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
        evidence_sha: evidence.evidence_sha,
        build_hash: BUILD_HASH,
        qc_passed: true,
        visual_qc_passed: true,
        release_evidence: evidence,
      },
    },
  };
  return { prospect, lineRow };
}

function memoryDeps() {
  const events = new Map();
  let providerCalls = 0;
  let tick = 0;
  return {
    events,
    get providerCalls() { return providerCalls; },
    now: () => new Date(Date.UTC(2026, 7, 29, 12, 0, tick++)),
    insertRow: async (_table, row) => {
      if (events.has(row.svix_id)) {
        return { ok: false, status: 409, error: { code: "23505", category: "write_conflict" } };
      }
      events.set(row.svix_id, structuredClone(row));
      return { ok: true, mode: "live_write" };
    },
    select: async (_table, query) => {
      const encoded = query.match(/svix_id=eq\.([^&]+)/)?.[1] || "";
      const key = decodeURIComponent(encoded);
      const row = events.get(key);
      return { ok: true, data: row ? [structuredClone(row)] : [] };
    },
    conditionalUpdate: async (_table, _idColumn, id, guards, patch) => {
      const current = events.get(id);
      if (!current
        || current.type !== guards.type.replace(/^eq\./, "")
        || current.payload.status !== guards["payload->>status"].replace(/^eq\./, "")) {
        return { ok: true, updated: false, rows: [] };
      }
      events.set(id, { ...current, ...structuredClone(patch) });
      return { ok: true, mode: "live_update", updated: true, rows: [structuredClone(events.get(id))] };
    },
    sendSequenceStep: async (input) => {
      providerCalls += 1;
      assert.match(input.idempotencyKey, /^ghost-owner-proof-[a-f0-9]{64}$/);
      return { ok: true, mode: "sent", id: "resend-owner-proof-1" };
    },
  };
}

test("only the exact signed Line release authorizes an owner proof", () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  assert.equal(identity.ok, true, JSON.stringify(identity));
  assert.equal(identity.batchId, "practice-batch");
  assert.equal(identity.buildHash, BUILD_HASH);
  assert.deepEqual(identity.proofIdentity, PROOF_IDENTITY);
  assert.equal(
    ownerProofOperationKey({ ...identity, proofIdentity: null }, "owner@example.test"),
    "",
    "the delivery primitive itself refuses an identity without deployment proof",
  );

  const stale = structuredClone(lineRow);
  stale.payload.previewUrl = "https://other.wss-ai.com/";
  assert.equal(lineArtifactIdentity(stale, prospect, qualityPassed).reason, "line_preview_identity_mismatch");

  const prospectOnly = structuredClone(lineRow);
  prospectOnly.status = "mirrored";
  assert.equal(lineArtifactIdentity(prospectOnly, prospect, qualityPassed).reason, "line_row_not_sendable");

  const legacyRelease = structuredClone(lineRow);
  delete legacyRelease.payload.proofIdentity;
  assert.equal(
    lineArtifactIdentity(legacyRelease, prospect, qualityPassed).reason,
    "line_release_evidence_invalid",
    "a signed release without a durable Line deployment tuple cannot authorize proof",
  );

  const conflictingRelease = structuredClone(lineRow);
  conflictingRelease.payload.proofIdentity.release_id = "33333333-3333-4333-8333-333333333333";
  assert.equal(
    lineArtifactIdentity(conflictingRelease, prospect, qualityPassed).reason,
    "line_release_evidence_invalid",
    "the Line tuple must match the signed manifest and shared-release receipt exactly",
  );
});

test("owner-proof operation identity binds the exact release and canonical preview URL", () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const owner = "owner@example.test";
  const original = ownerProofOperationKey(identity, owner);
  assert.match(original, /^ghost-owner-proof-[a-f0-9]{64}$/);
  assert.equal(
    ownerProofOperationKey({ ...identity, previewUrl: PREVIEW.replace(/\/$/, "") }, owner),
    original,
    "equivalent spellings of the canonical preview URL are one operation",
  );
  assert.notEqual(
    ownerProofOperationKey({
      ...identity,
      proofIdentity: {
        ...identity.proofIdentity,
        release_id: "33333333-3333-4333-8333-333333333333",
      },
    }, owner),
    original,
    "a new release at the same build hash cannot inherit the old receipt",
  );
  assert.notEqual(
    ownerProofOperationKey({ ...identity, previewUrl: "https://other-owner-proof.wss-ai.com/" }, owner),
    original,
    "a new canonical preview URL at the same build hash cannot inherit the old receipt",
  );
});

test("a non-durable claim response never crosses the provider boundary", async () => {
  for (const response of [
    { ok: true, mode: "dry_run" },
    { ok: false, mode: "live_write" },
  ]) {
    const { prospect, lineRow } = fixture();
    const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
    const deps = memoryDeps();
    deps.insertRow = async () => response;

    const blocked = await deliverOwnerProof({
      identity,
      owner: "owner@example.test",
      sendInput: { prospect, internalOwnerProof: true },
      deps,
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "owner_proof_claim_unavailable");
    assert.equal(blocked.providerAttempted, false);
    assert.equal(deps.providerCalls, 0);
  }
});

test("a stored receipt with a different release or preview identity never replays", async () => {
  for (const mutate of [
    (payload) => { payload.release_id = "33333333-3333-4333-8333-333333333333"; },
    (payload) => { payload.preview_url = "https://other-owner-proof.wss-ai.com/"; },
  ]) {
    const { prospect, lineRow } = fixture();
    const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
    const deps = memoryDeps();
    const claim = await acquireClaim(identity, "owner@example.test", deps);
    const stored = deps.events.get(claim.idempotencyKey);
    stored.type = PROOF_SENT_EVENT_TYPE;
    stored.payload.status = "sent";
    stored.payload.provider_receipt = "receipt-for-different-operation";
    mutate(stored.payload);

    const blocked = await deliverOwnerProof({
      identity,
      owner: "owner@example.test",
      sendInput: { prospect, internalOwnerProof: true },
      deps,
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "owner_proof_claim_identity_mismatch");
    assert.equal(blocked.providerAttempted, false);
    assert.equal(deps.providerCalls, 0);
  }
});

test("an unrelated event type or impossible type/status pair never replays", async () => {
  const invalidStates = [
    { type: "system.unrelated", status: "sent" },
    { type: CLAIM_TYPE, status: "sent" },
    { type: PROOF_SENT_EVENT_TYPE, status: "claimed" },
  ];
  for (const invalid of invalidStates) {
    const { prospect, lineRow } = fixture();
    const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
    const deps = memoryDeps();
    const claim = await acquireClaim(identity, "owner@example.test", deps);
    const stored = deps.events.get(claim.idempotencyKey);
    stored.type = invalid.type;
    stored.payload.status = invalid.status;
    stored.payload.provider_receipt = "unrelated-receipt";

    const blocked = await deliverOwnerProof({
      identity,
      owner: "owner@example.test",
      sendInput: { prospect, internalOwnerProof: true },
      deps,
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "owner_proof_claim_type_status_mismatch");
    assert.equal(blocked.providerAttempted, false);
    assert.equal(deps.providerCalls, 0);
  }
});

test("the low-level replay helper refuses a receipt without its expected operation identity", async () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const deps = memoryDeps();
  const claim = await acquireClaim(identity, "owner@example.test", deps);
  const stored = deps.events.get(claim.idempotencyKey);
  stored.type = PROOF_SENT_EVENT_TYPE;
  stored.payload.status = "sent";
  stored.payload.provider_receipt = "unbound-receipt";

  assert.equal(replayFromClaim(stored, claim.idempotencyKey, deps.now()), null);
});

test("completed owner-proof retry returns the same receipt with zero extra provider calls", async () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const deps = memoryDeps();
  const input = { prospect, internalOwnerProof: true };

  const first = await deliverOwnerProof({
    identity,
    owner: "owner@example.test",
    sendInput: input,
    deps,
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.replay, false);
  assert.equal(deps.providerCalls, 1);
  const stored = [...deps.events.values()][0];
  assert.equal(stored.type, PROOF_SENT_EVENT_TYPE);
  assert.equal(stored.payload.status, "sent");
  assert.equal(stored.payload.provider_receipt, "resend-owner-proof-1");
  assert.equal(JSON.stringify(stored).includes("owner@example.test"), false, "claim stores only an owner fingerprint");

  const retry = await deliverOwnerProof({
    identity,
    owner: "owner@example.test",
    sendInput: input,
    deps,
  });
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.replay, true);
  assert.equal(retry.receipt.id, first.receipt.id);
  assert.equal(deps.providerCalls, 1, "replay must not cross the provider boundary");
});

test("a dry-run receipt update never reports the owner proof as durably sent", async () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const deps = memoryDeps();
  deps.conditionalUpdate = async () => ({
    ok: true,
    mode: "dry_run",
    updated: true,
  });

  const result = await deliverOwnerProof({
    identity,
    owner: "owner@example.test",
    sendInput: { prospect, internalOwnerProof: true },
    deps,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "owner_proof_receipt_persist_failed");
  assert.equal(result.providerAttempted, true);
  assert.equal(result.manualReconciliationRequired, true);
  assert.equal(deps.providerCalls, 1);
});

test("a concurrent claimed proof never invokes the provider", async () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const deps = memoryDeps();
  const claim = await acquireClaim(identity, "owner@example.test", deps);
  assert.equal(claim.ok, true);

  const raced = await deliverOwnerProof({
    identity,
    owner: "owner@example.test",
    sendInput: { prospect, internalOwnerProof: true },
    deps,
  });
  assert.equal(raced.ok, false);
  assert.equal(raced.reason, "owner_proof_in_flight");
  assert.equal(raced.providerAttempted, false);
  assert.equal(deps.providerCalls, 0);
  assert.equal([...deps.events.values()][0].type, CLAIM_TYPE);
});

test("parallel owner-proof requests produce one provider call", async () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const deps = memoryDeps();
  const sendInput = { prospect, internalOwnerProof: true };

  const [first, second] = await Promise.all([
    deliverOwnerProof({
      identity,
      owner: "owner@example.test",
      sendInput,
      deps,
    }),
    deliverOwnerProof({
      identity,
      owner: "owner@example.test",
      sendInput,
      deps,
    }),
  ]);

  assert.equal(deps.providerCalls, 1, "the unique durable claim must fence a parallel retry");
  assert.equal([first, second].filter((result) => result.ok === true).length, 1);
  assert.equal(
    [first, second].filter((result) => result.reason === "owner_proof_in_flight").length,
    1,
  );
});

test("the same prospect build across Line batches replays one owner-proof operation", async () => {
  const { prospect, lineRow } = fixture();
  const firstIdentity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const laterBatch = structuredClone(lineRow);
  laterBatch.batch_id = "practice-batch-later";
  laterBatch.payload.batchId = "practice-batch-later";
  const secondIdentity = lineArtifactIdentity(laterBatch, prospect, qualityPassed);
  const deps = memoryDeps();

  const first = await deliverOwnerProof({
    identity: firstIdentity,
    owner: "owner@example.test",
    sendInput: { prospect, internalOwnerProof: true },
    deps,
  });
  const replay = await deliverOwnerProof({
    identity: secondIdentity,
    owner: "owner@example.test",
    sendInput: { prospect, internalOwnerProof: true },
    deps,
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(replay.idempotencyKey, first.idempotencyKey);
  assert.equal(deps.providerCalls, 1, "a later batch cannot send the same build twice");
});

test("a transient pre-provider guard outage resumes and sends only after the guard succeeds", async () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const deps = memoryDeps();
  let boundaryCalls = 0;
  let providerCalls = 0;
  deps.sendSequenceStep = async () => {
    boundaryCalls += 1;
    if (boundaryCalls === 1) {
      return { ok: false, blocked: "suppression_check_unavailable" };
    }
    providerCalls += 1;
    return { ok: true, mode: "sent", id: "resend-after-guard-recovered" };
  };

  const held = await deliverOwnerProof({
    identity,
    owner: "owner@example.test",
    sendInput: { prospect, internalOwnerProof: true },
    deps,
  });
  assert.equal(held.ok, false);
  assert.equal(held.reason, "suppression_check_unavailable");
  assert.equal(held.retryable, true);
  assert.equal(held.disposition, "system_hold");
  assert.equal(held.providerAttempted, false);
  assert.equal(providerCalls, 0);
  assert.equal([...deps.events.values()][0].payload.status, "system_hold");

  const recovered = await deliverOwnerProof({
    identity,
    owner: "owner@example.test",
    sendInput: { prospect, internalOwnerProof: true },
    deps,
  });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(recovered.replay, false);
  assert.equal(providerCalls, 1, "only the recovered guard path crosses the provider boundary");
  assert.equal(boundaryCalls, 2);
  assert.equal([...deps.events.values()][0].payload.status, "sent");
});

test("a missing Practice Signal report stays resumable before provider and succeeds when available", async () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const deps = memoryDeps();
  let boundaryCalls = 0;
  let providerCalls = 0;
  deps.sendSequenceStep = async () => {
    boundaryCalls += 1;
    if (boundaryCalls === 1) {
      return {
        ok: false,
        blocked: "owner_proof_signal_report_missing",
        retryableBeforeProvider: true,
      };
    }
    providerCalls += 1;
    return { ok: true, mode: "sent", id: "resend-after-signal-report" };
  };
  const sendInput = { prospect, internalOwnerProof: true };

  const held = await deliverOwnerProof({ identity, owner: "owner@example.test", sendInput, deps });
  assert.equal(held.ok, false);
  assert.equal(held.reason, "owner_proof_signal_report_missing");
  assert.equal(held.retryable, true);
  assert.equal(held.disposition, "system_hold");
  assert.equal(held.providerAttempted, false);
  assert.equal(providerCalls, 0);
  assert.equal([...deps.events.values()][0].payload.status, "system_hold");

  const recovered = await deliverOwnerProof({ identity, owner: "owner@example.test", sendInput, deps });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(recovered.replay, false);
  assert.equal(boundaryCalls, 2);
  assert.equal(providerCalls, 1);
  assert.equal([...deps.events.values()][0].payload.status, "sent");
});

test("owner-proof config and deadline blockers stay resumable until one configured send", async () => {
  const blockers = [
    { ok: false, blocked: "outreach_sender_not_ready", configured: false },
    { ok: false, blocked: "resend_not_configured", configured: false },
    { ok: false, blocked: "resend_webhook_not_configured", configured: false },
    {
      ok: false,
      mode: "dry_run",
      blocked: "resend_not_configured",
      configured: false,
      reason: "RESEND_API_KEY and/or sender email not configured",
    },
    {
      ok: false,
      mode: "send_blocked",
      blocked: "owner_proof_deadline_exhausted",
      configured: false,
    },
  ];
  for (const firstReceipt of blockers) {
    const { prospect, lineRow } = fixture();
    const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
    const deps = memoryDeps();
    let boundaryCalls = 0;
    let providerCalls = 0;
    deps.sendSequenceStep = async () => {
      boundaryCalls += 1;
      if (boundaryCalls === 1) return structuredClone(firstReceipt);
      providerCalls += 1;
      return { ok: true, mode: "sent", id: `resend-after-${firstReceipt.blocked}` };
    };
    const sendInput = { prospect, internalOwnerProof: true };

    const held = await deliverOwnerProof({
      identity,
      owner: "owner@example.test",
      sendInput,
      deps,
    });
    assert.equal(held.ok, false);
    assert.equal(held.reason, firstReceipt.blocked);
    assert.equal(held.retryable, true);
    assert.equal(held.disposition, "system_hold");
    assert.equal(held.providerAttempted, false);
    assert.equal(providerCalls, 0);
    const storedHold = [...deps.events.values()][0];
    assert.equal(storedHold.type, CLAIM_TYPE);
    assert.equal(storedHold.payload.status, "system_hold");
    assert.equal(storedHold.payload.reason, firstReceipt.blocked);
    assert.equal(storedHold.payload.provider_configured, false);

    const recovered = await deliverOwnerProof({
      identity,
      owner: "owner@example.test",
      sendInput,
      deps,
    });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.replay, false);
    assert.equal(providerCalls, 1);
    assert.equal(boundaryCalls, 2);
    assert.equal([...deps.events.values()][0].type, PROOF_SENT_EVENT_TYPE);
    assert.equal([...deps.events.values()][0].payload.status, "sent");

    const replay = await deliverOwnerProof({
      identity,
      owner: "owner@example.test",
      sendInput,
      deps,
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.replay, true);
    assert.equal(providerCalls, 1, "a recovered retry must leave one provider receipt");
  }
});

test("a dry-run system-hold resume cannot cross the provider boundary", async () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const deps = memoryDeps();
  const sendInput = { prospect, internalOwnerProof: true };
  deps.sendSequenceStep = async () => ({
    ok: false,
    blocked: "suppression_check_unavailable",
  });
  const held = await deliverOwnerProof({
    identity,
    owner: "owner@example.test",
    sendInput,
    deps,
  });
  assert.equal(held.disposition, "system_hold");

  let providerCalls = 0;
  deps.conditionalUpdate = async () => ({
    ok: true,
    mode: "dry_run",
    updated: true,
  });
  deps.sendSequenceStep = async () => {
    providerCalls += 1;
    return { ok: true, mode: "sent", id: "must-not-send" };
  };
  const blocked = await deliverOwnerProof({
    identity,
    owner: "owner@example.test",
    sendInput,
    deps,
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.disposition, "system_hold");
  assert.equal(blocked.providerAttempted, false);
  assert.equal(providerCalls, 0);
});

test("parallel retries of a resumable system hold cross the provider once", async () => {
  const { prospect, lineRow } = fixture();
  const identity = lineArtifactIdentity(lineRow, prospect, qualityPassed);
  const deps = memoryDeps();
  deps.sendSequenceStep = async () => ({
    ok: false,
    blocked: "suppression_check_unavailable",
  });
  const sendInput = { prospect, internalOwnerProof: true };
  const held = await deliverOwnerProof({
    identity,
    owner: "owner@example.test",
    sendInput,
    deps,
  });
  assert.equal(held.disposition, "system_hold");

  let providerCalls = 0;
  deps.sendSequenceStep = async () => {
    providerCalls += 1;
    await Promise.resolve();
    return { ok: true, mode: "sent", id: "resend-one-resumed-proof" };
  };
  const results = await Promise.all([
    deliverOwnerProof({ identity, owner: "owner@example.test", sendInput, deps }),
    deliverOwnerProof({ identity, owner: "owner@example.test", sendInput, deps }),
  ]);

  assert.equal(providerCalls, 1);
  assert.ok(results.some((result) => result.ok === true));
  assert.ok(results.every((result) => (
    result.ok === true || result.reason === "owner_proof_in_flight"
  )));
  assert.equal([...deps.events.values()][0].payload.status, "sent");
});

test("the Gallery route resolves the canonical Line row and replays without a second provider call", async (t) => {
  const priorAdmin = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  const priorOwner = process.env.GHOST_AGENCY_OWNER_EMAIL;
  const priorSnapshot = process.env.ASSET_SNAPSHOT_ENABLED;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "owner-proof-admin";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  delete process.env.ASSET_SNAPSHOT_ENABLED;
  t.after(() => {
    if (priorAdmin === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorAdmin;
    if (priorOwner === undefined) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = priorOwner;
    if (priorSnapshot === undefined) delete process.env.ASSET_SNAPSHOT_ENABLED;
    else process.env.ASSET_SNAPSHOT_ENABLED = priorSnapshot;
  });

  const { prospect, lineRow } = fixture();
  const durable = memoryDeps();
  const routeStartedAt = Date.UTC(2026, 7, 29, 12, 0, 0);
  let observedDeadlineAt = 0;
  let observedVerifyDeadlineAt = 0;
  const order = [];
  const handler = createSendMirrorProofHandler({
    select: async (table, query) => {
      if (table === "ghost_agency_prospects") return { ok: true, data: [structuredClone(prospect)] };
      if (table === "ghost_agency_line_batch_rows") return { ok: true, data: [structuredClone(lineRow)] };
      return durable.select(table, query);
    },
    insertRow: async (...args) => {
      order.push("claim");
      return durable.insertRow(...args);
    },
    conditionalUpdate: durable.conditionalUpdate,
    sendSequenceStep: async (input) => {
      order.push("provider");
      observedDeadlineAt = input.deadlineAt;
      return durable.sendSequenceStep(input);
    },
    outreachBuildQuality: qualityPassed,
    verifyActiveRelease: async (input) => {
      order.push("verify");
      observedVerifyDeadlineAt = input.deadlineAt;
      return verifiedPublicRelease(input);
    },
    now: durable.now,
    routeNow: () => routeStartedAt,
  });
  const response = () => ({
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = value ? JSON.parse(value) : null; },
  });
  const request = {
    method: "POST",
    headers: { "x-admin-token": "owner-proof-admin" },
    body: { prospectId: prospect.prospect_id },
  };

  const first = response();
  await handler(request, first);
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.ok, true);
  assert.equal(first.body.idempotent, false);
  assert.equal(durable.providerCalls, 1);
  assert.deepEqual(order.slice(0, 3), ["verify", "claim", "provider"]);
  assert.equal(observedDeadlineAt, routeStartedAt + 285_000);
  assert.ok(
    observedVerifyDeadlineAt <= routeStartedAt + 60_000,
    "public release verification must be capped at 60 seconds from route entry",
  );
  assert.ok(
    observedVerifyDeadlineAt < observedDeadlineAt,
    "public release verification must leave time for the owner-proof send",
  );
  assert.ok(observedDeadlineAt > routeStartedAt, "the owner-proof deadline must be in the future");
  assert.ok(
    observedDeadlineAt < routeStartedAt + 300_000,
    "the owner-proof deadline must leave room below the platform timeout",
  );

  const retry = response();
  await handler(request, retry);
  assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.ok, true);
  assert.equal(retry.body.idempotent, true);
  assert.equal(retry.body.send.id, first.body.send.id);
  assert.equal(durable.providerCalls, 1, "the replayed Gallery click must not call the provider");
});

test("the Gallery route refuses stale or mismatched public releases before claim, including dry run", async (t) => {
  const priorAdmin = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  const priorOwner = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "owner-proof-admin";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  t.after(() => {
    if (priorAdmin === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorAdmin;
    if (priorOwner === undefined) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = priorOwner;
  });

  const { prospect, lineRow } = fixture();
  const cases = [
    {
      name: "inactive release",
      dryRun: false,
      verify: async () => ({ ok: false, reason: "shared_release_not_current_active" }),
    },
    {
      name: "dry-run API bypass",
      dryRun: true,
      verify: async () => ({ ok: false, reason: "shared_release_public_verification_failed" }),
    },
    {
      name: "lying verifier receipt",
      dryRun: false,
      verify: async () => ({
        ok: true,
        fallback: false,
        previewUrl: PREVIEW,
        siteId: SITE_ID,
        releaseId: "33333333-3333-4333-8333-333333333333",
        buildHash: BUILD_HASH,
      }),
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const durable = memoryDeps();
      let verifies = 0;
      const handler = createSendMirrorProofHandler({
        select: async (table, query) => {
          if (table === "ghost_agency_prospects") return { ok: true, data: [structuredClone(prospect)] };
          if (table === "ghost_agency_line_batch_rows") return { ok: true, data: [structuredClone(lineRow)] };
          return durable.select(table, query);
        },
        insertRow: durable.insertRow,
        conditionalUpdate: durable.conditionalUpdate,
        sendSequenceStep: durable.sendSequenceStep,
        outreachBuildQuality: qualityPassed,
        verifyActiveRelease: async (input) => {
          verifies += 1;
          assert.deepEqual(input.proofIdentity, PROOF_IDENTITY);
          assert.equal(input.previewUrl, PREVIEW);
          assert.equal(input.releaseEvidence.canonical_host, "owner-proof.wss-ai.com");
          return item.verify(input);
        },
        now: durable.now,
      });
      const res = {
        statusCode: 0,
        headers: {},
        body: null,
        setHeader(name, value) { this.headers[name] = value; },
        end(value = "") { this.body = value ? JSON.parse(value) : null; },
      };
      await handler({
        method: "POST",
        headers: { "x-admin-token": "owner-proof-admin" },
        body: { prospectId: prospect.prospect_id, dryRun: item.dryRun },
      }, res);
      assert.equal(res.statusCode, 503, JSON.stringify(res.body));
      assert.equal(res.body.error, "owner_proof_public_release_unavailable");
      assert.equal(verifies, 1);
      assert.equal(durable.events.size, 0, "failed public verification wrote a claim");
      assert.equal(durable.providerCalls, 0, "failed public verification reached the provider");
    });
  }
});

test("the Gallery owner proof uses the real Signal composer even when V2 dark launch is enabled", async (t) => {
  const priorEnv = { ...process.env };
  const priorFetch = global.fetch;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "owner-proof-admin";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  process.env.EMAIL_UNSUB_SECRET = "owner-proof-test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@wss-ai.com";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  process.env.CALLPREP_SUPABASE_URL = "https://qjiszykrgqdwlvooicvk.supabase.co";
  process.env.CALLPREP_SUPABASE_ANON_KEY = "owner-proof-anon-test";
  process.env.GHOST_AGENCY_PROOF_EMAIL_V3 = "false";
  process.env.GHOST_AGENCY_EMAIL_V2 = "true";
  delete process.env.ASSET_SNAPSHOT_ENABLED;
  t.after(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in priorEnv)) delete process.env[key];
    }
    Object.assign(process.env, priorEnv);
    global.fetch = priorFetch;
  });

  const reportId = "3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44";
  const reportUrl = `https://callprep.wss-ai.com/report/${reportId}`;
  let reportReads = 0;
  global.fetch = async () => {
    reportReads += 1;
    return new Response(JSON.stringify({
      data: {
        id: reportId,
        business_name: "Owner Proof Practice",
        business_url: "https://owner-proof-practice.example/",
        overall_grade: "B",
        overall_score: 83,
        data_availability: { gbp: true, social: true, website: true },
        source_snapshot: {
          packet_id: `wss-genie-cert-v1:${"d".repeat(64)}`,
          business_name: "Owner Proof Practice",
          city: "Irvine",
          state: "CA",
          industry: "plumbing",
          categories: {
            geo: { grade: "B", score: 83 },
            seo: { grade: "B+", score: 89 },
          },
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const { prospect, lineRow } = fixture();
  prospect.report_url = reportUrl;
  prospect.current_website = "https://owner-proof-practice.example/";
  prospect.before_shot_source_url = prospect.current_website;
  prospect.city = "Irvine";
  prospect.state = "CA";
  prospect.industry = "plumbing";
  prospect.record.genie_content_certification = {
    signature: "d".repeat(64),
    identity: {
      business_name: "Owner Proof Practice",
      canonical_domain: "owner-proof-practice.example",
      city: "Irvine",
      state: "CA",
      category: "plumbing",
    },
  };
  const durable = memoryDeps();
  const { sendSequenceStep } = require("../lib/email");
  const handler = createSendMirrorProofHandler({
    select: async (table, query) => {
      if (table === "ghost_agency_prospects") return { ok: true, data: [structuredClone(prospect)] };
      if (table === "ghost_agency_line_batch_rows") return { ok: true, data: [structuredClone(lineRow)] };
      return durable.select(table, query);
    },
    insertRow: durable.insertRow,
    conditionalUpdate: durable.conditionalUpdate,
    sendSequenceStep: (input) => sendSequenceStep({
      ...input,
      verifyOwnerPracticeReceipt: (_prospect, record) => ({
        ok: true,
        receipt: record.genie_content_certification,
      }),
    }),
    outreachBuildQuality: qualityPassed,
    verifyActiveRelease: verifiedPublicRelease,
    now: durable.now,
  });
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = value ? JSON.parse(value) : null; },
  };

  await handler({
    method: "POST",
    headers: { "x-admin-token": "owner-proof-admin" },
    body: { prospectId: prospect.prospect_id, dryRun: true },
  }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.send.ownerProof, true);
  assert.equal(reportReads, 1);
  assert.ok(res.body.send.htmlPreview.includes(`href="${reportUrl}"`), "Signal URL missing from HTML");
  assert.ok(res.body.send.composedText.includes(reportUrl), "Signal URL missing from plain text");
  assert.doesNotMatch(res.body.send.htmlPreview, /0 Leads \/ month|\$0 Cost \/ lead/);
});
