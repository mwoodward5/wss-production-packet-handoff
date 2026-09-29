"use strict";

// test/dashboard-login-shadowing.test.js — the documented shadowing hazard.
//
// dashboard-login used to resolve email+PIN with
// `owner_email=eq.<email>&limit=1` and NO ordering, then verify that ONE row's
// PIN. When an email owns both a prospect-preview row (job_id "prospect-…") and
// a later PAID row (job_id = checkout id), the database was free to return the
// prospect row first. A customer typing their real activation PIN then failed
// verification against the wrong row and was locked out of the account they paid
// for — or, if they typed the prospect PIN, was pinned to the prospect scope.
//
// pickAccessRow closes this by considering EVERY row for the email, keeping only
// those whose PIN verifies, and returning the authoritative one. These cases
// fail against the old data[0] + single verify: with the prospect row first and
// the paid PIN entered, the old path returns null (a lockout).

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPin, pickAccessRow } = require("../lib/dashboard-link");

const PROSPECT_PIN = "111111";
const PAID_PIN = "222222";

const prospectRow = {
  job_id: "prospect-acme-plumbing",
  owner_email: "owner@acme.com",
  site_slug: "acme-plumbing-preview",
  pin_hash: hashPin(PROSPECT_PIN),
  last_login_at: "2026-07-01T00:00:00Z",
};
const paidRow = {
  job_id: "cs_test_9f3a",
  owner_email: "owner@acme.com",
  site_slug: "acme-plumbing",
  pin_hash: hashPin(PAID_PIN),
  last_login_at: "2026-08-01T00:00:00Z",
};

test("the paid PIN resolves the paid row even when the prospect row is returned first", () => {
  // [prospect, paid] is exactly the order an unordered limit=1 could surface.
  const row = pickAccessRow([prospectRow, paidRow], PAID_PIN);
  assert.ok(row, "the paid customer must not be locked out by a shadowing prospect row");
  assert.equal(row.job_id, "cs_test_9f3a");
  assert.equal(row.site_slug, "acme-plumbing");
});

test("the prospect PIN still resolves the prospect row, not the paid one", () => {
  const row = pickAccessRow([prospectRow, paidRow], PROSPECT_PIN);
  assert.ok(row);
  assert.equal(row.job_id, "prospect-acme-plumbing");
});

test("a PIN that matches nothing resolves nothing — fail closed, never a guess", () => {
  assert.equal(pickAccessRow([prospectRow, paidRow], "999999"), null);
  assert.equal(pickAccessRow([], PAID_PIN), null);
  assert.equal(pickAccessRow(null, PAID_PIN), null);
});

test("when two rows share a PIN, the paid, site-bound row wins over a newer prospect row", () => {
  // Contrived collision: both verify the same PIN. Paid must still win, even
  // though the prospect row is the more recently touched one.
  const collidingProspect = {
    job_id: "prospect-x",
    site_slug: "",
    pin_hash: hashPin("555555"),
    last_login_at: "2026-08-05T00:00:00Z",
  };
  const collidingPaid = {
    job_id: "cs_live_x",
    site_slug: "x-co",
    pin_hash: hashPin("555555"),
    last_login_at: "2026-07-01T00:00:00Z",
  };
  const row = pickAccessRow([collidingProspect, collidingPaid], "555555");
  assert.equal(row.job_id, "cs_live_x", "a real job outranks a prospect preview regardless of recency");
});

test("among two paid rows for one email, the most recently used wins", () => {
  const older = { job_id: "cs_a", site_slug: "co", pin_hash: hashPin("777777"), last_login_at: "2026-06-01T00:00:00Z" };
  const newer = { job_id: "cs_b", site_slug: "co", pin_hash: hashPin("777777"), last_login_at: "2026-08-01T00:00:00Z" };
  const row = pickAccessRow([older, newer], "777777");
  assert.equal(row.job_id, "cs_b");
});
