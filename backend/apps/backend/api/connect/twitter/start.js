"use strict";
// GET /api/connect/twitter/start?site=<slug>
// Kicks off the real X (Twitter) OAuth popup, including server-generated
// PKCE. No auth header required (browser navigation the WSS Connect app
// opens via window.open), but the redirect_uri is always this backend's own
// callback, and every session is bound to a random server-side state, so
// nothing here can be replayed or redirected to an attacker-controlled URL.

const { startTwitterOAuth } = require("../../../lib/connect-oauth-twitter");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("method not allowed");
  }
  try {
    const siteSlug = String(req.query?.site || "").trim().slice(0, 120);
    if (!siteSlug) {
      res.statusCode = 400;
      return res.end("missing site");
    }
    const base = process.env.GHOST_AGENCY_API_URL || "https://ghost-agency-backend.vercel.app";
    const redirectUri = `${base}/api/connect/twitter/callback`;
    const authUrl = await startTwitterOAuth({ siteSlug, redirectUri });
    res.statusCode = 302;
    res.setHeader("Location", authUrl);
    return res.end();
  } catch (err) {
    res.statusCode = 500;
    return res.end(`Could not start X connection: ${String(err.message || err)}`);
  }
};
