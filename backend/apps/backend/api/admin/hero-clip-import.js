"use strict";

// POST /api/admin/hero-clip-import
//
// Owner-only bridge for clips produced outside the durable worker lease flow
// (for example, the five-clip Ads Station benchmark). It deliberately keeps
// the same provenance, byte validation, storage, audit, canonical record
// patch, and durable rebuild contracts as hero-clip-upload. It sends nothing.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { select, recordEvent } = require("../../lib/store");
const { uploadProofShot, publicProofUrl } = require("../../lib/proof-storage");
const { patchHeroReel } = require("../../lib/hero-reel-runner");
const { enqueueRebuildJob, runRebuildJob } = require("../../lib/rebuild-jobs");
const { readMultipart, MAX_MULTIPART_BYTES } = require("./hero-clip-upload");
const {
  validateHeroClip,
  findOwnedSource,
  validateApproval,
  normalizeSha256,
  safeReelSlug,
} = require("../../lib/hero-clip-validation");

const PUBLIC_GENERATOR = "ads_image_to_video";
const ACTUAL_GENERATOR = "ads_animate_image";
const IMPORT_SOURCE = "asset_studio_manual_import";
const DURABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

function field(fields, name) {
  return String((fields && fields[name]) || "").trim();
}

function writeSucceeded(result) {
  if (!result || result.ok === false || result.configured === false) return false;
  const mode = String(result.mode || "");
  if (mode === "dry_run" || /_failed$/.test(mode)) return false;
  return result.ok === true || /^live_(write|upsert)$/.test(mode);
}

