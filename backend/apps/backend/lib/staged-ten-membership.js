"use strict";

const { createHash } = require("node:crypto");
const { verifyFreshGetFoundProof, normalizeGrade } = require("./getfound-proof");
const {
  DRAFT_COUNT,
  HOLD_KEY,
} = require("./supervised-held-drafts");
const { select } = require("./store");

const HELD_STATE = Object.freeze({
  compose_mode: "dry_run",
  delivery_status: "review_only",
  approval_status: "awaiting_explicit_later_approval",
});

function failed(reason, detail) {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

function first(record = {}, names = []) {
  const nested = record.record && typeof record.record === "object" ? record.record : {};
  for (const name of names) {
    const found = record[name] ?? nested[name];
    if (found !== undefined && found !== null && String(found).trim()) return found;
  }
  return "";
}

function prospectId(prospect = {}) {
  return String(first(prospect, ["prospect_id", "prospectId", "id"])).trim();
}

function prospectEmail(prospect = {}) {
  return String(first(prospect, ["email", "owner_email", "ownerEmail"])).trim().toLowerCase();
}

function deterministicStagedDraftId({ prospectId: id = "", recipientEmail = "" } = {}) {
  const digest = createHash("sha256")
    .update(`${HOLD_KEY}|${String(id).trim()}|${String(recipientEmail).trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16], 16) & 3) | 8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validHeldDraft(row = {}) {
  const id = String(row.prospect_id || "").trim();
  const email = String(row.recipient_email || "").trim().toLowerCase();
  const grade = normalizeGrade(row.getfound_grade);
  return Boolean(
    id
    && email
    && grade
    && row.hold_key === HOLD_KEY
    && row.draft_id === deterministicStagedDraftId({ prospectId: id, recipientEmail: email })
    // Consent-first drafts offer to build only after a reply. The deprecated
    // compatibility column must not carry a prebuilt URL.
    && !String(row.preview_url || "").trim()
    && row.getfound_grade === grade
    && row.compose_mode === HELD_STATE.compose_mode
    && row.delivery_status === HELD_STATE.delivery_status
    && row.approval_status === HELD_STATE.approval_status
    && String(row.subject || "").trim()
    && String(row.body || "").trim()
  );
}

function exactHeldBatch(rows = []) {
  if (!Array.isArray(rows) || rows.length !== DRAFT_COUNT || rows.some((row) => !validHeldDraft(row))) return false;
  return new Set(rows.map((row) => row.draft_id)).size === DRAFT_COUNT
    && new Set(rows.map((row) => String(row.prospect_id).trim())).size === DRAFT_COUNT
    && new Set(rows.map((row) => String(row.recipient_email).trim().toLowerCase())).size === DRAFT_COUNT;
}

function sameDurableDraft(candidate = {}, durable = {}) {
  return [
    "draft_id",
    "hold_key",
    "prospect_id",
    "preview_url",
    "getfound_grade",
    "subject",
    "body",
    "compose_mode",
    "delivery_status",
    "approval_status",
  ].every((key) => candidate[key] === durable[key])
    && String(candidate.recipient_email || "").trim().toLowerCase()
      === String(durable.recipient_email || "").trim().toLowerCase();
}

async function defaultLoadHold() {
  const result = await select(
    "ghost_agency_supervision_holds",
    `?select=hold_key,status,created_at&hold_key=eq.${encodeURIComponent(HOLD_KEY)}&limit=2`,
  );
  return { mode: result.mode, rows: result.data || [] };
}

async function defaultLoadDrafts() {
  const result = await select(
    "ghost_agency_outbound_review_drafts",
    `?select=draft_id,hold_key,prospect_id,recipient_email,preview_url,getfound_grade,subject,body,compose_mode,delivery_status,approval_status,created_at&hold_key=eq.${encodeURIComponent(HOLD_KEY)}&order=created_at.asc&limit=${DRAFT_COUNT + 1}`,
  );
  return { mode: result.mode, rows: result.data || [] };
}

async function verifyStagedTenMembership(input = {}, dependencies = {}) {
  const prospect = input.prospect && typeof input.prospect === "object" ? input.prospect : null;
  const loadHold = dependencies.loadHold || defaultLoadHold;
  const loadDrafts = dependencies.loadDrafts || defaultLoadDrafts;
  const verifyGetFound = dependencies.verifyFreshGetFoundProof || verifyFreshGetFoundProof;

  if (!prospect) return failed("staged_ten_prospect_required");

  const id = prospectId(prospect);
  const email = prospectEmail(prospect);
  if (!id || !email) return failed("staged_ten_prospect_identity_incomplete");

  let hold;
  let batch;
  try {
    [hold, batch] = await Promise.all([loadHold(), loadDrafts()]);
  } catch {
    return failed("staged_ten_state_unavailable");
  }
  if (!hold || hold.mode !== "live_select" || !Array.isArray(hold.rows)) {
    return failed("staged_ten_hold_state_unavailable");
  }
  if (
    hold.rows.length !== 1
    || hold.rows[0]?.hold_key !== HOLD_KEY
    || hold.rows[0]?.status !== "active"
  ) {
    return failed("staged_ten_durable_hold_inactive");
  }
  if (!batch || batch.mode !== "live_select" || !Array.isArray(batch.rows)) {
    return failed("staged_ten_batch_state_unavailable");
  }
  if (!exactHeldBatch(batch.rows)) {
    return failed("staged_ten_batch_not_exact", { rowCount: batch.rows.length });
  }

  const requestedDraftId = String(input.draftId || input.draft?.draft_id || "").trim();
  const matches = batch.rows.filter((row) => (
    String(row.prospect_id).trim() === id
    && (!requestedDraftId || row.draft_id === requestedDraftId)
  ));
  if (matches.length !== 1) return failed("staged_ten_draft_not_in_active_batch");
  const draft = matches[0];
  if (input.draft && !sameDurableDraft(input.draft, draft)) {
    return failed("staged_ten_draft_state_mismatch");
  }
  if (String(draft.recipient_email).trim().toLowerCase() !== email) {
    return failed("staged_ten_recipient_identity_mismatch");
  }

  let getfound;
  try {
    getfound = await verifyGetFound({
      prospect,
      expectedGrade: draft.getfound_grade,
      nowMs: input.nowMs,
      fetchImpl: input.fetchImpl,
    });
  } catch {
    return failed("staged_ten_getfound_proof_invalid", { reason: "unavailable" });
  }
  if (!getfound || getfound.ok !== true) {
    return failed("staged_ten_getfound_proof_invalid", { reason: getfound?.reason || "unavailable" });
  }
  if (normalizeGrade(getfound.grade) !== draft.getfound_grade) {
    return failed("staged_ten_getfound_grade_mismatch");
  }

  return {
    ok: true,
    holdKey: HOLD_KEY,
    batchSize: DRAFT_COUNT,
    draft,
    getfound,
  };
}

module.exports = {
  HELD_STATE,
  deterministicStagedDraftId,
  exactHeldBatch,
  verifyStagedTenMembership,
};
