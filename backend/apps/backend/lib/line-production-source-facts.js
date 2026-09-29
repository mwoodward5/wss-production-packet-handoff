"use strict";

// Production-only evidence bridge for the durable Line.
//
// The Mirror Engine records owned-photo placement in its signed release packet
// (`checks.brand.photos`). The base Line carried the release packet from the
// mirror phase to the render-gate phase, but it did not carry the sibling
// `photoAccounting` convenience field. sourceFactsFor therefore saw a bank of
// 8–20 verified photos and *no placed count* and correctly failed closed with
// `owned_photos_retained ... retention is unprovable` even though the signed
// renderer evidence already contained the exact count.
//
// Do not weaken that gate. Reconnect the evidence it was intended to read. The
// same signed packet also names the exact donor that rendered the site; carrying
// that identity forward lets the production render reader distinguish a known
// adjacent-trade vocabulary overlap from an actual wrong-donor swap.
//
// A second seam matters when the durable bank contains more photos than the
// build request can carry. The build lane deliberately sends only its highest-
// ranked photo prefix (currently eight) to keep one mirror inside the serverless
// budget. Those later banked photos are not mysterious losses: their exact URLs
// are still on the prospect record and the signed renderer tells us how many
// photos entered the build. Record a per-asset `not_supplied_to_renderer`
// reason for the untouched tail. The comparative gate explicitly allows a
// below-floor build only when every missing slot it relies on has a real URL and
// a real reason; this supplies that evidence without pretending an omitted photo
// rendered or relaxing any truth/identity check.

const adapters = require("./line-adapters");
const photoBank = require("./client-photo-bank");
const { select: storeSelect } = require("./store");

const PROSPECTS = "ghost_agency_prospects";

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function releaseEvidenceOf(row = {}) {
  const carried = objectOf(row.releaseEvidence || row.release_evidence);
  if (carried) return carried;
  const build = objectOf(row.buildEvidence || row.build_evidence);
  return objectOf(build && build.release_evidence) || (build && build.revealable === true ? build : null);
}

function photoAccountingFromRow(row = {}) {
  const direct = objectOf(row.photoAccounting || row.photo_accounting);
  if (direct && Number.isInteger(Number(direct.placed)) && Number(direct.placed) >= 0) return direct;

  const release = releaseEvidenceOf(row);
  const photos = objectOf(release && release.checks && release.checks.brand && release.checks.brand.photos);
  if (!photos) return null;
  const placed = Number(photos.placed);
  if (!Number.isInteger(placed) || placed < 0) return null;

  return {
    placed,
    ...(Number.isInteger(Number(photos.usable)) ? { usable: Number(photos.usable) } : {}),
    ...(Number.isInteger(Number(photos.supplied)) ? { supplied: Number(photos.supplied) } : {}),
    ...(Number.isInteger(Number(photos.unplaced)) ? { unplaced: Number(photos.unplaced) } : {}),
    ...(Array.isArray(photos.photos_unplaced) ? { photos_unplaced: photos.photos_unplaced } : {}),
    source: "signed_release_evidence",
  };
}

function donorFromRow(row = {}) {
  const release = releaseEvidenceOf(row);
  return String(
    (release && release.donor)
    || row.donor
    || row.buildDonor
    || row.build_donor
    || "",
  ).trim();
}

function prospectIdOf(row = {}) {
  return String(row.prospectId || row.prospect_id || "").trim();
}

async function freshPhotoBankForRow(row = {}, { select = storeSelect } = {}) {
  const localRecord = objectOf(row.record);
  if (localRecord) {
    const localBank = photoBank.bankFromRecord(localRecord);
    if (photoBank.bankIsFresh(localBank)) return localBank;
  }

  const prospectId = prospectIdOf(row);
  if (!prospectId || typeof select !== "function") return null;
  const result = await Promise.resolve(
    select(PROSPECTS, `?select=record&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`),
  ).catch(() => null);
  const record = objectOf(result && result.ok === true && result.data && result.data[0] && result.data[0].record);
  if (!record) return null;
  const bank = photoBank.bankFromRecord(record);
  return photoBank.bankIsFresh(bank) ? bank : null;
}

/**
 * Every bank row after the signed `supplied` count is definitely outside the
 * prefix the build lane handed to the renderer. Packet-owned photos may occupy
 * the front of that request, so this is deliberately conservative: it may omit
 * additional bank photos that were also not supplied, but it can never label a
 * later bank row as rendered.
 */
function rankedOutOfBuildReasons(bank, accounting = {}) {
  if (!bank || !Array.isArray(bank.photos)) return [];
  const supplied = Number(accounting.supplied);
  if (!Number.isInteger(supplied) || supplied <= 0 || supplied >= bank.photos.length) return [];
  const seen = new Set();
  return bank.photos.slice(supplied).flatMap((photo) => {
    const url = String(photo && photo.url || "").trim();
    if (!/^https:\/\//i.test(url) || seen.has(url)) return [];
    seen.add(url);
    return [{
      url,
      reason: `not_supplied_to_renderer: ranked outside the ${supplied}-photo build input`,
    }];
  });
}

function mergePhotoReasons(source = {}, additions = []) {
  if (!additions.length) return source;
  // A malformed supplied value is itself a fail-closed signal. Never replace
  // it with a clean array and accidentally erase the evidence of corruption.
  if (source.photos_unplaced !== undefined
    && source.photos_unplaced !== null
    && !Array.isArray(source.photos_unplaced)) return source;

  const merged = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(source.photos_unplaced) ? source.photos_unplaced : []), ...additions]) {
    if (!item || typeof item !== "object") continue;
    const url = String(item.url || "").trim();
    const reason = String(item.reason || "").trim();
    if (!url || !reason) continue;
    const key = `${url}\n${reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ url, reason });
  }
  return merged.length ? { ...source, photos_unplaced: merged } : source;
}

function createProductionSourceFacts(dependencies = {}) {
  const sourceFacts = dependencies.sourceFacts || adapters.sourceFactsFor;
  if (typeof sourceFacts !== "function") throw new TypeError("line_production_source_facts_invalid");
  const select = dependencies.select || storeSelect;
  const photoBankForRow = dependencies.photoBankForRow || ((row, options) => freshPhotoBankForRow(row, {
    select: options.select || select,
  }));

  return async function productionSourceFacts(row, options = {}) {
    const accounting = objectOf(options.photoAccounting) || photoAccountingFromRow(row);
    let source = await sourceFacts(row, {
      ...options,
      ...(accounting ? { photoAccounting: accounting } : {}),
    });
    source = objectOf(source) || {};

    if (accounting && Number.isInteger(Number(source.photos_captured))) {
      const bank = await Promise.resolve(photoBankForRow(row, options)).catch(() => null);
      // Only attach reasons to the same fresh bank whose count the base source
      // facts published. A concurrent bank refresh leaves the gate fail-closed
      // rather than mixing evidence from two versions.
      if (bank
        && Array.isArray(bank.photos)
        && bank.photos.length === Number(source.photos_captured)) {
        source = mergePhotoReasons(source, rankedOutOfBuildReasons(bank, accounting));
      }
    }

    const donor = donorFromRow(row);
    return donor ? { ...source, build_donor: donor } : source;
  };
}

module.exports = {
  objectOf,
  releaseEvidenceOf,
  photoAccountingFromRow,
  donorFromRow,
  prospectIdOf,
  freshPhotoBankForRow,
  rankedOutOfBuildReasons,
  mergePhotoReasons,
  createProductionSourceFacts,
};
