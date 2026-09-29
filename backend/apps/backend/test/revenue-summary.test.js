"use strict";

// ---------------------------------------------------------------------------
// test/revenue-summary.test.js — THE CONVERT STATION'S REVENUE TRUTH.
//
// /api/admin/revenue-summary exists because no code anywhere aggregated
// revenue: completions landed as events and nothing ever answered "how many
// paying clients, what MRR". These tests hold the truth law shut:
//
//   * Empty and unreadable states render null/unknown — never invented zeros
//     dressed up as a total.
//   * Every count comes only from durable rows: verified stripe_webhook
//     completions, ghost_agency_fulfillment events, dashboard_access rows.
//   * Unverified Stripe deliveries are counted nowhere. A delivery whose
//     signature did not verify is a claim, not a payment.
//   * MRR is labeled "ledger_count" (activeClients x planAmountCents) or it
//     is null with source "unknown". It is never presented as confirmed
//     subscription revenue.
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  aggregateRevenueSummary,
  createRevenueSummaryHandler,
  readAllRows,
  resolvePlanAmountCents,
  REVENUE_EVENT_TYPES,
} = require("../api/admin/revenue-summary");

const NOW = new Date("2026-09-03T12:00:00.000Z");
const TEN_DAYS_AGO = "2026-08-24T12:00:00.000Z";
const FORTY_DAYS_AGO = "2026-07-25T12:00:00.000Z";

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    raw: "",
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(payload = "") {
      this.raw = String(payload || "");
      this.body = this.raw ? JSON.parse(this.raw) : this.raw;
    },
  };
}

function request(method = "GET", token = "") {
  return {
    method,
    url: "/api/admin/revenue-summary",
    headers: token ? { "x-admin-token": token } : {},
  };
}

function webhookEvent({ id, type = "checkout.session.completed", verified = true, product = "local-growth-website-plan", at = TEN_DAYS_AGO, amountCents = null }) {
  return {
    id: `row-${id}`,
    type: "stripe_webhook",
    created_at: at,
    payload: {
      verified,
      type,
      id,
      metadata: {
        product,
        ...(amountCents !== null ? { checkoutAmountCents: String(amountCents) } : {}),
      },
    },
  };
}

function fulfillmentEvent({ session, status = "paid_checkout_completed", at = TEN_DAYS_AGO }) {
  return {
    id: `row-ful-${session}-${status}`,
    type: "ghost_agency_fulfillment",
    created_at: at,
    payload: {
      eventId: `evt_${session}`,
      jobId: `job_${session}`,
      stripeSessionId: session,
      completionStatus: status,
    },
  };
}

function clickEvent({ id, at = TEN_DAYS_AGO }) {
  return { id, type: "checkout.click", created_at: at, payload: { prospectId: "acme", source: "signed_checkout_link" } };
}

// ===========================================================================
// AGGREGATION — EMPTY AND UNREADABLE STATES TELL THE TRUTH
// ===========================================================================

test("empty ledger with an unreadable client count renders nulls and unknown — never invented numbers", () => {
  const out = aggregateRevenueSummary({ events: [], activeClients: null, env: {}, now: () => NOW });
  assert.equal(out.ok, true);
  assert.equal(out.activeClients, null);
  assert.equal(out.paidTotal, 0);
  assert.equal(out.mrr, null);
  assert.equal(out.mrrSource, "unknown");
  assert.equal(out.generatedAt, NOW.toISOString());
  assert.deepEqual(out.last30d, {
    completions: 0,
    fulfillments: 0,
    checkoutClicks: 0,
    livePaidFulfillments: 0,
    ownerSandboxFulfillments: 0,
  });
});

test("a readable but empty ledger computes zero honestly: 0 clients x plan price = 0 MRR", () => {
  const out = aggregateRevenueSummary({ events: [], activeClients: 0, env: {}, now: () => NOW });
  assert.equal(out.activeClients, 0);
  assert.equal(out.paidTotal, 0);
  assert.equal(out.mrr, 0);
  assert.equal(out.mrrSource, "ledger_count");
  assert.equal(out.planAmountCents, 19900);
  assert.equal(out.planAmountSource, "default");
});

