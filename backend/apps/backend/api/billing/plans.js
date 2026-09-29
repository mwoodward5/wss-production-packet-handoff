"use strict";

const {
  getPublicBillingPlans,
  methodGuard,
  sendCommerceJson,
} = require("../../lib/mission-control-commerce");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "OPTIONS"])) return;
  try {
    const plans = await getPublicBillingPlans();
    sendCommerceJson(req, res, 200, { ok: true, ...plans }, ["GET", "OPTIONS"]);
  } catch (error) {
    sendCommerceJson(req, res, error.statusCode || 500, {
      ok: false,
      error: error.code || "internal_error",
      message: error.message,
    }, ["GET", "OPTIONS"]);
  }
};
