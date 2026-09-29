"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQueries,
  dispatchQueryPlans,
  mapsDiscoveryEnabled,
  mapsMarketCenter,
  mapsSearchDiscovery,
  mapsSearchUrl,
  mineBuildReady,
  parseMapsHeadlineNames,
  parseMapsPlaceLink,
  resolveMapsCandidatePlace,
  searchQueryWithNegatives,
  SERVICE_MODIFIERS,
  MAPS_METRO_ZOOM_METERS,
  MAPS_REGIONAL_ZOOM_METERS,
} = require("../lib/lead-miner");
const { pickNameAdmission } = require("../lib/line-adapters");
const {
  NATIONAL_CHAIN_EXCLUDED,
  isNationalChainName,
} = require("../lib/pick-name-plausibility");

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";
const FIRECRAWL_SCRAPE = "https://api.firecrawl.dev/v2/scrape";
const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const SITE = "https://midtownplumbingodessa.com/";
const NO_SITE_NAME = "Baker Brothers Plumbing";

// THE PROVEN PAYLOAD SHAPE (live-tested 2026-09-01): a Firecrawl v2 scrape of
// the Maps search page returns place links shaped
// /maps/place/{Name}/data=!...!1s0x<hex>:0x<hex>!8m2!3d{lat}!4d{lng} plus the
// headline names in class="fontHeadlineSmall".
const MAPS_LINK_MIDTOWN = "https://www.google.com/maps/place/Midtown+Plumbing+Co/data=!4m7!3m6!1s0x86ac2a4d3e1d5f01:0x7a4c21c9e6f0a3b2!8m2!3d31.9973!4d-102.0779";
const MAPS_LINK_DUPLICATE = "https://www.google.com/maps/place/Midtown+Plumbing+Co/data=!4m7!3m6!1s0x86ac2a4d3e1d5f01:0x7a4c21c9e6f0a3b2!8m2!3d31.9973!4d-102.0779";
const MAPS_LINK_ROTOTHERMER = "https://www.google.com/maps/place/Roto-Rooter+Plumbing+Odessa/data=!4m7!3m6!1s0x86ac0f1a2b3c4d5e:0x1f2e3d4c5b6a7988!8m2!3d31.8457!4d-102.3676";
const MAPS_HTML = `<div><span class="fontHeadlineSmall">Midtown Plumbing Co</span>
  <span class="fontHeadlineSmall">Roto-Rooter Plumbing Odessa</span>
  <span class="fontHeadlineSmall">Midtown Plumbing Co</span></div>`;

const SPARSE_HTML = `<!doctype html><html><head>
  <title>Midtown Plumbing Co | Odessa TX</title>
  <meta name="description" content="Midtown Plumbing Co is based in Odessa, Texas.">
</head><body>
  <main><h1>Midtown Plumbing Co</h1><p>Locally owned. Call our team today.</p></main>
  <a href="mailto:hello@midtownplumbingodessa.com">Email Midtown</a>
</body></html>`;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function placeRow(overrides = {}) {
  return {
    id: "PLACES_ID_MIDTOWN",
    displayName: { text: "Midtown Plumbing Co" },
    formattedAddress: "123 Main St, Odessa, TX 79761, USA",
    location: { latitude: 31.9973, longitude: -102.0779 },
    nationalPhoneNumber: "+14325550117",
    websiteUri: SITE,
    businessStatus: "OPERATIONAL",
    primaryType: "plumber",
    types: ["plumber", "point_of_interest", "establishment"],
    addressComponents: [
      { longText: "Odessa", shortText: "Odessa", types: ["locality"] },
      { longText: "Ector County", shortText: "Ector County", types: ["administrative_area_level_2"] },
      { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1"] },
      { longText: "United States", shortText: "US", types: ["country"] },
    ],
    googleMapsUri: "https://maps.google.com/?cid=8847150489833127858",
    ...overrides,
  };
}

function mapsScrapePayload(links, html = MAPS_HTML) {
  return { success: true, data: { links: links.map((url) => ({ url })), html } };
}

function mirrorPass() {
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      build_hash: "build-hash",
      donor_content_hash: "donor-hash",
      file_count: 51,
      evidence_sha: "evidence-sha",
      renderer: "mirror-engine@v1",
      checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
    },
  };
}

