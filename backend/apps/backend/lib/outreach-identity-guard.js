"use strict";

const DAY_MS = 86_400_000;
const DEFAULT_COOLDOWN_DAYS = 30;
const MAX_COOLDOWN_DAYS = 365;
const DEFAULT_CLAIM_SECONDS = 300;

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeDomain(value = "") {
  let raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    raw = parsed.hostname;
  } catch {
    raw = raw.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  }
  return raw.replace(/^www\./, "").replace(/\.$/, "");
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLocality(prospect = {}) {
  const city = normalizeText(prospect.city || prospect.marketing_city || prospect.locality || prospect.address_city || "");
  const state = normalizeText(prospect.state || prospect.region || prospect.address_state || "");
  return [city, state].filter(Boolean).join("|");
}

function stableIdentity(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const placeId = String(prospect.place_id || prospect.google_place_id || record.place_id || record.google_place_id || "").trim();
  if (placeId) return { type: "place_id", key: `place:${placeId}` };
  const domain = normalizeDomain(prospect.current_website || prospect.website || prospect.domain || record.current_website || record.website || record.domain || "");
  if (domain) return { type: "domain", key: `domain:${domain}` };
  const business = normalizeText(prospect.business_name || prospect.businessName || prospect.name || prospect.company || record.business_name || record.name || "");
  const locality = normalizeLocality({ ...record, ...prospect });
  if (business && locality) return { type: "business_locality", key: `business:${business}|${locality}` };
  const email = normalizeEmail(prospect.email || prospect.ownerEmail || prospect.owner_email || record.email || "");
  if (email) return { type: "email", key: `email:${email}` };
  return { type: "none", key: "" };
}

function cooldownDays(env = process.env) {
  const raw = String(env?.OUTREACH_COOLDOWN_DAYS ?? "").trim();
  if (!raw) return DEFAULT_COOLDOWN_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_COOLDOWN_DAYS;
  return Math.max(1, Math.min(MAX_COOLDOWN_DAYS, Math.floor(n)));
}

function rowTimestamp(row = {}) {
  for (const candidate of [row.sent_at, row.contacted_at, row.last_contacted_at, row.created_at, row.updated_at]) {
    const ms = new Date(candidate || 0).getTime();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return 0;
}

function suppressionReason(rows = []) {
  for (const row of rows || []) {
    if (row?.suppressed === true) return String(row.suppression_reason || "suppressed");
    const status = normalizeText(row?.status || row?.state || row?.event || "");
    if (/unsubscribe|opt out|optout|stop|suppressed/.test(status)) return "suppressed";
    if (/hard bounce|invalid address|invalid email/.test(status)) return "invalid_contact";
    if (/converted|customer|paid/.test(status)) return "customer";
    if (/replied|reply received/.test(status)) return "replied";
  }
  return "";
}

function cooldownStatus(rows = [], { now = Date.now(), env = process.env } = {}) {
  const suppression = suppressionReason(rows);
  if (suppression) return { eligible: false, reason: suppression, days: cooldownDays(env), lastContactAt: null, nextEligibleAt: null };
  const sent = (rows || []).filter((row) => row && row.suppressed !== true && (row.sent_at || row.last_contacted_at || /sent|delivered/i.test(String(row.status || row.state || "")))).map(rowTimestamp).filter(Boolean).sort((a, b) => b - a);
  if (!sent.length) return { eligible: true, reason: "never_contacted", days: cooldownDays(env), lastContactAt: null, nextEligibleAt: null };
  const days = cooldownDays(env);
  const last = sent[0];
  const next = last + days * DAY_MS;
  const current = Number(now);
  return { eligible: current >= next, reason: current >= next ? "cooldown_elapsed" : "cooldown_active", days, lastContactAt: new Date(last).toISOString(), nextEligibleAt: new Date(next).toISOString() };
}

function dedupeProspects(rows = []) {
  const seen = new Map();
  const accepted = [];
  const duplicates = [];
  for (const row of rows || []) {
    const identity = stableIdentity(row);
    if (!identity.key) { accepted.push(row); continue; }
    if (seen.has(identity.key)) { duplicates.push({ row, duplicateOf: seen.get(identity.key), identity }); continue; }
    seen.set(identity.key, row);
    accepted.push(row);
  }
  return { accepted, duplicates };
}

function createSendClaimRegistry({ leaseMs = 5 * 60_000, now = () => Date.now() } = {}) {
  const claims = new Map();
  function cleanup() { const current = now(); for (const [key, claim] of claims) if (claim.expiresAt <= current) claims.delete(key); }
  function claim(identityKey, token) {
    cleanup();
    if (!identityKey || !token) return { ok: false, reason: "invalid_claim" };
    const existing = claims.get(identityKey);
    if (existing) return { ok: false, reason: "already_claimed", token: existing.token, expiresAt: existing.expiresAt };
    const expiresAt = now() + leaseMs;
    claims.set(identityKey, { token, expiresAt });
    return { ok: true, token, expiresAt };
  }
  function release(identityKey, token) { const existing = claims.get(identityKey); if (!existing || existing.token !== token) return false; claims.delete(identityKey); return true; }
  return Object.freeze({ claim, release, cleanup, size: () => (cleanup(), claims.size) });
}

const processSendClaims = createSendClaimRegistry();
function claimProspectSend(prospect, token) { const identity = stableIdentity(prospect); if (!identity.key) return { ok: false, reason: "identity_unavailable", identity }; return { ...processSendClaims.claim(identity.key, token), identity }; }
function releaseProspectSend(prospect, token) { const identity = stableIdentity(prospect); return identity.key ? processSendClaims.release(identity.key, token) : false; }
function durableConfigured(env = process.env) { return Boolean(String(env?.SUPABASE_URL || "").trim() && String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim()); }
function restBase(env = process.env) { return String(env?.SUPABASE_URL || "").trim().replace(/\/+$/, ""); }
function serviceHeaders(env = process.env) { const key = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim(); return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }; }

