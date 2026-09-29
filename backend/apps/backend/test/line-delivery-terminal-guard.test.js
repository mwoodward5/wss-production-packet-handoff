"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { createLineSender } = require("../lib/line-delivery");

const OWNER = "owner@example.test";
const RECIPIENT = "dispatch@example.test";
const SIGNAL_REPORT = "https://callprep.wss-ai.com/report/3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44";
const PREVIEW = "https://exact-preview.wss-ai.com/";
const BUILD_HASH = "a".repeat(64);
const PROOF_IDENTITY = Object.freeze({
  site_id: "11111111-1111-4111-8111-111111111111",
  release_id: "22222222-2222-4222-8222-222222222222",
  build_hash: BUILD_HASH,
});

function releaseEvidence() {
  return {
    build_hash: BUILD_HASH,
    preview_url: PREVIEW,
    proofIdentity: { ...PROOF_IDENTITY },
    sharedReleaseEvidence: {
      evidence_schema: "shared-site-release-evidence-v1",
      state: "active",
      ...PROOF_IDENTITY,
      canonical_host: "exact-preview.wss-ai.com",
    },
  };
}

function fingerprint(value) {
  const email = String(value || "").trim().toLowerCase();
  return email ? createHash("sha256").update(email).digest("hex") : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness({ canonicalPatch = {}, suppressionStatus, duringEvidence, proofPersist = false, conditionalUpdate } = {}) {
  const state = { selects: 0, captures: 0, upserts: [], sends: [], forcedOwner: 0 };
  const baseRecord = {
    build_dispatch: { build_hash: BUILD_HASH, release_evidence: releaseEvidence() },
    proof_shots: {
      ...PROOF_IDENTITY,
      old_desktop: "https://proof.example.test/old.png",
      new_desktop: "https://proof.example.test/new.png",
    },
  };
  const canonical = {
    prospect_id: "exact-prospect-1",
    business_name: "Exact Business",
    email: RECIPIENT,
    current_website: "https://business.example.test",
    preview_url: PREVIEW,
    status: "line_queued",
    updated_at: "2026-08-22T11:59:00.000Z",
    record: baseRecord,
    ...canonicalPatch,
  };
  canonical.record = { ...baseRecord, ...(canonicalPatch.record || {}) };
  const deps = {
    select: async () => {
      state.selects += 1;
      return { ok: true, data: [clone(canonical)] };
    },
    conditionalUpdate: conditionalUpdate || (async (_table, _key, _keyValue, guards, row) => {
      state.upserts.push({ guards, row });
      if (guards.updated_at !== `eq.${canonical.updated_at}`
        || guards.status !== `eq.${canonical.status}`) {
        return { ok: false, updated: false };
      }
      Object.assign(canonical, clone(row));
      return { ok: true, updated: true, rows: [clone(canonical)] };
    }),
    sendSequenceStep: async (input) => {
      state.sends.push(input);
      return { ok: true, mode: "sent", id: "provider-should-not-run" };
    },
    ensureLineProofShots: async () => {
      state.captures += 1;
      return { ok: true };
    },
    proofShotsForSend: async () => {
      state.captures += 1;
      if (duringEvidence) duringEvidence(canonical);
      return {
        shots: { ...canonical.record.proof_shots },
        persist: proofPersist,
      };
    },
    ensureLineReport: async () => ({ ok: true, reportUrl: SIGNAL_REPORT }),
    verifyActiveRelease: async (input) => ({
      ok: true,
      fallback: false,
      previewUrl: input.previewUrl,
      siteId: input.proofIdentity.site_id,
      releaseId: input.proofIdentity.release_id,
      buildHash: input.proofIdentity.build_hash,
    }),
    clientReferenceCode: () => "",
    ownerSandboxAddress: () => OWNER,
    forceOwnerRecipient: (prospect) => {
      state.forcedOwner += 1;
      return { ...prospect, email: OWNER, ownerEmail: OWNER, owner_email: OWNER };
    },
    assertOwnerOnly: (prospect) => prospect.email === OWNER,
    recipientFingerprint: fingerprint,
    suppressionStatus: suppressionStatus || (async () => ({ known: true, suppressed: false })),
    readiness: async () => ({ ready: true, blockers: [] }),
    liveSendsEnabled: true,
    now: () => new Date("2026-08-22T12:00:00.000Z"),
  };
  const row = {
    prospectId: canonical.prospect_id,
    businessName: canonical.business_name,
    previewUrl: canonical.preview_url,
    buildHash: BUILD_HASH,
    proofIdentity: PROOF_IDENTITY,
    releaseEvidence: releaseEvidence(),
    recipientFingerprint: fingerprint(RECIPIENT),
    status: "queued",
  };
  return { state, canonical, deps, row };
}

test("owner Practice prepares despite prospect contact terminals and suppression", async (t) => {
  const cases = [
    ["top-level do-not-contact", { status: "do_not_contact" }, "do_not_contact"],
    ["embedded held status wins over a stale queued projection", { record: { status: "held" } }, "held"],
    ["canonical suppression flag", { suppressed: true }, "suppressed"],
    ["embedded suppression verdict beats a stale top-level sendable projection", {
      contact_enrichment: {
        outreach: {
          review_hold: false,
          hold_reasons: [],
          sendable_email: RECIPIENT,
        },
      },
      record: {
        contact_enrichment: {
          outreach: {
            review_hold: true,
            hold_reasons: ["email_suppressed"],
            sendable_email: null,
          },
        },
      },
    }, "email_suppressed"],
  ];

  for (const [name, canonicalPatch] of cases) {
    await t.test(name, async () => {
      const { state, deps, row } = harness({ canonicalPatch });
      const sender = createLineSender({ lane: "sandbox", batchId: `practice-${name}`, deps });

      const plan = await sender.prepare(row);

      assert.equal(plan.ok, true, JSON.stringify(plan));
      assert.match(plan.inputFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(state.captures, 1);
      assert.equal(state.forcedOwner, 1);
      assert.equal(state.sends.length, 0);
    });
  }
});

test("Live still refuses the same prospect contact terminals and suppression", async (t) => {
  const cases = [
    ["top-level do-not-contact", { status: "do_not_contact" }, "do_not_contact"],
    ["embedded held status", { record: { status: "held" } }, "held"],
    ["canonical suppression flag", { suppressed: true }, "suppressed"],
    ["embedded suppression verdict", {
      record: {
        contact_enrichment: {
          outreach: {
            review_hold: true,
            hold_reasons: ["email_suppressed"],
            sendable_email: null,
          },
        },
      },
    }, "email_suppressed"],
  ];
  for (const [name, canonicalPatch, reason] of cases) {
    await t.test(name, async () => {
      const { state, deps, row } = harness({ canonicalPatch });
      const sender = createLineSender({ lane: "live", batchId: `live-${name}`, deps });
      const plan = await sender.prepare(row);
      assert.equal(plan.ok, false);
      assert.equal(plan.reason, reason);
      assert.equal(plan.policyHold, true);
      assert.equal(state.captures, 0);
      assert.equal(state.forcedOwner, 0);
      assert.equal(state.sends.length, 0);
    });
  }
});

test("sandbox owner proof also ignores prospect-address defects", async (t) => {
  const cases = [
    ["invalid canonical address", { email: "not-an-email" }],
    ["invalid verifier evidence", {
      email_verified: true,
      record: {
        email_verification: {
          status: "invalid",
          checked_at: "2026-08-22T11:00:00.000Z",
          method: "smtp_probe",
        },
      },
    }],
    ["explicitly unverified address", {
      contact_enrichment: {
        outreach: {
          review_hold: true,
          hold_reasons: ["email_reachability_unverified"],
          sendable_email: null,
        },
      },
    }],
  ];
  for (const [name, canonicalPatch] of cases) {
    await t.test(name, async () => {
      const { state, deps, row } = harness({ canonicalPatch });
      const sender = createLineSender({ lane: "sandbox", batchId: `owner-${name}`, deps });
      const plan = await sender.prepare(row);
      assert.equal(plan.ok, true, JSON.stringify(plan));
      assert.equal(state.forcedOwner, 1);
      assert.equal(state.sends.length, 0);
    });
  }
});

test("a prospect contact hold written during evidence does not veto owner Practice", async () => {
  const { state, deps, row } = harness({
    proofPersist: true,
    duringEvidence(canonical) {
      canonical.updated_at = "2026-08-22T12:00:01.000Z";
      canonical.record = { ...canonical.record, status: "held", blocked_reason: "blocked" };
    },
  });
  const sender = createLineSender({ lane: "sandbox", batchId: "guard-final-status", deps });

  const plan = await sender.prepare(row);

  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.match(plan.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(state.selects, 3, "Practice still reloads around the evidence CAS");
  assert.equal(state.captures, 1, "the adversary lands the hold after upstream evidence passes");
  assert.equal(state.upserts.length, 1);
  assert.equal(state.forcedOwner, 1);
  assert.equal(state.sends.length, 0);
});

test("a contact hold winning the evidence CAS is preserved when the bounded retry also conflicts", async () => {
  const { state, canonical, deps, row } = harness({ proofPersist: true });
  let attempts = 0;
  deps.conditionalUpdate = async (_table, _key, _keyValue, guards, patch) => {
    state.upserts.push({ guards, row: patch });
    attempts += 1;
    if (attempts === 1) {
      // A concurrent prospect-policy writer advances the row version. Practice
      // keeps that contact hold, reloads, and may retry only the owner evidence.
      canonical.updated_at = "2026-08-22T12:00:01.000Z";
      canonical.record = { ...canonical.record, status: "held", do_not_contact: true };
    }
    // A second concurrent write also wins, so bounded recovery must reconcile
    // rather than loop or overwrite either winner.
    return { ok: false, updated: false };
  };
  const sender = createLineSender({ lane: "sandbox", batchId: "guard-evidence-cas", deps });

  const plan = await sender.prepare(row);

  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "delivery_evidence_persist_conflict");
  assert.equal(plan.manualReconciliationRequired, true);
  assert.equal(plan.providerAttempted, false);
  assert.equal(state.upserts.length, 2, "Practice reloads once, then the second concurrent write wins too");
  assert.equal(canonical.status, "line_queued");
  assert.equal(canonical.record.status, "held");
  assert.equal(canonical.record.do_not_contact, true, "the newer canonical contact state survives");
  assert.equal(state.forcedOwner, 0);
  assert.equal(state.sends.length, 0);
});

test("owner Practice does not consult prospect suppression during evidence", async () => {
  let suppressionReads = 0;
  const { state, deps, row } = harness({
    suppressionStatus: async () => ({
      known: true,
      suppressed: ++suppressionReads >= 2,
    }),
  });
  const sender = createLineSender({ lane: "sandbox", batchId: "guard-final-suppression", deps });

  const plan = await sender.prepare(row);

  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(suppressionReads, 0, "prospect suppression is not an owner-proof input");
  assert.match(plan.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(state.upserts.length, 1, "only owner-proof evidence is written");
  assert.equal(state.forcedOwner, 1);
  assert.equal(state.sends.length, 0);
});

test("owner Practice does not query the durable prospect suppression table", async () => {
  const { state, canonical, deps, row } = harness();
  const reads = [];
  delete deps.suppressionStatus;
  deps.select = async (table, query) => {
    reads.push({ table, query });
    if (table === "ghost_agency_prospects") return { ok: true, data: [clone(canonical)] };
    if (table === "ghost_agency_suppressions") {
      return { ok: true, data: [{ prospect_id: canonical.prospect_id }] };
    }
    return { ok: false, data: [] };
  };
  const sender = createLineSender({ lane: "sandbox", batchId: "guard-default-suppression", deps });

  const plan = await sender.prepare(row);

  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.deepEqual(reads.map((read) => read.table), [
    "ghost_agency_prospects",
    "ghost_agency_prospects",
    "ghost_agency_prospects",
  ]);
  assert.equal(state.upserts.length, 1, "only owner-proof evidence is written");
  assert.equal(state.sends.length, 0);
});

test("a prospect suppression written after prepare still cannot stop owner-only delivery", async () => {
  let suppressionReads = 0;
  const { state, deps, row } = harness({
    suppressionStatus: async () => ({
      known: true,
      suppressed: ++suppressionReads >= 4,
    }),
  });
  const sender = createLineSender({ lane: "sandbox", batchId: "guard-provider-boundary", deps });
  const plan = await sender.prepare(row);
  assert.equal(plan.ok, true);
  assert.match(plan.inputFingerprint, /^[a-f0-9]{64}$/);

  const delivered = await sender.deliver(plan, { expectedInputFingerprint: plan.inputFingerprint });

  assert.equal(delivered.ok, true, JSON.stringify(delivered));
  assert.equal(suppressionReads, 0);
  assert.equal(state.sends.length, 1, "the provider receives only the owner envelope");
  assert.equal(state.sends[0].prospect.email, OWNER);
  assert.equal(state.sends[0].internalOwnerProof, true);
});
