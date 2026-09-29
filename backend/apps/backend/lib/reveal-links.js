"use strict";

// Signed public "reveal" links — the email preview thumbnail/button points here
// instead of straight at /try/<key>/. Same HMAC pattern as report-links.js /
// checkout-links.js. Stage 1: the route records the click and 302-redirects to
// the (already-built) preview. Stage 2 (behind SITEFORGE_BUILD_ON_CLICK) will
// build-on-click here so we stop prebuilding sites nobody opens.

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
  return createHmac("sha256", secret()).update(`reveal:${token}`).digest("base64url");
}

function revealLinkStatus() {
  return { configured: Boolean(secret()) };
}

function buildRevealLink(prospect = {}) {
  if (!secret()) return "";
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : prospect;
  const previewUrl = String(prospect.preview_url || record.preview_url || "").slice(0, 300);
  const prospectId = String(prospect.prospect_id || prospect.id || record.prospect_id || "").slice(0, 160);
  if (!previewUrl && !prospectId) return "";
  const payload = {
    v: 1,
    exp: Date.now() + TTL_MS,
    prospect_id: prospectId,
    business_name: String(prospect.business_name || record.business_name || record.name || "Local Business").slice(0, 180),
    industry: String(prospect.industry || record.industry || "local service").slice(0, 100),
    preview_url: previewUrl,
  };
  const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const base = publicConfig().apiUrl.replace(/\/+$/, "");
  return `${base}/api/reveal?token=${encodeURIComponent(token)}&sig=${encodeURIComponent(sign(token))}`;
}

function verifyRevealLink(token, sig) {
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
  if (!payload || payload.v !== 1) return { ok: false, reason: "invalid_payload" };
  // A MISSING EXPIRY IS AN EXPIRED ONE — `NaN < Date.now()` is false, so a
  // payload with no `exp` used to be permanent. See report-links.js.
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

module.exports = { buildRevealLink, verifyRevealLink, revealLinkStatus };
