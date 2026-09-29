"use strict";

const {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} = require("node:crypto");

const HERO_JOB_CAPABILITY_HEADER = "x-ghost-hero-job-capability";
const HERO_JOB_LEASE_HEADER = "x-ghost-hero-job-lease";
const HERO_JOB_CAPABILITY_SCHEMA = "wss.hero.job-capability.v1";
const HERO_JOB_CAPABILITY_GRANT_SCHEMA = "wss.hero.job-capability-grant.v1";
const HERO_JOB_CAPABILITY_LAUNCH_SCHEMA = "wss.hero.job-capability-launch.v1";
const HERO_JOB_CAPABILITY_ISSUER = "wss-hero-admin";
const HERO_JOB_CAPABILITY_AUDIENCE = "wss-hero-one-job-worker";
const HERO_JOB_CAPABILITY_VERSION = "wss1";
const HERO_JOB_CAPABILITY_PRODUCER = "openrouter_seedance";
const HERO_JOB_CAPABILITY_MAX_BYTES = 4096;
const HERO_JOB_CAPABILITY_CLOCK_SKEW_SECONDS = 30;
const HERO_JOB_CAPABILITY_LEASE_MARGIN_MS = 5 * 60 * 1000;
const HERO_JOB_CAPABILITY_TTL_SECONDS = Object.freeze({
  generate: 75 * 60,
  upload: 40 * 60,
});
const HERO_JOB_CAPABILITY_LEASE_MS = Object.freeze({
  generate: 60 * 60 * 1000,
  upload: 30 * 60 * 1000,
});
const BASE_KEYS = Object.freeze([
  "schema",
  "iss",
  "aud",
  "phase",
  "job_id",
  "prospect_id",
  "producer",
  "generation_revision",
  "attempt",
  "jti",
  "iat",
  "nbf",
  "exp",
  "batch_id",
  "row_id",
]);
const SAFE_JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SAFE_PROSPECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SAFE_BATCH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_ROW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function headerValue(req, name) {
  const headers = req?.headers && typeof req.headers === "object" ? req.headers : {};
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? "" : clean(value);
}

function requestHeroJobCapability(req = {}) {
  const value = headerValue(req, HERO_JOB_CAPABILITY_HEADER);
  return Buffer.byteLength(value, "utf8") <= HERO_JOB_CAPABILITY_MAX_BYTES ? value : "";
}

function requestHeroJobLease(req = {}) {
  const value = headerValue(req, HERO_JOB_LEASE_HEADER);
  return value.length <= 240 ? value : "";
}

function integer(value, code, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(code);
  return value;
}

function exactKeys(input, phase) {
  const expected = phase === "upload" ? [...BASE_KEYS, "approved_sha256"] : [...BASE_KEYS];
  const actual = Object.keys(input || {});
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("capability_claims_not_canonical");
  }
}

function canonicalHeroJobCapabilityClaims(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("capability_claims_invalid");
  const phase = clean(input.phase);
  if (!Object.hasOwn(HERO_JOB_CAPABILITY_TTL_SECONDS, phase)) fail("capability_phase_invalid");
  exactKeys(input, phase);

  const claims = {
    schema: clean(input.schema),
    iss: clean(input.iss),
    aud: clean(input.aud),
    phase,
    job_id: clean(input.job_id),
    prospect_id: clean(input.prospect_id),
    producer: clean(input.producer),
    generation_revision: integer(input.generation_revision, "capability_revision_invalid", 1),
    attempt: integer(input.attempt, "capability_attempt_invalid", 0),
    jti: clean(input.jti).toLowerCase(),
    iat: integer(input.iat, "capability_iat_invalid", 1),
    nbf: integer(input.nbf, "capability_nbf_invalid", 1),
    exp: integer(input.exp, "capability_exp_invalid", 1),
    batch_id: clean(input.batch_id),
    row_id: clean(input.row_id),
    ...(phase === "upload" ? { approved_sha256: clean(input.approved_sha256).toLowerCase() } : {}),
  };

  if (claims.schema !== HERO_JOB_CAPABILITY_SCHEMA) fail("capability_schema_invalid");
  if (claims.iss !== HERO_JOB_CAPABILITY_ISSUER) fail("capability_issuer_invalid");
  if (claims.aud !== HERO_JOB_CAPABILITY_AUDIENCE) fail("capability_audience_invalid");
  if (!SAFE_JOB_ID_RE.test(claims.job_id)) fail("capability_job_id_invalid");
  if (!SAFE_PROSPECT_ID_RE.test(claims.prospect_id)) fail("capability_prospect_id_invalid");
  if (claims.producer !== HERO_JOB_CAPABILITY_PRODUCER) fail("capability_producer_invalid");
  if (!UUID_V4_RE.test(claims.jti)) fail("capability_jti_invalid");
  if (!SAFE_BATCH_ID_RE.test(claims.batch_id)) fail("capability_batch_id_invalid");
  if (!SAFE_ROW_ID_RE.test(claims.row_id)) fail("capability_row_id_invalid");
  if (claims.nbf < claims.iat - HERO_JOB_CAPABILITY_CLOCK_SKEW_SECONDS) fail("capability_nbf_invalid");
  if (claims.exp <= claims.nbf) fail("capability_exp_invalid");
  if (claims.exp - claims.iat > HERO_JOB_CAPABILITY_TTL_SECONDS[phase]) fail("capability_ttl_invalid");
  if (phase === "upload" && !SHA256_RE.test(claims.approved_sha256)) fail("capability_approved_sha256_invalid");
  return claims;
}

