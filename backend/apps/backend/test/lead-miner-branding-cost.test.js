"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { mineBuildReady } = require("../lib/lead-miner");

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";
const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const FIRECRAWL_SCRAPE = "https://api.firecrawl.dev/v2/scrape";
const SITE_URL = "https://branding-meter.example/";

const PAGE_HTML = `<!doctype html><html><head>
  <title>Meter Plumbing | Spokane WA</title>
  <meta name="description" content="Plumbing and drain cleaning in Spokane, Washington.">
</head><body>
  <h1>Meter Plumbing</h1>
  <section class="services"><h2>Services</h2><h3>Drain Cleaning</h3></section>
  <a href="mailto:hello@branding-meter.example">Email us</a>
</body></html>`;

function json(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("one Firecrawl branding fallback reports the exact finite cost", async () => {
  let searchCalls = 0;
  let brandingCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    if (href === FIRECRAWL_SEARCH) {
      const body = JSON.parse(String(init.body || "{}"));
      // Search width default is 50 (owner directive 2026-09-01); this test's
      // subject is the branding meter, the width and the negative-operator
      // tail just ride along.
      assert.deepEqual(body, {
        query: "plumbing in Spokane WA -site:yelp.com -site:angi.com -site:facebook.com -site:bbb.org -site:expertise.com -site:porch.com -site:thumbtack.com",
        limit: 50,
      });
      searchCalls += 1;
      return json({ data: [{ url: SITE_URL, title: "Meter Plumbing" }] });
    }
    if (href === PLACES_SEARCH) throw new Error("operator discovery must not dial Places");
    if (href === SITE_URL) {
      return new Response(PAGE_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (href === FIRECRAWL_SCRAPE) {
      const body = JSON.parse(String(init.body || "{}"));
      assert.deepEqual(body.formats, ["branding"]);
      brandingCalls += 1;
      return json({ success: true, data: { branding: {} } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };

  const originalFetch = global.fetch;
  global.fetch = fetchImpl;
  let result;
  try {
    result = await mineBuildReady({
      trigger: "operator_line",
      lane: "sandbox",
      queries: [{
        industry: "plumbing",
        location: "Spokane WA",
        textQuery: "plumbing in Spokane WA",
        queryGroup: 0,
      }],
      candidatesPerQuery: 1,
      env: {
        GOOGLE_PLACES_API_KEY: "places-test-key",
        FIRECRAWL_API_KEY: "firecrawl-test-key",
        GHOST_AGENCY_MINER_BRANDING_FALLBACK: "1",
        GHOST_AGENCY_PHOTO_BANK: "false",
        GHOST_AGENCY_SOCIAL_SEARCH: "false",
        // This test pins the exact branding-meter costs; the Maps scrape lane
        // (which shares the v2 scrape endpoint) is pinned in its own file.
        GHOST_AGENCY_MAPS_DISCOVERY: "0",
      },
      fetchImpl,
      resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
      mirrorImpl: async () => ({
        ok: true,
        status: 200,
        body: {
          ok: true,
          build_hash: "build-hash",
          donor_content_hash: "donor-hash",
          file_count: 1,
          evidence_sha: "evidence-sha",
          renderer: "mirror-engine@test",
          checks: { brand: { status: "passed", logo_refs_in_output: 0 } },
        },
      }),
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(result.records.length, 1, JSON.stringify(result.rejects));
  assert.equal(searchCalls, 1);
  assert.equal(result.cost.firecrawl_search_calls, 1, JSON.stringify(result.cost));
  assert.equal(Number.isFinite(result.cost.firecrawl_search_calls), true);
  assert.equal(JSON.parse(JSON.stringify(result.cost)).firecrawl_search_calls, 1,
    "the serialized cost ledger must retain the Firecrawl discovery meter");
  assert.equal(result.cost.places_calls, 0, JSON.stringify(result.cost));
  assert.equal(brandingCalls, 1);
  assert.equal(result.cost.firecrawl_branding_calls, 1, JSON.stringify(result.cost));
  assert.equal(Number.isFinite(result.cost.firecrawl_branding_calls), true);
  assert.equal(JSON.parse(JSON.stringify(result.cost)).firecrawl_branding_calls, 1,
    "the serialized cost ledger must not turn the branding meter into null");
});
