#!/usr/bin/env node
'use strict';

/**
 * scripts/ads-station/openrouter-clip-runner.cjs — OpenRouter Seedance
 * image-to-video producer for the hero pipeline.
 *
 * ============================ NO BROWSER, NO GPU ============================
 * This runner calls the OpenRouter REST API only.  It requires one env var:
 *   OPENROUTER_API_KEY  — your OpenRouter key (never logged, never stored)
 * No Chrome, no ffmpeg, no local model.  It can run anywhere Node runs.
 * ===========================================================================
 *
 * MEASURED FACTS (job EVmCkr3799kO8vwaiwgm, 2026-08-24):
 *   - Endpoint: POST https://openrouter.ai/api/v1/videos
 *   - Response: 202 + { polling_url }
 *   - Poll GET polling_url every 15s: pending -> in_progress -> completed
 *   - Completed: GET .../content?index=0 -> MP4 bytes
 *   - usage.cost in the final poll response records the real spend
 *
 * CRITICAL: generate_audio MUST be false.  Audio generation trips a copyright
 * filter and fails the job.  This flag is hardwired and never configurable.
 *
 * PROMPT PRESETS — ported from wan-hero-video-pack (issue #322):
 *   A: cinematic-push  — slow stabilized push-in; single motion arc; ~5 s
 *   B: low-glide       — smooth low lateral glide; subtle parallax; ~5 s
 * Vertical-specific camera/motion directions are pulled from the same
 * verticals.json the WAN runner uses.  The shared negative prompt list
 * prevents the most common generative failure modes.
 *
 * THE HERO JOB CONTRACT (same shape as WAN and Ads runners):
 *   GET  /api/admin/hero-reel?next=1&worker_id=<id>&producer=openrouter_seedance
 *   POST /api/admin/hero-reel { job_id, action, lease_token, verdict }
 *   POST /api/admin/hero-clip-upload  (multipart: clip + fields)
 *
 * Run one poll cycle:
 *   node scripts/ads-station/openrouter-clip-runner.cjs
 * Run continuously:
 *   HERO_FORGE_LOOP=1 node scripts/ads-station/openrouter-clip-runner.cjs
 */

const https = require('node:https');
const http = require('node:http');
const { createHash } = require('node:crypto');
const path = require('node:path');

// ---------------------------------------------------------------------------
// CONSTANTS — measured facts, not guesses.
// ---------------------------------------------------------------------------

const OPENROUTER_VIDEO_ENDPOINT = 'https://openrouter.ai/api/v1/videos';
const MODEL_MINI = 'bytedance/seedance-2.0-mini';   // ~3 cents/sec
const MODEL_PREMIUM = 'x-ai/grok-imagine-video';    // ~5 cents/sec
const RESOLUTION = '720p';
const ASPECT_RATIO = '16:9';
const GENERATE_AUDIO = false;   // HARDWIRED: audio trips copyright filter
const DEFAULT_DURATION = 5;
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 40;   // 40 × 15 s = 10 min ceiling
const PRODUCER_STAMP = 'openrouter_seedance';
const MIN_CLIP_BYTES = 10_000;
const MAX_CLIP_BYTES = 4 * 1024 * 1024;   // 4 MiB — Vercel hard ceiling

// Motion preset A: cinematic-push
const MOTION_A_LABEL = 'cinematic-push';
const MOTION_A_CAMERA = 'slow stabilized push-in with subtle lateral parallax';
const MOTION_A_MOTION = 'gentle natural environmental motion; preserve identity and geometry exactly';

// Motion preset B: low-glide
const MOTION_B_LABEL = 'low-glide';
const MOTION_B_CAMERA = 'smooth low lateral glide with natural foreground parallax';
const MOTION_B_MOTION = 'subtle ambient motion only; no sudden moves or camera shake';

// Negative prompt — shared with WAN pack to suppress common generative failure modes.
const NEGATIVE_PROMPT = [
  'cartoon', 'CGI look', 'game render', 'surreal', 'fantasy',
  'morphing', 'melting', 'warping', 'wobbling architecture',
  'bent straight lines', 'duplicated objects', 'duplicated people',
  'extra limbs', 'deformed hands', 'deformed faces', 'changing identity',
  'fake signage', 'changed logo', 'misspelled text', 'invented text',
  'invented workers', 'invented customers', 'invented equipment',
  'invented building features', 'impossible geometry',
  'extreme camera shake', 'excessive speed', 'hyperlapse',
  'excessive wind', 'flicker', 'temporal inconsistency',
  'pulsing textures', 'oversharpening', 'oversaturation',
  'artificial depth', 'floating objects',
].join(', ');

