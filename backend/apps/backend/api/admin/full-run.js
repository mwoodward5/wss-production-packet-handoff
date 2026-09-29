"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { runFullSystem } = require("../../lib/full-run");

const OWNER_PROOF_ROUTE_WINDOW_MS = 285_000;

module.exports = async function handler(req, res) {
  const routeStartedAt = Date.now();
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    // Dependency hooks are for direct unit tests only. JSON callers must never
    // influence the production dependency graph, even with an admin token.
    if (body && typeof body === "object") delete body._test;
    const result = await runFullSystem({
      ...body,
      // Start the business deadline at route entry, before auth/body parsing,
      // and leave fifteen seconds below Vercel's 300-second function cap.
      ownerProofDeadlineAt: routeStartedAt + OWNER_PROOF_ROUTE_WINDOW_MS,
    });
    sendJson(res, 200, result);
  } catch (error) {
    handleError(res, error);
  }
};
