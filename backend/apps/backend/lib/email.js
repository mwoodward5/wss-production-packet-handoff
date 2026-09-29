const { createHash } = require("node:crypto");
const { insertRow, recordEvent } = require("./store");
const { select, upsertRow } = require("./store");
const { render } = require("./email-templates");
const { emailFrom, outreachFromStatus } = require("./env-compat");
const { outreachDnsStatus } = require("./outreach-dns");
const { unsubscribeUrl } = require("./unsubscribe");
const { normalizeBusinessName, normalizeDomain } = require("./prospect-identity");
const { verifiedBrandOf } = require("./prospects");
const { emailGreetingName } = require("./owner-greeting");
const { pchSubject, outreachHtmlV2, proofReadiness } = require("./outreach-email-v2");
// The prospect -> composeOutreachEmailV3 mapping, and its kill switch. Kept in
// its own module so the truth rules (no fallback grade, no invented review
// count, no manufactured expiry) are unit-testable without any email
// machinery — see test/proof-email-inputs.test.js. This module is safe to
// require at load time: it pulls in the V3 composer lazily, so it does not
// close a cycle back through this file.
const { buildProofEmailInputs, proofEmailV3Enabled } = require("./proof-email-inputs");
const { canonicalCallPrepReportUrl } = require("./callprep-client");
// Reads the grade back off the report the email links to, so the letter we
// print and the letter the prospect sees when they click are the same letter.
// The grade reader shares the same strict CallPrep URL contract and closes no
// cycle back through this file.
const { fetchReportFacts } = require("./report-grade");
const { safeReportUrl } = require("./report-url");
const { signedVisualPath, normalizeVisualProofIdentity } = require("./preview-visuals");
const { deliveryProofIdentity } = require("./line-email-assets");
const { clientReferenceCode } = require("./client-reference");
// The durable owner-proof send-event type. The Gallery and the prospect drawer
// already read this channel (lib/owner-proof-delivery writes it for the
// send-mirror-proof route); the Line lane's owner proofs join the SAME ledger
// so every real send is durably accounted in one place.
const { PROOF_SENT_EVENT_TYPE } = require("./prospect-detail");
// The signed, prospect-bound buy link. Minted here, beside the Client ID, for
// the same reason: it is derived from this prospect's identity and it must be
// the SAME link the sign-up panel on their mirror carries. "" removes the
// button — see prospectCheckoutUrl for the two fail-closed cases.
const { prospectCheckoutUrl } = require("./checkout-links");
const { capturedShotBelongsTo } = require("./proof-storage");
const { mirrorReviewFace } = require("./review-face-mirror");
const { isGoogleReviewerFace } = require("./verified-trust-lookup");
const { isApprovedPreviewUrl, previewHostRejection } = require("./preview-host-guard");
// Asks the preview host whether it is actually serving, for the two steps whose
// copy makes a present-tense claim that it is. Requires only the host guard, so
// it closes no cycle here. See the gate below for why step 1 is excluded.
const { checkPreviewLive } = require("./preview-liveness");
const { prospectSendsEnabled, waitForProspectSendSlot } = require("./send-policy");
const {
  REQUIRED_QC_CONTRACT,
  REQUIRED_RENDERER,
  FORGE_MIRROR_RENDERER,
  FORGE_MIRROR_QC_CONTRACT,
  FORGE_RELEASE_EVIDENCE_SCHEMA,
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
  acceptedRendererPair,
  extractReleaseEvidence,
} = require("./siteforge");
const { deliveryPauseStatus } = require("./delivery-pause");
const { contactSendGate, normalizeEmail } = require("./contact-enrichment");
const { agencyAgentPhone, resolveRileyLine } = require("./riley-line");
// The one place the STOP promise is written. The HTML shell in
// lib/outreach-email-v2.js renders the same constant, so the two MIME parts of
// one cold email cannot give the reader different opt-out instructions.
const { OPT_OUT_PROMISE } = require("./opt-out-promise");

const OWNER_PROOF_EXTERNAL_STEP_MIN_MS = 1_000;
const OWNER_PROOF_RESEND_TIMEOUT_MAX_MS = 10_000;

function ownerProofDeadlineStatus({
  internalOwnerProof = false,
  deadlineAt = 0,
  now = Date.now,
  minimumRemainingMs = OWNER_PROOF_EXTERNAL_STEP_MIN_MS,
} = {}) {
  const deadlineMs = Number(deadlineAt);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    return { ok: true, enforced: false, remainingMs: Infinity };
  }
  const nowMs = Number(typeof now === "function" ? now() : now);
  const remainingMs = deadlineMs - (Number.isFinite(nowMs) ? nowMs : Date.now());
  return {
    ok: remainingMs > minimumRemainingMs,
    enforced: true,
    remainingMs,
  };
}

function ownerProofDeadlineBlocked(status, internalOwnerProof = true) {
  return {
    ok: false,
    mode: "send_blocked",
    blocked: internalOwnerProof ? "owner_proof_deadline_exhausted" : "delivery_deadline_exhausted",
    configured: false,
    remainingMs: Number.isFinite(status?.remainingMs) ? status.remainingMs : 0,
    ...(internalOwnerProof ? {
      retryableBeforeProvider: true,
      providerAttempted: false,
    } : {}),
  };
}

function practiceSignalReportUrl(value) {
  return canonicalCallPrepReportUrl(value);
}

// OWNER LAW (2026-09-02): the owner's own inbox is never hostage to report
// bookkeeping. The Practice report-identity verdict protects a lane whose ONLY
// recipient is GHOST_AGENCY_OWNER_EMAIL (see the recipient gate above); for
// that internal lane a mismatch is surfaced as a loud warning, never a block.
// Prospect-facing lanes keep every hard gate untouched.
function ownerPracticeSignalSoftWarn(reason, context) {
  try {
    console.warn(JSON.stringify({
      event: "owner_proof_report_identity_soft_block",
      reason: String(reason || "").slice(0, 120),
      context: String(context || "").slice(0, 60),
    }));
  } catch { /* never block on telemetry */ }
  return true;
}

function ownerPracticeSignalBlocked(blocked) {
  return {
    ok: false,
    mode: "send_blocked",
    blocked,
    configured: false,
    retryableBeforeProvider: true,
    providerAttempted: false,
  };
}

function ownerPracticeMarketProvisional(record = {}) {
  const buildReady = record.build_ready && typeof record.build_ready === "object"
    && !Array.isArray(record.build_ready)
    ? record.build_ready
    : {};
  const cityProvenance = buildReady.provenance?.city
    && typeof buildReady.provenance.city === "object"
    && !Array.isArray(buildReady.provenance.city)
    ? buildReady.provenance.city
    : {};
  // New Practice admissions carry the explicit scope. Keep the durable legacy
  // identity marker as a belt for rows written before that scope existed, but
  // never let a provisional hint on an ordinary owner proof alter Live copy.
  const ownerOnlyAdmission = String(buildReady.admission_scope || "").trim().toLowerCase()
    === "owner_only_practice" || buildReady.identity_provisional === true;
  const marketEvidenceProvisional = buildReady.identity_provisional === true
    || String(cityProvenance.class || "").trim().toLowerCase() === "provisional"
    || String(cityProvenance.source || "").trim().toLowerCase() === "operator_requested_market"
    || ["candidate_market_hint", "operator_requested_provisional"].includes(
      String(cityProvenance.method || "").trim().toLowerCase(),
    );
  return ownerOnlyAdmission && marketEvidenceProvisional;
}

function ownerPracticeReportIdentityVerdict(reportRead, receipt = null) {
  const receiptIdentity = receipt && typeof receipt.identity === "object"
    && !Array.isArray(receipt.identity)
    ? receipt.identity
    : null;
  const reportIdentity = reportRead && typeof reportRead.identity === "object"
    && !Array.isArray(reportRead.identity)
    ? reportRead.identity
    : null;
  const signature = String(receipt && receipt.signature || "").trim().toLowerCase();
  if (!receiptIdentity || !reportIdentity || !/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, reason: "owner_proof_signal_report_identity_missing" };
  }

  const fold = (value) => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const expectedName = normalizeBusinessName(receiptIdentity.business_name);
  const reportName = normalizeBusinessName(reportIdentity.businessName);
  const snapshotName = normalizeBusinessName(reportIdentity.snapshotBusinessName);
  const expectedDomain = normalizeDomain(receiptIdentity.canonical_domain);
  const reportDomain = normalizeDomain(reportIdentity.businessUrl);
  const expectedToken = `wss-genie-cert-v1:${signature}`;
  const missing = !expectedName || !reportName || !snapshotName
    || !String(reportIdentity.packetId || "").trim();
  if (missing) return { ok: false, reason: "owner_proof_signal_report_identity_missing" };

  // The refusal names its input: which field diverged and a sanitized
  // fingerprint of both sides (lowercase alphanumerics, capped), so one drain
  // pinpoints a server-side mapping gap instead of a spelunk.
  const fp = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "empty";
  const mismatched = [
    ["packetId", reportIdentity.packetId !== expectedToken, expectedToken, reportIdentity.packetId],
    ["businessName", reportName !== expectedName, expectedName, reportName],
    ["snapshotBusinessName", snapshotName !== expectedName, expectedName, snapshotName],
    ["businessUrl", reportDomain !== expectedDomain, expectedDomain, reportDomain],
    ["city", fold(reportIdentity.city) !== fold(receiptIdentity.city), receiptIdentity.city, reportIdentity.city],
    ["state", String(reportIdentity.state || "").trim().toUpperCase()
      !== String(receiptIdentity.state || "").trim().toUpperCase(), receiptIdentity.state, reportIdentity.state],
    ["industry", fold(reportIdentity.industry) !== fold(receiptIdentity.category), receiptIdentity.category, reportIdentity.industry],
  ].find((entry) => entry[1] === true);
  return mismatched
    ? {
      ok: false,
      reason: `owner_proof_signal_report_identity_mismatch:${mismatched[0]}`
        + `:act:${fp(mismatched[3])}`,
    }
    : { ok: true, token: expectedToken };
}

