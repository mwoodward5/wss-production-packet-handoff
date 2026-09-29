"use strict";
// GET /api/connect/meta/start?platform=facebook|instagram&site=<slug>
// Kicks off the real Meta OAuth popup — the "click, get an OAuth box" flow.
// No auth header required here (it's a browser navigation the WSS Connect
// app opens via window.open), but the redirect_uri is always this backend's
// own callback, and every session is bound to a random server-side state, so
// nothing here can be replayed or redirected to an attacker-controlled URL.

const { startMetaOAuth } = require("../../../lib/connect-oauth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("method not allowed");
  }
  try {
    const platform = req.query?.platform === "instagram" ? "instagram" : "facebook";
    const siteSlug = String(req.query?.site || "").trim().slice(0, 120);
    if (!siteSlug) {
      res.statusCode = 400;
      return res.end("missing site");
    }
    const base = process.env.GHOST_AGENCY_API_URL || "https://ghost-agency-backend.vercel.app";
    const redirectUri = `${base}/api/connect/meta/callback`;
    const authUrl = await startMetaOAuth({ platform, siteSlug, redirectUri });
    res.statusCode = 302;
    res.setHeader("Location", authUrl);
    return res.end();
  } catch (err) {
    res.statusCode = 500;
    return res.end(`Could not start Meta connection: ${String(err.message || err)}`);
  }
};
