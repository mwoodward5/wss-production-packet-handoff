"use strict";

// test/market-city-vs-nap.test.js — THE MARKET IS NOT THE MAILING ADDRESS.
//
// THE INCIDENT (owner's rendered-DOM audit of the Flint Plumbing proof email,
// 2026-07-30). We shipped:
//
//     <title>Flint Plumbing LLC | Plumbing in Buda, TX</title>
//
// Buda is where Flint's Google listing is registered. Their OWN site is titled
// "Austin Plumbers: Local Family Owned - 40+ Years" and its machine-readable
// site description reads "Austin, Texas Plumber, Plumbing, Emergency Plumber".
// We took Google's `locality` — the right answer for an envelope — and used it
// as the marketing city, shrinking a 40-year Austin plumber to a suburb.
//
// The fix is a SPLIT, not a swap. Two fields, two sources, two destinations:
//
//   facts.service_area  <- the business's own first-party site (self_published:
//                          nobody knows their market better than they do).
//                          Drives CITY / <title> / hero headline / "Serving …".
//   facts.city          <- the independently verified NAP locality. Drives
//                          schema.org PostalAddress and the visible address
//                          block, and NOTHING else changes about it.
//
// TRUTH LAW: a service area is never inferred. No assertion => the NAP city,
// which is exactly what shipped before this field existed.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DONOR_ROOT = path.join(__dirname, "..", "boilerplates");
process.env.MIRROR_DONOR_ROOT = DONOR_ROOT;

const vf = require("../lib/mirror-engine/verified-facts");
const { isStatewideClaim, salvagePlaceName, eligibleMarketCity } = require("../lib/mirror-engine/place-names");
const { validateFacts, marketCity, addressCity, defaultHeroHeadline } = require("../lib/mirror-engine/facts");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { loadDonor } = require("../lib/mirror-engine/donor");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");
const contentInject = require("../lib/mirror-engine/content-inject");

const GOOGLE = vf.OBSERVER.GOOGLE_GBP;

// --- Flint's real shape, reduced to what these tests reason about ------------

const NAP_OBSERVATION = {
  business_name: "Flint Plumbing LLC",
  phone: "(512) 971-2445",
  address: "1132 Oyster Creek, Buda, TX 78610",
  city: "Buda",
  state: "TX",
  postal_code: "78610",
};

/**
 * A first-party page shaped like flintplumb.com: a "<City>, <State>" market
 * assertion inside the site's own machine-readable self-description, and a
 * PostalAddress that is NOT in it. Kept minimal on purpose — the point is the
 * assertion, not the page.
 */
function firstPartyHtml({ assertMarket = true } = {}) {
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "Flint Plumbing",
        ...(assertMarket ? { description: "Austin, Texas Plumber, Plumbing, Emergency Plumber" } : { description: "Plumber, Plumbing, Emergency Plumber" }),
      },
      { "@type": "Organization", name: "Flint Plumbing", url: "https://flintplumb.com/" },
    ],
  };
  return `<!doctype html><html><head>
<title>${assertMarket ? "Austin Plumbers: Local Family Owned - 40+ Years | Flint Plumbing" : "Local Family Owned - 40+ Years | Flint Plumbing"}</title>
<meta name="description" content="Family-owned plumbing company with 40+ years of experience. Licensed &amp; insured." />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body><h2>Trusted Plumbing Experts for Over 40 Years!</h2></body></html>`;
}

function stubSources({ assertMarket }) {
  const google = async () => ({
    id: "places_gbp", observer: GOOGLE, transport: "places_api", status: "ok",
    requests: 1, observations: { ...NAP_OBSERVATION }, place_types: ["plumber"],
  });
  const site = (ctx) => vf.firstPartySite({
    ...ctx,
    website: "https://flintplumb.com/",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => firstPartyHtml({ assertMarket }) }),
  });
  return [google, site];
}

async function resolveFlint({ assertMarket }) {
  return vf.resolveVerifiedFacts({
    prospect: {
      business_name: "Flint Plumbing LLC",
      city: "Buda",
      state: "TX",
      query_city: "Austin",
      query_state: "TX",
      industry: "plumbing",
      website: "https://flintplumb.com/",
    },
    sources: stubSources({ assertMarket }),
  });
}

