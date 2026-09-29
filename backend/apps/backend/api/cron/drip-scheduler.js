"use strict";

const { randomUUID } = require("node:crypto");
const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const { reviewHoldActive, sendSequenceStep } = require("../../lib/email");
const { prospectFromRow } = require("../../lib/prospects");
const { event, select } = require("../../lib/store");
const { deliveryPauseStatus } = require("../../lib/delivery-pause");

const DAY = 86400e3;
const CADENCE = { 2: 5 * DAY, 3: 14 * DAY };

function isOwnerProofLog(row = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const lane = String(
    payload.deliveryLane || payload.delivery_lane || row.deliveryLane || row.delivery_lane || "",
  ).toLowerCase();
  return row.ownerProof === true
    || row.owner_proof === true
    || row.sandbox === true
    || payload.ownerProof === true
    || payload.owner_proof === true
    || payload.sandbox === true
    || payload.isProspectSend === false
    || ["owner_only_proof", "owner-only", "owner_proof", "sandbox"].includes(lane);
}

function nextStep(logRows) {
  // Owner-proof/sandbox rows deliberately retain an audit record, but they
  // cannot consume a real prospect sequence step or suppress the prospect.
  const prospectLogs = logRows.filter((row) => !isOwnerProofLog(row));
  const sent = prospectLogs.filter((row) => row.sequence === 1 && !row.suppressed).map((row) => row.step);
  if (prospectLogs.some((row) => row.suppressed)) return { step: null, reason: "suppressed" };
  if (!sent.includes(1)) return { step: 1, dueAt: 0 };

  const first = prospectLogs.find((row) => row.sequence === 1 && row.step === 1);
  const step1At = first?.sent_at ? new Date(first.sent_at).getTime() : Date.now();
  for (const step of [2, 3]) {
    if (!sent.includes(step)) return { step, dueAt: step1At + CADENCE[step] };
  }
  return { step: null, reason: "sequence_complete" };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireCron(req, res)) return;

  const parsedCap = Number.parseInt(process.env.GHOST_AGENCY_DRIP_BATCH ?? "20", 10);
  const cap = Math.min(Math.max(Number.isFinite(parsedCap) ? parsedCap : 20, 0), 100);
  const runId = `drip_${randomUUID()}`;
  const deliveryPause = await deliveryPauseStatus();
  if (reviewHoldActive() || deliveryPause.active || cap === 0) {
    const blocked = reviewHoldActive()
      ? "outreach_review_hold"
      : deliveryPause.active
        ? "outreach_delivery_paused"
        : "drip_batch_zero";
    await event({
      type: "cron.run",
      actor: "agent_13_email_sequencer",
      status: "paused",
      payload: { job: "drip-scheduler", blocked, deliveryPause },
    });
    sendJson(res, 200, {
      ok: true,
      mode: blocked,
      job: "drip-scheduler",
      evaluated: 0,
      sent: 0,
      reason: reviewHoldActive()
        ? "GHOST_AGENCY_REVIEW_HOLD is active"
        : deliveryPause.active
          ? `Delivery safety pause is active: ${deliveryPause.reason || "threshold crossed"}`
          : "GHOST_AGENCY_DRIP_BATCH is 0",
    });
    return;
  }
  const logProbe = await select("ghost_agency_email_log", "?select=sequence&limit=1");
  if (!logProbe.ok) {
    await event({
      type: "cron.run",
      actor: "agent_13_email_sequencer",
      status: "failed",
      payload: {
        job: "drip-scheduler",
        blocked: "ghost_agency_email_log_unavailable",
        transport: logProbe.skipped || logProbe.status || logProbe.mode,
      },
    });
    sendJson(res, 200, {
      ok: false,
      mode: "schema_blocked",
      job: "drip-scheduler",
      blocker:
        "ghost_agency_email_log is required before hourly drip sends can run without duplicate-send risk.",
      transport: logProbe.skipped || logProbe.status || logProbe.mode,
    });
    return;
  }

  const rowsResult = await select(
    "ghost_agency_prospects",
    `?select=*&status=in.(reported,packeted,previewed)&limit=${cap}`,
  );
  if (!rowsResult.ok) {
    sendJson(res, 200, {
      ok: false,
      mode: "schema_blocked",
      job: "drip-scheduler",
      blocker: "ghost_agency_prospects table/query is not available.",
      transport: rowsResult.skipped || rowsResult.status || rowsResult.mode,
    });
    return;
  }

  // Preflight every candidate's durable sequence history before the first
  // send. A later lookup failure must not leave an earlier prospect contacted
  // from a batch whose dedup state could not be fully verified.
  const prepared = [];
  for (const row of rowsResult.data || []) {
    const prospect = prospectFromRow(row);
    if (!prospect?.email && !prospect?.ownerEmail) {
      prepared.push({ prospect: null, prospectId: row.prospect_id || null, skipped: "no_email" });
      continue;
    }

    const prospectId = prospect.prospect_id || prospect.id;
    const log = await select(
      "ghost_agency_email_log",
      `?select=sequence,step,sent_at,suppressed,payload&prospect_id=eq.${encodeURIComponent(prospectId)}&order=sent_at.asc&limit=20`,
    );
    if (!log.ok || !Array.isArray(log.data)) {
      const transport = log.skipped || log.status || log.mode || "unavailable";
      await event({
        type: "cron.run",
        actor: "agent_13_email_sequencer",
        status: "failed",
        payload: {
          job: "drip-scheduler",
          runId,
          blocked: "ghost_agency_email_log_unavailable",
          prospectId,
          transport,
          sent: 0,
        },
      });
      sendJson(res, 200, {
        ok: false,
        mode: "dedup_blocked",
        job: "drip-scheduler",
        blocker: "ghost_agency_email_log_unavailable",
        message: "Email history could not be verified. The drip batch was stopped before any email was sent.",
        prospect_id: prospectId,
        transport,
        evaluated: 0,
        sent: 0,
      });
      return;
    }
    prepared.push({ prospect, prospectId, logRows: log.data });
  }

  const now = Date.now();
  const out = [];
  for (const preparedRow of prepared) {
    const { prospect, prospectId } = preparedRow;
    if (preparedRow.skipped) {
      out.push({ prospect_id: prospectId, skipped: preparedRow.skipped });
      continue;
    }
    const plan = nextStep(preparedRow.logRows);
    if (!plan.step) {
      out.push({ prospect_id: prospectId, skipped: plan.reason });
      continue;
    }
    if (plan.dueAt > now) {
      out.push({
        prospect_id: prospectId,
        waiting_until: new Date(plan.dueAt).toISOString(),
        step: plan.step,
      });
      continue;
    }

    const sent = await sendSequenceStep({
      prospect,
      sequence: 1,
      step: plan.step,
      vars: {
        keyword_1: `${(prospect.primary_services || prospect.services || [])[0] || ""} ${prospect.city || ""}`.trim(),
        run_id: runId,
      },
    });
    out.push({
      prospect_id: prospectId,
      step: plan.step,
      sent: sent.ok,
      mode: sent.mode,
      blocked: sent.blocked,
      error: sent.error,
    });
  }

  await event({
    type: "cron.run",
    actor: "agent_13_email_sequencer",
    status: "ok",
    payload: { job: "drip-scheduler", runId, evaluated: out.length },
  });

  sendJson(res, 200, {
    ok: true,
    runId,
    evaluated: out.length,
    out,
  });
};

module.exports.nextStep = nextStep;
module.exports.isOwnerProofLog = isOwnerProofLog;
