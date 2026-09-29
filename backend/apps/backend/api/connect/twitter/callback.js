"use strict";
// GET /api/connect/twitter/callback?code=...&state=...
// X redirects here after the user approves (or denies) the consent dialog.
// On success, redirects the browser back into WSS Connect with
// #connected=twitter so the app can show the green checkmark toast — the
// access token itself never touches the browser.

const { completeTwitterOAuth } = require("../../../lib/connect-oauth-twitter");

const APP_URL = process.env.CONNECT_APP_URL || process.env.NEXT_PUBLIC_CONNECT_APP_URL;

function appUrl(req) {
  if (APP_URL) return String(APP_URL).trim().replace(/\/+$/, "");
  const host = String(req?.headers?.origin || req?.headers?.host || "").trim();
  if (host) {
    if (/^https?:\/\//.test(host)) return host.replace(/\/+$/, "");
    return `https://${host}`.replace(/\/+$/, "");
  }
  return "https://connect.wss-labs.com";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("method not allowed");
  }
  const code = String(req.query?.code || "").trim();
  const state = String(req.query?.state || "").trim();
  const deniedByUser = String(req.query?.error || "").trim();

  if (deniedByUser) {
    res.statusCode = 302;
    res.setHeader("Location", `${appUrl(req)}#connect_error=${encodeURIComponent("Connection was cancelled.")}`);
    return res.end();
  }
  if (!code || !state) {
    res.statusCode = 302;
      res.setHeader("Location", `${appUrl(req)}#connect_error=${encodeURIComponent("Missing OAuth response from X.")}`);
    return res.end();
  }

  try {
    const base = process.env.GHOST_AGENCY_API_URL || "https://ghost-agency-backend.vercel.app";
    const redirectUri = `${base}/api/connect/twitter/callback`;
    const result = await completeTwitterOAuth({ code, state, redirectUri });
    if (!result.ok) {
      res.statusCode = 302;
      res.setHeader("Location", `${appUrl(req)}#connect_error=${encodeURIComponent(result.error)}`);
      return res.end();
    }
    res.statusCode = 302;
    res.setHeader(
      "Location",
      `${appUrl(req)}#connected=${encodeURIComponent(result.platform)}&name=${encodeURIComponent(result.accountName || "")}`
    );
    return res.end();
  } catch (err) {
    res.statusCode = 302;
    res.setHeader("Location", `${appUrl(req)}#connect_error=${encodeURIComponent(String(err.message || err))}`);
    return res.end();
  }
};
