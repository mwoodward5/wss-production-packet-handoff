"use strict";

// The upload route is the last trust boundary before an AI-made clip becomes
// customer-facing media.  Keep its byte and provenance checks here so tests
// can exercise them without a request, storage account, or database.

const { createHash } = require("node:crypto");
const {
  WAN_PRODUCER,
  ADS_PRODUCER,
  OPENROUTER_SEEDANCE_PRODUCER,
} = require("./hero-video-policy");
const {
  WAN_MODEL_ID,
  WAN_MODEL_REVISION,
  WAN_REMASTER_RECIPE_SHA256,
  stableSerialize,
} = require("./wan-hero-policy");

// Vercel Functions reject request bodies above 4.5 MB before this route runs.
// Keep the clip at 4 MiB so the complete multipart envelope stays below that
// platform limit; accepting the engine's 5 MiB ceiling here would promise an
// upload production can never receive.
const MAX_CLIP_BYTES = 4 * 1024 * 1024;
const MIN_DURATION_SEC = 2;
const MAX_DURATION_SEC = 15;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 360;
const MAX_EDGE = 4096;
const MIN_ASPECT = 1.4;
const MAX_ASPECT = 2.5;
const PLAYABLE_MP4_CODECS = new Set(["avc1", "avc3", "hvc1", "hev1", "av01"]);
const REMASTER_PROMPT = "Enhance this photo to professional commercial quality: sharpen details, correct exposure and white balance, reduce noise, and enrich colors naturally. Keep the exact same scene, objects, framing, and composition. Add nothing, remove nothing, and add no text, logos, people, or watermarks. Photorealistic; no stylistic filters.";
const REMASTER_PROMPT_SHA256 = createHash("sha256").update(REMASTER_PROMPT).digest("hex");
const DIRECT_SOURCE_RECIPE = "wss.hero.direct_client_photo.v1";
const DIRECT_SOURCE_RECIPE_SHA256 = createHash("sha256").update(DIRECT_SOURCE_RECIPE).digest("hex");
const ADS_WORKER_GENERATOR = "ads_animate_image";
const WAN_RECEIPT_SCHEMA = "wss.hero_generation_receipt.v1";
const SEEDANCE_RECEIPT_SCHEMA = "wss.hero.seedance_generation_receipt.v1";
const SEEDANCE_MODEL_ID = "bytedance/seedance-2.0-mini";
const SEEDANCE_DURATION_SEC = 8;
const SEEDANCE_LEGACY_DURATION_SEC = 4;
const SEEDANCE_ALLOWED_DURATIONS = new Set([SEEDANCE_LEGACY_DURATION_SEC, SEEDANCE_DURATION_SEC]);
const SEEDANCE_MAX_COST_USD = 0.25;
const WAN_FALLBACK_TECHNICAL_REASONS = new Set([
  "local_model_directory_required",
  "wan_i2v_script_required",
  "python_executable_invalid",
  "ffmpeg_executable_invalid",
  "ffprobe_executable_invalid",
  "estimated_power_watts_required",
  "electricity_rate_required",
  "wan_timeout_invalid",
]);

function failure(reason, detail = "") {
  return { ok: false, reason, ...(detail ? { detail: String(detail).slice(0, 200) } : {}) };
}

function isSeedanceDuration(value) {
  return SEEDANCE_ALLOWED_DURATIONS.has(Number(value));
}

function readUint64(buffer, offset) {
  if (offset < 0 || offset + 8 > buffer.length) return null;
  const value = buffer.readBigUInt64BE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

/** Parse one ISO-BMFF box range, refusing malformed sizes instead of guessing. */
function readBoxes(buffer, start = 0, end = buffer.length) {
  const boxes = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) throw new Error("trailing_box_bytes");
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    let headerBytes = 8;
    let size = size32;
    if (size32 === 1) {
      if (end - offset < 16) throw new Error("truncated_extended_box");
      size = readUint64(buffer, offset + 8);
      headerBytes = 16;
      if (size === null) throw new Error("oversized_extended_box");
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (!Number.isInteger(size) || size < headerBytes || offset + size > end) {
      throw new Error(`invalid_${type || "unknown"}_box_size`);
    }
    boxes.push({
      type,
      start: offset,
      end: offset + size,
      payloadStart: offset + headerBytes,
      payloadEnd: offset + size,
      size,
    });
    offset += size;
  }
  return boxes;
}