test("MRR is exactly activeClients x planAmountCents, labeled ledger_count", () => {
  const out = aggregateRevenueSummary({ events: [], activeClients: 3, env: { STRIPE_LOCAL_GROWTH_AMOUNT_CENTS: "14900" }, now: () => NOW });
  assert.equal(out.mrr, 44700);
  assert.equal(out.mrrSource, "ledger_count");
  assert.equal(out.planAmountCents, 14900);
  assert.equal(out.planAmountSource, "env");
});

// ===========================================================================
// AGGREGATION — SEEDED LEDGER, CORRECT COUNTS
// ===========================================================================

const SEEDED_EVENTS = [
  // Two verified completions for the Local Growth product...
  webhookEvent({ id: "evt_paid_1" }),
  webhookEvent({ id: "evt_paid_2", at: FORTY_DAYS_AGO }),
  // ...plus a byte-identical replay of the first (same Stripe event id) —
  // one completion, not two.
  webhookEvent({ id: "evt_paid_1" }),
  // Unverified deliveries of the exact same shape: claims, not payments.
  webhookEvent({ id: "evt_unverified", verified: false }),
  // Verified but not a completion trigger for this product.
  webhookEvent({ id: "evt_other_type", type: "customer.subscription.deleted" }),
  webhookEvent({ id: "evt_other_product", product: "mission-control" }),
  // Fulfillments: two live paid sessions, one $0 owner-sandbox session, and
  // a duplicate fulfillment row for a session already counted.
  fulfillmentEvent({ session: "cs_live_1" }),
  fulfillmentEvent({ session: "cs_live_2", at: FORTY_DAYS_AGO }),
  fulfillmentEvent({ session: "cs_sandbox_1", status: "owner_sandbox_checkout_completed" }),
  fulfillmentEvent({ session: "cs_live_1" }),
  // Checkout clicks: three distinct, one repeat id.
  clickEvent({ id: "click-1" }),
  clickEvent({ id: "click-2", at: FORTY_DAYS_AGO }),
  clickEvent({ id: "click-3" }),
  clickEvent({ id: "click-1" }),
];

test("seeded ledger counts verified completions, deduped by Stripe event id", () => {
  const out = aggregateRevenueSummary({ events: SEEDED_EVENTS, activeClients: 2, env: {}, now: () => NOW });
  assert.equal(out.paidTotal, 2);
});

test("fulfilled sessions dedupe by stripe session and split live-paid from owner-sandbox", () => {
  const out = aggregateRevenueSummary({ events: SEEDED_EVENTS, activeClients: 2, env: {}, now: () => NOW });
  assert.equal(out.fulfilledSessions, 3);
  assert.equal(out.livePaidSessions, 2);
  assert.equal(out.ownerSandboxSessions, 1);
  // The sandbox breakout comes with an honest warning: the client count
  // itself cannot exclude $0 sandbox checkouts.
  assert.ok(out.source.warnings.some((w) => /owner-sandbox/.test(w)), JSON.stringify(out.source.warnings));
});

test("last-30d counts only events inside the window, without losing all-time totals", () => {
  const out = aggregateRevenueSummary({ events: SEEDED_EVENTS, activeClients: 2, env: {}, now: () => NOW });
  assert.deepEqual(out.last30d, {
    completions: 1,          // evt_paid_1 (evt_paid_2 is 40 days old)
    fulfillments: 2,         // cs_live_1 + cs_sandbox_1
    checkoutClicks: 2,       // click-1 + click-3 (click-2 is 40 days old)
    livePaidFulfillments: 1,
    ownerSandboxFulfillments: 1,
  });
  assert.equal(out.paidTotal, 2);
  assert.equal(out.fulfilledSessions, 3);
  assert.equal(out.checkoutClicksTotal, 3);
});

