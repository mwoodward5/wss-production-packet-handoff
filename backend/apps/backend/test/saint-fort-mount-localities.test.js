"use strict";

// test/saint-fort-mount-localities.test.js — THE ABBREVIATION IS PART OF THE NAME.
//
// THE INCIDENT (2026-08-12). A live HVAC mirror rendered, on its hero:
//
//     "Indoor Comfort Team. HVAC in Louis, MO."
//
// St. Louis with its Saint amputated. The market city is preferred over the NAP
// city on every marketing surface, and it is extracted from the business's own
// self-description by PLACE_STATE_RE. That regex's word class excluded the
// period, so "St. Louis, MO" could only match from "Louis" — the "St." was left
// behind and the assertion slid one word to the right.
//
// THE FIX. Each place word may carry one trailing period, because "St.", "Ft."
// and "Mt." (Saint / Fort / Mount) ARE the name. The period is a Saint/Fort/
// Mount marker, never a sentence end — words still only chain via an uppercase
// letter — and the numbered/precinct refusals in place-names.js are untouched:
// they run downstream on whatever is captured, and a number can still never
// START a captured place.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "..", "boilerplates");

const { placeAssertionsIn, serviceAreaAssertion } = require("../lib/mirror-engine/verified-facts");
const { implausibleReason, isPlausiblePlaceName } = require("../lib/mirror-engine/place-names");
const { marketCity, defaultHeroHeadline } = require("../lib/mirror-engine/facts");

const SAINT_CASES = [
  ["St. Louis", "MO"],
  ["St. Paul", "MN"],
  ["Ft. Worth", "TX"],
  ["Mt. Pleasant", "SC"],
  ["Lake St. Louis", "MO"], // a real multi-word city with the abbreviation inside
];

test("placeAssertionsIn keeps the leading Saint/Fort/Mount abbreviation", () => {
  for (const [city, state] of SAINT_CASES) {
    const hit = placeAssertionsIn(`Proudly serving ${city}, ${state} and every home nearby.`)[0];
    assert.ok(hit, `no assertion parsed for "${city}, ${state}"`);
    assert.equal(hit.city, city, `truncated: got "${hit.city}", want "${city}"`);
    assert.equal(hit.state, state);
  }
});

test("plain multi-word cities and the Flint case are unaffected (no regression)", () => {
  for (const [city, state] of [["San Diego", "CA"], ["Santa Fe", "NM"], ["New York", "NY"]]) {
    const hit = placeAssertionsIn(`We serve ${city}, ${state}.`)[0];
    assert.ok(hit && hit.city === city && hit.state === state, `${city}, ${state} -> ${JSON.stringify(hit)}`);
  }
  // The original Flint case: "Austin, Texas Plumber" still reads Austin/TX.
  const austin = placeAssertionsIn("Austin, Texas Plumber, Plumbing, Emergency Plumber")[0];
  assert.ok(austin && austin.city === "Austin" && austin.state === "TX");
});

test("serviceAreaAssertion resolves St. Louis whole, from the site's own <title>", () => {
  const sa = serviceAreaAssertion({
    html: "<title>Indoor Comfort Team — HVAC in St. Louis, MO</title>",
    ldNodes: [],
    businessName: "Indoor Comfort Team",
  });
  assert.ok(sa, "no service area resolved");
  assert.equal(sa.city, "St. Louis");
  assert.equal(sa.state, "MO");
});

test("the rendered market city preserves St. Louis, while the hero uses NAP locality", () => {
  const facts = {
    business_name: "Indoor Comfort Team",
    name: "Indoor Comfort Team",
    category: "HVAC",
    service_area: "St. Louis",
    city: "Ballwin", // NAP locality — deliberately different from the market
    state: "MO",
  };
  assert.equal(marketCity(facts), "St. Louis");
  const headline = defaultHeroHeadline(facts);
  assert.match(headline, /Ballwin, MO/, `headline lost the NAP locality: "${headline}"`);
  assert.doesNotMatch(headline, /St\. Louis/, `headline used the mining metro instead of NAP locality: "${headline}"`);
  assert.doesNotMatch(headline, /\bin Louis\b/, `headline still amputated: "${headline}"`);
});

test("real Saint/Fort/Mount towns pass the place-name plausibility gate", () => {
  for (const good of ["St. Louis", "St. Paul", "Ft. Worth", "Mt. Pleasant", "Lake St. Louis"]) {
    assert.equal(implausibleReason(good), "", `wrongly refused a real town: ${good}`);
    assert.equal(isPlausiblePlaceName(good), true);
  }
});

test("the numbered / precinct / legal-entity refusals are UNTOUCHED", () => {
  // Exactly the strings the place-name module exists to refuse. The abbreviation
  // fix must not have opened any of these back up.
  const refused = [
    "9, LA",
    "13, LA",
    "District 9",
    "Ward 3",
    "Precinct 2",
    "Richland VIII",
    "Papillion Second II",
    "Township 11, Long Creek",
    "Nashville-Davidson metropolitan government",
    "Augusta-Richmond County consolidated government",
  ];
  for (const bad of refused) {
    assert.notEqual(implausibleReason(bad), "", `should still refuse: ${bad}`);
    assert.equal(isPlausiblePlaceName(bad), false, `should still refuse: ${bad}`);
  }
});