function childBoxes(buffer, box) {
  return readBoxes(buffer, box.payloadStart, box.payloadEnd);
}

function firstBox(boxes, type) {
  return boxes.find((box) => box.type === type) || null;
}

function parseMovieDuration(buffer, mvhd) {
  const p = mvhd.payloadStart;
  if (mvhd.payloadEnd - p < 20) return null;
  const version = buffer[p];
  let timescale;
  let duration;
  if (version === 0) {
    if (mvhd.payloadEnd - p < 20) return null;
    timescale = buffer.readUInt32BE(p + 12);
    duration = buffer.readUInt32BE(p + 16);
  } else if (version === 1) {
    if (mvhd.payloadEnd - p < 32) return null;
    timescale = buffer.readUInt32BE(p + 20);
    duration = readUint64(buffer, p + 24);
  } else {
    return null;
  }
  if (!timescale || !duration) return null;
  const seconds = duration / timescale;
  return Number.isFinite(seconds) ? seconds : null;
}

function trackHandler(buffer, trak) {
  const mdia = firstBox(childBoxes(buffer, trak), "mdia");
  if (!mdia) return "";
  const hdlr = firstBox(childBoxes(buffer, mdia), "hdlr");
  if (!hdlr || hdlr.payloadEnd - hdlr.payloadStart < 12) return "";
  // FullBox version/flags (4), pre_defined (4), handler_type (4).
  return buffer.toString("latin1", hdlr.payloadStart + 8, hdlr.payloadStart + 12);
}

