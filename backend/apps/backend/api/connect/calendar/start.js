"use strict";
const { resolveConnectScope } = require("../../../lib/connect");
const { calendarCors, createCalendarOAuthService, resolveScopedSiteSlug, sendJson } = require("../../../lib/connect-calendar-oauth");

module.exports = async function handler(req, res) {
  if (calendarCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  const resolved = resolveScopedSiteSlug(resolveConnectScope(req), req);
  if (!resolved.ok) return sendJson(res, resolved.status, { ok: false, error: resolved.error });
  try {
    const result = await createCalendarOAuthService().start(resolved.siteSlug);
    return sendJson(res, 200, { ok: true, authorizationUrl: result.authorizationUrl });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.code || "calendar_oauth_start_failed" });
  }
};
