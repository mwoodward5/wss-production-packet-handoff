"use strict";

// lib/mirror-engine/photo-uri-sanitize.js — sanitize URI-carrying brand fields
// BEFORE the request is validated, not after its 400.
//
// SIX REAL BUSINESSES, ONE NIGHT (campaign line_mtifkuok, plumbing
// nationwide — TDT Plumbing, Abacus Plumbing, Apollo Home, Archie's Plumbing,
// Fancher Services, Cloverdale Plumbing): every one died `build_retry_exhausted`
// on a request that could never validate. The underlying cause was visible
// earlier on Belknap Plumbing: "invalid_request (status 400) — /brand/photos/14:
// must match format uri". mirror-request.schema.json types every brand URI as
// RequiredHttpsUri — format "uri" AND pattern ^https:// — and the assembly
// paths gated their photo lists on the ^https:// PREFIX only. ajv's "uri"
// format (ajv-formats fast: scheme + optional // + [^\s]*$) still fails a URL
// that carries a single space, tab or control character anywhere — exactly
// what a scraped src="pic (1).jpg", a wrapped harvest string or a trailing
// newline carries. A business with thirteen good photos and one malformed one
// 400'd at REQUEST validation, where retrying can never help, so the retry
// budget burned down and the row died.
//
// SANITATION, NOT GATING: a value that cannot be a URI is DROPPED — with a
// count, so the operator can see that the gallery shrank and why — and the
// build proceeds with the photographs that validate. Zero valid photos is the
// existing no-photos path (the donor's declared photo slots stay unfilled),
// never a refusal.
//
// Rules, applied per candidate:
//   - strings only, trimmed (a trailing newline on an otherwise good URL is a
//     markup artifact, not a different address)
//   - https-scheme absolute URLs only: new URL() must parse it and the
//     protocol must be https: (data:, protocol-relative //host, /relative and
//     garbage are dropped — the schema pattern ^https:// would 400 them)
//   - the scheme is lowercased: the schema pattern is case-sensitive and
//     "HTTPS://…/x" is the same resource as "https://…/x"
//   - no whitespace or control character anywhere (what ajv's uri format
//     actually enforces); a URL is re-serialized nowhere — a value that does
//     not already parse clean is dropped, not rewritten
//   - deduplicated (the schema's uniqueItems also 400s a request) and capped
//     at the schema maxItems AFTER filtering, order preserved.

// mirror-request.schema.json: brand.photos maxItems (kept in step with
// MAX_PHOTOS in lib/mirror-lane-build.js).
const SCHEMA_MAX_PHOTOS = 20;

// ajv-formats fast "uri" is [^\s]*$ after the scheme; control characters are
// outside the full RFC3986 grammar too, so both the enforced format and the
// stricter one reject anything in these ranges.
const URI_FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f-\u009f]/;

/**
 * sanitizeHttpsUri(raw) -> string
 *
 * A trimmed, parsed, https-only URL — or "" when the value cannot travel in a
 * RequiredHttpsUri/OptionalUri slot (brand.logo, brand.accent_source,
 * brand.hero_video.url, facts.current_website, facts.profile_url) without
 * 400ing the whole request. The caller treats "" exactly as "no candidate",
 * the same as every other missing-asset rung.
 */
function sanitizeHttpsUri(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!/^https:\/\//i.test(trimmed)) return "";
  // Case-sensitive schema pattern ^https:// — normalize the scheme only.
  const normalized = `https://${trimmed.slice(8)}`;
  if (URI_FORBIDDEN_CHARS.test(normalized)) return "";
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:") return "";
  } catch {
    return "";
  }
  return normalized;
}

/**
 * sanitizePhotoUris(candidates, { max = SCHEMA_MAX_PHOTOS }) ->
 *   { photos: string[], droppedInvalid: number }
 *
 * Keep the values that parse as absolute https URLs, in order; drop the rest
 * with a count. `droppedInvalid` counts every candidate that did not survive —
 * malformed (data:, relative, whitespace, non-string) and duplicates a like,
 * because each one is a photograph the gallery quietly lost and the operator
 * is entitled to that number. The schema maxItems cap is applied AFTER
 * filtering, so a capped list is always a list the request can carry.
 */
function sanitizePhotoUris(candidates, { max = SCHEMA_MAX_PHOTOS } = {}) {
  const photos = [];
  let droppedInvalid = 0;
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const uri = sanitizeHttpsUri(candidate);
    if (!uri) {
      droppedInvalid += 1;
      continue;
    }
    if (photos.includes(uri)) {
      droppedInvalid += 1;
      continue;
    }
    photos.push(uri);
  }
  const cap = Number.isFinite(max) ? Math.max(0, max) : SCHEMA_MAX_PHOTOS;
  return { photos: photos.slice(0, cap), droppedInvalid };
}

module.exports = { sanitizeHttpsUri, sanitizePhotoUris, SCHEMA_MAX_PHOTOS };
