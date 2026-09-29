"use strict";

// POST /api/admin/hero-clip-upload
//
// The signed-in desktop forge can make a clip, but it never receives storage
// or owner credentials. This worker-only route is the trust seam: it proves the worker
// still owns the claimed job, proves the clip came from THIS prospect's banked
// photo, verifies the MP4 structure, stores a durable approved object, writes
// through the one canonical hero-reel patcher, and enqueues a rebuild in
// process. It sends no email, SMS, or other outreach.

const { requireHeroWorker, requestWorkerToken, safeTokenEqual } = require("../../lib/hero-worker-auth");
const { requestHeroJobLease } = require("../../lib/hero-job-capability");
const { createHash } = require("node:crypto");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { select, recordEvent, conditionalUpdate } = require("../../lib/store");
const { uploadProofShot, publicProofUrl } = require("../../lib/proof-storage");
const { patchHeroReel } = require("../../lib/hero-reel-runner");
const { enqueueRebuildJob, runRebuildJob } = require("../../lib/rebuild-jobs");
const { normalizeLineHandle, wakeLineForCompletedHero } = require("../../lib/line-hero-wakeup");
const {
  validateHeroReelJobLease,
  validateHeroReelJobCapabilityLease,
  completeHeroReelJobAfterUpload,
  getHeroReelJob,
} = require("../../lib/hero-reel-job-queue");
const {
  MAX_CLIP_BYTES,
  validateHeroClip,
  findOwnedSource,
  validateApproval,
  validateDurableClipApproval,
  validateDurableRemasterArtifact,
  normalizeHttpsUrl,
  safeReelSlug,
} = require("../../lib/hero-clip-validation");
const {
  WAN_PRODUCER,
  ADS_PRODUCER,
  OPENROUTER_SEEDANCE_PRODUCER,
  DURABLE_HERO_PRODUCERS,
} = require("../../lib/hero-video-policy");
const { stableSerialize } = require("../../lib/wan-hero-policy");
const { HYDRATOR_VERSION: MIRROR_ENGINE_RENDERER } = require("../../lib/mirror-engine/build-hash");
const { signEvidence, verifyEvidence } = require("../../lib/mirror-engine/evidence-signature");
const {
  injectSharedSiteHero,
  createDefaultSharedHeroRuntime,
  sharedHeroEvidenceFromRow,
  sharedHeroInjectionEnabled,
} = require("../../lib/shared-site-hero-injection");

const MAX_MULTIPART_BYTES = MAX_CLIP_BYTES + 128 * 1024;
const ADS_GENERATOR = "ads_image_to_video";
const ADS_WORKER_GENERATOR = "ads_animate_image";
const ADS_SOURCE = "asset_studio_manual";
const WAN_SOURCE = "wan_local_i2v";
const OPENROUTER_SOURCE = "openrouter_i2v";
const DURABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const SHARED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROSPECTS_TABLE = "ghost_agency_prospects";
const MIRROR_ENGINE_QC_CONTRACT = "mirror-engine-qc-v1";
const MIRROR_ENGINE_EVIDENCE_SCHEMA = "mirror-engine-release-evidence-v1";

function heroRebuildKickEnabled(environment = process.env) {
  return !/^(0|false|off|no)$/i.test(String(environment?.GHOST_AGENCY_HERO_REBUILD_KICK ?? "1").trim());
}

function field(fields, name) {
  return String((fields && fields[name]) || "").trim();
}

function writeSucceeded(result) {
  if (!result || result.ok === false || result.configured === false) return false;
  const mode = String(result.mode || "");
  if (mode === "dry_run" || /_failed$/.test(mode)) return false;
  return result.ok === true || /^live_(write|upsert)$/.test(mode);
}

function stableValueEqual(left, right) {
  try { return stableSerialize(left) === stableSerialize(right); } catch { return false; }
}

function signMirrorEvidence(manifest) {
  // THE SIGNER IS THE ENGINE'S, NOT A LOCAL ONE. This file once re-derived
  // evidence_sha with plain sha256 over the canonical form, while the engine
  // (lib/mirror-engine/evidence-signature.js) signs with keyed HMAC-SHA256.
  // The two never agreed: every engine-signed release evidence failed this
  // gate as shared_hero_proof_signature_invalid (verified 2026-09-17: 6/6
  // prospects passed the engine verifier, 0/6 passed the local one), which
  // is how approved hero clips stalled at shared_release_record. One signer,
  // one verifier, one module.
  return signEvidence(manifest);
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function sameProofIdentity(left, right) {
  const a = objectValue(left) || {};
  const b = objectValue(right) || {};
  return String(a.site_id || "") === String(b.site_id || "")
    && String(a.release_id || "") === String(b.release_id || "")
    && String(a.build_hash || "").toLowerCase() === String(b.build_hash || "").toLowerCase();
}

function nextWriteTime(current, now) {
  const currentMs = Date.parse(String(current || ""));
  const requestedMs = Date.parse(String(now || ""));
  const selected = Math.max(
    Number.isFinite(requestedMs) ? requestedMs : Date.now(),
    Number.isFinite(currentMs) ? currentMs + 1 : 0,
  );
  return new Date(selected).toISOString();
}

function exactSharedPreview(value, host) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === host && !url.port
      && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === "/" || url.pathname === "")
      ? `${url.origin}/`
      : "";
  } catch {
    return "";
  }
}

function persistedSharedReleaseMatches(row, expected = {}) {
  const selected = sharedHeroEvidenceFromRow(row);
  if (!selected.ok || !sameProofIdentity(selected.identity, expected.proofIdentity)
    || Number(selected.generation) !== Number(expected.releaseEvidence?.generation)) return false;
  const record = objectValue(row?.record) || {};
  const dispatch = objectValue(record.build_dispatch) || {};
  const evidence = objectValue(dispatch.release_evidence);
  if (!evidence || !stableValueEqual(evidence, expected.nativeEvidence)
    || !stableValueEqual(record.release_evidence, expected.nativeEvidence)
    || dispatch.build_hash !== expected.proofIdentity.build_hash
    || dispatch.evidence_sha !== expected.nativeEvidence.evidence_sha
    || dispatch.generation_fingerprint !== expected.generationFingerprint
    || record.siteforge_generation_fingerprint !== expected.generationFingerprint) return false;
  if (objectValue(record.mirror_release_evidence)
    && !stableValueEqual(record.mirror_release_evidence, expected.nativeEvidence)) return false;
  if (objectValue(record.siteforge_callback)) {
    if (!stableValueEqual(record.siteforge_callback.release_evidence, expected.nativeEvidence)
      || record.siteforge_callback.build_hash !== expected.proofIdentity.build_hash
      || record.siteforge_callback.evidence_sha !== expected.nativeEvidence.evidence_sha
      || record.siteforge_callback.generation_fingerprint !== expected.generationFingerprint) return false;
  }
  try {
    return verifyEvidence(evidence);
  } catch {
    return false;
  }
}