// ---------------------------------------------------------------------------
// 1. RESOLUTION — the market comes from the client, the address from Google
// ---------------------------------------------------------------------------

test("first-party asserts Austin + NAP Buda => marketing city Austin, postal address stays Buda", async () => {
  const out = await resolveFlint({ assertMarket: true });

  assert.equal(out.ok, true, JSON.stringify(out.missing_required));
  // THE MARKET — from the business's own site, and named as such in provenance.
  assert.equal(out.facts.service_area, "Austin");
  assert.equal(out.provenance.service_area.class, "self_published");
  assert.deepEqual(
    out.provenance.service_area.sources.map((s) => s.observer),
    [vf.OBSERVER.BUSINESS_SELF],
    "the market is the subject's own claim and must be attributed to the subject",
  );
  // THE ADDRESS — untouched, still Google's independently observed locality.
  assert.equal(out.facts.city, "Buda");
  assert.equal(out.facts.postal_code, "78610");
  assert.equal(out.provenance.city.sources[0].observer, GOOGLE);

  // The projection into a MirrorRequest carries both, and still validates.
  const req = vf.toMirrorRequest(out, { slug: "wss-test-flint-plumbing-s5" });
  assert.equal(req.ok, true, JSON.stringify(req.detail));
  assert.equal(req.request.facts.service_area, "Austin");
  assert.equal(req.request.facts.city, "Buda");
  assert.equal(checkMirrorRequest(req.request).ok, true);

  // And the one function every renderer asks.
  assert.equal(marketCity(req.request.facts), "Austin");
  assert.equal(addressCity(req.request.facts), "Buda");
});

test("first-party asserts nothing => marketing city Buda, exactly as before the field existed", async () => {
  const out = await resolveFlint({ assertMarket: false });

  assert.equal(out.ok, true, JSON.stringify(out.missing_required));
  assert.equal(out.facts.service_area, undefined, "absent is the correct answer; a market is never inferred");
  assert.equal(out.provenance.service_area, undefined);
  assert.equal(out.facts.city, "Buda");

  const req = vf.toMirrorRequest(out, { slug: "wss-test-flint-plumbing-s5" });
  assert.equal(req.ok, true);
  assert.equal(req.request.facts.service_area, undefined);
  assert.equal(marketCity(req.request.facts), "Buda");
  assert.equal(addressCity(req.request.facts), "Buda");
});

// ---------------------------------------------------------------------------
// 2. THE COHERENCE GUARDS — an assertion is not automatically usable
// ---------------------------------------------------------------------------

test("a market asserted in a DIFFERENT state than the verified one is withheld, not shipped", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: { business_name: "Flint Plumbing LLC", city: "Buda", state: "TX", industry: "plumbing" },
    sources: [
      async () => ({ id: "places_gbp", observer: GOOGLE, transport: "places_api", status: "ok", requests: 1, observations: { ...NAP_OBSERVATION } }),
      (ctx) => vf.firstPartySite({
        ...ctx,
        website: "https://flintplumb.com/",
        // A Washington market on a Texas business is an extractor misread.
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<!doctype html><html><head><title>Plumbers in Lynnwood, WA</title></head><body></body></html>" }),
      }),
    ],
  });
  assert.equal(out.facts.service_area, undefined);
  const w = out.withheld.find((x) => x.field === "service_area");
  assert.ok(w, "the withheld market must be reported, not silently dropped");
  assert.equal(w.reason, "asserted_state_disagrees_with_verified_state");
  assert.equal(out.facts.city, "Buda");
});

