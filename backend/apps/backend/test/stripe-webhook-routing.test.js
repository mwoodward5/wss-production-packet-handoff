"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const handlerPath = require.resolve("../api/webhooks/stripe");
const modulePaths = {
  fulfillment: require.resolve("../lib/fulfillment"),
  stripe: require.resolve("../lib/stripe"),
  commerce: require.resolve("../lib/mission-control-commerce"),
  customer: require.resolve("../lib/mission-control-customer"),
  store: require.resolve("../lib/store"),
};

function mockedModule(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function responseCapture() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(body) { this.body = body; },
  };
}

test("delayed Stripe payment success enters the same fulfillment path", async () => {
  const paths = [handlerPath, ...Object.values(modulePaths)];
  const originals = new Map(paths.map((path) => [path, require.cache[path]]));
  const fulfilledTypes = [];
  let verificationState = { verified: true, configured: true };
  delete require.cache[handlerPath];
  mockedModule(modulePaths.fulfillment, {
    fulfillCheckoutSession: async (event) => {
      fulfilledTypes.push(event.type);
      return { mode: "fulfilled_contract" };
    },
  });
  mockedModule(modulePaths.stripe, {
    LOCAL_GROWTH_PRODUCT: "local-growth-website-plan",
    verifyStripeSignature: () => verificationState,
  });
  mockedModule(modulePaths.commerce, {
    handleCommerceStripeEvent: async () => ({ mode: "ignored_contract" }),
  });
  mockedModule(modulePaths.customer, {
    handleCustomerStripeEvent: async () => ({ mode: "ignored_contract" }),
  });
  mockedModule(modulePaths.store, {
    recordEvent: async () => ({ mode: "live_write" }),
  });

  try {
    const handler = require(handlerPath);
    for (const eventType of ["checkout.session.completed", "checkout.session.async_payment_succeeded"]) {
      const response = responseCapture();
      await handler({
        method: "POST",
        headers: { "stripe-signature": "contract" },
        body: JSON.stringify({
          id: `evt_${eventType}`,
          type: eventType,
          data: { object: { metadata: { product: "local-growth-website-plan" } } },
        }),
      }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(JSON.parse(response.body).fulfillment.mode, "fulfilled_contract");
    }
    assert.deepEqual(fulfilledTypes, [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ]);

    for (const product of ["answercrew", "mission-control", "", "unknown-product"]) {
      const response = responseCapture();
      await handler({
        method: "POST",
        headers: { "stripe-signature": "contract" },
        body: JSON.stringify({
          id: `evt_negative_${product || "blank"}`,
          type: "checkout.session.completed",
          data: { object: { metadata: { product } } },
        }),
      }, response);
      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      if (product === "mission-control") {
        assert.equal(body.fulfillment.mode, "delegated_to_customer_commerce");
      } else {
        assert.equal(body.fulfillment.mode, "record_event_only");
        assert.equal(body.fulfillment.reason, "not_local_growth_product");
      }
    }
    assert.equal(fulfilledTypes.length, 2);

    verificationState = { verified: false, configured: false, reason: "STRIPE_WEBHOOK_SECRET not configured" };
    const missingSecret = responseCapture();
    await handler({
      method: "POST",
      headers: { "stripe-signature": "contract" },
      body: JSON.stringify({
        id: "evt_missing_webhook_secret",
        type: "checkout.session.completed",
        data: { object: { metadata: { product: "local-growth-website-plan" } } },
      }),
    }, missingSecret);
    assert.equal(missingSecret.statusCode, 503);
    assert.equal(JSON.parse(missingSecret.body).ok, false);
    assert.equal(fulfilledTypes.length, 2);
  } finally {
    delete require.cache[handlerPath];
    for (const [path, original] of originals) {
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    }
  }
});
