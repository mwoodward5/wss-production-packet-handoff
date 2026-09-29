"use strict";
// GET /api/connect/auth/:provider/callback?code=...&state=...
//
// Compatibility callback for provider-level OAuth redirect URIs
// used by external OAuth app registrations (e.g. /api/connect/auth/facebook/callback).
// The flow mirrors connector callbacks and then redirects back to the Connect app
// as a hash-based completion signal.

const { completeMetaOAuth } = require("../../../../lib/connect-oauth");
const { completeTwitterOAuth } = require("../../../../lib/connect-oauth-twitter");
const { completeTikTokOAuth } = require("../../../../lib/connect-oauth-tiktok");
const { completeLinkedInOAuth } = require("../../../../lib/connect-oauth-linkedin");
const { getProviderForConnectorRoute, legacyIdsForProvider } = require("../../connectors/_platforms");

const APP_URL = process.env.CONNECT_APP_URL || process.env.NEXT_PUBLIC_CONNECT_APP_URL;

function backendBase(req) {
  return process.env.GHOST_AGENCY_API_URL || `https://${req.headers.host || "ghost-agency-backend.vercel.app"}`;
}

function appUrl(req) {
  if (APP_URL) return String(APP_URL).trim().replace(/\/+$/, "");
  const host = String(req?.headers?.origin || req?.headers?.host || "").trim();
  if (host) {
    if (/^https?:\/\//.test(host)) return host.replace(/\/+$/, "");
    return `https://${host}`.replace(/\/+$/, "");
  }
  return "https://connect.wss-labs.com";
}

function callbackDestination(base, query) {
  const safeBase = String(base || "").trim().replace(/\/+$/, "");
  const params = new URLSearchParams(query || {});
  // The Connect app popup handshake parses the hash fragment
  // (#connected=<platform>&name=... / #connect_error=<message>), matching the
  // connector callbacks. Query params would only resolve via the close-fallback.
  return `${safeBase}/#${params.toString()}`;
}

function legacyPlatformFromProvider(provider) {
  const legacyIds = legacyIdsForProvider(provider || "");
  return legacyIds.length > 0 ? legacyIds[0] : provider;
}

function redirectWithPayload(res, redirectUrl) {
  res.statusCode = 302;
  res.setHeader("Location", redirectUrl);
  return res.end();
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("method not allowed");
  }

  const provider = String(req.query?.provider || "").trim();
  const routeProvider = getProviderForConnectorRoute(provider);
  if (!provider) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "missing provider" }));
  }
  if (!routeProvider) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: `callback not implemented: ${provider}` }));
  }

  const code = String(req.query?.code || "").trim();
  const state = String(req.query?.state || "").trim();
  const error = String(req.query?.error || req.query?.error_description || "").trim();
  const redirectBase = appUrl(req);
  const redirectUrl = (messageKey, message) => callbackDestination(redirectBase, {
    platform: legacyPlatformFromProvider(routeProvider),
    [messageKey]: String(message || ""),
  });

  if (error) {
    return redirectWithPayload(res, redirectUrl("connect_error", error || "Connection was cancelled."));
  }
  if (!code || !state) {
    return redirectWithPayload(res, redirectUrl("connect_error", "Missing OAuth response"));
  }

  const redirectUri = `${backendBase(req)}/api/connect/auth/${routeProvider}/callback`;

  try {
    let result;
    if (routeProvider === "facebook" || routeProvider === "instagram") {
      result = await completeMetaOAuth({ code, state, redirectUri });
    } else if (routeProvider === "linkedin") {
      result = await completeLinkedInOAuth({ code, state, redirectUri });
    } else if (routeProvider === "twitter") {
      result = await completeTwitterOAuth({ code, state, redirectUri });
    } else if (routeProvider === "tiktok") {
      result = await completeTikTokOAuth({ code, state, redirectUri });
    } else {
      return redirectWithPayload(res, redirectUrl("connect_error", "unsupported provider mapping"));
    }

    if (!result?.ok) {
      return redirectWithPayload(res, redirectUrl("connect_error", result?.error || "callback failed"));
    }

    return redirectWithPayload(res, callbackDestination(
      redirectBase,
      {
        connected: legacyPlatformFromProvider(routeProvider),
        name: result.accountName || "",
      }
    ));
  } catch (err) {
    return redirectWithPayload(res, redirectUrl("connect_error", String(err?.message || err || "OAuth callback failed")));
  }
};
