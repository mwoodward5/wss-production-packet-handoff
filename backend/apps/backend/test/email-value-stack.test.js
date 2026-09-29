"use strict";

// test/email-value-stack.test.js — the MOSAIC V2 value stack, pinned.
//
// The owner approved a specific set of market-rate anchors and a specific pair
// of sums. Two things must never drift:
//
//   1. THE ROWS AND THE SUMS AGREE. The band says "others charge ~$5,520 to
//      build + ~$876/mo", and that must be the arithmetic of the line items —
//      not a hand-typed number that quietly disagrees with the list above it.
//      VALUE_STACK carries an `amount` per row for exactly this reason.
//
//   2. THE FRAMING IS "WHAT OTHERS CHARGE", NOT A FEE WE LEVIED. Every place the
//      stack renders says so, because a list of dollar figures with no framing
//      reads as an invoice. TRUTH LAW applies to marketing.
//
// The config lives in lib/proof-email-inputs.js (the owner keeps pricing there);
// the composer imports it and renders it in the price section.

const test = require("node:test");
const assert = require("node:assert/strict");

const { VALUE_STACK } = require("../lib/proof-email-inputs");
const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");

const sum = (rows) => rows.reduce((n, r) => n + Number(r.amount || 0), 0);

// ---------------------------------------------------------------------------
// 1. The approved numbers, and their sums
// ---------------------------------------------------------------------------

test("the value stack carries the exact owner-approved rows", () => {
  assert.deepEqual(
    VALUE_STACK.oneTime.map((r) => [r.label, r.price, r.amount]),
    [
      ["Custom local-business website (design & build)", "$4,500", 4500],
      ["Local findability report (the “$1,000 report”)", "$1,000", 1000],
      ["Site launch & go-live setup", "$20", 20],
    ],
  );
  assert.deepEqual(
    VALUE_STACK.monthly.map((r) => [r.label, r.price, r.amount]),
    [
      ["On-site AI chat & booking agent", "$99/mo", 99],
      ["24/7 missed-call text-back", "$99/mo", 99],
      ["Unified inbox + CRM (WSS Connect)", "$97/mo", 97],
      ["Web developer on call, unlimited edits (Riley)", "$197/mo", 197],
      ["Maps & “near-me” local SEO", "$300/mo", 300],
      ["Reviews widget + reputation", "$59/mo", 59],
      ["Managed hosting + SSL", "$25/mo", 25],
    ],
  );
  assert.equal(VALUE_STACK.price, "$149");
});

test("the sums are exactly $5,520 one-time and $876/mo — computed from the rows", () => {
  assert.equal(sum(VALUE_STACK.oneTime), 5520);
  assert.equal(sum(VALUE_STACK.monthly), 876);
});

// ---------------------------------------------------------------------------
// 2. The composed email renders the rows, the summed band, and the framing
// ---------------------------------------------------------------------------

const BASE = {
  businessName: "Ramon Roofing",
  city: "Fort Worth",
  previewUrl: "https://ramon-roofing.wss-ai.com/",
};

test("the HTML price section renders every line item and the summed band", () => {
  const { html } = composeOutreachEmailV3(BASE);
  // Every one-time and monthly label and price is on the page.
  for (const row of [...VALUE_STACK.oneTime, ...VALUE_STACK.monthly]) {
    assert.ok(html.includes(row.price), `missing price ${row.price}`);
  }
  // The band states the two sums the rows add up to, and the flat price.
  assert.match(html, /~\$5,520 to build/);
  assert.match(html, /~\$876\/mo/);
  assert.match(html, /\$149/);
  // Framed as market cost, not a fee we levied.
  assert.match(html, /Not a bill from us/i);
  assert.match(html, /what agencies and SaaS tools charge/i);
});

test("the text half carries the same summed framing, aligned with the HTML", () => {
  const { text } = composeOutreachEmailV3(BASE);
  assert.match(text, /Others charge about \$5,520 to build plus about \$876\/mo/);
  assert.match(text, /you pay \$149\/mo/);
});

test("the value stack is standing copy — it renders even for a bare record", () => {
  // It is the SAME for every prospect (not a per-prospect fact), so it appears
  // whenever the email itself does, business name or no business name.
  const { html } = composeOutreachEmailV3({ previewUrl: BASE.previewUrl });
  assert.match(html, /~\$5,520 to build/);
  assert.match(html, /\$4,500/);
});
