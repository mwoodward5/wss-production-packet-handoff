"use strict";

const { resolveConnectScope } = require("../../../lib/connect");
const { calendarCors, resolveScopedSiteSlug, sendJson } = require("../../../lib/connect-calendar-oauth");
const { deleteConnector, resolveLegacyConnector } = require("../../../lib/connect-legacy-connectors");

module.exports = async function handler(req, res) {
  if (calendarCors(req, res, ["DELETE"])) return;
  if (req.method !== "DELETE") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

  const resolved = resolveScopedSiteSlug(
    resolveConnectScope(req),
    req,
    { slug: req.query?.slug || req.query?.site },
  );
  if (!resolved.ok) return sendJson(res, resolved.status, { ok: false, error: resolved.error });

  const connector = resolveLegacyConnector(req.query?.platform);
  if (!connector) {
    return sendJson(res, 501, {
      ok: false,
      error: "connector_not_implemented",
      platform: String(req.query?.platform || "").trim().toLowerCase(),
    });
  }

  try {
    const deleted = await deleteConnector(resolved.siteSlug, connector);
    return sendJson(res, 200, {
      ok: true,
      siteSlug: resolved.siteSlug,
      platform: connector.requestedPlatform,
      provider: connector.storagePlatform,
      channel: connector.channel,
      connected: false,
      disconnected: true,
      deleted,
    });
  } catch (error) {
    return sendJson(res, error.status || 502, { ok: false, error: error.code || "connector_disconnect_failed" });
  }
};
