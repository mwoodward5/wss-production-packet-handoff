"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { handleCommerceStripeEvent } = require("../lib/mission-control-commerce");
const { handleCustomerStripeEvent } = require("../lib/mission-control-customer");

test("local-growth subscription events never enter Mission Control commerce", async () => {
  const event = {
    type: "customer.subscription.created",
    data: {
      object: {
        id: "sub_local_growth_contract",
        customer: "cus_local_growth_contract",
        metadata: {
          product: "local-growth-website-plan",
          testCheckout: "true",
        },
      },
    },
  };

  assert.deepEqual(await handleCommerceStripeEvent(event), {
    mode: "not_answercrew_subscription",
    product: "local-growth-website-plan",
  });
  assert.deepEqual(await handleCustomerStripeEvent(event), {
    mode: "not_answercrew_customer_subscription",
  });

  const productless = {
    ...event,
    data: {
      object: {
        ...event.data.object,
        metadata: {},
      },
    },
  };
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await assert.rejects(() => handleCommerceStripeEvent(productless), /SUPABASE_URL is not configured/);
    await assert.rejects(() => handleCustomerStripeEvent(productless), /SUPABASE_URL is not configured/);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("productless legacy subscriptions update only an exact stored subscription id", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = "https://legacy-contract.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service_contract";

  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop();
    const requestedId = String(url.searchParams.get("stripe_subscription_id") || "").replace(/^eq\./, "");
    if ((init.method || "GET") === "GET") {
      const matchingTable = table === "subscriptions" && requestedId === "sub_legacy_commerce"
        || table === "answercrew_customer_subscriptions" && requestedId === "sub_legacy_customer";
      return {
        ok: true,
        status: 200,
        json: async () => matchingTable ? [{
          account_id: table === "subscriptions" ? "acct_legacy_commerce" : "acct_legacy_customer",
          stripe_subscription_id: requestedId,
        }] : [],
      };
    }
    const body = init.body ? JSON.parse(init.body) : {};
    return { ok: true, status: 200, json: async () => [body] };
  };

  try {
    const commerce = await handleCommerceStripeEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_legacy_commerce", customer: "cus_legacy", status: "active", metadata: {} } },
    });
    assert.equal(commerce.mode, "subscription_upserted");
    assert.equal(commerce.account_id, "acct_legacy_commerce");

    const customer = await handleCustomerStripeEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_legacy_customer", customer: "cus_legacy", status: "active", metadata: {} } },
    });
    assert.equal(customer.mode, "customer_subscription_upserted");
    assert.equal(customer.account_id, "acct_legacy_customer");

    assert.deepEqual(await handleCommerceStripeEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown", customer: "cus_legacy", status: "active", metadata: {} } },
    }), { mode: "not_answercrew_subscription", product: "" });
    assert.deepEqual(await handleCustomerStripeEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_unknown", customer: "cus_legacy", status: "active", metadata: {} } },
    }), { mode: "not_answercrew_customer_subscription" });
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