async function persistSharedHeroRelease(input = {}, deps = {}) {
  const prospectId = String(input.prospectId || "").trim();
  const previous = input.previousSelection;
  const shared = input.sharedRelease;
  if (!prospectId || previous?.ok !== true || shared?.ok !== true
    || !sameProofIdentity(shared.previousProofIdentity, previous.identity)) {
    return { ok: false, reason: "shared_hero_proof_persist_input_invalid" };
  }
  const nextSelection = sharedHeroEvidenceFromRow({
    slug: previous.slug,
    proofIdentity: shared.proofIdentity,
    sharedReleaseEvidence: shared.releaseEvidence,
  });
  if (!nextSelection.ok || nextSelection.identity.site_id !== previous.identity.site_id
    || nextSelection.identity.release_id === previous.identity.release_id
    || nextSelection.generation !== previous.generation + 1
    || nextSelection.heroVideoPath !== previous.heroVideoPath
    || nextSelection.heroVideoSha256 !== String(shared.heroVideoSha256 || "").toLowerCase()
    || !exactSharedPreview(shared.previewUrl, nextSelection.canonicalHost)) {
    return { ok: false, reason: "shared_hero_proof_persist_receipt_invalid" };
  }

  const read = deps.select || select;
  const update = deps.conditionalUpdate || conditionalUpdate;
  const now = deps.now || (() => new Date().toISOString());
  const load = async () => {
    const found = await read(
      PROSPECTS_TABLE,
      `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    ).catch(() => null);
    return found?.ok === true && Array.isArray(found.data) ? found.data[0] : null;
  };
  let current = await load();
  if (!current) return { ok: false, reason: "shared_hero_proof_record_read_failed" };

  const currentSelection = sharedHeroEvidenceFromRow(current);
  if (currentSelection.ok && sameProofIdentity(currentSelection.identity, nextSelection.identity)) {
    const currentRecord = objectValue(current.record) || {};
    const currentEvidence = objectValue(currentRecord.build_dispatch)?.release_evidence;
    const fingerprint = `mirror-engine:${nextSelection.identity.build_hash}`;
    if (persistedSharedReleaseMatches(current, {
      proofIdentity: nextSelection.identity,
      releaseEvidence: nextSelection.evidence,
      nativeEvidence: currentEvidence,
      generationFingerprint: fingerprint,
    })) {
      return { ok: true, reconciled: true, write_id: String(current.updated_at || ""),
        proofIdentity: nextSelection.identity, releaseEvidence: nextSelection.evidence };
    }
    return { ok: false, reason: "shared_hero_proof_persist_conflict" };
  }
  if (!currentSelection.ok || !sameProofIdentity(currentSelection.identity, previous.identity)
    || currentSelection.generation !== previous.generation) {
    return { ok: false, reason: "shared_hero_proof_persist_conflict" };
  }

  const record = objectValue(current.record) || {};
  const dispatch = objectValue(record.build_dispatch) || {};
  const nativeEvidence = objectValue(dispatch.release_evidence);
  if (!nativeEvidence || !stableValueEqual(record.release_evidence || nativeEvidence, nativeEvidence)
    || nativeEvidence.renderer !== MIRROR_ENGINE_RENDERER
    || nativeEvidence.qc_contract !== MIRROR_ENGINE_QC_CONTRACT
    || nativeEvidence.evidence_schema !== MIRROR_ENGINE_EVIDENCE_SCHEMA
    || nativeEvidence.revealable !== true
    || nativeEvidence.build_hash !== previous.identity.build_hash
    || dispatch.renderer !== MIRROR_ENGINE_RENDERER
    || dispatch.qc_contract !== MIRROR_ENGINE_QC_CONTRACT
    || dispatch.evidence_sha !== nativeEvidence.evidence_sha
    || (objectValue(record.mirror_release_evidence)
      && !stableValueEqual(record.mirror_release_evidence, nativeEvidence))
    || (objectValue(record.siteforge_callback?.release_evidence)
      && !stableValueEqual(record.siteforge_callback.release_evidence, nativeEvidence))) {
    return { ok: false, reason: "shared_hero_proof_persist_conflict" };
  }
  try {
    if (!nativeEvidence.evidence_sha || !verifyEvidence(nativeEvidence)) {
      return { ok: false, reason: "shared_hero_proof_signature_invalid" };
    }
  } catch {
    return { ok: false, reason: "shared_hero_proof_signature_invalid" };
  }

  const nextNativeEvidence = {
    ...nativeEvidence,
    build_hash: nextSelection.identity.build_hash,
    deploy_id: nextSelection.identity.release_id,
    deploy_url: String(shared.previewUrl || "").replace(/\/+$/, ""),
    proofIdentity: { ...nextSelection.identity },
    sharedReleaseEvidence: { ...nextSelection.evidence },
  };
  nextNativeEvidence.evidence_sha = signMirrorEvidence(nextNativeEvidence);
  const generationFingerprint = `mirror-engine:${nextSelection.identity.build_hash}`;
  const nextDispatch = {
    ...dispatch,
    build_hash: nextSelection.identity.build_hash,
    evidence_sha: nextNativeEvidence.evidence_sha,
    generation_fingerprint: generationFingerprint,
    release_evidence: nextNativeEvidence,
  };
  const callback = objectValue(record.siteforge_callback);
  const nextRecord = {
    ...record,
    build_dispatch: nextDispatch,
    release_evidence: nextNativeEvidence,
    siteforge_generation_fingerprint: generationFingerprint,
    ...(objectValue(record.mirror_release_evidence)
      ? { mirror_release_evidence: nextNativeEvidence }
      : {}),
    ...(callback ? { siteforge_callback: {
      ...callback,
      build_hash: nextSelection.identity.build_hash,
      evidence_sha: nextNativeEvidence.evidence_sha,
      generation_fingerprint: generationFingerprint,
      release_evidence: nextNativeEvidence,
    } } : {}),
  };
  const currentUpdatedAt = String(current.updated_at || "").trim();
  if (!currentUpdatedAt) return { ok: false, reason: "shared_hero_proof_version_missing" };
  const nextUpdatedAt = nextWriteTime(currentUpdatedAt, now());
  const guards = {
    updated_at: `eq.${currentUpdatedAt}`,
    "record->build_dispatch->release_evidence->proofIdentity->>site_id": `eq.${previous.identity.site_id}`,
    "record->build_dispatch->release_evidence->proofIdentity->>release_id": `eq.${previous.identity.release_id}`,
    "record->build_dispatch->release_evidence->proofIdentity->>build_hash": `eq.${previous.identity.build_hash}`,
    "record->build_dispatch->release_evidence->sharedReleaseEvidence->>generation": `eq.${previous.generation}`,
    "record->build_dispatch->release_evidence->>evidence_sha": `eq.${nativeEvidence.evidence_sha}`,
  };
  if (objectValue(record.release_evidence)) {
    guards["record->release_evidence->proofIdentity->>release_id"] = `eq.${previous.identity.release_id}`;
    guards["record->release_evidence->sharedReleaseEvidence->>generation"] = `eq.${previous.generation}`;
  }
  let written;
  try {
    written = await update(
      PROSPECTS_TABLE,
      "prospect_id",
      prospectId,
      guards,
      { record: nextRecord, updated_at: nextUpdatedAt },
    );
  } catch (error) {
    written = { ok: false, error: String(error?.message || error) };
  }
  const committed = written?.ok === true && written.updated === true && Array.isArray(written.rows)
    ? written.rows[0]
    : null;
  if (committed && persistedSharedReleaseMatches(committed, {
    proofIdentity: nextSelection.identity,
    releaseEvidence: nextSelection.evidence,
    nativeEvidence: nextNativeEvidence,
    generationFingerprint,
  })) {
    return { ok: true, write_id: String(committed.updated_at || nextUpdatedAt),
      proofIdentity: nextSelection.identity, releaseEvidence: nextSelection.evidence };
  }
  current = await load();
  if (persistedSharedReleaseMatches(current, {
    proofIdentity: nextSelection.identity,
    releaseEvidence: nextSelection.evidence,
    nativeEvidence: nextNativeEvidence,
    generationFingerprint,
  })) {
    return { ok: true, reconciled: true, write_id: String(current.updated_at || nextUpdatedAt),
      proofIdentity: nextSelection.identity, releaseEvidence: nextSelection.evidence };
  }
  return { ok: false, reason: "shared_hero_proof_persist_conflict" };
}

/**
 * Producer attribution comes only from the server-side job frozen by the
 * queue. Legacy jobs predate the producer column and remain Ads jobs. Any
 * frozen artifact attribution that is present must agree with the row.
 */
function durableHeroAttribution(job) {
  const payload = job && typeof job.payload === "object" ? job.payload : {};
  const artifact = payload.approved_artifact && typeof payload.approved_artifact === "object"
    ? payload.approved_artifact
    : {};
  const generation = artifact.generation_receipt && typeof artifact.generation_receipt === "object"
    ? artifact.generation_receipt
    : {};
  const rowProducer = String(job?.producer || "").trim();
  const artifactProducer = String(generation.producer || artifact.producer || "").trim();
  const producer = rowProducer || artifactProducer || ADS_PRODUCER;
  if (
    !DURABLE_HERO_PRODUCERS.includes(producer)
    || (rowProducer && artifactProducer && rowProducer !== artifactProducer)
  ) return { ok: false, reason: "durable_hero_producer_mismatch" };

  const frozenGenerator = String(generation.generator || artifact.generator || "").trim();
  const wanFallback = producer === WAN_PRODUCER && frozenGenerator === ADS_WORKER_GENERATOR;
  const expectedFrozenGenerator = producer === WAN_PRODUCER && !wanFallback
    ? WAN_PRODUCER
    : producer === OPENROUTER_SEEDANCE_PRODUCER
      ? OPENROUTER_SEEDANCE_PRODUCER
      : ADS_WORKER_GENERATOR;
  if (frozenGenerator && frozenGenerator !== expectedFrozenGenerator) {
    return { ok: false, reason: "durable_hero_generator_mismatch" };
  }
  if (producer === OPENROUTER_SEEDANCE_PRODUCER) {
    return {
      ok: true,
      producer,
      generator: OPENROUTER_SEEDANCE_PRODUCER,
      source: OPENROUTER_SOURCE,
      actualGenerator: frozenGenerator || OPENROUTER_SEEDANCE_PRODUCER,
      wanFallback: false,
    };
  }
  return {
    ok: true,
    producer,
    generator: producer === WAN_PRODUCER && !wanFallback ? WAN_PRODUCER : ADS_GENERATOR,
    source: producer === WAN_PRODUCER && !wanFallback ? WAN_SOURCE : ADS_SOURCE,
    actualGenerator: frozenGenerator || expectedFrozenGenerator,
    wanFallback,
  };
}

// The public build never receives a bare producer label.  This compact record
// is derived only at the authenticated, verified-upload boundary from the
// durable queue job, so the mirror can distinguish an actual Seedance output
// from a static fallback without receiving credentials or mutable receipts.
function durableReelProvenance(job, attribution, clipSha256, generationReceipt = null) {
  const jobId = String(job?.jobId || job?.job_id || "").trim();
  const revision = Number(job?.generationRevision ?? job?.generation_revision);
  const outputSha = String(clipSha256 || "").trim().toLowerCase();
  if (!jobId || !Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(outputSha)) return null;
  const base = {
    generator: String(attribution?.generator || ""),
    hero_job_id: jobId,
    attempt_id: `hero_attempt:${revision}`,
    output_sha256: outputSha,
  };
  if (attribution?.producer !== OPENROUTER_SEEDANCE_PRODUCER) {
    return base.generator ? { kind: "client_derived_reel", ...base } : null;
  }
  const receipt = generationReceipt && typeof generationReceipt === "object" && !Array.isArray(generationReceipt)
    ? generationReceipt
    : null;
  // validateDurableRemasterArtifact has already verified the full frozen
  // receipt, then deliberately returns a compact normalized form without the
  // schema field. Stamp the schema here only after that validator succeeded.
  const receiptSchema = receipt ? "wss.hero.seedance_generation_receipt.v1" : "";
  let receiptSha256 = "";
  try {
    receiptSha256 = receipt
      ? createHash("sha256").update(stableSerialize(receipt)).digest("hex")
      : "";
  } catch {
    receiptSha256 = "";
  }
  const checkpoint = job?.result?.provider_checkpoint;
  if (!checkpoint || checkpoint.schema_version !== "wss.hero.seedance_provider_checkpoint.v1"
    || checkpoint.submission_state !== "accepted"
    || String(checkpoint.provider_job_id || "").trim().length === 0
    || Number(checkpoint.generation_revision) !== revision
    || receiptSchema !== "wss.hero.seedance_generation_receipt.v1"
    || !/^[a-f0-9]{64}$/.test(receiptSha256)) return null;
  return {
    kind: "seedance_generated",
    ...base,
    checkpoint_schema: checkpoint.schema_version,
    provider_job_id: String(checkpoint.provider_job_id).trim(),
    generation_receipt_schema: receiptSchema,
    generation_receipt_sha256: receiptSha256,
  };
}

async function bestEffortEvent(writeEvent, type, payload) {
  try { return await writeEvent(type, payload); } catch { return null; }
}

function completedUploadRetry(found, input = {}) {
  const job = found && found.ok === true && found.job && typeof found.job === "object"
    ? found.job
    : null;
  if (!job || job.status !== "done") return { handled: false };

  const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
  const result = job.result && typeof job.result === "object" ? job.result : {};
  const receipt = result.upload_receipt && typeof result.upload_receipt === "object"
    ? result.upload_receipt
    : {};
  const storage = receipt.storage && typeof receipt.storage === "object" ? receipt.storage : {};
  const audit = receipt.audit && typeof receipt.audit === "object" ? receipt.audit : {};
  const record = receipt.record && typeof receipt.record === "object" ? receipt.record : {};
  const rebuild = receipt.rebuild && typeof receipt.rebuild === "object" ? receipt.rebuild : null;
  const shared = receipt.shared_release && typeof receipt.shared_release === "object" ? receipt.shared_release : null;
  const durableJobId = String(job.jobId || job.job_id || "").trim();
  const durableProspectId = String(job.prospectId || job.prospect_id || "").trim();
  const durableClipSha = String(result.clip_sha256 || "").trim().toLowerCase();
  const durableUrl = normalizeHttpsUrl(result.url);
  const objectPath = String(storage.object_path || "").trim();
  const rebuildJobId = String(rebuild?.job_id || rebuild?.jobId || "").trim();
  const sharedProof = shared?.proof_identity && typeof shared.proof_identity === "object" ? shared.proof_identity : {};
  const previousProof = shared?.previous_proof_identity && typeof shared.previous_proof_identity === "object"
    ? shared.previous_proof_identity : {};
  const sharedEvidence = shared?.release_evidence && typeof shared.release_evidence === "object"
    ? shared.release_evidence : {};
  const sharedPreviewUrl = normalizeHttpsUrl(shared?.preview_url);
  const durableLineHandle = normalizeLineHandle(payload.line_handle);
  const durableHasLineHandle = Object.hasOwn(payload, "line_handle");
  const sharedLineHandle = normalizeLineHandle(shared?.line_handle);
  const sharedHasLineHandle = Boolean(shared && Object.hasOwn(shared, "line_handle"));
  const sharedPublicationValid = Boolean(shared
    && !rebuild
    && SHARED_UUID_RE.test(String(sharedProof.site_id || ""))
    && SHARED_UUID_RE.test(String(sharedProof.release_id || ""))
    && /^[0-9a-f]{64}$/i.test(String(sharedProof.build_hash || ""))
    && sharedProof.site_id === previousProof.site_id
    && SHARED_UUID_RE.test(String(previousProof.release_id || ""))
    && /^[0-9a-f]{64}$/i.test(String(previousProof.build_hash || ""))
    && sharedProof.release_id !== previousProof.release_id
    && sharedProof.build_hash !== previousProof.build_hash
    && sharedEvidence.site_id === sharedProof.site_id
    && sharedEvidence.release_id === sharedProof.release_id
    && sharedEvidence.build_hash === sharedProof.build_hash
    && sharedEvidence.evidence_schema === "shared-site-release-evidence-v1"
    && sharedEvidence.state === "active"
    && Number.isSafeInteger(Number(sharedEvidence.generation))
    && Number(sharedEvidence.generation) >= 1
    && Number(sharedEvidence.route_generation) === Number(sharedEvidence.generation)
    && /^[a-z0-9-]+\.wss-ai\.com$/i.test(String(sharedEvidence.canonical_host || ""))
    && String(sharedEvidence.manifest_path || "") === `sites/${sharedProof.site_id}/releases/${sharedProof.release_id}/manifest.json`
    && /^[0-9a-f]{64}$/i.test(String(sharedEvidence.manifest_sha256 || ""))
    && sharedEvidence.hero_video_path === shared.hero_video_path
    && String(sharedEvidence.hero_video_sha256 || "").toLowerCase() === durableClipSha
    && sharedPreviewUrl
    && new URL(sharedPreviewUrl).hostname === sharedEvidence.canonical_host
    && /^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.mp4$/.test(String(shared.hero_video_path || ""))
    && String(shared.hero_video_sha256 || "").toLowerCase() === durableClipSha
    && String(shared.record_write_id || "").trim()
    && String(shared.record_write_id || "").trim() === String(record.write_id || "").trim()
    && (!durableHasLineHandle || durableLineHandle)
    && durableHasLineHandle === sharedHasLineHandle
    && (!durableLineHandle || (
      durableLineHandle.batchId === sharedLineHandle?.batchId
      && durableLineHandle.rowId === sharedLineHandle?.rowId
    )));
  const legacyPublicationValid = Boolean(!shared
    && rebuildJobId
    && rebuildJobId.length <= 240
    && !/[\u0000-\u001f\u007f]/.test(rebuildJobId));
  const attribution = durableHeroAttribution(job);

  // A done row is terminal. Never fall through to publication writes when its
  // private completion proof does not match this retry byte-for-byte.
  if (
    !attribution.ok
    || durableJobId !== input.jobId
    || durableProspectId !== input.prospectId
    || !result.settled_by_lease
    || !safeTokenEqual(result.settled_by_lease, input.leaseToken)
    || result.action !== "complete"
    || result.completed_by !== "verified_upload"
    || durableClipSha !== input.clip.sha256
    || !durableUrl
    || !/\.mp4(?:[?#]|$)/i.test(durableUrl)
    || String(storage.sha256 || "").trim().toLowerCase() !== durableClipSha
    || !objectPath.endsWith(`/${durableClipSha}.mp4`)
    || audit.type !== "hero_clip.asset_stored"
    || String(record.prospect_id || "").trim() !== durableProspectId
    || (!sharedPublicationValid && !legacyPublicationValid)
    || (attribution.producer === WAN_PRODUCER && (
      String(receipt.producer || "") !== attribution.producer
      || String(receipt.generator || "") !== attribution.generator
      || String(receipt.source || "") !== attribution.source
    ))
    || (receipt.producer && String(receipt.producer) !== attribution.producer)
    || (receipt.generator && String(receipt.generator) !== attribution.generator)
    || (receipt.source && String(receipt.source) !== attribution.source)
  ) {
    return { handled: true, ok: false, error: "completed_upload_retry_mismatch" };
  }

  const approval = validateDurableClipApproval(
    input.fields,
    payload.approved_clip,
    input.clip.sha256,
    { now: () => input.now.getTime() },
  );
  const owned = findOwnedSource(
    { photo_bank: payload.photo_bank },
    { sha256: input.sourceSha256, url: input.sourceUrl },
  );
  const remaster = validateDurableRemasterArtifact(
    input.fields,
    payload.approved_artifact,
    {
      sourceSha256: owned.ok ? owned.sha256 : input.sourceSha256,
      sourceUrl: owned.ok ? owned.url : input.sourceUrl,
      clipSha256: input.clip.sha256,
      producer: attribution.producer,
      durationSeconds: payload.duration_seconds,
      clipDurationSeconds: input.clip.durationSec,
    },
  );
  if (
    !approval.ok
    || !owned.ok
    || !remaster.ok
    || remaster.generator !== attribution.actualGenerator
    || remaster.wanFallback !== attribution.wanFallback
    || (attribution.producer === WAN_PRODUCER
      && !stableValueEqual(receipt.generation_receipt, remaster.generationReceipt))
  ) {
    return { handled: true, ok: false, error: "completed_upload_retry_mismatch" };
  }

  return {
    handled: true,
    ok: true,
    durable: {
      url: durableUrl,
      sourceSha256: owned.sha256,
      approval,
      remaster,
      attribution,
      rebuildJobId,
      sharedRelease: sharedPublicationValid ? {
        previewUrl: sharedPreviewUrl,
        proofIdentity: { ...sharedProof },
        previousProofIdentity: { ...previousProof },
        heroVideoPath: String(shared.hero_video_path),
        heroVideoSha256: String(shared.hero_video_sha256).toLowerCase(),
        releaseEvidence: { ...sharedEvidence },
        ...(sharedLineHandle ? { lineHandle: sharedLineHandle } : {}),
      } : null,
    },
  };
}

function terminalSuccessBody({
  prospectId,
  jobId,
  url,
  clip,
  sourceSha256,
  approval,
  attribution,
  rebuildJobId,
  sharedRelease = null,
  reused = false,
}) {
  const shared = sharedRelease && typeof sharedRelease === "object" ? sharedRelease : null;
  return {
    ok: true,
    terminal: true,
    job_status: "done",
    queued: !shared,
    ...(reused ? { reused: true } : {}),
    prospect_id: prospectId,
    job_id: jobId,
    url,
    producer: attribution.producer,
    generator: attribution.generator,
    composed_from: [sourceSha256],
    clip_sha256: clip.sha256,
    bytes: clip.bytes,
    duration_sec: clip.durationSec,
    width: clip.width,
    height: clip.height,
    codec: clip.codec,
    source: attribution.source,
    verified: true,
    approved: true,
    approved_by: approval.approvedBy,
    approved_at: approval.approvedAt,
    retention: { class: "approved_durable", expires_at: null },
    ...(shared ? {
      shared_release_activated: true,
      preview_url: shared.previewUrl,
      proof_identity: shared.proofIdentity,
      previous_proof_identity: shared.previousProofIdentity,
    } : {
      rebuild_queued: true,
      rebuild_job_id: rebuildJobId,
    }),
  };
}

function createHeroClipUploadHandler(overrides = {}) {
  const injectedLease = Object.prototype.hasOwnProperty.call(overrides, "validateHeroReelJobLease");
  const injectedEnqueue = Object.prototype.hasOwnProperty.call(overrides, "enqueueRebuildJob");
  const deps = {
    auth: overrides.requireHeroWorker || requireHeroWorker,
    select: overrides.select || select,
    upload: overrides.uploadProofShot || uploadProofShot,
    publicUrl: overrides.publicProofUrl || publicProofUrl,
    patch: overrides.patchHeroReel || patchHeroReel,
    enqueue: overrides.enqueueRebuildJob || enqueueRebuildJob,
    kick: overrides.kickRebuildJob || (injectedEnqueue
      ? (() => {})
      : ((jobId) => {
        runRebuildJob(jobId).catch(() => { /* the rebuild cron owns recovery */ });
      })),
    environment: overrides.environment || process.env,
    validateLease: overrides.validateHeroReelJobLease || validateHeroReelJobLease,
    validateCapabilityLease: overrides.validateHeroReelJobCapabilityLease || validateHeroReelJobCapabilityLease,
    complete: overrides.completeHeroReelJobAfterUpload || completeHeroReelJobAfterUpload,
    // Unit seams that replace lease storage must also replace the companion
    // durable read. Production uses the real queue implementation.
    getJob: overrides.getHeroReelJob || (injectedLease ? null : getHeroReelJob),
    event: overrides.recordEvent || recordEvent,
    now: overrides.now || (() => new Date()),
    readMultipart: overrides.readMultipart || readMultipart,
    injectSharedHero: overrides.injectSharedSiteHero || injectSharedSiteHero,
    persistSharedRelease: overrides.persistSharedHeroRelease || persistSharedHeroRelease,
    conditionalUpdate: overrides.conditionalUpdate || conditionalUpdate,
    sharedPublisher: overrides.sharedPublisher || null,
    sharedReleaseLoader: overrides.sharedReleaseLoader || null,
    sharedRuntime: overrides.sharedRuntime || (() => createDefaultSharedHeroRuntime({ env: overrides.environment || process.env })),
    wake: overrides.wakeLineForCompletedHero || wakeLineForCompletedHero,
  };

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    const capabilityLeaseToken = requestHeroJobLease(req);
    if (capabilityLeaseToken && requestWorkerToken(req)) {
      return sendJson(res, 400, { ok: false, error: "capability_auth_ambiguous" });
    }
    if (!capabilityLeaseToken && !deps.auth(req, res)) return;

    try {
      const parsed = await deps.readMultipart(req, { maxBytes: MAX_MULTIPART_BYTES });
      if (!parsed || parsed.ok !== true) {
        sendJson(res, parsed?.status || 400, { ok: false, error: parsed?.error || "multipart_parse_failed" });
        return;
      }

      const fields = parsed.fields || {};
      const file = parsed.file;
      const prospectId = field(fields, "prospect_id");
      const jobId = field(fields, "job_id");
      const leaseToken = field(fields, "lease_token");
      const sourceSha256 = field(fields, "source_sha256").toLowerCase();
      const sourceUrl = field(fields, "source_url");

      if (!prospectId) return sendJson(res, 400, { ok: false, error: "prospect_id_required" });
      if (!jobId) return sendJson(res, 400, { ok: false, error: "job_id_required" });
      if (!leaseToken) return sendJson(res, 400, { ok: false, error: "lease_token_required" });
      if (!file || file.fieldName !== "clip") return sendJson(res, 400, { ok: false, error: "clip_file_required" });
      if (String(file.contentType || "").toLowerCase() !== "video/mp4" || !/\.mp4$/i.test(String(file.name || ""))) {
        return sendJson(res, 415, { ok: false, error: "mp4_required" });
      }

      const transportedApproval = validateApproval(fields, { now: () => deps.now().getTime() });
      if (!transportedApproval.ok) return sendJson(res, 403, { ok: false, error: transportedApproval.reason });

      const clip = validateHeroClip(file.bytes, { minAspect: 0.5, maxAspect: 4.0 });
      if (!clip.ok) {
        const status = clip.reason === "clip_too_large" ? 413 : 422;
        return sendJson(res, status, { ok: false, error: clip.reason, ...(clip.detail ? { detail: clip.detail } : {}) });
      }

      let capabilityLease = null;
      if (capabilityLeaseToken) {
        if (!safeTokenEqual(capabilityLeaseToken, leaseToken)) {
          return sendJson(res, 409, { ok: false, error: "capability_lease_conflict" });
        }
        try {
          capabilityLease = await deps.validateCapabilityLease({
            jobId,
            leaseToken,
            phase: "upload",
            approvedSha256: clip.sha256,
          });
        } catch {
          capabilityLease = null;
        }
        if (
          !capabilityLease
          || capabilityLease.ok !== true
          || capabilityLease.job?.prospectId !== prospectId
          || capabilityLease.job?.producer !== OPENROUTER_SEEDANCE_PRODUCER
        ) {
          return sendJson(res, 409, { ok: false, error: "capability_lease_conflict" });
        }
      }

      // The first request may have completed every durable write while its HTTP
      // response was lost. Recognize only the private queue receipt created by
      // that exact lease and exact approved provenance chain, before repeating
      // storage, audit, record patch, or rebuild work.
      if (typeof deps.getJob === "function") {
        let durable;
        try { durable = await deps.getJob(jobId); } catch { durable = null; }
        const retry = completedUploadRetry(durable, {
          jobId,
          leaseToken,
          prospectId,
          clip,
          sourceSha256,
          sourceUrl,
          fields,
          now: deps.now(),
        });
        if (retry.handled) {
          if (!retry.ok) return sendJson(res, 409, { ok: false, error: retry.error });
          if (!retry.durable.sharedRelease && heroRebuildKickEnabled(deps.environment)) {
            try { deps.kick(retry.durable.rebuildJobId); } catch { /* cron recovery */ }
          }
          if (retry.durable.sharedRelease?.lineHandle) {
            try { await deps.wake(prospectId, retry.durable.sharedRelease.lineHandle); } catch { /* cron recovery */ }
          }
          return sendJson(res, 202, terminalSuccessBody({
            prospectId,
            jobId,
            url: retry.durable.url,
            clip,
            sourceSha256: retry.durable.sourceSha256,
            approval: retry.durable.approval,
            attribution: retry.durable.attribution,
            rebuildJobId: retry.durable.rebuildJobId,
            sharedRelease: retry.durable.sharedRelease,
            reused: true,
          }));
        }
      }

      const found = await deps.select(
        "ghost_agency_prospects",
        `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
      ).catch(() => null);
      if (!found || found.ok !== true) return sendJson(res, 503, { ok: false, error: "prospect_store_unavailable" });
      const row = Array.isArray(found.data) ? found.data[0] : null;
      if (!row) return sendJson(res, 404, { ok: false, error: "prospect_not_found" });

      const owned = findOwnedSource(row.record || {}, { sha256: sourceSha256, url: sourceUrl });
      if (!owned.ok) return sendJson(res, 409, { ok: false, error: owned.reason });

      const posterRaw = field(fields, "poster_url");
      let posterUrl = "";
      if (posterRaw) {
        posterUrl = normalizeHttpsUrl(posterRaw);
        // A poster is also a customer-facing asset. The only poster this route
        // can prove is the same owned source photograph.
        if (!posterUrl || posterUrl !== owned.url) {
          return sendJson(res, 409, { ok: false, error: "poster_url_not_owned" });
        }
      }

      if (typeof deps.validateLease !== "function") {
        return sendJson(res, 503, { ok: false, error: "hero_reel_job_queue_unavailable" });
      }
      let lease = capabilityLease;
      if (!lease) {
        try {
          lease = await deps.validateLease({ jobId, leaseToken, prospectId });
        } catch {
          lease = null;
        }
      }
      if (!lease || lease.ok !== true) {
        return sendJson(res, 409, { ok: false, error: String(lease?.error || lease?.reason || "hero_reel_job_lease_invalid") });
      }
      const attribution = durableHeroAttribution(lease.job);
      if (!attribution.ok) return sendJson(res, 409, { ok: false, error: attribution.reason });
      if (attribution.producer === OPENROUTER_SEEDANCE_PRODUCER && clip.audioTrackCount > 0) {
        return sendJson(res, 422, { ok: false, error: "clip_audio_forbidden" });
      }
      const approval = validateDurableClipApproval(
        fields,
        lease?.job?.payload?.approved_clip,
        clip.sha256,
        { now: () => deps.now().getTime() },
      );
      if (!approval.ok) return sendJson(res, 409, { ok: false, error: approval.reason });
      const claimedOwned = findOwnedSource(
        { photo_bank: lease?.job?.payload?.photo_bank },
        { sha256: sourceSha256, url: sourceUrl },
      );
      if (!claimedOwned.ok) {
        return sendJson(res, 409, { ok: false, error: "source_not_in_claimed_job", reason: claimedOwned.reason });
      }
      const remaster = validateDurableRemasterArtifact(
        fields,
        lease?.job?.payload?.approved_artifact,
        {
          sourceSha256: owned.sha256,
          sourceUrl: owned.url,
          clipSha256: clip.sha256,
          producer: attribution.producer,
          durationSeconds: lease?.job?.payload?.duration_seconds,
          clipDurationSeconds: clip.durationSec,
        },
      );
      if (!remaster.ok) return sendJson(res, 409, { ok: false, error: remaster.reason });
      if (
        remaster.generator !== attribution.actualGenerator
        || remaster.wanFallback !== attribution.wanFallback
      ) return sendJson(res, 409, { ok: false, error: "durable_hero_attribution_mismatch" });

      // Shared markers select one fail-closed path. A partial or forged tuple
      // may never fall through to a second legacy Vercel deployment.
      const sharedSelection = sharedHeroInjectionEnabled(deps.environment)
        ? sharedHeroEvidenceFromRow(row)
        : { selected: false };
      if (sharedSelection.selected && sharedSelection.ok !== true) {
        return sendJson(res, 409, { ok: false, error: sharedSelection.reason || "shared_hero_evidence_invalid" });
      }

      // The object name is content-addressed. Approved clips do not expire,
      // and new bytes get a new CDN path instead of overwriting stale edges.
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
        await bestEffortEvent(deps.event, "hero_clip.upload_refused", {
          prospect_id: prospectId, job_id: jobId, stage: "storage", reason: String(uploaded?.reason || "storage_write_failed"),
        });
        return sendJson(res, 502, { ok: false, error: "storage_write_failed" });
      }

      const url = String(uploaded.publicUrl || deps.publicUrl(objectPath) || "");
      if (!/^https:\/\//i.test(url) || !/\.mp4(?:[?#]|$)/i.test(url)) {
        return sendJson(res, 502, { ok: false, error: "storage_public_url_invalid" });
      }

      // Persist the complete asset audit independently of the prospect record.
      // The prospect record itself is written ONLY by patchHeroReel below.
      const retention = { class: "approved_durable", expires_at: null };
      const assetAudit = {
        prospect_id: prospectId,
        job_id: jobId,
        url,
        object_path: objectPath,
        sha256: clip.sha256,
        bytes: clip.bytes,
        duration_sec: clip.durationSec,
        width: clip.width,
        height: clip.height,
        codec: clip.codec,
        source: attribution.source,
        producer: attribution.producer,
        generator: attribution.generator,
        verified: true,
        source_sha256: owned.sha256,
        source_url: owned.url,
        optimized_sha256: remaster.optimizedSha256,
        optimized_asset_fingerprint: remaster.optimizedAssetFingerprint,
        prompt_sha256: remaster.promptSha256,
        ...(remaster.generationReceipt || {}),
        approved: true,
        approved_by: approval.approvedBy,
        approved_at: approval.approvedAt,
        retention,
      };
      const audited = await bestEffortEvent(deps.event, "hero_clip.asset_stored", assetAudit);
      if (!writeSucceeded(audited)) {
        return sendJson(res, 503, { ok: false, error: "asset_audit_persist_failed", url, sha256: clip.sha256 });
      }

      const composedAt = deps.now().toISOString();
      const reelProvenance = durableReelProvenance(
        lease.job,
        attribution,
        clip.sha256,
        remaster.generationReceipt,
      );
      if (attribution.producer === OPENROUTER_SEEDANCE_PRODUCER && !reelProvenance) {
        await bestEffortEvent(deps.event, "hero_clip.upload_refused", {
          prospect_id: prospectId, job_id: jobId, stage: "provenance", reason: "seedance_provenance_missing", url,
        });
        return sendJson(res, 409, { ok: false, error: "seedance_provenance_missing" });
      }
      const reel = {
        url,
        generator: attribution.generator,
        composed_from: [owned.sha256],
        composed_at: composedAt,
        ...(reelProvenance ? { provenance: reelProvenance } : {}),
        ...(posterUrl ? { poster_url: posterUrl } : {}),
      };
      let patched;
      try { patched = await deps.patch(prospectId, reel); } catch (error) {
        patched = { ok: false, reason: String(error?.message || error) };
      }
      if (!patched || patched.ok !== true) {
        await bestEffortEvent(deps.event, "hero_clip.upload_refused", {
          prospect_id: prospectId, job_id: jobId, stage: "record_patch", reason: String(patched?.reason || "persist_failed"), url,
        });
        return sendJson(res, 503, { ok: false, error: "hero_reel_persist_failed", reason: String(patched?.reason || "persist_failed"), url });
      }

      let rebuild = null;
      let sharedRelease = null;
      let sharedProofWrite = null;
      const lineHandle = normalizeLineHandle(lease?.job?.payload?.line_handle);
      if (sharedSelection.selected) {
        const runtime = deps.sharedPublisher && deps.sharedReleaseLoader
          ? null
          : deps.sharedRuntime();
        try {
          sharedRelease = await deps.injectSharedHero({
            row,
            operationKey: jobId,
            asset: {
              bytes: file.bytes,
              url,
              sha256: clip.sha256,
              source_sha256: owned.sha256,
              verified: true,
              approved: true,
              approved_by: approval.approvedBy,
              approved_at: approval.approvedAt,
              retention,
            },
          }, {
            publisher: deps.sharedPublisher || runtime?.publisher,
            loader: deps.sharedReleaseLoader || runtime?.loader,
          });
        } catch (error) {
          sharedRelease = { ok: false, reason: String(error?.message || error), fallback: false };
        }
        if (!sharedRelease || sharedRelease.ok !== true) {
          await bestEffortEvent(deps.event, "hero_clip.upload_refused", {
            prospect_id: prospectId, job_id: jobId, stage: "shared_release", reason: String(sharedRelease?.reason || "shared_hero_publish_failed"), url,
          });
          return sendJson(res, 503, {
            ok: false,
            error: "shared_hero_publish_failed",
            reason: String(sharedRelease?.reason || "shared_hero_publish_failed"),
            persisted: true,
            legacy_rebuild_queued: false,
            url,
          });
        }
        try {
          sharedProofWrite = await deps.persistSharedRelease({
            prospectId,
            previousSelection: sharedSelection,
            sharedRelease,
          }, {
            select: deps.select,
            conditionalUpdate: deps.conditionalUpdate,
            now: () => deps.now().toISOString(),
          });
        } catch (error) {
          sharedProofWrite = { ok: false, reason: String(error?.message || error) };
        }
        if (!sharedProofWrite || sharedProofWrite.ok !== true) {
          await bestEffortEvent(deps.event, "hero_clip.upload_refused", {
            prospect_id: prospectId,
            job_id: jobId,
            stage: "shared_release_record",
            reason: String(sharedProofWrite?.reason || "shared_hero_proof_persist_failed"),
            url,
          });
          return sendJson(res, 503, {
            ok: false,
            error: "shared_hero_proof_persist_failed",
            reason: String(sharedProofWrite?.reason || "shared_hero_proof_persist_failed"),
            persisted: true,
            shared_release_activated: true,
            legacy_rebuild_queued: false,
            url,
          });
        }
        patched = {
          ...patched,
          write_id: String(sharedProofWrite.write_id || patched.write_id || ""),
          shared_release_proof_persisted: true,
        };
      } else {
        try {
          rebuild = await deps.enqueue({
            prospectId,
            actor: "hero_clip_upload",
            heroJobId: jobId,
            heroClipSha256: clip.sha256,
            ...(lineHandle ? { lineHandle } : {}),
          });
        } catch (error) {
          rebuild = { ok: false, error: String(error?.message || error) };
        }
        if (!rebuild || rebuild.ok !== true) {
          await bestEffortEvent(deps.event, "hero_clip.upload_refused", {
            prospect_id: prospectId, job_id: jobId, stage: "rebuild_enqueue", reason: String(rebuild?.error || "rebuild_queue_unavailable"), url,
          });
          return sendJson(res, 503, {
            ok: false,
            error: "rebuild_enqueue_failed",
            reason: String(rebuild?.error || "rebuild_queue_unavailable"),
            persisted: true,
            url,
          });
        }
      }

      // Only the server can declare this job complete. The worker can upload
      // bytes, but it cannot turn its own claim into a terminal truth. This
      // settlement is after every durable write and uses a receipt built from
      // server-observed results, never from worker-supplied success fields.
      let terminal;
      try {
        terminal = await deps.complete({
          jobId,
          leaseToken,
          receipt: {
            clip_sha256: clip.sha256,
            url,
            producer: attribution.producer,
            generator: attribution.generator,
            source: attribution.source,
            ...(remaster.generationReceipt
              ? { generation_receipt: remaster.generationReceipt }
              : {}),
            storage: {
              object_path: objectPath,
              sha256: clip.sha256,
              write_id: String(uploaded.write_id || uploaded.id || ""),
            },
            audit: {
              type: "hero_clip.asset_stored",
              write_id: String(audited?.event_id || audited?.id || audited?.write_id || ""),
            },
            record: {
              prospect_id: prospectId,
              write_id: String(patched.write_id || patched.id || ""),
            },
            ...(sharedRelease ? {
              shared_release: {
                preview_url: sharedRelease.previewUrl,
                proof_identity: sharedRelease.proofIdentity,
                previous_proof_identity: sharedRelease.previousProofIdentity,
                release_evidence: sharedRelease.releaseEvidence,
                hero_video_path: sharedRelease.heroVideoPath,
                hero_video_sha256: sharedRelease.heroVideoSha256,
                record_write_id: String(sharedProofWrite?.write_id || ""),
                ...(lineHandle ? { line_handle: lineHandle } : {}),
              },
            } : {
              rebuild: {
                job_id: String(rebuild.jobId || rebuild.job_id || ""),
                ...(lineHandle ? { line_handle: lineHandle } : {}),
              },
            }),
          },
        });
      } catch (error) {
        terminal = { ok: false, error: String(error?.message || error) };
      }
      if (!terminal || terminal.ok !== true) {
        await bestEffortEvent(deps.event, "hero_clip.upload_refused", {
          prospect_id: prospectId,
          job_id: jobId,
          stage: "terminal_settle",
          reason: String(terminal?.error || "terminal_settle_failed"),
          url,
        });
        return sendJson(res, 503, {
          ok: false,
          error: "terminal_settle_failed",
          reason: String(terminal?.error || "terminal_settle_failed"),
          persisted: true,
          rebuild_queued: !sharedRelease,
          shared_release_activated: Boolean(sharedRelease),
          url,
        });
      }

      // Durable first, then direct pickup. The rebuild cron remains the
      // sweeper if this best-effort kick is lost to a serverless freeze.
      if (!sharedRelease && heroRebuildKickEnabled(deps.environment)) {
        try { deps.kick(String(rebuild.jobId || rebuild.job_id || "")); } catch { /* cron recovery */ }
      }
      if (sharedRelease && lineHandle) {
        try { await deps.wake(prospectId, lineHandle); } catch { /* cron recovery */ }
      }

      sendJson(res, 202, terminalSuccessBody({
        prospectId,
        jobId,
        url,
        clip,
        sourceSha256: owned.sha256,
        approval,
        attribution,
        rebuildJobId: rebuild ? String(rebuild.jobId || rebuild.job_id || "") : "",
        sharedRelease,
      }));
    } catch (error) {
      handleError(res, error, "hero_clip_upload_failed");
    }
  };
}

