"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const stripePath = require.resolve("../lib/stripe");
const storePath = require.resolve("../lib/store");

const envKeys = [
  "STRIPE_SECRET_KEY",
  "STRIPE_TEST_CHECKOUT_ENABLED",
  "STRIPE_TEST_PROMOTION_CODE_ID",
  "GHOST_AGENCY_OWNER_EMAIL",
  "LOCAL_GROWTH_OWNER_EMAIL",
  "STRIPE_CHECKOUT_MODE",
  "STRIPE_LOCAL_GROWTH_PRICE_ID",
  "STRIPE_LOCAL_GROWTH_AMOUNT_CENTS",
  "STRIPE_LOCAL_GROWTH_CURRENCY",
];

function mockedModule(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

async function checkout(options = {}) {
  const originalStripe = require.cache[stripePath];
  const originalStore = require.cache[storePath];
  const originalFetch = global.fetch;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let request;

  process.env.STRIPE_SECRET_KEY = options.secret || "sk_test_contract";
  process.env.STRIPE_TEST_CHECKOUT_ENABLED = options.enabled === false ? "false" : "true";
  process.env.STRIPE_TEST_PROMOTION_CODE_ID = options.promo === undefined ? "promo_test_free" : options.promo;
  process.env.STRIPE_CHECKOUT_MODE = options.mode || "subscription";
  process.env.STRIPE_LOCAL_GROWTH_PRICE_ID = options.configuredPrice || "price_contracta";
  process.env.STRIPE_LOCAL_GROWTH_AMOUNT_CENTS = "19900";
  process.env.STRIPE_LOCAL_GROWTH_CURRENCY = "usd";
  process.env.GHOST_AGENCY_OWNER_EMAIL = Object.prototype.hasOwnProperty.call(options, "owner")
    ? options.owner
    : "owner@example.com";
  delete require.cache[stripePath];
  mockedModule(storePath, {
    upsertRow: async () => ({ mode: "live_write" }),
    recordEvent: async () => ({ mode: "live_write" }),
  });
  global.fetch = async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "cs_test_contract",
        url: "https://checkout.stripe.test/contract",
        mode: "subscription",
        payment_status: "unpaid",
        status: "open",
        customer_email: options.email || "owner@example.com",
        client_reference_id: "job_contract",
        metadata: {},
      }),
    };
  };

  try {
    const { createCheckoutSession } = require(stripePath);
    const prospect = {
      businessName: options.businessName || "Contract Test",
      ownerEmail: options.email || "owner@example.com",
      desiredDomain: options.desiredDomain || "example.com",
      previewProjectName: options.previewProjectName || "",
    };
    const result = await createCheckoutSession({
      job: options.partialJob
        ? { id: options.jobId || "job_contract" }
        : { id: options.jobId || "job_contract", prospect },
      prospect,
      priceId: options.priceId || "price_contracta",
      idempotencyKey: "req_contract",
      successUrl: options.successUrl,
      cancelUrl: options.cancelUrl,
      desiredDomain: options.desiredDomain,
      previewProjectName: options.previewProjectName,
    }, {
      ownerSandboxAuthorized: options.authorized !== false,
      allowRedirectOverride: options.allowRedirectOverride === true,
    });
    return { result, request };
  } finally {
    global.fetch = originalFetch;
    delete require.cache[stripePath];
    if (originalStripe) require.cache[stripePath] = originalStripe;
    if (originalStore) require.cache[storePath] = originalStore;
    else delete require.cache[storePath];
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("the server-owned test promotion applies only to the owner allowlist", async () => {
  const owner = await checkout();
  const ownerBody = new URLSearchParams(owner.request.init.body);
  assert.equal(owner.result.ownerSandboxCheckout, true);
  assert.equal(ownerBody.get("discounts[0][promotion_code]"), "promo_test_free");
  assert.equal(ownerBody.get("allow_promotion_codes"), null);
  assert.equal(ownerBody.get("payment_method_collection"), "if_required");
  assert.equal(ownerBody.get("wallet_options[link][display]"), "never");
  assert.equal(ownerBody.get("metadata[testCheckout]"), "true");
  assert.match(ownerBody.get("metadata[testPromotionHash]"), /^[a-f0-9]{64}$/);
  assert.equal(ownerBody.get("subscription_data[metadata][testCheckout]"), "true");
  assert.equal(
    ownerBody.get("subscription_data[metadata][testPromotionHash]"),
    ownerBody.get("metadata[testPromotionHash]"),
  );
  assert.equal(ownerBody.get("subscription_data[metadata][product]"), "local-growth-website-plan");
  assert.equal(ownerBody.get("metadata[checkoutPriceId]"), "price_contracta");
  assert.equal(ownerBody.get("metadata[checkoutAmountCents]"), "19900");
  assert.equal(ownerBody.get("metadata[checkoutCurrency]"), "usd");
  assert.match(ownerBody.get("metadata[checkoutContractHash]"), /^[a-f0-9]{64}$/);

  const spoofedOwner = await checkout({ authorized: false });
  assert.equal(spoofedOwner.result.ownerSandboxCheckout, false);
  const spoofedOwnerBody = new URLSearchParams(spoofedOwner.request.init.body);
  assert.equal(spoofedOwnerBody.get("discounts[0][promotion_code]"), null);
  assert.equal(spoofedOwnerBody.get("allow_promotion_codes"), "true");
  assert.equal(spoofedOwnerBody.get("metadata[testCheckout]"), null);

  const visitor = await checkout({ email: "visitor@example.com" });
  const visitorBody = new URLSearchParams(visitor.request.init.body);
  assert.equal(visitorBody.get("discounts[0][promotion_code]"), null);
  assert.equal(visitorBody.get("allow_promotion_codes"), "true");
  assert.equal(visitorBody.get("payment_method_collection"), null);
  assert.equal(visitorBody.get("metadata[testPromotionHash]"), null);
  assert.equal(visitorBody.get("subscription_data[metadata][product]"), "local-growth-website-plan");

  const missingOwner = await checkout({ owner: "" });
  const missingOwnerBody = new URLSearchParams(missingOwner.request.init.body);
  assert.equal(missingOwnerBody.get("discounts[0][promotion_code]"), null);
  assert.equal(missingOwnerBody.get("allow_promotion_codes"), "true");

  await assert.rejects(() => checkout({ mode: "payment" }), /stripe_checkout_mode_unsupported/);
});

test("checkout idempotency is stable for one request and changes with Stripe parameters", async () => {
  const first = await checkout();
  const repeated = await checkout();
  const untrustedPrice = await checkout({ priceId: "price_contractb" });
  const attemptedTrustedPrice = await checkout({ priceId: "price_contractb", allowPriceOverride: true });
  const untrustedUrl = await checkout({ successUrl: "https://example.com/changed" });
  const changedUrl = await checkout({ successUrl: "https://example.com/changed", allowRedirectOverride: true });
  const changedPromotion = await checkout({ promo: "promo_test_other" });
  assert.equal(first.request.init.headers["Idempotency-Key"], repeated.request.init.headers["Idempotency-Key"]);
  assert.equal(first.request.init.headers["Idempotency-Key"], untrustedPrice.request.init.headers["Idempotency-Key"]);
  assert.equal(first.request.init.headers["Idempotency-Key"], attemptedTrustedPrice.request.init.headers["Idempotency-Key"]);
  assert.equal(first.request.init.headers["Idempotency-Key"], untrustedUrl.request.init.headers["Idempotency-Key"]);
  assert.notEqual(first.request.init.headers["Idempotency-Key"], changedUrl.request.init.headers["Idempotency-Key"]);
  assert.notEqual(first.request.init.headers["Idempotency-Key"], changedPromotion.request.init.headers["Idempotency-Key"]);
  assert.match(first.request.init.headers["Idempotency-Key"], /^ghost_checkout_[a-f0-9]{16}$/);
});

test("Stripe-bound fields are capped and partial jobs are normalized", async () => {
  const run = await checkout({
    partialJob: true,
    jobId: `job_${"x".repeat(260)}`,
    businessName: "B".repeat(620),
    email: `${"e".repeat(260)}@example.com`,
    desiredDomain: `${"d".repeat(280)}.com`,
  });
  const body = new URLSearchParams(run.request.init.body);
  assert.equal(body.get("client_reference_id").length, 200);
  assert.equal(body.get("metadata[jobId]").length, 200);
  assert.equal(body.get("metadata[businessName]").length, 500);
  assert.equal(body.get("customer_email").length, 254);
  assert.equal(body.get("metadata[desiredDomain]").length, 253);
  assert.ok(run.request.init.headers["Idempotency-Key"].length <= 255);
});

test("test checkout fails closed for a live key or missing promotion", async () => {
  // The general live-key guard (see the next test) now fires before this
  // test-checkout-specific mismatch check ever runs for a bare sk_live key,
  // which is the correct, stricter ordering -- but the mismatch check still
  // guards the case where a live key is explicitly allowed yet the test
  // promo flag was left on, so it stays covered separately below.
  await assert.rejects(
    () => checkout({ secret: "sk_live_contract" }),
    /stripe_live_key_blocked/,
  );
  await assert.rejects(
    () => checkout({ promo: "" }),
    /stripe_test_checkout_misconfigured/,
  );
});

test("the general live-key guard blocks every caller unless explicitly allowed", async () => {
  await assert.rejects(
    () => checkout({ secret: "sk_live_contract", enabled: false }),
    /stripe_live_key_blocked/,
  );
  const originalAllow = process.env.STRIPE_ALLOW_LIVE;
  try {
    // With STRIPE_ALLOW_LIVE=true, a live key clears the general guard and
    // falls through to the more specific test-checkout mismatch check
    // (STRIPE_TEST_CHECKOUT_ENABLED defaults to true in this test's harness).
    process.env.STRIPE_ALLOW_LIVE = "true";
    await assert.rejects(
      () => checkout({ secret: "sk_live_contract" }),
      /stripe_mode_mismatch/,
    );
    // ...and with test-checkout also off, an allowed live key proceeds to
    // build a real session request.
    const allowed = await checkout({ secret: "sk_live_contract", enabled: false });
    assert.equal(allowed.result.mode, "checkout_session");
  } finally {
    if (originalAllow === undefined) delete process.env.STRIPE_ALLOW_LIVE;
    else process.env.STRIPE_ALLOW_LIVE = originalAllow;
  }
});

test("previewProjectName flows through to Stripe metadata when supplied, and is absent otherwise", async () => {
  const withProject = await checkout({ previewProjectName: "wss-example-business-preview" });
  const withProjectBody = new URLSearchParams(withProject.request.init.body);
  assert.equal(withProjectBody.get("metadata[previewProjectName]"), "wss-example-business-preview");

  const withoutProject = await checkout();
  const withoutProjectBody = new URLSearchParams(withoutProject.request.init.body);
  assert.equal(withoutProjectBody.get("metadata[previewProjectName]"), null);
});