test("a market identical to the NAP city is dropped — that is not a divergence", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: { business_name: "Flint Plumbing LLC", city: "Buda", state: "TX", industry: "plumbing" },
    sources: [
      async () => ({ id: "places_gbp", observer: GOOGLE, transport: "places_api", status: "ok", requests: 1, observations: { ...NAP_OBSERVATION } }),
      (ctx) => vf.firstPartySite({
        ...ctx,
        website: "https://flintplumb.com/",
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<!doctype html><html><head><title>Plumbers in Buda, TX</title></head><body></body></html>" }),
      }),
    ],
  });
  assert.equal(out.facts.service_area, undefined);
  assert.equal(out.withheld.find((x) => x.field === "service_area").reason, "same_as_nap_city");
  assert.equal(marketCity(out.facts), "Buda");
});

test("one market-city rule rejects administrative claims and query drift, then falls back to verified NAP", () => {
  const cases = [
    {
      input: { assertedCity: "United States", queryCity: "Houston", queryState: "TX", napCity: "Houston", napState: "TX" },
      city: "Houston",
      reason: "country_claim_is_not_a_city",
    },
    {
      input: { assertedCity: "Texas", queryCity: "Irving", queryState: "TX", napCity: "Irving", napState: "TX" },
      city: "Irving",
      reason: "statewide_claim_is_not_a_city",
    },
    {
      input: { assertedCity: "Austin", assertedState: "TX", queryCity: "San Antonio", queryState: "TX", napCity: "San Antonio", napState: "TX" },
      city: "San Antonio",
      reason: "asserted_market_disagrees_with_mining_query",
    },
  ];
  for (const item of cases) {
    const out = eligibleMarketCity(item.input);
    assert.equal(out.eligible, false, JSON.stringify(item.input));
    assert.equal(out.city, item.city);
    assert.equal(out.service_area, "");
    assert.equal(out.reason, item.reason);
  }

  const flint = eligibleMarketCity({
    assertedCity: "Austin", assertedState: "TX",
    queryCity: "Austin", queryState: "TX",
    napCity: "Buda", napState: "TX",
  });
  assert.equal(flint.eligible, true);
  assert.equal(flint.city, "Austin");
  assert.equal(flint.service_area, "Austin");

  const farr = eligibleMarketCity({
    assertedCity: "Springfield", assertedState: "MO",
    queryCity: "Springfield", queryState: "MO",
    napCity: "Republic", napState: "MO",
  });
  assert.equal(farr.eligible, true, "Springfield market / Republic NAP remains legitimate");
  assert.equal(farr.city, "Springfield");
});

test("the resolver withholds a first-party market that diverges from the mining query", async () => {
  const nap = { ...NAP_OBSERVATION, city: "San Antonio", address: "100 Main St, San Antonio, TX 78205" };
  const out = await vf.resolveVerifiedFacts({
    prospect: {
      business_name: "Alamo Plumbing",
      city: "San Antonio",
      state: "TX",
      query_city: "San Antonio",
      query_state: "TX",
      industry: "plumbing",
    },
    sources: [
      async () => ({ id: "places_gbp", observer: GOOGLE, transport: "places_api", status: "ok", requests: 1, observations: nap }),
      (ctx) => vf.firstPartySite({
        ...ctx,
        website: "https://alamo.example/",
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<!doctype html><html><head><title>Plumbers in Austin, TX</title></head><body></body></html>" }),
      }),
    ],
  });
  assert.equal(out.facts.city, "San Antonio");
  assert.equal(out.facts.service_area, undefined);
  assert.equal(
    out.withheld.find((item) => item.field === "service_area").reason,
    "asserted_market_disagrees_with_mining_query",
  );
});

test("two different markets asserted on one surface is ambiguity, and ambiguity is not a fact", () => {
  const html = `<!doctype html><html><head><title>Plumbers in Austin, TX and Round Rock, TX</title></head><body></body></html>`;
  assert.equal(vf.serviceAreaAssertion({ html, ldNodes: [] }), null);
});

