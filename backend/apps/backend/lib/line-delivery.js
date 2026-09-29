"use strict";

// Server-owned delivery for the operator Line.
//
// A worker may be restarted between approval and delivery.  Consequently this
// module never trusts the recipient carried by the batch row: it reloads the
// canonical prospect immediately before composing the email.  Live delivery
// additionally binds that address to the fingerprint captured when the row was
// queued.  A changed or missing fingerprint requires a new human approval.

const { createHash, timingSafeEqual } = require("node:crypto");
const { canonicalCallPrepReportUrl } = require("./callprep-client");
const { normalizeProofUrl } = require("./proof-storage");
const { contactSendGate, normalizeEmail } = require("./contact-enrichment");
const { safeReportUrl } = require("./report-url");

const PROSPECTS = "ghost_agency_prospects";
const SUPPRESSIONS = "ghost_agency_suppressions";

const LIVE_SWITCH = "GHOST_AGENCY_LINE_LIVE_SENDS";
const SAFE_CODE = /^[a-z][a-z0-9_.:-]{0,79}$/i;
const EVIDENCE_MAX_MS = 90_000;
const PROVIDER_RESERVE_MS = 30_000;
const PUBLIC_RELEASE_VERIFY_MAX_MS = 60_000;
const DELIVERY_INPUT_SCHEMA = "ghost-line-delivery-input@v1";
const preparedInputs = new WeakMap();
let defaultSharedPublisher = null;
const DELIVERY_TERMINAL_STATUSES = new Set([
  "sent", "delivered", "contacted", "replied", "converted", "paid",
  "opted_out", "unsubscribed", "do_not_contact", "bounced", "complained",
  "closed_lost", "archived", "archived_legacy", "retiring", "retired",
  "suppressed", "contact_suppressed", "email_suppressed",
  "invalid_email", "email_invalid", "held", "blocked", "quarantined",
  "vertical_mismatch_sport_fencing",
]);
const DELIVERY_TERMINAL_REASONS = new Set([
  "opted_out", "unsubscribed", "do_not_contact", "suppressed",
  "contact_suppressed", "email_suppressed", "invalid_email", "email_invalid",
  "held", "blocked", "quarantined", "vertical_mismatch_sport_fencing", "retiring", "retired",
]);
const EMAIL_UNVERIFIED_REASONS = new Set([
  "no_contact_evidence", "email_conflict_review_required",
  "email_reachability_unverified", "email_unreachable",
  "email_confidence_below_threshold",
]);

function text(value) {
  return String(value == null ? "" : value).trim();
}

function positiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Provider idempotency identity.  Recipient, lane, time and worker identity are
 * intentionally absent: an address refresh or a retry cannot mint a second
 * provider operation for the same approved Line step.
 */
function lineDeliveryIdempotencyKey({ batchId, prospectId, sequence = 1, step = 1 } = {}) {
  const batch = text(batchId);
  const prospect = text(prospectId);
  if (!batch || !prospect) return "";
  const digest = createHash("sha256")
    .update([batch, prospect, positiveInteger(sequence), positiveInteger(step)].join("\u0000"))
    .digest("hex");
  return `ghost-line-${digest}`;
}

/**
 * Stable owner-proof identity. The exact durable Line build, shared release,
 * canonical preview URL, and configured owner are bound so a rebuild, release,
 * route, or recipient change cannot inherit an older receipt. An HTTP/queue
 * retry of the same proof still cannot mint a second provider operation.
 */
function ownerProofIdempotencyKey({
  batchId,
  prospectId,
  buildHash,
  releaseId,
  previewUrl,
  recipient,
} = {}) {
  const batch = text(batchId);
  const prospect = text(prospectId);
  const build = text(buildHash).toLowerCase();
  const release = text(releaseId);
  const preview = normalizeProofUrl(previewUrl);
  const owner = normalizeEmail(recipient);
  if (!batch || !prospect || !/^[a-f0-9]{64}$/.test(build) || !release || !preview || !owner) return "";
  const digest = createHash("sha256")
    .update(["owner-proof-v2", batch, prospect, build, release, preview, owner].join("\u0000"))
    .digest("hex");
  return `ghost-owner-proof-${digest}`;
}

function storedRecipientFingerprint(row = {}) {
  return text(
    row.recipientFingerprint
    || row.recipient_fingerprint
    || (row.payload && (row.payload.recipientFingerprint || row.payload.recipient_fingerprint)),
  ).toLowerCase();
}

function fingerprintsMatch(stored, current) {
  const left = text(stored).toLowerCase();
  const right = text(current).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value)
      // Deadlines and clock functions control transport bounds; they do not
      // change the deterministic message or provider envelope.
      .filter((key) => !["deadlineAt", "now", "updated_at", "updatedAt"].includes(key))
      .filter((key) => value[key] !== undefined && typeof value[key] !== "function")
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return "null";
}

/**
 * Bind every deterministic input at the sendSequenceStep boundary. The hash
 * may be persisted, but the canonical input (which contains the recipient and
 * rendered-email facts) remains process-local.
 */
function deliveryInputFingerprint({ lane, batchId, input } = {}) {
  const immutableLane = lane === "live" ? "live" : (lane === "sandbox" ? "sandbox" : "");
  const immutableBatchId = text(batchId);
  if (!immutableLane || !immutableBatchId || !input || typeof input !== "object") return "";
  return createHash("sha256")
    .update(canonicalJson({ schema: DELIVERY_INPUT_SCHEMA, lane: immutableLane, batchId: immutableBatchId, input }))
    .digest("hex");
}

function safeIsoDate(value) {
  const parsed = value instanceof Date ? value : new Date(value || "");
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

async function verifyActivePublicRelease(input) {
  if (!defaultSharedPublisher) {
    const { createDefaultSharedSitePublisher } = require("./shared-site-publisher");
    defaultSharedPublisher = createDefaultSharedSitePublisher();
  }
  return defaultSharedPublisher.verifyActiveRelease(input);
}

function releaseEvidenceOf(row) {
  return objectOf(row && (row.releaseEvidence || row.release_evidence))
    || objectOf(row && row.buildEvidence && row.buildEvidence.release_evidence)
    || objectOf(row && row.build_evidence && row.build_evidence.release_evidence);
}

/**
 * The durable prospect record's own signed release evidence, in write order.
 * mirrorRecordPatch persists the build's signed manifest at BUILD time
 * (record.build_dispatch.release_evidence and record.mirror_release_evidence),
 * independently of whatever the batch row later carries. A row drained after a
 * lost preview-url CAS may have none of its own proof fields — this signed,
 * already gate-verified evidence is what remains, so the sender reads it too.
 * Every candidate still feeds the same deliveryProofIdentity reconciliation
 * (all marked sources must agree); nothing here bypasses verification.
 */
function durableRecordReleaseEvidences(record) {
  const dispatch = objectOf(record && (record.build_dispatch || record.buildDispatch));
  return [
    releaseEvidenceOf(record),
    objectOf(dispatch && (dispatch.release_evidence || dispatch.releaseEvidence)),
    objectOf(record && record.mirror_release_evidence),
    dispatch,
  ].filter(Boolean);
}

function sharedReleaseVerificationInput(row, proofIdentity, previewUrl, buildHash, deps) {
  const release = releaseEvidenceOf(row);
  const releaseProof = objectOf(release && (release.proofIdentity || release.proof_identity));
  const shared = objectOf(release && (release.sharedReleaseEvidence || release.shared_release_evidence));
  if (!release || !releaseProof || !shared) return null;

  const identity = deps.deliveryProofIdentity({
    sources: [proofIdentity, releaseProof, shared],
    buildHash,
  });
  let host = "";
  try {
    const parsed = new URL(previewUrl);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password
      && parsed.pathname === "/" && !parsed.search && !parsed.hash) host = parsed.hostname;
  } catch { /* exact public verifier below remains fail-closed */ }
  if (!identity.ok || !identity.active || !host
    || release.build_hash !== buildHash || release.preview_url !== previewUrl
    || shared.evidence_schema !== "shared-site-release-evidence-v1" || shared.state !== "active"
    || shared.site_id !== proofIdentity.site_id || shared.release_id !== proofIdentity.release_id
    || shared.build_hash !== buildHash || shared.canonical_host !== host) {
    return null;
  }
  return Object.freeze({
    proofIdentity: Object.freeze({ ...identity.proofIdentity }),
    releaseEvidence: shared,
    previewUrl,
    buildHash,
  });
}

