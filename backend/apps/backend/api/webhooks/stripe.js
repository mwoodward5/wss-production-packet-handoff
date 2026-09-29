const { handleError, methodGuard, readRawBody, sendJson } = require("../../lib/http");
const { fulfillCheckoutSession } = require("../../lib/fulfillment");
const { LOCAL_GROWTH_PRODUCT, verifyStripeSignature } = require("../../lib/stripe");
const { handleCommerceStripeEvent } = require("../../lib/mission-control-commerce");
const { handleCustomerStripeEvent } = require("../../lib/mission-control-customer");
const { recordEvent } = require("../../lib/store");

async function readStripeRawBody(req) {
  if (typeof req.on !== "function") return readRawBody(req);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    // Vercel's req.body helper is lazy. Reading the stream first preserves the
    // exact bytes Stripe signed instead of parsing and re-stringifying JSON.
    const raw = await readStripeRawBody(req);
    const signature = req.headers["stripe-signature"];
    const verification = verifyStripeSignature(raw, signature);
    const event = JSON.parse(raw || "{}");
    const product = event.data?.object?.metadata?.product || "";
    const isFulfillmentEvent = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ].includes(event.type);
    const stored = await recordEvent("stripe_webhook", {
      verified: verification.verified,
      type: event.type,
      id: event.id,
      metadata: event.data?.object?.metadata || {},
    });
    const fulfillment =
      verification.verified &&
      isFulfillmentEvent &&
      product === LOCAL_GROWTH_PRODUCT
        ? await fulfillCheckoutSession(event)
        : verification.verified && isFulfillmentEvent && product === "mission-control"
          ? { mode: "delegated_to_customer_commerce", product }
        : verification.verified && isFulfillmentEvent
          ? { mode: "record_event_only", reason: "not_local_growth_product", product }
          : {
              mode: "record_event_only",
              reason:
                isFulfillmentEvent
                  ? "signature_not_verified"
                  : "event_type_not_fulfillment_trigger",
            };
    const commerce =
      verification.verified && product !== "mission-control"
        ? await handleCommerceStripeEvent(event)
        : verification.verified
          ? { mode: "delegated_to_customer_commerce", product }
          : { mode: "record_event_only", reason: "signature_not_verified" };
    const customerCommerce =
      verification.verified
        ? await handleCustomerStripeEvent(event)
        : { mode: "record_event_only", reason: "signature_not_verified" };
    const responseStatus = !verification.configured ? 503 : verification.verified ? 200 : 400;
    sendJson(res, responseStatus, {
      ok: verification.verified,
      verification,
      eventType: event.type || "unknown",
      stored,
      fulfillment,
      commerce,
      customerCommerce,
      fulfillmentRule:
        isFulfillmentEvent
          ? "grant entitlement, trigger delivery, write ledger row"
          : "record event only",
    });
  } catch (error) {
    handleError(res, error);
  }
};
