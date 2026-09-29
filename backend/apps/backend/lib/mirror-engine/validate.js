"use strict";

// lib/mirror-engine/validate.js — strict Ajv validation of MirrorRequest.
//
// No coercion, no defaults, no silent removal of unknown fields. A structurally
// malformed value is 400 invalid_request; missing/blank required facts are
// 422 missing_required_facts (handled in facts.js after this passes).
//
// Contract adjustments vs the pasted review schema, each sanctioned by the
// review's own text:
//   - brand.ink / brand.photos DROPPED for v1 (no defined consumer — accepting
//     them makes callers believe the engine honored something it dropped).
//   - brand.accent_source added and required-with-accent (same denylist as logo).
//   - brand.logo_sha256 added (caller-pinned content hash, the "stronger form").
//   - facts dependentRequired latitude<->longitude.
//   - facts.state accepts case-normal two-letter postal input by uppercasing
//     before Ajv; non-two-letter values still fail the schema closed.

const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const mirrorRequestSchema = require("./mirror-request.schema.json");

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  removeAdditional: false,
  useDefaults: false,
  coerceTypes: false,
});
addFormats(ajv); // email/uri are annotation-only without this — assertion required

const validateMirrorRequest = ajv.compile(mirrorRequestSchema);

/**
 * Validate an unknown value as a MirrorRequest.
 * Returns { ok:true, request } or { ok:false, status:400, body } shaped for
 * the handler to send verbatim.
 */
function checkMirrorRequest(value) {
  if (validateMirrorRequest(value)) {
    // Semantic co-requirement Ajv cannot express cleanly across optionality:
    // an accent without its measurement source is unverifiable brand input.
    const brand = value.brand || {};
    if (brand.accent && !brand.accent_source) {
      return {
        ok: false, status: 400,
        body: { ok: false, error: "invalid_request", detail: [{ path: "/brand/accent_source", keyword: "required", message: "accent_source is required when accent is supplied" }] },
      };
    }
    // Same rule for the miner's pre-measured fallback: a colour with no stated
    // source is unverifiable brand input whether or not it is a last resort.
    if (brand.accent_fallback && !brand.accent_fallback_source) {
      return {
        ok: false, status: 400,
        body: { ok: false, error: "invalid_request", detail: [{ path: "/brand/accent_fallback_source", keyword: "required", message: "accent_fallback_source is required when accent_fallback is supplied" }] },
      };
    }
    // And for the site-chrome challenger: the colour their site wears must say
    // which page it was measured from, or it cannot outrank anything.
    if (brand.site_accent && !brand.site_accent_source) {
      return {
        ok: false, status: 400,
        body: { ok: false, error: "invalid_request", detail: [{ path: "/brand/site_accent_source", keyword: "required", message: "site_accent_source is required when site_accent is supplied" }] },
      };
    }
    return { ok: true, request: value };
  }
  const detail = (validateMirrorRequest.errors || []).map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message || "invalid value",
  }));
  return { ok: false, status: 400, body: { ok: false, error: "invalid_request", detail } };
}

module.exports = { checkMirrorRequest, validateMirrorRequest };
