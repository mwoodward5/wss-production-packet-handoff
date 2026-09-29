"use strict";

const crypto = require("node:crypto");
const { adminAllowed } = require("./admin-auth");
const { sendJson } = require("./http");

function safeEq(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAdminOrHardeningProof(req, res) {
  if (adminAllowed(req).allowed) return true;
  const expected = process.env.GHOST_AGENCY_HARDENING_PROOF_TOKEN?.trim();
  const supplied = req.headers["x-hardening-proof"] || "";
  if (expected && safeEq(supplied, expected)) return true;
  sendJson(res, 401, { ok: false, error: "unauthorized" });
  return false;
}

module.exports = { requireAdminOrHardeningProof };