/**
 * Dependency-free, bounded multipart reader for one MP4 plus small text fields.
 * It stops retaining chunks the instant the body crosses the cap.
 */
function readMultipart(req, { maxBytes = MAX_MULTIPART_BYTES } = {}) {
  return new Promise((resolve) => {
    const contentType = String(req.headers?.["content-type"] || "");
    const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
    if (!match) return resolve({ ok: false, error: "multipart_required", status: 400 });
    const declared = Number(req.headers?.["content-length"] || 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      if (typeof req.resume === "function") req.resume();
      return resolve({ ok: false, error: "request_too_large", status: 413 });
    }

    const boundary = Buffer.from(`--${match[1] || match[2]}`);
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const onData = (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.off("data", onData);
        req.off("end", onEnd);
        req.off("error", onError);
        req.off("aborted", onError);
        if (typeof req.resume === "function") req.resume();
        finish({ ok: false, error: "request_too_large", status: 413 });
        return;
      }
      chunks.push(Buffer.from(chunk));
    };
    const onError = () => finish({ ok: false, error: "request_read_failed", status: 400 });
    const onEnd = () => {
      try {
        const body = Buffer.concat(chunks, total);
        const fields = Object.create(null);
        let file = null;
        let cursor = body.indexOf(boundary);
        while (cursor >= 0) {
          const next = body.indexOf(boundary, cursor + boundary.length);
          if (next < 0) break;
          let partStart = cursor + boundary.length;
          if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;
          let partEnd = next;
          if (partEnd >= 2 && body[partEnd - 2] === 13 && body[partEnd - 1] === 10) partEnd -= 2;
          const part = body.subarray(partStart, partEnd);
          const split = part.indexOf("\r\n\r\n");
          if (split >= 0) {
            const head = part.subarray(0, split).toString("latin1");
            const value = part.subarray(split + 4);
            const nameMatch = /(?:^|;)\s*name="([^"]+)"/i.exec(head);
            const fileMatch = /(?:^|;)\s*filename="([^"]*)"/i.exec(head);
            const typeMatch = /(?:^|\r\n)content-type:\s*([^\r\n]+)/i.exec(head);
            if (nameMatch) {
              const name = nameMatch[1];
              if (fileMatch) {
                if (file) return finish({ ok: false, error: "one_clip_only", status: 400 });
                file = {
                  fieldName: name,
                  name: fileMatch[1],
                  contentType: typeMatch ? typeMatch[1].trim() : "",
                  bytes: Buffer.from(value),
                };
              } else {
                if (Object.prototype.hasOwnProperty.call(fields, name)) {
                  return finish({ ok: false, error: `duplicate_field:${name}`, status: 400 });
                }
                fields[name] = value.toString("utf8");
              }
            }
          }
          cursor = next;
        }
        if (!file) return finish({ ok: false, error: "clip_file_required", status: 400 });
        if (file.bytes.length > MAX_CLIP_BYTES) return finish({ ok: false, error: "clip_too_large", status: 413 });
        finish({ ok: true, fields, file, bytesRead: total });
      } catch {
        finish({ ok: false, error: "multipart_parse_failed", status: 400 });
      }
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onError);
  });
}

const handler = createHeroClipUploadHandler();
module.exports = handler;
module.exports.handler = handler;
module.exports.createHeroClipUploadHandler = createHeroClipUploadHandler;
module.exports.readMultipart = readMultipart;
module.exports.writeSucceeded = writeSucceeded;
module.exports.completedUploadRetry = completedUploadRetry;
module.exports.terminalSuccessBody = terminalSuccessBody;
module.exports.heroRebuildKickEnabled = heroRebuildKickEnabled;
module.exports.durableHeroAttribution = durableHeroAttribution;
module.exports.persistSharedHeroRelease = persistSharedHeroRelease;
module.exports.persistedSharedReleaseMatches = persistedSharedReleaseMatches;
module.exports.signMirrorEvidence = signMirrorEvidence;
module.exports.MAX_MULTIPART_BYTES = MAX_MULTIPART_BYTES;
