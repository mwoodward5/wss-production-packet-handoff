"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { requireAdmin } = require("../../lib/admin-auth");
const { sendSequenceStep } = require("../../lib/email");
const { buildPreviewForProspect } = require("../../lib/full-run");
const { methodGuard, readJson, sendJson } = require("../../lib/http");
const { firstValue, prospectFromRow, prospectId } = require("../../lib/prospects");
const { verifyStagedTenMembership } = require("../../lib/staged-ten-membership");
const { insertRow, select } = require("../../lib/store");
const {
  buildGateFailures,
  invokeOwnerEmailPath,
  minedEligibility,
  ownerProofRecipients,
  validateArtifactUrl,
} = require("../../scripts/supervised-five-owner-smoke");

const SEND_CONFIRMATION = "SEND_OWNER_ONE";
const DEFAULT_BUILD_BUDGET_MS = 297_000;
const DEFAULT_RESPONSE_BUDGET_MS = 299_000;
const DEFAULT_URL_TIMEOUT_MS = 7_000;
const DEFAULT_SEND_START_CUTOFF_MS = 9_000;
const OWNER_CONTACT_FIELDS = ["email", "ownerEmail", "owner_email"];
const OWNER_DELIVERY_CLAIM_TYPE = "outreach.owner_copy_claim";
const STAGED_TEN_MEMBERSHIP_ERROR = "staged_ten_membership_required";

function deterministicOwnerClaimId(prospectIdValue) {
  const digest = createHash("sha256")
    .update(`supervised_10_review_pending|owner_copy|${String(prospectIdValue || "").trim()}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16], 16) & 3) | 8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicStagedAuditEventId(draftId) {
  const digest = createHash("sha256")
    .update(`supervised_10_review_pending|audit_event|${String(draftId || "").trim()}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16], 16) & 3) | 8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function htmlSha256(html) {
  return createHash("sha256").update(String(html || "")).digest("hex");
}

function stagedDraftFieldsMatch(left = {}, right = {}) {
  return [
    "draft_id",
    "hold_key",
    "prospect_id",
    "preview_url",
    "getfound_grade",
    "subject",
    "body",
    "compose_mode",
    "delivery_status",
    "approval_status",
  ].every((field) => left[field] === right[field])
    && normalizeEmail(left.recipient_email) === normalizeEmail(right.recipient_email);
}

function validStagedAuditEvent(event = {}, draft = {}) {
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  return event.id === deterministicStagedAuditEventId(draft.draft_id)
    && event.type === "outbound.review_draft.created"
    && payload.actor === "admin_supervised_review_queue"
    && payload.status === "held"
    && payload.hold_key === "supervised_10_review_pending"
    && payload.draft_id === draft.draft_id
    && payload.prospect_id === draft.prospect_id
    && payload.compose_mode === "dry_run"
    && payload.delivery_status === "review_only"
    && payload.approval_status === "awaiting_explicit_later_approval"
    && /^[a-f0-9]{64}$/.test(String(payload.html_sha256 || ""));
}

async function loadStagedArtifactBinding({ prospectId: prospectIdValue, membership }, deps) {
  const membershipDraft = membership?.draft;
  const draftId = String(membershipDraft?.draft_id || "").trim();
  if (!draftId) return { ok: false, reason: "staged_draft_missing" };
  const [draftResult, eventResult] = await Promise.all([
    deps.select(
      "ghost_agency_outbound_review_drafts",
      `?select=draft_id,hold_key,prospect_id,recipient_email,preview_url,getfound_grade,subject,body,compose_mode,delivery_status,approval_status&draft_id=eq.${encodeURIComponent(draftId)}&prospect_id=eq.${encodeURIComponent(prospectIdValue)}&limit=2`,
    ),
    deps.select(
      "ghost_agency_events",
      `?select=id,type,payload&id=eq.${encodeURIComponent(deterministicStagedAuditEventId(draftId))}&limit=2`,
    ),
  ]);
  if (!draftResult || draftResult.ok !== true || !Array.isArray(draftResult.data)
    || !eventResult || eventResult.ok !== true || !Array.isArray(eventResult.data)) {
    return { ok: false, reason: "staged_artifact_state_unavailable" };
  }
  if (draftResult.data.length !== 1) return { ok: false, reason: "staged_draft_missing" };
  if (eventResult.data.length !== 1) return { ok: false, reason: "staged_draft_audit_missing" };
  const draft = draftResult.data[0];
  if (!stagedDraftFieldsMatch(draft, membershipDraft)) return { ok: false, reason: "staged_draft_state_mismatch" };
  if (!validStagedAuditEvent(eventResult.data[0], draft)) return { ok: false, reason: "staged_draft_audit_mismatch" };
  return { ok: true, draft, audit: eventResult.data[0] };
}

