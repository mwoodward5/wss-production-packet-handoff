"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  deterministicStagedDraftId,
  exactHeldBatch,
  verifyStagedTenMembership,
} = require("../lib/staged-ten-membership");
const { DRAFT_COUNT, HOLD_KEY } = require("../lib/supervised-held-drafts");

const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");

function prospect() {
  return {
    prospect_id: "prospect-1",
    business_name: "Business 1",
    email: "owner1@example.test",
    current_website: "https://business-1.example",
    report_url: "https://callprep.wss-ai.com/report/1",
  };
}

function drafts() {
  return Array.from({ length: DRAFT_COUNT }, (_, index) => {
    const number = index + 1;
    const id = `prospect-${number}`;
    const email = `owner${number}@example.test`;
    return {
      draft_id: deterministicStagedDraftId({ prospectId: id, recipientEmail: email }),
      hold_key: HOLD_KEY,
      prospect_id: id,
      recipient_email: email,
      preview_url: null,
      getfound_grade: "C",
      subject: `Draft ${number}`,
      body: `Held review body ${number}`,
      compose_mode: "dry_run",
      delivery_status: "review_only",
      approval_status: "awaiting_explicit_later_approval",
      created_at: "2026-07-19T10:00:00.000Z",
    };
  });
}

function deps(rows = drafts(), overrides = {}) {
  return {
    loadHold: async () => ({ mode: "live_select", rows: [{ hold_key: HOLD_KEY, status: "active" }] }),
    loadDrafts: async () => ({ mode: "live_select", rows: structuredClone(rows) }),
    verifyFreshGetFoundProof: async () => ({ ok: true, grade: "C", source: "callprep_validated_fresh_report" }),
    ...overrides,
  };
}

