"use strict";

// lib/riley-line.js — the ONE place that answers "what number does this client
// call or text for Riley?".
//
// WHY THIS FILE EXISTS
// A literal phone number written into source outlives the line it names. On
// 2026-07-30 a rendered proof email printed a long-retired agency number under a
// Riley CTA because lib/email.js carried a DEFAULT_AGENT_PHONE constant that took
// over the moment the environment variable was unset. Nobody chose to publish
// that number; a fallback did. So: there is no phone-number literal anywhere in
// this file — not even in these comments — and no agency-wide default in the
// per-client path.
//
// RESOLUTION ORDER for a client-facing Riley CTA:
//   1. the Riley line provisioned FOR THAT CLIENT (client record / verified facts)
//   2. nothing.
// `allowAgencyLine: true` lets a caller that is genuinely speaking for the
// agency (e.g. the post-checkout activation email) add the configured agency
// line as a last resort. It is OFF by default and the resolved `source` always
// says which one was used.
//
// THE CLIENT'S OWN NAP PHONE IS NOT A CANDIDATE. That number is the client's
// front desk. Riley does not answer it. Printing it beneath "Call or text Riley
// now" would swap one truth defect for another — a real number, falsely
// attributed. See NON_RILEY_PHONE_FIELDS.
//
// CONTRACT FOR CALLERS: `phone === null` means OMIT — the whole CTA, the whole
// phone line. Never a placeholder, never an empty string welded into prose,
// never "call us at ." A missing number is a missing element.

// Environment names, in precedence order. GHOST_AGENT_PHONE is the name the
// owner uses; GHOST_AGENCY_AGENT_PHONE is the name the rest of this codebase
// already reads (api/riley-phone.js, api/admin/agent-phone.js, lib/forge.js).
// Both are honoured so neither half of the system silently goes dark. No third
// name is invented here.
const AGENT_PHONE_ENV_NAMES = Object.freeze(["GHOST_AGENT_PHONE", "GHOST_AGENCY_AGENT_PHONE"]);

// Per-client fields that may hold a line Riley actually answers for that client.
const CLIENT_RILEY_PHONE_FIELDS = Object.freeze([
  "riley_phone",
  "rileyPhone",
  "riley_line",
  "rileyLine",
  "agent_phone",
  "agentPhone",
]);

// Deliberate refusals. These hold the CLIENT'S OWN business line, which is not
// a Riley line. Listed (and tested) so the refusal is explicit rather than an
// omission somebody "fixes" later.
const NON_RILEY_PHONE_FIELDS = Object.freeze([
  "phone",
  "phoneDigits",
  "phone_digits",
  "business_phone",
  "businessPhone",
  "nap_phone",
]);

function digitsOf(value) {
  return String(value == null ? "" : value).replace(/\D/g, "");
}

/**
 * Parse a phone into everything a renderer needs, or null.
 *
 * Returns null for: empty, an unsubstituted template token, or anything that is
 * not a dialable NANP/E.164 number. Null is a *good* outcome — it is how the
 * CTA disappears instead of rendering something un-dialable.
 */
function normalizePhone(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  if (raw.includes("{{") || raw.includes("}}") || raw.includes("{%")) return null; // unsubstituted token
  const d = digitsOf(raw);
  let e164 = "";
  if (d.length === 10) e164 = `+1${d}`;
  else if (d.length === 11 && d.startsWith("1")) e164 = `+${d}`;
  else if (raw.startsWith("+") && d.length >= 11 && d.length <= 15) e164 = `+${d}`;
  else return null;
  const national = e164.startsWith("+1") && e164.length === 12 ? e164.slice(2) : "";
  const display = national
    ? `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
    : e164;
  return { e164, digits: d, display, telHref: `tel:${e164}` };
}

/**
 * The configured agency line, or null. Environment only — an unset (or
 * unparseable) variable resolves to nothing, never to a constant.
 */
function agencyAgentPhoneEntry(env = process.env) {
  for (const name of AGENT_PHONE_ENV_NAMES) {
    const value = String((env && env[name]) || "").trim();
    if (!value) continue;
    const parsed = normalizePhone(value);
    if (!parsed) return { name, value, parsed: null, reason: "env_value_unparseable" };
    return { name, value, parsed, reason: null };
  }
  return null;
}

/**
 * Back-compatible string accessor used by lib/email.js.
 * Returns "" when no usable number is configured. "" MUST be treated as omit.
 */
function agencyAgentPhone(env = process.env) {
  const entry = agencyAgentPhoneEntry(env);
  return entry && entry.parsed ? entry.value : "";
}

/**
 * A Riley line provisioned for this specific client, or null.
 *
 * `facts`/`provenance` are the verified-facts packet shape
 * (mirror-engine-verified-facts-v1). When a provenance map is supplied, a fact
 * with no provenance entry is treated as unverified and dropped — the same rule
 * the rest of the packet lives by.
 */
function clientRileyCandidate({ client = {}, facts = {}, provenance = {} } = {}) {
  const bags = [
    ["client", client && typeof client === "object" ? client : {}],
    ["verified_facts", facts && typeof facts === "object" ? facts : {}],
  ];
  for (const field of CLIENT_RILEY_PHONE_FIELDS) {
    for (const [scope, bag] of bags) {
      const value = bag[field];
      if (value == null || String(value).trim() === "") continue;
      if (scope === "verified_facts"
        && provenance && typeof provenance === "object"
        && Object.keys(provenance).length
        && !provenance[field]) {
        return { field, scope, parsed: null, reason: "no_provenance" };
      }
      const parsed = normalizePhone(value);
      if (!parsed) return { field, scope, parsed: null, reason: "unparseable" };
      return { field, scope, parsed, reason: null };
    }
  }
  return null;
}

/**
 * resolveRileyLine(...) -> {
 *   phone: string|null, display: string, telHref: string,
 *   source: string|null, reason: string|null
 * }
 *
 * `phone === null` is a complete instruction: render no CTA and no phone line.
 */
function resolveRileyLine({
  client = {},
  facts = {},
  provenance = {},
  env = process.env,
  allowAgencyLine = false,
} = {}) {
  const miss = (reason) => ({ phone: null, display: "", telHref: "", source: null, reason });

  const candidate = clientRileyCandidate({ client, facts, provenance });
  if (candidate && candidate.parsed) {
    return {
      phone: candidate.parsed.e164,
      display: candidate.parsed.display,
      telHref: candidate.parsed.telHref,
      source: `${candidate.scope}:${candidate.field}`,
      reason: null,
    };
  }
  if (candidate && !candidate.parsed) {
    return miss(`client_riley_line_rejected:${candidate.scope}.${candidate.field}:${candidate.reason}`);
  }

  if (!allowAgencyLine) return miss("no_client_riley_line");

  const entry = agencyAgentPhoneEntry(env);
  if (!entry) return miss(`no_client_riley_line;agency_line_unset:${AGENT_PHONE_ENV_NAMES.join("|")}`);
  if (!entry.parsed) return miss(`no_client_riley_line;agency_line_rejected:${entry.name}:${entry.reason}`);
  return {
    phone: entry.parsed.e164,
    display: entry.parsed.display,
    telHref: entry.parsed.telHref,
    source: `env:${entry.name}`,
    reason: null,
  };
}

module.exports = {
  AGENT_PHONE_ENV_NAMES,
  CLIENT_RILEY_PHONE_FIELDS,
  NON_RILEY_PHONE_FIELDS,
  agencyAgentPhone,
  agencyAgentPhoneEntry,
  clientRileyCandidate,
  normalizePhone,
  resolveRileyLine,
};
