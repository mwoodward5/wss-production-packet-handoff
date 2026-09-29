"use strict";

const { gateway, methodGuard, readJson, sendJson } = require("../../lib/mission-control-customer");

module.exports = async function handler(req, res) {
  const methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
  if (!methodGuard(req, res, methods)) return;
  try {
    const body = ["POST", "PUT", "DELETE"].includes(req.method) ? await readJson(req) : {};
    const payload = await gateway(req, body);
    sendJson(req, res, 200, payload, methods);
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
