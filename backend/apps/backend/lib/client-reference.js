"use strict";

// The "Client ID" a prospect sees in their outreach email (e.g. WSS-1F9506) and
// reads back to Riley on the phone. It is DERIVED, not stored: a stable hash of
// the prospect id, so the same business always gets the same code across sends,
// reports, and calls without needing a migration or a new column.
//
// Because it is derived rather than persisted, a lookup CANNOT simply query a
// `reference` column — that column is never populated. Riley resolves a spoken
// code by recomputing it over a bounded candidate set (see
// api/vapi-tools/lookup-prospect.js). Keep this derivation stable: changing it
// invalidates every Client ID already printed in a sent email.

const { createHash } = require("node:crypto");

const REFERENCE_PREFIX = "WSS";
const REFERENCE_HEX_LENGTH = 6;

function firstValue(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

// Stable seed preference: the prospect id first (immutable), business name last
// (a rename would otherwise silently change an already-issued Client ID).
function clientReferenceCode(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const seed =
    firstValue(prospect, ["prospect_id", "id", "place_id"]) ||
    firstValue(record, ["prospect_id", "id", "place_id"]) ||
    firstValue(prospect, ["business_name", "businessName", "name", "company"]);
  if (!seed) return "";
  const hex = createHash("sha256").update(String(seed)).digest("hex").slice(0, REFERENCE_HEX_LENGTH).toUpperCase();
  return `${REFERENCE_PREFIX}-${hex}`;
}

// Normalize whatever a caller says or a transcriber produces into the canonical
// WSS-XXXXXX form. Phone transcription is messy, so accept all of:
//   "WSS-1F9506"  "wss 1f9506"  "W S S - 1 F 9 5 0 6"  "1F9506"  "wss1f9506"
// Returns "" when the input cannot be a reference code, so callers can fall
// through to phone/name lookup instead of matching on garbage.
// TWO reference formats exist and both must resolve:
//   1. DERIVED  — "WSS-1F9506": hex, computed here, printed in the outreach
//      email, stored nowhere.
//   2. REGISTERED — "PVLNGW": 6-char alphanumeric minted and PERSISTED by
//      api/vapi-tools/register-prospect.js on the `reference` column.
// So the body must accept any alphanumeric, NOT just hex — a hex-only check
// would silently reject every already-registered prospect.
function referenceBody(input) {
  const raw = String(input || "")
    .toUpperCase()
    // A transcriber writes the spoken separator as a WORD ("W S S dash 1F9506"),
    // which would otherwise survive as letters and corrupt the body.
    .replace(/\b(?:DASH|HYPHEN|MINUS)\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  const body = raw.startsWith(REFERENCE_PREFIX) ? raw.slice(REFERENCE_PREFIX.length) : raw;
  return /^[A-Z0-9]{4,12}$/.test(body) ? body : "";
}

function normalizeReferenceCode(input) {
  const body = referenceBody(input);
  return body ? `${REFERENCE_PREFIX}-${body}` : "";
}

// True when `spoken` refers to the same client code as `actual`, tolerating the
// prefix being dropped or mangled by the transcriber.
function referenceMatches(spoken, actual) {
  const a = referenceBody(spoken);
  const b = referenceBody(actual);
  return Boolean(a && b && a === b);
}

module.exports = {
  REFERENCE_PREFIX,
  clientReferenceCode,
  referenceBody,
  normalizeReferenceCode,
  referenceMatches,
};
