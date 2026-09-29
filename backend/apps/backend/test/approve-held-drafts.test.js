"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { SEND_CONFIRMATION, approveHeldDrafts } = require("../lib/approve-held-drafts");
const { HOLD_KEY } = require("../lib/supervised-held-drafts");

function prospect(id = "prospect-1") {
  return {
    prospect_id: id,
    business_name: `Business ${id}`,
    email: `${id}@example.test`,
    preview_url: `https://previews.wss-ai.com/${id}`,
    report_url: `https://reports.wss-ai.com/${id}`,
    checkout_url: "https://buy.stripe.com/retired",
    preview_expires_at: "2026-08-05T00:00:00.000Z",
    release_evidence: { ok: true },
    record: {
      preview_url: `https://previews.wss-ai.com/${id}`,
      report_url: `https://reports.wss-ai.com/${id}`,
      checkout_url: "https://buy.stripe.com/retired",
      build_dispatch: { ready: true },
    },
  };
}

function draft(id = "prospect-1") {
  return {
    draft_id: `draft-${id}`,
    hold_key: HOLD_KEY,
    prospect_id: id,
    recipient_email: `${id}@example.test`,
  };
}

function baseDeps(overrides = {}) {
  const sendCalls = [];
  const auditCalls = [];
  return {
    now: () => 1_700_000_000_000,
    loadProspects: async (ids) => ({
      ok: true,
      byId: new Map(ids.map((id) => [id, prospect(id)])),
    }),
    verifyStagedTenMembership: async ({ prospect: p }) => ({
      ok: true,
      draft: draft(p.prospect_id),
    }),
    emailLogExists: async () => ({ exists: false }),
    sendSequenceStep: async (input) => {
      sendCalls.push(input);
      return { ok: true, mode: "dry_run" };
    },
    recordSendAudit: async (input) => {
      auditCalls.push(input);
      return { mode: "live_write" };
    },
    _sendCalls: sendCalls,
    _auditCalls: auditCalls,
    ...overrides,
  };
}

test("defaults to dryRun true and never counts a simulated send as sent", async () => {
  const deps = baseDeps();
  const result = await approveHeldDrafts({ prospectIds: ["prospect-1"] }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.sendsPerformed, 0);
  assert.equal(result.approved.length, 1);
  assert.equal(result.approved[0].sent, false);
  assert.equal(result.approved[0].mode, "dry_run");
  assert.equal(deps._sendCalls.length, 1);
  assert.equal(deps._sendCalls[0].dryRun, true);
  assert.equal(deps._auditCalls.length, 0, "dry runs must never write a send audit event");
});

test("never passes any gate-bypass flag to sendSequenceStep", async () => {
  const deps = baseDeps();
  await approveHeldDrafts({ prospectIds: ["prospect-1"], dryRun: true }, deps);
  const call = deps._sendCalls[0];
  assert.notEqual(call.allowReviewHoldBypass, true);
  assert.notEqual(call.allowDeliveryPauseBypass, true);
  assert.notEqual(call.allowBuildQualityBypass, true);
  assert.notEqual(call.internalOwnerProof, true);
});

test("strips every retired build, preview, report, checkout, and expiry artifact before the cold send", async () => {
  const deps = baseDeps();
  const result = await approveHeldDrafts({ prospectIds: ["prospect-1"] }, deps);
  assert.equal(result.approved.length, 1);
  const call = deps._sendCalls[0];
  assert.equal(call.prospect.consent_first, true);
  assert.equal(call.vars.consent_first, true);
  for (const key of [
    "preview_url",
    "report_url",
    "checkout_url",
    "preview_expires_at",
    "release_evidence",
    "build_dispatch",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(call.prospect, key), false, `prospect.${key}`);
    assert.equal(Object.prototype.hasOwnProperty.call(call.prospect.record, key), false, `prospect.record.${key}`);
    assert.equal(Object.prototype.hasOwnProperty.call(call.vars, key), false, `vars.${key}`);
  }
});

