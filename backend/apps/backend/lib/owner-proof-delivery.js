"use strict";

const { createHash } = require("node:crypto");
const { ownerProofIdempotencyKey } = require("./line-delivery");
const { deliveryProofIdentity } = require("./line-email-assets");
const { verifyEvidence } = require("./mirror-engine/evidence-signature");
const { PROOF_SENT_EVENT_TYPE } = require("./prospect-detail");
const { normalizeProofUrl } = require("./proof-storage");
const { sanitizePreviewUrl } = require("./preview-host-guard");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("./mirror-engine-contract");

const EVENTS = "ghost_agency_events";
const CLAIM_TYPE = "operator.owner_proof_claim";
const LINE_SENDABLE = new Set(["ready", "queued", "sent"]);
const CLAIM_STALE_MS = 5 * 60 * 1000;
const SHARED_RELEASE_EVIDENCE_SCHEMA = "shared-site-release-evidence-v1";
const CLAIM_EVENT_STATUSES = new Set([
  "claimed",
  "reconciliation_required",
  "refused",
  "system_hold",
]);
const PRE_PROVIDER_TRANSIENT = new Set([
  "contact_verdict_unavailable",
  "outreach_sender_not_ready",
  "owner_proof_deadline_exhausted",
  "owner_proof_deadline_expired",
  "resend_not_configured",
  "resend_webhook_not_configured",
  "suppression_check_unavailable",
]);

