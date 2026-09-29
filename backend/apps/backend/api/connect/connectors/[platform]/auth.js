"use strict";

const { resolveConnectScope } = require("../../../../lib/connect");
const { calendarCors, resolveScopedSiteSlug, sendJson } = require("../../../../lib/connect-calendar-oauth");
const { callbackUri, resolveLegacyConnector, startConnectorOAuth } = require("../../../../lib/connect-legacy-connectors");

module.exports = async function handler(req, res) {
  if (calendarCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

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
    const callbackUrl = callbackUri(connector);
    const authUrl = await startConnectorOAuth({ connector, siteSlug: resolved.siteSlug, redirectUri: callbackUrl });
    return sendJson(res, 200, {
      ok: true,
      siteSlug: resolved.siteSlug,
      platform: connector.requestedPlatform,
      provider: connector.storagePlatform,
      channel: connector.channel,
      authUrl,
      authorizationUrl: authUrl,
      callbackUrl,
    });
  } catch (error) {
    const notConfigured = /not configured/i.test(String(error?.message || ""));
    return sendJson(res, error.status || (notConfigured ? 503 : 500), {
      ok: false,
      error: error.code || (notConfigured ? "connector_oauth_not_configured" : "connector_auth_start_failed"),
      platform: connector.requestedPlatform,
    });
  }
};
