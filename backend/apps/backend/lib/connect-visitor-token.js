"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

const VISITOR_TOKEN_SECRET_ENV_NAME = "CONNECT_VISITOR_TOKEN_SECRET";
const DEFAULT_VISITOR_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VISITOR_TOKEN_TTL_MS = DEFAULT_VISITOR_TOKEN_TTL_MS;
const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 2048;
const THREAD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SITE_SLUG_RE = /^[a-z0-9][a-z0-9-]{2,79}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function signingSecret(env = process.env) {
  const value = String((env && env[VISITOR_TOKEN_SECRET_ENV_NAME]) || "").trim();
  return Buffer.byteLength(value, "utf8") >= 32 ? value : "";
}

// Thread ids are identities, not labels. Keep their exact spelling and case;
// reject whitespace or punctuation that would need lossy cleanup.
function exactThreadId(value) {
  const id = String(value == null ? "" : value);
  return id === id.trim() && THREAD_ID_RE.test(id) ? id : "";
}

function exactSiteSlug(value) {
  const slug = String(value == null ? "" : value);
  return SITE_SLUG_RE.test(slug) ? slug : "";
}

function finiteNow(value) {
  const now = value === undefined ? Date.now() : value;
  return Number.isFinite(now) && Number.isInteger(now) && now >= 0 ? now : null;
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signature(payloadSegment, secret) {
  return createHmac("sha256", secret).update(payloadSegment, "utf8").digest();
}

/**
 * Mint a short-lived browser credential for exactly one Connect chat thread.
 *
 * The 24-hour ceiling lets a visitor return later the same day while keeping a
 * credential used by a ten-minute active poller finite. Invalid input or a
 * missing/deliberately weak secret fails closed with an empty string.
 */
function signVisitorToken({
  threadId,
  siteSlug,
  ttlMs = DEFAULT_VISITOR_TOKEN_TTL_MS,
  now,
  env = process.env,
} = {}) {
  const secret = signingSecret(env);
  const id = exactThreadId(threadId);
  const slug = exactSiteSlug(siteSlug);
  const issuedAt = finiteNow(now);
  if (!secret || !id || !slug || issuedAt === null) return "";
  if (!Number.isFinite(ttlMs) || !Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_VISITOR_TOKEN_TTL_MS) {
    return "";
  }

  const payloadSegment = encodePayload({
    v: TOKEN_VERSION,
    threadId: id,
    siteSlug: slug,
    exp: issuedAt + ttlMs,
  });
  const sigSegment = signature(payloadSegment, secret).toString("base64url");
  return `${payloadSegment}.${sigSegment}`;
}

/**
 * Verify a visitor token and optionally require the request's thread/tenant.
 * Callers that supply `threadId` or `siteSlug` get the comparison here, after
 * authentication, rather than reimplementing a potentially lossy check.
 */
function verifyVisitorToken(token, {
  threadId,
  siteSlug,
  now,
  env = process.env,
} = {}) {
  const secret = signingSecret(env);
  if (!secret) return { ok: false, reason: "not_configured" };

  const value = String(token || "").trim();
  if (!value) return { ok: false, reason: "missing_token" };
  if (value.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };

  const parts = value.split(".");
  if (parts.length !== 2 || !parts.every((part) => BASE64URL_RE.test(part))) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadSegment, sigSegment] = parts;

  let actualSignature;
  try {
    actualSignature = Buffer.from(sigSegment, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (actualSignature.length !== 32 || actualSignature.toString("base64url") !== sigSegment) {
    return { ok: false, reason: "bad_signature" };
  }
  const expectedSignature = signature(payloadSegment, secret);
  if (!timingSafeEqual(actualSignature, expectedSignature)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload;
  try {
    const payloadBuffer = Buffer.from(payloadSegment, "base64url");
    if (payloadBuffer.toString("base64url") !== payloadSegment) throw new Error("non-canonical payload");
    payload = JSON.parse(payloadBuffer.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const id = exactThreadId(payload && payload.threadId);
  const slug = exactSiteSlug(payload && payload.siteSlug);
  const exp = payload && payload.exp;
  const checkedAt = finiteNow(now);
  if (
    !payload
    || payload.v !== TOKEN_VERSION
    || !id
    || !slug
    || slug !== payload.siteSlug
    || !Number.isFinite(exp)
    || !Number.isInteger(exp)
    || checkedAt === null
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (checkedAt >= exp) return { ok: false, reason: "expired" };

  if (threadId !== undefined && exactThreadId(threadId) !== id) {
    return { ok: false, reason: "binding_mismatch" };
  }
  if (siteSlug !== undefined && exactSiteSlug(siteSlug) !== slug) {
    return { ok: false, reason: "binding_mismatch" };
  }

  return { ok: true, threadId: id, siteSlug: slug, exp };
}

module.exports = {
  signVisitorToken,
  verifyVisitorToken,
  VISITOR_TOKEN_SECRET_ENV_NAME,
  DEFAULT_VISITOR_TOKEN_TTL_MS,
  MAX_VISITOR_TOKEN_TTL_MS,
};
