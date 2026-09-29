"use strict";
const { requireAdmin } = require("../../lib/admin-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const { metricDictionary } = require("../../lib/tracking-truth");
module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdmin(req, res)) return;
  sendJson(res, 200, { ok: true, metrics: metricDictionary() });
};