function trackDimensions(buffer, trak) {
  const tkhd = firstBox(childBoxes(buffer, trak), "tkhd");
  if (!tkhd || tkhd.payloadEnd - tkhd.payloadStart < 8) return null;
  // ISO/IEC 14496-12 stores track width/height as the final two 16.16 values.
  const width = buffer.readUInt32BE(tkhd.payloadEnd - 8) / 65536;
  const height = buffer.readUInt32BE(tkhd.payloadEnd - 4) / 65536;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

function trackCodec(buffer, trak) {
  const mdia = firstBox(childBoxes(buffer, trak), "mdia");
  if (!mdia) return "";
  const minf = firstBox(childBoxes(buffer, mdia), "minf");
  if (!minf) return "";
  const stbl = firstBox(childBoxes(buffer, minf), "stbl");
  if (!stbl) return "";
  const stsd = firstBox(childBoxes(buffer, stbl), "stsd");
  if (!stsd || stsd.payloadEnd - stsd.payloadStart < 16) return "";
  // stsd is a FullBox followed by entry_count, then sample-entry boxes.
  const entries = readBoxes(buffer, stsd.payloadStart + 8, stsd.payloadEnd);
  return entries[0]?.type || "";
}

/**
 * Structural MP4 validation. This does not trust the filename or MIME type:
 * it requires a valid ftyp/moov/video-track/mdat tree, a real movie duration,
 * and horizontal dimensions the mirror's hero slot can render.
 */
function validateHeroClip(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : null;
  const maxBytes = Number(options.maxBytes) || MAX_CLIP_BYTES;
  if (!buffer || buffer.length === 0) return failure("clip_empty");
  if (buffer.length > maxBytes) return failure("clip_too_large", `${buffer.length}>${maxBytes}`);
  if (buffer.length < 32) return failure("clip_not_mp4");

  let top;
  try {
    top = readBoxes(buffer);
  } catch (error) {
    return failure("clip_malformed_mp4", error && error.message);
  }
  const ftyp = top[0];
  if (!ftyp || ftyp.type !== "ftyp" || ftyp.start !== 0 || ftyp.size < 16) {
    return failure("clip_not_mp4");
  }
  const majorBrand = buffer.toString("latin1", ftyp.payloadStart, ftyp.payloadStart + 4);
  if (!/^[\x20-\x7e]{4}$/.test(majorBrand)) return failure("clip_not_mp4");

  const moov = firstBox(top, "moov");
  const mdat = firstBox(top, "mdat");
  if (!moov || !mdat || mdat.size <= 8) return failure("clip_malformed_mp4", "moov_or_mdat_missing");

  let moovChildren;
  try {
    moovChildren = childBoxes(buffer, moov);
  } catch (error) {
    return failure("clip_malformed_mp4", error && error.message);
  }
  const mvhd = firstBox(moovChildren, "mvhd");
  const durationSec = mvhd ? parseMovieDuration(buffer, mvhd) : null;
  if (!durationSec) return failure("clip_duration_unreadable");
  const minDuration = Number(options.minDurationSec) || MIN_DURATION_SEC;
  const maxDuration = Number(options.maxDurationSec) || MAX_DURATION_SEC;
  if (durationSec < minDuration || durationSec > maxDuration) {
    return failure("clip_duration_out_of_range", `${durationSec.toFixed(3)}s`);
  }

  let dimensions = null;
  let codec = "";
  let audioTrackCount = 0;
  try {
    for (const trak of moovChildren.filter((box) => box.type === "trak")) {
      const handler = trackHandler(buffer, trak);
      if (handler === "soun") {
        audioTrackCount += 1;
        continue;
      }
      if (handler !== "vide") continue;
      dimensions = trackDimensions(buffer, trak);
      codec = trackCodec(buffer, trak);
    }
  } catch (error) {
    return failure("clip_malformed_mp4", error && error.message);
  }
  if (options.forbidAudio === true && audioTrackCount > 0) return failure("clip_audio_forbidden");
  if (!dimensions) return failure("clip_video_track_unreadable");
  if (!PLAYABLE_MP4_CODECS.has(codec)) return failure("clip_codec_unsupported", codec || "missing_codec");
const minAspect = Number(options.minAspect) || MIN_ASPECT;
        const maxAspect = Number(options.maxAspect) || MAX_ASPECT;
      const { width, height } = dimensions;
  const aspect = width / height;
  if (
    width < MIN_WIDTH || height < MIN_HEIGHT
    || width > MAX_EDGE || height > MAX_EDGE
        || aspect < minAspect || aspect > maxAspect
  ) {
    return failure("clip_dimensions_out_of_range", `${width}x${height}`);
  }

  return {
    ok: true,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.length,
    durationSec,
    width,
    height,
    majorBrand,
    codec,
    audioTrackCount,
  };
}

function normalizeSha256(value) {
  const sha = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(sha) ? sha : "";
}

function normalizeHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") return "";
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.port === "443") url.port = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function photoBanks(record = {}) {
  const candidates = [
    record.photo_bank,
    record?.build_ready?.photo_bank,
    record?.brand?.photo_bank,
    record?.build_ready?.brand?.photo_bank,
    record?.mirror_request?.brand?.photo_bank,
    record?.build_ready?.mirror_request?.brand?.photo_bank,
  ];
  return candidates.filter((bank) => bank && Array.isArray(bank.photos));
}

/** Require SHA and URL to name the same banked photograph for this prospect. */
function findOwnedSource(record, { sha256, url } = {}) {
  const wantedSha = normalizeSha256(sha256);
  if (!wantedSha) return failure("source_sha256_invalid");
  const wantedUrl = normalizeHttpsUrl(url);
  if (!wantedUrl) return failure("source_url_invalid");

  let shaSeen = false;
  for (const bank of photoBanks(record && typeof record === "object" ? record : {})) {
    for (const photo of bank.photos) {
      if (!photo || typeof photo !== "object") continue;
      const photoSha = normalizeSha256(photo.sha256);
      if (photoSha !== wantedSha) continue;
      shaSeen = true;
      if (normalizeHttpsUrl(photo.url) === wantedUrl) {
        return { ok: true, photo, sha256: wantedSha, url: wantedUrl };
      }
    }
  }
  return failure(shaSeen ? "source_url_not_owned" : "source_sha256_not_owned");
}