function text(value) {
  return String(value == null ? "" : value).trim();
}

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function ownerFingerprint(owner) {
  const normalized = text(owner).toLowerCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

function previewHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function proofSource(value) {
  const source = objectOf(value);
  return text(source.site_id) && text(source.release_id) ? source : null;
}

/**
 * Owner proof is keyed to the immutable build, not to whichever mutable Line
 * batch happens to surface it. Re-queuing the same prospect/build in a later
 * batch therefore reads the first durable receipt instead of sending again.
 */
function ownerProofOperationKey(identity, owner) {
  const buildHash = text(identity?.buildHash).toLowerCase();
  const proof = deliveryProofIdentity({ sources: [identity?.proofIdentity], buildHash });
  if (!text(identity?.batchId)
    || !text(identity?.prospectId)
    || !sanitizePreviewUrl(identity?.previewUrl)
    || !proof.ok
    || !proof.active
    || !proof.proofIdentity) return "";
  return ownerProofIdempotencyKey({
    ...identity,
    batchId: `canonical-build:${buildHash}`,
    releaseId: proof.proofIdentity.release_id,
    previewUrl: identity.previewUrl,
    recipient: owner,
  });
}

function lineReleaseInput(payload, previewUrl) {
  const buildEvidence = objectOf(payload.buildEvidence || payload.build_evidence);
  const releaseEvidence = objectOf(
    payload.releaseEvidence
    || payload.release_evidence
    || buildEvidence.release_evidence,
  );
  const buildHash = text(
    payload.buildHash
    || payload.build_hash
    || buildEvidence.build_hash
    || releaseEvidence.build_hash,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(buildHash) || !Object.keys(releaseEvidence).length) return null;
  if (releaseEvidence.renderer !== MIRROR_ENGINE_RENDERER
    || releaseEvidence.qc_contract !== MIRROR_ENGINE_QC_CONTRACT
    || releaseEvidence.evidence_schema !== MIRROR_ENGINE_EVIDENCE_SCHEMA
    || releaseEvidence.revealable !== true
    || releaseEvidence.build_hash !== buildHash
    || sanitizePreviewUrl(releaseEvidence.preview_url) !== sanitizePreviewUrl(previewUrl)
    || text(buildEvidence.renderer || releaseEvidence.renderer) !== MIRROR_ENGINE_RENDERER
    || text(buildEvidence.qc_contract || releaseEvidence.qc_contract) !== MIRROR_ENGINE_QC_CONTRACT
    || text(buildEvidence.evidence_schema || releaseEvidence.evidence_schema) !== MIRROR_ENGINE_EVIDENCE_SCHEMA
    || text(buildEvidence.evidence_sha || releaseEvidence.evidence_sha) !== text(releaseEvidence.evidence_sha)) return null;
  if (!verifyEvidence(releaseEvidence)) return null;

  // The signed manifest, its shared-release receipt, and the durable Line row
  // must all name the same deployment. A checksum-only/legacy release without
  // site_id + release_id is display history, never send authorization.
  const lineProof = proofSource(payload.proofIdentity || payload.proof_identity);
  const manifestProof = proofSource(releaseEvidence.proofIdentity || releaseEvidence.proof_identity);
  const sharedRelease = proofSource(
    releaseEvidence.sharedReleaseEvidence || releaseEvidence.shared_release_evidence,
  );
  if (!lineProof || !manifestProof || !sharedRelease) return null;
  const proof = deliveryProofIdentity({
    sources: [lineProof, manifestProof, sharedRelease],
    buildHash,
  });
  if (!proof.ok || !proof.active || !proof.proofIdentity) return null;
  if (sharedRelease.evidence_schema !== SHARED_RELEASE_EVIDENCE_SCHEMA
    || text(sharedRelease.state).toLowerCase() !== "active"
    || text(sharedRelease.canonical_host).toLowerCase() !== previewHost(previewUrl).toLowerCase()) return null;
  return {
    buildHash,
    releaseEvidence,
    proofIdentity: proof.proofIdentity,
    sharedReleaseEvidence: sharedRelease,
  };
}

/**
 * Resolve the one durable Line/release artifact that may authorize an owner
 * proof. Prospect state is display/contact data only; it cannot override the
 * Line status, batch, build hash, preview, or release receipt.
 */
function lineArtifactIdentity(lineRow = {}, prospect = {}, qualityCheck = null) {
  const payload = objectOf(lineRow.payload);
  const status = text(lineRow.status || payload.status).toLowerCase();
  if (!LINE_SENDABLE.has(status)) return { ok: false, reason: "line_row_not_sendable" };

  const prospectId = text(prospect.prospect_id || prospect.prospectId);
  const lineProspectId = text(payload.prospectId || payload.prospect_id || lineRow.prospect_id);
  if (!prospectId || lineProspectId !== prospectId) return { ok: false, reason: "line_prospect_identity_mismatch" };

  const linePreviewUrl = sanitizePreviewUrl(payload.previewUrl || payload.preview_url || "");
  const prospectRecord = objectOf(prospect.record);
  const prospectPreviewUrl = sanitizePreviewUrl(prospect.preview_url || prospectRecord.preview_url || "");
  if (!linePreviewUrl || !prospectPreviewUrl || linePreviewUrl !== prospectPreviewUrl) {
    return { ok: false, reason: "line_preview_identity_mismatch" };
  }

  const release = lineReleaseInput(payload, linePreviewUrl);
  if (!release) return { ok: false, reason: "line_release_evidence_invalid" };
  const dispatch = objectOf(prospectRecord.build_dispatch || prospect.build_dispatch);
  const canonicalRelease = objectOf(
    dispatch.release_evidence
    || prospectRecord.mirror_release_evidence
    || prospect.mirror_release_evidence,
  );
  const canonicalBuildHash = text(dispatch.build_hash || canonicalRelease.build_hash).toLowerCase();
  if (canonicalBuildHash !== release.buildHash
    || canonicalJson(canonicalRelease) !== canonicalJson(release.releaseEvidence)) {
    return { ok: false, reason: "line_release_canonical_mismatch" };
  }
  const checkQuality = qualityCheck || require("./email").outreachBuildQuality;
  const quality = checkQuality(prospect);
  if (!quality || quality.ok !== true) return { ok: false, reason: "release_quality_not_passed" };

  const batchId = text(lineRow.batch_id || payload.batchId || payload.batch_id);
  if (!batchId) return { ok: false, reason: "line_batch_identity_missing" };
  return {
    ok: true,
    batchId,
    prospectId,
    buildHash: release.buildHash,
    previewUrl: linePreviewUrl,
    proofIdentity: release.proofIdentity,
    sharedReleaseEvidence: release.sharedReleaseEvidence,
    status,
  };
}

function claimSucceeded(result) {
  return result?.mode === "live_write" && result?.ok !== false;
}

function claimConflict(result) {
  const code = text(result?.error?.code || result?.error?.error?.code).toUpperCase();
  return result?.status === 409 || code === "23505" || result?.error?.category === "write_conflict";
}

function claimUpdateSucceeded(result) {
  return result?.ok === true && result?.mode === "live_update" && result?.updated === true;
}

function claimStateMatchesType(claim) {
  const status = text(claim?.payload?.status).toLowerCase();
  if (status === "sent") return claim?.type === PROOF_SENT_EVENT_TYPE;
  return CLAIM_EVENT_STATUSES.has(status) && claim?.type === CLAIM_TYPE;
}

function claimMatchesOperation(claim, idempotencyKey, identity, owner) {
  const payload = objectOf(claim?.payload);
  const expectedProof = objectOf(identity?.proofIdentity);
  const expectedPreview = normalizeProofUrl(identity?.previewUrl);
  return Boolean(
    ownerProofOperationKey(identity, owner) === idempotencyKey
    && text(payload.idempotency_key) === idempotencyKey
    && text(payload.prospect_id) === text(identity?.prospectId)
    && text(payload.build_hash).toLowerCase() === text(identity?.buildHash).toLowerCase()
    && text(payload.release_id) === text(expectedProof.release_id)
    && text(payload.site_id) === text(expectedProof.site_id)
    && normalizeProofUrl(payload.preview_url) === expectedPreview
    && text(payload.recipient_fingerprint).toLowerCase() === ownerFingerprint(owner)
  );
}

async function readClaim(idempotencyKey, identity, owner, deps) {
  const result = await deps.select(
    EVENTS,
    `?select=type,payload,created_at&svix_id=eq.${encodeURIComponent(idempotencyKey)}&type=in.(${CLAIM_TYPE},${PROOF_SENT_EVENT_TYPE})&limit=1`,
  ).catch(() => null);
  if (!result || result.ok !== true || !Array.isArray(result.data)) {
    return { ok: false, reason: "owner_proof_claim_read_unavailable" };
  }
  const claim = result.data[0] || null;
  if (!claim) return { ok: true, claim: null };
  if (!claimStateMatchesType(claim)) {
    return { ok: false, reason: "owner_proof_claim_type_status_mismatch" };
  }
  if (!claimMatchesOperation(claim, idempotencyKey, identity, owner)) {
    return { ok: false, reason: "owner_proof_claim_identity_mismatch" };
  }
  return { ok: true, claim };
}

function replayFromClaim(claim, idempotencyKey, now = new Date(), identity = null, owner = "") {
  const payload = objectOf(claim?.payload);
  const status = text(payload.status).toLowerCase();
  if (!claimStateMatchesType(claim) || text(payload.idempotency_key) !== idempotencyKey) return null;
  if (!identity || !claimMatchesOperation(claim, idempotencyKey, identity, owner)) return null;
  if (status === "sent" && text(payload.provider_receipt)) {
    return {
      ok: true,
      replay: true,
      idempotencyKey,
      receipt: {
        ok: true,
        mode: "sent",
        id: text(payload.provider_receipt),
        idempotencyKey,
        acceptedAt: text(payload.accepted_at),
      },
    };
  }
  if (status === "claimed") {
    const claimedAt = Date.parse(text(payload.claimed_at || claim?.created_at));
    if (Number.isFinite(claimedAt) && now.getTime() - claimedAt >= CLAIM_STALE_MS) {
      return {
        ok: false,
        reason: "owner_proof_reconciliation_required",
        idempotencyKey,
        manualReconciliationRequired: true,
        providerAttempted: false,
      };
    }
    return { ok: false, reason: "owner_proof_in_flight", idempotencyKey, providerAttempted: false };
  }
  if (status === "reconciliation_required") {
    return {
      ok: false,
      reason: "owner_proof_reconciliation_required",
      idempotencyKey,
      manualReconciliationRequired: true,
      providerAttempted: false,
    };
  }
  if (status === "system_hold" && payload.retryable === true && payload.provider_attempted !== true) {
    return {
      ok: false,
      reason: text(payload.reason || "owner_proof_system_unavailable"),
      idempotencyKey,
      retryable: true,
      disposition: "system_hold",
      providerAttempted: false,
      resumable: true,
    };
  }
  if (status === "refused") {
    return {
      ok: false,
      reason: text(payload.reason || "owner_proof_refused"),
      idempotencyKey,
      providerAttempted: false,
      replay: true,
    };
  }
  return null;
}

function claimPayloadFor(identity, owner, idempotencyKey, now) {
  return {
    status: "claimed",
    idempotency_key: idempotencyKey,
    prospect_id: identity.prospectId,
    batch_id: identity.batchId,
    build_hash: identity.buildHash,
    preview_url: normalizeProofUrl(identity.previewUrl),
    site_id: text(identity.proofIdentity?.site_id),
    release_id: text(identity.proofIdentity?.release_id),
    recipient_fingerprint: ownerFingerprint(owner),
    claimed_at: now.toISOString(),
  };
}

async function resumeSystemHoldClaim(claim, identity, owner, idempotencyKey, deps) {
  const previous = objectOf(claim?.payload);
  const claimPayload = {
    ...claimPayloadFor(identity, owner, idempotencyKey, deps.now()),
    retry_count: Math.max(1, Number(previous.retry_count || 0) + 1),
    previous_hold_reason: text(previous.reason || "owner_proof_system_unavailable"),
  };
  const result = await deps.conditionalUpdate(
    EVENTS,
    "svix_id",
    idempotencyKey,
    {
      type: `eq.${CLAIM_TYPE}`,
      "payload->>status": "eq.system_hold",
      "payload->>idempotency_key": `eq.${idempotencyKey}`,
    },
    { type: CLAIM_TYPE, payload: claimPayload },
  ).catch(() => null);
  return claimUpdateSucceeded(result)
    ? { ok: true, idempotencyKey, claimPayload, resumed: true }
    : null;
}

async function acquireClaim(identity, owner, deps) {
  const idempotencyKey = ownerProofOperationKey(identity, owner);
  if (!idempotencyKey) return { ok: false, reason: "owner_proof_identity_invalid", idempotencyKey: "" };
  const claimPayload = claimPayloadFor(identity, owner, idempotencyKey, deps.now());
  const inserted = await deps.insertRow(EVENTS, {
    type: CLAIM_TYPE,
    svix_id: idempotencyKey,
    payload: claimPayload,
    created_at: claimPayload.claimed_at,
  }).catch(() => null);
  if (claimSucceeded(inserted)) return { ok: true, idempotencyKey, claimPayload };
  if (!claimConflict(inserted)) {
    return { ok: false, reason: "owner_proof_claim_unavailable", idempotencyKey, providerAttempted: false };
  }
  const existing = await readClaim(idempotencyKey, identity, owner, deps);
  if (!existing.ok) return { ...existing, idempotencyKey, providerAttempted: false };
  const replay = replayFromClaim(existing.claim, idempotencyKey, deps.now(), identity, owner);
  if (replay?.resumable === true) {
    const resumed = await resumeSystemHoldClaim(existing.claim, identity, owner, idempotencyKey, deps);
    if (resumed) return resumed;
    const current = await readClaim(idempotencyKey, identity, owner, deps);
    if (!current.ok) return { ...current, idempotencyKey, providerAttempted: false };
    return replayFromClaim(current.claim, idempotencyKey, deps.now(), identity, owner) || {
      ok: false,
      reason: "owner_proof_claim_conflict",
      idempotencyKey,
      providerAttempted: false,
    };
  }
  return replay || {
    ok: false,
    reason: "owner_proof_claim_conflict",
    idempotencyKey,
    providerAttempted: false,
  };
}

async function updateClaim(type, payload, deps) {
  const result = await deps.conditionalUpdate(
    EVENTS,
    "svix_id",
    payload.idempotency_key,
    {
      type: `eq.${CLAIM_TYPE}`,
      "payload->>status": "eq.claimed",
      "payload->>idempotency_key": `eq.${payload.idempotency_key}`,
    },
    { type, payload },
  ).catch(() => null);
  return claimUpdateSucceeded(result);
}

/**
 * Claim-before-provider owner delivery. Completed retries read the stored
 * provider receipt and do not invoke the provider a second time. An uncertain
 * provider outcome is parked for reconciliation instead of risking a duplicate.
 */
async function deliverOwnerProof({ identity, owner, sendInput, dryRun = false, deps }) {
  const idempotencyKey = ownerProofOperationKey(identity, owner);
  if (!idempotencyKey) return { ok: false, reason: "owner_proof_identity_invalid" };
  if (dryRun) {
    const receipt = await deps.sendSequenceStep({ ...sendInput, dryRun: true, idempotencyKey });
    return { ok: receipt?.ok !== false, dryRun: true, idempotencyKey, receipt };
  }

  const acquired = await acquireClaim(identity, owner, deps);
  if (acquired.replay === true) return acquired;
  if (!acquired.ok) return acquired;

  let receipt;
  try {
    receipt = await deps.sendSequenceStep({ ...sendInput, dryRun: false, idempotencyKey });
  } catch {
    receipt = { ok: false, mode: "send_failed", blocked: "delivery_attempt_failed" };
  }
  const sent = receipt?.ok === true && receipt?.mode === "sent" && text(receipt.id);
  if (!sent) {
    const providerAttempted = receipt?.mode === "send_failed" || receipt?.providerAttempted === true;
    const reason = text(receipt?.blocked || receipt?.reason || receipt?.error || "owner_proof_refused");
    const retryableSystemHold = !providerAttempted && (
      receipt?.retryable === true
      || receipt?.retryableBeforeProvider === true
      || PRE_PROVIDER_TRANSIENT.has(reason)
      || /(?:_unavailable|_timeout|_temporarily_unavailable)$/.test(reason)
    );
    const nextPayload = {
      ...acquired.claimPayload,
      status: providerAttempted
        ? "reconciliation_required"
        : retryableSystemHold ? "system_hold" : "refused",
      reason,
      retryable: retryableSystemHold,
      provider_attempted: providerAttempted,
      ...(typeof receipt?.configured === "boolean"
        ? { provider_configured: receipt.configured }
        : {}),
      completed_at: deps.now().toISOString(),
    };
    const persisted = await updateClaim(CLAIM_TYPE, nextPayload, deps);
    if (!persisted) {
      return {
        ok: false,
        reason: "owner_proof_claim_update_unavailable",
        idempotencyKey,
        providerAttempted,
        ...(providerAttempted ? { manualReconciliationRequired: true } : {}),
        receipt,
      };
    }
    if (retryableSystemHold) {
      return {
        ok: false,
        reason,
        idempotencyKey,
        retryable: true,
        disposition: "system_hold",
        providerAttempted: false,
        receipt,
      };
    }
    return {
      ok: false,
      reason: providerAttempted ? "owner_proof_reconciliation_required" : nextPayload.reason,
      idempotencyKey,
      providerAttempted,
      ...(providerAttempted ? { manualReconciliationRequired: true } : {}),
      receipt,
    };
  }

  const completedAt = deps.now().toISOString();
  const sentPayload = {
    ...acquired.claimPayload,
    status: "sent",
    provider_receipt: text(receipt.id),
    accepted_at: text(receipt.acceptedAt || receipt.accepted_at || completedAt),
    completed_at: completedAt,
  };
  const persisted = await updateClaim(PROOF_SENT_EVENT_TYPE, sentPayload, deps);
  if (!persisted) {
    return {
      ok: false,
      reason: "owner_proof_receipt_persist_failed",
      idempotencyKey,
      providerAttempted: true,
      manualReconciliationRequired: true,
    };
  }
  return { ok: true, replay: false, idempotencyKey, receipt };
}

module.exports = {
  CLAIM_TYPE,
  lineReleaseInput,
  lineArtifactIdentity,
  ownerProofOperationKey,
  ownerFingerprint,
  readClaim,
  replayFromClaim,
  acquireClaim,
  deliverOwnerProof,
};