test("verifies one owner-copy candidate against the exact active staged ten", async () => {
  const rows = drafts();
  let proofInput;
  const result = await verifyStagedTenMembership({
    prospect: prospect(),
    draftId: rows[0].draft_id,
    draft: structuredClone(rows[0]),
    nowMs: NOW_MS,
  }, deps(rows, {
    verifyFreshGetFoundProof: async (input) => {
      proofInput = input;
      return { ok: true, grade: "C", source: "callprep_validated_fresh_report" };
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.batchSize, 10);
  assert.equal(result.holdKey, HOLD_KEY);
  assert.equal(result.draft.draft_id, rows[0].draft_id);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "release"), false);
  assert.equal(result.getfound.grade, "C");
  assert.equal(proofInput.expectedGrade, "C");
  assert.equal(proofInput.nowMs, NOW_MS);
  assert.equal(exactHeldBatch(rows), true);
});

test("requires one durable active hold but does not require the global send hold at membership time", async () => {
  const globalSendHoldOff = await verifyStagedTenMembership({ prospect: prospect() }, deps(drafts(), {
    reviewHoldActive: () => false,
  }));
  assert.equal(globalSendHoldOff.ok, true);

  for (const rows of [[], [{ hold_key: HOLD_KEY, status: "released" }], [
    { hold_key: HOLD_KEY, status: "active" },
    { hold_key: HOLD_KEY, status: "active" },
  ]]) {
    const result = await verifyStagedTenMembership({ prospect: prospect() }, deps(drafts(), {
      loadHold: async () => ({ mode: "live_select", rows }),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "staged_ten_durable_hold_inactive");
  }
});

test("rejects partial, duplicate, forged, or deliverable batch rows", async () => {
  const cases = [
    ["partial", (rows) => rows.pop()],
    ["duplicate prospect", (rows) => { rows[1].prospect_id = rows[0].prospect_id; rows[1].draft_id = deterministicStagedDraftId({ prospectId: rows[1].prospect_id, recipientEmail: rows[1].recipient_email }); }],
    ["forged id", (rows) => { rows[0].draft_id = "00000000-0000-5000-8000-000000000000"; }],
    ["sendable", (rows) => { rows[0].delivery_status = "ready_to_send"; }],
    ["approved", (rows) => { rows[0].approval_status = "approved"; }],
    ["not dry run", (rows) => { rows[0].compose_mode = "send"; }],
    ["prebuilt preview", (rows) => { rows[0].preview_url = "https://previews.wss-ai.com/forbidden"; }],
    ["missing grade", (rows) => { rows[0].getfound_grade = ""; }],
  ];
  for (const [label, mutate] of cases) {
    const rows = drafts();
    mutate(rows);
    const result = await verifyStagedTenMembership({ prospect: prospect() }, deps(rows));
    assert.equal(result.ok, false, label);
    assert.equal(result.reason, "staged_ten_batch_not_exact", label);
  }
});

test("requires the requested or supplied draft to exactly match its durable batch member", async () => {
  const rows = drafts();
  const missing = await verifyStagedTenMembership({ prospect: prospect(), draftId: rows[1].draft_id }, deps(rows));
  assert.equal(missing.reason, "staged_ten_draft_not_in_active_batch");

  const forged = structuredClone(rows[0]);
  forged.preview_url = "https://previews.wss-ai.com/forged";
  const mismatch = await verifyStagedTenMembership({ prospect: prospect(), draft: forged }, deps(rows));
  assert.equal(mismatch.reason, "staged_ten_draft_state_mismatch");

  const wrongEmail = prospect();
  wrongEmail.email = "different@example.test";
  const recipient = await verifyStagedTenMembership({ prospect: wrongEmail }, deps(rows));
  assert.equal(recipient.reason, "staged_ten_recipient_identity_mismatch");
});

test("consent-first membership does not require or inspect preview release evidence", async () => {
  const candidate = prospect();
  candidate.preview_url = "https://legacy-preview.example.test";
  candidate.release_evidence = { schema: "forged-and-irrelevant" };
  let obsoleteReleaseCalls = 0;

  const result = await verifyStagedTenMembership({ prospect: candidate }, deps(drafts(), {
    phaseOneReleaseEvidence: () => {
      obsoleteReleaseCalls += 1;
      throw new Error("obsolete release gate must not run");
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(obsoleteReleaseCalls, 0);
  assert.equal(result.draft.preview_url, null);
});

test("requires a fresh validated GetFound result that exactly matches the staged grade", async () => {
  const invalid = await verifyStagedTenMembership({ prospect: prospect() }, deps(drafts(), {
    verifyFreshGetFoundProof: async () => ({ ok: false, reason: "getfound_proof_invalid_or_stale" }),
  }));
  assert.equal(invalid.reason, "staged_ten_getfound_proof_invalid");
  assert.deepEqual(invalid.detail, { reason: "getfound_proof_invalid_or_stale" });

  const mismatch = await verifyStagedTenMembership({ prospect: prospect() }, deps(drafts(), {
    verifyFreshGetFoundProof: async () => ({ ok: true, grade: "A" }),
  }));
  assert.equal(mismatch.reason, "staged_ten_getfound_grade_mismatch");

  const thrown = await verifyStagedTenMembership({ prospect: prospect() }, deps(drafts(), {
    verifyFreshGetFoundProof: async () => { throw new Error("offline"); },
  }));
  assert.equal(thrown.reason, "staged_ten_getfound_proof_invalid");
  assert.deepEqual(thrown.detail, { reason: "unavailable" });
});

test("fails closed when durable state cannot be read", async () => {
  const unavailable = await verifyStagedTenMembership({ prospect: prospect() }, deps(drafts(), {
    loadDrafts: async () => ({ mode: "dry_run", rows: [] }),
  }));
  assert.equal(unavailable.reason, "staged_ten_batch_state_unavailable");

  const thrown = await verifyStagedTenMembership({ prospect: prospect() }, deps(drafts(), {
    loadHold: async () => { throw new Error("offline"); },
  }));
  assert.equal(thrown.reason, "staged_ten_state_unavailable");
});
