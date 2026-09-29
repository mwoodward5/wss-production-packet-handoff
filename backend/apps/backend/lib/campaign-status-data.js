"use strict";

// Read-only data source for the standalone campaign status page
// (/campaign-status). This is a DIFFERENT surface from the console/gallery
// timing work: it reads the durable Line batch tables, projects only small
// scalars, and mutates nothing — status polling must never wake a batch.
//
// Data shape (all of it already public through /api/admin/line safeBatch):
//   · the newest non-halted batch: batchId, status, lane, target, requested
//   · row counts as the five operator buckets (see campaignCounts)
//   · the campaign stopwatch record from the mine_funnel
//     (line_campaign_timing_v1, PR #628) as ISO stamps + T+mm:ss deltas
//   · the prospect-bank draw stage (bank_draw, PR #629): drawn vs mined
//   · every mine_funnel stage's one-time elapsedMs (ms since campaign start)

const { requireAdmin } = require("./admin-auth");
const { handleError, methodGuard, sendJson } = require("./http");
const persistence = require("./line-persistence");
const { ROW_FAILED } = require("./line-state");

// Stage names, pinned to their writers (lib/line-continuation.js,
// lib/line-quota.js, lib/prospect-bank.js). Read as literals here so this
// compact page never pulls the whole continuation graph into a cold start;
// test/campaign-status.test.js cross-checks them against the real constants.
const CAMPAIGN_TIMING_STAGE = "line_campaign_timing_v1";
const BANK_DRAW_STAGE = "bank_draw";
const QUOTA_SOURCE_PREFIX = "quota_source_";

// The batch statuses that are NOT a deliberate park (lib/line-persistence
// BATCH_STATUSES minus "halted"). The current campaign is the newest of these.
const ACTIVE_BATCH_STATUSES = Object.freeze([
  "building",
  "running",
  "awaiting_approval",
  "approved",
  "sending",
  "done",
]);

// Row buckets for the status strip. The durable ladder is
// picked -> qualified -> mirrored -> gate_passed -> ready -> queued -> sent
// (plus terminal rejected/gate_failed/error). The operator question is "where
// are my sites right now", so the five buckets are disjoint and sum to total:
// working = still in the build pipeline (pre-gate), gatePassed = the render
// gate is proven and the email has NOT gone (gate_passed|ready|queued).
const WORKING_ROW_STATUSES = new Set(["picked", "qualified", "mirrored"]);
const GATE_PASSED_ROW_STATUSES = new Set(["gate_passed", "ready", "queued"]);

const TIMING_FIELDS = Object.freeze([
  ["firstQualifiedAt", "firstQualified"],
  ["firstBuiltAt", "firstBuilt"],
  ["firstGateAt", "firstGate"],
  ["firstSentAt", "firstSent"],
]);

function text(value) {
  return String(value == null ? "" : value).trim();
}

function parsedTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Milliseconds → "T+mm:ss". Minutes are zero-padded and intentionally not
 * capped (a 90-minute first-send reads T+90:00, matching the stopwatch law:
 * the operator bar is 10 sites in 15-25 minutes, so h:mm:ss never comes up).
 * Truncated, never rounded — a displayed delta can never run ahead of truth.
 */
