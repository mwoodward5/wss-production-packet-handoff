"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { firecrawlSearch, firecrawlSearchLimit, FIRECRAWL_SEARCH_PROVIDER_MAX, mineBuildReady, searchQueryWithNegatives } = require("../lib/lead-miner");

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";
const FIRECRAWL_SCRAPE = "https://api.firecrawl.dev/v2/scrape";
const SITE = "https://acme-home-services.com/";
const DIRECTORY = "https://www.yelp.com/biz/acme-home-services-lubbock";

const SPARSE_HTML = (city, stateName) => `<!doctype html><html><head>
  <title>Acme Home Services | ${city} TX</title>
  <meta name="description" content="Acme Home Services is based in ${city}, ${stateName}.">
</head><body>
  <main><h1>Acme Home Services</h1><p>Locally owned. Call our team today.</p></main>
  <a href="mailto:hello@acme-home-services.com">Email Acme</a>
</body></html>`;

const SPOKANE_HTML = SPARSE_HTML("Spokane", "Washington");
const LUBBOCK_HTML = SPARSE_HTML("Lubbock", "Texas");

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
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
      location: "Spokane WA",
      textQuery: "plumbing in Spokane WA",
      queryGroup: 0,
    }],
    candidatesPerQuery: 1,
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GOOGLE_PLACES_API_KEY: "places-key-that-must-not-be-used",
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

function searchRecorder(results, extra = {}) {
  const searches = [];
  const scrapes = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      searches.push({ query: JSON.parse(String(init.body || "{}")).query, body: JSON.parse(String(init.body || "{}")) });
      return json({ data: results });
    }
    if (href === FIRECRAWL_SCRAPE && method === "POST") {
      // The Maps-discovery lane is on by default; this suite pins the SEARCH
      // lane, so the Maps scrape returns a benign empty page (tracked
      // separately, never counted as a search). Maps parsing, Places
      // resolution and the toggle are pinned in
      // test/maps-discovery-query-templates.test.js.
      scrapes.push(JSON.parse(String(init.body || "{}")));
      return json({ success: true, data: { links: [], html: "" } });
    }
    if (method === "GET" && href.startsWith(SITE)) {
      return new Response(extra.html ?? SPOKANE_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`unstubbed fetch: ${method} ${href}`);
  };
  fetchImpl.searches = searches;
  fetchImpl.scrapes = scrapes;
  return fetchImpl;
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

test("search width is 50 by default, env-tunable, clamped to the provider ceiling", () => {
  assert.equal(firecrawlSearchLimit({}), 50);
  assert.equal(firecrawlSearchLimit({ GHOST_AGENCY_SEARCH_LIMIT: "25" }), 25);
  assert.equal(firecrawlSearchLimit({ GHOST_AGENCY_SEARCH_LIMIT: "1" }), 1);
  assert.equal(firecrawlSearchLimit({ GHOST_AGENCY_SEARCH_LIMIT: "9999" }), FIRECRAWL_SEARCH_PROVIDER_MAX);
  assert.equal(FIRECRAWL_SEARCH_PROVIDER_MAX, 100);
});

test("firecrawlSearch posts the widened limit and clamps any caller above the provider max", async () => {
  const restore = process.env.GHOST_AGENCY_SEARCH_LIMIT;
  try {
    const posts = [];
    const post = async (url, init = {}) => {
      posts.push(JSON.parse(String(init.body || "{}")));
      return json({ data: [] });
    };
    delete process.env.GHOST_AGENCY_SEARCH_LIMIT;
    await firecrawlSearch({ query: "plumbers 79401", apiKey: "k", fetchImpl: post });
    process.env.GHOST_AGENCY_SEARCH_LIMIT = "30";
    await firecrawlSearch({ query: "plumbers 79401", apiKey: "k", fetchImpl: post });
    delete process.env.GHOST_AGENCY_SEARCH_LIMIT;
    await firecrawlSearch({ query: "plumbers 79401", apiKey: "k", limit: 250, fetchImpl: post });
    await firecrawlSearch({ query: "plumbers 79401", apiKey: "k", limit: 7, fetchImpl: post });
    assert.deepEqual(posts.map((body) => body.limit), [50, 30, 100, 7]);
  } finally {
    if (restore === undefined) delete process.env.GHOST_AGENCY_SEARCH_LIMIT;
    else process.env.GHOST_AGENCY_SEARCH_LIMIT = restore;
  }
});

