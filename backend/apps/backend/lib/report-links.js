"use strict";

// Signed public growth-report links. Same HMAC pattern as checkout-links.
// The payload is self-contained so the report renders even if the DB row is
// unavailable; the route refreshes from ghost_agency_prospects when it can.

const { createHmac, timingSafeEqual } = require("node:crypto");
const { publicConfig } = require("./registry");

const TTL_MS = 90 * 24 * 60 * 60 * 1000;

function secret() {
  return String(
    process.env.GHOST_AGENCY_REPORT_LINK_SECRET ||
      process.env.GHOST_AGENCY_CHECKOUT_LINK_SECRET ||
      "",
  ).trim();
}

function sign(token) {
  return createHmac("sha256", secret()).update(`report:${token}`).digest("base64url");
}

function reportLinkStatus() {
  return { configured: Boolean(secret()) };
}

function buildReportLink(prospect = {}) {
  if (!secret()) return "";
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : prospect;
  const payload = {
    v: 1,
    exp: Date.now() + TTL_MS,
    prospect_id: String(prospect.prospect_id || prospect.id || "").slice(0, 160),
    business_name: String(prospect.business_name || record.business_name || record.name || "Local Business").slice(0, 180),
    city: String(prospect.city || record.city || "").slice(0, 100),
    industry: String(prospect.industry || record.industry || "local service").slice(0, 100),
    rating: Number(record.rating || prospect.rating || 0) || 0,
    review_count: Number(record.review_count || record.reviewCount || prospect.review_count || 0) || 0,
    website: String(prospect.current_website || record.current_website || record.website || "").slice(0, 300),
    weaknesses: (record.weaknesses || record.weaknessReasons || []).slice(0, 6).map((w) => String(w).slice(0, 140)),
    preview_url: String(prospect.preview_url || record.preview_url || "").slice(0, 300),
  };
  const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const base = publicConfig().apiUrl.replace(/\/+$/, "");
  return `${base}/api/report?token=${encodeURIComponent(token)}&sig=${encodeURIComponent(sign(token))}`;
}

function verifyReportLink(token, sig) {
  if (!secret() || !token || !sig) return { ok: false, reason: "not_configured_or_missing" };
  const expected = Buffer.from(sign(String(token)));
  const actual = Buffer.from(String(sig));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "invalid_signature" };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(String(token), "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  // A MISSING EXPIRY IS AN EXPIRED ONE. `Number(undefined) < Date.now()` is
  // NaN < n, which is FALSE — so a token minted without an `exp` (a hand-rolled
  // one, an older payload shape, a truncated JSON) sailed through this check and
  // never expired, for as long as the signing secret lived. The finite test has
  // to come first and it has to be its own predicate; there is no arithmetic on
  // NaN that answers "is this in the past" correctly.
  const exp = Number(payload.exp);
  if (payload.v !== 1) return { ok: false, reason: "invalid_payload" };
  if (!Number.isFinite(exp) || exp < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

module.exports = { buildReportLink, reportLinkStatus, verifyReportLink };
