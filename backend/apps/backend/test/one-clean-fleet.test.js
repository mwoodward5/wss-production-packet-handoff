"use strict";

/**
 * test/one-clean-fleet.test.js — the four defect CLASSES found on the live
 * fleet on 2026-08-11, each pinned by the string that actually shipped.
 *
 *   1. a service string is not a town      (Cooper Perry, Tulsa)
 *   2. a donor may not name a town         (Monolith Tattoo, Nashville)
 *   3. a blog title is not a service       (Holt Plumbing, Nashville)
 *   4. a street address is the street      (Meyer Heating & Air, St. Louis)
 *
 * Every literal below was copied off the live host, not invented for the test.
 */

const test = require("node:test");
const assert = require("node:assert");

const { articleHeadlineReason, isSellableServiceName, filterServiceNames } =
  require("../lib/mirror-engine/service-names");
const { streetAddressOnly, dropCountry, carriesCountryTail } =
  require("../lib/mirror-engine/postal");
const { fenceAreasServed, clientAreaAllowlist, isAllowed } =
  require("../lib/mirror-engine/area-fence");
const { validateFacts, marketCity } = require("../lib/mirror-engine/facts");
const { salvagePlaceName } = require("../lib/mirror-engine/place-names");

/* ------------------------------------------------------------------ 3. blog */

test("the blog titles that shipped as Services are refused, with a reason", () => {
  const shipped = [
    // holt-plumbing-company-nashville, live JSON-LD
    ["Why Discolored Water Could Mean You Need Water Heater Repair", "advice_headline"],
    ["9 Benefits of Prompt Water Heater Repairs", "listicle_headline"],
    ["The Importance of Managing Water Heating Usage at Home", "advice_headline"],
    ["Plumber-Approved Tips to Curb Water Waste", "editorial_vocabulary"],
    ["3 Ways Plumbers Help Prevent Residential Floods", "listicle_headline"],
    ["How to Prevent Your Home's Pipes From Freezing This Winter", "advice_headline"],
    ["The Importance of Your Household's Water Heater Setting", "advice_headline"],
    ["and surrounding areas", "sentence_fragment"],
    // cooper-perry-plumbing-tulsa, live JSON-LD
    ["5 Tips for Finding a Reliable Emergency Plumbing Company", "listicle_headline"],
    ["When Should You Call a Professional for Plumbing Repair?", "question_headline"],
    ["What Should I Look for in Plumbing Services?", "question_headline"],
    // Found on the REBUILT fleet: Sears Heating and Cooling published
    // ["Contact Us", "Furnace Repair", "Furnace Replacement", "AC Repair"].
    ["Contact Us", "navigation_label"],
    ["About Us", "navigation_label"],
    ["Book Now", "navigation_label"],
    ["Service Areas", "navigation_label"],
    ["Our Work", "navigation_label"],
    // wss-test-larson-air-conditioning-scottsdale published this as its ONLY
    // schema.org Service. The advice-opener alternation ended in `)\s`, which
    // required a word after the stem, so a two-word headline was never caught.
    ["Why Larson", "advice_headline"],
    ["Why Us", "advice_headline"],
  ];
  for (const [label, reason] of shipped) {
    assert.equal(articleHeadlineReason(label), reason, `expected ${reason} for ${label}`);
  }
});

