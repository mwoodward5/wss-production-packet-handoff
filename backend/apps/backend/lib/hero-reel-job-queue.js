"use strict";

/**
 * Durable hand-off between the serverless build lane and the owner's desktop
 * Ads Station worker.
 *
 * The server only records and leases work. It never imports a browser driver,
 * starts Chrome, or generates media. The desktop worker is the only process
 * that receives a lease token, and every state-changing callback must prove
 * that the token is still current and unexpired.
 */

const { createHash, randomUUID } = require("node:crypto");
const { isIP } = require("node:net");
const store = require("./store");
const photoBank = require("./client-photo-bank");
const { registrableDomain } = require("./proof-storage");
const {
  REMASTER_PROMPT_SHA256,
  DIRECT_SOURCE_RECIPE_SHA256,
  SEEDANCE_RECEIPT_SCHEMA,
  SEEDANCE_MODEL_ID,
  SEEDANCE_DURATION_SEC,
  isSeedanceDuration,
  SEEDANCE_MAX_COST_USD,
  MAX_CLIP_BYTES,
  MIN_DURATION_SEC,
  MAX_DURATION_SEC,
  MIN_WIDTH,
  MIN_HEIGHT,
  MAX_EDGE,
  MIN_ASPECT,
  MAX_ASPECT,
  PLAYABLE_MP4_CODECS,
} = require("./hero-clip-validation");
const { normalizeLineHandle } = require("./line-hero-wakeup");
const {
  HERO_JOB_CAPABILITY_GRANT_SCHEMA,
  HERO_JOB_CAPABILITY_LEASE_MARGIN_MS,
  HERO_JOB_CAPABILITY_LEASE_MS,
  heroJobCapabilityGrant,
  heroJobCapabilityLeaseOwner,
  heroJobCapabilityRedemptionSha256,
  sha256Opaque,
} = require("./hero-job-capability");
const {
  WAN_PRODUCER,
  ADS_PRODUCER,
  OPENROUTER_SEEDANCE_PRODUCER,
  DURABLE_HERO_PRODUCERS,
  normalizeWanVertical,
  normalizeDurableHeroProducer,
} = require("./hero-video-policy");
const {
  WAN_MODEL_ID,
  WAN_MODEL_REVISION,
  WAN_REMASTER_RECIPE_SHA256,
  defaultWanGeneration,
  stableSerialize,
} = require("./wan-hero-policy");

const HERO_REEL_JOBS_TABLE = "ghost_agency_hero_reel_jobs";
const PRACTICE_STATIC_SEAL_SCHEMA = "wss.hero.foreign_line_practice_static.v1";
const PRACTICE_STATIC_SEAL_REASON = "foreign_line_practice_static_sealed";
const PRODUCER = WAN_PRODUCER;
const JOB_STATUSES = Object.freeze(["queued", "running", "awaiting_review", "done", "refused", "failed"]);
const SETTLE_ACTIONS = Object.freeze(["complete", "refuse", "fail", "requeue", "hold"]);
const DEFAULT_LEASE_MS = 60 * 60 * 1000;
const MIN_LEASE_MS = 30 * 60 * 1000;
const MAX_LEASE_MS = 2 * 60 * 60 * 1000;
// The queued scan is FIFO, and every scanned candidate runs the per-job
// parent-batch gate. When a wave of old campaigns leaves dozens of queued
// jobs with halted or missing parents ahead of a fresh build, a small fixed
// window starves the live job forever (measured live 2026-08-29: every
// worker wave saw only dead-parent jobs while a building batch's hero sat
// unclaimed for two hours). Scan deep enough to reach past any realistic
// dead-cohort backlog; operators can raise it via env without a deploy.
const CLAIM_SCAN_LIMIT = Math.max(
  25,
  Math.min(500, Number(process.env.GHOST_AGENCY_HERO_CLAIM_SCAN_LIMIT) || 250),
);
const DEFAULT_STORE_WRITE_TIMEOUT_MS = 5_000;
const VERIFIED_UPLOAD_AUTHORITY = Symbol("verified_hero_upload");
const ADS_GENERATOR = "ads_animate_image";
const WAN_RECEIPT_SCHEMA = "wss.hero_generation_receipt.v1";
const MAX_REVIEW_CANDIDATES = 12;
const SEEDANCE_SUBMIT_REVIEW_REASON = "seedance_submit_reconciliation_required";
const SEEDANCE_CHECKPOINT_SCHEMA = "wss.hero.seedance_provider_checkpoint.v1";
const SEEDANCE_SOURCE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const MAX_SEEDANCE_SOURCE_BYTES = 25 * 1024 * 1024;
const DEFAULT_SEEDANCE_ACCEPTED_CLAIM_CAP = 8;
const DEFAULT_SEEDANCE_ACCEPTED_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Seedance accepts portrait, square, and landscape clips throughout generation,
// local staging, boomerang validation, and upload. Settlement must use the same
// range or valid recovered clips can never reach owner review.
const SEEDANCE_MIN_ASPECT = 0.5;
const SEEDANCE_MAX_ASPECT = 4.0;
const SHARED_RELEASE_EVIDENCE_SCHEMA = "shared-site-release-evidence-v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SHARED_HOST_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.wss-ai\.com$/;

function text(value) {
  return String(value || "").trim();
}

function safeText(value, max = 500) {
  return text(value).slice(0, max);
}

function safeSingleLine(value, max = 2000) {
  const cleaned = text(value);
  if (/[\u0000-\u001f\u007f]/.test(cleaned)) return "";
  return cleaned.slice(0, max);
}

function opaqueFingerprint(value) {
  const fingerprint = String(value ?? "");
  if (
    !fingerprint
    || fingerprint !== fingerprint.trim()
    || fingerprint.length > 1200
    || /[\u0000-\u001f\u007f]/.test(fingerprint)
  ) return "";
  return fingerprint;
}

function isBlockedIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && [0, 88, 168].includes(b))
    || (a === 198 && [18, 19, 51].includes(b))
    || (a === 203 && b === 0)
    || a >= 224;
}

function isPublicHttpsUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch { return false; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !host
    || host === "localhost"
    || host === "metadata"
    || host === "metadata.google.internal"
    || /\.(?:localhost|local|internal|lan|home)$/.test(host)
  ) return false;
  const ipVersion = isIP(host);
  if (ipVersion === 0 && !host.includes(".")) return false;
  if (ipVersion === 4) return !isBlockedIpv4(host);
  if (ipVersion === 6) {
    if (
      host === "::"
      || host === "::1"
      || /^f[cd]/.test(host)
      || /^fe[89ab]/.test(host)
      || /^ff/.test(host)
      || /^2001:db8(?::|$)/.test(host)
    ) return false;
    if (host.startsWith("::ffff:")) {
      const mapped = host.slice(7);
      return isIP(mapped) === 4 && !isBlockedIpv4(mapped);
    }
  }
  return true;
}

function isGoogleMediaUrl(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return /(^|\.)(?:googleusercontent|ggpht)\.com$/.test(host);
  } catch {
    return false;
  }
}

function trustedGoogleMapsUrl(value) {
  let parsed;
  try { parsed = new URL(text(value)); } catch { return ""; }
  const host = parsed.hostname.toLowerCase();
  const mapsHost = host === "maps.google.com" || host.endsWith(".maps.google.com");
  const googleMapsPath = /(^|\.)google\.com$/.test(host) && /^\/maps(?:\/|$)/i.test(parsed.pathname);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
    || (!mapsHost && !googleMapsPath)
  ) return "";
  parsed.hash = "";
  return parsed.toString();
}

function googleBusinessUrlsFromRecord(record = {}) {
  const urls = [];
  for (const raw of [
    record.gbp_url,
    record.profile_url,
    record?.mirror_request?.facts?.profile_url,
    record?.build_ready?.mirror_request?.facts?.profile_url,
  ]) {
    const normalized = trustedGoogleMapsUrl(raw);
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  }
  return urls.slice(0, 4);
}

function isPinnedGoogleBusinessFoundOn(value, placeId, allowedUrls = []) {
  const foundOn = text(value);
  const expected = safeText(placeId, 255);
  if (!expected) return false;
  if (foundOn === "google_business_profile") return true;
  const normalized = trustedGoogleMapsUrl(foundOn);
  return Boolean(normalized) && allowedUrls.includes(normalized);
}

function storeWriteOptions(options = {}) {
  const deadlineAt = Number(options.deadlineAt);
  return {
    ...(options.signal ? { signal: options.signal } : {}),
    deadlineAt: Number.isFinite(deadlineAt) && deadlineAt > 0
      ? deadlineAt
      : Date.now() + DEFAULT_STORE_WRITE_TIMEOUT_MS,
  };
}

function safeId(value) {
  const valueText = text(value);
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(valueText) ? valueText : "";
}

function verifiedSharedReleaseReceipt(value, clipSha256, recordWriteId) {
  const shared = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const proof = shared?.proof_identity && typeof shared.proof_identity === "object"
    ? shared.proof_identity
    : {};
  const previous = shared?.previous_proof_identity && typeof shared.previous_proof_identity === "object"
    ? shared.previous_proof_identity
    : {};
  const evidence = shared?.release_evidence && typeof shared.release_evidence === "object"
    ? shared.release_evidence
    : {};
  const siteId = text(proof.site_id);
  const releaseId = text(proof.release_id);
  const buildHash = text(proof.build_hash).toLowerCase();
  const previousReleaseId = text(previous.release_id);
  const previousBuildHash = text(previous.build_hash).toLowerCase();
  const canonicalHost = text(evidence.canonical_host).toLowerCase();
  const heroVideoPath = safeSingleLine(shared?.hero_video_path, 1000);
  const heroVideoSha256 = text(shared?.hero_video_sha256).toLowerCase();
  const generation = Number(evidence.generation);
  const routeGeneration = Number(evidence.route_generation);
  const writeId = safeSingleLine(shared?.record_write_id, 500);
  const lineHandle = shared && Object.hasOwn(shared, "line_handle")
    ? normalizeLineHandle(shared.line_handle)
    : null;
  let preview;
  try { preview = new URL(String(shared?.preview_url || "")); } catch { preview = null; }
  const expectedManifestPath = `sites/${siteId}/releases/${releaseId}/manifest.json`;

  if (!shared
    || !UUID_RE.test(siteId)
    || !UUID_RE.test(releaseId)
    || !SHA256_RE.test(buildHash)
    || text(previous.site_id) !== siteId
    || !UUID_RE.test(previousReleaseId)
    || !SHA256_RE.test(previousBuildHash)
    || previousReleaseId === releaseId
    || previousBuildHash === buildHash
    || evidence.evidence_schema !== SHARED_RELEASE_EVIDENCE_SCHEMA
    || evidence.state !== "active"
    || text(evidence.site_id) !== siteId
    || text(evidence.release_id) !== releaseId
    || text(evidence.build_hash).toLowerCase() !== buildHash
    || !SHARED_HOST_RE.test(canonicalHost)
    || text(evidence.manifest_path) !== expectedManifestPath
    || !SHA256_RE.test(text(evidence.manifest_sha256).toLowerCase())
    || !safeSingleLine(evidence.deployment_env, 120)
    || !Number.isSafeInteger(generation)
    || generation < 1
    || routeGeneration !== generation
    || !preview
    || !isPublicHttpsUrl(preview.href)
    || preview.hostname.toLowerCase() !== canonicalHost
    || preview.pathname !== "/"
    || preview.search
    || preview.hash
    || !heroVideoPath
    || heroVideoPath.startsWith("/")
    || heroVideoPath.split("/").some((part) => !part || part === "." || part === "..")
    || !/\.mp4$/i.test(heroVideoPath)
    || text(evidence.hero_video_path) !== heroVideoPath
    || !SHA256_RE.test(heroVideoSha256)
    || heroVideoSha256 !== clipSha256
    || text(evidence.hero_video_sha256).toLowerCase() !== clipSha256
    || !writeId
    || writeId !== safeSingleLine(recordWriteId, 500)
    || (Object.hasOwn(shared, "line_handle") && !lineHandle)) return null;

  return {
    preview_url: preview.href,
    proof_identity: { site_id: siteId, release_id: releaseId, build_hash: buildHash },
    previous_proof_identity: {
      site_id: siteId,
      release_id: previousReleaseId,
      build_hash: previousBuildHash,
    },
    release_evidence: withoutLeaseSecrets(evidence),
    hero_video_path: heroVideoPath,
    hero_video_sha256: heroVideoSha256,
    record_write_id: writeId,
    ...(lineHandle ? { line_handle: lineHandle } : {}),
  };
}

function asDate(value, fallback = new Date()) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function leaseMs(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LEASE_MS;
  return Math.max(MIN_LEASE_MS, Math.min(parsed, MAX_LEASE_MS));
}