function validateApproval(fields = {}, { now = () => Date.now() } = {}) {
  if (fields.approved !== true && String(fields.approved || "") !== "true") {
    return failure("owner_approval_required");
  }
  const approvedBy = String(fields.approved_by || "").trim();
  if (!approvedBy || approvedBy.length > 120 || /[\u0000-\u001f\u007f]/.test(approvedBy)) {
    return failure("approved_by_required");
  }
  const approvedAtRaw = String(fields.approved_at || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(approvedAtRaw)) {
    return failure("approved_at_invalid");
  }
  const approvedMs = Date.parse(approvedAtRaw);
  const nowMs = Number(now());
  if (!Number.isFinite(approvedMs) || !Number.isFinite(nowMs) || approvedMs > nowMs + 5 * 60 * 1000) {
    return failure("approved_at_invalid");
  }
  return { ok: true, approvedBy, approvedAt: new Date(approvedMs).toISOString() };
}

/**
 * The multipart receipt is only a transport copy. Publication requires the
 * owner-approved clip identity already stored on the claimed server job, and
 * every approval field must match that durable receipt exactly.
 */
function validateDurableClipApproval(fields, durableReceipt, clipSha256, options = {}) {
  const submitted = validateApproval(fields, options);
  if (!submitted.ok) return submitted;
  const receipt = durableReceipt && typeof durableReceipt === "object" ? durableReceipt : {};
  const durable = validateApproval({
    approved: receipt.approved,
    approved_by: receipt.approved_by ?? receipt.approvedBy,
    approved_at: receipt.approved_at ?? receipt.approvedAt,
  }, options);
  const durableSha = normalizeSha256(receipt.sha256 ?? receipt.clip_sha256 ?? receipt.clipSha256);
  const actualSha = normalizeSha256(clipSha256);
  if (
    !durable.ok
    || !durableSha
    || durableSha !== actualSha
    || durable.approvedBy !== submitted.approvedBy
    || durable.approvedAt !== submitted.approvedAt
  ) {
    return failure("durable_owner_approval_required");
  }
  return { ok: true, approvedBy: durable.approvedBy, approvedAt: durable.approvedAt, clipSha256: durableSha };
}

function cleanFingerprint(value) {
  const fingerprint = String(value || "").trim();
  return fingerprint && fingerprint.length <= 1200 && !/[\u0000-\u001f\u007f]/.test(fingerprint)
    ? fingerprint
    : "";
}

function cleanAuditText(value, maxLength = 240) {
  const output = String(value || "").trim();
  return output && output.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(output)
    ? output
    : "";
}

function boundedAuditNumber(value, max) {
  if (value === undefined || value === null || value === "") return { present: false };
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max
    ? { present: true, value: number }
    : { present: true, invalid: true };
}

/**
 * Copy only the immutable, non-path fields frozen by the queue at approval.
 * Multipart attribution is intentionally ignored: the worker cannot label its
 * own bytes as WAN, Ads, or a particular model.
 */
