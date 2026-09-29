"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const dns = require("node:dns").promises;
const fs = require("node:fs");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const {
  DIRECT_SOURCE_RECIPE_SHA256,
  MIN_ASPECT: HERO_MIN_ASPECT,
  MAX_ASPECT: HERO_MAX_ASPECT,
  MAX_CLIP_BYTES,
  SEEDANCE_DURATION_SEC,
  isSeedanceDuration,
  SEEDANCE_MODEL_ID,
  SEEDANCE_MAX_COST_USD,
  SEEDANCE_RECEIPT_SCHEMA,
  validateHeroClip,
} = require("./hero-clip-validation");
const {
  CLIENT_ASSETS_BUCKET,
  CLIENT_ASSETS_PREFIX,
  assetKeyForSha256,
  defaultAssetStores,
  extFromUrl,
} = require("./client-asset-store");
const { imageDimensions } = require("./capture-brand");
const heroBudget = require("./line-hero-budget");
const {
  decodeRgb: decodeVisualSourceRgb,
  frameStats: visualFrameStats,
  localVarianceMap: visualLocalVarianceMap,
} = require("./hero-video-visual-attester");
const { OPENROUTER_SEEDANCE_PRODUCER } = require("./hero-video-policy");
const { stableSerialize } = require("./wan-hero-policy");
const {
  HERO_JOB_CAPABILITY_HEADER,
  HERO_JOB_CAPABILITY_LAUNCH_SCHEMA,
  HERO_JOB_CAPABILITY_MAX_BYTES,
  HERO_JOB_LEASE_HEADER,
} = require("./hero-job-capability");

const OPENROUTER_VIDEO_ENDPOINT = "https://openrouter.ai/api/v1/videos";
const OPENROUTER_ORIGIN = new URL(OPENROUTER_VIDEO_ENDPOINT).origin;
const DEFAULT_API_BASE = "https://ghost.wss-ai.com";
// This must stay byte-for-byte aligned with hero-forge-worker.cjs because the
// owner watcher reads receipts from that worker's configured review directory.
const DEFAULT_REVIEW_DIR = path.join(os.tmpdir(), "wss-hero-reviews");
const DEFAULT_POLL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 40;
const MAX_OUTPUT_REDIRECTS = 3;
const SOURCE_TYPES = new Set(["own_site", "gbp"]);
const SUBMIT_REVIEW_REASON = "seedance_submit_reconciliation_required";
const OPENROUTER_FAILURE_SCHEMA = "wss.openrouter_failure.v1";
const OPENROUTER_FAILURE_TYPES = new Set([
  "authentication", "permission_denied", "payment_required", "rate_limit_exceeded",
  "provider_overloaded", "provider_unavailable", "invalid_request", "invalid_prompt",
  "not_found", "precondition_failed", "payload_too_large", "unprocessable",
  "content_policy_violation", "refusal", "invalid_image", "image_too_large",
  "image_too_small", "unsupported_image_format", "image_not_found",
  "image_download_failed", "server", "timeout", "unmapped",
]);
const OPENROUTER_FAILURE_PARAMETERS = new Set([
  "model", "prompt", "frame_images", "image_url", "duration",
  "resolution", "aspect_ratio", "generate_audio", "request_body",
]);
// Historical accepted checkpoints may already bind an older, larger source.
// New generation stays below the Vercel source-bridge raw-body ceiling.
const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PROXY_SOURCE_IMAGE_BYTES = 4_000_000;
// Provider clips may be larger than the Vercel multipart upload envelope. The
// worker admits a bounded download and reduces bytes before review/upload.
// Keep enough headroom for measured Seedance outputs without allowing ten
// parallel workers to reserve hundreds of megabytes for provider downloads.
const MAX_PROVIDER_CLIP_BYTES = 16 * 1024 * 1024;
const DEFAULT_TRANSCODE_TIMEOUT_MS = 120_000;
const DEFAULT_SOURCE_RETRY_ATTEMPTS = 3;
const DEFAULT_ACCEPTED_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ACCEPTED_CLAIM_CAP = 8;
const TRANSIENT_ACCEPTED_ERRORS = new Set([
  "openrouter_poll_failed",
  "openrouter_poll_timeout",
  "openrouter_download_failed",
  "openrouter_download_timeout",
  "openrouter_output_dns_failed",
  "openrouter_output_dns_rebinding_refused",
  "fetch_failed",
  "network_error",
  "seedance_checkpoint_failed",
  "hero_reel_queue_unavailable",
]);
const TRANSIENT_SOURCE_ERRORS = new Set([
  "source_image_download_unavailable",
  "source_image_download_timeout",
  "source_image_dns_unavailable",
  "seedance_source_publish_unavailable",
  "source_asset_storage_unavailable",
  "seedance_source_public_read_unavailable",
  "seedance_source_public_read_mismatch",
  "source_visual_preflight_unavailable",
  "openrouter_download_failed",
  "openrouter_download_timeout",
  "openrouter_output_dns_failed",
  "openrouter_output_dns_rebinding_refused",
]);
const PERMANENT_SOURCE_ERRORS = new Set([
  "source_image_size_invalid",
  "source_sha256_mismatch",
  "source_image_type_invalid",
  "source_image_dimensions_invalid",
  "source_image_dimensions_mismatch",
  "source_image_aspect_invalid",
  "source_image_hero_aspect_invalid",
  "source_image_content_type_invalid",
  "source_image_content_type_mismatch",
  "source_image_url_refused",
  "source_visual_frame_blank",
  "source_visual_logo_like",
]);
const SOURCE_IMAGE_MIME_BY_FORMAT = Object.freeze({
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
});
const MIN_SOURCE_IMAGE_EDGE = 300;
const MAX_SOURCE_IMAGE_EDGE = 6000;
const MIN_SOURCE_IMAGE_ASPECT = 0.4;
const MAX_SOURCE_IMAGE_ASPECT = 2.5;

function clean(value) { return String(value ?? "").trim(); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function enabled(value) { return !/^(0|false|off|no)$/i.test(clean(value)); }

function normalizedContentType(value) {
  return clean(Array.isArray(value) ? value[0] : value).split(";", 1)[0].trim().toLowerCase();
}

function responseContentType(headers) {
  if (headers && typeof headers.get === "function") {
    return normalizedContentType(headers.get("content-type"));
  }
  return normalizedContentType(headers?.["content-type"] ?? headers?.["Content-Type"]);
}

function runClipTranscode(execFileImpl, bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFileImpl(bin, args, {
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
        windowsHide: true,
      }, (error, _stdout, stderr) => {
        if (!error) return resolve({ ok: true });
        const missing = error.code === "ENOENT";
        const timedOut = error.killed === true || error.signal === "SIGTERM" || error.code === "ETIMEDOUT";
        return resolve({
          ok: false,
          reason: missing
            ? "seedance_clip_transcode_unavailable"
            : timedOut
              ? "seedance_clip_transcode_timeout"
              : "seedance_clip_transcode_failed",
          detail: clean(stderr).split(/\r?\n/).filter(Boolean).slice(-2).join(" | ").slice(0, 240),
        });
      });
    } catch {
      return resolve({ ok: false, reason: "seedance_clip_transcode_unavailable" });
    }
    child?.once?.("error", () => {});
  });
}

async function compressProviderClip(sourceBytes, options = {}) {
  const bytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes || []);
  const source = validateHeroClip(bytes, {
    maxBytes: MAX_PROVIDER_CLIP_BYTES,
    minAspect: 0.5,
    maxAspect: 4.0,
  });
  if (!source.ok) {
    return {
      ok: false,
      reason: source.reason === "clip_too_large"
        ? "openrouter_clip_size_invalid"
        : `seedance_provider_${source.reason}`,
    };
  }
  const durationSeconds = Number(options.durationSeconds);
  if (!isSeedanceDuration(durationSeconds) || Math.abs(source.durationSec - durationSeconds) > 0.15) {
    return { ok: false, reason: "seedance_duration_mismatch" };
  }

  const fsPromises = options.fsPromises || fs.promises;
  const tmpBase = path.resolve(options.tempRoot || os.tmpdir());
  let workDir = "";
  try {
    await fsPromises.mkdir(tmpBase, { recursive: true });
    workDir = await fsPromises.mkdtemp(path.join(tmpBase, "wss-seedance-compress-"));
    const inputPath = path.join(workDir, "provider.mp4");
    const outputPath = path.join(workDir, "hero.mp4");
    await fsPromises.writeFile(inputPath, bytes);

    // 3 Mbps leaves room below 4 MiB for an eight-second clip. Scaling is
    // shrink-only and aspect-preserving; no loop, trim, or timeline filter runs.
    const bitrateKbps = 3000;
    const result = await runClipTranscode(
      options.execFileImpl || execFile,
      clean(options.ffmpegBin) || "ffmpeg",
      [
        "-y", "-v", "error", "-i", inputPath,
        "-map", "0:v:0",
        "-vf", "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v", "libx264", "-preset", "medium",
        "-b:v", `${bitrateKbps}k`, "-maxrate", `${bitrateKbps}k`, "-bufsize", `${bitrateKbps * 2}k`,
        "-pix_fmt", "yuv420p", "-an", "-map_metadata", "-1",
        "-movflags", "+faststart", outputPath,
      ],
      Number(options.timeoutMs) || DEFAULT_TRANSCODE_TIMEOUT_MS,
    );
    if (!result.ok) return result;

    const outputBytes = await fsPromises.readFile(outputPath).catch(() => null);
    if (!Buffer.isBuffer(outputBytes) || outputBytes.length === 0) {
      return { ok: false, reason: "seedance_clip_transcode_empty" };
    }
    const output = validateHeroClip(outputBytes, {
      forbidAudio: true,
      minAspect: 0.5,
      maxAspect: 4.0,
    });
    if (!output.ok) return { ok: false, reason: `seedance_transcode_${output.reason}` };
    if (Math.abs(output.durationSec - durationSeconds) > 0.15) {
      return { ok: false, reason: "seedance_transcode_duration_mismatch" };
    }
    const sourceAspect = source.width / source.height;
    const outputAspect = output.width / output.height;
    if (Math.abs(sourceAspect - outputAspect) / sourceAspect > 0.01) {
      return { ok: false, reason: "seedance_transcode_aspect_mismatch" };
    }
    return { ok: true, bytes: outputBytes, clip: output, sourceClip: source };
  } catch {
    return { ok: false, reason: "seedance_clip_transcode_failed" };
  } finally {
    if (workDir) await fsPromises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function rawSourceNetworkFailure(error) {
  const code = clean(error?.code).toUpperCase();
  if ([
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETDOWN",
    "ENETUNREACH", "EHOSTDOWN", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  ].includes(code)) return true;
  return /^(?:fetch failed|network error|socket hang up|timed out|timeout)$/i
    .test(clean(error?.message));
}

function sourceHttpStatus(reason) {
  const matched = /^source_image_http_(\d{3})$/.exec(clean(reason));
  return matched ? Number(matched[1]) : 0;
}

function permanentSourceFailure(reason) {
  if (PERMANENT_SOURCE_ERRORS.has(clean(reason))) return true;
  const status = sourceHttpStatus(reason);
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}

function transientSourceFailure(reason) {
  if (TRANSIENT_SOURCE_ERRORS.has(clean(reason))) return true;
  const status = sourceHttpStatus(reason);
  return [408, 425, 429].includes(status) || status >= 500;
}

function sanitizedOpenRouterFailure(raw) {
  const status = Number(raw?.http_status);
  if (!Number.isInteger(status) || status < 100 || status > 599) return null;
  const failure = {
    schema_version: OPENROUTER_FAILURE_SCHEMA,
    provider: "openrouter",
    operation: clean(raw?.operation) === "video_poll" ? "video_poll" : "video_submit",
    http_status: status,
  };
  const type = clean(raw?.error_type).toLowerCase();
  if (OPENROUTER_FAILURE_TYPES.has(type)) failure.error_type = type;
  const parameter = clean(raw?.parameter).toLowerCase();
  if (OPENROUTER_FAILURE_PARAMETERS.has(parameter)) failure.parameter = parameter;
  return failure;
}

function openRouterFailureParameter(body) {
  const message = clean(body?.error?.message).toLowerCase();
  if (!message) return "";
  for (const [parameter, pattern] of [
    ["frame_images", /frame[_ -]?images?|first[_ -]?frame|input image/],
    ["image_url", /image[_ -]?url|data[_ -]?url|base64|image url/],
    ["aspect_ratio", /aspect[_ -]?ratio|aspect ratio/],
    ["generate_audio", /generate[_ -]?audio|audio/],
    ["resolution", /resolution/],
    ["duration", /duration/],
    ["model", /model/],
    ["prompt", /prompt/],
    ["request_body", /request body|payload|body/],
  ]) if (pattern.test(message)) return parameter;
  return "";
}

function openRouterSubmitError(status, body) {
  const error = new Error([401, 403].includes(Number(status))
    ? "openrouter_unauthorized"
    : "openrouter_submit_failed");
  const providerFailure = sanitizedOpenRouterFailure({
    http_status: status,
    error_type: body?.error?.metadata?.error_type,
    parameter: openRouterFailureParameter(body),
  });
  if (providerFailure) error.providerFailure = providerFailure;
  return error;
}

function openRouterPollError(status, body = {}) {
  const code = Number(status);
  const message = clean(body?.error?.message || body?.message).toLowerCase();
  const metadataType = clean(body?.error?.metadata?.error_type).toLowerCase();
  const unauthorized = [401, 403].includes(code)
    || /auth|unauthori[sz]ed|forbidden|invalid[_ -]?(?:api[_ -]?)?key/.test(`${metadataType} ${message}`);
  const notFound = code === 404
    || /not[_ -]?found|unknown[_ -]?(?:job|generation)|does not exist/.test(`${metadataType} ${message}`);
  const error = new Error(unauthorized
    ? "openrouter_poll_unauthorized"
    : notFound
      ? "openrouter_poll_not_found"
      : code >= 400
        ? "openrouter_poll_failed"
        : "openrouter_generation_failed");
  const providerFailure = sanitizedOpenRouterFailure({
    operation: "video_poll",
    http_status: Number.isInteger(code) && code >= 100 ? code : 500,
    error_type: unauthorized ? "authentication" : notFound ? "not_found" : metadataType,
  });
  if (providerFailure) error.providerFailure = providerFailure;
  return error;
}

function httpsUrl(value, base) {
  try {
    const parsed = base ? new URL(clean(value), base) : new URL(clean(value));
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch { return ""; }
}

function openRouterUrl(value) {
  const url = httpsUrl(value, OPENROUTER_ORIGIN);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.origin === OPENROUTER_ORIGIN
      && !parsed.username
      && !parsed.password
      && (!parsed.port || parsed.port === "443")
      && parsed.pathname.startsWith("/api/v1/videos/")
      ? parsed.toString()
      : "";
  } catch { return ""; }
}

function requestSignal(timeoutMs) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

function timedFetch(config, url, options = {}, timeoutMs = config.requestTimeoutMs) {
  return config.fetchImpl(url, { ...options, signal: requestSignal(timeoutMs) });
}

const NON_PUBLIC_V4 = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) NON_PUBLIC_V4.addSubnet(address, prefix, "ipv4");

