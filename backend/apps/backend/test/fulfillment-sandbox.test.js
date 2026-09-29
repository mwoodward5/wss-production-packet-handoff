"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const fulfillmentPath = require.resolve("../lib/fulfillment");
const modulePaths = {
  adapters: require.resolve("../lib/adapters"),
  email: require.resolve("../lib/email"),
  packets: require.resolve("../lib/packets"),
  store: require.resolve("../lib/store"),
  domains: require.resolve("../lib/domains"),
  dashboard: require.resolve("../lib/dashboard-link"),
};

function mockedModule(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function valueFromFilter(value = "") {
  return String(value).replace(/^eq\./, "");
}

function ownerEvent(overrides = {}) {
  const { testPromotionHash } = require("../lib/stripe");
  return {
    id: overrides.eventId || "evt_test_owner",
    created: 1784428800,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: overrides.sessionId || "cs_test_owner",
        created: 1784428800,
        mode: "subscription",
        payment_status: "no_payment_required",
        status: "complete",
        customer_email: "owner@example.com",
        subscription: "sub_test_owner",
        amount_subtotal: 19900,
        amount_total: 0,
        currency: "usd",
        metadata: {
          product: "local-growth-website-plan",
          testCheckout: "true",
          testPromotionHash: testPromotionHash(),
          jobId: overrides.jobId || "job_owner_sandbox",
          businessName: "Shine Pros Detailing",
          desiredDomain: "must-not-purchase.example",
        },
      },
    },
  };
}