function durableGenerationReceipt(durableReceipt, expected = {}) {
  const artifact = durableReceipt && typeof durableReceipt === "object" ? durableReceipt : {};
  const nested = artifact.generation_receipt && typeof artifact.generation_receipt === "object"
    ? artifact.generation_receipt
    : {};
  const present = Object.keys(nested).length > 0;
  const expectedProducer = expected.producer;
  const expectedGenerator = expected.generator;
  const producer = cleanAuditText(nested.producer || artifact.producer, 80);
  const generator = cleanAuditText(nested.generator || artifact.generator, 80);
  const modelId = cleanAuditText(nested.model_id || artifact.model_id, 240);
  const modelRevision = cleanAuditText(nested.model_revision || artifact.model_revision, 240);
  const modelSettingsSha256 = normalizeSha256(
    nested.model_settings_sha256 || artifact.model_settings_sha256,
  );
  const wallTime = boundedAuditNumber(nested.wall_time_ms ?? artifact.wall_time_ms, 7 * 24 * 60 * 60 * 1000);
  const generationTime = boundedAuditNumber(
    nested.generation_time_ms ?? artifact.generation_time_ms,
    7 * 24 * 60 * 60 * 1000,
  );
  const energy = boundedAuditNumber(nested.energy_kwh ?? artifact.energy_kwh, 100);
  const cost = boundedAuditNumber(nested.cost_usd ?? artifact.cost_usd, 10_000);
  const duration = boundedAuditNumber(nested.duration_seconds ?? artifact.duration_seconds, MAX_DURATION_SEC);
  if ([wallTime, generationTime, energy, cost, duration].some((field) => field.invalid)) {
    return failure("durable_generation_receipt_invalid");
  }
  if (wallTime.present && generationTime.present && generationTime.value > wallTime.value) {
    return failure("durable_generation_receipt_invalid");
  }

  if (expectedProducer === WAN_PRODUCER) {
    const modelSettings = nested.model_settings;
    let settingsSha256 = "";
    try {
      settingsSha256 = createHash("sha256").update(stableSerialize(modelSettings)).digest("hex");
    } catch { /* mismatch below */ }
    const fallbackUsed = nested.fallback_used === true;
    const fallbackReason = cleanAuditText(nested.fallback_reason, 160);
    if (
      !present
      || cleanAuditText(nested.schema_version, 80) !== WAN_RECEIPT_SCHEMA
      || producer !== WAN_PRODUCER
      || generator !== expectedGenerator
      || modelId !== WAN_MODEL_ID
      || modelRevision !== WAN_MODEL_REVISION
      || !modelSettingsSha256
      || settingsSha256 !== modelSettingsSha256
      || normalizeSha256(nested.raw_sha256 || nested.source_sha256) !== expected.rawSha256
      || normalizeSha256(nested.optimized_sha256) !== expected.optimizedSha256
      || normalizeSha256(nested.clip_sha256) !== expected.clipSha256
      || normalizeSha256(nested.master_sha256) === ""
      || normalizeSha256(nested.recipe_sha256) !== expected.recipeSha256
    ) return failure("durable_wan_generation_receipt_required");
    if (expectedGenerator === WAN_PRODUCER) {
      if (fallbackUsed || nested.fallback_from || nested.fallback_to || fallbackReason) {
        return failure("durable_wan_fallback_receipt_invalid");
      }
    } else if (
      expectedGenerator !== ADS_WORKER_GENERATOR
      || !fallbackUsed
      || cleanAuditText(nested.fallback_from, 80) !== WAN_PRODUCER
      || cleanAuditText(nested.fallback_to, 80) !== ADS_PRODUCER
      || !WAN_FALLBACK_TECHNICAL_REASONS.has(fallbackReason)
    ) return failure("durable_wan_fallback_receipt_invalid");
  } else if (expectedProducer === OPENROUTER_SEEDANCE_PRODUCER) {
    const hasExpectedDuration = Object.prototype.hasOwnProperty.call(expected, "durationSeconds");
    const expectedDuration = Number(expected.durationSeconds);
    const durationMatches = duration.present
      && isSeedanceDuration(duration.value)
      && (!hasExpectedDuration || (
        isSeedanceDuration(expectedDuration)
        && Math.abs(duration.value - expectedDuration) <= 0.15
      ));
    if (
      !present
      || cleanAuditText(nested.schema_version, 80) !== SEEDANCE_RECEIPT_SCHEMA
      || producer !== OPENROUTER_SEEDANCE_PRODUCER
      || generator !== OPENROUTER_SEEDANCE_PRODUCER
      || modelId !== SEEDANCE_MODEL_ID
      || normalizeSha256(nested.raw_sha256 || nested.source_sha256) !== expected.rawSha256
      || normalizeSha256(nested.optimized_sha256) !== expected.optimizedSha256
      || normalizeSha256(nested.clip_sha256) !== expected.clipSha256
      || normalizeSha256(nested.recipe_sha256) !== expected.recipeSha256
      || !durationMatches
      || nested.generate_audio !== false
      || !wallTime.present
      || !generationTime.present
      || !cost.present
      || cost.value <= 0
      || cost.value > SEEDANCE_MAX_COST_USD
    ) return failure("durable_seedance_generation_receipt_required");
  } else if (
    (producer && producer !== ADS_PRODUCER)
    || (generator && generator !== ADS_WORKER_GENERATOR)
  ) {
    return failure("durable_generation_producer_mismatch");
  }

  // Current Ads artifacts freeze producer/generator at the artifact level but
  // have no generation telemetry receipt. Keep their audit/output contract
  // exactly legacy unless the queue explicitly freezes a nested receipt.
  if (expectedProducer === ADS_PRODUCER && !present) {
    return { ok: true, receipt: null };
  }
  if (!present && !producer && !generator && !modelId && !modelRevision && !modelSettingsSha256) {
    return { ok: true, receipt: null };
  }
  if (producer && producer !== expectedProducer) return failure("durable_generation_producer_mismatch");

  const receipt = {
    ...(producer ? { producer } : {}),
    ...(generator ? { generator } : {}),
    ...(modelId ? { model_id: modelId } : {}),
    ...(modelRevision ? { model_revision: modelRevision } : {}),
    ...(modelSettingsSha256 ? { model_settings_sha256: modelSettingsSha256 } : {}),
    ...(wallTime.present ? { wall_time_ms: wallTime.value } : {}),
    ...(generationTime.present ? { generation_time_ms: generationTime.value } : {}),
    ...(energy.present ? { energy_kwh: energy.value } : {}),
    ...(cost.present ? { cost_usd: cost.value } : {}),
    ...(duration.present ? { duration_seconds: duration.value } : {}),
    ...(expectedProducer === OPENROUTER_SEEDANCE_PRODUCER ? { generate_audio: false } : {}),
    ...(nested.fallback_used === true ? {
      fallback_used: true,
      fallback_from: cleanAuditText(nested.fallback_from, 80),
      fallback_to: cleanAuditText(nested.fallback_to, 80),
      fallback_reason: cleanAuditText(nested.fallback_reason, 160),
    } : {}),
  };
  return { ok: true, receipt };
}

