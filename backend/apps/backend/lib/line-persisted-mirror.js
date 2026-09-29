"use strict";

// Recover a Mirror Engine artifact that finished between prospect selection and
// the Line worker's mirror phase.
//
// The build itself is already durable in ghost_agency_prospects, including the
// signed native release evidence. Rebuilding it under a second operation key is
// both slow and dangerous: it creates duplicate Vercel deployments, then the
// generic resume gate correctly refuses the ambiguity. This adapter reconnects
// the durable Line to the already-finished artifact only when the selected row
// points at the exact current prospect version (or the same operation key).
//
// Live delivery remains fail-closed. A preview already queued by a different
// campaign is not silently queued again. Sandbox may reuse a newly queued
// artifact because every delivery is force-routed to the configured owner.

const { select } = require("./store");
const { sanitizePreviewUrl } = require("./preview-host-guard");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("./siteforge");

const RECOVERABLE_STATUSES = new Set(["line_gate_passed", "line_queued"]);
const ALREADY_DELIVERED_STATUSES = new Set(["sent", "contacted", "delivered"]);
const HERO_RECOVERY_DENIED_STATUSES = new Set([
  ...ALREADY_DELIVERED_STATUSES,
  "opted_out", "unsubscribed", "do_not_contact", "bounced", "complained",
  "rejected", "quarantined", "archived", "archived_legacy", "retiring", "retired", "failed", "invalid",
]);
const LINE_HERO_REBUILD_SCHEMA = "line_hero_rebuild/v1";

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function recordOf(row = {}) {
  return objectOf(row.record) || {};
}

function exactVersion(row = {}, persisted = {}) {
  const selected = String(row.durableUpdatedAt || row.durable_updated_at || "").trim();
  const current = String(persisted.updated_at || "").trim();
  return Boolean(selected && current && selected === current);
}

function signedReleaseEvidence(value, previewUrl = "") {
  const evidence = objectOf(value);
  if (!evidence
    || evidence.renderer !== MIRROR_ENGINE_RENDERER
    || evidence.qc_contract !== MIRROR_ENGINE_QC_CONTRACT
    || evidence.evidence_schema !== MIRROR_ENGINE_EVIDENCE_SCHEMA
    || evidence.revealable !== true
    || !/^[a-f0-9]{64}$/i.test(String(evidence.evidence_sha || ""))) return null;
  const expected = sanitizePreviewUrl(previewUrl);
  if (!expected || sanitizePreviewUrl(evidence.preview_url) !== expected) return null;
  try {
    const { signEvidence } = require("./mirror-engine/engine");
    return signEvidence(evidence) === evidence.evidence_sha ? evidence : null;
  } catch {
    return null;
  }
}

function ownedHeroVideoPlaced(value) {
  const brand = objectOf(objectOf(value)?.checks?.brand);
  const heroVideo = objectOf(brand?.hero_video);
  return brand?.media_mode === "housed"
    && heroVideo?.supplied === true
    && heroVideo?.usable === true
    && heroVideo?.placed === 1;
}

function validatedPersistedDispatch(persisted = {}) {
  const record = recordOf(persisted);
  const previewUrl = sanitizePreviewUrl(
    persisted.preview_url
    || record.preview_url
    || record.build_dispatch?.preview_url
    || record.build_dispatch?.urls?.preview_url,
  );
  if (!previewUrl) return null;

  const dispatch = objectOf(record.build_dispatch);
  const rawEvidence = objectOf(
    dispatch?.release_evidence
    || record.mirror_release_evidence,
  );
  const releaseEvidence = signedReleaseEvidence(rawEvidence, previewUrl);
  if (!dispatch || !releaseEvidence) return null;

  const renderer = String(dispatch.renderer || releaseEvidence.renderer || "").trim();
  const qcContract = String(dispatch.qc_contract || releaseEvidence.qc_contract || "").trim();
  const evidenceSchema = String(dispatch.evidence_schema || releaseEvidence.evidence_schema || "").trim();
  const evidenceSha = String(dispatch.evidence_sha || releaseEvidence.evidence_sha || "").trim();
  const buildHash = String(dispatch.build_hash || releaseEvidence.build_hash || "").trim();
  const releaseBuildHash = String(releaseEvidence.build_hash || "").trim();

  if (renderer !== MIRROR_ENGINE_RENDERER
    || qcContract !== MIRROR_ENGINE_QC_CONTRACT
    || evidenceSchema !== MIRROR_ENGINE_EVIDENCE_SCHEMA
    || evidenceSha !== releaseEvidence.evidence_sha
    || dispatch.ready !== true
    || dispatch.pending !== false
    || dispatch.qc_passed !== true
    || dispatch.visual_qc_passed !== true
    || sanitizePreviewUrl(dispatch.preview_url || dispatch.urls?.preview_url) !== previewUrl
    || !buildHash
    || (releaseBuildHash && buildHash !== releaseBuildHash)) return null;

  return {
    previewUrl,
    dispatch,
    releaseEvidence,
    renderer,
    qcContract,
    evidenceSchema,
    evidenceSha,
    buildHash,
    contentSource: String(dispatch.content_source || "").trim(),
    generationFingerprint: String(dispatch.generation_fingerprint || `mirror-engine:${buildHash}`).trim(),
    jobId: String(dispatch.job_id || "").trim(),
  };
}

