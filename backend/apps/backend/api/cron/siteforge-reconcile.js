"use strict";

const { requireCron } = require("../../lib/cron-auth");
const { buildPreviewForProspect } = require("../../lib/full-run");
const { methodGuard, sendJson } = require("../../lib/http");
const { prospectFromRow } = require("../../lib/prospects");
const {
  boundedBatch,
  createExistingJobDispatchReader,
  isValidatedTerminalDispatch,
  pendingReconcileQuery,
  reconcileSiteForgeRows,
} = require("../../lib/siteforge-reconcile");
const { conditionalUpdate, event, select, upsertRow } = require("../../lib/store");
const { AUTOSEND_KEY, deliverAutosend, isAutosendPending } = require("../../lib/autosend");

const SUPERVISED_HOLD_KEY = "supervised_10_review_pending";
const SUPERVISED_CLAIM_LEASE_MS = 30 * 60 * 1000;
const SUPERVISED_BUILD_CANDIDATES = Object.freeze([
  Object.freeze({
    prospectId: "place-chijb8urvvjamoarohonilfgjj8",
    claimId: "525841ae-31d5-4b94-915c-86e149d5b0fc",
  }),
  Object.freeze({
    prospectId: "place-chijuxnfocsajoarkn21wtucjze",
    claimId: "77580680-96b9-4698-9c8d-d1f835fcad7d",
  }),
  Object.freeze({
    prospectId: "place-chijdw0ccwyztoyrjfedkcc3sme",
    claimId: "99006ef4-2bbf-4a86-8e24-699f1fdf14b0",
  }),
  Object.freeze({
    prospectId: "place-chij-9-63r2etoyryf6ru93cn1s",
    claimId: "0156250a-d889-4ce7-a6d7-e9f88da8d60f",
  }),
  Object.freeze({
    prospectId: "wss-ab-detailing-dallas",
    claimId: "abf451bc-6a0f-441a-9132-ee86efea0167",
  }),
]);


// Deliver outreach for builds that have FINISHED since the run that started
// them. runFullSystem dispatches async builds and its send loop finds nothing
// ready, so without this step a full run mails nobody at any batch size. Rows
// carry an autosend intent (see lib/autosend.js); once the build is ready we
// send and settle the intent, which makes repeated cron passes idempotent.
async function deliverPendingAutosends({
  selectFn,
  upsertRowFn,
  conditionalUpdateFn,
  deliverFn,
  limit = 10,
} = {}) {
  const doSelect = selectFn || select;
  const doUpsert = upsertRowFn || upsertRow;
  const doConditionalUpdate = conditionalUpdateFn || conditionalUpdate;
  const doDeliver = deliverFn || deliverAutosend;

  let rows = [];
  try {
    const res = await doSelect("ghost_agency_prospects", "?select=*&status=eq.previewed&limit=100");
    rows = (res && (res.data || res.rows)) || [];
  } catch (_) {
    return { considered: 0, sent: 0, skipped: 0, results: [], blocked: "prospect_select_failed" };
  }

  // Only rows whose build actually landed (a preview URL exists) AND that still
  // have an unsettled intent.
  const ready = rows.filter((row) => row && row.preview_url && isAutosendPending(row)).slice(0, limit);
  const results = [];
  let sent = 0;
  let skipped = 0;

  for (const row of ready) {
    let out;
    try {
      out = await doDeliver(row, {});
    } catch (error) {
      out = { sent: false, skipped: "autosend_exception", intent: null };
    }
    if (out.intent) {
      const record = (row.record && typeof row.record === "object" && !Array.isArray(row.record)) ? row.record : {};
      const originalIntent = record[AUTOSEND_KEY];
      const sandboxSettlement = originalIntent?.sandbox_mode === true
        && originalIntent?.status === "pending";
      const updatedAt = String(row.updated_at || "").trim();
      const runId = String(originalIntent?.run_id || "").trim();
      const requestedAt = String(originalIntent?.requested_at || "").trim();
      const patch = {
        prospect_id: row.prospect_id,
        record: { ...record, [AUTOSEND_KEY]: out.intent },
        updated_at: new Date().toISOString(),
      };

      if (sandboxSettlement) {
        // This row may have been selected just before the authenticated owner
        // lane claimed and then cleared its autosend intent. Settle only the
        // exact pending intent/version we read; a CAS miss must never fall back
        // to a stale upsert that restores owner-proof state.
        if (updatedAt && runId && requestedAt) {
          await doConditionalUpdate(
            "ghost_agency_prospects",
            "prospect_id",
            row.prospect_id,
            {
              updated_at: `eq.${updatedAt}`,
              "record->autosend->>run_id": `eq.${runId}`,
              "record->autosend->>requested_at": `eq.${requestedAt}`,
              "record->autosend->>sandbox_mode": "eq.true",
              "record->autosend->>status": "eq.pending",
            },
            patch,
          ).catch(() => null);
        }
      } else {
        await doUpsert(
          "ghost_agency_prospects",
          patch,
          "prospect_id",
        ).catch(() => null);
      }
    }
    if (out.sent) sent += 1; else skipped += 1;
    results.push({ prospect_id: row.prospect_id, sent: Boolean(out.sent), reason: out.skipped || null });
  }
  return { considered: ready.length, sent, skipped, results };
}