test("a capitalised phrase followed by a non-state is never read as a place", () => {
  assert.deepEqual(vf.placeAssertionsIn("Family Owned, Licensed and Insured"), []);
  assert.deepEqual(vf.placeAssertionsIn("Honest, upfront quotes"), []);
  // …while the real thing still parses, including two-word states and lead-ins.
  assert.deepEqual(vf.placeAssertionsIn("Austin, Texas Plumber, Plumbing"), [{ city: "Austin", state: "TX" }]);
  assert.deepEqual(vf.placeAssertionsIn("Serving Santa Fe, New Mexico since 1998"), [{ city: "Santa Fe", state: "NM" }]);
  // "The Woodlands, TX" is a real city — the lead-in stripper must not eat it.
  assert.deepEqual(vf.placeAssertionsIn("Roofing in The Woodlands, TX"), [{ city: "The Woodlands", state: "TX" }]);
});

test("an explicit schema.org areaServed outranks everything — it is a declaration", () => {
  const ldNodes = [{ "@type": "LocalBusiness", name: "Flint Plumbing", areaServed: [{ "@type": "City", name: "Austin" }] }];
  const html = `<!doctype html><html><head><title>Plumbers in Kyle, TX</title></head><body></body></html>`;
  assert.deepEqual(vf.serviceAreaAssertion({ html, ldNodes }), { city: "Austin", state: "", surface: "schema_area_served" });
});

test("a trade noun in front of a town is not part of the town's name", () => {
  // MEASURED. These are the real <title> tags of four prospects on the rebuilt
  // fleet, and the captured "city" reached the rendered H1 — Cooper Perry's
  // mirror read "Plumbing in Plumbing Repairs Tulsa. Done right." on the hero,
  // the header chip, "BASED IN" and the <title>.
  assert.deepEqual(vf.placeAssertionsIn("Plumbing Repairs Tulsa, OK"), [{ city: "Tulsa", state: "OK" }]);
  assert.deepEqual(vf.placeAssertionsIn("Plumbers Spokane, WA"), [{ city: "Spokane", state: "WA" }]);
  assert.deepEqual(vf.placeAssertionsIn("Plumbers Omaha, NE"), [{ city: "Omaha", state: "NE" }]);
  assert.deepEqual(vf.placeAssertionsIn("HVAC Akron, OH"), [{ city: "Akron", state: "OH" }]);
  assert.deepEqual(vf.placeAssertionsIn("Emergency Drain Cleaning Portland, OR"), [{ city: "Portland", state: "OR" }]);

  // REMOVAL ONLY, LEADING ONLY — real names with more than one word survive
  // whole, and nothing is ever introduced.
  assert.deepEqual(vf.placeAssertionsIn("Roofing in The Woodlands, TX"), [{ city: "The Woodlands", state: "TX" }]);
  assert.deepEqual(vf.placeAssertionsIn("Plumbers Lee's Summit, MO"), [{ city: "Lee's Summit", state: "MO" }]);
  assert.deepEqual(vf.placeAssertionsIn("Serving Santa Fe, New Mexico since 1998"), [{ city: "Santa Fe", state: "NM" }]);
  assert.deepEqual(vf.placeAssertionsIn("Kansas City, MO"), [{ city: "Kansas City", state: "MO" }]);
  // The stripper must never eat the town itself down to nothing.
  assert.deepEqual(vf.placeAssertionsIn("Plumbing Repairs, OK"), []);
});

test("the business's own trade suffix, welded onto a FROZEN market, is peeled off the town", () => {
  // MEASURED 2026-08-12 on the rendered DOM of the live Logic Heating & Air
  // mirror: the stored service_area is "Air Tulsa" and the lane shipped "HVAC in
  // Air Tulsa, OK" on the h1, the <title>, the sub-nav ("SERVING AIR TULSA") and
  // the logo lock-up of every page. verified-facts salvages at capture; this row
  // was frozen before that existed, so the peel must live where every build
  // crosses (facts.js -> salvagePlaceName).
  assert.equal(salvagePlaceName("Air Tulsa", { businessName: "Logic Heating & Air" }), "Tulsa");
  assert.equal(salvagePlaceName("Heating Columbus", { businessName: "Sears Heating & Cooling" }), "Columbus");
  assert.equal(salvagePlaceName("Air Conditioning Phoenix", { businessName: "Cool Air Conditioning" }), "Phoenix");

  // GATED ON BOTH: the word must be a bare trade noun AND a word of the business
  // name. A directional a business shares with a real suburb keeps its town
  // whole, because "north" is not a trade noun...
  assert.equal(salvagePlaceName("North Dallas", { businessName: "North Star HVAC" }), "North Dallas");
  // ...and a trade noun that is NOT in the business name is left alone here (the
  // capture-time stripper owns that case; this seam only unwelds the OWN suffix).
  assert.equal(salvagePlaceName("Broken Arrow", { businessName: "Logic Heating & Air" }), "Broken Arrow");
  // Never eats the town down to nothing: only strips while a further word remains.
  assert.equal(salvagePlaceName("Air", { businessName: "Logic Heating & Air" }), "");
});