function canonicalPayload(claims) {
  return JSON.stringify(canonicalHeroJobCapabilityClaims(claims));
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function phaseSigningKey(workerSecret, phase) {
  const secret = clean(workerSecret);
  if (!secret) fail("capability_signing_secret_required");
  return createHmac("sha256", secret)
    .update(`wss.hero.job-capability.key.v1\0${phase}`, "utf8")
    .digest();
}

function signatureFor(workerSecret, phase, payloadSegment) {
  return createHmac("sha256", phaseSigningKey(workerSecret, phase))
    .update(`wss.hero.job-capability.token.v1\0${payloadSegment}`, "utf8")
    .digest();
}

function signHeroJobCapability(workerSecret, claims) {
  const normalized = canonicalHeroJobCapabilityClaims(claims);
  const payloadSegment = base64url(Buffer.from(JSON.stringify(normalized), "utf8"));
  const signature = signatureFor(workerSecret, normalized.phase, payloadSegment).toString("base64url");
  const token = `${HERO_JOB_CAPABILITY_VERSION}.${payloadSegment}.${signature}`;
  if (Buffer.byteLength(token, "utf8") > HERO_JOB_CAPABILITY_MAX_BYTES) fail("capability_token_too_large");
  return token;
}

function verifyHeroJobCapability(workerSecret, token, options = {}) {
  try {
    const compact = clean(token);
    if (!compact || Buffer.byteLength(compact, "utf8") > HERO_JOB_CAPABILITY_MAX_BYTES) {
      return { ok: false, error: "capability_invalid" };
    }
    const segments = compact.split(".");
    if (segments.length !== 3 || segments[0] !== HERO_JOB_CAPABILITY_VERSION) {
      return { ok: false, error: "capability_invalid" };
    }
    const [, payloadSegment, signatureSegment] = segments;
    if (!BASE64URL_RE.test(payloadSegment) || !BASE64URL_RE.test(signatureSegment)) {
      return { ok: false, error: "capability_invalid" };
    }
    const payloadBytes = Buffer.from(payloadSegment, "base64url");
    if (payloadBytes.toString("base64url") !== payloadSegment) return { ok: false, error: "capability_invalid" };
    const parsed = JSON.parse(payloadBytes.toString("utf8"));
    const claims = canonicalHeroJobCapabilityClaims(parsed);
    if (JSON.stringify(claims) !== payloadBytes.toString("utf8")) return { ok: false, error: "capability_invalid" };
    if (options.expectedPhase && claims.phase !== options.expectedPhase) {
      return { ok: false, error: "capability_phase_mismatch" };
    }
    const suppliedSignature = Buffer.from(signatureSegment, "base64url");
    if (suppliedSignature.toString("base64url") !== signatureSegment) return { ok: false, error: "capability_invalid" };
    const expectedSignature = signatureFor(workerSecret, claims.phase, payloadSegment);
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) return { ok: false, error: "capability_invalid" };

    const nowSeconds = Math.floor(Number(options.nowMs ?? Date.now()) / 1000);
    const skew = HERO_JOB_CAPABILITY_CLOCK_SKEW_SECONDS;
    if (claims.iat > nowSeconds + skew || claims.nbf > nowSeconds + skew || claims.exp <= nowSeconds - skew) {
      return { ok: false, error: "capability_expired" };
    }
    return { ok: true, claims };
  } catch {
    return { ok: false, error: "capability_invalid" };
  }
}

