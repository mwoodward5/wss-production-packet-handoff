"use strict";

/**
 * THREE DEFECTS A STRANGER SEES BEFORE THEY READ A WORD OF COPY.
 *
 * All three were found by RENDERING a finished mirror, not by reading code, and
 * every one of them had passed QC. They are grouped here because they share a
 * shape: each is a value that survived every gate we had while being visibly
 * wrong on the page.
 *
 *   1. The hours table read "Hours | Monday: 8:30 AM - 5:00 PM" seven times —
 *      the row header was the literal word "Hours" and the day was crammed into
 *      the value cell. The same missing day silently dropped the schema.org
 *      opening hours ENTIRELY.
 *   2. The coverage block offered "Kansas, MO" and "Delaware, KS" as nearby
 *      towns for a Kansas City plumber.
 *   3. A live call to Riley resized the logo with transform: scale(2.5), which
 *      enlarges paint and not layout, so the mark hung off the header.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  normalizeHours, buildContentHtml, buildJsonLd,
} = require("../lib/mirror-engine/content-inject.js");
const { nearbyCities, cleanPlaceName, placeDescriptor } = require("../lib/mirror-engine/nearby-cities.js");
const { buildElementCatalog, validateOverrideCss, composeOverrideCss } = require("../lib/site-change-plan.js");

// ---------------------------------------------------------------------------
// 1. THE HOURS TABLE
// ---------------------------------------------------------------------------

// This is verbatim what Google's regularOpeningHours.weekdayDescriptions gives
// us, and it is the shape every mined lead arrives in.
const GOOGLE_WEEKDAYS = [
  "Monday: 8:30 AM – 5:00 PM",
  "Tuesday: 8:30 AM – 5:00 PM",
  "Wednesday: 8:30 AM – 5:00 PM",
  "Thursday: 8:30 AM – 5:00 PM",
  "Friday: 8:30 AM – 5:00 PM",
  "Saturday: Closed",
  "Sunday: Closed",
];

test("Google's one-string day is split, so the day is the row header and not the value", () => {
  const rows = normalizeHours(GOOGLE_WEEKDAYS);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[0], { day: "monday", text: "8:30 AM – 5:00 PM" });
  assert.deepEqual(rows[6], { day: "sunday", text: "Closed" });
  assert.equal(rows.filter((r) => !r.day).length, 0, "no row may reach the page without a day");
  assert.equal(rows.some((r) => /monday/i.test(r.text)), false, "the day must not be left in the value too");
});

test("a leading word that is not a day is never promoted to one", () => {
  // "Hours: by appointment" is not a Tuesday. Inventing a day here would be a
  // fabricated fact about when a business is open — the exact class of lie the
  // TRUTH LAW exists to refuse.
  assert.deepEqual(normalizeHours(["Hours: by appointment only"]), [{ day: "", text: "Hours: by appointment only" }]);
  assert.deepEqual(normalizeHours(["Open 24/7"]), [{ day: "", text: "Open 24/7" }]);
});

test("the rendered table puts the day in <th> and the time in <td>", () => {
  const html = buildContentHtml({
    content: { hours: GOOGLE_WEEKDAYS },
    facts: { business_name: "Poor John's Plumbing", city: "Parkville", state: "MO" },
    market: "Parkville, MO",
  });
  const table = /<table class="wss-c__hours">[\s\S]*?<\/table>/.exec(html);
  assert.ok(table, "the hours table must render");
  const cells = [...table[0].matchAll(/<th scope="row">([^<]*)<\/th><td>([^<]*)<\/td>/g)]
    .map((m) => [m[1], m[2]]);
  assert.equal(cells.length, 7);
  assert.deepEqual(cells[0], ["Monday", "8:30 AM – 5:00 PM"]);
  assert.deepEqual(cells[5], ["Saturday", "Closed"]);
  // The regression itself: every row header was the word "Hours".
  assert.equal(cells.filter(([th]) => th === "Hours").length, 0);
});

test("a dayless note spans the table instead of sitting under a header it does not answer", () => {
  const html = buildContentHtml({
    content: { hours: ["Hours: by appointment only"] },
    facts: { business_name: "X", city: "Parkville", state: "MO" },
    market: "Parkville, MO",
  });
  assert.match(html, /<tr><td colspan="2">Hours: by appointment only<\/td><\/tr>/);
  assert.doesNotMatch(html, /<th scope="row">Hours<\/th>/);
});

test("the markup and the structured data agree — schema names every day the table shows open", () => {
  // The empty day did not just look wrong: buildJsonLd drops any row whose day
  // it cannot name, so openingHoursSpecification was omitted ENTIRELY on every
  // mirror built from a Places packet. Hours are among the strongest local
  // signals a trade has, and we were publishing none.
  const ld = buildJsonLd({ content: { hours: GOOGLE_WEEKDAYS }, facts: {} });
  const biz = ld["@graph"].find((n) => String(n["@type"]).includes("LocalBusiness"));
  const spec = biz.openingHoursSpecification;
  assert.ok(Array.isArray(spec), "the schema must carry opening hours");
  assert.deepEqual(spec.map((s) => s.dayOfWeek), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  assert.equal(spec[0].opens, "08:30");
  assert.equal(spec[0].closes, "17:00");
  // Saturday and Sunday are CLOSED in the table, and schema.org expresses a
  // closed day by omission. Asserting opens/closes for them would be the
  // markup and the data disagreeing in the direction that costs a call.
  assert.equal(spec.some((s) => /Saturday|Sunday/.test(s.dayOfWeek)), false);
});

test("an around-the-clock trade still says so in both places", () => {
  const ld = buildJsonLd({ content: { hours: ["Monday: Open 24 hours", "Tuesday: Open 24 hours"] }, facts: {} });
  const biz = ld["@graph"].find((n) => String(n["@type"]).includes("LocalBusiness"));
  assert.deepEqual(biz.openingHoursSpecification.map((s) => [s.dayOfWeek, s.opens, s.closes]), [
    ["Monday", "00:00", "23:59"],
    ["Tuesday", "00:00", "23:59"],
  ]);
});

// ---------------------------------------------------------------------------
// 2. NEARBY TOWNS
// ---------------------------------------------------------------------------

test("the Census's own clean name survives — 'Kansas City' is not 'Kansas'", () => {
  // The strip used to be case-INSENSITIVE, so it ate the "City" that belongs to
  // the name. A plumber's site naming "Kansas, KS" as a nearby town is the
  // whole "we'd look stupid" category in four characters.
  assert.equal(cleanPlaceName("Kansas City city", "Kansas City"), "Kansas City");
  assert.equal(cleanPlaceName("North Kansas City city", "North Kansas City"), "North Kansas City");
  assert.equal(cleanPlaceName("Oklahoma City city", "Oklahoma City"), "Oklahoma City");
  assert.equal(cleanPlaceName("Jersey City city", "Jersey City"), "Jersey City");
});

test("the Census's LAYER suffix is still stripped, in the lower case it is written in", () => {
  assert.equal(cleanPlaceName("Stratford town", "Stratford"), "Stratford");
  assert.equal(cleanPlaceName("Canton charter township", "Canton"), "Canton");
  assert.equal(cleanPlaceName("Trumbull Center CDP", "Trumbull Center"), "Trumbull Center");
  // The consolidated-city "balance" record is the one place BASENAME is dirty.
  assert.equal(cleanPlaceName("Indianapolis city (balance)", "Indianapolis city (balance)"), "Indianapolis");
  assert.equal(cleanPlaceName("Milford city (balance)", "Milford city (balance)"), "Milford");
});

test("the descriptor is read from the gap between NAME and BASENAME", () => {
  assert.equal(placeDescriptor({ NAME: "Kansas City city", BASENAME: "Kansas City" }), "city");
  assert.equal(placeDescriptor({ NAME: "Canton charter township", BASENAME: "Canton" }), "charter township");
  assert.equal(placeDescriptor({ NAME: "Beaverton-Hillsboro CCD", BASENAME: "Beaverton-Hillsboro" }), "ccd");
});

/** A Census geocoder whose every probe answers with the same record. */
function censusStub(layer, hit) {
  return async () => ({
    ok: true,
    json: async () => ({ result: { geographies: { [layer]: [hit] } } }),
  });
}