test("a frozen 'Air Tulsa' service_area renders as Tulsa through validateFacts", () => {
  const v = validateFacts({
    facts: {
      business_name: "Logic Heating & Air",
      industry: "hvac",
      city: "Tulsa",
      state: "OK",
      phone: "(918) 986-6077",
      address: "1307 W 22nd Pl, Tulsa, OK 74107",
      postal_code: "74107",
      service_area: "Air Tulsa",
    },
  });
  assert.equal(v.ok, true, JSON.stringify(v.detail));
  assert.equal(v.facts.service_area, "Tulsa", "the welded trade suffix is peeled at the one boundary every build crosses");
  assert.equal(marketCity(v.facts), "Tulsa");
  assert.equal(addressCity(v.facts), "Tulsa");
});

test("a declared areaServed is taken for the place it names, not the headline it is", () => {
  const area = (name, businessName = "") => vf.serviceAreaAssertion({
    html: "<!doctype html><html><head></head><body></body></html>",
    ldNodes: [{ "@type": "LocalBusiness", name: businessName || "Acme", areaServed: [{ "@type": "City", name }] }],
    businessName,
  });

  // MEASURED on the rebuilt fleet, read off the rendered H1. Every one of these
  // was accepted verbatim and became the locality on every marketing surface —
  // "Plumbing in Plumbing Repairs Tulsa. Done right." was live.
  assert.deepEqual(area("Plumbing Repairs Tulsa"), { city: "Tulsa", state: "", surface: "schema_area_served" });
  assert.deepEqual(area("Plumbers Spokane"), { city: "Spokane", state: "", surface: "schema_area_served" });
  assert.deepEqual(area("Plumbers Omaha"), { city: "Omaha", state: "", surface: "schema_area_served" });
  assert.deepEqual(area("HVAC Akron"), { city: "Akron", state: "", surface: "schema_area_served" });

  // Nothing but the business's own name and trade words: there is no assertion
  // here, so the caller must fall back to the NAP city rather than print this.
  assert.equal(area("Galli Plumbing Services service area", "Galli Plumbing Services"), null);
  assert.equal(area("Service Area"), null);

  // THE ORIGINAL INCIDENT, WORKING BETTER. Flint's own site says "Austin
  // Plumbers"; the whole point of the market/NAP split is that they are an
  // Austin plumber and not a Buda one, and the place still survives.
  assert.deepEqual(area("Austin Plumbers"), { city: "Austin", state: "", surface: "schema_area_served" });

  // A plain place is untouched, including multi-word and punctuated names.
  assert.deepEqual(area("Austin"), { city: "Austin", state: "", surface: "schema_area_served" });
  assert.deepEqual(area("The Woodlands"), { city: "The Woodlands", state: "", surface: "schema_area_served" });
  assert.deepEqual(area("Lee's Summit"), { city: "Lee's Summit", state: "", surface: "schema_area_served" });
  // A declaration carrying its state still parses through the stronger branch.
  assert.deepEqual(area("Kansas City, MO"), { city: "Kansas City", state: "MO", surface: "schema_area_served" });
});

// ---------------------------------------------------------------------------
// 3. THE RENDERED PAGE — the whole point, proven on the real donor
// ---------------------------------------------------------------------------

