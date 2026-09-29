"use strict";

const IDENTITY_VERSION = "prospect-identity-v1";
const SHARED_PLATFORM_DOMAINS = new Set([
  "facebook.com", "instagram.com", "yelp.com", "google.com", "googleusercontent.com",
  "linkedin.com", "tiktok.com", "youtube.com", "x.com", "twitter.com", "linktr.ee",
]);

function clean(value) {
  return String(value || "").trim();
}

function ascii(value) {
  return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeDomain(value) {
  let raw = clean(value).toLowerCase();
  if (!raw) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const shared = [...SHARED_PLATFORM_DOMAINS].some((domain) => host === domain || host.endsWith(`.${domain}`));
    return host && host.includes(".") && !shared ? host : "";
  } catch {
    return "";
  }
}

function normalizePhone(value, defaultCountryCode = "1") {
  const raw = clean(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10 && defaultCountryCode) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  return digits.length >= 11 ? `+${digits}` : digits;
}

function normalizeBusinessName(value) {
  return ascii(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:llc|ltd|incorporated|inc|corp(?:oration)?|company|co)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeAddress(value) {
  return ascii(value)
    .toLowerCase()
    .replace(/\b(?:suite|ste|unit|apt|apartment)\s*[#-]?\s*[a-z0-9-]+\b/g, " ")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\broad\b/g, "rd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\blane\b/g, "ln")
    .replace(/\bhighway\b/g, "hwy")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function first(input, fields) {
  for (const field of fields) {
    if (clean(input?.[field])) return input[field];
  }
  return "";
}

function canonicalIdentity(prospect = {}) {
  const placeId = clean(first(prospect, ["place_id", "placeId"])).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 240);
  const domain = normalizeDomain(first(prospect, ["current_website", "website", "url", "site"]));
  const phone = normalizePhone(first(prospect, ["phone", "business_phone", "telephone"]));
  const name = normalizeBusinessName(first(prospect, ["business_name", "businessName", "name"]));
  const address = normalizeAddress([
    first(prospect, ["address", "street_address", "formatted_address"]),
    first(prospect, ["city"]),
    first(prospect, ["state"]),
    first(prospect, ["postal_code", "zip"]),
  ].filter(Boolean).join(" "));
  const keys = [];
  if (placeId) keys.push(`place:${placeId}`);
  if (domain) keys.push(`domain:${domain}`);
  if (phone) keys.push(`phone:${phone}`);
  if (name && address) keys.push(`name_address:${name}|${address}`);
  return {
    version: IDENTITY_VERSION,
    placeId,
    domain,
    phone,
    name,
    address,
    keys,
    canonicalKey: keys[0] || "",
  };
}

function matchCanonicalIdentity(left, right) {
  const a = left?.keys ? left : canonicalIdentity(left);
  const b = right?.keys ? right : canonicalIdentity(right);
  const rightKeys = new Set(b.keys);
  const matches = a.keys.filter((key) => rightKeys.has(key));
  return {
    matched: matches.length > 0,
    matches,
    strongestKey: matches.find((key) => key.startsWith("place:"))
      || matches.find((key) => key.startsWith("domain:"))
      || matches.find((key) => key.startsWith("phone:"))
      || matches[0]
      || "",
  };
}

function equivalentField(field, left, right) {
  if (["current_website"].includes(field)) return normalizeDomain(left) === normalizeDomain(right);
  if (field === "phone") return normalizePhone(left) === normalizePhone(right);
  if (field === "business_name") return normalizeBusinessName(left) === normalizeBusinessName(right);
  if (field === "address") return normalizeAddress(left) === normalizeAddress(right);
  if (["email", "owner_email"].includes(field)) return clean(left).toLowerCase() === clean(right).toLowerCase();
  return clean(left).toLowerCase() === clean(right).toLowerCase();
}

function mergeSafePlan(existing = {}, incoming = {}) {
  const protectedFields = [
    "business_name", "owner_name", "email", "owner_email", "phone", "current_website",
    "address", "city", "state", "postal_code", "industry", "preview_url", "report_url",
  ];
  const patch = {};
  const conflicts = [];
  for (const field of protectedFields) {
    const current = clean(existing[field]);
    const candidate = clean(incoming[field]);
    if (!current && candidate) patch[field] = incoming[field];
    else if (current && candidate && !equivalentField(field, existing[field], incoming[field])) {
      conflicts.push({ field, existing: existing[field], incoming: incoming[field] });
    }
  }
  const existingIdentity = canonicalIdentity(existing);
  const incomingIdentity = canonicalIdentity(incoming);
  const match = matchCanonicalIdentity(existingIdentity, incomingIdentity);
  return {
    safeToMerge: match.matched,
    match,
    patch,
    conflicts,
    aliases: [...new Set([...existingIdentity.keys, ...incomingIdentity.keys])],
    requiresReview: !match.matched || conflicts.length > 0,
  };
}

function identityCounters(prospects = []) {
  const seen = new Map();
  let unidentifiable = 0;
  let duplicateRows = 0;
  for (const prospect of prospects) {
    const identity = canonicalIdentity(prospect);
    if (!identity.keys.length) {
      unidentifiable += 1;
      continue;
    }
    const prior = identity.keys.find((key) => seen.has(key));
    if (prior) duplicateRows += 1;
    else for (const key of identity.keys) seen.set(key, prospect);
  }
  return {
    rows: prospects.length,
    identifiableRows: prospects.length - unidentifiable,
    uniqueProspects: prospects.length - unidentifiable - duplicateRows,
    duplicateRows,
    unidentifiableRows: unidentifiable,
  };
}

module.exports = {
  IDENTITY_VERSION,
  SHARED_PLATFORM_DOMAINS,
  canonicalIdentity,
  identityCounters,
  matchCanonicalIdentity,
  mergeSafePlan,
  normalizeAddress,
  normalizeBusinessName,
  normalizeDomain,
  normalizePhone,
};
