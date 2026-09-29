"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { deliveryPauseStatus, setDeliveryPause } = require("../../lib/delivery-pause");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === "GET") {
      sendJson(res, 200, { ok: true, deliveryPause: await deliveryPauseStatus() });
      return;
    }

    const body = await readJson(req).catch(() => ({}));
    if (typeof body.active !== "boolean") {
      sendJson(res, 400, { ok: false, error: "active_boolean_required" });
      return;
    }
    await setDeliveryPause({
      active: body.active,
      reason: body.reason || (body.active ? "operator_pause" : "operator_resume"),
      runId: body.runId || null,
      actor: "admin",
    });
    sendJson(res, 200, { ok: true, deliveryPause: await deliveryPauseStatus() });
  } catch (error) {
    handleError(res, error);
  }
};
