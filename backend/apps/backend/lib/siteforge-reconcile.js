"use strict";

const { prospectFromRow, prospectId } = require("./prospects");
const {
  CANONICAL_SITEFORGE_BUILD_URL,
  extractAuthoritySummary,
  extractBuildStatus,
  extractBuildUrls,
  extractCompiledTruthPacket,
  extractOptimizationManifestUrl,
  extractReleaseEvidence,
  siteForgeBuildToken,
} = require("./siteforge");

const SITEFORGE_PENDING_REASON = "siteforge_build_pending";
const DEFAULT_RECONCILE_BATCH = 5;
const MAX_RECONCILE_BATCH = 10;
const STATUS_READ_TIMEOUT_MS = 15_000;
let statusReadSequence = 0;
const SITEFORGE_TERMINAL_FAILURE_STATES = Object.freeze([
  "failed",
  "blocked",
  "timed_out",
]);

// The reconciler must ask PostgREST for only durable, already-dispatched jobs.
// Do not start from a broad "new" feed: a stream of unrelated new prospects can
// otherwise keep older pending SiteForge jobs outside the fixed scan window.
function pendingReconcileQuery(batch = DEFAULT_RECONCILE_BATCH) {
  const limit = boundedBatch(batch);
  return [
    "?select=*",
    "status=eq.new",
    "record->build_dispatch->>pending=eq.true",
    `record->>blocked_reason=eq.${SITEFORGE_PENDING_REASON}`,
    "order=updated_at.asc.nullslast",
    `limit=${limit}`,
  ].join("&");
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstString(input, keys) {
  for (const key of keys) {
    const value = input && input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function boundedBatch(value) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RECONCILE_BATCH;
  return Math.min(Math.max(parsed, 1), MAX_RECONCILE_BATCH);
}

function canonicalStatusUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const buildUrl = new URL(CANONICAL_SITEFORGE_BUILD_URL);
    const statusUrl = new URL(value.trim());
    const prefix = `${buildUrl.pathname.replace(/\/+$/, "")}/`;
    const jobPath = statusUrl.pathname.slice(prefix.length);
    if (
      statusUrl.protocol !== "https:"
      || statusUrl.origin !== buildUrl.origin
      || !statusUrl.pathname.startsWith(prefix)
      || !jobPath
      || !/^[a-zA-Z0-9._:-]+$/.test(jobPath)
      || statusUrl.username
      || statusUrl.password
      || statusUrl.search
      || statusUrl.hash
    ) {
      return "";
    }
    return statusUrl.toString();
  } catch (_) {
    return "";
  }
}

function jobIdFromStatusUrl(value) {
  const statusUrl = canonicalStatusUrl(value);
  if (!statusUrl) return "";
  const buildUrl = new URL(CANONICAL_SITEFORGE_BUILD_URL);
  const parsed = new URL(statusUrl);
  const prefix = `${buildUrl.pathname.replace(/\/+$/, "")}/`;
  return parsed.pathname.slice(prefix.length);
}

function terminalFailureState(json = {}) {
  if (!isObject(json) || json.ok !== false || json.pending !== false) return "";
  const state = String(json.status || json.state || "").trim().toLowerCase();
  return SITEFORGE_TERMINAL_FAILURE_STATES.includes(state) ? state : "";
}

function validatedTerminalResponse({ status, json, resume = {}, statusUrl = "" } = {}) {
  if (Number(status) !== 422) return "";
  const state = terminalFailureState(json);
  if (!state) return "";

  const urlJobId = jobIdFromStatusUrl(statusUrl);
  const responseJobId = firstString(json, ["job_id", "jobId", "id"]);
  const resumeJobId = firstString(resume, ["job_id", "jobId"]);
  if (!urlJobId || !responseJobId || responseJobId !== urlJobId) return "";
  if (resumeJobId && resumeJobId !== urlJobId) return "";
  return state;
}

