"use strict";
// lib/dashboard-link.js — real per-customer dashboard access.
// Two credentials are issued at checkout fulfillment:
//   1. A signed one-click link (#t=<token>) — no DB round trip, self-verifying,
//      expires on its own. Used as the primary "Open my dashboard" button.
//   2. A 6-digit PIN, hashed and stored per job in ghost_agency_dashboard_access —
//      a memorable fallback for logging in on a different device later.
// Both ultimately unlock the same shared CONNECT_APP_TOKEN the rest of the
// Connect/dashboard APIs already gate on (connectAuthorized in lib/connect.js).
// This is intentionally additive: it does not touch or require changing the
// existing single-tenant token model, it just gives each customer their own
// door into it instead of one shared static secret baked into public JS.

const { createHash, createHmac, randomInt, timingSafeEqual } = require("node:crypto");

function linkSecret() {
  return String(process.env.CONNECT_APP_TOKEN || process.env.GHOST_AGENCY_ADMIN_TOKEN || "").trim();
}

function signDashboardLink(jobId, ttlDays = 180) {
  const secret = linkSecret();
  const id = String(jobId || "").trim();
  if (!secret || !id) return "";
  const exp = Date.now() + ttlDays * 24 * 60 * 60 * 1000;
  const payload = `${id}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
  return Buffer.from(`${payload}.${sig}`, "utf8").toString("base64url");
}

function verifyDashboardLink(token) {
  const secret = linkSecret();
  const t = String(token || "").trim();
  if (!secret) return { ok: false, reason: "not_configured" };
  if (!t) return { ok: false, reason: "missing_token" };
  let decoded;
  try {
    decoded = Buffer.from(t, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [jobId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!jobId || !Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(`${jobId}.${expStr}`).digest("hex").slice(0, 32);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  if (Date.now() > exp) return { ok: false, reason: "expired" };
  return { ok: true, jobId };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "";
}

// Scoped tenant token: unlocks ONLY one customer's site_slug worth of data,
// unlike the shared CONNECT_APP_TOKEN which is full access. Encoded so the
// backend can tell the two apart and filter accordingly (see lib/connect.js
// resolveConnectScope). Format: base64url("s2.<siteSlug>.<exp>.<sig>").
function signScopeToken(siteSlug, ttlDays = 180) {
  const secret = linkSecret();
  const slug = slugify(siteSlug);
  if (!secret || !slug) return "";
  const exp = Date.now() + ttlDays * 24 * 60 * 60 * 1000;
  const payload = `s2.${slug}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
  return Buffer.from(`${payload}.${sig}`, "utf8").toString("base64url");
}

function verifyScopeToken(token) {
  const secret = linkSecret();
  const t = String(token || "").trim();
  if (!secret || !t) return { ok: false };
  let decoded;
  try { decoded = Buffer.from(t, "base64url").toString("utf8"); } catch { return { ok: false }; }
  const parts = decoded.split(".");
  if (parts.length !== 4 || parts[0] !== "s2") return { ok: false };
  const [, slug, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!slug || !Number.isFinite(exp)) return { ok: false };
  const expected = createHmac("sha256", secret).update(`s2.${slug}.${expStr}`).digest("hex").slice(0, 32);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  if (Date.now() > exp) return { ok: false, reason: "expired" };
  return { ok: true, siteSlug: slug };
}

function generatePin() {
  return String(randomInt(100000, 1000000)); // always 6 digits
}

function hashPin(pin) {
  return createHash("sha256").update(String(pin || "").trim()).digest("hex");
}

function verifyPinHash(pin, hash) {
  const p = String(pin || "").trim();
  const h = String(hash || "").trim();
  if (!p || !h) return false;
  const a = Buffer.from(hashPin(p));
  const b = Buffer.from(h);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Resolve email+PIN to ONE access row without letting a stale row shadow the
// real one. The bug this closes: dashboard-login used to read the access table
// with `owner_email=eq.<email>&limit=1` and NO ordering, so for an email that
// has both a prospect-preview row (job_id "prospect-…", written by the magic
// link helper) and a later PAID row (job_id = the checkout id), the database
// was free to hand back the prospect row. Verifying that one row's PIN then
// failed for a customer typing their real activation PIN — they were locked out
// of the account they paid for — or, worse, matched the prospect PIN and pinned
// them to the prospect's scope.
//
// The fix considers EVERY row for the email, keeps only those whose PIN
// actually verifies, and among those prefers the authoritative one: a real
// (non-prospect) job wins over a prospect preview, a row bound to a site wins
// over one that is not, and the most recently touched row breaks any remaining
// tie. Returns null when nothing verifies — the caller then fails closed with
// invalid_credentials, never a guessed session.
function isProspectJob(jobId) {
  return String(jobId || "").startsWith("prospect-");
}
function accessRowRank(row) {
  // Lower sorts first (more authoritative).
  const paid = isProspectJob(row && row.job_id) ? 1 : 0;
  const unbound = row && row.site_slug ? 0 : 1;
  const t = Date.parse((row && (row.last_login_at || row.updated_at || row.created_at)) || "");
  const recency = Number.isFinite(t) ? -t : 0; // newer (larger t) sorts first
  return [paid, unbound, recency];
}
function pickAccessRow(rows, pin) {
  const list = Array.isArray(rows) ? rows : [];
  const matches = list.filter((row) => row && verifyPinHash(pin, row.pin_hash));
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const ra = accessRowRank(a);
    const rb = accessRowRank(b);
    for (let i = 0; i < ra.length; i += 1) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    return 0;
  });
  return matches[0];
}

module.exports = { signDashboardLink, verifyDashboardLink, generatePin, hashPin, verifyPinHash, slugify, signScopeToken, verifyScopeToken, pickAccessRow };
