"use strict";
const { resolveConnectScope } = require("../../../lib/connect");
const { calendarCors, createCalendarOAuthService, readJsonBody, resolveScopedSiteSlug, sendJson } = require("../../../lib/connect-calendar-oauth");

module.exports = async function handler(req, res) {
  if (calendarCors(req, res, ["POST"])) return;
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  try {
    const body = await readJsonBody(req);
    const resolved = resolveScopedSiteSlug(resolveConnectScope(req), req, body);
    if (!resolved.ok) return sendJson(res, resolved.status, { ok: false, error: resolved.error });
    const result = await createCalendarOAuthService().disconnect(resolved.siteSlug);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.code || "calendar_disconnect_failed" });
  }
};
