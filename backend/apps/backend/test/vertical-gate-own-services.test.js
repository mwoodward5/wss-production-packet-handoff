"use strict";

// THE CLIENT'S OWN VERIFIED SERVICES ARE NOT A TRADE SWAP.
//
// Measured live 2026-08-19 (batch line for "Texas Best Fence & Patio",
// Lewisville TX): the first mirror the factory ever completed end-to-end was
// refused as `vertical_match: trade swap — concrete:driveway, concrete:patio`
// for printing the client's OWN offerings — a fencing company whose verified
// services include patio covers and automatic driveway gates. The gate already
// exempted the business NAME; this extends the same whole-phrase mechanics to
// the VERIFIED service list, and pairs every loosening with the proof that a
// genuinely swapped donor paragraph still convicts.
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkVertical } = require("../lib/render-gate");

function dom({ extra = "" } = {}) {
  const text = [
    "Texas Best Fence & Patio. Fencing in Dallas Fort Worth, TX.",
    "Wood Fences. Iron Fences. Chain link fencing installation and repair.",
    "Patio Covers built for Texas summers.",
    "Automatic Driveway Gates with keypad and remote entry.",
    extra,
  ].join(" ");
  return {
    ok: true,
    title: "Texas Best Fence & Patio | Fence Contractor in Dallas Fort Worth, TX",
    innerText: text,
    donorText: text,
  };
}

const SOURCE = {
  business_name: "Texas Best Fence & Patio",
  vertical: "fencing",
  services: ["Wood Fences", "Iron Fences", "Patio Covers", "Automatic Driveway Gates"],
};

test("a fencing mirror printing its own verified patio/driveway services passes", () => {
  const verdict = checkVertical(dom(), SOURCE);
  assert.equal(verdict.pass, true,
    `client's own verified offerings must not convict: ${JSON.stringify(verdict).slice(0, 300)}`);
  assert.ok(verdict.evidence.own_services_removed >= 1, "the exemption must be earned by the verified list, not a wider scan");
});

test("without the verified service list the same page still fails — the gate did not loosen", () => {
  const verdict = checkVertical(dom(), { ...SOURCE, services: undefined });
  assert.equal(verdict.pass, false);
  assert.match(JSON.stringify(verdict), /concrete:/);
});

test("the client's own PARAPHRASE of a verified service is exempt (the live 'patios' case)", () => {
  // Measured live 2026-08-20 take three: whole-phrase removal cleared
  // "Automatic Driveway Gates" but the client's FAQ says "flagstone/concrete
  // patios" — plural prose, not the service name — and the mirror was
  // convicted on concrete:patio alone. A term whose WORD the client verifiably
  // sells is their claim, not a donor's.
  const verdict = checkVertical(
    dom({ extra: "We also build outdoor kitchens, composite wood decking, and flagstone patios for Texas backyards." }),
    SOURCE,
  );
  assert.equal(verdict.pass, true, `paraphrased own service must not convict: ${JSON.stringify(verdict).slice(0, 240)}`);
});

test("a genuinely swapped foreign paragraph still convicts, services present or not", () => {
  const swapped = dom({ extra: "We pour stamped concrete slab foundations and finish every foundation with a cured sealant." });
  const verdict = checkVertical(swapped, SOURCE);
  assert.equal(verdict.pass, false,
    "donor copy that is NOT in the verified service list must still fail the mirror");
  assert.match(JSON.stringify(verdict), /concrete:/);
});

test("a TWO-TRADE client's secondary-trade services pass on the lead-trade donor", () => {
  // Doctrine change 2026-08-20: multi-trade businesses build on the LEAD
  // trade's donor and their verified list carries the second trade onto the
  // page. This is the gate-side half of that bargain — the plumbing words are
  // the client's own claim, so an HVAC mirror printing them must pass, and
  // WITHOUT the verified list the very same page must still convict.
  const text = [
    "Sal's Heating, Cooling & Plumbing. Furnace repair, AC installation, duct work.",
    "Water Heater Installation and repair for Cleveland homes.",
    "Sewer Line Repair with camera inspection.",
  ].join(" ");
  const domTwo = { ok: true, title: "Sal's Heating, Cooling & Plumbing | HVAC in Cleveland, OH", innerText: text, donorText: text };
  const src = {
    business_name: "Sal's Heating, Cooling & Plumbing",
    vertical: "hvac",
    services: ["Furnace Repair", "AC Installation", "Water Heater Installation", "Sewer Line Repair"],
  };
  const withList = checkVertical(domTwo, src);
  assert.equal(withList.pass, true, `own second-trade services must not convict: ${JSON.stringify(withList).slice(0, 240)}`);
  const withoutList = checkVertical(domTwo, { ...src, services: undefined });
  assert.equal(withoutList.pass, false, "without the verified list the same page still fails — the gate did not loosen");
});

test("a lead-trade mirror admits a verified secondary trade but still refuses an unsupported third trade", () => {
  const domTwo = {
    ok: true,
    title: "Drake Mechanical | Plumbing in Tulsa, OK",
    innerText: [
      "Drake Mechanical | HVAC & Plumbing Services",
      "Air conditioning repair, furnace replacement, heat pump service, drain cleaning.",
      "We do not install roofs.",
    ].join(" "),
    donorText: [
      "Drake Mechanical | HVAC & Plumbing Services",
      "Air conditioning repair, furnace replacement, heat pump service, drain cleaning.",
      "We also install shingle roofing systems.",
    ].join(" "),
  };
  const src = {
    business_name: "Drake Mechanical",
    vertical: "plumbing",
    services: ["Drain cleaning", "Sewer line repair", "Air conditioning repair", "Heat pump service"],
    secondary_verticals: ["hvac"],
  };
  const verdict = checkVertical(domTwo, src);
  assert.equal(verdict.pass, false, "an unsupported third trade must still convict the mirror");
  assert.match(verdict.reason, /roofing:/);
  assert.deepEqual(verdict.evidence.admitted_secondary_trades, ["hvac"]);
});

test("a CUSTOMER review naming another trade is exempt as verbatim (the Bell Brothers case)", () => {
  // Measured live 2026-08-20: an HVAC mirror was convicted plumbing:plumbing
  // because a Google review said the crew "diagnosed our plumbing problem".
  const review = "They came out the same day, diagnosed our plumbing problem next to the furnace and had the whole thing fixed within an hour. Great crew.";
  const hvacDom = {
    ok: true,
    title: "Metro Comfort | HVAC Contractor in Dallas, TX",
    innerText: "Metro Comfort. Heating and air conditioning, furnace repair, duct work. " + review,
    donorText: "Metro Comfort. Heating and air conditioning, furnace repair, duct work. " + review,
  };
  const src = { business_name: "Metro Comfort", vertical: "hvac", services: ["Furnace Repair", "AC Installation"], reviews: [review] };
  const withReviews = checkVertical(hvacDom, src);
  assert.equal(withReviews.pass, true, `verbatim customer words must not convict: ${JSON.stringify(withReviews).slice(0, 240)}`);
  const withoutReviews = checkVertical(hvacDom, { ...src, reviews: undefined });
  assert.equal(withoutReviews.pass, false, "without the verbatim list the same page still fails — the gate did not loosen");
});