const NON_PUBLIC_V6 = new net.BlockList();
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001:2::", 48], ["2001:db8::", 32], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8],
]) NON_PUBLIC_V6.addSubnet(address, prefix, "ipv6");

function isPublicAddress(value) {
  const address = clean(value).toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = net.isIP(address);
  if (family === 4) return !NON_PUBLIC_V4.check(address, "ipv4");
  // Restrict video downloads to today's global-unicast IPv6 allocation.
  if (family === 6) return /^[23]/.test(address) && !NON_PUBLIC_V6.check(address, "ipv6");
  return false;
}

function refusedOutputHostname(value) {
  const host = clean(value).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return !host || host === "localhost" || host.endsWith(".localhost")
    || host.endsWith(".local") || host.endsWith(".internal");
}

async function validatePublicOutputUrl(value, lookupImpl = dns.lookup) {
  let parsed;
  try { parsed = new URL(clean(value)); } catch { throw new Error("openrouter_output_url_refused"); }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
    || refusedOutputHostname(parsed.hostname)
  ) throw new Error("openrouter_output_url_refused");
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error("openrouter_output_url_refused");
    return { url: parsed, addresses: [hostname] };
  }
  let resolved;
  try { resolved = await lookupImpl(hostname, { all: true, verbatim: true }); }
  catch { throw new Error("openrouter_output_dns_failed"); }
  const addresses = (Array.isArray(resolved) ? resolved : [resolved])
    .map((item) => clean(item?.address || item));
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("openrouter_output_url_refused");
  }
  return { url: parsed, addresses };
}

function canonicalAddress(value) {
  const address = clean(value).toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  return mapped ? mapped[1] : address;
}

function pinnedLookup(addresses) {
  const allowed = addresses.map((address) => ({ address, family: net.isIP(address) }))
    .filter((item) => item.family);
  return (_hostname, options, callback) => {
    const family = Number(options?.family) || 0;
    const selected = allowed.find((item) => !family || item.family === family) || allowed[0];
    if (!selected) return callback(new Error("openrouter_output_dns_failed"));
    return callback(null, selected.address, selected.family);
  };
}

function remoteAddressAllowed(remoteAddress, addresses) {
  const actual = canonicalAddress(remoteAddress);
  return Boolean(actual) && addresses.some((address) => canonicalAddress(address) === actual)
    && isPublicAddress(actual);
}

function readBoundedNodeBody(stream, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(bytes);
    };
    const onAbort = () => {
      const error = new Error("openrouter_download_timeout");
      stream.destroy(error);
      finish(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    stream.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const error = new Error("openrouter_clip_size_invalid");
        stream.destroy(error);
        finish(error);
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.once("end", () => finish(null, Buffer.concat(chunks, total)));
    stream.once("error", (error) => finish(error));
  });
}

function pinnedOutputRequest(parsed, addresses, options = {}) {
  const signal = options.signal;
  const httpsImpl = options.httpsImpl || https;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(response);
    };
    const request = httpsImpl.request(parsed, {
      method: "GET",
      agent: false,
      autoSelectFamily: false,
      lookup: pinnedLookup(addresses),
      signal,
      headers: options.headers || {},
    }, (response) => {
      if (!remoteAddressAllowed(response?.socket?.remoteAddress, addresses)) {
        response?.destroy?.();
        finish(new Error("openrouter_output_dns_rebinding_refused"));
        return;
      }
      finish(null, response);
    });
    request.once("socket", (socket) => {
      socket.once("secureConnect", () => {
        if (!remoteAddressAllowed(socket.remoteAddress, addresses)) {
          request.destroy(new Error("openrouter_output_dns_rebinding_refused"));
        }
      });
    });
    request.once("error", (error) => finish(error));
    request.end();
  });
}

async function downloadPublicOutput(value, options = {}) {
  const timeoutSignal = requestSignal(options.timeoutMs || 120_000);
  const signal = options.signal && typeof AbortSignal.any === "function"
    ? AbortSignal.any([options.signal, timeoutSignal])
    : (options.signal || timeoutSignal);
  let current = value;
  const requiredHost = clean(options.requiredHost).toLowerCase();
  for (let hop = 0; hop <= MAX_OUTPUT_REDIRECTS; hop += 1) {
    const validated = await validatePublicOutputUrl(current, options.lookupImpl || dns.lookup);
    if (requiredHost && validated.url.hostname.toLowerCase() !== requiredHost) {
      throw new Error("public_download_owner_redirect_refused");
    }
    const response = await pinnedOutputRequest(validated.url, validated.addresses, {
      signal,
      httpsImpl: options.httpsImpl,
      headers: {
        ...(options.requestHeaders && typeof options.requestHeaders === "object" ? options.requestHeaders : {}),
        ...(openRouterUrl(validated.url.toString()) && options.openrouterApiKey
          ? { authorization: `Bearer ${options.openrouterApiKey}` }
          : {}),
      },
    });
    const status = Number(response.statusCode) || 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      response.resume?.();
      if (hop === MAX_OUTPUT_REDIRECTS) throw new Error("openrouter_output_redirect_limit");
      const location = Array.isArray(response.headers?.location)
        ? response.headers.location[0]
        : clean(response.headers?.location);
      if (!location) throw new Error("openrouter_output_redirect_invalid");
      current = new URL(location, validated.url).toString();
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume?.();
      const error = new Error("openrouter_download_failed");
      error.httpStatus = status;
      throw error;
    }
    const bytes = await readBoundedNodeBody(response, signal, options.maxBytes || MAX_CLIP_BYTES);
    return options.includeResponseMetadata
      ? { bytes, contentType: responseContentType(response.headers) }
      : bytes;
  }
  throw new Error("openrouter_output_redirect_limit");
}

function safeJobPart(value) {
  return clean(value).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 180);
}

function normalizeJob(raw = {}) {
  const bank = raw.photo_bank && typeof raw.photo_bank === "object" ? raw.photo_bank : {};
  return {
    raw,
    jobId: clean(raw.job_id || raw.jobId),
    prospectId: clean(raw.prospect_id || raw.prospectId),
    leaseToken: clean(raw.lease_token || raw.leaseToken),
    producer: clean(raw.producer),
    sourceUrl: httpsUrl(raw.source_url || raw.sourceUrl),
    businessName: clean(raw.business_name || raw.businessName),
    vertical: clean(raw.vertical || raw.industry || raw.category),
    generationRevision: Number(raw.generation_revision || 1),
    durationSeconds: Number(raw.duration_seconds || SEEDANCE_DURATION_SEC),
    modelId: clean(raw.openrouter_model || raw.model) || SEEDANCE_MODEL_ID,
    photos: Array.isArray(bank.photos) ? bank.photos : [],
    approval: raw.approved_clip && typeof raw.approved_clip === "object" ? raw.approved_clip : null,
    approvedArtifact: raw.approved_artifact && typeof raw.approved_artifact === "object" ? raw.approved_artifact : null,
    providerCheckpoint: raw.provider_checkpoint && typeof raw.provider_checkpoint === "object"
      ? raw.provider_checkpoint
      : null,
    attempts: Math.max(0, Number(raw.attempts) || 0),
    createdAt: raw.created_at || raw.createdAt || null,
    leaseOwner: clean(raw.worker_id || raw.workerId || raw.lease_owner || raw.leaseOwner),
    capabilityPhase: clean(raw.capability_phase || raw.capabilityPhase),
    lineHandle: raw.line_handle && typeof raw.line_handle === "object"
      ? {
        batchId: clean(raw.line_handle.batchId || raw.line_handle.batch_id),
        rowId: clean(raw.line_handle.rowId || raw.line_handle.row_id),
      }
      : null,
  };
}

const ACTIVE_PARENT_LINE_ROW_STATUSES = new Set(["picked", "qualified", "mirrored", "gate_passed"]);

function parentLineRowBinding(batch, job) {
  const handle = job?.lineHandle || job?.line_handle || job?.payload?.line_handle;
  const rowId = clean(handle?.rowId || handle?.row_id);
  const batchId = clean(handle?.batchId || handle?.batch_id);
  if (!batchId || !rowId || !batch || !Array.isArray(batch.rows)) return "stale";
  const row = batch.rows.find((candidate) => clean(candidate?.rowId || candidate?.row_id) === rowId);
  const prospectId = clean(job?.prospectId || job?.prospect_id);
  if (!row || clean(row.prospectId || row.prospect_id) !== prospectId) return "stale";
  const status = clean(row.status).toLowerCase();
  const active = ACTIVE_PARENT_LINE_ROW_STATUSES.has(status)
    || (status === "ready" && row?.gate?.pass !== true);
  if (!active) return "stale";
  // Picked and newly-qualified rows are the two expected crash windows. Their
  // leased job is immediately requeued until the exact bound row CAS appears.
  if (status === "picked") return "pending";
  const marker = row.heroRemaster && typeof row.heroRemaster === "object"
    ? row.heroRemaster
    : row.hero_remaster && typeof row.hero_remaster === "object"
      ? row.hero_remaster
      : null;
  const currentJobId = clean(marker?.jobId || marker?.job_id);
  const currentAttemptId = clean(marker?.attemptId || marker?.attempt_id || marker?.hero_attempt_id);
  const jobId = clean(job?.jobId || job?.job_id);
  const expectedAttemptId = `hero_attempt:${Number(job?.generationRevision || job?.generation_revision)}`;
  if (marker?.applied === true || (currentJobId && currentJobId !== jobId)
    || (currentAttemptId && currentAttemptId !== expectedAttemptId)) return "stale";

  const base = heroBudget.validate(row.heroStartCheckpoint, { batchId, rowId, prospectId });
  if (!base.ok) {
    // No marker is the normal enqueue->row-CAS window. A malformed/mismatched
    // marker was already durable and belongs to a different generation.
    return row.heroStartCheckpoint ? "stale" : "pending";
  }
  if (!base.bound) return "pending";
  const exact = heroBudget.validate(row.heroStartCheckpoint, {
    batchId,
    rowId,
    prospectId,
    jobId,
    generationRevision: Number(job?.generationRevision || job?.generation_revision),
    disposition: "job_bound",
  });
  return row.heroStartCheckpointed === true
    && currentJobId === jobId
    && currentAttemptId === expectedAttemptId
    && exact.ok
    ? "current"
    : "stale";
}

