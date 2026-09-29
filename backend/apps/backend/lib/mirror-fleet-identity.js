"use strict";

const { boundedDetailText } = require("./detail-text");

// Durable published-identity and sameness-retry facts. Both logs are append
// only. Deterministic UUIDs turn the events table primary key into the narrow
// atomic uniqueness boundary needed by legacy backfill and attempt-2 claims.

const { createHash } = require("node:crypto");
const { insertRow, recordEvent, select } = require("./store");

const EVENT_TYPE = "mirror.identity";
const RETRY_EVENT_TYPE = "mirror.sameness_retry";
const FINGERPRINT_VERSION = "business_city_v1";
const BACKFILL_VERSION = "mirror_identity_v1";
const DEFAULT_LIMIT = 500;
const LEGAL_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "ltd", "limited", "co", "company",
  "corp", "corporation", "pllc",
]);

function bounded(value, length) {
  // Store failure shapes arrive as objects ({error:{code,...}} / {reason:{...}});
  // String() would collapse them to "[object Object]" and erase the only
  // evidence of why a fleet-identity write did not earn its live_write receipt
  // (production: Moyer Electric + Zwicker Electric, 2026-08-31/09-01).
  const text = value != null && typeof value === "object"
    ? (() => { try { return JSON.stringify(value); } catch { return String(value); } })()
    : String(value == null ? "" : value);
  return text.trim().slice(0, length);
}