function safeTransport(result = {}) {
  const value = result.skipped || result.status || result.mode || "unknown";
  return String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) || "unknown";
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function supervisedReleaseReady(row = {}) {
  const record = isObject(row.record) ? row.record : {};
  const dispatch = isObject(record.build_dispatch) ? record.build_dispatch : {};
  const callback = isObject(record.siteforge_callback) ? record.siteforge_callback : {};
  const recordStatus = {
    ready: record.siteforge_qc_passed === true,
    renderer: record.siteforge_renderer,
    generation_fingerprint: record.siteforge_generation_fingerprint,
    qc_passed: record.siteforge_qc_passed,
    visual_qc_passed: record.siteforge_visual_qc_passed,
    qc_contract: record.siteforge_qc_contract,
    release_evidence: record.release_evidence,
  };
  const final = [dispatch, callback, recordStatus].find((candidate) => (
    candidate.ready === true
    && candidate.renderer === "05-build-v8"
    && Boolean(candidate.generation_fingerprint)
    && candidate.qc_passed === true
    && candidate.visual_qc_passed === true
    && candidate.qc_contract === "public-surface-v2"
  )) || {};
  const evidence = isObject(final.release_evidence)
    ? final.release_evidence
    : isObject(record.release_evidence)
      ? record.release_evidence
      : {};
  return String(row.status || record.status || "") === "previewed"
    && Boolean(row.preview_url || record.preview_url)
    && Boolean(row.report_url || record.report_url)
    && final.ready === true
    && evidence.schema === "siteforge-release-evidence-v1"
    && evidence.map?.verified === true
    && evidence.identity?.verified === true
    && evidence.template_family?.verified === true;
}

function supervisedDispatch(row = {}) {
  const record = isObject(row.record) ? row.record : {};
  if (isObject(row.build_dispatch)) return row.build_dispatch;
  return isObject(record.build_dispatch) ? record.build_dispatch : {};
}

function terminalSiteForgeResult(dispatch = {}) {
  return isValidatedTerminalDispatch(dispatch);
}

function terminalReplacementProspect(prospect = {}) {
  const record = isObject(prospect.record) ? prospect.record : {};
  return {
    ...prospect,
    build_dispatch: null,
    blocked_reason: null,
    record: {
      ...record,
      build_dispatch: null,
      blocked_reason: null,
    },
  };
}

async function prepareSupervisedBuild(row = {}, statusReader) {
  const prospect = prospectFromRow(row);
  const resume = supervisedDispatch(row);
  if (terminalSiteForgeResult(resume)) {
    return {
      ok: true,
      mode: "terminal_replacement",
      prospect: terminalReplacementProspect(prospect),
    };
  }
  const statusUrl = String(resume.status_url || resume.statusUrl || "").trim();
  if (!statusUrl) return { ok: true, prospect, mode: "fresh_dispatch" };

  let current;
  try {
    current = await statusReader({ resume });
  } catch (_) {
    return { ok: false, skipped: "existing_job_status_unavailable" };
  }
  if (current?.pending === true || current?.buildStatus?.pending === true) {
    return { ok: false, skipped: "existing_job_pending" };
  }
  if (current?.buildStatus?.ready === true) {
    return {
      ok: true,
      prospect,
      mode: "recover_terminal_ready",
      dispatch: current,
    };
  }
  if (terminalSiteForgeResult(current)) {
    return {
      ok: true,
      mode: "terminal_replacement",
      prospect: terminalReplacementProspect(prospect),
    };
  }
  if (current?.error) return { ok: false, skipped: "existing_job_status_unavailable" };
  return { ok: false, skipped: "existing_job_terminal_unverified" };
}

