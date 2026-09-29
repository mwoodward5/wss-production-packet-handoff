"use strict";

/**
 * test/numeric-towns-and-contested-address.test.js
 *
 * Two P0s that reached the same live mirror on 2026-08-11 —
 * wss-test-air-creation-heating-and-cooling-llc-baton.wss-ai.com, a real HVAC
 * company in Baton Rouge, LA.
 *
 *   1. It published "9, LA", "4, LA", "13, LA" and "5, LA" as the towns nearby.
 *   2. It published "11616 Cedar Park Ave" while its two sources disagreed
 *      about the street AND the ZIP.
 *
 * Both were measured, not inferred. The Census probe transcript and the
 * resolver's own conflict record are quoted in the tests that cover them.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isPlausiblePlaceName,
  implausibleReason,
  filterPlaceNames,
} = require("../lib/mirror-engine/place-names.js");
const { nearbyCities, placeDescriptor } = require("../lib/mirror-engine/nearby-cities.js");
const { buildContentHtml } = require("../lib/mirror-engine/content-inject.js");
const renderGate = require("../lib/render-gate.js");
const { withheldAddress, buildMirrorForProspect } = require("../lib/mirror-lane-build.js");

// ---------------------------------------------------------------------------
// 1. THE PREDICATE
// ---------------------------------------------------------------------------

test("a string with no letters in it is not a place name", () => {
  // The four that shipped.
  for (const n of ["9", "4", "13", "5"]) {
    assert.equal(implausibleReason(n), "no_letters", `${n} must be refused`);
    assert.equal(isPlausiblePlaceName(n), false);
  }
  // The neighbours of the defect.
  assert.equal(implausibleReason("70809"), "no_letters", "a ZIP is not a town");
  assert.equal(implausibleReason("2-A"), "no_letters");
  assert.equal(implausibleReason("  "), "empty");
  assert.equal(implausibleReason(""), "empty");
  assert.equal(implausibleReason(null), "empty");
  assert.equal(implausibleReason(undefined), "empty");
});

test("a template token that reached a place-name field is refused", () => {
  assert.equal(implausibleReason("{city}"), "template_token");
  assert.equal(implausibleReason("{{CITY}}"), "template_token");
  assert.equal(implausibleReason("[city]"), "template_token");
  assert.equal(implausibleReason("%%CITY%%"), "template_token");
  assert.equal(implausibleReason("${city}"), "template_token");
});

test("a lone state code is a fragment, not a town", () => {
  assert.equal(implausibleReason("LA"), "state_code_only");
  assert.equal(implausibleReason("TX"), "state_code_only");
  assert.equal(implausibleReason("L.A."), "state_code_only");
  // ...and a three-letter town keeps its place.
  assert.equal(implausibleReason("Ada"), "");
  assert.equal(implausibleReason("Ely"), "");
});

test("the absence of a name wearing a name's clothes is refused", () => {
  for (const n of ["null", "undefined", "N/A", "None", "unknown", "City", "your city", "TBD"]) {
    assert.notEqual(implausibleReason(n), "", `${n} must be refused`);
  }
});

test("real place names are untouched, including the awkward ones", () => {
  const real = [
    "St. George", "Denham Springs", "Prairieville", "Central", "St. Gabriel",
    "Kansas City", "Winston-Salem", "Coeur d'Alene", "Truth or Consequences",
    "Twentynine Palms", "29 Palms", "Ninety Six", "Eighty Four",
    "Lake Havasu City", "Cherry Hill", "Stratford", "O'Fallon", "Añasco",
  ];
  for (const n of real) {
    assert.equal(implausibleReason(n), "", `${n} is a real town and must survive`);
  }
});

test("filterPlaceNames keeps the survivors and names every casualty", () => {
  const { kept, dropped } = filterPlaceNames([
    { name: "St. George" }, { name: "9" }, { name: "Denham Springs" }, { name: "{city}" },
  ]);
  assert.deepEqual(kept.map((k) => k.name), ["St. George", "Denham Springs"]);
  assert.deepEqual(dropped, [
    { value: "9", reason: "no_letters" },
    { value: "{city}", reason: "template_token" },
  ]);
});

// ---------------------------------------------------------------------------
// 2. THE SOURCE — where the numbers were actually born
// ---------------------------------------------------------------------------
//
// Probed live against the Census geocoder at the client's own verified
// coordinates (30.3889, -91.0529) on 2026-08-11. Transcript, verbatim:
//
//   probe  8km/ 45deg  layer=County Subdivisions  NAME="District 9"  BASENAME="9"
//   probe  8km/135deg  layer=County Subdivisions  NAME="District 4"  BASENAME="4"
//   probe 14km/225deg  layer=County Subdivisions  NAME="District 13" BASENAME="13"
//   probe 14km/ 90deg  layer=County Subdivisions  NAME="District 5"  BASENAME="5"
//
// Louisiana's county subdivisions are voting districts, and the Census writes
// the descriptor FIRST. No distance was read as a name and no index leaked: the
// record genuinely is called "9".

/** A Census geocoder whose every probe answers with the same record. */
function censusStub(layer, hit) {
  return async () => ({ ok: true, json: async () => ({ result: { geographies: { [layer]: [hit] } } }) });
}

