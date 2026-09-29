"use strict";

// api/admin/release-verify-probe.js — OPERATOR DIAGNOSTIC (2026-08-31).
//
// The immutable-packet send path refuses drains with a single code —
// `owner_proof_public_release_unavailable` — and nothing else. This probe
// converts that silent refusal into a named step-by-step trace on ONE real
// production row. It loads the line row (ghost_agency_line_batch_rows by
// batch_id + prospect_id) plus the canonical prospect exactly as the sender
// drains them, then re-runs the sender's OWN verification chain
// function-for-function and returns every intermediate verbatim.
//
// SAFETY POSTURE (pattern: api/admin/prospect-raw.js)
//   · admin-gated like every /api/admin route,
//   · POST so the ids never land in a URL; no-store,
//   · strictly read-only: two SELECTs, then the sender's read-only public
//     release verifier (registry read + object reads + one public GET — it
//     "never stages, activates, provisions, or repairs a host").
//
// SENDER FUNCTIONS MIRRORED (apps/backend/lib/line-delivery.js unless noted):
//   buildDeliveryProspect evidence assembly .......... line-delivery.js:682
//   releaseEvidenceOf ............................... line-delivery.js:161
//   durableRecordReleaseEvidences ................... line-delivery.js:177
//   deliveryProofIdentity ........................... line-email-assets.js:153
//   sharedReleaseVerificationInput .................. line-delivery.js:187
//   publicReleaseMatchesIdentity .................... line-delivery.js:218
//   exactActiveSharedRelease ........................ line-delivery.js:229
//   verifyActivePublicRelease -> createDefaultSharedSitePublisher()
//       .verifyActiveRelease ........................ shared-site-publisher.js:1837
//   (loadActiveRelease registry/storage reads ....... shared-site-publisher.js:1667)
//   final refusal mapping ........................... line-delivery.js:1291
//
// The probe calls those exact functions (not a reimplementation); the only
// additions are labels and per-check booleans derived from their inputs so a
// null/false result names the failing step instead of hiding it.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const store = require("../../lib/store");
const linePersistence = require("../../lib/line-persistence");
const lineDelivery = require("../../lib/line-delivery");
const lineEmailAssets = require("../../lib/line-email-assets");
const { normalizeProofUrl } = require("../../lib/proof-storage");

const PROSPECTS = "ghost_agency_prospects";
const BATCHES = "ghost_agency_line_batches";
const ROWS = "ghost_agency_line_batch_rows";
// PUBLIC_RELEASE_VERIFY_MAX_MS (line-delivery.js:24) — the sender's own cap
// for one live public re-verification; the probe never exceeds it.
const PROBE_VERIFY_BUDGET_MS = 60_000;
const IMMUTABLE_PACKET_SWITCH = "GHOST_AGENCY_IMMUTABLE_PACKET";

function textOf(value) {
  return String(value || "").trim();
}

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// hasSharedProofMarker (line-email-assets.js:140) — the exact predicate
// deliveryProofIdentity uses to decide which sources count. Mirrored here for
// LABELING only; the authoritative reconciliation runs inside the real
// deliveryProofIdentity call below.
function markedAsSharedProofSource(source) {
  return Boolean(source && typeof source === "object" && !Array.isArray(source)
    && (Object.prototype.hasOwnProperty.call(source, "site_id")
      || Object.prototype.hasOwnProperty.call(source, "release_id")));
}

function previewHostOf(previewUrl) {
  // sharedReleaseVerificationInput (line-delivery.js:197-202): only a bare
  // https://<host>/ URL yields a usable host; everything else is fail-closed.
  try {
    const parsed = new URL(previewUrl);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password
      && parsed.pathname === "/" && !parsed.search && !parsed.hash) return parsed.hostname;
  } catch { /* exact public verifier below remains fail-closed */ }
  return "";
}

/**
 * Re-run the sender's verification chain on one hydrated line row + canonical
 * prospect. Returns the full trace; never writes.
 */