function createHeroClipImportHandler(overrides = {}) {
  const injectedEnqueue = Object.prototype.hasOwnProperty.call(overrides, "enqueueRebuildJob");
  const deps = {
    auth: overrides.requireAdmin || requireAdmin,
    select: overrides.select || select,
    upload: overrides.uploadProofShot || uploadProofShot,
    publicUrl: overrides.publicProofUrl || publicProofUrl,
    event: overrides.recordEvent || recordEvent,
    patch: overrides.patchHeroReel || patchHeroReel,
    enqueue: overrides.enqueueRebuildJob || enqueueRebuildJob,
    kick: overrides.kickRebuildJob || (injectedEnqueue
      ? (() => {})
      : ((jobId) => { runRebuildJob(jobId).catch(() => { /* cron recovery */ }); })),
    readMultipart: overrides.readMultipart || readMultipart,
    now: overrides.now || (() => new Date()),
  };

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    if (!deps.auth(req, res)) return;

    try {
      const parsed = await deps.readMultipart(req, { maxBytes: MAX_MULTIPART_BYTES });
      if (!parsed || parsed.ok !== true) {
        return sendJson(res, parsed?.status || 400, {
          ok: false,
          error: parsed?.error || "multipart_parse_failed",
        });
      }

      const fields = parsed.fields || {};
      const file = parsed.file;
      const prospectId = field(fields, "prospect_id");
      const sourceSha256 = field(fields, "source_sha256").toLowerCase();
      const sourceUrl = field(fields, "source_url");

      if (!prospectId) return sendJson(res, 400, { ok: false, error: "prospect_id_required" });
      if (!file || file.fieldName !== "clip") {
        return sendJson(res, 400, { ok: false, error: "clip_file_required" });
      }
      if (String(file.contentType || "").toLowerCase() !== "video/mp4" || !/\.mp4$/i.test(String(file.name || ""))) {
        return sendJson(res, 415, { ok: false, error: "mp4_required" });
      }

      const now = deps.now();
      const approval = validateApproval(fields, { now: () => now.getTime() });
      if (!approval.ok) return sendJson(res, 403, { ok: false, error: approval.reason });

      const clip = validateHeroClip(file.bytes);
      if (!clip.ok) {
        return sendJson(res, clip.reason === "clip_too_large" ? 413 : 422, {
          ok: false,
          error: clip.reason,
          ...(clip.detail ? { detail: clip.detail } : {}),
        });
      }
      // The mirror can accept other ISO-BMFF codecs, but this manual bridge is
      // intentionally narrower: its browser-safe benchmark contract is H.264.
      if (!new Set(["avc1", "avc3"]).has(clip.codec)) {
        return sendJson(res, 422, { ok: false, error: "h264_required", codec: clip.codec });
      }

      const optionalHashes = {};
      for (const name of ["optimized_sha256", "prompt_sha256"]) {
        const supplied = field(fields, name);
        if (!supplied) continue;
        const normalized = normalizeSha256(supplied);
        if (!normalized) return sendJson(res, 400, { ok: false, error: `${name}_invalid` });
        optionalHashes[name] = normalized;
      }

      const found = await deps.select(
        "ghost_agency_prospects",
        `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
      ).catch(() => null);
      if (!found || found.ok !== true) {
        return sendJson(res, 503, { ok: false, error: "prospect_store_unavailable" });
      }
      const row = Array.isArray(found.data) ? found.data[0] : null;
      if (!row) return sendJson(res, 404, { ok: false, error: "prospect_not_found" });

      const owned = findOwnedSource(row.record || {}, { sha256: sourceSha256, url: sourceUrl });
      if (!owned.ok) return sendJson(res, 409, { ok: false, error: owned.reason });

      const objectPath = `${safeReelSlug(row)}/hero-reels/approved/${clip.sha256}.mp4`;
      let uploaded;
      try {
        uploaded = await deps.upload(objectPath, file.bytes, {
          contentType: "video/mp4",
          cacheControl: DURABLE_CACHE_CONTROL,
        });
      } catch (error) {
        uploaded = { ok: false, reason: String(error?.message || error) };
      }
      if (!uploaded || uploaded.ok !== true) {
        return sendJson(res, 502, {
          ok: false,
          error: "storage_write_failed",
          reason: String(uploaded?.reason || "storage_write_failed"),
        });
      }
      const url = String(uploaded.publicUrl || deps.publicUrl(objectPath) || "");
      if (!/^https:\/\//i.test(url) || !/\.mp4(?:[?#]|$)/i.test(url)) {
        return sendJson(res, 502, { ok: false, error: "storage_public_url_invalid" });
      }

      const audit = {
        prospect_id: prospectId,
        url,
        object_path: objectPath,
        sha256: clip.sha256,
        bytes: clip.bytes,
        duration_sec: clip.durationSec,
        width: clip.width,
        height: clip.height,
        codec: clip.codec,
        source: IMPORT_SOURCE,
        producer: PUBLIC_GENERATOR,
        generator: PUBLIC_GENERATOR,
        actual_generator: ACTUAL_GENERATOR,
        verified: true,
        source_sha256: owned.sha256,
        source_url: owned.url,
        ...optionalHashes,
        approved: true,
        approved_by: approval.approvedBy,
        approved_at: approval.approvedAt,
        retention: { class: "approved_durable", expires_at: null },
      };
      let audited;
      try { audited = await deps.event("hero_clip.asset_stored", audit); } catch { audited = null; }
      if (!writeSucceeded(audited)) {
        return sendJson(res, 503, {
          ok: false,
          error: "asset_audit_persist_failed",
          url,
          sha256: clip.sha256,
        });
      }

      const reel = {
        url,
        generator: PUBLIC_GENERATOR,
        composed_from: [owned.sha256],
        composed_at: now.toISOString(),
      };
      let patched;
      try { patched = await deps.patch(prospectId, reel); } catch (error) {
        patched = { ok: false, reason: String(error?.message || error) };
      }
      if (!patched || patched.ok !== true) {
        return sendJson(res, 503, {
          ok: false,
          error: "hero_reel_persist_failed",
          reason: String(patched?.reason || "persist_failed"),
          url,
        });
      }

      const importJobId = `manual_import_${clip.sha256}`;
      let rebuild;
      try {
        rebuild = await deps.enqueue({
          prospectId,
          actor: "hero_clip_import",
          heroJobId: importJobId,
          heroClipSha256: clip.sha256,
        });
      } catch (error) {
        rebuild = { ok: false, error: String(error?.message || error) };
      }
      if (!rebuild || rebuild.ok !== true) {
        return sendJson(res, 503, {
          ok: false,
          error: "rebuild_enqueue_failed",
          reason: String(rebuild?.error || "rebuild_queue_unavailable"),
          persisted: true,
          url,
        });
      }

      const rebuildJobId = String(rebuild.jobId || rebuild.job_id || "");
      let kickStarted = false;
      try {
        deps.kick(rebuildJobId);
        kickStarted = true;
      } catch { /* the durable cron sweeper owns recovery */ }

      return sendJson(res, 202, {
        ok: true,
        terminal: true,
        import_status: "accepted",
        prospect_id: prospectId,
        url,
        clip_sha256: clip.sha256,
        source_sha256: owned.sha256,
        composed_from: [owned.sha256],
        generator: PUBLIC_GENERATOR,
        actual_generator: ACTUAL_GENERATOR,
        bytes: clip.bytes,
        duration_sec: clip.durationSec,
        width: clip.width,
        height: clip.height,
        codec: clip.codec,
        approved: true,
        approved_by: approval.approvedBy,
        approved_at: approval.approvedAt,
        audit_persisted: true,
        reel_persisted: true,
        rebuild_queued: true,
        rebuild_job_id: rebuildJobId,
        rebuild_kick_started: kickStarted,
        retention: { class: "approved_durable", expires_at: null },
      });
    } catch (error) {
      return handleError(res, error, "hero_clip_import_failed");
    }
  };
}

const handler = createHeroClipImportHandler();
module.exports = handler;
module.exports.handler = handler;
module.exports.createHeroClipImportHandler = createHeroClipImportHandler;
module.exports.writeSucceeded = writeSucceeded;
module.exports.PUBLIC_GENERATOR = PUBLIC_GENERATOR;
module.exports.ACTUAL_GENERATOR = ACTUAL_GENERATOR;
module.exports.IMPORT_SOURCE = IMPORT_SOURCE;

