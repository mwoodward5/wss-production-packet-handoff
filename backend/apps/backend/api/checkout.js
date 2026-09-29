const { handleError, methodGuard, readJson, sendJson } = require("../lib/http");
const { createCheckoutSession } = require("../lib/stripe");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    const body = await readJson(req);
    const checkout = await createCheckoutSession(body);
    sendJson(res, checkout.mode === "checkout_failed" ? 502 : 200, {
      ok: checkout.mode !== "checkout_failed",
      checkout,
    });
  } catch (error) {
    handleError(res, error);
  }
};