function publicReleaseMatchesIdentity(receipt, expected) {
  const proof = expected && expected.proofIdentity;
  return Boolean(
    receipt && receipt.ok === true && receipt.fallback === false
    && receipt.previewUrl === (expected && expected.previewUrl)
    && receipt.siteId === (proof && proof.site_id)
    && receipt.releaseId === (proof && proof.release_id)
    && receipt.buildHash === (expected && expected.buildHash),
  );
}

async function exactActiveSharedRelease(sharedReleaseVerification, deps, deadlineAt = 0) {
  if (!sharedReleaseVerification) return false;
  const requestedDeadline = Number(deadlineAt);
  const verificationDeadline = Math.min(
    Number.isFinite(requestedDeadline) && requestedDeadline > 0 ? requestedDeadline : Infinity,
    Date.now() + PUBLIC_RELEASE_VERIFY_MAX_MS,
  );
  let publicRelease = null;
  try {
    publicRelease = await beforeDeadline(() => deps.verifyActiveRelease({
      proofIdentity: sharedReleaseVerification.proofIdentity,
      releaseEvidence: sharedReleaseVerification.releaseEvidence,
      previewUrl: sharedReleaseVerification.previewUrl,
      deadlineAt: verificationDeadline,
    }), verificationDeadline, "owner_proof_public_release_deadline");
  } catch { /* fail closed below; no provider call has started */ }
  return publicReleaseMatchesIdentity(publicRelease, sharedReleaseVerification);
}

// Only stable machine codes cross this module boundary.  Provider messages can
// contain the address they rejected; returning those would put PII into queue
// logs and batch snapshots.
function safeCode(value, fallback = "delivery_refused") {
  const candidate = text(value);
  const possiblePhone = /(?:\+?\d[\s().-]*){7,}/.test(candidate);
  return SAFE_CODE.test(candidate) && !candidate.includes("@") && !possiblePhone
    ? candidate
    : fallback;
}

function sportFencingDeliveryHold(durable) {
  if (!durable || typeof durable !== "object") return false;
  const record = durable.record && typeof durable.record === "object" ? durable.record : {};
  const reasons = [
    durable.blocked_reason,
    durable.vertical_hold && durable.vertical_hold.reason,
    record.blocked_reason,
    record.vertical_hold && record.vertical_hold.reason,
  ].map((value) => text(value).toLowerCase());
  // The vertical mismatch is a truth hold, not a workflow-state hint. A later
  // queue/status write cannot release it accidentally; only an explicit
  // reclassification that clears every durable reason field can do that.
  const statuses = [
    durable.status,
    durable.contact_status,
    durable.outreach_status,
    record.status,
    record.contact_status,
    record.outreach_status,
  ].map((value) => text(value).toLowerCase().replace(/[\s-]+/g, "_"));
  return reasons.includes("vertical_mismatch_sport_fencing")
    || statuses.includes("vertical_mismatch_sport_fencing");
}

function recordOf(durable) {
  return durable && durable.record && typeof durable.record === "object" && !Array.isArray(durable.record)
    ? durable.record
    : {};
}

function durableSharedReleaseVerification(durable, deps) {
  const record = recordOf(durable);
  const dispatch = objectOf(record.build_dispatch) || objectOf(record.buildDispatch);
  const release = releaseEvidenceOf(durable)
    || durableRecordReleaseEvidences(record)[0]
    || null;
  const proofIdentity = objectOf(release && (release.proofIdentity || release.proof_identity));
  const previewUrl = text(
    durable && (durable.preview_url || durable.previewUrl)
    || record.preview_url
    || record.previewUrl
    || release && (release.preview_url || release.previewUrl),
  );
  const buildHash = text(
    dispatch && (dispatch.build_hash || dispatch.buildHash)
    || release && (release.build_hash || release.buildHash),
  );
  if (!release || !proofIdentity || !previewUrl || !buildHash) return null;
  return sharedReleaseVerificationInput(
    { releaseEvidence: release },
    proofIdentity,
    previewUrl,
    buildHash,
    deps,
  );
}

function sameSharedReleaseVerification(left, right) {
  // "No shared-release contract on either side" is the unchanged LEGACY
  // state, not a change. With the immutable packet disabled (GHOST_AGENCY_
  // IMMUTABLE_PACKET=0) the send path builds no verification and durable
  // records built before shared serving carry none; treating null===null as
  // a change refused every legacy sandbox send with
  // delivery_evidence_release_identity_changed. A real change — contract on
  // one side only, or two different contracts — still refuses.
  if (!left && !right) return true;
  if (!left || !right) return false;
  return canonicalJson({
    proofIdentity: left.proofIdentity,
    releaseEvidence: left.releaseEvidence,
    previewUrl: left.previewUrl,
    buildHash: left.buildHash,
  }) === canonicalJson({
    proofIdentity: right.proofIdentity,
    releaseEvidence: right.releaseEvidence,
    previewUrl: right.previewUrl,
    buildHash: right.buildHash,
  });
}

