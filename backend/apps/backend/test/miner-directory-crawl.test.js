"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { mineBuildReady, firecrawlCrawl } = require("../lib/lead-miner");

const DIRECTORY = "https://www.bbb.org/us/tx/austin/category/plumber";
const BUSINESS = "https://www.acmeplumbing.com/";
const CRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/crawl";

const BUSINESS_HTML = `<!doctype html><html><head><title>Acme Plumbing | Austin TX</title>
  <meta name="description" content="Plumbing repairs in Austin TX">
  <script type="application/ld+json">{"@type":"Plumber","name":"Acme Plumbing","telephone":"(512) 555-0100","address":{"@type":"PostalAddress","addressLocality":"Austin","addressRegion":"TX","postalCode":"78701"}}</script></head><body>
  <h1>Acme Plumbing</h1><p>Plumbing repairs and water heaters.</p>
  <a href="mailto:acmeplumbing@gmail.com">Email us</a>
  <img class="custom-logo" src="/logo.svg" alt="Acme Plumbing">
</body></html>`;

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120"><rect width="400" height="120" fill="#1d4ed8"/></svg>';

test("firecrawlCrawl starts a crawl, polls to completion, and harvests https links", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    calls.push({ href, method: init.method || "GET" });
    if (href === CRAWL_ENDPOINT) {
      return new Response(JSON.stringify({ success: true, id: "job-1", url: `${CRAWL_ENDPOINT}/job-1` }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === `${CRAWL_ENDPOINT}/job-1`) {
      return new Response(JSON.stringify({
        success: true,
        status: "completed",
        data: [
          { links: [BUSINESS, "tel:+15125550100", "https://www.bbb.org/other", "#top"] },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  const out = await firecrawlCrawl({ url: DIRECTORY, apiKey: "firecrawl", endpoint: CRAWL_ENDPOINT, fetchImpl, pollMs: 1 });
  assert.equal(out.ok, true);
  // tel:, #anchors and the directory's own domain links are dropped; only the
  // absolute https business URL survives.
  assert.deepEqual(out.urls, [BUSINESS]);
  assert.equal(out.calls, 1);
  assert.equal(calls[0].method, "POST");
});

test("a directory hit in the search lane is crawled and its business reaches a record", async () => {
  const counts = { search: 0, crawl: 0, poll: 0, pages: 0, logos: 0, dryRuns: 0 };
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    if (/api\.firecrawl\.dev\/v1\/search/i.test(href)) {
      counts.search++;
      return new Response(JSON.stringify({ data: [{ url: DIRECTORY, title: "Austin Plumbers Directory" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === CRAWL_ENDPOINT) {
      counts.crawl++;
      return new Response(JSON.stringify({ success: true, id: "job-1", url: `${CRAWL_ENDPOINT}/job-1` }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === `${CRAWL_ENDPOINT}/job-1`) {
      counts.poll++;
      return new Response(JSON.stringify({ success: true, status: "completed", data: [{ links: [BUSINESS] }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === BUSINESS || href === `${BUSINESS}`) {
      counts.pages++;
      return new Response(BUSINESS_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (/\/logo\.svg$/.test(href)) {
      counts.logos++;
      return new Response(Buffer.from(LOGO), { status: 200, headers: { "content-type": "image/svg+xml" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };

  const dryRunMirror = async (request) => {
    counts.dryRuns++;
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
        checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
      },
    };
  };

  const out = await mineBuildReady({
    queries: [{ industry: "plumbing", location: "Austin TX", textQuery: "plumbing in Austin TX", queryGroup: 0 }],
    candidatesPerQuery: 4,
    env: {
      FIRECRAWL_API_KEY: "firecrawl",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      GHOST_AGENCY_MINER_DIRECTORY_CRAWL: "1",
      GHOST_AGENCY_FIRECRAWL_CRAWL_ENDPOINT: CRAWL_ENDPOINT,
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
    mirrorImpl: dryRunMirror,
  });

  assert.equal(out.ok, true);
  assert.equal(counts.crawl, 1, "the skipped directory is crawled exactly once");
  assert.equal(counts.poll, 1, "the crawl job is polled to completion");
  assert.equal(out.cost.firecrawl_crawl_calls, 1, "the crawl is metered on the cost object");
  // The business recovered from the directory is deduped, qualified, and dry-run
  // proven — it must appear as a record, not be silently dropped.
  const crawled = out.records.filter((r) => r.discovery && r.discovery.via === "firecrawl_crawl");
  assert.equal(crawled.length, 1, "the directory-recovered business reaches a record");
  assert.equal(crawled[0].directory_crawled, true, "the record is tagged as directory-recovered");
  assert.equal(crawled[0].discovery.via, "firecrawl_crawl", "the discovery source is the crawl, not the search");
});

test("operator Line discovers a direct Firecrawl website and never expands a directory", async () => {
  const placesEndpoint = "https://places.googleapis.com/v1/places:searchText";
  const counts = { places: 0, firecrawlSearch: 0, crawl: 0, directoryFetches: 0, dryRuns: 0 };
  const fetchImpl = async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href === placesEndpoint) {
      counts.places++;
      throw new Error("operator website discovery must not call Places");
    }
    if (/api\.firecrawl\.dev\/v1\/search/i.test(href)) {
      counts.firecrawlSearch++;
      return new Response(JSON.stringify({ data: [
        { url: DIRECTORY, title: "Austin Plumbers Directory" },
        { url: BUSINESS, title: "Acme Plumbing" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === CRAWL_ENDPOINT || href.startsWith(`${CRAWL_ENDPOINT}/`)) {
      counts.crawl++;
      return new Response(JSON.stringify({ success: true, status: "completed", data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === DIRECTORY) {
      counts.directoryFetches++;
      return new Response("<html><body>directory listing</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    if (href === BUSINESS) {
      return new Response(BUSINESS_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (/\/logo\.svg$/.test(href)) {
      return new Response(Buffer.from(LOGO), { status: 200, headers: { "content-type": "image/svg+xml" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  const out = await mineBuildReady({
    queries: [{ industry: "plumbing", location: "Austin TX", textQuery: "plumbing in Austin TX", queryGroup: 0 }],
    candidatesPerQuery: 10,
    trigger: "operator_line",
    env: {
      GOOGLE_PLACES_API_KEY: "places-test-key",
      FIRECRAWL_API_KEY: "firecrawl",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      GHOST_AGENCY_MINER_DIRECTORY_CRAWL: "1",
      GHOST_AGENCY_FIRECRAWL_CRAWL_ENDPOINT: CRAWL_ENDPOINT,
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
    mirrorImpl: async (request) => {
      counts.dryRuns++;
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
          checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
        },
      };
    },
  });

  assert.equal(counts.places, 0, "operator Line must not buy Places discovery before website capture");
  assert.equal(counts.firecrawlSearch, 1, "operator Line uses one Firecrawl Search discovery page");
  assert.equal(counts.crawl, 0, "operator Line must not start directory crawl work");
  assert.equal(counts.directoryFetches, 0, "a directory search result is rejected before first-party capture");
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 800));
  assert.equal(out.cost.firecrawl_search_calls, 1);
  assert.equal(out.cost.places_calls, 0);
  assert.equal(out.cost.firecrawl_crawl_calls || 0, 0);
  assert.equal(counts.dryRuns, 1);
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].discovery.via, "firecrawl_search");
  assert.equal(out.records[0].discovery.url, BUSINESS);
  assert.equal(out.records[0].mirror_request.facts.current_website, BUSINESS);
  assert.equal(out.records.some((record) => record.discovery && record.discovery.url === DIRECTORY), false,
    "directories are evidence to reject, never packet sources");
});

test("a business in both search and crawl is deduped; only the crawl-only business is tagged firecrawl_crawl", async () => {
  const SEARCH_BUSINESS = "https://www.acmeplumbing.com/";
  const CRAWL_BUSINESS = "https://www.bestplumbing.com/";
  const businessHtml = (name, email) => `<!doctype html><html><head><title>${name} | Austin TX</title>
    <meta name="description" content="Plumbing repairs in Austin TX">
    <script type="application/ld+json">{"@type":"Plumber","name":"${name}","telephone":"(512) 555-0100","address":{"@type":"PostalAddress","addressLocality":"Austin","addressRegion":"TX","postalCode":"78701"}}</script></head><body>
    <h1>${name}</h1><p>Plumbing repairs and water heaters.</p>
    <a href="mailto:${email}">Email us</a>
    <img class="custom-logo" src="/logo.svg" alt="${name}">
  </body></html>`;

  const counts = { search: 0, crawl: 0, poll: 0, pages: 0, logos: 0, dryRuns: 0 };
  const fetchImpl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    if (/api\.firecrawl\.dev\/v1\/search/i.test(href)) {
      counts.search++;
      return new Response(JSON.stringify({ data: [
        { url: DIRECTORY, title: "Austin Plumbers Directory" },
        { url: SEARCH_BUSINESS, title: "Acme Plumbing" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === CRAWL_ENDPOINT) {
      counts.crawl++;
      return new Response(JSON.stringify({ success: true, id: "job-1", url: `${CRAWL_ENDPOINT}/job-1` }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === `${CRAWL_ENDPOINT}/job-1`) {
      counts.poll++;
      // The crawl returns the search business AGAIN plus a new one.
      return new Response(JSON.stringify({ success: true, status: "completed", data: [{ links: [SEARCH_BUSINESS, CRAWL_BUSINESS] }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === SEARCH_BUSINESS || href === `${SEARCH_BUSINESS}`) {
      counts.pages++;
      return new Response(businessHtml("Acme Plumbing", "acmeplumbing@gmail.com"), { status: 200, headers: { "content-type": "text/html" } });
    }
    if (href === CRAWL_BUSINESS || href === `${CRAWL_BUSINESS}`) {
      counts.pages++;
      return new Response(businessHtml("Best Plumbing", "bestplumbing@gmail.com"), { status: 200, headers: { "content-type": "text/html" } });
    }
    if (/\/logo\.svg$/.test(href)) {
      counts.logos++;
      return new Response(Buffer.from(LOGO), { status: 200, headers: { "content-type": "image/svg+xml" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };

  const dryRunMirror = async (request) => {
    counts.dryRuns++;
    return {
      ok: true, status: 200,
      body: { ok: true, build_hash: `hash-${request.slug}`, donor_content_hash: "donor", file_count: 51, evidence_sha: "sha", renderer: "mirror-engine@v1", checks: { brand: { status: "passed", logo_refs_in_output: 3 } } },
    };
  };

  const out = await mineBuildReady({
    queries: [{ industry: "plumbing", location: "Austin TX", textQuery: "plumbing in Austin TX", queryGroup: 0 }],
    candidatesPerQuery: 4,
    env: {
      FIRECRAWL_API_KEY: "firecrawl",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      GHOST_AGENCY_MINER_DIRECTORY_CRAWL: "1",
      GHOST_AGENCY_FIRECRAWL_CRAWL_ENDPOINT: CRAWL_ENDPOINT,
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
    mirrorImpl: dryRunMirror,
  });

  assert.equal(out.ok, true);
  assert.equal(counts.crawl, 1, "the directory is crawled exactly once");
  // The search-discovered business keeps its search provenance, not crawl.
  const searchRec = out.records.filter((r) => r.discovery && r.discovery.domain === "acmeplumbing.com");
  assert.equal(searchRec.length, 1, "the search business appears exactly once (deduped against the crawl)");
  assert.equal(searchRec[0].discovery.via, "firecrawl_search", "the search business is not re-tagged as crawled");
  // The crawl-only business is tagged firecrawl_crawl.
  const crawlRec = out.records.filter((r) => r.discovery && r.discovery.via === "firecrawl_crawl");
  assert.equal(crawlRec.length, 1, "only the crawl-only business is tagged firecrawl_crawl");
  assert.equal(crawlRec[0].discovery.domain, "bestplumbing.com", "the crawl-only business is the new one");
});
