'use strict';

/**
 * Desktop worker for the Google Ads Asset Studio remaster -> Animate Image lane.
 * It attaches to the owner's existing browser through the runner. It never
 * launches Chrome, reads a prospect-detail fallback, or sends outreach.
 *
 * GET  /api/admin/hero-reel?next=1&worker_id=<stable> (worker token)
 * POST /api/admin/hero-reel { job_id, action, lease_token, verdict } (worker token)
 *
 * A clip is uploaded only when its exact SHA-256 has an explicit owner approval.
 * Review approval:
 *   node hero-forge-worker.cjs --approve-review <job-id|receipt.json> \
 *     --clip-sha256 <chosen-candidate-sha256> --approved-by owner_console
 */

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {
  hasVerifiedNoPeopleEvidence,
  selectHeroImage,
} = require('../../lib/mirror-engine/hero-image-selector');
const {
  DIRECT_SOURCE_RECIPE_SHA256,
  validateHeroClip,
  MAX_CLIP_BYTES,
} = require('../../lib/hero-clip-validation');
const {
  ADS_PRODUCER,
  WAN_PRODUCER,
  OPENROUTER_SEEDANCE_PRODUCER,
} = require('../../lib/hero-video-policy');
const {
  WAN_DEFAULT_SETTINGS,
  WAN_MODEL_ID,
  WAN_MODEL_REVISION,
  WAN_REMASTER_RECIPE_SHA256,
  stableSerialize,
} = require('../../lib/wan-hero-policy');
const { JOB_SCHEMA_VERSION, runWanJobFile } = require('../wan-hero/wan-i2v-runner.cjs');

const RUNNER = path.join(__dirname, 'animate-image-runner.cjs');
const WAN_SCRIPT = path.join(__dirname, '..', 'wan-hero', 'wan_i2v.py');
const ADS_GENERATOR = 'ads_animate_image';
const IMAGE_PREPARATION_IMAGE_EDITOR = 'image_editor';
const IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO = 'direct_client_photo';
const IMAGE_PREPARATIONS = new Set([
  IMAGE_PREPARATION_IMAGE_EDITOR,
  IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO,
]);
const IMAGE_EDITOR_DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);
const DEFAULT_BASE = 'https://ghost.wss-ai.com';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const DEFAULT_POLL_MS = 30_000;
const DEFAULT_RUNNER_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_LEASE_HEARTBEAT_MS = 10 * 60 * 1000;
const DEFAULT_LEASE_RENEW_MS = 60 * 60 * 1000;
const DEFAULT_LEASE_RENEW_TIMEOUT_MS = 15_000;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_REDIRECTS = 5;
const DEFAULT_FACE_PREFLIGHT_TIMEOUT_MS = 10_000;
// client-photo-bank.js caps the canonical durable source bank at 20. Keep this
// traversal bound source-specific; review-clip limits are a separate contract.
const MAX_SOURCE_PREFLIGHT_CANDIDATES = 20;
const MAX_REVIEW_CANDIDATES = 12;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const OWNED_SOURCES = new Set(['own_site', 'gbp']);
const WORKER_PRODUCERS = new Set([WAN_PRODUCER, ADS_PRODUCER, OPENROUTER_SEEDANCE_PRODUCER]);
const TEMP_PREFIX = 'wss-hero-forge-';
const OPENCV_FACE_PREFLIGHT = String.raw`
import cv2, json, sys
image = cv2.imread(sys.argv[1], cv2.IMREAD_COLOR)
if image is None:
    print(json.dumps({"ok": False, "reason": "face_preflight_unreadable"}))
    raise SystemExit(2)
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
gray = cv2.equalizeHist(gray)
cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
if cascade.empty():
    print(json.dumps({"ok": False, "reason": "face_preflight_unavailable"}))
    raise SystemExit(3)
short_edge = min(image.shape[0], image.shape[1])
minimum = max(64, round(short_edge * 0.055))
faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(minimum, minimum))
print(json.dumps({"ok": True, "faceCount": len(faces)}))
`;
const DEFAULT_WAN_MODEL_SETTINGS = Object.freeze({
  width: WAN_DEFAULT_SETTINGS.width,
  height: WAN_DEFAULT_SETTINGS.height,
  frames: 81,
  steps: WAN_DEFAULT_SETTINGS.numInferenceSteps,
  guidanceScale: WAN_DEFAULT_SETTINGS.guidanceScale,
  seed: 20260822,
  cpuOffload: true,
  quantization: WAN_DEFAULT_SETTINGS.quantization,
});
const WAN_TECHNICAL_FAILURES = new Set([
  'local_model_directory_required',
  'wan_i2v_script_required',
  'python_executable_invalid',
  'ffmpeg_executable_invalid',
  'ffprobe_executable_invalid',
  'estimated_power_watts_required',
  'electricity_rate_required',
  'wan_timeout_invalid',
]);
const WAN_NON_FALLBACK_FAILURES = new Set([
  'prospect_id_required',
  'prospect_domain_required',
  'source_sha256_required',
  'source_type_not_allowed',
  'source_asset_not_real_scene',
  'vertical_not_allowed',
  'overlay_side_not_allowed',
  'preset_not_allowed',
  'duration_preset_mismatch',
  'people_sensitive_vertical_disabled',
  'people_consent_required',
  'vertical_mismatch_sport_fencing',
  'fencing_contracting_required',
  'model_id_required',
  'model_revision_required',
  'model_settings_required',
  'prompt_render_incomplete',
  'wan_model_id_mismatch',
  'wan_model_revision_mismatch',
  'source_sha256_mismatch',
  'wan_result_missing',
  'wan_result_invalid',
  'wan_result_identity_mismatch',
  'wan_result_provenance_missing',
  'optimized_image_upscaled',
  'wan_master_duration_mismatch',
  'browser_video_format_invalid',
  'browser_video_upscaled',
  'browser_video_duration_mismatch',
  'output_directory_not_clean',
  'wan_python_path_boundary_invalid',
]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RUNNER_ENV_ALLOWLIST = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'LANG', 'LC_ALL',
  'TZ', 'ADS_STATION_CDP_URL', 'CDP_URL', 'ADS_STATION_PARAMS',
  'ADS_STATION_BACKGROUND_BROWSER', 'ADS_STATION_BROWSER_EXECUTABLE',
]);
const MAX_RUNNER_REASON_LENGTH = 96;
const SAFE_RUNNER_REASON_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const SENSITIVE_RUNNER_REASON_RE = /(?:^|_)(?:api_?key|authorization|bearer|cookie|credential|password|private_?key|secret|token)(?:_|$)/;
const GENERIC_RUNNER_REASONS = new Set(['command_failed', 'error', 'failed']);

function log(...args) {
  console.log(`[hero-forge ${new Date().toISOString().slice(11, 19)}]`, ...args);
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function first(...values) {
  for (const value of values) {
    const out = clean(value);
    if (out) return out;
  }
  return '';
}

function generationRevision(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function asHttpsUrl(value, { rejectWss = false } = {}) {
  try {
    const parsed = new URL(clean(value));
    if (parsed.protocol !== 'https:') return '';
    if (rejectWss && (parsed.hostname === 'wss-ai.com' || parsed.hostname.endsWith('.wss-ai.com'))) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function trustedGoogleMediaUrl(value) {
  const url = asHttpsUrl(value);
  if (!url) return '';
  const parsed = new URL(url);
  return /(^|\.)(?:googleusercontent|ggpht)\.com$/i.test(parsed.hostname) ? parsed.toString() : '';
}

function trustedGoogleMapsUrl(value) {
  let parsed;
  try { parsed = new URL(clean(value)); } catch { return ''; }
  const host = parsed.hostname.toLowerCase();
  const mapsHost = host === 'maps.google.com' || host.endsWith('.maps.google.com');
  const googleMapsPath = /(^|\.)google\.com$/.test(host) && /^\/maps(?:\/|$)/i.test(parsed.pathname);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || (parsed.port && parsed.port !== '443') || (!mapsHost && !googleMapsPath)) return '';
  parsed.hash = '';
  return parsed.toString();
}

function placePhotoResource(value) {
  const match = /^places\/([^/\s]+)\/photos\/([^/\s]+)$/.exec(clean(value));
  return match ? { resourceName: match[0], placeId: match[1], photoId: match[2] } : null;
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sameSha256(left, right) {
  if (!SHA256_RE.test(clean(left)) || !SHA256_RE.test(clean(right))) return false;
  return crypto.timingSafeEqual(Buffer.from(clean(left), 'hex'), Buffer.from(clean(right), 'hex'));
}

function sameCredential(left, right) {
  const a = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function apiBaseFromEnv(env = process.env) {
  const raw = first(env.GHOST_AGENCY_API_URL, env.GHOST_BASE, DEFAULT_BASE).replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(raw); } catch { throw codedError('GHOST_AGENCY_API_URL_https_required'); }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))) {
    throw codedError('GHOST_AGENCY_API_URL_https_required');
  }
  return raw;
}

function stableWorkerId(env = process.env, hostname = os.hostname()) {
  const configured = first(env.ADS_STATION_WORKER_ID, env.HERO_FORGE_WORKER_ID);
  const raw = configured || `ads-station-${hostname}`;
  return raw.replace(/[^a-zA-Z0-9_.:-]+/g, '-').slice(0, 120) || 'ads-station-worker';
}

function heroProducerAlias(value) {
  const v = clean(value).toLowerCase();
  if (v === 'openrouter') return OPENROUTER_SEEDANCE_PRODUCER;
  if (v === 'compose') return 'hero_compose_local';
  if (v === 'wizard') return ADS_PRODUCER;
  return v;
}

function workerProducerFromEnv(env = process.env) {
  const raw = first(
    env.GHOST_AGENCY_HERO_WORKER_PRODUCER,
    env.HERO_FORGE_PRODUCER,
    env.HERO_PRODUCER,
  );
  const producer = heroProducerAlias(raw) || OPENROUTER_SEEDANCE_PRODUCER;
  if (!WORKER_PRODUCERS.has(producer)) throw codedError('hero_worker_producer_invalid');
  return producer;
}

function normalizeImagePreparation(value, fallback = IMAGE_PREPARATION_IMAGE_EDITOR) {
  const mode = clean(value).toLowerCase();
  if (!mode) return fallback;
  return IMAGE_PREPARATIONS.has(mode) ? mode : '';
}

function imagePreparationFromEnv(env = process.env) {
  return IMAGE_EDITOR_DISABLED_VALUES.has(clean(env.GHOST_AGENCY_HERO_IMAGE_EDITOR).toLowerCase())
    ? IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO
    : IMAGE_PREPARATION_IMAGE_EDITOR;
}

function configFromEnv(env = process.env, options = {}) {
  const timeout = Number(env.HERO_FORGE_RUNNER_TIMEOUT_MS || DEFAULT_RUNNER_TIMEOUT_MS);
  const includeOwnerToken = options.includeOwnerToken === true;
  const workerToken = clean(env.GHOST_AGENCY_HERO_WORKER_TOKEN);
  const ownerToken = clean(env.GHOST_AGENCY_ADMIN_TOKEN);
  const secondaryOwnerToken = clean(env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY);
  return {
    apiBase: apiBaseFromEnv(env),
    workerToken,
    // Parsed only for the explicit --approve-review one-shot process. Normal
    // polling does not retain the owner credential from its parent shell.
    adminToken: includeOwnerToken ? ownerToken : '',
    credentialCollision: Boolean(workerToken && (
      (ownerToken && sameCredential(workerToken, ownerToken))
      || (secondaryOwnerToken && sameCredential(workerToken, secondaryOwnerToken))
    )),
    ownerTokenPresent: Boolean(ownerToken || secondaryOwnerToken),
    cdpUrl: first(env.ADS_STATION_CDP_URL, DEFAULT_CDP_URL),
    adsParams: clean(env.ADS_STATION_PARAMS),
    workerId: stableWorkerId(env),
    producer: workerProducerFromEnv(env),
    imagePreparation: imagePreparationFromEnv(env),
    runnerTimeoutMs: Number.isFinite(timeout) && timeout >= 60_000 ? timeout : DEFAULT_RUNNER_TIMEOUT_MS,
    reviewDir: path.resolve(first(env.HERO_FORGE_REVIEW_DIR) || path.join(os.tmpdir(), 'wss-hero-reviews')),
    wanFallbackAds: clean(env.GHOST_AGENCY_WAN_FALLBACK_ADS) !== '0',
    wanModelPath: first(env.GHOST_AGENCY_WAN_MODEL_PATH, env.WSS_WAN_MODEL_PATH),
    wanPythonExecutable: first(env.GHOST_AGENCY_WAN_PYTHON, env.WSS_WAN_PYTHON, 'python'),
    wanFfmpegExecutable: first(env.GHOST_AGENCY_WAN_FFMPEG, env.WSS_WAN_FFMPEG, 'ffmpeg'),
    wanFfprobeExecutable: first(env.GHOST_AGENCY_WAN_FFPROBE, env.WSS_WAN_FFPROBE, 'ffprobe'),
    wanEstimatedPowerWatts: Number(env.GHOST_AGENCY_WAN_ESTIMATED_POWER_WATTS || env.WSS_WAN_ESTIMATED_POWER_WATTS || 500),
    wanElectricityRateUsdPerKwh: Number(env.GHOST_AGENCY_WAN_ELECTRICITY_RATE_USD_PER_KWH || env.WSS_WAN_ELECTRICITY_RATE_USD_PER_KWH || 0),
    wanTimeoutSeconds: Number(env.GHOST_AGENCY_WAN_TIMEOUT_SECONDS || env.WSS_WAN_TIMEOUT_SECONDS || 7200),
  };
}

function normalizeLeasedJob(raw) {
  const job = raw && typeof raw === 'object' ? raw : {};
  const bank = job.photo_bank && typeof job.photo_bank === 'object' ? job.photo_bank : {};
  const wan = job.wan && typeof job.wan === 'object' ? job.wan : {};
  return {
    raw: job,
    jobId: first(job.job_id, job.jobId),
    leaseToken: first(job.lease_token, job.leaseToken),
    leaseExpiresAt: first(job.lease_expires_at, job.leaseExpiresAt),
    prospectId: first(job.prospect_id, job.prospectId),
    sourceUrl: asHttpsUrl(first(job.source_url, job.sourceUrl), { rejectWss: true }),
    producer: first(job.producer) || ADS_PRODUCER,
    businessName: first(job.business_name, job.businessName),
    vertical: first(job.vertical, job.industry, job.category, wan.vertical),
    sourceAssetType: first(job.source_asset_type, job.sourceAssetType, wan.sourceAssetType),
    overlaySide: first(job.overlay_side, job.overlaySide, wan.overlaySide, 'left'),
    preset: first(job.preset, wan.preset, 'cheap_5s'),
    fencingClassification: first(job.fencing_classification, job.fencingClassification, wan.fencingClassification),
    gbpCategory: first(job.gbp_category, job.gbpCategory, wan.gbpCategory),
    siteText: first(job.site_text, job.siteText, wan.siteText),
    allowPeopleSensitive: job.allow_people_sensitive === true || job.allowPeopleSensitive === true || wan.allowPeopleSensitive === true,
    peopleConsentVerified: job.people_consent_verified === true || job.peopleConsentVerified === true || wan.peopleConsentVerified === true,
    containsRecognizablePeople: job.contains_recognizable_people === true
      || job.containsRecognizablePeople === true
      || wan.containsRecognizablePeople === true,
    modelSettings: job.model_settings && typeof job.model_settings === 'object'
      ? job.model_settings
      : wan.modelSettings && typeof wan.modelSettings === 'object'
        ? wan.modelSettings
        : null,
    wanRuntime: wan.runtime && typeof wan.runtime === 'object' ? wan.runtime : {},
    photos: Array.isArray(bank.photos) ? bank.photos : [],
    placeId: first(bank.place_id, job.place_id, job.placeId),
    gbpProfileUrls: (Array.isArray(bank.gbp_profile_urls) ? bank.gbp_profile_urls : [])
      .map(trustedGoogleMapsUrl).filter(Boolean),
    adsParams: first(job.ads_params, job.adsParams),
    remasterPrompt: first(job.remaster_prompt, job.remasterPrompt),
    imagePreparation: normalizeImagePreparation(first(job.image_preparation, job.imagePreparation)),
    approval: job.approved_clip || job.approvedClip || job.approval || null,
    approvedArtifact: job.approved_artifact || job.approvedArtifact || null,
    optimizedAsset: job.optimized_asset || job.optimizedAsset || null,
    generationRevision: generationRevision(job.generation_revision || job.generationRevision),
  };
}

function normalizeOwnedCandidate(candidate, job = {}) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const url = asHttpsUrl(c.url);
  const sha256 = clean(c.sha256).toLowerCase();
  const source = clean(c.source).toLowerCase();
  const foundOn = clean(c.found_on || c.foundOn);
  if (!url || !SHA256_RE.test(sha256) || !OWNED_SOURCES.has(source) || !foundOn) return null;
  if (c.stock_caption_suspect === true) return null;
  if (source === 'own_site' && !asHttpsUrl(foundOn, { rejectWss: true })) return null;
  if (source === 'gbp') {
    const placeId = first(c.place_id, c.placeId);
    const resource = placePhotoResource(c.resource_name || c.resourceName);
    const mapsUrl = foundOn === 'google_business_profile' ? foundOn : trustedGoogleMapsUrl(foundOn);
    if (!trustedGoogleMediaUrl(url)
      || !placeId
      || placeId !== clean(job.placeId)
      || !resource
      || resource.placeId !== placeId
      || !mapsUrl
      || (mapsUrl !== 'google_business_profile' && !job.gbpProfileUrls.includes(mapsUrl))) return null;
  }
  return {
    ...c,
    url,
    sha256,
    source,
    found_on: foundOn,
    width: Number.isFinite(Number(c.width)) ? Number(c.width) : undefined,
    height: Number.isFinite(Number(c.height)) ? Number(c.height) : undefined,
    bytes: Number.isFinite(Number(c.bytes)) ? Number(c.bytes) : undefined,
    sourceContext: source,
  };
}

