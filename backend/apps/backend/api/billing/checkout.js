"use strict";

const {
  createBillingCheckout,
  methodGuard,
  readJson,
  sendCommerceJson,
} = require("../../lib/mission-control-commerce");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST", "OPTIONS"])) return;
  try {
    const body = await readJson(req);
    const checkout = await createBillingCheckout(req, body);
    sendCommerceJson(req, res, 200, { ok: true, checkout }, ["POST", "OPTIONS"]);
  } catch (error) {
    sendCommerceJson(req, res, error.statusCode || 500, {
      ok: false,
      error: error.code || "internal_error",
      message: error.message,
      detail: error.detail,
    }, ["POST", "OPTIONS"]);
  }
};