const KC = { lat: 39.0997, lng: -94.5786 };

test("a business is never listed as a town near itself", () => {
  // The truncation cost us twice: "Kansas City" shortened to "Kansas" no longer
  // matched the excludeCity either, so the business's OWN city was printed as a
  // neighbouring town two miles away.
  const hit = {
    NAME: "Kansas City city", BASENAME: "Kansas City", STATE: "29",
    CENTLAT: "+39.1235116", CENTLON: "-094.5786000",
  };
  return nearbyCities({ ...KC, excludeCity: "Kansas City", count: 5, fetchImpl: censusStub("Incorporated Places", hit) })
    .then((out) => assert.deepEqual(out, [], "its own city must be excluded, not renamed and kept"));
});

test("a Census County Division is refused — it is a grid, not a town", async () => {
  // "Beaverton-Hillsboro, OR" and "Northwest Clackamas, OR" were both offered
  // as neighbouring towns around Portland. Nobody lives in either.
  const hit = {
    NAME: "Beaverton-Hillsboro CCD", BASENAME: "Beaverton-Hillsboro", STATE: "41",
    CENTLAT: "+45.4900000", CENTLON: "-122.8000000",
  };
  const out = await nearbyCities({ lat: 45.5152, lng: -122.6784, count: 5, fetchImpl: censusStub("County Subdivisions", hit) });
  assert.deepEqual(out, []);
});