/**
 * Prove the full raw -> remastered asset -> clip chain against the immutable
 * artifact receipt frozen onto the server-side job at owner approval time.
 */
function validateDurableRemasterArtifact(fields, durableReceipt, expected = {}) {
  const expectedProducer = String(expected.producer || ADS_PRODUCER).trim();
  if (
    expectedProducer !== ADS_PRODUCER
    && expectedProducer !== WAN_PRODUCER
    && expectedProducer !== OPENROUTER_SEEDANCE_PRODUCER
  ) {
    return failure("durable_remaster_producer_invalid");
  }
  const sourceSha = normalizeSha256(expected.sourceSha256);
  const sourceUrl = normalizeHttpsUrl(expected.sourceUrl);
  const clipSha = normalizeSha256(expected.clipSha256);
  const submitted = {
    optimizedSha256: normalizeSha256(fields?.optimized_sha256),
    promptSha256: normalizeSha256(fields?.prompt_sha256),
    optimizedAssetFingerprint: cleanFingerprint(fields?.optimized_asset_fingerprint),
  };
  const receipt = durableReceipt && typeof durableReceipt === "object" ? durableReceipt : {};
  const durableGenerator = cleanAuditText(
    receipt.generator || receipt?.generation_receipt?.generator,
    80,
  );
  const wanFallback = expectedProducer === WAN_PRODUCER && durableGenerator === ADS_WORKER_GENERATOR;
  const expectedGenerator = expectedProducer === WAN_PRODUCER && !wanFallback
    ? WAN_PRODUCER
    : expectedProducer === OPENROUTER_SEEDANCE_PRODUCER
      ? OPENROUTER_SEEDANCE_PRODUCER
      : ADS_WORKER_GENERATOR;
  const expectedRemasterPromptSha256 = expectedProducer === WAN_PRODUCER && !wanFallback
    ? WAN_REMASTER_RECIPE_SHA256
    : REMASTER_PROMPT_SHA256;
  const durable = {
    rawSha256: normalizeSha256(receipt.raw_sha256),
    sourceUrl: normalizeHttpsUrl(receipt.source_url),
    clipSha256: normalizeSha256(receipt.clip_sha256),
    optimizedSha256: normalizeSha256(receipt.optimized_sha256),
    promptSha256: normalizeSha256(receipt.prompt_sha256),
    optimizedAssetFingerprint: cleanFingerprint(receipt.optimized_asset_fingerprint),
  };
  const directSourceFingerprint = sourceSha ? `direct-source:${sourceSha}` : "";
  const directSource = [ADS_PRODUCER, OPENROUTER_SEEDANCE_PRODUCER].includes(expectedProducer)
    && durable.optimizedSha256 === sourceSha
    && durable.promptSha256 === DIRECT_SOURCE_RECIPE_SHA256
    && durable.optimizedAssetFingerprint === directSourceFingerprint;
  const validSourcePreparation = directSource || (
    durable.optimizedSha256 !== sourceSha
    && durable.promptSha256 === expectedRemasterPromptSha256
    && Boolean(durable.optimizedAssetFingerprint)
  );
  if (
    !sourceSha
    || !sourceUrl
    || !clipSha
    || durable.rawSha256 !== sourceSha
    || durable.sourceUrl !== sourceUrl
    || durable.clipSha256 !== clipSha
    || !durable.optimizedSha256
    || !validSourcePreparation
    || (expectedProducer === WAN_PRODUCER && (
      cleanAuditText(receipt.producer, 80) !== WAN_PRODUCER
      || durableGenerator !== expectedGenerator
    ))
    || (expectedProducer === ADS_PRODUCER && (
      receipt.producer && cleanAuditText(receipt.producer, 80) !== ADS_PRODUCER
      || durableGenerator && durableGenerator !== ADS_WORKER_GENERATOR
    ))
    || (expectedProducer === OPENROUTER_SEEDANCE_PRODUCER && (
      cleanAuditText(receipt.producer, 80) !== OPENROUTER_SEEDANCE_PRODUCER
      || durableGenerator !== OPENROUTER_SEEDANCE_PRODUCER
    ))
    || submitted.optimizedSha256 !== durable.optimizedSha256
    || submitted.promptSha256 !== durable.promptSha256
    || submitted.optimizedAssetFingerprint !== durable.optimizedAssetFingerprint
  ) {
    return failure("durable_remaster_artifact_required");
  }
  const generation = durableGenerationReceipt(receipt, {
    producer: expectedProducer,
    generator: expectedGenerator,
    rawSha256: durable.rawSha256,
    optimizedSha256: durable.optimizedSha256,
    clipSha256: durable.clipSha256,
    recipeSha256: durable.promptSha256,
    ...(Object.prototype.hasOwnProperty.call(expected, "durationSeconds")
      ? { durationSeconds: expected.durationSeconds }
      : {}),
  });
  if (!generation.ok) return generation;
  if (expectedProducer === OPENROUTER_SEEDANCE_PRODUCER
    && Object.prototype.hasOwnProperty.call(expected, "clipDurationSeconds")) {
    const clipDuration = Number(expected.clipDurationSeconds);
    if (!Number.isFinite(clipDuration)
      || Math.abs(clipDuration - Number(generation.receipt?.duration_seconds)) > 0.15) {
      return failure("durable_seedance_generation_receipt_required");
    }
  }
  return {
    ok: true,
    ...durable,
    producer: expectedProducer,
    generator: expectedGenerator,
    wanFallback,
    ...(generation.receipt ? { generationReceipt: generation.receipt } : {}),
  };
}