function buildFlint(extraFacts) {
  const v = validateFacts({
    facts: {
      business_name: "Flint Plumbing LLC",
      industry: "plumbing",
      city: "Buda",
      state: "TX",
      phone: "(512) 971-2445",
      address: "1132 Oyster Creek, Buda, TX 78610",
      postal_code: "78610",
      ...extraFacts,
    },
  });
  assert.equal(v.ok, true, JSON.stringify(v.detail));
  const { facts, phoneDigits } = v;

  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: facts.business_name,
    PHONE: facts.phone,
    PHONE_DIGITS: phoneDigits,
    CITY: marketCity(facts),
    ADDRESS_CITY: addressCity(facts),
    STATE: facts.state,
    REGION: facts.state,
    HERO_HEADLINE: defaultHeroHeadline(facts),
    ADDRESS: facts.address,
    ZIP: facts.postal_code,
    POSTAL: facts.postal_code,
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "wss-test-flint-plumbing-s5.wss-ai.com",
    PREVIEW_DOMAIN: "wss-test-flint-plumbing-s5.wss-ai.com",
    PREVIEW_URL: "https://wss-test-flint-plumbing-s5.wss-ai.com/",
    SITE_URL: "https://wss-test-flint-plumbing-s5.wss-ai.com/",
  });

  const donor = loadDonor(path.join(DONOR_ROOT, "plumbing-pressure-lens"));
  const h = hydrate({ donorFiles: donor.files, tokenValues: tv });
  assert.equal(h.ok, true, JSON.stringify(h.detail));
  const injected = contentInject.inject({
    files: h.files,
    content: { services: [{ name: "Water Leak Detection" }] },
    facts,
    phoneDigits,
    slug: "wss-test-flint-plumbing-s5",
    logoUrl: "/assets/brand-logo.svg",
    manifest: JSON.parse(fs.readFileSync(path.join(DONOR_ROOT, "plumbing-pressure-lens", "BOILERPLATE.json"), "utf8")),
  });
  const html = injected.files["index.html"].toString("utf8");
  const graphs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => JSON.parse(m[1]));
  const nodes = graphs.flatMap((g) => g["@graph"] || [g]);
  return { facts, html, nodes, files: injected.files };
}

test("the built page sells the market and addresses the NAP city — the Flint defect, locked", () => {
  const built = buildFlint({ service_area: "Austin" });

  assert.equal(
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(built.html) || [])[1],
    "Flint Plumbing LLC | Plumbing in Austin, TX",
    "the title is the loudest marketing surface on the page",
  );
  assert.match((/<meta property="og:title" content="([^"]*)"/i.exec(built.html) || [])[1], /Plumbing in Austin, TX$/);
  // The headline names the BUSINESS first and the prospect locality second. It read
  // "Plumbing in Austin." until 2026-08-11, which is true of every plumber in
  // Austin and was byte-identical on 15 of the 48 live plumbing mirrors — see
  // lib/mirror-engine/identity-copy.js. Visual QA round 1 split the hero from
  // the mining metro: the title sells Austin; the hero locale is their own city.
  assert.equal(defaultHeroHeadline(built.facts), "Flint Plumbing LLC. Plumbing in Buda, TX.");
  assert.match(built.html, /helps property owners in Austin/);
  assert.match(built.html, /Services in Austin, TX/);

  // …while every address surface still says Buda.
  const biz = built.nodes.find((n) => String(n["@type"]).includes("LocalBusiness"));
  assert.equal(biz.address.addressLocality, "Buda", "PostalAddress is the mailing address, never the market");
  assert.equal(biz.address.postalCode, "78610");
  // streetAddress is the STREET. It used to carry the whole formatted address,
  // so the locality, the region and the ZIP were each published twice in one
  // PostalAddress — and on wss-test-meyer-heating-and-air-st-louis the same
  // field carried a trailing ", USA" nobody writes on their own website.
  // lib/mirror-engine/postal.js peels only components this same facts object is
  // already publishing in their own fields, which is why Buda/TX/78610 come off
  // here and nothing is lost: they are asserted individually above.
  assert.equal(biz.address.streetAddress, "1132 Oyster Creek");
  // The donor's own visible location rail is an address line, so it is NAP too.
  assert.match(built.html, /<strong>Buda, TX<\/strong>/);
  assert.match(built.html, /data-address-city="Buda"/);
  assert.match(built.html, /data-city="Austin"/);

  // areaServed carries only the service market the business published. A NAP
  // locality proves where mail reaches them, not where they accept work.
  assert.deepEqual(biz.areaServed.map((a) => a.name), ["Austin, TX"]);

  // llms.txt must not let an answer engine confuse the two sentences.
  const llms = built.files["llms.txt"].toString("utf8");
  assert.match(llms, /^- Serves: Austin, TX$/m);
  assert.match(llms, /^- Located in: Buda, TX$/m);
});

