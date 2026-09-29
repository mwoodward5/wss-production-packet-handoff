"use strict";

const { createCheckout, methodGuard, readJson, sendJson } = require("../../lib/mission-control-customer");

module.exports = async function handler(req, res) {
  const methods = ["POST", "OPTIONS"];
  if (!methodGuard(req, res, methods)) return;
  try {
    const checkout = await createCheckout(req, await readJson(req));
    sendJson(req, res, 200, { ok: true, checkout, url: checkout.url }, methods);
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, {
      ok: false,
      error: error.code || "internal_error",
      message: error.message,
      detail: error.detail,
    }, methods);
  }
};
