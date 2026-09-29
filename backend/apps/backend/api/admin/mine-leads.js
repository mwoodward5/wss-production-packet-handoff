"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { mineLeads } = require("../../lib/lead-miner");
const { approvedIndustry } = require("../../lib/copilot");

function createMineLeadsHandler({ mine = mineLeads } = {}) {
  return async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    if (body.confirmed !== true) {
      sendJson(res, 400, {
        ok: false,
        error: "mining_confirmation_required",
        message: "Review the parsed mining plan and resend with confirmed:true. Nothing was mined.",
      });
      return;
    }
    const industry = approvedIndustry(body.industry);
    const location = String(body.location || body.metro || "").trim();
    if (!industry || !location) {
      sendJson(res, 400, {
        ok: false,
        error: "mining_plan_required",
        message: "Mining requires an approved industry and explicit location. Nothing was mined.",
      });
      return;
    }
    // EXPLICIT ALLOWLIST — the body must never reach provider endpoints, env,
    // injection hooks, lane switches, trigger/actor identity, or a raw query.
    const result = await mine({
      industry,
      location,
      limit: body.limit,
      selectCount: body.selectCount,
      candidatesPerQuery: body.candidatesPerQuery,
      persist: body.persist,
      includeRecords: body.includeRecords,
      queryShapeCursor: body.queryShapeCursor,
      // A command-confirmed hunt is scoped exclusively by its parsed plan.
      query: `${industry} in ${location}`,
      actor: "agent_01_prospect_miner",
      trigger: "manual_console",
      buildReadyGate: true,
      placesVerify: false,
    });
    sendJson(res, 200, result);
  } catch (error) {
    handleError(res, error);
  }
  };
}

module.exports = createMineLeadsHandler();
module.exports.createMineLeadsHandler = createMineLeadsHandler;
