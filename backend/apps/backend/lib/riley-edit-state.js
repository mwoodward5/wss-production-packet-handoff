"use strict";

// lib/riley-edit-state.js — WHAT THE SERVER REMEMBERS SO THE MODEL NEVER HAS TO
// CARRY IT: the pending, unconfirmed edit instruction, and the fact that a
// caller has already been verified once.
//
// WHY THIS IS STATE AND NOT A PROMPT LINE
// ---------------------------------------
// Two production failures, seventeen calls studied:
//
//   1. THE TOKEN ECHO. The old contract made the voice model carry the
//      instruction back up on the confirming call, sealed with a credential
//      derived from the very words it was echoing. Any drift — one reworded
//      clause, one dropped word — and the edit died as `bad_signature` or
//      `confirm_code_invalid` with an authorised, correct change standing
//      still. Asking a language model to echo prose verbatim across turns is
//      the defect; no prompt fixes it. So the instruction is now STORED
//      server-side when the change is first read back, and the confirming
//      call carries only the short code — the instruction arrives from
//      storage, never from the model's memory.
//
//   2. THE RE-CHECK RITUAL. Every edit ran the full six-character ceremony,
//      including the fourth change from a caller who was verified three days
//      ago. Callers called it "overly redundant" and asked Riley to stop the
//      secondary confirmations. The owner's law, verbatim in intent:
//      "Verify once, then trust." So `verified_at` is persisted per client,
//      and within the trust window the ceremony is replaced by Riley saying
//      the change back in his OWN words and taking a real yes.
//
// TWO TIERS, the same shape as lib/riley-call-memory.js, for the same reason:
//   1. an in-process Map — free, and hits on the warm lambda that serves a
//      phone call's tool calls back to back.
//   2. ghost_agency_events — durable, and read only when the Map misses. A
//      cold lambda between the read-back and the confirmation is exactly the
//      case that used to cost a caller the whole change.
//
// SAFETY. Nothing here widens who may edit what. The pending record is keyed
// by the SERVER-RESOLVED site slug — the wrong-site guard (ambiguous caller →
// candidate list, identity/slug mismatch → refusal) runs on every call before
// any of this state is consulted, and stays untouched. A pending record can
// only finalize onto the site it was minted for. Trust only ever REMOVES the
// code ceremony; it never removes the identity resolution, and a trust lookup
// that fails for any reason answers "not trusted", which is the stricter of
// the two flows.

const { select, recordEvent } = require("./store");

const PENDING_EVENT = "ghost_agency_riley_pending_edit";
const PENDING_DONE_EVENT = "ghost_agency_riley_pending_edit_done";
const TRUST_EVENT = "ghost_agency_riley_edit_verified";

/** A pending instruction lives exactly as long as a confirm code does. */
const PENDING_TTL_MS = 15 * 60 * 1000;

const DEFAULT_TRUST_DAYS = 30;

/** Live-for-the-lambda caches. */
const PENDING = new Map(); // site_slug -> pending record
const TRUST = new Map(); // trustKey (site_slug or client_id) -> { verified_at, via }

