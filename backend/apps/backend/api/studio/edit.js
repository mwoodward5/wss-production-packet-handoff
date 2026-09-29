"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { dispatchStudioAction } = require("../../lib/lovable");
const { recordEvent } = require("../../lib/store");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req);
    const result = await dispatchStudioAction("site.edit", body);
    await recordEvent("support.edit_requested", {
      mode: result.mode,
      projectId: body.projectId || body.project_id || "",
      ticketId: body.ticketId || body.ticket_id || "",
    });
    sendJson(res, result.ok ? 200 : 202, result);
  } catch (error) {
    handleError(res, error);
  }
};