test("an event with no parseable timestamp never enters the 30-day window but is still totaled", () => {
  const events = [webhookEvent({ id: "evt_notime", at: "not-a-date" })];
  const out = aggregateRevenueSummary({ events, activeClients: 0, env: {}, now: () => NOW });
  assert.equal(out.paidTotal, 1);
  assert.equal(out.last30d.completions, 0);
});

// ===========================================================================
// AGGREGATION — THE PLAN PRICE IS SOURCED HONESTLY
// ===========================================================================

test("plan amount precedence: env, then the single observed amount, then the repo default", () => {
  const observed = [webhookEvent({ id: "evt_a", amountCents: 14900 })];

  const fromEnv = resolvePlanAmountCents(observed, { STRIPE_LOCAL_GROWTH_AMOUNT_CENTS: "9900" });
  assert.deepEqual({ cents: fromEnv.cents, source: fromEnv.source }, { cents: 9900, source: "env" });

  const fromLedger = resolvePlanAmountCents(observed, {});
  assert.deepEqual({ cents: fromLedger.cents, source: fromLedger.source }, { cents: 14900, source: "observed" });

  const fromDefault = resolvePlanAmountCents([], {});
  assert.deepEqual({ cents: fromDefault.cents, source: fromDefault.source }, { cents: 19900, source: "default" });
});

test("when the ledger observed more than one amount, no single observed number is picked — default stands, with a warning", () => {
  const events = [
    webhookEvent({ id: "evt_old_price", amountCents: 19900, at: FORTY_DAYS_AGO }),
    webhookEvent({ id: "evt_new_price", amountCents: 14900 }),
  ];
  const out = aggregateRevenueSummary({ events, activeClients: 1, env: {}, now: () => NOW });
  assert.equal(out.planAmountSource, "default");
  assert.equal(out.planAmountCents, 19900);
  assert.ok(out.source.warnings.some((w) => /more than one checkout amount/.test(w)), JSON.stringify(out.source.warnings));
});

test("unverified stripe events contribute no observed amount either", () => {
  const events = [webhookEvent({ id: "evt_unverified", verified: false, amountCents: 14900 })];
  const out = resolvePlanAmountCents(events, {});
  assert.equal(out.source, "default");
});

// ===========================================================================
// HANDLER — GUARDS, SOURCE TRUTH, AND THE RESPONSE CONTRACT
// ===========================================================================

test("revenue-summary is GET-only and authenticates before either source is read", async (t) => {
  const prior = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "revenue-truth-token";
  t.after(() => {
    if (prior === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = prior;
  });

  const reads = [];
  const handler = createRevenueSummaryHandler({
    select: async (table, query) => {
      reads.push({ table, query });
      return { ok: true, data: [] };
    },
    now: () => NOW,
  });

  const post = fakeRes();
  await handler(request("POST", "revenue-truth-token"), post);
  assert.equal(post.statusCode, 405);
  assert.equal(reads.length, 0, "a rejected write method reached the store");

  const missing = fakeRes();
  await handler(request("GET"), missing);
  assert.equal(missing.statusCode, 401);
  assert.equal(reads.length, 0, "an unauthenticated request read the store");

  const wrong = fakeRes();
  await handler(request("GET", "wrong-token"), wrong);
  assert.equal(wrong.statusCode, 401);
  assert.equal(reads.length, 0);

  const ok = fakeRes();
  await handler(request("GET", "revenue-truth-token"), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.generatedAt, NOW.toISOString());
  assert.deepEqual(reads.map(({ table }) => table).sort(), ["ghost_agency_dashboard_access", "ghost_agency_events"]);
});

test("source queries project fields and filter the revenue event types server-side", async () => {
  const reads = [];
  const handler = createRevenueSummaryHandler({
    methodGuard: () => true,
    requireAdmin: () => true,
    select: async (table, query) => {
      reads.push({ table, query });
      return { ok: true, data: [] };
    },
    now: () => NOW,
  });
  const res = fakeRes();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);

  assert.ok(reads.every(({ query }) => !/(?:^|[?&])select=\*/.test(query)), "source queries must project fields, never select=*");
  const eventRead = reads.find(({ table }) => table === "ghost_agency_events");
  assert.equal(eventRead.query, "select=id,type,created_at,payload&type=in.(stripe_webhook,ghost_agency_fulfillment,checkout.click)&order=created_at.asc,id.asc&limit=1000&offset=0");
  assert.deepEqual(REVENUE_EVENT_TYPES, ["stripe_webhook", "ghost_agency_fulfillment", "checkout.click"]);
  const accessRead = reads.find(({ table }) => table === "ghost_agency_dashboard_access");
  assert.match(accessRead.query, /select=job_id/);
  assert.match(accessRead.query, /order=job_id\.asc/);
});

