"use strict";

// test/services-gate-live-audit-pin.test.js
//
// VERIFICATION PIN — the 2026-09-02 Comet fleet audit's service-name finding.
// A live service card was titled "Las Vegas Plumbing Customers!" — marketing
// copy printed as a SERVICE. PR #601 added the exclamation rule to the
// services gate (lib/mirror-engine/service-names.js: an exclamation mark
// anywhere in a label is a banner, never a service a customer could ask for
// by name). This file pins that gate against the EXACT live strings, so the
// fix cannot quietly regress.
//
// The audit evidence matters: the string shipped on the live mirror INSIDE
// the content island, wrapped in typographic quotes —
//   "services":[…,{"name":"“Las Vegas Plumbing Customers!”"}]
// — so the pin tests both the bare label and the curly-quoted island form:
// the curly quotes must not smuggle the banner past the gate (folding strips
// them, and the exclamation rule still convicts).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  articleHeadlineReason,
  isSellableServiceName,
  filterServiceNames,
} = require("../lib/mirror-engine/service-names");

// Verbatim from the audited live build (Precision Plumbing, 2026-09-02):
// the curly-quoted island form and the bare rendering of the same label.
const LIVE_BARE = "Las Vegas Plumbing Customers!";
const LIVE_ISLAND_FORM = "\u201CLas Vegas Plumbing Customers!\u201D";

// Real services from the same live island that MUST keep shipping.
const LIVE_REAL_SERVICES = [
  "Electronic Leak Detection",
  "Hydro Jetting Service",
  "Trenchless Pipe Replacement",
  "Re-pipe Waterlines",
  "24/7 Emergency Plumbing",
];

test("the services gate refuses the audited live string, bare", () => {
  assert.equal(articleHeadlineReason(LIVE_BARE), "quality_claim",
    "the exclamation rule must convict the bare live label");
  assert.equal(isSellableServiceName(LIVE_BARE), false);
});

test("the services gate refuses the audited live string in its curly-quoted island form", () => {
  assert.equal(articleHeadlineReason(LIVE_ISLAND_FORM), "quality_claim",
    "curly quotes around the banner must not smuggle it past the gate");
  assert.equal(isSellableServiceName(LIVE_ISLAND_FORM), false);
});

test("filterServiceNames drops the marketing label and keeps the real services beside it", () => {
  const list = [...LIVE_REAL_SERVICES.map((name) => ({ name })), { name: LIVE_ISLAND_FORM }, { name: LIVE_BARE }];
  const { kept, dropped } = filterServiceNames(list);
  assert.deepEqual(
    kept.map((s) => s.name),
    LIVE_REAL_SERVICES,
    "the gate must drop exactly the marketing label and keep every real service",
  );
  assert.equal(dropped.length, 2);
  for (const entry of dropped) {
    assert.equal(entry.reason, "quality_claim");
    assert.match(entry.value, /Las Vegas Plumbing Customers!/);
  }
});

test("the audit shape end to end: a sibling banner label cannot ride the island as a service", () => {
  const { kept } = filterServiceNames([
    { name: "Electronic Leak Detection", description: "Precision Plumbing LLC offers Electronic Leak Detection." },
    { name: LIVE_ISLAND_FORM },
    { name: "Half Off This Month!" },
    { name: "Your Local Pros!" },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].name, "Electronic Leak Detection");
});