function assertComposedMatchesStagedArtifact(composed = {}, binding = {}) {
  const result = composed.result && typeof composed.result === "object" ? composed.result : {};
  const draft = binding.draft && typeof binding.draft === "object" ? binding.draft : {};
  const payload = binding.audit?.payload && typeof binding.audit.payload === "object" ? binding.audit.payload : {};
  const subject = String(result.subject || "").trim();
  const body = String(result.body || result.bodyPreview || "").trim();
  const html = String(result.htmlPreview || result.html || "");
  if (!subject || !body || !html
    || subject !== String(draft.subject || "").trim()
    || body !== String(draft.body || "").trim()
    || htmlSha256(html) !== String(payload.html_sha256 || "")) {
    throw routeError(
      422,
      "staged_draft_artifact_mismatch",
      "The freshly composed owner copy did not exactly match the staged review artifact. No email was sent.",
    );
  }
}

async function claimOwnerDelivery({ prospectId: prospectIdValue, runId }) {
  return insertRow("ghost_agency_events", {
    id: deterministicOwnerClaimId(prospectIdValue),
    type: OWNER_DELIVERY_CLAIM_TYPE,
    payload: {
      actor: "admin_owner_smoke",
      status: "claimed",
      hold_key: "supervised_10_review_pending",
      prospectId: prospectIdValue,
      runId,
    },
    created_at: new Date().toISOString(),
  });
}

function routeError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function recipientList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const recipient = String(value || "").trim();
  return recipient ? [recipient] : [];
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function assertStrictOwnerDelivery(delivery = {}, policy = {}) {
  const envelope = delivery && typeof delivery === "object" ? delivery : {};
  const owner = String(policy.owner || "").trim();
  const to = recipientList(envelope.to);
  const cc = recipientList(envelope.cc);
  const bcc = recipientList(envelope.bcc);
  const toIsConfiguredOwner = Boolean(owner)
    && to.length === 1
    && normalizeEmail(to[0]) === normalizeEmail(owner);

  if (!toIsConfiguredOwner || cc.length !== 0 || bcc.length !== 0) {
    throw routeError(
      422,
      "recipient_gate_failed",
      "Owner proof delivery requires exactly the configured owner with no cc or bcc.",
      {
        toCount: to.length,
        ccCount: cc.length,
        bccCount: bcc.length,
        toIsConfiguredOwner,
      },
    );
  }

  return { to: owner, cc: [], bcc: [] };
}

function captureStrictOwnerPolicy() {
  const configured = ownerProofRecipients();
  return {
    owner: assertStrictOwnerDelivery(
      { to: configured.owner, cc: configured.cc, bcc: [] },
      { owner: configured.owner },
    ).to,
  };
}

function assertOwnerPolicyStable(policy) {
  const configured = ownerProofRecipients();
  return assertStrictOwnerDelivery(
    { to: configured.owner, cc: configured.cc, bcc: [] },
    policy,
  );
}

function guardedOwnerSend(sendSequenceStepDependency, policy) {
  return async function strictOwnerSend(input = {}) {
    assertOwnerPolicyStable(policy);
    assertStrictOwnerDelivery({
      to: firstValue(input.prospect || {}, OWNER_CONTACT_FIELDS),
      cc: input.cc,
      bcc: input.bcc,
    }, policy);
    return sendSequenceStepDependency(input);
  };
}

function boundedDuration(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, minimum), maximum);
}

function positiveGate(value) {
  return value === true || value === 1 || /^(true|yes|ok|pass|passed|ready|cleared)$/i.test(String(value || "").trim());
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function firstOwnValue(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) return { found: true, value: source[key] };
    }
  }
  return { found: false, value: undefined };
}

