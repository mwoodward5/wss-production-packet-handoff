"use strict";

// POST raw source-image bytes under the exact, already-redeemed Seedance
// generate lease. This route deliberately has no admin-token or static worker-
// token lane: possession of either credential must not mint a public source
// asset outside the one frozen job that selected it.

const { createHash } = require("node:crypto");
const { methodGuard, sendJson } = require("../../lib/http");
const { requestHeroJobLease } = require("../../lib/hero-job-capability");
const queue = require("../../lib/hero-reel-job-queue");
const {
  CLIENT_ASSETS_PREFIX,
  assetKeyForSha256,
  defaultAssetStores,
} = require("../../lib/client-asset-store");
const { OPENROUTER_SEEDANCE_PRODUCER } = require("../../lib/hero-video-policy");

// Vercel's request ceiling is higher than this route's own cap. Keeping a
// margin means an accepted request cannot be rejected by the platform before
// the application can return a deterministic refusal.
const MAX_SOURCE_ASSET_BYTES = 4 * 1024 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requestHeader(req, name) {
  const value = req?.headers?.[name];
  return Array.isArray(value) ? "" : text(value);
}

function imageType(bytes) {
  const value = Buffer.from(bytes || []);
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (value.length >= 12 && value.toString("ascii", 0, 4) === "RIFF" && value.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  if (value.length >= 6 && ["GIF87a", "GIF89a"].includes(value.toString("ascii", 0, 6))) {
    return { mime: "image/gif", ext: "gif" };
  }
  if (value.length >= 12 && value.toString("ascii", 4, 8) === "ftyp" && /^(?:avif|avis)$/.test(value.toString("ascii", 8, 12))) {
    return { mime: "image/avif", ext: "avif" };
  }
  return null;
}

function bodyError(statusCode, code) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function readBoundedBinary(req, maxBytes = MAX_SOURCE_ASSET_BYTES) {
  const declared = Number(requestHeader(req, "content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw bodyError(413, "source_image_too_large");

  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw bodyError(413, "source_image_too_large");
    return Buffer.from(req.body);
  }
  if (req.body instanceof Uint8Array) {
    const bytes = Buffer.from(req.body);
    if (bytes.length > maxBytes) throw bodyError(413, "source_image_too_large");
    return bytes;
  }
  if (req.body !== undefined && req.body !== null) throw bodyError(400, "source_image_body_invalid");

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true;
      req.removeListener?.("data", onData);
      req.removeListener?.("end", onEnd);
      req.removeListener?.("error", onError);
      if (error) reject(error);
      else resolve(bytes);
    };
    const onData = (chunk) => {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        req.resume?.();
        finish(bodyError(413, "source_image_too_large"));
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks, size));
    const onError = () => finish(bodyError(400, "source_image_body_invalid"));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function exactPublicUrl(value, expectedKey) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && parsed.pathname.endsWith(`/${expectedKey}`)
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function createHeroSourceAssetHandler(overrides = {}) {
  const deps = {
    validateLease: overrides.validateHeroReelJobCapabilityLease
      || queue.validateHeroReelJobCapabilityLease,
    store: overrides.sourceAssetStore
      || defaultAssetStores(overrides.env || process.env, overrides.fetchImpl || globalThis.fetch).permanent,
    maxBytes: Number(overrides.maxBytes) > 0 ? Number(overrides.maxBytes) : MAX_SOURCE_ASSET_BYTES,
  };

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;

    const jobId = requestHeader(req, "x-ghost-hero-job-id");
    const prospectId = requestHeader(req, "x-ghost-prospect-id");
    const sourceSha256 = requestHeader(req, "x-ghost-source-sha256").toLowerCase();
    const leaseToken = requestHeroJobLease(req);
    if (!jobId || !prospectId || !SHA256_RE.test(sourceSha256) || !leaseToken) {
      return sendJson(res, 400, { ok: false, error: "source_asset_request_invalid" });
    }

    // Authenticate and bind all caller-controlled identity before reading even
    // one body byte. A bad or expired lease cannot turn this into an upload
    // sink, and a valid lease cannot cross prospects or frozen photo banks.
    let validated;
    try {
      validated = await deps.validateLease({ jobId, leaseToken, phase: "generate" });
    } catch {
      validated = null;
    }
    if (!validated?.ok) {
      return sendJson(res, 409, { ok: false, error: "capability_lease_conflict" });
    }
    const job = validated.job;
    if (
      job?.jobId !== jobId
      || job?.prospectId !== prospectId
      || job?.producer !== OPENROUTER_SEEDANCE_PRODUCER
      || job?.status !== "running"
    ) {
      return sendJson(res, 409, { ok: false, error: "source_asset_target_conflict" });
    }
    const photos = Array.isArray(job?.payload?.photo_bank?.photos)
      ? job.payload.photo_bank.photos
      : [];
    if (!photos.some((photo) => text(photo?.sha256).toLowerCase() === sourceSha256)) {
      return sendJson(res, 409, { ok: false, error: "source_not_in_claimed_job" });
    }

    let bytes;
    try {
      bytes = await readBoundedBinary(req, deps.maxBytes);
    } catch (error) {
      return sendJson(res, error?.statusCode || 400, {
        ok: false,
        error: error?.code || "source_image_body_invalid",
      });
    }
    if (!bytes.length) return sendJson(res, 400, { ok: false, error: "source_image_empty" });
    if (createHash("sha256").update(bytes).digest("hex") !== sourceSha256) {
      return sendJson(res, 409, { ok: false, error: "source_sha256_mismatch" });
    }
    const type = imageType(bytes);
    if (!type) return sendJson(res, 415, { ok: false, error: "source_image_type_invalid" });

    const expectedKey = assetKeyForSha256(sourceSha256, {
      prefix: CLIENT_ASSETS_PREFIX,
      ext: type.ext,
    });
    let bucket;
    let saved;
    try {
      bucket = await deps.store.ensureBucket();
      if (bucket?.ok === true) {
        saved = await deps.store.putContentAddressed(bytes, {
          sha256: sourceSha256,
          ext: type.ext,
          contentType: type.mime,
        });
      }
    } catch {
      bucket = null;
      saved = null;
    }
    const url = saved?.ok === true && saved.key === expectedKey
      ? exactPublicUrl(saved.publicUrl, expectedKey)
      : "";
    if (bucket?.ok !== true || !url) {
      return sendJson(res, 503, { ok: false, error: "source_asset_storage_unavailable" });
    }

    return sendJson(res, 200, {
      ok: true,
      url,
      key: expectedKey,
      sha256: sourceSha256,
    });
  };
}

const handler = createHeroSourceAssetHandler();

module.exports = handler;
module.exports.handler = handler;
module.exports.createHeroSourceAssetHandler = createHeroSourceAssetHandler;
module.exports.imageType = imageType;
module.exports.readBoundedBinary = readBoundedBinary;
module.exports.MAX_SOURCE_ASSET_BYTES = MAX_SOURCE_ASSET_BYTES;
module.exports.config = { api: { bodyParser: false } };