// Vertical-specific camera and motion guidance — mirrors verticals.json.
const VERTICAL_DIRECTIONS = {
  plumbing: 'slow stabilized push-in with slight lateral parallax around the plumber, fixture, pipework, or finished installation',
  hvac: 'controlled low-angle push or gentle lateral tracking move around the technician, condenser, furnace, or finished system',
  electrical: 'slow precision dolly toward the electrician, panel, lighting installation, or finished electrical work with mild parallax',
  roofing: 'cinematic drone-like rise and forward glide across the real roofline, or a slow ground-to-roof reveal when the source perspective supports it',
  fencing: 'smooth lateral tracking move following the fence line, then a gentle push toward the finished project',
  concrete: 'low cinematic glide across the finished slab, driveway, patio, steps, or decorative surface, creating strong foreground parallax',
  landscaping: 'smooth low drone-like glide through the real landscape, passing near foreground plants or hardscape for strong natural parallax',
  med_spa: 'very slow elegant dolly or subtle orbit through the real treatment room or around the provider/client scene without changing faces or equipment',
  hair_salon: 'smooth premium dolly through the real salon or gentle orbit around the stylist/client scene while preserving faces and hairstyle',
  tattoo: 'slow moody precision push or subtle orbit around the real artist, client, studio, or finished tattoo while preserving the exact artwork',
  restoration: 'controlled documentary-commercial push through the real work area or lateral move around technicians/equipment',
  general_contractor: 'cinematic forward glide or lateral reveal through the real completed project, using foreground architecture for strong depth',
};

// ---------------------------------------------------------------------------
// PROMPT BUILDER
// ---------------------------------------------------------------------------

/**
 * buildPrompt(options) — assemble the final text prompt sent to the model.
 *
 * @param {object} options
 * @param {'A'|'B'} [options.motionPreset='A']  A=cinematic-push, B=low-glide
 * @param {string}  [options.vertical='']       Trade vertical slug
 * @param {string}  [options.businessName='']   Client's business name
 */
function buildPrompt({ motionPreset = 'A', vertical = '', businessName = '' } = {}) {
  const presetCamera = motionPreset === 'B' ? MOTION_B_CAMERA : MOTION_A_CAMERA;
  const presetMotion = motionPreset === 'B' ? MOTION_B_MOTION : MOTION_A_MOTION;

  const slug = String(vertical || '').toLowerCase().replace(/[\s-]+/g, '_');
  const verticalCamera = VERTICAL_DIRECTIONS[slug] || presetCamera;

  const parts = [
    'Image-to-video: animate this real client photograph into a 5-second professional commercial hero clip.',
    `Camera: ${verticalCamera}.`,
    `Motion: ${presetMotion}.`,
    'Preserve the exact scene, all faces, logos, text, and equipment exactly as they appear in the photo.',
    'Natural cinematic lighting; no stylistic filters; no color grading; no added people or objects.',
    businessName ? `This is the real workspace of ${businessName}.` : '',
    `Negative: ${NEGATIVE_PROMPT}.`,
  ];
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// HTTP HELPERS — fetch-style wrappers over node:https with no new deps.
// ---------------------------------------------------------------------------

function httpRequest(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { ...headers },
    };
    const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    if (bodyBuf) {
      options.headers['content-type'] = 'application/json';
      options.headers['content-length'] = bodyBuf.length;
    }
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('http_request_timeout')); });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function jsonRequest(urlStr, opts = {}) {
  const res = await httpRequest(urlStr, opts);
  let json = null;
  try { json = JSON.parse(res.body.toString('utf8')); } catch { /* raw */ }
  return { status: res.status, json, rawBody: res.body, headers: res.headers };
}

// ---------------------------------------------------------------------------
// OPENROUTER VIDEO API
// ---------------------------------------------------------------------------

/**
 * submitVideoJob(apiKey, submissionBody, fetchImpl) — POST to OpenRouter video
 * endpoint.  Returns { ok, jobId, pollingUrl } on 202, or { ok: false, reason }.
 */
