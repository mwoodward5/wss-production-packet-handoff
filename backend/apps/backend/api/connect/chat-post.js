"use strict";

// POST { body, website? } with x-connect-visitor-token.
// The signed token supplies both thread and tenant. Body-supplied routing is
// intentionally absent from this endpoint.

const {
  addVisitorMessage,
  honeypotFilled,
  ipRateLimited,
  normalizeMessage,
  originSiteSlug,
  queueVisitorPush,
  readPublicBody,
  sendJson,
  setCors,
  slugRateLimited,
  visitorClaims,
} = require("../../lib/connect-chat");
const { scheduleAssistantBooking } = require("../../lib/connect-assistant-booking");

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const input = await readPublicBody(req);
    if (honeypotFilled(input)) return sendJson(res, 200, { ok: true });

    const body = normalizeMessage(input.body || input.message);
    if (!body) return sendJson(res, 400, { ok: false, error: "body_required" });
    if (ipRateLimited("post", req)) {
      return sendJson(res, 429, { ok: false, error: "rate_limited" });
    }

    const claims = visitorClaims(req);
    if (!claims) {
      return sendJson(res, 401, { ok: false, error: "invalid_or_expired_session" });
    }
    const originSlug = originSiteSlug(req);
    if (!originSlug || originSlug !== claims.siteSlug) {
      return sendJson(res, 403, { ok: false, error: "origin_not_allowed" });
    }
    if (slugRateLimited("post", claims.siteSlug)) {
      return sendJson(res, 429, { ok: false, error: "rate_limited" });
    }

    const created = await addVisitorMessage({ ...claims, body });
    if (!created) return sendJson(res, 404, { ok: false, error: "thread_not_found" });

    queueVisitorPush({ siteSlug: claims.siteSlug, threadId: claims.threadId, snippet: body });
    // Same fast lane as chat-start: a plain factual follow-up is answered on the
    // send instead of waiting for the next poll. Non-lookup messages fall inside
    // the owner-first window here and are handled by the poll as before.
    await scheduleAssistantBooking({ siteSlug: claims.siteSlug, threadId: claims.threadId, thread: null });
    return sendJson(res, 200, {
      ok: true,
      messageId: created.messageId || null,
      status: "sent",
    });
  } catch (error) {
    if (error && error.code === "request_body_too_large") {
      return sendJson(res, 413, { ok: false, error: "request_too_large" });
    }
    return sendJson(res, 503, { ok: false, error: "chat_unavailable" });
  }
};