function normalizedPolicyCode(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function explicitTrue(...values) {
  return values.some((value) => value === true || normalizedPolicyCode(value) === "true");
}

function canonicalTerminalReason(durable) {
  if (!durable || typeof durable !== "object") return "canonical_recipient_unavailable";
  const record = recordOf(durable);
  const reasons = [
    durable.blocked_reason,
    durable.contact_hold_reason,
    durable.suppression_reason,
    durable.vertical_hold && durable.vertical_hold.reason,
    record.blocked_reason,
    record.contact_hold_reason,
    record.suppression_reason,
    record.vertical_hold && record.vertical_hold.reason,
  ].map(normalizedPolicyCode).filter(Boolean);
  if (reasons.includes("vertical_mismatch_sport_fencing")) return "vertical_mismatch_sport_fencing";

  const statuses = [
    durable.status,
    durable.contact_status,
    durable.email_status,
    durable.outreach_status,
    record.status,
    record.contact_status,
    record.email_status,
    record.outreach_status,
  ].map(normalizedPolicyCode).filter(Boolean);
  const terminal = statuses.find((status) => DELIVERY_TERMINAL_STATUSES.has(status));
  if (terminal) return terminal;
  const terminalReason = reasons.find((reason) => DELIVERY_TERMINAL_REASONS.has(reason));
  if (terminalReason) return terminalReason;

  if (explicitTrue(durable.do_not_contact, record.do_not_contact)) return "do_not_contact";
  if (explicitTrue(durable.suppressed, record.suppressed)) return "suppressed";
  if (explicitTrue(durable.contact_suppressed, record.contact_suppressed)) return "contact_suppressed";
  if (explicitTrue(durable.email_suppressed, record.email_suppressed)) return "email_suppressed";
  return "";
}

function explicitEmailVerification(durable) {
  const record = recordOf(durable);
  const verifications = [
    durable.email_verification,
    durable.emailVerification,
    record.email_verification,
    record.emailVerification,
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const booleans = [
    durable.email_verified,
    durable.emailVerified,
    record.email_verified,
    record.emailVerified,
  ].filter((value) => typeof value === "boolean");
  // Negative or structured evidence wins over a stale positive convenience
  // flag. A prior `email_verified:true` must never erase a later verifier's
  // invalid/unreachable verdict, and contradictory evidence stays held.
  if (booleans.includes(false)) return { known: true, verified: false, reason: "email_unverified" };
  if (!verifications.length) {
    return booleans.includes(true)
      ? { known: true, verified: true, reason: "" }
      : { known: false, verified: false, reason: "" };
  }

  const evidence = verifications.map((verification) => ({
    verification,
    status: normalizedPolicyCode(
      verification.status || verification.result || verification.disposition || verification.reachability_status,
    ),
  }));
  if (evidence.some(({ verification, status }) => (
    ["invalid", "undeliverable", "unreachable", "bounced", "failed"].includes(status)
    || verification.valid === false
    || verification.reachable === false
  ))) {
    return { known: true, verified: false, reason: "email_invalid" };
  }
  const verified = evidence.every(({ verification, status }) => (
    status === "verified"
    && Boolean(text(verification.checked_at || verification.checkedAt))
    && Boolean(text(verification.method))
  ));
  return { known: true, verified, reason: verified ? "" : "email_unverified" };
}

async function canonicalSuppressionStatus(durable, email, deps) {
  if (typeof deps.suppressionStatus === "function") {
    try {
      const status = await deps.suppressionStatus({ prospect: durable, email });
      if (!status || status.known !== true) return { known: false, suppressed: true };
      return { known: true, suppressed: status.suppressed === true };
    } catch {
      return { known: false, suppressed: true };
    }
  }
  const prospectId = text(durable && durable.prospect_id);
  const terms = [];
  if (prospectId) terms.push(`prospect_id.eq.${encodeURIComponent(prospectId)}`);
  if (email) terms.push(`email.eq.${encodeURIComponent(email)}`);
  if (!terms.length) return { known: false, suppressed: true };
  let result;
  try {
    result = await deps.select(
      SUPPRESSIONS,
      `?select=prospect_id,email,suppression_key&or=(${terms.join(",")})&limit=1`,
    );
  } catch {
    return { known: false, suppressed: true };
  }
  if (!result || result.ok !== true || !Array.isArray(result.data)) {
    return { known: false, suppressed: true };
  }
  return { known: true, suppressed: result.data.length > 0 };
}

async function canonicalDeliveryVerdict(durable, deps) {
  const terminalReason = canonicalTerminalReason(durable);
  if (terminalReason) return { ok: false, reason: terminalReason };

  const email = normalizeEmail(durable && durable.email);
  if (!email) return { ok: false, reason: "invalid_email" };

  let contactGates;
  try {
    // Evaluate the top-level and embedded verdicts independently. The shared
    // helper intentionally prefers a top-level projection, but delivery must
    // not let that projection hide a newer negative verdict in `record`.
    contactGates = [deps.contactSendGate(durable), deps.contactSendGate(recordOf(durable))]
      .filter((gate) => gate && gate.hasEnrichment);
  } catch {
    return { ok: false, reason: "contact_verdict_unavailable" };
  }
  if (contactGates.length) {
    const holdReasons = contactGates.flatMap((gate) => (
      Array.isArray(gate.blockedReasons) && gate.blockedReasons.length
        ? gate.blockedReasons
        : (Array.isArray(gate.holdReasons) ? gate.holdReasons : [])
    )).map(normalizedPolicyCode);
    if (holdReasons.includes("email_suppressed")) return { ok: false, reason: "email_suppressed" };
    if (holdReasons.some((reason) => EMAIL_UNVERIFIED_REASONS.has(reason))) {
      return { ok: false, reason: holdReasons.includes("email_unreachable") ? "email_invalid" : "email_unverified" };
    }
    if (contactGates.some((gate) => {
      const sendableEmail = normalizeEmail(gate.sendableEmail || "");
      return gate.blocked || !sendableEmail || sendableEmail !== email;
    })) {
      return { ok: false, reason: "email_unverified" };
    }
  }

  const verification = explicitEmailVerification(durable);
  if (verification.known && !verification.verified) return { ok: false, reason: verification.reason };

  const suppression = await canonicalSuppressionStatus(durable, email, deps);
  if (!suppression.known) return { ok: false, reason: "suppression_check_unavailable" };
  if (suppression.suppressed) return { ok: false, reason: "suppressed" };
  return { ok: true, reason: "", email };
}

async function deliveryVerdictForLane(durable, deps, lane, owner) {
  if (lane !== "sandbox") return canonicalDeliveryVerdict(durable, deps);
  // Practice is an internal proof addressed only to the configured owner. The
  // prospect is content, never the recipient, so their contact status, address,
  // verification, consent, and suppression records cannot veto that proof.
  // Site-truth holds remain authoritative: a wrong-business build is still a
  // wrong build even when only the owner would receive it.
  if (sportFencingDeliveryHold(durable)) {
    return { ok: false, reason: "vertical_mismatch_sport_fencing" };
  }
  const email = normalizeEmail(owner);
  return email
    ? { ok: true, reason: "", email, ownerOnly: true }
    : { ok: false, reason: "owner_address_unset" };
}

function policyHold(reason, idempotencyKey) {
  return {
    ok: false,
    reason: safeCode(reason),
    idempotencyKey,
    policyHold: true,
    providerAttempted: false,
  };
}

function safeProviderResult(result, idempotencyKey, acceptedAt) {
  const success = Boolean(result && result.ok === true && result.mode === "sent");
  if (!success) {
    const providerAttempted = Boolean(result && result.mode === "send_failed");
    const reason = result && result.ok === true
      ? "provider_not_sent"
      : safeCode(result && (result.blocked || result.reason || result.error));
    if (result && result.retryableBeforeProvider === true && result.providerAttempted === false) {
      const releaseFailureKind = result.releaseFailureKind === "transient" ? "transient" : "";
      return {
        ok: false,
        reason,
        idempotencyKey,
        retryableBeforeProvider: true,
        providerAttempted: false,
        ...(releaseFailureKind ? { releaseFailureKind } : {}),
      };
    }
    return {
      ok: false,
      reason,
      idempotencyKey,
      ...(!providerAttempted ? { providerAttempted: false, policyHold: true } : {}),
    };
  }
  const receipt = text(result.id);
  const safeReceipt = receipt && /^[A-Za-z0-9_-]{1,160}$/.test(receipt) ? receipt : "";
  if (!safeReceipt) {
    return {
      ok: false,
      reason: "provider_receipt_missing",
      manualReconciliationRequired: true,
      idempotencyKey,
    };
  }
  const safeAcceptedAt = safeIsoDate(acceptedAt);
  return {
    ok: true,
    reason: "",
    mode: "sent",
    idempotencyKey,
    ...(safeAcceptedAt ? { acceptedAt: safeAcceptedAt } : {}),
    providerReceipt: safeReceipt,
  };
}

async function beforeDeadline(work, deadlineAt, code = "delivery_deadline") {
  const remaining = Number(deadlineAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw Object.assign(new Error(code), { code });
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveDeps(overrides = {}) {
  const lineEmailAssets = require("./line-email-assets");
  return {
    select: overrides.select || require("./store").select,
    conditionalUpdate: overrides.conditionalUpdate || require("./store").conditionalUpdate,
    sendSequenceStep: overrides.sendSequenceStep || require("./email").sendSequenceStep,
    ensureLineProofShots: overrides.ensureLineProofShots || require("./line-proof-shots").ensureLineProofShots,
    proofShotsForSend: overrides.proofShotsForSend || lineEmailAssets.proofShotsForSend,
    deliveryProofIdentity: overrides.deliveryProofIdentity || lineEmailAssets.deliveryProofIdentity,
    ensureLineReport: overrides.ensureLineReport || require("./line-report").ensureLineReport,
    verifyActiveRelease: overrides.verifyActiveRelease || verifyActivePublicRelease,
    clientReferenceCode: overrides.clientReferenceCode || require("./client-reference").clientReferenceCode,
    ownerSandboxAddress: overrides.ownerSandboxAddress || require("./sandbox-send").ownerSandboxAddress,
    forceOwnerRecipient: overrides.forceOwnerRecipient || require("./sandbox-send").forceOwnerRecipient,
    assertOwnerOnly: overrides.assertOwnerOnly || require("./sandbox-send").assertOwnerOnly,
    recipientFingerprint: overrides.recipientFingerprint || require("./line-adapters").recipientFingerprint,
    contactSendGate: overrides.contactSendGate || contactSendGate,
    suppressionStatus: overrides.suppressionStatus,
    deliveryPauseStatus: overrides.deliveryPauseStatus || require("./delivery-pause").deliveryPauseStatus,
    reviewHoldActive: overrides.reviewHoldActive || require("./email").reviewHoldActive,
    readiness: overrides.readiness,
    liveSendsEnabled: overrides.liveSendsEnabled,
    now: overrides.now || (() => new Date()),
  };
}

async function currentReadiness({ lane, batchId }, deps) {
  if (typeof deps.readiness === "function") {
    try {
      const state = await deps.readiness({ lane, batchId });
      if (!state || state.ready !== true) {
        const blockers = state && Array.isArray(state.blockers) ? state.blockers : [];
        const reasons = blockers.map((blocker) => safeCode(blocker && blocker.code, "blocked_by_readiness"));
        const sandboxOwnerOnlyLocks = lane === "sandbox"
          && reasons.length > 0
          && reasons.every((reason) => reason === "delivery_paused" || reason === "review_hold");
        if (!sandboxOwnerOnlyLocks) {
          return { ready: false, reason: reasons[0] || "blocked_by_readiness" };
        }
        const owner = text(deps.ownerSandboxAddress());
        return owner
          ? { ready: true, reason: "" }
          : { ready: false, reason: "owner_address_unset" };
      }
      return { ready: true, reason: "" };
    } catch {
      return { ready: false, reason: "readiness_unavailable" };
    }
  }

  // Sandbox delivery is an asserted owner-only proof, not cold outreach. Match
  // full-run's owner-proof contract by keeping outreach pause/review locks on
  // the live lane while still requiring the configured owner before any work.
  if (lane === "sandbox") {
    const owner = text(deps.ownerSandboxAddress());
    return owner
      ? { ready: true, reason: "" }
      : { ready: false, reason: "owner_address_unset" };
  }

  let pause;
  let hold;
  try {
    [pause, hold] = await Promise.all([
      deps.deliveryPauseStatus(),
      Promise.resolve().then(() => deps.reviewHoldActive()),
    ]);
  } catch {
    return { ready: false, reason: "readiness_unavailable" };
  }
  if (!pause || pause.known === false) return { ready: false, reason: "delivery_pause_status_unavailable" };
  if (pause.active === true) return { ready: false, reason: "delivery_paused" };
  if (hold === true) return { ready: false, reason: "review_hold" };

  const owner = text(deps.ownerSandboxAddress());
  if (!owner) return { ready: false, reason: "owner_address_unset" };
  const liveEnabled = typeof deps.liveSendsEnabled === "function"
    ? deps.liveSendsEnabled()
    : (deps.liveSendsEnabled == null
      ? text(process.env[LIVE_SWITCH]) === "true"
      : deps.liveSendsEnabled);
  if (lane === "live" && liveEnabled !== true) return { ready: false, reason: "live_lane_disabled" };
  return { ready: true, reason: "" };
}

async function loadCanonicalProspect(prospectId, deps) {
  let loaded;
  try {
    loaded = await deps.select(
      PROSPECTS,
      `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    );
  } catch {
    return null;
  }
  if (!loaded || loaded.ok !== true || !Array.isArray(loaded.data) || !loaded.data[0]) return null;
  return loaded.data[0];
}

function immutablePacketOf(record) {
  const packet = record && record.genie_canonical_packet;
  return packet && typeof packet === "object" && !Array.isArray(packet) ? packet : null;
}

/**
 * Row-scoped legacy recovery opt-in. Rows drained from the durable queue carry
 * their payload hydrated onto the row (claimRows/hydrateRow); a nested payload
 * object is accepted too, matching how storedRecipientFingerprint reads row
 * fields. Only an exact boolean true opts a single row in.
 */
function legacyClassicAssemblyRecoveryFlag(row) {
  if (row && row.legacyClassicAssemblyRecovery === true) return true;
  return objectOf(row && row.payload)?.legacyClassicAssemblyRecovery === true;
}

async function buildDeliveryProspect(row, durable, deps, { deadlineAt, preferImmutablePacket = false } = {}) {
  const record = durable.record && typeof durable.record === "object" ? durable.record : {};
  const currentWebsite = text(durable.current_website || record.current_website);
  const durablePreview = text(durable.preview_url || record.preview_url);
  const durableBuildHash = text(record.build_dispatch && record.build_dispatch.build_hash);
  const rowPreview = text(row.previewUrl);
  const rowBuildHash = text(row.buildHash);
  // A queued snapshot may survive a rebuild. Only its proof payload is stale;
  // delivery itself keeps the existing sendability law. Bind visual evidence
  // to the canonical build/alias that was just loaded, and discard the row's
  // captured payload whenever it cannot prove that same identity.
  const rowEvidenceIsCurrent = (!durableBuildHash || (rowBuildHash && rowBuildHash === durableBuildHash))
    && (!durablePreview || (rowPreview && normalizeProofUrl(rowPreview) === normalizeProofUrl(durablePreview)));
  const evidencePreview = durablePreview || rowPreview;
  const evidenceBuildHash = durableBuildHash || rowBuildHash;
  let proofShots = record.proof_shots && typeof record.proof_shots === "object"
    ? record.proof_shots
    : null;

  let resolved = null;
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
  // The row's queued snapshot is one release source; the durable record's
  // signed release (build_dispatch / mirror_release_evidence) is the other. A
  // row drained after a lost preview-url CAS carries no proof fields of its
  // own, but its record was signed at BUILD time — route that signed evidence
  // through the SAME reconciler: every marked source must agree exactly, and
  // the live public verifier below stays the authority on what is sendable.
  const releaseEvidences = [releaseEvidenceOf(row), ...durableRecordReleaseEvidences(record)]
    .filter(Boolean);
  const releaseEvidence = releaseEvidences[0] || null;
  const proofIdentityState = deps.deliveryProofIdentity({
    sources: [
      record.proof_shots,
      evidenceRow.proofIdentity,
      evidenceRow.proof_shots,
      evidenceRow.captured && evidenceRow.captured.shots,
      ...releaseEvidences.flatMap((release) => [
        objectOf(release && (release.proofIdentity || release.proof_identity)),
        objectOf(release && (release.sharedReleaseEvidence || release.shared_release_evidence)),
      ]),
    ],
    buildHash: evidenceBuildHash,
  });
  if (!proofIdentityState.ok) {
    return preferImmutablePacket === true
      ? {
        __lineEvidenceRefusal: "owner_proof_public_release_unavailable",
        __lineRetryableBeforeProvider: true,
        __lineReleaseFailureKind: "identity_invalid",
      }
      : { __lineEvidenceRefusal: proofIdentityState.reason };
  }
  let sharedReleaseVerification = null;
  if (preferImmutablePacket === true) {
    if (!proofIdentityState.active) {
      return {
        __lineEvidenceRefusal: "owner_proof_public_release_unavailable",
        __lineRetryableBeforeProvider: true,
        __lineReleaseFailureKind: "identity_invalid",
      };
    }
    sharedReleaseVerification = sharedReleaseVerificationInput(
      { releaseEvidence },
      proofIdentityState.proofIdentity,
      evidencePreview,
      evidenceBuildHash,
      deps,
    );
    if (!sharedReleaseVerification) {
      return {
        __lineEvidenceRefusal: "owner_proof_public_release_unavailable",
        __lineRetryableBeforeProvider: true,
        __lineReleaseFailureKind: "identity_invalid",
      };
    }
  }
  try {
    // Do not pass the batch row's stale email/phone fields into evidence code.
    // These are the only row fields the proof resolver consumes.
    resolved = await beforeDeadline(() => deps.proofShotsForSend({
        row: evidenceRow,
        record,
        currentWebsite,
        captureShots: deps.ensureLineProofShots,
        deadlineAt,
        now: Date.now,
        ...(proofIdentityState.active ? { proofIdentity: proofIdentityState.proofIdentity } : {}),
      }), deadlineAt, "proof_deadline");
  } catch {
    return { __lineEvidenceRefusal: "proof_resolution_unavailable" };
  }
  if (!resolved || resolved.refuseDelivery === true) {
    return { __lineEvidenceRefusal: safeCode(resolved && resolved.reason, "proof_resolution_refused") };
  }
  if (resolved && resolved.shots) proofShots = resolved.shots;
  const proofPersistenceRefused = Boolean(resolved && resolved.refuseProofPersistence === true);
  if (resolved && resolved.persist && !proofPersistenceRefused && proofShots) {
    try {
      await beforeDeadline(() => deps.upsertRow(PROSPECTS, {
          prospect_id: row.prospectId,
          record: { ...record, proof_shots: proofShots },
          updated_at: deps.now().toISOString(),
        }, "prospect_id"), deadlineAt, "proof_persist_deadline");
    } catch { /* evidence persistence is fail-soft; the email gate still sees the shots */ }
  }

  // LEGACY ROW CLASSIC RECOVERY (row-scoped; stranded sandbox batch
  // line_mtoz4opf_33476ede06). A stranded row's durable prospect can carry a
  // signed shared-release contract with NO genie_canonical_packet: the
  // immutable-packet report projection is structurally impossible
  // (immutable_packet_missing), while the classic V3 assembly below is refused
  // by the prepare/boundary guard because only the durable side carries the
  // contract. A row explicitly flagged legacyClassicAssemblyRecovery runs that
  // classic report assembly WITH the same sharedReleaseVerificationInput
  // contract the immutable lane built above — the exact-active-release live
  // verifier in prepare/deliver still refuses stale, wrong-release, or
  // mismatched evidence exactly as before, and rows without the flag keep
  // today's behavior. The global GHOST_AGENCY_IMMUTABLE_PACKET default stays
  // on and untouched.
  const classicAssemblyRecovery = preferImmutablePacket === true
    && !immutablePacketOf(record)
    && legacyClassicAssemblyRecoveryFlag(row);
  const immutableReport = preferImmutablePacket === true && !classicAssemblyRecovery;

  let reportOut = null;
  try {
    reportOut = await beforeDeadline(() => deps.ensureLineReport({
        ...durable,
        record,
        prospect_id: row.prospectId,
        business_name: row.businessName || durable.business_name,
        current_website: currentWebsite,
      }, { deadlineAt, now: Date.now, preferImmutablePacket: immutableReport }), deadlineAt, "report_deadline");
  } catch {
    reportOut = null;
  }
  if (immutableReport === true && reportOut && reportOut.reconciliationRequired === true) {
    const persistReportUrl = canonicalCallPrepReportUrl(reportOut.persistReportUrl);
    const reportedUrl = canonicalCallPrepReportUrl(reportOut.reportUrl);
    const canPersistCreatedUrl = reportOut.retryableBeforeProvider === true
      && Boolean(persistReportUrl)
      && persistReportUrl === reportedUrl;
    return {
      __lineEvidenceRefusal: reportOut.ambiguousSave === true
        ? "owner_proof_signal_report_save_reconciliation_required"
        : "owner_proof_signal_report_reconciliation_required",
      ...(canPersistCreatedUrl
        ? {
          __lineRetryableBeforeProvider: true,
          // Persistence-only: this URL cannot enter the email prospect until a
          // later exact GET makes ensureLineReport return ok:true.
          __linePersistReportUrl: persistReportUrl,
          ...(sharedReleaseVerification
            ? { __lineSharedReleaseVerification: sharedReleaseVerification }
            : {}),
        }
        : { __lineManualReconciliation: true }),
    };
  }
  let reportUrl = "";
  if (immutableReport === true) {
    // ensureLineReport is the identity-verifying authority for Practice. A
    // report URL stored on an older prospect snapshot is not proof that it was
    // built from this certified packet, so it may never cross the owner-email
    // boundary as a fallback.
    reportUrl = reportOut && reportOut.ok === true
      ? canonicalCallPrepReportUrl(reportOut.reportUrl)
      : "";
    if (!reportUrl) {
      return {
        __lineEvidenceRefusal: "owner_proof_signal_report_unavailable",
        __lineRetryableBeforeProvider: true,
      };
    }
  } else {
    const reportCandidates = [
      reportOut && reportOut.ok === true ? reportOut.reportUrl : "",
      record.report_url,
      durable.report_url,
    ];
    // Ordinary delivery remains fail-soft: prefer CallPrep, then the first
    // generally safe URL already carried by the durable row.
    reportUrl = reportCandidates.map(canonicalCallPrepReportUrl).find(Boolean)
      || reportCandidates.map(safeReportUrl).find(Boolean)
      || "";
  }
  const clientId = text(deps.clientReferenceCode({
    ...durable,
    prospect_id: row.prospectId,
    record,
  }));
  const nextRecord = {
    ...record,
    ...(!proofPersistenceRefused && proofShots ? { proof_shots: proofShots } : {}),
    ...(reportUrl ? { report_url: reportUrl } : {}),
    ...(clientId ? { client_id: clientId } : {}),
  };

  // `email` comes only from the just-loaded canonical row.  row.email is never
  // consulted, even in sandbox mode.
  return {
    prospect: {
      ...durable,
      record: nextRecord,
      proof_shots: proofShots || record.proof_shots,
      current_website: currentWebsite,
      prospect_id: row.prospectId,
      business_name: row.businessName || durable.business_name,
      email: text(durable.email),
      preview_url: evidencePreview,
      ...(reportUrl ? { report_url: reportUrl } : {}),
      ...(clientId ? { client_id: clientId } : {}),
      status: "line_queued",
    },
    persistence: {
      proofShots: resolved && resolved.persist === true && proofShots ? proofShots : null,
      reportUrl: reportOut && reportOut.ok === true ? reportUrl : "",
      clientId,
    },
    ...(sharedReleaseVerification ? { sharedReleaseVerification } : {}),
  };
}

function evidencePersistFailure(result, idempotencyKey, { retryable = false } = {}) {
  const reason = safeCode(result && result.reason, "delivery_evidence_persist_unavailable");
  if (result && result.manualReconciliationRequired === true) {
    return {
      ok: false,
      reason,
      idempotencyKey,
      providerAttempted: false,
      manualReconciliationRequired: true,
    };
  }
  return retryable
    ? {
      ok: false,
      reason,
      idempotencyKey,
      providerAttempted: false,
      retryableBeforeProvider: true,
    }
    : policyHold(reason, idempotencyKey);
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function deliveryEvidencePatch(durable, persistence, deps) {
  const record = recordOf(durable);
  const nextRecord = { ...record };
  let changed = false;
  if (persistence.proofShots && !sameCanonical(record.proof_shots, persistence.proofShots)) {
    nextRecord.proof_shots = persistence.proofShots;
    changed = true;
  }
  if (persistence.reportUrl && text(record.report_url) !== persistence.reportUrl) {
    nextRecord.report_url = persistence.reportUrl;
    changed = true;
  }
  if (persistence.clientId && text(record.client_id) !== persistence.clientId) {
    nextRecord.client_id = persistence.clientId;
    changed = true;
  }
  if (!changed) return null;
  const updatedAt = safeIsoDate(deps.now());
  if (!updatedAt) return { error: "delivery_evidence_persist_clock_invalid" };
  return {
    record: nextRecord,
    ...(persistence.reportUrl ? { report_url: persistence.reportUrl } : {}),
    updated_at: updatedAt,
  };
}

function deliveryEvidenceAlreadyPersisted(durable, persistence) {
  const record = recordOf(durable);
  return (!persistence.proofShots || sameCanonical(record.proof_shots, persistence.proofShots))
    && (!persistence.reportUrl || (
      text(record.report_url) === persistence.reportUrl
      && text(durable && durable.report_url) === persistence.reportUrl
    ))
    && (!persistence.clientId || text(record.client_id) === persistence.clientId);
}

function ownerPracticeEvidencePatch(durable, persistence, deps) {
  const patch = deliveryEvidencePatch(durable, persistence, deps);
  if (patch || !persistence.reportUrl
    || text(durable && durable.report_url) === persistence.reportUrl) return patch;
  const updatedAt = safeIsoDate(deps.now());
  if (!updatedAt) return { error: "delivery_evidence_persist_clock_invalid" };
  return {
    record: { ...recordOf(durable) },
    report_url: persistence.reportUrl,
    updated_at: updatedAt,
  };
}

async function persistDeliveryEvidence(prospectId, durable, persistence, deps, {
  deadlineAt,
  allowMissingEmail = false,
  recoverOwnerPracticeConflict = false,
  expectedSharedRelease = null,
  owner = "",
} = {}) {
  const patch = deliveryEvidencePatch(durable, persistence, deps);
  if (!patch) return { ok: true, changed: false };
  if (patch.error) return { ok: false, reason: patch.error };
  // A standalone client reference is useful metadata, not send evidence. If
  // evidence work consumed its budget, skip that optional write so the
  // reserved provider window remains intact. Proof/report writes themselves
  // stay fail-closed because losing those writes would make stored evidence
  // disagree with the provider payload.
  if (Number.isFinite(deadlineAt) && deadlineAt <= Date.now()
    && !persistence.proofShots && !persistence.reportUrl) {
    return { ok: true, changed: false };
  }
  const writeOnce = async (target, nextPatch) => {
    const version = text(target && target.updated_at);
    const status = normalizedPolicyCode(target && target.status);
    const email = normalizeEmail(target && target.email);
    // `updated_at` is the row-version CAS. Do not predicate this write on the
    // entire JSONB record: large/nested records make whole-object PostgREST
    // equality brittle. Owner Practice handles one lost CAS below by reloading
    // and proving the exact immutable release before retrying once.
    if (!version || !status || (!email && !allowMissingEmail)) {
      return { ok: false, reason: "delivery_evidence_persist_identity_missing" };
    }
    try {
      const result = await beforeDeadline(() => deps.conditionalUpdate(
        PROSPECTS,
        "prospect_id",
        prospectId,
        {
          updated_at: `eq.${version}`,
          status: `eq.${status}`,
          ...(email ? { email: `eq.${email}` } : {}),
        },
        nextPatch,
        { deadlineAt },
      ), deadlineAt, "delivery_evidence_persist_deadline");
      return result && result.ok === true && result.updated === true
        ? { ok: true, changed: true }
        : { ok: false, reason: "delivery_evidence_persist_conflict" };
    } catch {
      return { ok: false, reason: "delivery_evidence_persist_unavailable" };
    }
  };

  const first = await writeOnce(durable, patch);
  if (first.ok || first.reason !== "delivery_evidence_persist_conflict"
    || recoverOwnerPracticeConflict !== true) return first;

  // Practice writes only owner-facing proof metadata. A concurrent freshness
  // or contact update must not halt the whole batch, but neither may it let
  // evidence from an older build cross into a newer release. Reload exactly
  // once, re-run the owner site-truth gate, and compare the complete shared
  // release tuple before accepting or retrying the desired write.
  let fresh = null;
  try {
    fresh = await beforeDeadline(
      () => loadCanonicalProspect(prospectId, deps),
      deadlineAt,
      "delivery_evidence_persist_deadline",
    );
  } catch { /* bounded fail-closed result below */ }
  if (!fresh) return { ok: false, reason: "delivery_evidence_persist_unavailable" };
  const truth = await deliveryVerdictForLane(fresh, deps, "sandbox", owner);
  if (!truth.ok) {
    return {
      ok: false,
      reason: safeCode(truth.reason, "delivery_evidence_site_truth_changed"),
      manualReconciliationRequired: true,
    };
  }
  const freshSharedRelease = durableSharedReleaseVerification(fresh, deps);
  if (!sameSharedReleaseVerification(freshSharedRelease, expectedSharedRelease)) {
    return {
      ok: false,
      reason: "delivery_evidence_release_identity_changed",
      manualReconciliationRequired: true,
    };
  }
  if (deliveryEvidenceAlreadyPersisted(fresh, persistence)) {
    return { ok: true, changed: false, conflictRecovered: true };
  }
  const retryPatch = ownerPracticeEvidencePatch(fresh, persistence, deps);
  if (!retryPatch) return { ok: true, changed: false, conflictRecovered: true };
  if (retryPatch.error) return { ok: false, reason: retryPatch.error };
  const retried = await writeOnce(fresh, retryPatch);
  return retried.ok
    ? { ...retried, conflictRecovered: true }
    : {
      ...retried,
      ...(retried.reason === "delivery_evidence_persist_conflict"
        ? { manualReconciliationRequired: true }
        : {}),
    };
}

function deliveryProspectFromFresh(built, durable, email) {
  const freshRecord = recordOf(durable);
  const builtRecord = recordOf(built);
  const record = {
    ...freshRecord,
    ...(builtRecord.proof_shots ? { proof_shots: builtRecord.proof_shots } : {}),
    ...(builtRecord.report_url ? { report_url: builtRecord.report_url } : {}),
    ...(builtRecord.client_id ? { client_id: builtRecord.client_id } : {}),
  };
  return {
    ...built,
    ...durable,
    record,
    proof_shots: built.proof_shots || freshRecord.proof_shots,
    current_website: built.current_website,
    prospect_id: built.prospect_id,
    business_name: built.business_name,
    email,
    preview_url: built.preview_url,
    ...(built.report_url ? { report_url: built.report_url } : {}),
    ...(built.client_id ? { client_id: built.client_id } : {}),
    status: "line_queued",
  };
}

/**
 * createLineSender({ lane, batchId, deps }) -> async send(row, options)
 *
 * `options` may specify sequence, step, deadlineAt and now.  Those values are
 * delivery metadata only; the approved batch and canonical prospect remain the
 * authority for lane, identity and recipient.
 */
function createLineSender({ lane, batchId, deps: overrides = {} } = {}) {
  const immutableLane = lane === "live" ? "live" : (lane === "sandbox" ? "sandbox" : "");
  const immutableBatchId = text(batchId);
  const deps = resolveDeps(overrides);

  async function prepare(row = {}, options = {}) {
    const prospectId = text(row.prospectId || row.prospect_id);
    if (!immutableLane || !immutableBatchId || !prospectId) {
      return { ok: false, reason: "delivery_identity_missing", idempotencyKey: "" };
    }

    const sequence = positiveInteger(options.sequence, 1);
    const step = positiveInteger(options.step, 1);
    const idempotencyKey = lineDeliveryIdempotencyKey({
      batchId: immutableBatchId,
      prospectId,
      sequence,
      step,
    });

    const readiness = await currentReadiness({ lane: immutableLane, batchId: immutableBatchId }, deps);
    if (!readiness.ready) return { ok: false, reason: readiness.reason, idempotencyKey };

    const durable = await loadCanonicalProspect(prospectId, deps);
    if (!durable) return policyHold("canonical_recipient_unavailable", idempotencyKey);
    const owner = text(deps.ownerSandboxAddress());
    const canonical = await deliveryVerdictForLane(durable, deps, immutableLane, owner);
    if (!canonical.ok) return policyHold(canonical.reason, idempotencyKey);
    if (!owner) {
      return {
        ok: false,
        reason: immutableLane === "live" ? "owner_address_unset_live_copy_required" : "owner_address_unset",
        idempotencyKey,
      };
    }
    const canonicalEmail = canonical.email;

    if (immutableLane === "live") {
      const stored = storedRecipientFingerprint(row);
      const current = deps.recipientFingerprint(canonicalEmail);
      if (!fingerprintsMatch(stored, current)) {
        return {
          ok: false,
          reason: "recipient_reapproval_required",
          reapprovalRequired: true,
          idempotencyKey,
        };
      }
    }

    const configuredDeadline = Number(options.deadlineAt) > 0 ? Number(options.deadlineAt) : 0;
    const evidenceDeadline = Math.min(
      Date.now() + EVIDENCE_MAX_MS,
      configuredDeadline > 0 ? configuredDeadline - PROVIDER_RESERVE_MS : Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(evidenceDeadline) || evidenceDeadline <= Date.now()) {
      return { ok: false, reason: "delivery_deadline", idempotencyKey };
    }
    const built = await buildDeliveryProspect(
      { ...row, prospectId },
      durable,
      deps,
      // EMAIL ASSEMBLY FORMAT SWITCH (owner directive 2026-09-01): the
      // immutable packet's exactActiveSharedRelease live re-verification
      // refuses every drain (owner_proof_public_release_unavailable) even
      // for verified live sites. The classic V3 path — the exact assembly
      // that delivered every proof email since July — remains available.
      // GHOST_AGENCY_IMMUTABLE_PACKET=0 selects it; default stays on.
      { deadlineAt: evidenceDeadline, preferImmutablePacket: immutableLane === "sandbox" && String(process.env.GHOST_AGENCY_IMMUTABLE_PACKET ?? "1").trim() !== "0" },
    );
    if (built && built.__lineEvidenceRefusal) {
      const manualReconciliation = built.__lineManualReconciliation === true;
      const retryableBeforeProvider = built.__lineRetryableBeforeProvider === true;
      if (built.__linePersistReportUrl) {
        const persistedReport = await persistDeliveryEvidence(
          prospectId,
          durable,
          {
            proofShots: null,
            reportUrl: built.__linePersistReportUrl,
            clientId: "",
          },
          deps,
          {
            deadlineAt: evidenceDeadline,
            allowMissingEmail: true,
            recoverOwnerPracticeConflict: true,
            expectedSharedRelease: built.__lineSharedReleaseVerification,
            owner,
          },
        );
        if (!persistedReport.ok) {
          return evidencePersistFailure(persistedReport, idempotencyKey, { retryable: true });
        }
      }
      return {
        ok: false,
        reason: safeCode(built.__lineEvidenceRefusal, "proof_resolution_refused"),
        idempotencyKey,
        providerAttempted: false,
        ...(manualReconciliation
          ? { manualReconciliationRequired: true }
          : (retryableBeforeProvider
            ? { retryableBeforeProvider: true }
            : { policyHold: true })),
        ...(built.__lineReleaseFailureKind
          ? { releaseFailureKind: built.__lineReleaseFailureKind }
          : {}),
      };
    }
    // Evidence/report generation may take tens of seconds and may persist a
    // refreshed record. Re-read the canonical recipient after that work so a
    // contact edit cannot race the provider boundary.
    const currentDurable = await loadCanonicalProspect(prospectId, deps);
    if (!currentDurable) return policyHold("canonical_recipient_unavailable", idempotencyKey);
    const current = await deliveryVerdictForLane(currentDurable, deps, immutableLane, owner);
    if (!current.ok) return policyHold(current.reason, idempotencyKey);
    const originalFingerprint = deps.recipientFingerprint(canonicalEmail);
    const currentFingerprint = deps.recipientFingerprint(current.email);
    if (!fingerprintsMatch(originalFingerprint, currentFingerprint)) {
      return {
        ok: false,
        reason: "recipient_reapproval_required",
        reapprovalRequired: true,
        idempotencyKey,
      };
    }
    const persisted = await persistDeliveryEvidence(
      prospectId,
      currentDurable,
      built.persistence,
      deps,
      {
        deadlineAt: evidenceDeadline,
        allowMissingEmail: immutableLane === "sandbox",
        recoverOwnerPracticeConflict: immutableLane === "sandbox",
        expectedSharedRelease: built.sharedReleaseVerification,
        owner,
      },
    );
    if (!persisted.ok) return evidencePersistFailure(persisted, idempotencyKey);

    // The evidence CAS may have won, lost, or raced a contact-policy write.
    // Reload after it either way; only this post-write canonical state may
    // become the prepared provider payload.
    const finalDurable = await loadCanonicalProspect(prospectId, deps);
    if (!finalDurable) return policyHold("canonical_recipient_unavailable", idempotencyKey);
    const final = await deliveryVerdictForLane(finalDurable, deps, immutableLane, owner);
    if (!final.ok) return policyHold(final.reason, idempotencyKey);
    if (immutableLane === "sandbox" && !sameSharedReleaseVerification(
      durableSharedReleaseVerification(finalDurable, deps),
      built.sharedReleaseVerification,
    )) {
      return {
        ok: false,
        reason: "delivery_evidence_release_identity_changed",
        idempotencyKey,
        providerAttempted: false,
        manualReconciliationRequired: true,
      };
    }
    const finalEmail = final.email;
    const finalFingerprint = deps.recipientFingerprint(finalEmail);
    if (!fingerprintsMatch(originalFingerprint, finalFingerprint)) {
      return {
        ok: false,
        reason: "recipient_reapproval_required",
        reapprovalRequired: true,
        idempotencyKey,
      };
    }
    if (immutableLane === "live" && !fingerprintsMatch(storedRecipientFingerprint(row), currentFingerprint)) {
      return {
        ok: false,
        reason: "recipient_reapproval_required",
        reapprovalRequired: true,
        idempotencyKey,
      };
    }

    // A signed historical shared-release tuple is not proof that its hostname
    // still serves those exact bytes. Practice delivery re-reads the active
    // registry and public router after evidence work but before it creates a
    // prepared provider payload. A failed prepare is therefore retryable and
    // cannot reach the durable provider-attempt checkpoint.
    if (immutableLane === "sandbox" && built.sharedReleaseVerification) {
      if (!await exactActiveSharedRelease(
        built.sharedReleaseVerification,
        deps,
        evidenceDeadline,
      )) {
        return {
          ok: false,
          reason: "owner_proof_public_release_unavailable",
          idempotencyKey,
          providerAttempted: false,
          retryableBeforeProvider: true,
          releaseFailureKind: "transient",
        };
      }
    }

    const prospect = deliveryProspectFromFresh(built.prospect, finalDurable, finalEmail);
    let sendProspect = {
      ...prospect,
      email: finalEmail,
    };
    const input = {
      prospect: sendProspect,
      sequence,
      step,
      dryRun: false,
      lineBatchApproved: true,
      idempotencyKey,
      deadlineAt: Number(options.deadlineAt) > 0 ? Number(options.deadlineAt) : 0,
      ...(typeof options.now === "function" ? { now: options.now } : {}),
    };

    if (immutableLane === "sandbox") {
      sendProspect = deps.forceOwnerRecipient(prospect, owner);
      if (!deps.assertOwnerOnly(sendProspect, owner)) {
        return { ok: false, reason: "owner_only_assertion_failed", idempotencyKey };
      }
      input.prospect = sendProspect;
      input.internalOwnerProof = true;
      input.allowReviewHoldBypass = true;
      input.allowDeliveryPauseBypass = true;
      input.allowContactHoldBypass = true;
      input.requireSignalReportInEmail = true;
      if (built.sharedReleaseVerification) {
        // sendSequenceStep owns the true provider boundary. Keep the verifier
        // process-local and require it there so a registry quarantine between
        // prepare() and delivery cannot mail a now-revoked public URL.
        input.requireOwnerPracticeActiveRelease = true;
        input.verifyOwnerPracticeActiveRelease = () => exactActiveSharedRelease(
          built.sharedReleaseVerification,
          deps,
          input.deadlineAt,
        );
      }
    } else {
      input.bcc = owner;
    }

    const inputFingerprint = deliveryInputFingerprint({
      lane: immutableLane,
      batchId: immutableBatchId,
      input,
    });
    if (!inputFingerprint) {
      return { ok: false, reason: "delivery_fingerprint_failed", idempotencyKey };
    }
    const plan = Object.freeze({
      ok: true,
      reason: "",
      idempotencyKey,
      inputFingerprint,
    });
    preparedInputs.set(plan, {
      input,
      canonicalRecipientFingerprint: finalFingerprint,
      ...(immutableLane === "sandbox"
        ? { sharedReleaseVerification: built.sharedReleaseVerification }
        : {}),
    });
    return plan;
  }

  async function deliver(plan, options = {}) {
    const prepared = plan && typeof plan === "object" ? preparedInputs.get(plan) : null;
    const input = prepared && prepared.input;
    const actualFingerprint = input
      ? deliveryInputFingerprint({ lane: immutableLane, batchId: immutableBatchId, input })
      : "";
    const expectedFingerprint = text(options.expectedInputFingerprint || plan?.inputFingerprint).toLowerCase();
    if (!input || !fingerprintsMatch(actualFingerprint, expectedFingerprint)) {
      return {
        ok: false,
        reason: "delivery_payload_reconciliation_required",
        manualReconciliationRequired: true,
        idempotencyKey: text(plan?.idempotencyKey),
      };
    }
    // prepare() is checkpointed before deliver() by the durable continuation.
    // A quarantine can land in that gap, so the provider boundary gets its own
    // exact read instead of trusting the prepared line_queued projection.
    const deliveryProspectId = text(input.prospect && input.prospect.prospect_id);
    if (!deliveryProspectId) {
      return { ok: false, reason: "canonical_recipient_unavailable", idempotencyKey: plan.idempotencyKey, providerAttempted: false };
    }
    const boundaryDurable = await loadCanonicalProspect(deliveryProspectId, deps);
    if (!boundaryDurable) {
      return { ok: false, reason: "canonical_recipient_unavailable", idempotencyKey: plan.idempotencyKey, providerAttempted: false };
    }
    const boundaryOwner = text(deps.ownerSandboxAddress());
    const boundary = await deliveryVerdictForLane(boundaryDurable, deps, immutableLane, boundaryOwner);
    if (!boundary.ok) return policyHold(boundary.reason, plan.idempotencyKey);
    if (immutableLane === "sandbox" && !sameSharedReleaseVerification(
      durableSharedReleaseVerification(boundaryDurable, deps),
      prepared.sharedReleaseVerification,
    )) {
      return {
        ok: false,
        reason: "delivery_evidence_release_identity_changed",
        idempotencyKey: plan.idempotencyKey,
        providerAttempted: false,
        manualReconciliationRequired: true,
      };
    }
    const boundaryFingerprint = deps.recipientFingerprint(boundary.email);
    if (!fingerprintsMatch(prepared.canonicalRecipientFingerprint, boundaryFingerprint)) {
      return {
        ok: false,
        reason: "recipient_reapproval_required",
        reapprovalRequired: true,
        idempotencyKey: plan.idempotencyKey,
        providerAttempted: false,
      };
    }
    let result;
    try {
      result = await deps.sendSequenceStep(input);
    } catch {
      return { ok: false, reason: "delivery_attempt_failed", idempotencyKey: plan.idempotencyKey };
    }
    return safeProviderResult(result, plan.idempotencyKey, deps.now());
  }

  async function send(row = {}, options = {}) {
    const plan = await prepare(row, options);
    if (!plan || plan.ok !== true) return plan;
    return deliver(plan, { expectedInputFingerprint: plan.inputFingerprint });
  }
  send.prepare = prepare;
  send.deliver = deliver;
  return send;
}

module.exports = {
  createLineSender,
  lineDeliveryIdempotencyKey,
  ownerProofIdempotencyKey,
  storedRecipientFingerprint,
  fingerprintsMatch,
  canonicalJson,
  deliveryInputFingerprint,
  safeProviderResult,
  beforeDeadline,
  // Exposed read-only for the operator diagnostic
  // /api/admin/release-verify-probe, which re-runs the sender's exact
  // shared-release verification chain on one real row. No behavior change:
  // these are the same functions buildDeliveryProspect/sendOne call.
  verifyActivePublicRelease,
  releaseEvidenceOf,
  durableRecordReleaseEvidences,
  sharedReleaseVerificationInput,
  publicReleaseMatchesIdentity,
  exactActiveSharedRelease,
  currentReadiness,
  loadCanonicalProspect,
  sportFencingDeliveryHold,
  canonicalTerminalReason,
  explicitEmailVerification,
  canonicalSuppressionStatus,
  canonicalDeliveryVerdict,
};
