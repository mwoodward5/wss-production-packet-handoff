"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const test = require("node:test");

const { verifyStripeSignature } = require("../lib/stripe");

function signedHeader(body, timestamp, secret) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

test("Stripe webhook signatures expire after the 300 second replay window", () => {
  const previous = process.env.STRIPE_WEBHOOK_SECRET;
  const secret = "whsec_contract_security";
  const body = JSON.stringify({ id: "evt_contract", type: "checkout.session.completed" });
  const now = Math.floor(Date.now() / 1000);
  process.env.STRIPE_WEBHOOK_SECRET = secret;

  try {
    assert.equal(verifyStripeSignature(body, signedHeader(body, now, secret)).verified, true);

    const stale = verifyStripeSignature(body, signedHeader(body, now - 600, secret));
    assert.equal(stale.verified, false);
    assert.equal(stale.reason, "Stripe signature timestamp outside tolerance");

    const future = verifyStripeSignature(body, signedHeader(body, now + 600, secret));
    assert.equal(future.verified, false);
    assert.equal(future.reason, "Stripe signature timestamp outside tolerance");
  } finally {
    if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previous;
  }
});