function verifiedCandidates(job) {
  return job.photos.map((candidate) => normalizeOwnedCandidate(candidate, job)).filter(Boolean);
}

function directSourceExtension(candidate) {
  const declared = clean(candidate && candidate.ext).toLowerCase().replace(/^\./, '');
  if (declared) return declared === 'jpeg' ? 'jpg' : (declared === 'jpg' || declared === 'png' ? declared : '');
  try {
    const match = new URL(asHttpsUrl(candidate && candidate.url)).pathname.match(/\.((?:jpe?g)|png)$/i);
    if (!match) return '';
    return /^jpe?g$/i.test(match[1]) ? 'jpg' : 'png';
  } catch {
    return '';
  }
}

function selectOwnedCandidate(job, selector = selectHeroImage, options = {}) {
  const preparation = normalizeImagePreparation(options.imagePreparation);
  const verified = verifiedCandidates(job);
  const candidates = preparation === IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO
    ? verified.filter((candidate) => Boolean(directSourceExtension(candidate)))
    : verified;
  const selected = selector(candidates);
  const result = selected && typeof selected === 'object' ? selected : {};
  // A caller-supplied selector may intentionally refuse every candidate (for
  // example selectHeroImage(..., { minScore: 90 })). Preserve that decision;
  // bank order is only the default selector's tie-break among its survivors.
  if (selector !== selectHeroImage || !result.best) return { ...result, best: result.best || null, candidates };
  // client-photo-bank has already paid the cost to grade and order these rows;
  // that order is the product contract. The downstream selector remains the
  // semantic veto (logo, promo graphic, portrait, identity-critical), but it
  // must not reshuffle surviving bank rows and put a large marketing card ahead
  // of the real work photo the bank ranked first.
  const survivors = new Set((result.ranked || []).map((row) => row && row.candidate).filter(Boolean));
  const bankBest = candidates.find((candidate) => survivors.has(candidate)) || null;
  return { ...result, best: bankBest || result.best, candidates };
}

function selectedCandidatesInBankOrder(selection) {
  const result = selection && typeof selection === 'object' ? selection : {};
  if (!Array.isArray(result.ranked) || result.ranked.length === 0) {
    return result.best ? [result.best] : [];
  }
  const survivors = new Set((result.ranked || []).map((row) => row && row.candidate).filter(Boolean));
  return (result.candidates || []).filter((candidate) => survivors.has(candidate));
}

function imageExtension(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'))) return '.gif';
  if (b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp' && /avif|avis/.test(b.subarray(8, 16).toString('ascii'))) return '.avif';
  return '';
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function facePreflightEnv(env = process.env) {
  const safe = { PYTHONIOENCODING: 'utf-8' };
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (typeof env[name] === 'string' && env[name]) safe[name] = env[name];
  }
  return safe;
}

function detectFacesWithOpenCv(filePath, options = {}) {
  const execImpl = options.execFileImpl || execFile;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_FACE_PREFLIGHT_TIMEOUT_MS;
  const python = first(options.pythonExecutable, 'python');
  return new Promise((resolve) => {
    execImpl(python, ['-c', OPENCV_FACE_PREFLIGHT, path.resolve(filePath)], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024,
      windowsHide: true,
      env: facePreflightEnv(options.env || process.env),
    }, (error, stdout) => {
      let parsed = null;
      try {
        parsed = JSON.parse(String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || 'null');
      } catch (_) {
        parsed = null;
      }
      if (!error && parsed && parsed.ok === true && Number.isInteger(parsed.faceCount) && parsed.faceCount >= 0) {
        resolve({ ok: true, faceCount: parsed.faceCount });
        return;
      }
      if (parsed && parsed.reason === 'face_preflight_unreadable') {
        resolve({ ok: false, reason: 'face_preflight_unreadable' });
        return;
      }
      const code = String(error && error.code || '').toUpperCase();
      const timedOut = Boolean(error && (error.killed === true || code === 'ETIMEDOUT'));
      resolve({ ok: false, reason: timedOut ? 'face_preflight_timeout' : 'face_preflight_unavailable' });
    });
  });
}

async function preparePeopleFreeSource(selection, workDir, options = {}) {
  const candidates = selectedCandidatesInBankOrder(selection).slice(0, MAX_SOURCE_PREFLIGHT_CANDIDATES);
  const downloadImpl = options.downloadImpl || downloadAndVerifySource;
  const detector = options.faceDetector || detectFacesWithOpenCv;
  let inconclusive = false;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidateDir = path.join(workDir, `source-${index + 1}`);
    await fs.promises.mkdir(candidateDir, { recursive: false });
    const source = await downloadImpl(candidate, candidateDir, options.fetchImpl || fetch, {
      lookupImpl: options.lookupImpl,
    });

    if (hasVerifiedNoPeopleEvidence(candidate)) return { candidate, source };

    const detection = await detector(source.filePath, {
      timeoutMs: options.facePreflightTimeoutMs,
      env: options.env || process.env,
    });
    if (detection && detection.ok === true && Number.isInteger(detection.faceCount)) {
      if (detection.faceCount === 0) return { candidate, source };
      continue;
    }
    if (detection && detection.reason === 'face_preflight_unreadable') {
      inconclusive = true;
      continue;
    }

    // The detector is unavailable or timed out. Filename silence is not proof;
    // fall through only to an explicitly people-free owned survivor.
    const explicitIndex = candidates.findIndex((entry, candidateIndex) => (
      candidateIndex > index && hasVerifiedNoPeopleEvidence(entry)
    ));
    if (explicitIndex >= 0) {
      const explicit = candidates[explicitIndex];
      const explicitDir = path.join(workDir, `source-${explicitIndex + 1}`);
      await fs.promises.mkdir(explicitDir, { recursive: false });
      const explicitSource = await downloadImpl(explicit, explicitDir, options.fetchImpl || fetch, {
        lookupImpl: options.lookupImpl,
      });
      return { candidate: explicit, source: explicitSource };
    }
    throw codedError('people_free_evidence_required');
  }

  throw codedError(inconclusive ? 'people_free_evidence_required' : 'no_people_free_owned_photo');
}

function ipv4Bytes(address) {
  const parts = String(address || '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  if (bytes.some((part) => part < 0 || part > 255)) return null;
  return bytes;
}

function ipv6Bytes(address) {
  let input = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!input || input.split('::').length > 2) return null;
  let ipv4Tail = null;
  const tailMatch = input.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tailMatch) {
    ipv4Tail = ipv4Bytes(tailMatch[1]);
    if (!ipv4Tail) return null;
    input = input.slice(0, -tailMatch[1].length) + `${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16)}`;
  }
  const halves = input.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - left.length - right.length;
  if ((halves.length === 1 && fill !== 0) || (halves.length === 2 && fill < 1)) return null;
  const words = [...left, ...Array(Math.max(0, fill)).fill('0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[a-f0-9]{1,4}$/.test(word))) return null;
  const out = Buffer.alloc(16);
  words.forEach((word, index) => out.writeUInt16BE(parseInt(word, 16), index * 2));
  return out;
}

function isPublicAddress(address) {
  const version = net.isIP(String(address || '').replace(/^\[|\]$/g, ''));
  if (version === 4) {
    const b = ipv4Bytes(address);
    if (!b) return false;
    if (b[0] === 0 || b[0] === 10 || b[0] === 127 || b[0] >= 224) return false;
    if (b[0] === 100 && b[1] >= 64 && b[1] <= 127) return false;
    if (b[0] === 169 && b[1] === 254) return false;
    if (b[0] === 172 && b[1] >= 16 && b[1] <= 31) return false;
    if (b[0] === 192 && (b[1] === 168 || b[1] === 0 || (b[1] === 88 && b[2] === 99))) return false;
    if (b[0] === 192 && b[1] === 0 && b[2] === 2) return false;
    if (b[0] === 198 && (b[1] === 18 || b[1] === 19 || (b[1] === 51 && b[2] === 100))) return false;
    if (b[0] === 203 && b[1] === 0 && b[2] === 113) return false;
    return true;
  }
  if (version !== 6) return false;
  const b = ipv6Bytes(address);
  if (!b) return false;
  if (b.every((value) => value === 0)) return false;
  if (b.subarray(0, 15).every((value) => value === 0) && b[15] === 1) return false;
  if ((b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) || b[0] === 0xff) return false;
  // IPv4-mapped IPv6 inherits the IPv4 address classification.
  if (b.subarray(0, 10).every((value) => value === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isPublicAddress(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // Documentation, ORCHID, and addresses outside global unicast are not
  // acceptable download targets for prospect media.
  if ((b[0] & 0xe0) !== 0x20) return false;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && ((b[3] & 0xf0) === 0x10 || (b[3] & 0xf0) === 0x20)) return false;
  return true;
}

function refusedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return !host
    || host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal');
}

async function validatePublicSourceUrl(value, lookupImpl = dns.lookup) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { throw codedError('source_url_not_public'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || refusedHostname(parsed.hostname)) {
    throw codedError('source_url_not_public');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw codedError('source_url_not_public');
    return { url: parsed, addresses: [hostname] };
  }
  let resolved;
  try { resolved = await lookupImpl(hostname, { all: true, verbatim: true }); }
  catch (error) { throw codedError('source_dns_lookup_failed', String(error && error.message || error)); }
  const addresses = (Array.isArray(resolved) ? resolved : [resolved]).map((item) => clean(item && item.address || item));
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw codedError('source_url_not_public');
  }
  return { url: parsed, addresses };
}

function canonicalAddress(address) {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) return canonicalAddress(mapped[1]);
  if (net.isIP(value) === 4) return ipv4Bytes(value).join('.');
  if (net.isIP(value) === 6) {
    const bytes = ipv6Bytes(value);
    return bytes ? bytes.toString('hex') : '';
  }
  return '';
}

function pinnedLookup(addresses) {
  const allowed = addresses.map((address) => ({ address, family: net.isIP(address) })).filter((row) => row.family);
  return (_hostname, options, callback) => {
    const wanted = Number(options && options.family) || 0;
    const selected = allowed.find((row) => !wanted || row.family === wanted) || allowed[0];
    if (!selected) return callback(codedError('source_dns_lookup_failed'));
    return callback(null, selected.address, selected.family);
  };
}

function remoteAddressAllowed(remoteAddress, addresses) {
  const actual = canonicalAddress(remoteAddress);
  return Boolean(actual) && addresses.some((address) => canonicalAddress(address) === actual);
}

function readNodeBody(stream, signal, maxBytes = MAX_SOURCE_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(bytes);
    };
    const onAbort = () => {
      const error = codedError('source_download_timeout');
      stream.destroy(error);
      finish(error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const error = codedError('source_too_large');
        stream.destroy(error);
        finish(error);
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.once('end', () => finish(null, Buffer.concat(chunks, total)));
    stream.once('error', (error) => finish(error && error.code ? error : codedError('source_download_failed')));
  });
}

function pinnedHttpsRequest(parsed, addresses, options = {}) {
  const httpsImpl = options.httpsImpl || https;
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(response);
    };
    const request = httpsImpl.request(parsed, {
      method: 'GET',
      agent: false,
      autoSelectFamily: false,
      lookup: pinnedLookup(addresses),
      signal,
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,application/octet-stream;q=0.5' },
    }, (response) => {
      const remote = response && response.socket && response.socket.remoteAddress;
      if (!remoteAddressAllowed(remote, addresses) || !isPublicAddress(remote)) {
        response?.destroy?.();
        finish(codedError('source_dns_rebinding_refused'));
        return;
      }
      const headers = {
        get(name) {
          const value = response.headers && response.headers[String(name || '').toLowerCase()];
          return Array.isArray(value) ? value[0] : (value == null ? null : String(value));
        },
      };
      finish(null, {
        ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
        status: Number(response.statusCode) || 0,
        headers,
        discard: () => response.resume(),
        cancel: () => response.destroy(),
        readBounded: () => readNodeBody(response, signal, MAX_SOURCE_BYTES),
      });
    });
    request.once('socket', (socket) => {
      socket.once('secureConnect', () => {
        if (!remoteAddressAllowed(socket.remoteAddress, addresses) || !isPublicAddress(socket.remoteAddress)) {
          request.destroy(codedError('source_dns_rebinding_refused'));
        }
      });
    });
    request.once('error', (error) => finish(error && error.code ? error : codedError('source_download_failed')));
    request.end();
  });
}

