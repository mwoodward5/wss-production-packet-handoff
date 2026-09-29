"use strict";

const crypto = require("node:crypto");
const { sendJson } = require("./http");

function safeEq(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireCron(req, res) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const adminToken = process.env.GHOST_AGENCY_ADMIN_TOKEN?.trim();
  const hardeningProof = process.env.GHOST_AGENCY_HARDENING_PROOF_TOKEN?.trim();

  if (!cronSecret && !adminToken) {
    sendJson(res, 503, {
      ok: false,
      error: "cron_locked_no_secret_configured",
      message: "Set CRON_SECRET before scheduled jobs can run.",
    });
    return false;
  }

  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (cronSecret && safeEq(auth, `Bearer ${cronSecret}`)) {
    return true;
  }

  const adminHeader = req.headers["x-admin-token"] || "";
  if (adminToken && safeEq(adminHeader, adminToken)) {
    return true;
  }

  const proofHeader = req.headers["x-hardening-proof"] || "";
  if (hardeningProof && safeEq(proofHeader, hardeningProof)) {
    return true;
  }

  sendJson(res, 401, {
    ok: false,
    error: "unauthorized",
  });
  return false;
}

module.exports = {
  requireCron,
};
