"use strict";

const { boundedDetailText } = require("./detail-text");

const { createHash } = require("node:crypto");
const { mapWithConcurrency, poolSize } = require("./intake-pool");

/**
 * lib/line-adapters.js — the production wiring between the operator line and
 * the machinery that already exists.
 *
 * These are deliberately thin. Each one either returns a real result or
 * REFUSES with a reason the operator can read. None of them invents a fact:
 * where a value is not verified it is left ABSENT, and the render gate then
 * fails that row — which is the correct, visible outcome, not a silent pass.
 */

const { selectRows, select, insertRow, upsertRow, conditionalUpdate } = require("./store");
const { canonicalJson: canonicalPageHubJson, readPageHubBuildPacket } = require("./pagehub-build-packet");
const { fleetFingerprint, deterministicUuid } = require("./mirror-fleet-identity");
const { mineLeads, resolveBuildableDonor, isPlaceholderEmail } = require("./lead-miner");
const { requestedDeepBatchDepth, lineResumeCap } = require("./line-quota");
const { normalizeEmail, contactSendGate } = require("./contact-enrichment");
const { brandTruthFromEvidence, prospectFromRow, prospectId, firstValue, verifiedBrandOf } = require("./prospects");
const { approvedIndustry } = require("./copilot");
const { inferTrade } = require("./trade-inference");
const { normalizeUsLocation, stateCode } = require("./public-data");
const { sanitizePreviewUrl } = require("./preview-host-guard");
const paydirtSource = require("./prospect-sources/paydirt");
const photoBank = require("./client-photo-bank");
const {
  getHeroReelJobForProspect,
  legacySiteUrl: heroLegacySiteUrl,
  normalizedPhotoBank: normalizedHeroPhotoBank,
  PRACTICE_STATIC_SEAL_REASON,
  PRACTICE_STATIC_SEAL_SCHEMA,
  sealForeignTerminalForPracticeStatic,
  verifiedPracticeStaticSeal,
} = require("./hero-reel-job-queue");
const { getRebuildJob } = require("./rebuild-jobs");
const { normalizeLineHandle } = require("./line-hero-wakeup");
const { validatedLineHeroRebuild, validatedPersistedDispatch, recoveredBuild } = require("./line-persisted-mirror");
const { pickHeroPhoto } = require("./hero-wash");
const { sharedHeroEvidenceFromRow } = require("./shared-site-hero-injection");
const { orderCandidates } = require("./mirror-engine/queue-ordering");
const { createExplicitProspectMarker } = require("./line-persistence");
const { pickNamePlausible, stripTitleTagPrefix, PICK_NAME_IMPLAUSIBLE, NATIONAL_CHAIN_EXCLUDED, isNationalChainName } = require("./pick-name-plausibility");
const { DONOR_EXCLUSION_CAUSE } = require("./donor-exclusions");
const {
  callIntakeGenie,
  createContentCertification,
  durableTruthServiceEvidence,
  retainSourceBoundServices,
  verifyContentCertification,
} = require("./intake-genie-client");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("./siteforge");

const PROSPECTS = "ghost_agency_prospects";
const PRACTICE_IDENTITY_EVENT = "line.practice_identity_claim";
const SPORT_FENCING_HOLD_REASON = "vertical_mismatch_sport_fencing";
const GENIE_PIPELINE_VERSION = "line-genie-certified-v7";
const GENIE_RECEIPT_CONTRACT_VERSION = "ghost-line-genie-receipt-v7";
const SAFE_HERO_PRODUCERS = new Set([
  "ads_image_to_video",
  "wan2_i2v_local",
  "openrouter_seedance",
  "hero_compose_local",
]);
const RETIRED_HERO_PRODUCER = "ads_image_to_video";
const DEFINITIVE_HERO_REFUSAL_REASONS = new Set([
  "no_verified_owned_photo",
  "no_verified_owned_real_scene",
  "photo_bank_stale_or_missing",
  // The only owned real-scene photo is permanently unusable as a hero source
  // (aspect outside the hero contract). Retrying can never succeed — the site
  // ships on the donor's fallback rung without video instead of stranding.
  "source_image_hero_aspect_invalid",
]);
// Keep this identical to the queue's one-shot same-build recovery allowlist.
// The adapter decides whether a foreign terminal verdict may reach that CAS;
// the queue remains the final atomic authority.
const REPAIRABLE_SAME_BUILD_HERO_REASONS = new Set([
  "no_verified_owned_real_scene",
  "source_sha256_mismatch",
  "photo_bank_stale_or_missing",
]);
const SEEDANCE_CHECKPOINT_SCHEMA = "wss.hero.seedance_provider_checkpoint.v1";
const SEEDANCE_MODEL_ID = "bytedance/seedance-2.0-mini";
const SEEDANCE_DURATION_SECONDS = new Set([4, 8]);
const MAX_SEEDANCE_SOURCE_BYTES = 25 * 1024 * 1024;
const SANDBOX_STATIC_HERO_FALLBACK_REASON = "sandbox_video_retries_exhausted_static_hero_verified";
const SANDBOX_FOREIGN_STATIC_HERO_FALLBACK_REASON = "sandbox_foreign_video_terminal_static_hero_verified";
const SANDBOX_FOREIGN_CHECKPOINT_STATIC_HERO_FALLBACK_REASON = "sandbox_foreign_submit_rejected_static_hero_verified";
const FOREIGN_STATIC_HERO_JOB_BINDING_SCHEMA = "wss.line.static_hero_foreign_job.v1";
const FOREIGN_CHECKPOINT_STATIC_HERO_JOB_BINDING_SCHEMA = "wss.line.static_hero_foreign_checkpoint_job.v1";
const CAPABILITY_NO_CHECKPOINT_REASON = "hero_capability_unrenewed_no_checkpoint";
const CAPABILITY_BUDGET_EXHAUSTED_BY = "provider_spend_uncertain";
const FOREIGN_HANDLE_CONSUMPTION_REASON = "foreign_terminal_job_consumed";
const FOREIGN_CHECKPOINT_OBSERVATION_REASON = "foreign_submit_rejection_observed_read_only";
const SANDBOX_OPERATIONAL_HERO_FAILURE_REASONS = new Set([
  "openrouter_submit_failed",
  "openrouter_download_failed",
  "boomerang_ffmpeg_missing",
  "boomerang_ffmpeg_timeout",
  CAPABILITY_NO_CHECKPOINT_REASON,
]);
const SANDBOX_OPERATIONAL_HERO_FAILURE_PATTERNS = [
  /EPROTO/i,
  /SSL/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /^seedance_clip_transcode_(?:unavailable|timeout|failed|empty)$/,
  /^seedance_transcode_(?:clip_too_large|output[_-]invalid)$/,
];
// These watchdog verdicts are unambiguously worker-liveness failures. Do not
// admit hero_stale_failure_max_attempts here: that sentinel erases the source
// reason and may therefore hide clip_dimensions_out_of_range (asset failure).
const SANDBOX_OPERATIONAL_HERO_MAX_REASONS = new Set([
  "hero_lease_expired_max_attempts",
  "hero_lost_settle_max_attempts",
  CAPABILITY_NO_CHECKPOINT_REASON,
]);
const VERIFIED_STATIC_HERO_SOURCES = new Set([
  "client_current_hero",
  "identity_portrait",
  "photo_bank",
  "first_usable_photo",
]);

function safeHeroProducer(value) {
  const producer = String(value || "").trim().toLowerCase();
  return SAFE_HERO_PRODUCERS.has(producer) ? producer : "";
}

function practiceIdentity(row = {}) {
  const rec = recordOf(row);
  const prospectId = String(row.prospect_id || row.prospectId || rec.prospect_id || rec.prospectId || "").trim();
  const siteSlug = String(row.site_slug || row.siteSlug || rec.site_slug || rec.siteSlug || "").trim().toLowerCase();
  const businessName = String(row.business_name || row.businessName || rec.business_name || rec.businessName || "").trim();
  const city = String(row.city || rec.city || "").trim();
  const fingerprint = fleetFingerprint(businessName, city);
  const hosts = [];
  for (const raw of [row.canonical_host, row.canonicalHost, row.canonical_domain, row.canonicalDomain,
    rec.canonical_host, rec.canonicalHost, rec.canonical_domain, rec.canonicalDomain,
    row.preview_url, row.previewUrl, rec.preview_url, rec.previewUrl,
    row.current_website, row.currentWebsite, rec.current_website, rec.currentWebsite]) {
    try {
      const value = String(raw || "").trim();
      if (!value) continue;
      const parsed = new URL(value.includes("://") ? value : `https://${value}`);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
        if (host) hosts.push(host);
      }
    } catch { /* absent or malformed source URL is handled by existing gates */ }
  }
  const canonicalHost = hosts.find((host) => host === "wss-ai.com" || host.endsWith(".wss-ai.com")) || hosts[0] || "";
  const keys = [
    prospectId ? `prospect:${prospectId.toLowerCase()}` : "",
    fingerprint ? `business:${fingerprint}` : "",
  ].filter(Boolean).sort();
  return { prospectId, siteSlug, businessName, city, fingerprint, canonicalHost, keys };
}

function historicalPracticeIdentities(rows = []) {
  const keys = new Set();
  for (const raw of rows) {
    const payload = raw?.payload && typeof raw.payload === "object" ? raw.payload : {};
    const identity = practiceIdentity({ ...payload, prospect_id: raw?.prospect_id || payload.prospectId || payload.prospect_id });
    for (const key of identity.keys) keys.add(key);
  }
  return keys;
}

// PRACTICE HISTORY READ HARDENING (batch line_mtolbe4s, 2026-09-04). The scan
// used to page through EVERY sandbox batch ever created and then EVERY batch
// row's FULL payload. As campaign history accumulated (15+ campaigns, hundreds
// of rows carrying heavy release/brand evidence payloads) the read set grew
// unboundedly, Supabase timed out, `ok` came back false, and the WHOLE history
// read failed — mass-refusing every row of every new sandbox batch with
// practice_history_read_failed (8 of 9 rows dead on live batch
// line_mtolbe4s_b4d88b9589). Three hardenings, one law: a history read outage
// must never kill a batch.
//   RETRY — every page read takes 3 retries with 2s/5s/10s backoff (abort- and
//   deadline-aware; inject `sleep` via requestOptions for tests).
//   NARROW — the identity check consumes only prospect_id (a dedicated column
//   storeRows refuses to omit) plus business_name/city inside the payload
//   JSON, so the read selects those JSON paths instead of the full
//   multi-hundred-KB payload. Raw `->>`/`->>` JSON-path operators in the REST
//   query are an existing production pattern (record->>truth_packet_source
//   filters in line-continuation).
//   BOUND — PRACTICE_HISTORY_LOOKBACK_DAYS caps how far back the scan reaches
//   (line-quota dial idiom; default 90, ceiling 3650, invalid falls to the
//   default). Identity dedupe against the recent window is the practical
//   business need; older collisions stay blocked by the durable claim events
//   (claimPracticeIdentity writes a global unique event per identity key), so
//   the window narrows only the belt-and-suspenders row scan.
const PRACTICE_HISTORY_LOOKBACK_ENV = "PRACTICE_HISTORY_LOOKBACK_DAYS";
const PRACTICE_HISTORY_LOOKBACK_DEFAULT_DAYS = 90;
const PRACTICE_HISTORY_LOOKBACK_CEILING_DAYS = 3650;
const PRACTICE_HISTORY_RETRY_DELAYS_MS = Object.freeze([2000, 5000, 10000]);
const PRACTICE_HISTORY_DEGRADED_REASON = "practice_history_unavailable:degraded";
// Aliased JSON-path projections of exactly the fields historicalPracticeIdentities
// consumes; rebuilt into the { prospect_id, payload } shape it reads by
// narrowedPracticeIdentityRow below.
const PRACTICE_IDENTITY_ROW_SELECT = [
  "prospect_id",
  "business_name:payload->>business_name",
  "businessName:payload->>businessName",
  "city:payload->>city",
  "record_business_name:payload->record->>business_name",
  "record_businessName:payload->record->>businessName",
  "record_city:payload->record->>city",
].join(",");

function practiceHistoryLookbackDays(environment = process.env) {
  const raw = Number(String((environment && environment[PRACTICE_HISTORY_LOOKBACK_ENV]) ?? "").trim());
  if (!Number.isInteger(raw) || raw < 1) return PRACTICE_HISTORY_LOOKBACK_DEFAULT_DAYS;
  return Math.min(raw, PRACTICE_HISTORY_LOOKBACK_CEILING_DAYS);
}

// Rebuild the narrowed row into the { prospect_id, payload } shape
// historicalPracticeIdentities already consumes, so the identity math stays
// byte-identical to the old full-payload read.
function narrowedPracticeIdentityRow(raw = {}) {
  const text = (value) => {
    const normalized = String(value ?? "").trim();
    return normalized || undefined;
  };
  const payload = {};
  for (const [key, value] of [
    ["business_name", text(raw.business_name)],
    ["businessName", text(raw.businessName)],
    ["city", text(raw.city)],
  ]) {
    if (value !== undefined) payload[key] = value;
  }
  const record = {};
  for (const [key, value] of [
    ["business_name", text(raw.record_business_name)],
    ["businessName", text(raw.record_businessName)],
    ["city", text(raw.record_city)],
  ]) {
    if (value !== undefined) record[key] = value;
  }
  if (Object.keys(record).length) payload.record = record;
  return { prospect_id: raw.prospect_id, payload };
}

function degradedPracticeHistory() {
  return { ok: true, degraded: true, reason: PRACTICE_HISTORY_DEGRADED_REASON, keys: new Set() };
}

// One paged read of the practice-history chain with 3 retries (2s/5s/10s).
// Abort/deadline expiry is NOT retried — a run out of time must stop, not wait.
async function readPracticeHistoryPage(read, table, query, requestOptions, interrupted) {
  for (let attempt = 0; ; attempt += 1) {
    if (interrupted()) return { aborted: true };
    let result = null;
    try {
      result = await read(table, query, requestOptions);
    } catch {
      result = null;
    }
    if (result?.ok === true && Array.isArray(result.data)) return { ok: true, data: result.data };
    if (interrupted()) return { aborted: true };
    if (attempt >= PRACTICE_HISTORY_RETRY_DELAYS_MS.length) return { ok: false };
    const delay = PRACTICE_HISTORY_RETRY_DELAYS_MS[attempt];
    if (typeof requestOptions.sleep === "function") await requestOptions.sleep(delay);
    else await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function readAllPracticeHistory(read = select, requestOptions = {}) {
  const interrupted = () => requestOptions.signal?.aborted === true
    || (Number.isFinite(Date.parse(String(requestOptions.deadlineAt || "")))
      && Date.now() >= Date.parse(String(requestOptions.deadlineAt)));
  if (interrupted()) return { ok: false, reason: "practice_history_read_aborted" };
  const lookbackDays = practiceHistoryLookbackDays();
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const windowQuery = `&created_at=gte.${encodeURIComponent(cutoff)}`;
  const batchIds = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await readPracticeHistoryPage(
      read,
      "ghost_agency_line_batches",
      `?select=batch_id&lane=eq.sandbox&order=created_at.asc&limit=1000&offset=${offset}${windowQuery}`,
      requestOptions,
      interrupted,
    );
    if (page.aborted || interrupted()) return { ok: false, reason: "practice_history_read_aborted" };
    if (!page.ok) return degradedPracticeHistory();
    batchIds.push(...page.data.map((entry) => String(entry?.batch_id || "")).filter(Boolean));
    if (page.data.length < 1000) break;
  }
  const historyRows = [];
  for (let start = 0; start < batchIds.length; start += 100) {
    const ids = batchIds.slice(start, start + 100).map((id) => `"${id.replace(/"/g, "\\\"")}"`).join(",");
    for (let offset = 0; ; offset += 1000) {
      const page = await readPracticeHistoryPage(
        read,
        "ghost_agency_line_batch_rows",
        `?select=${PRACTICE_IDENTITY_ROW_SELECT}&batch_id=in.(${ids})&order=created_at.asc&limit=1000&offset=${offset}`,
        requestOptions,
        interrupted,
      );
      if (page.aborted || interrupted()) return { ok: false, reason: "practice_history_read_aborted" };
      if (!page.ok) return degradedPracticeHistory();
      historyRows.push(...page.data.map((raw) => narrowedPracticeIdentityRow(raw)));
      if (page.data.length < 1000) break;
    }
  }
  return { ok: true, keys: historicalPracticeIdentities(historyRows), lookbackDays };
}

function practiceClaimSucceeded(result) {
  return result?.ok === true || result?.mode === "live_write";
}

function practiceClaimConflict(result) {
  const code = String(result?.error?.code || result?.error?.error?.code || "").toUpperCase();
  return result?.status === 409 || code === "23505" || result?.error?.category === "write_conflict";
}

async function claimPracticeIdentity(identity, { operationKey, write = insertRow, read = select, requestOptions = {} } = {}) {
  const op = String(operationKey || "").trim();
  if (!op || !identity?.keys?.length) return { ok: false, reason: "practice_identity_unclaimable" };
  for (const identityKey of identity.keys) {
    const id = deterministicUuid(`line.practice_identity:${identityKey}`);
    const event = {
      id,
      type: PRACTICE_IDENTITY_EVENT,
      payload: {
        identity_key: identityKey,
        operation_key: op,
        prospect_id: identity.prospectId,
        business_name: identity.businessName,
        city: identity.city,
        site_slug: identity.siteSlug,
        canonical_host: identity.canonicalHost,
      },
      created_at: new Date().toISOString(),
    };
    const inserted = await write("ghost_agency_events", event, requestOptions).catch(() => null);
    if (practiceClaimSucceeded(inserted)) continue;
    if (!practiceClaimConflict(inserted)) return { ok: false, reason: "practice_identity_claim_failed" };
    const existing = await read(
      "ghost_agency_events",
      `?select=id,type,payload&id=eq.${id}&type=eq.${PRACTICE_IDENTITY_EVENT}&limit=1`,
      requestOptions,
    ).catch(() => null);
    const stored = existing?.ok && Array.isArray(existing.data) ? existing.data[0] : null;
    if (stored?.type !== PRACTICE_IDENTITY_EVENT
      || String(stored?.payload?.identity_key || "") !== identityKey
      || String(stored?.payload?.operation_key || "") !== op) {
      return { ok: false, reason: "practice_identity_already_claimed" };
    }
  }
  return { ok: true };
}

async function practiceFreshnessVerdict(row, {
  lane = "sandbox",
  operationKey = "",
  historyKeys = new Set(),
  claim = claimPracticeIdentity,
  claimOptions = {},
} = {}) {
  if (lane !== "sandbox") return { ok: true };
  const identity = practiceIdentity(row);
  if (/^wss-test-/i.test(identity.prospectId)) return { ok: false, reason: "practice_freshness_prospect_id_generated" };
  if (/^wss-test-/i.test(identity.siteSlug)) return { ok: false, reason: "practice_freshness_site_slug_generated" };
  if (identity.canonicalHost === "wss-ai.com" || identity.canonicalHost.endsWith(".wss-ai.com")) {
    return { ok: false, reason: "practice_freshness_generated_host" };
  }
  if (!identity.prospectId || !identity.fingerprint) return { ok: false, reason: "practice_freshness_identity_incomplete" };
  if (identity.keys.some((key) => historyKeys.has(key))) return { ok: false, reason: "practice_identity_in_prior_history" };
  const claimed = await claim(identity, { operationKey, ...claimOptions });
  return claimed?.ok === true ? { ok: true, identity } : { ok: false, reason: claimed?.reason || "practice_identity_claim_failed" };
}

function clearlyAcceptedSeedanceCheckpoint(job = {}, prospectId = "", revision = 0) {
  const checkpoint = job.result?.provider_checkpoint;
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return false;
  const providerJobId = String(checkpoint.provider_job_id || "").trim();
  const sourceBytes = Number(checkpoint.source_bytes);
  const payloadDuration = Number(job.payload?.duration_seconds);
  const checkpointDuration = Number(checkpoint.duration_seconds);
  const frozenDuration = SEEDANCE_DURATION_SECONDS.has(payloadDuration)
    ? payloadDuration
    : checkpointDuration;
  let pollingUrl;
  try { pollingUrl = new URL(String(checkpoint.polling_url || "").trim()); } catch { return false; }
  return job.producer === "openrouter_seedance"
    && checkpoint.schema_version === SEEDANCE_CHECKPOINT_SCHEMA
    && checkpoint.submission_state === "accepted"
    && String(checkpoint.job_id || "") === String(job.jobId || job.job_id || "")
    && String(checkpoint.prospect_id || "") === String(prospectId || "")
    && Number(checkpoint.generation_revision) === Number(revision)
    && /^[a-f0-9]{64}$/i.test(String(checkpoint.source_sha256 || ""))
    && ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]
      .includes(String(checkpoint.source_mime || "").trim().toLowerCase())
    && Number.isInteger(sourceBytes)
    && sourceBytes > 0
    && sourceBytes <= MAX_SEEDANCE_SOURCE_BYTES
    && checkpoint.model_id === SEEDANCE_MODEL_ID
    && SEEDANCE_DURATION_SECONDS.has(frozenDuration)
    && checkpointDuration === frozenDuration
    && /^[a-f0-9]{64}$/i.test(String(checkpoint.intent_sha256 || ""))
    && Boolean(providerJobId)
    && pollingUrl.origin === "https://openrouter.ai"
    && pollingUrl.pathname.startsWith("/api/v1/videos/")
    && !pollingUrl.username
    && !pollingUrl.password
    && (!pollingUrl.port || pollingUrl.port === "443");
}

// How long a packet row sits out after a failed build before the leadminer
// pick will try it again. Long enough that ten Runs in one evening cannot
// burn ten identical failures on one row; short enough that a fixed engine
// picks the row back up by itself tomorrow.
const BUILD_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

function heroAutolineEnabled(env = process.env) {
  return ![
    env.GHOST_AGENCY_HERO_AUTOLINE,
    env.GHOST_AGENCY_HERO_REMMASTER,
    env.GHOST_AGENCY_HERO_REMASTER,
  ].some((value) => /^(0|false|off|no)$/i.test(String(value ?? "").trim()));
}

function recipientFingerprint(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

function recordOf(row = {}) {
  return row.record && typeof row.record === "object" ? row.record : {};
}

function genieCertifiedAdmissionEnabled(env = process.env) {
  return !/^(0|false|off|no)$/i.test(String(env.GHOST_AGENCY_GENIE_CERTIFIED_ADMISSION ?? "1").trim());
}

function contentCertificationKeyConfigured(options = {}, env = process.env) {
  return Boolean(String(options.certificationKey
    || env.INTAKE_GENIE_CERTIFICATION_KEY
    || "").trim());
}

// HTTP-200 compiler packets can still fail the local content receipt when the
// candidate's own identity or evidence is incomplete. Those row-bound gaps may
// quarantine that candidate in a non-exact pick. Structural response, signing,
// request/job, clock, and unknown failures remain global and halt the batch.
const CANDIDATE_LOCAL_CERTIFICATION_REASONS = new Set([
  "independent_identity_anchor_missing",
  "business_name_mismatch",
  "business_location_mismatch",
  // These comparisons bind one safe visitor-copy packet to this candidate.
  // Mixed structural or unsafe-copy reasons still fail the every() guard.
  "authorized_category_mismatch",
  "compiler_packet_category_mismatch",
  "source_bound_evidence_missing",
  "verified_service_evidence_missing",
  "services_missing",
  "source_set_missing",
  "source_set_prospect_mismatch",
]);

function candidateLocalCertificationFailure(reasons = []) {
  return Array.isArray(reasons)
    && reasons.length > 0
    && reasons.every((reason) => CANDIDATE_LOCAL_CERTIFICATION_REASONS.has(String(reason || "")));
}

function compilerProblems(value = {}) {
  const rows = Array.isArray(value?.problems)
    ? value.problems
    : (Array.isArray(value?.packet?.problems) ? value.packet.problems : []);
  return rows.slice(0, 12);
}

function compilerProblemDetail(value = {}) {
  const problems = compilerProblems(value);
  return problems.length ? { problems, detail: problems } : {};
}

function attachCompilerProblemDetail(error, value = {}) {
  const detail = compilerProblemDetail(value);
  if (detail.problems) {
    error.problems = detail.problems;
    error.detail = detail.detail;
  }
  return error;
}

// A client-abort compile failure carries its abort reason as `reason`. Only
// clearly-timeout classes count toward the in-batch slow-source rotation
// (fix for the 2026-09-02 line_mtkw4rlq_c830312fdd stall: all ten prospects
// died `intake_genie_timeout` at the 150s client budget while the Genie
// legally compiles toward 300s). HTTP 5xx/429 transients stay on the
// conservative 60s retry floor — those are service health, not source speed.
function compileTimeoutClassReason(reason) {
  const value = String(reason || "").trim();
  return value === "intake_genie_timeout"
    || value.startsWith("pick_timed_out_after_")
    || value === "This operation was aborted"
    || value === "abort_due_to_deadline"; // undici deadline abort label
}

// Partition one pick pass's compile results. A GLOBAL terminal failure
// (missing signing key, unconfigured compiler) always halts the pick. A
// TRANSIENT failure only halts the pick when it starved the WHOLE pass —
// one timed-out compile must not discard already-certified siblings and
// cost a full phase delay: the surviving rows ride out on the array and the
// quota refills the gap on the next pass (receipts make siblings free).
function compilePassOutcome(compiledRows) {
  const global = compiledRows.find((compiled) => compiled.ok !== true
    && compiled.retryable === false
    && compiled.candidateLocal !== true);
  if (global) return { kind: "global" };
  const retryable = compiledRows.filter((compiled) => compiled.ok !== true && compiled.retryable !== false);
  if (!retryable.length) return { kind: "clean" };
  const certified = compiledRows.length - retryable.length;
  if (certified < 1) return { kind: "starved", retryable };
  return { kind: "partial", retryable };
}

function compileRetryableCensus(retryable = []) {
  let timeoutClass = 0;
  const reasons = {};
  for (const compiled of retryable) {
    const reason = String(compiled.reason || "intake_genie_compile_failed").slice(0, 160);
    reasons[reason] = (reasons[reason] || 0) + 1;
    if (compileTimeoutClassReason(reason)) timeoutClass += 1;
  }
  return { timeoutClass, reasons };
}

// Stamp the pick's thrown retryable error with the pass's timeout census so
// the durable quota controller can rotate a slow source immediately instead
// of paying the 60s retry floor per rotation.
function throwCompileRetryable(retryable, sourceTarget) {
  const census = compileRetryableCensus(retryable);
  const error = new Error("intake_genie_compile_retryable");
  error.code = "intake_genie_compile_retryable";
  error.retryable = true;
  error.causeCode = String(retryable[0] && retryable[0].reason || "intake_genie_compile_failed").slice(0, 160);
  error.compileTimeoutCount = census.timeoutClass;
  error.compileRetryableCount = retryable.length;
  error.compileSourceTarget = String(sourceTarget || "").slice(0, 160);
  const withProblems = retryable.find((compiled) => compilerProblemDetail(compiled).problems);
  return attachCompilerProblemDetail(error, withProblems || retryable[0] || {});
}

function prospectForCertification(row = {}, rec = recordOf(row)) {
  return { ...rec, ...row, record: rec, prospect_id: row.prospect_id || rec.prospect_id };
}

function verifiedGenieContentReceipt(row = {}, rec = recordOf(row), options = {}) {
  const marker = rec.genie_content_certification_contract;
  const idempotencyKey = String(rec.genie_compile_idempotency_key || "").trim();
  const markerKeyHash = String(marker?.idempotency_key_sha256 || "").trim();
  if (!marker || marker.version !== GENIE_RECEIPT_CONTRACT_VERSION
    || marker.pipeline_version !== GENIE_PIPELINE_VERSION
    || !idempotencyKey
    || !idempotencyKey.endsWith(`:${GENIE_PIPELINE_VERSION}`)
    || markerKeyHash !== createHash("sha256").update(idempotencyKey).digest("hex")) {
    return { ok: false, reason: "receipt_pipeline_contract_stale" };
  }
  return verifyContentCertification(
    rec.genie_content_certification,
    rec.genie_canonical_packet,
    prospectForCertification(row, rec),
    {
      signingKey: options.certificationKey,
      nowMs: options.nowMs,
      requestSources: rec.genie_compile_sources,
      idempotencyKey: rec.genie_compile_idempotency_key,
    },
  );
}

/** Compile one already identity-screened LeadMiner row, bind the admitted
 * source-backed packet projection to that row, and persist its receipt. */
async function compileGenieContent(row = {}, deps = {}) {
  const rec = recordOf(row);
  const env = deps.env || process.env;
  // A staged Packet2 belongs to this exact prospect record. Read its durable
  // canonical snapshot here so every Line entry path makes the same choice.
  // An invalid staged sidecar must never fall back to a fresh SiteForge compile.
  const stagedPacket2 = readPageHubBuildPacket(rec);
  if (!stagedPacket2.ok && stagedPacket2.reason !== "pagehub_build_packet_absent") {
    return { ok: false, retryable: false, reason: stagedPacket2.reason };
  }
  const snapshotBytes = stagedPacket2.ok
    ? Buffer.from(canonicalPageHubJson(stagedPacket2.snapshot), "utf8") : null;
  const packet2Import = deps.packet2Import !== undefined
    ? deps.packet2Import
    : stagedPacket2.ok ? {
        snapshot_base64: snapshotBytes.toString("base64"),
        snapshot_sha256: stagedPacket2.sidecar.snapshot_sha256,
      } : undefined;
  const packet2Requested = packet2Import !== undefined;
  const directTemplateId = packet2Requested ? "" : String(env.INTAKE_GENIE_TEMPLATE_ID || "").trim();
  if (directTemplateId && directTemplateId !== "single-cinematic-motion") {
    return { ok: false, retryable: false, reason: "intake_genie_template_id_unsupported" };
  }
  if (stagedPacket2.ok && deps.packet2Import !== undefined
    && packet2Import?.snapshot_sha256 !== stagedPacket2.sidecar.snapshot_sha256) {
    return { ok: false, retryable: false, reason: "packet2_import_staged_snapshot_mismatch" };
  }
  if (!genieCertifiedAdmissionEnabled(env)) {
    if (packet2Requested) return { ok: false, retryable: false, reason: "packet2_certification_disabled" };
    return { ok: true, row, rec, certified: false, disabled: true };
  }
  if (packet2Requested) {
    const snapshotBase64 = packet2Import && typeof packet2Import === "object"
      ? packet2Import.snapshot_base64 : "";
    const snapshotSha256 = String(packet2Import?.snapshot_sha256 || "");
    const base64Ok = typeof snapshotBase64 === "string"
      && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(snapshotBase64);
    const snapshotBytes = base64Ok ? Buffer.from(snapshotBase64, "base64") : Buffer.alloc(0);
    if (!base64Ok || !snapshotBytes.length || snapshotBytes.toString("base64") !== snapshotBase64
      || !/^[a-f0-9]{64}$/.test(snapshotSha256)
      || createHash("sha256").update(snapshotBytes).digest("hex") !== snapshotSha256) {
      return { ok: false, retryable: false, reason: "packet2_import_snapshot_invalid" };
    }
  }
  const verified = verifiedGenieContentReceipt(row, rec, deps);
  const receiptTemplateId = String(rec.genie_content_certification_contract?.selected_template_id || "");
  const packetTemplateId = String(rec.genie_canonical_packet?.packet2?.selectedTemplateId || "");
  if (!packet2Requested && verified.ok
    && receiptTemplateId === directTemplateId
    && packetTemplateId === directTemplateId) {
    return { ok: true, row, rec, certified: true, reused: true };
  }
  // Test/dev checkouts without the compiler configuration preserve the legacy
  // fixture path. Production is fail-closed, as is any explicit test injection.
  const compilerRequired = String(env.VERCEL_ENV || "").toLowerCase() === "production"
    || /^(1|true|on|yes)$/i.test(String(env.GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION || ""))
    || typeof deps.callIntakeGenie === "function"
    || packet2Requested;
  if (!compilerRequired) return { ok: true, row, rec, certified: false, unavailable: true };
  if (!contentCertificationKeyConfigured(deps, env)) {
    return { ok: false, retryable: false, reason: "intake_genie_certification_key_missing" };
  }
  const compile = deps.callIntakeGenie || callIntakeGenie;
  const result = await compile(prospectForCertification(row, rec), {
    // The version is part of both the compiler idempotency key and the durable
    // receipt marker. A legacy receipt must compile once under this exact
    // contract before it can use the fast path again.
    pipelineVersion: GENIE_PIPELINE_VERSION,
    buildPreview: false,
    dryRun: true,
    signal: deps.signal,
    ...(packet2Requested ? { packet2Import } : {}),
  });
  if (!result || result.ok !== true) {
    const status = Number(result?.status);
    const statusCode = String(result?.status || "").trim().toLowerCase();
    const transientHttpStatus = new Set([408, 425, 429]).has(status);
    const retryable = statusCode !== "not_configured"
      && (transientHttpStatus || !Number.isFinite(status) || status >= 500);
    // A terminal numeric 4xx MAY be the compiler's deterministic verdict about
    // one candidate — but only 422 (unprocessable packet) has that proven
    // contract. 401/403 are auth, 404 is endpoint drift, and an unknown 4xx
    // fails CLOSED as a global halt rather than quietly draining candidates.
    // Configuration absence ("not_configured", missing signing key) carries no
    // status number and stays global for the same reason.
    const candidateLocal = !retryable && status === 422;
    return {
      ok: false,
      retryable,
      ...(candidateLocal ? { candidateLocal: true } : {}),
      reason: String(result?.error || result?.status || "intake_genie_compile_failed"),
      ...compilerProblemDetail(result),
    };
  }

  if (packet2Requested) {
    const transport = result.packet?.transport_receipt;
    const packet2Hash = String(result.packet?.packet2_hash || "");
    if (transport?.version !== "owner-packet2-import-v1"
      || transport.snapshot_sha256 !== packet2Import.snapshot_sha256
      || !/^[a-f0-9]{64}$/.test(packet2Hash)
      || transport.packet2_hash !== packet2Hash) {
      return { ok: false, retryable: false, reason: "packet2_import_transport_mismatch" };
    }
  }
  if (directTemplateId
    && result.packet?.packet2?.selectedTemplateId !== directTemplateId) {
    return { ok: false, retryable: false, reason: "intake_genie_template_selection_mismatch" };
  }

  // Packet2 uses an HTTP-200 `needs_input` verdict for a deterministic gap in
  // this candidate. Recognize only the exact deployed v2/supported contract;
  // an unknown success-shaped packet still fails closed in certification.
  const packetStatus = String(result.packet?.status || "").trim().toLowerCase();
  if (packetStatus === "needs_input"
    && String(result.packet?.version || "") === "intake-genie-v2"
    && result.packet?.scope?.supported === true) {
    return {
      ok: false,
      retryable: false,
      candidateLocal: true,
      reason: "intake_genie_candidate_needs_input",
    };
  }

  // Intake may return source-backed services plus a broad category expansion.
  // Keep the proven services and discard only the unbound extras before the
  // admitted projection is signed, persisted, and later rendered. If none survive,
  // the existing candidate-local certification refusal remains fail-closed.
  //
  // A LeadMiner supplement must bind the exact immutable service value to its
  // matching `/services/{index}/name` provenance pointer. A same-domain URL on
  // a loose evidence row is not proof that the source ever observed the claim.
  const truthServiceEvidence = packet2Requested
    ? []
    : durableTruthServiceEvidence(prospectForCertification(row, rec));
  const packetForRetain = truthServiceEvidence.length > 0
    ? {
        ...result.packet,
        service_evidence: [
          ...(Array.isArray(result.packet.service_evidence) ? result.packet.service_evidence : []),
          ...truthServiceEvidence,
        ],
      }
    : result.packet;
  const certifiedPacket = retainSourceBoundServices(packetForRetain, result.request?.sources, {
    prospect: prospectForCertification(row, rec),
    strictEvidence: true,
  });
  const certification = createContentCertification(
    certifiedPacket,
    prospectForCertification(row, rec),
    {
      signingKey: deps.certificationKey,
      packetLocation: "prospect_record:genie_canonical_packet",
      requestId: result.request?.request_id,
      jobId: certifiedPacket?.job_id,
      idempotencyKey: result.idempotencyKey,
      requestSources: result.request?.sources,
      certifiedAt: typeof deps.now === "function" ? deps.now() : new Date().toISOString(),
    },
  );
  if (!certification.ok) {
    const candidateLocal = candidateLocalCertificationFailure(certification.reasons);
    return {
      ok: false,
      retryable: false,
      ...(candidateLocal ? { candidateLocal: true } : {}),
      reason: `intake_genie_certification_failed:${certification.reasons.join(",")}`,
    };
  }

  const existingTruth = rec.truth_packet && typeof rec.truth_packet === "object" ? rec.truth_packet : {};
  const nextRecord = {
    ...rec,
    truth_packet: {
      ...existingTruth,
      intakeGenie: certifiedPacket,
      meta: {
        ...(existingTruth.meta || {}),
        content_certification: certification.receipt,
      },
    },
    genie_canonical_packet: certifiedPacket,
    genie_compile_sources: result.request?.sources,
    genie_compile_idempotency_key: result.idempotencyKey,
    // The content receipt predates the v7 category/provenance contract and is
    // otherwise cryptographically valid for 30 days. Bind new receipts to the
    // current Line contract and its exact compiler key so legacy v1-v6 rows
    // must recompile once instead of silently fast-passing changed semantics.
    genie_content_certification_contract: {
      version: GENIE_RECEIPT_CONTRACT_VERSION,
      pipeline_version: GENIE_PIPELINE_VERSION,
      ...(directTemplateId ? { selected_template_id: directTemplateId } : {}),
      idempotency_key_sha256: createHash("sha256")
        .update(String(result.idempotencyKey || ""))
        .digest("hex"),
    },
    genie_content_certification: certification.receipt,
    // Compatibility display only. The signed receipt is re-verified below
    // before any fast pass is granted.
    genie_build_certified: true,
    genie_compiled_at: certification.receipt.certified_at,
  };
  const guards = {
    ...(String(row.updated_at || "").trim() ? { updated_at: `eq.${String(row.updated_at).trim()}` } : {}),
    ...(String(row.status || "").trim() ? { status: `eq.${String(row.status).trim()}` } : {}),
  };
  const update = deps.conditionalUpdate || conditionalUpdate;
  const updatedAt = certification.receipt.certified_at;
  const saved = await update(
    PROSPECTS,
    "prospect_id",
    String(row.prospect_id || ""),
    guards,
    { record: nextRecord, updated_at: updatedAt },
  ).catch(() => null);
  if (!saved || saved.ok !== true || saved.updated !== true) {
    return { ok: false, retryable: true, reason: "intake_genie_certification_persist_failed" };
  }
  const updatedRow = { ...row, record: nextRecord, updated_at: updatedAt };
  const finalVerification = verifiedGenieContentReceipt(updatedRow, nextRecord, deps);
  if (!finalVerification.ok) return { ok: false, retryable: false, reason: finalVerification.reason };
  return { ok: true, row: updatedRow, rec: nextRecord, certified: true, reused: false };
}

function completedLineHeroBank(row = {}, current = {}, at = new Date()) {
  const candidate = row.ownedPhotoBank || row.owned_photo_bank;
  if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.photos)) return null;
  const currentRecord = recordOf(current);
  const candidateRecord = {
    ...currentRecord,
    current_website: currentRecord.current_website || current.current_website || row.currentWebsite,
    photo_bank: candidate,
  };
  const source = heroLegacySiteUrl(candidateRecord);
  if (!source.ok) return null;
  const bank = normalizedHeroPhotoBank(candidateRecord, source.url, at);
  return bank.fresh && bank.photos.length ? bank : null;
}

function storedLineHeroBank(current = {}, row = {}, at = new Date()) {
  const currentRecord = recordOf(current);
  const candidate = currentRecord.photo_bank
    || buildReadyOf(currentRecord)?.photo_bank
    || currentRecord.last_mine_observation?.build_ready?.photo_bank;
  if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.photos)) return null;
  return completedLineHeroBank({ ...row, ownedPhotoBank: candidate }, current, at);
}

function heroLeaseAttemptCap(env = process.env) {
  return Math.max(1, Number(env.GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS) || 3);
}

function operationalHeroFailureReason(reason = "") {
  return SANDBOX_OPERATIONAL_HERO_FAILURE_REASONS.has(reason)
    || SANDBOX_OPERATIONAL_HERO_FAILURE_PATTERNS.some((pattern) => pattern.test(reason));
}

function operationalHeroRetryBudget(job = {}, reason = "", env = process.env) {
  const attempts = Number(job.attempts ?? job.attempt_count);
  const cap = heroLeaseAttemptCap(env);
  if (!Number.isSafeInteger(attempts) || attempts < 0) return null;
  if (reason === CAPABILITY_NO_CHECKPOINT_REASON) {
    const result = objectOf(job.result) || {};
    const recordedCap = Number(result.attempt_cap ?? result.attemptCap);
    if (String(result.reason || "").trim() !== CAPABILITY_NO_CHECKPOINT_REASON
      || String(result.exhausted_reason || result.exhaustedReason || "").trim() !== CAPABILITY_NO_CHECKPOINT_REASON
      || recordedCap !== cap
      || result.retry_budget_exhausted !== true
      || String(result.retry_budget_exhausted_by || "") !== CAPABILITY_BUDGET_EXHAUSTED_BY
      || result.provider_checkpoint_present !== false
      || objectOf(result.provider_checkpoint)) return null;
    return { attempts, cap, exhausted: true, exhaustedBy: CAPABILITY_BUDGET_EXHAUSTED_BY };
  }
  if (operationalHeroFailureReason(reason)) {
    return { attempts, cap, exhausted: attempts >= cap };
  }
  if (SANDBOX_OPERATIONAL_HERO_MAX_REASONS.has(reason) && attempts >= cap) {
    return { attempts, cap, exhausted: true };
  }
  return null;
}

function staticHeroPhotoSource(photo = {}) {
  return photo.current_hero === true
    ? "client_current_hero"
    : photo.identity_critical === true
      ? "identity_portrait"
      : "photo_bank";
}

function carriedOperationalHeroReason(row = {}, {
  jobId = "", heroAttemptId = "", expectedHandle = null, attempts = 0, cap = 0,
} = {}) {
  const marker = objectOf(row.heroRemaster) || objectOf(row.hero_remaster);
  const markerAttempts = Number(marker?.videoAttempts ?? marker?.video_attempts);
  const markerCap = Number(marker?.videoAttemptCap ?? marker?.video_attempt_cap);
  const reason = String(marker?.videoFailureReason || marker?.video_failure_reason || "").trim();
  if (!marker
    || marker.required !== true
    || marker.pending !== true
    || String(marker.jobId || marker.job_id || "") !== jobId
    || String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || "") !== heroAttemptId
    || String(marker.producer || "") !== "openrouter_seedance"
    || String(marker.lineBatchId || marker.line_batch_id || "") !== expectedHandle?.batchId
    || String(marker.lineRowId || marker.line_row_id || "") !== expectedHandle?.rowId
    || String(marker.buildHash || marker.build_hash || "") !== String(row.buildHash || row.build_hash || "")
    || !Number.isSafeInteger(markerAttempts)
    || markerAttempts < 0
    || markerAttempts >= attempts
    || markerCap !== cap
    || !operationalHeroFailureReason(reason)) return "";
  return reason;
}

/**
 * Verify that the exact signed base build already paints a client-owned static
 * hero. This is deliberately stronger than "the build exists": the durable
 * owned bank must still pass the normal provenance gate, the signed release
 * must say no video is present, and its proven hero wash must clear AA.
 */
function verifiedStaticHeroBase(row = {}, current = {}) {
  const rowBuildHash = String(row.buildHash || row.build_hash || "").trim();
  const rowPreviewUrl = sanitizePreviewUrl(row.previewUrl || row.preview_url || "");
  if (!/^[a-f0-9]{64}$/i.test(rowBuildHash) || !rowPreviewUrl) return null;
  const persisted = validatedPersistedDispatch(current);
  const currentRecord = recordOf(current);
  const canonicalProofTrulyAbsent = !sanitizePreviewUrl(current.preview_url || currentRecord.preview_url || "")
    && currentRecord.build_dispatch == null
    && currentRecord.mirror_release_evidence == null;
  const carried = !persisted && canonicalProofTrulyAbsent
    ? mirrorBuildEvidenceFromRow(row, rowPreviewUrl)
    : null;
  const carriedEvidence = objectOf(carried?.evidence);
  const carriedRelease = objectOf(carriedEvidence?.release_evidence);
  // The post-Mirror hero join runs before writePreviewUrl commits the canonical
  // prospect dispatch. At that seam, accept only the row's *fully signed*
  // native Mirror packet for this exact preview/hash. The old unverified marker
  // has no release evidence and cannot cross this branch.
  const baseIdentity = persisted || (carried?.native === true && carriedEvidence && carriedRelease
    && carriedEvidence.build_hash === rowBuildHash
    && String(carriedRelease.build_hash || "").trim() === rowBuildHash
    && sanitizePreviewUrl(carriedRelease.preview_url) === rowPreviewUrl
    ? {
      buildHash: rowBuildHash,
      previewUrl: rowPreviewUrl,
      releaseEvidence: carriedRelease,
      evidenceSha: String(carriedEvidence.evidence_sha || "").trim(),
    }
    : null);
  if (!baseIdentity
    || baseIdentity.buildHash !== rowBuildHash
    || baseIdentity.previewUrl !== rowPreviewUrl) return null;

  const bank = storedLineHeroBank(current, {
    ...row,
    currentWebsite: row.currentWebsite || row.current_website || current.current_website,
  });
  const rowBank = completedLineHeroBank(row, current);
  if (!bank
    || !rowBank
    || !/^[a-f0-9]{64}$/i.test(String(bank.fingerprint || ""))
    || bank.fingerprint !== rowBank.fingerprint) return null;
  const brand = objectOf(baseIdentity.releaseEvidence?.checks?.brand);
  const photos = objectOf(brand?.photos);
  const heroVideo = objectOf(brand?.hero_video);
  const heroWash = objectOf(brand?.hero_wash);
  const photoSource = String(heroWash?.photo_source || "").trim();
  const signedPhotoSha = String(heroWash?.photo_sha || "").trim().toLowerCase();
  const signedPhotoUrl = String(heroWash?.photo_url || "").trim();
  const heroPhoto = photoSource === "first_usable_photo"
    ? bank.photos.find((photo) => String(photo?.sha256 || "").toLowerCase() === signedPhotoSha
      && String(photo?.url || "") === signedPhotoUrl)
    : pickHeroPhoto(bank);
  const heroPhotoSha = String(heroPhoto?.sha256 || "").trim().toLowerCase();
  const heroPhotoUrl = String(heroPhoto?.url || "").trim();
  const derivedPhotoSource = photoSource === "first_usable_photo"
    ? "first_usable_photo"
    : staticHeroPhotoSource(heroPhoto || {});
  if (!/^[a-f0-9]{64}$/.test(heroPhotoSha) || !/^https:\/\//i.test(heroPhotoUrl)) return null;
  const pagesVerified = Array.isArray(heroWash?.pages_verified)
    ? heroWash.pages_verified.filter((page) => String(page || "").trim())
    : [];
  const supplied = Number(photos?.supplied);
  const usable = Number(photos?.usable);
  const videoPlaced = Number(heroVideo?.placed);
  const headlineContrast = Number(heroWash?.worst_case_contrast);
  const inkFloorContrast = Number(heroWash?.ink_floor_contrast);
  if (!brand
    || !["origin", "housed"].includes(String(brand.media_mode || ""))
    || !Number.isSafeInteger(supplied) || supplied < 1
    || !Number.isSafeInteger(usable) || usable < 1
    || heroVideo?.supplied !== false
    || heroVideo?.usable !== false
    || !Number.isSafeInteger(videoPlaced) || videoPlaced !== 0
    || heroWash?.applied !== true
    || Boolean(String(heroWash.reason || "").trim())
    || !VERIFIED_STATIC_HERO_SOURCES.has(photoSource)
    || photoSource !== derivedPhotoSource
    || signedPhotoSha !== heroPhotoSha
    || signedPhotoUrl !== heroPhotoUrl
    || !String(heroWash.selector || "").trim()
    || pagesVerified.length < 1
    || !Number.isFinite(headlineContrast) || headlineContrast < 4.5
    || !Number.isFinite(inkFloorContrast) || inkFloorContrast < 4.5) return null;

  return {
    evidenceSha: baseIdentity.evidenceSha,
    photoSource,
    photoSha: heroPhotoSha,
    photoUrl: heroPhotoUrl,
    bankFingerprint: bank.fingerprint,
  };
}

function foreignStaticHeroJobBinding(marker = {}) {
  const binding = {
    schema: String(marker.foreignJobBindingSchema || marker.foreign_job_binding_schema || "").trim(),
    sha256: String(marker.foreignJobBindingSha256 || marker.foreign_job_binding_sha256 || "").trim().toLowerCase(),
    prospectId: String(marker.foreignJobProspectId || marker.foreign_job_prospect_id || "").trim(),
    generationRevision: Number(
      marker.foreignJobGenerationRevision ?? marker.foreign_job_generation_revision,
    ),
    lineBatchId: String(marker.foreignJobLineBatchId || marker.foreign_job_line_batch_id || "").trim(),
    lineRowId: String(marker.foreignJobLineRowId || marker.foreign_job_line_row_id || "").trim(),
    buildHash: String(marker.foreignJobBuildHash || marker.foreign_job_build_hash || "").trim().toLowerCase(),
    snapshotSha256: String(marker.foreignJobSnapshotSha256 || marker.foreign_job_snapshot_sha256 || "").trim().toLowerCase(),
    checkpointSha256: String(marker.foreignJobCheckpointSha256 || marker.foreign_job_checkpoint_sha256 || "").trim().toLowerCase(),
    jobStatus: String(marker.foreignJobStatus || marker.foreign_job_status || "").trim(),
    resultReason: String(marker.foreignJobResultReason || marker.foreign_job_result_reason || "").trim(),
    updatedAt: String(marker.foreignJobUpdatedAt || marker.foreign_job_updated_at || "").trim(),
    finishedAt: String(marker.foreignJobFinishedAt || marker.foreign_job_finished_at || "").trim(),
  };
  const present = Object.values(binding).some((value) => value !== "" && !Number.isNaN(value));
  if (!present) return null;
  return {
    ...binding,
    valid: [FOREIGN_STATIC_HERO_JOB_BINDING_SCHEMA, FOREIGN_CHECKPOINT_STATIC_HERO_JOB_BINDING_SCHEMA]
      .includes(binding.schema)
      && /^[a-f0-9]{64}$/.test(binding.sha256)
      && Boolean(binding.prospectId)
      && Number.isSafeInteger(binding.generationRevision)
      && binding.generationRevision > 0
      && Boolean(binding.lineBatchId)
      && Boolean(binding.lineRowId)
      && /^[a-f0-9]{64}$/.test(binding.buildHash)
      && (binding.schema !== FOREIGN_CHECKPOINT_STATIC_HERO_JOB_BINDING_SCHEMA
        || (/^[a-f0-9]{64}$/.test(binding.snapshotSha256)
          && /^[a-f0-9]{64}$/.test(binding.checkpointSha256)
          && binding.jobStatus === "failed"
          && binding.resultReason === "openrouter_submit_failed"
          && Boolean(binding.updatedAt)
          && Boolean(binding.finishedAt))),
  };
}

function foreignStaticHeroJobBindingSha(marker = {}) {
  const foreign = foreignStaticHeroJobBinding({
    ...marker,
    foreign_job_binding_sha256: "0".repeat(64),
    foreignJobBindingSha256: "",
  });
  if (!foreign) return "";
  if (foreign.schema === FOREIGN_CHECKPOINT_STATIC_HERO_JOB_BINDING_SCHEMA) {
    return createHash("sha256").update(canonicalJson({
      schema: foreign.schema,
      current_line_batch_id: String(marker.lineBatchId || marker.line_batch_id || "").trim(),
      current_line_row_id: String(marker.lineRowId || marker.line_row_id || "").trim(),
      job_id: String(marker.jobId || marker.job_id || "").trim(),
      prospect_id: foreign.prospectId,
      generation_revision: foreign.generationRevision,
      hero_attempt_id: String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || "").trim(),
      producer: String(marker.producer || "").trim(),
      foreign_line_batch_id: foreign.lineBatchId,
      foreign_line_row_id: foreign.lineRowId,
      build_hash: foreign.buildHash,
      job_snapshot_sha256: foreign.snapshotSha256,
      provider_checkpoint_sha256: foreign.checkpointSha256,
      job_status: foreign.jobStatus,
      result_reason: foreign.resultReason,
      updated_at: foreign.updatedAt,
      finished_at: foreign.finishedAt,
      video_attempts: Number(marker.videoAttempts ?? marker.video_attempts),
      video_attempt_cap: Number(marker.videoAttemptCap ?? marker.video_attempt_cap),
      observation_reason: String(marker.foreignJobConsumptionReason || marker.foreign_job_consumption_reason || "").trim(),
      static_hero_verified: marker.staticHeroVerified === true || marker.static_hero_verified === true,
      static_hero_source: String(marker.staticHeroSource || marker.static_hero_source || "").trim(),
      static_hero_photo_sha256: String(marker.staticHeroPhotoSha256 || marker.static_hero_photo_sha256 || "").trim().toLowerCase(),
      static_hero_photo_url: String(marker.staticHeroPhotoUrl || marker.static_hero_photo_url || "").trim(),
      static_hero_bank_fingerprint: String(marker.staticHeroBankFingerprint || marker.static_hero_bank_fingerprint || "").trim().toLowerCase(),
      base_evidence_sha: String(marker.baseEvidenceSha || marker.base_evidence_sha || "").trim(),
    })).digest("hex");
  }
  const values = [
    foreign.schema,
    String(marker.lineBatchId || marker.line_batch_id || "").trim(),
    String(marker.lineRowId || marker.line_row_id || "").trim(),
    String(marker.jobId || marker.job_id || "").trim(),
    foreign.prospectId,
    String(foreign.generationRevision),
    String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || "").trim(),
    String(marker.producer || "").trim(),
    foreign.lineBatchId,
    foreign.lineRowId,
    foreign.buildHash,
    String(marker.videoFailureReason || marker.video_failure_reason || "").trim(),
    String(marker.videoTerminalReason || marker.video_terminal_reason || "").trim(),
    String(Number(marker.videoAttempts ?? marker.video_attempts)),
    String(Number(marker.videoAttemptCap ?? marker.video_attempt_cap)),
    String(marker.videoRetryBudgetExhaustedBy || marker.video_retry_budget_exhausted_by || "").trim(),
    String(marker.foreignJobConsumptionReason || marker.foreign_job_consumption_reason || "").trim(),
    marker.staticHeroVerified === true || marker.static_hero_verified === true ? "true" : "false",
    String(marker.staticHeroSource || marker.static_hero_source || "").trim(),
    String(marker.staticHeroPhotoSha256 || marker.static_hero_photo_sha256 || "").trim().toLowerCase(),
    String(marker.staticHeroPhotoUrl || marker.static_hero_photo_url || "").trim(),
    String(marker.staticHeroBankFingerprint || marker.static_hero_bank_fingerprint || "").trim().toLowerCase(),
    String(marker.baseEvidenceSha || marker.base_evidence_sha || "").trim(),
  ];
  return createHash("sha256").update(values.join("\n")).digest("hex");
}

function rejectedForeignSubmittingCheckpointSnapshot(job = {}) {
  const jobId = String(job.jobId || job.job_id || "").trim();
  const prospectId = String(job.prospectId || job.prospect_id || "").trim();
  const producer = safeHeroProducer(job.producer || job.payload?.producer);
  const status = String(job.status || "").trim();
  const result = objectOf(job.result) || {};
  const reason = String(result.reason || "").trim();
  const checkpoint = objectOf(result.provider_checkpoint);
  const failure = objectOf(result.provider_failure);
  const revision = Number(job.generation_revision ?? job.payload?.generation_revision ?? 0);
  const attempts = Number(job.attempts ?? job.attempt_count);
  const handle = normalizeLineHandle(job.payload?.line_handle || job.line_handle);
  const buildHash = String(job.payload?.line_build_hash || "").trim().toLowerCase();
  const updatedAt = String(job.updatedAt || job.updated_at || "").trim();
  const finishedAt = String(job.finishedAt || job.finished_at || "").trim();
  const checkpointBytes = Number(checkpoint?.source_bytes);
  const checkpointDuration = Number(checkpoint?.duration_seconds);
  const payloadDuration = Number(job.payload?.duration_seconds);
  const sourceSha = String(checkpoint?.source_sha256 || "").trim().toLowerCase();
  let selectedSource = null;
  let expectedIntent = "";
  if (Number.isSafeInteger(revision) && revision > 0 && SEEDANCE_DURATION_SECONDS.has(payloadDuration)) {
    try {
      const { normalizeJob, selectOwnedScene, generationIdentity } = require("./hero-seedance-runner");
      const normalized = normalizeJob({
        ...(objectOf(job.payload) || {}),
        job_id: jobId,
        prospect_id: prospectId,
        producer,
        generation_revision: revision,
        duration_seconds: payloadDuration,
        provider_checkpoint: checkpoint,
        attempts,
      });
      selectedSource = selectOwnedScene(normalized);
      expectedIntent = selectedSource ? generationIdentity(normalized, selectedSource) : "";
    } catch (_) {
      selectedSource = null;
      expectedIntent = "";
    }
  }
  if (!jobId || !prospectId
    || producer !== "openrouter_seedance"
    || status !== "failed"
    || reason !== "openrouter_submit_failed"
    || !Number.isSafeInteger(attempts) || attempts < 1
    || !Number.isSafeInteger(revision) || revision < 1
    || !handle
    || !/^[a-f0-9]{64}$/.test(buildHash)
    || !updatedAt || !finishedAt
    || String(job.leaseToken || job.lease_token || "").trim()
    || String(job.leaseOwner || job.lease_owner || "").trim()
    || String(job.leaseExpiresAt || job.lease_expires_at || "").trim()
    || checkpoint?.schema_version !== SEEDANCE_CHECKPOINT_SCHEMA
    || checkpoint.submission_state !== "submitting"
    || String(checkpoint.provider_job_id || "").trim()
    || String(checkpoint.polling_url || "").trim()
    || String(checkpoint.job_id || "").trim() !== jobId
    || String(checkpoint.prospect_id || "").trim() !== prospectId
    || Number(checkpoint.generation_revision) !== revision
    || !/^[a-f0-9]{64}$/.test(sourceSha)
    || !selectedSource
    || String(selectedSource.sha256 || "").trim().toLowerCase() !== sourceSha
    || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]
      .includes(String(checkpoint.source_mime || "").trim().toLowerCase())
    || !Number.isSafeInteger(checkpointBytes) || checkpointBytes < 1 || checkpointBytes > MAX_SEEDANCE_SOURCE_BYTES
    || checkpoint.model_id !== SEEDANCE_MODEL_ID
    || !SEEDANCE_DURATION_SECONDS.has(payloadDuration)
    || checkpointDuration !== payloadDuration
    || String(checkpoint.intent_sha256 || "").trim().toLowerCase() !== expectedIntent
    || !String(checkpoint.submit_started_at || "").trim()
    || failure?.schema_version !== "wss.openrouter_failure.v1"
    || failure.provider !== "openrouter"
    || failure.operation !== "video_submit"
    || failure.parameter !== "frame_images"
    || Number(failure.http_status) !== 400) return null;
  const checkpointSha256 = createHash("sha256").update(canonicalJson(checkpoint)).digest("hex");
  const snapshot = {
    schema: FOREIGN_CHECKPOINT_STATIC_HERO_JOB_BINDING_SCHEMA,
    job_id: jobId,
    prospect_id: prospectId,
    producer,
    status,
    attempts,
    generation_revision: revision,
    line_handle: handle,
    line_build_hash: buildHash,
    updated_at: updatedAt,
    finished_at: finishedAt,
    lease_token: String(job.leaseToken || job.lease_token || ""),
    lease_owner: String(job.leaseOwner || job.lease_owner || ""),
    lease_expires_at: String(job.leaseExpiresAt || job.lease_expires_at || ""),
    payload: objectOf(job.payload) || {},
    result,
  };
  return {
    jobId,
    prospectId,
    producer,
    status,
    reason,
    attempts,
    revision,
    handle,
    buildHash,
    updatedAt,
    finishedAt,
    checkpointSha256,
    snapshotSha256: createHash("sha256").update(canonicalJson(snapshot)).digest("hex"),
  };
}

function sandboxOperationalStaticHeroResolution({
  row = {}, current = {}, job = {}, status = "", reason = "", producer = "",
  jobId = "", heroAttemptId = "", expectedHandle = null, actualHandle = null,
  options = {},
} = {}) {
  if (options.lane !== "sandbox"
    || options.inspectOnly === true
    || status !== "failed"
    || producer !== "openrouter_seedance"
    || !jobId
    || !heroAttemptId
    || !expectedHandle
    || !actualHandle
    || expectedHandle.batchId !== actualHandle.batchId
    || expectedHandle.rowId !== actualHandle.rowId) return null;
  const cap = heroLeaseAttemptCap(options.env || process.env);
  const attempts = Number(job.attempts ?? job.attempt_count);
  const terminalResult = objectOf(job.result) || {};
  const exhaustedReason = String(terminalResult.exhausted_reason || terminalResult.exhaustedReason || "").trim();
  const exhaustedCap = Number(terminalResult.attempt_cap ?? terminalResult.attemptCap);
  const effectiveReason = reason === "hero_stale_failure_max_attempts"
    ? ((exhaustedCap === cap && operationalHeroFailureReason(exhaustedReason))
      ? exhaustedReason
      : carriedOperationalHeroReason(row, {
        jobId,
        heroAttemptId,
        expectedHandle,
        attempts,
        cap,
      }))
    : reason;
  const budget = operationalHeroRetryBudget(job, effectiveReason, options.env || process.env);
  if (!budget) return null;
  // Keep the Line row alive while the watchdog owns the remaining bounded
  // retries. A terminal Line rejection here would make the later exhausted
  // verdict unreachable even though the hero job itself can still requeue.
  // Static proof is intentionally irrelevant until the fallback is requested:
  // a weak/missing base must not consume the worker's remaining video retry.
  if (!budget.exhausted) {
    return {
      ok: true,
      queued: false,
      required: true,
      ready: false,
      pending: true,
      hold: false,
      fallback: false,
      applied: false,
      status: "retry_pending",
      reason,
      job_id: jobId,
      build_hash: String(row.buildHash || row.build_hash || "").trim(),
      hero_attempt_id: heroAttemptId,
      producer,
      line_batch_id: expectedHandle.batchId,
      line_row_id: expectedHandle.rowId,
      video_failure_reason: effectiveReason,
      video_terminal_reason: reason,
      video_attempts: budget.attempts,
      video_attempt_cap: budget.cap,
    };
  }
  const base = verifiedStaticHeroBase(row, current);
  if (!base) return null;
  return {
    ok: true,
    queued: false,
    required: false,
    ready: true,
    pending: false,
    hold: false,
    fallback: true,
    applied: false,
    status: "skipped",
    reason: SANDBOX_STATIC_HERO_FALLBACK_REASON,
    job_id: jobId,
    build_hash: String(row.buildHash || row.build_hash || "").trim(),
    hero_attempt_id: heroAttemptId,
    producer,
    static_hero_verified: true,
    static_hero_source: base.photoSource,
    static_hero_photo_sha256: base.photoSha,
    static_hero_photo_url: base.photoUrl,
    static_hero_bank_fingerprint: base.bankFingerprint,
    base_evidence_sha: base.evidenceSha,
    line_batch_id: expectedHandle.batchId,
    line_row_id: expectedHandle.rowId,
    video_failure_reason: effectiveReason,
    video_terminal_reason: reason,
    video_attempts: budget.attempts,
    video_attempt_cap: budget.cap,
    ...(budget.exhaustedBy ? { video_retry_budget_exhausted_by: budget.exhaustedBy } : {}),
  };
}

async function sandboxForeignHandleOperationalStaticHeroResolution({
  row = {}, current = {}, job = {}, status = "", reason = "", producer = "",
  jobId = "", heroAttemptId = "", expectedHandle = null, actualHandle = null,
  options = {},
} = {}) {
  if (options.lane !== "sandbox"
    || options.inspectOnly === true
    || options.reuseOnly !== true
    || !["failed", "refused"].includes(status)
    || producer !== "openrouter_seedance"
    || !jobId
    || !heroAttemptId
    || !expectedHandle
    || !actualHandle
    || (expectedHandle.batchId === actualHandle.batchId && expectedHandle.rowId === actualHandle.rowId)) return null;

  const prospectId = String(row.prospectId || row.prospect_id || "").trim();
  const jobProspectId = String(job.prospectId || job.prospect_id || "").trim();
  const result = objectOf(job.result) || {};
  const sealed = status === "refused"
    && reason === PRACTICE_STATIC_SEAL_REASON
    && String(result.schema_version || "") === PRACTICE_STATIC_SEAL_SCHEMA;
  const originalReason = sealed ? String(result.original_reason || "").trim() : reason;
  const revision = Number(job.payload?.generation_revision ?? job.generation_revision ?? 0);
  const buildHash = String(row.buildHash || row.build_hash || "").trim().toLowerCase();
  const jobBuildHash = String(job.payload?.line_build_hash || "").trim().toLowerCase();
  const cap = heroLeaseAttemptCap(options.env || process.env);
  const attempts = Number(job.attempts ?? job.attempt_count);
  if (!prospectId
    || jobProspectId !== prospectId
    || originalReason !== "openrouter_submit_failed"
    || !Number.isSafeInteger(revision)
    || revision < 1
    || (job.generation_revision != null && Number(job.generation_revision) !== revision)
    || heroAttemptId !== `hero_attempt:${revision}`
    || !/^[a-f0-9]{64}$/.test(buildHash)
    || jobBuildHash !== buildHash
    || !Number.isSafeInteger(attempts)
    || attempts < 1) return null;

  // This is not the same-handle retry policy. A terminal job commissioned by
  // another immutable Line handle cannot be safely resubmitted for this row.
  // Practice may use its independently signed static base after at least one
  // real recorded attempt; the receipt keeps the actual count and configured
  // cap instead of pretending that all numeric retries ran.
  const base = verifiedStaticHeroBase(row, current);
  if (!base) return null;
  const checkpointSnapshot = rejectedForeignSubmittingCheckpointSnapshot(job);
  if (checkpointSnapshot) {
    if (checkpointSnapshot.jobId !== jobId
      || checkpointSnapshot.prospectId !== prospectId
      || checkpointSnapshot.producer !== producer
      || checkpointSnapshot.revision !== revision
      || checkpointSnapshot.handle.batchId !== actualHandle.batchId
      || checkpointSnapshot.handle.rowId !== actualHandle.rowId
      || checkpointSnapshot.buildHash !== jobBuildHash) return null;

    // A rejected 400/frame_images submit never received a provider job ID, but
    // the durable `submitting` checkpoint must remain untouched: rewriting it
    // would erase the only proof that no retry is safe. Re-read the exact job
    // and bind the static receipt to the complete rejection/checkpoint snapshot
    // instead of calling the terminal sealer (which correctly rejects every
    // checkpointed job).
    const reader = options.getHeroReelJobForProspect || getHeroReelJobForProspect;
    let reread;
    try {
      reread = await reader(prospectId);
    } catch (_) {
      reread = null;
    }
    const rereadSnapshot = reread?.ok === true && reread.job
      ? rejectedForeignSubmittingCheckpointSnapshot(reread.job)
      : null;
    if (!rereadSnapshot || rereadSnapshot.snapshotSha256 !== checkpointSnapshot.snapshotSha256) {
      return {
        ok: true,
        queued: false,
        required: true,
        ready: false,
        pending: true,
        hold: false,
        fallback: false,
        applied: false,
        status: "foreign_checkpoint_snapshot_pending",
        reason: "foreign_checkpoint_snapshot_changed",
        job_id: jobId,
        build_hash: buildHash,
        hero_attempt_id: heroAttemptId,
        producer,
        line_batch_id: expectedHandle.batchId,
        line_row_id: expectedHandle.rowId,
      };
    }
    const resolution = {
      ok: true,
      queued: false,
      required: false,
      ready: true,
      pending: false,
      hold: false,
      fallback: true,
      applied: false,
      status: "skipped",
      reason: SANDBOX_FOREIGN_CHECKPOINT_STATIC_HERO_FALLBACK_REASON,
      job_id: jobId,
      build_hash: buildHash,
      hero_attempt_id: heroAttemptId,
      producer,
      static_hero_verified: true,
      static_hero_source: base.photoSource,
      static_hero_photo_sha256: base.photoSha,
      static_hero_photo_url: base.photoUrl,
      static_hero_bank_fingerprint: base.bankFingerprint,
      base_evidence_sha: base.evidenceSha,
      line_batch_id: expectedHandle.batchId,
      line_row_id: expectedHandle.rowId,
      video_failure_reason: originalReason,
      video_terminal_reason: originalReason,
      video_attempts: attempts,
      video_attempt_cap: cap,
      foreign_job_consumption_reason: FOREIGN_CHECKPOINT_OBSERVATION_REASON,
      foreign_job_binding_schema: FOREIGN_CHECKPOINT_STATIC_HERO_JOB_BINDING_SCHEMA,
      foreign_job_prospect_id: jobProspectId,
      foreign_job_generation_revision: revision,
      foreign_job_line_batch_id: actualHandle.batchId,
      foreign_job_line_row_id: actualHandle.rowId,
      foreign_job_build_hash: jobBuildHash,
      foreign_job_snapshot_sha256: checkpointSnapshot.snapshotSha256,
      foreign_job_checkpoint_sha256: checkpointSnapshot.checkpointSha256,
      foreign_job_status: checkpointSnapshot.status,
      foreign_job_result_reason: checkpointSnapshot.reason,
      foreign_job_updated_at: checkpointSnapshot.updatedAt,
      foreign_job_finished_at: checkpointSnapshot.finishedAt,
    };
    resolution.foreign_job_binding_sha256 = foreignStaticHeroJobBindingSha(resolution);
    return resolution;
  }
  const resolution = {
    ok: true,
    queued: false,
    required: false,
    ready: true,
    pending: false,
    hold: false,
    fallback: true,
    applied: false,
    status: "skipped",
    reason: SANDBOX_FOREIGN_STATIC_HERO_FALLBACK_REASON,
    job_id: jobId,
    build_hash: buildHash,
    hero_attempt_id: heroAttemptId,
    producer,
    static_hero_verified: true,
    static_hero_source: base.photoSource,
    static_hero_photo_sha256: base.photoSha,
    static_hero_photo_url: base.photoUrl,
    static_hero_bank_fingerprint: base.bankFingerprint,
    base_evidence_sha: base.evidenceSha,
    line_batch_id: expectedHandle.batchId,
    line_row_id: expectedHandle.rowId,
    video_failure_reason: originalReason,
    video_terminal_reason: originalReason,
    video_attempts: attempts,
    video_attempt_cap: cap,
    foreign_job_consumption_reason: FOREIGN_HANDLE_CONSUMPTION_REASON,
    foreign_job_binding_schema: FOREIGN_STATIC_HERO_JOB_BINDING_SCHEMA,
    foreign_job_prospect_id: jobProspectId,
    foreign_job_generation_revision: revision,
    foreign_job_line_batch_id: actualHandle.batchId,
    foreign_job_line_row_id: actualHandle.rowId,
    foreign_job_build_hash: jobBuildHash,
  };
  resolution.foreign_job_binding_sha256 = foreignStaticHeroJobBindingSha(resolution);
  const sealer = options.sealForeignTerminalForPracticeStatic || sealForeignTerminalForPracticeStatic;
  const normalizedJob = {
    ...job,
    jobId,
    prospectId: jobProspectId,
    producer,
    status,
    attempts,
    payload: objectOf(job.payload) || {},
    result,
    leaseToken: String(job.leaseToken || job.lease_token || "").trim(),
    leaseOwner: String(job.leaseOwner || job.lease_owner || "").trim(),
    leaseExpiresAt: job.leaseExpiresAt || job.lease_expires_at || null,
    updatedAt: job.updatedAt || job.updated_at || null,
    finishedAt: job.finishedAt || job.finished_at || null,
  };
  const consumed = await sealer(normalizedJob, {
    practice: true,
    prospectId,
    generationRevision: revision,
    attemptCap: cap,
    originalReason,
    currentLineHandle: expectedHandle,
    originalLineHandle: actualHandle,
    currentBuildHash: buildHash,
    fallbackBindingSha256: resolution.foreign_job_binding_sha256,
    staticBase: base,
  }, {
    env: options.env || process.env,
    signal: options.signal,
    deadlineAt: options.deadlineAt,
  });
  if (consumed?.ok === true && consumed?.sealed === true) return resolution;
  if (consumed?.retryable === true) {
    return {
      ok: true,
      queued: false,
      required: true,
      ready: false,
      pending: true,
      hold: false,
      fallback: false,
      applied: false,
      status: "foreign_terminal_seal_pending",
      reason: String(consumed.reason || "foreign_terminal_seal_conflict"),
      job_id: jobId,
      build_hash: buildHash,
      hero_attempt_id: heroAttemptId,
      producer,
      line_batch_id: expectedHandle.batchId,
      line_row_id: expectedHandle.rowId,
      video_failure_reason: originalReason,
      video_terminal_reason: originalReason,
      video_attempts: attempts,
      video_attempt_cap: cap,
    };
  }
  return null;
}

async function verifySandboxStaticHeroFallbackReceipt(row = {}, options = {}) {
  const marker = objectOf(row.heroRemaster) || objectOf(row.hero_remaster);
  const markerReason = String(marker?.reason || "");
  if (![SANDBOX_STATIC_HERO_FALLBACK_REASON, SANDBOX_FOREIGN_STATIC_HERO_FALLBACK_REASON,
    SANDBOX_FOREIGN_CHECKPOINT_STATIC_HERO_FALLBACK_REASON].includes(markerReason)) {
    return { ok: true, required: false, verified: true };
  }
  if (options.lane !== "sandbox") return { ok: true, required: true, verified: false, reason: "static_hero_fallback_live_refused" };
  const foreignBinding = foreignStaticHeroJobBinding(marker || {});
  const checkpointBinding = foreignBinding?.schema === FOREIGN_CHECKPOINT_STATIC_HERO_JOB_BINDING_SCHEMA;
  if (foreignBinding && (!foreignBinding.valid
    || foreignBinding.sha256 !== foreignStaticHeroJobBindingSha(marker))) {
    return { ok: true, required: true, verified: false, reason: "static_hero_job_receipt_mismatch" };
  }
  const expectedForeignReason = checkpointBinding
    ? SANDBOX_FOREIGN_CHECKPOINT_STATIC_HERO_FALLBACK_REASON
    : SANDBOX_FOREIGN_STATIC_HERO_FALLBACK_REASON;
  if ((foreignBinding && markerReason !== expectedForeignReason)
    || (!foreignBinding && markerReason !== SANDBOX_STATIC_HERO_FALLBACK_REASON)) {
    return { ok: true, required: true, verified: false, reason: "static_hero_job_receipt_mismatch" };
  }
  const reader = options.getHeroReelJobForProspect || getHeroReelJobForProspect;
  let loaded;
  try {
    loaded = await reader(String(row.prospectId || row.prospect_id || "").trim());
  } catch (_) {
    return { ok: false, required: true, verified: false, retryable: true, reason: "static_hero_job_receipt_read_unavailable" };
  }
  if (!loaded || loaded.ok !== true) {
    return { ok: false, required: true, verified: false, retryable: true, reason: "static_hero_job_receipt_read_unavailable" };
  }
  const job = objectOf(loaded.job);
  if (!job) return { ok: true, required: true, verified: false, reason: "static_hero_job_receipt_missing" };

  const jobId = String(job.jobId || job.job_id || "").trim();
  const producer = safeHeroProducer(job.producer || job.payload?.producer);
  const status = String(job.status || "").trim();
  const attempts = Number(job.attempts ?? job.attempt_count);
  const cap = heroLeaseAttemptCap(options.env || process.env);
  const revision = Number(job.generation_revision ?? job.payload?.generation_revision ?? 0);
  const attemptId = Number.isInteger(revision) && revision >= 0 ? `hero_attempt:${revision}` : "";
  const handle = normalizeLineHandle(job.payload?.line_handle || job.line_handle);
  const result = objectOf(job.result) || {};
  const terminalReason = foreignBinding && !checkpointBinding
    ? String(result.original_reason || "").trim()
    : String(result.reason || "").trim();
  const videoReason = String(marker.videoFailureReason || marker.video_failure_reason || "").trim();
  const markerTerminalReason = String(marker.videoTerminalReason || marker.video_terminal_reason || "").trim();
  const markerAttempts = Number(marker.videoAttempts ?? marker.video_attempts);
  const markerCap = Number(marker.videoAttemptCap ?? marker.video_attempt_cap);
  const markerExhaustedBy = String(
    marker.videoRetryBudgetExhaustedBy || marker.video_retry_budget_exhausted_by || "",
  ).trim();
  const foreignConsumptionReason = String(
    marker.foreignJobConsumptionReason || marker.foreign_job_consumption_reason || "",
  ).trim();
  const recordedExhaustedReason = String(result.exhausted_reason || result.exhaustedReason || "").trim();
  const recordedCap = Number(result.attempt_cap ?? result.attemptCap);
  const directBudget = terminalReason === videoReason
    ? operationalHeroRetryBudget(job, videoReason, options.env || process.env)
    : null;
  const directOperational = directBudget?.exhausted === true;
  const watchdogOperational = terminalReason === "hero_stale_failure_max_attempts"
    && recordedExhaustedReason === videoReason
    && recordedCap === cap
    && operationalHeroFailureReason(videoReason)
    && !SANDBOX_OPERATIONAL_HERO_MAX_REASONS.has(videoReason);
  const currentBatchId = String(marker.lineBatchId || marker.line_batch_id || "").trim();
  const currentRowId = String(marker.lineRowId || marker.line_row_id || "").trim();
  const jobProspectId = String(job.prospectId || job.prospect_id || "").trim();
  const rowProspectId = String(row.prospectId || row.prospect_id || "").trim();
  const jobBuildHash = String(job.payload?.line_build_hash || "").trim().toLowerCase();
  const foreignOperational = Boolean(foreignBinding) && !checkpointBinding
    && Number.isSafeInteger(attempts)
    && attempts >= 1
    && terminalReason === "openrouter_submit_failed"
    && videoReason === "openrouter_submit_failed"
    && foreignConsumptionReason === FOREIGN_HANDLE_CONSUMPTION_REASON;
  const checkpointSnapshot = checkpointBinding
    ? rejectedForeignSubmittingCheckpointSnapshot(job)
    : null;
  const foreignCheckpointOperational = Boolean(checkpointSnapshot)
    && checkpointSnapshot.snapshotSha256 === foreignBinding.snapshotSha256
    && checkpointSnapshot.checkpointSha256 === foreignBinding.checkpointSha256
    && checkpointSnapshot.status === foreignBinding.jobStatus
    && checkpointSnapshot.reason === foreignBinding.resultReason
    && checkpointSnapshot.updatedAt === foreignBinding.updatedAt
    && checkpointSnapshot.finishedAt === foreignBinding.finishedAt
    && foreignConsumptionReason === FOREIGN_CHECKPOINT_OBSERVATION_REASON;
  const normalizedReceiptJob = {
    ...job,
    jobId,
    prospectId: jobProspectId,
    producer,
    status,
    attempts,
    payload: objectOf(job.payload) || {},
    result,
    leaseToken: String(job.leaseToken || job.lease_token || "").trim(),
    leaseOwner: String(job.leaseOwner || job.lease_owner || "").trim(),
    leaseExpiresAt: job.leaseExpiresAt || job.lease_expires_at || null,
    updatedAt: job.updatedAt || job.updated_at || null,
    finishedAt: job.finishedAt || job.finished_at || null,
  };
  const sealProof = foreignBinding && !checkpointBinding ? verifiedPracticeStaticSeal(normalizedReceiptJob, {
    practice: true,
    prospectId: rowProspectId,
    generationRevision: foreignBinding.generationRevision,
    attemptCap: cap,
    originalReason: videoReason,
    currentLineHandle: { batchId: currentBatchId, rowId: currentRowId },
    originalLineHandle: { batchId: foreignBinding.lineBatchId, rowId: foreignBinding.lineRowId },
    currentBuildHash: foreignBinding.buildHash,
    fallbackBindingSha256: foreignBinding.sha256,
    staticBase: {
      photoSource: String(marker.staticHeroSource || marker.static_hero_source || ""),
      photoSha: String(marker.staticHeroPhotoSha256 || marker.static_hero_photo_sha256 || ""),
      photoUrl: String(marker.staticHeroPhotoUrl || marker.static_hero_photo_url || ""),
      bankFingerprint: String(marker.staticHeroBankFingerprint || marker.static_hero_bank_fingerprint || ""),
      evidenceSha: String(marker.baseEvidenceSha || marker.base_evidence_sha || ""),
    },
  }) : null;
  let verified = status === (checkpointBinding ? foreignBinding.jobStatus : (foreignBinding ? "refused" : "failed"))
    && producer === "openrouter_seedance"
    && jobId === String(marker.jobId || marker.job_id || "").trim()
    && jobProspectId === rowProspectId
    && attemptId === String(marker.attemptId || marker.attempt_id || marker.hero_attempt_id || "").trim()
    && Boolean(handle)
    && currentBatchId === String(options.batchId || "").trim()
    && currentRowId === String(row.rowId || row.row_id || "").trim()
    && (foreignBinding
      ? (handle.batchId === foreignBinding.lineBatchId
        && handle.rowId === foreignBinding.lineRowId
        && (handle.batchId !== currentBatchId || handle.rowId !== currentRowId)
        && foreignBinding.prospectId === jobProspectId
        && foreignBinding.generationRevision === revision
        && foreignBinding.buildHash === jobBuildHash
        && foreignBinding.buildHash === String(row.buildHash || row.build_hash || "").trim().toLowerCase())
      : (handle.batchId === currentBatchId
        && handle.rowId === currentRowId))
    && Number.isSafeInteger(attempts)
    && attempts === markerAttempts
    && markerCap === cap
    && markerExhaustedBy === String(directBudget?.exhaustedBy || "")
    && markerTerminalReason === terminalReason
    && (foreignBinding
      ? (checkpointBinding ? foreignCheckpointOperational : (foreignOperational && Boolean(sealProof)))
      : (directOperational || watchdogOperational));

  if (verified && foreignBinding) {
    const currentReader = options.select || select;
    let currentLoaded;
    try {
      currentLoaded = await currentReader(
        PROSPECTS,
        `?select=*&prospect_id=eq.${encodeURIComponent(rowProspectId)}&limit=1`,
        { signal: options.signal, deadlineAt: options.deadlineAt },
      );
    } catch (_) {
      return { ok: false, required: true, verified: false, retryable: true, reason: "static_hero_base_receipt_read_unavailable" };
    }
    if (!currentLoaded || currentLoaded.ok !== true || !Array.isArray(currentLoaded.data)) {
      return { ok: false, required: true, verified: false, retryable: true, reason: "static_hero_base_receipt_read_unavailable" };
    }
    const base = currentLoaded.data[0] ? verifiedStaticHeroBase(row, currentLoaded.data[0]) : null;
    verified = Boolean(base)
      && String(marker.baseEvidenceSha || marker.base_evidence_sha || "") === base.evidenceSha
      && String(marker.staticHeroSource || marker.static_hero_source || "") === base.photoSource
      && String(marker.staticHeroPhotoSha256 || marker.static_hero_photo_sha256 || "").toLowerCase() === base.photoSha
      && String(marker.staticHeroPhotoUrl || marker.static_hero_photo_url || "") === base.photoUrl
      && String(marker.staticHeroBankFingerprint || marker.static_hero_bank_fingerprint || "").toLowerCase() === base.bankFingerprint;
  }
  return {
    ok: true,
    required: true,
    verified,
    reason: verified ? "" : "static_hero_job_receipt_mismatch",
  };
}

/**
 * The one question the hero gate should ask: is there a URL the Ads Station can
 * scan for this client's own images?
 *
 * Order matters and is not arbitrary — it is where authentic photos actually
 * live. Their legacy site first (that is the site we are rebuilding from, and
 * the Station's own "Website or social" scan walks it), then a discovered social
 * profile, because a trade business posts real crews and real trucks to Facebook
 * long before it updates the brochure site it paid for in 2018.
 *
 * Our own *.wss-ai.com mirror is deliberately NOT a source: scanning our own
 * output to make the client's hero would be circular, and at this point in the
 * lane the mirror may not exist yet.
 */
function firstScannableSource(record, current, row) {
  const rec = record || {};
  const cur = current || {};
  const r = row || {};
  const candidates = [
    rec.mirror_request?.facts?.current_website,
    rec.build_ready?.mirror_request?.facts?.current_website,
    rec.build_ready?.discovery?.url,
    rec.discovery?.url,
    rec.current_website,
    cur.current_website,
    r.currentWebsite,
    // Socials last only because they are less often recorded — not because they
    // are worse. When present they are frequently the BEST source.
    ...(Array.isArray(rec.social_evidence?.attached) ? rec.social_evidence.attached : []),
  ];

  for (const candidate of candidates) {
    const url = typeof candidate === "string" ? candidate.trim() : String(candidate?.url || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    // Never point the Station at our own mirror.
    if (/(^|\.)wss-ai\.com/i.test(url)) continue;
    return url;
  }
  return null;
}

function exactSharedHeroCompletion(job, current, row, options = {}) {
  const receipt = objectOf(job?.result?.upload_receipt) || {};
  const shared = objectOf(receipt.shared_release);
  if (!shared || objectOf(receipt.rebuild)) return null;
  const proof = objectOf(shared.proof_identity) || {};
  const previous = objectOf(shared.previous_proof_identity) || {};
  const evidence = objectOf(shared.release_evidence) || {};
  const expectedHandle = normalizeLineHandle({
    batchId: options.batchId || row.batchId || row.batch_id,
    rowId: row.rowId || row.row_id,
  });
  const jobHandle = normalizeLineHandle(job?.payload?.line_handle);
  const receiptHandle = normalizeLineHandle(shared.line_handle);
  const selected = sharedHeroEvidenceFromRow(current);
  const persisted = validatedPersistedDispatch(current);
  const currentRecord = recordOf(current);
  const nativeEvidence = objectOf(persisted?.releaseEvidence) || {};
  const nativeProof = objectOf(nativeEvidence.proofIdentity || nativeEvidence.proof_identity) || {};
  const nativeShared = objectOf(nativeEvidence.sharedReleaseEvidence || nativeEvidence.shared_release_evidence) || {};
  const finalUrl = sanitizePreviewUrl(shared.preview_url);
  const expectedUrl = sanitizePreviewUrl(row.previewUrl || current.preview_url || currentRecord.preview_url || "");
  const reelUrl = String(job?.result?.url || "").trim();
  const storedReelUrl = String(currentRecord.media_bank?.hero_reel?.url || "").trim();
  const clipSha256 = String(job?.result?.clip_sha256 || "").trim().toLowerCase();
  const storage = objectOf(receipt.storage) || {};
  const audit = objectOf(receipt.audit) || {};
  const receiptRecord = objectOf(receipt.record) || {};
  let reelPath = "";
  try { reelPath = new URL(reelUrl).pathname; } catch { /* invalid URL */ }

  if (!expectedHandle || !jobHandle || !receiptHandle
    || !sameCanonical(expectedHandle, jobHandle)
    || !sameCanonical(jobHandle, receiptHandle)
    || !sameCanonical(expectedHandle, receiptHandle)
    || job?.result?.ok !== true
    || String(job?.result?.completed_by || "") !== "verified_upload"
    || String(job?.result?.action || "") !== "complete"
    || String(receiptRecord.prospect_id || "").trim() !== String(row.prospectId || row.prospect_id || "").trim()
    || audit.type !== "hero_clip.asset_stored"
    || !selected.ok
    || !persisted
    || !sameCanonical(selected.identity, proof)
    || !sameCanonical(selected.evidence, evidence)
    || !sameCanonical(nativeProof, proof)
    || !sameCanonical(nativeShared, evidence)
    || String(previous.site_id || "") !== String(proof.site_id || "")
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(previous.release_id || ""))
    || !/^[a-f0-9]{64}$/i.test(String(previous.build_hash || ""))
    || String(previous.release_id || "") === String(proof.release_id || "")
    || String(previous.build_hash || "").toLowerCase() === String(proof.build_hash || "").toLowerCase()
    || !finalUrl
    || (expectedUrl && finalUrl !== expectedUrl)
    || persisted.previewUrl !== finalUrl
    || persisted.buildHash !== String(proof.build_hash || "")
    || !/^[a-f0-9]{64}$/.test(clipSha256)
    || selected.heroVideoSha256 !== clipSha256
    || selected.heroVideoPath !== String(shared.hero_video_path || "")
    || String(shared.hero_video_sha256 || "").toLowerCase() !== clipSha256
    || String(storage.sha256 || "").toLowerCase() !== clipSha256
    || !String(storage.object_path || "").endsWith(`/${clipSha256}.mp4`)
    || !/^https:\/\//i.test(reelUrl)
    || !reelPath.endsWith(`/${clipSha256}.mp4`)
    || reelUrl !== storedReelUrl
    || !String(shared.record_write_id || "").trim()
    || String(shared.record_write_id || "").trim() !== String(receiptRecord.write_id || "").trim()) return null;

  return {
    previewUrl: finalUrl,
    buildHash: persisted.buildHash,
    reelUrl,
    siteId: String(proof.site_id || ""),
    releaseId: String(proof.release_id || ""),
    releasedAt: String(job.updatedAt || job.updated_at || job.finishedAt || job.finished_at || ""),
  };
}

async function enqueueCompletedLineHero(row, current, record, options = {}) {
  if (!heroAutolineEnabled(options.env || process.env)) {
    return { ok: true, queued: false, required: false, ready: true, fallback: true, skipped: "disabled" };
  }
  // WHAT THE PRODUCER ACTUALLY EATS (owner, 2026-08-23). This gate used to demand
  // a harvested `record.photo_bank` and HOLD the whole build without one. That
  // guarded a resource the hero lane never reads: the Ads Station fetches its own
  // images through the picker's "Website or social" tab, pointed at the client's
  // LEGACY site — and it reaches their Facebook/Instagram too, which is where a
  // small trade business actually keeps real job photos. Measured on live scans:
  // truecomfortiowa.com returned 6 of their own images (crew, branded fleet) and
  // absolute-landscape.com returned 14, both surfacing social profiles as well.
  // Requiring our bank first rejected ~8 of every 12 prospects and dropped the
  // factory's yield to ZERO while the producer would have been fine.
  //
  // So the gate now asks the only question that matters: is there something the
  // Station can point at? A harvested bank still counts (it is a fine source),
  // but a legacy URL is enough on its own.
  const bank = record && record.photo_bank;
  const bankHasPhotos = Boolean(bank && Array.isArray(bank.photos) && bank.photos.length);
  const scannableSource = firstScannableSource(record, current, row);
  if (!bankHasPhotos && !scannableSource) {
    // Nothing to harvest and nothing to scan. STILL DO NOT HOLD THE SITE: a
    // missing hero video is a missing garnish, not a broken build. The mirror
    // ships on the donor's fallback rung and says so, and the couture clip can
    // be attached later if a source ever appears.
    return {
      ok: true,
      queued: false,
      required: false,
      ready: true,
      fallback: true,
      skipped: "no_scannable_hero_source",
      reason: "no_scannable_hero_source",
    };
  }
  const start = options.enqueueHeroRemasterForBuild
    || require("./full-run").enqueueHeroRemasterForBuild;
  try {
    const reuseJobId = String(
      objectOf(row.heroRemaster)?.jobId || objectOf(row.hero_remaster)?.job_id
      || objectOf(record.hero_reel_applied)?.hero_job_id
      || objectOf(record.line_hero_rebuild)?.hero_job_id
      || options.reuseJobId
      || "",
    ).trim();
    // inspectOnly is a read-only stale-job probe. In particular it must not
    // pass reofferBuildHash into the queue: an old terminal job may only be
    // reopened after the refreshed photo bank has won its durable CAS.
    const started = options.reuseOnly === true || options.inspectOnly === true
      ? (reuseJobId ? { ok: true, reused: true, job_id: reuseJobId } : { ok: false, reason: "hero_reuse_identity_missing" })
      : await start({
      prospect_id: row.prospectId,
      business_name: row.businessName || current.business_name || record.business_name,
      preview_url: row.previewUrl,
      current_website: record.current_website || current.current_website || row.currentWebsite,
      record,
    }, {
      persist: true,
      dryRun: false,
      env: options.env || process.env,
      lineHandle: {
        batchId: options.batchId || row.batchId || row.batch_id,
        rowId: row.rowId || row.row_id,
      },
      enqueueHeroReelJob: options.enqueueHeroReelJob,
      reofferBuildHash: String(row.buildHash || row.build_hash || "").trim(),
      expectedStaleJobSnapshot: options.expectedStaleJobSnapshot,
      signal: options.signal,
      deadlineAt: options.deadlineAt,
    });
    // A store outage is uncertain, not permission to ship donor media. Keep the
    // Line retryable while the already-deployed site remains safely unsent.
    // A PROVENANCE refusal is the opposite of uncertain: the durable queue
    // (owner decree, 2026-08-23 — "relaxing 'we have no photos', never 'our
    // photos did not check out'") has definitively declined a couture hero for
    // this build. Retrying it every 30s can never succeed, so the row pends
    // forever while its finished site stays unsent. A definitive refusal ships
    // on the donor's fallback rung — same doctrine as no_scannable_hero_source.
    const enqueueRefusal = String(
      started?.reason || started?.error || "",
    );
    const definitiveEnqueueRefusal = [
      "no_verified_owned_photo",
      "photo_bank_stale_or_missing",
      "producer_not_enabled",
    ].includes(enqueueRefusal);
    if (definitiveEnqueueRefusal) {
      return {
        ok: true,
        queued: false,
        required: false,
        ready: true,
        fallback: true,
        status: "skipped",
        skipped: enqueueRefusal,
        reason: enqueueRefusal,
      };
    }
    if (!started || started.ok !== true) {
      return {
        ...(started || {}),
        required: true,
        ready: false,
        pending: true,
        reason: String(started?.reason || "hero_remaster_enqueue_failed"),
      };
    }
    // A first/base Mirror only needs the durable attempt. A reused terminal
    // verdict can belong to an older Line handle; it must not reject a fresh
    // row before that row has harvested and refreshed its current source.
    const nonProductionSkip = ["disabled", "dry_run", "persistence_disabled"].includes(String(started.skipped || ""));
    if (options.deferJoin === true && !nonProductionSkip) {
      const startedAttempt = Number(started.generation_revision);
      return {
        ...started,
        required: true,
        ready: false,
        pending: true,
        status: "queued",
        job_id: String(started.job_id || started.jobId || ""),
        ...(Number.isSafeInteger(startedAttempt) && startedAttempt > 0
          ? { hero_attempt_id: `hero_attempt:${startedAttempt}` }
          : {}),
      };
    }
    if (started.skipped) {
      const reason = String(started.skipped || "");
      if (["disabled", "dry_run", "persistence_disabled"].includes(reason)) {
        return { ...started, required: false, ready: true, fallback: true };
      }
      return {
        ...started,
        required: true,
        ready: false,
        pending: false,
        hold: true,
        reason: reason || "hero_remaster_skipped_without_policy",
      };
    }

    // Packet admission only needs the durable job handle. Seedance commonly
    // takes minutes, so reading/joining the job here would serialize the base
    // mirror behind video generation. The normal post-build preparation step
    // calls this function without deferJoin and remains the fail-closed join
    // before render, Ready, or email.
    const readHero = options.getHeroReelJobForProspect || getHeroReelJobForProspect;
    const found = await readHero(row.prospectId).catch(() => null);
    const job = found?.ok === true && found.job ? found.job : null;
    if (!job) {
      // The enqueue may have committed even if a read-back was lost. Email is
      // held on uncertainty; the next Line continuation reuses the same job.
      return {
        ...started,
        required: true,
        ready: false,
        pending: true,
        status: "status_unknown",
        reason: "hero_remaster_status_unavailable",
      };
    }

    const status = String(job.status || "");
    const jobId = String(job.jobId || job.job_id || started.job_id || "");
    const generationRevision = Number(
      job.generation_revision
      ?? job.payload?.generation_revision
      ?? job.payload?.generationRevision
      ?? 0,
    );
    const heroAttemptId = Number.isSafeInteger(generationRevision) && generationRevision > 0
      ? `hero_attempt:${generationRevision}`
      : "";
    const jobReason = String(job.result?.reason || "");
    const producer = safeHeroProducer(job.producer || started.producer);
    const expectedJobHandle = normalizeLineHandle({
      batchId: options.batchId || row.batchId || row.batch_id,
      rowId: row.rowId || row.row_id,
      });
    const actualHandle = normalizeLineHandle(
      job.payload?.line_handle || job.payload?.lineHandle
      || job.result?.line_handle || job.result?.lineHandle
      || job.line_handle || job.lineHandle,
    );
    if (expectedJobHandle && actualHandle
      && (expectedJobHandle.batchId !== actualHandle.batchId || expectedJobHandle.rowId !== actualHandle.rowId)) {
      const observedRevision = Number(job.payload?.generation_revision ?? job.payload?.generationRevision ?? job.revision ?? 0);
      const persistedBase = validatedPersistedDispatch(current);
      const rowBuildHash = String(row.buildHash || row.build_hash || "").trim();
      const rowPreviewUrl = sanitizePreviewUrl(row.previewUrl || row.preview_url || "");
      const verifiedCurrentBase = /^[a-f0-9]{64}$/i.test(rowBuildHash)
        && persistedBase?.buildHash === rowBuildHash
        && Boolean(rowPreviewUrl)
        && persistedBase.previewUrl === rowPreviewUrl;
      const checkpointedCarriedBase = !verifiedCurrentBase
        && options.lane === "sandbox"
        && Boolean(rejectedForeignSubmittingCheckpointSnapshot(job))
        && Boolean(verifiedStaticHeroBase(row, current));
      const jobBuildHash = String(job.payload?.line_build_hash || "").trim().toLowerCase();
      const sameBuildForeignTerminal = ["failed", "refused"].includes(status)
        && (verifiedCurrentBase || checkpointedCarriedBase)
        && /^[a-f0-9]{64}$/.test(jobBuildHash)
        && jobBuildHash === rowBuildHash.toLowerCase();
      if (sameBuildForeignTerminal) {
        const foreignStaticResolution = await sandboxForeignHandleOperationalStaticHeroResolution({
          row,
          current,
          job,
          status,
          reason: jobReason,
          producer,
          jobId,
          heroAttemptId,
          expectedHandle: expectedJobHandle,
          actualHandle,
          options,
        });
        if (foreignStaticResolution) return foreignStaticResolution;
        // The retired Ads worker still has one operator-owned terminal state.
        // A foreign handle must not downgrade that explicit hold to fallback.
        if (status === "failed" && jobReason === "ads_blocked_by_extension") {
          return {
            ...started,
            required: true,
            ready: false,
            pending: true,
            status: "operator_action_required",
            job_id: jobId,
            build_hash: rowBuildHash,
            ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
            reason: jobReason,
            ...(producer ? { producer } : {}),
          };
        }
        const rawReofferCount = job.payload?.line_same_build_reoffer_count;
        // Durable encoding is deliberately binary: absence means zero and the
        // only accepted stored value is one. Malformed values fail closed.
        const reofferCount = rawReofferCount == null ? 0 : (rawReofferCount === 1 ? 1 : -1);
        // A dimensions failure happened after a paid provider submission. It is
        // eligible for the same one-shot repair only when the durable accepted
        // provider checkpoint is clearly the checkpoint for this exact job and
        // revision. The queue still performs the full photo/intent validation
        // and owns the atomic counter transition.
        const acceptedDimensionRecovery = status === "failed"
          && producer === "openrouter_seedance"
          && jobReason === "clip_dimensions_out_of_range"
          && clearlyAcceptedSeedanceCheckpoint(job, row.prospectId || row.prospect_id, observedRevision);
        const oneShotRepairAvailable = reofferCount === 0
          && (REPAIRABLE_SAME_BUILD_HERO_REASONS.has(jobReason) || acceptedDimensionRecovery);
        // Only this exact state may fall through to the mismatch snapshot below:
        // the post-ATTACH continuation refreshes the photo bytes, wins its
        // prospect CAS, then the queue atomically consumes the one-shot counter.
        if (!oneShotRepairAvailable) {
          const definitiveRefusal = producer === RETIRED_HERO_PRODUCER
            || DEFINITIVE_HERO_REFUSAL_REASONS.has(jobReason);
          if (definitiveRefusal) {
            return {
              ok: true,
              queued: false,
              required: false,
              ready: true,
              pending: false,
              hold: false,
              fallback: true,
              status: "skipped",
              skipped: jobReason || `hero_remaster_${status}`,
              reason: jobReason || `hero_remaster_${status}`,
              job_id: jobId,
              build_hash: rowBuildHash,
              ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
              ...(producer ? { producer } : {}),
            };
          }
          return {
            ...started,
            required: true,
            ready: false,
            pending: false,
            hold: true,
            status,
            job_id: jobId,
            build_hash: rowBuildHash,
            ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
            reason: jobReason || `hero_remaster_${status}`,
            ...(producer ? { producer } : {}),
          };
        }
      }
      if (status === "done" && verifiedCurrentBase) {
        // A completed clip is immutable evidence for the Line handle that
        // commissioned it. It can never be attached to a later campaign row.
        // Once this row's donor/base Mirror is independently proven, however,
        // the foreign completion is also not a reason to strand that site:
        // ship the verified base on its honest fallback rung and leave every
        // video field empty. Failed/refused jobs take the differentiated CAS
        // reoffer below; pending work for this handle remains pending.
        return {
          ok: true,
          queued: false,
          required: false,
          ready: true,
          pending: false,
          hold: false,
          fallback: true,
          status: "skipped",
          skipped: "stale_done_line_handle_ignored",
          reason: "stale_done_line_handle_ignored",
          job_id: jobId,
          build_hash: rowBuildHash,
          ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
          ...(producer ? { producer } : {}),
        };
      }
      return {
        ...started,
        required: true,
        ready: false,
        pending: true,
        status: "stale_line_handle",
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        reason: "hero_remaster_line_handle_mismatch",
        stale_job_snapshot: {
          job_id: jobId,
          status,
          revision: Number.isInteger(observedRevision) ? observedRevision : 0,
          line_handle: actualHandle,
          lease_token: String(job.lease_token || job.leaseToken || ""),
          lease_owner: String(job.lease_owner || job.leaseOwner || ""),
          lease_expires_at: String(job.lease_expires_at || job.leaseExpiresAt || ""),
        },
      };
    }
    // A visible browser extension blocking Google Ads needs an operator to fix
    // the existing CDP profile and explicitly retry the durable failed job. It
    // is not a bad prospect, and automatic requeue would hot-loop forever.
    if (status === "failed" && jobReason === "ads_blocked_by_extension") {
      return {
        ...started,
        required: true,
        ready: false,
        pending: true,
        status: "operator_action_required",
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        reason: jobReason,
        ...(producer ? { producer } : {}),
      };
    }
    if (["failed", "refused"].includes(status)) {
      // A terminal verdict from the RETIRED Ads producer (or any lane's
      // definitive provenance refusal) can never be worked again: the Station
      // is gone, the reoffer needs a refreshed bank that will not come, and
      // polling the dead verdict forever parks a finished site. Same doctrine
      // as the enqueue-side refusal: a missing couture hero is a missing
      // garnish — the mirror ships on the donor's fallback rung and records
      // which check refused. Refusals from LIVE producers (seedance content
      // policy, worker failures) keep the operator-review hold.
      // inspectOnly probes (carried stale markers, mirror resume) must keep
      // their stricter pending/hold contract — an unverified marker never
      // drives anything. Only a fresh post-build join resolves the dead
      // verdict to a fallback ship.
      const staticResolution = sandboxOperationalStaticHeroResolution({
        row,
        current,
        job,
        status,
        reason: jobReason,
        producer,
        jobId,
        heroAttemptId,
        expectedHandle: expectedJobHandle,
        actualHandle,
        options,
      });
      if (staticResolution) return staticResolution;
      const definitiveJobRefusal = options.inspectOnly !== true
        && (producer === RETIRED_HERO_PRODUCER
          || DEFINITIVE_HERO_REFUSAL_REASONS.has(jobReason));
      if (definitiveJobRefusal) {
        return {
          ok: true,
          queued: false,
          required: false,
          ready: true,
          fallback: true,
          status: "skipped",
          job_id: jobId,
          ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
          reason: jobReason || `hero_remaster_${status}`,
          ...(producer ? { producer } : {}),
        };
      }
      return {
        ...started,
        required: true,
        ready: false,
        hold: true,
        status,
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        reason: jobReason || `hero_remaster_${status}`,
      };
    }
    if (status !== "done") {
      return {
        ...started,
        required: true,
        ready: false,
        pending: true,
        status,
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
      };
    }

    const uploadReceipt = objectOf(job.result?.upload_receipt) || {};
    const rebuildReceipt = objectOf(uploadReceipt.rebuild);
    const sharedReceipt = objectOf(uploadReceipt.shared_release);
    if (rebuildReceipt && sharedReceipt) {
      return {
        ...started,
        required: true,
        ready: false,
        pending: false,
        hold: true,
        status,
        job_id: jobId,
        reason: "hero_completion_receipt_ambiguous",
      };
    }
    if (sharedReceipt) {
      const shared = exactSharedHeroCompletion(job, current, row, options);
      if (!shared) {
        return {
          ...started,
          required: true,
          ready: false,
          pending: false,
          hold: true,
          status,
          job_id: jobId,
          ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
          reason: "hero_shared_release_identity_unproven",
        };
      }
      return {
        ...started,
        required: true,
        ready: true,
        applied: true,
        status,
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        completion_mode: "shared_release",
        shared_site_id: shared.siteId,
        shared_release_id: shared.releaseId,
        build_hash: shared.buildHash,
        reel_url: shared.reelUrl,
        released_at: shared.releasedAt,
      };
    }

    const rebuildId = String(
      rebuildReceipt?.job_id
      || rebuildReceipt?.jobId
      || "",
    ).trim();
    if (!rebuildId) {
      return {
        ...started,
        required: true,
        ready: false,
        pending: false,
        hold: true,
        status,
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        reason: "hero_rebuild_receipt_missing",
      };
    }
    const readRebuild = options.getRebuildJob || getRebuildJob;
    const rebuilt = await readRebuild(rebuildId).catch(() => null);
    const rebuild = rebuilt?.ok === true && rebuilt.job ? rebuilt.job : null;
    if (!rebuild) {
      return {
        ...started,
        required: true,
        ready: false,
        pending: true,
        status,
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        rebuild_job_id: rebuildId,
        reason: "hero_rebuild_status_unavailable",
      };
    }
    const rebuildStatus = String(rebuild.status || "");
    if (["failed", "refused"].includes(rebuildStatus)
      || (rebuildStatus === "done" && rebuild.result?.ok !== true)) {
      return {
        ...started,
        required: true,
        ready: false,
        hold: true,
        status,
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        rebuild_status: rebuildStatus,
        rebuild_job_id: rebuildId,
        reason: String(rebuild.result?.reason || `hero_rebuild_${rebuildStatus || "failed"}`),
      };
    }
    if (rebuildStatus !== "done") {
      return {
        ...started,
        required: true,
        ready: false,
        pending: true,
        status,
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        rebuild_status: rebuildStatus,
        rebuild_job_id: rebuildId,
      };
    }
    const finalUrl = sanitizePreviewUrl(rebuild.result?.preview_url || "");
    const expectedUrl = sanitizePreviewUrl(row.previewUrl || current.preview_url || record.preview_url || "");
    const finalHash = String(rebuild.result?.build_hash || "").trim();
    const reelUrl = String(job.result?.url || "").trim();
    const storedReelUrl = String(record?.media_bank?.hero_reel?.url || "").trim();
    const expectedHandle = normalizeLineHandle({
      batchId: options.batchId || row.batchId || row.batch_id,
      rowId: row.rowId || row.row_id,
    });
    const markerMatches = Boolean(expectedHandle && validatedLineHeroRebuild(
      current,
      {
        ...row,
        heroRemaster: {
          ...(objectOf(row.heroRemaster) || {}),
          jobId,
          rebuildJobId: rebuildId,
        },
      },
      { batchId: expectedHandle.batchId },
    ));
    if (rebuild.result?.line_artifact_ready !== true || !markerMatches) {
      return {
        ...started,
        required: true,
        ready: false,
        pending: false,
        hold: true,
        status,
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        rebuild_status: rebuildStatus,
        rebuild_job_id: rebuildId,
        reason: String(
          rebuild.result?.proof_reason
          || rebuild.result?.reason
          || "hero_rebuild_artifact_unproven",
        ),
      };
    }
    if (!finalUrl || (expectedUrl && finalUrl !== expectedUrl)
      || !finalHash || !reelUrl || storedReelUrl !== reelUrl) {
      // A completed row with mismatched identities is not a completed hero.
      return {
        ...started,
        required: true,
        ready: false,
        pending: false,
        hold: true,
        status,
        job_id: jobId,
        ...(heroAttemptId ? { hero_attempt_id: heroAttemptId } : {}),
        rebuild_status: rebuildStatus,
        rebuild_job_id: rebuildId,
        reason: "hero_rebuild_identity_unproven",
      };
    }
    return {
      ...started,
      required: true,
      ready: true,
      applied: true,
      status,
      job_id: jobId,
      rebuild_status: rebuildStatus,
      rebuild_job_id: rebuildId,
      build_hash: finalHash,
      reel_url: reelUrl,
      rebuilt_at: String(rebuild.updatedAt || rebuild.updated_at || ""),
    };
  } catch {
    return {
      ok: false,
      queued: false,
      required: true,
      ready: false,
      pending: true,
      reason: "hero_remaster_enqueue_failed",
    };
  }
}

function compactHeroRemaster(result = {}) {
  if (!result || (result.required !== true && result.fallback !== true)) return null;
  const producer = safeHeroProducer(result.producer);
  const attemptId = String(result.hero_attempt_id || result.heroAttemptId || "");
  const videoAttempts = Number(result.video_attempts ?? result.videoAttempts);
  const videoAttemptCap = Number(result.video_attempt_cap ?? result.videoAttemptCap);
  const foreignJobGenerationRevision = Number(
    result.foreign_job_generation_revision ?? result.foreignJobGenerationRevision,
  );
  return {
    required: result.required === true,
    ready: result.ready === true,
    pending: result.pending === true,
    hold: result.hold === true,
    fallback: result.fallback === true,
    applied: result.applied === true,
    status: String(result.status || ""),
    jobId: String(result.job_id || result.jobId || ""),
    rebuildStatus: String(result.rebuild_status || ""),
    rebuildJobId: String(result.rebuild_job_id || ""),
    buildHash: String(result.build_hash || result.buildHash || ""),
    reelUrl: String(result.reel_url || ""),
    reason: String(result.reason || result.skipped || ""),
    ...(String(result.completion_mode || result.completionMode || "").trim()
      ? { completionMode: String(result.completion_mode || result.completionMode).trim() }
      : {}),
    ...(String(result.shared_site_id || result.sharedSiteId || "").trim()
      ? { sharedSiteId: String(result.shared_site_id || result.sharedSiteId).trim() }
      : {}),
    ...(String(result.shared_release_id || result.sharedReleaseId || "").trim()
      ? { sharedReleaseId: String(result.shared_release_id || result.sharedReleaseId).trim() }
      : {}),
    ...(attemptId ? { attemptId } : {}),
    ...(producer ? { producer } : {}),
    ...(result.static_hero_verified === true || result.staticHeroVerified === true
      ? { staticHeroVerified: true }
      : {}),
    ...(String(result.static_hero_source || result.staticHeroSource || "").trim()
      ? { staticHeroSource: String(result.static_hero_source || result.staticHeroSource).trim() }
      : {}),
    ...(String(result.static_hero_photo_sha256 || result.staticHeroPhotoSha256 || "").trim()
      ? { staticHeroPhotoSha256: String(result.static_hero_photo_sha256 || result.staticHeroPhotoSha256).trim().toLowerCase() }
      : {}),
    ...(String(result.static_hero_photo_url || result.staticHeroPhotoUrl || "").trim()
      ? { staticHeroPhotoUrl: String(result.static_hero_photo_url || result.staticHeroPhotoUrl).trim() }
      : {}),
    ...(String(result.static_hero_bank_fingerprint || result.staticHeroBankFingerprint || "").trim()
      ? { staticHeroBankFingerprint: String(result.static_hero_bank_fingerprint || result.staticHeroBankFingerprint).trim().toLowerCase() }
      : {}),
    ...(String(result.base_evidence_sha || result.baseEvidenceSha || "").trim()
      ? { baseEvidenceSha: String(result.base_evidence_sha || result.baseEvidenceSha).trim() }
      : {}),
    ...(String(result.line_batch_id || result.lineBatchId || "").trim()
      ? { lineBatchId: String(result.line_batch_id || result.lineBatchId).trim() }
      : {}),
    ...(String(result.line_row_id || result.lineRowId || "").trim()
      ? { lineRowId: String(result.line_row_id || result.lineRowId).trim() }
      : {}),
    ...(String(result.foreign_job_binding_schema || result.foreignJobBindingSchema || "").trim()
      ? { foreignJobBindingSchema: String(result.foreign_job_binding_schema || result.foreignJobBindingSchema).trim() }
      : {}),
    ...(String(result.foreign_job_binding_sha256 || result.foreignJobBindingSha256 || "").trim()
      ? { foreignJobBindingSha256: String(result.foreign_job_binding_sha256 || result.foreignJobBindingSha256).trim().toLowerCase() }
      : {}),
    ...(String(result.foreign_job_prospect_id || result.foreignJobProspectId || "").trim()
      ? { foreignJobProspectId: String(result.foreign_job_prospect_id || result.foreignJobProspectId).trim() }
      : {}),
    ...(Number.isSafeInteger(foreignJobGenerationRevision) && foreignJobGenerationRevision > 0
      ? { foreignJobGenerationRevision }
      : {}),
    ...(String(result.foreign_job_line_batch_id || result.foreignJobLineBatchId || "").trim()
      ? { foreignJobLineBatchId: String(result.foreign_job_line_batch_id || result.foreignJobLineBatchId).trim() }
      : {}),
    ...(String(result.foreign_job_line_row_id || result.foreignJobLineRowId || "").trim()
      ? { foreignJobLineRowId: String(result.foreign_job_line_row_id || result.foreignJobLineRowId).trim() }
      : {}),
    ...(String(result.foreign_job_build_hash || result.foreignJobBuildHash || "").trim()
      ? { foreignJobBuildHash: String(result.foreign_job_build_hash || result.foreignJobBuildHash).trim().toLowerCase() }
      : {}),
    ...(String(result.foreign_job_snapshot_sha256 || result.foreignJobSnapshotSha256 || "").trim()
      ? { foreignJobSnapshotSha256: String(result.foreign_job_snapshot_sha256 || result.foreignJobSnapshotSha256).trim().toLowerCase() }
      : {}),
    ...(String(result.foreign_job_checkpoint_sha256 || result.foreignJobCheckpointSha256 || "").trim()
      ? { foreignJobCheckpointSha256: String(result.foreign_job_checkpoint_sha256 || result.foreignJobCheckpointSha256).trim().toLowerCase() }
      : {}),
    ...(String(result.foreign_job_status || result.foreignJobStatus || "").trim()
      ? { foreignJobStatus: String(result.foreign_job_status || result.foreignJobStatus).trim() }
      : {}),
    ...(String(result.foreign_job_result_reason || result.foreignJobResultReason || "").trim()
      ? { foreignJobResultReason: String(result.foreign_job_result_reason || result.foreignJobResultReason).trim() }
      : {}),
    ...(String(result.foreign_job_updated_at || result.foreignJobUpdatedAt || "").trim()
      ? { foreignJobUpdatedAt: String(result.foreign_job_updated_at || result.foreignJobUpdatedAt).trim() }
      : {}),
    ...(String(result.foreign_job_finished_at || result.foreignJobFinishedAt || "").trim()
      ? { foreignJobFinishedAt: String(result.foreign_job_finished_at || result.foreignJobFinishedAt).trim() }
      : {}),
    ...(String(result.foreign_job_consumption_reason || result.foreignJobConsumptionReason || "").trim()
      ? { foreignJobConsumptionReason: String(result.foreign_job_consumption_reason || result.foreignJobConsumptionReason).trim() }
      : {}),
    ...(String(result.video_failure_reason || result.videoFailureReason || "").trim()
      ? { videoFailureReason: String(result.video_failure_reason || result.videoFailureReason).trim() }
      : {}),
    ...(String(result.video_retry_budget_exhausted_by || result.videoRetryBudgetExhaustedBy || "").trim()
      ? { videoRetryBudgetExhaustedBy: String(
        result.video_retry_budget_exhausted_by || result.videoRetryBudgetExhaustedBy,
      ).trim() }
      : {}),
    ...(String(result.video_terminal_reason || result.videoTerminalReason || "").trim()
      ? { videoTerminalReason: String(result.video_terminal_reason || result.videoTerminalReason).trim() }
      : {}),
    ...(Number.isSafeInteger(videoAttempts) && videoAttempts >= 0 ? { videoAttempts } : {}),
    ...(Number.isSafeInteger(videoAttemptCap) && videoAttemptCap > 0 ? { videoAttemptCap } : {}),
  };
}

function heroAppliedMarker(result = {}, previewUrl = "") {
  if (result.applied !== true) return null;
  const completionMode = String(result.completion_mode || result.completionMode || "").trim();
  if (completionMode === "shared_release") {
    const marker = {
      completion_mode: completionMode,
      hero_job_id: String(result.job_id || result.jobId || "").trim(),
      shared_site_id: String(result.shared_site_id || result.sharedSiteId || "").trim(),
      shared_release_id: String(result.shared_release_id || result.sharedReleaseId || "").trim(),
      build_hash: String(result.build_hash || result.buildHash || "").trim(),
      reel_url: String(result.reel_url || "").trim(),
      preview_url: sanitizePreviewUrl(previewUrl),
      released_at: String(result.released_at || "").trim(),
    };
    return marker.hero_job_id && marker.shared_site_id && marker.shared_release_id
      && marker.build_hash && marker.reel_url && marker.preview_url ? marker : null;
  }
  const marker = {
    hero_job_id: String(result.job_id || result.jobId || "").trim(),
    rebuild_job_id: String(result.rebuild_job_id || "").trim(),
    build_hash: String(result.build_hash || "").trim(),
    reel_url: String(result.reel_url || "").trim(),
    preview_url: sanitizePreviewUrl(previewUrl),
    rebuilt_at: String(result.rebuilt_at || "").trim(),
  };
  return marker.hero_job_id && marker.rebuild_job_id && marker.build_hash
    && marker.reel_url && marker.preview_url ? marker : null;
}

async function persistAppliedLineHero(row, current, result, options = {}) {
  const marker = heroAppliedMarker(result, row.previewUrl);
  if (!marker) return { ok: false, reason: "hero_rebuild_identity_unproven" };
  const currentRecord = recordOf(current);
  if (sameCanonical(objectOf(currentRecord.hero_reel_applied), marker)) {
    return { ok: true, reconciled: true, current };
  }
  const at = new Date().toISOString();
  const update = options.conditionalUpdate || conditionalUpdate;
  const written = await update(
    PROSPECTS,
    "prospect_id",
    row.prospectId,
    { updated_at: `eq.${String(current.updated_at || "").trim()}` },
    {
      record: { ...currentRecord, hero_reel_applied: marker },
      updated_at: at,
    },
    { signal: options.signal, deadlineAt: options.deadlineAt },
  ).catch(() => null);
  if (written?.ok === true && written.updated === true) {
    const committed = Array.isArray(written.rows) ? written.rows[0] : null;
    return { ok: true, current: committed || { ...current, record: { ...currentRecord, hero_reel_applied: marker }, updated_at: at } };
  }
  const read = options.select || select;
  const reread = await read(
    PROSPECTS,
    `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
    { signal: options.signal, deadlineAt: options.deadlineAt },
  ).catch(() => null);
  const durable = reread?.ok === true && Array.isArray(reread.data) ? reread.data[0] : null;
  return durable && sameCanonical(objectOf(recordOf(durable).hero_reel_applied), marker)
    ? { ok: true, reconciled: true, current: durable }
    : { ok: false, reason: "hero_completion_persist_pending" };
}

async function refreshDurableOwnPhotoBank(bank, website, options = {}) {
  const normalizeHost = (value) => {
    try { return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); }
    catch { return ""; }
  };
  const websiteHost = normalizeHost(website);
  const rows = Array.isArray(bank?.photos) ? bank.photos.filter((photo) => photo?.source === "own_site") : [];
  const eligible = rows.filter((photo) => {
    const url = String(photo?.url || "");
    const foundOn = String(photo?.found_on || "");
    return websiteHost && /^https:\/\//i.test(url) && /^https:\/\//i.test(foundOn)
      && normalizeHost(url) === websiteHost && normalizeHost(foundOn) === websiteHost;
  }).slice(0, 12);
  if (!eligible.length) return { ok: false, reason: "hero_photo_refresh_provenance_refused" };
  const download = options.downloadPublicImage || require("./hero-seedance-runner").downloadPublicOutput;
  const { imageSize } = require("./mirror-engine/client-photos");
  const { imageMime } = require("./hero-seedance-runner");
  const photos = [];
  const failures = [];
  const ownerDeadline = Number(options.deadlineAt);
  const refreshDeadline = Math.min(Number.isFinite(ownerDeadline) ? ownerDeadline : Infinity, Date.now() + 30_000);
  for (const photo of eligible) {
    const url = String(photo.url);
    if (options.signal?.aborted || Date.now() >= refreshDeadline) { failures.push("refresh_deadline"); break; }
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { failures.push("invalid_url"); continue; }
    const bytes = await download(url, {
      timeoutMs: Math.max(1, refreshDeadline - Date.now()), maxBytes: 12 * 1024 * 1024, requiredHost: host,
      requestHeaders: { "user-agent": "Mozilla/5.0 WSSLabs-photos" },
      lookupImpl: options.lookupImpl, httpsImpl: options.httpsImpl, signal: options.signal,
    }).catch((error) => { failures.push(String(error?.message || "download_failed").slice(0, 80)); return null; });
    if (!bytes?.length) continue;
    const mime = imageMime(bytes);
    const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" })[mime];
    if (!ext) { failures.push("source_image_type_invalid"); continue; }
    const size = imageSize(Buffer.from(bytes), ext);
    photos.push({ url, source: "own_site", sha256: createHash("sha256").update(bytes).digest("hex"), width: size.w, height: size.h, bytes: bytes.length, ext });
  }
  if (!photos.length) return { ok: false, reason: `hero_photo_refresh_failed:${failures[0] || "no_valid_bytes"}` };
  const refreshed = photoBank.bankFromHarvest(photos, { website, foundOn: website });
  return refreshed?.photos?.length ? { ok: true, bank: refreshed } : { ok: false, reason: "hero_photo_refresh_classification_failed" };
}

/** Persist a newly harvested own-photo bank before any stock-era gate/proof. */
async function prepareMirroredHero(row = {}, built = {}, options = {}) {
  if (!heroAutolineEnabled(options.env || process.env)) {
    return { ok: true, required: false, ready: true, fallback: true, skipped: "disabled" };
  }
  const reuseOnlyBoundary = objectOf(row.heroRemaster)?.applied === true || Boolean(built.recovery) || options.heroRebuild === true;
  if (reuseOnlyBoundary) {
    const read = options.select || select;
    const loaded = await read(PROSPECTS, `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`, {
      signal: options.signal, deadlineAt: options.deadlineAt,
    }).catch(() => null);
    let current = loaded?.ok === true && Array.isArray(loaded.data) ? loaded.data[0] : null;
    if (!current) return { ok: false, required: true, pending: true, reason: "hero_photo_bank_record_read_failed" };
    const result = await enqueueCompletedLineHero({
      ...row,
      previewUrl: built.previewUrl || row.previewUrl,
      buildHash: built.buildHash || row.buildHash,
    }, current, recordOf(current), { ...options, reuseOnly: true, reuseJobId: built.heroJobId });
    if (result.applied === true) {
      const persisted = await persistAppliedLineHero({ ...row, previewUrl: built.previewUrl || row.previewUrl }, current, result, options);
      if (!persisted.ok) return { ok: false, required: true, pending: true, reason: persisted.reason, heroRemaster: { ...result, applied: false, ready: false, pending: true } };
      current = persisted.current || current;
    }
    return { ok: true, required: true, heroRemaster: result, rowPatch: { durableUpdatedAt: String(current.updated_at || ""), heroRemaster: compactHeroRemaster(result) } };
  }
  // Same correction as the enqueue path above: a harvested bank is one source,
  // not the only one. The Station scans the client's legacy site (and their
  // socials) for itself, so an absent bank is not a reason to hold a finished
  // site hostage — it ships on the donor's fallback rung and records why.
  const candidate = built.ownedPhotoBank || built.owned_photo_bank;
  if (!candidate) {

    // BOTH LESSONS, KEPT (merge of #318 with the 2026-08-23 yield fix).
    //
    // From #318: this build harvested no bank of its own, but the DURABLE record
    // may already carry usable photos — GBP images banked at mine time are the
    // important case, because a prospect whose own website is offline has no
    // other source. So we re-read the record and give the queue a real chance
    // before giving up on a couture hero.
    //
    // From tonight: a refusal here must NOT hold the build. The old code set
    // hold:true and that took the factory's yield to zero — ten live-capable
    // prospects produced nothing. A missing hero video is a missing garnish, not
    // a broken plate: the mirror ships on the donor's fallback rung and records
    // exactly which check refused, so the console still shows the truth.
    const readFallback = options.select || select;
    const fallbackLoaded = await readFallback(
      PROSPECTS,
      `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
      { signal: options.signal, deadlineAt: options.deadlineAt },
    ).catch(() => null);
    let fallbackCurrent = fallbackLoaded?.ok === true && Array.isArray(fallbackLoaded.data)
      ? fallbackLoaded.data[0]
      : null;
    if (fallbackCurrent) {
      let fallbackRecord = recordOf(fallbackCurrent);
      const durableBank = objectOf(fallbackRecord.photo_bank);
      const durableWebsite = String(fallbackCurrent.current_website || fallbackRecord.current_website || built.currentWebsite || row.currentWebsite || "").trim();
      if (Array.isArray(durableBank?.photos) && durableBank.photos.some((photo) => photo?.source === "own_site")) {
        const refreshed = await refreshDurableOwnPhotoBank(durableBank, durableWebsite, options);
        const update = options.conditionalUpdate || conditionalUpdate;
        const at = new Date().toISOString();
        if (!refreshed.ok) {
          const marker = { reason: refreshed.reason, at, source_count: durableBank.photos.length };
          await update(PROSPECTS, "prospect_id", row.prospectId,
            { updated_at: `eq.${String(fallbackCurrent.updated_at || "").trim()}` },
            { record: { ...fallbackRecord, hero_photo_refresh: marker }, updated_at: at },
            { signal: options.signal, deadlineAt: options.deadlineAt }).catch(() => null);
          return { ok: false, required: true, pending: true, reason: refreshed.reason, heroRemaster: { required: true, ready: false, pending: true, reason: refreshed.reason } };
        }
        const stored = await update(PROSPECTS, "prospect_id", row.prospectId,
          { updated_at: `eq.${String(fallbackCurrent.updated_at || "").trim()}` },
          { record: { ...fallbackRecord, photo_bank: refreshed.bank, hero_photo_refresh: { reason: "refreshed", at, source_count: refreshed.bank.photos.length } }, updated_at: at },
          { signal: options.signal, deadlineAt: options.deadlineAt }).catch(() => null);
        if (!stored?.ok || stored.updated !== true) {
          return { ok: false, required: true, pending: true, reason: "hero_photo_refresh_cas_pending", heroRemaster: { required: true, ready: false, pending: true, reason: "hero_photo_refresh_cas_pending" } };
        }
        const committed = Array.isArray(stored.rows) ? stored.rows[0] : null;
        fallbackCurrent = committed || { ...fallbackCurrent, record: { ...fallbackRecord, photo_bank: refreshed.bank }, updated_at: at };
        fallbackRecord = recordOf(fallbackCurrent);
      }
      const fallbackRemaster = await enqueueCompletedLineHero({
        ...row,
        previewUrl: built.previewUrl || row.previewUrl,
        currentWebsite: built.currentWebsite || row.currentWebsite,
        buildHash: built.buildHash || row.buildHash,
      }, fallbackCurrent, fallbackRecord, options);
      // Required results are durable join states even when the enqueue/store
      // response itself is not ok. An uncertain write must retry, never become
      // permission to ship donor media.
      if (fallbackRemaster?.required === true) {
        let durableFallback = fallbackCurrent;
        if (fallbackRemaster.applied === true) {
          const persisted = await persistAppliedLineHero({
            ...row,
            previewUrl: built.previewUrl || row.previewUrl,
          }, fallbackCurrent, fallbackRemaster, options);
          if (!persisted.ok) {
            return {
              ok: false,
              required: true,
              pending: true,
              reason: persisted.reason,
              heroRemaster: {
                ...fallbackRemaster,
                ready: false,
                applied: false,
                pending: true,
                reason: persisted.reason,
              },
            };
          }
          durableFallback = persisted.current || fallbackCurrent;
        }
        return {
          ok: true,
          required: true,
          heroRemaster: fallbackRemaster,
          rowPatch: {
            durableUpdatedAt: String(durableFallback.updated_at || ""),
            heroRemaster: compactHeroRemaster(fallbackRemaster),
          },
        };
      }
      // A non-required refusal carries its reason so the console shows which
      // check failed, but still ships on the donor rung.
      const heroRemaster = {
        ok: true,
        required: false,
        ready: true,
        pending: false,
        hold: false,
        fallback: true,
        status: "skipped",
        buildHash: String(built.buildHash || ""),
        reason: String(fallbackRemaster?.reason || "no_scannable_hero_source"),
      };
      return {
        ok: true,
        required: false,
        ready: true,
        fallback: true,
        hold: false,
        heroRemaster,
        rowPatch: { heroRemaster: compactHeroRemaster(heroRemaster) },
      };
    }

    const scannableSource = firstScannableSource(null, { current_website: built.currentWebsite }, row);
    const reason = scannableSource ? "hero_source_deferred_to_station" : "no_scannable_hero_source";

    const heroRemaster = {
      ok: true,
      required: false,
      ready: true,
      pending: false,
      hold: false,
      fallback: true,
      status: "skipped",
      buildHash: String(built.buildHash || ""),
      reason,
    };
    return {
      ok: true,
      required: false,
      ready: true,
      fallback: true,
      hold: false,
      heroRemaster,
      rowPatch: { heroRemaster: compactHeroRemaster(heroRemaster) },
    };
  }
  const read = options.select || select;
  const loaded = await read(
    PROSPECTS,
    `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
    { signal: options.signal, deadlineAt: options.deadlineAt },
  ).catch(() => null);
  let current = loaded?.ok === true && Array.isArray(loaded.data) ? loaded.data[0] : null;
  if (!current) {
    return { ok: false, required: true, pending: true, reason: "hero_photo_bank_record_read_failed" };
  }
  let currentCandidate = candidate;
  const legacyWebsite = String(built.currentWebsite || row.currentWebsite || current.current_website || recordOf(current).current_website || "").trim();
  const legacyOwnUrls = Array.isArray(candidate?.photos)
    ? candidate.photos.filter((photo) => photo?.source === "own_site").map((photo) => photo?.url).filter(Boolean)
    : [];
  if (legacyWebsite && legacyOwnUrls.length
    && objectOf(row.heroRemaster)?.applied !== true
    && !built.recovery
    && options.heroRebuild !== true) {
    const download = options.downloadPublicImage || require("./hero-seedance-runner").downloadPublicOutput;
    const { imageSize } = require("./mirror-engine/client-photos");
    const { imageMime } = require("./hero-seedance-runner");
    const refreshedPhotos = [];
    for (const url of legacyOwnUrls) {
      let host = "";
      try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
      const bytes = await download(url, {
        timeoutMs: 30_000,
        maxBytes: 12 * 1024 * 1024,
        requiredHost: host,
        requestHeaders: { "user-agent": "Mozilla/5.0 WSSLabs-photos" },
        lookupImpl: options.lookupImpl,
        httpsImpl: options.httpsImpl,
      }).catch(() => null);
      if (!bytes?.length) continue;
      const mime = imageMime(bytes);
      const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" })[mime];
      if (!ext) continue;
      const size = imageSize(Buffer.from(bytes), ext);
      refreshedPhotos.push({
        url, source: "own_site", sha256: createHash("sha256").update(bytes).digest("hex"),
        width: size.w, height: size.h, bytes: bytes.length, ext,
      });
    }
    if (refreshedPhotos.length) {
      currentCandidate = photoBank.bankFromHarvest(refreshedPhotos, { website: legacyWebsite, foundOn: legacyWebsite });
    } else currentCandidate = null;
  }
  const bank = completedLineHeroBank({ ...row, currentWebsite: built.currentWebsite, ownedPhotoBank: currentCandidate }, current);
  if (!bank) {
    // A builder-declared bank that fails ownership proof is not the same as no
    // bank. Hold the row before the stock build can reach its render/email
    // phases; invalid provenance can never become permission to fall back.
    const heroRemaster = {
      ok: false,
      required: true,
      ready: false,
      pending: false,
      hold: true,
      status: "refused",
      reason: "hero_photo_bank_provenance_mismatch",
    };
    return { ok: false, required: true, ready: false, hold: true, heroRemaster };
  }
  let record = recordOf(current);
  if (!sameCanonical(objectOf(record.photo_bank), bank)) {
    const at = new Date().toISOString();
    const update = options.conditionalUpdate || conditionalUpdate;
    const stored = await update(
      PROSPECTS,
      "prospect_id",
      row.prospectId,
      { updated_at: `eq.${String(current.updated_at || "").trim()}` },
      { record: { ...record, photo_bank: bank }, updated_at: at },
      { signal: options.signal, deadlineAt: options.deadlineAt },
    ).catch(() => null);
    if (!stored?.ok || stored.updated !== true) {
      return { ok: false, required: true, pending: true, reason: "hero_photo_bank_persist_pending" };
    }
    current = Array.isArray(stored.rows) && stored.rows[0]
      ? stored.rows[0]
      : { ...current, record: { ...record, photo_bank: bank }, updated_at: at };
    record = recordOf(current);
  }
  const reuseOnly = objectOf(row.heroRemaster)?.applied === true || Boolean(built.recovery) || options.heroRebuild === true;
  const heroRemaster = await enqueueCompletedLineHero({
    ...row,
    previewUrl: built.previewUrl || row.previewUrl,
    currentWebsite: built.currentWebsite || row.currentWebsite,
    buildHash: built.buildHash || row.buildHash,
  }, current, record, { ...options, reuseOnly, reuseJobId: built.heroJobId });
  if (heroRemaster?.applied === true) {
    const persisted = await persistAppliedLineHero({
      ...row,
      previewUrl: built.previewUrl || row.previewUrl,
    }, current, heroRemaster, options);
    if (!persisted.ok) {
      return {
        ok: false,
        required: true,
        pending: true,
        reason: persisted.reason,
        heroRemaster: {
          ...heroRemaster,
          ready: false,
          applied: false,
          pending: true,
          reason: persisted.reason,
        },
      };
    }
    current = persisted.current || current;
  }
  if (heroRemaster?.required === false && heroRemaster?.fallback === true && heroRemaster?.applied !== true) {
    // The durable queue definitively declined a couture hero for this build
    // (provenance refusal). Same doctrine as the no-bank path: a missing hero
    // is a missing garnish — ship on the donor's fallback rung, not an
    // eternal pending loop over a finished site.
    return {
      ok: true,
      required: false,
      ready: true,
      fallback: true,
      hold: false,
      heroRemaster,
      rowPatch: {
        durableUpdatedAt: String(current.updated_at || ""),
        heroRemaster: compactHeroRemaster(heroRemaster),
      },
    };
  }
  return {
    ok: true,
    required: true,
    heroRemaster,
    rowPatch: {
      durableUpdatedAt: String(current.updated_at || ""),
      heroRemaster: compactHeroRemaster(heroRemaster),
    },
  };
}

function sportFencingVerticalHold(row) {
  if (!row || typeof row !== "object") return false;
  const record = recordOf(row);
  const statuses = [row.status, record.status]
    .map((value) => String(value || "").trim().toLowerCase());
  const reasons = [
    row.blocked_reason,
    row.vertical_hold && row.vertical_hold.reason,
    record.blocked_reason,
    record.vertical_hold && record.vertical_hold.reason,
  ].map((value) => String(value || "").trim().toLowerCase());
  return statuses.includes("held") && reasons.includes(SPORT_FENCING_HOLD_REASON);
}

function previewWritePolicyHold() {
  return {
    ok: false,
    reason: SPORT_FENCING_HOLD_REASON,
    code: "line_preview_write_policy_hold",
    retryable: false,
    policyHold: true,
    terminal: "rejected",
  };
}

function previewWriteEvidenceRefusal(reason) {
  return {
    ok: false,
    reason,
    code: "line_preview_write_evidence_refused",
    retryable: false,
    terminal: "rejected",
  };
}

const NON_CONTACT_LOCALPART = /^(?:no[._-]?reply|noreply|do[._-]?not[._-]?reply|donotreply|webmaster|abuse|postmaster)$/i;

function contactEmailCandidates(row = {}, rec = recordOf(row)) {
  const buildReady = buildReadyOf(rec) || {};
  const facts = buildReady.mirror_request?.facts || {};
  const truth = rec.truth_packet || {};
  const packet = truth.mirror_ready || {};
  return [
    row.email, row.owner_email, facts.email, packet.email, truth.email, rec.email, rec.owner_email,
  ].map(normalizeEmail).filter((value, index, all) => value && all.indexOf(value) === index);
}

/**
 * Contact-first production gate.
 *
 * A requested campaign slot represents a business we can actually contact.
 * Missing, placeholder, no-reply, suppressed, unreachable, or hard-held email
 * evidence stays in scouting and never consumes a website build.
 */
function contactFirstVerdict(row = {}) {
  const rec = recordOf(row);
  const enriched = contactSendGate({ ...row, record: rec });
  if (enriched.hasEnrichment) {
    if (enriched.blocked || !enriched.sendableEmail) {
      return { ok: true, contactReady: false, email: "", source: "contact_enrichment",
        holdReason: `no verified business email — delivery held (${(enriched.blockedReasons || enriched.holdReasons || []).join(",") || "contact evidence not sendable"})` };
    }
    return { ok: true, contactReady: true, email: normalizeEmail(enriched.sendableEmail), source: "contact_enrichment", holdReason: "" };
  }

  const email = contactEmailCandidates(row, rec)[0] || "";
  if (!email) return { ok: true, contactReady: false, email: "", source: "unavailable", holdReason: "no verified business email — delivery held" };
  const localPart = email.split("@")[0] || "";
  if (NON_CONTACT_LOCALPART.test(localPart) || isPlaceholderEmail(email)) {
    return { ok: true, contactReady: false, email: "", source: "published_business_record", holdReason: "published address is placeholder/no-reply — delivery held" };
  }
  const source = rec.truth_packet_source === "leadminer_mirror_ready"
    ? "leadminer_profile"
    : buildReadyOf(rec)?.proof?.build_hash
      ? "verified_miner"
      : "published_business_record";
  return { ok: true, contactReady: true, email, source, holdReason: "" };
}

function contactReadyLine(row = {}) {
  const verdict = contactFirstVerdict(row);
  if (!verdict.ok) return { ok: false, reason: verdict.reason || verdict.holdReason };
  const line = rowToLineRow({ ...row, email: verdict.email });
  return { ok: true, line: { ...line, email: verdict.email || "", hasEmail: Boolean(verdict.email),
    contactReady: verdict.contactReady === true, contactSource: verdict.source, contactHoldReason: verdict.holdReason || "" } };
}

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function signedMirrorReleaseEvidence(value, previewUrl = "") {
  const evidence = objectOf(value);
  if (!evidence
    || evidence.renderer !== MIRROR_ENGINE_RENDERER
    || evidence.qc_contract !== MIRROR_ENGINE_QC_CONTRACT
    || evidence.evidence_schema !== MIRROR_ENGINE_EVIDENCE_SCHEMA
    || !/^[a-f0-9]{64}$/i.test(String(evidence.evidence_sha || ""))
    || evidence.revealable !== true) return null;
  const expectedUrl = sanitizePreviewUrl(previewUrl);
  if (expectedUrl && sanitizePreviewUrl(evidence.preview_url) !== expectedUrl) return null;
  try {
    const { signEvidence } = require("./mirror-engine/engine");
    return signEvidence(evidence) === evidence.evidence_sha ? evidence : null;
  } catch {
    return null;
  }
}

function signedReleaseBrandForRow(row = {}) {
  const carried = objectOf(row.buildEvidence || row.build_evidence);
  const evidence = signedMirrorReleaseEvidence(
    row.releaseEvidence
      || row.release_evidence
      || carried?.release_evidence,
    row.previewUrl || row.preview_url || "",
  );
  return objectOf(evidence?.checks?.brand);
}

/**
 * The Mirror Engine owns its renderer, QC contract, and signed manifest. This
 * wrapper is what survives the durable Line row between the mirror and write
 * phases; it deliberately contains no prospect or recipient fields.
 */
function nativeMirrorBuildEvidence(dispatch = {}, previewUrl = "") {
  const status = objectOf(dispatch.buildStatus) || {};
  const rawReleaseEvidence = objectOf(
    dispatch.releaseEvidence
    || dispatch.release_evidence
    || status.release_evidence
    || dispatch.manifest,
  );
  const renderer = String(dispatch.renderer || status.renderer || rawReleaseEvidence?.renderer || "").trim();
  const declaresMirror = renderer === MIRROR_ENGINE_RENDERER
    || rawReleaseEvidence?.evidence_schema === MIRROR_ENGINE_EVIDENCE_SCHEMA;
  if (!declaresMirror) return { native: false, evidence: null, reason: "" };
  const releaseEvidence = signedMirrorReleaseEvidence(rawReleaseEvidence, previewUrl);
  if (!releaseEvidence) {
    // The release evidence failed to verify. If the build already produced a
    // valid preview URL, the build RAN — it must not be killed as a before-build
    // failure on an evidence field mismatch. A genuine tamper signature
    // failure is still caught by signedMirrorReleaseEvidence returning null
    // above; here we only ensure a successful build is never mislabeled
    // beforeBuild: true. Carry the unverified state so the send gate and
    // diagnostics can see the evidence object did not self-verify.
    if (String(previewUrl || "").trim()) {
      return {
        native: true,
        evidence: null,
        reason: "",
        beforeBuild: false,
        unverifiedEvidence: true,
        unverifiedReasons: rawReleaseEvidence ? ["release_evidence_signature_invalid"] : ["release_evidence_absent"],
      };
    }
    return { native: true, evidence: null, reason: "mirror_engine_release_evidence_invalid" };
  }
  const qcContract = String(dispatch.qc_contract || status.qc_contract || releaseEvidence.qc_contract || "").trim();
  const evidenceSchema = String(dispatch.evidence_schema || status.evidence_schema || releaseEvidence.evidence_schema || "").trim();
  const evidenceSha = String(dispatch.evidence_sha || status.evidence_sha || releaseEvidence.evidence_sha || "").trim();
  if (renderer !== MIRROR_ENGINE_RENDERER
    || qcContract !== MIRROR_ENGINE_QC_CONTRACT
    || evidenceSchema !== MIRROR_ENGINE_EVIDENCE_SCHEMA
    || evidenceSha !== releaseEvidence.evidence_sha) {
    return { native: true, evidence: null, reason: "mirror_engine_evidence_identity_mismatch" };
  }
  const ready = status.ready === true || dispatch.ready === true || releaseEvidence.revealable === true;
  const qcPassed = status.qc_passed === true || dispatch.qc_passed === true || releaseEvidence.revealable === true;
  const visualQcPassed = status.visual_qc_passed === true
    || dispatch.visual_qc_passed === true
    || releaseEvidence.revealable === true;
  if (!ready || !qcPassed || !visualQcPassed) {
    return { native: true, evidence: null, reason: "mirror_engine_qc_not_passed" };
  }
  const buildHash = String(dispatch.build_hash || status.build_hash || releaseEvidence.build_hash || "").trim();
  const generationFingerprint = String(
    status.generation_fingerprint
    || dispatch.generation_fingerprint
    || (buildHash ? `mirror-engine:${buildHash}` : ""),
  ).trim();
  const contentSource = String(dispatch.content_source || status.content_source || "").trim();
  return {
    native: true,
    reason: "",
    evidence: {
      renderer,
      qc_contract: qcContract,
      evidence_schema: evidenceSchema,
      evidence_sha: evidenceSha,
      ready: true,
      pending: false,
      qc_passed: true,
      visual_qc_passed: true,
      generation_fingerprint: generationFingerprint,
      build_hash: buildHash,
      content_source: contentSource,
      release_evidence: releaseEvidence,
    },
  };
}

function unverifiedNativeBuildMarker(nativeBuild, dispatch = {}) {
  if (!nativeBuild?.native || nativeBuild.unverifiedEvidence !== true) return null;
  const status = objectOf(dispatch.buildStatus) || {};
  return {
    // Preserve only enough type information for the later durable write gate
    // to know this was a native Mirror build. The unverified manifest itself
    // must never be persisted or mistaken for signed release evidence.
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: String(dispatch.qc_contract || status.qc_contract || "").trim(),
    evidence_schema: String(dispatch.evidence_schema || status.evidence_schema || "").trim(),
    build_hash: String(dispatch.build_hash || status.build_hash || "").trim(),
    content_source: String(dispatch.content_source || status.content_source || "").trim(),
    unverified_evidence: true,
    unverified_reasons: Array.isArray(nativeBuild.unverifiedReasons)
      ? nativeBuild.unverifiedReasons.map((reason) => String(reason || "").slice(0, 120)).filter(Boolean).slice(0, 4)
      : ["release_evidence_invalid"],
  };
}

function hasMeasuredScore(value) {
  return value !== null
    && value !== undefined
    && value !== ""
    && Number.isFinite(Number(value));
}

function buildReadyOf(record = {}) {
  const observed = record.last_mine_observation;
  const candidates = [
    record.build_ready,
    observed && observed.build_ready,
    record.qualification && record.proof ? record : null,
  ].filter((candidate) => candidate && typeof candidate === "object");
  // A measured direct contract remains authoritative. The observation is only
  // the repair fallback for the old matched-row branch that left a starved or
  // unmeasured object at record.build_ready.
  return candidates.find((candidate) => hasMeasuredScore(candidate.qualification?.website_axis?.score))
    || candidates[0]
    || null;
}

function measuredOrderingScore(value) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 100
    ? value
    : undefined;
}

// The frozen sorter treats an absent submittedAt as epoch zero. At this
// adapter boundary, use a valid far-future timestamp so missing/invalid
// first-seen evidence sorts after real FIFO timestamps. Equal sentinels keep
// the source array's stable arrival order inside orderCandidates().
const MISSING_FIRST_SEEN = "9999-12-31T23:59:59.999Z";

function firstSeenOf(row = {}, record = recordOf(row)) {
  // Explicit first-seen fields are primary. created_at is the durable row's
  // canonical fallback; updated_at is not FIFO evidence and is never used.
  for (const value of [
    row.firstSeen,
    row.first_seen,
    record.firstSeen,
    record.first_seen,
    row.created_at,
    record.created_at,
  ]) {
    if (typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value))) return value;
  }
  return undefined;
}

function orderingFields(row = {}) {
  const record = recordOf(row);
  const buildReady = buildReadyOf(record);
  const directQualification = buildReady?.qualification && typeof buildReady.qualification === "object"
    ? buildReady.qualification
    : null;
  const lineQualification = row.qualification && typeof row.qualification === "object"
    ? row.qualification
    : {};
  const categories = directQualification?.categories && typeof directQualification.categories === "object"
    ? directQualification.categories
    : lineQualification.categories && typeof lineQualification.categories === "object"
      ? lineQualification.categories
      : {};
  const websiteAxis = directQualification?.website_axis && typeof directQualification.website_axis === "object"
    ? directQualification.website_axis
    : categories.websitePerformance && typeof categories.websitePerformance === "object"
      ? categories.websitePerformance
      : {};
  const onlineReputation = categories.onlineReputation && typeof categories.onlineReputation === "object"
    ? categories.onlineReputation
    : {};
  const reputation = categories.reputation && typeof categories.reputation === "object"
    ? categories.reputation
    : {};

  return {
    websiteScore: measuredOrderingScore(websiteAxis.score),
    reputationScore: measuredOrderingScore(onlineReputation.score)
      ?? measuredOrderingScore(reputation.score),
    submittedAt: firstSeenOf(row, record),
  };
}

function queueGapFirstEnabled(env = process.env) {
  return String(env.GHOST_AGENCY_QUEUE_GAP_FIRST ?? "1").trim() !== "0";
}

function gapFirstLineCandidates(candidates = [], env = process.env) {
  if (!Array.isArray(candidates)) return [];
  if (!queueGapFirstEnabled(env)) return candidates.slice();
  const wrapped = candidates.map((lineCandidate) => {
    const fields = orderingFields(lineCandidate);
    return {
      lineCandidate,
      ...fields,
      submittedAt: fields.submittedAt || MISSING_FIRST_SEEN,
    };
  });
  const ordered = orderCandidates(wrapped);
  return ordered.length === candidates.length
    ? ordered.map((entry) => entry.lineCandidate)
    : candidates.slice();
}

function persistedProspectQuery(ids = []) {
  return `?select=*&prospect_id=in.(${ids.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(",")})&limit=${ids.length}`;
}

function donorStringsFromManifest(manifest = {}) {
  const primitives = (value) => {
    if (Array.isArray(value)) return value.flatMap(primitives);
    if (value == null || typeof value === "object") return [];
    const clean = String(value).trim();
    return clean.length >= 4 ? [clean] : [];
  };
  const identity = [
    manifest.donor_business_name, manifest.business_name, manifest.identity_name,
    manifest.donor_phone, manifest.phone, manifest.donor_email, manifest.email,
    manifest.donor_domain, manifest.domain, manifest.owner, manifest.owner_name,
    primitives(manifest.persons).filter((value) => value.includes(" ") || value.length >= 8),
    primitives(manifest.socials).filter((value) => /(?:https?:\/\/|www\.|@|\/)/i.test(value)),
    manifest.account_ids,
  ].flatMap(primitives);
  return [...new Set(identity)];
}

function lineEligible(row = {}) {
  const status = String(row.status || recordOf(row).status || "").trim().toLowerCase();
  const terminal = new Set([
    "line_gate_passed", "line_queued", "previewed", "packeted", "sent", "contacted",
    "opted_out", "unsubscribed", "do_not_contact", "bounced", "complained",
    // ARCHIVED MEANS WE ALREADY KNOW THIS ROW IS UNBUILDABLE. It was not in
    // this list, so Run A (2026-08-08) picked, qualified, built, deployed and
    // rendered Plumbing Today HVAC — a row archived two days earlier with an
    // explicit archived_reason ("mined before Google review text was carried
    // onto the record; rebuild by re-mining"). Two of ten builds in that run
    // went to rows the store had already written off. Re-mining is how an
    // archived lead comes back, not the line picking it up again.
    "archived_legacy", "archived", "retiring", "retired",
  ]);
  return !terminal.has(status) && !String(row.preview_url || "").trim();
}

async function reloadPersistedProspects(ids, read) {
  const rows = [];
  for (let start = 0; start < ids.length; start += 75) {
    const chunk = ids.slice(start, start + 75);
    const result = await read(PROSPECTS, persistedProspectQuery(chunk));
    if (!result || result.ok !== true || !Array.isArray(result.data)) {
      throw new Error("mining_failed: persisted_prospect_reload_failed");
    }
    rows.push(...result.data);
  }
  return rows;
}

function parseTarget(value) {
  const match = String(value || "").trim().match(/^(.+?)\s+(?:in|near)\s+(.+)$/i);
  if (!match) return null;
  const industry = approvedIndustry(match[1].trim());
  const location = match[2].trim();
  return industry && location ? { industry, location } : null;
}

function locationKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function atomicShelfLocation(source = {}) {
  if (!source || typeof source !== "object") return { ok: false, incomplete: true };
  const cityText = source.city || source.postal_city || source.locality || "";
  const suppliedState = stateCode(source.state || source.region || source.address_state || "");
  const cityLocation = normalizeUsLocation({ location: cityText });
  if (cityLocation.state && suppliedState && cityLocation.state !== suppliedState) {
    return { ok: false, conflict: true };
  }
  const fieldLocation = {
    city: cityLocation.city,
    state: cityLocation.state || suppliedState,
  };
  const addressLocation = normalizeUsLocation({ address: source.address || source.formatted_address || "" });
  if (fieldLocation.city && addressLocation.city
    && locationKey(fieldLocation.city) !== locationKey(addressLocation.city)) {
    return { ok: false, conflict: true };
  }
  if (fieldLocation.state && addressLocation.state && fieldLocation.state !== addressLocation.state) {
    return { ok: false, conflict: true };
  }
  if (fieldLocation.city && fieldLocation.state) return { ok: true, ...fieldLocation };
  if (addressLocation.city && addressLocation.state) return { ok: true, ...addressLocation };
  return {
    ok: false,
    incomplete: true,
    city: fieldLocation.city || addressLocation.city || "",
    state: fieldLocation.state || addressLocation.state || "",
  };
}

/**
 * A named-market run may reuse shelf inventory only when the packet's verified
 * NAP locality matches that market. Marketing/service-area copy is deliberately
 * not used: it cannot prove where the business itself is located. If either the
 * requested city or the packet's city/state is missing, the shelf fails closed
 * and the caller mines the requested market instead.
 */
function shelfLocationMatches(row = {}, requestedLocation = "") {
  if (!String(requestedLocation || "").trim()) return true;
  const requested = normalizeUsLocation({ location: requestedLocation });
  if (!locationKey(requested.city) || !requested.state) return false;

  const record = recordOf(row);
  const buildReady = buildReadyOf(record) || {};
  const facts = buildReady.mirror_request && typeof buildReady.mirror_request.facts === "object"
    ? buildReady.mirror_request.facts
    : {};
  const truth = record.truth_packet && typeof record.truth_packet === "object"
    ? record.truth_packet
    : {};
  const packet = truth.mirror_ready && typeof truth.mirror_ready === "object"
    ? truth.mirror_ready
    : {};
  const sources = [facts, row, packet, truth, record];
  let actual = null;
  let assertedCity = "";
  let assertedState = "";
  for (const source of sources) {
    const observed = atomicShelfLocation(source);
    if (observed.conflict) return false;
    if (observed.city) {
      if (assertedCity && locationKey(assertedCity) !== locationKey(observed.city)) return false;
      assertedCity = assertedCity || observed.city;
    }
    if (observed.state) {
      if (assertedState && assertedState !== observed.state) return false;
      assertedState = assertedState || observed.state;
    }
    if (!observed.ok) continue;
    actual = actual || observed;
  }
  return Boolean(actual)
    && locationKey(actual.city) === locationKey(requested.city)
    && actual.state === requested.state;
}

function contractProblem(buildReady) {
  if (!buildReady || typeof buildReady !== "object") return "build_ready_contract_missing";
  const missing = [];
  if (!buildReady.proof || typeof buildReady.proof !== "object" || !buildReady.proof.build_hash) missing.push("proof");
  if (!buildReady.qualification || typeof buildReady.qualification !== "object") missing.push("qualification");
  if (!buildReady.brand_evidence || typeof buildReady.brand_evidence !== "object") missing.push("brand_evidence");
  if (!buildReady.mirror_request || typeof buildReady.mirror_request !== "object") missing.push("mirror_request");
  if (missing.length) return `build_ready_contract_incomplete:${missing.join(",")}`;
  // Owner directive 2026-08-31: the prospect's OLD site is the thing we
  // replace — weak sites are the best customers, and demanding a measured
  // design-axis score from an unmeasurable old site rejected exactly them
  // while burning measurement compute on pages we are about to discard.
  // The axis score remains optional report telemetry when present, but it
  // no longer gates admission.
  return "";
}

function prospectFromContract(row) {
  const prospect = prospectFromRow(row) || {};
  const buildReady = buildReadyOf(recordOf(row)) || {};
  const request = buildReady.mirror_request || {};
  const facts = request.facts || {};
  const brand = request.brand || {};
  return {
    ...prospect,
    business_name: facts.business_name || prospect.business_name,
    industry: facts.industry || prospect.industry,
    city: facts.city || prospect.city,
    state: facts.state || prospect.state,
    current_website: facts.current_website || prospect.current_website,
    email: facts.email || prospect.email,
    // Same reader as the dashboard path, so the two can never disagree about
    // where a mined lead's logo lives again. It reads mirror_request.brand.logo
    // first — what this line already did — and then brand_evidence.logo_url,
    // which covers a contract whose request block was written without the mark.
    logo_url: verifiedBrandOf(row).logo || brand.logo || prospect.logo_url || prospect.logo,
    // THE COLOUR THE MINER ALREADY MEASURED FROM THIS SAME MARK.
    //
    // measureAccent decodes PNG in pure JS and shells out to ffmpeg for every
    // other format, and ffmpeg is not in the serverless runtime — so a JPEG or
    // WebP logo measures null inside the build and the engine refuses the whole
    // mirror as brand=unbranded. Just Air LLC died exactly that way with
    // mirror_request.brand.accent = "#0c449a" sitting on its own record, along
    // with the URL it was measured from. Carried as a FALLBACK only; see
    // brand-assets.js, where it can fill a hole but never override a
    // measurement.
    logo_accent: verifiedBrandOf(row).accent || brand.accent || "",
    logo_accent_source: verifiedBrandOf(row).accent_source || brand.accent_source || "",
    // The contract's NAP facts, carried through. Dropping the phone here is
    // what collapsed every call CTA: the donor guards them with
    // data-collapse-if-empty="PHONE", so the mirror deployed with no way to
    // ring the business and the render gate failed it on nap_match. These
    // values are Google-observed and provenanced in build_ready, not guesses.
    phone: facts.phone || prospect.phone,
    place_id: facts.place_id || prospect.place_id,
    rating: facts.rating ?? prospect.rating,
    review_count: facts.review_count ?? prospect.review_count,
    marketing_city: facts.service_area || prospect.marketing_city,
    // THE WHOLE VERIFIED BLOCK, carried intact rather than re-flattened into
    // scalars. Copying the contract field by field is how latitude, longitude,
    // address, postal_code, county and place_id were lost between the store and
    // the build request — and with them the map embed, the Apple/Google Maps
    // links, the geo and postal JSON-LD, and every nearby town (withNearbyTowns
    // needs coordinates and silently returns unchanged content without them).
    // Passing the object means a field added to the contract tomorrow arrives
    // at the builder without another edit here.
    verified_facts: request.facts && typeof request.facts === "object" ? request.facts : null,
    // The reviews and hours the miner's own paid Places call returned. Present
    // on contracts written from 2026-08-06; older rows carry none and the
    // builder re-fetches them pinned to this contract's place_id.
    verified_content: request.content && typeof request.content === "object" ? request.content : null,
  };
}

function rowToLineRow(row = {}) {
  const prospect = prospectFromContract(row);
  const record = recordOf(row);
  const buildReady = buildReadyOf(record) || record;
  const computedQualification = buildReady.qualification && typeof buildReady.qualification === "object"
    ? buildReady.qualification
    : null;
  const websiteAxis = computedQualification && computedQualification.website_axis;
  const compositeSignal = computedQualification && computedQualification.composite_signal;
  const suppliedCategories = computedQualification?.categories && typeof computedQualification.categories === "object"
    ? computedQualification.categories
    : null;
  const computedCategories = websiteAxis && hasMeasuredScore(websiteAxis.score)
    ? { ...(suppliedCategories || {}), websitePerformance: websiteAxis }
    : suppliedCategories;
  const ownedPhotoBank = storedLineHeroBank(row, {
    currentWebsite: row.current_website || record.current_website || "",
  });
  return {
    prospectId: prospectId(prospect) || row.prospect_id,
    businessName: firstValue(prospect, ["business_name", "businessName", "name"], ""),
    city: firstValue(prospect, ["city"], ""),
    state: firstValue(prospect, ["state"], ""),
    vertical: firstValue(prospect, ["industry", "vertical", "category"], ""),
    email: firstValue(prospect, ["email", "owner_email"], ""),
    // THE COMPANY'S OWN MARK ON THE CONSOLE ROW (owner, 2026-08-20: "I feel
    // more like I'm seeing the companies that are working... not lines of
    // code"). Same verified logo the build uses; https-only, absent is fine —
    // the console falls back to its status dot.
    logoUrl: (() => {
      const u = String(firstValue(prospect, ["logo_url", "logo"], "") || "");
      return /^https:\/\//i.test(u) ? u : "";
    })(),
    proof: buildReady.proof || null,
    brand_evidence: buildReady.brand_evidence || null,
    contractIssue: contractProblem(buildReady),
    durableUpdatedAt: String(row.updated_at || "").trim(),
    currentWebsite: String(row.current_website || record.current_website || "").trim(),
    ...(ownedPhotoBank ? { ownedPhotoBank } : {}),
    firstSeen: firstSeenOf(row, record),
    // Build-ready rows already carry both measured axes. Adapt those exact
    // measurements to qualifyForBuild's existing input without re-probing.
    qualification: {
      categories: computedCategories || record.callprep_categories || record.categories || {},
      overallScore: compositeSignal?.score ?? record.overall_score ?? record.callprep_score ?? null,
      overallGrade: compositeSignal?.grade ?? record.overall_grade ?? record.callprep_grade ?? null,
      probe: computedQualification?.probe || null,
    },
  };
}

/** Start/reuse the durable hero job without waiting for generation. */
async function startQualifiedHero(row = {}, options = {}) {
  if (!heroAutolineEnabled(options.env || process.env)) {
    return { ok: true, rowPatch: {}, skipped: "disabled" };
  }
  const read = options.select || select;
  const loaded = await read(
    PROSPECTS,
    `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
    { signal: options.signal, deadlineAt: options.deadlineAt },
  ).catch(() => null);
  let current = loaded?.ok === true && Array.isArray(loaded.data) ? loaded.data[0] : null;
  if (!current) return { ok: false, rowPatch: {}, reason: "hero_qualification_record_read_failed" };

  let record = recordOf(current);
  const bank = completedLineHeroBank(row, current) || storedLineHeroBank(current, row);

  if (bank && !sameCanonical(objectOf(record.photo_bank), bank)) {
    const at = new Date().toISOString();
    const update = options.conditionalUpdate || conditionalUpdate;
    const stored = await update(
      PROSPECTS,
      "prospect_id",
      row.prospectId,
      { updated_at: `eq.${String(current.updated_at || "").trim()}` },
      { record: { ...record, photo_bank: bank }, updated_at: at },
      { signal: options.signal, deadlineAt: options.deadlineAt },
    ).catch(() => null);
    if (!stored?.ok || stored.updated !== true) {
      return { ok: false, rowPatch: { ownedPhotoBank: bank }, reason: "hero_qualification_photo_bank_persist_pending" };
    }
    current = Array.isArray(stored.rows) && stored.rows[0]
      ? stored.rows[0]
      : { ...current, record: { ...record, photo_bank: bank }, updated_at: at };
    record = recordOf(current);
  }

  const started = await enqueueCompletedLineHero({
    ...row,
    ownedPhotoBank: bank,
    currentWebsite: row.currentWebsite || current.current_website || record.current_website || "",
  }, current, record, { ...options, deferJoin: true });
  return {
    ok: started?.ok === true,
    reason: String(started?.reason || ""),
    rowPatch: {
      ...(bank ? { ownedPhotoBank: bank } : {}),
      heroRemaster: compactHeroRemaster(started || {
        required: true,
        ready: false,
        pending: true,
        reason: "hero_remaster_enqueue_failed",
      }),
    },
  };
}

// SEEDANCE AUTOLANE AT THE SEND BOUNDARY (owner directive 2026-09-03).
//
// WHY THIS EXISTS. The qualification-time start (`startQualifiedHero`) and the
// pre-build early attempt inside `mirrorProspect` both ask the durable queue
// for a hero job BEFORE the mirror has harvested anything. The default autoline
// producer is Seedance, and #625's provenance law binds every Seedance
// generation to an exact verified owned photo — so a campaign prospect with no
// bank yet is refused `photo_bank_stale_or_missing`, which
// `enqueueCompletedLineHero` classifies as a DEFINITIVE enqueue refusal: the
// marker becomes `{ required:false, fallback:true, ready:true }`, the hero
// boundary is then permanently "satisfied" by that fallback rung, and the row
// sails mirrored -> gate_passed -> queued -> sent with the donor's static clip.
// The desktop worker stays idle because no job row was ever written.
//
// This seam re-asks the hero question exactly once more, at the boundary the
// campaign always crosses — gate_passed, the last stop before the email — for
// every row whose boundary was satisfied by a FALLBACK (an applied/remastered
// row, or one that already owns a job id, is left alone). It is fail-soft by
// law: every refusal is named `hero_autoline_degraded:<reason>` on a dedicated
// `heroPostSendAutoline` row field (never on `heroRemaster`, whose exact shape
// the boundary machinery verifies), and NOTHING here may block, delay, or fail
// the send. The already-deployed mirror keeps its fallback rung; when the
// worker later completes the job, the existing shared-release injection and
// hero-queue wakeup own the post-deploy swap.
async function ensureGatePassedHeroAutoline(row = {}, options = {}) {
  const degrade = (reason) => ({
    ok: true,
    ensured: false,
    rowPatch: {
      heroPostSendAutoline: {
        at: new Date().toISOString(),
        reason: `hero_autoline_degraded:${boundedDetailText(reason || "unknown").slice(0, 160)}`,
      },
    },
  });
  try {
    const env = options.env || process.env;
    if (!heroAutolineEnabled(env)) {
      // The kill switch is already named on the row's attach diagnostic; a
      // degrade marker here would be noise.
      return { ok: true, ensured: false, skipped: "disabled" };
    }
    const prospectId = String(row.prospectId || row.prospect_id || "").trim();
    if (!prospectId) return { ok: true, ensured: false, skipped: "prospect_id_missing" };
    const marker = objectOf(row.heroRemaster) || {};
    if (marker.applied === true || String(marker.jobId || marker.job_id || "").trim()) {
      // An applied clip or a live job identity already exists for this row.
      return { ok: true, ensured: false, reused: true };
    }
    const prior = objectOf(row.heroPostSendAutoline) || {};
    if (String(prior.jobId || prior.job_id || "").trim()) {
      return { ok: true, ensured: false, reused: true };
    }

    // The durable record is the queue's provenance input. Fold in a bank the
    // build harvested but never persisted (it rides the row as ownedPhotoBank)
    // so the Seedance lane can actually verify a real_scene source.
    const read = options.select || select;
    const loaded = await read(
      PROSPECTS,
      `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
      { signal: options.signal, deadlineAt: options.deadlineAt },
    ).catch(() => null);
    const current = loaded && loaded.ok === true && Array.isArray(loaded.data) && loaded.data.length
      ? loaded.data[0]
      : null;
    const record = recordOf(current || {});
    const rowBank = row.ownedPhotoBank || row.owned_photo_bank || null;
    const recordForQueue = current && rowBank
      ? { ...record, ...(record.photo_bank ? {} : { photo_bank: rowBank }) }
      : record;

    const start = options.enqueueHeroRemasterForBuild
      || require("./full-run").enqueueHeroRemasterForBuild;
    const started = await start({
      prospect_id: prospectId,
      business_name: row.businessName || row.business_name
        || (current && current.business_name) || record.business_name,
      preview_url: row.previewUrl || row.preview_url || "",
      current_website: row.currentWebsite || row.current_website
        || (current && current.current_website) || record.current_website || "",
      industry: row.industry || row.vertical || record.industry || "",
      record: recordForQueue,
    }, {
      persist: true,
      dryRun: false,
      env,
      lineHandle: {
        batchId: options.batchId || row.batchId || row.batch_id || "",
        rowId: row.rowId || row.row_id || "",
      },
      reofferBuildHash: String(row.buildHash || row.build_hash || "").trim(),
      enqueueHeroReelJob: options.enqueueHeroReelJob,
      signal: options.signal,
      deadlineAt: options.deadlineAt,
    });

    const at = new Date().toISOString();
    if (!started || started.ok !== true) {
      return degrade(String(started?.reason || started?.error || "enqueue_failed"));
    }
    const jobId = String(started.job_id || started.jobId || "").trim();
    const skipped = String(started.skipped || "");
    if (!jobId && skipped) {
      return degrade(skipped);
    }
    if (!jobId) {
      return degrade("job_id_missing");
    }
    return {
      ok: true,
      ensured: true,
      rowPatch: {
        heroPostSendAutoline: {
          at,
          jobId,
          status: started.queued === true ? "queued" : "reused",
          reason: "",
        },
      },
    };
  } catch (error) {
    return degrade(`ensure_failed:${String((error && error.message) || error).slice(0, 120)}`);
  }
}

// THE BASICS AN AI-FILL BUILD CANNOT DO WITHOUT (owner unblock, 2026-08-14).
//
// A LeadMiner export that failed the strict build_ready contract used to be
// killed at pick — but most of the owner's held plumbing packets fail it only
// because the export dropped a service list or a colour, not because they are
// unbuildable. If a packet still carries a real name, place, trade, and a
// contactable email, it BUILDS: the thin content is AI-filled downstream. Only
// a packet with no usable identity at all is still killed here. Read from the
// row first, then the packet, then the record — whichever route the fact took.
function packetBasics(row = {}, rec = {}) {
  const truth = (rec.truth_packet && typeof rec.truth_packet === "object") ? rec.truth_packet : {};
  const lead = (truth.mirror_ready && typeof truth.mirror_ready === "object") ? truth.mirror_ready : {};
  const first = (...vals) => vals.map((v) => String(v || "").trim()).find(Boolean) || "";
  const business_name = first(row.business_name, lead.business_name, rec.business_name);
  let industry = first(lead.industry, rec.industry, row.industry, row.vertical);
  if (!industry) {
    // Export dropped the industry label but kept the service list: derive the
    // trade from the client's own services so the packet is admitted to
    // needs_fill instead of being killed as contract-incomplete. Confident +
    // empty-label only; all downstream gates still re-verify.
    const services = Array.isArray(lead.services) && lead.services.length
      ? lead.services
      : (Array.isArray(truth.services) ? truth.services : []);
    const inferred = inferTrade({ label: "", services, businessName: business_name });
    if (inferred && inferred.confident && inferred.trade) industry = String(inferred.trade).trim();
  }
  return {
    business_name,
    city: first(row.city, lead.city, rec.city),
    state: first(row.state, lead.state, rec.state),
    email: normalizeEmail(first(row.email, lead.email, rec.email)),
    industry,
  };
}

function packetHasBasics(row = {}, rec = {}) {
  const b = packetBasics(row, rec);
  return Boolean(b.business_name && b.city && b.state && b.industry);
}

function packetTradeDecision(row = {}, rec = {}) {
  const truth = rec.truth_packet || {};
  const packet = truth.mirror_ready || {};
  const services = (Array.isArray(packet.services) && packet.services.length)
    ? packet.services
    : (Array.isArray(truth.services) ? truth.services : []);
  const label = packet.industry || truth.industry || rec.industry || row.industry || row.vertical || "";
  const verdict = inferTrade({
    label,
    services,
    businessName: row.business_name || packet.business_name || rec.business_name || "",
    siteText: [packet.site_text, packet.harvested_site_text, truth.site_text, truth.harvested_site_text].filter(Boolean).join(" \n "),
    categories: [packet.primary_category, packet.categories, truth.categories],
  });
  if (verdict.blocked) return { ok: false, reason: verdict.reason, verdict };
  const trade = approvedIndustry(verdict.trade) || approvedIndustry(label);
  return trade ? { ok: true, trade, verdict } : { ok: false, reason: "no recognisable trade in the packet's services", verdict };
}

async function stampVerticalHold(row, rec, reason, update = conditionalUpdate) {
  const at = new Date().toISOString();
  const guards = {
    ...(String(row.updated_at || "").trim() ? { updated_at: `eq.${String(row.updated_at).trim()}` } : {}),
    ...(String(row.status || "").trim() ? { status: `eq.${String(row.status).trim()}` } : {}),
  };
  try {
    const result = await update(
      PROSPECTS,
      "prospect_id",
      row.prospect_id,
      guards,
      {
        status: "held",
        record: {
          ...rec,
          status: "held",
          blocked_reason: reason,
          vertical_hold: { reason, at },
        },
        updated_at: at,
      },
    );
    if (!result || result.ok !== true || result.updated !== true) {
      throw new Error(boundedDetailText(result?.error || result?.mode || "compare_and_swap_missed"));
    }
    return result;
  } catch (error) {
    const failure = new Error(`vertical_hold_persist_failed:${boundedDetailText(error?.message || error, 160)}`);
    failure.code = "vertical_hold_persist_failed";
    throw failure;
  }
}

function verticalHoldEligible(row = {}) {
  const rec = recordOf(row);
  const statuses = [row.status, rec.status].map((value) => String(value || "").toLowerCase()).filter(Boolean);
  const contactTerminal = new Set(["sent", "delivered", "contacted", "replied", "converted", "paid", "opted_out", "unsubscribed", "do_not_contact", "bounced", "complained", "archived", "archived_legacy", "retiring", "retired"]);
  if (statuses.some((status) => contactTerminal.has(status))) return false;
  if (statuses.some((value) => new Set(["previewed", "built", "ready"]).has(value))) return false;
  // Current queue state is authoritative. Historical send/delivery/contact
  // fields are preserved for audit but cannot let the current queued mismatch
  // escape quarantine. Current terminal STATUS values above still win.
  if (statuses.includes("line_queued")) return true;
  if ([row.sent_at, row.email_sent_at, row.contacted_at, row.last_contacted_at, row.delivered_at, rec.sent_at, rec.email_sent_at, rec.contacted_at, rec.last_contacted_at, rec.delivered_at]
    .some((value) => String(value || "").trim())) return false;
  const status = String(row.status || "").toLowerCase();
  const preview = row.preview_url || rec.preview_url || rec.urls?.preview_url || rec.build_ready?.preview_url;
  if (String(preview || "").trim()) return false;
  return new Set(["held", "new", "queued"]).has(status);
}

const EXACT_TERMINAL_STATUSES = new Set([
  "line_gate_passed", "line_queued", "previewed", "packeted", "built", "ready",
  "sent", "delivered", "contacted", "replied", "converted", "paid",
  "opted_out", "unsubscribed", "do_not_contact", "bounced", "complained",
  "suppressed", "contact_suppressed", "email_suppressed", "closed_lost",
  "archived", "archived_legacy", "retiring", "retired",
]);

const OWNER_ONLY_PRACTICE_SCOPE = "owner_only_practice";
const OWNER_ONLY_PRACTICE_ADMISSION = "owner_only_practice_admission";
const PROVISIONAL_IDENTITY_OWNER_ONLY = "provisional_identity_owner_only";

/** One fail-closed boundary for durable Practice-only admission. The explicit
 * scope is the current contract; identity_provisional remains a legacy belt for
 * rows minted before the scope existed. Identity quality and delivery policy
 * stay separate, so a proven identity may carry the scope without being called
 * provisional. */
function liveAdmissionVerdict(row = {}, lane = "live") {
  if (String(lane || "live").trim().toLowerCase() !== "live") return { ok: true };
  const buildReady = buildReadyOf(recordOf(row));
  if (String(buildReady?.admission_scope || "").trim().toLowerCase() === OWNER_ONLY_PRACTICE_SCOPE) {
    return { ok: false, reason: OWNER_ONLY_PRACTICE_ADMISSION };
  }
  if (buildReady?.identity_provisional === true) {
    return { ok: false, reason: PROVISIONAL_IDENTITY_OWNER_ONLY };
  }
  return { ok: true };
}

function exactProspectTerminal(row = {}, rec = recordOf(row)) {
  const statuses = [row.status, rec.status]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (statuses.some((status) => EXACT_TERMINAL_STATUSES.has(status))) return true;
  return [
    row.suppressed, rec.suppressed,
    row.contact_suppressed, rec.contact_suppressed,
    row.email_suppressed, rec.email_suppressed,
    row.do_not_contact, rec.do_not_contact,
  ].some((value) => value === true || /^(1|true|yes|on)$/i.test(String(value || "").trim()));
}

function recentBuildFailure(row = {}, rec = recordOf(row), clock = Date.now) {
  const failure = rec.last_build_error || row.last_build_error || {};
  const failedAt = Date.parse(String(failure.at || ""));
  return Number.isFinite(failedAt) && clock() - failedAt < BUILD_RETRY_WINDOW_MS;
}

async function exactProspectCandidate(row, {
  donorFor,
  holdUpdate,
  clock,
  allowRecentBuildRetry = false,
  lane = "live",
} = {}) {
  const rec = recordOf(row);
  if (!lineEligible(row) || exactProspectTerminal(row, rec)) {
    return { ok: false, reason: "standard_eligibility_hold" };
  }
  if (String(row.preview_url || rec.preview_url || "").trim()) {
    return { ok: false, reason: "already_built_or_previewed" };
  }
  if (rec.duplicate_of || row.duplicate_of) return { ok: false, reason: "duplicate_business" };
  if (sportFencingVerticalHold(row)) return { ok: false, reason: SPORT_FENCING_HOLD_REASON };
  // The retry window protects automatic and live selection from repeatedly
  // spending on the same failed packet. An owner-named SANDBOX exact pick is
  // different: it is the bounded diagnostic/recovery lane and may retry the
  // exact identity after a release fix. Every truth, terminal, duplicate,
  // suppression, held-state and donor gate above/below remains unchanged.
  if (!allowRecentBuildRetry && recentBuildFailure(row, rec, clock || Date.now)) {
    return { ok: false, reason: "build_retry_window_active" };
  }

  const declaredLeadMiner = rec.truth_packet_source === "leadminer_mirror_ready";
  const leadMinerPacket = declaredLeadMiner && rec.truth_packet && typeof rec.truth_packet === "object";
  if (declaredLeadMiner && !leadMinerPacket) return { ok: false, reason: "leadminer_truth_packet_missing" };
  if (leadMinerPacket && String(row.status || "").trim().toLowerCase() !== "held") {
    return { ok: false, reason: "leadminer_packet_not_held" };
  }

  const buildReady = buildReadyOf(rec);
  const admission = liveAdmissionVerdict(row, lane);
  if (!admission.ok) return admission;
  const strictContract = contractProblem(buildReady) === "";
  if (leadMinerPacket) {
    if (!strictContract && !packetHasBasics(row, rec)) {
      return { ok: false, reason: "leadminer_truth_identity_incomplete" };
    }
  } else if (!strictContract) {
    return { ok: false, reason: contractProblem(buildReady) || "build_ready_contract_missing" };
  }

  let trade = "";
  let decision = null;
  if (leadMinerPacket) {
    decision = packetTradeDecision(row, rec);
    if (!decision.ok) {
      if (decision.reason === SPORT_FENCING_HOLD_REASON && verticalHoldEligible(row)
        && rec.blocked_reason !== decision.reason) {
        await stampVerticalHold(row, rec, decision.reason, holdUpdate || conditionalUpdate);
      }
      return { ok: false, reason: decision.reason || "vertical_truth_refused" };
    }
    trade = decision.trade;
  } else {
    const line = rowToLineRow(row);
    trade = approvedIndustry(line.vertical);
    if (!trade) return { ok: false, reason: "no_recognisable_trade" };
    if (trade === "fencing") {
      const request = buildReady?.mirror_request && typeof buildReady.mirror_request === "object"
        ? buildReady.mirror_request
        : {};
      const facts = request.facts && typeof request.facts === "object" ? request.facts : {};
      const content = request.content && typeof request.content === "object" ? request.content : {};
      const services = [content.services, facts.services, buildReady?.verified_content?.services]
        .find((value) => Array.isArray(value)) || [];
      const decision = inferTrade({
        label: line.vertical,
        services,
        businessName: line.businessName,
        siteText: [
          facts.site_text,
          facts.harvested_site_text,
          content.site_text,
          content.harvested_site_text,
          rec.site_text,
          rec.harvested_site_text,
        ].filter(Boolean).join(" \n "),
        categories: [facts.primary_category, facts.categories, content.categories, rec.categories],
      });
      if (decision.blocked) {
        if (decision.reason === SPORT_FENCING_HOLD_REASON && verticalHoldEligible(row)
          && rec.blocked_reason !== decision.reason) {
          await stampVerticalHold(row, rec, decision.reason, holdUpdate || conditionalUpdate);
        }
        return { ok: false, reason: decision.reason || "fencing_contracting_uncorroborated" };
      }
      trade = approvedIndustry(decision.trade);
      if (!trade) return { ok: false, reason: "fencing_contracting_uncorroborated" };
    }
  }

  let donor = donorFor(trade);
  if ((!donor || donor.ok !== true) && leadMinerPacket) {
    // Multi-trade packets may lead with a real trade for which the clean donor
    // library has no template yet. A named owner retry may use the first
    // independently inferred secondary trade that DOES have a clean donor.
    // Roy Briley is the measured case: restoration leads, while the same
    // first-party identity explicitly proves general contracting. Never fall
    // back to the stale category label or an unscored trade.
    const alternatives = Array.isArray(decision?.verdict?.secondary)
      ? decision.verdict.secondary
      : [];
    for (const candidate of alternatives) {
      const approved = approvedIndustry(candidate);
      if (!approved || approved === trade) continue;
      const resolved = donorFor(approved);
      if (!resolved || resolved.ok !== true) continue;
      trade = approved;
      donor = resolved;
      break;
    }
  }
  if (!donor || donor.ok !== true) {
    // DONOR EXCLUSION REFUSAL (lib/donor-exclusions.js): an owner-barred
    // donor is a DECISION, not a missing template. Name the terminal cause
    // the quarantine rows carry instead of the generic unavailability string.
    if (donor && donor.reason === DONOR_EXCLUSION_CAUSE) {
      return { ok: false, reason: DONOR_EXCLUSION_CAUSE };
    }
    return { ok: false, reason: `clean_donor_unavailable:${trade || "unknown"}` };
  }

  const contact = contactFirstVerdict(row);
  if (!contact.ok) return { ok: false, reason: "contact_classification_failed" };
  const contactReady = contact.contactReady === true && Boolean(contact.email);
  const line = {
    ...rowToLineRow(row),
    vertical: trade,
    // Always overwrite the row projection. A raw address inside a suppressed
    // or unverified record must not survive merely because rowToLineRow saw it
    // before the contact verdict did.
    email: contactReady ? contact.email : "",
    hasEmail: contactReady,
    contactReady,
    contactSource: contact.source || "unavailable",
    contactHoldReason: contact.holdReason || contact.reason || "",
  };
  if (leadMinerPacket) {
    line.leadminerQualified = true;
    line.contractIssue = "";
    // Police retirement (#386): a Genie-certified row is fully cooked by the
    // compiler — content contract checks do not apply to it.
    if (!strictContract && row.__genieContentCertified !== true) line.needs_fill = true;
  }
  return { ok: true, line };
}

/**
 * pickNameAdmission — one shared verdict for EVERY pick path that feeds
 * batches (fresh mine, packet shelf, vertical shelf, freshest store; exact-ID
 * operator promises stay exempt).
 *
 * Round-2 evidence (line_mthsj44q, 2026-08-31): the round-1 hook covered only
 * the fresh-mine admission loop, so the recycled pick pool — the LeadMiner
 * packet shelf, the vertical shelf, and the freshest-store fallback — kept
 * feeding batches garbage names ("Home - Backlund Plumbing", a raw CSS
 * selector, "&#038;" entities, truncated exports) that burned an Intake Genie
 * compile slot before certification refused them. This helper applies the same
 * conservative filter everywhere picks are admitted:
 *
 *   - refuse (pick_name_implausible) BEFORE any compile spend, via the same
 *     quarantine metadata a certification refusal rides;
 *   - rescue scraped <title> prefixes by STRIPPING "Home - " / "Welcome | " /
 *     "Index — " when the remainder is a plausible name — the admitted row
 *     carries the stripped name into the compiler, the certification
 *     prospect, and the line projection (the durable store row is untouched;
 *     no identity re-write happens at pick time).
 */
function rowWithAdmittedBusinessName(row, admittedName) {
  const rec = recordOf(row);
  const nextRecord = { ...rec, business_name: admittedName };
  if (rec.truth_packet && typeof rec.truth_packet === "object") {
    nextRecord.truth_packet = { ...rec.truth_packet, business_name: admittedName };
    if (rec.truth_packet.mirror_ready && typeof rec.truth_packet.mirror_ready === "object") {
      nextRecord.truth_packet.mirror_ready = {
        ...rec.truth_packet.mirror_ready,
        business_name: admittedName,
      };
    }
  }
  return { ...row, business_name: admittedName, record: nextRecord };
}

function pickNameAdmission(row) {
  const raw = String((row && row.business_name) || recordOf(row).business_name || "");
  if (!raw.trim()) {
    // An EMPTY name is not "implausible" — there is nothing to judge, and the
    // shelf identity gates (packetHasBasics) already name that kill more
    // precisely ("export incomplete and no usable identity"). Callers decide
    // via `emptyName` whether to defer (shelf paths) or quarantine (the
    // fresh lane keeps its round-1 never-compile-a-nameless-row behavior).
    return { ok: true, emptyName: true, name: raw, row };
  }
  const admitted = stripTitleTagPrefix(raw);
  if (!pickNamePlausible(admitted)) {
    return { ok: false, reason: PICK_NAME_IMPLAUSIBLE, name: raw, row, quarantined: { businessName: raw } };
  }
  // NATIONAL-CHAIN EXCLUSION (owner directive 2026-09-01): a franchise name
  // ("Roto-Rooter", "SERVPRO", ...) is never the prospect — refuse it on the
  // same quarantine path, naming the chain cause so the durable rejected row
  // and the refill exclusion both read the truth.
  if (isNationalChainName(admitted)) {
    return { ok: false, reason: NATIONAL_CHAIN_EXCLUDED, name: raw, row, quarantined: { businessName: raw } };
  }
  const namedRow = admitted === raw ? row : rowWithAdmittedBusinessName(row, admitted);
  const locationAdmission = require("./pick-location-admission").pickLocationAdmission(namedRow);
  if (!locationAdmission.ok) {
    // `missingLocation` lets the stored-selection lane keep its deferral
    // contract: a stored row burns no compile slot, and its build-ready
    // contract gate names the missing pieces precisely, so refusing here
    // would only erase that diagnosis.
    return { ok: false, name: admitted, row: locationAdmission.row, reason: locationAdmission.reason, missingLocation: true };
  }
  return { ok: true, name: admitted, row: locationAdmission.row };
}

function pickNameQuarantineEntry(row, reason = PICK_NAME_IMPLAUSIBLE) {
  return {
    prospectId: String((row && row.prospect_id) || ""),
    businessName: String((row && row.business_name) || recordOf(row).business_name || ""),
    vertical: String(recordOf(row).industry || ""),
    reason,
  };
}

/**
 * pickVerticalShelf — the owner's held packets for THIS vertical, preferred over
 * a fresh web-hunt.
 *
 * "Mine plumbing" should build the 19 plumbing packets already on the shelf
 * before spending a mine on fresh metros. This reads the packet shelf, keeps the
 * buildable rows whose inferred trade matches the requested vertical (build-ready
 * OR needs_fill), and returns them as line rows. Soft by design: a shelf that
 * cannot be read, or holds nothing for this vertical, returns [] and the caller
 * falls through to mining exactly as before.
 */
async function pickVerticalShelf({ industry, location, count, readExact, donorFor, holdUpdate, clock, lane = "live", excludeProspectIds = [], includeSourceRows = false } = {}) {
  const wanted = approvedIndustry(industry);
  if (!wanted) return [];
  const now = clock || Date.now;
  const excluded = new Set((excludeProspectIds || []).map(String));
  const shelfQuery = `?select=*&record->>truth_packet_source=eq.leadminer_mirror_ready`
    + `&order=updated_at.desc&limit=${Math.max(count * 5, 100)}`;
  const held = await readExact(PROSPECTS, shelfQuery).catch(() => null);
  if (!held || held.ok !== true || !Array.isArray(held.data)) return [];
  const out = [];
  // Round-2 prefilter casualties ride the returned array the same way
  // compileQuarantined rides a pick, so callers materialize them as durable
  // rejected rows (refill exclusion) instead of silently shrinking the shelf.
  const nameQuarantined = [];
  for (const sourceRow of held.data) {
    const sourceRec = recordOf(sourceRow);
    if (!(sourceRec.truth_packet && sourceRec.truth_packet_source === "leadminer_mirror_ready")) continue;
    if (!liveAdmissionVerdict(sourceRow, lane).ok) continue;
    if (!shelfLocationMatches(sourceRow, location)) continue;
    let decision = null;
    if (verticalHoldEligible(sourceRow)) {
      decision = packetTradeDecision(sourceRow, sourceRec);
      if (!decision.ok && decision.reason === "vertical_mismatch_sport_fencing") {
        if (sourceRec.blocked_reason !== decision.reason) {
          await stampVerticalHold(sourceRow, sourceRec, decision.reason, holdUpdate || conditionalUpdate);
        }
        continue;
      }
    }
    if (String(sourceRow.preview_url || "").trim() || String(sourceRow.status || "").toLowerCase() !== "held") continue;
    if (sourceRec.duplicate_of || excluded.has(String(sourceRow.prospect_id || ""))) continue;
    // NAME PLAUSIBILITY PREFILTER (round 2): this shelf IS the recycled pool
    // that fed line_mthsj44q its garbage names — a row the miner stored under
    // a scraped <title> or selector string re-enters every later campaign for
    // the same vertical unless it is refused here. A "Home - Real Business"
    // title prefix is STRIPPED and the cleaned row is admitted instead. Runs
    // after the excluded guard so an already-attempted id is never
    // re-quarantined.
    const nameAdmission = pickNameAdmission(sourceRow);
    if (!nameAdmission.ok) {
      nameQuarantined.push(pickNameQuarantineEntry(sourceRow, nameAdmission.reason));
      continue;
    }
    const row = nameAdmission.row;
    const rec = recordOf(row);
    const contact = contactFirstVerdict(row);
    if (!contact.ok) continue;
    const failedAt = Date.parse(String((rec.last_build_error && rec.last_build_error.at) || ""));
    if (Number.isFinite(failedAt) && now() - failedAt < BUILD_RETRY_WINDOW_MS) continue;
    const buildReadyContract = rec.handoff_state === "ready_for_build" && rec.build_ready === true;
    if (!buildReadyContract && !packetHasBasics(row, rec)) continue;
    decision = decision || packetTradeDecision(row, rec);
    if (!decision.ok) {
      continue;
    }
    const trade = decision.trade;
    if (!trade || trade !== wanted) continue;
    const donor = donorFor(trade);
    if (!donor || donor.ok !== true) {
      // An excluded-donor vertical (lib/donor-exclusions.js) can never build:
      // quarantine the row with the terminal cause instead of silently
      // shrinking the shelf, so the funnel names the owner's decision and the
      // refill never re-buys the same refusal.
      if (donor && donor.reason === DONOR_EXCLUSION_CAUSE) {
        nameQuarantined.push(pickNameQuarantineEntry(row, DONOR_EXCLUSION_CAUSE));
      }
      continue;
    }
    const line = { ...rowToLineRow({ ...row, email: contact.email }), leadminerQualified: true, contractIssue: "", vertical: trade, hasEmail: Boolean(contact.email), contactReady: contact.contactReady === true, contactSource: contact.source, contactHoldReason: contact.holdReason || "" };
    if (!buildReadyContract && row.__genieContentCertified !== true) line.needs_fill = true;
    if (line.prospectId && line.businessName) {
      if (includeSourceRows) {
        Object.defineProperty(line, "__sourceRow", { value: row, enumerable: false });
      }
      out.push(line);
    }
  }
  const shelfPicked = gapFirstLineCandidates(out).slice(0, count);
  if (nameQuarantined.length) shelfPicked.quarantined = nameQuarantined;
  return shelfPicked;
}

/**
 * pickProspects — mine when the operator named a market, otherwise take the
 * freshest unbuilt prospects already in the store. Mining uses the miner as it
 * exists; it never runs a migration.
 */
async function pickProspects({ target, campaignTarget, sourceMode = "", count, lane, signal, deadlineAt, excludeProspectIds = [], prospectIds = [], refillRound = 0, queryShapeCursor = 0, queryGroupOffset = 0, deepBatchDepth, onStage, operationKey, acceptedMiningCheckpoint = [] } = {}, deps = {}) {
  const mine = deps.mineLeads || mineLeads;
  const readMany = deps.selectRows || selectRows;
  const readExact = deps.select || select;
  const donorFor = deps.resolveBuildableDonor || resolveBuildableDonor;
  const holdUpdate = deps.conditionalUpdate || conditionalUpdate;
  const effectiveLane = lane === "live" ? "live" : "sandbox";
  // LINE DEEP BATCH DEPTH (owner doctrine 2026-09-04, "scaling and rapid
  // production flow"). The source attempt below used to clip its graded
  // cohort to the remaining quota, so a goal of 10 deep-verified at most 10
  // of the ~40 email survivors. The dial — the batch's stamped request
  // forwarded by the continuation, else the environment — raises the cohort:
  // max(deficit, dial) candidates are graded in ONE wave, the goal is seated,
  // and the prospect bank deposits the compiled surplus. Unset keeps the
  // historical goal-sized cohort exactly.
  const deepBatchDial = Number.isInteger(Number(deepBatchDepth)) && Number(deepBatchDepth) >= 1
    ? Math.min(Number(deepBatchDepth), 100)
    : requestedDeepBatchDepth(process.env);
  // The durable Line always supplies its pick operation key. Direct adapter
  // probes used by local tests and diagnostics do not own a resumable pick and
  // therefore cannot create a durable campaign claim.
  const practiceFreshnessRequired = effectiveLane === "sandbox" && Boolean(String(operationKey || "").trim());
  let practiceHistoryPromise = null;
  let practiceHistoryDegradedReason = "";
  const admitPracticeCandidate = async (row) => {
    if (!practiceFreshnessRequired) return { ok: true };
    if (!practiceHistoryPromise) {
      practiceHistoryPromise = (deps.readPracticeHistory
        ? deps.readPracticeHistory({ signal, deadlineAt })
        : readAllPracticeHistory(readExact, { signal, deadlineAt }));
    }
    const history = await practiceHistoryPromise;
    // DEGRADE HONESTLY (practice history outage law, 2026-09-04). A history
    // read that still fails after retries must NOT mass-refuse the batch —
    // the old definitive refusal is what killed 8 of 9 rows on live batch
    // line_mtolbe4s_b4d88b9589. Skip the history-keys check with a recorded
    // reason and let builds proceed: same-window duplicate rebuilds stay
    // guarded by the durable claim events, so the accepted degradation is a
    // narrowed dedupe net, never a dead batch. Only a genuine abort/deadline
    // expiry still refuses — the run is stopping either way.
    if (history?.degraded === true) {
      practiceHistoryDegradedReason = String(history.reason || PRACTICE_HISTORY_DEGRADED_REASON);
    } else if (!history?.ok) {
      const reason = String(history?.reason || "practice_history_read_failed");
      if (reason === "practice_history_read_aborted") {
        return { ok: false, reason: "practice_history_read_aborted" };
      }
      practiceHistoryDegradedReason = PRACTICE_HISTORY_DEGRADED_REASON;
    }
    if (signal?.aborted === true
      || (Number.isFinite(Date.parse(String(deadlineAt || ""))) && Date.now() >= Date.parse(String(deadlineAt)))) {
      return { ok: false, reason: "practice_history_read_aborted" };
    }
    const historyKeys = history?.ok === true && history?.degraded !== true
      ? (history.keys instanceof Set ? history.keys : new Set(history.keys || []))
      : new Set();
    const identity = practiceIdentity(row);
    const rowOperationKey = `${String(operationKey || "").trim()}:${identity.prospectId}`;
    return practiceFreshnessVerdict(row, {
      lane: effectiveLane,
      operationKey: rowOperationKey,
      historyKeys,
      claim: deps.claimPracticeIdentity || claimPracticeIdentity,
      claimOptions: {
        write: deps.insertRow || insertRow,
        read: readExact,
        requestOptions: { signal, deadlineAt },
      },
    });
  };
  // Loud recording: when the pick ran with a degraded history read, every
  // returned cohort carries the reason (result.practiceHistoryDegraded) and a
  // funnel stage naming it, so the durable checkpoint records the skip on the
  // funnel instead of silently weakening dedupe.
  const finishPick = (result) => {
    if (!practiceHistoryDegradedReason || !Array.isArray(result)) return result;
    result.practiceHistoryDegraded = practiceHistoryDegradedReason;
    result.funnel = [
      { stage: "practice_history_degraded", reason: practiceHistoryDegradedReason, at: new Date().toISOString() },
      ...(Array.isArray(result.funnel) ? result.funnel : []),
    ];
    return result;
  };
  const stage = async (name, detail = {}) => {
    if (typeof onStage === "function") await onStage(name, detail);
  };
  const exactIds = Array.isArray(prospectIds)
    ? prospectIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (exactIds.length) {
    await stage("exact_store_read");
    if (exactIds.length > 10 || Number(count) !== exactIds.length
      || new Set(exactIds).size !== exactIds.length
      || exactIds.some((id) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id))) {
      throw Object.assign(new Error("explicit_prospect_ids_invalid"), { code: "explicit_prospect_ids_invalid" });
    }
    const escaped = exactIds.map((id) => `"${id.replace(/"/g, "\\\"")}"`).join(",");
    const loaded = await readExact(
      PROSPECTS,
      `?select=*&prospect_id=in.(${escaped})&limit=${exactIds.length}`,
      { signal, deadlineAt },
    );
    if (!loaded || loaded.ok !== true || !Array.isArray(loaded.data)) {
      throw Object.assign(new Error("explicit_prospect_store_read_failed"), { code: "explicit_prospect_store_read_failed" });
    }
    const loadedIds = loaded.data.map((row) => String(row && row.prospect_id || ""));
    if (loadedIds.some((id) => !exactIds.includes(id)) || new Set(loadedIds).size !== loadedIds.length) {
      throw Object.assign(new Error("explicit_prospect_store_identity_mismatch"), { code: "explicit_prospect_store_identity_mismatch" });
    }
    const byId = new Map(loaded.data.map((row) => [String(row.prospect_id || ""), row]));
    const missing = exactIds.filter((id) => !byId.has(id));
    if (missing.length) {
      throw Object.assign(new Error("explicit_prospect_ids_not_found"), {
        code: "explicit_prospect_ids_not_found",
        missing,
      });
    }
    const excluded = new Set((excludeProspectIds || []).map((value) => String(value || "").trim()).filter(Boolean));
    if (exactIds.some((id) => excluded.has(id))) {
      throw Object.assign(new Error("explicit_prospect_already_attempted"), { code: "explicit_prospect_already_attempted" });
    }
    const exact = [];
    const rejected = [];
    for (const id of exactIds) {
      const row = byId.get(id);
      const verdict = await exactProspectCandidate(row, {
        donorFor,
        holdUpdate,
        clock: deps.clock || Date.now,
        allowRecentBuildRetry: effectiveLane === "sandbox",
        lane: effectiveLane,
      });
      if (!verdict.ok) rejected.push(verdict.reason || "explicit_prospect_ineligible");
      else exact.push({ row, line: verdict.line });
    }
    await stage("exact_eligibility_complete");
    if (rejected.length || exact.length !== exactIds.length) {
      const error = new Error("explicit_prospect_ids_ineligible");
      error.code = "explicit_prospect_ids_ineligible";
      error.reasons = rejected;
      throw error;
    }
    for (const entry of exact) {
      const fresh = await admitPracticeCandidate(entry.row);
      if (!fresh.ok) {
        const error = new Error(fresh.reason);
        error.code = fresh.reason;
        error.retryable = false;
        throw error;
      }
    }
    // Exact IDs are an identity promise, and mine-leads persists build-ready
    // rows WITHOUT compiling Intake Genie — this early return used to hand
    // them straight to the builder around the authority packet. Close the
    // seam: verify/reuse or compile-persist-verify every named row, all or
    // nothing. ANY compiler refusal — including a deterministic 422 — fails
    // the whole exact pick; there is no quarantine, refill, or substitution
    // for a row the operator named. Transient failures ride the existing
    // exact retry path and reuse every already-persisted sibling receipt.
    await stage("exact_authority_compile");
    // Bounded pool: one serverless Genie function serves every row, so an
    // unbounded Promise.all multiplies per-request latency into caller
    // aborts. Semantics unchanged — all-or-nothing on the exact pick.
    const compiledExact = await mapWithConcurrency(exact, poolSize(process.env), (entry) => compileGenieContent(entry.row, {
      ...deps,
      signal,
      conditionalUpdate: holdUpdate,
    }));
    await stage("exact_authority_complete");
    const exactTerminal = compiledExact.find((compiled) => compiled.ok !== true && compiled.retryable === false);
    const exactFailure = exactTerminal || compiledExact.find((compiled) => compiled.ok !== true);
    if (exactFailure) {
      const retryable = exactFailure.retryable !== false;
      const error = new Error(retryable ? "intake_genie_compile_retryable" : "intake_genie_compile_terminal");
      error.code = retryable ? "intake_genie_compile_retryable" : "intake_genie_compile_terminal";
      error.retryable = retryable;
      error.causeCode = String(exactFailure.reason || "intake_genie_compile_failed").slice(0, 160);
      throw attachCompilerProblemDetail(error, exactFailure);
    }
    const lines = compiledExact.map((compiled, index) => {
      const entry = exact[index];
      const compiledRow = compiled.row || entry.row;
      const line = {
        // Re-derive every canonical projection from the row the compiler
        // persisted, so durableUpdatedAt equals the certification checkpoint
        // and downstream CAS identities (identity-freeze, persisted-mirror)
        // guard against the durable truth instead of a pre-receipt snapshot.
        ...rowToLineRow(compiledRow),
        // The eligibility verdicts already proven on this exact row are
        // decision outputs, not row projections; compile does not change them.
        vertical: entry.line.vertical,
        email: entry.line.email,
        hasEmail: entry.line.hasEmail,
        contactReady: entry.line.contactReady,
        contactSource: entry.line.contactSource,
        contactHoldReason: entry.line.contactHoldReason,
        ...(entry.line.leadminerQualified === undefined ? {} : { leadminerQualified: entry.line.leadminerQualified }),
        ...(entry.line.contractIssue === undefined ? {} : { contractIssue: entry.line.contractIssue }),
        ...(entry.line.needs_fill === undefined ? {} : { needs_fill: entry.line.needs_fill }),
      };
      if (compiled.certified === true) {
        // A signed content receipt fast-passes CONTENT completeness only; when
        // it exists the packet needs no AI fill. Identity/vertical/render
        // gates all remain downstream exactly as before.
        line.genieContentCertified = true;
        line.needs_fill = false;
      }
      return line;
    });
    lines.funnel = [createExplicitProspectMarker(exactIds, { survived: lines.length })];
    return finishPick(lines);
  }
  const plan = parseTarget(target);
  const freshAllTradesCampaign = new Set(["all trades", "all trades nationwide"])
    .has(String(campaignTarget || "").trim().toLowerCase());
  if (freshAllTradesCampaign && !plan) {
    throw Object.assign(new Error("fresh_all_trades_target_unparseable"), {
      code: "fresh_all_trades_target_unparseable",
      retryable: false,
    });
  }
  const freshFirstAllTrades = Boolean(plan) && freshAllTradesCampaign;
  const excluded = new Set((excludeProspectIds || []).map(String));
  let rows;
  let minedFunnel = null;
  let sourceExhaustedContract = null;
  // Candidate-local Intake Genie refusals (422, supported needs_input, or only
  // allowlisted row-bound certification gaps) ride out on the
  // returned array so runPick can checkpoint them as durable rejected rows —
  // the exclusion that stops a refill from re-buying the same 422.
  const compileQuarantined = [];
  // Transient (retryable) compile casualties of THIS pass, never quarantined.
  // Reported on the returned array so the durable quota controller can mark a
  // timeout-heavy source slow for this batch and rotate immediately.
  const compileCasualties = { timeouts: 0, retryable: 0, sourceTarget: String(target || "").slice(0, 160) };
  const recordCompileCasualties = (retryable) => {
    const census = compileRetryableCensus(retryable);
    compileCasualties.timeouts += census.timeoutClass;
    compileCasualties.retryable += retryable.length;
  };
  // Every identity returned by the fresh mine is spent for this source
  // attempt, including duplicate-skipped and candidate-local refusals. A
  // fallback shelf must not reintroduce one of those same prospect ids.
  const minedProspectIds = new Set();
  // SHELF-FIRST for a vertical target: the owner's held packets for this trade
  // are preferred over a fresh web-hunt, and mining only covers the shortfall.
  // Empty for the "leadminer" and freshest-store paths.
  let shelfFirst = [];
  const compileAllTradesShelfFallback = async (limit) => {
    if (!freshFirstAllTrades || !plan || limit <= 0) return [];
    await stage("vertical_shelf_fallback_read");
    const selected = await pickVerticalShelf({
      industry: plan.industry,
      location: plan.location,
      count: limit,
      readExact,
      donorFor,
      holdUpdate,
      clock: deps.clock,
      lane: effectiveLane,
      excludeProspectIds: [...excluded, ...minedProspectIds],
      includeSourceRows: true,
    });
    // Prefilter casualties from the fallback shelf become durable rejected
    // rows exactly like fresh-lane ones — a short shelf must not lose them.
    if (Array.isArray(selected.quarantined)) compileQuarantined.push(...selected.quarantined);
    if (!selected.length) return [];

    const freshSelected = [];
    for (const line of selected) {
      const fresh = await admitPracticeCandidate(line.__sourceRow);
      if (fresh.ok) freshSelected.push(line);
      else compileQuarantined.push({
        prospectId: String(line.__sourceRow?.prospect_id || line.prospectId || ""),
        businessName: String(line.__sourceRow?.business_name || line.businessName || ""),
        vertical: String(line.vertical || ""),
        reason: fresh.reason,
      });
    }
    if (!freshSelected.length) return [];

    await stage("vertical_shelf_fallback_authority_compile");
    const compiledRows = await mapWithConcurrency(freshSelected, poolSize(process.env), async (line) => ({
      line,
      compiled: await compileGenieContent(line.__sourceRow, {
        ...deps,
        signal,
        conditionalUpdate: holdUpdate,
      }),
    }));
    await stage("vertical_shelf_fallback_authority_complete");

    const globalFailure = compiledRows.find(({ compiled }) => compiled.ok !== true
      && compiled.retryable === false
      && compiled.candidateLocal !== true);
    if (globalFailure) {
      const error = new Error("intake_genie_compile_terminal");
      error.code = "intake_genie_compile_terminal";
      error.retryable = false;
      error.causeCode = String(globalFailure.compiled.reason || "intake_genie_compile_failed").slice(0, 160);
      throw attachCompilerProblemDetail(error, globalFailure.compiled);
    }
    // Same-pass rotation doctrine as the fresh-mined lane: a transient
    // compile failure with certified siblings keeps them; only a starved
    // pass throws retryable. Timed-out candidates are transient — dropped
    // here, re-bought by the refill, never durably quarantined.
    const fallbackOutcome = compilePassOutcome(compiledRows.map(({ compiled }) => compiled));
    if (fallbackOutcome.kind === "starved") {
      throw throwCompileRetryable(fallbackOutcome.retryable, target);
    }
    const fallbackRetryableDropped = fallbackOutcome.kind === "partial" ? fallbackOutcome.retryable : [];
    if (fallbackRetryableDropped.length) recordCompileCasualties(fallbackRetryableDropped);

    const admitted = [];
    for (const { line: selectedLine, compiled } of compiledRows) {
      const sourceRow = selectedLine.__sourceRow || {};
      if (!compiled.ok) {
        const reason = compiled.reason || "intake_genie_compile_failed";
        if (fallbackRetryableDropped.includes(compiled)) continue;
        compileQuarantined.push({
          prospectId: String(sourceRow.prospect_id || selectedLine.prospectId || ""),
          businessName: String(sourceRow.business_name || selectedLine.businessName || ""),
          vertical: String(selectedLine.vertical || recordOf(sourceRow).industry || ""),
          reason: `intake_genie_candidate_refused: ${reason}`.slice(0, 240),
          ...compilerProblemDetail(compiled),
        });
        continue;
      }
      let line = { ...selectedLine };
      if (compiled.row) {
        const current = contactReadyLine(compiled.row);
        if (current.ok) {
          line = {
            ...line,
            ...current.line,
            vertical: selectedLine.vertical,
            leadminerQualified: true,
            contractIssue: "",
          };
        }
      }
      if (compiled.certified === true) {
        line.genieContentCertified = true;
        delete line.needs_fill;
      }
      admitted.push(line);
    }
    return admitted;
  };
  // THE NEW RIFLE (owner instruction 2026-08-05): target "leadminer" draws
  // from the held, build-ready LeadMiner truth packets the webhook delivered —
  // no mining, no providers. Qualification happened at LeadMiner's export
  // gate (websiteWorseThan filter), so these rows carry leadminerQualified
  // and the line's second grader stands down instead of re-grading.
  if (String(target || "").trim().toLowerCase() === "leadminer") {
    await stage("packet_shelf_read");
    // READ THE SHELF AS A SHELF, not through the freshest-N window over ALL
    // prospects. The old read pulled the newest `count*3` rows of the whole
    // table and filtered client-side — so any mining activity buried the
    // packets under newer non-packet rows. Measured 2026-08-09: 14 packet
    // rows in the store, exactly ONE inside the freshest-30 window, and ten
    // consecutive "LeadMiner packets" runs re-picked that same one row.
    // PostgREST filters on the JSONB source instead, so the shelf is the
    // shelf no matter what else the store has been doing.
    const shelfQuery = `?select=*&record->>truth_packet_source=eq.leadminer_mirror_ready`
      + `&order=updated_at.desc&limit=${Math.max(count * 5, 100)}`;
    const held = await readExact(PROSPECTS, shelfQuery);
    if (!held || held.ok !== true || !Array.isArray(held.data)) {
      // A shelf we cannot read is a failed pick, not an empty shelf. Returning
      // [] here would render as "0 candidates found" — a supply statement —
      // when the truth is a read error.
      throw new Error("mining_failed: packet_shelf_read_failed");
    }
    // EVERY ROW THE SHELF LOSES IS COUNTED, BY NAME. These tallies ride out on
    // the funnel the batches panel already renders, so "1 picked of 10
    // requested" arrives with the arithmetic that explains it instead of a
    // mute empty batch.
    const kills = {};
    const kill = (why) => { kills[why] = (kills[why] || 0) + 1; };
    const clock = deps.clock || Date.now;
    const shelf = [];
    const preCandidates = [];
    let shaped = 0;
    for (const sourceRow of held.data) {
      const sourceRec = recordOf(sourceRow);
      // Belt over the server-side filter: only packet-shaped rows are shelf
      // inventory at all (a test double or a hand-written row can still hand
      // this loop anything).
      if (!(sourceRec.truth_packet && sourceRec.truth_packet_source === "leadminer_mirror_ready")) continue;
      shaped += 1;
      const admission = liveAdmissionVerdict(sourceRow, effectiveLane);
      if (!admission.ok) {
        kill(admission.reason);
        continue;
      }
      if (excluded.has(String(sourceRow.prospect_id || ""))) {
        kill("already attempted in this campaign — sourcing a replacement");
        continue;
      }
      // NAME PLAUSIBILITY PREFILTER (round 2, line_mthsj44q evidence): the
      // packet shelf is the recycled pool — a held row stored under a scraped
      // <title> ("Home - Backlund Plumbing"), a CSS selector, an HTML entity,
      // or a marketing tagline re-entered every later campaign because round 1
      // only screened the fresh-mine lane. Refuse the obviously-not-a-business
      // names HERE, before the shelf's Intake Genie compile spend, and strip
      // title-tag prefixes so real businesses scraped off <title> tags are
      // admitted under their actual name. Runs after `shaped += 1` (honest
      // stage-1 funnel arithmetic) and after the excluded guard (an
      // already-attempted id is never re-quarantined). An empty name defers
      // to the shelf identity gates below — their kill names the real
      // problem ("no usable identity"), which is the better diagnosis.
      const nameAdmission = pickNameAdmission(sourceRow);
      if (!nameAdmission.ok) {
        kill(nameAdmission.reason || PICK_NAME_IMPLAUSIBLE);
        compileQuarantined.push(pickNameQuarantineEntry(sourceRow, nameAdmission.reason));
        continue;
      }
      const row = nameAdmission.row;
      const rec = recordOf(row);
      // Audit vertical truth before terminal-state filtering so an already
      // queued sword-fencing mismatch is still durably quarantined. It is
      // never compiled or built.
      const verticalDecision = packetTradeDecision(row, rec);
      if (!verticalDecision.ok && verticalDecision.reason === SPORT_FENCING_HOLD_REASON
        && verticalHoldEligible(row) && rec.blocked_reason !== verticalDecision.reason) {
        await stampVerticalHold(row, rec, verticalDecision.reason, holdUpdate);
      }
      if (String(row.preview_url || "").trim() || String(row.status || "").toLowerCase() !== "held") {
        kill("already built, queued or sent");
        continue;
      }
      const buildReadyContract = rec.handoff_state === "ready_for_build" && rec.build_ready === true;
      if (!buildReadyContract && !packetHasBasics(row, rec)) {
        kill("export incomplete and no usable identity — cannot even AI-fill this packet");
        continue;
      }
      if (rec.duplicate_of) {
        kill("duplicate business — the other row carries the mirror");
        continue;
      }
      const contact = contactFirstVerdict(row);
      if (!contact.ok) {
        kill(contact.reason || "contact_classification_failed");
        continue;
      }
      // Sandbox builds route delivery to the owner, so a missing prospect
      // address may not kill the website. Live delivery remains fail-closed.
      if (effectiveLane === "live" && !contact.email) {
        kill("no_contact_email");
        continue;
      }
      const failedAt = Date.parse(String((rec.last_build_error && rec.last_build_error.at) || ""));
      if (Number.isFinite(failedAt) && clock() - failedAt < BUILD_RETRY_WINDOW_MS) {
        kill("failed a build in the last day — retried automatically after the window");
        continue;
      }
      const contactRow = { ...row, email: contact.email, __contactSource: contact.source };
      if (!verticalDecision.ok) {
        shelf.push({ ...contactRow, __verticalContractIssue: verticalDecision.reason || "vertical_truth_refused" });
        continue;
      }
      const donor = donorFor(verticalDecision.trade);
      if (donor && donor.ok !== true && donor.reason === DONOR_EXCLUSION_CAUSE) {
        // DONOR EXCLUSION REFUSAL (lib/donor-exclusions.js): every in-service
        // donor for this vertical is owner-barred for line campaigns, so the
        // pick can never build. Refuse at admission — BEFORE the Intake
        // Genie compile spend — riding the same quarantine metadata path as
        // pick_name_implausible (durable rejected row + refill exclusion).
        kill(DONOR_EXCLUSION_CAUSE);
        compileQuarantined.push(pickNameQuarantineEntry(contactRow, DONOR_EXCLUSION_CAUSE));
        continue;
      }
      if (!donor || donor.ok !== true) {
        shelf.push({
          ...contactRow,
          __verticalContractIssue: `no clean donor for ${verticalDecision.trade} (${(donor && donor.reason) || "unavailable"})`,
        });
        continue;
      }
      preCandidates.push({
        ...rowToLineRow(contactRow),
        __preTrade: verticalDecision.trade,
        __sourceRow: contactRow,
      });
    }

    // Compilation is provider work. Order first, cap at the requested
    // shortfall, then run only that bounded set in parallel under the existing
    // pick AbortSignal/timeout. A valid durable receipt returns before the
    // compiler call, so retries spend zero provider calls.
    let orderedForCompile;
    if (queueGapFirstEnabled(deps.env || process.env)) {
      orderedForCompile = gapFirstLineCandidates(preCandidates, deps.env || process.env);
    } else {
      const buckets = new Map();
      for (const candidate of preCandidates) {
        const trade = String(candidate.__preTrade || "").toLowerCase();
        if (!buckets.has(trade)) buckets.set(trade, []);
        buckets.get(trade).push(candidate);
      }
      orderedForCompile = [];
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const bucket of buckets.values()) {
          if (bucket.length) {
            orderedForCompile.push(bucket.shift());
            progressed = true;
          }
        }
      }
    }
    const toCompile = [];
    for (const candidate of orderedForCompile.slice(0, count)) {
      const fresh = await admitPracticeCandidate(candidate.__sourceRow);
      if (fresh.ok) toCompile.push(candidate);
      else compileQuarantined.push({
        prospectId: String(candidate.__sourceRow?.prospect_id || ""),
        businessName: String(candidate.__sourceRow?.business_name || candidate.businessName || ""),
        vertical: String(candidate.__preTrade || ""),
        reason: fresh.reason,
      });
    }
    await stage("packet_authority_compile");
    // Bounded pool, same as the exact and fresh-mined lanes: one serverless
    // Genie function serves every row, so an unbounded Promise.all multiplies
    // per-request latency into caller aborts.
    const compiledRows = await mapWithConcurrency(toCompile, poolSize(process.env), async (candidate) => ({
      candidate,
      compiled: await compileGenieContent(candidate.__sourceRow, {
        ...deps,
        signal,
        conditionalUpdate: holdUpdate,
      }),
    }));
    await stage("packet_authority_complete");
    // SAME FAILURE TRIAGE AS THE FRESH-MINED LANE, scanning every result so
    // order cannot decide truth. The all-trades quota starts on this source:
    // a global config/auth/endpoint failure must halt loudly instead of
    // draining the shelf, and a transient throttle that starved the whole
    // pass must retry (receipts make the retry free) instead of rotating the
    // source. A transient failure WITH certified siblings keeps them and
    // refills the gap; only a proven candidate-local verdict may kill the
    // single candidate it names.
    const shelfOutcome = compilePassOutcome(compiledRows.map(({ compiled }) => compiled));
    if (shelfOutcome.kind === "global") {
      const shelfBlocker = compiledRows.find(({ compiled }) => compiled.ok !== true
        && compiled.retryable === false
        && compiled.candidateLocal !== true);
      const error = new Error("intake_genie_compile_terminal");
      error.code = "intake_genie_compile_terminal";
      error.retryable = false;
      error.causeCode = String(shelfBlocker.compiled.reason || "intake_genie_compile_failed").slice(0, 160);
      throw attachCompilerProblemDetail(error, shelfBlocker.compiled);
    }
    if (shelfOutcome.kind === "starved") {
      throw throwCompileRetryable(shelfOutcome.retryable, target);
    }
    const shelfRetryableDropped = shelfOutcome.kind === "partial" ? shelfOutcome.retryable : [];
    if (shelfRetryableDropped.length) recordCompileCasualties(shelfRetryableDropped);
    const shelfCompileRejected = {};
    for (const { candidate, compiled } of compiledRows) {
      if (!compiled.ok) {
        const reason = compiled.reason || "intake_genie_compile_failed";
        kill(reason);
        shelfCompileRejected[reason] = (shelfCompileRejected[reason] || 0) + 1;
        if (shelfRetryableDropped.includes(compiled)) continue; // transient: refill re-buys, no durable quarantine
        // Only proven candidate-local verdicts remain after the triage above. The funnel
        // names the kill, and the quarantine metadata below becomes a durable
        // rejected batch row so no refill re-buys the same refusal.
        const sourceRow = candidate.__sourceRow || {};
        compileQuarantined.push({
          prospectId: String(sourceRow.prospect_id || ""),
          businessName: String(sourceRow.business_name || recordOf(sourceRow).business_name || ""),
          vertical: String(candidate.__preTrade || recordOf(sourceRow).industry || ""),
          reason: `intake_genie_candidate_refused: ${reason}`.slice(0, 240),
          ...compilerProblemDetail(compiled),
        });
        continue;
      }
      let row = compiled.row;
      const rec = compiled.rec;
      const contentCertified = compiled.certified === true;
      row = { ...row, __genieContentCertified: contentCertified };
      // BUILD-READINESS PREFLIGHT (issue #376): every check the truth gates
      // enforce must fire HERE, before any spend, so a slot-filling mismatch
      // is caught at intake, not mid-build.
      //
      // A signed Genie receipt fast-passes CONTENT completeness only. It does
      // not waive the identity/vertical/duplicate checks above, and every
      // render/proof/delivery gate remains downstream. Logo absence is never a
      // refusal: the frozen logo ladder chooses the wordmark rung.
      if (!contentCertified) {
        const preflightTruth = rec.truth_packet || {};
        const preflightPkt = preflightTruth.mirror_ready || {};
        const preflightSvcs = (Array.isArray(preflightPkt.services) && preflightPkt.services.length)
          ? preflightPkt.services
          : (Array.isArray(preflightTruth.services) ? preflightTruth.services : []);
        if (!preflightSvcs.length) {
          kill("no_services");
          continue;
        }
      }
      shelf.push(row);
    }
    const mappedShelf = shelf
      // contractIssue is the MINED contract's completeness check; a truth
      // packet has no mined contract and must not be rejected for lacking one.
      .map((row) => {
        const rec = recordOf(row);
        const line = { ...rowToLineRow(row), leadminerQualified: true, contractIssue: "", hasEmail: Boolean(row.email), contactReady: Boolean(row.email), contactSource: row.__contactSource || "unavailable", contactHoldReason: row.email ? "" : "no verified business email — delivery held" };
        if (row.__verticalContractIssue) {
          line.contractIssue = row.__verticalContractIssue;
          return line;
        }
        // NEEDS_FILL rides with the row: a packet that survived the shelf on its
        // identity alone (the strict export contract failed) builds with its thin
        // content AI-filled downstream. mirrorProspect reads this off the record.
        if (!(rec.handoff_state === "ready_for_build" && rec.build_ready === true)
          && row.__genieContentCertified !== true) line.needs_fill = true;
        if (row.__genieContentCertified === true) line.genieContentCertified = true;
        // DECIDE THE TRADE HERE, BEFORE ANY SPEND. The packet's `industry`
        // label is unreliable (it said "plumber" for an air-conditioning
        // company), so the trade is derived from the services, and a business
        // we cannot honestly build is rejected at PICK time rather than after
        // a build and a render gate — which is a wasted build and a confusing
        // failure the operator has to decode.
        // Exporters have written the service list at both levels of the
        // packet, so read the nested shape first and fall back to the root
        // rather than silently score an empty list and refuse a good lead.
        const truth = recordOf(row).truth_packet || {};
        const packet = truth.mirror_ready || {};
        const services = (Array.isArray(packet.services) && packet.services.length)
          ? packet.services
          : (Array.isArray(truth.services) ? truth.services : []);
        const label = packet.industry || truth.industry || "";
        const verdict = inferTrade({
          label,
          services,
          businessName: row.business_name || line.businessName || "",
        });
        if (verdict.blocked) {
          line.contractIssue = verdict.reason;
          return line;
        }
        const trade = approvedIndustry(verdict.trade) || approvedIndustry(label);
        if (!trade) {
          line.contractIssue = "no recognisable trade in the packet's services";
          return line;
        }
        const donor = donorFor(trade);
        if (!donor || donor.ok !== true) {
          line.contractIssue = donor && donor.reason === DONOR_EXCLUSION_CAUSE
            ? DONOR_EXCLUSION_CAUSE
            : `no clean donor for ${trade} (${(donor && donor.reason) || "unavailable"})`;
          return line;
        }
        line.vertical = trade;
        return line;
      })
      .filter((r) => r.prospectId && r.businessName);
    // TRADE SPREAD across the packet shelf (owner, 2026-08-13: "LeadMiner lets
    // you select all ten verticals and run leads on them" — so the shelf holds a
    // diverse export, and "all trades" must actually be all trades, not just the
    // freshest vertical). Buildable rows (a resolved trade, no contract issue)
    // are round-robined by their inferred trade; unbuildable rows keep their
    // place AFTER, so the funnel still names every refusal instead of hiding it
    // behind a spread. When only one trade is present this is a no-op ordering.
    const spreadBuildable = mappedShelf.filter((r) => !r.contractIssue);
    const spreadRest = mappedShelf.filter((r) => r.contractIssue);
    const byTrade = new Map();
    for (const r of spreadBuildable) {
      const k = String(r.vertical || "").toLowerCase();
      if (!byTrade.has(k)) byTrade.set(k, []);
      byTrade.get(k).push(r);
    }
    const tradeOrder = [...byTrade.keys()];
    const spread = [];
    if (queueGapFirstEnabled()) {
      // Apply a per-vertical cap — ceil(count / numVerticals) — so that one
      // dense trade on the shelf cannot fill all batch slots. The gap-priority
      // ordering is preserved within each vertical's share. The cap SPREADS the
      // pick, it never drops ready work: slots still empty after the capped
      // pass refill in the same deadest-first order, so asking for the whole
      // shelf always returns the whole shelf. When only one vertical is present
      // this is a no-op.
      const numVerticals = Math.max(1, byTrade.size);
      const maxPerVertical = Math.max(1, Math.ceil(count / numVerticals));
      const ordered = gapFirstLineCandidates(spreadBuildable);
      const taken = new Set();
      const capMap = new Map();
      for (const r of ordered) {
        const k = String(r.vertical || "").toLowerCase();
        if ((capMap.get(k) || 0) >= maxPerVertical) continue;
        capMap.set(k, (capMap.get(k) || 0) + 1);
        taken.add(r);
        spread.push(r);
      }
      for (const r of ordered) {
        if (spread.length >= count) break;
        if (taken.has(r)) continue;
        taken.add(r);
        spread.push(r);
      }
    } else {
      // Kill switch restores the prior representative trade spread exactly.
      let progressed = true;
      while (spread.length < count && progressed) {
        progressed = false;
        for (const k of tradeOrder) {
          if (spread.length >= count) break;
          const bucket = byTrade.get(k);
          if (bucket && bucket.length) { spread.push(bucket.shift()); progressed = true; }
        }
      }
    }
    const picked = spread.concat(spreadRest).slice(0, count);
    // HONEST SUPPLY ARITHMETIC, on the surface the console already draws.
    // line-runner copies `picked.funnel` onto batch.mineFunnel and the batches
    // panel renders it (stage bars + named kill chips), so a short shelf now
    // SAYS it is short instead of looking like a run that quietly shrank:
    // stage 1 is what the shelf held and what each filter took; stage 2 is
    // requested vs picked, and the shortfall names where fresh supply comes
    // from. Every number is a measurement — nothing here is padded.
    const shortfall = Math.max(0, count - picked.length);
    picked.funnel = [
      { stage: "1_packet_shelf", entered: shaped, survived: shelf.length, rejected: kills },
      ...(Object.keys(shelfCompileRejected).length
        ? [{
          stage: "intake_genie_authority_packet",
          entered: compiledRows.length,
          survived: compiledRows.length
            - Object.values(shelfCompileRejected).reduce((sum, n) => sum + n, 0),
          rejected: shelfCompileRejected,
        }]
        : []),
      {
        stage: `2_requested_${count}`,
        entered: count,
        survived: picked.length,
        rejected: shortfall > 0
          ? {
            [`packet shelf exhausted — new packets arrive from LeadMiner exports; a vertical target (e.g. "plumbers in Chattanooga") mines fresh leads instead`]: shortfall,
          }
          : {},
      },
    ];
    if (compileQuarantined.length) picked.quarantined = compileQuarantined;
    return finishPick(picked);
  }
  // PAYDIRT PRE-PAIRED LEADS (owner doctrine 2026-09-02): target "paydirt"
  // draws business+phone(+email) leads from the owner's PayDirt product
  // through lib/prospect-sources/paydirt.js — export file first (v1), API
  // second. Same named-source shape as "leadminer": a shelf read of rows a
  // previous pass already imported (record.truth_packet_source =
  // "paydirt_prepaired"), the adapter read only covering the shortfall, the
  // SAME Intake Genie compile seam, and the SAME surplus bank deposit.
  // FALLBACK LAW: PayDirt unavailability must NEVER break the campaign — a
  // not_configured/unavailable read records its reason on the funnel and
  // falls through to the existing freshest-store lane below.
  let paydirtFallbackFunnel = null;
  if (String(target || "").trim().toLowerCase() === "paydirt") {
    const paydirtRead = deps.paydirtRead || paydirtSource.readPaydirtLeads;
    const paydirtMap = deps.paydirtMap || paydirtSource.mapPaydirtLead;
    const upsertPaydirt = deps.upsertRow || upsertRow;
    const kills = {};
    const kill = (why) => { kills[why] = (kills[why] || 0) + 1; };
    const paydirtShelfAdmission = async (sourceRow) => {
      const nameAdmission = pickNameAdmission(sourceRow);
      if (!nameAdmission.ok) {
        kill("pick_name_implausible");
        compileQuarantined.push(pickNameQuarantineEntry(sourceRow, nameAdmission.reason));
        return null;
      }
      const row = nameAdmission.row;
      if (excluded.has(String(row.prospect_id || ""))) {
        kill("already attempted in this campaign — sourcing a replacement");
        return null;
      }
      const admission = liveAdmissionVerdict(row, effectiveLane);
      if (!admission.ok) {
        kill(admission.reason);
        compileQuarantined.push({
          prospectId: String(row.prospect_id || ""),
          businessName: String(row.business_name || recordOf(row).business_name || ""),
          vertical: String(recordOf(row).industry || ""),
          reason: admission.reason,
        });
        return null;
      }
      const fresh = await admitPracticeCandidate(row);
      if (!fresh.ok) {
        kill(fresh.reason);
        compileQuarantined.push({
          prospectId: String(row.prospect_id || ""),
          businessName: String(row.business_name || recordOf(row).business_name || ""),
          vertical: String(recordOf(row).industry || ""),
          reason: fresh.reason,
        });
        return null;
      }
      return row;
    };
    // READ THE SHELF AS A SHELF (same law as the LeadMiner packet shelf): a
    // PostgREST filter on the JSONB source dimension, not a freshest-N window
    // over the whole table, so paydirt rows stay drawable no matter what else
    // the store has been doing.
    await stage("paydirt_shelf_read");
    const shelfQuery = `?select=*&record->>truth_packet_source=eq.paydirt_prepaired`
      + `&order=updated_at.desc&limit=${Math.max(count * 5, 100)}`;
    const heldPaydirt = await readExact(PROSPECTS, shelfQuery);
    const admittedShelf = [];
    let paydirtReadCount = 0;
    let cappedByQuota = false;
    if (heldPaydirt && heldPaydirt.ok === true && Array.isArray(heldPaydirt.data)) {
      for (const sourceRow of heldPaydirt.data) {
        if (admittedShelf.length >= count) break;
        if (!(recordOf(sourceRow).truth_packet_source === "paydirt_prepaired")) continue;
        const admitted = await paydirtShelfAdmission(sourceRow);
        if (admitted) admittedShelf.push(admitted);
      }
    }
    // Imported rows append to the same array; snapshot the shelf's own seat
    // count first so the funnel arithmetic never double-counts them.
    const paydirtShelfSeated = admittedShelf.length;
    const paydirtShortfall = count - admittedShelf.length;
    let imported = admittedShelf;
    if (paydirtShortfall > 0) {
      await stage("paydirt_source_read");
      const read = await paydirtRead({
        environment: process.env,
        count: paydirtShortfall,
        signal,
        deadlineAt,
      }).catch((error) => ({ ok: false, status: "unavailable", reason: `paydirt_read_threw:${boundedDetailText(error && (error.code || error.message) || "unknown")}` }));
      if (!read || read.ok !== true) {
        // LOUD FALL-THROUGH: the reason rides the funnel the batches panel
        // renders, and the pick continues into the existing freshest-store
        // lane exactly as a blank target would. Nothing halts here.
        const reason = String((read && read.reason) || "paydirt_source_unavailable").slice(0, 160);
        paydirtFallbackFunnel = {
          stage: "1_paydirt_source",
          entered: paydirtShortfall,
          survived: 0,
          rejected: { [`paydirt source unavailable (${reason}) — fell through to stored leads`]: paydirtShortfall },
          source_target: "paydirt",
          mode: "paydirt_prepaired_fallback",
        };
      } else {
        paydirtReadCount = Number(read.readCount) || (Array.isArray(read.leads) ? read.leads.length : 0);
        cappedByQuota = read.cappedByQuota === true;
        const mappedRows = [];
        const seenIds = new Set(admittedShelf.map((row) => String(row.prospect_id || "")));
        for (const lead of Array.isArray(read.leads) ? read.leads : []) {
          const mapped = paydirtMap(lead);
          if (!mapped || mapped.ok !== true) {
            kill(String((mapped && mapped.reason) || "paydirt_lead_refused"));
            continue;
          }
          const id = String(mapped.row.prospect_id || "");
          if (!id || seenIds.has(id) || excluded.has(id)) {
            kill("paydirt_duplicate_in_read");
            continue;
          }
          seenIds.add(id);
          mappedRows.push(mapped.row);
        }
        if (mappedRows.length) {
          await stage("paydirt_persist");
          const persistedIds = [];
          for (const row of mappedRows) {
            const stored = await upsertPaydirt(PROSPECTS, row, "prospect_id")
              .catch(() => null);
            if (stored && (stored.mode === "live_upsert" || stored.ok === true)) persistedIds.push(row.prospect_id);
            else kill("paydirt_persist_failed");
          }
          if (persistedIds.length) {
            // Reload what the store actually holds (one read) so the compile
            // seam's updated_at CAS guards against durable truth, the same
            // reload contract the fresh-mine lane uses.
            const escaped = persistedIds.map((id) => `"${String(id).replace(/"/g, "\\\"")}"`).join(",");
            const reloaded = await readExact(PROSPECTS, `?select=*&prospect_id=in.(${escaped})&limit=${persistedIds.length}`);
            const byId = new Map((reloaded && Array.isArray(reloaded.data) ? reloaded.data : [])
              .map((row) => [String(row.prospect_id || ""), row]));
            for (const id of persistedIds) {
              const row = byId.get(String(id));
              if (!row) {
                kill("paydirt_reload_missing");
                continue;
              }
              const admitted = await paydirtShelfAdmission(row);
              if (admitted) imported.push(admitted);
            }
          }
        }
      }
    }
    if (imported.length) {
      await stage("paydirt_authority_compile");
      const compiledPaydirt = await mapWithConcurrency(imported, poolSize(process.env), (row) => compileGenieContent(row, {
        ...deps,
        signal,
        conditionalUpdate: holdUpdate,
      }));
      await stage("paydirt_authority_complete");
      const globalFailure = compiledPaydirt.find((compiled) => compiled.ok !== true
        && compiled.retryable === false
        && compiled.candidateLocal !== true);
      if (globalFailure) {
        const error = new Error("intake_genie_compile_terminal");
        error.code = "intake_genie_compile_terminal";
        error.retryable = false;
        error.causeCode = String(globalFailure.reason || "intake_genie_compile_failed").slice(0, 160);
        throw attachCompilerProblemDetail(error, globalFailure);
      }
      const outcome = compilePassOutcome(compiledPaydirt);
      if (outcome.kind === "starved") {
        throw throwCompileRetryable(outcome.retryable, "paydirt");
      }
      const retryableDropped = outcome.kind === "partial" ? outcome.retryable : [];
      if (retryableDropped.length) recordCompileCasualties(retryableDropped);
      const compileRejected = {};
      const paydirtLines = [];
      for (let index = 0; index < imported.length; index++) {
        const compiled = compiledPaydirt[index];
        const sourceRow = imported[index];
        if (!compiled.ok) {
          const reason = compiled.reason || "intake_genie_compile_failed";
          compileRejected[reason] = (compileRejected[reason] || 0) + 1;
          if (retryableDropped.includes(compiled)) continue;
          compileQuarantined.push({
            prospectId: String(sourceRow.prospect_id || ""),
            businessName: String(sourceRow.business_name || recordOf(sourceRow).business_name || ""),
            vertical: String(recordOf(sourceRow).industry || ""),
            reason: `intake_genie_candidate_refused: ${reason}`.slice(0, 240),
            ...compilerProblemDetail(compiled),
          });
          continue;
        }
        const compiledRow = compiled.row && String(compiled.row.prospect_id || "") === String(sourceRow.prospect_id || "")
          ? compiled.row
          : sourceRow;
        const ready = contactReadyLine(compiledRow);
        if (!ready.ok) continue;
        const line = ready.line;
        const rec = recordOf(compiledRow);
        if (!(rec.handoff_state === "ready_for_build" && rec.build_ready === true)
          && compiled.certified !== true) line.needs_fill = true;
        if (compiled.certified === true) {
          line.genieContentCertified = true;
          delete line.needs_fill;
        }
        // Carry the store row (receipt included) beside the line projection
        // so the surplus deposit below can bank compiled survivors the count
        // truncation is about to drop. Non-enumerable, same pattern as the
        // tail's __sourceRow.
        Object.defineProperty(line, "__sourceRow", { value: compiledRow, enumerable: false });
        // Same trade decision the packet shelf runs: the label alone is not
        // trusted; the services decide, and a business with no honest trade
        // is refused at pick instead of after a paid build.
        const truth = rec.truth_packet || {};
        const packet = truth.mirror_ready || {};
        const services = (Array.isArray(packet.services) && packet.services.length)
          ? packet.services
          : (Array.isArray(truth.services) ? truth.services : []);
        const label = packet.industry || truth.industry || "";
        const verdict = inferTrade({
          label,
          services,
          businessName: String(sourceRow.business_name || line.businessName || ""),
        });
        if (verdict.blocked) {
          line.contractIssue = verdict.reason;
        } else {
          const trade = approvedIndustry(verdict.trade) || approvedIndustry(label);
          if (!trade) line.contractIssue = "no recognisable trade in the lead's services";
          else {
            const donor = donorFor(trade);
            if (!donor || donor.ok !== true) {
              line.contractIssue = donor && donor.reason === DONOR_EXCLUSION_CAUSE
                ? DONOR_EXCLUSION_CAUSE
                : `no clean donor for ${trade} (${(donor && donor.reason) || "unavailable"})`;
            } else {
              line.vertical = trade;
              // Same law as the packet shelf: a PayDirt row carries no mined
              // build contract, so the generic contract-problem string from
              // the line projection must not survive a successful trade
              // decision — the thin packet rides as needs_fill and AI-fills
              // downstream.
              line.contractIssue = "";
            }
          }
        }
        paydirtLines.push(line);
      }
      const buildable = paydirtLines.filter((line) => !line.contractIssue && line.prospectId && line.businessName);
      const refused = paydirtLines.filter((line) => line.contractIssue);
      const pickedPaydirt = buildable.concat(refused).slice(0, count);
      // SURPLUS DEPOSIT (bank law): compiled survivors the count truncation
      // dropped are banked via the same seam the tail uses —
      // depositProspects itself refuses rows without a durable receipt, so
      // uncompiled surplus stays untouched. Best-effort, never fails the pick.
      const surplusRows = buildable.slice(count)
        .map((line) => line.__sourceRow)
        .filter((row) => row && row.prospect_id);
      if (surplusRows.length && typeof deps.bankDepositSurplus === "function") {
        await deps.bankDepositSurplus(surplusRows, { lane: effectiveLane, signal, deadlineAt })
          .catch(() => null);
      }
      const shortfall = Math.max(0, count - pickedPaydirt.length);
      pickedPaydirt.funnel = [
        {
          stage: "1_paydirt_source",
          entered: paydirtShelfSeated + paydirtReadCount,
          survived: imported.length,
          rejected: kills,
          ...(cappedByQuota ? { quota_capped: true } : {}),
        },
        // A failed adapter read that still had shelf supply keeps its
        // fall-through note here — the batch explains the shortfall's cause.
        ...(paydirtFallbackFunnel ? [paydirtFallbackFunnel] : []),
        ...(Object.keys(compileRejected).length
          ? [{
            stage: "intake_genie_authority_packet",
            entered: compiledPaydirt.length,
            survived: compiledPaydirt.length - Object.values(compileRejected).reduce((sum, n) => sum + n, 0),
            rejected: compileRejected,
          }]
          : []),
        {
          stage: `2_requested_${count}`,
          entered: count,
          survived: pickedPaydirt.length,
          rejected: shortfall > 0
            ? { [`paydirt source exhausted — banked surplus stays drawable; a vertical target (e.g. "roofing in Austin, TX") mines fresh leads instead`]: shortfall }
            : {},
        },
      ];
      if (compileQuarantined.length) pickedPaydirt.quarantined = compileQuarantined;
      return finishPick(pickedPaydirt);
    }
    // A read that failed with NOTHING on the shelf falls through to the
    // existing freshest-store lane (paydirtFallbackFunnel rides the funnel at
    // the bottom) — that is the fallback law. An empty but SUCCESSFUL read is
    // an honest, complete answer for this source attempt: report the
    // arithmetic and let the quota controller rotate; entering the
    // freshest-store lane there would silently relabel stored leads as
    // paydirt supply.
    if (!paydirtFallbackFunnel) {
      const emptyPaydirt = [];
      emptyPaydirt.funnel = [
        { stage: "1_paydirt_source", entered: paydirtReadCount || admittedShelf.length, survived: 0, rejected: kills },
        { stage: `2_requested_${count}`, entered: count, survived: 0, rejected: { "paydirt source produced no admissible leads": count } },
      ];
      if (compileQuarantined.length) emptyPaydirt.quarantined = compileQuarantined;
      return finishPick(emptyPaydirt);
    }
    // paydirtFallbackFunnel is set and the shelf had nothing: fall through.
  }
  if (plan) {
    if (!freshFirstAllTrades) {
      await stage("vertical_shelf_read");
      // An explicitly named trade/market preserves its historical shelf-first
      // behavior. All Trades is different: its quota source is already a fresh
      // provider assignment, so its matching shelf becomes fallback only.
      shelfFirst = await pickVerticalShelf({
        industry: plan.industry, location: plan.location, count, readExact, donorFor, holdUpdate, clock: deps.clock,
        lane: effectiveLane,
        excludeProspectIds: [...excluded],
      });
      // Round-2 prefilter: vertical-shelf casualties ride out as durable
      // rejected rows so refills exclude them instead of re-buying the same
      // garbage title string on the next campaign for this vertical.
      if (Array.isArray(shelfFirst.quarantined)) compileQuarantined.push(...shelfFirst.quarantined);
    }
    const remaining = count - shelfFirst.length;
    if (remaining <= 0) {
      const only = shelfFirst.slice(0, count);
      only.funnel = [
        { stage: "1_packet_shelf_vertical", entered: shelfFirst.length, survived: only.length, rejected: {} },
        { stage: `2_requested_${count}`, entered: count, survived: only.length, rejected: {} },
      ];
      if (compileQuarantined.length) only.quarantined = compileQuarantined;
      return finishPick(only);
    }
    const acceptedRows = Array.isArray(acceptedMiningCheckpoint)
      ? acceptedMiningCheckpoint.filter((row) => row
        && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(String(row.prospect_id || ""))
        && /^[a-f0-9]{64}$/i.test(String(row.build_hash || ""))).slice(0, remaining)
      : [];
    let mined;
    if (acceptedRows.length) {
      // The paid miner already completed under this exact durable operation.
      // Reconcile its persisted prospect rows; never call the provider twice
      // merely because the batch-row checkpoint response was lost.
      await stage("mine_build_ready_reconcile", { reason: "accepted_checkpoint" });
      mined = { ok: true, rows: acceptedRows.map((row) => ({ ...row, persistence: "updated" })), funnel: null };
    } else {
      await stage("mine_build_ready", { reason: "external_stage" });
      mined = await mine({
        industry: plan.industry,
        location: plan.location,
        query: `${plan.industry} in ${plan.location}`,
        limit: remaining,
        // The operator Line already rotates through a frozen nationwide source
        // plan when a market cannot fill its quota. The cohort bound used to
        // be the quota itself (`Math.min(remaining, 10)`), which capped deep
        // verification at the goal size; LINE_DEEP_BATCH_DEPTH (owner
        // doctrine 2026-09-04, "scaling and rapid production flow") raises
        // the wave to max(deficit, dial) so every email survivor is graded in
        // one pass, with the goal seated and the surplus banked. Unset, the
        // bound is the historical goal-sized cohort and replacement supply
        // still comes from the next fresh source.
        candidatesPerQuery: Math.max(1, deepBatchDial ? Math.max(remaining, deepBatchDial) : Math.min(remaining, 10)),
        // Each quota refill must advance to the next frozen deep-query shape.
        // Without this handoff every retry searched the same Firecrawl result
        // page, so ten fast workers repeatedly graded the same ten businesses.
        // The durable batch selects the campaign's stable starting geometry;
        // quota refills then advance from that base exactly as before. A retry
        // of one source attempt therefore repeats, while the next source
        // attempt deliberately moves to the next frozen query shape.
        queryShapeCursor: Math.max(0, Math.trunc(Number(queryShapeCursor) || 0))
          + Math.max(0, Math.trunc(Number(refillRound) || 0)),
        queryGroupOffset: Math.max(0, Math.trunc(Number(queryGroupOffset) || 0)),
        refillRound: Math.max(0, Math.trunc(Number(refillRound) || 0)),
        sourceMode: String(sourceMode || "").trim(),
        actor: "agent_01_prospect_miner",
        trigger: "operator_line",
        // Admission policy differs by delivery boundary: Practice may carry
        // explicitly provisional website facts into owner-only Intake, while
        // Live must retain the production truth gates.
        lane: effectiveLane,
        operationKey,
        signal,
        deadlineAt,
      });
    }
    if (!mined || mined.ok !== true) {
      throw new Error(`mining_failed: ${boundedDetailText((mined && (mined.error || mined.message || mined.mode)) || "unknown")}`);
    }
    if (mined.sourceExhausted?.exhausted === true
      && String(mined.sourceExhausted.reason || "") === "operator_query_cycle_exhausted") {
      // Rebuild the cross-layer marker from allowlisted primitives only. The
      // Line needs a terminal reason, never the paid query or prospect data.
      sourceExhaustedContract = {
        exhausted: true,
        reason: "operator_query_cycle_exhausted",
        refillRound: Math.max(0, Math.trunc(Number(mined.sourceExhausted.refill_round) || 0)),
      };
    }
    for (const candidate of (Array.isArray(mined.rows) ? mined.rows : [])) {
      const id = String(candidate?.prospect_id || "").trim();
      if (id) minedProspectIds.add(id);
    }
    const acceptedCheckpointKeys = new Set(acceptedRows.map((row) => `${String(row.prospect_id)}\0${String(row.build_hash).toLowerCase()}`));
    // Nationwide All Trades is a new-customer campaign, not a rebuild command.
    // LeadMiner truthfully returns `updated` when Firecrawl rediscovers a
    // prospect already in the store; admitting those rows is what made Dallas
    // Fence Company, EZ Air and other old businesses reappear in later runs.
    // A same-operation accepted checkpoint is the one safe exception: it was
    // created by this exact pick before the response/checkpoint boundary and
    // must reconcile without paying the provider twice. Explicit named-market
    // campaigns keep their historical rebuild behavior.
    const eligibleMinedRows = (Array.isArray(mined.rows) ? mined.rows : []).filter((row) => {
      if (!freshFirstAllTrades) return row?.persistence === "created" || row?.persistence === "updated";
      if (row?.persistence === "created") return true;
      return acceptedCheckpointKeys.has(`${String(row?.prospect_id || "")}\0${String(row?.build_hash || "").toLowerCase()}`);
    });
    const durableAcceptedRows = eligibleMinedRows
      .filter((row) => row && row.prospect_id && row.build_hash)
      .map((row) => ({
        prospect_id: String(row.prospect_id),
        build_hash: String(row.build_hash).toLowerCase(),
      }))
      // LINE RESUME CAP (zone-flood campaigns, 2026-09-03): the checkpoint
      // used to keep only the first 10 accepted rows, which covered a
      // goal-sized cohort but not a deep batch (LINE_DEEP_BATCH_DEPTH, PR
      // #691) — a crash past row 10 dropped the rest from the resume
      // payload. The dial (default 50) keeps the whole flood wave durable.
      .slice(0, lineResumeCap(process.env));
    await stage("mine_build_ready_accepted", {
      reason: `${eligibleMinedRows.length}_new_candidates`,
      operationState: "accepted",
      acceptedRows: durableAcceptedRows,
    });
    minedFunnel = Array.isArray(mined.funnel) ? mined.funnel : null;
    const expectedBuilds = new Map(eligibleMinedRows
      .filter((row) => row
        && row.prospect_id
        && row.build_hash)
      .map((row) => [row.prospect_id, row.build_hash]));
    const ids = [...expectedBuilds.keys()];
    if (!ids.length) {
      // A ZERO-YIELD MINE IS THE ONE THAT MOST NEEDS EXPLAINING, and this
      // early return was throwing the explanation away: the funnel is only
      // attached to `out` at the bottom of this function, which this path
      // never reaches. Every empty run therefore reported mineFunnel:null and
      // the console drew a mute empty batch — the exact failure the funnel was
      // added to prevent. Five consecutive production runs (Omaha, Wichita,
      // Little Rock, Memphis, Nashville) returned 0 rows with no stated cause
      // because of these two characters.
      // Nationwide All Trades never replaces a fresh miss with historical
      // shelf inventory. The durable quota controller rotates to the next
      // fresh trade/metro/query shape instead.
      const empty = shelfFirst.slice(0, count);
      if (minedFunnel) empty.funnel = minedFunnel;
      if (compileQuarantined.length) empty.quarantined = compileQuarantined;
      if (sourceExhaustedContract) empty.sourceExhausted = sourceExhaustedContract;
      return finishPick(empty);
    }
    await stage("mined_checkpoint_reload");
    const persistedRows = await reloadPersistedProspects(ids, readExact);
    const byId = new Map(persistedRows.map((row) => [row.prospect_id, row]));
    rows = ids
      .map((id) => byId.get(id))
      .filter((row) => row
        && buildReadyOf(recordOf(row))?.proof?.build_hash === expectedBuilds.get(row.prospect_id));
    if (rows.length !== ids.length) throw new Error("mining_failed: persisted_contract_hash_mismatch");
    // A candidate quarantined by an earlier attempt arrives in
    // excludeProspectIds via its durable rejected batch row. Drop it BEFORE
    // the compiler runs so a deterministic 422 is never re-bought on refill.
    rows = rows.filter((row) => !excluded.has(String(row.prospect_id || "")));

    const freshRows = [];
    for (const sourceRow of rows) {
      // NAME PLAUSIBILITY PREFILTER: a fresh pick whose "businessName" is
      // actually a scraped page headline ("Welcome to Portland, Oregon") or a
      // UI/DOM fragment ("content frame") used to burn an Intake Genie
      // compile slot before certification refused it as
      // business_name_mismatch. Refuse the OBVIOUSLY-not-a-business-name at
      // admission, BEFORE the compile, via the same quarantine metadata path
      // a certification refusal rides: the row lands as a terminal rejected
      // batch row naming pick_name_implausible, the replacement quota refills
      // the gap, and the refill exclusion stops a re-buy. A scraped
      // "Home - Real Business" title prefix is STRIPPED and the cleaned row
      // admitted instead. The check itself is conservative by design (legal
      // suffixes, possessives, and ampersand names always pass; see
      // lib/pick-name-plausibility.js) — downstream certification remains the
      // last line of defense for everything else. A nameless row keeps its
      // round-1 behavior: quarantined here, never compiled.
      const nameAdmission = pickNameAdmission(sourceRow);
      if (!nameAdmission.ok || nameAdmission.emptyName) {
        compileQuarantined.push(pickNameQuarantineEntry(sourceRow, nameAdmission.reason));
        continue;
      }
      const row = nameAdmission.row;
      const admission = liveAdmissionVerdict(row, effectiveLane);
      if (!admission.ok) {
        compileQuarantined.push({
          prospectId: String(row.prospect_id || ""),
          businessName: String(row.business_name || recordOf(row).business_name || ""),
          vertical: String(recordOf(row).industry || ""),
          reason: admission.reason,
        });
        continue;
      }
      const fresh = await admitPracticeCandidate(row);
      if (fresh.ok) freshRows.push(row);
      else compileQuarantined.push({
        prospectId: String(row.prospect_id || ""),
        businessName: String(row.business_name || recordOf(row).business_name || ""),
        vertical: String(recordOf(row).industry || ""),
        reason: fresh.reason,
      });
    }
    rows = freshRows;

    // Fresh Lead Miner Lite rows take the SAME Intake Genie authority path as
    // packet-shelf rows. This was the missing handoff: fresh rows were reloaded
    // and sent directly to the builder while only shelf rows were compiled.
    // Compile the bounded selected set in parallel; signed receipts make every
    // retry a zero-provider-call reuse.
    await stage("mined_authority_compile");
    await stage("mined_authority_compile");
    // Bounded pool (see exact_authority_compile) — the funnel jam of
    // 2026-08-26/27 came from every mined row compiling at once against a
    // single serverless Genie function. Signed receipts still make every
    // retry a zero-provider-call reuse.
    const compiledFresh = await mapWithConcurrency(rows, poolSize(process.env), (row) => compileGenieContent(row, {
      ...deps,
      signal,
      conditionalUpdate: holdUpdate,
    }));
    await stage("mined_authority_complete");
    // Failure triage, in fail-closed priority order. A GLOBAL terminal failure
    // (missing signing key, unconfigured compiler, broken certification) halts
    // the pick: nothing else could compile either, and silent candidate drops
    // would drain supply while the real defect is operational. A TRANSIENT
    // failure that starved the WHOLE pass retries the pick — rows stay durable
    // and every successful sibling receipt makes the retry a zero-provider-call
    // reuse. But since the 2026-09-02 compile-timeout stall, a transient
    // failure with CERTIFIED SIBLINGS no longer discards them: the timed-out
    // candidates are dropped for this pass (transient, never a durable
    // quarantine), the surviving rows ride out, and the quota refills the gap
    // on the next pass. Only a deterministic candidate-local compiler verdict
    // (422, supported needs_input, or only row-bound certification gaps)
    // quarantines the single candidate it names.
    const compileOutcome = compilePassOutcome(compiledFresh);
    if (compileOutcome.kind === "global") {
      const compileFailure = compiledFresh.find((compiled) => compiled.ok !== true
        && compiled.retryable === false
        && compiled.candidateLocal !== true);
      const error = new Error("intake_genie_compile_terminal");
      error.code = "intake_genie_compile_terminal";
      error.retryable = false;
      error.causeCode = String(compileFailure.reason || "intake_genie_compile_failed").slice(0, 160);
      throw attachCompilerProblemDetail(error, compileFailure);
    }
    if (compileOutcome.kind === "starved") {
      throw throwCompileRetryable(compileOutcome.retryable, target);
    }
    const compileRejected = {};
    const admitted = [];
    const retryableDropped = compileOutcome.kind === "partial" ? compileOutcome.retryable : [];
    if (retryableDropped.length) recordCompileCasualties(retryableDropped);
    compiledFresh.forEach((compiled, index) => {
      if (compiled.ok) {
        admitted.push({ ...compiled.row, __genieContentCertified: compiled.certified === true });
        return;
      }
      const sourceRow = rows[index] || {};
      const reason = compiled.reason || "intake_genie_compile_failed";
      compileRejected[reason] = (compileRejected[reason] || 0) + 1;
      if (retryableDropped.includes(compiled)) return; // transient: refill re-buys, no durable quarantine
      compileQuarantined.push({
        prospectId: String(sourceRow.prospect_id || ""),
        businessName: String(sourceRow.business_name || recordOf(sourceRow).business_name || ""),
        vertical: String(recordOf(sourceRow).industry || ""),
        reason: `intake_genie_candidate_refused: ${reason}`.slice(0, 240),
        ...compilerProblemDetail(compiled),
      });
    });
    rows = admitted;
    if (Object.keys(compileRejected).length) {
      minedFunnel = [
        ...(minedFunnel || []),
        { stage: "intake_genie_authority_packet", entered: compiledFresh.length, survived: rows.length, rejected: compileRejected },
      ];
    }
  } else {
    const result = await readMany(PROSPECTS, { order: "updated_at.desc", limit: Math.max(count * 3, 60) });
    rows = ((result && (result.rows || result.data)) || [])
      .filter(lineEligible)
      .filter((row) => liveAdmissionVerdict(row, effectiveLane).ok);
    const freshRows = [];
    for (const sourceRow of rows) {
      // NAME PLAUSIBILITY PREFILTER (round 2): the freshest-store fallback is
      // the third recycled-pool entrance — a garbage-named row the miner
      // persisted earlier re-enters here on every no-target pick. Same
      // conservative verdict as the fresh-mine lane, same quarantine metadata
      // (durable rejected row + refill exclusion), same title-prefix rescue.
      // A pick refused ONLY for a missing location stays selectable, like an
      // empty name: this lane spends no compile slot, and the build-ready
      // contract gate below already names the missing pieces precisely
      // ("build_ready_contract_incomplete:..."), which a location kill here
      // would only erase.
      const nameAdmission = pickNameAdmission(sourceRow);
      if (!nameAdmission.ok && !nameAdmission.missingLocation) {
        compileQuarantined.push(pickNameQuarantineEntry(sourceRow, nameAdmission.reason));
        continue;
      }
      const fresh = await admitPracticeCandidate(nameAdmission.row);
      if (fresh.ok) freshRows.push(nameAdmission.row);
    }
    rows = freshRows;
  }
  // Contact is classified before production, but it is no longer a BUILD gate.
  // A real business without a verified email may still receive a finished site;
  // contactReady/hasEmail decide only whether delivery can be queued later.
  const contactReady = [];
  for (const row of rows || []) {
    if (!row || excluded.has(String(row.prospect_id || ""))) continue;
    const ready = contactReadyLine(row);
    if (!ready.ok) continue;
    const line = ready.line;
    if (row.__genieContentCertified === true) {
      // Same law as the shelf and exact lanes: a signed content receipt
      // fast-passes CONTENT completeness only, so the admitted line keeps its
      // certification and drops the AI-fill flag. Identity, vertical, render,
      // and delivery gates all remain downstream.
      line.genieContentCertified = true;
      line.needs_fill = false;
    }
    // PROSPECT BANK: carry the store row (receipt included) beside the line
    // projection so the surplus deposit below can bank compiled survivors the
    // count truncation is about to drop. Non-enumerable, same pattern as
    // pickVerticalShelf's __sourceRow.
    Object.defineProperty(line, "__sourceRow", { value: row, enumerable: false });
    contactReady.push(line);
  }
  // A partial nationwide source also stays fresh-only. The quota controller
  // fills the gap from the next market; it never pads a new campaign with old
  // shelf rows.
  // Combine every already-gated source before applying the build priority.
  const candidates = (freshFirstAllTrades ? contactReady.concat(shelfFirst) : shelfFirst.concat(contactReady))
    .filter((r) => r.prospectId && r.businessName)
    .filter((r, index, all) => all.findIndex((candidate) => candidate.prospectId === r.prospectId) === index);
  // The sorter runs only after every existing source/eligibility/contact gate,
  // and before count truncation. Grades choose build order; they never gate.
  const orderedForTruncation = freshFirstAllTrades
    ? gapFirstLineCandidates(contactReady).concat(shelfFirst)
    : gapFirstLineCandidates(candidates);
  const out = orderedForTruncation.slice(0, count);
  // PROSPECT BANK — SURPLUS DEPOSIT (owner doctrine 2026-09-02): nothing
  // mined is ever thrown away. Compiled survivors the count truncation just
  // dropped are banked instead — depositProspects itself refuses rows without
  // a durable receipt, so uncompiled shelf/legacy surplus stays untouched.
  // Best-effort: a bank write failure can never fail the pick.
  const surplusSourceRows = orderedForTruncation.slice(count)
    .map((line) => line && line.__sourceRow)
    .filter((row) => row && row.prospect_id);
  if (surplusSourceRows.length && typeof deps.bankDepositSurplus === "function") {
    await deps.bankDepositSurplus(surplusSourceRows, { lane: effectiveLane, signal, deadlineAt })
      .catch(() => null);
  }
  // Where did everyone die? The miner reports per-stage kills in funnel[];
  // ride it out on the array (non-breaking) so the console can show the
  // operator WHY a run produced zero instead of a mute empty batch.
  if (minedFunnel) out.funnel = minedFunnel;
  // PAYDIRT FALL-THROUGH NOTE: a paydirt-target pick whose source read failed
  // fell into this freshest-store lane — the reason rides first on the funnel
  // so the batch explains where its supply actually came from.
  if (paydirtFallbackFunnel) {
    out.funnel = [paydirtFallbackFunnel, ...(Array.isArray(out.funnel) ? out.funnel : [])];
  }
  if (compileQuarantined.length) out.quarantined = compileQuarantined;
  if (sourceExhaustedContract) out.sourceExhausted = sourceExhaustedContract;
  if (compileCasualties.timeouts > 0 || compileCasualties.retryable > 0) {
    out.compileCasualties = compileCasualties;
  }
  return finishPick(out);
}

/**
 * describeRefusal — one operator-readable sentence for a dead lead.
 *
 * Built from the refusal payload dispatchMirrorLane hands back: the named
 * gates that did not pass, and — the part that was missing entirely — what
 * those gates SAW. When NOTHING was recorded (a dispatcher that refused before
 * it ever reached a gate) it returns the bare historical string, unchanged:
 * inventing detail for a refusal we did not observe would be the same sin in
 * the opposite direction.
 */
function describeRefusal(refusal) {
  if (!refusal) return "mirror_build_not_revealable";
  const causes = refusal.cause && typeof refusal.cause === "object"
    ? Object.entries(refusal.cause).map(([gate, why]) => `${gate}: ${boundedDetailText(why)}`).join(" ;; ")
    : "";
  if (refusal.reason === "not_revealable") {
    const gates = Array.isArray(refusal.detail) ? refusal.detail.map((entry) => boundedDetailText(entry)).join(",") : "";
    const head = `mirror_build_not_revealable${gates ? ` [${gates}]` : ""}`;
    const tail = causes || (typeof refusal.detail === "string" ? refusal.detail : "");
    return (tail ? `${head} — ${tail}` : head).slice(0, 900);
  }
  // Every other refusal: the reason, the HTTP status when one came back, and
  // the field-level detail. The detail can be the ajv shape the engine's 400
  // carries ({path, keyword, message}) or the packet's missing-fact strings;
  // both become words. Rocky's Plumbing died as "mirror produced no
  // host-approved preview URL" while the payload underneath this sentence
  // said `invalid_request (status 400) — /brand/logo: must match pattern
  // "^https://"` the whole time.
  const status = refusal.status != null && Number.isFinite(Number(refusal.status))
    ? ` (status ${refusal.status})`
    : "";
  const head = `${boundedDetailText(refusal.reason || "mirror_build_not_revealable")}${status}`;
  const detailText = typeof refusal.detail === "string"
    ? refusal.detail
    : Array.isArray(refusal.detail)
      ? refusal.detail.map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const where = boundedDetailText(entry.path || entry.gate || entry.field || "");
          const rawWhat = entry.message !== undefined ? entry.message : (entry.reason !== undefined ? entry.reason : entry);
          const what = boundedDetailText(rawWhat);
          return where ? `${where}: ${what}` : what;
        }
        return boundedDetailText(entry);
      }).join(" ;; ")
      : "";
  const tail = causes || detailText;
  return (tail ? `${head} — ${tail}` : head).slice(0, 900);
}

/**
 * describeDeadDispatch — the sentence for a dispatch that returned a TRUTHY
 * shape with no usable preview URL.
 *
 * This exact case wore the meaningless "mirror produced no host-approved
 * preview URL" for a whole night while the refusal payload — reason,
 * status 400, the failing schema path — had been captured and then thrown
 * away, because the null-check above it was the only reader. The refusal
 * side channel wins when it fired; otherwise the blocked names and detail
 * are read off the shape itself; and when the shape says nothing at all,
 * the sentence at least names the keys that came back.
 */
function describeDeadDispatch(out, refusal) {
  if (refusal) return describeRefusal(refusal);
  const blocked = [...new Set([
    ...(Array.isArray(out.blocked) ? out.blocked : []),
    ...(Array.isArray(out.buildStatus?.blocked) ? out.buildStatus.blocked : []),
  ].filter(Boolean))];
  const detail = Array.isArray(out.buildStatus?.detail) && out.buildStatus.detail.length
    ? out.buildStatus.detail
    : null;
  if (blocked.length || detail) {
    return describeRefusal({ reason: blocked.join(",") || "mirror_dispatch_blocked", detail });
  }
  return `mirror dispatch returned {${Object.keys(out).join(",")}} with no host-approved preview URL`;
}

function dispatchFailureSummary(refusal, out, candidate = "") {
  const safeCandidate = sanitizePreviewUrl(candidate);
  const releaseEvidence = objectOf(
    out?.release_evidence
    || out?.releaseEvidence
    || out?.buildStatus?.release_evidence,
  );
  const evidenceSha = String(
    out?.evidence_sha
    || out?.buildStatus?.evidence_sha
    || releaseEvidence?.evidence_sha
    || "",
  ).trim();
  const buildHash = String(
    out?.build_hash
    || out?.buildStatus?.build_hash
    || releaseEvidence?.build_hash
    || "",
  ).trim();
  const persistedPreview = sanitizePreviewUrl(
    out?.urls?.preview_url
    || out?.preview_url
    || refusal?.preview_url
    || "",
  );
  const hasDurableBuildIdentity = Boolean(
    safeCandidate
    || (persistedPreview && /^[a-f0-9]{64}$/i.test(buildHash) && releaseEvidence && evidenceSha),
  );
  const refusalReasonForDecision = String(refusal?.reason || "").trim();
  const refusalReason = boundedDetailText(refusal?.reason || "").trim();
  const detail = refusal?.detail ?? out?.buildStatus?.detail ?? out?.detail ?? null;
  const detailText = (() => {
    if (typeof detail === "string") return detail.slice(0, 400);
    if (Array.isArray(detail)) return detail.map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const where = boundedDetailText(entry.path || entry.gate || entry.field || "").trim();
        const rawWhat = entry.message !== undefined ? entry.message : (entry.reason !== undefined ? entry.reason : entry);
        const what = boundedDetailText(rawWhat).trim();
        return where ? `${where}: ${what}` : what;
      }
      return boundedDetailText(entry);
    }).join(" ;; ").slice(0, 400);
    return "";
  })();
  const reason = hasDurableBuildIdentity && refusalReasonForDecision === "not_revealable"
    ? describeRefusal(refusal || null)
    : refusalReasonForDecision
      ? describeRefusal(refusal || null).replace(/^mirror_build_not_revealable\b/, "mirror_dispatch_failed_before_build")
      : "mirror_dispatch_failed_before_build";
  return {
    reason,
    beforeBuild: !hasDurableBuildIdentity,
    code: refusalReason || boundedDetailText(out?.blocked?.[0] || out?.reason || "dispatch_absent"),
    detail: detailText,
    status: Number.isFinite(Number(refusal?.status)) ? Number(refusal.status) : null,
    hasDurableBuildIdentity,
    renderEvidence: objectOf(refusal?.cause) || objectOf(out?.checks?.render) || null,
  };
}

/**
 * mirrorProspect — build the mirror. Returns a CANDIDATE url only; nothing is
 * written until the render gate passes.
 */
async function mirrorProspect(row, options = {}) {
  const lane = options.lane === "sandbox" ? "sandbox" : "live";
  const read = options.select || select;
  // THE SWALLOWED REASON COSTS A NIGHT — measured again 2026-08-20: two
  // consecutive fleet rebuilds settled "prospect_store_read_failed" while the
  // same row read fine directly (200, 111KB, 0.24s), and the bare catch(null)
  // left nothing to diagnose. The cause now rides the reason.
  //
  // THE MISS ITSELF IS TRANSIENT — measured again 2026-08-31: seven qualified
  // rows died `prospect_store_read_failed: rows_0` in the same fleet window,
  // each seconds after this same pipeline had awaited the prospect write that
  // qualification persists (mirror dispatch starts 3-4s after qualification
  // completes), and the 08-20 incident already proved the identical row
  // answers 200 on a direct re-read moments later. One empty read is not
  // proof of absence: PostgREST visibility can trail the commit by a beat.
  // Retry the miss, briefly and bounded (3 attempts, ~1.5s apart, deadline and
  // abort aware), before declaring the prospect unpersisted — and keep the
  // terminal rejection byte-identical when every attempt misses.
  const readProspect = async () => {
    let readError = "";
    const loaded = await read(
      PROSPECTS,
      `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
      { signal: options.signal, deadlineAt: options.deadlineAt },
    ).catch((e) => { readError = String((e && (e.code || e.name || e.message)) || "threw").slice(0, 80); return null; });
    return { loaded, readError };
  };
  const readDeadlinePassed = () => {
    const numeric = Number(options.deadlineAt);
    const deadline = Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(String(options.deadlineAt || ""));
    return Number.isFinite(deadline) && Date.now() >= deadline;
  };
  const readInterrupted = () => options.signal?.aborted === true || readDeadlinePassed();
  const PROSPECT_STORE_READ_ATTEMPTS = 3;
  const PROSPECT_STORE_READ_RETRY_MS = 1500;
  let readError = "";
  let loaded = null;
  for (let attempt = 1; attempt <= PROSPECT_STORE_READ_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      if (readInterrupted()) break;
      await new Promise((resolve) => setTimeout(resolve, PROSPECT_STORE_READ_RETRY_MS));
      if (readInterrupted()) break;
    }
    ({ loaded, readError } = await readProspect());
    if (loaded && loaded.ok === true && Array.isArray(loaded.data) && loaded.data.length === 1) break;
    // A dry-run/not-configured store answer is not a visibility race; retrying
    // it would only burn the deadline. Fail exactly as before.
    if (loaded && loaded.ok !== true && loaded.skipped) break;
  }
  const persisted = loaded && loaded.ok === true && Array.isArray(loaded.data) && loaded.data.length === 1
    ? loaded.data[0]
    : null;
  if (!persisted) {
    const cause = readError
      || (loaded && loaded.ok !== true && String(loaded.error || loaded.skipped || loaded.mode || "not_ok").slice(0, 80))
      || (loaded && Array.isArray(loaded.data) ? `rows_${loaded.data.length}` : "no_response");
    return { ok: false, reason: `prospect_store_read_failed: ${cause}`, terminal: "rejected" };
  }
  const persistedRecord = recordOf(persisted);
  const isLeadMinerSource = persistedRecord.truth_packet_source === "leadminer_mirror_ready"
    && !!persistedRecord.truth_packet;
  // The signed v7 visitor-copy receipt is independent of the legacy LeadMiner
  // source marker. It can enrich either identity lane, while the identity lane
  // itself remains subject to its existing packet/build-ready hard stops.
  const certifiedContent = verifiedGenieContentReceipt(persisted, persistedRecord, options);
  // NEEDS_FILL: a LeadMiner packet that failed the strict build_ready contract
  // but carries real identity is built anyway, with its thin content AI-filled.
  // It rides the packet lane (never the mined-contract gate) and is flagged so
  // buildMirrorForProspect fills the gaps.
  const packetNeedsFill = isLeadMinerSource
    && persistedRecord.build_ready !== true
    && certifiedContent.ok !== true
    && (row.needs_fill === true || packetHasBasics(persisted, persistedRecord));
  const leadMinerPacket = isLeadMinerSource
    && (persistedRecord.build_ready === true || packetNeedsFill || certifiedContent.ok === true);
  if (!leadMinerPacket) {
    const problem = contractProblem(buildReadyOf(persistedRecord));
    if (problem) return { ok: false, reason: problem, terminal: "rejected" };
  }

  const fullRun = options.fullRun || require("./full-run");
  // A mirror is an owner-funded spec build on our infrastructure. Prospect
  // consent belongs at the outreach boundary, never at build/render/write.
  const enabled = options.mirrorLaneEnabled || fullRun.mirrorLaneEnabled;
  if (!enabled(options.env || process.env)) {
    return { ok: false, reason: "mirror_lane_disabled", terminal: "rejected" };
  }
  const dispatch = options.dispatchMirrorLane || fullRun.dispatchMirrorLane;
  const dispatchProspect = prospectFromContract(persisted);
  // The exact-pick admission may select a verified secondary trade when the
  // packet's lead trade has no clean donor. The builder re-checks this value
  // against the same inference before honoring it; arbitrary callers cannot
  // force a trade swap through this field.
  if (String(row.vertical || "").trim()) dispatchProspect.industry = String(row.vertical).trim();
  // The hero-triggered rebuild exists only after the exact approved reel was
  // persisted on this durable record. Carry that record into the build so
  // heroReelBlock can house the verified clip; the narrow scalar contract by
  // itself cannot contain media_bank.hero_reel. Normal first builds keep the
  // existing whitelist above unchanged.
  if (options.heroRebuild === true) dispatchProspect.record = persistedRecord;
  else if (certifiedContent.ok === true) {
    // Carry only the receipt inputs needed for the final Mirror-side
    // re-verification. Do not turn the complete mutable record into a new build
    // input surface merely to transport certified prose.
    dispatchProspect.record = {
      genie_canonical_packet: persistedRecord.genie_canonical_packet,
      genie_compile_sources: persistedRecord.genie_compile_sources,
      genie_compile_idempotency_key: persistedRecord.genie_compile_idempotency_key,
      genie_content_certification_contract: persistedRecord.genie_content_certification_contract,
      genie_content_certification: persistedRecord.genie_content_certification,
      ...(persistedRecord.owner_corrections ? { owner_corrections: persistedRecord.owner_corrections } : {}),
      ...(persistedRecord.truth_packet_source ? { truth_packet_source: persistedRecord.truth_packet_source } : {}),
      ...(persistedRecord.truth_packet ? { truth_packet: persistedRecord.truth_packet } : {}),
      ...(persistedRecord.current_website ? { current_website: persistedRecord.current_website } : {}),
    };
  }
  if (leadMinerPacket) {
    // The packet IS the build truth; buildMirrorForProspect reads it at
    // prospect.truth_packet and reports zero provider calls.
    dispatchProspect.truth_packet = persistedRecord.truth_packet;
    dispatchProspect.truth_packet_source = persistedRecord.truth_packet_source;
    // NEEDS_FILL rides to the builder so it fills the thin content instead of
    // refusing the incomplete export.
    if (packetNeedsFill) dispatchProspect.needs_fill = true;
  }
  // EXISTING OWN PHOTOS START THE HERO BEFORE THE FIRST MIRROR. This is the
  // automatic Line's spend/proof weld: while the verified Station job is still
  // generating (or waiting for its verified auto-approval), no donor-stock
  // build reaches the render gate. The hero-triggered rebuild bypasses only
  // this wait; it still consumes the same provenance-checked record.
  if (options.heroRebuild !== true) {
    const existingBank = storedLineHeroBank(persisted, {
      ...row,
      currentWebsite: persisted.current_website || persistedRecord.current_website,
    });
    const waitingHero = objectOf(row.heroRemaster) || objectOf(row.hero_remaster);
    const earlyHeroSource = firstScannableSource(persistedRecord, persisted, row);
    if (existingBank || earlyHeroSource || waitingHero?.required === true) {
      const persistedHeroReel = objectOf(objectOf(persistedRecord.media_bank)?.hero_reel);
      const currentBuildHash = String(row.buildHash || row.build_hash || waitingHero?.buildHash || waitingHero?.build_hash || "").trim();
      const currentReelUrl = String(waitingHero?.reelUrl || waitingHero?.reel_url || "").trim();
      const currentHeroJobId = String(waitingHero?.jobId || waitingHero?.job_id || "").trim();
      const carriedHeroCodes = [waitingHero?.status, waitingHero?.reason, waitingHero?.skipped, waitingHero?.error]
        .map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
      const carriedStaleLineHero = carriedHeroCodes.some((value) => value === "stale_line_handle"
        || value === "hero_remaster_line_handle_mismatch"
        || value === "hero_line_handle_mismatch"
        || value.includes("line_handle_mismatch"));
      const persistedDispatch = validatedPersistedDispatch(persisted);
      // A known durable job can be inspected as soon as its row is bound to
      // the exact signed current build. The persisted reel is deliberately not
      // required: stale terminal jobs often predate the reel, and those are the
      // jobs that must refresh/reoffer. A completed reconnect remains stricter.
      const shouldInspectExisting = Boolean(currentHeroJobId)
        && Boolean(currentBuildHash)
        && currentBuildHash === String(persistedDispatch?.buildHash || "")
        && (!currentReelUrl || !String(persistedHeroReel?.url || "").trim()
          || currentReelUrl === String(persistedHeroReel.url));
      const shouldJoinCompleted = shouldInspectExisting && Boolean(String(persistedHeroReel?.url || "").trim());
      let heroRemaster = await enqueueCompletedLineHero({
        ...row,
        previewUrl: persisted.preview_url || persistedRecord.preview_url || "",
        currentWebsite: persisted.current_website || persistedRecord.current_website || "",
      }, persisted, {
        ...persistedRecord,
        ...(existingBank ? { photo_bank: existingBank } : {}),
      }, { ...options, deferJoin: !shouldInspectExisting, inspectOnly: shouldInspectExisting });
      const heroInspectCode = [
        heroRemaster.status,
        heroRemaster.reason,
        heroRemaster.skipped,
        heroRemaster.error,
        heroRemaster.result?.reason,
      ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
      const inspectedStaleLineHero = heroInspectCode.some((value) => value === "stale_line_handle"
        || value === "hero_remaster_line_handle_mismatch"
        || value === "hero_line_handle_mismatch"
        || value.includes("line_handle_mismatch"));
      const staleSnapshot = objectOf(heroRemaster.stale_job_snapshot) || {};
      const staleSnapshotHandle = normalizeLineHandle(staleSnapshot.line_handle || staleSnapshot.lineHandle);
      const currentLineHandle = normalizeLineHandle({
        batchId: options.batchId || row.batchId || row.batch_id,
        rowId: row.rowId || row.row_id,
      });
      const staleSnapshotEligible = inspectedStaleLineHero
        && String(staleSnapshot.job_id || staleSnapshot.jobId || "") === currentHeroJobId
        && ["failed", "refused"].includes(String(staleSnapshot.status || ""))
        && Number.isInteger(Number(staleSnapshot.revision)) && Number(staleSnapshot.revision) > 0
        && currentLineHandle && staleSnapshotHandle
        && (currentLineHandle.batchId !== staleSnapshotHandle.batchId || currentLineHandle.rowId !== staleSnapshotHandle.rowId)
        && !String(staleSnapshot.lease_token || staleSnapshot.leaseToken || "")
        && !String(staleSnapshot.lease_owner || staleSnapshot.leaseOwner || "")
        && !String(staleSnapshot.lease_expires_at || staleSnapshot.leaseExpiresAt || "");
      const staleLineHero = staleSnapshotEligible;
      const refreshAdmissionSource = carriedStaleLineHero ? "carried_marker" : "inspect";
      // A verified current build may still point at a terminal hero job from an
      // older Line handle. Do not keep polling that stale refusal: refresh the
      // exact owned-site bytes first, persist the revised bank under CAS, then
      // let the queue reoffer the same durable job for this build identity.
      // This belongs before the pending return below; otherwise the post-build
      // preparation path is unreachable and the row loops at qualified.
      if (shouldInspectExisting
        && heroRemaster.ready !== true
        && staleLineHero
        && /^[a-f0-9]{64}$/i.test(currentBuildHash)) {
        // Mirror persists its signed checkpoint after this function's first
        // prospect read. Refresh must therefore bind to a new read/version;
        // using `persisted.updated_at` here loses every CAS after that write.
        const refreshLoaded = await read(
          PROSPECTS,
          `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
          { signal: options.signal, deadlineAt: options.deadlineAt },
        ).catch(() => null);
        const refreshCurrent = refreshLoaded?.ok === true && Array.isArray(refreshLoaded.data) && refreshLoaded.data.length === 1
          ? refreshLoaded.data[0]
          : null;
        const refreshRecord = recordOf(refreshCurrent);
        const refreshDispatch = refreshCurrent ? validatedPersistedDispatch(refreshCurrent) : null;
        const refreshReel = objectOf(objectOf(refreshRecord.media_bank)?.hero_reel);
        if (!refreshCurrent || refreshDispatch?.buildHash !== currentBuildHash
          || (currentReelUrl && String(refreshReel?.url || "").trim()
            && currentReelUrl !== String(refreshReel.url))) {
          const reason = !refreshCurrent ? "hero_photo_refresh_record_read_failed" : "hero_photo_refresh_checkpoint_changed";
          heroRemaster = { ...heroRemaster, pending: true, ready: false, status: reason, reason };
        } else {
        const durableBank = objectOf(refreshRecord.photo_bank);
        const durableWebsite = String(refreshCurrent.current_website || refreshRecord.current_website || row.currentWebsite || "").trim();
        const refreshed = await refreshDurableOwnPhotoBank(durableBank, durableWebsite, options);
        const update = options.conditionalUpdate || conditionalUpdate;
        const at = new Date().toISOString();
        const marker = {
          reason: refreshed.ok ? "refreshed" : String(refreshed.reason || "hero_photo_refresh_failed"),
          admission_source: refreshAdmissionSource,
          at,
          source_count: refreshed.ok ? refreshed.bank.photos.length : (Array.isArray(durableBank?.photos) ? durableBank.photos.length : 0),
        };
        const nextRecord = {
          ...refreshRecord,
          ...(refreshed.ok ? { photo_bank: refreshed.bank } : {}),
          hero_photo_refresh: marker,
        };
        const stored = await update(
          PROSPECTS,
          "prospect_id",
          row.prospectId,
          { updated_at: `eq.${String(refreshCurrent.updated_at || "").trim()}` },
          { record: nextRecord, updated_at: at },
          { signal: options.signal, deadlineAt: options.deadlineAt },
        ).catch(() => null);
        if (!refreshed.ok || !stored?.ok || stored.updated !== true) {
          const reason = !refreshed.ok ? marker.reason : "hero_photo_refresh_cas_pending";
          heroRemaster = { ...heroRemaster, pending: true, ready: false, status: reason, reason };
        } else {
          const committed = Array.isArray(stored.rows) ? stored.rows[0] : null;
          const refreshedStored = committed || { ...refreshCurrent, record: nextRecord, updated_at: at };
          heroRemaster = await enqueueCompletedLineHero({
            ...row,
            previewUrl: refreshedStored.preview_url || nextRecord.preview_url || "",
            currentWebsite: refreshedStored.current_website || nextRecord.current_website || "",
          }, refreshedStored, nextRecord, {
            ...options, deferJoin: false, inspectOnly: false,
            expectedStaleJobSnapshot: staleSnapshot,
          });
        }
        }
      }
      if (heroRemaster.hold === true) {
        return {
          ok: false,
          terminal: "rejected",
          heroRemasterHold: true,
          heroRemaster,
          reason: String(heroRemaster.reason || "verified_client_hero_failed"),
        };
      }
      if (shouldJoinCompleted && heroRemaster.applied === true && heroRemaster.completion_mode === "shared_release") {
        // Shared hero injection already published and CAS-activated the exact
        // immutable release named by the verified terminal receipt. Re-running
        // Mirror under the Line operation key would create a second release and
        // sever that receipt identity. Reconnect the signed current artifact;
        // prepareMirroredHero re-verifies and persists the applied marker before
        // the normal render/proof/email phases can advance.
        const validated = validatedPersistedDispatch(persisted);
        if (!validated || validated.buildHash !== String(heroRemaster.build_hash || "")) {
          return {
            ok: false,
            terminal: "rejected",
            heroRemasterHold: true,
            heroRemaster: { ...heroRemaster, ready: false, applied: false, hold: true },
            reason: "hero_shared_release_identity_unproven",
          };
        }
        const recovered = recoveredBuild(validated, persisted);
        recovered.recovery = "persisted_signed_shared_hero";
        recovered.heroJobId = String(heroRemaster.job_id || heroRemaster.jobId || "");
        recovered.proofIdentity = {
          site_id: String(heroRemaster.shared_site_id || ""),
          release_id: String(heroRemaster.shared_release_id || ""),
          build_hash: String(heroRemaster.build_hash || ""),
        };
        if (existingBank) {
          recovered.ownedPhotoBank = existingBank;
          recovered.owned_photo_bank = existingBank;
        }
        return recovered;
      }
      if (shouldInspectExisting && heroRemaster.pending === true && heroRemaster.ready !== true) {
        return {
          ok: true,
          heroRemasterPending: true,
          heroRemaster,
        };
      }
      // A queued hero is not a reason to idle the site builder. The exact job
      // handle is durable now, so build the base mirror while video generation
      // runs; prepareMirroredHero joins the result before render/email.
    }
  }
  // NAME THE CASUALTY.
  //
  // "mirror_build_not_revealable" is the string every dead lead in the 3/10 and
  // 2/10 runs wore, on the console and in the batch snapshot, ten rows deep,
  // and it says nothing at all — the same complaint that cost a day when the
  // real answer turned out to be one http:// image URL. dispatchMirrorLane
  // still returns null (the SiteForge fallback depends on that), but it now
  // hands the refusal payload out through this callback on its way past, so the
  // row can carry the sentence the gate actually wrote.
  // A FAILED PACKET BUILD IS STAMPED ON THE RECORD, or the line loops forever:
  // the errored row keeps status=held with no preview_url, so the next
  // "LeadMiner packets" run re-picks the exact same packet and re-fails it —
  // measured ten times in a row on Rocky's Plumbing, 2026-08-09. The stamp is
  // what pickProspects' retry window reads. Best-effort by design: a stamp
  // that cannot be written must never turn a build failure into a crash.
  const stampFailure = async (reason) => {
    if (!leadMinerPacket) return;
    try {
      const update = options.conditionalUpdate || conditionalUpdate;
      const at = new Date().toISOString();
      await update(
        PROSPECTS,
        "prospect_id",
        row.prospectId,
        { updated_at: `eq.${String(persisted.updated_at || "").trim()}` },
        {
          record: { ...persistedRecord, last_build_error: { reason: String(reason || "").slice(0, 300), at } },
          updated_at: at,
        },
      );
    } catch { /* the stamp is bookkeeping; the failure itself already has its sentence */ }
  };

  let refusal = null;
  let out;
  const mirrorAttemptId = String(options.mirrorAttemptId || row.mirrorDispatch?.attemptId || "").trim();
  try {
    out = await dispatch(dispatchProspect, {
      lane,
      operationKey: options.operationKey,
      signal: options.signal,
      deadlineAt: options.deadlineAt,
      onRefusal: (payload) => { refusal = payload; },
    });
  } catch (e) {
    const reason = `mirror_dispatch_failed_before_build: dispatch_threw: ${boundedDetailText((e && e.message) || e, 200)}`;
    await stampFailure(reason);
    e.dispatchFailure = {
      code: "dispatch_threw",
      detail: boundedDetailText((e && e.message) || e, 300),
      status: null,
      beforeBuild: true,
      hasDurableBuildIdentity: false,
      attempt_id: mirrorAttemptId || "",
    };
    throw e;
  }
  if (!out) {
    const failure = dispatchFailureSummary(refusal, out);
    await stampFailure(failure.reason);
    return {
      ok: false,
      reason: failure.reason,
      dispatchFailure: {
        ...failure,
        attempt_id: mirrorAttemptId || "",
      },
    };
  }
  if (out.disposition === "system_hold"
    && out.retryable === true
    && out.lead_rejection === false) {
    const reason = boundedDetailText(out.reason || out.system_hold?.code || "mirror_system_hold").trim();
    const systemHold = objectOf(out.system_hold) || {};
    const reconciliation = objectOf(out.reconciliation)
      || objectOf(systemHold.reconciliation)
      || null;
    const releaseEvidence = objectOf(out.release_evidence)
      || objectOf(out.deployed_release_evidence)
      || objectOf(out.buildStatus?.release_evidence)
      || null;
    const reconciliationRelease = objectOf(reconciliation?.release) || {};
    const previewUrl = sanitizePreviewUrl(
      reconciliationRelease.preview_url
      || out.preview_url
      || out.urls?.preview_url
      || "",
    );
    const buildHash = String(
      reconciliationRelease.build_hash
      || out.build_hash
      || releaseEvidence?.build_hash
      || "",
    ).trim();
    const manualReconciliationRequired = out.manual_reconciliation_required === true
      || systemHold.manual_reconciliation_required === true
      || systemHold.scope === "mirror_reconciliation";
    const providerAttempted = out.provider_attempted === true || manualReconciliationRequired;
    const postDeployReconciliation = providerAttempted;
    const hasDurableBuildIdentity = postDeployReconciliation
      && Boolean(previewUrl && /^[a-f0-9]{64}$/i.test(buildHash) && releaseEvidence && reconciliation);
    return {
      ok: false,
      // A pre-build read outage may be retried by the build queue. A published
      // release awaiting fleet reconciliation may not: it is parked for the
      // operator so the provider/deploy boundary cannot run twice.
      retryable: !postDeployReconciliation,
      code: reason,
      reason,
      disposition: "system_hold",
      lead_rejection: false,
      system_hold: out.system_hold || null,
      provider_attempted: providerAttempted,
      manual_reconciliation_required: manualReconciliationRequired,
      rebuild_allowed: !postDeployReconciliation,
      ...(reconciliation ? { reconciliation } : {}),
      ...(releaseEvidence ? { releaseEvidence, release_evidence: releaseEvidence } : {}),
      ...(previewUrl ? { previewUrl, preview_url: previewUrl } : {}),
      ...(buildHash ? { buildHash, build_hash: buildHash } : {}),
      dispatchFailure: {
        code: reason,
        detail: out.buildStatus?.detail || [],
        status: 503,
        beforeBuild: !postDeployReconciliation,
        hasDurableBuildIdentity,
        retryable: !postDeployReconciliation,
        disposition: "system_hold",
        lead_rejection: false,
        provider_attempted: providerAttempted,
        manual_reconciliation_required: manualReconciliationRequired,
        rebuild_allowed: !postDeployReconciliation,
        ...(reconciliation ? { reconciliation } : {}),
        ...(releaseEvidence ? { release_evidence: releaseEvidence } : {}),
        attempt_id: mirrorAttemptId || "",
      },
    };
  }
  // NAME THE CASUALTY EVEN WHEN THE DISPATCH IS TRUTHY. For a LeadMiner packet
  // a refusal comes back as a truthy fail-closed shape (see
  // blockedLeadMinerMirrorDispatch), so the null-check above never fires and
  // this path was the one that reduced a captured `invalid_request (status
  // 400) — /brand/logo: must match pattern "^https://"` to "mirror produced
  // no host-approved preview URL", ten runs in a row.
  const candidate = String(out.urls?.preview_url || "").trim();
  const url = sanitizePreviewUrl(candidate);
  if (!url) {
    const rawReason = candidate
      ? `mirror produced a preview URL the host guard refused: ${candidate.slice(0, 160)}`
      : describeDeadDispatch(out, refusal);
    const failure = dispatchFailureSummary(refusal, out, candidate);
    const reason = failure.beforeBuild && rawReason.startsWith("mirror_build_not_revealable")
      ? "mirror_dispatch_failed_before_build"
      : rawReason;
    await stampFailure(reason);
    return {
      ok: false,
      reason,
      dispatchFailure: {
        ...failure,
        attempt_id: mirrorAttemptId || "",
      },
    };
  }
  const nativeBuild = nativeMirrorBuildEvidence(out, url);
  if (nativeBuild.native && nativeBuild.reason) {
    const reason = `mirror_dispatch_failed_before_build: ${nativeBuild.reason}`;
    await stampFailure(reason);
    return {
      ok: false,
      reason,
      dispatchFailure: {
        code: boundedDetailText(nativeBuild.reason || "mirror_engine_release_evidence_invalid"),
        detail: boundedDetailText(nativeBuild.reason || "", 300),
        status: null,
        beforeBuild: true,
        hasDurableBuildIdentity: false,
        attempt_id: mirrorAttemptId || "",
      },
    };
  }
  // A deployed preview with invalid native evidence is not a before-build
  // failure, but it is also not permission to erase the native evidence gate.
  // Carry a non-authoritative marker (never the invalid manifest) so the later
  // preview/CAS boundary fails closed before queueing or delivery.
  const buildEvidence = nativeBuild.evidence || unverifiedNativeBuildMarker(nativeBuild, out);
  return {
    ok: true,
    previewUrl: url,
    authorization: "owner_funded_spec_build",
    // LIGHT vs FULL verification (GHOST_AGENCY_LIGHT_VERIFICATION) — carried
    // from the dispatch onto the built tuple so the durable row records which
    // verification produced this site.
    verification: out.verification || String(out.buildStatus?.verification || "full"),
    // Mirror's identity and signed release packet travel as native evidence.
    // Do not populate any SiteForge compatibility fields here: the send gate
    // understands this renderer/QC pair directly.
    contentSource: buildEvidence?.content_source || String(out.content_source || "").trim(),
    renderer: buildEvidence?.renderer || String(out.renderer || out.buildStatus?.renderer || "").trim(),
    qcContract: buildEvidence?.qc_contract || String(out.qc_contract || out.buildStatus?.qc_contract || "").trim(),
    evidenceSchema: buildEvidence?.evidence_schema || String(out.evidence_schema || out.buildStatus?.evidence_schema || "").trim(),
    evidenceSha: buildEvidence?.evidence_sha || String(out.evidence_sha || out.buildStatus?.evidence_sha || "").trim(),
    releaseEvidence: buildEvidence?.release_evidence || null,
    buildEvidence: buildEvidence || null,
    // The aggregate the page went out with. The gate reads the frozen contract;
    // this is what the build actually published, so the two can be compared
    // against the same moment in Google's data. See sourceFactsFor.
    publishedAggregate: out.published_aggregate || null,
    // The build's own photo accounting (engine checks.brand.photos), carried
    // out so the render gate's owned_photos_retained fact can compare placed
    // against banked. Same ride-along contract as publishedAggregate.
    photoAccounting: out.photo_accounting || null,
    // The build may have harvested the first provenance-complete bank this
    // prospect has ever had. Keep it on the Line row until the passing gate
    // commits it; only then may the automatic remaster worker see it.
    ownedPhotoBank: out.owned_photo_bank || null,
    // WHAT THE EMAIL'S PICTURES ARE PICTURES OF.
    //
    // The build hash identifies this exact build; the prospect's current site
    // is the "before" half of the comparison. Both travel with the row so the
    // render gate's capture hook can shoot the whole set in the browser it
    // already has open, instead of the send path launching one per prospect.
    // Read off the row we ALREADY loaded above — no extra store round trip.
    buildHash: String(out.build_hash || ""),
    currentWebsite: String(
      persisted.current_website
      || persistedRecord.current_website
      || dispatchProspect.current_website
      || "",
    ).trim(),
  };
}

/**
 * sourceFactsFor — the client's OWN verified facts, and only those.
 *
 * facts.city (Google NAP locality) is the ONLY value allowed to prove the
 * postal address. facts.service_area is marketing copy from the client's own
 * site and is deliberately NOT substituted for it.
 */
async function sourceFactsFor(row, options = {}) {
  const read = options.select || select;
  const result = await read(PROSPECTS, `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`).catch(() => null);
  const persisted = (result && result.ok === true && result.data && result.data[0]) || {};
  const record = recordOf(persisted);
  const truthPacket = row.truth_packet && typeof row.truth_packet === "object"
    ? row.truth_packet
    : record.truth_packet && typeof record.truth_packet === "object" ? record.truth_packet : null;
  const truthPacketSource = String(row.truth_packet_source || record.truth_packet_source || "").trim();
  const buildReady = buildReadyOf(record) || {};
  const request = buildReady.mirror_request && typeof buildReady.mirror_request === "object"
    ? buildReady.mirror_request
    : {};
  const facts = request.facts && typeof request.facts === "object"
    ? request.facts
    : record.facts && typeof record.facts === "object" ? record.facts : {};
  const brand = request.brand && typeof request.brand === "object"
    ? request.brand
    : record.brand && typeof record.brand === "object" ? record.brand : {};

  // A LeadMiner truth packet carries the client facts the gate needs; the
  // mined-contract fields above are empty for packet rows. Same rule either
  // way: ABSENT beats invented.
  const packetLead = truthPacketSource === "leadminer_mirror_ready"
    && truthPacket
    && truthPacket.mirror_ready && typeof truthPacket.mirror_ready === "object"
    ? truthPacket.mirror_ready
    : null;

  // THE LABEL IS A HINT; THE SERVICES ARE THE EVIDENCE — for the GATE'S
  // REFERENCE too, not only for the pick and the build. Both of those already
  // derive the trade from the packet's services (M & M's label says "plumber",
  // its services say air conditioning), so the mirror is correctly built as
  // hvac on the hvac donor — and then this function handed the gate the raw
  // label, the gate normalised it to "plumbing", and vertical_match refused
  // the page as "trade swap — foreign trade language on a plumbing mirror:
  // hvac:hvac, hvac:furnace…". Measured live on batch line_msm8rq4w_96090128,
  // 2026-08-09: a correct build failed against a wrong reference. Same
  // inference, same inputs, so the three readers cannot disagree again.
  const packetTradeEvidence = packetLead
    ? inferTrade({
      label: packetLead.industry || "",
      services: (Array.isArray(packetLead.services) && packetLead.services.length)
        ? packetLead.services
        : (Array.isArray(record.truth_packet?.services) ? record.truth_packet.services : []),
      businessName: packetLead.business_name || persisted.business_name || row.businessName || "",
    })
    : null;
  const packetTrade = approvedIndustry(packetTradeEvidence?.trade);
  const requestedPacketTrade = approvedIndustry(row.vertical);
  const provenPacketTrades = new Set([
    packetTradeEvidence?.trade,
    ...(Array.isArray(packetTradeEvidence?.secondary) ? packetTradeEvidence.secondary : []),
  ].map(approvedIndustry).filter(Boolean));
  const selectedPacketTrade = requestedPacketTrade && provenPacketTrades.has(requestedPacketTrade)
    ? requestedPacketTrade
    : packetTrade;
  const out = {
    prospect_id: row.prospectId,
    business_name: facts.business_name || packetLead?.business_name || persisted.business_name || row.businessName,
    vertical: selectedPacketTrade
      || approvedIndustry(facts.industry)
      || approvedIndustry(packetLead?.industry || persisted.industry || row.vertical)
      || facts.industry || packetLead?.industry || persisted.industry || row.vertical,
  };
  // ABSENT beats invented. Each field is copied only when it is really there.
  // The client's VERIFIED service list rides along for the vertical gate: a
  // fencing company named "Texas Best Fence & Patio" whose verified services
  // include "Patio Covers" and "Automatic Driveway Gates" must not be refused
  // for printing its own offerings as "concrete:patio, concrete:driveway"
  // (measured live, 2026-08-19). The gate exempts only these whole verified
  // phrases — a donor-swapped foreign paragraph is not in the list and still
  // convicts.
  // Sourcing order mirrors where the mirror itself read them: a web-hunted
  // prospect has no packet, and its verified services live on the immutable
  // build request (request.content.services) — the exact list the page prints.
  // Measured live 2026-08-20: Texas Best Fence & Patio (mined, no packet) was
  // re-convicted because only the packet fields were consulted here.
  const verifiedServices = [
    packetLead?.services,
    truthPacket?.services,
    request.content?.services,
    record.content?.services,
  ].find((list) => Array.isArray(list) && list.length) || [];
  if (verifiedServices.length) out.services = verifiedServices;
  const tradeEvidence = inferTrade({
    label: out.vertical,
    services: verifiedServices,
    businessName: out.business_name,
  });
  const admittedSecondary = new Set(
    (Array.isArray(tradeEvidence.secondary) ? tradeEvidence.secondary : [])
      .map((trade) => approvedIndustry(trade)).filter(Boolean),
  );
  // If an exact owner pick used a two-hit secondary because the primary trade
  // has no donor, the original primary remains true client context. Carry it
  // to the render gate as an admitted secondary instead of making the GC shell
  // convict Roy Briley for printing its restoration work.
  if (selectedPacketTrade && packetTrade && selectedPacketTrade !== packetTrade) {
    admittedSecondary.add(packetTrade);
  }
  admittedSecondary.delete(approvedIndustry(out.vertical));
  if (admittedSecondary.size) out.secondary_verticals = [...admittedSecondary];
  // Third-party review texts ride along too: they are VERBATIM customer words
  // the mirror prints, and the vertical gate must not convict a trade word a
  // CUSTOMER wrote ("they diagnosed our plumbing" on an HVAC mirror —
  // measured convicting Bell Brothers live, 2026-08-20).
  const verbatimReviews = [
    request.content?.reviews,
    record.content?.reviews,
    packetLead?.reviews,
  ].find((list) => Array.isArray(list) && list.length) || [];
  const reviewTexts = verbatimReviews
    .map((r) => String((r && (r.text || r.body || r.quote)) || (typeof r === "string" ? r : "")).trim())
    .filter((t) => t.length >= 40);
  if (reviewTexts.length) out.reviews = reviewTexts;
  if (facts.phone) out.phone = facts.phone;
  else if (packetLead?.phone_national) out.phone = packetLead.phone_national;
  if (facts.city) out.postal_city = facts.city;
  else if (packetLead?.city) out.postal_city = packetLead.city;
  if (!out.logo_sha256 && /^[0-9a-f]{64}$/i.test(String(packetLead?.logo_sha256 || ""))) {
    out.logo_sha256 = String(packetLead.logo_sha256).trim().toLowerCase();
  }
  if (!out.logo_sha256 && packetLead?.logo_url) {
    // The packet's captured logo URL is the same source the build ships as
    // /assets/client-logo.png — hashing the same bytes gives the gate its
    // own-logo proof without any provider call.
    try {
      const res = await fetch(packetLead.logo_url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        out.logo_sha256 = require("node:crypto").createHash("sha256").update(buf).digest("hex");
      }
    } catch { /* absent stays absent; the gate fails closed */ }
  }
  if (brand.logo_sha256 || buildReady.brand_evidence?.logo_sha256 || record.logo_sha256) {
    out.logo_sha256 = brand.logo_sha256 || buildReady.brand_evidence?.logo_sha256 || record.logo_sha256;
  }
  // The mirror may discover a first-party logo while building an older packet
  // whose frozen intake did not contain a logo URL. The engine's signed release
  // evidence is the authoritative record of the bytes it actually shipped.
  // Accept that hash only when source and output hashes agree and the signed
  // brand check says the client's logo both shipped and rendered. A failed or
  // tampered candidate never reaches this branch.
  const releasedBrand = signedReleaseBrandForRow(row);
  const releasedSourceSha = String(releasedBrand?.logo_sha_source || "").trim().toLowerCase();
  const releasedOutputSha = String(releasedBrand?.logo_sha_in_output || "").trim().toLowerCase();
  if (!out.logo_sha256
    && releasedBrand?.status === "passed"
    && releasedBrand?.logo === "client"
    && releasedBrand?.logo_asset_shipped === true
    && releasedBrand?.logo_in_dom === true
    && /^[a-f0-9]{64}$/.test(releasedSourceSha)
    && releasedSourceSha === releasedOutputSha) {
    out.logo_sha256 = releasedSourceSha;
  }
  // Logo absence is a polish downgrade, not a truth failure. Carry only the
  // deliberate ladder mark that the signed engine verdict actually passed (or
  // the immutable request's preselected fallback for older evidence). The
  // render gate still refuses any real logo whose bytes do not match.
  if (!out.logo_sha256) {
    const releasedMark = releasedBrand?.status === "passed"
      && releasedBrand?.mark_fallback
      && releasedBrand?.logo !== "client"
      ? objectOf(releasedBrand.mark)
      : null;
    const requestMark = objectOf(brand.mark);
    if (releasedMark || requestMark) out.brand_mark = releasedMark || requestMark;
  }
  let donorStrings = Array.isArray(record.donor_strings)
    ? record.donor_strings
    : record.donor_fingerprint ? [].concat(record.donor_fingerprint) : [];
  if (!donorStrings.length && (request.donor || buildReady.donor || packetLead)) {
    const resolveDonor = options.resolveDonor || require("./mirror-engine/donor").resolveDonor;
    const resolved = resolveDonor({ donor: request.donor || buildReady.donor, industry: out.vertical });
    if (resolved && resolved.ok) donorStrings = donorStringsFromManifest(resolved.manifest);
  }
  if (donorStrings.length) out.donor_strings = donorStrings;
  const rating = facts.rating ?? facts.rating_value ?? packetLead?.rating;
  const reviewCount = facts.review_count ?? facts.rating_count ?? packetLead?.review_count;
  if (rating != null && reviewCount != null) {
    out.rating_value = rating;
    out.rating_count = reviewCount;
  }
  // THE REFERENCE HAS TO BE THE SAME AGE AS THE CLAIM.
  //
  // Everything above reads the FROZEN mined contract. The build publishes what
  // its own fact resolver read from Google minutes earlier, so on a business
  // earning reviews the two differ by exactly the reviews earned in between and
  // the gate refuses the page for being more accurate than its reference.
  // Measured: Maston's Plumbing & Drain published 4.9/679 against a stored 678;
  // Paschal 2128 against 2127. One-directional (the frozen number is always the
  // older, lower one), and worst on the busiest businesses.
  //
  // A LIVE reading of the same place_id replaces the stored one here. It is the
  // same evidence from the same source, just current — the equality in
  // checkAggregateRating stays EXACT, and a number nobody observed still fails.
  // An origin that is not a live observation is ignored: it is not fresher than
  // the contract and must not be allowed to answer for it.
  const observed = options.publishedAggregate;
  const LIVE_OBSERVATIONS = new Set(["verified_facts_resolver", "pinned_place_lookup"]);
  if (observed && LIVE_OBSERVATIONS.has(observed.origin)
    && Number(observed.rating) > 0 && Number(observed.review_count) > 0) {
    out.rating_value = Number(observed.rating);
    out.rating_count = Math.trunc(Number(observed.review_count));
    out.rating_source = observed.origin;
  }
  if (Array.isArray(record.unverified_claims)) out.unverified_claims = record.unverified_claims;

  // -----------------------------------------------------------------------
  // THE COMPARATIVE HALF — what the client's OWN site had, for the render
  // gate's parity facts (owned_photos_retained / side_by_side_captured). Same
  // law as every field above: ABSENT beats invented. A bank that is missing
  // or stale emits no captured count, and the gate records the skip with its
  // reason — never a silent pass, and never a number nobody observed.
  // -----------------------------------------------------------------------
  const bank = photoBank.bankFromRecord(record);
  if (photoBank.bankIsFresh(bank) && Array.isArray(bank.photos)) {
    out.photos_captured = bank.photos.length;
  }
  // What the build PLACED, from the engine's own accounting, carried out by
  // the dispatch (mirrorProspect -> built.photoAccounting -> this options
  // argument in line-runner). Unusable/absent accounting emits nothing and
  // the gate fails the retention fact closed on a banked packet.
  const accounting = options.photoAccounting;
  if (accounting && typeof accounting === "object") {
    const placed = Number(accounting.placed);
    if (Number.isInteger(placed) && placed >= 0) out.photos_placed = placed;
    if (Array.isArray(accounting.photos_unplaced)) out.photos_unplaced = accounting.photos_unplaced;
  }
  // A prospect that already carries a preview_url is being REBUILT: this build
  // replaces one, so the gate demands its four comparative shots as inputs —
  // UNLESS the caller runs a post-verdict capture hook, which shoots the same
  // four for every row it processes, fresh or re-built. Measured 2026-08-20:
  // the line re-building already-built prospects failed side_by_side_captured
  // closed (2 of 10 in the acceptance run) for shots its own hook was about
  // to take. Hook-less paths (api/admin/rebuild-mirror) still fail closed.
  if (String(persisted.preview_url || "").trim()) out.rebuild = true;
  if (options.postVerdictCapture === true) out.side_by_side_hook = "post_verdict";
  return out;
}

function mirrorBuildEvidenceFromRow(row = {}, previewUrl = "") {
  const carried = objectOf(row.buildEvidence || row.build_evidence);
  const releaseEvidence = objectOf(
    row.releaseEvidence
    || row.release_evidence
    || carried?.release_evidence
    || (carried?.revealable === true ? carried : null),
  );
  const declaresMirror = carried?.renderer === MIRROR_ENGINE_RENDERER
    || releaseEvidence?.renderer === MIRROR_ENGINE_RENDERER
    || releaseEvidence?.evidence_schema === MIRROR_ENGINE_EVIDENCE_SCHEMA;
  if (!declaresMirror) return { native: false, evidence: null, reason: "" };
  return nativeMirrorBuildEvidence({
    renderer: carried?.renderer || releaseEvidence?.renderer,
    qc_contract: carried?.qc_contract || releaseEvidence?.qc_contract,
    evidence_schema: carried?.evidence_schema || releaseEvidence?.evidence_schema,
    evidence_sha: carried?.evidence_sha || releaseEvidence?.evidence_sha,
    build_hash: carried?.build_hash || row.buildHash || releaseEvidence?.build_hash,
    content_source: carried?.content_source || row.contentSource || row.content_source,
    release_evidence: releaseEvidence,
    buildStatus: carried || {},
  }, previewUrl);
}

function canonicalMirrorDispatch(row, safe, evidence) {
  return {
    mode: "mirror_engine",
    pending: false,
    ready: true,
    preview_url: safe,
    urls: { preview_url: safe },
    renderer: MIRROR_ENGINE_RENDERER,
    required_renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    required_qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: evidence.evidence_sha,
    qc_passed: true,
    visual_qc_passed: true,
    generation_fingerprint: evidence.generation_fingerprint || "",
    build_hash: evidence.build_hash || "",
    content_source: evidence.content_source || "",
    release_evidence: evidence.release_evidence,
    ...(String(row.operationKey || "").trim() ? { job_id: String(row.operationKey).trim() } : {}),
  };
}

function persistedMirrorEvidenceMatches(current, safe, expectedDispatch) {
  if (!current || sanitizePreviewUrl(current.preview_url) !== safe
    || !["line_gate_passed", "line_queued"].includes(String(current.status || ""))) return false;
  const record = recordOf(current);
  const dispatch = objectOf(record.build_dispatch);
  if (!dispatch
    || sanitizePreviewUrl(record.preview_url) !== safe
    || !["line_gate_passed", "line_queued"].includes(String(record.status || ""))
    || dispatch.renderer !== MIRROR_ENGINE_RENDERER
    || dispatch.qc_contract !== MIRROR_ENGINE_QC_CONTRACT
    || dispatch.evidence_schema !== MIRROR_ENGINE_EVIDENCE_SCHEMA
    || dispatch.ready !== true
    || dispatch.pending !== false
    || dispatch.qc_passed !== true
    || dispatch.visual_qc_passed !== true
    || !sameCanonical(dispatch, expectedDispatch)
    || !sameCanonical(record.mirror_release_evidence, expectedDispatch.release_evidence)
    || !signedMirrorReleaseEvidence(dispatch.release_evidence, safe)) return false;
  return true;
}

function mirrorRecordPatch(current, safe, row, evidence) {
  const record = recordOf(current);
  const dispatch = canonicalMirrorDispatch(row, safe, evidence);
  const existingDispatch = objectOf(record.build_dispatch);
  const replaceLegacy = existingDispatch
    && existingDispatch.renderer !== MIRROR_ENGINE_RENDERER
    && !sameCanonical(existingDispatch, dispatch);
  // THE SHIPPED ACCENT, MADE DURABLE on the line lane too — the same distilled
  // record.brand_truth full-run's mergedRecord writes, so verifiedBrandOf (the
  // single reader) answers with the colour this mirror actually wears
  // whichever lane built it. Conditional: evidence with no shipped hex keeps
  // whatever truth an earlier build already persisted.
  const shippedBrandTruth = brandTruthFromEvidence(evidence.release_evidence);
  const ownedPhotoBank = completedLineHeroBank(row, current);
  return {
    dispatch,
    record: {
      ...record,
      ...(replaceLegacy ? { legacy_build_dispatch: existingDispatch } : {}),
      ...(row.truth_packet && typeof row.truth_packet === "object"
        ? {
          truth_packet: row.truth_packet,
          truth_packet_source: row.truth_packet_source || record.truth_packet_source || "leadminer_mirror_ready",
        }
        : {}),
      status: "line_gate_passed",
      preview_url: safe,
      build_dispatch: dispatch,
      mirror_release_evidence: evidence.release_evidence,
      ...(ownedPhotoBank ? { photo_bank: ownedPhotoBank } : {}),
      ...(shippedBrandTruth ? { brand_truth: shippedBrandTruth } : {}),
    },
  };
}

function rowProofShots(row) {
  const shots = objectOf(row && (row.proof_shots || row.captured?.shots));
  if (!shots) return null;
  // A capture refusal is evidence, not a picture. line-proof-shots never puts
  // an identity-mismatched URL here; keep that fail-closed contract by copying
  // only its canonical record object, never synthesizing a URL from the row.
  const sourceMismatch = Array.isArray(row?.captured?.results)
    && row.captured.results.some((result) => (
      /^old(?:-|$)/.test(String(result && result.variant || ""))
        && /^capture_identity_/.test(String(result && result.reason || ""))
    ));
  if (sourceMismatch || /^capture_identity_/.test(String(shots.before_refused || ""))) return null;
  return { ...shots };
}

function persistedProofShotsMatch(current, expected) {
  if (!expected) return true;
  return sameCanonical(objectOf(recordOf(current).proof_shots), expected);
}

/** Written only after a passing gate — line-runner enforces the order. */
async function writePreviewUrl(row, url, options = {}) {
  const safe = sanitizePreviewUrl(url);
  if (!safe) return { ok: false, reason: "preview URL failed the host guard" };
  const durableVersion = String(row.durableUpdatedAt || "").trim();
  if (!durableVersion) return { ok: false, reason: "preview_url_write_version_missing" };
  if (sportFencingVerticalHold(row)) return previewWritePolicyHold();
  const nativeBuild = mirrorBuildEvidenceFromRow(row, safe);
  if (nativeBuild.native && (nativeBuild.reason || nativeBuild.unverifiedEvidence === true)) {
    return previewWriteEvidenceRefusal(nativeBuild.reason || "mirror_engine_release_evidence_invalid");
  }
  const read = options.select || select;
  let expectedDispatch = null;
  let expectedPhotoBank = null;
  let recordPatch = null;
  const proofShots = rowProofShots(row);
  let current = null;
  // Production always re-reads the canonical prospect before promotion. The
  // explicit flag is carried by line-runner; default production dependencies
  // also require it. Tests that replace the write dependency can inject the
  // matching select dependency when they need to exercise the canonical CAS.
  const canonicalReadRequired = Boolean(
    nativeBuild.evidence
    || proofShots
    || options.requireCanonicalPolicyCheck === true
    || options.select
    || !options.conditionalUpdate
  );
  if (canonicalReadRequired) {
    const beforeRead = await read(
      PROSPECTS,
      `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
      { signal: options.signal, deadlineAt: options.deadlineAt },
    ).catch(() => null);
    current = beforeRead?.ok === true && Array.isArray(beforeRead.data) ? beforeRead.data[0] : null;
    if (!current) return { ok: false, reason: "preview_url_record_read_failed" };
    // The version can still match when the row was already quarantined before
    // this build phase began. Version equality is concurrency evidence, not
    // permission to erase an explicit vertical truth hold.
    if (sportFencingVerticalHold(current)) return previewWritePolicyHold();
  }
  if (nativeBuild.evidence || proofShots) {
    if (nativeBuild.evidence) {
      const prepared = mirrorRecordPatch(current, safe, row, nativeBuild.evidence);
      expectedDispatch = prepared.dispatch;
      recordPatch = prepared.record;
      expectedPhotoBank = recordPatch.photo_bank || null;
    } else {
      recordPatch = { ...recordOf(current), status: "line_gate_passed", preview_url: safe };
    }
    if (proofShots) recordPatch = { ...recordPatch, proof_shots: proofShots };
    if (String(current.updated_at || "") !== durableVersion) {
      const mirrorMatches = expectedDispatch
        ? persistedMirrorEvidenceMatches(current, safe, expectedDispatch)
        : sanitizePreviewUrl(current.preview_url) === safe
          && ["line_gate_passed", "line_queued"].includes(String(current.status || ""));
      if (mirrorMatches && persistedProofShotsMatch(current, proofShots)) {
        if (expectedPhotoBank && !sameCanonical(objectOf(recordOf(current).photo_bank), expectedPhotoBank)) {
          return { ok: false, reason: "preview_url_write_conflict" };
        }
        return { ok: true, reconciled: true, rowPatch: { durableUpdatedAt: String(current.updated_at || "") } };
      }
      return { ok: false, reason: "preview_url_write_conflict" };
    }
  }
  const update = options.conditionalUpdate || conditionalUpdate;
  const result = await update(
    PROSPECTS,
    "prospect_id",
    row.prospectId,
    { updated_at: `eq.${durableVersion}` },
    {
      preview_url: safe,
      status: "line_gate_passed",
      ...(recordPatch ? { record: recordPatch } : {}),
      updated_at: new Date().toISOString(),
    },
    { signal: options.signal, deadlineAt: options.deadlineAt },
  );
  if (result && result.ok === true && result.updated === true) {
    const committed = Array.isArray(result.rows) ? result.rows[0] : null;
    return { ok: true, rowPatch: { durableUpdatedAt: String(committed?.updated_at || "") } };
  }
  // A timeout can lose the HTTP response after Postgres committed. Re-read the
  // canonical row before retrying: same URL in the same-or-later Line state is
  // idempotent success; different evidence is a real conflict and stays shut.
  const loaded = await read(
    PROSPECTS,
    `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
    { signal: options.signal, deadlineAt: options.deadlineAt },
  ).catch(() => null);
  current = loaded?.ok === true && Array.isArray(loaded.data) ? loaded.data[0] : null;
  // A hold can win the CAS race after the first read. Return the same terminal
  // policy result instead of turning a correct quarantine into five retries.
  if (sportFencingVerticalHold(current)) return previewWritePolicyHold();
  const reconciled = (expectedDispatch
    ? persistedMirrorEvidenceMatches(current, safe, expectedDispatch)
    : current && sanitizePreviewUrl(current.preview_url) === safe
      && ["line_gate_passed", "line_queued"].includes(String(current.status || "")))
    && persistedProofShotsMatch(current, proofShots);
  if (reconciled) {
    if (expectedPhotoBank && !sameCanonical(objectOf(recordOf(current).photo_bank), expectedPhotoBank)) {
      return { ok: false, reason: "preview_url_write_conflict" };
    }
    return { ok: true, reconciled: true, rowPatch: { durableUpdatedAt: String(current.updated_at || "") } };
  }
  return { ok: false, reason: result?.error || "preview_url_write_conflict" };
}

/** Marks the row ready for explicit Line approval. Drip/outreach never selects this status. */
function queueContactBoundary(current, previewUrl, options = {}) {
  if (!current || typeof current !== "object") {
    return { ok: false, reason: "queue_canonical_record_read_failed" };
  }
  const status = String(current.status || "").trim().toLowerCase();
  if (!new Set(["line_gate_passed", "line_queued"]).has(status)) {
    return { ok: false, reason: "queue_canonical_status_not_ready" };
  }
  if (sanitizePreviewUrl(current.preview_url) !== previewUrl) {
    return { ok: false, reason: "queue_canonical_preview_mismatch" };
  }

  const record = recordOf(current);
  const recordStatus = String(record.status || "").trim().toLowerCase();
  if (recordStatus && !new Set(["line_gate_passed", "line_queued"]).has(recordStatus)) {
    return { ok: false, reason: "queue_canonical_record_status_not_ready" };
  }
  const suppressed = [
    current.suppressed, current.contact_suppressed, current.email_suppressed, current.do_not_contact,
    record.suppressed, record.contact_suppressed, record.email_suppressed, record.do_not_contact,
  ].some((value) => value === true || /^(1|true|yes|on)$/i.test(String(value || "").trim()));
  if (suppressed) return { ok: false, reason: "queue_contact_suppressed" };
  const sandboxOwner = normalizeEmail(options.sandboxOwner || "");
  if (sandboxOwner) {
    return {
      ok: true,
      email: sandboxOwner,
      storedEmail: "",
      fingerprint: recipientFingerprint(sandboxOwner),
      recordStatus,
      sandboxOwnerOnly: true,
    };
  }
  if (current.contactReady === false || current.contact_ready === false
    || record.contactReady === false || record.contact_ready === false) {
    return { ok: false, reason: "queue_contact_not_ready" };
  }

  const verdict = contactFirstVerdict(current);
  const storedEmail = String(current.email || "").trim();
  const email = normalizeEmail(storedEmail);
  if (!verdict.ok || verdict.contactReady !== true || !email || verdict.email !== email) {
    return { ok: false, reason: "queue_contact_not_ready" };
  }
  return {
    ok: true,
    email,
    storedEmail,
    fingerprint: recipientFingerprint(email),
    recordStatus,
  };
}

// Queue-time reads need the durable contact truth and CAS fields, but not the
// prospect's unrelated build/report payloads. Keep this projection aligned
// with queueContactBoundary() and contactFirstVerdict().
const QUEUE_CANONICAL_FIELDS = [
  "prospect_id", "email", "owner_email", "preview_url", "status", "updated_at", "record",
].join(",");

async function queueEmail(row, options = {}) {
  const safe = sanitizePreviewUrl(row.previewUrl || "");
  if (!safe) return { ok: false, reason: "queue_preview_url_invalid" };
  const read = options.select || select;
  const beforeRead = await read(
    PROSPECTS,
    `?select=${QUEUE_CANONICAL_FIELDS}&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
    { signal: options.signal, deadlineAt: options.deadlineAt },
  ).catch(() => null);
  const before = beforeRead?.ok === true && Array.isArray(beforeRead.data) ? beforeRead.data[0] : null;
  const sandboxOwner = options.lane === "sandbox"
    ? normalizeEmail(options.ownerEmail || require("./sandbox-send").ownerSandboxAddress())
    : "";
  if (options.lane === "sandbox" && !sandboxOwner) return { ok: false, reason: "owner_address_unset" };
  const boundary = queueContactBoundary(before, safe, { sandboxOwner });
  if (!boundary.ok) return boundary;
  const { storedEmail, fingerprint, recordStatus } = boundary;
  if (before && String(before.status || "") === "line_queued"
    && sanitizePreviewUrl(before.preview_url) === safe) {
    return {
      ok: true,
      reconciled: true,
      rowPatch: {
        recipientFingerprint: fingerprint,
        durableUpdatedAt: String(before.updated_at || ""),
        hasEmail: Boolean(storedEmail),
        contactReady: Boolean(storedEmail),
      },
    };
  }
  const update = options.conditionalUpdate || conditionalUpdate;
  const result = await update(
    PROSPECTS,
    "prospect_id",
    row.prospectId,
    {
      status: "eq.line_gate_passed",
      preview_url: `eq.${safe}`,
      // Postgres text equality is case-sensitive. Guard with the exact durable
      // spelling while the delivery fingerprint remains normalized.
      ...(storedEmail ? { email: `eq.${storedEmail}` } : {}),
      ...(String(before.updated_at || "").trim() ? { updated_at: `eq.${String(before.updated_at).trim()}` } : {}),
      ...(recordStatus ? { "record->>status": `eq.${recordStatus}` } : {}),
    },
    { status: "line_queued", updated_at: new Date().toISOString() },
    { signal: options.signal, deadlineAt: options.deadlineAt },
  );
  if (result && result.ok === true && result.updated === true) {
    const committed = Array.isArray(result.rows) ? result.rows[0] : null;
    return {
      ok: true,
      rowPatch: {
        recipientFingerprint: fingerprint,
        durableUpdatedAt: String(committed?.updated_at || ""),
        hasEmail: Boolean(storedEmail),
        contactReady: Boolean(storedEmail),
      },
    };
  }
  const afterRead = await read(
    PROSPECTS,
    `?select=${QUEUE_CANONICAL_FIELDS}&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
    { signal: options.signal, deadlineAt: options.deadlineAt },
  ).catch(() => null);
  const after = afterRead?.ok === true && Array.isArray(afterRead.data) ? afterRead.data[0] : null;
  const afterBoundary = queueContactBoundary(after, safe, { sandboxOwner });
  if (after && String(after.status || "") === "line_queued"
    && sanitizePreviewUrl(after.preview_url) === safe
    && afterBoundary.ok
    && afterBoundary.fingerprint === fingerprint) {
    return {
      ok: true,
      reconciled: true,
      rowPatch: {
        recipientFingerprint: fingerprint,
        durableUpdatedAt: String(after.updated_at || ""),
        hasEmail: Boolean(storedEmail),
        contactReady: Boolean(storedEmail),
      },
    };
  }
  return { ok: false, reason: result?.error || "queue_write_conflict" };
}

/**
 * JOIN-ONLY HERO RECHECK (2026-08-28). A qualified row parked at
 * heroRemaster.pending re-asks the hero question every ~30s. Re-entering the
 * full mirror pipeline for each recheck re-dispatched the entire build — the
 * persisted-mirror resume only covers prospects already at
 * line_gate_passed/line_queued, so a re-picked or mid-batch row rebuilt from
 * scratch on every poll (measured live: fresh dispatch attempts every cycle,
 * rows stranded 44 minutes while their done+approved hero receipts sat
 * unusable). This recheck answers the hero question directly against the
 * persisted record when the row's own build identity is intact: the join
 * resolves a definitive refusal to a donor-rung ship or a done receipt to an
 * applied crossing WITHOUT spending another build.
 *
 * It never widens provenance. The row's preview URL must match the persisted
 * record's, and the full enqueue/join contract (verified banks, receipts,
 * signed release evidence) applies unchanged. Any doubt — missing record,
 * mismatched preview, unresolved join shape — returns { skipped:true} so the
 * caller falls through to the full pipeline exactly as before.
 */
async function heroJoinOnlyRecheck(row = {}, options = {}) {
  const previewUrl = sanitizePreviewUrl(row.previewUrl);
  const pendingHero = objectOf(row.heroRemaster) || objectOf(row.hero_remaster) || {};
  if (!String(row.prospectId || row.prospect_id || "").trim()
    || !previewUrl
    || pendingHero.pending !== true) {
    return { skipped: true };
  }
  const read = options.select || select;
  const loaded = await read(
    PROSPECTS,
    `?select=*&prospect_id=eq.${encodeURIComponent(row.prospectId)}&limit=1`,
    { signal: options.signal, deadlineAt: options.deadlineAt },
  ).catch(() => null);
  // A read outage is uncertainty, never permission to rebuild an already
  // signed Mirror. The runner parks this exact code only when the row also
  // carries its complete build and hero identities.
  if (!loaded || loaded.ok !== true || !Array.isArray(loaded.data)) {
    return { skipped: true, retryable: true, reason: "hero_recheck_read_unavailable" };
  }
  const current = loaded.data[0] || null;
  if (!current) return { skipped: true, reason: "hero_recheck_prospect_missing" };
  const record = recordOf(current);
  const ownedPhotoBank = storedLineHeroBank(current, row);
  const persistedPreview = sanitizePreviewUrl(current.preview_url || record.preview_url);
  if (persistedPreview && persistedPreview !== previewUrl) {
    return { skipped: true, reason: "hero_recheck_preview_mismatch" };
  }

  // This helper is a true read-only join. A stale terminal job may only be
  // reopened after mirrorProspectResumable refreshes the owned photo bank and
  // wins the prospect CAS with the exact inspected stale-job snapshot.
  // reuseOnly preserves the normal same-handle definitive-refusal fallback;
  // inspectOnly is deliberately stricter and would turn that ship rung into a
  // hold.
  const joined = await enqueueCompletedLineHero(
    { ...row, previewUrl, ...(ownedPhotoBank ? { ownedPhotoBank } : {}) },
    current,
    record,
    { ...options, reuseOnly: true },
  );
  if (joined?.pending === true) {
    const pendingCodes = [joined.status, joined.reason, joined.error]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    if (pendingCodes.some((value) => value === "stale_line_handle"
      || value === "hero_remaster_line_handle_mismatch"
      || value === "hero_line_handle_mismatch"
      || value.includes("line_handle_mismatch"))) {
      // A terminal job owned by an older Line handle cannot be joined here.
      // Fall through to mirrorProspectResumable, which verifies the persisted
      // base, refreshes the owned photo under CAS, and performs the single
      // guarded differentiated reoffer without rebuilding the site.
      return { skipped: true, reason: "hero_line_handle_reoffer_required" };
    }
    return {
      heroRemasterPending: true,
      heroRemaster: joined,
      rowPatch: { ...(ownedPhotoBank ? { ownedPhotoBank } : {}) },
    };
  }
  if (joined?.hold === true) {
    return {
      heroRemasterHold: true,
      reason: String(joined.reason || "verified_client_hero_failed"),
      heroRemaster: joined,
    };
  }
  if (joined?.applied === true) {
    const persisted = await persistAppliedLineHero({ ...row, previewUrl }, current, joined, options);
    if (!persisted.ok) {
      return {
        heroRemasterPending: true,
        heroRemaster: { ...joined, applied: false, ready: false, pending: true, reason: persisted.reason },
      };
    }
    return {
      ok: true,
      heroRemaster: joined,
      rowPatch: {
        durableUpdatedAt: String((persisted.current || current).updated_at || ""),
        ...(ownedPhotoBank ? { ownedPhotoBank } : {}),
        heroRemaster: compactHeroRemaster(joined),
      },
    };
  }
  if (joined?.required !== true && joined?.ready === true) {
    // The donor-rung ship: a definitive refusal is a missing garnish, not a
    // broken plate — the mirror ships without the couture clip.
    return {
      ok: true,
      heroRemaster: joined,
      rowPatch: {
        ...(ownedPhotoBank ? { ownedPhotoBank } : {}),
        heroRemaster: compactHeroRemaster(joined),
      },
    };
  }
  return { skipped: true };
}

module.exports = {
  parseTarget,
  practiceIdentity,
  historicalPracticeIdentities,
  readAllPracticeHistory,
  practiceHistoryLookbackDays,
  narrowedPracticeIdentityRow,
  PRACTICE_IDENTITY_ROW_SELECT,
  PRACTICE_HISTORY_DEGRADED_REASON,
  claimPracticeIdentity,
  practiceFreshnessVerdict,
  PRACTICE_IDENTITY_EVENT,
  describeRefusal,
  describeDeadDispatch,
  BUILD_RETRY_WINDOW_MS,
  rowToLineRow,
  pickProspects,
  compileGenieContent,
  verifiedGenieContentReceipt,
  genieCertifiedAdmissionEnabled,
  contentCertificationKeyConfigured,
  mirrorProspect,
  completedLineHeroBank,
  storedLineHeroBank,
  heroAutolineEnabled,
  enqueueCompletedLineHero,
  startQualifiedHero,
  prepareMirroredHero,
  heroJoinOnlyRecheck,
  ensureGatePassedHeroAutoline,
  verifySandboxStaticHeroFallbackReceipt,
  foreignStaticHeroJobBinding,
  foreignStaticHeroJobBindingSha,
  compactHeroRemaster,
  // The record patch a passing gate persists — exported for tests, which pin
  // that the shipped-accent truth (record.brand_truth) rides it.
  mirrorRecordPatch,
  // Internal evidence gate — exported for direct unit testing.
  nativeMirrorBuildEvidence,
  sourceFactsFor,
  writePreviewUrl,
  queueEmail,
  queueContactBoundary,
  recipientFingerprint,
  contactFirstVerdict,
  contactReadyLine,
  // Shared pick-time name admission (plausibility + national-chain exclusion)
  // — exported for direct unit tests, same as the other evidence gates.
  pickNameAdmission,
};
