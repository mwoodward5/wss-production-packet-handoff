"use strict";

// api/cron/run-rebuild-mirror-jobs.js — drain the durable rebuild queue.
//
// The route that queues a rebuild (api/admin/rebuild-mirror) also fires a
// best-effort kick in the same lambda, so in the common case the build starts
// immediately and this sweeper never does anything. This route is the SAFETY
// NET behind that kick — the same contract api/cron/run-edit-jobs keeps for
// Riley's edit jobs: a kick lost to a freezing lambda, a job queued while no
// operator was connected, and a worker that died mid-build (stale "running")
// all get picked up here instead of sitting "queued" forever.
//
// Per pass it drains at most GHOST_AGENCY_REBUILD_DRAIN_MAX jobs (default 2):
// one rebuild is a measured ~127s of build+deploy inside a 300s function, and
// promising more per pass is a promise the platform will break for us.
const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const rebuildJobs = require("../../lib/rebuild-jobs");

function createRunRebuildMirrorJobsHandler(dependencies = {}) {
  const requireCronFn = dependencies.requireCron || requireCron;
  const methodGuardFn = dependencies.methodGuard || methodGuard;
  const sendJsonFn = dependencies.sendJson || sendJson;
  const jobs = dependencies.rebuildJobs || rebuildJobs;
  return async function runRebuildMirrorJobsHandler(req, res) {
    if (!methodGuardFn(req, res, ["GET", "POST"])) return;
    if (!requireCronFn(req, res)) return;
    try {
      // Close the dead before re-running the living, so a job that burned its
      // attempts is not handed another one.
      const swept = await jobs.sweepStaleRebuildJobs();
      const drained = await jobs.drainRebuildJobs();
      sendJsonFn(res, 200, {
        ok: drained.ok !== false,
        job: "run-rebuild-mirror-jobs",
        swept_requeued: (swept.requeued || []).length,
        swept_closed: (swept.closed || []).length,
        drained: drained.drained || 0,
        // Counts only in the response: no prospect facts, no verdict sentences.
        failed: drained.failed || 0,
        skipped: drained.skipped || 0,
      });
    } catch (_) {
      // Do not echo exception text: upstream errors can contain prospect facts.
      sendJsonFn(res, 500, { ok: false, job: "run-rebuild-mirror-jobs", error: "rebuild_drain_failed" });
    }
  };
}

module.exports = createRunRebuildMirrorJobsHandler();
module.exports.createRunRebuildMirrorJobsHandler = createRunRebuildMirrorJobsHandler;