function sanitizedSupervisedResult(result = {}, prospectId = "unknown") {
  return {
    prospect_id: String(result.prospect_id || prospectId).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120),
    ready: result.ok === true && result.status === "previewed",
    pending: result.pending === true,
    status: result.status === "previewed" ? "previewed" : "new",
    blocked: result.blocked
      ? String(result.blocked).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120)
      : null,
  };
}

async function activeSupervisedHold(selectFn) {
  const result = await selectFn(
    "ghost_agency_supervision_holds",
    `select=hold_key,status&hold_key=eq.${SUPERVISED_HOLD_KEY}&status=eq.active&limit=1`,
  );
  return Boolean(
    result?.ok
    && Array.isArray(result.data)
    && result.data.some((row) => row?.hold_key === SUPERVISED_HOLD_KEY && row?.status === "active"),
  );
}

async function supervisedClaimState(selectFn, candidate, nowMs = Date.now()) {
  let result;
  try {
    result = await selectFn(
      "ghost_agency_events",
      `select=id,type,payload,created_at&id=eq.${encodeURIComponent(candidate.claimId)}&limit=1`,
    );
  } catch (_) {
    return { ok: false, state: "unavailable" };
  }
  if (!result?.ok || !Array.isArray(result.data)) {
    return { ok: false, state: "unavailable" };
  }
  const claim = result.data.find((row) => row?.id === candidate.claimId);
  if (!claim) return { ok: true, state: "unused" };

  const payload = isObject(claim.payload) ? claim.payload : {};
  const createdAtMs = Date.parse(claim.created_at);
  if (
    claim.type !== "supervised.preview_build_claim"
    || payload.prospect_id !== candidate.prospectId
    || !Number.isFinite(createdAtMs)
  ) {
    return { ok: false, state: "invalid" };
  }
  const ageMs = Number(nowMs) - createdAtMs;
  return {
    ok: true,
    state: ageMs >= SUPERVISED_CLAIM_LEASE_MS ? "exhausted" : "active",
  };
}

async function nextSupervisedBuild({
  selectFn,
  insertRowFn,
  buildFn,
  statusReader,
  nowFn = Date.now,
}) {
  let holdActive = false;
  try {
    holdActive = await activeSupervisedHold(selectFn);
  } catch (_) {
    holdActive = false;
  }
  if (!holdActive) return { started: false, skipped: "supervised_hold_inactive" };

  for (const candidate of SUPERVISED_BUILD_CANDIDATES) {
    let result;
    try {
      result = await selectFn(
        "ghost_agency_prospects",
        `select=*&prospect_id=eq.${encodeURIComponent(candidate.prospectId)}&limit=1`,
      );
    } catch (_) {
      return { started: false, skipped: "candidate_select_failed" };
    }
    if (!result?.ok) return { started: false, skipped: "candidate_select_failed" };
    const row = Array.isArray(result.data) ? result.data[0] : null;
    if (!row || supervisedReleaseReady(row)) continue;

    const claimState = await supervisedClaimState(selectFn, candidate, nowFn());
    if (!claimState.ok) return { started: false, skipped: "claim_read_failed" };
    if (claimState.state === "active") {
      return { started: false, skipped: "candidate_claim_in_progress" };
    }

    const prepared = await prepareSupervisedBuild(row, statusReader);
    if (!prepared.ok) return { started: false, skipped: prepared.skipped };
    if (claimState.state === "exhausted") {
      if (prepared.mode === "terminal_replacement") continue;
      if (prepared.mode !== "recover_terminal_ready") {
        return { started: false, skipped: "candidate_claim_exhausted_unverified" };
      }
    }

    let claim;
    if (claimState.state !== "exhausted") {
      try {
        claim = await insertRowFn("ghost_agency_events", {
          id: candidate.claimId,
          type: "supervised.preview_build_claim",
          payload: {
            actor: "agent_00_orchestrator",
            status: "claimed",
            hold_key: SUPERVISED_HOLD_KEY,
            prospect_id: candidate.prospectId,
            attempt_limit: 1,
          },
          created_at: new Date(nowFn()).toISOString(),
        });
      } catch (_) {
        return { started: false, skipped: "claim_write_failed" };
      }
      if (claim?.mode !== "live_write") {
        return {
          started: false,
          skipped: Number(claim?.status) === 409
            ? "candidate_already_claimed"
            : "claim_write_failed",
        };
      }
    }

    try {
      const built = await buildFn(prepared.prospect, {
        source: "supervised_ten_build",
        jobId: `siteforge_supervised_${candidate.claimId}`,
        ...(prepared.dispatch
          ? { dispatchSiteForgePreview: async () => prepared.dispatch }
          : {}),
      });
      return {
        started: true,
        result: sanitizedSupervisedResult(built, candidate.prospectId),
      };
    } catch (_) {
      return {
        started: true,
        result: {
          prospect_id: candidate.prospectId,
          ready: false,
          pending: false,
          status: "new",
          blocked: "supervised_build_failed",
        },
      };
    }
  }

  return { started: false, skipped: "no_unclaimed_candidate" };
}

