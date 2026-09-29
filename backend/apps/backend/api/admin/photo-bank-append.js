"use strict";

// POST /api/admin/photo-bank-append
//
// Adds one photograph whose bytes and first-party provenance have both been
// proved. The endpoint deliberately writes the complete existing record back
// with only record.photo_bank replaced, and guards that write with the row's
// updated_at value. A concurrent writer therefore wins cleanly instead of
// having one JSON record silently erase the other.

const { createHash } = require("node:crypto");
const { isIP } = require("node:net");
const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { select, conditionalUpdate } = require("../../lib/store");
const { completedLineHeroBank } = require("../../lib/line-adapters");
const { bankFromRecord, BANK_VERSION } = require("../../lib/client-photo-bank");
const { registrableDomain } = require("../../lib/proof-storage");

const TABLE = "ghost_agency_prospects";
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function safePublicHttpsUrl(value) {
  let parsed;
  try { parsed = new URL(text(value)); } catch { return ""; }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
  ) return "";
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !host
    || host === "localhost"
    || host === "metadata"
    || host === "metadata.google.internal"
    || /\.(?:localhost|local|internal|lan|home)$/.test(host)
  ) return "";
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    if (
      a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && [0, 88, 168].includes(b))
      || (a === 198 && [18, 19, 51].includes(b))
      || (a === 203 && b === 0)
    ) return "";
  }
  if (isIP(host) === 6 && (
    host === "::" || host === "::1" || /^f[cd]/.test(host)
    || /^fe[89ab]/.test(host) || /^ff/.test(host) || /^2001:db8(?::|$)/.test(host)
  )) return "";
  parsed.hash = "";
  return parsed.toString();
}

function canonicalWebsite(record = {}, row = {}) {
  const candidates = [
    row.current_website,
    row.website,
    record?.mirror_request?.facts?.current_website,
    record?.build_ready?.mirror_request?.facts?.current_website,
    record?.build_ready?.discovery?.url,
    record?.discovery?.url,
    record?.current_website,
    record?.website,
  ];
  return candidates.map(text).find((value) => registrableDomain(value)) || "";
}

function normalizeInputPhoto(input = {}) {
  const assetTypeRaw = text(input.asset_type).toLowerCase();
  const assetType = ["real_scene", "logo", "brand_mark", "wordmark", "emblem"].includes(assetTypeRaw)
    ? assetTypeRaw
    : "";
  return {
    url: safePublicHttpsUrl(input.url),
    source: text(input.source).toLowerCase(),
    found_on: safePublicHttpsUrl(input.found_on),
    sha256: text(input.sha256).toLowerCase(),
    ...(Number(input.width) > 0 ? { width: Number(input.width) } : {}),
    ...(Number(input.height) > 0 ? { height: Number(input.height) } : {}),
    ...(Number(input.bytes) > 0 ? { bytes: Number(input.bytes) } : {}),
    ...(text(input.ext) ? { ext: text(input.ext).toLowerCase() } : {}),
    ...(text(input.grade) ? { grade: text(input.grade) } : {}),
    ...(text(input.grade_why) ? { grade_why: text(input.grade_why).slice(0, 160) } : {}),
    ...(Number.isFinite(Number(input.rank)) ? { rank: Number(input.rank) } : {}),
    ...(input.current_hero === true ? { current_hero: true } : {}),
    ...(input.identity_critical === true ? { identity_critical: true } : {}),
    ...(input.logo_like === true ? { logo_like: true } : {}),
    ...(input.stock_caption_suspect === true ? { stock_caption_suspect: true } : {}),
    ...(assetType ? { asset_type: assetType } : {}),
  };
}

async function verifiedPhotoBytes(photo, fetchFn) {
  let response;
  try {
    response = await fetchFn(photo.url, { redirect: "follow" });
  } catch {
    return { ok: false, status: 422, error: "photo_fetch_failed" };
  }
  if (!response || response.ok !== true) {
    return { ok: false, status: 422, error: "photo_fetch_failed" };
  }
  const finalUrl = safePublicHttpsUrl(response.url || photo.url);
  if (!finalUrl) return { ok: false, status: 422, error: "photo_redirect_invalid" };
  const announced = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(announced) && announced > MAX_PHOTO_BYTES) {
    return { ok: false, status: 413, error: "photo_too_large" };
  }
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); }
  catch { return { ok: false, status: 422, error: "photo_fetch_failed" }; }
  if (!bytes.length) return { ok: false, status: 422, error: "photo_empty" };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, status: 413, error: "photo_too_large" };
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== photo.sha256) return { ok: false, status: 409, error: "photo_sha256_mismatch" };
  return { ok: true, bytes: bytes.length };
}

