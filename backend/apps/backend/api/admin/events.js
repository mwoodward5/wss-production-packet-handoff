"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { selectRows } = require("../../lib/store");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const events = await selectRows("ghost_agency_events", {
      order: "created_at.desc",
      limit: 100,
    });
    sendJson(res, 200, { ok: true, events });
  } catch (error) {
    handleError(res, error);
  }
};