function currentWebsiteOf(persisted = {}) {
  const record = recordOf(persisted);
  return String(
    persisted.current_website
    || record.current_website
    || record.build_ready?.mirror_request?.facts?.current_website
    || record.last_mine_observation?.build_ready?.mirror_request?.facts?.current_website
    || "",
  ).trim();
}

function recoveredBuild(validated, persisted) {
  const evidence = {
    renderer: validated.renderer,
    qc_contract: validated.qcContract,
    evidence_schema: validated.evidenceSchema,
    evidence_sha: validated.evidenceSha,
    ready: true,
    pending: false,
    qc_passed: true,
    visual_qc_passed: true,
    generation_fingerprint: validated.generationFingerprint,
    build_hash: validated.buildHash,
    content_source: validated.contentSource,
    release_evidence: validated.releaseEvidence,
  };
  return {
    ok: true,
    recovered: true,
    recovery: "persisted_signed_mirror",
    previewUrl: validated.previewUrl,
    authorization: "owner_funded_spec_build",
    contentSource: validated.contentSource,
    renderer: validated.renderer,
    qcContract: validated.qcContract,
    evidenceSchema: validated.evidenceSchema,
    evidenceSha: validated.evidenceSha,
    releaseEvidence: validated.releaseEvidence,
    buildEvidence: evidence,
    publishedAggregate: validated.dispatch.published_aggregate || null,
    photoAccounting: validated.dispatch.photo_accounting || null,
    buildHash: validated.buildHash,
    currentWebsite: currentWebsiteOf(persisted),
  };
}

function heroRowJobIds(row = {}) {
  const hero = objectOf(row.heroRemaster) || objectOf(row.hero_remaster) || {};
  return {
    heroJobId: String(hero.jobId || hero.job_id || "").trim(),
    rebuildJobId: String(hero.rebuildJobId || hero.rebuild_job_id || "").trim(),
  };
}

/**
 * Validate the one narrow exception to the normal persisted-mirror status law.
 *
 * A hero rebuild has already performed the expensive Mirror Engine dispatch,
 * but it intentionally leaves the prospect's top-level status alone. The Line
 * may reuse that `previewed` artifact only when the rebuild wrote a complete,
 * signed receipt for this prospect and the row still names the same hero job
 * (when it names one at all). A generic previewed prospect never becomes
 * recoverable here.
 *
 * The receipt's line handle is provenance, not identity (2026-08-28). A hero
 * rebuild stamps the handle of the row that commissioned it; a prospect
 * re-picked by a later batch carries a NEW handle, and demanding equality made
 * its own already-rebuilt mirror permanently unrecoverable — the row fell back
 * to re-dispatching a full build every cycle (measured 44 minutes stranded on
 * CONCRETE CREATIONS HOUSTON). Identity stays prospect-scoped: marker and
 * persisted row must agree on prospect_id, and every artifact check below
 * (reel URL === the record's stored reel, sha-pinned clip path, preview URL,
 * build hash, signed owned-video evidence, full dispatch re-validation) binds
 * the receipt to THIS prospect's record, so a receipt cannot hop prospects.
 */
