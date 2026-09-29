"use strict";

const { methodGuard, readJson, saveAgent, sendJson } = require("../../lib/mission-control-customer");
const { businessProfileStatus } = require("../../lib/answercrew-agent-core");

module.exports = async function handler(req, res) {
  const methods = ["POST", "OPTIONS"];
  if (!methodGuard(req, res, methods)) return;
  try {
    const body = await readJson(req);
    const saved = await saveAgent(req, body.slot_key || body.name || "agent-1", body, { requireActive: false, provision: false });
    const readiness = businessProfileStatus(saved.row.business_profile);
    sendJson(req, res, 200, {
      ok: true,
      draft: saved.agent,
      draft_id: saved.row.id,
      profile_complete: readiness.complete,
      missing_profile_fields: readiness.missing,
      required_profile_fields: readiness.required,
    }, methods);
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, {
      ok: false,
      error: error.code || "internal_error",
      message: error.message,
      detail: error.detail,
    }, methods);
  }
};
