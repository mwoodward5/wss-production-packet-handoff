"use strict";
// lib/riley-call-memory.js — what Riley already knows about THIS phone call.
//
// WHY THIS IS STATE AND NOT A PROMPT LINE
// ---------------------------------------
// Call 019fd91d, 145s in: "Sorry. I need to confirm that again before making
// the change." Ten seconds later: "Could you please read me your client ID from
// your email? It starts with W S…" — the caller had already read it out once.
// Call 019fd8d1, the owner's own words back down the line: "you don't have to
// double verify the site URL and whatnot. We already know what the site is."
//
// The prompt already told Riley not to do that. It did it anyway, because a
// language model has no memory of a fact it isn't handed again, and the tool
// contract forced every request to re-carry `client_ref`. An instruction is not
// a guarantee. So identity is resolved ONCE per call and then remembered here,
// and every later tool call in the same call reads it back out of storage
// instead of out of the caller's mouth.
//
// TWO TIERS, DELIBERATELY
//   1. an in-process Map — free, and hits on the warm lambda that serves most
//      of a single phone call's tool calls back to back.
//   2. ghost_agency_events — durable, and read ONLY when the Map misses. A cold
//      lambda mid-call is exactly the case that used to cost the caller a
//      repetition, so it is worth one ~200ms select to avoid one.
// The durable read never lands on the fast path: if the model DID send an
// identity, we resolve normally and never look here at all.
//
// SAFETY: every entry is keyed by the VAPI call id, so a memory can only ever
// be read back inside the same phone call that created it. Nothing here widens
// what a caller may edit — site-edit.js still resolves and describes the target,
// and the confirm-before-apply gate is untouched. This only removes the need to
// ask a man for a code he already read out.

const { select, recordEvent } = require("./store");

const EVENT_TYPE = "ghost_agency_riley_call_identity";

/** Live-for-the-lambda cache: callId -> facts. */
const MEM = new Map();
/** callId values already written durably, so we insert once, not per tool call. */
const PERSISTED = new Set();

/** A call id is only useful to us as an opaque key; keep it short and clean. */
function normalizeCallId(value) {
  const id = String(value || "").trim().slice(0, 80);
  return /^[A-Za-z0-9._:-]+$/.test(id) ? id : "";
}

/**
 * Pull the VAPI call id out of a tool webhook body, whichever shape it arrives
 * in. VAPI nests it under message.call.id; probes and tests send it flat.
 */
function callIdFromBody(body = {}) {
  return normalizeCallId(
    body?.message?.call?.id
      || body?.call?.id
      || body?.message?.callId
      || body?.callId
      || "",
  );
}

/** Only keep fields that are safe to speak or re-resolve from. No secrets. */
function shapeFacts(facts = {}) {
  const s = (v, cap = 200) => {
    const out = String(v == null ? "" : v).trim().slice(0, cap);
    return out || null;
  };
  const out = {
    site_slug: s(facts.site_slug || facts.siteSlug, 120),
    prospect_id: s(facts.prospect_id || facts.prospectId, 120),
    business_name: s(facts.business_name || facts.businessName, 160),
    domain: s(facts.domain, 160),
    client_id: s(facts.client_id || facts.clientId || facts.reference, 40),
    matched_by: s(facts.matched_by || facts.matchedBy, 40),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

/**
 * Remember who this call belongs to. Cheap and idempotent: the durable write
 * happens once per call id, later calls only refresh the in-process copy.
 */
async function rememberCaller(callId, facts) {
  const id = normalizeCallId(callId);
  const shaped = shapeFacts(facts);
  if (!id || !shaped) return false;

  // MERGE ONLY WHAT WE ACTUALLY LEARNED. shapeFacts fills every field it knows
  // about, using null for the ones this particular caller didn't carry — so a
  // plain spread lets a later, narrower update blank an identity established
  // earlier in the same call. That is the very repetition this module exists to
  // prevent, reintroduced from the inside.
  const prior = MEM.get(id) || {};
  const learned = Object.fromEntries(Object.entries(shaped).filter(([, v]) => v != null));
  MEM.set(id, { ...prior, ...learned });

  if (PERSISTED.has(id)) return true;
  PERSISTED.add(id);
  // Best-effort. A failed write costs the caller a repetition in the rare
  // cold-lambda case; it must never cost them the edit itself.
  try {
    await recordEvent(EVENT_TYPE, { call_id: id, ...shaped });
  } catch {
    PERSISTED.delete(id);
    return false;
  }
  return true;
}

/**
 * The free half of recall: what THIS lambda already resolved, no network. Used
 * on the fast path, where a durable read would be a tax paid on every call to
 * save a repetition that only happens on a cold one.
 */
function recallCallerHot(callId) {
  const id = normalizeCallId(callId);
  return (id && MEM.get(id)) || null;
}

/**
 * What do we already know about this call? Map first, storage second, null if
 * this is genuinely the first time we've heard from them.
 */
async function recallCaller(callId) {
  const id = normalizeCallId(callId);
  if (!id) return null;
  const hot = MEM.get(id);
  if (hot) return hot;

  try {
    const r = await select(
      "ghost_agency_events",
      `type=eq.${EVENT_TYPE}&payload->>call_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=1`,
    );
    const row = r && r.ok && Array.isArray(r.data) ? r.data[0] : null;
    const shaped = row && row.payload ? shapeFacts(row.payload) : null;
    if (shaped) {
      MEM.set(id, shaped);
      PERSISTED.add(id);
      return shaped;
    }
  } catch {
    /* fall through — an unremembered caller is simply asked, as before */
  }
  return null;
}

/** Tests need a clean slate between cases. */
function __resetCallMemory() {
  MEM.clear();
  PERSISTED.clear();
}

module.exports = {
  EVENT_TYPE,
  callIdFromBody,
  rememberCaller,
  recallCaller,
  recallCallerHot,
  __resetCallMemory,
};