function safeReelSlug(row = {}) {
  const record = row && typeof row.record === "object" ? row.record : {};
  for (const raw of [record.preview_url, row.preview_url]) {
    const match = String(raw || "").match(/^https:\/\/([a-z0-9-]+)\.wss-ai\.com(?:\/|$)/i);
    if (match) return match[1].toLowerCase();
  }
  const rawId = String(row.prospect_id || row.prospectId || row.id || "").trim();
  return rawId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown-prospect";
}

module.exports = {
  MAX_CLIP_BYTES,
  MIN_DURATION_SEC,
  MAX_DURATION_SEC,
  MIN_WIDTH,
  MIN_HEIGHT,
  MAX_EDGE,
  MIN_ASPECT,
  MAX_ASPECT,
  PLAYABLE_MP4_CODECS,
  REMASTER_PROMPT,
  REMASTER_PROMPT_SHA256,
  DIRECT_SOURCE_RECIPE,
  DIRECT_SOURCE_RECIPE_SHA256,
  SEEDANCE_RECEIPT_SCHEMA,
  SEEDANCE_MODEL_ID,
  SEEDANCE_DURATION_SEC,
  SEEDANCE_LEGACY_DURATION_SEC,
  SEEDANCE_ALLOWED_DURATIONS,
  isSeedanceDuration,
  SEEDANCE_MAX_COST_USD,
  readBoxes,
  validateHeroClip,
  normalizeSha256,
  normalizeHttpsUrl,
  findOwnedSource,
  validateApproval,
  validateDurableClipApproval,
  durableGenerationReceipt,
  validateDurableRemasterArtifact,
  safeReelSlug,
};