test("a survey township is refused where a township is not a place people live", async () => {
  const hit = {
    NAME: "Delaware township", BASENAME: "Delaware", STATE: "20",
    CENTLAT: "+39.2000000", CENTLON: "-094.9000000",
  };
  const out = await nearbyCities({ ...KC, count: 5, fetchImpl: censusStub("County Subdivisions", hit) });
  assert.deepEqual(out, [], "'Delaware, KS' is a county-map label, not a neighbouring town");
});

test("a township IS kept where it is the municipality people name", async () => {
  // Cherry Hill, NJ is a township and is exactly how its residents write their
  // address. Refusing every township everywhere would have been the cure that
  // emptied New Jersey's coverage block.
  const hit = {
    NAME: "Cherry Hill township", BASENAME: "Cherry Hill", STATE: "34",
    CENTLAT: "+39.9000000", CENTLON: "-075.0300000",
  };
  const out = await nearbyCities({ lat: 39.9348, lng: -75.0307, count: 5, fetchImpl: censusStub("County Subdivisions", hit) });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Cherry Hill");
  assert.equal(out[0].state, "NJ");
});

test("a New England town still resolves — the reason County Subdivisions are consulted at all", async () => {
  const hit = {
    NAME: "Stratford town", BASENAME: "Stratford", STATE: "09",
    CENTLAT: "+41.2000000", CENTLON: "-073.1300000",
  };
  const out = await nearbyCities({ lat: 41.3, lng: -73.13, count: 5, fetchImpl: censusStub("County Subdivisions", hit) });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Stratford");
  assert.equal(out[0].state, "CT");
});

test("a place we cannot name a state for is omitted, not printed half-resolved", async () => {
  const hit = { NAME: "Somewhere city", BASENAME: "Somewhere", STATE: "99", CENTLAT: "+39.1", CENTLON: "-094.6" };
  const out = await nearbyCities({ ...KC, count: 5, fetchImpl: censusStub("Incorporated Places", hit) });
  assert.deepEqual(out, [], "'Somewhere, ' is not a town anybody can drive to");
});

test("a failing Census yields no towns rather than invented ones", async () => {
  const out = await nearbyCities({ ...KC, count: 5, fetchImpl: async () => ({ ok: false }) });
  assert.deepEqual(out, []);
});

// ---------------------------------------------------------------------------
// 3. THE SCALED LOGO
// ---------------------------------------------------------------------------

const SHELL = '<!doctype html><html><head><meta property="og:image" content="/assets/client-logo.png"></head><body><div id="root"></div></body></html>';
const BUNDLE = 'e("header",{className:"fixed"},e("div",null,e("a",{href:"#top"},e("img",{src:"/assets/client-logo.png"}))),e("a",{href:"tel:4068557131"})),e("section",{id:"top"})';

