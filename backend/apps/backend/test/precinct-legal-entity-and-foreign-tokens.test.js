"use strict";

/**
 * test/precinct-legal-entity-and-foreign-tokens.test.js
 *
 * THE SECOND SWEEP OF THE FLEET, 2026-08-11.
 *
 * Commit 344b2aa stopped a mirror printing "9, LA" as a town. Sweeping every
 * live host again found the same class of defect wearing WORDS — strings with
 * letters in them that pass every rule the first fix wrote, and are still not
 * towns — plus one entirely separate leak on two more hosts.
 *
 * The towns, live, on real customers' mirrors:
 *
 *   city-air-experts-…-charl   "12, Paw Creek, NC"  "3, Steele Creek, NC"  "11, Long Creek, NC"
 *   eyman-plumbing-…-la-vista  "Richland VIII, NE"  "Gilmore II, NE"  "Platford-Springfield I, NE"
 *   titanium-hvac-omaha        "Papillion Second II, NE"  "Chicago, NE"  "Jefferson, NE"
 *   holt-plumbing-…-nashville  "Nashville-Davidson metropolitan government, TN"
 *   maxwells-…-evans           "Augusta-Richmond County consolidated government, GA"
 *
 * The services, live, on two more:
 *
 *   cooper-perry-plumbing-tulsa      service card AND schema.org Service: "${child.title}"
 *   goodson-plumbing-services-boise  the same pair
 *
 * Everything asserted below about the Census was PROBED at each client's own
 * coordinates on 2026-08-11, and the records are quoted verbatim where used.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { implausibleReason, isPlausiblePlaceName } = require("../lib/mirror-engine/place-names.js");
const { nearbyCities, cleanPlaceName } = require("../lib/mirror-engine/nearby-cities.js");
const { carriesTemplateToken } = require("../lib/mirror-engine/tokens.js");
const { buildContentHtml, buildJsonLd } = require("../lib/mirror-engine/content-inject.js");
const renderGate = require("../lib/render-gate.js");
const { serviceName } = require("../lib/mirror-lane-build.js");

// ---------------------------------------------------------------------------
// 1. THE PREDICATE — the shape rules, and what they must never eat
// ---------------------------------------------------------------------------

test("a merged city-county's legal name is not a town", () => {
  // Both shipped, verbatim, on live customer mirrors.
  assert.equal(implausibleReason("Nashville-Davidson metropolitan government"), "government_entity");
  assert.equal(implausibleReason("Augusta-Richmond County consolidated government"), "government_entity");
  assert.equal(implausibleReason("Louisville/Jefferson County metro government"), "government_entity");
  assert.equal(implausibleReason("Athens-Clarke County unified government (balance)"), "government_entity");
});

test("the government rule is anchored at the end and cannot reach inside a name", () => {
  // Government Camp, OR is a real place, and it is the exact string that would
  // die to a substring match.
  assert.equal(implausibleReason("Government Camp"), "");
  assert.equal(implausibleReason("Government Camp CDP".replace(/ CDP$/, "")), "");
  assert.equal(implausibleReason("Fort Governor"), "");
});

test("a number and a comma leading a name is a numbered civil township", () => {
  // Census, Mecklenburg County NC: NAME "Township 12, Paw Creek", BASENAME
  // "12, Paw Creek". The BASENAME is what got published.
  assert.equal(implausibleReason("12, Paw Creek"), "numbered_division");
  assert.equal(implausibleReason("3, Steele Creek"), "numbered_division");
  assert.equal(implausibleReason("11, Long Creek"), "numbered_division");
  assert.equal(implausibleReason("1, Charlotte"), "numbered_division");
});

test("the comma is the discriminator, so a town that starts with a number lives", () => {
  // A town name may begin with a number. It never begins with a number and a
  // comma — that punctuation is the Census's, not a resident's.
  for (const real of ["29 Palms", "100 Mile House", "1000 Islands", "7 Points"]) {
    assert.equal(implausibleReason(real), "", `${real} must survive`);
  }
});

test("an administrative label with a number after it is a ballot, not an address", () => {
  for (const n of ["District 9", "Ward 3", "Beat 5", "Precinct 2", "Township 11",
    "Township 11, Long Creek", "Magisterial District 2", "Militia District 1465", "Zone 4"]) {
    assert.equal(implausibleReason(n), "numbered_division", `${n} must be refused`);
  }
});

test("the number is required, which is what keeps the real towns named Ward alive", () => {
  // Ward, Arkansas (pop. ~4,900), Ward, Colorado and Ward, South Carolina are
  // towns. "Ward 3" is a voting district. The digit is the whole difference.
  for (const real of ["Ward", "District Heights", "Township Line", "Precinct Hill", "Division"]) {
    assert.equal(implausibleReason(real), "", `${real} must survive`);
  }
});

test("a trailing Roman numeral is Nebraska's precinct numbering", () => {
  // Census, Sarpy County NE: NAME "Richland VIII precinct", BASENAME "Richland VIII".
  for (const n of ["Richland VIII", "Gilmore II", "Platford-Springfield I",
    "Papillion Second II", "Bellevue Second IV", "LaPlatte I", "Highland II", "Richland VII"]) {
    assert.equal(implausibleReason(n), "roman_numeral_division", `${n} must be refused`);
  }
});

test("the Roman rule is strict, upper-case and standalone — so real names survive", () => {
  const real = [
    // Last words that begin with Roman letters but are not numerals.
    "Mount Vernon", "El Cajon", "Sun City", "Lake Mary", "Del Mar", "Santa Cruz",
    "Truth or Consequences", "Mill Creek", "Cedar City", "Ville Platte", "Miami Lakes",
    // Lower case is never a Census numeral.
    "Coeur d'Alene", "Sault Ste. Marie", "Isle of Wight",
    // A trailing state code that is also a valid numeral: DC, MD, MI, VI.
    "Washington DC", "Bethesda MD", "Detroit MI", "St. Croix VI",
  ];
  for (const n of real) assert.equal(implausibleReason(n), "", `${n} must survive`);
});

// ---------------------------------------------------------------------------
// 1b. THE RULE THAT WAS DELIBERATELY NOT WRITTEN
// ---------------------------------------------------------------------------
//
// The sweep also found "Chicago, NE" and "Jefferson, NE". The tempting rule —
// refuse a town whose name is a US state or a far-off major city — is refused
// HERE and handled at the source instead, on the Census's own class code,
// because these are all real incorporated towns and every one of them is
// exactly what the nearby-towns rail exists to name.

test("towns named after states and other cities are real towns and must survive", () => {
  const real = [
    "Nevada", "Delaware", "California", "Wyoming", "Indiana", "Kansas", "Michigan",
    "Oregon", "Florida", "Ohio", "Montana", "Washington",
    "Manhattan", "Cleveland", "Miami", "Denver", "Memphis", "Boston", "Atlanta",
    "Houston", "Chicago", "Jefferson", "Paris", "Lebanon", "Peru",
  ];
  for (const n of real) {
    assert.equal(implausibleReason(n), "", `${n} is a real US town and must survive`);
    assert.equal(isPlausiblePlaceName(n), true);
  }
});

// ---------------------------------------------------------------------------
// 2. THE SOURCE — refused on the CLASS, read from the field that carries it
// ---------------------------------------------------------------------------

function censusStub(layer, hit) {
  return async () => ({ ok: true, json: async () => ({ result: { geographies: { [layer]: [hit] } } }) });
}

const OMAHA = { lat: 41.2565, lng: -95.9345 };
const CHARLOTTE = { lat: 35.2271, lng: -80.8431 };

test("a Nebraska precinct named Chicago is refused by its LSADC, not by its name", async () => {
  // Probed live around Omaha: NAME "Chicago precinct", LSADC 29. Two more from
  // the same ring: "Jefferson precinct", "Papillion Second II precinct".
  const out = await nearbyCities({
    ...OMAHA, excludeCity: "Omaha", count: 6,
    fetchImpl: censusStub("County Subdivisions", {
      NAME: "Chicago precinct", BASENAME: "Chicago", LSADC: "29", STATE: "31",
      CENTLAT: "+41.3000", CENTLON: "-096.1000",
    }),
  });
  assert.deepEqual(out, [], "nobody in Nebraska drives in from the Chicago precinct");
});

test("the SAME NAME as an incorporated place is published — the class is what was refused", async () => {
  // This is the proof that the rule is not a name blocklist. Chicago Heights,
  // Cleveland TN and Manhattan KS are real towns; so, here, is an incorporated
  // Nebraska place called Chicago. LSADC 25 is a city.
  const out = await nearbyCities({
    ...OMAHA, excludeCity: "Omaha", count: 6,
    fetchImpl: censusStub("Incorporated Places", {
      NAME: "Chicago city", BASENAME: "Chicago", LSADC: "25", STATE: "31",
      CENTLAT: "+41.3000", CENTLON: "-096.1000",
    }),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Chicago");
  assert.equal(out[0].state, "NE");
});

test("a numbered North Carolina civil township is refused", async () => {
  // Probed live around Charlotte: NAME "Township 11, Long Creek", LSADC 45.
  const out = await nearbyCities({
    ...CHARLOTTE, excludeCity: "Charlotte", count: 6,
    fetchImpl: censusStub("County Subdivisions", {
      NAME: "Township 11, Long Creek", BASENAME: "11, Long Creek", LSADC: "45", STATE: "37",
      CENTLAT: "+35.3000", CENTLON: "-080.9500",
    }),
  });
  assert.deepEqual(out, []);
});

test("a numbered district and a Census county division are refused by code as well as descriptor", async () => {
  for (const hit of [
    { NAME: "District 9", BASENAME: "9", LSADC: "28", STATE: "47" },
    { NAME: "Augusta CCD", BASENAME: "Augusta", LSADC: "22", STATE: "13" },
  ]) {
    const out = await nearbyCities({
      lat: 33.5337, lng: -82.1307, count: 6,
      fetchImpl: censusStub("County Subdivisions", { ...hit, CENTLAT: "+33.47", CENTLON: "-082.01" }),
    });
    assert.deepEqual(out, [], `${hit.NAME} must not be published`);
  }
});

test("a consolidated government resolves to the CITY inside it, not the corporation", () => {
  // 344b2aa stripped the trailing legal words and published "Nashville-Davidson"
  // and "Augusta-Richmond County". Both are still the merged entity's name.
  // The city is the part before the join, every time.
  assert.equal(
    cleanPlaceName("Nashville-Davidson metropolitan government (balance)",
      "Nashville-Davidson metropolitan government (balance)"),
    "Nashville",
  );
  assert.equal(
    cleanPlaceName("Augusta-Richmond County consolidated government (balance)",
      "Augusta-Richmond County consolidated government (balance)"),
    "Augusta",
  );
  assert.equal(
    cleanPlaceName("Louisville/Jefferson County metro government (balance)",
      "Louisville/Jefferson County metro government (balance)"),
    "Louisville",
  );
});

test("the consolidated split fires only on that class — ordinary hyphenated towns are untouched", () => {
  assert.equal(cleanPlaceName("Winston-Salem city", "Winston-Salem"), "Winston-Salem");
  assert.equal(cleanPlaceName("Wilkes-Barre city", "Wilkes-Barre"), "Wilkes-Barre");
  assert.equal(cleanPlaceName("Soddy-Daisy city", "Soddy-Daisy"), "Soddy-Daisy");
  assert.equal(cleanPlaceName("Government Camp CDP", "Government Camp"), "Government Camp");
  assert.equal(cleanPlaceName("Kansas City city", "Kansas City"), "Kansas City");
});

// ---------------------------------------------------------------------------
// 3. THE RENDER — the rail and the areas list drop what they cannot name
// ---------------------------------------------------------------------------

const FACTS = {
  business_name: "Eyman Plumbing Heating & Air",
  city: "La Vista",
  state: "NE",
  phone: "(402) 291-5555",
  industry: "plumbing",
};

function render(content) {
  const out = buildContentHtml({
    content: { hours: ["Monday: 8:00 AM – 5:00 PM"], ...content },
    facts: FACTS,
    phoneDigits: "4022915555",
  });
  return typeof out === "string" ? out : String((out && (out.html || out.body)) || "");
}

const renderedTowns = (html) =>
  [...html.matchAll(/<span class="wss-c__neartown">([^<]*)<\/span>/g)].map((m) => m[1]);

test("the exact rail Eyman Plumbing published drops to its real towns", () => {
  const html = render({
    services: [{ name: "Drain Cleaning" }],
    nearby: [
      { name: "Richland VIII", state: "NE", miles: 3 },
      { name: "Gilmore II", state: "NE", miles: 4 },
      { name: "Fairview", state: "NE", miles: 5 },
      { name: "Omaha", state: "NE", miles: 6 },
      { name: "Platford-Springfield I", state: "NE", miles: 7 },
      { name: "Bellevue", state: "NE", miles: 8 },
    ],
  });
  assert.deepEqual(renderedTowns(html), ["Fairview, NE", "Omaha, NE", "Bellevue, NE"]);
});

test("a precinct or a corporation in the areas list is dropped, not printed", () => {
  const html = render({
    services: [{ name: "Drain Cleaning" }],
    areas: ["La Vista", "12, Paw Creek", "Nashville-Davidson metropolitan government", "Papillion", "Ward 3"],
  });
  assert.ok(html.includes("La Vista"));
  assert.ok(html.includes("Papillion"));
  assert.ok(!html.includes("Paw Creek"));
  assert.ok(!html.includes("metropolitan government"));
  assert.ok(!html.includes("Ward 3"));
});

// ---------------------------------------------------------------------------
// 4. THE GATE — the ninth fact refuses the pages that reached the owners
// ---------------------------------------------------------------------------

test("the gate refuses every one of the five rails found live", () => {
  const rails = [
    ["Pineville, NC", "12, Paw Creek, NC", "3, Steele Creek, NC", "11, Long Creek, NC"],
    ["Richland VIII, NE", "Gilmore II, NE", "Fairview, NE", "Platford-Springfield I, NE"],
    ["Papillion, NE", "Gretna, NE", "Papillion Second II, NE"],
    ["Hendersonville, TN", "Nashville-Davidson metropolitan government, TN"],
    ["North Augusta, SC", "Augusta-Richmond County consolidated government, GA"],
  ];
  for (const placeNames of rails) {
    const verdict = renderGate.checkPlaceNames({ placeNames, jsonld: [] });
    assert.equal(verdict.pass, false, `must refuse: ${placeNames.join(" | ")}`);
    assert.equal(verdict.fact, "place_names_plausible");
  }
});

test("the gate reads the schema surface too, and still passes clean rails", () => {
  assert.equal(renderGate.checkPlaceNames({
    placeNames: [],
    jsonld: [{ areaServed: [{ "@type": "City", name: "Richland VIII" }] }],
  }).pass, false);
  assert.equal(renderGate.checkPlaceNames({
    placeNames: ["Papillion, NE", "Gretna, NE", "Bellevue, NE"],
    jsonld: [{ areaServed: "Omaha, NE" }],
  }).pass, true);
});

// ---------------------------------------------------------------------------
// 5. SOMEBODY ELSE'S TEMPLATE, ARRIVING AS A SERVICE
// ---------------------------------------------------------------------------
//
// Cooper Perry Plumbing (Tulsa) and Goodson Plumbing (Boise) both serve a
// navigation menu whose own template never rendered. Their live HTML contains
// `<a ...>${child.title}</a>`, the resolver harvests service names from anchor
// text, and both mirrors published "${child.title}" and "${parent.title}" as
// service CARDS and as schema.org Service entries.

test("the token predicate knows every flavour and leaves real names alone", () => {
  for (const t of ["${child.title}", "06 ${parent.title}", "{{SERVICE}}", "{{ service.name }}", "<%= title %>"]) {
    assert.equal(carriesTemplateToken(t), true, `${t} must be recognised`);
  }
  for (const real of ["Drain Cleaning", "24/7 Emergency Plumber", "Water Heater Repair & Service",
    "A/C Tune-Up (Spring Special)", "Trenchless Pipeline Repair"]) {
    assert.equal(carriesTemplateToken(real), false, `${real} is a real service`);
  }
});

test("serviceName refuses a token where its <> | guard never could", () => {
  assert.equal(serviceName("${child.title}"), "");
  assert.equal(serviceName("06 ${parent.title}"), "");
  assert.equal(serviceName("- [24/7 Emergency Plumber](https://x.test/e/)"), "24/7 Emergency Plumber");
});

test("a token service is dropped from the rendered cards", () => {
  const html = render({
    services: [
      { name: "Drain Cleaning" },
      { name: "${child.title}" },
      { name: "06 ${parent.title}" },
      { name: "Water Heater Repair" },
    ],
  });
  assert.ok(html.includes("Drain Cleaning"));
  assert.ok(html.includes("Water Heater Repair"));
  assert.ok(!html.includes("child.title"), "the prospect's broken markup must not be a service card");
  assert.ok(!html.includes("parent.title"));
});

test("a token service is dropped from the JSON-LD Service graph as well", () => {
  const json = buildJsonLd({
    content: {
      services: [{ name: "Drain Cleaning" }, { name: "${child.title}" }, { name: "${parent.title}" }],
    },
    facts: FACTS,
    siteUrl: "https://wss-test-eyman.example.com",
  });
  const text = typeof json === "string" ? json : JSON.stringify(json);
  assert.ok(text.includes("Drain Cleaning"));
  assert.ok(!text.includes("child.title"), "Google must not be handed the prospect's broken template");
  assert.ok(!text.includes("parent.title"));
});