function acceptedCheckpointBudget(config, job, checkpoint) {
  if (!checkpoint || checkpoint.submission_state !== "accepted") return { ok: true };
  const claimCap = Math.max(1, Number(config.acceptedClaimCap) || DEFAULT_ACCEPTED_CLAIM_CAP);
  if (Math.max(0, Number(job?.attempts) || 0) > claimCap) {
    return { ok: false, reason: "openrouter_accepted_claims_exhausted" };
  }
  const anchor = Date.parse(String(checkpoint.submitted_at || checkpoint.created_at || job?.createdAt || ""));
  const nowMs = typeof config.nowMs === "function" ? Number(config.nowMs()) : Date.now();
  const maxAgeMs = Math.max(60_000, Number(config.acceptedMaxAgeMs) || DEFAULT_ACCEPTED_MAX_AGE_MS);
  if (!Number.isFinite(anchor) || !Number.isFinite(nowMs) || nowMs - anchor >= maxAgeMs) {
    return { ok: false, reason: "openrouter_accepted_checkpoint_expired" };
  }
  return { ok: true };
}

function imageMime(bytes) {
  const value = Buffer.from(bytes || []);
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return "image/jpeg";
  if (value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (value.length >= 12 && value.toString("ascii", 0, 4) === "RIFF" && value.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (value.length >= 6 && ["GIF87a", "GIF89a"].includes(value.toString("ascii", 0, 6))) return "image/gif";
  if (value.length >= 12 && value.toString("ascii", 4, 8) === "ftyp" && /^(?:avif|avis)$/.test(value.toString("ascii", 8, 12))) return "image/avif";
  return "";
}

function admitSourceImage(bytes, contentType, photo, url = "") {
  const value = Buffer.from(bytes || []);
  if (!value.length || value.length > MAX_PROXY_SOURCE_IMAGE_BYTES) throw new Error("source_image_size_invalid");
  if (sha256(value) !== clean(photo.sha256).toLowerCase()) throw new Error("source_sha256_mismatch");
  const mime = imageMime(value);
  const dimensions = imageDimensions(value);
  const measuredMime = SOURCE_IMAGE_MIME_BY_FORMAT[clean(dimensions?.format).toLowerCase()] || "";
  if (!mime || !measuredMime || mime !== measuredMime) throw new Error("source_image_type_invalid");
  const publicContentType = normalizedContentType(contentType);
  if (!publicContentType || !Object.values(SOURCE_IMAGE_MIME_BY_FORMAT).includes(publicContentType)) {
    throw new Error("source_image_content_type_invalid");
  }
  if (publicContentType !== mime) throw new Error("source_image_content_type_mismatch");
  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < MIN_SOURCE_IMAGE_EDGE
    || width > MAX_SOURCE_IMAGE_EDGE
    || height < MIN_SOURCE_IMAGE_EDGE
    || height > MAX_SOURCE_IMAGE_EDGE
  ) throw new Error("source_image_dimensions_invalid");
  const aspect = width / height;
  if (aspect < MIN_SOURCE_IMAGE_ASPECT || aspect > MAX_SOURCE_IMAGE_ASPECT) {
    throw new Error("source_image_aspect_invalid");
  }
  if (width !== Number(photo.width) || height !== Number(photo.height)) {
    throw new Error("source_image_dimensions_mismatch");
  }
  return {
    bytes: value,
    mime,
    contentType: publicContentType,
    width,
    height,
    url: httpsUrl(url || photo.url),
  };
}

async function downloadVerifiedSourceImage(config, photo, sourceUrl) {
  const downloader = config.sourceDownloadImpl || downloadPublicOutput;
  let bytes;
  let contentType = "";
  try {
    const downloaded = await downloader(httpsUrl(sourceUrl), {
      timeoutMs: config.sourceTimeoutMs,
      maxBytes: MAX_PROXY_SOURCE_IMAGE_BYTES,
      lookupImpl: config.lookupImpl,
      httpsImpl: config.httpsImpl,
      includeResponseMetadata: true,
    });
    const payload = downloaded && typeof downloaded === "object"
      && !Buffer.isBuffer(downloaded)
      && !ArrayBuffer.isView(downloaded)
      && !(downloaded instanceof ArrayBuffer)
      ? downloaded.bytes
      : downloaded;
    bytes = Buffer.from(payload || []);
    contentType = normalizedContentType(downloaded?.contentType || downloaded?.content_type);
  } catch (error) {
    const status = Number(error?.httpStatus);
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      throw new Error(`source_image_http_${status}`);
    }
    if (clean(error?.message) === "openrouter_clip_size_invalid") {
      throw new Error("source_image_size_invalid");
    }
    if (rawSourceNetworkFailure(error)) throw new Error("source_image_download_unavailable");
    if (clean(error?.message) === "openrouter_download_timeout") {
      throw new Error("source_image_download_timeout");
    }
    if (clean(error?.message) === "openrouter_output_dns_failed") {
      throw new Error("source_image_dns_unavailable");
    }
    if ([
      "openrouter_download_failed",
    ].includes(clean(error?.message))) {
      throw new Error("source_image_download_unavailable");
    }
    if ([
      "openrouter_output_url_refused",
      "openrouter_output_dns_rebinding_refused",
      "openrouter_output_redirect_limit",
      "openrouter_output_redirect_invalid",
      "public_download_owner_redirect_refused",
    ].includes(clean(error?.message))) {
      throw new Error("source_image_url_refused");
    }
    throw error;
  }
  return admitSourceImage(bytes, contentType, photo, sourceUrl);
}

function immutableClientAssetUrls(config, photo) {
  const digest = clean(photo?.sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) return [];
  const declaredExt = extFromUrl(photo?.url);
  const declaredMimeExt = imageExt(photo?.content_type || photo?.contentType || photo?.mime);
  const extensions = [...new Set([declaredExt, declaredMimeExt, "jpg", "png", "webp", "gif", "avif"].filter(Boolean))];
  const env = config.storageEnv || {};
  const configuredBase = clean(env.WSS_CLIENT_ASSETS_BASE_URL).replace(/\/+$/, "");
  const supabaseBase = clean(env.SUPABASE_URL || env.CALLPREP_SUPABASE_URL).replace(/\/+$/, "");
  const derivedBase = supabaseBase
    ? `${supabaseBase}/storage/v1/object/public/${CLIENT_ASSETS_BUCKET}`
    : "";
  const bases = [...new Set([configuredBase, derivedBase].filter(Boolean))];
  const urls = [];
  for (const ext of extensions) {
    const key = assetKeyForSha256(digest, { prefix: CLIENT_ASSETS_PREFIX, ext });
    const candidates = [
      typeof config.sourceAssetStore?.publicUrl === "function" ? config.sourceAssetStore.publicUrl(key) : "",
      ...bases.map((base) => `${base}/${key}`),
    ];
    for (const candidate of candidates) {
      const exact = httpsUrl(candidate);
      if (!exact || urls.includes(exact)) continue;
      try {
        const parsed = new URL(exact);
        if (parsed.search || parsed.hash || !parsed.pathname.endsWith(`/${key}`)) continue;
      } catch { continue; }
      urls.push(exact);
    }
  }
  return urls;
}

async function verifiedSourceImage(config, photo) {
  try {
    return await downloadVerifiedSourceImage(config, photo, photo.url);
  } catch (originalError) {
    if (clean(originalError?.message) !== "source_sha256_mismatch") throw originalError;
    for (const immutableUrl of immutableClientAssetUrls(config, photo)) {
      if (immutableUrl === httpsUrl(photo.url)) continue;
      try {
        return await downloadVerifiedSourceImage(config, photo, immutableUrl);
      } catch { /* only exact SHA-admitted bytes can rescue a mutable original URL */ }
    }
    throw originalError;
  }
}

function sourceFrameQuality(rgb) {
  const value = Buffer.from(rgb || []);
  const expectedBytes = 64 * 64 * 3;
  if (value.length !== expectedBytes) return { ok: false, reason: "source_visual_preflight_unavailable" };
  const stats = visualFrameStats(value);
  if (stats.stddev < 4 || stats.mean < 4 || stats.mean > 251) {
    return { ok: false, reason: "source_visual_frame_blank", mean: stats.mean, stddev: stats.stddev };
  }
  const detailMap = visualLocalVarianceMap(stats.luma);
  const detailCoverage = [...detailMap].filter((variance) => variance >= 9).length / detailMap.length;
  const colors = new Map();
  let dominant = 0;
  for (let index = 0; index < value.length; index += 3) {
    const key = `${value[index] >> 4}:${value[index + 1] >> 4}:${value[index + 2] >> 4}`;
    const count = (colors.get(key) || 0) + 1;
    colors.set(key, count);
    dominant = Math.max(dominant, count);
  }
  const dominantFraction = dominant / (value.length / 3);
  if (dominantFraction >= 0.86 && detailCoverage < 0.12) {
    return {
      ok: false,
      reason: "source_visual_logo_like",
      mean: stats.mean,
      stddev: stats.stddev,
      dominantFraction,
      detailCoverage,
    };
  }
  return {
    ok: true,
    mean: stats.mean,
    stddev: stats.stddev,
    dominantFraction,
    detailCoverage,
  };
}

async function defaultSourceVisualPreflight({ config, source }) {
  const fsPromises = config.fsPromises || fs.promises;
  const tempRoot = path.resolve(config.sourcePreflightTempRoot || os.tmpdir());
  const tempDir = await fsPromises.mkdtemp(path.join(tempRoot, "wss-seedance-source-"));
  try {
    const ext = imageExt(source?.mime);
    if (!ext) return { ok: false, reason: "source_visual_preflight_unavailable" };
    const sourcePath = path.join(tempDir, `source.${ext}`);
    await fsPromises.writeFile(sourcePath, source.bytes, { flag: "wx", mode: 0o600 });
    const decode = config.sourceDecodeImpl || decodeVisualSourceRgb;
    const rgb = await decode(sourcePath, {
      ffmpegExecutable: config.ffmpegBin,
      ...(config.sourceExecFileImpl ? { execFileImpl: config.sourceExecFileImpl } : {}),
    });
    return sourceFrameQuality(rgb);
  } catch (error) {
    if (["source_visual_frame_blank", "source_visual_logo_like"].includes(clean(error?.message))) throw error;
    throw new Error("source_visual_preflight_unavailable");
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

async function preflightSourceVisual(config, photo, source) {
  if (photo?.logo_like === true || photo?.logoLike === true) {
    throw new Error("source_visual_logo_like");
  }
  const inspect = config.sourceVisualPreflightImpl || defaultSourceVisualPreflight;
  const verdict = await inspect({ config, photo, source });
  if (verdict?.ok === true) return verdict;
  const reason = clean(verdict?.reason);
  if (["source_visual_frame_blank", "source_visual_logo_like"].includes(reason)) throw new Error(reason);
  throw new Error("source_visual_preflight_unavailable");
}

function preflightSourceHeroShape(source) {
  const width = Number(source?.width);
  const height = Number(source?.height);
  const aspect = width / height;
  if (!Number.isFinite(aspect) || aspect < HERO_MIN_ASPECT || aspect > HERO_MAX_ASPECT) {
    throw new Error("source_image_hero_aspect_invalid");
  }
  return { ok: true, width, height, aspect };
}

function imageExt(mime) {
  return ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  })[clean(mime).toLowerCase()] || "";
}

function reviewSourcePath(reviewDir, job, sourceSha256, mime) {
  const digest = clean(sourceSha256).toLowerCase();
  const ext = imageExt(mime);
  if (!/^[a-f0-9]{64}$/.test(digest) || !ext) throw new Error("review_source_identity_invalid");
  return path.join(reviewJobDir(reviewDir, job), `${digest}.${ext}`);
}

async function verifyReviewSourcePath(reviewDir, sourcePath, sourceSha256, fsPromises = fs.promises) {
  const digest = clean(sourceSha256).toLowerCase();
  const candidate = path.resolve(clean(sourcePath));
  if (!/^[a-f0-9]{64}$/.test(digest) || !clean(sourcePath)) throw new Error("review_source_identity_invalid");
  const realRoot = await fsPromises.realpath(path.resolve(reviewDir)).catch(() => "");
  const stat = await fsPromises.lstat(candidate);
  const realSource = await fsPromises.realpath(candidate).catch(() => "");
  const relative = realRoot && realSource ? path.relative(realRoot, realSource) : "";
  if (
    !realRoot || !stat?.isFile() || stat.isSymbolicLink() || !realSource
    || !relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || !new RegExp(`^${digest}\\.(?:jpg|png|webp|gif|avif)$`, "i").test(path.basename(realSource))
    || stat.size < 1 || stat.size > MAX_PROXY_SOURCE_IMAGE_BYTES
  ) throw new Error("review_source_path_refused");
  const bytes = await fsPromises.readFile(realSource);
  if (sha256(bytes) !== digest) throw new Error("review_source_sha256_mismatch");
  return realSource;
}