test("operator Line searches the wide SERP regardless of the small quota pool", async () => {
  const fetchImpl = searchRecorder([{ url: SITE, title: "Acme Home Services" }]);
  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(inputFor(fetchImpl)));
  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  assert.equal(out.records.length, 1, JSON.stringify(out.funnel));
  // The quota asked for ONE candidate; the search still asked for 50 results
  // so dedup, directory filtering and dead links cannot starve the funnel.
  assert.equal(fetchImpl.searches.length, 1);
  assert.equal(fetchImpl.searches[0].body.limit, 50);
  // NEGATIVE OPERATORS ride every discovery search (owner-measured keep-rate
  // doubling); the balanced target itself is unchanged at the head.
  assert.equal(fetchImpl.searches[0].body.query, searchQueryWithNegatives("plumbing in Spokane WA"));
  assert.match(fetchImpl.searches[0].body.query, / -site:yelp\.com -site:angi\.com -site:facebook\.com -site:bbb\.org -site:expertise\.com -site:porch\.com -site:thumbtack\.com$/);
});

test("GHOST_AGENCY_SEARCH_LIMIT narrows the operator Line's discovery width", async () => {
  const fetchImpl = searchRecorder([{ url: SITE, title: "Acme Home Services" }]);
  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(inputFor(fetchImpl, {
    env: { GHOST_AGENCY_SEARCH_LIMIT: "12" },
  })));
  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  assert.equal(out.records.length, 1, JSON.stringify(out.funnel));
  assert.equal(fetchImpl.searches[0].body.limit, 12);
});

test("a ZIP-shape query mines and fences through its true state", async () => {
  const fetchImpl = searchRecorder(
    [
      { url: DIRECTORY, title: "Lubbock directory" },
      { url: SITE, title: "Acme Home Services" },
    ],
    { html: LUBBOCK_HTML },
  );
  const input = inputFor(fetchImpl, {
    queries: [{
      industry: "plumbing",
      location: "79401",
      textQuery: "plumbing in 79401",
      queryGroup: 0,
    }],
  });
  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  assert.equal(fetchImpl.searches[0].body.query, searchQueryWithNegatives("plumbing in 79401"));
  assert.equal(out.cost.firecrawl_search_calls, 1);
  assert.equal(out.records.length, 1, JSON.stringify(out.funnel));
  // The directory filter still guards the ZIP SERP: a Yelp page is not a
  // business to rebuild.
  const discovery = out.funnel.find((stage) => stage.stage === "1_discovery_firecrawl");
  assert.equal(discovery.rejected.directory_or_social_page, 1, JSON.stringify(discovery));
  const record = out.records[0];
  assert.equal(record.discovery.via, "firecrawl_search");
});

test("dedup holds across shapes: the same domain never enters twice", async () => {
  const fetchImpl = searchRecorder([{ url: SITE, title: "Acme Home Services" }]);
  const input = inputFor(fetchImpl, {
    queries: [
      {
        industry: "plumbing",
        location: "Spokane WA",
        textQuery: "plumbing in Spokane WA",
        queryGroup: 0,
      },
      {
        industry: "plumbing",
        location: "79401",
        textQuery: "plumbing in 79401",
        queryGroup: 1,
      },
    ],
  });
  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true, JSON.stringify(out.rejects));
  assert.equal(out.cost.firecrawl_search_calls, 2, "both query groups searched");
  assert.equal(out.records.length, 1, "one business, one record");
  const discovery = out.funnel.find((stage) => stage.stage === "1_discovery_firecrawl");
  assert.equal(discovery.rejected.duplicate_domain_in_batch, 1, JSON.stringify(discovery));
});
