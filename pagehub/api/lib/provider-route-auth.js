"use strict";

const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const OWNER_SESSION_COOKIE = "__Host-pagehub_owner_session";
const OWNER_SESSION_VERSION = "v1";
// 30 days. The 15-minute TTL re-prompted the owner for the 64-char token
// constantly ("baloney authorization", 2026-09-19); the token gate itself is
// unchanged - only its session lifetime was hostile.
const OWNER_SESSION_TTL_SECONDS = Math.max(
  900,
  Math.floor(Number(process.env.PAGEHUB_OWNER_SESSION_TTL_SECONDS) || 2_592_000),
);

function secureTokenEqual(suppliedToken, expectedToken) {
  const supplied = String(suppliedToken || "");
  const expected = String(expectedToken || "");
  if (!supplied || !expected) return false;

  // Hashing both values gives timingSafeEqual fixed-size buffers even when an
  // attacker submits a token with a different length.
  const left = createHash("sha256").update(supplied).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function authorized(header, expectedToken) {
  const supplied = String(header || "").trim().replace(/^Bearer\s+/i, "");
  const expected = String(expectedToken || "").trim();
  return secureTokenEqual(supplied, expected);
}

function ownerSessionSignature(unsignedValue, ownerToken) {
  const key = createHash("sha256")
    .update(`pagehub-owner-session-key:${String(ownerToken || "")}`)
    .digest();
  return createHmac("sha256", key).update(unsignedValue).digest("base64url");
}

function createOwnerSessionValue(ownerToken, nowMs = Date.now()) {
  const issuedAt = Math.floor(Number(nowMs) / 1000);
  const expiresAt = issuedAt + OWNER_SESSION_TTL_SECONDS;
  const nonce = randomBytes(16).toString("base64url");
  const unsigned = `${OWNER_SESSION_VERSION}.${issuedAt}.${expiresAt}.${nonce}`;
  return `${unsigned}.${ownerSessionSignature(unsigned, ownerToken)}`;
}

function validOwnerSessionValue(value, ownerToken, nowMs = Date.now()) {
  const token = String(ownerToken || "").trim();
  const parts = String(value || "").split(".");
  if (!token || parts.length !== 5 || parts[0] !== OWNER_SESSION_VERSION) return false;

  const issuedAt = Number(parts[1]);
  const expiresAt = Number(parts[2]);
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return false;
  if (!/^[A-Za-z0-9_-]{22}$/.test(parts[3])) return false;
  if (issuedAt > nowSeconds + 30 || expiresAt <= nowSeconds) return false;
  if (expiresAt <= issuedAt || expiresAt - issuedAt > OWNER_SESSION_TTL_SECONDS) return false;

  const unsigned = parts.slice(0, 4).join(".");
  return secureTokenEqual(parts[4], ownerSessionSignature(unsigned, token));
}

function cookieValue(req, name) {
  const cookieHeader = req?.headers?.cookie || req?.headers?.Cookie || "";
  for (const part of String(cookieHeader).split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
}

function hasValidOwnerSession(req, environment = process.env, nowMs = Date.now()) {
  return validOwnerSessionValue(
    cookieValue(req, OWNER_SESSION_COOKIE),
    environment?.PAGEHUB_OWNER_TOKEN,
    nowMs
  );
}

function ownerSessionCookie(ownerToken, nowMs = Date.now()) {
  return [
    `${OWNER_SESSION_COOKIE}=${createOwnerSessionValue(ownerToken, nowMs)}`,
    "Path=/",
    `Max-Age=${OWNER_SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

function clearOwnerSessionCookie() {
  return [
    `${OWNER_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

function requireProviderRouteAuth(req, res, environment = process.env) {
  const expectedToken = String(environment?.INTAKE_GENIE_TOKEN || "").trim();
  const ownerToken = String(environment?.PAGEHUB_OWNER_TOKEN || "").trim();
  if (!expectedToken && !ownerToken) {
    res.status(503).json({
      ok: false,
      error: "Provider-route authentication is not configured.",
    });
    return false;
  }

  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  if (!authorized(header, expectedToken) && !hasValidOwnerSession(req, environment)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(401).json({ ok: false, error: "Unauthorized." });
    return false;
  }
  return true;
}

module.exports = {
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_TTL_SECONDS,
  authorized,
  clearOwnerSessionCookie,
  createOwnerSessionValue,
  hasValidOwnerSession,
  ownerSessionCookie,
  requireProviderRouteAuth,
  secureTokenEqual,
  validOwnerSessionValue,
};
