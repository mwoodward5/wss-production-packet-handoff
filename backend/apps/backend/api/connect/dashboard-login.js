"use strict";
// Real per-customer dashboard login: email + PIN, checked against the row
// created for their job at checkout fulfillment (see lib/fulfillment.js).
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { select, upsertRow } = require("../../lib/store");
const { pickAccessRow, signScopeToken } = require("../../lib/dashboard-link");

// A 6-digit PIN is brute-forceable without a throttle. Cap attempts per
// (ip, email) per minute as a first-layer defense. (Serverless instances reset
// this naturally; a persistent lockout is a follow-up.)
const loginAttempts = new Map();
function loginRateLimited(key) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = loginAttempts.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count += 1;
  loginAttempts.set(key, entry);
  return entry.count > 8;
}
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

function cors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = [
    "https://connect.wss-labs.com",
    "https://wss-ai.com",
    "https://www.wss-ai.com",
  ];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const pin = String(body.pin || "").trim();
    if (!email || !pin) {
      sendJson(res, 400, { ok: false, error: "email_and_pin_required" });
      return;
    }
    if (loginRateLimited(`${clientIp(req)}:${email}`)) {
      sendJson(res, 429, { ok: false, error: "too_many_attempts" });
      return;
    }
    // Read EVERY row for this email, not an unordered limit=1. A prospect-preview
    // row and a later paid row can share an owner_email; pickAccessRow keeps only
    // the rows whose PIN verifies and returns the authoritative one (paid over
    // prospect, site-bound over not), so a stale row can no longer shadow the
    // account the customer paid for. See lib/dashboard-link.js pickAccessRow.
    const found = await select(
      "ghost_agency_dashboard_access",
      `owner_email=eq.${encodeURIComponent(email)}&limit=25`,
    );
    // A FAILED READ IS NOT A WRONG PASSWORD.
    //
    // This used to fold `found.ok === false` into the same empty array as "no
    // row matched", so a Supabase blip answered a customer typing their real
    // PIN with "invalid_credentials". Measured on production 2026-08-11: the
    // same email and PIN returned 200 with a scoped token, then 401 four times
    // running, then 200 again — while the stored pin_hash never stopped being
    // sha256 of that exact PIN. Whatever the transport did in between, the one
    // thing that was never true is the sentence the customer was shown.
    //
    // The dashboard is the only door a paying customer has, and being told
    // their password is wrong sends them looking for a password that is not the
    // problem. An unreadable account list now says so, in its own status code,
    // and leaves the credentials unjudged. This is the same rule
    // api/connect/edits.js already states for the transcript: an empty result
    // and an unreadable one are different sentences.
    if (!found || found.ok !== true || !Array.isArray(found.data)) {
      sendJson(res, 503, {
        ok: false,
        error: "account_lookup_unavailable",
        message: "We couldn't reach your account just now — that's us, not your PIN. Try again in a moment.",
      });
      return;
    }
    const row = pickAccessRow(found.data, pin);
    if (!row) {
      sendJson(res, 401, { ok: false, error: "invalid_credentials" });
      return;
    }
    upsertRow(
      "ghost_agency_dashboard_access",
      { job_id: row.job_id, owner_email: row.owner_email, pin_hash: row.pin_hash, last_login_at: new Date().toISOString() },
      "job_id",
    ).catch(() => {});
    // Hand back a scoped token that only unlocks this customer's own data —
    // never the shared full-access CONNECT_APP_TOKEN.
    const scopedToken = row.site_slug ? signScopeToken(row.site_slug) : "";
    sendJson(res, 200, {
      ok: true,
      token: scopedToken,
      scoped: Boolean(scopedToken),
      jobId: row.job_id,
      businessName: row.business_name || null,
      visibilityBusiness: row.visibility_business || null,
    });
  } catch (error) {
    handleError(res, error);
  }
};
