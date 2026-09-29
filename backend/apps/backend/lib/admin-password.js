"use strict";

const crypto = require("node:crypto");
const { select, upsertRow } = require("./store");

const TABLE = "ghost_agency_admin_credentials";
const OWNER_ID = "owner";
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
// Initial owner-password bootstrap. Only salt + scrypt verifier are committed;
// plaintext never enters source, logs, metadata, or the browser. This fallback
// is valid only while the durable credential row is still session_version 1.
// The first in-console password change increments the version and permanently
// disables this bootstrap path.
const OWNER_BOOTSTRAP_SALT = "5D65o44v_-_4Bdjg_-xQLA";
const OWNER_BOOTSTRAP_HASH = "omSbu4sKSdJ-Zn7NZOL8ONMGTzx0OL99zyOfRTa9XJc";

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function normalizePasswordInput(password) {
  if (password === null || password === undefined) return "";
  return String(password).normalize("NFKC").trim();
}

function sessionSecret() {
  return String(
    process.env.GHOST_AGENCY_ADMIN_SESSION_SECRET
    || process.env.GHOST_AGENCY_ADMIN_TOKEN
    || process.env.GHOST_AGENCY_VISUAL_SECRET
    || process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY
    || "",
  ).trim();
}

function hashPassword(password, salt) {
  return b64url(crypto.scryptSync(normalizePasswordInput(password), Buffer.from(String(salt), "base64url"), 32, SCRYPT_OPTIONS));
}

function safeEq(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function credentialRow() {
  const result = await select(TABLE, `?select=id,salt,password_hash,session_version,updated_at&id=eq.${OWNER_ID}&limit=1`);
  if (!result || result.ok !== true || !Array.isArray(result.data) || !result.data[0]) return null;
  return result.data[0];
}

function bootstrapPasswordMatches(password, sessionVersion = 1) {
  if (Number(sessionVersion) > 1) return false;
  try { return safeEq(hashPassword(password, OWNER_BOOTSTRAP_SALT), OWNER_BOOTSTRAP_HASH); } catch { return false; }
}

async function verifyPassword(password) {
  const normalized = normalizePasswordInput(password);
  if (normalized.length < 8 || normalized.length > 256) return { ok: false };
  const row = await credentialRow();
  if (!row || !row.salt || !row.password_hash) {
    const fallback = bootstrapPasswordMatches(normalized, 1);
    return { ok: fallback, configured: fallback, sessionVersion: 1, source: fallback ? "bootstrap" : "none" };
  }
  const sessionVersion = Number(row.session_version) || 1;
  let durableMatch = false;
  try { durableMatch = safeEq(hashPassword(normalized, row.salt), row.password_hash); } catch { durableMatch = false; }
  const bootstrapMatch = !durableMatch && bootstrapPasswordMatches(normalized, sessionVersion);
  return {
    ok: durableMatch || bootstrapMatch,
    configured: true,
    sessionVersion,
    source: durableMatch ? "durable" : bootstrapMatch ? "bootstrap" : "none",
  };
}

function validateNewPassword(password) {
  const normalized = normalizePasswordInput(password);
  if (normalized.length < 12) return "password_must_be_at_least_12_characters";
  if (normalized.length > 256) return "password_too_long";
  return "";
}

async function changePassword(newPassword) {
  const normalized = normalizePasswordInput(newPassword);
  const reason = validateNewPassword(normalized);
  if (reason) return { ok: false, reason };
  const current = await credentialRow();
  const salt = b64url(crypto.randomBytes(16));
  const passwordHash = hashPassword(normalized, salt);
  const sessionVersion = Math.max(1, Number(current && current.session_version) || 1) + 1;
  const write = await upsertRow(TABLE, {
    id: OWNER_ID,
    salt,
    password_hash: passwordHash,
    session_version: sessionVersion,
    updated_at: new Date().toISOString(),
  }, "id");
  if (!write || !String(write.mode || "").startsWith("live_") || String(write.mode).includes("failed")) {
    return { ok: false, reason: "password_update_failed" };
  }
  return { ok: true, sessionVersion };
}

function signSessionPayload(encoded) {
  const secret = sessionSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
}

function issueSession({ sessionVersion = 1, now = Date.now(), ttlMs = SESSION_TTL_MS } = {}) {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload = {
    v: 1,
    sub: OWNER_ID,
    sv: Number(sessionVersion) || 1,
    iat: now,
    exp: now + Math.max(60_000, Number(ttlMs) || SESSION_TTL_MS),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signSessionPayload(encoded);
  return { token: `wss1.${encoded}.${signature}`, expiresAt: payload.exp, sessionVersion: payload.sv };
}

function verifySessionToken(token, now = Date.now()) {
  const value = String(token || "").trim();
  if (!value.startsWith("wss1.")) return { ok: false };
  const parts = value.split(".");
  if (parts.length !== 3) return { ok: false };
  const expected = signSessionPayload(parts[1]);
  if (!expected || !safeEq(expected, parts[2])) return { ok: false };
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return { ok: false }; }
  if (!payload || payload.v !== 1 || payload.sub !== OWNER_ID) return { ok: false };
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

module.exports = {
  TABLE,
  OWNER_ID,
  SESSION_TTL_MS,
  SCRYPT_OPTIONS,
  OWNER_BOOTSTRAP_SALT,
  OWNER_BOOTSTRAP_HASH,
  normalizePasswordInput,
  bootstrapPasswordMatches,
  sessionSecret,
  hashPassword,
  credentialRow,
  verifyPassword,
  validateNewPassword,
  changePassword,
  issueSession,
  verifySessionToken,
};