function isValidatedTerminalDispatch(dispatch = {}) {
  if (!isObject(dispatch)) return false;
  if (dispatch.pending === true || dispatch.buildStatus?.pending === true) return false;
  if (dispatch.ready === true || dispatch.buildStatus?.ready === true) return false;

  const statusUrl = firstString(dispatch, ["status_url", "statusUrl"]);
  const jobId = firstString(dispatch, ["job_id", "jobId"]);
  const urlJobId = jobIdFromStatusUrl(statusUrl);
  if (!jobId || !urlJobId || jobId !== urlJobId) return false;

  const result = isObject(dispatch.result) ? dispatch.result : {};
  const json = isObject(result.json) ? result.json : {};
  if (Object.keys(json).length) {
    return Boolean(validatedTerminalResponse({
      status: result.status,
      json,
      resume: { job_id: jobId },
      statusUrl,
    }));
  }

  const persistedState = String(dispatch.reason || "").replace(/^siteforge_terminal_/, "");
  return Number(dispatch.status) === 422
    && SITEFORGE_TERMINAL_FAILURE_STATES.includes(persistedState);
}

function pendingCandidate(row) {
  if (!isObject(row)) return null;
  const prospect = prospectFromRow(row);
  if (!prospect || String(prospect.status || "").trim() !== "new") return null;
  const record = isObject(row.record) ? row.record : {};
  const dispatch = isObject(row.build_dispatch)
    ? row.build_dispatch
    : isObject(record.build_dispatch)
      ? record.build_dispatch
      : null;
  if (!dispatch || dispatch.pending !== true) return null;
  const blockedReason = firstString(row, ["blocked_reason"])
    || firstString(record, ["blocked_reason"]);
  if (blockedReason !== SITEFORGE_PENDING_REASON) return null;
  const statusUrl = canonicalStatusUrl(firstString(dispatch, ["status_url", "statusUrl"]));
  if (!statusUrl) return null;

  return {
    prospect: {
      ...prospect,
      build_dispatch: {
        ...dispatch,
        status_url: statusUrl,
      },
    },
    prospectId: prospectId(prospect),
    statusUrl,
  };
}

function isPendingResponse(status, json = {}) {
  const state = String(json.status || json.state || "").trim().toLowerCase();
  return status === 202
    || json.pending === true
    || ["new", "queued", "running", "building", "pending"].includes(state);
}

function safeFailureDispatch({ statusUrl, resume = {}, status = 0, code }) {
  return {
    mode: "existing_job_status_read",
    configured: true,
    url: CANONICAL_SITEFORGE_BUILD_URL,
    result: { ok: false, status, json: {} },
    urls: { report_url: "", preview_url: "" },
    buildStatus: {
      ...extractBuildStatus({}),
      ready: false,
      pending: false,
      blocked: [code],
    },
    authoritySummary: null,
    optimizationManifestUrl: "",
    releaseEvidence: null,
    pending: false,
    jobId: firstString(resume, ["job_id", "jobId"]) || null,
    statusUrl,
    payload: { prospect: {} },
    error: code,
  };
}

