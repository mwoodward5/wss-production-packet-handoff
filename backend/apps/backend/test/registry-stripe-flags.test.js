"use strict";

// Covers the 2026-07-22 Stripe customer-activation-chain audit's "unconfirmed
// due to Vercel CLI sensitive-var masking" gaps: DOMAIN_PURCHASE_ENABLED and
// STRIPE_TEST_CHECKOUT_ENABLED now have a real, always-current boolean
// surfaced by providerStatus() (and from there, admin/readiness and
// proof/stripe-chain) instead of requiring a raw env pull that Vercel can
// mask to empty for sensitive-flagged variables.

const assert = require("node:assert/strict");
const test = require("node:test");

const registryPath = require.resolve("../lib/registry");

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_ALLOW_LIVE",
  "DOMAIN_PURCHASE_ENABLED",
  "STRIPE_TEST_CHECKOUT_ENABLED",
  "STRIPE_WEBHOOK_SECRET",
];

function withEnv(overrides, run) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  delete require.cache[registryPath];
  try {
    const { providerStatus } = require(registryPath);
    return providerStatus().stripe;
  } finally {
    delete require.cache[registryPath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("domainPurchaseLive and testCheckoutEnabled default safely false", () => {
  const stripe = withEnv({}, () => {});
  assert.equal(stripe.domainPurchaseLive, false);
  assert.equal(stripe.testCheckoutEnabled, false);
  assert.equal(stripe.liveKeyDetected, false);
  assert.equal(stripe.liveKeyAllowed, false);
});

test("each flag reflects its own env var independently, case-insensitively where documented", () => {
  const domainOn = withEnv({ DOMAIN_PURCHASE_ENABLED: "TRUE" });
  assert.equal(domainOn.domainPurchaseLive, true);
  assert.equal(domainOn.testCheckoutEnabled, false);

  const testCheckoutOn = withEnv({ STRIPE_TEST_CHECKOUT_ENABLED: "true" });
  assert.equal(testCheckoutOn.testCheckoutEnabled, true);
  assert.equal(testCheckoutOn.domainPurchaseLive, false);

  const liveKey = withEnv({ STRIPE_SECRET_KEY: "sk_live_abc" });
  assert.equal(liveKey.liveKeyDetected, true);
  assert.equal(liveKey.liveKeyAllowed, false);

  const liveKeyAllowed = withEnv({ STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_ALLOW_LIVE: "true" });
  assert.equal(liveKeyAllowed.liveKeyDetected, true);
  assert.equal(liveKeyAllowed.liveKeyAllowed, true);

  const testKey = withEnv({ STRIPE_SECRET_KEY: "sk_test_abc" });
  assert.equal(testKey.liveKeyDetected, false);
});

test("a false state is a normal, non-blocking config value (not folded into any all-must-be-true readiness gate)", () => {
  // providerStatus() itself makes no readiness judgement; this just pins
  // that the fields exist as plain booleans callers can branch on.
  const stripe = withEnv({}, () => {});
  assert.equal(typeof stripe.domainPurchaseLive, "boolean");
  assert.equal(typeof stripe.testCheckoutEnabled, "boolean");
});

test("webhookSecretLooksValid checks shape only, never the secret value itself", () => {
  assert.equal(withEnv({}).webhookSecretLooksValid, false);
  assert.equal(withEnv({ STRIPE_WEBHOOK_SECRET: "not-a-stripe-secret" }).webhookSecretLooksValid, false);
  assert.equal(withEnv({ STRIPE_WEBHOOK_SECRET: "whsec_abc123" }).webhookSecretLooksValid, true);
  // webhookConfigured (presence-only) can be true while the shape check is
  // false -- that combination is exactly the 2026-07-22 production finding:
  // a value is set, but it does not verify real Stripe webhook deliveries.
  const misconfigured = withEnv({ STRIPE_WEBHOOK_SECRET: "sk_test_wrongvartype" });
  assert.equal(misconfigured.webhookConfigured, true);
  assert.equal(misconfigured.webhookSecretLooksValid, false);
});
