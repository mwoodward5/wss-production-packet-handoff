"use strict";

// Operator reply queue. GET lists pending agent drafts (from the events
// ledger). POST {draftId, action:"approve"|"reject", body?} — approve sends
// the (optionally edited) draft via Resend and records reply.sent.

const { requireAdmin } = require("../../lib/admin-auth");
const { deliveryPauseStatus } = require("../../lib/delivery-pause");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { recordEvent, select, selectRows } = require("../../lib/store");
const { sendResendEmail, suppressionBlocked } = require("../../lib/email");

function pendingDraftsFromEvents(rows = [], limit = 100) {
  const resolved = new Set(
    rows.filter((r) => ["reply.sent", "reply.rejected"].includes(r.type)).map((r) => r.payload && r.payload.draftId),
  );
  return rows
    .filter((r) => r.type === "reply.draft" && r.payload && r.payload.approval === "pending" && !resolved.has(r.payload.draftId))
    .slice(0, limit)
    .map((r) => ({ createdAt: r.created_at, ...r.payload }));
}

async function enrichDrafts(drafts = [], eventRows = []) {
  const inboundReplies = new Map();
  const prospectReplies = new Map();
  for (const row of eventRows) {
    if (row?.type !== "reply.received" || !row.payload) continue;
    const inboundId = String(row.payload.inboundId || "").trim();
    const prospectId = String(row.payload.prospectId || "").trim();
    const preview = String(row.payload.preview || "").trim();
    if (inboundId && preview && !inboundReplies.has(inboundId)) inboundReplies.set(inboundId, preview);
    if (prospectId && preview && !prospectReplies.has(prospectId)) prospectReplies.set(prospectId, preview);
  }

  const ids = [...new Set(drafts.map((draft) => String(draft.prospectId || "").trim()).filter(Boolean))];
  let prospects = [];
  if (ids.length) {
    const found = await select(
      "ghost_agency_prospects",
      `?select=prospect_id,business_name&prospect_id=in.(${ids.map(encodeURIComponent).join(",")})&limit=${ids.length}`,
    );
    prospects = found?.ok && Array.isArray(found.data) ? found.data : [];
  }
  const names = new Map(prospects.map((row) => [
    String(row.prospect_id || "").trim(),
    String(row.business_name || "").trim(),
  ]));

  return drafts.map((draft) => {
    const inboundId = String(draft.inboundId || "").trim();
    const prospectId = String(draft.prospectId || "").trim();
    return {
      ...draft,
      businessName: names.get(prospectId) || String(draft.businessName || "").trim() || "Unknown business",
      originalReply: (inboundId && inboundReplies.get(inboundId)) || prospectReplies.get(prospectId) || "",
    };
  });
}

async function loadDrafts(limit = 100, { enrich = false } = {}) {
  const events = await selectRows("ghost_agency_events", {
    select: "id,type,payload,created_at",
    order: "created_at.desc",
    limit: 400,
  });
  const rows = Array.isArray(events && events.rows) ? events.rows : [];
  const drafts = pendingDraftsFromEvents(rows, limit);
  return enrich ? enrichDrafts(drafts, rows) : drafts;
}

async function approvalSuppressionStatus(draft = {}) {
  const recipient = String(draft.fromEmail || "").trim().toLowerCase();
  if (!recipient) {
    return { ok: false, blocked: "reply_recipient_missing", statusCode: 422 };
  }

  let suppression;
  try {
    suppression = await suppressionBlocked(
      { prospect_id: draft.prospectId, email: recipient },
      recipient,
    );
  } catch {
    suppression = { unavailable: true };
  }

  if (suppression?.blocked) {
    return { ok: false, blocked: "reply_recipient_suppressed", statusCode: 409 };
  }
  if (!suppression || suppression.unavailable === true) {
    return { ok: false, blocked: "reply_suppression_check_unavailable", statusCode: 503 };
  }
  return { ok: true, recipient };
}

async function approvalDeliveryPauseStatus() {
  let pause;
  try {
    pause = await deliveryPauseStatus();
  } catch {
    pause = { active: true, known: false, reason: "delivery_pause_status_unavailable" };
  }
  const unavailable = !pause
    || typeof pause.active !== "boolean"
    || pause.ok === false
    || pause.known !== true;
  if (unavailable || pause.active === true) {
    return {
      ok: false,
      blocked: String(pause?.reason || (unavailable ? "delivery_pause_status_unavailable" : "outreach_delivery_paused")),
      statusCode: unavailable || pause?.known === false ? 503 : 409,
    };
  }
  return { ok: true };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === "GET") {
      const drafts = await loadDrafts(100, { enrich: true });
      sendJson(res, 200, { ok: true, pending: drafts.length, drafts });
      return;
    }
    const body = await readJson(req);
    const draftId = String(body.draftId || "").trim();
    const action = String(body.action || "").trim();
    if (!draftId || !["approve", "reject"].includes(action)) {
      sendJson(res, 400, { ok: false, error: "need draftId + action approve|reject" });
      return;
    }
    const drafts = await loadDrafts(400);
    const draft = drafts.find((d) => d.draftId === draftId);
    if (!draft) {
      sendJson(res, 404, { ok: false, error: "draft_not_found_or_resolved" });
      return;
    }
    if (action === "reject") {
      await recordEvent("reply.rejected", { draftId, prospectId: draft.prospectId, by: "operator" });
      sendJson(res, 200, { ok: true, action: "rejected", draftId });
      return;
    }
    const text = String(body.body || draft.body || "").trim();
    // Last read before the provider boundary: a STOP or bounce may have landed
    // after this draft was queued. Fail closed if the suppression store cannot
    // prove the recipient is still eligible.
    const sendGate = await approvalSuppressionStatus(draft);
    if (!sendGate.ok) {
      sendJson(res, sendGate.statusCode, { ok: false, error: sendGate.blocked, draftId });
      return;
    }
    const pauseGate = await approvalDeliveryPauseStatus();
    if (!pauseGate.ok) {
      sendJson(res, pauseGate.statusCode, { ok: false, error: pauseGate.blocked, draftId });
      return;
    }
    const sent = await sendResendEmail({
      to: sendGate.recipient,
      subject: draft.subject,
      text,
      idempotencyKey: `ghost-reply/${draftId}`.slice(0, 256),
    });
    if (!sent || sent.mode !== "sent") {
      sendJson(res, 502, {
        ok: false,
        error: sent?.blocked || sent?.reason || sent?.error || "reply_provider_send_failed",
        draftId,
      });
      return;
    }
    await recordEvent("reply.sent", {
      draftId, prospectId: draft.prospectId, fromEmail: sendGate.recipient,
      mode: body.body ? "operator_edited" : "operator_approved", providerId: sent.id || null,
    });
    sendJson(res, 200, { ok: true, action: "sent", draftId, provider: sent.mode || "resend", providerId: sent.id || null });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.approvalSuppressionStatus = approvalSuppressionStatus;
module.exports.approvalDeliveryPauseStatus = approvalDeliveryPauseStatus;
module.exports.enrichDrafts = enrichDrafts;
module.exports.loadDrafts = loadDrafts;
module.exports.pendingDraftsFromEvents = pendingDraftsFromEvents;
