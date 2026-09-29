"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { generateMorningReport } = require("../../lib/morning-report");

function createMorningReportHandler(overrides = {}) {
  const guard = overrides.methodGuard || methodGuard;
  const authorize = overrides.requireAdmin || requireAdmin;
  const generate = overrides.generateMorningReport || generateMorningReport;
  const json = overrides.sendJson || sendJson;
  const fail = overrides.handleError || handleError;
  const deps = overrides.deps || {};

  return async function morningReportHandler(req, res) {
    if (!guard(req, res, ["GET"])) return;
    if (!authorize(req, res)) return;

    try {
      const report = await generate({}, deps);
      json(res, 200, { ok: true, report });
    } catch (error) {
      fail(res, error);
    }
  };
}

module.exports = createMorningReportHandler();
module.exports.createMorningReportHandler = createMorningReportHandler;
