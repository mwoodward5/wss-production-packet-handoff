"use strict";

// test/domain-spend-cap.test.js — MONEY GATES. Every refusal path, no network.
//
// Context: on 2026-07-31 production was found with DOMAIN_PURCHASE_ENABLED=true,
// a live Stripe key, STRIPE_ALLOW_LIVE on, all DOMAIN_CONTACT_* set — and NO
// ceiling anywhere in lib/domains.js. The flag was the only thing between an
// automated pipeline and an uncapped registrar API, and it was open.
//
// These lock the properties that make that safe regardless of the flag:
//   · unset caps REFUSE (an unset limit is not "unlimited")
//   · an unknown price REFUSES (never pay whatever is quoted)
//   · per-order, daily and monthly ceilings each block independently
//   · a purchase requires an explicit, admin-attributed approval row
// Nothing here touches the network or Vercel.

const test = require("node:test");
const assert = require("node:assert");

const { assertWithinCaps, capsFromEnv, purchaseApproved } = require("../lib/domains");

const CAPS = { DOMAIN_MAX_ORDER_USD: "50", DOMAIN_DAILY_CAP_USD: "200", DOMAIN_MONTHLY_CAP_USD: "1000" };
const NOW = () => Date.UTC(2026, 6, 31, 12, 0, 0);
/** Fake ledger: rows are {price, daysAgo}. */
const ledger = (rows = []) => ({
  selectRows: async (_t, { filter }) => {
    const m = /created_at=gte\.([^&]+)/.exec(filter || "");
    const from = m ? Date.parse(decodeURIComponent(m[1])) : 0;
    return {
      rows: rows
        .filter((r) => NOW() - r.daysAgo * 864e5 >= from)
        .map((r) => ({ payload: { purchase: { price: r.price } } })),
    };
  },
});

test("caps parse only positive numbers; junk reads as unset", () => {
  const c = capsFromEnv({ DOMAIN_MAX_ORDER_USD: "50", DOMAIN_DAILY_CAP_USD: "0", DOMAIN_MONTHLY_CAP_USD: "abc" });
  assert.strictEqual(c.perOrder, 50);
  assert.strictEqual(c.daily, null, "zero is not a cap");
  assert.strictEqual(c.monthly, null, "unparseable is not a cap");
});

test("REFUSES when any cap is unset — an unset limit is never 'unlimited'", async () => {
  for (const env of [
    {},
    { DOMAIN_MAX_ORDER_USD: "50" },
    { DOMAIN_MAX_ORDER_USD: "50", DOMAIN_DAILY_CAP_USD: "200" },
    { ...CAPS, DOMAIN_MONTHLY_CAP_USD: "" },
  ]) {
    const r = await assertWithinCaps(20, { env, now: NOW, ...ledger() });
    assert.strictEqual(r.ok, false, `did not refuse with env ${JSON.stringify(env)}`);
    assert.strictEqual(r.reason, "spend_caps_unset");
    assert.ok(r.missing.length > 0, "should name which caps are missing");
  }
});

test("REFUSES an unknown or nonsense price — never pay whatever is quoted", async () => {
  for (const price of [undefined, null, "", 0, -5, "abc", NaN]) {
    const r = await assertWithinCaps(price, { env: CAPS, now: NOW, ...ledger() });
    assert.strictEqual(r.ok, false, `accepted price ${JSON.stringify(price)}`);
    assert.strictEqual(r.reason, "price_unknown");
  }
});

test("per-order ceiling blocks independently", async () => {
  const under = await assertWithinCaps(49.99, { env: CAPS, now: NOW, ...ledger() });
  assert.strictEqual(under.ok, true);

  const over = await assertWithinCaps(50.01, { env: CAPS, now: NOW, ...ledger() });
  assert.strictEqual(over.ok, false);
  assert.strictEqual(over.reason, "over_per_order_cap");
  assert.strictEqual(over.cap, 50);
});

test("daily ceiling counts only the last 24h and blocks on the sum", async () => {
  // 180 already spent today; a 25 order would reach 205 against a 200 cap.
  const spentToday = ledger([{ price: 100, daysAgo: 0.2 }, { price: 80, daysAgo: 0.5 }]);
  const r = await assertWithinCaps(25, { env: CAPS, now: NOW, ...spentToday });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "over_daily_cap");
  assert.strictEqual(r.spent, 180);

  // The same 25 fits when the prior spend is older than the window.
  const spentLastWeek = ledger([{ price: 100, daysAgo: 8 }, { price: 80, daysAgo: 9 }]);
  const ok = await assertWithinCaps(25, { env: CAPS, now: NOW, ...spentLastWeek });
  assert.strictEqual(ok.ok, true, "yesterday's spend must not count against today");
  assert.strictEqual(ok.spentDay, 0);
});

test("monthly ceiling blocks even when the day is clear", async () => {
  // Nothing today, but 990 across the month; a 20 order breaches 1000.
  const month = ledger([{ price: 500, daysAgo: 20 }, { price: 490, daysAgo: 10 }]);
  const r = await assertWithinCaps(20, { env: CAPS, now: NOW, ...month });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "over_monthly_cap");
  assert.strictEqual(r.spent, 990);
});

test("a clean order passes and reports what it counted", async () => {
  const r = await assertWithinCaps(18, { env: CAPS, now: NOW, ...ledger([{ price: 12, daysAgo: 3 }]) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.price, 18);
  assert.strictEqual(r.spentDay, 0, "3 days ago is outside the 24h window");
  assert.strictEqual(r.spentMonth, 12);
});

test("approval requires an explicit, ATTRIBUTED approval row", async () => {
  const withRow = (row) => ({ selectRows: async () => ({ rows: row ? [row] : [] }) });

  assert.strictEqual(await purchaseApproved("x.com", "job1", withRow(null)), false, "no row = not approved");
  assert.strictEqual(await purchaseApproved("x.com", "job1", withRow({ status: "pending" })), false);
  assert.strictEqual(await purchaseApproved("x.com", "job1", withRow({ status: "dry_run_only" })), false);
  // status approved but nobody attributed — refuse. "Approved by whom?" must have an answer.
  assert.strictEqual(await purchaseApproved("x.com", "job1", withRow({ status: "approved" })), false);
  assert.strictEqual(await purchaseApproved("x.com", "job1", withRow({ status: "approved", approved_by: "" })), false);

  assert.strictEqual(
    await purchaseApproved("x.com", "job1", withRow({ status: "approved", approved_by: "owner@wss-ai.com" })),
    true,
  );
});

test("approval refuses without BOTH a domain and a job id", async () => {
  const approved = { selectRows: async () => ({ rows: [{ status: "approved", approved_by: "owner" }] }) };
  assert.strictEqual(await purchaseApproved("", "job1", approved), false);
  assert.strictEqual(await purchaseApproved("x.com", "", approved), false);
  assert.strictEqual(await purchaseApproved("x.com", undefined, approved), false);
});

test("a ledger read failure does not silently grant headroom", async () => {
  // If the spend query throws, spentSince falls back to {rows:[]} = 0 spent.
  // That is safe ONLY because the per-order cap still applies; assert it does.
  const broken = { selectRows: async () => { throw new Error("db down"); } };
  const over = await assertWithinCaps(500, { env: CAPS, now: NOW, ...broken });
  assert.strictEqual(over.ok, false);
  assert.strictEqual(over.reason, "over_per_order_cap", "per-order cap must hold when the ledger is unreadable");
});