function persistedGenerationFingerprint({ prospect, record, callback, dispatch }) {
  const direct = firstOwnValue(
    [prospect, record],
    ["siteforge_generation_fingerprint", "siteforge_composition_fingerprint"],
  );
  const nested = direct.found
    ? direct
    : firstOwnValue(
        [callback, dispatch],
        ["generation_fingerprint", "generationFingerprint", "composition_fingerprint", "compositionFingerprint"],
      );
  return String(nested.value || "").trim();
}

function persistedArtifactUrl({ prospect, record, callback, dispatch }, names) {
  for (const source of [prospect, record, callback, dispatch]) {
    if (!source || typeof source !== "object") continue;
    for (const name of names) {
      const candidate = source[name];
      if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
        return String(candidate).trim();
      }
    }
  }
  return "";
}

function persistedBuild(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const callback = prospect.siteforge_callback && typeof prospect.siteforge_callback === "object"
    ? prospect.siteforge_callback
    : record.siteforge_callback && typeof record.siteforge_callback === "object"
      ? record.siteforge_callback
      : {};
  const dispatch = prospect.build_dispatch && typeof prospect.build_dispatch === "object"
    ? prospect.build_dispatch
    : record.build_dispatch && typeof record.build_dispatch === "object"
      ? record.build_dispatch
      : {};
  return {
    ok: true,
    prospect_id: prospectId(prospect),
    business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"]),
    status: firstValue(prospect, ["status"], ""),
    // Column URLs are authoritative when present. The nested durable record,
    // callback, and dispatch remain safe fallbacks for older rows whose URL
    // mirror columns have not been backfilled yet.
    preview_url: persistedArtifactUrl({ prospect, record, callback, dispatch }, ["preview_url", "previewUrl"]),
    report_url: persistedArtifactUrl({ prospect, record, callback, dispatch }, ["report_url", "reportUrl"]),
    checkout_url: persistedArtifactUrl({ prospect, record, callback, dispatch }, ["checkout_url", "checkoutUrl"]),
    renderer: String(firstDefined(
      prospect.siteforge_renderer,
      record.siteforge_renderer,
      callback.renderer,
      dispatch.renderer,
    ) || "").trim(),
    generation_fingerprint: persistedGenerationFingerprint({ prospect, record, callback, dispatch }),
    qc_passed: positiveGate(firstDefined(
      prospect.siteforge_qc_passed,
      record.siteforge_qc_passed,
      callback.qc_passed,
      dispatch.qc_passed,
    )),
    visual_qc_passed: positiveGate(firstDefined(
      prospect.siteforge_visual_qc_passed,
      record.siteforge_visual_qc_passed,
      callback.visual_qc_passed,
      dispatch.visual_qc_passed,
    )),
    qc_contract: String(firstDefined(
      prospect.siteforge_qc_contract,
      record.siteforge_qc_contract,
      callback.qc_contract,
      dispatch.qc_contract,
    ) || "").trim(),
  };
}

function publicBuild(build = {}) {
  return {
    prospect_id: build.prospect_id || null,
    status: build.status || null,
    renderer: build.renderer || null,
    generation_fingerprint: build.generation_fingerprint || null,
    qc_passed: build.qc_passed === true,
    visual_qc_passed: build.visual_qc_passed === true,
    qc_contract: build.qc_contract || null,
    preview_url: build.preview_url || null,
    report_url: build.report_url || null,
  };
}

function persistedReplacementFailures(replacement = {}, persisted = {}, expectedProspectId = "") {
  const failures = buildGateFailures(persisted, expectedProspectId);
  for (const field of ["renderer", "generation_fingerprint", "preview_url", "report_url", "qc_contract"]) {
    if (persisted[field] !== replacement[field]) failures.push(`${field}_not_persisted`);
  }
  return [...new Set(failures)];
}

function parseInput(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw routeError(400, "invalid_body", "Request body must be a JSON object.");
  }
  if (typeof body.prospectId !== "string") {
    throw routeError(400, "prospect_id_required", "prospectId is required.");
  }
  const selectedProspectId = body.prospectId.trim();
  if (!selectedProspectId || selectedProspectId.length > 200 || /[\u0000-\u001f]/.test(selectedProspectId)) {
    throw routeError(400, "prospect_id_invalid", "prospectId is invalid.");
  }
  const action = body.action === undefined || body.action === null || body.action === ""
    ? "compose"
    : String(body.action).trim();
  if (!new Set(["compose", "send"]).has(action)) {
    throw routeError(400, "action_invalid", "action must be compose or send.");
  }
  if (action === "send" && body.confirmation !== SEND_CONFIRMATION) {
    throw routeError(400, "send_confirmation_required", `Send requires exact confirmation ${SEND_CONFIRMATION}.`);
  }
  return { prospectId: selectedProspectId, action };
}

