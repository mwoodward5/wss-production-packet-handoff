"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { dispatchStudioAction, lovableConfigured } = require("../../lib/lovable");
const { selectRows } = require("../../lib/store");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === "GET") {
      const tickets = await selectRows("ghost_agency_support_tickets", { order: "updated_at.desc", limit: 25 });
      sendJson(res, 200, {
        ok: true,
        mode: lovableConfigured() ? "lovable_configured" : "handoff_packet",
        tickets,
      });
      return;
    }
    const result = await dispatchStudioAction("projects.create", {});
    sendJson(res, result.ok ? 200 : 202, result);
  } catch (error) {
    handleError(res, error);
  }
};