function newJobId() {
  return `hrj_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function rowsOf(result) {
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.rows)) return result.rows;
  if (Array.isArray(result?.row)) return result.row;
  if (result?.row && typeof result.row === "object") return [result.row];
  return [];
}

function recordOf(row = {}) {
  return row && row.record && typeof row.record === "object" ? row.record : {};
}

/** The client's legacy site, never a WSS mirror or an unparseable label. */
function legacySiteUrl(record = {}) {
  const candidates = [
    ["mirror_request.facts.current_website", record?.mirror_request?.facts?.current_website],
    ["build_ready.mirror_request.facts.current_website", record?.build_ready?.mirror_request?.facts?.current_website],
    ["build_ready.discovery.url", record?.build_ready?.discovery?.url],
    ["discovery.url", record?.discovery?.url],
    ["current_website", record?.current_website],
  ];
  const rejected = [];
  for (const [from, raw] of candidates) {
    const value = text(raw);
    if (!value) continue;
    let parsed;
    try { parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); }
    catch { rejected.push(`${from}=unparseable`); continue; }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      rejected.push(`${from}=unsupported_protocol`);
      continue;
    }
    if (/(^|\.)wss-ai\.com$/i.test(parsed.hostname)) {
      rejected.push(`${from}=our_own_mirror`);
      continue;
    }
    if (!parsed.hostname.includes(".")) {
      rejected.push(`${from}=not_a_hostname`);
      continue;
    }
    // The worker's durable identity contract is HTTPS-only. It does not fetch
    // this page; owned source bytes still carry their separately pinned URL.
    parsed.protocol = "https:";
    parsed.port = "";
    return { ok: true, url: parsed.toString(), from };
  }
  return {
    ok: false,
    reason: "no_legacy_site_url",
    detail: rejected.length ? rejected.join(", ") : "no current_website / discovery url on the record",
  };
}

function siteSlug(row = {}) {
  const record = recordOf(row);
  for (const value of [record.preview_url, row.preview_url]) {
    const match = text(value).match(/^https:\/\/([a-z0-9-]+)\.wss-ai\.com(?:\/|$)/i);
    if (match) return match[1].toLowerCase();
  }
  return text(row.prospect_id || row.prospectId || row.id)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-prospect";
}

function normalizedPhotoBank(record = {}, sourceUrl = "", at = new Date()) {
  const bank = photoBank.bankFromRecord(record);
  const photos = [];
  const sourceDomain = registrableDomain(sourceUrl);
  const bankDomain = registrableDomain(bank?.website);
  const recordPlaceId = safeText(photoBank.placeIdFromRecord(record), 255);
  const bankPlaceId = safeText(bank?.place_id, 255);
  const gbpProfileUrls = googleBusinessUrlsFromRecord(record);
  for (const raw of Array.isArray(bank?.photos) ? bank.photos : []) {
    if (!raw || typeof raw !== "object") continue;
    const url = text(raw.url);
    const source = text(raw.source);
    const foundOn = text(raw.found_on);
    const sha256 = text(raw.sha256).toLowerCase();
    const gbpResource = source === "gbp"
      ? photoBank.parsePlacePhotoResourceName(raw.resource_name)
      : null;
    const assetType = photoBank.classifiedAssetType(raw, { deriveOwnSiteScene: source === "own_site" });
    // These values are written only after the client-photo-bank ownership
    // gate. Do not turn an unknown source into a candidate by guessing.
    if (
      !isPublicHttpsUrl(url)
      || !["own_site", "gbp"].includes(source)
      || !foundOn
      || !/^[0-9a-f]{64}$/.test(sha256)
    ) continue;
    if (source === "own_site" && (
      !sourceDomain
      || bankDomain !== sourceDomain
      || registrableDomain(foundOn) !== sourceDomain
    )) continue;
    if (source === "gbp" && (
      !isPinnedGoogleBusinessFoundOn(foundOn, recordPlaceId, gbpProfileUrls)
      || !isGoogleMediaUrl(url)
      || !recordPlaceId
      || bankPlaceId !== recordPlaceId
      || safeText(raw.place_id, 255) !== recordPlaceId
      || !gbpResource
      || gbpResource.place_id !== recordPlaceId
    )) continue;
    photos.push({
      url,
      source,
      found_on: foundOn,
      sha256,
      ...(source === "gbp" ? { place_id: recordPlaceId } : {}),
      ...(source === "gbp" ? { resource_name: gbpResource.resource_name } : {}),
      ...(Number(raw.width) > 0 ? { width: Number(raw.width) } : {}),
      ...(Number(raw.height) > 0 ? { height: Number(raw.height) } : {}),
      ...(Number(raw.bytes) > 0 ? { bytes: Number(raw.bytes) } : {}),
      ...(text(raw.ext) ? { ext: text(raw.ext).toLowerCase() } : {}),
      ...(text(raw.grade) ? { grade: text(raw.grade) } : {}),
      ...(text(raw.grade_why) ? { grade_why: safeText(raw.grade_why, 160) } : {}),
      ...(Number.isFinite(Number(raw.rank)) ? { rank: Number(raw.rank) } : {}),
      ...(raw.stock_caption_suspect === true ? { stock_caption_suspect: true } : {}),
      ...(raw.current_hero === true ? { current_hero: true } : {}),
      ...(raw.identity_critical === true ? { identity_critical: true } : {}),
      ...(raw.logo_like === true ? { logo_like: true } : {}),
      ...(assetType ? { asset_type: assetType } : {}),
    });
  }
  const fingerprint = photos.length
    ? createHash("sha256").update(JSON.stringify({
      website: text(bank?.website),
      place_id: recordPlaceId && bankPlaceId === recordPlaceId ? recordPlaceId : "",
      photos: photos.map((photo, position) => ({
        position,
        url: photo.url,
        source: photo.source,
        found_on: photo.found_on,
        place_id: photo.place_id || "",
        resource_name: photo.resource_name || "",
        sha256: photo.sha256,
        rank: Number.isFinite(photo.rank) ? photo.rank : null,
        grade: photo.grade || "",
        stock_caption_suspect: photo.stock_caption_suspect === true,
        current_hero: photo.current_hero === true,
        identity_critical: photo.identity_critical === true,
        logo_like: photo.logo_like === true,
        asset_type: photo.asset_type || "",
      })),
    })).digest("hex")
    : "";
  return {
    version: Number(bank?.version) || 0,
    harvested_at: text(bank?.harvested_at) || null,
    website: text(bank?.website) || "",
    ...(recordPlaceId && bankPlaceId === recordPlaceId ? { place_id: recordPlaceId } : {}),
    ...(gbpProfileUrls.length ? { gbp_profile_urls: gbpProfileUrls } : {}),
    fingerprint,
    fresh: (() => {
      const checkedAt = asDate(at).getTime();
      const harvested = Date.parse(text(bank?.harvested_at));
      return Number.isFinite(harvested)
        && harvested <= checkedAt + 5 * 60 * 1000
        && photoBank.bankIsFresh(bank, { now: () => checkedAt });
    })(),
    photos: photos.slice(0, 64),
  };
}

function sourceFingerprint(sourceUrl, bank) {
  const identities = (bank?.photos || []).map((photo, position) => ({
    position,
    url: text(photo?.url),
    source: text(photo?.source),
    found_on: text(photo?.found_on),
    place_id: safeText(photo?.place_id, 255),
    resource_name: safeSingleLine(photo?.resource_name, 500),
    sha256: text(photo?.sha256).toLowerCase(),
    rank: Number.isFinite(Number(photo?.rank)) ? Number(photo.rank) : null,
    grade: text(photo?.grade),
    stock_caption_suspect: photo?.stock_caption_suspect === true,
    current_hero: photo?.current_hero === true,
    identity_critical: photo?.identity_critical === true,
    logo_like: photo?.logo_like === true,
    asset_type: text(photo?.asset_type),
  }));
  return createHash("sha256")
    .update(JSON.stringify({
      source_url: text(sourceUrl),
      bank_website: text(bank?.website),
      bank_place_id: safeText(bank?.place_id, 255),
      photos: identities,
    }))
    .digest("hex");
}

function generationRevision(payload = {}) {
  const value = Number(payload.generation_revision);
  return Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER ? value : 1;
}

function seedanceDuration(value) {
  const duration = Number(value);
  return isSeedanceDuration(duration) ? duration : null;
}

function frozenSeedanceDuration(job) {
  return seedanceDuration(job?.payload?.duration_seconds);
}

function lineSameBuildReofferCount(payload = {}) {
  const value = payload?.line_same_build_reoffer_count;
  if (value == null) return 0;
  return value === 1 ? 1 : -1;
}

const REPAIRABLE_SAME_BUILD_REOFFER_REASONS = new Set([
  "no_verified_owned_real_scene",
  "source_sha256_mismatch",
  "photo_bank_stale_or_missing",
]);

const WAN_FALLBACK_TECHNICAL_REASONS = Object.freeze([
  "local_model_directory_required",
  "wan_i2v_script_required",
  "python_executable_invalid",
  "ffmpeg_executable_invalid",
  "ffprobe_executable_invalid",
  "estimated_power_watts_required",
  "electricity_rate_required",
  "wan_timeout_invalid",
]);

function exactSourceDomain(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function boundedNumber(value, max, integer = false) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max || (integer && !Number.isInteger(parsed))) return null;
  return parsed;
}

function exactWanContract(job = {}) {
  if (job.producer !== WAN_PRODUCER) return null;
  const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
  const wan = payload.wan && typeof payload.wan === "object" ? payload.wan : null;
  const vertical = normalizeWanVertical(payload.vertical || wan?.vertical);
  if (!wan || !vertical || wan.vertical !== vertical) return null;
  const expected = defaultWanGeneration({
    prospectId: job.prospectId,
    vertical,
    preset: wan.preset,
    overlaySide: wan.overlaySide,
  });
  if (!expected) return null;
  try {
    return stableSerialize(wan) === stableSerialize(expected) ? expected : null;
  } catch {
    return null;
  }
}

function wanGenerationReceipt(verdict, job, artifact, sourcePhoto, expectedGenerator, expectedRecipe) {
  const direct = verdict.generation_receipt;
  const nested = verdict.approved_artifact?.generation_receipt;
  const input = direct && typeof direct === "object" && !Array.isArray(direct)
    ? direct
    : nested && typeof nested === "object" && !Array.isArray(nested)
      ? nested
      : null;
  const wan = exactWanContract(job);
  if (!input || !wan) return { ok: false, error: "wan_generation_receipt_required" };
  const source = input.source && typeof input.source === "object" ? input.source : {
    prospect_id: input.prospect_id,
    domain: input.domain,
    type: input.source_type,
    asset_type: input.source_asset_type,
    raw_sha256: input.source_sha256 || input.raw_sha256,
  };
  const artifacts = input.artifacts && typeof input.artifacts === "object" ? input.artifacts : {
    raw_sha256: input.raw_sha256,
    optimized_sha256: input.optimized_sha256,
    master_sha256: input.master_sha256,
    clip_sha256: input.clip_sha256,
    recipe_sha256: input.recipe_sha256,
  };
  const model = input.model && typeof input.model === "object" ? input.model : {
    id: input.model_id,
    revision: input.model_revision,
    settings: input.model_settings,
  };
  const metrics = input.metrics && typeof input.metrics === "object" ? input.metrics : input;
  const energy = metrics.energy && typeof metrics.energy === "object" ? metrics.energy : {
    estimated_power_watts: input.estimated_power_watts,
    estimated_kwh: input.energy_kwh,
    gpu_telemetry: input.gpu_telemetry,
  };
  const fallback = input.fallback && typeof input.fallback === "object" ? input.fallback : input.fallback_used === true
    ? {
      used: true,
      from: input.fallback_from,
      to: input.fallback_to,
      reason: input.fallback_reason,
    }
    : null;
  const sourceDomain = exactSourceDomain(job.payload?.source_url);
  const requestedProducer = text(input.requested_producer || input.producer);
  const actualGenerator = text(input.generator || input.actual_generator);
  const sourceProspect = safeId(source.prospect_id || source.prospectId);
  const sourceType = text(source.type);
  const sourceAssetType = text(source.asset_type || source.assetType);
  const sourceSha = text(source.raw_sha256 || source.sha256).toLowerCase();
  let settingsMatch = false;
  let settingsSha256 = "";
  try {
    const expectedSettings = stableSerialize(wan.modelSettings);
    settingsMatch = stableSerialize(model.settings) === expectedSettings;
    settingsSha256 = createHash("sha256").update(expectedSettings).digest("hex");
  } catch {
    settingsMatch = false;
  }
  if (
    text(input.schema_version) !== WAN_RECEIPT_SCHEMA
    || requestedProducer !== WAN_PRODUCER
    || actualGenerator !== expectedGenerator
    || text(verdict.producer) !== WAN_PRODUCER
    || text(verdict.generator) !== expectedGenerator
    || sourceProspect !== job.prospectId
    || text(source.domain).toLowerCase() !== sourceDomain
    || sourceType !== text(sourcePhoto?.source)
    || sourceAssetType !== "real_scene"
    || sourceSha !== artifact.raw_sha256
    || text(artifacts.raw_sha256).toLowerCase() !== artifact.raw_sha256
    || text(artifacts.optimized_sha256).toLowerCase() !== artifact.optimized_sha256
    || text(artifacts.clip_sha256).toLowerCase() !== artifact.clip_sha256
    || text(artifacts.recipe_sha256).toLowerCase() !== expectedRecipe
    || text(model.id) !== WAN_MODEL_ID
    || text(model.revision) !== WAN_MODEL_REVISION
    || !settingsMatch
  ) return { ok: false, error: "wan_generation_receipt_mismatch" };

  const masterSha256 = text(artifacts.master_sha256).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(masterSha256)) {
    return { ok: false, error: "wan_master_sha256_invalid" };
  }

  if (expectedGenerator === WAN_PRODUCER) {
    if (fallback && fallback.used === true) return { ok: false, error: "wan_fallback_receipt_unexpected" };
  } else {
    const reason = text(fallback?.reason || input.fallback_reason);
    if (
      fallback?.used !== true
      || text(fallback.from || input.fallback_from) !== WAN_PRODUCER
      || text(fallback.to || input.fallback_to) !== ADS_PRODUCER
      || !WAN_FALLBACK_TECHNICAL_REASONS.includes(reason)
    ) return { ok: false, error: "wan_fallback_receipt_invalid" };
  }

  const wallTimeMs = boundedNumber(metrics.wall_time_ms ?? metrics.wallTimeMs, 24 * 60 * 60 * 1000, true);
  const generationTimeMs = boundedNumber(metrics.generation_time_ms ?? metrics.generationTimeMs, 24 * 60 * 60 * 1000, true);
  const estimatedPowerWatts = boundedNumber(energy.estimated_power_watts ?? energy.estimatedPowerWatts, 5_000);
  const energyKwh = boundedNumber(energy.estimated_kwh ?? energy.estimatedKwh, 100);
  const rate = boundedNumber(metrics.electricity_rate_usd_per_kwh ?? metrics.electricityRateUsdPerKwh, 100);
  const costUsd = boundedNumber(
    metrics.estimated_electricity_cost_usd ?? metrics.estimatedElectricityCostUsd ?? metrics.cost_usd,
    1_000,
  );
  if ([wallTimeMs, generationTimeMs, estimatedPowerWatts, energyKwh, rate, costUsd].some((value) => value === null)
    || generationTimeMs > wallTimeMs) {
    return { ok: false, error: "wan_generation_telemetry_invalid" };
  }

  const gpuInput = energy.gpu_telemetry && typeof energy.gpu_telemetry === "object"
    ? energy.gpu_telemetry
    : energy.gpuTelemetry && typeof energy.gpuTelemetry === "object"
      ? energy.gpuTelemetry
      : {};
  const gpuFields = {
    samples: boundedNumber(gpuInput.samples, 10_000_000, true),
    avg_power_watts: boundedNumber(gpuInput.avg_power_watts ?? gpuInput.avgPowerWatts, 5_000),
    peak_power_watts: boundedNumber(gpuInput.peak_power_watts ?? gpuInput.peakPowerWatts, 5_000),
    energy_kwh: boundedNumber(gpuInput.energy_kwh ?? gpuInput.energyKwh, 100),
    peak_vram_mib: boundedNumber(gpuInput.peak_vram_mib ?? gpuInput.peakVramMiB, 1_000_000),
  };
  const suppliedGpuTelemetry = Object.keys(gpuInput).length > 0;
  if (suppliedGpuTelemetry && Object.values(gpuFields).some((value) => value === null)) {
    return { ok: false, error: "wan_gpu_telemetry_invalid" };
  }
  const fallbackReason = expectedGenerator === ADS_GENERATOR
    ? text(fallback.reason || input.fallback_reason)
    : "";
  return {
    ok: true,
    receipt: {
      schema_version: WAN_RECEIPT_SCHEMA,
      producer: WAN_PRODUCER,
      generator: expectedGenerator,
      prospect_id: job.prospectId,
      domain: sourceDomain,
      source_type: sourceType,
      source_asset_type: "real_scene",
      source_sha256: artifact.raw_sha256,
      raw_sha256: artifact.raw_sha256,
      optimized_sha256: artifact.optimized_sha256,
      master_sha256: masterSha256,
      clip_sha256: artifact.clip_sha256,
      recipe_sha256: expectedRecipe,
      model_id: WAN_MODEL_ID,
      model_revision: WAN_MODEL_REVISION,
      model_settings: wan.modelSettings,
      model_settings_sha256: settingsSha256,
      wall_time_ms: wallTimeMs,
      generation_time_ms: generationTimeMs,
      estimated_power_watts: estimatedPowerWatts,
      energy_kwh: energyKwh,
      electricity_rate_usd_per_kwh: rate,
      cost_usd: costUsd,
      ...(suppliedGpuTelemetry ? { gpu_telemetry: gpuFields } : {}),
      ...(fallbackReason ? {
        fallback_used: true,
        fallback_from: WAN_PRODUCER,
        fallback_to: ADS_PRODUCER,
        fallback_reason: fallbackReason,
      } : {}),
    },
  };
}

function seedanceGenerationReceipt(verdict, job, artifact, sourcePhoto, expectedRecipe) {
  const input = verdict.generation_receipt
    || verdict.approved_artifact?.generation_receipt;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "seedance_generation_receipt_required" };
  }
  const wallTimeMs = boundedNumber(input.wall_time_ms, 24 * 60 * 60 * 1000, true);
  const generationTimeMs = boundedNumber(input.generation_time_ms, 24 * 60 * 60 * 1000, true);
  const costUsd = boundedNumber(input.cost_usd, 1_000);
  const durationSeconds = boundedNumber(input.duration_seconds, MAX_DURATION_SEC);
  const expectedDuration = frozenSeedanceDuration(job);
  const sourceDomain = exactSourceDomain(job.payload?.source_url);
  if (
    text(input.schema_version) !== SEEDANCE_RECEIPT_SCHEMA
    || text(input.producer) !== OPENROUTER_SEEDANCE_PRODUCER
    || text(input.generator) !== OPENROUTER_SEEDANCE_PRODUCER
    || text(input.model_id) !== SEEDANCE_MODEL_ID
    || safeId(input.prospect_id) !== job.prospectId
    || text(input.domain).toLowerCase() !== sourceDomain
    || text(input.source_type) !== text(sourcePhoto?.source)
    || text(input.source_asset_type) !== "real_scene"
    || text(input.source_sha256 || input.raw_sha256).toLowerCase() !== artifact.raw_sha256
    || text(input.raw_sha256).toLowerCase() !== artifact.raw_sha256
    || text(input.optimized_sha256).toLowerCase() !== artifact.optimized_sha256
    || text(input.clip_sha256).toLowerCase() !== artifact.clip_sha256
    || text(input.recipe_sha256).toLowerCase() !== expectedRecipe
    || wallTimeMs === null
    || generationTimeMs === null
    || generationTimeMs > wallTimeMs
    || costUsd === null
    || costUsd <= 0
    || costUsd > SEEDANCE_MAX_COST_USD
    || durationSeconds === null
    || expectedDuration === null
    || Math.abs(durationSeconds - expectedDuration) > 0.15
    || input.generate_audio !== false
  ) return { ok: false, error: "seedance_generation_receipt_mismatch" };
  return {
    ok: true,
    receipt: {
      schema_version: SEEDANCE_RECEIPT_SCHEMA,
      producer: OPENROUTER_SEEDANCE_PRODUCER,
      generator: OPENROUTER_SEEDANCE_PRODUCER,
      prospect_id: job.prospectId,
      domain: sourceDomain,
      source_type: text(sourcePhoto.source),
      source_asset_type: "real_scene",
      source_sha256: artifact.raw_sha256,
      raw_sha256: artifact.raw_sha256,
      optimized_sha256: artifact.optimized_sha256,
      clip_sha256: artifact.clip_sha256,
      recipe_sha256: expectedRecipe,
      model_id: SEEDANCE_MODEL_ID,
      duration_seconds: durationSeconds,
      generate_audio: false,
      wall_time_ms: wallTimeMs,
      generation_time_ms: generationTimeMs,
      cost_usd: costUsd,
    },
  };
}

function payloadHasVerifiedPhoto(payload = {}, at = new Date()) {
  const bank = payload.photo_bank && typeof payload.photo_bank === "object" ? payload.photo_bank : {};
  const harvested = Date.parse(text(bank.harvested_at));
  const nowMs = asDate(at).getTime();
  if (!Number.isFinite(harvested) || harvested > nowMs + 5 * 60 * 1000 || nowMs - harvested > 30 * 86_400_000) {
    return false;
  }
  const sourceDomain = registrableDomain(payload.source_url);
  const bankDomain = registrableDomain(bank.website);
  const payloadPlaceId = safeText(payload.place_id, 255);
  const bankPlaceId = safeText(bank.place_id, 255);
  return Array.isArray(bank.photos) && bank.photos.some((photo) => {
    const url = text(photo?.url);
    const source = text(photo?.source);
    const foundOn = text(photo?.found_on);
    const resource = source === "gbp"
      ? photoBank.parsePlacePhotoResourceName(photo?.resource_name)
      : null;
    if (!isPublicHttpsUrl(url) || !/^[0-9a-f]{64}$/i.test(text(photo?.sha256))) return false;
    if (source === "gbp") return isPinnedGoogleBusinessFoundOn(foundOn, payloadPlaceId, Array.isArray(bank.gbp_profile_urls) ? bank.gbp_profile_urls : [])
      && isGoogleMediaUrl(url)
      && Boolean(payloadPlaceId)
      && bankPlaceId === payloadPlaceId
      && safeText(photo?.place_id, 255) === payloadPlaceId
      && Boolean(resource)
      && resource.place_id === payloadPlaceId;
    return source === "own_site"
      && Boolean(sourceDomain)
      && bankDomain === sourceDomain
      && registrableDomain(foundOn) === sourceDomain;
  });
}

function approvedArtifactFromVerdict(verdict = {}, job = {}) {
  const expectedRevision = generationRevision(job.payload);
  const receivedRevision = Number(verdict.generation_revision);
  if (!Number.isInteger(receivedRevision) || receivedRevision !== expectedRevision) {
    return { ok: false, error: "generation_revision_mismatch" };
  }
  const nested = verdict.approved_artifact && typeof verdict.approved_artifact === "object"
    ? verdict.approved_artifact
    : {};
  const optimizedInput = verdict.optimized_asset && typeof verdict.optimized_asset === "object"
    ? verdict.optimized_asset
    : {};
  const producer = text(job.producer) || PRODUCER;
  const generator = text(verdict.generator);
  const wanFallback = producer === WAN_PRODUCER && generator === ADS_GENERATOR;
  const expectedGenerator = producer === WAN_PRODUCER && !wanFallback
    ? WAN_PRODUCER
    : producer === OPENROUTER_SEEDANCE_PRODUCER
      ? OPENROUTER_SEEDANCE_PRODUCER
      : ADS_GENERATOR;
  if (
    !DURABLE_HERO_PRODUCERS.includes(producer)
    || text(verdict.producer) !== producer
    || generator !== expectedGenerator
  ) return { ok: false, error: "clip_generator_mismatch" };
  const fingerprint = opaqueFingerprint(
    nested.optimized_asset_fingerprint
    || verdict.optimized_asset_fingerprint
    || optimizedInput.url_fingerprint,
  );
  const artifact = {
    raw_sha256: text(nested.raw_sha256 || verdict.raw_sha256 || verdict.source_sha256).toLowerCase(),
    source_url: text(nested.source_url || verdict.source_url),
    clip_sha256: text(nested.clip_sha256 || verdict.clip_sha256).toLowerCase(),
    optimized_sha256: text(nested.optimized_sha256 || verdict.optimized_sha256 || optimizedInput.sha256).toLowerCase(),
    optimized_asset_fingerprint: fingerprint,
    prompt_sha256: text(nested.prompt_sha256 || verdict.prompt_sha256 || optimizedInput.prompt_sha256).toLowerCase(),
    producer,
    generator,
  };
  const imagePreparationInputs = [
    nested.image_preparation,
    nested.imagePreparation,
    verdict.image_preparation,
    verdict.imagePreparation,
    optimizedInput.image_preparation,
    optimizedInput.imagePreparation,
  ].map(text).filter(Boolean);
  const directSourceMarker = [ADS_PRODUCER, OPENROUTER_SEEDANCE_PRODUCER].includes(producer) && (
    artifact.prompt_sha256 === DIRECT_SOURCE_RECIPE_SHA256
    || artifact.optimized_asset_fingerprint.startsWith("direct-source:")
  );
  const expectedImagePreparation = directSourceMarker ? "direct_client_photo" : "image_editor";
  const expectedRecipe = producer === WAN_PRODUCER && !wanFallback
    ? WAN_REMASTER_RECIPE_SHA256
    : directSourceMarker
      ? DIRECT_SOURCE_RECIPE_SHA256
      : REMASTER_PROMPT_SHA256;
  for (const key of ["raw_sha256", "clip_sha256", "optimized_sha256", "prompt_sha256"]) {
    if (!/^[0-9a-f]{64}$/.test(artifact[key])) return { ok: false, error: `invalid_${key}` };
  }
  if (!artifact.optimized_asset_fingerprint) {
    return { ok: false, error: "invalid_optimized_asset_fingerprint" };
  }
  if (artifact.prompt_sha256 !== expectedRecipe
    || text(verdict.canonical_recipe_sha256 || artifact.prompt_sha256).toLowerCase() !== expectedRecipe) {
    return { ok: false, error: "noncanonical_remaster_prompt" };
  }
  if ([ADS_PRODUCER, OPENROUTER_SEEDANCE_PRODUCER].includes(producer)) {
    if (imagePreparationInputs.some((value) => value !== expectedImagePreparation)) {
      return { ok: false, error: "image_preparation_mismatch" };
    }
    artifact.image_preparation = expectedImagePreparation;
  }
  if (!/^https:\/\//i.test(artifact.source_url)) return { ok: false, error: "invalid_source_url" };
  if (directSourceMarker) {
    if (
      artifact.optimized_sha256 !== artifact.raw_sha256
      || artifact.optimized_asset_fingerprint !== `direct-source:${artifact.raw_sha256}`
    ) return { ok: false, error: "direct_source_receipt_mismatch" };
  } else if (artifact.optimized_sha256 === artifact.raw_sha256) {
    return { ok: false, error: "optimized_asset_not_distinct" };
  }
  if (
    optimizedInput.sha256 && text(optimizedInput.sha256).toLowerCase() !== artifact.optimized_sha256
    || optimizedInput.url_fingerprint
      && opaqueFingerprint(optimizedInput.url_fingerprint) !== artifact.optimized_asset_fingerprint
    || optimizedInput.prompt_sha256
      && text(optimizedInput.prompt_sha256).toLowerCase() !== artifact.prompt_sha256
  ) {
    return { ok: false, error: "optimized_asset_receipt_mismatch" };
  }
  const width = Number(optimizedInput.width || verdict.optimized_width);
  const height = Number(optimizedInput.height || verdict.optimized_height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20_000 || height > 20_000) {
    return { ok: false, error: "optimized_asset_dimensions_invalid" };
  }
  const sourcePhoto = job.payload?.photo_bank?.photos?.find((photo) => (
    text(photo?.sha256).toLowerCase() === artifact.raw_sha256
    && text(photo?.url) === artifact.source_url
  ));
  if (!sourcePhoto) return { ok: false, error: "source_photo_provenance_mismatch" };
  if ([WAN_PRODUCER, OPENROUTER_SEEDANCE_PRODUCER].includes(producer) && sourcePhoto.asset_type !== "real_scene") {
    return { ok: false, error: "source_asset_not_real_scene" };
  }
  let generationReceipt = null;
  if (producer === WAN_PRODUCER) {
    const validated = wanGenerationReceipt(
      verdict,
      job,
      artifact,
      sourcePhoto,
      expectedGenerator,
      expectedRecipe,
    );
    if (!validated.ok) return validated;
    generationReceipt = validated.receipt;
    artifact.generation_receipt = generationReceipt;
  } else if (producer === OPENROUTER_SEEDANCE_PRODUCER) {
    const validated = seedanceGenerationReceipt(
      verdict,
      job,
      artifact,
      sourcePhoto,
      expectedRecipe,
    );
    if (!validated.ok) return validated;
    generationReceipt = validated.receipt;
    artifact.generation_receipt = generationReceipt;
  }
  return {
    ok: true,
    artifact,
    optimizedAsset: {
      sha256: artifact.optimized_sha256,
      url_fingerprint: artifact.optimized_asset_fingerprint,
      width,
      height,
      prompt_sha256: artifact.prompt_sha256,
      ...([ADS_PRODUCER, OPENROUTER_SEEDANCE_PRODUCER].includes(producer)
        ? { image_preparation: artifact.image_preparation }
        : {}),
    },
    generationRevision: expectedRevision,
    ...(generationReceipt ? { generationReceipt } : {}),
  };
}

function candidateAspectRange(producer = "") {
  return producer === OPENROUTER_SEEDANCE_PRODUCER
    ? { min: SEEDANCE_MIN_ASPECT, max: SEEDANCE_MAX_ASPECT }
    : { min: MIN_ASPECT, max: MAX_ASPECT };
}

function reviewCandidateMetadata(raw = {}, aspectRange = { min: MIN_ASPECT, max: MAX_ASPECT }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const sha256 = text(raw.sha256 || raw.clip_sha256).toLowerCase();
  const bytes = Number(raw.bytes);
  const durationSeconds = Number(raw.durationSeconds ?? raw.duration_seconds);
  const width = Number(raw.width);
  const height = Number(raw.height);
  const codec = safeSingleLine(raw.codec, 12).toLowerCase();
  const aspect = width / height;
  if (
    !/^[0-9a-f]{64}$/.test(sha256)
    || !Number.isInteger(bytes) || bytes < 1 || bytes > MAX_CLIP_BYTES
    || !Number.isFinite(durationSeconds) || durationSeconds < MIN_DURATION_SEC || durationSeconds > MAX_DURATION_SEC
    || !Number.isInteger(width) || width < MIN_WIDTH || width > MAX_EDGE
    || !Number.isInteger(height) || height < MIN_HEIGHT || height > MAX_EDGE
    || aspect < aspectRange.min || aspect > aspectRange.max
    || !PLAYABLE_MP4_CODECS.has(codec)
  ) return null;
  return { sha256, bytes, durationSeconds, width, height, codec };
}

function reviewCandidatesFromVerdict(verdict = {}, job = {}) {
  if (!Object.prototype.hasOwnProperty.call(verdict, "candidates")) {
    return { ok: true, candidates: null, candidateSetSha256: "" };
  }
  if (
    !Array.isArray(verdict.candidates)
    || verdict.candidates.length < 1
    || verdict.candidates.length > MAX_REVIEW_CANDIDATES
  ) return { ok: false, error: "review_candidates_invalid" };

  const seen = new Set();
  const aspectRange = candidateAspectRange(job.producer);
  const candidates = [];
  for (const raw of verdict.candidates) {
    const metadata = reviewCandidateMetadata(raw, aspectRange);
    if (!metadata || seen.has(metadata.sha256)) {
      return { ok: false, error: "review_candidate_invalid" };
    }
    const rawArtifact = raw.approved_artifact;
    if (!rawArtifact || typeof rawArtifact !== "object" || Array.isArray(rawArtifact)) {
      return { ok: false, error: "review_candidate_artifact_required" };
    }
    const candidateVerdict = {
      ...verdict,
      clip_sha256: metadata.sha256,
      approved_artifact: rawArtifact,
      producer: text(rawArtifact.producer || verdict.producer),
      generator: text(rawArtifact.generator || verdict.generator),
      generation_receipt: rawArtifact.generation_receipt || verdict.generation_receipt,
    };
    delete candidateVerdict.candidates;
    const receipt = approvedArtifactFromVerdict(candidateVerdict, job);
    if (!receipt.ok || receipt.artifact.clip_sha256 !== metadata.sha256) {
      return {
        ok: false,
        error: "review_candidate_artifact_invalid",
        ...(receipt.error ? { detail: receipt.error } : {}),
      };
    }
    seen.add(metadata.sha256);
    candidates.push({ ...metadata, approved_artifact: receipt.artifact });
  }

  let serialized;
  try {
    serialized = stableSerialize(candidates);
  } catch {
    return { ok: false, error: "review_candidates_invalid" };
  }
  return {
    ok: true,
    candidates,
    candidateSetSha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

function publicReviewCandidates(value, aspectRange = { min: MIN_ASPECT, max: MAX_ASPECT }) {
  if (!Array.isArray(value)) return [];
  const candidates = [];
  const seen = new Set();
  for (const raw of value.slice(0, MAX_REVIEW_CANDIDATES)) {
    const metadata = reviewCandidateMetadata(raw, aspectRange);
    if (!metadata || seen.has(metadata.sha256)) continue;
    seen.add(metadata.sha256);
    candidates.push(metadata);
  }
  return candidates;
}

function storedCapabilityGrant(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const phase = text(value.phase);
  const grant = {
    schema: text(value.schema),
    phase,
    job_id: safeId(value.job_id),
    prospect_id: safeId(value.prospect_id),
    producer: text(value.producer),
    generation_revision: Number(value.generation_revision),
    attempt: Number(value.attempt),
    jti_sha256: text(value.jti_sha256).toLowerCase(),
    iat: Number(value.iat),
    nbf: Number(value.nbf),
    exp: Number(value.exp),
    batch_id: text(value.batch_id),
    row_id: text(value.row_id),
    ...(phase === "upload" ? { approved_sha256: text(value.approved_sha256).toLowerCase() } : {}),
    redemption_sha256: value.redemption_sha256 === null
      ? null
      : text(value.redemption_sha256).toLowerCase(),
    redeemed_at: value.redeemed_at === null ? null : text(value.redeemed_at),
    redeemed_lease_sha256: value.redeemed_lease_sha256 === null
      ? null
      : text(value.redeemed_lease_sha256).toLowerCase(),
  };
  const expectedKeys = phase === "upload"
    ? [
      "schema", "phase", "job_id", "prospect_id", "producer", "generation_revision", "attempt",
      "jti_sha256", "iat", "nbf", "exp", "batch_id", "row_id", "approved_sha256",
      "redemption_sha256", "redeemed_at", "redeemed_lease_sha256",
    ]
    : [
      "schema", "phase", "job_id", "prospect_id", "producer", "generation_revision", "attempt",
      "jti_sha256", "iat", "nbf", "exp", "batch_id", "row_id", "redemption_sha256",
      "redeemed_at", "redeemed_lease_sha256",
    ];
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length
    || actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
    || grant.schema !== HERO_JOB_CAPABILITY_GRANT_SCHEMA
    || !Object.hasOwn(HERO_JOB_CAPABILITY_LEASE_MS, phase)
    || !grant.job_id
    || !grant.prospect_id
    || grant.producer !== OPENROUTER_SEEDANCE_PRODUCER
    || !Number.isSafeInteger(grant.generation_revision)
    || grant.generation_revision < 1
    || !Number.isSafeInteger(grant.attempt)
    || grant.attempt < 0
    || !SHA256_RE.test(grant.jti_sha256)
    || !Number.isSafeInteger(grant.iat)
    || !Number.isSafeInteger(grant.nbf)
    || !Number.isSafeInteger(grant.exp)
    || grant.exp <= grant.nbf
    || !normalizeLineHandle({ batchId: grant.batch_id, rowId: grant.row_id })
    || (phase === "upload" && !SHA256_RE.test(grant.approved_sha256))
    || (grant.redemption_sha256 !== null && !SHA256_RE.test(grant.redemption_sha256))
    || (grant.redeemed_at !== null && !Number.isFinite(Date.parse(grant.redeemed_at)))
    || (grant.redeemed_lease_sha256 !== null && !SHA256_RE.test(grant.redeemed_lease_sha256))
    || (grant.redeemed_at === null) !== (grant.redeemed_lease_sha256 === null)
    || (grant.redeemed_at === null) !== (grant.redemption_sha256 === null)
  ) return null;
  return grant;
}

function capabilityGrantForJob(job) {
  return storedCapabilityGrant(job?.payload?.hero_job_capability_grant);
}

function sameCapabilityGrant(left, right) {
  try { return stableSerialize(left) === stableSerialize(right); } catch { return false; }
}

function sameCapabilityGrantIdentity(left, right) {
  if (!left || !right) return false;
  return sameCapabilityGrant(
    { ...left, redemption_sha256: null, redeemed_at: null, redeemed_lease_sha256: null },
    { ...right, redemption_sha256: null, redeemed_at: null, redeemed_lease_sha256: null },
  );
}

function exactApprovedClipSha(job) {
  const approved = job?.payload?.approved_clip;
  const artifact = job?.payload?.approved_artifact;
  const result = job?.result;
  const approvedSha = text(approved?.sha256).toLowerCase();
  const artifactSha = text(artifact?.clip_sha256).toLowerCase();
  const resultSha = text(result?.clip_sha256).toLowerCase();
  const approvedResult = result?.approved === true || (
    result?.action === "complete"
    && result?.completed_by === "verified_upload"
  );
  if (
    approved?.approved !== true
    || !approvedResult
    || !SHA256_RE.test(approvedSha)
    || artifactSha !== approvedSha
    || resultSha !== approvedSha
  ) return "";
  return approvedSha;
}

function jobFromRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw.payload && typeof raw.payload === "object" ? raw.payload : {};
  const result = raw.result && typeof raw.result === "object" ? raw.result : null;
  return {
    jobId: text(raw.job_id),
    prospectId: text(raw.prospect_id),
    producer: text(raw.producer) || PRODUCER,
    status: JOB_STATUSES.includes(raw.status) ? raw.status : "queued",
    attempts: Number(raw.attempts) || 0,
    payload,
    result,
    leaseToken: text(raw.lease_token),
    leaseOwner: text(raw.lease_owner),
    leaseExpiresAt: raw.lease_expires_at || null,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
    finishedAt: raw.finished_at || null,
  };
}

function acceptedSeedanceJobBudget(job, options = {}) {
  const checkpoint = job?.result?.provider_checkpoint;
  if (job?.producer !== OPENROUTER_SEEDANCE_PRODUCER || checkpoint?.submission_state !== "accepted") {
    return { ok: true };
  }
  const env = options.env || process.env;
  const claimCap = Math.max(1, Math.min(
    50,
    Number(env.GHOST_AGENCY_SEEDANCE_ACCEPTED_CLAIM_CAP || DEFAULT_SEEDANCE_ACCEPTED_CLAIM_CAP)
      || DEFAULT_SEEDANCE_ACCEPTED_CLAIM_CAP,
  ));
  if (Math.max(0, Number(job.attempts) || 0) >= claimCap) {
    return { ok: false, reason: "openrouter_accepted_claims_exhausted" };
  }
  const maxAgeMs = Math.max(60_000, Math.min(
    48 * 60 * 60 * 1000,
    Number(env.GHOST_AGENCY_SEEDANCE_ACCEPTED_MAX_AGE_MS || DEFAULT_SEEDANCE_ACCEPTED_MAX_AGE_MS)
      || DEFAULT_SEEDANCE_ACCEPTED_MAX_AGE_MS,
  ));
  const anchor = Date.parse(String(checkpoint.submitted_at || checkpoint.created_at || job.createdAt || ""));
  const nowValue = options.now instanceof Date ? options.now.getTime() : Number(options.now ?? Date.now());
  if (!Number.isFinite(anchor) || !Number.isFinite(nowValue) || nowValue - anchor >= maxAgeMs) {
    return { ok: false, reason: "openrouter_accepted_checkpoint_expired" };
  }
  return { ok: true };
}

function practiceStaticSealIdentity(job = {}, input = {}) {
  const currentHandle = normalizeLineHandle(input.currentLineHandle || input.current_line_handle);
  const originalHandle = normalizeLineHandle(job.payload?.line_handle);
  const inputOriginalHandle = normalizeLineHandle(input.originalLineHandle || input.original_line_handle);
  const staticBase = input.staticBase && typeof input.staticBase === "object" ? input.staticBase : {};
  const result = job.result && typeof job.result === "object" && !Array.isArray(job.result) ? job.result : {};
  const originalReason = text(input.originalReason || input.original_reason);
  const revision = generationRevision(job.payload);
  const attemptCap = Number(input.attemptCap || input.attempt_cap);
  const attempts = Number(job.attempts);
  const currentBuildHash = text(input.currentBuildHash || input.current_build_hash).toLowerCase();
  const jobBuildHash = text(job.payload?.line_build_hash).toLowerCase();
  const fallbackBindingSha256 = text(
    input.fallbackBindingSha256 || input.fallback_binding_sha256,
  ).toLowerCase();
  const photoSha = text(staticBase.photoSha || staticBase.photo_sha).toLowerCase();
  const photoUrl = text(staticBase.photoUrl || staticBase.photo_url);
  const bankFingerprint = text(staticBase.bankFingerprint || staticBase.bank_fingerprint).toLowerCase();
  const evidenceSha = text(staticBase.evidenceSha || staticBase.evidence_sha);
  const photoSource = text(staticBase.photoSource || staticBase.photo_source);
  const checkpoint = result.provider_checkpoint;
  const submissionState = text(
    checkpoint?.submission_state || result.submission_state || result.provider_submission_state,
  ).toLowerCase();
  if (input.practice !== true
    || !job.jobId
    || job.status !== "failed"
    || job.producer !== OPENROUTER_SEEDANCE_PRODUCER
    || !job.prospectId
    || text(input.prospectId || input.prospect_id) !== job.prospectId
    || !currentHandle
    || !originalHandle
    || !inputOriginalHandle
    || originalHandle.batchId !== inputOriginalHandle.batchId
    || originalHandle.rowId !== inputOriginalHandle.rowId
    || (currentHandle.batchId === originalHandle.batchId && currentHandle.rowId === originalHandle.rowId)
    || !Number.isSafeInteger(revision) || revision < 1
    || revision !== Number(input.generationRevision || input.generation_revision)
    || !Number.isSafeInteger(attempts) || attempts < 1
    || !Number.isSafeInteger(attemptCap) || attemptCap < 1
    || originalReason !== "openrouter_submit_failed"
    || text(result.reason) !== originalReason
    || job.leaseToken || job.leaseOwner || job.leaseExpiresAt
    || checkpoint != null
    || result.provider_submission_review != null
    || result.seedance_submit_review != null
    || result.submission_review != null
    || ["accepted", "submitting"].includes(submissionState)
    || !SHA256_RE.test(currentBuildHash)
    || !SHA256_RE.test(fallbackBindingSha256)
    || !SHA256_RE.test(photoSha)
    || !/^https:\/\//i.test(photoUrl)
    || !SHA256_RE.test(bankFingerprint)
    || !evidenceSha
    || !photoSource) return null;

  if (!SHA256_RE.test(jobBuildHash) || jobBuildHash !== currentBuildHash) return null;
  const jobBuildBinding = "exact_job_build_hash";

  return {
    jobId: job.jobId,
    prospectId: job.prospectId,
    producer: job.producer,
    generationRevision: revision,
    attempts,
    attemptCap,
    originalReason,
    currentHandle,
    originalHandle,
    currentBuildHash,
    jobBuildBinding,
    fallbackBindingSha256,
    staticBase: { photoSource, photoSha, photoUrl, bankFingerprint, evidenceSha },
  };
}

function practiceStaticSealReceipt(identity, sealedAt) {
  if (!identity) return null;
  const receipt = {
    ok: false,
    action: "refuse",
    reason: PRACTICE_STATIC_SEAL_REASON,
    schema_version: PRACTICE_STATIC_SEAL_SCHEMA,
    original_reason: identity.originalReason,
    fallback_binding_sha256: identity.fallbackBindingSha256,
    job_id: identity.jobId,
    prospect_id: identity.prospectId,
    producer: identity.producer,
    generation_revision: identity.generationRevision,
    attempts: identity.attempts,
    attempt_cap: identity.attemptCap,
    current_line_handle: identity.currentHandle,
    original_line_handle: identity.originalHandle,
    current_build_hash: identity.currentBuildHash,
    job_build_binding: identity.jobBuildBinding,
    static_hero_source: identity.staticBase.photoSource,
    static_hero_photo_sha256: identity.staticBase.photoSha,
    static_hero_photo_url: identity.staticBase.photoUrl,
    static_hero_bank_fingerprint: identity.staticBase.bankFingerprint,
    base_evidence_sha: identity.staticBase.evidenceSha,
    provider_checkpoint_present: false,
    sealed_at: sealedAt,
  };
  const values = [
    receipt.schema_version,
    receipt.original_reason,
    receipt.fallback_binding_sha256,
    receipt.job_id,
    receipt.prospect_id,
    receipt.producer,
    String(receipt.generation_revision),
    String(receipt.attempts),
    String(receipt.attempt_cap),
    receipt.current_line_handle.batchId,
    receipt.current_line_handle.rowId,
    receipt.original_line_handle.batchId,
    receipt.original_line_handle.rowId,
    receipt.current_build_hash,
    receipt.job_build_binding,
    receipt.static_hero_source,
    receipt.static_hero_photo_sha256,
    receipt.static_hero_photo_url,
    receipt.static_hero_bank_fingerprint,
    receipt.base_evidence_sha,
    "false",
    receipt.sealed_at,
  ];
  receipt.seal_sha256 = createHash("sha256").update(values.join("\n")).digest("hex");
  return receipt;
}

function verifiedPracticeStaticSeal(job = {}, input = {}) {
  if (job.status !== "refused"
    || text(job.result?.reason) !== PRACTICE_STATIC_SEAL_REASON
    || text(job.result?.schema_version) !== PRACTICE_STATIC_SEAL_SCHEMA) return null;
  const originalJob = {
    ...job,
    status: "failed",
    result: { reason: text(job.result?.original_reason) },
  };
  const identity = practiceStaticSealIdentity(originalJob, {
    ...input,
    originalReason: text(job.result?.original_reason),
  });
  if (!identity) return null;
  const expected = practiceStaticSealReceipt(identity, text(job.result?.sealed_at));
  let exactReceipt = false;
  try {
    exactReceipt = stableSerialize(job.result || {}) === stableSerialize(expected || {});
  } catch (_) {
    exactReceipt = false;
  }
  return expected
    && SHA256_RE.test(text(expected.seal_sha256).toLowerCase())
    && exactReceipt
    && !Object.hasOwn(job.result || {}, "provider_checkpoint")
    && !Object.hasOwn(job.result || {}, "provider_submission_review")
    && !Object.hasOwn(job.result || {}, "seedance_submit_review")
    && !Object.hasOwn(job.result || {}, "submission_review")
    ? { identity, receipt: expected }
    : null;
}

function withoutLeaseSecrets(value, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string" && (
    /^[a-z]:[\\/]/i.test(value)
    || /^\\\\/.test(value)
    || /^\/(?:tmp|var\/tmp|home|users)\//i.test(value)
  )) return "[local path redacted]";
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => withoutLeaseSecrets(entry, depth + 1));
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^(lease_?token|settled_by_lease)$/i.test(key)) continue;
    if (
      /^(hero_job_capability_grant|capability|capability_token|jti|jti_sha256|redemption_sha256|redeemed_lease_sha256)$/i.test(key)
      || /(?:^|_)capability(?:_|$)/i.test(key)
      || /(?:^|_)jti(?:_|$)/i.test(key)
      || /(?:^|_)redemption(?:_|$)/i.test(key)
    ) continue;
    if (
      /^(clip|local|source_image|hero_image|job)_(path|file|dir)$/i.test(key)
      || /^(clipPath|localPath|sourceImagePath|heroImagePath|jobFile|outDir)$/i.test(key)
    ) continue;
    out[key] = withoutLeaseSecrets(entry, depth + 1);
  }
  return out;
}

/** Public status never includes the live lease token. */
function publicJob(job) {
  if (!job) return null;
  const payload = job.payload || {};
  const result = job.result && typeof job.result === "object"
    ? withoutLeaseSecrets(job.result)
    : null;
  if (result) {
    const candidates = publicReviewCandidates(result.candidates, candidateAspectRange(job.producer));
    delete result.approved_artifact;
    delete result.optimized_asset;
    delete result.candidate_set_sha256;
    delete result.provider_checkpoint;
    if (candidates.length) result.candidates = candidates;
    else delete result.candidates;
  }
  return {
    job_id: job.jobId,
    jobId: job.jobId,
    prospect_id: job.prospectId,
    prospectId: job.prospectId,
    producer: job.producer,
    status: job.status,
    attempts: job.attempts,
    business_name: safeText(payload.business_name, 240),
    site_slug: safeText(payload.site_slug, 240),
    source_url: safeText(payload.source_url, 1000),
    source_from: safeText(payload.source_from, 240),
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    generation_revision: generationRevision(payload),
    ...(job.finishedAt ? { finished_at: job.finishedAt } : {}),
    ...(result ? { result } : {}),
    ...(result?.reason ? { reason: safeText(result.reason, 240) } : {}),
    ...(payload.approved_clip && typeof payload.approved_clip === "object"
      ? { approved_clip: withoutLeaseSecrets(payload.approved_clip) }
      : {}),
  };
}

function claimedJob(job) {
  return {
    ...publicJob(job),
    photo_bank: job.payload?.photo_bank || { version: 0, harvested_at: null, website: "", fingerprint: "", fresh: false, photos: [] },
    lease_token: job.leaseToken,
    lease_expires_at: job.leaseExpiresAt,
    worker_id: job.leaseOwner,
    generation_revision: generationRevision(job.payload),
    ...(normalizeLineHandle(job.payload?.line_handle)
      ? { line_handle: normalizeLineHandle(job.payload.line_handle) }
      : {}),
    ...(job.payload?.vertical ? { vertical: safeText(job.payload.vertical, 80) } : {}),
    ...(job.payload?.wan && typeof job.payload.wan === "object"
      ? { wan: withoutLeaseSecrets(job.payload.wan) }
      : {}),
    ...(job.payload?.ads_params ? { ads_params: safeSingleLine(job.payload.ads_params) } : {}),
    ...(job.payload?.allow_unverified_length === true ? { allow_unverified_length: true } : {}),
    ...(job.producer === OPENROUTER_SEEDANCE_PRODUCER ? {
      duration_seconds: frozenSeedanceDuration(job),
      openrouter_model: SEEDANCE_MODEL_ID,
      ...(job.result?.provider_checkpoint
        ? { provider_checkpoint: withoutLeaseSecrets(job.result.provider_checkpoint) }
        : {}),
    } : {}),
    ...(job.payload?.approved_artifact ? { approved_artifact: withoutLeaseSecrets(job.payload.approved_artifact) } : {}),
    ...(job.payload?.optimized_asset ? { optimized_asset: withoutLeaseSecrets(job.payload.optimized_asset) } : {}),
  };
}

function createHeroReelJobQueue(dependencies = {}) {
  const deps = {
    insertRow: dependencies.insertRow || store.insertRow,
    select: dependencies.select || store.select,
    conditionalUpdate: dependencies.conditionalUpdate || store.conditionalUpdate,
    now: dependencies.now || (() => new Date()),
    newJobId: dependencies.newJobId || newJobId,
    newLeaseToken: dependencies.newLeaseToken || randomUUID,
    env: dependencies.env || process.env,
    parentBatchStatus: typeof dependencies.parentBatchStatus === "function"
      ? dependencies.parentBatchStatus
      : null,
  };

  const nowDate = () => asDate(deps.now());
  const nowIso = () => nowDate().toISOString();

  async function parentBatchGate(job, options = {}) {
    const handle = normalizeLineHandle(job?.payload?.line_handle);
    if (!handle) return { ok: true, halted: false };
    let value;
    try {
      value = deps.parentBatchStatus
        ? await deps.parentBatchStatus(handle.batchId, { job, signal: options.signal, deadlineAt: options.deadlineAt })
        : await deps.select(
          "ghost_agency_line_batches",
          `?select=status&batch_id=eq.${encodeURIComponent(handle.batchId)}&limit=1`,
          storeWriteOptions(options),
        );
    } catch {
      return { ok: false, halted: false, error: "parent_line_batch_status_unavailable" };
    }
    if (typeof value === "boolean") return { ok: true, halted: value };
    if (typeof value === "string") return { ok: true, halted: value === "halted", status: value };
    if (value && typeof value === "object" && value.error === "batch_not_found") {
      return { ok: true, halted: true, missing: true, status: "missing" };
    }
    if (value && typeof value === "object" && typeof value.halted === "boolean") {
      return { ok: value.ok !== false, halted: value.halted, status: text(value.status) };
    }
    if (value?.ok === true && Array.isArray(value.data) && value.data.length === 0) {
      // A historical Line-bound job whose parent no longer exists is terminal
      // for that job, but it must not starve unrelated active candidates.
      return { ok: true, halted: true, missing: true, status: "missing" };
    }
    if (!value || value.ok !== true || !Array.isArray(value.data) || value.data.length !== 1) {
      return { ok: false, halted: false, error: "parent_line_batch_status_unavailable" };
    }
    const status = text(value.data[0]?.status);
    return status
      ? { ok: true, halted: status === "halted", status }
      : { ok: false, halted: false, error: "parent_line_batch_status_unavailable" };
  }

  function unavailable(result) {
    return !result || result.mode === "dry_run" || result.configured === false || result.ok === false;
  }

  async function getHeroReelJob(jobId) {
    const id = safeId(jobId);
    if (!id) return { ok: false, error: "job_id_required" };
    const read = await deps.select(
      HERO_REEL_JOBS_TABLE,
      `?select=*&job_id=eq.${encodeURIComponent(id)}&limit=1`,
    ).catch(() => null);
    if (!read || read.ok !== true) return { ok: false, error: "hero_reel_queue_unavailable" };
    const job = jobFromRow(rowsOf(read)[0]);
    return job ? { ok: true, job } : { ok: false, error: "unknown_job" };
  }

  async function getHeroReelJobForProspect(prospectId) {
    const id = safeId(prospectId);
    if (!id) return { ok: false, error: "prospect_id_required" };
    const read = await deps.select(
      HERO_REEL_JOBS_TABLE,
      `?select=*&prospect_id=eq.${encodeURIComponent(id)}&limit=1`,
    ).catch(() => null);
    if (!read || read.ok !== true) return { ok: false, error: "hero_reel_queue_unavailable" };
    const job = jobFromRow(rowsOf(read)[0]);
    return job ? { ok: true, job } : { ok: false, error: "unknown_job" };
  }

  async function sealForeignTerminalForPracticeStatic(job, input = {}, options = {}) {
    const existingSeal = verifiedPracticeStaticSeal(job, input);
    if (existingSeal) {
      return { ok: true, sealed: true, reused: true, job, receipt: existingSeal.receipt };
    }
    const identity = practiceStaticSealIdentity(job, input);
    if (!identity) return { ok: false, sealed: false, retryable: false, reason: "foreign_terminal_seal_ineligible" };
    if (!text(job.updatedAt)) {
      return { ok: false, sealed: false, retryable: false, reason: "foreign_terminal_seal_identity_incomplete" };
    }
    const sealedAt = nowIso();
    const receipt = practiceStaticSealReceipt(identity, sealedAt);
    const oldBuildHash = text(job.payload?.line_build_hash).toLowerCase();
    const guards = {
      status: "eq.failed",
      prospect_id: `eq.${job.prospectId}`,
      producer: `eq.${job.producer}`,
      attempts: `eq.${job.attempts}`,
      updated_at: `eq.${job.updatedAt}`,
      finished_at: job.finishedAt ? `eq.${job.finishedAt}` : "is.null",
      lease_token: "is.null",
      lease_owner: "is.null",
      lease_expires_at: "is.null",
      "payload->>generation_revision": `eq.${identity.generationRevision}`,
      "payload->line_handle->>batchId": `eq.${identity.originalHandle.batchId}`,
      "payload->line_handle->>rowId": `eq.${identity.originalHandle.rowId}`,
      "payload->>line_build_hash": SHA256_RE.test(oldBuildHash) ? `eq.${oldBuildHash}` : "is.null",
      "result->>reason": `eq.${identity.originalReason}`,
      "result->provider_checkpoint": "is.null",
      "result->provider_submission_review": "is.null",
      "result->seedance_submit_review": "is.null",
      "result->submission_review": "is.null",
    };
    const updated = await deps.conditionalUpdate(
      HERO_REEL_JOBS_TABLE,
      "job_id",
      job.jobId,
      guards,
      {
        status: "refused",
        lease_token: null,
        lease_owner: null,
        lease_expires_at: null,
        result: receipt,
        finished_at: sealedAt,
        updated_at: sealedAt,
      },
      storeWriteOptions(options),
    ).catch(() => null);
    if (!updated || updated.ok !== true || updated.updated !== true) {
      return { ok: false, sealed: false, retryable: true, reason: "foreign_terminal_seal_conflict" };
    }
    return {
      ok: true,
      sealed: true,
      reused: false,
      receipt,
      job: {
        ...job,
        status: "refused",
        result: receipt,
        leaseToken: "",
        leaseOwner: "",
        leaseExpiresAt: null,
        finishedAt: sealedAt,
        updatedAt: sealedAt,
      },
    };
  }

  async function enqueueHeroReelJob(row, options = {}) {
    const prospectId = safeId(row?.prospect_id || row?.prospectId || row?.id);
    if (!prospectId) return { ok: false, error: "prospect_id_required" };
    let producer = normalizeDurableHeroProducer(options.producer, options.env || deps.env);
    if (!producer) {
      return {
        ok: false,
        error: "producer_not_enabled",
        allowed: [...DURABLE_HERO_PRODUCERS],
      };
    }

    // The unique prospect_id constraint is the final race guard. This read is
    // the fast idempotent path; a concurrent insert loser re-reads below.
    const record = recordOf(row);
    const source = legacySiteUrl(record);
    if (!source.ok) return source;
    // WHO ACTUALLY NEEDS THE PHOTO BANK (owner-measured, 2026-08-23).
    // `ads_image_to_video` — the Google Ads AI Station — sources its OWN images:
    // it scans the client's legacy website (and the social profiles it discovers
    // there) inside the picker's "Website or social" tab. `source.url` above IS
    // that scan target, already resolved and validated. Demanding a freshly
    // harvested bank on top of it gated the Station on a resource it never reads,
    // and refused every live prospect tonight with photo_bank_stale_or_missing
    // even though their legacy sites were perfectly scannable.
    //
    // The bank IS required by the local ffmpeg composer, which has no way to
    // fetch anything — it can only stitch files we already hold. That producer is
    // retired from the automatic path but still reachable by explicit opt-in, so
    // its requirement stays exactly as strict as it was.
    // NARROW BYPASS, and the narrowness is the point. The Station can work with
    // NO bank at all, but a bank that EXISTS and fails verification is a defect
    // in our own harvest — it still refuses, on every lane. We are relaxing
    // "we have no photos", never "our photos did not check out".
    const stationSourcesItsOwnImages = producer === "ads_image_to_video";
    const declaredBank = record?.build_ready?.photo_bank || record?.photo_bank;
    const bankWasDeclared = Boolean(
      declaredBank && Array.isArray(declaredBank.photos) && declaredBank.photos.length,
    );
    const verifiedPhotoBank = normalizedPhotoBank(record, source.url, nowDate());
    const mayProceedWithoutBank = stationSourcesItsOwnImages && !bankWasDeclared;
    if (!mayProceedWithoutBank) {
      if (!verifiedPhotoBank.fresh) {
        return { ok: false, reason: "photo_bank_stale_or_missing" };
      }
      if (!verifiedPhotoBank.photos.length) {
        return { ok: false, reason: "no_verified_owned_photo" };
      }
    }
    const expectedStale = options.expectedStaleJobSnapshot && typeof options.expectedStaleJobSnapshot === "object"
      ? options.expectedStaleJobSnapshot
      : null;
    const existing = await getHeroReelJobForProspect(prospectId);
    // A reoffer is bound to the exact row inspected upstream. If that row was
    // deleted or the lookup became uncertain, never fall through to INSERT and
    // create a replacement generation job.
    if (expectedStale && !existing.ok) return { ok: false, error: "stale_job_snapshot_conflict" };
    if (existing.error !== "unknown_job" && !existing.ok) return { ok: false, error: existing.error };
    // A terminal retry always means "retry this exact row", not "move it to a
    // different generator". Only an unleased queued row may switch lanes.
    if (
      existing.ok
      && ["failed", "refused"].includes(existing.job.status)
    ) producer = existing.job.producer;

    const vertical = normalizeWanVertical(
      options.vertical
      || row?.vertical
      || row?.industry
      || row?.category
      || record?.vertical
      || record?.industry
      || record?.category
      || record?.primary_type
      || record?.mirror_request?.facts?.vertical
      || record?.mirror_request?.facts?.industry
      || record?.build_ready?.mirror_request?.facts?.vertical
      || record?.build_ready?.mirror_request?.facts?.industry,
    );
    const wan = producer === WAN_PRODUCER
      ? defaultWanGeneration({
        prospectId,
        vertical,
        preset: options.wanPreset,
        overlaySide: options.overlaySide,
      })
      : null;
    if (producer === WAN_PRODUCER && !wan) {
      return { ok: false, error: "wan_vertical_required" };
    }
    const payload = {
      business_name: safeText(row.business_name || record.business_name, 240),
      site_slug: siteSlug(row),
      source_url: source.url,
      source_from: source.from,
      photo_bank: verifiedPhotoBank,
      actor: safeText(options.actor || "operator", 120),
      generation_revision: 1,
      ...(producer === OPENROUTER_SEEDANCE_PRODUCER ? {
        duration_seconds: SEEDANCE_DURATION_SEC,
        openrouter_model: SEEDANCE_MODEL_ID,
      } : {}),
      ...(wan ? { vertical, wan } : {}),
      ...(verifiedPhotoBank.place_id ? { place_id: verifiedPhotoBank.place_id } : {}),
      ...(safeSingleLine(options.adsParams) ? { ads_params: safeSingleLine(options.adsParams) } : {}),
      ...(options.allowUnverifiedLength === true ? { allow_unverified_length: true } : {}),
      ...(normalizeLineHandle(options.lineHandle)
        ? {
          line_handle: normalizeLineHandle(options.lineHandle),
          line_build_hash: /^[a-f0-9]{64}$/i.test(text(options.reofferBuildHash))
            ? text(options.reofferBuildHash).toLowerCase()
            : null,
        }
        : {}),
    };
    payload.source_fingerprint = sourceFingerprint(source.url, verifiedPhotoBank);

    // Duration is immutable once a Seedance job exists. New rows default to
    // eight seconds, while paid legacy four-second checkpoints and receipts
    // must keep their original identity through reoffer and recovery.
    if (existing.ok && existing.job.producer === OPENROUTER_SEEDANCE_PRODUCER && producer === existing.job.producer) {
      const existingDuration = frozenSeedanceDuration(existing.job);
      if (existingDuration !== null) payload.duration_seconds = existingDuration;
    }

    if (existing.ok) {
      if (expectedStale) {
        const expectedHandle = normalizeLineHandle(expectedStale.line_handle || expectedStale.lineHandle);
        const actualHandle = normalizeLineHandle(existing.job.payload?.line_handle);
        const exactSnapshot = text(expectedStale.job_id || expectedStale.jobId) === existing.job.jobId
          && text(expectedStale.status) === existing.job.status
          && Number(expectedStale.revision) === generationRevision(existing.job.payload)
          && expectedHandle && actualHandle
          && expectedHandle.batchId === actualHandle.batchId && expectedHandle.rowId === actualHandle.rowId
          && !text(expectedStale.lease_token || expectedStale.leaseToken)
          && !text(expectedStale.lease_owner || expectedStale.leaseOwner)
          && !text(expectedStale.lease_expires_at || expectedStale.leaseExpiresAt)
          && !existing.job.leaseToken && !existing.job.leaseOwner && !existing.job.leaseExpiresAt;
        if (!exactSnapshot) return { ok: false, error: "stale_job_snapshot_conflict" };
      }
      const currentValid = payloadHasVerifiedPhoto(existing.job.payload, nowDate());
      const sourceChanged = text(existing.job.payload?.source_fingerprint) !== payload.source_fingerprint;
      const producerChanged = existing.job.producer !== producer;
      // A producer change invalidates the prior generation revision, but it
      // may only happen before a worker owns the queued row. Never redirect a
      // running/reviewed/finished job to a different generator.
      const producerSwitchBlocked = producerChanged && (
        (existing.job.status === "queued" && existing.job.leaseToken)
        || !["queued", "failed", "refused"].includes(existing.job.status)
      );
      if (producerSwitchBlocked) {
        return enqueueVerdict(existing.job, true);
      }
      if (["failed", "refused"].includes(existing.job.status)) {
        const explicitSafeRetry = options.retry === true && text(options.actor || "operator") === "operator";
        const oldLineHandle = normalizeLineHandle(existing.job.payload?.line_handle);
        const newLineHandle = normalizeLineHandle(payload.line_handle);
        const reofferBuildHash = text(options.reofferBuildHash).toLowerCase();
        const oldBuildHash = text(existing.job.payload?.line_build_hash).toLowerCase();
        const oldBuildHashValid = /^[a-f0-9]{64}$/.test(oldBuildHash);
        const legacyBuildHashAbsent = existing.job.payload?.line_build_hash == null;
        const sameBuildReofferCount = lineSameBuildReofferCount(existing.job.payload);
        const foreignLineHandle = oldLineHandle && newLineHandle
          && (oldLineHandle.batchId !== newLineHandle.batchId || oldLineHandle.rowId !== newLineHandle.rowId);
        const currentBuildReoffer = /^[a-f0-9]{64}$/.test(reofferBuildHash)
          && foreignLineHandle
          && (legacyBuildHashAbsent || (oldBuildHashValid && oldBuildHash !== reofferBuildHash))
          && !existing.job.leaseToken && !existing.job.leaseOwner && !existing.job.leaseExpiresAt;
        const sameBuildForeignHandle = /^[a-f0-9]{64}$/.test(reofferBuildHash)
          && foreignLineHandle && oldBuildHashValid && oldBuildHash === reofferBuildHash;
        const sameBuildRecovery = expectedStale
          && sameBuildForeignHandle
          && sameBuildReofferCount === 0
          && REPAIRABLE_SAME_BUILD_REOFFER_REASONS.has(text(existing.job.result?.reason))
          && !existing.job.leaseToken && !existing.job.leaseOwner && !existing.job.leaseExpiresAt;
        const acceptedSeedanceCheckpoint = existing.job.producer === OPENROUTER_SEEDANCE_PRODUCER
          ? normalizeSeedanceCheckpoint(existing.job.result?.provider_checkpoint, {
            ...existing.job,
            // Revalidate the paid checkpoint against the CURRENT verified
            // photo bank while preserving its generation revision. Rank/grade
            // changes are not new source bytes; a missing SHA still fails.
            payload: {
              ...payload,
              generation_revision: generationRevision(existing.job.payload),
            },
          })
          : null;
        const sameBuildCheckpointRecovery = expectedStale
          && sameBuildForeignHandle
          && sameBuildReofferCount === 0
          && ["clip_dimensions_out_of_range", "openrouter_clip_size_invalid"]
            .includes(text(existing.job.result?.reason))
          && acceptedSeedanceCheckpoint?.submission_state === "accepted"
          && !existing.job.leaseToken && !existing.job.leaseOwner && !existing.job.leaseExpiresAt;
        if (sameBuildForeignHandle && !sameBuildRecovery && !sameBuildCheckpointRecovery && !explicitSafeRetry) return enqueueVerdict(existing.job, true);
        if (!sourceChanged && !explicitSafeRetry && !currentBuildReoffer && !sameBuildRecovery && !sameBuildCheckpointRecovery) return enqueueVerdict(existing.job, true);
        if (!payload.line_handle && normalizeLineHandle(existing.job.payload?.line_handle)) {
          payload.line_handle = normalizeLineHandle(existing.job.payload.line_handle);
        }
        if (currentBuildReoffer || sameBuildRecovery || sameBuildCheckpointRecovery) payload.line_build_hash = reofferBuildHash;
        if (sameBuildRecovery || sameBuildCheckpointRecovery || sameBuildReofferCount === 1) payload.line_same_build_reoffer_count = 1;
        payload.generation_revision = sameBuildCheckpointRecovery
          ? generationRevision(existing.job.payload)
          : generationRevision(existing.job.payload) + 1;
        const reset = await deps.conditionalUpdate(
          HERO_REEL_JOBS_TABLE,
          "job_id",
          existing.job.jobId,
          {
            status: `eq.${existing.job.status}`,
            prospect_id: `eq.${existing.job.prospectId}`,
            producer: `eq.${existing.job.producer}`,
            attempts: `eq.${existing.job.attempts}`,
            updated_at: `eq.${existing.job.updatedAt}`,
            lease_token: "is.null",
            lease_owner: "is.null",
            lease_expires_at: "is.null",
            ...(currentBuildReoffer || sameBuildRecovery || sameBuildCheckpointRecovery ? {
              "payload->line_handle->>batchId": `eq.${oldLineHandle.batchId}`,
              "payload->line_handle->>rowId": `eq.${oldLineHandle.rowId}`,
              "payload->>line_build_hash": oldBuildHashValid ? `eq.${oldBuildHash}` : "is.null",
              ...(expectedStale ? { "payload->>generation_revision": `eq.${Number(expectedStale.revision)}` } : {}),
              ...(sameBuildRecovery || sameBuildCheckpointRecovery ? { "payload->>line_same_build_reoffer_count": "is.null" } : {}),
            } : {}),
          },
          {
            status: "queued", attempts: sameBuildCheckpointRecovery ? existing.job.attempts : 0, payload,
            result: sameBuildCheckpointRecovery ? { provider_checkpoint: acceptedSeedanceCheckpoint } : null,
            updated_at: nowIso(), finished_at: null,
          },
          storeWriteOptions(options),
        ).catch(() => null);
        if (reset?.ok === true && reset.updated === true) {
          return {
            ...enqueueVerdict(jobFromRow(rowsOf(reset)[0]) || {
              ...existing.job, status: "queued", attempts: 0, payload, result: null, finishedAt: null,
            }, true),
            retried: true,
          };
        }
        return { ok: false, error: "retry_conflict" };
      }
      if (existing.job.status !== "queued") return enqueueVerdict(existing.job, true);
      if (!payload.ads_params && existing.job.payload?.ads_params) {
        payload.ads_params = safeSingleLine(existing.job.payload.ads_params);
      }
      if (existing.job.payload?.allow_unverified_length === true) {
        payload.allow_unverified_length = true;
      }
      if (!payload.line_handle && normalizeLineHandle(existing.job.payload?.line_handle)) {
        payload.line_handle = normalizeLineHandle(existing.job.payload.line_handle);
      }
      if (lineSameBuildReofferCount(existing.job.payload) === 1) {
        payload.line_same_build_reoffer_count = 1;
      }
      const operationalChanged = text(existing.job.payload?.ads_params) !== text(payload.ads_params)
        || (existing.job.payload?.allow_unverified_length === true) !== (payload.allow_unverified_length === true)
        || JSON.stringify(normalizeLineHandle(existing.job.payload?.line_handle))
          !== JSON.stringify(normalizeLineHandle(payload.line_handle))
        || JSON.stringify(existing.job.payload?.wan || null) !== JSON.stringify(payload.wan || null)
        || text(existing.job.payload?.vertical) !== text(payload.vertical)
        || Number(existing.job.payload?.duration_seconds || 0) !== Number(payload.duration_seconds || 0)
        || text(existing.job.payload?.openrouter_model) !== text(payload.openrouter_model)
        || producerChanged;
      if (currentValid && !sourceChanged && !operationalChanged) return enqueueVerdict(existing.job, true);
      payload.generation_revision = generationRevision(existing.job.payload) + 1;
      // Repair a prematurely queued row with the now-proven bank. The unique
      // prospect key must never trap an empty/stale payload forever.
      const repaired = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        existing.job.jobId,
        { status: "eq.queued", lease_token: "is.null" },
        { producer, payload, result: null, updated_at: nowIso() },
        storeWriteOptions(options),
      ).catch(() => null);
      if (repaired?.ok === true && repaired.updated === true) {
        return { ...enqueueVerdict(jobFromRow(rowsOf(repaired)[0]) || { ...existing.job, payload }, true), refreshed: true };
      }
      return { ok: false, error: "existing_job_invalid_photo_bank" };
    }
    if (existing.error !== "unknown_job") return { ok: false, error: existing.error };

    const createdAt = nowIso();
    const jobId = deps.newJobId();
    let inserted;
    try {
      inserted = await deps.insertRow(HERO_REEL_JOBS_TABLE, {
        job_id: jobId,
        prospect_id: prospectId,
        producer,
        status: "queued",
        attempts: 0,
        payload,
        result: null,
        lease_token: null,
        lease_owner: null,
        lease_expires_at: null,
        created_at: createdAt,
        updated_at: createdAt,
        finished_at: null,
      }, storeWriteOptions(options));
    } catch {
      inserted = null;
    }
    if (!unavailable(inserted) && inserted.mode === "live_write") {
      const insertedJob = jobFromRow(rowsOf(inserted)[0]) || jobFromRow({
        job_id: jobId, prospect_id: prospectId, producer, status: "queued",
        attempts: 0, payload, created_at: createdAt, updated_at: createdAt,
      });
      return enqueueVerdict(insertedJob, false);
    }

    // A 409 unique violation is expected under concurrent enqueue. Re-reading
    // converts that race into the same successful idempotent answer.
    const raced = await getHeroReelJobForProspect(prospectId);
    if (raced.ok) return enqueueVerdict(raced.job, true);
    return { ok: false, error: "hero_reel_queue_unavailable" };
  }

  function enqueueVerdict(job, reused) {
    const shown = publicJob(job);
    return {
      ok: true,
      queued: job.status === "queued",
      reused,
      ...shown,
      poll: { method: "GET", path: `/api/admin/hero-reel?job_id=${encodeURIComponent(job.jobId)}` },
    };
  }

  async function recordHeroJobCapabilityGrant({
    jobId, claims, expectedGrantJtiSha256, allowExpiredRecovery = false, signal, deadlineAt,
  } = {}) {
    const id = safeId(jobId);
    if (!id) return { ok: false, error: "job_id_required" };
    let desired;
    try { desired = heroJobCapabilityGrant(claims); } catch { desired = null; }
    if (!desired || desired.job_id !== id) return { ok: false, error: "capability_claims_invalid" };

    const found = await getHeroReelJob(id);
    if (!found.ok) return found;
    const current = found.job;
    const parent = await parentBatchGate(current, { signal, deadlineAt });
    if (!parent.ok) return { ok: false, error: parent.error, retryable: true };
    if (parent.halted) return { ok: false, error: "parent_line_batch_halted", terminal: true };
    const lineHandle = normalizeLineHandle(current.payload?.line_handle);
    const approvedSha = exactApprovedClipSha(current);
    const existing = capabilityGrantForJob(current);
    if (sameCapabilityGrant(existing, desired)) {
      return { ok: true, reused: true, job: publicJob(current) };
    }
    const expectedHash = text(expectedGrantJtiSha256).toLowerCase();
    const existingHash = text(existing?.jti_sha256).toLowerCase();
    if (existingHash !== expectedHash) return { ok: false, error: "capability_grant_conflict" };
    const at = nowDate();
    const atIso = at.toISOString();
    const leaseExpiryMs = Date.parse(String(current.leaseExpiresAt || ""));
    // Generate recovery is allowed only when the durable checkpoint itself
    // proves what the next worker may do. With no valid checkpoint, provider
    // acceptance/spend is unknowable; resetting to queued could issue a second
    // paid submit. Upload recovery is already bound to approved clip bytes and
    // keeps its existing behavior.
    const recoveredGenerateCheckpoint = existing?.phase === "generate"
      ? normalizeSeedanceCheckpoint(current.result?.provider_checkpoint, current)
      : null;
    const expiredRecovery = Boolean(
      allowExpiredRecovery === true
      && current.status === "running"
      && existing
      && existing.phase === desired.phase
      && exactCapabilityTarget(current, existing)
      && exactCapabilityTarget(current, desired)
      && current.attempts === existing.attempt + 1
      && desired.attempt === current.attempts
      && current.leaseToken
      && current.leaseOwner === heroJobCapabilityLeaseOwner(existing)
      && existing.redemption_sha256
      && existing.redeemed_at
      && existing.redeemed_lease_sha256 === sha256Opaque(current.leaseToken)
      && Number.isFinite(leaseExpiryMs)
      && leaseExpiryMs <= at.getTime()
      && (existing.phase === "upload" || recoveredGenerateCheckpoint)
    );
    if (expiredRecovery) {
      let recovered;
      try {
        recovered = await deps.conditionalUpdate(
          HERO_REEL_JOBS_TABLE,
          "job_id",
          id,
          {
            status: "eq.running",
            producer: `eq.${OPENROUTER_SEEDANCE_PRODUCER}`,
            attempts: `eq.${current.attempts}`,
            lease_token: `eq.${current.leaseToken}`,
            lease_owner: `eq.${current.leaseOwner}`,
            lease_expires_at: `eq.${current.leaseExpiresAt}`,
            "payload->hero_job_capability_grant->>jti_sha256": `eq.${existing.jti_sha256}`,
            "payload->hero_job_capability_grant->>redemption_sha256": `eq.${existing.redemption_sha256}`,
            "payload->hero_job_capability_grant->>redeemed_lease_sha256": `eq.${existing.redeemed_lease_sha256}`,
            ...(current.updatedAt ? { updated_at: `eq.${current.updatedAt}` } : {}),
          },
          {
            status: "queued",
            payload: { ...(current.payload || {}), hero_job_capability_grant: desired },
            lease_token: null,
            lease_owner: null,
            lease_expires_at: null,
            updated_at: atIso,
            finished_at: null,
          },
          storeWriteOptions({ signal, deadlineAt }),
        );
      } catch { recovered = null; }
      if (recovered?.ok === true && recovered.updated === true) {
        const job = jobFromRow(rowsOf(recovered)[0]) || {
          ...current,
          status: "queued",
          payload: { ...(current.payload || {}), hero_job_capability_grant: desired },
          leaseToken: "",
          leaseOwner: "",
          leaseExpiresAt: null,
          updatedAt: atIso,
          finishedAt: null,
        };
        return { ok: true, reused: false, recovered: true, job: publicJob(job) };
      }
      const reread = await getHeroReelJob(id);
      if (
        reread.ok
        && reread.job.status === "queued"
        && !reread.job.leaseToken
        && sameCapabilityGrant(capabilityGrantForJob(reread.job), desired)
      ) return { ok: true, reused: true, recovered: true, job: publicJob(reread.job) };
      return { ok: false, error: reread.ok ? "capability_grant_conflict" : "hero_reel_queue_unavailable" };
    }
    if (
      current.status !== "queued"
      || current.leaseToken
      || current.leaseOwner
      || current.leaseExpiresAt
      || current.producer !== OPENROUTER_SEEDANCE_PRODUCER
      || current.jobId !== desired.job_id
      || current.prospectId !== desired.prospect_id
      || generationRevision(current.payload) !== desired.generation_revision
      || current.attempts !== desired.attempt
      || !lineHandle
      || lineHandle.batchId !== desired.batch_id
      || lineHandle.rowId !== desired.row_id
      || (desired.phase === "generate" && Boolean(current.payload?.approved_clip?.approved))
      || (desired.phase === "upload" && approvedSha !== desired.approved_sha256)
    ) return { ok: false, error: "capability_target_conflict", status: current.status };

    const guards = {
      status: "eq.queued",
      producer: `eq.${OPENROUTER_SEEDANCE_PRODUCER}`,
      attempts: `eq.${current.attempts}`,
      lease_token: "is.null",
      lease_owner: "is.null",
      lease_expires_at: "is.null",
      "payload->>generation_revision": `eq.${desired.generation_revision}`,
      "payload->line_handle->>batchId": `eq.${desired.batch_id}`,
      "payload->line_handle->>rowId": `eq.${desired.row_id}`,
      "payload->hero_job_capability_grant->>jti_sha256": existingHash
        ? `eq.${existingHash}`
        : "is.null",
      ...(current.updatedAt ? { updated_at: `eq.${current.updatedAt}` } : {}),
      ...(desired.phase === "upload" ? {
        "payload->approved_clip->>sha256": `eq.${desired.approved_sha256}`,
        "payload->approved_artifact->>clip_sha256": `eq.${desired.approved_sha256}`,
        "result->>clip_sha256": `eq.${desired.approved_sha256}`,
      } : {}),
    };
    let written;
    try {
      written = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        id,
        guards,
        {
          payload: { ...(current.payload || {}), hero_job_capability_grant: desired },
          updated_at: atIso,
        },
        storeWriteOptions({ signal, deadlineAt }),
      );
    } catch { written = null; }
    if (written?.ok === true && written.updated === true) {
      const job = jobFromRow(rowsOf(written)[0]) || {
        ...current,
        payload: { ...(current.payload || {}), hero_job_capability_grant: desired },
        updatedAt: atIso,
      };
      return { ok: true, reused: false, job: publicJob(job) };
    }
    const reread = await getHeroReelJob(id);
    if (reread.ok && sameCapabilityGrant(capabilityGrantForJob(reread.job), desired)) {
      return { ok: true, reused: true, job: publicJob(reread.job) };
    }
    return { ok: false, error: reread.ok ? "capability_grant_conflict" : "hero_reel_queue_unavailable" };
  }

  function exactCapabilityTarget(job, grant) {
    const lineHandle = normalizeLineHandle(job?.payload?.line_handle);
    return Boolean(
      job
      && grant
      && job.jobId === grant.job_id
      && job.prospectId === grant.prospect_id
      && job.producer === OPENROUTER_SEEDANCE_PRODUCER
      && generationRevision(job.payload) === grant.generation_revision
      && lineHandle
      && lineHandle.batchId === grant.batch_id
      && lineHandle.rowId === grant.row_id
      && (grant.phase !== "upload" || exactApprovedClipSha(job) === grant.approved_sha256)
    );
  }

  function sameLiveCapabilityLease(job, grant, atMs, capBoundMs) {
    const expiryMs = Date.parse(String(job?.leaseExpiresAt || ""));
    return Boolean(
      exactCapabilityTarget(job, grant)
      && job.status === "running"
      && job.attempts === grant.attempt + 1
      && job.leaseToken
      && job.leaseOwner === heroJobCapabilityLeaseOwner(grant)
      && grant.redeemed_at
      && grant.redeemed_lease_sha256 === sha256Opaque(job.leaseToken)
      && Number.isFinite(expiryMs)
      && expiryMs > atMs
      && expiryMs <= capBoundMs
    );
  }

  function sameCompletedUploadCapabilityLease(job, grant, leaseToken, atMs) {
    const result = job?.result;
    return Boolean(
      grant?.phase === "upload"
      && exactCapabilityTarget(job, grant)
      && job.status === "done"
      && job.attempts === grant.attempt + 1
      && !job.leaseToken
      && !job.leaseOwner
      && !job.leaseExpiresAt
      && grant.redeemed_at
      && grant.redeemed_lease_sha256 === sha256Opaque(leaseToken)
      && grant.exp * 1000 > atMs
      && result?.action === "complete"
      && result?.completed_by === "verified_upload"
      && result?.settled_by_lease === leaseToken
      && text(result?.clip_sha256).toLowerCase() === grant.approved_sha256
    );
  }

  async function claimHeroReelJobWithCapability({ claims, redemptionId, signal, deadlineAt } = {}) {
    let expected;
    let redemptionSha256;
    try { expected = heroJobCapabilityGrant(claims); } catch { expected = null; }
    try { redemptionSha256 = heroJobCapabilityRedemptionSha256(redemptionId); } catch { redemptionSha256 = ""; }
    if (!expected) return { ok: false, error: "capability_claims_invalid" };
    if (!redemptionSha256) return { ok: false, error: "capability_redemption_id_invalid" };
    const found = await getHeroReelJob(expected.job_id);
    if (!found.ok) return found;
    const current = found.job;
    const parent = await parentBatchGate(current, { signal, deadlineAt });
    if (!parent.ok) return { ok: false, error: parent.error, retryable: true };
    if (parent.halted) return { ok: false, error: "parent_line_batch_halted", terminal: true };
    const stored = capabilityGrantForJob(current);
    if (!stored || !sameCapabilityGrantIdentity(stored, expected) || !exactCapabilityTarget(current, stored)) {
      return { ok: false, error: "capability_grant_conflict" };
    }
    const at = nowDate();
    const atMs = at.getTime();
    const atIso = at.toISOString();
    const capBoundMs = stored.exp * 1000 - HERO_JOB_CAPABILITY_LEASE_MARGIN_MS;
    const durationMs = HERO_JOB_CAPABILITY_LEASE_MS[stored.phase];
    if (stored.nbf * 1000 > atMs + 30_000 || stored.exp * 1000 <= atMs) {
      return { ok: false, error: "capability_expired" };
    }
    if (sameLiveCapabilityLease(current, stored, atMs, capBoundMs)) {
      return stored.redemption_sha256 === redemptionSha256
        ? { ok: true, reused: true, job: claimedJob(current) }
        : { ok: false, error: "capability_replay_conflict", status: current.status };
    }
    if (capBoundMs - atMs < durationMs) {
      return { ok: false, error: "capability_expired" };
    }
    if (
      current.status !== "queued"
      || current.attempts !== stored.attempt
      || current.leaseToken
      || current.leaseOwner
      || current.leaseExpiresAt
      || stored.redeemed_at
      || stored.redemption_sha256
      || stored.redeemed_lease_sha256
    ) return { ok: false, error: "capability_replay_conflict", status: current.status };

    const leaseToken = deps.newLeaseToken();
    const leaseOwner = heroJobCapabilityLeaseOwner(stored);
    const leaseExpiresAt = new Date(atMs + durationMs).toISOString();
    const redeemedGrant = {
      ...stored,
      redemption_sha256: redemptionSha256,
      redeemed_at: atIso,
      redeemed_lease_sha256: sha256Opaque(leaseToken),
    };
    let claimed;
    try {
      claimed = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        current.jobId,
        {
          status: "eq.queued",
          producer: `eq.${OPENROUTER_SEEDANCE_PRODUCER}`,
          attempts: `eq.${stored.attempt}`,
          lease_token: "is.null",
          lease_owner: "is.null",
          lease_expires_at: "is.null",
          "payload->>generation_revision": `eq.${stored.generation_revision}`,
          "payload->line_handle->>batchId": `eq.${stored.batch_id}`,
          "payload->line_handle->>rowId": `eq.${stored.row_id}`,
          "payload->hero_job_capability_grant->>jti_sha256": `eq.${stored.jti_sha256}`,
          "payload->hero_job_capability_grant->>redemption_sha256": "is.null",
          "payload->hero_job_capability_grant->>redeemed_at": "is.null",
          ...(current.updatedAt ? { updated_at: `eq.${current.updatedAt}` } : {}),
          ...(stored.phase === "upload" ? {
            "payload->approved_clip->>sha256": `eq.${stored.approved_sha256}`,
            "payload->approved_artifact->>clip_sha256": `eq.${stored.approved_sha256}`,
          } : {}),
        },
        {
          status: "running",
          attempts: stored.attempt + 1,
          payload: { ...(current.payload || {}), hero_job_capability_grant: redeemedGrant },
          lease_token: leaseToken,
          lease_owner: leaseOwner,
          lease_expires_at: leaseExpiresAt,
          updated_at: atIso,
          finished_at: null,
        },
        storeWriteOptions({ signal, deadlineAt }),
      );
    } catch { claimed = null; }
    if (claimed?.ok === true && claimed.updated === true) {
      const job = jobFromRow(rowsOf(claimed)[0]) || {
        ...current,
        status: "running",
        attempts: stored.attempt + 1,
        payload: { ...(current.payload || {}), hero_job_capability_grant: redeemedGrant },
        leaseToken,
        leaseOwner,
        leaseExpiresAt,
        updatedAt: atIso,
      };
      return { ok: true, reused: false, job: claimedJob(job) };
    }
    const reread = await getHeroReelJob(current.jobId);
    const durableGrant = reread.ok ? capabilityGrantForJob(reread.job) : null;
    if (
      reread.ok
      && durableGrant
      && sameCapabilityGrantIdentity(durableGrant, expected)
      && durableGrant.redemption_sha256 === redemptionSha256
      && sameLiveCapabilityLease(reread.job, durableGrant, atMs, capBoundMs)
    ) return { ok: true, reused: true, job: claimedJob(reread.job) };
    return { ok: false, error: reread.ok ? "capability_replay_conflict" : "hero_reel_queue_unavailable" };
  }

  async function validateHeroReelJobCapabilityLease({
    jobId, leaseToken, phase, approvedSha256,
  } = {}) {
    const id = safeId(jobId);
    const token = text(leaseToken);
    const expectedPhase = text(phase);
    if (!id) return { ok: false, error: "job_id_required" };
    if (!token) return { ok: false, error: "lease_token_required" };
    if (!Object.hasOwn(HERO_JOB_CAPABILITY_LEASE_MS, expectedPhase)) {
      return { ok: false, error: "capability_phase_invalid" };
    }
    const found = await getHeroReelJob(id);
    if (!found.ok) return found;
    const job = found.job;
    const grant = capabilityGrantForJob(job);
    const atMs = nowDate().getTime();
    const capBoundMs = Number(grant?.exp) * 1000 - HERO_JOB_CAPABILITY_LEASE_MARGIN_MS;
    const live = grant
      && sameLiveCapabilityLease(job, grant, atMs, capBoundMs)
      && job.leaseToken === token;
    const completed = grant
      && sameCompletedUploadCapabilityLease(job, grant, token, atMs);
    if (
      !grant
      || grant.phase !== expectedPhase
      || (!live && !completed)
      || (expectedPhase === "upload" && text(approvedSha256).toLowerCase() !== grant.approved_sha256)
    ) {
      // Diagnosable conflict: the 08-27 churn loop (943 attempts) was opaque
      // because this return carried no why. Surface the exact failed term.
      const why = !grant
        ? "no_stored_grant"
        : grant.phase !== expectedPhase
          ? `phase_mismatch stored=${grant.phase} expected=${expectedPhase}`
          : text(approvedSha256) && text(approvedSha256).toLowerCase() !== grant.approved_sha256
            ? `approved_sha_mismatch`
            : !live && !completed
              ? (() => {
                const parts = [];
                if (!exactCapabilityTarget(job, grant)) parts.push("target");
                if (job.status !== "running") parts.push(`status=${job.status}`);
                if (Number(job.attempts) !== Number(grant.attempt) + 1) parts.push(`attempts job=${job.attempts} grant=${grant.attempt}`);
                if (!job.leaseToken) parts.push("no_lease_token");
                if (job.leaseOwner !== heroJobCapabilityLeaseOwner(grant)) parts.push(`owner job=${job.leaseOwner || "null"}`);
                if (!grant.redeemed_at) parts.push("not_redeemed");
                if (grant.redeemed_lease_sha256 !== sha256Opaque(job.leaseToken || "")) parts.push("redemption_sha");
                const expiryMs = Date.parse(String(job?.leaseExpiresAt || ""));
                if (!Number.isFinite(expiryMs)) parts.push("no_expiry");
                else {
                  if (expiryMs <= atMs) parts.push("lease_expired");
                  if (expiryMs > capBoundMs) parts.push(`lease_beyond_cap by=${expiryMs - capBoundMs}ms`);
                }
                if (completed === false && grant.phase === "upload" && job.status === "done") parts.push("done_mismatch");
                return `live_check_failed: ${parts.join(",") || "unspecified"}`;
              })()
              : "unknown";
      return { ok: false, error: "capability_lease_conflict", status: job.status, detail: why };
    }
    return { ok: true, job, grant, ...(completed ? { completed: true } : {}) };
  }

  async function renewHeroReelJobCapabilityLease({ jobId, leaseToken, signal, deadlineAt } = {}) {
    const validated = await validateHeroReelJobCapabilityLease({ jobId, leaseToken, phase: "generate" });
    if (!validated.ok) return validated;
    const { job, grant } = validated;
    const at = nowDate();
    const atMs = at.getTime();
    const atIso = at.toISOString();
    const capBoundMs = grant.exp * 1000 - HERO_JOB_CAPABILITY_LEASE_MARGIN_MS;
    const requestedMs = atMs + HERO_JOB_CAPABILITY_LEASE_MS.generate;
    const targetMs = Math.min(capBoundMs, Math.max(Date.parse(job.leaseExpiresAt), requestedMs));
    if (targetMs <= atMs) return { ok: false, error: "capability_expired" };
    const expiresAt = new Date(targetMs).toISOString();
    let renewed;
    try {
      renewed = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        job.jobId,
        {
          status: "eq.running",
          lease_token: `eq.${job.leaseToken}`,
          lease_owner: `eq.${heroJobCapabilityLeaseOwner(grant)}`,
          lease_expires_at: `eq.${job.leaseExpiresAt}`,
          "payload->hero_job_capability_grant->>jti_sha256": `eq.${grant.jti_sha256}`,
        },
        { lease_expires_at: expiresAt, updated_at: atIso },
        storeWriteOptions({ signal, deadlineAt }),
      );
    } catch { renewed = null; }
    if (renewed?.ok === true && renewed.updated === true) {
      return { ok: true, reused: false, lease_expires_at: expiresAt };
    }
    const reread = await validateHeroReelJobCapabilityLease({ jobId, leaseToken, phase: "generate" });
    const rereadExpiry = reread.ok ? Date.parse(reread.job.leaseExpiresAt) : NaN;
    if (reread.ok && rereadExpiry >= targetMs && rereadExpiry <= capBoundMs) {
      return { ok: true, reused: true, lease_expires_at: new Date(rereadExpiry).toISOString() };
    }
    return { ok: false, error: "capability_lease_conflict" };
  }

  async function requeueApprovedHeroUpload({ jobId, leaseToken, reason, signal, deadlineAt } = {}) {
    const id = safeId(jobId);
    const token = text(leaseToken);
    const found = id ? await getHeroReelJob(id) : { ok: false, error: "job_id_required" };
    const approvedSha = found.ok ? exactApprovedClipSha(found.job) : "";
    const existingGrant = found.ok ? capabilityGrantForJob(found.job) : null;
    if (found.ok) {
      const parent = await parentBatchGate(found.job, { signal, deadlineAt });
      if (!parent.ok) return { ok: false, error: parent.error, retryable: true };
      if (parent.halted) return { ok: false, error: "parent_line_batch_halted", terminal: true };
    }
    const alreadyRequeued = Boolean(
      found.ok
      && token
      && existingGrant?.phase === "upload"
      && exactCapabilityTarget(found.job, existingGrant)
      && found.job.status === "queued"
      && found.job.attempts === existingGrant.attempt + 1
      && !found.job.leaseToken
      && !found.job.leaseOwner
      && !found.job.leaseExpiresAt
      && existingGrant.redemption_sha256
      && existingGrant.redeemed_at
      && existingGrant.redeemed_lease_sha256 === sha256Opaque(token)
      && found.job.result?.action === "requeue_upload"
      && found.job.result?.settled_by_lease === token
      && found.job.result?.retry_without_generation === true
      && text(found.job.result?.approved_sha256).toLowerCase() === approvedSha
    );
    if (alreadyRequeued) {
      return { ok: true, reused: true, job: publicJob(found.job) };
    }
    const validated = found.ok
      ? await validateHeroReelJobCapabilityLease({
        jobId: id, leaseToken: token, phase: "upload", approvedSha256: approvedSha,
      })
      : found;
    if (!validated.ok) {
      // Diagnosable path (08-27 churn loop): surface the validator's exact
      // failed term on the durable record so the funnel API shows why an
      // approved clip cannot attach, without server log access.
      const currentRow = found.ok ? found.job : null;
      return {
        ...validated,
        detail: validated.detail || null,
        job_state: currentRow ? {
          status: currentRow.status,
          attempts: currentRow.attempts,
          lease_token_present: Boolean(currentRow.leaseToken),
          lease_expires_at: currentRow.leaseExpiresAt,
          approved_sha: exactApprovedClipSha(currentRow) || null,
        } : null,
      };
    }
    const current = validated.job;
    if (validated.completed) {
      return { ok: true, reused: true, completed: true, job: publicJob(current) };
    }
    const atIso = nowIso();
    const result = {
      ...(current.result || {}),
      reason: safeText(reason || "approved_upload_requeued", 240),
      retry_without_generation: true,
      approved_sha256: approvedSha,
      settled_by_lease: token,
      action: "requeue_upload",
      settled_at: atIso,
    };
    let requeued;
    try {
      requeued = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        id,
        {
          status: "eq.running",
          lease_token: `eq.${token}`,
          lease_owner: `eq.${heroJobCapabilityLeaseOwner(validated.grant)}`,
          lease_expires_at: `gt.${atIso}`,
          "payload->hero_job_capability_grant->>jti_sha256": `eq.${validated.grant.jti_sha256}`,
          "payload->approved_clip->>sha256": `eq.${approvedSha}`,
          "payload->approved_artifact->>clip_sha256": `eq.${approvedSha}`,
        },
        {
          status: "queued",
          payload: current.payload,
          result,
          lease_token: null,
          lease_owner: null,
          lease_expires_at: null,
          updated_at: atIso,
          finished_at: null,
        },
        storeWriteOptions({ signal, deadlineAt }),
      );
    } catch { requeued = null; }
    if (requeued?.ok === true && requeued.updated === true) {
      const job = jobFromRow(rowsOf(requeued)[0]) || {
        ...current, status: "queued", result, leaseToken: "", leaseOwner: "", leaseExpiresAt: null, updatedAt: atIso,
      };
      return { ok: true, reused: false, job: publicJob(job) };
    }
    const reread = await getHeroReelJob(id);
    if (
      reread.ok
      && reread.job.status === "queued"
      && exactApprovedClipSha(reread.job) === approvedSha
      && reread.job.result?.action === "requeue_upload"
      && reread.job.result?.settled_by_lease === token
    ) return { ok: true, reused: true, job: publicJob(reread.job) };
    return { ok: false, error: reread.ok ? "capability_lease_conflict" : "hero_reel_queue_unavailable" };
  }

  async function candidateRows(status, atIso = nowDate().toISOString(), producer = "") {
    const producerFilter = producer ? `&producer=eq.${encodeURIComponent(producer)}` : "";
    const query = status === "queued"
      // A requeue advances updated_at, rotating that row behind work that has
      // not had a turn yet. attempts breaks a same-tick tie in favor of fresh
      // work; immutable creation identity finishes the deterministic order.
      // Leases/CAS still decide which worker actually owns the row.
      ? `?select=*&status=eq.queued${producerFilter}&or=${encodeURIComponent(`(lease_token.is.null,lease_expires_at.lte.${atIso})`)}&order=updated_at.asc,attempts.asc,created_at.asc,job_id.asc&limit=${CLAIM_SCAN_LIMIT}`
      : `?select=*&status=eq.running${producerFilter}&order=lease_expires_at.asc&limit=${CLAIM_SCAN_LIMIT}`;
    const read = await deps.select(HERO_REEL_JOBS_TABLE, query).catch(() => null);
    if (!read || read.ok !== true) return null;
    return rowsOf(read);
  }

  async function claimNextHeroReelJob({ workerId, producer, leaseMs: requestedLeaseMs, signal, deadlineAt } = {}) {
    const owner = safeId(workerId);
    if (!owner) return { ok: false, error: "worker_id_required" };
    const requestedProducer = text(producer);
    const producerLane = requestedProducer
      ? normalizeDurableHeroProducer(requestedProducer, deps.env)
      : "";
    if (requestedProducer && !producerLane) {
      return { ok: false, error: "producer_not_enabled", allowed: [...DURABLE_HERO_PRODUCERS] };
    }
    const leaseDuration = leaseMs(requestedLeaseMs);
    const at = nowDate();
    const atIso = at.toISOString();
    const expiresAt = new Date(at.getTime() + leaseDuration).toISOString();
    const queued = await candidateRows("queued", atIso, producerLane);
    if (queued === null) return { ok: false, error: "hero_reel_queue_unavailable" };
    let candidates = queued;
    if (!candidates.length) {
      const running = await candidateRows("running", atIso, producerLane);
      if (running === null) return { ok: false, error: "hero_reel_queue_unavailable" };
      candidates = running.filter((raw) => {
        const expires = Date.parse(String(raw?.lease_expires_at || ""));
        return !Number.isFinite(expires) || expires <= at.getTime();
      });
    }

    let skippedHaltedParent = false;
    for (const raw of candidates) {
      const current = jobFromRow(raw);
      if (!current?.jobId) continue;
      // The server-side query is the fast lane filter; this second check keeps
      // a test double or stale API proxy from ever crossing producers.
      if (producerLane && current.producer !== producerLane) continue;
      const acceptedBudget = acceptedSeedanceJobBudget(current, { env: deps.env, now: at });
      if (!acceptedBudget.ok) {
        const guards = current.status === "queued"
          ? current.leaseToken
            ? { status: "eq.queued", lease_token: `eq.${current.leaseToken}`, lease_expires_at: `lte.${atIso}` }
            : { status: "eq.queued", lease_token: "is.null" }
          : {
            status: "eq.running",
            lease_token: `eq.${current.leaseToken}`,
            lease_expires_at: `lte.${atIso}`,
          };
        guards.producer = `eq.${current.producer}`;
        await deps.conditionalUpdate(
          HERO_REEL_JOBS_TABLE,
          "job_id",
          current.jobId,
          guards,
          {
            status: "failed",
            result: {
              ...(current.result || {}),
              ok: false,
              reason: acceptedBudget.reason,
              action: "fail",
              settled_at: atIso,
            },
            lease_token: null,
            lease_owner: null,
            lease_expires_at: null,
            finished_at: atIso,
            updated_at: atIso,
          },
          storeWriteOptions({ signal, deadlineAt }),
        ).catch(() => null);
        continue;
      }
      const parent = await parentBatchGate(current, { signal, deadlineAt });
      if (!parent.ok) return { ok: false, error: parent.error };
      if (parent.halted) {
        skippedHaltedParent = true;
        continue;
      }
      const token = deps.newLeaseToken();
      const guards = current.status === "queued"
        ? current.leaseToken
          ? { status: "eq.queued", lease_token: `eq.${current.leaseToken}`, lease_expires_at: `lte.${atIso}` }
          : { status: "eq.queued", lease_token: "is.null" }
        : {
          status: "eq.running",
          lease_token: `eq.${current.leaseToken}`,
          lease_expires_at: `lte.${atIso}`,
        };
      guards.producer = `eq.${current.producer}`;
      let claimed;
      try {
        claimed = await deps.conditionalUpdate(
          HERO_REEL_JOBS_TABLE,
          "job_id",
          current.jobId,
          guards,
          {
            status: "running",
            attempts: current.attempts + 1,
            lease_token: token,
            lease_owner: owner,
            lease_expires_at: expiresAt,
            updated_at: atIso,
            finished_at: null,
          },
          storeWriteOptions({ signal, deadlineAt }),
        );
      } catch {
        claimed = null;
      }
      if (claimed?.ok === true && claimed.updated === true) {
        const job = jobFromRow(rowsOf(claimed)[0]) || {
          ...current,
          status: "running",
          attempts: current.attempts + 1,
          leaseToken: token,
          leaseOwner: owner,
          leaseExpiresAt: expiresAt,
          updatedAt: atIso,
        };
        return { ok: true, job: claimedJob(job) };
      }
    }
    return { ok: true, job: null, ...(skippedHaltedParent ? { skipped: "parent_line_batch_halted" } : {}) };
  }

  async function validateHeroReelJobLease({ jobId, leaseToken, prospectId } = {}) {
    const id = safeId(jobId);
    const token = text(leaseToken);
    const prospect = safeId(prospectId);
    if (!id) return { ok: false, error: "job_id_required" };
    if (!token) return { ok: false, error: "lease_token_required" };
    if (!prospect) return { ok: false, error: "prospect_id_required" };
    const found = await getHeroReelJob(id);
    if (!found.ok) return found;
    const job = found.job;
    const expires = Date.parse(String(job.leaseExpiresAt || ""));
    if (
      job.status !== "running"
      || job.prospectId !== prospect
      || job.leaseToken !== token
      || !Number.isFinite(expires)
      || expires <= nowDate().getTime()
    ) {
      return { ok: false, error: "lease_conflict", status: job.status };
    }
    return { ok: true, job };
  }

  /**
   * Extend one live worker lease without changing attempts or job status.
   *
   * The expiry value read above is part of the conditional PATCH so two
   * heartbeats cannot race a shorter lease over a longer one. A lost successful
   * response is recovered by the read-back path, but a different worker, token,
   * expired lease, or already-settled row can never be renewed.
   */
  async function renewHeroReelJobLease({
    jobId, leaseToken, workerId, leaseMs: requestedLeaseMs, signal, deadlineAt,
  } = {}) {
    const id = safeId(jobId);
    const token = text(leaseToken);
    const owner = safeId(workerId);
    if (!id) return { ok: false, error: "job_id_required" };
    if (!token) return { ok: false, error: "lease_token_required" };
    if (!owner) return { ok: false, error: "worker_id_required" };

    const found = await getHeroReelJob(id);
    if (!found.ok) return found;
    const current = found.job;
    const at = nowDate();
    const atIso = at.toISOString();
    const currentExpiryMs = Date.parse(String(current.leaseExpiresAt || ""));
    if (
      current.status !== "running"
      || current.leaseToken !== token
      || current.leaseOwner !== owner
      || !Number.isFinite(currentExpiryMs)
      || currentExpiryMs <= at.getTime()
    ) {
      return { ok: false, error: "lease_conflict", status: current.status };
    }

    const requestedExpiryMs = at.getTime() + leaseMs(requestedLeaseMs);
    // A heartbeat may confirm a lease that already has a longer bounded window,
    // but it must never shorten that window. Even that confirmation goes
    // through the conditional PATCH below so every success is atomic with the
    // running/token/owner/old-expiry checks.
    const targetExpiryMs = Math.max(currentExpiryMs, requestedExpiryMs);
    const expiresAt = new Date(targetExpiryMs).toISOString();

    let renewed;
    try {
      renewed = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        id,
        {
          status: "eq.running",
          lease_token: `eq.${token}`,
          lease_owner: `eq.${owner}`,
          lease_expires_at: `eq.${current.leaseExpiresAt}`,
        },
        {
          lease_expires_at: expiresAt,
          updated_at: atIso,
        },
        storeWriteOptions({ signal, deadlineAt }),
      );
    } catch {
      renewed = null;
    }
    if (renewed?.ok === true && renewed.updated === true) {
      const job = jobFromRow(rowsOf(renewed)[0]) || {
        ...current,
        leaseExpiresAt: expiresAt,
        updatedAt: atIso,
      };
      return {
        ok: true,
        reused: false,
        job: publicJob(job),
        lease_expires_at: expiresAt,
      };
    }

    // The PATCH may have landed even when its response was lost, or another
    // same-worker heartbeat may have already installed an equal/longer expiry.
    const reread = await getHeroReelJob(id);
    const rereadExpiryMs = reread.ok
      ? Date.parse(String(reread.job.leaseExpiresAt || ""))
      : NaN;
    if (
      reread.ok
      && reread.job.status === "running"
      && reread.job.leaseToken === token
      && reread.job.leaseOwner === owner
      && Number.isFinite(rereadExpiryMs)
      && rereadExpiryMs >= targetExpiryMs
    ) {
      return {
        ok: true,
        reused: true,
        job: publicJob(reread.job),
        lease_expires_at: new Date(rereadExpiryMs).toISOString(),
      };
    }
    return {
      ok: false,
      error: reread.ok ? "lease_conflict" : "hero_reel_queue_unavailable",
      ...(reread.ok ? { status: reread.job.status } : {}),
    };
  }

  function normalizeSeedanceCheckpoint(raw, current) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const state = text(raw.submission_state);
    const sourceSha = text(raw.source_sha256).toLowerCase();
    const sourceMime = text(raw.source_mime).toLowerCase();
    const sourceBytes = Number(raw.source_bytes);
    const pollingUrl = text(raw.polling_url);
    const providerJobId = safeId(raw.provider_job_id);
    const expectedDuration = frozenSeedanceDuration(current);
    if (expectedDuration === null) return null;
    const expectedIntent = createHash("sha256").update(Buffer.from(stableSerialize({
      schema: SEEDANCE_CHECKPOINT_SCHEMA,
      job_id: current.jobId,
      prospect_id: current.prospectId,
      generation_revision: generationRevision(current.payload),
      source_sha256: sourceSha,
      model_id: SEEDANCE_MODEL_ID,
      duration_seconds: expectedDuration,
    }))).digest("hex");
    const sourceExists = Array.isArray(current.payload?.photo_bank?.photos)
      && current.payload.photo_bank.photos.some((photo) => (
        text(photo?.sha256).toLowerCase() === sourceSha
        && text(photo?.asset_type) === "real_scene"
        && ["own_site", "gbp"].includes(text(photo?.source))
      ));
    let parsedPolling;
    try { parsedPolling = pollingUrl ? new URL(pollingUrl) : null; } catch { return null; }
    if (
      current.producer !== OPENROUTER_SEEDANCE_PRODUCER
      || raw.schema_version !== SEEDANCE_CHECKPOINT_SCHEMA
      || raw.job_id !== current.jobId
      || raw.prospect_id !== current.prospectId
      || Number(raw.generation_revision) !== generationRevision(current.payload)
      || !sourceExists
      || !SEEDANCE_SOURCE_MIMES.has(sourceMime)
      || !Number.isInteger(sourceBytes)
      || sourceBytes < 1
      || sourceBytes > MAX_SEEDANCE_SOURCE_BYTES
      || raw.model_id !== SEEDANCE_MODEL_ID
      || Number(raw.duration_seconds) !== expectedDuration
      || text(raw.intent_sha256).toLowerCase() !== expectedIntent
      || !["intent", "submitting", "accepted"].includes(state)
      || (state === "accepted" && (!parsedPolling || !providerJobId))
      || (state !== "accepted" && (pollingUrl || providerJobId))
      || (parsedPolling && (
        parsedPolling.origin !== "https://openrouter.ai"
        || !parsedPolling.pathname.startsWith("/api/v1/videos/")
        || parsedPolling.username
        || parsedPolling.password
        || (parsedPolling.port && parsedPolling.port !== "443")
      ))
    ) return null;
    return {
      schema_version: SEEDANCE_CHECKPOINT_SCHEMA,
      job_id: current.jobId,
      prospect_id: current.prospectId,
      generation_revision: generationRevision(current.payload),
      source_sha256: sourceSha,
      source_mime: sourceMime,
      source_bytes: sourceBytes,
      model_id: SEEDANCE_MODEL_ID,
      duration_seconds: expectedDuration,
      intent_sha256: expectedIntent,
      submission_state: state,
      polling_url: parsedPolling ? parsedPolling.toString() : "",
      ...(providerJobId ? { provider_job_id: providerJobId } : {}),
      ...(text(raw.created_at) ? { created_at: safeText(raw.created_at, 80) } : {}),
      ...(text(raw.submit_started_at) ? { submit_started_at: safeText(raw.submit_started_at, 80) } : {}),
      ...(text(raw.submitted_at) ? { submitted_at: safeText(raw.submitted_at, 80) } : {}),
    };
  }

  /** Persist the paid-provider boundary on the durable queue row without settling it. */
  async function checkpointHeroReelJob({ jobId, leaseToken, checkpoint, signal, deadlineAt } = {}) {
    const id = safeId(jobId);
    const token = text(leaseToken);
    if (!id) return { ok: false, error: "job_id_required" };
    if (!token) return { ok: false, error: "lease_token_required" };
    const found = await getHeroReelJob(id);
    if (!found.ok) return found;
    const current = found.job;
    const at = nowDate();
    const atIso = at.toISOString();
    const expires = Date.parse(String(current.leaseExpiresAt || ""));
    if (
      current.status !== "running"
      || current.leaseToken !== token
      || !Number.isFinite(expires)
      || expires <= at.getTime()
    ) return { ok: false, error: "lease_conflict", status: current.status };
    const normalized = normalizeSeedanceCheckpoint(checkpoint, current);
    if (!normalized) return { ok: false, error: "seedance_provider_checkpoint_invalid" };
    const previous = current.result?.provider_checkpoint;
    if (previous) {
      const oldCheckpoint = normalizeSeedanceCheckpoint(previous, current);
      if (!oldCheckpoint) return { ok: false, error: "seedance_provider_checkpoint_conflict" };
      if (stableSerialize(oldCheckpoint) === stableSerialize(normalized)) {
        return { ok: true, reused: true, checkpoint: normalized };
      }
      const allowed = oldCheckpoint.submission_state === "intent" && normalized.submission_state === "submitting"
        || oldCheckpoint.submission_state === "submitting" && normalized.submission_state === "accepted";
      if (!allowed || oldCheckpoint.intent_sha256 !== normalized.intent_sha256) {
        return { ok: false, error: "seedance_provider_checkpoint_conflict" };
      }
    } else if (normalized.submission_state !== "intent") {
      return { ok: false, error: "seedance_provider_checkpoint_conflict" };
    }
    let saved;
    try {
      saved = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        id,
        { status: "eq.running", lease_token: `eq.${token}`, lease_expires_at: `gt.${atIso}` },
        {
          result: { ...(current.result || {}), provider_checkpoint: normalized },
          updated_at: atIso,
        },
        storeWriteOptions({ signal, deadlineAt }),
      );
    } catch { saved = null; }
    if (saved?.ok === true && saved.updated === true) {
      return { ok: true, reused: false, checkpoint: normalized };
    }
    const reread = await getHeroReelJob(id);
    const durable = reread.ok ? normalizeSeedanceCheckpoint(reread.job.result?.provider_checkpoint, reread.job) : null;
    if (durable && stableSerialize(durable) === stableSerialize(normalized)) {
      return { ok: true, reused: true, checkpoint: durable };
    }
    return { ok: false, error: reread.ok ? "lease_conflict" : "hero_reel_queue_unavailable" };
  }

  async function settleHeroReelJob({
    jobId, action, leaseToken, verdict, signal, deadlineAt, authority, capabilitySettlement,
  } = {}) {
    const id = safeId(jobId);
    const token = text(leaseToken);
    const operation = text(action).toLowerCase();
    if (!id) return { ok: false, error: "job_id_required" };
    if (!token) return { ok: false, error: "lease_token_required" };
    if (!SETTLE_ACTIONS.includes(operation)) {
      return { ok: false, error: "invalid_action", allowed: [...SETTLE_ACTIONS] };
    }
    const found = await getHeroReelJob(id);
    if (!found.ok) return found;
    const current = found.job;
    if (operation === "requeue") {
      const parent = await parentBatchGate(current, { signal, deadlineAt });
      if (!parent.ok) return { ok: false, error: parent.error, retryable: true };
      if (parent.halted) return { ok: false, error: "parent_line_batch_halted", terminal: true };
    }
    const targetStatus = operation === "complete"
      ? "done"
      : operation === "refuse"
        ? "refused"
        : operation === "fail"
          ? "failed"
          : operation === "hold"
            ? "awaiting_review"
            : "queued";

    // Idempotent retry after the settlement response was lost.
    if (current.status === targetStatus && current.result?.settled_by_lease === token) {
      return { ok: true, reused: true, job: publicJob(current) };
    }

    const at = nowDate();
    const atIso = at.toISOString();
    const expires = Date.parse(String(current.leaseExpiresAt || ""));
    if (
      current.status !== "running"
      || current.leaseToken !== token
      || !Number.isFinite(expires)
      || expires <= at.getTime()
    ) {
      return { ok: false, error: "lease_conflict", status: current.status };
    }
    if (operation === "complete" && authority !== VERIFIED_UPLOAD_AUTHORITY) {
      return { ok: false, error: "completion_requires_verified_upload", status: current.status };
    }
    if (
      operation === "complete"
      && authority === VERIFIED_UPLOAD_AUTHORITY
      && safeId(verdict?.upload_receipt?.record?.prospect_id) !== current.prospectId
    ) {
      return { ok: false, error: "verified_upload_receipt_prospect_mismatch", status: current.status };
    }
    let cleanVerdict = verdict && typeof verdict === "object" && !Array.isArray(verdict)
      ? withoutLeaseSecrets(JSON.parse(JSON.stringify(verdict)))
      : {};
    if (Object.prototype.hasOwnProperty.call(cleanVerdict, "provider_checkpoint")) {
      const checkpoint = normalizeSeedanceCheckpoint(cleanVerdict.provider_checkpoint, current);
      if (!checkpoint) return { ok: false, error: "seedance_provider_checkpoint_invalid" };
      cleanVerdict.provider_checkpoint = checkpoint;
    }
    if (operation === "hold") {
      const submitReview = cleanVerdict.provider_submission_review;
      if (text(cleanVerdict.reason) === SEEDANCE_SUBMIT_REVIEW_REASON) {
        const expectedKeys = [
          "duration_seconds", "intent_sha256", "model_id", "schema_version",
          "source_sha256", "submit_started_at",
        ];
        const submittedAt = Date.parse(text(submitReview?.submit_started_at));
        const sourceSha = text(submitReview?.source_sha256).toLowerCase();
        const expectedDuration = frozenSeedanceDuration(current);
        const expectedIntentSha = createHash("sha256").update(Buffer.from(stableSerialize({
          schema: "wss.hero.seedance_provider_checkpoint.v1",
          job_id: current.jobId,
          prospect_id: current.prospectId,
          generation_revision: generationRevision(current.payload),
          source_sha256: sourceSha,
          model_id: SEEDANCE_MODEL_ID,
          duration_seconds: expectedDuration,
        }))).digest("hex");
        const sourceExists = Array.isArray(current.payload?.photo_bank?.photos)
          && current.payload.photo_bank.photos.some((photo) => (
            text(photo?.sha256).toLowerCase() === sourceSha
            && text(photo?.asset_type) === "real_scene"
          ));
        if (
          current.producer !== OPENROUTER_SEEDANCE_PRODUCER
          || text(cleanVerdict.producer) !== OPENROUTER_SEEDANCE_PRODUCER
          || text(cleanVerdict.generator) !== OPENROUTER_SEEDANCE_PRODUCER
          || Number(cleanVerdict.generation_revision) !== generationRevision(current.payload)
          || !submitReview
          || Object.keys(submitReview).sort().join(",") !== expectedKeys.sort().join(",")
          || submitReview.schema_version !== "wss.hero.seedance_submit_review.v1"
          || text(submitReview.intent_sha256).toLowerCase() !== expectedIntentSha
          || expectedDuration === null
          || !sourceExists
          || submitReview.model_id !== SEEDANCE_MODEL_ID
          || Number(submitReview.duration_seconds) !== expectedDuration
          || !Number.isFinite(submittedAt)
          || submittedAt > at.getTime() + 60_000
        ) return { ok: false, error: "seedance_submit_review_invalid" };
        cleanVerdict = {
          producer: OPENROUTER_SEEDANCE_PRODUCER,
          generator: OPENROUTER_SEEDANCE_PRODUCER,
          generation_revision: generationRevision(current.payload),
          provider_submission_review: {
            schema_version: submitReview.schema_version,
            intent_sha256: text(submitReview.intent_sha256).toLowerCase(),
            source_sha256: sourceSha,
            model_id: submitReview.model_id,
            duration_seconds: expectedDuration,
            submit_started_at: new Date(submittedAt).toISOString(),
          },
          reason: SEEDANCE_SUBMIT_REVIEW_REASON,
        };
      } else {
        const receipt = approvedArtifactFromVerdict(cleanVerdict, current);
        if (!receipt.ok) return { ok: false, error: receipt.error };
        const reviewCandidates = reviewCandidatesFromVerdict(cleanVerdict, current);
        if (!reviewCandidates.ok) {
          return {
            ok: false,
            error: reviewCandidates.error,
            ...(reviewCandidates.detail ? { detail: reviewCandidates.detail } : {}),
          };
        }
        if (reviewCandidates.candidates) {
          const primary = reviewCandidates.candidates.find((candidate) => (
            candidate.sha256 === receipt.artifact.clip_sha256
          ));
          let primaryMatches = false;
          try {
            primaryMatches = Boolean(primary)
              && stableSerialize(primary.approved_artifact) === stableSerialize(receipt.artifact);
          } catch {
            primaryMatches = false;
          }
          if (!primaryMatches) return { ok: false, error: "review_primary_candidate_mismatch" };
        }
        cleanVerdict = {
          producer: receipt.artifact.producer,
          generator: receipt.artifact.generator,
          clip_sha256: receipt.artifact.clip_sha256,
          generation_revision: receipt.generationRevision,
          approved_artifact: receipt.artifact,
          optimized_asset: receipt.optimizedAsset,
          ...(receipt.generationReceipt ? { generation_receipt: receipt.generationReceipt } : {}),
          ...(reviewCandidates.candidates ? {
            candidates: reviewCandidates.candidates,
            candidate_set_sha256: reviewCandidates.candidateSetSha256,
            bytes: reviewCandidates.candidates.find((candidate) => (
              candidate.sha256 === receipt.artifact.clip_sha256
            )).bytes,
          } : Number(cleanVerdict.bytes) > 0 ? { bytes: Number(cleanVerdict.bytes) } : {}),
          ...(text(cleanVerdict.captured_at) ? { captured_at: safeText(cleanVerdict.captured_at, 80) } : {}),
          reason: safeText(cleanVerdict.reason || "awaiting_owner_review", 240),
        };
      }
    }
    if (cleanVerdict.clip_sha256) cleanVerdict.clip_sha256 = text(cleanVerdict.clip_sha256).toLowerCase();
    if (operation === "complete") {
      const approved = current.payload?.approved_artifact;
      const approvedClip = current.payload?.approved_clip;
      if (
        approvedClip?.approved !== true
        || !approved
        || !/^[0-9a-f]{64}$/i.test(text(approved.clip_sha256))
      ) return { ok: false, error: "approval_required" };
      if (text(cleanVerdict.clip_sha256).toLowerCase() !== text(approved.clip_sha256).toLowerCase()) {
        return { ok: false, error: "approved_clip_sha_mismatch" };
      }
      if (approved.generation_receipt || current.result?.generation_receipt) {
        cleanVerdict.generation_receipt = approved.generation_receipt || current.result.generation_receipt;
        cleanVerdict.producer = current.result.producer || current.producer;
        cleanVerdict.generator = current.result.generator || approved.generator;
      }
    }
    const result = {
      ...cleanVerdict,
      ...(operation === "requeue" && !cleanVerdict.reason ? { reason: "worker_requeued" } : {}),
      ...(operation === "hold" && !cleanVerdict.reason ? { reason: "awaiting_owner_review" } : {}),
      settled_by_lease: token,
      action: operation,
      settled_at: atIso,
    };
    let settled;
    try {
      settled = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        id,
        {
          status: "eq.running",
          lease_token: `eq.${token}`,
          lease_expires_at: `gt.${atIso}`,
          ...(capabilitySettlement ? {
            producer: `eq.${OPENROUTER_SEEDANCE_PRODUCER}`,
            attempts: `eq.${capabilitySettlement.attempt + 1}`,
            lease_owner: `eq.${capabilitySettlement.leaseOwner}`,
            "payload->>generation_revision": `eq.${capabilitySettlement.generationRevision}`,
            "payload->line_handle->>batchId": `eq.${capabilitySettlement.batchId}`,
            "payload->line_handle->>rowId": `eq.${capabilitySettlement.rowId}`,
            "payload->hero_job_capability_grant->>phase": "eq.generate",
            "payload->hero_job_capability_grant->>jti_sha256": `eq.${capabilitySettlement.jtiSha256}`,
            "payload->hero_job_capability_grant->>redeemed_lease_sha256": `eq.${capabilitySettlement.leaseSha256}`,
          } : {}),
        },
        {
          status: targetStatus,
          result,
          lease_token: null,
          lease_owner: null,
          lease_expires_at: null,
          updated_at: atIso,
          finished_at: ["queued", "awaiting_review"].includes(targetStatus) ? null : atIso,
        },
        storeWriteOptions({ signal, deadlineAt }),
      );
    } catch {
      settled = null;
    }
    if (settled?.ok === true && settled.updated === true) {
      const job = jobFromRow(rowsOf(settled)[0]) || {
        ...current,
        status: targetStatus,
        result,
        leaseToken: "",
        leaseOwner: "",
        leaseExpiresAt: null,
        updatedAt: atIso,
        finishedAt: ["queued", "awaiting_review"].includes(targetStatus) ? null : atIso,
      };
      return { ok: true, reused: false, job: publicJob(job) };
    }
    return { ok: false, error: "lease_conflict", status: current.status };
  }

  async function settleHeroReelJobWithCapability({
    jobId, action, leaseToken, verdict, signal, deadlineAt,
  } = {}) {
    const id = safeId(jobId);
    const token = text(leaseToken);
    const operation = text(action).toLowerCase();
    if (!id) return { ok: false, error: "job_id_required" };
    if (!token) return { ok: false, error: "lease_token_required" };
    if (!SETTLE_ACTIONS.includes(operation)) {
      return { ok: false, error: "invalid_action", allowed: [...SETTLE_ACTIONS] };
    }
    const found = await getHeroReelJob(id);
    if (!found.ok) return found;
    const job = found.job;
    const grant = capabilityGrantForJob(job);
    const targetStatus = operation === "complete"
      ? "done"
      : operation === "refuse"
        ? "refused"
        : operation === "fail"
          ? "failed"
          : operation === "hold"
            ? "awaiting_review"
            : "queued";
    const exactGrantLease = Boolean(
      grant
      && grant.phase === "generate"
      && exactCapabilityTarget(job, grant)
      && job.attempts === grant.attempt + 1
      && grant.redeemed_at
      && grant.redeemed_lease_sha256 === sha256Opaque(token)
    );

    // The response may be lost after the durable transition. Replay only the
    // exact outcome from the exact capability-bound lease; a different action
    // with the same token is still a conflict.
    if (
      exactGrantLease
      && job.status === targetStatus
      && job.result?.action === operation
      && job.result?.settled_by_lease === token
    ) return { ok: true, reused: true, job: publicJob(job) };

    const atMs = nowDate().getTime();
    const capBoundMs = Number(grant?.exp) * 1000 - HERO_JOB_CAPABILITY_LEASE_MARGIN_MS;
    if (
      !exactGrantLease
      || job.leaseToken !== token
      || !sameLiveCapabilityLease(job, grant, atMs, capBoundMs)
    ) return { ok: false, error: "capability_lease_conflict", status: job.status };

    return settleHeroReelJob({
      jobId: id,
      action: operation,
      leaseToken: token,
      verdict,
      signal,
      deadlineAt,
      capabilitySettlement: {
        attempt: grant.attempt,
        leaseOwner: heroJobCapabilityLeaseOwner(grant),
        generationRevision: grant.generation_revision,
        batchId: grant.batch_id,
        rowId: grant.row_id,
        jtiSha256: grant.jti_sha256,
        leaseSha256: grant.redeemed_lease_sha256,
      },
    });
  }

  async function completeHeroReelJobAfterUpload({ jobId, leaseToken, receipt, signal, deadlineAt } = {}) {
    const input = receipt && typeof receipt === "object" && !Array.isArray(receipt) ? receipt : {};
    const clipSha256 = text(input.clip_sha256).toLowerCase();
    const url = text(input.url);
    const storage = input.storage && typeof input.storage === "object" ? input.storage : {};
    const audit = input.audit && typeof input.audit === "object" ? input.audit : {};
    const record = input.record && typeof input.record === "object" ? input.record : {};
    const rebuild = input.rebuild && typeof input.rebuild === "object" ? input.rebuild : null;
    const sharedInput = input.shared_release && typeof input.shared_release === "object"
      ? input.shared_release
      : null;
    const publicationCount = Number(Boolean(rebuild)) + Number(Boolean(sharedInput));
    const rebuildJobId = rebuild ? safeId(rebuild.job_id || rebuild.jobId) : "";
    const rebuildLineHandle = rebuild && Object.hasOwn(rebuild, "line_handle")
      ? normalizeLineHandle(rebuild.line_handle)
      : null;
    const sharedRelease = sharedInput
      ? verifiedSharedReleaseReceipt(sharedInput, clipSha256, record.write_id)
      : null;
    if (
      !SHA256_RE.test(clipSha256)
      || !isPublicHttpsUrl(url)
      || text(storage.sha256).toLowerCase() !== clipSha256
      || !safeSingleLine(storage.object_path, 1000)
      || text(audit.type) !== "hero_clip.asset_stored"
      || !safeId(record.prospect_id)
      || publicationCount !== 1
      || (rebuild && (!rebuildJobId
        || (Object.hasOwn(rebuild, "line_handle") && !rebuildLineHandle)))
      || (sharedInput && !sharedRelease)
    ) return { ok: false, error: "verified_upload_receipt_invalid" };
    if (sharedRelease) {
      // A shared completion may wake a Line row after this terminal write. Its
      // receipt cannot choose that row: it must repeat the immutable handle
      // already stored on the leased job (or both sides must be absent for a
      // non-Line job).
      const found = await getHeroReelJob(jobId);
      if (!found.ok) return found;
      const payload = found.job?.payload && typeof found.job.payload === "object"
        ? found.job.payload
        : {};
      const durableHasLineHandle = Object.hasOwn(payload, "line_handle");
      const receiptHasLineHandle = Object.hasOwn(sharedInput, "line_handle");
      const durableLineHandle = normalizeLineHandle(payload.line_handle);
      const receiptLineHandle = normalizeLineHandle(sharedInput.line_handle);
      if ((durableHasLineHandle && !durableLineHandle)
        || durableHasLineHandle !== receiptHasLineHandle
        || (durableLineHandle && (
          durableLineHandle.batchId !== receiptLineHandle?.batchId
          || durableLineHandle.rowId !== receiptLineHandle?.rowId
        ))) return { ok: false, error: "verified_upload_receipt_invalid" };
    }
    const publication = rebuild
      ? { rebuild: { ...withoutLeaseSecrets(rebuild), job_id: rebuildJobId, ...(rebuildLineHandle ? { line_handle: rebuildLineHandle } : {}) } }
      : { shared_release: sharedRelease };
    return settleHeroReelJob({
      jobId,
      action: "complete",
      leaseToken,
      verdict: {
        ok: true,
        clip_sha256: clipSha256,
        url,
        upload_receipt: withoutLeaseSecrets({ storage, audit, record, ...publication }),
        completed_by: "verified_upload",
      },
      signal,
      deadlineAt,
      authority: VERIFIED_UPLOAD_AUTHORITY,
    });
  }

  async function approveHeroReelJob({
    jobId, clipSha256, generationRevision: requestedRevision, approvedBy, approvedAt, signal, deadlineAt,
  } = {}) {
    const id = safeId(jobId);
    const sha256 = text(clipSha256).toLowerCase();
    const approver = text(approvedBy);
    const stamp = text(approvedAt);
    const revision = Number(requestedRevision);
    if (!id) return { ok: false, error: "job_id_required" };
    if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, error: "clip_sha256_required" };
    if (!Number.isInteger(revision) || revision < 1) {
      return { ok: false, error: "generation_revision_required" };
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 ._@:-]{0,119}$/.test(approver)) {
      return { ok: false, error: "approved_by_required" };
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(stamp) || !Number.isFinite(Date.parse(stamp))) {
      return { ok: false, error: "approved_at_invalid" };
    }
    // Validate the client field for contract hygiene, but authority comes from
    // this server's clock, not a caller-controlled approval timestamp.
    const atIso = nowIso();
    const approvalStamp = atIso;
    const found = await getHeroReelJob(id);
    if (!found.ok) return found;
    const current = found.job;
    if (revision !== generationRevision(current.payload)) {
      return { ok: false, error: "approval_revision_mismatch", status: current.status };
    }
    const alreadyApproved = current.payload?.approved_clip;
    if (
      alreadyApproved?.approved === true
      && text(alreadyApproved.sha256).toLowerCase() === sha256
      && current.payload?.approved_artifact
      && current.payload?.optimized_asset
    ) {
      return { ok: true, reused: true, job: publicJob(current) };
    }
    if (current.status !== "awaiting_review") {
      return { ok: false, error: "approval_state_conflict", status: current.status };
    }
    const hasCandidateSet = Object.prototype.hasOwnProperty.call(current.result || {}, "candidates");
    let heldReceipt;
    let approvalGuards;
    if (hasCandidateSet) {
      const heldCandidates = reviewCandidatesFromVerdict(current.result || {}, current);
      if (!heldCandidates.ok || !heldCandidates.candidates) {
        return {
          ok: false,
          error: "approval_artifact_invalid",
          detail: heldCandidates.error || "review_candidates_invalid",
          status: current.status,
        };
      }
      const storedCandidateSetSha256 = text(current.result?.candidate_set_sha256).toLowerCase();
      if (
        !/^[0-9a-f]{64}$/.test(storedCandidateSetSha256)
        || storedCandidateSetSha256 !== heldCandidates.candidateSetSha256
      ) {
        return {
          ok: false,
          error: "approval_artifact_invalid",
          detail: "review_candidate_set_mismatch",
          status: current.status,
        };
      }
      const selected = heldCandidates.candidates.find((candidate) => candidate.sha256 === sha256);
      if (!selected) return { ok: false, error: "approval_sha_mismatch", status: current.status };
      const selectedVerdict = {
        ...(current.result || {}),
        clip_sha256: sha256,
        approved_artifact: selected.approved_artifact,
        generation_receipt: selected.approved_artifact.generation_receipt || current.result?.generation_receipt,
      };
      delete selectedVerdict.candidates;
      heldReceipt = approvedArtifactFromVerdict(selectedVerdict, current);
      if (!heldReceipt.ok || heldReceipt.artifact.clip_sha256 !== sha256) {
        return {
          ok: false,
          error: "approval_artifact_invalid",
          detail: heldReceipt.error || "review_candidate_artifact_invalid",
          status: current.status,
        };
      }
      approvalGuards = {
        status: "eq.awaiting_review",
        "result->>candidate_set_sha256": `eq.${storedCandidateSetSha256}`,
      };
    } else {
      heldReceipt = approvedArtifactFromVerdict(current.result || {}, current);
      if (!heldReceipt.ok) {
        return { ok: false, error: "approval_artifact_invalid", detail: heldReceipt.error, status: current.status };
      }
      if (heldReceipt.artifact.clip_sha256 !== sha256) {
        return { ok: false, error: "approval_sha_mismatch", status: current.status };
      }
      approvalGuards = {
        status: "eq.awaiting_review",
        "result->>clip_sha256": `eq.${sha256}`,
      };
    }
    const approvedClip = {
      approved: true,
      sha256,
      approved_by: approver,
      approved_at: approvalStamp,
    };
    let approved;
    try {
      approved = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        id,
        approvalGuards,
        {
          status: "queued",
          payload: {
            ...(current.payload || {}),
            approved_clip: approvedClip,
            approved_artifact: heldReceipt.artifact,
            optimized_asset: heldReceipt.optimizedAsset,
          },
          result: {
            ...(current.result || {}),
            clip_sha256: sha256,
            approved_artifact: heldReceipt.artifact,
            optimized_asset: heldReceipt.optimizedAsset,
            producer: heldReceipt.artifact.producer,
            generator: heldReceipt.artifact.generator,
            ...(heldReceipt.generationReceipt ? { generation_receipt: heldReceipt.generationReceipt } : {}),
            action: "approve",
            approved: true,
            approved_by: approver,
            approved_at: approvalStamp,
            reason: "",
          },
          lease_token: null,
          lease_owner: null,
          lease_expires_at: null,
          updated_at: atIso,
          finished_at: null,
        },
        storeWriteOptions({ signal, deadlineAt }),
      );
    } catch {
      approved = null;
    }
    if (approved?.ok === true && approved.updated === true) {
      const job = jobFromRow(rowsOf(approved)[0]) || {
        ...current,
        status: "queued",
        payload: {
          ...(current.payload || {}),
          approved_clip: approvedClip,
          approved_artifact: heldReceipt.artifact,
          optimized_asset: heldReceipt.optimizedAsset,
        },
        result: {
          ...(current.result || {}),
          clip_sha256: sha256,
          approved_artifact: heldReceipt.artifact,
          optimized_asset: heldReceipt.optimizedAsset,
          producer: heldReceipt.artifact.producer,
          generator: heldReceipt.artifact.generator,
          ...(heldReceipt.generationReceipt ? { generation_receipt: heldReceipt.generationReceipt } : {}),
          action: "approve", approved: true,
          approved_by: approver, approved_at: approvalStamp, reason: "",
        },
        updatedAt: atIso,
      };
      return { ok: true, reused: false, job: publicJob(job) };
    }
    // Resolve a lost successful response without turning a competing state
    // change into an approval claim.
    const reread = await getHeroReelJob(id);
    if (
      reread.ok
      && reread.job.status === "queued"
      && reread.job.payload?.approved_clip?.approved === true
      && text(reread.job.payload.approved_clip.sha256).toLowerCase() === sha256
    ) {
      return { ok: true, reused: true, job: publicJob(reread.job) };
    }
    return {
      ok: false,
      error: reread.ok && reread.job.status === "awaiting_review"
        ? "approval_sha_mismatch"
        : "approval_state_conflict",
      ...(reread.ok ? { status: reread.job.status } : {}),
    };
  }

  async function reviewHeroReelJob({ jobId, action, reason, reviewedBy, signal, deadlineAt } = {}) {
    const id = safeId(jobId);
    const operation = text(action).toLowerCase();
    const reviewer = text(reviewedBy);
    const why = safeSingleLine(reason, 240);
    if (!id) return { ok: false, error: "job_id_required" };
    if (!["reject", "regenerate"].includes(operation)) {
      return { ok: false, error: "invalid_review_action", allowed: ["reject", "regenerate"] };
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 ._@:-]{0,119}$/.test(reviewer)) {
      return { ok: false, error: "reviewed_by_required" };
    }
    if (!why) return { ok: false, error: "review_reason_required" };
    const found = await getHeroReelJob(id);
    if (!found.ok) return found;
    const current = found.job;
    const oldHistory = Array.isArray(current.payload?.review_history)
      ? current.payload.review_history.slice(-9)
      : [];
    const previous = oldHistory[oldHistory.length - 1];
    const targetStatus = operation === "reject" ? "refused" : "queued";
    if (current.status === targetStatus && previous?.action === operation) {
      return { ok: true, reused: true, job: publicJob(current) };
    }
    if (current.status !== "awaiting_review") {
      return { ok: false, error: "review_state_conflict", status: current.status };
    }
    const reviewedAt = nowIso();
    const audit = {
      action: operation,
      reason: why,
      reviewed_by: reviewer,
      reviewed_at: reviewedAt,
      generation_revision: generationRevision(current.payload),
      ...(current.result?.clip_sha256 ? { clip_sha256: text(current.result.clip_sha256).toLowerCase() } : {}),
      ...(operation === "regenerate" && current.result?.generation_receipt
        ? { previous_generation_receipt: current.result.generation_receipt }
        : {}),
    };
    const nextPayload = {
      ...(current.payload || {}),
      review_history: [...oldHistory, audit],
    };
    if (operation === "regenerate") {
      delete nextPayload.approved_clip;
      delete nextPayload.approved_artifact;
      delete nextPayload.optimized_asset;
      nextPayload.generation_revision = generationRevision(current.payload) + 1;
    }
    let reviewed;
    try {
      reviewed = await deps.conditionalUpdate(
        HERO_REEL_JOBS_TABLE,
        "job_id",
        id,
        { status: "eq.awaiting_review", lease_token: "is.null" },
        {
          status: targetStatus,
          payload: nextPayload,
          result: operation === "reject"
            ? { ...(current.result || {}), ...audit }
            : audit,
          lease_token: null,
          lease_owner: null,
          lease_expires_at: null,
          updated_at: reviewedAt,
          finished_at: operation === "reject" ? reviewedAt : null,
        },
        storeWriteOptions({ signal, deadlineAt }),
      );
    } catch {
      reviewed = null;
    }
    if (reviewed?.ok === true && reviewed.updated === true) {
      const job = jobFromRow(rowsOf(reviewed)[0]) || {
        ...current,
        status: targetStatus,
        payload: nextPayload,
        result: operation === "reject" ? { ...(current.result || {}), ...audit } : audit,
        updatedAt: reviewedAt,
        finishedAt: operation === "reject" ? reviewedAt : null,
      };
      return { ok: true, reused: false, job: publicJob(job) };
    }
    const reread = await getHeroReelJob(id);
    const rereadHistory = reread.ok && Array.isArray(reread.job.payload?.review_history)
      ? reread.job.payload.review_history
      : [];
    if (reread.ok && reread.job.status === targetStatus && rereadHistory.at(-1)?.action === operation) {
      return { ok: true, reused: true, job: publicJob(reread.job) };
    }
    return {
      ok: false,
      error: "review_state_conflict",
      ...(reread.ok ? { status: reread.job.status } : {}),
    };
  }

  return {
    enqueueHeroReelJob,
    recordHeroJobCapabilityGrant,
    claimHeroReelJobWithCapability,
    validateHeroReelJobCapabilityLease,
    renewHeroReelJobCapabilityLease,
    requeueApprovedHeroUpload,
    claimNextHeroReelJob,
    settleHeroReelJob,
    settleHeroReelJobWithCapability,
    completeHeroReelJobAfterUpload,
    renewHeroReelJobLease,
    checkpointHeroReelJob,
    approveHeroReelJob,
    reviewHeroReelJob,
    validateHeroReelJobLease,
    getHeroReelJob,
    getHeroReelJobForProspect,
    sealForeignTerminalForPracticeStatic,
  };
}

const defaults = createHeroReelJobQueue();

module.exports = {
  HERO_REEL_JOBS_TABLE,
  PRACTICE_STATIC_SEAL_SCHEMA,
  PRACTICE_STATIC_SEAL_REASON,
  PRODUCER,
  JOB_STATUSES,
  SETTLE_ACTIONS,
  DEFAULT_LEASE_MS,
  MIN_LEASE_MS,
  MAX_LEASE_MS,
  DEFAULT_STORE_WRITE_TIMEOUT_MS,
  DEFAULT_SEEDANCE_ACCEPTED_CLAIM_CAP,
  DEFAULT_SEEDANCE_ACCEPTED_MAX_AGE_MS,
  createHeroReelJobQueue,
  legacySiteUrl,
  normalizedPhotoBank,
  isPublicHttpsUrl,
  isGoogleMediaUrl,
  isPinnedGoogleBusinessFoundOn,
  trustedGoogleMapsUrl,
  googleBusinessUrlsFromRecord,
  jobFromRow,
  acceptedSeedanceJobBudget,
  publicJob,
  claimedJob,
  storedCapabilityGrant,
  capabilityGrantForJob,
  exactApprovedClipSha,
  practiceStaticSealIdentity,
  practiceStaticSealReceipt,
  verifiedPracticeStaticSeal,
  leaseMs,
  newJobId,
  ...defaults,
};