function validatedLineHeroRebuild(persisted = {}, row = {}, options = {}) {
  const record = recordOf(persisted);
  const marker = objectOf(record.line_hero_rebuild);
  const handle = objectOf(marker && marker.line_handle);
  const prospectId = String(row.prospectId || row.prospect_id || "").trim();
  const persistedId = String(persisted.prospect_id || "").trim();
  const batchId = String(options.batchId || options.batch_id || "").trim();
  const rowId = String(row.rowId || row.row_id || "").trim();
  const expectedJobs = heroRowJobIds(row);

  // A compact pending row may carry no job ids at all (the crossing never got
  // far enough to write them). The receipt's own hero job must then simply
  // exist — every artifact check below already pins the reel to this record —
  // while a row that DOES name a job must still name the same one, so an old
  // receipt can never shadow a newly commissioned hero job.
  if (!marker
    || marker.schema !== LINE_HERO_REBUILD_SCHEMA
    || !prospectId
    || persistedId !== prospectId
    || String(marker.prospect_id || "").trim() !== prospectId
    || !batchId
    || !rowId
    || !String(handle?.batchId || handle?.batch_id || "").trim()
    || !String(handle?.rowId || handle?.row_id || "").trim()
    || !String(marker.hero_job_id || "").trim()
    || (expectedJobs.heroJobId
      && String(marker.hero_job_id || "").trim() !== expectedJobs.heroJobId)
    || !String(marker.rebuild_job_id || "").trim()
    || (expectedJobs.rebuildJobId
      && String(marker.rebuild_job_id || "").trim() !== expectedJobs.rebuildJobId)) return null;

  const reelUrl = String(marker.reel_url || "").trim();
  const storedReelUrl = String(record.media_bank?.hero_reel?.url || "").trim();
  const heroClipSha256 = String(marker.hero_clip_sha256 || "").trim().toLowerCase();
  let reelPath = "";
  try { reelPath = new URL(reelUrl).pathname; } catch { /* invalid URL */ }
  if (!/^https:\/\//i.test(reelUrl)
    || storedReelUrl !== reelUrl
    || !/^[a-f0-9]{64}$/.test(heroClipSha256)
    || !reelPath.endsWith(`/${heroClipSha256}.mp4`)) return null;

  const previewUrl = sanitizePreviewUrl(marker.preview_url);
  const persistedPreview = sanitizePreviewUrl(persisted.preview_url || record.preview_url);
  const buildHash = String(marker.build_hash || "").trim();
  const dispatch = objectOf(marker.build_dispatch);
  const markerEvidence = signedReleaseEvidence(marker.release_evidence, previewUrl);
  if (!previewUrl
    || (persistedPreview && previewUrl !== persistedPreview)
    || !/^[a-f0-9]{64}$/i.test(buildHash)
    || !dispatch
    || !markerEvidence
    || !ownedHeroVideoPlaced(markerEvidence)) return null;

  const surrogate = {
    ...persisted,
    preview_url: previewUrl,
    record: {
      ...record,
      preview_url: previewUrl,
      build_dispatch: dispatch,
      mirror_release_evidence: marker.release_evidence,
    },
  };
  const validated = validatedPersistedDispatch(surrogate);
  const markerRebuildId = String(marker.rebuild_job_id || "").trim();
  if (!validated
    || validated.previewUrl !== previewUrl
    || validated.buildHash !== buildHash
    || validated.jobId !== markerRebuildId
    || validated.releaseEvidence.evidence_sha !== markerEvidence.evidence_sha) return null;

  return {
    ...validated,
    recovery: "persisted_signed_hero_rebuild",
    photoBank: objectOf(marker.photo_bank) || objectOf(record.photo_bank),
  };
}

async function loadPersistedProspect(row = {}, options = {}) {
  const prospectId = String(row.prospectId || row.prospect_id || "").trim();
  if (!prospectId) return null;
  const read = options.select || select;
  const loaded = await read(
    "ghost_agency_prospects",
    `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    { signal: options.signal, deadlineAt: options.deadlineAt },
  ).catch(() => null);
  return loaded && loaded.ok === true && Array.isArray(loaded.data) && loaded.data.length === 1
    ? loaded.data[0]
    : null;
}

async function recoverPersistedMirrorBuild(row = {}, options = {}) {
  const persisted = options.persistedProspect || await loadPersistedProspect(row, options);
  if (!persisted) return { recovered: false, reason: "persisted_prospect_unavailable" };

  const status = String(persisted.status || recordOf(persisted).status || "").trim().toLowerCase();
  if (ALREADY_DELIVERED_STATUSES.has(status)) {
    return {
      recovered: false,
      terminal: true,
      reason: "prospect_already_delivered",
    };
  }
  const hero = HERO_RECOVERY_DENIED_STATUSES.has(status)
    ? null
    : validatedLineHeroRebuild(persisted, row, options);
  if (hero) {
    const build = recoveredBuild(hero, persisted);
    build.recovery = hero.recovery;
    if (hero.photoBank) {
      build.ownedPhotoBank = hero.photoBank;
      build.owned_photo_bank = hero.photoBank;
    }
    return { recovered: true, persisted, build };
  }
  if (!RECOVERABLE_STATUSES.has(status)) {
    return { recovered: false, reason: "no_recoverable_persisted_mirror" };
  }

  const validated = validatedPersistedDispatch(persisted);
  if (!validated) return { recovered: false, reason: "persisted_mirror_evidence_invalid" };

  const operationKey = String(options.operationKey || "").trim();
  const sameOperation = Boolean(operationKey && validated.jobId && operationKey === validated.jobId);
  const sameSelectedVersion = exactVersion(row, persisted);
  if (!sameOperation && !sameSelectedVersion) {
    return { recovered: false, reason: "persisted_mirror_not_selected_version" };
  }

  const lane = options.lane === "live" ? "live" : "sandbox";
  if (lane === "live" && status === "line_queued" && !sameOperation) {
    return {
      recovered: false,
      terminal: true,
      reason: "prospect_already_queued_by_another_campaign",
    };
  }

  return {
    recovered: true,
    persisted,
    build: recoveredBuild(validated, persisted),
  };
}

module.exports = {
  RECOVERABLE_STATUSES,
  ALREADY_DELIVERED_STATUSES,
  HERO_RECOVERY_DENIED_STATUSES,
  LINE_HERO_REBUILD_SCHEMA,
  objectOf,
  recordOf,
  exactVersion,
  signedReleaseEvidence,
  ownedHeroVideoPlaced,
  validatedPersistedDispatch,
  currentWebsiteOf,
  recoveredBuild,
  heroRowJobIds,
  validatedLineHeroRebuild,
  loadPersistedProspect,
  recoverPersistedMirrorBuild,
};