test("real service names on the live fleet survive untouched", () => {
  const real = [
    "Water Heater Repair", "Drain Cleaning", "Sewer Line Replacement",
    "Hydro Jetting", "Slab Leak Detection", "Gas Line Services", "Repiping",
    "Sump Pumps", "Backflow Testing", "Tankless Water Heaters",
    "Commercial Plumbing", "24/7 Emergency Service", "AC Installation",
    "Furnace Repair", "Duct Cleaning", "Tankless Water Heater Installation and Repair",
    // A leading integer and an embedded full stop are NORMAL in service names.
    "1 Day Bath Remodel", "St. Louis Drain Cleaning",
    // Short second-person names stay: the reader-address rule has a word floor.
    "Your Home Comfort Plan",
    // The tattoo/med-spa/salon verticals, which have no trade nouns at all.
    "Fine-Line Custom", "Blackwork & Bold", "Cover-Ups & Rework",
    // The navigation rule is WHOLE-LABEL, so a real service that merely
    // contains one of those words survives.
    "Emergency Service", "Contact-Free Estimates", "Home Comfort Team",
    "Gallery Wall Installation", "News Rack Repair", "Menu Board Signage",
  ];
  for (const name of real) {
    assert.equal(articleHeadlineReason(name), "", `refused a real service: ${name}`);
    assert.equal(isSellableServiceName(name), true);
  }
});

test("filterServiceNames keeps the services and names every casualty", () => {
  const { kept, dropped } = filterServiceNames([
    { name: "Water Heater Repair" },
    { name: "9 Benefits of Prompt Water Heater Repairs" },
    "Drain Cleaning",
    "and surrounding areas",
  ]);
  assert.deepEqual(kept.map((k) => (typeof k === "string" ? k : k.name)),
    ["Water Heater Repair", "Drain Cleaning"]);
  assert.deepEqual(dropped.map((d) => d.reason), ["listicle_headline", "sentence_fragment"]);
});

/* -------------------------------------------------------------- 4. address */

test("the exact address Meyer published loses its country and its duplicates", () => {
  const live = "11134 Lindbergh Business Ct Ste D, St. Louis, MO 63123, USA";
  assert.equal(carriesCountryTail(live), true);
  assert.equal(
    streetAddressOnly(live, { city: "St. Louis", state: "MO", postal: "63123" }),
    "11134 Lindbergh Business Ct Ste D",
  );
});

test("a component that does not match the published field is never peeled", () => {
  const live = "4809 S 31st W Ave, Tulsa, OK 74107";
  // Locality field says something else -> the city stays in the street line.
  assert.equal(
    streetAddressOnly(live, { city: "Broken Arrow", state: "OK", postal: "74107" }),
    "4809 S 31st W Ave, Tulsa",
  );
  // Nothing supplied at all -> only the country can ever be dropped.
  assert.equal(streetAddressOnly(live, {}), live);
});

test("peeling never returns a stub", () => {
  // Everything matches, so every component peels and nothing usable is left:
  // the answer is the country-stripped original, not an empty street.
  const out = streetAddressOnly("Tulsa, OK 74107, USA", { city: "Tulsa", state: "OK", postal: "74107" });
  assert.equal(out, "Tulsa, OK 74107");
});

test("dropCountry handles every spelling and touches nothing else", () => {
  assert.equal(dropCountry("1 Main St, Austin, TX 78701, USA"), "1 Main St, Austin, TX 78701");
  assert.equal(dropCountry("1 Main St, Austin, TX 78701, United States"), "1 Main St, Austin, TX 78701");
  assert.equal(dropCountry("1 Main St, Austin, TX 78701"), "1 Main St, Austin, TX 78701");
  // A street that merely contains the words is untouched.
  assert.equal(dropCountry("400 United States Ave, Camden, NJ"), "400 United States Ave, Camden, NJ");
});

