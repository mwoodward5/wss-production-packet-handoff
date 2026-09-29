"use strict";

const { createHash } = require("node:crypto");
const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const {
  MORNING_REPORT_EVENT,
  generateMorningReport,
  sendMorningReport,
} = require("../../lib/morning-report");
const { conditionalUpdate, insertRow, select } = require("../../lib/store");

const JOB = "morning-report";
const MARKER_TYPE = MORNING_REPORT_EVENT;
const UUID_DNS_NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");

function utcDay(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError("morning_report_invalid_time");
  return parsed.toISOString().slice(0, 10);
}

function markerId(day) {
  const bytes = createHash("sha1")
    .update(UUID_DNS_NAMESPACE)
    .update(`wss:${MARKER_TYPE}:${day}`, "utf8")
    .digest()
    .subarray(0, 16);
  // A deterministic RFC 4122 UUID keeps the events.id primary key as the
  // concurrency lock without needing a new table or schema migration.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function markerSvixId(day) {
  return `${MARKER_TYPE}:${day}`;
}

function isLiveWrite(result) {
  return result?.mode === "live_write";
}

function isUniqueConflict(result) {
  return result?.mode === "live_write_failed"
    && (Number(result.status) === 409 || String(result.error?.code || "") === "23505");
}

function storageDetail(result) {
  return {
    mode: String(result?.mode || "unavailable"),
    status: Number(result?.status) || 0,
  };
}

function jsonSnapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowDate(nowFn) {
  const value = typeof nowFn === "function" ? nowFn() : Date.now();
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError("morning_report_invalid_time");
  return parsed;
}

async function currentMarker(selectFn, id) {
  const result = await selectFn(
    "ghost_agency_events",
    `?select=id,type,payload,created_at&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  if (result?.ok !== true || !Array.isArray(result.data)) {
    return { ok: false, result };
  }
  const row = result.data[0] || null;
  if (!row) return { ok: true, exists: false };
  if (row.id !== id || row.type !== MARKER_TYPE) {
    return { ok: false, collision: true, result };
  }
  return { ok: true, exists: true, row };
}

function createMorningReportCronHandler(dependencies = {}) {
  const requireCronFn = dependencies.requireCron || requireCron;
  const methodGuardFn = dependencies.methodGuard || methodGuard;
  const sendJsonFn = dependencies.sendJson || sendJson;
  const selectFn = dependencies.select || select;
  const insertRowFn = dependencies.insertRow || insertRow;
  const conditionalUpdateFn = dependencies.conditionalUpdate || conditionalUpdate;
  const generateMorningReportFn = dependencies.generateMorningReport || generateMorningReport;
  const sendMorningReportFn = dependencies.sendMorningReport || sendMorningReport;
  const nowFn = dependencies.now || Date.now;

  return async function morningReportCronHandler(req, res) {
    if (!methodGuardFn(req, res, ["GET", "POST"])) return;
    if (!requireCronFn(req, res)) return;

    let now;
    try {
      now = nowDate(nowFn);
    } catch (_) {
      sendJsonFn(res, 500, { ok: false, job: JOB, error: "invalid_clock" });
      return;
    }
    const nowIso = now.toISOString();
    const day = utcDay(now);
    const id = markerId(day);

    let existing;
    try {
      existing = await currentMarker(selectFn, id);
    } catch (_) {
      existing = { ok: false, result: { mode: "select_exception" } };
    }
    if (!existing.ok) {
      sendJsonFn(res, 503, {
        ok: false,
        job: JOB,
        day,
        error: existing.collision ? "morning_report_marker_collision" : "morning_report_marker_read_failed",
        storage: storageDetail(existing.result),
      });
      return;
    }
    if (existing.exists) {
      sendJsonFn(res, 200, { ok: true, job: JOB, day, alreadyRan: true, sent: false });
      return;
    }

    let report;
    try {
      // Pin the generator's half-open window to the same clock used by the
      // current-day marker. This also forces a fresh cron snapshot rather than
      // letting a same-day panel read affect the scheduled digest.
      report = await generateMorningReportFn({ until: nowIso, preferStored: false }, dependencies);
    } catch (_) {
      sendJsonFn(res, 503, {
        ok: false,
        job: JOB,
        day,
        error: "morning_report_generation_failed",
        sent: false,
      });
      return;
    }
    if (!report || report.ok !== true) {
      sendJsonFn(res, 503, {
        ok: false,
        job: JOB,
        day,
        error: "morning_report_incomplete",
        sent: false,
      });
      return;
    }

    let snapshot;
    try {
      snapshot = jsonSnapshot(report);
    } catch (_) {
      sendJsonFn(res, 500, {
        ok: false,
        job: JOB,
        day,
        error: "morning_report_snapshot_failed",
        sent: false,
      });
      return;
    }
    const payload = {
      date: day,
      day,
      window: snapshot?.window || null,
      report: snapshot,
      state: "claimed",
      status: "claimed",
      claimedAt: nowIso,
    };

    let claim;
    try {
      claim = await insertRowFn("ghost_agency_events", {
        id,
        type: MARKER_TYPE,
        svix_id: markerSvixId(day),
        payload,
        created_at: nowIso,
      });
    } catch (_) {
      claim = { mode: "write_exception" };
    }
    if (isUniqueConflict(claim)) {
      sendJsonFn(res, 200, { ok: true, job: JOB, day, alreadyRan: true, sent: false });
      return;
    }
    if (!isLiveWrite(claim)) {
      sendJsonFn(res, 503, {
        ok: false,
        job: JOB,
        day,
        error: "morning_report_claim_failed",
        storage: storageDetail(claim),
        sent: false,
      });
      return;
    }

    let delivery;
    let sendError = null;
    try {
      delivery = await sendMorningReportFn(report, dependencies);
    } catch (error) {
      sendError = error;
      delivery = error?.result || null;
    }
    const sent = !sendError && delivery?.mode === "sent";
    let completedAt = nowIso;
    try {
      completedAt = nowDate(nowFn).toISOString();
    } catch (_) {
      // The durable claim clock remains the honest fallback.
    }
    const finalPayload = {
      ...payload,
      state: sent ? "sent" : "send_failed",
      status: sent ? "sent" : "failed",
      completedAt,
      delivery: {
        mode: String(delivery?.mode || (sendError ? "send_failed" : "unknown")),
        status: Number(delivery?.status) || 0,
        id: delivery?.id ? String(delivery.id) : null,
      },
    };
    // The primary-key claim already owns idempotency. This best-effort state
    // update may fail, but that can never reopen the send path for this day.
    try {
      await conditionalUpdateFn(
        "ghost_agency_events",
        "id",
        id,
        { type: `eq.${MARKER_TYPE}`, "payload->>state": "eq.claimed" },
        { payload: finalPayload },
      );
    } catch (_) {
      // Keep the durable claimed marker. A same-day rerun remains blocked.
    }

    if (!sent) {
      sendJsonFn(res, 502, {
        ok: false,
        job: JOB,
        day,
        error: "morning_report_send_failed",
        sent: false,
        retrySuppressedForDay: day,
      });
      return;
    }

    sendJsonFn(res, 200, {
      ok: true,
      job: JOB,
      day,
      alreadyRan: false,
      sent: true,
      report,
    });
  };
}

const handler = createMorningReportCronHandler();

module.exports = handler;
module.exports.MARKER_TYPE = MARKER_TYPE;
module.exports.createMorningReportCronHandler = createMorningReportCronHandler;
module.exports.isUniqueConflict = isUniqueConflict;
module.exports.markerId = markerId;
module.exports.markerSvixId = markerSvixId;
module.exports.utcDay = utcDay;
