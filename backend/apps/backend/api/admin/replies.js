"use strict";

// Public HTML shell for the operator Reply Desk. The page contains no
// sensitive data; its browser-side requests authenticate with x-admin-token.

const { methodGuard } = require("../../lib/http");
const PAGE = require("../../lib/replies-page");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.statusCode = 200;
  res.end(PAGE);
};
