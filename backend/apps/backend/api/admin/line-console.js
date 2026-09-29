"use strict";

// Public HTML shell for the operator line console. Contains NO data: the token
// is entered in-browser and used only as an x-admin-token header against
// /api/admin/line. Everything real stays behind the admin gate.

const { methodGuard } = require("../../lib/http");
const PAGE = require("../../lib/line-console-page");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.statusCode = 200;
  res.end(PAGE);
};