async function readBoundedResponse(response, signal) {
  if (typeof response.readBounded === 'function') return response.readBounded();
  const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_SOURCE_BYTES) throw codedError('source_too_large');
    return bytes;
  }
  const chunks = [];
  let total = 0;
  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => reject(codedError('source_download_timeout'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    for (;;) {
      const item = await Promise.race([reader.read(), aborted]);
      if (item.done) break;
      const chunk = Buffer.from(item.value || []);
      total += chunk.length;
      if (total > MAX_SOURCE_BYTES) {
        await reader.cancel('source_too_large').catch(() => null);
        throw codedError('source_too_large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    await reader.cancel(error && error.code || 'source_read_refused').catch(() => null);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function downloadAndVerifySource(candidate, outDir, fetchImpl = fetch, options = {}) {
  const lookupImpl = options.lookupImpl || dns.lookup;
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    try {
      let current = candidate.url;
      for (let hop = 0; hop <= MAX_SOURCE_REDIRECTS; hop += 1) {
        const validated = await validatePublicSourceUrl(current, lookupImpl);
        const injectedFetch = fetchImpl !== fetch;
        response = injectedFetch
          ? await fetchImpl(validated.url.toString(), { signal: controller.signal, redirect: 'manual' })
          : await pinnedHttpsRequest(validated.url, validated.addresses, {
            signal: controller.signal,
            httpsImpl: options.httpsImpl,
          });
        const status = Number(response && response.status);
        if (![301, 302, 303, 307, 308].includes(status)) break;
        if (hop === MAX_SOURCE_REDIRECTS) throw codedError('source_redirect_limit');
        const location = clean(response.headers && response.headers.get && response.headers.get('location'));
        if (typeof response.cancel === 'function') response.cancel();
        else response.discard?.();
        if (!location) throw codedError('source_redirect_invalid');
        current = new URL(location, validated.url).toString();
      }
    } catch (error) {
      if (controller.signal.aborted) throw codedError('source_download_timeout');
      if (error && error.code) throw error;
      throw codedError('source_download_failed', String(error && error.message || error));
    }
    if (!response || !response.ok) {
      if (typeof response?.cancel === 'function') response.cancel();
      else response?.discard?.();
      throw codedError('source_download_failed', `source_http_${response && response.status || 0}`);
    }
    const announced = Number(response.headers && response.headers.get && response.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > MAX_SOURCE_BYTES) {
      response.cancel?.();
      throw codedError('source_too_large');
    }
    const contentType = clean(response.headers && response.headers.get && response.headers.get('content-type')).toLowerCase();
    if (contentType && !/^image\/(?:jpeg|png|webp|gif|avif)(?:;|$)/.test(contentType) && contentType !== 'application/octet-stream') {
      response.cancel?.();
      throw codedError('source_not_supported_image');
    }
    let bytes;
    try { bytes = await readBoundedResponse(response, controller.signal); }
    catch (error) {
      if (controller.signal.aborted) throw codedError('source_download_timeout');
      throw error;
    }
    if (!bytes.length) throw codedError('source_too_large');
    const actualSha256 = sha256Hex(bytes);
    if (!sameSha256(actualSha256, candidate.sha256)) throw codedError('source_sha256_mismatch');
    const ext = imageExtension(bytes);
    if (!ext) throw codedError('source_not_supported_image');
    const filePath = path.join(outDir, `source-raw${ext}`);
    await fs.promises.writeFile(filePath, bytes, { flag: 'wx' });
    return { filePath, bytes: bytes.length, sha256: actualSha256, ext };
  } finally {
    clearTimeout(timer);
  }
}

function parseRunnerVerdict(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === 'object') return value;
    } catch { /* progress lines may precede the receipt */ }
  }
  return null;
}

function safeRunnerReason(value) {
  const reason = clean(value).toLowerCase();
  if (!reason || reason.length > MAX_RUNNER_REASON_LENGTH
    || !SAFE_RUNNER_REASON_RE.test(reason)
    || SENSITIVE_RUNNER_REASON_RE.test(reason)
    || GENERIC_RUNNER_REASONS.has(reason)) return '';
  return reason;
}

