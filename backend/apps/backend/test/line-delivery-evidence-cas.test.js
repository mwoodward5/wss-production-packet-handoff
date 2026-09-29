"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createLineSender } = require("../lib/line-delivery");

const PREVIEW = "https://wss-test-cas-fixture.wss-ai.com/";
const BUILD_HASH = "a".repeat(64);
const SIGNAL_REPORT = "https://callprep.wss-ai.com/report/3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44";
const PROOF_IDENTITY = Object.freeze({
  site_id: "11111111-1111-4111-8111-111111111111",
  release_id: "22222222-2222-4222-8222-222222222222",
  build_hash: BUILD_HASH,
});

function releaseEvidence({
  buildHash = BUILD_HASH,
  previewUrl = PREVIEW,
  releaseId = PROOF_IDENTITY.release_id,
} = {}) {
  const proofIdentity = {
    ...PROOF_IDENTITY,
    release_id: releaseId,
    build_hash: buildHash,
  };
  return {
    build_hash: buildHash,
    preview_url: previewUrl,
    proofIdentity,
    sharedReleaseEvidence: {
      evidence_schema: "shared-site-release-evidence-v1",
      state: "active",
      ...proofIdentity,
      canonical_host: new URL(previewUrl).hostname,
    },
  };
}

function fingerprint(value) {
  return createHash("sha256").update(String(value || "").trim().toLowerCase()).digest("hex");
}

function harness({
  casOutcomes = [true],
  lane = "sandbox",
  afterFirstConflict = null,
  afterSuccessfulCas = null,
  hangSelectCall = 0,
  deadlineMs = 60_000,
  publicReleaseVerifier = null,
  rowPatch = null,
  durablePatch = null,
  ensureLineReportOverride = null,
} = {}) {
  const owner = "owner@example.test";
  let providerCalls = 0;
  let selectCalls = 0;
  const guards = [];
  let conditionalCalls = 0;
  let durable = {
    prospect_id: "prospect-cas",
    business_name: "CAS Fixture",
    status: "line_queued",
    updated_at: "2026-08-28T23:34:26.098+00:00",
    email: lane === "live" ? "prospect@example.test" : "",
    current_website: "https://cas-fixture.example/",
    preview_url: PREVIEW,
    record: {
      note: "nested JSON with ? & = characters must not become a URL predicate",
      build_dispatch: { build_hash: BUILD_HASH, release_evidence: releaseEvidence() },
      proof_shots: { ...PROOF_IDENTITY },
    },
  };
  if (typeof durablePatch === "function") durable = durablePatch(durable);

  const deps = {
    readiness: async () => ({ ready: true, blockers: [] }),
    select: async () => {
      selectCalls += 1;
      if (selectCalls === hangSelectCall) return new Promise(() => {});
      return { ok: true, data: [structuredClone(durable)] };
    },
    conditionalUpdate: async (_table, _idField, _id, nextGuards, patch) => {
      guards.push(structuredClone(nextGuards));
      const outcome = casOutcomes[Math.min(conditionalCalls, casOutcomes.length - 1)];
      conditionalCalls += 1;
      if (!outcome) {
        if (conditionalCalls === 1 && typeof afterFirstConflict === "function") {
          durable = afterFirstConflict(structuredClone(durable), structuredClone(patch));
        }
        return { ok: true, updated: false, data: [] };
      }
      durable = { ...durable, ...structuredClone(patch) };
      const written = structuredClone(durable);
      if (typeof afterSuccessfulCas === "function") {
        durable = afterSuccessfulCas(structuredClone(durable), conditionalCalls);
      }
      return { ok: true, updated: true, data: [written] };
    },
    ownerSandboxAddress: () => owner,
    recipientFingerprint: fingerprint,
    contactSendGate: () => ({ hasEnrichment: false, blocked: false, holdReasons: [], blockedReasons: [] }),
    suppressionStatus: async () => ({ known: true, suppressed: false }),
    deliveryProofIdentity: () => ({ ok: true, active: true, proofIdentity: { ...PROOF_IDENTITY } }),
    proofShotsForSend: async () => ({ persist: false, shots: null, refuseDelivery: false }),
    ensureLineReport: ensureLineReportOverride || (async () => ({ ok: true, reportUrl: SIGNAL_REPORT })),
    verifyActiveRelease: async (input) => (typeof publicReleaseVerifier === "function"
      ? publicReleaseVerifier(input)
      : {
          ok: true,
          fallback: false,
          previewUrl: input.previewUrl,
          siteId: input.proofIdentity.site_id,
          releaseId: input.proofIdentity.release_id,
          buildHash: input.proofIdentity.build_hash,
        }),
    clientReferenceCode: () => "CLIENT-CAS",
    forceOwnerRecipient: (prospect, address) => ({ ...prospect, email: address }),
    assertOwnerOnly: (prospect, address) => prospect.email === address,
    sendSequenceStep: async (input) => {
      if (input.requireOwnerPracticeActiveRelease === true) {
        const exactActiveRelease = typeof input.verifyOwnerPracticeActiveRelease === "function"
          && await input.verifyOwnerPracticeActiveRelease() === true;
        if (!exactActiveRelease) {
          return {
            ok: false,
            blocked: "owner_proof_public_release_unavailable",
            releaseFailureKind: "transient",
            retryableBeforeProvider: true,
            providerAttempted: false,
          };
        }
      }
      providerCalls += 1;
      return { ok: true, mode: "sent", id: "must-not-run-during-prepare" };
    },
    now: () => new Date("2026-08-28T23:35:00.000Z"),
  };

  const sender = createLineSender({ lane, batchId: "batch-cas", deps });
  const row = {
    prospectId: durable.prospect_id,
    businessName: durable.business_name,
    previewUrl: durable.preview_url,
    buildHash: BUILD_HASH,
    proofIdentity: PROOF_IDENTITY,
    releaseEvidence: releaseEvidence(),
    ...(lane === "live" ? { recipientFingerprint: fingerprint(durable.email) } : {}),
    ...(rowPatch || {}),
  };
  return {
    prepare: () => sender.prepare(row, { deadlineAt: Date.now() + deadlineMs }),
    deliver: (plan) => sender.deliver(plan, { expectedInputFingerprint: plan.inputFingerprint }),
    mutateDurable: (mutator) => { durable = mutator(structuredClone(durable)); },
    get guards() { return guards; },
    get conditionalCalls() { return conditionalCalls; },
    get selectCalls() { return selectCalls; },
    get providerCalls() { return providerCalls; },
    get durable() { return durable; },
  };
}

