"use strict";

// api/cron/run-edit-jobs.js — drain the site-edit queue.
//
// Riley's phone flow queues a job and fast-acks; the kick in site-edit.js runs
// it immediately in the common case. This sweeper is the durable safety net
// behind that promise: queued work, stale workers, and now narrowly-defined
// capability refusals all get another deterministic path instead of being left
// as permanent dead ends.
const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const { select, upsertRow, recordEvent } = require("../../lib/store");
const { drainEditQueue } = require("../../lib/edit-job-runner");
const { sweepDeadEditJobs } = require("../../lib/edit-job-sweeper");
const { rescueComplexEdits } = require("../../lib/complex-edit-rescue");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireCron(req, res)) return;
  try {
    // Close genuinely dead work first. Rescue recent capability refusals before
    // the normal drain so a busy queue cannot starve the recovery lane behind
    // several long-running site builds. Safety/truth refusals are never rescue
    // candidates.
    const swept = await sweepDeadEditJobs({ select, upsertRow, recordEvent });
    const rescue = await rescueComplexEdits({ max: 2 });
    const out = await drainEditQueue({ max: 3 });
    sendJson(res, 200, {
      ...out,
      swept: swept.closed.length,
      closed: swept.closed,
      complex_rescue: rescue,
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String((error && error.message) || error).slice(0, 300) });
  }
};
