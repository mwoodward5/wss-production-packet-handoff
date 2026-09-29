"use strict";

// GET  /api/connect/push-subscribe -> the public VAPID key for this app.
// POST /api/connect/push-subscribe { subscription }
//
// A tenant-scoped Connect token always binds the subscription to the slug in
// that signed token. The legacy full/admin token has no tenant identity, so it
// cannot create a subscription. The VAPID private key is deliberately not read
// in this module.

const { resolveConnectScope, readBody } = require("../../lib/connect");
const { normalizePushEndpoint } = require("../../lib/connect-push");
const { upsertRow } = require("../../lib/store");

const SITE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = [
    "https://connect.wss-labs.com",
    "https://wss-ai.com",
    "https://www.wss-ai.com",
  ];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function decodedBase64Url(value) {
  const text = String(value || "").trim();
  if (!text || !BASE64URL_RE.test(text)) return null;
  try {
    return Buffer.from(text, "base64url");
  } catch {
    return null;
  }
}

function publicVapidKey(env = process.env) {
  const value = String(env.CONNECT_VAPID_PUBLIC_KEY || "").trim();
  const decoded = decodedBase64Url(value);
  // Application server keys are uncompressed P-256 public keys: 0x04 plus
  // two 32-byte coordinates. Reject a broken env value instead of handing it
  // to PushManager and producing a confusing browser error.
  return decoded && decoded.length === 65 && decoded[0] === 0x04 ? value : "";
}

function validSubscriptionKey(value, expectedBytes, firstByte) {
  const text = String(value || "").trim();
  const decoded = decodedBase64Url(text);
  return decoded
    && decoded.length === expectedBytes
    && (firstByte === undefined || decoded[0] === firstByte)
    ? text
    : "";
}

function normalizeSubscription(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const endpoint = normalizePushEndpoint(value.endpoint);
  if (!endpoint) return null;

  const p256dh = validSubscriptionKey(value.keys && value.keys.p256dh, 65, 0x04);
  const auth = validSubscriptionKey(value.keys && value.keys.auth, 16);
  if (!p256dh || !auth) return null;

  return { endpoint, p256dh, auth };
}

function validSiteSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return SITE_SLUG_RE.test(slug) ? slug : "";
}

function subscriptionSiteSlug(scope) {
  if (scope.mode === "tenant") return validSiteSlug(scope.siteSlug);
  // Full/admin tokens are intentionally not allowed to guess, default, or
  // supply a tenant. Only a signed tenant token may bind a browser endpoint.
  return "";
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const scope = resolveConnectScope(req);
  if (!scope) return sendJson(res, 401, { ok: false, error: "unauthorized" });

  if (req.method === "GET") {
    const publicKey = publicVapidKey();
    return sendJson(res, 200, {
      ok: true,
      configured: Boolean(publicKey),
      publicKey: publicKey || null,
      scope: scope.mode,
    });
  }

  try {
    const body = await readBody(req);
    const siteSlug = subscriptionSiteSlug(scope);
    if (!siteSlug) {
      return sendJson(res, 403, { ok: false, error: "tenant_scope_required" });
    }

    const subscription = normalizeSubscription(body.subscription);
    if (!subscription) {
      return sendJson(res, 400, { ok: false, error: "invalid_subscription" });
    }

    // The composite identity is tenant-isolated: one tenant may register many
    // device endpoints, and the same endpoint under another tenant is a
    // separate row rather than a way to reassign that tenant's subscription.
    const stored = await upsertRow(
      "connect_push_subscriptions",
      { site_slug: siteSlug, ...subscription },
      "site_slug,endpoint",
    );
    if (!stored || stored.mode !== "live_upsert") {
      const unavailable = stored && stored.mode === "dry_run";
      return sendJson(res, unavailable ? 503 : 502, {
        ok: false,
        error: "subscription_store_unavailable",
      });
    }

    return sendJson(res, 200, { ok: true });
  } catch {
    return sendJson(res, 500, { ok: false, error: "subscription_store_failed" });
  }
};

module.exports._test = {
  normalizeSubscription,
  publicVapidKey,
  subscriptionSiteSlug,
  validSiteSlug,
};
