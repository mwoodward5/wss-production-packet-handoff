"use strict";

// PAYDIRT PROSPECT SOURCE — pre-paired leads into the bank (owner doctrine
// 2026-09-02). PayDirt (https://paydirt-seven.vercel.app, Woodward Software
// LLC) digs government open-data feeds (building permits + new-business
// filings) and returns call-briefing rows whose public-record phone is the
// whole point: business + phone (+ enriched email when a licensed provider
// matched) arrive TOGETHER, instead of the miner's search-scrape-then-hope
// contact discovery.
//
// This module is the READ + MAP half of the source adapter convention: it
// never talks to the store, never compiles, never banks. The pick lane
// (lib/line-adapters.js pickProspects, target "paydirt") owns persistence,
// the Intake Genie compile seam, and the surplus bank deposit, exactly like
// every other source. The store-side registration is
// record.truth_packet_source = "paydirt_prepaired" — the same JSONB shelf
// dimension the LeadMiner packet shelf reads — plus record.source = "paydirt"
// and a record.paydirt provenance block.
//
// MODES (env PAYDIRT_SOURCE=api|export):
//   export (v1) — PAYDIRT_EXPORT_FILE points at a PayDirt export the owner
//     downloaded (JSON in the saved-lead / search-row shape, or the CSV the
//     workspace's "Export as CSV" writes, compliance header lines included).
//     Zero network, zero auth: the file is the contract.
//   api — calls the owner's deployed PayDirt GET /api/search. AUTH FINDING
//     (verified against the PayDirt repo, 2026-09-02): PayDirt auth is a
//     Supabase user session (Bearer) with member codes unlocking the UI, not
//     a server-to-server API key; search runs anonymously only while
//     PAYDIRT_ENFORCE_AUTH is off (a small per-IP hourly window) and /api/leads
//     always requires a session. Enrichment is proof-gated (HMAC, 20-min TTL)
//     and is NOT reusable cross-product. So API mode carries an OPTIONAL
//     owner-provisioned Bearer (PAYDIRT_API_TOKEN); a 401/403 answers the loud
//     not_configured status instead of pretending to be a data miss.
//
// HONEST LIMITS (never let PayDirt break a campaign):
//   · readPaydirtLeads NEVER THROWS — every failure is { ok:false, status,
//     reason } and the pick lane falls through to the existing sources with
//     the reason on the funnel.
//   · PAYDIRT_WSS_QUOTA (default 25, clamp 1..100) caps how many leads one
//     read may admit, so a fat export file cannot flood a campaign or the
//     bank in one pass.
//   · PAYDIRT_WSS_TIMEOUT_MS (default 8000, clamp 1000..30000) bounds the
//     API call with an AbortController — the miner's own source fetches use
//     the same law.

const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");

const { approvedIndustry } = require("../copilot");
const { canonicalIdentity } = require("../prospect-identity");

const DEFAULT_API_BASE = "https://paydirt-seven.vercel.app";
const DEFAULT_WSS_QUOTA = 25;
const MAX_WSS_QUOTA = 100;
const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30000;

// PayDirt's own enrichment eligibility threshold (api/enrich.js
// MIN_ELIGIBILITY_SCORE = 48 — the "Worth a call" band floor). Carried as
// PROVENANCE on the row, never as a gate here: the WSS identity/vertical/
// compile gates do their own qualification.
const PAYDIRT_ELIGIBILITY_SCORE = 48;

const PROSPECT_ID_PREFIX = "paydirt_";
const PROSPECT_ID_HASH_LENGTH = 24;

function text(value, maxLength = 400) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function paydirtWssQuota(environment = process.env) {
  return boundedInt(environment?.PAYDIRT_WSS_QUOTA, DEFAULT_WSS_QUOTA, 1, MAX_WSS_QUOTA);
}

