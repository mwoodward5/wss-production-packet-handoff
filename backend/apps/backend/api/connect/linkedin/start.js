"use strict";
// GET /api/connect/linkedin/start?site=<slug>
// Kicks off the real LinkedIn OAuth popup. No auth header required (browser
// navigation the WSS Connect app opens via window.open), but the
// redirect_uri is always this backend's own callback, and every session is
// bound to a random server-side state, so nothing here can be replayed or
// redirected to an attacker-controlled URL.

const { startLinkedInOAuth } = require("../../../lib/connect-oauth-linkedin");

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
    const redirectUri = `${base}/api/connect/linkedin/callback`;
    const authUrl = await startLinkedInOAuth({ siteSlug, redirectUri });
    res.statusCode = 302;
    res.setHeader("Location", authUrl);
    return res.end();
  } catch (err) {
    res.statusCode = 500;
    return res.end(`Could not start LinkedIn connection: ${String(err.message || err)}`);
  }
};