function inputFor(fetchImpl, overrides = {}) {
  const { env, ...rest } = overrides;
  return {
    trigger: "operator_line",
    lane: "sandbox",
    queries: [{
      industry: "plumbing",
      location: "Odessa TX",
      textQuery: "plumbing in Odessa TX",
      queryGroup: 0,
    }],
    candidatesPerQuery: 3,
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GOOGLE_PLACES_API_KEY: "places-test-key",
      GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT: "0",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      ...env,
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
    mirrorImpl: async () => mirrorPass(),
    ...rest,
  };
}

async function withGlobalFetch(fetchImpl, run) {
  const realFetch = global.fetch;
  global.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    global.fetch = realFetch;
  }
}

// A stub serving: empty web SERP + a Maps scrape with the fixture payload +
// a Places searchText that answers with the named place (or none).
function mapsFlowStub({ links, html, placesFor }) {
  const calls = { search: 0, mapsScrape: 0, places: 0, placesQueries: [] };
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      calls.search++;
      return json({ data: [] });
    }
    if (href === FIRECRAWL_SCRAPE && method === "POST") {
      calls.mapsScrape++;
      calls.mapsBody = JSON.parse(String(init.body || "{}"));
      return json(mapsScrapePayload(links, html));
    }
    if (href === PLACES_SEARCH && method === "POST") {
      calls.places++;
      const body = JSON.parse(String(init.body || "{}"));
      calls.placesQueries.push(body.textQuery);
      return json({ places: placesFor(body.textQuery) });
    }
    if (method === "GET" && href.startsWith(SITE)) {
      return new Response(SPARSE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${method} ${href}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// --- Maps search-page parsing ------------------------------------------------

test("mapsSearchUrl encodes the balanced target and sweeps regions wider than metros", () => {
  const metro = mapsSearchUrl({ query: "plumbing in Odessa TX", center: { lat: 31.9973, lng: -102.0779, zoomMeters: MAPS_METRO_ZOOM_METERS } });
  assert.equal(metro, `https://www.google.com/maps/search/plumbing+in+Odessa+TX/@31.9973,-102.0779,${MAPS_METRO_ZOOM_METERS}m`);
  assert.equal(MAPS_METRO_ZOOM_METERS < 100_000, true, "a metro sweep is city-scale");
  // A REGION token sweeps the wide multi-city area at the proven 553408m scale.
  const region = mapsMarketCenter({ metro: { city: "West Texas", state: "TX" }, queryShape: "region" });
  assert.deepEqual([region.lat, region.lng], [31.9973, -102.0779]);
  assert.equal(region.zoomMeters, MAPS_REGIONAL_ZOOM_METERS);
  assert.equal(MAPS_REGIONAL_ZOOM_METERS, 553408);
  // A ZIP target sweeps its real town at metro scale (79401 = Lubbock).
  const zip = mapsMarketCenter({ metro: { city: "79401", state: "TX" }, queryShape: "zip" });
  assert.deepEqual([zip.lat, zip.lng], [33.5779, -101.8552]);
  assert.equal(zip.zoomMeters, MAPS_METRO_ZOOM_METERS);
  // An unknown market omits the viewport instead of inventing coordinates —
  // the query text itself scopes the Maps search.
  assert.equal(mapsSearchUrl({ query: "plumbing in Someplace XX", center: null }),
    "https://www.google.com/maps/search/plumbing+in+Someplace+XX/");
  assert.equal(mapsMarketCenter({ metro: { city: "Nowhere", state: "XX" } }), null);
  // A run's verified coordinates win over the frozen table.
  const verified = mapsMarketCenter({
    metro: { city: "Odessa", state: "TX" },
    verifiedCoordinates: { lat: 12.34, lng: 56.78 },
  });
  assert.deepEqual([verified.lat, verified.lng], [12.34, 56.78]);
});

test("parseMapsPlaceLink extracts name, raw hex-pair place ref, coords and the CID-only canonical URL", () => {
  const place = parseMapsPlaceLink(MAPS_LINK_MIDTOWN);
  assert.equal(place.name, "Midtown Plumbing Co");
  assert.equal(place.placeRef, "0x86ac2a4d3e1d5f01:0x7a4c21c9e6f0a3b2");
  assert.equal(place.lat, 31.9973);
  assert.equal(place.lng, -102.0779);
  // The raw pair is NOT a Places-API place_id, so it is stored raw; the
  // canonical query_place_id URL derives ONLY from the numeric CID.
  assert.equal(place.cid, BigInt("0x7a4c21c9e6f0a3b2").toString(10));
  assert.equal(place.canonicalUrl, `https://www.google.com/maps/search/?api=1&query_place_id=${place.cid}`);
});

test("parseMapsPlaceLink stores coords + name when no CID exists, and refuses non-place links", () => {
  const noCid = parseMapsPlaceLink("https://www.google.com/maps/place/Baker+Brothers+Plumbing");
  assert.equal(noCid.name, "Baker Brothers Plumbing");
  assert.equal(noCid.cid, "");
  assert.equal(noCid.canonicalUrl, undefined);
  assert.equal(noCid.placeRef, "");
  assert.equal(parseMapsPlaceLink("https://www.google.com/maps/search/plumbing/@31.9, -102.0"), null);
  assert.equal(parseMapsPlaceLink("https://www.yelp.com/biz/midtown-plumbing"), null);
  assert.equal(parseMapsPlaceLink(""), null);
});

test("parseMapsHeadlineNames reads the fontHeadlineSmall spans, deduped", () => {
  assert.deepEqual(parseMapsHeadlineNames(MAPS_HTML), ["Midtown Plumbing Co", "Roto-Rooter Plumbing Odessa"]);
  assert.deepEqual(parseMapsHeadlineNames("<div>no headlines here</div>"), []);
});

test("mapsSearchDiscovery posts the proven scrape shape and yields firecrawlSearch-shaped results", async () => {
  const posts = [];
  const fetchImpl = async (url, init = {}) => {
    posts.push({ href: String(url), body: JSON.parse(String(init.body || "{}")), auth: init.headers && init.headers.Authorization });
    return json(mapsScrapePayload([MAPS_LINK_MIDTOWN, MAPS_LINK_ROTOTHERMER], MAPS_HTML));
  };
  const out = await mapsSearchDiscovery({
    query: "plumbing in Odessa TX",
    center: { lat: 31.9973, lng: -102.0779, zoomMeters: MAPS_METRO_ZOOM_METERS },
    apiKey: "firecrawl-test-key",
    fetchImpl,
  });
  assert.equal(out.ok, true);
  assert.equal(out.calls, 1, "one Maps scrape is one Firecrawl call");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].href, FIRECRAWL_SCRAPE, "the scrape shares the Firecrawl v2 endpoint");
  assert.match(posts[0].auth, /^Bearer firecrawl-test-key$/);
  assert.equal(posts[0].body.url, `https://www.google.com/maps/search/plumbing+in+Odessa+TX/@31.9973,-102.0779,${MAPS_METRO_ZOOM_METERS}m`);
  assert.deepEqual(posts[0].body.formats, ["links", "html"]);
  assert.equal(posts[0].body.waitFor, 8000);
  // Same downstream shape as firecrawlSearch results ({url,title,description}).
  assert.equal(out.results.length, 2);
  for (const result of out.results) {
    assert.equal(typeof result.url, "string");
    assert.equal(typeof result.title, "string");
    assert.equal(typeof result.description, "string");
    assert.ok(result.mapsPlace, "each result carries its raw place evidence");
  }
  assert.deepEqual(out.headlineNames, ["Midtown Plumbing Co", "Roto-Rooter Plumbing Odessa"]);
  // The parser dedupes by the raw feature pair: the same place link rendered
  // twice on the page yields ONE result before the funnel ever sees it.
  const dedup = await mapsSearchDiscovery({
    query: "plumbing in Odessa TX",
    apiKey: "firecrawl-test-key",
    fetchImpl: async () => json(mapsScrapePayload([MAPS_LINK_MIDTOWN, MAPS_LINK_DUPLICATE])),
  });
  assert.equal(dedup.ok, true);
  assert.equal(dedup.results.length, 1);
  // No key, no call.
  const noKey = await mapsSearchDiscovery({ query: "x", apiKey: "", fetchImpl });
  assert.equal(noKey.ok, false);
  assert.equal(noKey.calls, 0);
});