function paydirtTimeoutMs(environment = process.env) {
  return boundedInt(environment?.PAYDIRT_WSS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

function paydirtApiBase(environment = process.env) {
  return text(environment?.PAYDIRT_API_BASE || DEFAULT_API_BASE, 300) || DEFAULT_API_BASE;
}

/** Mode law: explicit PAYDIRT_SOURCE wins; an export file implies export;
 * everything else is a loud not_configured (never a silent default to API —
 * the deployed search endpoint is not a committed programmatic contract). */
function resolvePaydirtMode(environment = process.env) {
  const explicit = text(environment?.PAYDIRT_SOURCE, 20).toLowerCase();
  if (explicit === "api") return { mode: "api", explicit: true };
  if (explicit === "export") return { mode: "export", explicit: true };
  if (text(environment?.PAYDIRT_EXPORT_FILE, 1000)) return { mode: "export", explicit: false };
  return { mode: "none", explicit: false };
}

// --- PayDirt lead shape normalization -------------------------------------
//
// Accepted inputs (first non-empty wins inside each field):
//   · /api/search rows: { name, role, phone, email, addr, city, state,
//     postalCode, desc, date, val, src, provider, officialSource, sourceUrl,
//     score, fit, matchStatus, mode, trade, leadId, sourceFingerprint,
//     sourceRecordId, sourceProvider, retrievedAt, companyName? }
//   · saved-lead JSON (api/leads.js body shape): sourceKey, sourceRecordId,
//     sourceUrl, name/companyName, role, phone, email, addr/addressLine1,
//     city, state, postalCode, description/desc, score, fit, rawRecord
//   · workspace CSV columns: rank, source_type, band, score, name, role,
//     phone, email, address, signal, filed, source, provider, source_url,
//     why_scored

function filingBusinessName(description) {
  const match = text(description, 1000).match(/(?:new business|business name|dba)\s*:\s*([^|;\n]{2,160})/i);
  if (!match) return "";
  return text(match[1].replace(/\s*\([^)]*\)\s*$/, ""), 160);
}

function locationFromAddress(address) {
  const value = text(address, 300);
  const withZip = value.match(/,\s*([^,]+?),?\s+([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\s*$/);
  if (withZip) return { city: text(withZip[1], 80), state: withZip[2].toUpperCase() };
  const bare = value.match(/,\s*([^,]+?),?\s+([A-Za-z]{2})\s*$/);
  if (bare) return { city: text(bare[1], 80), state: bare[2].toUpperCase() };
  return { city: "", state: "" };
}

function leadText(lead = {}, keys, maxLength = 400) {
  for (const key of keys) {
    const value = text(lead[key], maxLength);
    if (value) return value;
  }
  return "";
}

function normalizedLead(lead = {}) {
  const address = leadText(lead, ["addr", "address", "addressLine1", "address_line1"], 320);
  const stated = {
    city: leadText(lead, ["city", "locality"], 80),
    state: leadText(lead, ["state", "region"], 2).toUpperCase(),
  };
  const derived = locationFromAddress(address);
  const city = stated.city || derived.city;
  const state = stated.state || derived.state;
  const rawScore = Number(lead.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : null;
  return {
    name: leadText(lead, ["companyName", "company_name", "businessName", "business_name", "name"], 180),
    role: leadText(lead, ["role"], 100).toLowerCase(),
    phone: leadText(lead, ["phone"], 40),
    email: leadText(lead, ["email", "owner_email"], 320).toLowerCase(),
    website: /^https?:\/\//i.test(text(lead.website || lead.site || lead.url, 500))
      ? text(lead.website || lead.site || lead.url, 500)
      : "",
    address,
    city,
    state,
    postalCode: leadText(lead, ["postalCode", "postal_code", "zip", "zipCode"], 10),
    description: leadText(lead, ["desc", "description", "signal"], 4000),
    date: leadText(lead, ["date", "filed", "lastSeenAt", "last_seen_at"], 40),
    sourceLabel: leadText(lead, ["src", "source"], 400),
    provider: leadText(lead, ["sourceProvider", "source_provider", "provider", "sourceKey", "source_key"], 160).toLowerCase(),
    sourceUrl: leadText(lead, ["sourceUrl", "source_url", "officialSource", "official_source"], 2000),
    trade: leadText(lead, ["trade", "industry", "vertical"], 100).toLowerCase(),
    mode: leadText(lead, ["mode", "source_type", "sourceType", "source_type"], 24).toLowerCase(),
    band: leadText(lead, ["band"], 20),
    fit: leadText(lead, ["fit"], 20),
    matchStatus: leadText(lead, ["matchStatus", "match_status"], 20),
    sourceFingerprint: leadText(lead, ["sourceFingerprint", "source_fingerprint"], 80).toLowerCase(),
    sourceRecordId: leadText(lead, ["sourceRecordId", "source_record_id", "leadId", "lead_id", "id"], 240),
    retrievedAt: leadText(lead, ["retrievedAt", "retrieved_at", "lastSeenAt", "last_seen_at"], 60),
    score,
  };
}

function prospectIdForLead(lead) {
  const fingerprint = leadText(lead, ["sourceFingerprint", "source_fingerprint"], 80).toLowerCase();
  const basis = fingerprint
    || [
      leadText(lead, ["companyName", "company_name", "name"], 180),
      leadText(lead, ["addr", "address", "addressLine1"], 320),
      leadText(lead, ["phone"], 40),
      leadText(lead, ["city"], 80),
    ].join("|");
  const digest = createHash("sha256").update(`paydirt-lead-v1\0${basis}`).digest("hex");
  return PROSPECT_ID_PREFIX + digest.slice(0, PROSPECT_ID_HASH_LENGTH);
}

function industryForLead(lead) {
  // PayDirt's trade token first (its query grammar is already a trade), then
  // the permit's own words — the work description and the permit citation are
  // the two places the vertical is spelled out.
  return approvedIndustry(lead.trade)
    || approvedIndustry(lead.description)
    || approvedIndustry(lead.sourceLabel)
    || "";
}

/** Map one PayDirt lead to a ghost_agency_prospects row (store shape:
 * prospect_id + top-level columns + record). Refusals follow the bank's NAP
 * liveness law — a row the bank could never draw is refused HERE, loudly,
 * instead of being persisted and skipped forever after:
 *   · no usable name      -> paydirt_lead_name_missing
 *   · no city AND no state -> paydirt_lead_location_missing
 *   · no phone AND no website -> paydirt_lead_reach_missing (the "pre-paired"
 *     promise is the phone; a row with neither reach channel is not a lead)
 * A lead WITHOUT an email is ADMITTED, degraded: hasEmail:false — delivery is
 * held downstream by the same contact gate every other source rides. */
function mapPaydirtLead(input = {}, options = {}) {
  const lead = normalizedLead(input);
  const businessName = lead.name || filingBusinessName(lead.description);
  if (!businessName) return { ok: false, reason: "paydirt_lead_name_missing" };
  if (!lead.city && !lead.state) return { ok: false, reason: "paydirt_lead_location_missing" };
  if (!lead.phone && !lead.website) return { ok: false, reason: "paydirt_lead_reach_missing" };

  const industry = industryForLead(lead);
  const services = lead.description
    ? [text(lead.description, 160)]
    : (industry ? [industry] : []);
  const score = lead.score;
  const now = options.now || new Date().toISOString();
  const prospectId = prospectIdForLead(input);
  const row = {
    prospect_id: prospectId,
    status: "new",
    business_name: businessName,
    email: lead.email || null,
    phone: lead.phone || null,
    current_website: lead.website || null,
    industry: industry || null,
    city: lead.city || null,
    state: lead.state || null,
    leadminer_score: score,
    source: "paydirt",
    updated_at: now,
    record: {
      prospect_id: prospectId,
      business_name: businessName,
      email: lead.email || null,
      phone: lead.phone || null,
      current_website: lead.website || null,
      address: lead.address || null,
      city: lead.city || null,
      state: lead.state || null,
      postal: lead.postalCode || null,
      industry: industry || null,
      leadminer_score: score,
      source: "paydirt",
      truth_packet_source: "paydirt_prepaired",
      truth_packet: {
        source: "paydirt_prepaired",
        services,
        mirror_ready: {
          business_name: businessName,
          industry: industry || "",
          city: lead.city || "",
          state: lead.state || "",
          services,
        },
      },
      paydirt: {
        score,
        band: lead.band || (score == null ? "" : score >= 70 ? "HIGH" : score >= PAYDIRT_ELIGIBILITY_SCORE ? "GOOD" : "LONG"),
        fit: lead.fit,
        matchStatus: lead.matchStatus,
        mode: lead.mode,
        trade: lead.trade || "",
        provider: lead.provider || "paydirt",
        sourceUrl: lead.sourceUrl || null,
        sourceRecordId: lead.sourceRecordId || null,
        sourceFingerprint: lead.sourceFingerprint || null,
        retrievedAt: lead.retrievedAt || null,
        // PayDirt's own enrichment-eligibility verdict (score >= 48), carried
        // as provenance. Not a gate: WSS qualification is independent.
        eligibility: score == null ? null : score >= PAYDIRT_ELIGIBILITY_SCORE,
        prepaired: Boolean(lead.phone),
      },
    },
  };
  row.record.identity = canonicalIdentity({ ...row, ...row.record });
  return { ok: true, row };
}

// --- Export mode -----------------------------------------------------------

function parsePaydirtCsv(content) {
  const lines = String(content || "").split(/\r?\n/);
  const dataLines = lines.filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (!dataLines.length) return [];
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const payload = dataLines.join("\n");
  for (let i = 0; i < payload.length; i++) {
    const c = payload[i];
    if (quoted) {
      if (c === '"' && payload[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = (rows.shift() || []).map((header) => header.trim());
  return rows
    .filter((item) => item.some(Boolean))
    .map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] || ""])));
}

function paydirtLeadsFromJson(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.leads)) return payload.leads;
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload.prospects)) return payload.prospects;
    // a single exported lead object
    if (payload.name || payload.companyName || payload.address || payload.addr) return [payload];
  }
  return null;
}