function trustWindowMs(env = process.env) {
  const n = Number(String(env.GHOST_AGENCY_RILEY_TRUST_DAYS || "").trim());
  const days = Number.isFinite(n) && n > 0 ? n : DEFAULT_TRUST_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

function trustWindowDays(env = process.env) {
  return Math.round(trustWindowMs(env) / (24 * 60 * 60 * 1000));
}

/** Loose compare, identical in spirit to site-edit.js's looseSame: a request
 *  that reaches us twice with only case or punctuation between them is the
 *  same request. */
const normInstruction = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const sameInstruction = (a, b) => {
  const x = normInstruction(a);
  return Boolean(x) && x === normInstruction(b);
};

const iso = (ms) => new Date(ms).toISOString();

function shapePending(payload = {}) {
  const instruction = String(payload.instruction || "").trim().slice(0, 2000);
  const siteSlug = String(payload.site_slug || "").trim();
  if (!instruction || !siteSlug) return null;
  const issuedAt = Date.parse(payload.issued_at || "") || 0;
  return {
    site_slug: siteSlug,
    client_id: String(payload.client_id || "").trim() || null,
    business_name: String(payload.business_name || "").trim() || null,
    domain: String(payload.domain || "").trim() || null,
    instruction,
    issued_at: issuedAt ? iso(issuedAt) : null,
    expires_at: issuedAt ? iso(issuedAt + PENDING_TTL_MS) : null,
  };
}

function pendingLive(record, now = Date.now()) {
  if (!record) return false;
  if (!record.issued_at) return false; // a record with no clock is unprovable
  return now - Date.parse(record.issued_at) < PENDING_TTL_MS;
}

/**
 * Remember the instruction the server just read back, bound to the site the
 * SERVER resolved. This is the write that takes the instruction out of the
 * model's hands: the confirming call will fetch it from here.
 */
async function stagePendingEdit({ siteSlug, clientId, businessName, domain, instruction, now = Date.now() }) {
  const site_slug = String(siteSlug || "").trim();
  const text = String(instruction || "").trim().slice(0, 2000);
  if (!site_slug || !text) return null;
  const record = shapePending({
    site_slug,
    client_id: clientId || null,
    business_name: businessName || null,
    domain: domain || null,
    instruction: text,
    issued_at: iso(now),
  });
  PENDING.set(site_slug, record);
  // Best-effort durable half, exactly as riley-call-memory does: a failed
  // write must never cost the caller the edit; it only costs a cold lambda a
  // fresh read-back.
  try {
    await recordEvent(PENDING_EVENT, record);
  } catch {
    /* the Map tier still carries this call */
  }
  return record;
}

async function latestDurableEvents(type, match) {
  // match: { field, value } — a payload field to pin with PostgREST's
  // payload->> filter, the same query shape riley-call-memory uses.
  if (!match || !match.value) return [];
  const query = `type=eq.${type}&payload->>${match.field}=eq.${encodeURIComponent(match.value)}&order=created_at.desc&limit=5`;
  const r = await select("ghost_agency_events", query);
  return r && r.ok && Array.isArray(r.data) ? r.data : [];
}

/**
 * The pending instruction for this site — Map first, storage second, and an
 * expired or already-consumed record is no record at all.
 */
async function recallPendingEdit(siteSlug, { now = Date.now() } = {}) {
  const site_slug = String(siteSlug || "").trim();
  if (!site_slug) return null;

  const hot = PENDING.get(site_slug);
  if (hot) return pendingLive(hot, now) ? hot : null;

  try {
    const rows = await latestDurableEvents(PENDING_EVENT, { field: "site_slug", value: site_slug });
    const pendingRow = rows.find((r) => r && r.payload && shapePending(r.payload));
    if (!pendingRow) return null;
    const record = shapePending(pendingRow.payload);
    if (!pendingLive(record, now)) return null;
    // A pending that was already finalized is superseded by its done-marker:
    // without this, a cold lambda after a queued edit would see the old
    // request as still waiting and block the next one.
    const done = await latestDurableEvents(PENDING_DONE_EVENT, { field: "site_slug", value: site_slug });
    const doneAt = done.length ? Date.parse(done[0].created_at || done[0].payload?.cleared_at || "") : 0;
    const issuedAt = Date.parse(record.issued_at || "");
    if (doneAt && doneAt >= issuedAt) return null;
    PENDING.set(site_slug, record);
    return record;
  } catch {
    return null; // no state = phase one again = the stricter path
  }
}

/** The pending instruction was finalized (or replaced): it stops being pending. */
async function clearPendingEdit(siteSlug, { jobId = null, instruction = "" } = {}) {
  const site_slug = String(siteSlug || "").trim();
  if (!site_slug) return false;
  PENDING.delete(site_slug);
  try {
    // Durable tombstone. Events are append-only, so consumption is recorded
    // as a marker that recallPendingEdit compares against the pending's age.
    await recordEvent(PENDING_DONE_EVENT, {
      site_slug,
      cleared_at: iso(Date.now()),
      job_id: jobId,
      instruction: String(instruction || "").slice(0, 200) || null,
    });
  } catch {
    /* Map tier already cleared */
  }
  return true;
}

/* ---------------------------------------------------------------------- */
/* TRUST ONCE                                                             */
/* ---------------------------------------------------------------------- */

function shapeTrust(payload = {}) {
  const verifiedAt = Date.parse(payload.verified_at || "") || 0;
  const siteSlug = String(payload.site_slug || "").trim();
  if (!verifiedAt || !siteSlug) return null;
  return {
    site_slug: siteSlug,
    client_id: String(payload.client_id || "").trim() || null,
    verified_at: iso(verifiedAt),
    via: String(payload.via || "").trim() || null,
  };
}

/**
 * Record that THIS client completed a full verification (the code ceremony)
 * right now — or at `at`, which is how the expiry tests and a backfill reach
 * into the past without sleeping for a month.
 */
async function markVerified({ siteSlug, clientId, via = "confirm_code", at = Date.now() }) {
  const site_slug = String(siteSlug || "").trim();
  if (!site_slug) return false;
  const verified_at = iso(at);
  const record = { site_slug, client_id: String(clientId || "").trim() || null, verified_at, via };
  TRUST.set(site_slug, record);
  if (record.client_id) TRUST.set(record.client_id, record);
  try {
    await recordEvent(TRUST_EVENT, record);
  } catch {
    /* Map tier still carries it */
  }
  return true;
}

async function trustFromRows(rows, { now, windowMs }) {
  for (const row of rows) {
    const record = row && row.payload && shapeTrust(row.payload);
    if (!record) continue;
    const age = now - Date.parse(record.verified_at);
    if (age >= 0 && age < windowMs) return { trusted: true, ...record, window_days: Math.round(windowMs / 86400000) };
    // A hit that is OUTSIDE the window is still the newest fact — stop here
    // and answer untrusted; an older record cannot be fresher (desc order).
    return { trusted: false, verified_at: record.verified_at, window_days: Math.round(windowMs / 86400000) };
  }
  return { trusted: false, window_days: Math.round(windowMs / 86400000) };
}

/**
 * Has THIS caller completed a verification inside the trust window? Looked up
 * by the site slug and, when known, the client id — a caller whose phone or
 * spoken name resolves to the same account is the same verified client.
 * Every failure answers { trusted: false }: trust may only be gained by a
 * recorded verification, never by an outage.
 */
async function recallTrust({ siteSlug, clientId, now = Date.now(), env = process.env } = {}) {
  const windowMs = trustWindowMs(env);
  const site_slug = String(siteSlug || "").trim();
  const client_id = String(clientId || "").trim();
  const none = { trusted: false, window_days: Math.round(windowMs / 86400000) };
  if (!site_slug && !client_id) return none;

  const hot = TRUST.get(site_slug) || (client_id && TRUST.get(client_id)) || null;
  if (hot) {
    const age = now - Date.parse(hot.verified_at);
    if (age >= 0 && age < windowMs) return { trusted: true, ...hot, window_days: Math.round(windowMs / 86400000) };
    return { trusted: false, verified_at: hot.verified_at, window_days: Math.round(windowMs / 86400000) };
  }

  try {
    const attempts = [];
    if (site_slug) attempts.push(latestDurableEvents(TRUST_EVENT, { field: "site_slug", value: site_slug }));
    if (client_id) attempts.push(latestDurableEvents(TRUST_EVENT, { field: "client_id", value: client_id }));
    for (const rows of await Promise.all(attempts)) {
      const answer = await trustFromRows(rows, { now, windowMs });
      if (answer.trusted) return answer;
    }
  } catch {
    /* fall through to untrusted */
  }
  return none;
}

/** Tests need a clean slate between cases. */
function __resetEditState() {
  PENDING.clear();
  TRUST.clear();
}

module.exports = {
  PENDING_EVENT,
  PENDING_DONE_EVENT,
  TRUST_EVENT,
  PENDING_TTL_MS,
  DEFAULT_TRUST_DAYS,
  trustWindowMs,
  trustWindowDays,
  sameInstruction,
  stagePendingEdit,
  recallPendingEdit,
  clearPendingEdit,
  markVerified,
  recallTrust,
  __resetEditState,
};