test("mapsDiscoveryEnabled defaults ON and GHOST_AGENCY_MAPS_DISCOVERY=0 is the emergency stop", () => {
  assert.equal(mapsDiscoveryEnabled({}), true);
  assert.equal(mapsDiscoveryEnabled({ GHOST_AGENCY_MAPS_DISCOVERY: "1" }), true);
  assert.equal(mapsDiscoveryEnabled({ GHOST_AGENCY_MAPS_DISCOVERY: "0" }), false);
});

test("toggle off = zero maps calls; the scrape endpoint is never touched", async () => {
  const fetchImpl = mapsFlowStub({ links: [MAPS_LINK_MIDTOWN], placesFor: () => [placeRow()] });
  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(inputFor(fetchImpl, {
    env: { GHOST_AGENCY_MAPS_DISCOVERY: "0" },
  })));
  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  assert.equal(fetchImpl.calls.mapsScrape, 0, "the toggle stops the paid scrape");
  assert.equal(out.cost.maps_scrape_calls, 0);
  assert.equal(out.cost.firecrawl_search_calls, 1, "the search lane is untouched");
});

test("a Maps scrape feeds the SAME funnel: place resolved to website via Places, candidate shape intact, one record emitted", async () => {
  const fetchImpl = mapsFlowStub({
    // The same place rendered once WITH its data blob and once without (a real
    // Maps-page behavior) must collapse; the chain name must never spend a
    // Places call.
    links: [
      MAPS_LINK_MIDTOWN,
      "https://www.google.com/maps/place/Midtown+Plumbing+Co",
      MAPS_LINK_ROTOTHERMER,
    ],
    placesFor: (textQuery) => (/midtown/i.test(textQuery) ? [placeRow()] : []),
  });
  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(inputFor(fetchImpl)));
  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  // One record: the chain candidate is refused at admission and the duplicate
  // place is deduped, so only Midtown reaches a build proof.
  assert.equal(out.records.length, 1, JSON.stringify(out.funnel));
  const record = out.records[0];
  assert.equal(record.discovery.via, "google_maps_scrape");
  assert.equal(record.identity_source, "google_places", "a Maps candidate resolves identity through its Google place");
  assert.equal(record.mirror_request.facts.business_name, "Midtown Plumbing Co");
  // The candidate object shape matches the search lane's contract.
  assert.equal(record.discovery.domain, "midtownplumbingodessa.com");
  // Ledger: one search + one maps scrape + at least one Places resolution.
  assert.equal(out.cost.firecrawl_search_calls, 1);
  assert.equal(out.cost.maps_scrape_calls, 1);
  assert.ok(out.cost.places_calls >= 1, "place→website resolution bills Places");
  // Funnel naming: the chain dies at admission; the same place rendered
  // without its data blob still dedupes onto the first entry.
  const discovery = out.funnel.find((stage) => stage.stage === "1_discovery_firecrawl");
  assert.equal(discovery.rejected.national_chain_excluded, 1, JSON.stringify(discovery));
  assert.equal(discovery.rejected.duplicate_map_place, 1, JSON.stringify(discovery));
  // Exactly one Places call: the chain name was refused BEFORE its resolution.
  assert.equal(fetchImpl.calls.places, 1, JSON.stringify(fetchImpl.calls.placesQueries));
  assert.deepEqual(fetchImpl.calls.placesQueries, ["Midtown Plumbing Co Odessa TX"]);
});