function normalizedWords(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    // Periods and apostrophes do not create a token boundary: L.L.C. -> llc,
    // O'Connor -> oconnor. Other punctuation does: Acme-Roofing -> acme roofing.
    .replace(/[.'’]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBusiness(value) {
  const words = normalizedWords(value).split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

function normalizeCity(value) {
  return normalizedWords(value);
}

function fleetFingerprint(businessName, city) {
  const business = normalizeBusiness(businessName);
  const place = normalizeCity(city);
  if (!business || !place) return "";
  // Length framing makes component boundaries unambiguous even if a future
  // normalizer permits delimiter characters.
  return `${FINGERPRINT_VERSION}:${business.length}:${business}:${place.length}:${place}`;
}

function deterministicUuid(seed) {
  const hex = createHash("sha256").update(String(seed), "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

/** Normalized, capped publication identity. */
function row(input = {}) {
  const businessName = bounded(input.business_name, 240);
  const city = bounded(input.city, 160);
  const derivedFingerprint = fleetFingerprint(businessName, city);
  return {
    slug: bounded(input.slug, 120),
    h1: bounded(input.h1, 300),
    title: bounded(input.title, 300),
    prospect_id: bounded(input.prospect_id, 160),
    business_name: businessName,
    city,
    fingerprint: derivedFingerprint,
    fingerprint_version: derivedFingerprint ? FINGERPRINT_VERSION : "",
  };
}

function eventOrder(a, b) {
  const at = String(a?.created_at || "");
  const bt = String(b?.created_at || "");
  if (at !== bt) return bt.localeCompare(at);
  return String(b?.id || "").localeCompare(String(a?.id || ""));
}

function isBackfillEvent(event) {
  const payload = event?.payload;
  return Boolean(payload && payload.backfill_version === BACKFILL_VERSION && payload.supersedes_event_id);
}

/**
 * Resolve ordinary heads before applying a backfill successor. This makes a
 * stale successor harmless: if a newer ordinary identity or tombstone exists,
 * it is the ordinary head and a backfill targeting the older event is ignored.
 */
function resolveFleetHeads(events) {
  const ordered = [...(Array.isArray(events) ? events : [])].sort(eventOrder);
  const ordinaryBySlug = new Map();
  const backfillBySource = new Map();
  const ordinaryIds = new Set();
  for (const event of ordered) {
    const payload = event?.payload;
    if (!payload?.slug) continue;
    if (isBackfillEvent(event)) {
      const sourceId = String(payload.supersedes_event_id);
      if (!backfillBySource.has(sourceId)) backfillBySource.set(sourceId, event);
      continue;
    }
    if (event?.id) ordinaryIds.add(String(event.id));
    if (!ordinaryBySlug.has(payload.slug)) ordinaryBySlug.set(payload.slug, event);
  }
  const heads = [];
  for (const ordinary of ordinaryBySlug.values()) {
    const payload = ordinary.payload || {};
    if (payload.retired === true) {
      heads.push(ordinary);
      continue;
    }
    const successor = ordinary.id ? backfillBySource.get(String(ordinary.id)) : null;
    heads.push(successor || ordinary);
  }
  // The bounded event query can contain a new successor after its older source
  // has rolled out of the window. Keep that successor only when there is no
  // ordinary row for the slug. Without the source event we cannot prove the
  // successor belongs above an ordinary identity or tombstone, regardless of
  // its later created_at: a slow legacy backfill can be written after the slug
  // was rebuilt or retired and must never resurrect the older identity.
  for (const successor of backfillBySource.values()) {
    if (ordinaryIds.has(String(successor.payload.supersedes_event_id))) continue;
    const ordinary = ordinaryBySlug.get(successor.payload.slug);
    if (ordinary) continue;
    const index = heads.findIndex((head) => head?.payload?.slug === successor.payload.slug);
    if (index < 0) heads.push(successor);
  }
  return heads.sort(eventOrder);
}

function validSlug(value) {
  return /^[a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?$/.test(String(value || ""));
}

async function prospectsBySlug(slugs) {
  const unique = [...new Set(slugs.filter(validSlug))];
  const out = new Map();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await select(
      "ghost_agency_prospects",
      `select=prospect_id,business_name,city,site_slug&site_slug=in.(${chunk.join(",")})&limit=500`,
    );
    if (!res?.ok) return { ok: false, bySlug: new Map(), reason: String(res?.skipped || res?.mode || "unavailable") };
    for (const prospect of Array.isArray(res.data) ? res.data : []) {
      const slug = String(prospect?.site_slug || "");
      if (!out.has(slug)) out.set(slug, []);
      out.get(slug).push(prospect);
    }
  }
  return { ok: true, bySlug: out, reason: "" };
}

function insertSucceeded(result) {
  return result?.ok === true || result?.mode === "live_write";
}

function uniqueConflict(result) {
  const code = String(result?.error?.code || result?.error?.error?.code || "").toUpperCase();
  return result?.status === 409 || code === "23505";
}

async function backfillLegacyHeads(heads, { write = true } = {}) {
  const candidates = heads.filter((event) => {
    const payload = event?.payload || {};
    const identity = row(payload);
    return event?.id && payload.retired !== true && (!identity.prospect_id || !identity.fingerprint);
  });
  const report = { attempted: candidates.length, written: 0, reused: 0, previewed: 0, unresolved: 0, ambiguous: 0 };
  if (!candidates.length) return { heads, report };
  const lookup = await prospectsBySlug(candidates.map((event) => event.payload.slug));
  if (!lookup.ok) return { heads, report: { ...report, unresolved: candidates.length, reason: lookup.reason } };

  const replacements = new Map();
  for (const source of candidates) {
    const matches = lookup.bySlug.get(String(source.payload.slug)) || [];
    if (matches.length !== 1) {
      if (matches.length > 1) report.ambiguous += 1;
      else report.unresolved += 1;
      continue;
    }
    const prospect = matches[0];
    const identity = row({
      ...source.payload,
      prospect_id: prospect.prospect_id,
      business_name: prospect.business_name,
      city: prospect.city,
    });
    if (!identity.prospect_id || !identity.fingerprint) {
      report.unresolved += 1;
      continue;
    }
    const backfillKey = `${BACKFILL_VERSION}:${source.id}`;
    const payload = {
      ...source.payload,
      ...identity,
      supersedes_event_id: String(source.id),
      backfill_version: BACKFILL_VERSION,
      backfill_key: backfillKey,
    };
    const id = deterministicUuid(`mirror.identity.backfill:${backfillKey}`);
    if (!write) {
      report.previewed += 1;
      replacements.set(String(source.id), { id, type: EVENT_TYPE, payload, created_at: new Date().toISOString() });
      continue;
    }
    let inserted;
    try {
      inserted = await insertRow("ghost_agency_events", {
        id,
        type: EVENT_TYPE,
        payload,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      inserted = { error: { code: "network_error", message: boundedDetailText(error?.message || error) } };
    }
    if (insertSucceeded(inserted)) report.written += 1;
    else if (uniqueConflict(inserted)) report.reused += 1;
    else {
      report.unresolved += 1;
      continue;
    }
    // On conflict the durable winner may have been computed from newer
    // prospect data than this worker saw. Never substitute our losing payload;
    // readFleetIdentities re-reads the stored event log before using it.
    if (insertSucceeded(inserted)) {
      replacements.set(String(source.id), { id, type: EVENT_TYPE, payload, created_at: new Date().toISOString() });
    }
  }

  return {
    heads: heads.map((head) => replacements.get(String(head?.id || "")) || head),
    report,
  };
}

/**
 * Read effective published identities, enrich legacy heads, then exclude the
 * current prospect by exact slug OR prospect_id OR canonical fingerprint.
 */
async function readFleetIdentities({
  exceptSlug = "",
  exceptProspectId = "",
  businessName = "",
  city = "",
  writeBackfill = true,
  limit = DEFAULT_LIMIT,
} = {}) {
  let res;
  try {
    res = await select(
      "ghost_agency_events",
      `type=eq.${EVENT_TYPE}&select=id,payload,created_at&order=created_at.desc,id.desc&limit=${Math.max(1, Math.min(2000, limit))}`,
    );
  } catch (error) {
    return { ok: false, identities: [], reason: boundedDetailText(error && error.message ? error.message : error, 160) };
  }
  if (!res?.ok) {
    return { ok: false, identities: [], reason: String(res?.skipped || res?.mode || "unavailable") };
  }

  let heads = resolveFleetHeads(res.data);
  const backfill = await backfillLegacyHeads(heads, { write: writeBackfill !== false });
  heads = backfill.heads;
  // A tombstone or newer identity can land while a legacy successor is being
  // inserted. Re-read after any backfill attempt and resolve the latest
  // ordinary head again so that successor can never revive an older row in
  // this same invocation. If the defensive read fails, keep the pre-backfill
  // heads rather than trusting a potentially stale successor.
  if (writeBackfill !== false && backfill.report.attempted > 0) {
    let refreshed;
    try {
      refreshed = await select(
        "ghost_agency_events",
        `type=eq.${EVENT_TYPE}&select=id,payload,created_at&order=created_at.desc,id.desc&limit=${Math.max(1, Math.min(2000, limit))}`,
      );
    } catch { /* fail soft below */ }
    heads = refreshed?.ok ? resolveFleetHeads(refreshed.data) : resolveFleetHeads(res.data);
  }

  const slugKey = bounded(exceptSlug, 120);
  const prospectKey = bounded(exceptProspectId, 160);
  const currentFingerprint = fleetFingerprint(businessName, city);
  const identities = [];
  for (const event of heads) {
    const payload = event?.payload || {};
    if (payload.retired === true) continue;
    const identity = row(payload);
    if (slugKey && identity.slug === slugKey) continue;
    if (prospectKey && identity.prospect_id && identity.prospect_id === prospectKey) continue;
    if (currentFingerprint && identity.fingerprint && identity.fingerprint === currentFingerprint) continue;
    identities.push(identity);
  }
  return { ok: true, identities, reason: "", backfill: backfill.report };
}

async function recordFleetRetirement({ slug, reason = "" }) {
  if (!slug) return { ok: false, reason: "no_slug" };
  try {
    await recordEvent(EVENT_TYPE, {
      slug: bounded(slug, 120),
      retired: true,
      ...(reason ? { reason: bounded(reason, 200) } : {}),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: boundedDetailText(error && error.message ? error.message : error, 160) };
  }
}

async function recordFleetIdentity({
  slug,
  h1,
  title,
  prospect_id = "",
  business_name = "",
  city = "",
  donor = "",
  build_hash = "",
  attempt = 1,
  retryOf = "",
  retryReason = "",
}) {
  if (!slug) return { ok: false, reason: "no_slug" };
  try {
    const result = await recordEvent(EVENT_TYPE, {
      ...row({ slug, h1, title, prospect_id, business_name, city }),
      donor,
      build_hash,
      attempt: Number(attempt) === 2 ? 2 : 1,
      ...(retryOf ? { retryOf: bounded(retryOf, 240) } : {}),
      ...(retryReason ? { retryReason: bounded(retryReason, 80) } : {}),
    });
    // store.recordEvent resolves on both successful and failed writes. Only its
    // explicit live-write receipt proves this fleet identity is durable; a
    // resolved dry-run/failure object must not let a deployed site proceed.
    // A primary-key conflict means this exact fleet identity is already
    // durably recorded — the same idempotency the practice-claim inserter
    // relies on. Retrying a settled write must confirm it, not hold the build.
    const conflict = result?.status === 409
      || result?.error?.code === "23505"
      || result?.error?.category === "write_conflict";
    if (conflict) {
      return { ok: true, mode: "live_write", already_recorded: true };
    }
    if (result?.mode !== "live_write") {
      return {
        ok: false,
        reason: boundedDetailText(
          result?.error?.code || result?.reason || result?.mode || "fleet_identity_write_unconfirmed",
          160,
        ),
      };
    }
    return { ok: true, mode: "live_write" };
  } catch (error) {
    return { ok: false, reason: boundedDetailText(error && error.message ? error.message : error, 160) };
  }
}

/** Atomic, append-only ownership of one attempt-2 retry per logical build. */
async function claimSamenessRetry({ retryOf, slug = "", prospect_id = "" } = {}) {
  const rawLogicalId = String(retryOf == null ? "" : retryOf).trim();
  if (!rawLogicalId) return { ok: false, claimed: false, reason: "retry_root_missing" };
  const logicalId = bounded(rawLogicalId, 240);
  const id = deterministicUuid(`mirror.sameness.retry:${rawLogicalId}:2`);
  const operationKey = bounded(`${logicalId}:attempt:2:${id.slice(0, 8)}`, 300);
  let result;
  try {
    result = await insertRow("ghost_agency_events", {
      id,
      type: RETRY_EVENT_TYPE,
      payload: {
        slug: bounded(slug, 120),
        prospect_id: bounded(prospect_id, 160),
        attempt: 2,
        retry_count: 1,
        retryOf: logicalId,
        retryReason: "sameness_collision",
        operationKey,
      },
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    return { ok: false, claimed: false, reason: boundedDetailText(error?.message || error, 160) };
  }
  const authorization = {
    ok: true,
    claimed: true,
    id,
    operationKey,
    attempt: 2,
    retryOf: logicalId,
    retryReason: "sameness_collision",
  };
  if (insertSucceeded(result)) return authorization;
  if (uniqueConflict(result)) {
    // The row owns one LOGICAL differentiated attempt, not one mortal worker.
    // A worker can die after inserting it but before (or during) the provider
    // call. Replaying the exact deterministic operation key is the safe resume:
    // every worker produces the same attempt-2 bytes/release, while the unique
    // event remains the one immutable attempt/retryOf/reason fact.
    let existing;
    try {
      const read = await select(
        "ghost_agency_events",
        `id=eq.${id}&type=eq.${RETRY_EVENT_TYPE}&select=id,type,payload&limit=1`,
      );
      existing = read?.ok
        ? (Array.isArray(read.data) ? read.data : []).find((event) => String(event?.id || "") === id)
        : null;
    } catch { existing = null; }
    const payload = existing?.payload || {};
    const sameImmutableClaim = existing?.type === RETRY_EVENT_TYPE
      && Number(payload.attempt) === 2
      && Number(payload.retry_count) === 1
      && String(payload.retryOf || "") === logicalId
      && payload.retryReason === "sameness_collision"
      && String(payload.operationKey || "") === operationKey
      && String(payload.slug || "") === bounded(slug, 120)
      && String(payload.prospect_id || "") === bounded(prospect_id, 160);
    if (!sameImmutableClaim) {
      return { ok: false, claimed: false, reason: "retry_claim_identity_unavailable" };
    }
    return { ...authorization, resumed: true };
  }
  return { ok: false, claimed: false, reason: String(result?.error?.code || result?.mode || "retry_claim_failed") };
}

module.exports = {
  readFleetIdentities,
  recordFleetIdentity,
  recordFleetRetirement,
  claimSamenessRetry,
  fleetFingerprint,
  normalizeBusiness,
  normalizeCity,
  resolveFleetHeads,
  deterministicUuid,
  EVENT_TYPE,
  RETRY_EVENT_TYPE,
  FINGERPRINT_VERSION,
  BACKFILL_VERSION,
};
