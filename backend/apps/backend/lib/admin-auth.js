"use strict";

const crypto = require("node:crypto");
const { sendJson } = require("./http");
const { verifySessionToken, sessionSecret } = require("./admin-password");

// Emergency owner recovery credential. Only the SHA-256 digest is committed;
// the raw token never enters Git, logs, or deployment metadata. It remains a
// bounded break-glass path. Normal owner access now uses a password that is
// scrypt-hashed in Supabase and exchanged for a signed browser session.
const OWNER_RECOVERY_SHA256 = "14549e42034eebda865b1a2f65ad25f8ba3a265ce36ef3e2b4b1ba838055fd38";
const OWNER_RECOVERY_EXPIRES_AT = Date.parse("2026-11-17T04:00:00.000Z");

function safeEq(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function recoveryEnabled(now = Date.now()) {
  return process.env.VERCEL_ENV === "production"
    && Number.isFinite(OWNER_RECOVERY_EXPIRES_AT)
    && now <= OWNER_RECOVERY_EXPIRES_AT;
}

function requestCandidates(req = {}) {
  const header = String(req?.headers?.authorization || req?.headers?.Authorization || "");
  const direct = String(req?.headers?.["x-admin-token"] || "");
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return [direct, bearer].filter(Boolean);
}

function recoveryTokenAllowed(req, now = Date.now()) {
  if (!recoveryEnabled(now)) return false;
  return requestCandidates(req)
    .some((candidate) => safeEq(sha256(candidate), OWNER_RECOVERY_SHA256));
}

function signedSessionAllowed(req, now = Date.now()) {
  return requestCandidates(req).some((candidate) => verifySessionToken(candidate, now).ok === true);
}

function adminAllowed(req) {
  const primary = process.env.GHOST_AGENCY_ADMIN_TOKEN?.trim();
  const secondary = process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY?.trim();
  const secondaryExpiresAt = Date.parse(process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY_EXPIRES_AT || "");
  const secondaryExpired = Number.isFinite(secondaryExpiresAt) && Date.now() > secondaryExpiresAt;
  const tokens = [
    primary,
    secondaryExpired ? "" : secondary,
  ].map((value) => value?.trim()).filter(Boolean);
  const recovery = recoveryEnabled();
  const sessionsConfigured = Boolean(sessionSecret());
  if (!tokens.length && !recovery && !sessionsConfigured) {
    return { allowed: false, configured: false };
  }
  const header = req.headers.authorization || req.headers.Authorization || "";
  const direct = req.headers["x-admin-token"] || "";
  return {
    allowed: tokens.some((token) => safeEq(header, `Bearer ${token}`) || safeEq(direct, token))
      || signedSessionAllowed(req)
      || recoveryTokenAllowed(req),
    configured: true,
  };
}

function requireAdmin(req, res) {
  const auth = adminAllowed(req);
  if (!auth.allowed) {
    if (!auth.configured) {
      sendJson(res, 503, { ok: false, error: "server_auth_unconfigured" });
      return false;
    }
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

module.exports = {
  adminAllowed,
  requireAdmin,
  safeEq,
  sha256,
  recoveryEnabled,
  recoveryTokenAllowed,
  signedSessionAllowed,
  OWNER_RECOVERY_SHA256,
  OWNER_RECOVERY_EXPIRES_AT,
};
