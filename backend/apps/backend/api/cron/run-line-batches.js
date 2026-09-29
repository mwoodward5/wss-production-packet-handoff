"use strict";

// Rescue-only sweep for Line batches whose queue notification was lost or
// whose worker died after checkpointing. Vercel Queues is the primary worker;
// this route calls the same continuation service and never owns a second flow.
const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");

const COUNT_FIELDS = Object.freeze([
  "selected",
  "claimed",
  "processed",
  "continued",
  "completed",
  "failed",
  "skipped",
  "remaining",
  "retired",
]);

function loadContinuation() {
  // Same production worker envelope as the queue consumer, plus human-first
  // campaign ownership so old idle Practice runs cannot starve current work.
  return require("../../lib/line-continuation-human");
}

function rescueLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 10 ? number : 3;
}

function safeRescueSummary(result = {}) {
  const summary = {
    ok: result && result.ok !== false,
    job: "run-line-batches",
    rescueOnly: true,
  };
  for (const field of COUNT_FIELDS) {
    const count = Number(result && result[field]);
    if (Number.isInteger(count) && count >= 0) summary[field] = count;
  }
  return summary;
}

function createRunLineBatchesHandler(dependencies = {}) {
  const requireCronFn = dependencies.requireCron || requireCron;
  const methodGuardFn = dependencies.methodGuard || methodGuard;
  const sendJsonFn = dependencies.sendJson || sendJson;
  const loadContinuationFn = dependencies.loadContinuation || loadContinuation;

  return async function runLineBatchesHandler(req, res) {
    if (!methodGuardFn(req, res, ["GET", "POST"])) return;
    if (!requireCronFn(req, res)) return;

    try {
      const continuation = loadContinuationFn();
      if (!continuation || typeof continuation.rescueLineBatches !== "function") {
        throw new TypeError("line_continuation_service_invalid");
      }
      const result = await continuation.rescueLineBatches({
        source: "cron",
        rescueOnly: true,
        limit: rescueLimit(process.env.GHOST_AGENCY_LINE_RESCUE_BATCH),
      });
      sendJsonFn(res, 200, safeRescueSummary(result));
    } catch (_) {
      // Do not echo exception text: upstream errors can contain prospect facts.
      sendJsonFn(res, 500, {
        ok: false,
        job: "run-line-batches",
        rescueOnly: true,
        error: "line_rescue_failed",
      });
    }
  };
}

module.exports = createRunLineBatchesHandler();
module.exports.createRunLineBatchesHandler = createRunLineBatchesHandler;
module.exports.loadContinuation = loadContinuation;
module.exports.rescueLimit = rescueLimit;
module.exports.safeRescueSummary = safeRescueSummary;
