"use strict";

// GENERAL CONTRACTOR JOINS THE APPROVED TRADES — 2026-08-20, forced by the
// owner's real test client (Krab Construction, Orange County GC). The donor is
// general-contractor-clean, whose native sections render only the client's
// verified service mix. Every widening here is paired with proof that the gate
// did not loosen for anyone else.
const test = require("node:test");
const assert = require("node:assert/strict");
const { approvedIndustry } = require("../lib/copilot");
const { inferTrade } = require("../lib/trade-inference");
const { checkVertical, evaluateRenderGate } = require("../lib/render-gate");
const { effectiveBuildIndustry } = require("../lib/mirror-lane-build");

test("the registry round-trip: label → approved industry → donor", () => {
  for (const label of ["general contractor", "General Contracting"]) {
    assert.equal(approvedIndustry(label), "general contractor", label);
  }
  const verticals = require("../data/donor-verticals.json");
  assert.equal(verticals.canonical["general contractor"], "general-contractor-clean");
  assert.equal(verticals.aliases["general contractor"], "general-contractor-clean");
  assert.equal(verticals.aliases["general contracting"], "general-contractor-clean");
});

test("a Krab-shaped service list infers general contractor", () => {
  const verdict = inferTrade({
    label: "construction company",
    businessName: "Krab Construction",
    services: [
      { name: "Kitchen Remodels" }, { name: "Bathroom Remodels" },
      { name: "Home Additions" }, { name: "Commercial Construction" },
      { name: "Demolition and Site Work" },
    ],
  });
  assert.equal(verdict.trade, "general contractor", JSON.stringify(verdict.scores));
});

test("a clean exact-pick secondary trade is honored only when inference proved it", () => {
  const roy = inferTrade({
    label: "plumbing",
    businessName: "Roy Briley General Contracting, Fire & Water Damage Restoration",
    services: ["Home Repair", "Emergency Repairs", "Roofing replacement and repairs"],
  });
  assert.equal(roy.trade, "restoration");
  assert.ok(roy.secondary.includes("general contractor"));
  assert.equal(effectiveBuildIndustry(roy, {
    requested: "general contractor",
    label: "plumbing",
  }), "general contractor");
  assert.equal(effectiveBuildIndustry(roy, {
    requested: "tattoo",
    label: "plumbing",
  }), "water damage restoration", "an unrelated requested trade cannot override inference");

  assert.equal(effectiveBuildIndustry({
    trade: "restoration",
    secondary: [],
    scores: [{ trade: "general contractor", hits: 1 }],
  }, {
    requested: "general contractor",
    label: "restoration",
  }), "water damage restoration", "a one-hit score is not a proven secondary trade");
});

test("a GC mirror printing its own GC language passes the vertical gate", () => {
  const text = "Krab Construction. General contractor in Newport Beach, CA. Kitchen and bathroom remodels, home additions, new construction and tenant improvement work across Orange County.";
  const verdict = checkVertical(
    { ok: true, title: "Krab Construction | General Contractor in Newport Beach, CA", innerText: text, donorText: text },
    { business_name: "Krab Construction", vertical: "general contractor", services: ["Kitchen Remodels", "Home Additions"] },
  );
  assert.equal(verdict.pass, true, JSON.stringify(verdict).slice(0, 240));
});

test("the new entry convicts a swapped foreign page and is itself refused elsewhere — no loosening", () => {
  // A GC mirror whose donor surface carries another trade's language still fails.
  const swapped = "Krab Construction. General contractor in Newport Beach, CA. Remodels and additions. Furnace repair and heat pump installation with full duct replacement.";
  const verdict = checkVertical(
    { ok: true, title: "Krab Construction | General Contractor in Newport Beach, CA", innerText: swapped, donorText: swapped },
    { business_name: "Krab Construction", vertical: "general contractor", services: ["Kitchen Remodels"] },
  );
  assert.equal(verdict.pass, false, "foreign hvac copy on a GC mirror must still convict");
  // And the GC terms are NOT exclusive: a fencing page saying "renovation"
  // in its own prose is not convicted as a swapped GC page.
  const fencing = "Texas Best Fence & Patio. Fencing in Dallas Fort Worth, TX. Wood fences, iron fences, and a full renovation of your backyard fence line.";
  const fencingVerdict = checkVertical(
    { ok: true, title: "Texas Best Fence & Patio | Fence Contractor in Dallas Fort Worth, TX", innerText: fencing, donorText: fencing },
    { business_name: "Texas Best Fence & Patio", vertical: "fencing", services: ["Wood Fences"] },
  );
  assert.equal(fencingVerdict.pass, true, `GC terms must not convict a neighbour: ${JSON.stringify(fencingVerdict).slice(0, 200)}`);
});

test("the whole gate still refuses an unapproved vertical — the door opened for GC, not for everyone", () => {
  const verdict = evaluateRenderGate({
    dom: { ok: true, title: "X", innerText: "x", donorText: "x" },
    source: { vertical: "wedding photography", business_name: "X" },
  });
  assert.equal(verdict.pass, false);
});
