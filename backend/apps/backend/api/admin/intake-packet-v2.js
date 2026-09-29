"use strict";

// POST /api/admin/intake-packet-v2
//
// Stages one PageHub Packet2 beside an existing LeadMiner prospect. This route
// deliberately does not import any builder, queue, or email module. Staging is
// a durable data write only; a separate, explicit line start consumes it.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { conditionalUpdate, select } = require("../../lib/store");
const { stagePageHubBuildPacket } = require("../../lib/pagehub-build-packet");

const TABLE = "ghost_agency_prospects";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function recordOf(row) {
  return row?.record && typeof row.record === "object" && !Array.isArray(row.record)
    ? row.record
    : {};
}

function createIntakePacketV2Handler(overrides = {}) {
  const deps = {
    auth: overrides.requireAdmin || requireAdmin,
    select: overrides.select || select,
    conditionalUpdate: overrides.conditionalUpdate || conditionalUpdate,
    now: overrides.now || (() => new Date()),
  };

  async function readExactProspect(prospectId) {
    const found = await deps.select(
      TABLE,
      `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    ).catch(() => null);
    if (!found || found.ok !== true) return { error: "prospect_store_unavailable" };
    const row = Array.isArray(found.data) ? found.data[0] : null;
    return row && text(row.prospect_id) === prospectId ? { row } : { error: "prospect_not_found" };
  }

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    if (!deps.auth(req, res)) return;

    try {
      const body = await readJson(req);
      const prospectId = text(body.prospect_id || body.prospectId);
      if (!prospectId) return sendJson(res, 400, { ok: false, error: "prospect_id_required" });
      const packet = body.packet;
      if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
        return sendJson(res, 400, { ok: false, error: "pagehub_packet_required" });
      }

      const loaded = await readExactProspect(prospectId);
      if (loaded.error === "prospect_store_unavailable") {
        return sendJson(res, 503, { ok: false, error: loaded.error });
      }
      if (loaded.error) return sendJson(res, 404, { ok: false, error: loaded.error });

      const row = loaded.row;
      const stagedAt = deps.now();
      const staged = stagePageHubBuildPacket(recordOf(row), packet, stagedAt);
      if (staged.status === "conflict") {
        return sendJson(res, 409, {
          ok: false,
          error: staged.error,
          prospect_id: prospectId,
          stored_sha256: text(staged.sidecar?.snapshot_sha256) || null,
          incoming_sha256: staged.incoming_sha256 || null,
        });
      }
      if (staged.status === "noop") {
        return sendJson(res, 200, {
          ok: true,
          status: "noop",
          prospect_id: prospectId,
          packet_id: staged.sidecar.packet_id,
          snapshot_sha256: staged.sidecar.snapshot_sha256,
          asset_candidate_count: Array.isArray(staged.sidecar.asset_candidates)
            ? staged.sidecar.asset_candidates.length
            : 0,
        });
      }
      if (!text(row.updated_at)) {
        return sendJson(res, 409, { ok: false, error: "prospect_cas_version_missing" });
      }

      const nextUpdatedAt = stagedAt.toISOString();
      const persisted = await deps.conditionalUpdate(
        TABLE,
        "prospect_id",
        prospectId,
        { updated_at: `eq.${text(row.updated_at)}` },
        { record: staged.record, updated_at: nextUpdatedAt },
      ).catch(() => null);
      if (!persisted || persisted.ok !== true) {
        return sendJson(res, 503, { ok: false, error: "pagehub_packet_write_failed" });
      }
      if (persisted.updated !== true) {
        // A simultaneous identical retry is still success. Re-read before
        // reporting a conflict so idempotency holds under concurrency too.
        const concurrent = await readExactProspect(prospectId);
        if (concurrent.row) {
          const after = stagePageHubBuildPacket(recordOf(concurrent.row), packet, stagedAt);
          if (after.status === "noop") {
            return sendJson(res, 200, {
              ok: true,
              status: "noop",
              prospect_id: prospectId,
              packet_id: after.sidecar.packet_id,
              snapshot_sha256: after.sidecar.snapshot_sha256,
              asset_candidate_count: Array.isArray(after.sidecar.asset_candidates)
                ? after.sidecar.asset_candidates.length
                : 0,
            });
          }
        }
        return sendJson(res, 409, { ok: false, error: "pagehub_packet_cas_conflict" });
      }

      return sendJson(res, 200, {
        ok: true,
        status: "staged",
        prospect_id: prospectId,
        packet_id: staged.sidecar.packet_id,
        snapshot_sha256: staged.sidecar.snapshot_sha256,
        asset_candidate_count: staged.sidecar.asset_candidates.length,
        refreshed: staged.refreshed === true,
        superseded_sha256: text(staged.sidecar.supersedes?.snapshot_sha256) || null,
        updated_at: nextUpdatedAt,
      });
    } catch (error) {
      if (["pagehub_packet_required", "pagehub_packet_not_json", "pagehub_packet_too_deep"].includes(error?.code)) {
        return sendJson(res, 400, { ok: false, error: error.code });
      }
      return handleError(res, error);
    }
  };
}

module.exports = createIntakePacketV2Handler();
module.exports.createIntakePacketV2Handler = createIntakePacketV2Handler;
module.exports.TABLE = TABLE;