test("a Maps place without a website, and a place Google cannot confirm, are refused by name", async () => {
  const fetchImpl = mapsFlowStub({
    links: [
      MAPS_LINK_MIDTOWN,
      "https://www.google.com/maps/place/Baker+Brothers+Plumbing/data=!4m7!3m6!1s0x86ac2a4d3e1d5f02:0x2a4c21c9e6f0a3c3!8m2!3d31.9!4d-102.1",
      "https://www.google.com/maps/place/Zyx+Unfindable+Plumbing/data=!4m7!3m6!1s0x86ac2a4d3e1d5f03:0x3a4c21c9e6f0a3d4!8m2!3d31.8!4d-102.2",
    ],
    placesFor: (textQuery) => {
      if (/baker/i.test(textQuery)) return [placeRow({ displayName: { text: NO_SITE_NAME }, websiteUri: "" })];
      if (/zyx/i.test(textQuery)) return []; // Google answers, nothing matches
      return [placeRow()];
    },
  });
  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(inputFor(fetchImpl)));
  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  const discovery = out.funnel.find((stage) => stage.stage === "1_discovery_firecrawl");
  assert.equal(discovery.rejected.maps_place_without_website, 1, JSON.stringify(discovery));
  assert.equal(discovery.rejected.maps_place_not_confirmed, 1, JSON.stringify(discovery));
});

