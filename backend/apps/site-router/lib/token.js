"use strict";

const crypto = require("node:crypto");
const {
  PREVIEW_GRANT_AUDIENCE,
  PREVIEW_GRANT_MAX_AGE_SECONDS,
  PREVIEW_SESSION_AUDIENCE,
  PREVIEW_SESSION_MAX_AGE_SECONDS
} = require("./constants");

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_ENV = /^[a-z0-9_-]{1,32}$/;
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BUILD_HASH = /^[a-f0-9]{64}$/;

function signingSecret(env = process.env) {
  const secret = typeof env.WSS_SITE_PREVIEW_SECRET === "string"
    ? env.WSS_SITE_PREVIEW_SECRET
    : "";
  if (Buffer.byteLength(secret, "utf8") < 32) return null;
  return secret;
}

function signature(part, secret) {
  return crypto.createHmac("sha256", secret).update(part, "utf8").digest();
}

function encodeToken(claims, secret) {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("preview signing secret is not configured");
  }
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

function decodeVerified(token, secret) {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let supplied;
  try {
    supplied = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (supplied.toString("base64url") !== parts[1]) return null;
  const expected = signature(parts[0], secret);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

  try {
    const bytes = Buffer.from(parts[0], "base64url");
    if (bytes.length > 3072 || bytes.toString("base64url") !== parts[0]) return null;
    const claims = JSON.parse(bytes.toString("utf8"));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

function validIdentityClaims(claims) {
  return claims
    && claims.v === 1
    && SAFE_ID.test(claims.site_id || "")
    && SAFE_ID.test(claims.release_id || "")
    && BUILD_HASH.test(claims.build_hash || "")
    && SAFE_SLUG.test(claims.slug || "")
    && SAFE_ID.test(claims.jti || "")
    && SAFE_ENV.test(claims.env || "")
    && Number.isSafeInteger(claims.iat)
    && Number.isSafeInteger(claims.exp);
}

function verifyTimedToken(token, {
  audience,
  maxAgeSeconds,
  env,
  nowSeconds = Math.floor(Date.now() / 1000),
  secret
}) {
  if (!secret || !env) return null;
  const claims = decodeVerified(token, secret);
  if (!validIdentityClaims(claims) || claims.aud !== audience || claims.env !== env) return null;
  if (claims.iat > nowSeconds + 30 || claims.exp <= nowSeconds) return null;
  if (claims.exp <= claims.iat || claims.exp - claims.iat > maxAgeSeconds) return null;
  return Object.freeze({ ...claims });
}

function verifyPreviewGrant(token, options) {
  return verifyTimedToken(token, {
    ...options,
    audience: PREVIEW_GRANT_AUDIENCE,
    maxAgeSeconds: PREVIEW_GRANT_MAX_AGE_SECONDS
  });
}

function verifyPreviewSession(token, options) {
  return verifyTimedToken(token, {
    ...options,
    audience: PREVIEW_SESSION_AUDIENCE,
    maxAgeSeconds: PREVIEW_SESSION_MAX_AGE_SECONDS
  });
}

function mintPreviewSession(grant, {
  nowSeconds = Math.floor(Date.now() / 1000),
  secret,
  randomId = () => crypto.randomBytes(18).toString("base64url")
}) {
  const claims = {
    v: 1,
    aud: PREVIEW_SESSION_AUDIENCE,
    site_id: grant.site_id,
    release_id: grant.release_id,
    build_hash: grant.build_hash,
    slug: grant.slug,
    env: grant.env,
    jti: randomId(),
    iat: nowSeconds,
    exp: nowSeconds + PREVIEW_SESSION_MAX_AGE_SECONDS
  };
  return encodeToken(claims, secret);
}

module.exports = {
  encodeToken,
  mintPreviewSession,
  signingSecret,
  verifyPreviewGrant,
  verifyPreviewSession
};
