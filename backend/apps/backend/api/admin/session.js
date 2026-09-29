"use strict";

const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { verifyPassword, issueSession } = require("../../lib/admin-password");

const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

function clientKey(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim().slice(0, 120);
}

function rateLimited(key, now = Date.now()) {
  const current = attempts.get(key) || [];
  const recent = current.filter((time) => time > now - WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > MAX_ATTEMPTS;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    const key = clientKey(req);
    if (rateLimited(key)) {
      sendJson(res, 429, { ok: false, error: "too_many_login_attempts" });
      return;
    }
    const body = await readJson(req).catch(() => ({}));
    const verified = await verifyPassword(body.password);
    if (!verified.configured) {
      sendJson(res, 503, { ok: false, error: "owner_password_not_configured" });
      return;
    }
    if (!verified.ok) {
      sendJson(res, 401, { ok: false, error: "invalid_password" });
      return;
    }
    const session = issueSession({ sessionVersion: verified.sessionVersion });
    if (!session) {
      sendJson(res, 503, { ok: false, error: "admin_session_signing_unconfigured" });
      return;
    }
    attempts.delete(key);
    sendJson(res, 200, {
      ok: true,
      token: session.token,
      expiresAt: new Date(session.expiresAt).toISOString(),
      sessionVersion: session.sessionVersion,
    });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports._test = { clientKey, rateLimited, attempts };