function heroJobCapabilityJtiSha256(jti) {
  const value = clean(jti).toLowerCase();
  if (!UUID_V4_RE.test(value)) fail("capability_jti_invalid");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function heroJobCapabilityRedemptionSha256(redemptionId) {
  const value = clean(redemptionId).toLowerCase();
  if (!UUID_V4_RE.test(value)) fail("capability_redemption_id_invalid");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function heroJobCapabilityGrant(input) {
  const claims = canonicalHeroJobCapabilityClaims(input);
  return {
    schema: HERO_JOB_CAPABILITY_GRANT_SCHEMA,
    phase: claims.phase,
    job_id: claims.job_id,
    prospect_id: claims.prospect_id,
    producer: claims.producer,
    generation_revision: claims.generation_revision,
    attempt: claims.attempt,
    jti_sha256: heroJobCapabilityJtiSha256(claims.jti),
    iat: claims.iat,
    nbf: claims.nbf,
    exp: claims.exp,
    batch_id: claims.batch_id,
    row_id: claims.row_id,
    ...(claims.phase === "upload" ? { approved_sha256: claims.approved_sha256 } : {}),
    redemption_sha256: null,
    redeemed_at: null,
    redeemed_lease_sha256: null,
  };
}

function heroJobCapabilityLeaseOwner(input) {
  const grant = input?.schema === HERO_JOB_CAPABILITY_GRANT_SCHEMA ? input : heroJobCapabilityGrant(input);
  if (!SHA256_RE.test(clean(grant.jti_sha256))) fail("capability_grant_invalid");
  if (!Object.hasOwn(HERO_JOB_CAPABILITY_TTL_SECONDS, grant.phase)) fail("capability_grant_invalid");
  return `cap_${grant.phase}_${grant.jti_sha256.slice(0, 32)}`;
}

function newHeroJobCapabilityClaims(input = {}, options = {}) {
  const phase = clean(input.phase);
  if (!Object.hasOwn(HERO_JOB_CAPABILITY_TTL_SECONDS, phase)) fail("capability_phase_invalid");
  const nowSeconds = Math.floor(Number(options.nowMs ?? Date.now()) / 1000);
  return canonicalHeroJobCapabilityClaims({
    schema: HERO_JOB_CAPABILITY_SCHEMA,
    iss: HERO_JOB_CAPABILITY_ISSUER,
    aud: HERO_JOB_CAPABILITY_AUDIENCE,
    phase,
    job_id: clean(input.job_id),
    prospect_id: clean(input.prospect_id),
    producer: clean(input.producer),
    generation_revision: input.generation_revision,
    attempt: input.attempt,
    jti: clean(options.jti || randomUUID()).toLowerCase(),
    iat: nowSeconds,
    nbf: nowSeconds,
    exp: nowSeconds + HERO_JOB_CAPABILITY_TTL_SECONDS[phase],
    batch_id: clean(input.batch_id),
    row_id: clean(input.row_id),
    ...(phase === "upload" ? { approved_sha256: clean(input.approved_sha256).toLowerCase() } : {}),
  });
}

function sha256Opaque(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

module.exports = {
  HERO_JOB_CAPABILITY_HEADER,
  HERO_JOB_LEASE_HEADER,
  HERO_JOB_CAPABILITY_SCHEMA,
  HERO_JOB_CAPABILITY_GRANT_SCHEMA,
  HERO_JOB_CAPABILITY_LAUNCH_SCHEMA,
  HERO_JOB_CAPABILITY_ISSUER,
  HERO_JOB_CAPABILITY_AUDIENCE,
  HERO_JOB_CAPABILITY_PRODUCER,
  HERO_JOB_CAPABILITY_MAX_BYTES,
  HERO_JOB_CAPABILITY_CLOCK_SKEW_SECONDS,
  HERO_JOB_CAPABILITY_LEASE_MARGIN_MS,
  HERO_JOB_CAPABILITY_TTL_SECONDS,
  HERO_JOB_CAPABILITY_LEASE_MS,
  canonicalHeroJobCapabilityClaims,
  signHeroJobCapability,
  verifyHeroJobCapability,
  newHeroJobCapabilityClaims,
  heroJobCapabilityGrant,
  heroJobCapabilityJtiSha256,
  heroJobCapabilityRedemptionSha256,
  heroJobCapabilityLeaseOwner,
  requestHeroJobCapability,
  requestHeroJobLease,
  sha256Opaque,
};