const BATON_ROUGE = { lat: 30.3889115, lng: -91.0529069 };

test("the descriptor is read from EITHER end of the name", () => {
  // The suffix cases that already worked, so the widening did not break them.
  assert.equal(placeDescriptor({ NAME: "Kansas City city", BASENAME: "Kansas City" }), "city");
  assert.equal(placeDescriptor({ NAME: "Canton charter township", BASENAME: "Canton" }), "charter township");
  assert.equal(placeDescriptor({ NAME: "Beaverton-Hillsboro CCD", BASENAME: "Beaverton-Hillsboro" }), "ccd");
  // The prefix case that produced "9, LA" — this returned "" before the fix,
  // and an empty descriptor is in no refusal set.
  assert.equal(placeDescriptor({ NAME: "District 9", BASENAME: "9" }), "district");
  assert.equal(placeDescriptor({ NAME: "Ward 3", BASENAME: "3" }), "ward");
  assert.equal(placeDescriptor({ NAME: "Beat 5", BASENAME: "5" }), "beat");
  assert.equal(placeDescriptor({ NAME: "Militia District 1465", BASENAME: "1465" }), "militia district");
});

test("a Louisiana voting district is never published as a nearby town", async () => {
  const hit = {
    NAME: "District 9", BASENAME: "9", STATE: "22",
    CENTLAT: "+30.3802728", CENTLON: "-090.9892948",
  };
  const out = await nearbyCities({
    ...BATON_ROUGE, excludeCity: "Baton Rouge", count: 6,
    fetchImpl: censusStub("County Subdivisions", hit),
  });
  assert.deepEqual(out, [], '"9, LA" is not a town a customer can drive from');
});

test("an administrative label with no BASENAME to strip is refused on its shape", async () => {
  // placeDescriptor has nothing to subtract here and answers "" — so the
  // descriptor list cannot help, and the name still is not a town.
  const hit = {
    NAME: "District 9", BASENAME: "", STATE: "22",
    CENTLAT: "+30.3802728", CENTLON: "-090.9892948",
  };
  const out = await nearbyCities({ ...BATON_ROUGE, count: 6, fetchImpl: censusStub("County Subdivisions", hit) });
  assert.deepEqual(out, [], '"District 9, LA" is no more a town than "9, LA" was');
});

test("a bare number survives every named rule and is still refused", async () => {
  // The belt to the descriptor list's brace: a layer we do not recognise, a
  // descriptor nobody thought of, a name that is an integer.
  const hit = {
    NAME: "17", BASENAME: "17", STATE: "22",
    CENTLAT: "+30.3802728", CENTLON: "-090.9892948",
  };
  const out = await nearbyCities({ ...BATON_ROUGE, count: 6, fetchImpl: censusStub("Incorporated Places", hit) });
  assert.deepEqual(out, []);
});

