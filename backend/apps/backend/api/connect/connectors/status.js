"use strict";
const { resolveConnectScope } = require("../../../lib/connect");
const { select } = require("../../../lib/store");
const { calendarCors, createCalendarOAuthService, resolveScopedSiteSlug, sendJson } = require("../../../lib/connect-calendar-oauth");

const CHANNEL_BY_PLATFORM = Object.freeze({
  facebook: "facebook_messenger",
  instagram: "instagram_dm",
  linkedin: "linkedin_dm",
  twitter: "x_dm",
  tiktok: "tiktok_dm",
});

function safeExistingConnectors(rows) {
  const connectors = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const channel = CHANNEL_BY_PLATFORM[String(row?.platform || "").trim().toLowerCase()];
    if (!channel) continue;
    connectors[channel] = {
      connected: row.is_active === true,
      ...(row.account_name ? { accountName: String(row.account_name).trim().slice(0, 500) } : {}),
    };
  }
  return connectors;
}

async function readExistingConnectors(siteSlug) {
  const result = await select(
    "connect_connectors",
    `select=platform,is_active,account_name&site_slug=eq.${encodeURIComponent(siteSlug)}&platform=in.(facebook,instagram,linkedin,twitter,tiktok)`,
  );
  if (!result?.ok || !Array.isArray(result.data)) throw new Error("connector_status_read_failed");
  return safeExistingConnectors(result.data);
}

module.exports = async function handler(req, res) {
  if (calendarCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  const resolved = resolveScopedSiteSlug(resolveConnectScope(req), req);
  if (!resolved.ok) return sendJson(res, resolved.status, { ok: false, error: resolved.error });
  try {
    const [existing, result] = await Promise.all([
      readExistingConnectors(resolved.siteSlug),
      createCalendarOAuthService().status(resolved.siteSlug),
    ]);
    const connectors = {
      ...existing,
      ...(result.enabled && result.google_calendar ? { google_calendar: result.google_calendar } : {}),
    };
    return sendJson(res, 200, { ok: true, siteSlug: resolved.siteSlug, ...existing, connectors });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.code || "connector_status_failed" });
  }
};

module.exports._test = { safeExistingConnectors };