if (require.main === module) {
  const assert = require("node:assert/strict");
  assert.equal(normalizeSha256("a".repeat(64)), "a".repeat(64));
  assert.equal(normalizeSha256("nope"), "");
  assert.equal(validateHeroClip(Buffer.from("not an mp4")).reason, "clip_not_mp4");
  assert.equal(validateApproval({ approved: "false", approved_by: "owner", approved_at: new Date().toISOString() }).ok, false);
  const sha = "b".repeat(64);
  assert.equal(findOwnedSource({ photo_bank: { photos: [{ url: "https://example.com/job.jpg", sha256: sha }] } }, {
    sha256: sha,
    url: "https://example.com/job.jpg",
  }).ok, true);
  const clipSha = "c".repeat(64);
  const stamp = new Date(Date.now() - 1000).toISOString();
  assert.equal(validateDurableClipApproval(
    { approved: "true", approved_by: "owner", approved_at: stamp },
    { approved: true, approved_by: "owner", approved_at: stamp, sha256: clipSha },
    clipSha,
  ).ok, true);
  assert.equal(validateDurableRemasterArtifact({
    optimized_sha256: "d".repeat(64),
    optimized_asset_fingerprint: "google.example/asset/1",
    prompt_sha256: REMASTER_PROMPT_SHA256,
  }, {
    raw_sha256: sha,
    source_url: "https://example.com/job.jpg",
    clip_sha256: clipSha,
    optimized_sha256: "d".repeat(64),
    optimized_asset_fingerprint: "google.example/asset/1",
    prompt_sha256: REMASTER_PROMPT_SHA256,
  }, { sourceSha256: sha, sourceUrl: "https://example.com/job.jpg", clipSha256: clipSha }).ok, true);
  assert.equal(validateDurableRemasterArtifact({
    optimized_sha256: sha,
    optimized_asset_fingerprint: `direct-source:${sha}`,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
  }, {
    raw_sha256: sha,
    source_url: "https://example.com/job.jpg",
    clip_sha256: clipSha,
    optimized_sha256: sha,
    optimized_asset_fingerprint: `direct-source:${sha}`,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    producer: ADS_PRODUCER,
    generator: ADS_WORKER_GENERATOR,
  }, { sourceSha256: sha, sourceUrl: "https://example.com/job.jpg", clipSha256: clipSha }).ok, true);
  assert.equal(validateDurableRemasterArtifact({
    optimized_sha256: sha,
    optimized_asset_fingerprint: `direct-source:${"e".repeat(64)}`,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
  }, {
    raw_sha256: sha,
    source_url: "https://example.com/job.jpg",
    clip_sha256: clipSha,
    optimized_sha256: sha,
    optimized_asset_fingerprint: `direct-source:${"e".repeat(64)}`,
    prompt_sha256: DIRECT_SOURCE_RECIPE_SHA256,
    producer: ADS_PRODUCER,
    generator: ADS_WORKER_GENERATOR,
  }, { sourceSha256: sha, sourceUrl: "https://example.com/job.jpg", clipSha256: clipSha }).reason, "durable_remaster_artifact_required");
  console.log("PASS hero clip validation self-test");
}