test("the real towns around the same coordinates still resolve", async () => {
  // The fix must not empty Louisiana. St. George is the nearest real place to
  // this business and rendered correctly even on the broken build.
  const hit = {
    NAME: "St. George city", BASENAME: "St. George", STATE: "22",
    CENTLAT: "+30.3657944", CENTLON: "-091.0281760",
  };
  const out = await nearbyCities({
    ...BATON_ROUGE, excludeCity: "Baton Rouge", count: 6,
    fetchImpl: censusStub("Incorporated Places", hit),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "St. George");
  assert.equal(out[0].state, "LA");
});

// ---------------------------------------------------------------------------
// 2b. THE SAME CLASS, FOUND BY SWEEPING THE FLEET
// ---------------------------------------------------------------------------
//
// The fix above was written against the numbers. Sweeping all 80 live mirrors
// on 2026-08-11 then turned up the same defect wearing words — two real
// businesses whose rails name a LEGAL ENTITY instead of a town:
//
//   wss-test-holt-plumbing-company-nashville     "Nashville-Davidson metropolitan government, TN"
//   wss-test-maxwells-plumbing-and-drain-evans   "Augusta-Richmond County consolidated government, GA"
//
// These are the Census's names for consolidated city-county governments. The
// PLACE is real — that is why the plausibility predicate passes them, and
// rightly: they have letters, they are not tokens, they are not placeholders.
// What is wrong is the trailing legal descriptor, which is the same kind of
// word as "city", "town" and "township" that cleanPlaceName has always
// stripped, and which no human writes in an address. Nobody in Tennessee says
// they drove in from Nashville-Davidson metropolitan government.

test("a consolidated city-county keeps its place name and loses its legal descriptor", async () => {
  const real = {
    NAME: "Nashville-Davidson metropolitan government (balance)",
    BASENAME: "Nashville-Davidson metropolitan government (balance)",
    STATE: "47", CENTLAT: "+36.1867", CENTLON: "-086.7845",
  };
  const out = await nearbyCities({
    lat: 36.2661, lng: -86.6822, excludeCity: "Hendersonville", count: 6,
    fetchImpl: censusStub("Incorporated Places", real),
  });
  assert.equal(out.length, 1);
  // TIGHTENED 2026-08-11 (second sweep). This asserted "Nashville-Davidson",
  // which is still the merged CORPORATION's name — Davidson is the county the
  // city absorbed, and no Tennessean says they drove in from Nashville-Davidson
  // either. The city is the part before the join. See
  // test/precinct-legal-entity-and-foreign-tokens.test.js.
  assert.equal(
    out[0].name,
    "Nashville",
    "the town survives; both the legal descriptor and the absorbed county come off",
  );
});

test("a consolidated county government is stripped the same way", async () => {
  const real = {
    NAME: "Augusta-Richmond County consolidated government (balance)",
    BASENAME: "Augusta-Richmond County consolidated government (balance)",
    STATE: "13", CENTLAT: "+33.4735", CENTLON: "-082.0105",
  };
  const out = await nearbyCities({
    lat: 33.5337, lng: -82.1307, excludeCity: "Evans", count: 6,
    fetchImpl: censusStub("Incorporated Places", real),
  });
  assert.equal(out.length, 1);
  // Tightened with the Nashville case above: "Augusta-Richmond County" was
  // still the entity, not the city Maxwells' customers drive from.
  assert.equal(out[0].name, "Augusta");
});

test("stripping the legal descriptor never eats a real name that contains those words", () => {
  // "Government Camp, OR" is a real place. The strip is anchored to the end and
  // matches the Census's lower-case descriptor, so it cannot reach inside a
  // name — the same discipline that keeps "Kansas City" from becoming "Kansas".
  const untouched = {
    NAME: "Government Camp CDP", BASENAME: "Government Camp",
    STATE: "41", CENTLAT: "+45.3018", CENTLON: "-121.7562",
  };
  const { cleanPlaceName } = require("../lib/mirror-engine/nearby-cities.js");
  assert.equal(cleanPlaceName(untouched.NAME, untouched.BASENAME), "Government Camp");
  assert.equal(cleanPlaceName("Kansas City city", "Kansas City"), "Kansas City");
  assert.equal(
    cleanPlaceName("Nashville-Davidson metropolitan government (balance)", "Nashville-Davidson metropolitan government (balance)"),
    "Nashville",
  );
  // And the split is confined to that class: an ordinary hyphenated town keeps
  // both halves of its name.
  assert.equal(cleanPlaceName("Winston-Salem city", "Winston-Salem"), "Winston-Salem");
});

// ---------------------------------------------------------------------------
// 3. THE RENDER — dropped, not printed; and an empty list hides the section
// ---------------------------------------------------------------------------

const FACTS = {
  business_name: "Air Creation Heating & Cooling, LLC",
  city: "Baton Rouge",
  state: "LA",
  phone: "(225) 313-0550",
  industry: "hvac",
};

/**
 * The coverage section is opened by `areas || hours` (not by `nearby`), so a
 * fixture that only carries towns renders nothing at all and would make these
 * tests pass for the wrong reason. Every fixture below therefore ships hours.
 */
function render(content) {
  const out = buildContentHtml({
    content: { hours: ["Monday: 8:00 AM – 5:00 PM"], ...content },
    facts: FACTS,
    phoneDigits: "2253130550",
  });
  return typeof out === "string" ? out : String((out && (out.html || out.body)) || "");
}

/** The rendered town spans — NOT the stylesheet, which also mentions the class. */
function renderedTowns(html) {
  return [...html.matchAll(/<span class="wss-c__neartown">([^<]*)<\/span>/g)].map((m) => m[1]);
}

test("a numeric town is dropped from the published list rather than printed", () => {
  const html = render({
    services: [{ name: "AC Repair" }],
    nearby: [
      { name: "St. George", state: "LA", miles: 2 },
      { name: "9", state: "LA", miles: 4 },
      { name: "13", state: "LA", miles: 8 },
      { name: "Denham Springs", state: "LA", miles: 8 },
    ],
  });
  assert.deepEqual(renderedTowns(html), ["St. George, LA", "Denham Springs, LA"],
    "the real towns survive and the numbers are dropped, not printed");
});

test("an all-numeric list hides the section — an absent block is honest", () => {
  const html = render({
    services: [{ name: "AC Repair" }],
    nearby: [
      { name: "9", state: "LA", miles: 4 },
      { name: "4", state: "LA", miles: 7 },
      { name: "13", state: "LA", miles: 8 },
      { name: "5", state: "LA", miles: 8 },
    ],
  });
  assert.ok(!html.includes("Driving directions from nearby towns"),
    "with nothing true to list, the block must not render at all");
  assert.deepEqual(renderedTowns(html), []);
  // The rest of the coverage section is unharmed — hiding the towns rail is not
  // an excuse to lose the hours and the map.
  assert.ok(html.includes("Coverage"));
});

test("a clean list renders untouched", () => {
  const html = render({
    services: [{ name: "AC Repair" }],
    nearby: [
      { name: "St. George", state: "LA", miles: 2 },
      { name: "Prairieville", state: "LA", miles: 4 },
      { name: "Denham Springs", state: "LA", miles: 8 },
    ],
  });
  assert.ok(html.includes("Driving directions from nearby towns"));
  assert.deepEqual(renderedTowns(html),
    ["St. George, LA", "Prairieville, LA", "Denham Springs, LA"]);
});

test("a service-area chip that is not a place name is dropped too", () => {
  const html = render({
    services: [{ name: "AC Repair" }],
    areas: ["Baton Rouge", "9", "{city}", "Gonzales", ""],
  });
  assert.ok(html.includes("Baton Rouge"));
  assert.ok(html.includes("Gonzales"));
  assert.ok(!/<li>9<\/li>/.test(html), "a bare number is not an area served");
  assert.ok(!html.includes("{city}"));
});

// ---------------------------------------------------------------------------
// 4. THE GATE — a build carrying numeric towns cannot pass revealable
// ---------------------------------------------------------------------------

test("the ninth fact refuses the exact page that reached the owner", () => {
  const verdict = renderGate.checkPlaceNames({
    placeNames: ["St. George, LA", "9, LA", "4, LA", "13, LA", "Denham Springs, LA", "5, LA"],
    jsonld: [],
  });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.fact, "place_names_plausible");
  assert.ok(/"9"/.test(verdict.reason), `the reason must name the offender: ${verdict.reason}`);
});