async function submitVideoJob(apiKey, submissionBody, fetchImpl = jsonRequest) {
  if (!apiKey) return { ok: false, reason: 'openrouter_unauthorized' };
  let res;
  try {
    res = await fetchImpl(OPENROUTER_VIDEO_ENDPOINT, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey },
      body: submissionBody,
    });
  } catch (err) {
    return { ok: false, reason: 'openrouter_submit_network_error', detail: String(err && err.message || err).slice(0, 200) };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'openrouter_unauthorized' };
  if (res.status !== 202) {
    const errMsg = String(res.json?.error?.message || res.json?.message || '').slice(0, 200);
    return { ok: false, reason: 'openrouter_submit_failed', detail: `HTTP ${res.status}: ${errMsg}` };
  }
  const pollingUrl = String(res.json?.polling_url || '').trim();
  if (!pollingUrl) return { ok: false, reason: 'openrouter_submit_no_polling_url' };
  return { ok: true, pollingUrl };
}

/**
 * pollVideoJob(apiKey, pollingUrl, options) — poll until completed or failed.
 * Returns { ok, status, contentUrl, costUsd } or { ok: false, reason }.
 */
async function pollVideoJob(apiKey, pollingUrl, {
  maxAttempts = MAX_POLL_ATTEMPTS,
  pollIntervalMs = POLL_INTERVAL_MS,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
  fetchImpl = jsonRequest,
} = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleepImpl(pollIntervalMs);
    let res;
    try {
      res = await fetchImpl(pollingUrl, {
        headers: { authorization: 'Bearer ' + apiKey },
      });
    } catch (err) {
      return { ok: false, reason: 'openrouter_poll_network_error', detail: String(err && err.message || err).slice(0, 200) };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'openrouter_unauthorized' };
    if (res.status !== 200) {
      return { ok: false, reason: 'openrouter_poll_failed', detail: `HTTP ${res.status}` };
    }
    const statusVal = String(res.json?.status || '').toLowerCase();
    const costUsd = Number(res.json?.usage?.cost ?? res.json?.usage?.total_cost ?? 0);
    if (statusVal === 'completed') {
      const contentUrl = String(res.json?.output?.url || res.json?.url || '').trim()
        || `${pollingUrl.replace(/\?.*$/, '')}/content?index=0`;
      return { ok: true, status: 'completed', contentUrl, costUsd, raw: res.json };
    }
    if (statusVal === 'failed' || statusVal === 'error') {
      const errMsg = String(res.json?.error?.message || res.json?.message || '').slice(0, 200);
      return { ok: false, reason: 'openrouter_generation_failed', detail: errMsg, costUsd };
    }
    // pending / in_progress — continue polling
  }
  return { ok: false, reason: 'openrouter_poll_timeout' };
}

/**
 * downloadClip(contentUrl, apiKey, fetchImpl) — download the produced MP4.
 * Returns { ok, bytes } or { ok: false, reason }.
 */
async function downloadClip(contentUrl, apiKey, fetchImpl = httpRequest) {
  let res;
  try {
    res = await fetchImpl(contentUrl, {
      headers: { authorization: 'Bearer ' + apiKey },
      timeoutMs: 120_000,
    });
  } catch (err) {
    return { ok: false, reason: 'openrouter_download_failed', detail: String(err && err.message || err).slice(0, 200) };
  }
  if (res.status !== 200) return { ok: false, reason: 'openrouter_download_failed', detail: `HTTP ${res.status}` };
  const bytes = res.rawBody || res.body;
  if (!Buffer.isBuffer(bytes) || bytes.length < MIN_CLIP_BYTES) {
    return { ok: false, reason: 'openrouter_clip_too_small' };
  }
  if (bytes.length > MAX_CLIP_BYTES) {
    return { ok: false, reason: 'openrouter_clip_too_large' };
  }
  return { ok: true, bytes };
}

// ---------------------------------------------------------------------------
// JOB CONTRACT HELPERS — match the hero-reel job queue shape.
// ---------------------------------------------------------------------------

function clean(value) {
  return String(value ?? '').trim();
}

function first(...values) {
  for (const v of values) { const s = clean(v); if (s) return s; }
  return '';
}

function asHttpsUrl(value) {
  const s = clean(value);
  if (!s) return '';
  try {
    const u = new URL(s);
    return (u.protocol === 'https:') ? s : '';
  } catch { return ''; }
}