function runnerFailureReason(input = {}) {
  const failure = input && typeof input === 'object' ? input : {};
  const error = failure.error && typeof failure.error === 'object' ? failure.error : null;
  const directReason = safeRunnerReason(failure.reason);

  // Only machine-safe reason codes may cross the worker/API boundary. Raw
  // child output can contain absolute paths, command lines, account data, or
  // inherited values, so it is inspected for a bounded classification and
  // then discarded.
  const stderr = String(failure.stderr || '').slice(-8192);
  const parsedStderr = parseRunnerVerdict(stderr);
  const parsedReason = safeRunnerReason(parsedStderr && parsedStderr.reason);
  const safeError = safeRunnerReason(typeof failure.error === 'string' ? failure.error : '');
  const message = typeof failure.error === 'string'
    ? failure.error.slice(-2048)
    : String(error && error.message || '').slice(-2048);
  const detail = String(failure.detail || '').slice(-2048);
  const diagnostic = `${stderr}\n${message}\n${detail}`;
  const rawCode = error ? error.code : '';
  const code = String(rawCode == null ? '' : rawCode).toUpperCase();

  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || code === 'ENOBUFS') {
    return 'runner_output_limit_exceeded';
  }
  if (code === 'ETIMEDOUT' || code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || (error && error.killed === true)) {
    return 'runner_timed_out';
  }
  if (error && clean(error.signal)) return 'runner_terminated';
  if (safeError && safeError.startsWith('runner_')) return safeError;
  if (directReason && directReason !== 'runner_crashed') return directReason;
  if (parsedReason && parsedReason.startsWith('runner_')) return parsedReason;
  if (/\b(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ENOENT)\b|cannot find (?:module|package)|no such file or directory|not recognized as an internal or external command|executable (?:does not|doesn't) exist/i.test(diagnostic)
    || code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT') {
    return 'runner_dependency_missing';
  }
  if (/heap out of memory|allocation failed|\bENOMEM\b/i.test(diagnostic) || code === 'ENOMEM') {
    return 'runner_out_of_memory';
  }
  if (/permission denied|access is denied|\bEACCES\b|\bEPERM\b/i.test(diagnostic)
    || code === 'EACCES' || code === 'EPERM') {
    return 'runner_permission_denied';
  }
  if (/\bTimeout \d+ms exceeded\b|timed out after \d+/i.test(diagnostic)) {
    return 'runner_operation_timed_out';
  }
  if (/target page, context or browser has been closed|browser has been closed/i.test(diagnostic)) {
    return 'runner_browser_closed';
  }
  if (/\bSyntaxError\b|syntax error/i.test(diagnostic)) return 'runner_syntax_error';

  const stderrReasonMatch = diagnostic.match(/(?:^|\n)\s*(?:reason|fatal)\s*[:=]\s*["']?(runner_[a-z0-9_]{1,88})\b/im);
  const stderrReason = safeRunnerReason(stderrReasonMatch && stderrReasonMatch[1]);
  if (stderrReason) return stderrReason;

  const numericCode = Number(rawCode);
  if (Number.isInteger(numericCode) && numericCode > 0 && numericCode <= 255) {
    return `runner_exit_${numericCode}`;
  }
  const safeCode = safeRunnerReason(code);
  if (safeCode) return safeRunnerReason(`runner_${safeCode}`) || 'runner_failed';
  return directReason || 'runner_failed';
}

function scrubRunnerEnv(input) {
  const safe = {};
  for (const [name, value] of Object.entries(input || {})) {
    if (RUNNER_ENV_ALLOWLIST.has(name.toUpperCase())) safe[name] = value;
  }
  return safe;
}

function createLeaseHeartbeat(job, renewImpl, options = {}) {
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0
    ? options.intervalMs
    : DEFAULT_LEASE_HEARTBEAT_MS;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_LEASE_RENEW_TIMEOUT_MS;
  const setTimer = options.setTimeoutImpl || setTimeout;
  const clearTimer = options.clearTimeoutImpl || clearTimeout;
  let stopped = false;
  let timer = null;
  let inFlight = Promise.resolve();
  let failure = null;

  function rememberFailure(error) {
    const cause = clean(error && error.code) || clean(error && error.message) || 'renew_failed';
    failure = codedError('lease_renewal_failed', cause.slice(0, 160));
    failure.causeCode = cause.slice(0, 80);
    stopped = true;
    if (timer) clearTimer(timer);
    timer = null;
  }

  async function beat() {
    if (stopped || failure) return;
    const controller = new AbortController();
    const deadline = setTimer(() => controller.abort(), timeoutMs);
    if (deadline && typeof deadline.unref === 'function') deadline.unref();
    try {
      const renewed = await renewImpl(job, { signal: controller.signal });
      const expiry = first(renewed && renewed.lease_expires_at, renewed && renewed.leaseExpiresAt);
      if (!renewed || renewed.ok !== true || !Number.isFinite(Date.parse(expiry))) {
        throw codedError('renew_response_invalid');
      }
      job.leaseExpiresAt = new Date(Date.parse(expiry)).toISOString();
    } catch (error) {
      rememberFailure(error);
    } finally {
      clearTimer(deadline);
    }
    if (!stopped && !failure) {
      timer = setTimer(() => {
        timer = null;
        inFlight = beat();
      }, intervalMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
  }

  return {
    async start() {
      inFlight = beat();
      await inFlight;
      this.assertActive();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
      await inFlight.catch(() => {});
    },
    assertActive() {
      if (failure) throw failure;
    },
    failed() { return failure; },
  };
}

function runRunner(jobFile, options = {}) {
  const execImpl = options.execFileImpl || execFile;
  const childEnv = scrubRunnerEnv({
    ...process.env,
    ...(options.env || {}),
    ADS_STATION_CDP_URL: options.cdpUrl || DEFAULT_CDP_URL,
    CDP_URL: options.cdpUrl || DEFAULT_CDP_URL,
  });
  return new Promise((resolve) => {
    execImpl(process.execPath, [options.runnerPath || RUNNER, '--job', jobFile], {
      timeout: options.timeoutMs || DEFAULT_RUNNER_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: childEnv,
    }, (error, stdout, stderr) => {
      const parsedVerdict = parseRunnerVerdict(stdout);
      const failureReason = error || !parsedVerdict
        ? runnerFailureReason({
          reason: parsedVerdict && parsedVerdict.reason,
          detail: parsedVerdict && parsedVerdict.detail,
          error,
          stderr,
        })
        : '';
      const verdict = parsedVerdict && typeof parsedVerdict === 'object'
        ? { ...parsedVerdict }
        : parsedVerdict;
      if (verdict && Object.prototype.hasOwnProperty.call(verdict, 'detail')) delete verdict.detail;
      resolve({
        error: failureReason,
        verdict,
      });
    });
  });
}

function normalizedDomain(value) {
  try {
    return new URL(asHttpsUrl(value)).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return '';
  }
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isWanTechnicalFailure(reason) {
  return WAN_TECHNICAL_FAILURES.has(clean(reason));
}

function isWanNonFallbackFailure(reason) {
  return WAN_NON_FALLBACK_FAILURES.has(clean(reason));
}

function wanFailureAction(reason) {
  return isWanNonFallbackFailure(reason) ? 'refuse' : 'fail';
}

function safeJsonObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  try { return JSON.parse(stableSerialize(value)); }
  catch { return fallback; }
}

function buildWanRunnerJob(job, candidate, source, workDir, config) {
  const runtime = job.wanRuntime && typeof job.wanRuntime === 'object' ? job.wanRuntime : {};
  const settings = safeJsonObject(job.modelSettings, DEFAULT_WAN_MODEL_SETTINGS);
  return {
    producer: job.producer,
    prospectId: job.prospectId,
    domain: normalizedDomain(job.sourceUrl),
    sourceSha256: source.sha256,
    sourceType: candidate.source,
    sourceAssetType: first(candidate.asset_type, candidate.assetType, job.sourceAssetType),
    sourceImagePath: source.filePath,
    vertical: job.vertical,
    overlaySide: job.overlaySide,
    preset: job.preset,
    businessName: job.businessName,
    gbpCategory: job.gbpCategory,
    siteText: job.siteText,
    fencingClassification: job.fencingClassification,
    allowPeopleSensitive: job.allowPeopleSensitive,
    peopleConsentVerified: job.peopleConsentVerified,
    containsRecognizablePeople: job.containsRecognizablePeople,
    modelId: WAN_MODEL_ID,
    modelRevision: WAN_MODEL_REVISION,
    modelSettings: settings,
    localModelPath: first(runtime.localModelPath, runtime.modelPath, config.wanModelPath),
    wanScriptPath: WAN_SCRIPT,
    outputDirectory: path.join(workDir, 'wan-output'),
    pythonExecutable: first(runtime.pythonExecutable, config.wanPythonExecutable, 'python'),
    ffmpegExecutable: first(runtime.ffmpegExecutable, config.wanFfmpegExecutable, 'ffmpeg'),
    ffprobeExecutable: first(runtime.ffprobeExecutable, config.wanFfprobeExecutable, 'ffprobe'),
    estimatedPowerWatts: finiteOr(runtime.estimatedPowerWatts, config.wanEstimatedPowerWatts),
    electricityRateUsdPerKwh: finiteOr(runtime.electricityRateUsdPerKwh, config.wanElectricityRateUsdPerKwh),
    wanTimeoutSeconds: finiteOr(runtime.wanTimeoutSeconds, config.wanTimeoutSeconds),
  };
}

function nonnegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validatedWanMetrics(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const energy = raw.energy && typeof raw.energy === 'object' ? raw.energy : {};
  const gpu = energy.gpuTelemetry && typeof energy.gpuTelemetry === 'object' ? energy.gpuTelemetry : {};
  const wallTimeMs = nonnegative(raw.wallTimeMs);
  const generationTimeMs = nonnegative(raw.generationTimeMs);
  const estimatedPowerWatts = nonnegative(energy.estimatedPowerWatts);
  const estimatedKwh = nonnegative(energy.estimatedKwh);
  const electricityRate = nonnegative(raw.electricityRateUsdPerKwh);
  const estimatedCost = nonnegative(raw.estimatedElectricityCostUsd);
  if ([wallTimeMs, generationTimeMs, estimatedPowerWatts, estimatedKwh, electricityRate, estimatedCost].includes(null)) return null;
  const gpuTelemetry = {
    samples: nonnegative(gpu.samples) ?? 0,
    avgPowerWatts: nonnegative(gpu.avgPowerWatts) ?? 0,
    peakPowerWatts: nonnegative(gpu.peakPowerWatts) ?? 0,
    energyKwh: nonnegative(gpu.energyKwh) ?? 0,
    peakVramMiB: nonnegative(gpu.peakVramMiB) ?? 0,
  };
  return {
    wall_time_ms: wallTimeMs,
    generation_time_ms: generationTimeMs,
    energy: {
      method: first(energy.method) || 'configured_power_estimate',
      estimated_power_watts: estimatedPowerWatts,
      estimated_kwh: estimatedKwh,
      gpu_telemetry: gpuTelemetry,
    },
    electricity_rate_usd_per_kwh: electricityRate,
    estimated_electricity_cost_usd: estimatedCost,
  };
}

function wanGenerationReceipt(job, candidate, runnerJob, result) {
  const artifacts = result && result.artifacts && typeof result.artifacts === 'object' ? result.artifacts : {};
  const raw = artifacts.raw && typeof artifacts.raw === 'object' ? artifacts.raw : {};
  const optimized = artifacts.optimized && typeof artifacts.optimized === 'object' ? artifacts.optimized : {};
  const master = artifacts.masterVideo && typeof artifacts.masterVideo === 'object' ? artifacts.masterVideo : {};
  const browser = artifacts.browserVideo && typeof artifacts.browserVideo === 'object' ? artifacts.browserVideo : {};
  const identity = result && result.sourceIdentity && typeof result.sourceIdentity === 'object' ? result.sourceIdentity : {};
  const model = result && result.model && typeof result.model === 'object' ? result.model : {};
  const sideEffects = result && result.sideEffects && typeof result.sideEffects === 'object' ? result.sideEffects : {};
  const metrics = validatedWanMetrics(result && result.metrics);
  const shaFields = [raw.sha256, optimized.sha256, master.sha256, browser.sha256];
  const pathsInsideJob = [optimized.path, master.path, browser.path]
    .every((filePath) => clean(filePath) && pathIsInside(runnerJob.outputDirectory, filePath));
  const identityMatches = clean(identity.prospectId) === job.prospectId
    && clean(identity.domain).toLowerCase() === normalizedDomain(job.sourceUrl)
    && clean(identity.type).toLowerCase() === candidate.source
    && clean(identity.assetType).toLowerCase() === first(candidate.asset_type, candidate.assetType, job.sourceAssetType).toLowerCase()
    && sameSha256(identity.sha256, raw.sha256)
    && sameSha256(raw.sha256, runnerJob.sourceSha256);
  const modelMatches = clean(model.id) === WAN_MODEL_ID
    && clean(model.revision) === WAN_MODEL_REVISION
    && stableSerialize(safeJsonObject(model.settings)) === stableSerialize(safeJsonObject(runnerJob.modelSettings));
  const recipeMatches = sameSha256(optimized.promptSha256, WAN_REMASTER_RECIPE_SHA256)
    && sameSha256(optimized.recipeSha256, WAN_REMASTER_RECIPE_SHA256);
  const sideEffectsSafe = ['providerCalls', 'fetches', 'uploads', 'databaseWrites', 'emails']
    .every((key) => Number(sideEffects[key]) === 0);
  if (!shaFields.every((value) => SHA256_RE.test(clean(value)))
    || clean(result && result.schemaVersion) !== JOB_SCHEMA_VERSION
    || sameSha256(raw.sha256, optimized.sha256)
    || !pathsInsideJob
    || !identityMatches
    || !modelMatches
    || !recipeMatches
    || !metrics
    || !sideEffectsSafe
    || !Number.isFinite(Number(browser.bytes))
    || Number(browser.bytes) <= 0) return null;
  return {
    schema_version: 'wss.hero_generation_receipt.v1',
    requested_producer: job.producer,
    generator: WAN_PRODUCER,
    source: {
      prospect_id: job.prospectId,
      domain: normalizedDomain(job.sourceUrl),
      type: candidate.source,
      asset_type: clean(identity.assetType).toLowerCase(),
      raw_sha256: clean(raw.sha256).toLowerCase(),
    },
    artifacts: {
      raw_sha256: clean(raw.sha256).toLowerCase(),
      optimized_sha256: clean(optimized.sha256).toLowerCase(),
      master_sha256: clean(master.sha256).toLowerCase(),
      clip_sha256: clean(browser.sha256).toLowerCase(),
      recipe_sha256: WAN_REMASTER_RECIPE_SHA256,
    },
    model: {
      id: WAN_MODEL_ID,
      revision: WAN_MODEL_REVISION,
      settings: safeJsonObject(model.settings),
    },
    metrics,
    fallback: null,
  };
}

function mapWanResultToReview(job, candidate, runnerJob, result) {
  if (!result || result.ok !== true) return result && typeof result === 'object' ? result : { ok: false, reason: 'wan_runner_failed' };
  const receipt = wanGenerationReceipt(job, candidate, runnerJob, result);
  if (!receipt) return { ok: false, reason: 'wan_result_identity_mismatch' };
  const optimized = result.artifacts.optimized;
  const browser = result.artifacts.browserVideo;
  return {
    ok: false,
    status: 'awaiting_review',
    reason: 'awaiting_owner_review',
    producer: job.producer,
    generator: WAN_PRODUCER,
    raw_sha256: receipt.artifacts.raw_sha256,
    optimized_sha256: receipt.artifacts.optimized_sha256,
    master_sha256: receipt.artifacts.master_sha256,
    clip_sha256: receipt.artifacts.clip_sha256,
    prompt_sha256: WAN_REMASTER_RECIPE_SHA256,
    canonical_recipe_sha256: WAN_REMASTER_RECIPE_SHA256,
    model_revision: WAN_MODEL_REVISION,
    model_settings: receipt.model.settings,
    generation_receipt: receipt,
    review: {
      clipPath: browser.path,
      sha256: receipt.artifacts.clip_sha256,
      bytes: Number(browser.bytes),
    },
    remaster: {
      optimizedSha256: receipt.artifacts.optimized_sha256,
      assetIdentity: {
        urlFingerprint: `${WAN_PRODUCER}:${receipt.artifacts.optimized_sha256}`,
        width: Number(optimized.width),
        height: Number(optimized.height),
      },
      promptSha256: WAN_REMASTER_RECIPE_SHA256,
      recipeSha256: WAN_REMASTER_RECIPE_SHA256,
    },
  };
}

function normalizeApproval(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const approved = raw.approved === true || clean(raw.approved) === 'true';
  const approvedBy = first(raw.approved_by, raw.approvedBy, raw.owner, raw.reviewer);
  const rawTime = first(raw.approved_at, raw.approvedAt, raw.approval_timestamp, raw.approvalTimestamp);
  const timeMs = Date.parse(rawTime);
  const approvedAt = Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : '';
  const clipSha256 = first(raw.sha256, raw.clip_sha256, raw.clipSha256).toLowerCase();
  return {
    approved,
    approvedBy,
    approvedAt,
    clipSha256,
    valid: approved && Boolean(approvedBy) && Boolean(approvedAt) && timeMs <= Date.now() && SHA256_RE.test(clipSha256),
  };
}

function normalizeOptimizedAsset(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const identity = raw.assetIdentity && typeof raw.assetIdentity === 'object' ? raw.assetIdentity : raw;
  const sha256 = first(raw.sha256, raw.optimized_sha256, raw.optimizedSha256, identity.sha256).toLowerCase();
  const urlFingerprint = first(raw.url_fingerprint, raw.urlFingerprint, raw.optimized_asset_fingerprint, identity.urlFingerprint);
  const promptSha256 = first(raw.prompt_sha256, raw.promptSha256).toLowerCase();
  const width = Number(first(String(raw.width || ''), String(identity.width || '')));
  const height = Number(first(String(raw.height || ''), String(identity.height || '')));
  const explicitPreparation = first(
    raw.image_preparation,
    raw.imagePreparation,
    identity.image_preparation,
    identity.imagePreparation,
  );
  const canonicalDirect = SHA256_RE.test(sha256)
    && urlFingerprint === `direct-source:${sha256}`
    && promptSha256 === DIRECT_SOURCE_RECIPE_SHA256;
  const imagePreparation = explicitPreparation
    ? normalizeImagePreparation(explicitPreparation, '')
    : canonicalDirect
      ? IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO
      : IMAGE_PREPARATION_IMAGE_EDITOR;
  const valid = SHA256_RE.test(sha256) && Boolean(urlFingerprint) && urlFingerprint.length <= 1200
    && !/[\u0000-\u001f\u007f]/.test(urlFingerprint) && SHA256_RE.test(promptSha256)
    && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    && Boolean(imagePreparation)
    && (imagePreparation !== IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO || canonicalDirect);
  return { sha256, urlFingerprint, width, height, promptSha256, imagePreparation, valid };
}

function approvedArtifactFrom({ sourceSha256, sourceUrl, clipSha256, optimizedAsset }) {
  const optimized = normalizeOptimizedAsset(optimizedAsset);
  const artifact = {
    raw_sha256: clean(sourceSha256).toLowerCase(),
    source_url: asHttpsUrl(sourceUrl),
    clip_sha256: clean(clipSha256).toLowerCase(),
    optimized_sha256: optimized.sha256,
    optimized_asset_fingerprint: optimized.urlFingerprint,
    prompt_sha256: optimized.promptSha256,
    image_preparation: optimized.imagePreparation,
  };
  const preparationValid = optimized.imagePreparation === IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO
    ? artifact.optimized_sha256 === artifact.raw_sha256
      && artifact.optimized_asset_fingerprint === `direct-source:${artifact.raw_sha256}`
      && artifact.prompt_sha256 === DIRECT_SOURCE_RECIPE_SHA256
    : artifact.optimized_sha256 !== artifact.raw_sha256;
  artifact.valid = SHA256_RE.test(artifact.raw_sha256)
    && Boolean(artifact.source_url)
    && SHA256_RE.test(artifact.clip_sha256)
    && optimized.valid
    && preparationValid;
  return artifact;
}

function normalizeApprovedArtifact(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const artifact = {
    raw_sha256: first(raw.raw_sha256, raw.source_sha256, raw.rawSha256).toLowerCase(),
    source_url: asHttpsUrl(first(raw.source_url, raw.sourceUrl)),
    clip_sha256: first(raw.clip_sha256, raw.clipSha256).toLowerCase(),
    optimized_sha256: first(raw.optimized_sha256, raw.optimizedSha256).toLowerCase(),
    optimized_asset_fingerprint: first(raw.optimized_asset_fingerprint, raw.optimizedAssetFingerprint),
    prompt_sha256: first(raw.prompt_sha256, raw.promptSha256).toLowerCase(),
    image_preparation: '',
  };
  const canonicalDirect = artifact.optimized_sha256 === artifact.raw_sha256
    && artifact.optimized_asset_fingerprint === `direct-source:${artifact.raw_sha256}`
    && artifact.prompt_sha256 === DIRECT_SOURCE_RECIPE_SHA256;
  const explicitPreparation = first(raw.image_preparation, raw.imagePreparation);
  artifact.image_preparation = explicitPreparation
    ? normalizeImagePreparation(explicitPreparation, '')
    : canonicalDirect
      ? IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO
      : IMAGE_PREPARATION_IMAGE_EDITOR;
  const preparationValid = artifact.image_preparation === IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO
    ? canonicalDirect
    : artifact.optimized_sha256 !== artifact.raw_sha256;
  artifact.valid = SHA256_RE.test(artifact.raw_sha256) && Boolean(artifact.source_url)
    && SHA256_RE.test(artifact.clip_sha256) && SHA256_RE.test(artifact.optimized_sha256)
    && Boolean(artifact.optimized_asset_fingerprint) && artifact.optimized_asset_fingerprint.length <= 1200
    && !/[\u0000-\u001f\u007f]/.test(artifact.optimized_asset_fingerprint)
    && SHA256_RE.test(artifact.prompt_sha256)
    && Boolean(artifact.image_preparation)
    && preparationValid;
  return artifact;
}

function sameApprovedArtifact(left, right) {
  const keys = ['raw_sha256', 'source_url', 'clip_sha256', 'optimized_sha256', 'optimized_asset_fingerprint', 'prompt_sha256', 'image_preparation'];
  return left && right && left.valid && right.valid && keys.every((key) => left[key] === right[key]);
}

function sameOptimizedAsset(left, right) {
  const a = normalizeOptimizedAsset(left);
  const b = normalizeOptimizedAsset(right);
  return a.valid && b.valid && a.sha256 === b.sha256 && a.urlFingerprint === b.urlFingerprint
    && a.width === b.width && a.height === b.height && a.promptSha256 === b.promptSha256
    && a.imagePreparation === b.imagePreparation;
}

function reviewProvenance(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const generator = first(raw.generator);
  const producer = first(raw.producer);
  const receipt = safeJsonObject(raw.generation_receipt || raw.generationReceipt, null);
  const fallback = safeJsonObject(raw.fallback, null);
  return {
    ...(producer ? { producer } : {}),
    ...(generator ? { generator } : {}),
    ...(SHA256_RE.test(first(raw.master_sha256, raw.masterSha256))
      ? { master_sha256: first(raw.master_sha256, raw.masterSha256).toLowerCase() }
      : {}),
    ...(SHA256_RE.test(first(raw.canonical_recipe_sha256, raw.canonicalRecipeSha256))
      ? { canonical_recipe_sha256: first(raw.canonical_recipe_sha256, raw.canonicalRecipeSha256).toLowerCase() }
      : {}),
    ...(first(raw.model_revision, raw.modelRevision)
      ? { model_revision: first(raw.model_revision, raw.modelRevision) }
      : {}),
    ...(raw.model_settings && typeof raw.model_settings === 'object'
      ? { model_settings: safeJsonObject(raw.model_settings) }
      : {}),
    ...(receipt ? { generation_receipt: receipt } : {}),
    ...(fallback ? { fallback } : {}),
  };
}

function holdVerdict(artifact, optimizedAsset, bytes, capturedAt = new Date().toISOString(), revision = 1, metadata = {}) {
  const optimized = normalizeOptimizedAsset(optimizedAsset);
  const candidates = candidateManifest(metadata.candidates);
  return {
    ok: false,
    status: 'awaiting_review',
    reason: 'awaiting_owner_review',
    raw_sha256: artifact.raw_sha256,
    source_sha256: artifact.raw_sha256,
    source_url: artifact.source_url,
    clip_sha256: artifact.clip_sha256,
    optimized_sha256: artifact.optimized_sha256,
    optimized_asset_fingerprint: artifact.optimized_asset_fingerprint,
    prompt_sha256: artifact.prompt_sha256,
    image_preparation: artifact.image_preparation,
    optimized_asset: {
      sha256: optimized.sha256,
      url_fingerprint: optimized.urlFingerprint,
      width: optimized.width,
      height: optimized.height,
      prompt_sha256: optimized.promptSha256,
      image_preparation: optimized.imagePreparation,
    },
    bytes,
    captured_at: capturedAt,
    generation_revision: generationRevision(revision),
    ...reviewProvenance(metadata),
    ...(candidates.length ? { candidates } : {}),
  };
}

function pathIsInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function verifiedMp4(clipPath, expectedSha256, workDir) {
  if (!pathIsInside(workDir, clipPath)) throw codedError('clip_path_outside_job');
  const realWorkDir = await fs.promises.realpath(workDir).catch(() => '');
  const realClipPath = await fs.promises.realpath(clipPath).catch(() => '');
  if (!realWorkDir || !realClipPath || !pathIsInside(realWorkDir, realClipPath)) {
    throw codedError('clip_path_outside_job');
  }
  const stat = await fs.promises.stat(realClipPath).catch(() => null);
  if (!stat || !stat.isFile() || !stat.size || stat.size > MAX_CLIP_BYTES) throw codedError('clip_unreadable');
  const bytes = await fs.promises.readFile(realClipPath);
  const validation = validateHeroClip(bytes);
  if (!validation.ok) throw codedError(validation.reason, validation.detail || validation.reason);
  const sha256 = validation.sha256;
  if (expectedSha256 && !sameSha256(sha256, expectedSha256)) throw codedError('clip_sha256_mismatch');
  return { bytes, sha256, validation };
}

function publicApprovedArtifact(value) {
  const artifact = normalizeApprovedArtifact(value);
  if (!artifact.valid) return null;
  const { valid: _valid, ...publicArtifact } = artifact;
  return publicArtifact;
}

function candidateManifest(value) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const manifest = [];
  for (const raw of rows.slice(0, MAX_REVIEW_CANDIDATES)) {
    const sha256 = first(raw && raw.sha256, raw && raw.clip_sha256).toLowerCase();
    const bytes = Number(raw && raw.bytes);
    const durationSeconds = Number(raw && raw.durationSeconds !== undefined
      ? raw.durationSeconds
      : raw && raw.duration_seconds);
    const width = Number(raw && raw.width);
    const height = Number(raw && raw.height);
    const codec = first(raw && raw.codec).toLowerCase();
    if (!SHA256_RE.test(sha256) || seen.has(sha256)
      || !Number.isInteger(bytes) || bytes <= 0
      || !Number.isFinite(durationSeconds) || durationSeconds <= 0
      || !Number.isInteger(width) || width <= 0
      || !Number.isInteger(height) || height <= 0
      || !codec) continue;
    const approvedArtifact = publicApprovedArtifact(raw && (raw.approved_artifact || raw.approvedArtifact));
    seen.add(sha256);
    manifest.push({
      sha256,
      bytes,
      durationSeconds,
      width,
      height,
      codec,
      ...(approvedArtifact && approvedArtifact.clip_sha256 === sha256
        ? { approved_artifact: approvedArtifact }
        : {}),
    });
  }
  return manifest;
}

function rawReviewCandidates(verdict) {
  const many = verdict && Array.isArray(verdict.candidates) ? verdict.candidates : [];
  if (many.length) return many;
  const review = verdict && verdict.review && typeof verdict.review === 'object' ? verdict.review : null;
  return review ? [review] : [];
}

async function verifiedReviewCandidates(verdict, workDir) {
  const rawCandidates = rawReviewCandidates(verdict);
  const strictManifest = Boolean(verdict && Array.isArray(verdict.candidates) && verdict.candidates.length);
  if (!rawCandidates.length) throw codedError('review_candidate_missing');
  if (rawCandidates.length > MAX_REVIEW_CANDIDATES) throw codedError('review_candidate_limit_exceeded');
  const checked = [];
  const seen = new Set();
  for (const raw of rawCandidates) {
    const clipPath = first(raw && raw.clipPath, raw && raw.clip_path);
    const declaredSha256 = first(raw && raw.sha256, raw && raw.clip_sha256).toLowerCase();
    if (!clipPath || !SHA256_RE.test(declaredSha256)) throw codedError('review_candidate_contract_invalid');
    const clip = await verifiedMp4(clipPath, declaredSha256, workDir);
    const hasBytes = raw.bytes !== undefined && raw.bytes !== null && raw.bytes !== '';
    const hasDuration = (raw.durationSeconds !== undefined && raw.durationSeconds !== null && raw.durationSeconds !== '')
      || (raw.duration_seconds !== undefined && raw.duration_seconds !== null && raw.duration_seconds !== '');
    const hasWidth = raw.width !== undefined && raw.width !== null && raw.width !== '';
    const hasHeight = raw.height !== undefined && raw.height !== null && raw.height !== '';
    const hasCodec = Boolean(clean(raw.codec));
    const declaredBytes = Number(raw.bytes);
    const declaredDuration = Number(raw.durationSeconds !== undefined ? raw.durationSeconds : raw.duration_seconds);
    const declaredWidth = Number(raw.width);
    const declaredHeight = Number(raw.height);
    const declaredCodec = first(raw.codec).toLowerCase();
    if ((strictManifest && !hasBytes) || (hasBytes && (!Number.isInteger(declaredBytes) || declaredBytes !== clip.bytes.length))
      || (strictManifest && !hasDuration) || (hasDuration && (!Number.isFinite(declaredDuration) || Math.abs(declaredDuration - clip.validation.durationSec) > 0.15))
      || (strictManifest && !hasWidth) || (hasWidth && (!Number.isInteger(declaredWidth) || declaredWidth !== clip.validation.width))
      || (strictManifest && !hasHeight) || (hasHeight && (!Number.isInteger(declaredHeight) || declaredHeight !== clip.validation.height))
      || (strictManifest && !hasCodec)
      || (hasCodec && declaredCodec !== clean(clip.validation.codec).toLowerCase())) {
      throw codedError('review_candidate_metadata_mismatch');
    }
    // Validate duplicate entries too, then collapse them by their verified bytes.
    if (seen.has(clip.sha256)) continue;
    seen.add(clip.sha256);
    checked.push({
      clipPath: path.resolve(clipPath),
      sha256: clip.sha256,
      bytes: clip.bytes.length,
      durationSeconds: clip.validation.durationSec,
      width: clip.validation.width,
      height: clip.validation.height,
      codec: clip.validation.codec,
    });
  }
  if (!checked.length) throw codedError('review_candidate_missing');
  return checked;
}

function artifactForCandidate(verdict, sha256) {
  const rows = verdict && Array.isArray(verdict.candidate_artifacts) ? verdict.candidate_artifacts : [];
  const matched = rows.find((row) => sameSha256(row && row.sha256, sha256));
  return publicApprovedArtifact(matched && (matched.approved_artifact || matched.approvedArtifact)
    || verdict && verdict.approved_artifact);
}

async function persistReviewArtifact(job, verdict, workDir, reviewRoot) {
  const checkedCandidates = await verifiedReviewCandidates(verdict, workDir);
  const jobDir = path.join(reviewRoot, job.jobId.replace(/[^a-zA-Z0-9_.-]/g, '_'));
  await fs.promises.mkdir(jobDir, { recursive: true });
  const manifest = checkedCandidates.map((checked) => ({
    ...checked,
    approved_artifact: artifactForCandidate(verdict, checked.sha256),
  }));
  if (manifest.some((entry) => !entry.approved_artifact)) throw codedError('review_candidate_artifact_missing');
  const durableManifest = candidateManifest(manifest);
  const saved = [];
  for (const checked of manifest) {
    const savedPath = path.join(jobDir, `${checked.sha256}.mp4`);
    await fs.promises.copyFile(checked.clipPath, savedPath);
    const receipt = {
      job_id: job.jobId,
      prospect_id: job.prospectId,
      source_sha256: first(verdict.source_sha256),
      source_url: asHttpsUrl(verdict.source_url),
      clip_sha256: checked.sha256,
      approved_artifact: checked.approved_artifact,
      optimized_asset: verdict.optimized_asset || null,
      clip_path: savedPath,
      bytes: checked.bytes,
      duration_seconds: checked.durationSeconds,
      width: checked.width,
      height: checked.height,
      codec: checked.codec,
      candidates: durableManifest,
      status: 'awaiting_review',
      captured_at: first(verdict.captured_at) || new Date().toISOString(),
      generation_revision: generationRevision(verdict.generation_revision || job.generationRevision),
      ...reviewProvenance(verdict),
    };
    await fs.promises.writeFile(path.join(jobDir, `${checked.sha256}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    saved.push({ ...checked, path: savedPath });
  }
  const primary = saved[0];
  return {
    saved: true,
    path: primary.path,
    sha256: primary.sha256,
    bytes: primary.bytes,
    candidates: saved,
  };
}

async function reviewReceipts(job, candidate, reviewRoot) {
  const jobDir = path.join(reviewRoot, job.jobId.replace(/[^a-zA-Z0-9_.-]/g, '_'));
  const names = await fs.promises.readdir(jobDir).catch(() => []);
  const rows = [];
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    const receiptPath = path.join(jobDir, name);
    try {
      const raw = JSON.parse(await fs.promises.readFile(receiptPath, 'utf8'));
      if (clean(raw.job_id) !== job.jobId || clean(raw.prospect_id) !== job.prospectId) continue;
      if (generationRevision(raw.generation_revision) !== job.generationRevision) continue;
      if (!sameSha256(raw.source_sha256, candidate.sha256) || asHttpsUrl(raw.source_url) !== candidate.url) continue;
      const clipSha256 = clean(raw.clip_sha256).toLowerCase();
      const clipPath = path.resolve(clean(raw.clip_path));
      if (!SHA256_RE.test(clipSha256) || !pathIsInside(reviewRoot, clipPath)) continue;
      const stat = await fs.promises.stat(receiptPath);
      rows.push({ raw, receiptPath, clipPath, clipSha256, mtimeMs: stat.mtimeMs });
    } catch { /* malformed local receipt is never approval evidence */ }
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function stageApprovedReview(job, candidate, serverArtifact, reviewRoot, workDir) {
  const artifact = normalizeApprovedArtifact(serverArtifact);
  if (!artifact.valid || artifact.raw_sha256 !== candidate.sha256 || artifact.source_url !== candidate.url) {
    throw codedError('approved_artifact_source_mismatch');
  }
  const receipts = await reviewReceipts(job, candidate, reviewRoot);
  const match = receipts.find((row) => {
    const localArtifact = normalizeApprovedArtifact(row.raw.approved_artifact);
    return row.clipSha256 === artifact.clip_sha256 && sameApprovedArtifact(localArtifact, artifact);
  });
  if (!match) throw codedError('approved_review_artifact_missing');

  const realRoot = await fs.promises.realpath(reviewRoot).catch(() => '');
  const realClip = await fs.promises.realpath(match.clipPath).catch(() => '');
  if (!realRoot || !realClip || !pathIsInside(realRoot, realClip)) throw codedError('approved_review_path_refused');
  const destination = path.join(workDir, 'approved-review.mp4');
  await fs.promises.copyFile(realClip, destination);
  const clip = await verifiedMp4(destination, artifact.clip_sha256, workDir);
  return { path: destination, clip, receipt: match.raw, artifact };
}

function adsFallbackProvenance(job, candidate, source, verdict, reason, wanJob, elapsedMs) {
  const optimized = normalizeOptimizedAsset(verdict && verdict.remaster);
  const clipSha256 = first(verdict && verdict.review && verdict.review.sha256).toLowerCase();
  const wallTimeMs = Math.max(0, Math.floor(finiteOr(elapsedMs, 0)));
  const estimatedPowerWatts = Math.max(25, Math.min(2000, finiteOr(wanJob && wanJob.estimatedPowerWatts, 500)));
  const electricityRate = Math.max(0, Math.min(5, finiteOr(wanJob && wanJob.electricityRateUsdPerKwh, 0)));
  const estimatedKwh = Number((estimatedPowerWatts * wallTimeMs / 3_600_000_000).toFixed(8));
  const estimatedCost = Number((estimatedKwh * electricityRate).toFixed(6));
  const recipeSha256 = optimized.valid ? optimized.promptSha256 : '';
  const fallback = {
    used: true,
    from: WAN_PRODUCER,
    to: ADS_PRODUCER,
    reason: clean(reason),
  };
  return {
    producer: job.producer,
    generator: ADS_GENERATOR,
    ...(SHA256_RE.test(clipSha256) ? { master_sha256: clipSha256 } : {}),
    ...(SHA256_RE.test(recipeSha256) ? {
      prompt_sha256: recipeSha256,
      canonical_recipe_sha256: recipeSha256,
    } : {}),
    model_revision: WAN_MODEL_REVISION,
    model_settings: safeJsonObject(wanJob && wanJob.modelSettings, DEFAULT_WAN_MODEL_SETTINGS),
    fallback,
    generation_receipt: {
      schema_version: 'wss.hero_generation_receipt.v1',
      requested_producer: job.producer,
      generator: ADS_GENERATOR,
      source: {
        prospect_id: job.prospectId,
        domain: normalizedDomain(job.sourceUrl),
        type: candidate.source,
        asset_type: first(candidate.asset_type, candidate.assetType, job.sourceAssetType).toLowerCase(),
        raw_sha256: source.sha256,
      },
      artifacts: {
        raw_sha256: source.sha256,
        ...(optimized.valid ? { optimized_sha256: optimized.sha256, recipe_sha256: optimized.promptSha256 } : {}),
        ...(SHA256_RE.test(clipSha256) ? { master_sha256: clipSha256, clip_sha256: clipSha256 } : {}),
      },
      model: {
        id: WAN_MODEL_ID,
        revision: WAN_MODEL_REVISION,
        settings: safeJsonObject(wanJob && wanJob.modelSettings, DEFAULT_WAN_MODEL_SETTINGS),
      },
      metrics: {
        wall_time_ms: wallTimeMs,
        generation_time_ms: wallTimeMs,
        energy: {
          method: 'configured_power_estimate',
          estimated_power_watts: estimatedPowerWatts,
          estimated_kwh: estimatedKwh,
          gpu_telemetry: {
            samples: 0,
            avgPowerWatts: 0,
            peakPowerWatts: 0,
            energyKwh: 0,
            peakVramMiB: 0,
          },
        },
        electricity_rate_usd_per_kwh: electricityRate,
        estimated_electricity_cost_usd: estimatedCost,
      },
      fallback,
    },
  };
}

function approvedReceiptGenerator(job, receipt) {
  const raw = receipt && typeof receipt === 'object' ? receipt : {};
  const generationReceipt = raw.generation_receipt && typeof raw.generation_receipt === 'object'
    ? raw.generation_receipt
    : raw.approved_artifact && typeof raw.approved_artifact.generation_receipt === 'object'
      ? raw.approved_artifact.generation_receipt
      : {};
  const generator = first(raw.generator, generationReceipt.generator);
  if (job.producer === ADS_PRODUCER) return !generator || generator === ADS_GENERATOR ? ADS_GENERATOR : '';
  if (job.producer !== WAN_PRODUCER || first(generationReceipt.requested_producer, raw.producer) !== WAN_PRODUCER) return '';
  if (generator === WAN_PRODUCER
    && sameSha256(generationReceipt.artifacts && generationReceipt.artifacts.recipe_sha256, WAN_REMASTER_RECIPE_SHA256)
    && first(generationReceipt.model && generationReceipt.model.revision) === WAN_MODEL_REVISION) return WAN_PRODUCER;
  const fallback = generationReceipt.fallback && typeof generationReceipt.fallback === 'object'
    ? generationReceipt.fallback
    : raw.fallback && typeof raw.fallback === 'object'
      ? raw.fallback
      : {};
  if (generator === ADS_GENERATOR
    && fallback.used === true
    && first(fallback.from) === WAN_PRODUCER
    && first(fallback.to) === ADS_PRODUCER
    && isWanTechnicalFailure(fallback.reason)) return ADS_GENERATOR;
  return '';
}

async function resolveReviewReceipt(target, reviewRoot, expectedSha256 = '') {
  const requested = clean(target);
  if (!requested) throw codedError('review_receipt_required');
  const requestedSha256 = clean(expectedSha256).toLowerCase();
  if (requestedSha256 && !SHA256_RE.test(requestedSha256)) throw codedError('review_candidate_sha256_invalid');
  let receiptPath;
  let raw;
  if (/\.json$/i.test(requested) || path.isAbsolute(requested)) {
    if (!requestedSha256) throw codedError('review_candidate_sha256_required');
    receiptPath = path.resolve(requested);
  } else {
    const jobDir = path.join(reviewRoot, requested.replace(/[^a-zA-Z0-9_.-]/g, '_'));
    const names = await fs.promises.readdir(jobDir).catch(() => []);
    const rows = [];
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      const file = path.join(jobDir, name);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) continue;
      let candidateRaw = null;
      try { candidateRaw = JSON.parse(await fs.promises.readFile(file, 'utf8')); }
      catch { /* malformed receipts are never approval evidence */ }
      rows.push({ file, raw: candidateRaw, mtimeMs: stat.mtimeMs });
    }
    rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (requestedSha256) {
      const selected = rows.find((row) => row.raw && sameSha256(row.raw.clip_sha256, requestedSha256));
      if (!selected) throw codedError('review_candidate_sha256_not_found');
      receiptPath = selected.file;
      raw = selected.raw;
    } else {
      if (rows.length > 1) throw codedError('review_candidate_sha256_required');
      receiptPath = rows[0] && rows[0].file;
      raw = rows[0] && rows[0].raw;
    }
  }
  if (!receiptPath || !pathIsInside(reviewRoot, receiptPath)) throw codedError('review_receipt_path_refused');
  if (!raw) raw = JSON.parse(await fs.promises.readFile(receiptPath, 'utf8'));
  const artifact = normalizeApprovedArtifact(raw.approved_artifact);
  const optimized = normalizeOptimizedAsset(raw.optimized_asset);
  if (!artifact.valid || !optimized.valid || !sameSha256(raw.clip_sha256, artifact.clip_sha256)) {
    throw codedError('review_receipt_invalid');
  }
  if (requestedSha256 && !sameSha256(artifact.clip_sha256, requestedSha256)) {
    throw codedError('review_candidate_sha256_mismatch');
  }
  const clipPath = path.resolve(clean(raw.clip_path));
  const realRoot = await fs.promises.realpath(reviewRoot).catch(() => '');
  const realClip = await fs.promises.realpath(clipPath).catch(() => '');
  if (!realRoot || !realClip || !pathIsInside(realRoot, realClip)) throw codedError('review_clip_path_refused');
  await verifiedMp4(realClip, artifact.clip_sha256, path.dirname(realClip));
  return {
    raw,
    receiptPath,
    clipPath: realClip,
    artifact,
    optimized,
    generationRevision: generationRevision(raw.generation_revision),
  };
}

async function markReviewApproved(target, approvedBy, reviewRoot, now = () => new Date(), expectedSha256 = '') {
  const by = clean(approvedBy);
  if (!by || by.length > 120 || /[\u0000-\u001f\u007f]/.test(by)) throw codedError('approved_by_required');
  const receipt = await resolveReviewReceipt(target, reviewRoot, expectedSha256);
  const approvedAt = now().toISOString();
  const updated = {
    ...receipt.raw,
    approved: true,
    approved_by: by,
    approved_at: approvedAt,
  };
  await fs.promises.writeFile(receipt.receiptPath, `${JSON.stringify(updated, null, 2)}\n`);
  return { ...receipt, raw: updated, approvedBy: by, approvedAt };
}

async function uploadApprovedClip(apiImpl, job, candidate, clip, approval, approvedArtifact, posterUrl = '') {
  const artifact = normalizeApprovedArtifact(approvedArtifact);
  if (!artifact.valid) throw codedError('approved_artifact_missing');
  if (
    artifact.raw_sha256 !== candidate.sha256
    || artifact.source_url !== candidate.url
    || artifact.clip_sha256 !== clip.sha256
    || artifact.clip_sha256 !== approval.clipSha256
  ) throw codedError('approved_artifact_mismatch');
  const poster = asHttpsUrl(posterUrl);

  function freshForm() {
    const form = new FormData();
    form.append('job_id', job.jobId);
    form.append('lease_token', job.leaseToken);
    form.append('prospect_id', job.prospectId);
    form.append('source_sha256', candidate.sha256);
    form.append('source_url', candidate.url);
    form.append('approved', 'true');
    form.append('approved_by', approval.approvedBy);
    form.append('approved_at', approval.approvedAt);
    form.append('optimized_sha256', artifact.optimized_sha256);
    form.append('optimized_asset_fingerprint', artifact.optimized_asset_fingerprint);
    form.append('prompt_sha256', artifact.prompt_sha256);
    form.append('image_preparation', artifact.image_preparation);
    if (poster) form.append('poster_url', poster);
    form.append('clip', new Blob([clip.bytes], { type: 'video/mp4' }), 'hero.mp4');
    return form;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await apiImpl('/api/admin/hero-clip-upload', { method: 'POST', body: freshForm() });
    } catch (error) {
      if (attempt === 0) continue;
      throw codedError('clip_upload_transport_failed');
    }
    const hasHttpResponse = response && Number.isInteger(Number(response.status)) && Number(response.status) >= 100;
    if (!hasHttpResponse) {
      if (attempt === 0) continue;
      throw codedError('clip_upload_transport_failed');
    }
    if (!response.ok || !response.body || response.body.ok !== true || response.body.terminal !== true) {
      throw codedError('clip_upload_failed', first(response.body && response.body.error, `http_${response.status}`));
    }
    return response.body;
  }
  throw codedError('clip_upload_transport_failed');
}

async function cleanupWorkDir(dir) {
  const resolved = path.resolve(dir || '');
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith(TEMP_PREFIX)) throw codedError('unsafe_cleanup_path');
  await fs.promises.rm(resolved, { recursive: true, force: true });
}

function createWorker(options = {}) {
  const config = {
    ...configFromEnv(options.env || process.env, { includeOwnerToken: options.allowOwnerApproval === true }),
    ...(options.config || {}),
  };
  const fetchImpl = options.fetchImpl || fetch;
  const selector = options.selector || selectHeroImage;

  async function requestApi(pathname, request = {}, authKind = 'worker') {
    if (authKind === 'worker' && options.allowOwnerApproval === true) {
      throw codedError('owner_mode_worker_operation_forbidden');
    }
    const token = authKind === 'owner' ? config.adminToken : config.workerToken;
    if (!token) {
      throw codedError(authKind === 'owner'
        ? 'GHOST_AGENCY_ADMIN_TOKEN_required_for_approval'
        : 'GHOST_AGENCY_HERO_WORKER_TOKEN_required');
    }
    if (config.credentialCollision || (config.workerToken && config.adminToken && sameCredential(config.workerToken, config.adminToken))) {
      throw codedError('hero_worker_token_must_differ_from_admin');
    }
    if (authKind === 'worker' && config.ownerTokenPresent && options.allowOwnerApproval !== true) {
      throw codedError('owner_token_forbidden_in_worker_mode');
    }
    const headers = { ...(request.headers || {}) };
    for (const name of Object.keys(headers)) {
      if (['authorization', 'x-admin-token', 'x-ghost-hero-worker-token'].includes(name.toLowerCase())) {
        delete headers[name];
      }
    }
    if (authKind === 'owner') headers.authorization = `Bearer ${token}`;
    else headers['x-ghost-hero-worker-token'] = token;
    const authenticated = { ...request, headers };
    if (typeof options.apiImpl === 'function') return options.apiImpl(pathname, authenticated, authKind);
    const response = await fetchImpl(`${config.apiBase}${pathname}`, {
      ...authenticated,
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  }

  const api = (pathname, request = {}) => requestApi(pathname, request, 'worker');
  const ownerApi = (pathname, request = {}) => requestApi(pathname, request, 'owner');

  async function claimJob() {
    const producer = clean(config.producer);
    if (!WORKER_PRODUCERS.has(producer)) throw codedError('hero_worker_producer_invalid');
    const response = await api(`/api/admin/hero-reel?next=1&worker_id=${encodeURIComponent(config.workerId)}&producer=${encodeURIComponent(producer)}`);
    if (!response.ok || !response.body || response.body.ok !== true) {
      throw codedError('claim_failed', first(response.body && response.body.error, `http_${response.status || 0}`));
    }
    const claimed = response.body.job || (response.body.job_id ? response.body : null);
    if (claimed && first(claimed.producer) !== producer) throw codedError('claim_producer_mismatch');
    return claimed;
  }

  async function renewLease(job, { signal } = {}) {
    const response = await api('/api/admin/hero-reel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        job_id: job.jobId,
        action: 'renew',
        lease_token: job.leaseToken,
        worker_id: config.workerId,
        lease_ms: DEFAULT_LEASE_RENEW_MS,
      }),
      ...(signal ? { signal } : {}),
    });
    if (response && response.status === 409) throw codedError('lease_conflict');
    if (!response || !response.ok || !response.body || response.body.ok !== true) {
      throw codedError('lease_renew_failed', first(response && response.body && response.body.error, `http_${response && response.status || 0}`));
    }
    const expiresAt = first(response.body.lease_expires_at, response.body.leaseExpiresAt);
    if (!Number.isFinite(Date.parse(expiresAt))) throw codedError('lease_renew_response_invalid');
    return { ...response.body, lease_expires_at: new Date(Date.parse(expiresAt)).toISOString() };
  }

  async function settle(job, action, verdict) {
    const response = await api('/api/admin/hero-reel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: job.jobId, action, lease_token: job.leaseToken, verdict }),
    });
    if (response.status === 409) throw codedError('lease_conflict');
    if (!response.ok || !response.body || response.body.ok !== true) {
      throw codedError('settle_failed', first(response.body && response.body.error, `http_${response.status || 0}`));
    }
    return response.body;
  }

  async function approveReview(target, approvedBy, clipSha256 = '') {
    if (!config.adminToken) throw codedError('GHOST_AGENCY_ADMIN_TOKEN_required_for_approval');
    const marked = await markReviewApproved(target, approvedBy, config.reviewDir, () => new Date(), clipSha256);
    const response = await ownerApi('/api/admin/hero-reel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        job_id: clean(marked.raw.job_id),
        action: 'approve',
        clip_sha256: marked.artifact.clip_sha256,
        approved_by: marked.approvedBy,
        approved_at: marked.approvedAt,
        generation_revision: marked.generationRevision,
      }),
    });
    if (!response.ok || !response.body || response.body.ok !== true) {
      throw codedError('review_approval_failed', first(response.body && response.body.error, `http_${response.status || 0}`));
    }
    return { receiptPath: marked.receiptPath, sha256: marked.artifact.clip_sha256, job: response.body.job || null };
  }

  async function processJob(rawJob) {
    const job = normalizeLeasedJob(rawJob);
    if (!job.jobId || !job.leaseToken) throw codedError('bad_job_contract');
    if (!job.prospectId || !job.sourceUrl) {
      await settle(job, 'refuse', { ok: false, reason: 'bad_job_contract' });
      return { status: 'refused', reason: 'bad_job_contract' };
    }
    if (![ADS_PRODUCER, WAN_PRODUCER, OPENROUTER_SEEDANCE_PRODUCER].includes(job.producer)) {
      await settle(job, 'refuse', { ok: false, reason: 'unsupported_leased_producer', producer: job.producer });
      return { status: 'refused', reason: 'unsupported_leased_producer' };
    }
    if (job.producer === OPENROUTER_SEEDANCE_PRODUCER) {
      const { runOpenRouterClipJob } = options.openrouterRunnerImpl
        || require('./openrouter-clip-runner.cjs');
      const orResult = await runOpenRouterClipJob(job, {
        apiBase: config.apiBase,
        workerToken: config.workerToken,
        openrouterApiKey: (options.env || process.env).OPENROUTER_API_KEY || '',
      }, options.openrouterDeps || {});
      return orResult.ok
        ? { status: 'ok', sha256: orResult.sha256, costUsd: orResult.costUsd }
        : { status: 'failed', reason: orResult.reason };
    }
    const imagePreparation = normalizeImagePreparation(config.imagePreparation, '');
    if (!imagePreparation) {
      await settle(job, 'fail', { ok: false, reason: 'hero_image_preparation_invalid' });
      return { status: 'failed', reason: 'hero_image_preparation_invalid' };
    }
    const selected = selectOwnedCandidate(job, selector, { imagePreparation });
    if (!selected.best) {
      await settle(job, 'refuse', { ok: false, reason: 'no_verified_owned_photo' });
      return { status: 'refused', reason: 'no_verified_owned_photo' };
    }

    const approval = normalizeApproval(job.approval);
    let durableApprovedArtifact = null;
    let candidate = selected.best;
    if (approval.valid) {
      durableApprovedArtifact = normalizeApprovedArtifact(job.approvedArtifact);
      if (!durableApprovedArtifact.valid || durableApprovedArtifact.clip_sha256 !== approval.clipSha256) {
        await settle(job, 'refuse', { ok: false, reason: 'approved_artifact_mismatch' });
        return { status: 'refused', reason: 'approved_artifact_mismatch' };
      }
      const exactApprovedSource = selectedCandidatesInBankOrder(selected).find((entry) => (
        sameSha256(entry.sha256, durableApprovedArtifact.raw_sha256)
        && entry.url === durableApprovedArtifact.source_url
      ));
      if (!exactApprovedSource) {
        await settle(job, 'refuse', { ok: false, reason: 'approved_artifact_mismatch' });
        return { status: 'refused', reason: 'approved_artifact_mismatch' };
      }
      candidate = exactApprovedSource;
    }
    const makeWorkDir = options.makeWorkDir || (() => fs.promises.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX)));
    const workDir = await makeWorkDir();
    const heartbeat = createLeaseHeartbeat(job, options.renewImpl || renewLease, {
      intervalMs: options.heartbeatIntervalMs,
      timeoutMs: options.heartbeatTimeoutMs,
      setTimeoutImpl: options.setTimeoutImpl,
      clearTimeoutImpl: options.clearTimeoutImpl,
    });
    const settleOwned = async (action, verdict) => {
      await heartbeat.stop();
      heartbeat.assertActive();
      return settle(job, action, verdict);
    };
    try {
      await heartbeat.start();
      let source;
      try {
        if (job.producer === ADS_PRODUCER && !approval.valid) {
          const prepared = await preparePeopleFreeSource(selected, workDir, {
            downloadImpl: options.downloadImpl,
            faceDetector: options.faceDetector,
            facePreflightTimeoutMs: options.facePreflightTimeoutMs,
            fetchImpl,
            lookupImpl: options.lookupImpl,
            env: options.env || process.env,
          });
          candidate = prepared.candidate;
          source = prepared.source;
        } else {
          source = await (options.downloadImpl || downloadAndVerifySource)(candidate, workDir, fetchImpl, {
            lookupImpl: options.lookupImpl,
          });
        }
      } catch (error) {
        const reason = clean(error && error.code) || 'source_download_failed';
        const action = [
          'source_sha256_mismatch',
          'source_not_supported_image',
          'source_url_not_public',
          'no_people_free_owned_photo',
          'people_free_evidence_required',
        ].includes(reason) ? 'refuse' : 'fail';
        await settleOwned(action, { ok: false, reason });
        return { status: action === 'refuse' ? 'refused' : 'failed', reason };
      }
      if (imagePreparation === IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO
        && source.ext !== '.jpg' && source.ext !== '.png') {
        await settleOwned('refuse', { ok: false, reason: 'direct_source_format_unsupported' });
        return { status: 'refused', reason: 'direct_source_format_unsupported' };
      }

      let stagedApproved = null;
      let stagedGenerator = '';
      if (approval.valid) {
        try {
          stagedApproved = await (options.stageApprovedReviewImpl || stageApprovedReview)(
            job, candidate, durableApprovedArtifact, config.reviewDir, workDir,
          );
        } catch (error) {
          const reason = clean(error && error.code) || 'approved_review_artifact_missing';
          await settleOwned('fail', { ok: false, reason });
          return { status: 'failed', reason };
        }
        if (!sameOptimizedAsset(stagedApproved.receipt.optimized_asset, job.optimizedAsset)) {
          await settleOwned('refuse', { ok: false, reason: 'optimized_asset_receipt_mismatch' });
          return { status: 'refused', reason: 'optimized_asset_receipt_mismatch' };
        }
        stagedGenerator = approvedReceiptGenerator(job, stagedApproved.receipt);
        if (!stagedGenerator) {
          await settleOwned('refuse', { ok: false, reason: 'approved_generation_receipt_mismatch' });
          return { status: 'refused', reason: 'approved_generation_receipt_mismatch' };
        }
      } else {
        // A stale requeue from an older worker may expose a locally-held clip
        // before the durable queue has its awaiting_review status. Re-hold the
        // exact receipt; never regenerate or upload it.
        const pending = await reviewReceipts(job, candidate, config.reviewDir);
        if (pending.length) {
          const artifact = normalizeApprovedArtifact(pending[0].raw.approved_artifact);
          const optimized = normalizeOptimizedAsset(pending[0].raw.optimized_asset);
          if (artifact.valid && optimized.valid) {
            if (!approvedReceiptGenerator(job, pending[0].raw)) {
              await settleOwned('refuse', { ok: false, reason: 'pending_generation_receipt_mismatch' });
              return { status: 'refused', reason: 'pending_generation_receipt_mismatch' };
            }
            await settleOwned('hold', holdVerdict(
              artifact,
              optimized,
              Number(pending[0].raw.bytes) || 0,
              pending[0].raw.captured_at,
              job.generationRevision,
              job.producer === ADS_PRODUCER
                ? { ...pending[0].raw, producer: ADS_PRODUCER, generator: ADS_GENERATOR }
                : pending[0].raw,
            ));
            return { status: 'awaiting_review', halt: false };
          }
        }
      }
      const runnerJob = {
        producer: job.producer,
        prospectId: job.prospectId,
        sourceUrl: job.sourceUrl,
        heroImageUrl: candidate.url,
        heroImagePath: source.filePath,
        heroImageSha256: source.sha256,
        heroImageVerified: true,
        heroImageProvenance: { verified: true, url: candidate.url, source: candidate.source, found_on: candidate.found_on },
        heroImageWidth: candidate.width,
        heroImageHeight: candidate.height,
        imagePreparation,
        outDir: workDir,
        adsParams: config.adsParams || job.adsParams,
        cdpUrl: config.cdpUrl,
        ...(job.remasterPrompt ? { remasterPrompt: job.remasterPrompt } : {}),
        ...(stagedApproved ? { approvedClip: {
          approved: true,
          path: stagedApproved.path,
          sha256: approval.clipSha256,
          approvedBy: approval.approvedBy,
          approvedAt: approval.approvedAt,
        } } : {}),
      };
      const adsRunner = options.adsRunnerImpl || options.runnerImpl || ((file) => runRunner(file, {
        cdpUrl: config.cdpUrl,
        env: options.env || process.env,
        timeoutMs: config.runnerTimeoutMs,
      }));
      let outcome;
      let verdict;
      if (stagedApproved) {
        verdict = {
          ok: true,
          status: 'approved',
          generator: stagedGenerator,
          clipPath: stagedApproved.path,
          sha256: approval.clipSha256,
          approval: job.approval,
        };
        outcome = { verdict };
      } else if (job.producer === WAN_PRODUCER) {
        const wanJob = buildWanRunnerJob(job, candidate, source, workDir, config);
        const wanJobFile = path.join(workDir, 'wan-job.json');
        await fs.promises.writeFile(wanJobFile, `${JSON.stringify(wanJob, null, 2)}\n`, { flag: 'wx' });
        const wanRunner = options.wanRunnerImpl || ((file) => runWanJobFile(file, {
          environment: options.env || process.env,
        }));
        let wanOutcome;
        try {
          wanOutcome = await wanRunner(wanJobFile, wanJob);
        } catch (error) {
          wanOutcome = { ok: false, reason: clean(error && error.code) || 'wan_runner_failed' };
        }
        verdict = mapWanResultToReview(job, candidate, wanJob, wanOutcome);
        outcome = wanOutcome;
        if (!verdict || verdict.status !== 'awaiting_review') {
          const reason = first(verdict && verdict.reason, wanOutcome && wanOutcome.reason, 'wan_runner_failed');
          if (config.wanFallbackAds && isWanTechnicalFailure(reason)) {
            const fallbackJobFile = path.join(workDir, 'ads-fallback-job.json');
            await fs.promises.writeFile(fallbackJobFile, `${JSON.stringify(runnerJob, null, 2)}\n`, { flag: 'wx' });
            const fallbackStartedAt = Date.now();
            outcome = await adsRunner(fallbackJobFile, runnerJob);
            const fallbackElapsedMs = Math.max(0, Date.now() - fallbackStartedAt);
            const fallbackVerdict = outcome && outcome.verdict ? outcome.verdict : outcome;
            if (!fallbackVerdict || fallbackVerdict.status !== 'awaiting_review') {
              await settleOwned('fail', { ok: false, reason: 'wan_ads_fallback_review_required', fallback_reason: reason });
              return { status: 'failed', reason: 'wan_ads_fallback_review_required' };
            }
            verdict = {
              ...fallbackVerdict,
              ...adsFallbackProvenance(job, candidate, source, fallbackVerdict, reason, wanJob, fallbackElapsedMs),
            };
          } else {
            const action = wanFailureAction(reason);
            await settleOwned(action, { ok: false, reason, producer: job.producer });
            return { status: action === 'refuse' ? 'refused' : 'failed', reason };
          }
        }
      } else {
        const jobFile = path.join(workDir, 'job.json');
        await fs.promises.writeFile(jobFile, `${JSON.stringify(runnerJob, null, 2)}\n`, { flag: 'wx' });
        outcome = await adsRunner(jobFile, runnerJob);
        verdict = outcome && outcome.verdict ? outcome.verdict : outcome;
        if (verdict && verdict.status === 'awaiting_review') {
          verdict = { ...verdict, producer: job.producer, generator: ADS_GENERATOR };
        }
      }

      if (verdict && verdict.status === 'awaiting_review') {
        const optimized = normalizeOptimizedAsset(verdict.remaster);
        let verifiedReview;
        try {
          verifiedReview = await verifiedReviewCandidates(verdict, workDir);
        } catch (error) {
          const reason = clean(error && error.code) || 'review_artifact_unreadable';
          await settleOwned('fail', { ok: false, reason });
          return { status: 'failed', reason };
        }
        const candidateArtifacts = verifiedReview.map((entry) => ({
          sha256: entry.sha256,
          approved_artifact: approvedArtifactFrom({
            sourceSha256: source.sha256,
            sourceUrl: candidate.url,
            clipSha256: entry.sha256,
            optimizedAsset: verdict.remaster,
          }),
        }));
        const artifact = candidateArtifacts[0] && candidateArtifacts[0].approved_artifact;
        if (!optimized.valid || !artifact || !artifact.valid
          || candidateArtifacts.some((entry) => !entry.approved_artifact.valid)) {
          await settleOwned('fail', { ok: false, reason: 'optimized_asset_provenance_missing' });
          return { status: 'failed', reason: 'optimized_asset_provenance_missing' };
        }
        const manifest = candidateManifest(verifiedReview.map((entry, index) => ({
          ...entry,
          approved_artifact: candidateArtifacts[index].approved_artifact,
        })));
        const capturedAt = new Date().toISOString();
        let review;
        try {
          review = await (options.persistReviewImpl || persistReviewArtifact)(job, {
            ...verdict,
            candidates: verifiedReview,
            candidate_artifacts: candidateArtifacts,
            source_sha256: source.sha256,
            source_url: candidate.url,
            approved_artifact: artifact,
            captured_at: capturedAt,
            optimized_asset: {
              sha256: optimized.sha256,
              url_fingerprint: optimized.urlFingerprint,
              width: optimized.width,
              height: optimized.height,
              prompt_sha256: optimized.promptSha256,
              image_preparation: optimized.imagePreparation,
            },
            generation_revision: job.generationRevision,
          }, workDir, config.reviewDir);
        } catch (error) {
          review = { saved: false, reason: clean(error && error.code) || 'review_artifact_unreadable' };
        }
        if (!review.saved) {
          await settleOwned('fail', { ok: false, reason: review.reason || 'review_artifact_unreadable' });
          return { status: 'failed', reason: review.reason || 'review_artifact_unreadable' };
        }
        const held = holdVerdict(
          artifact,
          optimized,
          review.bytes,
          capturedAt,
          job.generationRevision,
          { ...verdict, candidates: manifest },
        );
        await settleOwned('hold', held);
        return { status: 'awaiting_review', halt: false, review, candidates: manifest };
      }

      if (!verdict || verdict.ok !== true || verdict.status !== 'approved') {
        const reason = runnerFailureReason({
          reason: verdict && verdict.reason,
          detail: verdict && verdict.detail,
          error: outcome && outcome.error,
          stderr: outcome && outcome.stderr,
        });
        await settleOwned('fail', { ok: false, reason });
        return { status: 'failed', reason };
      }
      const expectedGenerator = job.producer === WAN_PRODUCER ? stagedGenerator : ADS_GENERATOR;
      if (!expectedGenerator || verdict.generator !== expectedGenerator) {
        await settleOwned('refuse', { ok: false, reason: 'unexpected_clip_generator' });
        return { status: 'refused', reason: 'unexpected_clip_generator' };
      }

      const finalApproval = normalizeApproval(verdict.approval || verdict.approvedClip || job.approval);
      if (!finalApproval.valid) {
        await settleOwned('refuse', { ok: false, reason: 'clip_approval_receipt_missing' });
        return { status: 'refused', reason: 'clip_approval_receipt_missing' };
      }

      let clip;
      try {
        clip = await verifiedMp4(verdict.clipPath, first(verdict.sha256), workDir);
      } catch (error) {
        const reason = clean(error && error.code) || 'clip_unreadable';
        await settleOwned('refuse', { ok: false, reason });
        return { status: 'refused', reason };
      }
      if (!sameSha256(clip.sha256, finalApproval.clipSha256)) {
        await settleOwned('refuse', { ok: false, reason: 'approved_clip_sha256_mismatch' });
        return { status: 'refused', reason: 'approved_clip_sha256_mismatch' };
      }

      try {
        const durableArtifact = normalizeApprovedArtifact(job.approvedArtifact);
        if (!stagedApproved || !sameApprovedArtifact(stagedApproved.artifact, durableArtifact)) {
          throw codedError('approved_artifact_mismatch');
        }
        heartbeat.assertActive();
        const uploaded = await (options.uploadImpl || uploadApprovedClip)(
          api, job, candidate, clip, finalApproval, durableArtifact, verdict.posterUrl,
        );
        await heartbeat.stop();
        if (!uploaded || uploaded.terminal !== true) throw codedError('upload_not_terminal');
        return { status: 'complete', url: uploaded.url, rebuildQueued: uploaded.rebuild_queued === true };
      } catch (error) {
        await heartbeat.stop();
        if (heartbeat.failed()) {
          return { status: 'failed', reason: 'lease_renewal_failed', halt: false };
        }
        const reason = clean(error && error.code) || 'clip_upload_failed';
        await settle(job, 'fail', { ok: false, reason });
        return { status: 'failed', reason };
      }
    } catch (error) {
      if (heartbeat.failed() || clean(error && error.code) === 'lease_renewal_failed') {
        return { status: 'failed', reason: 'lease_renewal_failed', halt: false };
      }
      throw error;
    } finally {
      await heartbeat.stop();
      await (options.cleanupImpl || cleanupWorkDir)(workDir).catch((error) => log('cleanup warning:', clean(error && error.code) || error.message));
    }
  }

  return { api, workerApi: api, ownerApi, approveReview, claimJob, renewLease, settle, processJob, config };
}

function parsePollMs(argv) {
  const equals = argv.find((arg) => arg.startsWith('--poll-ms='));
  const spacedIndex = argv.indexOf('--poll-ms');
  const value = equals ? equals.slice('--poll-ms='.length) : (spacedIndex >= 0 ? argv[spacedIndex + 1] : '');
  const parsed = Number(value || DEFAULT_POLL_MS);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : DEFAULT_POLL_MS;
}

function argValue(argv, name) {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? clean(argv[index + 1]) : '';
}

const DEFAULT_PARALLELISM = 1;
const MAX_PARALLELISM = 8;

function parseParallelism(argv) {
  const rawArg = argValue(argv, '--parallel');
  const raw = rawArg || (process.env.HERO_WORKER_PARALLELISM || '');
  const parsed = parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PARALLELISM) return parsed;
  return DEFAULT_PARALLELISM;
}

/**
 * Claim up to `parallelism` jobs concurrently and process them all in parallel.
 * Returns { anyJob: boolean, halt: boolean }.
 * A single failed process never blocks the remaining concurrent jobs.
 */
async function runParallelBatch(worker, parallelism, options = {}) {
  const writeLog = options.logImpl || log;
  const claimResults = await Promise.allSettled(
    Array.from({ length: parallelism }, () => worker.claimJob())
  );
  const jobs = [];
  for (const r of claimResults) {
    if (r.status === 'fulfilled' && r.value) jobs.push(r.value);
    else if (r.status === 'rejected') {
      writeLog('claim error:', clean(r.reason && r.reason.code) || String(r.reason && r.reason.message || r.reason).slice(0, 160));
    }
  }
  if (jobs.length === 0) return { anyJob: false, halt: false };
  const processResults = await Promise.allSettled(jobs.map((rawJob) => worker.processJob(rawJob)));
  let halt = false;
  for (let i = 0; i < jobs.length; i++) {
    const r = processResults[i];
    const jobId = first(jobs[i].job_id, jobs[i].jobId);
    if (r.status === 'fulfilled') {
      writeLog('job', jobId, r.value.status, r.value.reason || r.value.url || '');
      if (r.value.halt) halt = true;
    } else {
      writeLog('job error:', jobId, clean(r.reason && r.reason.code) || String(r.reason && r.reason.message || r.reason).slice(0, 160));
    }
  }
  return { anyJob: true, halt };
}

async function runWorkerLoop(worker, options = {}) {
  const once = options.once === true;
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : DEFAULT_POLL_MS;
  const parallelism = Number.isInteger(options.parallelism) && options.parallelism > 1 ? options.parallelism : 1;
  const wait = options.sleepImpl || sleep;
  const writeLog = options.logImpl || log;
  if (parallelism > 1) {
    for (;;) {
      try {
        const { anyJob, halt } = await runParallelBatch(worker, parallelism, { logImpl: writeLog });
        if (!anyJob) {
          if (once) { writeLog('no pending jobs'); return; }
          await wait(pollMs);
          continue;
        }
        if (once || halt) return;
      } catch (error) {
        writeLog('loop error:', clean(error && error.code) || String(error && error.message || error).slice(0, 160));
        if (once) return;
        await wait(pollMs);
      }
    }
  }
  for (;;) {
    try {
      const rawJob = await worker.claimJob();
      if (!rawJob) {
        if (once) { writeLog('no pending jobs'); return; }
        await wait(pollMs);
        continue;
      }
      const result = await worker.processJob(rawJob);
      writeLog('job', first(rawJob.job_id, rawJob.jobId), result.status, result.reason || result.url || '');
      if (once || result.halt) return;
    } catch (error) {
      writeLog('loop error:', clean(error && error.code) || String(error && error.message || error).slice(0, 160));
      if (once) return;
      // A stale or stolen lease abandons only that job. The durable desktop
      // worker must keep polling for the next one.
      await wait(pollMs);
    }
  }
}

async function main(argv = process.argv) {
  const once = argv.includes('--once');
  const pollMs = parsePollMs(argv);
  const parallelism = parseParallelism(argv);
  const reviewTarget = argValue(argv, '--approve-review');
  const worker = createWorker({ allowOwnerApproval: Boolean(reviewTarget) });
  if (reviewTarget) {
    if (!worker.config.adminToken) throw codedError('GHOST_AGENCY_ADMIN_TOKEN_required_for_approval');
    const approvedBy = argValue(argv, '--approved-by');
    const clipSha256 = argValue(argv, '--clip-sha256');
    const approved = await worker.approveReview(reviewTarget, approvedBy, clipSha256);
    log('review approved', approved.sha256, approved.receiptPath);
    return;
  }
  if (!worker.config.workerToken) throw codedError('GHOST_AGENCY_HERO_WORKER_TOKEN_required');
  if (worker.config.credentialCollision) {
    throw codedError('hero_worker_token_must_differ_from_admin');
  }
  if (worker.config.ownerTokenPresent) throw codedError('owner_token_forbidden_in_worker_mode');
  log('worker up', worker.config.apiBase, `id=${worker.config.workerId}`, `producer=${worker.config.producer}`, `parallel=${parallelism}`);
  await runWorkerLoop(worker, { once, pollMs, parallelism });
}

async function runSelfTests() {
  const assert = require('node:assert/strict');
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`PASS ${name}`); }
    catch (error) { results.push(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
  };
  const box = (type, payload) => {
    const bytes = Buffer.alloc(8 + payload.length);
    bytes.writeUInt32BE(bytes.length, 0); bytes.write(type, 4, 4, 'ascii'); payload.copy(bytes, 8);
    return bytes;
  };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomavc1', 'latin1'));
  const mvhdPayload = Buffer.alloc(20); mvhdPayload.writeUInt32BE(1000, 12); mvhdPayload.writeUInt32BE(4000, 16);
  const tkhdPayload = Buffer.alloc(8); tkhdPayload.writeUInt32BE(1280 * 65536, 0); tkhdPayload.writeUInt32BE(720 * 65536, 4);
  const hdlrPayload = Buffer.alloc(12); hdlrPayload.write('vide', 8, 4, 'ascii');
  const stsdPayload = Buffer.concat([Buffer.alloc(8), box('avc1', Buffer.alloc(0))]); stsdPayload.writeUInt32BE(1, 4);
  const stbl = box('stbl', box('stsd', stsdPayload));
  const minf = box('minf', stbl);
  const mdia = box('mdia', Buffer.concat([box('hdlr', hdlrPayload), minf]));
  const trak = box('trak', Buffer.concat([box('tkhd', tkhdPayload), mdia]));
  const moov = box('moov', Buffer.concat([box('mvhd', mvhdPayload), trak]));
  const mp4 = Buffer.concat([ftyp, moov, box('mdat', Buffer.from([1, 2, 3, 4]))]);
  const photo = { url: 'https://cdn.example/work.jpg', sha256: sha256Hex(jpeg), source: 'own_site', found_on: 'https://client.example/gallery', width: 1920, height: 1080, bytes: jpeg.length, no_people: true };
  const optimizedAsset = { sha256: 'b'.repeat(64), url_fingerprint: 'googleusercontent.example/optimized/asset', width: 1280, height: 720, prompt_sha256: 'c'.repeat(64) };
  const approvedArtifact = approvedArtifactFrom({ sourceSha256: photo.sha256, sourceUrl: photo.url, clipSha256: sha256Hex(mp4), optimizedAsset });
  const leased = (item = photo) => ({ job_id: 'job_1', lease_token: 'lease_1', prospect_id: 'prospect_1', source_url: 'https://client.example/', photo_bank: { photos: [item] } });
  const workerEnv = { GHOST_AGENCY_HERO_WORKER_TOKEN: 'self-test-worker-token' };
  const ownerEnv = { ...workerEnv, GHOST_AGENCY_ADMIN_TOKEN: 'self-test-owner-token' };
  const workerPost = (settlements) => async (_pathname, request) => {
    const body = JSON.parse(request.body);
    if (body.action === 'renew') {
      return { ok: true, status: 200, body: { ok: true, lease_expires_at: '2099-01-01T00:00:00.000Z' } };
    }
    settlements.push(body);
    return { ok: true, status: 200, body: { ok: true } };
  };

  await check('canonical env and stable worker id', () => {
    const c = configFromEnv({ GHOST_AGENCY_API_URL: 'https://ghost.example/', ADS_STATION_CDP_URL: 'http://127.0.0.1:9555', ADS_STATION_WORKER_ID: 'forge one' });
    assert.equal(c.apiBase, 'https://ghost.example');
    assert.equal(c.cdpUrl, 'http://127.0.0.1:9555');
    assert.equal(c.workerId, 'forge-one');
  });
  await check('claim uses stable worker id and never prospect-detail', async () => {
    const paths = [];
    const worker = createWorker({ env: { ...workerEnv, ADS_STATION_WORKER_ID: 'desktop-1' }, apiImpl: async (pathname) => {
      paths.push(pathname);
      return { ok: true, status: 200, body: { ok: true, job: null } };
    } });
    assert.equal(await worker.claimJob(), null);
    assert.deepEqual(paths, ['/api/admin/hero-reel?next=1&worker_id=desktop-1&producer=openrouter_seedance']);
  });
  await check('only explicitly owned and SHA-pinned photos survive', () => {
    const job = normalizeLeasedJob({ ...leased(), photo_bank: { photos: [photo, { ...photo, source: 'stock' }, { ...photo, stock_caption_suspect: true }, { ...photo, url: 'http://x.example/x.jpg' }, { ...photo, sha256: '' }] } });
    assert.deepEqual(verifiedCandidates(job).map((item) => item.url), [photo.url]);
    assert.equal(selectOwnedCandidate(job).best.url, photo.url);
  });
  await check('durable photo-bank order wins among selector-surviving photos', () => {
    const fleet = {
      ...photo,
      url: 'https://client.example/uploads/ValleyViewPlumbing-Van6-2880w.jpg',
      sha256: 'a'.repeat(64),
      width: 1920,
      height: 1296,
      bytes: 253285,
      rank: -579,
    };
    const anniversary = {
      ...photo,
      url: 'https://client.example/uploads/25th-Anniversary-for-Valley-View-Plumbing-2160-x-1080-px-1.jpg',
      sha256: 'b'.repeat(64),
      width: 2048,
      height: 1024,
      bytes: 188218,
      rank: -211,
    };
    const job = normalizeLeasedJob({ ...leased(), photo_bank: { photos: [fleet, anniversary] } });
    const chosen = selectOwnedCandidate(job);
    assert.equal(chosen.best.url, fleet.url);
    assert.equal(chosen.rejected.some((row) => row.candidate.url === anniversary.url), true);
  });
  await check('custom selector refusal and null output stay refused', () => {
    const job = normalizeLeasedJob(leased());
    assert.equal(selectOwnedCandidate(job, () => ({ best: null, ranked: [{ candidate: photo, score: 84 }] })).best, null);
    assert.equal(selectOwnedCandidate(job, () => null).best, null);
  });
  await check('downloaded source bytes must match stored SHA', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
    try {
      const fakeFetch = async () => ({ ok: true, status: 200, headers: { get: (name) => name === 'content-length' ? String(jpeg.length) : 'image/jpeg' }, arrayBuffer: async () => jpeg });
      const network = { lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }] };
      const staged = await downloadAndVerifySource(photo, dir, fakeFetch, network);
      assert.equal(staged.sha256, photo.sha256);
      await assert.rejects(() => downloadAndVerifySource({ ...photo, sha256: '0'.repeat(64) }, dir, fakeFetch, network), { code: 'source_sha256_mismatch' });
    } finally { await cleanupWorkDir(dir); }
  });
  await check('runner verdict parser ignores progress lines', () => {
    assert.deepEqual(parseRunnerVerdict('progress\n{"ok":false,"status":"awaiting_review"}\n'), { ok: false, status: 'awaiting_review' });
  });
  await check('awaiting review holds once, continues, and never uploads', async () => {
    const settlements = []; let uploads = 0;
    const worker = createWorker({ env: workerEnv,
      apiImpl: workerPost(settlements),
      downloadImpl: async (_candidate, dir) => { const filePath = path.join(dir, 'source-raw.jpg'); await fs.promises.writeFile(filePath, jpeg); return { filePath, sha256: photo.sha256, bytes: jpeg.length }; },
      runnerImpl: async (_file, runnerJob) => { const clipPath = path.join(runnerJob.outDir, 'review.mp4'); await fs.promises.writeFile(clipPath, mp4); return { verdict: { ok: false, status: 'awaiting_review', review: { clipPath, sha256: sha256Hex(mp4) }, remaster: { optimizedSha256: optimizedAsset.sha256, assetIdentity: { urlFingerprint: optimizedAsset.url_fingerprint, width: optimizedAsset.width, height: optimizedAsset.height }, promptSha256: optimizedAsset.prompt_sha256 } } }; },
      persistReviewImpl: async () => ({ saved: true, path: 'review.mp4', sha256: sha256Hex(mp4) }),
      uploadImpl: async () => { uploads += 1; throw new Error('must not upload'); },
    });
    const result = await worker.processJob(leased());
    assert.equal(result.status, 'awaiting_review'); assert.equal(result.halt, false); assert.equal(uploads, 0);
    assert.equal(settlements.length, 1); assert.equal(settlements[0].action, 'hold'); assert.equal(settlements[0].lease_token, 'lease_1');
    assert.equal(settlements[0].verdict.clip_sha256, sha256Hex(mp4)); assert.equal(settlements[0].verdict.review, undefined);
  });
  await check('approval CLI posts exact held SHA and owner receipt', async () => {
    const reviewRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wss-review-test-'));
    try {
      const jobDir = path.join(reviewRoot, 'job_1'); await fs.promises.mkdir(jobDir);
      const clipPath = path.join(jobDir, `${sha256Hex(mp4)}.mp4`); await fs.promises.writeFile(clipPath, mp4);
      const receiptPath = path.join(jobDir, `${sha256Hex(mp4)}.json`);
      await fs.promises.writeFile(receiptPath, JSON.stringify({
        job_id: 'job_1', prospect_id: 'prospect_1', source_sha256: photo.sha256, source_url: photo.url,
        clip_sha256: sha256Hex(mp4), clip_path: clipPath, approved_artifact: approvedArtifact,
        optimized_asset: optimizedAsset, status: 'awaiting_review', captured_at: new Date().toISOString(),
      }));
      let posted;
      const worker = createWorker({ allowOwnerApproval: true, config: { ...configFromEnv(ownerEnv, { includeOwnerToken: true }), reviewDir: reviewRoot }, apiImpl: async (_pathname, request) => {
        posted = JSON.parse(request.body); return { ok: true, status: 200, body: { ok: true, job: { status: 'queued' } } };
      } });
      const result = await worker.approveReview('job_1', 'owner_console');
      assert.equal(result.sha256, sha256Hex(mp4)); assert.equal(posted.action, 'approve');
      assert.equal(posted.clip_sha256, sha256Hex(mp4)); assert.equal(posted.approved_by, 'owner_console');
      const saved = JSON.parse(await fs.promises.readFile(receiptPath, 'utf8'));
      assert.equal(saved.approved, true); assert.equal(saved.approved_by, 'owner_console');
    } finally {
      await fs.promises.rm(reviewRoot, { recursive: true, force: true });
    }
  });
  await check('SHA mismatch refuses before runner', async () => {
    const settlements = []; let runnerCalls = 0;
    const worker = createWorker({ env: workerEnv,
      apiImpl: workerPost(settlements),
      downloadImpl: async () => { throw codedError('source_sha256_mismatch'); }, runnerImpl: async () => { runnerCalls += 1; },
    });
    const result = await worker.processJob(leased());
    assert.equal(result.reason, 'source_sha256_mismatch'); assert.equal(runnerCalls, 0); assert.equal(settlements[0].action, 'refuse');
  });
  await check('only exact approved MP4 uploads and completes', async () => {
    const clipSha = sha256Hex(mp4); const approvedAt = new Date(Date.now() - 1000).toISOString();
    const settlements = []; let uploadReceipt;
    const job = {
      ...leased(),
      approved_clip: { approved: true, approved_by: 'owner', approved_at: approvedAt, sha256: clipSha },
      approved_artifact: approvedArtifact,
      optimized_asset: optimizedAsset,
    };
    const worker = createWorker({ env: workerEnv,
      apiImpl: workerPost(settlements),
      downloadImpl: async (_candidate, dir) => { const filePath = path.join(dir, 'source-raw.jpg'); await fs.promises.writeFile(filePath, jpeg); return { filePath, sha256: photo.sha256, bytes: jpeg.length }; },
      stageApprovedReviewImpl: async (_job, _candidate, artifact, _reviewRoot, dir) => {
        const clipPath = path.join(dir, 'approved-review.mp4'); await fs.promises.writeFile(clipPath, mp4);
        return { path: clipPath, clip: { bytes: mp4, sha256: clipSha }, artifact, receipt: { optimized_asset: optimizedAsset } };
      },
      runnerImpl: async (_file, runnerJob) => { const clipPath = path.join(runnerJob.outDir, 'hero.mp4'); await fs.promises.writeFile(clipPath, mp4); return { verdict: { ok: true, status: 'approved', generator: 'ads_animate_image', clipPath, sha256: clipSha } }; },
      uploadImpl: async (_api, normalizedJob, candidate, clip, approval, artifact) => { uploadReceipt = { normalizedJob, candidate, clip, approval, artifact }; return { ok: true, terminal: true, url: 'https://storage.example/hero.mp4', rebuild_queued: true }; },
    });
    const result = await worker.processJob(job);
    assert.equal(result.status, 'complete'); assert.equal(uploadReceipt.clip.sha256, clipSha); assert.equal(uploadReceipt.candidate.sha256, photo.sha256);
    assert.equal(uploadReceipt.approval.approvedBy, 'owner'); assert.equal(uploadReceipt.artifact.optimized_sha256, optimizedAsset.sha256); assert.equal(settlements.length, 0);
  });
  await check('multipart carries source and approval receipt', async () => {
    let form;
    const apiImpl = async (_pathname, request) => { form = request.body; return { ok: true, status: 202, body: { ok: true, terminal: true, url: 'https://storage.example/hero.mp4' } }; };
    const job = normalizeLeasedJob(leased());
    const approval = normalizeApproval({ approved: true, approved_by: 'owner', approved_at: new Date(Date.now() - 1000).toISOString(), sha256: sha256Hex(mp4) });
    await uploadApprovedClip(apiImpl, job, photo, { bytes: mp4, sha256: sha256Hex(mp4) }, approval, approvedArtifact);
    assert.equal(form.get('job_id'), 'job_1'); assert.equal(form.get('lease_token'), 'lease_1');
    assert.equal(form.get('source_sha256'), photo.sha256); assert.equal(form.get('source_url'), photo.url);
    assert.equal(form.get('approved'), 'true'); assert.equal(form.get('approved_by'), 'owner'); assert.match(form.get('approved_at'), /^\d{4}-/);
    assert.equal(form.get('optimized_sha256'), optimizedAsset.sha256); assert.equal(form.get('optimized_asset_fingerprint'), optimizedAsset.url_fingerprint);
    assert.equal(form.get('prompt_sha256'), optimizedAsset.prompt_sha256);
    assert.equal(form.get('clip').type, 'video/mp4');
  });
  for (const result of results) console.log(result);
  if (process.exitCode) throw codedError('self_test_failed');
}

module.exports = {
  ADS_GENERATOR, DEFAULT_WAN_MODEL_SETTINGS, DIRECT_SOURCE_RECIPE_SHA256,
  IMAGE_PREPARATION_DIRECT_CLIENT_PHOTO, IMAGE_PREPARATION_IMAGE_EDITOR,
  MAX_REVIEW_CANDIDATES, WAN_TECHNICAL_FAILURES,
  apiBaseFromEnv, approvedArtifactFrom, approvedReceiptGenerator, buildWanRunnerJob,
  candidateManifest, cleanupWorkDir, configFromEnv, createLeaseHeartbeat, createWorker, generationRevision,
  detectFacesWithOpenCv, directSourceExtension, downloadAndVerifySource, holdVerdict, imageExtension, imagePreparationFromEnv,
  isPublicAddress, markReviewApproved,
  isWanNonFallbackFailure, isWanTechnicalFailure, mapWanResultToReview,
  normalizeApproval, normalizeApprovedArtifact, normalizeImagePreparation, normalizeLeasedJob,
  normalizeOptimizedAsset, normalizeOwnedCandidate, parsePollMs,
  parseRunnerVerdict, persistReviewArtifact, pinnedHttpsRequest, pinnedLookup,
  preparePeopleFreeSource, readBoundedResponse, remoteAddressAllowed, resolveReviewReceipt, reviewReceipts,
  runRunner, runWorkerLoop, runParallelBatch, parseParallelism, sameApprovedArtifact, sameOptimizedAsset, scrubRunnerEnv, selectOwnedCandidate,
  selectedCandidatesInBankOrder, sha256Hex, stableWorkerId, stageApprovedReview, uploadApprovedClip, validatePublicSourceUrl,
  validatedWanMetrics, verifiedCandidates, verifiedMp4, wanGenerationReceipt,
  verifiedReviewCandidates,
};

if (require.main === module) {
  if (process.argv.includes('--test')) runSelfTests().catch((error) => { console.error('FAIL self-tests:', error.message); process.exit(1); });
  else main().catch((error) => { console.error('FATAL', clean(error && error.code) || error.message); process.exit(1); });
}