test("the ninth fact reads JSON-LD areaServed as well as the rendered rail", () => {
  const verdict = renderGate.checkPlaceNames({
    placeNames: [],
    jsonld: [{ "@type": "HVACBusiness", areaServed: [{ "@type": "City", name: "13" }] }],
  });
  assert.equal(verdict.pass, false, "a town that is wrong on the page is wrong in the schema too");
});

test("real towns, and a page with no coverage block at all, both pass", () => {
  assert.equal(renderGate.checkPlaceNames({
    placeNames: ["St. George, LA", "Denham Springs, LA", "Prairieville, LA"],
    jsonld: [{ areaServed: "Baton Rouge, LA" }],
  }).pass, true);
  assert.equal(renderGate.checkPlaceNames({ placeNames: [], jsonld: [] }).pass, true,
    "a mirror with no coverage block publishes no place names and owes nothing");
});

test("the gate carries the fact and the runtime self-check proves it is armed", () => {
  assert.ok(renderGate.FACTS.includes("place_names_plausible"));
  assert.deepEqual(renderGate.assertGateIntegrity(), { ok: true, facts: renderGate.FACTS.length });
  // A blind gate still fails every fact, the new one included.
  const blind = renderGate.evaluateRenderGate({ dom: null, source: {} });
  assert.equal(blind.pass, false);
  assert.equal(blind.failed.length, renderGate.FACTS.length);
  assert.ok(blind.failed.includes("place_names_plausible"));
});

