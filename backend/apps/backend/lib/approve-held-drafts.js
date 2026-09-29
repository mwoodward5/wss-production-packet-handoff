"use strict";

// The explicit approve -> send lever for the "supervised_10_review_pending"
// held-draft queue. supervised-held-drafts.js deliberately never sends
// anything ("a review artifact queue, never a delivery queue"); this module
// is the one place that turns a human's approval of a *subset* of that
// already-staged batch into real sendSequenceStep calls.
//
// This module never changes what gets staged (that stays the exclusive job
// of createHeldDraftQueue). It only:
//   1. Re-verifies (right now, not at staging time) that each requested
//      prospect id is still an exact, unaltered member of the one active
//      held batch, with exact recipient identity and a fresh GetFound grade
//      (verifyStagedTenMembership - the same gate owner-smoke.js relies on).
//   2. Refuses to send anything already recorded in the email log (the same
//      dedup lib/full-run.js's real "send ~100 now" lever uses).
//   3. Calls the real lib/email.js sendSequenceStep with every existing gate
//      left intact - reviewHoldActive, deliveryPauseStatus, suppression,
//      outreachBuildQuality, sender/DNS/webhook config. Nothing here is
//      allowed to bypass any of them.
//   4. Defaults dryRun to true, so "wire it up" and "actually fire it" are
//      two different, explicit calls.

const { createHash, randomUUID } = require("node:crypto");
const { sendSequenceStep } = require("./email");
const { emailLogExists } = require("./full-run");
const { prospectFromRow, prospectId } = require("./prospects");
const { verifyStagedTenMembership } = require("./staged-ten-membership");
const { DRAFT_COUNT, HOLD_KEY } = require("./supervised-held-drafts");
const { insertRow, select } = require("./store");

const SEND_CONFIRMATION = "SEND_APPROVED_HELD_DRAFTS";
const SEND_AUDIT_EVENT_TYPE = "outbound.held_draft.approved_send";
const RETIRED_COLD_ARTIFACT_KEYS = Object.freeze([
  "preview_url",
  "previewUrl",
  "preview_host",
  "previewHost",
  "checkout_url",
  "checkoutUrl",
  "report_url",
  "reportUrl",
  "callprep_report_url",
  "callprepReportUrl",
  "preview_expires_at",
  "previewExpiresAt",
  "preview_expiry_date",
  "previewExpiryDate",
  "sunset_date",
  "sunsetDate",
  "build_dispatch",
  "siteforge_callback",
  "release_evidence",
  "forge_job",
]);

function deterministicId(...parts) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16], 16) & 3) | 8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseProspectIds(input = {}) {
  if (!Array.isArray(input.prospectIds) || !input.prospectIds.length) {
    return { error: "prospect_ids_required" };
  }
  if (input.prospectIds.length > DRAFT_COUNT) {
    return { error: "too_many_prospect_ids", detail: { max: DRAFT_COUNT } };
  }
  const ids = input.prospectIds.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (ids.some((id) => !id || id.length > 200)) {
    return { error: "prospect_ids_must_be_non_empty_strings" };
  }
  if (new Set(ids).size !== ids.length) {
    return { error: "prospect_ids_must_be_unique" };
  }
  return { ids };
}

async function defaultLoadProspects(ids = []) {
  if (!ids.length) return { ok: true, byId: new Map() };
  const filter = ids.map((id) => encodeURIComponent(id)).join(",");
  const result = await select("ghost_agency_prospects", `?select=*&prospect_id=in.(${filter})`);
  if (!result.ok || !Array.isArray(result.data)) return { ok: false };
  const byId = new Map();
  for (const row of result.data) {
    const prospect = prospectFromRow(row);
    const id = prospect && prospectId(prospect);
    if (id) byId.set(id, prospect);
  }
  return { ok: true, byId };
}

async function defaultRecordSendAudit({ prospectIdValue, draftId, runId, mode, resendId }) {
  return insertRow("ghost_agency_events", {
    id: deterministicId(HOLD_KEY, "approved_send_result", prospectIdValue, draftId, runId),
    type: SEND_AUDIT_EVENT_TYPE,
    payload: {
      actor: "admin_approve_held_drafts",
      status: "sent",
      hold_key: HOLD_KEY,
      prospectId: prospectIdValue,
      draftId,
      runId,
      mode,
      resendId: resendId || null,
    },
    created_at: new Date().toISOString(),
  });
}

function stripRetiredColdArtifacts(source = {}) {
  const clean = source && typeof source === "object" && !Array.isArray(source) ? { ...source } : {};
  for (const key of RETIRED_COLD_ARTIFACT_KEYS) delete clean[key];
  return clean;
}