async function probeReleaseVerification({ row, durable, batch, deps, now = Date.now }) {
  const record = durable && durable.record && typeof durable.record === "object"
    ? durable.record
    : {};

  // ---- buildDeliveryProspect (line-delivery.js:684-696), mirrored verbatim --
  const durablePreview = textOf(durable && (durable.preview_url || durable.previewUrl)
    || record.preview_url || record.previewUrl);
  const durableBuildHash = textOf(record.build_dispatch && record.build_dispatch.build_hash);
  const rowPreview = textOf(row.previewUrl);
  const rowBuildHash = textOf(row.buildHash);
  const rowEvidenceIsCurrent = (!durableBuildHash || (rowBuildHash && rowBuildHash === durableBuildHash))
    && (!durablePreview || (rowPreview && normalizeProofUrl(rowPreview) === normalizeProofUrl(durablePreview)));
  const evidencePreview = durablePreview || rowPreview;
  const evidenceBuildHash = durableBuildHash || rowBuildHash;
  const evidenceRow = {
    prospectId: row.prospectId,
    businessName: row.businessName,
    previewUrl: evidencePreview,
    buildHash: evidenceBuildHash,
    ...(rowEvidenceIsCurrent ? {
      captured: row.captured,
      proof_shots: row.proof_shots,
      proofIdentity: row.proofIdentity,
    } : {}),
  };

  // ---- release evidence candidates (line-delivery.js:719-721) --------------
  const releaseEvidences = [lineDelivery.releaseEvidenceOf(row)]
    .concat(lineDelivery.durableRecordReleaseEvidences(record))
    .filter(Boolean);
  const releaseEvidence = releaseEvidences[0] || null;

  const releaseEvidenceLabels = [
    "row releaseEvidenceOf(row)",
    "record releaseEvidenceOf(record)",
    "record build_dispatch.release_evidence",
    "record mirror_release_evidence",
    "record build_dispatch",
  ];

  // ---- proof identity sources (line-delivery.js:722-734), same order -------
  const sourceEntries = [
    { label: "record.proof_shots", value: record.proof_shots },
    { label: "row.proofIdentity (queued snapshot)", value: evidenceRow.proofIdentity },
    { label: "row.proof_shots (queued snapshot)", value: evidenceRow.proof_shots },
    { label: "row.captured.shots (queued snapshot)", value: evidenceRow.captured && evidenceRow.captured.shots },
  ];
  releaseEvidences.forEach((release, index) => {
    const label = releaseEvidenceLabels[index] || `releaseEvidence[${index}]`;
    sourceEntries.push({
      label: `${label} -> proofIdentity`,
      value: objectOf(release && (release.proofIdentity || release.proof_identity)),
    });
    sourceEntries.push({
      label: `${label} -> sharedReleaseEvidence`,
      value: objectOf(release && (release.sharedReleaseEvidence || release.shared_release_evidence)),
    });
  });
  const sources = sourceEntries.map((entry) => ({
    label: entry.label,
    present: objectOf(entry.value) !== null,
    marked: markedAsSharedProofSource(entry.value),
    value: objectOf(entry.value),
  }));

  // ---- deliveryProofIdentity (line-email-assets.js:153) — the real one -----
  const proofIdentityState = deps.deliveryProofIdentity({
    sources: sources.map((source) => source.value),
    buildHash: evidenceBuildHash,
  });

  // ---- sharedReleaseVerificationInput (line-delivery.js:187-216) — exact ---
  // Same call the sender makes at line-delivery.js:753, under the sender's own
  // precondition (line-delivery.js:735-751): it is only reached once the outer
  // reconciliation is ok AND an active shared identity exists — the sender
  // refuses those cases before the call, so the probe does too.
  // `checks` below mirrors the function's internal conditions (lines 188-208)
  // one boolean each so a null result names the failing comparison.
  const sharedVerificationInputReached = proofIdentityState.ok === true
    && proofIdentityState.active === true
    && proofIdentityState.proofIdentity !== null;
  const sharedReleaseVerification = sharedVerificationInputReached
    ? lineDelivery.sharedReleaseVerificationInput(
      { releaseEvidence },
      proofIdentityState.proofIdentity,
      evidencePreview,
      evidenceBuildHash,
      deps,
    )
    : null;

  const releaseMirror = releaseEvidence;
  const releaseProofMirror = objectOf(releaseMirror && (releaseMirror.proofIdentity || releaseMirror.proof_identity));
  const sharedMirror = objectOf(releaseMirror && (releaseMirror.sharedReleaseEvidence || releaseMirror.shared_release_evidence));
  const identityMirror = deps.deliveryProofIdentity({
    sources: [proofIdentityState.proofIdentity, releaseProofMirror, sharedMirror],
    buildHash: evidenceBuildHash,
  });
  const previewHost = previewHostOf(evidencePreview);
  const sharedInputChecks = {
    sharedInputReached: sharedVerificationInputReached,
    release_present: releaseMirror !== null,
    release_proofIdentity_present: releaseProofMirror !== null,
    sharedReleaseEvidence_present: sharedMirror !== null,
    identity_ok: identityMirror.ok === true,
    identity_active: identityMirror.active === true,
    preview_url_is_bare_https_host: Boolean(previewHost),
    release_build_hash_matches: Boolean(releaseMirror) && releaseMirror.build_hash === evidenceBuildHash,
    release_preview_url_matches: Boolean(releaseMirror) && releaseMirror.preview_url === evidencePreview,
    shared_evidence_schema_is_v1: Boolean(sharedMirror) && sharedMirror.evidence_schema === "shared-site-release-evidence-v1",
    shared_state_is_active: Boolean(sharedMirror) && sharedMirror.state === "active",
    shared_site_id_matches_proof: Boolean(sharedMirror) && sharedMirror.site_id === (proofIdentityState.proofIdentity && proofIdentityState.proofIdentity.site_id),
    shared_release_id_matches_proof: Boolean(sharedMirror) && sharedMirror.release_id === (proofIdentityState.proofIdentity && proofIdentityState.proofIdentity.release_id),
    shared_build_hash_matches: Boolean(sharedMirror) && sharedMirror.build_hash === evidenceBuildHash,
    shared_canonical_host_matches_preview_host: Boolean(sharedMirror) && sharedMirror.canonical_host === previewHost,
  };

  // ---- exactActiveSharedRelease (line-delivery.js:229) with an
  // instrumented-but-pass-through verifyActiveRelease: the wrapper records the
  // exact input the sender's gate sends and the raw receipt the publisher
  // returns, then hands both to the same comparisons the sender runs.
  const queries = { called: false, input: null, receipt: null, error: null };
  const instrumentedDeps = {
    ...deps,
    verifyActiveRelease: async (input) => {
      queries.called = true;
      queries.input = input;
      try {
        const receipt = await deps.verifyActiveRelease(input);
        queries.receipt = receipt === undefined ? null : receipt;
        return receipt;
      } catch (error) {
        queries.error = String((error && error.message) || error);
        throw error;
      }
    },
  };
  let exactPassed = false;
  if (sharedReleaseVerification) {
    exactPassed = await lineDelivery.exactActiveSharedRelease(
      sharedReleaseVerification,
      instrumentedDeps,
      now() + PROBE_VERIFY_BUDGET_MS,
    );
  }

  // What the real verifyActiveRelease (shared-site-publisher.js:1837) consults
  // for this input, derived from the captured call: loadActiveRelease reads the
  // active registry (readSiteGeneration for site_id/slug/host) and the release
  // objects (manifest + every file), then the exact-byte public router GET on
  // previewUrl. A failing receipt carries its stage/reason detail verbatim.
  const capturedInput = queries.input;
  const capturedReceipt = queries.receipt;
  const inputEvidence = capturedInput && capturedInput.releaseEvidence;
  const inputProof = capturedInput && capturedInput.proofIdentity;
  const queried = capturedInput
    ? {
      preview_url: capturedInput.previewUrl || "",
      host: previewHostOf(capturedInput.previewUrl || ""),
      canonical_host: (inputEvidence && inputEvidence.canonical_host) || "",
      site_id: (inputProof && inputProof.site_id) || "",
      release_id: (inputProof && inputProof.release_id) || "",
      build_hash: (inputProof && inputProof.build_hash) || "",
      generation: inputEvidence && inputEvidence.generation,
      manifest_path: (inputEvidence && inputEvidence.manifest_path) || "",
      registry_lookup: "shared_site_registry.readSiteGeneration({ siteId, slug, host })",
      storage_reads: `shared release bucket: ${inputEvidence && inputEvidence.manifest_path || ""} + every manifest file`,
      public_get: capturedInput.previewUrl || "",
    }
    : null;

  // publicReleaseMatchesIdentity (line-delivery.js:218-227) — the exact
  // predicate, plus its six comparisons one boolean each.
  const expected = sharedReleaseVerification;
  const identityMatch = capturedReceipt
    ? {
      receipt_ok: capturedReceipt.ok === true,
      receipt_no_fallback: capturedReceipt.fallback === false,
      preview_url_matches: capturedReceipt.previewUrl === (expected && expected.previewUrl),
      site_id_matches: capturedReceipt.siteId === (expected && expected.proofIdentity && expected.proofIdentity.site_id),
      release_id_matches: capturedReceipt.releaseId === (expected && expected.proofIdentity && expected.proofIdentity.release_id),
      build_hash_matches: capturedReceipt.buildHash === (expected && expected.buildHash),
    }
    : null;

  // ---- final refusal mapping (line-delivery.js:735-767 + 1291-1306) --------
  const lane = batch && batch.lane === "live" ? "live" : (batch && batch.lane === "sandbox" ? "sandbox" : null);
  const immutablePacketSelected = lane !== "live"
    && String(process.env[IMMUTABLE_PACKET_SWITCH] ?? "1").trim() !== "0";
  let refusal = null;
  let refusalKind = null;
  let refusalStage = null;
  if (!proofIdentityState.ok) {
    refusal = immutablePacketSelected ? "owner_proof_public_release_unavailable" : proofIdentityState.reason;
    refusalKind = immutablePacketSelected ? "identity_invalid" : null;
    refusalStage = "deliveryProofIdentity";
  } else if (immutablePacketSelected && !proofIdentityState.active) {
    // line-delivery.js:746-751: the immutable lane refuses BEFORE building the
    // shared verification input when no source is marked active.
    refusal = "owner_proof_public_release_unavailable";
    refusalKind = "identity_invalid";
    refusalStage = "deliveryProofIdentityInactive";
  } else if (!sharedReleaseVerification) {
    refusal = immutablePacketSelected ? "owner_proof_public_release_unavailable" : null;
    refusalKind = immutablePacketSelected ? "identity_invalid" : null;
    refusalStage = "sharedReleaseVerificationInput";
  } else if (!exactPassed) {
    refusal = "owner_proof_public_release_unavailable";
    refusalKind = "transient";
    refusalStage = "exactActiveSharedRelease";
  }

  const summary = exactPassed
    ? "shared release verified end-to-end on this row"
    : refusal
      ? `first failing step: ${refusalStage} (${refusal})`
      : `shared verification input not built (${refusalStage}); the classic lane does not require it`;

  return {
    lane,
    immutablePacketSelected,
    evidenceInputs: {
      durablePreview,
      durableBuildHash,
      rowPreview,
      rowBuildHash,
      rowEvidenceIsCurrent,
      evidencePreview,
      evidenceBuildHash,
    },
    releaseEvidenceCandidates: releaseEvidences.map((release, index) => ({
      label: releaseEvidenceLabels[index] || `releaseEvidence[${index}]`,
      usedAsPrimary: release === releaseEvidence,
      value: release,
    })),
    sources,
    proofIdentityState,
    sharedReleaseVerificationInput: {
      result: sharedReleaseVerification,
      checks: sharedInputChecks,
      reconciledIdentityInside: identityMirror,
      previewHost,
    },
    exactActiveSharedRelease: {
      requested: sharedReleaseVerification !== null,
      passed: exactPassed,
      verifyActiveRelease: {
        called: queries.called,
        input: capturedInput,
        receipt: capturedReceipt,
        error: queries.error,
        queried,
      },
      identityMatch: identityMatch === null ? null : {
        ...identityMatch,
        publicReleaseMatchesIdentity: lineDelivery.publicReleaseMatchesIdentity(capturedReceipt, expected),
      },
    },
    verdict: {
      verified: exactPassed,
      refusal,
      refusalKind,
      refusalStage,
      classicRefusal: proofIdentityState.ok ? null : proofIdentityState.reason,
      summary,
    },
  };
}