const catalog = () => buildElementCatalog({ "index.html": SHELL }, BUNDLE);
const logoImg = () => catalog().find((e) => /^header img/.test(e.selector));

test("the logo's catalog entry steers a resize to height, not to scale", () => {
  // The planner only ever sees this note. If it does not say how to resize the
  // logo, the model reaches for transform: scale() — which is what happened.
  const note = logoImg().note;
  assert.match(note, /height/i);
  assert.match(note, /max-width/i);
  assert.match(note, /NOT transform:scale/i);
});

test("'make the logo twice as big' now produces a rule that moves the layout box", () => {
  const css = composeOverrideCss(
    { op: "style_override", target: logoImg().id, declarations: "height: 96px; max-width: 100%;" },
    catalog(),
  );
  assert.match(css, /height: 96px/);
  const checked = validateOverrideCss(css, { elements: catalog(), assets: [] });
  assert.equal(checked.rules.length, 1);
});

test("transform: scale() on the logo is refused, with a reason a caller can act on", () => {
  // Measured in Chromium at 1200px: scale(2.5) leaves the layout box 147x40
  // while painting 367x100, putting the mark's left edge at -90px. The header
  // does not grow, so the logo is simply cut off.
  const elements = catalog();
  assert.throws(
    () => validateOverrideCss('header img[src*="client-logo"] { transform: scale(2.5) !important; }', { elements, assets: [] }),
    (err) => {
      assert.match(err.message, /layout box/);
      assert.match(err.message, /height/);
      assert.equal(err.planRefusal, true, "Riley must be able to say this out loud");
      assert.match(err.say, /bigger/i);
      return true;
    },
  );
});

test("every shape of in-place scaling on the logo is caught, including inside @media", () => {
  const elements = catalog();
  const refused = [
    'header img[src*="client-logo"] { transform: scale(2); }',
    'header img[src*="client-logo"] { -webkit-transform: scale(2); }',
    'header img[src*="client-logo"] { scale: 2.5; }',
    'header img[src*="client-logo"] { transform: scaleX(2); }',
    '@media (min-width:900px){ header img[src*="client-logo"] { transform:scale(2); } }',
    // The wrapper and the flex row have the same layout problem.
    'header a:has(img[src*="client-logo"]) { transform: scale(2); }',
  ];
  for (const css of refused) {
    assert.throws(() => validateOverrideCss(css, { elements, assets: [] }), /layout box/, css);
  }
});

test("the refusal is narrow — moving the logo, and scaling anything else, still work", () => {
  const elements = catalog();
  // Nudging the logo across the header is a real request with no such problem.
  validateOverrideCss('header img[src*="client-logo"] { transform: translateX(12px); }', { elements, assets: [] });
  validateOverrideCss('header img[src*="client-logo"] { transform: rotate(3deg); }', { elements, assets: [] });
  // The hero is not the logo; scaling its video is a legitimate look change.
  validateOverrideCss("section#top video, section#top img { transform: scale(1.1); }", { elements, assets: [] });
});

test("a redundant selector naming ONE branch of the logo pair is still the same element", () => {
  // The catalog offers the logo as a comma pair (client-logo, brand-logo). A
  // model that echoes the branch matching this client's actual file is being
  // redundant, not wrong — comparing against the whole string refused it and
  // failed a live call with a message about selector blocks.
  const elements = catalog();
  const css = composeOverrideCss(
    { op: "style_override", target: logoImg().id, declarations: 'header img[src*="client-logo"] { height: 96px; }' },
    elements,
  );
  assert.match(css, /height: 96px/);
  validateOverrideCss(css, { elements, assets: [] });
});

test("a redundant selector naming a DIFFERENT element is still a real disagreement", () => {
  assert.throws(
    () => composeOverrideCss(
      { op: "style_override", target: logoImg().id, declarations: "section#top { height: 96px; }" },
      catalog(),
    ),
    /must not contain a selector block/,
  );
});
