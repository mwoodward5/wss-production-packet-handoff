"use strict";

const { createHash, randomUUID } = require("node:crypto");
const store = require("./store");

const BATCH_TABLE = "ghost_agency_line_batches";
const ROW_TABLE = "ghost_agency_line_batch_rows";

const BATCH_STATUSES = Object.freeze([
  "building",
  "running",
  "awaiting_approval",
  "approved",
  "sending",
  "done",
  "halted",
]);
const PICK_STATES = Object.freeze(["pending", "picking", "complete", "failed"]);
const ROW_STATUSES = Object.freeze([
  "picked",
  "qualified",
  "mirrored",
  "gate_passed",
  "ready",
  "queued",
  "sent",
  "rejected",
  "gate_failed",
  "error",
]);
const RESUMABLE_ROW_STATUSES = Object.freeze(["picked", "qualified", "mirrored", "gate_passed"]);
const CLAIMABLE_ROW_STATUSES = Object.freeze([...RESUMABLE_ROW_STATUSES, "queued"]);
const TERMINAL_ROW_STATUSES = new Set(["ready", "queued", "sent", "rejected", "gate_failed", "error"]);
const HALT_REASON_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;
const SAFE_BATCH_PATCHES = Object.freeze({
  status: "status",
  pickState: "pick_state",
  pick_state: "pick_state",
  mineFunnel: "mine_funnel",
  mine_funnel: "mine_funnel",
  approval: "approval",
  haltReason: "halt_reason",
  halt_reason: "halt_reason",
  settledAt: "settled_at",
  settled_at: "settled_at",
  sentAt: "sent_at",
  sent_at: "sent_at",
  target: "target",
  requested: "requested",
});

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{5,}\d)/g;
const SENSITIVE_KEY = /^(?:email|emailaddress|emails|owneremail|contactemail|recipientemail|toemail|phone|phonenumber|phones|ownerphone|contactphone|mobile|mobilephone|telephone|tel)$/;
const OPAQUE_CRYPTO_KEY = /(?:hash|sha(?:1|224|256|384|512)?|digest|signature|fingerprint)s?$/;
const OPAQUE_SIGNED_SHA_KEY = /^(?:logoshasource|logoshainoutput)$/;
const OPAQUE_SHA256_TOKEN = /^[a-f0-9]{64}$/i;
const OPAQUE_HEX_TOKEN = /^(?=[a-f0-9]{16,128}$)(?=.*[a-f])[a-f0-9]+$/i;
const OPAQUE_PREFIXED_HEX_TOKEN = /^(?:[a-z][a-z0-9._-]{0,63}:){1,2}([a-f0-9]{16,128})$/i;
const OPAQUE_IDENTITY_KEY = /^(?:batchid|prospectid|rowid|typedbatchid|linebatchid|linerowid|foreignjoblinebatchid|foreignjoblinerowid)$/;
// Release identity tuples are machine ids (the "non-PII tuple" law in
// line-email-assets). A bare UUID under site_id/release_id must never meet the
// phone scrubber: UUIDs carrying a 7+ digit run were rewritten to
// "...[redacted-phone]..." at persistence time (live 2026-09-01 corruption —
// every gate_passed drain then refused shared_proof_identity_malformed
// forever, because the digits are destroyed, not masked).
const OPAQUE_RELEASE_IDENTITY_KEY = /^(?:siteid|releaseid|sharedsiteid|sharedreleaseid|previoussiteid|previousreleaseid)$/;
const BARE_UUID_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_NAMESPACED_HEX_ID = /^([a-z][a-z0-9._-]{0,63})_([a-f0-9]{16,128})(?::\d{1,3})?$/i;
const OPAQUE_HYPHEN_NAMESPACED_ID = /^[a-z][a-z0-9]{0,15}-[a-z0-9]{16,64}$/i;
const EXACT_ROW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,299}$/;
const LEASE_UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RELEASE_EVIDENCE_TRANSFORM_SCHEMA = "line-release-evidence-pii-transform-v1";
const EXPLICIT_PROSPECT_STAGE = "explicit_prospect_ids_v1";
const EXPLICIT_PROSPECT_TARGET = "owner-selected-packets";
const EXPLICIT_PROSPECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const EXPLICIT_PROSPECT_KEY = /^pid_([A-Za-z0-9_-]{2,220})$/;
const RELEASE_EVIDENCE_PATHS = Object.freeze([
  Object.freeze(["releaseEvidence"]),
  Object.freeze(["release_evidence"]),
  Object.freeze(["buildEvidence", "releaseEvidence"]),
  Object.freeze(["buildEvidence", "release_evidence"]),
  Object.freeze(["build_evidence", "releaseEvidence"]),
  Object.freeze(["build_evidence", "release_evidence"]),
  Object.freeze(["buildStatus", "releaseEvidence"]),
  Object.freeze(["buildStatus", "release_evidence"]),
  Object.freeze(["build_status", "releaseEvidence"]),
  Object.freeze(["build_status", "release_evidence"]),
]);

function explicitProspectFingerprint(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10) return "";
  const normalized = ids.map((value) => String(value || "").trim());
  if (new Set(normalized).size !== normalized.length
    || normalized.some((id) => !EXPLICIT_PROSPECT_ID.test(id))) return "";
  return createHash("sha256")
    .update(JSON.stringify({ schema: EXPLICIT_PROSPECT_STAGE, prospect_ids: normalized }))
    .digest("hex");
}

function encodeExplicitProspectId(value) {
  const id = String(value || "").trim();
  if (!EXPLICIT_PROSPECT_ID.test(id)) return "";
  return `pid_${Buffer.from(id, "utf8").toString("base64url")}`;
}

function decodeExplicitProspectKey(value) {
  const match = String(value || "").trim().match(EXPLICIT_PROSPECT_KEY);
  if (!match) return "";
  let id = "";
  try {
    id = Buffer.from(match[1], "base64url").toString("utf8");
  } catch {
    return "";
  }
  return EXPLICIT_PROSPECT_ID.test(id) && encodeExplicitProspectId(id) === value ? id : "";
}

function createExplicitProspectMarker(ids, values = {}) {
  const fingerprint = explicitProspectFingerprint(ids);
  if (!fingerprint) return null;
  const normalized = ids.map((value) => String(value).trim());
  return {
    stage: EXPLICIT_PROSPECT_STAGE,
    entered: integer(values.entered, normalized.length),
    survived: integer(values.survived, 0),
    rejected: values.rejected && typeof values.rejected === "object" ? values.rejected : {},
    prospect_keys: normalized.map(encodeExplicitProspectId),
    selection_sha256: fingerprint,
  };
}