function formatTPlus(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `T+${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** ms delta from `from` to `to` (ISO strings), or null when either is missing. */
function deltaMs(from, to) {
  const fromMs = parsedTime(from);
  const toMs = parsedTime(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.max(0, toMs - fromMs);
}

function funnelRows(mineFunnel) {
  return Array.isArray(mineFunnel)
    ? mineFunnel.filter((row) => row && typeof row === "object" && !Array.isArray(row))
    : [];
}

// The campaign stopwatch record (stage line_campaign_timing_v1) — same lookup
// as campaignTimingFrom() in lib/line-continuation.js, read locally so the
// route does not cold-start the entire continuation graph.
function campaignTimingFrom(mineFunnel) {
  return funnelRows(mineFunnel).find((row) => String(row.stage || "") === CAMPAIGN_TIMING_STAGE) || null;
}

function campaignCounts(rows = []) {
  const counts = { total: rows.length, working: 0, gatePassed: 0, sent: 0, failed: 0 };
  for (const row of rows) {
    const status = String((row && row.status) || "");
    if (status === "sent") counts.sent += 1;
    else if (ROW_FAILED.includes(status)) counts.failed += 1;
    else if (GATE_PASSED_ROW_STATUSES.has(status)) counts.gatePassed += 1;
    else if (WORKING_ROW_STATUSES.has(status)) counts.working += 1;
  }
  return counts;
}

// The stopwatch strip: raw ISO stamps plus server-computed T+mm:ss deltas so
// the browser never does wall-clock math of its own.
function timingStrip(mineFunnel, startedAtFallback = "") {
  const record = campaignTimingFrom(mineFunnel);
  if (!record) return null;
  const startedAt = text(record.startedAt) || text(startedAtFallback);
  const timing = { startedAt: startedAt || null };
  const deltas = {};
  for (const [field, label] of TIMING_FIELDS) {
    const at = text(record[field]);
    timing[field] = at || null;
    const ms = at ? deltaMs(startedAt, at) : null;
    if (ms !== null) {
      deltas[label] = { ms, label: formatTPlus(ms) };
    }
  }
  timing.deltas = deltas;
  return timing;
}

// Per-stage funnel projection: only small scalars ever leave the store. The
// timing record itself is rendered as the strip above, not as a funnel row.
function funnelStages(mineFunnel) {
  return funnelRows(mineFunnel)
    .filter((row) => String(row.stage || "") !== CAMPAIGN_TIMING_STAGE)
    .map((row) => {
      const elapsedMs = Number(row.elapsedMs);
      const stage = {
        stage: text(row.stage),
        entered: Number.isFinite(Number(row.entered)) ? Math.max(0, Number(row.entered)) : null,
        survived: Number.isFinite(Number(row.survived)) ? Math.max(0, Number(row.survived)) : null,
        mode: text(row.mode) || null,
        sourceTarget: text(row.source_target) || null,
      };
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
        stage.elapsedMs = Math.floor(elapsedMs);
        stage.elapsed = formatTPlus(elapsedMs);
      }
      return stage;
    });
}

// PROSPECT BANK (bank-first draw): drawn = bank_draw stage survived, mined =
// the sum of every quota_source_* stage survived. The stage is a snapshot of
// the single draw attempt this campaign made, so first row wins.
function bankDrawSummary(stages = []) {
  const stage = stages.find((row) => row.stage === BANK_DRAW_STAGE) || null;
  if (!stage) return null;
  return {
    drawn: stage.survived ?? 0,
    requested: stage.entered ?? null,
    elapsed: stage.elapsed || "",
    stage,
  };
}

function minedCount(stages = []) {
  return stages
    .filter((row) => String(row.stage || "").startsWith(QUOTA_SOURCE_PREFIX))
    .reduce((sum, row) => sum + (row.survived ?? 0), 0);
}

function campaignSnapshot(batch) {
  if (!batch) return null;
  const stages = funnelStages(batch.mineFunnel);
  const bank = bankDrawSummary(stages);
  return {
    batchId: text(batch.batchId),
    status: text(batch.status) || "unknown",
    lane: text(batch.lane) || null,
    target: text(batch.target) || null,
    requested: Number(batch.requested) || 0,
    haltReason: text(batch.haltReason) || null,
    startedAt: text(batch.startedAt) || text(batch.createdAt) || null,
    updatedAt: text(batch.updatedAt) || null,
    counts: campaignCounts(batch.rows || []),
    campaignTiming: timingStrip(batch.mineFunnel, text(batch.startedAt) || text(batch.createdAt)),
    bankDraw: bank,
    mined: minedCount(stages),
    funnel: stages,
  };
}

/**
 * The newest non-halted durable batch. A halted batch is a deliberate park
 * (superseded or cleared as stuck) — showing one as "current" would be a lie.
 */
async function currentCampaign(listBatches, { scan = 10 } = {}) {
  let result = null;
  try {
    result = await listBatches({ statuses: [...ACTIVE_BATCH_STATUSES], limit: scan, includeRows: true });
  } catch {
    // A transport throw and a failed read are the same operator answer.
    result = null;
  }
  if (!result?.ok || !Array.isArray(result.batches)) {
    const error = new Error("Campaign status source is temporarily unavailable.");
    error.statusCode = 503;
    error.code = "campaign_status_unavailable";
    throw error;
  }
  return result.batches.find((batch) => batch && text(batch.batchId)) || null;
}

function createCampaignStatusDataHandler(overrides = {}) {
  const listBatches = overrides.listBatches || persistence.listBatches;

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["GET"])) return;
    if (!requireAdmin(req, res)) return;
    try {
      const batch = await currentCampaign(listBatches);
      sendJson(res, 200, {
        ok: true,
        serverTime: new Date().toISOString(),
        campaign: campaignSnapshot(batch),
      });
    } catch (error) {
      handleError(res, error);
    }
  };
}

module.exports = {
  ACTIVE_BATCH_STATUSES,
  BANK_DRAW_STAGE,
  CAMPAIGN_TIMING_STAGE,
  QUOTA_SOURCE_PREFIX,
  campaignCounts,
  campaignSnapshot,
  campaignTimingFrom,
  createCampaignStatusDataHandler,
  currentCampaign,
  deltaMs,
  bankDrawSummary,
  formatTPlus,
  funnelStages,
  minedCount,
  timingStrip,
};