test("resolveMapsCandidatePlace rides the existing Places searchText field mask and breaker", async () => {
  const posts = [];
  const fetchImpl = async (url, init = {}) => {
    posts.push({ href: String(url), mask: init.headers && init.headers["X-Goog-FieldMask"] });
    return json({ places: [placeRow({ displayName: { text: "Midtown Plumbing & Drain" } })] });
  };
  const out = await resolveMapsCandidatePlace({
    key: "places-test-key",
    name: "Midtown Plumbing",
    cityHint: "Odessa TX",
    fetchImpl,
  });
  assert.equal(out.ok, true);
  assert.equal(out.place.websiteUri, SITE);
  assert.equal(posts[0].href, PLACES_SEARCH);
  assert.match(posts[0].mask, /places\.websiteUri/, "identity-only field mask, same as every observation");
  // A healthy NO is a named refusal, not a provider failure.
  const miss = await resolveMapsCandidatePlace({
    key: "places-test-key",
    name: "Zyx Unfindable Plumbing",
    cityHint: "Odessa TX",
    fetchImpl: async () => json({ places: [placeRow()] }),
  });
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, "maps_place_not_confirmed");
});

// --- Query templates: negatives + modifier rotation ---------------------------

test("search queries always carry the negative-operator tail, idempotently", () => {
  const expected = " -site:yelp.com -site:angi.com -site:facebook.com -site:bbb.org -site:expertise.com -site:porch.com -site:thumbtack.com";
  assert.equal(searchQueryWithNegatives("plumbing company Odessa TX"), `plumbing company Odessa TX${expected}`);
  assert.equal(searchQueryWithNegatives("plumbing in West Texas"), `plumbing in West Texas${expected}`);
  // Idempotent: an already-negatived raw query is returned unchanged.
  assert.equal(searchQueryWithNegatives(`plumbing in Odessa TX${expected}`), `plumbing in Odessa TX${expected}`);
  assert.equal(searchQueryWithNegatives(""), "");
});

test("query shapes extend with the {trade} {modifier} {place} long-tails after the deep shapes", () => {
  const plans = buildQueries({
    industry: "plumbing",
    location: "Lubbock TX",
    env: {},
  });
  const textQueries = plans.map((plan) => plan.textQuery);
  assert.equal(textQueries[0], "plumbing in Lubbock TX", "the plain shape keeps the head position");
  assert.equal(textQueries[1], "plumbing Lubbock TX small business", "the proven deep shapes keep their rotation priority");
  assert.equal(textQueries[2], "plumbing company Lubbock TX");
  assert.equal(textQueries[2 + SERVICE_MODIFIERS.indexOf("repair")], "plumbing repair Lubbock TX");
  assert.equal(textQueries[2 + SERVICE_MODIFIERS.indexOf("near me")], "plumbing near me Lubbock TX");
  assert.equal(textQueries[2 + SERVICE_MODIFIERS.indexOf("specialist")], "plumbing specialist Lubbock TX");
  // Every modifier produced exactly one shape, in frozen-list order, after the
  // deep shapes.
  assert.deepEqual(textQueries.slice(2, 2 + SERVICE_MODIFIERS.length),
    SERVICE_MODIFIERS.map((modifier) => `plumbing ${modifier} Lubbock TX`));
});