function readExplicitProspectMarker(mineFunnel, { requested } = {}) {
  const rows = Array.isArray(mineFunnel) ? mineFunnel : [];
  const markers = rows.filter((row) => row && row.stage === EXPLICIT_PROSPECT_STAGE);
  if (!markers.length) return { ok: true, present: false, ids: [], fingerprint: "" };
  if (markers.length !== 1) return { ok: false, present: true, error: "explicit_prospect_marker_ambiguous", ids: [], fingerprint: "" };
  const marker = markers[0];
  // Raw IDs are intentionally refused. Persistence's PII scrubber can mutate
  // phone-shaped strings, which once made an exact batch silently become a
  // normal mining batch. Encoded packet keys survive that boundary byte-for-
  // byte; the ordered digest below detects any corruption or reordering.
  if (Object.prototype.hasOwnProperty.call(marker, "prospect_ids")
    || !Array.isArray(marker.prospect_keys)) {
    return { ok: false, present: true, error: "explicit_prospect_marker_unsafe", ids: [], fingerprint: "" };
  }
  const ids = marker.prospect_keys.map(decodeExplicitProspectKey);
  const fingerprint = explicitProspectFingerprint(ids);
  if (!fingerprint || ids.some((id) => !id)) {
    return { ok: false, present: true, error: "explicit_prospect_marker_invalid", ids: [], fingerprint: "" };
  }
  if (Number.isInteger(Number(requested)) && Number(requested) !== ids.length) {
    return { ok: false, present: true, error: "explicit_prospect_marker_count_mismatch", ids: [], fingerprint: "" };
  }
  if (String(marker.selection_sha256 || "").trim().toLowerCase() !== fingerprint) {
    return { ok: false, present: true, error: "explicit_prospect_marker_hash_mismatch", ids: [], fingerprint: "" };
  }
  return { ok: true, present: true, ids, fingerprint, marker };
}

function normalizedKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function opaqueCryptographicLeaf(key, value) {
  const leafKey = normalizedKey(key);
  const token = String(value || "");
  if (OPAQUE_SIGNED_SHA_KEY.test(leafKey)) {
    return OPAQUE_SHA256_TOKEN.test(token) ? token : null;
  }
  if (!OPAQUE_CRYPTO_KEY.test(leafKey)) return null;
  // Mirror evidence uses a 16-character text hash, full hexadecimal digests,
  // and namespaced fingerprints such as `mirror-engine:<build hash>`. Keep
  // only those strict, whitespace-free shapes byte-identical. A malformed
  // value falls through to the normal PII scrubber instead of gaining an
  // exemption merely because its field name sounds cryptographic.
  const prefixed = token.match(OPAQUE_PREFIXED_HEX_TOKEN);
  return OPAQUE_HEX_TOKEN.test(token) || (prefixed && OPAQUE_HEX_TOKEN.test(prefixed[1]))
    ? token
    : null;
}

function opaqueIdentityLeaf(key, value) {
  const token = String(value || "");
  if (OPAQUE_RELEASE_IDENTITY_KEY.test(normalizedKey(key)) && BARE_UUID_TOKEN.test(token)) {
    return token;
  }
  if (!OPAQUE_IDENTITY_KEY.test(normalizedKey(key))) return null;
  const matched = token.match(OPAQUE_NAMESPACED_HEX_ID);
  if (matched && !/\d{7}/.test(matched[1]) && /[a-f]/i.test(matched[2])) return token;
  // LeadMiner prospect ids are hyphen-namespaced (`lm-<opaque alphanumeric>`)
  // and legitimately embed source-phone digits inside the opaque tail. The
  // full shape — letter namespace, one hyphen, 16-64 alphanumeric chars —
  // cannot be a dialable number, and this rescue only fires under identity
  // keys, so the token is a machine key, never contact PII. Without this the
  // phone scrubber rewrote `lm-b<digits>…` to `lm-b[redacted-phone]…` at
  // persistence time and the later store read by the real id returned rows_0
  // (17 verified production kills, 2026-08-31).
  return OPAQUE_HYPHEN_NAMESPACED_ID.test(token) ? token : null;
}

function scrubString(value) {
  const text = String(value || "");
  return text
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_PATTERN, (candidate) => {
      const digits = candidate.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return candidate;
      if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
      return "[redacted-phone]";
    });
}

/**
 * Remove contact PII before a row or batch payload crosses the persistence
 * boundary. Email/phone keys are omitted and values hidden inside notes or
 * nested provider output are redacted as a second line of defence.
 */
function sanitizePayloadValue(value, seen = new WeakSet(), fieldKey = "") {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return opaqueIdentityLeaf(fieldKey, value)
      || opaqueCryptographicLeaf(fieldKey, value)
      || scrubString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (seen.has(value)) return [];
    seen.add(value);
    const sanitized = value
      .map((entry) => sanitizePayloadValue(entry, seen, fieldKey))
      .filter((entry) => entry !== undefined);
    seen.delete(value);
    return sanitized;
  }
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(normalizedKey(key))) continue;
    const next = sanitizePayloadValue(entry, seen, key);
    if (next !== undefined) sanitized[key] = next;
  }
  seen.delete(value);
  return sanitized;
}

function valueAtPath(value, path) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = current[key];
  }
  return current && typeof current === "object" && !Array.isArray(current) ? current : null;
}

function verifiedEvidenceSha(evidence) {
  const sourceSha = String(evidence && evidence.evidence_sha || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sourceSha)) return "";
  try {
    const { signEvidence } = require("./mirror-engine/engine");
    return signEvidence(evidence) === sourceSha ? sourceSha : "";
  } catch {
    return "";
  }
}

function signPersistedEvidence(evidence) {
  try {
    const { signEvidence } = require("./mirror-engine/engine");
    return signEvidence(evidence);
  } catch {
    return "";
  }
}

function canonicalEvidence(value) {
  return canonicalJson(value);
}

/**
 * The Mirror Engine signs its complete release manifest. The durable Line row
 * is deliberately PII-free, so a phone-shaped archived filename (or any other
 * contact token inside a named check) must be scrubbed before it crosses that
 * boundary. Scrubbing after signing used to make an honest manifest look
 * tampered with at preview-write time.
 *
 * This bridge never blesses unverified input: every original copy must carry a
 * valid Engine digest and every duplicate carrier must name that same digest.
 * Only then do we bind a new digest to the PII-free representation and update
 * its outer carriers. The source digest and transform receipt stay OUTSIDE the
 * signed manifest, preserving both the Engine receipt and the no-PII law.
 */
