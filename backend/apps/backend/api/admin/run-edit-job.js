"use strict";
// api/admin/run-edit-job.js — operator's by-hand runner for one edit job.
// The EXECUTION lives in lib/edit-job-runner.js (runSiteChange under it), where
// the cron sweeper and Riley's post-queue kick share the same implementation —
// three callers, one code path, no drift. maxDuration 300 (see vercel.json).
const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { executeEditJob } = require("../../lib/edit-job-runner");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    const out = await executeEditJob(body.jobId);
    const status = out.status === 404 ? 404 : out.status === 400 ? 400 : 200;
    if (status !== 200) return sendJson(res, status, { ok: false, error: out.error });
    sendJson(res, 200, out);
  } catch (error) {
    handleError(res, error);
  }
};