test("modifier rotation is deterministic: the dispatch cursor cycles the long-tails and repeats exactly", () => {
  const plans = buildQueries({ industry: "plumbing", location: "Lubbock TX", env: {} });
  const count = plans.length;
  const at = (cursor) => dispatchQueryPlans(plans, cursor, 0)[0].textQuery;
  const cycle = [];
  for (let cursor = 0; cursor < count; cursor += 1) cycle.push(at(cursor));
  // Deterministic: the same cursor always answers the same query.
  for (let cursor = 0; cursor < count; cursor += 1) assert.equal(at(cursor), cycle[cursor]);
  // Rotating: the cycle repeats after exactly `count` steps.
  assert.equal(at(count), cycle[0], "the shape ladder wraps");
  assert.equal(at(count + 3), cycle[3]);
  // The rotation reaches the long-tails instead of re-reading the plain SERP
  // forever — a later attempt lands on a modifier shape.
  assert.ok(cycle.some((query) => SERVICE_MODIFIERS.some((modifier) => query === `plumbing ${modifier} Lubbock TX`)),
    JSON.stringify(cycle));
});

// --- National-chain exclusion -------------------------------------------------

test("the frozen chain set kills the majors and leaves look-alike locals alive", () => {
  for (const chain of ["Roto-Rooter", "Mr. Rooter", "Benjamin Franklin Plumbing", "Precision Air", "Sears", "ServiceMaster", "SERVPRO", "1-800-Plumber"]) {
    assert.equal(isNationalChainName(chain), true, `${chain} is on the frozen list`);
  }
  assert.equal(isNationalChainName("Roto-Rooter Plumbing & Water Cleanup Odessa"), true);
  assert.equal(isNationalChainName("Precision Air & Heating of Midland"), true);
  assert.equal(isNationalChainName("MIDTOWN PLUMBING CO"), false);
  assert.equal(isNationalChainName("Precision Roofing LLC"), false, "a look-alike local is not a chain");
  assert.equal(isNationalChainName("Sears Plumbing"), true);
  assert.equal(isNationalChainName(""), false);
});

test("GHOST_AGENCY_CHAIN_EXCLUSIONS appends owner-added chains", () => {
  assert.equal(isNationalChainName("Acme National Plumbing"), false);
  assert.equal(
    isNationalChainName("Acme National Plumbing", { GHOST_AGENCY_CHAIN_EXCLUSIONS: "Acme National, Zip Local" }),
    true,
  );
  assert.equal(
    isNationalChainName("Zip Local Water Works", { GHOST_AGENCY_CHAIN_EXCLUSIONS: "Acme National, Zip Local" }),
    true,
  );
  assert.equal(
    isNationalChainName("Totally Different Plumbing", { GHOST_AGENCY_CHAIN_EXCLUSIONS: "Acme National" }),
    false,
  );
});

test("chain exclusion kills Roto-Rooter at pick admission on the same quarantine path", () => {
  const row = {
    prospect_id: "prospect-rotorooter",
    business_name: "Roto-Rooter Plumbing & Water Cleanup",
    record: { industry: "plumbing", business_name: "Roto-Rooter Plumbing & Water Cleanup" },
  };
  const verdict = pickNameAdmission(row);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, NATIONAL_CHAIN_EXCLUDED);
  assert.deepEqual(verdict.quarantined, { businessName: "Roto-Rooter Plumbing & Water Cleanup" });
  // A plausible local name still passes with the cleaned (stripped) form.
  const local = pickNameAdmission({
    prospect_id: "prospect-local",
    business_name: "Midtown Plumbing Co",
    record: { industry: "plumbing" },
  });
  assert.equal(local.ok, true);
  assert.equal(local.name, "Midtown Plumbing Co");
});
