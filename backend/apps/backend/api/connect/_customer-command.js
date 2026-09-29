"use strict";

const { mirrorHostSlug, siteUrlFromRow } = require("../../lib/customer-site");
const { cleanText, loadTenantCalls } = require("./_customer-calls");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
const EDIT_LIMIT = 51;

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function plainObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readRows(result, source) {
  if (Array.isArray(result)) return result;
  if (!result || result.ok === false || (result.mode && result.mode !== "live_select")) {
    throw fail(503, "customer_source_unavailable", `${source} is unavailable`);
  }
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.rows)) return result.rows;
  throw fail(503, "customer_source_unavailable", `${source} is unavailable`);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function canonicalSlug(row) {
  return mirrorHostSlug(siteUrlFromRow(row));
}

async function findCanonicalProspect({ siteSlug, select }) {
  const response = await select(
    "ghost_agency_prospects",
    `select=prospect_id,preview_url,record&preview_url=ilike.*${encodeURIComponent(siteSlug)}*&limit=26`,
  );
  const rows = readRows(response, "site status");
  if (rows.length >= 26) throw fail(503, "customer_source_incomplete", "site status was incomplete");
  const exact = rows.filter((row) => canonicalSlug(row) === siteSlug);
  return exact.length === 1 ? exact[0] : null;
}

function siteReadiness(surface, row) {
  if (!surface?.site?.available || !row) return { state: "unknown", label: "Site status unavailable" };
  const record = plainObject(row.record) || {};
  const dispatch = plainObject(record.build_dispatch) || {};
  const callback = plainObject(record.siteforge_callback) || {};
  const ready = firstDefined(dispatch.ready, callback.ready, record.siteforge_ready);
  const qcPassed = firstDefined(dispatch.qc_passed, callback.qc_passed, record.siteforge_qc_passed);
  const visualPassed = firstDefined(dispatch.visual_qc_passed, callback.visual_qc_passed, record.siteforge_visual_qc_passed);
  if (ready === true && qcPassed === true && visualPassed === true) {
    return { state: "ready", label: "Site is ready" };
  }
  const status = String(firstDefined(dispatch.status, callback.status, record.siteforge_status, "")).trim().toLowerCase();
  if (["new", "queued", "running", "building", "pending"].includes(status) || ready === false) {
    return { state: "pending", label: "Site update in progress" };
  }
  return { state: "connected", label: "Site is connected" };
}

function editSummary(row) {
  const result = plainObject(row && row.result) || {};
  return cleanText(result.summary, 240) || "Editor made an edit.";
}

function editTime(row) {
  const time = Date.parse(row && (row.updated_at || row.created_at) || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

async function loadDoneEdits({ siteSlug, select }) {
  const response = await select(
    "ghost_agency_edit_jobs",
    `select=site_slug,status,result,created_at,updated_at&site_slug=eq.${encodeURIComponent(siteSlug)}&status=eq.done&order=updated_at.desc&limit=${EDIT_LIMIT}`,
  );
  const rows = readRows(response, "edit history");
  if (rows.length >= EDIT_LIMIT) throw fail(503, "customer_source_incomplete", "edit history was incomplete");
  return rows
    .filter((row) => String(row && row.site_slug || "").trim().toLowerCase() === siteSlug)
    .filter((row) => String(row && row.status || "").trim().toLowerCase() === "done")
    .map((row) => ({ row, at: editTime(row) }))
    .filter((entry) => entry.at)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function reportAction(report) {
  if (!report?.available || !report.url || !Array.isArray(report.weakest) || !report.weakest.length) return null;
  const weakest = report.weakest.find((entry) => Number.isFinite(Number(entry && entry.score)) && cleanText(entry && entry.label, 100));
  if (!weakest) return null;
  const label = cleanText(weakest.label, 100);
  return {
    label: `Improve ${label}`,
    detail: `${label} is the lowest-scoring area at ${Math.round(Number(weakest.score))}.`,
    href: report.url,
  };
}

function reportSourceComplete(report) {
  const reason = String(report && report.reason || "");
  return !["lookup_failed", "report_unreadable", "report_fetch_failed", "report_timeout"].includes(reason);
}

function emptyOverview(reason = "no_site_bound_to_this_login") {
  return {
    siteStatus: { state: "unknown", label: "Site status unavailable" },
    calls: {
      complete: false,
      rangeDays: 14,
      answerCoverage: "unavailable",
      coverageLabel: "Only calls safely matched to this account are shown.",
      emptyLabel: "No calls can be safely matched to this account yet.",
      items: [],
      reason,
    },
    lastEdit: null,
    editActivity: [],
    reportAction: null,
    sources: { site: false, report: false, edits: false, calls: false, photoSlots: false },
  };
}

async function loadCustomerOverview({ siteSlug, surface, select, now = Date.now() }) {
  const slug = String(siteSlug || "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return emptyOverview();

  const [prospectRead, editsRead, callsRead] = await Promise.allSettled([
    findCanonicalProspect({ siteSlug: slug, select }),
    loadDoneEdits({ siteSlug: slug, select }),
    loadTenantCalls({ siteSlug: slug, select, now }),
  ]);
  const prospectOk = prospectRead.status === "fulfilled";
  const editsOk = editsRead.status === "fulfilled";
  const callsOk = callsRead.status === "fulfilled";
  const prospect = prospectOk ? prospectRead.value : null;
  const edits = editsOk ? editsRead.value : [];
  const calls = callsOk ? callsRead.value : {
    complete: false,
    rangeDays: 14,
    answerCoverage: "unavailable",
    coverageLabel: "Only calls safely matched to this account are shown.",
    emptyLabel: "No calls can be safely matched to this account yet.",
    items: [],
    reason: "call_history_unavailable",
  };
  const activity = edits.slice(0, 8).map((entry) => ({ at: entry.at, summary: editSummary(entry.row) }));
  const reportComplete = reportSourceComplete(surface && surface.report);
  return {
    siteStatus: prospectOk
      ? siteReadiness(surface, prospect)
      : { state: "unknown", label: "Site status unavailable", reason: "site_status_unavailable" },
    calls,
    lastEdit: activity[0] || null,
    editActivity: activity,
    reportAction: reportComplete ? reportAction(surface && surface.report) : null,
    sources: {
      site: prospectOk,
      report: reportComplete,
      edits: editsOk,
      calls: callsOk,
      // There is no durable empty-slot field. Never turn a supplied-photo
      // count into a made-up request for more photos.
      photoSlots: false,
    },
    sourceReasons: {
      ...(prospectOk ? {} : { site: "site_status_unavailable" }),
      ...(reportComplete ? {} : { report: "report_unavailable" }),
      ...(editsOk ? {} : { edits: "edit_history_unavailable" }),
      ...(callsOk ? {} : { calls: "call_history_unavailable" }),
      photoSlots: "empty_slot_data_not_stored",
    },
  };
}

module.exports = {
  editSummary,
  emptyOverview,
  findCanonicalProspect,
  loadCustomerOverview,
  loadDoneEdits,
  reportAction,
  siteReadiness,
};
