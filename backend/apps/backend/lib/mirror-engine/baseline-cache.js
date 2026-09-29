"use strict";

// The native content-floor baseline is immutable for one donor tree + route +
// channel target. Keep only its small measurement tuple in memory; never keep
// pages, browser handles, or customer content. The donor content hash is part
// of every key, so a changed donor tree is a cache miss by construction.
const MAX_BASELINE_MEASUREMENTS = 192;
const baselineMeasurements = new Map();

function normalizedIdentity(identity) {
  if (!identity || typeof identity !== "object") return null;
  const donorId = String(identity.donorId || "").trim();
  const donorHash = String(identity.donorHash || "").trim();
  if (!donorId || !donorHash) return null;
  return {
    donorId,
    donorVersion: String(identity.donorVersion || "").trim(),
    donorHash,
  };
}

function cacheKey(identity, path, channel, selectors) {
  const id = normalizedIdentity(identity);
  if (!id) return null;
  return JSON.stringify([
    id.donorId,
    id.donorVersion,
    id.donorHash,
    String(path || "/"),
    String(channel || ""),
    Array.isArray(selectors) ? selectors.map((selector) => String(selector || "")) : [],
  ]);
}

function cloneMeasurement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    _baseline_target_text: String(value._baseline_target_text || ""),
    baseline_checked: value.baseline_checked === true,
    baseline_targets_found: Number(value.baseline_targets_found) || 0,
  };
}

function cachedBaselineTargets(identity, path, contentTargets) {
  if (!normalizedIdentity(identity)) return null;
  const out = {};
  for (const [channel, selectors] of Object.entries(contentTargets || {})) {
    const key = cacheKey(identity, path, channel, selectors);
    const cached = key && baselineMeasurements.get(key);
    if (!cached) return null;
    // LRU within a small hard bound.
    baselineMeasurements.delete(key);
    baselineMeasurements.set(key, cached);
    out[channel] = cloneMeasurement(cached);
  }
  return out;
}

function storeBaselineTargets(identity, path, contentTargets, measured) {
  if (!normalizedIdentity(identity) || !measured || typeof measured !== "object") return;
  const entries = Object.entries(contentTargets || {});
  // Do not seed a partial path. A future hit must represent exactly the same
  // all-channel evidence the uncached render produced.
  if (entries.some(([channel]) => !cloneMeasurement(measured[channel]))) return;
  for (const [channel, selectors] of entries) {
    const key = cacheKey(identity, path, channel, selectors);
    if (!key) continue;
    baselineMeasurements.delete(key);
    baselineMeasurements.set(key, Object.freeze(cloneMeasurement(measured[channel])));
    while (baselineMeasurements.size > MAX_BASELINE_MEASUREMENTS) {
      baselineMeasurements.delete(baselineMeasurements.keys().next().value);
    }
  }
}

async function baselineTargetsFor({ identity, path = "/", contentTargets = {}, measure }) {
  const hasContentTargets = Object.values(contentTargets || {})
    .some((selectors) => Array.isArray(selectors) && selectors.length > 0);
  if (!hasContentTargets) return {};

  const cached = cachedBaselineTargets(identity, path, contentTargets);
  if (cached) return cached;

  // Cache MISS is intentionally the historical path: one complete empty-island
  // render for this route, producing the same measurement object as before.
  const measured = await measure(contentTargets);
  if (!measured || typeof measured !== "object" || Array.isArray(measured)) return {};
  storeBaselineTargets(identity, path, contentTargets, measured);
  return measured;
}

function resetBaselineMeasurementsForTest() {
  baselineMeasurements.clear();
}

module.exports = {
  MAX_BASELINE_MEASUREMENTS,
  baselineTargetsFor,
  cachedBaselineTargets,
  storeBaselineTargets,
  resetBaselineMeasurementsForTest,
};