function normalizeLeasedJob(raw) {
  const job = raw && typeof raw === 'object' ? raw : {};
  const bank = job.photo_bank && typeof job.photo_bank === 'object' ? job.photo_bank : {};
  const photos = Array.isArray(bank.photos) ? bank.photos : [];
  return {
    raw: job,
    jobId: first(job.job_id, job.jobId),
    leaseToken: first(job.lease_token, job.leaseToken),
    prospectId: first(job.prospect_id, job.prospectId),
    sourceUrl: asHttpsUrl(first(job.source_url, job.sourceUrl)),
    producer: first(job.producer) || PRODUCER_STAMP,
    vertical: first(job.vertical, job.industry, job.category),
    businessName: first(job.business_name, job.businessName),
    motionPreset: /^[Bb]$/.test(String(job.motion_preset || job.motionPreset || '').trim()) ? 'B' : 'A',
    duration: Number(job.duration_seconds || job.duration || DEFAULT_DURATION) || DEFAULT_DURATION,
    model: first(job.openrouter_model, job.model) || MODEL_MINI,
    photos,
    approvedClip: job.approved_clip || job.approvedClip || null,
  };
}

/**
 * bestOwnedPhoto(photos) — return the first photo with source=own_site and
 * a valid https URL.  The hero job contract always supplies client-owned
 * photos; if none are found the job is refused, not failed.
 */