test("delivery evidence CAS uses row-version fields instead of whole-record equality", async () => {
  const h = harness();
  const plan = await h.prepare();
  assert.equal(plan.ok, true);
  assert.deepEqual(h.guards[0], {
    updated_at: "eq.2026-08-28T23:34:26.098+00:00",
    status: "eq.line_queued",
  });
  assert.equal(Object.hasOwn(h.guards[0], "record"), false);
  assert.equal(h.durable.record.client_id, "CLIENT-CAS");
  assert.equal(h.providerCalls, 0);
});

test("owner Practice reloads one harmless CAS conflict and retries once on the same release", async () => {
  const h = harness({
    casOutcomes: [false, true],
    afterFirstConflict: (durable) => ({
      ...durable,
      updated_at: "2026-08-28T23:34:45.000+00:00",
      record: { ...durable.record, freshness_note: "concurrent metadata only" },
    }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, true);
  assert.equal(h.conditionalCalls, 2);
  assert.equal(h.guards[1].updated_at, "eq.2026-08-28T23:34:45.000+00:00");
  assert.equal(h.durable.record.report_url, SIGNAL_REPORT);
  assert.equal(h.durable.report_url, SIGNAL_REPORT);
  assert.equal(h.durable.record.client_id, "CLIENT-CAS");
  assert.equal(h.providerCalls, 0);
});

test("owner Practice accepts a lost CAS only when the exact desired evidence already won", async () => {
  const h = harness({
    casOutcomes: [false],
    afterFirstConflict: (durable, patch) => ({
      ...durable,
      ...patch,
      updated_at: "2026-08-28T23:34:46.000+00:00",
    }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, true);
  assert.equal(h.conditionalCalls, 1, "an exact concurrent winner needs no second write");
  assert.equal(h.durable.record.report_url, SIGNAL_REPORT);
  assert.equal(h.durable.report_url, SIGNAL_REPORT);
  assert.equal(h.durable.record.client_id, "CLIENT-CAS");
  assert.equal(h.providerCalls, 0);
});

test("owner Practice repairs a partial concurrent report winner instead of accepting split evidence", async () => {
  const h = harness({
    casOutcomes: [false, true],
    afterFirstConflict: (durable, patch) => ({
      ...durable,
      updated_at: "2026-08-28T23:34:46.500+00:00",
      record: structuredClone(patch.record),
      // Deliberately omit patch.report_url. Exact-winner recovery requires the
      // top-level and record report identities to agree before acceptance.
    }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, true);
  assert.equal(h.conditionalCalls, 2);
  assert.equal(h.durable.record.report_url, SIGNAL_REPORT);
  assert.equal(h.durable.report_url, SIGNAL_REPORT);
  assert.equal(h.providerCalls, 0);
});

test("owner Practice halts for reconciliation when the release changes during the CAS", async () => {
  const changedHash = "b".repeat(64);
  const h = harness({
    casOutcomes: [false],
    afterFirstConflict: (durable) => ({
      ...durable,
      updated_at: "2026-08-28T23:34:47.000+00:00",
      record: {
        ...durable.record,
        build_dispatch: {
          build_hash: changedHash,
          release_evidence: releaseEvidence({
            buildHash: changedHash,
            releaseId: "33333333-3333-4333-8333-333333333333",
          }),
        },
      },
    }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "delivery_evidence_release_identity_changed");
  assert.equal(plan.manualReconciliationRequired, true);
  assert.equal(plan.providerAttempted, false);
  assert.equal(h.conditionalCalls, 1, "changed releases are never overwritten");
  assert.equal(h.providerCalls, 0);
});

test("owner Practice halts for reconciliation when the preview changes during the CAS", async () => {
  const changedPreview = "https://changed-preview.wss-ai.com/";
  const h = harness({
    casOutcomes: [false],
    afterFirstConflict: (durable) => ({
      ...durable,
      updated_at: "2026-08-28T23:34:47.500+00:00",
      preview_url: changedPreview,
      record: {
        ...durable.record,
        build_dispatch: {
          build_hash: BUILD_HASH,
          release_evidence: releaseEvidence({ previewUrl: changedPreview }),
        },
      },
    }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "delivery_evidence_release_identity_changed");
  assert.equal(plan.manualReconciliationRequired, true);
  assert.equal(h.conditionalCalls, 1, "changed previews are never overwritten");
  assert.equal(h.providerCalls, 0);
});

test("owner Practice re-runs site truth after a CAS conflict", async () => {
  const h = harness({
    casOutcomes: [false],
    afterFirstConflict: (durable) => ({
      ...durable,
      updated_at: "2026-08-28T23:34:48.000+00:00",
      blocked_reason: "vertical_mismatch_sport_fencing",
    }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "vertical_mismatch_sport_fencing");
  assert.equal(plan.manualReconciliationRequired, true);
  assert.equal(h.conditionalCalls, 1);
  assert.equal(h.providerCalls, 0);
});

test("owner Practice fails closed after one reload and one retry lose the CAS", async () => {
  const h = harness({
    casOutcomes: [false, false],
    afterFirstConflict: (durable) => ({
      ...durable,
      updated_at: "2026-08-28T23:34:49.000+00:00",
      record: { ...durable.record, freshness_note: "still same release" },
    }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "delivery_evidence_persist_conflict");
  assert.equal(plan.manualReconciliationRequired, true);
  assert.equal(plan.providerAttempted, false);
  assert.equal(h.conditionalCalls, 2);
  assert.equal(h.providerCalls, 0);
});

test("owner Practice bounds a hung conflict reload before the provider reserve", async () => {
  const h = harness({
    casOutcomes: [false],
    hangSelectCall: 3,
    // prepare reserves 30 seconds for the provider; leave 250 ms for evidence.
    deadlineMs: 30_250,
  });
  const startedAt = Date.now();
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "delivery_evidence_persist_unavailable");
  assert.equal(plan.policyHold, true);
  assert.equal(plan.providerAttempted, false);
  assert.equal(h.conditionalCalls, 1);
  assert.equal(h.selectCalls, 3);
  assert.ok(Date.now() - startedAt < 2_000, "the hung reload stays inside its evidence budget");
  assert.equal(h.providerCalls, 0);
});

test("owner Practice rechecks release identity after a recovered CAS before preparing", async () => {
  const changedHash = "c".repeat(64);
  const h = harness({
    casOutcomes: [false, true],
    afterFirstConflict: (durable) => ({
      ...durable,
      updated_at: "2026-08-28T23:34:49.500+00:00",
    }),
    afterSuccessfulCas: (durable) => ({
      ...durable,
      updated_at: "2026-08-28T23:34:49.750+00:00",
      record: {
        ...durable.record,
        build_dispatch: {
          build_hash: changedHash,
          release_evidence: releaseEvidence({
            buildHash: changedHash,
            releaseId: "44444444-4444-4444-8444-444444444444",
          }),
        },
      },
    }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "delivery_evidence_release_identity_changed");
  assert.equal(plan.manualReconciliationRequired, true);
  assert.equal(h.conditionalCalls, 2);
  assert.equal(h.providerCalls, 0);
});

test("owner Practice rechecks the prepared release again at the provider boundary", async () => {
  const changedHash = "d".repeat(64);
  const h = harness();
  const plan = await h.prepare();
  assert.equal(plan.ok, true);
  h.mutateDurable((durable) => ({
    ...durable,
    updated_at: "2026-08-28T23:34:49.900+00:00",
    record: {
      ...durable.record,
      build_dispatch: {
        build_hash: changedHash,
        release_evidence: releaseEvidence({
          buildHash: changedHash,
          releaseId: "55555555-5555-4555-8555-555555555555",
        }),
      },
    },
  }));
  const delivered = await h.deliver(plan);
  assert.equal(delivered.ok, false);
  assert.equal(delivered.reason, "delivery_evidence_release_identity_changed");
  assert.equal(delivered.manualReconciliationRequired, true);
  assert.equal(delivered.providerAttempted, false);
  assert.equal(h.providerCalls, 0);
});

test("owner Practice blocks a registry quarantine after prepare with an unchanged prospect tuple", async () => {
  let active = true;
  let releaseChecks = 0;
  const h = harness({
    publicReleaseVerifier: async (input) => {
      releaseChecks += 1;
      return active
        ? {
            ok: true,
            fallback: false,
            previewUrl: input.previewUrl,
            siteId: input.proofIdentity.site_id,
            releaseId: input.proofIdentity.release_id,
            buildHash: input.proofIdentity.build_hash,
          }
        : { ok: false, reason: "shared_release_not_current_active" };
    },
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, true);
  assert.equal(releaseChecks, 1);
  const durableAfterPrepare = structuredClone(h.durable);

  active = false;
  const delivered = await h.deliver(plan);

  assert.equal(delivered.ok, false);
  assert.equal(delivered.reason, "owner_proof_public_release_unavailable");
  assert.equal(delivered.releaseFailureKind, "transient");
  assert.equal(delivered.retryableBeforeProvider, true);
  assert.equal(delivered.providerAttempted, false);
  assert.equal(releaseChecks, 2);
  assert.deepEqual(h.durable, durableAfterPrepare, "the prospect tuple stayed identical");
  assert.equal(h.providerCalls, 0);
});

test("Live keeps the original one-shot CAS conflict policy", async () => {
  const h = harness({
    lane: "live",
    casOutcomes: [false, true],
    afterFirstConflict: (durable) => ({
      ...durable,
      updated_at: "2026-08-28T23:34:50.000+00:00",
      record: { ...durable.record, freshness_note: "must not trigger Live recovery" },
    }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "delivery_evidence_persist_conflict");
  assert.equal(plan.policyHold, true);
  assert.equal(plan.providerAttempted, false);
  assert.equal(h.conditionalCalls, 1);
  assert.equal(h.providerCalls, 0);
});

// ---------------------------------------------------------------------------
// LEGACY ROW CLASSIC RECOVERY (row-scoped). Blocker: sandbox batch
// line_mtoz4opf_33476ede06 row :3 — the durable prospect carries a signed
// shared-release contract matching the ACTIVE local release but NO
// genie_canonical_packet, so the immutable-packet projection is structurally
// impossible (immutable_packet_missing) while the classic V3 assembly was
// refused by the shared-release one-side guard
// (delivery_evidence_release_identity_changed). The row-scoped
// legacyClassicAssemblyRecovery flag opts that one row into the classic
// assembly WITH the exact immutable-lane live verification. The global
// GHOST_AGENCY_IMMUTABLE_PACKET default stays unset (on) in these tests.
// ---------------------------------------------------------------------------

// Stranded-record shape: contract on the durable side only (mirror_release_
// evidence), no certified packet, and a packet-less record refuses the
// immutable report projection exactly like lib/line-report.js does.
function strandedDurable(durable) {
  return {
    ...durable,
    record: {
      ...durable.record,
      build_dispatch: { build_hash: BUILD_HASH },
      mirror_release_evidence: releaseEvidence(),
    },
  };
}

function packetlessReportLane(reportLaneCalls) {
  return async (_prospect, options = {}) => {
    const immutable = options.preferImmutablePacket === true;
    reportLaneCalls.push(immutable);
    return immutable
      ? { ok: false, reportUrl: "", mode: "immutable_packet", reason: "immutable_packet_missing" }
      : { ok: true, reportUrl: SIGNAL_REPORT };
  };
}

test("legacy recovery row delivers through the classic assembly with the full live shared-release verification", async () => {
  assert.equal(process.env.GHOST_AGENCY_IMMUTABLE_PACKET, undefined,
    "the recovery must be proven against the global default (immutable packet ON)");
  let releaseChecks = 0;
  const reportLaneCalls = [];
  const h = harness({
    // Production drain shape: hydrateRow spreads the durable payload onto the
    // row, so the opt-in flag arrives at the top level.
    rowPatch: { legacyClassicAssemblyRecovery: true },
    durablePatch: strandedDurable,
    ensureLineReportOverride: packetlessReportLane(reportLaneCalls),
    publicReleaseVerifier: async (input) => {
      releaseChecks += 1;
      return {
        ok: true,
        fallback: false,
        previewUrl: input.previewUrl,
        siteId: input.proofIdentity.site_id,
        releaseId: input.proofIdentity.release_id,
        buildHash: input.proofIdentity.build_hash,
      };
    },
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, true, `prepare refused: ${plan.reason}`);
  assert.deepEqual(reportLaneCalls, [false], "the report was assembled on the classic lane");
  assert.equal(releaseChecks, 1, "the live exact-active-release verifier ran during prepare");
  const delivered = await h.deliver(plan);
  assert.equal(delivered.ok, true);
  assert.equal(delivered.mode, "sent");
  assert.equal(releaseChecks, 2, "the live verifier ran again at the provider boundary");
  assert.equal(h.providerCalls, 1);
});

test("legacy recovery row keeps the immutable-lane refusal when the live verifier rejects the release", async () => {
  const reportLaneCalls = [];
  const h = harness({
    rowPatch: { legacyClassicAssemblyRecovery: true },
    durablePatch: strandedDurable,
    ensureLineReportOverride: packetlessReportLane(reportLaneCalls),
    // Stale/wrong release: the active registry no longer serves these bytes.
    publicReleaseVerifier: async () => ({ ok: false, reason: "shared_release_not_current_active" }),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "owner_proof_public_release_unavailable");
  assert.equal(plan.retryableBeforeProvider, true);
  assert.equal(plan.releaseFailureKind, "transient");
  assert.equal(plan.providerAttempted, false);
  assert.equal(h.providerCalls, 0);
});

test("legacy recovery row still refuses stale durable evidence before any live check or provider work", async () => {
  const staleHash = "e".repeat(64);
  const reportLaneCalls = [];
  const h = harness({
    // Nested payload opt-in shape (the pre-hydration durable payload), on a
    // drained row that carries no release evidence of its own.
    rowPatch: {
      payload: { legacyClassicAssemblyRecovery: true, genieContentCertified: false },
      releaseEvidence: undefined,
      proofIdentity: undefined,
    },
    durablePatch: (durable) => ({
      ...durable,
      record: {
        ...durable.record,
        build_dispatch: { build_hash: BUILD_HASH },
        mirror_release_evidence: releaseEvidence({
          buildHash: staleHash,
          releaseId: "89999999-9999-4999-8999-999999999999",
        }),
      },
    }),
    ensureLineReportOverride: packetlessReportLane(reportLaneCalls),
    publicReleaseVerifier: async () => {
      throw new Error("the live verifier must not be consulted for stale evidence");
    },
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "owner_proof_public_release_unavailable");
  assert.equal(plan.retryableBeforeProvider, true);
  assert.equal(plan.releaseFailureKind, "identity_invalid");
  assert.equal(plan.providerAttempted, false);
  assert.deepEqual(reportLaneCalls, [], "no report was assembled from stale evidence");
  assert.equal(h.providerCalls, 0);
});

test("unflagged rows keep today's refusal: the immutable-packet assembly stays mandatory", async () => {
  const reportLaneCalls = [];
  const h = harness({
    durablePatch: strandedDurable,
    ensureLineReportOverride: packetlessReportLane(reportLaneCalls),
  });
  const plan = await h.prepare();
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "owner_proof_signal_report_unavailable");
  assert.equal(plan.retryableBeforeProvider, true);
  assert.equal(plan.providerAttempted, false);
  assert.deepEqual(reportLaneCalls, [true], "the immutable report projection was still attempted");
  assert.equal(h.providerCalls, 0);
});