function createSiteForgeReconcileHandler(dependencies = {}) {
  const requireCronFn = dependencies.requireCron || requireCron;
  const selectFn = dependencies.select || select;
  const eventFn = dependencies.event || event;
  const buildFn = dependencies.buildPreviewForProspect || buildPreviewForProspect;
  const statusReader = dependencies.dispatchSiteForgePreview
    || createExistingJobDispatchReader({
      fetchImpl: dependencies.fetchImpl || globalThis.fetch,
      tokenProvider: dependencies.tokenProvider,
    });

  return async function siteForgeReconcileHandler(req, res) {
    if (!methodGuard(req, res, ["GET", "POST"])) return;
    if (!requireCronFn(req, res)) return;

    const batch = boundedBatch(process.env.GHOST_AGENCY_SITEFORGE_RECONCILE_BATCH);
    let rowsResult;
    try {
      rowsResult = await selectFn(
        "ghost_agency_prospects",
        pendingReconcileQuery(batch),
      );
    } catch (_) {
      rowsResult = { ok: false, mode: "select_exception", data: [] };
    }

    if (!rowsResult.ok) {
      const transport = safeTransport(rowsResult);
      await eventFn({
        type: "cron.run",
        actor: "agent_00_orchestrator",
        status: "failed",
        payload: {
          job: "siteforge-reconcile",
          blocked: "ghost_agency_prospects_unavailable",
          transport,
        },
      }).catch(() => null);
      sendJson(res, 200, {
        ok: false,
        job: "siteforge-reconcile",
        mode: "schema_blocked",
        transport,
      });
      return;
    }

    const summary = await reconcileSiteForgeRows(rowsResult.data, {
      batch,
      buildPreviewForProspect: buildFn,
      dispatchSiteForgePreview: statusReader,
    });
    // Mirror Engine is the only producer for fresh builds.  This cron remains
    // solely as a bounded reader/drain for SiteForge jobs that were durably
    // pending before the cutover.  The former supervised lane created a new
    // SiteForge job after the legacy drain completed; keeping that call would
    // silently reopen the retired producer.
    const supervised = {
      started: false,
      skipped: "fresh_siteforge_builds_disabled_mirror_engine_only",
    };

    // Builds that finished since their run started now get their email.
    const autosend = await deliverPendingAutosends({ selectFn }).catch(() => ({ considered: 0, sent: 0, skipped: 0, results: [] }));

    await eventFn({
      type: "cron.run",
      actor: "agent_00_orchestrator",
      status: "ok",
      payload: {
        job: "siteforge-reconcile",
        batch,
        selected: summary.selected,
        eligible: summary.eligible,
        processed: summary.processed,
        skipped: summary.skipped,
        ready: summary.ready,
        pending: summary.pending,
        blocked: summary.blocked,
        supervised_started: supervised.started,
        supervised_skipped: supervised.skipped || null,
        supervised_result: supervised.result || null,
        autosend_considered: autosend.considered,
        autosend_sent: autosend.sent,
        autosend_skipped: autosend.skipped,
      },
    }).catch(() => null);

    sendJson(res, 200, {
      ok: true,
      job: "siteforge-reconcile",
      ...summary,
      supervised,
      autosend,
    });
  };
}

module.exports = createSiteForgeReconcileHandler();
module.exports.createSiteForgeReconcileHandler = createSiteForgeReconcileHandler;
module.exports.nextSupervisedBuild = nextSupervisedBuild;
module.exports.deliverPendingAutosends = deliverPendingAutosends;
module.exports.prepareSupervisedBuild = prepareSupervisedBuild;
module.exports.supervisedClaimState = supervisedClaimState;
module.exports.supervisedReleaseReady = supervisedReleaseReady;
