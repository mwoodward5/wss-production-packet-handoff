"use strict";

// Read-only operator diagnostic for the durable Mirror fleet.  A fleet read is
// deliberately fail-closed before a site can render; this endpoint names the
// state without exposing any fleet identities or attempting the legacy write
// backfill.  It cannot build, publish, or send.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { readFleetIdentities } = require("../../lib/mirror-fleet-identity");

function safeReason(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .slice(0, 120);
}

function fleetReadSummary(result) {
  const fleet = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const backfill = fleet.backfill && typeof fleet.backfill === "object" && !Array.isArray(fleet.backfill)
    ? fleet.backfill
    : null;
  return {
    ok: fleet.ok === true,
    identity_count: Array.isArray(fleet.identities) ? fleet.identities.length : 0,
    reason: fleet.ok === true ? "" : (safeReason(fleet.reason) || "fleet_read_unavailable"),
    backfill: backfill ? {
      attempted: Number(backfill.attempted) || 0,
      previewed: Number(backfill.previewed) || 0,
      written: Number(backfill.written) || 0,
      reused: Number(backfill.reused) || 0,
      unresolved: Number(backfill.unresolved) || 0,
      ambiguous: Number(backfill.ambiguous) || 0,
      reason: safeReason(backfill.reason),
    } : null,
  };
}

function createFleetReadProbeHandler(overrides = {}) {
  const readFleet = overrides.readFleetIdentities || readFleetIdentities;
  return async function handler(req, res) {
    if (!methodGuard(req, res, ["GET"])) return;
    if (!requireAdmin(req, res)) return;
    try {
      // Preview the legacy backfill only.  The diagnostic is strictly read-only.
      const fleet = await readFleet({ writeBackfill: false });
      sendJson(res, 200, fleetReadSummary(fleet));
    } catch (error) {
      handleError(res, error, "fleet_read_probe_failed");
    }
  };
}

const handler = createFleetReadProbeHandler();

module.exports = handler;
module.exports.createFleetReadProbeHandler = createFleetReadProbeHandler;
module.exports.fleetReadSummary = fleetReadSummary;