function bestOwnedPhoto(photos) {
  for (const p of photos) {
    const url = asHttpsUrl(first(p.url));
    const source = clean(p.source).toLowerCase();
    const sha256 = clean(p.sha256).toLowerCase();
    if (url && source === 'own_site' && /^[0-9a-f]{64}$/.test(sha256)) {
      return { url, sha256, source };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// UPLOAD HELPER — multipart POST to /api/admin/hero-clip-upload
// ---------------------------------------------------------------------------

async function uploadClip({ apiBase, workerToken, job, photo, clip, clipSha256, verdict, fetchImpl = httpRequest } = {}) {
  const boundary = `--wss-boundary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const CRLF = '\r\n';

  function part(name, value) {
    return `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`;
  }

  const fields = [
    part('prospect_id', clean(job.prospectId)),
    part('job_id', clean(job.jobId)),
    part('lease_token', clean(job.leaseToken)),
    part('producer', PRODUCER_STAMP),
    part('generator', PRODUCER_STAMP),
    part('source', 'openrouter_i2v'),
    part('source_sha256', clean(photo.sha256)),
    part('source_url', clean(photo.url)),
    part('model_id', clean(verdict.modelId || verdict.model || MODEL_MINI)),
    part('cost_usd', String(Number(verdict.costUsd || 0))),
    part('wall_time_ms', String(Number(verdict.wallTimeMs || 0))),
    part('generation_time_ms', String(Number(verdict.generationTimeMs || 0))),
    part('generate_audio', 'false'),
  ].join('');

  const clipPart = [
    `--${boundary}${CRLF}`,
    `Content-Disposition: form-data; name="clip"; filename="hero.mp4"${CRLF}`,
    `Content-Type: video/mp4${CRLF}${CRLF}`,
  ].join('');

  const body = Buffer.concat([
    Buffer.from(fields, 'utf8'),
    Buffer.from(clipPart, 'utf8'),
    clip,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8'),
  ]);

  const res = await fetchImpl(`${apiBase}/api/admin/hero-clip-upload`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + workerToken,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': body.length,
    },
    timeoutMs: 120_000,
    rawBody: body,
  });
  const json = (() => { try { return JSON.parse((res.rawBody || res.body).toString('utf8')); } catch { return null; } })();
  if (res.status !== 202) {
    return { ok: false, reason: 'upload_failed', detail: `HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 200)}` };
  }
  return { ok: true, status: res.status, body: json };
}

// ---------------------------------------------------------------------------
// FORGE API HELPERS
// ---------------------------------------------------------------------------

async function callForgeApi(apiBase, workerToken, urlPath, { method = 'GET', body = null, fetchImpl = jsonRequest } = {}) {
  const opts = {
    method,
    headers: { authorization: 'Bearer ' + apiKey },
  };
  if (body) opts.body = body;
  return fetchImpl(`${apiBase}${urlPath}`, opts);
}

async function claimNextJob(apiBase, workerToken, workerId, { fetchImpl } = {}) {
  const res = await callForgeApi(
    apiBase, workerToken,
    `/api/admin/hero-reel?next=1&worker_id=${encodeURIComponent(workerId)}&producer=${encodeURIComponent(PRODUCER_STAMP)}`,
    { fetchImpl },
  );
  if (res.status === 204 || !res.json) return { job: null };
  const raw = res.json.job || (res.json.job_id ? res.json : null);
  if (!raw) return { job: null };
  return { job: normalizeLeasedJob(raw) };
}

async function settleJob(apiBase, workerToken, job, action, verdict, { fetchImpl } = {}) {
  return callForgeApi(apiBase, workerToken, '/api/admin/hero-reel', {
    method: 'POST',
    body: { job_id: job.jobId, action, lease_token: job.leaseToken, verdict },
    fetchImpl,
  });
}

// ---------------------------------------------------------------------------
// CORE RUNNER — runOpenRouterClipJob
// ---------------------------------------------------------------------------

/**
 * runOpenRouterClipJob(job, config, deps) — run one hero video job end-to-end:
 *   1. Validate job contract.
 *   2. Build the model prompt.
 *   3. Submit to OpenRouter video API.
 *   4. Poll until completed.
 *   5. Download the produced MP4.
 *   6. Upload via /api/admin/hero-clip-upload.
 *   7. Settle the job on the queue.
 *
 * All network I/O is injected via `deps` so tests can run without a network.
 *
 * @returns {{ ok, reason?, detail?, costUsd?, sha256? }}
 */
async function runOpenRouterClipJob(job, config = {}, deps = {}) {
  const {
    apiBase,
    workerToken,
    openrouterApiKey,
  } = config;

  const {
    submitImpl = submitVideoJob,
    pollImpl = pollVideoJob,
    downloadImpl = downloadClip,
    uploadImpl = uploadClip,
    settleImpl = settleJob,
    nowMs = () => Date.now(),
  } = deps;

  if (!job || !job.jobId || !job.leaseToken) {
    return { ok: false, reason: 'bad_job_contract' };
  }
  if (!job.sourceUrl && !job.photos.length) {
    await settleImpl(apiBase, workerToken, job, 'refuse', { ok: false, reason: 'no_verified_owned_photo' }, deps);
    return { ok: false, reason: 'no_verified_owned_photo' };
  }

  const photo = bestOwnedPhoto(job.photos);
  if (!photo) {
    await settleImpl(apiBase, workerToken, job, 'refuse', { ok: false, reason: 'no_verified_owned_photo' }, deps);
    return { ok: false, reason: 'no_verified_owned_photo' };
  }

  if (!openrouterApiKey) {
    await settleImpl(apiBase, workerToken, job, 'fail', { ok: false, reason: 'openrouter_unauthorized' }, deps);
    return { ok: false, reason: 'openrouter_unauthorized' };
  }

  const prompt = buildPrompt({
    motionPreset: job.motionPreset,
    vertical: job.vertical,
    businessName: job.businessName,
  });

  const submissionBody = {
    model: job.model || MODEL_MINI,
    prompt,
    frame_images: [{
      type: 'image_url',
      image_url: { url: photo.url },
      frame_type: 'first_frame',
    }],
    duration: job.duration || DEFAULT_DURATION,
    resolution: RESOLUTION,
    aspect_ratio: ASPECT_RATIO,
    generate_audio: GENERATE_AUDIO,   // MUST be false — never override
  };

  const startMs = nowMs();

  // Step 3: Submit
  const submission = await submitImpl(openrouterApiKey, submissionBody, deps.fetchImpl);
  if (!submission.ok) {
    const action = submission.reason === 'openrouter_unauthorized' ? 'fail' : 'fail';
    await settleImpl(apiBase, workerToken, job, action, { ok: false, reason: submission.reason, detail: submission.detail }, deps);
    return { ok: false, reason: submission.reason, detail: submission.detail };
  }

  // Step 4: Poll
  const poll = await pollImpl(openrouterApiKey, submission.pollingUrl, {
    pollIntervalMs: deps.pollIntervalMs,
    maxAttempts: deps.maxAttempts,
    sleepImpl: deps.sleepImpl,
    fetchImpl: deps.fetchImpl,
  });
  const generationTimeMs = Math.max(0, nowMs() - startMs);
  if (!poll.ok) {
    await settleImpl(apiBase, workerToken, job, 'fail', { ok: false, reason: poll.reason, detail: poll.detail, cost_usd: poll.costUsd || 0 }, deps);
    return { ok: false, reason: poll.reason, detail: poll.detail };
  }

  const wallTimeMs = Math.max(0, nowMs() - startMs);

  // Step 5: Download
  const download = await downloadImpl(poll.contentUrl, openrouterApiKey, deps.fetchImpl);
  if (!download.ok) {
    await settleImpl(apiBase, workerToken, job, 'fail', { ok: false, reason: download.reason, detail: download.detail }, deps);
    return { ok: false, reason: download.reason };
  }

  const clipSha256 = createHash('sha256').update(download.bytes).digest('hex');

  // Step 6: Upload
  const verdict = {
    modelId: submissionBody.model,
    costUsd: poll.costUsd || 0,
    wallTimeMs,
    generationTimeMs,
    generate_audio: GENERATE_AUDIO,
  };
  const upload = await uploadImpl({
    apiBase, workerToken, job, photo,
    clip: download.bytes,
    clipSha256,
    verdict,
    fetchImpl: deps.fetchImpl,
  });
  if (!upload.ok) {
    await settleImpl(apiBase, workerToken, job, 'fail', { ok: false, reason: upload.reason, detail: upload.detail }, deps);
    return { ok: false, reason: upload.reason };
  }

  // Step 7: Settle
  await settleImpl(apiBase, workerToken, job, 'complete', {
    ok: true,
    producer: PRODUCER_STAMP,
    generator: PRODUCER_STAMP,
    source: 'openrouter_i2v',
    sha256: clipSha256,
    model_id: submissionBody.model,
    cost_usd: verdict.costUsd,
    wall_time_ms: wallTimeMs,
    generation_time_ms: generationTimeMs,
    generate_audio: GENERATE_AUDIO,
  }, deps);

  return { ok: true, sha256: clipSha256, costUsd: verdict.costUsd, wallTimeMs };
}

// ---------------------------------------------------------------------------
// POLL LOOP — CLI entry point
// ---------------------------------------------------------------------------

function configFromEnv(env = process.env) {
  const apiBase = String(env.GHOST_AGENCY_API_URL || env.GHOST_BASE || '').replace(/\/+$/, '');
  const workerToken = String(env.GHOST_AGENCY_HERO_WORKER_TOKEN || '').trim();
  const openrouterApiKey = String(env.OPENROUTER_API_KEY || '').trim();
  const workerId = String(env.ADS_STATION_WORKER_ID || env.HERO_FORGE_WORKER_ID || `openrouter-${require('node:os').hostname()}`).replace(/[^a-zA-Z0-9_.:-]+/g, '-').slice(0, 120) || 'openrouter-worker';
  const loop = /^(1|true|yes|on)$/i.test(String(env.HERO_FORGE_LOOP || '').trim());
  const loopIntervalMs = Number(env.HERO_FORGE_LOOP_INTERVAL_MS || 10_000);
  return { apiBase, workerToken, openrouterApiKey, workerId, loop, loopIntervalMs };
}

async function runOnce(config) {
  const { apiBase, workerToken, workerId } = config;
  const claimed = await claimNextJob(apiBase, workerToken, workerId);
  if (!claimed.job) {
    process.stdout.write('openrouter-clip-runner: no job available\n');
    return { status: 'idle' };
  }
  const job = claimed.job;
  process.stdout.write(`openrouter-clip-runner: claimed job ${job.jobId} for prospect ${job.prospectId}\n`);
  const result = await runOpenRouterClipJob(job, config);
  process.stdout.write(`openrouter-clip-runner: job ${job.jobId} -> ${result.ok ? 'ok' : result.reason}\n`);
  return { status: result.ok ? 'ok' : 'failed', result };
}

async function main() {
  const config = configFromEnv();
  if (!config.apiBase) { process.stderr.write('GHOST_AGENCY_API_URL is required\n'); process.exit(1); }
  if (!config.workerToken) { process.stderr.write('GHOST_AGENCY_HERO_WORKER_TOKEN is required\n'); process.exit(1); }
  if (!config.openrouterApiKey) { process.stderr.write('OPENROUTER_API_KEY is required\n'); process.exit(1); }

  if (config.loop) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try { await runOnce(config); } catch (err) { process.stderr.write(`openrouter-clip-runner error: ${err && err.message}\n`); }
      await new Promise((r) => setTimeout(r, config.loopIntervalMs));
    }
  } else {
    const out = await runOnce(config);
    process.exit(out.status === 'failed' ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// EXPORTS — all core functions are exported for unit testing.
// ---------------------------------------------------------------------------

module.exports = {
  PRODUCER_STAMP,
  MODEL_MINI,
  MODEL_PREMIUM,
  GENERATE_AUDIO,
  MOTION_A_LABEL,
  MOTION_B_LABEL,
  NEGATIVE_PROMPT,
  VERTICAL_DIRECTIONS,
  buildPrompt,
  submitVideoJob,
  pollVideoJob,
  downloadClip,
  uploadClip,
  normalizeLeasedJob,
  bestOwnedPhoto,
  runOpenRouterClipJob,
  configFromEnv,
};

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`fatal: ${err && err.message}\n`); process.exit(1); });
}
