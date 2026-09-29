"use strict";
const { resolveConnectScope } = require("../../../lib/connect");
const { calendarCors, createCalendarOAuthService, readJsonBody, resolveScopedSiteSlug, sendJson } = require("../../../lib/connect-calendar-oauth");

module.exports = async function handler(req, res) {
  if (calendarCors(req, res, ["GET", "POST"])) return;
  if (!new Set(["GET", "POST"]).has(req.method)) return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  try {
    const body = req.method === "POST" ? await readJsonBody(req) : {};
    const resolved = resolveScopedSiteSlug(resolveConnectScope(req), req, body);
    if (!resolved.ok) return sendJson(res, resolved.status, { ok: false, error: resolved.error });
    const service = createCalendarOAuthService();
    const result = req.method === "GET"
      ? await service.calendars(resolved.siteSlug)
      : await service.selectCalendar(resolved.siteSlug, body.calendarId);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.code || "calendar_request_failed" });
  }
};
