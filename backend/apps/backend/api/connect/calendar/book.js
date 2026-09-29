"use strict";
const { resolveConnectScope } = require("../../../lib/connect");
const { calendarCors, createCalendarOAuthService, readJsonBody, resolveScopedSiteSlug, sendJson } = require("../../../lib/connect-calendar-oauth");

function description(body) {
  const rows = [
    body.customerName ? `Customer: ${String(body.customerName).trim().slice(0, 300)}` : "",
    body.phone ? `Phone: ${String(body.phone).trim().slice(0, 80)}` : "",
    body.email ? `Email: ${String(body.email).trim().slice(0, 320)}` : "",
    body.description ? String(body.description).trim().slice(0, 6000) : "",
  ];
  return rows.filter(Boolean).join("\n");
}

module.exports = async function handler(req, res) {
  if (calendarCors(req, res, ["POST"])) return;
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, booked: false, error: "method_not_allowed" });
  try {
    const body = await readJsonBody(req);
    const resolved = resolveScopedSiteSlug(resolveConnectScope(req), req, body);
    if (!resolved.ok) return sendJson(res, resolved.status, { ok: false, booked: false, error: resolved.error });
    const client = await createCalendarOAuthService().calendarClient(resolved.siteSlug);
    const result = await client.createEvent({
      idempotencyKey: body.idempotencyKey, summary: body.summary,
      start: body.start, end: body.end, timeZone: body.timeZone, workHours: body.workHours,
      attendeeEmail: body.email, sendUpdates: body.sendUpdates,
      description: description(body), location: body.location,
    });
    if (!result.ok || result.confirmed !== true || result.status !== "confirmed") {
      return sendJson(res, 502, { ok: false, booked: false, confirmed: false, error: result.reason || "calendar_event_not_confirmed" });
    }
    return sendJson(res, 200, { ok: true, booked: true, confirmed: true, eventId: result.eventId, htmlLink: result.htmlLink, start: result.start, end: result.end, timeZone: result.timeZone });
  } catch (error) {
    return sendJson(res, error.status || (error.code?.includes("invalid") || error.code?.includes("required") ? 400 : 502), { ok: false, booked: false, confirmed: false, error: error.code || "calendar_booking_failed" });
  }
};

module.exports._test = { description };