function createExistingJobDispatchReader({
  fetchImpl = globalThis.fetch,
  tokenProvider = siteForgeBuildToken,
  timeoutMs = STATUS_READ_TIMEOUT_MS,
} = {}) {
  return async function readExistingJob({ resume = {} } = {}) {
    const statusUrl = canonicalStatusUrl(firstString(resume, ["status_url", "statusUrl"]));
    if (!statusUrl) {
      return safeFailureDispatch({
        statusUrl: "",
        resume,
        code: "siteforge_existing_status_url_invalid",
      });
    }
    if (typeof fetchImpl !== "function") {
      return safeFailureDispatch({
        statusUrl,
        resume,
        code: "siteforge_status_reader_unavailable",
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const token = tokenProvider();
      const readUrl = new URL(statusUrl);
      statusReadSequence += 1;
      readUrl.searchParams.set("_ts", `${Date.now()}-${statusReadSequence}`);
      const response = await fetchImpl(readUrl.toString(), {
        method: "GET",
        cache: "no-store",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (_) {
        json = {};
      }

      const terminalState = validatedTerminalResponse({
        status: response.status,
        json,
        resume,
        statusUrl,
      });
      if (!response.ok && !terminalState) {
        return safeFailureDispatch({
          statusUrl,
          resume,
          status: response.status,
          code: `siteforge_status_http_${response.status || "failed"}`,
        });
      }

      const result = { ok: response.ok, status: response.status, json };
      const pending = isPendingResponse(response.status, json);
      const extractedStatus = extractBuildStatus(json);
      const buildStatus = pending
        ? { ...extractedStatus, ready: false, pending: true, blocked: [] }
        : { ...extractedStatus, pending: false };
      return {
        mode: "existing_job_status_read",
        configured: true,
        url: CANONICAL_SITEFORGE_BUILD_URL,
        result,
        urls: extractBuildUrls(json),
        buildStatus: terminalState ? { ...buildStatus, ready: false, pending: false } : buildStatus,
        authoritySummary: extractAuthoritySummary(json),
        optimizationManifestUrl: extractOptimizationManifestUrl(json),
        releaseEvidence: extractReleaseEvidence(json),
        truthPacket: extractCompiledTruthPacket(json),
        pending,
        jobId: firstString(resume, ["job_id", "jobId"])
          || firstString(json, ["job_id", "jobId", "id"])
          || null,
        // Never follow a status URL supplied by the response. The durable URL
        // selected from Ghost is the only job this reconciler may read.
        statusUrl,
        payload: { prospect: {} },
        ...(terminalState ? { reason: `siteforge_terminal_${terminalState}` } : {}),
      };
    } catch (error) {
      return safeFailureDispatch({
        statusUrl,
        resume,
        code: error && error.name === "AbortError"
          ? "siteforge_status_read_timeout"
          : "siteforge_status_read_failed",
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

function existingTruthPacket(prospect = {}) {
  if (isObject(prospect.truth_packet)) return prospect.truth_packet;
  if (isObject(prospect.record?.truth_packet)) return prospect.record.truth_packet;
  return {};
}

function safeCode(value, fallback = "unknown") {
  const code = String(value || "").trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  return code || fallback;
}

function sanitizedResult(result = {}, fallbackId = "unknown") {
  return {
    prospect_id: safeCode(result.prospect_id, safeCode(fallbackId)),
    status: result.status === "previewed" ? "previewed" : "new",
    ready: result.ok === true && result.status === "previewed",
    pending: result.pending === true,
    blocked: result.blocked ? safeCode(result.blocked) : null,
    persistence: safeCode(result.persistence, "unknown"),
  };
}

async function reconcileSiteForgeRows(rows = [], {
  batch = DEFAULT_RECONCILE_BATCH,
  buildPreviewForProspect,
  dispatchSiteForgePreview,
  buildPreviewOptions = {},
} = {}) {
  const limit = boundedBatch(batch);
  const candidates = (Array.isArray(rows) ? rows : [])
    .map(pendingCandidate)
    .filter(Boolean)
    .slice(0, limit);

  const results = await Promise.all(candidates.map(async (candidate) => {
    try {
      const result = await buildPreviewForProspect(candidate.prospect, {
        ...buildPreviewOptions,
        source: "siteforge_reconcile",
        dispatchSiteForgePreview,
        // Reconciliation must not call Intake Genie or any other producer.
        // It reuses the packet attached to the already-dispatched build only.
        truthPacketWithLocalPlan: async () => existingTruthPacket(candidate.prospect),
      });
      return sanitizedResult(result, candidate.prospectId);
    } catch (_) {
      return {
        prospect_id: safeCode(candidate.prospectId),
        status: "new",
        ready: false,
        pending: false,
        blocked: "siteforge_reconcile_failed",
        persistence: "unknown",
      };
    }
  }));

  return {
    selected: Array.isArray(rows) ? rows.length : 0,
    eligible: candidates.length,
    processed: results.length,
    skipped: Math.max((Array.isArray(rows) ? rows.length : 0) - candidates.length, 0),
    ready: results.filter((item) => item.ready).length,
    pending: results.filter((item) => item.pending).length,
    blocked: results.filter((item) => !item.ready && !item.pending).length,
    results,
  };
}

module.exports = {
  DEFAULT_RECONCILE_BATCH,
  MAX_RECONCILE_BATCH,
  SITEFORGE_PENDING_REASON,
  SITEFORGE_TERMINAL_FAILURE_STATES,
  boundedBatch,
  canonicalStatusUrl,
  createExistingJobDispatchReader,
  isValidatedTerminalDispatch,
  pendingCandidate,
  pendingReconcileQuery,
  reconcileSiteForgeRows,
  validatedTerminalResponse,
};