test("validateFacts normalises the address whatever assembled the facts", () => {
  const out = validateFacts({
    facts: {
      business_name: "Meyer Heating and Air",
      industry: "hvac",
      city: "St. Louis",
      state: "MO",
      postal_code: "63123",
      address: "11134 Lindbergh Business Ct Ste D, St. Louis, MO 63123, USA",
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.facts.address, "11134 Lindbergh Business Ct Ste D");
  assert.equal(carriesCountryTail(out.facts.address), false);
});

/* ---------------------------------------------------------- 1. service/town */

test("the three stored markets that are not towns are salvaged or dropped", () => {
  // All three read off live prospect records on 2026-08-11. marketCity()
  // prefers this field over the NAP city on every marketing surface, so
  // whatever survives here IS the headline the owner reads.
  assert.equal(
    salvagePlaceName("Plumbing Repairs Tulsa", { businessName: "Cooper Perry Plumbing" }),
    "Tulsa",
  );
  assert.equal(
    salvagePlaceName("Fence Company Westfield", { businessName: "Draper Fence and Rail Co" }),
    "Westfield",
  );
  // Nothing but the business's own name and the words "service area" — no
  // assertion at all, and the caller falls back to the verified NAP city.
  assert.equal(
    salvagePlaceName("Galli Plumbing Services service area", { businessName: "Galli Plumbing Services - Tulsa" }),
    "",
  );
});

test("the Flint case still works: a real market survives the salvage", () => {
  assert.equal(salvagePlaceName("Austin", { businessName: "Flint Plumbing LLC" }), "Austin");
  assert.equal(salvagePlaceName("Plumbers Spokane", { businessName: "Bulldog Rooter" }), "Spokane");
  assert.equal(salvagePlaceName("HVAC Akron", { businessName: "Jennings Heating" }), "Akron");
  // Two-word and hyphenated towns are untouched.
  assert.equal(salvagePlaceName("Round Rock", {}), "Round Rock");
  assert.equal(salvagePlaceName("Winston-Salem", {}), "Winston-Salem");
  assert.equal(salvagePlaceName("The Woodlands", {}), "The Woodlands");
});

test("validateFacts drops a market that names no town, and keeps one that does", () => {
  const poisoned = validateFacts({
    facts: {
      business_name: "Cooper Perry Plumbing", industry: "plumbing",
      city: "Tulsa", state: "OK", service_area: "Plumbing Repairs Tulsa",
    },
  });
  assert.equal(poisoned.ok, true);
  assert.equal(poisoned.facts.service_area, "Tulsa");

  const hopeless = validateFacts({
    facts: {
      business_name: "Galli Plumbing Services - Tulsa", industry: "plumbing",
      city: "Broken Arrow", state: "OK", service_area: "Galli Plumbing Services service area",
    },
  });
  assert.equal(hopeless.ok, true);
  assert.equal("service_area" in hopeless.facts, false, "no assertion beats a wrong one");
  assert.equal(marketCity(hopeless.facts), "Broken Arrow", "the market falls back to the verified NAP city");

  const real = validateFacts({
    facts: {
      business_name: "Flint Plumbing LLC", industry: "plumbing",
      city: "Buda", state: "TX", service_area: "Austin",
    },
  });
  assert.equal(real.facts.service_area, "Austin");
  assert.equal(marketCity(real.facts), "Austin");
});

/* ------------------------------------------------------------- 2. the fence */

const TATTOO_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": ["TattooParlor", "LocalBusiness"],
  name: "Monolith Tattoo Co.",
  areaServed: [
    { "@type": "City", name: "Nashville" },
    { "@type": "City", name: "Nashville" },
    { "@type": "City", name: "Downtown Nashville" },
    { "@type": "City", name: "South Congress" },
    { "@type": "City", name: "Cedar Park" },
    { "@type": "City", name: "Round Rock" },
    { "@type": "City", name: "Pflugerville" },
  ],
  makesOffer: [
    { "@type": "Offer", itemOffered: { "@type": "Service", name: "Fine-Line Custom", areaServed: "Round Rock" } },
  ],
});

function tattooTree(extraBody = "") {
  return {
    "index.html": Buffer.from(
      `<!doctype html><html><head><title>Monolith Tattoo Co.</title></head><body>`
      + `<h1>Custom tattoos in Nashville</h1>${extraBody}`
      + `<script type="application/ld+json">${TATTOO_LD}<\/script></body></html>`,
      "utf8",
    ),
  };
}