test("performs a real send only with dryRun:false and the exact confirmation phrase", async () => {
  const sendCalls = [];
  const deps = baseDeps({
    sendSequenceStep: async (input) => {
      sendCalls.push(input);
      return { ok: true, mode: "sent", id: "resend-abc" };
    },
  });
  const missingConfirmation = await approveHeldDrafts({ prospectIds: ["prospect-1"], dryRun: false }, deps);
  assert.equal(missingConfirmation.ok, false);
  assert.equal(missingConfirmation.blocked, "send_confirmation_required");
  assert.equal(sendCalls.length, 0);

  const wrongConfirmation = await approveHeldDrafts(
    { prospectIds: ["prospect-1"], dryRun: false, confirmation: "nope" },
    deps,
  );
  assert.equal(wrongConfirmation.blocked, "send_confirmation_required");
  assert.equal(sendCalls.length, 0);

  const result = await approveHeldDrafts(
    { prospectIds: ["prospect-1"], dryRun: false, confirmation: SEND_CONFIRMATION },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.equal(result.sendsPerformed, 1);
  assert.equal(result.approved[0].sent, true);
  assert.equal(result.approved[0].resendId, "resend-abc");
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].dryRun, false);
  assert.equal(deps._auditCalls.length, 1);
  assert.equal(deps._auditCalls[0].prospectIdValue, "prospect-1");
});

test("skips and reports why when staged-ten membership no longer verifies", async () => {
  const deps = baseDeps({
    verifyStagedTenMembership: async () => ({ ok: false, reason: "staged_ten_getfound_grade_mismatch" }),
  });
  const result = await approveHeldDrafts({ prospectIds: ["prospect-1"] }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.approved.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "staged_ten_getfound_grade_mismatch");
  assert.equal(deps._sendCalls.length, 0, "a failed membership check must never reach sendSequenceStep");
});

test("skips already-sent drafts using the same email_log dedup lib/full-run.js real sends use", async () => {
  const deps = baseDeps({
    emailLogExists: async () => ({ exists: true, reason: "email_log_prospect" }),
  });
  const result = await approveHeldDrafts({ prospectIds: ["prospect-1"] }, deps);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "already_sent:email_log_prospect");
  assert.equal(deps._sendCalls.length, 0);
});

test("skips and reports the exact lib/email.js gate that blocked a send", async () => {
  const deps = baseDeps({
    sendSequenceStep: async () => ({ ok: false, blocked: "outreach_review_hold" }),
  });
  const result = await approveHeldDrafts(
    { prospectIds: ["prospect-1"], dryRun: false, confirmation: SEND_CONFIRMATION },
    deps,
  );
  assert.equal(result.approved.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "outreach_review_hold");
  assert.equal(result.sendsPerformed, 0);
});

test("reports prospect_not_found for ids missing from the durable prospect store", async () => {
  const deps = baseDeps({
    loadProspects: async () => ({ ok: true, byId: new Map() }),
  });
  const result = await approveHeldDrafts({ prospectIds: ["missing-1"] }, deps);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "prospect_not_found");
});

test("handles a mixed batch: one legitimate send alongside one blocked prospect", async () => {
  const deps = baseDeps({
    verifyStagedTenMembership: async ({ prospect: p }) => {
      if (p.prospect_id === "prospect-2") return { ok: false, reason: "staged_ten_draft_not_in_active_batch" };
      return { ok: true, draft: draft(p.prospect_id) };
    },
  });
  const result = await approveHeldDrafts({ prospectIds: ["prospect-1", "prospect-2"] }, deps);
  assert.equal(result.requested, 2);
  assert.equal(result.approved.length, 1);
  assert.equal(result.approved[0].prospectId, "prospect-1");
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].prospectId, "prospect-2");
});

test("validates prospectIds shape before touching any dependency", async () => {
  const deps = baseDeps();
  const empty = await approveHeldDrafts({}, deps);
  assert.equal(empty.blocked, "prospect_ids_required");

  const tooMany = await approveHeldDrafts(
    { prospectIds: Array.from({ length: 11 }, (_, i) => `p-${i}`) },
    deps,
  );
  assert.equal(tooMany.blocked, "too_many_prospect_ids");

  const duplicate = await approveHeldDrafts({ prospectIds: ["prospect-1", "prospect-1"] }, deps);
  assert.equal(duplicate.blocked, "prospect_ids_must_be_unique");

  assert.equal(deps._sendCalls.length, 0);
});

test("fails closed when the durable prospect store is unavailable", async () => {
  const deps = baseDeps({ loadProspects: async () => ({ ok: false }) });
  const result = await approveHeldDrafts({ prospectIds: ["prospect-1"] }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "prospect_store_unavailable");
});
