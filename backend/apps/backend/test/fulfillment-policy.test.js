"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { checkoutFulfillmentPolicy } = require("../lib/fulfillment");
const { checkoutContractHash, testPromotionHash } = require("../lib/stripe");

const ENV_KEYS = [
  "GHOST_AGENCY_OWNER_EMAIL",
  "LOCAL_GROWTH_OWNER_EMAIL",
  "STRIPE_SECRET_KEY",
  "STRIPE_TEST_CHECKOUT_ENABLED",
  "STRIPE_TEST_PROMOTION_CODE_ID",
  "STRIPE_LOCAL_GROWTH_PRICE_ID",
  "STRIPE_LOCAL_GROWTH_AMOUNT_CENTS",
  "STRIPE_LOCAL_GROWTH_CURRENCY",
];

function sandboxEvent(overrides = {}) {
  const {
    paymentStatus = "no_payment_required",
    livemode = false,
    testCheckout = "true",
    email = "owner@example.com",
    mode = "subscription",
    status = "complete",
    subscription = "sub_test_owner",
    amountTotal = 0,
    amountSubtotal = 19900,
    currency = "usd",
    product = "local-growth-website-plan",
    promotionHash = testPromotionHash(),
    checkoutPriceId = "price_contract",
    checkoutAmountCents = 19900,
    checkoutCurrency = "usd",
    checkoutHash = checkoutContractHash({
      priceId: checkoutPriceId,
      amountCents: checkoutAmountCents,
      currency: checkoutCurrency,
    }),
  } = overrides;
  return {
    type: "checkout.session.completed",
    livemode,
    data: {
      object: {
        id: "cs_test_owner",
        mode,
        status,
        subscription,
        created: 1784428800,
        amount_subtotal: amountSubtotal,
        amount_total: amountTotal,
        currency,
        payment_status: paymentStatus,
        customer_email: email,
        metadata: {
          product,
          testCheckout,
          testPromotionHash: promotionHash,
          checkoutPriceId,
          checkoutAmountCents: String(checkoutAmountCents),
          checkoutCurrency,
          checkoutContractHash: checkoutHash,
        },
      },
    },
  };
}

function withSandboxEnv(run) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.com";
  process.env.STRIPE_SECRET_KEY = "sk_test_contract";
  process.env.STRIPE_TEST_CHECKOUT_ENABLED = "true";
  process.env.STRIPE_TEST_PROMOTION_CODE_ID = "promo_test_free";
  process.env.STRIPE_LOCAL_GROWTH_PRICE_ID = "price_contract";
  process.env.STRIPE_LOCAL_GROWTH_AMOUNT_CENTS = "19900";
  process.env.STRIPE_LOCAL_GROWTH_CURRENCY = "usd";
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("only a completed live paid subscription can use normal fulfillment", () => {
  withSandboxEnv(() => {
    assert.deepEqual(
      checkoutFulfillmentPolicy(sandboxEvent({
        paymentStatus: "paid",
        livemode: true,
        amountTotal: 19900,
        testCheckout: undefined,
      })),
      { allowed: true, ownerSandboxCheckout: false, paymentStatus: "paid" },
    );

    for (const candidate of [
      sandboxEvent({ paymentStatus: "paid", livemode: false, email: "visitor@example.com", testCheckout: undefined }),
      sandboxEvent({ paymentStatus: "unpaid", livemode: true, amountTotal: 19900, testCheckout: undefined }),
      sandboxEvent({ paymentStatus: "paid", livemode: true, amountTotal: 19900, product: "mission-control" }),
      sandboxEvent({ paymentStatus: "paid", livemode: true, amountTotal: 19900, status: "open" }),
      sandboxEvent({ paymentStatus: "paid", livemode: true, amountSubtotal: 19899 }),
      sandboxEvent({ paymentStatus: "paid", livemode: true, currency: "eur" }),
      sandboxEvent({ paymentStatus: "paid", livemode: true, checkoutHash: "0".repeat(64) }),
      { ...sandboxEvent({ paymentStatus: "paid", livemode: true, amountTotal: 19900 }), type: "invoice.paid" },
    ]) {
      assert.equal(checkoutFulfillmentPolicy(candidate).allowed, false);
    }
  });
});

test("async payment success uses the same signed live subscription contract", () => {
  withSandboxEnv(() => {
    const event = {
      ...sandboxEvent({ paymentStatus: "paid", livemode: true, amountTotal: 19900 }),
      type: "checkout.session.async_payment_succeeded",
    };
    assert.equal(checkoutFulfillmentPolicy(event).allowed, true);
    const paymentMode = sandboxEvent({ paymentStatus: "paid", livemode: true, mode: "payment" });
    assert.equal(checkoutFulfillmentPolicy(paymentMode).reason, "checkout_mode_not_supported");
  });
});

test("the no-card path requires the exact owner sandbox contract", () => {
  withSandboxEnv(() => {
    const allowed = checkoutFulfillmentPolicy(sandboxEvent());
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.ownerSandboxCheckout, true);

    for (const candidate of [
      sandboxEvent({ paymentStatus: "unpaid" }),
      sandboxEvent({ livemode: true }),
      sandboxEvent({ email: "visitor@example.com" }),
      sandboxEvent({ testCheckout: "false" }),
      sandboxEvent({ mode: "payment" }),
      sandboxEvent({ status: "open" }),
      sandboxEvent({ subscription: "" }),
      sandboxEvent({ amountTotal: 1 }),
      sandboxEvent({ amountTotal: null }),
      sandboxEvent({ product: "mission-control" }),
      sandboxEvent({ promotionHash: "0".repeat(64) }),
    ]) {
      const blocked = checkoutFulfillmentPolicy(candidate);
      assert.equal(blocked.allowed, false);
      assert.ok(blocked.reason);
    }

    process.env.STRIPE_TEST_CHECKOUT_ENABLED = "false";
    assert.equal(checkoutFulfillmentPolicy(sandboxEvent()).allowed, false);
    process.env.STRIPE_TEST_CHECKOUT_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_live_contract";
    assert.equal(checkoutFulfillmentPolicy(sandboxEvent()).allowed, false);
  });
});