// ---------------------------------------------------------------------------
// …BUT A STATE IS NOT A MARKET CITY (measured live, 2026-08-11)
// ---------------------------------------------------------------------------
// The split above is right, and it is load-bearing: Farr Better Plumbing's NAP
// city is Republic, MO, they self-publish "Springfield", and "Plumbing in
// Springfield, MO" is the truer headline. Same field, same class of first-party
// evidence, one rung too far: The Chill Brothers (Spring, TX) publish
// schema.org areaServed "Texas", and the lane shipped
//
//     "The Chill Brothers | HVAC Contractor in Texas, TX | AC & Heating"
//     "The Chill Brothers. HVAC in Texas, TX."
//
// A statewide service claim is true and worth saying; it is simply not the
// answer to "which town?", and in the town slot it renders as a stutter no
// local business would ever write — on the first line a prospect reads.
//
// The predicate that refuses it is deliberately the NARROWEST one that works:
// the name must be the state THE BUSINESS IS ALREADY IN. place-names.js
// explains at length why the general "no state names" rule is unwritable —
// Nevada MO, Delaware OH, California PA and Indiana PA are real incorporated
// towns and exactly what the nearby-towns rail exists to name. The second test
// below is the guard on that: if it ever fails, the cure has become worse than
// the disease.

test("a state's own name, in its own state, is refused as a market city", () => {
  assert.equal(isStatewideClaim("Texas", "TX"), true);
  assert.equal(isStatewideClaim("texas", "tx"), true);
  assert.equal(isStatewideClaim("  New Mexico  ", "NM"), true);
  assert.equal(isStatewideClaim("North Carolina", "NC"), true);
  assert.equal(isStatewideClaim("TX", "TX"), true, "the USPS code is the same claim");
});

test("real towns that share a state's name are untouched", () => {
  for (const [town, state] of [
    ["Nevada", "MO"], ["Delaware", "OH"], ["California", "PA"], ["Wyoming", "MI"],
    ["Indiana", "PA"], ["Kansas", "OK"], ["Nevada", "IA"], ["Oregon", "OH"], ["Texas", "MD"],
  ]) {
    assert.equal(isStatewideClaim(town, state), false, `${town}, ${state} is a real incorporated town`);
  }
  assert.equal(isStatewideClaim("Spring", "TX"), false);
  assert.equal(isStatewideClaim("Springfield", "MO"), false);
  assert.equal(isStatewideClaim("", "TX"), false);
  assert.equal(isStatewideClaim("Texas", ""), false);
  assert.equal(isStatewideClaim(null, null), false);
});

test("with no asserted market the page identifies its location without inventing a service area", () => {
  const built = buildFlint({});
  assert.equal(
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(built.html) || [])[1],
    "Flint Plumbing LLC | Plumbing in Buda, TX",
  );
  assert.equal(defaultHeroHeadline(built.facts), "Flint Plumbing LLC. Plumbing in Buda, TX.");
  const biz = built.nodes.find((n) => String(n["@type"]).includes("LocalBusiness"));
  assert.equal(biz.address.addressLocality, "Buda");
  assert.equal(biz.areaServed, undefined, "a postal locality alone is not areaServed evidence");
  const llms = built.files["llms.txt"].toString("utf8");
  assert.doesNotMatch(llms, /^- Serves:/m);
  assert.match(llms, /^- Located in: Buda, TX$/m);
});
