"use strict";

// Public HTML shell for the live operator console. Contains NO sensitive data:
// the owner password is exchanged server-side for a signed session; only that
// signed session token is stored in the browser and sent to protected admin APIs.
// Serves the real console builder (lib/console-page, with the Ghost Arcade
// overview hero). The 2026-08-19 login-recovery hotfix
// (lib/operator-workspace-login-hotfix.js) stays in-repo for history; the
// password -> signed-session login it protected now lives inside
// lib/console-page.js itself.

const { methodGuard } = require("../../lib/http");
const PAGE = require("../../lib/operator-workspace-login-hotfix");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.statusCode = 200;
  res.end(PAGE);
};
