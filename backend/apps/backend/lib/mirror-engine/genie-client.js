"use strict";

// lib/mirror-engine/genie-client.js — call the LIVE Intake Genie compiler.
//
//   POST {INTAKE_GENIE_BASE_URL}/api/intake-genie/compile
//   Authorization: Bearer {INTAKE_GENIE_TOKEN}
//   Idempotency-Key: <stable per prospect+source set>
//
// SiteForge owns Firecrawl and canonical business truth (Ghost-boundary doc,
// 2026-07-29). This client only ASKS; it never enriches, never falls back to
// invented facts, and never calls Firecrawl/BrightLocal itself. A non-success
// Genie status (out_of_scope / needs_input / blocked) is returned verbatim so
// the caller can hold the prospect instead of shipping a guess.

const { createHash } = require("node:crypto");

function genieEnv() {
  const base = String(
    process.env.INTAKE_GENIE_BASE_URL
    || process.env.GHOST_AGENCY_INTAKE_GENIE_URL
    || process.env.SITEFORGE_INTAKE_GENIE_BASE_URL
    || "",
  ).trim().replace(/\/+$/, "");
  const token = String(
    process.env.INTAKE_GENIE_TOKEN
    || process.env.GHOST_AGENCY_INTAKE_GENIE_TOKEN
    || process.env.SITEFORGE_INTAKE_GENIE_TOKEN
    || "",
  ).trim();
  if (!base || !token) throw new Error("INTAKE_GENIE_BASE_URL / INTAKE_GENIE_TOKEN not configured");
  return { base, token };
}

/** Stable idempotency key: same prospect + same sources => same key. */
function idempotencyKeyFor(input) {
  return "mirror-" + createHash("sha256").update(JSON.stringify({
    d: input.description || "",
    s: input.sources || {},
    h: input.prospect_hints || {},
  })).digest("hex").slice(0, 32);
}

/**
 * compile({ description, sources, prospect_hints }) -> { ok, packet } | { ok:false, status, packet, error }
 *
 * sources: { website_url, gbp_url, social_url, asset_url }
 * prospect_hints: { name, city, state, phone, address, category, services[] }
 *
 * build_preview is ALWAYS false: the Mirror Engine is the renderer. Letting
 * the Genie build its own preview here would produce two renderers for one
 * prospect — the exact ambiguity the renderer-identity contract exists to end.
 */
async function compile({ description = "", sources = {}, prospect_hints = {}, timeoutMs = 120000 } = {}) {
  const { base, token } = genieEnv();
  const body = { description, sources, prospect_hints, build_preview: false };
  const res = await fetch(`${base}/api/intake-genie/compile`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": idempotencyKeyFor(body),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let packet;
  try { packet = JSON.parse(text); } catch {
    return { ok: false, status: `http_${res.status}`, error: `genie returned non-JSON: ${text.slice(0, 200)}` };
  }
  if (!res.ok) {
    return { ok: false, status: packet.status || `http_${res.status}`, packet, error: packet.error || `genie http ${res.status}` };
  }
  if (packet.ok === false || (packet.status && !["complete", "ok"].includes(packet.status))) {
    // out_of_scope / needs_input / blocked are legitimate answers — hold the
    // prospect, do not substitute anything.
    return { ok: false, status: packet.status || "not_complete", packet, error: packet.error || packet.question || packet.status };
  }
  return { ok: true, packet };
}

module.exports = { compile, idempotencyKeyFor, genieEnv };