async function readPaydirtExportFile({ filePath, readFile = fs.readFile, now }) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return { ok: false, status: "unavailable", reason: "paydirt_export_file_unreadable" };
  }
  const trimmed = String(content || "").trim();
  if (!trimmed) return { ok: false, status: "unavailable", reason: "paydirt_export_file_empty" };
  let leads = null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      leads = paydirtLeadsFromJson(JSON.parse(trimmed));
    } catch {
      return { ok: false, status: "unavailable", reason: "paydirt_export_json_invalid" };
    }
    if (leads === null) return { ok: false, status: "unavailable", reason: "paydirt_export_json_shape_unknown" };
  } else {
    leads = parsePaydirtCsv(trimmed);
  }
  return { ok: true, mode: "export", status: "ok", leads, ...(now ? { readAt: now } : {}) };
}

// --- API mode --------------------------------------------------------------

async function fetchPaydirtSearch({
  base,
  token,
  query = {},
  timeoutMs,
  fetchImpl = global.fetch,
}) {
  const url = new URL("/api/search", base);
  for (const [key, value] of Object.entries({
    city: query.city || "",
    state: query.state || "",
    trade: query.trade || "",
    mode: query.mode || "",
    limit: String(query.limit || ""),
    days: String(query.days || ""),
  })) {
    if (value) url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: "not_configured", reason: "paydirt_api_auth_not_programmatic" };
    }
    if (!response.ok) {
      return { ok: false, status: "unavailable", reason: "paydirt_api_http_error" };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, status: "unavailable", reason: "paydirt_api_payload_invalid" };
    }
    if (!payload || payload.ok !== true || !Array.isArray(payload.rows)) {
      return { ok: false, status: "unavailable", reason: "paydirt_api_payload_shape_unknown" };
    }
    return { ok: true, mode: "api", status: "ok", leads: payload.rows };
  } catch (error) {
    if (error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return { ok: false, status: "unavailable", reason: "paydirt_api_timeout" };
    }
    return { ok: false, status: "unavailable", reason: "paydirt_api_unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

// --- The one read entry the pick lane calls --------------------------------

/** Read PayDirt leads under the honest-limit law. NEVER throws. Success
 * answers { ok:true, mode, status:"ok", leads, cappedByQuota } — leads already
 * capped to paydirtWssQuota(env). Failure answers { ok:false, status, reason }
 * with status "not_configured" (loud: the source is deliberately off / its
 * auth is not programmatic) or "unavailable" (file/network trouble — fall
 * through to the existing sources). */
async function readPaydirtLeads({
  environment = process.env,
  query = {},
  count = 0,
  fetchImpl,
  readFile,
  now,
} = {}) {
  const resolved = resolvePaydirtMode(environment);
  if (resolved.mode === "none") {
    return {
      ok: false,
      status: "not_configured",
      reason: "paydirt_source_not_configured",
      message: "Set PAYDIRT_SOURCE=export with PAYDIRT_EXPORT_FILE (v1), or PAYDIRT_SOURCE=api with a provisioned PAYDIRT_API_TOKEN.",
    };
  }
  if (resolved.mode === "export") {
    const filePath = text(environment?.PAYDIRT_EXPORT_FILE, 1000);
    if (!filePath) {
      return { ok: false, status: "not_configured", reason: "paydirt_export_file_missing" };
    }
    const read = await readPaydirtExportFile({ filePath, readFile, now });
    if (!read.ok) return read;
    // Export reads are free (a local file): admit up to the quota so the
    // pick can seat its shortfall AND bank the compiled surplus — the
    // nothing-mined-is-ever-thrown-away doctrine. The API mode below stays
    // bounded to the request (its anonymous window is a shared spend).
    return capLeads(read, { environment });
  }
  const token = text(environment?.PAYDIRT_API_TOKEN, 500);
  const result = await fetchPaydirtSearch({
    base: paydirtApiBase(environment),
    token,
    query: {
      city: query.city || text(environment?.PAYDIRT_API_CITY, 80),
      state: query.state || text(environment?.PAYDIRT_API_STATE, 2),
      trade: query.trade || text(environment?.PAYDIRT_API_TRADE, 100),
      mode: query.mode || text(environment?.PAYDIRT_API_MODE, 24),
      limit: Math.max(1, Math.min(100, Number(count) || paydirtWssQuota(environment))),
      days: query.days || boundedInt(environment?.PAYDIRT_API_DAYS, 45, 1, 90),
    },
    timeoutMs: paydirtTimeoutMs(environment),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  if (!result.ok) return result;
  return capLeads(result, { environment, count });
}

function capLeads(result, { environment, count }) {
  const quota = paydirtWssQuota(environment);
  const wanted = count === undefined
    ? quota
    : Math.max(1, Number(count) || quota);
  const leads = Array.isArray(result.leads) ? result.leads : [];
  const admitted = leads.slice(0, Math.min(quota, wanted));
  return {
    ...result,
    leads: admitted,
    cappedByQuota: leads.length > admitted.length,
    readCount: leads.length,
    quota,
  };
}

module.exports = {
  DEFAULT_API_BASE,
  DEFAULT_WSS_QUOTA,
  DEFAULT_TIMEOUT_MS,
  PAYDIRT_ELIGIBILITY_SCORE,
  mapPaydirtLead,
  paydirtApiBase,
  paydirtTimeoutMs,
  paydirtWssQuota,
  parsePaydirtCsv,
  readPaydirtLeads,
  resolvePaydirtMode,
};