async function persistReviewSource(reviewDir, job, source, sourceSha256, fsPromises = fs.promises) {
  const bytes = Buffer.from(source?.bytes || []);
  const digest = clean(sourceSha256).toLowerCase();
  if (!bytes.length || bytes.length > MAX_PROXY_SOURCE_IMAGE_BYTES || sha256(bytes) !== digest) {
    throw new Error("review_source_sha256_mismatch");
  }
  const jobDir = reviewJobDir(reviewDir, job);
  await fsPromises.mkdir(jobDir, { recursive: true });
  const sourcePath = reviewSourcePath(reviewDir, job, digest, source?.mime);
  await fsPromises.writeFile(sourcePath, bytes, { flag: "wx", mode: 0o600 }).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;
    await verifyReviewSourcePath(reviewDir, sourcePath, digest, fsPromises).catch(() => {
      throw new Error("review_source_collision");
    });
  });
  return verifyReviewSourcePath(reviewDir, sourcePath, digest, fsPromises);
}

async function publishSourceThroughBackend(config, job, source, photo) {
  if (!job?.jobId || !job?.leaseToken || !job?.prospectId) {
    throw new Error("seedance_source_lease_required");
  }
  if (!source?.bytes?.length || source.bytes.length > MAX_PROXY_SOURCE_IMAGE_BYTES) {
    throw new Error("seedance_source_proxy_size_invalid");
  }
  let response;
  try {
    response = await config.fetchImpl(`${config.apiBase}/api/admin/hero-source-asset`, {
      method: "POST",
      headers: {
        "content-type": source.mime,
        "x-ghost-hero-job-id": job.jobId,
        "x-ghost-hero-job-lease": job.leaseToken,
        "x-ghost-prospect-id": job.prospectId,
        "x-ghost-source-sha256": clean(photo.sha256).toLowerCase(),
      },
      body: source.bytes,
    });
  } catch {
    throw new Error("seedance_source_publish_unavailable");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    if (Number(response.status) >= 500) throw new Error("seedance_source_publish_unavailable");
    throw new Error(clean(body?.error) || `seedance_source_publish_${response.status}`);
  }
  return body;
}

async function immutableProviderSource(config, job, source, photo) {
  const store = config.sourceAssetStore || null;
  if (!store) {
    const saved = await publishSourceThroughBackend(config, job, source, photo);
    const expectedSha = clean(photo.sha256).toLowerCase();
    const publicUrl = httpsUrl(saved.url);
    const expectedKey = assetKeyForSha256(expectedSha, {
      prefix: CLIENT_ASSETS_PREFIX,
      ext: imageExt(source.mime),
    });
    let exactUrl = false;
    try { exactUrl = new URL(publicUrl).pathname.endsWith(`/${expectedKey}`); } catch { exactUrl = false; }
    if (!publicUrl || saved.key !== expectedKey || clean(saved.sha256).toLowerCase() !== expectedSha || !exactUrl) {
      throw new Error("seedance_source_publish_failed");
    }
    const downloader = config.publicSourceDownloadImpl || downloadPublicOutput;
    let readback;
    try {
      readback = Buffer.from(await downloader(publicUrl, {
        timeoutMs: config.sourceTimeoutMs,
        maxBytes: MAX_PROXY_SOURCE_IMAGE_BYTES,
        lookupImpl: config.lookupImpl,
        httpsImpl: config.httpsImpl,
      }));
    } catch (error) {
      if (rawSourceNetworkFailure(error)) throw new Error("seedance_source_public_read_unavailable");
      throw error;
    }
    if (readback.length !== source.bytes.length || sha256(readback) !== expectedSha) {
      throw new Error("seedance_source_public_read_mismatch");
    }
    return { ...source, url: publicUrl };
  }
  if (!store || typeof store.putContentAddressed !== "function") {
    throw new Error("seedance_source_store_unavailable");
  }
  const bucket = await store.ensureBucket();
  if (!bucket || bucket.ok !== true) throw new Error(bucket?.reason || "seedance_source_bucket_unavailable");
  const saved = await store.putContentAddressed(source.bytes, {
    sha256: clean(photo.sha256).toLowerCase(),
    ext: imageExt(source.mime),
    contentType: source.mime,
  });
  const publicUrl = saved?.ok === true ? httpsUrl(saved.publicUrl) : "";
  const expectedKey = assetKeyForSha256(clean(photo.sha256).toLowerCase(), {
    prefix: CLIENT_ASSETS_PREFIX,
    ext: imageExt(source.mime),
  });
  let exactUrl = false;
  try { exactUrl = new URL(publicUrl).pathname.endsWith(`/${expectedKey}`); } catch { exactUrl = false; }
  if (!publicUrl || saved.key !== expectedKey || !exactUrl) {
    throw new Error(saved?.reason || "seedance_source_publish_failed");
  }
  return { ...source, url: publicUrl };
}

