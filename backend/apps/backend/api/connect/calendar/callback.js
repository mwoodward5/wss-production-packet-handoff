"use strict";
const { appRedirectUrl, callbackUri, createCalendarOAuthService } = require("../../../lib/connect-calendar-oauth");

function redirect(res, fragment) {
  res.statusCode = 302;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", `${appRedirectUrl()}#${fragment}`);
  return res.end();
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") { res.statusCode = 405; return res.end("method not allowed"); }
  const code = String(req.query?.code || "").trim();
  const state = String(req.query?.state || "").trim();
  if (req.query?.error) return redirect(res, `connect_error=${encodeURIComponent("Connection was cancelled.")}`);
  if (!code || !state) return redirect(res, `connect_error=${encodeURIComponent("Missing Google Calendar OAuth response.")}`);
  try {
    const result = await createCalendarOAuthService().complete({ code, state, redirectUri: callbackUri() });
    return redirect(res, `connected=google_calendar&name=${encodeURIComponent(result.accountName || "Google Calendar")}`);
  } catch (error) {
    return redirect(res, `connect_error=${encodeURIComponent(error.code || "Google Calendar connection failed.")}`);
  }
};

module.exports._test = { redirect };