async function loadPersistedProspect(selectedProspectId, deps) {
  const result = await deps.select(
    "ghost_agency_prospects",
    `?select=*&prospect_id=eq.${encodeURIComponent(selectedProspectId)}&limit=2`,
  );
  if (!result || result.ok !== true || !Array.isArray(result.data)) {
    throw routeError(503, "prospect_store_unavailable", "Persisted prospects are unavailable.");
  }
  if (result.data.length === 0) {
    throw routeError(404, "prospect_not_found", "No persisted prospect matched prospectId.");
  }
  if (result.data.length !== 1) {
    throw routeError(409, "prospect_not_unique", "prospectId did not resolve to exactly one persisted lead.");
  }
  const prospect = prospectFromRow(result.data[0]);
  if (!prospect || prospectId(prospect) !== selectedProspectId) {
    throw routeError(409, "prospect_identity_mismatch", "Persisted prospect identity did not match prospectId.");
  }
  const eligibility = minedEligibility(prospect);
  if (!eligibility.ok) {
    throw routeError(422, "prospect_not_eligible", "Persisted prospect is not an eligible mined lead.", {
      reason: eligibility.reason,
    });
  }
  return prospect;
}

async function settleWithin(promise, timeoutMs) {
  let timer;
  const settled = Promise.resolve(promise).then(
    (value) => ({ timedOut: false, value }),
    (error) => ({ timedOut: false, error }),
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function resumePayload(prospectIdValue, action) {
  return {
    method: "POST",
    body: { prospectId: prospectIdValue, action },
    confirmation_required: action === "send" ? SEND_CONFIRMATION : null,
  };
}

function sendResumable(res, payload) {
  res.setHeader("Retry-After", "3");
  sendJson(res, 202, { ok: true, resumable: true, ...payload });
}

async function validateBuildUrls(build, deps) {
  const [preview, report] = await Promise.all([
    validateArtifactUrl(build.preview_url, "preview", deps.fetch, { timeoutMs: deps.urlTimeoutMs }),
    validateArtifactUrl(build.report_url, "report", deps.fetch, { timeoutMs: deps.urlTimeoutMs }),
  ]);
  return { preview, report };
}

async function buildThenResume({ prospect, selectedProspectId, action, reason, startedAt, runId, res, deps }) {
  const elapsed = deps.now() - startedAt;
  const remaining = deps.responseBudgetMs - elapsed;
  if (remaining < 1_000) {
    sendResumable(res, {
      status: "build_deferred",
      prospect_id: selectedProspectId,
      action,
      reason,
      retry: resumePayload(selectedProspectId, action),
    });
    return;
  }

  const budget = Math.min(deps.buildBudgetMs, remaining);
  let buildPromise = deps.inflightBuilds.get(selectedProspectId);
  if (!buildPromise) {
    buildPromise = Promise.resolve().then(() => deps.buildPreviewForProspect(prospect, {
      runId,
      source: "admin_owner_smoke",
      persist: true,
    }));
    deps.inflightBuilds.set(selectedProspectId, buildPromise);
    buildPromise.then(
      () => {
        if (deps.inflightBuilds.get(selectedProspectId) === buildPromise) deps.inflightBuilds.delete(selectedProspectId);
      },
      () => {
        if (deps.inflightBuilds.get(selectedProspectId) === buildPromise) deps.inflightBuilds.delete(selectedProspectId);
      },
    );
  }
  const outcome = await settleWithin(
    buildPromise,
    budget,
  );
  if (outcome.timedOut) {
    sendResumable(res, {
      status: "build_pending",
      prospect_id: selectedProspectId,
      action,
      reason,
      retry: resumePayload(selectedProspectId, action),
    });
    return;
  }
  if (outcome.error) {
    throw routeError(502, "siteforge_build_failed", "SiteForge build failed before the QC gate.");
  }

  const build = outcome.value || {};
  if (build.pending === true) {
    sendResumable(res, {
      status: "build_pending",
      prospect_id: selectedProspectId,
      action,
      reason: "siteforge_durable_job_pending",
      build: publicBuild(build),
      retry: resumePayload(selectedProspectId, action),
    });
    return;
  }
  const failures = buildGateFailures(build, selectedProspectId);
  if (failures.length) {
    sendJson(res, 422, {
      ok: false,
      error: "siteforge_qc_blocked",
      prospect_id: selectedProspectId,
      failures,
      build: publicBuild(build),
    });
    return;
  }

  const persistedProspect = await loadPersistedProspect(selectedProspectId, deps);
  const durableBuild = persistedBuild(persistedProspect);
  const persistenceFailures = persistedReplacementFailures(build, durableBuild, selectedProspectId);
  if (persistenceFailures.length) {
    sendJson(res, 503, {
      ok: false,
      error: "siteforge_build_not_persisted",
      message: "SiteForge returned a passing build, but the durable prospect record did not match it.",
      prospect_id: selectedProspectId,
      failures: persistenceFailures,
      build: publicBuild(build),
    });
    return;
  }

  sendResumable(res, {
    status: "build_ready_resume",
    prospect_id: selectedProspectId,
    action,
    build: publicBuild(durableBuild),
    retry: resumePayload(selectedProspectId, action),
  });
}

function sendRouteError(res, error) {
  if (error?.statusCode) {
    sendJson(res, error.statusCode, {
      ok: false,
      error: error.code || "owner_smoke_blocked",
      message: error.message,
      details: error.details,
    });
    return;
  }
  const knownBlocked = new Set([
    "delivery_clone_recipient_failed",
    "email_preview_missing",
    "owner_email_delivery_busy",
    "owner_email_not_sent",
    "owner_email_path_blocked",
    "recipient_gate_failed",
    "siteforge_gate_failed",
  ]);
  if (knownBlocked.has(error?.code)) {
    sendJson(res, 422, {
      ok: false,
      error: error.code,
      message: "Owner smoke was blocked before unsafe delivery.",
    });
    return;
  }
  sendJson(res, 500, { ok: false, error: "internal_error", message: "Owner smoke failed safely." });
}

async function requireStagedTenMembership(prospect, deps) {
  let membership;
  try {
    membership = await deps.verifyStagedTenMembership({
      prospect,
      nowMs: deps.now(),
    });
  } catch {
    membership = { ok: false, reason: "staged_ten_state_unavailable" };
  }
  if (membership?.ok === true) return membership;
  throw routeError(
    422,
    STAGED_TEN_MEMBERSHIP_ERROR,
    "Exact membership in the active supervised 10 could not be verified. No email was composed or sent.",
    { reason: membership?.reason || "staged_ten_membership_unverified" },
  );
}

function createOwnerSmokeHandler(overrides = {}) {
  const deps = {
    buildPreviewForProspect,
    buildBudgetMs: DEFAULT_BUILD_BUDGET_MS,
    claimOwnerDelivery,
    fetch: (...args) => globalThis.fetch(...args),
    inflightBuilds: new Map(),
    invokeOwnerEmailPath,
    now: () => Date.now(),
    responseBudgetMs: DEFAULT_RESPONSE_BUDGET_MS,
    select,
    loadStagedArtifactBinding,
    sendSequenceStep,
    sendStartCutoffMs: DEFAULT_SEND_START_CUTOFF_MS,
    urlTimeoutMs: DEFAULT_URL_TIMEOUT_MS,
    verifyStagedTenMembership,
    ...overrides,
  };
  deps.buildBudgetMs = boundedDuration(deps.buildBudgetMs, DEFAULT_BUILD_BUDGET_MS, 1, 297_000);
  deps.responseBudgetMs = boundedDuration(deps.responseBudgetMs, DEFAULT_RESPONSE_BUDGET_MS, 1_000, 299_000);
  deps.sendStartCutoffMs = boundedDuration(deps.sendStartCutoffMs, DEFAULT_SEND_START_CUTOFF_MS, 1_000, 15_000);
  deps.urlTimeoutMs = boundedDuration(deps.urlTimeoutMs, DEFAULT_URL_TIMEOUT_MS, 1_000, 10_000);

  return async function ownerSmokeHandler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    if (!requireAdmin(req, res)) return;
    const startedAt = deps.now();
    try {
      const input = parseInput(await readJson(req));
      const prospect = await loadPersistedProspect(input.prospectId, deps);
      const membership = await requireStagedTenMembership(prospect, deps);
      const runId = `owner_one_${deps.now()}_${randomUUID().slice(0, 8)}`;
      const build = persistedBuild(prospect);
      const persistedFailures = buildGateFailures(build, input.prospectId);
      if (persistedFailures.length) {
        await buildThenResume({
          prospect,
          selectedProspectId: input.prospectId,
          action: input.action,
          reason: "persisted_build_not_ready",
          startedAt,
          runId,
          res,
          deps,
        });
        return;
      }

      let urlValidation;
      try {
        urlValidation = await validateBuildUrls(build, deps);
      } catch {
        await buildThenResume({
          prospect,
          selectedProspectId: input.prospectId,
          action: input.action,
          reason: "persisted_artifact_unreachable",
          startedAt,
          runId,
          res,
          deps,
        });
        return;
      }

      const ownerPolicy = captureStrictOwnerPolicy();
      let binding;
      try {
        binding = await deps.loadStagedArtifactBinding({
          prospectId: input.prospectId,
          membership,
        }, deps);
      } catch {
        binding = { ok: false, reason: "staged_artifact_state_unavailable" };
      }
      if (!binding?.ok) {
        throw routeError(
          422,
          "staged_draft_artifact_required",
          "The exact staged review artifact and its audit proof could not be verified. No email was composed or sent.",
          { reason: binding?.reason || "staged_artifact_state_unavailable" },
        );
      }
      const composed = await deps.invokeOwnerEmailPath({
        prospect,
        build,
        runId,
        dryRun: true,
        disableOrganicComposition: true,
        deps: { sendSequenceStep: deps.sendSequenceStep },
      });
      const envelope = assertStrictOwnerDelivery(composed.envelope, ownerPolicy);
      assertComposedMatchesStagedArtifact(composed, binding);
      if (input.action === "compose") {
        sendJson(res, 200, {
          ok: true,
          status: "composed",
          action: "compose",
          prospect: {
            prospect_id: input.prospectId,
            business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"]),
          },
          build: publicBuild(build),
          url_validation: urlValidation,
          delivery: envelope,
          email: {
            subject: composed.result.subject || null,
            html: composed.result.htmlPreview,
          },
        });
        return;
      }

      if (deps.now() - startedAt > deps.sendStartCutoffMs) {
        sendResumable(res, {
          status: "ready_to_send",
          prospect_id: input.prospectId,
          action: "send",
          build: publicBuild(build),
          retry: resumePayload(input.prospectId, "send"),
        });
        return;
      }

      assertOwnerPolicyStable(ownerPolicy);
      const claim = await deps.claimOwnerDelivery({ prospectId: input.prospectId, runId });
      if (!claim || !["live_write", "live_upsert"].includes(claim.mode)) {
        throw routeError(
          409,
          "owner_delivery_already_claimed_or_unavailable",
          "Owner proof delivery was already claimed or its durable claim could not be verified. No email was sent.",
          {
            claimMode: claim?.mode || "unknown",
            claimStatus: Number(claim?.status) || null,
          },
        );
      }
      const delivered = await deps.invokeOwnerEmailPath({
        prospect,
        build,
        runId,
        dryRun: false,
        disableOrganicComposition: true,
        deps: { sendSequenceStep: guardedOwnerSend(deps.sendSequenceStep, ownerPolicy) },
      });
      const deliveredEnvelope = assertStrictOwnerDelivery(delivered.envelope, ownerPolicy);
      sendJson(res, 200, {
        ok: true,
        status: "owner_sent",
        action: "send",
        prospect: {
          prospect_id: input.prospectId,
          business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"]),
        },
        build: publicBuild(build),
        url_validation: urlValidation,
        delivery: deliveredEnvelope,
        email: {
          subject: composed.result.subject || null,
          mode: delivered.result.mode,
          provider_id: delivered.result.id || null,
        },
      });
    } catch (error) {
      if (error?.code === "invalid_json") {
        sendJson(res, 400, { ok: false, error: "invalid_json", message: "Request body must be valid JSON." });
        return;
      }
      sendRouteError(res, error);
    }
  };
}

const handler = createOwnerSmokeHandler();

module.exports = handler;
module.exports.SEND_CONFIRMATION = SEND_CONFIRMATION;
module.exports.createOwnerSmokeHandler = createOwnerSmokeHandler;
module.exports.persistedBuild = persistedBuild;