const SOURCE_STORE_PROBE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function preflightImmutableSourceStore(config) {
  const digest = sha256(SOURCE_STORE_PROBE);
  const published = await immutableProviderSource(config, null, {
    bytes: SOURCE_STORE_PROBE,
    mime: "image/png",
    url: "",
  }, { sha256: digest });
  const publicFetch = config.publicSourceFetchImpl || globalThis.fetch;
  if (typeof publicFetch !== "function") throw new Error("seedance_source_public_fetch_unavailable");
  const response = await publicFetch(published.url, {
    method: "GET",
    redirect: "error",
    headers: { accept: "image/png" },
  });
  if (!response || response.ok !== true) {
    throw new Error(`seedance_source_public_read_${Number(response?.status) || 0}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== SOURCE_STORE_PROBE.length || sha256(bytes) !== digest) {
    throw new Error("seedance_source_public_read_mismatch");
  }
  return { ok: true, sha256: digest, url: published.url };
}

function ownedSceneCandidates(job, maxBytes = MAX_PROXY_SOURCE_IMAGE_BYTES) {
  return job.photos.filter((photo) => {
    const width = Number(photo?.width);
    const height = Number(photo?.height);
    const declaredBytes = Number(photo?.bytes || photo?.size_bytes || photo?.content_length);
    return SOURCE_TYPES.has(clean(photo?.source))
      && clean(photo?.asset_type) === "real_scene"
      && /^[a-f0-9]{64}$/i.test(clean(photo?.sha256))
      && Boolean(httpsUrl(photo?.url))
      && Number.isInteger(width) && width > 0 && width <= 20_000
      && Number.isInteger(height) && height > 0 && height <= 20_000
      && (!Number.isFinite(declaredBytes) || declaredBytes <= 0 || declaredBytes <= maxBytes);
  });
}

function selectOwnedScene(job) {
  const checkpointState = clean(job?.providerCheckpoint?.submission_state);
  const historicalResume = ["submitting", "accepted"].includes(checkpointState);
  const candidates = ownedSceneCandidates(
    job,
    historicalResume ? MAX_SOURCE_IMAGE_BYTES : MAX_PROXY_SOURCE_IMAGE_BYTES,
  );
  const checkpointSha = clean(job?.providerCheckpoint?.source_sha256).toLowerCase();
  return (checkpointSha
    ? candidates.find((photo) => clean(photo?.sha256).toLowerCase() === checkpointSha)
    : candidates[0]) || null;
}

async function selectVerifiedOwnedScene(config, job) {
  const candidates = ownedSceneCandidates(job, MAX_PROXY_SOURCE_IMAGE_BYTES);
  const checkpointPhoto = selectOwnedScene(job);
  const checkpointState = clean(job?.providerCheckpoint?.submission_state);
  if (["submitting", "accepted"].includes(checkpointState)) {
    return checkpointPhoto ? { photo: checkpointPhoto, source: null } : null;
  }
  if (job?.providerCheckpoint) {
    if (checkpointState !== "intent" || !checkpointPhoto) return null;
    try {
      const source = await verifiedSourceImage(config, checkpointPhoto);
      preflightSourceHeroShape(source);
      await preflightSourceVisual(config, checkpointPhoto, source);
      return { photo: checkpointPhoto, source };
    } catch (error) {
      const reason = clean(error?.message);
      if (!permanentSourceFailure(reason)) throw error;
      return { photo: null, source: null, terminalReason: reason };
    }
  }
  let terminalReason = "";
  for (const photo of candidates) {
    try {
      const source = await verifiedSourceImage(config, photo);
      preflightSourceHeroShape(source);
      await preflightSourceVisual(config, photo, source);
      return { photo, source };
    } catch (error) {
      const reason = clean(error?.message);
      if (!permanentSourceFailure(reason)) throw error;
      terminalReason = reason;
    }
  }
  return terminalReason ? { photo: null, source: null, terminalReason } : null;
}

function buildPrompt(job) {
  const vertical = clean(job.vertical).replace(/[_-]+/g, " ");
  const duration = isSeedanceDuration(job.durationSeconds) ? job.durationSeconds : SEEDANCE_DURATION_SEC;
  return [
    `Animate this real ${vertical || "local service"} photograph into a ${duration}-second professional website hero clip.`,
    "Use one ultra-realistic, slow stabilized aerial-style fly-in with subtle natural parallax, as if captured by a professional drone, but never show a drone or camera rig.",
    "Preserve the exact scene, geometry, faces, logo, signage, text, equipment, colors, and business identity.",
    "Add nothing and remove nothing. No audio, cuts, morphing, warping, duplicated objects, fake text, camera shake, or stylistic filters.",
    job.businessName ? `The real business is ${job.businessName}.` : "",
  ].filter(Boolean).join(" ");
}

function sourceDomain(job) {
  // Match the queue's frozen receipt contract exactly: hostname identity is
  // preserved (minus only a leading www), rather than collapsed to an apex.
  try {
    return new URL(job.sourceUrl).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch { return ""; }
}

function generationIdentity(job, photo) {
  return sha256(Buffer.from(stableSerialize({
    schema: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: job.jobId,
    prospect_id: job.prospectId,
    generation_revision: job.generationRevision,
    source_sha256: clean(photo.sha256).toLowerCase(),
    model_id: SEEDANCE_MODEL_ID,
    duration_seconds: job.durationSeconds,
  })));
}

function reviewJobDir(reviewDir, job) {
  return path.join(path.resolve(reviewDir), safeJobPart(job.jobId));
}

function providerCheckpointPath(reviewDir, job) {
  return path.join(
    reviewJobDir(reviewDir, job),
    `seedance-provider-checkpoint-r${Math.max(1, Number(job.generationRevision) || 1)}.json`,
  );
}

async function atomicJsonWrite(file, value, fsPromises = fs.promises) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try { await fsPromises.rename(tmp, file); }
  catch (error) {
    await fsPromises.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

function exactCheckpoint(job, photo, raw = {}) {
  const intentSha256 = generationIdentity(job, photo);
  const submissionState = clean(raw.submission_state);
  const providerJobId = safeJobPart(raw.provider_job_id);
  if (
    raw.schema_version !== "wss.hero.seedance_provider_checkpoint.v1"
    || raw.job_id !== job.jobId
    || raw.prospect_id !== job.prospectId
    || Number(raw.generation_revision) !== job.generationRevision
    || clean(raw.source_sha256).toLowerCase() !== clean(photo.sha256).toLowerCase()
    || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(clean(raw.source_mime).toLowerCase())
    || !Number.isInteger(Number(raw.source_bytes))
    || Number(raw.source_bytes) < 1
    || Number(raw.source_bytes) > MAX_SOURCE_IMAGE_BYTES
    || raw.model_id !== SEEDANCE_MODEL_ID
    || Number(raw.duration_seconds) !== job.durationSeconds
    || raw.intent_sha256 !== intentSha256
    || !["intent", "submitting", "accepted"].includes(submissionState)
    || (submissionState === "accepted" && (!raw.polling_url || !providerJobId))
    || (submissionState !== "accepted" && (raw.polling_url || providerJobId))
    || (raw.polling_url && !openRouterUrl(raw.polling_url))
  ) throw new Error("seedance_provider_checkpoint_mismatch");
  return {
    ...raw,
    submission_state: submissionState,
    intent_sha256: intentSha256,
    source_mime: clean(raw.source_mime).toLowerCase(),
    source_bytes: Number(raw.source_bytes),
    polling_url: openRouterUrl(raw.polling_url),
    ...(providerJobId ? { provider_job_id: providerJobId } : {}),
  };
}

async function ensureProviderCheckpoint(reviewDir, job, photo, fsPromises = fs.promises, source = {}) {
  const jobDir = reviewJobDir(reviewDir, job);
  const file = providerCheckpointPath(reviewDir, job);
  await fsPromises.mkdir(jobDir, { recursive: true });
  const existing = await readProviderCheckpoint(reviewDir, job, photo, fsPromises);
  if (existing) return existing;
  const checkpoint = exactCheckpoint(job, photo, {
    schema_version: "wss.hero.seedance_provider_checkpoint.v1",
    job_id: job.jobId,
    prospect_id: job.prospectId,
    generation_revision: job.generationRevision,
    source_sha256: clean(photo.sha256).toLowerCase(),
    source_mime: clean(source.mime),
    source_bytes: Number(source.bytes?.length || source.bytes || 0),
    model_id: SEEDANCE_MODEL_ID,
    duration_seconds: job.durationSeconds,
    intent_sha256: generationIdentity(job, photo),
    submission_state: "intent",
    polling_url: "",
    created_at: new Date().toISOString(),
  });
  await atomicJsonWrite(file, checkpoint, fsPromises);
  return checkpoint;
}

async function readProviderCheckpoint(reviewDir, job, photo, fsPromises = fs.promises) {
  try {
    const raw = JSON.parse(await fsPromises.readFile(providerCheckpointPath(reviewDir, job), "utf8"));
    return exactCheckpoint(job, photo, raw);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function markProviderSubmitting(reviewDir, job, photo, checkpoint, fsPromises = fs.promises) {
  if (checkpoint.submission_state !== "intent" || checkpoint.polling_url) {
    throw new Error("seedance_submit_reconciliation_required");
  }
  const next = exactCheckpoint(job, photo, {
    ...checkpoint,
    submission_state: "submitting",
    submit_started_at: new Date().toISOString(),
  });
  await atomicJsonWrite(providerCheckpointPath(reviewDir, job), next, fsPromises);
  return next;
}

async function saveProviderPollingUrl(
  reviewDir,
  job,
  photo,
  checkpoint,
  pollingUrl,
  providerJobId,
  fsPromises = fs.promises,
) {
  if (checkpoint.submission_state !== "submitting" || checkpoint.polling_url) {
    throw new Error("seedance_submit_reconciliation_required");
  }
  const next = exactCheckpoint(job, photo, {
    ...checkpoint,
    submission_state: "accepted",
    polling_url: pollingUrl,
    provider_job_id: safeJobPart(providerJobId),
    submitted_at: new Date().toISOString(),
  });
  await atomicJsonWrite(providerCheckpointPath(reviewDir, job), next, fsPromises);
  return next;
}

function generationReceipt(job, photo, clip, metrics) {
  return {
    schema_version: SEEDANCE_RECEIPT_SCHEMA,
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    prospect_id: job.prospectId,
    domain: sourceDomain(job),
    source_type: clean(photo.source),
    source_asset_type: "real_scene",
    source_sha256: clean(photo.sha256).toLowerCase(),
    raw_sha256: clean(photo.sha256).toLowerCase(),
    optimized_sha256: clean(photo.sha256).toLowerCase(),
    clip_sha256: clip.sha256,
    recipe_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    model_id: SEEDANCE_MODEL_ID,
    duration_seconds: clip.durationSec,
    generate_audio: false,
    wall_time_ms: metrics.wallTimeMs,
    generation_time_ms: metrics.generationTimeMs,
    cost_usd: metrics.costUsd,
  };
}

function reviewContract(job, photo, clip, metrics) {
  const rawSha = clean(photo.sha256).toLowerCase();
  const optimizedAsset = {
    sha256: rawSha,
    url_fingerprint: `direct-source:${rawSha}`,
    width: Number(photo.width),
    height: Number(photo.height),
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    image_preparation: "direct_client_photo",
  };
  const receipt = generationReceipt(job, photo, clip, metrics);
  const approvedArtifact = {
    raw_sha256: rawSha,
    source_url: httpsUrl(photo.url),
    clip_sha256: clip.sha256,
    optimized_sha256: rawSha,
    optimized_asset_fingerprint: optimizedAsset.url_fingerprint,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    image_preparation: "direct_client_photo",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    generation_receipt: receipt,
  };
  const candidate = {
    sha256: clip.sha256,
    // Queue settlement expects the byte COUNT. The MP4 bytes themselves stay
    // in the staged .mp4 file; serializing the Buffer here creates a 100MB+
    // JSON body that Vercel correctly rejects with 413.
    bytes: Buffer.isBuffer(clip.bytes) ? clip.bytes.length : Number(clip.bytes),
    durationSeconds: clip.durationSec,
    width: clip.width,
    height: clip.height,
    codec: clip.codec,
    approved_artifact: approvedArtifact,
  };
  return {
    ok: true,
    status: "awaiting_review",
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    source_sha256: rawSha,
    source_url: httpsUrl(photo.url),
    clip_sha256: clip.sha256,
    raw_sha256: rawSha,
    optimized_sha256: rawSha,
    optimized_asset_fingerprint: optimizedAsset.url_fingerprint,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    canonical_recipe_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    image_preparation: "direct_client_photo",
    optimized_width: optimizedAsset.width,
    optimized_height: optimizedAsset.height,
    optimized_asset: optimizedAsset,
    approved_artifact: approvedArtifact,
    generation_receipt: receipt,
    generation_revision: job.generationRevision,
    candidates: [candidate],
  };
}

async function persistReview(reviewDir, job, clipBytes, verdict, fsPromises = fs.promises, options = {}) {
  const jobDir = path.join(path.resolve(reviewDir), safeJobPart(job.jobId));
  await fsPromises.mkdir(jobDir, { recursive: true });
  const clipPath = path.join(jobDir, `${verdict.clip_sha256}.mp4`);
  const receiptPath = path.join(jobDir, `${verdict.clip_sha256}.json`);
  await fsPromises.writeFile(clipPath, clipBytes, { flag: "wx" }).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fsPromises.readFile(clipPath);
    if (sha256(existing) !== verdict.clip_sha256) throw new Error("review_clip_collision");
  });
  const receipt = {
    job_id: job.jobId,
    prospect_id: job.prospectId,
    source_sha256: verdict.source_sha256,
    source_url: verdict.source_url,
    ...(clean(options.sourcePath) ? { source_path: path.resolve(clean(options.sourcePath)) } : {}),
    clip_sha256: verdict.clip_sha256,
    approved_artifact: verdict.approved_artifact,
    optimized_asset: verdict.optimized_asset,
    clip_path: clipPath,
    bytes: verdict.candidates[0].bytes,
    duration_seconds: verdict.candidates[0].durationSeconds,
    width: verdict.candidates[0].width,
    height: verdict.candidates[0].height,
    codec: verdict.candidates[0].codec,
    candidates: verdict.candidates,
    status: "awaiting_review",
    captured_at: new Date().toISOString(),
    generation_revision: job.generationRevision,
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    generation_receipt: verdict.generation_receipt,
    verdict,
  };
  await fsPromises.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { clipPath, receiptPath, receipt };
}

async function readStagedReview(reviewDir, job, photo, fsPromises = fs.promises) {
  const jobDir = reviewJobDir(reviewDir, job);
  const names = await fsPromises.readdir(jobDir).catch(() => []);
  for (const name of names.filter((value) => /^[a-f0-9]{64}\.json$/i.test(value)).sort()) {
    try {
      const receipt = JSON.parse(await fsPromises.readFile(path.join(jobDir, name), "utf8"));
      if (
        receipt.status !== "awaiting_review"
        || receipt.job_id !== job.jobId
        || receipt.prospect_id !== job.prospectId
        || Number(receipt.generation_revision) !== job.generationRevision
        || clean(receipt.source_sha256).toLowerCase() !== clean(photo.sha256).toLowerCase()
        || httpsUrl(receipt.source_url) !== httpsUrl(photo.url)
        || !receipt.verdict
        || stableSerialize(receipt.verdict.approved_artifact) !== stableSerialize(receipt.approved_artifact)
      ) continue;
      if (clean(receipt.source_path)) {
        await verifyReviewSourcePath(reviewDir, receipt.source_path, receipt.source_sha256, fsPromises);
      }
      const clipPath = path.resolve(clean(receipt.clip_path));
      const relative = path.relative(jobDir, clipPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      const bytes = await fsPromises.readFile(clipPath);
      const clip = validateHeroClip(bytes, { forbidAudio: true, minAspect: 0.5, maxAspect: 4.0 });
      if (!clip.ok || clip.sha256 !== clean(receipt.clip_sha256).toLowerCase()) continue;
      // Compact legacy receipts that accidentally embedded the whole Buffer in
      // candidates[0].bytes. Replays send metadata only and reuse the verified
      // .mp4 file, so no generation is repeated.
      const verdict = {
        ...receipt.verdict,
        candidates: Array.isArray(receipt.verdict.candidates)
          ? receipt.verdict.candidates.map((candidate) => ({
            ...candidate,
            bytes: clean(candidate?.sha256).toLowerCase() === clip.sha256
              ? bytes.length
              : Number(candidate?.bytes),
          }))
          : receipt.verdict.candidates,
      };
      return { receipt: { ...receipt, bytes: bytes.length, candidates: verdict.candidates, verdict }, verdict, bytes, clip, clipPath };
    } catch { /* malformed or stale local evidence is never reused */ }
  }
  return null;
}

async function readApprovedReview(reviewDir, job, fsPromises = fs.promises) {
  const approvedSha = clean(job.approval?.sha256).toLowerCase();
  if (!job.approval?.approved || !/^[a-f0-9]{64}$/.test(approvedSha)) return null;
  const jobDir = path.join(path.resolve(reviewDir), safeJobPart(job.jobId));
  const receiptPath = path.join(jobDir, `${approvedSha}.json`);
  const receipt = JSON.parse(await fsPromises.readFile(receiptPath, "utf8"));
  const clipPath = path.resolve(clean(receipt.clip_path));
  const relative = path.relative(jobDir, clipPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("approved_clip_path_refused");
  const bytes = await fsPromises.readFile(clipPath);
  const clip = validateHeroClip(bytes, { forbidAudio: true, minAspect: 0.5, maxAspect: 4.0 });
  if (!clip.ok || clip.sha256 !== approvedSha) throw new Error("approved_clip_sha_mismatch");
  if (
    receipt.job_id !== job.jobId
    || receipt.prospect_id !== job.prospectId
    || Number(receipt.generation_revision) !== job.generationRevision
    || stableSerialize(receipt.approved_artifact) !== stableSerialize(job.approvedArtifact)
  ) throw new Error("approved_artifact_mismatch");
  return { receipt, bytes, clip, clipPath };
}

async function apiJson(config, pathname, { method = "GET", body, capability, leaseToken } = {}) {
  const authHeaders = capability
    ? { [HERO_JOB_CAPABILITY_HEADER]: capability }
    : leaseToken
      ? { [HERO_JOB_LEASE_HEADER]: leaseToken }
      : { "x-ghost-hero-worker-token": config.workerToken };
  const response = await timedFetch(config, `${config.apiBase}${pathname}`, {
    method,
    headers: {
      ...authHeaders,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  // Carry server diagnostics on the error string so every thrower's
  // cleaned reason (and the durable job result) shows WHY, not just what.
  if (!response.ok && json && typeof json === "object" && json.error && json.detail) {
    json.error = `${json.error} [${String(json.detail).slice(0, 140)}]`;
  }
  return { ok: response.ok, status: response.status, body: json };
}

function apiResponseError(response, fallbackMessage) {
  const error = new Error(response?.body?.error || fallbackMessage);
  const status = Number(response?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) error.status = status;
  return error;
}

async function requestLaunchCapsule(config) {
  if (!clean(config.workerToken)) throw new Error("GHOST_AGENCY_HERO_WORKER_TOKEN_required");
  const practiceBatchId = clean(config.practiceBatchId);
  const practiceRowId = clean(config.practiceRowId);
  if (Boolean(practiceBatchId) !== Boolean(practiceRowId)) throw new Error("seedance_practice_target_incomplete");
  if (config.practiceOnly === true && (!practiceBatchId || !practiceRowId)) {
    throw new Error("seedance_practice_target_required");
  }
  const response = await apiJson(config, "/api/admin/hero-job-capability", {
    method: "POST",
    body: practiceBatchId
      ? { action: "next", practice: true, batch_id: practiceBatchId, row_id: practiceRowId }
      : { action: "next" },
  });
  if (!response.ok || response.body?.ok !== true) {
    throw apiResponseError(response, "seedance_capability_broker_failed");
  }
  const capsule = clean(response.body.launch_capsule);
  return capsule || null;
}

async function claimJob(config) {
  if (config.capabilityMode) {
    const oneTimeCapability = clean(config.jobCapability);
    if (!oneTimeCapability) throw new Error("seedance_capability_required");
    const redemptionId = clean(config.capabilityRedemptionId) || randomUUID();
    config.capabilityRedemptionId = redemptionId;
    const redeem = () => apiJson(config, "/api/admin/hero-job-capability", {
      method: "POST",
      capability: oneTimeCapability,
      body: { action: "claim", redemption_id: redemptionId },
    });
    let response;
    try {
      response = await redeem();
    } catch {
      response = await redeem();
    }
    if (!response.ok && [408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
      response = await redeem();
    }
    if (!response.ok || response.body?.ok !== true) throw apiResponseError(response, "seedance_claim_failed");
    const claimed = response.body.job ? normalizeJob(response.body.job) : null;
    config.jobCapability = "";
    config.capabilityRedemptionId = "";
    if (claimed) claimed.capabilityPhase = config.capabilityPhase;
    return claimed;
  }
  const response = await apiJson(config,
    `/api/admin/hero-reel?next=1&worker_id=${encodeURIComponent(config.workerId)}&producer=${OPENROUTER_SEEDANCE_PRODUCER}`);
  if (!response.ok || response.body?.ok !== true) throw apiResponseError(response, "seedance_claim_failed");
  return response.body.job ? normalizeJob(response.body.job) : null;
}

async function settleJob(config, job, action, verdict) {
  const request = () => config.capabilityMode
    ? apiJson(config, "/api/admin/hero-job-capability", {
      method: "POST",
      leaseToken: job.leaseToken,
      body: { action: "settle", job_id: job.jobId, outcome: action, verdict },
    })
    : apiJson(config, "/api/admin/hero-reel", {
      method: "POST",
      body: { job_id: job.jobId, action, lease_token: job.leaseToken, verdict },
    });

  // Settlement is idempotent for the same lease token. Retry one transport or
  // server failure while this process still owns that lease; otherwise a lost
  // response strands already-generated bytes until the hour-long lease expires.
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await request();
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw error;
      await config.sleepImpl(250);
      continue;
    }
    if (response.ok && response.body?.ok === true) return response.body;
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    lastError = new Error(response.body?.error || "seedance_settle_failed");
    if (!retryable || attempt === 1) throw lastError;
    await config.sleepImpl(250);
  }
  throw lastError || new Error("seedance_settle_failed");
}

async function persistProviderCheckpoint(config, job, checkpoint) {
  if (typeof config.persistCheckpointImpl === "function") {
    const saved = await config.persistCheckpointImpl({ job, checkpoint });
    if (saved?.ok === false) throw new Error(saved.error || "seedance_checkpoint_failed");
    job.providerCheckpoint = checkpoint;
    return checkpoint;
  }
  const response = await apiJson(config, config.capabilityMode
    ? "/api/admin/hero-job-capability"
    : "/api/admin/hero-reel", {
    method: "POST",
    ...(config.capabilityMode ? { leaseToken: job.leaseToken } : {}),
    body: {
      job_id: job.jobId,
      action: "checkpoint",
      ...(!config.capabilityMode ? { lease_token: job.leaseToken } : {}),
      checkpoint,
    },
  });
  if (!response.ok || response.body?.ok !== true) {
    throw new Error(response.body?.error || "seedance_checkpoint_failed");
  }
  job.providerCheckpoint = checkpoint;
  return checkpoint;
}

async function renewJobLease(config, job) {
  const response = await apiJson(config, config.capabilityMode
    ? "/api/admin/hero-job-capability"
    : "/api/admin/hero-reel", {
    method: "POST",
    ...(config.capabilityMode ? { leaseToken: job.leaseToken } : {}),
    body: {
      job_id: job.jobId,
      action: "renew",
      ...(!config.capabilityMode ? {
        lease_token: job.leaseToken,
        worker_id: job.leaseOwner || config.workerId,
        lease_ms: config.leaseMs,
      } : {}),
    },
  });
  if (!response.ok || response.body?.ok !== true) {
    throw new Error(response.body?.error || "seedance_lease_renew_failed");
  }
  return response.body;
}

function startLeaseHeartbeat(config, job) {
  if (config.capabilityMode && job?.capabilityPhase === "upload") {
    return { get failure() { return null; }, stop() {} };
  }
  let stopped = false;
  let failure = null;
  const tick = async () => {
    if (stopped || failure) return;
    try { await renewJobLease(config, job); }
    catch (error) { failure = error; }
  };
  const timer = config.setIntervalImpl(tick, config.heartbeatMs);
  timer?.unref?.();
  return {
    get failure() { return failure; },
    stop() {
      stopped = true;
      config.clearIntervalImpl(timer);
    },
  };
}

async function writeLocalCheckpoint(config, job, checkpoint) {
  const dir = reviewJobDir(config.reviewDir, job);
  await config.fsPromises.mkdir(dir, { recursive: true });
  await atomicJsonWrite(providerCheckpointPath(config.reviewDir, job), checkpoint, config.fsPromises)
    .catch(async (error) => {
      if (error?.code !== "EEXIST") throw error;
      await config.fsPromises.writeFile(
        providerCheckpointPath(config.reviewDir, job),
        `${JSON.stringify(checkpoint, null, 2)}\n`,
      );
    });
}

async function submitAndDownload(config, job, photo, verifiedSource = null) {
  const started = Date.now();
  let checkpoint = job.providerCheckpoint
    ? exactCheckpoint(job, photo, job.providerCheckpoint)
    : await readProviderCheckpoint(config.reviewDir, job, photo, config.fsPromises).catch(() => null);
  if (checkpoint) job.providerCheckpoint = checkpoint;
  let source = null;
  if (!checkpoint || checkpoint.submission_state === "intent") {
    source = verifiedSource
      ? admitSourceImage(
        verifiedSource.bytes,
        verifiedSource.contentType,
        photo,
        verifiedSource.url || photo.url,
      )
      : await verifiedSourceImage(config, photo);
    // Keep the paid-submit boundary self-defending even when a caller reaches
    // this helper without going through selectVerifiedOwnedScene.
    preflightSourceHeroShape(source);
  }
  if (!checkpoint) {
    checkpoint = exactCheckpoint(job, photo, {
      schema_version: "wss.hero.seedance_provider_checkpoint.v1",
      job_id: job.jobId,
      prospect_id: job.prospectId,
      generation_revision: job.generationRevision,
      source_sha256: clean(photo.sha256).toLowerCase(),
      source_mime: source.mime,
      source_bytes: source.bytes.length,
      model_id: SEEDANCE_MODEL_ID,
      duration_seconds: job.durationSeconds,
      intent_sha256: generationIdentity(job, photo),
      submission_state: "intent",
      polling_url: "",
      created_at: new Date().toISOString(),
    });
    await persistProviderCheckpoint(config, job, checkpoint);
  }
  if (source && (checkpoint.source_mime !== source.mime || checkpoint.source_bytes !== source.bytes.length)) {
    throw new Error("source_checkpoint_mismatch");
  }
  await writeLocalCheckpoint(config, job, checkpoint);
  if (!checkpoint.polling_url) {
    if (checkpoint.submission_state !== "intent") {
      throw new Error(SUBMIT_REVIEW_REASON);
    }
    if (!source) throw new Error("source_image_required");
    // The exact locally verified bytes are published under their SHA before
    // the paid-submit boundary. A storage failure leaves the durable provider
    // checkpoint at intent and makes zero OpenRouter calls.
    source = await immutableProviderSource(config, job, source, photo);
    const parent = await parentLineGate(config, job);
    if (!parent.ok) throw new Error("parent_line_batch_status_unavailable");
    if (parent.halted) throw new Error("parent_line_batch_halted");
    if (parent.binding === "pending") throw new Error("parent_line_hero_binding_pending");
    if (parent.binding !== "current") throw new Error("parent_line_row_not_current");
    // Persist the paid-submit boundary before the network call. If the process
    // dies after provider acceptance but before its response is durable, the
    // next worker holds for owner review and never guesses by resubmitting.
    checkpoint = await markProviderSubmitting(
      config.reviewDir,
      job,
      photo,
      checkpoint,
      config.fsPromises,
    );
    await persistProviderCheckpoint(config, job, checkpoint);
    const submitted = await timedFetch(config, OPENROUTER_VIDEO_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openrouterApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: SEEDANCE_MODEL_ID,
        prompt: buildPrompt(job),
        frame_images: [{ type: "image_url", image_url: { url: source.url }, frame_type: "first_frame" }],
        duration: job.durationSeconds,
        resolution: "720p",
        aspect_ratio: "16:9",
        generate_audio: false,
      }),
    });
    const submittedBody = await submitted.json().catch(() => ({}));
    if (submitted.status >= 400 && submitted.status < 500) {
      // A deterministic 4xx proves no paid generation was accepted. The durable
      // row remains submitting and is sent to owner review instead of guessing.
      throw openRouterSubmitError(submitted.status, submittedBody);
    }
    const pollingUrl = openRouterUrl(submittedBody.polling_url);
    const providerJobId = safeJobPart(submittedBody.id);
    if (submitted.status !== 202 || !pollingUrl || !providerJobId) {
      throw new Error(SUBMIT_REVIEW_REASON);
    }
    await config.afterProviderAccepted?.({ providerJobId, pollingUrl });
    checkpoint = await saveProviderPollingUrl(
      config.reviewDir,
      job,
      photo,
      checkpoint,
      pollingUrl,
      providerJobId,
      config.fsPromises,
    );
    await persistProviderCheckpoint(config, job, checkpoint);
  }
  let completed;
  for (let attempt = 0; attempt < config.maxPollAttempts; attempt += 1) {
    if (attempt) await config.sleepImpl(config.pollMs);
    const polled = await timedFetch(config, checkpoint.polling_url, {
      headers: { authorization: `Bearer ${config.openrouterApiKey}` },
    });
    const body = await polled.json().catch(() => ({}));
    if (!polled.ok) throw openRouterPollError(polled.status, body);
    if (["failed", "error"].includes(clean(body.status).toLowerCase())) {
      throw openRouterPollError(polled.status || 200, body);
    }
    if (clean(body.status).toLowerCase() === "completed") {
      completed = { body, at: Date.now() };
      break;
    }
  }
  if (!completed) throw new Error("openrouter_poll_timeout");
  const reportedCost = completed.body?.usage?.cost ?? completed.body?.usage?.total_cost;
  const costUsd = Number(reportedCost);
  if (reportedCost === undefined || reportedCost === null || reportedCost === "" || !Number.isFinite(costUsd) || costUsd <= 0) {
    throw new Error("openrouter_cost_unavailable");
  }
  if (costUsd > config.maxCostUsd) throw new Error("openrouter_cost_ceiling_exceeded");
  const reportedOutput = completed.body?.unsigned_urls?.[0]
    || completed.body?.output?.url
    || completed.body?.url;
  const contentUrl = clean(reportedOutput)
    ? httpsUrl(reportedOutput, OPENROUTER_ORIGIN)
    : `${checkpoint.polling_url.replace(/\?.*$/, "")}/content?index=0`;
  if (!contentUrl) throw new Error("openrouter_output_url_refused");
  const download = config.downloadImpl || downloadPublicOutput;
  const providerBytes = Buffer.from(await download(contentUrl, {
    openrouterApiKey: config.openrouterApiKey,
    timeoutMs: config.downloadTimeoutMs,
    maxBytes: MAX_PROVIDER_CLIP_BYTES,
    lookupImpl: config.lookupImpl,
    httpsImpl: config.httpsImpl,
  }));
  if (!providerBytes.length || providerBytes.length > MAX_PROVIDER_CLIP_BYTES) {
    throw new Error("openrouter_clip_size_invalid");
  }
  // The provider sometimes ignores 16:9. New output must already satisfy the
  // canonical upload aspect; square/portrait bytes never become review work.
  // A compliant direct result above 4 MiB is compressed without changing its
  // aspect, timeline, or content.
  const providerValidation = validateHeroClip(providerBytes, {
    maxBytes: MAX_PROVIDER_CLIP_BYTES,
  });
  if (!providerValidation.ok) throw new Error(providerValidation.reason);
  if (Math.abs(providerValidation.durationSec - job.durationSeconds) > 0.15) {
    throw new Error("seedance_duration_mismatch");
  }
  let bytes = providerBytes;
  if (providerBytes.length > MAX_CLIP_BYTES) {
    const transcode = config.transcodeImpl || compressProviderClip;
    const compressed = await transcode(providerBytes, {
      durationSeconds: job.durationSeconds,
      execFileImpl: config.execFileImpl,
      ffmpegBin: config.ffmpegBin,
      fsPromises: config.fsPromises,
      tempRoot: config.transcodeTempRoot,
      timeoutMs: config.transcodeTimeoutMs,
    });
    if (!compressed?.ok || !Buffer.isBuffer(compressed.bytes)) {
      throw new Error(clean(compressed?.reason) || "seedance_clip_transcode_failed");
    }
    bytes = compressed.bytes;
  }
  const validation = validateHeroClip(bytes, { forbidAudio: true });
  if (!validation.ok) throw new Error(validation.reason);
  if (Math.abs(validation.durationSec - job.durationSeconds) > 0.15) throw new Error("seedance_duration_mismatch");
  return {
    bytes,
    clip: { ...validation, bytes: bytes.length },
    metrics: {
      wallTimeMs: Math.max(0, Date.now() - started),
      generationTimeMs: Math.max(0, completed.at - started),
      costUsd,
    },
  };
}

async function uploadApproved(config, job, staged) {
  const form = new FormData();
  form.append("job_id", job.jobId);
  form.append("lease_token", job.leaseToken);
  form.append("prospect_id", job.prospectId);
  form.append("source_sha256", staged.receipt.source_sha256);
  form.append("source_url", staged.receipt.source_url);
  form.append("approved", "true");
  form.append("approved_by", clean(job.approval.approved_by));
  form.append("approved_at", clean(job.approval.approved_at));
  form.append("optimized_sha256", staged.receipt.optimized_asset.sha256);
  form.append("optimized_asset_fingerprint", staged.receipt.optimized_asset.url_fingerprint);
  form.append("prompt_sha256", staged.receipt.optimized_asset.prompt_sha256);
  form.append("image_preparation", "direct_client_photo");
  form.append("clip", new Blob([staged.bytes], { type: "video/mp4" }), "hero.mp4");
  const response = await timedFetch(config, `${config.apiBase}/api/admin/hero-clip-upload`, {
    method: "POST",
    headers: config.capabilityMode
      ? { [HERO_JOB_LEASE_HEADER]: job.leaseToken }
      : { "x-ghost-hero-worker-token": config.workerToken },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 202 || body.ok !== true || body.terminal !== true) {
    throw new Error(body.error || "seedance_upload_failed");
  }
  return body;
}

async function requeueApprovedUpload(config, job, reason) {
  if (!config.capabilityMode || job?.capabilityPhase !== "upload") {
    throw new Error("seedance_upload_capability_required");
  }
  const request = () => apiJson(config, "/api/admin/hero-job-capability", {
    method: "POST",
    leaseToken: job.leaseToken,
    body: {
      action: "requeue_upload",
      job_id: job.jobId,
      reason: clean(reason).slice(0, 96) || "seedance_upload_failed",
    },
  });
  let response;
  try { response = await request(); } catch { response = await request(); }
  if (!response.ok && [408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
    response = await request();
  }
  if (!response.ok || response.body?.ok !== true) {
    throw new Error(response.body?.error || "seedance_upload_requeue_failed");
  }
  return response.body;
}

function submissionReviewVerdict(job, checkpoint) {
  return {
    producer: OPENROUTER_SEEDANCE_PRODUCER,
    generator: OPENROUTER_SEEDANCE_PRODUCER,
    generation_revision: job.generationRevision,
    reason: SUBMIT_REVIEW_REASON,
    provider_submission_review: {
      schema_version: "wss.hero.seedance_submit_review.v1",
      intent_sha256: checkpoint.intent_sha256,
      source_sha256: checkpoint.source_sha256,
      model_id: checkpoint.model_id,
      duration_seconds: checkpoint.duration_seconds,
      submit_started_at: checkpoint.submit_started_at,
    },
  };
}

async function parentLineGate(config, job) {
  const lineHandle = job?.lineHandle || job?.line_handle || job?.payload?.line_handle;
  if (!lineHandle || !clean(lineHandle.batchId || lineHandle.batch_id)) {
    return { ok: true, halted: false, current: true, binding: "current" };
  }
  let value;
  try {
    value = await config.parentBatchHalted(job);
  } catch {
    return { ok: false, halted: false, current: false, binding: "unknown" };
  }
  if (typeof value === "boolean") return { ok: true, halted: value, current: true, binding: "current" };
  if (clean(value) === "halted") return { ok: true, halted: true, current: true, binding: "current" };
  if (value && typeof value === "object") {
    if (value.ok === false) return { ok: false, halted: false, current: false, binding: "unknown" };
    if (typeof value.halted === "boolean") {
      const binding = ["current", "pending", "stale"].includes(clean(value.binding))
        ? clean(value.binding)
        : typeof value.current === "boolean" ? (value.current ? "current" : "stale") : "current";
      return {
        ok: true,
        halted: value.halted,
        current: binding === "current",
        binding,
      };
    }
  }
  return { ok: true, halted: false, current: true, binding: "current" };
}

async function refuseStaleParentLineJob(config, job) {
  const verdict = {
    ok: false,
    reason: "parent_line_row_not_current",
    retry_without_generation: true,
  };
  try {
    await settleJob(config, job, "refuse", verdict);
    return { status: "refused", reason: verdict.reason, retry_without_generation: true };
  } catch {
    return { status: "failed", reason: verdict.reason, retry_without_generation: true };
  }
}

async function requeuePendingParentLineBinding(config, job) {
  const verdict = {
    ok: false,
    reason: "parent_line_hero_binding_pending",
    retry_without_generation: true,
  };
  try {
    await settleJob(config, job, "requeue", verdict);
    return { status: "requeued", reason: verdict.reason, retry_without_generation: true };
  } catch {
    return { status: "failed", reason: verdict.reason, retry_without_generation: true };
  }
}

function hasPaidProviderResumeCheckpoint(job) {
  const checkpoint = job?.providerCheckpoint || job?.provider_checkpoint;
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return false;
  return checkpoint.schema_version === "wss.hero.seedance_provider_checkpoint.v1"
    && ["submitting", "accepted"].includes(clean(checkpoint.submission_state))
    && clean(checkpoint.job_id) === clean(job?.jobId || job?.job_id)
    && clean(checkpoint.prospect_id) === clean(job?.prospectId || job?.prospect_id)
    && Number(checkpoint.generation_revision) === Number(job?.generationRevision || job?.generation_revision);
}

async function processJob(config, job) {
  if (!job?.jobId || !job.leaseToken || job.producer !== OPENROUTER_SEEDANCE_PRODUCER) {
    return { status: "failed", reason: "bad_job_contract" };
  }
  if (
    config.capabilityMode
    && (!['generate', 'upload'].includes(job.capabilityPhase) || job.capabilityPhase !== config.capabilityPhase)
  ) return { status: "failed", reason: "seedance_capability_phase_mismatch" };
  const initialParent = await parentLineGate(config, job);
  if (!initialParent.ok) return { status: "failed", reason: "parent_line_batch_status_unavailable", retry_without_generation: true };
  if (initialParent.halted) return { status: "halted_parent", reason: "parent_line_batch_halted", retry_without_generation: true };
  if (initialParent.binding === "stale") return refuseStaleParentLineJob(config, job);
  if (initialParent.binding === "pending" && !hasPaidProviderResumeCheckpoint(job)) {
    return requeuePendingParentLineBinding(config, job);
  }
  let stagedLocally = false;
  const heartbeat = startLeaseHeartbeat(config, job);
  try {
    if (
      !job.prospectId
      || !job.sourceUrl
      || job.modelId !== SEEDANCE_MODEL_ID
      || !isSeedanceDuration(job.durationSeconds)
      || !Number.isInteger(job.generationRevision)
      || job.generationRevision < 1
    ) {
      await settleJob(config, job, "refuse", { ok: false, reason: "seedance_job_contract_mismatch" });
      return { status: "refused", reason: "seedance_job_contract_mismatch" };
    }
    if (job.approval?.approved === true) {
      if (config.capabilityMode && job.capabilityPhase !== "upload") {
        return { status: "failed", reason: "seedance_upload_capability_required" };
      }
      const staged = await readApprovedReview(config.reviewDir, job, config.fsPromises);
      if (!staged) throw new Error("approved_review_missing");
      // Upload the staged bytes EXACTLY as reviewed and approved. The
      // boomerang extension happens BEFORE staging (see the generate path) —
      // transforming after approval breaks the capability sha chain and
      // every upload 409s (capability_lease_conflict, 08-27).
      const uploaded = await uploadApproved(config, job, staged);
      return { status: "complete", url: uploaded.url };
    }
    if (config.capabilityMode && job.capabilityPhase !== "generate") {
      return { status: "failed", reason: "seedance_generate_capability_required" };
    }
    let photo = selectOwnedScene(job);
    if (!photo) {
      await settleJob(config, job, "refuse", { ok: false, reason: "no_verified_owned_real_scene" });
      return { status: "refused", reason: "no_verified_owned_real_scene" };
    }
    if (job.providerCheckpoint) {
      let acceptedCheckpoint = null;
      try { acceptedCheckpoint = exactCheckpoint(job, photo, job.providerCheckpoint); } catch { /* normal contract path below */ }
      const budget = acceptedCheckpointBudget(config, job, acceptedCheckpoint);
      if (!budget.ok) {
        await settleJob(config, job, "fail", {
          ok: false,
          reason: budget.reason,
          retry_without_generation: true,
          provider_checkpoint: acceptedCheckpoint,
        });
        return { status: "failed", reason: budget.reason, retry_without_generation: true };
      }
    }
    const staged = await readStagedReview(config.reviewDir, job, photo, config.fsPromises);
    if (staged) {
      stagedLocally = true;
      await settleJob(config, job, "hold", staged.verdict);
      return {
        status: "awaiting_review",
        receiptPath: path.join(reviewJobDir(config.reviewDir, job), `${staged.clip.sha256}.json`),
        sha256: staged.clip.sha256,
        reused: true,
      };
    }
    const selected = await selectVerifiedOwnedScene(config, job);
    if (!selected) {
      await settleJob(config, job, "refuse", { ok: false, reason: "no_proxy_safe_owned_real_scene" });
      return { status: "refused", reason: "no_proxy_safe_owned_real_scene" };
    }
    if (!selected.photo) {
      const terminalReason = clean(selected.terminalReason) || "no_proxy_safe_owned_real_scene";
      await settleJob(config, job, "refuse", { ok: false, reason: terminalReason });
      return { status: "refused", reason: terminalReason };
    }
    photo = selected.photo;
    let sourcePath = "";
    if (selected.source) {
      sourcePath = await persistReviewSource(
        config.reviewDir,
        job,
        selected.source,
        photo.sha256,
        config.fsPromises,
      );
    } else if (job.providerCheckpoint?.source_mime) {
      const expectedSourcePath = reviewSourcePath(
        config.reviewDir,
        job,
        photo.sha256,
        job.providerCheckpoint.source_mime,
      );
      sourcePath = await verifyReviewSourcePath(
        config.reviewDir,
        expectedSourcePath,
        photo.sha256,
        config.fsPromises,
      ).catch((error) => {
        if (error?.code === "ENOENT") return "";
        throw error;
      });
    }
    const generated = await submitAndDownload(config, job, photo, selected.source);
    // The provider returns the final eight-second timeline. If its bytes exceed
    // the upload envelope, the worker performs one size-only transcode; review,
    // approval, and upload then bind those exact compliant bytes.
    const finalBytes = generated.bytes;
    const finalSha = sha256(finalBytes);
    const finalClip = {
      ...generated.clip,
      bytes: finalBytes,
      sha256: finalSha,
    };
    const verdict = reviewContract(job, photo, finalClip, generated.metrics);
    const saved = await persistReview(
      config.reviewDir,
      job,
      finalBytes,
      verdict,
      config.fsPromises,
      { sourcePath },
    );
    stagedLocally = true;
    await settleJob(config, job, "hold", verdict);
    return { status: "awaiting_review", receiptPath: saved.receiptPath, sha256: finalSha };
  } catch (error) {
    const reason = clean(error?.message).replace(/[^a-z0-9_]+/gi, "_").slice(0, 96) || "seedance_worker_failed";
    if (reason === "parent_line_hero_binding_pending") return requeuePendingParentLineBinding(config, job);
    if (reason === "parent_line_row_not_current") return refuseStaleParentLineJob(config, job);
    if (reason === "parent_line_batch_halted" || reason === "parent_line_batch_status_unavailable") {
      return {
        status: reason === "parent_line_batch_halted" ? "halted_parent" : "failed",
        reason,
        retry_without_generation: true,
      };
    }
    const providerFailure = sanitizedOpenRouterFailure(error?.providerFailure);
    if (config.capabilityMode && job.capabilityPhase === "upload" && job.approval?.approved === true) {
      // Circuit breaker: an approved job whose upload contract can NEVER
        // validate (e.g. an off-contract approval) requeues forever — 08-27
        // saw one job reach 943 attempts at ~30 conflicts/minute. Past the
        // cap, refuse with the contract reason so the row's own continuation
        // and the operator see it, instead of churning attempts forever.
      const conflictAttempts = Number(job.attempts) || 0;
      if (/capability_lease_conflict|capability_replay_conflict|capability_target_conflict/.test(reason)
        && conflictAttempts >= (Number(process.env.GHOST_AGENCY_SEEDANCE_CONFLICT_REFUSE_ATTEMPTS) || 12)) {
        try {
          await settleJob(config, job, "refuse", {
            ok: false,
            reason: "hero_upload_capability_conflict_loop",
            detail: `attempts=${conflictAttempts} phase=${job.capabilityPhase}`,
            approved_bytes_preserved: true,
          });
        } catch { /* a lost settle replays after lease recovery */ }
        return {
          status: "refused",
          reason: "hero_upload_capability_conflict_loop",
          approved_bytes_preserved: true,
        };
      }
      try {
        const recovery = await requeueApprovedUpload(config, job, reason);
        if (recovery?.completed === true) {
          return {
            status: "complete",
            reused: true,
            url: clean(recovery?.job?.result?.url),
          };
        }
        return { status: "queued", reason, retry_without_generation: true, approved_bytes_preserved: true };
      } catch (requeueError) {
        return {
          status: "failed",
          reason: clean(requeueError?.message) || "seedance_upload_requeue_failed",
          retry_without_generation: true,
          approved_bytes_preserved: true,
        };
      }
    }
    // Once exact bytes and their receipt are durable locally, do not turn a
    // lost hold response into a paid regeneration. The expired lease is
    // reclaimed with the same revision, then readStagedReview replays hold.
    const photo = selectOwnedScene(job);
    const memoryCheckpoint = photo && job.providerCheckpoint
      ? (() => { try { return exactCheckpoint(job, photo, job.providerCheckpoint); } catch { return null; } })()
      : null;
    const localCheckpoint = photo
      ? await readProviderCheckpoint(config.reviewDir, job, photo, config.fsPromises).catch(() => null)
      : null;
    const checkpointRank = (value) => ({ intent: 1, submitting: 2, accepted: 3 }[value?.submission_state] || 0);
    const providerCheckpoint = checkpointRank(localCheckpoint) > checkpointRank(memoryCheckpoint)
      ? localCheckpoint
      : memoryCheckpoint;
    const rejectedFrameSource = providerFailure?.http_status === 400
      && providerFailure?.parameter === "frame_images"
      && providerCheckpoint?.submission_state !== "accepted";
    if (rejectedFrameSource && !stagedLocally) {
      const sourceSha256 = clean(providerCheckpoint?.source_sha256 || photo?.sha256).toLowerCase();
      const terminalReason = "source_image_openrouter_frame_rejected";
      try {
        await settleJob(config, job, "refuse", {
          ok: false,
          reason: terminalReason,
          source_sha256: sourceSha256,
          provider_failure: providerFailure,
        });
      } catch { /* a lost refusal is replayed only through lease recovery, never a provider submit */ }
      return {
        status: "refused",
        reason: terminalReason,
        source_sha256: sourceSha256,
        provider_failure: providerFailure,
      };
    }
    const ambiguousSubmit = providerCheckpoint?.submission_state === "submitting"
      && !providerCheckpoint.polling_url
      && !["openrouter_unauthorized", "openrouter_submit_failed"].includes(reason);
    if (ambiguousSubmit) {
      try {
        await settleJob(config, job, "hold", submissionReviewVerdict(job, providerCheckpoint));
        return {
          status: "awaiting_review",
          reason: SUBMIT_REVIEW_REASON,
          retry_without_generation: true,
        };
      } catch { /* a lost hold response is replayed after lease recovery */ }
    }
    const acceptedTransient = providerCheckpoint?.submission_state === "accepted"
      && TRANSIENT_ACCEPTED_ERRORS.has(reason);
    if (acceptedTransient && !stagedLocally) {
      const budget = acceptedCheckpointBudget(config, job, providerCheckpoint);
      if (!budget.ok) {
        try {
          await settleJob(config, job, "fail", {
            ok: false,
            reason: budget.reason,
            retry_without_generation: true,
            provider_checkpoint: providerCheckpoint,
          });
        } catch { /* an expired lease is already terminal or will replay bounded */ }
        return { status: "failed", reason: budget.reason, retry_without_generation: true };
      }
      try {
        await settleJob(config, job, "requeue", {
          ok: false,
          reason,
          retry_without_generation: true,
          provider_checkpoint: providerCheckpoint,
        });
        return { status: "queued", reason, retry_without_generation: true };
      } catch { /* an expired lease is reclaimed with the same durable checkpoint */ }
    }
    const sourceTransient = transientSourceFailure(reason)
      && (!providerCheckpoint || providerCheckpoint.submission_state === "intent");
    if (sourceTransient && !stagedLocally) {
      const sourceAttempts = Math.max(0, Number(job.attempts) || 0);
      const retryLimit = Math.max(1, Number(config.sourceRetryAttempts) || DEFAULT_SOURCE_RETRY_ATTEMPTS);
      if (sourceAttempts >= retryLimit) {
        const exhaustedReason = `${reason}_retry_exhausted`.slice(0, 96);
        try {
          await settleJob(config, job, "refuse", {
            ok: false,
            reason: exhaustedReason,
            detail: `source_attempts=${sourceAttempts}`,
            ...(providerCheckpoint ? { provider_checkpoint: providerCheckpoint } : {}),
          });
        } catch { /* an expired lease is reclaimed and bounded again */ }
        return { status: "refused", reason: exhaustedReason };
      }
      try {
        await settleJob(config, job, "requeue", {
          ok: false,
          reason,
          retry_without_generation: true,
          ...(providerCheckpoint ? { provider_checkpoint: providerCheckpoint } : {}),
        });
        return { status: "queued", reason, retry_without_generation: true };
      } catch { /* an expired lease is reclaimed without a paid provider call */ }
    }
    const preserveGeneration = stagedLocally || Boolean(providerCheckpoint);
    if (!stagedLocally && !ambiguousSubmit) {
      try {
        await settleJob(config, job, "fail", {
          ok: false,
          reason,
          ...(providerFailure ? { provider_failure: providerFailure } : {}),
          ...(providerCheckpoint ? { provider_checkpoint: providerCheckpoint } : {}),
        });
      } catch { /* lease may already be terminal */ }
    }
    return {
      status: "failed",
      reason,
      ...(providerFailure ? { provider_failure: providerFailure } : {}),
      ...(preserveGeneration ? { staged: stagedLocally, retry_without_generation: true } : {}),
    };
  } finally {
    heartbeat.stop();
  }
}

function configFromEnv(env = process.env, overrides = {}) {
  const parallelism = Math.max(1, Math.min(10, Number(env.GHOST_AGENCY_SEEDANCE_PARALLELISM || 10) || 10));
  return {
    apiBase: clean(env.GHOST_AGENCY_API_URL || env.GHOST_BASE || DEFAULT_API_BASE).replace(/\/+$/, ""),
    workerToken: clean(env.GHOST_AGENCY_HERO_WORKER_TOKEN),
    capabilityMode: false,
    capabilityPhase: "",
    jobCapability: "",
    capabilityRedemptionId: "",
    openrouterApiKey: clean(env.OPENROUTER_API_KEY),
    workerId: safeJobPart(env.HERO_FORGE_WORKER_ID || `seedance-${os.hostname()}`),
    practiceOnly: clean(env.GHOST_AGENCY_SEEDANCE_PRACTICE_ONLY) === "1",
    practiceBatchId: clean(env.GHOST_AGENCY_SEEDANCE_PRACTICE_BATCH_ID),
    practiceRowId: clean(env.GHOST_AGENCY_SEEDANCE_PRACTICE_ROW_ID),
    reviewDir: path.resolve(env.HERO_FORGE_REVIEW_DIR || DEFAULT_REVIEW_DIR),
    pollMs: Math.max(5_000, Math.min(60_000, Number(env.GHOST_AGENCY_SEEDANCE_POLL_MS || DEFAULT_POLL_MS) || DEFAULT_POLL_MS)),
    maxPollAttempts: MAX_POLL_ATTEMPTS,
    requestTimeoutMs: Math.max(5_000, Math.min(120_000, Number(env.GHOST_AGENCY_SEEDANCE_REQUEST_TIMEOUT_MS || 60_000) || 60_000)),
    sourceTimeoutMs: Math.max(5_000, Math.min(120_000, Number(env.GHOST_AGENCY_SEEDANCE_SOURCE_TIMEOUT_MS || 60_000) || 60_000)),
    sourceRetryAttempts: Math.max(1, Math.min(
      12,
      Number(env.GHOST_AGENCY_SEEDANCE_SOURCE_RETRY_ATTEMPTS || DEFAULT_SOURCE_RETRY_ATTEMPTS)
        || DEFAULT_SOURCE_RETRY_ATTEMPTS,
    )),
    acceptedClaimCap: Math.max(1, Math.min(
      50,
      Number(env.GHOST_AGENCY_SEEDANCE_ACCEPTED_CLAIM_CAP || DEFAULT_ACCEPTED_CLAIM_CAP)
        || DEFAULT_ACCEPTED_CLAIM_CAP,
    )),
    acceptedMaxAgeMs: Math.max(
      60_000,
      Math.min(
        48 * 60 * 60 * 1000,
        Number(env.GHOST_AGENCY_SEEDANCE_ACCEPTED_MAX_AGE_MS || DEFAULT_ACCEPTED_MAX_AGE_MS)
          || DEFAULT_ACCEPTED_MAX_AGE_MS,
      ),
    ),
    nowMs: () => Date.now(),
    downloadTimeoutMs: Math.max(10_000, Math.min(180_000, Number(env.GHOST_AGENCY_SEEDANCE_DOWNLOAD_TIMEOUT_MS || 120_000) || 120_000)),
    transcodeTimeoutMs: Math.max(30_000, Math.min(
      5 * 60_000,
      Number(env.GHOST_AGENCY_SEEDANCE_TRANSCODE_TIMEOUT_MS || DEFAULT_TRANSCODE_TIMEOUT_MS)
        || DEFAULT_TRANSCODE_TIMEOUT_MS,
    )),
    ffmpegBin: clean(env.GHOST_AGENCY_FFMPEG_BIN) || "ffmpeg",
    maxCostUsd: Math.max(0.01, Math.min(
      SEEDANCE_MAX_COST_USD,
      Number(env.GHOST_AGENCY_SEEDANCE_MAX_COST_USD || SEEDANCE_MAX_COST_USD) || SEEDANCE_MAX_COST_USD,
    )),
    idleMs: Math.max(1_000, Math.min(30_000, Number(env.GHOST_AGENCY_SEEDANCE_IDLE_MS || 2_000) || 2_000)),
    heartbeatMs: Math.max(30_000, Math.min(15 * 60_000, Number(env.GHOST_AGENCY_SEEDANCE_HEARTBEAT_MS || 5 * 60_000) || 5 * 60_000)),
    leaseMs: 60 * 60 * 1000,
    parallelism,
    continuous: enabled(env.GHOST_AGENCY_SEEDANCE_WORKER),
    fetchImpl: globalThis.fetch,
    sleepImpl: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    setIntervalImpl: setInterval,
    clearIntervalImpl: clearInterval,
    parentBatchHalted: async (job) => {
      const handle = job?.lineHandle || job?.line_handle || job?.payload?.line_handle;
      const batchId = clean(handle?.batchId || handle?.batch_id);
      if (!batchId) return { ok: true, halted: false, current: true, binding: "current" };
      const loadBatch = overrides.loadLineBatchImpl || require("./line-persistence").loadBatch;
      const loaded = await loadBatch(batchId);
      if (!loaded?.ok || !loaded.batch) return { ok: false, halted: false, current: false, binding: "unknown" };
      const halted = String(loaded.batch.status || "") === "halted";
      const binding = halted ? "current" : parentLineRowBinding(loaded.batch, job);
      return {
        ok: true,
        halted,
        current: binding === "current",
        binding,
        status: String(loaded.batch.status || ""),
      };
    },
    fsPromises: fs.promises,
    storageEnv: env,
    ...overrides,
  };
}

function configFromLaunchCapsule(input, env = process.env, overrides = {}) {
  const raw = Buffer.isBuffer(input) ? input.toString("utf8") : clean(input);
  if (!raw || Buffer.byteLength(raw, "utf8") > 8 * 1024) throw new Error("seedance_launch_capsule_invalid");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("seedance_launch_capsule_invalid"); }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.keys(parsed).join(",") !== "schema,phase,capability"
    || parsed.schema !== HERO_JOB_CAPABILITY_LAUNCH_SCHEMA
    || !["generate", "upload"].includes(clean(parsed.phase))
    || !clean(parsed.capability).startsWith("wss1.")
    || Buffer.byteLength(clean(parsed.capability), "utf8") > HERO_JOB_CAPABILITY_MAX_BYTES
  ) throw new Error("seedance_launch_capsule_invalid");
  return {
    ...configFromEnv(env, overrides),
    workerToken: "",
    capabilityMode: true,
    capabilityPhase: clean(parsed.phase),
    jobCapability: clean(parsed.capability),
    continuous: false,
    parallelism: 1,
  };
}

module.exports = {
  MAX_PROVIDER_CLIP_BYTES,
  DEFAULT_ACCEPTED_CLAIM_CAP,
  DEFAULT_ACCEPTED_MAX_AGE_MS,
  OPENROUTER_VIDEO_ENDPOINT,
  SUBMIT_REVIEW_REASON,
  buildPrompt,
  claimJob,
  compressProviderClip,
  configFromEnv,
  configFromLaunchCapsule,
  downloadPublicOutput,
  generationReceipt,
  generationIdentity,
  ensureProviderCheckpoint,
  imageMime,
  immutableProviderSource,
  publishSourceThroughBackend,
  preflightImmutableSourceStore,
  preflightSourceHeroShape,
  preflightSourceVisual,
  normalizeJob,
  persistReview,
  persistReviewSource,
  processJob,
  acceptedCheckpointBudget,
  openRouterPollError,
  requestLaunchCapsule,
  readApprovedReview,
  readProviderCheckpoint,
  readStagedReview,
  reviewContract,
  isPublicAddress,
  selectOwnedScene,
  selectVerifiedOwnedScene,
  settleJob,
  sourceFrameQuality,
  persistProviderCheckpoint,
  renewJobLease,
  startLeaseHeartbeat,
  submitAndDownload,
  uploadApproved,
  requeueApprovedUpload,
  validatePublicOutputUrl,
  verifiedSourceImage,
};