function consentFirstProspect(prospect = {}) {
  return {
    ...stripRetiredColdArtifacts(prospect),
    record: stripRetiredColdArtifacts(prospect.record),
    consent_first: true,
  };
}

async function approveOne(id, { dryRun, runId }, deps) {
  const prospect = deps.byId.get(id);
  if (!prospect) {
    return { prospectId: id, ok: false, sent: false, reason: "prospect_not_found" };
  }

  // Re-verify membership NOW, not at staging time: this fails closed if the
  // active durable hold changed, the batch or recipient is no longer exact,
  // or the GetFound grade is no longer fresh/matching.
  let membership;
  try {
    membership = await deps.verifyStagedTenMembership({ prospect, nowMs: deps.now() });
  } catch {
    membership = { ok: false, reason: "staged_ten_state_unavailable" };
  }
  if (!membership?.ok) {
    return {
      prospectId: id,
      ok: false,
      sent: false,
      reason: membership?.reason || "staged_ten_membership_unverified",
      detail: membership?.detail,
    };
  }
  const draft = membership.draft;

  // Same dedup source of truth lib/full-run.js's real send lever uses. Read
  // before every attempt (dry run included) so the operator sees the honest
  // "already sent" reality even while rehearsing.
  let duplicate;
  try {
    duplicate = await deps.emailLogExists(prospect);
  } catch {
    duplicate = { exists: true, reason: "email_log_check_failed" };
  }
  if (duplicate?.exists) {
    return { prospectId: id, ok: false, sent: false, reason: `already_sent:${duplicate.reason}` };
  }

  // No allowReviewHoldBypass / allowDeliveryPauseBypass / allowBuildQualityBypass
  // / internalOwnerProof - every existing lib/email.js gate applies exactly as
  // it would for any other real prospect send.
  const result = await deps.sendSequenceStep({
    prospect: consentFirstProspect(prospect),
    sequence: 1,
    step: 1,
    dryRun,
    vars: { run_id: runId, consent_first: true },
  });

  if (!result || result.ok !== true) {
    return {
      prospectId: id,
      ok: false,
      sent: false,
      reason: result?.blocked || result?.error || "send_failed",
    };
  }

  if (!dryRun && result.mode === "sent") {
    try {
      await deps.recordSendAudit({
        prospectIdValue: id,
        draftId: draft.draft_id,
        runId,
        mode: result.mode,
        resendId: result.id,
      });
    } catch {
      // Best-effort audit trail only - the send itself already succeeded and
      // is already durably recorded in ghost_agency_email_log by
      // sendSequenceStep. Never fail the response over this.
    }
  }

  return {
    prospectId: id,
    ok: true,
    sent: result.mode === "sent",
    mode: result.mode,
    resendId: result.id || null,
    draftId: draft.draft_id,
  };
}

async function approveHeldDrafts(input = {}, dependencies = {}) {
  const dryRun = input.dryRun !== false;
  if (!dryRun && input.confirmation !== SEND_CONFIRMATION) {
    return {
      ok: false,
      blocked: "send_confirmation_required",
      message: `Sending requires exact confirmation "${SEND_CONFIRMATION}".`,
    };
  }

  const parsed = parseProspectIds(input);
  if (parsed.error) {
    return { ok: false, blocked: parsed.error, detail: parsed.detail };
  }

  const deps = {
    now: () => Date.now(),
    loadProspects: defaultLoadProspects,
    verifyStagedTenMembership,
    emailLogExists,
    sendSequenceStep,
    recordSendAudit: defaultRecordSendAudit,
    ...dependencies,
  };

  const loaded = await deps.loadProspects(parsed.ids);
  if (!loaded?.ok) {
    return { ok: false, blocked: "prospect_store_unavailable" };
  }

  const runId = input.runId || `approve_send_${deps.now()}_${randomUUID().slice(0, 8)}`;
  const approved = [];
  const skipped = [];
  // Sequential on purpose: this is a human-triggered approval of at most
  // DRAFT_COUNT prospects, not a bulk campaign loop. Serial processing keeps
  // per-prospect gates (delivery pause, dedup) consistent across the batch.
  for (const id of parsed.ids) {
    const outcome = await approveOne(id, { dryRun, runId }, { ...deps, byId: loaded.byId });
    if (outcome.ok) approved.push(outcome);
    else skipped.push(outcome);
  }

  const sendsPerformed = approved.filter((item) => item.sent).length;
  return {
    ok: true,
    dryRun,
    runId,
    holdKey: HOLD_KEY,
    requested: parsed.ids.length,
    approved,
    skipped,
    sendsPerformed,
  };
}

module.exports = {
  SEND_CONFIRMATION,
  approveHeldDrafts,
};