// ---------------------------------------------------------------------------
// 5. THE CONTESTED ADDRESS
// ---------------------------------------------------------------------------
//
// resolveVerifiedFacts, run against the real Air Creation record on
// 2026-08-11, returned this without being asked:
//
//   { field: "address", resolution: "absent", observations: [
//       { observer: "google_gbp",    value: "11616 Cedar Park Ave, Baton Rouge, LA 70809, USA" },
//       { observer: "business_self", value: { streetAddress: "St Ferdinand St", postalCode: "70802" } } ] }
//   { field: "postal_code", resolution: "absent", observations: [ 70809, 70802 ] }
//
// The mirror then published the Google spelling anyway, byte-identical to the
// stored contract — trailing "USA" and all, which is the proof it never came
// through the resolver. `vf.address || contract.address` reached past the
// verdict.

test("a contested street withholds the address — neither spelling is published", () => {
  assert.deepEqual(withheldAddress(["address"]), {
    withhold: true, reason: "sources_disagree_on_street",
  });
  assert.deepEqual(withheldAddress(["address", "postal_code", "industry"]), {
    withhold: true, reason: "sources_disagree_on_street",
  });
});

test("a contested city withholds the street too — an address is only an address inside a city", () => {
  assert.deepEqual(withheldAddress(["city"]), {
    withhold: true, reason: "sources_disagree_on_city",
  });
  assert.equal(withheldAddress(["state"]).withhold, true);
  assert.equal(withheldAddress(["postal_code"]).withhold, true);
});

test("a clean address is untouched, and silence is not a conflict", () => {
  // Nobody observed the field -> the mined contract still carries it forward.
  // That is what CONTRACT_STRING_FACTS is for and it must not change.
  assert.deepEqual(withheldAddress([]), { withhold: false, reason: "" });
  assert.deepEqual(withheldAddress(undefined), { withhold: false, reason: "" });
  assert.deepEqual(withheldAddress(["industry", "rating", "hours"]), { withhold: false, reason: "" });
});

test("with the address withheld, the map and NAP fall back to city and state", () => {
  const html = render({ services: [{ name: "AC Repair" }] });
  assert.ok(html.includes("Baton Rouge"), "the market still names the place");
  assert.ok(!html.includes("11616"), "no street address is published");
  assert.ok(/maps\/dir\/\?api=1/.test(html), "directions still work from the city");
});

// ---------------------------------------------------------------------------
// 6. THE FALLBACK ITSELF — the line that overruled the verdict
// ---------------------------------------------------------------------------
//
// `String(vf[key] || contract[key] || "")` is where a withheld address came back
// from the dead. These drive the real build lane with every resolver injected,
// so they measure the REQUEST that would have been handed to mirror() — not a
// helper's opinion about it.