function verifiedOwnerPracticeReceipt(prospect, record, verifyReceipt) {
  const verify = typeof verifyReceipt === "function"
    ? verifyReceipt
    : require("./line-adapters").verifiedGenieContentReceipt;
  try {
    const result = verify(prospect, record);
    return result && result.ok === true && result.receipt
      ? { ok: true, receipt: result.receipt }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

function emailConfigured(kind = "transactional") {
  return Boolean(process.env.RESEND_API_KEY?.trim() && emailFrom(kind));
}

// Agency agent line for call CTAs. CONFIGURATION ONLY — GHOST_AGENT_PHONE, or
// the older GHOST_AGENCY_AGENT_PHONE that the rest of the codebase reads.
//
// There is no literal fallback and there must never be one again. The removed
// DEFAULT_AGENT_PHONE constant kept rendering a number after the line behind it
// was gone: a rendered proof email on 2026-07-30 published it with nobody
// deciding to. Unset now resolves to "" and every caller OMITS the phone line
// and its CTA entirely — see lib/riley-line.js for the contract.

function displayPhone(value = "") {
  const digits = String(value).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : String(value);
}

function reviewHoldActive() {
  return /^(1|true|yes|on)$/i.test(String(process.env.GHOST_AGENCY_REVIEW_HOLD || "").trim());
}

function oneClickUnsubscribeHeaders(url = "") {
  return url
    ? {
        "List-Unsubscribe": `<${url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : {};
}

function positiveGate(value) {
  return value === true || value === 1 || /^(true|yes|ok|pass|passed|ready|cleared)$/i.test(String(value || "").trim());
}

function exactReleaseIdentityMatchesProspect(prospect = {}, evidence = null) {
  if (!evidence || evidence.schema !== "siteforge-release-evidence-v1") return false;
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const prospectName = normalizeBusinessName(
    prospect.business_name
    || prospect.businessName
    || prospect.name
    || prospect.company
    || record.business_name
    || record.businessName
    || record.name
    || record.company
    || "",
  );
  const expected = normalizeBusinessName(evidence.identity?.expected?.business_name);
  const actual = normalizeBusinessName(evidence.identity?.actual?.business_name);
  const packet = normalizeBusinessName(evidence.identity?.actual?.public_packet_business_name);
  return Boolean(prospectName)
    && expected === prospectName
    && actual === prospectName
    && packet === prospectName;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function releasePacketMatchesCurrentBuild(prospect = {}, evidence = null) {
  if (!evidence) return false;
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const truth = prospect.truth_packet && typeof prospect.truth_packet === "object"
    ? prospect.truth_packet
    : record.truth_packet && typeof record.truth_packet === "object"
      ? record.truth_packet
      : {};
  const canonical = truth.intakeGenie && typeof truth.intakeGenie === "object"
    ? truth.intakeGenie
    : truth.facts && typeof truth.facts === "object"
      ? truth
      : {};
  const callback = prospect.siteforge_callback || record.siteforge_callback || {};
  const dispatch = prospect.build_dispatch || record.build_dispatch || {};
  const currentFingerprint = String(
    prospect.siteforge_generation_fingerprint
    || record.siteforge_generation_fingerprint
    || callback.generation_fingerprint
    || dispatch.generation_fingerprint
    || "",
  ).trim();
  const packetFingerprint = String(
    canonical.generation_fingerprint
    || canonical.generationFingerprint
    || canonical.rendered_truth?.generation_fingerprint
    || canonical.rendered_truth?.generationFingerprint
    || "",
  ).trim();
  const packetEvidence = canonical.release_evidence || canonical.releaseEvidence || null;
  return Boolean(
    currentFingerprint
    && packetFingerprint === currentFingerprint
    && packetEvidence
    && canonicalJson(packetEvidence) === canonicalJson(evidence)
  );
}

function outreachBuildQuality(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : prospect;
  const callback = prospect.siteforge_callback || record.siteforge_callback || {};
  const dispatch = prospect.build_dispatch || record.build_dispatch || {};
  const renderer = String(
    prospect.siteforge_renderer || record.siteforge_renderer || callback.renderer || dispatch.renderer || "",
  ).trim();
  const qcPassed = positiveGate(
    prospect.siteforge_qc_passed ?? record.siteforge_qc_passed ?? callback.qc_passed ?? dispatch.qc_passed,
  );
  const visualPassed = positiveGate(
    prospect.siteforge_visual_qc_passed ?? record.siteforge_visual_qc_passed ?? callback.visual_qc_passed ?? dispatch.visual_qc_passed,
  );
  const contract = String(
    prospect.siteforge_qc_contract || record.siteforge_qc_contract || callback.qc_contract || dispatch.qc_contract || "",
  ).trim();
  // FORGE LANE, FIRST-CLASS (divergence-audit contract, 2026-07-29). A
  // forge-mirror artifact carries the forge renderer identity and its own
  // release evidence schema. It is validated on ITS terms — schema, coherent
  // renderer/QC pair, non-blocked audit verdict, and a deploy alias that
  // matches the preview host — never by pretending SiteForge ran.
  if (renderer === FORGE_MIRROR_RENDERER) {
    const evidence = (record.build_dispatch && record.build_dispatch.release_evidence)
      || (prospect.build_dispatch && prospect.build_dispatch.release_evidence)
      || null;
    const previewHost = (() => {
      try { return new URL(String(prospect.preview_url || record.preview_url || "")).host; } catch { return ""; }
    })();
    const aliasHost = (() => {
      try { return new URL(String(evidence?.deploy_alias || "")).host; } catch { return ""; }
    })();
    const forgeReasons = [];
    if (!acceptedRendererPair(renderer, contract)) forgeReasons.push(`qc_contract_${contract || "missing"}_not_allowed_for_forge`);
    if (!qcPassed) forgeReasons.push("qc_not_passed");
    if (!visualPassed) forgeReasons.push("visual_qc_not_passed");
    if (!evidence || evidence.schema !== FORGE_RELEASE_EVIDENCE_SCHEMA) forgeReasons.push("forge_release_evidence_missing");
    else {
      if (evidence.renderer !== FORGE_MIRROR_RENDERER || evidence.qc_contract !== FORGE_MIRROR_QC_CONTRACT) {
        forgeReasons.push("forge_release_evidence_identity_mismatch");
      }
      if (evidence.verdict === "BLOCKED" || Number(evidence.blocking) > 0) forgeReasons.push("forge_audit_blocked");
      if (!aliasHost || !previewHost || aliasHost !== previewHost) forgeReasons.push("forge_deploy_alias_preview_mismatch");
    }
    return {
      ok: forgeReasons.length === 0,
      renderer,
      qcPassed,
      visualPassed,
      contract: contract || null,
      releaseEvidencePassed: forgeReasons.length === 0,
      releaseEvidenceFailures: forgeReasons,
      reasons: forgeReasons,
    };
  }
  // MIRROR ENGINE, FIRST-CLASS. Its release manifest is signed by the engine
  // and must be checked as itself — never re-labelled with SiteForge fields.
  if (renderer === MIRROR_ENGINE_RENDERER) {
    const evidence = (record.build_dispatch && record.build_dispatch.release_evidence)
      || (prospect.build_dispatch && prospect.build_dispatch.release_evidence)
      || record.mirror_release_evidence
      || prospect.mirror_release_evidence
      || null;
    const previewHost = (() => {
      try { return new URL(String(prospect.preview_url || record.preview_url || "")).host; } catch { return ""; }
    })();
    const evidenceHost = (() => {
      try { return new URL(String(evidence?.preview_url || "")).host; } catch { return ""; }
    })();
    const reasons = [];
    if (!acceptedRendererPair(renderer, contract)) reasons.push(`qc_contract_${contract || "missing"}_not_allowed_for_mirror_engine`);
    if (!qcPassed) reasons.push("qc_not_passed");
    if (!visualPassed) reasons.push("visual_qc_not_passed");
    if (!evidence || evidence.evidence_schema !== MIRROR_ENGINE_EVIDENCE_SCHEMA) {
      reasons.push("mirror_engine_release_evidence_missing");
    } else {
      if (evidence.renderer !== MIRROR_ENGINE_RENDERER || evidence.qc_contract !== MIRROR_ENGINE_QC_CONTRACT) {
        reasons.push("mirror_engine_release_evidence_identity_mismatch");
      }
      let signed = false;
      try {
        const { signEvidence } = require("./mirror-engine/engine");
        signed = Boolean(evidence.evidence_sha) && signEvidence(evidence) === evidence.evidence_sha;
      } catch { signed = false; }
      if (!signed) reasons.push("mirror_engine_release_evidence_signature_invalid");
      if (evidence.revealable !== true) reasons.push("mirror_engine_not_revealable");
      if (!previewHost || !evidenceHost || previewHost !== evidenceHost) reasons.push("mirror_engine_preview_identity_mismatch");
    }
    return {
      ok: reasons.length === 0,
      renderer,
      qcPassed,
      visualPassed,
      contract: contract || null,
      releaseEvidencePassed: reasons.length === 0,
      releaseEvidenceFailures: reasons,
      reasons,
    };
  }
  const releaseEvidence = extractReleaseEvidence(prospect);
  let strictRelease = { ok: false, failures: ["release_evidence_missing"] };
  if (releaseEvidence) {
    try {
      // Reuse the existing release validator used by supervised production
      // sends. Requiring its real artifacts/runtime checks prevents three
      // self-asserted booleans from authorizing outreach.
      strictRelease = require("./supervised-held-drafts").phaseOneReleaseEvidence(prospect);
    } catch {
      strictRelease = { ok: false, failures: ["release_evidence_validation_unavailable"] };
    }
  }
  const identityMatches = exactReleaseIdentityMatchesProspect(prospect, releaseEvidence);
  const currentBuildMatches = releasePacketMatchesCurrentBuild(prospect, releaseEvidence);
  const releaseEvidenceFailures = [
    ...(Array.isArray(strictRelease.failures) ? strictRelease.failures : []),
    ...(!identityMatches ? ["preview_identity_prospect_mismatch"] : []),
    ...(!currentBuildMatches ? ["release_evidence_current_build_mismatch"] : []),
  ];
  const releaseEvidencePassed = Boolean(
    releaseEvidence
    && strictRelease.ok === true
    && identityMatches
    && currentBuildMatches,
  );
  const reasons = [];
  if (renderer !== REQUIRED_RENDERER) reasons.push(renderer ? `renderer_${renderer}_not_allowed` : "renderer_missing");
  if (!qcPassed) reasons.push("qc_not_passed");
  if (!visualPassed) reasons.push("visual_qc_not_passed");
  if (contract !== REQUIRED_QC_CONTRACT) reasons.push(contract ? `qc_contract_${contract}_not_allowed` : "qc_contract_missing");
  if (!releaseEvidencePassed) reasons.push("release_evidence_missing_or_failed");
  return {
    ok: reasons.length === 0,
    renderer: renderer || null,
    qcPassed,
    visualPassed,
    contract: contract || null,
    releaseEvidencePassed,
    releaseEvidenceFailures,
    reasons,
  };
}

/**
 * IS THIS PREVIEW THIS PROSPECT'S PREVIEW?
 *
 * Under consent-first the preview was decoration: a mismatched one was dropped
 * from the template and the email went out anyway. Proof-first inverted that.
 * The email's entire proposition is "here is the site we built for YOU", so a
 * preview we cannot bind to this prospect is not a missing garnish — it is the
 * email being wrong about who it is talking to. Same defect class as attaching
 * a screenshot of somebody else's website: an artifact on an email that nobody
 * checked belongs to the recipient. Same answer: refuse to send.
 *
 * The binding is evidence, never assertion, and it is checked in three
 * independent places so no single stale field can carry it:
 *   1. release evidence exists at all;
 *   2. its identity block names THIS prospect (exact, normalized);
 *   3. it describes the CURRENT build (fingerprint agreement), and its own
 *      artifacts live under the very preview URL we are about to link to.
 *
 * (3) is what catches the specific incident: a row whose preview_url still
 * points at another business's slug while the rest of the record moved on.
 */
/**
 * The identity a preview URL DECLARES about itself, if any.
 *
 * Two shapes reach this function and they are not the same claim:
 *   · "…/try/signature-landscape/" — a word slug. Someone's business name is
 *     written on it. It is a claim, and a claim can be wrong.
 *   · "…/try/Tnas3b5iJUmCsw/"     — an opaque deployment id. It says nothing
 *     about whose site it is, and never could. That is a DETERMINISTIC absence,
 *     not a contradiction, and it must not be treated as one.
 *
 * Only the first shape can disagree with a prospect, so only the first shape is
 * allowed to refuse a send. Requiring a positive slug match instead would
 * ground every prospect whose preview is keyed by id — an outage dressed as a
 * security control.
 */
function previewSlugIdentity(previewUrl = "") {
  let u;
  try { u = new URL(String(previewUrl)); } catch { return { derivable: false }; }
  const segments = u.pathname.split("/").filter(Boolean);
  const generic = /^(www|preview|try|p|s|sites?|mirrors?|app|cdn|static)$/i;
  const raw = segments.length
    ? segments[segments.length - 1]
    : (u.hostname.split(".")[0] || "");
  const slug = String(raw).replace(/\.[a-z0-9]+$/i, "").replace(/^wss-(test|demo)-/i, "");
  // A word slug is all-lowercase with at least one hyphen. Anything else —
  // mixed case, digits-and-letters soup, a single bare token — is an id.
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(slug) || generic.test(slug)) return { derivable: false, slug };
  return { derivable: true, slug };
}

/**
 * IS THIS PREVIEW THIS PROSPECT'S PREVIEW?
 *
 * Under consent-first the preview was decoration: a mismatched one was dropped
 * from the template and the email went out anyway. Proof-first inverted that.
 * The email's entire proposition is "here is the site we built for YOU", so a
 * preview that names a DIFFERENT business is not a missing garnish — it is the
 * email being wrong about who it is talking to. Same defect class as attaching
 * a screenshot of somebody else's website, so it gets the same answer: refuse
 * to send. Scrubbing the link and mailing the remains is what we used to do.
 *
 * REFUSES ONLY ON CONTRADICTION, never on silence:
 *   · release evidence that names another business;
 *   · release evidence whose own artifacts live under a DIFFERENT deployment
 *     than the link we are about to send (a row whose preview_url went stale
 *     while the rest of the record moved on);
 *   · a preview slug that spells out a business, where that business is not
 *     this one.
 * A preview with no derivable identity and no contradicting evidence stays
 * open — that is the ordinary state of an id-keyed deployment.
 */
function previewBoundToProspect(prospect = {}, previewUrl = "") {
  const preview = String(previewUrl || "").trim();
  if (!preview) return { ok: false, reason: "preview_identity_no_preview_url" };

  const evidence = extractReleaseEvidence(prospect);
  if (evidence) {
    if (!exactReleaseIdentityMatchesProspect(prospect, evidence)) {
      return {
        ok: false,
        reason: "preview_identity_prospect_mismatch",
        evidence_names: evidence.identity && evidence.identity.expected && evidence.identity.expected.business_name,
      };
    }
    // Every artifact the evidence points at must live under the preview we are
    // about to put in the email. Evidence about a DIFFERENT deployment is not
    // evidence about this link.
    const base = preview.endsWith("/") ? preview : `${preview}/`;
    const stray = [
      evidence.identity && evidence.identity.public_packet_url,
      evidence.template_family && evidence.template_family.public_packet_url,
      evidence.map && evidence.map.screenshot_url,
    ].map((v) => String(v || "").trim()).filter(Boolean)
      .find((url) => !url.startsWith(base));
    if (stray) return { ok: false, reason: "preview_identity_artifact_off_preview", stray };
  }

  const slug = previewSlugIdentity(preview);
  if (slug.derivable) {
    const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
    const name = normalizeBusinessName(
      prospect.business_name || prospect.businessName || prospect.name || prospect.company
      || record.business_name || record.businessName || record.name || record.company || "",
    );
    const nameWords = new Set(String(name || "").split(/\s+/).filter((w) => w.length > 2));
    const slugWords = slug.slug.split("-").filter((w) => w.length > 2);
    const shares = slugWords.some((w) => nameWords.has(w));
    if (nameWords.size && slugWords.length && !shares) {
      return { ok: false, reason: "preview_identity_prospect_mismatch", slug: slug.slug };
    }
  }
  return { ok: true, slug_identity: slug.derivable ? slug.slug : null };
}

function resendWebhookConfigured() {
  return Boolean(
    process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET?.trim() ||
      process.env.RESEND_WEBHOOK_SECRET?.trim(),
  );
}

function emailHash(value = "") {
  const email = String(value || "").trim().toLowerCase();
  return email ? createHash("sha256").update(email).digest("hex") : "";
}

async function sendResendEmail(input = {}) {
  const recipientList = (value) => (Array.isArray(value) ? value : [value])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const normalized = (value) => String(value || "").trim().toLowerCase();
  const owner = normalized(process.env.GHOST_AGENCY_OWNER_EMAIL);
  const internalOwnerProof = input.internalOwnerProof === true;
  const requestedTo = recipientList(input.to);
  const requestedCc = recipientList(input.cc);
  const requestedBcc = recipientList(input.bcc);
  // An owner proof is a separate delivery lane, never a copied prospect
  // delivery. Do this at the last possible boundary before Resend so a future
  // caller cannot accidentally reintroduce a CC/BCC after earlier safeguards.
  if (internalOwnerProof && (!owner
    || requestedTo.length !== 1
    || normalized(requestedTo[0]) !== owner
    || requestedCc.length !== 0
    || requestedBcc.length !== 0)) {
    return {
      mode: "send_blocked",
      blocked: "owner_proof_recipient_gate_failed",
      configured: false,
    };
  }
  const to = internalOwnerProof ? owner : requestedTo[0];
  const senderKind = input.senderKind === "outreach" ? "outreach" : "transactional";
  const from = input.from?.trim() || emailFrom(senderKind);
  const replyTo = input.replyTo
    || (senderKind === "outreach"
      ? process.env.GHOST_AGENCY_OUTREACH_REPLY_TO?.trim()
      : "")
    || process.env.GHOST_AGENCY_SUPPORT_EMAIL?.trim()
    || undefined;
  const cc = internalOwnerProof ? [] : (requestedCc.length ? requestedCc : ccForKind(senderKind, to));
  const bcc = internalOwnerProof ? [] : requestedBcc;
  const messageHeaders = input.headers && Object.keys(input.headers).length ? input.headers : null;
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (idempotencyKey.length > 256) {
    return {
      mode: "send_blocked",
      blocked: "invalid_idempotency_key",
      configured: false,
    };
  }
  const configured = Boolean(process.env.RESEND_API_KEY?.trim() && from);
  if (!configured || !to) {
    return {
      mode: "dry_run",
      configured,
      blocked: !to ? "missing_recipient_email" : "resend_not_configured",
      reason: !to ? "recipient email missing" : "RESEND_API_KEY and/or sender email not configured",
      plannedEmail: {
        to: to || "missing",
        cc,
        bcc,
        from: from || "missing",
        subject: input.subject,
        headers: messageHeaders || {},
      },
    };
  }

  const deadlineStatus = ownerProofDeadlineStatus({
    internalOwnerProof,
    deadlineAt: input.deadlineAt,
    now: input.now,
  });
  if (!deadlineStatus.ok) return ownerProofDeadlineBlocked(deadlineStatus, internalOwnerProof);
  const requestSignal = deadlineStatus.enforced
    ? AbortSignal.timeout(Math.max(1, Math.min(
        OWNER_PROOF_RESEND_TIMEOUT_MAX_MS,
        Math.floor(deadlineStatus.remainingMs - OWNER_PROOF_EXTERNAL_STEP_MIN_MS),
      )))
    : undefined;
  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to,
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(messageHeaders ? { headers: messageHeaders } : {}),
        reply_to: replyTo,
      }),
      ...(requestSignal ? { signal: requestSignal } : {}),
    });
  } catch (error) {
    // A server-owned Line delivery supplies a deadline for both owner proofs
    // and live sends. Unbounded legacy callers preserve their retry contract.
    if (!internalOwnerProof && !deadlineStatus.enforced) throw error;
    return {
      mode: "send_failed",
      configured: true,
      blocked: error?.name === "TimeoutError" || error?.name === "AbortError"
        ? (internalOwnerProof ? "owner_proof_resend_timeout" : "delivery_provider_timeout")
        : undefined,
      error: error?.message || String(error),
    };
  }
  const json = await response.json().catch(() => ({}));
  if (!internalOwnerProof) {
    await recordEvent("resend_email", {
      to,
      cc,
      bcc,
      subject: input.subject,
      status: response.status,
      id: json.id,
      idempotencyKey: idempotencyKey || null,
    });
  }
  if (!response.ok) {
    return {
      mode: "send_failed",
      configured: true,
      status: response.status,
      error: json,
    };
  }
  return {
    mode: "sent",
    configured: true,
    id: json.id,
    from,
    cc,
    bcc,
    idempotencyKey: idempotencyKey || null,
  };
}

function prospectValue(prospect, keys, fallback = "") {
  for (const key of keys) {
    if (prospect?.[key]) return String(prospect[key]).trim();
  }
  return fallback;
}

function defaultVars(prospect = {}, vars = {}) {
  const businessName = prospectValue(prospect, ["business_name", "businessName", "name", "company"], "your business");
  const ownerName = prospectValue(prospect, ["owner_name", "ownerName", "contactName"], "there");
  const industry = prospectValue(prospect, ["industry", "category"], "local service");
  const city = prospectValue(prospect, ["city", "market"], "your area");
  const services = prospect.primary_services || prospect.services || [];
  const primaryService = Array.isArray(services) && services.length ? services[0] : industry;

  return {
    business_name: businessName,
    owner_or_team: emailGreetingName(prospect, businessName),
    industry,
    city,
    primary_service: primaryService,
    keyword_1: `${primaryService} ${city}`.trim(),
    sender_name: prospectValue(
      prospect,
      ["sender_name", "senderName"],
      process.env.GHOST_AGENCY_SENDER_NAME || "Mark Woodward",
    ),
    sender_phone: prospectValue(
      prospect,
      ["sender_phone", "senderPhone"],
      displayPhone(agencyAgentPhone()),
    ),
    edit_quota: process.env.GHOST_AGENCY_EDIT_QUOTA || "2",
    delivery_days: process.env.GHOST_AGENCY_DELIVERY_DAYS || "7-10",
    booking_url: prospectValue(prospect, ["booking_url", "bookingUrl"]),
    example_url: prospectValue(prospect, ["example_url", "exampleUrl"]),
    ...vars,
  };
}

function complianceFooter(prospect = {}) {
  const postal = process.env.GHOST_AGENCY_POSTAL_ADDRESS?.trim();
  const support = process.env.GHOST_AGENCY_SUPPORT_EMAIL?.trim() || "support@woodwardsoftware.com";
  const businessName = prospectValue(prospect, ["business_name", "businessName", "name", "company"], "this business");
  const unsubscribe = unsubscribeUrl({
    email: prospectValue(prospect, ["email", "owner_email", "ownerEmail"]),
    prospectId: prospectValue(prospect, ["prospect_id", "id"]),
  });
  if (!postal) {
    return {
      ok: false,
      error: "postal_address_missing",
      message: "Set GHOST_AGENCY_POSTAL_ADDRESS before sending acquisition email.",
    };
  }
  if (!unsubscribe) {
    return {
      ok: false,
      error: "unsubscribe_secret_missing",
      message: "Set EMAIL_UNSUB_SECRET before sending acquisition email.",
    };
  }
  return {
    ok: true,
    postal,
    support,
    unsubscribe,
    businessName,
    text:
      `\n\n--\nWoodward Software Systems\n${postal}\n` +
      // ONE DEFINITION (2026-07-31). This line used to be a literal here and a
      // second literal in the HTML shell; the HTML copy was dropped in the
      // proof-first rewrite and the two halves of the same cold email stopped
      // agreeing on how to opt out. See lib/opt-out-promise.js.
      `${OPT_OUT_PROMISE}\n` +
      `Unsubscribe: ${unsubscribe}\n` +
      // "CALL OR TEXT" NAMES A CHANNEL THAT DOES NOT ANSWER (fixed 2026-08-08).
      //
      // The number here is agencyAgentPhone() — GHOST_AGENT_PHONE, Riley's VAPI
      // line. VAPI provisions it for VOICE; nothing in this codebase receives
      // an SMS on it and lib/twilio.js is not wired to it, so a prospect who
      // texts that number is texting a void. The V3 body copy already narrowed
      // its own "call or text" to "call" for exactly this reason on 2026-08-07;
      // this footer is appended by lib/email.js AFTER the composer runs, so it
      // was never touched by that pass and kept promising the dead channel in
      // every acquisition email.
      //
      // AND AN EMPTY NUMBER TAKES ITS CLAUSE WITH IT. agencyAgentPhone()
      // documents "" as MUST BE TREATED AS OMIT, but this line interpolated it
      // unconditionally and printed "Questions? Call or text , or email …" —
      // observed in a real dry-run compose. Same defect class as prose.js's
      // "Ask for  · Sterling": an optional value that leaves a hole in the
      // middle of a sentence instead of removing it.
      (() => {
        const phone = displayPhone(agencyAgentPhone());
        return phone
          ? `Questions? Call ${phone}, or email ${support}.`
          : `Questions? Email ${support}.`;
      })(),
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// URLs inside HTML attributes: encode "=" as &#61; so lenient quoted-printable
// decoding can never eat "=XY" hex pairs (e.g. ?w=12.. or sig=ab..) in transit.
function htmlUrl(url) {
  return escapeHtml(url).replace(/=/g, "&#61;");
}

// ---------------------------------------------------------------------------
// PROOF-SHOT URL ASSEMBLY — clean 7-bit ascii, or nothing.
// ---------------------------------------------------------------------------

// The content cache-bust for a proof-shot <img>: "&c=" plus up to 12 lowercase
// hex chars of the shipped pixels' digest, or "" when there is no valid digest.
//
// It is its OWN pure function, and not an inline `&c=${…}` template, for one
// reason. A delivered proof once shipped "…&v=new-mobile&c<0x18>351cb0662b": a
// `node -e` edit run with a Windows path had replaced the "=" in the inline
// cache-bust literal with a 0x18 control byte in the SOURCE, and because nothing
// downstream inspects the middle of a signed URL it rode all the way into Gmail
// — whose image proxy then kept serving the pre-blue cached capture. Pulling the
// param out means the interpolated half is hex-only by construction, the "&c="
// separator is a single small literal a test can pin, and every digest shape is
// unit-testable with no email machinery in the way.
function proofShotCacheBust(stamp) {
  const hex = (/^[0-9a-f]{16,}$/i.test(String(stamp ?? "")) ? String(stamp) : "")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 12);
  return hex.length === 12 ? `&c=${hex}` : "";
}

// Assemble a proof-shot <img> src from a base origin, a signed relative path
// (built by preview-visuals.signedVisualPath via URLSearchParams — pure ascii)
// and a content digest, and REFUSE a corrupted one.
//
// A shot URL is machine-built and therefore pure printable 7-bit ascii by
// construction; a control or non-ascii byte anywhere in it is proof the string
// was mangled AFTER assembly (the source-corruption above, or a future one).
// Refuse it so a broken <img src> can never mail: "" fails the after-shot
// readiness gate closed, which is the right failure — an honest "no picture"
// beats a src that resolves to a 42-byte spacer or a 404 under a caption
// promising the blue site.
function assembleShotUrl(base, rel, stamp) {
  const relPath = String(rel ?? "");
  if (!relPath) return "";
  const url = `${String(base ?? "")}${relPath}${proofShotCacheBust(stamp)}`;
  return /[^\x20-\x7e]/.test(url) ? "" : url;
}


function ccForKind(kind, to = "") {
  if (kind !== "outreach") return [];
  const raw = process.env.GHOST_AGENCY_OUTREACH_CC || process.env.GHOST_AGENCY_OWNER_EMAIL || "";
  const recipient = String(to || "").trim().toLowerCase();
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.findIndex((x) => x.toLowerCase() === item.toLowerCase()) === index)
    .filter((item) => item.toLowerCase() !== recipient);
}

// Grade -> badge color. Kept tasteful on the dark card palette so a strong grade
// reads as reassurance and a weak one as an honest "here's the gap the site fixes".
function gradeBadgeColor(grade) {
  const g = String(grade || "").trim().toUpperCase();
  if (/^A/.test(g)) return "#3FBF7F";
  if (/^B/.test(g)) return "#7C9CFF";
  if (/^C/.test(g)) return "#E0A93B";
  return "#8A97AD";
}

// Local visibility snapshot: real, verifiable trust signals (rating, reviews,
// GetFound grade, trust facts) rendered as a compact dark mini-report card — a
// visibility "thumbnail" in pure HTML (no image weight), mirroring the AB proof.
function visibilitySnapshotCard({ businessName = "", rating = 0, reviewCount = 0, grade = "", signals = [] } = {}) {
  const r = Number(rating) || 0;
  const rc = Number(reviewCount) || 0;
  const g = String(grade || "").trim().toUpperCase();
  const hasGrade = /^[A-F][+-]?$/.test(g);
  const hasRating = r >= 3 && rc > 0;

  // Signal rows: the headline reputation stat first, then verifiable trust facts.
  // TRUTH-LAW: every row is a REAL measured fact. When only one of rating/reviews
  // is present we show just that one (never invent the other), and when nothing
  // is measured we fall through to a neutral "analysis being finalized" state
  // below — we never render a fabricated grade, star, or count.
  const rows = [];
  if (hasRating) {
    rows.push(`<span style="color:#FFC94D">&#9733;</span> <b style="color:#EAF0FB">${r.toFixed(1)}</b> <span style="color:#8fa3c8">out of 5</span> &middot; <b style="color:#EAF0FB">${rc}</b> <span style="color:#8fa3c8">Google reviews</span>`);
  } else if (r >= 3) {
    rows.push(`<span style="color:#FFC94D">&#9733;</span> <b style="color:#EAF0FB">${r.toFixed(1)}</b> <span style="color:#8fa3c8">out of 5 Google rating</span>`);
  } else if (rc > 0) {
    rows.push(`<span style="color:#FFC94D">&#9733;</span> <b style="color:#EAF0FB">${rc}</b> <span style="color:#8fa3c8">Google reviews</span>`);
  }
  for (const s of (signals || []).slice(0, 4)) {
    const t = String(s || "").trim();
    if (t) rows.push(`<span style="color:#3FBF7F">&#10003;</span> ${escapeHtml(t.slice(0, 44))}`);
  }

  // Neutral, honest fallback when there is NO measured grade and NO measured
  // reputation data. Shows a deliberate muted "being finalized" card instead of a
  // fabricated F/0 (or an empty hole). The badge is an ellipsis, never a letter.
  if (!rows.length && !hasGrade) {
    return `<tr><td style="padding-top:16px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0A0F1E;border-radius:10px;border:1px solid #1d2a44"><tr><td style="padding:16px 18px">
        <div style="font:700 11px/1.2 'Segoe UI',Helvetica,Arial,sans-serif;color:#7C9CFF;text-transform:uppercase;letter-spacing:.08em;padding-bottom:11px">Your local visibility snapshot</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          <td width="58" valign="middle" style="padding:0 13px 0 0">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="width:50px;height:50px;background:#16233b;border:1px solid #29406a;border-radius:12px;font:700 24px/50px 'Segoe UI',Helvetica,Arial,sans-serif;color:#7C9CFF;text-align:center">&#8230;</td></tr></table>
          </td>
          <td valign="middle">
            <div style="font:700 14px/1.35 'Segoe UI',Helvetica,Arial,sans-serif;color:#EAF0FB">Your visibility analysis is being finalized</div>
            <div class="fs-14" style="padding-top:3px;font:400 12.5px/1.5 'Segoe UI',Helvetica,Arial,sans-serif;color:#8fa3c8">We're still verifying how customers find you online. Your full report lands in your dashboard shortly &mdash; free to keep.</div>
          </td>
        </tr></table>
      </td></tr></table>
    </td></tr>`;
  }
  const rowHtml = rows.map((row) => `<div style="padding:3px 0;font:600 13px/1.5 'Segoe UI',Helvetica,Arial,sans-serif;color:#C7D6FF">${row}</div>`).join("");

  const badge = hasGrade
    ? `<td width="72" valign="top" style="padding:2px 14px 0 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="width:58px;height:58px;background:${gradeBadgeColor(g)};border-radius:12px;font:800 26px/58px 'Segoe UI',Helvetica,Arial,sans-serif;color:#0A0F1E;text-align:center">${escapeHtml(g)}</td></tr>
        <tr><td align="center" style="padding-top:5px;font:700 9px/1.2 'Segoe UI',Helvetica,Arial,sans-serif;color:#7C9CFF;text-transform:uppercase;letter-spacing:.06em">Visibility<br>grade</td></tr></table>
      </td>`
    : "";

  return `<tr><td style="padding-top:16px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0A0F1E;border-radius:10px;border:1px solid #1d2a44"><tr><td style="padding:16px 18px">
        <div style="font:700 11px/1.2 'Segoe UI',Helvetica,Arial,sans-serif;color:#7C9CFF;text-transform:uppercase;letter-spacing:.08em;padding-bottom:12px">Your local visibility snapshot</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          ${badge}
          <td valign="top">${rowHtml}</td>
        </tr></table>
        <div class="fs-14" style="padding:12px 0 0;font:400 13px/1.5 'Segoe UI',Helvetica,Arial,sans-serif;color:#9fb0c3">The reputation is real &mdash; the new site puts it on page one, where customers look first.</div>
      </td></tr></table>
    </td></tr>`;
}


async function suppressionBlocked(prospect = {}, recipientEmail = "") {
  const email = normalizeEmail(recipientEmail || prospectValue(prospect, ["email", "owner_email", "ownerEmail"]));
  const prospectId = prospectValue(prospect, ["prospect_id", "id"]);
  const clauses = [];
  if (email) clauses.push(`email.eq.${encodeURIComponent(email)}`);
  if (prospectId) clauses.push(`prospect_id.eq.${encodeURIComponent(prospectId)}`);
  if (!clauses.length) return { blocked: false };

  const result = await select(
    "ghost_agency_suppressions",
    `?select=suppression_key,email,prospect_id&or=(${clauses.join(",")})&limit=1`,
  );
  if (!result.ok) {
    return {
      blocked: false,
      unavailable: true,
      warning: result.mode || result.status,
    };
  }
  return { blocked: (result.data || []).length > 0 };
}

const PROVIDER_TERMINAL_CONTACT_STATUSES = new Set([
  "do_not_contact", "unsubscribed", "opted_out", "suppressed", "contact_suppressed",
  "email_suppressed", "invalid_email", "email_invalid", "held", "blocked", "quarantined",
  "vertical_mismatch_sport_fencing", "closed_lost", "archived", "archived_legacy",
  "bounced", "complained",
]);

function providerPolicyCode(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function providerPolicyFlag(value) {
  return value === true || /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function providerBoundaryContactVerdict(prospect = {}, expectedEmail = "", requireStatus = false) {
  const record = prospect.record && typeof prospect.record === "object" && !Array.isArray(prospect.record)
    ? prospect.record
    : {};
  const statuses = [prospect.status, record.status].map(providerPolicyCode).filter(Boolean);
  const terminal = statuses.find((status) => PROVIDER_TERMINAL_CONTACT_STATUSES.has(status));
  if (terminal) return { ok: false, reason: terminal };
  const reason = [
    prospect.blocked_reason,
    prospect.contact_hold_reason,
    prospect.suppression_reason,
    record.blocked_reason,
    record.contact_hold_reason,
    record.suppression_reason,
  ].map(providerPolicyCode).find((value) => PROVIDER_TERMINAL_CONTACT_STATUSES.has(value));
  if (reason) return { ok: false, reason };
  for (const source of [prospect, record]) {
    if (providerPolicyFlag(source.do_not_contact)) return { ok: false, reason: "do_not_contact" };
    if (providerPolicyFlag(source.suppressed)) return { ok: false, reason: "suppressed" };
    if (providerPolicyFlag(source.contact_suppressed)) return { ok: false, reason: "contact_suppressed" };
  }
  if (requireStatus && !providerPolicyCode(prospect.status)) {
    return { ok: false, reason: "canonical_status_unavailable" };
  }
  const canonicalEmail = normalizeEmail(prospectValue(prospect, ["email", "owner_email", "ownerEmail"]));
  const expected = normalizeEmail(expectedEmail);
  if (expected && canonicalEmail !== expected) return { ok: false, reason: "canonical_recipient_changed" };
  return { ok: true, email: canonicalEmail };
}

function ownerProofFooter(prospect = {}) {
  const support = process.env.GHOST_AGENCY_SUPPORT_EMAIL?.trim() || "support@woodwardsoftware.com";
  const businessName = prospectValue(
    prospect,
    ["business_name", "businessName", "name", "company"],
    "this business",
  );
  return {
    ok: true,
    ownerProof: true,
    postal: "",
    support,
    unsubscribe: "",
    businessName,
    text: `\n\n--\nWSS Labs owner-only Practice proof\nNo prospect was emailed.\nQuestions? Email ${support}.`,
  };
}

// An owner-only proof never addresses the prospect, so prospect contact state
// (STOP, bounce, closed-lost, archive, or a suppression row) cannot authorize
// or refuse that envelope. Keep only the one terminal state that says the SITE
// itself is outside the factory's truth contract. Live/prospect delivery keeps
// the full contact policy above.
function ownerProofSiteTruthVerdict(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" && !Array.isArray(prospect.record)
    ? prospect.record
    : {};
  const values = [
    prospect.status,
    record.status,
    prospect.blocked_reason,
    prospect.contact_hold_reason,
    record.blocked_reason,
    record.contact_hold_reason,
  ].map(providerPolicyCode);
  return values.includes("vertical_mismatch_sport_fencing")
    ? { ok: false, reason: "vertical_mismatch_sport_fencing" }
    : { ok: true };
}

async function canonicalProspectAtProviderBoundary(prospectId = "") {
  const id = String(prospectId || "").trim();
  if (!id) return { ok: false, reason: "canonical_recipient_unavailable" };
  const result = await select(
    "ghost_agency_prospects",
    `?select=prospect_id,status,email,owner_email,record&prospect_id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  if (!result?.ok || !Array.isArray(result.data) || !result.data[0]) {
    return { ok: false, reason: "canonical_recipient_check_unavailable" };
  }
  const row = result.data[0];
  const record = row.record && typeof row.record === "object" && !Array.isArray(row.record) ? row.record : {};
  return { ok: true, prospect: { ...record, ...row } };
}


function canBypassDeliveryPause({ to, allowDeliveryPauseBypass, internalOwnerProof }) {
  const owner = String(process.env.GHOST_AGENCY_OWNER_EMAIL || "").trim().toLowerCase();
  return Boolean(allowDeliveryPauseBypass && internalOwnerProof && owner && String(to || "").trim().toLowerCase() === owner);
}

function canBypassReviewHold({ to, allowReviewHoldBypass, internalOwnerProof }) {
  const owner = String(process.env.GHOST_AGENCY_OWNER_EMAIL || "").trim().toLowerCase();
  return Boolean(allowReviewHoldBypass && internalOwnerProof && owner && String(to || "").trim().toLowerCase() === owner);
}

function canBypassContactHold({ to, allowContactHoldBypass, internalOwnerProof }) {
  const owner = String(process.env.GHOST_AGENCY_OWNER_EMAIL || "").trim().toLowerCase();
  return Boolean(allowContactHoldBypass && internalOwnerProof && owner && String(to || "").trim().toLowerCase() === owner);
}

function providerContactGate(prospect = {}) {
  const gate = contactSendGate(prospect);
  const record = prospect.record && typeof prospect.record === "object" && !Array.isArray(prospect.record)
    ? prospect.record
    : {};
  const explicitReasons = [];
  for (const source of [prospect, record]) {
    if (providerPolicyFlag(source.email_suppressed)) explicitReasons.push("email_suppressed");
    if (providerPolicyFlag(source.email_invalid) || providerPolicyFlag(source.invalid_email)) {
      explicitReasons.push("email_invalid");
    }
  }
  const blockedReasons = [...new Set([...(gate.blockedReasons || []), ...explicitReasons])];
  return { ...gate, blocked: blockedReasons.length > 0, blockedReasons };
}


/**
 * DURABLE OWNER-PROOF SEND EVENT. Every real owner-proof delivery — Line
 * queue settle, drain_emails, gallery resend, full-run owner-proof mode — is
 * written to the same events ledger the send-mirror-proof route already uses,
 * so delivered proof emails are reconcilable against durable records instead
 * of living only in the provider's dashboard.
 *
 * The exact existing writer shape (lib/owner-proof-delivery): an
 * insertRow into ghost_agency_events keyed by svix_id = the send's provider
 * idempotency key. A duplicate insert (23505) means this exact send is
 * already recorded — or its svix key is owned by that route's claim row —
 * and is deliberately swallowed. Accounting must never fail a send that has
 * already left the building.
 */
async function recordOwnerProofSendEvent({
  prospectId,
  idempotencyKey,
  result,
  previewUrl = "",
  now = new Date(),
} = {}) {
  try {
    const completedAt = (now instanceof Date ? now : new Date()).toISOString();
    const receipt = String((result && result.id) || "").trim();
    return await insertRow("ghost_agency_events", {
      type: PROOF_SENT_EVENT_TYPE,
      svix_id: String(idempotencyKey || "").trim() || null,
      payload: {
        status: "sent",
        prospect_id: prospectId,
        idempotency_key: String(idempotencyKey || "").trim(),
        provider_receipt: receipt,
        accepted_at: String((result && result.acceptedAt) || "").trim() || completedAt,
        completed_at: completedAt,
        owner_proof: true,
        delivery_lane: "owner_only_proof",
        source: "send_sequence_step",
        ...(previewUrl ? { preview_url: String(previewUrl) } : {}),
      },
      created_at: completedAt,
    });
  } catch {
    // Accounting must never fail a send that has already been accepted.
    return { ok: false, mode: "owner_proof_event_skipped" };
  }
}

async function sendSequenceStep({
  prospect = {},
  sequence = 1,
  step = 1,
  vars = {},
  dryRun = false,
  allowReviewHoldBypass = false,
  allowDeliveryPauseBypass = false,
  internalOwnerProof = false,
  allowBuildQualityBypass = false,
  allowContactHoldBypass = false,
  lineBatchApproved = false,
  persistCampaignLog = true,
  bcc,
  idempotencyKey = "",
  deadlineAt = 0,
  now = Date.now,
  sourceRecipientEmail = "",
  requireCanonicalRecipientGuard = false,
  requireSignalReportInEmail = false,
  verifyOwnerPracticeReceipt = null,
  requireOwnerPracticeActiveRelease = false,
  verifyOwnerPracticeActiveRelease = null,
} = {}) {
  const prospectStatus = String(prospect.status || prospect.record?.status || "").trim().toLowerCase();
  // A LINE ROW CAN ONLY BE CONTACTED THROUGH ITS APPROVED BATCH — but an
  // owner proof contacts nobody.
  //
  // internalOwnerProof is not a softer send of the same email: the recipient is
  // REPLACED with GHOST_AGENCY_OWNER_EMAIL (`const to = internalOwnerProof ?
  // owner : requestedTo[0]`), cc and bcc are forced empty, and a second
  // assertion below refuses the send outright unless `to` already equals the
  // configured owner (owner_proof_recipient_gate_failed). There is no path
  // through this flag that reaches a business, so the batch-approval gate has
  // nothing to protect here.
  //
  // Measured 2026-08-11: /api/admin/send-mirror-proof — the route whose entire
  // purpose is showing the OWNER what a finished mirror's email looks like —
  // answered line_batch_approval_required for every mirror the Line built,
  // which is every mirror in the store with a preview_url. The owner could not
  // see his own proof email without approving a batch that would mail real
  // prospects. That is the gate protecting the wrong person.
  const ownerProofSend = internalOwnerProof === true;
  if (["line_gate_passed", "line_queued"].includes(prospectStatus) && lineBatchApproved !== true && !ownerProofSend) {
    return {
      ok: false,
      blocked: "line_batch_approval_required",
      message: "A Line-built preview can contact a business only through its explicitly approved Step-3 batch.",
    };
  }
  // WHICH EMAIL IS THIS? (step selection, fixed 2026-07-31)
  //
  // Sequence 1 STEP 1 is the proof email: the full pitch, the before/after
  // comparison, the offer card. Steps 2 and 3 are short follow-ups whose copy
  // lives in lib/email-templates.js, and every step of sequences 2 and 3 is a
  // warm/intake note. Code below that keyed on `sequence` alone treated all
  // three steps as the proof email. These two flags are the single source of
  // that distinction so it cannot be lost again in a bare numeric comparison.
  const isColdSequence = Number(sequence) === 1;
  const isProofStep = isColdSequence && Number(step) === 1;
  // Every owner-only Step-1 delivery from an approved Line batch is Practice,
  // even if a legacy caller forgot the newer explicit flag. The explicit flag
  // also lets a future owner-only proof opt into this contract without widening
  // any live/prospect lane.
  const ownerPracticeProof = internalOwnerProof === true
    && isProofStep
    && (lineBatchApproved === true || requireSignalReportInEmail === true);

  const rawRecipient = prospectValue(prospect, ["email", "owner_email", "ownerEmail"]);
  const to = normalizeEmail(rawRecipient);
  const prospectId = prospectValue(prospect, ["prospect_id", "id"], "unknown");
  if (!rawRecipient) {
    return { ok: false, blocked: "missing_recipient_email" };
  }
  // Fail closed before any suppression lookup or email-provider call. Older
  // prospect rows can predate miner hygiene, so revalidate every recipient at
  // the point of send and use the canonical address everywhere below.
  if (!to) {
    return {
      ok: false,
      blocked: "invalid_recipient_email",
      message: "The recipient email is malformed or belongs to a telemetry, platform, or placeholder domain. No email was sent.",
    };
  }
  const explicitSourceRecipient = internalOwnerProof ? normalizeEmail(sourceRecipientEmail) : "";
  const suppressionEmail = explicitSourceRecipient || to;
  const ownerDeadline = () => ownerProofDeadlineStatus({
    internalOwnerProof,
    deadlineAt,
    now,
  });
  const initialOwnerDeadline = ownerDeadline();
  if (!initialOwnerDeadline.ok) return ownerProofDeadlineBlocked(initialOwnerDeadline);
  // Keep every downstream recipient-dependent path on the canonical address:
  // suppression matching, unsubscribe-token signing, audit logging, and the
  // provider payload. Preserve all non-recipient prospect identity fields.
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : null;
  prospect = {
    ...prospect,
    email: to,
    ownerEmail: to,
    owner_email: to,
    ...(record ? {
      record: {
        ...record,
        email: to,
        ownerEmail: to,
        owner_email: to,
      },
    } : {}),
  };
  const initialContact = internalOwnerProof
    ? ownerProofSiteTruthVerdict(prospect)
    : providerBoundaryContactVerdict(prospect);
  if (!initialContact.ok) return { ok: false, blocked: `prospect_status_${initialContact.reason}` };
  const suppressed = internalOwnerProof
    ? { blocked: false, ownerProofSkipped: true }
    : await suppressionBlocked(prospect, suppressionEmail || to);
  if (suppressed.blocked) {
    return { ok: false, blocked: "suppressed" };
  }
  if (suppressed.unavailable && !dryRun) {
    return {
      ok: false,
      blocked: "suppression_check_unavailable",
      message: "Suppression status could not be verified. No email was sent.",
    };
  }

  // ---- THE OWNER LOCK. AUTHORIZATION BEFORE CONTENT. ----
  // (moved here 2026-07-31; it used to sit below composition, at the point of
  // send.) Whether we are ALLOWED to mail a prospect at all does not depend on
  // whether we managed to build them a site. When the proof-first gate landed it
  // took the first refusal for every prospect without a build, so the
  // authorization decision was simply never reached and this lock reported
  // "no_preview_url". Nothing shipped — no provider call is made either way —
  // but a lock that is not evaluated is not a lock, and the reason an operator
  // sees has to be the real one.
  //
  // THE DECISION IS TAKEN UNCONDITIONALLY, on every lane, and only its
  // CONSEQUENCE is lane-dependent. Written as one short-circuited condition
  // (`!dryRun && !internalOwnerProof && !prospectSendsEnabled()`) the lock was
  // never even consulted on the dry-run and owner-proof lanes, so "the
  // authorization decision is always evaluated" was unobservable and would have
  // stayed true-looking if a later edit floated another early return above it.
  // Reading the flag first makes the evaluation a fact a test can assert on.
  // The refusal itself is unchanged: a dry run composes and sends nothing, and
  // an internal owner proof addresses the owner's own mailbox only (enforced
  // separately by owner_proof_recipient_gate_failed below), so neither is
  // refused here.
  const prospectSendLock = {
    enabled: prospectSendsEnabled(),
    dryRun: Boolean(dryRun),
    ownerProof: Boolean(internalOwnerProof),
  };
  const prospectSendAuthorized = prospectSendLock.enabled || prospectSendLock.ownerProof;
  if (!prospectSendLock.dryRun && !prospectSendAuthorized) {
    return {
      ok: false,
      blocked: "prospect_sends_disabled",
      message: "Live prospect delivery is owner-locked. Set GHOST_AGENCY_PROSPECT_SEND_ENABLED=true only after explicit approval.",
    };
  }

  let output;
  // Consent-first outreach accepts only copy merge fields. Persisted or
  // caller-supplied preview, report, checkout, screenshot, expiry, and reveal
  // artifacts never enter the template renderer.
  const emailEvidenceRecord = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  // Owner Practice may carry the operator's requested market only as an Intake
  // routing hint. Intake can legitimately copy that value into its canonical
  // facts, but copying does not turn it into observed locality evidence. Keep
  // the durable mine-time provenance authoritative so the owner proof never
  // calls a requested city a verified local market.
  const ownerProofMarketProvisional = internalOwnerProof
    && ownerPracticeMarketProvisional(emailEvidenceRecord);
  const emailTruthPacket = prospect.truth_packet && typeof prospect.truth_packet === "object"
    ? prospect.truth_packet
    : emailEvidenceRecord.truth_packet && typeof emailEvidenceRecord.truth_packet === "object"
      ? emailEvidenceRecord.truth_packet
      : {};
  const emailCanonical = emailTruthPacket.intakeGenie && typeof emailTruthPacket.intakeGenie === "object"
    ? emailTruthPacket.intakeGenie
    : emailTruthPacket.facts && typeof emailTruthPacket.facts === "object"
      ? emailTruthPacket
      : {};
  const canonicalTruthAvailableForEmail = Boolean(
    emailCanonical.facts
    && typeof emailCanonical.facts === "object"
    && Array.isArray(emailCanonical.assets)
    && Array.isArray(emailCanonical.evidence)
  );
  const earlyEmailScalar = (value) => {
    if (value === null || value === undefined || value === "") return "";
    if (value && typeof value === "object" && !Array.isArray(value)) {
      value = value.value ?? value.url ?? value.label ?? "";
    }
    return typeof value === "object" ? "" : String(value).trim();
  };
  const earlyCanonicalSources = [
    emailCanonical.facts,
    emailCanonical.trust,
    emailTruthPacket.identity,
    emailCanonical.discovery?.found?.contact,
    emailCanonical.discovery?.found,
    emailTruthPacket,
    emailCanonical,
  ].filter((source) => source && typeof source === "object" && !Array.isArray(source));
  const earlyCanonicalValue = (keys) => {
    for (const source of earlyCanonicalSources) {
      for (const key of keys) {
        const value = earlyEmailScalar(source[key]);
        if (value) return value;
      }
    }
    return "";
  };
  const earlyCanonicalItems = (keys) => {
    for (const source of earlyCanonicalSources) {
      for (const key of keys) {
        if (Array.isArray(source[key])) return source[key].filter(Boolean);
      }
    }
    return [];
  };
  const canonicalBusinessName = earlyCanonicalValue(["name", "business_name", "businessName", "company"]);
  const canonicalOwnerName = earlyCanonicalValue(
    ["owner_first_name", "ownerFirstName", "owner_name", "ownerName", "contactName"],
  );
  const canonicalIndustry = earlyCanonicalValue(["category", "industry"]);
  const canonicalCity = earlyCanonicalValue(["city"]);
  const canonicalServices = earlyCanonicalItems(["services", "primary_services", "primaryServices"]);
  const canonicalPrimaryService = earlyEmailScalar(canonicalServices[0]) || canonicalIndustry;
  const effectiveBusinessName = canonicalTruthAvailableForEmail
    ? canonicalBusinessName
    : prospectValue(prospect, ["business_name", "businessName", "name", "company"], "your business");
  const effectiveIndustry = canonicalTruthAvailableForEmail
    ? canonicalIndustry
    : prospectValue(prospect, ["industry", "category"], "local service");
  const effectiveCity = ownerProofMarketProvisional
    ? ""
    : canonicalTruthAvailableForEmail
    ? canonicalCity
    : prospectValue(prospect, ["city", "market"], "your area");
  try {
    output = render(sequence, step, defaultVars(prospect, {
      ...(vars.sender_name ? { sender_name: vars.sender_name } : {}),
      ...(vars.sender_phone ? { sender_phone: vars.sender_phone } : {}),
      ...(canonicalTruthAvailableForEmail ? {
        business_name: effectiveBusinessName || "your business",
        owner_or_team: emailGreetingName(earlyCanonicalSources, effectiveBusinessName),
        industry: effectiveIndustry || "local service",
        city: effectiveCity || "your area",
        primary_service: canonicalPrimaryService || effectiveIndustry || "local service",
        keyword_1: `${canonicalPrimaryService || effectiveIndustry || "local service"} ${effectiveCity || ""}`.trim(),
      } : {}),
    }));
  } catch (error) {
    return { ok: false, blocked: "template_error", error: error.message || String(error) };
  }

  const criticalMissing = output.missing;
  if (criticalMissing.length) {
    return {
      ok: false,
      blocked: "missing_required_template_vars",
      missing: criticalMissing,
    };
  }

  // Contact-confidence gate. lead-miner.js computes a full evidence-based
  // verdict per prospect at mine time (contact_enrichment / hold reasons);
  // until this gate existed, run-campaign/full-run/drip never looked at it and
  // sent to a suppressed, conflicting, or low-confidence-source address the
  // same as a clean one. See lib/contact-enrichment.js contactSendGate() for
  // exactly which hold reasons block a send (a merely-unverified address is
  // NOT blocked here — that is today's normal state for every mined lead).
  const contactGate = internalOwnerProof ? { blocked: false } : providerContactGate(prospect);
  if (contactGate.blocked && !canBypassContactHold({ to, allowContactHoldBypass, internalOwnerProof })) {
    return {
      ok: false,
      blocked: "contact_confidence_review_hold",
      holdReasons: contactGate.blockedReasons,
      message: "This contact's address has a known evidence problem (suppressed, conflicting, or low-confidence source) and is held for manual review instead of being sent to automatically.",
    };
  }
  // All owner-proof and sandbox sends are required to address exactly the
  // configured owner. CC/BCC are then forcibly empty at sendResendEmail().
  // Keep the contact hold above first: it is a more specific, existing reason
  // for a known-bad prospect address and still fails before composition/send.
  if (internalOwnerProof) {
    const owner = normalizeEmail(process.env.GHOST_AGENCY_OWNER_EMAIL || "");
    if (!owner || to !== owner) {
      return { ok: false, blocked: "owner_proof_recipient_gate_failed" };
    }
  }

  // An internal proof is not acquisition mail. Never mint a prospect
  // unsubscribe token into the owner's message: link scanners or an accidental
  // click would otherwise suppress the real prospect. Live mail keeps the full
  // postal, STOP, unsubscribe, and webhook contract unchanged.
  const footer = internalOwnerProof ? ownerProofFooter(prospect) : complianceFooter(prospect);
  if (!footer.ok) {
    return { ok: false, blocked: footer.error, message: footer.message };
  }

  // THE ROTATION IS THE FIRST-IMPRESSION SUBJECT, SO IT IS STEP 1's ALONE.
  //
  // Narrowed from `isColdSequence` to `isProofStep` on 2026-08-10. SUBJECT_POOL
  // is a pool of opening lines — "<Business> — I rebuilt your site, take a
  // look" — and every cold step was being stamped with one, which meant a
  // follow-up arrived pitching a rebuild to somebody who had already been
  // pitched exactly that, five days earlier, under a variant of the same
  // sentence. Steps 2 and 3 now ship the subjects written for them in
  // lib/email-templates.js ("Did you see the site we built?" / "Final email
  // about the <Business> site"), which is the whole reason those strings exist.
  //
  // Warm replies and consented intake are untouched and keep their
  // sequence-specific Re: subjects, as before.
  if (isProofStep) {
    output.subject = pchSubject({
      businessName: effectiveBusinessName,
      city: effectiveCity,
      industry: effectiveIndustry,
      prospectId,
    });
  }

  // ---- PROOF-FIRST EVIDENCE (owner directive 2026-07-30) ----
  // The consent-first template deliberately withheld preview/screenshot
  // artifacts. Proof-first inverts that: the email's entire job is to show the
  // prospect the site we already built, so the preview and the before/after are
  // load-bearing. proofReadiness below REFUSES the send when they are missing,
  // rather than shipping an email that promises a preview and renders a gap.
  const httpsOf = (...vals) => vals
    .map((v) => String(v ?? "").trim())
    .find((v) => /^https:\/\//i.test(v)) || "";
  const proofPreviewUrl = httpsOf(
    prospect.preview_url, emailEvidenceRecord.preview_url,
    prospect.reveal_url, emailEvidenceRecord.reveal_url,
  );
  const proofCurrentUrl = httpsOf(
    prospect.current_website, emailEvidenceRecord.current_website,
    emailEvidenceRecord.website, emailEvidenceRecord.site_url,
  );
  const prospectProofShots = prospect.proof_shots && typeof prospect.proof_shots === "object"
    && !Array.isArray(prospect.proof_shots) ? prospect.proof_shots : null;
  const recordProofShots = emailEvidenceRecord.proof_shots
    && typeof emailEvidenceRecord.proof_shots === "object"
    && !Array.isArray(emailEvidenceRecord.proof_shots) ? emailEvidenceRecord.proof_shots : null;
  const prospectCapturedShots = prospect.captured && prospect.captured.shots
    && typeof prospect.captured.shots === "object" && !Array.isArray(prospect.captured.shots)
    ? prospect.captured.shots : null;
  const recordCapturedShots = emailEvidenceRecord.captured && emailEvidenceRecord.captured.shots
    && typeof emailEvidenceRecord.captured.shots === "object"
    && !Array.isArray(emailEvidenceRecord.captured.shots)
    ? emailEvidenceRecord.captured.shots : null;
  const directProofBuildHash = String(
    emailEvidenceRecord.build_dispatch?.build_hash
    || emailEvidenceRecord.buildHash
    || emailEvidenceRecord.build_hash
    || prospect.buildHash
    || prospect.build_hash
    || "",
  ).trim();
  const proofIdentityState = deliveryProofIdentity({
    sources: [
      prospect.proofIdentity,
      emailEvidenceRecord.proofIdentity,
      prospectProofShots,
      recordProofShots,
      prospectCapturedShots,
      recordCapturedShots,
    ],
    buildHash: directProofBuildHash,
  });
  // Direct callers do not necessarily pass through the Line resolver. Apply
  // the same exact-tuple law here, before any signed visual can be minted.
  if (!proofIdentityState.ok) {
    return { ok: false, blocked: proofIdentityState.reason };
  }
  const proofRecordCandidates = [
    prospectProofShots,
    recordProofShots,
    prospectCapturedShots,
    recordCapturedShots,
  ];
  const exactSharedProofRecords = proofIdentityState.active
    ? proofRecordCandidates.filter((candidate) => candidate && ["site_id", "release_id", "build_hash"]
      .every((field) => String(candidate[field] || "").trim() === proofIdentityState.proofIdentity[field]))
    : [];
  // Do not merge records: a digest from one source and a landing URL from
  // another are not one capture. When several sources name the same exact
  // release, choose the strongest self-contained record. An explicit capture
  // identity refusal always wins over older complete data for that tuple.
  const sharedProofRecordScore = (candidate) => [
    candidate.old_captured_url,
    /^[0-9a-f]{16,}$/i.test(String(candidate.old_shot_sha || "")),
    candidate.new_captured_url,
    /^[0-9a-f]{64}$/i.test(String(candidate.new_shot_sha || "")),
  ].reduce((score, value) => score + (value ? 1 : 0), 0);
  const exactSharedProofRecord = proofIdentityState.active
    ? exactSharedProofRecords.find((candidate) => /^capture_identity_/.test(String(candidate.before_refused || "")))
      || exactSharedProofRecords.reduce((best, candidate) => (
        !best || sharedProofRecordScore(candidate) > sharedProofRecordScore(best) ? candidate : best
      ), null)
    : null;
  if (proofIdentityState.active && !exactSharedProofRecord) {
    return { ok: false, blocked: "shared_proof_evidence_missing" };
  }
  // Legacy/no-marker behavior deliberately retains the historical
  // first-nonempty expression. Shared mode alone selects an exact tuple match,
  // never an earlier URL-keyed legacy record.
  const proofShotRecord = proofIdentityState.active
    ? exactSharedProofRecord
    : (prospect.proof_shots || emailEvidenceRecord.proof_shots || {});
  // WHERE THE "BEFORE" SHOT ACTUALLY LANDED. The object key is derived from the
  // URL we MEANT to photograph; the bytes come from wherever the browser ended
  // up. scripts/capture-proof-shots.js records the landing URL beside the image
  // and reconciliation copies it onto the row. Absent is NOT "probably fine" —
  // it is the state every shot taken before that record existed is in, and the
  // gate below refuses all of them rather than caption a stranger's homepage
  // "YOUR SITE TODAY".
  const beforeShotSource = proofIdentityState.active
    ? httpsOf(
      proofShotRecord.old_captured_url,
      prospect.before_shot_source_url, emailEvidenceRecord.before_shot_source_url,
      prospect.beforeShotSourceUrl, emailEvidenceRecord.beforeShotSourceUrl,
    )
    : httpsOf(
      prospect.before_shot_source_url, emailEvidenceRecord.before_shot_source_url,
      prospect.beforeShotSourceUrl, emailEvidenceRecord.beforeShotSourceUrl,
      prospect.proof_shots && prospect.proof_shots.old_captured_url,
      emailEvidenceRecord.proof_shots && emailEvidenceRecord.proof_shots.old_captured_url,
    );
  const beforeShotIdentity = capturedShotBelongsTo({
    capturedUrl: beforeShotSource,
    expectedWebsite: proofCurrentUrl,
  });
  const visualBase = String(
    process.env.GHOST_AGENCY_PUBLIC_URL || "https://ghost.wss-ai.com",
  ).replace(/\/+$/, "");
  // The stored capture record for this prospect: where each shot landed, what
  // its pixels hash to, and — since the render gate started producing one — the
  // animated loop of the finished mirror.
  // A failed identity check is an explicit refusal, not missing data that an
  // older top-level source URL may repair. Keep the in-memory refusal attached
  // by the capture lane authoritative so no stale row field can mint a false
  // "before" visual after a mismatched capture.
  const beforeCaptureIdentityRefused = /^capture_identity_/.test(
    String(proofShotRecord.before_refused || ""),
  );
  // Shared-site AFTER shots are immutable-release artifacts, so their signed
  // read URL must carry the exact release tuple that selected their storage
  // key. site_id / release_id are the shared-mode markers; build_hash alone is
  // the existing legacy record shape and must keep minting the byte-identical
  // legacy URL. Once either shared marker exists, however, pass the whole tuple
  // even when it is incomplete: signedVisualPath then fails closed instead of
  // silently falling back to a mutable legacy key. BEFORE shots remain bound to
  // the prospect's own domain and keep their legacy key contract.
  const sharedProofMode = (
    Object.prototype.hasOwnProperty.call(proofShotRecord, "site_id")
    || Object.prototype.hasOwnProperty.call(proofShotRecord, "release_id")
  );
  const sharedProofIdentity = sharedProofMode ? {
    site_id: proofShotRecord.site_id,
    release_id: proofShotRecord.release_id,
    build_hash: proofShotRecord.build_hash,
  } : undefined;
  const sharedProofIdentityState = sharedProofMode
    ? normalizeVisualProofIdentity(sharedProofIdentity)
    : { active: false, valid: true };
  const sharedAfterCaptureBelongsToPreview = (capturedUrl) => {
    try {
      const captured = new URL(String(capturedUrl || "").trim());
      const expected = new URL(proofPreviewUrl);
      return captured.protocol === "https:"
        && expected.protocol === "https:"
        && captured.hostname.toLowerCase() === expected.hostname.toLowerCase();
    } catch {
      return false;
    }
  };
  const sharedAfterEvidenceIsComplete = (kind) => {
    if (!sharedProofMode) return true;
    if (!sharedProofIdentityState.valid) return false;
    const mobile = kind === "new-mobile";
    const sha = mobile ? proofShotRecord.new_mobile_shot_sha : proofShotRecord.new_shot_sha;
    const capturedUrl = mobile ? proofShotRecord.new_mobile_captured_url : proofShotRecord.new_captured_url;
    return /^[0-9a-f]{64}$/i.test(String(sha || "").trim())
      && sharedAfterCaptureBelongsToPreview(capturedUrl);
  };
  const shotUrl = (kind) => {
    // A "before" with no current website on file resolves to a spacer, which
    // renders as an empty panel beside a real "after". Refuse to mint the URL
    // at all so the readiness gate below blocks the send instead. The same
    // refusal covers a shot we cannot tie to this prospect's own domain.
    if (kind === "old"
      && (beforeCaptureIdentityRefused || !proofCurrentUrl || !beforeShotIdentity.ok)) return "";
    // SHARED RELEASES ARE COMPLETE PROOF OR NO VISUAL. Unlike the legacy
    // record, the immutable release contract always writes both the pixel SHA
    // and the URL the browser actually landed on. Requiring both here prevents
    // a lone digest (including one computed before a failed upload) from
    // minting a signed URL to a missing object. The landing host must be the
    // exact preview host, and the complete site/release/build tuple must pass
    // the same canonical validator used by the signed proxy.
    if ((kind === "new" || kind === "new-mobile")
      && !sharedAfterEvidenceIsComplete(kind)) return "";
    // THE SAME REFUSAL, FOR THE "AFTER" (added 2026-08-11).
    //
    // Only the BEFORE shot was ever checked for existence. The after URL was
    // minted unconditionally from the preview URL, so a row whose after-capture
    // never landed still produced a perfectly-signed <img> — and the route
    // answered it with the 42-byte SPACER_GIF (X-Proof-Shot: storage_400). Two
    // real prospect sends on 2026-08-11 (Harris Air, Advanced Mechanical
    // Systems) shipped exactly that: a greyscaled picture of their OLD site
    // beside an empty white panel captioned "After ▸ open it live". Both rows'
    // proof_shots held build_hash + old_shot_sha + old_captured_url and nothing
    // for the new side at all.
    //
    // proofReadiness() could not catch it: it only asserts the after value is a
    // non-empty https string, which a URL that 404s behind a spacer is. So the
    // check has to happen here, at the mint, on the same evidence the before
    // side uses. line-proof-shots records new_captured_url only after the
    // upload returns ok, and new_shot_sha beside it; either is proof the object
    // exists. Neither means no <img>, which makes the readiness gate refuse the
    // send rather than ship a hole under a caption promising a picture.
    //
    // ABSENCE OF EVIDENCE IS NOT EVIDENCE OF FAILURE, and this deliberately
    // does not conflate them. A row with NO capture record at all tells us
    // nothing about the object, and every send path that predates the record
    // is in that state — refusing those would be a blanket send-stop, not a
    // fix. A row that HAS a record (build_hash, an old shot, anything) and
    // still has nothing for the new side is different in kind: that record is
    // the capture pipeline's own account of a run in which the after shot did
    // not land. Both live rows were exactly that shape.
    if (kind === "new"
      && Object.keys(proofShotRecord).length > 0
      && !String(proofShotRecord.new_captured_url || "").trim()
      && !/^[0-9a-f]{16,}$/i.test(String(proofShotRecord.new_shot_sha || ""))) return "";
    // THE PHONE FRAME IS EVIDENCE-OR-ABSENT, STRICTER THAN THE STILLS. The
    // capture pipeline only started writing new_mobile_shot_sha on 2026-08-12,
    // so every older row has bucket objects nobody recorded. For the stills
    // that ambiguity is tolerated (see the note above); for a brand-new email
    // block there is no legacy to protect, so no recorded digest simply means
    // the mobile-vs-desktop pair does not render. Nothing is lost — the email
    // it would have appeared in ships exactly as yesterday's did.
    if (kind === "new-mobile"
      && !/^[0-9a-f]{16,}$/i.test(String(proofShotRecord.new_mobile_shot_sha || ""))) return "";
    // THEIR SITE ON A PHONE (added 2026-08-12) — the same evidence-or-absent
    // strictness as "new-mobile" (the field is brand new, there is no legacy
    // to tolerate), PLUS the before family's identity law: this picture is
    // captioned "Your site on a phone today", so it must be proven to have
    // been taken on the prospect's own registrable domain, exactly like the
    // desktop "old". line-proof-shots writes old_mobile_captured_url only
    // after its identity check and the upload BOTH passed; re-checking at the
    // mint means a hand-edited or merged-forward record still cannot caption
    // a stranger's phone render as theirs. No digest, no identity, no current
    // website -> "" -> the comparison block adapts to the ours-only pair.
    if (kind === "old-mobile") {
      if (!proofCurrentUrl) return "";
      if (!/^[0-9a-f]{16,}$/i.test(String(proofShotRecord.old_mobile_shot_sha || ""))) return "";
      const mobileIdentity = capturedShotBelongsTo({
        capturedUrl: String(proofShotRecord.old_mobile_captured_url || ""),
        expectedWebsite: proofCurrentUrl,
      });
      if (!mobileIdentity.ok) return "";
    }
    // A REVIEWER FACE — evidence-or-absent, and NO before/after identity law. A
    // reviewer's face has no tie to the prospect's own registrable domain
    // (capturedShotBelongsTo would wrongly refuse it), so it follows the gif /
    // new-mobile precedent: a mint only when the face was really fetched and
    // hosted this send. face_<n>_shot_sha is written just above, at send time,
    // by review-face-mirror; no digest -> "" -> the quote row draws a monogram,
    // exactly as before this feature. Truth-law is satisfied upstream: only a
    // real googleusercontent photo (isGoogleReviewerFace + google_places_api)
    // is ever fetched, and it is shown beside that reviewer's own quote.
    if (kind === "face-0" || kind === "face-1") {
      const faceSha = kind === "face-0" ? proofShotRecord.face_0_shot_sha : proofShotRecord.face_1_shot_sha;
      if (!/^[0-9a-f]{16,}$/i.test(String(faceSha || ""))) return "";
    }
    const rel = signedVisualPath({
      kind,
      previewUrl: proofPreviewUrl,
      currentWebsite: proofCurrentUrl,
      nonce: String(prospectId || ""),
      ...((kind === "new" || kind === "new-mobile")
        ? { proofIdentity: sharedProofIdentity }
        : {}),
    });
    if (!rel) return "";
    // CACHE-BUST ON CONTENT. Everything the signed key is built from (preview
    // URL, current site, prospect id) is stable across rebuilds, so this src
    // was identical in every email we ever sent about this prospect — and the
    // route answers `immutable, max-age=1 week`. Gmail's proxy fetched the
    // picture once and never looked again, which is why recolouring the site
    // changed nothing in the owner's inbox. The digest is of the SHIPPED PIXELS:
    // same screenshot keeps the same URL (caching still works), a changed
    // screenshot mints a URL no proxy has ever seen. It rides outside the
    // signature deliberately — it selects nothing, so it needs no authority.
    const sha = String(
      kind === "old" ? proofShotRecord.old_shot_sha || ""
        : kind === "old-mobile" ? proofShotRecord.old_mobile_shot_sha || ""
          : kind === "gif" ? proofShotRecord.anim_sha || ""
            : kind === "new-mobile" ? proofShotRecord.new_mobile_shot_sha || ""
              : kind === "face-0" ? proofShotRecord.face_0_shot_sha || ""
                : kind === "face-1" ? proofShotRecord.face_1_shot_sha || ""
                  : proofShotRecord.new_shot_sha || "",
    );
    // NO DIGEST IS NOT "NO CACHE-BUST" (added 2026-08-11).
    //
    // The bust above only ever fired when the per-kind pixel digest was on the
    // record. The AFTER side is the half that changes when we rebuild, and it
    // is also the half most likely to be missing its digest — a shot reused
    // from a pre-v2 sidecar carries no shot_sha256 — so the very URL that must
    // change across rebuilds was the one shipping un-busted and immutable for a
    // week in Gmail's proxy. That is the 2026-08-04 incident exactly: four
    // "fixed" emails arrived showing the old build because the src never
    // changed.
    //
    // build_hash is the fallback and it is content-derived in the same sense:
    // it is a sha256 over the donor tree, the facts, the brand and the content,
    // so a rebuilt mirror is a different hash and therefore a URL no proxy has
    // seen. Preferring the pixel digest keeps caching working when the pixels
    // genuinely did not change.
    const stamp = /^[0-9a-f]{16,}$/i.test(sha) ? sha : String(proofShotRecord.build_hash || "");
    // Clean-ascii assembly with a hex-only cache-bust. A control byte anywhere
    // in the URL — the 2026 source-mangling that shipped "&c<0x18>…" to Gmail —
    // is refused rather than mailed. See proofShotCacheBust / assembleShotUrl.
    return assembleShotUrl(visualBase, rel, stamp);
  };
  // THE AFTER PANEL, MOVING.
  //
  // lib/line-motion-shot has been able to encode a 1.5s loop of the client's
  // own hero playing for weeks; nothing called it, so `afterAnimUrl` — which
  // composeOutreachEmailV3 has always read, and which wins the "after" slot
  // over the still — was empty on every row ever sent and the thumbnail was a
  // static JPEG. The render gate now produces the loop alongside the stills.
  //
  // FAIL CLOSED, AND THE FALLBACK IS THE STILL. The URL is minted only when a
  // loop was really encoded and really uploaded (anim_sha is written after the
  // upload succeeds, anim_bytes is the encoded size). No loop means no key,
  // which means the composer keeps the static after-shot it ships today —
  // never an <img> pointing at an object that is not there.
  const animSha = String(proofShotRecord.anim_sha || "");
  // Shared releases cannot use this legacy URL-keyed loop: the GIF key and
  // capture do not carry site_id/release_id, so a route switch could make the
  // animation show another release while the stills remain correctly bound.
  // Until motion is tuple-bound, shared proof falls back to its verified still.
  // Legacy records keep the exact condition and URL they had before.
  const afterAnimUrl = !sharedProofMode
    && /^[0-9a-f]{16,}$/i.test(animSha)
    && Number(proofShotRecord.anim_bytes) > 0
    ? shotUrl("gif")
    : "";
  // WHICH KIND OF MOTION THE LOOP REALLY IS. The generator records its lane
  // beside the sha ("hero" = the client's own hero video playing; "pan" = a
  // scripted scroll over a page whose hero was dead), and until now nothing
  // read it — so the composer captioned a pan of a static page "live footage".
  // Carried only next to a minted loop URL: a lane with no loop is a claim
  // about nothing. The composer treats anything that is not "hero" — the pan,
  // and the empty string on rows captured before the lane was recorded — as
  // preview, never as live video. Fail-honest, exactly like the mint above
  // fails closed.
  const afterAnimLane = afterAnimUrl ? String(proofShotRecord.anim_lane || "") : "";
  // ---- REVIEWER FACES: re-host up to 2 Google photos to first-party URLs -----
  // The build stores each reviewer face as a googleusercontent URL (the mirror
  // rail renders it), but the email cannot show a third-party image. Fetch the
  // first two faces and host them through the signed preview-shot path (keyed
  // face-0 / face-1 on the preview URL); on success stamp the pixel sha onto the
  // in-memory record so shotUrl("face-N") mints a real <img>. Best-effort and in
  // parallel: any failure leaves the sha unset and the quote row draws a
  // monogram, exactly as before. Only real googleusercontent photos are fetched.
  const reviewFaceList = (() => {
    const content = emailEvidenceRecord.build_ready
      && emailEvidenceRecord.build_ready.mirror_request
      && emailEvidenceRecord.build_ready.mirror_request.content;
    const nested = content && Array.isArray(content.reviews) ? content.reviews : null;
    const raw = nested && nested.length ? nested : (Array.isArray(emailEvidenceRecord.reviews) ? emailEvidenceRecord.reviews : []);
    return raw.filter((review) => isGoogleReviewerFace(String((review && (review.avatarUrl || review.author_photo_url || review.profile_photo_url)) || "")));
  })();
  const faceSrcOf = (r) => String((r && (r.avatarUrl || r.author_photo_url || r.profile_photo_url)) || "").trim();
  if (!dryRun && proofPreviewUrl && reviewFaceList.length) {
    await Promise.all(reviewFaceList.slice(0, 2).map(async (r, i) => {
      const src = faceSrcOf(r);
      if (!isGoogleReviewerFace(src)) return;
      try {
        const hosted = await mirrorReviewFace({ avatarUrl: src, previewUrl: proofPreviewUrl, index: i });
        if (hosted && hosted.ok && /^[0-9a-f]{16,}$/i.test(String(hosted.sha || ""))) {
          proofShotRecord[`face_${i}_shot_sha`] = hosted.sha;
        }
      } catch { /* best-effort: monogram fallback */ }
    }));
  }

  const rawSignalReportCandidates = [
    prospect.report_url, prospect.reportUrl,
    emailEvidenceRecord.report_url, emailEvidenceRecord.reportUrl,
  ].map((value) => String(value ?? "").trim()).filter((value) => /^https:\/\//i.test(value));
  const rawSignalReportUrl = rawSignalReportCandidates[0] || "";
  const signalReportUrl = (ownerPracticeProof
    ? rawSignalReportCandidates.map(practiceSignalReportUrl)
    : rawSignalReportCandidates.map(safeReportUrl)
  ).find(Boolean) || "";
  let ownerPracticeReportRead = null;
  let ownerPracticeVerifiedReceipt = null;
  if (ownerPracticeProof) {
    ownerPracticeVerifiedReceipt = verifiedOwnerPracticeReceipt(
      prospect,
      emailEvidenceRecord,
      verifyOwnerPracticeReceipt,
    );
    if (!ownerPracticeVerifiedReceipt.ok) {
      return ownerPracticeSignalBlocked("owner_proof_signal_packet_unverified");
    }
  }
  const ownerPracticeWebsiteLess = Boolean(
    ownerPracticeVerifiedReceipt
    && !normalizeDomain(ownerPracticeVerifiedReceipt.receipt?.identity?.canonical_domain),
  );
  const proofCta = {
    previewUrl: proofPreviewUrl,
    revealUrl: proofPreviewUrl,
    currentUrl: proofCurrentUrl,
    currentWebsite: proofCurrentUrl,
    beforeImageSource: ownerPracticeWebsiteLess ? "" : beforeShotSource,
    beforeImage: ownerPracticeWebsiteLess ? "" : shotUrl("old"),
    afterImage: shotUrl("new"),
    // The 390px phone frame of the same mirror, for the mobile-vs-desktop
    // pair. Evidence-gated inside shotUrl: rows captured before the pipeline
    // recorded a mobile digest mint "" and the email simply has no pair.
    mobileImage: shotUrl("new-mobile"),
    // THE PROSPECT'S OWN SITE at 390 — the other half of the theirs-vs-ours
    // phone comparison. Gated harder than anything else in the family (digest
    // AND identity AND a current website); "" means the composer adapts the
    // block to the ours-only pair, never a spacer, never a stale image.
    beforeMobileImage: ownerPracticeWebsiteLess ? "" : shotUrl("old-mobile"),
    afterAnimUrl,
    afterAnimLane,
    logoUrl: httpsOf(emailEvidenceRecord.logo_url, emailEvidenceRecord.logoUrl),
    rating: emailEvidenceRecord.rating ?? "",
    reviewCount: emailEvidenceRecord.review_count ?? emailEvidenceRecord.reviewCount ?? "",
    // THE PROSPECT'S OWN GOOGLE REVIEWS, for the email's quote card. Resolved
    // HERE and not in the pure mapper because they live nested at
    // build_ready.mirror_request.content.reviews — the same list the mirror rail
    // renders, pinned by place_id. buildProofEmailInputs re-checks each quote
    // (text required, face-gated avatar, 1..5 rating) and caps at two, and an
    // empty list simply removes the card: this is a convenience source, not a
    // second ungated one.
    // The list resolved above (reviewFaceList), with a FIRST-PARTY faceUrl on the
    // first two quotes when their Google face was successfully re-hosted this
    // send. shotUrl("face-N") is evidence-gated on the sha stamped just above, so
    // a failed/absent face yields "" and the composer draws a monogram. The raw
    // googleusercontent avatarUrl is never carried past here.
    reviews: reviewFaceList.map((r, i) => (i < 2 ? { ...r, faceUrl: shotUrl(`face-${i}`) } : r)),
    address: emailEvidenceRecord.formatted_address || emailEvidenceRecord.address || "",
    // Client ID: the record's if it has one, otherwise DERIVED. It was blank on
    // every line send — the email printed "mention this when you call Riley"
    // with nothing to mention — because this only ever read a record field the
    // mirror lane does not write. clientReferenceCode is a stable hash of the
    // prospect id, which is exactly what Riley recomputes to resolve a spoken
    // code, so deriving here cannot disagree with her lookup.
    clientId: emailEvidenceRecord.client_id || emailEvidenceRecord.clientId
      || clientReferenceCode({ ...prospect, record: emailEvidenceRecord }) || "",
    // THE BUY LINK. Everything downstream of payment has been built for weeks —
    // Stripe checkout, the webhook, fulfilment, the domain purchase — and no
    // email this lane sent contained a way to pay. buildCheckoutLink() existed
    // with no caller on this path. The link is signed and carries this
    // prospect's id, so the click that follows it is attributable; an unset
    // signing secret or a prospect with no id yields "" and the composer drops
    // the button rather than rendering a 401.
    checkoutUrl: prospectCheckoutUrl({ prospect: { ...prospect, record: emailEvidenceRecord } }),
    reportUrl: signalReportUrl,
    // THEIR MEASURED COLOUR — the VERIFIED accent, and nothing before it.
    // verifiedBrandOf is the single reader: the shipped brand_truth first,
    // then build_ready.mirror_request.brand / brand_evidence — the hex the
    // mirror actually wears — and, only for contract-less legacy rows, the
    // flat brand_color as its own last resort. The flat field used to
    // short-circuit HERE, ahead of the verified accent, and that field is
    // historically a scraped CTA colour — the 2026-08-03 stale-proof
    // incident, where the email dressed itself in a button colour the site
    // never wore. Decoration, not a claim: the composer's clientAccent()
    // refuses forbidden hexes and only ever adjusts lightness.
    brandColor: verifiedBrandOf({ record: emailEvidenceRecord }).accent || "",
    hasBusinessPhotos: Array.isArray(emailEvidenceRecord.photos) && emailEvidenceRecord.photos.length > 0,
  };

  // Cold outreach (sequence 1) links the preview in every step. No proof, no send.
  if (isColdSequence) {
    // WHOSE PREVIEW IS THIS? Checked before the visuals, because a preview
    // belonging to another business is a worse failure than a missing one and
    // must never be reported as "no before/after".
    //
    // HOST FIRST (added 2026-07-31). lib/preview-host-guard.js existed and was
    // enforced on the persistence paths, but nothing applied it here — so the
    // proof email's own "Open your live preview" link was never checked against
    // the approved-host allowlist. The identity gate below cannot cover this: it
    // only refuses on a slug that CONTRADICTS the business, so a stale row
    // pointing at the retired siteforge-app-rocketsites host (bare host, no
    // slug — the exact 2026-07-23 incident) or at any third-party host carrying
    // a matching slug sails through it. Under consent-first that was survivable
    // because the URL was scrubbed out of the body; proof-first PUTS THE LINK IN
    // THE EMAIL as the whole proposition, so an unapproved host is refused.
    if (proofPreviewUrl && !isApprovedPreviewUrl(proofPreviewUrl)) {
      return {
        ok: false,
        blocked: "preview_host_not_approved",
        message: "This preview is not hosted on an approved wss-ai.com build host. Refusing to send a proof email that links a host we do not control.",
        detail: { reason: previewHostRejection(proofPreviewUrl) },
      };
    }
    if (proofPreviewUrl) {
      const bound = previewBoundToProspect(prospect, proofPreviewUrl);
      if (!bound.ok) {
        return {
          ok: false,
          blocked: bound.reason,
          message: "This preview cannot be proven to belong to this prospect. Refusing to send a proof email built around somebody else's site.",
          detail: bound,
        };
      }
    }
    // The comparison is required by the STEP THAT RENDERS IT. Step 1 shows the
    // before/after panel captioned "Your site today", so it must prove both
    // shots exist and that the "before" was captured on this prospect's own
    // domain. Steps 2 and 3 render neither image — they carry their own short
    // copy plus the preview link — so demanding the panel's artifacts of them
    // blocks a truthful email on evidence it never displays. The preview URL
    // itself, its approved host, and its binding to this prospect are still
    // required above for EVERY step, because every step links it.
    let ready = proofReadiness({
      cta: proofCta,
      // A certified website-less Practice site has no truthful "before" to
      // show. V3 already renders its verified after image full width, so keep
      // the preview gate and require that exact after visual without inventing
      // a before comparison. Live prospect mail keeps the established pair.
      requireComparison: isProofStep && !ownerPracticeWebsiteLess,
    });
    if (ready.ok && ownerPracticeWebsiteLess && !proofCta.afterImage) {
      ready = { ok: false, reason: "no_after_visual", has: { after: false } };
    }
    if (!ready.ok) {
      const message = ready.reason === "no_preview_url"
        ? "No generated preview for this prospect — the proof-first email has nothing to show. Build the site first."
        : ready.reason.startsWith("before_image_")
          ? "The 'before' screenshot cannot be tied to this prospect's own website. Refusing to caption another site's page 'YOUR SITE TODAY'. Re-capture from their current_website."
          : ready.reason === "no_after_visual"
            ? "The generated-site screenshot is unavailable. Refusing to send an owner proof with no site visual."
          : "Before/after visuals are unavailable — refusing to send a proof email with a missing comparison.";
      return {
        ok: false,
        blocked: ready.reason,
        message,
        detail: ready,
      };
    }
  }

  // Practice needs a report row, not just a UUID-shaped string. Keep this
  // after the stronger preview/proof gates, but before dashboard provisioning
  // or any email-provider work. One cached read supplies both availability and
  // grade facts: a real 200-but-ungraded row may render a neutral link; a
  // definitive 404 is a retryable pre-provider hold.
  if (ownerPracticeProof) {
    if (!signalReportUrl) {
      return ownerPracticeSignalBlocked(rawSignalReportUrl
        ? "owner_proof_signal_report_unsafe"
        : "owner_proof_signal_report_missing");
    }
    ownerPracticeReportRead = await fetchReportFacts({ reportUrl: signalReportUrl });
    if (ownerPracticeReportRead.reportExists === false) {
      return ownerPracticeSignalBlocked("owner_proof_signal_report_missing");
    }
    if (ownerPracticeReportRead.reportExists !== true) {
      return ownerPracticeSignalBlocked("owner_proof_signal_report_unavailable");
    }
    const reportIdentity = ownerPracticeReportIdentityVerdict(
      ownerPracticeReportRead,
      ownerPracticeVerifiedReceipt.receipt,
    );
    if (!reportIdentity.ok && internalOwnerProof === true) {
      ownerPracticeSignalSoftWarn(reportIdentity.reason, "compose");
    } else if (!reportIdentity.ok) {
      return ownerPracticeSignalBlocked(reportIdentity.reason);
    }
  }

  // ---- THE FOLLOW-UP CLAIMS THE PREVIEW IS UP. ASK THE HOST. ----
  //
  // Steps 2 and 3 say it in the present tense — "is ready to review", "kept the
  // preview available" — and every gate above them checks a DATABASE ROW that
  // was written at build time. Step 2 goes out five days after step 1 and step 3
  // fourteen (CADENCE in api/cron/drip-scheduler.js). Nothing in that fortnight
  // re-checked that the host still answers, and these previews are per-prospect
  // Vercel projects: the 2026-07-29 purge deleted 240 of them in one pass, none
  // of which changed a single stored preview_url. A row can therefore pass the
  // approved-host guard (it is our domain), pass the identity binding (the slug
  // is still theirs), and point at a 404.
  //
  // STEP 1 IS DELIBERATELY EXCLUDED. It is composed minutes after its own build,
  // behind its own proof gates — the shots, the comparison, the render evidence —
  // and adding a probe there would spend a request per prospect on the one step
  // that already has the strongest evidence in the pipeline. The brief for this
  // change scopes it to 2/3; so does the code.
  //
  // ORDER: LAST OF THE REFUSALS, FIRST BEFORE THE COMPOSE. Every free check —
  // suppression, the owner lock, contact confidence, the host allowlist, the
  // prospect binding, proof readiness — has already run, so a prospect who was
  // never going to be mailed does not cost an outbound request. Nothing has been
  // composed yet, so a refusal here returns with no htmlPreview, exactly like the
  // gates above it.
  //
  // FAIL CLOSED. checkPreviewLive() answers ok only on a 200; a timeout, a DNS
  // failure, a 404 and an unreadable response are all refusals, because "we could
  // not tell" and "it is down" have the same correct consequence when the
  // alternative is asserting it is up. Answers are cached per host for the run,
  // so a batch asks each host once.
  //
  // DRY RUNS DO NOT PROBE, AND SAY SO. A dry run sends nothing, so there is no
  // false claim to prevent, and the console's test-campaign path stays free of
  // outbound requests (the suite pins that: several tests install a fetch that
  // throws with "composing a dry-run email must not reach the network"). The
  // result carries `previewLiveness.checked === false` rather than an implied
  // pass, so an operator reading a dry run is never told a host was verified
  // when it was not.
  let previewLiveness = { checked: false, reason: isProofStep ? "step_1_proof_gates" : "not_cold_followup" };
  if (isColdSequence && !isProofStep) {
    if (dryRun) {
      previewLiveness = { checked: false, reason: "dry_run" };
    } else {
      const livenessDeadline = ownerDeadline();
      if (!livenessDeadline.ok) return ownerProofDeadlineBlocked(livenessDeadline);
      const live = await checkPreviewLive({ url: proofPreviewUrl });
      previewLiveness = {
        checked: true,
        ok: live.ok,
        status: live.status,
        reason: live.reason,
        cached: live.cached,
        url: live.url,
      };
      if (!live.ok) {
        return {
          ok: false,
          blocked: "preview_not_live",
          message: "The preview this follow-up says is ready did not answer 200 when asked. Refusing to tell a business their site is up while the host is not serving it. Rebuild or re-publish the mirror, then let the drip offer this prospect again.",
          detail: previewLiveness,
        };
      }
    }
  }

  // ---- WHICH COMPOSER RENDERS THIS STEP ----
  //
  // STEP 1 OF THE COLD SEQUENCE IS THE ONLY V3 LANE, and that is not a
  // conservatism — V3 has no concept of the step-2/3 follow-up copy. It takes
  // no `bodyText`, so handing it a follow-up would render the full proof pitch
  // again under a follow-up's plain-text half: precisely the D3 defect
  // (test/sequence-step-html-parity.test.js) where one message shipped as two
  // different emails and the reader's client picked which one they saw. Every
  // other step stays on outreachHtmlV2, which is step-aware.
  //
  // BOTH HALVES MOVE TOGETHER OR NEITHER DOES. V3 composes its own plain-text
  // part from the same facts as its HTML, so taking its HTML while leaving the
  // text half on the V2 template body would recreate that same defect on the
  // proof step. `composed.text` and `composed.html` below are two renderings of
  // one email; the compliance footer is then appended to the text half exactly
  // as before, from the same complianceFooter() the HTML half is given.
  //
  // The flag is DEFAULT ON (the owner wants V3 live) and only an explicit
  // off-value falls back — see proofEmailV3Enabled(). It is read here, once,
  // per send, so flipping GHOST_AGENCY_PROOF_EMAIL_V3 takes effect without a
  // redeploy.
  //
  // NOTHING ABOUT THE ENVELOPE CHANGES. The subject is still pchSubject()'s,
  // decided above at the cold-sequence branch and never V3's own; recipient
  // canonicalisation, sandbox routing, cc/bcc, idempotency, campaign logging
  // and the dry-run shape are all downstream of this and untouched.
  // Practice proof must render the Signal link in both MIME parts. Force the
  // only composer with that parity contract even if the legacy V3 switch is
  // off; ordinary prospect delivery keeps the switch unchanged.
  const useProofEmailV3 = isProofStep && (proofEmailV3Enabled() || ownerPracticeProof);

  // ---- THE GRADE COMES FROM THE PAGE WE LINK, NOT FROM OUR DATABASE ----
  //
  // The email prints a letter and a button that opens a Signal report. Those
  // used to be two different scorers: the letter came from
  // record.build_ready.qualification.composite_signal, the page from CallPrep.
  // Across every row in the store carrying both (8 rows — the entire
  // population), the score disagreed 8/8 and the letter 7/8. Goodson: we said
  // C+/77, the page says B/83. One click and the prospect catches it.
  //
  // So the letter is now READ BACK off the report itself, from the same
  // endpoint the prospect's browser calls, before the (synchronous) compose.
  // This function is async; that is the entire reason this line can exist here
  // and could never have lived inside buildProofEmailInputs.
  //
  // COST AND CEILING. One GET, no retry, ~220ms typical, hard-capped at 4s (the
  // worst measured cold start plus headroom — see lib/report-grade.js). Results
  // are cached per report id for the run, so a batch that composes the same
  // report twice pays once.
  //
  // FAIL CLOSED, AND NEVER BLOCK THE SEND. fetchReportFacts cannot throw and
  // cannot reject: unconfigured, unreachable, timed out, 401/403/404, HTML
  // instead of JSON, or a report that has not been scored yet all return
  // `facts: null`. Null means the grade, the score and the road-map reasons are
  // all omitted and the card disappears — it NEVER means "use the DB grade",
  // because "our database said C+" is exactly the wrong answer to "what does
  // the page say". The rest of the email — preview link, before/after, price
  // card, Riley — ships unchanged.
  const reportGrade = ownerPracticeReportRead || (
    useProofEmailV3
      ? await fetchReportFacts({ reportUrl: proofCta.reportUrl })
      : { ok: false, facts: null, reason: "not_v3" }
  );

  // ---- THE DASHBOARD DOOR IS PROVISIONED BEFORE IT IS PROMISED ----
  //
  // The email is about to tell a real business "here is your page, sign in with
  // this address and this PIN". That sentence is only true if the row it names
  // exists, so the row is WRITTEN HERE, first, and the PIN the email prints is
  // the one whose sha256 became that row's pin_hash in the same call. There is
  // no path where the copy and the lock can disagree.
  //
  // WHY THIS CANNOT LIVE IN buildProofEmailInputs: that module is pure and
  // synchronous by contract; this is a live upsert. Same reason `reportGrade`
  // above is fetched here and passed down.
  //
  // WHY EMAIL + PIN AND NOT A ONE-CLICK LINK: probed against production
  // 2026-08-11 — POST /api/connect/dashboard-login with a provisioned pair
  // answers 200 with a scoped token; GET /api/connect/verify-link answers 401
  // bad_signature for a #t= token signed with either secret this process can
  // hold, because prod signs with its own. A link we cannot verify is worse
  // than no link: it looks like it worked and lands on an empty login form.
  //
  // FAIL CLOSED, AND NEVER BLOCK THE SEND. A dry run is read-only, and an
  // owner-only proof must never rebind the prospect's dashboard row to the
  // agency owner. Those lanes omit the dashboard door entirely. Live prospect
  // V3 sends may provision it; any failure simply removes that door.
  //
  // preview_url is handed in explicitly because the helper derives the tenant
  // slug from it (prospectSiteSlug), and proofCta.previewUrl is the URL this
  // email is actually linking — a row scoped to a different host than the one
  // we just showed them would open the wrong site's dashboard.
  let dashboardAccess = null;
  if (useProofEmailV3 && !dryRun && !internalOwnerProof) {
    try {
      const { prospectMagicLink } = require("./wss-connect-assets/magic-link");
      const provisioned = await prospectMagicLink({
        ...prospect,
        record: emailEvidenceRecord,
        preview_url: proofCta.previewUrl || prospect.preview_url || prospect.previewUrl || "",
      });
      if (provisioned && provisioned.provisioned === true) {
        dashboardAccess = {
          provisioned: true,
          dashboardUrl: provisioned.dashboardUrl,
          // THE ONE-TAP LINK (owner, 2026-08-13). prospectMagicLink already
          // mints the signed #t= auto-login URL; it was being dropped here and
          // the email shipped a type-your-PIN door instead of a direct link.
          // Carried through so the composer's dashboard door can lead with a
          // real button. Empty-string safe: the composer falls back to the PIN
          // form when it is absent.
          magicLink: provisioned.magicLink || "",
          // THE ADDRESS THE ROW WAS WRITTEN UNDER — which is `to`, because this
          // block runs only for a real prospect V3 send. Owner proofs never
          // enter it, so reviewing a site cannot overwrite a prospect login.
          ownerEmail: to,
          pin: provisioned.pin,
        };
      }
    } catch {
      dashboardAccess = null;
    }
  }

  let text;
  let html;
  if (useProofEmailV3) {
    // Required lazily: lib/outreach-email-v3.js requires this module back for
    // gradeBadgeColor, and a top-level require would hand it a half-built copy
    // of lib/email.js whose exports are still empty.
    const { composeOutreachEmailV3 } = require("./outreach-email-v3");
    const composed = composeOutreachEmailV3(buildProofEmailInputs({
      prospect,
      record: emailEvidenceRecord,
      cta: proofCta,
      footer,
      businessName: effectiveBusinessName,
      city: effectiveCity,
      marketProvisional: ownerProofMarketProvisional,
      reportFacts: reportGrade.facts,
      // Minted above from the stored capture record, on the same signed,
      // first-party /api/media/preview-shot route as the stills. Empty unless a
      // loop was encoded AND uploaded for this mirror, which is why
      // buildProofEmailInputs accepts it as an argument rather than deriving
      // it: only a caller that has one may supply one.
      afterAnimUrl: proofCta.afterAnimUrl,
      // The lane that loop was captured in — "hero" is the only value the
      // composer will describe as live footage; everything else says preview.
      afterAnimLane: proofCta.afterAnimLane,
      // Null unless the access row was actually written above. See the note
      // there, and PROOF_EMAIL_V3_OPTION_KEYS for why all three fields travel
      // as one object.
      dashboardAccess,
      // THE LANE, STATED (2026-08-16). Only an owner proof may print a
      // dashboard sign-in that is not the prospect's own address — the mapper's
      // guard admits the owner's GHOST_AGENCY_OWNER_EMAIL on this flag alone,
      // and removes the whole door otherwise, so a live send can never tell a
      // prospect to sign in as the agency.
      sandbox: internalOwnerProof === true,
    }));
    text = composed.text + footer.text;
    html = composed.html;
  } else {
    text = output.body + footer.text;
    html = outreachHtmlV2({
      footer,
      cta: proofCta,
      unsubUrl: footer.unsubscribe,
      businessName: effectiveBusinessName,
      city: effectiveCity,
      industry: effectiveIndustry,
      senderName: String(
        vars.sender_name
        || prospect.sender_name
        || process.env.GHOST_AGENCY_SENDER_NAME
        || "Mark Woodward",
      ),
      senderCity: "Mission Viejo, CA",
      senderPhone: String(
        vars.sender_phone
        || prospect.sender_phone
        || displayPhone(agencyAgentPhone()),
      ),
      // THE STEP COPY. Empty => compose the step-1 proof template. Non-empty =>
      // compose THIS step's own copy, so the HTML half of the message says what
      // the plain-text half (`text`, above) says. composeOutreachEmailV2 did not
      // accept this parameter until 2026-07-31 and dropped it silently, which is
      // why every follow-up shipped the step-1 proof HTML; the composer now
      // rejects any option it does not read, so the same failure cannot recur.
      bodyText: isProofStep ? "" : output.body,
    });
  }

  // GHOST_AGENCY_EMAIL_V2 dark launch: with the flag off (the default) this
  // hands back the html/text composed above, byte for byte. With it on, the v2
  // template renders from the prospect record and any failure falls back to the
  // composition above — see lib/email/compose-v2-switch.cjs for why the signed
  // unsubscribe URL must come from here and not from the record.
  // Owner-only Practice is a stricter delivery contract than the V2 dark
  // launch. V3 is the only composer required to carry the Signal report in
  // both MIME parts, so a global experiment flag may not replace it.
  if (!ownerPracticeProof) {
    const { composeProspectEmail } = require("./email/compose-v2-switch.cjs");
    const v2Gate = composeProspectEmail(emailEvidenceRecord, {
      unsubscribeUrl: footer.unsubscribe,
      legacyRender: () => ({ html, text }),
    });
    html = v2Gate.html;
    text = v2Gate.text;
  }

  // Check the final provider-bound payload, after every composer switch. The
  // report may be awaiting a grade; the neutral Signal link must still survive
  // in both MIME parts, while no score or reason is invented.
  if (ownerPracticeProof) {
    if (!signalReportUrl) {
      return ownerPracticeSignalBlocked(rawSignalReportUrl
        ? "owner_proof_signal_report_unsafe"
        : "owner_proof_signal_report_missing");
    }
    const htmlSignalLink = `href="${escapeHtml(signalReportUrl)}"`;
    if (!String(html || "").includes(htmlSignalLink) || !String(text || "").includes(signalReportUrl)) {
      return ownerPracticeSignalBlocked("owner_proof_signal_report_unrenderable");
    }
  }

  // Dry-run: fully compose + pass every compliance gate, but never call Resend
  // and never write email_log (so it doesn't count as sent or block a later
  // real send). Used by the console's test-campaign runs.
  if (dryRun) {
    const senderKind = "outreach";
    return {
      ok: true,
      mode: "dry_run",
      dryRun: true,
      subject: output.subject,
      to: `${to.slice(0, 3)}***`,
      cc: internalOwnerProof ? [] : ccForKind(senderKind, to),
      bcc: [],
      ownerProof: internalOwnerProof,
      deliveryLane: internalOwnerProof ? "owner_only_proof" : "prospect",
      previewText: text.slice(0, 240),
      // THE TEXT HALF, WHOLE — the sibling of htmlPreview below (added
      // 2026-07-31). The dry run already returned the complete HTML part while
      // the text part was only ever exposed as a 240-character head, which
      // stops short of the compliance footer. That asymmetry is why the two
      // MIME parts were able to disagree about the opt-out promise without any
      // test being able to see it: there was no way to read what the text half
      // actually said. This is the exact string handed to the provider as
      // `text` a few lines below, so a test can compare the two rendered halves
      // of one composed email instead of comparing two components that only
      // resemble them. Carries nothing htmlPreview does not already carry.
      composedText: text,
      organic: Boolean(output.organic),
      organicFail: output.organicFail || null,
      bodyPreview: output.body.slice(0, 900),
      comparison: [],
      authorityText: "",
      previewExpiresOn: null,
      campaignLogPersisted: false,
      htmlPreview: html,
      // What the preview probe did, or honestly did not do. On a dry run this is
      // always `{ checked: false, reason: "dry_run" }` — see the gate above.
      previewLiveness,
      headers: oneClickUnsubscribeHeaders(footer.unsubscribe),
    };
  }

  // Re-checked at the point of send. The primary evaluation is now far above,
  // before composition; this second read costs nothing and keeps the lock true
  // even if a future edit introduces an await between there and here.
  if (!internalOwnerProof && !prospectSendsEnabled()) {
    return {
      ok: false,
      blocked: "prospect_sends_disabled",
      message: "Live prospect delivery is owner-locked. Set GHOST_AGENCY_PROSPECT_SEND_ENABLED=true only after explicit approval.",
    };
  }

  if (reviewHoldActive() && !canBypassReviewHold({ to, allowReviewHoldBypass, internalOwnerProof })) {
    return {
      ok: false,
      blocked: "outreach_review_hold",
      message: "Cold outreach is paused by GHOST_AGENCY_REVIEW_HOLD.",
    };
  }
  const deliveryDeadline = ownerDeadline();
  if (!deliveryDeadline.ok) return ownerProofDeadlineBlocked(deliveryDeadline);
  const deliveryPause = internalOwnerProof
    ? { active: false, ownerProofSkipped: true }
    : await deliveryPauseStatus();
  if (deliveryPause.active && !canBypassDeliveryPause({ to, allowDeliveryPauseBypass, internalOwnerProof })) {
    return {
      ok: false,
      blocked: "outreach_delivery_paused",
      deliveryPause,
      message: "Cold outreach is paused after crossing a delivery safety threshold.",
    };
  }

  const sender = outreachFromStatus();
  if (!sender.ok) {
    return {
      ok: false,
      blocked: "outreach_sender_not_ready",
      configured: false,
      sender,
      message: "Set GHOST_AGENCY_OUTREACH_FROM to a verified sender on go.wss-ai.com before live acquisition sends.",
    };
  }
  if (!emailConfigured("outreach")) {
    return {
      ok: false,
      blocked: "resend_not_configured",
      configured: false,
      message: "Set RESEND_API_KEY and the verified outreach sender before live acquisition sends.",
    };
  }
  if (!internalOwnerProof && !resendWebhookConfigured()) {
    return {
      ok: false,
      blocked: "resend_webhook_not_configured",
      configured: false,
      message: "Set GHOST_AGENCY_RESEND_WEBHOOK_SECRET before live acquisition sends so bounce/complaint auto-pause is armed.",
    };
  }
  const dnsDeadline = ownerDeadline();
  if (!dnsDeadline.ok) return ownerProofDeadlineBlocked(dnsDeadline);
  const outreachDns = internalOwnerProof
    ? { ok: true, ownerProofSkipped: true }
    : await outreachDnsStatus();
  if (!outreachDns.ok) {
    return {
      ok: false,
      blocked: "outreach_dns_not_verified",
      outreachDns,
      message: "Publish the go.wss-ai.com SPF/DKIM/DMARC records at the authoritative DNS provider before live acquisition sends.",
    };
  }

  const providerDeadline = ownerDeadline();
  if (!providerDeadline.ok) return ownerProofDeadlineBlocked(providerDeadline);
  if (!internalOwnerProof) {
    // Take the rate-limit slot first, then re-check at the provider boundary.
    // A STOP or hard bounce can land while this message waits in the queue.
    await waitForProspectSendSlot();
  }
  if (!dryRun) {
    let providerProspect = prospect;
    let providerSuppressionEmail = suppressionEmail || to;
    if (requireCanonicalRecipientGuard || internalOwnerProof) {
      const canonical = await canonicalProspectAtProviderBoundary(prospectId);
      if (!canonical.ok) {
        return { ok: false, blocked: canonical.reason };
      }
      const canonicalVerdict = internalOwnerProof
        ? ownerProofSiteTruthVerdict(canonical.prospect)
        : providerBoundaryContactVerdict(
            canonical.prospect,
            explicitSourceRecipient,
            requireCanonicalRecipientGuard,
          );
      if (!canonicalVerdict.ok) {
        return { ok: false, blocked: canonicalVerdict.reason };
      }
      if (ownerPracticeProof) {
        const canonicalRecord = canonical.prospect.record
          && typeof canonical.prospect.record === "object"
          && !Array.isArray(canonical.prospect.record)
          ? canonical.prospect.record
          : {};
        // Composition can await report, dashboard, and visual work before this
        // final read. If locality truth changed meanwhile, retry from the new
        // canonical snapshot instead of sending copy composed from stale facts.
        const finalMarketProvisional = ownerPracticeMarketProvisional(canonicalRecord);
        if (finalMarketProvisional !== ownerProofMarketProvisional) {
          return ownerPracticeSignalBlocked("owner_proof_market_provenance_changed");
        }
        const finalSignalUrl = [
          canonicalRecord.report_url,
          canonicalRecord.reportUrl,
        ].map(practiceSignalReportUrl).find(Boolean) || "";
        if (finalSignalUrl !== signalReportUrl && internalOwnerProof !== true) {
          return ownerPracticeSignalBlocked("owner_proof_signal_report_identity_mismatch:report_url_changed");
        } else if (finalSignalUrl !== signalReportUrl) {
          ownerPracticeSignalSoftWarn("owner_proof_signal_report_identity_mismatch:report_url_changed", "boundary");
        }
        const finalVerifiedReceipt = verifiedOwnerPracticeReceipt(
          canonical.prospect,
          canonicalRecord,
          verifyOwnerPracticeReceipt,
        );
        if (!finalVerifiedReceipt.ok) {
          return ownerPracticeSignalBlocked("owner_proof_signal_packet_unverified");
        }
        const finalReportIdentity = ownerPracticeReportIdentityVerdict(
          ownerPracticeReportRead,
          finalVerifiedReceipt.receipt,
        );
        if (!finalReportIdentity.ok && internalOwnerProof === true) {
          ownerPracticeSignalSoftWarn(finalReportIdentity.reason, "boundary");
        } else if (!finalReportIdentity.ok) {
          return ownerPracticeSignalBlocked(finalReportIdentity.reason);
        }
      }
      providerProspect = canonical.prospect;
      providerSuppressionEmail = explicitSourceRecipient
        || normalizeEmail(prospectValue(providerProspect, ["email", "owner_email", "ownerEmail"]));
      if (!providerSuppressionEmail && !internalOwnerProof) {
        return { ok: false, blocked: "canonical_recipient_unavailable" };
      }
    } else {
      const finalContact = providerBoundaryContactVerdict(providerProspect);
      if (!finalContact.ok) {
        return { ok: false, blocked: `prospect_status_${finalContact.reason}` };
      }
    }
    // This is the last awaited policy read before sendResendEmail enters the
    // provider call. It runs for owner proof too and uses the source identity,
    // never the owner address substituted into the envelope.
    const finalContactGate = internalOwnerProof ? { blocked: false } : providerContactGate(providerProspect);
    if (finalContactGate.blocked && !canBypassContactHold({
      to,
      allowContactHoldBypass,
      internalOwnerProof,
    })) {
      return {
        ok: false,
        blocked: "contact_confidence_review_hold",
        holdReasons: finalContactGate.blockedReasons,
      };
    }
    const finalSuppression = internalOwnerProof
      ? { blocked: false, ownerProofSkipped: true }
      : await suppressionBlocked(providerProspect, providerSuppressionEmail);
    if (finalSuppression.blocked) {
      return { ok: false, blocked: "suppressed" };
    }
    if (finalSuppression.unavailable) {
      return {
        ok: false,
        blocked: "suppression_check_unavailable",
        message: "Suppression status could not be re-verified. No email was sent.",
      };
    }
    if (ownerPracticeProof && requireOwnerPracticeActiveRelease === true) {
      // This callback is supplied only by the server-owned Line delivery plan.
      // Keep it after the canonical prospect + Signal checks and directly next
      // to Resend: a shared release can be quarantined while a durable
      // continuation waits between prepare() and its provider attempt.
      let exactActiveRelease = false;
      try {
        exactActiveRelease = typeof verifyOwnerPracticeActiveRelease === "function"
          && await verifyOwnerPracticeActiveRelease({ deadlineAt, now }) === true;
      } catch { /* fail closed below before entering the provider */ }
      if (!exactActiveRelease) {
        return {
          ...ownerPracticeSignalBlocked("owner_proof_public_release_unavailable"),
          releaseFailureKind: "transient",
        };
      }
    }
  }
  const result = await sendResendEmail({
    senderKind: "outreach",
    to,
    ...(bcc ? { bcc } : {}),
    internalOwnerProof,
    deadlineAt,
    now,
    subject: output.subject,
    text,
    html,
    headers: oneClickUnsubscribeHeaders(footer.unsubscribe),
    // A server-owned Line worker supplies one stable key for BOTH live sends
    // and owner proofs. Legacy callers keep the established prospect key.
    idempotencyKey: String(idempotencyKey || "").trim() || (internalOwnerProof
      ? ""
      : `ghost-outreach-${emailHash(
          ["consent-v1", prospectId, to, sequence, step].join("\u0000"),
        )}`),
  });

  if (!internalOwnerProof) {
    await recordEvent("outreach.email_sent", {
      runId: vars.run_id || vars.runId || null,
      prospectId,
      sequence,
      step,
      template: output.name,
      mode: result.mode,
      resendId: result.id,
      blocked: result.blocked || result.reason || result.error,
    });
  } else if (result.mode === "sent") {
    // DURABLE OWNER-PROOF ACCOUNTING (2026-09-03). The 42 owner-proof emails
    // the Line lane delivered since Aug 31 left NO durable record: both the
    // queue settle path and drain_emails land here with internalOwnerProof,
    // and both the campaign log below and this event channel were gated off.
    // The campaign log below now records owner proofs (marked, so no campaign
    // metric counts them); this event names the same send in the established
    // proof channel the Gallery and drawer already read. Fail-soft: the email
    // has already been accepted by the provider.
    await recordOwnerProofSendEvent({
      prospectId,
      idempotencyKey,
      result,
      previewUrl: prospect.preview_url || prospect.previewUrl || "",
    });
  }

  if (result.mode === "sent" || result.mode === "dry_run") {
    // persistCampaignLog used to skip owner proofs entirely — which is why
    // real owner-proof deliveries had no email_log row at all. Every real
    // send is now recorded; the payload's ownerProof/sandbox/deliveryLane/
    // isProspectSend markings (read by ledger-data, morning-report,
    // console-data and the drawer) keep them out of campaign truth, exactly
    // as those readers were already built to expect.
    if (persistCampaignLog) {
      await upsertRow(
        "ghost_agency_email_log",
        {
          prospect_id: prospectId,
          sequence,
          step,
          suppressed: false,
          mode: result.mode,
          payload: {
            runId: vars.run_id || vars.runId || null,
            to: `${to.slice(0, 3)}***`,
            email_hash: emailHash(to),
            cc: result.cc || [],
            bcc: result.bcc || [],
            subject: output.subject,
            resendId: result.id,
            // Explicitly mark internal/sandbox proof deliveries. Console and
            // drip progression must never treat these as prospect outreach.
            ownerProof: internalOwnerProof,
            sandbox: internalOwnerProof,
            deliveryLane: internalOwnerProof ? "owner_only_proof" : "prospect",
            isProspectSend: !internalOwnerProof,
          },
        },
        "prospect_id,sequence,step",
      );
    }
  }

  return {
    ok: result.mode === "sent",
    mode: result.mode,
    id: result.id,
    from: result.from,
    error: result.error,
    blocked: result.blocked,
    reason: result.reason,
    configured: result.configured,
    ownerProof: internalOwnerProof,
    deliveryLane: internalOwnerProof ? "owner_only_proof" : "prospect",
    previewLiveness,
    campaignLogPersisted: Boolean(
      persistCampaignLog
      && (result.mode === "sent" || result.mode === "dry_run")
    ),
  };
}

// Sent once, right after a paid checkout completes (see lib/fulfillment.js).
// This is the one message a real customer needs to keep: their login, their
// support line, and the Connect app where their leads land. Kept visually
// consistent with the rest of the WSS Labs brand (dark header, violet/blue
// gradient, same footer as cold outreach) so it doesn't look like a
// different, sketchier company sent it.
// ============================================================================
// DESIGN LOCK (Mark-approved 2026-07-19): This template's palette, typography
// and layout are FINAL. Steel/graphite/amber — deliberately masculine; no
// violet/pink gradients. Do NOT restyle, "improve", or revert this template
// (Codex/Vercel agents included). Content-only changes require Mark's OK.
// ============================================================================
function buildActivationEmail({ businessName = "", ownerEmail = "", pin = "", magicLink = "", jobId = "", businessLogoUrl = "", client = null } = {}) {
  const name = escapeHtml(businessName || "your business");
  const clientLogo = /^https:\/\//.test(String(businessLogoUrl || "")) ? String(businessLogoUrl) : "";
  const supportEmail = process.env.GHOST_AGENCY_SUPPORT_EMAIL || "support@woodwardsoftware.com";
  // THIS customer's Riley line first; the configured agency line only as a last
  // resort, because this particular email is the agency speaking to a customer
  // it just onboarded. Nothing resolvable -> the phone is omitted from both the
  // HTML step and the plain-text step. No fallback number exists to print.
  const rileyLine = resolveRileyLine({ client: client || {}, allowAgencyLine: true });
  const dashboardUrl = "https://wss-ai.com/dashboard";
  const connectUrl = "https://connect.wss-labs.com";

  const dashHref = htmlUrl(magicLink || dashboardUrl);
  const telHref = rileyLine.telHref;
  const agentPhoneDisplay = rileyLine.display;
  // Each step gets its own gradient badge + emoji so the sequence reads as a
  // vivid, colour-coded journey rather than a flat numbered list.
  // Masculine, workshop-grade palette: steel blue, forge green, amber, gunmetal.
  const steps = [
    { g: "linear-gradient(135deg,#2C4FB8,#4A6CF7)", bg: "#2C4FB8", emo: "&#127959;&#65039;", t: "WE BUILD & VERIFY", d: "Your site is assembled from verified business facts and wired to your own domain." },
    { g: "linear-gradient(135deg,#1F8A5B,#2FB47C)", bg: "#1F8A5B", emo: "&#128200;", t: "YOU REVIEW IT LIVE", d: `Your <a href="${dashHref}" style="color:#1F8A5B;font-weight:700;text-decoration:none">dashboard</a> shows the site, your leads and your visibility grade the moment they're ready.` },
    { g: "linear-gradient(135deg,#B87718,#E0A44A)", bg: "#B87718", emo: "&#128231;", t: "LEADS LAND IN GETLEADS", d: `Calls, texts and website messages arrive in one inbox at <a href="${htmlUrl(connectUrl)}" style="color:#B87718;font-weight:700;text-decoration:none">connect.wss-labs.com</a> &mdash; same login.` },
    { g: "linear-gradient(135deg,#3A4A6B,#5C7099)", bg: "#3A4A6B", emo: "&#128295;", t: "CHANGE ANYTHING, INSTANTLY", d: `Call, text or email Riley${agentPhoneDisplay ? ` at <a href="${telHref}" style="color:#3A4A6B;font-weight:700;text-decoration:none">${escapeHtml(agentPhoneDisplay)}</a>` : ""} and watch your site update.` },
  ];
  const stepsHtml = steps.map((s, i) => `
        <tr><td style="padding:9px 0">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td width="52" valign="top">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle"
                style="width:42px;height:42px;border-radius:12px;background:${s.bg};background-image:${s.g};
                box-shadow:0 6px 16px rgba(90,90,160,.28);font-size:20px;line-height:42px">${s.emo}</td></tr></table>
            </td>
            <td valign="top" style="padding-left:6px">
              <div style="font-weight:800;font-size:15px;color:#141824">${s.t}</div>
              <div style="font-size:13.5px;color:#57606b;line-height:1.5;margin-top:2px">${s.d}</div>
            </td>
          </tr></table>
        </td></tr>${i < steps.length - 1 ? '<tr><td style="padding:0 0 0 52px"><div style="height:1px;background:linear-gradient(90deg,#e6e9ef,transparent)"></div></td></tr>' : ""}`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>You're activated &mdash; ${name}</title>
  </head><body style="margin:0;padding:0;background:#0A0F1E;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1c2620">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your WSS Labs login, dashboard and lead inbox — everything to run ${name}, in one place.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0F1E;background-image:radial-gradient(1100px 460px at 50% -140px,rgba(124,108,246,.45),transparent 60%)">
  <tr><td align="center" style="padding:30px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(5,8,20,.55)">

    <!-- header — steel plate, sharp edges -->
    <tr><td style="padding:22px 30px 18px;background:#0A0F1E;background-image:linear-gradient(135deg,#0A0F1E 0%,#0E1830 60%,#12224A 100%);border-bottom:2px solid #2C4FB8">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle"><img src="https://wss-ai.com/assets/apple-touch-icon.png" width="40" height="40" alt="WSS Labs" style="display:block;border-radius:9px"/></td>
        <td valign="middle" style="padding-left:12px">
          <div style="font-size:20px;font-weight:900;letter-spacing:.02em;color:#ffffff;line-height:1;font-family:Arial,Helvetica,sans-serif">WSS <span style="font-weight:700;color:#7FA0FF">LABS</span></div>
          <div style="font-size:9.5px;letter-spacing:.3em;color:#5C7099;margin-top:3px;font-weight:700">MANAGED WEBSITES</div>
        </td>
      </tr></table>
    </td></tr>

    <!-- activation band — dark steel, their brand beside ours -->
    <tr><td style="padding:0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td
        style="padding:24px 30px;background:#101B33;background-image:linear-gradient(120deg,#0E1830 0%,#16294F 55%,#1F3A75 100%);border-bottom:3px solid #E0A44A">
        <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#E0A44A;font-weight:800">&#9889; YOU'RE ACTIVATED</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr>
          ${clientLogo ? `<td valign="middle" style="padding-right:14px"><div style="width:52px;height:52px;border-radius:8px;background:#ffffff;border:1px solid #3A4A6B;text-align:center;line-height:52px;overflow:hidden"><img src="${htmlUrl(clientLogo)}" width="44" height="44" alt="" style="vertical-align:middle;max-width:44px;max-height:44px;border:0"></div></td>` : ""}
          <td valign="middle"><div style="font-size:26px;line-height:1.2;font-weight:900;color:#ffffff;font-family:Arial,Helvetica,sans-serif">Welcome to WSS Labs,<br>${name}.</div></td>
        </tr></table>
      </td></tr></table>
    </td></tr>

    <tr><td style="padding:26px 30px 8px">
      <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3a424c">Your managed website is being built and connected right now. Everything you need is below &mdash; keep this email as your permanent home base.</p>

      <!-- primary CTA (bulletproof) -->
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:2px 0 20px">
        <a href="${dashHref}" style="display:inline-block;padding:15px 36px;border-radius:8px;background:#2C4FB8;background-image:linear-gradient(135deg,#2C4FB8,#4A6CF7);color:#ffffff;font-weight:900;font-size:15px;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;box-shadow:0 10px 24px rgba(44,79,184,.5);border:1px solid #4A6CF7;font-family:Arial,Helvetica,sans-serif">Open My Dashboard &#8599;</a>
      </td></tr></table>

      <!-- glassy credential card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;border-radius:10px;background:#0A0F1E;background-image:linear-gradient(160deg,#0E1830 0%,#0A0F1E 60%),radial-gradient(600px 200px at 90% -20%,rgba(44,79,184,.55),transparent);border:1px solid #1F3A75">
        <tr><td style="padding:20px 22px">
          <div style="font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:#5C7099;font-weight:800;margin-bottom:8px">YOUR LOGIN &middot; SAVE THIS</div>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td valign="middle"><div style="font-size:38px;font-weight:900;letter-spacing:.16em;color:#ffffff;text-shadow:0 2px 18px rgba(74,108,247,.55);font-family:Arial,Helvetica,sans-serif">${escapeHtml(pin || "")}</div></td>
            <td valign="middle" align="right"><span style="display:inline-block;font-size:11px;font-weight:700;color:#7FA0FF;background:rgba(44,79,184,.25);border:1px solid #2C4FB8;border-radius:6px;padding:5px 11px">6-DIGIT PIN</span></td>
          </tr></table>
          <div style="height:1px;background:linear-gradient(90deg,rgba(255,255,255,.16),transparent);margin:14px 0"></div>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:13.5px">
            <tr><td style="padding:6px 0;color:#8fa3c8">Email</td><td align="right" style="padding:6px 0"><a href="mailto:${escapeHtml(ownerEmail || "")}" style="color:#cdd7ff;text-decoration:none;font-weight:600">${escapeHtml(ownerEmail || "on file")}</a></td></tr>
            <tr><td style="padding:6px 0;color:#8fa3c8">Dashboard</td><td align="right" style="padding:6px 0"><a href="${dashHref}" style="color:#cdd7ff;text-decoration:none;font-weight:600">wss-ai.com/dashboard &#8599;</a></td></tr>
            <tr><td style="padding:6px 0;color:#8fa3c8">Lead inbox</td><td align="right" style="padding:6px 0"><a href="${htmlUrl(connectUrl)}" style="color:#cdd7ff;text-decoration:none;font-weight:600">connect.wss-labs.com &#8599;</a></td></tr>
            <tr><td style="padding:6px 0;color:#8fa3c8">Reference</td><td align="right" style="padding:6px 0;color:#5f6b8c">${escapeHtml(jobId || "")}</td></tr>
          </table>
          <div style="font-size:11.5px;color:#6b7699;margin-top:12px;line-height:1.4">Tap any line to open it. On your phone, press and hold the PIN to copy.</div>
        </td></tr>
      </table>

      <!-- what happens next -->
      <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#2C4FB8;font-weight:900;margin:6px 0 4px;border-left:3px solid #E0A44A;padding-left:9px">WHAT HAPPENS NEXT</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${stepsHtml}</table>

      <!-- PWA install callout -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;border-radius:10px;background:#F2F4F8;border:1px solid #D5DCE8;border-left:4px solid #2C4FB8">
        <tr><td style="padding:18px 20px">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td width="46" valign="top"><div style="width:40px;height:40px;border-radius:8px;background-image:linear-gradient(135deg,#4A6CF7,#7C6CF6);font-size:20px;line-height:40px;text-align:center">&#128241;</div></td>
            <td valign="top" style="padding-left:8px">
              <div style="font-weight:900;font-size:14.5px;color:#141824;font-family:Arial,Helvetica,sans-serif">Put your leads on your home screen</div>
              <div style="font-size:13px;color:#57606b;line-height:1.5;margin-top:3px">Open <a href="${htmlUrl(connectUrl)}" style="color:#2C4FB8;font-weight:700;text-decoration:none">connect.wss-labs.com</a>, then tap your browser menu &rarr; <b>Install app</b> (or <b>Add to Home Screen</b>). It opens like a real app &mdash; one tap to every call, text and message.</div>
            </td>
          </tr></table>
        </td></tr>
      </table>

      <p style="margin:20px 0 4px;font-size:13.5px;color:#57606b">Questions any time &mdash; a real person replies: <a href="mailto:${escapeHtml(supportEmail)}" style="color:#2C4FB8;font-weight:700;text-decoration:none">${escapeHtml(supportEmail)}</a></p>
    </td></tr>

    <!-- footer -->
    <tr><td style="padding:22px 30px;background:#0A0F1E;color:#7a85a6;font-size:12px;line-height:1.7">
      <div style="font-size:15px;font-weight:800;color:#ffffff;margin-bottom:8px">WSS <span style="font-weight:600;color:#8fa3c8">Labs</span></div>
      WSS Labs &middot; a Woodward Software Systems company<br>
      655 S Main St, Suite 200, Orange, CA 92868 &middot; <a href="https://wss-ai.com" style="color:#9db0ff;text-decoration:none">wss-ai.com</a>
    </td></tr>
  </table></td></tr></table>
  </body></html>`;

  const text = `Welcome to WSS Labs, ${businessName || "your business"}.

Your managed website is being built and connected.

YOUR LOGIN (save this)
PIN: ${pin}
Email: ${ownerEmail || "on file"}
Dashboard: ${dashboardUrl}
One-click link: ${magicLink || dashboardUrl}
Job reference: ${jobId}

WHAT HAPPENS NEXT
1. We build and verify your site from verified business facts.
2. You review it live on your dashboard, including leads and your visibility grade.
3. Leads land in GetLeads (${connectUrl}) - same login, one inbox.
4. Need a change? Call, text, or email Riley${agentPhoneDisplay ? ` at ${agentPhoneDisplay}` : ""} and watch your site update.

Questions any time: ${supportEmail}

WSS Labs, a Woodward Software Systems company
655 S Main St, Suite 200, Orange, CA 92868`;

  return {
    subject: `You're activated, ${businessName || "welcome to WSS Labs"} — here's your login`,
    html,
    text,
  };
}

module.exports = {
  agencyAgentPhone,
  buildActivationEmail,
  visibilitySnapshotCard,
  gradeBadgeColor,
  proofShotCacheBust,
  assembleShotUrl,
  canBypassDeliveryPause,
  canBypassReviewHold,
  canBypassContactHold,
  emailConfigured,
  resendWebhookConfigured,
  reviewHoldActive,
  oneClickUnsubscribeHeaders,
  outreachBuildQuality,
  releasePacketMatchesCurrentBuild,
  sendResendEmail,
  sendSequenceStep,
  suppressionBlocked,
};