async function durableIdentityRow(prospect, { env = process.env, fetchImpl = global.fetch } = {}) {
  const identity = stableIdentity(prospect);
  if (!identity.key) return { ok: false, reason: "identity_unavailable", identity };
  if (!durableConfigured(env) || typeof fetchImpl !== "function") return { ok: false, reason: "durable_store_unavailable", identity };
  const url = `${restBase(env)}/rest/v1/ghost_agency_outreach_identity?identity_key=eq.${encodeURIComponent(identity.key)}&select=*&limit=1`;
  try { const response = await fetchImpl(url, { headers: serviceHeaders(env) }); if (!response.ok) return { ok: false, reason: `durable_store_http_${response.status}`, identity }; const rows = await response.json(); return { ok: true, identity, row: Array.isArray(rows) ? rows[0] || null : null }; }
  catch { return { ok: false, reason: "durable_store_network_error", identity }; }
}

async function durableEligibility(prospect, { env = process.env, fetchImpl = global.fetch, now = Date.now() } = {}) {
  const lookup = await durableIdentityRow(prospect, { env, fetchImpl });
  if (!lookup.ok) return { eligible: false, failClosed: true, reason: lookup.reason, identity: lookup.identity };
  if (!lookup.row) return { eligible: true, failClosed: false, reason: "never_contacted", identity: lookup.identity, row: null };
  const status = cooldownStatus([lookup.row], { now, env });
  return { ...status, failClosed: false, identity: lookup.identity, row: lookup.row };
}

async function durableClaimProspectSend(prospect, token, { env = process.env, fetchImpl = global.fetch, leaseSeconds = DEFAULT_CLAIM_SECONDS } = {}) {
  const identity = stableIdentity(prospect);
  if (!identity.key || !token) return { ok: false, reason: "invalid_claim", identity };
  if (!durableConfigured(env) || typeof fetchImpl !== "function") return { ok: false, reason: "durable_store_unavailable", identity };
  const body = { p_identity_key: identity.key, p_identity_type: identity.type, p_prospect_id: String(prospect.prospect_id || prospect.id || "").trim() || null, p_claim_token: String(token), p_lease_seconds: Math.max(30, Math.min(1800, Math.floor(Number(leaseSeconds) || DEFAULT_CLAIM_SECONDS))), p_cooldown_days: cooldownDays(env) };
  try { const response = await fetchImpl(`${restBase(env)}/rest/v1/rpc/claim_ghost_outreach_identity`, { method: "POST", headers: serviceHeaders(env), body: JSON.stringify(body) }); if (!response.ok) return { ok: false, reason: `claim_http_${response.status}`, identity }; const raw = await response.json(); const row = Array.isArray(raw) ? raw[0] : raw; return { ok: row?.ok === true, reason: row?.reason || (row?.ok ? "claimed" : "claim_rejected"), identity, row }; }
  catch { return { ok: false, reason: "claim_network_error", identity }; }
}

async function finishDurableProspectSend(prospect, token, { sendId = "", creativeFingerprint = "", env = process.env, fetchImpl = global.fetch } = {}) {
  const identity = stableIdentity(prospect);
  if (!identity.key || !token || !durableConfigured(env) || typeof fetchImpl !== "function") return false;
  try { const response = await fetchImpl(`${restBase(env)}/rest/v1/rpc/finish_ghost_outreach_identity_send`, { method: "POST", headers: serviceHeaders(env), body: JSON.stringify({ p_identity_key: identity.key, p_claim_token: String(token), p_send_id: String(sendId || ""), p_creative_fingerprint: String(creativeFingerprint || "") || null }) }); if (!response.ok) return false; const value = await response.json(); return value === true || (Array.isArray(value) && value[0] === true); }
  catch { return false; }
}

async function releaseDurableProspectSend(prospect, token, { env = process.env, fetchImpl = global.fetch } = {}) {
  const identity = stableIdentity(prospect);
  if (!identity.key || !token || !durableConfigured(env) || typeof fetchImpl !== "function") return false;
  try { const response = await fetchImpl(`${restBase(env)}/rest/v1/rpc/release_ghost_outreach_identity_claim`, { method: "POST", headers: serviceHeaders(env), body: JSON.stringify({ p_identity_key: identity.key, p_claim_token: String(token) }) }); if (!response.ok) return false; const value = await response.json(); return value === true || (Array.isArray(value) && value[0] === true); }
  catch { return false; }
}

module.exports = { DAY_MS, DEFAULT_CLAIM_SECONDS, DEFAULT_COOLDOWN_DAYS, MAX_COOLDOWN_DAYS, claimProspectSend, cooldownDays, cooldownStatus, createSendClaimRegistry, dedupeProspects, durableClaimProspectSend, durableConfigured, durableEligibility, durableIdentityRow, finishDurableProspectSend, normalizeDomain, normalizeEmail, normalizeLocality, normalizeText, releaseDurableProspectSend, releaseProspectSend, stableIdentity, suppressionReason };