/** The Air Creation shape: a stored contract carrying Google's spelling. */
const AIR = {
  prospect_id: "place-air",
  business_name: "Air Creation Heating & Cooling, LLC",
  industry: "hvac",
  site: "https://aircreationheatingandcooling.com/",
  email: "aircreation@ymail.com",
  logo: "https://aircreationheatingandcooling.com/logo.png",
  city: "Baton Rouge",
  state: "LA",
  place_id: "ChIJPY8VkrO1JoYRteo4JrZ-kuc",
  verified_facts: {
    business_name: "Air Creation Heating & Cooling, LLC",
    city: "Baton Rouge",
    state: "LA",
    phone: "(225) 313-0550",
    address: "11616 Cedar Park Ave, Baton Rouge, LA 70809, USA",
    postal_code: "70809",
    place_id: "ChIJPY8VkrO1JoYRteo4JrZ-kuc",
  },
};

function airDeps(resolverResult) {
  const captured = {};
  return {
    captured,
    resolveSocials: async () => ({ socials: [], source: "not_attempted" }),
    resolveBuildableDonor: () => ({ ok: true, donor: "hvac-brandforge", vertical: "hvac" }),
    resolveVerifiedFacts: async () => resolverResult,
    harvestClientPhotos: async () => ({ ok: true, photos: [] }),
    mirror: async (req) => {
      Object.assign(captured, { req });
      return {
        status: 200,
        body: {
          ok: true, revealable: true,
          preview_url: `https://${req.slug}.wss-ai.com/`,
          checks: { content: { status: "injected", sections: 3 } },
        },
      };
    },
  };
}

/** What the real resolver returned for Air Creation on 2026-08-11. */
const CONFLICTED = {
  ok: false,
  missing_required: ["industry"],
  facts: { business_name: "Air Creation Heating & Cooling, LLC", city: "Baton Rouge", state: "LA", phone: "(225) 313-0550" },
  content: { services: ["AC Repair"] },
  coverage: {},
  conflicts: [
    { status: "conflict", field: "address", class: "nap", resolution: "absent" },
    { status: "conflict", field: "postal_code", class: "nap", resolution: "absent" },
  ],
  withheld: [],
};

test("a conflicted address is not republished from the stored contract", async () => {
  const d = airDeps(CONFLICTED);
  const out = await buildMirrorForProspect(AIR, { deps: d });
  assert.equal(out.ok, true, "the mirror still builds — it just builds without a street");

  const facts = d.captured.req.facts;
  assert.equal(facts.address, undefined,
    "the resolver said the sources disagree; the contract must not overrule it");
  assert.equal(facts.postal_code, undefined, "the ZIP was contested too (70809 vs 70802)");
  assert.equal(out.address_withheld, "sources_disagree_on_street",
    "and the build row says WHY, so nobody 'fixes' this back into the defect");

  // The market survives — a withheld street is not a withheld business.
  assert.equal(facts.city, "Baton Rouge");
  assert.equal(facts.state, "LA");
  assert.equal(facts.place_id, "ChIJPY8VkrO1JoYRteo4JrZ-kuc", "an uncontested fact is untouched");
});

test("an unobserved address still carries forward from the contract — silence is not conflict", async () => {
  // Nobody looked, so there is nothing to disagree about. This is the whole
  // reason CONTRACT_STRING_FACTS exists and it must keep working.
  const d = airDeps({
    ok: true,
    facts: { business_name: AIR.business_name, city: "Baton Rouge", state: "LA", phone: "(225) 313-0550" },
    content: { services: ["AC Repair"] },
    coverage: {},
    conflicts: [],
    withheld: [{ field: "address", class: "nap", reason: "no_observation" }],
  });
  const out = await buildMirrorForProspect(AIR, { deps: d });
  assert.equal(d.captured.req.facts.address, "11616 Cedar Park Ave, Baton Rouge, LA 70809, USA");
  assert.equal(out.address_withheld, undefined);
});
