"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");
const { canonical } = require("./build-hash");
const { MIRROR_ENGINE_EVIDENCE_SCHEMA } = require("../mirror-engine-contract");

const EVIDENCE_HMAC_KEY_ENV = "GHOST_AGENCY_MIRROR_RELEASE_EVIDENCE_HMAC_KEY";
// node --test supplies NODE_TEST_CONTEXT to its isolated children. Keeping the
// fixture key inside that explicit non-production context makes repository
// tests deterministic without giving an ordinary dev or production process a
// silent signing fallback.
const TEST_HMAC_KEY = "wss-mirror-release-evidence-test-key-v1-only";

function configuredKey(env = process.env) {
  const value = String((env && env[EVIDENCE_HMAC_KEY_ENV]) || "").trim();
  if (Buffer.byteLength(value, "utf8") >= 32) return value;
  if (env?.NODE_ENV !== "production" && String(env?.NODE_TEST_CONTEXT || "").trim()) {
    return TEST_HMAC_KEY;
  }
  return "";
}

function unsignedEvidence(manifest = {}) {
  const { evidence_sha, ...rest } = manifest;
  return canonical({ schema: MIRROR_ENGINE_EVIDENCE_SCHEMA, ...rest });
}

function signingKeyRequiredError() {
  const error = new Error(`${EVIDENCE_HMAC_KEY_ENV}_required`);
  error.code = "mirror_release_evidence_hmac_key_unconfigured";
  error.requiredEnv = EVIDENCE_HMAC_KEY_ENV;
  return error;
}

function signEvidence(manifest = {}, { env = process.env, key = "" } = {}) {
  const secret = String(key || configuredKey(env)).trim();
  if (Buffer.byteLength(secret, "utf8") < 32) throw signingKeyRequiredError();
  return createHmac("sha256", secret)
    .update(unsignedEvidence(manifest))
    .digest("hex");
}

function verifyEvidence(manifest = {}, { env = process.env, key = "" } = {}) {
  const actualHex = String(manifest && manifest.evidence_sha || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(actualHex)) return false;
  let expectedHex;
  try {
    expectedHex = signEvidence(manifest, { env, key });
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(actualHex, "hex"), Buffer.from(expectedHex, "hex"));
}

function evidenceHmacConfigured(env = process.env) {
  return Boolean(configuredKey(env));
}

module.exports = {
  EVIDENCE_HMAC_KEY_ENV,
  evidenceHmacConfigured,
  signEvidence,
  verifyEvidence,
};