function createPhotoBankAppendHandler(overrides = {}) {
  const deps = {
    auth: overrides.requireAdmin || requireAdmin,
    select: overrides.select || select,
    conditionalUpdate: overrides.conditionalUpdate || conditionalUpdate,
    fetch: overrides.fetch || globalThis.fetch,
    now: overrides.now || (() => new Date()),
  };

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    if (!deps.auth(req, res)) return;

    try {
      const body = await readJson(req);
      const prospectId = text(body.prospect_id || body.prospectId);
      if (!prospectId) return sendJson(res, 400, { ok: false, error: "prospect_id_required" });

      const photo = normalizeInputPhoto(body.photo || {});
      if (photo.source !== "own_site") {
        return sendJson(res, 409, { ok: false, error: "photo_source_not_first_party" });
      }
      if (!photo.url || !photo.found_on) {
        return sendJson(res, 400, { ok: false, error: "photo_https_provenance_required" });
      }
      if (!/^[0-9a-f]{64}$/.test(photo.sha256)) {
        return sendJson(res, 400, { ok: false, error: "photo_sha256_invalid" });
      }

      const found = await deps.select(
        TABLE,
        `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
      ).catch(() => null);
      if (!found || found.ok !== true) {
        return sendJson(res, 503, { ok: false, error: "prospect_store_unavailable" });
      }
      const row = Array.isArray(found.data) ? found.data[0] : null;
      if (!row) return sendJson(res, 404, { ok: false, error: "prospect_not_found" });

      const record = row.record && typeof row.record === "object" && !Array.isArray(row.record)
        ? row.record
        : {};
      const website = canonicalWebsite(record, row);
      const ownerDomain = registrableDomain(website);
      if (!ownerDomain || registrableDomain(photo.found_on) !== ownerDomain) {
        return sendJson(res, 409, { ok: false, error: "photo_found_on_wrong_domain" });
      }
      if (!text(row.updated_at)) {
        return sendJson(res, 409, { ok: false, error: "prospect_cas_version_missing" });
      }

      const existing = bankFromRecord(record);
      if ((existing?.photos || []).some((candidate) => text(candidate?.sha256).toLowerCase() === photo.sha256)) {
        return sendJson(res, 409, { ok: false, error: "photo_already_banked" });
      }

      const verified = await verifiedPhotoBytes(photo, deps.fetch);
      if (!verified.ok) return sendJson(res, verified.status, { ok: false, error: verified.error });
      photo.bytes = verified.bytes;

      const at = deps.now();
      const candidate = {
        ...(existing && typeof existing === "object" ? existing : {}),
        version: Number(existing?.version) || BANK_VERSION,
        harvested_at: at.toISOString(),
        website,
        photos: [...(Array.isArray(existing?.photos) ? existing.photos : []), photo],
      };
      const normalized = completedLineHeroBank({ ownedPhotoBank: candidate }, row, at);
      const appended = normalized?.photos?.find((entry) => entry.sha256 === photo.sha256);
      if (!normalized || !appended) {
        return sendJson(res, 409, { ok: false, error: "photo_provenance_not_canonical" });
      }

      const nextRecord = { ...record, photo_bank: normalized };
      const nextUpdatedAt = at.toISOString();
      const persisted = await deps.conditionalUpdate(
        TABLE,
        "prospect_id",
        prospectId,
        { updated_at: `eq.${text(row.updated_at)}` },
        { record: nextRecord, updated_at: nextUpdatedAt },
      ).catch(() => null);
      if (!persisted || persisted.ok !== true) {
        return sendJson(res, 503, { ok: false, error: "photo_bank_write_failed" });
      }
      if (persisted.updated !== true) {
        return sendJson(res, 409, { ok: false, error: "photo_bank_cas_conflict" });
      }

      return sendJson(res, 200, {
        ok: true,
        prospect_id: prospectId,
        appended_sha256: appended.sha256,
        photo_count: normalized.photos.length,
        photo_bank_fingerprint: normalized.fingerprint,
        updated_at: nextUpdatedAt,
      });
    } catch (error) {
      return handleError(res, error);
    }
  };
}

module.exports = createPhotoBankAppendHandler();
module.exports.createPhotoBankAppendHandler = createPhotoBankAppendHandler;
module.exports.normalizeInputPhoto = normalizeInputPhoto;
module.exports.verifiedPhotoBytes = verifiedPhotoBytes;
module.exports.MAX_PHOTO_BYTES = MAX_PHOTO_BYTES;
