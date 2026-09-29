"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeWebsite } = require("../lib/site-weakness");
const { CircuitBreaker } = require("../lib/discovery-health");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const {
  buildQueries,
  applyOpportunityScoring,
  measuredHtmlSignals,
  websiteFlatness,
  rankFlatSiteCandidates,
  dispatchQueryPlans,
  searchPlaces,
  mineBuildReady,
  mineLeads,
  searchQueryWithNegatives,
  SERVICE_MODIFIERS,
} = require("../lib/lead-miner");

test("live query plans include neighborhood and nearby-city shapes with pages 1-4", () => {
  const plans = buildQueries({
    industry: "plumbing",
    location: "Louisville KY",
    nearbyCities: [{ name: "Shively", state: "KY" }, { name: "Clarksville", state: "IN" }],
    neighborhoods: ["Highlands"],
    env: {},
  });
  assert.deepEqual(plans.map((plan) => plan.textQuery), [
    "plumbing in Louisville KY",
    "plumbing near Highlands Louisville KY",
    "plumbing serving Shively KY",
    "plumbing Louisville KY small business",
    // SERVICE-MODIFIER LONG-TAILS (owner directive 2026-09-01) rotate in AFTER
    // the proven deep shapes, so the head of the ladder is unchanged.
    ...SERVICE_MODIFIERS.map((modifier) => `plumbing ${modifier} Louisville KY`),
  ]);
  assert.ok(plans.every((plan) => JSON.stringify(plan.pages) === "[1,2,3,4]"));
  assert.ok(plans.length <= 34);
});

test("flat-site policy is default-on and its 0 kill switch restores one head query", () => {
  const plans = buildQueries({
    industry: "plumbing",
    location: "Louisville KY",
    neighborhoods: ["Highlands"],
    env: { GHOST_AGENCY_FLAT_SITE_FIRST: "0" },
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].textQuery, "plumbing in Louisville KY");
  assert.deepEqual(plans[0].pages, [1]);
});