async function withHarness(run) {
  const paths = [fulfillmentPath, ...Object.values(modulePaths)];
  const originals = new Map(paths.map((path) => [path, require.cache[path]]));
  const previousFetch = global.fetch;
  const envKeys = [
    "GHOST_AGENCY_OWNER_EMAIL",
    "STRIPE_SECRET_KEY",
    "STRIPE_TEST_CHECKOUT_ENABLED",
    "STRIPE_TEST_PROMOTION_CODE_ID",
    "CONNECT_APP_TOKEN",
    "RESEND_API_KEY",
    "GHOST_AGENCY_RESEND_FROM",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const state = {
    orders: new Map(),
    queue: new Map(),
    jobs: new Map(),
    prospects: new Map(),
    upserts: [],
    calls: { build: 0, zapier: 0, domain: 0, email: 0 },
    resendBodies: [],
    activationInputs: [],
    orderInsertOverride: null,
    failFinalOrderOnce: false,
    failedFinalOrder: false,
  };

  Object.assign(process.env, {
    GHOST_AGENCY_OWNER_EMAIL: "owner@example.com",
    STRIPE_SECRET_KEY: "sk_test_contract",
    STRIPE_TEST_CHECKOUT_ENABLED: "true",
    STRIPE_TEST_PROMOTION_CODE_ID: "promo_test_free",
    CONNECT_APP_TOKEN: "connect-contract-secret",
    RESEND_API_KEY: "re_contract",
    GHOST_AGENCY_RESEND_FROM: "WSS Labs <hello@wss-ai.com>",
    SUPABASE_URL: "https://supabase.contract.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-contract",
  });

  delete require.cache[fulfillmentPath];
  mockedModule(modulePaths.adapters, {
    dispatchWoodwardLabsBuildTicket: async () => {
      state.calls.build += 1;
      return { mode: "handoff_packet", configured: false };
    },
    dispatchZapier: async () => {
      state.calls.zapier += 1;
      return { mode: "dry_run", configured: false };
    },
  });
  mockedModule(modulePaths.email, {
    buildActivationEmail: (input) => {
      state.activationInputs.push(input);
      return {
        subject: "Test activation",
        text: `PIN ${input.pin} ${input.magicLink}`,
        html: `<p>${input.pin} ${input.magicLink}</p>`,
      };
    },
  });
  mockedModule(modulePaths.packets, {
    buildCanonicalJob: ({ jobId, prospect }) => ({ id: jobId, prospect }),
  });
  mockedModule(modulePaths.domains, {
    fulfillDomainForJob: async () => {
      state.calls.domain += 1;
      return { ok: true, dryRun: true };
    },
  });
  mockedModule(modulePaths.dashboard, {
    hashPin: (pin) => `hash:${pin}`,
    slugify: () => "shine-pros",
  });

  function queueKey(row) {
    return `${row.job_id}|${row.delivery_type}`;
  }

  mockedModule(modulePaths.store, {
    insertRow: async (table, row) => {
      const timestamp = row.updated_at || new Date().toISOString();
      if (table === "ghost_agency_orders") {
        if (state.orderInsertOverride) return state.orderInsertOverride;
        if (state.orders.has(row.stripe_session_id)) {
          return {
            mode: "live_write_failed",
            status: 409,
            error: {
              code: "23505",
              message: 'duplicate key violates constraint "ghost_agency_orders_stripe_session_id_key"',
              details: `Key (stripe_session_id)=(${row.stripe_session_id}) already exists.`,
            },
          };
        }
        const stored = { ...row, updated_at: timestamp };
        state.orders.set(row.stripe_session_id, stored);
        return { mode: "live_write", row: [stored] };
      }
      if (table === "ghost_agency_delivery_queue") {
        const key = queueKey(row);
        if (state.queue.has(key)) {
          return {
            mode: "live_write_failed",
            status: 409,
            error: {
              code: "23505",
              message: 'duplicate key violates constraint "ghost_agency_delivery_queue_job_id_delivery_type_key"',
              details: `Key (job_id, delivery_type)=(${row.job_id}, ${row.delivery_type}) already exists.`,
            },
          };
        }
        const stored = { ...row, updated_at: timestamp };
        state.queue.set(key, stored);
        return { mode: "live_write", row: [stored] };
      }
      return { mode: "live_write", row: [{ ...row }] };
    },
    select: async (table, query) => {
      const params = new URLSearchParams(query);
      let row = null;
      if (table === "ghost_agency_orders") {
        row = state.orders.get(valueFromFilter(params.get("stripe_session_id"))) || null;
      } else if (table === "ghost_agency_delivery_queue") {
        row = state.queue.get(`${valueFromFilter(params.get("job_id"))}|${valueFromFilter(params.get("delivery_type"))}`) || null;
      } else if (table === "ghost_agency_jobs") {
        row = state.jobs.get(valueFromFilter(params.get("job_id"))) || null;
      } else if (table === "ghost_agency_prospects") {
        row = state.prospects.get(valueFromFilter(params.get("prospect_id"))) || null;
      }
      return { ok: true, mode: "live_select", data: row ? [row] : [] };
    },
    recordEvent: async () => ({ mode: "live_write", row: [{ id: "event" }] }),
    upsertRow: async (table, row) => {
      state.upserts.push({ table, row });
      if (
        state.failFinalOrderOnce
        && !state.failedFinalOrder
        && table === "ghost_agency_orders"
        && /_checkout_completed$/.test(row.status)
      ) {
        state.failedFinalOrder = true;
        return { mode: "live_upsert_failed", status: 503, error: { code: "provider_unavailable" } };
      }
      let stored = { ...row };
      if (table === "ghost_agency_orders") {
        stored = { ...(state.orders.get(row.stripe_session_id) || {}), ...row };
        state.orders.set(row.stripe_session_id, stored);
      } else if (table === "ghost_agency_delivery_queue") {
        const key = queueKey(row);
        stored = { ...(state.queue.get(key) || {}), ...row };
        state.queue.set(key, stored);
      } else if (table === "ghost_agency_jobs") {
        stored = { ...(state.jobs.get(row.job_id) || {}), ...row };
        state.jobs.set(row.job_id, stored);
      }
      return { mode: "live_upsert", row: [stored] };
    },
  });

  global.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target === "https://api.resend.com/emails") {
      state.calls.email += 1;
      state.resendBodies.push({ body: init.body, key: init.headers["Idempotency-Key"] });
      return { ok: true, status: 200, json: async () => ({ id: "email_contract" }) };
    }
    const parsed = new URL(target);
    assert.equal(parsed.pathname, "/rest/v1/ghost_agency_delivery_queue");
    assert.equal(init.method, "PATCH");
    const key = `${valueFromFilter(parsed.searchParams.get("job_id"))}|${valueFromFilter(parsed.searchParams.get("delivery_type"))}`;
    const current = state.queue.get(key);
    const expectedStatus = valueFromFilter(parsed.searchParams.get("status"));
    const expectedLease = valueFromFilter(parsed.searchParams.get("payload->>leaseToken"));
    if (!current || current.status !== expectedStatus || current.payload?.leaseToken !== expectedLease) {
      return { ok: true, status: 200, json: async () => [] };
    }
    const patch = JSON.parse(init.body);
    const stored = { ...current, ...patch };
    state.queue.set(key, stored);
    return { ok: true, status: 200, json: async () => [stored] };
  };

  try {
    delete require.cache[fulfillmentPath];
    const fulfillment = require(fulfillmentPath);
    await run({ ...fulfillment, state });
  } finally {
    global.fetch = previousFetch;
    delete require.cache[fulfillmentPath];
    for (const [path, original] of originals) {
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("owner sandbox sends one idempotent activation and suppresses production dispatches", async () => {
  await withHarness(async ({ fulfillCheckoutSession, state }) => {
    const event = ownerEvent();
    const result = await fulfillCheckoutSession(event);
    assert.equal(result.mode, "owner_sandbox_checkout_completed");
    assert.deepEqual(state.calls, { build: 0, zapier: 0, domain: 0, email: 1 });
    assert.equal(state.resendBodies[0].key, "ghost-activation/cs_test_owner");
    assert.equal(result.deliveryQueue.row[0].status, "test_suppressed");
    assert.equal(result.domainFulfillment.reason, "owner_sandbox_checkout");

    const replay = await fulfillCheckoutSession({ ...event, id: "evt_owner_replay" });
    assert.equal(replay.mode, "checkout_fulfillment_completed_replay");
    assert.deepEqual(state.calls, { build: 0, zapier: 0, domain: 0, email: 1 });
  });
});

test("activation restores the durable truth packet and passes its approved HTTPS business logo", async () => {
  await withHarness(async ({ fulfillCheckoutSession, state }) => {
    const logoUrl = "https://assets.example.com/shine-pros-logo.svg";
    state.jobs.set("job_owner_sandbox", {
      job_id: "job_owner_sandbox",
      payload: {
        id: "job_owner_sandbox",
        prospect: {
          id: "shine-pros-detailing",
          businessName: "Shine Pros Detailing",
          ownerEmail: "owner@example.com",
        },
        packets: {
          truth: {
            intakeGenie: {
              assets: [
                { kind: "logo", url: "http://unsafe.example.com/logo.svg", approved: true },
                { kind: "logo", url: "https://assets.example.com/rejected.svg", approved: false },
                { kind: "logo", url: logoUrl, approved: true },
              ],
            },
          },
        },
      },
    });

    const result = await fulfillCheckoutSession(ownerEvent());
    assert.equal(result.mode, "owner_sandbox_checkout_completed");
    assert.equal(state.activationInputs.length, 1);
    assert.equal(state.activationInputs[0].businessLogoUrl, logoUrl);
    assert.equal(
      state.jobs.get("job_owner_sandbox").payload.packets.truth.intakeGenie.assets[2].url,
      logoUrl,
      "the in-progress fulfillment upsert must preserve the durable truth packet",
    );
  });
});

test("activation can recover a safe logo from the persisted prospect truth packet", async () => {
  await withHarness(async ({ fulfillCheckoutSession, state }) => {
    const logoUrl = "https://assets.example.com/prospect-logo.png";
    state.jobs.set("job_owner_sandbox", {
      job_id: "job_owner_sandbox",
      payload: {
        id: "job_owner_sandbox",
        prospect: {
          id: "shine-pros-detailing",
          businessName: "Shine Pros Detailing",
          ownerEmail: "owner@example.com",
        },
      },
    });
    state.prospects.set("shine-pros-detailing", {
      prospect_id: "shine-pros-detailing",
      record: {
        truth_packet: {
          intakeGenie: {
            assets: [{ kind: "logo", url: logoUrl, approved: true }],
          },
        },
      },
    });

    await fulfillCheckoutSession(ownerEvent());
    assert.equal(state.activationInputs[0].businessLogoUrl, logoUrl);
  });
});

test("an incomplete order resumes from durable steps without resending activation", async () => {
  await withHarness(async ({ fulfillCheckoutSession, state }) => {
    state.failFinalOrderOnce = true;
    const event = ownerEvent();
    await assert.rejects(() => fulfillCheckoutSession(event), /fulfillment_order_completion_failed/);
    assert.equal(state.calls.email, 1);
    assert.equal(state.orders.get("cs_test_owner").status, "fulfillment_in_progress");
    assert.equal(state.queue.get("job_owner_sandbox|fulfillment_activation_email").status, "succeeded");

    const resumed = await fulfillCheckoutSession({ ...event, id: "evt_owner_retry" });
    assert.equal(resumed.mode, "owner_sandbox_checkout_completed");
    assert.equal(state.calls.email, 1);
    assert.equal(state.orders.get("cs_test_owner").status, "owner_sandbox_checkout_completed");
  });
});

test("only an HTTP 409 carrying Postgres 23505 is accepted as a duplicate claim", async () => {
  await withHarness(async ({ fulfillCheckoutSession, state }) => {
    state.orderInsertOverride = { mode: "live_write_failed", status: 409, error: {} };
    await assert.rejects(() => fulfillCheckoutSession(ownerEvent()), /fulfillment_claim_failed/);
    state.orderInsertOverride = { mode: "live_write_failed", status: 400, error: { code: "23505" } };
    await assert.rejects(() => fulfillCheckoutSession(ownerEvent()), /fulfillment_claim_failed/);
    state.orderInsertOverride = {
      mode: "live_write_failed",
      status: 409,
      error: { code: "23505", message: 'duplicate key violates constraint "some_other_unique_key"' },
    };
    await assert.rejects(() => fulfillCheckoutSession(ownerEvent()), /fulfillment_claim_failed/);
    assert.equal(state.calls.email, 0);
  });
});
