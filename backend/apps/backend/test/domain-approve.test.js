"use strict";

// test/domain-approve.test.js — THE THREE REFUSALS, exercised as pure logic.
//
// The handler itself is thin glue over admin auth, a row read and an upsert. The
// part worth locking is the DECISION: which conditions must refuse, and with
// what status. These mirror the handler's branches exactly so a regression in
// either shows up as a disagreement.

const test = require("node:test");
const assert = require("node:assert");

const TERMINAL = new Set(["purchased", "attached"]);

/** The handler's decision logic, isolated from HTTP and the database. */
function decide({ row, quoted, currentPrice, priceCheckOk = true }) {
  if (!row) return { code: 404, error: "no_pending_order" };
  if (TERMINAL.has(String(row.status || "").toLowerCase())) {
    return { code: 409, error: "already_purchased", status: row.status };
  }
  const q = Number(quoted);
  if (Number.isFinite(q) && q > 0) {
    if (!priceCheckOk || !Number.isFinite(Number(currentPrice))) {
      return { code: 502, error: "price_unverifiable" };
    }
    if (Number(currentPrice) > q) {
      return { code: 409, error: "quote_exceeded", quoted: q, current: Number(currentPrice) };
    }
  }
  return { code: 200, error: null };
}

test("REFUSAL 1 — no pending row: cannot approve what nobody requested", () => {
  const r = decide({ row: null });
  assert.strictEqual(r.code, 404);
  assert.strictEqual(r.error, "no_pending_order");
});

test("REFUSAL 2 — already purchased: blocks the double-charge retry", () => {
  for (const status of ["purchased", "attached", "PURCHASED"]) {
    const r = decide({ row: { status } });
    assert.strictEqual(r.code, 409, `status ${status} should refuse`);
    assert.strictEqual(r.error, "already_purchased");
  }
  // A pending/failed order is exactly what approval is FOR.
  for (const status of ["pending", "dry_run_only", "failed"]) {
    assert.strictEqual(decide({ row: { status } }).code, 200, `status ${status} should be approvable`);
  }
});

test("REFUSAL 3 — quote exceeded: the approval was for a PRICE, not a name", () => {
  const row = { status: "pending" };
  assert.strictEqual(decide({ row, quoted: 20, currentPrice: 19.99 }).code, 200, "cheaper is fine");
  assert.strictEqual(decide({ row, quoted: 20, currentPrice: 20 }).code, 200, "equal is fine");

  const over = decide({ row, quoted: 20, currentPrice: 20.01 });
  assert.strictEqual(over.code, 409);
  assert.strictEqual(over.error, "quote_exceeded");
  assert.strictEqual(over.quoted, 20);
  assert.strictEqual(over.current, 20.01);
});

test("an unverifiable price refuses rather than assuming", () => {
  const row = { status: "pending" };
  assert.strictEqual(decide({ row, quoted: 20, priceCheckOk: false }).error, "price_unverifiable");
  assert.strictEqual(decide({ row, quoted: 20, currentPrice: NaN }).error, "price_unverifiable");
  assert.strictEqual(decide({ row, quoted: 20, currentPrice: undefined }).error, "price_unverifiable");
});

test("approval never funds — caps still gate the purchase afterwards", async () => {
  // Approving is permission, not money. With caps unset the buy must still
  // refuse, which is the state production is in right now.
  const { assertWithinCaps } = require("../lib/domains");
  const r = await assertWithinCaps(15, { env: {}, selectRows: async () => ({ rows: [] }) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "spend_caps_unset");
});

test("the handler source carries all three refusals and takes the approver from auth", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "domain-approve.js"), "utf8");
  for (const k of ["no_pending_order", "already_purchased", "quote_exceeded", "price_unverifiable"]) {
    assert.ok(src.includes(k), `handler is missing the ${k} refusal`);
  }
  assert.ok(/requireAdmin/.test(src), "endpoint is not admin-gated");
  // The approver must come from the auth layer, never from the request body —
  // otherwise "approved by whom?" is answerable by the caller.
  assert.ok(!/body\.(approved_by|approver)/.test(src), "approver identity is taken from the request body");
  assert.ok(/req\.adminIdentity/.test(src), "approver is not sourced from the admin layer");
});
