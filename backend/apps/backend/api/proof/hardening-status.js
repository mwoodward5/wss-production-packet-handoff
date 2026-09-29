"use strict";

const { methodGuard, sendJson } = require("../../lib/http");
const { outreachFromStatus } = require("../../lib/env-compat");
const { reviewHoldActive } = require("../../lib/email");
const { outreachDnsStatus } = require("../../lib/outreach-dns");
const { requireAdminOrHardeningProof } = require("../../lib/proof-auth");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdminOrHardeningProof(req, res)) return;
  const parsed = Number.parseInt(process.env.GHOST_AGENCY_DRIP_BATCH ?? "20", 10);
  const batch = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 20, 0), 100);
  const sender = outreachFromStatus();
  const dns = await outreachDnsStatus();
  sendJson(res, 200, {
    ok: true,
    reviewHold: reviewHoldActive(),
    dripBatch: batch,
    outreachSender: { ok: sender.ok, domain: sender.domain, reason: sender.reason },
    outreachDns: { ok: dns.ok, checks: dns.checks },
  });
};