const TATTOO_FACTS = { business_name: "Monolith Tattoo Co.", city: "Nashville", state: "TN" };
const TATTOO_CONTENT = { areas: ["Nashville"], nearby: [{ name: "Brentwood", state: "TN", miles: 9 }] };

test("the four Austin towns are removed and Nashville survives", () => {
  const files = tattooTree();
  const out = fenceAreasServed({ files, facts: TATTOO_FACTS, content: TATTOO_CONTENT });
  const shipped = JSON.parse(
    /application\/ld\+json[^>]*>([\s\S]*?)<\/script>/.exec(files["index.html"].toString("utf8"))[1],
  );
  assert.deepEqual(
    shipped.areaServed.map((a) => a.name),
    ["Nashville", "Nashville", "Downtown Nashville"],
  );
  // The nested Service.areaServed is fenced too — a leak is a leak at any depth.
  assert.equal("areaServed" in shipped.makesOffer[0].itemOffered, false);
  assert.deepEqual(
    [...new Set(out.report.removed.map((r) => r.name))].sort(),
    ["Cedar Park", "Pflugerville", "Round Rock", "South Congress"],
  );
  assert.equal(out.report.clean, true);
});

test("a measured neighbouring town is admitted; one beyond the ring is not", () => {
  const allow = clientAreaAllowlist({
    facts: TATTOO_FACTS,
    content: { nearby: [{ name: "Brentwood", miles: 9 }, { name: "Chattanooga", miles: 120 }] },
  });
  assert.equal(isAllowed("Brentwood", allow), true);
  assert.equal(isAllowed("Chattanooga", allow), false);
});

test("the client's own state, by code or by name, is a legitimate area", () => {
  const allow = clientAreaAllowlist({ facts: TATTOO_FACTS, content: {} });
  assert.equal(isAllowed("TN", allow), true);
  assert.equal(isAllowed("Tennessee", allow), true);
  assert.equal(isAllowed("Texas", allow), false);
});

test("a town wearing its state is the same claim", () => {
  const allow = clientAreaAllowlist({ facts: TATTOO_FACTS, content: TATTOO_CONTENT });
  assert.equal(isAllowed("Nashville, TN", allow), true);
  assert.equal(isAllowed("Round Rock, TX", allow), false);
});

test("a donor town VISIBLE in the copy fails the fence rather than reporting clean", () => {
  const files = tattooTree("<p>Proudly serving Round Rock and Cedar Park.</p>");
  const out = fenceAreasServed({ files, facts: TATTOO_FACTS, content: TATTOO_CONTENT });
  assert.equal(out.report.clean, false);
  assert.deepEqual(
    [...new Set(out.report.visible_residue.map((v) => v.name))].sort(),
    ["Cedar Park", "Round Rock"],
  );
});

test("malformed JSON-LD is reported, never rewritten by guesswork", () => {
  const files = {
    "index.html": Buffer.from(
      `<html><body><script type="application/ld+json">{ not json <\/script></body></html>`, "utf8",
    ),
  };
  const before = files["index.html"].toString("utf8");
  const out = fenceAreasServed({ files, facts: TATTOO_FACTS, content: TATTOO_CONTENT });
  assert.equal(files["index.html"].toString("utf8"), before);
  assert.equal(out.report.unparseable_blocks.length, 1);
  assert.equal(out.report.clean, true);
});

test("a build with no areaServed anywhere is left byte-identical", () => {
  const files = {
    "index.html": Buffer.from(
      `<html><body><script type="application/ld+json">{"@type":"LocalBusiness","name":"X"}<\/script></body></html>`,
      "utf8",
    ),
  };
  const before = files["index.html"].toString("utf8");
  const out = fenceAreasServed({ files, facts: TATTOO_FACTS, content: TATTOO_CONTENT });
  assert.equal(files["index.html"].toString("utf8"), before);
  assert.equal(out.report.removed_count, 0);
  assert.equal(out.report.clean, true);
});
