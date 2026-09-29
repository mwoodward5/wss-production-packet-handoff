"use strict";

// Public HTML shell for the current Outreach review surface. The proven
// approve/send backend contract is unchanged; the page hides obsolete history.
const { methodGuard } = require("../../lib/http");
const PAGE = require("../../lib/campaigns-page-final");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.statusCode = 200;
  res.end(PAGE);
};