function createReleaseVerifyProbeHandler(overrides = {}) {
  const deps = {
    select: overrides.select || store.select,
    deliveryProofIdentity: overrides.deliveryProofIdentity || lineEmailAssets.deliveryProofIdentity,
    verifyActiveRelease: overrides.verifyActiveRelease || lineDelivery.verifyActivePublicRelease,
    hydrateRow: overrides.hydrateRow || linePersistence.hydrateRow,
    loadCanonicalProspect: overrides.loadCanonicalProspect || lineDelivery.loadCanonicalProspect,
    now: overrides.now || (() => new Date()),
  };
  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    if (!requireAdmin(req, res)) return;
    try {
      const body = await readJson(req);
      const batchId = textOf(body && body.batchId).slice(0, 160);
      const prospectId = textOf(body && body.prospectId).slice(0, 240);
      if (!batchId || !prospectId) {
        sendJson(res, 400, { ok: false, error: "batch_and_prospect_ids_required" });
        return;
      }

      const rowRead = await deps.select(
        ROWS,
        `?select=*&batch_id=eq.${encodeURIComponent(batchId)}&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
      );
      if (!rowRead || rowRead.ok !== true || !Array.isArray(rowRead.data) || !rowRead.data.length) {
        sendJson(res, 404, { ok: false, error: "line_row_not_found", batchId, prospectId });
        return;
      }
      const rawRow = rowRead.data[0];
      // The exact hydrated shape the sender drains (claimRows -> hydrateRow).
      const row = deps.hydrateRow(rawRow);

      // The canonical recipient the sender loads right before verification
      // (loadCanonicalProspect, line-delivery.js:668). Absent record = the
      // sender itself would stop at canonical_recipient_unavailable; the
      // row-side trace still runs so the operator sees what the row carries.
      const durable = await deps.loadCanonicalProspect(prospectId, { select: deps.select });

      const batchRead = await deps.select(
        BATCHES,
        `?select=*&batch_id=eq.${encodeURIComponent(batchId)}&limit=1`,
      ).catch(() => null);
      const batch = batchRead && batchRead.ok === true && Array.isArray(batchRead.data)
        ? batchRead.data[0] || null
        : null;

      const trace = await probeReleaseVerification({
        row,
        durable,
        batch,
        deps,
        now: () => Date.now(),
      });

      sendJson(res, 200, {
        ok: true,
        batchId,
        prospectId,
        rowId: rawRow.row_id || null,
        rowStatus: rawRow.status || null,
        rowVersion: typeof rawRow.version === "number" ? rawRow.version : null,
        rowUpdatedAt: rawRow.updated_at || null,
        lastRetryableError: rawRow.last_retryable_error || null,
        loaded: {
          lineRowPayload: rawRow.payload || null,
          prospect: durable,
          batch,
        },
        senderPrecondition: durable
          ? "canonical_recipient_loaded"
          : "sender_would_refuse:canonical_recipient_unavailable",
        trace,
        senderMirrors: [
          { step: "evidence inputs", function: "buildDeliveryProspect", location: "apps/backend/lib/line-delivery.js:682" },
          { step: "row release evidence", function: "releaseEvidenceOf", location: "apps/backend/lib/line-delivery.js:161" },
          { step: "record release evidences", function: "durableRecordReleaseEvidences", location: "apps/backend/lib/line-delivery.js:177" },
          { step: "proof identity reconciliation", function: "deliveryProofIdentity", location: "apps/backend/lib/line-email-assets.js:153" },
          { step: "shared verification input", function: "sharedReleaseVerificationInput", location: "apps/backend/lib/line-delivery.js:187" },
          { step: "identity match predicate", function: "publicReleaseMatchesIdentity", location: "apps/backend/lib/line-delivery.js:218" },
          { step: "live public re-verification gate", function: "exactActiveSharedRelease", location: "apps/backend/lib/line-delivery.js:229" },
          { step: "publisher verification", function: "verifyActiveRelease", location: "apps/backend/lib/shared-site-publisher.js:1837" },
          { step: "registry/storage reads", function: "loadActiveRelease", location: "apps/backend/lib/shared-site-publisher.js:1667" },
          { step: "refusal mapping", function: "sendOne immutable gate", location: "apps/backend/lib/line-delivery.js:1291" },
        ],
      });
    } catch (error) {
      handleError(res, error);
    }
  };
}

module.exports = createReleaseVerifyProbeHandler();
module.exports.createReleaseVerifyProbeHandler = createReleaseVerifyProbeHandler;
module.exports.probeReleaseVerification = probeReleaseVerification;