test("build-ready keeps the exact one-market Firecrawl budget while rotating deep shapes", async () => {
  const plans = buildQueries({
    industry: "plumbing",
    location: "Louisville KY",
    neighborhoods: ["Highlands"],
    env: {},
  });
  const requests = [];
  const out = await mineBuildReady({
    queries: plans,
    candidatesPerQuery: 4,
    queryShapeCursor: 1,
    env: {
      GOOGLE_PLACES_API_KEY: "places",
      FIRECRAWL_API_KEY: "firecrawl",
      // This test pins the SEARCH lane's pre-maps one-slot budget; the Maps
      // scrape lane has its own toggle and is pinned in
      // test/maps-discovery-query-templates.test.js.
      GHOST_AGENCY_MAPS_DISCOVERY: "0",
    },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(out.ok, true);
  assert.equal(requests.length, 1, "one pre-change market slot stays one Firecrawl call");
  assert.equal(requests[0].query, searchQueryWithNegatives(plans[1].textQuery));
  assert.equal(requests[0].limit, 4, "the pre-change result allowance is not multiplied or shrunk");
  assert.equal(out.cost.firecrawl_search_calls, 1);
  assert.equal(out.cost.places_calls, 0);
});

test("verified mining coordinates invoke the live nearby-cities machinery", async () => {
  const savedKey = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  let nearbyCalls = 0;
  const firecrawlRequests = [];
  try {
    const out = await mineLeads({
      industry: "plumbing",
      location: "Louisville KY",
      limit: 4,
      persist: false,
      logEvent: false,
      queryShapeCursor: 1,
      coordinatesVerified: true,
      lat: 38.2527,
      lng: -85.7585,
      nearbyCitiesImpl: async ({ lat, lng, excludeCity, count }) => {
        nearbyCalls++;
        assert.deepEqual({ lat, lng, excludeCity, count }, { lat: 38.2527, lng: -85.7585, excludeCity: "Louisville", count: 6 });
        return [{ name: "Shively", state: "KY", source: "us_census_geocoder" }];
      },
      env: {
        GOOGLE_PLACES_API_KEY: "test-key",
        FIRECRAWL_API_KEY: "test-key",
        // This test pins the SEARCH lane's one-slot budget; the Maps scrape
        // lane has its own toggle and contract
        // (test/maps-discovery-query-templates.test.js).
        GHOST_AGENCY_MAPS_DISCOVERY: "0",
      },
      fetchImpl: async (_url, options) => {
        firecrawlRequests.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(out.ok, true);
    assert.equal(nearbyCalls, 1);
    assert.ok(out.queries.some((plan) => plan.textQuery === "plumbing serving Shively KY"));
    assert.equal(firecrawlRequests.length, 1, "nearby expansion consumes no extra Firecrawl slot");
    assert.equal(firecrawlRequests[0].query, searchQueryWithNegatives("plumbing serving Shively KY"));
  } finally {
    if (savedKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = savedKey;
  }
});

test("no verified coordinates degrades safely with zero nearby lookups", async () => {
  const savedKey = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  let nearbyCalls = 0;
  let firecrawlCalls = 0;
  try {
    const out = await mineLeads({
      industry: "plumbing",
      location: "Louisville KY",
      limit: 4,
      persist: false,
      logEvent: false,
      nearbyCitiesImpl: async () => { nearbyCalls++; return [{ name: "invented" }]; },
      env: {
        GOOGLE_PLACES_API_KEY: "test-key",
        FIRECRAWL_API_KEY: "test-key",
        // Pre-maps search-lane budget pin; see maps-discovery-query-templates.
        GHOST_AGENCY_MAPS_DISCOVERY: "0",
      },
      fetchImpl: async () => {
        firecrawlCalls++;
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(out.ok, true);
    assert.equal(nearbyCalls, 0);
    assert.equal(firecrawlCalls, 1, "no coordinates add zero calls above the old one-market slot");
    assert.ok(!out.queries.some((plan) => / serving /.test(plan.textQuery)));
  } finally {
    if (savedKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = savedKey;
  }
});

test("a 5KB Wix site outranks a 300KB classy WordPress site at equal demand", () => {
  const wixHtml = `<html><body><a href="/">Home</a><a href="/contact">Contact</a><p>${"old site ".repeat(300)}</p></body></html>`;
  const wordpressHtml = `<html><head><script type="application/ld+json">{"@type":"LocalBusiness"}</script></head><body>
    ${Array.from({ length: 65 }, (_, i) => `<a href="/page-${i}">Page ${i}</a>`).join("")}
    <a href="/services">Services</a><video src="hero.mp4"></video><div class="elementor">${"premium copy ".repeat(26000)}</div></body></html>`;
  assert.ok(Buffer.byteLength(wixHtml) < 5000);
  assert.ok(Buffer.byteLength(wordpressHtml) > 300000);

  const wix = websiteFlatness({
    websiteUrl: "https://flat-shop.wixsite.com/home",
    html: wixHtml,
    probe: analyzeWebsite({ url: "https://flat-shop.wixsite.com/home", html: wixHtml, status: 200, ok: true }),
  });
  const wordpress = websiteFlatness({
    websiteUrl: "https://classy.example.com",
    html: wordpressHtml,
    probe: analyzeWebsite({ url: "https://classy.example.com", html: wordpressHtml, status: 200, ok: true }),
  });
  const ranked = rankFlatSiteCandidates([
    { prospect_id: "classy", record: { website_flatness: wordpress, rating: 4.8, review_count: 250 } },
    { prospect_id: "wix", record: { website_flatness: wix, rating: 4.8, review_count: 250 } },
  ], {});
  assert.equal(ranked[0].prospect_id, "wix");
  assert.equal(wix.flat, true);
  assert.equal(wordpress.flat, false);
});

test("flatness ordering never drops measured or unmeasured candidates", () => {
  const candidates = [
    { prospect_id: "plain", record: { website_flatness: { score: 0 }, rating: 4.9, review_count: 500 } },
    { prospect_id: "flat", record: { website_flatness: { score: 95 }, rating: 4.5, review_count: 200 } },
    { prospect_id: "unmeasured", record: { rating: 4.7, review_count: 300 } },
  ];
  const ranked = rankFlatSiteCandidates(candidates, {});
  assert.equal(ranked.length, candidates.length);
  assert.deepEqual(new Set(ranked.map((row) => row.prospect_id)), new Set(candidates.map((row) => row.prospect_id)));
});

test("modern/classy website grade orders below flat but never gates the candidate", async () => {
  const saved = process.env.GHOST_AGENCY_FLAT_SITE_FIRST;
  delete process.env.GHOST_AGENCY_FLAT_SITE_FIRST;
  const rows = [
    {
      prospect_id: "classy",
      business_name: "Classy Co",
      current_website: "https://classy.example.com",
      industry: "plumbing",
      record: {
        place_id: "classy-place",
        business_name: "Classy Co",
        current_website: "https://classy.example.com",
        industry: "plumbing",
        rating: 4.8,
        review_count: 250,
        website_probe: { exists: true, modernPremium: true, hasSchema: true, builder: "" },
        website_flatness: { flat: false, score: 0, signals: [] },
      },
    },
    {
      prospect_id: "flat",
      business_name: "Flat Site Co",
      current_website: "https://flat.wixsite.com/home",
      industry: "plumbing",
      record: {
        place_id: "flat-place",
        business_name: "Flat Site Co",
        current_website: "https://flat.wixsite.com/home",
        industry: "plumbing",
        rating: 4.8,
        review_count: 250,
        website_probe: { exists: true, modernPremium: false, hasSchema: false, builder: "wixsite" },
        website_flatness: { flat: true, score: 95, signals: ["thin Wix"] },
      },
    },
  ];
  try {
    const scored = await applyOpportunityScoring(rows, rows.length);
    assert.equal(scored.qualificationSkipped, 0);
    assert.equal(scored.rows.length, 2);
    assert.deepEqual(scored.rows.map((row) => row.prospect_id), ["flat", "classy"]);

    process.env.GHOST_AGENCY_FLAT_SITE_FIRST = "0";
    const rollback = await applyOpportunityScoring(rows, rows.length);
    assert.equal(rollback.qualificationSkipped, 1);
    assert.deepEqual(rollback.rows.map((row) => row.prospect_id), ["flat"]);
  } finally {
    if (saved === undefined) delete process.env.GHOST_AGENCY_FLAT_SITE_FIRST;
    else process.env.GHOST_AGENCY_FLAT_SITE_FIRST = saved;
  }
});

test("Facebook gets score 100 only with GBP website evidence; absent HTML stays unmeasured", () => {
  const gbp = websiteFlatness({ websiteUrl: "https://example.com", gbpWebsiteUrl: "https://www.facebook.com/shop" });
  const arbitrary = websiteFlatness({ websiteUrl: "https://www.facebook.com/shop" });
  assert.equal(gbp.score, 100);
  assert.equal(gbp.flat, true);
  assert.equal(gbp.facebookSite, true);
  assert.equal(arbitrary.score, 0);
  assert.equal(arbitrary.facebookSite, false);
  assert.deepEqual(arbitrary.signals, []);
  const missing = measuredHtmlSignals(undefined, "https://example.com");
  for (const signal of ["htmlBytes", "internalLinks", "hasServicePage", "hasVideo"]) {
    assert.equal(Object.hasOwn(missing, signal), false, `${signal} must stay absent when HTML was not measured`);
  }
});

test("expanded plans collapse to the exact pre-change provider-call count", () => {
  const plans = buildQueries({
    industry: "plumbing",
    location: "Louisville KY",
    nearbyCities: ["Shively", "Jeffersontown"],
    neighborhoods: ["Highlands", "Cherokee Triangle"],
    env: {},
  });
  const dispatches = dispatchQueryPlans(plans, 2);
  assert.equal(dispatches.length, 1, "six query shapes still consume one old market slot");
  assert.equal(dispatches[0], plans[2]);
});

test("Places walks pages 1-4 only when the unchanged result budget already requires four calls", async () => {
  let page = 0;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({
      places: [{ id: `page-${++page}` }],
      nextPageToken: page < 4 ? `token-${page}` : undefined,
    }),
  });
  const out = await searchPlaces({
    key: "test",
    textQuery: "plumbing in Louisville KY",
    limit: 80,
    pages: [1, 2, 3, 4],
    fetchImpl,
    breaker: new CircuitBreaker(),
  });
  assert.deepEqual(out.pagesWalked, [1, 2, 3, 4]);
  assert.deepEqual(out.plannedPages, [1, 2, 3, 4]);
  assert.equal(out.httpCalls, 4);
  assert.deepEqual(out.places.map((place) => place.id), ["page-1", "page-2", "page-3", "page-4"]);
});

test("legacy Places mining keeps one call for one market with deep plans enabled", async () => {
  const savedKey = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  let placesCalls = 0;
  try {
    const out = await mineLeads({
      industry: "plumbing",
      location: "Louisville KY",
      limit: 4,
      buildReadyGate: false,
      persist: false,
      logEvent: false,
      queryShapeCursor: 1,
      env: {},
      fetchImpl: async () => {
        placesCalls++;
        return { ok: true, status: 200, headers: new Map(), json: async () => ({ places: [] }) };
      },
    });
    assert.equal(out.ok, true);
    assert.ok(out.queries.length > 1, "the full deep query set is still built");
    assert.equal(out.queryResults.length, 1);
    assert.equal(placesCalls, 1, "one pre-change market slot stays one Places call");
    assert.equal(out.queryResults[0].httpCalls, 1);
    assert.deepEqual(out.queryResults[0].pagesWalked, [1]);
    assert.deepEqual(out.queryResults[0].plannedPages, [1, 2, 3, 4], "the live call consumes the selected frozen page plan");
  } finally {
    if (savedKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = savedKey;
  }
});

test("opted-in build-ready keeps and ranks an exact-path Facebook GBP candidate within the one-attempt Places cap", async () => {
  const facebookUrl = "https://www.facebook.com/flatplumbingky";
  const wrongFacebookUrl = "https://www.facebook.com/someotherplumber";
  const classyUrl = "https://203.0.113.88/";
  const counts = { firecrawl: 0, pages: 0, places: 0, logos: 0, dryRuns: 0 };

  const place = ({ id, name, websiteUri }) => ({
    id,
    displayName: { text: name },
    formattedAddress: "100 Main St, Louisville, KY 40202, USA",
    location: { latitude: 38.2527, longitude: -85.7585 },
    nationalPhoneNumber: "(502) 555-0100",
    websiteUri,
    primaryType: "plumber",
    types: ["plumber", "point_of_interest"],
    businessStatus: "OPERATIONAL",
    rating: 4.8,
    userRatingCount: 250,
    addressComponents: [
      { types: ["locality"], longText: "Louisville", shortText: "Louisville" },
      { types: ["administrative_area_level_1"], longText: "Kentucky", shortText: "KY" },
      { types: ["postal_code"], longText: "40202", shortText: "40202" },
    ],
  });
  const flatPlace = place({ id: "place-flat-facebook", name: "Flat Plumbing", websiteUri: facebookUrl });
  flatPlace.photos = Array.from({ length: 20 }, (_, index) => ({ name: `places/photo-${index}` }));
  flatPlace.regularOpeningHours = { weekdayDescriptions: ["Monday: Open 24 hours"] };
  flatPlace.editorialSummary = { text: "Louisville plumbing and water-heater service" };
  flatPlace.rating = 5;
  flatPlace.userRatingCount = 1000;
  const wrongFlatPlace = place({ id: "place-wrong-facebook", name: "Some Other Plumber", websiteUri: wrongFacebookUrl });
  const classyPlace = place({ id: "place-classy", name: "Classy Plumbing", websiteUri: classyUrl });

  const facebookHtml = `<!doctype html><html><head><title>Flat Plumbing | Louisville KY</title>
    <meta name="description" content="Plumbing repairs in Louisville KY">
    <script type="application/ld+json">{"@type":"LocalBusiness"}</script></head><body>
    <h1>Flat Plumbing</h1><p>Plumbing repairs and water heaters.</p>
    <a href="mailto:flatplumbing@gmail.com">Email us</a>
    <a href="https://facebook.com/flatplumbingky">Facebook</a>
    <a href="https://instagram.com/flatplumbingky">Instagram</a>
    <a href="https://linkedin.com/company/flatplumbingky">LinkedIn</a>
    <a href="https://youtube.com/@flatplumbingky">YouTube</a>
    <a href="https://tiktok.com/@flatplumbingky">TikTok</a>
    <a href="https://twitter.com/flatplumbingky">Twitter</a>
    <a href="https://yelp.com/biz/flatplumbingky">Yelp</a></body></html>`;
  const classyHtml = `<!doctype html><html><head><title>Classy Plumbing | Louisville KY</title>
    <meta name="viewport" content="width=device-width">
    <script type="application/ld+json">{"@type":"LocalBusiness","name":"Classy Plumbing","telephone":"(502) 555-0199","address":{"@type":"PostalAddress","addressLocality":"Louisville","addressRegion":"KY","postalCode":"40202"}}</script>
    <script id="__NEXT_DATA__" type="application/json">{}</script></head><body>
    <img class="custom-logo" src="/logo.svg" alt="Classy Plumbing">
    <a href="/services">Services</a><a href="mailto:classyplumbing@gmail.com">Email us</a>
    <p>${"premium plumbing service ".repeat(22000)}</p></body></html>`;
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120"><rect width="400" height="120" fill="#1d4ed8"/></svg>';

  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      counts.firecrawl++;
      // Facebook first: under the one-attempt Places cap, the first stage-6
      // survivor consumes the single opted-in lookup — and the Facebook path
      // is the one that NEEDS the GBP observation to prove page identity.
      return new Response(JSON.stringify({ data: [
        { url: facebookUrl, title: "Flat Plumbing | Louisville KY" },
        { url: classyUrl, title: "Classy Plumbing | Louisville KY" },
        { url: "https://www.yelp.com/biz/not-a-business-site", title: "Yelp directory" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("places.googleapis.com")) {
      counts.places++;
      const query = String(JSON.parse(String(init.body || "{}")).textQuery || "");
      const places = /Classy Plumbing/i.test(query)
        ? [classyPlace]
        : [wrongFlatPlace, flatPlace];
      return new Response(JSON.stringify({ places }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/\/logo\.svg$/.test(href)) {
      counts.logos++;
      return new Response(Buffer.from(logo), { status: 200, headers: { "content-type": "image/svg+xml" } });
    }
    if (href === facebookUrl || href === `${facebookUrl}/`) {
      counts.pages++;
      return new Response(facebookHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (new URL(href).hostname === "203.0.113.88") {
      counts.pages++;
      return new Response(classyHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };

  const realFetch = global.fetch;
  global.fetch = fetchImpl;
  let optedIn;
  let bulk;
  let rollback;
  let countsAfterRuns;
  const dryRunMirror = async (request) => {
    counts.dryRuns++;
    const validation = checkMirrorRequest(request);
    assert.equal(validation.ok, true, JSON.stringify(validation.body && validation.body.detail));
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        build_hash: `hash-${request.slug}`,
        donor_content_hash: "donor",
        file_count: 51,
        evidence_sha: "sha",
        renderer: "mirror-engine@v1",
        checks: { brand: { status: "passed", logo_refs_in_output: request.brand.logo ? 3 : 0 } },
      },
    };
  };
  const baseEnv = {
    GOOGLE_PLACES_API_KEY: "places",
    FIRECRAWL_API_KEY: "firecrawl",
    GHOST_AGENCY_PHOTO_BANK: "false",
    GHOST_AGENCY_SOCIAL_SEARCH: "false",
    // This test pins the Places cap and the search-call count; the directory
    // crawl is a separate discovery lane exercised by its own contract test.
    GHOST_AGENCY_MINER_DIRECTORY_CRAWL: "0",
    // The Maps discovery lane is pinned in its own test file; this test pins
    // the exact pre-maps Firecrawl and Places call counts.
    GHOST_AGENCY_MAPS_DISCOVERY: "0",
    // IDENTITY TRUST MODE (2026-08-31) is the production default; this test
    // pins the strict lane (the schema-less Facebook page quarantines), so it
    // opts out via the kill switch. Both modes are pinned across
    // places-optional-mining / metro-fence / operator-line-google-discovery.
    GHOST_AGENCY_IDENTITY_TRUST: "0",
    // This test pins the THIN-FLOW LAW (quality ceilings never refuse): the
    // classy fixture is a modern-premium site, which the 2026-09-03 heavy-
    // target admission cap (TARGET_MAX_POLISH, default 75) now skips at
    // admission for TARGETING reasons. Disable the cap here so this file
    // keeps proving exactly what it always proved; the cap itself is pinned
    // in target-polish-ceiling.test.js.
    TARGET_MAX_POLISH: "0",
  };
  const queries = [{ industry: "plumbing", location: "Louisville KY", textQuery: "plumbing in Louisville KY", queryGroup: 0 }];
  try {
    // Run A — the ONE opted-in exact candidate. Facebook is a shared host, so
    // proving the page is THIS business requires the GBP observation; that is
    // exactly what the single capped lookup exists for.
    optedIn = await mineBuildReady({
      queries,
      candidatesPerQuery: 1,
      placesVerify: true,
      trigger: "manual_exact",
      env: baseEnv,
      fetchImpl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
      mirrorImpl: dryRunMirror,
    });
    // Run B — the default multi-candidate lane: zero Places; the classy site
    // identifies from its own structured evidence, the schema-less Facebook
    // page quarantines, the directory refuses.
    bulk = await mineBuildReady({
      queries,
      candidatesPerQuery: 4,
      env: baseEnv,
      fetchImpl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
      mirrorImpl: dryRunMirror,
    });
    countsAfterRuns = { ...counts };
    rollback = await mineBuildReady({
      queries,
      candidatesPerQuery: 4,
      env: {
        ...baseEnv,
        GHOST_AGENCY_FLAT_SITE_FIRST: "0",
        GHOST_AGENCY_WEBSITE_AXIS_CEILING: "C+",
        GHOST_AGENCY_COMPOSITE_CEILING: "C+",
      },
      fetchImpl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
      mirrorImpl: async () => ({
        ok: true,
        status: 200,
        body: {
          ok: true, build_hash: "rollback-hash", donor_content_hash: "donor", file_count: 51,
          evidence_sha: "sha", renderer: "mirror-engine@v1",
          checks: { brand: { status: "passed", logo_refs_in_output: 0 } },
        },
      }),
    });
  } finally {
    global.fetch = realFetch;
  }

  assert.equal(optedIn.ok, true, JSON.stringify(optedIn.rejects || []).slice(0, 600));
  assert.equal(bulk.ok, true, JSON.stringify(bulk.rejects || []).slice(0, 600));
  const facebookRecord = optedIn.records[0];
  const classyRecord = bulk.records[0];
  assert.equal(optedIn.records.length, 1);
  assert.equal(facebookRecord.lead_id, "place-flat-facebook");
  assert.equal(facebookRecord.identity_source, "google_places");
  assert.equal(facebookRecord.website_flatness.score, 100);
  assert.equal(facebookRecord.website_flatness.facebookSite, true);
  assert.equal(facebookRecord.flat_site, true);
  assert.equal(facebookRecord.mirror_request.brand.logo, undefined);
  assert.equal(facebookRecord.mirror_request.brand.mark.rung, "wordmark");
  assert.equal(facebookRecord.mirror_request.brand.mark.value.text, "Flat Plumbing");
  assert.equal(bulk.records.length, 1);
  assert.equal(classyRecord.identity_source, "first_party");
  assert.equal(classyRecord.mirror_request.facts.business_name, "Classy Plumbing");
  assert.equal(classyRecord.qualification.probe.modernPremium, true, "the classy candidate really exercised the retired grade gate");
  assert.equal(bulk.rejects.filter((item) => item.reason === "directory_or_social_page").length, 1, "non-Facebook directories still refuse");
  assert.equal(bulk.held_rows.length, 1, "the schema-less Facebook page quarantines in the zero-Places lane");
  // FLAT-FIRST ORDERING, across both lanes: the exact-path Facebook flat site
  // outranks the classy site.
  const ranked = rankFlatSiteCandidates([classyRecord, facebookRecord], {});
  assert.equal(ranked[0].lead_id, "place-flat-facebook");
  assert.deepEqual(countsAfterRuns, { firecrawl: 2, pages: 4, places: 1, logos: 1, dryRuns: 2 },
    "homepages once per lane plus the pre-existing owned-social follow; exactly one GBP lookup total, on the opted-in run");
  assert.equal(optedIn.cost.places_calls, 1, "the opted-in run bills its one attempt");
  assert.equal(bulk.cost.places_calls, 0, "the multi-candidate lane never dials Google");
  // THIN-FLOW LAW (owner doctrine 2026-09-04, "scaling and rapid production
  // flow"): even with the old kill switch and a C+ ceiling reinstated, the
  // website-axis verdict no longer refuses. The modern-premium candidate is
  // accepted-with-score: the stage row records accepted_thin naming the
  // ceiling that would have refused, the reject list carries no s3 kill, and
  // the measured grade still rides the packet.
  assert.equal(rollback.records.length, 1, "the retired quality gate records instead of refusing");
  const rollbackThinStage = (rollback.funnel || []).find((stage) => stage.stage === "3_website_axis_ceiling");
  assert.ok(rollbackThinStage, JSON.stringify(rollback.funnel));
  assert.equal(rollbackThinStage.accepted_thin.already_modern_premium, 1,
    "the modern-premium candidate is tallied as accepted_thin, not refused");
  assert.equal(rollbackThinStage.survived, 2,
    "both candidates pass the ceiling stage now — the classy one with a recorded thin acceptance");
  assert.equal(rollback.rejects.some((item) => item.stage === "3_website_axis_ceiling"), false,
    "a quality ceiling may never refuse a candidate again");
  const rollbackThinRecord = rollback.records[0];
  assert.equal(rollbackThinRecord.mirror_request.facts.business_name, "Classy Plumbing");
  assert.equal(rollbackThinRecord.qualification.probe.modernPremium, true,
    "the score that would have refused is still measured and still stored");
  // The composite ceiling's Google-reputation trigger is structurally
  // unreachable in this lane now (no Google score axes are measured); the
  // schema-less Facebook page quarantines at identity instead.
  assert.ok(rollback.rejects.some((item) => item.reason === "identity_unverified_first_party"));
});

test("Facebook explicit-logo failure becomes a wordmark attempt instead of a pre-Places rejection", async () => {
  const facebookUrl = "https://www.facebook.com/wrongmarkplumbing";
  let placesCalls = 0;
  const html = `<!doctype html><html><head><title>Wrong Mark Plumbing | Louisville KY</title></head><body>
    <img class="custom-logo" src="https://cdn.example.net/someone-elses-logo.png" alt="Another Company">
    <a href="mailto:wrongmark@gmail.com">Email</a></body></html>`;
  const fetchImpl = async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      return new Response(JSON.stringify({ data: [{ url: facebookUrl, title: "Wrong Mark Plumbing | Louisville KY" }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("places.googleapis.com")) {
      placesCalls++;
      throw new Error("downstream Places unavailable in this focused stage-order test");
    }
    if (href === facebookUrl || href === `${facebookUrl}/`) {
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  const out = await mineBuildReady({
    queries: [{ industry: "plumbing", location: "Louisville KY", textQuery: "plumbing in Louisville KY", queryGroup: 0 }],
    candidatesPerQuery: 1,
    placesVerify: true,
    trigger: "manual_exact",
    // Strict-mode pin: the Places healthy-NO refuses the schema-less Facebook
    // candidate at identity (trust mode, the production default, proceeds on
    // site truth — pinned in places-optional-mining.test.js).
    env: { GOOGLE_PLACES_API_KEY: "places", FIRECRAWL_API_KEY: "firecrawl", GHOST_AGENCY_PHOTO_BANK: "false", GHOST_AGENCY_IDENTITY_TRUST: "0" },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
  });
  assert.equal(out.ok, true);
  assert.equal(out.records.length, 0);
  assert.ok(placesCalls > 0, "brand-image quality must not stop the candidate before identity lookup");
  assert.ok(placesCalls <= 1, "the whole opted-in run is capped to one outbound Places attempt");
  assert.equal(out.rejects.some((item) => item.stage === "4_brand_logo_and_accent"), false);
});

function smallPng(width = 180, height = 180) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write("IHDR", 12, 4, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function ordinaryLogoPage(extra = "") {
  return `<!doctype html><html><head><title>Search Alias Plumbing | Louisville KY</title>
    <meta name="description" content="Plumbing repairs in Louisville KY">
    <script type="application/ld+json">{"@type":"LocalBusiness"}</script></head><body>
    <h1>Search Alias Plumbing</h1>${extra}
    <section class="services"><h2>Services</h2><h3>Drain Cleaning</h3></section>
    <a href="mailto:verifiedgbpplumbing@gmail.com">Email us</a></body></html>`;
}

async function runOrdinaryLogoCase({ html, logoBytes, env = {} }) {
  const siteUrl = "https://example.com/";
  const counts = { places: 0, logoFetches: 0, dryRuns: 0 };
  const mirrorRequests = [];
  const place = {
    id: "place-verified-gbp-plumbing",
    displayName: { text: "Verified GBP Plumbing" },
    formattedAddress: "100 Main St, Louisville, KY 40202, USA",
    location: { latitude: 38.2527, longitude: -85.7585 },
    nationalPhoneNumber: "(502) 555-0100",
    websiteUri: siteUrl,
    primaryType: "plumber",
    types: ["plumber", "point_of_interest"],
    businessStatus: "OPERATIONAL",
    rating: 4.8,
    userRatingCount: 250,
    addressComponents: [
      { types: ["locality"], longText: "Louisville", shortText: "Louisville" },
      { types: ["administrative_area_level_1"], longText: "Kentucky", shortText: "KY" },
      { types: ["postal_code"], longText: "40202", shortText: "40202" },
    ],
  };
  const fetchImpl = async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      return new Response(JSON.stringify({ data: [{ url: siteUrl, title: "Search Alias Plumbing | Louisville KY" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.includes("places.googleapis.com")) {
      counts.places++;
      return new Response(JSON.stringify({ places: [place] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (/\/tiny-logo\.png$/.test(href)) {
      counts.logoFetches++;
      return new Response(logoBytes || smallPng(), { status: 200, headers: { "content-type": "image/png" } });
    }
    if (new URL(href).hostname === "example.com") {
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };

  const realFetch = global.fetch;
  global.fetch = fetchImpl;
  try {
    const out = await mineBuildReady({
      queries: [{ industry: "plumbing", location: "Louisville KY", textQuery: "plumbing in Louisville KY", queryGroup: 0 }],
      candidatesPerQuery: 1,
      // One exact manual candidate: the only lane Places verification still
      // runs in, and the one-attempt hard cap is exactly this lookup.
      placesVerify: true,
      trigger: "manual_exact",
      env: {
        GOOGLE_PLACES_API_KEY: "places",
        FIRECRAWL_API_KEY: "firecrawl",
        GHOST_AGENCY_PHOTO_BANK: "false",
        GHOST_AGENCY_SOCIAL_SEARCH: "false",
        ...env,
      },
      fetchImpl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
      mirrorImpl: async (request) => {
        counts.dryRuns++;
        mirrorRequests.push(structuredClone(request));
        const validation = checkMirrorRequest(request);
        assert.equal(validation.ok, true, JSON.stringify(validation.body && validation.body.detail));
        return {
          ok: true,
          status: 200,
          body: {
            ok: true,
            build_hash: "hash-logo-ladder",
            donor_content_hash: "donor",
            file_count: 51,
            evidence_sha: "sha",
            renderer: "mirror-engine@v1",
            checks: { brand: { status: "passed", logo_refs_in_output: request.brand.logo ? 3 : 0 } },
          },
        };
      },
    });
    return { out, counts, mirrorRequests };
  } finally {
    global.fetch = realFetch;
  }
}

test("ordinary true logo absence falls to a verified-name brand.mark wordmark", async () => {
  const { out, counts, mirrorRequests } = await runOrdinaryLogoCase({ html: ordinaryLogoPage() });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 0, dryRuns: 1 });
  assert.equal(mirrorRequests[0].brand.logo, undefined);
  assert.equal(mirrorRequests[0].brand.mark.rung, "wordmark");
  assert.equal(mirrorRequests[0].brand.mark.value.text, "Verified GBP Plumbing");
  assert.equal(out.records[0].brand_evidence.fallback_reason, "no_own_domain_logo_candidate");
  assert.deepEqual(out.records[0].brand_evidence.verified_by, ["google_places_display_name", "frozen_logo_ladder"]);
});

test("an explicit but unusable logo claim falls to the wordmark when provenance did not fail", async () => {
  const html = ordinaryLogoPage('<img class="custom-logo" src="" alt="Search Alias Plumbing">');
  const { out, counts, mirrorRequests } = await runOrdinaryLogoCase({ html });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 0, dryRuns: 1 });
  assert.equal(mirrorRequests[0].brand.logo, undefined);
  assert.equal(mirrorRequests[0].brand.mark.rung, "wordmark");
  assert.equal(mirrorRequests[0].brand.mark.value.text, "Verified GBP Plumbing");
  assert.equal(out.records[0].brand_evidence.fallback_reason, "no_own_domain_logo_candidate");
});

test("an already-owned low-grade icon falls to brand.mark and its URL never passes", async () => {
  const html = ordinaryLogoPage('<img class="custom-logo" src="/tiny-logo.png" alt="Search Alias Plumbing">');
  const { out, counts, mirrorRequests } = await runOrdinaryLogoCase({ html, logoBytes: smallPng(180, 180) });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 1, dryRuns: 1 });
  assert.equal(mirrorRequests[0].brand.logo, undefined);
  assert.equal(mirrorRequests[0].brand.mark.rung, "wordmark");
  assert.equal(mirrorRequests[0].brand.mark.value.text, "Verified GBP Plumbing");
  assert.match(out.records[0].brand_evidence.fallback_reason, /^logo_not_header_grade:site_icon_180x180$/);
  assert.doesNotMatch(JSON.stringify(mirrorRequests[0].brand), /tiny-logo\.png/);
  assert.doesNotMatch(JSON.stringify(out.records[0].brand_evidence), /tiny-logo\.png/);
});

test("an explicit foreign logo is discarded and the verified-name wordmark continues", async () => {
  const html = ordinaryLogoPage(
    '<img class="custom-logo" src="https://cdn.example.net/someone-elses-logo.png" alt="Another Company">',
  );
  const { out, counts } = await runOrdinaryLogoCase({ html });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 0, dryRuns: 1 });
  assert.equal(out.records[0].mirror_request.brand.mark.rung, "wordmark");
});

test("a foreign declared logo plus a tiny icon falls to the verified-name wordmark", async () => {
  const html = ordinaryLogoPage([
    '<img class="custom-logo" src="https://cdn.example.net/someone-elses-logo.png" alt="Another Company">',
    '<img class="custom-logo" src="/tiny-logo.png" alt="Search Alias Plumbing">',
  ].join(""));
  const { out, counts } = await runOrdinaryLogoCase({ html, logoBytes: smallPng(180, 180) });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 1, dryRuns: 1 });
  assert.equal(out.records[0].mirror_request.brand.mark.rung, "wordmark");
});

test("a foreign header-home mark plus tiny icon falls to the verified-name wordmark", async () => {
  const html = ordinaryLogoPage([
    '<header><a href="/"><img src="https://cdn.example.net/foreign-mark.png" alt="Another Company"></a></header>',
    '<img class="custom-logo" src="/tiny-logo.png" alt="Search Alias Plumbing">',
  ].join(""));
  const { out, counts } = await runOrdinaryLogoCase({ html, logoBytes: smallPng(180, 180) });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 1, dryRuns: 1 });
  assert.equal(out.records[0].mirror_request.brand.mark.rung, "wordmark");
});

test("a foreign Elementor-header mark plus tiny icon falls to the verified-name wordmark", async () => {
  const html = ordinaryLogoPage([
    '<div data-elementor-type="header"><a href="/"><img src="https://cdn.example.net/foreign-mark.png" alt="Another Company"></a></div>',
    '<img class="custom-logo" src="/tiny-logo.png" alt="Search Alias Plumbing">',
  ].join(""));
  const { out, counts } = await runOrdinaryLogoCase({ html, logoBytes: smallPng(180, 180) });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 1, dryRuns: 1 });
  assert.equal(out.records[0].mirror_request.brand.mark.rung, "wordmark");
});

test("a foreign rel=home mark plus tiny icon falls to the verified-name wordmark", async () => {
  const html = ordinaryLogoPage([
    '<header><a href="/about" rel="home"><img src="https://cdn.example.net/foreign-mark.png" alt="Another Company"></a></header>',
    '<img class="custom-logo" src="/tiny-logo.png" alt="Search Alias Plumbing">',
  ].join(""));
  const { out, counts } = await runOrdinaryLogoCase({ html, logoBytes: smallPng(180, 180) });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 1, dryRuns: 1 });
  assert.equal(out.records[0].mirror_request.brand.mark.rung, "wordmark");
});

test("a foreign CSS logo plus tiny icon falls to the verified-name wordmark", async () => {
  const html = ordinaryLogoPage([
    '<style>.brand-mark{background-image:url("https://cdn.example.net/foreign-logo.png")}</style>',
    '<img class="custom-logo" src="/tiny-logo.png" alt="Search Alias Plumbing">',
  ].join(""));
  const { out, counts } = await runOrdinaryLogoCase({ html, logoBytes: smallPng(180, 180) });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 1, dryRuns: 1 });
  assert.equal(out.records[0].mirror_request.brand.mark.rung, "wordmark");
});

test("an unrelated offsite photo does not turn true logo absence into a provenance refusal", async () => {
  const html = ordinaryLogoPage('<main><img src="https://photos.example.net/crew.jpg" alt="Our service crew"></main>');
  const { out, counts, mirrorRequests } = await runOrdinaryLogoCase({ html });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 0, dryRuns: 1 });
  assert.equal(mirrorRequests[0].brand.mark.rung, "wordmark");
});

test("body header-template class does not turn a foreign home-linked photo into a logo refusal", async () => {
  const html = ordinaryLogoPage([
    '<a href="/"><img src="https://photos.example.net/crew-photo.jpg" alt="Our service crew"></a>',
    '<img class="custom-logo" src="/tiny-logo.png" alt="Search Alias Plumbing">',
  ].join("")).replace("<body>", '<body class="page-template-elementor_header_footer">');
  const { out, counts, mirrorRequests } = await runOrdinaryLogoCase({ html, logoBytes: smallPng(180, 180) });
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.deepEqual(counts, { places: 1, logoFetches: 1, dryRuns: 1 });
  assert.equal(mirrorRequests[0].brand.logo, undefined);
  assert.equal(mirrorRequests[0].brand.mark.rung, "wordmark");
});

test("GHOST_AGENCY_LOGO_LADDER_FALLBACK=0 restores the true-absence refusal", async () => {
  const { out, counts } = await runOrdinaryLogoCase({
    html: ordinaryLogoPage(),
    env: { GHOST_AGENCY_LOGO_LADDER_FALLBACK: "0" },
  });
  assert.equal(out.records.length, 0);
  assert.deepEqual(counts, { places: 0, logoFetches: 0, dryRuns: 0 });
  assert.ok(out.rejects.some((item) => (
    item.stage === "4_brand_logo_and_accent"
    && item.reason === "no_own_domain_logo_candidate"
  )), JSON.stringify(out.rejects));
});
