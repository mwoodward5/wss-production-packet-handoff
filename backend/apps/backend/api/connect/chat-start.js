"use strict";

// POST { slug, body, website? } — starts one anonymous website conversation.
// `slug` is a lookup handle only; it must resolve to our own site data before
// it can route anything. The response contains no contact or prospect fields.

const {
  createVisitorMessage,
  honeypotFilled,
  ipRateLimited,
  knownSite,
  normalizeMessage,
  normalizeSiteSlug,
  originSiteSlug,
  queueVisitorPush,
  readPublicBody,
  sendJson,
  setCors,
  slugRateLimited,
} = require("../../lib/connect-chat");
const { scheduleAssistantBooking } = require("../../lib/connect-assistant-booking");

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const input = await readPublicBody(req);
    // Same silent honeypot posture as the quote form: store nothing and teach
    // the bot nothing about the field that stopped it.
    if (honeypotFilled(input)) return sendJson(res, 200, { ok: true });

    const siteSlug = normalizeSiteSlug(input.slug || input.site);
    const body = normalizeMessage(input.body || input.message);
    if (!siteSlug || !body) {
      return sendJson(res, 400, { ok: false, error: "slug_and_body_required" });
    }
    const originSlug = originSiteSlug(req);
    if (!originSlug || originSlug !== siteSlug) {
      return sendJson(res, 403, { ok: false, error: "origin_not_allowed" });
    }
    if (ipRateLimited("start", req) || slugRateLimited("start", siteSlug)) {
      return sendJson(res, 429, { ok: false, error: "rate_limited" });
    }

    const site = await knownSite(siteSlug);
    if (!site.ok) {
      return sendJson(res, site.unavailable ? 503 : 404, {
        ok: false,
        error: site.unavailable ? "site_lookup_unavailable" : "site_not_available",
      });
    }

    const created = await createVisitorMessage({ siteSlug, body });
    queueVisitorPush({ siteSlug, threadId: created.threadId, snippet: body });
    // A plain factual first question (hours, address, services, area) takes the
    // fast lane: evaluate the takeover on the SEND so the answer is generated
    // now, not on the widget's next six-second poll. Anything that is not a
    // lookup stays inside the owner-first window here and is picked up by the
    // poll exactly as before. Awaited so the durable reservation is claimed
    // before this invocation can freeze; the model call runs off the response.
    await scheduleAssistantBooking({ siteSlug, threadId: created.threadId, thread: null });
    return sendJson(res, 200, {
      ok: true,
      token: created.token,
      threadId: created.threadId,
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
