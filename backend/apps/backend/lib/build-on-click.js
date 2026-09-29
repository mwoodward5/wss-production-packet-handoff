"use strict";

// Build-on-click (Stage 2). When SITEFORGE_BUILD_ON_CLICK is enabled, outreach
// does NOT prebuild sites: the email carries a teaser, and the full build runs
// only when the prospect clicks the reveal link (api/reveal.js). This stops
// paying to prebuild sites nobody opens. Flag OFF = today's prebuild behavior,
// unchanged.

const { select } = require("./store");
const { prospectFromRow } = require("./prospects");

// FNV-1a hash (32-bit, compatible with murmur/xxhash modulo behavior).
// Not for crypto/security; just a fast, tiny deterministic hash for partitioning.
function fnv1a(value = "") {
  const s = String(value);
  let h = 2166136261; // FNV_offset_basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0; // unsigned 32-bit integer
}

function parseSampleFraction(envValue = "") {
  const s = String(envValue).trim();
  if (!s) return 0;
  if (s.endsWith("%")) {
    const n = parseFloat(s.slice(0, -1)) / 100;
    return (Number.isFinite(n) && n > 0 && n <= 1) ? n : 0;
  }
  if (s.includes("/")) {
    const parts = s.split("/").map(parseFloat);
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[1] > 0) {
      const n = parts[0] / parts[1];
      return (n > 0 && n <= 1) ? n : 0;
    }
    return 0; // a slash was present but malformed — never fall through to parseFloat
  }
  const n = parseFloat(s);
  return (Number.isFinite(n) && n > 0 && n <= 1) ? n : 0;
}

function sampledBuildOnClick(prospectId = "", env = process.env) {
  if (buildOnClickEnabled(env)) return true; // Global flag always forces reveal

  const sampleFraction = parseSampleFraction(env.SITEFORGE_BUILD_ON_CLICK_SAMPLE);
  if (sampleFraction === 0) return false; // Not configured or invalid fraction, fall back to prebuilt-only

  // Deterministic sampling: hash prospectId, then check against fraction
  const hash = fnv1a(prospectId);
  return (hash / 0xffffffff) < sampleFraction;
}

function buildOnClickEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.SITEFORGE_BUILD_ON_CLICK || "").trim());
}

function prospectPreviewUrl(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const url = String(prospect.preview_url || record.preview_url || "").trim();
  return /^https:\/\//i.test(url) ? url : "";
}

// Deterministic per-prospect run id so repeated clicks (and Gmail/Outlook
// scanner prefetch) resume the SAME durable build instead of starting new ones.
function revealRunId(prospectId = "") {
  return `reveal_${String(prospectId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80)}`;
}

async function loadProspectById(prospectId, lookup = select) {
  const id = String(prospectId || "").trim();
  if (!id) return null;
  const result = await lookup(
    "ghost_agency_prospects",
    `select=*&prospect_id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  if (!result?.ok || !Array.isArray(result.data) || !result.data[0]) return null;
  return prospectFromRow(result.data[0]);
}

module.exports = { buildOnClickEnabled, prospectPreviewUrl, revealRunId, loadProspectById, sampledBuildOnClick };