function rebindSanitizedReleaseEvidence(original, sanitized) {
  if (!original || typeof original !== "object" || Array.isArray(original)
    || !sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return sanitized;

  const carriers = RELEASE_EVIDENCE_PATHS
    .map((path) => ({
      path,
      original: valueAtPath(original, path),
      sanitized: valueAtPath(sanitized, path),
    }))
    .filter((entry) => entry.original || entry.sanitized);
  if (!carriers.length) return sanitized;
  if (carriers.some((entry) => !entry.original || !entry.sanitized)) return sanitized;

  const sourceShas = carriers.map((entry) => verifiedEvidenceSha(entry.original));
  if (sourceShas.some((sha) => !sha) || new Set(sourceShas).size !== 1) return sanitized;
  const sourceSha = sourceShas[0];
  const changed = carriers.some((entry) => canonicalEvidence(entry.original) !== canonicalEvidence(entry.sanitized));
  if (!changed) return sanitized;

  const persistedShas = carriers.map((entry) => signPersistedEvidence(entry.sanitized));
  if (persistedShas.some((sha) => !/^[a-f0-9]{64}$/.test(sha)) || new Set(persistedShas).size !== 1) return sanitized;
  const persistedSha = persistedShas[0];

  for (const entry of carriers) entry.sanitized.evidence_sha = persistedSha;
  for (const key of ["buildEvidence", "build_evidence", "buildStatus", "build_status"]) {
    const carrier = sanitized[key];
    if (!carrier || typeof carrier !== "object" || Array.isArray(carrier)) continue;
    if (String(carrier.evidence_sha || "").toLowerCase() === sourceSha) carrier.evidence_sha = persistedSha;
    if (String(carrier.evidenceSha || "").toLowerCase() === sourceSha) carrier.evidenceSha = persistedSha;
  }
  if (String(sanitized.evidence_sha || "").toLowerCase() === sourceSha) sanitized.evidence_sha = persistedSha;
  if (String(sanitized.evidenceSha || "").toLowerCase() === sourceSha) sanitized.evidenceSha = persistedSha;

  const prior = sanitized.releaseEvidenceTransform;
  sanitized.releaseEvidenceTransform = {
    schema: RELEASE_EVIDENCE_TRANSFORM_SCHEMA,
    source_evidence_sha: String(prior && prior.source_evidence_sha || sourceSha),
    persisted_evidence_sha: persistedSha,
    pii_scrubbed: true,
  };
  return sanitized;
}

function sanitizeRowPayload(value, seen = new WeakSet(), fieldKey = "") {
  const sanitized = sanitizePayloadValue(value, seen, fieldKey);
  return fieldKey ? sanitized : rebindSanitizedReleaseEvidence(value, sanitized);
}

function text(value, maxLength = 500) {
  return scrubString(String(value || "").trim()).slice(0, maxLength);
}

function identityText(value, maxLength) {
  const token = String(value || "").trim();
  return (opaqueIdentityLeaf("rowId", token) || scrubString(token)).slice(0, maxLength);
}

function leaseTokenText(value) {
  const token = String(value || "").trim().toLowerCase();
  return LEASE_UUID_V4.test(token) ? token : "";
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.min(Math.max(integer(value, fallback), 1), maximum);
}

function isoDate(value, fallback) {
  const parsed = value instanceof Date ? value : new Date(value || "");
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function equivalent(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function rowsFrom(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  if (Array.isArray(result?.row)) return result.row;
  if (result?.row && typeof result.row === "object") return [result.row];
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function writeSucceeded(result) {
  if (!result) return false;
  if (result.ok === true && result.updated !== false) return true;
  return ["live_write", "live_upsert", "memory_write"].includes(result.mode);
}

function updateSucceeded(result) {
  return Boolean(result && result.ok === true && result.updated === true);
}

function isOperationalFailure(result) {
  if (!result) return true;
  if (result.mode === "dry_run" || result.configured === false) return true;
  return result.ok === false && result.mode !== "live_update";
}

function errorCode(result, fallback) {
  return text(result?.error?.code || result?.error?.category || result?.mode || fallback, 100);
}

function encoded(value) {
  return encodeURIComponent(String(value || ""));
}

function dbBatch(input, now) {
  const batchId = identityText(input?.batchId || input?.batch_id, 160);
  const startedAt = isoDate(input?.startedAt || input?.started_at, now);
  const status = BATCH_STATUSES.includes(input?.status) ? input.status : "building";
  const pickState = PICK_STATES.includes(input?.pickState || input?.pick_state)
    ? (input.pickState || input.pick_state)
    : "pending";
  return {
    batch_id: batchId,
    lane: input?.lane === "live" ? "live" : "sandbox",
    target: text(input?.target, 500),
    requested: Math.min(Math.max(integer(input?.requested, 0), 0), 500),
    status,
    pick_state: pickState,
    mine_funnel: sanitizeRowPayload(input?.mineFunnel || input?.mine_funnel || {}),
    approval: input?.approval ? sanitizeRowPayload(input.approval) : null,
    halt_reason: input?.haltReason || input?.halt_reason ? text(input.haltReason || input.halt_reason, 1000) : null,
    version: Math.max(integer(input?.version, 0), 0),
    started_at: startedAt,
    created_at: isoDate(input?.createdAt || input?.created_at, now),
    updated_at: isoDate(input?.updatedAt || input?.updated_at, now),
    settled_at: input?.settledAt || input?.settled_at
      ? isoDate(input.settledAt || input.settled_at, null)
      : null,
    sent_at: input?.sentAt || input?.sent_at ? isoDate(input.sentAt || input.sent_at, null) : null,
  };
}

function payloadOnly(row) {
  const payload = { ...(row || {}) };
  for (const key of [
    "rowId", "row_id", "batchId", "batch_id", "rowIndex", "row_index",
    "version", "mutationToken", "mutation_token", "leaseToken", "lease_token", "leaseOwner", "lease_owner",
    "leaseExpiresAt", "lease_expires_at", "attemptCount", "attempt_count",
    "logoSha256", "logo_sha256", "terminalAt", "terminal_at", "createdAt", "created_at",
  ]) delete payload[key];
  return sanitizeRowPayload(payload);
}

function normalizedLogo(value) {
  const logo = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(logo) ? logo : null;
}

function dbRow(batchId, row, index, now) {
  const rowIndex = Math.max(integer(row?.rowIndex ?? row?.row_index, index), 0);
  const prospectId = identityText(row?.prospectId || row?.prospect_id, 240);
  const rowId = identityText(row?.rowId || row?.row_id || `${batchId}:${rowIndex}`, 300);
  const status = ROW_STATUSES.includes(row?.status) ? row.status : "picked";
  const logoSha256 = normalizedLogo(row?.logoSha256 || row?.logo_sha256 || row?.captured?.logoSha256);
  return {
    row_id: rowId,
    batch_id: batchId,
    row_index: rowIndex,
    prospect_id: prospectId,
    status,
    payload: payloadOnly({ ...row, status }),
    version: Math.max(integer(row?.version, 0), 0),
    mutation_token: null,
    lease_token: null,
    lease_owner: null,
    lease_expires_at: null,
    attempt_count: Math.max(integer(row?.attemptCount || row?.attempt_count, 0), 0),
    last_retryable_error: row?.lastRetryableError || row?.last_retryable_error
      ? text(row.lastRetryableError || row.last_retryable_error, 1000)
      : null,
    logo_sha256: logoSha256,
    terminal_at: TERMINAL_ROW_STATUSES.has(status)
      ? isoDate(row?.terminalAt || row?.terminal_at, now)
      : null,
    created_at: isoDate(row?.createdAt || row?.created_at, now),
    updated_at: isoDate(row?.updatedAt || row?.updated_at, now),
  };
}

function hydrateRow(raw) {
  if (!raw) return null;
  return {
    ...sanitizeRowPayload(raw.payload || {}),
    rowId: raw.row_id,
    batchId: raw.batch_id,
    rowIndex: integer(raw.row_index, 0),
    prospectId: raw.prospect_id,
    status: raw.status,
    version: integer(raw.version, 0),
    mutationToken: raw.mutation_token || null,
    leaseToken: raw.lease_token || null,
    leaseOwner: raw.lease_owner || null,
    leaseExpiresAt: raw.lease_expires_at || null,
    attemptCount: integer(raw.attempt_count, 0),
    lastRetryableError: raw.last_retryable_error || null,
    logoSha256: raw.logo_sha256 || null,
    terminalAt: raw.terminal_at || null,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
  };
}

function hydrateBatch(raw, rows = []) {
  if (!raw) return null;
  return {
    batchId: raw.batch_id,
    lane: raw.lane,
    target: scrubString(raw.target || ""),
    requested: integer(raw.requested, 0),
    status: raw.status,
    pickState: raw.pick_state,
    mineFunnel: sanitizeRowPayload(raw.mine_funnel || {}),
    approval: raw.approval ? sanitizeRowPayload(raw.approval) : null,
    haltReason: raw.halt_reason || "",
    version: integer(raw.version, 0),
    startedAt: raw.started_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    settledAt: raw.settled_at || null,
    sentAt: raw.sent_at || null,
    rows: rows.map(hydrateRow),
  };
}

function createLinePersistence(dependencies = {}) {
  const deps = {
    insertRow: dependencies.insertRow || store.insertRow,
    selectRows: dependencies.selectRows || store.selectRows,
    conditionalUpdate: dependencies.conditionalUpdate || store.conditionalUpdate,
    randomUUID: dependencies.randomUUID || randomUUID,
    now: dependencies.now || (() => new Date()),
  };

  function nowIso() {
    return isoDate(deps.now(), new Date().toISOString());
  }

  async function readRows(table, options, requestOptions) {
    let result;
    try {
      result = await deps.selectRows(table, options, requestOptions);
    } catch (error) {
      return { ok: false, error: "read_failed", cause: error };
    }
    if (result?.mode === "dry_run" || result?.configured === false) {
      return { ok: false, error: "persistence_not_configured" };
    }
    if (result?.mode === "live_select_failed" || (result?.ok === false && !Array.isArray(result?.rows))) {
      return { ok: false, error: errorCode(result, "read_failed"), result };
    }
    return { ok: true, rows: rowsFrom(result) };
  }

  async function loadRawBatch(batchId, options = {}) {
    const id = identityText(batchId, 160);
    if (!id) return { ok: false, error: "batch_id_required" };
    const read = await readRows(BATCH_TABLE, {
      select: "*",
      filter: `batch_id=eq.${encoded(id)}`,
      limit: 1,
    }, options);
    if (!read.ok) return read;
    return { ok: true, row: read.rows[0] || null };
  }

  async function loadRawRow(rowId, options = {}) {
    const id = identityText(rowId, 300);
    if (!id) return { ok: false, error: "row_id_required" };
    const read = await readRows(ROW_TABLE, {
      select: "*",
      filter: `row_id=eq.${encoded(id)}`,
      limit: 1,
    }, options);
    if (!read.ok) return read;
    return { ok: true, row: read.rows[0] || null };
  }

  async function loadRawRowsForBatch(batchId, options = {}) {
    return readRows(ROW_TABLE, {
      select: "*",
      filter: `batch_id=eq.${encoded(batchId)}`,
      order: "row_index.asc",
      limit: 1000,
    }, options);
  }

  async function loadBatch(batchId, options = {}) {
    const batchRead = await loadRawBatch(batchId, options);
    if (!batchRead.ok) return batchRead;
    if (!batchRead.row) return { ok: false, error: "batch_not_found" };
    const rowRead = await loadRawRowsForBatch(batchRead.row.batch_id, options);
    if (!rowRead.ok) return rowRead;
    return { ok: true, batch: hydrateBatch(batchRead.row, rowRead.rows) };
  }

  /**
   * Read canonical batches in newest-first order. This is the status/repair
   * seam used by the admin console and rescue cron; append-only events are
   * deliberately not consulted for coordination.
   */
  async function listBatches({ statuses, limit = 20, updatedBefore, includeRows = true, order = "updated_at.desc" } = {}, options = {}) {
    const wanted = (Array.isArray(statuses) ? statuses : [])
      .filter((status, index, all) => BATCH_STATUSES.includes(status) && all.indexOf(status) === index);
    const filters = [];
    if (wanted.length) filters.push(`status=in.(${wanted.join(",")})`);
    if (updatedBefore) {
      const before = isoDate(updatedBefore, null);
      if (before) filters.push(`updated_at=lt.${encoded(before)}`);
    }
    const read = await readRows(BATCH_TABLE, {
      select: "*",
      ...(filters.length ? { filter: filters.join("&") } : {}),
      order: order === "updated_at.asc" ? "updated_at.asc" : "updated_at.desc",
      limit: positiveInteger(limit, 20, 100),
    }, options);
    if (!read.ok) return read;
    if (includeRows === false) return { ok: true, batches: read.rows.map((row) => hydrateBatch(row)) };
    const batches = [];
    for (const raw of read.rows) {
      const rowRead = await loadRawRowsForBatch(raw.batch_id, options);
      if (!rowRead.ok) return rowRead;
      batches.push(hydrateBatch(raw, rowRead.rows));
    }
    return { ok: true, batches };
  }

  async function createBatch(batch, options = {}) {
    const now = nowIso();
    const desired = dbBatch(batch, now);
    if (!desired.batch_id) return { ok: false, error: "batch_id_required" };
    const desiredSelection = readExplicitProspectMarker(desired.mine_funnel, { requested: desired.requested });
    const desiredIsExact = desired.target === EXPLICIT_PROSPECT_TARGET;
    if ((desiredIsExact && (!desiredSelection.ok || !desiredSelection.present))
      || (!desiredIsExact && desiredSelection.present)) {
      return { ok: false, conflict: true, error: desiredSelection.error || "batch_identity_invalid" };
    }
    let result;
    try {
      result = await deps.insertRow(BATCH_TABLE, desired, options);
    } catch (error) {
      result = { ok: false, mode: "write_threw", error: { code: error?.code || "write_threw" } };
    }
    if (writeSucceeded(result)) {
      return { ok: true, created: true, idempotent: false, batch: hydrateBatch(rowsFrom(result)[0] || desired) };
    }

    // The insert may have committed even if its response was lost. Re-read
    // before reporting failure so callers can retry create safely.
    const existing = await loadRawBatch(desired.batch_id, options);
    if (existing.ok && existing.row) {
      const existingSelection = readExplicitProspectMarker(existing.row.mine_funnel, {
        requested: integer(existing.row.requested, 0),
      });
      const sameIdentity = existing.row.lane === desired.lane
        && integer(existing.row.requested, 0) === desired.requested
        && String(existing.row.target || "") === desired.target
        && (!desiredIsExact || (existingSelection.ok
          && existingSelection.present
          && existingSelection.fingerprint === desiredSelection.fingerprint));
      if (sameIdentity) {
        return { ok: true, created: false, idempotent: true, batch: hydrateBatch(existing.row) };
      }
      return { ok: false, conflict: true, error: "batch_identity_conflict" };
    }
    return { ok: false, error: errorCode(result, "batch_create_failed"), retryable: true };
  }

  async function insertOneRow(desired, options = {}) {
    let result;
    try {
      result = await deps.insertRow(ROW_TABLE, desired, options);
    } catch (error) {
      result = { ok: false, mode: "write_threw", error: { code: error?.code || "write_threw" } };
    }
    if (writeSucceeded(result)) {
      return { ok: true, created: true, row: rowsFrom(result)[0] || desired };
    }
    const current = await loadRawRow(desired.row_id, options);
    if (current.ok && current.row) {
      const sameIdentity = current.row.batch_id === desired.batch_id
        && current.row.prospect_id === desired.prospect_id
        && integer(current.row.row_index, -1) === desired.row_index;
      return sameIdentity
        ? { ok: true, created: false, idempotent: true, row: current.row }
        : { ok: false, conflict: true, error: "row_identity_conflict" };
    }
    return { ok: false, error: errorCode(result, "row_create_failed"), retryable: true };
  }

  async function storeRows({ batchId, rows } = {}, options = {}) {
    const id = identityText(batchId, 160);
    if (!id) return { ok: false, error: "batch_id_required" };
    if (!Array.isArray(rows)) return { ok: false, error: "rows_required" };
    const now = nowIso();
    const desiredRows = rows.map((row, index) => dbRow(id, row, index, now));
    if (desiredRows.some((row) => !row.row_id || !row.prospect_id)) {
      return { ok: false, error: "row_identity_required" };
    }
    if (!desiredRows.length) return { ok: true, created: 0, idempotent: 0, rows: [] };

    // Fast path: PostgREST inserts an array in one transaction. If a previous
    // attempt partially completed, reconcile and insert only the missing rows.
    let bulk;
    try {
      bulk = await deps.insertRow(ROW_TABLE, desiredRows, options);
    } catch (error) {
      bulk = { ok: false, mode: "write_threw", error: { code: error?.code || "write_threw" } };
    }
    if (writeSucceeded(bulk)) {
      return { ok: true, created: desiredRows.length, idempotent: 0, rows: desiredRows.map(hydrateRow) };
    }

    const saved = [];
    let created = 0;
    let idempotent = 0;
    for (const desired of desiredRows) {
      let current = await loadRawRow(desired.row_id, options);
      let outcome;
      if (current.ok && current.row) {
        const sameIdentity = current.row.batch_id === desired.batch_id
          && current.row.prospect_id === desired.prospect_id
          && integer(current.row.row_index, -1) === desired.row_index;
        outcome = sameIdentity
          ? { ok: true, created: false, idempotent: true, row: current.row }
          : { ok: false, conflict: true, error: "row_identity_conflict" };
      } else {
        outcome = await insertOneRow(desired, options);
      }
      if (!outcome.ok) return { ...outcome, rows: saved.map(hydrateRow) };
      saved.push(outcome.row);
      if (outcome.created) created += 1;
      else idempotent += 1;
    }
    return { ok: true, created, idempotent, rows: saved.map(hydrateRow) };
  }

  async function storeBatch({ batchId, expectedVersion, expectedStatus, patch } = {}, options = {}) {
    const id = identityText(batchId, 160);
    const version = integer(expectedVersion, -1);
    if (!id) return { ok: false, error: "batch_id_required" };
    if (version < 0) return { ok: false, error: "expected_version_required" };
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "batch_patch_required" };
    const translated = {};
    for (const [key, value] of Object.entries(patch)) {
      const column = SAFE_BATCH_PATCHES[key];
      if (!column) return { ok: false, error: `unsafe_batch_patch:${key}` };
      translated[column] = ["mine_funnel", "approval"].includes(column)
        ? sanitizeRowPayload(value)
        : typeof value === "string" ? text(value, 1000) : value;
    }
    if (translated.status && !BATCH_STATUSES.includes(translated.status)) return { ok: false, error: "invalid_batch_status" };
    if (translated.pick_state && !PICK_STATES.includes(translated.pick_state)) return { ok: false, error: "invalid_pick_state" };
    const mutationToken = deps.randomUUID();
    translated.version = version + 1;
    translated.mutation_token = mutationToken;
    translated.updated_at = nowIso();
    const guards = { version: `eq.${version}` };
    if (expectedStatus) guards.status = `eq.${text(expectedStatus, 40)}`;

    let result;
    try {
      result = await deps.conditionalUpdate(BATCH_TABLE, "batch_id", id, guards, translated, options);
    } catch (error) {
      result = { ok: false, mode: "update_threw", error: { code: error?.code || "update_threw" } };
    }
    if (updateSucceeded(result)) {
      return { ok: true, updated: true, idempotent: false, batch: hydrateBatch(rowsFrom(result)[0] || { ...translated, batch_id: id }) };
    }
    const current = await loadRawBatch(id, options);
    if (current.ok && current.row) {
      const committed = Object.entries(translated)
        .filter(([key]) => key !== "updated_at")
        .every(([key, value]) => equivalent(current.row[key], value));
      if (committed) {
        return { ok: true, updated: false, idempotent: true, alreadyApplied: true, batch: hydrateBatch(current.row) };
      }
    }
    return {
      ok: false,
      conflict: !isOperationalFailure(result),
      error: isOperationalFailure(result) ? errorCode(result, "batch_store_failed") : "batch_version_conflict",
    };
  }

  /**
   * Atomically halt one exact canonical batch without touching its rows.
   * A repeated request is a true no-op: it returns the first durable halt
   * reason/time and never creates a second audit mutation or version bump.
   */
  async function haltBatch({ batchId, expectedVersion, expectedStatus, reason } = {}, options = {}) {
    const id = identityText(batchId, 160);
    const version = integer(expectedVersion, -1);
    const fromStatus = text(expectedStatus, 40);
    const haltReason = String(reason || "").trim().toLowerCase();
    if (!id) return { ok: false, error: "batch_id_required" };
    if (version < 0) return { ok: false, error: "expected_version_required" };
    if (!BATCH_STATUSES.includes(fromStatus)) return { ok: false, error: "expected_status_required" };
    if (!HALT_REASON_PATTERN.test(haltReason)) return { ok: false, error: "halt_reason_invalid" };

    // Read first so retries after a committed/lost response remain no-ops and
    // retain the original halt evidence rather than overwriting it.
    const before = await loadRawBatch(id, options);
    if (!before.ok) return before;
    if (!before.row) return { ok: false, error: "batch_not_found" };
    if (before.row.status === "halted") {
      return {
        ok: true,
        updated: false,
        idempotent: true,
        alreadyApplied: true,
        batch: hydrateBatch(before.row),
      };
    }
    if (before.row.status === "done") {
      return { ok: false, conflict: true, error: "batch_already_done", batch: hydrateBatch(before.row) };
    }
    if (integer(before.row.version, -1) !== version || before.row.status !== fromStatus) {
      return { ok: false, conflict: true, error: "batch_halt_conflict", batch: hydrateBatch(before.row) };
    }

    const at = nowIso();
    const mutationToken = deps.randomUUID();
    const patch = {
      status: "halted",
      pick_state: "complete",
      halt_reason: haltReason,
      settled_at: at,
      version: version + 1,
      mutation_token: mutationToken,
      updated_at: at,
    };
    let result;
    try {
      result = await deps.conditionalUpdate(BATCH_TABLE, "batch_id", id, {
        version: `eq.${version}`,
        status: `eq.${fromStatus}`,
      }, patch, options);
    } catch (error) {
      result = { ok: false, mode: "update_threw", error: { code: error?.code || "update_threw" } };
    }
    if (updateSucceeded(result)) {
      return {
        ok: true,
        updated: true,
        idempotent: false,
        batch: hydrateBatch(rowsFrom(result)[0] || { ...before.row, ...patch }),
      };
    }

    // The write can commit even when its response is lost. Any durable halt
    // wins and its original evidence is returned; no follow-up write occurs.
    const current = await loadRawBatch(id, options);
    if (current.ok && current.row?.status === "halted") {
      return {
        ok: true,
        updated: false,
        idempotent: true,
        alreadyApplied: true,
        batch: hydrateBatch(current.row),
      };
    }
    return {
      ok: false,
      conflict: !isOperationalFailure(result),
      error: isOperationalFailure(result) ? errorCode(result, "batch_halt_failed") : "batch_halt_conflict",
      ...(current.ok && current.row ? { batch: hydrateBatch(current.row) } : {}),
    };
  }

  // STALE-LEASE RECLAMATION. A lease whose holder has not moved the row this
  // long is dead. The line-batch-sweeper applies the same 10-minute law
  // (JAMMED_ROW_MS): a row moved less than 10 minutes ago is presumed working
  // (main's issue-#384 contract), never swept. Every durable write (claim,
  // checkpoint, release) stamps updated_at, so updated_at IS the holder's
  // heartbeat, and no live holder can exist behind it: builds take 1-2 minutes
  // per row and vercel.json caps every function at 300s, while the longest
  // lease (leaseMs <= 900s) is fully inside the window. Measured live
  // (2026-09-02, smoke batch line_mtl0s1bf): a gate_passed row sat ready on a
  // dead holder's unexpired lease and refused `row_claim_failed:claim_lost`
  // on two drain_emails passes 9 minutes apart — the claim CAS lost to a
  // corpse. Past the window the claim wins regardless of the held token.
  const STALE_LEASE_MS = 10 * 60 * 1000;

  async function claimRows({ batchId, rowId, expectedVersion, workerId, limit = 1, leaseMs = 240_000, statuses } = {}, options = {}) {
    const id = identityText(batchId, 160);
    const suppliedRowId = String(rowId || "").trim();
    const exactRowId = EXACT_ROW_ID_PATTERN.test(suppliedRowId) ? suppliedRowId : "";
    const exactVersion = expectedVersion == null ? null : integer(expectedVersion, -1);
    const owner = text(workerId, 160);
    if (!id) return { ok: false, error: "batch_id_required", rows: [] };
    if (suppliedRowId && !exactRowId) return { ok: false, error: "row_id_invalid", rows: [] };
    if (expectedVersion != null && exactVersion < 0) return { ok: false, error: "expected_version_invalid", rows: [] };
    if (exactVersion != null && !exactRowId) return { ok: false, error: "expected_version_requires_row_id", rows: [] };
    if (!owner) return { ok: false, error: "worker_id_required", rows: [] };
    const wanted = (Array.isArray(statuses) && statuses.length ? statuses : RESUMABLE_ROW_STATUSES)
      .filter((status, index, all) => CLAIMABLE_ROW_STATUSES.includes(status) && all.indexOf(status) === index);
    if (!wanted.length) return { ok: false, error: "no_resumable_statuses", rows: [] };
    const rowLimit = positiveInteger(limit, 1, 100);
    const now = nowIso();
    const leaseUntil = new Date(new Date(now).getTime() + positiveInteger(leaseMs, 240_000, 900_000)).toISOString();
    // Eligible = no lease at all, an EXPIRED lease, or a stale holder (row not
    // moved for STALE_LEASE_MS — covers both a future-dated lease whose worker
    // died and the anomalous token-without-expiry row, whose staleness clock
    // runs from claimed_at; claim stamps updated_at, so updated_at is that
    // stamp). A fresh lease stays protected: recent movement means a live
    // worker, so the staleness disjunct can never double-claim one. The same
    // expression guards the write CAS, so staleness is re-verified atomically
    // at claim time — two reclaimers race, exactly one lease wins.
    const nowMs = Date.parse(now);
    const staleBefore = Number.isFinite(nowMs) && nowMs > STALE_LEASE_MS
      ? new Date(nowMs - STALE_LEASE_MS).toISOString()
      : "";
    const leaseEligibility = `(lease_token.is.null,lease_expires_at.lte.${now}${staleBefore ? `,updated_at.lte.${staleBefore}` : ""})`;
    const candidates = await readRows(ROW_TABLE, {
      select: "*",
      filter: `batch_id=eq.${encoded(id)}${exactRowId ? `&row_id=eq.${encoded(exactRowId)}` : ""}${exactVersion != null ? `&version=eq.${exactVersion}` : ""}&status=in.(${wanted.join(",")})&or=${encoded(leaseEligibility)}`,
      order: "row_index.asc",
      limit: exactRowId ? 1 : Math.min(rowLimit * 4, 400),
    }, options);
    if (!candidates.ok) return { ok: false, error: candidates.error, rows: [] };

    const claimed = [];
    let staleLeaseReclaimed = 0;
    for (const candidate of candidates.rows) {
      if (claimed.length >= rowLimit) break;
      const version = integer(candidate.version, 0);
      // Keep the exact-generation guard local as well as in the datastore
      // filter. A stale/redelivered row message must never lease a newer phase,
      // even if a test double or future storage adapter applies filters loosely.
      if (exactVersion != null && version !== exactVersion) continue;
      // A candidate that held a NEITHER-absent-NOR-expired lease was taken via
      // the staleness disjunct: a dead holder's lease was taken over, not a
      // free row claimed. Reported per call as stale_lease_reclaimed.
      const heldLease = String(candidate.lease_token || "").trim() !== "";
      const leaseExpired = candidate.lease_expires_at != null
        && Number.isFinite(Date.parse(candidate.lease_expires_at))
        && Date.parse(candidate.lease_expires_at) <= nowMs;
      const staleReclaim = heldLease && !leaseExpired;
      const leaseToken = deps.randomUUID();
      const patch = {
        lease_token: leaseToken,
        lease_owner: owner,
        lease_expires_at: leaseUntil,
        mutation_token: leaseToken,
        attempt_count: Math.max(integer(candidate.attempt_count, 0), 0) + 1,
        version: version + 1,
        updated_at: now,
      };
      const guards = {
        batch_id: `eq.${id}`,
        version: `eq.${version}`,
        status: `eq.${candidate.status}`,
        or: leaseEligibility,
      };
      let result;
      try {
        result = await deps.conditionalUpdate(ROW_TABLE, "row_id", candidate.row_id, guards, patch, options);
      } catch (error) {
        result = { ok: false, mode: "update_threw", error: { code: error?.code || "update_threw" } };
      }
      if (updateSucceeded(result)) {
        if (staleReclaim) staleLeaseReclaimed += 1;
        claimed.push(hydrateRow(rowsFrom(result)[0] || { ...candidate, ...patch }));
        continue;
      }
      const current = await loadRawRow(candidate.row_id, options);
      if (current.ok && current.row?.lease_token === leaseToken) {
        // The write committed even though its response was lost — the (stale)
        // prior holder did lose this lease to us either way.
        if (staleReclaim) staleLeaseReclaimed += 1;
        claimed.push(hydrateRow(current.row));
        continue;
      }
      if (isOperationalFailure(result)) {
        return { ok: false, error: errorCode(result, "row_claim_failed"), rows: claimed };
      }
      // Another worker won this row. Continue to the next candidate.
    }
    return { ok: true, rows: claimed, leaseExpiresAt: leaseUntil, staleLeaseReclaimed };
  }

  async function checkpointRow({
    rowId,
    leaseToken,
    expectedVersion,
    expectedStatus,
    row,
    releaseLease = true,
  } = {}, options = {}) {
    const id = identityText(rowId, 300);
    const token = leaseTokenText(leaseToken);
    const version = integer(expectedVersion, -1);
    const fromStatus = text(expectedStatus, 40);
    const nextStatus = row?.status;
    if (!id || !token) return { ok: false, error: "row_lease_identity_required" };
    if (version < 0) return { ok: false, error: "expected_version_required" };
    if (!ROW_STATUSES.includes(fromStatus) || !ROW_STATUSES.includes(nextStatus)) {
      return { ok: false, error: "valid_row_states_required" };
    }
    const now = nowIso();
    const desiredPayload = payloadOnly({ ...row, status: nextStatus });
    const logoSha256 = normalizedLogo(row?.logoSha256 || row?.logo_sha256 || row?.captured?.logoSha256);
    const mutationToken = deps.randomUUID();
    const patch = {
      status: nextStatus,
      payload: desiredPayload,
      version: version + 1,
      mutation_token: mutationToken,
      logo_sha256: logoSha256,
      last_retryable_error: row?.lastRetryableError || row?.last_retryable_error
        ? text(row.lastRetryableError || row.last_retryable_error, 1000)
        : null,
      terminal_at: TERMINAL_ROW_STATUSES.has(nextStatus)
        ? isoDate(row?.terminalAt || row?.terminal_at, now)
        : null,
      updated_at: now,
      ...(releaseLease ? { lease_token: null, lease_owner: null, lease_expires_at: null } : {}),
    };
    const guards = {
      version: `eq.${version}`,
      lease_token: `eq.${token}`,
      lease_expires_at: `gt.${now}`,
      status: `eq.${fromStatus}`,
    };
    let result;
    try {
      result = await deps.conditionalUpdate(ROW_TABLE, "row_id", id, guards, patch, options);
    } catch (error) {
      result = { ok: false, mode: "update_threw", error: { code: error?.code || "update_threw" } };
    }
    if (updateSucceeded(result)) {
      return { ok: true, updated: true, idempotent: false, row: hydrateRow(rowsFrom(result)[0] || { ...row, ...patch, row_id: id }) };
    }

    const current = await loadRawRow(id, options);
    if (current.ok && current.row) {
      const alreadyCommitted = integer(current.row.version, 0) >= version + 1
        && current.row.status === nextStatus
        && equivalent(current.row.payload || {}, desiredPayload)
        && (current.row.logo_sha256 || null) === logoSha256
        && (!releaseLease || current.row.lease_token === null);
      if (alreadyCommitted) {
        return { ok: true, updated: false, idempotent: true, alreadyApplied: true, row: hydrateRow(current.row) };
      }
    }
    return {
      ok: false,
      conflict: !isOperationalFailure(result),
      error: isOperationalFailure(result) ? errorCode(result, "row_checkpoint_failed") : "row_checkpoint_conflict",
    };
  }

  async function releaseRow({ rowId, leaseToken, expectedVersion, expectedStatus } = {}, options = {}) {
    const id = identityText(rowId, 300);
    const token = leaseTokenText(leaseToken);
    const version = integer(expectedVersion, -1);
    if (!id || !token) return { ok: false, error: "row_lease_identity_required" };
    if (version < 0) return { ok: false, error: "expected_version_required" };
    const mutationToken = deps.randomUUID();
    const patch = {
      lease_token: null,
      lease_owner: null,
      lease_expires_at: null,
      version: version + 1,
      mutation_token: mutationToken,
      updated_at: nowIso(),
    };
    const guards = { version: `eq.${version}`, lease_token: `eq.${token}` };
    if (expectedStatus) guards.status = `eq.${text(expectedStatus, 40)}`;
    let result;
    try {
      result = await deps.conditionalUpdate(ROW_TABLE, "row_id", id, guards, patch, options);
    } catch (error) {
      result = { ok: false, mode: "update_threw", error: { code: error?.code || "update_threw" } };
    }
    if (updateSucceeded(result)) {
      return { ok: true, updated: true, idempotent: false, row: hydrateRow(rowsFrom(result)[0]) };
    }
    const current = await loadRawRow(id, options);
    if (current.ok && current.row
      && integer(current.row.version, 0) >= version + 1
      && current.row.lease_token === null
      && (!expectedStatus || current.row.status === expectedStatus)) {
      return { ok: true, updated: false, idempotent: true, alreadyApplied: true, row: hydrateRow(current.row) };
    }
    return {
      ok: false,
      conflict: !isOperationalFailure(result),
      error: isOperationalFailure(result) ? errorCode(result, "row_release_failed") : "row_release_conflict",
    };
  }

  async function approveBatch({
    batchId,
    expectedVersion,
    typedBatchId,
    actor = "operator",
    approvedRows,
  } = {}, options = {}) {
    const id = identityText(batchId, 160);
    const typed = identityText(typedBatchId, 160);
    const version = integer(expectedVersion, -1);
    const count = integer(approvedRows, 0);
    if (!id || typed !== id) return { ok: false, error: "approval_confirmation_mismatch" };
    if (version < 0) return { ok: false, error: "expected_version_required" };
    if (count < 1) return { ok: false, error: "nothing_passed_the_render_gate" };
    const at = nowIso();
    const approval = sanitizeRowPayload({ actor: text(actor, 160), at, approvedRows: count, typedBatchId: id });
    const mutationToken = deps.randomUUID();
    const patch = { status: "approved", approval, version: version + 1, mutation_token: mutationToken, updated_at: at };
    let result;
    try {
      result = await deps.conditionalUpdate(BATCH_TABLE, "batch_id", id, {
        version: `eq.${version}`,
        status: "eq.awaiting_approval",
      }, patch, options);
    } catch (error) {
      result = { ok: false, mode: "update_threw", error: { code: error?.code || "update_threw" } };
    }
    if (updateSucceeded(result)) {
      return { ok: true, updated: true, idempotent: false, batch: hydrateBatch(rowsFrom(result)[0] || { ...patch, batch_id: id }) };
    }
    const current = await loadRawBatch(id, options);
    const currentApproval = current.ok && current.row && current.row.approval;
    if (current.ok && current.row
      && ["approved", "sending", "done"].includes(current.row.status)
      && currentApproval
      && String(currentApproval.typedBatchId || "") === id
      && String(currentApproval.actor || "") === String(approval.actor || "")
      && integer(currentApproval.approvedRows, 0) === count) {
      return { ok: true, updated: false, idempotent: true, alreadyApplied: true, batch: hydrateBatch(current.row) };
    }
    // DONE-WITH-QUEUED REAPPROVAL — sandbox lane only. A settled `done` batch
    // can still own `queued` rows when its last send pass stranded them (the
    // rescue scan skips done batches, so nothing else will ever re-drive them).
    // The operator must re-type the exact batch id (checked above) and the
    // caller must pass a durable queued count >= 1 (checked above); the live
    // lane keeps its typed-approval law and never reopens here. The version
    // guard keeps exactly one reopener; the send phase re-verifies every row
    // and re-settles the batch if none of them remain claimable.
    if (current.ok && current.row
      && current.row.status === "done"
      && String(current.row.lane || "") === "sandbox") {
      try {
        result = await deps.conditionalUpdate(BATCH_TABLE, "batch_id", id, {
          version: `eq.${version}`,
          status: "eq.done",
        }, patch, options);
      } catch (error) {
        result = { ok: false, mode: "update_threw", error: { code: error?.code || "update_threw" } };
      }
      if (updateSucceeded(result)) {
        return { ok: true, updated: true, idempotent: false, reapproved: true, batch: hydrateBatch(rowsFrom(result)[0] || { ...patch, batch_id: id }) };
      }
    }
    return {
      ok: false,
      conflict: !isOperationalFailure(result),
      error: isOperationalFailure(result) ? errorCode(result, "batch_approval_failed") : "batch_approval_conflict",
    };
  }

  return {
    createBatch,
    loadBatch,
    listBatches,
    storeBatch,
    haltBatch,
    storeRows,
    claimRows,
    checkpointRow,
    releaseRow,
    approveBatch,
  };
}

const defaults = createLinePersistence();

module.exports = {
  BATCH_TABLE,
  ROW_TABLE,
  BATCH_STATUSES,
  ROW_STATUSES,
  RESUMABLE_ROW_STATUSES,
  CLAIMABLE_ROW_STATUSES,
  EXPLICIT_PROSPECT_STAGE,
  EXPLICIT_PROSPECT_TARGET,
  explicitProspectFingerprint,
  createExplicitProspectMarker,
  readExplicitProspectMarker,
  sanitizeRowPayload,
  // Exposed read-only so /api/admin/release-verify-probe can load a stored
  // row payload into the exact hydrated shape the sender drains.
  hydrateRow,
  createLinePersistence,
  ...defaults,
};
