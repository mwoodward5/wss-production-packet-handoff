"use strict";

const crypto = require("node:crypto");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { truthPacketFromCanonical } = require("../../lib/intake-genie-client");
const { prospectFromRow, prospectId, recordForPersist } = require("../../lib/prospects");
const {
  extractAuthoritySummary,
  extractBuildStatus,
  extractBuildUrls,
  extractCompiledTruthPacket,
  extractOptimizationManifestUrl,
  extractReleaseEvidence,
} = require("../../lib/siteforge");
const { event, select, upsertRow } = require("../../lib/store");

function safeEq(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function callbackToken() {
  return (
    process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN?.trim() ||
    process.env.GHOST_AGENCY_SITEFORGE_BUILD_TOKEN?.trim() ||
    ""
  );
}

function authorize(req) {
  const token = callbackToken();
  if (!token) return { ok: false, error: "siteforge_callback_token_unset", statusCode: 503 };
  const bearer = String(req.headers.authorization || req.headers.Authorization || "").replace(/^Bearer\s+/i, "");
  const direct = req.headers["x-siteforge-token"] || "";
  return safeEq(bearer, token) || safeEq(direct, token)
    ? { ok: true }
    : { ok: false, error: "unauthorized", statusCode: 401 };
}

function firstString(input, keys) {
  for (const key of keys) {
    const value = input && input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function callbackProspectId(body = {}) {
  return (
    firstString(body, ["prospect_id", "prospectId", "lead_id", "leadId"]) ||
    firstString(body.prospect, ["prospect_id", "prospectId", "id"]) ||
    firstString(body.lead, ["prospect_id", "prospectId", "id"])
  );
}

function callbackJobId(body = {}) {
  return firstString(body, ["job_id", "jobId"]);
}

function expectedJobId(prospect = {}) {
  const dispatch = prospect.build_dispatch && typeof prospect.build_dispatch === "object"
    ? prospect.build_dispatch
    : {};
  return firstString(dispatch, ["job_id", "jobId"]);
}

function isKnownPendingLegacyJob(prospect = {}) {
  const dispatch = prospect.build_dispatch && typeof prospect.build_dispatch === "object"
    ? prospect.build_dispatch
    : {};
  const jobId = firstString(dispatch, ["job_id", "jobId"]);
  const statusUrl = firstString(dispatch, ["status_url", "statusUrl"]);
  const prospectStatus = String(prospect.status || "").trim().toLowerCase();
  if (!jobId || dispatch.pending === false || dispatch.ready === true || prospectStatus === "previewed") {
    return false;
  }

  let boundStatusUrl = false;
  if (statusUrl) {
    try {
      const parsed = new URL(statusUrl);
      const lastSegment = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
      boundStatusUrl = parsed.protocol === "https:"
        && !parsed.username
        && !parsed.password
        && lastSegment === jobId;
    } catch (_) {
      return false;
    }
    if (!boundStatusUrl) return false;
  }

  // Current rows declare pending=true and carry a bound status handle. Rows
  // written before that schema existed can omit both fields; for those only,
  // status=new plus the build's persisted generation fingerprint is the
  // durable evidence that a callback is still outstanding.
  if (dispatch.pending === true) return boundStatusUrl;
  const legacyFingerprint = firstString(dispatch, ["generation_fingerprint", "generationFingerprint"]);
  return (prospectStatus === "new" || !prospectStatus)
    && (boundStatusUrl || Boolean(legacyFingerprint));
}

function identityKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ") || "";
}

function websiteHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function existingTruthFacts(existing = {}) {
  const packet = existing.truth_packet && typeof existing.truth_packet === "object"
    ? existing.truth_packet
    : {};
  const canonical = packet.intakeGenie && typeof packet.intakeGenie === "object"
    ? packet.intakeGenie
    : packet;
  return canonical.facts && typeof canonical.facts === "object" ? canonical.facts : {};
}

function firstIdentityValue(input = {}, keys = []) {
  return firstString(input, keys);
}

function exactBoundField({ expected, callback, releaseExpected, releaseActual, releasePublic, normalize = identityKey }) {
  const expectedValue = normalize(expected);
  if (!expectedValue) return false;
  return [callback, releaseExpected, releaseActual, releasePublic]
    .map(normalize)
    .every((value) => value && value === expectedValue);
}

function callbackTruthBinding(body = {}, packet = {}, releaseEvidence = {}, existing = {}) {
  const facts = packet.facts && typeof packet.facts === "object" ? packet.facts : {};
  const priorFacts = existingTruthFacts(existing);
  const identity = releaseEvidence.identity && typeof releaseEvidence.identity === "object"
    ? releaseEvidence.identity
    : {};
  const callbackProspect = body.prospect && typeof body.prospect === "object" ? body.prospect : {};

  const expectedName = firstIdentityValue(existing, ["business_name", "businessName", "name"])
    || firstIdentityValue(priorFacts, ["name", "business_name", "businessName"]);
  const callbackName = firstIdentityValue(facts, ["name", "business_name", "businessName"]);
  if (!exactBoundField({
    expected: expectedName,
    callback: callbackName,
    releaseExpected: identity.expected?.business_name,
    releaseActual: identity.actual?.business_name,
    releasePublic: identity.actual?.public_packet_business_name,
  })) return { ok: false, reason: "identity_mismatch" };
  const prospectName = firstIdentityValue(callbackProspect, ["business_name", "businessName", "name"]);
  if (prospectName && identityKey(prospectName) !== identityKey(expectedName)) {
    return { ok: false, reason: "identity_mismatch" };
  }

  for (const field of ["city", "state"]) {
    const expectedValue = firstIdentityValue(existing, [field])
      || firstIdentityValue(priorFacts, [field]);
    if (!exactBoundField({
      expected: expectedValue,
      callback: firstIdentityValue(facts, [field]),
      releaseExpected: identity.expected?.[field],
      releaseActual: identity.actual?.[field],
      releasePublic: identity.actual?.[`public_packet_${field}`],
    })) return { ok: false, reason: "location_mismatch" };
    const prospectValue = firstIdentityValue(callbackProspect, [field]);
    if (prospectValue && identityKey(prospectValue) !== identityKey(expectedValue)) {
      return { ok: false, reason: "location_mismatch" };
    }
  }

  const websiteKeys = ["source_website", "website_url", "current_website", "website"];
  const expectedWebsite = firstIdentityValue(existing, websiteKeys)
    || firstIdentityValue(priorFacts, websiteKeys);
  const callbackWebsite = firstIdentityValue(facts, websiteKeys);
  if (!exactBoundField({
    expected: expectedWebsite,
    callback: callbackWebsite,
    releaseExpected: identity.expected?.source_website,
    releaseActual: identity.actual?.source_website,
    releasePublic: identity.actual?.public_packet_source_website,
    normalize: websiteHost,
  })) return { ok: false, reason: "source_host_mismatch" };
  const prospectWebsite = firstIdentityValue(callbackProspect, websiteKeys);
  if (prospectWebsite && websiteHost(prospectWebsite) !== websiteHost(expectedWebsite)) {
    return { ok: false, reason: "source_host_mismatch" };
  }

  return { ok: true };
}

function callbackMutationBinding(body = {}, buildStatus = {}, releaseEvidence = null, existing = {}) {
  const incomingJobId = callbackJobId(body);
  const activeJobId = expectedJobId(existing);
  if (!activeJobId) return { ok: false, reason: "active_job_missing" };
  if (!incomingJobId) return { ok: false, reason: "job_id_missing" };
  if (incomingJobId !== activeJobId) return { ok: false, reason: "job_id_mismatch" };
  if (!isKnownPendingLegacyJob(existing)) return { ok: false, reason: "active_job_not_pending" };

  const generationFingerprint = String(buildStatus.generation_fingerprint || "").trim();
  if (!generationFingerprint) return { ok: false, reason: "generation_fingerprint_missing" };
  const activeFingerprint = firstString(
    existing.build_dispatch && typeof existing.build_dispatch === "object"
      ? existing.build_dispatch
      : {},
    ["generation_fingerprint", "generationFingerprint"],
  );
  if (activeFingerprint && activeFingerprint !== generationFingerprint) {
    return { ok: false, reason: "generation_fingerprint_mismatch" };
  }

  if (!releaseEvidence) return { ok: false, reason: "release_evidence_missing" };
  const canonical = extractCompiledTruthPacket(body);
  if (!canonical) return { ok: false, reason: "truth_packet_missing" };
  const packetFingerprint = firstString(canonical, ["generation_fingerprint", "generationFingerprint"])
    || firstString(canonical?.rendered_truth, ["generation_fingerprint", "generationFingerprint"]);
  const prospectFingerprint = firstString(
    body.prospect && typeof body.prospect === "object" ? body.prospect : {},
    ["generation_fingerprint", "generationFingerprint"],
  );
  if (
    !packetFingerprint
    || packetFingerprint !== generationFingerprint
    || !prospectFingerprint
    || prospectFingerprint !== generationFingerprint
  ) return { ok: false, reason: "generation_fingerprint_mismatch" };

  const packetReleaseEvidence = canonical.release_evidence || canonical.releaseEvidence || null;
  if (
    !packetReleaseEvidence
    || canonicalJson(packetReleaseEvidence) !== canonicalJson(releaseEvidence)
  ) return { ok: false, reason: "release_evidence_mismatch" };

  const identityBinding = callbackTruthBinding(body, canonical, releaseEvidence, existing);
  if (!identityBinding.ok) return identityBinding;

  try {
    const packet = truthPacketFromCanonical(canonical);
    if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
      return { ok: false, reason: "truth_packet_invalid" };
    }
    return {
      ok: true,
      truthPacket: {
        ...packet,
        meta: {
          ...(packet.meta && typeof packet.meta === "object" ? packet.meta : {}),
          generation_fingerprint: generationFingerprint,
        },
      },
    };
  } catch {
    return { ok: false, reason: "truth_packet_invalid" };
  }
}

function ignoredCallbackReason(reason) {
  if (reason === "job_id_mismatch") return "stale_siteforge_job";
  if (reason === "job_id_missing") return "missing_siteforge_job_id";
  if (reason === "active_job_missing") return "missing_active_siteforge_job";
  if (reason === "active_job_not_pending") return "siteforge_job_not_pending";
  return reason;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  const auth = authorize(req);
  if (!auth.ok) {
    sendJson(res, auth.statusCode, { ok: false, error: auth.error });
    return;
  }

  try {
    const body = await readJson(req).catch(() => ({}));
    const id = callbackProspectId(body);
    if (!id) {
      sendJson(res, 400, { ok: false, error: "missing_prospect_id" });
      return;
    }

    const urls = extractBuildUrls(body);
    const reportUrl = urls.report_url || "";
    const previewUrl = urls.preview_url || "";
    const buildStatus = extractBuildStatus(body);
    const authoritySummary = extractAuthoritySummary(body);
    const optimizationManifestUrl = extractOptimizationManifestUrl(body);
    const incomingReleaseEvidence = extractReleaseEvidence(body);
    const ready = Boolean(buildStatus.ready);
    const existingResult = await select(
      "ghost_agency_prospects",
      `?select=*&prospect_id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    const existingRow = existingResult.ok && existingResult.data && existingResult.data[0];
    const existing = prospectFromRow(existingRow) || {};
    // Every persisted callback field belongs to one exact active job, customer,
    // source, and rendered generation. Validate all of those bindings before
    // accepting even a URL or a nested prospect field.
    const releaseEvidence = incomingReleaseEvidence || null;
    const binding = callbackMutationBinding(body, buildStatus, releaseEvidence, existing);
    if (!binding.ok) {
      await event({
        type: "siteforge.callback_ignored",
        actor: "agent_05_site_builder",
        status: "stale",
        payload: {
          prospectId: id,
          reason: binding.reason,
        },
      });
      sendJson(res, 200, {
        ok: true,
        ignored: true,
        reason: ignoredCallbackReason(binding.reason),
        prospect_id: id,
      });
      return;
    }
    const existingCallback = existing.siteforge_callback && typeof existing.siteforge_callback === "object"
      ? existing.siteforge_callback
      : {};
    const canonicalId = prospectId({ ...existing, prospect_id: id });
    const now = new Date().toISOString();
    const freshTruthPacket = ready ? binding.truthPacket : null;
    const status = ready ? "previewed" : existing.status || "new";
    const settledDispatch = {
      ...existing.build_dispatch,
      pending: ready ? false : true,
      ready,
      ...(ready ? { completed_at: now } : {}),
    };
    const mergedRecord = {
      // `existing` is prospectFromRow(existingRow) and still carries `record`;
      // spreading it raw nested the whole prior blob on every callback.
      ...recordForPersist(existing),
      ...recordForPersist(body.prospect && typeof body.prospect === "object" ? body.prospect : {}),
      prospect_id: canonicalId,
      report_url: reportUrl || existing.report_url || null,
      preview_url: previewUrl || existing.preview_url || null,
      authority_summary: authoritySummary || existing.authority_summary || null,
      optimization_manifest_url: optimizationManifestUrl || existing.optimization_manifest_url || null,
      siteforge_renderer: buildStatus.renderer || null,
      siteforge_generation_fingerprint: buildStatus.generation_fingerprint || null,
      siteforge_qc_passed: buildStatus.qc_passed,
      siteforge_visual_qc_passed: buildStatus.visual_qc_passed,
      siteforge_qc_contract: buildStatus.qc_contract,
      release_evidence: releaseEvidence,
      truth_packet: freshTruthPacket || existing.truth_packet || null,
      build_dispatch: settledDispatch,
      siteforge_callback: {
        ...existingCallback,
        received_at: now,
        status: firstString(body, ["status", "state"]) || (ready ? "ready" : "received_without_both_urls"),
        report_url: reportUrl || null,
        preview_url: previewUrl || null,
        optimization_manifest_url: optimizationManifestUrl || null,
        authority_summary: authoritySummary,
        ready,
        renderer: buildStatus.renderer || null,
        required_renderer: buildStatus.required_renderer,
        generation_fingerprint: buildStatus.generation_fingerprint || null,
        qc_passed: buildStatus.qc_passed,
        visual_qc_passed: buildStatus.visual_qc_passed,
        qc_contract: buildStatus.qc_contract,
        grade: buildStatus.grade,
        score: buildStatus.score,
        blocked: buildStatus.blocked,
        release_evidence: releaseEvidence,
        ...(freshTruthPacket
          ? {
              truth_packet_source: freshTruthPacket.meta.source || "intake_genie",
              truth_packet_generation_fingerprint: buildStatus.generation_fingerprint,
              truth_packet_received_at: now,
            }
          : {}),
      },
    };

    const row = await upsertRow(
      "ghost_agency_prospects",
      {
        prospect_id: canonicalId,
        status,
        report_url: reportUrl || existing.report_url || null,
        preview_url: previewUrl || existing.preview_url || null,
        record: mergedRecord,
        updated_at: now,
      },
      "prospect_id",
    );

    await event({
      type: "siteforge.callback",
      actor: "agent_05_site_builder",
      status: ready ? "ok" : "partial",
      payload: {
        prospectId: canonicalId,
        reportUrlReady: Boolean(reportUrl),
        previewUrlReady: Boolean(previewUrl),
        renderer: buildStatus.renderer || null,
        generationFingerprint: buildStatus.generation_fingerprint || null,
        qcPassed: buildStatus.qc_passed,
        blocked: buildStatus.blocked,
        persistence: row.mode || row.status,
      },
    });

    sendJson(res, 200, {
      ok: true,
      prospect_id: canonicalId,
      status,
      ready,
      report_url: reportUrl || null,
      preview_url: previewUrl || null,
      generation_fingerprint: buildStatus.generation_fingerprint || null,
      optimization_manifest_url: optimizationManifestUrl || null,
      authority_summary: authoritySummary,
      release_evidence: releaseEvidence || null,
      persistence: row.mode || row.status,
    });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.isKnownPendingLegacyJob = isKnownPendingLegacyJob;
