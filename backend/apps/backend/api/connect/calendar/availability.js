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
    const client = await createCalendarOAuthService().calendarClient(resolved.siteSlug);
    const result = await client.findAvailableSlots({
      timeMin: body.timeMin, timeMax: body.timeMax, durationMinutes: body.durationMinutes,
      slotStepMinutes: body.slotStepMinutes, workHours: body.workHours, limit: body.limit,
    });
    return sendJson(res, result.ok ? 200 : 409, result);
  } catch (error) {
    return sendJson(res, error.status || (error.code?.includes("invalid") || error.code?.includes("required") ? 400 : 502), { ok: false, enabled: true, error: error.code || "calendar_availability_failed", slots: [] });
  }
};
