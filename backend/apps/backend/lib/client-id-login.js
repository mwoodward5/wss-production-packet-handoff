"use strict";
// lib/client-id-login.js — resolve the Client ID a customer actually holds.
//
// THE PROBLEM THIS EXISTS FOR. The outreach email prints a Client ID twice, in
// the largest type on the page, and tells the business to quote it to Riley.
// Then the dashboard asked for an EMAIL and a PIN — two credentials the
// prospect was never given. They arrived holding the one key we printed and it
// fit nothing. Verified 2026-08-12: dashboard-login required email+pin, and no
// outreach email has ever contained a PIN.
//
// The owner's ruling: the Client ID is enough to get IN, and the customer sets
// a password once inside. That is right, and it also closes the real risk,
// which is not money — the dashboard carries the phone numbers of THEIR
// customers, so a Client ID sitting in a forwarded email must be a one-time
// door, never a standing key.
//
// THE AWKWARD PART: the Client ID is DERIVED (sha256 of prospect_id, see
// lib/client-reference.js), not stored, so there is no column to query. It is
// recomputed over the prospect set and matched. That set is ~1.3k rows, which
// is one cheap pass, and the alternative — persisting it — would break every
// code already printed in a sent email if the derivation ever moved.

const { createHash, timingSafeEqual } = require("node:crypto");
const { clientReferenceCode, normalizeReferenceCode } = require("./client-reference");

// Registered codes ARE persisted on `reference` (register-prospect.js mints
// them); derived codes are not. Both must resolve, so both are checked.
function codesFor(prospect) {
  const out = [];
  const stored = prospect && (prospect.reference
    || (prospect.record && typeof prospect.record === "object" && prospect.record.reference));
  if (stored) {
    const n = normalizeReferenceCode(stored);
    if (n) out.push(n);
  }
  const derived = clientReferenceCode(prospect);
  if (derived) out.push(derived);
  return out;
}

/**
 * resolveClientId(clientId, prospects) -> { ok, prospect } | { ok:false, reason }
 *
 * AMBIGUITY IS A REFUSAL, NEVER A COIN FLIP. Two businesses answering to one
 * code means reading one of them a stranger's account; the same rule Riley's
 * lookup already follows on the phone.
 */
function resolveClientId(clientId, prospects = []) {
  const wanted = normalizeReferenceCode(clientId);
  if (!wanted) return { ok: false, reason: "not_a_client_id" };
  const hits = [];
  for (const p of prospects) {
    if (codesFor(p).includes(wanted)) hits.push(p);
  }
  if (!hits.length) return { ok: false, reason: "no_such_client_id" };
  if (hits.length > 1) return { ok: false, reason: "client_id_ambiguous", count: hits.length };
  return { ok: true, prospect: hits[0] };
}

function hashSecret(secret, salt) {
  return createHash("sha256").update(`${salt}:${String(secret)}`).digest("hex");
}

// Constant-time compare so a wrong password cannot be found a character at a
// time. Length mismatch is answered with a same-length dummy compare rather
// than an early return, for the same reason.
function secretMatches(secret, salt, storedHash) {
  const expected = String(storedHash || "");
  const actual = hashSecret(secret, salt);
  if (expected.length !== actual.length) {
    try { timingSafeEqual(Buffer.from(actual), Buffer.from(actual)); } catch { /* ignore */ }
    return false;
  }
  try { return timingSafeEqual(Buffer.from(actual), Buffer.from(expected)); } catch { return false; }
}

/**
 * loginVerdict({ row, password }) — what this credential set actually earns.
 *
 * Three honest outcomes, and the middle one is the whole point of the design:
 *   set_password  — the Client ID matched and no password exists yet. Let them
 *                   in ONCE, for the sole purpose of choosing one.
 *   ok            — Client ID + the password they chose.
 *   wrong_password— a password exists and this is not it.
 */
function loginVerdict({ row, password } = {}) {
  if (!row) return { ok: false, reason: "no_account_row" };
  const stored = row.password_hash || "";
  if (!stored) return { ok: true, mustSetPassword: true, reason: "set_password" };
  if (!password) return { ok: false, reason: "password_required" };
  if (!secretMatches(password, row.job_id || row.site_slug || "", stored)) {
    return { ok: false, reason: "wrong_password" };
  }
  return { ok: true, mustSetPassword: false };
}

// A password a customer picks under pressure on a phone screen. Long enough to
// not be guessed, short enough that a plumber will actually set one.
function passwordProblem(password) {
  const p = String(password || "");
  if (p.length < 8) return "Please use at least 8 characters.";
  if (p.length > 200) return "That is too long.";
  if (!/[^\s]/.test(p)) return "Please use at least 8 characters.";
  return "";
}

module.exports = {
  resolveClientId,
  codesFor,
  hashSecret,
  secretMatches,
  loginVerdict,
  passwordProblem,
};
