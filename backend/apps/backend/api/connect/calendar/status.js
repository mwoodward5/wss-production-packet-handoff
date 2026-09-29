"use strict";
const { resolveConnectScope } = require("../../../lib/connect");
const { calendarCors, createCalendarOAuthService, resolveScopedSiteSlug, sendJson } = require("../../../lib/connect-calendar-oauth");

module.exports = async function handler(req, res) {
  if (calendarCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  const scope = resolveConnectScope(req);
  const resolved = resolveScopedSiteSlug(scope, req);
  if (!resolved.ok) return sendJson(res, resolved.status, { ok: false, error: resolved.error });
  try {
    const result = await createCalendarOAuthService().status(resolved.siteSlug);
    return sendJson(res, 200, { ...result, siteSlug: resolved.siteSlug });
  }
  catch (error) { return sendJson(res, error.status || 500, { ok: false, error: error.code || "calendar_status_failed" }); }
};
