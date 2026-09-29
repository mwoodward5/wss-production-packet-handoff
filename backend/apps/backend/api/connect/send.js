"use strict";
// POST /api/connect/send { threadId, body } — the business owner's reply to one
// of their own leads, sent from their dashboard.
//
// Scoped like the rest of Connect, with the SAME asymmetry as messages.js:
//   * a full/admin token (the operator Connect app) may reply in any thread;
//   * a per-customer scoped token may reply ONLY in a thread whose site_slug
//     matches its own. A tenant naming another business's thread gets 404 —
//     never a reply delivered into someone else's conversation.
// Delivery still flows through lib/connect deliverOutbound (email via Resend,
// site chat via visitor poll, other channels stored and queued). New PWA
// callers may attach a clientMessageId so an offline retry reserves one durable
// message before delivery and cannot send that reply twice.
const {
  resolveConnectScope,
  readBody,
  addMessage,
  normalizeClientMessageId,
  reserveOutboundMessage,
  completeOutboundMessage,
  touchThread,
  deliverOutbound,
} = require("../../lib/connect");
const { select, recordEvent } = require("../../lib/store");

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = ["https://connect.wss-labs.com", "https://wss-ai.com", "https://www.wss-ai.com"];
  res.setHeader("Access-Control-Allow-Origin", allowed.includes(origin) ? origin : "https://connect.wss-labs.com");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(body));
}

function confirmedDelivery(delivery) {
  return delivery?.delivered === true || delivery?.queued === true;
}

function safeDeliveryEvent(delivery) {
  const via = String(delivery?.via || "");
  return {
    channel: String(delivery?.channel || "unknown").slice(0, 24),
    delivered: delivery?.delivered === true,
    queued: delivery?.queued === true,
    ...(via === "visitor_poll" ? { via } : {}),
  };
}

function pendingDelivery(res, status, reservation, error = "delivery_pending") {
  return json(res, status, {
    ok: false,
    error,
    retryable: true,
    messageId: reservation?.message?.id || null,
    clientMessageId: reservation?.message?.client_message_id || null,
    deliveryStatus: "pending",
  });
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") { res.statusCode = 405; return res.end("method not allowed"); }
  const scope = resolveConnectScope(req);
  if (!scope) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: "unauthorized" })); }
  try {
    const body = await readBody(req);
    const threadId = parseInt(String(body.threadId || ""), 10);
    const text = String(body.body || "").trim().slice(0, 5000);
    const clientId = normalizeClientMessageId(body.clientMessageId);
    if (!clientId.ok) return json(res, 400, { ok: false, error: clientId.error });
    if (!threadId || !text) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: "threadId and body required" })); }
    const found = await select("connect_threads", `id=eq.${threadId}&limit=1`);
    const thread = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
    if (!thread) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, error: "thread not found" })); }
    // A tenant can only reply into its own thread. Fail closed on a mismatch —
    // a 404, indistinguishable from a thread that does not exist, so a tenant
    // cannot confirm the existence of another business's thread by writing to it.
    if (scope.mode === "tenant" && String(thread.site_slug || "") !== String(scope.siteSlug || "")) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok: false, error: "thread not found" }));
    }

    // Old clients did not send a clientMessageId. Preserve that API contract;
    // the installed PWA's durable outbox uses the idempotent branch below.
    if (!clientId.value) {
      const delivery = await deliverOutbound(thread, text);
      if (!confirmedDelivery(delivery)) {
        return json(res, 502, { ok: false, error: "delivery_not_confirmed", retryable: true });
      }
      const msg = await addMessage(threadId, "outbound", text, { delivery });
      await touchThread(threadId, { unread: false });
      await recordEvent("connect_outbound", {
        threadId,
        ...safeDeliveryEvent(delivery),
        scope: scope.mode,
        idempotent: false,
      });
      return json(res, 200, { ok: true, message: msg, delivery });
    }

    const reservation = await reserveOutboundMessage({
      thread,
      text,
      clientMessageId: clientId.value,
    });
    if (reservation.state === "conflict") {
      return json(res, 409, { ok: false, error: "client_message_conflict", retryable: false });
    }
    if (reservation.state === "delivery_unknown") {
      return json(res, 409, {
        ok: false,
        error: "delivery_unknown",
        retryable: false,
        manual: true,
        messageId: reservation.message?.id || null,
        clientMessageId: clientId.value,
        deliveryStatus: "delivery_unknown",
      });
    }
    if (reservation.state === "in_progress") {
      const retryAfterSeconds = Math.max(1, Math.ceil(Number(reservation.retryAfterMs || 1000) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return json(res, 409, {
        ok: false,
        error: "message_in_progress",
        retryable: true,
        retryAfterMs: retryAfterSeconds * 1000,
        messageId: reservation.message?.id || null,
        clientMessageId: clientId.value,
        deliveryStatus: "pending",
      });
    }
    if (reservation.state === "completed") {
      return json(res, 200, {
        ok: true,
        message: reservation.message,
        delivery: reservation.delivery,
        idempotent: true,
      });
    }
    if (reservation.state !== "reserved") {
      throw new Error("connect_message_reservation_state_invalid");
    }

    // The pending row is durable before any provider call. This touch makes it
    // visible at the top of the thread list even if the provider is temporarily
    // unreachable; its meta still says pending, never sent.
    await touchThread(threadId, { unread: false });
    const idempotencyKey = `wss-connect/${threadId}/${clientId.value}`;
    let delivery;
    try {
      delivery = await deliverOutbound(thread, text, { idempotencyKey });
    } catch {
      return pendingDelivery(res, 503, reservation);
    }
    if (!confirmedDelivery(delivery)) return pendingDelivery(res, 502, reservation, "delivery_not_confirmed");

    let completed;
    try {
      completed = await completeOutboundMessage({ reservation, delivery });
    } catch {
      return pendingDelivery(res, 503, reservation, "delivery_checkpoint_pending");
    }
    await recordEvent("connect_outbound", {
      threadId,
      ...safeDeliveryEvent(completed.delivery),
      scope: scope.mode,
      idempotent: true,
      replay: completed.idempotent === true,
    });
    return json(res, 200, {
      ok: true,
      message: completed.message,
      delivery: completed.delivery,
      idempotent: completed.idempotent === true,
    });
  } catch (e) {
    const code = String(e?.code || e?.message || "connect_send_failed");
    const safe = /^connect_message_[a-z0-9_]+$/.test(code) ? code : "connect_send_failed";
    return json(res, 500, { ok: false, error: safe });
  }
};