test("a live ledger flows through the handler to the truthful payload shape", async () => {
  const handler = createRevenueSummaryHandler({
    methodGuard: () => true,
    requireAdmin: () => true,
    select: async (table) => {
      if (table === "ghost_agency_events") {
        return {
          ok: true,
          data: [
            webhookEvent({ id: "evt_paid_1", amountCents: 14900 }),
            webhookEvent({ id: "evt_unverified", verified: false }),
            fulfillmentEvent({ session: "cs_live_1" }),
            clickEvent({ id: "click-1" }),
          ],
        };
      }
      return { ok: true, data: [{ job_id: "job_a" }, { job_id: "job_b" }] };
    },
    env: {},
    now: () => NOW,
  });
  const res = fakeRes();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.activeClients, 2);
  assert.equal(res.body.paidTotal, 1);
  assert.equal(res.body.mrr, 29800);
  assert.equal(res.body.mrrSource, "ledger_count");
  assert.equal(res.body.planAmountCents, 14900);
  assert.equal(res.body.planAmountSource, "observed");
  assert.equal(res.body.last30d.completions, 1);
  assert.equal(res.body.last30d.fulfillments, 1);
  assert.equal(res.body.last30d.checkoutClicks, 1);
  assert.equal(typeof res.body.generatedAt, "string");
});

test("source failures return 503 and never masquerade as an empty ledger", async () => {
  const handler = createRevenueSummaryHandler({
    methodGuard: () => true,
    requireAdmin: () => true,
    select: async () => ({ ok: false, data: [] }),
  });
  const res = fakeRes();
  await handler(request(), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: "revenue_source_unavailable" });
});

test("a thrown source read is a 503, not a crash and not a zeroed total", async () => {
  const handler = createRevenueSummaryHandler({
    methodGuard: () => true,
    requireAdmin: () => true,
    select: async () => {
      throw new Error("network gone");
    },
  });
  const res = fakeRes();
  await handler(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "revenue_source_unavailable");
});

test("reaching the row cap is a 413 refusal, never a truncated total presented as complete", async () => {
  // Direct readAllRows contract: the cap is honored with an error.
  await assert.rejects(
    readAllRows("ghost_agency_events", {
      select: async () => ({ ok: true, data: [{ id: "a" }, { id: "b" }] }),
      selectFields: "id",
      pageSize: 2,
      maxRows: 4,
    }),
    (error) => error.code === "revenue_source_limit" && error.statusCode === 413,
  );

  // And through the handler: an endlessly full source is refused, not summed.
  const handler = createRevenueSummaryHandler({
    methodGuard: () => true,
    requireAdmin: () => true,
    select: async (table, query) => {
      const limit = Number(/limit=(\d+)/.exec(query)?.[1] || 0);
      return { ok: true, data: Array.from({ length: limit }, (_, i) => ({ id: `row-${i}` })) };
    },
  });
  const res = fakeRes();
  await handler(request(), res);
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { ok: false, error: "revenue_source_limit" });
});
