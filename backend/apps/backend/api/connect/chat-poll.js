"use strict";

// GET ?after=<message id> with x-connect-visitor-token.
// POST with { after } is also accepted as a read-only transport for hosts that
// cannot attach the custom header to GET.
//
// This poll is also the clock for the AI takeover. The widget already ticks
// every six seconds while it is open, so "answer if the owner hasn't within
// takeover_seconds" needs no cron and no worker — see lib/connect-ai-takeover.js
// for why that is the design and not a shortcut. The read stays a read: the
// takeover's own writes are a reservation and a reply, scheduled AFTER this
// response is sent, so the poll's latency is unchanged.

const {
  ipRateLimited,
  normalizeCursor,
  originSiteSlug,
  readVisitorMessages,
  readPublicBody,
  sendJson,
  setCors,
  slugRateLimited,
  visitorClaims,
} = require("../../lib/connect-chat");
// Decide and claim synchronously, generate off the response — the whole
// wrapper, and why it is safe, lives in lib/connect-ai-takeover.js. The same
// helper now runs on the send endpoints too, so a fast-lane answer need not
// wait for the next poll tick.
const { scheduleAssistantBooking } = require("../../lib/connect-assistant-booking");

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  try {
    if (ipRateLimited("poll", req)) {
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
    if (slugRateLimited("poll", claims.siteSlug)) {
      return sendJson(res, 429, { ok: false, error: "rate_limited" });
    }

    const input = req.method === "POST" ? await readPublicBody(req) : (req.query || {});
    const after = normalizeCursor(input.after);
    if (after === null) return sendJson(res, 400, { ok: false, error: "invalid_cursor" });

    const result = await readVisitorMessages({ ...claims, after });
    if (!result) return sendJson(res, 404, { ok: false, error: "thread_not_found" });
    // Awaited, not fired-and-forgotten: the decision is three cheap reads and
    // the claim must be durable before this invocation can be frozen. The
    // model call is what gets scheduled past the response.
    await scheduleAssistantBooking({
      threadId: claims.threadId,
      siteSlug: claims.siteSlug,
      thread: result.thread || null,
    });
    return sendJson(res, 200, {
      ok: true,
      messages: result.messages,
      cursor: result.cursor,
    });
  } catch (error) {
    if (error && error.code === "request_body_too_large") {
      return sendJson(res, 413, { ok: false, error: "request_too_large" });
    }
    return sendJson(res, 503, { ok: false, error: "chat_unavailable" });
  }
};
