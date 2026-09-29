"use strict";

const {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} = require("node:crypto");
const {
  sharedPublishDecision,
} = require("./shared-site-release");

const PREVIEW_GRANT_VERSION = 1;
const PREVIEW_GRANT_AUDIENCE = "wss-site-router-preview";
const PREVIEW_SECRET_ENV = "WSS_SITE_PREVIEW_SECRET";
const PREVIEW_ENV_ENV = "WSS_SHARED_SITE_ENV";
const PREVIEW_ENV_COMPAT_ENV = "WSS_SITE_ROUTER_ENV";
const MAX_PREVIEW_GRANT_TTL_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_LENGTH = 4096;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ENV_RE = /^[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const CLAIM_KEYS = Object.freeze([
  "aud",
  "build_hash",
  "env",
  "exp",
  "iat",
  "jti",
  "release_id",
  "site_id",
  "slug",
  "v",
]);

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function previewSecret(env = process.env) {
  const secret = String((env && env[PREVIEW_SECRET_ENV]) || "");
  return Buffer.byteLength(secret, "utf8") >= 32 ? secret : "";
}

function previewEnvironment(value, env = process.env) {
  const configured = String((env && env[PREVIEW_ENV_ENV]) || "");
  const duplicate = String((env && env[PREVIEW_ENV_COMPAT_ENV]) || "");
  // A caller may narrow to the configured environment, never invent it. This
  // keeps grant mint/verify aligned with the router's fail-closed startup law.
  if (!configured || configured !== configured.trim() || !ENV_RE.test(configured)) return "";
  if (duplicate && duplicate !== configured) return "";
  const raw = value === undefined
    ? configured
    : String(value == null ? "" : value);
  return raw === configured ? configured : "";
}

function currentSeconds(now) {
  const value = now === undefined ? Date.now() : now;
  if (!Number.isFinite(value) || value < 0) return null;
  // Explicit test clocks are usually milliseconds.  Accept epoch seconds as a
  // convenience for the router adapter without interpreting small values as ms.
  return Math.floor(value >= 100_000_000_000 ? value / 1000 : value);
}

function exactIdentity(input = {}) {
  const siteId = String(input.siteId == null ? "" : input.siteId);
  const releaseId = String(input.releaseId == null ? "" : input.releaseId);
  const buildHash = String(input.buildHash == null ? "" : input.buildHash);
  const slug = String(input.slug == null ? "" : input.slug);
  if (!UUID_RE.test(siteId) || !UUID_RE.test(releaseId) || !SHA256_RE.test(buildHash) || !SLUG_RE.test(slug)) return null;
  return { siteId, releaseId, buildHash, slug };
}

function exactJti(value) {
  const jti = String(value == null ? "" : value);
  return UUID_RE.test(jti) ? jti : "";
}

function encodeClaims(claims) {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

function signature(payloadSegment, secret) {
  return createHmac("sha256", secret).update(payloadSegment, "utf8").digest();
}

function refusal(reason, detail) {
  return { ok: false, refused: true, reason, fallback: false, ...(detail ? { detail } : {}) };
}

function rpcPayload(result) {
  if (result && result.error) {
    return { ok: false, reason: String(result.error.code || result.error.message || "rpc_failed") };
  }
  const data = result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object" ? value : { ok: false, reason: "rpc_empty" };
}

/** Build exact preview registration/consumption calls around injected rpc. */
function createPreviewGrantRegistryAdapter({ rpc } = {}) {
  if (typeof rpc !== "function") throw new TypeError("preview_grant_rpc_required");
  const call = async (name, args) => rpcPayload(await rpc(name, args));
  return Object.freeze({
    registerPreviewGrant(row) {
      return call("register_site_preview_grant", {
        p_jti_hash: row.jtiHash,
        p_site_id: row.siteId,
        p_release_id: row.releaseId,
        p_build_hash: row.buildHash,
        p_deployment_env: row.environment,
        p_expires_at: row.expiresAt,
      });
    },
    consumePreviewGrant(row) {
      return call("consume_site_preview_grant", {
        p_jti_hash: row.jtiHash,
        p_site_id: row.siteId,
        p_release_id: row.releaseId,
        p_build_hash: row.buildHash,
        p_deployment_env: row.environment,
      });
    },
  });
}

function buildSignedGrant({
  siteId,
  releaseId,
  buildHash,
  slug,
  environment,
  ttlSeconds = MAX_PREVIEW_GRANT_TTL_SECONDS,
  now,
  jti,
  env = process.env,
  randomId = randomUUID,
} = {}) {
  const identity = exactIdentity({ siteId, releaseId, buildHash, slug });
  const deploymentEnv = previewEnvironment(environment, env);
  const configuredEnv = previewEnvironment(undefined, env);
  const secret = previewSecret(env);
  const issuedAt = currentSeconds(now);
  const tokenId = exactJti(jti === undefined ? randomId() : jti);
  if (!identity) return refusal("invalid_preview_identity");
  if (!deploymentEnv) return refusal("invalid_preview_environment");
  if (configuredEnv && deploymentEnv !== configuredEnv) return refusal("invalid_preview_environment");
  if (!secret) return refusal("preview_secret_not_configured");
  if (!tokenId) return refusal("invalid_preview_jti");
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_PREVIEW_GRANT_TTL_SECONDS) {
    return refusal("invalid_preview_ttl");
  }
  if (issuedAt === null) return refusal("invalid_preview_clock");

  // Keep the insertion order canonical.  The verifier accepts JSON key order
  // independently but rejects missing or extra claims.
  const claims = {
    v: PREVIEW_GRANT_VERSION,
    aud: PREVIEW_GRANT_AUDIENCE,
    site_id: identity.siteId,
    release_id: identity.releaseId,
    build_hash: identity.buildHash,
    slug: identity.slug,
    jti: tokenId,
    env: deploymentEnv,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  };
  const payloadSegment = encodeClaims(claims);
  const sigSegment = signature(payloadSegment, secret).toString("base64url");
  return {
    ok: true,
    fallback: false,
    token: `${payloadSegment}.${sigSegment}`,
    claims,
    jtiHash: sha256(tokenId),
  };
}

/**
 * Mint and durably register a one-use grant.  The raw jti exists only in the
 * signed token; the database receives its SHA-256 digest.
 */
async function mintPreviewGrant(input = {}) {
  const policy = sharedPublishDecision(input);
  if (!policy.ok) return policy;
  const built = buildSignedGrant(input);
  if (!built.ok) return built;
  const io = input.io || {};
  if (typeof io.registerPreviewGrant !== "function") return refusal("preview_grant_adapter_missing");
  try {
    const stored = await io.registerPreviewGrant({
      jtiHash: built.jtiHash,
      siteId: built.claims.site_id,
      releaseId: built.claims.release_id,
      buildHash: built.claims.build_hash,
      environment: built.claims.env,
      expiresAt: new Date(built.claims.exp * 1000).toISOString(),
    });
    if (!(stored === true || (stored && stored.ok === true))) {
      return refusal("preview_grant_registration_refused", {
        reason: String((stored && stored.reason) || "registry_refused"),
      });
    }
    return built;
  } catch (error) {
    return refusal("preview_grant_registration_failed", {
      error: String(error && error.message ? error.message : error),
    });
  }
}

function parseAndAuthenticate(token, env) {
  const secret = previewSecret(env);
  if (!secret) return refusal("preview_secret_not_configured");
  const value = String(token || "").trim();
  if (!value) return refusal("preview_grant_missing");
  if (value.length > MAX_TOKEN_LENGTH) return refusal("preview_grant_malformed");
  const parts = value.split(".");
  if (parts.length !== 2 || !parts.every((part) => BASE64URL_RE.test(part))) return refusal("preview_grant_malformed");

  let actual;
  try {
    actual = Buffer.from(parts[1], "base64url");
  } catch {
    return refusal("preview_grant_malformed");
  }
  if (actual.length !== 32 || actual.toString("base64url") !== parts[1]) return refusal("preview_grant_bad_signature");
  const expected = signature(parts[0], secret);
  if (!timingSafeEqual(actual, expected)) return refusal("preview_grant_bad_signature");

  let claims;
  try {
    const decoded = Buffer.from(parts[0], "base64url");
    if (decoded.toString("base64url") !== parts[0]) throw new Error("noncanonical");
    claims = JSON.parse(decoded.toString("utf8"));
  } catch {
    return refusal("preview_grant_malformed");
  }
  return { ok: true, claims };
}

function verifyPreviewGrant(token, {
  siteId,
  releaseId,
  buildHash,
  slug,
  jti,
  environment,
  now,
  env = process.env,
} = {}) {
  const authenticated = parseAndAuthenticate(token, env);
  if (!authenticated.ok) return authenticated;
  const claims = authenticated.claims;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return refusal("preview_grant_malformed");
  if (Object.keys(claims).sort().join("\n") !== CLAIM_KEYS.join("\n")) return refusal("preview_grant_malformed");

  const identity = exactIdentity({
    siteId: claims.site_id,
    releaseId: claims.release_id,
    buildHash: claims.build_hash,
    slug: claims.slug,
  });
  const configuredEnv = previewEnvironment(undefined, env);
  const expectedEnv = environment === undefined
    ? configuredEnv
    : String(environment == null ? "" : environment);
  const checkedAt = currentSeconds(now);
  if (!configuredEnv) return refusal("preview_grant_environment_not_configured");
  if (
    claims.v !== PREVIEW_GRANT_VERSION
    || claims.aud !== PREVIEW_GRANT_AUDIENCE
    || !identity
    || !exactJti(claims.jti)
    || !Number.isSafeInteger(claims.iat)
    || !Number.isSafeInteger(claims.exp)
    || checkedAt === null
  ) return refusal("preview_grant_malformed");
  if (claims.exp <= claims.iat || claims.exp - claims.iat > MAX_PREVIEW_GRANT_TTL_SECONDS) return refusal("preview_grant_ttl_exceeded");
  if (claims.iat > checkedAt + MAX_CLOCK_SKEW_SECONDS) return refusal("preview_grant_not_yet_valid");
  if (claims.exp <= checkedAt) return refusal("preview_grant_expired");
  if (claims.env !== configuredEnv || expectedEnv !== configuredEnv) {
    return refusal("preview_grant_environment_mismatch");
  }

  const expectedBindings = [
    [siteId, claims.site_id],
    [releaseId, claims.release_id],
    [buildHash, claims.build_hash],
    [slug, claims.slug],
    [jti, claims.jti],
  ];
  if (expectedBindings.some(([wanted, actual]) => wanted !== undefined && String(wanted) !== actual)) {
    return refusal("preview_grant_binding_mismatch");
  }

  const policy = sharedPublishDecision({ siteId: claims.site_id, slug: claims.slug, env });
  if (!policy.ok) return policy;
  return { ok: true, fallback: false, claims, jtiHash: sha256(claims.jti) };
}

/**
 * Verify the HMAC, then atomically consume the exact registered tuple.  The
 * adapter must make replay fail (the SQL migration does this with used_at).
 */
async function authorizePreviewGrant(token, input = {}) {
  const verified = verifyPreviewGrant(token, input);
  if (!verified.ok) return verified;
  const io = input.io || {};
  if (typeof io.consumePreviewGrant !== "function") return refusal("preview_grant_adapter_missing");
  const claims = verified.claims;
  try {
    const consumed = await io.consumePreviewGrant({
      jtiHash: verified.jtiHash,
      siteId: claims.site_id,
      releaseId: claims.release_id,
      buildHash: claims.build_hash,
      environment: claims.env,
      now: new Date((currentSeconds(input.now) || 0) * 1000).toISOString(),
    });
    if (!(consumed && typeof consumed === "object" && consumed.ok === true)) {
      return refusal("preview_grant_not_registered", {
        reason: String((consumed && consumed.reason) || "not_found_or_replayed"),
      });
    }
    const returned = consumed;
    const expectedManifestPath = `sites/${claims.site_id}/releases/${claims.release_id}/manifest.json`;
    const tuple = [
      [returned.siteId ?? returned.site_id, claims.site_id],
      [returned.releaseId ?? returned.release_id, claims.release_id],
      [returned.buildHash ?? returned.build_hash, claims.build_hash],
      [returned.environment ?? returned.deployment_env, claims.env],
      [returned.slug, claims.slug],
      [returned.manifestPath ?? returned.manifest_path, expectedManifestPath],
    ];
    if (tuple.some(([actual, expected]) => typeof actual !== "string" || actual !== expected)) {
      return refusal("preview_grant_registry_mismatch");
    }
    return verified;
  } catch (error) {
    return refusal("preview_grant_registry_failed", {
      error: String(error && error.message ? error.message : error),
    });
  }
}

module.exports = {
  PREVIEW_GRANT_VERSION,
  PREVIEW_GRANT_AUDIENCE,
  PREVIEW_SECRET_ENV,
  PREVIEW_ENV_ENV,
  PREVIEW_ENV_COMPAT_ENV,
  MAX_PREVIEW_GRANT_TTL_SECONDS,
  MAX_CLOCK_SKEW_SECONDS,
  previewSecret,
  previewEnvironment,
  createPreviewGrantRegistryAdapter,
  buildSignedGrant,
  mintPreviewGrant,
  verifyPreviewGrant,
  authorizePreviewGrant,
};
