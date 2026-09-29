"use strict";

const { activateCheckout, methodGuard, readJson, sendJson } = require("../../lib/mission-control-customer");

module.exports = async function handler(req, res) {
  const methods = ["POST", "OPTIONS"];
  if (!methodGuard(req, res, methods)) return;
  try {
    const result = await activateCheckout(req, await readJson(req));
    sendJson(req, res, 200, { ok: true, ...result }, methods);
  } catch (error) {
    const correlationId = error.correlationId || error.detail?.correlation_id || req.headers?.["x-correlation-id"] || null;
    sendJson(req, res, error.statusCode || 500, {
      ok: false,
      error: error.code || "internal_error",
      message: error.message,
      detail: error.detail,
      correlation_id: correlationId,
    }, methods);
  }
};
