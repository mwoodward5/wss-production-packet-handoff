"use strict";

const { sendJson } = require("../../../../lib/connect-calendar-oauth");
const { appOrigin, callbackUri, completeConnectorOAuth, resolveLegacyConnector } = require("../../../../lib/connect-legacy-connectors");

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", location);
  return res.end();
}

function errorRedirect(res, message) {
  return redirect(res, `${appOrigin()}#connect_error=${encodeURIComponent(message)}`);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

  const connector = resolveLegacyConnector(req.query?.platform);
  if (!connector) {
    return sendJson(res, 501, {
      ok: false,
      error: "connector_not_implemented",
      platform: String(req.query?.platform || "").trim().toLowerCase(),
    });
  }

  if (String(req.query?.error || "").trim()) return errorRedirect(res, "Connection was cancelled.");

  const code = String(req.query?.code || "").trim();
  const state = String(req.query?.state || "").trim();
  if (!code || !state) return errorRedirect(res, "Missing OAuth response from the provider.");

  try {
    const result = await completeConnectorOAuth({
      connector,
      code,
      state,
      redirectUri: callbackUri(connector),
    });
    if (!result?.ok) return errorRedirect(res, result?.error || "The connection could not be completed.");
    return redirect(
      res,
      `${appOrigin()}#connected=${encodeURIComponent(connector.channel)}&platform=${encodeURIComponent(connector.requestedPlatform)}&name=${encodeURIComponent(result.accountName || "")}`,
    );
  } catch (error) {
    return errorRedirect(res, String(error?.message || "The connection could not be completed.").slice(0, 500));
  }
};

module.exports._test = { errorRedirect, redirect };
